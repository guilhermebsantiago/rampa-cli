"""Numbers of the ninth real-page study (pre-registration, sections 4 to 10): the eighth study's analyze.py with the ninth
study's design. Run after every label and audit file is written and checked (scripts/check_labels.py):

  python -I study/round-9-2026-11-25/scripts/analyze.py

- Section 4, the primary measure (P2), the sixth study's rule verbatim: test-half precision per element at the default
  threshold over the eight judged criteria, main run, uncertain left out; Wilson's 95% interval decides; a page bootstrap
  (10,000 resamples of the 36 test pages, random.Random(20261029)) beside it; the dev half beside it; the pooled 72 pages
  secondary.
- Section 5, fast mode: the fast run's primary population on the test half, each finding labelled by the reuse rule
  (data/fast-reuse.json: a main-run item's final label, or its own row in the page's fast packet); Wilson, the page
  bootstrap and the section-4 reading as a secondary reading; reuse counts; main-to-fast difference (exploratory).
- Section 6, the recall audit: audits/<slug>.audit.json matched against the main run's report by criterion and element.
- Section 7, time and model use in both modes, and a hosted-cost estimate from docs/models.md's prices.
- Section 8, co-registered and other secondary measures; section 10, T4 if data/t4.json exists.

Inputs (this study's folder): data/pages-input.json; data/findings-raw.json and data/fast-reuse.json (packets.py);
labels/<packet>.<role>.json; audits/ and audit-packets/ (audit.py); pages/<slug>/*.judged.json, *-collect.timings.json and
run-*.json (compact.py); data/t4.json (t4.py); the eighth study's folder for the comparison (ROUND8 overrides its path);
docs/models.md for the prices. Outputs: data/findings.json (one row per labelled item with both judges' answers and labels,
the format Rampa Lab's review mode reads, with data/pages.json), data/pages.json, data/summary.json; prints the numbers.

Final label: the label both judges gave, else uncertain; a false positive's cause the one both named, else disputed.
Precision TP / (TP + FP), uncertain left out; Wilson 95% intervals; page bootstraps of 10,000 resamples with
random.Random(20261029) (the quoted rule's generator, used for every bootstrap here); Newcombe's method 10 for
differences. Every number here is AI-judged.
"""
import glob
import math
import os
import random
import re
import statistics as st
import sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import DEFAULT_CRITERIA, HERE, LEVELS, page_dir, pages, read_json, shown_by_default, snapshot_file, write_json  # noqa: E402

LABELS = ("true_positive", "false_positive", "uncertain")
CRITERIA = DEFAULT_CRITERIA
SEED, ROUNDS, BURST = 20261029, 10000, 5
Z = 1.959963984540054
UNCERTAIN_TARGET = 0.15
DECIDED_THRESHOLD = 70
FAST_TARGET_SECONDS = 120
PAGE_LEVEL = ("2.4.2", "3.1.1")
MATCH_DEPTH = 3
ROOT = os.path.dirname(os.path.dirname(HERE))
ROUND8 = os.environ.get("ROUND8") or os.path.join(os.path.dirname(HERE), "round-8-2026-11-21")
MODELS_MD = os.environ.get("MODELS_MD") or os.path.join(ROOT, "docs", "models.md")
HOSTED_DEFAULT = "openai:gpt-6-luna"


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
    """counts: {page: [successes, trials]}; the ratio of sums over resampled pages."""
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
    """Section 4 (the sixth study's rule, dae1522): Wilson's lower bound decides."""
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
    """Co-registered (d): one unit per same-name link set (page and normalised text of the shared-text findings), its label
    the majority of its members' final labels (a tie uncertain); every other finding one unit."""
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
    """Another round's labelled rows with final labels, from its data/findings-raw.json and labels/; None without labels."""
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


def visual(r):
    return any(((r.get(role) or {}).get("rationale") or "").lstrip().startswith("[visual context]") for role in ("auditor", "skeptic"))


def walk(node, parent=None):
    yield node, parent
    for child in node.get("children", []):
        yield from walk(child, node)


def med_p90(values, digits=1):
    values = sorted(v for v in values if v is not None)
    return {"pages": len(values), "median": None if not values else round(st.median(values), digits),
            "p90": None if not values else values[int(0.9 * (len(values) - 1))],
            "mean": None if not values else round(sum(values) / len(values), digits)}


def price_table():
    """Every priced row of docs/models.md's providers table: "provider: model" -> (USD in, USD out) per million tokens."""
    out = {}
    if not os.path.exists(MODELS_MD):
        return out
    for line in open(MODELS_MD, encoding="utf-8"):
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) < 4:
            continue
        m = re.match(r"^(\d+(?:\.\d+)?)\s*/\s*(\d+(?:\.\d+)?)", cells[2])
        model = re.search(r"`([^`]+)`", cells[1])
        if m and model and "<" not in model.group(1):
            out.setdefault(model.group(1), (float(m.group(1)), float(m.group(2))))
    return out


def stage_ms(timings, stage):
    for s in (timings or {}).get("stages") or []:
        if s.get("stage") == stage:
            return s.get("ms")
    return None


def last_run(runs, prefix):
    keys = sorted((k for k in runs if k.startswith(prefix)), key=lambda k: int(k.rsplit("-", 1)[1]) if k.rsplit("-", 1)[1].isdigit() else 0)
    return runs[keys[-1]] if keys else None


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    meta = {p["slug"]: p for p in pages()}
    split_pages = {s: sorted(k for k, p in meta.items() if p["split"] == s) for s in ("test", "dev")}
    split_pages["all"] = sorted(meta)
    views = ["test", "dev", "all"]
    raw = read_json(os.path.join(HERE, "data", "findings-raw.json"))
    labels = {}
    for path in glob.glob(os.path.join(HERE, "labels", "*.json")):
        packet, role = os.path.basename(path)[:-5].rsplit(".", 1)
        labels[(packet, role)] = {j["fingerprint"]: j for j in read_json(path)["judgments"]}
    rows, missing = [], []
    for r in raw:
        a, s = labels.get((r["packet"], "auditor"), {}).get(r["key"]), labels.get((r["packet"], "skeptic"), {}).get(r["key"])
        row = dict(r)
        # The eighth study's rows say "default" for the main run (read when this script is tested on its labels).
        row["run"] = "main" if row.get("run") in (None, "default") else row["run"]
        row["split"] = meta[row["slug"]]["split"]  # data/pages-input.json is the split's authority
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
    by_key = {(r["packet"], r["key"]): r for r in rows}

    def sel(split="test", run="main", kind="judgment", shown=True):
        out = [r for r in rows if (split == "all" or r["split"] == split) and r.get("run", "main") == run and r.get("origin") == run]
        out = [r for r in out if kind is None or r["kind"] == kind]
        return [r for r in out if shown is None or bool(r["shown"]) == shown]

    summary = {"missingLabels": len(missing), "labelsAre": "AI-judged (two Claude judges; final label by agreement)",
               "seedForBootstraps": SEED, "pages": {s: len(split_pages[s]) for s in views}}

    # Section 4: the primary measure (test), the dev half beside it, the pooled 72 secondary.
    primary = {}
    for split in views:
        p = prec(sel(split))
        primary[split] = {**p, "pageBootstrap": bootstrap(per_page(sel(split), split_pages[split])), "reading": reading(p)}
    primary["test"]["atLeast70Decided"] = primary["test"]["decided"] >= DECIDED_THRESHOLD
    primary["test"]["rule"] = ("the sixth study's section 4 (dae1522): favourable: precision >= 0.90 and Wilson lower bound >= 0.80; "
                               "inconclusive: lower bound < 0.80; under the target: precision < 0.90 and lower bound >= 0.80")
    summary["primary"] = primary

    # Section 5: fast mode on the test half, by the reuse rule.
    fast = {}
    reuse_path = os.path.join(HERE, "data", "fast-reuse.json")
    if os.path.exists(reuse_path):
        reuse = read_json(reuse_path)
        fast_rows, unresolved = [], 0
        for e in reuse["findings"]:
            if meta[e["slug"]]["split"] != "test":
                continue
            src = e.get("labelFrom") or {}
            r = by_key.get((src.get("packet"), src.get("key")))
            if r is None:
                unresolved += 1
                final = "uncertain"
            else:
                final = r["final"]
            fast_rows.append({"slug": e["slug"], "criterion": e["criterion"], "final": final, "claim": e.get("claim"),
                              "reused": src.get("packet") == e["slug"]})
        p = prec(fast_rows)
        pm = primary["test"]
        nc = newcombe(pm["tp"], pm["decided"], p["tp"], p["decided"])
        bd = bootstrap_difference(per_page(sel("test"), split_pages["test"]), per_page(fast_rows, split_pages["test"]), paired=True)
        fast_pages = {e["slug"] for e in reuse["findings"]}
        fast_reports = [s for s in meta if compact(s, "fast") is not None]
        fast = {
            "test": {**p, "pageBootstrap": bootstrap(per_page(fast_rows, split_pages["test"])),
                     "readingByTheSection4Rule": reading(p), "note": "secondary: the section-4 rule's reading does not decide for fast mode",
                     "reusedLabels": sum(r["reused"] for r in fast_rows), "ownRows": sum(not r["reused"] for r in fast_rows),
                     "unresolvedLabels": unresolved, "atLeast70Decided": p["decided"] >= DECIDED_THRESHOLD,
                     "byCriterion": {c: prec([r for r in fast_rows if r["criterion"] == c]) for c in CRITERIA}},
            "devFindingsCounted": sum(1 for e in reuse["findings"] if meta[e["slug"]]["split"] != "test"),
            "pagesWithFastReport": len(fast_reports), "pagesWithFastFindings": len(fast_pages),
            "mainMinusFastTest": {"newcombe": nc, "pairedPageBootstrap": bd, "reading": direction(nc, bd), "note": "exploratory"},
        }
    summary["fastMode"] = fast

    # Section 6: the recall audit.
    summary["recallAudit"] = recall_audit(meta)

    # Section 8: co-registered measures.
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
    else:
        co["t4"] = "not run"
    summary["coRegistered"] = co

    # True primary findings axe-core does not report on the same element and criterion (and on any criterion), per half.
    axe = {}
    for split in views:
        true_rows = [r for r in sel(split) if r["final"] == "true_positive"]
        same = anyc = checked = 0
        for r in true_rows:
            rep = compact(r["slug"], "report") or {}
            if "engine" in rep:
                engine = [f for lst in rep["engine"].values() for f in lst if f.get("ref") == r.get("ref")]
            else:
                full = os.path.join(page_dir(r["slug"]), "report.json")
                if not os.path.exists(full):
                    continue
                engine = [f for lst in ("findings", "belowThreshold", "beyondTarget") for f in read_json(full).get(lst) or []
                          if f.get("source") == "engine" and f.get("ref") == r.get("ref")]
            checked += 1
            same += not any(f["criterion"] == r["criterion"] for f in engine)
            anyc += not engine
        axe[split] = {"trueFindings": len(true_rows), "checked": checked, "sameCriterion": same, "sameCriterionWilson95": wilson(same, checked),
                      "anyCriterion": anyc, "anyCriterionWilson95": wilson(anyc, checked), "criteriaWithATrueFinding": sorted({r["criterion"] for r in true_rows})}
    summary["notReportedByAxe"] = axe

    # Other secondary measures, as in the eighth study.
    summary["everyFinding"] = {s: prec(sel(s, shown=None)) for s in views}
    summary["perGroup"] = {s: {**prec(units(sel(s))), "groups": [u for u in units(sel(s)) if u["size"] > 1]} for s in views}
    blocks = sorted({p["block"] for p in meta.values()})
    summary["perBlock"] = {f"{s} block {b}": prec([r for r in sel(s) if r.get("block") == b]) for s in ("test", "dev") for b in blocks}
    page_level = {}
    for s in views:
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
            sens[s] = {"topPage": top, "topPageFindings": n, "withoutTopPage": prec([r for r in sr if r["slug"] != top]),
                       "uncertainAsTrue": round((c["true_positive"] + c["uncertain"]) / len(sr), 3), "uncertainAsFalse": round(c["true_positive"] / len(sr), 3)}
    summary["sensitivity"] = sens
    summary["failsAnyReason"] = {s: prec([{**r, "final": r["failsAnyReason"]} for r in sel(s)]) for s in views}
    summary["visualContext"] = {s: {"items": prec([r for r in sel(s) if visual(r)]), "withoutThem": prec([r for r in sel(s) if not visual(r)])} for s in views}
    summary["experimental"] = {s: dict(Counter(f"{r.get('ruleId') or 'judgment ' + r['criterion']}: {r['final']}" for r in rows
                                               if r["split"] == s and r.get("origin") == "main" and r["kind"] != "judgment")) for s in ("test", "dev")}
    summary["falsePositiveCauses"] = {s: dict(Counter(f"{r.get('ruleId') or 'judgment ' + r['criterion']} | {r['finalCause']}" for r in rows
                                                      if r["split"] == s and r["final"] == "false_positive")) for s in ("test", "dev")}
    r8_all = final_rows(ROUND8)
    if r8_all is None:
        summary["comparisonWithRound8"] = {"note": f"no labels in {ROUND8}"}
    else:
        r8 = [r for r in r8_all if r.get("origin") == "main" and r.get("kind") == "judgment" and r.get("shown") and r.get("split") == "test"]
        r8_pages = sorted({r["slug"] for r in r8_all if r.get("split") == "test"})
        pa, pb = primary["test"], prec(r8)
        nc = newcombe(pa["tp"], pa["decided"], pb["tp"], pb["decided"])
        bd = bootstrap_difference(per_page(sel("test"), split_pages["test"]), per_page(r8, r8_pages), paired=False)
        summary["comparisonWithRound8"] = {"round8": pb, "newcombe": nc, "pageBootstrap": bd, "reading": direction(nc, bd),
                                           "note": "exploratory: other pages and code 2f5f88f (0.1.3 adds a 1.3.5 fix)"}
    lab = [r for r in rows if r["labelled"]]
    pairs = lambda rs: [(r["auditor"]["label"], r["skeptic"]["label"]) for r in rs]
    both_fp = [r for r in lab if r["auditor"]["label"] == r["skeptic"]["label"] == "false_positive"]
    summary["agreement"] = {"all": kappa(pairs(lab), LABELS), "judged": kappa(pairs([r for r in lab if r["kind"] == "judgment"]), LABELS),
                            "other": kappa(pairs([r for r in lab if r["kind"] != "judgment"]), LABELS),
                            "fastRows": kappa(pairs([r for r in lab if r.get("run") == "fast"]), LABELS),
                            "byCriterion": {c: kappa(pairs([r for r in lab if r["kind"] == "judgment" and r["criterion"] == c]), LABELS) for c in CRITERIA},
                            "causes": kappa([(r["auditor"]["cause"], r["skeptic"]["cause"]) for r in both_fp],
                                            sorted({r["auditor"]["cause"] for r in both_fp} | {r["skeptic"]["cause"] for r in both_fp}))}

    # Section 7: time, model use and cost, both modes, all pages.
    page_rows = []
    for slug, p in meta.items():
        runs = {os.path.basename(x)[4:-5]: read_json(x) for x in glob.glob(os.path.join(HERE, "pages", slug, "run-*.json"))}
        row = {"slug": slug, "split": p["split"], "block": p["block"], "url": p["url"]}
        for mode, report_name in (("main", "report"), ("fast", "fast")):
            collect = last_run(runs, f"{mode}-collect")
            judged = runs.get(f"{mode}-judged")
            rep = compact(slug, report_name) or {}
            timings_path = os.path.join(HERE, "pages", slug, f"{mode}-collect.timings.json")
            shot = stage_ms(read_json(timings_path).get("timings"), "screenshot") if os.path.exists(timings_path) else None
            usage = rep.get("usage") or {}
            c_s, j_s = (collect or {}).get("seconds"), (judged or {}).get("seconds")
            row[mode] = {"collectSeconds": c_s, "judgedSeconds": j_s, "screenshotSeconds": None if shot is None else round(shot / 1000, 1),
                         "totalSeconds": None if c_s is None or j_s is None else c_s + j_s,
                         "totalWithoutScreenshotSeconds": None if c_s is None or j_s is None else round(c_s + j_s - (shot or 0) / 1000, 1),
                         "calls": usage.get("calls"), "inputTokens": usage.get("inputTokens"), "outputTokens": usage.get("outputTokens"),
                         "capture": rep.get("capture"), "errors": rep.get("errors"), "judgedExitCode": (judged or {}).get("exitCode")}
        page_rows.append(row)
    prices = price_table()
    time_cost = {}
    for mode in ("main", "fast"):
        rs = [r[mode] for r in page_rows]
        tin = sum(r["inputTokens"] or 0 for r in rs)
        tout = sum(r["outputTokens"] or 0 for r in rs)
        n_pages = sum(1 for r in rs if r["calls"] is not None)

        def estimate(pin, pout):
            per_page_costs = [((r["inputTokens"] or 0) * pin + (r["outputTokens"] or 0) * pout) / 1e6 for r in rs if r["calls"] is not None]
            return {"usdPerMillionIn": pin, "usdPerMillionOut": pout, "totalUsd": round((tin * pin + tout * pout) / 1e6, 4),
                    "perPageUsd": med_p90([round(c, 5) for c in per_page_costs], digits=5)}
        time_cost[mode] = {
            "time": {"collectionPlusJudgment": med_p90([r["totalSeconds"] for r in rs]),
                     "withoutScreenshotStage": med_p90([r["totalWithoutScreenshotSeconds"] for r in rs]),
                     "collection": med_p90([r["collectSeconds"] for r in rs]), "judgment": med_p90([r["judgedSeconds"] for r in rs]),
                     "screenshotStage": med_p90([r["screenshotSeconds"] for r in rs])},
            "modelUse": {"pages": n_pages, "calls": med_p90([r["calls"] for r in rs]), "inputTokens": med_p90([r["inputTokens"] for r in rs]),
                         "outputTokens": med_p90([r["outputTokens"] for r in rs]),
                         "totals": {"calls": sum(r["calls"] or 0 for r in rs), "inputTokens": tin, "outputTokens": tout}},
            "costLocal": "R$ 0 (local model, no API; hardware and power not counted)",
            "hostedEstimate": {"note": ("ESTIMATE: Gemma's token counts x docs/models.md's prices (USD per million tokens, checked 2026-10-07); "
                                        "each hosted model's own tokenizer and image accounting differ; USD, not converted"),
                               "primary": {HOSTED_DEFAULT: estimate(*prices[HOSTED_DEFAULT])} if HOSTED_DEFAULT in prices else None,
                               "everyPricedRow": {m: estimate(pin, pout) for m, (pin, pout) in sorted(prices.items())}},
        }
    for key in ("collectionPlusJudgment", "withoutScreenshotStage"):
        m = time_cost["fast"]["time"][key]["median"]
        time_cost["fast"]["time"][key]["meetsTargetMedianAtMost120s"] = None if m is None else m <= FAST_TARGET_SECONDS
    summary["timeAndCost"] = time_cost

    keep = ("slug", "split", "block", "packet", "key", "fingerprint", "run", "origin", "criterion", "level", "source", "ruleId", "kind", "shown",
            "experimental", "confidence", "ref", "subject", "message", "evidence", "patch", "html", "claim", "auditor", "skeptic", "final",
            "finalCause", "failsAnyReason")
    write_json(os.path.join(HERE, "data", "findings.json"), [{k: r.get(k) for k in keep} for r in rows])
    write_json(os.path.join(HERE, "data", "pages.json"), page_rows)
    write_json(os.path.join(HERE, "data", "summary.json"), summary)
    report(summary)


def recall_audit(meta):
    """Section 6: audited failures matched against the main run's report by criterion and element."""
    audited = [m for m in meta.values() if m.get("audit")]
    out = {"pages": [m["slug"] for m in audited], "matchDepth": MATCH_DEPTH}
    readings = ("primary", "findingsOnly", "anyItem", "judgmentLayer")
    failures = []
    for m in audited:
        slug = m["slug"]
        path = os.path.join(HERE, "audits", f"{slug}.audit.json")
        if not os.path.exists(path):
            continue
        audit = read_json(path)
        snap_path = os.path.join(HERE, "audit-packets", slug, "snapshot.json")
        if not os.path.exists(snap_path):
            snap_path = snapshot_file(os.path.join(page_dir(slug), "recording"))
        snap = read_json(snap_path)
        parent, nodes = {}, {}
        for n, p in walk(snap["root"]):
            nodes.setdefault(n["ref"], n)
            if p is not None:
                parent.setdefault(n["ref"], p["ref"])

        def ancestors(ref):
            out_, cur = [], ref
            while cur in parent and len(out_) < MATCH_DEPTH:
                cur = parent[cur]
                out_.append(cur)
            return out_

        def near(a, b):
            return a == b or b in ancestors(a) or a in ancestors(b)

        rep = compact(slug, "report") or {}
        items = []
        for lst in ("findings", "belowThreshold", "beyondTarget"):
            for f in rep.get(lst) or []:
                items.append({"criterion": f["criterion"], "ref": f.get("ref"), "source": f.get("source"), "kind": "finding",
                              "default": shown_by_default(f) and lst != "beyondTarget"})
            for f in (rep.get("engine") or {}).get(lst) or []:
                items.append({"criterion": f["criterion"], "ref": f.get("ref"), "source": "engine", "kind": "finding",
                              "default": shown_by_default(f) and lst != "beyondTarget"})
        for s in rep.get("needsReview") or []:
            items.append({"criterion": s["criterion"], "ref": s.get("ref"), "source": "judgment", "kind": "suggestion", "default": True})
        for s in rep.get("otherReview") or []:
            items.append({"criterion": s["criterion"], "ref": s.get("ref"), "source": s.get("source") or "engine", "kind": "review", "default": False})
        pick = {
            "primary": lambda i: (i["kind"] == "finding" and i["default"]) or i["kind"] == "suggestion",
            "findingsOnly": lambda i: i["kind"] == "finding" and i["default"],
            "anyItem": lambda i: True,
            "judgmentLayer": lambda i: i["source"] == "judgment" and ((i["kind"] == "finding" and i["default"]) or i["kind"] == "suggestion"),
        }
        for f in audit.get("failures") or []:
            row = {"slug": slug, "id": f.get("id"), "criterion": f.get("criterion"), "certainty": f.get("certainty"), "refInSnapshot": f.get("ref") in nodes}
            for name in readings:
                cands = [i for i in items if i["criterion"] == f.get("criterion") and pick[name](i)]
                if f.get("criterion") in PAGE_LEVEL:
                    hit = bool(cands)
                else:
                    hit = row["refInSnapshot"] and any(i.get("ref") and near(f["ref"], i["ref"]) for i in cands)
                row[name] = hit
            failures.append(row)
    out["auditedPages"] = len({f["slug"] for f in failures} | {m["slug"] for m in audited if os.path.exists(os.path.join(HERE, "audits", f"{m['slug']}.audit.json"))})
    out["failures"] = len(failures)
    out["refsNotInSnapshot"] = sum(not f["refInSnapshot"] and f["criterion"] not in PAGE_LEVEL for f in failures)

    def measure(rows, name):
        k, n = sum(r[name] for r in rows), len(rows)
        counts = {m["slug"]: [sum(r[name] for r in rows if r["slug"] == m["slug"]), sum(1 for r in rows if r["slug"] == m["slug"])] for m in audited}
        return {"reported": k, "audited": n, "recall": None if not n else round(k / n, 3), "wilson95": wilson(k, n), "pageBootstrap": bootstrap(counts)}
    out["recall"] = {name: measure(failures, name) for name in readings}
    out["clearOnly"] = {name: measure([f for f in failures if f["certainty"] == "clear"], name) for name in readings}
    out["byCriterion"] = {c: {"audited": sum(f["criterion"] == c for f in failures), "reported": sum(f["primary"] for f in failures if f["criterion"] == c)} for c in CRITERIA}
    out["byPage"] = {m["slug"]: {"audited": sum(f["slug"] == m["slug"] for f in failures), "reported": sum(f["primary"] for f in failures if f["slug"] == m["slug"])} for m in audited}
    out["note"] = "AI-audited: six test pages, one Claude auditor per page, failures not checked by the judges; never 'Rampa's recall' without this"
    return out


def report(summary):
    p = summary["primary"]["test"]
    print(f"PRIMARY (test, AI-judged): {p['tp']} TP / {p['fp']} FP / {p['uncertain']} unc, precision {p['precision']} Wilson {p['wilson95']} "
          f"bootstrap {(p['pageBootstrap'] or {}).get('ci95')} -> {p['reading']}; decided {p['decided']} (70 or more: {p['atLeast70Decided']})")
    for s in ("dev", "all"):
        q = summary["primary"][s]
        print(f"  {s}: {q['tp']} TP / {q['fp']} FP / {q['uncertain']} unc, precision {q['precision']} Wilson {q['wilson95']} bootstrap {(q['pageBootstrap'] or {}).get('ci95')}")
    f = summary["fastMode"].get("test")
    if f:
        print(f"FAST (test): {f['tp']} TP / {f['fp']} FP / {f['uncertain']} unc, precision {f['precision']} Wilson {f['wilson95']} "
              f"bootstrap {(f['pageBootstrap'] or {}).get('ci95')}; reused {f['reusedLabels']}, own rows {f['ownRows']}, unresolved {f['unresolvedLabels']} "
              f"(section-4 rule would read: {f['readingByTheSection4Rule']})")
    ra = summary["recallAudit"]
    if ra.get("failures"):
        r = ra["recall"]["primary"]
        print(f"RECALL (audit, {ra['auditedPages']} pages): {r['reported']}/{r['audited']} = {r['recall']} Wilson {r['wilson95']} "
              f"bootstrap {(r['pageBootstrap'] or {}).get('ci95')}; clear only {ra['clearOnly']['primary']['recall']}")
    c = summary["coRegistered"]["test"]
    print(f"same-name sets: {c['sameNameSets']['sets']} sets, unit precision {c['sameNameSets']['precision']}; uncertain share {c['uncertainShare']['share']} (target <= 0.15)")
    print("per criterion (test):", {k: (v["tp"], v["fp"], v["uncertain"]) for k, v in c["byCriterion"].items() if v["n"]})
    ax = summary["notReportedByAxe"]["test"]
    print(f"not reported by axe-core (test): {ax['sameCriterion']}/{ax['checked']} Wilson {ax['sameCriterionWilson95']}")
    for mode in ("main", "fast"):
        t = summary["timeAndCost"][mode]
        h = (t["hostedEstimate"]["primary"] or {}).get(HOSTED_DEFAULT) or {}
        print(f"TIME/COST {mode}: median {t['time']['collectionPlusJudgment']['median']} s (p90 {t['time']['collectionPlusJudgment']['p90']}), "
              f"without screenshot {t['time']['withoutScreenshotStage']['median']} s; calls median {t['modelUse']['calls']['median']}, "
              f"tokens {t['modelUse']['totals']['inputTokens']}/{t['modelUse']['totals']['outputTokens']}; hosted estimate ({HOSTED_DEFAULT}) "
              f"total US$ {h.get('totalUsd')}, per page median US$ {(h.get('perPageUsd') or {}).get('median')}")
    cmp8 = summary["comparisonWithRound8"]
    if "round8" in cmp8:
        print("against round 8 (exploratory):", cmp8["round8"]["precision"], cmp8["newcombe"], cmp8["reading"])
    print("agreement:", summary["agreement"]["all"], "judged:", summary["agreement"]["judged"])


if __name__ == "__main__":
    main()
