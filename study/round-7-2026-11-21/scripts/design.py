"""Write data/pages-input.json, the seventh study's 60 pages with their block, stratum and T4 subset.

The sixth study's split.py, without a split: every page is test (pre-registration, section 2). The generator
random.Random(20261121) is the one scripts/deal.py used: its first draw (six home-heavy strata of the 12, sorted) is
drawn again here and checked against scripts/candidates.tsv, and the next draws pick the T4 subset, one page per
stratum, strata in sorted order, each a choice() among the stratum's five pages sorted by slot. Slug: the page's folder
(block and host); recording: what rampa check --save names the page's files.

Run from the repository root: python -I study/round-7-2026-11-21/scripts/design.py
"""
import json
import os
import random
import re
import sys
from urllib.parse import urlsplit

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(HERE, "scripts"))
from deal import SEED, heavy_strata  # noqa: E402


def slug_of(url):
    """The name rampa check --save gives the page's recording (src/surfaces/targets.ts, recordingName)."""
    name = re.sub(r"^[a-z]+://", "", url, flags=re.I)
    name = re.sub(r"\.(html?|xml|png|json)$", "", name, flags=re.I)
    name = re.sub(r"[^a-z0-9]+", "-", name, flags=re.I).strip("-").lower()
    return name or "page"


def short(block, url):
    """A page folder's name: the block and the host, without www, short enough for Windows paths."""
    host = re.sub(r"^www\.", "", urlsplit(url).hostname.lower())
    return f"b{block}-" + re.sub(r"[^a-z0-9]+", "-", host).strip("-")[:36]


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    rows = []
    for line in open(os.path.join(HERE, "scripts", "pages.tsv"), encoding="utf-8"):
        if not line.strip() or line.startswith("#"):
            continue
        slot, region, country, category, page_type, language, url, selection = line.rstrip("\n").split("\t")
        block = int(slot.split("-", 1)[0][1:])
        stratum = slot.split("-", 1)[1].rsplit("-", 1)[0]
        rows.append({"slot": slot, "block": block, "stratum": stratum, "region": region, "country": country, "category": category,
                     "pageType": page_type, "language": language, "url": url, "slug": short(block, url), "recording": slug_of(url),
                     "split": "test", "selection": selection})
    assert len(rows) == 60, len(rows)
    assert len({r["slug"] for r in rows}) == 60 and len({r["recording"] for r in rows}) == 60
    hosts = [re.sub(r"^www\.", "", urlsplit(r["url"]).hostname) for r in rows]
    assert len(set(hosts)) == 60
    strata = sorted({r["stratum"] for r in rows})
    assert len(strata) == 12 and all(sum(r["stratum"] == s for r in rows) == 5 for s in strata)
    for b in range(1, 6):
        mine = [r for r in rows if r["block"] == b]
        assert len(mine) == 12 and sum(r["slot"].endswith("-h") for r in mine) == 6, b
    rng = random.Random(SEED)
    heavy = heavy_strata(rng, strata)
    header = open(os.path.join(HERE, "scripts", "candidates.tsv"), encoding="utf-8").read()
    assert ", ".join(heavy) in header, "the six home-heavy strata differ from scripts/candidates.tsv"
    subset = {}
    for s in strata:
        pool = sorted((r for r in rows if r["stratum"] == s), key=lambda r: r["slot"])
        subset[s] = rng.choice(pool)["slot"]
    for r in rows:
        r["t4Subset"] = r["slot"] in subset.values()
    rows.sort(key=lambda r: (r["block"], r["slot"]))
    out = {
        "note": ("Pages of the seventh real-page study, all test: chosen on 2026-11-21 before any Rampa run from the sixth "
                 "study's pool leftovers (scripts/candidates.tsv, scripts/selection.tsv); no registrable domain of "
                 "data/excluded-domains.json. The test pages are reported once; their false positives are counted, not described."),
        "commit": "385fe13 (fix/round-6: rampa-cli 0.1.2 plus the sixth study's seven precision fixes; --version prints 0.1.2)",
        "seed": SEED,
        "method": ("Python random.Random(seed): first, sample() of 6 of the 12 strata (sorted) as home-heavy (scripts/deal.py, "
                   "drawn again here); then, for each stratum in sorted order, one choice() among its five pages sorted by slot, "
                   "for the T4 subset."),
        "homeHeavy": heavy,
        "t4Subset": subset,
        "pages": rows,
    }
    with open(os.path.join(HERE, "data", "pages-input.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
        f.write("\n")
    for r in rows:
        print(f"b{r['block']} {r['region']:4} {r['category']:11} {r['pageType']:8} {'T4' if r['t4Subset'] else '  '} {r['slug']}")


if __name__ == "__main__":
    main()
