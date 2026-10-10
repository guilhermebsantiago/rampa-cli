"""Match the re-measure's findings to the first run's labels, and build evidence packets for the rest.

For every test page with a report under pages/<slug>/report.json:

- New findings are the report's judgment and rule findings, shown (`findings`) or below the
  threshold (`belowThreshold`). Engine (axe-core) findings are not labelled, as in the first run.
- Each new finding is matched to a labelled finding of the first run on the same page and criterion
  and the same element: first by fingerprint, then by ref, then by the quoted subject (the alt text,
  link text, heading or title, compared without case and spacing; the first run's files replaced
  some accented letters with U+FFFD, which matches any one letter here). One old finding matches at
  most one new finding. Judgment findings pick first; rule findings may then match what is left.
  A matched finding reuses the first run's two labels.
- Unmatched findings get an evidence packet under packets/<slug>.json, with the image crop the model
  saw under packets/<slug>/, for the two judges.

Writes data/matches.json. Run: python -I study/remeasure-2026-10-09/scripts/match.py
"""

import base64
import json
import os
import re
import unicodedata

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STUDY = os.path.dirname(HERE)
CRITERIA = ("1.1.1", "1.3.5", "2.4.2", "2.4.4", "2.4.6", "3.1.1", "3.1.2", "3.3.2")


def read_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")


def norm(text):
    text = unicodedata.normalize("NFC", text or "")
    return re.sub(r"\s+", " ", text).strip().strip("\"'“”").lower()


def same_text(new, old):
    """old may hold U+FFFD where the first run lost a letter."""
    a, b = norm(new), norm(old)
    if not a or not b:
        return False
    if "�" not in b and "�" not in a:
        return a == b
    pattern = "".join("." if ch == "�" else re.escape(ch) for ch in b)
    if re.fullmatch(pattern, a, flags=re.S):
        return True
    pattern = "".join("." if ch == "�" else re.escape(ch) for ch in a)
    return re.fullmatch(pattern, b, flags=re.S) is not None


def kind_of(f):
    """like: a judgment of one of the study's criteria, as in the first run. new-*: checks added since."""
    if f["source"] == "judgment":
        if f["criterion"] in CRITERIA and not (f.get("subject") or "").startswith("hidden "):
            return "like"
        return "new-judgment"
    return "new-rule"


def walk(node, parent=None):
    yield node, parent
    for child in node.get("children", []):
        yield from walk(child, node)


def short(text, n=300):
    text = re.sub(r"\s+", " ", text or "").strip()
    return text if len(text) <= n else text[: n - 1] + "…"


def subtree_text(node, limit=800):
    parts = []
    for n, _ in walk(node):
        if n.get("text"):
            parts.append(n["text"])
        elif n.get("role") == "img" and n.get("name"):
            parts.append(f"[img: {n['name']}]")
    return short(" ".join(parts), limit)


class Page:
    def __init__(self, snapshot):
        self.snapshot = snapshot
        self.order, self.parent, self.by_ref = [], {}, {}
        for n, p in walk(snapshot["root"]):
            self.order.append(n)
            self.parent[id(n)] = p
            self.by_ref.setdefault(n["ref"], n)
        self.index = {id(n): i for i, n in enumerate(self.order)}

    def ancestors(self, node, depth=8):
        out, p = [], self.parent.get(id(node))
        while p is not None and len(out) < depth:
            out.append(p)
            p = self.parent.get(id(p))
        return out

    def headings_near(self, node):
        i = self.index[id(node)]
        heads = [(j, n) for j, n in enumerate(self.order) if n.get("role") == "heading"]
        before = [n for j, n in heads if j < i][-4:]
        after = [n for j, n in heads if j > i][:1]
        def h(n):
            return {"tag": n["native"].get("tag"), "text": short(n.get("name") or subtree_text(n, 200), 200), "ref": n["ref"]}
        return {"before": [h(n) for n in before], "after": [h(n) for n in after]}


def describe(node):
    native = node.get("native", {})
    return {
        "ref": node["ref"],
        "role": node.get("role"),
        "name": node.get("name"),
        "text": short(node.get("text"), 400) or None,
        "states": node.get("states"),
        "bounds": node.get("bounds"),
        "tag": native.get("tag"),
        "attributes": {k: short(str(v), 300) for k, v in (native.get("attributes") or {}).items()},
        "html": short(native.get("html"), 1500) or None,
        "readingText": short(native.get("readingText"), 600) or None,
    }


def packet(f, page, slug, crops_dir):
    snap = page.snapshot
    p = {
        "key": f["key"],
        "fingerprint": f["fingerprint"],
        "criterion": f["criterion"],
        "source": f["source"],
        "ruleId": f.get("ruleId"),
        "message": f["message"],
        "evidence": f.get("evidence"),
        "subject": f.get("subject"),
        "patch": f.get("patch"),
        "confidence": f["confidence"],
        "html": short(f.get("html"), 1500) or None,
    }
    node = page.by_ref.get(f.get("ref") or "")
    if f["criterion"] == "2.4.2" or f.get("ref") == "html":
        p["page"] = {
            "title": snap.get("title"),
            "url": snap["target"],
            "h1": [short(subtree_text(n, 200), 200) for n in page.order if n.get("role") == "heading" and n["native"].get("tag") == "h1"][:5],
        }
    if node is None:
        p["element"] = None
        p["note"] = "the ref is not in the snapshot"
        return p
    p["element"] = describe(node)
    p["element"]["contentText"] = subtree_text(node)
    # Nearest first; an ancestor that adds no text to the one below it is left out.
    ancestors, last = [], None
    for a in page.ancestors(node, depth=12):
        text = short(subtree_text(a, 300), 300) or None
        if text == last and not a.get("name"):
            continue
        last = text
        ancestors.append({"role": a.get("role"), "tag": a["native"].get("tag"), "name": short(a.get("name"), 150) or None, "text": text})
        if len(ancestors) == 5:
            break
    p["ancestors"] = ancestors
    p["headingsNear"] = page.headings_near(node)
    link = next((n for n in [node, *page.ancestors(node)] if n.get("role") == "link"), None)
    if link is not None:
        href = (link["native"].get("attributes") or {}).get("href")
        p["link"] = {"ref": link["ref"], "name": link.get("name"), "href": href, "title": (link["native"].get("attributes") or {}).get("title")}
        dest = (snap.get("destinations") or {}).get(href) if href else None
        p["destination"] = dest or "not read by Rampa"
    image = node.get("image")
    if image and image.startswith("data:image/png;base64,"):
        os.makedirs(crops_dir, exist_ok=True)
        path = os.path.join(crops_dir, f"{f['key']}.png")
        with open(path, "wb") as out:
            out.write(base64.b64decode(image.split(",", 1)[1]))
        p["imageCrop"] = os.path.relpath(path, STUDY).replace("\\", "/")
    elif node.get("role") in ("img", "image", "graphics-document") or node["native"].get("tag") in ("img", "svg"):
        p["imageCrop"] = None
        p["imageNote"] = node["native"].get("imageSkipped") or "no crop in the snapshot"
    return p


def main():
    meta = read_json(os.path.join(STUDY, "scripts", "pages-input.json"))
    old_all = read_json(os.path.join(STUDY, "data", "findings.json"))
    out = {"pages": []}
    for page_meta in meta["pages"]:
        if page_meta["split"] != "test":
            continue
        slug = page_meta["slug"]
        report_path = os.path.join(HERE, "pages", slug, "report.json")
        if not os.path.exists(report_path):
            out["pages"].append({"slug": slug, "report": False})
            continue
        report = read_json(report_path)
        news = []
        for shown, group in ((True, report.get("findings", [])), (False, report.get("belowThreshold", []) + report.get("beyondTarget", []))):
            for f in group:
                if f.get("source") not in ("judgment", "rule"):
                    continue
                news.append({**f, "shown": shown, "kind": kind_of(f)})
        seen = {}
        for f in news:
            k = f["fingerprint"]
            seen[k] = seen.get(k, 0) + 1
            f["key"] = k if seen[k] == 1 else f"{k}-{seen[k]}"
        olds = [o for o in old_all if o["slug"] == slug]
        used = set()

        def take(f, how, pred):
            for o in olds:
                if o["fingerprint"] in used or o["criterion"] != f["criterion"]:
                    continue
                if pred(o):
                    used.add(o["fingerprint"])
                    f["match"] = {"by": how, "fingerprint": o["fingerprint"], "final": o["final"], "finalCause": o["finalCause"],
                                  "auditor": o["auditor"]["label"], "skeptic": o["skeptic"]["label"],
                                  "oldMessage": o["message"], "oldEvidence": o["evidence"]}
                    return True
            return False

        order = [f for f in news if f["source"] == "judgment"] + [f for f in news if f["source"] == "rule"]
        for how, pred_of in (
            ("fingerprint", lambda f: lambda o: o["fingerprint"] == f["fingerprint"]),
            ("ref", lambda f: lambda o: f.get("ref") and o["ref"] == f.get("ref")),
            ("subject", lambda f: lambda o: any(same_text(t, o["evidence"]) for t in (f.get("subject"), f.get("evidence")) if t)),
        ):
            for f in order:
                if "match" not in f:
                    take(f, how, pred_of(f))

        recordings = os.path.join(HERE, "pages", slug, "recording")
        snap_file = next((os.path.join(recordings, n) for n in os.listdir(recordings) if n.endswith(".snapshot.json")), None)
        page = Page(read_json(snap_file))
        crops = os.path.join(HERE, "packets", slug)
        unmatched = [f for f in news if "match" not in f]
        packets = [packet(f, page, slug, crops) for f in unmatched]
        # A matched finding whose claim is worded differently from the first run's (another problem on the same
        # element) keeps the reused label, as the method says; the judges also label it, for a sensitivity check.
        changed = [f for f in news if "match" in f and norm(f["match"]["oldMessage"]) != norm(f["message"]) and not same_text(f["message"], f["match"]["oldMessage"])]
        for f in changed:
            f["claimChanged"] = True
        for name, group in ((slug, packets), (f"{slug}--claim-changed", [packet(f, page, slug, crops) for f in changed])):
            if not group:
                continue
            write_json(os.path.join(HERE, "packets", f"{name}.json"), {
                "page": page_meta["url"],
                "slug": slug,
                "title": page.snapshot.get("title"),
                "language": page.snapshot.get("locale"),
                "snapshot": os.path.relpath(snap_file, STUDY).replace("\\", "/"),
                "screenshot": f"remeasure-2026-10-09/pages/{slug}/screenshot.png",
                "collectedAt": page.snapshot.get("collectedAt"),
                "findings": group,
            })
        # Page change: how many of the first run's findings still point at an element with the same text.
        still = []
        for o in olds:
            n = page.by_ref.get(o["ref"] or "")
            still.append({"fingerprint": o["fingerprint"], "refFound": n is not None,
                          "sameText": bool(n) and (o["criterion"] == "2.4.2" or any(same_text(t, o["evidence"]) for t in (n.get("name"), subtree_text(n), n.get("text")) if t))})
        out["pages"].append({
            "slug": slug,
            "report": True,
            "title": page.snapshot.get("title"),
            "findings": [{k: f.get(k) for k in ("key", "fingerprint", "criterion", "source", "ruleId", "kind", "shown", "confidence", "experimental", "ref", "subject", "message", "evidence", "match", "claimChanged")} for f in news],
            "oldFindingsStillOnPage": still,
        })
        n_match = sum(1 for f in news if "match" in f)
        print(f"{slug}: {len(news)} new ({sum(f['kind'] == 'like' for f in news)} like-for-like), {n_match} matched, {len(packets)} to label")
    write_json(os.path.join(HERE, "data", "matches.json"), out)


if __name__ == "__main__":
    main()
