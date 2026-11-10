import { describe, expect, it } from 'vitest'
import { memoryCache } from '../src/core/cache.ts'
import { checkSnapshot } from '../src/core/check.ts'
import { CLAIM_TECHNIQUES, TECHNIQUES } from '../src/core/techniques.ts'
import type { AnyCriterion, EngineResults, Report } from '../src/core/types.ts'
import { HEADING_PROBLEMS, headingsAndLabels } from '../src/criteria/headings-and-labels.ts'
import { identifyInputPurpose } from '../src/criteria/identify-input-purpose.ts'
import { CRITERIA, DEFAULT_CRITERIA } from '../src/criteria/index.ts'
import { LABEL_PROBLEMS, labelsOrInstructions } from '../src/criteria/labels-or-instructions.ts'
import { languageOfPage } from '../src/criteria/language-of-page.ts'
import { languageOfParts } from '../src/criteria/language-of-parts.ts'
import { LINK_PROBLEMS, linkPurpose } from '../src/criteria/link-purpose.ts'
import { ALT_CLAIMS, nonTextContent } from '../src/criteria/non-text-content.ts'
import { TITLE_PROBLEMS, pageTitled } from '../src/criteria/page-titled.ts'
import type { Locale } from '../src/i18n.ts'
import { checkResult, checkText } from '../src/mcp/format.ts'
import { paint } from '../src/report/color.ts'
import { readingText } from '../src/report/common.ts'
import { renderHtml } from '../src/report/html.ts'
import { renderMarkdown } from '../src/report/markdown.ts'
import { renderReport } from '../src/report/pretty.ts'
import { toSarif } from '../src/report/sarif.ts'
import type { JudgeRequest, ModelProvider } from '../src/providers/types.ts'
import type { A11ySnapshot } from '../src/snapshot/schema.ts'
import { node } from './helpers.ts'

/** What no citation line may say: it names a reading, never a verdict. */
const VERDICT = /fails\s+(WCAG|F\d)|violat|reprova|viola/i

// claimKind ignores what a criterion with one kind is not asked about.
const any = {} as never
const answer = (fields: Record<string, unknown>) => fields as never
const candidate = (context: Record<string, unknown>) => ({ ref: '#x', context }) as never

/** Every kind each judged criterion can return, from the enumerations its answers and candidates draw from. */
function kinds(): Array<[string, string]> {
  const out: Array<[string, string | undefined]> = [
    ...ALT_CLAIMS.filter((kind) => kind !== 'none').map((kind): [string, string] => ['1.1.1', kind]),
    ['1.1.1', nonTextContent.claimKind?.(answer({}), candidate({ hidden: { by: 'empty-alt' } }))],
    ...LINK_PROBLEMS.map((problem): [string, string | undefined] => ['2.4.4', linkPurpose.claimKind?.(answer({ problem }), any)]),
    ...(['heading', 'label'] as const).flatMap((kind) =>
      HEADING_PROBLEMS.map((problem): [string, string | undefined] => ['2.4.6', headingsAndLabels.claimKind?.(answer({ problem }), candidate({ kind }))]),
    ),
    ...TITLE_PROBLEMS.map((problem): [string, string | undefined] => ['2.4.2', pageTitled.claimKind?.(answer({ problem }), any)]),
    ['1.3.5', identifyInputPurpose.claimKind?.(any, any)],
    ['3.1.1', languageOfPage.claimKind?.(any, any)],
    ['3.1.2', languageOfParts.claimKind?.(any, any)],
    ...[undefined, 'group', 'format'].flatMap((kind) =>
      LABEL_PROBLEMS.map((problem): [string, string | undefined] => ['3.3.2', labelsOrInstructions.claimKind?.(answer({ problem }), candidate({ kind }))]),
    ),
  ]
  return out.filter((entry): entry is [string, string] => entry[1] !== undefined)
}

describe('the kind of claim each judged criterion cites', () => {
  it('is defined for every criterion judged by default', () => {
    for (const id of DEFAULT_CRITERIA) expect((CRITERIA.get(id) as AnyCriterion).claimKind, id).toBeTypeOf('function')
  })

  it('is a key of the table for every kind any criterion can return', () => {
    const returned = kinds()
    for (const [criterion, kind] of returned) expect(Object.hasOwn(CLAIM_TECHNIQUES, `${criterion} ${kind}`), `${criterion} ${kind}`).toBe(true)
    // Every key of the table is a kind some criterion returns, so no row waits for a kind that never comes.
    expect(new Set(returned.map(([criterion, kind]) => `${criterion} ${kind}`))).toEqual(new Set(Object.keys(CLAIM_TECHNIQUES)))
  })

  it('follows the problem in 2.4.4', () => {
    expect(linkPurpose.claimKind?.(answer({ problem: 'generic' }), any)).toBe('generic')
    expect(linkPurpose.claimKind?.(answer({ problem: 'url_or_filename' }), any)).toBe('address')
    expect(linkPurpose.claimKind?.(answer({ problem: 'mismatch' }), any)).toBe('mismatch')
    expect(linkPurpose.claimKind?.(answer({ problem: 'ambiguous' }), any)).toBe('shared_text')
    expect(linkPurpose.claimKind?.(answer({ problem: 'none' }), any)).toBeUndefined()
  })

  it('is the one kind of the criteria that make one claim, and a heading or a label in 2.4.6', () => {
    expect(identifyInputPurpose.claimKind?.(any, any)).toBe('autocomplete')
    expect(pageTitled.claimKind?.(answer({ problem: 'mismatch' }), any)).toBe('title')
    expect(languageOfPage.claimKind?.(any, any)).toBe('page_language')
    expect(languageOfParts.claimKind?.(any, any)).toBe('passage_language')
    expect(headingsAndLabels.claimKind?.(answer({ problem: 'generic' }), candidate({ kind: 'heading' }))).toBe('heading')
    expect(headingsAndLabels.claimKind?.(answer({ problem: 'generic' }), candidate({ kind: 'label' }))).toBe('label')
  })

  it('is label_not_visible in 3.3.2 only for a field whose label does not show', () => {
    expect(labelsOrInstructions.claimKind?.(answer({ problem: 'no_visible_label' }), candidate({}))).toBe('label_not_visible')
    expect(labelsOrInstructions.claimKind?.(answer({ problem: 'rule_not_explained' }), candidate({}))).toBeUndefined()
    expect(labelsOrInstructions.claimKind?.(answer({ problem: 'no_visible_label' }), candidate({ kind: 'group' }))).toBeUndefined()
    expect(labelsOrInstructions.claimKind?.(answer({ problem: 'rule_not_explained' }), candidate({ kind: 'format' }))).toBeUndefined()
  })
})

// The gloss inside the line: no opening "Falha: " (the noun says it) and no final period.
const phrase = (gloss: string | undefined) => (gloss ?? '').replace(/^Falha:\s*/u, '').replace(/\.$/u, '')

describe('the line that names the reading', () => {
  it('names a failure or a technique with its W3C title, two joined by "and", and the gloss first in Portuguese', () => {
    expect(readingText(['F30'], 'en')).toBe(`Reading applied: failure F30, "${TECHNIQUES.F30?.title}"`)
    expect(readingText(['F30'], 'pt-BR')).toBe(
      'Leitura aplicada: falha F30, "um texto alternativo que não é alternativa, como um nome de arquivo ou um placeholder" (Failure of Success Criterion 1.1.1 and 1.2.1 due to using text alternatives that are not alternatives (e.g., filenames or placeholder text))',
    )
    expect(readingText(['F39', 'H67'], 'en')).toBe(`Reading applied: failure F39, "${TECHNIQUES.F39?.title}" and technique H67, "${TECHNIQUES.H67?.title}"`)
    expect(readingText(['H81', 'H80'], 'pt-BR')).toBe(
      `Leitura aplicada: técnica H81, "${phrase(TECHNIQUES.H81?.gloss)}" (${TECHNIQUES.H81?.title}) e técnica H80, "${phrase(TECHNIQUES.H80?.gloss)}" (${TECHNIQUES.H80?.title})`,
    )
    expect(readingText(['F25', 'G88'], 'pt-BR')).toBe(`Leitura aplicada: falha F25, "${phrase(TECHNIQUES.F25?.gloss)}" (${TECHNIQUES.F25?.title}) e técnica G88, "${phrase(TECHNIQUES.G88?.gloss)}" (${TECHNIQUES.G88?.title})`)
  })

  it('is absent for a finding that cites none', () => {
    expect(readingText(undefined, 'en')).toBeUndefined()
    expect(readingText([], 'pt-BR')).toBeUndefined()
  })

  it('names no verdict on the page, for any row of the table, in either language', () => {
    for (const ids of Object.values(CLAIM_TECHNIQUES)) {
      for (const locale of ['en', 'pt-BR'] as const) {
        const line = readingText(ids, locale)
        if (ids.length === 0) expect(line).toBeUndefined()
        else expect(line).not.toMatch(VERDICT)
      }
    }
  })
})

describe('a report with one 1.1.1 placeholder finding', () => {
  const PNG = 'data:image/png;base64,iVBORw0KGgo='
  const picture = (ref: string, alt: string | undefined) =>
    node({
      ref,
      role: 'img',
      name: alt,
      image: PNG,
      bounds: { x: 0, y: 0, width: 160, height: 160 },
      native: { tag: 'img', attributes: { src: 'dog.png', ...(alt === undefined ? {} : { alt }) }, html: `<img src="dog.png" alt="${alt ?? ''}">` },
    })
  const snapshot: A11ySnapshot = {
    schemaVersion: 1,
    surface: 'web',
    target: 'https://www.example.org/',
    title: 'Example',
    locale: 'en',
    viewport: { width: 1280, height: 800, scale: 1 },
    collectedAt: '2026-11-09T00:00:00.000Z',
    collector: { name: 'test', version: '0' },
    root: node({ ref: 'html', role: 'document', lang: 'en', children: [picture('#placeholder', 'img-1'), picture('#missing', undefined)] }),
  }
  const engine: EngineResults = {
    engine: { name: 'axe-core', version: 'test' },
    rules: [{ ruleId: 'image-alt', outcome: 'violation', criteria: ['1.1.1'], help: 'Images must have alternative text', nodes: [{ ref: '#missing', target: '["#missing"]', html: '<img src="dog.png">' }] }],
  }
  const provider: ModelProvider = {
    id: 'test:placeholder',
    async judge<T>(request: JudgeRequest<T>) {
      const alt = /Current text alternative: "([^"]*)"/.exec(request.user)?.[1] ?? ''
      const output = { verdict: 'fail', evidence: alt, problem: 'filename_or_placeholder', imageShows: 'A cartoon dog', suggestedAlt: 'A cartoon dog with a red collar', confidence: 'high' }
      return { output: request.schema.parse(output), inputTokens: 10, outputTokens: 5, latencyMs: 1, modelId: 'placeholder' }
    },
  }
  const reportIn = (locale: Locale): Promise<Report> =>
    checkSnapshot(snapshot, engine, { criteria: [nonTextContent], llm: true, provider, runs: 1, cache: memoryCache(), offline: false, locale, minConfidence: 'low', concurrency: 1 })
  const F30 = TECHNIQUES.F30
  if (!F30) throw new Error('no F30')
  const LINES = {
    en: `Reading applied: failure F30, "${F30.title}"`,
    'pt-BR': `Leitura aplicada: falha F30, "${phrase(F30.gloss)}" (${F30.title})`,
  } as const
  const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')

  it('cites F30 on the judgment, and nothing on the engine finding', async () => {
    const report = await reportIn('en')
    const judged = report.findings.find((finding) => finding.source === 'judgment')
    expect(judged?.techniques).toEqual(['F30'])
    expect(judged?.message).toBe('The text alternative "img-1" is a file name or a placeholder.')
    const engineFinding = report.findings.find((finding) => finding.source === 'engine')
    expect(engineFinding).toBeDefined()
    expect(engineFinding).not.toHaveProperty('techniques')
    expect(report.schemaVersion).toBe(1)
  })

  it.each(['en', 'pt-BR'] as const)('shows the line once in every format, in %s', async (locale) => {
    const report = await reportIn(locale)
    const line = LINES[locale]

    const pretty = renderReport(report, { verbose: false, paint: paint(false) }).split('\n')
    const message = pretty.findIndex((text) => text.includes('"img-1"'))
    const reading = pretty.findIndex((text) => text.includes(line))
    expect(reading).toBeGreaterThan(message)
    expect(pretty[reading]?.trim()).toBe(line)
    expect(pretty.filter((text) => text.includes(LINES.en.slice(0, 16)) || text.includes(LINES['pt-BR'].slice(0, 16)))).toHaveLength(1)

    const markdown = renderMarkdown([report])
    const linked = line.replace('F30', `[F30](<${F30.url}>)`)
    expect(markdown).toContain(`\\\n${linked}\n`)
    expect(markdown.split(linked)).toHaveLength(2)

    const html = renderHtml([report])
    const [head, rest] = line.split('F30')
    const htmlLine = `${escape(head ?? '')}<a href="${F30.url}">F30</a>${(rest ?? '').replace(/[^"]+/g, (part) => escape(part))}`
    expect(html).toContain(`<p class="meta reading">${htmlLine}</p>`)
    expect(html.split('class="meta reading"')).toHaveLength(2)

    const results = toSarif([report]).runs[0]?.results ?? []
    const judged = results.find((result) => result.properties.source === 'judgment')
    expect(judged?.message.text).toContain(`${line}. (id `)
    expect(judged?.properties.techniques).toEqual(['F30'])
    const engineResult = results.find((result) => result.properties.source === 'engine')
    expect(engineResult?.properties).not.toHaveProperty('techniques')
    expect(engineResult?.message.text).not.toContain(line)

    const agent = checkResult(report, engine)
    expect(agent.findings.find((finding) => finding.source === 'judgment')?.techniques).toEqual(['F30'])
    expect(agent.findings.find((finding) => finding.source === 'engine')).not.toHaveProperty('techniques')
    expect(checkText(report, agent)).toContain(`   ${line}\n`)

    for (const text of [pretty.join('\n'), markdown, html, judged?.message.text ?? '', checkText(report, agent)]) {
      for (const shown of text.split('\n').filter((entry) => entry.includes('F30'))) expect(shown).not.toMatch(VERDICT)
    }
  })
})
