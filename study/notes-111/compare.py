"""The 1.1.1 judgment findings of two runs on the fresh-page study's DEV pages, with the study's dev labels.

Reads only rows with split "dev" from data/findings.json and only the dev pages of data/pages-input.json.
usage: python -I compare.py <study dir> <run a> <run b>   (each run: <slug>/report.json, from run.sh dev)"""

import json
import math
import os
import sys

sys.stdout.reconfigure(encoding="utf-8")
study, run_a, run_b = sys.argv[1:4]
CRITERION = "1.1.1"
rows = [r for r in json.load(open(os.path.join(study, "data", "findings.json"), encoding="utf-8")) if r["split"] == "dev"]
pages = [p["slug"] for p in json.load(open(os.path.join(study, "data", "pages-input.json"), encoding="utf-8"))["pages"] if p["split"] == "dev"]
labels = {}
for r in rows:
    if r["criterion"] == CRITERION and r["group"] == "judged":
        labels[(r["slug"], r["fingerprint"])] = r["final"]
        labels[(r["slug"], r["ref"], r["subject"])] = r["final"]


def wilson(k, n, z=1.96):
    if n == 0:
        return "-"
    p = k / n
    d = 1 + z * z / n
    c = p + z * z / (2 * n)
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return f"{p:.2f} ({(c - h) / d:.2f}-{(c + h) / d:.2f})"


def load(run, slug):
    report = json.load(open(os.path.join(run, slug, "report.json"), encoding="utf-8"))
    found = [f for f in report["findings"] + report["belowThreshold"] if f["criterion"] == CRITERION and f["source"] == "judgment"]
    return report, {(f["ref"], f.get("subject")): f for f in found}


def label(slug, f):
    return labels.get((slug, f["fingerprint"])) or labels.get((slug, f["ref"], f.get("subject"))) or "unlabelled"


totals = {run_a: {}, run_b: {}}
for slug in pages:
    report_a, a = load(run_a, slug)
    report_b, b = load(run_b, slug)
    for run, found in ((run_a, a), (run_b, b)):
        for f in found.values():
            totals[run][label(slug, f)] = totals[run].get(label(slug, f), 0) + 1
    for key in a.keys() - b.keys():
        f = a[key]
        why = [d["reason"] for d in report_b["discarded"] if d["criterion"] == CRITERION and d["ref"] == f["ref"]]
        print(f"removed {slug} [{label(slug, f)}] {f['message'][:120]} :: {'; '.join(why)}")
    for key in b.keys() - a.keys():
        print(f"added   {slug} [{label(slug, b[key])}] {b[key]['message'][:120]}")
    misses = [c.get("offlineMisses", 0) for r in (report_a, report_b) for c in r["criteria"] if c["criterion"] == CRITERION]
    if any(misses):
        print(f"  {slug}: offline misses {misses}")
for run in (run_a, run_b):
    t = totals[run]
    tp, fp, un = t.get("true_positive", 0), t.get("false_positive", 0), t.get("uncertain", 0)
    print(f"{run}: {sum(t.values())} findings, {tp} TP / {fp} FP / {un} uncertain, precision {wilson(tp, tp + fp)}" + (f", {t['unlabelled']} unlabelled" if "unlabelled" in t else ""))
