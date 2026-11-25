"""Write data/pages-input.json, the ninth study's 72 pages with their block, stratum, split, T4 subset and audit flag.

The split, the optional T4 subset and the six recall-audit pages were drawn by slot before any candidate loaded
(scripts/deal.py, data/draws.json, random.Random(202611259)); each slot holds exactly one page, so this only carries them
over to the pages, after drawing them again with deal.py's own function and checking that nothing differs. Slug: the
page's folder (block and host); recording: what rampa check --save names the page's files.

Run from the repository root: python -I study/round-9-2026-11-25/scripts/design.py
"""
import json
import os
import re
import sys
from urllib.parse import urlsplit

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(HERE, "scripts"))
from deal import CATEGORIES, SEED, draws  # noqa: E402


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
                     "selection": selection})
    assert len(rows) == 72, len(rows)
    assert len({r["slug"] for r in rows}) == 72 and len({r["recording"] for r in rows}) == 72
    hosts = [re.sub(r"^www\.", "", urlsplit(r["url"]).hostname) for r in rows]
    assert len(set(hosts)) == 72, "a host twice"
    strata = sorted({r["stratum"] for r in rows})
    assert len(strata) == 12 and all(sum(r["stratum"] == s for r in rows) == 6 for s in strata)
    drawn = draws(strata)
    saved = json.load(open(os.path.join(HERE, "data", "draws.json"), encoding="utf-8"))
    for key in ("coins", "split", "t4Subset", "auditSlots"):
        assert drawn[key] == saved[key], f"{key} differs from data/draws.json"
    t4_slots, audit_slots = set(drawn["t4Subset"].values()), set(drawn["auditSlots"].values())
    for r in rows:
        r["split"] = drawn["split"][r["slot"]]
        r["t4Subset"] = r["slot"] in t4_slots
        r["audit"] = r["slot"] in audit_slots
    for b in (1, 2, 3):
        mine = [r for r in rows if r["block"] == b]
        assert len(mine) == 24 and sum(r["split"] == "test" for r in mine) == 12, b
        for s in strata:
            assert sorted(r["split"] for r in mine if r["stratum"] == s) == ["dev", "test"], (b, s)
    assert sum(r["audit"] for r in rows) == 6 and all(r["split"] == "test" for r in rows if r["audit"])
    assert sorted(r["category"] for r in rows if r["audit"]) == sorted(
        {"culture": "culture", "edu": "education", "gov": "government", "health": "health", "news": "news", "shop": "e-commerce"}[c] for c in CATEGORIES)
    rows.sort(key=lambda r: (r["block"], r["slot"]))
    out = {
        "note": ("Pages of the ninth real-page study: chosen on 2026-11-25 before any Rampa run from the ninth study's new pools "
                 "(scripts/candidates.tsv, scripts/selection.tsv); no registrable domain of data/excluded-domains.json. The test half is "
                 "counted only: its findings, labels and judge rationales are never read to change anything; the dev half may be read "
                 "for diagnostics. Nothing in the tool changes either way."),
        "commit": "9e4fc69 (tag v0.1.3, the published rampa-cli 0.1.3; dist/ identical to the npm tarball's, data/build.json)",
        "seed": SEED,
        "method": ("Python random.Random(seed), drawn by slot in scripts/deal.py before any candidate loaded: for block 1, 2 and 3, and "
                   "within a block for each stratum in sorted order, one random(), below 0.5 the home page goes to dev, else the inner "
                   "page; then, for each stratum in sorted order, one choice() among its six slots sorted by name (the optional T4 "
                   "subset); then, for each category in sorted order (culture, edu, gov, health, news, shop), one choice() among its six "
                   "test slots sorted by name (the recall audit)."),
        "coins": drawn["coins"],
        "t4Subset": drawn["t4Subset"],
        "auditSlots": drawn["auditSlots"],
        "pages": rows,
    }
    with open(os.path.join(HERE, "data", "pages-input.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
        f.write("\n")
    for r in rows:
        print(f"b{r['block']} {r['split']:4} {r['region']:4} {r['category']:11} {r['pageType']:8} {'T4' if r['t4Subset'] else '  '} "
              f"{'AUDIT' if r['audit'] else '     '} {r['slug']}")


if __name__ == "__main__":
    main()
