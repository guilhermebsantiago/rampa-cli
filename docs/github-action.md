# GitHub Action

The action runs `rampa check` in a workflow, uploads the SARIF report to code scanning, and keeps one comment on the pull request with the Markdown report, edited on every push. The job fails according to `fail-on`.

The action installs the CLI from npm: `rampa-cli` at the version in the `package.json` of the action's ref, so `@v0.1.1` runs exactly the `rampa-cli` 0.1.1 that `npm install rampa-cli@0.1.1` gives, built and published by Rampa's release workflow. Only when that version is not on npm, as on a branch whose version was never released or in a fork that changed it, does the action build the CLI from its own checkout instead, and the job log says which of the two it did ([what the steps do](#what-the-steps-do)).

**Pin a version.** The examples below use `guilhermebsantiago/rampa-cli@v0.1.1`, the release published to npm as `rampa-cli` 0.1.1. `@main` moves with every change merged into Rampa, so the same workflow could check differently from one run to the next. For the strictest pin, use the full commit SHA the tag points to, such as `uses: guilhermebsantiago/rampa-cli@<40-character SHA>`, and move it when you choose to.

## A complete workflow

Save as `.github/workflows/accessibility.yml` (the same file is in [`examples/github-workflow.yml`](../examples/github-workflow.yml)):

```yaml
name: accessibility

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read
  pull-requests: write # the sticky comment with the report
  security-events: write # the SARIF upload to code scanning
  actions: read # the SARIF upload, in private repositories

jobs:
  rampa:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5

      # If your HTML is generated, build it here first, for example:
      # - run: npm ci && npm run build

      # Optional: keep judgments between runs, so an unchanged element is never judged twice.
      - uses: actions/cache@v4
        with:
          path: .rampa/cache
          key: rampa-${{ github.run_id }}
          restore-keys: rampa-

      - name: Check accessibility
        id: rampa
        uses: guilhermebsantiago/rampa-cli@v0.1.1
        with:
          targets: site/
          fail-on: AA
        env:
          # The judgment layer needs a model. With this secret, Rampa picks Claude Haiku
          # (the model input chooses another); without it, as on pull requests from forks,
          # it runs the deterministic layer alone (--no-llm) instead of failing.
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}

      - name: Keep the HTML report
        if: always() && steps.rampa.outputs.html != ''
        uses: actions/upload-artifact@v4
        with:
          name: rampa-report
          path: ${{ steps.rampa.outputs.html }}
```

Targets are paths in your repository (files or folders of `.html` files) or URLs. To check a site that needs a server, start it in an earlier step and pass its address, such as `http://localhost:4173/`; findings on URLs have no file to point to, so they show in the comment and the HTML report but not as code scanning annotations.

## Fast checks on pull requests

A full check reads each page for several seconds before any model call (pixel contrast, link destinations, image captures) and makes a call per candidate. On pull requests, `--fast` and `--changed` keep the job short; [performance.md](performance.md) has the measurements behind them:

```yaml
      - uses: actions/checkout@v5
        with:
          fetch-depth: 0 # --changed compares with the merge base, which a shallow clone lacks

      # ...

      - name: Check accessibility
        uses: guilhermebsantiago/rampa-cli@v0.1.1
        with:
          targets: site/
          fail-on: AA
          # Pull requests: the fast preset, on the pages they changed. main: the full check.
          args: ${{ github.event_name == 'pull_request' && '--fast --changed' || '' }}
```

- `--fast` judges at most 10 candidates per criterion, several per model call, skips link destinations and contrast measured from pixels, captures fewer images and waits less after load. The comment and every report say it ran in fast mode and list what it left out, under the coverage.
- `--changed` checks only the local `.html` files changed since the merge base with `origin/main` (or `origin/master`), and the report notes how many it skipped. With another default branch, name it: `--changed=origin/${{ github.base_ref }}`. A change to a shared style sheet or script changes pages whose HTML did not change; the full check on `main` sees those.
- If CI uses a baseline, record it with `rampa baseline --fast` so it lists what a fast run sees ([adoption.md](adoption.md#keeping-ci-fast)).

## Inputs

| Input | Default | What it does |
| --- | --- | --- |
| `targets` | required | URLs, `.html` files or folders, separated by spaces or new lines. Quote a path that has spaces; a backslash is kept as written. |
| `criteria` | all six | Criteria to judge, comma-separated, such as `1.1.1,2.4.4` |
| `model` | detected | `provider:model` for the judgment layer, or `none` for `--no-llm`. See [the model](#the-model) |
| `fail-on` | `confirmed` | `confirmed`, `any`, `A`, `AA` or `none`; see [exit codes](output-formats.md#exit-codes-and---fail-on) |
| `locale` | `en` | Report language: `en` or `pt-BR` |
| `comment` | `true` | Post the Markdown report as one sticky pull request comment |
| `comment-key` | | Gives a job its own comment, when several jobs report on one pull request (a matrix, say) |
| `sarif` | `true` | Upload the SARIF report to code scanning |
| `sarif-category` | `rampa` | Code scanning category; give each upload its own when you run the action more than once |
| `summary` | `true` | Add the Markdown report to the job summary |
| `working-directory` | `.` | Where `rampa check` runs. Targets, `.rampa/waivers.json` and `.rampa/cache` are read from there |
| `args` | | More options for `rampa check`, such as `--min-confidence high --runs 3`, or `--fast --changed` on pull requests ([above](#fast-checks-on-pull-requests)) |
| `github-token` | `github.token` | Token for the comment |
| `node-version` | `24` | Node.js for installing and running Rampa (22.18 or later). Empty uses the Node.js already set up in the job |
| `from-source` | `false` | `true` builds Rampa from the action's checkout even when its version is on npm: to try changes on a branch, such as `@main` between releases, whose `package.json` still names the last release |

## Outputs

| Output | What it holds |
| --- | --- |
| `findings` | Number of confirmed findings |
| `exit-code` | `0` passed, `1` failed the `fail-on` policy, `2` could not finish |
| `sarif`, `markdown`, `html`, `json` | Paths of the reports, in a new folder under `$RUNNER_TEMP/rampa` for each run |

## What the steps do

1. **Set up Node.js** with `actions/setup-node`, without its package cache, unless `node-version` is empty. Like any action that sets up Node.js, this changes the Node.js on the path for the steps after it in the job.
2. **Install Rampa.** It reads the version from the action's `package.json` and asks npm whether `rampa-cli` has it (`npm view rampa-cli@<version> version`).
   - When it does, the step logs `Installing rampa-cli@<version> from npm.` and runs `npm install rampa-cli@<version>` into `$RUNNER_TEMP/rampa-cli/<version>`, with `--ignore-scripts`, since none of its dependencies needs an install script. Its dependencies resolve within the package's version ranges, as for anyone who installs it. A second use of the action in the same job reuses that install.
   - When it does not, or `from-source` is `true`, the step leaves a notice in the log and the run's annotations, such as `Building Rampa 0.2.0 from the action's checkout: rampa-cli@0.2.0 is not on npm.`, then builds in the action's own directory: `pnpm install --frozen-lockfile` and `pnpm build`, running the pnpm version that `package.json` pins through `corepack pnpm`. It does not run `corepack enable`, so `pnpm` stays as it was for the rest of your job. On a Node.js without corepack (25 and later), it uses the `pnpm` on the path.

   On `@main`, the version in `package.json` is the last release until the next one bumps it, so `@main` runs that release from npm while the action's own scripts come from `main`; set `from-source: true` to run `main`'s code. Either way, the npm registry the job's npm configuration names is the one asked and installed from.
3. **Check accessibility**: `rampa check` with the inputs, writing JSON, Markdown, SARIF and HTML. This step never fails the job by itself, so the next steps still run.
4. **Upload SARIF** with `github/codeql-action/upload-sarif` v4, pinned by commit SHA like every action Rampa's action uses. It is skipped on pull requests from forks: on `pull_request` the token cannot upload, and on `pull_request_target` the results would be filed under the base branch.
5. **Comment on the pull request**: finds the comment an earlier run posted by its hidden marker and edits it, or posts one. Outside a pull request it does nothing. When GitHub refuses (a fork's read-only token), it warns and the job goes on; the report is still in the job summary.
6. **Result**: fails the job with Rampa's exit code.

GitHub-hosted runners have Google Chrome, which Rampa uses. On a self-hosted runner, install Chrome, Edge or Chromium, or set `RAMPA_BROWSER_PATH`.

## The model

The deterministic layer (axe-core) always runs. The judgment layer needs a model, and there are three ways to give it one:

- **An API key as a secret, and nothing else.** Put the key in the `env` of the step, as in the workflow above. Rampa picks the recommended model of the first provider with a key (`rampa models` lists them): `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY` and so on. A check of a few pages costs fractions of a cent; the comment shows the calls, the tokens and the estimated price.
- **A model of your choice**, with `model: openai:gpt-6-luna` (or `RAMPA_MODEL` in `env`) and its key in `env`.
- **No model**: `model: none` runs `--no-llm`, the deterministic layer only.

When no model is configured, or the model's key is missing in this run, the action runs `--no-llm` and says so in a warning, instead of failing. That is what happens on pull requests from forks, which GitHub gives no secrets. The report then states that the judgment was skipped and lists the candidates nobody judged.

A model on your own hardware works too: on a self-hosted runner with [Ollama](https://ollama.com), set `model: ollama:gemma4:12b` (and `OLLAMA_BASE_URL` if it is not on `localhost:11434`).

## The comment

The Markdown report starts with a hidden marker, `<!-- rampa-report -->`. On each run the action looks for a comment on the pull request that starts with it and that it wrote, and edits that comment. "It wrote" means a bot (the Actions token posts as `github-actions[bot]`), or the token's own user when `github-token` is a personal token: anyone can type the marker, so a person's comment is never edited, and a reply that quotes the report starts with `>` anyway. When the report did not change, the comment is left as it is. With `comment-key: docs`, the marker becomes `<!-- rampa-report:docs -->` and the job keeps its own comment.

The comment ends with the coverage of the run, the statement that the report does not declare the pages accessible, and how to waive a false positive.

## False positives

Each finding in the comment has an id. To dismiss one, add it to `.rampa/waivers.json` and commit the file in the same pull request:

```json
[
  { "fingerprint": "1af8a73e209d", "reason": "The card heading names the product, so the link text is clear in context" }
]
```

The next run leaves the finding out of the comment, the code scanning results and the exit code, and counts it as waived. Because the waiver is a file, the decision is reviewed like any other change and stays with the code. Dismissing an alert in the code scanning interface hides it there only; the waiver file is what Rampa reads.

## Code scanning

Results appear in the Security tab and as annotations on the changed lines of a pull request. Their severity follows Rampa's confidence: high is an error, medium a warning. Each result points to the element's line and carries the suggested patch, and its rule links to W3C's Understanding page for the criterion. The upload needs `security-events: write`; private repositories also need GitHub Advanced Security or GitHub Code Security.

## Trying the scripts locally

The logic of the action lives in two scripts, which Node.js 22.18+ runs without a build:

```sh
pnpm build
RUNNER_TEMP=.rampa/tmp INPUT_TARGETS=examples/store/before.html INPUT_MODEL=none node action/check.ts
GITHUB_REPOSITORY=owner/repo node action/comment.ts --body-file <the markdown path it printed> --issue 12 --dry-run
```

`check.ts` writes the reports to a new folder under `$RUNNER_TEMP/rampa` (the system's temporary directory when it is not set), so an earlier run's report is never published by mistake, and prints the outputs when `GITHUB_OUTPUT` is not set. `comment.ts --dry-run` reads the pull request's comments when `GITHUB_TOKEN` is set and never writes; without a token it prints the comment it would post.
