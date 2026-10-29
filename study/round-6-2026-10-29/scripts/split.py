"""Split the 72 pages of the sixth real-page study into dev and test at random, block by block.

The fifth study's split.py (study/round-5-2026-10-28/scripts/split.py), for three blocks of its design. The seed,
20261029, was written down on 2026-10-29 in this file and in scripts/candidates.tsv before any candidate was loaded.

The split is stratified within each block: each of a block's twelve strata (region x category) holds two pages, a home
page and an inner page, and a seeded coin decides which of the two goes to dev. One generator, random.Random(SEED),
draws the coins in a fixed order: block 1, 2, 3, and within a block the strata in sorted order; below 0.5 the home page
goes to dev, else the inner page. Each block's test half then has one page per stratum: six Brazilian pages in
Portuguese and six international pages in English, one per category, and the test half is 36 pages.

After the split, the same generator draws a proposed subset for the five uncached runs (the article's T4 runs on a
subset): one page per stratum, from the six pages of that stratum (three blocks x home and inner), strata in sorted
order. It is a proposal for the person running the study, who may run T4 on all 72 pages instead (see the
pre-registration draft); drawing it changes no other draw.

Writes data/pages-input.json. Run from anywhere: python -I study/round-6-2026-10-29/scripts/split.py
"""

import json
import os
import random
import re

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SEED = 20261029
BLOCKS = (1, 2, 3)


def slug_of(url):
    """The name rampa check --save gives the page's recording (src/surfaces/targets.ts, recordingName)."""
    name = re.sub(r"^[a-z]+://", "", url, flags=re.I)
    name = re.sub(r"\.(html?|xml|png|json)$", "", name, flags=re.I)
    name = re.sub(r"[^a-z0-9]+", "-", name, flags=re.I).strip("-").lower()
    return name or "page"


def short(block, url):
    """A page folder's name: the block and the host, without www, short enough for Windows paths."""
    host = re.sub(r"^www\.", "", re.sub(r"^[a-z]+://", "", url, flags=re.I).split("/")[0].lower())
    return f"b{block}-" + re.sub(r"[^a-z0-9]+", "-", host).strip("-")[:36]


def main():
    rows = []
    with open(os.path.join(HERE, "scripts", "pages.tsv"), encoding="utf-8") as f:
        for line in f:
            if not line.strip() or line.startswith("#"):
                continue
            slot, region, country, category, page_type, language, url, selection = line.rstrip("\n").split("\t")
            block = int(slot.split("-", 1)[0][1:])
            stratum = slot.split("-", 1)[1].rsplit("-", 1)[0]
            rows.append({"slot": slot, "block": block, "stratum": stratum, "region": region, "country": country,
                         "category": category, "pageType": page_type, "language": language, "url": url,
                         "slug": short(block, url), "recording": slug_of(url), "selection": selection})
    assert len(rows) == 72, len(rows)
    assert len({r["slug"] for r in rows}) == 72 and len({r["recording"] for r in rows}) == 72
    for block in BLOCKS:
        assert len([r for r in rows if r["block"] == block]) == 24

    rng = random.Random(SEED)
    strata = sorted({r["stratum"] for r in rows})
    assert len(strata) == 12
    coins = {}
    for block in BLOCKS:
        for stratum in strata:
            key = f"b{block}-{stratum}"
            coins[key] = rng.random()
            home_to_dev = coins[key] < 0.5
            for r in rows:
                if r["block"] == block and r["stratum"] == stratum:
                    r["split"] = "dev" if (r["slot"].endswith("-h") == home_to_dev) else "test"

    # The proposed subset for the five uncached runs: one page per stratum, drawn after the split.
    subset = {}
    for stratum in strata:
        pool = sorted((r for r in rows if r["stratum"] == stratum), key=lambda r: r["slot"])
        subset[stratum] = rng.choice(pool)["slot"]
    for r in rows:
        r["t4Subset"] = r["slot"] in subset.values()
        r["probeRun"] = False

    out = {
        "note": ("Pages of the sixth real-page study, a draft: selected on 2026-10-29 before any Rampa run; no "
                 "registrable domain of the first to fifth studies, the re-measure or the robustness study, and none that "
                 "any file of any branch, tag or remote-tracking ref, any commit message or any line of the history "
                 "names (data/excluded-domains.json). Only the dev split may be read for patterns; the test split is "
                 "reported once and its false positives are counted, not described."),
        "commit": "TO BE FIXED: the frozen code's commit, after the P1 and P2 fixes are merged",
        "seed": SEED,
        "method": ("Python random.Random(seed): for block 1, 2 and 3, and within a block for each stratum in sorted "
                   "order, one random() draw; below 0.5 the home page goes to dev, else the inner page. Then, with the "
                   "same generator, for each stratum in sorted order, one choice() among its six pages (sorted by slot) "
                   "for the proposed T4 subset. No probe subset is drawn. The recording name is what rampa check --save "
                   "names a page's files; slug is the page's folder."),
        "coins": coins,
        "t4Subset": subset,
        "pages": rows,
    }
    path = os.path.join(HERE, "data", "pages-input.json")
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
        f.write("\n")
    for r in sorted(rows, key=lambda r: (r["block"], r["split"], r["region"], r["category"])):
        print(f"b{r['block']} {r['split']:5} {r['region']:4} {r['category']:11} {r['pageType']:8} "
              f"{'T4' if r['t4Subset'] else '  '} {r['url']}")


if __name__ == "__main__":
    main()
