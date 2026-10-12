#!/usr/bin/env bash
# The re-judgment after the 2.4.4/2.4.6 change (docs/studies/notes-244-246.md): each page's saved snapshot is
# judged again with the current build and the study's flags (the default criteria, --max-candidates 50, one run,
# --min-confidence low, --time-limit 900), plus --concurrency 2 because the GPU was shared with a benchmark run
# (the number of parallel model calls changes no prompt). Nothing is loaded live: the snapshot and the engine
# results next to it are the input.
#
# The judgment cache starts as a copy of the study's (pages/<slug>/cache, left untouched), so every prompt that is
# the same as in the study is read back, not asked again. 2.4.4 and 2.4.6 have new versions (3 and 4), which are
# part of the cache key, so their candidates are asked again.
#
#   pages/<slug>/recording/<slug>.snapshot.json -> pages/<slug>/after-report.json, after-console.txt,
#   run-after-judged.json; cache in pages/<slug>/cache-after/ (kept out of git); log in after-run-log.txt.
#
# Pages run one at a time. Run from the repository root, after `pnpm build`:
#   bash study/fresh-2026-10-11/scripts/run-after.sh [slug ...]
set -u
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
    print(p['slug'])
" "$STUDY/data/pages-input.json"
}

pages | while read -r slug; do
  slug="${slug%$'\r'}"
  [ -z "$slug" ] && continue
  if [ "$#" -gt 0 ]; then
    case " $* " in *" $slug "*) ;; *) continue ;; esac
  fi
  dir="$STUDY/pages/$slug"
  rec="$dir/recording"; cache="$dir/cache-after"; out="$dir/after-report.json"; console="$dir/after-console.txt"
  # A fresh copy of the study's cache each time, so a page run twice starts from the same answers.
  rm -rf "$cache"; [ -d "$dir/cache" ] && cp -r "$dir/cache" "$cache"
  snapshot=$(ls "$rec"/*.snapshot.json 2>/dev/null | head -n 1)
  if [ -z "$snapshot" ]; then echo "$(date -Iseconds) after $slug: no recording" | tee -a "$STUDY/after-run-log.txt"; continue; fi
  start=$(date +%s)
  ( cd "$dir" && timeout 1000 node "$ROOT/dist/cli.mjs" check "$snapshot" \
      --model ollama:gemma4:12b --locale en --min-confidence low --time-limit 900 --concurrency 2 \
      --cache-dir "$cache" --json "$out" > "$console" 2>&1 )
  code=$?
  end=$(date +%s)
  printf '{"slug":"%s","mode":"after","start":%s,"end":%s,"seconds":%s,"exitCode":%s}\n' \
    "$slug" "$start" "$end" "$((end - start))" "$code" > "$dir/run-after-judged.json"
  echo "$(date -Iseconds) after $slug exit $code in $((end - start)) s" | tee -a "$STUDY/after-run-log.txt"
done
