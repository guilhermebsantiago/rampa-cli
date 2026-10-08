# Kit de demonstração

Arquivos para apresentar o Rampa num Linux, pensados para o Fedora.

| Arquivo | Para quê |
| --- | --- |
| `setup-fedora.sh` | Instala Node, pnpm, Chromium e Ollama, baixa o modelo e faz o build |
| `apresentacao.sh` | Demonstração guiada: cada Enter mostra o comando e a fala, roda e espera |
| `snapshot-summary.mjs` | Mostra a árvore normalizada que os critérios leem |
| `recorded/` | Páginas de exemplo gravadas (snapshot com as imagens e resultado do axe-core) e os julgamentos em cache, para o modo offline |

## Na véspera

```sh
git clone https://github.com/guilhermebsantiago/rampa-cli.git
cd rampa-cli
bash demo/setup-fedora.sh       # alguns GB de download: o modelo
bash demo/apresentacao.sh       # ensaio completo; também aquece o modelo e baixa os casos ACT
```

## Na hora

```sh
bash demo/apresentacao.sh                              # ao vivo se o modelo estiver no Ollama, senão offline
MODO=offline bash demo/apresentacao.sh                 # gravações: sem navegador, sem modelo, instantâneo
MODELO=ollama:gemma4:e4b bash demo/apresentacao.sh     # modelo menor, para máquina sem GPU
PASSO=4 bash demo/apresentacao.sh                      # recomeça do passo 4
```

O modo offline reproduz os julgamentos gravados com o Gemma 4 12B. O passo de avaliação precisa de internet para baixar as páginas de teste do W3C.
