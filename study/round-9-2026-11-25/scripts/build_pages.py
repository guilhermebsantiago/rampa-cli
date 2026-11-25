"""Write scripts/pages.tsv, the fifth to eighth studies' format, from the slot-by-slot choice in scripts/selection.tsv (the
eighth study's build_pages.py with the ninth study's country rule and 72 pages).

selection.tsv: slot, the candidate chosen (its slot name in scripts/candidates.tsv, such as b1-br-gov-i.b1), the
page's URL, its type (home, article, listing, info, contact, form) and why it was chosen (the candidates before it that
failed, and how the inner page was picked). Region, category and language come from the slot; the country of an
international site from the table below, a Brazilian one is BR.

  python -I -B study/round-9-2026-11-25/scripts/build_pages.py
"""

import os
import re
from urllib.parse import urlsplit

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CATEGORY = {"gov": "government", "edu": "education", "news": "news", "shop": "e-commerce", "health": "health",
            "culture": "culture"}
# The country of each international candidate's site (where it is based): .ie is Ireland; .gov, .edu and .us are the
# United States; everything else (.uk, .org, .com, .news and the rest) is the United Kingdom. Every chosen international
# page of this round is on one of those (no generic-domain site from the United States or Ireland was chosen), so the
# tables of the eighth study are empty here.
US = []
IE = []


def country(url):
    host = re.sub(r"^www\.", "", urlsplit(url).hostname or "")
    tld = host.rsplit(".", 1)[-1]
    if tld == "ie":
        return "IE"
    if tld in ("gov", "edu", "us"):
        return "US"
    for h in (host, ".".join(host.split(".")[1:])):
        if h in US:
            return "US"
        if h in IE:
            return "IE"
    return "UK"


def main():
    rows = []
    for line in open(os.path.join(HERE, "scripts", "selection.tsv"), encoding="utf-8"):
        if not line.strip() or line.startswith("#"):
            continue
        slot, chosen, url, page_type, why = line.rstrip("\n").split("\t")
        stratum = slot.split("-", 1)[1]
        region, cat = stratum.split("-")[0], stratum.split("-")[1]
        c = "BR" if region == "br" else country(url)
        lang = "pt-BR" if region == "br" else "en"
        rows.append("\t".join([slot, "br" if region == "br" else "intl", c, CATEGORY[cat], page_type, lang, url,
                               f"{'primary' if '.' not in chosen else 'backup ' + chosen.split('.')[1]}: {why}"]))
    assert len(rows) == 72, len(rows)
    with open(os.path.join(HERE, "scripts", "pages.tsv"), "w", encoding="utf-8", newline="\n") as f:
        f.write("# slot\tregion\tcountry\tcategory\tpageType\tlanguage\turl\tselection\n")
        f.write("\n".join(rows) + "\n")
    print(f"{len(rows)} pages")


if __name__ == "__main__":
    main()
