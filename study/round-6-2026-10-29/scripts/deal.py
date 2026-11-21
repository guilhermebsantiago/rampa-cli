"""Deal the sixth study's candidate pools to its 72 slots, before the screen.

scripts/pools.tsv holds 24 pools (12 strata x home or inner), 20 sites each, in the order they were written. This drops
every site whose registrable domain is excluded (data/excluded-domains.json, built by scripts/exclusions.py) and deals
the rest of each pool, in order, to the pool's three slots, one per block: survivor 1 to block 1, 2 to block 2, 3 to
block 3, 4 to block 1, and so on. A slot's first site is its primary, the next ones its backups b1, b2, ... in order.

Writes scripts/candidates.tsv. Run from the repository root:
  python -I study/round-6-2026-10-29/scripts/deal.py <public_suffix_list.dat>
"""

import json
import os
import sys
from urllib.parse import urlsplit

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(HERE, "scripts"))
from exclusions import PSL  # noqa: E402

BLOCKS = 3

HEADER = """# slot	url
# The sixth study's 72 slots: three blocks (b1, b2, b3) of the fifth study's 24, each with twelve strata (Brazil or
# international x government, education, news, e-commerce, health, culture or public services) and two slots per
# stratum, a home page (h) and an inner page (i). Written by scripts/deal.py on 2026-10-29 from scripts/pools.tsv,
# before any candidate was loaded. The first URL of a slot is its primary; the next ones (.b1, .b2, ...) are its
# backups, used in order when the one before fails the screen. Excluded before dealing (data/excluded-domains.json):
# {excluded}.
# Looked at by hand, kept (a first label shared with an excluded domain, a different organisation): {looks}.
#
# The screen (scripts/screen.mjs, headless Edge, as in the fifth study) and these rules, fixed before it ran:
# - A candidate passes when its load completes with a final HTTP status under 400, it shows no bot challenge, refusal,
#   error page, geographic block or sign-in wall, it is in the slot's language (a Brazilian page in Portuguese, an
#   international one in English), it has content (200 characters of text and 5 links or more), it is a site of its
#   pool's kind, and its final address is on its own registrable domain or on one no other slot uses and no exclusion
#   names (a redirect counts).
# - A load that fails with a network error or a time-out is screened once more, later; failing again, it fails.
# - Inner slots: the inner page is picked from the site's home page by the stratum's rule, from scripts/links.mjs's
#   list of its links, in page order, on the site's own registrable domain: news and health, the first link to a
#   single article (a story or post, not a section, tag, author, video or listing page); e-commerce, the first product
#   category of the main menu; education, the undergraduate page ("Graduação", "Undergraduate"); Brazilian government,
#   the ombudsman page ("Ouvidoria"), else the contact page ("Fale conosco", "Contato"); culture, the contact page
#   ("Contato", "Fale conosco", "Contact", "Get in touch"); international government, the search form the pool names
#   is itself the inner page. The picked page is screened by the same rules, and also fails on a subscription or
#   sign-in wall in its text; when it fails, or no link matches the rule, the slot goes to its next backup site.
# - Every replacement is recorded in scripts/pages.tsv with its reason. Client IP addresses and other personal data in
#   the screen's files are redacted (scripts/redact.py).
#
# Split seed, fixed now, before any page loads: {seed} (scripts/split.py).
"""


def main():
    psl = PSL(sys.argv[1])
    ex = json.load(open(os.path.join(HERE, "data", "excluded-domains.json"), encoding="utf-8"))
    excluded = set(ex["studyPages"]) | set(ex["namedByRepository"]) | set(ex.get("namedInHistoryOnly", []))
    pools, order = {}, []
    for line in open(os.path.join(HERE, "scripts", "pools.tsv"), encoding="utf-8"):
        if not line.strip() or line.startswith("#"):
            continue
        pool, url = line.rstrip("\n").split("\t")
        if pool not in pools:
            pools[pool] = []
            order.append(pool)
        pools[pool].append(url)
    seen = {}
    dropped = []
    for pool in order:
        for url in pools[pool]:
            reg = psl.registrable(urlsplit(url).hostname)
            assert reg not in seen, f"{url} repeats {seen[reg]}"
            seen[reg] = url
            if reg in excluded:
                dropped.append(reg)
    slots = []
    for pool in order:
        stratum, kind = pool.rsplit("-", 1)
        alive = [u for u in pools[pool] if psl.registrable(urlsplit(u).hostname) not in excluded]
        assert len(alive) >= BLOCKS * 5, f"{pool}: {len(alive)} sites"
        for block in range(1, BLOCKS + 1):
            mine = alive[block - 1::BLOCKS]
            for i, url in enumerate(mine):
                slot = f"b{block}-{stratum}-{kind}" + ("" if i == 0 else f".b{i}")
                slots.append((block, stratum, kind, i, slot, url))
    slots.sort(key=lambda s: (s[0], order.index(f"{s[1]}-{s[2]}"), s[3]))
    looks = "tce.sp.gov.br (tce.mt.gov.br), cancer.ie and cancer.net (cancer.org); spurious: extra.com.br, wa.gov, reading.ac.uk"
    sys.path.insert(0, os.path.join(HERE, "scripts"))
    from split import SEED  # noqa: E402
    with open(os.path.join(HERE, "scripts", "candidates.tsv"), "w", encoding="utf-8", newline="\n") as f:
        f.write(HEADER.format(excluded=", ".join(dropped), looks=looks, seed=SEED))
        for s in slots:
            f.write(f"{s[4]}\t{s[5]}\n")
    per = {}
    for s in slots:
        per.setdefault(s[4].split(".")[0], 0)
        per[s[4].split(".")[0]] += 1
    print(f"{len(dropped)} excluded, {len(slots)} candidates in {len(per)} slots, {min(per.values())} to {max(per.values())} each")


if __name__ == "__main__":
    main()
