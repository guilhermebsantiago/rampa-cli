"""Print the Markdown tables of docs/studies/real-pages-2026-10-fresh.md from data/summary.json and data/pages.json.
Run: python -I study/fresh-2026-10-11/scripts/tables.py"""

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


if __name__ == "__main__":
    main()
