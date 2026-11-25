"""The SHA-256 manifest of the captures and model responses the ninth study keeps locally and does not publish
(pre-registration, section 9): for every page, every file of its recordings (recording/, fast-recording/: snapshots and
engine results), its screenshots, its model caches (cache/, cache-fast/, and the optional T4 runs' caches: every model
response Rampa stored), its full reports and its consoles, all in DATA (C:/Users/guilh/dev/rampa-study-recordings/round-9).
A copy of those files can be checked against data/captures-manifest.json later. The eighth study's hashes.py, extended
from the recordings and screenshot to every file a page's runs wrote.

Run: python -I study/round-9-2026-11-25/scripts/hashes.py
"""
import hashlib
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import DATA, HERE, page_dir, pages, write_json  # noqa: E402


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def kind(rel):
    top = rel.split("/", 1)[0]
    if top in ("recording", "fast-recording"):
        return "capture"
    if top.endswith(".png"):
        return "screenshot"
    if top.startswith("cache"):
        return "model-responses"
    if top.endswith("console.txt") or "console" in top:
        return "console"
    if top.endswith(".json"):
        return "report"
    return "other"


rows = []
for page in pages():
    base = page_dir(page["slug"])
    if not os.path.isdir(base):
        continue
    for root, dirs, names in os.walk(base):
        dirs.sort()
        if os.path.relpath(root, base).replace("\\", "/").split("/")[0] == ".rampa":
            continue
        for name in sorted(names):
            path = os.path.join(root, name)
            rel = os.path.relpath(path, base).replace("\\", "/")
            rows.append({"slug": page["slug"], "file": f"pages/{page['slug']}/{rel}", "kind": kind(rel), "bytes": os.path.getsize(path),
                         "sha256": sha256(path)})
totals = {}
for r in rows:
    t = totals.setdefault(r["kind"], {"files": 0, "bytes": 0})
    t["files"] += 1
    t["bytes"] += r["bytes"]
combined = hashlib.sha256("".join(f"{r['file']}\t{r['sha256']}\n" for r in rows).encode("utf-8")).hexdigest()
write_json(os.path.join(HERE, "data", "captures-manifest.json"), {
    "note": ("SHA-256 of every file the ninth study's runs wrote per page, kept locally in DATA and not published (pre-registration, "
             "section 9: several hundred MB of third-party page content). Paths are relative to DATA."),
    "data": DATA.replace("\\", "/"), "files": len(rows), "bytes": sum(r["bytes"] for r in rows), "byKind": totals,
    "combinedSha256": combined, "rows": rows}, indent=0)
print(f"{len(rows)} files, {sum(r['bytes'] for r in rows) / 1e6:.1f} MB, combined {combined}")
