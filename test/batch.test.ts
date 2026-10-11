import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { resolveSettings } from '../src/api/options.ts'
import { batchSetting } from '../src/cli/commands/check.ts'
import { BATCH_SYSTEM, batchAnswers, batchPrompt, batchSchema, batchesOf } from '../src/core/batch.ts'
import { type CachedJudgment, type JudgmentCache, memoryCache } from '../src/core/cache.ts'
import { type CheckOptions, checkSnapshot } from '../src/core/check.ts'
import { Stopwatch } from '../src/core/timings.ts'
import type { EngineResults, Report } from '../src/core/types.ts'
import { linkPurpose } from '../src/criteria/link-purpose.ts'
import type { JudgeRequest, ModelProvider } from '../src/providers/types.ts'
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

/** A listing with a link per item, two of them "Read more". */
function listing(count: number): A11ySnapshot {
  const links = Array.from({ length: count }, (_, index) => link(index, index === 3 || index === 9 ? 'Read more' : `Book number ${index}`))
  return {
    schemaVersion: 1,
    surface: 'web',
    target: 'https://books.example/biographies',
    title: 'Biographies',
    locale: 'en',
    viewport: { width: 1280, height: 800, scale: 1 },
    collectedAt: '2026-10-11T00:00:00.000Z',
    collector: { name: 'test', version: '0' },
    root: node({ ref: 'html', role: 'document', lang: 'en', children: [node({ ref: 'body', native: { tag: 'body' }, children: links })] }),
  }
}

// 2.4.4 allows batches of 8 (link-purpose.ts); the tests hold the criterion to its own setting.
const MAX = linkPurpose.batch ?? 0

function options(provider: ModelProvider | undefined, extra: Partial<CheckOptions> = {}): CheckOptions {
  return { criteria: [linkPurpose], llm: true, provider, runs: 1, cache: memoryCache(), offline: false, locale: 'en', minConfidence: 'low', concurrency: 2, batch: true, ...extra }
}

/** The stub, with a hook that changes a batch's answer before it is returned. */
function editedBatches(edit: (items: Array<{ id: string; judgment: Record<string, unknown> }>) => Array<{ id: string; judgment: Record<string, unknown> }>): ModelProvider & { batches: number[]; singles: number } {
  const stub = stubModel()
  const provider = {
    id: stub.id,
    batches: [] as number[],
    singles: 0,
    async judge<T>(request: JudgeRequest<T>) {
      if (!request.schemaName.endsWith('_batch')) {
        provider.singles++
        return stub.judge(request)
      }
      const answer = await stub.judge({ ...request, schema: { parse: (value: unknown) => value } as unknown as JudgeRequest<T>['schema'] })
      const items = (answer.output as { items: Array<{ id: string; judgment: Record<string, unknown> }> }).items
      provider.batches.push(items.length)
      return { ...answer, output: request.schema.parse({ items: edit(items) }) }
    },
  }
  return provider
}

describe('batches', () => {
  it('splits candidates into as few batches as the cap allows, of even sizes, in order', () => {
    expect(batchesOf([1, 2, 3], 8)).toEqual([[1, 2, 3]])
    expect(batchesOf(Array.from({ length: 10 }, (_, i) => i), 8).map((b) => b.length)).toEqual([5, 5])
    expect(batchesOf(Array.from({ length: 17 }, (_, i) => i), 8).map((b) => b.length)).toEqual([6, 6, 5])
    expect(batchesOf([], 8)).toEqual([])
  })

  it('wraps each question in an item under the criterion instructions, and reads one answer per id', () => {
    const prompt = batchPrompt('Judge one link.', ['<link>A</link>', '<link>B</link>'])
    expect(prompt.system).toBe(`Judge one link.\n\n${BATCH_SYSTEM}`)
    expect(prompt.user).toBe('<item id="1">\n<link>A</link>\n</item>\n\n<item id="2">\n<link>B</link>\n</item>')
    const schema = batchSchema(linkPurpose.schema, prompt.ids)
    const judgment = { promises: '', leadsTo: '', verdict: 'pass', evidence: 'A', problem: 'none', suggestedText: '', confidence: 'high' }
    expect(schema.safeParse({ items: [{ id: '3', judgment }] }).success).toBe(false)
    const answers = batchAnswers({ items: [{ id: '2', judgment: { ...judgment, evidence: 'B' } }, { id: '2', judgment }, { id: '1', judgment }] }, prompt.ids)
    // The first answer for an id counts; a second one is ignored.
    expect(answers.get('2')?.evidence).toBe('B')
    expect(answers.get('1')?.evidence).toBe('A')
  })
})

describe('batched judgment', () => {
  it('judges a criterion that allows it several candidates to a call, with the same findings as one call each', async () => {
    expect(MAX).toBeGreaterThan(1)
    const model = stubModel()
    const batched = await checkSnapshot(listing(12), NO_ENGINE, options(model))
    expect(model.batches).toEqual([6, 6])
    expect(model.asked).toHaveLength(12)
    expect(batched.usage.calls).toBe(2)
    expect(batched.criteria[0]).toMatchObject({ candidates: 12, judged: 12, batched: { candidates: 12, calls: 2 } })
    const single = await checkSnapshot(listing(12), NO_ENGINE, options(stubModel(), { batch: false }))
    expect(single.usage.calls).toBe(12)
    expect(single.criteria[0]?.batched).toBeUndefined()
    expect(batched.findings.map((f) => f.fingerprint)).toEqual(single.findings.map((f) => f.fingerprint))
    expect(batched.findings.map((f) => f.ref)).toEqual(['#a3', '#a9'])
    // Usage counts each batch once; its tokens are the batch call's.
    expect(batched.usage.inputTokens).toBe(2 * 120)
  })

  it('records the batches in the timings', async () => {
    const watch = new Stopwatch()
    await checkSnapshot(listing(12), NO_ENGINE, options(stubModel(), { timings: watch }))
    expect(watch.result().criteria[0]).toMatchObject({ candidates: 12, judged: 12, calls: 2, cachedCalls: 0, batches: 2 })
  })

  it('caches a batch by its own prompt, and never answers a candidate asked alone with it', async () => {
    const cache = memoryCache()
    await checkSnapshot(listing(12), NO_ENGINE, options(stubModel(), { cache }))
    const again = stubModel()
    const replay = await checkSnapshot(listing(12), NO_ENGINE, options(again, { cache }))
    expect(again.asked).toHaveLength(0)
    expect(replay.usage).toMatchObject({ calls: 0, cachedCalls: 2 })
    // Asked one at a time, every candidate is a new question.
    const alone = stubModel()
    const single = await checkSnapshot(listing(12), NO_ENGINE, options(alone, { cache, batch: false }))
    expect(single.usage).toMatchObject({ calls: 12, cachedCalls: 0 })
    // Offline, a batch the cache has is read; without it, each candidate is looked up alone.
    const identity: ModelProvider = {
      id: 'stub:rules',
      judge() {
        throw new Error('offline')
      },
    }
    const offline = await checkSnapshot(listing(12), NO_ENGINE, options(identity, { cache, offline: true }))
    expect(offline.usage).toMatchObject({ calls: 0, cachedCalls: 2 })
    const cold = await checkSnapshot(listing(12), NO_ENGINE, options(undefined, { offline: true }))
    expect(cold.criteria[0]).toMatchObject({ offlineMisses: 12 })
  })

  it('asks alone a candidate the answer left out, and every candidate of a batch whose call failed', async () => {
    const dropping = editedBatches((items) => items.slice(0, -1))
    const report = await checkSnapshot(listing(12), NO_ENGINE, options(dropping))
    expect(dropping.batches).toEqual([6, 6])
    expect(dropping.singles).toBe(2)
    expect(report.criteria[0]).toMatchObject({ judged: 12, batched: { candidates: 10, calls: 2 } })
    expect(report.usage.calls).toBe(4)

    const failing: ModelProvider = {
      id: 'stub:rules',
      async judge<T>(request: JudgeRequest<T>) {
        if (request.schemaName.endsWith('_batch')) throw new Error('context window exceeded')
        return stubModel().judge(request)
      },
    }
    const fallback = await checkSnapshot(listing(12), NO_ENGINE, options(failing))
    expect(fallback.criteria[0]).toMatchObject({ judged: 12, errors: 0 })
    expect(fallback.criteria[0]?.batched).toBeUndefined()
    expect(fallback.findings.map((f) => f.ref)).toEqual(['#a3', '#a9'])
  })

  it("verifies each answer against its own candidate: an answer about another item's link is discarded", async () => {
    // In the first batch, the model answers item 4 (the first "Read more") with item 5's text.
    const swap = (items: Array<{ id: string; judgment: Record<string, unknown> }>) =>
      items.map((item) => (item.id === '4' ? { ...item, judgment: { ...item.judgment, evidence: 'Book number 4' } } : item))
    const swapped = editedBatches((items) => (items.some((item) => item.judgment.evidence === 'Book number 0') ? swap(items) : items))
    const report = await checkSnapshot(listing(12), NO_ENGINE, options(swapped))
    expect(report.findings.map((f) => f.ref)).toEqual(['#a9'])
    expect(report.discarded.map((d) => d.ref)).toEqual(['#a3'])
  })

  it('never batches a candidate alone in its group, and stops at the time limit', async () => {
    const one = stubModel()
    await checkSnapshot(listing(1), NO_ENGINE, options(one))
    expect(one.batches).toEqual([])
    expect(one.asked).toHaveLength(1)
    const late = stubModel()
    const report = await checkSnapshot(listing(6), NO_ENGINE, options(late, { deadline: Date.now() - 1 }))
    expect(late.asked).toHaveLength(0)
    expect(report.criteria[0]).toMatchObject({ judged: 0, timedOut: 6 })
  })

  it('stays off unless asked for', async () => {
    const model = stubModel()
    await checkSnapshot(listing(4), NO_ENGINE, options(model, { batch: undefined }))
    expect(model.batches).toEqual([])
  })
})

describe('the batch setting', () => {
  it('is --batch or --no-batch, else the config, else on with --fast only', () => {
    expect(batchSetting({}, {})).toBe(false)
    expect(batchSetting({ fast: true }, {})).toBe(true)
    expect(batchSetting({ fast: true, batch: false }, {})).toBe(false)
    expect(batchSetting({ fast: true }, { batch: false })).toBe(false)
    expect(batchSetting({}, { batch: true })).toBe(true)
    expect(batchSetting({ batch: true }, {})).toBe(true)
  })

  it('is on from code with fast, unless batch says otherwise', async () => {
    expect((await resolveSettings({ fast: true, config: false, noLlm: true })).batch).toBe(true)
    expect((await resolveSettings({ fast: true, batch: false, config: false, noLlm: true })).batch).toBe(false)
    expect((await resolveSettings({ config: false, noLlm: true })).batch).toBe(false)
  })
})

describe('rampa check --batch', { timeout: 60_000 }, () => {
  // The recorded page and its recorded judgments, made one call per candidate: no browser, model or network.
  const recorded = ['demo/recorded/examples-store-before.snapshot.json', '--offline', '--cache-dir', 'demo/recorded/cache', '--model', 'ollama:gemma4:12b', '--format', 'json']
  const rampa = (...args: string[]) =>
    JSON.parse(spawnSync(process.execPath, ['src/cli.ts', 'check', ...recorded, ...args], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', RAMPA_LOCALE: 'en', RAMPA_MODEL: '' } }).stdout) as Report

  it('reads the judgments made one at a time when the cache has no batch: the same report', () => {
    const batched = rampa('--batch')
    const single = rampa()
    expect(batched.criteria.some((c) => c.batched)).toBe(false)
    expect(batched.findings).toEqual(single.findings)
    expect(batched.usage).toEqual(single.usage)
  })
})

describe('a batch answer in a shared cache', () => {
  it('is a cache entry of its own, apart from every candidate', async () => {
    const entries = new Map<string, CachedJudgment>()
    const cache: JudgmentCache = {
      get: async (key) => entries.get(key),
      set: async (key, value) => void entries.set(key, value),
    }
    await checkSnapshot(listing(3), NO_ENGINE, options(stubModel(), { cache }))
    expect(entries.size).toBe(1)
    const [entry] = [...entries.values()]
    expect((entry?.output as { items: unknown[] }).items).toHaveLength(3)
  })
})
