"""Propose an inner page for an inner slot, from the links scripts/links.mjs listed on the site's home page.

The rules are the ones scripts/candidates.tsv fixed before the screen. This applies them to the listing, in page
order, on the site's own registrable domain (subdomains count), and prints the first link that matches, with the next
two that would, so that the person choosing confirms it or writes down why not (scripts/pages.tsv). One reading was
added after the first block's listings were seen and before any pick was fixed: an article is a link in the page's
content, not in its header, navigation or footer (an evergreen page linked from a menu is not the first story), and a
store's category is a link in its header or navigation (its main menu), or, on a page whose header and navigation hold
no category link, the page's first category link. A promotion ("20% off ...") is not a category.

- article (news, health): a link in the page's content whose last path segment is a slug of 4 or more words (or 3
  words and a number of 4 or more digits, or a dated path, or a numeric id of 5 or more digits after a slug), and no
  path segment names a section, tag, author, category, video, gallery, podcast, newsletter, search, login or
  subscription page;
- category (e-commerce): a link with text in the header or navigation, whose path is one to three segments and names no
  account, cart, help, store finder, blog, about, careers, gift card, app, legal, contact, search or promotion page
  ("sale", "ofertas", "new in", "outlet", brands);
- undergraduate (education): its text says "Graduação" or "Undergraduate" (not "Pós-graduação", "Postgraduate");
- ombudsman (Brazilian government): its text says "Ouvidoria"; if none does, "Fale conosco", "Contato" or
  "Atendimento";
- contact (culture): its text says "Contato", "Fale conosco", "Contact", "Contact us" or "Get in touch", or its last path
  segment is the contact page ("contact", "contact-us", "contato", "fale-conosco", "get-in-touch"); the same path test
  applies to the ombudsman rule ("ouvidoria", then the contact page).

  python -I -B pick.py <public_suffix_list.dat> <rule> <site url> <links.txt>
"""

import os
import re
import sys
from urllib.parse import urlsplit

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from exclusions import PSL  # noqa: E402

NOT_ARTICLE = re.compile(r"/(tags?|topics?|topicos?|temas?|authors?|autor(es)?|colunistas?|category|categories|categoria|"
                         r"section|secao|editorias?|videos?|galer(y|ia)|fotos?|podcasts?|newsletters?|search|busca|login|"
                         r"entrar|assine|subscribe|subscription|account|conta|live|ao-vivo|page|pagina|all-about|"
                         r"canais-especiais|especial|pagina-especial|whats-on|in-your-area|events?|eventos?|agenda|"
                         r"cursos?|courses?|services?|servicos?|donate|doe|doacao)(/|$)", re.I)
NOT_CATEGORY = re.compile(r"account|conta|login|entrar|cadastr|register|cart|carrinho|sacola|basket|bag\b|wishlist|favorit|"
                          r"help|ajuda|atendimento|customer|cliente|store-?finder|lojas|stores|our-shops|blog|about|sobre|"
                          r"institucional|careers|carreiras|trabalhe|gift|vale-?presente|cart[aã]o|card|app|download|privac|"
                          r"cookie|terms|termos|legal|contact|contato|faq|search|busca|sale|ofertas?|promo|outlet|liquida|"
                          r"black-?friday|new-?in|novidades|lan[cç]amentos|brands|marcas|track|rastre|delivery|entrega|"
                          r"frete|prime|club|clube|sparks|rewards|loyalty|inspira|ideas|ideias|\d+% off|% off|#|javascript", re.I)
UNDERGRAD = re.compile(r"\b(gradua[cç][aã]o|undergraduate)\b", re.I)
NOT_UNDERGRAD = re.compile(r"p[oó]s[- ]?gradua|postgraduate|post-graduate|\bgraduate study|\bgraduate school", re.I)
OMBUDSMAN = re.compile(r"\bouvidoria\b", re.I)
CONTACT_BR = re.compile(r"\b(fale conosco|contato|atendimento)\b", re.I)
CONTACT = re.compile(r"\b(contato|fale conosco|contact|contact us|get in touch)\b", re.I)
CONTACT_PATH = re.compile(r"(contact|contact-us|contacts|contato|contatos|fale-conosco|faleconosco|get-in-touch)(\.\w+)?", re.I)


def last(path):
    segs = [s for s in path.split("/") if s]
    return segs[-1].lower() if segs else ""


def article(path):
    if NOT_ARTICLE.search(path):
        return False
    segs = [s for s in path.split("/") if s]
    if not segs:
        return False
    seg = re.sub(r"\.(s?html?|php|aspx?|ghtml)$", "", segs[-1], flags=re.I)
    words = [w for w in re.split(r"[-_]+", seg) if w and not w.isdigit()]
    if len(words) >= 4:
        return True
    if len(words) >= 3 and re.search(r"\d{4,}", path):
        return True
    if re.search(r"/20\d\d/\d\d?/", path) and len(words) >= 2:
        return True
    if len(segs) >= 2 and re.fullmatch(r"\d{5,}", segs[-1]) and len(re.split(r"[-_]+", segs[-2])) >= 3:
        return True
    return False


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    psl = PSL(sys.argv[1])
    rule, site, listing = sys.argv[2], sys.argv[3], sys.argv[4]
    own = psl.registrable(urlsplit(site).hostname)
    rows = []
    for i, line in enumerate(open(listing, encoding="utf-8")):
        cols = line.rstrip("\n").split("\t")
        if len(cols) < 2:
            continue
        href, text, region = cols[0], cols[1].strip(), (cols[2] if len(cols) > 2 else "main")
        parts = urlsplit(href)
        if parts.scheme not in ("http", "https") or psl.registrable(parts.hostname or "") != own:
            continue
        rows.append((i + 1, href, text, parts.path or "/", region))
    if rule == "article":
        hits = [r for r in rows if r[4] == "main" and article(r[3])]
    elif rule == "category":
        def category(r):
            return r[2] and 1 <= len([s for s in r[3].split("/") if s]) <= 3 and not NOT_CATEGORY.search(r[3] + " " + r[2])
        # The main menu; on a page whose header and navigation hold no category link, the page's first category link.
        menu = [r for r in rows if r[4] in ("nav", "header")]
        hits = [r for r in (menu if any(category(r) for r in menu) else rows) if category(r)]
    elif rule == "undergraduate":
        hits = [r for r in rows if UNDERGRAD.search(r[2]) and not NOT_UNDERGRAD.search(r[2])]
    elif rule == "ombudsman":
        hits = ([r for r in rows if OMBUDSMAN.search(r[2]) or last(r[3]) == "ouvidoria"]
                or [r for r in rows if CONTACT_BR.search(r[2]) or CONTACT_PATH.fullmatch(last(r[3]))])
    elif rule == "contact":
        hits = [r for r in rows if CONTACT.search(r[2]) or CONTACT_PATH.fullmatch(last(r[3]))]
    else:
        raise SystemExit(f"unknown rule {rule}")
    head = f"{rule}\t{len(rows)} same-site links"
    if not hits:
        print(head + "\tno match")
        return
    print(head + "".join(f"\t#{h[0]} [{h[4]}] {h[1]} «{h[2][:50]}»" for h in hits[:3]))


if __name__ == "__main__":
    main()
