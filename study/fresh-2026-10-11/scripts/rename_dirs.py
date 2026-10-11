"""One-off: the first collection named page folders after the recording (the whole address); move each to
its short slug (data/pages-input.json). Run: python -I study/fresh-2026-10-11/scripts/rename_dirs.py"""

import json
import os

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
meta = json.load(open(os.path.join(HERE, "data", "pages-input.json"), encoding="utf-8"))
pages = os.path.join(HERE, "pages")
for p in meta["pages"]:
    old = "\\\\?\\" + os.path.join(pages, p["recording"])
    new = "\\\\?\\" + os.path.join(pages, p["slug"])
    if os.path.isdir(old) and not os.path.exists(new):
        os.rename(old, new)
        print(f"{p['recording']} -> {p['slug']}")
