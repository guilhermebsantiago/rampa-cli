# Rampa from code

Everything `rampa check` does is available from code: `import { check } from 'rampa'` takes the same targets and options and returns the same reports. For tests that already open a page, use [`rampa/playwright`](playwright.md) or `rampa/puppeteer` instead; for Storybook, see [docs/storybook.md](storybook.md).

The package is ESM. It also loads with `require()` from CommonJS, on Node.js 22.12 or newer. Rampa is not on npm yet: [docs/playwright.md](playwright.md#setup) shows how to add it to a project from a clone.

## check

```ts
import { check } from 'rampa'

const reports = await check(['https://example.com/pricing', 'dist/index.html'], {
  model: 'ollama:gemma4:12b',
  criteria: ['1.1.1', '2.4.4'],
})
```

`check(targets, options)` returns one report per page, in order, always as an array. Targets are what the CLI takes: URLs, `.html` files, folders of `.html` files (every file, recursively), and snapshot `.json` files from any platform, with the engine results recorded next to them by `rampa check --save`.

For web targets Rampa starts Chrome or Edge, as the CLI does (`RAMPA_BROWSER_CHANNEL` and `RAMPA_BROWSER_PATH` apply), and closes it at the end. Pass `browser` to reuse a Playwright browser you already started; Rampa leaves it open.

Web targets go through the same collector as the CLI, and a test holds `check` to it: on a recorded page with the same options, its report equals the JSON `rampa check --format json` prints, apart from the time it was created.

## Options

The options are the [ones `checkPage` takes](playwright.md#options), minus `include`, `exclude` and `maxNodes`, plus `browser`. Each mirrors a `rampa check` flag:

```ts
interface RampaOptions {
  criteria?: string[] | string         // --criteria; all six by default
  model?: string | ModelProvider       // --model; then RAMPA_MODEL, the config, what this machine runs
  noLlm?: boolean                      // --no-llm
  runs?: number                        // --runs
  minConfidence?: 'low' | 'medium' | 'high'   // --min-confidence
  reasoning?: Reasoning                // --reasoning
  offline?: boolean                    // --offline
  waivers?: Iterable<string> | string  // waiver ids, or a file; .rampa/waivers.json by default
  locale?: 'en' | 'pt-BR'              // --locale
  cacheDir?: string                    // --cache-dir
  cache?: JudgmentCache                // a cache of your own, such as memoryCache()
  concurrency?: number                 // --concurrency
  config?: RampaConfig | false         // rampa.config.* by default; false for none
}
```

What you leave out falls back to `rampa.config.*` in the working directory (or the `config` you pass), then to the CLI's default. Options that would silently hide results throw instead: an unknown `minConfidence` or `reasoning`, an unknown criterion, a waivers file that does not exist. The CLI reads a local `.env` file and the library does not; load it yourself if your API keys live there.

## The report

Each report says what was found, what was judged and what was not checked. This one is real, from the recorded store example with the judgments of `ollama:gemma4:12b` replayed offline (`criteria: ['2.4.4']`; only `notChecked` is shortened):

```json
{
  "schemaVersion": 1,
  "rampaVersion": "0.0.0",
  "createdAt": "2026-10-09T00:25:49.464Z",
  "target": "examples/store/before.html",
  "surface": "web",
  "locale": "en",
  "llm": "on",
  "model": "ollama:gemma4:12b",
  "engine": { "name": "axe-core", "version": "4.14.0" },
  "findings": [
    {
      "fingerprint": "5f085d8a3b9c",
      "criterion": "1.1.1",
      "level": "A",
      "source": "engine",
      "ref": "html > body > header > img",
      "target": "[\"img[src$=\\\"logo.svg\\\"]\"]",
      "message": "Images must have alternative text",
      "confidence": "high",
      "ruleId": "image-alt",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.14/image-alt?application=axeAPI",
      "html": "<img src=\"logo.svg\" width=\"48\" height=\"48\">"
    },
    {
      "fingerprint": "1af8a73e209d",
      "criterion": "2.4.4",
      "level": "A",
      "source": "judgment",
      "ref": "html > body > main > p:nth-of-type(2) > a",
      "message": "The link text \"Click here\" does not tell where the link goes, and nothing around it does.",
      "evidence": "Click here",
      "patch": {
        "ref": "html > body > main > p:nth-of-type(2) > a",
        "kind": "set-text",
        "from": "Click here",
        "to": "View shipping information",
        "before": "<a href=\"shipping.html\">Click here</a>",
        "after": "<a href=\"shipping.html\">View shipping information</a>"
      },
      "confidence": "high",
      "agreement": { "votes": 1, "total": 1 },
      "model": "ollama:gemma4:12b"
    }
  ],
  "belowThreshold": [],
  "waived": [],
  "discarded": [],
  "criteria": [
    { "criterion": "2.4.4", "applicable": true, "candidates": 1, "judged": 1, "failed": 1, "passed": 0, "cannotTell": 0, "discarded": 0, "errors": 0, "offlineMisses": 0 }
  ],
  "coverage": {
    "engine": ["1.1.1", "1.3.1", "1.3.5", "1.4.3", "2.4.1", "2.4.2", "2.4.4", "3.1.1", "3.1.2", "3.3.2", "4.1.2"],
    "judged": ["2.4.4"],
    "notChecked": ["…39 WCAG 2.1 A/AA criteria…"]
  },
  "usage": { "calls": 0, "cachedCalls": 1, "inputTokens": 547, "outputTokens": 53, "latencyMs": 0 },
  "errors": []
}
```

- `findings` are confirmed: at or above `minConfidence`, not waived. `belowThreshold`, `waived` and `discarded` (claims that failed verification against the snapshot) are kept apart, never mixed in.
- `llm` is `on`, `off` (`noLlm`) or `no-model` (judgment wanted, no model found).
- `criteria` counts, per criterion, the candidates left for judgment and what happened to them; `offlineMisses` and `errors` count the ones that were not judged.
- `coverage` lists the criteria axe-core checked (partly), the ones judged with verified evidence, and the ones nobody checked.
- A report from a scoped `checkPage` also has `scope: { include, exclude }`.

The types are exported: `Report`, `Finding`, `Patch`, `CriterionSummary`, `Usage`, `Confidence` and the rest of `src/core/types.ts`.

## Pass or fail

`rampa check` exits 1 when a report has findings and 2 when the model failed on every candidate of a criterion. From code, `assertRampa(reports, options)` applies the same rule and throws an error listing each finding; `formatFindings(reports, options)` returns that text without throwing. Both take `failOn: 'any'` (also fail on findings below the threshold) and `requireJudgment: true` (also fail when the judgment did not reach every candidate).

```ts
import { writeFile } from 'node:fs/promises'
import { assertRampa, check } from 'rampa'

const reports = await check('dist', { minConfidence: 'high' })
await writeFile('rampa-report.json', JSON.stringify(reports, null, 2))
assertRampa(reports)
```

## Snapshots, recordings and replays

A snapshot `.json` is checked without a browser: an Android or iOS export that follows [`schema/snapshot.schema.json`](../schema/snapshot.schema.json), or a web page recorded with `rampa check --save <dir>`. With `offline: true` and the model that judged it, a recording replays its judgments from the cache, with no model and no network; this is how the tests run the whole pipeline:

```ts
const [report] = await check('demo/recorded/examples-store-before.snapshot.json', {
  model: 'ollama:gemma4:12b',
  offline: true,
  cacheDir: 'demo/recorded/cache',
})
```

## A model of your own

`model` also takes a `ModelProvider`: an `id`, which keys the cache, and a `judge` call that answers one structured request. It is how to put Rampa behind a gateway the built-in providers do not cover, or to test without a model:

```ts
import type { ModelProvider } from 'rampa'

const model: ModelProvider = {
  id: 'my-gateway:vision-model',
  async judge(request) {
    // request.system, request.user, request.images and request.schema (zod) describe one judgment
    const answer = await callMyGateway(request)
    return { output: request.schema.parse(answer.json), inputTokens: answer.inputTokens, outputTokens: answer.outputTokens, latencyMs: answer.ms, modelId: answer.model }
  },
}
```

Every claim it makes still goes through the criterion's verification: a quote that is not on the page is discarded and counted, whoever made it.

## Building blocks

The steps `check` chains are exported too, for tools that need one of them: `resolveTargets`, `launchBrowser` and `collectWeb` (a URL to a snapshot and axe-core results), `loadSnapshot`, `checkSnapshot` (a snapshot and engine results to a report), `resolveCriteria`, `createModelProvider`, `fileCache` and `memoryCache`. `rampa/playwright` and `rampa/puppeteer` export `collectPage`, which collects a page that is already open, with the driver each builds (`playwrightDriver`, `puppeteerDriver`).
