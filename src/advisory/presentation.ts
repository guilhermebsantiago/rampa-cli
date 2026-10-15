import { shown } from '../criteria/labels-or-instructions.ts'
import type { Locale } from '../i18n.ts'
import type { A11yNode, Presentation, TextBlockFacts } from '../snapshot/schema.ts'
import type { CheckRun } from './check.ts'
import { am, amPlural } from './messages.ts'
import { type Page, ancestorsOf, languageOf, parentOf, tagOf } from './page.ts'

/**
 * What the legibility, icon and new-window checks share: the presentation facts the collector measured in the browser
 * (`snapshot.presentation`, surfaces/presentation.ts), joined to the nodes of the tree, and how results are grouped and
 * capped so one page design does not produce a flood. Pure functions over the snapshot: a saved snapshot gives the
 * same advisories offline.
 */

/** The versions of the presentation facts these checks read. */
export const PRESENTATION_VERSIONS: readonly string[] = ['1']

export const NO_PRESENTATION = 'no presentation facts in the snapshot: it was recorded without --profile cognitive, or before Rampa measured them'

/** Groups listed per check and page; the rest are counted in a note. */
export const MAX_GROUPS = 5
export const MAX_CONTROL_GROUPS = 10

/** A check cannot run on a snapshot without the facts, or with facts of a version it does not read. */
export function presentationOf(page: Page): Presentation | undefined {
  const facts = page.snapshot.presentation
  return facts && PRESENTATION_VERSIONS.includes(facts.version) ? facts : undefined
}

export function notMeasured(page: Page): CheckRun {
  const facts = page.snapshot.presentation
  const reason = facts ? `presentation facts of version ${facts.version}, which this check does not read` : NO_PRESENTATION
  return { ran: false, reason, candidates: 0, hits: [] }
}

/** The node a fact names, when it is in the tree and shown: a scoped check leaves the rest out. */
export function nodeOf(page: Page, ref: string): A11yNode | undefined {
  const node = page.index.get(ref)?.node
  return node && shown(node) && !node.states.includes('aria-hidden') ? node : undefined
}

export interface Block {
  fact: TextBlockFacts
  node: A11yNode
  language: string
}

export function blocksOf(page: Page, facts: Presentation): Block[] {
  const out: Block[] = []
  for (const fact of facts.blocks) {
    const node = nodeOf(page, fact.ref)
    if (node) out.push({ fact, node, language: languageOf(page, node) })
  }
  return out
}

/** Chinese, Japanese or Korean text, which WCAG 1.4.8 measures at half the width. */
export function isCjk(block: Block): boolean {
  return block.fact.script === 'cjk' || /^(zh|ja|ko)\b/i.test(block.language)
}

/**
 * Reading text long enough for its lines to matter: at least 3 lines at this viewport (2 before the last, which is
 * usually short), and at least 25 words (60 characters in CJK, which does not separate words with spaces).
 */
export function isLongBlock(block: Block): boolean {
  const { fact } = block
  return fact.lines >= 3 && (fact.words >= 25 || (isCjk(block) && fact.chars >= 60))
}

/** Line height as drawn over font size: the distance between lines, `normal` included. */
export function lineRatio(fact: TextBlockFacts): number | undefined {
  if (fact.lineGap === undefined || fact.fontSize <= 0) return undefined
  return Math.round((fact.lineGap / fact.fontSize) * 100) / 100
}

/** Items in groups by key, in the order the first of each appears. */
export function groupBy<T>(items: readonly T[], key: (item: T) => string): T[][] {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const k = key(item)
    const group = groups.get(k)
    if (group) group.push(item)
    else groups.set(k, [item])
  }
  return [...groups.values()]
}

/**
 * Blocks of one column: the same left edge and width on the page, to 8 px, as the paragraphs of an article are even when
 * each section wraps its own (Wikipedia's); the same parent element when the snapshot has no boxes.
 */
export function columnOf(page: Page, node: A11yNode): string {
  const box = node.bounds
  return box ? `${Math.round(box.x / 8)}|${Math.round(box.width / 8)}` : (parentOf(page, node)?.ref ?? node.ref)
}

/** What names a column in a fingerprint: the first block's parent element, which a change of layout does not move. */
export function columnSubject(page: Page, node: A11yNode): string {
  return parentOf(page, node)?.ref ?? node.ref
}

const REGION_TAGS = new Set(['nav', 'header', 'footer', 'aside', 'form', 'menu'])
const REGION_ROLES = new Set(['navigation', 'banner', 'contentinfo', 'complementary', 'form', 'search', 'toolbar', 'menubar', 'menu', 'tablist'])
const LIST_TAGS = new Set(['ul', 'ol', 'dl', 'table'])

/** A navigation, header, footer, aside, form, toolbar or menu: a part of the page whose controls belong together. */
export function isRegion(node: A11yNode): boolean {
  return REGION_TAGS.has(tagOf(node)) || REGION_ROLES.has(node.role)
}

/**
 * Where repeated controls belong together: the closest navigation, header, footer, aside, form, toolbar or menu, else
 * the closest list or table, else the element's parent. A row of social icons or the links of a footer are one group.
 */
export function regionOf(page: Page, node: A11yNode): A11yNode | undefined {
  const ancestors = ancestorsOf(page, node)
  return (
    ancestors.find(isRegion) ??
    ancestors.find((ancestor) => LIST_TAGS.has(tagOf(ancestor))) ??
    ancestors[0]
  )
}

export function viewportOf(facts: Presentation): string {
  return `${facts.viewport.width}×${facts.viewport.height}`
}

/** The first groups, up to the cap, and a note saying how many more there were. */
export function capGroups<T>(groups: T[][], max: number, check: string, locale: Locale, notes: string[]): T[][] {
  if (groups.length > max) notes.push(amPlural(locale, 'leftOutGroups', groups.length - max, { check, max }))
  return groups.slice(0, max)
}

/** A note when the collector stopped measuring at its cap. */
export function leftOutNote(facts: Presentation, what: 'blocks' | 'controls' | 'links', locale: Locale): string | undefined {
  const count = facts.leftOut[what]
  return count > 0 ? am(locale, 'leftOutFacts', { max: facts[what].length, count, what: am(locale, `what_${what}`) }) : undefined
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
}

/** Up to `max` names, quoted, each once with how many times it repeats, cut at 60 characters, and how many more. */
export function quotedList(names: readonly string[], max = 6): string {
  const counts = new Map<string, number>()
  for (const name of names) {
    const short = name.length > 60 ? `${name.slice(0, 59)}…` : name
    counts.set(short, (counts.get(short) ?? 0) + 1)
  }
  const entries = [...counts].map(([name, count]) => (count > 1 ? `"${name}" ×${count}` : `"${name}"`))
  return entries.length > max ? `${entries.slice(0, max).join(', ')}, +${entries.length - max}` : entries.join(', ')
}
