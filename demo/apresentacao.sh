#!/usr/bin/env bash
# Demonstração guiada do Rampa. Cada passo mostra o comando e a fala, espera Enter, roda e espera de novo.
#
#   bash demo/apresentacao.sh                         detecta o modo sozinho
#   MODO=offline bash demo/apresentacao.sh            gravações: sem navegador, sem modelo, instantâneo
#   MODO=ao-vivo MODELO=ollama:gemma4:e4b bash demo/apresentacao.sh
#   PASSO=5 bash demo/apresentacao.sh                 começa a partir do passo 5
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
export RAMPA_LOCALE=pt-BR

if [ ! -f dist/cli.mjs ]; then
  echo "Falta o build. Rode antes: bash demo/setup-fedora.sh"
  exit 1
fi
rampa() { node "$ROOT/dist/cli.mjs" "$@"; }

BOLD=$'\e[1m'; DIM=$'\e[2m'; CYAN=$'\e[36m'; GREEN=$'\e[32m'; YELLOW=$'\e[33m'; RESET=$'\e[0m'

MODELO="${MODELO:-ollama:gemma4:12b}"
REC="demo/recorded"
GRAVADO="--offline --model ollama:gemma4:12b --cache-dir $REC/cache"
if [ -z "${MODO:-}" ]; then
  if curl -fsS -m 2 http://localhost:11434/api/tags 2>/dev/null | grep -q "\"${MODELO#ollama:}\""; then MODO=ao-vivo; else MODO=offline; fi
fi
INICIO="${PASSO:-1}"
N=0

pausa() { read -rsp "${DIM}   [Enter]${RESET}" _; echo; }

# passo "título" "o que falar" "comando mostrado" "comando executado"
passo() {
  N=$((N + 1))
  [ "$N" -lt "$INICIO" ] && return
  clear
  printf '%s%s  %s%s\n' "$BOLD$CYAN" "$N." "$1" "$RESET"
  printf '%s%s%s\n\n' "$DIM" "$2" "$RESET"
  printf '%s$%s %s\n' "$GREEN" "$RESET" "$3"
  [ "$3" != "$4" ] && printf '%s  (%s: %s)%s\n' "$DIM" "$MODO" "$4" "$RESET"
  pausa
  eval "$4"
  echo
  pausa
}

alvo() { # alvo <página> → URL local ao vivo, gravação no modo offline
  if [ "$MODO" = offline ]; then echo "$REC/$(echo "$1" | sed 's#\.html$##; s#[^A-Za-z0-9]#-#g').snapshot.json $GRAVADO"; else echo "$1 --model $MODELO"; fi
}

clear
printf '%sRampa — demonstração%s\n' "$BOLD" "$RESET"
printf 'modo: %s%s%s' "$YELLOW" "$MODO" "$RESET"
[ "$MODO" = ao-vivo ] && printf ' · modelo: %s' "$MODELO"
printf '\n\n%sEnter avança. Ctrl+C sai. PASSO=n recomeça de um passo.%s\n' "$DIM" "$RESET"
pausa

passo "Abertura" \
  "Rampa é rampa em português: o que transforma uma escada em entrada para todo mundo." \
  "rampa" "rampa"

passo "Ambiente" \
  "Tudo roda local: Node, o Chromium do Fedora, axe-core e um modelo no Ollama. Nada sai da máquina." \
  "rampa doctor" "rampa doctor"

passo "Só o axe-core" \
  "A linha de base. O axe pega a logo sem alt e aprova o resto: ele confere se o atributo existe, não o que ele diz." \
  "rampa check examples/store/before.html --no-llm" "rampa check $(alvo examples/store/before.html) --no-llm"

passo "Com o julgamento" \
  "O modelo só vê o resíduo, um critério por vez, e cada achado precisa citar evidência que confere no snapshot." \
  "rampa check examples/store/before.html" "rampa check $(alvo examples/store/before.html)"

passo "Depois das correções" \
  "A página com os patches aplicados: nenhuma falha confirmada, e o relatório ainda diz o que ninguém verificou." \
  "rampa check examples/store/after.html" "rampa check $(alvo examples/store/after.html)"

passo "Em português" \
  "Página em português: o alt sugerido sai no idioma da página." \
  "rampa check examples/non-text-content/alt-quality.html" "rampa check $(alvo examples/non-text-content/alt-quality.html)"

passo "O que o núcleo enxerga" \
  "Os critérios não leem o DOM: leem esta árvore normalizada. Web, Android ou iOS viram o mesmo formato." \
  "node demo/snapshot-summary.mjs $REC/examples-store-before.snapshot.json" "node demo/snapshot-summary.mjs $REC/examples-store-before.snapshot.json"

passo "Mesma análise, sem navegador" \
  "O snapshot gravado é julgado de novo sem abrir browser nenhum. É assim que um app Android ou iOS entraria." \
  "rampa check $REC/examples-store-before.snapshot.json $GRAVADO" "rampa check $REC/examples-store-before.snapshot.json $GRAVADO"

if [ "$MODO" = offline ]; then
  AVAL="rampa eval --criteria 3.1.2 $GRAVADO"
else
  AVAL="rampa eval --criteria 3.1.2,1.1.1 --model $MODELO"
fi
passo "Avaliação contra o gabarito do W3C" \
  "Casos ACT do W3C e pares corrompidos: o axe dá o mesmo veredito ao íntegro e ao corrompido; o Rampa separa. Precisa de internet." \
  "rampa eval --criteria 3.1.2,1.1.1" "$AVAL"

passo "A verificação, provada por teste" \
  "Uma alegação com trecho inventado nunca chega ao relatório. Os testes mostram cada forma de rejeição." \
  "pnpm exec vitest run test/check.test.ts test/language-of-parts.test.ts" \
  "pnpm exec vitest run test/check.test.ts test/language-of-parts.test.ts --reporter=verbose 2>&1 | grep -vE '^ *$' | tail -32"

clear
printf '%sObrigado!%s\n\n' "$BOLD" "$RESET"
echo "  Código:  https://github.com/guilhermebsantiago/rampa-cli"
echo "  MIT · roda local · nunca declara uma página acessível"
echo
