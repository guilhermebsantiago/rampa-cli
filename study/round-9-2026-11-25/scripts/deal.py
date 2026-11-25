"""Deal the ninth study's new candidate pools to its 72 slots and draw its split, before the screen.

The ninth study wrote 24 pools (12 strata x home or inner) before anything loaded: scripts/pools.tsv (30 sites each; every
pool kept 24 or more after the exclusions, so no supplementary pool list was written). Two slots whose every candidate
failed the screen got a supplementary list each, written before any of its sites loaded (scripts/pools-2.tsv, "slot<TAB>url"):
its sites are checked like the pools' and appended, in order, to that slot's backups only, so no other slot changes. This takes each pool in its written
order, drops every site whose registrable domain is excluded (data/excluded-domains.json, scripts/exclusions.py), every
site whose registrable domain an earlier site of the pools already holds, and the look-alikes below, and deals the rest
of the pool, in order, to the pool's three slots, one per block, round robin: survivor 1 to block 1, 2 to block 2, 3 to
block 3, 4 to block 1, and so on. A slot's first site is its primary, the next ones its backups b1, b2, ... in order.

Design (pre-registration, section 2), the sixth study's: 72 pages in three blocks of 24; in each block, each of the twelve
strata holds two pages, a home page and an inner page, from two sites; the split is stratified within each block. One
generator, random.Random(202611259) (the date and the round), draws, in this order and before any candidate loads:

1. the split: for block 1, 2, 3, and within a block for each stratum in sorted order, one random(); below 0.5 the
   block's home page of the stratum goes to dev and its inner page to test, else the reverse. Each block's test half
   then has one page per stratum, and the test half is 36 pages;
2. the T4 subset (optional, pre-registration section 5): for each stratum in sorted order, one choice() among its six
   slots sorted by name;
3. the recall-audit slots (pre-registration section 6): for each of the six categories in sorted order (culture, edu,
   gov, health, news, shop: two strata each, Brazil and international), one choice() among the category's six test
   slots sorted by name.

The draws name slots, not sites: each slot gets exactly one page, so the split, the T4 subset and the audited pages are
fixed before the screen. scripts/design.py draws them again from the chosen pages and checks them against this file.

Writes scripts/candidates.tsv and data/draws.json. Run from the repository root:
  python -I study/round-9-2026-11-25/scripts/deal.py <public_suffix_list.dat>
"""

import json
import os
import random
import sys
from urllib.parse import urlsplit

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(HERE, "scripts"))
from exclusions import PSL, excluded_set  # noqa: E402

SEED = 202611259
BLOCKS = (1, 2, 3)
POOLS = [os.path.join(HERE, "scripts", "pools.tsv")]
SLOT_LISTS = os.path.join(HERE, "scripts", "pools-2.tsv")
CATEGORIES = ("culture", "edu", "gov", "health", "news", "shop")
# Looked at by hand before any load: the same organisation as an excluded site or as another candidate, so dropped. Every
# other look-alike exclusions.py flagged is a different organisation (HEADER).
LOOKED_DROP = {
    "hospitalportugues.org.br": "possibly Hospital Português (Salvador), whose hospitalportugues.com.br is in the eighth study's pools",
    "hospitalsaoluiz.com.br": "Hospital São Luiz, a hospital of Rede D'Or São Luiz (rededorsaoluiz.com.br, excluded)",
    "hospitaldocoracao.com.br": "Hospital do Coração, HCor (hcor.com.br, excluded)",
    "hospitalalemao.org.br": "Hospital Alemão Oswaldo Cruz (oswaldocruz.com, excluded)",
    "hcancerbarretos.com.br": "Hospital de Câncer de Barretos, now Hospital de Amor (hospitaldeamor.com.br, excluded)",
    "hospitalsaovicentedepaulo.com.br": "possibly Hospital São Vicente de Paulo, whose hsvp.org.br is in the eighth study's pools",
    "museudasminas.org.br": "MM Gerdau, Museu das Minas e do Metal (mmgerdau.org.br, excluded)",
    "museudaimagemedosom.org.br": "possibly the Museu da Imagem e do Som of São Paulo (mis-sp.org.br, excluded)",
    "institutobrennand.org.br": "possibly Instituto Ricardo Brennand (institutoricardobrennand.org.br, excluded)",
    "boots.ie": "Boots, the same retailer as boots.com, a candidate before it",
    "currys.ie": "Currys, the same retailer as currys.co.uk (excluded)",
    "newbalance.com": "New Balance, the same company as newbalance.jp (excluded)",
}

HEADER = """# slot	url
# The ninth study's 72 slots: three blocks (b1 to b3) of 24; in each block, each of the twelve strata (Brazil or
# international x government, education, news, e-commerce, health, culture or public services) has a home slot (h) and
# an inner slot (i), filled from two different sites.
# Written by scripts/deal.py on 2026-11-25 from the ninth study's new pools (scripts/pools.tsv, written before any of them
# was checked or loaded), in their written order, before any candidate was loaded; rewritten after the first screens with
# the supplementary lists of two exhausted slots (scripts/pools-2.tsv, written before any of their sites loaded) appended
# to those slots' backups, every other line unchanged. Dropped before dealing: {excluded}
# excluded sites (data/excluded-domains.json), {dupes} sites whose registrable domain an earlier site holds, and {looked}
# look-alikes of the same organisation as an excluded site or an earlier candidate ({looked_names}). The first URL of a
# slot is its primary; the next ones (.b1, .b2, ...) are its backups, used in order when the one before fails the screen.
# Looked at by hand, kept (a first label shared with an excluded domain, a different organisation): portal.rr.gov.br and
# portal.ap.gov.br (states, not portal.mt.gov.br), prefeitura.poa.br (Porto Alegre, not Rio or São Paulo), tce.rj.gov.br,
# tce.mg.gov.br, tce.ba.gov.br and tce.pe.gov.br (other states' courts of accounts), unit.br, data.gov, target.com and
# scope.org.uk (the shared "names" are junk tokens), cff.org.br (the pharmacy council, not the US cystic fibrosis
# foundation), parkinson.org.br (a Brazilian association, not the US foundation), liverpool.gov.uk and york.gov.uk
# (councils, not universities), utah.edu (the university, not the state), usf.edu (South Florida, not São Francisco),
# independent.ie (the Irish Independent, not the UK's), extra.ie, express.com (a US retailer, not the UK newspaper).
#
# Split, T4 subset and audited slots, drawn now with the seed below, before any candidate loads (data/draws.json):
# {split}
# T4 subset (optional): {t4}
# Recall-audit slots (test): {audit}
#
# The screen (scripts/screen.mjs, headless Edge) and these rules, the sixth to eighth studies', fixed before it ran:
# - A candidate passes when its load completes with a final HTTP status under 400, it shows no bot challenge, refusal,
#   error page, geographic block or sign-in wall, it is in the slot's language (a Brazilian page in Portuguese, an
#   international one in English), it has content (200 characters of text and 5 links or more), it is a site of its
#   pool's kind, and its final address is on its own registrable domain or on one no other slot uses and no exclusion
#   names (a redirect counts).
# - A load that fails with a network error or a time-out is screened once more, later; failing again, it fails.
# - Candidates are screened in order, slot by slot, until one passes: every candidate before a slot's choice is screened.
# - Inner slots: the inner page is picked from the site's home page by the stratum's rule, from scripts/links.mjs's
#   list of its links, in page order, on the site's own registrable domain (scripts/pick.py): news and health, the first
#   link in the page's content to a single article; e-commerce, the first product category of the main menu; education,
#   the undergraduate page ("Graduação", "Undergraduate"); Brazilian government, the ombudsman page ("Ouvidoria"), else
#   the contact page ("Fale conosco", "Contato"); culture, the contact page ("Contato", "Fale conosco", "Contact",
#   "Get in touch"); international government, the search form the pool names is itself the inner page. The picked page
#   is screened by the same rules, and also fails on a subscription or sign-in wall in its text; when it fails, or no
#   link matches the rule, the slot goes to its next backup site.
# - The seventh and eighth studies' readings, fixed during their selections: an article is a story or post in the page's
#   content (reference, campaign, service and event pages are not); a category is a product category (gift occasions,
#   brands, seasonal or "new" collections, offers and search shortcuts are not); a menu link that headless Edge sees
#   without text still counts when it is the menu's first product category; a wall phrase is read in context; a
#   tuition, aid, newsletter, library-document or programme page is not the page the rule asks for; a fragment or a
#   tracking query string is dropped, a query string that chooses a level or a mode is kept, and an inner page that
#   redirects is taken at its target; a site's menu that headless Edge sees outside a nav element is not its content.
# - Every replacement is recorded in scripts/selection.tsv and scripts/pages.tsv with its reason. Client IP addresses and
#   query strings in the screen's files are redacted (scripts/redact.py).
#
# Seed, fixed now, before any page loads: {seed} (this file, scripts/deal.py and scripts/design.py).
"""


def draws(strata):
    """The split, the T4 subset and the recall-audit slots, by slot name (the docstring's order)."""
    rng = random.Random(SEED)
    coins, split = {}, {}
    for block in BLOCKS:
        for stratum in strata:
            key = f"b{block}-{stratum}"
            coins[key] = rng.random()
            home_to_dev = coins[key] < 0.5
            split[f"{key}-h"] = "dev" if home_to_dev else "test"
            split[f"{key}-i"] = "test" if home_to_dev else "dev"
    t4 = {}
    for stratum in strata:
        pool = sorted(f"b{b}-{stratum}-{k}" for b in BLOCKS for k in "hi")
        t4[stratum] = rng.choice(pool)
    audit = {}
    for cat in CATEGORIES:
        pool = sorted(s for s, half in split.items() if half == "test" and s.split("-")[2] == cat)
        assert len(pool) == 6, (cat, pool)
        audit[cat] = rng.choice(pool)
    return {"seed": SEED, "coins": coins, "split": split, "t4Subset": t4, "auditSlots": audit}


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    psl = PSL(sys.argv[1])
    excluded = set().union(*excluded_set().values())
    pools, order = {}, []
    for path in POOLS:
        for line in open(path, encoding="utf-8"):
            if not line.strip() or line.startswith("#"):
                continue
            pool, url = line.rstrip("\n").split("\t")
            if pool not in pools:
                pools[pool] = []
                order.append(pool)
            pools[pool].append(url)
    strata = sorted({p.rsplit("-", 1)[0] for p in order})
    assert len(strata) == 12 and len(order) == 24
    drawn = draws(strata)
    dropped = dupes = looked = 0
    held = set()
    slots = []
    per_pool = {}
    for pool in order:
        stratum, kind = pool.rsplit("-", 1)
        alive = []
        for u in pools[pool]:
            reg = psl.registrable(urlsplit(u).hostname)
            if reg in excluded:
                dropped += 1
            elif reg in held:
                dupes += 1
            elif reg in LOOKED_DROP:
                looked += 1
            else:
                alive.append(u)
            held.add(reg)
        per_pool[pool] = len(alive)
        for j, block in enumerate(BLOCKS):
            for i, url in enumerate(alive[j::len(BLOCKS)]):
                slot = f"b{block}-{stratum}-{kind}" + ("" if i == 0 else f".b{i}")
                slots.append((block, strata.index(stratum), kind, i, slot, url))
    # Supplementary lists for exhausted slots: appended to that slot's backups, after the same checks.
    extra = 0
    if os.path.exists(SLOT_LISTS):
        for line in open(SLOT_LISTS, encoding="utf-8"):
            if not line.strip() or line.startswith("#"):
                continue
            base, url = line.rstrip("\n").split("\t")
            reg = psl.registrable(urlsplit(url).hostname)
            if reg in excluded:
                dropped += 1
            elif reg in held:
                dupes += 1
            elif reg in LOOKED_DROP:
                looked += 1
            else:
                block, stratum, kind = int(base[1]), base.split("-", 1)[1].rsplit("-", 1)[0], base.rsplit("-", 1)[1]
                n = sum(1 for s in slots if s[4].split(".")[0] == base)
                slots.append((block, strata.index(stratum), kind, n, f"{base}.b{n}", url))
                extra += 1
            held.add(reg)
    slots.sort()
    split_text = "\n# ".join(
        f"block {b}: " + ", ".join(f"{s} home {'dev' if drawn['split'][f'b{b}-{s}-h'] == 'dev' else 'test'}" for s in strata)
        for b in BLOCKS)
    with open(os.path.join(HERE, "scripts", "candidates.tsv"), "w", encoding="utf-8", newline="\n") as f:
        f.write(HEADER.format(excluded=dropped, dupes=dupes, looked=looked,
                              looked_names="; ".join(f"{k}: {v}" for k, v in LOOKED_DROP.items()), seed=SEED,
                              split=split_text, t4=", ".join(drawn["t4Subset"][s] for s in strata),
                              audit=", ".join(drawn["auditSlots"][c] for c in CATEGORIES)))
        for s in slots:
            f.write(f"{s[4]}\t{s[5]}\n")
    with open(os.path.join(HERE, "data", "draws.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump({"note": ("Drawn by scripts/deal.py with random.Random(seed) before any candidate loaded: the split (per block "
                            "and stratum, below 0.5 the home slot goes to dev), the optional T4 subset (one slot per stratum) and "
                            "the recall-audit slots (one test slot per category). Slot names are those of scripts/candidates.tsv."),
                   **drawn}, f, ensure_ascii=False, indent=1)
        f.write("\n")
    per = {}
    for s in slots:
        per[s[4].split(".")[0]] = per.get(s[4].split(".")[0], 0) + 1
    print(f"supplementary candidates appended: {extra}")
    print(f"{dropped} excluded, {dupes} duplicates, {looked} look-alikes dropped; {len(slots)} candidates in {len(per)} slots, "
          f"{min(per.values())} to {max(per.values())} each")
    print("survivors per pool:", per_pool)
    print("test slots:", sum(v == "test" for v in drawn["split"].values()), "of", len(drawn["split"]))
    print("T4:", drawn["t4Subset"])
    print("audit:", drawn["auditSlots"])


if __name__ == "__main__":
    main()
