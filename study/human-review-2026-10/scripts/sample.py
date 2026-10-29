"""Draws the human-review sample and writes the two blind packages Rampa Lab's review mode loads.

  python -I study/human-review-2026-10/scripts/sample.py [--recordings DIR]

Reads the three studies' data/findings.json and data/pages.json (study/round-3-2026-10-23, round-4-2026-10-24,
round-5-2026-10-28) and, for the snapshots and screenshots, the recordings backup (default
C:/Users/guilh/dev/rampa-study-recordings, or $RECORDINGS). The rule and the seed are in common.py and
docs/studies/human-review-plan.md.

Writes, under study/human-review-2026-10/:
  data/sample.json                         the manifest: which finding each item is (no Claude label)
  pacote-100/data/findings.json, pages.json  the 100 items, blind, in the seeded order
  pacote-100/snapshots/<slug>.snapshot.json  each page's snapshot, cut down to the sampled elements and their ancestors
  pacote-100/contexto/<fingerprint>.jpg       the element in the page's screenshot, outlined, when it is on screen
  pacote-30/...                               the same for the second person's 30
The LEIA-ME.md files are written by hand and left alone.

A finding in a package keeps only what the Lab shows as the claim and the element: slug, fingerprint, criterion,
source, ruleId, message, evidence, ref, html, with a neutral fingerprint (common.package_fingerprint). Left out: the judges' labels, causes and rationales, the final label,
Rampa's confidence, its suggested fix (patch) and suggested text, the list it was reported in, the half, the origin
and the claim kind. The script then checks the written files for any of those keys, any judge's rationale and the
label values, and stops if one is there.
"""

import argparse
import glob
import json
import os
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402

BLIND_KEYS = ("slug", "fingerprint", "criterion", "source", "ruleId", "message", "evidence", "ref", "html")
FORBIDDEN_KEYS = {"label", "final", "finalCause", "auditor", "skeptic", "agreed", "rationale", "cause", "confidence", "patch",
                  "confirmation", "suggestionEvidence", "cut090", "sampleReason", "origin", "claim", "shown", "split", "experimental",
                  "group", "kind", "packet", "run", "key", "level", "subject"}
SNAPSHOT_TOP = ("schemaVersion", "surface", "target", "title", "locale", "viewport", "collectedAt", "collector")
PACKAGES = (("pacote-100", "all"), ("pacote-30", "second"))
# The element's context in the screenshot: margins around it and the largest region kept, in CSS pixels (scale 1).
MARGIN = {"left": 320, "right": 320, "top": 240, "bottom": 360}
MAX_W, MAX_H = 1280, 960
OUTLINE = (230, 0, 160)


def recording_dir(recordings, sid):
    folder = next(s[2] for s in common.STUDIES if s[0] == sid)
    return os.path.join(recordings, folder)


def snapshot_path(recordings, sid, slug):
    found = sorted(glob.glob(os.path.join(recording_dir(recordings, sid), "pages", slug, "recording", "*.snapshot.json")))
    if len(found) != 1:
        raise SystemExit(f"{sid}/{slug}: expected one snapshot in the recordings, found {len(found)}")
    return found[0]


def index_snapshot(snapshot):
    """ref -> (node, parent ref), walked without recursion."""
    nodes, stack = {}, [(snapshot["root"], None)]
    while stack:
        node, parent = stack.pop()
        ref = node.get("ref")
        if isinstance(ref, str) and ref not in nodes:
            nodes[ref] = (node, parent)
        for child in reversed(node.get("children") or []):
            stack.append((child, ref))
    return nodes


def prune(snapshot, refs):
    """The snapshot with only the given elements and their ancestors (every field the Lab reads kept), and the
    destinations of the links among them. Returns the pruned snapshot and the refs it could not find."""
    nodes = index_snapshot(snapshot)
    keep, missing = set(), []
    for ref in refs:
        if ref not in nodes:
            missing.append(ref)
            continue
        at = ref
        while at is not None and at not in keep:
            keep.add(at)
            at = nodes[at][1]
    targets = set(refs)

    def copy(node):
        out = {k: v for k, v in node.items() if k != "children"}
        if node["ref"] not in targets and isinstance(out.get("native"), dict) and "langText" in out["native"]:
            out["native"] = {k: v for k, v in out["native"].items() if k != "langText"}
        kids = [c for c in node.get("children") or [] if c.get("ref") in keep]
        if kids:
            out["children"] = [copy(c) for c in kids]
        return out

    hrefs = set()
    for ref in keep:
        attrs = (nodes[ref][0].get("native") or {}).get("attributes") or {}
        if isinstance(attrs.get("href"), str):
            hrefs.add(attrs["href"])
    destinations = {h: d for h, d in (snapshot.get("destinations") or {}).items() if h in hrefs}
    out = {k: snapshot[k] for k in SNAPSHOT_TOP if k in snapshot}
    out["prunedFor"] = "Rampa human review 2026-10: only the sampled elements, their ancestors and the destinations of their links are kept."
    out["root"] = copy(snapshot["root"])
    out["destinations"] = destinations
    return out, missing, nodes


def context_image(screenshot, bounds, out_path):
    """The element in the page's screenshot with a margin around it, outlined. Returns False when it is not on it."""
    from PIL import Image, ImageDraw

    if not bounds:
        return False
    x, y, w, h = (bounds.get(k) for k in ("x", "y", "width", "height"))
    if None in (x, y, w, h) or w < 1 or h < 1:
        return False
    W, H = screenshot.size
    if x >= W or y >= H or x + w <= 0 or y + h <= 0:
        return False
    left, top = max(0, x - MARGIN["left"]), max(0, y - MARGIN["top"])
    right, bottom = min(W, x + w + MARGIN["right"]), min(H, y + h + MARGIN["bottom"])
    if right - left > MAX_W:
        centre = x + w / 2
        left = max(0, min(W - MAX_W, centre - MAX_W / 2))
        right = left + MAX_W
    if bottom - top > MAX_H:
        top = max(0, y - 60) if h > MAX_H - 120 else max(0, min(H - MAX_H, y + h / 2 - MAX_H / 2))
        bottom = min(H, top + MAX_H)
    box = tuple(int(round(v)) for v in (left, top, right, bottom))
    region = screenshot.crop(box).convert("RGB")
    draw = ImageDraw.Draw(region)
    ox, oy = x - box[0], y - box[1]
    draw.rectangle([ox - 4, oy - 4, ox + w + 3, oy + h + 3], outline=OUTLINE, width=3)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    region.save(out_path, "JPEG", quality=82, optimize=True)
    return True


def blind_row(r, html_fallback):
    row = {k: r.get(k) for k in BLIND_KEYS}
    row["fingerprint"] = common.package_fingerprint(r)
    if not row.get("html") and html_fallback:
        row["html"] = html_fallback
    return row


def scan(value, path, found):
    if isinstance(value, dict):
        for k, v in value.items():
            if k in FORBIDDEN_KEYS:
                found.append(f"{path}.{k}")
            scan(v, f"{path}.{k}", found)
    elif isinstance(value, list):
        for i, v in enumerate(value):
            scan(v, f"{path}[{i}]", found)


def check_blind(package_dir, rows):
    """Stops if a package file holds a forbidden key, a judge's rationale or a label value; warns on Rampa's suggested text."""
    problems, warnings = [], []
    rationales = set()
    suggested = {}
    for r in rows:
        for who in ("auditor", "skeptic"):
            text = ((r.get(who) or {}).get("rationale") or "").strip()
            if len(text) >= 40:
                rationales.add(text[:60])
        to = ((r.get("patch") or {}).get("to") or "").strip()
        if len(to) >= 12:
            suggested[to] = common.item_id(r)
    for path in glob.glob(os.path.join(package_dir, "**", "*.json"), recursive=True):
        with open(path, encoding="utf-8") as f:
            text = f.read()
        name = os.path.relpath(path, package_dir)
        if os.path.basename(os.path.dirname(path)) == "data":
            found = []
            scan(json.loads(text), name, found)
            problems += [f"forbidden key {k}" for k in found]
        for word in ("true_positive", "false_positive"):
            if word in text:
                problems.append(f"{name}: holds the label value {word}")
        for start in rationales:
            if start in text:
                problems.append(f"{name}: holds a judge's rationale ({start[:30]}...)")
        if name.startswith("snapshots"):
            continue
        for to, who in suggested.items():
            if json.dumps(to, ensure_ascii=False)[1:-1] in text:
                warnings.append(f"{name}: holds Rampa's suggested text for {who}")
    return problems, warnings


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--recordings", default=os.environ.get("RECORDINGS", "C:/Users/guilh/dev/rampa-study-recordings"))
    args = ap.parse_args()
    from PIL import Image

    Image.MAX_IMAGE_PIXELS = None  # the studies' own full-page screenshots, some over 200 million pixels

    rows, urls = common.load_studies()
    sample = common.draw(rows)
    second = {common.item_id(r) for r in common.second_subsample(sample)}
    ordered = common.package_order(sample)
    by_page = {}
    for r in ordered:
        by_page.setdefault((r["study"], r["slug"]), []).append(r)
    slugs = {}
    for sid, slug in by_page:
        if slug in slugs and slugs[slug] != sid:
            raise SystemExit(f"slug {slug} is in two studies")
        slugs[slug] = sid
    if len({urls[k] for k in by_page}) != len(by_page):
        raise SystemExit("two sampled pages share an address")

    # Snapshots, cut per package, and the context images.
    report = {"missingRefs": [], "noContext": [], "pages": len(by_page)}
    html_fallback, context = {}, {}
    pruned = {name: {} for name, _ in PACKAGES}
    for (sid, slug), items in sorted(by_page.items()):
        snapshot = common.read_json(snapshot_path(args.recordings, sid, slug))
        if snapshot["target"].rstrip("/") != urls[(sid, slug)].rstrip("/"):
            raise SystemExit(f"{sid}/{slug}: snapshot target {snapshot['target']} is not {urls[(sid, slug)]}")
        for name, which in PACKAGES:
            refs = [r["ref"] for r in items if which == "all" or common.item_id(r) in second]
            if refs:
                cut, missing, nodes = prune(snapshot, refs)
                pruned[name][slug] = cut
        _, missing, nodes = prune(snapshot, [r["ref"] for r in items])
        shot_path = os.path.join(recording_dir(args.recordings, sid), "pages", slug, "main-screenshot.png")
        shot = Image.open(shot_path) if os.path.exists(shot_path) else None
        if shot is not None:
            shot.load()
        for r in items:
            iid = common.item_id(r)
            node = nodes.get(r["ref"], (None, None))[0]
            if node is None:
                report["missingRefs"].append(iid)
                html_fallback[iid] = (r.get("patch") or {}).get("before")
            ok = False
            if shot is not None and node is not None:
                ok = context_image(shot, node.get("bounds"), os.path.join(common.FOLDER, "pacote-100", "contexto", f"{common.package_fingerprint(r)}.jpg"))
            context[iid] = ok
            if not ok:
                report["noContext"].append(iid)
        if shot is not None:
            shot.close()

    # The packages.
    for name, which in PACKAGES:
        base = os.path.join(common.FOLDER, name)
        for sub in ("data", "snapshots") + (("contexto",) if name != "pacote-100" else ()):
            shutil.rmtree(os.path.join(base, sub), ignore_errors=True)
        items = [r for r in ordered if which == "all" or common.item_id(r) in second]
        common.write_json(os.path.join(base, "data", "findings.json"), [blind_row(r, html_fallback.get(common.item_id(r))) for r in items])
        pages = []
        for r in items:
            if not any(p["slug"] == r["slug"] for p in pages):
                pages.append({"slug": r["slug"], "url": urls[(r["study"], r["slug"])]})
        common.write_json(os.path.join(base, "data", "pages.json"), pages)
        for slug, cut in sorted(pruned[name].items()):
            common.write_json(os.path.join(base, "snapshots", f"{slug}.snapshot.json"), cut)
        if name != "pacote-100":
            for r in items:
                fp = common.package_fingerprint(r)
                if context[common.item_id(r)]:
                    os.makedirs(os.path.join(base, "contexto"), exist_ok=True)
                    shutil.copyfile(os.path.join(common.FOLDER, "pacote-100", "contexto", f"{fp}.jpg"), os.path.join(base, "contexto", f"{fp}.jpg"))
    # Context images of items no longer drawn (none on a first run) go.
    keys = {common.package_fingerprint(r) for r in sample}
    if len(keys) != len(sample):
        raise SystemExit("two items share a package fingerprint")
    for path in glob.glob(os.path.join(common.FOLDER, "pacote-100", "contexto", "*.jpg")):
        if os.path.basename(path)[:-4] not in keys:
            os.remove(path)

    # The manifest: which finding each item is. No Claude label, and no stratum (it would name one).
    position = {common.item_id(r): i + 1 for i, r in enumerate(ordered)}
    manifest = {
        "seed": common.SEED,
        "rule": "docs/studies/human-review-plan.md and study/human-review-2026-10/scripts/common.py",
        "studies": {s[0]: f"study/{s[1]}" for s in common.STUDIES},
        "counts": {"items": len(sample), "second": len(second), "pages": len(by_page)},
        "items": [
            {
                "id": common.item_id(r),
                "study": r["study"],
                "slug": r["slug"],
                "key": r["key"],
                "fingerprint": common.package_fingerprint(r),
                "page": urls[(r["study"], r["slug"])],
                "part": r["part"],
                "criterion": r["criterion"],
                "claimKind": common.claim_kind(r),
                "split": r["split"],
                "second": common.item_id(r) in second,
                "order": position[common.item_id(r)],
                "context": context[common.item_id(r)],
            }
            for r in ordered
        ],
        "notes": {
            "missingRefs": sorted(report["missingRefs"]),
            "noContextImage": sorted(report["noContext"]),
        },
    }
    common.write_json(common.MANIFEST, manifest)

    failed = False
    for name, _ in PACKAGES:
        problems, warnings = check_blind(os.path.join(common.FOLDER, name), rows)
        for p in problems:
            print(f"BLINDNESS {name}: {p}", file=sys.stderr)
        for w in warnings:
            print(f"warning {name}: {w}", file=sys.stderr)
        failed = failed or bool(problems)
    print(f"items {len(sample)}, second person {len(second)}, pages {len(by_page)}; "
          f"elements not in their snapshot {len(report['missingRefs'])}, without a context image {len(report['noContext'])}")
    if failed:
        raise SystemExit("the packages are not blind; see above")


if __name__ == "__main__":
    main()
