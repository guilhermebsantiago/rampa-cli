#!/usr/bin/env bash
# The W3C ACT cases and corrupted pairs of 1.1.1 and 2.4.4 before and after P1 and P2, with Gemma 4 12B through Ollama
# and one judgment cache: a fresh copy of the precision-fixes evaluation cache (recordings
# notes-precision-fixes-2026-10-27/eval-cache), which the round-5 notes' 2.4.4 runs read too. Each criterion is run first
# with main's build, then with this branch's, so the second run reads the first run's answers and asks only what its
# prompts change (P1's card-heading line); the two differ by the rules and those answers only.
#
# Run from the repository root after building both: bash study/notes-precision-p1p2/run-evals.sh <main dist> <branch dist>
set -u
BEFORE="$1"; AFTER="$2"
ROOT="$(pwd)"
OUT="$ROOT/study/notes-precision-p1p2/data/evals"
RECORDINGS="${RECORDINGS:-C:/Users/guilh/dev/rampa-study-recordings}"
CACHE="$ROOT/.rampa/eval-cache-p1p2"
mkdir -p "$OUT"
[ -d "$CACHE" ] || cp -r "$RECORDINGS/notes-precision-fixes-2026-10-27/eval-cache" "$CACHE"
export RAMPA_BROWSER_CHANNEL=msedge
unset RAMPA_MODEL OPENAI_API_KEY ANTHROPIC_API_KEY GOOGLE_GENERATIVE_AI_API_KEY OPENROUTER_API_KEY GROQ_API_KEY

log() { echo "$(date -Iseconds) $*" | tee -a "$OUT/run-log.txt"; }
run() {
  local name="$1" dist="$2" criteria="$3"
  log "$name ($criteria)"
  node "$dist/cli.mjs" eval --criteria "$criteria" --model ollama:gemma4:12b --concurrency 2 --cache-dir "$CACHE" --out-dir "$OUT/$name" > "$OUT/$name.txt" 2>&1
  log "$name exit $?"
}

run 111-main "$BEFORE" 1.1.1
run 111-p1p2 "$AFTER" 1.1.1
run 244-main "$BEFORE" 2.4.4
run 244-p1p2 "$AFTER" 2.4.4
