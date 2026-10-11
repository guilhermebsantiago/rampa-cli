"""The dev pages judged with the new code: findings (grounded) and suggestions, per criterion.
Usage: python -I dev_judged.py <dir of report .json>
"""
import glob
import json
import os
import sys
from collections import Counter

totals = Counter()
for path in sorted(glob.glob(os.path.join(sys.argv[1], "*.json"))):
    r = json.load(open(path, encoding="utf-8"))
    name = os.path.basename(path)[:40]
    summaries = {c["criterion"]: c for c in r["criteria"]}
    for crit in ("2.4.4", "2.4.6"):
        s = summaries.get(crit, {})
        for key in ("candidates", "judged", "failed", "suggested", "passed", "cannotTell", "discarded", "capped", "offlineMisses", "errors"):
            totals[(crit, key)] += s.get(key, 0) or 0
    found = [f for f in r["findings"] + r["belowThreshold"] if f["criterion"] in ("2.4.4", "2.4.6") and f["source"] == "judgment"]
    sugg = [i for i in r.get("needsReview", []) if i.get("model") and i["criterion"] in ("2.4.4", "2.4.6")]
    print(f"{name:40} findings {len(found)} suggestions {len(sugg)} | " + " ".join(f"{c}:{summaries.get(c, {}).get('judged', 0)}/{summaries.get(c, {}).get('candidates', 0)}" for c in ("2.4.4", "2.4.6")))
    for f in found:
        print(f"   FINDING {f['criterion']} {f['confidence']} {f['ref'][-50:]} :: {f['message'][:150]}")
    for i in sugg:
        print(f"   suggest {i['criterion']} {i.get('ref', '')[-40:]} :: {i['message'][:120]} || {i.get('evidence', '')[:60]}")
print(dict(totals))
