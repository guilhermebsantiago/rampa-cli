import type { PageSet, SiteCriterion, SiteElement, SiteFinding, SitePageFacts } from '../core/site.ts'
import { normalizeForMatch, sha256, truncate } from '../core/util.ts'
import type { Locale } from '../i18n.ts'
import { matchNode } from '../probes/identity.ts'
import { type SkipActivation, type SkipLinkData, type SkipStop, SKIP_LINK_VARIANT, SKIP_LINK_VERSION, pressable } from '../probes/bypass.ts'
import type { A11yNode, A11ySnapshot } from '../snapshot/schema.ts'
import { indexTree } from '../snapshot/tree.ts'
import { listItems, listPages, pathOf } from './messages.ts'
import { type Region, setIdentity, walkPage } from './page.ts'

/**
 * 2.4.1 Bypass Blocks. What a page offers to pass the blocks that repeat on every page (a header, a menu, a
 * sidebar) and reach its own content, read from the snapshot: landmarks, headings, links into the page, and,
 * when the skip-link probe ran, whether those links work. Two uses:
 *
 * - across the pages of a crawl (the site criterion below), a block is repeated when its text is on other
 *   pages too, as ACT cf77f2 defines "block of repeated content"; a page fails when such a block comes
 *   before its own content and nothing lets someone pass it;
 * - on a single page (the probe rule rampa/bypass-blocks), what repeats can only be guessed (header and
 *   navigation landmarks, links before the first text), so the result is at most an item to review.
 */

export type UnitKind = 'link' | 'control' | 'text' | 'heading' | 'image'

/** One piece of perceivable content, in document order: a link or control (with its text), a heading, an image, a text. */
export interface BypassUnit {
  /** Preorder position of its node in the page. */
  i: number
  kind: UnitKind
  /** The normalized text, hashed: equal keys on two pages are the same content. */
  key: string
  name: string
  /** Characters of text. */
  chars: number
  ref: string
  region: Region
  /** The outermost landmark other than main around it, by its place in `landmarks`. */
  landmark?: number | undefined
}

export interface BypassAnchor {
  i: number
  ref: string
  name: string
  fragment: string
  /** The element the fragment names: its position and the position of its last descendant. */
  target?: { i: number; end: number; ref: string } | undefined
  /** What the skip-link probe found when it pressed the link: undefined when it did not run or did not press it. */
  verdict?: SkipVerdict | undefined
}

export interface BypassFacts {
  units: BypassUnit[]
  /** The page has more units than were kept. */
  cut: boolean
  landmarks: Array<{ role: string; i: number; end: number; ref: string }>
  anchors: BypassAnchor[]
  /** Controls that may move focus or hide a block, which no probe tries: a "skip" button, a menu toggle. */
  unverified: Array<{ i: number; ref: string; name: string; kind: 'skip' | 'toggle' }>
  /** Skip links the probe found with a problem, and links it found named like one that point nowhere. */
  probed: Array<{ ref: string; name: string; fragment: string; verdict: SkipVerdict }>
}

const MAX_UNITS = 800
const CONTROL_ROLES = new Set([
  'link', 'button', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab', 'checkbox', 'radio', 'switch', 'textbox', 'searchbox', 'combobox', 'listbox', 'slider', 'spinbutton', 'treeitem',
])
/** ARIA landmarks; region and form only when named, as browsers expose them. */
const LANDMARKS = new Set(['main', 'navigation', 'banner', 'contentinfo', 'complementary', 'search'])
const NAMED_LANDMARKS = new Set(['region', 'form'])
const SKIP_WORDS =
  /\b(skip|jump)\b|\b(go|move) (straight |directly )?to (the )?(main|content|navigation)\b|\bpul(ar|e)\b|\bsaltar\b|\bir (para|direto|diretamente|al|a la)\b.{0,20}\b(conte[uú]do|principal|navega[cç][aã]o|contenido|menu|menú)\b|\bconte[uú]do principal\b|\bcontenido principal\b|\bmain content\b/i
const TOGGLE_WORDS =
  /^(menu|menú|main menu|site menu|navigation|navegação|navegación)$|\b(toggle|show|hide|collapse|expand|open|close|mostrar|ocultar|esconder|exibir|abrir|fechar|alternar|cerrar)\b.{0,30}\b(menu|menú|navigation|navegação|navegación|nav|table of contents?|contents|índice|sumário|sidebar|barra lateral)\b/i

const keyOf = (text: string) => sha256(normalizeForMatch(text).toLowerCase().slice(0, 200)).slice(0, 12)
const textOf = (node: A11yNode) => (node.name ?? node.text ?? '').replace(/\s+/g, ' ').trim()
const attribute = (node: A11yNode, name: string): string | undefined => {
  const value = (node.native.attributes as Record<string, unknown> | undefined)?.[name]
  return typeof value === 'string' ? value : undefined
}

/** The position of each node's last descendant, by its preorder position. */
function subtreeEnds(root: A11yNode): Map<A11yNode, number> {
  const ends = new Map<A11yNode, number>()
  let index = -1
  const visit = (node: A11yNode): number => {
    index++
    let last = index
    for (const child of node.children) last = visit(child)
    ends.set(node, last)
    return last
  }
  visit(root)
  return ends
}

/** The fragment an in-page link points to, or undefined for a link to another page or a route (#/about). */
export function inPageFragment(href: string, page: string): string | undefined {
  const raw = href.trim()
  let url: URL
  try {
    url = new URL(raw, page)
  } catch {
    return undefined
  }
  if (!raw.startsWith('#')) {
    try {
      const here = new URL(page)
      if (url.origin !== here.origin || url.pathname !== here.pathname || url.search !== here.search) return undefined
    } catch {
      return undefined
    }
  }
  if (url.hash.length <= 1) return undefined
  let fragment = url.hash.slice(1)
  try {
    fragment = decodeURIComponent(fragment)
  } catch {
    // Kept as written.
  }
  return /^[/!]/.test(fragment) ? undefined : fragment
}

/** What 2.4.1 reads of one page. Pure: a saved snapshot gives the same facts. */
export function bypassFacts(snapshot: A11ySnapshot): BypassFacts {
  const visits = walkPage(snapshot)
  const ends = subtreeEnds(snapshot.root)
  const endOf = (node: A11yNode, i: number) => ends.get(node) ?? i
  const units: BypassUnit[] = []
  const landmarks: BypassFacts['landmarks'] = []
  const linkVisits: Array<{ i: number; node: A11yNode }> = []
  const unverifiedCandidates: Array<{ i: number; node: A11yNode }> = []
  const byId = new Map<string, { i: number; node: A11yNode }>()
  const byName = new Map<string, { i: number; node: A11yNode }>()
  let cut = false
  let skipUntil = -1
  for (const visit of visits) {
    const { node, index: i } = visit
    const id = attribute(node, 'id')
    if (id && !byId.has(id)) byId.set(id, { i, node })
    const anchorName = node.native.tag === 'a' ? attribute(node, 'name') : undefined
    if (anchorName && !byName.has(anchorName)) byName.set(anchorName, { i, node })
    if (visit.hidden) continue
    const named = textOf(node) !== ''
    // A header or footer inside an article or a section is not the page's banner or contentinfo (HTML-AAM).
    const scoped = (node.role === 'banner' || node.role === 'contentinfo') && visit.region !== node.role
    if ((LANDMARKS.has(node.role) && !scoped) || (NAMED_LANDMARKS.has(node.role) && (node.name ?? '').trim() !== '')) landmarks.push({ role: node.role, i, end: endOf(node, i), ref: node.ref })
    if (node.role === 'link' && attribute(node, 'href') !== undefined) linkVisits.push({ i, node })
    if (node.role === 'button' || (node.role === 'link' && named)) unverifiedCandidates.push({ i, node })
    if (i <= skipUntil) continue
    let kind: UnitKind | undefined
    let text = ''
    if (CONTROL_ROLES.has(node.role)) {
      kind = node.role === 'link' ? 'link' : 'control'
      text = textOf(node) || (node.role === 'link' ? `link ${attribute(node, 'href') ?? ''}` : node.role)
      // A control's text is its name: what is inside is not counted again.
      skipUntil = endOf(node, i)
    } else if (node.role === 'heading') {
      kind = 'heading'
      text = textOf(node)
      skipUntil = endOf(node, i)
    } else if (node.role === 'img') {
      if (node.name?.trim()) {
        kind = 'image'
        text = node.name
      }
    } else if (node.text?.trim()) {
      kind = 'text'
      text = node.text
    }
    if (!kind || text.trim() === '') continue
    if (units.length >= MAX_UNITS) {
      cut = true
      continue
    }
    const clean = text.replace(/\s+/g, ' ').trim()
    const around = landmarks.findIndex((landmark) => landmark.role !== 'main' && landmark.i <= i && landmark.end >= i)
    units.push({ i, kind, key: keyOf(clean), name: truncate(clean, 60), chars: clean.length, ref: node.ref, region: visit.region, ...(around >= 0 ? { landmark: around } : {}) })
  }

  const anchors: BypassAnchor[] = []
  for (const { i, node } of linkVisits) {
    const fragment = inPageFragment(attribute(node, 'href') ?? '', snapshot.target)
    if (fragment === undefined) continue
    const target = byId.get(fragment) ?? byName.get(fragment)
    anchors.push({ i, ref: node.ref, name: truncate(textOf(node), 60), fragment, ...(target ? { target: { i: target.i, end: endOf(target.node, target.i), ref: target.node.ref } } : {}) })
  }
  // The skip-link probe, when it ran: what happened when each link was pressed.
  const probed: BypassFacts['probed'] = []
  const record = snapshot.observations?.probes.find((probe) => probe.kind === 'keyboard' && probe.conditions.variant === SKIP_LINK_VARIANT && probe.version === SKIP_LINK_VERSION && probe.status !== 'skipped')
  const data = record?.data as Partial<SkipLinkData> | undefined
  if (data && Array.isArray(data.stops)) {
    const index = indexTree(snapshot.root)
    const activations = Array.isArray(data.activations) ? data.activations : []
    for (const stop of data.stops) {
      if (!stop?.el || stop.fragment === undefined) continue
      const verdict = skipVerdict(
        stop,
        activations.find((activation) => activation?.n === stop.n),
        data.stops.find((candidate) => candidate?.n === stop.n + 1),
      )
      if (!verdict) continue
      const node = matchNode(index, stop.el.ref, stop.el.id)
      if (!node) continue
      const anchor = anchors.find((candidate) => candidate.ref === node.ref)
      if (anchor) anchor.verdict = verdict
      if (verdict.problem) probed.push({ ref: node.ref, name: truncate(textOf(node) || stop.el.label, 60), fragment: stop.fragment, verdict })
    }
  }
  const anchorRefs = new Set(anchors.filter((anchor) => anchor.target).map((anchor) => anchor.ref))
  const unverified: BypassFacts['unverified'] = []
  // A link the probe pressed, or found pointing nowhere, has a verdict: it is no longer a control Rampa cannot try.
  const tried = new Set(probed.map((link) => link.ref))
  for (const { i, node } of unverifiedCandidates) {
    if (anchorRefs.has(node.ref) || tried.has(node.ref)) continue
    const name = textOf(node)
    if (SKIP_WORDS.test(name)) unverified.push({ i, ref: node.ref, name: truncate(name, 60), kind: 'skip' })
    else if (TOGGLE_WORDS.test(name)) unverified.push({ i, ref: node.ref, name: truncate(name, 60), kind: 'toggle' })
  }

  return { units, cut, landmarks, anchors, unverified, probed }
}

export type SkipProblem = 'hidden-on-focus' | 'no-target' | 'not-moved' | 'navigated'

/** What pressing a link into the page did: works means focus or the next Tab went to its target or past it. */
export interface SkipVerdict {
  works: boolean
  problem?: SkipProblem | undefined
  /** Elements the link skips. */
  between?: number | undefined
}

/**
 * The probe's facts about one link turned into a verdict. Thresholds live here, not in the probe. A link named
 * like a skip link whose fragment names nothing does not work; a link that was not pressed (the budget) has no
 * verdict. Pressed, it works when focus landed on or in the target, or the next Tab landed in or after it, or Tab
 * left the page while elements lay between the link and the target. With nothing between them, any sign that
 * the page went to the fragment counts. A link that works but never showed on screen works for screen reader
 * users only: hidden-on-focus.
 */
export function skipVerdict(stop: SkipStop, activation: SkipActivation | undefined, nextStop?: SkipStop): SkipVerdict | undefined {
  if (stop.target === null) return stop.skipWords ? { works: false, problem: 'no-target' } : undefined
  if (!pressable(stop) || !activation || activation.mismatch) return undefined
  if (activation.navigated) return { works: false, problem: 'navigated', between: stop.between }
  const between = stop.between ?? 0
  const relation = activation.next?.relation
  const went = activation.next?.el?.ref
  // Where Tab went from the link before it was pressed: going there again means focus did not move.
  const asBefore = between > 0 && went !== undefined && went === nextStop?.el?.ref
  const moved =
    activation.focus === 'target' ||
    activation.focus === 'inside-target' ||
    relation === 'inside' ||
    relation === 'after' ||
    (!asBefore && relation === 'none' && between > 0) ||
    // Nothing to reach inside or after the target: from there Tab leaves the page or wraps to its top.
    (!asBefore && stop.after === 0 && (relation === 'same' || relation === 'before' || relation === 'none')) ||
    (between === 0 && (activation.hash === `#${stop.fragment}` || (activation.scrolledBy ?? 0) !== 0 || activation.targetInView === true))
  if (!moved) return { works: false, problem: 'not-moved', between }
  return stop.shown === false ? { works: true, problem: 'hidden-on-focus', between } : { works: true, between }
}

export type BypassStatus = 'fail' | 'review' | 'pass' | 'none'

export interface BypassJudgment {
  status: BypassStatus
  /** Why nothing applied: no repeated content, nothing after it, too little of it, or the page was cut. */
  reason?: 'nothing-repeated' | 'nothing-after' | 'small' | 'cut' | undefined
  /** The repeated units at the start of the first repeated block. */
  block: BypassUnit[]
  /** The first unit after the block that is not repeated: where the page's own content starts. */
  content?: BypassUnit | undefined
  /** What lets someone pass the block: 'main landmark', 'heading “…”', 'link “Skip to content” → #main'. */
  mechanisms: string[]
  /** Controls that may pass it, which Rampa cannot try. */
  unverified: BypassFacts['unverified']
}

/** At least this much repeated content before the page's own content: two links or controls, or 40 characters. */
const MIN_FOCUSABLE = 2
const MIN_CHARS = 40

/**
 * ACT cf77f2 on one page, given what repeats: the first block of repeated content followed by content that is
 * not repeated must be passable by a landmark that holds that content, a heading in it, or a link into the page
 * that lands there. Each is read leniently (any landmark that starts after the block begins and holds content
 * of the page's own; any heading of the page's own after the block; a link whose target holds or leads to such
 * content), so a failure means none of them is there at all.
 */
export function judgeBypass(facts: BypassFacts, repeatedUnit: (unit: BypassUnit) => boolean): BypassJudgment {
  const units = facts.units
  // A landmark (a menu, a header) whose content mostly repeats is a repeated block as a whole: one link of its own
  // (the current section, a cart count) does not make it content.
  const shares = new Map<number, { repeated: number; total: number }>()
  for (const unit of units) {
    if (unit.landmark === undefined) continue
    const share = shares.get(unit.landmark) ?? { repeated: 0, total: 0 }
    share.total++
    if (repeatedUnit(unit)) share.repeated++
    shares.set(unit.landmark, share)
  }
  const repeated = (unit: BypassUnit) => {
    if (repeatedUnit(unit)) return true
    const share = unit.landmark === undefined ? undefined : shares.get(unit.landmark)
    return share !== undefined && share.repeated * 2 > share.total
  }
  const first = units.findIndex(repeated)
  if (first < 0) return { status: 'none', reason: 'nothing-repeated', block: [], mechanisms: [], unverified: [] }
  let last = first
  while (last + 1 < units.length && repeated(units[last + 1] as BypassUnit)) last++
  const block = units.slice(first, last + 1)
  const content = units[last + 1]
  if (!content) return { status: 'none', reason: facts.cut ? 'cut' : 'nothing-after', block, mechanisms: [], unverified: [] }
  const focusable = block.filter((unit) => unit.kind === 'link' || unit.kind === 'control').length
  const chars = block.reduce((sum, unit) => sum + unit.chars, 0)
  if (focusable < MIN_FOCUSABLE && chars < MIN_CHARS) return { status: 'none', reason: 'small', block, content, mechanisms: [], unverified: [] }

  const start = (block[0] as BypassUnit).i
  const blockEnd = (block.at(-1) as BypassUnit).i
  const own = (from: number, to: number) => units.some((unit) => unit.i >= from && unit.i <= to && unit.i > blockEnd && !repeated(unit))
  const mechanisms: string[] = []
  for (const landmark of facts.landmarks) {
    if (landmark.i <= start) continue
    // A landmark around where the page's own content starts; or a main landmark after the block with content of the
    // page's own, even when something else of its own (a breadcrumb) comes first.
    const holdsContent = landmark.i <= content.i && landmark.end >= content.i
    if (holdsContent || (landmark.role === 'main' && own(landmark.i, landmark.end))) mechanisms.push(`${landmark.role} landmark`)
  }
  for (const unit of units) {
    if (unit.kind === 'heading' && unit.i > blockEnd && !repeated(unit)) {
      mechanisms.push(`heading “${unit.name}”`)
      break
    }
  }
  for (const anchor of facts.anchors) {
    const target = anchor.target
    if (!target || target.i <= start || anchor.verdict?.works === false) continue
    // Focus lands on content of the page's own, or in an element that holds where it starts.
    const next = units.find((unit) => unit.i >= target.i)
    const holdsContent = target.i <= content.i && target.end >= content.i
    if ((next && !repeated(next) && next.i > blockEnd) || holdsContent) mechanisms.push(`link “${anchor.name}” → #${anchor.fragment}`)
  }
  const unverified = facts.unverified.filter((control) => control.i < content.i)
  const status: BypassStatus = mechanisms.length > 0 ? 'pass' : unverified.length > 0 ? 'review' : 'fail'
  return { status, block, content, mechanisms: [...new Set(mechanisms)], unverified }
}

// Across the pages of a crawl.

const TEXT: Record<Locale, { subject: string; fail: string; review: string; evidence: string; none: string; broken: string; reviewLine: string }> = {
  en: {
    subject: 'Blocks repeated before the content',
    fail: 'On {pages}, {block} repeat on other pages of the site and come before the page’s own content, and nothing lets someone pass them: no skip link to the content, no landmark around it, no heading at its start (WCAG 2.4.1, ACT cf77f2). Add a “Skip to main content” link first in the page, pointing to a main landmark (G1, ARIA11).',
    review: 'On {pages}, {block} repeat on other pages and come before the page’s own content. Rampa found no skip link, landmark or heading to pass them, only controls it cannot try ({controls}). Check that one of them moves focus past the block or hides it (2.4.1).',
    evidence: 'on {page}: {count} repeated item(s) before the content ({items}); the content starts at “{content}”',
    none: 'no landmark, heading or skip link after them',
    broken: 'the skip link {name} (#{fragment}) did not work when pressed',
    reviewLine: 'on {page}: may pass them: {controls}',
  },
  'pt-BR': {
    subject: 'Blocos repetidos antes do conteúdo',
    fail: 'Em {pages}, {block} se repetem em outras páginas do site e vêm antes do conteúdo da própria página, e nada permite pulá-los: nenhum link para pular ao conteúdo, nenhum landmark em volta dele, nenhum título no seu início (WCAG 2.4.1, ACT cf77f2). Coloque um link “Pular para o conteúdo principal” como primeiro elemento da página, apontando para um landmark main (G1, ARIA11).',
    review: 'Em {pages}, {block} se repetem em outras páginas e vêm antes do conteúdo da própria página. O Rampa não achou link de pular, landmark ou título para passá-los, só controles que ele não pode testar ({controls}). Confira se algum deles leva o foco para depois do bloco ou o esconde (2.4.1).',
    evidence: 'em {page}: {count} item(ns) repetido(s) antes do conteúdo ({items}); o conteúdo começa em “{content}”',
    none: 'nenhum landmark, título ou link de pular depois deles',
    broken: 'o link de pular {name} (#{fragment}) não funcionou ao ser acionado',
    reviewLine: 'em {page}: podem passá-los: {controls}',
  },
}

const fill = (template: string, vars: Record<string, string | number>) => template.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`))

function blockWords(block: readonly BypassUnit[], locale: Locale): string {
  const links = block.filter((unit) => unit.kind === 'link' || unit.kind === 'control').length
  const others = block.length - links
  if (locale === 'pt-BR') return [links > 0 ? `${links} link(s) e controle(s)` : '', others > 0 ? `${others} texto(s)` : ''].filter(Boolean).join(' e ')
  return [links > 0 ? `${links} link(s) and control(s)` : '', others > 0 ? `${others} text(s)` : ''].filter(Boolean).join(' and ')
}

export interface PageBypass {
  url: string
  judgment: BypassJudgment
  facts: BypassFacts
}

/**
 * WCAG 2.4.1 across pages: a block is repeated when its text is on another page of the same language and
 * viewport. A page fails when a repeated block of some size comes before its own content and the page has no
 * landmark, heading or link into the page that passes it, and no control Rampa cannot try that might. A single
 * page can never fail: what repeats needs other pages to tell.
 */
export const bypassBlocks: SiteCriterion<BypassFacts> = {
  id: '2.4.1',
  level: 'A',
  name: { en: 'Bypass Blocks', 'pt-BR': 'Ignorar blocos' },
  version: '1',
  maturity: 'experimental',
  act: ['cf77f2'],
  scope: 'language',
  facts: (snapshot) => bypassFacts(snapshot),
  compare(set, pages, locale) {
    const judged = judgeSet(pages)
    const findings: SiteFinding[] = []
    const failing = judged.filter((page) => page.judgment.status === 'fail')
    const reviewing = judged.filter((page) => page.judgment.status === 'review')
    if (failing.length > 0) findings.push(siteFinding('failure', failing, judged, set, locale))
    if (reviewing.length > 0) findings.push(siteFinding('review', reviewing, judged, set, locale))
    return { compared: judged.filter((page) => page.judgment.status !== 'none').length, findings }
  },
}

/** Every page of a set judged against the others: what each repeats is what the other pages also have. */
export function judgeSet(pages: ReadonlyArray<SitePageFacts<BypassFacts>>): PageBypass[] {
  const keys = pages.map((page) => new Set(page.facts.units.map((unit) => unit.key)))
  return pages.map((page, index) => {
    const elsewhere = (unit: BypassUnit) => keys.some((set, other) => other !== index && set.has(unit.key))
    return { url: page.url, facts: page.facts, judgment: judgeBypass(page.facts, elsewhere) }
  })
}

function siteFinding(status: 'failure' | 'review', flagged: PageBypass[], all: PageBypass[], set: PageSet, locale: Locale): SiteFinding {
  const text = TEXT[locale]
  const first = flagged[0] as PageBypass
  const pages = flagged.map((page) => page.url)
  const others = all.map((page) => page.url).filter((url) => !pages.includes(url))
  const evidence: string[] = []
  for (const page of flagged.slice(0, 3)) {
    const { block, content } = page.judgment
    const line = fill(text.evidence, { page: pathOf(page.url), count: block.length, items: listItems(block.slice(0, 6).map((unit) => unit.name), locale), content: content?.name ?? '' })
    const broken = page.facts.probed.filter((link) => !link.verdict.works).map((link) => fill(text.broken, { name: `“${link.name}”`, fragment: link.fragment }))
    const controls = page.judgment.unverified.map((control) => `“${control.name}”`).join(', ')
    evidence.push(status === 'failure' ? `${line}; ${[text.none, ...broken].join('; ')}` : `${line}; ${fill(text.reviewLine, { page: pathOf(page.url), controls })}`)
  }
  const controls = [...new Set(flagged.flatMap((page) => page.judgment.unverified.map((control) => `“${control.name}”`)))].slice(0, 4).join(', ')
  const message = fill(status === 'failure' ? text.fail : text.review, { pages: listPages(pages, locale), block: blockWords(first.judgment.block, locale), controls })
  const elements: SiteElement[] = []
  for (const page of flagged.slice(0, 3)) {
    const { block, content } = page.judgment
    if (block[0]) elements.push({ page: page.url, ref: block[0].ref, name: block[0].name })
    if (content) elements.push({ page: page.url, ref: content.ref, name: content.name })
    for (const control of page.judgment.unverified.slice(0, 2)) elements.push({ page: page.url, ref: control.ref, name: control.name })
  }
  const items = first.judgment.block.slice(0, 8).map((unit) => unit.name)
  const signature = [...new Set(first.judgment.block.slice(0, 10).map((unit) => unit.key))].sort().join(',')
  return {
    fingerprint: sha256(['2.4.1', setIdentity(set), status, signature].join('|')).slice(0, 12),
    criterion: '2.4.1',
    level: 'A',
    source: 'site',
    status,
    set: set.id,
    subject: text.subject,
    message,
    evidence: evidence.join('\n'),
    pages,
    comparedWith: others,
    items,
    elements,
    observed: flagged.map((page) => ({ pages: [page.url], order: page.judgment.block.slice(0, 8).map((unit) => unit.name) })),
    confidence: 'medium',
    experimental: bypassBlocks.maturity === 'experimental',
  }
}
