#!/usr/bin/env bash
# Prepara um Fedora para a demonstração do Rampa: Node, pnpm, Chromium, Ollama, modelo e build.
# Uso, a partir da raiz do repositório:  bash demo/setup-fedora.sh
# Para escolher o modelo:                 RAMPA_DEMO_MODEL=gemma4:12b bash demo/setup-fedora.sh
set -euo pipefail

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m!!  %s\033[0m\n' "$*"; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

say "Node.js 22.18 ou mais novo"
node_ok() { command -v node >/dev/null && node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=18)?0:1)'; }
if ! node_ok; then
  sudo dnf install -y nodejs nodejs-npm
fi
node_ok || { warn "O Node instalado é antigo. Tente: sudo dnf install -y nodejs24"; exit 1; }
node --version

say "pnpm"
if ! command -v pnpm >/dev/null; then
  sudo npm install --global pnpm@12
fi
pnpm --version

say "Navegador (Chromium do Fedora)"
if ! command -v chromium-browser >/dev/null && ! command -v chromium >/dev/null && ! command -v google-chrome >/dev/null; then
  sudo dnf install -y chromium
fi

say "Ollama"
if ! command -v ollama >/dev/null; then
  curl -fsSL https://ollama.com/install.sh | sh
fi

MODEL="${RAMPA_DEMO_MODEL:-}"
if [ -z "$MODEL" ]; then
  if command -v nvidia-smi >/dev/null && nvidia-smi >/dev/null 2>&1; then
    MODEL=gemma4:12b
  else
    MODEL=gemma4:e4b
    warn "Sem GPU NVIDIA: usando o modelo menor ($MODEL). Ao vivo vai ser mais lento; o modo offline continua instantâneo."
  fi
fi
say "Modelo: $MODEL (download de alguns GB)"
ollama pull "$MODEL" || warn "Não consegui baixar $MODEL. A demo ainda roda com MODO=offline (gravações)."

say "Dependências e build do Rampa"
pnpm install --frozen-lockfile
pnpm build

say "Diagnóstico"
node dist/cli.mjs doctor || true

cat <<EOF

Pronto.
  Ensaio e apresentação:  bash demo/apresentacao.sh
  Modelo menor ao vivo:   MODELO=ollama:$MODEL bash demo/apresentacao.sh
  Sem rede ou sem GPU:    MODO=offline bash demo/apresentacao.sh
EOF
