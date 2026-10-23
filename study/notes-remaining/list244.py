"""The 2.4.4 judgment findings and suggestions of two runs on the fresh-page study's DEV pages, compared item by item.

Reads only the dev pages of data/pages-input.json. The 2.4.4 findings of the study were made by an earlier version of
the criterion, so they are not matched with its labels here: what matters is whether the two runs differ.
usage: python -I list244.py <study dir> <run a> <run b>   (each run: <slug>/report.json, from run.sh dev)"""

import json
import os
import sys

sys.stdout.reconfigure(encoding="utf-8")
study, run_a, run_b = sys.argv[1:4]
CRITERION = "2.4.4"
pages = [p["slug"] for p in json.load(open(os.path.join(study, "data", "pages-input.json"), encoding="utf-8"))["pages"] if p["split"] == "dev"]


def items(run, slug):
    report = json.load(open(os.path.join(run, slug, "report.json"), encoding="utf-8"))
    found = {(f["ref"], f["message"]) for f in report["findings"] + report["belowThreshold"] if f["criterion"] == CRITERION and f["source"] == "judgment"}
    review = {(r["ref"], r["message"]) for r in report.get("needsReview", []) if r.get("criterion") == CRITERION and r.get("model")}
    summary = next((c for c in report["criteria"] if c["criterion"] == CRITERION), {})
    return found, review, summary


totals = {run_a: [0, 0, 0, 0, 0], run_b: [0, 0, 0, 0, 0]}
for slug in pages:
    (fa, ra, sa), (fb, rb, sb) = items(run_a, slug), items(run_b, slug)
    for run, (f, r, s) in ((run_a, (fa, ra, sa)), (run_b, (fb, rb, sb))):
        t = totals[run]
        t[0] += len(f)
        t[1] += len(r)
        t[2] += s.get("judged", 0)
        t[3] += s.get("capped", 0) or 0
        t[4] += s.get("offlineMisses", 0) or 0
    for ref, message in sorted(fa - fb):
        print(f"finding only in a: {slug} {message[:120]}")
    for ref, message in sorted(fb - fa):
        print(f"finding only in b: {slug} {message[:120]}")
    for ref, message in sorted(ra ^ rb):
        print(f"suggestion in one run only: {slug} {message[:120]}")
    if "--list" in sys.argv:
        for ref, message in sorted(fb):
            print(f"  finding {slug} {message[:140]}")
        for ref, message in sorted(rb):
            print(f"  suggestion {slug} {message[:140]}")
for run in (run_a, run_b):
    found, review, judged, capped, misses = totals[run]
    print(f"{run}: {found} findings, {review} model suggestions, {judged} judged, {capped} not judged (cap), {misses} offline misses")
