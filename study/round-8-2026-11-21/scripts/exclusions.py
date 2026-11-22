"""Which sites the eighth real-page study may not use, and whether each candidate is clear of them.

The seventh study's exclusions.py (study/round-7-2026-11-21/scripts/exclusions.py), extended rather than rebuilt. A
registrable domain (the Public Suffix List's rule) is excluded when it is in any of these sets:

- round7List: every domain of the seventh study's data/excluded-domains.json (its base, the sixth study's list built on
  2026-10-29 at 0bada65: the first to fifth studies' pages, the re-measure's, the robustness study's and every host the
  repository named then; and its own additions: the sixth study's chosen pages, the hosts the sixth study's files name
  outside its candidate lists, the hosts on lines added since 0bada65 and in commit messages, the human-review folder);
- round7Pages: every page the seventh study chose (its scripts/pages.tsv: 60; it replaced none during collection);
- round6Pools: every site of the sixth study's 24 pools (study/round-6-2026-10-29/scripts/pools.tsv): the seventh
  study dealt all their leftovers, so none is a new candidate;
- studyFiles: every host named by any file of the sixth and seventh studies' folders at HEAD (both merged into this
  branch), the files that list their candidates and screen results included this time, and by every file of the
  seventh study's folder in its own worktree that git does not ignore there (its labels and logs written after the
  merge; read only);
- since0bada65: every host on a line any commit reachable from any ref added since 0bada65, outside the sixth, seventh
  and eighth studies' folders, and every commit message since 0bada65 (the seventh study's fix commits among them);
- humanReview: every host named by any file in the main checkout's study/human-review-2026-10/ (read only).

As before, a candidate whose registrable domain shares its first label with an excluded one is flagged for a look by
hand.

  python -I exclusions.py <public_suffix_list.dat> build            writes data/excluded-domains.json
  python -I exclusions.py <public_suffix_list.dat> check <tsv>...   checks each URL of the candidate files

Run from the repository root (the round-8 worktree).
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
R8 = "study/round-8-2026-11-21"
BASE = "0bada65"
R7_WORKTREE = "C:/Users/guilh/dev/rampa-cli/.claude/worktrees/round-7-run"
MAIN_HUMAN_REVIEW = "C:/Users/guilh/dev/rampa-cli/study/human-review-2026-10"
TOKEN = re.compile(r"[a-z0-9][a-z0-9.-]*\.[a-z]{2,}", re.I)
SETS = ("round7List", "round7Pages", "round6Pools", "studyFiles", "since0bada65", "humanReview")


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


def git(*args, cwd=None):
    return subprocess.run(["git", *args], capture_output=True, text=True, encoding="utf-8", errors="replace", cwd=cwd).stdout


def domains(psl, text):
    out = set()
    for m in TOKEN.finditer(text):
        reg = psl.registrable(m.group(0).strip(".-"))
        if reg:
            out.add(reg)
    return out


def tsv_urls(path, column=None):
    urls = []
    for line in open(path, encoding="utf-8"):
        if line.strip() and not line.startswith("#"):
            urls += [c for c in line.rstrip("\n").split("\t") if c.startswith("http")][:1]
    return urls


def read_text(path):
    try:
        with open(path, encoding="utf-8") as f:
            return f.read()
    except (UnicodeDecodeError, OSError):
        return ""


def build(psl):
    r7 = json.load(open(f"{R7}/data/excluded-domains.json", encoding="utf-8"))
    r6 = json.load(open(r7["base"]["file"], encoding="utf-8"))
    round7_list = (set(r6["studyPages"]) | set(r6["namedByRepository"]) | set(r6.get("namedInHistoryOnly", []))
                   | set(r7["round6Pages"]) | set(r7["round6Files"]) | set(r7["since0bada65"]) | set(r7["humanReview"]))
    round7_pages = sorted({psl.registrable(urlsplit(u).hostname) for u in tsv_urls(f"{R7}/scripts/pages.tsv")})
    round6_pools = sorted({psl.registrable(urlsplit(u).hostname) for u in tsv_urls(f"{R6}/scripts/pools.tsv")})
    # The sixth and seventh studies' files at HEAD, every file, and the seventh study's own worktree (read only).
    files = set()
    out = git("grep", "-I", "-o", "-i", "-E", TOKEN.pattern, "HEAD", "--", R6, R7)
    for line in out.splitlines():
        parts = line.split(":", 2)
        if len(parts) == 3:
            reg = psl.registrable(parts[2].strip(".-"))
            if reg:
                files.add(reg)
    r7_live = git("ls-files", "--cached", "--others", "--exclude-standard", "--", R7, cwd=R7_WORKTREE).split("\n")
    live_files = 0
    for rel in filter(None, r7_live):
        files |= domains(psl, read_text(os.path.join(R7_WORKTREE, rel)))
        live_files += 1
    # Every line added since 0bada65 on any ref, outside the sixth, seventh and eighth studies' folders, and every commit message.
    since = set()
    proc = subprocess.Popen(["git", "log", "--all", "--not", BASE, "-p", "--no-color", "--format=", "--", ".",
                             f":(exclude){R6}", f":(exclude){R7}", f":(exclude){R8}", ":(exclude)pnpm-lock.yaml"],
                            stdout=subprocess.PIPE, text=True, encoding="utf-8", errors="replace")
    for line in proc.stdout:
        if line.startswith("+") and not line.startswith("+++"):
            since |= domains(psl, line)
    proc.wait()
    since |= domains(psl, git("log", "--all", "--not", BASE, "--format=%B"))
    human = set()
    for root, _, names in os.walk(MAIN_HUMAN_REVIEW):
        for name in names:
            human |= domains(psl, read_text(os.path.join(root, name)))
    refs = [r for r in git("for-each-ref", "--format=%(refname)", "refs/heads", "refs/tags", "refs/remotes").split()
            if not r.endswith("/HEAD")]
    seen = set(round7_list)
    sets = {}
    for name, values in (("round7Pages", set(round7_pages)), ("round6Pools", set(round6_pools)), ("studyFiles", files),
                         ("since0bada65", since), ("humanReview", human)):
        sets[name] = sorted(values - seen)
        seen |= values
    result = {
        "note": ("Registrable domains the eighth study may not use (scripts/exclusions.py, pre-registration section 2): the "
                 "seventh study's list, its 60 pages, the sixth study's pools, every host the sixth and seventh studies' "
                 "files name, every host on a line added since 0bada65 outside the sixth to eighth studies' folders or in a "
                 "commit message since, and every host the human-review folder names. Each set lists only what the sets "
                 "before it lack."),
        "publicSuffixList": {"url": "https://publicsuffix.org/list/public_suffix_list.dat", "fetched": "2026-11-21",
                             "sha256": hashlib.sha256(open(psl.path, "rb").read()).hexdigest(),
                             "note": "the seventh study's copy of the same day"},
        "head": git("rev-parse", "HEAD").strip(),
        "round7WorktreeHead": git("rev-parse", "HEAD", cwd=R7_WORKTREE).strip(),
        "round7WorktreeFilesRead": live_files,
        "refs": {ref: git("rev-parse", "--short", ref).strip() for ref in refs},
        "round7List": {"file": f"{R7}/data/excluded-domains.json", "domains": len(round7_list)},
        **sets,
    }
    path = os.path.join(HERE, "data", "excluded-domains.json")
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(result, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print(f"round 7's list {len(round7_list)}; " + "; ".join(f"{k} +{len(v)}" for k, v in sets.items())
          + f"; total {len(seen)}")


def excluded_set():
    ex = json.load(open(os.path.join(HERE, "data", "excluded-domains.json"), encoding="utf-8"))
    r7 = json.load(open(ex["round7List"]["file"], encoding="utf-8"))
    r6 = json.load(open(r7["base"]["file"], encoding="utf-8"))
    sets = {"round7List": (set(r6["studyPages"]) | set(r6["namedByRepository"]) | set(r6.get("namedInHistoryOnly", []))
                           | set(r7["round6Pages"]) | set(r7["round6Files"]) | set(r7["since0bada65"]) | set(r7["humanReview"]))}
    for k in SETS[1:]:
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
