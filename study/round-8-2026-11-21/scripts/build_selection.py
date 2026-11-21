"""Write scripts/selection.tsv, the eighth study's choice slot by slot, from the screens and the inner-page picks.

The seventh study's build_selection.py with this study's screens and notes. For each slot: the candidate chosen (its name
in scripts/candidates.tsv), the page's address, its type, and why: every candidate before it with the first screen rule
it failed (scripts/screen_pass.py's verdict over data/screen-1.json to screen-3, the candidates' screens), then the notes
below, written by the person who chose on 2026-11-21 before any Rampa run: an inner site whose listing gave no page by
the stratum's rule, an inner page that failed its own screen or was screened again (data/screen-4.json to screen-6, the
inner pages' screens), a proposal of scripts/pick.py set aside and why, and the flags cleared by a look. A home page's
address is where the screen's load ended (a redirect's target); an inner page's, where its own screen's load ended when
it redirected.

Run from the repository root: python -I study/round-8-2026-11-21/scripts/build_selection.py <public_suffix_list.dat>
"""
import json
import os
import sys
from urllib.parse import urlsplit

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(HERE, "scripts"))
from exclusions import PSL, excluded_set  # noqa: E402
from screen_pass import verdict  # noqa: E402

CANDIDATE_SCREENS = [1, 2, 3]
# Slots whose choice is not the first candidate that passed the home-page screen: the inner page could not be picked or
# failed its own screen. Value: (chosen candidate, notes on the candidates set aside after the screen).
OVERRIDE = {
    "b5-in-culture-i": ("b5-in-culture-i.b3", "https://www.everymancork.com/ links no contact page (its menu has \"Your visit\" and "
                        "\"Box office\"); https://www.limetreetheatre.ie/ redirects to limetreebelltable.ie, Lime Tree Theatre and "
                        "Belltable's joint site (the same organisation: cleared), which links no contact page (\"About Us\", "
                        "\"Box Office + Gift Vouchers\")"),
    "b5-in-health-i": ("b5-in-health-i.b1", "https://www.alz.org/ links no story in its content (donation, campaign, event, "
                       "reference and professional pages)"),
}
# Inner pages: (address, type, how it was picked). Line numbers (#n) are of DATA/links/<slot>.txt.
INNER = {
    "b1-br-culture-i": ("https://theatromunicipal.rj.gov.br/fale-conosco/", "contact",
                        "the contact page, \"Fale Conosco\" in its menu (#59); the site has no lang attribute and Portuguese text (cleared)"),
    "b1-br-news-i": ("https://olhardigital.com.br/2026/11/21/ciencia-e-espaco/bepicolombo-faz-manobra-decisiva-para-entrar-na-orbita-de-mercurio/",
                     "article", "the first article in its content (#39)"),
    "b1-in-culture-i": ("https://www.bordgaisenergytheatre.ie/contact-us/", "contact",
                        "the contact page, \"Get In Touch\" in its header (#16); pick.py's first proposal (#7, \"Learn More\") is the same page with a fragment"),
    "b1-in-gov-i": ("https://www.medicalcouncil.ie/public-information/check-the-register/", "form",
                    "the search form the pool names (the Medical Council's register search)"),
    "b1-in-health-i": ("https://jigsaw.ie/jigsaw-welcomes-the-world-to-dublin-for-iaymh-2026/", "article",
                       "the first post in its content (#35 is this post with a tracking query string, dropped; #41 without it)"),
    "b1-in-shop-i": ("https://www.matalan.co.uk/c/womens/", "listing",
                     "the first product category of its menu, \"WOMENS\" (#105); \"CHRISTMAS\" (#46) before it is a seasonal collection, not a product category"),
    "b2-br-edu-i": ("https://www.puc-campinas.edu.br/graduacao/", "info", "the undergraduate page, \"Graduação\" in its menu (#12)"),
    "b2-br-gov-i": ("https://www.tjrj.jus.br/institucional/ouvidoria/ouvidoria", "contact",
                    "the ombudsman page, \"Ouvidoria/SIC\" (#151); its link listing timed out once and was taken again"),
    "b2-br-health-i": ("https://www.endocrino.org.br/noticias/saude-da-populacao-negra-estudos-brasileiros-revelam-desigualdades-no-cuidado/",
                       "article", "the first news story in its content (#47)"),
    "b2-br-shop-i": ("https://www.animale.com.br/new-collection/acessorios", "listing",
                     "the first product category of its menu, \"ACESSÓRIOS\" (#8; the menu is closed for headless Edge; the path sits under "
                     "the store's /new-collection/ catalogue, and the link names a product category, accessories)"),
    "b2-in-edu-i": ("https://www.syracuse.edu/academics/programs/?level=undergraduate", "info",
                    "the undergraduate page, \"Undergraduate Majors and Minors\" in its menu (#5; its query string chooses the level, not tracking: kept)"),
    "b2-in-news-i": ("https://www.coventrytelegraph.net/news/coventry-news/children-young-12-arrested-knife-34923139", "article",
                     "the first article in its content (#52); its screen timed out once and passed when screened again (data/screen-5.json)"),
    "b3-br-culture-i": ("https://salasaopaulo.art.br/salasp/pt/fale-conosco", "contact", "the contact page, \"Fale conosco\" in its menu (#84)"),
    "b3-br-news-i": ("https://metsul.com/2026-11-22-frente-fria-chuva-tempestades/", "article",
                     "the first article in its content (#38, an image link with no text for headless Edge)"),
    "b3-in-culture-i": ("https://www.laphil.com/about-us/contact-us", "contact", "the contact page, \"Contact Us\" (#208, footer)"),
    "b3-in-gov-i": ("https://www.hcpc-uk.org/check-the-register/", "form", "the search form the pool names (the HCPC register search)"),
    "b3-in-health-i": ("https://alone.ie/alone-launches-christmas-campaign-as-more-than-half-of-older-people-struggle-to-pay-bills/", "article",
                       "the first news post in its content (#42); pick.py's first proposal, the 2025 annual report (#41), is a library document, not a story"),
    "b3-in-shop-i": ("https://www.gap.com/browse/women?cid=5643", "listing",
                     "the first product category of its menu, \"Women\" (#12); its address, with the menu's tracking parameters (mlink, nav), "
                     "redirects here; cid names the category: kept"),
    "b4-br-edu-i": ("https://www.unp.br/cursos/graduacao/?modalidade=todos", "info",
                    "the undergraduate page, \"Graduação\" in its menu (#5); its address redirects here (the query string chooses the course mode, not tracking: kept)"),
    "b4-br-gov-i": ("https://www.tjes.jus.br/portal-transparencia/ouvidoria/", "contact",
                    "the ombudsman page (#182, a menu link with no text for headless Edge, path .../ouvidoria/); \"Ouvidoria Judiciária\" "
                    "(#197, /ouvidoria/) redirects to the same page (data/screen-4.json)"),
    "b4-br-health-i": ("https://diabetes.org.br/comprimido-de-semaglutida-tambem-ajuda-a-controlar-o-diabetes/", "article",
                       "the first news story in its content (#38); pick.py's first proposal, \"Diabetes & Sala de Aula\" (#34), is a programme page "
                       "of 414 characters, not a story (data/screen-4.json)"),
    "b4-br-shop-i": ("https://www.cantao.com.br/vestidos", "listing",
                     "the first product category of its menu, \"vestidos\" (#5); \"bazar\" (#3, the store's sale) and \"coleção\" (#4, the "
                     "season's collection) before it are not product categories"),
    "b4-in-edu-i": ("https://www.bc.edu/content/bc-web/academics/undergraduate-programs.html", "info",
                    "the undergraduate page, \"Undergraduate Programs\" in its menu (#39); \"Undergraduate Tuition & Financial Aid\" (#32) before it is the cost and aid page"),
    "b4-in-news-i": ("https://grist.org/energy/what-congress-bill-to-speed-up-energy-projects-would-mean-for-you-permitting-reform-baaja/", "article",
                     "the first article in its content (#62); pick.py's first proposal (#34) is a newsletter sign-up, not an article"),
    "b5-br-culture-i": ("https://festivaldecuritiba.com.br/contato/", "contact", "the contact page, \"Contato\" (#91, footer)"),
    "b5-br-news-i": ("https://ultimosegundo.ig.com.br/2026-10-25/lula-vira-no-2-turno-e-e-reeleito-presidente-pela-quarta-vez.html", "article",
                     "the first article in its content (#202): the 200 links before it are the site's menu, which headless Edge sees outside a nav "
                     "element (its sections and columnists' pages, pick.py's proposals, are not articles); its screen timed out once and passed "
                     "when screened again (data/screen-5.json)"),
    "b5-in-culture-i": ("https://www.paviliontheatre.ie/about/contact", "contact", "the contact page, \"Contact Us\" in its menu (#51)"),
    "b5-in-gov-i": ("https://www.nmc.org.uk/registration/search-the-register/", "form", "the search form the pool names (the NMC register search)"),
    "b5-in-health-i": ("https://downsyndrome.ie/our-members/meet-oisin/", "article",
                       "the first story in its content, a member's story (#47, an image link; pick.py's slug rule wants four words); the pages "
                       "before it (useful information, donation and fundraising pages, pick.py's #43) are not stories"),
    "b5-in-shop-i": ("https://www.mccauley.ie/vitamins", "listing",
                     "the first product category of its menu, \"Vitamins\" (#19); \"Compare Products\" (#13) and \"Pharmacy Services\" (#16) "
                     "before it are a tool and a services page"),
}
HOME_NOTES = {
    "b3-in-edu-h": "https://www.indiana.edu/ redirects to bloomington.iu.edu, Indiana University Bloomington's own site (iu.edu, on no other slot and not excluded; cleared)",
    "b4-in-shop-h": "https://www.kilkennyshop.com/ redirects to kilkennydesign.com, the same store's own domain (on no other slot and not excluded; cleared)",
}

def main():
    sys.stdout.reconfigure(encoding="utf-8")
    psl = PSL(sys.argv[1])
    excluded = set().union(*excluded_set().values())
    order, urls = [], {}
    for line in open(os.path.join(HERE, "scripts", "candidates.tsv"), encoding="utf-8"):
        if line.strip() and not line.startswith("#"):
            slot, url = line.rstrip("\n").split("\t")
            order.append(slot)
            urls[slot] = url
    holders = {psl.registrable(urlsplit(u).hostname): s.split(".")[0] for s, u in urls.items()}
    results = {}
    for n in CANDIDATE_SCREENS:
        for r in json.load(open(os.path.join(HERE, "data", f"screen-{n}.json"), encoding="utf-8")):
            results[(r["slot"], r["url"])] = r
    rows = []
    for base in sorted({s.split(".")[0] for s in order}, key=lambda b: order.index(b)):
        cands = [s for s in order if s.split(".")[0] == base]
        fails, chosen = [], None
        forced = OVERRIDE.get(base, (None, None))[0]
        for slot in cands:
            r = results.get((slot, urls[slot]))
            v = "not screened" if r is None else verdict(psl, r, excluded, holders)[0]
            if (forced is None and v == "pass") or slot == forced:
                chosen = slot
                break
            if v != "pass":
                fails.append(f"{urls[slot]} {describe(v)}")
        assert chosen, base
        notes = [", ".join(fails)] if fails else []
        if base in OVERRIDE:
            notes.append(OVERRIDE[base][1])
        if base.endswith("-i"):
            url, ptype, how = INNER[base]
            notes.append(how)
        else:
            r = results[(chosen, urls[chosen])]
            final = r.get("finalUrl") or urls[chosen]
            parts = urlsplit(final)
            url = f"{parts.scheme}://{parts.netloc}{parts.path}"
            ptype = "home"
            notes.append("its home page" + (f" ({urls[chosen]} redirects here)" if url.rstrip("/") != urls[chosen].rstrip("/") else ""))
            if base in HOME_NOTES:
                notes.append(HOME_NOTES[base])
        rows.append((base, chosen, url, ptype, "; ".join(n for n in notes if n)))
    assert len(rows) == 60
    with open(os.path.join(HERE, "scripts", "selection.tsv"), "w", encoding="utf-8", newline="\n") as f:
        f.write("# slot\tchosen\turl\tpageType\twhy\n")
        f.write("# The eighth study's choice, slot by slot, made on 2026-11-21 by the rules of scripts/candidates.tsv from the screens\n"
                "# (data/screen-*.json) and the link listings (scripts/links.mjs, scripts/pick.py), before any Rampa run; written by\n"
                "# scripts/build_selection.py. 'chosen' is the candidate's slot name in scripts/candidates.tsv; 'why' lists the candidates\n"
                "# before it that failed, and how the page was picked. scripts/build_pages.py turns this into scripts/pages.tsv.\n")
        for r in rows:
            f.write("\t".join(r) + "\n")
    print(f"{len(rows)} slots; {sum(1 for r in rows if '.' in r[1])} went to a backup")


def describe(v):
    if v.startswith("http "):
        return f"answered HTTP {v[5:]}"
    if v.startswith("network: "):
        return f"did not load in two tries ({v[9:].split(' at ')[0].replace('page.goto: ', '')})"
    if v == "challenge":
        return "showed headless Edge a bot check"
    if v.startswith("empty"):
        return f"showed headless Edge almost nothing ({v[6:]})"
    if v.startswith("language"):
        return f"declares another language ({v[9:]})"
    return v


if __name__ == "__main__":
    main()
