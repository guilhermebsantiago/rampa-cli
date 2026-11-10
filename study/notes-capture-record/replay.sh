#!/usr/bin/env bash
# Judges the recorded snapshots of the dev halves of the second to fifth real-page studies (12 pages each) with one
# build of Rampa, offline, the studies' flags (--min-confidence low --time-limit 900 --concurrency 2) and a fresh copy
# of each page's judgment cache from the P3/P4 replay's final caches (recordings
# notes-precision-p3p4-2026-10-29/caches-after/<study>/<slug>/cache), as study/notes-precision-p3p4/replay.sh did:
#   s2  fresh-2026-10-11 pages, criteria 1.1.1, 1.3.5, 2.4.2, 3.1.1, 3.1.2 and 3.3.2;
#   s3  round-3-2026-10-23 pages, every default criterion;
#   s4  round-4-2026-10-24 pages, every default criterion;
#   s5  round-5 pages, every default criterion.
# --offline asks no model: an answer the cache lacks is counted in each report's summary (offlineMisses), and Ollama
# need not run. Each page runs in its own work directory as the working directory, as the fifth study's runs did.
# Only pages whose split is "dev" in the study's data/pages.json are run: no test page is opened.
#
# Run from the repository root:
#   bash study/notes-capture-record/replay.sh <label> <dist dir> [s2|s3|s4|s5 ...]
# Recordings: $RECORDINGS (default C:/Users/guilh/dev/rampa-study-recordings). The full reports, consoles and cache
# copies go to .rampa/capture-record/ (ignored by git); compare.ts keeps the comparison and the table in data/.
set -u
LABEL="$1"; DIST="$2"; shift 2
STUDIES="${*:-s2 s3 s4 s5}"
ROOT="$(pwd)"
RECORDINGS="${RECORDINGS:-C:/Users/guilh/dev/rampa-study-recordings}"
CACHES="$RECORDINGS/notes-precision-p3p4-2026-10-29/caches-after"
OUT="$ROOT/.rampa/capture-record/replay/$LABEL"
WORK="$ROOT/.rampa/capture-record/pages/$LABEL"
case "$DIST" in /*|?:*) ;; *) DIST="$ROOT/$DIST" ;; esac
mkdir -p "$OUT" "$WORK"
export RAMPA_BROWSER_CHANNEL=msedge
unset RAMPA_MODEL OPENAI_API_KEY ANTHROPIC_API_KEY GOOGLE_GENERATIVE_AI_API_KEY OPENROUTER_API_KEY GROQ_API_KEY

dev_slugs() {
  python -I -c "
import json, sys
sys.stdout.reconfigure(newline='\n')
for p in json.load(open(sys.argv[1], encoding='utf-8')):
    if p['split'] == 'dev': print(p['slug'])
" "$1"
}

run() {
  local study="$1" folder="$2" slug="$3" criteria="$4"
  local snapshot; snapshot=$(ls "$RECORDINGS/$folder/pages/$slug/recording/"*.snapshot.json 2>/dev/null | head -n 1)
  [ -z "$snapshot" ] && { echo "$(date -Iseconds) $study $slug: no recording" | tee -a "$OUT/run-log.txt"; return; }
  local dir="$WORK/$study/$slug"
  local cache="$dir/cache"
  if [ ! -d "$cache" ]; then mkdir -p "$dir"; cp -r "$CACHES/$study/$slug/cache" "$cache"; fi
  local start; start=$(date +%s)
  ( cd "$dir" && timeout 1200 node "$DIST/cli.mjs" check "$snapshot" \
      --model ollama:gemma4:12b --locale en --min-confidence low --time-limit 900 --concurrency 2 --offline \
      ${criteria:+--criteria "$criteria"} \
      --cache-dir "$cache" --json "$OUT/$study.$slug.report.json" > "$OUT/$study.$slug.console.txt" 2>&1 )
  local code=$?
  echo "$(date -Iseconds) $study $slug exit $code in $(( $(date +%s) - start )) s" | tee -a "$OUT/run-log.txt"
}

for study in $STUDIES; do
  case "$study" in
    s2) folder=fresh-2026-10-11; input=fresh-2026-10-11 ;;
    s3) folder=round-3-2026-10-23; input=round-3-2026-10-23 ;;
    s4) folder=round-4-2026-10-24; input=round-4-2026-10-24 ;;
    s5) folder=round-5; input=round-5-2026-10-28 ;;
    *) echo "unknown study $study"; exit 1 ;;
  esac
  dev_slugs "$ROOT/study/$input/data/pages.json" | while read -r slug; do
    slug="${slug%$'\r'}"; [ -z "$slug" ] && continue
    case "$study" in
      s2) run s2 "$folder" "$slug" "1.1.1,1.3.5,2.4.2,3.1.1,3.1.2,3.3.2" ;;
      *) run "$study" "$folder" "$slug" "" ;;
    esac
  done
done
