"""Write scripts/pages.tsv, the fifth study's format, from the slot-by-slot choice in scripts/selection.tsv.

selection.tsv: slot, the candidate chosen (its slot name in scripts/candidates.tsv, such as b1-br-gov-i.b1), the
page's URL, its type (home, article, listing, info, contact, form) and why it was chosen (the candidates before it that
failed, and how the inner page was picked). Region, category and language come from the slot; the country of an
international site from the table below, a Brazilian one is BR.

  python -I -B study/round-6-2026-10-29/scripts/build_pages.py
"""

import os
import re
from urllib.parse import urlsplit

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CATEGORY = {"gov": "government", "edu": "education", "news": "news", "shop": "e-commerce", "health": "health",
            "culture": "culture"}
# The country of each international candidate's site (where it is based), by host without "www.".
US = """colorado.gov utah.gov boston.gov maine.gov seattle.gov nc.gov wa.gov phila.gov vermont.gov cpsc.gov va.gov
medicare.gov msc.fema.gov sec.gov osha.gov banks.data.fdic.gov umich.edu purdue.edu wisc.edu cornell.edu brown.edu
rutgers.edu duke.edu osu.edu ucla.edu unc.edu bu.edu tufts.edu northeastern.edu seattletimes.com denverpost.com
texastribune.org oregonlive.com calmatters.org axios.com thehill.com nola.com rei.com llbean.com crateandbarrel.com
landsend.com uncommongoods.com williams-sonoma.com containerstore.com chewy.com backcountry.com sweetwater.com
massgeneral.org massgeneralbrigham.org chop.edu houstonmethodist.org seattlechildrens.org uchealth.org lung.org nami.org cancer.net
kidshealth.org lls.org marchofdimes.org philamuseum.org mfa.org lacma.org fieldmuseum.org clevelandart.org
denverartmuseum.org carnegiehall.org steppenwolf.org guthrietheater.org bam.org publictheater.org""".split()
IE = """corkcity.ie fingal.ie galwaycity.ie limerick.ie propertypriceregister.ie core.cro.ie ndber.seai.ie ucc.ie
maynoothuniversity.ie tudublin.ie mtu.ie atu.ie setu.ie tus.ie irishmirror.ie echolive.ie newstalk.com dublinlive.ie
agriland.ie limerickleader.ie joe.ie donegaldaily.com connachttribune.ie harveynorman.ie arnotts.ie easons.com avoca.com
mcelhinneys.com brownthomas.com dunnesstores.com woodies.ie powercity.ie smythstoys.com dids.ie beaumont.ie mater.ie
stjames.ie rotunda.ie stvincents.ie childrenshealthireland.ie cancer.ie alzheimer.ie irishheart.ie pieta.ie asthma.ie
arthritisireland.ie aware.ie imma.ie chesterbeatty.ie museum.ie hughlane.ie crawfordartgallery.ie epicchq.com nch.ie
gatetheatre.ie druid.ie wexfordopera.com corkoperahouse.ie projectartscentre.ie gaietytheatre.ie""".split()


def country(url):
    host = re.sub(r"^www\.", "", urlsplit(url).hostname or "")
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
