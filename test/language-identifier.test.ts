import { beforeAll, describe, expect, it } from 'vitest'
import { memoryCache } from '../src/core/cache.ts'
import { checkSnapshot } from '../src/core/check.ts'
import { agreement, fitsAsWell, identifierCode, loadLanguageIdentifier, readLanguage } from '../src/core/language-id.ts'
import type { EngineResults } from '../src/core/types.ts'
import { languageOfPage } from '../src/criteria/language-of-page.ts'
import { languageOfParts, listedLanguage } from '../src/criteria/language-of-parts.ts'
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

  // lbc.co.uk's ad frames in the sixth real-page study: <html lang="pt"> of a frame whose ad copy sits in its own
  // lang="pt" box, and whose English feedback panel is aria-hidden and placed beside the frame. A snapshot recorded
  // before the collector left such text out still holds it in langText.
  const adFrame = (panel: 'beside' | 'inside' | 'shown') => {
    const at = { beside: { x: 697, y: 1127 }, inside: { x: 400, y: 1380 }, shown: { x: 697, y: 1127 } }[panel]
    const english = (ref: string, text: string, i: number) =>
      node({ ref, text, states: panel === 'shown' ? [] : ['aria-hidden'], bounds: { x: at.x, y: at.y + 30 * i, width: 240, height: 28 } })
    const frameRoot = node({
      ref: 'iframe |> html',
      role: 'document',
      lang: 'pt',
      bounds: { x: 397, y: 1377, width: 300, height: 250 },
      native: { tag: 'html', html: '<html lang="pt">', langText: ENGLISH_LONG },
      children: [
        node({
          ref: 'iframe |> body',
          native: { tag: 'body' },
          children: [
            node({ ref: 'iframe |> #square', lang: 'pt', bounds: { x: 397, y: 1377, width: 300, height: 250 }, native: { tag: 'div', langText: PORTUGUESE }, text: PORTUGUESE }),
            node({ ref: 'iframe |> #abgc', states: panel === 'shown' ? [] : ['aria-hidden'], children: ENGLISH_LONG.split('. ').map((sentence, i) => english(`iframe |> #abgc span:nth-of-type(${i + 1})`, sentence, i)) }),
          ],
        }),
      ],
    })
    return page('en', [paragraph('p.intro', ENGLISH_LONG), node({ ref: 'iframe', native: { tag: 'iframe' }, bounds: { x: 397, y: 1377, width: 300, height: 250 }, children: [frameRoot] })])
  }

  it('leaves out text hidden from assistive technology and placed outside its frame, even from an older snapshot', async () => {
    const candidates = languageOfParts.candidates(adFrame('beside'), NO_ENGINE)
    expect(candidates.map((c) => c.ref)).toEqual(['iframe |> #square'])
    const report = await checkSnapshot(adFrame('beside'), NO_ENGINE, { ...options(silent), criteria: [languageOfParts] })
    expect(report.findings).toEqual([])
  })

  it('still reads that text when it sits inside the frame or is not hidden from assistive technology, and fails the frame', async () => {
    for (const panel of ['inside', 'shown'] as const) {
      const report = await checkSnapshot(adFrame(panel), NO_ENGINE, { ...options(silent), criteria: [languageOfParts] })
      expect(report.findings.map((f) => [f.ref, f.message.split('.')[0]]), panel).toEqual([['iframe |> html', 'Marked as lang="pt", but the text is in English (en)']])
    }
  })

  it('fails a long element marked with the wrong language without a model', async () => {
    const snapshot = page('en', [paragraph('p.wrong', PORTUGUESE, 'es')], ENGLISH_LONG)
    const report = await checkSnapshot(snapshot, NO_ENGINE, { ...options(silent), criteria: [languageOfParts] })
    expect(report.findings.map((f) => [f.criterion, f.ref, f.model])).toEqual([['3.1.2', 'p.wrong', undefined]])
    expect(report.findings[0]?.message).toContain('Marked as lang="es", but the text is in Portuguese (pt).')
  })
})

describe('3.1.2 regions and phrases', () => {
  beforeAll(loadLanguageIdentifier)

  // Texts written for these tests: an English consent banner of divs, a short heading, a link and buttons on a
  // Portuguese page, none long enough on its own for the identifier.
  const BANNER_TEXT = 'This site stores small files on your device to remember your settings, to count visits and to show you offers that match what you looked at before.'
  const banner = () =>
    node({
      ref: 'div.wrap',
      native: { tag: 'div' },
      children: [
        node({
          ref: '#banner',
          role: 'dialog',
          name: 'Your privacy choices',
          native: { tag: 'div', html: '<div id="banner" role="dialog" aria-labelledby="banner-title">' },
          children: [
            node({ ref: '#banner-title', role: 'heading', text: 'Your privacy choices', native: { tag: 'h3' } }),
            node({ ref: '#banner-text', text: BANNER_TEXT, native: { tag: 'small' } }),
            node({ ref: '#banner a', role: 'link', name: 'Read our policy', text: 'Read our policy', native: { tag: 'a' } }),
            node({ ref: '#decline', role: 'button', name: 'Decline', text: 'Decline', native: { tag: 'button' } }),
            node({ ref: '#allow', role: 'button', name: 'Allow', text: 'Allow', native: { tag: 'button' } }),
          ],
        }),
      ],
    })

  it('nominates a container whose whole text reads as another language, on the element its lang belongs on', () => {
    const snapshot = page('pt-BR', [paragraph('p', PORTUGUESE), banner()])
    const candidates = languageOfParts.candidates(snapshot, NO_ENGINE)
    expect(candidates.map((c) => [c.ref, c.context.kind])).toEqual([['#banner', 'region']])
    const [region] = candidates
    if (!region) throw new Error('no candidate')
    expect(region.context.text).toContain('Your privacy choices')
    expect(region.context.text).toContain('Allow')
    // Judged like an unmarked passage, and below the threshold even when the identifier reads it clearly.
    expect(region.context.reading?.clear).toBe(true)
    expect(languageOfParts.confidenceCap?.(region)).toBe('low')
    expect(languageOfParts.prompt(region, snapshot).user).toContain('The passage:')
    const fail = { verdict: 'fail', detectedLanguage: 'en', evidence: 'stores small files on your device', exception: 'none', confidence: 'high' } as const
    expect(languageOfParts.verify(fail, region, snapshot)).toEqual({ ok: true })
    expect(languageOfParts.patch?.(fail, region, snapshot)).toMatchObject({
      ref: '#banner',
      attribute: 'lang',
      to: 'en',
      after: '<div id="banner" role="dialog" aria-labelledby="banner-title" lang="en">',
    })
  })

  it('nominates a region the identifier reads with confidence but not clearly, below the threshold too', () => {
    const cards = node({
      ref: 'div.cards',
      native: { tag: 'div' },
      children: ['Summer Linen Shirt', 'Classic Denim Jacket'].flatMap((name, i) => [
        node({ ref: `a.card${i}`, role: 'link', text: name, native: { tag: 'a' } }),
        node({ ref: `span.card${i}`, text: name, native: { tag: 'span' } }),
      ]),
    })
    const candidates = languageOfParts.candidates(page('pt-BR', [paragraph('p', PORTUGUESE), cards]), NO_ENGINE)
    expect(candidates.map((c) => [c.ref, c.context.kind, languageOfParts.confidenceCap?.(c)])).toEqual([['div.cards', 'region', 'low']])
  })

  it('leaves a region to the passages that hold most of it, and the page language to 3.1.1', () => {
    const note = node({
      ref: 'div.note',
      native: { tag: 'div' },
      children: [paragraph('div.note > p', ENGLISH_LONG), node({ ref: 'div.note > a', role: 'link', text: 'More', native: { tag: 'a' } })],
    })
    const candidates = languageOfParts.candidates(page('pt-BR', [paragraph('p', PORTUGUESE), note]), NO_ENGINE)
    expect(candidates.map((c) => [c.ref, c.context.kind])).toEqual([['div.note > p', 'unmarked']])
    // A page whose own text is all English under lang="pt-BR" declares the wrong language: no region, no phrase.
    const english = page('pt-BR', [banner(), paragraph('p', ENGLISH_LONG)])
    expect(languageOfParts.candidates(english, NO_ENGINE).map((c) => c.context.kind)).toEqual(['unmarked'])
  })

  it('nominates a short name or control text of two words or more in another language, once per text, below the threshold', () => {
    const button = (ref: string, label: string) =>
      node({ ref, role: 'button', name: label, native: { tag: 'button', attributes: { 'aria-label': label }, html: `<button aria-label="${label}">` } })
    const snapshot = page('pt-BR', [
      paragraph('p', PORTUGUESE),
      node({
        ref: 'section.carousel',
        role: 'region',
        name: 'Destaques',
        native: { tag: 'section', attributes: { 'aria-label': 'Destaques' } },
        // One word is left alone: "Close" is English, but single words are where the exceptions most often apply.
        children: [button('#next', 'Next slide'), button('#next2', 'Next slide'), button('#menu', 'Menu'), button('#close', 'Close')],
      }),
      // A plain div may not be named, so a screen reader does not read its aria-label.
      node({ ref: 'div.box', native: { tag: 'div', attributes: { 'aria-label': 'Close this box' } } }),
      node({ ref: 'li', native: { tag: 'li' }, children: [node({ ref: 'li > a', role: 'link', text: 'Skip to content', native: { tag: 'a' } })] }),
      node({ ref: 'a.brand', role: 'link', text: 'Instagram', native: { tag: 'a' } }),
      node({ ref: 'a.contest', role: 'link', text: 'Concursos', native: { tag: 'a' } }),
      node({
        ref: 'p.inline',
        role: 'paragraph',
        native: { tag: 'p' },
        children: [node({ ref: 'p.inline > span', text: 'Para saber tudo, consulte a página', native: { tag: 'span' } }), node({ ref: 'p.inline > a', role: 'link', text: 'Read on', native: { tag: 'a' } })],
      }),
    ])
    const candidates = languageOfParts.candidates(snapshot, NO_ENGINE)
    expect(candidates.map((c) => [c.ref, c.context.kind, c.context.text, c.context.source])).toEqual([
      ['#next', 'phrase', 'Next slide', 'the aria-label of a button'],
      ['li > a', 'phrase', 'Skip to content', 'the text of a link'],
    ])
    const [next] = candidates
    if (!next) throw new Error('no candidate')
    expect(languageOfParts.confidenceCap?.(next)).toBe('low')
    expect(languageOfParts.prompt(next, snapshot).user).toContain('Where the text comes from: the aria-label of a button')
    // The verdict follows from the language and the exception, and the whole text is a quote however short.
    const answer = { verdict: 'pass', detectedLanguage: 'en', evidence: 'Next slide', exception: 'none', confidence: 'high' } as const
    const settled = languageOfParts.settle?.(answer, next)
    if (!settled) throw new Error('not settled')
    expect(settled.verdict).toBe('fail')
    expect(languageOfParts.verify(settled, next, snapshot)).toEqual({ ok: true })
    expect(languageOfParts.message(settled, next, 'en')).toBe(
      'The aria-label "Next slide" has no lang attribute, so it is read as Brazilian Portuguese (pt-BR), but it is in English (en).',
    )
    expect(languageOfParts.patch?.(settled, next, snapshot)).toMatchObject({ attribute: 'lang', to: 'en', after: '<button aria-label="Next slide" lang="en">' })
    // A loanword the model names as vernacular is no finding.
    expect(languageOfParts.settle?.({ ...answer, exception: 'vernacular' }, next)?.verdict).toBe('pass')
  })

  it('reads no phrase inside a region, and none on a page whose language has no word list', () => {
    const inside = languageOfParts.candidates(page('pt-BR', [paragraph('p', PORTUGUESE), banner()]), NO_ENGINE)
    expect(inside.filter((c) => c.context.kind === 'phrase')).toEqual([])
    const dutch = page('nl', [node({ ref: '#next', role: 'button', name: 'Next slide', native: { tag: 'button', attributes: { 'aria-label': 'Next slide' } } })])
    expect(languageOfParts.candidates(dutch, NO_ENGINE)).toEqual([])
  })

  it('judges a region with the model and reports it below the threshold', async () => {
    const snapshot = page('pt-BR', [paragraph('p', PORTUGUESE), banner()])
    const model = answering({ verdict: 'fail', detectedLanguage: 'en', evidence: 'stores small files on your device', exception: 'none', confidence: 'high' })
    const report = await checkSnapshot(snapshot, NO_ENGINE, { ...options(model), criteria: [languageOfParts] })
    expect(model.calls).toBe(1)
    expect(report.findings.map((f) => [f.ref, f.confidence])).toEqual([['#banner', 'low']])
    const shown = await checkSnapshot(snapshot, NO_ENGINE, { ...options(model), criteria: [languageOfParts], minConfidence: 'medium' as const })
    expect(shown.findings).toEqual([])
    expect(shown.belowThreshold.map((f) => f.ref)).toEqual(['#banner'])
  })

  it('judges a phrase with the model and reports it below the threshold', async () => {
    const close = node({ ref: '#close', role: 'button', name: 'Close window', native: { tag: 'button', attributes: { 'aria-label': 'Close window' } } })
    const snapshot = page('pt-BR', [paragraph('p', PORTUGUESE), close])
    const model = answering({ verdict: 'fail', detectedLanguage: 'en', evidence: 'Close window', exception: 'none', confidence: 'high' })
    const report = await checkSnapshot(snapshot, NO_ENGINE, { ...options(model), criteria: [languageOfParts] })
    expect(model.calls).toBe(1)
    expect(report.findings.map((f) => [f.ref, f.confidence])).toEqual([['#close', 'low']])
  })
})

describe('word lists for short texts', () => {
  it('names another language only when the words leave no doubt', () => {
    expect(listedLanguage('Next slide', 'pt')).toBe('en')
    expect(listedLanguage('Skip to content', 'pt')).toBe('en')
    // A word both lists hold, a name no list holds, too few listed words, Portuguese and Spanish cognates.
    expect(listedLanguage('Menu', 'pt')).toBeUndefined()
    expect(listedLanguage('Instagram', 'pt')).toBeUndefined()
    expect(listedLanguage('Dot 1 of 3', 'pt')).toBeUndefined()
    expect(listedLanguage('Concursos', 'pt')).toBeUndefined()
    expect(listedLanguage('Concursos', 'en')).toBe('es')
    expect(listedLanguage('Fechar janela', 'en')).toBe('pt')
    expect(listedLanguage('Veja mais', 'pt')).toBeUndefined()
  })
})
