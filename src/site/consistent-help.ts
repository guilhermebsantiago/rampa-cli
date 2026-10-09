import type { PageSet, SiteCriterion, SiteElement, SiteFinding, SitePageFacts } from '../core/site.ts'
import { sha256 } from '../core/util.ts'
import type { Locale } from '../i18n.ts'
import type { A11yNode, A11ySnapshot } from '../snapshot/schema.ts'
import { type HelpKind, type HelpType, chatWidgetOf, helpOfItem } from './help.ts'
import { type SiteMessage, listItems, listPages, sm } from './messages.ts'
import { type Observation, compareOrders, ordersObserved, repeatedKeys } from './order.ts'
import { itemOf, nodeHtml, walkPage } from './page.ts'

/**
 * Where a token sits relative to the main content. Pages without a main
 * landmark fall back on their header and footer; anything else there is
 * `unknown` and never compared for a move.
 */
export type Zone = 'before-main' | 'after-main' | 'unknown'

/** A link, button or widget outside the main content, in document order. */
export interface Token {
  /** key@zone: the same address in the header and in the footer are two tokens. */
  id: string
  key: string
  zone: Zone
  name: string
  ref: string
  html?: string | undefined
  help?: HelpKind | undefined
}

export interface HelpFacts {
  /** The page's chrome: everything outside the main content, in document order. */
  tokens: Token[]
  /** Help mechanisms found only inside the main content. */
  inMain: Array<{ key: string; name: string; ref: string; help: HelpKind }>
}

export function helpFacts(snapshot: A11ySnapshot): HelpFacts {
  const visits = walkPage(snapshot)
  const hasMain = visits.some((visit) => visit.region === 'main')
  const tokens: Token[] = []
  const inMain: HelpFacts['inMain'] = []
  const inWidget = new Set<A11yNode>()
  const mark = (node: A11yNode) => {
    inWidget.add(node)
    for (const child of node.children) mark(child)
  }
  for (const visit of visits) {
    const { node } = visit
    if (inWidget.has(node)) continue
    const zone: Zone = hasMain
      ? visit.afterMain
        ? 'after-main'
        : 'before-main'
      : visit.region === 'banner'
        ? 'before-main'
        : visit.region === 'contentinfo'
          ? 'after-main'
          : 'unknown'
    const vendor = chatWidgetOf(node)
    if (vendor) {
      mark(node)
      const key = `chat:${vendor}`
      const help: HelpKind = { type: 'chat', certain: true }
      if (visit.inMain) inMain.push({ key, name: vendor, ref: node.ref, help })
      else tokens.push({ id: `${key}@${zone}`, key, zone, name: vendor, ref: node.ref, html: nodeHtml(node), help })
      continue
    }
    const item = itemOf(node, snapshot.target)
    if (!item) continue
    const help = helpOfItem(item)
    if (visit.inMain) {
      if (help) inMain.push({ key: item.key, name: item.name, ref: item.ref, help })
      continue
    }
    tokens.push({ id: `${item.key}@${zone}`, key: item.key, zone, name: item.name, ref: item.ref, html: item.html, help })
  }
  return { tokens, inMain }
}

const TYPE_LABEL: Record<HelpType, SiteMessage> = {
  'contact-details': 'contactDetails',
  'human-contact': 'humanContact',
  'self-help': 'selfHelp',
  chat: 'chat',
}

/** A help mechanism changed place when it is out of order with at least this share of what surrounds it. */
const MOVED = 0.5

/** WCAG 3.2.6: help repeated on pages of a set keeps its order relative to the rest of the page. */
export const consistentHelp: SiteCriterion<HelpFacts> = {
  id: '3.2.6',
  level: 'A',
  name: { en: 'Consistent Help', 'pt-BR': 'Ajuda consistente' },
  version: '1',
  maturity: 'experimental',
  facts: helpFacts,
  compare(set, pages, locale) {
    const findings: SiteFinding[] = []
    const kinds = new Map<string, { help: HelpKind; name: string }>()
    for (const page of pages) {
      for (const token of page.facts.tokens) if (token.help && !kinds.has(token.key)) kinds.set(token.key, { help: token.help, name: token.name })
      for (const entry of page.facts.inMain) if (!kinds.has(entry.key)) kinds.set(entry.key, { help: entry.help, name: entry.name })
    }
    let compared = 0
    for (const [key, kind] of kinds) {
      const withChrome = pages.filter((page) => page.facts.tokens.some((token) => token.key === key))
      const onlyInMain = pages.filter((page) => !withChrome.includes(page) && page.facts.inMain.some((entry) => entry.key === key))
      if (withChrome.length >= 1 && onlyInMain.length >= 1 && withChrome.length + onlyInMain.length >= 2) {
        findings.push(inMainReview(key, kind, set, withChrome, onlyInMain, locale))
      }
      if (withChrome.length < 2) continue
      compared++
      const moved = zoneMove(key, kind, set, withChrome, locale)
      if (moved) {
        findings.push(moved)
        continue
      }
      for (const zone of ['before-main', 'after-main', 'unknown'] as const) {
        const finding = orderChange(key, zone, kind, set, withChrome, locale)
        if (finding) findings.push(finding)
      }
    }
    return { compared, findings }
  },
}

function subjectOf(kind: { help: HelpKind; name: string }, key: string, locale: Locale): { subject: string; named: string } {
  const address = key.startsWith('chat:') ? '' : ` (${key})`
  return { subject: sm(locale, TYPE_LABEL[kind.help.type]), named: `“${kind.name}”${kind.name === key ? '' : address}` }
}

function base(
  key: string,
  detail: string,
  kind: { help: HelpKind },
  set: PageSet,
): Pick<SiteFinding, 'fingerprint' | 'criterion' | 'level' | 'source' | 'set' | 'experimental'> {
  return {
    fingerprint: sha256(['3.2.6', key, detail].join('|')).slice(0, 12),
    criterion: '3.2.6',
    level: 'A',
    source: 'site',
    set: set.id,
    experimental: consistentHelp.maturity === 'experimental',
  }
}

/** The help is before the main content on some pages and after it on others. */
function zoneMove(key: string, kind: { help: HelpKind; name: string }, set: PageSet, pages: ReadonlyArray<SitePageFacts<HelpFacts>>, locale: Locale): SiteFinding | undefined {
  const zonesOf = (page: SitePageFacts<HelpFacts>) => [
    ...new Set(page.facts.tokens.filter((token) => token.key === key && token.zone !== 'unknown').map((token) => token.zone)),
  ]
  const signatures = new Map<string, string[]>()
  for (const page of pages) {
    const zones = zonesOf(page)
    if (zones.length === 0) continue
    const id = zones.sort().join('+')
    signatures.set(id, [...(signatures.get(id) ?? []), page.url])
  }
  if (signatures.size < 2) return undefined
  const ranked = [...signatures.entries()].sort((a, b) => b[1].length - a[1].length)
  const [majorityId, majorityPages] = ranked[0] as [string, string[]]
  const majority = new Set(majorityId.split('+'))
  const disjoint = ranked.slice(1).filter(([id]) => !id.split('+').some((zone) => majority.has(zone)))
  if (disjoint.length === 0) return undefined
  const tie = (disjoint[0] as [string, string[]])[1].length === majorityPages.length
  const flagged = disjoint.flatMap(([, list]) => list)
  const zoneA = sm(locale, (disjoint[0] as [string, string[]])[0].split('+')[0] as Zone)
  const zoneB = sm(locale, majorityId.split('+')[0] as Zone)
  const { subject, named } = subjectOf(kind, key, locale)
  const status = kind.help.certain ? 'failure' : 'review'
  const message = [
    tie
      ? sm(locale, 'helpMovedTie', { subject, named, zoneA, zoneB, pages: listPages([...flagged, ...majorityPages], locale) })
      : sm(locale, 'helpMoved', { subject, named, zoneA, zoneB, pages: listPages(flagged, locale), others: listPages(majorityPages, locale) }),
    status === 'failure' ? sm(locale, 'helpFix') : sm(locale, 'reviewByName'),
  ].join(' ')
  const observed = ranked.map(([id, list]) => ({ pages: list, order: id.split('+').map((zone) => sm(locale, zone as Zone)) }))
  const elements: SiteElement[] = []
  for (const page of pages) {
    if (![...flagged, majorityPages[0]].includes(page.url)) continue
    for (const token of page.facts.tokens) if (token.key === key) elements.push({ page: page.url, ref: token.ref, name: token.name, html: token.html })
  }
  return {
    ...base(key, 'zone', kind, set),
    status,
    subject: `${subject} ${named}`,
    message,
    evidence: observed.map((entry) => sm(locale, 'zone', { zone: entry.order.join(' + '), pages: listPages(entry.pages, locale) })).join(' · '),
    pages: tie ? [...flagged, ...majorityPages] : flagged,
    comparedWith: tie ? [] : majorityPages,
    items: [kind.name],
    elements: elements.slice(0, 24),
    observed,
    confidence: tie ? 'medium' : 'high',
  }
}

/** Within one zone, the help is out of order with most of what repeats around it. */
function orderChange(
  key: string,
  zone: Zone,
  kind: { help: HelpKind; name: string },
  set: PageSet,
  pages: ReadonlyArray<SitePageFacts<HelpFacts>>,
  locale: Locale,
): SiteFinding | undefined {
  const id = `${key}@${zone}`
  const members = pages.filter((page) => page.facts.tokens.some((token) => token.id === id))
  if (members.length < 2) return undefined
  const orders = members.map((page) => page.facts.tokens.filter((token) => token.zone === zone).map((token) => token.id))
  const repeated = repeatedKeys(orders)
  if (repeated.has(id)) return undefined
  const observations: Observation[] = members.map((page, index) => ({ page: page.url, order: (orders[index] as string[]).filter((token) => !repeated.has(token)) }))
  const comparison = compareOrders(observations, new Set([id]))
  if (comparison.inverted.length === 0) return undefined

  let flagged = comparison.deviants.filter((page) => {
    const tally = comparison.perPage.get(page)
    return tally !== undefined && tally.compared > 0 && tally.minority / tally.compared >= MOVED
  })
  let tie = false
  if (flagged.length === 0 && comparison.deviants.length === 0 && comparison.ties.length > 0) {
    // Two pages, or as many one way as the other: the help moved if most of its pairs flipped.
    const involved = [...new Set(comparison.ties.flatMap((pair) => [...pair.aFirst, ...pair.bFirst]))]
    const most = Math.max(...involved.map((page) => comparison.perPage.get(page)?.compared ?? 0))
    if (most > 0 && comparison.ties.length / most >= MOVED) {
      flagged = involved
      tie = true
    }
  }
  if (flagged.length === 0) return undefined
  const others = members.map((page) => page.url).filter((page) => !flagged.includes(page))

  const names = new Map<string, string>()
  for (const page of members) for (const token of page.facts.tokens) if (!names.has(token.id)) names.set(token.id, token.name)
  const anchors = [...new Set(comparison.inverted.map((pair) => (pair.a === id ? pair.b : pair.a)))]
  const shown = [id, ...anchors.slice(0, 6)]
  const observed = ordersObserved(observations, shown).map((entry) => ({ pages: entry.pages, order: entry.order.map((token) => names.get(token) ?? token) }))
  const { subject, named } = subjectOf(kind, key, locale)
  const items = anchors.map((anchor) => names.get(anchor) ?? anchor)
  const status = kind.help.certain ? 'failure' : 'review'
  const message = [
    tie
      ? sm(locale, 'helpOrderTie', { subject, named, items: listItems(items, locale), pages: listPages(flagged, locale) })
      : sm(locale, 'helpOrder', { subject, named, items: listItems(items, locale), pages: listPages(flagged, locale), others: listPages(others, locale) }),
    status === 'failure' ? sm(locale, 'helpFix') : sm(locale, 'reviewByName'),
  ].join(' ')
  const elements: SiteElement[] = []
  for (const page of members) {
    if (!flagged.includes(page.url) && page.url !== others[0]) continue
    for (const token of page.facts.tokens) if (shown.includes(token.id)) elements.push({ page: page.url, ref: token.ref, name: token.name, html: token.id === id ? token.html : undefined })
  }
  return {
    ...base(key, `order@${zone}`, kind, set),
    status,
    subject: `${subject} ${named}`,
    message,
    evidence: observed.map((entry) => sm(locale, 'order', { pages: listPages(entry.pages, locale), order: entry.order.join(' → ') })).join(' · '),
    pages: flagged,
    comparedWith: others,
    items,
    elements: elements.slice(0, 24),
    observed,
    confidence: tie ? 'medium' : 'high',
  }
}

/** In the chrome on some pages and only inside the main content on others: maybe moved, maybe a mention in the text. */
function inMainReview(
  key: string,
  kind: { help: HelpKind; name: string },
  set: PageSet,
  withChrome: ReadonlyArray<SitePageFacts<HelpFacts>>,
  onlyInMain: ReadonlyArray<SitePageFacts<HelpFacts>>,
  locale: Locale,
): SiteFinding {
  const { subject, named } = subjectOf(kind, key, locale)
  const pages = onlyInMain.map((page) => page.url)
  const others = withChrome.map((page) => page.url)
  const elements: SiteElement[] = [
    ...onlyInMain.slice(0, 3).flatMap((page) => page.facts.inMain.filter((entry) => entry.key === key).map((entry) => ({ page: page.url, ref: entry.ref, name: entry.name }))),
    ...withChrome.slice(0, 1).flatMap((page) => page.facts.tokens.filter((token) => token.key === key).map((token) => ({ page: page.url, ref: token.ref, name: token.name }))),
  ]
  const zone = withChrome[0]?.facts.tokens.find((token) => token.key === key)?.zone ?? 'unknown'
  const observed = [
    { pages: others, order: [sm(locale, zone)] },
    { pages, order: [sm(locale, 'mainContent')] },
  ]
  return {
    ...base(key, 'in-main', kind, set),
    status: 'review',
    subject: `${subject} ${named}`,
    message: sm(locale, 'helpInMain', { subject, named, pages: listPages(pages, locale), others: listPages(others, locale) }),
    evidence: observed.map((entry) => sm(locale, 'zone', { zone: entry.order.join(''), pages: listPages(entry.pages, locale) })).join(' · '),
    pages,
    comparedWith: others,
    items: [kind.name],
    elements: elements.slice(0, 24),
    observed,
    confidence: 'low',
  }
}
