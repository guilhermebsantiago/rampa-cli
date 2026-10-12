"""Check every judge's label file against its packet: the page, the labeler, one judgment per key, and valid
labels and causes. Run: python -I study/fresh-2026-10-11/scripts/check_labels.py"""

import glob
import json
import os
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LABELS = {"true_positive", "false_positive", "uncertain"}
CAUSES = {"context_missing", "model_error", "criterion_misapplied", "collector_error", "other", "none"}
sys.stdout.reconfigure(encoding="utf-8")
problems = 0
for path in sorted(glob.glob(os.path.join(HERE, "packets", "*.json"))):
    name = os.path.basename(path)[:-5]
    packet = json.load(open(path, encoding="utf-8"))
    keys = [f["key"] for f in packet["findings"]]
    status = []
    for role in ("auditor", "skeptic"):
        lpath = os.path.join(HERE, "labels", f"{name}.{role}.json")
        if not os.path.exists(lpath):
            status.append(f"{role}: missing")
            continue
        d = json.load(open(lpath, encoding="utf-8"))
        got = [j["fingerprint"] for j in d["judgments"]]
        bad = []
        if d.get("page") != packet["page"]:
            bad.append(f"page {d.get('page')!r}")
        if d.get("labeler") != role:
            bad.append(f"labeler {d.get('labeler')!r}")
        if sorted(got) != sorted(keys):
            bad.append(f"keys differ ({len(got)} vs {len(keys)})")
        for j in d["judgments"]:
            if j["label"] not in LABELS or j.get("cause") not in CAUSES or not j.get("rationale"):
                bad.append(f"bad judgment {j['fingerprint']}")
        status.append(f"{role}: {'ok' if not bad else '; '.join(bad)}")
        problems += bool(bad)
    print(f"{name:40} {len(keys):3} findings  " + "  ".join(status))
print("problems:", problems)
