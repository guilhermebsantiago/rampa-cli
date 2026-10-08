# Contributing to Rampa

Thanks for helping. Rampa is young, so issues that question a design decision are as welcome as pull requests.

## Setup

Requires Node.js 22.12+, pnpm and Chrome or Edge (or `npx playwright-core install chromium`).

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
node src/cli.ts check examples/language-of-parts/mismatch.html --no-llm
```

`node src/cli.ts` runs the TypeScript sources directly, so you can try changes without building. For the judgment layer you need a model: [Ollama](https://ollama.com) with `ollama pull gemma4:12b`, or an API key in a local `.env` (see the README).

## Ground rules

These come from the design and are not negotiable in a pull request:

- **Never say "accessible".** Reports state what was checked and what was not.
- **Verification is mandatory.** Every claim from a model must cite something that can be checked against the snapshot. A criterion without a `verify` that can reject claims will not be merged.
- **The deterministic engine stays.** The model only sees the residue the engine could not decide.
- **The core is platform-agnostic.** Criteria read the normalized snapshot, never the DOM or a platform API.
- **No overlays.** Rampa runs in development and CI, never in production pages.

## Adding a criterion

A criterion is one module in `src/criteria/` implementing the `Criterion` interface in `src/core/types.ts`: candidates (only the residue), prompt, zod schema, verification, message template and, when possible, a patch. Then:

1. Register it in `src/criteria/index.ts`.
2. Add unit tests for `candidates` and for every way `verify` rejects a claim.
3. Map its ACT rules in `src/eval/act.ts` and, if you can, add a corruptor in `src/eval/pairs.ts`.
4. Run `rampa eval --criteria <id>` with and without `--no-llm` and put the numbers in the pull request.

Bump the criterion's `version` whenever its prompt or logic changes; that invalidates cached judgments.

## Pull requests

Keep them focused, include tests, and make sure `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## README media

Every image in the README is rendered from the real CLI by `pnpm media` (it needs a model or cached judgments). If your change alters what the CLI prints, run it and commit the new images with the change.
