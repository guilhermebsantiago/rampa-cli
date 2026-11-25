"""The SHA-256 of every file of the build under study (dist/ of this worktree, built from v0.1.3 = 9e4fc69), so that the
run scripts can stop if it changes (pre-registration, section 1). The eighth study's build_hash.py with this round's code
and one more check: the build is compared, file by file, with the dist/ of the published npm tarball rampa-cli-0.1.3.tgz.

  python -I build_hash.py write [<npm package dir> <tarball>]   writes data/build.json (at the freeze)
  python -I build_hash.py check                                 exits 1 unless dist/ matches data/build.json (env.sh runs it)
"""
import hashlib
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOT = os.path.dirname(os.path.dirname(HERE))
DIST = os.path.join(ROOT, "dist")
CODE = "9e4fc69"


def files(folder=DIST):
    out = {}
    for base, _, names in os.walk(folder):
        for name in names:
            path = os.path.join(base, name)
            rel = os.path.relpath(path, folder).replace("\\", "/")
            out[rel] = hashlib.sha256(open(path, "rb").read()).hexdigest()
    return dict(sorted(out.items()))


def combined(table):
    return hashlib.sha256("".join(f"{k}\t{v}\n" for k, v in table.items()).encode("utf-8")).hexdigest()


def git(*args):
    return subprocess.run(["git", "-C", ROOT, *args], capture_output=True, text=True)


def main():
    table = files()
    path = os.path.join(HERE, "data", "build.json")
    if sys.argv[1:2] == ["write"]:
        head = git("rev-parse", "HEAD").stdout.strip()
        same = git("diff", "--quiet", "v0.1.3", "HEAD", "--", "src", "package.json", "pnpm-lock.yaml").returncode == 0
        tag = git("rev-parse", "v0.1.3^{commit}").stdout.strip()
        out = {"about": "dist/ of the round-9 worktree, built with pnpm install --frozen-lockfile and pnpm build from src/, package.json "
                        "and pnpm-lock.yaml identical to the tag v0.1.3 (9e4fc69, the published rampa-cli 0.1.3)",
               "code": CODE, "tagV013": tag, "srcPackageLockSameAsV013": same, "builtAtHead": head,
               "files": len(table), "combinedSha256": combined(table), "sha256": table}
        if len(sys.argv) == 4:
            npm = files(os.path.join(sys.argv[2], "dist"))
            out["npm"] = {"tarball": "https://registry.npmjs.org/rampa-cli/-/rampa-cli-0.1.3.tgz",
                          "tarballSha256": hashlib.sha256(open(sys.argv[3], "rb").read()).hexdigest(),
                          "distFiles": len(npm), "distCombinedSha256": combined(npm), "identicalToBuild": npm == table}
        with open(path, "w", encoding="utf-8", newline="\n") as f:
            json.dump(out, f, indent=1)
            f.write("\n")
        print(f"{len(table)} files, combined {combined(table)}; same source as v0.1.3: {same}"
              + (f"; identical to the npm tarball's dist: {out['npm']['identicalToBuild']}" if "npm" in out else ""))
        return
    want = json.load(open(path, encoding="utf-8"))
    if combined(table) != want["combinedSha256"]:
        print("dist/ differs from data/build.json", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
