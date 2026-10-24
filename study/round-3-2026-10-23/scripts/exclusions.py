"""Which sites the third real-page study may not use, and whether each candidate is clear of them.

A candidate is excluded when its registrable domain (the Public Suffix List's rule: www.ce.gov.br and
metro.sp.gov.br are registrable domains, since ce.gov.br and sp.gov.br are public suffixes) is one that:

- a page of the first study (study/scripts/pages-input.json), its re-measure (study/remeasure-2026-10-09)
  or the second study (study/fresh-2026-10-11/scripts/pages.tsv) used, or
- any host the repository names: every file git tracks, on every branch, and every commit message
  (`git grep` and `git log --all`), as the second study excluded every host the repository named.

As a second check, a candidate whose registrable domain shares its first label with an excluded one
(chicorei.com and chicorei.com.br) is flagged for a look by hand.

  python -I exclusions.py <public_suffix_list.dat> build            writes data/excluded-domains.json
  python -I exclusions.py <public_suffix_list.dat> check <tsv>...   checks each URL of the candidate files

Run from the repository root.
"""

import json
import os
import re
import subprocess
import sys
from urllib.parse import urlsplit

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = re.compile(r"https?://([a-z0-9.-]+\.[a-z]{2,})", re.I)
BARE = re.compile(r"(?<![a-z0-9@/._-])((?:[a-z0-9-]+\.)+[a-z]{2,})(?![a-z0-9-])", re.I)


class PSL:
    def __init__(self, path):
        self.path = path
        self.rules, self.exceptions, self.wild = set(), set(), set()
        for line in open(path, encoding="utf-8"):
            line = line.strip()
            if not line or line.startswith("//"):
                continue
            line = line.split()[0]
            if line.startswith("!"):
                self.exceptions.add(line[1:])
            elif line.startswith("*."):
                self.wild.add(line[2:])
            else:
                self.rules.add(line)
        self.tlds = {r for r in self.rules if "." not in r}

    def registrable(self, host):
        host = host.lower().strip(".")
        labels = host.split(".")
        if len(labels) < 2 or labels[-1] not in self.tlds:
            return None
        suffix_len = 1
        for i in range(len(labels)):
            cand = ".".join(labels[i:])
            if cand in self.exceptions:
                suffix_len = len(labels) - i - 1
                break
            if cand in self.rules:
                suffix_len = max(suffix_len, len(labels) - i)
            if i + 1 < len(labels) and ".".join(labels[i + 1:]) in self.wild:
                suffix_len = max(suffix_len, len(labels) - i)
        if len(labels) <= suffix_len:
            return None
        return ".".join(labels[-(suffix_len + 1):])


def git(*args):
    return subprocess.run(["git", *args], capture_output=True, text=True, encoding="utf-8", errors="replace").stdout


def hosts_in(text, bare=True):
    out = {m.group(1).lower() for m in URL.finditer(text)}
    if bare:
        out |= {m.group(1).lower() for m in BARE.finditer(text)}
    return out


def study_urls():
    urls = []
    d = json.load(open(os.path.join("study", "scripts", "pages-input.json"), encoding="utf-8"))
    urls += [p["url"] for p in d["pages"]]
    d = json.load(open(os.path.join("study", "remeasure-2026-10-09", "data", "pages.json"), encoding="utf-8"))
    urls += [p["url"] for p in d]
    for line in open(os.path.join("study", "fresh-2026-10-11", "scripts", "pages.tsv"), encoding="utf-8"):
        if line.strip() and not line.startswith("#"):
            urls.append(line.split("\t")[6])
    return urls


def build(psl):
    studies = {}
    for url in study_urls():
        reg = psl.registrable(urlsplit(url).hostname)
        studies.setdefault(reg, []).append(url)
    named = {}
    branches = [b.strip() for b in git("for-each-ref", "--format=%(refname)", "refs/heads").splitlines() if b.strip()]
    for ref in branches:
        # Every token shaped like a host name in every text file of the branch (git grep skips binary files).
        out = git("grep", "-I", "-o", "-i", "-E", r"[a-z0-9][a-z0-9.-]*\.[a-z]{2,}", ref, "--", ".", ":!pnpm-lock.yaml")
        for line in out.splitlines():
            parts = line.split(":", 2)
            if len(parts) < 3:
                continue
            reg = psl.registrable(parts[2].strip(".-"))
            if reg:
                named.setdefault(reg, set()).add(parts[1])
    for h in hosts_in(git("log", "--all", "--format=%B")):
        reg = psl.registrable(h)
        if reg:
            named.setdefault(reg, set()).add("(commit message)")
    import hashlib
    out = {
        "note": "Registrable domains the third study may not use: the earlier studies' pages, and every host the repository names on any branch or in any commit message.",
        "publicSuffixList": {"url": "https://publicsuffix.org/list/public_suffix_list.dat", "fetched": "2026-10-23",
                             "sha256": hashlib.sha256(open(psl.path, "rb").read()).hexdigest()},
        "head": git("rev-parse", "HEAD").strip(),
        "branches": branches,
        "studyPages": {k: v for k, v in sorted(studies.items())},
        "namedByRepository": sorted(named),
    }
    path = os.path.join(HERE, "data", "excluded-domains.json")
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print(f"{len(studies)} study domains, {len(named)} domains named by the repository, {len(branches)} branches")


def check(psl, files):
    ex = json.load(open(os.path.join(HERE, "data", "excluded-domains.json"), encoding="utf-8"))
    excluded = set(ex["studyPages"]) | set(ex["namedByRepository"])
    def name(d):
        labels = d.split(".")
        return labels[1] if labels[0] == "www" and len(labels) > 2 else labels[0]
    first_labels = {}
    for d in excluded:
        first_labels.setdefault(name(d), []).append(d)
    bad = 0
    for path in files:
        for line in open(path, encoding="utf-8"):
            if not line.strip() or line.startswith("#"):
                continue
            cols = line.rstrip("\n").split("\t")
            url = next((c for c in cols if c.startswith("http")), None)
            if not url:
                continue
            reg = psl.registrable(urlsplit(url).hostname)
            status = "ok"
            if reg in excluded:
                status = "EXCLUDED (" + ("study page" if reg in ex["studyPages"] else "named by the repository") + ")"
                bad += 1
            elif name(reg) in first_labels:
                status = "look: same name as " + ", ".join(first_labels[name(reg)])
            print(f"{cols[0]:16} {reg:32} {status}")
    print("excluded:", bad)


if __name__ == "__main__":
    psl = PSL(sys.argv[1])
    if sys.argv[2] == "build":
        build(psl)
    else:
        check(psl, sys.argv[3:])
