"""Writes into this study's folder (in git), for each full report in DATA, the part of it the analysis reads: the judgment
and rule findings at any threshold (engine findings are counted, not kept, apart from the reference fields the recall audit
matches on), the groups, the model's suggestions, the other review items (counted), the discarded claims, the criteria's
summaries, the notes, the errors, the capture record, the timings and the usage; for each collection report, its timings,
capture record and usage only; and copies each run's timing record (run-*.json). The eighth study's compact.py with the
ninth study's runs. The full reports and consoles stay in DATA.

  DATA/pages/<slug>/report.json          -> pages/<slug>/report.judged.json
  DATA/pages/<slug>/fast-report.json     -> pages/<slug>/fast.judged.json
  DATA/pages/<slug>/<run>-report.json    -> pages/<slug>/<run>.judged.json   (optional T4: full2-5, fast2-5)
  DATA/pages/<slug>/<mode>-collect.json  -> pages/<slug>/<mode>-collect.timings.json   (main, fast)

Run from the repository root: python -I study/round-9-2026-11-25/scripts/compact.py
"""
import glob
import os
import shutil
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import HERE, page_dir, pages, read_json, write_json  # noqa: E402

RUNS = ["fast"] + [f"full{n}" for n in range(2, 6)] + [f"fast{n}" for n in range(2, 6)]
NAMES = {"report.json": "report.judged.json", **{f"{r}-report.json": f"{r}.judged.json" for r in RUNS}}
ENGINE_KEEP = ("criterion", "ref", "ruleId", "confidence", "fingerprint")


def keep(xs):
    return [x for x in xs or [] if x.get("source") != "engine"]


def engine(xs):
    """Engine (axe-core) findings, reduced to what the recall audit and the axe-core overlap match on."""
    return [{k: x.get(k) for k in ENGINE_KEEP} for x in xs or [] if x.get("source") == "engine"]


written = 0
for page in pages():
    source = page_dir(page["slug"])
    target = os.path.join(HERE, "pages", page["slug"])
    for full, small in NAMES.items():
        path = os.path.join(source, full)
        if not os.path.exists(path):
            continue
        r = read_json(path)
        counted = Counter(lst for lst in ("findings", "belowThreshold", "beyondTarget") for x in r.get(lst) or [] if x.get("source") == "engine")
        review = r.get("needsReview") or []
        judged = {
            "rampaVersion": r.get("rampaVersion"), "target": r.get("target"), "model": r.get("model"),
            "minConfidence": r.get("minConfidence"), "wcagTarget": r.get("wcagTarget"),
            "findings": keep(r.get("findings")), "belowThreshold": keep(r.get("belowThreshold")), "beyondTarget": keep(r.get("beyondTarget")),
            "engineFindings": dict(counted),
            "engine": {lst: engine(r.get(lst)) for lst in ("findings", "belowThreshold", "beyondTarget")},
            "groups": r.get("groups"),
            "needsReview": [x for x in review if x.get("model")],
            "otherReview": [{k: x.get(k) for k in ("criterion", "ref", "source", "ruleId")} for x in review if not x.get("model")],
            "discarded": r.get("discarded"), "criteria": r.get("criteria"), "notes": r.get("notes"), "errors": r.get("errors"),
            "usage": r.get("usage"), "timings": r.get("timings"), "capture": r.get("capture"),
            "coverage": {"reach": (r.get("coverage") or {}).get("reach"), "fast": (r.get("coverage") or {}).get("fast")},
        }
        write_json(os.path.join(target, small), judged, indent=1)
        written += 1
    for mode in ("main", "fast"):
        path = os.path.join(source, f"{mode}-collect.json")
        if os.path.exists(path):
            r = read_json(path)
            write_json(os.path.join(target, f"{mode}-collect.timings.json"),
                       {"rampaVersion": r.get("rampaVersion"), "target": r.get("target"), "timings": r.get("timings"),
                        "capture": r.get("capture"), "usage": r.get("usage"),
                        "coverage": {"fast": (r.get("coverage") or {}).get("fast")}}, indent=1)
            written += 1
    for run in glob.glob(os.path.join(source, "run-*.json")):
        os.makedirs(target, exist_ok=True)
        shutil.copyfile(run, os.path.join(target, os.path.basename(run)))
print(f"{written} compact files written")
