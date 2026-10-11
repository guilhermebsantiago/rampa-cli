#!/usr/bin/env bash
# Rebuilds the measurements of docs/studies/notes-244-246.md, from the repository root, after `pnpm build`.
#   bash study/notes-244-246/run.sh collect   # the twelve dev pages, with link destinations, no model (network, a browser)
#   bash study/notes-244-246/run.sh facts     # deterministic facts of every candidate, and the labelled dev claims per option
#   bash study/notes-244-246/run.sh act       # ACT test cases and pairs of 2.4.4 and 2.4.6 with the model, then each option
#   bash study/notes-244-246/run.sh dev       # the dev pages judged with the model, at most 10 candidates per criterion and page
# The model runs call ollama:gemma4:12b; add --offline to the node lines to replay a cache instead.
set -u
unset RAMPA_LOCALE RAMPA_MODEL
here=study/notes-244-246
case "${1:-}" in
  collect)
    mkdir -p .rampa/dev/snapshots .rampa/dev/reports
    for url in \
      https://www.gov.br/pt-br \
      https://www.gov.uk/find-local-council \
      https://www.ufc.br/pt \
      https://drauziovarella.uol.com.br/atividade-fisica/o-que-acontece-no-corpo-durante-uma-caminhada/ \
      https://www.sosma.org.br/contato \
      https://www.debian.org/ \
      https://www.barebones.com/contact/technical.html \
      https://webaim.org/techniques/alttext/ \
      https://agenciabrasil.ebc.com.br/cultura/noticia/2026-10/exposicao-em-sp-propoe-novo-olhar-sobre-historia-do-brasil \
      https://www.npr.org/sections/science/ \
      https://www.estantevirtual.com.br/biografias \
      https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/a
    do
      name=$(echo "$url" | sed -e 's#https://##' -e 's#[^A-Za-z0-9]#-#g' | cut -c1-60)
      # --offline with a model: links are followed and saved, and no model is called.
      node dist/cli.mjs check "$url" --criteria 2.4.4,2.4.6 --model ollama:gemma4:12b --offline --cache-dir .rampa/dev/cache-empty \
        --locale en --min-confidence low --max-candidates 0 --format json --output ".rampa/dev/reports/$name.json" --save .rampa/dev/snapshots > /dev/null 2>&1
      echo "$name exit=$?"
    done
    ;;
  facts)
    node "$here/dev-facts.ts" .rampa/dev/snapshots study/data/findings.json .rampa/dev/facts.json
    node "$here/groundable.ts" .rampa/dev/snapshots
    python -I "$here/dev_options.py" .rampa/dev/facts.json
    ;;
  act)
    node dist/cli.mjs eval --criteria 2.4.4,2.4.6 --model ollama:gemma4:12b --cache-dir .rampa/cache-eval --out-dir .rampa/runs --concurrency 2
    python -I "$here/options.py" "$(ls -d .rampa/runs/*-ollama-gemma4-12b | tail -1)/results.jsonl"
    ;;
  dev)
    mkdir -p .rampa/dev/judged
    for snap in .rampa/dev/snapshots/*.snapshot.json; do
      name=$(basename "$snap" .snapshot.json)
      node dist/cli.mjs check "$snap" --criteria 2.4.4,2.4.6 --model ollama:gemma4:12b --cache-dir .rampa/dev/cache --locale en \
        --min-confidence low --max-candidates 10 --format json --output ".rampa/dev/judged/$name.json" > /dev/null 2>&1
    done
    python -I "$here/dev_judged.py" .rampa/dev/judged
    ;;
  *)
    echo "usage: bash $here/run.sh collect|facts|act|dev" >&2
    exit 2
    ;;
esac
