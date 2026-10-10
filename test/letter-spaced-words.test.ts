import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { memoryCache } from '../src/core/cache.ts'
import { type CheckOptions, checkSnapshot } from '../src/core/check.ts'
import { runRuleChecks } from '../src/rules/index.ts'
import { inOwnCase, letterSpacedRuns, letterSpacedWordsRule } from '../src/rules/sequence.ts'
import { WORD_LANGUAGES, isListedWord, splitIntoWords, wordLanguageOf } from '../src/rules/words/index.ts'
import type { A11ySnapshot } from '../src/snapshot/schema.ts'
import { collectWeb, launchBrowser } from '../src/surfaces/web.ts'
import { node } from './helpers.ts'

const noEngine = { engine: { name: 'axe-core', version: 'test' }, rules: [] }

const words = (text: string, languages: readonly ('en' | 'pt' | 'es')[] = WORD_LANGUAGES) => letterSpacedRuns(text, languages).runs.map(inOwnCase)

describe('letter-spaced words (1.3.2, F32)', () => {
  it('joins spaced letters into a word of the language, a phrase included', () => {
    expect(words('W E L C O M E', ['en'])).toEqual(['WELCOME'])
    expect(words('T a b l e o f C o n t e n t s', ['en'])).toEqual(['Table of Contents'])
    expect(words('W E L C O M E T O O U R S I T E', ['en'])).toEqual(['WELCOME TO OUR SITE'])
    expect(words('O F E R T A S', ['pt'])).toEqual(['OFERTAS'])
    expect(words('N O T Í C I A S', ['pt'])).toEqual(['NOTÍCIAS'])
    expect(words('S O B R E N Ó S', ['pt'])).toEqual(['SOBRE NÓS'])
    expect(words('B I E N V E N I D O S', ['es'])).toEqual(['BIENVENIDOS'])
    // The language matters: "ofertas" is no English word.
    expect(words('O F E R T A S', ['en'])).toEqual([])
  })

  it('leaves indexes, acronyms, scales and runs of short words alone', () => {
    for (const text of [
      'A B C D E F G H I J K L M N O P Q R S T U V W X Y Z',
      'A B C D',
      'P Q R S',
      'N A S A',
      'U N E S C O',
      'A S A P',
      'R S V P',
      'H T M L',
      'I B G E',
      'Q W E R T Y',
      'E A D G B E',
      'x y z w',
      'a e o a',
      'Grades: A B C D F',
    ]) {
      expect(words(text), text).toEqual([])
    }
    // Three letters are never a run.
    expect(letterSpacedRuns('U S A and S O S', WORD_LANGUAGES).candidates).toBe(0)
  })

  it('keeps names and acronyms out of the word lists, and reads the language from its tag', () => {
    expect(isListedWord('welcome', 'en')).toBe(true)
    expect(isListedWord('notícias', 'pt')).toBe(true)
    expect(isListedWord('bienvenidos', 'es')).toBe(true)
    for (const name of ['nasa', 'unesco', 'asap', 'brasil', 'english']) expect(isListedWord(name, 'en'), name).toBe(false)
    expect(wordLanguageOf('pt-BR')).toBe('pt')
    expect(wordLanguageOf('es-419')).toBe('es')
    expect(wordLanguageOf('fr')).toBeUndefined()
    expect(splitIntoWords('abcd', 'en')).toBeUndefined()
  })

  it('fails the element whose own text spaces out a word, in its language, with a patch', () => {
    const snapshot = page([
      node({ ref: 'h1', role: 'heading', name: 'W E L C O M E', text: 'W E L C O M E', native: { tag: 'h1', html: '<h1>W E L C O M E</h1>' } }),
      node({ ref: 'section', role: 'region', lang: 'pt-BR', native: { tag: 'section' }, children: [node({ ref: 'section > h2', role: 'heading', text: 'O F E R T A S', native: { tag: 'h2' } })] }),
      node({ ref: 'p.fr', role: 'paragraph', lang: 'fr', text: 'B I E N V E N U E', native: { tag: 'p' } }),
    ])
    const stage = runRuleChecks(snapshot, noEngine, 'en', [letterSpacedWordsRule])
    expect(stage.findings.map((f) => [f.ref, f.subject, f.criterion])).toEqual([
      ['h1', 'W E L C O M E', '1.3.2'],
      ['section > h2', 'O F E R T A S', '1.3.2'],
    ])
    expect(stage.findings[0]?.message).toContain('“WELCOME”')
    expect(stage.findings[0]?.evidence).toBe('“W E L C O M E” → welcome (English)')
    expect(stage.findings[0]?.patch).toMatchObject({ kind: 'set-text', from: 'W E L C O M E', to: 'WELCOME' })
    expect(stage.findings[1]?.evidence).toContain('(Portuguese)')
    // French has no list: counted in the note, never failed.
    expect(stage.ran[0]?.note).toContain('1 run(s)')
    expect(stage.ran[0]?.applicable).toBe(2)
  })

  it('reads a page that declares no language against every list, at medium confidence', () => {
    const snapshot = page([node({ ref: 'p', role: 'paragraph', text: 'C O N T A T O', native: { tag: 'p' } })], null)
    const stage = runRuleChecks(snapshot, noEngine, 'pt-BR', [letterSpacedWordsRule])
    expect(stage.findings).toHaveLength(1)
    expect(stage.findings[0]?.evidence).toBe('“C O N T A T O” → contato (português); a página não declara idioma; lido como português')
    expect(letterSpacedWordsRule.run(snapshot, noEngine, { locale: 'en', index: new Map() }).hits[0]?.confidence).toBe('medium')
  })

  it('leaves code, text named by its author and hidden text alone, and says nothing on a page with no spaced letters', () => {
    const snapshot = page([
      node({ ref: 'code', role: 'generic', text: 'w o r d', native: { tag: 'code' } }),
      node({ ref: 'pre', role: 'generic', native: { tag: 'pre' }, children: [node({ ref: 'pre > span', text: 'm e n u', native: { tag: 'span' } })] }),
      node({ ref: 'h2', role: 'heading', name: 'Welcome', text: 'W E L C O M E', native: { tag: 'h2', attributes: { 'aria-label': 'Welcome' } } }),
      node({ ref: 'span', text: 'N E W S', states: ['aria-hidden'], native: { tag: 'span' } }),
    ])
    const stage = runRuleChecks(snapshot, noEngine, 'en', [letterSpacedWordsRule])
    expect(stage.findings).toEqual([])
    // The rule is narrow: with no spaced letters it tells nothing about 1.3.2.
    expect(stage.ran).toEqual([])
  })
})

function page(children: ReturnType<typeof node>[], lang: string | null = 'en'): A11ySnapshot {
  return {
    schemaVersion: 1,
    surface: 'web',
    target: 'test://letters',
    title: 'Letters',
    ...(lang ? { locale: lang } : {}),
    viewport: { width: 1280, height: 800, scale: 1 },
    collectedAt: '2026-10-09T00:00:00.000Z',
    collector: { name: 'test', version: '0' },
    root: node({ ref: 'html', role: 'document', ...(lang ? { lang } : {}), native: { tag: 'html' }, children: [node({ ref: 'html > body', native: { tag: 'body' }, children })] }),
  }
}

// Integration: needs Chrome or Edge (or Playwright's Chromium). Skipped when none is installed.
const browser = await launchBrowser().catch(() => undefined)
const fixture = (name: string) => pathToFileURL(resolve('test/fixtures/rules', name)).href
const options = (): CheckOptions => ({ criteria: [], llm: false, provider: undefined, runs: 1, cache: memoryCache(), offline: false, locale: 'en', minConfidence: 'low', concurrency: 1 })

afterAll(async () => {
  await browser?.close()
}, 60_000)

describe.skipIf(!browser)('letter-spaced words on pages', { timeout: 30_000 }, () => {
  const check = async (name: string) => {
    if (!browser) throw new Error('no browser')
    const { snapshot, engine } = await collectWeb(browser, fixture(name), { runAxe: true, locale: 'en' })
    return checkSnapshot(snapshot, engine, options())
  }
  const spaced = (report: Awaited<ReturnType<typeof check>>) =>
    report.findings.filter((f) => f.ruleId === 'rampa/letter-spaced-words').map((f) => f.subject)

  it('finds each spaced word once, in its language', async () => {
    const report = await check('sequence-fail.html')
    expect(spaced(report).sort()).toEqual(['B I E N V E N I D O S', 'O F E R T A S', 'S A L E', 'T a b l e o f C o n t e n t s', 'W E L C O M E'])
    expect(report.coverage.rules).toContain('1.3.2')
    expect(report.coverage.criteria?.find((c) => c.id === '1.3.2')?.status).toBe('failures')
  })

  it('reports nothing on the fixed page, and leaves 1.3.2 not checked there', async () => {
    const report = await check('sequence-pass.html')
    expect(spaced(report)).toEqual([])
    expect(report.coverage.criteria?.find((c) => c.id === '1.3.2')?.status).toBe('not-checked')
  })

  it('reports nothing on the near misses: indexes, acronyms, code, named and hidden text, French', async () => {
    const report = await check('sequence-controls.html')
    expect(spaced(report)).toEqual([])
    expect(report.coverage.criteria?.find((c) => c.id === '1.3.2')?.status).toBe('no-failure-found')
  })
})
