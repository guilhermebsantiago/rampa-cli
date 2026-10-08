import { describe, expect, it } from 'vitest'
import { memoryCache } from '../src/core/cache.ts'
import { type CheckOptions, checkSnapshot } from '../src/core/check.ts'
import { majority } from '../src/core/judge.ts'
import { languageOfParts } from '../src/criteria/language-of-parts.ts'
import { passingEngine, scriptedProvider, travelSnapshot } from './helpers.ts'

const dutchFail = { verdict: 'fail', detectedLanguage: 'nl', evidence: 'Het weer is vandaag mooi', exception: 'none', confidence: 'high' }
const portuguesePass = { verdict: 'pass', detectedLanguage: 'pt', evidence: 'Bem-vindo à feira', exception: 'none', confidence: 'high' }
const fabricated = { ...dutchFail, evidence: 'Het weer is vandaag verschrikkelijk' }

function options(provider: CheckOptions['provider'], extra: Partial<CheckOptions> = {}): CheckOptions {
  return {
    criteria: [languageOfParts],
    llm: true,
    provider,
    runs: 1,
    cache: memoryCache(),
    offline: false,
    locale: 'en',
    minConfidence: 'medium',
    concurrency: 1,
    ...extra,
  }
}

describe('checkSnapshot', () => {
  it('reports a verified judgment with its evidence and patch', async () => {
    const provider = scriptedProvider({ blockquote: [dutchFail], 'p.sign': [portuguesePass] })
    const report = await checkSnapshot(travelSnapshot(), passingEngine(), options(provider))
    expect(report.findings).toHaveLength(1)
    expect(report.findings[0]).toMatchObject({ criterion: '3.1.2', source: 'judgment', ref: 'blockquote', evidence: 'Het weer is vandaag mooi' })
    expect(report.findings[0]?.patch?.after).toBe('<blockquote lang="nl">')
    expect(report.criteria[0]).toMatchObject({ candidates: 2, judged: 2, failed: 1, passed: 1, discarded: 0 })
    expect(report.coverage.judged).toEqual(['3.1.2'])
  })

  it('drops a claim whose evidence is not on the page', async () => {
    const provider = scriptedProvider({ blockquote: [fabricated], 'p.sign': [portuguesePass] })
    const report = await checkSnapshot(travelSnapshot(), passingEngine(), options(provider))
    expect(report.findings).toHaveLength(0)
    expect(report.discarded).toEqual([expect.objectContaining({ ref: 'blockquote', reason: 'evidence is not in the element text' })])
  })

  it('keeps the unverified claim only in the ablation run', async () => {
    const provider = scriptedProvider({ blockquote: [fabricated], 'p.sign': [portuguesePass] })
    const report = await checkSnapshot(travelSnapshot(), passingEngine(), options(provider, { verify: false }))
    expect(report.findings.map((f) => f.ref)).toEqual(['blockquote'])
    expect(report.criteria[0]).toMatchObject({ discarded: 1, failed: 0 })
  })

  it('abstains on cannot_tell', async () => {
    const provider = scriptedProvider({
      blockquote: [{ ...dutchFail, verdict: 'cannot_tell' }],
      'p.sign': [portuguesePass],
    })
    const report = await checkSnapshot(travelSnapshot(), passingEngine(), options(provider))
    expect(report.findings).toHaveLength(0)
    expect(report.criteria[0]?.cannotTell).toBe(1)
  })

  it('votes across runs and lowers confidence when runs disagree', async () => {
    const provider = scriptedProvider({
      blockquote: [dutchFail, dutchFail, { ...dutchFail, verdict: 'cannot_tell' }],
      'p.sign': [portuguesePass, portuguesePass, portuguesePass],
    })
    const report = await checkSnapshot(travelSnapshot(), passingEngine(), options(provider, { runs: 3 }))
    expect(report.findings[0]).toMatchObject({ agreement: { votes: 2, total: 3 }, confidence: 'medium' })
  })

  it('never calls the model twice for the same input', async () => {
    const cache = memoryCache()
    const first = scriptedProvider({ blockquote: [dutchFail], 'p.sign': [portuguesePass] })
    await checkSnapshot(travelSnapshot(), passingEngine(), options(first, { cache }))
    const second = scriptedProvider({})
    second.id = first.id
    const report = await checkSnapshot(travelSnapshot(), passingEngine(), options(second, { cache }))
    expect(second.calls).toBe(0)
    expect(report.findings).toHaveLength(1)
    expect(report.usage.cachedCalls).toBe(2)
  })

  it('runs only the engine with --no-llm', async () => {
    const provider = scriptedProvider({})
    const report = await checkSnapshot(travelSnapshot(), passingEngine(), options(provider, { llm: false }))
    expect(provider.calls).toBe(0)
    expect(report.llm).toBe('off')
    expect(report.criteria[0]).toMatchObject({ candidates: 2, judged: 0 })
  })

  it('never claims the page is accessible: unchecked criteria stay listed', async () => {
    const report = await checkSnapshot(travelSnapshot(), passingEngine(), options(undefined, { llm: false }))
    expect(report.coverage.notChecked.length).toBeGreaterThan(40)
  })
})

describe('majority', () => {
  it('abstains on a tie', () => {
    expect(majority(['fail', 'pass'])).toEqual({ verdict: 'cannot_tell', votes: 1 })
    expect(majority(['fail', 'fail', 'pass'])).toEqual({ verdict: 'fail', votes: 2 })
  })
})
