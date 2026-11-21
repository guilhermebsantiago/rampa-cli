"""Exploratory numbers of the seventh study, NOT pre-registered, asked for after the pre-registered result was computed
(the main session, 2026-11-21): the primary measure without the judged 2.4.4 findings, and 2.4.4's primary findings
counted by claim kind, by cause and by how many pages hold them (counts only; the false positives are not read for
patterns). Reads data/findings.json (written by scripts/analyze.py). Every number is AI-judged, held-out and exploratory.

Run: python -I study/round-7-2026-11-21/scripts/exploratory.py   (writes data/exploratory.json)
"""
import os
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from analyze import bootstrap, per_page, prec, reading  # noqa: E402
from common import HERE, pages, read_json, write_json  # noqa: E402


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    rows = read_json(os.path.join(HERE, "data", "findings.json"))
    test_pages = sorted(p["slug"] for p in pages() if p["split"] == "test")
    primary = [r for r in rows if r["split"] == "test" and r.get("origin") == "main" and r["kind"] == "judgment" and r["shown"]]
    without = [r for r in primary if r["criterion"] != "2.4.4"]
    p = prec(without)
    link = [r for r in primary if r["criterion"] == "2.4.4"]
    out = {
        "about": "Exploratory, not pre-registered; AI-judged; held-out pages. The pre-registered result is in data/summary.json.",
        "primaryWithout244": {**p, "pageBootstrap": bootstrap(per_page(without, test_pages)), "readingByTheArticleRule": reading(p)},
        "judged244": {
            "all": prec(link),
            "byClaim": {k: prec([r for r in link if (r.get("claim") or "none") == k]) for k in sorted({r.get("claim") or "none" for r in link})},
            "falsePositiveCauses": dict(Counter(r.get("finalCause") for r in link if r["final"] == "false_positive")),
            "pagesWithAFalsePositive": len({r["slug"] for r in link if r["final"] == "false_positive"}),
            "largestPageFalsePositives": max(Counter(r["slug"] for r in link if r["final"] == "false_positive").values(), default=0),
        },
    }
    write_json(os.path.join(HERE, "data", "exploratory.json"), out)
    w = out["primaryWithout244"]
    print(f"without judged 2.4.4 (exploratory): {w['tp']} TP / {w['fp']} FP / {w['uncertain']} unc, precision {w['precision']} "
          f"Wilson {w['wilson95']} bootstrap {(w['pageBootstrap'] or {}).get('ci95')}")
    j = out["judged244"]
    print("2.4.4 by claim:", {k: (v["tp"], v["fp"], v["uncertain"]) for k, v in j["byClaim"].items()},
          "FP causes:", j["falsePositiveCauses"], "pages with an FP:", j["pagesWithAFalsePositive"], "largest page:", j["largestPageFalsePositives"])


if __name__ == "__main__":
    main()
