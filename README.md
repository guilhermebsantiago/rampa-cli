# Rampa

Accessibility checks beyond syntax.

Rampa runs a deterministic engine (axe-core, on the web) and sends only what it cannot decide to an LLM, one WCAG success criterion at a time. Every claim the model makes must cite a node and a quote that exist on the page. Claims that do not hold are dropped before anyone reads them.

> Rampa never says a page is accessible. It reports what was checked and what was not. No automated tool replaces a manual audit or testing with disabled people.

**Status:** early, local only (not on npm yet). The web surface works end to end. Two criteria have judgment modules: 1.1.1 Non-text Content, judged with vision, and 3.1.2 Language of Parts.

## Why

Tools like axe-core, Pa11y and Lighthouse decide well what can be checked from attributes and computed styles, roughly 30–40% of WCAG success criteria. When they cannot judge meaning, they pass. Rampa adds a judgment layer for that residue and measures what it adds.

First results, from `rampa eval --criteria 3.1.2,1.1.1 --model ollama:gemma4:12b` on 2026-10-07: axe-core 4.14.0, Gemma 4 12B running locally, reasoning off, one run, ACT test cases `a9a1483e`.

| Set | Cases | axe-core P / R | Rampa P / R / F1 |
| --- | --- | --- | --- |
| 3.1.2, ACT de46e4 (valid tag, syntax) | 19 | 1.00 / 1.00 | 1.00 / 1.00 / 1.00 |
| 3.1.2, ACT off6ek (language matches the text) | 13 | — / 0.00 | 0.75 / 0.75 / 0.75 |
| 3.1.2, corrupted pairs (`lang` swapped) | 10 | — / 0.00 | 0.83 / 1.00 / 0.91 |
| 1.1.1, ACT 23a2a8 (has a name, syntax) | 18 | 1.00 / 1.00 | 1.00 / 1.00 / 1.00 |
| 1.1.1, ACT qt1vmo (name is descriptive) | 16 | — / 0.00 | 1.00 / 0.67 / 0.80 |

axe-core gave the intact and the corrupted page the same verdict in every pair (0 of 5 for `lang`, 0 of 2 for `alt`); Rampa told them apart in 4 of 5 and 2 of 2. The judgment layer added no false positive on the syntax sets, and verification dropped one model claim that would have been one. The samples are small, so read these as a working pipeline, not as a result: the Wilson intervals are in `summary.json`.

## Quick start

Requires Node.js 22.12+ and Chrome or Edge (or `npx playwright-core install chromium`).

```sh
pnpm install
pnpm build
node dist/cli.mjs                 # intro and commands
node dist/cli.mjs doctor          # checks Node, browser, axe-core, Ollama and API keys
node dist/cli.mjs check examples/non-text-content/alt-quality.html --model ollama:gemma4:12b --locale pt-BR
node dist/cli.mjs check examples/language-of-parts/mismatch.html --model ollama:gemma4:12b
```

The first example is the case Rampa exists for: a photo of a dog with `alt="img-1"`. axe-core passes it because the alternative exists. Rampa looks at the image as rendered, flags the placeholder, and suggests an alternative in the page language:

```text
WCAG 1.1.1 (A) — Conteúdo não textual
  ✗ html > body > main > figure:nth-of-type(1) > img
    O texto alternativo "img-1" é um nome de arquivo ou um placeholder.
    Evidência: "img-1"
    Patch:
      - <img src="dog.svg" alt="img-1">
      + <img src="dog.svg" alt="Ilustração de um cachorro marrom com coleira vermelha">
    confiança alta · 1/1 rodadas · evidência verificada · id 81fa293e342a
```

`pnpm link --global` makes `rampa` available everywhere. During development, `node src/cli.ts` runs the TypeScript sources directly.

## Commands

| Command | What it does |
| --- | --- |
| `rampa` | Intro animation and the list of commands |
| `rampa check <targets...>` | Checks URLs, `.html` files, folders or snapshot `.json` files |
| `rampa eval` | Measures the baseline and the judgment layer on ACT test cases and corrupted pairs |
| `rampa models` | Recommended models per criterion, and which are ready on this machine |
| `rampa doctor` | Checks the environment |

Useful `check` options: `--criteria 1.1.1,3.1.2`, `--model provider:model`, `--no-llm` (baseline only), `--runs 3` (majority vote), `--reasoning none|low|medium|high`, `--format json`, `--offline` (cached judgments only), `--fail-on confirmed|any|never`, `--locale pt-BR`, `--verbose`.

Exit codes: `0` no confirmed failure, `1` confirmed failure, `2` execution or configuration error.

## Models

Pass `--model provider:model`, set `model` in `rampa.config.ts`, or let Rampa pick: a local Ollama model first, then the cheapest API with a key.

| Provider | Example | Credentials |
| --- | --- | --- |
| Ollama (local) | `ollama:gemma4:12b` | none; `OLLAMA_BASE_URL` if not on localhost |
| Anthropic | `anthropic:claude-haiku-5-5` | `ANTHROPIC_API_KEY` |
| OpenAI | `openai:gpt-6-luna` | `OPENAI_API_KEY` |
| Google | `google:gemini-3.5-flash-lite` | `GOOGLE_GENERATIVE_AI_API_KEY` or `GEMINI_API_KEY` |
| OpenRouter | `openrouter:<model>` | `OPENROUTER_API_KEY` |
| Any OpenAI-compatible server | `openai-compatible:<model>` | `RAMPA_OPENAI_COMPATIBLE_URL`, optional `RAMPA_OPENAI_COMPATIBLE_KEY` |

Keys only ever come from environment variables or a local `.env`, never from the config file. The recommendation per criterion is meant to come from `rampa eval`, not from generic benchmarks.

1.1.1 needs a model with vision (`gemma4:12b` has it). Local models run with reasoning off by default (`--reasoning none`), which cut a judgment from about 6 s to 2 s on an RTX 5060 Ti with the same answer; reasoning effort is a variable worth measuring with `rampa eval`.

**Subscriptions.** Anthropic does not allow third-party tools to offer claude.ai login or subscription limits unless approved ([Agent SDK docs](https://code.claude.com/docs/en/agent-sdk/overview)), so Rampa uses API keys. Claude Max and Team plans include monthly API credits ([Help Center](https://support.claude.com/en/articles/15036540)), which an API key can draw on.

## How it works

1. **Collect.** The target becomes a normalized accessibility snapshot: the accessibility tree with ARIA roles, names, languages, states and bounds, plus each image as rendered and the source markup. Criteria never read the DOM directly, which keeps the core platform-agnostic.
2. **Deterministic engine.** axe-core runs on the page. Its violations go straight to the report.
3. **Judgment.** Only the residue goes to the model: what the engine reported as incomplete, passed on syntax alone, or does not check at all. One prompt per criterion, minimal context, structured JSON output.
4. **Verification.** The cited node must exist and the quoted text must be in it. Otherwise the claim dies here and is counted in the discard rate.
5. **Report.** Findings by criterion, a patch when possible, and the coverage of the run: what the engine checked, what was judged, and what nobody checked.

Judgments are cached by a hash of prompt, model and context, so the same input never calls the model twice. `--runs k` asks k times and keeps the majority; agreement lowers or keeps the confidence.

### Any screen, not only the web

`rampa check screen.json` accepts a snapshot exported by any platform that follows [`schema/snapshot.schema.json`](schema/snapshot.schema.json): an Android view hierarchy, an iOS XCUITest export, a desktop UI Automation tree. Android, iOS and image-only collectors are on the roadmap.

## Evaluation

```sh
node dist/cli.mjs eval --criteria 3.1.2 --no-llm                  # baseline only
node dist/cli.mjs eval --criteria 3.1.2 --model ollama:gemma4:12b # baseline vs judgment
node dist/cli.mjs eval --criteria 3.1.2 --model ollama:gemma4:12b --no-verify   # ablation
```

The W3C ACT test cases are downloaded at run time (not redistributed) and their SHA-256 is recorded with every run. Corrupted pairs follow López-Gil & Pereira (2025): break a passing case on purpose and check that the verdict flips. Each run writes `results.jsonl` and `summary.json` to `.rampa/runs/`, with precision, recall, F1 and Wilson intervals per set, pair discrimination, discards, abstentions, tokens and estimated cost.

## Development

```sh
pnpm typecheck
pnpm test        # unit tests; the web tests run when Chrome or Edge is available
pnpm build       # dist/ and schema/
```

## Contributing

Issues and pull requests are welcome; start with [CONTRIBUTING.md](CONTRIBUTING.md). To report a vulnerability, see [SECURITY.md](SECURITY.md).

## Em português

O Rampa verifica acessibilidade além da sintaxe: roda o axe-core e manda só o resíduo que ele não sabe decidir para um LLM, um critério WCAG por vez, e descarta toda alegação sem evidência conferível na página. Use `--locale pt-BR` para o relatório em português. O Rampa nunca declara uma página acessível e não substitui auditoria manual nem teste com pessoas com deficiência.

## License

[MIT](LICENSE). Third-party material:

- [axe-core](https://github.com/dequelabs/axe-core) (MPL-2.0) is a dependency, loaded unmodified from `node_modules`.
- The prompts quote short normative passages of [WCAG 2.1](https://www.w3.org/TR/WCAG21/), Copyright © W3C, used under the [W3C Document License](https://www.w3.org/copyright/document-license/).
- The [W3C ACT test cases](https://act-rules.github.io/pages/license/) are downloaded at run time and never redistributed.
