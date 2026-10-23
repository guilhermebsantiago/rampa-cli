"""Split the 24 pages of the third real-page study into dev and test at random, and draw the 8 pages of the probe run.

The second study's split.py (study/fresh-2026-10-11/scripts/split.py), with this study's seed and pages.

The split is stratified: each of the twelve strata (region x category) holds two pages, a home page and an
inner page, and a seeded coin decides which of the two goes to dev. Each half then has one page per
stratum: six Brazilian pages in Portuguese and six international pages in English, one per category.

The probe subset is drawn with the same generator, after the split: two Brazilian and two international
pages from each half.

Writes data/pages-input.json. Run from anywhere: python -I study/round-3-2026-10-23/scripts/split.py
"""

import json
import os
import random

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SEED = 20261023
# Short names for the page folders: Rampa names a recording after the whole address, and the longest ones
# made paths past Windows' 260-character limit inside the study's folders.
SLUGS = {
    "br-gov-h": "mg-gov-br", "br-gov-i": "cnj-ouvidoria", "br-edu-h": "ufpe-br",
    "br-edu-i": "puc-rio-vestibular", "br-news-h": "metropoles-com", "br-news-i": "correio",
    "br-shop-h": "travessa-com-br", "br-shop-i": "kalunga-apresentacao", "br-health-h": "hcor-com-br",
    "br-health-i": "fleury-article", "br-culture-h": "museudoipiranga", "br-culture-i": "itaucultural-contato",
    "in-gov-h": "canada-ca", "in-gov-i": "nps-findapark", "in-edu-h": "ed-ac-uk",
    "in-edu-i": "kcl-undergraduate", "in-news-h": "irishtimes-com", "in-news-i": "pbs-article",
    "in-shop-h": "pimoroni", "in-shop-i": "halfords-motoring", "in-health-h": "clevelandclinic",
    "in-health-i": "cruk-all", "in-culture-h": "vam-ac-uk", "in-culture-i": "tate-contact",
}


def slug_of(url):
    """The name rampa check --save gives the page's recording (src/surfaces/targets.ts, recordingName)."""
    import re
    name = re.sub(r"^[a-z]+://", "", url, flags=re.I)
    name = re.sub(r"\.(html?|xml|png|json)$", "", name, flags=re.I)
    name = re.sub(r"[^a-z0-9]+", "-", name, flags=re.I).strip("-").lower()
    return name or "page"


def main():
    rows = []
    with open(os.path.join(HERE, "scripts", "pages.tsv"), encoding="utf-8") as f:
        for line in f:
            if not line.strip() or line.startswith("#"):
                continue
            slot, region, country, category, page_type, language, url, selection = line.rstrip("\n").split("\t")
            rows.append({"slot": slot, "stratum": slot.rsplit("-", 1)[0], "region": region, "country": country,
                         "category": category, "pageType": page_type, "language": language, "url": url,
                         "slug": SLUGS[slot], "recording": slug_of(url), "selection": selection})
    assert len(rows) == 24 and len({r["slug"] for r in rows}) == 24 and len({r["recording"] for r in rows}) == 24

    rng = random.Random(SEED)
    strata = sorted({r["stratum"] for r in rows})
    coins = {}
    for stratum in strata:
        coins[stratum] = rng.random()
        home_to_dev = coins[stratum] < 0.5
        for r in rows:
            if r["stratum"] == stratum:
                r["split"] = "dev" if (r["slot"].endswith("-h") == home_to_dev) else "test"

    probe = []
    for split in ("dev", "test"):
        for region in ("br", "intl"):
            pool = sorted(r["recording"] for r in rows if r["split"] == split and r["region"] == region)
            probe += rng.sample(pool, 2)
    for r in rows:
        r["probeRun"] = r["recording"] in probe

    out = {
        "note": ("Pages of the third real-page study. Selected on 2026-10-23 before any Rampa run; no registrable domain of "
                 "the first study, its re-measure or the second study, and none that any file or commit message of the "
                 "repository names, on any branch (data/excluded-domains.json). Only the dev split may be read for "
                 "patterns; the test split is reported once and its false positives are counted, not described."),
        "commit": "d23cfb5",
        "seed": SEED,
        "method": ("Python random.Random(seed): for each stratum in sorted order, one random() draw; below 0.5 the home "
                   "page goes to dev, else the inner page. Then, for dev and test and for br and intl in that order, "
                   "random.sample(sorted recording names, 2) picks the probe-run pages. The recording name is what "
                   "rampa check --save names a page's files; slug is the page's folder."),
        "coins": coins,
        "pages": rows,
    }
    path = os.path.join(HERE, "data", "pages-input.json")
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
        f.write("\n")
    for r in sorted(rows, key=lambda r: (r["split"], r["region"], r["category"])):
        print(f"{r['split']:5} {r['region']:4} {r['category']:11} {r['pageType']:8} {'probe' if r['probeRun'] else '     '} {r['url']}")


if __name__ == "__main__":
    main()
