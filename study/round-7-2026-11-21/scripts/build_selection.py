"""Write scripts/selection.tsv, the seventh study's choice slot by slot, from the screens and the inner-page picks.

For each slot: the candidate chosen (its name in scripts/candidates.tsv), the page's address, its type, and why: every
candidate before it with the first screen rule it failed (scripts/screen_pass.py's verdict over data/screen-1.json to
screen-6, screen-8, screen-9 and screen-11, the candidates' screens), then the notes below, written by the person who
chose on 2026-11-21 before any Rampa run: an inner site whose listing gave no page by the stratum's rule, an inner page
that failed its own screen (data/screen-7.json, screen-10, screen-12), a proposal of scripts/pick.py set aside and why,
and the flags cleared by a look. A home page's address is where the screen's load ended (a redirect's target).

Run from the repository root: python -I study/round-7-2026-11-21/scripts/build_selection.py <public_suffix_list.dat>
"""
import json
import os
import sys
from urllib.parse import urlsplit

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(HERE, "scripts"))
from exclusions import PSL, excluded_set  # noqa: E402
from screen_pass import verdict  # noqa: E402

CANDIDATE_SCREENS = [1, 2, 3, 4, 5, 6, 8, 9, 11]
# Slots whose choice is not the first candidate that passed the home-page screen: the inner page could not be picked or
# failed its own screen. Value: (chosen candidate, notes on the candidates set aside after the screen).
OVERRIDE = {
    "b1-br-culture-i": ("b1-br-culture-i.b5", "https://centrocultural.sp.gov.br/ links no contact page (19 same-site links); "
                        "https://www.spcine.com.br/ links no contact page; https://www.flip.org.br/ links no contact page (12 same-site links)"),
    "b1-in-culture-i": ("b1-in-culture-i.b1", "https://www.rbo.org.uk/ links no contact page (as in the sixth study)"),
    "b1-in-health-i": ("b1-in-health-i.b3", "https://www.parkinsons.org.uk/ links no single article in its content; "
                       "https://www.pieta.ie/ links only service, campaign and event pages in its content, no story"),
    "b1-in-shop-i": ("b1-in-shop-i.b5", "https://www.blacks.co.uk/ passed, but its first category, /collections/mens, showed "
                     "headless Edge a bot check (HTTP 403, data/screen-7.json)"),
    "b2-br-edu-i": ("b2-br-edu-i.b1", "https://www.uninove.br/ passed (no lang attribute, Portuguese text: cleared), but its "
                    "undergraduate page, the menu's \"Graduação\" (https://seletivo.uninove.br/graduacao-e-curta-duracao/todos/todos/), "
                    "showed 192 characters of text, under the rule's 200 (data/screen-7.json)"),
}
# Inner pages: (address, type, how it was picked). Line numbers (#n) are of DATA/links/<slot>.txt.
INNER = {
    "b1-br-culture-i": ("https://www.orquestraouropreto.com.br/site/contato/", "contact", "the contact page, \"FALE CONOSCO\" in its menu (#14)"),
    "b1-br-health-i": ("https://sbim.org.br/notas-tecnicas/dpnisvsams-atualizacao-da-estrategia-de-vacinacao-contra-a-mpox", "article",
                       "the first post in its content, a technical note (#41); pick.py's first proposal, the over-60s vaccination calendar (#35), is a reference page, not a story"),
    "b1-in-culture-i": ("https://www.druid.ie/site-info/contact-us", "contact", "the contact page, \"Contact Us\" (#41, footer)"),
    "b1-in-edu-i": ("https://www.atu.ie/study/undergraduate", "info", "the undergraduate page, \"Undergraduate/CAO\" in its header (#24)"),
    "b1-in-health-i": ("https://asthma.ie/could-it-be-severe-asthma-join-our-upcoming-free-webinar/", "article",
                       "the first post in its content's news list (an events post); pick.py's proposals before it (about-asthma, life-with-asthma, book-a-nurse-call) are reference pages, not stories"),
    "b1-in-shop-i": ("https://www.cottontraders.com/women/", "listing",
                     "its first product category, \"Women\" (#9; no category in its header or navigation, so the page's first); \"Christmas\" (#5) before it is a seasonal collection, not a product category"),
    "b2-br-edu-i": ("https://www.pucminas.br/AdministracaoSuperior/Pro-reitorias/Paginas/Graduacao.aspx", "info",
                    "the undergraduate page, \"Graduação\" in its header (#45); \"SGA Graduação\" (#19) before it is the teachers' academic system"),
    "b2-br-gov-i": ("https://www.mpmg.mp.br/portal/menu/conheca-o-mpmg/ouvidoria/", "contact", "the ombudsman page, \"Ouvidoria\" in its menu (#17)"),
    "b2-br-news-i": ("https://oantagonista.com.br/analise/relatorio-da-pf-sobre-mendonca-saiu-pela-culatra/", "article",
                     "the first article in its content (#33); the home page's wall phrase is a label on one item of a list of a partner magazine's posts (cleared)"),
    "b2-br-shop-i": ("https://amaro.com/moda1/", "listing", "the first product category of its menu, \"MODA\" (#9)"),
    "b2-in-gov-i": ("https://www.va.gov/find-locations/", "form", "the search form the pool names (VA's location search)"),
    "b2-in-news-i": ("https://www.birminghammail.co.uk/news/midlands-news/crash-near-birmingham-airport-live-34947543", "article",
                     "the first article in its content (#63, a live story)"),
    "b3-br-culture-i": ("https://institutocpfl.org.br/contato/", "contact", "the contact page, \"contato\" (#55, footer)"),
    "b3-br-health-i": ("https://sbgg.org.br/gga-passa-a-integrar-a-colecao-scielo-brasil/", "article",
                       "the first post in its content (#58); its link listing timed out once and was taken again"),
    "b3-in-culture-i": ("https://www.steppenwolf.org/about-us/contact-us", "contact", "the contact page, \"Contact Us\" in its menu (#66)"),
    "b3-in-edu-i": ("https://www.strath.ac.uk/studywithus/undergraduate/", "info", "the undergraduate page, \"Undergraduate\" in its menu (#22)"),
    "b3-in-health-i": ("https://alzheimer.ie/real-stories/we-will-tell-everyone/", "article",
                       "the first story in its content (#62); \"Become a Friend of ASI\" (#58) before it is a campaign page, not a story"),
    "b3-in-shop-i": ("https://www.heals.com/pages/lighting", "listing",
                     "the first product category of its menu, \"all lighting\"; before it come gift occasions, designer brands and \"new ...\" collections (new arrivals), none a product category"),
    "b4-br-edu-i": ("https://www.unicesumar.edu.br/cursos/graduacao/?modalidade=presencial", "info",
                    "the undergraduate page, \"Graduação Presencial\" (#6; its query string chooses the course mode, not tracking: kept)"),
    "b4-br-gov-i": ("https://mppr.mp.br/ouvidoria", "contact", "the ombudsman page, /ouvidoria in its menu (#21)"),
    "b4-br-news-i": ("https://www.meionews.com/piaui/detento-e-encontrado-morto-na-penitenciaria-irmao-guido-em-teresina-581716", "article",
                     "the first article in its content (#127); https://www.meionorte.com/ redirects to meionews.com, the same newspaper's site, on no other slot's domain and not excluded (cleared)"),
    "b4-br-shop-i": ("https://www.drogariasaopaulo.com.br/medicamentos", "listing",
                     "the first product category of its menu, /medicamentos (the closed menu's links have no text for headless Edge); the search shortcuts before it (\"pesquisa?q=...\") are searches, not categories"),
    "b4-in-gov-i": ("https://www.medicare.gov/care-compare/", "form", "the search form the pool names (Medicare's Care Compare)"),
    "b4-in-news-i": ("https://morningstaronline.co.uk/article/amazon-access-rights-sweetheart-deals", "article", "the first article in its content (#24)"),
    "b5-br-culture-i": ("https://transparencia.sesisp.org.br/sac", "contact", "the contact page, \"FALE CONOSCO\" (#44, footer), the customer service page on its transparency subdomain"),
    "b5-br-health-i": ("https://www.febrasgo.org.br/noticia/cancer-na-infancia-pode-deixar-marcas-na-fertilidade-e-essa-conversa-precisa-comecar-no-diagnostico/", "article",
                       "the first news story in its content (#57); a campaign page (#50) comes before it"),
    "b5-in-culture-i": ("https://www.wexfordopera.com/our-story/contact-us", "contact", "the contact page, \"Contact us\" in its header (#50)"),
    "b5-in-edu-i": ("https://admission.ucla.edu/", "info", "the undergraduate page, \"Undergraduate Admission\" in its menu (#28)"),
    "b5-in-health-i": ("https://www.ageuk.org.uk/discover/2026/september/a-tribute-to-dame-esther-rantzen/", "article",
                       "the first story in its content (#342); an advice page (#339) comes before it"),
    "b5-in-shop-i": ("https://www.woodies.ie/paint-decorating", "listing",
                     "the first product category of its menu, \"Paint & Decorating\"; before it come Black Friday and Christmas offers, not product categories"),
}
HOME_NOTES = {
    "b2-in-shop-h": "its wall phrase is a newsletter sign-up (\"New subscribers only\"), not a wall (cleared)",
    "b5-br-gov-h": "https://www.mt.gov.br/ redirects to portal.mt.gov.br, the same state government's portal (a separate registrable domain under the public suffix mt.gov.br; cleared)",
    "b5-br-news-h": "its wall phrase is a label on one story of the home page's list (cleared)",
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
        f.write("# The seventh study's choice, slot by slot, made on 2026-11-21 by the rules of scripts/candidates.tsv from the screens\n"
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
