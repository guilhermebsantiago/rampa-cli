#!/usr/bin/env bash
# Every 2.4.4 and 2.4.6 candidate's fate on each page (scripts/fates.ts), offline, from the judgment cache of a run:
#   after   pages/<slug>/cache-after (run-after.sh), current versions -> data/after/fates/<slug>.json
#   replay  pages/<slug>/cache, the study's answers keyed with the old versions -> data/after/fates-replay/<slug>.json
# Run from the repository root: bash study/fresh-2026-10-11/scripts/run-fates.sh after|replay [slug ...]
set -u
MODE="$1"; shift
ROOT="$(pwd)"
STUDY="$ROOT/study/fresh-2026-10-11"
python -I -c "
import json, sys
sys.stdout.reconfigure(newline='\n')
for p in json.load(open(sys.argv[1], encoding='utf-8'))['pages']:
    print(p['slug'])
" "$STUDY/data/pages-input.json" | while read -r slug; do
  slug="${slug%$'\r'}"
  [ -z "$slug" ] && continue
  if [ "$#" -gt 0 ]; then
    case " $* " in *" $slug "*) ;; *) continue ;; esac
  fi
  dir="$STUDY/pages/$slug"
  snapshot=$(ls "$dir/recording"/*.snapshot.json | head -n 1)
  if [ "$MODE" = replay ]; then
    mkdir -p "$STUDY/data/after/fates-replay"
    node "$STUDY/scripts/fates.ts" "$snapshot" "$dir/cache" "$STUDY/data/after/fates-replay/$slug.json" --old-versions
  else
    [ -d "$dir/cache-after" ] && [ -f "$dir/after-report.json" ] || { echo "$slug: no after run yet"; continue; }
    mkdir -p "$STUDY/data/after/fates"
    node "$STUDY/scripts/fates.ts" "$snapshot" "$dir/cache-after" "$STUDY/data/after/fates/$slug.json"
  fi
done
