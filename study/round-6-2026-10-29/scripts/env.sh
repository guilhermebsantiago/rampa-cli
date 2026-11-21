#!/usr/bin/env bash
# Sourced by every run script of the sixth study. Sets:
#   STUDY  this study's folder (in git): pre-registration, scripts, data, compact reports, packets, labels
#   DATA   the folder out of git where each page runs: recordings, screenshots, caches, full reports, consoles
#          (RECORDINGS overrides; a short path, so the longest recording name stays under Windows' 260 characters)
#   CLI    the build of rampa-cli 0.1.2 made from the tag v0.1.2 (RAMPA_CLI overrides); the script stops unless it
#          prints 0.1.2
# and unsets RAMPA_MODEL and every API-key variable, so that no run can reach a hosted model. Each page runs with its
# own folder under DATA as the working directory, which holds no .env and no rampa.config.
ROOT="$(pwd)"
STUDY="$ROOT/study/round-6-2026-10-29"
DATA="${RECORDINGS:-C:/Users/guilh/dev/rampa-study-recordings/round-6}"
CLI="${RAMPA_CLI:-C:/Users/guilh/dev/rampa-cli/.claude/worktrees/v0.1.2/dist/cli.mjs}"
MODEL="ollama:gemma4:12b"
export RAMPA_BROWSER_CHANNEL=msedge
unset RAMPA_MODEL RAMPA_LOCALE RAMPA_CLI_CONCURRENCY RAMPA_CLI_TIMEOUT OPENAI_API_KEY ANTHROPIC_API_KEY \
  GOOGLE_GENERATIVE_AI_API_KEY GOOGLE_VERTEX_API_KEY OPENROUTER_API_KEY GROQ_API_KEY MISTRAL_API_KEY XAI_API_KEY \
  DEEPSEEK_API_KEY TOGETHER_API_KEY FIREWORKS_API_KEY CEREBRAS_API_KEY PERPLEXITY_API_KEY COHERE_API_KEY
for name in $(compgen -e); do case "$name" in *API_KEY*|*_KEY_*) unset "$name" ;; esac; done
[ -f "$STUDY/preregistration.md" ] || { echo "run from the repository root"; exit 1; }
version="$(node "$CLI" --version 2>/dev/null)"
[ "$version" = "0.1.2" ] || { echo "$CLI prints '$version', not 0.1.2"; exit 1; }
mkdir -p "$DATA/pages"

# The pages, in the order of data/pages-input.json (block 1, 2, 3): "slug<TAB>url<TAB>split<TAB>t4" per line.
pages() {
  python -I -c "
import json, sys
sys.stdout.reconfigure(newline='\n')
for p in json.load(open(sys.argv[1], encoding='utf-8'))['pages']:
    print('\t'.join((p['slug'], p['url'], p['split'], 'T4' if p['t4Subset'] else '-')))
" "$STUDY/data/pages-input.json"
}

# Whether a page is among the slugs given on the command line (all pages when none is given).
chosen() {
  local slug="$1"; shift
  [ "$#" -eq 0 ] && return 0
  case " $* " in *" $slug "*) return 0 ;; esac
  return 1
}

# Between pages: wait while the GPU is above 83 °C or less than 2 GB of memory is free (no frozen setting changes).
cool() {
  local temp free
  while :; do
    temp="$(nvidia-smi --query-gpu=temperature.gpu --format=csv,noheader,nounits 2>/dev/null | head -n 1 | tr -d ' \r')"
    free="$(awk '/MemFree/ {print int($2 / 1024)}' /proc/meminfo 2>/dev/null)"
    if [ "${temp:-0}" -gt 83 ] || [ "${free:-99999}" -lt 2048 ]; then
      echo "$(date -Iseconds) pause: GPU ${temp:-?} C, ${free:-?} MB free" | tee -a "$STUDY/run-log.txt"
      sleep 60
    else
      return 0
    fi
  done
}
