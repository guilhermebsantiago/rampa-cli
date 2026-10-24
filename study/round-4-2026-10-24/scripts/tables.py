"""Print the Markdown tables of docs/studies/real-pages-2026-10-round4.md from data/summary.json and data/pages.json.
The second study's tables.py, with a last section: the comparison with the second study.
Run: python -I study/round-4-2026-10-24/scripts/tables.py"""

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
    print("\n### Against the second and third studies, judged criteria (TP / FP / uncertain: precision, 95% Wilson)\n")
    print("| Run | Dev, default | Dev, all findings | Test, default | Test, all findings |")
    print("| --- | --- | --- | --- | --- |")
    runs = (("Second study (`ebd4d07`)", C["study2"]), ("Second study after the 2.4.4/2.4.6 change (`4fd54fc`)", C["study2After"]),
            ("Third study (`d23cfb5`)", C["study3"]), ("This study (`6e0947a`)", P))
    for title, src in runs:
        row = [cell(by_key(src[sp][t]).get("all")) for sp in ("dev", "test") for t in ("judgedDefault", "judgedAll")]
        print(f"| {title} | " + " | ".join(row) + " |")
    for sp in ("dev", "test"):
        print(f"\n#### {sp}, by criterion: the second study after the change, the third study, then this study\n")
        print("| Criterion | Second after, default | Third, default | Now, default | Third, all findings | Now, all findings |")
        print("| --- | --- | --- | --- | --- | --- |")
        for k in NAMES:
            if k == "all":
                continue
            pairs = (("judgedDefault", C["study2After"]), ("judgedDefault", C["study3"]), ("judgedDefault", P), ("judgedAll", C["study3"]), ("judgedAll", P))
            row = [cell(by_key(src[sp][t]).get(k)) for t, src in pairs]
            if any(r != "–" for r in row):
                print(f"| {NAMES[k]} | " + " | ".join(row) + " |")
    for group, title in (("experimentalAll", "Experimental rules and judgments"), ("probesAll", "Probes")):
        print(f"\n#### {title}: the third study, then this study\n")
        print("| Check | Third study, dev | This study, dev | Third study, test | This study, test |")
        print("| --- | --- | --- | --- | --- |")
        keys = []
        for src in (C["study3"], P):
            for sp in ("dev", "test", "all"):
                for r in src[sp][group]:
                    if r["key"] not in keys:
                        keys.append(r["key"])
        keys = [k for k in keys if k != "all"] + ["all"]
        for k in keys:
            row = [cell(by_key(src[sp][group]).get(k)) for sp in ("dev", "test") for src in (C["study3"], P)]
            print(f"| {k if k != 'all' else '**All**'} | " + " | ".join(row) + " |")
    print("\nsecond study's agreement:", json.dumps(C["study2Agreement"]))
    print("third study's agreement:", json.dumps(C["study3Agreement"]))


if __name__ == "__main__":
    main()
