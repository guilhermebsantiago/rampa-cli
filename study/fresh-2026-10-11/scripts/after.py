"""The fresh-page study after the 2.4.4/2.4.6 change: match, packets, numbers.

Two runs of today's build on the study's saved snapshots, with the study's flags:
  after   pages/<slug>/after-report.json   (scripts/run-after.sh): 2.4.4 and 2.4.6 asked again, every other
          prompt read back from a copy of the study's cache
  replay  pages/<slug>/replay-report.json  (scripts/run-replay.sh): the study's own answers, offline
and, for each, every 2.4.4/2.4.6 candidate's fate (scripts/fates.ts) in data/after/fates*/<slug>.json.

  python -I after.py match     matches each run's findings to the study's labelled ones, writes data/after/matches.json
                               and an evidence packet packets/<slug>--after.json (packets.py's format) for the
                               findings that match none, to be labelled by an auditor and a skeptic
  python -I after.py analyze   with the labels in labels/<slug>--after.{auditor,skeptic}.json, writes
                               data/after/findings.json, data/after/summary.json and prints the tables

A finding of a run matches a labelled finding of the study's default run on the same page by fingerprint (criterion,
element and the quoted subject); else by criterion, element (ref) and claim (the message, compared without case and
spacing). One labelled finding matches at most one finding. A matched finding reuses the study's two labels; one
whose claim changed on the same fingerprint keeps them, and is flagged. A model's suggestion (a needsReview item
with a model) is matched to a labelled finding by criterion and element, so its label can be counted, but it is
not a finding and is not in any precision.
"""

import glob
import json
import os
import re
import statistics
import sys
import unicodedata
from collections import Counter, defaultdict

sys.dont_write_bytecode = True  # importing the study's scripts must leave no __pycache__ behind
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import packets as P  # noqa: E402  (the study's packet builder: Page, packet, keyed, shown_by_default, kind_of)
import analyze as A  # noqa: E402  (wilson, cohen_kappa, precision_row, final_of)

HERE = P.HERE
OUT = os.path.join(HERE, "data", "after")
MODES = {"after": "after-report.json", "replay": "replay-report.json"}
FATES = {"after": "fates", "replay": "fates-replay"}
CRITERIA = A.CRITERIA
LABELLED_KINDS = ("judgment", "experimental-judgment", "rule", "other-judgment", "probe")
LINKS_HEADINGS = ("2.4.4", "2.4.6")


def read_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def norm(text):
    text = unicodedata.normalize("NFC", text or "")
    return re.sub(r"\s+", " ", text).strip().lower()


def run_findings(report):
    findings = P.keyed(P.all_findings(report))
    for f in findings:
        f["kind"] = P.kind_of(f, False)
    return [f for f in findings if f["kind"] in LABELLED_KINDS]


def suggestions(report):
    return [n for n in report.get("needsReview", []) if n.get("model")]


def match_page(news, olds):
    """Pairs each new finding with at most one old labelled finding: fingerprint first, then criterion + ref + claim."""
    used = set()
    for how, same in (
        ("fingerprint", lambda f, o: o["fingerprint"] == f["fingerprint"]),
        ("element+claim", lambda f, o: o["criterion"] == f["criterion"] and (o.get("ref") or "") == (f.get("ref") or "") and norm(o["message"]) == norm(f["message"])),
    ):
        for f in news:
            if "match" in f:
                continue
            for o in olds:
                if o["key"] in used or not same(f, o):
                    continue
                used.add(o["key"])
                f["match"] = {"by": how, "key": o["key"], "claimChanged": norm(o["message"]) != norm(f["message"])}
                break
    return used


def fates_of(mode, slug):
    path = os.path.join(OUT, FATES[mode], f"{slug}.json")
    if not os.path.exists(path):
        return {}
    return {(r["criterion"], r["ref"]): r for r in read_json(path)}


def match():
    meta = read_json(os.path.join(HERE, "data", "pages-input.json"))
    study = [r for r in read_json(os.path.join(HERE, "data", "findings.json")) if r["run"] == "default"]
    out = {"pages": []}
    for page_meta in meta["pages"]:
        slug = page_meta["slug"]
        base = os.path.join(HERE, "pages", slug)
        olds = [o for o in study if o["slug"] == slug]
        entry = {"slug": slug, "split": page_meta["split"], "runs": {}}
        page = P.Page(read_json(P.snapshot_file(os.path.join(base, "recording"))))
        for mode, name in MODES.items():
            path = os.path.join(base, name)
            if not os.path.exists(path):
                continue
            report = read_json(path)
            news = run_findings(report)
            used = match_page(news, olds)
            sugg = suggestions(report)
            sugg_used = set()
            for s in sugg:
                cands = [o for o in olds if o["criterion"] == s["criterion"] and (o.get("ref") or "") == (s.get("ref") or "") and o["key"] not in sugg_used]
                exact = [o for o in cands if norm(o["message"]) == norm(s["message"])]
                o = (exact or cands or [None])[0]
                if o is not None:
                    sugg_used.add(o["key"])
                    s["match"] = {"key": o["key"], "claimChanged": not exact}
            # Where each of the study's labelled 2.4.4 and 2.4.6 findings went in this run.
            fates = fates_of(mode, slug)
            by_old = {f["match"]["key"]: f for f in news if "match" in f}
            sugg_by_old = {s["match"]["key"]: s for s in sugg if "match" in s}
            old_fates = []
            for o in olds:
                if o["criterion"] not in LINKS_HEADINGS:
                    continue
                if o["key"] in by_old:
                    f = by_old[o["key"]]
                    fate = "finding, default threshold" if f["shown"] else "finding, below the threshold"
                elif o["key"] in sugg_by_old:
                    fate = "suggestion"
                else:
                    c = fates.get((o["criterion"], o.get("ref")))
                    fate = "not a candidate" if c is None else {"passed": "model passed it", "discarded": "discarded by verification",
                                                               "capped": "past the cap", "offline-miss": "not asked (offline)",
                                                               "cannot_tell": "cannot tell", "not-judged": "time limit"}.get(c["fate"], c["fate"])
                    if c is not None and c["fate"] in ("finding", "suggestion"):
                        fate = f"{c['fate']} on another claim"
                old_fates.append({"key": o["key"], "criterion": o["criterion"], "shownBefore": o["shown"], "final": o["final"], "fate": fate,
                                  "subject": o.get("subject") or o.get("evidence")})
            unmatched = [f for f in news if "match" not in f]
            entry["runs"][mode] = {
                "findings": [{k: f.get(k) for k in ("key", "fingerprint", "criterion", "source", "ruleId", "kind", "shown", "confidence", "experimental",
                                                    "ref", "subject", "message", "evidence", "match")} for f in news],
                "suggestions": [{k: s.get(k) for k in ("criterion", "ref", "message", "evidence", "model", "match")} for s in sugg],
                "studyLinksHeadings": old_fates,
                "unmatched": len(unmatched),
                "usage": report.get("usage"),
                "criteria": {c["criterion"]: {k: c.get(k) for k in ("candidates", "judged", "failed", "suggested", "discarded", "capped", "timedOut", "offlineMisses", "errors")}
                             for c in report["criteria"]},
                "errors": report.get("errors"),
            }
            if mode == "after":
                packet_name = f"{slug}--after"
                packet_path = os.path.join(HERE, "packets", f"{packet_name}.json")
                if unmatched:
                    crops = os.path.join(HERE, "packets", packet_name)
                    P.write_json(packet_path, {
                        "page": page_meta["url"], "slug": slug, "run": "default", "title": page.snapshot.get("title"),
                        "language": page.snapshot.get("locale"),
                        "snapshot": os.path.relpath(P.snapshot_file(os.path.join(base, "recording")), HERE).replace("\\", "/"),
                        "screenshot": f"pages/{slug}/main-screenshot.png", "collectedAt": page.snapshot.get("collectedAt"),
                        "findings": [P.packet(f, page, crops) for f in unmatched],
                    })
                elif os.path.exists(packet_path):
                    os.remove(packet_path)
            print(f"{mode:6} {slug:32} {len(news):3} findings, {len(news) - len(unmatched):3} matched, {len(unmatched):2} new; "
                  f"{len(sugg):2} suggestions ({sum(1 for s in sugg if 'match' in s)} on a labelled finding)")
        out["pages"].append(entry)
    P.write_json(os.path.join(OUT, "matches.json"), out)


def label_rows(mode, matches, study, labels):
    """One row per finding of the run, with the study's labels (matched) or the new judges' (unmatched)."""
    by_key = {(r["slug"], r["key"]): r for r in study}
    rows = []
    for page in matches["pages"]:
        run = page["runs"].get(mode)
        if not run:
            continue
        for f in run["findings"]:
            group = A.GROUP.get(f["kind"], f["kind"])
            row = {"slug": page["slug"], "split": page["split"], "mode": mode, **f, "group": group}
            if f.get("match"):
                o = by_key[(page["slug"], f["match"]["key"])]
                row.update({"labelFrom": "study", "auditor": o["auditor"], "skeptic": o["skeptic"], "agreed": o["agreed"], "final": o["final"], "finalCause": o["finalCause"]})
            else:
                a = labels.get((f"{page['slug']}--after", "auditor"), {}).get(f["key"])
                s = labels.get((f"{page['slug']}--after", "skeptic"), {}).get(f["key"])
                if a is None or s is None:
                    row.update({"labelFrom": None, "auditor": None, "skeptic": None, "agreed": None, "final": "uncertain", "finalCause": None})
                else:
                    agreed, final, cause = A.final_of(a, s)
                    row.update({"labelFrom": "new", "auditor": {k: a.get(k) for k in ("label", "cause", "rationale")},
                                "skeptic": {k: s.get(k) for k in ("label", "cause", "rationale")}, "agreed": agreed, "final": final, "finalCause": cause})
            rows.append(row)
    return rows


def cell(r):
    if r is None or r["findings"] == 0:
        return "–"
    p = "–" if r["precision"] is None else f"{r['precision']:.2f}"
    ci = "" if r["wilson95"] is None else f" ({r['wilson95'][0]:.2f}–{r['wilson95'][1]:.2f})"
    return f"{r['truePositive']} / {r['falsePositive']} / {r['uncertain']}: **{p}**{ci}"


def analyze():
    matches = read_json(os.path.join(OUT, "matches.json"))
    study = [dict(r, mode="before") for r in read_json(os.path.join(HERE, "data", "findings.json")) if r["run"] == "default"]
    labels = {}
    for path in glob.glob(os.path.join(HERE, "labels", "*--after.*.json")):
        name = os.path.basename(path)[: -len(".json")]
        packet, role = name.rsplit(".", 1)
        labels[(packet, role)] = {j["fingerprint"]: j for j in read_json(path)["judgments"]}
    rows = {"before": study, "after": label_rows("after", matches, study, labels), "replay": label_rows("replay", matches, study, labels)}
    missing = [f"{r['slug']}:{r['key']}" for r in rows["after"] + rows["replay"] if r["labelFrom"] is None]
    if missing:
        print(f"warning: {len(missing)} findings have no labels yet: {', '.join(missing[:10])}", file=sys.stderr)

    summary = {"precision": {}, "linksHeadings": {}, "suggestions": {}, "agreementNew": None, "pages": {}}
    for mode, mrows in rows.items():
        judged = [r for r in mrows if r["group"] == "judged"]
        summary["precision"][mode] = {}
        for split in ("dev", "test", "all"):
            sel = judged if split == "all" else [r for r in judged if r["split"] == split]
            summary["precision"][mode][split] = {
                "default": A.table([r for r in sel if r["shown"]], lambda r: r["criterion"], CRITERIA),
                "all": A.table(sel, lambda r: r["criterion"], CRITERIA),
            }
        everything = {split: {"default": A.precision_row([r for r in mrows if r["shown"] and (split == "all" or r["split"] == split)]),
                              "all": A.precision_row([r for r in mrows if split == "all" or r["split"] == split])} for split in ("dev", "test", "all")}
        summary["precision"][mode]["everything"] = everything

    # The study's 2.4.4 and 2.4.6 findings, and what each run did with them.
    for mode in ("after", "replay"):
        fates = []
        for page in matches["pages"]:
            run = page["runs"].get(mode)
            if run:
                fates += [dict(x, slug=page["slug"], split=page["split"]) for x in run["studyLinksHeadings"]]
        summary["linksHeadings"][mode] = {
            "fates": fates,
            "counts": {f"{split} {crit}": dict(Counter(f"{x['fate']} | {x['final']}" for x in fates if x["split"] == split and x["criterion"] == crit))
                       for split in ("dev", "test") for crit in LINKS_HEADINGS},
        }
        per_page = []
        for page in matches["pages"]:
            run = page["runs"].get(mode)
            if not run:
                continue
            s = run["suggestions"]
            per_page.append({"slug": page["slug"], "split": page["split"], "suggestions": len(s),
                             "byCriterion": dict(Counter(x["criterion"] for x in s)),
                             "onLabelledFinding": dict(Counter(next((o["final"] for o in study if o["slug"] == page["slug"] and o["key"] == x["match"]["key"]), "?") for x in s if x.get("match"))),
                             "new": sum(1 for x in s if not x.get("match")),
                             "usage": run["usage"], "criteria": {c: run["criteria"].get(c) for c in LINKS_HEADINGS}})
        summary["suggestions"][mode] = per_page

    new_rows = [r for r in rows["after"] + rows["replay"] if r["labelFrom"] == "new"]
    seen, uniq = set(), []
    for r in new_rows:
        if (r["slug"], r["key"]) not in seen:
            seen.add((r["slug"], r["key"]))
            uniq.append(r)
    summary["agreementNew"] = A.cohen_kappa([(r["auditor"]["label"], r["skeptic"]["label"]) for r in uniq], A.LABELS)
    summary["newFindings"] = [{k: r.get(k) for k in ("slug", "split", "mode", "key", "criterion", "kind", "shown", "confidence", "subject", "message", "final", "finalCause")}
                              | {"auditor": (r["auditor"] or {}).get("label"), "skeptic": (r["skeptic"] or {}).get("label")} for r in uniq]
    summary["claimChanged"] = [{k: r.get(k) for k in ("slug", "mode", "key", "criterion", "message", "final")} for r in rows["after"] + rows["replay"] if (r.get("match") or {}).get("claimChanged")]
    summary["missingLabels"] = missing

    # 2.4.4 and 2.4.6 together, per run, split and threshold.
    lh = {}
    for mode, mrows in rows.items():
        for split in ("dev", "test", "all"):
            sel = [r for r in mrows if r["group"] == "judged" and r["criterion"] in LINKS_HEADINGS and (split == "all" or r["split"] == split)]
            lh[f"{mode} {split} default"] = A.precision_row([r for r in sel if r["shown"]])
            lh[f"{mode} {split} all"] = A.precision_row(sel)
    summary["linksHeadingsPrecision"] = lh

    # How often a new call gave the study's verdict: candidates both runs judged (fates of the after run and of the replay).
    stability = Counter()
    for path in glob.glob(os.path.join(OUT, FATES["after"], "*.json")):
        replay = {(r["criterion"], r["ref"]): r for r in read_json(os.path.join(OUT, FATES["replay"], os.path.basename(path)))}
        for r in read_json(path):
            o = replay.get((r["criterion"], r["ref"]))
            new_v, old_v = (r.get("output") or {}).get("verdict"), ((o or {}).get("output") or {}).get("verdict")
            if new_v and old_v:
                stability[f"{r['criterion']} {old_v}->{new_v}"] += 1
    summary["verdictStability"] = dict(sorted(stability.items()))

    P.write_json(os.path.join(OUT, "findings.json"), [{k: r.get(k) for k in ("slug", "split", "mode", "key", "fingerprint", "criterion", "source", "ruleId", "kind", "group", "experimental",
                                                                              "shown", "confidence", "ref", "subject", "message", "evidence", "match", "labelFrom",
                                                                              "auditor", "skeptic", "agreed", "final", "finalCause")} for r in rows["after"] + rows["replay"]])
    P.write_json(os.path.join(OUT, "summary.json"), summary)
    print_tables(summary)


def print_tables(s):
    sys.stdout.reconfigure(encoding="utf-8")
    pr = s["precision"]
    names = {"before": "Before (study, `ebd4d07`)", "after": "After, 2.4.4/2.4.6 asked again", "replay": "After, the study's answers replayed"}
    print("\n### Judged criteria, before and after (TP / FP / uncertain: precision, 95% Wilson)\n")
    print("| Run | Dev, default | Dev, all findings | Test, default | Test, all findings |")
    print("| --- | --- | --- | --- | --- |")
    for mode in ("before", "after", "replay"):
        row = [cell(A_by(pr[mode][sp][t]).get("all")) for sp in ("dev", "test") for t in ("default", "all")]
        print(f"| {names[mode]} | " + " | ".join(row) + " |")
    for mode in ("before", "after", "replay"):
        print(f"\n#### Per criterion: {names[mode]}\n")
        print("| Criterion | Dev, default | Dev, all findings | Test, default | Test, all findings |")
        print("| --- | --- | --- | --- | --- |")
        for c in CRITERIA + ("all",):
            row = [cell(A_by(pr[mode][sp][t]).get(c)) for sp in ("dev", "test") for t in ("default", "all")]
            if any(x != "–" for x in row):
                print(f"| {c} | " + " | ".join(row) + " |")
    print("\nBoth splits:", {m: (cell(A_by(pr[m]["all"]["default"]).get("all")), cell(A_by(pr[m]["all"]["all"]).get("all"))) for m in pr})
    print("Everything (judged + experimental):", json.dumps({m: {sp: {t: (v["truePositive"], v["falsePositive"], v["uncertain"]) for t, v in pr[m]["everything"][sp].items()} for sp in ("dev", "test")} for m in pr}))
    print("\n### 2.4.4 and 2.4.6 together\n")
    print("| Run | Dev, default | Dev, all findings | Test, default | Test, all findings |")
    print("| --- | --- | --- | --- | --- |")
    for mode in ("before", "after", "replay"):
        print(f"| {names[mode]} | " + " | ".join(cell(s["linksHeadingsPrecision"][f"{mode} {sp} {t}"]) for sp in ("dev", "test") for t in ("default", "all")) + " |")

    fates_order = ("finding, default threshold", "finding, below the threshold", "suggestion", "discarded by verification", "model passed it", "cannot tell", "past the cap")
    short = {"true_positive": "TP", "false_positive": "FP", "uncertain": "unc."}
    for mode in ("after", "replay"):
        print(f"\n### Where the study's labelled 2.4.4 and 2.4.6 findings went, run {mode}\n")
        print("| Split | Criterion | Study's findings | " + " | ".join(f.capitalize() for f in fates_order) + " |")
        print("| --- | --- | --- | " + " | ".join("---" for _ in fates_order) + " |")
        fates = s["linksHeadings"][mode]["fates"]
        for split in ("dev", "test"):
            for crit in LINKS_HEADINGS:
                xs = [x for x in fates if x["split"] == split and x["criterion"] == crit]
                labels = Counter(x["final"] for x in xs)
                total = f"{len(xs)} ({labels['true_positive']} / {labels['false_positive']} / {labels['uncertain']})"
                cells = []
                for fate in fates_order:
                    c = Counter(x["final"] for x in xs if x["fate"] == fate)
                    n = sum(c.values())
                    cells.append("–" if n == 0 else f"{n} ({', '.join(f'{c[k]} {short[k]}' for k in A.LABELS if c[k])})")
                print(f"| {split} | {crit} | {total} | " + " | ".join(cells) + " |")
        other = Counter(x["fate"] for x in fates if x["fate"] not in fates_order)
        if other:
            print("other fates:", dict(other))

    print("\n### Suggestions per page (needsReview items from the model)\n")
    print("| Split | Page | After: suggestions (2.4.4 + 2.4.6) | On a labelled finding (TP / FP / unc.) | On nothing the study labelled | Replay: suggestions |")
    print("| --- | --- | ---: | --- | ---: | ---: |")
    replay = {p["slug"]: p for p in s["suggestions"]["replay"]}
    for p in sorted(s["suggestions"]["after"], key=lambda p: (p["split"], p["slug"])):
        lab = p["onLabelledFinding"]
        by = p["byCriterion"]
        print(f"| {p['split']} | {p['slug']} | {p['suggestions']} ({by.get('2.4.4', 0)} + {by.get('2.4.6', 0)}) | "
              f"{lab.get('true_positive', 0)} / {lab.get('false_positive', 0)} / {lab.get('uncertain', 0)} | {p['new']} | {replay[p['slug']]['suggestions']} |")
    for split in ("dev", "test"):
        for mode in ("after", "replay"):
            pp = [p for p in s["suggestions"][mode] if p["split"] == split]
            n = [p["suggestions"] for p in pp]
            lab = Counter()
            for p in pp:
                lab.update(p["onLabelledFinding"])
            print(f"{mode} {split}: {sum(n)} suggestions, median {statistics.median(n)} per page (range {min(n)}-{max(n)}), labelled {dict(lab)}, "
                  f"calls {sum(p['usage']['calls'] for p in pp)}, cached {sum(p['usage']['cachedCalls'] for p in pp)}")
    print("\nverdict stability:", s["verdictStability"])
    print("2.4.4/2.4.6 precision:", json.dumps({k: (v["truePositive"], v["falsePositive"], v["uncertain"], v["precision"], v["wilson95"]) for k, v in s["linksHeadingsPrecision"].items()}))
    print("\nnew findings:", len(s["newFindings"]), "agreement:", s["agreementNew"])
    for r in s["newFindings"]:
        print("  ", json.dumps(r, ensure_ascii=False)[:400])
    print("claim changed:", len(s["claimChanged"]))
    for r in s["claimChanged"]:
        print("  ", json.dumps(r, ensure_ascii=False)[:300])


def A_by(rows):
    return {r["key"]: r for r in rows}


if __name__ == "__main__":
    {"match": match, "analyze": analyze}[sys.argv[1]]()
