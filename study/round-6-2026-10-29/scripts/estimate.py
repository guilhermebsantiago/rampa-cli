"""Run-time, cost and sample-size estimates for the sixth study's pre-registration draft, from the fifth study's data.

No page of the sixth study is read: every input is the fifth study's committed data (study/round-5-2026-10-28/) or a
number from docs/performance.md and docs/models.md, named below. The fifth study's test half is used for counts only.

Writes data/estimate.json and prints the tables the draft quotes. Run from anywhere:
  python -I -B study/round-6-2026-10-29/scripts/estimate.py
"""

import glob
import json
import math
import os
import random
import statistics as st

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
R5 = os.path.join(os.path.dirname(HERE), "round-5-2026-10-28")
SEED = 20261029

# docs/performance.md, "Three real pages": seconds with Gemma 4 12B, full and --fast, and the model calls.
FAST = [(237.0, 87.1, 66, 22), (292.5, 102.7, 89, 26), (165.0, 73.9, 55, 20)]
# docs/performance.md, the ACT evaluation: wall seconds of `rampa eval`, default and --fast (343 test pages).
ACT_EVAL = {"full": 816, "fast": 742}
# docs/models.md, "Four local models": wall time of the same evaluation, Gemma 4 12B and Ministral 3 14B.
MODEL_WALL = {"gemma4:12b": 7 * 60 + 5, "ministral-3:14b": 9 * 60 + 22}
# src/providers/models.ts (prices of 2026-10-07): openai:gpt-6-luna, USD per million tokens.
LUNA = {"input": 0.10, "output": 0.50}


def q(values, p):
    v = sorted(values)
    k = (len(v) - 1) * p
    lo, hi = math.floor(k), math.ceil(k)
    return v[lo] + (v[hi] - v[lo]) * (k - lo)


def wilson(k, n, z=1.959964):
    if n == 0:
        return (0.0, 1.0)
    p = k / n
    d = 1 + z * z / n
    c = p + z * z / (2 * n)
    r = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return ((c - r) / d, (c + r) / d)


def main():
    pages = json.load(open(os.path.join(R5, "data", "pages.json"), encoding="utf-8"))
    findings = json.load(open(os.path.join(R5, "data", "findings.json"), encoding="utf-8"))
    out = {"source": "study/round-5-2026-10-28 (b759128, Gemma 4 12B, --concurrency 2), docs/performance.md, docs/models.md"}

    # Time and usage per page in the fifth study.
    usage = {}
    for d in glob.glob(os.path.join(R5, "pages", "*", "report.judged.json")):
        slug = os.path.basename(os.path.dirname(d))
        r = json.load(open(d, encoding="utf-8"))
        disc = sum(c.get("discarded", 0) for c in r["criteria"])
        usage[slug] = {**r["usage"], "discarded": disc, "needsReview": len(r.get("needsReview", []))}
    collect = [p["collect"]["seconds"] for p in pages]
    judge = [p["judged"]["seconds"] for p in pages]
    calls = [usage[p["slug"]]["calls"] for p in pages]
    tin = [usage[p["slug"]]["inputTokens"] for p in pages]
    tout = [usage[p["slug"]]["outputTokens"] for p in pages]
    def dist(v):
        return {"median": st.median(v), "p90": round(q(v, 0.9), 1), "mean": round(st.mean(v), 1), "min": min(v), "max": max(v), "sum": sum(v)}
    out["round5PerPage"] = {"collectSeconds": dist(collect), "judgeSeconds": dist(judge), "totalSeconds": dist([a + b for a, b in zip(collect, judge)]),
                            "modelCalls": dist(calls), "inputTokens": dist(tin), "outputTokens": dist(tout)}
    fast_time = st.mean(f / full for full, f, _, _ in FAST)
    fast_calls = st.mean(fc / c for _, _, c, fc in FAST)
    out["fastRatio"] = {"time": round(fast_time, 3), "calls": round(fast_calls, 3), "from": "docs/performance.md, three pages, Gemma 4 12B"}
    swap_ratio = MODEL_WALL["ministral-3:14b"] / MODEL_WALL["gemma4:12b"]
    out["ministralRatio"] = round(swap_ratio, 3)

    mean_j, mean_c = st.mean(judge), st.mean(collect)
    hours = lambda s: round(s / 3600, 2)  # noqa: E731
    est = {
        "collection, 72 pages (network, no model)": hours(72 * mean_c),
        "judgment, 72 pages, Gemma 4 12B, --concurrency 2": hours(72 * mean_j),
        "ablations by replay (--no-confirm, --no-verify, --no-llm), 72 pages each": hours(72 * 3 * 3),
        "model swap, local Ministral 3 14B, 72 pages": hours(72 * mean_j * swap_ratio),
        "T4, all 72 pages: 4 more uncached full runs (the main run is the first)": hours(4 * 72 * mean_j),
        "T4, all 72 pages: 5 uncached full runs, none shared with the main run": hours(5 * 72 * mean_j),
        "T4, all 72 pages: one live --fast collection": hours(72 * mean_c * 0.8),
        "T4, all 72 pages: 5 uncached --fast judgments": hours(5 * 72 * mean_j * fast_time),
        "T4, 12-page subset: 4 more uncached full runs": hours(4 * 12 * mean_j),
        "T4, 12-page subset: one live --fast collection": hours(12 * mean_c * 0.8),
        "T4, 12-page subset: 5 uncached --fast judgments": hours(5 * 12 * mean_j * fast_time),
        "T4, ACT cases (outside this study): 5 uncached eval runs, full and --fast": hours(5 * (ACT_EVAL["full"] + ACT_EVAL["fast"])),
    }
    out["hours"] = est

    # Hosted cost per page: the fifth study's tokens priced as openai:gpt-6-luna; output tokens x1 (no reasoning text)
    # to x5 (its default medium reasoning writes more), a range until a hosted run measures it.
    per_page_in = st.mean(tin) / 1e6 * LUNA["input"]
    per_page_out = st.mean(tout) / 1e6 * LUNA["output"]
    cost = {"perPageFull": [round(per_page_in + per_page_out, 4), round(per_page_in + 5 * per_page_out, 4)]}
    cost["perPageFast"] = [round(c * fast_calls, 4) for c in cost["perPageFull"]]
    cost["swap72"] = [round(72 * c, 2) for c in cost["perPageFull"]]
    cost["t4All72"] = [round(5 * 72 * (a + b), 2) for a, b in zip(cost["perPageFull"], cost["perPageFast"])]
    cost["t4Subset12"] = [round(5 * 12 * (a + b), 2) for a, b in zip(cost["perPageFull"], cost["perPageFast"])]
    out["hostedUSD"] = cost

    # What the --no-verify replay would add to the packets: the claims verification discarded and the suggestions.
    disc = [usage[p["slug"]]["discarded"] for p in pages]
    sugg = [sum((p["judged"].get("suggestions") or {}).values()) for p in pages]
    out["noVerifyExtrasPerPage"] = {"discarded": round(st.mean(disc), 1), "suggestions": round(st.mean(sugg), 1),
                                    "items72": round(72 * (st.mean(disc) + st.mean(sugg)))}
    items = len(findings)
    out["labelledItems"] = {"round5": items, "perPage": round(items / 24, 1),
                            "round6Projected": round(72 * (items / 24 + st.mean(disc) + st.mean(sugg)))}

    # Decided default-threshold judged findings per page (counts only), and the chance of 70 on 36 test pages.
    decided = {p["slug"]: 0 for p in pages}
    split = {p["slug"]: p["split"] for p in pages}
    for f in findings:
        if f["origin"] == "main" and f["group"] == "judged" and f["shown"] and f["final"] in ("true_positive", "false_positive"):
            decided[f["slug"]] += 1
    counts = list(decided.values())
    test_counts = [decided[s] for s in decided if split[s] == "test"]
    rng = random.Random(SEED)
    sims = {"all24": [], "test12": []}
    for _ in range(10000):
        sims["all24"].append(sum(rng.choice(counts) for _ in range(36)))
        sims["test12"].append(sum(rng.choice(test_counts) for _ in range(36)))
    out["decidedOn36TestPages"] = {
        k: {"perPage": round(st.mean(counts if k == "all24" else test_counts), 2), "median": st.median(v),
            "p05": q(v, 0.05), "p95": q(v, 0.95), "chanceAtLeast70": round(sum(x >= 70 for x in v) / len(v), 3)}
        for k, v in sims.items()}

    # Wilson lower bounds at the sizes the round can reach, and the page design effect of the fifth study (1.94,
    # docs/studies/notes-precision-round5.md section 4).
    deff = 1.94
    lb = {}
    for n in (60, 70, 80, 90, 100):
        for p in (0.88, 0.90, 0.92):
            k = round(p * n)
            lb[f"n={n} p={p}"] = {"wilsonLower": round(wilson(k, n)[0], 3),
                                  "withDesignEffect": round(wilson(p * n / deff, n / deff)[0], 3)}
    out["lowerBounds"] = lb
    path = os.path.join(HERE, "data", "estimate.json")
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print(json.dumps(out, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
