"""Which sites the seventh real-page study may not use, and whether each candidate is clear of them.

The sixth study's exclusions.py (study/round-6-2026-10-29/scripts/exclusions.py), extended rather than rebuilt: the sixth
study's files name every site of its 24 candidate pools, and the seventh study draws its pages from the pools' leftovers
(pre-registration, section 2), so a rebuild over every file of the repository would exclude them all. A registrable
domain (the Public Suffix List's rule) is excluded when it is in any of these sets:

- base: the sixth study's data/excluded-domains.json (built on 2026-10-29 at 0bada65: the first to fifth studies' pages,
  the re-measure's, the robustness study's 53 sites, every host any file of any branch, tag or remote-tracking ref or any
  commit message named then, and every host on a line any commit had added);
- round6Pages: every page the sixth study chose at any point (scripts/pages.tsv and scripts/rescreen.tsv: the 72 it ran
  on and the four it replaced, graacc.org.br, santacasabh.org.br, calmatters.org and rsc.org.uk);
- round6Files: every host the sixth study's own files name (its reports, packets, labels, prompts and data), except the
  files that list its candidates and the screen's results (CANDIDATE_FILES below), where a host named only as a pool
  candidate stays usable;
- since0bada65: every host on a line any commit reachable from any ref added since 0bada65, outside the sixth and seventh
  studies' folders, and every commit message since 0bada65 (the human-review packages, merged after 0bada65, are here);
- humanReview: every host named by any file in the main checkout's study/human-review-2026-10/ (read only; the
  reviewers' label files there are untracked).

As in the sixth study, a candidate whose registrable domain shares its first label with an excluded one is flagged for a
look by hand.

  python -I exclusions.py <public_suffix_list.dat> build            writes data/excluded-domains.json
  python -I exclusions.py <public_suffix_list.dat> check <tsv>...   checks each URL of the candidate files

Run from the repository root (the round-7 worktree).
"""

import hashlib
import json
import os
import re
import subprocess
import sys
from urllib.parse import urlsplit

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
R6 = "study/round-6-2026-10-29"
R7 = "study/round-7-2026-11-21"
BASE = "0bada65"
MAIN_HUMAN_REVIEW = "C:/Users/guilh/dev/rampa-cli/study/human-review-2026-10"
CANDIDATE_FILES = [f"{R6}/{p}" for p in (
    "scripts/pools.tsv", "scripts/candidates.tsv", "scripts/candidates-inner.tsv", "scripts/candidates-inner-2.tsv",
    "scripts/candidates-inner-3.tsv", "scripts/candidates-inner-retry.tsv", "scripts/candidates-retry.tsv",
    "scripts/candidates-replace.tsv", "scripts/rescreen.tsv", "scripts/selection.tsv", "scripts/pages.tsv",
    "scripts/build_pages.py", "scripts/deal.py", "data/screen-1.json", "data/screen-2.json", "data/screen-3.json",
    "data/screen-4.json", "data/screen-5.json", "data/screen-6.json", "data/screen-7.json", "data/screen-8.json",
    "data/screen-9.json", "data/excluded-domains.json", "data/pages-input.json", "preregistration.md",
    "run-log-notes.txt", "collect-log.txt")]
TOKEN = re.compile(r"[a-z0-9][a-z0-9.-]*\.[a-z]{2,}", re.I)


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
        host = (host or "").lower().strip(".")
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


def domains(psl, text):
    out = set()
    for m in TOKEN.finditer(text):
        reg = psl.registrable(m.group(0).strip(".-"))
        if reg:
            out.add(reg)
    return out


def tsv_urls(path):
    urls = []
    for line in open(path, encoding="utf-8"):
        if line.strip() and not line.startswith("#"):
            urls += [c for c in line.rstrip("\n").split("\t") if c.startswith("http")][:1]
    return urls


def build(psl):
    base = json.load(open(f"{R6}/data/excluded-domains.json", encoding="utf-8"))
    base_set = set(base["studyPages"]) | set(base["namedByRepository"]) | set(base.get("namedInHistoryOnly", []))
    round6_pages = sorted({psl.registrable(urlsplit(u).hostname) for f in ("scripts/pages.tsv", "scripts/rescreen.tsv")
                           for u in tsv_urls(f"{R6}/{f}")})
    # The sixth study's own files, but for those that list its candidates and the screen's results.
    excludes = [f":(exclude){p}" for p in CANDIDATE_FILES]
    out = git("grep", "-I", "-o", "-i", "-E", TOKEN.pattern, "HEAD", "--", R6, *excludes)
    round6_files = set()
    for line in out.splitlines():
        parts = line.split(":", 2)
        if len(parts) == 3:
            reg = psl.registrable(parts[2].strip(".-"))
            if reg:
                round6_files.add(reg)
    # Every line added since 0bada65 on any ref, outside the sixth and seventh studies' folders, and every commit message.
    since = set()
    proc = subprocess.Popen(["git", "log", "--all", "--not", BASE, "-p", "--no-color", "--format=", "--", ".",
                             f":(exclude){R6}", f":(exclude){R7}", ":(exclude)pnpm-lock.yaml"],
                            stdout=subprocess.PIPE, text=True, encoding="utf-8", errors="replace")
    for line in proc.stdout:
        if line.startswith("+") and not line.startswith("+++"):
            since |= domains(psl, line)
    proc.wait()
    since |= domains(psl, git("log", "--all", "--not", BASE, "--format=%B"))
    # The main checkout's human-review folder, read only (its label files are untracked there).
    human = set()
    for root, _, files in os.walk(MAIN_HUMAN_REVIEW):
        for name in files:
            path = os.path.join(root, name)
            try:
                with open(path, encoding="utf-8") as f:
                    human |= domains(psl, f.read())
            except (UnicodeDecodeError, OSError):
                continue
    refs = [r for r in git("for-each-ref", "--format=%(refname)", "refs/heads", "refs/tags", "refs/remotes").split()
            if not r.endswith("/HEAD")]
    result = {
        "note": ("Registrable domains the seventh study may not use (scripts/exclusions.py, pre-registration section 2): the "
                 "sixth study's list, every page the sixth study chose, every host its own files name outside the files "
                 "that list its candidates, every host on a line added since 0bada65 outside the sixth and seventh studies' "
                 "folders or in a commit message since, and every host the human-review folder names."),
        "publicSuffixList": {"url": "https://publicsuffix.org/list/public_suffix_list.dat", "fetched": "2026-11-21",
                             "sha256": hashlib.sha256(open(psl.path, "rb").read()).hexdigest()},
        "head": git("rev-parse", "HEAD").strip(),
        "refs": {ref: git("rev-parse", "--short", ref).strip() for ref in refs},
        "base": {"file": f"{R6}/data/excluded-domains.json", "domains": len(base_set)},
        "round6Pages": round6_pages,
        "round6Files": sorted(round6_files - base_set - set(round6_pages)),
        "since0bada65": sorted(since - base_set - set(round6_pages) - round6_files),
        "humanReview": sorted(human - base_set - set(round6_pages) - round6_files - since),
        "candidateFilesNotScanned": CANDIDATE_FILES,
    }
    path = os.path.join(HERE, "data", "excluded-domains.json")
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(result, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print(f"base {len(base_set)}; round 6 pages {len(round6_pages)}; more named by round 6's files {len(result['round6Files'])}; "
          f"more named since {BASE} {len(result['since0bada65'])}; more named by the human-review folder {len(result['humanReview'])}")


def excluded_set():
    ex = json.load(open(os.path.join(HERE, "data", "excluded-domains.json"), encoding="utf-8"))
    base = json.load(open(ex["base"]["file"], encoding="utf-8"))
    sets = {"base": set(base["studyPages"]) | set(base["namedByRepository"]) | set(base.get("namedInHistoryOnly", []))}
    for k in ("round6Pages", "round6Files", "since0bada65", "humanReview"):
        sets[k] = set(ex[k])
    return sets


def check(psl, files):
    sets = excluded_set()
    excluded = set().union(*sets.values())

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
                status = "EXCLUDED (" + ", ".join(k for k, s in sets.items() if reg in s) + ")"
                bad += 1
            elif name(reg) in first_labels:
                status = "look: same name as " + ", ".join(sorted(first_labels[name(reg)])[:4])
            print(f"{cols[0]:18} {reg:32} {status}")
    print("excluded:", bad)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    psl = PSL(sys.argv[1])
    if sys.argv[2] == "build":
        build(psl)
    else:
        check(psl, sys.argv[3:])
