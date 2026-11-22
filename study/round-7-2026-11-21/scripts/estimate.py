"""Run-time estimate for the seventh study's pre-registration, from the sixth study's committed timings only
(study/round-6-2026-10-29/data/pages.json and its pages/<slug>/run-*.json; no page of this study is read): per-page
collection and main-judgment seconds, and the T4 runs' seconds, scaled to this study's 60 pages and 12-page T4 subset.
The code differs (385fe13 reads same-text link destinations first within the same budget), so this is a rough guide.

Writes data/estimate.json and prints it. Run from the repository root: python -I study/round-7-2026-11-21/scripts/estimate.py
"""
import glob
import json
import os
import statistics as st
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
R6 = os.path.join(os.path.dirname(HERE), "round-6-2026-10-29")
PAGES, T4_PAGES = 60, 12

sys.stdout.reconfigure(encoding="utf-8")
rows = json.load(open(os.path.join(R6, "data", "pages.json"), encoding="utf-8"))
collect = [r["collectSeconds"] for r in rows if r.get("collectSeconds") is not None]
judged = [r["judgedSeconds"] for r in rows if r.get("judgedSeconds") is not None]
t4 = {}
for mode in ("full2", "full3", "full4", "full5", "fast1", "fast2", "fast3", "fast4", "fast5", "fast-collect-1"):
    secs = []
    for path in glob.glob(os.path.join(R6, "pages", "*", f"run-{mode}*.json")):
        secs.append(json.load(open(path, encoding="utf-8"))["seconds"])
    if secs:
        t4[mode] = {"pages": len(secs), "sum": sum(secs), "median": st.median(secs)}


def mean(xs):
    return sum(xs) / len(xs)


full_runs = sum(t4[m]["sum"] / t4[m]["pages"] for m in ("full2", "full3", "full4", "full5")) * T4_PAGES
fast_runs = sum(t4[m]["sum"] / t4[m]["pages"] for m in ("fast1", "fast2", "fast3", "fast4", "fast5")) * T4_PAGES
fast_collect = t4["fast-collect-1"]["sum"] / t4["fast-collect-1"]["pages"] * T4_PAGES if "fast-collect-1" in t4 else 0
out = {
    "source": "study/round-6-2026-10-29 (rampa-cli 0.1.2, Gemma 4 12B, --concurrency 2), timings only",
    "round6": {"collectSeconds": {"median": st.median(collect), "mean": round(mean(collect), 1), "pages": len(collect)},
               "judgedSeconds": {"median": st.median(judged), "mean": round(mean(judged), 1), "pages": len(judged)}, "t4": t4},
    "round7Hours": {
        "collection": round(mean(collect) * PAGES / 3600, 2),
        "mainJudgment": round(mean(judged) * PAGES / 3600, 2),
        "t4Full4Runs": round(full_runs / 3600, 2),
        "t4FastCollectAnd5Runs": round((fast_runs + fast_collect) / 3600, 2),
    },
}
out["round7Hours"]["total"] = round(sum(out["round7Hours"].values()), 2)
with open(os.path.join(HERE, "data", "estimate.json"), "w", encoding="utf-8", newline="\n") as f:
    json.dump(out, f, ensure_ascii=False, indent=1)
    f.write("\n")
print(json.dumps(out["round7Hours"]))
