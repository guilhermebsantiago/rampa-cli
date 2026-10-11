# Benchmark: Rampa and other accessibility checkers

Runs Rampa and other free, local accessibility checkers on the same pages, in the same browser, and scores them the same way: the W3C ACT test cases of every ACT rule that maps to a WCAG 2.2 A/AA criterion, and Rampa's corrupted pairs. The method, the tables and the caveats are in [docs/benchmark.md](../docs/benchmark.md).

This folder is its own pnpm project with its own lockfile: none of these tools is a dependency of Rampa. Rampa itself runs from this repository's `dist/cli.mjs`.

## Run it

You need Node.js 22.12+, pnpm, Microsoft Edge, and for the judged rows [Ollama](https://ollama.com) with `gemma4:12b` (`ollama pull gemma4:12b`).

```sh
pnpm install && pnpm build        # at the repository root: Rampa's dist/
cd bench
pnpm install                      # the other tools, pinned
node run.mjs --docs               # every row; writes results/<today>/ and the tables in ../docs/benchmark.md
```

The run of 2026-10-11 took about three and a half hours on a Ryzen 5 7600X with an RTX 5060 Ti (each row's wall time is in the results); most of it was Rampa's model and probes. An interrupted run resumes where it stopped: run the same command again. If the network dropped during the run, `node run.mjs --retry-errors --docs` checks again only the pages that failed to load. `--fresh` starts the day's folder over.

| Option | Effect |
| --- | --- |
| `--tools axe,rampa` | Only these rows: `axe`, `lighthouse`, `pa11y`, `pa11y-axe`, `ibm`, `alfa`, `qualweb`, `rampa`, `rampa-gemma`, `rampa-probes` |
| `--out <dir>` | Results folder (default `results/<YYYY-MM-DD>`) |
| `--workers <n>` | Pages at a time for each tool (default 2) |
| `--limit <n>` | A smoke test: the first n test cases of each ACT rule and the first n pairs of each corruption |
| `--fresh` | Start the folder over instead of resuming it |
| `--retry-errors` | Also check again the pages a tool could not load for a reason of the network or the machine (`net::ERR_…`, timeouts); other errors stay |
| `--score-only` | Run nothing; score the folder again (after editing `lib/score.mjs` or `lib/report.mjs`) |
| `--docs` | Write the tables into `../docs/benchmark.md`, between its `bench:tables` markers |
| `--port <n>` | Port of the local server for the pair pages (default 8765) |

Environment: `BENCH_BROWSER_PATH` points at another Chromium-based browser than Edge; `OLLAMA_BASE_URL` at an Ollama that is not on localhost. The Rampa rows run with no provider key in their environment (any `*_API_KEY` is removed), in a folder of their own, so no `.env` or `rampa.config` applies.

## What it does

1. **Cases** (`lib/cases.mjs`). Reads the W3C ACT test cases through Rampa's own build (`dist/eval/index.mjs`, the code `rampa eval` uses): the file cached in `../.rampa/act`, or downloaded on the first run, with its SHA-256 recorded. A rule is kept when it maps to a WCAG 2.2 A or AA criterion for conformance; device-motion rules are left out (no tool can move the device); SVG and XML cases are left out, as `rampa eval` leaves them out.
2. **Pairs** (`lib/pairs.mjs`, `lib/server.mjs`). Rampa's corruptors (`src/eval/pairs.ts`) break passed test pages on purpose. Each intact and corrupted half is built once in Edge, saved, and served from a local server at the test page's own path, so every tool loads the same two pages.
3. **Rows** (`lib/tools.mjs`, `tools/*.mjs`). Each tool runs over every page (Lighthouse over a sample, the probes row over the pages of criteria a probe checks), one tool at a time, two pages at a time, and writes one JSON line per page to `results/<date>/raw/<tool>.jsonl`: the criteria it failed (with the rule ids), the criteria it sent to review, and the time.
4. **Scores** (`lib/score.mjs`, `lib/report.mjs`). `scores.json` and `tables.md` in the results folder, and the tables of `docs/benchmark.md` with `--docs`.

## Results folder

| File | What |
| --- | --- |
| `run.json` | Date, Rampa commit, machine, browser, Ollama and model digest, ACT file hash, how long each row took |
| `cases.json` | The ACT rules and test cases scored, the rules left out and why, the rules Rampa was tuned on |
| `pairs.json` | Every pair: test case, corruption, elements changed, and a hash of each saved half |
| `raw/<tool>.jsonl` | One line per page: `fail` and `review` (criterion → rule ids), `low` for Rampa's findings below its threshold, `notice` for advice that is not scored, `failRules` (every rule that failed, WCAG or not), `ms` (`cold` on the first page of a Rampa process), `usage` (model calls), `error` when the tool could not check the page |
| `raw/<tool>.meta.json` | Versions, the criteria the tool claims, workers, and the start and end of each part of the run |
| `scores.json`, `tables.md` | Everything the tables show |

The saved pair pages and the proxied W3C files are in `.cache/` (not committed); the hashes in `pairs.json` say whether a rebuild changed a page.
