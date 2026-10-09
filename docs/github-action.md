# GitHub Action

The action runs `rampa check` in a workflow, uploads the SARIF report to code scanning, and keeps one comment on the pull request with the Markdown report, edited on every push. The job fails according to `fail-on`.

Rampa is not on npm yet, so the action builds the CLI from its own checkout: it sets up Node.js, enables pnpm through corepack, installs from the lockfile and builds. That takes about a minute.

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
        # Pin a commit SHA instead of main once you have tried it.
        uses: guilhermebsantiago/rampa-cli@main
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

## Inputs

| Input | Default | What it does |
| --- | --- | --- |
| `targets` | required | URLs, `.html` files or folders, separated by spaces or new lines. Quote a path that has spaces. |
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
| `args` | | More options for `rampa check`, such as `--min-confidence high --runs 3` |
| `github-token` | `github.token` | Token for the comment |
| `node-version` | `24` | Node.js for building and running Rampa (22.18 or later). Empty uses the Node.js already set up in the job |

## Outputs

| Output | What it holds |
| --- | --- |
| `findings` | Number of confirmed findings |
| `exit-code` | `0` passed, `1` failed the `fail-on` policy, `2` could not finish |
| `sarif`, `markdown`, `html`, `json` | Paths of the reports, in the runner's temporary directory |

## What the steps do

1. **Set up Node.js** with `actions/setup-node`, unless `node-version` is empty. Like any action that sets up Node.js, this changes the Node.js on the path for the steps after it in the job.
2. **Build Rampa** in the action's own directory: `corepack enable`, `pnpm install --frozen-lockfile`, `pnpm build`.
3. **Check accessibility**: `rampa check` with the inputs, writing JSON, Markdown, SARIF and HTML. This step never fails the job by itself, so the next steps still run.
4. **Upload SARIF** with `github/codeql-action/upload-sarif@v4`. It is skipped on pull requests from forks, whose token cannot upload.
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

The Markdown report starts with a hidden marker, `<!-- rampa-report -->`. On each run the action looks for a comment on the pull request that starts with it and edits that comment; a reply that quotes the report starts with `>` and is left alone. When the report did not change, the comment is left as it is. With `comment-key: docs`, the marker becomes `<!-- rampa-report:docs -->` and the job keeps its own comment.

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
GITHUB_REPOSITORY=owner/repo node action/comment.ts --body-file .rampa/tmp/rampa/rampa.md --issue 12 --dry-run
```

`check.ts` writes the reports to `$RUNNER_TEMP/rampa` (the system's temporary directory when it is not set), and prints the outputs when `GITHUB_OUTPUT` is not set. `comment.ts --dry-run` reads the pull request's comments when `GITHUB_TOKEN` is set and never writes; without a token it prints the comment it would post.
