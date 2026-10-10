#!/usr/bin/env bash
# GPU memory each model takes when it is the only one loaded: nvidia-smi before and after one short request.
#   bash docs/models/scripts/memory.sh gemma4:12b qwen3.5:9b
for model in "$@"; do
  loaded=$(curl -s localhost:11434/api/ps | python -I -c "import json,sys; print(','.join(m['name'] for m in json.load(sys.stdin)['models']))")
  if [ -n "$loaded" ]; then echo "$model: skipped, already loaded: $loaded"; continue; fi
  before=$(nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits)
  curl -s localhost:11434/v1/chat/completions -H 'content-type: application/json' \
    -d "{\"model\":\"$model\",\"messages\":[{\"role\":\"user\",\"content\":\"Say OK.\"}],\"reasoning_effort\":\"none\",\"temperature\":0}" > /dev/null
  after=$(nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits)
  ps=$(curl -s localhost:11434/api/ps | python -I -c "import json,sys; print([(m['name'], round(m['size_vram']/2**30, 2), m['context_length']) for m in json.load(sys.stdin)['models']])")
  echo "$model: before ${before} MiB, after ${after} MiB, delta $((after - before)) MiB, /api/ps $ps"
  ollama stop "$model"
  sleep 3
done
