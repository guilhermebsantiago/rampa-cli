import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { memoryCache } from '../src/core/cache.ts'
import { checkSnapshot, engineFindings } from '../src/core/check.ts'
import type { EngineResults, Finding } from '../src/core/types.ts'
import { CRITERIA, resolveCriteria } from '../src/criteria/index.ts'
import type { ModelProvider } from '../src/providers/types.ts'
import type { A11ySnapshot } from '../src/snapshot/schema.ts'
import { collectWeb, launchBrowser } from '../src/surfaces/web.ts'
import { node } from './helpers.ts'

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const PORTUGUESE = 'Bem-vindo à nossa loja. Aproveite as frutas da estação e volte sempre.'
const DUTCH = 'Welkom in Amsterdam! Het weer is vandaag mooi en zonnig.'

/** One page with a candidate for every criterion: a vague title, a wrong alt, a vague link, heading and label, two wrong langs. */
function page(): A11ySnapshot {
  return {
    schemaVersion: 1,
    surface: 'web',
    target: 'test://store',
    title: 'Untitled document - Corner Store',
    locale: 'en',
    viewport: { width: 1280, height: 800, scale: 1 },
    collectedAt: '2026-10-08T00:00:00.000Z',
    collector: { name: 'test', version: '0' },
    root: node({
      ref: 'html',
      role: 'document',
      lang: 'en',
      native: { tag: 'html', html: '<html lang="en">', langText: PORTUGUESE },
      children: [
        node({
          ref: 'body',
          native: { tag: 'body' },
          children: [
            node({
              ref: 'img.mug',
              role: 'img',
              name: 'Ceramic coffee mug',
              image: PNG,
              native: { tag: 'img', attributes: { src: 'umbrella.svg', alt: 'Ceramic coffee mug' }, html: '<img src="umbrella.svg" alt="Ceramic coffee mug">' },
            }),
            node({
              ref: 'p.more',
              role: 'paragraph',
              native: { tag: 'p' },
              children: [
                node({
                  ref: 'a.more',
                  role: 'link',
                  name: 'Read more about shipping',
                  text: 'Read more about shipping',
                  native: { tag: 'a', attributes: { href: '/shipping' }, html: '<a href="/shipping">Read more about shipping</a>' },
                }),
              ],
            }),
            node({ ref: 'h2', role: 'heading', name: 'Section 2 of the page', native: { tag: 'h2' } }),
            node({ ref: 'p.reviews', role: 'paragraph', text: 'Customers love the mug and the umbrella.', native: { tag: 'p' } }),
            node({
              ref: 'blockquote',
              role: 'blockquote',
              lang: 'es',
              native: { tag: 'blockquote', html: `<blockquote lang="es"><p>${DUTCH}</p></blockquote>`, langText: DUTCH },
              children: [node({ ref: 'blockquote > p', role: 'paragraph', text: DUTCH })],
            }),
          ],
        }),
      ],
    }),
  }
}

/**
 * Two models that agree on every verdict but word and quote differently: the second quotes a
 * shorter part of each text (still verified) and names other problems and fixes.
 */
const ANSWERS: Record<string, [unknown, unknown]> = {
  '1.1.1': [
    { verdict: 'fail', evidence: 'Ceramic coffee mug', problem: 'wrong_content', imageShows: 'An umbrella', suggestedAlt: 'Pink umbrella', confidence: 'high' },
    { verdict: 'fail', evidence: 'ceramic  coffee mug', problem: 'missing_information', imageShows: 'A rain umbrella', suggestedAlt: 'Umbrella in the rain', confidence: 'high' },
  ],
  '2.4.2': [
    { verdict: 'fail', evidence: 'Untitled document - Corner Store', problem: 'generic', suggestedTitle: 'Shop mugs and umbrellas', confidence: 'high' },
    { verdict: 'fail', evidence: 'Untitled document - Corner', problem: 'mismatch', suggestedTitle: 'Corner Store: new arrivals', confidence: 'high' },
  ],
  '2.4.4': [
    { verdict: 'fail', evidence: 'Read more about shipping', problem: 'generic', suggestedText: 'Shipping rates', confidence: 'high' },
    { verdict: 'fail', evidence: 'more about shipping', problem: 'ambiguous', suggestedText: 'How shipping works', confidence: 'high' },
  ],
  '2.4.6': [
    { named: '', verdict: 'fail', evidence: 'Section 2 of the page', problem: 'generic', suggestedText: 'Customer reviews', confidence: 'high' },
    { named: 'a section', verdict: 'fail', evidence: 'Section 2 of the', problem: 'mismatch', suggestedText: 'What customers say', confidence: 'high' },
  ],
  '3.1.1': [
    { verdict: 'fail', detectedLanguage: 'pt', evidence: 'Bem-vindo à nossa loja', confidence: 'high' },
    { verdict: 'fail', detectedLanguage: 'pt-BR', evidence: 'frutas da estação', confidence: 'high' },
  ],
  '3.1.2': [
    { verdict: 'fail', detectedLanguage: 'nl', evidence: 'Het weer is vandaag mooi', exception: 'none', confidence: 'high' },
    { verdict: 'fail', detectedLanguage: 'nl', evidence: 'Welkom in Amsterdam!', exception: 'none', confidence: 'high' },
  ],
}

function wordedProvider(variant: 0 | 1): ModelProvider {
  return {
    id: 'test:worded',
    async judge<T>(request: { schemaName: string; schema: { parse(value: unknown): T } }) {
      const id = request.schemaName.replace(/^wcag_/, '').replace(/_judgment$/, '').replaceAll('_', '.')
      const answer = ANSWERS[id]?.[variant]
      if (!answer) throw new Error(`no answer for ${id}`)
      return { output: request.schema.parse(answer), inputTokens: 1, outputTokens: 1, latencyMs: 0, modelId: 'worded' }
    },
  }
}

const noEngine: EngineResults = { engine: { name: 'axe-core', version: 'test' }, rules: [] }

async function judged(snapshot: A11ySnapshot, engine: EngineResults, variant: 0 | 1) {
  return checkSnapshot(snapshot, engine, {
    criteria: [...CRITERIA.values()],
    llm: true,
    provider: wordedProvider(variant),
    runs: 1,
    cache: memoryCache(),
    offline: false,
    locale: 'en',
    minConfidence: 'low',
    concurrency: 1,
  })
}

const byPlace = (findings: Finding[]) =>
  Object.fromEntries(findings.filter((f) => f.source === 'judgment').map((f) => [`${f.criterion} ${f.ref}`, f.fingerprint]))

describe('fingerprints', () => {
  it('do not depend on how the model words or quotes a verified claim', async () => {
    const first = await judged(page(), noEngine, 0)
    const second = await judged(page(), noEngine, 1)
    // Every criterion produced a verified finding in both runs, with different words.
    expect(first.discarded).toEqual([])
    expect(second.discarded).toEqual([])
    expect(first.findings.map((f) => f.criterion)).toEqual(['1.1.1', '2.4.2', '2.4.4', '2.4.6', '3.1.1', '3.1.2'])
    expect(first.findings.map((f) => f.message)).not.toEqual(second.findings.map((f) => f.message))
    expect(first.findings.map((f) => f.evidence)).not.toEqual(second.findings.map((f) => f.evidence))
    expect(byPlace(second.findings)).toEqual(byPlace(first.findings))
  })

  it('keep the values waivers already hold when the model quoted the whole text', async () => {
    const report = await judged(page(), noEngine, 0)
    const alt = report.findings.find((f) => f.criterion === '1.1.1')
    // sha256('1.1.1|img.mug|ceramic coffee mug'), as before the fingerprint stopped reading the evidence.
    expect(alt?.fingerprint).toBe('621050300169')
    expect(alt?.subject).toBe('Ceramic coffee mug')
  })

  it('change when the judged text changes', async () => {
    const changed = page()
    const img = changed.root.children[0]?.children[0]
    if (img) img.name = 'Blue ceramic coffee mug'
    const before = byPlace((await judged(page(), noEngine, 0)).findings)
    const after = byPlace((await judged(changed, noEngine, 0)).findings)
    expect(after['1.1.1 img.mug']).not.toBe(before['1.1.1 img.mug'])
    expect(after['2.4.4 a.more']).toBe(before['2.4.4 a.more'])
  })

  it('of engine findings ignore the localized rule text', () => {
    const engine = (help: string): EngineResults => ({
      engine: { name: 'axe-core', version: 'test' },
      rules: [
        {
          ruleId: 'image-alt',
          outcome: 'violation',
          criteria: ['1.1.1'],
          help,
          nodes: [{ ref: 'html > body > img', target: '["img"]', html: '<img src="logo.svg">' }],
        },
      ],
    })
    const en = engineFindings(engine('Images must have alternative text'))
    const pt = engineFindings(engine('Imagens devem ter texto alternativo'))
    expect(pt.map((f) => f.fingerprint)).toEqual(en.map((f) => f.fingerprint))
  })

  it('are unique per element on a page', async () => {
    const report = await judged(page(), noEngine, 0)
    const all = report.findings.map((f) => f.fingerprint)
    expect(new Set(all).size).toBe(all.length)
  })
})

// Integration: the same page collected twice, in two report languages, gives the same fingerprints.
const browser = await launchBrowser().catch(() => undefined)
afterAll(async () => browser?.close())

describe.skipIf(!browser)('fingerprints of a real page', { timeout: 60_000 }, () => {
  it('are the same across collections, report languages and model wording', async () => {
    if (!browser) return
    const url = pathToFileURL(resolve('examples/store/before.html')).href
    const english = await collectWeb(browser, url, { runAxe: true, locale: 'en', captureImages: true })
    const portuguese = await collectWeb(browser, url, { runAxe: true, locale: 'pt-BR', captureImages: true })

    const engineOf = (findings: Finding[]) => findings.map((f) => `${f.ruleId} ${f.ref} ${f.fingerprint}`).sort()
    expect(engineFindings(english.engine).length).toBeGreaterThan(0)
    expect(engineOf(engineFindings(portuguese.engine))).toEqual(engineOf(engineFindings(english.engine)))

    // Answers that fit this page do not matter here: only what the model is asked about does.
    const criteria = resolveCriteria(['2.4.4', '3.1.2'])
    const candidates = (snapshot: A11ySnapshot, engine: EngineResults) =>
      criteria.flatMap((criterion) => criterion.candidates(snapshot, engine).map((c) => `${criterion.id} ${c.ref} ${criterion.subject?.(c)}`))
    expect(candidates(portuguese.snapshot, portuguese.engine)).toEqual(candidates(english.snapshot, english.engine))
  })
})
