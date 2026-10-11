"""Scores each design option from one `rampa eval` run of the new code (results.jsonl).

Options are gates over the same verified judgments:
  0   main before this change: findings on generic-list texts at the default threshold, every verified fail counted 'low'
  c   only generic-list texts are findings, every other fail is a review suggestion
  b   only fails a checked fact supports are findings (the new code), the rest are suggestions
  a   only fact-backed fails are findings, the rest are never reported
Usage: python -I options.py <results.jsonl>
"""
import json
import re
import sys

OLD_LINKS = set("""click here|click|here|this|this link|link|read more|more|learn more|more info|more information|details|go|continue|see more|view more|find out more|clique aqui|clique|aqui|este link|saiba mais|leia mais|mais|ver mais|veja mais|mais informações|detalhes|acesse|acesse aqui|confira|haga clic aquí|clic aquí|aquí|leer más|más|ver más|más información|detalles""".split("|"))
ADDRESS = re.compile(r"^(https?://|www\.)\S+$|^[\w-]+\.(pdf|docx?|xlsx?|pptx?|zip|html?|php|aspx?)$", re.I)
NUMBERED_HEADING = re.compile(r"^(section|part|chapter|step|item|block|seção|secao|parte|capítulo|passo|bloco|sección|paso)\s*\d+$")
BARE_HEADINGS = {"title", "heading", "header", "subtitle", "untitled", "título", "titulo", "cabeçalho", "subtítulo", "sem título", "encabezado"}
BARE_LABELS = {"input", "text", "field", "value", "campo", "texto", "entrada", "valor", "valor 1"}


def norm(text):
    return re.sub(r"[.:!…»›→>]+$", "", re.sub(r"\s+", " ", text.strip())).strip().lower()


def old_generic(criterion, text):
    """The generic lists as they were before this change (placeholder phrases left out: none occur in these sets)."""
    value = norm(text)
    if criterion == "2.4.4":
        return value in OLD_LINKS or bool(ADDRESS.match(text.strip()))
    return bool(NUMBERED_HEADING.match(value)) or value in BARE_HEADINGS or value in BARE_LABELS or bool(re.match(r"^(field|input|campo|entrada)\s*\d+$", value)) or bool(re.match(r"^lorem ipsum", value))


def subject(message):
    m = re.search(r'"(.*)"', message)
    return m.group(1) if m else ""


records = [json.loads(line) for line in open(sys.argv[1], encoding="utf-8") if line.strip()]
records = [r for r in records if not r.get("error")]


def claims(r):
    """Every verified judgment fail on the page: (text, grounded, grounded without the word rule)."""
    out = []
    for f in r["findings"]:
        if f["source"] != "judgment":
            continue
        text = subject(f["message"]) or f.get("evidence") or ""
        generic_claim = "does not tell where" in f["message"] or "says nothing" in f["message"] or "does not say what to enter" in f["message"]
        out.append((text, True, not (generic_claim and r["criterion"] == "2.4.4" and not old_generic("2.4.4", text))))
    out += [(subject(s["message"]), False, False) for s in r.get("suggestions") or []]
    return out


def verdict(r, option, count_review):
    if r["baseline"] == "failed":
        return True
    cs = claims(r)
    if option == "0-default" or option == "c":
        fail = any(old_generic(r["criterion"], text) for text, _, _ in cs)
        review = any(not old_generic(r["criterion"], text) for text, _, _ in cs)
    elif option == "0-low":
        fail, review = bool(cs), False
    elif option == "b0":
        fail, review = any(g0 for _, _, g0 in cs), any(not g0 for _, _, g0 in cs)
    elif option == "b":
        fail, review = any(g for _, g, _ in cs), any(not g for _, g, _ in cs)
    elif option == "a":
        fail, review = any(g for _, g, _ in cs), False
    return fail or (count_review and review)


def score(subset, option, count_review):
    tp = sum(1 for r in subset if r["expected"] == "failed" and verdict(r, option, count_review))
    fp = sum(1 for r in subset if r["expected"] != "failed" and verdict(r, option, count_review))
    fn = sum(1 for r in subset if r["expected"] == "failed" and not verdict(r, option, count_review))
    p = tp / (tp + fp) if tp + fp else None
    rc = tp / (tp + fn) if tp + fn else None
    return tp, fp, fn, p, rc


def fmt(x):
    return "  —  " if x is None else f"{x:5.2f}"


OPTIONS = [("0-default", False), ("0-low", False), ("c", False), ("c", True), ("a", False), ("b0", False), ("b", False), ("b", True)]
print(f"{'set':34}" + "".join(f"{o + ('+rev' if rv else ''):>16}" for o, rv in OPTIONS))
for criterion in sorted({r["criterion"] for r in records}):
    mine = [r for r in records if r["criterion"] == criterion]
    for rule in sorted({r["ruleId"] for r in mine if r["set"] == "act"}):
        subset = [r for r in mine if r["set"] == "act" and r["ruleId"] == rule]
        cells = []
        for o, rv in OPTIONS:
            tp, fp, fn, p, rc = score(subset, o, rv)
            cells.append(f"{tp:>3}/{tp + fn:<3}fp{fp:<2} P{fmt(p)}"[:16].rjust(16))
        print(f"{criterion} ACT {rule} (n={len(subset)})".ljust(34) + "".join(cells))
    for corruptor in sorted({r.get("corruptor") for r in mine if r["set"] == "pair-corrupted"}):
        bad = [r for r in mine if r["set"] == "pair-corrupted" and r.get("corruptor") == corruptor]
        cells = []
        for o, rv in OPTIONS:
            told = 0
            for b in bad:
                good = next((g for g in mine if g["set"] != "pair-corrupted" and g["testcaseId"] == b["testcaseId"]), None)
                if good and not verdict(good, o, rv) and verdict(b, o, rv):
                    told += 1
            cells.append(f"{told}/{len(bad)}".rjust(16))
        print(f"{criterion} pairs {corruptor}".ljust(34) + "".join(cells))
