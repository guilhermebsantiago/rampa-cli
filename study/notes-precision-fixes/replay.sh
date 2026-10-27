#!/usr/bin/env bash
# Judges the recorded snapshots of the second, third and fourth real-page studies with one build of Rampa, the studies'
# flags (--min-confidence low --time-limit 900 --concurrency 2) and a fresh copy of each page's judgment cache:
#   s2  fresh-2026-10-11 pages, the probe's cache-impl (precision-probe worktree), criteria 1.1.1, 1.3.5, 2.4.2,
#       3.1.1, 3.1.2 and 3.3.2: 2.4.4 and 2.4.6 changed version since the second study's run and their answers were
#       not kept, so their findings are carried from the study's re-judged run and the shared-text fact is replayed on
#       the snapshot by shared-text.ts (as the precision probe did);
#   s3  round-3-2026-10-23 pages, the probe's cache-impl, every default criterion;
#   s4  round-4-2026-10-24 pages, the main run's cache, every default criterion.
# offline: nothing is asked of a model (a miss is counted in each report's summary). online: what the cache lacks is
# asked of Gemma 4 12B through Ollama, and the copy of the cache keeps the new answers, so the run can be repeated
# offline.
#
# Run from the repository root:
#   bash study/notes-precision-fixes/replay.sh <label> <dist dir> offline|online [s2|s3|s4 ...]
# Recordings: $RECORDINGS (default C:/Users/guilh/dev/rampa-study-recordings); the probe's caches: $PROBE_PAGES
# (default the precision-probe worktree's study folder).
set -u
LABEL="$1"; DIST="$2"; MODE="$3"; shift 3
STUDIES="${*:-s2 s3 s4}"
ROOT="$(pwd)"
HERE="$ROOT/study/notes-precision-fixes"
RECORDINGS="${RECORDINGS:-C:/Users/guilh/dev/rampa-study-recordings}"
PROBE_PAGES="${PROBE_PAGES:-C:/Users/guilh/dev/rampa-cli/.claude/worktrees/precision-probe/study}"
OUT="$HERE/data/$LABEL"
WORK="$HERE/pages/$LABEL"
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
  local cache="$WORK/$study/$slug/cache"
  if [ ! -d "$cache" ]; then mkdir -p "$(dirname "$cache")"; cp -r "$source_cache" "$cache"; fi
  local start; start=$(date +%s)
  timeout 1200 node "$DIST/cli.mjs" check "$snapshot" \
      --model ollama:gemma4:12b --locale en --min-confidence low --time-limit 900 --concurrency 2 $OFFLINE \
      ${criteria:+--criteria "$criteria"} \
      --cache-dir "$cache" --json "$OUT/$study.$slug.report.json" > "$OUT/$study.$slug.console.txt" 2>&1
  local code=$?
  echo "$(date -Iseconds) $study $slug exit $code in $(( $(date +%s) - start )) s" | tee -a "$OUT/run-log.txt"
}

for study in $STUDIES; do
  case "$study" in
    s2) folder=fresh-2026-10-11 ;;
    s3) folder=round-3-2026-10-23 ;;
    s4) folder=round-4-2026-10-24 ;;
    *) echo "unknown study $study"; exit 1 ;;
  esac
  slugs "$ROOT/study/$folder/data/pages-input.json" | while read -r slug; do
    slug="${slug%$'\r'}"; [ -z "$slug" ] && continue
    case "$study" in
      s2) run s2 "$folder" "$slug" "$PROBE_PAGES/$folder/pages/$slug/cache-impl" "1.1.1,1.3.5,2.4.2,3.1.1,3.1.2,3.3.2" ;;
      s3) run s3 "$folder" "$slug" "$PROBE_PAGES/$folder/pages/$slug/cache-impl" "" ;;
      s4) run s4 "$folder" "$slug" "$RECORDINGS/$folder/pages/$slug/cache" "" ;;
    esac
  done
done
