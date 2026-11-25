"""Which sites the ninth real-page study may not use, and whether each candidate is clear of them.

The eighth study's exclusions.py (study/round-8-2026-11-21/scripts/exclusions.py), extended rather than rebuilt. A
registrable domain (the Public Suffix List's rule) is excluded when it is in any of these sets:

- round8List: every domain the eighth study excluded (its data/excluded-domains.json and the lists it extends: the
  seventh study's, and the sixth study's built at 0bada65 on the first to fifth studies' pages, the re-measure's, the
  robustness study's and every host the repository named then);
- round8Pages: every page the eighth study chose (its scripts/pages.tsv: 60);
- round8Pools: every site of the eighth study's pools (scripts/pools.tsv and scripts/pools-2.tsv), loaded or not;
- studyFiles: every host named by any file of the sixth, seventh and eighth studies' folders at HEAD (all three merged
  into main, labels, screens and candidate lists included), and by every file of the eighth study's folder in its own
  worktree that git does not ignore there (read only);
- since0bada65: every host on a line any commit reachable from any ref added since 0bada65, outside the sixth to ninth
  studies' folders, and every commit message since 0bada65 (the 0.1.3 release and its documentation among them);
- humanReview: every host named by any file in the main checkout's study/human-review-2026-10/ (the human-review
  packages and the reviewers' files; read for host names only);
- demoHosts: the hosts used in demonstrations of the tool, by their registrable domain: www.gov.br, meu.inss.gov.br,
  servicos.mte.gov.br, sso.acesso.gov.br, contas.acesso.gov.br and servicos.acesso.gov.br (gov.br is a public suffix,
  so www.gov.br, inss.gov.br, mte.gov.br and acesso.gov.br are excluded whole).

As before, a candidate whose registrable domain shares its first label with an excluded one is flagged for a look by
hand.

  python -I exclusions.py <public_suffix_list.dat> build            writes data/excluded-domains.json
  python -I exclusions.py <public_suffix_list.dat> check <tsv>...   checks each URL of the candidate files

Run from the repository root (the round-9 worktree).
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
R9 = "study/round-9-2026-11-25"
BASE = "0bada65"
R8_WORKTREE = "C:/Users/guilh/dev/rampa-cli/.claude/worktrees/round-8-run"
MAIN_HUMAN_REVIEW = "C:/Users/guilh/dev/rampa-cli/study/human-review-2026-10"
DEMO_HOSTS = ("www.gov.br", "meu.inss.gov.br", "servicos.mte.gov.br", "sso.acesso.gov.br", "contas.acesso.gov.br",
              "servicos.acesso.gov.br")
TOKEN = re.compile(r"[a-z0-9][a-z0-9.-]*\.[a-z]{2,}", re.I)
SETS = ("round8List", "round8Pages", "round8Pools", "studyFiles", "since0bada65", "humanReview", "demoHosts")


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


def tsv_urls(path):
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


def round8_list():
    """Every domain the eighth study excluded, read through the lists it extends (its own excluded_set rule)."""
    r8 = json.load(open(f"{R8}/data/excluded-domains.json", encoding="utf-8"))
    r7 = json.load(open(r8["round7List"]["file"], encoding="utf-8"))
    r6 = json.load(open(r7["base"]["file"], encoding="utf-8"))
    out = (set(r6["studyPages"]) | set(r6["namedByRepository"]) | set(r6.get("namedInHistoryOnly", []))
           | set(r7["round6Pages"]) | set(r7["round6Files"]) | set(r7["since0bada65"]) | set(r7["humanReview"]))
    for k in ("round7Pages", "round6Pools", "studyFiles", "since0bada65", "humanReview"):
        out |= set(r8[k])
    return out


def build(psl):
    base = round8_list()
    round8_pages = {psl.registrable(urlsplit(u).hostname) for u in tsv_urls(f"{R8}/scripts/pages.tsv")}
    round8_pools = {psl.registrable(urlsplit(u).hostname) for p in ("pools.tsv", "pools-2.tsv")
                    for u in tsv_urls(f"{R8}/scripts/{p}")}
    files = set()
    out = git("grep", "-I", "-o", "-i", "-E", TOKEN.pattern, "HEAD", "--", R6, R7, R8)
    for line in out.splitlines():
        parts = line.split(":", 2)
        if len(parts) == 3:
            reg = psl.registrable(parts[2].strip(".-"))
            if reg:
                files.add(reg)
    live = git("ls-files", "--others", "--exclude-standard", "--", R8, cwd=R8_WORKTREE).split("\n")
    live_files = 0
    for rel in filter(None, live):
        files |= domains(psl, read_text(os.path.join(R8_WORKTREE, rel)))
        live_files += 1
    since = set()
    proc = subprocess.Popen(["git", "log", "--all", "--not", BASE, "-p", "--no-color", "--format=", "--", ".",
                             f":(exclude){R6}", f":(exclude){R7}", f":(exclude){R8}", f":(exclude){R9}", ":(exclude)pnpm-lock.yaml"],
                            stdout=subprocess.PIPE, text=True, encoding="utf-8", errors="replace")
    for line in proc.stdout:
        if line.startswith("+") and not line.startswith("+++"):
            since |= domains(psl, line)
    proc.wait()
    since |= domains(psl, git("log", "--all", "--not", BASE, "--format=%B"))
    human, human_files = set(), 0
    for root, _, names in os.walk(MAIN_HUMAN_REVIEW):
        for name in names:
            human |= domains(psl, read_text(os.path.join(root, name)))
            human_files += 1
    demo = {psl.registrable(h) for h in DEMO_HOSTS}
    refs = [r for r in git("for-each-ref", "--format=%(refname)", "refs/heads", "refs/tags", "refs/remotes").split()
            if not r.endswith("/HEAD")]
    seen = set(base)
    sets = {}
    for name, values in (("round8Pages", round8_pages), ("round8Pools", round8_pools), ("studyFiles", files),
                         ("since0bada65", since), ("humanReview", human), ("demoHosts", demo)):
        values = {v for v in values if v}
        sets[name] = sorted(values - seen)
        seen |= values
    result = {
        "note": ("Registrable domains the ninth study may not use (scripts/exclusions.py, pre-registration section 2): the "
                 "eighth study's list, its 60 pages, its pools, every host the sixth to eighth studies' files name, every host "
                 "on a line added since 0bada65 outside the sixth to ninth studies' folders or in a commit message since, every "
                 "host the human-review folder names, and the demonstration hosts. Each set lists only what the sets before it "
                 "lack."),
        "publicSuffixList": {"url": "https://publicsuffix.org/list/public_suffix_list.dat", "fetched": "2026-11-21",
                             "sha256": hashlib.sha256(open(psl.path, "rb").read()).hexdigest(),
                             "note": "the seventh and eighth studies' copy"},
        "head": git("rev-parse", "HEAD").strip(),
        "round8WorktreeHead": git("rev-parse", "HEAD", cwd=R8_WORKTREE).strip(),
        "round8WorktreeUntrackedFilesRead": live_files,
        "humanReviewFilesRead": human_files,
        "demoHosts": sorted(DEMO_HOSTS),
        "refs": {ref: git("rev-parse", "--short", ref).strip() for ref in refs},
        "round8List": {"file": f"{R8}/data/excluded-domains.json", "domains": len(base)},
        "sets": sets,
        "total": len(seen),
    }
    path = os.path.join(HERE, "data", "excluded-domains.json")
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(result, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print(f"round 8's list {len(base)}; " + "; ".join(f"{k} +{len(v)}" for k, v in sets.items()) + f"; total {len(seen)}")


def excluded_set():
    ex = json.load(open(os.path.join(HERE, "data", "excluded-domains.json"), encoding="utf-8"))
    sets = {"round8List": round8_list()}
    for k in SETS[1:]:
        sets[k] = set(ex["sets"][k])
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
