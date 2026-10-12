"""Print the false positives (and uncertain findings) of one split with both judges' rationales, to describe
the patterns. Run after analyze.py: python -I study/fresh-2026-10-11/scripts/dump_fp.py dev [criterion-or-group] [--uncertain]"""

import json
import os
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
split = sys.argv[1]
which = sys.argv[2] if len(sys.argv) > 2 and not sys.argv[2].startswith("--") else None
labels = ("uncertain",) if "--uncertain" in sys.argv else ("false_positive",)
if "--tp" in sys.argv:
    labels = ("true_positive",)
rows = json.load(open(os.path.join(HERE, "data", "findings.json"), encoding="utf-8"))
sys.stdout.reconfigure(encoding="utf-8")
for r in rows:
    if r["split"] != split or r["final"] not in labels:
        continue
    if which and which not in (r["criterion"], r["group"], r.get("ruleId")):
        continue
    print(f"== {r['slug']} {r['criterion']} {r.get('ruleId') or ''} [{r['confidence']}{' shown' if r['shown'] else ''}] cause={r['finalCause']}")
    print(f"   msg: {r['message'][:300]}")
    if r.get("patch"):
        print(f"   patch: {json.dumps(r['patch'], ensure_ascii=False)[:250]}")
    for role in ("auditor", "skeptic"):
        j = r.get(role) or {}
        print(f"   {role} ({j.get('label')}, {j.get('cause')}): {(j.get('rationale') or '')[:600]}")
