#!/usr/bin/env bash
# Judges the recorded snapshots of the second to fifth real-page studies with one build of Rampa, the studies' flags
# (--min-confidence low --time-limit 900 --concurrency 2) and a fresh copy of each page's judgment cache, as
# study/notes-precision-p1p2/replay.sh did, with every study's cache taken from the P1/P2 replay's final caches
# (recordings notes-precision-p1p2-2026-10-29/caches-after/<study>/<slug>/cache), which hold every answer main's code asks:
#   s2  fresh-2026-10-11 pages, criteria 1.1.1, 1.3.5, 2.4.2, 3.1.1, 3.1.2 and 3.3.2 (2.4.4 and 2.4.6 are carried from the
#       second study's re-judged run, as in the precision-fixes and P1/P2 replays; analyze.py applies P1's and P4's facts
#       to them from the P1/P2 prompts and data/facts.json);
#   s3  round-3-2026-10-23 pages, every default criterion;
#   s4  round-4-2026-10-24 pages, every default criterion;
#   s5  round-5 pages (both halves), every default criterion.
# offline: nothing is asked of a model (a miss is counted in each report's summary). online: what the cache lacks is asked
# of Gemma 4 12B through Ollama, and the copy of the cache keeps the new answers, so the run can be repeated offline.
# Each page runs in its own work directory as the working directory, as the fifth study's runs did.
#
# Run from the repository root:
#   bash study/notes-precision-p3p4/replay.sh <label> <dist dir> offline|online [s2|s3|s4|s5 ...]
# Recordings: $RECORDINGS (default C:/Users/guilh/dev/rampa-study-recordings). The consoles and full reports stay out of
# git (compact.py keeps the judged part); the fifth study's test half is counted only (analyze.py), never read.
set -u
LABEL="$1"; DIST="$2"; MODE="$3"; shift 3
STUDIES="${*:-s2 s3 s4 s5}"
ROOT="$(pwd)"
HERE="$ROOT/study/notes-precision-p3p4"
RECORDINGS="${RECORDINGS:-C:/Users/guilh/dev/rampa-study-recordings}"
CACHES="$RECORDINGS/notes-precision-p1p2-2026-10-29/caches-after"
OUT="$HERE/data/$LABEL"
WORK="$HERE/pages/$LABEL"
case "$DIST" in /*|?:*) ;; *) DIST="$ROOT/$DIST" ;; esac
mkdir -p "$OUT" "$WORK"
export RAMPA_BROWSER_CHANNEL=msedge
unset RAMPA_MODEL OPENAI_API_KEY ANTHROPIC_API_KEY GOOGLE_GENERATIVE_AI_API_KEY OPENROUTER_API_KEY GROQ_API_KEY
OFFLINE=""; [ "$MODE" = offline ] && OFFLINE="--offline"

slugs() {
  python -I -c "
import json, sys
sys.stdout.reconfigure(newline='\n')
for p in json.load(open(sys.argv[1], encoding='utf-8'))['pages']: print(p['slug'])
" "$1"
}

run() {
  local study="$1" folder="$2" slug="$3" source_cache="$4" criteria="$5"
  local snapshot; snapshot=$(ls "$RECORDINGS/$folder/pages/$slug/recording/"*.snapshot.json 2>/dev/null | head -n 1)
  [ -z "$snapshot" ] && { echo "$(date -Iseconds) $study $slug: no recording" | tee -a "$OUT/run-log.txt"; return; }
  local dir="$WORK/$study/$slug"
  local cache="$dir/cache"
  if [ ! -d "$cache" ]; then mkdir -p "$dir"; cp -r "$source_cache" "$cache"; fi
  local start; start=$(date +%s)
  ( cd "$dir" && timeout 1200 node "$DIST/cli.mjs" check "$snapshot" \
      --model ollama:gemma4:12b --locale en --min-confidence low --time-limit 900 --concurrency 2 $OFFLINE \
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
  slugs "$ROOT/study/$input/data/pages-input.json" | while read -r slug; do
    slug="${slug%$'\r'}"; [ -z "$slug" ] && continue
    case "$study" in
      s2) run s2 "$folder" "$slug" "$CACHES/s2/$slug/cache" "1.1.1,1.3.5,2.4.2,3.1.1,3.1.2,3.3.2" ;;
      s3|s4) run "$study" "$folder" "$slug" "$CACHES/$study/$slug/cache" "" ;;
      s5) run s5 "$folder" "$slug" "$CACHES/s5/$slug/cache" "" ;;
    esac
  done
done
