"""Numbers of the eighth real-page study (pre-registration, sections 4 and 5): the seventh study's analyze.py with this
round's seed and its pre-registered secondary measures: (a) the primary measure without judged 2.4.4, (b) 2.4.4 alone,
(c) the page bootstrap, (d) same-name link sets, (e) the uncertain share, (f) per criterion, (g) T4 at the decision
level (data/t4.json) and (h) the cost of the shared-text proof rule (X6: data/x6-sample.json and the drawn claims'
labels); the comparison is with the seventh study. Run after every label file is written and checked
(scripts/check_labels.py):

  python -I study/round-8-2026-11-21/scripts/analyze.py

Inputs (this study's folder): data/pages-input.json; data/findings-raw.json (packets.py); labels/<packet>.<role>.json;
pages/<slug>/*.judged.json and run-*.json (compact.py); data/suggestion-sample.json; data/pass-outcomes.json,
data/pass-draw.json and data/x6-sample.json; data/t4.json (t4.py); the seventh study's folder for the comparison
(ROUND7 overrides its path: its data/findings-raw.json and labels/, which the seventh study's own branch holds); and,
for what axe-core reports on the same element, each page's full report in DATA (common.py). Outputs: data/findings.json
(one row per labelled item with both judges' answers and labels, the format Rampa Lab's review mode reads, with
data/pages.json), data/pages.json, data/summary.json; prints the numbers.

The primary population is the pages whose split is "test" (in this study, all 60). Checked before the freeze on a copy
of the seventh study's folder with its labels (outside the repository). Final label: the label both judges gave, else
uncertain; a false positive's cause the one both named, else disputed. Precision TP / (TP + FP), uncertain left out;
Wilson 95% intervals decide; page bootstraps of 10,000 resamples with random.Random(202611218); Newcombe's method 10 for
differences. Every number here is AI-judged.
"""
import glob
import math
import os
import random
import re
import sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import HERE, page_dir, pages, read_json, write_json  # noqa: E402

LABELS = ("true_positive", "false_positive", "uncertain")
CRITERIA = ("1.1.1", "1.3.5", "2.4.2", "2.4.4", "2.4.6", "3.1.1", "3.1.2", "3.3.2")
SEED, ROUNDS, BURST = 202611218, 10000, 5
Z = 1.959963984540054
ABLATIONS = ("noverify", "noconfirm", "nollm")
LEVELS = {"low": 0, "medium": 1, "high": 2}
UNCERTAIN_TARGET = 0.15
DECIDED_THRESHOLD = 70
ROUND7 = os.environ.get("ROUND7") or os.path.join(os.path.dirname(HERE), "round-7-2026-11-21")


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
    """Section 4: the article's rule; Wilson's lower bound decides."""
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


def majority(members):
    c = Counter(m["final"] for m in members)
    v = sorted(((c[l], l) for l in LABELS), reverse=True)
    return "uncertain" if v[0][0] == v[1][0] else v[0][1], c


def units(rows):
    """Per group: one unit per (page, criterion, claim) with more than BURST findings (its label the majority, a tie
    uncertain), else one per finding."""
    by = defaultdict(list)
    for r in rows:
        by[(r["slug"], r["criterion"], r.get("claim") or r.get("ruleId") or "")].append(r)
    out = []
    for (slug, crit, claim), members in sorted(by.items()):
        if len(members) > BURST:
            final, c = majority(members)
            out.append({"slug": slug, "criterion": crit, "claim": claim, "size": len(members), "final": final,
                        "tp": c["true_positive"], "fp": c["false_positive"], "uncertain": c["uncertain"]})
        else:
            out += [{"slug": m["slug"], "criterion": crit, "claim": claim, "size": 1, "final": m["final"]} for m in members]
    return out


SHARED = re.compile(r'^The link text "(.*)" is shared by \d+ links', re.S)


def shared_text(r):
    """The normalised link text of a 2.4.4 shared-text finding (claim `ambiguous`, "is shared by"), else None."""
    if r["criterion"] != "2.4.4" or r.get("claim") != "ambiguous":
        return None
    m = SHARED.match(r.get("message") or "")
    text = m.group(1) if m else (r.get("subject") or r.get("ref") or "")
    return re.sub(r"\s+", " ", text).strip().lower()


def same_name_units(rows):
    """Section 5, item 2: one unit per same-name link set (page and normalised text of the shared-text findings), its
    label the majority of its members' final labels (a tie uncertain); every other finding one unit."""
    sets, out = defaultdict(list), []
    for r in rows:
        key = shared_text(r)
        if key is None:
            out.append({"slug": r["slug"], "criterion": r["criterion"], "size": 1, "final": r["final"]})
        else:
            sets[(r["slug"], key)].append(r)
    groups = []
    for (slug, key), members in sorted(sets.items()):
        final, c = majority(members)
        unit = {"slug": slug, "criterion": "2.4.4", "text": key, "size": len(members), "final": final,
                "tp": c["true_positive"], "fp": c["false_positive"], "uncertain": c["uncertain"]}
        out.append(unit)
        groups.append(unit)
    return out, groups


def final_rows(folder):
    """Another round's labelled rows with final labels (the rule above), from its data/findings-raw.json and labels/; None
    when the folder has no label file."""
    raw_path = os.path.join(folder, "data", "findings-raw.json")
    paths = glob.glob(os.path.join(folder, "labels", "*.json"))
    if not os.path.exists(raw_path) or not paths:
        return None
    labels = {}
    for path in paths:
        packet, role = os.path.basename(path)[:-5].rsplit(".", 1)
        labels[(packet, role)] = {j["fingerprint"]: j for j in read_json(path)["judgments"]}
    out = []
    for r in read_json(raw_path):
        a, s = labels.get((r["packet"], "auditor"), {}).get(r["key"]), labels.get((r["packet"], "skeptic"), {}).get(r["key"])
        out.append({**r, "final": "uncertain" if a is None or s is None or a["label"] != s["label"] else a["label"]})
    return out


def compact(slug, run):
    path = os.path.join(HERE, "pages", slug, f"{run}.judged.json")
    return read_json(path) if os.path.exists(path) else None


def default_judged(report):
    """Default-threshold judgment findings of the eight criteria, by fingerprint (as the primary measure counts them)."""
    out = {}
    for lst in ("findings", "belowThreshold"):
        for f in report.get(lst) or []:
            if f.get("source") == "judgment" and f.get("criterion") in CRITERIA and not f.get("experimental") \
                    and LEVELS.get(f.get("confidence"), 0) >= 1 and not (f.get("subject") or "").startswith("hidden "):
                out[f["fingerprint"]] = f
    return out


def visual(r):
    return any(((r.get(role) or {}).get("rationale") or "").lstrip().startswith("[visual context]") for role in ("auditor", "skeptic"))


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    meta = {p["slug"]: p for p in pages()}
    splits = ["test"] + [s for s in ("dev",) if any(p["split"] == s for p in meta.values())]
    split_pages = {s: sorted(k for k, p in meta.items() if p["split"] == s) for s in splits}
    split_pages["all"] = sorted(meta)
    views = splits + (["all"] if len(splits) > 1 else [])
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

    def sel(split="test", origin="main", kind="judgment", shown=True):
        out = [r for r in rows if (split == "all" or r["split"] == split) and (r.get("origin") == origin or origin in (r.get("origins") or []))]
        out = [r for r in out if kind is None or r["kind"] == kind]
        return [r for r in out if shown is None or bool(r["shown"]) == shown]

    summary = {"missingLabels": len(missing), "labelsAre": "AI-judged (two Claude judges; final label by agreement)"}
    # Section 4: the primary measure and the decision rule.
    primary = {}
    for split in views:
        p = prec(sel(split))
        primary[split] = {**p, "pageBootstrap": bootstrap(per_page(sel(split), split_pages[split])), "reading": reading(p)}
    primary["test"]["atLeast70Decided"] = primary["test"]["decided"] >= DECIDED_THRESHOLD
    primary["test"]["rule"] = "favourable: precision >= 0.90 and Wilson lower bound >= 0.80; inconclusive: lower bound < 0.80; under the target: precision < 0.90 and lower bound >= 0.80"
    summary["primary"] = primary
    # Section 5, co-registered: same-name link sets, uncertain share, per criterion, T4.
    co = {}
    for split in views:
        u, groups = same_name_units(sel(split))
        co[split] = {"sameNameSets": {**prec(u), "sets": len(groups), "findingsInSets": sum(g["size"] for g in groups),
                                      "setsOnly": prec(groups), "groups": groups},
                     "uncertainShare": {"uncertain": primary[split]["uncertain"], "of": primary[split]["n"],
                                        "share": None if not primary[split]["n"] else round(primary[split]["uncertain"] / primary[split]["n"], 3),
                                        "target": UNCERTAIN_TARGET,
                                        "meetsTarget": None if not primary[split]["n"] else primary[split]["uncertain"] / primary[split]["n"] <= UNCERTAIN_TARGET},
                     "byCriterion": {c: prec([r for r in sel(split) if r["criterion"] == c]) for c in CRITERIA}}
    t4_path = os.path.join(HERE, "data", "t4.json")
    if os.path.exists(t4_path):
        t4 = read_json(t4_path)
        co["t4"] = {mode: {k: v for k, v in t4[mode].items() if k != "pages"} for mode in t4}
    summary["coRegistered"] = co
    # Pre-registered secondary measures (a) and (b): the primary measure without judged 2.4.4, and 2.4.4 alone. Neither
    # decides; (a) is read by the same rule so that the number exists before the author decides whether judged 2.4.4
    # stays in the default.
    secondary = {}
    for split in views:
        rest = [r for r in sel(split) if r["criterion"] != "2.4.4"]
        only = [r for r in sel(split) if r["criterion"] == "2.4.4"]
        pa, pb = prec(rest), prec(only)
        secondary[split] = {
            "a_withoutJudged244": {**pa, "pageBootstrap": bootstrap(per_page(rest, split_pages[split])), "readingByTheRule": reading(pa),
                                   "atLeast70Decided": pa["decided"] >= DECIDED_THRESHOLD},
            "b_judged244Alone": {**pb, "pageBootstrap": bootstrap(per_page(only, split_pages[split]))},
        }
    # (h) The cost of the shared-text proof rule: the claims it moved to suggestions, and the drawn ones' labels.
    x6_path = os.path.join(HERE, "data", "x6-sample.json")
    if os.path.exists(x6_path):
        x6 = read_json(x6_path)
        drawn = [r for r in rows if r.get("x6Rank")]
        px = prec(drawn)
        n_pop = x6["population"]
        share, bounds = px["precision"], px["wilson95"]
        secondary["h_sharedTextProofRule"] = {
            "moved": x6["moved"], "movedByConfidence": x6["movedByConfidence"], "atDefaultThreshold": n_pop, "drawn": x6["drawn"],
            "labelled": len(drawn), "sample": px,
            "estimatedRealFailuresAtDefaultThreshold": None if share is None else round(share * n_pop, 1),
            "estimatedRange95": None if bounds is None else [round(bounds[0] * n_pop, 1), round(bounds[1] * n_pop, 1)],
            "note": "the share of true failures among the drawn claims (uncertain left out), times the claims moved at the default threshold",
        }
    summary["secondary"] = secondary
    # Section 5, secondary: every finding, per group, per block, per page, sensitivity, fails for any reason, experimental.
    summary["everyFinding"] = {s: prec(sel(s, shown=None)) for s in views}
    summary["perGroup"] = {s: {**prec(units(sel(s))), "groups": [u for u in units(sel(s)) if u["size"] > 1]} for s in views}
    blocks = sorted({p["block"] for p in meta.values()})
    summary["perBlock"] = {f"{s} block {b}": prec([r for r in sel(s) if r.get("block") == b]) for s in splits for b in blocks}
    page_level = {}
    for s in views:
        pp = {k: v for k, v in per_page(sel(s), split_pages[s]).items() if v[1]}
        page_level[s] = {"pagesWithDecided": len(pp), "allTrue": sum(v[0] == v[1] for v in pp.values()),
                         "meanPrecision": None if not pp else round(sum(v[0] / v[1] for v in pp.values()) / len(pp), 3)}
    summary["perPage"] = page_level
    sens = {}
    for s in splits:
        sr = sel(s)
        if sr:
            top, n = Counter(r["slug"] for r in sr).most_common(1)[0]
            c = Counter(r["final"] for r in sr)
            sens[s] = {"topPageFindings": n, "withoutTopPage": prec([r for r in sr if r["slug"] != top]),
                       "uncertainAsTrue": round((c["true_positive"] + c["uncertain"]) / len(sr), 3), "uncertainAsFalse": round(c["true_positive"] / len(sr), 3)}
    summary["sensitivity"] = sens
    summary["failsAnyReason"] = {s: prec([{**r, "final": r["failsAnyReason"]} for r in sel(s)]) for s in views}
    summary["visualContext"] = {s: {"items": prec([r for r in sel(s) if visual(r)]), "withoutThem": prec([r for r in sel(s) if not visual(r)])} for s in views}
    summary["experimental"] = {s: dict(Counter(f"{r.get('ruleId') or 'judgment ' + r['criterion']}: {r['final']}" for r in rows
                                               if r["split"] == s and r.get("origin") == "main" and r["kind"] != "judgment")) for s in splits}
    summary["falsePositiveCauses"] = {s: dict(Counter(f"{r.get('ruleId') or 'judgment ' + r['criterion']} | {r['finalCause']}" for r in rows
                                                      if r["split"] == s and r["final"] == "false_positive")) for s in splits}
    # The seventh study (60 test pages, the code before its own fixes), for the comparison; exploratory, different pages.
    r7_all = final_rows(ROUND7)
    if r7_all is None:
        summary["comparisonWithRound7"] = {"note": f"no labels in {ROUND7}: set ROUND7 to the seventh study's folder with its labels"}
    else:
        r7 = [r for r in r7_all if r.get("origin") == "main" and r.get("kind") == "judgment" and r.get("shown") and r.get("split") == "test"]
        r7_pages = sorted({r["slug"] for r in r7_all if r.get("split") == "test"})
        a, pa, pb = sel("test"), prec(sel("test")), prec(r7)
        nc = newcombe(pa["tp"], pa["decided"], pb["tp"], pb["decided"])
        bd = bootstrap_difference(per_page(a, split_pages["test"]), per_page(r7, r7_pages), paired=False)
        summary["comparisonWithRound7"] = {"round7": pb, "newcombe": nc, "pageBootstrap": bd, "reading": direction(nc, bd),
                                           "round7Folder": ROUND7.replace("\\", "/")}

    # Ablations: counts only (pre-registration, section 3), each against the main run's default-threshold judgment findings.
    ablations = {}
    for run in ABLATIONS:
        added = removed = pages_run = 0
        by_criterion = defaultdict(lambda: [0, 0])
        for slug in split_pages["test"]:
            rep, main_rep = compact(slug, run), compact(slug, "report")
            if rep is None or main_rep is None:
                continue
            pages_run += 1
            a, m = default_judged(rep), default_judged(main_rep)
            for fp in set(a) - set(m):
                added += 1
                by_criterion[a[fp]["criterion"]][0] += 1
            for fp in set(m) - set(a):
                removed += 1
                by_criterion[m[fp]["criterion"]][1] += 1
        out = {"pages": pages_run, "addedFindings": added, "removedFindings": removed,
               "byCriterion": {c: {"added": x, "removed": y} for c, (x, y) in sorted(by_criterion.items())},
               "labelled": False}
        if run == "nollm":
            out["ruleFindingsDefault"] = sum(1 for slug in split_pages["test"] for f in (compact(slug, run) or {}).get("findings", [])
                                             if f.get("source") == "rule" and not f.get("experimental"))
        ablations[run] = out
    summary["ablationCounts"] = ablations

    # The suggestion sample, per reason.
    sample = [r for r in rows if r.get("origin") == "suggestion-sample"]
    summary["suggestions"] = {f"{s} {reason}": prec([r for r in sample if r["split"] == s and r.get("sampleReason") == reason])
                              for s in splits for reason in ("unstyled", "2.4.2", "3.3.2", "seeded")}

    # Recall among the candidates Rampa judged, 1.1.1 and 2.4.4 (the sixth study's estimator).
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

            def estimate(pick, unc):
                misses, strata = 0.0, {}
                weight = Counter(pick)
                for stratum in ("passed", "discarded", "held_back"):
                    n_h = sum(pop[(crit, stratum)][s] * weight[s] for s in weight)
                    dec = [(lab if lab != "uncertain" else unc) for s, st, lab in items if st == stratum for _ in range(weight[s])]
                    dec = [x for x in dec if x in ("true_positive", "false_positive")]
                    full = [(lab if lab != "uncertain" else unc) for _, st, lab in items if st == stratum]
                    full = [x for x in full if x in ("true_positive", "false_positive")]
                    p_h = (sum(x == "true_positive" for x in dec) / len(dec)) if dec else (sum(x == "true_positive" for x in full) / len(full) if full else 0.0)
                    strata[stratum] = {"N": n_h, "decided": len(dec), "failing": sum(x == "true_positive" for x in dec), "p": round(p_h, 3),
                                       "wilson95": wilson(sum(x == "true_positive" for x in dec), len(dec))}
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

    # True default-threshold judged findings that axe-core does not report (same element and criterion; any criterion).
    true_test = [r for r in sel("test") if r["final"] == "true_positive"]
    same, anyc, checked = 0, 0, 0
    for r in true_test:
        rep_path = os.path.join(page_dir(r["slug"]), "report.json")
        if not os.path.exists(rep_path):
            continue
        checked += 1
        engine = [f for lst in ("findings", "belowThreshold", "beyondTarget") for f in read_json(rep_path).get(lst) or [] if f.get("source") == "engine" and f.get("ref") == r.get("ref")]
        same += not any(f["criterion"] == r["criterion"] for f in engine)
        anyc += not engine
    summary["notReportedByAxe"] = {"trueFindings": len(true_test), "checked": checked, "sameCriterion": same, "sameCriterionWilson95": wilson(same, checked),
                                   "anyCriterion": anyc, "criteriaWithATrueFinding": sorted({r["criterion"] for r in true_test})}

    # The judges' agreement (consistency, not validity).
    lab = [r for r in rows if r["labelled"]]
    pairs = lambda rs: [(r["auditor"]["label"], r["skeptic"]["label"]) for r in rs]
    both_fp = [r for r in lab if r["auditor"]["label"] == r["skeptic"]["label"] == "false_positive"]
    summary["agreement"] = {"all": kappa(pairs(lab), LABELS), "judged": kappa(pairs([r for r in lab if r["kind"] == "judgment"]), LABELS),
                            "other": kappa(pairs([r for r in lab if r["kind"] != "judgment"]), LABELS),
                            "byCriterion": {c: kappa(pairs([r for r in lab if r["kind"] == "judgment" and r["criterion"] == c]), LABELS) for c in CRITERIA},
                            "causes": kappa([(r["auditor"]["cause"], r["skeptic"]["cause"]) for r in both_fp], sorted({r["auditor"]["cause"] for r in both_fp} | {r["skeptic"]["cause"] for r in both_fp}))}

    # Time and model use per page (main run), collection plus judgment; fast mode from the T4 runs.
    page_rows = []
    for slug, p in meta.items():
        runs = {os.path.basename(x)[4:-5]: read_json(x) for x in glob.glob(os.path.join(HERE, "pages", slug, "run-*.json"))}
        rep = compact(slug, "report") or {}
        collect = [v for k, v in sorted(runs.items()) if k.startswith("main-collect")]
        judged = runs.get("main-judged")
        usage = rep.get("usage") or {}
        fast_collect = [v for k, v in sorted(runs.items()) if k.startswith("fast-collect")]
        fast_judged = [runs[k]["seconds"] for k in (f"fast{n}-judged" for n in range(1, 6)) if k in runs]
        page_rows.append({"slug": slug, "split": p["split"], "block": p["block"], "url": p["url"], "collectSeconds": collect[-1]["seconds"] if collect else None,
                          "judgedSeconds": judged["seconds"] if judged else None, "calls": usage.get("calls"), "inputTokens": usage.get("inputTokens"),
                          "outputTokens": usage.get("outputTokens"), "capture": rep.get("capture"), "errors": rep.get("errors"),
                          "fastCollectSeconds": fast_collect[-1]["seconds"] if fast_collect else None,
                          "fastJudgedSecondsMedian": sorted(fast_judged)[len(fast_judged) // 2] if fast_judged else None})

    def med_p90(values):
        values = sorted(values)
        return {"pages": len(values), "median": values[len(values) // 2] if values else None, "p90": values[int(0.9 * (len(values) - 1))] if values else None}
    summary["time"] = {"full": med_p90([(r["collectSeconds"] or 0) + r["judgedSeconds"] for r in page_rows if r["judgedSeconds"] is not None]),
                       "fast": med_p90([(r["fastCollectSeconds"] or 0) + r["fastJudgedSecondsMedian"] for r in page_rows if r["fastJudgedSecondsMedian"] is not None]),
                       "fastTargetSeconds": 120}

    keep = ("slug", "split", "block", "packet", "key", "fingerprint", "origin", "origins", "criterion", "level", "source", "ruleId", "kind", "shown",
            "experimental", "confidence", "ref", "subject", "message", "evidence", "patch", "html", "claim", "sampleReason", "passStratum", "x6Rank",
            "auditor", "skeptic", "final", "finalCause", "failsAnyReason")
    write_json(os.path.join(HERE, "data", "findings.json"), [{k: r.get(k) for k in keep} for r in rows])
    write_json(os.path.join(HERE, "data", "pages.json"), page_rows)
    write_json(os.path.join(HERE, "data", "summary.json"), summary)
    p = primary["test"]
    print(f"primary (test, AI-judged): {p['tp']} TP / {p['fp']} FP / {p['uncertain']} unc, precision {p['precision']} Wilson {p['wilson95']} "
          f"bootstrap {(p['pageBootstrap'] or {}).get('ci95')} -> {p['reading']}; decided {p['decided']} (70 or more: {p['atLeast70Decided']})")
    c = co["test"]
    print(f"same-name sets: {c['sameNameSets']['sets']} sets, unit precision {c['sameNameSets']['precision']}; uncertain share {c['uncertainShare']['share']} (target <= 0.15)")
    print("per criterion:", {k: (v["tp"], v["fp"], v["uncertain"]) for k, v in c["byCriterion"].items() if v["n"]})
    if "t4" in co:
        print("T4 decision level:", {m: v["decisionLevel"]["share"] for m, v in co["t4"].items()})
    for split in ("test",):
        sa, sb = secondary[split]["a_withoutJudged244"], secondary[split]["b_judged244Alone"]
        print(f"(a) without judged 2.4.4: {sa['tp']} TP / {sa['fp']} FP / {sa['uncertain']} unc, precision {sa['precision']} Wilson {sa['wilson95']} -> {sa['readingByTheRule']}")
        print(f"(b) judged 2.4.4 alone: {sb['tp']} TP / {sb['fp']} FP / {sb['uncertain']} unc, precision {sb['precision']} Wilson {sb['wilson95']}")
    if "h_sharedTextProofRule" in secondary:
        h = secondary["h_sharedTextProofRule"]
        print(f"(h) X6: {h['moved']} moved, {h['atDefaultThreshold']} at the default threshold, {h['labelled']} labelled: "
              f"{h['sample']['tp']} TP / {h['sample']['fp']} FP / {h['sample']['uncertain']} unc; estimated real failures {h['estimatedRealFailuresAtDefaultThreshold']} {h['estimatedRange95']}")
    if "round7" in summary["comparisonWithRound7"]:
        print("against round 7:", summary["comparisonWithRound7"]["round7"]["precision"], summary["comparisonWithRound7"]["newcombe"], summary["comparisonWithRound7"]["reading"])
    print("agreement:", summary["agreement"]["all"], "judged:", summary["agreement"]["judged"])


if __name__ == "__main__":
    main()
