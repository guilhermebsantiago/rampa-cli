"""The fourth study's measures beyond the third study's tables, as pre-registered (preregistration.md).

Reads data/findings.json (analyze.py: every labelled row with its origin), data/pages-input.json, each page's
report.json, noconfirm-report.json and snapshot, data/suggestion-sample.json, and the second and third studies'
summaries. Writes data/extras.json and prints the tables of docs/studies/real-pages-2026-10-round4.md.

- primary: the test split's precision at the default threshold over the judged criteria (main run), Wilson 95%;
  Newcombe's hybrid score interval (method 10) for its difference with the third study's test split and with the
  second study's after the 2.4.4/2.4.6 change; a page-level bootstrap (10,000 resamples, random.Random(20261024)).
- ablation: the --no-confirm run (main rows plus the noconfirm-only rows), and what the second pass removed.
- second pass: the 1.1.1 reading claims confirmed, denied and not asked, from the main reports.
- capture: each snapshot's reach.stylesheets and reach.overlay, a load that timed out, a page cut at the limit.
- cut099: the default-threshold precision without the 1.1.1 findings whose lowest confirming probability is < 0.99.
- suggestions: the drawn sample's share of true failures, and that share times the pool.

Run after analyze.py: python -I study/round-4-2026-10-24/scripts/extras.py
"""

import glob
import json
import math
import os
import random
import sys
from collections import Counter

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STUDY = os.path.dirname(HERE)
Z = 1.959963984540054
SEED = 20261024
DENIED = "did not confirm"
NOT_ASKED = ("cannot answer the second pass", "the second pass has no cached answer", "The second pass could not run")


def read_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def wilson(k, n):
    if n == 0:
        return None
    p = k / n
    d = 1 + Z * Z / n
    c = (p + Z * Z / (2 * n)) / d
    h = Z * math.sqrt(p * (1 - p) / n + Z * Z / (4 * n * n)) / d
    return [max(0.0, c - h), min(1.0, c + h)]


def counts(rows):
    c = Counter(r["final"] for r in rows)
    tp, fp, unc = c["true_positive"], c["false_positive"], c["uncertain"]
    n = tp + fp
    w = wilson(tp, n)
    return {"n": len(rows), "tp": tp, "fp": fp, "uncertain": unc, "decided": n,
            "precision": None if n == 0 else round(tp / n, 3), "wilson95": None if w is None else [round(w[0], 3), round(w[1], 3)]}


def newcombe(k1, n1, k2, n2):
    """Difference p1 - p2 of two independent proportions, Newcombe's hybrid score interval (method 10)."""
    p1, p2 = k1 / n1, k2 / n2
    l1, u1 = wilson(k1, n1)
    l2, u2 = wilson(k2, n2)
    d = p1 - p2
    return {"difference": round(d, 3), "ci95": [round(d - math.sqrt((p1 - l1) ** 2 + (u2 - p2) ** 2), 3), round(d + math.sqrt((u1 - p1) ** 2 + (p2 - l2) ** 2), 3)]}


def reading(diff):
    lo, hi = diff["ci95"]
    return "went up" if lo > 0 else "went down" if hi < 0 else "no measurable change"


def cell(c):
    if c is None or c["n"] == 0:
        return "–"
    p = "–" if c["precision"] is None else f"{c['precision']:.2f}"
    ci = "" if c["wilson95"] is None else f" ({c['wilson95'][0]:.2f}–{c['wilson95'][1]:.2f})"
    return f"{c['tp']} / {c['fp']} / {c['uncertain']}: **{p}**{ci}"


def judgment_findings(report):
    return [f for lst in ("findings", "belowThreshold", "beyondTarget") for f in report.get(lst, []) if f.get("source") == "judgment"]


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    meta = read_json(os.path.join(HERE, "data", "pages-input.json"))
    rows = [r for r in read_json(os.path.join(HERE, "data", "findings.json")) if r.get("auditor")]
    split_of = {p["slug"]: p["split"] for p in meta["pages"]}
    main_rows = [r for r in rows if r["origin"] == "main"]
    judged = lambda rs: [r for r in rs if r["group"] == "judged"]
    out = {}

    # Primary, and the comparison.
    primary = counts([r for r in judged(main_rows) if r["split"] == "test" and r["shown"]])
    s3 = read_json(os.path.join(STUDY, "round-3-2026-10-23", "data", "summary.json"))
    s2a = read_json(os.path.join(STUDY, "fresh-2026-10-11", "data", "after", "summary.json"))
    ref3 = next(r for r in s3["precision"]["test"]["judgedDefault"] if r["key"] == "all")
    ref2 = next(r for r in s2a["precision"]["after"]["test"]["default"] if r["key"] == "all")
    comp = {}
    for name, ref in (("study3Test", ref3), ("study2AfterTest", ref2)):
        d = newcombe(primary["tp"], primary["decided"], ref["truePositive"], ref["decided"]) if primary["decided"] else None
        comp[name] = {"reference": {"tp": ref["truePositive"], "decided": ref["decided"], "precision": ref["precision"], "wilson95": ref["wilson95"]},
                      "difference": d, "reading": reading(d) if d else None}
    # Page-level bootstrap of the primary measure.
    test_pages = [p["slug"] for p in meta["pages"] if p["split"] == "test"]
    per_page = {s: counts([r for r in judged(main_rows) if r["slug"] == s and r["shown"]]) for s in test_pages}
    rng = random.Random(SEED)
    stats, empty = [], 0
    for _ in range(10000):
        pick = [rng.choice(test_pages) for _ in test_pages]
        tp = sum(per_page[s]["tp"] for s in pick)
        n = sum(per_page[s]["decided"] for s in pick)
        if n == 0:
            empty += 1
            continue
        stats.append(tp / n)
    stats.sort()
    boot = None if not stats else {"ci95": [round(stats[int(0.025 * len(stats))], 3), round(stats[min(len(stats) - 1, int(0.975 * len(stats)))], 3)], "resamples": len(stats), "emptyResamples": empty}
    out["primary"] = {"test": primary, "comparison": comp, "pageBootstrap": boot,
                      "dev": counts([r for r in judged(main_rows) if r["split"] == "dev" and r["shown"]])}

    # The ablation: the --no-confirm run's findings are the main run's plus the noconfirm-only rows.
    ablation_rows = [r for r in rows if r["origin"] in ("main", "noconfirm-only")]
    out["ablation"] = {}
    for split in ("dev", "test", "all"):
        sel = lambda rs: [r for r in rs if split == "all" or r["split"] == split]
        out["ablation"][split] = {
            "mainDefault": counts([r for r in sel(judged(main_rows)) if r["shown"]]),
            "noConfirmDefault": counts([r for r in sel(judged(ablation_rows)) if r["shown"]]),
            "mainAll": counts(sel(judged(main_rows))),
            "noConfirmAll": counts(sel(judged(ablation_rows))),
            "removedByPass": counts([r for r in sel(rows) if r["origin"] == "noconfirm-only"]),
            "main111Default": counts([r for r in sel(judged(main_rows)) if r["shown"] and r["criterion"] == "1.1.1"]),
            "noConfirm111Default": counts([r for r in sel(judged(ablation_rows)) if r["shown"] and r["criterion"] == "1.1.1"]),
        }

    # The second pass's shares, from the main reports.
    shares = {"dev": Counter(), "test": Counter()}
    for p in meta["pages"]:
        path = os.path.join(HERE, "pages", p["slug"], "report.json")
        if not os.path.exists(path):
            continue
        report = read_json(path)
        c = shares[p["split"]]
        c["confirmed"] += sum(1 for f in judgment_findings(report) if f["criterion"] == "1.1.1" and f.get("confirmation"))
        for n in report.get("needsReview", []):
            if n.get("criterion") != "1.1.1" or not n.get("model"):
                continue
            ev = n.get("evidence") or ""
            if DENIED in ev:
                c["denied"] += 1
            elif any(m in ev for m in NOT_ASKED):
                c["notAsked"] += 1
        crit = next((x for x in report.get("criteria", []) if x["criterion"] == "1.1.1"), {})
        c["summaryConfirmed"] += crit.get("confirmed") or 0
        c["summaryUnconfirmed"] += crit.get("unconfirmed") or 0
    out["secondPass"] = {s: dict(c) for s, c in shares.items()}

    # Capture state of every page.
    capture = []
    for p in meta["pages"]:
        snaps = glob.glob(os.path.join(HERE, "pages", p["slug"], "recording", "*.snapshot.json"))
        if not snaps:
            capture.append({"slug": p["slug"], "split": p["split"], "snapshot": None})
            continue
        snap = read_json(snaps[0])
        reach = snap.get("reach") or {}
        capture.append({"slug": p["slug"], "split": p["split"], "stylesheets": reach.get("stylesheets"), "overlay": reach.get("overlay"),
                        "loadTimedOutMs": reach.get("loadTimedOutMs"), "truncated": snap.get("truncated") or reach.get("truncated")})
    out["capture"] = capture

    # The 0.99 cut.
    out["cut099"] = {}
    for split in ("dev", "test", "all"):
        shown = [r for r in judged(main_rows) if r["shown"] and (split == "all" or r["split"] == split)]
        low = [r for r in shown if r["criterion"] == "1.1.1" and (r.get("confirmation") or {}).get("minProbability", 1) < 0.99]
        out["cut099"][split] = {"kept": counts([r for r in shown if r not in low]), "removed": counts(low)}

    # The suggestion sample.
    sample = read_json(os.path.join(HERE, "data", "suggestion-sample.json"))
    pool = Counter()
    for v in sample["pages"].values():
        pool[v["split"]] += v["pool"]
    out["suggestions"] = {}
    for split in ("dev", "test", "all"):
        sel = [r for r in rows if r["origin"] == "suggestion-sample" and (split == "all" or r["split"] == split)]
        c = counts(sel)
        size = pool["dev"] + pool["test"] if split == "all" else pool[split]
        est = None
        if c["decided"]:
            est = {"pool": size, "trueFailures": round(c["precision"] * size, 1), "ci95": [round(c["wilson95"][0] * size, 1), round(c["wilson95"][1] * size, 1)]}
        out["suggestions"][split] = {"labelled": c, "byCriterion": {k: counts([r for r in sel if r["criterion"] == k]) for k in sorted({r["criterion"] for r in sel})}, "movedToReview": est}

    with open(os.path.join(HERE, "data", "extras.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print("### Primary: test, default threshold, judged criteria\n")
    print(f"this study: {cell(primary)}")
    for name, v in comp.items():
        print(f"vs {name}: reference {v['reference']['tp']}/{v['reference']['decided']} = {v['reference']['precision']}, difference {v['difference']} -> {v['reading']}")
    print(f"page bootstrap: {boot}")
    print(f"dev: {cell(out['primary']['dev'])}")
    print("\n### Ablation (TP / FP / uncertain)\n")
    print("| Split | Main, default | --no-confirm, default | Main, all | --no-confirm, all | Removed by the pass | 1.1.1 main | 1.1.1 --no-confirm |")
    print("| --- | --- | --- | --- | --- | --- | --- | --- |")
    for split, v in out["ablation"].items():
        print(f"| {split} | {cell(v['mainDefault'])} | {cell(v['noConfirmDefault'])} | {cell(v['mainAll'])} | {cell(v['noConfirmAll'])} | {cell(v['removedByPass'])} | {cell(v['main111Default'])} | {cell(v['noConfirm111Default'])} |")
    print("\n### Second pass\n", json.dumps(out["secondPass"]))
    print("\n### Capture\n")
    for c in capture:
        print(c)
    print("\n### 0.99 cut\n")
    for split, v in out["cut099"].items():
        print(f"{split}: kept {cell(v['kept'])}; removed {cell(v['removed'])}")
    print("\n### Suggestions\n")
    for split, v in out["suggestions"].items():
        print(f"{split}: {cell(v['labelled'])}; moved to review {v['movedToReview']}; by criterion {{{', '.join(f'{k}: {cell(x)}' for k, x in v['byCriterion'].items())}}}")


if __name__ == "__main__":
    main()
