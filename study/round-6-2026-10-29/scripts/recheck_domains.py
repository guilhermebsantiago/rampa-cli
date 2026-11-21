"""Check this study's 72 domains against what the repository added since the exclusions were built (0bada65): every line
added on every ref that moved since, outside this study's folder, and every commit message (pre-registration, section
2). Registrable domains by a suffix rule (the Public Suffix List file of 2026-10-29 is no longer on disk), plus a plain
substring search of each domain. Run from the repository root: python -I study/round-6-2026-10-29/scripts/recheck_domains.py
"""
import re, subprocess, sys, csv
sys.stdout.reconfigure(encoding="utf-8")
REPO = "."  # the repository root, where this runs
BASE = "0bada65"
SECOND = {"com","org","gov","edu","ac","co","nhs","net","jus","mp","art","ltd","plc","sch","police","mod","nic","tv","leg","def"}
STATES = {"ac","al","ap","am","ba","ce","df","es","go","ma","mt","ms","mg","pa","pb","pr","pe","pi","rj","rn","rs","ro","rr","sc","sp","se","to"}
def reg(host):
    labels = host.lower().strip(".").split(".")
    if len(labels) >= 4 and labels[-1] == "br" and labels[-2] == "gov" and labels[-3] in STATES:
        return ".".join(labels[-4:])
    if len(labels) >= 3 and len(labels[-1]) == 2 and labels[-2] in SECOND:
        return ".".join(labels[-3:])
    return ".".join(labels[-2:])
def git(*a):
    return subprocess.run(["git", "-C", REPO, *a], capture_output=True, text=True, encoding="utf-8", errors="replace").stdout
pages = []
with open(f"{REPO}/study/round-6-2026-10-29/scripts/pages.tsv", encoding="utf-8") as f:
    rows = list(csv.reader(f, delimiter="\t"))
head = rows[0]
ui = [i for i, h in enumerate(head) if h.lower() in ("url", "page")]
for r in rows[1:]:
    for c in r:
        if c.startswith("http"):
            pages.append(c); break
from urllib.parse import urlsplit
mine = {reg(urlsplit(u).hostname): u for u in pages}
print(len(pages), "pages,", len(mine), "registrable domains")
URL = re.compile(r"https?://([a-z0-9.-]+\.[a-z]{2,})", re.I)
BARE = re.compile(r"(?<![a-z0-9@/._-])((?:[a-z0-9-]+\.)+[a-z]{2,})(?![a-z0-9-])", re.I)
refs = [r for r in git("for-each-ref", "--format=%(refname)", "refs/heads", "refs/tags", "refs/remotes").split() if not r.endswith("/HEAD")]
moved = []
named = set(); hits = []
for ref in refs:
    if git("merge-base", "--is-ancestor", ref, BASE) == "" and subprocess.run(["git","-C",REPO,"merge-base","--is-ancestor",ref,BASE]).returncode == 0:
        continue
    moved.append(ref)
    diff = git("diff", BASE, ref, "--", ".", ":(exclude)study/round-6-2026-10-29")
    added = "\n".join(l[1:] for l in diff.splitlines() if l.startswith("+") and not l.startswith("+++"))
    msgs = git("log", f"{BASE}..{ref}", "--format=%B")
    text = added + "\n" + msgs
    hosts = set(m.group(1) for m in URL.finditer(text)) | set(m.group(1) for m in BARE.finditer(text))
    doms = {reg(h) for h in hosts}
    named |= doms
    low = text.lower()
    for d, u in mine.items():
        if d in doms or d in low:
            hits.append((ref, d, u))
print(len(refs), "refs;", len(moved), "moved since", BASE)
print(len(named), "registrable domains named on lines added since", BASE, "(outside this study's folder) and in commit messages")
print("hits:", len(hits))
for h in sorted(set(hits)): print(" ", *h)
print("sanity:", [d for d in ("hering.com.br","pucrs.br","lakeland.co.uk","gov.uk","w3.org") if d in named])
