import { describe, expect, it } from 'vitest'
import { type JudgmentCache, memoryCache } from '../src/core/cache.ts'
import { checkSnapshot } from '../src/core/check.ts'
import { CONFIRM_MIN_PROBABILITY, decide } from '../src/core/confirm.ts'
import type { EngineResults } from '../src/core/types.ts'
import { resolveCriteria } from '../src/criteria/index.ts'
import { nonTextContent } from '../src/criteria/non-text-content.ts'
import { firstWordOf, probabilitiesOf, wordOf } from '../src/providers/ollama-word.ts'
import type { JudgeRequest, ModelProvider, WordRequest } from '../src/providers/types.ts'
import type { A11ySnapshot } from '../src/snapshot/schema.ts'
import { node } from './helpers.ts'

// The second pass over 1.1.1 claims that rest on the model's reading (core/confirm.ts): a finding only when the three
// one-word framings all confirm it, with enough probability where the provider gives one.

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
const NO_ENGINE: EngineResults = { engine: { name: 'axe-core', version: 'test' }, rules: [] }

function page(alt: string, src = '/fleet.jpg'): A11ySnapshot {
  return {
    schemaVersion: 1,
    surface: 'web',
    target: 'https://cars.example/fleet',
    title: 'Fleet | Cars',
    locale: 'en',
    viewport: { width: 1280, height: 800, scale: 1 },
    collectedAt: '2026-10-24T00:00:00.000Z',
    collector: { name: 'test', version: '0' },
    root: node({
      ref: 'html',
      role: 'document',
      lang: 'en',
      children: [
        node({
          ref: 'body',
          native: { tag: 'body' },
          children: [
            node({
              ref: 'main',
              role: 'main',
              children: [
                node({ ref: 'main > p', role: 'paragraph', text: 'Our fleet, ready to rent.' }),
                node({ ref: 'main > img', role: 'img', name: alt, image: PNG, bounds: { x: 0, y: 40, width: 200, height: 120 }, native: { tag: 'img', attributes: { src, alt }, html: `<img src="${src}" alt="${alt}">` } }),
              ],
            }),
          ],
        }),
      ],
    }),
  }
}

type Word = { word: string; probabilities?: Record<string, number> }
type Script = Partial<Record<'rules' | 'claim' | 'reversed', Word>>

/** A model that fails the image as "wrong content", and answers the three framings as scripted. */
function provider(words: Script | undefined, problem = 'wrong_content'): ModelProvider & { wordCalls: number } {
  const p: ModelProvider & { wordCalls: number } = {
    id: 'test:confirm',
    wordCalls: 0,
    async judge<T>(request: JudgeRequest<T>) {
      const alt = /Current text alternative: "([^"]*)"/.exec(request.user)?.[1] ?? ''
      const output = { verdict: 'fail', evidence: alt, problem, imageShows: 'A blue truck on a road.', suggestedAlt: 'Blue truck on a road', confidence: 'high' }
      return { output: request.schema.parse(output), inputTokens: 50, outputTokens: 20, latencyMs: 1, modelId: 'scripted' }
    },
  }
  if (words) {
    p.word = async (request: WordRequest) => {
      p.wordCalls++
      const framing = request.system.includes('pass or fail') ? 'rules' : request.system.includes("reviewer made the claim") ? 'claim' : 'reversed'
      const answer = words[framing]
      if (!answer) throw new Error(`no scripted answer for ${framing}`)
      return { word: answer.word, ...(answer.probabilities ? { probabilities: answer.probabilities } : {}), inputTokens: 40, outputTokens: 1, latencyMs: 1, modelId: 'scripted' }
    }
  }
  return p
}

const CONFIRMS: Script = { rules: { word: 'fail', probabilities: { fail: 0.99, pass: 0.01 } }, claim: { word: 'yes', probabilities: { yes: 0.98, no: 0.02 } }, reversed: { word: 'no', probabilities: { no: 0.97, yes: 0.03 } } }

async function check(snapshot: A11ySnapshot, p: ModelProvider, options: { cache?: JudgmentCache; offline?: boolean; confirm?: boolean } = {}) {
  return checkSnapshot(snapshot, NO_ENGINE, {
    criteria: resolveCriteria(['1.1.1']),
    llm: true,
    provider: p,
    runs: 1,
    cache: options.cache ?? memoryCache(),
    offline: options.offline ?? false,
    confirm: options.confirm,
    locale: 'en',
    minConfidence: 'medium',
    concurrency: 1,
  })
}

describe('the second pass over a 1.1.1 claim that rests on the model\'s reading', () => {
  it('asks three one-word framings of the same element, the finding among them, with the picture', () => {
    const snapshot = page('Red car')
    const [candidate] = nonTextContent.candidates(snapshot, NO_ENGINE)
    if (!candidate) throw new Error('no candidate')
    const output = { verdict: 'fail' as const, evidence: 'Red car', problem: 'wrong_content' as const, imageShows: 'A blue truck.', suggestedAlt: 'Blue truck', confidence: 'high' as const }
    const framings = nonTextContent.confirm?.(output, candidate, snapshot) ?? []
    expect(framings.map((f) => f.id)).toEqual(['rules', 'claim', 'reversed'])
    expect(framings[0]?.system.endsWith('Answer with exactly one word, pass or fail, and nothing else.')).toBe(true)
    expect(framings[0]?.system).not.toContain('Reply only with JSON')
    expect(framings[1]?.user).toContain('The text alternative "Red car" describes something the image does not show.')
    expect(framings[2]?.fail).toEqual(['no'])
    for (const framing of framings) {
      expect(framing.images?.length).toBe(1)
      expect(framing.user).not.toContain('Write imageShows and suggestedAlt in:')
      expect(framing.user).toContain('Current text alternative: "Red car"')
    }
    // Claims a pattern decides have no second pass.
    expect(nonTextContent.confirm?.({ ...output, evidence: 'IMG_1234.jpg', problem: 'filename_or_placeholder' }, { ...candidate, context: { ...candidate.context, alt: 'IMG_1234.jpg' } }, snapshot)).toBeUndefined()
    expect(nonTextContent.confirm?.({ ...output, problem: 'decorative' }, candidate, snapshot)).toBeUndefined()
  })

  it('keeps the finding when all three framings confirm it with enough probability, and says so', async () => {
    const p = provider(CONFIRMS)
    const report = await check(page('Red car'), p)
    expect(p.wordCalls).toBe(3)
    expect(report.findings).toHaveLength(1)
    expect(report.findings[0]?.confirmation).toEqual({ framings: 3, minProbability: 0.97 })
    expect(report.needsReview ?? []).toHaveLength(0)
    expect(report.criteria[0]).toMatchObject({ failed: 1, confirmed: 1 })
  })

  it('makes the claim a suggestion when a framing denies it, with what each one answered', async () => {
    const p = provider({ ...CONFIRMS, claim: { word: 'no', probabilities: { yes: 0.3, no: 0.7 } } })
    const report = await check(page('Red car'), p)
    expect(report.findings).toHaveLength(0)
    const item = report.needsReview?.[0]
    expect(item).toMatchObject({ criterion: '1.1.1', ruleId: 'judgment/1.1.1', model: 'test:confirm' })
    expect(item?.evidence).toContain('The model suggests: "Blue truck on a road"')
    expect(item?.evidence).toContain('did not confirm it (rules: fail (0.99), claim: no (0.30), reversed: no (0.97))')
    expect(report.criteria[0]).toMatchObject({ failed: 0, suggested: 1, unconfirmed: 1 })
  })

  it(`makes the claim a suggestion when the lowest probability of a confirming word is under ${CONFIRM_MIN_PROBABILITY}`, async () => {
    const p = provider({ ...CONFIRMS, rules: { word: 'fail', probabilities: { fail: 0.6, pass: 0.4 } } })
    const report = await check(page('Red car'), p)
    expect(report.findings).toHaveLength(0)
    expect(report.needsReview?.[0]?.evidence).toContain('rules: fail (0.60)')
  })

  it('decides on the words alone when the provider reports no probabilities', async () => {
    const p = provider({ rules: { word: 'fail' }, claim: { word: 'yes' }, reversed: { word: 'no' } })
    const report = await check(page('Red car'), p)
    expect(report.findings[0]?.confirmation).toEqual({ framings: 3 })
    const denied = provider({ rules: { word: 'fail' }, claim: { word: 'yes' }, reversed: { word: 'yes' } })
    expect((await check(page('Red car'), denied)).findings).toHaveLength(0)
  })

  it('makes the claim a suggestion when the provider cannot answer one-word questions', async () => {
    const report = await check(page('Red car'), provider(undefined))
    expect(report.findings).toHaveLength(0)
    expect(report.needsReview?.[0]?.evidence).toContain('cannot answer the second pass')
  })

  it('reads the answers from the cache, and offline without them the claim stays a suggestion', async () => {
    const cache = memoryCache()
    const p = provider(CONFIRMS)
    await check(page('Red car'), p, { cache })
    const again = provider(CONFIRMS)
    const second = await check(page('Red car'), again, { cache })
    expect(again.wordCalls).toBe(0)
    expect(second.findings[0]?.confirmation).toEqual({ framings: 3, minProbability: 0.97 })
    // Offline with the judgment cached but not the second pass's answers.
    const judgmentsOnly = memoryCache()
    const stash: Array<[string, Parameters<JudgmentCache['set']>[1]]> = []
    const spy: JudgmentCache = {
      get: (key) => judgmentsOnly.get(key),
      async set(key, value) {
        stash.push([key, value])
        if (!(typeof value.output === 'object' && value.output !== null && 'word' in (value.output as object))) await judgmentsOnly.set(key, value)
      },
    }
    await check(page('Red car'), provider(CONFIRMS), { cache: spy })
    expect(stash).toHaveLength(4)
    const offline = await check(page('Red car'), { id: 'test:confirm', judge: () => Promise.reject(new Error('offline')) }, { cache: judgmentsOnly, offline: true })
    expect(offline.findings).toHaveLength(0)
    expect(offline.needsReview?.[0]?.evidence).toContain('Offline')
    expect(offline.criteria[0]?.offlineMisses).toBe(1)
  })

  it('reports the claim as a finding without a second pass when confirm is off, or when a pattern decides the claim', async () => {
    const p = provider(CONFIRMS)
    const report = await check(page('Red car'), p, { confirm: false })
    expect(p.wordCalls).toBe(0)
    expect(report.findings).toHaveLength(1)
    expect(report.findings[0]?.confirmation).toBeUndefined()
    const placeholder = provider(CONFIRMS, 'filename_or_placeholder')
    const other = await check(page('IMG_2034.jpg', '/IMG_2034.jpg'), placeholder)
    expect(placeholder.wordCalls).toBe(0)
    expect(other.findings).toHaveLength(1)
  })
})

describe('the decision rule and the word reading', () => {
  it('confirms only when every framing confirms and the lowest probability reaches the threshold', () => {
    const all = [
      { framing: 'rules', word: 'fail', fail: true, probability: 0.95, cached: false },
      { framing: 'claim', word: 'yes', fail: true, probability: 0.91, cached: false },
      { framing: 'reversed', word: 'no', fail: true, probability: 0.99, cached: false },
    ]
    expect(decide(all)).toEqual({ confirmed: true, minProbability: 0.91 })
    expect(decide([...all.slice(0, 2), { ...all[2]!, fail: false, word: 'yes' }]).confirmed).toBe(false)
    expect(decide([...all.slice(0, 2), { ...all[2]!, probability: 0.89 }]).confirmed).toBe(false)
    expect(decide(all.map((a) => ({ ...a, probability: undefined })))).toEqual({ confirmed: true, minProbability: undefined })
    expect(decide([]).confirmed).toBe(false)
  })

  it('reads a token as a word and sums the probability of each allowed word over the alternatives', () => {
    expect(wordOf(' Fail')).toBe('fail')
    expect(wordOf('fail.')).toBe('fail')
    expect(firstWordOf('Pass, because the alt is fine')).toBe('pass')
    const top = [
      { token: 'fail', logprob: Math.log(0.6) },
      { token: ' Fail', logprob: Math.log(0.2) },
      { token: 'pass', logprob: Math.log(0.1) },
      { token: 'The', logprob: Math.log(0.1) },
    ]
    const probabilities = probabilitiesOf(top, ['fail', 'pass'])
    expect(probabilities?.fail).toBeCloseTo(0.8 / 0.9, 5)
    expect(probabilities?.pass).toBeCloseTo(0.1 / 0.9, 5)
    expect(probabilitiesOf([{ token: 'The', logprob: -0.1 }], ['fail', 'pass'])).toBeUndefined()
  })
})
