"""The SHA-256 of every file of the build under study (dist/ of this worktree, built from 385fe13), so that the run
scripts can stop if it changes (pre-registration, section 1).

  python -I build_hash.py write   writes data/build.json (at the freeze)
  python -I build_hash.py check   exits 1 unless dist/ matches data/build.json (scripts/env.sh runs it)
"""
import hashlib
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOT = os.path.dirname(os.path.dirname(HERE))
DIST = os.path.join(ROOT, "dist")


def files():
    out = {}
    for base, _, names in os.walk(DIST):
        for name in names:
            path = os.path.join(base, name)
            rel = os.path.relpath(path, DIST).replace("\\", "/")
            out[rel] = hashlib.sha256(open(path, "rb").read()).hexdigest()
    return dict(sorted(out.items()))


def combined(table):
    return hashlib.sha256("".join(f"{k}\t{v}\n" for k, v in table.items()).encode("utf-8")).hexdigest()


def main():
    table = files()
    path = os.path.join(HERE, "data", "build.json")
    if sys.argv[1:] == ["write"]:
        head = subprocess.run(["git", "-C", ROOT, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
        src = subprocess.run(["git", "-C", ROOT, "diff", "--quiet", "385fe13", "HEAD", "--", "src"]).returncode == 0
        with open(path, "w", encoding="utf-8", newline="\n") as f:
            json.dump({"about": "dist/ of the round-7 worktree, built with pnpm install --frozen-lockfile and pnpm build from src/ "
                                "identical to 385fe13 (fix/round-6)", "code": "385fe13", "srcSameAs385fe13": src, "builtAtHead": head,
                       "files": len(table), "combinedSha256": combined(table), "sha256": table}, f, indent=1)
            f.write("\n")
        print(f"{len(table)} files, combined {combined(table)}")
        return
    want = json.load(open(path, encoding="utf-8"))
    if combined(table) != want["combinedSha256"]:
        print("dist/ differs from data/build.json", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
