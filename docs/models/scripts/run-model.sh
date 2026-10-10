#!/usr/bin/env bash
# One full `rampa eval` for one Ollama model, from an empty judgment cache of its own, timed. Every call to Ollama
# is logged (call-log.mjs), and Ollama's /api/ps and nvidia-smi are read every 15 s while the run lasts.
# From the repository root, after `pnpm build`:
#   bash docs/models/scripts/run-model.sh gemma4:12b run1
# Writes .rampa/model-runs/<tag>-<model>/ (meta.txt, calls.jsonl, vram.tsv, stdout.txt, stderr.txt) and the run
# itself to .rampa/runs/, as rampa eval always does.
set -u
model="$1"
tag="$2"
slug=$(echo "$model" | tr ':/' '--')
work=".rampa/model-runs/$tag-$slug"
cache=".rampa/cache-models/$tag-$slug"
if [ -e "$cache" ]; then echo "$cache exists: each run starts from an empty cache" >&2; exit 1; fi
mkdir -p "$work"
export RAMPA_CALL_LOG="$PWD/$work/calls.jsonl"

(
  while true; do
    printf '%s\t%s\t%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
      "$(curl -s --max-time 5 localhost:11434/api/ps | tr -d '\n')" \
      "$(nvidia-smi --query-gpu=memory.used,utilization.gpu --format=csv,noheader,nounits 2>/dev/null)" >> "$work/vram.tsv"
    sleep 15
  done
) &
poller=$!

{
  echo "model=$model"
  echo "commit=$(git rev-parse HEAD)"
  echo "start=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "start_epoch=$(date +%s)"
} > "$work/meta.txt"

node --import ./docs/models/scripts/call-log.mjs dist/cli.mjs eval --model "ollama:$model" --locale en --cache-dir "$cache" \
  > "$work/stdout.txt" 2> "$work/stderr.txt"
code=$?

{
  echo "end=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "end_epoch=$(date +%s)"
  echo "exit=$code"
} >> "$work/meta.txt"
kill "$poller" 2>/dev/null
wait "$poller" 2>/dev/null
echo "done $model exit=$code"
