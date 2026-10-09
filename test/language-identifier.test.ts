import { beforeAll, describe, expect, it } from 'vitest'
import { memoryCache } from '../src/core/cache.ts'
import { checkSnapshot } from '../src/core/check.ts'
import { agreement, fitsAsWell, identifierCode, loadLanguageIdentifier, readLanguage } from '../src/core/language-id.ts'
import type { EngineResults } from '../src/core/types.ts'
import { languageOfPage } from '../src/criteria/language-of-page.ts'
import { languageOfParts } from '../src/criteria/language-of-parts.ts'
import type { ModelProvider } from '../src/providers/types.ts'
import type { A11yNode, A11ySnapshot } from '../src/snapshot/schema.ts'
import { node } from './helpers.ts'

// Texts written for these tests; none is copied from an ACT test page.
const PORTUGUESE =
  'Todo sábado, das sete ao meio-dia, a feira ocupa a praça em frente à igreja. Os produtores trazem frutas, verduras e queijos da serra, e quem chega cedo encontra o pão ainda quente na banca do café.'
const ENGLISH_SHORT = 'Our bakery opens at seven every morning. Bread is baked on site, and the menu changes with the seasons.'
const ENGLISH_LONG =
  'The city council approved a new plan for bicycle lanes last week. Work on the first stretch begins in March, and the council expects the whole route along the river to open before the end of next year.'
const NO_ENGINE: EngineResults = { engine: { name: 'axe-core', version: 'test' }, rules: [] }

function page(lang: string, children: A11yNode[], langText?: string): A11ySnapshot {
  return {
    schemaVersion: 1,
    surface: 'web',
    target: 'test://language',
    locale: lang,
    viewport: { width: 1280, height: 800, scale: 1 },
    collectedAt: '2026-10-09T00:00:00.000Z',
    collector: { name: 'test', version: '0' },
    root: node({
      ref: 'html',
      role: 'document',
      lang,
      native: { tag: 'html', html: `<html lang="${lang}">`, ...(langText ? { langText } : {}) },
      children: [node({ ref: 'html > body', native: { tag: 'body' }, children })],
    }),
  }
}

function paragraph(ref: string, text: string, lang?: string): A11yNode {
  return node({ ref, role: 'paragraph', text, lang, native: { tag: 'p', ...(lang ? { langText: text, html: `<p lang="${lang}">${text}</p>` } : {}) } })
}

/** A model that must never be asked. */
const silent: ModelProvider = {
  id: 'test:silent',
  async judge() {
    throw new Error('the model was asked')
  },
}

function answering(output: unknown): ModelProvider & { calls: number } {
  const provider = {
    id: 'test:answering',
    calls: 0,
    async judge<T>(request: { schema: { parse(value: unknown): T } }) {
      provider.calls++
      return { output: request.schema.parse(output), inputTokens: 10, outputTokens: 5, latencyMs: 1, modelId: 'answering' }
    },
  }
  return provider
}

const options = (provider: ModelProvider | undefined, llm = true) => ({
  criteria: [languageOfPage, languageOfParts],
  llm,
  provider,
  runs: 1,
  cache: memoryCache(),
  offline: false,
  locale: 'en' as const,
  minConfidence: 'low' as const,
  concurrency: 1,
})

it('reads nothing until the n-gram database is loaded', () => {
  expect(readLanguage(PORTUGUESE)).toBeUndefined()
})

describe('the language identifier', () => {
  beforeAll(loadLanguageIdentifier)

  it('reads a long paragraph clearly, and says whether a declared language agrees', () => {
    const reading = readLanguage(PORTUGUESE)
    expect(reading).toMatchObject({ language: 'pt', confident: true, clear: true })
    expect(agreement(reading, 'en', 'clear')).toBe('other')
    expect(agreement(reading, 'pt-BR', 'clear')).toBe('same')
    expect(reading?.sample && PORTUGUESE.includes(reading.sample)).toBe(true)
  })

  it('is never sure of a short phrase', () => {
    const reading = readLanguage('Fireworks over Paris')
    expect(reading?.confident).toBe(false)
    expect(agreement(reading, 'nl', 'confident')).toBe('unsure')
  })

  it('is not clear about a text split between two languages', () => {
    const reading = readLanguage(`${ENGLISH_LONG} ${PORTUGUESE}`)
    expect(reading?.clear).toBe(false)
  })

  it('finds a phrase that reads as well in two languages', () => {
    const reading = readLanguage('Paul put dire comment on tape')
    expect(fitsAsWell(reading, 'fr')).toBe(true)
    expect(fitsAsWell(reading, 'de')).toBe(false)
  })

  it('stays unsure about languages it has no n-grams for or easily confuses', () => {
    expect(agreement(readLanguage(PORTUGUESE), 'gl', 'clear')).toBe('unsure')
    expect(identifierCode('nb-NO')).toBe('no')
  })
})

describe('3.1.1 with the identifier', () => {
  beforeAll(loadLanguageIdentifier)

  it('fails a long, clear mismatch without asking a model, and says what decided it', async () => {
    const snapshot = page('en', [paragraph('p', PORTUGUESE)], PORTUGUESE)
    const report = await checkSnapshot(snapshot, NO_ENGINE, options(silent))
    const finding = report.findings.find((f) => f.criterion === '3.1.1')
    expect(finding).toMatchObject({ source: 'judgment', confidence: 'high', model: undefined })
    expect(finding?.message).toContain('Portuguese (pt)')
    expect(finding?.message).toContain('with no model asked')
    expect(PORTUGUESE).toContain(finding?.evidence ?? '-')
    expect(report.usage.calls).toBe(0)
  })

  it('decides with judgment on but no model, and judges nothing with --no-llm', async () => {
    const snapshot = page('en', [paragraph('p', PORTUGUESE)], PORTUGUESE)
    expect((await checkSnapshot(snapshot, NO_ENGINE, options(undefined))).findings.map((f) => f.criterion)).toEqual(['3.1.1'])
    expect((await checkSnapshot(snapshot, NO_ENGINE, options(undefined, false))).findings).toEqual([])
  })

  it('counts what the identifier decided as its own method in the coverage, not as a judgment', async () => {
    const snapshot = page('en', [paragraph('p', PORTUGUESE)], PORTUGUESE)
    const report = await checkSnapshot(snapshot, NO_ENGINE, options(undefined))
    const record = report.coverage.criteria?.find((c) => c.id === '3.1.1')
    expect(record?.status).toBe('failures')
    expect(record?.methods).toContainEqual({ kind: 'rule', id: 'rampa/language-id', ran: true, applicable: 1, failures: 1, review: 0, maturity: 'stable' })
    expect(record?.methods.find((m) => m.kind === 'judgment')).toMatchObject({ ran: false, applicable: 0, failures: 0 })
    expect(report.coverage.rules).toContain('3.1.1')
    expect(report.coverage.judged).not.toContain('3.1.1')
    expect(report.coverage.notChecked).not.toContain('3.1.1')
    expect(report.criteria.find((c) => c.criterion === '3.1.1')).toMatchObject({ decided: 1, decidedFailed: 1 })

    const passing = page('en', [paragraph('p', ENGLISH_LONG)], ENGLISH_LONG)
    const passed = await checkSnapshot(passing, NO_ENGINE, options(silent))
    const method = passed.coverage.criteria?.find((c) => c.id === '3.1.1')?.methods
    expect(method?.find((m) => m.id === 'rampa/language-id')).toMatchObject({ applicable: 1, failures: 0 })
    expect(passed.coverage.criteria?.find((c) => c.id === '3.1.1')?.status).toBe('no-failure-found')

    // With --no-llm the identifier judges nothing, so 3.1.1 stays not checked.
    const off = await checkSnapshot(snapshot, NO_ENGINE, options(undefined, false))
    expect(off.coverage.criteria?.find((c) => c.id === '3.1.1')?.methods.some((m) => m.id === 'rampa/language-id')).toBe(false)
  })

  it('passes a long, clear match without asking a model', async () => {
    const snapshot = page('en', [paragraph('p', ENGLISH_LONG)], ENGLISH_LONG)
    const report = await checkSnapshot(snapshot, NO_ENGINE, options(silent))
    expect(report.findings).toEqual([])
    expect(report.criteria.find((c) => c.criterion === '3.1.1')).toMatchObject({ judged: 1, passed: 1 })
  })

  it('drops a model fail that a confident reading contradicts', async () => {
    const snapshot = page('en', [paragraph('p', ENGLISH_SHORT)], ENGLISH_SHORT)
    const model = answering({ verdict: 'fail', detectedLanguage: 'nl', evidence: 'Our bakery opens at seven', confidence: 'high' })
    const report = await checkSnapshot(snapshot, NO_ENGINE, options(model))
    expect(model.calls).toBe(1)
    expect(report.findings).toEqual([])
    expect(report.discarded[0]?.reason).toBe('the language identifier reads the text as the declared language (en)')
  })

  it('drops a model fail when the declared language fits the words as well', async () => {
    const text = 'Paul put dire comment on tape'
    const snapshot = page('fr', [paragraph('p', text)], text)
    const model = answering({ verdict: 'fail', detectedLanguage: 'en', evidence: text, confidence: 'high' })
    const report = await checkSnapshot(snapshot, NO_ENGINE, options(model))
    expect(report.findings).toEqual([])
    expect(report.discarded[0]?.reason).toMatch(/reads as well in the declared language/)
  })

  it('leaves a short text to the model', async () => {
    const text = 'Fireworks over Paris'
    const snapshot = page('nl', [paragraph('p', text)], text)
    const model = answering({ verdict: 'fail', detectedLanguage: 'en', evidence: text, confidence: 'medium' })
    const report = await checkSnapshot(snapshot, NO_ENGINE, options(model))
    expect(report.findings.map((f) => [f.criterion, f.model])).toEqual([['3.1.1', 'test:answering']])
  })
})

describe('3.1.2 with the identifier', () => {
  beforeAll(loadLanguageIdentifier)

  it('nominates a passage with no lang that reads as another language, never one in the page language', () => {
    const quote = 'Aproveite as frutas da estação e o pão quente.'
    const snapshot = page('en', [paragraph('p.intro', ENGLISH_LONG), paragraph('p.quote', quote), paragraph('p.long', PORTUGUESE)])
    const candidates = languageOfParts.candidates(snapshot, NO_ENGINE)
    expect(candidates.map((c) => [c.ref, c.context.kind, c.context.declared])).toEqual([
      ['p.quote', 'unmarked', 'en'],
      ['p.long', 'unmarked', 'en'],
    ])
    // A short quote stays below the threshold; a long passage does not.
    expect(candidates.map((c) => languageOfParts.confidenceCap?.(c))).toEqual(['low', undefined])
    const [short, long] = candidates
    if (!short || !long) throw new Error('no candidate')
    const fail = { verdict: 'fail', detectedLanguage: 'pt', evidence: 'frutas da estação', exception: 'none', confidence: 'high' } as const
    expect(languageOfParts.verify(fail, short, snapshot)).toEqual({ ok: true })
    expect(languageOfParts.message(fail, short, 'en')).toBe('This passage has no lang attribute, so it is read as English (en), but it is in Portuguese (pt).')
    // A whole block gains a lang; a phrase inside a block goes in a span.
    expect(languageOfParts.patch?.({ ...fail, evidence: 'Todo sábado' }, long, snapshot)).toMatchObject({ attribute: 'lang', to: 'pt', after: '<p lang="pt">' })
    expect(languageOfParts.patch?.(fail, short, snapshot)?.after).toMatch(/^<span lang="pt">.*frutas da estação.*<\/span>$/)
  })

  it('finds a quote inside a sentence of the page language', () => {
    const sentence = 'The Dutch phrase "Hij ging met de kippen op stok" means that he went to bed early.'
    const candidates = languageOfParts.candidates(page('en', [paragraph('p', sentence)]), NO_ENGINE)
    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.context.text).toContain('ging met de kippen')
    expect(candidates[0]?.context.text).not.toContain('bed early')
    expect(candidates[0]?.context.around).toBe(sentence)
  })

  it('asks the model about every unmarked passage, which may name an exception', async () => {
    const snapshot = page('en', [paragraph('p.long', PORTUGUESE)])
    const model = answering({ verdict: 'pass', detectedLanguage: 'pt', evidence: 'Todo sábado', exception: 'proper_name', confidence: 'high' })
    const report = await checkSnapshot(snapshot, NO_ENGINE, options(model))
    expect(model.calls).toBe(1)
    expect(report.findings.filter((f) => f.criterion === '3.1.2')).toEqual([])
  })

  it('fails a long element marked with the wrong language without a model', async () => {
    const snapshot = page('en', [paragraph('p.wrong', PORTUGUESE, 'es')], ENGLISH_LONG)
    const report = await checkSnapshot(snapshot, NO_ENGINE, { ...options(silent), criteria: [languageOfParts] })
    expect(report.findings.map((f) => [f.criterion, f.ref, f.model])).toEqual([['3.1.2', 'p.wrong', undefined]])
    expect(report.findings[0]?.message).toContain('Marked as lang="es", but the text is in Portuguese (pt).')
  })
})
