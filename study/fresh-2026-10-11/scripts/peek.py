"""Counts of findings by source, rule and confidence in each page's reports (a quick look while the runs go).
Run: python -I study/fresh-2026-10-11/scripts/peek.py <report file name, e.g. main-collect.json or report.json>"""

import json
import os
import sys
from collections import Counter

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
name = sys.argv[1]
meta = json.load(open(os.path.join(HERE, "data", "pages-input.json"), encoding="utf-8"))
total = Counter()
sys.stdout.reconfigure(encoding="utf-8")
for page in meta["pages"]:
    path = os.path.join(HERE, "pages", page["slug"], name)
    if not os.path.exists(path):
        continue
    r = json.load(open(path, encoding="utf-8"))
    c = Counter()
    for f in r["findings"] + r.get("belowThreshold", []):
        if f["source"] == "engine":
            continue
        key = f"{f['source']}:{f.get('ruleId') or f['criterion']}:{f['confidence']}"
        c[key] += 1
        total[key] += 1
    print(f"{page['split']:4} {page['slug'][:30]:30} calls={r['usage']['calls']:4} {dict(c)}")
print("total", dict(sorted(total.items())))
