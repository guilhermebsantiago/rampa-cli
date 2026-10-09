"""Rebuild the final labels of the real-page study and compute its numbers.

Inputs (paths relative to the study folder):
  scripts/pages-input.json        page list, split and run outcome of each page
  pages/<slug>/report.json        Rampa reports (kept out of git); when absent,
                                  the finding fields are read back from data/findings.json
  labels/<slug>.auditor.json      labels of the auditor judge
  labels/<slug>.skeptic.json      labels of the skeptic judge

Outputs:
  data/pages.json      one row per page: split, run status, judged and flagged counts
  data/findings.json   one row per judgment finding with both labels and the final one
  data/summary.json    precision per split and criterion with 95% Wilson intervals,
                       Cohen's kappa between the judges, cause counts

Final label: the label both judges gave, otherwise "uncertain".
Precision: TP / (TP + FP); uncertain findings are excluded and reported.

Run: python -I study/scripts/analyze.py
"""

import json
import math
import os
import sys
from collections import Counter, defaultdict

STUDY = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LABELS = ("true_positive", "false_positive", "uncertain")
Z = 1.959963984540054


def read_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")


def judgments(path):
    data = read_json(path)
    rows = data if isinstance(data, list) else data["judgments"]
    return {row["fingerprint"]: row for row in rows}


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
    return {
        "n": n,
        "observedAgreement": round(observed, 3),
        "expectedAgreement": round(expected, 3),
        "kappa": None if kappa is None else round(kappa, 3),
    }


def precision_row(counts):
    tp, fp, unc = counts["true_positive"], counts["false_positive"], counts["uncertain"]
    n = tp + fp
    return {
        "truePositive": tp,
        "falsePositive": fp,
        "uncertain": unc,
        "decided": n,
        "precision": None if n == 0 else round(tp / n, 3),
        "wilson95": wilson(tp, n),
    }


def load_findings(meta):
    """Finding fields from the reports, or from the previous findings.json."""
    previous = {}
    old = os.path.join(STUDY, "data", "findings.json")
    if os.path.exists(old):
        for row in read_json(old):
            previous[(row["slug"], row["fingerprint"])] = row
    old_pages = os.path.join(STUDY, "data", "pages.json")
    previous_pages = {p["slug"]: p for p in read_json(old_pages)} if os.path.exists(old_pages) else {}
    out, criteria_stats, missing = {}, {}, []
    for page in meta["pages"]:
        slug = page["slug"]
        path = os.path.join(STUDY, "pages", slug, "report.json")
        if os.path.exists(path):
            report = read_json(path)
            criteria_stats[slug] = report.get("criteria", [])
            rows = []
            for f in report["findings"]:
                if f.get("source") != "judgment":
                    continue
                patch = f.get("patch") or {}
                rows.append({
                    "fingerprint": f["fingerprint"],
                    "criterion": f["criterion"],
                    "ref": f.get("ref"),
                    "message": f.get("message"),
                    "evidence": f.get("evidence"),
                    "confidence": f.get("confidence"),
                    "patch": {k: patch.get(k) for k in ("kind", "attribute", "from", "to", "before") if k in patch} or None,
                })
            out[slug] = {"engineFindings": sum(1 for f in report["findings"] if f.get("source") == "engine"),
                         "discarded": len(report.get("discarded", [])),
                         "modelCalls": report.get("usage", {}).get("calls"),
                         "rows": rows}
        elif page["status"] == "ok":
            rows = [{k: v for k, v in r.items() if k not in ("slug", "split", "auditor", "skeptic", "final", "finalCause", "agreed")}
                    for (s, _), r in previous.items() if s == slug]
            before = previous_pages.get(slug)
            if before is None:
                missing.append(slug)
                out[slug] = {"rows": rows}
                continue
            criteria_stats[slug] = [{"criterion": c, **st} for c, st in (before.get("criteria") or {}).items()]
            out[slug] = {"engineFindings": before.get("engineFindings"),
                         "discarded": before.get("discardedByVerification"),
                         "modelCalls": before.get("modelCalls"),
                         "rows": rows}
    if missing:
        print("warning: no report and no previous findings for", ", ".join(missing), file=sys.stderr)
    return out, criteria_stats


def main():
    meta = read_json(os.path.join(STUDY, "scripts", "pages-input.json"))
    found, criteria_stats = load_findings(meta)

    findings, pages = [], []
    for page in meta["pages"]:
        slug = page["slug"]
        entry = found.get(slug)
        rows = entry["rows"] if entry else []
        a_path = os.path.join(STUDY, "labels", f"{slug}.auditor.json")
        s_path = os.path.join(STUDY, "labels", f"{slug}.skeptic.json")
        auditor = judgments(a_path) if os.path.exists(a_path) else {}
        skeptic = judgments(s_path) if os.path.exists(s_path) else {}
        fps = {r["fingerprint"] for r in rows}
        if rows and (set(auditor) != fps or set(skeptic) != fps):
            raise SystemExit(f"labels of {slug} do not cover exactly its judgment findings")
        for r in rows:
            a, s = auditor[r["fingerprint"]], skeptic[r["fingerprint"]]
            agreed = a["label"] == s["label"]
            final = a["label"] if agreed else "uncertain"
            if final == "false_positive":
                cause = a["cause"] if a["cause"] == s["cause"] else "disputed"
            else:
                cause = None
            findings.append({
                "slug": slug,
                "split": page["split"],
                **r,
                "auditor": {"label": a["label"], "cause": a["cause"], "rationale": a["rationale"]},
                "skeptic": {"label": s["label"], "cause": s["cause"], "rationale": s["rationale"]},
                "agreed": agreed,
                "final": final,
                "finalCause": cause,
            })
        stats = {c["criterion"]: {"candidates": c.get("candidates"), "judged": c.get("judged"), "failed": c.get("failed"),
                                  "passed": c.get("passed"), "cannotTell": c.get("cannotTell"), "discarded": c.get("discarded")}
                 for c in criteria_stats.get(slug, [])}
        pages.append({
            **page,
            "judgmentFindings": len(rows),
            "engineFindings": entry.get("engineFindings") if entry else None,
            "discardedByVerification": entry.get("discarded") if entry else None,
            "modelCalls": entry.get("modelCalls") if entry else None,
            "criteria": stats or None,
        })

    # Precision per split and criterion, per split, and overall.
    by = defaultdict(lambda: Counter({k: 0 for k in LABELS}))
    for f in findings:
        by[(f["split"], f["criterion"])][f["final"]] += 1
        by[(f["split"], "all")][f["final"]] += 1
        by[("all", f["criterion"])][f["final"]] += 1
        by[("all", "all")][f["final"]] += 1
    precision = []
    for (split, criterion), counts in sorted(by.items(), key=lambda kv: ({"dev": 0, "test": 1, "all": 2}[kv[0][0]], kv[0][1] == "all", kv[0][1])):
        precision.append({"split": split, "criterion": criterion, **precision_row(counts)})

    # Flag rate: findings over judged candidates, per split and criterion.
    judged = defaultdict(Counter)
    for p in pages:
        for crit, st in (p["criteria"] or {}).items():
            judged[(p["split"], crit)]["judged"] += st["judged"] or 0
            judged[(p["split"], crit)]["failed"] += st["failed"] or 0
            judged[(p["split"], crit)]["discarded"] += st["discarded"] or 0
            judged[(p["split"], crit)]["cannotTell"] += st["cannotTell"] or 0
    flag_rate = [{"split": s, "criterion": c, **dict(v)} for (s, c), v in sorted(judged.items())]

    # Agreement between the judges.
    def kappa_for(rows):
        return cohen_kappa([(f["auditor"]["label"], f["skeptic"]["label"]) for f in rows], LABELS)

    agreement = {
        "all": kappa_for(findings),
        "dev": kappa_for([f for f in findings if f["split"] == "dev"]),
        "test": kappa_for([f for f in findings if f["split"] == "test"]),
        "byCriterion": {c: kappa_for([f for f in findings if f["criterion"] == c])
                        for c in sorted({f["criterion"] for f in findings})},
        "confusion": {f"{a}|{s}": n for (a, s), n in sorted(Counter(
            (f["auditor"]["label"], f["skeptic"]["label"]) for f in findings).items())},
    }
    both_fp = [f for f in findings if f["auditor"]["label"] == f["skeptic"]["label"] == "false_positive"]
    causes_seen = sorted({f["auditor"]["cause"] for f in both_fp} | {f["skeptic"]["cause"] for f in both_fp})
    agreement["causeOnAgreedFalsePositives"] = cohen_kappa(
        [(f["auditor"]["cause"], f["skeptic"]["cause"]) for f in both_fp], causes_seen)

    # Causes of the final false positives.
    causes = defaultdict(Counter)
    for f in findings:
        if f["final"] != "false_positive":
            continue
        causes[(f["split"], f["criterion"])][f["finalCause"]] += 1
        causes[(f["split"], "all")][f["finalCause"]] += 1
    per_judge = {
        judge: dict(Counter(f[judge]["cause"] for f in findings if f[judge]["label"] == "false_positive"))
        for judge in ("auditor", "skeptic")
    }

    summary = {
        "commit": meta["commit"],
        "model": meta["model"],
        "locale": meta["locale"],
        "pages": {
            split: {
                "selected": sum(1 for p in pages if p["split"] == split),
                "completed": sum(1 for p in pages if p["split"] == split and p["status"] == "ok"),
                "timedOut": [p["slug"] for p in pages if p["split"] == split and p["status"] == "timeout"],
                "withJudgmentFindings": sum(1 for p in pages if p["split"] == split and p["judgmentFindings"] > 0),
                "judgmentFindings": sum(p["judgmentFindings"] for p in pages if p["split"] == split),
            }
            for split in ("dev", "test")
        },
        "precision": precision,
        "flagRate": flag_rate,
        "agreement": agreement,
        "falsePositiveCauses": [{"split": s, "criterion": c, **dict(v)} for (s, c), v in sorted(causes.items())],
        "falsePositiveCausesPerJudge": per_judge,
    }

    write_json(os.path.join(STUDY, "data", "pages.json"), pages)
    write_json(os.path.join(STUDY, "data", "findings.json"), findings)
    write_json(os.path.join(STUDY, "data", "summary.json"), summary)

    print(f"{'split':5} {'criterion':9} {'TP':>3} {'FP':>3} {'unc':>3}  precision (95% Wilson)")
    for row in precision:
        p = "  -  " if row["precision"] is None else f"{row['precision']:.2f}"
        ci = "" if row["wilson95"] is None else f"({row['wilson95'][0]:.2f}-{row['wilson95'][1]:.2f})"
        print(f"{row['split']:5} {row['criterion']:9} {row['truePositive']:>3} {row['falsePositive']:>3} {row['uncertain']:>3}  {p} {ci}")
    print("kappa", json.dumps({k: agreement[k] for k in ("all", "dev", "test", "causeOnAgreedFalsePositives")}))
    print("confusion", agreement["confusion"])
    for row in summary["falsePositiveCauses"]:
        print("causes", row)


if __name__ == "__main__":
    main()
