#!/usr/bin/env bash
# Prepara um Fedora para a demonstração do Rampa: Node, pnpm, Chromium, o modelo e o build.
# Com GPU NVIDIA, instala o Ollama e baixa um modelo local. Sem GPU, pede a chave de um provedor (fica no .env).
# Uso, a partir da raiz do repositório:  bash demo/setup-fedora.sh
# Para forçar um modelo local:            RAMPA_DEMO_MODEL=gemma4:e4b bash demo/setup-fedora.sh
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

MODEL="${RAMPA_DEMO_MODEL:-}"
if [ -z "$MODEL" ] && command -v nvidia-smi >/dev/null && nvidia-smi >/dev/null 2>&1; then
  MODEL=gemma4:12b
fi

if [ -n "$MODEL" ]; then
  say "Ollama e o modelo local $MODEL (download de alguns GB)"
  if ! command -v ollama >/dev/null; then
    curl -fsSL https://ollama.com/install.sh | sh
  fi
  ollama pull "$MODEL" || warn "Não consegui baixar $MODEL. A demo ainda roda com MODO=offline (gravações)."
else
  say "Modelo por API (sem GPU NVIDIA, um modelo local seria lento aqui)"
  if [ -f .env ] && grep -qE '^[A-Z_]*(API_KEY|TOKEN)[A-Z_]*=.' .env; then
    echo "Já existe uma chave no .env: $(grep -oE '^[A-Z_]+=' .env | tr -d '=' | tr '\n' ' ')"
  elif [ -t 0 ]; then
    # A chave não aparece na tela e fica no .env, que o git ignora e só o seu usuário lê.
    read -rsp "Cole a chave da OpenAI (sk-…), ou Enter para pular: " KEY; echo
    if [ -n "$KEY" ]; then
      (umask 077 && printf 'OPENAI_API_KEY=%s\n' "$KEY" >> .env)
      echo "Chave salva em $ROOT/.env"
    fi
    unset KEY
  fi
  echo "Outros provedores: veja 'node dist/cli.mjs models' e ponha a chave no .env (ANTHROPIC_API_KEY, GEMINI_API_KEY…)."
  echo "Sem chave, a demo usa as gravações: MODO=offline bash demo/apresentacao.sh"
fi

say "Dependências e build do Rampa"
pnpm install --frozen-lockfile
pnpm build

say "Diagnóstico"
node dist/cli.mjs doctor || true

cat <<EOF

Pronto.
  Ensaio e apresentação:  bash demo/apresentacao.sh      (usa o Ollama ou a chave do .env)
  Outro modelo:           MODELO=openai:gpt-6-luna bash demo/apresentacao.sh
  Sem rede ou sem chave:  MODO=offline bash demo/apresentacao.sh
EOF
