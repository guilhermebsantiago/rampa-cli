#!/usr/bin/env bash
# Runs scripts/old-code.ts on every test page, for the first run's findings (data/old-code/<slug>.items.json,
# written from data/fates.json). Run from the repository root after extracting .old-46029c1 (see old-code.ts).
set -u
DIR=study/remeasure-2026-10-09
for items in "$DIR"/data/old-code/*.items.json; do
  slug=$(basename "$items" .items.json)
  snapshot=$(ls "$DIR/pages/$slug/recording/"*.snapshot.json | head -n 1)
  node "$DIR/scripts/old-code.ts" "$snapshot" "$items" "$DIR/data/old-code/$slug.json" > "$DIR/data/old-code/$slug.log" 2>&1
  echo "$slug exit $?"
done
