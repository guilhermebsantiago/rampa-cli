"""Writes, next to each full report of the fifth study, the part of it the analysis reads, which git keeps: the judgment
and rule findings at any threshold (engine findings are counted, not kept), the groups, the model's suggestions, the
criteria's summaries, the notes, the errors, the capture state and the usage. The full reports and consoles stay out of
git (.gitignore) and are copied with the recordings. study/notes-precision-fixes/compact.py, with the rule findings kept
too, since the fifth study labels them as the fourth did.

  pages/<slug>/report.json            -> pages/<slug>/report.judged.json
  pages/<slug>/noconfirm-report.json  -> pages/<slug>/noconfirm.judged.json
  pages/<slug>/cut090-report.json     -> pages/<slug>/cut090.judged.json

Run from the repository root: python -I study/round-5-2026-10-28/scripts/compact.py
"""
import glob
import json
import os
from collections import Counter

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NAMES = {"report.json": "report.judged.json", "noconfirm-report.json": "noconfirm.judged.json", "cut090-report.json": "cut090.judged.json"}
for directory in sorted(glob.glob(os.path.join(HERE, "pages", "*"))):
    for full, small in NAMES.items():
        path = os.path.join(directory, full)
        if not os.path.exists(path):
            continue
        with open(path, encoding="utf-8") as f:
            r = json.load(f)
        keep = lambda xs: [x for x in xs if x.get("source") != "engine"]
        engine = Counter(lst for lst in ("findings", "belowThreshold", "beyondTarget") for x in r.get(lst, []) if x.get("source") == "engine")
        judged = {
            "rampaVersion": r.get("rampaVersion"), "target": r.get("target"), "model": r.get("model"), "minConfidence": r.get("minConfidence"),
            "findings": keep(r.get("findings", [])), "belowThreshold": keep(r.get("belowThreshold", [])), "beyondTarget": keep(r.get("beyondTarget", [])),
            "engineFindings": dict(engine), "groups": r.get("groups"),
            "needsReview": [x for x in r.get("needsReview", []) if x.get("model")],
            "criteria": r.get("criteria"), "notes": r.get("notes"), "errors": r.get("errors"), "usage": r.get("usage"),
            "coverage": {"reach": (r.get("coverage") or {}).get("reach")},
        }
        with open(os.path.join(directory, small), "w", encoding="utf-8", newline="\n") as f:
            json.dump(judged, f, ensure_ascii=False, indent=1)
            f.write("\n")
