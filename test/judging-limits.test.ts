import { Command } from 'commander'
import { describe, expect, it } from 'vitest'
import { judgingLimits } from '../src/cli/commands/check.ts'
import { withConfigOptions } from '../src/cli/config-options.ts'
import { memoryCache } from '../src/core/cache.ts'
import { type CheckOptions, DEFAULT_MAX_CANDIDATES, capCandidates, checkSnapshot } from '../src/core/check.ts'
import type { EngineResults } from '../src/core/types.ts'
import { linkPurpose } from '../src/criteria/link-purpose.ts'
import type { JudgeRequest, ModelProvider } from '../src/providers/types.ts'
import { methodText } from '../src/report/common.ts'
import type { A11yNode, A11ySnapshot } from '../src/snapshot/schema.ts'
import { node } from './helpers.ts'
import { stubModel } from './stub-model.ts'

const NO_ENGINE: EngineResults = { engine: { name: 'axe-core', version: 'test' }, rules: [] }

function link(index: number, text: string): A11yNode {
  return node({
    ref: `#a${index}`,
    role: 'link',
    name: text,
    native: { tag: 'a', attributes: { href: `/page-${index}` }, html: `<a href="/page-${index}">${text}</a>` },
    children: [node({ ref: `#a${index}-text`, text })],
  })
}

/** A long listing: a link per item, with two "Read more" links far down the page. */
function listing(count: number): A11ySnapshot {
  const links = Array.from({ length: count }, (_, index) => link(index, index === 7 || index === 9 ? 'Read more' : `Book number ${index}`))
  return {
    schemaVersion: 1,
    surface: 'web',
    target: 'https://books.example/biographies',
    title: 'Biographies',
    locale: 'en',
    viewport: { width: 1280, height: 800, scale: 1 },
    collectedAt: '2026-10-09T00:00:00.000Z',
    collector: { name: 'test', version: '0' },
    root: node({ ref: 'html', role: 'document', lang: 'en', children: [node({ ref: 'body', native: { tag: 'body' }, children: links })] }),
  }
}

function options(provider: ModelProvider, extra: Partial<CheckOptions> = {}): CheckOptions {
  return {
    criteria: [linkPurpose],
    llm: true,
    provider,
    runs: 1,
    cache: memoryCache(),
    offline: false,
    locale: 'en',
    minConfidence: 'low',
    concurrency: 1,
    ...extra,
  }
}

/** A model that takes `ms` to answer each call, and gives up when the call is aborted, as the AI SDK does. */
function slowModel(ms: number): ModelProvider & { started: number } {
  const stub = stubModel()
  const provider = {
    id: 'test:slow',
    started: 0,
    async judge<T>(request: JudgeRequest<T>) {
      provider.started++
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, ms)
        request.signal?.addEventListener('abort', () => {
          clearTimeout(timer)
          reject(new Error('aborted'))
        })
      })
      return stub.judge(request)
    },
  }
  return provider
}

describe('a cap on the candidates judged per criterion and page', () => {
  it('judges the generic texts first, then the rest in page order, and keeps page order', () => {
    const page = listing(12)
    const candidates = linkPurpose.candidates(page, NO_ENGINE)
    expect(candidates).toHaveLength(12)
    const kept = capCandidates(linkPurpose, page, candidates, 4)
    expect(kept.map((c) => c.ref)).toEqual(['#a0', '#a1', '#a7', '#a9'])
    expect(capCandidates(linkPurpose, page, candidates, 0)).toHaveLength(12)
    expect(capCandidates(linkPurpose, page, candidates, 50)).toHaveLength(12)
  })

  it('reports the rest as not judged: in the summary, the coverage and a note', async () => {
    const model = stubModel()
    const report = await checkSnapshot(listing(12), NO_ENGINE, options(model, { maxCandidates: 4 }))
    expect(model.asked).toHaveLength(4)
    expect(report.criteria[0]).toMatchObject({ candidates: 12, judged: 4, capped: 8 })
    expect(report.criteria[0]?.timedOut).toBeUndefined()
    // The two "Read more" links were judged, and fail.
    expect(report.findings.map((f) => f.ref)).toEqual(['#a7', '#a9'])
    const record = report.coverage.criteria?.find((c) => c.id === '2.4.4')
    expect(record?.methods.find((m) => m.kind === 'judgment')).toMatchObject({ applicable: 12, failures: 2, notJudged: 8 })
    expect(report.notes).toEqual([
      'The model judged at most 4 candidates per criterion on this page (--max-candidates), those with a generic text first; it did not judge 8 of 12 for 2.4.4. The coverage lists them as not judged.',
    ])
    const method = record?.methods.find((m) => m.kind === 'judgment')
    if (!method) throw new Error('no judgment method')
    expect(methodText(method, report)).toBe(`judgment 2.4.4@${linkPurpose.version} (12 applicable, 2 failed, 0 to review, 8 not judged)`)
  })

  it('leaves to a person a criterion it found nothing on but did not judge in full', async () => {
    const page = listing(6)
    for (const item of page.root.children[0]?.children ?? []) {
      item.name = item.name === 'Read more' ? 'Book number 99' : item.name
    }
    const capped = await checkSnapshot(page, NO_ENGINE, options(stubModel(), { maxCandidates: 2 }))
    expect(capped.coverage.criteria?.find((c) => c.id === '2.4.4')?.status).toBe('needs-review')
    const whole = await checkSnapshot(page, NO_ENGINE, options(stubModel()))
    expect(whole.coverage.criteria?.find((c) => c.id === '2.4.4')?.status).toBe('no-failure-found')
    expect(whole.notes).toBeUndefined()
  })

  it(`caps at ${DEFAULT_MAX_CANDIDATES} by default`, async () => {
    const model = stubModel()
    const report = await checkSnapshot(listing(DEFAULT_MAX_CANDIDATES + 5), NO_ENGINE, options(model))
    expect(model.asked).toHaveLength(DEFAULT_MAX_CANDIDATES)
    expect(report.criteria[0]).toMatchObject({ capped: 5 })
  })
})

describe('a time limit per page', () => {
  it('writes a partial report: what was judged before the limit, and a note on the rest', async () => {
    const model = slowModel(40)
    const report = await checkSnapshot(listing(12), NO_ENGINE, options(model, { deadline: Date.now() + 300 }))
    const summary = report.criteria[0]
    if (!summary) throw new Error('no summary')
    expect(summary.judged).toBeGreaterThan(0)
    expect(summary.timedOut).toBeGreaterThan(0)
    expect(summary.judged + (summary.timedOut ?? 0)).toBe(12)
    expect(summary.errors).toBe(0)
    expect(report.errors).toEqual([])
    // No call starts after the limit.
    expect(model.started).toBeLessThanOrEqual(summary.judged + 1)
    expect(report.notes?.[0]).toMatch(/^The time limit ran out \(--time-limit\), so this report has what was collected and judged until then; the model did not judge \d+ of 12 for 2\.4\.4\./)
    expect(report.coverage.criteria?.find((c) => c.id === '2.4.4')?.methods.find((m) => m.kind === 'judgment')).toMatchObject({ notJudged: summary.timedOut })
  })

  it('stops waiting for a model that never answers, and still reads the cache', async () => {
    // The same model as the one that filled the cache, now stuck.
    const never: ModelProvider = { id: stubModel().id, judge: () => new Promise(() => undefined) }
    const cache = memoryCache()
    // A first run with a model that answers fills the cache for three of the links.
    await checkSnapshot(listing(5), NO_ENGINE, options(stubModel(), { cache, maxCandidates: 3 }))
    const started = Date.now()
    const report = await checkSnapshot(listing(5), NO_ENGINE, { ...options(never, { cache }), deadline: Date.now() + 150 })
    expect(Date.now() - started).toBeLessThan(5000)
    expect(report.criteria[0]).toMatchObject({ candidates: 5, judged: 3, timedOut: 2 })
    expect(report.usage.cachedCalls).toBe(3)
  })

  it('judges nothing when the limit ran out while the page loaded, and says the criterion was not checked', async () => {
    const model = stubModel()
    const report = await checkSnapshot(listing(4), NO_ENGINE, options(model, { deadline: Date.now() - 1 }))
    expect(model.asked).toHaveLength(0)
    expect(report.criteria[0]).toMatchObject({ judged: 0, timedOut: 4 })
    expect(report.coverage.criteria?.find((c) => c.id === '2.4.4')?.status).toBe('not-checked')
  })
})

describe('the --max-candidates and --time-limit options', () => {
  it('parse whole numbers, 0 for no cap, and refuse the rest', () => {
    expect(judgingLimits({ maxCandidates: '20', timeLimit: '840' })).toEqual({ maxCandidates: 20, timeLimitMs: 840_000 })
    expect(judgingLimits({ maxCandidates: '0' })).toEqual({ maxCandidates: 0, timeLimitMs: undefined })
    expect(() => judgingLimits({ maxCandidates: '-1' })).toThrow('--max-candidates')
    expect(() => judgingLimits({ timeLimit: '0' })).toThrow('--time-limit')
    expect(() => judgingLimits({ timeLimit: '5m' })).toThrow('--time-limit')
  })

  it('take the config file values when the command line leaves them out', () => {
    const parse = (args: string[]) => {
      const command = new Command().exitOverride().option('--max-candidates <n>', 'cap', '50').option('--time-limit <seconds>', 'limit')
      command.parse(args, { from: 'user' })
      return withConfigOptions(command, command.opts(), { maxCandidates: 10, timeLimit: 600 })
    }
    expect(parse([])).toEqual({ maxCandidates: '10', timeLimit: '600' })
    expect(parse(['--time-limit', '30', '--max-candidates', '5'])).toEqual({ maxCandidates: '5', timeLimit: '30' })
  })
})
