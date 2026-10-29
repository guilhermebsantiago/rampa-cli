"""Numbers of the fifth real-page study: the fourth study's analyze.py (study/round-4-2026-10-24/scripts/analyze.py),
on the main run's rows, with the fourth study as the comparison (the pre-registered primary measure with its intervals,
the groups, the pages, the ablations, the suggestion sample and the bursts: scripts/extras.py). A report is read from
pages/<slug>/report.json when the full one is there, else from the part of it git keeps (report.judged.json).

Inputs (relative to study/round-5-2026-10-28):
  data/pages-input.json                     the pages and their split (scripts/split.py)
  data/findings-raw.json                    every labelled finding (scripts/packets.py)
  labels/<packet>.{auditor,skeptic}.json    the two judges' labels
  pages/<slug>/report.json (or report.judged.json), run-*.json   the reports and how each run went
and, for the comparison, the fourth study's ../round-4-2026-10-24/data/summary.json (aggregate numbers only).

Outputs: data/findings.json (one row per labelled finding, with both judges' labels: the format Rampa Lab's
review mode reads, with data/pages.json), data/pages.json, data/summary.json.

Final label and precision as in the first study: the label both judges gave, else uncertain; precision
TP / (TP + FP) with uncertain left out; 95% Wilson intervals; Cohen's kappa over the three labels.
"Default threshold" counts the findings at medium confidence or above, which `rampa check` shows by
default; "all findings" adds those below it (the run used --min-confidence low, so its report lists both).

Run: python -I study/round-5-2026-10-28/scripts/analyze.py
"""

import glob
import json
import math
import os
import sys
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STUDY = os.path.dirname(HERE)
LABELS = ("true_positive", "false_positive", "uncertain")
CRITERIA = ("1.1.1", "1.3.5", "2.4.2", "2.4.4", "2.4.6", "3.1.1", "3.1.2", "3.3.2")
SPLITS = ("dev", "test", "all")
Z = 1.959963984540054
# What each kind of finding is, for the tables: the default judged criteria, or an experimental check.
GROUP = {"judgment": "judged", "experimental-judgment": "experimental", "rule": "experimental",
         "other-judgment": "experimental", "probe": "probe", "probe-judgment": "probe"}


def read_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")


def wilson(successes, n):
    if n == 0:
        return None
    p = successes / n
    denom = 1 + Z * Z / n
    centre = (p + Z * Z / (2 * n)) / denom
    half = Z * math.sqrt(p * (1 - p) / n + Z * Z / (4 * n * n)) / denom
    return [round(max(0.0, centre - half), 3), round(min(1.0, centre + half), 3)]


def cohen_kappa(pairs, categories):
    n = len(pairs)
    if n == 0:
        return None
    observed = sum(1 for a, b in pairs if a == b) / n
    ca = Counter(a for a, _ in pairs)
    cb = Counter(b for _, b in pairs)
    expected = sum(ca[c] * cb[c] for c in categories) / (n * n)
    kappa = None if expected == 1 else (observed - expected) / (1 - expected)
    return {"n": n, "observedAgreement": round(observed, 3), "expectedAgreement": round(expected, 3),
            "kappa": None if kappa is None else round(kappa, 3)}


def precision_row(rows):
    c = Counter(r["final"] for r in rows)
    tp, fp, unc = c["true_positive"], c["false_positive"], c["uncertain"]
    n = tp + fp
    return {"findings": len(rows), "truePositive": tp, "falsePositive": fp, "uncertain": unc, "decided": n,
            "precision": None if n == 0 else round(tp / n, 3), "wilson95": wilson(tp, n),
            "pages": len({r["slug"] for r in rows})}


def table(rows, key, keys=None):
    keys = keys or sorted({key(r) for r in rows})
    out = [{"key": k, **precision_row([r for r in rows if key(r) == k])} for k in keys]
    return [r for r in out if r["findings"] > 0] + [{"key": "all", **precision_row(rows)}]


def in_split(rows, split):
    return rows if split == "all" else [r for r in rows if r["split"] == split]


def final_of(a, s):
    agreed = a["label"] == s["label"]
    final = a["label"] if agreed else "uncertain"
    cause = (a["cause"] if a["cause"] == s["cause"] else "disputed") if final == "false_positive" else None
    return agreed, final, cause


def report_of(base, full, compact):
    """A page's report: the full one when it is on disk, else the part of it git keeps (scripts/compact.py)."""
    for name in (full, compact):
        path = os.path.join(base, name)
        if os.path.exists(path):
            return read_json(path)
    return None


def run_info(slug, pattern):
    runs = [read_json(p) for p in sorted(glob.glob(os.path.join(HERE, "pages", slug, pattern)))]
    return runs


def main():
    meta = read_json(os.path.join(HERE, "data", "pages-input.json"))
    pages_meta = {p["slug"]: p for p in meta["pages"]}
    raw = read_json(os.path.join(HERE, "data", "findings-raw.json"))
    labels = {}
    for path in glob.glob(os.path.join(HERE, "labels", "*.json")):
        name = os.path.basename(path)[: -len(".json")]
        packet, role = name.rsplit(".", 1)
        labels[(packet, role)] = {j["fingerprint"]: j for j in read_json(path)["judgments"]}

    findings, missing = [], []
    for r in raw:
        a = labels.get((r["packet"], "auditor"), {}).get(r["key"])
        s = labels.get((r["packet"], "skeptic"), {}).get(r["key"])
        group = GROUP.get(r["kind"], r["kind"])
        row = {**r, "group": group, "experimental": bool(r.get("experimental")) or group != "judged"}
        if a is None or s is None:
            missing.append(f"{r['packet']}:{r['key']}")
            row.update({"auditor": None, "skeptic": None, "agreed": None, "final": "uncertain", "finalCause": None, "labelled": False})
        else:
            agreed, final, cause = final_of(a, s)
            row.update({"auditor": {k: a.get(k) for k in ("label", "cause", "rationale")},
                        "skeptic": {k: s.get(k) for k in ("label", "cause", "rationale")},
                        "agreed": agreed, "final": final, "finalCause": cause, "labelled": True})
        findings.append(row)
    if missing:
        print(f"warning: {len(missing)} findings have no labels yet: {', '.join(missing[:8])}", file=sys.stderr)

    # The packets also hold the --no-confirm run's extra claims and the chosen suggestions (origin);
    # the study's precision is the main run's, so the tables below read the main rows, and scripts/extras.py the rest.
    all_rows = findings
    findings = [f for f in all_rows if f.get("origin", "main") == "main"]

    judged = [f for f in findings if f["group"] == "judged"]
    experimental = [f for f in findings if f["group"] == "experimental"]
    probes = [f for f in findings if f["group"] == "probe"]

    def rule_key(f):
        if f["kind"] == "experimental-judgment":
            return f"judgment {f['criterion']}, experimental" + (" (hidden image, e88epe)" if (f.get("subject") or "").startswith("hidden ") else "")
        if f["source"] == "judgment":
            return f"judgment {f['criterion']}"
        return f"{f.get('ruleId') or f['source']} ({f['criterion']})"

    precision = {}
    for split in SPLITS:
        rows = in_split(judged, split)
        precision[split] = {
            "judgedDefault": table([f for f in rows if f["shown"]], lambda f: f["criterion"], CRITERIA),
            "judgedAll": table(rows, lambda f: f["criterion"], CRITERIA),
            "experimentalAll": table(in_split(experimental, split), rule_key),
            "experimentalDefault": table([f for f in in_split(experimental, split) if f["shown"]], rule_key),
            "probesAll": table(in_split(probes, split), rule_key),
            "probesDefault": table([f for f in in_split(probes, split) if f["shown"]], rule_key),
            "everythingDefault": precision_row([f for f in in_split(findings, split) if f["shown"]]),
            "everythingAll": precision_row(in_split(findings, split)),
        }

    # Where the judged findings at each threshold come from: the claims about ordinary text sit below it.
    confidence_mix = {split: dict(Counter(f"{f['criterion']} {f['confidence']}" for f in in_split(judged, split))) for split in SPLITS}

    # Sensitivity: each split without the page that holds the most judged findings, and best/worst cases for uncertain.
    sensitivity = {}
    for split in ("dev", "test"):
        rows = in_split(judged, split)
        for threshold, sel in (("default", [f for f in rows if f["shown"]]), ("all", rows)):
            if not sel:
                continue
            top, count = Counter(f["slug"] for f in sel).most_common(1)[0]
            c = Counter(f["final"] for f in sel)
            sensitivity[f"{split} {threshold}"] = {
                "topPage": top, "topPageFindings": count, "of": len(sel),
                "withoutTopPage": precision_row([f for f in sel if f["slug"] != top]),
                "uncertainAsTrue": round((c["true_positive"] + c["uncertain"]) / len(sel), 3),
                "uncertainAsFalse": round(c["true_positive"] / len(sel), 3),
            }

    pages = []
    for p in meta["pages"]:
        slug = p["slug"]
        base = os.path.join(HERE, "pages", slug)
        collect = run_info(slug, "run-main-collect-*.json")
        judged_run = run_info(slug, "run-default-judged.json")
        probe_collect = run_info(slug, "run-probe-collect-*.json")
        probe_judged = run_info(slug, "run-probe-judged.json")
        report = report_of(base, "report.json", "report.judged.json")
        entry = {k: p[k] for k in ("slug", "url", "split", "region", "country", "category", "pageType", "language", "probeRun", "selection", "recording")}
        entry["collect"] = {"attempts": len(collect), "seconds": collect[-1]["seconds"] if collect else None,
                            "exitCode": collect[-1]["exitCode"] if collect else None}
        if report is not None:
            all_f = report["findings"] + report.get("belowThreshold", [])
            levels = {"low": 0, "medium": 1, "high": 2}
            mine = [f for f in judged if f["slug"] == slug]
            entry["title"] = None
            entry["judged"] = {
                "seconds": judged_run[0]["seconds"] if judged_run else None,
                "exitCode": judged_run[0]["exitCode"] if judged_run else None,
                "modelCalls": report["usage"]["calls"], "cachedCalls": report["usage"]["cachedCalls"],
                "judgedFindingsDefault": sum(1 for f in mine if f["shown"]), "judgedFindingsAll": len(mine),
                "experimentalFindings": sum(1 for f in experimental if f["slug"] == slug),
                # A compact report keeps the engine findings' count only (scripts/compact.py).
                "engineFindings": sum(1 for f in all_f if f["source"] == "engine") or sum((report.get("engineFindings") or {}).get(k, 0) for k in ("findings", "belowThreshold")),
                "discarded": len(report.get("discarded", [])),
                "needsReview": len(report.get("needsReview", [])),
                # A model's fail that no checked fact supports is a suggestion to review, not a finding (the
                # 2.4.4/2.4.6 change); counted as the second study's after.py did, never labelled.
                "suggestions": dict(Counter(n.get("criterion") for n in report.get("needsReview", []) if n.get("model"))),
                "criteria": {c["criterion"]: {k: c.get(k) for k in ("candidates", "judged", "failed", "passed", "cannotTell", "discarded", "capped", "timedOut", "offlineMisses", "decided", "errors")}
                             for c in report["criteria"]},
                "notes": report.get("notes"),
                "errors": report.get("errors"),
            }
            entry["secondsTotal"] = (entry["collect"]["seconds"] or 0) + (entry["judged"]["seconds"] or 0)
            snaps = glob.glob(os.path.join(base, "recording", "*.snapshot.json"))
            if snaps:
                entry["title"] = read_json(snaps[0]).get("title")
        else:
            entry["judged"] = None
        if p["probeRun"]:
            probe_report = os.path.join(base, "probe-report.json")
            entry["probe"] = {"collectSeconds": probe_collect[-1]["seconds"] if probe_collect else None,
                              "collectAttempts": len(probe_collect),
                              "judgedSeconds": probe_judged[0]["seconds"] if probe_judged else None}
            if os.path.exists(probe_report):
                pr = read_json(probe_report)
                entry["probe"].update({"modelCalls": pr["usage"]["calls"], "cachedCalls": pr["usage"]["cachedCalls"],
                                       "probeFindings": sum(1 for f in probes if f["slug"] == slug),
                                       "needsReview": len(pr.get("needsReview", [])),
                                       "probeNeedsReview": sum(1 for n in pr.get("needsReview", []) if n.get("source") == "probe" or str(n.get("ruleId", "")).startswith("rampa/") and n.get("probe"))})
        pages.append(entry)

    # How often the model flags: candidates judged and reported failing, per criterion and split.
    flag = defaultdict(lambda: {"candidates": 0, "judged": 0, "failed": 0, "capped": 0})
    for e in pages:
        if not e["judged"]:
            continue
        for crit, c in e["judged"]["criteria"].items():
            for split in (e["split"], "all"):
                agg = flag[f"{split} {crit}"]
                for k in ("candidates", "judged", "failed", "capped"):
                    agg[k] += c.get(k) or 0

    # Agreement over every item the judges labelled, whatever its origin: they could not tell them apart.
    labelled = [f for f in all_rows if f["labelled"]]
    pairs = lambda rows: [(f["auditor"]["label"], f["skeptic"]["label"]) for f in rows]
    both_fp = [f for f in labelled if f["auditor"]["label"] == f["skeptic"]["label"] == "false_positive"]
    causes_seen = sorted({f["auditor"]["cause"] for f in both_fp} | {f["skeptic"]["cause"] for f in both_fp})
    agreement = {
        "all": cohen_kappa(pairs(labelled), LABELS),
        "dev": cohen_kappa(pairs([f for f in labelled if f["split"] == "dev"]), LABELS),
        "test": cohen_kappa(pairs([f for f in labelled if f["split"] == "test"]), LABELS),
        "judged": cohen_kappa(pairs([f for f in labelled if f["group"] == "judged"]), LABELS),
        "experimental": cohen_kappa(pairs([f for f in labelled if f["group"] == "experimental"]), LABELS),
        "probe": cohen_kappa(pairs([f for f in labelled if f["group"] == "probe"]), LABELS),
        "byCriterion": {c: cohen_kappa(pairs([f for f in labelled if f["group"] == "judged" and f["criterion"] == c]), LABELS) for c in CRITERIA},
        "confusion": {f"{a}|{s}": n for (a, s), n in sorted(Counter(pairs(labelled)).items())},
        "causeOnAgreedFalsePositives": cohen_kappa([(f["auditor"]["cause"], f["skeptic"]["cause"]) for f in both_fp], causes_seen),
        "disagreements": [{"slug": f["slug"], "split": f["split"], "key": f["key"], "criterion": f["criterion"], "group": f["group"],
                           "subject": f.get("subject") or f.get("evidence"), "auditor": f["auditor"]["label"], "skeptic": f["skeptic"]["label"]}
                          for f in labelled if not f["agreed"]],
    }
    causes = {split: {g: dict(Counter(f["finalCause"] for f in in_split(findings, split) if f["group"] == g and f["final"] == "false_positive"))
                      for g in ("judged", "experimental", "probe")} for split in SPLITS}

    # The fourth study, same rubric, method and model (`6e0947a`, on other pages).
    s4 = read_json(os.path.join(STUDY, "round-4-2026-10-24", "data", "summary.json"))
    comparison = {
        "study4": {s: {k: s4["precision"][s][k] for k in ("judgedDefault", "judgedAll", "experimentalAll", "probesAll", "everythingDefault", "everythingAll")}
                   for s in SPLITS},
        "study4Agreement": {k: s4["agreement"].get(k) for k in ("all", "dev", "test", "judged", "experimental", "probe")},
    }

    seconds = [e["secondsTotal"] for e in pages if e.get("judged")]
    judge_seconds = [e["judged"]["seconds"] for e in pages if e.get("judged") and e["judged"]["seconds"] is not None]
    collect_seconds = [e["collect"]["seconds"] for e in pages if e["collect"]["seconds"] is not None and e.get("judged")]

    def median(xs):
        xs = sorted(xs)
        if not xs:
            return None
        m = len(xs) // 2
        return xs[m] if len(xs) % 2 else (xs[m - 1] + xs[m]) / 2

    summary = {
        "pagesJudged": sum(1 for e in pages if e.get("judged")),
        "pagesBySplit": {s: sum(1 for e in pages if e.get("judged") and e["split"] == s) for s in ("dev", "test")},
        "findingsLabelled": len(findings),
        "findingsByGroup": dict(Counter(f["group"] for f in findings)),
        "precision": precision,
        "confidenceMix": confidence_mix,
        "sensitivity": sensitivity,
        "flagRate": dict(flag),
        "agreement": agreement,
        "falsePositiveCauses": causes,
        "time": {"medianTotal": median(seconds), "minTotal": min(seconds) if seconds else None, "maxTotal": max(seconds) if seconds else None,
                 "medianJudged": median(judge_seconds), "medianCollect": median(collect_seconds)},
        "comparison": comparison,
        "suggestions": {s: dict(sum((Counter(e["judged"]["suggestions"]) for e in pages if e.get("judged") and (s == "all" or e["split"] == s)), Counter()))
                        for s in SPLITS},
        "missingLabels": missing,
    }

    out_rows = []
    for f in all_rows:
        out_rows.append({k: f.get(k) for k in ("slug", "split", "run", "packet", "key", "fingerprint", "criterion", "level", "source", "ruleId", "kind", "group",
                                                "experimental", "shown", "confidence", "ref", "subject", "message", "evidence", "patch", "html",
                                                "auditor", "skeptic", "agreed", "final", "finalCause", "origin", "confirmation", "suggestionEvidence",
                                                "claim", "sampleReason", "cut090")})
    write_json(os.path.join(HERE, "data", "findings.json"), out_rows)
    write_json(os.path.join(HERE, "data", "pages.json"), pages)
    write_json(os.path.join(HERE, "data", "summary.json"), summary)

    def show(title, rows):
        print(f"\n{title}")
        for r in rows:
            p = "  -  " if r["precision"] is None else f"{r['precision']:.2f}"
            ci = "" if r["wilson95"] is None else f"({r['wilson95'][0]:.2f}-{r['wilson95'][1]:.2f})"
            print(f"  {r['key'][:52]:52} n={r['findings']:>3} TP={r['truePositive']:>3} FP={r['falsePositive']:>3} unc={r['uncertain']:>3}  {p} {ci}  pages={r['pages']}")

    sys.stdout.reconfigure(encoding="utf-8")
    print("pages judged:", summary["pagesJudged"], summary["pagesBySplit"], "findings labelled:", len(findings), summary["findingsByGroup"])
    for split in SPLITS:
        for key in ("judgedDefault", "judgedAll", "experimentalAll", "probesAll"):
            show(f"{split} {key}", precision[split][key])
        print(f"  everything default: {precision[split]['everythingDefault']}")
        print(f"  everything all: {precision[split]['everythingAll']}")
    print("\nagreement:", json.dumps({k: v for k, v in agreement.items() if k not in ("disagreements", "byCriterion")}))
    print("by criterion:", json.dumps(agreement["byCriterion"]))
    print("sensitivity:", json.dumps(sensitivity, indent=1))
    print("time:", summary["time"])


if __name__ == "__main__":
    main()
