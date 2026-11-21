#!/usr/bin/env bash
# The sixth study's run-judged.sh for the seventh study's pages (--wcag 2.1, --timings). Judges each saved snapshot
# with the study's model, offline from the page, from an empty cache: the default criteria, --max-candidates 50, one run,
# --min-confidence low so that the report lists every finding, --time-limit 900 (a page that runs out writes a partial
# report) with a hard stop at 1000 s, and --concurrency 2, as in the fifth and sixth studies. One page at a time; between pages the
# script waits while the GPU is above 83 C or memory is low (env.sh), and changes no setting.
#
#   main             every page: DATA/pages/<slug>/recording/*.snapshot.json -> report.json (cache: cache/)
#   full2 .. full5   T4 subset: the main command again, each from its own empty cache (cache-full<n>/, full<n>-report.json);
#                    the main run is the first of the five uncached full runs
#   fast1 .. fast5   T4 subset: the live --fast snapshot (fast-recording/) judged with --fast, each from its own empty
#                    cache (cache-fast<n>/, fast<n>-report.json)
#
# Run from the repository root:  bash study/round-7-2026-11-21/scripts/run-judged.sh <mode> [slug ...]
set -u
MODE="$1"; shift
source "$(dirname "$0")/env.sh"
case "$MODE" in main|full[2-5]|fast[1-5]) ;; *) echo "mode: main, full2..full5 or fast1..fast5"; exit 1 ;; esac

pages | while IFS=$'\t' read -r slug url split t4; do
  [ -z "$slug" ] && continue
  chosen "$slug" "$@" || continue
  [ "$MODE" != main ] && [ "$t4" != T4 ] && continue
  dir="$DATA/pages/$slug"
  flags=()
  case "$MODE" in
    main) rec="$dir/recording"; cache="$dir/cache"; out="$dir/report.json"; console="$dir/console.txt" ;;
    full*) rec="$dir/recording"; cache="$dir/cache-$MODE"; out="$dir/$MODE-report.json"; console="$dir/$MODE-console.txt" ;;
    fast*) rec="$dir/fast-recording"; cache="$dir/cache-$MODE"; out="$dir/$MODE-report.json"; console="$dir/$MODE-console.txt"; flags=(--fast) ;;
  esac
  snapshot=$(ls "$rec"/*.snapshot.json 2>/dev/null | head -n 1)
  if [ -z "$snapshot" ]; then echo "$(date -Iseconds) $MODE $slug: no recording" | tee -a "$STUDY/run-log.txt"; continue; fi
  if [ -e "$cache" ]; then echo "$(date -Iseconds) $MODE $slug: $cache exists, not judged again" | tee -a "$STUDY/run-log.txt"; continue; fi
  cool
  start=$(date +%s)
  ( cd "$dir" && timeout 1000 node "$CLI" check "$snapshot" --wcag 2.1 "${flags[@]}" \
      --model "$MODEL" --locale en --min-confidence low --time-limit 900 --concurrency 2 --timings \
      --cache-dir "$cache" --json "$out" > "$console" 2>&1 )
  code=$?
  end=$(date +%s)
  printf '{"slug":"%s","mode":"%s","start":%s,"end":%s,"seconds":%s,"exitCode":%s}\n' \
    "$slug" "$MODE" "$start" "$end" "$((end - start))" "$code" > "$dir/run-$MODE-judged.json"
  echo "$(date -Iseconds) $MODE $slug exit $code in $((end - start)) s" | tee -a "$STUDY/run-log.txt"
done
