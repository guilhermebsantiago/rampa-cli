# Checking HTML before each commit

Rampa can check the HTML files in a commit before it is made, and stop the commit when a finding fails `--fail-on`. By default the hook runs the deterministic layer only (`--no-llm`): it takes a few seconds, needs no model, and sends nothing anywhere. Every hook below needs Node.js 22.12+ and Chrome or Edge on the machine, as `rampa check` does.

Pages your build generates are better checked in CI, on the built site; see [github-action.md](github-action.md). A commit hook fits HTML that is written by hand or committed as it is served.

## pre-commit

With [pre-commit](https://pre-commit.com), add the hook to `.pre-commit-config.yaml` in your repository:

```yaml
repos:
  - repo: https://github.com/guilhermebsantiago/rampa-cli
    rev: <a commit SHA or a tag>
    hooks:
      - id: rampa
```

Then `pre-commit install` once. The hook runs on the staged `.html` and `.htm` files, all of them in one run.

The first run builds Rampa inside pre-commit's copy of this repository, with pnpm and the lockfile, so the dependencies are the reviewed ones. It uses `pnpm` when it is on the path, otherwise pnpm through corepack (`corepack enable` once, on Node.js versions that include it). Later runs start at once. A new `rev` builds again.

`args` replaces the defaults, so keep `--no-llm` unless you want the judgment layer:

```yaml
      - id: rampa
        args: [--no-llm, --fail-on, AA]                     # stop only for what blocks AA conformance
      - id: rampa
        args: [--model, ollama:gemma4:12b, --fail-on, A]    # judge with a local model, stop on Level A
```

pre-commit sets aside the changes you did not stage, so the hook checks the files exactly as they will be committed. `pre-commit run rampa --all-files` checks every HTML file in the repository.

## Without pre-commit

The other hook managers run a command you choose, so `rampa` has to be on the path. Rampa is not on npm yet; until it is, build it once from a checkout and link it:

```sh
git clone https://github.com/guilhermebsantiago/rampa-cli
cd rampa-cli
pnpm install && pnpm build && pnpm link --global
```

### Husky

`.husky/pre-commit`:

```sh
# Check the HTML files in this commit; stop it when a finding fails --fail-on.
if git diff --cached --quiet --diff-filter=ACMR -- '*.html' '*.htm'; then exit 0; fi
git diff --cached --name-only --diff-filter=ACMR -z -- '*.html' '*.htm' | xargs -0 rampa check --no-llm
```

Husky checks the files as they are in your working tree, which includes changes you did not stage. To check exactly what is staged, run Rampa through lint-staged, which sets the other changes aside first:

```json
{
  "lint-staged": {
    "*.{html,htm}": "rampa check --no-llm"
  }
}
```

with `npx lint-staged` as the line in `.husky/pre-commit`. lint-staged passes the staged files to the command.

### Lefthook

`lefthook.yml`:

```yaml
pre-commit:
  commands:
    rampa:
      glob: "*.{html,htm}"
      run: rampa check --no-llm {staged_files}
```

Lefthook skips the command when no staged file matches. Like Husky, it reads the files from the working tree.

## What stops a commit

`rampa check` exits `1` when a finding fails `--fail-on` (by default, any confirmed finding) and `2` when it cannot run, for example without a browser; either stops the commit. To keep a finding that is not a failure from stopping commits, add its id, printed with each finding, to `.rampa/waivers.json`:

```json
[
  { "fingerprint": "1af8a73e209d", "reason": "Decorative border image, hidden from assistive technology on purpose" }
]
```

To commit anyway, once, `git commit --no-verify` skips every hook.
