# Command line

Every command, every option of `rampa check`, the exit codes and the configuration file. The [README](../README.md#common-usage) has the commands most people need.

## Examples

```sh
rampa check https://example.com                     # a live page
rampa check ./dist                                  # every .html file in a folder
rampa check page.html --no-llm                      # the deterministic baseline only
rampa check page.html --criteria 1.1.1              # one criterion
rampa check page.html --runs 3                      # majority vote; agreement sets the confidence
rampa check page.html --format json -o report.json  # for CI and other tools
rampa check page.html --sarif r.sarif --markdown r.md --html r.html   # more reports from one run
rampa check page.html --fail-on AA                  # exit 1 only for Level A and AA findings
rampa check https://example.com --crawl --max-pages 20                # a whole site, shared components once
rampa check https://example.com --device "iPhone 15" --color-scheme dark
rampa check page.html --locale pt-BR                # report in Portuguese
rampa check page.html --wcag 2.1                    # report against WCAG 2.1 instead of 2.2
rampa check page.html --profile cognitive           # add the cognitive accessibility advisories
rampa check screen.json                             # a snapshot exported by any platform
rampa check android:                                # the screen on a connected Android device
```

## Commands

| Command | What it does |
| --- | --- |
| `rampa` | The intro and the list of commands |
| `rampa check <targets...>` | Checks URLs, `.html` files, folders, snapshots, Android screens, XCUITest exports or PNG screenshots |
| `rampa init` | Sets Rampa up in a project: config, waivers, `.gitignore` and, with `--github`, a CI workflow |
| `rampa baseline` | Records today's findings, so `rampa check --baseline` reports only new ones |
| `rampa waive <id>` / `rampa waivers` | Accepts a finding with a reason and an expiry date; lists expired and unused waivers |
| `rampa eval` | Measures the baseline and the judgment layer on W3C ACT test cases and corrupted pairs |
| `rampa compare <runs...>` | Compares eval runs per criterion, with intervals and a paired test |
| `rampa mcp` | Serves Rampa to coding agents over the Model Context Protocol |
| `rampa models` | Recommended models per criterion, and which are ready on this machine |
| `rampa doctor` | Checks the environment |

## Exit codes

Exit codes: `0` no confirmed failure, `1` at least one confirmed failure (see `--fail-on`), `2` the run could not check: an execution, configuration or usage error, or judgment asked for and nothing judged (no model, an empty `--offline` cache, the time limit); `--no-llm` runs the deterministic layer only. See [exit codes](output-formats.md#exit-codes-and---fail-on).

## `check` options

| Option | Default | Effect |
| --- | --- | --- |
| `-c, --criteria <ids>` | eight | Criteria to judge: `1.1.1`, `1.3.5`, `2.4.2`, `2.4.4`, `2.4.6`, `3.1.1`, `3.1.2`, `3.3.2`; on request `1.4.5`, and the experimental `1.3.1`, `1.3.2`, `1.3.3`, `2.5.3` and `3.3.1` ([criteria](criteria.md)) |
| `-m, --model <provider:model>` | detected | Model for the judgment layer |
| `--no-llm` | | Deterministic layer only |
| `-r, --runs <k>` | `1` | Judgments per candidate, majority vote |
| `--reasoning <level>` | `none` locally | `provider-default`, `none`, `minimal`, `low`, `medium`, `high` |
| `--wcag <version>` | `2.2` | State coverage against WCAG `2.2` (55 A/AA criteria) or `2.1` (50) ([WCAG 2.2](wcag-2-2.md)) |
| `-f, --format <format>` | `pretty` | `pretty`, `json`, `sarif`, `markdown` or `html` ([formats](output-formats.md)) |
| `-o, --output <file>` | | Write the report to a file; with `pretty`, the file gets JSON |
| `--json`, `--sarif`, `--markdown`, `--html <file>` | | Also write that format from the same run |
| `--fail-on <policy>` | `confirmed` | `confirmed`, `any` (also the findings below the threshold), `A`, `AA`, `advisory` (confirmed findings and also the confirmed advisories of `--profile`, except a model's suggestions to review) or `none` |
| `--min-confidence <level>` | `medium` | The threshold, `low`, `medium` or `high`: findings below it are kept apart (`--verbose` lists them) and fail the build only under `--fail-on any`. `low` takes in every finding, the experimental checks' included, so they fail the build under the default `--fail-on confirmed` |
| `--verbose` | | List discarded claims, findings below the threshold and unchecked criteria; changes no finding and no exit code |
| `--baseline <file>`, `--no-baseline` | | Report only findings the baseline does not have ([adoption](adoption.md)) |
| `--follow-links <policy>` | `same-origin` | Read where links lead for 2.4.4: `none`, `same-origin` or `all` |
| `--max-candidates <n>` | `50` | Judge at most n candidates per criterion and page, those a checked fact could make a finding of first; the rest are reported as not judged (`0`: no cap) |
| `--time-limit <seconds>` | none | Stop asking the model this long after a page starts loading, and report what was judged by then |
| `--probe <kinds>` | `none` | Drive the page after collection: one or more of the 21 kinds, `all` (eight of them) or `interact` (the ten that press, click, type, drag or swipe) ([probes](probes.md)) |
| `--allow-submit <origin>`, `--submit-dry-run` | | Let the form probe submit forms on that exact origin, for test environments only; or list what it would submit, and submit nothing ([submitting forms](probes.md#submitting-forms---allow-submit)) |
| `--profile cognitive` | | Also run the cognitive accessibility advisories, which are never WCAG failures ([cognitive profile](cognitive-profile.md)) |
| `--fast`, `--no-fast` | | A preset for CI and pre-commit hooks: at most 10 candidates per criterion, batched judgment, no link following, probes, OCR or contrast from pixels, fewer image captures, a shorter wait; options you set win, and the report lists what it left out ([performance](performance.md)) |
| `--batch`, `--no-batch` | | Judge up to 8 candidates per model call where the criterion allows it (on with `--fast`) |
| `--changed [ref]` | | Of the local HTML files, check only those changed since a git ref (default: the merge base with the default branch); the report says what it skipped |
| `--timings` | | Record where each page's time goes, stage by stage, in the report and its JSON |
| `--save <dir>` | | Record each snapshot and its engine results, to check later without a browser |
| `--crawl`, `--sitemap`, `--max-pages`, `--max-depth`, `--include`, `--exclude`, `--ignore-query`, `--crawl-concurrency` | | Check a whole site ([crawl](crawl.md)) |
| `--storage-state`, `--header`, `--cookie`, `--device`, `--viewport`, `--color-scheme`, `--reduced-motion`, `--browser-locale`, `--wait-for`, `--timeout`, `--user-agent` | | Pages behind a login, phones, dark mode ([browser options](browser-options.md)) |
| `--offline` | | Cached judgments only, never call the model |
| `--no-confirm` | | Ablation: skip the second pass that confirms 1.1.1 claims resting on the model's reading ([criteria](criteria.md#111-non-text-content)) |
| `--no-verify` | | Ablation: keep the model's claims whose quoted evidence is not on the page, and change nothing else; the report says so. For measurement, never for CI |
| `--screenshots` | | Save full-page screenshots to `.rampa/screenshots` |
| `--cache-dir <dir>` | `.rampa/cache` | Judgment cache |
| `--concurrency <n>` | `4` | Parallel model calls |
| `--locale <locale>` | `en` | `en` or `pt-BR` |

## Configuration file

`rampa.config.mjs` or `rampa.config.json` in the working directory (`rampa.config.ts` works on Node 22.18+). Command-line options win over the file.

```js
export default {
  model: 'ollama:gemma4:12b',
  criteria: ['1.1.1', '1.3.5', '2.4.2', '2.4.4', '2.4.6', '3.1.1', '3.1.2', '3.3.2'],
  runs: 1,
  locale: 'en',
  minConfidence: 'medium',
}
```

API keys never go in this file: use environment variables or a local `.env`. `rampa init` writes a starting config for you.
