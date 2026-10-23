#!/usr/bin/env bash
# Rebuilds the measurements of docs/studies/notes-remaining-errors.md, from the repository root, after `pnpm build`.
# Only the fresh-page study's DEV pages are read (pages-input.json rows with split "dev"); its test half, the first
# study and every later round stay held out.
#
#   bash study/notes-remaining/run.sh dev <label> <criteria> [cli] [--offline] [--fresh-cache]
#       judges each dev page's saved snapshot with the study's flags; the cache starts as a copy of the study's
#       (pages/<slug>/cache) unless --fresh-cache, and lives in .rampa/notes-remaining/<label>/<slug>/cache
#   bash study/notes-remaining/run.sh copy-cache <from> <to>   # start run <to> from the answers of run <from>
#   bash study/notes-remaining/run.sh list111 <label>     # the 1.1.1 findings of a run, with the study's dev labels
#   bash study/notes-remaining/run.sh list244 <a> <b>     # the 2.4.4 findings and suggestions of two runs, compared
#   bash study/notes-remaining/run.sh facts244            # the 2.4.4 facts of every dev candidate, no model
#   bash study/notes-remaining/run.sh act <criteria> <cache> [cli] [--offline]   # rampa eval on those criteria and pairs
#
# `dev` needs the dev pages' recordings and caches in study/fresh-2026-10-11/pages/<slug>/recording/ and cache/
# (kept out of git; copy them from the study's backup and check them against data/recordings.json).
set -u
here=study/notes-remaining
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
    criteria="${3:?criteria}"
    shift 3
    cli="$(pwd)/dist/cli.mjs"
    offline=""; fresh=""
    for arg in "$@"; do
      case "$arg" in
        --offline) offline="--offline" ;;
        --fresh-cache) fresh=1 ;;
        *) cli="$(pwd)/$arg" ;;
      esac
    done
    out=".rampa/notes-remaining/$label"
    mkdir -p "$out"
    dev_pages | while read -r slug; do
      slug="${slug%$'\r'}"
      work="$out/$slug"
      mkdir -p "$work"
      rm -f "$work/report.json"
      if [ ! -d "$work/cache" ]; then
        if [ -n "$fresh" ]; then mkdir -p "$work/cache"; else cp -r "$study/pages/$slug/cache" "$work/cache"; fi
      fi
      snapshot="$(pwd)/$(ls "$study/pages/$slug"/recording/*.snapshot.json | head -n 1)"
      started=$(date +%s)
      ( cd "$work" && node "$cli" check "$snapshot" --criteria "$criteria" --model ollama:gemma4:12b --locale en --min-confidence low \
          --time-limit 1800 --concurrency 2 --cache-dir cache $offline --json report.json > console.txt 2>&1 )
      echo "$slug exit=$? $(( $(date +%s) - started )) s"
    done
    ;;
  copy-cache)
    from=".rampa/notes-remaining/${2:?from}"
    to=".rampa/notes-remaining/${3:?to}"
    for dir in "$from"/*/; do
      slug="$(basename "$dir")"
      mkdir -p "$to/$slug"
      rm -rf "$to/$slug/cache"
      cp -r "$dir/cache" "$to/$slug/cache"
    done
    ;;
  list111)
    python -I "$here/list111.py" "$study" ".rampa/notes-remaining/${2:?label}"
    ;;
  list244)
    python -I "$here/list244.py" "$study" ".rampa/notes-remaining/${2:?run a}" ".rampa/notes-remaining/${3:?run b}"
    ;;
  facts244)
    node "$here/facts244.ts"
    ;;
  act)
    criteria="${2:?criteria}"
    cache="${3:?cache}"
    shift 3
    cli="dist/cli.mjs"
    offline=""
    for arg in "$@"; do
      case "$arg" in --offline) offline="--offline" ;; *) cli="$arg" ;; esac
    done
    node "$cli" eval --criteria "$criteria" --model ollama:gemma4:12b --locale en --cache-dir "$cache" --out-dir .rampa/runs --concurrency 2 $offline
    ;;
  *)
    echo "usage: bash $here/run.sh dev <label> <criteria> [cli] [--offline] [--fresh-cache] | copy-cache <from> <to> | list111 <label> | list244 <a> <b> | facts244 | act <criteria> <cache> [cli] [--offline]" >&2
    exit 2
    ;;
esac
