# Kit de demonstração

Arquivos para apresentar o Rampa num Linux, pensados para o Fedora.

| Arquivo | Para quê |
| --- | --- |
| `setup-fedora.sh` | Instala Node, pnpm e Chromium e faz o build. Com GPU NVIDIA, instala o Ollama e baixa o modelo; sem GPU, pede a chave de um provedor e guarda no `.env` |
| `apresentacao.sh` | Demonstração guiada: cada Enter mostra o comando e a fala, roda e espera |
| `snapshot-summary.mjs` | Mostra a árvore normalizada que os critérios leem |
| `recorded/` | Páginas de exemplo gravadas (snapshot com as imagens e resultado do axe-core) e os julgamentos em cache, para o modo offline |

## Na véspera

```sh
git clone https://github.com/guilhermebsantiago/rampa-cli.git
cd rampa-cli
bash demo/setup-fedora.sh       # sem GPU, pede a chave da OpenAI sem mostrar na tela
bash demo/apresentacao.sh       # ensaio completo; enche o cache e baixa os casos ACT
```

A chave fica em `rampa-cli/.env` (o git ignora o arquivo), no formato `OPENAI_API_KEY=sk-…`. Vale o mesmo para qualquer outro provedor: `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` e os que `node dist/cli.mjs models` lista.

## Na hora

```sh
bash demo/apresentacao.sh                              # usa o Ollama, ou o primeiro provedor com chave
MODO=offline bash demo/apresentacao.sh                 # gravações: sem navegador, sem modelo, instantâneo
MODELO=anthropic:claude-haiku-5-5 bash demo/apresentacao.sh
PASSO=5 bash demo/apresentacao.sh                      # recomeça do passo 5
```

O modo offline reproduz os julgamentos gravados com o Gemma 4 12B. O passo de avaliação precisa de internet para baixar as páginas de teste do W3C. Depois do ensaio, o cache responde na hora; para chamadas de verdade ao vivo, apague `.rampa/cache` antes.
