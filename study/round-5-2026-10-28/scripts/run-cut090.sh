#!/usr/bin/env bash
# Ablation of the fifth study: the 1.1.1 second pass with the fourth study's cut, 0.9, instead of the frozen code's 0.99
# (src/core/confirm.ts, CONFIRM_MIN_PROBABILITY). The build under study (dist/, from b759128) is copied to
# .rampa/dist-cut090 with that one constant changed (`minProbability >= .99` -> `>= .9`; the script stops unless it
# occurs exactly once and the copy differs from dist/ in that one line), and each saved snapshot is judged again with
# run-judged.sh's flags plus --offline, from a fresh copy of the page's main-run cache. Every first-pass and second-pass
# answer is read back from that cache (offline misses are counted in the report), so the two runs differ only by the cut:
# a 1.1.1 claim every framing confirmed with a lowest probability in [0.9, 0.99) is a finding here and a suggestion in
# the main run. src/ is not touched.
#
#   pages/<slug>/recording/<name>.snapshot.json -> pages/<slug>/cut090-report.json (cache: pages/<slug>/cache-cut090)
#
# Pages run one at a time. Run from the repository root:  bash study/round-5-2026-10-28/scripts/run-cut090.sh [slug ...]
set -u
ROOT="$(pwd)"
STUDY="$ROOT/study/round-5-2026-10-28"
VARIANT="$ROOT/.rampa/dist-cut090"
export RAMPA_BROWSER_CHANNEL=msedge
unset RAMPA_MODEL OPENAI_API_KEY ANTHROPIC_API_KEY GOOGLE_GENERATIVE_AI_API_KEY OPENROUTER_API_KEY GROQ_API_KEY

rm -rf "$VARIANT" && mkdir -p "$ROOT/.rampa" && cp -r "$ROOT/dist" "$VARIANT"
file=$(grep -l "minProbability >= \.99" "$VARIANT"/*.mjs)
[ "$(grep -c "minProbability >= \.99" $file)" = 1 ] && [ "$(echo "$file" | wc -l)" = 1 ] || { echo "the cut does not occur exactly once"; exit 1; }
sed -i 's/minProbability >= \.99)/minProbability >= .9)/' "$file"
changed=$(diff -r "$ROOT/dist" "$VARIANT" | grep -c '^[<>]')
[ "$changed" = 2 ] || { echo "the copy differs from dist/ in more than one line ($changed)"; exit 1; }
diff -r "$ROOT/dist" "$VARIANT" | tee "$STUDY/data/cut090-variant.diff"

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
  if [ -z "$snapshot" ] || [ ! -d "$dir/cache" ]; then echo "$(date -Iseconds) cut090 $slug: no recording or cache" | tee -a "$STUDY/run-log.txt"; continue; fi
  rm -rf "$dir/cache-cut090" && cp -r "$dir/cache" "$dir/cache-cut090"
  start=$(date +%s)
  ( cd "$dir" && timeout 1000 node "$VARIANT/cli.mjs" check "$snapshot" \
      --model ollama:gemma4:12b --locale en --min-confidence low --time-limit 900 --concurrency 2 --offline \
      --cache-dir "$dir/cache-cut090" --json "$dir/cut090-report.json" > "$dir/cut090-console.txt" 2>&1 )
  code=$?
  end=$(date +%s)
  printf '{"slug":"%s","mode":"cut090","start":%s,"end":%s,"seconds":%s,"exitCode":%s}\n' \
    "$slug" "$start" "$end" "$((end - start))" "$code" > "$dir/run-cut090-judged.json"
  echo "$(date -Iseconds) cut090 $slug exit $code in $((end - start)) s" | tee -a "$STUDY/run-log.txt"
done
