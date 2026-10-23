"""The 1.1.1 judgment findings of one run on the fresh-page study's DEV pages, with the study's dev labels.

Reads only rows with split "dev" from data/findings.json and only the dev pages of data/pages-input.json. A finding
the study did not label (the run asked the model again and it said something new) is printed as "unlabelled";
findings at the default threshold and below it are counted apart.
usage: python -I list111.py <study dir> <run dir>   (each run: <slug>/report.json, from run.sh dev)"""

import json
import math
import os
import sys

sys.stdout.reconfigure(encoding="utf-8")
study, run = sys.argv[1], sys.argv[2]
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


totals = {}
judged = discarded = 0
for slug in pages:
    report = json.load(open(os.path.join(run, slug, "report.json"), encoding="utf-8"))
    for c in report["criteria"]:
        if c["criterion"] == CRITERION:
            judged += c.get("judged", 0)
            if c.get("offlineMisses"):
                print(f"  {slug}: offline misses {c['offlineMisses']}")
    for d in report["discarded"]:
        if d["criterion"] == CRITERION:
            discarded += 1
            if "--discarded" in sys.argv:
                print(f"  dropped {slug} {d['reason']} :: {json.dumps(d.get('output'), ensure_ascii=False)[:300]}")
    for f in report["findings"] + report["belowThreshold"]:
        if f["criterion"] != CRITERION or f["source"] != "judgment":
            continue
        # run.sh judges with --min-confidence low, as the study did, so the report lists every finding: one at low
        # confidence (a hidden image's, capped until its check passes the evaluation gate) is below the default threshold.
        where = "below" if f.get("confidence") == "low" else "default"
        label = labels.get((slug, f["fingerprint"])) or labels.get((slug, f["ref"], f.get("subject"))) or "unlabelled"
        totals.setdefault(where, {})
        totals[where][label] = totals[where].get(label, 0) + 1
        print(f"{label:15} {where:8} {slug:25} {f['message'][:120]}")
for where in ("default", "below"):
    t = totals.get(where, {})
    tp, fp, un = t.get("true_positive", 0), t.get("false_positive", 0), t.get("uncertain", 0)
    print(f"{where} threshold: {sum(t.values())} findings: {tp} TP / {fp} FP / {un} uncertain" + (f" / {t['unlabelled']} unlabelled" if "unlabelled" in t else "") + f", precision {wilson(tp, tp + fp)}")
print(f"{judged} judged, {discarded} dropped by verification")
