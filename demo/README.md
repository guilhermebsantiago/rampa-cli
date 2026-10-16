# Kit de demonstração

Arquivos para apresentar o Rampa num Linux, pensados para o Fedora.

| Arquivo | Para quê |
| --- | --- |
| `setup-fedora.sh` | Instala Node, pnpm e Chromium e faz o build. Com GPU NVIDIA, instala o Ollama e baixa o modelo; sem GPU, pede a chave de um provedor e guarda no `.env` |
| `apresentacao.sh` | Demonstração guiada: cada Enter mostra o comando e a fala, roda e espera |
| `snapshot-summary.mjs` | Mostra a árvore normalizada que os critérios leem |
| `recorded/` | Páginas de exemplo gravadas (snapshot com as imagens e resultado do axe-core), os julgamentos delas em cache e uma avaliação gravada (`recorded/eval/`), para o modo offline |

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

O modo offline reproduz os julgamentos gravados com o Gemma 4 12B. Ao vivo, o passo de avaliação precisa de internet para baixar as páginas de teste do W3C. Depois do ensaio, o cache responde na hora; para chamadas de verdade ao vivo, apague `.rampa/cache` antes.

No modo offline, o passo de avaliação mostra uma avaliação gravada, `rampa compare demo/recorded/eval/ollama-gemma4-12b`, sem navegador, sem modelo e sem rede. `rampa eval --offline --cache-dir demo/recorded/cache` não serve para isso: o cache da demo guarda os julgamentos das páginas gravadas, não os das páginas do W3C, e as perguntas da avaliação mudam com a versão de cada critério e com o que as páginas de teste trazem (destinos de links, títulos das páginas linkadas). Para gravar a avaliação de novo, com o Ollama: `node dist/cli.mjs eval --criteria 2.4.2,2.4.4,2.4.6,3.1.1,3.1.2 --model ollama:gemma4:12b --out-dir demo/recorded/eval` e troque a pasta `ollama-gemma4-12b` pela nova.
