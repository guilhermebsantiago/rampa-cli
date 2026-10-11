"""What each option would report among the study's 38 labelled dev findings for 2.4.4 and 2.4.6.

The claims are the first run's (study/data/findings.json); the facts are read from today's snapshots of the same
dev pages (dev-facts.json). Usage: python -I dev_options.py <dev-facts.json>
"""
import json
import re
import sys
from collections import Counter

d = json.load(open(sys.argv[1], encoding="utf-8"))
OLD_LINKS = set("""click here|click|here|this|this link|link|read more|more|learn more|more info|more information|details|go|continue|see more|view more|find out more|clique aqui|clique|aqui|este link|saiba mais|leia mais|mais|ver mais|veja mais|mais informações|detalhes|acesse|acesse aqui|confira|haga clic aquí|clic aquí|aquí|leer más|más|ver más|más información|detalles""".split("|"))


def norm(text):
    return re.sub(r"[.:!…»›→>]+$", "", re.sub(r"\s+", " ", text.strip())).strip().lower()


def problem(row):
    m = row["message"]
    if "is an address" in m:
        return "url_or_filename"
    if "is shared by" in m:
        return "ambiguous"
    if "does not match" in m or "names a different" in m or "names different data" in m:
        return "mismatch"
    return "generic"


rows = []
for m in d["matched"]:
    f = m.get("facts") or {}
    kind = problem(m)
    text = m["evidence"]
    if m["criterion"] == "2.4.4":
        old_generic = norm(text) in OLD_LINKS
        # Today's verification: a mismatch needs a destination read that tells it apart (or a part of this page).
        verified = not (kind == "mismatch" and f.get("evidence") not in ("read", "same-page"))
        ambiguous = kind == "ambiguous" and bool(f.get("sameText")) and not f["sameText"]["apart"]
        # b0: a generic text grounds the claim whatever surrounds the link; b: only with no context of its own.
        grounded0 = (kind == "generic" and old_generic) or ambiguous
        grounded = (kind == "generic" and old_generic and not f.get("hasContext")) or ambiguous
    else:
        old_generic = bool(f.get("generic"))
        series_named = bool(f.get("series")) and bool(f.get("parent"))
        # Today's code judges the label people see ("CPF*", "Telefone*"), so these two claims no longer arise.
        hidden_name = m["slug"].startswith("www-sosma") and text in ("document", "phone")
        verified = not (kind == "generic" and series_named) and not hidden_name
        grounded0 = grounded = kind == "generic" and old_generic
    rows.append({**m, "problem": kind, "old_generic": old_generic, "verified": verified, "grounded0": grounded0, "grounded": grounded})

options = {
    "0 main, default threshold": lambda r: r["verified"] and r["old_generic"],
    "0 main, low counted": lambda r: r["verified"],
    "a facts only (rest never reported)": lambda r: r["verified"] and r["grounded"],
    "b0 facts as first written, rest to review": lambda r: r["verified"] and r["grounded0"],
    "b as built, rest to review": lambda r: r["verified"] and r["grounded"],
    "c generic list, rest to review": lambda r: r["verified"] and r["old_generic"],
}
review = {
    "b0 facts as first written, rest to review": lambda r: r["verified"] and not r["grounded0"],
    "b as built, rest to review": lambda r: r["verified"] and not r["grounded"],
    "c generic list, rest to review": lambda r: r["verified"] and not r["old_generic"],
}
for crit in ("2.4.4", "2.4.6"):
    mine = [r for r in rows if r["criterion"] == crit]
    print(f"== {crit}: {len(mine)} labelled findings ({Counter(r['final'] for r in mine)})")
    for name, keep in options.items():
        kept = [r for r in mine if keep(r)]
        c = Counter(r["final"] for r in kept)
        rv = sum(1 for r in mine if review.get(name, lambda r: False)(r))
        print(f"   {name:42} findings {len(kept):2}: TP {c['true_positive']} FP {c['false_positive']} unc {c['uncertain']}   review {rv}")
    for r in mine:
        print(f"      {r['final'][:5]} {r['problem']:15} old_generic={r['old_generic']!s:5} verified={r['verified']!s:5} grounded={r['grounded']!s:5} {r['evidence'][:60]!r}")
