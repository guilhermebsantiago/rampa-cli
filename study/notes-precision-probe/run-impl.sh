#!/usr/bin/env bash
# Judges the recorded snapshots of the third study (all default criteria) and of the second study (the criteria whose
# prompts are unchanged since its run, plus 1.1.1, whose version-5 prompt is asked again) with the implementation of the
# precision probe's interventions, the studies' flags, and a copy of each page's judgment cache: what did not change is
# read back, the rest is asked of Gemma 4 12B through Ollama. The second pass's answers are new calls on both.
#
# Run from the repository root after `pnpm build`:  bash study/notes-precision-probe/run-impl.sh [s3|s2]
set -u
WHICH="${1:-both}"
ROOT="$(pwd)"
OUT="$ROOT/study/notes-precision-probe/data/impl"
DIST="$ROOT/.rampa/dist-impl"
mkdir -p "$OUT" "$(dirname "$DIST")"
rm -rf "$DIST"; cp -r "$ROOT/dist" "$DIST"
export RAMPA_BROWSER_CHANNEL=msedge
unset RAMPA_MODEL OPENAI_API_KEY ANTHROPIC_API_KEY GOOGLE_GENERATIVE_AI_API_KEY OPENROUTER_API_KEY GROQ_API_KEY

run() {
  local study="$1" slug="$2" source_cache="$3" criteria="$4"
  local dir="$ROOT/study/$study/pages/$slug"
  local snapshot; snapshot=$(ls "$dir"/recording/*.snapshot.json 2>/dev/null | head -n 1)
  [ -z "$snapshot" ] && { echo "$slug: no recording"; return; }
  local cache="$dir/cache-impl"
  if [ ! -d "$cache" ]; then cp -r "$dir/$source_cache" "$cache"; fi
  local start; start=$(date +%s)
  ( cd "$dir" && timeout 1200 node "$DIST/cli.mjs" check "$snapshot" \
      --model ollama:gemma4:12b --locale en --min-confidence low --time-limit 900 --concurrency 2 \
      ${criteria:+--criteria "$criteria"} \
      --cache-dir "$cache" --json "$OUT/$study.$slug.report.json" > "$OUT/$study.$slug.console.txt" 2>&1 )
  local code=$?
  echo "$(date -Iseconds) $study $slug exit $code in $(( $(date +%s) - start )) s" | tee -a "$OUT/run-log.txt"
}

slugs() {
  python -I -c "
import json, sys
sys.stdout.reconfigure(newline='\n')
for p in json.load(open(sys.argv[1], encoding='utf-8'))['pages']: print(p['slug'])
" "$1"
}

if [ "$WHICH" = s3 ] || [ "$WHICH" = both ]; then
  slugs "$ROOT/study/round-3-2026-10-23/data/pages-input.json" | while read -r slug; do
    slug="${slug%$'\r'}"; [ -z "$slug" ] && continue
    run round-3-2026-10-23 "$slug" cache-main15b1149 ""
  done
fi
if [ "$WHICH" = s2 ] || [ "$WHICH" = both ]; then
  # 2.4.4 and 2.4.6 changed versions since the second study's run, and their answers were not kept: their findings are
  # the second study's re-judged run's (data/rows.json, study s2-after), scored by simulate.py; the rest is run here.
  slugs "$ROOT/study/fresh-2026-10-11/data/pages-input.json" | while read -r slug; do
    slug="${slug%$'\r'}"; [ -z "$slug" ] && continue
    run fresh-2026-10-11 "$slug" cache "1.1.1,1.3.5,2.4.2,3.1.1,3.1.2,3.3.2"
  done
fi
