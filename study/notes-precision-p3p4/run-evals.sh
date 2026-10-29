#!/usr/bin/env bash
# The W3C ACT cases and corrupted pairs of 1.1.1 and 2.4.4 before and after P3, P4 and the card-heading refinement,
# with Gemma 4 12B through Ollama and one judgment cache: a fresh copy of the P1/P2 evaluation cache (recordings
# notes-precision-p1p2-2026-10-29/eval-cache, after its four runs). Each criterion is run first with main's build, then
# with this branch's, so the second run reads the first run's answers and asks only what its prompts change (none is
# expected: P3 and P4 change no prompt, and the refinement only drops the card line where a heading says nothing); the
# two differ by the rules and those answers only. Links are followed as `rampa eval` does by default (same-origin), and
# what was read at each address is kept in .rampa/destinations, which both builds read.
#
# Run from the repository root after building both: bash study/notes-precision-p3p4/run-evals.sh <main dist> <branch dist>
set -u
BEFORE="$1"; AFTER="$2"
ROOT="$(pwd)"
OUT="$ROOT/study/notes-precision-p3p4/data/evals"
RECORDINGS="${RECORDINGS:-C:/Users/guilh/dev/rampa-study-recordings}"
CACHE="$ROOT/.rampa/eval-cache-p3p4"
mkdir -p "$OUT"
[ -d "$CACHE" ] || cp -r "$RECORDINGS/notes-precision-p1p2-2026-10-29/eval-cache" "$CACHE"
export RAMPA_BROWSER_CHANNEL=msedge
unset RAMPA_MODEL OPENAI_API_KEY ANTHROPIC_API_KEY GOOGLE_GENERATIVE_AI_API_KEY OPENROUTER_API_KEY GROQ_API_KEY

log() { echo "$(date -Iseconds) $*" | tee -a "$OUT/run-log.txt"; }
run() {
  local name="$1" dist="$2" criteria="$3"
  log "$name ($criteria)"
  node "$dist/cli.mjs" eval --criteria "$criteria" --model ollama:gemma4:12b --concurrency 2 --cache-dir "$CACHE" --out-dir "$OUT/$name" > "$OUT/$name.txt" 2>&1
  log "$name exit $?"
}

run 244-main "$BEFORE" 2.4.4
run 244-p3p4 "$AFTER" 2.4.4
run 111-main "$BEFORE" 1.1.1
run 111-p3p4 "$AFTER" 1.1.1
