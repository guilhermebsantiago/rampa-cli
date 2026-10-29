"""The fifth study's pre-registered measures beyond analyze.py's tables (preregistration.md), as the fourth study's
extras.py did its own.

Reads data/findings.json (analyze.py: every labelled row with its origin), data/pages-input.json, each page's reports
(full, else the compact part git keeps), data/capture.json, data/shared-text.json, data/suggestion-sample.json, and the
fourth study's data/findings.json and data/pages-input.json. Writes data/extras.json and prints markdown tables.

- primary: the test half's precision per element at the default threshold over the judged criteria (main run), with
  Wilson 95% and a page bootstrap (10,000 resamples of the 12 test pages, all of them, with replacement; a resample with
  no decided finding skipped and counted); against the fourth study's test half (14 of 26) and pooled halves (27 of 93),
  the difference with Newcombe's hybrid score interval (method 10) and a page-bootstrap interval (each study's pages
  resampled independently); "went up" only when both intervals lie above 0, "went down" only when both lie below 0.
  Every bootstrap starts its own random.Random(20261027).
- held: each set's per-element precision over the in-sample 0.86 (95 of 111) of docs/studies/notes-precision-fixes.md.
- groups: on one page, default-threshold judged findings with the same criterion, check id (judgment/<criterion>) and
  claim kind (the finding's `claim`, as src/core/groups.ts keys it), 6 or more, one unit labelled by the plurality of
  its labelled members (a tie uncertain; unlabelled members do not vote).
- pages: of the pages with a decided default-threshold finding, the share with every decided finding true, and the mean
  of the pages' precisions.
- ablations: --no-confirm (main rows plus the noconfirm-only rows), the 0.9 cut (cut090-report.json's findings, labelled
  by page, criterion and element), the shared-text fact without the nesting (main rows plus the suggestions chosen as
  "nesting", counted as findings whatever their confidence, which a suggestion does not record), the capture log, and the
  second pass's shares.
- suggestions: per reason (unstyled, nesting, 2.4.2, 3.3.2, seeded) and split, the labels; for the reasons labelled in
  full, the true failures moved to review; for the seeded draw, the share times the pool.
- bursts: every page with 6 or more default-threshold judged findings of one claim (the groups above), and every page
  with 6 or more suggestions of one criterion and claim or 6 or more --no-confirm-only findings of one claim; listed with
  sizes and labels (the test half's are only counted when the report is written).

Run after analyze.py: python -I study/round-5-2026-10-28/scripts/extras.py
"""

import json
import math
import os
import random
import sys
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STUDY = os.path.dirname(HERE)
Z = 1.959963984540054
SEED = 20261027
ROUNDS = 10_000
BURST = 5
IN_SAMPLE = (95, 111)
DENIED = "did not confirm"
NOT_ASKED = ("cannot answer the second pass", "the second pass has no cached answer", "The second pass could not run")
SHARED = "is shared by"


def read_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def report_of(slug, full, compact):
    for name in (full, compact):
        path = os.path.join(HERE, "pages", slug, name)
        if os.path.exists(path):
            return read_json(path)
    return None


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


def per_page(rows, slugs):
    """{slug: (tp, decided)} for every page of the set, also those with no decided finding."""
    out = {s: [0, 0] for s in slugs}
    for r in rows:
        if r["slug"] not in out:
            continue
        if r["final"] == "true_positive":
            out[r["slug"]][0] += 1
            out[r["slug"]][1] += 1
        elif r["final"] == "false_positive":
            out[r["slug"]][1] += 1
    return out


def percentile_ci(values):
    values = sorted(values)
    return [round(values[int(0.025 * len(values))], 3), round(values[min(len(values) - 1, int(0.975 * len(values)))], 3)]


def bootstrap(pages):
    rng = random.Random(SEED)
    slugs = sorted(pages)
    stats, empty = [], 0
    for _ in range(ROUNDS):
        pick = [slugs[rng.randrange(len(slugs))] for _ in slugs]
        tp = sum(pages[s][0] for s in pick)
        n = sum(pages[s][1] for s in pick)
        if n == 0:
            empty += 1
            continue
        stats.append(tp / n)
    return None if not stats else {"ci95": percentile_ci(stats), "resamples": len(stats), "emptyResamples": empty}


def bootstrap_difference(a, b):
    rng = random.Random(SEED)
    sa, sb = sorted(a), sorted(b)
    diffs, empty = [], 0
    for _ in range(ROUNDS):
        pa = [sa[rng.randrange(len(sa))] for _ in sa]
        pb = [sb[rng.randrange(len(sb))] for _ in sb]
        ta, na = sum(a[s][0] for s in pa), sum(a[s][1] for s in pa)
        tb, nb = sum(b[s][0] for s in pb), sum(b[s][1] for s in pb)
        if na == 0 or nb == 0:
            empty += 1
            continue
        diffs.append(ta / na - tb / nb)
    return None if not diffs else {"ci95": percentile_ci(diffs), "resamples": len(diffs), "emptyResamples": empty}


def reading(newc, boot):
    lo1, hi1 = newc["ci95"]
    lo2, hi2 = boot["ci95"] if boot else (None, None)
    if boot and lo1 > 0 and lo2 > 0:
        return "went up"
    if boot and hi1 < 0 and hi2 < 0:
        return "went down"
    return "no measurable change"


def cell(c):
    if c is None or c["n"] == 0:
        return "–"
    p = "–" if c["precision"] is None else f"{c['precision']:.2f}"
    ci = "" if c["wilson95"] is None else f" ({c['wilson95'][0]:.2f}–{c['wilson95'][1]:.2f})"
    return f"{c['tp']} / {c['fp']} / {c['uncertain']}: **{p}**{ci}"


def judgment_findings(report):
    return [f for lst in ("findings", "belowThreshold", "beyondTarget") for f in report.get(lst, []) if f.get("source") == "judgment"]


def groups_of(rows):
    """Units after the collapse: one per (page, criterion, claim) with more than BURST findings, else one per finding."""
    by = defaultdict(list)
    for r in rows:
        by[(r["slug"], r["criterion"], r.get("claim") or "")].append(r)
    units = []
    for key, members in sorted(by.items()):
        if len(members) > BURST:
            c = Counter(m["final"] for m in members)
            votes = sorted([(c["true_positive"], "true_positive"), (c["false_positive"], "false_positive"), (c["uncertain"], "uncertain")], reverse=True)
            final = "uncertain" if votes[0][0] == votes[1][0] else votes[0][1]
            units.append({"slug": key[0], "criterion": key[1], "claim": key[2], "size": len(members), "final": final, "split": members[0]["split"],
                          "tp": c["true_positive"], "fp": c["false_positive"], "uncertain": c["uncertain"]})
        else:
            units.extend({"slug": m["slug"], "criterion": m["criterion"], "claim": m.get("claim") or "", "size": 1, "final": m["final"], "split": m["split"]} for m in members)
    return units


def page_stats(rows):
    by = defaultdict(lambda: [0, 0])
    for r in rows:
        if r["final"] == "true_positive":
            by[r["slug"]][0] += 1
            by[r["slug"]][1] += 1
        elif r["final"] == "false_positive":
            by[r["slug"]][1] += 1
    pages = [{"slug": s, "tp": v[0], "fp": v[1] - v[0], "precision": v[0] / v[1]} for s, v in sorted(by.items()) if v[1]]
    return {"pages": len(pages), "allTrue": sum(1 for p in pages if p["fp"] == 0),
            "meanPrecision": None if not pages else round(sum(p["precision"] for p in pages) / len(pages), 3), "byPage": pages}


def claim_of_suggestion(n):
    if n.get("criterion") == "2.4.4":
        m = n.get("message") or ""
        for needle, claim in (("shared by", "ambiguous"), ("is an address", "url_or_filename"), ("nothing around it does", "generic"), ("does not match", "mismatch")):
            if needle in m:
                return claim
    return ""


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    meta = read_json(os.path.join(HERE, "data", "pages-input.json"))
    rows = [r for r in read_json(os.path.join(HERE, "data", "findings.json")) if r.get("auditor")]
    slugs = {split: [p["slug"] for p in meta["pages"] if split == "both" or p["split"] == split] for split in ("dev", "test", "both")}
    split_of = {p["slug"]: p["split"] for p in meta["pages"]}
    main_rows = [r for r in rows if r["origin"] == "main"]
    judged = lambda rs: [r for r in rs if r["group"] == "judged"]
    shown_judged = [r for r in judged(main_rows) if r["shown"]]
    sel = lambda rs, split: [r for r in rs if split == "both" or r["split"] == split]
    out = {}

    # Round 4's references: its main run's default-threshold judged findings, per page, over its 12 test or 24 pages.
    r4dir = os.path.join(STUDY, "round-4-2026-10-24", "data")
    r4rows = [r for r in read_json(os.path.join(r4dir, "findings.json")) if r.get("origin", "main") == "main" and r["group"] == "judged" and r["shown"]]
    r4meta = read_json(os.path.join(r4dir, "pages-input.json"))
    r4slugs = {split: [p["slug"] for p in r4meta["pages"] if split == "both" or p["split"] == split] for split in ("test", "both")}
    refs = {"round4Test": per_page(r4rows, r4slugs["test"]), "round4Both": per_page(r4rows, r4slugs["both"])}

    # The primary measure, the dev half and both halves, with their comparisons.
    out["primary"] = {}
    for split in ("test", "dev", "both"):
        c = counts(sel(shown_judged, split))
        pages = per_page(sel(shown_judged, split), slugs[split])
        entry = {"counts": c, "pageBootstrap": bootstrap(pages), "heldOfInSample": None if c["precision"] is None else round(c["precision"] / (IN_SAMPLE[0] / IN_SAMPLE[1]), 3), "comparison": {}}
        for name, ref in refs.items():
            tp_r, n_r = sum(v[0] for v in ref.values()), sum(v[1] for v in ref.values())
            if c["decided"] == 0:
                continue
            newc = newcombe(c["tp"], c["decided"], tp_r, n_r)
            boot = bootstrap_difference(pages, ref)
            entry["comparison"][name] = {"reference": {"tp": tp_r, "decided": n_r, "precision": round(tp_r / n_r, 3)}, "newcombe": newc, "pageBootstrap": boot,
                                         "reading": reading(newc, boot)}
        out["primary"][split] = entry

    # Per group and per page.
    out["groups"] = {}
    for split in ("dev", "test", "both"):
        units = groups_of(sel(shown_judged, split))
        out["groups"][split] = {"counts": counts(units), "collapsed": [u for u in units if u["size"] > 1]}
    out["pages"] = {split: page_stats(sel(shown_judged, split)) for split in ("dev", "test", "both")}

    # The ablations.
    by_key = {}
    for r in rows:
        if r["source"] == "judgment":
            by_key.setdefault((r["slug"], r["criterion"], r.get("ref")), r)
    ablation_rows = [r for r in rows if r["origin"] in ("main", "noconfirm-only")]
    cut_rows, cut_unlabelled = [], []
    for p in meta["pages"]:
        report = report_of(p["slug"], "cut090-report.json", "cut090.judged.json")
        if report is None:
            continue
        for f in judgment_findings(report):
            r = by_key.get((p["slug"], f["criterion"], f.get("ref")))
            if r is None:
                cut_unlabelled.append({"slug": p["slug"], "criterion": f["criterion"], "ref": f.get("ref")})
                continue
            cut_rows.append({**r, "shown": r["shown"] if r["origin"] == "main" else (f.get("confidence") in ("medium", "high") and not f.get("experimental"))})
    nesting_rows = [r for r in rows if r["origin"] == "suggestion-sample" and r.get("sampleReason") == "nesting"]
    out["ablation"] = {}
    for split in ("dev", "test", "both"):
        out["ablation"][split] = {
            "main": counts(sel(shown_judged, split)),
            "noConfirm": counts([r for r in sel(judged(ablation_rows), split) if r["shown"]]),
            "removedByPass": counts([r for r in sel(rows, split) if r["origin"] == "noconfirm-only"]),
            "removedByPassDefault": counts([r for r in sel(rows, split) if r["origin"] == "noconfirm-only" and r["shown"]]),
            "cut090": counts([r for r in sel(judged(cut_rows), split) if r["shown"]]),
            "cut090Only": counts([r for r in sel(cut_rows, split) if r["origin"] == "noconfirm-only"]),
            "noNesting": counts(sel(shown_judged, split) + sel(nesting_rows, split)),
            "nestingClaims": counts(sel(nesting_rows, split)),
            "main111": counts([r for r in sel(shown_judged, split) if r["criterion"] == "1.1.1"]),
            "noConfirm111": counts([r for r in sel(judged(ablation_rows), split) if r["shown"] and r["criterion"] == "1.1.1"]),
            "cut090111": counts([r for r in sel(judged(cut_rows), split) if r["shown"] and r["criterion"] == "1.1.1"]),
        }
    out["ablation"]["cut090Unlabelled"] = cut_unlabelled
    shared = read_json(os.path.join(HERE, "data", "shared-text.json"))
    out["sharedText"] = shared["pages"]

    # The second pass's shares, from the main reports.
    shares = {"dev": Counter(), "test": Counter()}
    for p in meta["pages"]:
        report = report_of(p["slug"], "report.json", "report.judged.json")
        if report is None:
            continue
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
    out["secondPass"] = {s: dict(c) for s, c in shares.items()}
    out["capture"] = read_json(os.path.join(HERE, "data", "capture.json"))

    # The suggestion sample.
    sample = read_json(os.path.join(HERE, "data", "suggestion-sample.json"))
    pool = Counter()
    for v in sample["pages"].values():
        pool[v["split"]] += v["pool"]
    out["suggestions"] = {}
    for reason in ("unstyled", "nesting", "2.4.2", "3.3.2", "seeded"):
        out["suggestions"][reason] = {}
        for split in ("dev", "test", "both"):
            chosen = [r for r in sel(rows, split) if r["origin"] == "suggestion-sample" and r.get("sampleReason") == reason]
            c = counts(chosen)
            entry = {"labelled": c, "byCriterion": {k: counts([r for r in chosen if r["criterion"] == k]) for k in sorted({r["criterion"] for r in chosen})}}
            if reason == "seeded" and c["decided"]:
                size = pool["dev"] + pool["test"] if split == "both" else pool[split]
                entry["movedToReview"] = {"pool": size, "trueFailures": round(c["precision"] * size, 1), "ci95": [round(c["wilson95"][0] * size, 1), round(c["wilson95"][1] * size, 1)]}
            elif reason != "seeded":
                entry["movedToReview"] = {"trueFailures": c["tp"], "uncertain": c["uncertain"], "of": c["n"]}
            out["suggestions"][reason][split] = entry
    out["suggestionPool"] = dict(pool)

    # Bursts: groups of findings, of suggestions and of --no-confirm-only findings.
    bursts = []
    for u in out["groups"]["both"]["collapsed"]:
        bursts.append({"kind": "findings", **u})
    for p in meta["pages"]:
        report = report_of(p["slug"], "report.json", "report.judged.json")
        if report is None:
            continue
        sugg = Counter((n.get("criterion"), claim_of_suggestion(n)) for n in report.get("needsReview", []) if n.get("model"))
        for (crit, claim), n in sugg.items():
            if n > BURST:
                labelled = [r for r in rows if r["slug"] == p["slug"] and r["origin"] == "suggestion-sample" and r["criterion"] == crit]
                bursts.append({"kind": "suggestions", "slug": p["slug"], "split": p["split"], "criterion": crit, "claim": claim, "size": n, "labelled": counts(labelled)})
        extra = Counter((r["criterion"], r.get("claim") or "") for r in rows if r["slug"] == p["slug"] and r["origin"] == "noconfirm-only")
        for (crit, claim), n in extra.items():
            if n > BURST:
                bursts.append({"kind": "noconfirm-only", "slug": p["slug"], "split": p["split"], "criterion": crit, "claim": claim, "size": n,
                               "labelled": counts([r for r in rows if r["slug"] == p["slug"] and r["origin"] == "noconfirm-only" and r["criterion"] == crit])})
    out["bursts"] = bursts

    with open(os.path.join(HERE, "data", "extras.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print("### Primary (test), dev and both halves: default threshold, judged criteria, per element\n")
    print("| Set | TP / FP / unc.: precision (Wilson) | Page bootstrap | Share of the in-sample 0.86 | vs round 4 test (14 / 26) | vs round 4 both (27 / 93) |")
    print("| --- | --- | --- | --- | --- | --- |")
    for split, e in out["primary"].items():
        b = e["pageBootstrap"]
        comp = []
        for name in ("round4Test", "round4Both"):
            v = e["comparison"].get(name)
            comp.append("–" if not v else f"{v['newcombe']['difference']:+.2f} (Newcombe {v['newcombe']['ci95'][0]:+.2f} to {v['newcombe']['ci95'][1]:+.2f}; bootstrap {v['pageBootstrap']['ci95'][0]:+.2f} to {v['pageBootstrap']['ci95'][1]:+.2f}): {v['reading']}")
        boot = "–" if not b else f"{b['ci95'][0]:.2f}–{b['ci95'][1]:.2f}"
        print(f"| {split} | {cell(e['counts'])} | {boot} | {e['heldOfInSample']} | {comp[0]} | {comp[1]} |")
    print("\n### Per group and per page\n")
    for split in ("dev", "test", "both"):
        g, pg = out["groups"][split], out["pages"][split]
        print(f"{split}: per group {cell(g['counts'])}; pages with a decided finding {pg['pages']}, all true {pg['allTrue']}, mean page precision {pg['meanPrecision']}")
    print("\n### Ablations\n")
    print("| Split | Main | --no-confirm | removed by the pass | cut 0.9 | cut-0.9-only | without the nesting | nesting claims | 1.1.1 main | 1.1.1 --no-confirm | 1.1.1 cut 0.9 |")
    print("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |")
    for split in ("dev", "test", "both"):
        v = out["ablation"][split]
        print(f"| {split} | {cell(v['main'])} | {cell(v['noConfirm'])} | {cell(v['removedByPass'])} | {cell(v['cut090'])} | {cell(v['cut090Only'])} | {cell(v['noNesting'])} | {cell(v['nestingClaims'])} | {cell(v['main111'])} | {cell(v['noConfirm111'])} | {cell(v['cut090111'])} |")
    print("cut090 findings with no label:", out["ablation"]["cut090Unlabelled"])
    print("\nsecond pass:", json.dumps(out["secondPass"]))
    print("\n### Suggestions\n")
    for reason, v in out["suggestions"].items():
        for split in ("dev", "test", "both"):
            e = v[split]
            print(f"{reason} {split}: {cell(e['labelled'])}; moved to review {e.get('movedToReview')}; by criterion {{{', '.join(f'{k}: {cell(x)}' for k, x in e['byCriterion'].items())}}}")
    print("pool:", out["suggestionPool"])
    print("\n### Bursts\n")
    for b in bursts:
        print(b)


if __name__ == "__main__":
    main()
