import { describe, expect, it } from 'vitest'
import { memoryCache } from '../src/core/cache.ts'
import { checkSnapshot } from '../src/core/check.ts'
import type { EngineResults } from '../src/core/types.ts'
import { addressText, genericLinkText } from '../src/criteria/generic-text.ts'
import { headingsAndLabels, saysNothing } from '../src/criteria/headings-and-labels.ts'
import { groundedLink, linkPurpose } from '../src/criteria/link-purpose.ts'
import type { JudgeRequest, ModelProvider } from '../src/providers/types.ts'
import { methodText, reviewGroups } from '../src/report/common.ts'
import { paint } from '../src/report/color.ts'
import { renderReport } from '../src/report/pretty.ts'
import type { A11yNode, A11ySnapshot } from '../src/snapshot/schema.ts'
import { node } from './helpers.ts'

const NO_ENGINE: EngineResults = { engine: { name: 'axe-core', version: 'test' }, rules: [] }

function link(ref: string, text: string, href: string): A11yNode {
  return node({ ref, role: 'link', name: text, native: { tag: 'a', attributes: { href }, html: `<a href="${href}">${text}</a>` }, children: [node({ ref: `${ref}-text`, text })] })
}

function page(children: A11yNode[]): A11ySnapshot {
  return {
    schemaVersion: 1,
    surface: 'web',
    target: 'https://health.example/articles/walking',
    title: 'Walking',
    locale: 'pt-BR',
    viewport: { width: 1280, height: 800, scale: 1 },
    collectedAt: '2026-10-11T00:00:00.000Z',
    collector: { name: 'test', version: '0' },
    root: node({ ref: 'html', role: 'document', lang: 'pt-BR', children: [node({ ref: 'body', native: { tag: 'body' }, children })] }),
  }
}

/** A model that fails every link and every heading, as Gemma failed "TOC" and "Read more" alike on real pages. */
function failsEverything(): ModelProvider {
  return {
    id: 'test:fails',
    async judge<T>(request: JudgeRequest<T>) {
      const link = /<link>([\s\S]*?)<\/link>/.exec(request.user)?.[1]
      const heading = /<(?:heading|label)>([\s\S]*?)<\/(?:heading|label)>/.exec(request.user)?.[1] ?? ''
      const output = link
        ? { promises: '', leadsTo: '', verdict: 'fail', evidence: link, problem: 'generic', suggestedText: `${link} sobre saúde`, confidence: 'high' }
        : { named: '', verdict: 'fail', evidence: heading, problem: 'generic', suggestedText: `${heading} da seção`, confidence: 'high' }
      return { output: request.schema.parse(output), inputTokens: 10, outputTokens: 5, latencyMs: 1, modelId: 'fails' }
    },
  }
}

describe('generic texts Rampa recognises without a model', () => {
  it('reads a "follow me" made only of verbs that name no destination and words that only point', () => {
    for (const text of ['Read more', 'Check it out', 'Click this', 'Veja aqui', 'Clique aqui para ver mais', 'Lee más aquí']) expect(genericLinkText(text), text).toBe(true)
    for (const text of ['ISTs', 'TOC', 'Download', 'Press', 'Open', 'Clique aqui para iniciar uma conversa', '<details>', 'Blog', 'available']) expect(genericLinkText(text), text).toBe(false)
  })

  it('takes an address with a path, or a file name, as an address, and a bare host as the name of a site', () => {
    expect(addressText('https://example.org/files/report_v2.pdf')).toBe(true)
    expect(addressText('report_v2.pdf')).toBe(true)
    expect(addressText('www.asthma.example.org')).toBe(false)
    expect(addressText('https://www.example.org/')).toBe(false)
    expect(addressText('ufc.br')).toBe(false)
  })

  it('grounds a link fail only on a generic text with nothing around it, an address, or links that share the text and lead elsewhere', () => {
    const alone = { sameText: undefined, context: undefined, headers: undefined, description: undefined }
    expect(groundedLink('generic', { ...alone, name: 'Read more' })).toBe(true)
    expect(groundedLink('generic', { ...alone, name: 'TOC' })).toBe(false)
    // Whether a sentence or a header cell completes a generic text is the model's reading.
    expect(groundedLink('generic', { ...alone, name: 'Clique aqui', context: 'Clique aqui para mais informações sobre a Ouvidoria da EBC.' })).toBe(false)
    expect(groundedLink('generic', { ...alone, name: 'Download', headers: 'Books' })).toBe(false)
    expect(groundedLink('url_or_filename', { ...alone, name: 'report.pdf' })).toBe(true)
    // A raw address with a sentence of its own has a context that can say where it leads (cnj.jus.br, in the third real-page study).
    expect(groundedLink('url_or_filename', { ...alone, name: 'www.cnj.jus.br/comopeticionar', context: 'conforme orientações previstas na página www.cnj.jus.br/comopeticionar.' })).toBe(false)
    expect(groundedLink('url_or_filename', { ...alone, name: 'https://example.org/r?id=7', description: 'The report of 2026' })).toBe(false)
    expect(groundedLink('mismatch', { ...alone, name: 'Pricing' })).toBe(false)
    expect(groundedLink('ambiguous', { ...alone, name: 'Download', sameText: { links: 2, places: 2, apart: false } })).toBe(true)
    expect(groundedLink('ambiguous', { ...alone, name: 'Download', sameText: { links: 2, places: 2, apart: true } })).toBe(false)
  })

  it('tells apart links with one text by the sections they sit in, not only by the heading right above them', () => {
    const heading = (ref: string, level: number, text: string) => node({ ref, role: 'heading', name: text, native: { tag: `h${level}` }, children: [node({ ref: `${ref}-text`, text })] })
    const docs = page([
      heading('#ex1', 3, 'Linking to an absolute URL'),
      heading('#ex1-result', 4, 'Result'),
      link('#play1', 'Play', '/play?code=1'),
      heading('#ex2', 3, 'Linking to relative URLs'),
      heading('#ex2-result', 4, 'Result'),
      link('#play2', 'Play', '/play?code=2'),
    ])
    const candidates = linkPurpose.candidates(docs, NO_ENGINE)
    expect(candidates.map((c) => c.context.sameText)).toEqual([
      { links: 2, places: 2, apart: true },
      { links: 2, places: 2, apart: true },
    ])
    // Under one section, the same two links are what fd3a94 fails: nothing tells them apart.
    const flat = page([heading('#result', 4, 'Result'), link('#play1', 'Play', '/play?code=1'), link('#play2', 'Play', '/play?code=2')])
    expect(linkPurpose.candidates(flat, NO_ENGINE).map((c) => c.context.sameText?.apart)).toEqual([false, false])
  })

  it('grounds a heading fail on a numbering under no subject, and a label fail on fields nothing tells apart', () => {
    expect(saysNothing({ kind: 'heading', text: 'Part 3', series: ['Part 1', 'Part 3'], outline: [] })).toBe(true)
    expect(saysNothing({ kind: 'heading', text: 'Entry 3', series: ['Entry 1', 'Entry 3'], outline: ['Part 1'] })).toBe(true)
    expect(saysNothing({ kind: 'heading', text: 'Example 3', series: ['Example 1', 'Example 3'], outline: ['Functional Images'] })).toBe(false)
    expect(saysNothing({ kind: 'heading', text: '2026 Annual report', series: ['2025 Annual report', '2026 Annual report'], outline: [] })).toBe(false)
    expect(saysNothing({ kind: 'heading', text: 'DESTAQUE', series: undefined, outline: ['Serviços para você'] })).toBe(false)
    // A label several fields share no longer grounds a finding: on the real-page studies' pages all six such findings were
    // wrong (four "Search USPS.com" fields in four menu panels), so only a label that names nothing is a fact.
    expect(saysNothing({ kind: 'label', text: 'Name:', sharedUnsorted: true })).toBe(false)
    expect(saysNothing({ kind: 'label', text: 'Name:', sharedUnsorted: undefined })).toBe(false)
    expect(saysNothing({ kind: 'label', text: 'Field 2' })).toBe(true)
  })
})

describe("a fail no checked fact supports is the model's suggestion, not a finding", () => {
  const snapshot = page([
    node({
      ref: 'nav',
      role: 'navigation',
      native: { tag: 'nav' },
      children: [link('#toc', 'TOC', '/tag/toc'), link('#more', 'Read more', '/tag/saude')],
    }),
  ])

  it('reports the generic text as a finding and the specific one for review, with the model and its suggestion', async () => {
    const report = await checkSnapshot(snapshot, NO_ENGINE, {
      criteria: [linkPurpose],
      llm: true,
      provider: failsEverything(),
      runs: 1,
      cache: memoryCache(),
      offline: false,
      locale: 'en',
      minConfidence: 'low',
      concurrency: 1,
    })
    expect(report.findings.map((f) => f.subject)).toEqual(['Read more'])
    expect(report.findings[0]?.confidence).toBe('high')
    expect(report.belowThreshold).toEqual([])
    expect(report.needsReview).toEqual([
      {
        criterion: '2.4.4',
        level: 'A',
        ruleId: 'judgment/2.4.4',
        ref: '#toc',
        message: 'The link text "TOC" does not tell where the link goes, and nothing around it does.',
        evidence: 'The model suggests: "TOC sobre saúde"',
        model: 'test:fails',
      },
    ])
    const summary = report.criteria.find((c) => c.criterion === '2.4.4')
    expect(summary).toMatchObject({ judged: 2, failed: 1, suggested: 1 })
    const method = report.coverage.criteria?.find((c) => c.id === '2.4.4')?.methods.find((m) => m.kind === 'judgment')
    expect(method).toMatchObject({ applicable: 2, failures: 1, review: 1, suggestions: 1 })
    expect(methodText(method!, report)).toBe('judgment 2.4.4@3 (2 applicable, 1 failed, 1 to review, 1 of them model suggestions with no checked fact behind them)')
    const group = reviewGroups(report)[0]
    expect(group?.reason).toContain('no fact Rampa checks supports the reading')
    expect(renderReport(report, { verbose: true, paint: paint(false) })).toContain('#toc: The link text "TOC" does not tell where the link goes, and nothing around it does. The model suggests: "TOC sobre saúde"')
  })

  it('leaves a criterion with only suggestions as needing review, never failing', async () => {
    const quiet = page([node({ ref: 'nav', role: 'navigation', native: { tag: 'nav' }, children: [link('#toc', 'TOC', '/tag/toc')] })])
    const report = await checkSnapshot(quiet, NO_ENGINE, {
      criteria: [linkPurpose, headingsAndLabels],
      llm: true,
      provider: failsEverything(),
      runs: 1,
      cache: memoryCache(),
      offline: false,
      locale: 'pt-BR',
      minConfidence: 'low',
      concurrency: 1,
    })
    expect(report.findings).toEqual([])
    expect(report.coverage.criteria?.find((c) => c.id === '2.4.4')?.status).toBe('needs-review')
    expect(reviewGroups(report)[0]?.reason).toContain('São sugestões para uma pessoa decidir, nunca falhas.')
  })

  it('keeps every verified fail as a finding in the ablation without verification', async () => {
    const report = await checkSnapshot(snapshot, NO_ENGINE, {
      criteria: [linkPurpose],
      llm: true,
      provider: failsEverything(),
      runs: 1,
      cache: memoryCache(),
      offline: false,
      locale: 'en',
      minConfidence: 'low',
      concurrency: 1,
      verify: false,
    })
    expect(report.findings.map((f) => f.subject).sort()).toEqual(['Read more', 'TOC'])
    expect(report.needsReview).toBeUndefined()
  })
})
