"""Five uncached runs (T4; pre-registration, section 5, item 5), on the T4 subset, per mode:

- full: the main run (cache/, report.json) and full2..full5 (cache-full<n>/, full<n>-report.json), on the main snapshot;
- fast: fast1..fast5 (cache-fast<n>/, fast<n>-report.json), on the live --fast snapshot.

A page counts in a mode only when all five of its runs finished (a report exists).

**Decision level (co-registered, target 0.95).** The population is every judged candidate of the eight default
criteria: per page, the sum of `criteria[].candidates` of those criteria in the first run's report (the same snapshot
gives the same candidates; the largest count over the five runs is used if they differ, and the report says so). Each
candidate's decision in a run is read from that run's report by criterion and element (ref), the strongest of:
"finding" (a judgment finding at the default threshold: medium or high, not experimental), "below" (a judgment finding
below it), "suggestion" (a needsReview item with a model) and "nothing" (passed, discarded, cannot tell, capped: not in
the report's lists). A candidate whose decision is not the same in all five runs differs. Reported: the share of the
population with the same decision in all five runs (Wilson), and the same share among the candidates with a decision
other than "nothing" in at least one run.

Beside it, as in the sixth and seventh studies: the prompt level (each judged prompt's answer read from each run's judgment cache, the
model's verdict or the second pass's word; a prompt answered in one run and not in another differs), and the share of
default-threshold judgment findings (by fingerprint) present in all five reports; with each page's times for P4.

Run: python -I study/round-8-2026-11-21/scripts/t4.py   (writes data/t4.json; prints counts and shares)
"""
import glob
import json
import math
import os
import sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import HERE, page_dir, pages, read_json, write_json  # noqa: E402

Z = 1.959963984540054
LEVELS = {"low": 0, "medium": 1, "high": 2}
CRITERIA = ("1.1.1", "1.3.5", "2.4.2", "2.4.4", "2.4.6", "3.1.1", "3.1.2", "3.3.2")
RANK = {"nothing": 0, "suggestion": 1, "below": 2, "finding": 3}
MODES = {"full": [("cache", "report.json")] + [(f"cache-full{n}", f"full{n}-report.json") for n in range(2, 6)],
         "fast": [(f"cache-fast{n}", f"fast{n}-report.json") for n in range(1, 6)]}


def wilson(k, n):
    if n == 0:
        return None
    p, d = k / n, 1 + Z * Z / n
    c, h = (p + Z * Z / (2 * n)) / d, Z * math.sqrt(p * (1 - p) / n + Z * Z / (4 * n * n)) / d
    return [round(max(0.0, c - h), 3), round(min(1.0, c + h), 3)]


def answers(cache):
    out = {}
    for path in glob.glob(os.path.join(cache, "*", "*.json")):
        entry = read_json(path)
        output = entry.get("output")
        if isinstance(output, dict) and "verdict" in output:
            out[os.path.basename(path)] = ("verdict", output["verdict"])
        elif isinstance(entry.get("word"), str) or isinstance((output or {}).get("word") if isinstance(output, dict) else None, str):
            out[os.path.basename(path)] = ("word", (entry.get("word") or output.get("word")).strip().lower())
        else:
            out[os.path.basename(path)] = ("other", json.dumps(output, sort_keys=True)[:200])
    return out


def shown(report):
    return {f["fingerprint"] for f in report.get("findings", []) + report.get("belowThreshold", [])
            if f.get("source") == "judgment" and LEVELS.get(f.get("confidence"), 0) >= 1 and not f.get("experimental")}


def decisions(report):
    """(criterion, ref) -> the strongest decision the report gives that element for that criterion."""
    out = {}

    def put(key, value):
        if RANK[value] > RANK.get(out.get(key, "nothing"), 0):
            out[key] = value
    for lst in ("findings", "belowThreshold", "beyondTarget"):
        for f in report.get(lst) or []:
            if f.get("source") != "judgment" or f.get("criterion") not in CRITERIA:
                continue
            default = LEVELS.get(f.get("confidence"), 0) >= 1 and not f.get("experimental") and lst != "beyondTarget"
            put((f["criterion"], f.get("ref")), "finding" if default else "below")
    for n in report.get("needsReview") or []:
        if n.get("model") and n.get("criterion") in CRITERIA:
            put((n["criterion"], n.get("ref")), "suggestion")
    return out


def candidates(report):
    return sum(c.get("candidates") or 0 for c in report.get("criteria") or [] if c.get("criterion") in CRITERIA)


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    result = {}
    for mode, runs in MODES.items():
        same = total = fsame = ftotal = 0
        dpop = dsame = dever = dever_same = 0
        by_kind, by_criterion = {}, defaultdict(lambda: [0, 0])
        per_page = []
        for p in pages():
            if not p["t4Subset"]:
                continue
            base = page_dir(p["slug"])
            if not all(os.path.exists(os.path.join(base, rep)) for _, rep in runs):
                per_page.append({"slug": p["slug"], "complete": False})
                continue
            caches = [answers(os.path.join(base, c)) for c, _ in runs]
            keys = set().union(*caches)
            agree = 0
            for k in keys:
                values = [c.get(k) for c in caches]
                ok = None not in values and len(set(values)) == 1
                kind = next(v for v in values if v is not None)[0]
                s, t = by_kind.get(kind, (0, 0))
                by_kind[kind] = (s + ok, t + 1)
                agree += ok
            reports = [read_json(os.path.join(base, rep)) for _, rep in runs]
            sets = [shown(r) for r in reports]
            union = set().union(*sets)
            inall = set.intersection(*sets) if sets else set()
            counts = [candidates(r) for r in reports]
            population = max(counts)
            dec = [decisions(r) for r in reports]
            elements = set().union(*dec)
            differ = [k for k in elements if len({d.get(k, "nothing") for d in dec}) > 1]
            for k in elements:
                by_criterion[k[0]][0] += k not in differ
                by_criterion[k[0]][1] += 1
            timing = {os.path.basename(x)[4:-5]: read_json(x)["seconds"] for x in glob.glob(os.path.join(base, "run-*.json"))}
            per_page.append({"slug": p["slug"], "complete": True, "candidates": population, "candidateCountsDiffer": len(set(counts)) > 1,
                             "decisionsDiffer": len(differ), "withADecision": len(elements), "prompts": len(keys), "promptsSameInAll": agree,
                             "findings": len(union), "findingsInAll": len(inall), "seconds": timing})
            same, total, fsame, ftotal = same + agree, total + len(keys), fsame + len(inall), ftotal + len(union)
            dpop, dsame = dpop + population, dsame + population - len(differ)
            dever, dever_same = dever + len(elements), dever_same + len(elements) - len(differ)
        result[mode] = {
            "pagesComplete": sum(1 for x in per_page if x["complete"]),
            "decisionLevel": {"candidates": dpop, "sameInAll": dsame, "share": None if not dpop else round(dsame / dpop, 3),
                              "wilson95": wilson(dsame, dpop), "target": 0.95, "meetsTarget": None if not dpop else dsame / dpop >= 0.95,
                              "withADecisionInSomeRun": dever, "withADecisionSameInAll": dever_same,
                              "withADecisionShare": None if not dever else round(dever_same / dever, 3), "withADecisionWilson95": wilson(dever_same, dever),
                              "byCriterionAmongThoseWithADecision": {c: {"same": s, "of": t} for c, (s, t) in sorted(by_criterion.items())}},
            "promptLevel": {"prompts": total, "sameInAll": same, "share": None if not total else round(same / total, 3), "wilson95": wilson(same, total),
                            "byKind": {k: {"same": s, "of": t, "share": round(s / t, 3), "wilson95": wilson(s, t)} for k, (s, t) in by_kind.items()}},
            "findings": ftotal, "findingsInAll": fsame, "findingsShare": None if not ftotal else round(fsame / ftotal, 3),
            "pages": per_page,
        }
        r = result[mode]
        print(f"{mode}: {r['pagesComplete']} pages complete; decision level {dsame} of {dpop} candidates the same in all five "
              f"({r['decisionLevel']['share']}, Wilson {r['decisionLevel']['wilson95']}); among those with a decision {dever_same} of {dever}; "
              f"prompt level {same} of {total} ({r['promptLevel']['share']}); findings in all five {fsame} of {ftotal}")
    write_json(os.path.join(HERE, "data", "t4.json"), result)


if __name__ == "__main__":
    main()
