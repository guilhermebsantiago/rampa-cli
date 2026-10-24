"""Comparisons with the third study that the pre-registration did not name, written after the test numbers were known.

They are exploratory: none of them changes the pre-registered reading of the primary measure (extras.py). They ask
how much of the primary comparison is the split, since this study's code saw neither half: the dev half is as fresh
to `6e0947a` as the test half, and the one page per study with 50 2.4.4 false positives (www.ufpe.br on the third
study's test half, www.toolstation.com on this study's dev half) fell on opposite halves.

- both halves pooled, this study against the third study, Newcombe's method 10;
- the dev halves, the same;
- both halves pooled without each study's page with the most default-threshold findings;
- a page-level bootstrap of each difference (10,000 resamples of each study's pages with replacement, within each
  half for the per-half rows, random.Random(20261024)), since findings cluster on pages.

Reads data/findings.json and study/round-3-2026-10-23/data/findings.json; writes data/exploratory.json.
Run after analyze.py: python -I study/round-4-2026-10-24/scripts/exploratory.py
"""

import json
import os
import random
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from extras import newcombe, wilson  # noqa: E402

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STUDY = os.path.dirname(HERE)
SEED = 20261024


def read_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def per_page(rows, keep):
    """{slug: [tp, decided, split]} over the default-threshold judged findings of the main run."""
    pages = defaultdict(lambda: [0, 0, None])
    for r in rows:
        if not keep(r) or r["group"] != "judged" or not r["shown"]:
            continue
        p = pages[r["slug"]]
        p[2] = r["split"]
        if r["final"] == "true_positive":
            p[0] += 1
            p[1] += 1
        elif r["final"] == "false_positive":
            p[1] += 1
    return dict(pages)


def total(pages, slugs):
    tp = sum(pages[s][0] for s in slugs if s in pages)
    n = sum(pages[s][1] for s in slugs if s in pages)
    return tp, n


def summary(tp, n):
    w = wilson(tp, n)
    return {"tp": tp, "decided": n, "precision": round(tp / n, 3), "wilson95": [round(w[0], 3), round(w[1], 3)]}


def bootstrap(rng, slugs4, pages4, slugs3, pages3):
    diffs = []
    for _ in range(10000):
        a = [rng.choice(slugs4) for _ in slugs4]
        b = [rng.choice(slugs3) for _ in slugs3]
        t4, n4 = sum(pages4.get(s, [0, 0])[0] for s in a), sum(pages4.get(s, [0, 0])[1] for s in a)
        t3, n3 = sum(pages3.get(s, [0, 0])[0] for s in b), sum(pages3.get(s, [0, 0])[1] for s in b)
        if n4 and n3:
            diffs.append(t4 / n4 - t3 / n3)
    diffs.sort()
    return {"ci95": [round(diffs[int(0.025 * len(diffs))], 3), round(diffs[min(len(diffs) - 1, int(0.975 * len(diffs)))], 3)], "resamples": len(diffs)}


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    rows4 = [r for r in read_json(os.path.join(HERE, "data", "findings.json")) if r.get("auditor")]
    rows3 = read_json(os.path.join(STUDY, "round-3-2026-10-23", "data", "findings.json"))
    pages4 = per_page(rows4, lambda r: r["origin"] == "main")
    pages3 = per_page(rows3, lambda r: r["run"] == "default")
    # Every page of each study, also those with no default-threshold finding, since they are resampled too.
    split4 = {p["slug"]: p["split"] for p in read_json(os.path.join(HERE, "data", "pages-input.json"))["pages"]}
    split3 = {p["slug"]: p["split"] for p in read_json(os.path.join(STUDY, "round-3-2026-10-23", "data", "pages-input.json"))["pages"]}
    top4 = max(pages4, key=lambda s: pages4[s][1])
    top3 = max(pages3, key=lambda s: pages3[s][1])
    rng = random.Random(SEED)
    out = {"topPage": {"this": [top4, pages4[top4][:2]], "third": [top3, pages3[top3][:2]]}, "rows": {}}
    sets = (
        ("both halves", lambda s, sp: True),
        ("dev", lambda s, sp: sp == "dev"),
        ("test", lambda s, sp: sp == "test"),
        ("both halves, without each study's top page", lambda s, sp: s not in (top4, top3)),
    )
    for name, keep in sets:
        s4 = [s for s, sp in split4.items() if keep(s, sp)]
        s3 = [s for s, sp in split3.items() if keep(s, sp)]
        t4, n4 = total(pages4, s4)
        t3, n3 = total(pages3, s3)
        d = newcombe(t4, n4, t3, n3)
        out["rows"][name] = {"this": summary(t4, n4), "third": summary(t3, n3), "newcombe": d,
                             "pageBootstrap": bootstrap(rng, s4, pages4, s3, pages3), "pages": [len(s4), len(s3)]}
    with open(os.path.join(HERE, "data", "exploratory.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"top pages: this study {top4} {pages4[top4][:2]}, third study {top3} {pages3[top3][:2]}\n")
    print("| Set | This study | Third study | Difference (Newcombe) | Difference (page bootstrap) |")
    print("| --- | --- | --- | --- | --- |")
    for name, v in out["rows"].items():
        a, b, d, bs = v["this"], v["third"], v["newcombe"], v["pageBootstrap"]
        print(f"| {name} | {a['tp']} of {a['decided']}: **{a['precision']:.2f}** ({a['wilson95'][0]:.2f}–{a['wilson95'][1]:.2f}) | "
              f"{b['tp']} of {b['decided']}: {b['precision']:.2f} ({b['wilson95'][0]:.2f}–{b['wilson95'][1]:.2f}) | "
              f"{d['difference']:+.2f} ({d['ci95'][0]:+.2f} to {d['ci95'][1]:+.2f}) | {bs['ci95'][0]:+.2f} to {bs['ci95'][1]:+.2f} |")


if __name__ == "__main__":
    main()
