#!/usr/bin/env bash
# Collects each fresh page once, with no model, and records it (--save) so it can be judged later, offline,
# on the same snapshot. The run names the study's model with --offline: the collector then reads what the
# judged criteria need (image crops for 1.1.1, the destinations of links for 2.4.4), and Rampa never calls
# the model (an offline run reads cached judgments only, and the cache is empty).
#
#   main   every page, default criteria; recording in pages/<slug>/recording/
#   probe  the probe subset, with --probe all; recording in pages/<slug>/probe-recording/
#
# Each page runs in its own directory as the working directory, so its screenshot and its destination cache
# stay its own. A page that saves no snapshot is tried once more with the same command.
#
# Run from the repository root:  bash study/fresh-2026-10-11/scripts/collect.sh main|probe [slug ...]
set -u
MODE="$1"; shift
ROOT="$(pwd)"
STUDY="$ROOT/study/fresh-2026-10-11"
export RAMPA_BROWSER_CHANNEL=msedge
unset RAMPA_MODEL OPENAI_API_KEY ANTHROPIC_API_KEY GOOGLE_GENERATIVE_AI_API_KEY OPENROUTER_API_KEY GROQ_API_KEY

pages() {
  python -I -c "
import json, sys
sys.stdout.reconfigure(newline='\n')
d = json.load(open(sys.argv[1], encoding='utf-8'))
for p in d['pages']:
    if sys.argv[2] == 'main' or p['probeRun']:
        print(p['slug'] + '\t' + p['url'])
" "$STUDY/data/pages-input.json" "$MODE"
}

collect_page() {
  local slug="$1" url="$2" attempt="$3"
  local dir="$STUDY/pages/$slug"
  local rec extra=()
  if [ "$MODE" = probe ]; then rec="$dir/probe-recording"; extra=(--probe all); else rec="$dir/recording"; fi
  # COLLECT_EXTRA adds browser options for one page, such as --timeout 60000; the log says when it was used.
  if [ -n "${COLLECT_EXTRA:-}" ]; then extra+=($COLLECT_EXTRA); fi
  mkdir -p "$dir"
  local start end code
  start=$(date +%s)
  ( cd "$dir" && rm -rf .rampa/screenshots && timeout 900 node "$ROOT/dist/cli.mjs" check "$url" \
      --model ollama:gemma4:12b --offline --locale en --min-confidence low "${extra[@]}" \
      --cache-dir "$dir/cache-$MODE-collect" --save "$rec" --screenshots --json "$dir/$MODE-collect.json" \
      > "$dir/$MODE-collect-console.txt" 2>&1 )
  code=$?
  end=$(date +%s)
  for f in "$dir"/.rampa/screenshots/*.png; do [ -f "$f" ] && mv "$f" "$dir/$MODE-screenshot.png"; done
  printf '{"slug":"%s","url":"%s","mode":"%s","attempt":%s,"start":%s,"end":%s,"seconds":%s,"exitCode":%s}\n' \
    "$slug" "$url" "$MODE" "$attempt" "$start" "$end" "$((end - start))" "$code" > "$dir/run-$MODE-collect-$attempt.json"
  echo "$(date -Iseconds) $MODE $slug attempt $attempt exit $code in $((end - start)) s${COLLECT_EXTRA:+ (with $COLLECT_EXTRA)}" | tee -a "$STUDY/collect-log.txt"
  ls "$rec"/*.snapshot.json > /dev/null 2>&1
}

pages | while IFS=$'\t' read -r slug url; do
  url="${url%$'\r'}"
  [ -z "$slug" ] && continue
  if [ "$#" -gt 0 ]; then
    case " $* " in *" $slug "*) ;; *) continue ;; esac
  fi
  if ! collect_page "$slug" "$url" 1; then
    mv "$STUDY/pages/$slug/$MODE-collect-console.txt" "$STUDY/pages/$slug/$MODE-collect-console-1.txt" 2>/dev/null
    collect_page "$slug" "$url" 2 || echo "$(date -Iseconds) $MODE $slug failed twice" | tee -a "$STUDY/collect-log.txt"
  fi
done
