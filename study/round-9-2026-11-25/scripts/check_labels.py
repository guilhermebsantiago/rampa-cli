"""Check every judge's label file against its packet: the page, the labeler, one judgment per key, valid labels and causes,
and the rubric's answers (claimTrue, elementFails and captureDiffers, each yes, no or cannot_tell; a row with no claim
has no claimTrue). The sixth to eighth studies' check_labels.py, unchanged but for its folder; it covers the fast-mode
packets (packets/<slug>--fast.json) too, and then runs the recall audit's check (scripts/audit.py check). Prints counts and
problems, no label.

Run: python -I study/round-9-2026-11-25/scripts/check_labels.py
"""
import glob
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import HERE, read_json  # noqa: E402

LABELS = {"true_positive", "false_positive", "uncertain"}
CAUSES = {"context_missing", "model_error", "criterion_misapplied", "collector_error", "other", "none"}
VALUES = {"yes", "no", "cannot_tell"}
sys.stdout.reconfigure(encoding="utf-8")
problems = 0
for path in sorted(glob.glob(os.path.join(HERE, "packets", "*.json"))):
    name = os.path.basename(path)[:-5]
    packet = read_json(path)
    rows = {f["key"]: f for f in packet["findings"]}
    status = []
    for role in ("auditor", "skeptic"):
        lpath = os.path.join(HERE, "labels", f"{name}.{role}.json")
        if not os.path.exists(lpath):
            status.append(f"{role}: missing")
            continue
        try:
            d = read_json(lpath)
        except ValueError as error:
            status.append(f"{role}: not JSON ({error})")
            problems += 1
            continue
        bad = []
        got = [j.get("fingerprint") for j in d.get("judgments", [])]
        if d.get("page") != packet["page"]:
            bad.append("page differs")
        if d.get("labeler") != role:
            bad.append("labeler differs")
        if sorted(map(str, got)) != sorted(rows):
            bad.append(f"keys differ ({len(got)} vs {len(rows)})")
        for j in d.get("judgments", []):
            row = rows.get(j.get("fingerprint"))
            answers = j.get("answers") or {}
            needed = ("elementFails", "captureDiffers") if row is not None and row.get("message") is None else ("claimTrue", "elementFails", "captureDiffers")
            if j.get("label") not in LABELS or j.get("cause") not in CAUSES or not j.get("rationale") or any(answers.get(a) not in VALUES for a in needed):
                bad.append(f"bad judgment {j.get('fingerprint')}")
        status.append(f"{role}: {'ok' if not bad else '; '.join(bad[:3])}")
        problems += bool(bad)
    print(f"{name:40} {len(rows):3} items  " + "  ".join(status))
print("problems:", problems)
if os.path.isdir(os.path.join(HERE, "audits")) or os.path.isdir(os.path.join(HERE, "audit-packets")):
    import audit  # noqa: E402
    print("recall audit:")
    audit.check()
