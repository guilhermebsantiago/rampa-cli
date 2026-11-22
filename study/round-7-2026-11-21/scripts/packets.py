"""Build the judges' evidence packets for the seventh real-page study (pre-registration, section 3, "Labels").

The sixth study's packets.py with this study's seed and folders, and without the ablations' extra findings (this round
counts them and does not label them). One packet per page, packets/<slug>.json, holding in one form and in an order
shuffled with random.Random("20261121:<slug>"):

- every judgment and rule finding of the main run (DATA/pages/<slug>/report.json), at any confidence; engine (axe-core)
  findings are not labelled, as in every study;
- the suggestions drawn by scripts/sample_suggestions.py, in the shape of a finding with no quote;
- the pass sample drawn by scripts/pass_draw.py: a held-back or discarded claim keeps Rampa's own words
  (the main run's suggestion, or the finding or suggestion the --no-confirm or --no-verify run makes of it); a passed
  candidate has no claim ("message": null, the rubric's "Rows with no claim"). An item already in the packet for another
  reason is labelled once and marked in data/findings-raw.json.

No confidence, patch, run name or suggestion quote is in a packet. The image crop the model saw is written to
packets/<slug>/<key>.<ext>, and the page's snapshot and screenshot are copied to packets/<slug>/snapshot.json and
packets/<slug>/screenshot.png (out of git), so that no judge opens the recordings folder.

Writes data/findings-raw.json (one row per labelled item, with origin, confidence and patch for the analysis); prints
counts only. Run: python -I study/round-7-2026-11-21/scripts/packets.py [slug ...]
"""
import base64
import hashlib
import os
import random
import re
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import HERE, page_dir, pages, read_json, snapshot_file, write_json  # noqa: E402

SEED = "20261121"
DEFAULT_CRITERIA = ("1.1.1", "1.3.5", "2.4.2", "2.4.4", "2.4.6", "3.1.1", "3.1.2", "3.3.2")
LEVELS = {"low": 0, "medium": 1, "high": 2}
FIELDS = ("key", "fingerprint", "origin", "origins", "criterion", "level", "source", "ruleId", "kind", "list", "shown", "experimental",
          "confidence", "ref", "subject", "message", "evidence", "patch", "html", "agreement", "model", "confirmation",
          "suggestionEvidence", "claim", "sampleReason", "passStratum", "passRank", "techniques")


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
            return {"tag": (n.get("native") or {}).get("tag"), "text": short(n.get("name") or subtree_text(n, 200), 200), "ref": n["ref"]}
        return {"before": [h(n) for n in before], "after": [h(n) for n in after]}


def describe(node):
    native = node.get("native") or {}
    return {
        "ref": node["ref"], "role": node.get("role"), "name": node.get("name"), "browserName": (node.get("ax") or {}).get("name"),
        "text": short(node.get("text"), 400) or None, "states": node.get("states"), "bounds": node.get("bounds"), "tag": native.get("tag"),
        "attributes": {k: short(str(v), 300) for k, v in (native.get("attributes") or {}).items()},
        "html": short(native.get("html"), 1500) or None, "readingText": short(native.get("readingText"), 600) or None,
        "imageSkipped": native.get("imageSkipped"),
    }


def packet_row(f, page, crops_dir):
    snap = page.snapshot
    p = {"key": f["key"], "fingerprint": f["fingerprint"], "criterion": f["criterion"], "source": f["source"], "ruleId": f.get("ruleId"),
         "message": f.get("message"), "evidence": f.get("evidence"), "subject": f.get("subject"), "html": short(f.get("html"), 1500) or None}
    if f.get("message") is None:
        p["note"] = f"Rampa judged this element for {f['criterion']} and reported nothing on it."
    node = page.by_ref.get(f.get("ref") or "")
    if f["criterion"] in ("2.4.2", "3.1.1") or f.get("ref") == "html":
        p["page"] = {
            "title": snap.get("title"), "url": snap["target"],
            "lang": (((page.order[0].get("native") or {}).get("attributes")) or {}).get("lang"),
            "h1": [short(subtree_text(n, 200), 200) for n in page.order if n.get("role") == "heading" and (n.get("native") or {}).get("tag") == "h1"][:5],
        }
    if node is None:
        p["element"] = None
        p["note"] = "the ref is not in the snapshot" if f.get("ref") else "the finding names no element"
        return p
    p["element"] = describe(node)
    p["element"]["contentText"] = subtree_text(node)
    ancestors, last = [], None
    for a in page.ancestors(node, depth=12):
        text = short(subtree_text(a, 300), 300) or None
        if text == last and not a.get("name"):
            continue
        last = text
        ancestors.append({"role": a.get("role"), "tag": (a.get("native") or {}).get("tag"), "name": short(a.get("name"), 150) or None, "text": text})
        if len(ancestors) == 5:
            break
    p["ancestors"] = ancestors
    p["headingsNear"] = page.headings_near(node)
    link = next((n for n in [node, *page.ancestors(node)] if n.get("role") == "link"), None)
    if link is not None:
        attrs = (link.get("native") or {}).get("attributes") or {}
        href = attrs.get("href")
        p["link"] = {"ref": link["ref"], "name": link.get("name"), "href": href, "title": attrs.get("title")}
        dest = (snap.get("destinations") or {}).get(href) if href else None
        p["destination"] = dest or "not read by Rampa"
    image = node.get("image")
    if image and image.startswith("data:image/"):
        os.makedirs(crops_dir, exist_ok=True)
        ext = image.split(";", 1)[0].split("/", 1)[1]
        path = os.path.join(crops_dir, f"{f['key']}.{ext}")
        with open(path, "wb") as out:
            out.write(base64.b64decode(image.split(",", 1)[1]))
        p["imageCrop"] = os.path.relpath(path, HERE).replace("\\", "/")
    elif node.get("role") in ("img", "image", "graphics-document") or (node.get("native") or {}).get("tag") in ("img", "svg"):
        p["imageCrop"] = None
        p["imageNote"] = (node.get("native") or {}).get("imageSkipped") or "no crop in the snapshot"
    return p


def shown_by_default(f):
    """What `rampa check` shows at its default threshold: medium confidence or above, and not from an experimental check."""
    return LEVELS.get(f.get("confidence"), 0) >= LEVELS["medium"] and not f.get("experimental")


def all_findings(report):
    out = []
    for listed in ("findings", "belowThreshold", "beyondTarget"):
        for f in report.get(listed) or []:
            out.append({**f, "list": listed, "shown": shown_by_default(f)})
    return out


def kind_of(f):
    if f["source"] == "rule":
        return "rule"
    if f["source"] == "judgment":
        if f["criterion"] not in DEFAULT_CRITERIA:
            return "other-judgment"
        if f.get("experimental") or (f.get("subject") or "").startswith("hidden "):
            return "experimental-judgment"
        return "judgment"
    return f["source"]


def suggestion_row(s, origin, **extra):
    """A model's suggestion (an item of needsReview) in the shape of a judgment finding with no quote."""
    key = "s" + hashlib.sha256(f"{s['criterion']}|{s.get('ref')}|{s['message']}".encode("utf-8")).hexdigest()[:11]
    return {"fingerprint": key, "criterion": s["criterion"], "level": s.get("level"), "source": "judgment", "ruleId": None, "ref": s.get("ref"),
            "message": s["message"], "evidence": None, "subject": None, "patch": None, "confidence": None, "model": s.get("model"),
            "list": "needsReview", "shown": False, "suggestionEvidence": s.get("evidence"), "origin": origin, **extra}


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    only = set(sys.argv[1:])
    raw_path = os.path.join(HERE, "data", "findings-raw.json")
    rows = [r for r in (read_json(raw_path) if os.path.exists(raw_path) else []) if only and r["slug"] not in only]
    sample_path = os.path.join(HERE, "data", "suggestion-sample.json")
    suggestions = read_json(sample_path)["sample"] if os.path.exists(sample_path) else []
    draw_path = os.path.join(HERE, "data", "pass-draw.json")
    drawn = read_json(draw_path)["items"] if os.path.exists(draw_path) else []
    totals = {"packets": 0, "items": 0, "test": 0}
    for meta in pages():
        slug = meta["slug"]
        if only and slug not in only:
            continue
        base = page_dir(slug)
        report_path = os.path.join(base, "report.json")
        if not os.path.exists(report_path):
            continue
        snap_path = snapshot_file(os.path.join(base, "recording"))
        page = Page(read_json(snap_path))
        main_report = read_json(report_path)
        main_findings = all_findings(main_report)
        for f in main_findings:
            f["origin"] = "main"
        items = list(main_findings)
        ablation = {}
        for run in ("noconfirm", "noverify"):
            path = os.path.join(base, f"{run}-report.json")
            if not os.path.exists(path):
                continue
            # Read only to word a drawn pass-sample claim (below); the ablations' own findings are not labelled.
            ablation[run] = read_json(path)
        items += [suggestion_row(s, "suggestion-sample", sampleReason=s.get("reason")) for s in suggestions if s["slug"] == slug]
        # The pass sample: an item already here is marked; otherwise a row in Rampa's own words, or with no claim.
        for d in (d for d in drawn if d["slug"] == slug):
            same = [f for f in items if f["criterion"] == d["criterion"] and f.get("ref") == d["ref"] and f["source"] == "judgment"]
            if same:
                for f in same:
                    f["passStratum"], f["passRank"] = d["stratum"], d["rank"]
                continue
            if d["stratum"] == "passed":
                key = "p" + hashlib.sha256(f"{d['criterion']}|{d['ref']}".encode("utf-8")).hexdigest()[:11]
                items.append({"fingerprint": key, "criterion": d["criterion"], "source": "judgment", "ruleId": None, "ref": d["ref"], "message": None,
                              "evidence": None, "subject": None, "list": None, "shown": False, "origin": "pass-sample", "passStratum": "passed", "passRank": d["rank"]})
                continue
            words = None
            for run, report in (("main", main_report), ("noconfirm", ablation.get("noconfirm") or {}), ("noverify", ablation.get("noverify") or {})):
                found = [f for f in all_findings(report) if f["criterion"] == d["criterion"] and f.get("ref") == d["ref"] and f["source"] == "judgment"]
                if found and run != "main":
                    words = {**found[0], "origin": "pass-sample", "claimFrom": f"{run} finding"}
                    break
                review = [s for s in report.get("needsReview") or [] if s.get("model") and s.get("criterion") == d["criterion"] and s.get("ref") == d["ref"]]
                if review:
                    words = suggestion_row(review[0], "pass-sample", claimFrom=f"{run} suggestion")
                    break
            if words is None:
                sys.exit(f"{slug}: no words for the drawn {d['stratum']} item {d['criterion']} {d['ref']}")
            words["passStratum"], words["passRank"] = d["stratum"], d["rank"]
            items.append(words)
        seen = {}
        for f in items:
            k = f["fingerprint"]
            seen[k] = seen.get(k, 0) + 1
            f["key"] = k if seen[k] == 1 else f"{k}-{seen[k]}"
            f["kind"] = kind_of(f)
        labelled = [f for f in items if f["kind"] in ("judgment", "experimental-judgment", "rule", "other-judgment")]
        order = list(labelled)
        random.Random(f"{SEED}:{slug}").shuffle(order)
        folder = os.path.join(HERE, "packets", slug)
        if os.path.isdir(folder):
            shutil.rmtree(folder)
        packet_rows = [packet_row(f, page, folder) for f in order]
        if not packet_rows:
            continue
        os.makedirs(folder, exist_ok=True)
        shutil.copyfile(snap_path, os.path.join(folder, "snapshot.json"))
        shot = os.path.join(base, "main-screenshot.png")
        if os.path.exists(shot):
            shutil.copyfile(shot, os.path.join(folder, "screenshot.png"))
        write_json(os.path.join(HERE, "packets", f"{slug}.json"), {
            "page": meta["url"], "slug": slug, "run": "default", "title": page.snapshot.get("title"), "language": page.snapshot.get("locale"),
            "snapshot": f"packets/{slug}/snapshot.json", "screenshot": f"packets/{slug}/screenshot.png",
            "collectedAt": page.snapshot.get("collectedAt"), "findings": packet_rows,
        })
        for f in labelled:
            rows.append({"slug": slug, "split": meta["split"], "block": meta["block"], "run": "default", "packet": slug, **{k: f.get(k) for k in FIELDS}})
        totals["packets"] += 1
        totals["items"] += len(labelled)
        totals[meta["split"]] += len(labelled)
    write_json(raw_path, rows)
    print(f"{totals['packets']} packets, {totals['items']} items")


if __name__ == "__main__":
    main()
