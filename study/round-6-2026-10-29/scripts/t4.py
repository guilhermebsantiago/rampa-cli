"""Five uncached runs (T4; pre-registration, section 5, item 3), on the T4 subset, per mode:

- full: the main run (cache/, report.json) and full2..full5 (cache-full<n>/, full<n>-report.json), on the main snapshot;
- fast: fast1..fast5 (cache-fast<n>/, fast<n>-report.json), on the live --fast snapshot.

A page counts in a mode only when all five of its runs finished (a report exists). The verdict of each judged prompt is
read from each run's judgment cache, one entry per prompt (the same snapshot gives the same prompts): the model's
verdict, or the second pass's one word. A prompt answered in one run and not in another differs. Reported: the share of
prompts with the same answer in all five runs (Wilson), and the share of default-threshold judgment findings (by
fingerprint) present in all five reports; with each page's times (collection and judgment, from run-*.json) for P4.

Run: python -I study/round-6-2026-10-29/scripts/t4.py   (writes data/t4.json; prints counts and shares)
"""
import glob
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import HERE, page_dir, pages, read_json, write_json  # noqa: E402

Z = 1.959963984540054
LEVELS = {"low": 0, "medium": 1, "high": 2}
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


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    result = {}
    for mode, runs in MODES.items():
        same = total = fsame = ftotal = 0
        by_kind = {}
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
            timing = {os.path.basename(x)[4:-5]: read_json(x)["seconds"] for x in glob.glob(os.path.join(base, "run-*.json"))}
            per_page.append({"slug": p["slug"], "split": p["split"], "complete": True, "prompts": len(keys), "sameInAll": agree,
                             "findings": len(union), "findingsInAll": len(inall), "seconds": timing})
            same, total, fsame, ftotal = same + agree, total + len(keys), fsame + len(inall), ftotal + len(union)
        result[mode] = {"pagesComplete": sum(1 for x in per_page if x["complete"]), "prompts": total, "sameInAll": same,
                        "share": None if not total else round(same / total, 3), "wilson95": wilson(same, total),
                        "byKind": {k: {"same": s, "of": t, "share": round(s / t, 3), "wilson95": wilson(s, t)} for k, (s, t) in by_kind.items()},
                        "findings": ftotal, "findingsInAll": fsame, "findingsShare": None if not ftotal else round(fsame / ftotal, 3), "pages": per_page}
        print(f"{mode}: {result[mode]['pagesComplete']} pages complete, {same} of {total} prompts the same in all five "
              f"({result[mode]['share']}, Wilson {result[mode]['wilson95']}); findings in all five {fsame} of {ftotal}")
    write_json(os.path.join(HERE, "data", "t4.json"), result)


if __name__ == "__main__":
    main()
