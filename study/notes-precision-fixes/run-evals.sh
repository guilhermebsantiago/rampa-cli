#!/usr/bin/env bash
# The W3C ACT test cases and corrupted pairs before and after the precision fixes, with Gemma 4 12B through Ollama and
# one judgment cache (a copy of the precision probe's, which holds its 1.1.1 and demo-set answers): each criterion set
# is run first with the build before the fixes (6a8de75), then with the build after, so the second run reads the first
# run's answers and the two differ only by the rules. The after run of the demo's five criteria is what
# demo/recorded/eval/ollama-gemma4-12b is recorded from.
#
# Run from the repository root after building both: bash study/notes-precision-fixes/run-evals.sh <before dist> <after dist>
set -u
BEFORE="$1"; AFTER="$2"
ROOT="$(pwd)"
OUT="$ROOT/study/notes-precision-fixes/data/evals"
CACHE="$ROOT/.rampa/eval-cache"
mkdir -p "$OUT"
export RAMPA_BROWSER_CHANNEL=msedge
unset RAMPA_MODEL OPENAI_API_KEY ANTHROPIC_API_KEY GOOGLE_GENERATIVE_AI_API_KEY OPENROUTER_API_KEY GROQ_API_KEY

log() { echo "$(date -Iseconds) $*" | tee -a "$OUT/run-log.txt"; }
run() {
  local name="$1" dist="$2" criteria="$3"
  log "$name ($criteria)"
  node "$dist/cli.mjs" eval --criteria "$criteria" --model ollama:gemma4:12b --concurrency 2 --cache-dir "$CACHE" --out-dir "$OUT/$name" > "$OUT/$name.txt" 2>&1
  log "$name exit $?"
}

run 332-before "$BEFORE" 3.3.2
run 332-after "$AFTER" 3.3.2
run 111-before "$BEFORE" 1.1.1
run 111-after "$AFTER" 1.1.1
run demo-before "$BEFORE" 2.4.2,2.4.4,2.4.6,3.1.1,3.1.2
run demo-after "$AFTER" 2.4.2,2.4.4,2.4.6,3.1.1,3.1.2
