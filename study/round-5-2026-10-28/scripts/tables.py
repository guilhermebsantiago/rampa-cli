"""Print the Markdown tables of docs/studies/real-pages-2026-10-round5.md from data/summary.json and data/pages.json.
The fourth study's tables.py, with the fourth study as the comparison.
Run: python -I study/round-5-2026-10-28/scripts/tables.py"""

import json
import os
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NAMES = {"1.1.1": "1.1.1 Non-text Content", "1.3.5": "1.3.5 Identify Input Purpose", "2.4.2": "2.4.2 Page Titled",
         "2.4.4": "2.4.4 Link Purpose (In Context)", "2.4.6": "2.4.6 Headings and Labels", "3.1.1": "3.1.1 Language of Page",
         "3.1.2": "3.1.2 Language of Parts", "3.3.2": "3.3.2 Labels or Instructions", "all": "**All**"}


def cell(r):
    if r is None or r["findings"] == 0:
        return "–"
    p = "–" if r["precision"] is None else f"{r['precision']:.2f}"
    ci = "" if r["wilson95"] is None else f" ({r['wilson95'][0]:.2f}–{r['wilson95'][1]:.2f})"
    return f"{r['truePositive']} / {r['falsePositive']} / {r['uncertain']}: **{p}**{ci}"


def by_key(rows):
    return {r["key"]: r for r in rows}


def main():
    s = json.load(open(os.path.join(HERE, "data", "summary.json"), encoding="utf-8"))
    pages = json.load(open(os.path.join(HERE, "data", "pages.json"), encoding="utf-8"))
    sys.stdout.reconfigure(encoding="utf-8")
    P = s["precision"]

    print("### Judged criteria, by split and threshold (TP / FP / uncertain: precision, 95% Wilson)\n")
    print("| Criterion | Dev, default | Dev, all findings | Test, default | Test, all findings |")
    print("| --- | --- | --- | --- | --- |")
    keys = [k for k in list(NAMES) if any(k in by_key(P[sp][t]) for sp in ("dev", "test") for t in ("judgedDefault", "judgedAll"))]
    for k in keys:
        row = [cell(by_key(P[sp][t]).get(k)) for sp in ("dev", "test") for t in ("judgedDefault", "judgedAll")]
        print(f"| {NAMES[k]} | " + " | ".join(row) + " |")

    print("\n### Both splits together\n")
    print("| Criterion | Default threshold | All findings |")
    print("| --- | --- | --- |")
    for k in keys:
        print(f"| {NAMES[k]} | {cell(by_key(P['all']['judgedDefault']).get(k))} | {cell(by_key(P['all']['judgedAll']).get(k))} |")

    for group, title in (("experimentalAll", "Experimental rules and judgments (all below the threshold)"), ("probesAll", "Probes (all below the threshold)")):
        print(f"\n### {title}\n")
        print("| Check | Dev | Test | Both |")
        print("| --- | --- | --- | --- |")
        allkeys = [r["key"] for r in P["all"][group]]
        for k in allkeys:
            print(f"| {k if k != 'all' else '**All**'} | {cell(by_key(P['dev'][group]).get(k))} | {cell(by_key(P['test'][group]).get(k))} | {cell(by_key(P['all'][group]).get(k))} |")

    print("\n### Pages\n")
    print("| Split | Page | Category | Lang | Type | Collect s | Judge s | Model calls | Judged, default | Judged, all | Experimental | Engine (axe) |")
    print("| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |")
    for e in sorted(pages, key=lambda e: (e["split"], e["region"], e["category"])):
        j = e.get("judged") or {}
        print(f"| {e['split']} | {e['url']} | {e['category']} | {e['language']} | {e['pageType']} | {e['collect']['seconds']} | {j.get('seconds')} | {j.get('modelCalls')} | {j.get('judgedFindingsDefault')} | {j.get('judgedFindingsAll')} | {j.get('experimentalFindings')} | {j.get('engineFindings')} |")

    print("\n### Flag rate\n")
    print("| Split | Criterion | Candidates | Judged | Reported failing | Share |")
    print("| --- | --- | ---: | ---: | ---: | ---: |")
    for k, v in sorted(s["flagRate"].items()):
        split, crit = k.split(" ")
        if split == "all" or not v["judged"]:
            continue
        print(f"| {split} | {crit} | {v['candidates']} | {v['judged']} | {v['failed']} | {100 * v['failed'] / v['judged']:.1f}% |")

    print("\n### Agreement\n")
    a = s["agreement"]
    for k in ("all", "dev", "test", "judged", "experimental", "probe"):
        if a.get(k):
            print(f"| {k} | {a[k]['n']} | {a[k]['observedAgreement']:.2f} | {a[k]['kappa']} |")
    print("by criterion:", {k: (v or {}).get("kappa") for k, v in a["byCriterion"].items()})
    print("cause kappa:", a["causeOnAgreedFalsePositives"])
    print("confusion:", a["confusion"])
    print("\ncauses:", json.dumps(s["falsePositiveCauses"]))
    print("time:", s["time"])
    print("sensitivity:", json.dumps(s["sensitivity"], indent=1))

    C = s["comparison"]
    print("\n### Against the fourth study, judged criteria (TP / FP / uncertain: precision, 95% Wilson)\n")
    print("| Run | Dev, default | Dev, all findings | Test, default | Test, all findings |")
    print("| --- | --- | --- | --- | --- |")
    for title, src in (("Fourth study (`6e0947a`)", C["study4"]), ("This study (`b759128`)", P)):
        row = [cell(by_key(src[sp][t]).get("all")) for sp in ("dev", "test") for t in ("judgedDefault", "judgedAll")]
        print(f"| {title} | " + " | ".join(row) + " |")
    for sp in ("dev", "test", "all"):
        print(f"\n#### {sp}, by criterion at the default threshold: the fourth study, then this study\n")
        print("| Criterion | Fourth | Now |")
        print("| --- | --- | --- |")
        for k in NAMES:
            if k == "all":
                continue
            row = [cell(by_key(src[sp]["judgedDefault"]).get(k)) for src in (C["study4"], P)]
            if any(r != "–" for r in row):
                print(f"| {NAMES[k]} | " + " | ".join(row) + " |")
    print("\n#### Experimental rules and judgments: the fourth study, then this study (both halves)\n")
    print("| Check | Fourth | Now |")
    print("| --- | --- | --- |")
    keys = []
    for src in (C["study4"], P):
        for r in src["all"]["experimentalAll"]:
            if r["key"] not in keys:
                keys.append(r["key"])
    keys = [k for k in keys if k != "all"] + ["all"]
    for k in keys:
        row = [cell(by_key(src["all"]["experimentalAll"]).get(k)) for src in (C["study4"], P)]
        print(f"| {k if k != 'all' else '**All**'} | " + " | ".join(row) + " |")
    print("\nfourth study's agreement:", json.dumps(C["study4Agreement"]))


if __name__ == "__main__":
    main()
