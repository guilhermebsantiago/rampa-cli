#!/usr/bin/env bash
# After a page's run: replay its candidates offline from its cache, then match every page's findings
# to the first run's labels and rebuild the evidence packets. Run from the repository root:
#   bash study/remeasure-2026-10-09/scripts/after-page.sh <slug> [...]
set -eu
DIR=study/remeasure-2026-10-09
mkdir -p "$DIR/data/candidates"
for slug in "$@"; do
  snapshot=$(ls "$DIR/pages/$slug/recording/"*.snapshot.json | head -n 1)
  node "$DIR/scripts/candidates.ts" "$snapshot" "$DIR/pages/$slug/cache" "$DIR/data/candidates/$slug.json"
done
PYTHONIOENCODING=utf-8 python -I "$DIR/scripts/match.py"
