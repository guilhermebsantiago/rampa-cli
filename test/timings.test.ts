import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Browser } from 'playwright-core'
import { afterAll, describe, expect, it } from 'vitest'
import { memoryCache } from '../src/core/cache.ts'
import { checkSnapshot } from '../src/core/check.ts'
import { Stopwatch, TIMING_STAGES, timed } from '../src/core/timings.ts'
import type { Report } from '../src/core/types.ts'
import { linkPurpose } from '../src/criteria/link-purpose.ts'
import { paint } from '../src/report/color.ts'
import { renderReport } from '../src/report/pretty.ts'
import { seconds, timingLines } from '../src/report/timings.ts'
import type { A11ySnapshot } from '../src/snapshot/schema.ts'
import { collectWeb } from '../src/surfaces/web.ts'
import { launchTestBrowser } from './browser.ts'
import { node } from './helpers.ts'
import { stubModel } from './stub-model.ts'

const NO_ENGINE = { engine: { name: 'axe-core', version: 'test' }, rules: [] }
const plain = paint(false)

function links(...texts: string[]): A11ySnapshot {
  return {
    schemaVersion: 1,
    surface: 'web',
    target: 'https://shop.example/',
    title: 'Shop',
    locale: 'en',
    viewport: { width: 1280, height: 800, scale: 1 },
    collectedAt: '2026-10-11T00:00:00.000Z',
    collector: { name: 'test', version: '0' },
    root: node({
      ref: 'html',
      role: 'document',
      lang: 'en',
      children: texts.map((text, index) =>
        node({ ref: `#a${index}`, role: 'link', name: text, native: { tag: 'a', attributes: { href: `/p${index}` }, html: `<a href="/p${index}">${text}</a>` }, children: [node({ ref: `#t${index}`, text })] }),
      ),
    }),
  }
}

describe('the stopwatch', () => {
  it('adds up each stage, keeps the pipeline order and the parts, and puts the rest in other', async () => {
    const watch = new Stopwatch(0)
    watch.add('rules', 40)
    watch.add('navigation', 100.4)
    watch.add('navigation', 50)
    watch.add('probes', 300, 'layout')
    watch.add('probes', 200, 'keyboard')
    watch.criterion({ criterion: '2.4.4', ms: 210.6, prepareMs: 0, candidates: 3, judged: 3, calls: 3, cachedCalls: 0 })
    const result = watch.result(1000)
    expect(result.stages.map((s) => s.stage)).toEqual(['navigation', 'probes', 'rules'])
    expect(result.stages[0]).toEqual({ stage: 'navigation', ms: 150 })
    expect(result.stages[1]?.parts).toEqual([
      { name: 'layout', ms: 300 },
      { name: 'keyboard', ms: 200 },
    ])
    expect(result.criteria[0]?.ms).toBe(211)
    expect(result).toMatchObject({ totalMs: 1000, otherMs: 1000 - 150 - 500 - 40 - 211 })
  })

  it('times work under a stage, and runs it untimed without a stopwatch', async () => {
    const watch = new Stopwatch()
    expect(await timed(watch, 'axe', async () => 'done')).toBe('done')
    expect(await timed(undefined, 'axe', async () => 'untimed')).toBe('untimed')
    await expect(timed(watch, 'settle', async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom')
    // A stage that threw still counts its time.
    expect(watch.result().stages.map((s) => s.stage)).toEqual(['settle', 'axe'])
  })

  it('names every stage in both languages, and formats seconds in each', () => {
    const watch = new Stopwatch(0)
    for (const stage of TIMING_STAGES) watch.add(stage, 10)
    const report = { locale: 'pt-BR', timings: watch.result(2000) } as Report
    const lines = timingLines(report, plain)
    expect(lines[0]).toBe('Tempo nesta página: 2,00 s (--timings)')
    expect(lines).toHaveLength(TIMING_STAGES.length + 2)
    expect(lines.some((line) => line.includes('{'))).toBe(false)
    expect(seconds(12_345, 'en')).toBe('12.3 s')
    expect(seconds(1234, 'en')).toBe('1.23 s')
  })
})

describe('timings in a check', () => {
  it('records the rules and each criterion, with the calls its judgments made and read from the cache', async () => {
    const cache = memoryCache()
    const options = { criteria: [linkPurpose], llm: true, runs: 1, cache, offline: false, locale: 'en' as const, minConfidence: 'low' as const, concurrency: 2 }
    const watch = new Stopwatch()
    const first = await checkSnapshot(links('Click here', 'Pricing'), NO_ENGINE, { ...options, provider: stubModel(), timings: watch })
    expect(first.timings).toBeUndefined()
    const timings = watch.result()
    expect(timings.stages.map((s) => s.stage)).toEqual(['rules'])
    expect(timings.criteria).toEqual([expect.objectContaining({ criterion: '2.4.4', candidates: 2, judged: 2, calls: 2, cachedCalls: 0 })])

    const again = new Stopwatch()
    await checkSnapshot(links('Click here', 'Pricing'), NO_ENGINE, { ...options, provider: stubModel(), timings: again })
    expect(again.result().criteria[0]).toMatchObject({ calls: 0, cachedCalls: 2 })
  })

  it('prints the breakdown in the terminal report, after the model usage', async () => {
    const watch = new Stopwatch()
    const report = await checkSnapshot(links('Click here'), NO_ENGINE, {
      criteria: [linkPurpose],
      llm: true,
      provider: stubModel(),
      runs: 1,
      cache: memoryCache(),
      offline: false,
      locale: 'en',
      minConfidence: 'low',
      concurrency: 1,
      timings: watch,
    })
    report.timings = watch.result()
    const text = renderReport(report, { verbose: false, paint: plain })
    expect(text).toMatch(/Time on this page: \d+\.\d\d s \(--timings\)/)
    expect(text).toMatch(/judgment 2\.4\.4 +\d+\.\d\d s +\d+% · 1 candidate\(s\), 1 model call\(s\), 0 from cache/)
    expect(text.indexOf('Model calls:')).toBeLessThan(text.indexOf('Time on this page'))
    expect(text.indexOf('Time on this page')).toBeLessThan(text.indexOf('Coverage of this run'))
  })
})

// The CLI on a recorded page with its recorded judgments: no browser, model or network.
const recorded = ['demo/recorded/examples-store-before.snapshot.json', '--offline', '--cache-dir', 'demo/recorded/cache', '--model', 'ollama:gemma4:12b']

function rampa(...args: string[]) {
  const run = spawnSync(process.execPath, ['src/cli.ts', 'check', ...args], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', RAMPA_LOCALE: 'en', RAMPA_MODEL: '' } })
  return { code: run.status, stdout: run.stdout, stderr: run.stderr }
}

describe('rampa check --timings', { timeout: 60_000 }, () => {
  it('adds report.timings to the JSON only when asked, and the section to the terminal report', () => {
    const plainRun = JSON.parse(rampa(...recorded, '--format', 'json').stdout) as Report
    expect(plainRun.timings).toBeUndefined()
    const timed = JSON.parse(rampa(...recorded, '--format', 'json', '--timings').stdout) as Report
    expect(timed.timings?.stages.map((s) => s.stage)).toEqual(['rules', 'source'])
    expect(timed.timings?.criteria.map((c) => c.criterion)).toEqual(['1.1.1', '1.3.5', '2.4.2', '2.4.4', '2.4.6', '3.1.1', '3.1.2', '3.3.2'])
    // Replayed offline, every call is a cached one.
    expect(timed.timings?.criteria.reduce((n, c) => n + c.calls, 0)).toBe(0)
    expect(timed.timings?.criteria.reduce((n, c) => n + c.cachedCalls, 0)).toBe(timed.usage.cachedCalls)
    const { timings: _, createdAt: __, ...rest } = timed
    const { createdAt: ___, ...same } = plainRun
    expect(rest).toEqual(same)
    expect(rampa(...recorded, '--timings').stdout).toContain('Time on this page:')
  })
})

// Integration: Microsoft Edge here, Google Chrome on CI (RAMPA_BROWSER_CHANNEL=chrome). Skipped, with the reason, without a browser.
const launched = await launchTestBrowser('the timings of a real collection')
const browser: Browser | undefined = 'browser' in launched ? launched.browser : undefined
if ('skip' in launched) console.warn(launched.skip)
afterAll(async () => {
  await browser?.close()
}, 60_000)

describe.skipIf(!browser)('timings of a page in a real browser', { timeout: 60_000 }, () => {
  it('times each stage of the collection, in pipeline order', async () => {
    if (!browser) throw new Error('no browser')
    const watch = new Stopwatch()
    await collectWeb(browser, pathToFileURL(resolve('examples/store/before.html')).href, { runAxe: true, locale: 'en', timings: watch })
    const stages = watch.result().stages.map((s) => s.stage)
    expect(stages).toEqual(expect.arrayContaining(['navigation', 'settle', 'collection', 'axe', 'ax-tree', 'pixel-contrast', 'teardown']))
    expect(stages).not.toContain('image-capture')
    expect(stages).toEqual(TIMING_STAGES.filter((stage) => stages.includes(stage)))
  })
})
