"""Record the size and SHA-256 of every recording and screenshot file the study judged, which git does not keep (they are
in DATA). A copy of DATA/pages/<slug>/recording/ can be checked against data/recordings.json before its judgments are
read back offline. The fifth study's hashes.py, with the sixth study's folders.

Run: python -I study/round-6-2026-10-29/scripts/hashes.py
"""
import hashlib
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import HERE, page_dir, pages, write_json  # noqa: E402


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


out = []
for page in pages():
    base = page_dir(page["slug"])
    for sub in ("recording", "fast-recording"):
        d = os.path.join(base, sub)
        if os.path.isdir(d):
            for name in sorted(os.listdir(d)):
                path = os.path.join(d, name)
                out.append({"slug": page["slug"], "file": f"pages/{page['slug']}/{sub}/{name}", "bytes": os.path.getsize(path), "sha256": sha256(path)})
    path = os.path.join(base, "main-screenshot.png")
    if os.path.exists(path):
        out.append({"slug": page["slug"], "file": f"pages/{page['slug']}/main-screenshot.png", "bytes": os.path.getsize(path), "sha256": sha256(path)})
write_json(os.path.join(HERE, "data", "recordings.json"), out)
print(f"{len(out)} files, {sum(r['bytes'] for r in out) / 1e6:.1f} MB")
