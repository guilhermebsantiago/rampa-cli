import { describe, expect, it } from 'vitest'
import { memoryCache } from '../src/core/cache.ts'
import { checkSnapshot } from '../src/core/check.ts'
import { judgeCandidates, withoutDelimiters } from '../src/core/judge.ts'
import { languageOfParts } from '../src/criteria/language-of-parts.ts'
import { type NonTextContentContext, nonTextContent } from '../src/criteria/non-text-content.ts'
import { pageTitled } from '../src/criteria/page-titled.ts'
import type { ModelProvider } from '../src/providers/types.ts'
import { passingEngine, scriptedProvider, travelSnapshot } from './helpers.ts'

/**
 * qwen3.5:9b on Ollama copies a quote together with what the prompt shows it in: the quotation
 * marks around an alt, or the <title> and <heading> tags around a title or a heading.
 */

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

function answering(output: unknown): ModelProvider {
  return {
    id: 'test:quotes',
    async judge(request) {
      return { output: request.schema.parse(output), inputTokens: 1, outputTokens: 1, latencyMs: 1, modelId: 'quotes' }
    },
  }
}

const options = (output: unknown) => ({ provider: answering(output), runs: 1, cache: memoryCache(), offline: false, concurrency: 1 })

function image(alt: string) {
  const context: NonTextContentContext = { alt, role: 'img', html: '<img src="logo.png">', src: 'logo.png', language: 'en', actionText: undefined, nearbyText: undefined, image: PNG }
  return { ref: 'img', context }
}

const judgeAlt = (alt: string, evidence: string) =>
  judgeCandidates(nonTextContent, travelSnapshot(), [image(alt)], options({ verdict: 'pass', evidence, problem: 'none', imageShows: 'The W3C logo', suggestedAlt: '', confidence: 'high' }))

describe('evidence copied with its delimiters', () => {
  it('finds quotation marks or a matching tag around the evidence, at most two layers', () => {
    const claim = { verdict: 'pass' as const, evidence: '"W3C logo"', confidence: 'high' as const }
    const unwrap = (evidence: string) => withoutDelimiters({ ...claim, evidence })?.evidence
    expect(unwrap('"W3C logo"')).toBe('W3C logo')
    expect(unwrap('“W3C logo”')).toBe('W3C logo')
    expect(unwrap(" 'W3C logo' ")).toBe('W3C logo')
    expect(unwrap('<title>Untitled document</title>')).toBe('Untitled document')
    expect(unwrap('"<heading>New arrivals</heading>"')).toBe('New arrivals')
    expect(unwrap('<a href="/x">Read more</a>')).toBe('Read more')
    expect(unwrap('W3C logo')).toBeUndefined()
    expect(unwrap('"W3C" logo')).toBeUndefined()
    expect(unwrap('<b>W3C</b> logo')).toBeUndefined()
    expect(unwrap('<title>Shop</heading>')).toBeUndefined()
    expect(unwrap('""')).toBeUndefined()
  })

  it('keeps an exact quote that came wrapped in quotation marks, without them', async () => {
    const [judgment] = await judgeAlt('W3C logo', '"W3C logo"')
    expect(judgment?.status).toBe('passed')
    expect(judgment?.representative?.evidence).toBe('W3C logo')
  })

  it('never changes a claim that held as written', async () => {
    const [judgment] = await judgeAlt('"Rex"', '"Rex"')
    expect(judgment?.status).toBe('passed')
    expect(judgment?.representative?.evidence).toBe('"Rex"')
  })

  it('still discards a wrapped claim that does not match the snapshot', async () => {
    const [judgment] = await judgeAlt('W3C logo', '"World Wide Web Consortium logo"')
    expect(judgment?.status).toBe('discarded')
    expect(judgment?.verification).toEqual({ ok: false, reason: 'evidence is not the current text alternative' })
    expect(judgment?.representative?.evidence).toBe('"World Wide Web Consortium logo"')
  })

  it('keeps a title quoted with the <title> tag the prompt shows it in', async () => {
    const snapshot = { ...travelSnapshot(), title: 'Untitled document' }
    const [candidate] = pageTitled.candidates(snapshot, passingEngine())
    if (!candidate) throw new Error('no title candidate')
    const claim = { verdict: 'fail', evidence: '<title>Untitled document</title>', problem: 'generic', suggestedTitle: 'Travel notes: Amsterdam and Lisbon', confidence: 'high' }
    const [judgment] = await judgeCandidates(pageTitled, snapshot, [candidate], options(pageTitled.schema.parse({ ...claim })))
    expect(judgment?.status).toBe('failed')
    expect(judgment?.representative?.evidence).toBe('Untitled document')
  })

  it('reports the finding with the quote as it is on the page', async () => {
    const dutch = { verdict: 'fail', detectedLanguage: 'nl', evidence: '“Het weer is vandaag mooi”', exception: 'none', confidence: 'high' }
    const portuguese = { verdict: 'pass', detectedLanguage: 'pt', evidence: '"Bem-vindo à feira"', exception: 'none', confidence: 'high' }
    const report = await checkSnapshot(travelSnapshot(), passingEngine(), {
      criteria: [languageOfParts],
      llm: true,
      provider: scriptedProvider({ blockquote: [dutch], 'p.sign': [portuguese] }),
      runs: 1,
      cache: memoryCache(),
      offline: false,
      locale: 'en',
      minConfidence: 'medium',
      concurrency: 1,
    })
    expect(report.discarded).toEqual([])
    expect(report.findings.map((f) => f.evidence)).toEqual(['Het weer is vandaag mooi'])
    expect(report.criteria[0]).toMatchObject({ failed: 1, passed: 1, discarded: 0 })
  })
})
