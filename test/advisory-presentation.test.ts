import { describe, expect, it } from 'vitest'
import { EXEMPT_NAMES } from '../src/advisory/checks/icon-only.ts'
import { CAPS_WORDS, ITALIC_WORDS, decorativeKind, decorativeOf } from '../src/advisory/checks/legibility.ts'
import { NEW_WINDOW_ICON, NEW_WINDOW_WORDS } from '../src/advisory/checks/new-window.ts'
import { NO_PRESENTATION } from '../src/advisory/presentation.ts'
import type { Advisory } from '../src/advisory/types.ts'
import { memoryCache } from '../src/core/cache.ts'
import { checkSnapshot } from '../src/core/check.ts'
import type { Report } from '../src/core/types.ts'
import type { Locale } from '../src/i18n.ts'
import { paint } from '../src/report/color.ts'
import { renderHtml } from '../src/report/html.ts'
import { renderMarkdown } from '../src/report/markdown.ts'
import { renderReport } from '../src/report/pretty.ts'
import { toSarif } from '../src/report/sarif.ts'
import { A11ySnapshotSchema, type A11ySnapshot, type TextBlockFacts } from '../src/snapshot/schema.ts'
import { profileOf, testDictionaries } from './coga-helpers.ts'
import { cadastroSnapshot, presentationSnapshot } from './coga-snapshot.ts'

/**
 * The checks of how text and controls are presented (legibility, icon-only controls, links that open a new window), on
 * the facts the collector records with --profile cognitive (snapshot.presentation). No browser: the facts are written
 * here, so each threshold is tested at its edge; test/advisory-fixtures.test.ts loads real pages.
 */

const PRESENTATION_CHECKS = ['coga/icon-only-control', 'coga/new-window', 'coga/line-length', 'coga/text-alignment', 'coga/line-height', 'coga/text-emphasis', 'coga/decorative-font']

const all = (section: { results: Advisory[]; belowThreshold: Advisory[] }) => [...section.results, ...section.belowThreshold]
const summary = (advisory: Advisory) => `${advisory.check} ${advisory.kind} ${advisory.ref}`

/** The snapshot with its blocks replaced: one block per entry, each its own column unless `column` says otherwise. */
function withBlocks(blocks: Array<Partial<TextBlockFacts>>, column?: (index: number) => string): A11ySnapshot {
  const snapshot = presentationSnapshot()
  const presentation = snapshot.presentation
  if (!presentation) throw new Error('no presentation')
  const base = presentation.blocks[0] as TextBlockFacts
  presentation.blocks = blocks.map((extra, index) => ({ ...base, ref: `#b${index}`, ...extra }))
  presentation.controls = []
  presentation.links = []
  const main = snapshot.root.children[0]?.children[0]
  if (!main) throw new Error('no main')
  const columns = new Map<string, A11ySnapshot['root']>()
  for (const [index, fact] of presentation.blocks.entries()) {
    const key = column ? column(index) : `c${index}`
    let holder = columns.get(key)
    if (!holder) {
      holder = { ref: `section.${key}`, role: 'region', states: [], bounds: { x: columns.size * 600, y: 0, width: 480, height: 400 }, native: { tag: 'section' }, children: [] }
      columns.set(key, holder)
    }
    // Each column has a left edge of its own: blocks of one column line up.
    const x = holder.bounds?.x ?? 0
    holder.children.push({ ref: fact.ref, role: 'paragraph', text: fact.sample, states: [], bounds: { x, y: index * 200, width: 480, height: 150 }, native: { tag: 'p' }, children: [] })
  }
  main.children = [...columns.values()]
  return snapshot
}

async function checksOn(snapshot: A11ySnapshot, check: string): Promise<Advisory[]> {
  return all(await profileOf(snapshot)).filter((advisory) => advisory.check === check)
}

describe('the presentation checks on a recorded page', () => {
  it('gives one result per case, grouped, and stays silent on the well-set paragraph, the search button and the warned link', async () => {
    const section = await profileOf(presentationSnapshot())
    const own = all(section).filter((advisory) => PRESENTATION_CHECKS.includes(advisory.check))
    expect(own.map(summary).sort()).toEqual(
      [
        'coga/decorative-font advisory #comic',
        'coga/icon-only-control advisory #facebook',
        'coga/line-height advisory #apertado',
        'coga/line-height beyond-target #apertado',
        'coga/line-length advisory #longo',
        'coga/line-length beyond-target #longo',
        'coga/new-window advisory #transparencia',
        'coga/text-alignment advisory #justificado',
        'coga/text-alignment beyond-target #justificado',
        'coga/text-emphasis advisory #italico',
        'coga/text-emphasis advisory #maiusculas',
      ].sort(),
    )
    for (const check of PRESENTATION_CHECKS) expect(section.checks.find((summary) => summary.check === check)).toMatchObject({ ran: true, maturity: 'experimental' })
    // Three social icons in one footer are one result, naming each.
    expect(own.find((advisory) => advisory.check === 'coga/icon-only-control')?.facts).toMatchObject({ controls: 3, names: 'Facebook | Instagram | YouTube', icon: 'svg' })
    expect(section.coverage.beyondTarget).toEqual(['3.1.4', '1.4.8'])
    // G18 is cited by coga/interruptions, which reads an observation of the live page this snapshot does not have, and G02
    // by coga/literal-language, which needs a model.
    expect(section.coverage.gaia).toEqual({ G02: 'not-run', G03: 'screened', G09: 'screened', G14: 'screened', G18: 'not-run', G22: 'screened' })
    expect(section.coverage.patterns['o3p10-whitespace']).toBe('screened')
    expect(section.coverage.patterns['o8p04-interface']).toBe('screened')
  })

  it('cites the COGA pattern or the GAIA recommendation each check rests on, and the guides beside it', async () => {
    const own = all(await profileOf(presentationSnapshot()))
    const by = (check: string, kind = 'advisory') => own.find((advisory) => advisory.check === check && advisory.kind === kind)
    expect(by('coga/line-length')).toMatchObject({ label: 'Advisory · COGA o3p10 Use White Spacing (not a WCAG requirement)', impact: 'hurdle', basis: { framework: 'coga', pattern: 'o3p10' } })
    expect(by('coga/line-length')?.related).toContainEqual(expect.objectContaining({ kind: 'guide', label: 'GAIA G03 Legibilidade' }))
    expect(by('coga/line-length', 'beyond-target')).toMatchObject({ label: 'Beyond the target: WCAG 2.2 1.4.8 Visual Presentation (Level AAA)', impact: 'suggestion' })
    expect(by('coga/new-window')).toMatchObject({ label: 'Advisory · GAIA G22 Consistency (not a WCAG requirement)', basis: { framework: 'guide', guide: 'gaia', id: 'G22' } })
    expect(by('coga/new-window')?.related).toContainEqual(expect.objectContaining({ kind: 'technique', url: 'https://www.w3.org/WAI/WCAG22/Techniques/general/G201' }))
    expect(by('coga/decorative-font')).toMatchObject({ basis: { framework: 'coga', pattern: 'o8p04', statement: 'avoid' } })
    expect(by('coga/icon-only-control')).toMatchObject({ basis: { framework: 'coga', pattern: 'o4p06' } })
    const italic = own.find((advisory) => advisory.ref === '#italico')
    expect(italic?.label).toBe('Advisory · WebAIM Use stylistic differences conservatively (not a WCAG requirement)')
    const caps = own.find((advisory) => advisory.ref === '#maiusculas')
    expect(caps).toMatchObject({ basis: { framework: 'guide', guide: 'gaia', id: 'G03' }, facts: { style: 'caps', capsBy: 'text-transform' } })
    expect(caps?.message).toContain('shown in capitals (text-transform: uppercase)')
    const pt = all(await profileOf(presentationSnapshot(), { locale: 'pt-BR' }))
    expect(pt.find((advisory) => advisory.check === 'coga/new-window')?.label).toBe('Recomendação · GAIA G22 Consistência (não é requisito da WCAG)')
  })

  it('says why the checks did not run on a snapshot recorded without the facts, and on facts of a version it does not read', async () => {
    const old = await profileOf(cadastroSnapshot())
    for (const check of PRESENTATION_CHECKS) expect(old.checks.find((summary) => summary.check === check)).toMatchObject({ ran: false, reason: NO_PRESENTATION })
    expect(old.coverage.beyondTarget).toEqual(['3.1.4'])
    expect(old.coverage.gaia).toEqual({ G02: 'not-run', G03: 'not-run', G09: 'not-run', G14: 'not-run', G18: 'not-run', G22: 'not-run' })
    const future = presentationSnapshot()
    if (future.presentation) future.presentation.version = '9'
    const section = await profileOf(future)
    expect(section.checks.find((summary) => summary.check === 'coga/line-length')).toMatchObject({ ran: false, reason: 'presentation facts of version 9, which this check does not read' })
  })

  it('keeps the facts when a snapshot is loaded, and loads one recorded before them', () => {
    const parsed = A11ySnapshotSchema.parse(JSON.parse(JSON.stringify(presentationSnapshot())))
    expect(parsed.presentation?.blocks).toHaveLength(7)
    expect(parsed.presentation?.controls[0]).toEqual({ ref: '#facebook', icon: 'svg', name: 'Facebook' })
    expect(A11ySnapshotSchema.parse(JSON.parse(JSON.stringify(cadastroSnapshot()))).presentation).toBeUndefined()
  })
})

describe('thresholds, at their edges', () => {
  it('line length: over 80 characters per line (40 in CJK), from 3 lines and 25 words', async () => {
    const results = await checksOn(
      withBlocks([
        { charsPerLine: { median: 80, max: 82 } },
        { charsPerLine: { median: 81, max: 84 } },
        { charsPerLine: { median: 95, max: 99 } },
        { charsPerLine: { median: 41, max: 44 }, script: 'cjk', words: 3, chars: 160 },
        { charsPerLine: { median: 120, max: 130 }, lines: 2 },
        { charsPerLine: { median: 120, max: 130 }, words: 24 },
      ]),
      'coga/line-length',
    )
    const advisories = results.filter((advisory) => advisory.kind === 'advisory')
    expect(advisories.map((advisory) => [advisory.ref, advisory.confidence])).toEqual([
      // Within 3 characters of the limit, the count could fall on either side: medium.
      ['#b1', 'medium'],
      ['#b2', 'high'],
      ['#b3', 'medium'],
    ])
    expect(advisories[2]?.facts).toMatchObject({ limit: 40 })
    expect(advisories[2]?.message).toContain('40 characters as the width for Chinese, Japanese and Korean text')
    expect(results.find((advisory) => advisory.kind === 'beyond-target')?.facts).toMatchObject({ aspect: 'width', blocks: 3 })
  })

  it('groups the blocks of one column, and lists at most 5 groups per page with a note for the rest', async () => {
    const one = await checksOn(withBlocks([{ charsPerLine: { median: 120, max: 125 } }, { charsPerLine: { median: 110, max: 140 } }], () => 'article'), 'coga/line-length')
    const group = one.find((advisory) => advisory.kind === 'advisory')
    expect(group?.facts).toMatchObject({ blocks: 2, charsPerLine: 115, longestLine: 140, refs: '#b0 | #b1' })
    expect(group?.message).toMatch(/^2 blocks of text here are drawn with lines of 115 characters \(median; the longest has 140\) at a 1280×720 viewport\./)
    const many = await profileOf(withBlocks(Array.from({ length: 7 }, () => ({ charsPerLine: { median: 120, max: 125 } }))))
    expect(all(many).filter((advisory) => advisory.check === 'coga/line-length' && advisory.kind === 'advisory')).toHaveLength(5)
    expect(many.notes).toContain('coga/line-length: 2 more groups are not listed (at most 5 per page).')
    expect(all(many).find((advisory) => advisory.check === 'coga/line-length' && advisory.kind === 'beyond-target')?.facts).toMatchObject({ blocks: 7 })
  })

  it('alignment: justified, or right-aligned in a left-to-right language; never right-to-left text, centered text or short blocks', async () => {
    const results = await checksOn(
      withBlocks([
        { align: 'justify' },
        { align: 'right' },
        { align: 'end' },
        { align: 'center' },
        { align: 'right', direction: 'rtl' },
        { align: 'justify', script: 'rtl' },
        { align: 'justify', lines: 2 },
      ]),
      'coga/text-alignment',
    )
    expect(results.map((advisory) => `${advisory.kind} ${advisory.ref} ${advisory.basis.framework}`)).toEqual([
      'advisory #b0 coga',
      'advisory #b1 guide',
      'advisory #b2 guide',
      // Right alignment meets 1.4.8 (technique C19): only the justified block is beyond the target.
      'beyond-target #b0 wcag',
    ])
  })

  it('line spacing: an advisory below 1.2 times the font size, WCAG 1.4.8 (AAA) alone below 1.5', async () => {
    const results = await checksOn(withBlocks([{ lineGap: 19 }, { lineGap: 19.2 }, { lineGap: 23.9 }, { lineGap: 24 }, { lineGap: 15, lines: 2 }]), 'coga/line-height')
    expect(results.filter((advisory) => advisory.kind === 'advisory').map((advisory) => [advisory.ref, advisory.facts?.ratio])).toEqual([['#b0', 1.19]])
    expect(results.find((advisory) => advisory.kind === 'beyond-target')?.facts).toMatchObject({ aspect: 'spacing', blocks: 3 })
    expect(results.find((advisory) => advisory.kind === 'advisory')?.message).toContain('The lines of this block are 19 px apart for 16 px text, 1.19 times the font size')
    const pt = all(await profileOf(withBlocks([{ lineGap: 16.8 }]), { locale: 'pt-BR' })).find((advisory) => advisory.check === 'coga/line-height')
    expect(pt?.message).toContain('1,05 vezes o tamanho da fonte')
  })

  it('capitals: a passage of more than 15 words, almost all of it in capitals; italics: more than 50 words', async () => {
    const caps = (words: number, upper: number) => ({ words, cased: 200, upper, lines: 3 })
    const italic = (words: number, share: number) => ({ words, letters: 300, italic: Math.round(300 * share) })
    const results = await checksOn(
      withBlocks([caps(CAPS_WORDS, 200), caps(CAPS_WORDS + 1, 200), caps(40, 189), caps(40, 190), italic(ITALIC_WORDS, 1), italic(ITALIC_WORDS + 1, 1), italic(80, 0.9)]),
      'coga/text-emphasis',
    )
    expect(results.map((advisory) => `${advisory.ref} ${advisory.facts?.style}`)).toEqual(['#b1 caps', '#b3 caps', '#b5 italic'])
    // Scripts without case have no capitals to count.
    expect(await checksOn(withBlocks([{ words: 40, cased: 0, upper: 0, script: 'cjk' }]), 'coga/text-emphasis')).toEqual([])
  })

  it('decorative fonts: the generic cursive or fantasy families, or a family on the list, in body text; never serif', async () => {
    expect(decorativeKind('Comic Sans MS')).toBe('cartoon')
    expect(decorativeKind('"Comic Sans MS Bold"')).toBe('cartoon')
    expect(decorativeKind('Pacifico')).toBe('script')
    expect(decorativeKind('UnifrakturMaguntia')).toBe('blackletter')
    for (const plain of ['Georgia', 'Times New Roman', 'serif', 'Century Gothic', 'MS Gothic', 'Franklin Gothic Medium', 'Arial', 'Comic Neue']) expect(decorativeKind(plain)).toBeUndefined()
    const base = presentationSnapshot().presentation?.blocks[0] as TextBlockFacts
    expect(decorativeOf({ ...base, font: 'cursive', platformFont: 'Comic Sans MS' })).toEqual({ what: 'generic', family: 'cursive', drawn: 'Comic Sans MS', confirmed: true })
    // The author asked for a cursive face; this machine drew a plain one: still reported, at medium confidence.
    expect(decorativeOf({ ...base, font: 'cursive', platformFont: 'DejaVu Sans' })).toMatchObject({ what: 'generic', confirmed: false })
    // The font drawn wins over the list: a decorative family the browser did not use is not reported.
    expect(decorativeOf({ ...base, font: 'Pacifico', platformFont: 'Arial' })).toBeUndefined()
    expect(decorativeOf({ ...base, font: 'Georgia', family: 'Georgia, serif' })).toBeUndefined()
    const results = await checksOn(
      withBlocks([
        { font: 'Comic Sans MS', platformFont: 'Comic Sans MS' },
        { font: 'Comic Sans MS', platformFont: 'Comic Sans MS' },
        { font: 'fantasy' },
        { font: 'Comic Sans MS', words: 20 },
      ]),
      'coga/decorative-font',
    )
    expect(results.map((advisory) => [advisory.ref, advisory.facts?.blocks, advisory.facts?.fontKind])).toEqual([
      ['#b0', 2, 'cartoon'],
      ['#b2', 1, 'generic'],
    ])
  })
})

describe('icon-only controls and links that open a new window', () => {
  it('exempts search, home and close by name, and not the hamburger menu', () => {
    for (const name of ['buscar', 'search', 'pesquisar no portal', 'fechar aviso', 'close dialog', 'página inicial', 'home', 'cerrar']) expect(EXEMPT_NAMES.test(name)).toBe(true)
    for (const name of ['menu', 'abrir menu', 'facebook', 'compartilhar', 'carrinho', 'closed captions']) expect(EXEMPT_NAMES.test(name)).toBe(false)
  })

  it('reads a warning of a new window in English, Portuguese and Spanish, and not "external link"', () => {
    for (const said of ['Report (opens in a new tab)', 'opens a new window', 'Ouvidoria (abre em nova aba)', 'abre numa nova janela', 'em outra guia', 'se abre en una nueva pestaña', 'nueva ventana', 'new window']) {
      expect(NEW_WINDOW_WORDS.test(said)).toBe(true)
    }
    for (const said of ['External link', 'link externo', 'Portal da Transparência', 'Open data']) expect(NEW_WINDOW_WORDS.test(said)).toBe(false)
    expect(NEW_WINDOW_ICON.test('icon icon-external')).toBe(true)
    expect(NEW_WINDOW_ICON.test('material-icons open_in_new')).toBe(true)
    expect(NEW_WINDOW_ICON.test('icon-facebook')).toBe(false)
  })

  it('leaves a control with no name to WCAG, and a control named next to it to its label', async () => {
    const snapshot = presentationSnapshot()
    const footer = snapshot.root.children[0]?.children[1]
    const list = footer?.children[0]
    if (!snapshot.presentation || !list) throw new Error('fixture')
    // No name at all: axe-core's link-name reports it.
    const unnamed = list.children[0]
    if (unnamed) {
      unnamed.name = undefined
      ;(unnamed.native.attributes as Record<string, string>)['aria-label'] = ''
    }
    const fact = snapshot.presentation.controls[0]
    if (fact) fact.name = undefined
    // Its name shown right beside it.
    list.children.push({ ref: 'footer > ul > span', role: 'generic', text: 'Instagram', states: [], bounds: { x: 0, y: 0, width: 80, height: 20 }, native: { tag: 'span' }, children: [] })
    list.children.splice(2, 0, list.children.pop() as A11ySnapshot['root'])
    const result = (await checksOn(snapshot, 'coga/icon-only-control'))[0]
    expect(result?.facts).toMatchObject({ controls: 1, names: 'YouTube' })
    expect(result?.message).toBe(
      'This link shows an svg icon and no words; its name, "YouTube", is read by assistive technology but not shown. COGA recommends visible labels next to controls: a person who cannot remember what an icon means has nothing to read. GAIA (G14) asks for a text equivalent next to icons, and WebAIM to pair icons with text.',
    )
  })

  it('reports a new window marked only by an icon with no text alternative at low confidence, below the default threshold', async () => {
    const snapshot = presentationSnapshot()
    const link = snapshot.presentation?.links[0]
    if (!link) throw new Error('fixture')
    link.icon = 'icon icon-external'
    const section = await profileOf(snapshot, { minConfidence: 'medium' })
    expect(section.results.some((advisory) => advisory.check === 'coga/new-window')).toBe(false)
    const low = section.belowThreshold.find((advisory) => advisory.check === 'coga/new-window')
    expect(low).toMatchObject({ confidence: 'low', facts: { icon: 'icon icon-external' } })
    expect(low?.message).toContain('An icon (icon icon-external) may show it to people who see it, but it has no text alternative: confidence is low.')
  })
})

describe('in each report', () => {
  async function report(locale: Locale = 'en'): Promise<Report> {
    return checkSnapshot(presentationSnapshot(), { engine: { name: 'axe-core', version: 'test' }, rules: [] }, {
      criteria: [],
      llm: false,
      provider: undefined,
      runs: 1,
      cache: memoryCache(),
      offline: false,
      locale,
      minConfidence: 'medium',
      concurrency: 2,
      profiles: ['cognitive'],
      coga: { dictionaries: testDictionaries },
    })
  }

  it('shows WCAG 1.4.8 beyond the target in one line, with the caveat that a mechanism may still provide it', async () => {
    const pretty = renderReport(await report(), { verbose: false, paint: paint(false) })
    expect(pretty).toContain(
      "◇ 1.4.8 Visual Presentation, at 1280×720 in the page's own styles: 1 block with lines over 80 characters, 1 justified block, 1 block with line spacing under 1.5; a mechanism of the browser or the reader may still provide what 1.4.8 asks · experimental",
    )
    expect(pretty).toContain(
      'GAIA recommendations (Britto, 2016), screened in part: G03 Legibility (line length, justified and right-aligned text, tight line spacing, long passages in capitals or italics, decorative fonts), G09 Eliminate distractions (decorative fonts), G14 Text equivalents (icon-only controls), G22 Consistency (links that open a new window).',
    )
    expect(pretty).toContain('o3p10 Use White Spacing (line length, justified and right-aligned text, tight line spacing)')
    expect(pretty).toContain('o4p06 Use Clear Visible Labels (placeholder-only labels, icon-only controls)')
    expect(pretty).toContain(
      "Beyond the A/AA target: WCAG 2.2 3.1.4 Abbreviations (AAA) checked; 1.4.8 Visual Presentation (AAA) measured in the page's own styles, which a mechanism of the browser or the reader may change; 3.1.5 Reading Level needs a qualified reviewer, with the text measurements attached.",
    )
    expect(pretty).not.toContain('✗')
    const portuguese = renderReport(await report('pt-BR'), { verbose: false, paint: paint(false) })
    expect(portuguese).toContain('1.4.8 Apresentação visual, numa janela de 1280×720 com os estilos da própria página')
  })

  it('links the guide in HTML, keeps the line in Markdown, and tags the SARIF rules', async () => {
    const result = await report()
    const html = renderHtml([result])
    expect(html).toContain('<a href="https://gaia.wiki.br/reconhecimento-e-previsibilidade/">GAIA G22: Consistency</a>')
    expect(renderMarkdown([result])).toContain('◇ 1.4.8 Visual Presentation, at 1280×720')
    const run = toSarif([result]).runs[0]
    expect(run?.tool.driver.rules.find((rule) => rule.id === 'coga/new-window')?.properties.tags).toEqual(['accessibility', 'gaia', 'advisory', 'not-wcag', 'experimental'])
    expect(run?.tool.driver.rules.find((rule) => rule.id === 'wcag-aaa/1.4.8')?.properties.tags).toContain('beyond-target')
    expect(run?.results.every((entry) => entry.level === 'note')).toBe(true)
  })
})
