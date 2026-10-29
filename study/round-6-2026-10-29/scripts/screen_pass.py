"""Apply the screen rules of scripts/candidates.tsv to the screen's files, slot by slot.

For each candidate, the first rule it fails, in this order: a network error or time-out ("network"), a final HTTP status
of 400 or more, a bot challenge, a geographic block, a page under 200 characters of text or with fewer than 5 links
("empty"), the wrong language (a Brazilian slot's page whose lang does not start with "pt", an international one's that
does not start with "en"), a final address on another registrable domain that is excluded or that another candidate
holds ("redirect"). What a rule cannot decide alone is flagged for a look by eye, with the reason: an error word in the
title, a missing lang, a redirect to another domain, a password field on a short page, a wall phrase. A slot's choice
is its first candidate that fails nothing and whose flags were cleared by that look (scripts/pages.tsv says how).

Later screens of the same candidates (a retry after a network error, inner pages) override earlier ones.

  python -I -B screen_pass.py <public_suffix_list.dat> <screen.json>...
"""

import json
import os
import sys
from urllib.parse import urlsplit

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from exclusions import PSL  # noqa: E402

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def verdict(psl, r, excluded, holders):
    if r.get("error"):
        return "network: " + r["error"][:60], []
    if (r.get("status") or 0) >= 400:
        return f"http {r['status']}", []
    if r.get("challenge"):
        return "challenge", []
    if r.get("geo"):
        return "geo: " + r["geo"], []
    if (r.get("textLength") or 0) < 200 or (r.get("links") or 0) < 5:
        return f"empty (text {r.get('textLength')}, links {r.get('links')})", []
    want = "pt" if r["slot"].split("-")[1] == "br" else "en"
    lang = (r.get("lang") or "").lower()
    flags = []
    if lang and not lang.startswith(want):
        return f"language {lang}", []
    if not lang:
        flags.append("no lang")
    own = psl.registrable(urlsplit(r["url"]).hostname)
    there = psl.registrable(urlsplit(r.get("finalUrl") or r["url"]).hostname or "")
    if there != own:
        if there in excluded:
            return f"redirect to excluded {there}", []
        if there in holders and holders[there] != r["slot"].split(".")[0]:
            return f"redirect to {there}, another slot's", []
        flags.append(f"redirect to {there}")
    if r.get("errorTitle"):
        flags.append("error word in title")
    if (r.get("password") or 0) and (r.get("textLength") or 0) < 2000:
        flags.append("password field on a short page")
    if r.get("wall"):
        flags.append("wall phrase")
    return "pass", flags


def main():
    psl = PSL(sys.argv[1])
    ex = json.load(open(os.path.join(HERE, "data", "excluded-domains.json"), encoding="utf-8"))
    excluded = set(ex["studyPages"]) | set(ex["namedByRepository"]) | set(ex.get("namedInHistoryOnly", []))
    order, urls = [], {}
    for line in open(os.path.join(HERE, "scripts", "candidates.tsv"), encoding="utf-8"):
        if line.strip() and not line.startswith("#"):
            slot, url = line.rstrip("\n").split("\t")
            order.append(slot)
            urls[slot] = url
    holders = {psl.registrable(urlsplit(u).hostname): s.split(".")[0] for s, u in urls.items()}
    results = {}
    for path in sys.argv[2:]:
        for r in json.load(open(path, encoding="utf-8")):
            results[(r["slot"], r["url"])] = r
    by_slot = {}
    for slot in order:
        r = results.get((slot, urls[slot]))
        base = slot.split(".")[0]
        if r is None:
            by_slot.setdefault(base, []).append((slot, urls[slot], "not screened", []))
            continue
        v, flags = verdict(psl, r, excluded, holders)
        by_slot.setdefault(base, []).append((slot, urls[slot], v, flags, r.get("title", ""), r.get("finalUrl", "")))
    for base, rows in by_slot.items():
        first = next((x for x in rows if x[2] == "pass"), None)
        print(f"{base:18} -> {first[0] if first else 'NONE'} {first[1] if first else ''} {'FLAGS: ' + '; '.join(first[3]) if first and first[3] else ''}")
        for x in rows:
            if first and x[0] == first[0]:
                break
            print(f"    {x[0]:20} {x[2]}  {x[1]}")


if __name__ == "__main__":
    main()
