"""Writes into this study's folder (in git), for each full report in DATA, the part of it the analysis reads: the judgment
and rule findings at any threshold (engine findings are counted, not kept), the groups, the model's suggestions, the
discarded claims, the criteria's summaries, the notes, the errors, the capture record, the timings and the usage; and
copies each run's timing record (run-*.json). The seventh study's compact.py, with the eighth study's runs. The full reports
and consoles stay in DATA.

  DATA/pages/<slug>/report.json         -> pages/<slug>/report.judged.json
  DATA/pages/<slug>/<run>-report.json   -> pages/<slug>/<run>.judged.json  (noconfirm, noverify, nollm, full2-5, fast1-5)

Run from the repository root: python -I study/round-8-2026-11-21/scripts/compact.py
"""
import glob
import os
import shutil
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import HERE, page_dir, pages, read_json, write_json  # noqa: E402

RUNS = ["noconfirm", "noverify", "nollm"] + [f"full{n}" for n in range(2, 6)] + [f"fast{n}" for n in range(1, 6)]
NAMES = {"report.json": "report.judged.json", **{f"{r}-report.json": f"{r}.judged.json" for r in RUNS}}


def keep(xs):
    return [x for x in xs or [] if x.get("source") != "engine"]


written = 0
for page in pages():
    source = page_dir(page["slug"])
    target = os.path.join(HERE, "pages", page["slug"])
    for full, small in NAMES.items():
        path = os.path.join(source, full)
        if not os.path.exists(path):
            continue
        r = read_json(path)
        engine = Counter(lst for lst in ("findings", "belowThreshold", "beyondTarget") for x in r.get(lst) or [] if x.get("source") == "engine")
        judged = {
            "rampaVersion": r.get("rampaVersion"), "target": r.get("target"), "model": r.get("model"),
            "minConfidence": r.get("minConfidence"), "wcagTarget": r.get("wcagTarget"),
            "findings": keep(r.get("findings")), "belowThreshold": keep(r.get("belowThreshold")), "beyondTarget": keep(r.get("beyondTarget")),
            "engineFindings": dict(engine), "groups": r.get("groups"),
            "needsReview": [x for x in r.get("needsReview") or [] if x.get("model")],
            "discarded": r.get("discarded"), "criteria": r.get("criteria"), "notes": r.get("notes"), "errors": r.get("errors"),
            "usage": r.get("usage"), "timings": r.get("timings"), "capture": r.get("capture"),
            "coverage": {"reach": (r.get("coverage") or {}).get("reach")},
        }
        write_json(os.path.join(target, small), judged, indent=1)
        written += 1
    for run in glob.glob(os.path.join(source, "run-*.json")):
        os.makedirs(target, exist_ok=True)
        shutil.copyfile(run, os.path.join(target, os.path.basename(run)))
print(f"{written} compact reports written")
