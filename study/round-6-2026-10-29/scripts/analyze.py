"""Numbers of the sixth real-page study (pre-registration, sections 4 and 5): the fifth study's analyze.py and extras.py,
with this round's labels (three answers and a derived label), its ablations, the pass sample and Wilson's interval as
the one that decides. Run after every label file is written and checked (scripts/check_labels.py):

  python -I study/round-6-2026-10-29/scripts/analyze.py

Inputs (this study's folder): data/pages-input.json; data/findings-raw.json (packets.py); labels/<packet>.<role>.json;
pages/<slug>/*.judged.json and run-*.json (compact.py); data/suggestion-sample.json; data/pass-outcomes.json and
data/pass-draw.json; data/p1-facts.json; and, for what axe-core reports on the same element, each page's full report in
DATA (common.py). Outputs: data/findings.json (one row per labelled item with both judges' answers and labels, the
format Rampa Lab's review mode reads, with data/pages.json), data/pages.json, data/summary.json; prints the numbers.

Final label: the label both judges gave, else uncertain; a false positive's cause the one both named, else disputed.
Precision TP / (TP + FP), uncertain left out; Wilson 95% intervals; page bootstraps of 10,000 resamples with
random.Random(20261029); Newcombe's method 10 for differences. Every number here is AI-judged.
"""
import glob
import math
import os
import random
import sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import HERE, page_dir, pages, read_json, write_json  # noqa: E402

LABELS = ("true_positive", "false_positive", "uncertain")
CRITERIA = ("1.1.1", "1.3.5", "2.4.2", "2.4.4", "2.4.6", "3.1.1", "3.1.2", "3.3.2")
SEED, ROUNDS, BURST = 20261029, 10000, 5
Z = 1.959963984540054
ABLATIONS = ("noverify", "noconfirm", "nop2", "nollm")


def wilson(k, n):
    if n == 0:
        return None
    p, d = k / n, 1 + Z * Z / n
    c, h = (p + Z * Z / (2 * n)) / d, Z * math.sqrt(p * (1 - p) / n + Z * Z / (4 * n * n)) / d
    return [round(max(0.0, c - h), 3), round(min(1.0, c + h), 3)]


def newcombe(k1, n1, k2, n2):
    if not n1 or not n2:
        return None
    p1, p2 = k1 / n1, k2 / n2
    (l1, u1), (l2, u2) = wilson(k1, n1), wilson(k2, n2)
    d = p1 - p2
    return {"difference": round(d, 3), "ci95": [round(d - math.sqrt((p1 - l1) ** 2 + (u2 - p2) ** 2), 3), round(d + math.sqrt((u1 - p1) ** 2 + (p2 - l2) ** 2), 3)]}


def percentile_ci(values):
    values = sorted(values)
    return [round(values[int(0.025 * len(values))], 3), round(values[min(len(values) - 1, int(0.975 * len(values)))], 3)]


def prec(rows):
    c = Counter(r["final"] for r in rows)
    tp, fp = c["true_positive"], c["false_positive"]
    return {"n": len(rows), "tp": tp, "fp": fp, "uncertain": c["uncertain"], "decided": tp + fp,
            "precision": None if tp + fp == 0 else round(tp / (tp + fp), 3), "wilson95": wilson(tp, tp + fp), "pages": len({r["slug"] for r in rows})}


def per_page(rows, slugs):
    out = {s: [0, 0] for s in slugs}
    for r in rows:
        if r["slug"] in out and r["final"] != "uncertain":
            out[r["slug"]][0] += r["final"] == "true_positive"
            out[r["slug"]][1] += 1
    return out


def bootstrap(counts):
    rng, slugs, stats, empty = random.Random(SEED), sorted(counts), [], 0
    for _ in range(ROUNDS):
        pick = [slugs[rng.randrange(len(slugs))] for _ in slugs]
        n = sum(counts[s][1] for s in pick)
        if n == 0:
            empty += 1
            continue
        stats.append(sum(counts[s][0] for s in pick) / n)
    return None if not stats else {"ci95": percentile_ci(stats), "resamples": len(stats), "emptyResamples": empty}


def bootstrap_difference(a, b, paired):
    """a - b by page resampling: the same pages for both when paired, else each set resampled on its own."""
    rng, diffs, empty = random.Random(SEED), [], 0
    sa, sb = sorted(a), sorted(b)
    for _ in range(ROUNDS):
        pa = [sa[rng.randrange(len(sa))] for _ in sa]
        pb = pa if paired else [sb[rng.randrange(len(sb))] for _ in sb]
        ta, na = sum(a[s][0] for s in pa), sum(a[s][1] for s in pa)
        tb, nb = sum(b[s][0] for s in pb), sum(b[s][1] for s in pb)
        if na == 0 or nb == 0:
            empty += 1
            continue
        diffs.append(ta / na - tb / nb)
    return None if not diffs else {"ci95": percentile_ci(diffs), "resamples": len(diffs), "emptyResamples": empty}


def direction(newc, boot):
    if not newc or not boot:
        return "no measurable change"
    if newc["ci95"][0] > 0 and boot["ci95"][0] > 0:
        return "went up"
    if newc["ci95"][1] < 0 and boot["ci95"][1] < 0:
        return "went down"
    return "no measurable change"


def reading(p):
    """Section 4: Wilson's lower bound decides."""
    if p["precision"] is None:
        return "no decided finding"
    if p["wilson95"][0] < 0.80:
        return "inconclusive"
    return "favourable" if p["precision"] >= 0.90 else "under the target"


def kappa(pairs, cats):
    n = len(pairs)
    if not n:
        return None
    po = sum(a == b for a, b in pairs) / n
    ca, cb = Counter(a for a, _ in pairs), Counter(b for _, b in pairs)
    pe = sum(ca[c] * cb[c] for c in cats) / (n * n)
    return {"n": n, "observed": round(po, 3), "kappa": None if pe == 1 else round((po - pe) / (1 - pe), 3)}


def units(rows):
    """Per group: one unit per (page, criterion, claim) with more than BURST findings (its label the majority, a tie
    uncertain), else one per finding."""
    by = defaultdict(list)
    for r in rows:
        by[(r["slug"], r["criterion"], r.get("claim") or r.get("ruleId") or "")].append(r)
    out = []
    for (slug, crit, claim), members in sorted(by.items()):
        if len(members) > BURST:
            c = Counter(m["final"] for m in members)
            v = sorted(((c[l], l) for l in LABELS), reverse=True)
            out.append({"slug": slug, "criterion": crit, "claim": claim, "size": len(members), "final": "uncertain" if v[0][0] == v[1][0] else v[0][1],
                        "tp": c["true_positive"], "fp": c["false_positive"], "uncertain": c["uncertain"]})
        else:
            out += [{"slug": m["slug"], "criterion": crit, "claim": claim, "size": 1, "final": m["final"]} for m in members]
    return out


def compact(slug, run):
    path = os.path.join(HERE, "pages", slug, f"{run}.judged.json")
    return read_json(path) if os.path.exists(path) else None


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    meta = {p["slug"]: p for p in pages()}
    split_pages = {s: sorted(k for k, p in meta.items() if p["split"] == s) for s in ("dev", "test")}
    split_pages["all"] = sorted(meta)
    raw = read_json(os.path.join(HERE, "data", "findings-raw.json"))
    labels = {}
    for path in glob.glob(os.path.join(HERE, "labels", "*.json")):
        packet, role = os.path.basename(path)[:-5].rsplit(".", 1)
        labels[(packet, role)] = {j["fingerprint"]: j for j in read_json(path)["judgments"]}
    rows, missing = [], []
    for r in raw:
        a, s = labels.get((r["packet"], "auditor"), {}).get(r["key"]), labels.get((r["packet"], "skeptic"), {}).get(r["key"])
        row = dict(r)
        if a is None or s is None:
            missing.append(f"{r['packet']}:{r['key']}")
            row.update(final="uncertain", finalCause=None, failsAnyReason="uncertain", labelled=False, auditor=None, skeptic=None)
        else:
            final = a["label"] if a["label"] == s["label"] else "uncertain"
            ef = {a.get("answers", {}).get("elementFails"), s.get("answers", {}).get("elementFails")}
            row.update(auditor={k: a.get(k) for k in ("answers", "label", "cause", "rationale")}, skeptic={k: s.get(k) for k in ("answers", "label", "cause", "rationale")},
                       final=final, finalCause=(a["cause"] if a["cause"] == s["cause"] else "disputed") if final == "false_positive" else None,
                       failsAnyReason="true_positive" if ef == {"yes"} else "false_positive" if ef == {"no"} else "uncertain", labelled=True)
        rows.append(row)
    if missing:
        print(f"warning: {len(missing)} items have no labels yet", file=sys.stderr)

    def sel(split="all", origin="main", kind="judgment", shown=True):
        out = [r for r in rows if (split == "all" or r["split"] == split) and (r.get("origin") == origin or origin in (r.get("origins") or []))]
        out = [r for r in out if kind is None or r["kind"] == kind]
        return [r for r in out if shown is None or bool(r["shown"]) == shown]

    summary = {"missingLabels": len(missing)}
    # Section 4: the primary measure, then pooled and dev beside it.
    primary = {}
    for split in ("test", "all", "dev"):
        p = prec(sel(split))
        primary[split] = {**p, "pageBootstrap": bootstrap(per_page(sel(split), split_pages[split])), "reading": reading(p)}
    primary["test"]["atLeast70Decided"] = primary["test"]["decided"] >= 70
    summary["primary"] = primary
    # Section 5, item 5: every finding, per criterion, per group, per page, sensitivity, fails for any reason, experimental.
    summary["everyFinding"] = {s: prec(sel(s, shown=None)) for s in ("test", "dev", "all")}
    summary["byCriterion"] = {s: {c: prec([r for r in sel(s) if r["criterion"] == c]) for c in CRITERIA} for s in ("test", "dev", "all")}
    summary["perGroup"] = {s: {**prec(units(sel(s))), "groups": [u for u in units(sel(s)) if u["size"] > 1]} for s in ("test", "dev", "all")}
    summary["perBlock"] = {f"{s} block {b}": prec([r for r in sel(s) if r.get("block") == b]) for s in ("test", "dev") for b in (1, 2, 3)}
    page_level = {}
    for s in ("test", "dev", "all"):
        pp = {k: v for k, v in per_page(sel(s), split_pages[s]).items() if v[1]}
        page_level[s] = {"pagesWithDecided": len(pp), "allTrue": sum(v[0] == v[1] for v in pp.values()),
                         "meanPrecision": None if not pp else round(sum(v[0] / v[1] for v in pp.values()) / len(pp), 3)}
    summary["perPage"] = page_level
    sens = {}
    for s in ("test", "dev"):
        sr = sel(s)
        if sr:
            top, n = Counter(r["slug"] for r in sr).most_common(1)[0]
            c = Counter(r["final"] for r in sr)
            sens[s] = {"topPageFindings": n, "withoutTopPage": prec([r for r in sr if r["slug"] != top]),
                       "uncertainAsTrue": round((c["true_positive"] + c["uncertain"]) / len(sr), 3), "uncertainAsFalse": round(c["true_positive"] / len(sr), 3)}
    summary["sensitivity"] = sens
    summary["failsAnyReason"] = {s: prec([{**r, "final": r["failsAnyReason"]} for r in sel(s)]) for s in ("test", "dev", "all")}
    summary["experimental"] = {s: dict(Counter(f"{r.get('ruleId') or 'judgment ' + r['criterion']}: {r['final']}" for r in rows
                                               if (s == "all" or r["split"] == s) and r.get("origin") == "main" and r["kind"] != "judgment")) for s in ("test", "dev")}
    summary["falsePositiveCauses"] = {s: dict(Counter(f"{r.get('ruleId') or 'judgment ' + r['criterion']} | {r['finalCause']}" for r in rows
                                                      if r["split"] == s and r["final"] == "false_positive")) for s in ("test", "dev")}
    # The fifth study, for the comparison (its data/findings.json; test 20 of 24, both halves 51 of 63).
    r5 = read_json(os.path.join(os.path.dirname(HERE), "round-5-2026-10-28", "data", "findings.json"))
    r5m = [r for r in r5 if r.get("origin", "main") == "main" and r["group"] == "judged" and r["shown"]]
    comparison = {}
    for s, s5 in (("test", "test"), ("all", "all")):
        a = sel(s)
        b = [r for r in r5m if s5 == "all" or r["split"] == s5]
        pa, pb = prec(a), prec(b)
        nc = newcombe(pa["tp"], pa["decided"], pb["tp"], pb["decided"])
        bd = bootstrap_difference(per_page(a, split_pages[s]), per_page(b, sorted({r["slug"] for r in r5 if s5 == "all" or r["split"] == s5})), paired=False)
        comparison[s] = {"round5": pb, "newcombe": nc, "pageBootstrap": bd, "reading": direction(nc, bd)}
    summary["comparisonWithRound5"] = comparison

    # Section 5, item 2: the ablations, each by the labels of its default-threshold judgment findings.
    by_fp = defaultdict(dict)
    for r in rows:
        by_fp[r["slug"]][r["fingerprint"]] = r
    ablations = {}
    for run in ABLATIONS:
        out = {}
        for s in ("test", "dev", "all"):
            mine, unlabelled = [], 0
            for slug in split_pages[s]:
                rep = compact(slug, run)
                if rep is None:
                    continue
                for f in rep.get("findings", []) + rep.get("belowThreshold", []):
                    lv = {"low": 0, "medium": 1, "high": 2}.get(f.get("confidence"), 0)
                    if f.get("source") != "judgment" or f.get("experimental") or lv < 1 or (f.get("subject") or "").startswith("hidden "):
                        continue
                    r = by_fp[slug].get(f["fingerprint"])
                    if r is None:
                        unlabelled += 1
                    else:
                        mine.append(r)
            pa, pm = prec(mine), prec(sel(s))
            nc = newcombe(pa["tp"], pa["decided"], pm["tp"], pm["decided"])
            bd = bootstrap_difference(per_page(mine, split_pages[s]), per_page(sel(s), split_pages[s]), paired=True)
            out[s] = {**pa, "unlabelled": unlabelled, "againstMain": nc, "pageBootstrap": bd, "reading": direction(nc, bd)}
        if run == "nollm":
            out["ruleFindingsDefault"] = sum(1 for slug in meta for f in (compact(slug, run) or {}).get("findings", []) if f.get("source") == "rule" and not f.get("experimental"))
            out["trueJudgedLost"] = {s: prec(sel(s))["tp"] for s in ("test", "dev", "all")}
        ablations[run] = out
    p1 = os.path.join(HERE, "data", "p1-facts.json")
    if os.path.exists(p1):
        facts = read_json(p1)["links"]
        on = {(l["slug"], l["ref"]) for l in facts}
        ablations["p1Facts"] = {s: {"linksDiffer": sum(1 for l in facts if s == "all" or l["split"] == s),
                                    "mainFindingsOnThem": prec([r for r in sel(s) if r["criterion"] == "2.4.4" and (r["slug"], r.get("ref")) in on])} for s in ("test", "dev", "all")}
    summary["ablations"] = ablations

    # Section 5, item 5: the suggestion sample, per reason and split.
    sample = [r for r in rows if r.get("origin") == "suggestion-sample"]
    summary["suggestions"] = {f"{s} {reason}": prec([r for r in sample if r["split"] == s and r.get("sampleReason") == reason])
                              for s in ("test", "dev") for reason in ("unstyled", "2.4.2", "3.3.2", "seeded")}

    # Section 5, item 7: recall among the candidates Rampa judged, 1.1.1 and 2.4.4, test half.
    po, pd = os.path.join(HERE, "data", "pass-outcomes.json"), os.path.join(HERE, "data", "pass-draw.json")
    if os.path.exists(po) and os.path.exists(pd):
        outcomes, drawn = read_json(po), read_json(pd)["items"]
        item_label = {}
        for r in rows:
            if r.get("passStratum"):
                item_label[(r["slug"], r["criterion"], r.get("ref"))] = r["final"]
        test = split_pages["test"]
        pop = defaultdict(Counter)
        for row in outcomes["rows"]:
            pop[(row["criterion"], row["outcome"])][row["slug"]] += 1
        recall = {}
        for crit in ("1.1.1", "2.4.4"):
            items = [(d["slug"], d["stratum"], item_label.get((d["slug"], crit, d["ref"]), "uncertain")) for d in drawn if d["criterion"] == crit]
            found = [r for r in sel("test") if r["criterion"] == crit]
            below_true = sum(1 for r in sel("test", shown=False) if r["criterion"] == crit and r["final"] == "true_positive")

            def estimate(pick, unc):
                misses, strata = below_true * 0, {}
                weight = Counter(pick)
                for stratum in ("passed", "discarded", "held_back"):
                    n_h = sum(pop[(crit, stratum)][s] * weight[s] for s in weight)
                    dec = [(lab if lab != "uncertain" else unc) for s, st, lab in items if st == stratum for _ in range(weight[s])]
                    dec = [x for x in dec if x in ("true_positive", "false_positive")]
                    full = [(lab if lab != "uncertain" else unc) for _, st, lab in items if st == stratum]
                    full = [x for x in full if x in ("true_positive", "false_positive")]
                    p_h = (sum(x == "true_positive" for x in dec) / len(dec)) if dec else (sum(x == "true_positive" for x in full) / len(full) if full else 0.0)
                    strata[stratum] = {"N": n_h, "decided": len(dec), "failing": sum(x == "true_positive" for x in dec), "p": round(p_h, 3), "wilson95": wilson(sum(x == "true_positive" for x in dec), len(dec))}
                    misses += n_h * p_h
                below = sum(1 for r in sel("test", shown=False) if r["criterion"] == crit and r["final"] == "true_positive" and weight[r["slug"]] for _ in range(weight[r["slug"]]))
                tp = sum(weight[r["slug"]] for r in found if r["final"] == "true_positive")
                total = tp + misses + below
                return (None if total == 0 else tp / total), strata, misses + below

            point, strata, misses = estimate(test, None)
            rng, stats = random.Random(SEED), []
            for _ in range(ROUNDS):
                value = estimate([test[rng.randrange(len(test))] for _ in test], None)[0]
                if value is not None:
                    stats.append(value)
            recall[crit] = {"recall": None if point is None else round(point, 3), "bootstrap95": percentile_ci(stats) if stats else None, "strata": strata,
                            "estimatedMisses": round(misses, 1), "uncertainAsFailing": estimate(test, "true_positive")[0], "uncertainAsNotFailing": estimate(test, "false_positive")[0],
                            "notDrawn": outcomes["counts"][crit]}
        summary["recallAmongJudged"] = recall

    # Section 5, item 1: true default-threshold judged findings on the test half that axe-core does not report.
    true_test = [r for r in sel("test") if r["final"] == "true_positive"]
    same, anyc = 0, 0
    for r in true_test:
        rep_path = os.path.join(page_dir(r["slug"]), "report.json")
        if not os.path.exists(rep_path):
            continue
        engine = [f for lst in ("findings", "belowThreshold", "beyondTarget") for f in read_json(rep_path).get(lst) or [] if f.get("source") == "engine" and f.get("ref") == r.get("ref")]
        same += not any(f["criterion"] == r["criterion"] for f in engine)
        anyc += not engine
    summary["notReportedByAxe"] = {"trueFindings": len(true_test), "sameCriterion": same, "sameCriterionWilson95": wilson(same, len(true_test)),
                                   "anyCriterion": anyc, "criteriaWithATrueFinding": sorted({r["criterion"] for r in true_test})}

    # Section 5, item 6: the judges' agreement (consistency, not validity).
    lab = [r for r in rows if r["labelled"]]
    pairs = lambda rs: [(r["auditor"]["label"], r["skeptic"]["label"]) for r in rs]
    both_fp = [r for r in lab if r["auditor"]["label"] == r["skeptic"]["label"] == "false_positive"]
    summary["agreement"] = {"all": kappa(pairs(lab), LABELS), "judged": kappa(pairs([r for r in lab if r["kind"] == "judgment"]), LABELS),
                            "other": kappa(pairs([r for r in lab if r["kind"] != "judgment"]), LABELS),
                            "byCriterion": {c: kappa(pairs([r for r in lab if r["kind"] == "judgment" and r["criterion"] == c]), LABELS) for c in CRITERIA},
                            "causes": kappa([(r["auditor"]["cause"], r["skeptic"]["cause"]) for r in both_fp], sorted({r["auditor"]["cause"] for r in both_fp} | {r["skeptic"]["cause"] for r in both_fp}))}

    # Section 5, item 4: time and model use per page (main run), collection plus judgment.
    page_rows = []
    for slug, p in meta.items():
        runs = {os.path.basename(x)[4:-5]: read_json(x) for x in glob.glob(os.path.join(HERE, "pages", slug, "run-*.json"))}
        rep = compact(slug, "report") or {}
        collect = [v for k, v in sorted(runs.items()) if k.startswith("main-collect")]
        judged = runs.get("main-judged")
        usage = rep.get("usage") or {}
        page_rows.append({"slug": slug, "split": p["split"], "block": p["block"], "url": p["url"], "collectSeconds": collect[-1]["seconds"] if collect else None,
                          "judgedSeconds": judged["seconds"] if judged else None, "calls": usage.get("calls"), "inputTokens": usage.get("inputTokens"),
                          "outputTokens": usage.get("outputTokens"), "capture": rep.get("capture"), "errors": rep.get("errors")})
    totals = sorted((r["collectSeconds"] or 0) + (r["judgedSeconds"] or 0) for r in page_rows if r["judgedSeconds"] is not None)
    summary["time"] = {"pages": len(totals), "median": totals[len(totals) // 2] if totals else None, "p90": totals[int(0.9 * (len(totals) - 1))] if totals else None}

    keep = ("slug", "split", "block", "packet", "key", "fingerprint", "origin", "origins", "criterion", "level", "source", "ruleId", "kind", "shown",
            "experimental", "confidence", "ref", "subject", "message", "evidence", "patch", "html", "claim", "sampleReason", "passStratum",
            "auditor", "skeptic", "final", "finalCause", "failsAnyReason")
    write_json(os.path.join(HERE, "data", "findings.json"), [{k: r.get(k) for k in keep} for r in rows])
    write_json(os.path.join(HERE, "data", "pages.json"), page_rows)
    write_json(os.path.join(HERE, "data", "summary.json"), summary)
    for s in ("test", "all", "dev"):
        p = primary[s]
        print(f"{s:4} default judged: {p['tp']} TP / {p['fp']} FP / {p['uncertain']} unc, precision {p['precision']} Wilson {p['wilson95']} "
              f"bootstrap {(p['pageBootstrap'] or {}).get('ci95')} -> {p['reading']}")
    print("test decided findings:", primary["test"]["decided"], "(70 or more:", primary["test"]["atLeast70Decided"], ")")
    print("ablations:", {k: {s: v[s]["precision"] for s in ("test", "all")} for k, v in ablations.items() if k != "p1Facts"})
    print("agreement:", summary["agreement"]["all"], "judged:", summary["agreement"]["judged"])


if __name__ == "__main__":
    main()
