"""Numbers of the held-out re-measure of the real-page study.

Inputs (relative to study/remeasure-2026-10-09):
  pages/<slug>/report.json, run-*.json   reports of the current build on the test pages
  data/matches.json                      new findings matched to the first run's labels (scripts/match.py)
  labels/<slug>.{auditor,skeptic}.json   the two judges' labels of the findings that matched nothing
  data/candidates/<slug>.json            every candidate's fate in the run, replayed offline (scripts/candidates.ts)
  data/rejudge.json                      fresh answers for first-run true positives the run passed (scripts/rejudge.ts)
and from the first run: ../data/findings.json, ../data/pages.json, ../scripts/pages-input.json.

Outputs: data/findings.json (one row per new judgment or rule finding, with its labels),
data/pages.json, data/summary.json. Final label and precision as in the first run: the label both
judges gave, else uncertain; precision TP / (TP + FP) with uncertain left out; 95% Wilson intervals.

Run: python -I study/remeasure-2026-10-09/scripts/analyze.py
"""

import glob
import json
import math
import os
import re
import sys
import unicodedata
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STUDY = os.path.dirname(HERE)
LABELS = ("true_positive", "false_positive", "uncertain")
CRITERIA = ("1.1.1", "1.3.5", "2.4.2", "2.4.4", "2.4.6", "3.1.1", "3.1.2", "3.3.2")
Z = 1.959963984540054


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
            "precision": None if n == 0 else round(tp / n, 3), "wilson95": wilson(tp, n)}


def by_criterion(rows, criteria=None):
    keys = criteria or sorted({r["criterion"] for r in rows})
    out = [{"criterion": c, **precision_row([r for r in rows if r["criterion"] == c])} for c in keys]
    return [r for r in out if r["findings"] > 0] + [{"criterion": "all", **precision_row(rows)}]


def norm(text):
    text = unicodedata.normalize("NFC", text or "")
    return re.sub(r"\s+", " ", text).strip().strip("\"'“”").lower()


def same_text(new, old):
    a, b = norm(new), norm(old)
    if not a or not b:
        return False
    if "�" not in a and "�" not in b:
        return a == b
    for x, y in ((a, b), (b, a)):
        pattern = "".join("." if ch == "�" else re.escape(ch) for ch in y)
        if re.fullmatch(pattern, x, flags=re.S):
            return True
    return False


def final_of(a, s):
    agreed = a["label"] == s["label"]
    final = a["label"] if agreed else "uncertain"
    cause = (a["cause"] if a["cause"] == s["cause"] else "disputed") if final == "false_positive" else None
    return agreed, final, cause


def fate_reason(entry):
    """Why a candidate the first run reported is not reported now, from its replayed fate."""
    if entry is None:
        return "not a candidate"
    status = entry["status"]
    if status == "capped":
        return "cap"
    if status in ("offline-miss", "not-judged"):
        return "time limit"
    if status == "passed":
        return "decided without a model" if entry.get("decided") else "model passed it"
    if status == "cannot_tell":
        return "model could not tell"
    if status == "discarded":
        return f"verification: {entry.get('verification')}"
    if status == "failed":
        return "model failed it (reported)"
    return status


def main():
    meta = read_json(os.path.join(STUDY, "scripts", "pages-input.json"))
    old_all = [o for o in read_json(os.path.join(STUDY, "data", "findings.json")) if o["split"] == "test"]
    old_pages = {p["slug"]: p for p in read_json(os.path.join(STUDY, "data", "pages.json"))}
    matches = {p["slug"]: p for p in read_json(os.path.join(HERE, "data", "matches.json"))["pages"]}
    rejudge_path = os.path.join(HERE, "data", "rejudge.json")
    rejudge = read_json(rejudge_path) if os.path.exists(rejudge_path) else []

    findings, pages, missing_labels = [], [], []
    fates = []
    for page_meta in meta["pages"]:
        if page_meta["split"] != "test":
            continue
        slug = page_meta["slug"]
        m = matches.get(slug, {"report": False})
        runs = sorted(glob.glob(os.path.join(HERE, "pages", slug, "run-*.json")))
        run = [read_json(r) for r in runs]
        old = [o for o in old_all if o["slug"] == slug]
        before_status = page_meta["status"]
        if not m.get("report"):
            pages.append({"slug": slug, "url": page_meta["url"], "language": page_meta["language"], "category": page_meta["category"],
                          "pageType": page_meta["pageType"], "before": {"status": before_status, "findings": len(old)},
                          "after": {"status": "no report", "runs": run}})
            continue
        report = read_json(os.path.join(HERE, "pages", slug, "report.json"))
        a_path = os.path.join(HERE, "labels", f"{slug}.auditor.json")
        s_path = os.path.join(HERE, "labels", f"{slug}.skeptic.json")
        auditor = {j["fingerprint"]: j for j in read_json(a_path)["judgments"]} if os.path.exists(a_path) else {}
        skeptic = {j["fingerprint"]: j for j in read_json(s_path)["judgments"]} if os.path.exists(s_path) else {}
        for f in m["findings"]:
            row = {"slug": slug, **{k: v for k, v in f.items() if k != "match"}}
            if f.get("match"):
                mm = f["match"]
                row.update({"labelledBy": f"first run ({mm['by']} match)", "matchedFingerprint": mm["fingerprint"],
                            "auditor": {"label": mm["auditor"]}, "skeptic": {"label": mm["skeptic"]},
                            "final": mm["final"], "finalCause": mm["finalCause"],
                            "claimChanged": norm(mm["oldMessage"]) != norm(f["message"]) and not same_text(f["message"], mm["oldMessage"])})
            else:
                a, s = auditor.get(f["key"]), skeptic.get(f["key"])
                if a is None or s is None:
                    missing_labels.append(f"{slug}:{f['key']}")
                    row.update({"labelledBy": "missing", "final": "uncertain", "finalCause": None})
                else:
                    agreed, final, cause = final_of(a, s)
                    row.update({"labelledBy": "re-measure judges",
                                "auditor": {"label": a["label"], "cause": a["cause"], "rationale": a["rationale"]},
                                "skeptic": {"label": s["label"], "cause": s["cause"], "rationale": s["rationale"]},
                                "agreed": agreed, "final": final, "finalCause": cause})
            findings.append(row)

        # The fate of each first-run finding in this run.
        cand_path = os.path.join(HERE, "data", "candidates", f"{slug}.json")
        cands = read_json(cand_path) if os.path.exists(cand_path) else []
        old_code_path = os.path.join(HERE, "data", "old-code", f"{slug}.json")
        old_code = {r["fingerprint"]: r for r in read_json(old_code_path)} if os.path.exists(old_code_path) else {}
        matched_new = {f["match"]["fingerprint"]: f for f in m["findings"] if f.get("match")}
        still = {s["fingerprint"]: s for s in m["oldFindingsStillOnPage"]}
        for o in old:
            nf = matched_new.get(o["fingerprint"])
            entry = next((c for c in cands if c["criterion"] == o["criterion"] and c["ref"] == o["ref"]), None)
            if entry is None:
                entry = next((c for c in cands if c["criterion"] == o["criterion"] and c.get("subject") and same_text(c["subject"], o["evidence"])), None)
            if nf is not None and nf["shown"]:
                fate = "reported"
            elif nf is not None:
                fate = "below threshold"
            else:
                fate = "not reported"
            reason = None
            if fate == "below threshold":
                reason = "rule finding only" if nf["source"] == "rule" else f"confidence {nf['confidence']}"
            elif fate == "not reported":
                reason = fate_reason(entry)
                if reason == "not a candidate" and not still.get(o["fingerprint"], {}).get("refFound"):
                    reason = "element not found on the page"
            rj = [r for r in rejudge if r.get("slug") == slug and r["criterion"] == o["criterion"] and r["ref"] == (entry or {}).get("ref", o["ref"])]
            current_ref = (entry or {}).get("ref") or (o["ref"] if still.get(o["fingerprint"], {}).get("refFound") else None)
            fates.append({"slug": slug, "fingerprint": o["fingerprint"], "criterion": o["criterion"], "ref": o["ref"], "currentRef": current_ref, "evidence": o["evidence"],
                          "message": o["message"], "final": o["final"], "fate": fate, "reason": reason,
                          "matchedBy": (nf or {}).get("match", {}).get("by"), "newKind": (nf or {}).get("kind"),
                          "newMessage": (nf or {}).get("message"), "candidate": entry and {k: entry.get(k) for k in ("status", "decided", "verdict", "verification", "capped", "genericFirst")},
                          "modelAnswer": entry and entry.get("output"),
                          "rejudge": [{"samples": [{k: s.get(k) for k in ("verdict", "kept", "reason", "error")} for s in r.get("samples", [])]} for r in rj] or None,
                          # The first run's code on today's snapshot: does it still fail the element?
                          "oldCodeToday": (lambda r: None if r is None else ("not a candidate" if not r.get("candidate") else r.get("status")))(old_code.get(o["fingerprint"])),
                          "oldCodeVerification": (old_code.get(o["fingerprint"]) or {}).get("verification")})

        crit = {c["criterion"]: {k: c.get(k) for k in ("candidates", "judged", "failed", "passed", "cannotTell", "discarded", "capped", "timedOut", "decided")}
                for c in report["criteria"]}
        like = [f for f in m["findings"] if f["kind"] == "like"]
        pages.append({
            "slug": slug, "url": page_meta["url"], "language": page_meta["language"], "category": page_meta["category"], "pageType": page_meta["pageType"],
            "title": m.get("title"),
            "before": {"status": before_status, "seconds": page_meta.get("seconds"), "findings": len(old),
                       "modelCalls": old_pages.get(slug, {}).get("modelCalls"), "criteria": old_pages.get(slug, {}).get("criteria")},
            "after": {"status": "ok", "runs": run, "seconds": run[-1]["seconds"] if run else None, "modelCalls": report["usage"]["calls"],
                      "likeShown": sum(1 for f in like if f["shown"]), "likeAll": len(like),
                      "newJudgment": sum(1 for f in m["findings"] if f["kind"] == "new-judgment"),
                      "newRule": sum(1 for f in m["findings"] if f["kind"] == "new-rule"),
                      "newRuleShown": sum(1 for f in m["findings"] if f["kind"] == "new-rule" and f["shown"]),
                      "engineFindings": sum(1 for f in report["findings"] + report.get("belowThreshold", []) if f["source"] == "engine"),
                      "discarded": len(report.get("discarded", [])), "criteria": crit, "notes": report.get("notes")},
            "firstRunFindingsStillOnPage": {"refFound": sum(1 for s in m["oldFindingsStillOnPage"] if s["refFound"]),
                                            "sameText": sum(1 for s in m["oldFindingsStillOnPage"] if s["sameText"]),
                                            "of": len(m["oldFindingsStillOnPage"])},
        })

    if missing_labels:
        print("warning: no labels yet for", len(missing_labels), "findings:", ", ".join(missing_labels[:10]), file=sys.stderr)

    both = {p["slug"] for p in pages if p["before"]["status"] == "ok" and p["after"]["status"] == "ok"}
    old_both = [o for o in old_all if o["slug"] in both]
    like = [f for f in findings if f["kind"] == "like" and f["slug"] in both]
    like_extra = [f for f in findings if f["kind"] == "like" and f["slug"] not in both]
    shown = [f for f in like if f["shown"]]
    new_checks = [f for f in findings if f["kind"] != "like"]

    def group_key(f):
        if f["kind"] == "new-rule":
            return f.get("ruleId") or "rule"
        return f"judgment {f['criterion']} hidden image" if (f.get("subject") or "").startswith("hidden ") else f"judgment {f['criterion']}"

    groups = defaultdict(list)
    for f in new_checks:
        groups[group_key(f)].append(f)

    relabelled = [f for f in findings if f["labelledBy"] == "re-measure judges"]
    pairs = lambda rows: [(f["auditor"]["label"], f["skeptic"]["label"]) for f in rows]
    both_fp = [f for f in relabelled if f["auditor"]["label"] == f["skeptic"]["label"] == "false_positive"]
    causes_seen = sorted({f["auditor"]["cause"] for f in both_fp} | {f["skeptic"]["cause"] for f in both_fp})

    fate_counts = defaultdict(Counter)
    attribution = defaultdict(Counter)
    for x in fates:
        if x["slug"] in both:
            fate_counts[x["final"]][x["fate"] if x["fate"] != "not reported" else f"not reported: {x['reason']}"] += 1
            if x["fate"] == "not reported":
                # The old code still failing the element on today's page puts the drop on the code changes;
                # the old code no longer failing it puts it on the page or the model.
                who = "code change" if x["oldCodeToday"] == "failed" else "page or model drift" if x["oldCodeToday"] is not None else "no replay"
                attribution[x["final"]][f"{who}: {x['reason']} (old code today: {x['oldCodeToday']})"] += 1

    # Sensitivity: the matched findings whose claim changed, with the labels the judges gave them now.
    sens_labels = {}
    for path in glob.glob(os.path.join(HERE, "labels", "*--claim-changed.auditor.json")):
        slug = os.path.basename(path).split("--claim-changed")[0]
        s_path = path.replace(".auditor.json", ".skeptic.json")
        if not os.path.exists(s_path):
            continue
        a_all = {j["fingerprint"]: j for j in read_json(path)["judgments"]}
        s_all = {j["fingerprint"]: j for j in read_json(s_path)["judgments"]}
        for key, a in a_all.items():
            if key in s_all:
                sens_labels[(slug, key)] = (a, s_all[key])
    sensitivity_rows = []
    for f in like:
        g = dict(f)
        if f.get("claimChanged") and (f["slug"], f["key"]) in sens_labels:
            a, s = sens_labels[(f["slug"], f["key"])]
            _, g["final"], g["finalCause"] = final_of(a, s)
            f["claimChangedRelabel"] = {"auditor": a["label"], "skeptic": s["label"], "final": g["final"],
                                        "auditorRationale": a["rationale"], "skepticRationale": s["rationale"]}
        sensitivity_rows.append(g)

    summary = {
        "pagesInBothRuns": sorted(both),
        "precision": {
            "before": by_criterion(old_both, CRITERIA),
            "afterDefault": by_criterion(shown, CRITERIA),
            "afterAll": by_criterion(like, CRITERIA),
            "afterAllPagesDefault": by_criterion([f for f in like + like_extra if f["shown"]], CRITERIA),
            "afterAllPagesAll": by_criterion(like + like_extra, CRITERIA),
            "afterDefaultClaimChangedRelabelled": by_criterion([f for f in sensitivity_rows if f["shown"]], CRITERIA),
            "afterAllClaimChangedRelabelled": by_criterion(sensitivity_rows, CRITERIA),
        },
        "claimChanged": [{"slug": f["slug"], "key": f["key"], "criterion": f["criterion"], "message": f["message"], "reusedFinal": f["final"],
                          "relabel": f.get("claimChangedRelabel")} for f in like if f.get("claimChanged")],
        "firstRunFindingsAttribution": {k: dict(v) for k, v in attribution.items()},
        "likeForLike": {
            "reusedLabels": sum(1 for f in like if f["labelledBy"].startswith("first run")),
            "reusedByMatch": dict(Counter(f["labelledBy"] for f in like if f["labelledBy"].startswith("first run"))),
            "reusedWithChangedClaim": sum(1 for f in like if f.get("claimChanged")),
            "newlyLabelled": sum(1 for f in like if f["labelledBy"] == "re-measure judges"),
            "newlyLabelledFinal": dict(Counter(f["final"] for f in like if f["labelledBy"] == "re-measure judges")),
        },
        "firstRunFindingsFate": {k: dict(v) for k, v in fate_counts.items()},
        "newChecks": {k: precision_row(v) | {"shown": sum(1 for f in v if f["shown"])} for k, v in sorted(groups.items())},
        "newChecksAll": precision_row(new_checks),
        "agreement": {
            "relabelled": cohen_kappa(pairs(relabelled), LABELS),
            "relabelledLikeForLike": cohen_kappa(pairs([f for f in relabelled if f["kind"] == "like"]), LABELS),
            "relabelledNewChecks": cohen_kappa(pairs([f for f in relabelled if f["kind"] != "like"]), LABELS),
            "confusion": {f"{a}|{s}": n for (a, s), n in sorted(Counter(pairs(relabelled)).items())},
            "causeOnAgreedFalsePositives": cohen_kappa([(f["auditor"]["cause"], f["skeptic"]["cause"]) for f in both_fp], causes_seen),
            "disagreements": [{"slug": f["slug"], "key": f["key"], "criterion": f["criterion"], "kind": f["kind"], "subject": f.get("subject") or f.get("evidence"),
                               "auditor": f["auditor"]["label"], "skeptic": f["skeptic"]["label"]} for f in relabelled if not f["agreed"]],
        },
        "falsePositiveCauses": {
            "likeForLikeNew": dict(Counter(f["finalCause"] for f in relabelled if f["kind"] == "like" and f["final"] == "false_positive")),
            "likeForLikeAllAfter": dict(Counter(f["finalCause"] for f in like if f["final"] == "false_positive")),
            "newChecks": dict(Counter(f["finalCause"] for f in new_checks if f["final"] == "false_positive")),
        },
        "missingLabels": missing_labels,
    }

    write_json(os.path.join(HERE, "data", "findings.json"), findings)
    write_json(os.path.join(HERE, "data", "fates.json"), fates)
    write_json(os.path.join(HERE, "data", "pages.json"), pages)
    write_json(os.path.join(HERE, "data", "summary.json"), summary)

    def show(title, rows):
        print(f"\n{title}")
        for r in rows:
            p = "  -  " if r["precision"] is None else f"{r['precision']:.2f}"
            ci = "" if r["wilson95"] is None else f"({r['wilson95'][0]:.2f}-{r['wilson95'][1]:.2f})"
            print(f"  {r['criterion']:6} n={r['findings']:>3} TP={r['truePositive']:>3} FP={r['falsePositive']:>3} unc={r['uncertain']:>3}  {p} {ci}")

    print("pages in both runs:", len(both))
    for key, rows in summary["precision"].items():
        show(key, rows)
    print("\nlike-for-like:", json.dumps(summary["likeForLike"]))
    print("first-run fates:", json.dumps(summary["firstRunFindingsFate"], indent=1))
    print("first-run drops:", json.dumps(summary["firstRunFindingsAttribution"], indent=1))
    print("claim changed:", json.dumps([{k: c[k] for k in ("slug", "criterion", "reusedFinal")} | {"relabel": (c["relabel"] or {}).get("final")} for c in summary["claimChanged"]]))
    print("new checks:", json.dumps(summary["newChecks"], indent=1))
    print("agreement:", json.dumps({k: v for k, v in summary["agreement"].items() if k != "disagreements"}))


if __name__ == "__main__":
    main()
