"""Deal the eighth study's new candidate pools to its 60 slots, before the screen.

The eighth study wrote 24 pools (12 strata x home or inner) before anything loaded: scripts/pools.tsv (24 sites each)
and, for the eleven pools left with fewer than 16 sites after the exclusions, scripts/pools-2.tsv (appended to each
pool after its first sites). This takes each pool in its written order, drops every site whose registrable domain is
excluded (data/excluded-domains.json, scripts/exclusions.py), every site whose registrable domain an earlier site of
the pools already holds, and the two look-alikes below, and deals the rest of the pool, in order, to the pool's slots
in this study, round robin: survivor 1 to the pool's first slot, 2 to its second, and so on, back to the first. A slot's
first site is its primary, the next ones its backups b1, b2, ... in order.

Design (pre-registration, section 2), the seventh study's: 60 pages, all test, 5 per stratum, in five blocks of 12 (one
page per stratum in each block). One generator, random.Random(202611218), draws first which 6 of the 12 strata
(sorted) are "home-heavy": there, blocks 1, 3 and 5 take a home page and blocks 2 and 4 an inner page; in the other 6
strata, the reverse. Each block then has 6 home and 6 inner pages, and the study 30 and 30. The same generator later
draws the T4 subset (scripts/design.py), after the pages are fixed.

Writes scripts/candidates.tsv. Run from the repository root:
  python -I study/round-8-2026-11-21/scripts/deal.py <public_suffix_list.dat>
"""

import os
import random
import sys
from urllib.parse import urlsplit

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(HERE, "scripts"))
from exclusions import PSL, excluded_set  # noqa: E402

SEED = 202611218
BLOCKS = (1, 2, 3, 4, 5)
POOLS = [os.path.join(HERE, "scripts", "pools.tsv"), os.path.join(HERE, "scripts", "pools-2.tsv")]
# Flagged by exclusions.py check (a first label shared with an excluded domain) and looked at by hand: the same
# organisation as an excluded site, so dropped. Every other flagged candidate is a different organisation (HEADER).
LOOKED_DROP = {
    "revistaoeste.com.br": "Revista Oeste, whose revistaoeste.com is a site of the sixth study's pools",
    "decathlon.com.br": "Decathlon, whose decathlon.co.uk the exclusions name",
}

HEADER = """# slot	url
# The eighth study's 60 slots: five blocks (b1 to b5) of 12, one page per stratum (Brazil or international x
# government, education, news, e-commerce, health, culture or public services) in each block; a slot is a home page (h)
# or an inner page (i). Home-heavy strata (blocks 1, 3, 5 home; 2, 4 inner), drawn with the seed below: {heavy}. The
# other strata take inner pages in blocks 1, 3, 5 and home pages in 2 and 4.
# Written by scripts/deal.py on 2026-11-21 from the eighth study's new pools (scripts/pools.tsv and scripts/pools-2.tsv,
# written before any of them loaded), in their written order, before any candidate was loaded. Dropped before dealing:
# {excluded} excluded sites (data/excluded-domains.json), {dupes} sites whose registrable domain an earlier site holds,
# and {looked} look-alikes of the same organisation as an excluded site ({looked_names}). The first URL of a slot is its
# primary; the next ones (.b1, .b2, ...) are its backups, used in order when the one before fails the screen.
# Looked at by hand, kept (a first label shared with an excluded domain, a different organisation): focus.jor.br,
# next.co.uk and high.org (the shared "names" are file or junk tokens), diabetes.org.br, diabetes.ie, mam.rio (not
# mam.org.br), theatromunicipal.rj.gov.br (not theatromunicipal.org.br), manchester.gov.uk, leeds.gov.uk, bristol.gov.uk,
# sheffield.gov.uk and cardiff.gov.uk (councils, not universities), kent.ac.uk and birmingham.ac.uk (universities, not
# councils), epilepsy.ie, epilepsy.com, parkinsons.ie, hse.gov.uk (not hse.ie).
#
# The screen (scripts/screen.mjs, headless Edge) and these rules, the sixth and seventh studies', fixed before it ran:
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
# - The seventh study's readings, fixed during its selection: an article is a story or post in the page's content
#   (reference, campaign, service and event pages are not); a category is a product category (gift occasions, brands,
#   seasonal or "new" collections, offers and search shortcuts are not); a menu link that headless Edge sees without text
#   still counts when it is the menu's first product category; a wall phrase is read in context.
# - Every replacement is recorded in scripts/selection.tsv and scripts/pages.tsv with its reason. Client IP addresses and
#   query strings in the screen's files are redacted (scripts/redact.py).
#
# Seed, fixed now, before any page loads: {seed} (this file, scripts/deal.py and scripts/design.py).
"""


def heavy_strata(rng, strata):
    return sorted(rng.sample(sorted(strata), 6))


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
    rng = random.Random(SEED)
    heavy = heavy_strata(rng, strata)
    kinds = {}
    for s in strata:
        for b in BLOCKS:
            home = (b % 2 == 1) == (s in heavy)
            kinds[(s, b)] = "h" if home else "i"
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
        mine = [b for b in BLOCKS if kinds[(stratum, b)] == kind]
        for j, block in enumerate(mine):
            for i, url in enumerate(alive[j::len(mine)]):
                slot = f"b{block}-{stratum}-{kind}" + ("" if i == 0 else f".b{i}")
                slots.append((block, strata.index(stratum), i, slot, url))
    slots.sort()
    with open(os.path.join(HERE, "scripts", "candidates.tsv"), "w", encoding="utf-8", newline="\n") as f:
        f.write(HEADER.format(heavy=", ".join(heavy), excluded=dropped, dupes=dupes, looked=looked,
                              looked_names="; ".join(f"{k}: {v}" for k, v in LOOKED_DROP.items()), seed=SEED))
        for s in slots:
            f.write(f"{s[3]}\t{s[4]}\n")
    per = {}
    for s in slots:
        per[s[3].split(".")[0]] = per.get(s[3].split(".")[0], 0) + 1
    print(f"home-heavy strata: {', '.join(heavy)}")
    print(f"{dropped} excluded, {dupes} duplicates, {looked} look-alikes dropped; {len(slots)} candidates in {len(per)} slots, "
          f"{min(per.values())} to {max(per.values())} each")
    print("survivors per pool:", per_pool)


if __name__ == "__main__":
    main()
