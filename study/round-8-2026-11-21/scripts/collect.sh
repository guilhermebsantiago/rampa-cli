#!/usr/bin/env bash
# The seventh study's collect.sh for the eighth study's pages (--wcag 2.1, --timings), run with each page's folder
# under DATA (env.sh) as the working directory. Collects each page once with no model call, and records it (--save) so
# that it is judged later, offline from the page, on the same snapshot. The run names the study's model with --offline:
# the collector then reads what the judged criteria need (image crops for 1.1.1, the destinations of links for 2.4.4),
# and Rampa never calls the model (an offline run reads cached judgments only, and the cache is empty).
#
#   main  every page, blocks 1 to 5 in order: DATA/pages/<slug>/recording/, main-screenshot.png, main-collect.json
#   fast  the T4 subset only (pre-registration, section 3): one live --fast collection, DATA/pages/<slug>/fast-recording/
#
# A page that saves no snapshot is tried once more at once with the same command; the pre-registration's rules for
# network drops and refusals (section 6) apply on top, by hand, and every attempt is logged in collect-log.txt.
#
# Run from the repository root:  bash study/round-8-2026-11-21/scripts/collect.sh main|fast [slug ...]
set -u
MODE="$1"; shift
source "$(dirname "$0")/env.sh"

collect_page() {
  local slug="$1" url="$2" attempt="$3"
  local dir="$DATA/pages/$slug"
  local rec flags=()
  if [ "$MODE" = fast ]; then
    rec="$dir/fast-recording"; flags=(--fast --timings)
  else
    rec="$dir/recording"; flags=(--locale en --min-confidence low --screenshots --timings)
  fi
  # COLLECT_EXTRA adds browser options for one page, such as --timeout 60000; the log says when it was used.
  if [ -n "${COLLECT_EXTRA:-}" ]; then flags+=($COLLECT_EXTRA); fi
  mkdir -p "$dir"
  local start end code
  start=$(date +%s)
  ( cd "$dir" && rm -rf .rampa/screenshots && timeout 900 node "$CLI" check "$url" --wcag 2.1 \
      --model "$MODEL" --offline "${flags[@]}" \
      --cache-dir "$dir/cache-$MODE-collect" --save "$rec" --json "$dir/$MODE-collect.json" \
      > "$dir/$MODE-collect-console.txt" 2>&1 )
  code=$?
  end=$(date +%s)
  for f in "$dir"/.rampa/screenshots/*.png; do [ -f "$f" ] && mv "$f" "$dir/$MODE-screenshot.png"; done
  printf '{"slug":"%s","url":"%s","mode":"%s","attempt":%s,"start":%s,"end":%s,"seconds":%s,"exitCode":%s}\n' \
    "$slug" "$url" "$MODE" "$attempt" "$start" "$end" "$((end - start))" "$code" > "$dir/run-$MODE-collect-$attempt.json"
  echo "$(date -Iseconds) $MODE $slug attempt $attempt exit $code in $((end - start)) s${COLLECT_EXTRA:+ (with $COLLECT_EXTRA)}" | tee -a "$STUDY/collect-log.txt"
  ls "$rec"/*.snapshot.json > /dev/null 2>&1
}

pages | while IFS=$'\t' read -r slug url split t4; do
  [ -z "$slug" ] && continue
  chosen "$slug" "$@" || continue
  [ "$MODE" = fast ] && [ "$t4" != T4 ] && continue
  if ! collect_page "$slug" "$url" 1; then
    mv "$DATA/pages/$slug/$MODE-collect-console.txt" "$DATA/pages/$slug/$MODE-collect-console-1.txt" 2>/dev/null
    collect_page "$slug" "$url" 2 || echo "$(date -Iseconds) $MODE $slug failed twice" | tee -a "$STUDY/collect-log.txt"
  fi
done
