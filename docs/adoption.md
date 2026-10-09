# Adopting Rampa on an existing codebase

A site that has been online for a while already has accessibility problems. Turn Rampa on in CI on the first day and every build fails on findings nobody introduced this week, and a check that always fails is one people learn to ignore. Three commands let a team start where it is:

| Command | What it is for |
| --- | --- |
| `rampa init` | Sets the project up: a config file, a waivers file, `.gitignore` lines and, with `--github`, a CI workflow |
| `rampa baseline` | Records today's findings, so later checks report only new ones |
| `rampa waive` and `rampa waivers` | Accept one finding on purpose, with a reason and an expiry date, and review those decisions |

A baseline is a list of known problems that still need fixing. A waiver is a decision that one finding is acceptable, for a stated reason and, ideally, for a limited time. Neither makes a page accessible, and the report still says what was not checked.

> Not to be confused with the *deterministic baseline* in the README and in `rampa eval`, which means axe-core alone (`--no-llm`). Here a baseline is a file of known findings.

## Set up: `rampa init`

```sh
rampa init                      # asks a few questions on a terminal
rampa init --yes --github       # no questions: flags and what it detects
rampa init --targets dist,http://localhost:4173/ --model ollama:gemma4:12b --yes
```

| It writes | What for |
| --- | --- |
| `rampa.config.ts` | Targets, criteria, minimum confidence and report language; a model only if you pin one |
| `.rampa/waivers.json` | An empty list of waivers, to commit |
| `.gitignore` | `.rampa/cache`, `.rampa/runs`, `.rampa/screenshots` and `.rampa/act`: local files, never worth committing |
| `.github/workflows/rampa.yml` | With `--github`: runs the Rampa action on pull requests and on `main`, with the report as a pull request comment and the findings in code scanning |

It never replaces a file that exists: it says it kept it. `--force` overwrites the config and the workflow, never the waivers, which hold decisions. Running `rampa init` again is safe: it only adds what is missing. It prints what it created, updated or kept.

| Option | Effect |
| --- | --- |
| `--targets <list>` | Pages to check, comma-separated: URLs, `.html` files or folders. Default: the first of `dist`, `build`, `out`, `_site`, `public` that has HTML in it |
| `-m, --model <provider:model>` | Pin a model in the config. Without it, each machine picks one, a local Ollama model first |
| `-c, --criteria <ids>` | Criteria to judge. Default: all six |
| `--min-confidence <level>` | `low`, `medium` (default) or `high` |
| `--github` | Also write the workflow |
| `--config-format <format>` | `ts`, `mts`, `mjs` or `json` |
| `-y, --yes` | Never ask, even on a terminal |
| `--force` | Overwrite an existing config and workflow |
| `--no-detect` | Do not look for local model servers |

**The config file type.** Node runs a TypeScript config by stripping its types (Node 22.18 and later). It reads a `.ts` file by the rules of its package, so `rampa init` writes `rampa.config.ts` in a package with `"type": "module"`, and `rampa.config.mts` otherwise: in a `"type": "commonjs"` package a `.ts` config fails on `export default`, and in a package without `"type"` Node parses it twice and prints a warning on every run. On a Node without type stripping it writes `rampa.config.mjs`. When `rampa` resolves from the project, the config imports `defineConfig` from it for types; otherwise it is a plain object, so it loads without Rampa installed.

**The model.** `rampa init` asks your Ollama and LM Studio servers what they have and says what `rampa check` will use. It does not pin a local model in the config on its own, because a CI runner has no local model. If you pin one with `--model`, the workflow sets `model: none`, so CI runs axe-core alone instead of failing on a model it cannot reach, until you name a hosted model there. A hosted model pinned in the config runs in CI with its key from the repository's secrets, which the workflow reads.

**The workflow.** It asks for `pull-requests: write` and `security-events: write`, which the action's pull request comment and code scanning upload need, and passes `locale` because the action's own default (`en`) would otherwise override the config's. Build or start the site in the steps before it; the comments in the file show where.

**The config file.** With `targets` in the config, `rampa check` and `rampa baseline` need no arguments. `criteria`, `minConfidence`, `runs`, `cacheDir` and `concurrency` apply too; the command line still wins over the file.

## Baselines: report only what is new

```sh
rampa baseline                                  # the config's targets
rampa baseline dist --model anthropic:claude-haiku-5-5
rampa check --baseline .rampa/baseline.json     # only findings the baseline does not have
```

`rampa baseline` checks the targets exactly like `rampa check`, with the same options, and writes every finding to `.rampa/baseline.json` (or `--out`, or the config's `baseline`). It records findings below the confidence threshold too, so lowering `--min-confidence` later does not turn known findings into new ones. It leaves waived findings out, so they come back when their waiver expires.

`rampa check --baseline <file>` then leaves out the findings the baseline has. With `baseline: '.rampa/baseline.json'` in the config, every `rampa check` does, CI included; `--no-baseline` turns it off for one run. The report says:

- how many known findings it held back. When nothing new is left it says "No new confirmed failures in what was checked; the baseline holds back N known finding(s)", never that there are no failures;
- which baseline findings it no longer found, so you can confirm the fix and record the baseline again;
- how many baseline findings this run could not check again, and why;
- when the baseline was recorded with another model, other criteria or without the judgment layer, since those find different things.

With `--format json`, the report's `findings` are the new ones, and `baseline` holds `known`, `fixed` and `unchecked`.

The exit code follows: with the default `--fail-on confirmed`, `rampa check` fails only on new confirmed findings.

### How a finding is recognized

Every finding has an id, its fingerprint: 12 hexadecimal characters built from the criterion, the element, and the engine rule or what was judged (the alt text, the link text, the heading, the declared language). It never depends on how the model words its answer, so the same problem keeps its id from run to run and from model to model.

The element is identified by its CSS path, such as `main > p:nth-of-type(3) > a`. When content is added above it, the path changes and so does the id. The baseline makes up for it: a finding with no match by id is matched by content, the engine rule and the element's start tag, or the criterion and what was judged. Each baseline entry matches one finding at most, so a second copy of a known problem is still new. Waivers do not do this: a waiver whose element moved stops matching, and `rampa waivers --report` lists it as unused.

A baseline finding counts as no longer found only where the run could have found it again. A judgment finding is not "fixed" when the run had no model, did not judge its criterion, or the model abstained, failed or had no cached answer on that criterion; the report counts those as not checked again.

### Keeping it current

- **Record with the model CI uses.** Another model judges differently. Recording with a local model and checking with a hosted one will show differences that are not changes to the site.
- **Record again after fixes.** The report lists what is no longer found. `rampa baseline` replaces the entries of the targets it checks and keeps the other targets in the file, so you can update one page at a time.
- **It refuses an incomplete run.** If the model failed on some candidates, or `--offline` had no cached answer for them, `rampa baseline` writes nothing and exits with 2: the baseline would miss their findings.
- **Targets are keys.** A local file is recorded by its path from the working directory, so run Rampa from the project root. A URL is recorded as given; a check of the same path on another host, such as a preview deployment, matches it when only one recorded URL has that path.

## Waivers: accept a finding on purpose

```sh
rampa check -f json -o report.json
rampa waive 5f085d8a3b9c --reason "Decorative logo; the link next to it names the store" --expires 2027-01-31 --report report.json
rampa waivers                      # what is waived, why, and until when
rampa waivers --report report.json # also flags waivers no finding needs anymore
rampa waivers --prune              # removes the expired ones
```

The id is the one the terminal report prints after `id`, or `fingerprint` in the JSON report. `rampa waive` records the reason (required), the author (`git config user.name`), the date and, with `--expires`, the last day the waiver applies. With `--report`, it also records what the finding is, so whoever reviews the change sees what is being waived; without it, Rampa looks the id up in the baseline. Waiving an id that is already waived renews it with the new reason and dates.

```json
[
  {
    "fingerprint": "5f085d8a3b9c",
    "reason": "Decorative logo; the link next to it names the store",
    "author": "Ana Souza",
    "date": "2026-10-08",
    "expires": "2027-01-31",
    "criterion": "1.1.1",
    "target": "dist/index.html",
    "ref": "html > body > header > img",
    "message": "Images must have alternative text"
  },
  "2c1d064d9cc7"
]
```

The file is a JSON array. An entry is an object with a `fingerprint`, or the bare fingerprint, as earlier versions wrote it; both apply. Fields Rampa does not know, such as a ticket number, are kept when it rewrites the file.

- **Expiry.** A waiver applies through its `expires` date, on the calendar of the machine that runs the check (CI runners use UTC). After that it no longer hides its finding, and the report names the waiver that expired. The finding comes back even if the baseline knows it: an expired waiver asks someone to look again.
- **Broken entries never apply.** An entry without a fingerprint, or with an `expires` that is not a `YYYY-MM-DD` date, hides nothing; `rampa check` warns about it and `rampa waivers` shows why. A file that is not valid JSON is an error, rather than silently no waivers.
- **Unused waivers.** Given JSON reports, `rampa waivers --report` flags the waivers that match no finding in them: the finding was fixed, or its element changed. A waiver for a page the reports did not check is not flagged.
- **Waived findings in the report.** The report counts them ("2 finding(s) waived"), and the JSON report lists them under `waived`.

The file is `.rampa/waivers.json` unless the config's `waivers` or `--file` says otherwise.

## Rolling it out in CI

1. **Set up.** `rampa init --github`, then edit the workflow: build or serve the site before the Rampa step, and point `targets` at what it produces.
2. **Choose the CI model.** Without a model and its key, CI runs axe-core alone, which is a fine first step. For the judgment layer, set `model` in the workflow and the provider's key as a secret.
3. **Record the baseline with that model.** `rampa baseline --model <the CI model>` on your machine, or in a one-off CI job. Commit `.rampa/baseline.json` and set `baseline: '.rampa/baseline.json'` in the config.
4. **Fail on new findings only.** With the baseline in the config, `rampa check --fail-on confirmed` fails only for confirmed findings the baseline does not have; the action does the same as long as it runs `rampa check` from the repository root, where it finds the config. Each new finding gets fixed, or waived with a reason and an expiry date that reviewers can see in the diff.
5. **Burn the baseline down.** Fix known findings page by page. The report lists what is no longer found; record the baseline again to lock the progress in, so a fixed problem cannot come back unnoticed.
6. **Review the waivers.** `rampa waivers --report` before a release: expired waivers fail the build until someone fixes the finding or renews the waiver, and unused ones can go.
7. **Retire the baseline.** When it is empty, remove the `baseline` line. From then on every confirmed finding fails the build.

The baseline and the waivers cover what Rampa checks. Everything the report lists as not checked still needs manual review and testing with people.

## Limits

- **An id follows the element's CSS path.** Changing the structure above an element changes its id. The baseline recognizes moved findings by content; waivers have to be renewed.
- **Pages that change on every load** (random ids, rotating content, ads) produce different paths or findings between runs. Check a stable build, or snapshots recorded with `rampa check --save`.
- **Models differ.** A baseline recorded with one model and compared against another will show judgment findings appearing and disappearing that have nothing to do with the site. The report says when the models differ.
- **Ids from before this version.** Judgment ids used to include the words the model quoted. For 3.1.1 and 3.1.2 the quote was an excerpt of the model's choosing, so those ids changed with the model's wording; now they are built from the declared language, so waivers of 3.1.1 and 3.1.2 findings made before have to be recorded again. For the other criteria, the id stays the same wherever the model had quoted the whole text, as verification requires for 1.1.1.
