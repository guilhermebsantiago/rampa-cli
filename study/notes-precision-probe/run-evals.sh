#!/usr/bin/env bash
# The W3C ACT test cases and corrupted pairs, with Gemma 4 12B through Ollama, before and after the second pass:
#   1. 1.1.1 with the second pass on (the default), live: fills the cache with the judgments and the pass's answers;
#   2. 1.1.1 with --no-confirm on the same cache: the same judgments, scored without the pass;
#   3. the demo's recorded evaluation of 2.4.2, 2.4.4, 2.4.6, 3.1.1 and 3.1.2, recorded again into demo/recorded/eval.
# Run from the repository root after `pnpm build`:  bash study/notes-precision-probe/run-evals.sh
set -u
ROOT="$(pwd)"
OUT="$ROOT/study/notes-precision-probe/data/evals"
mkdir -p "$OUT"
export RAMPA_BROWSER_CHANNEL=msedge
unset RAMPA_MODEL OPENAI_API_KEY ANTHROPIC_API_KEY GOOGLE_GENERATIVE_AI_API_KEY OPENROUTER_API_KEY GROQ_API_KEY
CACHE="$ROOT/.rampa/cache"

log() { echo "$(date -Iseconds) $*" | tee -a "$OUT/run-log.txt"; }

log "1.1.1 after (second pass on)"
node dist/cli.mjs eval --criteria 1.1.1 --model ollama:gemma4:12b --concurrency 2 --cache-dir "$CACHE" --out-dir "$OUT/111-after" > "$OUT/111-after.txt" 2>&1
log "1.1.1 after exit $?"
log "1.1.1 before (--no-confirm, same cache)"
node dist/cli.mjs eval --criteria 1.1.1 --model ollama:gemma4:12b --concurrency 2 --no-confirm --cache-dir "$CACHE" --out-dir "$OUT/111-before" > "$OUT/111-before.txt" 2>&1
log "1.1.1 before exit $?"
log "demo eval: 2.4.2,2.4.4,2.4.6,3.1.1,3.1.2"
node dist/cli.mjs eval --criteria 2.4.2,2.4.4,2.4.6,3.1.1,3.1.2 --model ollama:gemma4:12b --concurrency 2 --cache-dir "$CACHE" --out-dir "$OUT/demo-eval" > "$OUT/demo-eval.txt" 2>&1
log "demo eval exit $?"
