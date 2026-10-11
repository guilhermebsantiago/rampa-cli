"""Record the size and SHA-256 of every recording file the study judged, which git does not keep.

A copy of pages/<slug>/recording/ (and probe-recording/) can be checked against data/recordings.json before
the judgments are re-run offline on it: `rampa check <copy>/<slug>.snapshot.json --model ...` reads the
snapshot and the engine results next to it, and nothing else of the page.

Run: python -I study/fresh-2026-10-11/scripts/hashes.py
"""

import hashlib
import json
import os

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    meta = json.load(open(os.path.join(HERE, "data", "pages-input.json"), encoding="utf-8"))
    out = []
    for page in meta["pages"]:
        base = os.path.join(HERE, "pages", page["slug"])
        for sub in ("recording", "probe-recording"):
            d = os.path.join(base, sub)
            if not os.path.isdir(d):
                continue
            for name in sorted(os.listdir(d)):
                path = os.path.join(d, name)
                out.append({"slug": page["slug"], "file": f"pages/{page['slug']}/{sub}/{name}", "bytes": os.path.getsize(path), "sha256": sha256(path)})
        for name in ("main-screenshot.png", "probe-screenshot.png"):
            path = os.path.join(base, name)
            if os.path.exists(path):
                out.append({"slug": page["slug"], "file": f"pages/{page['slug']}/{name}", "bytes": os.path.getsize(path), "sha256": sha256(path)})
    with open(os.path.join(HERE, "data", "recordings.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, indent=2)
        f.write("\n")
    total = sum(r["bytes"] for r in out)
    print(f"{len(out)} files, {total / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
