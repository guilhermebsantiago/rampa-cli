"""Write scripts/selection.tsv, the ninth study's choice slot by slot, from the screens and the inner-page picks.

The eighth study's build_selection.py with this study's screens and notes. For each slot: the candidate chosen (its name
in scripts/candidates.tsv), the page's address, its type, and why: every candidate before it with the first screen rule
it failed (scripts/screen_pass.py's verdict over the candidates' screens, data/screen-1, 2, 3, 4, 5, 7, 8 and 10), then
the notes below, written by the person who chose on 2026-11-25 before any Rampa run: an inner site whose listing gave no
page by the stratum's rule, an inner page that failed its own screen (data/screen-6, 9 and 11, the inner pages' screens),
a proposal of scripts/pick.py set aside and why, and the flags cleared by a look. A home page's address is where the
screen's load ended (a redirect's target); an inner page's, where its own screen's load ended when it redirected.

Run from the repository root: python -I study/round-9-2026-11-25/scripts/build_selection.py <public_suffix_list.dat>
"""
import json
import os
import sys
from urllib.parse import urlsplit

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(HERE, "scripts"))
from exclusions import PSL, excluded_set  # noqa: E402
from screen_pass import verdict  # noqa: E402

CANDIDATE_SCREENS = [1, 2, 3, 4, 5, 7, 8, 10]
# Slots whose choice is not the first candidate that passed the home-page screen: the inner page could not be picked or
# failed its own screen. Value: (chosen candidate, notes on the candidates set aside after the screen).
OVERRIDE = {
    "b1-in-edu-i": ("b1-in-edu-i.b5", "https://www.royalholloway.ac.uk/ and https://www.sunderland.ac.uk/ link no undergraduate page by "
                    "the rule (headless Edge sees Royal Holloway's \"Studying here\" menu without text; Sunderland's only match, \"40 "
                    "undergraduate and postgraduate courses\", is a link to the home page itself and names postgraduate courses too)"),
    "b2-br-health-i": ("b2-br-health-i.b2", "https://sban.org.br/ and https://www.sobed.org.br/ link no story in their content (institutional, "
                       "technical-document, event and blog-index pages)"),
    "b3-br-news-i": ("b3-br-news-i.b1", "https://jovempan.com.br/'s first article in its content (#150) timed out twice in the screen "
                     "(data/screen-6.json and screen-9.json): a failed load"),
    "b3-in-shop-i": ("b3-in-shop-i.b3", "https://www.gooutdoors.co.uk/'s first product category, \"Men\" (#87), showed headless Edge a bot "
                     "check (HTTP 403, data/screen-6.json); https://www.thefragranceshop.co.uk/ showed one on its home page (data/screen-7.json)"),
}
# Inner pages: (address, type, how it was picked). Line numbers (#n) are of DATA/links/<slot>.txt (the candidate's name).
INNER = {
    "b1-br-culture-i": ("https://amigosdaarte.org.br/contato/", "contact",
                        "the site redirects to its operator's page for the theatre on amigosdaarte.org.br (Amigos da Arte, the body that runs "
                        "Teatro Sérgio Cardoso; on no other slot and not excluded: cleared), so the listing was taken there: the contact page, "
                        "\"Contato\" in its menu (#30)"),
    "b1-br-edu-i": ("https://metodista.br/cursos-presencial/", "info", "the undergraduate page, \"Graduação Presencial\" in its menu (#25)"),
    "b1-br-gov-i": ("https://www.tjrr.jus.br/index.php/ouvidoria", "contact", "the ombudsman page, \"Ouvidoria\" (#9)"),
    "b1-br-health-i": ("https://abneuro.org.br/2026/10/22/nota-de-esclarecimento-abn-sem-vinculacao-politico-partidaria/", "article",
                       "the first post in its content (#82, a statement posted in its news feed)"),
    "b1-br-news-i": ("https://www.aosfatos.org/noticias/checagem-de-fatos-pauta-debates-e-mobiliza-reacao-as-mentiras-eleitorais/", "article",
                     "the first article in its content (#3, an image link with no text for headless Edge)"),
    "b1-br-shop-i": ("https://www.carmensteffens.com.br/acess%C3%B3rios/acessorios-vertodos", "listing",
                     "the first product category of its menu, \"Acessórios\" (#36); \"New In\" (#2, the new collection) and \"Black November\" "
                     "with its sale listings (#3 to #8 under /black-november/, pick.py's proposals) and the size filters after them before it are not product categories"),
    "b1-in-culture-i": ("https://royalcourttheatre.com/contact-us", "contact", "the contact page, \"Contact\" in its menu (#13)"),
    "b1-in-edu-i": ("https://www.westminster.ac.uk/course-search?f[0]=course_type%3A926", "info",
                    "the undergraduate page, \"Undergraduate courses\" (#15; its query string chooses the level, not tracking: kept); "
                    "pick.py's first proposal (#13) is an open-day event page"),
    "b1-in-gov-i": ("https://www.barstandardsboard.org.uk/for-the-public/search-a-barristers-record/the-barristers-register.html", "form",
                    "the search form the pool names (the Barristers' Register); the page has no lang attribute and English text (cleared)"),
    "b1-in-health-i": ("https://kidneycareuk.org/news-from-kidney-care-uk/new-research-dialysis-conservative-kidney-management/", "article",
                       "the first news story in its content (#114); pick.py's proposals (#107 to #109) and the links before #114 are "
                       "reference pages on kidney disease stages, not stories"),
    "b1-in-news-i": ("https://www.mylondon.news/news/west-london-news/sociable-outgoing-putney-man-25-34958054", "article",
                     "the first article in its content (#55)"),
    "b1-in-shop-i": ("https://www.hobbs.com/clothing/dresses/", "listing",
                     "the first product category of its menu, \"Dresses & Jumpsuits\" (#19); pick.py's first proposal, \"RETURNS\" (#12), is the "
                     "returns policy"),
    "b2-br-culture-i": ("https://teatroriachuelorio.com.br/contato/", "contact", "the contact page, \"CONTATO\" in its menu (#12)"),
    "b2-br-edu-i": ("https://www.unip.br/cursos/graduacao/index.aspx", "info",
                    "the undergraduate page, \"Graduação\" in its menu (#57); pick.py's first proposal, \"Segunda Graduação\" (#49), is the "
                    "programme for people who already hold a degree"),
    "b2-br-gov-i": ("https://www.tjto.jus.br/ouvidoria", "contact", "the ombudsman page, \"OUVIDORIA\" in its menu (#15)"),
    "b2-br-health-i": ("https://aborlccf.org.br/publicado-edital-do-exame-de-suficiencia-para-obtencao-do-titulo-do-certificado-de-area-de-atuacao-em-foniatria/",
                       "article", "the first post in its content (#66, a notice posted in its news feed)"),
    "b2-br-news-i": ("https://www.agencialupa.org/reportagem/2026/11/24/desinformacao-sobre-mpox-alimenta-ataques-contra-comunidade-lgbtqia-nas-redes/",
                     "article", "the site redirects to agencialupa.org, Agência Lupa's own domain (on no other slot and not excluded: cleared), so "
                     "the listing was taken there: the first article in its content (#34)"),
    "b2-br-shop-i": ("https://www.lojaspompeia.com/feminino/Convencional?map=category-1,confeccao", "listing",
                     "the first product category of its menu, women's clothing, \"Ver tudo\" under \"Feminino\" (#23; its query string chooses "
                     "the category: kept)"),
    "b2-in-culture-i": ("https://www.donmarwarehouse.com/contact-us", "contact", "the contact page, \"Contact Us\" in its menu (#27)"),
    "b2-in-edu-i": ("https://www.ljmu.ac.uk/study/undergraduate-students", "info", "the undergraduate page, \"Undergraduate study with LJMU\" in its menu (#7)"),
    "b2-in-gov-i": ("https://www.rcvs.org.uk/veterinary-professionals/registration/check-our-registers", "form",
                    "the search form the pool names (the RCVS register), taken at its redirect's target on the same site"),
    "b2-in-health-i": ("https://prostatecanceruk.org/about-us/news-and-views/2026/09/5-million-risk-checks", "article",
                       "the first news story in its content (#247); pick.py's first proposal (#237) is a mailing-list sign-up"),
    "b2-in-news-i": ("https://www.westernpeople.ie/news/mayo-womans-london-restaurant-proves-a-hit_arid-20333955.html", "article",
                     "the first article in its content (#65)"),
    "b2-in-shop-i": ("https://www.reiss.com/womens", "listing",
                     "the first product category of its menu, \"WOMEN\" (#6); pick.py's first proposal (#2) is the help centre"),
    "b3-br-culture-i": ("https://www.auditorioibirapuera.com.br/contato/", "contact",
                        "the contact page, \"Contato\" in its menu (#38); the site's address redirects to its questions-and-answers page"),
    "b3-br-edu-i": ("https://estacio.br/graduacao-principais", "info", "the undergraduate page, \"Graduação\" in its header (#7)"),
    "b3-br-gov-i": ("https://www.mpac.mp.br/atendimento-ao-cidadao/ouvidoria/", "contact", "the ombudsman page, \"Ouvidoria-Geral\" in its menu (#37)"),
    "b3-br-health-i": ("https://sbhepatologia.org.br/noticias/anuidade-2026-com-desconto-ate-dia-31-de-marco/", "article",
                       "the first post in its content (#51, a post in its news feed about the membership fee); pick.py's first proposal, the "
                       "September bulletin (#50), redirects to the bulletin's page viewer (data/screen-6.json), a document, not a post; the "
                       "video pages before it are not articles"),
    "b3-br-news-i": ("https://neofeed.com.br/economia/fatura-da-revolucao-das-baterias-pode-chegar-pela-conta-de-luz/", "article",
                     "the first article in its content (#32, an image link with no text for headless Edge; data/screen-11.json)"),
    "b3-br-shop-i": ("https://www.lojasrede.com.br/cabelos", "listing",
                     "the first product category of its menu, \"Cabelos\" (#6); pick.py's first proposal, \"Salão\" (#4), is the salon's booking page"),
    "b3-in-culture-i": ("https://www.bridgetheatre.co.uk/en-GB/contact-us", "contact", "the contact page, \"Contact Us\" (#19, footer)"),
    "b3-in-edu-i": ("https://www.londonmet.ac.uk/courses/undergraduate/", "info", "the undergraduate page, \"Undergraduate courses\" in its menu (#9)"),
    "b3-in-gov-i": ("https://www.osteopathy.org.uk/register-search/", "form", "the search form the pool names (the General Osteopathic Council's register search)"),
    "b3-in-health-i": ("https://www.pancreaticcancer.org.uk/news-and-blogs/study-launched-to-improve-consistency-in-diagnosis-and-treatment/", "article",
                       "the first news story in its content (#81); pick.py's proposals before it are a reference page (#72) and the stories' "
                       "section page (#73)"),
    "b3-in-news-i": ("https://www.southernstar.ie/entertainment/skibbereen-talent-encouraged-to-apply-to-brand-new-tv-show-4382148", "article",
                     "the first article in its content (#65); pick.py's first proposal (#64) is a podcast episode"),
    "b3-in-shop-i": ("https://bargaintown.ie/collections/mattresses", "listing",
                     "the first product category of its menu, \"Mattresses\" (#11; data/screen-9.json)"),
}
HOME_NOTES = {
    "b1-br-edu-h": "https://www.ufcspa.edu.br/ timed out in the first screen and passed when screened again (data/screen-2.json)",
    "b2-br-health-h": "https://www.hospitalsamaritano.org.br/ redirects to hospitalbomsamaritano.org.br, the hospital's own domain (on no other slot and not excluded; cleared)",
    "b3-br-culture-h": ("https://www.museudaenergia.org.br/ redirects to energiaesaneamento.org.br, Fundação Energia e Saneamento, the body that runs "
                        "the Museu da Energia (on no other slot and not excluded; cleared)"),
    "b3-br-health-h": "https://www.hospitalsantacruz.com.br/ redirects to hjsc.com.br, Hospital Japonês Santa Cruz's own domain (on no other slot and not excluded; cleared)",
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
    assert len(rows) == 72
    with open(os.path.join(HERE, "scripts", "selection.tsv"), "w", encoding="utf-8", newline="\n") as f:
        f.write("# slot\tchosen\turl\tpageType\twhy\n")
        f.write("# The ninth study's choice, slot by slot, made on 2026-11-25 by the rules of scripts/candidates.tsv from the screens\n"
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
        return f"did not load in two tries ({v[9:].split(' at ')[0].replace('page.goto: ', '').replace('page.evaluate: ', '')})"
    if v == "challenge":
        return "showed headless Edge a bot check"
    if v.startswith("empty"):
        return f"showed headless Edge almost nothing ({v[6:]})"
    if v.startswith("language"):
        return f"declares another language ({v[9:]})"
    if v.startswith("redirect to"):
        return f"redirects to {v[12:]}"
    return v


if __name__ == "__main__":
    main()
