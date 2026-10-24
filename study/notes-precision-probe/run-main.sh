#!/usr/bin/env bash
# Judges the third study's 24 saved snapshots again with the build of this worktree (main at 15b1149: the
# robustness and remaining-errors branches merged), the study's flags, and a copy of each page's recorded
# judgment cache: a prompt that did not change (2.4.4 version 3, 2.4.6 version 4, 1.3.5, 2.4.2, 3.1.x, 3.3.2) is
# read back, and 1.1.1, whose prompt is version 5 now, is asked again of Gemma 4 12B through Ollama.
#
# Run from the repository root after `pnpm build`; the build is copied first, so later edits to src do not change
# what runs:  bash study/notes-precision-probe/run-main.sh [slug ...]
set -u
ROOT="$(pwd)"
STUDY="$ROOT/study/round-3-2026-10-23"
OUT="$ROOT/study/notes-precision-probe/data/main-15b1149"
DIST="$ROOT/.rampa/dist-main-15b1149"
mkdir -p "$OUT"
mkdir -p "$(dirname "$DIST")"
if [ ! -f "$DIST/cli.mjs" ]; then rm -rf "$DIST"; cp -r "$ROOT/dist" "$DIST"; fi
export RAMPA_BROWSER_CHANNEL=msedge
unset RAMPA_MODEL OPENAI_API_KEY ANTHROPIC_API_KEY GOOGLE_GENERATIVE_AI_API_KEY OPENROUTER_API_KEY GROQ_API_KEY

python -I -c "
import json, sys
sys.stdout.reconfigure(newline='\n')
for p in json.load(open(sys.argv[1], encoding='utf-8'))['pages']: print(p['slug'])
" "$STUDY/data/pages-input.json" | while read -r slug; do
  slug="${slug%$'\r'}"
  [ -z "$slug" ] && continue
  if [ "$#" -gt 0 ]; then case " $* " in *" $slug "*) ;; *) continue ;; esac; fi
  dir="$STUDY/pages/$slug"
  snapshot=$(ls "$dir"/recording/*.snapshot.json 2>/dev/null | head -n 1)
  [ -z "$snapshot" ] && { echo "$slug: no recording"; continue; }
  cache="$dir/cache-main15b1149"
  if [ ! -d "$cache" ]; then cp -r "$dir/cache" "$cache"; fi
  start=$(date +%s)
  ( cd "$dir" && timeout 1000 node "$DIST/cli.mjs" check "$snapshot" \
      --model ollama:gemma4:12b --locale en --min-confidence low --time-limit 900 --concurrency 2 \
      --cache-dir "$cache" --json "$OUT/$slug.report.json" > "$OUT/$slug.console.txt" 2>&1 )
  code=$?
  end=$(date +%s)
  echo "$(date -Iseconds) $slug exit $code in $((end - start)) s" | tee -a "$OUT/run-log.txt"
done
