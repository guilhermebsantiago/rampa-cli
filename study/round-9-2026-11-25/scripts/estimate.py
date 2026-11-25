"""Run-time estimate for the ninth study's pre-registration, from the eighth study's timings only (its data/pages.json and
pages/<slug>/run-*.json, in this branch; no page of this study is read): per-page collection and main-judgment seconds,
and the T4 subset's fast collection and fast-judgment seconds, scaled to this study's 72 pages (main and fast mode on
every page). The code differs a little (0.1.3 adds a 1.3.5 fix to the eighth study's 2f5f88f), so this is a rough guide.

Writes data/estimate.json and prints it. Run from the repository root: python -I study/round-9-2026-11-25/scripts/estimate.py
"""
import glob
import json
import os
import statistics as st
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
R8 = os.path.join(os.path.dirname(HERE), "round-8-2026-11-21")
PAGES = 72

sys.stdout.reconfigure(encoding="utf-8")
rows = json.load(open(os.path.join(R8, "data", "pages.json"), encoding="utf-8"))
collect = [r["collectSeconds"] for r in rows if r.get("collectSeconds") is not None]
judged = [r["judgedSeconds"] for r in rows if r.get("judgedSeconds") is not None]
calls = [r["calls"] for r in rows if r.get("calls") is not None]


def secs(pattern):
    return [json.load(open(p, encoding="utf-8"))["seconds"] for p in glob.glob(os.path.join(R8, "pages", "*", pattern))]


fast_collect = secs("run-fast-collect-*.json")
fast_judged = secs("run-fast1-judged.json")


def mean(xs):
    return sum(xs) / len(xs)


out = {
    "source": "study/round-8-2026-11-21 (2f5f88f, Gemma 4 12B, --concurrency 2), timings only",
    "round8": {"collectSeconds": {"median": st.median(collect), "mean": round(mean(collect), 1), "pages": len(collect)},
               "judgedSeconds": {"median": st.median(judged), "mean": round(mean(judged), 1), "pages": len(judged)},
               "modelCalls": {"median": st.median(calls), "mean": round(mean(calls), 1)},
               "fastCollectSeconds": {"median": st.median(fast_collect), "mean": round(mean(fast_collect), 1), "pages": len(fast_collect)},
               "fastJudgedSeconds": {"median": st.median(fast_judged), "mean": round(mean(fast_judged), 1), "pages": len(fast_judged)}},
    "round9Hours": {
        "mainCollection": round(mean(collect) * PAGES / 3600, 2),
        "fastCollection": round(mean(fast_collect) * PAGES / 3600, 2),
        "mainJudgment": round(mean(judged) * PAGES / 3600, 2),
        "fastJudgment": round(mean(fast_judged) * PAGES / 3600, 2),
    },
}
out["round9Hours"]["total"] = round(sum(out["round9Hours"].values()), 2)
with open(os.path.join(HERE, "data", "estimate.json"), "w", encoding="utf-8", newline="\n") as f:
    json.dump(out, f, ensure_ascii=False, indent=1)
    f.write("\n")
print(json.dumps(out["round9Hours"]), json.dumps(out["round8"]))
