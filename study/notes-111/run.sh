#!/usr/bin/env bash
# Rebuilds the measurements of docs/studies/notes-111-dev-fixes.md, from the repository root, after `pnpm build`.
# Only the fresh-page study's DEV pages are read: the test half stays held out.
#
#   bash study/notes-111/run.sh dev <label> [cli]   # judge each dev page's saved snapshot with the study's flags
#   bash study/notes-111/run.sh compare <a> <b>     # 1.1.1 findings of two dev runs, with the study's dev labels
#   bash study/notes-111/run.sh act                 # ACT test cases and pairs of 1.1.1 with the model
#
# `dev` needs the dev pages' recordings and judgment caches in study/fresh-2026-10-11/pages/<slug>/recording/ and
# cache/ (kept out of git; check them against data/recordings.json). Each run starts from a fresh copy of the page's
# study cache and runs --offline: every 1.1.1 judgment is read back from it, so two runs differ only in what
# verification keeps. [cli] is the built CLI to run (default dist/cli.mjs): the "before" run used a build of the commit
# before this change, copied to .rampa/dist-before/ (`git stash`, `pnpm build`, `cp -r dist .rampa/dist-before`).
set -u
here=study/notes-111
study=study/fresh-2026-10-11
unset RAMPA_MODEL
export RAMPA_LOCALE=en
dev_pages() {
  python -I -c "
import json, sys
sys.stdout.reconfigure(newline='\n')
for p in json.load(open(sys.argv[1], encoding='utf-8'))['pages']:
    if p['split'] == 'dev':
        print(p['slug'])
" "$study/data/pages-input.json"
}
case "${1:-}" in
  dev)
    label="${2:?label}"
    cli="$(pwd)/${3:-dist/cli.mjs}"
    out=".rampa/notes-111/$label"
    mkdir -p "$out"
    dev_pages | while read -r slug; do
      slug="${slug%$'\r'}"
      work="$out/$slug"
      rm -rf "$work"
      mkdir -p "$work"
      cp -r "$study/pages/$slug/cache" "$work/cache"
      snapshot="$(pwd)/$(ls "$study/pages/$slug"/recording/*.snapshot.json | head -n 1)"
      ( cd "$work" && node "$cli" check "$snapshot" --model ollama:gemma4:12b --locale en --min-confidence low --time-limit 900 \
          --concurrency 2 --cache-dir cache --offline --json report.json > console.txt 2>&1 )
      echo "$slug exit=$?"
    done
    ;;
  compare)
    python -I "$here/compare.py" "$study" ".rampa/notes-111/${2:?before}" ".rampa/notes-111/${3:?after}"
    ;;
  act)
    node dist/cli.mjs eval --criteria 1.1.1 --model ollama:gemma4:12b --locale en --cache-dir .rampa/cache-eval --out-dir .rampa/runs --concurrency 2
    ;;
  *)
    echo "usage: bash $here/run.sh dev <label> [cli] | compare <a> <b> | act" >&2
    exit 2
    ;;
esac
