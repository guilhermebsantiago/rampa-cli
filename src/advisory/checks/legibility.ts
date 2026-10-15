import type { Locale } from '../../i18n.ts'
import type { AdvisoryCheck, AdvisoryHit, CheckRun } from '../check.ts'
import { cogaBasis } from '../coga.ts'
import { gaiaBasis, gaiaReference, webaimBasis, webaimReference } from '../guides.ts'
import { am, amPlural } from '../messages.ts'
import type { Page } from '../page.ts'
import {
  type Block,
  MAX_GROUPS,
  blocksOf,
  capGroups,
  columnOf,
  groupBy,
  isCjk,
  isLongBlock,
  leftOutNote,
  lineRatio,
  median,
  notMeasured,
  presentationOf,
  viewportOf,
} from '../presentation.ts'
import type { Basis } from '../types.ts'

/**
 * How reading text is set: line length, alignment, line spacing, capitals and italics, and decorative fonts. Rules over
 * the presentation facts the collector measured in the browser at the snapshot's viewport (surfaces/presentation.ts),
 * so they run only when the snapshot has them (`--profile cognitive`). Every claim is a measured fact with the block it
 * is about; what is cut off where, and why, is in docs/cognitive-profile.md ("Legibility, icons and new windows").
 *
 * Sources: GAIA G03 Legibilidade (https://gaia.wiki.br/vocabulario-visual-e-textual/legibilidade): "evite linhas com
 * mais de 80 caracteres", "Evite alinhar os textos à direita", "evite o uso de caixa alta para todos os caracteres";
 * WebAIM, Evaluating Cognitive Web Accessibility: "Avoid full justified text", "The amount of space between lines
 * should generally be no less than half the character height", "Do not use italics or bold on long sections of text.
 * Be careful with ALL CAPS."; COGA o3p10 Use White Spacing and o8p04 ("Default fonts that are not clear or readable
 * such as a cartoon font or gothic"); WCAG 2.2 1.4.8 Visual Presentation (AAA), reported beyond the target.
 */

/** Characters per line above which GAIA G03, WAVE's checklist and WCAG 1.4.8 (AAA) ask for shorter lines; 1.4.8 counts 40 in CJK. */
export const LINE_LIMIT = 80
export const LINE_LIMIT_CJK = 40
/** Line height over font size: below 1.2 is an advisory (the browser's `normal` for most fonts, or tighter); below 1.5, WCAG 1.4.8 (AAA) only. */
export const TIGHT_RATIO = 1.2
export const AAA_RATIO = 1.5
/** A passage in capitals: more words than Rampa's 1.3.1 rule reads as a possible heading (15), so it is a passage, not a label or a call-out. */
export const CAPS_WORDS = 15
/** A long passage in italics: more than COGA's 50 words, its own figure for a long paragraph (Note §4.4.5). */
export const ITALIC_WORDS = 50
/** Share of the letters that must be in capitals or in italics: "entirely", give or take an abbreviation in lower case. */
export const ENTIRE_SHARE = 0.95
/** Body text: blocks of at least this many words show what the page's reading text is set in. */
export const FONT_WORDS = 25

export const WCAG_148: Basis = {
  framework: 'wcag',
  id: '1.4.8',
  level: 'AAA',
  version: '2.2',
  outside: 'aaa',
  url: 'https://www.w3.org/WAI/WCAG22/Understanding/visual-presentation.html',
}

const O3P10_READING = cogaBasis(
  'o3p10',
  'how-it-helps',
  'For those with cognitive and learning disabilities, white space has been shown to ease reading difficulties and improve understanding of content.',
)
const O3P10_SPACING = cogaBasis('o3p10', 'more-details', 'Use clear spacing between letters, words, sentences lines, paragraphs, and blocks of text.')
const G03_RIGHT = gaiaBasis('G03', 'Evite alinhar os textos à direita.')
const G03_CAPS = gaiaBasis('G03', 'Use textos em caixa baixa, evite o uso de caixa alta para todos os caracteres.')
const WEBAIM_ITALIC = webaimBasis('stylistic-differences', 'Do not use italics or bold on long sections of text.')
const O8P04 = cogaBasis('o8p04', 'avoid', 'Default fonts that are not clear or readable such as a cartoon font or gothic.')

const RTL_LANGUAGES = /^(ar|he|iw|fa|ur|yi|ps|sd|ug|dv|ckb)\b/i

function limitOf(block: Block): number {
  return isCjk(block) ? LINE_LIMIT_CJK : LINE_LIMIT
}

function number(value: number, locale: Locale): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value)
}

/** The refs of a group, for the JSON report: up to 5. */
function refsOf(blocks: readonly Block[]): string {
  return blocks
    .slice(0, 5)
    .map((block) => block.node.ref)
    .join(' | ')
}

function rightToLeft(block: Block): boolean {
  return block.fact.direction === 'rtl' || block.fact.script === 'rtl' || RTL_LANGUAGES.test(block.language)
}

/** The facts every grouped result carries: how many blocks, which, and the first one's sample. */
function groupFacts(group: readonly Block[], viewport: string): Record<string, string | number | boolean> {
  const first = group[0] as Block
  return { blocks: group.length, refs: refsOf(group), viewport, sample: first.fact.sample, words: first.fact.words, lines: first.fact.lines }
}

export const lineLength: AdvisoryCheck = {
  id: 'coga/line-length',
  version: '1',
  maturity: 'experimental',
  pattern: 'o3p10',
  gaia: ['G03'],
  surfaces: ['web'],

  run({ page, locale }): CheckRun {
    const facts = presentationOf(page)
    if (!facts) return notMeasured(page)
    const viewport = viewportOf(facts)
    const candidates = blocksOf(page, facts).filter(isLongBlock)
    const long = candidates.filter((block) => block.fact.charsPerLine.median > limitOf(block))
    const notes: string[] = []
    const hits: AdvisoryHit[] = []
    for (const group of capGroups(
      groupBy(long, (block) => columnOf(page, block.node)),
      MAX_GROUPS,
      'coga/line-length',
      locale,
      notes,
    )) {
      const first = group[0] as Block
      const limit = limitOf(first)
      const perLine = Math.round(median(group.map((block) => block.fact.charsPerLine.median)))
      const max = Math.max(...group.map((block) => block.fact.charsPerLine.max))
      const vars = { count: group.length, median: perLine, max, viewport, sample: first.fact.sample }
      const message = `${am(locale, group.length === 1 ? 'lineLengthOne' : 'lineLengthMany', vars)} ${am(locale, limit === LINE_LIMIT_CJK ? 'lineLengthRecommendCjk' : 'lineLengthRecommend')}`
      hits.push({
        kind: 'advisory',
        basis: O3P10_READING,
        related: [gaiaReference('G03'), webaimReference('Line length'), WCAG_148],
        impact: 'hurdle',
        source: 'rule',
        ref: first.node.ref,
        message,
        evidence: first.fact.sample,
        subject: columnOf(page, first.node),
        facts: { ...groupFacts(group, viewport), charsPerLine: perLine, longestLine: max, limit },
        // Characters per line are counted from the width each line takes: a median within 3 of the limit could fall on either side.
        confidence: perLine > limit + 3 ? 'high' : 'medium',
      })
    }
    if (long.length > 0) hits.push(beyond(long, 'width', amPlural(locale, 'beyondWidth', long.length, { viewport, limit: limitOf(long[0] as Block) }), viewport, limitOf(long[0] as Block)))
    const note = leftOutNote(facts, 'blocks', locale)
    if (note) notes.push(note)
    return { ran: true, candidates: candidates.length, hits, notes }
  },
}

/** One result per page beyond the target: what WCAG 1.4.8 (AAA) asks a mechanism to provide, measured in the page's own styles. */
function beyond(blocks: readonly Block[], aspect: 'width' | 'justified' | 'spacing', message: string, viewport: string, limit?: number): AdvisoryHit {
  const first = blocks[0] as Block
  return {
    kind: 'beyond-target',
    basis: WCAG_148,
    impact: 'suggestion',
    source: 'rule',
    ref: first.node.ref,
    message,
    evidence: first.fact.sample,
    subject: aspect,
    pageLevel: true,
    facts: { aspect, blocks: blocks.length, refs: refsOf(blocks), viewport, ...(limit !== undefined ? { limit } : {}) },
    confidence: 'high',
  }
}

export const textAlignment: AdvisoryCheck = {
  id: 'coga/text-alignment',
  version: '1',
  maturity: 'experimental',
  pattern: 'o3p10',
  gaia: ['G03'],
  surfaces: ['web'],

  run({ page, locale }): CheckRun {
    const facts = presentationOf(page)
    if (!facts) return notMeasured(page)
    const viewport = viewportOf(facts)
    // Right-to-left text is aligned to the right by nature, and justified Arabic stretches its letters, not its spaces: never read here.
    const candidates = blocksOf(page, facts).filter((block) => isLongBlock(block) && !rightToLeft(block))
    const justified = candidates.filter((block) => block.fact.align === 'justify')
    const right = candidates.filter((block) => block.fact.align === 'right' || block.fact.align === '-webkit-right' || block.fact.align === 'end')
    const notes: string[] = []
    const hits: AdvisoryHit[] = []
    const groups = [
      ...groupBy(justified, (block) => columnOf(page, block.node)).map((group) => ({ group, align: 'justify' as const })),
      ...groupBy(right, (block) => columnOf(page, block.node)).map((group) => ({ group, align: 'right' as const })),
    ]
    for (const { group, align } of capGroups(
      groups.map((entry) => [entry]),
      MAX_GROUPS,
      'coga/text-alignment',
      locale,
      notes,
    ).map((entry) => entry[0] as (typeof groups)[number])) {
      const first = group[0] as Block
      const vars = { count: group.length, lines: first.fact.lines, sample: first.fact.sample }
      const one = group.length === 1
      const message =
        align === 'justify'
          ? `${am(locale, one ? 'alignJustifyOne' : 'alignJustifyMany', vars)} ${am(locale, 'alignJustifyRecommend')}`
          : `${am(locale, one ? 'alignRightOne' : 'alignRightMany', vars)} ${am(locale, 'alignRightRecommend')}`
      hits.push({
        kind: 'advisory',
        basis: align === 'justify' ? O3P10_SPACING : G03_RIGHT,
        related: align === 'justify' ? [webaimReference('Letter spacing, word spacing, and justification'), WCAG_148] : [gaiaReference('G03')],
        impact: 'hurdle',
        source: 'rule',
        ref: first.node.ref,
        message,
        evidence: first.fact.sample,
        subject: `${align}|${columnOf(page, first.node)}`,
        facts: { ...groupFacts(group, viewport), textAlign: first.fact.align, direction: first.fact.direction },
        confidence: 'high',
      })
    }
    // Right alignment meets 1.4.8 (technique C19); only justified text is beyond the target.
    if (justified.length > 0) hits.push(beyond(justified, 'justified', amPlural(locale, 'beyondJustified', justified.length), viewport))
    return { ran: true, candidates: candidates.length, hits, notes }
  },
}

export const lineHeight: AdvisoryCheck = {
  id: 'coga/line-height',
  version: '1',
  maturity: 'experimental',
  pattern: 'o3p10',
  gaia: ['G03'],
  surfaces: ['web'],

  run({ page, locale }): CheckRun {
    const facts = presentationOf(page)
    if (!facts) return notMeasured(page)
    const viewport = viewportOf(facts)
    const candidates = blocksOf(page, facts).filter((block) => isLongBlock(block) && lineRatio(block.fact) !== undefined)
    const ratioOf = (block: Block) => lineRatio(block.fact) as number
    const tight = candidates.filter((block) => ratioOf(block) < TIGHT_RATIO)
    const underAaa = candidates.filter((block) => ratioOf(block) < AAA_RATIO)
    const notes: string[] = []
    const hits: AdvisoryHit[] = []
    for (const group of capGroups(
      groupBy(tight, (block) => `${columnOf(page, block.node)}|${ratioOf(block)}`),
      MAX_GROUPS,
      'coga/line-height',
      locale,
      notes,
    )) {
      const first = group[0] as Block
      const ratio = ratioOf(first)
      const vars = {
        count: group.length,
        gap: number(first.fact.lineGap ?? 0, locale),
        size: number(first.fact.fontSize, locale),
        ratio: number(ratio, locale),
        lineHeight: first.fact.lineHeight,
        sample: first.fact.sample,
      }
      hits.push({
        kind: 'advisory',
        basis: O3P10_SPACING,
        related: [gaiaReference('G03'), webaimReference('Line height'), WCAG_148],
        impact: 'hurdle',
        source: 'rule',
        ref: first.node.ref,
        message: `${am(locale, group.length === 1 ? 'lineHeightOne' : 'lineHeightMany', vars)} ${am(locale, 'lineHeightRecommend')}`,
        evidence: first.fact.sample,
        subject: columnOf(page, first.node),
        facts: { ...groupFacts(group, viewport), lineGap: first.fact.lineGap ?? 0, fontSize: first.fact.fontSize, ratio, lineHeight: first.fact.lineHeight },
        confidence: 'high',
      })
    }
    if (underAaa.length > 0) {
      const lowest = Math.min(...underAaa.map(ratioOf))
      hits.push(beyond(underAaa, 'spacing', amPlural(locale, 'beyondSpacing', underAaa.length, { ratio: number(lowest, locale) }), viewport))
    }
    return { ran: true, candidates: candidates.length, hits, notes }
  },
}

export const textEmphasis: AdvisoryCheck = {
  id: 'coga/text-emphasis',
  version: '1',
  maturity: 'experimental',
  gaia: ['G03'],
  surfaces: ['web'],

  run({ page, locale }): CheckRun {
    const facts = presentationOf(page)
    if (!facts) return notMeasured(page)
    const viewport = viewportOf(facts)
    const blocks = blocksOf(page, facts)
    // Scripts without case (CJK, Arabic, Hebrew) have no capitals; a few letters are not a passage.
    const caps = blocks.filter((block) => block.fact.words > CAPS_WORDS && block.fact.cased >= 20 && block.fact.upper / block.fact.cased >= ENTIRE_SHARE)
    const italic = blocks.filter((block) => block.fact.words > ITALIC_WORDS && block.fact.letters > 0 && block.fact.italic / block.fact.letters >= ENTIRE_SHARE)
    const notes: string[] = []
    const hits: AdvisoryHit[] = []
    const groups = [
      ...groupBy(caps, (block) => columnOf(page, block.node)).map((group) => ({ group, style: 'caps' as const })),
      ...groupBy(italic, (block) => columnOf(page, block.node)).map((group) => ({ group, style: 'italic' as const })),
    ]
    for (const { group, style } of capGroups(
      groups.map((entry) => [entry]),
      MAX_GROUPS,
      'coga/text-emphasis',
      locale,
      notes,
    ).map((entry) => entry[0] as (typeof groups)[number])) {
      const first = group[0] as Block
      const by = first.fact.capsBy ?? 'text'
      const vars = { count: group.length, words: first.fact.words, sample: first.fact.sample, by: am(locale, `capsBy_${by}`) }
      const one = group.length === 1
      hits.push({
        kind: 'advisory',
        basis: style === 'caps' ? G03_CAPS : WEBAIM_ITALIC,
        related: style === 'caps' ? [webaimReference('Use stylistic differences to highlight important content, but do so conservatively')] : [gaiaReference('G03')],
        impact: 'hurdle',
        source: 'rule',
        ref: first.node.ref,
        message:
          style === 'caps'
            ? `${am(locale, one ? 'capsOne' : 'capsMany', vars)} ${am(locale, 'capsRecommend')}`
            : `${am(locale, one ? 'italicOne' : 'italicMany', vars)} ${am(locale, 'italicRecommend')}`,
        evidence: first.fact.sample,
        subject: `${style}|${columnOf(page, first.node)}`,
        facts: {
          ...groupFacts(group, viewport),
          style,
          ...(style === 'caps' ? { capsBy: by, upper: first.fact.upper, cased: first.fact.cased } : { italic: first.fact.italic, letters: first.fact.letters }),
        },
        confidence: 'high',
      })
    }
    return { ran: true, candidates: blocks.length, hits, notes }
  },
}

/**
 * Decorative families, by kind: a short list of the fonts COGA's "cartoon font or gothic" and GAIA's "fontes fantasia"
 * describe, as browsers and font services commonly offer them. Serif fonts are never on it: GAIA prefers sans-serif,
 * but neither COGA nor WebAIM does, and the evidence on serifs is mixed. "Gothic" means blackletter here: Century
 * Gothic, MS Gothic and Franklin Gothic are sans-serif faces and stay off the list.
 */
export const DECORATIVE_FONTS: Readonly<Record<string, 'cartoon' | 'script' | 'blackletter' | 'display'>> = {
  'comic sans ms': 'cartoon',
  'comic sans': 'cartoon',
  chalkboard: 'cartoon',
  'chalkboard se': 'cartoon',
  chalkduster: 'cartoon',
  'marker felt': 'cartoon',
  'kristen itc': 'cartoon',
  jokerman: 'cartoon',
  bangers: 'cartoon',
  'luckiest guy': 'cartoon',
  'brush script mt': 'script',
  'brush script std': 'script',
  lobster: 'script',
  pacifico: 'script',
  'dancing script': 'script',
  'great vibes': 'script',
  sacramento: 'script',
  satisfy: 'script',
  'kaushan script': 'script',
  'lucida handwriting': 'script',
  'segoe script': 'script',
  'segoe print': 'script',
  mistral: 'script',
  vivaldi: 'script',
  'edwardian script itc': 'script',
  'freestyle script': 'script',
  'french script mt': 'script',
  'monotype corsiva': 'script',
  zapfino: 'script',
  'apple chancery': 'script',
  'snell roundhand': 'script',
  'bradley hand': 'script',
  'permanent marker': 'script',
  'indie flower': 'script',
  'shadows into light': 'script',
  'old english text mt': 'blackletter',
  unifrakturmaguntia: 'blackletter',
  unifrakturcook: 'blackletter',
  'pirata one': 'blackletter',
  'grenze gotisch': 'blackletter',
  papyrus: 'display',
  'curlz mt': 'display',
}

/** The kind of a family on the list, matching variants such as "Comic Sans MS Bold". */
export function decorativeKind(family: string | undefined): (typeof DECORATIVE_FONTS)[string] | undefined {
  const name = (family ?? '').toLowerCase().replace(/["']/g, '').trim()
  if (!name) return undefined
  const exact = DECORATIVE_FONTS[name]
  if (exact) return exact
  const prefix = Object.keys(DECORATIVE_FONTS).find((known) => name.startsWith(`${known} `))
  return prefix ? DECORATIVE_FONTS[prefix] : undefined
}

/**
 * Whether a block's font is decorative, and how Rampa knows. The font the browser drew wins when it was read over CDP;
 * a list that falls to the generic cursive or fantasy family is the author's choice of a decorative face whatever this
 * machine drew it with, so it counts either way, at medium confidence when the font drawn here is not decorative.
 */
export function decorativeOf(fact: Block['fact']): { what: 'generic' | 'named'; family: string; kind?: string; drawn?: string; confirmed: boolean } | undefined {
  const drawn = fact.platformFont
  const generic = fact.font.toLowerCase()
  if (generic === 'cursive' || generic === 'fantasy') {
    return { what: 'generic', family: generic, ...(drawn ? { drawn } : {}), confirmed: drawn === undefined || decorativeKind(drawn) !== undefined }
  }
  const named = drawn ?? fact.font
  const kind = decorativeKind(named)
  return kind ? { what: 'named', family: named, kind, ...(drawn ? { drawn } : {}), confirmed: true } : undefined
}

export const decorativeFont: AdvisoryCheck = {
  id: 'coga/decorative-font',
  version: '1',
  maturity: 'experimental',
  pattern: 'o8p04',
  gaia: ['G03', 'G09'],
  surfaces: ['web'],

  run({ page, locale }): CheckRun {
    const facts = presentationOf(page)
    if (!facts) return notMeasured(page)
    const viewport = viewportOf(facts)
    const candidates = blocksOf(page, facts).filter((block) => block.fact.words >= FONT_WORDS || (isCjk(block) && block.fact.chars >= 60))
    const decorative = candidates.flatMap((block) => {
      const found = decorativeOf(block.fact)
      return found ? [{ block, found }] : []
    })
    const notes: string[] = []
    const hits: AdvisoryHit[] = []
    for (const group of capGroups(
      groupBy(decorative, (entry) => `${entry.found.family}|${entry.found.drawn ?? ''}`),
      MAX_GROUPS,
      'coga/decorative-font',
      locale,
      notes,
    )) {
      const { block: first, found } = group[0] as (typeof decorative)[number]
      const what =
        found.what === 'generic' ? am(locale, 'fontGeneric', { generic: found.family }) : am(locale, 'fontNamed', { font: found.family, kind: am(locale, `fontKind_${found.kind as 'cartoon'}`) })
      const drawn = found.drawn && found.drawn.toLowerCase() !== found.family.toLowerCase() ? am(locale, 'fontDrawn', { drawn: found.drawn }) : ''
      const vars = { count: group.length, what, drawn, sample: first.fact.sample }
      const blocks = group.map((entry) => entry.block)
      hits.push({
        kind: 'advisory',
        basis: O8P04,
        related: [gaiaReference('G09'), gaiaReference('G03'), webaimReference('Avoid distractions')],
        impact: 'hurdle',
        source: 'rule',
        ref: first.node.ref,
        message: `${am(locale, group.length === 1 ? 'fontOne' : 'fontMany', vars)} ${am(locale, 'fontRecommend')}`,
        evidence: first.fact.sample,
        subject: found.family.toLowerCase(),
        pageLevel: true,
        facts: {
          ...groupFacts(blocks, viewport),
          fontFamily: first.fact.family,
          resolvedFamily: first.fact.font,
          ...(found.drawn ? { drawnWith: found.drawn } : {}),
          ...(found.kind ? { fontKind: found.kind } : { fontKind: 'generic' }),
        },
        confidence: found.confirmed ? 'high' : 'medium',
      })
    }
    return { ran: true, candidates: candidates.length, hits, notes }
  },
}

/** The checks' page, for tests: the blocks they read. */
export function readBlocks(page: Page): Block[] {
  const facts = presentationOf(page)
  return facts ? blocksOf(page, facts) : []
}
