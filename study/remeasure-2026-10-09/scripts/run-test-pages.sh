#!/usr/bin/env bash
# Runs the current build on every test-split page of the real-page study, one page at a time,
# with the study's settings: the default criteria, --model ollama:gemma4:12b --locale en, the
# default --min-confidence (medium), one run per page, and a 900 s budget per page. The budget is
# given to Rampa as --time-limit 900, so a page that runs out writes a partial report; a hard
# timeout of 1000 s guards the process. A page that fails to run (no report, not a timeout) is
# retried once with the same command, as in the study.
#
# Run from the repository root:  bash study/remeasure-2026-10-09/scripts/run-test-pages.sh [slug ...]
set -u
ROOT="$(pwd)"
OUT="$ROOT/study/remeasure-2026-10-09/pages"
PAGES="$ROOT/study/remeasure-2026-10-09/scripts/test-pages.tsv"
CRITERIA="1.1.1,1.3.5,2.4.2,2.4.4,2.4.6,3.1.1,3.1.2,3.3.2"
export RAMPA_BROWSER_CHANNEL=msedge
unset RAMPA_MODEL OPENAI_API_KEY

run_page() {
  local slug="$1" url="$2" attempt="$3"
  local dir="$OUT/$slug"
  mkdir -p "$dir"
  rm -rf "$ROOT/.rampa/screenshots"
  local start end code
  start=$(date +%s)
  timeout 1000 node "$ROOT/dist/cli.mjs" check "$url" \
    --model ollama:gemma4:12b --locale en --criteria "$CRITERIA" \
    --time-limit 900 --cache-dir "$dir/cache" \
    --save "$dir/recording" --screenshots --json "$dir/report.json" \
    > "$dir/console.txt" 2>&1
  code=$?
  end=$(date +%s)
  if [ -d "$ROOT/.rampa/screenshots" ]; then
    for f in "$ROOT"/.rampa/screenshots/*.png; do [ -f "$f" ] && cp "$f" "$dir/screenshot.png"; done
  fi
  printf '{"slug":"%s","url":"%s","attempt":%s,"start":%s,"end":%s,"seconds":%s,"exitCode":%s}\n' \
    "$slug" "$url" "$attempt" "$start" "$end" "$((end - start))" "$code" > "$dir/run-$attempt.json"
  echo "$(date -Iseconds) $slug attempt $attempt exit $code in $((end - start)) s"
  # A report, or a hard timeout (124): neither is retried. Only a failure to run is.
  [ -s "$dir/report.json" ] || [ "$code" -eq 124 ]
}

while IFS=$'\t' read -r slug url; do
  [ -z "$slug" ] && continue
  if [ "$#" -gt 0 ]; then
    case " $* " in *" $slug "*) ;; *) continue ;; esac
  fi
  if ! run_page "$slug" "$url" 1; then
    mv "$OUT/$slug/console.txt" "$OUT/$slug/console-1.txt" 2>/dev/null
    rm -rf "$OUT/$slug/cache"
    run_page "$slug" "$url" 2 || echo "$(date -Iseconds) $slug failed twice"
  fi
done < "$PAGES"
