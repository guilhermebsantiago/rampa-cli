# Rampa in Playwright tests

`rampa/playwright` runs Rampa inside the Playwright tests a team already has, the way `@axe-core/playwright` runs axe-core. It checks the page your test opened, as it is at that moment: your login, storage state, route mocks and app state all apply. It runs axe-core, then the judgment layer with your model, and returns the same report `rampa check` builds. A check can cover the whole page or one component.

> [!IMPORTANT]
> A passing test means Rampa found no confirmed failure in what it checked, not that the page is accessible. Every report lists what was checked, what was judged and what nobody checked.

- [Setup](#setup)
- [Check a page](#check-a-page)
- [Matchers](#matchers)
- [The fixture](#the-fixture)
- [Scope a check to a component](#scope-a-check-to-a-component)
- [The model, locally and in CI](#the-model-locally-and-in-ci)
- [Options](#options)
- [Puppeteer and other runners](#puppeteer-and-other-runners)
- [What to know](#what-to-know)

## Setup

Rampa needs Node.js 22.12 or newer. It is not on npm yet; until it is, build a package and add it to your project:

```sh
git clone https://github.com/guilhermebsantiago/rampa-cli.git
cd rampa-cli && pnpm install && pnpm build && pnpm pack    # writes rampa-0.0.0.tgz
cd ../your-project && pnpm add -D ../rampa-cli/rampa-0.0.0.tgz
```

`@playwright/test` is an optional peer dependency (1.40 or newer). Rampa never imports it and accepts a page from any Playwright version, so it does not pin yours.

Extend `test` and `expect` once, in a file your specs import:

```ts
// tests/fixtures.ts
import { test as base, expect as baseExpect } from '@playwright/test'
import { type RampaFixtures, rampaFixtures, rampaMatchers } from 'rampa/playwright'

export const test = base.extend<RampaFixtures>(rampaFixtures)
export const expect = baseExpect.extend(rampaMatchers)
```

Rampa's own tests run this setup with `@playwright/test`: [`test/playwright-runner/shop.pw.ts`](../test/playwright-runner/shop.pw.ts) checks a shop page behind a route mock and a signed-in session.

## Check a page

```ts
import { expect, test } from './fixtures'

test('checkout', async ({ page, rampa }) => {
  await page.goto('/checkout')
  await expect(page.getByRole('button', { name: 'Pay' })).toBeVisible()

  const report = await rampa.check()
  expect(report).toHaveNoRampaFindings()
})
```

Rampa reads the page when you call it. It does not navigate, reload or wait for anything, so get the page to the state you want checked first: a dialog open, a form with its errors shown, lazy content loaded.

Without the fixture, `checkPage(page, options)` returns the report, and `await expect(page).toPassRampa(options)` checks and asserts in one line:

```ts
import { checkPage } from 'rampa/playwright'

const report = await checkPage(page, { criteria: ['1.1.1', '2.4.4'] })
await expect(page).toPassRampa({ include: '#cart', minConfidence: 'high' })
```

## Matchers

| Matcher | Takes | Fails when |
| --- | --- | --- |
| `await expect(page).toPassRampa(options)` | a page, which it checks with `options`; or a report or an array of reports | a finding fails, or the judgment broke |
| `expect(report).toHaveNoRampaFindings(options)` | a report or an array of reports | the same |

They decide the way the CLI's exit code does. A finding at or above `minConfidence` fails (`failOn: 'any'` also fails the ones below it, like `--fail-on any`). A criterion where the model failed on every candidate fails too: the CLI exits 2 there, and a check that could not judge is not a pass. With `requireJudgment: true`, a run where the judgment did not reach every candidate fails as well: judgment off, no model found, an offline cache miss, or a model error.

A failure lists each finding with its criterion, element, message, evidence and patch. This is a real one, from `ollama:gemma4:12b` on [`examples/store/before.html`](../examples/store/before.html):

```text
expect(report).toHaveNoRampaFindings()

Rampa: 4 failures in examples/store/before.html (scope: main)

1. WCAG 1.1.1 (A) — Non-text Content
   Element:   html > body > main > div > figure:nth-of-type(1) > img
   Message:   The text alternative "IMG_2034.jpg" is a file name or a placeholder.
   Evidence:  "IMG_2034.jpg"
   Patch:     - <img src="mug.svg" alt="IMG_2034.jpg">
              + <img src="mug.svg" alt="Blue mug with steam">
   Judged:    ollama:gemma4:12b · confidence high · 1/1 runs · evidence verified
   Waiver id: 2c1d064d9cc7

   … three more …

4. WCAG 2.4.4 (A) — Link Purpose (In Context)
   Element:   html > body > main > p:nth-of-type(2) > a
   Message:   The link text "Click here" does not tell where the link goes, and nothing around it does.
   Evidence:  "Click here"
   Patch:     - <a href="shipping.html">Click here</a>
              + <a href="shipping.html">View shipping information</a>
   Judged:    ollama:gemma4:12b · confidence high · 1/1 runs · evidence verified
   Waiver id: 1af8a73e209d

Coverage: axe-core checked 1.1.1, 1.3.5, 1.4.3, 2.4.4, 3.1.2, 3.3.2, 4.1.2; judged with verified evidence: 1.1.1, 2.4.4; not checked automatically: 48 of 55 WCAG 2.2 A/AA criteria.
This report does not declare the page accessible.

To dismiss a finding on purpose, add its waiver id to .rampa/waivers.json or to the waivers option.
```

A finding axe-core reported shows its rule, help link and markup instead of evidence. With `locale: 'pt-BR'` the whole message is in Portuguese.

A patch is a proposal for a person to review. What a model says an image shows cannot be checked against the page.

## The fixture

`test.extend<RampaFixtures>(rampaFixtures)` gives each test `rampa`, bound to its page:

- `rampa.check(options)` checks the test's page, or `options.page` (a popup, a second tab), and returns the report.
- It attaches each report to the test as `rampa-report.json` (`rampa-report-2.json` for the second check), so the HTML reporter keeps it next to the trace.
- It adds a `rampa` annotation with what the check covered, such as `3 findings · judged: 1.1.1, 2.4.4, 2.4.6 · not checked automatically: 48 of 55 WCAG 2.2 A/AA criteria · model ollama:gemma4:12b`.

Defaults for every check come from the `rampaOptions` option, for the project or for one file; options passed to `rampa.check` win over them:

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test'
import type { RampaFixtures } from 'rampa/playwright'

export default defineConfig<RampaFixtures>({
  use: { rampaOptions: { model: 'ollama:gemma4:12b', minConfidence: 'medium' } },
})
```

```ts
// one spec file: this replaces the project's rampaOptions, so repeat what it should keep
test.use({ rampaOptions: { model: 'ollama:gemma4:12b', criteria: ['1.1.1'], include: 'main' } })
```

## Scope a check to a component

`include` checks only what the selectors match; `exclude` leaves parts out, such as a third-party widget you cannot fix:

```ts
await rampa.check({ include: '[data-testid="cart"]' })
await rampa.check({ exclude: ['#chat-widget', '.ad-slot'] })
```

- axe-core gets the selectors as its own context, so its rules run only there.
- The snapshot keeps what the selectors match, whole. Its ancestors stay only as a skeleton, so the language, landmark and field group around the component still inform the judgment, but nothing else outside it is judged or sent to the model. An exclude inside an include works as in axe-core.
- With `include`, 2.4.2 Page Titled and 3.1.1 Language of Page are about the page, not the component: the report lists them as not applicable, and its coverage as not checked.
- A selector that matches nothing, or does not parse, throws, and so does a scope with nothing rendered in it, such as a dialog that is not open yet. Each would otherwise check nothing and pass.
- The report records the scope (`report.scope`), and failure messages show it.

## The model, locally and in CI

The model is chosen as the CLI chooses it: the `model` option, then `RAMPA_MODEL`, then `model` in `rampa.config.*`, then what the machine can run (a local Ollama model first, then the first API provider with credentials). Detection probes local servers once per worker process. The CLI reads a `.env` file and the library does not; call `process.loadEnvFile()` in `playwright.config.ts` if your keys live there.

Each candidate takes one model call per run, seconds each on a local GPU, and the test waits for them, so raise the test timeout when a model judges. Judgments are cached (`.rampa/cache` by default), so a check of an unchanged page calls no model the second time.

In CI there are three ways to go, from cheapest to fullest:

1. **axe-core only.** `noLlm: true` runs the deterministic layer, fast and free. The report and the fixture's annotation say the judgment was off.

   ```ts
   use: { rampaOptions: { noLlm: Boolean(process.env.CI) } }
   ```

2. **Judgments recorded on a developer's machine.** Run the tests locally with a model, commit `.rampa/cache` (one JSON file per judgment, readable in review), and run CI with `offline: true` and the same model name. CI replays the recorded answers and never calls a model. A page that changed has no recorded answer: that candidate is an offline miss, reported as such, and `requireJudgment: true` turns misses into failures. Images are part of 1.1.1's cache key, and screenshots can differ between machines (fonts, rendering), so 1.1.1 misses more often in CI than the text criteria.

   ```ts
   use: { rampaOptions: { model: 'ollama:gemma4:12b', offline: Boolean(process.env.CI) } }
   ```

3. **A model in CI.** An API key as a secret, such as `RAMPA_MODEL=anthropic:claude-haiku-5-5` with `ANTHROPIC_API_KEY`, or an Ollama service in the job. Every new candidate costs a call; each report's `usage` says how many were made and how many came from the cache.

## Options

`checkPage`, `toPassRampa` and `rampa.check` take the same options. Each mirrors a `rampa check` flag; what you leave out falls back to `rampa.config.*`, then to the CLI's default.

| Option | Like | Default |
| --- | --- | --- |
| `criteria` | `--criteria` | all six: `['1.1.1', '2.4.2', '2.4.4', '2.4.6', '3.1.1', '3.1.2']`. axe-core runs every WCAG 2.2 A/AA rule either way (2.1 with `wcag: '2.1'`) |
| `model` | `--model` | as above; also takes a `ModelProvider` of your own |
| `noLlm` | `--no-llm` | `false` |
| `runs` | `--runs` | `1` |
| `minConfidence` | `--min-confidence` | `'medium'` |
| `reasoning` | `--reasoning` | `none` for Ollama, the provider's own default elsewhere |
| `offline` | `--offline` | `false` |
| `waivers` | `.rampa/waivers.json` | that file; or a list of waiver ids, or another file's path |
| `locale` | `--locale` | `RAMPA_LOCALE`, the config, then `'en'` |
| `cacheDir` | `--cache-dir` | `'.rampa/cache'`; `cache` takes a `JudgmentCache` of your own, such as `memoryCache()` |
| `concurrency` | `--concurrency` | `4` |
| `screenshotDir` | `--screenshots` | none; saves a full-page screenshot there |
| `include`, `exclude` | | the whole page |
| `maxNodes` | | `5000` elements of the page, and as many in its shadow roots and frames; the snapshot says when it stopped |
| `config` | | `rampa.config.*` in the working directory; an object of your own, or `false` for none |

The assertion options, `failOn` and `requireJudgment`, are described under [Matchers](#matchers).

## Puppeteer and other runners

`rampa/puppeteer` has the same `checkPage` for a Puppeteer page. Everything but four calls into the browser is shared with `rampa/playwright`: the code that runs in the page, axe-core, scoping and judgment.

```ts
import puppeteer from 'puppeteer'
import { assertRampa, checkPage } from 'rampa/puppeteer'

const browser = await puppeteer.launch()
const page = await browser.newPage()
await page.goto('http://localhost:3000/checkout')
assertRampa(await checkPage(page, { include: '#checkout' }))
await browser.close()
```

`rampaMatchers` work with Vitest's and Jest's `expect.extend` too; both entries export them. They are tested in Vitest, and in Jest through the Storybook test-runner. Jest's own module loader cannot load ES modules, which Rampa is; where Jest loads your code with `require`, load Rampa with Node's require instead, as [docs/storybook.md](storybook.md#storybook-8-and-9) shows.

Where there is no `expect.extend`, `assertRampa(report, options)` throws the same message as the matchers, and `formatFindings(report, options)` returns it as text.

## What to know

- **Frames and shadow roots.** The collector reads open shadow roots and the frames of the page's own origin, and axe-core runs in every frame, frames of other origins included, through the page's frame API (`evaluateHandle`, which every Playwright and Puppeteer page has). A finding in a frame names the frame first (`#checkout |> html > body > img`), one in a shadow root its host (`x-card >>> button`); [docs/api.md](api.md#frames-and-shadow-roots) has the details. The content of a frame of another origin is checked by axe-core only, and the report's notes say so, as they do for closed shadow roots, which no script can read.
- **The page is touched, a little.** Rampa evaluates axe-core in the page (replacing a `window.axe` your app may have loaded) instead of adding a script tag, so a strict Content-Security-Policy does not stop it. For 1.1.1 it screenshots each image as rendered, with Playwright's `animations: 'disabled'`, as `toHaveScreenshot` does, and then scrolls the page back to where it was.
- **One check at a time per page.** axe-core cannot run twice at once in the same page.
- **Language of Page and the title on components.** A scoped check never judges them; check the page itself, unscoped, for those.
- **Tested** on Windows with Microsoft Edge, through `@playwright/test` 1.62 and 1.63 and `puppeteer-core` 25.10; the CI workflow is set to run the same tests with Google Chrome on Ubuntu. Firefox and WebKit pages should work, since the in-page code uses standard DOM APIs, but they have not been tested.
