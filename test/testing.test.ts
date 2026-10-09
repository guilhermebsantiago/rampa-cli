import { describe, expect, it } from 'vitest'
import type { CheckPageOptions } from '../src/api/page.ts'
import { memoryCache } from '../src/core/cache.ts'
import { type CheckOptions, checkSnapshot } from '../src/core/check.ts'
import type { EngineResults, Report } from '../src/core/types.ts'
import { languageOfParts } from '../src/criteria/language-of-parts.ts'
import { createFixtures } from '../src/testing/fixtures.ts'
import { type AssertOptions, assess, formatFindings, summarize } from '../src/testing/format.ts'
import { type ToPassRampaOptions, assertRampa, createMatchers } from '../src/testing/matchers.ts'
import { passingEngine, scriptedProvider, travelSnapshot } from './helpers.ts'

declare module 'vitest' {
  interface Matchers<R extends void | Promise<void> = void | Promise<void>, T = unknown> {
    toPassRampa(options?: ToPassRampaOptions): Promise<void>
    toHaveNoRampaFindings(options?: AssertOptions): void
  }
}

const dutchFail = { verdict: 'fail', detectedLanguage: 'nl', evidence: 'Het weer is vandaag mooi', exception: 'none', confidence: 'high' }
const portuguesePass = { verdict: 'pass', detectedLanguage: 'pt', evidence: 'Bem-vindo à feira', exception: 'none', confidence: 'high' }
const spanishPass = { verdict: 'pass', detectedLanguage: 'es', evidence: 'Het weer is vandaag mooi', exception: 'none', confidence: 'high' }

/** The travel page's engine results plus a logo without alternative text. */
function engineWithViolation(): EngineResults {
  const engine = passingEngine()
  engine.rules.push({
    ruleId: 'image-alt',
    outcome: 'violation',
    criteria: ['1.1.1'],
    help: 'Images must have alternative text',
    helpUrl: 'https://dequeuniversity.com/rules/axe/4.14/image-alt',
    nodes: [{ ref: 'header > img', target: '["header > img"]', html: '<img src="logo.svg">' }],
  })
  return engine
}

function report(options: { answers?: unknown[]; engine?: EngineResults; extra?: Partial<CheckOptions> } = {}): Promise<Report> {
  return checkSnapshot(travelSnapshot(), options.engine ?? passingEngine(), {
    criteria: [languageOfParts],
    llm: true,
    provider: scriptedProvider({ blockquote: options.answers ?? [dutchFail], 'p.sign': [portuguesePass] }),
    runs: 1,
    cache: memoryCache(),
    offline: false,
    locale: 'en',
    minConfidence: 'medium',
    concurrency: 1,
    ...options.extra,
  })
}

const failing = () => report({ engine: engineWithViolation() })
const passing = () => report({ answers: [spanishPass] })
/** Fingerprints are hashes; the text around them is what these tests read. */
const readable = (text: string) => text.replace(/[0-9a-f]{12}/g, '<id>')

describe('formatFindings', () => {
  it('lists each failing finding with its criterion, element, message, evidence and patch, then the coverage', async () => {
    expect(readable(formatFindings(await failing()))).toBe(
      [
        'Rampa: 2 failures in test://travel',
        '',
        '1. WCAG 1.1.1 (A) — Non-text Content',
        '   Element:   header > img',
        '   Message:   Images must have alternative text',
        '   HTML:      <img src="logo.svg">',
        '   Rule:      axe-core image-alt · https://dequeuniversity.com/rules/axe/4.14/image-alt',
        '   Waiver id: <id>',
        '',
        '2. WCAG 3.1.2 (AA) — Language of Parts',
        '   Element:   blockquote',
        '   Message:   Marked as lang="es", but the text is in Dutch (nl).',
        '   Evidence:  "Het weer is vandaag mooi"',
        '   Patch:     - <blockquote lang="es">',
        '              + <blockquote lang="nl">',
        '   Judged:    test:scripted · confidence high · 1/1 runs · evidence verified',
        '   Waiver id: <id>',
        '',
        'Coverage: axe-core checked 1.1.1, 3.1.2; judged with verified evidence: 3.1.2; not checked automatically: 48 of 50 WCAG 2.1 A/AA criteria.',
        'This report does not declare the page accessible.',
        '',
        'To dismiss a finding on purpose, add its waiver id to .rampa/waivers.json or to the waivers option.',
      ].join('\n'),
    )
  })

  it('speaks the report language', async () => {
    const text = formatFindings({ ...(await failing()), locale: 'pt-BR' })
    expect(text).toContain('Rampa: 2 falhas em test://travel')
    expect(text).toContain('   Elemento:  blockquote')
    expect(text).toContain('confiança alta · 1/1 rodadas · evidência verificada')
    expect(text).toContain('Este relatório não declara a página acessível.')
  })

  it('shows the scope of a component check', async () => {
    const text = formatFindings({ ...(await passing()), scope: { include: ['#cart'], exclude: ['.ad'] } })
    expect(text.split('\n')[0]).toBe('Rampa: no failures in test://travel (scope: #cart, excluding .ad)')
  })
})

describe('assess', () => {
  it('fails on confirmed findings, and on findings below the threshold only with failOn any', async () => {
    const unsure = await report({ answers: [{ ...dutchFail, confidence: 'low' }] })
    expect(unsure.findings).toEqual([])
    expect(assess([unsure]).pass).toBe(true)
    const any = assess([unsure], { failOn: 'any' })
    expect(any.pass).toBe(false)
    expect(formatFindings(unsure, { failOn: 'any' })).toContain('1. WCAG 3.1.2 (AA) — Language of Parts (below the confidence threshold)')
  })

  it('fails when the model broke on every candidate of a criterion, as the CLI exits 2', async () => {
    const broken = await report({ extra: { provider: { id: 'test:down', judge: async () => Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:11434')) } } })
    const assessment = assess([broken])
    expect(assessment.pass).toBe(false)
    expect(assessment.problems).toEqual(['the model failed on every candidate of WCAG 3.1.2: connect ECONNREFUSED 127.0.0.1:11434'])
  })

  it('with requireJudgment, fails when the judgment did not run on every candidate', async () => {
    const off = await report({ extra: { llm: false } })
    const noModel = await report({ extra: { provider: undefined } })
    const offline = await report({ extra: { provider: undefined, offline: true } })
    expect(assess([off]).pass).toBe(true)
    expect(assess([off], { requireJudgment: true }).problems).toEqual(['the judgment layer was off (noLlm), so only axe-core ran'])
    expect(assess([noModel], { requireJudgment: true }).problems).toEqual(['no model was configured, so only axe-core ran; pass model, set RAMPA_MODEL or start Ollama'])
    expect(assess([offline], { requireJudgment: true }).problems).toEqual(['2 candidate(s) had no cached judgment (offline)'])
    expect(assess([await passing()], { requireJudgment: true }).pass).toBe(true)
  })
})

describe('matchers', () => {
  const checked: Array<{ page: unknown; options: CheckPageOptions | undefined }> = []
  const matchers = createMatchers(async (page: { evaluate(): void; result: Report }, options?: CheckPageOptions) => {
    checked.push({ page, options })
    return page.result
  })
  expect.extend(matchers)

  it('pass on a clean report and fail with the findings listed', async () => {
    expect(await passing()).toHaveNoRampaFindings()
    const bad = await failing()
    expect(() => expect(bad).toHaveNoRampaFindings()).toThrow(/^expect\(report\)\.toHaveNoRampaFindings\(\)\n\nRampa: 2 failures in test:\/\/travel/)
    expect(bad).not.toHaveNoRampaFindings()
    expect(() => expect(bad).toHaveNoRampaFindings()).toThrow('Evidence:  "Het weer is vandaag mooi"')
  })

  it('refuse what is not a report, such as a report not awaited, and say so when a negated assertion finds nothing', async () => {
    expect(() => expect(passing()).not.toHaveNoRampaFindings()).toThrow(TypeError)
    expect(() => expect(undefined).toHaveNoRampaFindings()).toThrow('toHaveNoRampaFindings expects a Rampa report or an array of reports; to check a page, use toPassRampa.')
    const clean = await passing()
    expect(() => expect(clean).not.toHaveNoRampaFindings()).toThrow('Expected Rampa to find failures, and it found none.')
  })

  it('toPassRampa checks a page with its options, or assesses reports as they are', async () => {
    const page = { evaluate() {}, result: await passing() }
    await expect(page).toPassRampa({ include: '#cart', noLlm: true })
    expect(checked.at(-1)).toEqual({ page, options: { include: '#cart', noLlm: true } })
    await expect([await passing(), await failing()]).not.toPassRampa()
    await expect(expect({ evaluate() {}, result: await failing() }).toPassRampa()).rejects.toThrow('expect(page).toPassRampa()')
    await expect(expect('https://example.com').toPassRampa()).rejects.toThrow('toPassRampa expects a page or a Rampa report.')
  })
})

describe('assertRampa', () => {
  const thrown = (run: () => void): Error | undefined => {
    try {
      run()
      return undefined
    } catch (error) {
      return error as Error
    }
  }

  it('throws the readable findings for runners without expect.extend', async () => {
    const good = await passing()
    expect(thrown(() => assertRampa(good))).toBeUndefined()
    const bad = await failing()
    const error = thrown(() => assertRampa(bad))
    expect(error?.name).toBe('RampaAssertionError')
    expect(error?.message.split('\n')[0]).toBe('Rampa: 2 failures in test://travel')
    expect(thrown(() => assertRampa([] as never))).toBeInstanceOf(TypeError)
  })
})

describe('fixture', () => {
  it('checks the test page with the project defaults under the options of each call, and attaches every report', async () => {
    const calls: Array<{ page: string; options: CheckPageOptions | undefined }> = []
    const result = await failing()
    const fixtures = createFixtures(async (page: string, options?: CheckPageOptions) => {
      calls.push({ page, options })
      return result
    })
    const attachments: Array<{ name: string; contentType: string; body: string }> = []
    const testInfo = { annotations: [] as Array<{ type: string; description?: string }>, attach: async (name: string, options: { body: string; contentType: string }) => void attachments.push({ name, ...options }) }
    expect(fixtures.rampaOptions).toEqual([{}, { option: true }])

    await fixtures.rampa(
      { page: 'test page', rampaOptions: { model: 'ollama:gemma4:12b', minConfidence: 'high' } },
      async (rampa) => {
        await rampa.check({ include: '#cart', minConfidence: 'low' })
        await rampa.check({ page: 'popup' })
      },
      testInfo,
    )
    expect(calls).toEqual([
      { page: 'test page', options: { model: 'ollama:gemma4:12b', minConfidence: 'low', include: '#cart' } },
      { page: 'popup', options: { model: 'ollama:gemma4:12b', minConfidence: 'high' } },
    ])
    expect(attachments.map((a) => [a.name, a.contentType])).toEqual([
      ['rampa-report.json', 'application/json'],
      ['rampa-report-2.json', 'application/json'],
    ])
    expect(JSON.parse(attachments[0]?.body ?? '')).toEqual(JSON.parse(JSON.stringify(result)))
    expect(testInfo.annotations).toEqual([
      { type: 'rampa', description: summarize(result) },
      { type: 'rampa', description: summarize(result) },
    ])
    expect(summarize(result)).toBe('2 findings · judged: 3.1.2 · not checked automatically: 48 of 50 WCAG 2.1 A/AA criteria · model test:scripted')
  })

  it('reads the fixtures it needs from a destructured first parameter, as Playwright requires', () => {
    const fixtures = createFixtures(async () => passing())
    expect(fixtures.rampa.toString()).toMatch(/^async \(\{ page, rampaOptions \}, use, testInfo\) =>/)
  })
})
