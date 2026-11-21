#!/usr/bin/env bash
# The ablations of the sixth study (pre-registration, section 3), each on every page's saved snapshot, after the main run
# (run-judged.sh main). No model is asked by any of them:
#
#   noconfirm  the second pass off: the main command plus --offline --no-confirm, on a fresh copy of the page's main cache
#              (the fifth study's run-noconfirm.sh); every first-pass answer is read back
#   noverify   verification off: the main command plus --offline --no-verify, on a fresh copy of the main cache; a claim
#              verification discarded that now needs a second-pass answer the cache lacks is the model's suggestion,
#              counted in the report's offline misses
#   nop2       P2 off: a copy of the build in which the one call of confirmTogether (identical claims confirmed together)
#              returns each claim's own outcome, checked to differ from the build in that one line; the main command plus
#              --offline, on a fresh copy of the main cache
#   nollm      the judgment layer off: --no-llm on the same snapshot (axe-core and Rampa's rules alone)
#
#   DATA/pages/<slug>/recording/*.snapshot.json -> <mode>-report.json (cache: cache-<mode>/)
#
# Offline misses are counted in each report. Run from the repository root:
#   bash study/round-6-2026-10-29/scripts/run-ablation.sh noconfirm|noverify|nop2|nollm [slug ...]
set -u
MODE="$1"; shift
source "$(dirname "$0")/env.sh"
RUN="$CLI"
case "$MODE" in
  noconfirm) flags=(--model "$MODEL" --time-limit 900 --concurrency 2 --timings --offline --no-confirm) ;;
  noverify) flags=(--model "$MODEL" --time-limit 900 --concurrency 2 --timings --offline --no-verify) ;;
  nop2)
    flags=(--model "$MODEL" --time-limit 900 --concurrency 2 --timings --offline)
    BUILD="$(dirname "$CLI")"
    VARIANT="$(dirname "$BUILD")/.rampa/dist-nop2"
    rm -rf "$VARIANT" && mkdir -p "$(dirname "$VARIANT")" && cp -r "$BUILD" "$VARIANT"
    file=$(grep -l "const outcomes = confirmTogether(asked);" "$VARIANT"/*.mjs)
    [ "$(echo "$file" | wc -l)" = 1 ] && [ "$(grep -c "const outcomes = confirmTogether(asked);" "$file")" = 1 ] || { echo "the call does not occur exactly once"; exit 1; }
    sed -i 's/const outcomes = confirmTogether(asked);/const outcomes = asked.map(({ confirmation }) => confirmation);/' "$file"
    changed=$(diff -r "$BUILD" "$VARIANT" | grep -c '^[<>]')
    [ "$changed" = 2 ] || { echo "the copy differs from the build in more than one line ($changed)"; exit 1; }
    diff -r "$BUILD" "$VARIANT" | tee "$STUDY/data/nop2-variant.diff"
    RUN="$VARIANT/cli.mjs"
    ;;
  nollm) flags=(--no-llm) ;;
  *) echo "mode: noconfirm, noverify, nop2 or nollm"; exit 1 ;;
esac

pages | while IFS=$'\t' read -r slug url split t4; do
  [ -z "$slug" ] && continue
  chosen "$slug" "$@" || continue
  dir="$DATA/pages/$slug"
  snapshot=$(ls "$dir/recording"/*.snapshot.json 2>/dev/null | head -n 1)
  if [ -z "$snapshot" ] || [ ! -d "$dir/cache" ]; then echo "$(date -Iseconds) $MODE $slug: no recording or main cache" | tee -a "$STUDY/run-log.txt"; continue; fi
  cache=()
  if [ "$MODE" != nollm ]; then rm -rf "$dir/cache-$MODE" && cp -r "$dir/cache" "$dir/cache-$MODE"; cache=(--cache-dir "$dir/cache-$MODE"); fi
  start=$(date +%s)
  ( cd "$dir" && timeout 1000 node "$RUN" check "$snapshot" --wcag 2.1 --locale en --min-confidence low "${flags[@]}" \
      "${cache[@]}" --json "$dir/$MODE-report.json" > "$dir/$MODE-console.txt" 2>&1 )
  code=$?
  end=$(date +%s)
  printf '{"slug":"%s","mode":"%s","start":%s,"end":%s,"seconds":%s,"exitCode":%s}\n' \
    "$slug" "$MODE" "$start" "$end" "$((end - start))" "$code" > "$dir/run-$MODE-judged.json"
  echo "$(date -Iseconds) $MODE $slug exit $code in $((end - start)) s" | tee -a "$STUDY/run-log.txt"
done
