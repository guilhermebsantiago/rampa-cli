"""Build the judges' evidence packets for the ninth real-page study (pre-registration, section 3, "Labels", and section 5).

The eighth study's packets.py with this study's seed and folders, without the samples this round does not draw (no pass
sample, no suggestion sample, no X6 sample: the recall audit takes the pass sample's place), and with fast-mode packets.

Main-mode packets, all 72 pages: packets/<slug>.json holds every judgment and rule finding of the main run
(DATA/pages/<slug>/report.json), at any confidence, in one form and in an order shuffled with
random.Random("202611259:<slug>"); engine (axe-core) findings are not labelled, as in every study.

Fast-mode packets, the 36 test pages (pre-registration, section 5, the reuse rule): every finding of the primary
population (common.primary_judged: a judgment finding of the eight default criteria, not experimental, at medium
confidence or above) of the fast run (DATA/pages/<slug>/fast-report.json) is matched against the main run's labelled items
of the same page: a fast finding with the same fingerprint (criterion, element and subject) and the same claim kind
(Finding.claim) as a main-run judgment finding is the same claim on the same element and reuses that item's label; every
other one is a row of packets/<slug>--fast.json, built from the fast snapshot and the fast screenshot, shuffled with
random.Random("202611259:<slug>--fast"). The fast packets' "run" field reads "default", as the main packets' does, so that
no packet says which run reported a finding. The match of every fast finding (test and dev) is written to
data/fast-reuse.json; dev-half fast findings are counted, not labelled.

No confidence, patch, run name or suggestion quote is in a packet. The image crop the model saw is written to
packets/<packet>/<key>.<ext>, and the snapshot and screenshot are copied to packets/<packet>/snapshot.json and
packets/<packet>/screenshot.png (out of git), so that no judge opens the recordings folder.

Writes data/findings-raw.json (one row per labelled item, with run, origin, confidence and patch for the analysis) and
data/fast-reuse.json; prints counts only. Run: python -I study/round-9-2026-11-25/scripts/packets.py
"""
import base64
import os
import random
import re
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import DEFAULT_CRITERIA, HERE, page_dir, pages, primary_judged, read_json, shown_by_default, snapshot_file, write_json  # noqa: E402

SEED = "202611259"
FIELDS = ("key", "fingerprint", "run", "origin", "criterion", "level", "source", "ruleId", "kind", "list", "shown", "experimental",
          "confidence", "ref", "subject", "message", "evidence", "patch", "html", "agreement", "model", "confirmation", "claim", "techniques")


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


def keyed(items):
    seen = {}
    for f in items:
        k = f["fingerprint"]
        seen[k] = seen.get(k, 0) + 1
        f["key"] = k if seen[k] == 1 else f"{k}-{seen[k]}"
        f["kind"] = kind_of(f)


def write_packet(name, meta, page, snap_path, shot, items):
    order = list(items)
    random.Random(f"{SEED}:{name}").shuffle(order)
    folder = os.path.join(HERE, "packets", name)
    if os.path.isdir(folder):
        shutil.rmtree(folder)
    rows = [packet_row(f, page, folder) for f in order]
    if not rows:
        return False
    os.makedirs(folder, exist_ok=True)
    shutil.copyfile(snap_path, os.path.join(folder, "snapshot.json"))
    if shot and os.path.exists(shot):
        shutil.copyfile(shot, os.path.join(folder, "screenshot.png"))
    write_json(os.path.join(HERE, "packets", f"{name}.json"), {
        "page": meta["url"], "slug": meta["slug"], "run": "default", "title": page.snapshot.get("title"), "language": page.snapshot.get("locale"),
        "snapshot": f"packets/{name}/snapshot.json", "screenshot": f"packets/{name}/screenshot.png",
        "collectedAt": page.snapshot.get("collectedAt"), "findings": rows,
    })
    return True


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    rows, reuse = [], []
    totals = {"packets": 0, "items": 0, "test": 0, "dev": 0, "fastPackets": 0, "fastRows": 0, "fastReused": 0, "fastDevCounted": 0}
    for meta in pages():
        slug = meta["slug"]
        base = page_dir(slug)
        report_path = os.path.join(base, "report.json")
        if not os.path.exists(report_path):
            continue
        snap_path = snapshot_file(os.path.join(base, "recording"))
        page = Page(read_json(snap_path))
        main_items = all_findings(read_json(report_path))
        for f in main_items:
            f["origin"], f["run"] = "main", "main"
        keyed(main_items)
        labelled = [f for f in main_items if f["kind"] in ("judgment", "experimental-judgment", "rule", "other-judgment")]
        if write_packet(slug, meta, page, snap_path, os.path.join(base, "main-screenshot.png"), labelled):
            totals["packets"] += 1
        for f in labelled:
            rows.append({"slug": slug, "split": meta["split"], "block": meta["block"], "packet": slug, **{k: f.get(k) for k in FIELDS}})
        totals["items"] += len(labelled)
        totals[meta["split"]] += len(labelled)
        # Fast mode: the primary population of the fast run, matched against the main run's judgment items by fingerprint and claim.
        fast_path = os.path.join(base, "fast-report.json")
        if not os.path.exists(fast_path):
            continue
        by_claim = {}
        for f in labelled:
            if f["source"] == "judgment":
                by_claim.setdefault((f["fingerprint"], f.get("claim")), []).append(f)
        fast_items = [f for f in all_findings(read_json(fast_path)) if primary_judged(f)]
        own = []
        for f in fast_items:
            f["origin"], f["run"] = "fast", "fast"
            same = by_claim.get((f["fingerprint"], f.get("claim")), [])
            entry = {"slug": slug, "split": meta["split"], "block": meta["block"], "fingerprint": f["fingerprint"], "criterion": f["criterion"],
                     "claim": f.get("claim"), "ref": f.get("ref"), "confidence": f.get("confidence")}
            if meta["split"] != "test":
                entry["labelFrom"] = None
                entry["note"] = "dev half: counted, not labelled"
                totals["fastDevCounted"] += 1
            elif same:
                entry["labelFrom"] = {"packet": slug, "key": same[0]["key"], "matches": len(same)}
                totals["fastReused"] += 1
            else:
                own.append(f)
                entry["labelFrom"] = "own row"
            reuse.append(entry)
        if own:
            name = f"{slug}--fast"
            keyed(own)
            for f, entry in zip(own, [e for e in reuse if e["slug"] == slug and e.get("labelFrom") == "own row"]):
                entry["labelFrom"] = {"packet": name, "key": f["key"]}
            fast_snap = snapshot_file(os.path.join(base, "fast-recording"))
            fast_page = Page(read_json(fast_snap))
            if write_packet(name, meta, fast_page, fast_snap, os.path.join(base, "fast-screenshot.png"), own):
                totals["fastPackets"] += 1
            for f in own:
                rows.append({"slug": slug, "split": meta["split"], "block": meta["block"], "packet": name, **{k: f.get(k) for k in FIELDS}})
            totals["fastRows"] += len(own)
    write_json(os.path.join(HERE, "data", "findings-raw.json"), rows)
    write_json(os.path.join(HERE, "data", "fast-reuse.json"), {
        "note": ("Every primary-population finding of the fast run (pre-registration, section 5): on a test page, the label it takes, "
                 "either a main-run item with the same fingerprint and claim (labelFrom.packet is the page's main packet) or its own "
                 "row of the page's fast packet; on a dev page, counted only."),
        "counts": {k: totals[k] for k in ("fastPackets", "fastRows", "fastReused", "fastDevCounted")}, "findings": reuse})
    print(f"{totals['packets']} main packets, {totals['items']} items ({totals['test']} test, {totals['dev']} dev); "
          f"fast: {totals['fastReused']} test findings reuse a main label, {totals['fastRows']} own rows in {totals['fastPackets']} packets, "
          f"{totals['fastDevCounted']} dev findings counted")


if __name__ == "__main__":
    main()
