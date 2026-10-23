"""Build the judges' evidence packets for the third real-page study.

The second study's packets.py (study/fresh-2026-10-11/scripts/packets.py) with one change: a packet no longer
holds Rampa's confidence or suggested patch for a finding (see packet()). Everything else is the same.

For every page with a judged report:

- pages/<slug>/report.json, the default run on the saved snapshot: every judgment finding and every rule
  finding, at any confidence (the run used --min-confidence low), goes to packets/<slug>.json. Engine
  (axe-core) findings are not labelled, as in the first study.
- pages/<slug>/probe-report.json, the probe run on the probe subset: every probe finding, and every judgment
  of a criterion the default run does not judge (a probe's own question, such as 2.1.4), goes to
  packets/<slug>--probe.json. The default criteria's judgments and the rules of that run repeat the default
  run on another load of the page, so they are not labelled again.

Each finding gets a key: its fingerprint, with -2, -3... when a report repeats one. The image crop the model
saw is written to packets/<name>/<key>.png.

Writes data/findings-raw.json (one row per labelled finding). Run: python -I study/round-3-2026-10-23/scripts/packets.py [slug ...]
"""

import base64
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_CRITERIA = ("1.1.1", "1.3.5", "2.4.2", "2.4.4", "2.4.6", "3.1.1", "3.1.2", "3.3.2")
LEVELS = {"low": 0, "medium": 1, "high": 2}


def read_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")


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
        "browserName": (node.get("ax") or {}).get("name"),
        "text": short(node.get("text"), 400) or None,
        "states": node.get("states"),
        "bounds": node.get("bounds"),
        "tag": native.get("tag"),
        "attributes": {k: short(str(v), 300) for k, v in (native.get("attributes") or {}).items()},
        "html": short(native.get("html"), 1500) or None,
        "readingText": short(native.get("readingText"), 600) or None,
        "imageSkipped": native.get("imageSkipped"),
    }


def probe_records(snapshot, finding):
    """What the probe run recorded that names this finding's element: each record's kind and conditions,
    and the items of it that cite the element's ref, trimmed."""
    ref = finding.get("ref")
    out = []
    for record in ((snapshot.get("observations") or {}).get("probes") or []):
        text = json.dumps(record, ensure_ascii=False)
        if ref and ref not in text:
            continue
        items = []

        def visit(value, path):
            if len(items) >= 6:
                return
            if isinstance(value, dict):
                if ref and any(v == ref for v in value.values() if isinstance(v, str)):
                    items.append({"path": path, "item": json.loads(short(json.dumps(value, ensure_ascii=False), 1500)) if len(json.dumps(value)) < 1500 else short(json.dumps(value, ensure_ascii=False), 1500)})
                    return
                for k, v in value.items():
                    if k in ("image", "png", "screenshot", "frames") and isinstance(v, str):
                        continue
                    visit(v, f"{path}.{k}")
            elif isinstance(value, list):
                for i, v in enumerate(value):
                    visit(v, f"{path}[{i}]")
        visit(record, "")
        out.append({"kind": record.get("kind"), "conditions": record.get("conditions"), "itemsNamingTheElement": items})
        if len(out) >= 4:
            break
    return out


def packet(f, page, crops_dir, probe=False):
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
        # The one change from the second study's packets: Rampa's own confidence and suggested patch are left
        # out, since an audit of that study named them as an anchor toward Rampa's answer. data/findings-raw.json
        # keeps both for the analysis; the judges are told not to open it.
        "html": short(f.get("html"), 1500) or None,
    }
    node = page.by_ref.get(f.get("ref") or "")
    if f["criterion"] in ("2.4.2", "3.1.1") or f.get("ref") == "html":
        p["page"] = {
            "title": snap.get("title"),
            "url": snap["target"],
            "lang": ((page.order[0].get("native") or {}).get("attributes") or {}).get("lang"),
            "h1": [short(subtree_text(n, 200), 200) for n in page.order if n.get("role") == "heading" and n["native"].get("tag") == "h1"][:5],
        }
    if probe:
        p["probeRecords"] = probe_records(snap, f)
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
        ancestors.append({"role": a.get("role"), "tag": a["native"].get("tag"), "name": short(a.get("name"), 150) or None, "text": text})
        if len(ancestors) == 5:
            break
    p["ancestors"] = ancestors
    p["headingsNear"] = page.headings_near(node)
    link = next((n for n in [node, *page.ancestors(node)] if n.get("role") == "link"), None)
    if link is not None:
        attrs = link["native"].get("attributes") or {}
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
    elif node.get("role") in ("img", "image", "graphics-document") or node["native"].get("tag") in ("img", "svg"):
        p["imageCrop"] = None
        p["imageNote"] = node["native"].get("imageSkipped") or "no crop in the snapshot"
    return p


def keyed(findings):
    seen = {}
    for f in findings:
        k = f["fingerprint"]
        seen[k] = seen.get(k, 0) + 1
        f["key"] = k if seen[k] == 1 else f"{k}-{seen[k]}"
    return findings


def shown_by_default(f):
    """What `rampa check` shows at its default threshold (src/core/check.ts): medium confidence or above, and not
    from an experimental check, whatever confidence that check gives (a probe's finding may say high)."""
    return LEVELS.get(f.get("confidence"), 0) >= LEVELS["medium"] and not f.get("experimental")


def all_findings(report):
    out = []
    for listed, group in (("findings", report.get("findings", [])), ("belowThreshold", report.get("belowThreshold", [])), ("beyondTarget", report.get("beyondTarget", []))):
        for f in group:
            out.append({**f, "list": listed, "shown": shown_by_default(f)})
    return out


def kind_of(f, probe_run):
    if f["source"] == "probe":
        return "probe"
    if f["source"] == "rule":
        return "rule"
    if f["source"] == "judgment":
        if f["criterion"] not in DEFAULT_CRITERIA:
            return "probe-judgment" if probe_run else "other-judgment"
        if f.get("experimental") or (f.get("subject") or "").startswith("hidden "):
            return "experimental-judgment"
        return "judgment"
    return "engine"


def snapshot_file(directory):
    return next((os.path.join(directory, n) for n in sorted(os.listdir(directory)) if n.endswith(".snapshot.json")), None)


def main():
    meta = read_json(os.path.join(HERE, "data", "pages-input.json"))
    only = set(sys.argv[1:])
    raw_path = os.path.join(HERE, "data", "findings-raw.json")
    rows = [r for r in (read_json(raw_path) if os.path.exists(raw_path) else []) if only and r["slug"] not in only]
    for page_meta in meta["pages"]:
        slug = page_meta["slug"]
        if only and slug not in only:
            continue
        base = os.path.join(HERE, "pages", slug)
        for run, report_name, rec_dir, packet_name in (("default", "report.json", "recording", slug), ("probe", "probe-report.json", "probe-recording", f"{slug}--probe")):
            report_path = os.path.join(base, report_name)
            if not os.path.exists(report_path):
                continue
            report = read_json(report_path)
            snap_path = snapshot_file(os.path.join(base, rec_dir))
            page = Page(read_json(snap_path))
            findings = keyed(all_findings(report))
            for f in findings:
                f["kind"] = kind_of(f, run == "probe")
            if run == "default":
                labelled = [f for f in findings if f["kind"] in ("judgment", "experimental-judgment", "rule", "other-judgment", "probe")]
            else:
                labelled = [f for f in findings if f["kind"] in ("probe", "probe-judgment")]
            crops = os.path.join(HERE, "packets", packet_name)
            packets = [packet(f, page, crops, probe=(run == "probe")) for f in labelled]
            print(f"{packet_name}: {len(findings)} findings, {len(labelled)} to label ({sum(1 for f in labelled if f['shown'])} at the default threshold)")
            if not packets:
                continue
            write_json(os.path.join(HERE, "packets", f"{packet_name}.json"), {
                "page": page_meta["url"],
                "slug": slug,
                "run": run,
                "title": page.snapshot.get("title"),
                "language": page.snapshot.get("locale"),
                "snapshot": os.path.relpath(snap_path, HERE).replace("\\", "/"),
                "screenshot": f"pages/{slug}/{'main' if run == 'default' else 'probe'}-screenshot.png",
                "collectedAt": page.snapshot.get("collectedAt"),
                "findings": packets,
            })
            for f in labelled:
                rows.append({"slug": slug, "split": page_meta["split"], "run": run, "packet": packet_name,
                             **{k: f.get(k) for k in ("key", "fingerprint", "criterion", "level", "source", "ruleId", "kind", "list", "shown", "experimental",
                                                      "confidence", "ref", "subject", "message", "evidence", "patch", "html", "agreement", "model")}})
    write_json(raw_path, rows)


if __name__ == "__main__":
    main()
