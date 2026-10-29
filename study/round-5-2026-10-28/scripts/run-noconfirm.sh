#!/usr/bin/env bash
# The fourth study's run-noconfirm.sh, for the fifth study's pages. The ablation: each saved snapshot judged again with the second pass off (--no-confirm), with
# run-judged.sh's flags, --offline, and a fresh copy of the page's judgment cache from the main run. Every first-pass
# answer is read back from that cache, so the only difference from the main run is the second pass: a claim it denied
# or could not ask is a finding here and a suggestion there. Offline misses are counted in the report.
#
#   pages/<slug>/recording/<name>.snapshot.json -> pages/<slug>/noconfirm-report.json (cache: pages/<slug>/cache-noconfirm)
#
# Pages run one at a time. Run from the repository root:  bash study/round-5-2026-10-28/scripts/run-noconfirm.sh [slug ...]
set -u
ROOT="$(pwd)"
STUDY="$ROOT/study/round-5-2026-10-28"
export RAMPA_BROWSER_CHANNEL=msedge
unset RAMPA_MODEL OPENAI_API_KEY ANTHROPIC_API_KEY GOOGLE_GENERATIVE_AI_API_KEY OPENROUTER_API_KEY GROQ_API_KEY

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
  snapshot=$(ls "$dir/recording"/*.snapshot.json 2>/dev/null | head -n 1)
  if [ -z "$snapshot" ] || [ ! -d "$dir/cache" ]; then echo "$(date -Iseconds) noconfirm $slug: no recording or cache" | tee -a "$STUDY/run-log.txt"; continue; fi
  rm -rf "$dir/cache-noconfirm" && cp -r "$dir/cache" "$dir/cache-noconfirm"
  start=$(date +%s)
  ( cd "$dir" && timeout 1000 node "$ROOT/dist/cli.mjs" check "$snapshot" \
      --model ollama:gemma4:12b --locale en --min-confidence low --time-limit 900 --concurrency 2 --offline --no-confirm \
      --cache-dir "$dir/cache-noconfirm" --json "$dir/noconfirm-report.json" > "$dir/noconfirm-console.txt" 2>&1 )
  code=$?
  end=$(date +%s)
  printf '{"slug":"%s","mode":"noconfirm","start":%s,"end":%s,"seconds":%s,"exitCode":%s}\n' \
    "$slug" "$start" "$end" "$((end - start))" "$code" > "$dir/run-noconfirm-judged.json"
  echo "$(date -Iseconds) noconfirm $slug exit $code in $((end - start)) s" | tee -a "$STUDY/run-log.txt"
done
