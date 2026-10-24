"""Print the false positives (and uncertain findings) of the dev split with both judges' rationales, to describe
the patterns. Run after analyze.py: python -I study/round-3-2026-10-23/scripts/dump_fp.py dev [criterion-or-group] [--uncertain]

The second study's dump_fp.py, with one guard: for the test split it prints only counts (by criterion or check,
and by the judges' cause), never a message, an element or a rationale, so that the test half is counted and not
read for patterns."""

import json
import os
import sys
from collections import Counter

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
split = sys.argv[1]
which = sys.argv[2] if len(sys.argv) > 2 and not sys.argv[2].startswith("--") else None
labels = ("uncertain",) if "--uncertain" in sys.argv else ("false_positive",)
if "--tp" in sys.argv:
    labels = ("true_positive",)
rows = json.load(open(os.path.join(HERE, "data", "findings.json"), encoding="utf-8"))
sys.stdout.reconfigure(encoding="utf-8")
if split != "dev":
    counts = Counter()
    for r in rows:
        if r["split"] == split and r["final"] in labels and (not which or which in (r["criterion"], r["group"], r.get("ruleId"))):
            check = r.get("ruleId") or f"judgment {r['criterion']}"
            counts[(check, "shown" if r["shown"] else "below", r["finalCause"])] += 1
    for (check, threshold, cause), n in sorted(counts.items()):
        print(f"{split} {labels[0]} {check} [{threshold}] cause={cause}: {n}")
    print(f"total: {sum(counts.values())}")
    sys.exit(0)
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
