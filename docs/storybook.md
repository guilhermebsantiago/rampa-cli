# Rampa in the Storybook test-runner

The [Storybook test-runner](https://github.com/storybookjs/test-runner) opens every story in a Playwright page. Its `postVisit` hook runs after the story renders, which is where Rampa checks it: axe-core and, when you name a model, the judgment layer, scoped to the story root so that Storybook's own page around it is left out. A story with a confirmed failure fails its test, with each finding listed.

> [!NOTE]
> `@storybook/test-runner` 0.26.0 prints "Official support for Test Runner has ended", with a link to Storybook's migration guide, and suggests the Vitest addon to Vite projects. This recipe works with the test-runner as it is today ([what was tested](#how-this-was-tested)); it does not cover the Vitest addon, where stories run inside the browser and there is no Node-side page to hand to Rampa.

## Setup

1. Add Rampa to the project, as in [docs/playwright.md](playwright.md#setup), and `@storybook/test-runner`.
2. Copy [`examples/storybook/test-runner.ts`](../examples/storybook/test-runner.ts) to `.storybook/test-runner.ts`:

   ```ts
   import { type TestRunnerConfig, getStoryContext, waitForPageReady } from '@storybook/test-runner'
   import { type CheckPageOptions, assertRampa, checkPage } from 'rampa/playwright'

   const config: TestRunnerConfig = {
     async postVisit(page, context) {
       const story = await getStoryContext(page, context)
       const { disable, ...options } = (story.parameters?.rampa ?? {}) as CheckPageOptions & { disable?: boolean }
       if (disable) return

       await waitForPageReady(page)
       const report = await checkPage(page, {
         include: '#storybook-root',
         noLlm: !process.env.RAMPA_MODEL,
         ...options,
       })
       assertRampa(report)
     },
   }

   export default config
   ```

3. Run it against a running Storybook, `storybook dev` or a static build:

   ```sh
   test-storybook --url http://localhost:6006
   ```

`#storybook-root` is the story's root since Storybook 7; on Storybook 6 it is `#root`. Because the check is scoped, 2.4.2 Page Titled and 3.1.1 Language of Page are reported as not applicable: a story has no title or page language of its own.

## Per-story settings

Story parameters reach the check, so one story can be left out or checked differently:

```js
export const Decorative = { parameters: { rampa: { disable: true } } }
export const Gallery = { parameters: { rampa: { criteria: ['1.1.1'], minConfidence: 'high' } } }
```

Any [`checkPage` option](playwright.md#options) works there, including `exclude` for part of a story you do not own.

## With a model

Without `RAMPA_MODEL` the recipe runs axe-core only. To add the judgment layer:

```sh
RAMPA_MODEL=ollama:gemma4:12b test-storybook --url http://localhost:6006 --testTimeout 300000
```

Jest gives each story 15 seconds by default, and a model takes seconds per candidate, so raise `--testTimeout`. Judgments are cached in `.rampa/cache`: a second run over unchanged stories calls no model (in the run below, 102 seconds the first time, 7 the second). For CI, see [the model, locally and in CI](playwright.md#the-model-locally-and-in-ci).

A story that fails, as the test-runner prints it (from `ollama:gemma4:12b`, URL shortened):

```text
● Shop/Cart › Broken › smoke-test

  RampaAssertionError: Rampa: 3 failures in http://127.0.0.1:6106/iframe.html?id=shop-cart--broken&… (scope: #storybook-root)

  1. WCAG 1.1.1 (A) — Non-text Content
     Element:   #storybook-root > section > ul > li > img
     Message:   The text alternative "IMG_2034.jpg" is a file name or a placeholder.
     Evidence:  "IMG_2034.jpg"
     Patch:     - <img alt="IMG_2034.jpg" width="96" height="96" src="mug.svg">
                + <img alt="Blue ceramic mug" width="96" height="96" src="mug.svg">
     Judged:    ollama:gemma4:12b · confidence high · 1/1 runs · evidence verified
     Waiver id: cef0552b1f1e

  2. WCAG 2.4.4 (A) — Link Purpose (In Context)
     Element:   #storybook-root > section > p > a
     Message:   The link text "Click here" does not tell where the link goes, and nothing around it does.
     Evidence:  "Click here"
     Patch:     - <a href="/shipping">Click here</a>
                + <a href="/shipping">View shipping information</a>
     Judged:    ollama:gemma4:12b · confidence high · 1/1 runs · evidence verified
     Waiver id: 9de04729bbf5

  3. WCAG 2.4.6 (AA) — Headings and Labels
     Element:   #cart-title
     Message:   The heading "Section 2" says nothing about the content under it.
     Evidence:  "Section 2"
     Patch:     - <h2 id="cart-title">Section 2</h2>
                + <h2 id="cart-title">Product Details</h2>
     Judged:    ollama:gemma4:12b · confidence high · 1/1 runs · evidence verified
     Waiver id: 9bf1f75b079a

  Coverage: axe-core checked 1.1.1, 1.3.1, 1.4.1, 1.4.3, 2.4.4, 4.1.2; judged with verified evidence: 1.1.1, 2.4.4, 2.4.6; not checked automatically: 48 of 55 WCAG 2.2 A/AA criteria.
  This report does not declare the page accessible.
```

## Matchers instead of assertRampa

The test-runner's hooks run inside Jest, so Rampa's matchers can extend Jest's `expect` in the `setup` hook:

```ts
import { type TestRunnerConfig, waitForPageReady } from '@storybook/test-runner'
import { type ToPassRampaOptions, rampaMatchers } from 'rampa/playwright'

declare global {
  namespace jest {
    interface Matchers<R> {
      toPassRampa(options?: ToPassRampaOptions): Promise<R>
    }
  }
}

const config: TestRunnerConfig = {
  setup() {
    expect.extend(rampaMatchers)
  },
  async postVisit(page) {
    await waitForPageReady(page)
    await expect(page).toPassRampa({ include: '#storybook-root', noLlm: !process.env.RAMPA_MODEL })
  },
}

export default config
```

## Known problems

**Jest 30.5 and Storybook 10.** `jest-runtime` 30.5.0 (August 2026) and later refuse the `module.register()` call Storybook 10 makes to load `.storybook/test-runner.*`, so the test-runner fails before any story with "module.register() is not supported in Jest". It happens with any hooks file, with or without Rampa (tested with test-runner 0.24.5 and 0.26.0 on Storybook 10.6.0, and `jest-runtime` 30.5.1 and 30.5.2). Until it is fixed upstream, pin `jest-runtime` to 30.4.2, the last release without that check:

```yaml
# pnpm-workspace.yaml (pnpm); npm takes "overrides" and yarn "resolutions" in package.json
overrides:
  jest-runtime: 30.4.2
```

<a id="storybook-8-and-9"></a>**Storybook 9 and earlier.** The test-runner for Storybook 9 (0.23, on Jest 29) loads `.storybook/test-runner.ts` with Jest's own `require`, which cannot load ES modules, and fails with "Cannot use import statement outside a module" on Rampa's import. Node's require can load them (Node 22.12+), so load Rampa through it and keep the rest of the recipe. This was tested with Storybook 9.1.20; Storybook 8 was not tested.

```ts
import type { CheckPageOptions } from 'rampa/playwright'

// Jest's require cannot load ES modules; Node's own require can.
const nodeRequire = process.getBuiltinModule('node:module').createRequire(__filename)
const { assertRampa, checkPage } = nodeRequire('rampa/playwright') as typeof import('rampa/playwright')
```

**The browser.** The test-runner launches Playwright's own Chromium, which `npx playwright install chromium` downloads. To use an installed Chrome or Edge instead, eject its Jest config (`test-storybook --eject`) and set the channel:

```js
// test-runner-jest.config.js
import { getJestConfig } from '@storybook/test-runner'

const config = getJestConfig()

export default {
  ...config,
  testEnvironmentOptions: {
    'jest-playwright': { ...config.testEnvironmentOptions?.['jest-playwright'], launchOptions: { channel: 'msedge' } },
  },
}
```

## How this was tested

On 2026-10-08, on Windows 11 with Microsoft Edge, a React story file with four stories: a cart with fixed texts, the same cart broken (`alt="IMG_2034.jpg"`, "Click here", a heading "Section 2"), a logo without an alternative, and a story with `rampa: { disable: true }`. Storybook was built with `storybook build`, served locally, and checked with `test-storybook --index-json --url`.

- **Storybook 10.6.0**, `@storybook/react-vite` with Vite 7.3.6 and React 19.2.8, `@storybook/test-runner` 0.26.0 with `jest-runtime` 30.4.2: the recipe above, unchanged. Without a model, the logo story fails on axe-core and the other three pass. With `RAMPA_MODEL=ollama:gemma4:12b`, the broken cart fails with the three findings shown above and the fixed cart passes. The matchers variant, run without a model, fails the logo story and passes the rest. With `jest-runtime` 30.5.1 or 30.5.2 instead of 30.4.2, the test-runner stops before any story runs, as described under [known problems](#known-problems).
- **Storybook 9.1.20** with `@storybook/test-runner` 0.23.0 (Jest 29): the Node-require variant, without a model; the same results.
