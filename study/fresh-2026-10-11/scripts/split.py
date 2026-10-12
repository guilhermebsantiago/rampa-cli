"""Split the 24 fresh pages into dev and test at random, and draw the 8 pages of the probe run.

The split is stratified: each of the twelve strata (region x category) holds two pages, a home page and an
inner page, and a seeded coin decides which of the two goes to dev. Each half then has one page per
stratum: six Brazilian pages in Portuguese and six international pages in English, one per category.

The probe subset is drawn with the same generator, after the split: two Brazilian and two international
pages from each half.

Writes data/pages-input.json. Run from anywhere: python -I study/fresh-2026-10-11/scripts/split.py
"""

import json
import os
import random

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SEED = 20261011
# Short names for the page folders: Rampa names a recording after the whole address, and the longest ones
# made paths past Windows' 260-character limit inside the study's folders.
SLUGS = {
    "br-gov-h": "ce-gov-br", "br-gov-i": "senado-leg-br-falecomosenado", "br-edu-h": "unicamp-br",
    "br-edu-i": "fuvest-br-vestibular", "br-news-h": "poder360-com-br", "br-news-i": "apublica-org-article",
    "br-shop-h": "chicorei-com", "br-shop-i": "martinsfontes-literatura", "br-health-h": "fiocruz-br",
    "br-health-i": "tuasaude-com-dengue", "br-culture-h": "pinacoteca-org-br", "br-culture-i": "metro-sp-gov-br-fale-conosco",
    "in-gov-h": "ons-gov-uk", "in-gov-i": "usps-com-zip-code-lookup", "in-edu-h": "tcd-ie",
    "in-edu-i": "berkeley-edu-admissions", "in-news-h": "theguardian-com-international", "in-news-i": "propublica-org-article",
    "in-shop-h": "thomann-co-uk", "in-shop-i": "ikea-com-tables-chairs", "in-health-h": "cdc-gov",
    "in-health-i": "medlineplus-gov-diabetes", "in-culture-h": "bl-uk", "in-culture-i": "rijksmuseum-nl-newsletter",
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
        "note": ("Fresh pages of the second real-page study. Selected on 2026-10-11 before any Rampa run; none of the first "
                 "study's 24 pages or their sites, and no site the repository's docs, code or commit messages name. "
                 "Only the dev split may be studied to tune Rampa; the test split is for measurement only."),
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
