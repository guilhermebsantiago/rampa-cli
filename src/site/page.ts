import type { A11yNode, A11ySnapshot } from '../snapshot/schema.ts'
import { normalizeForMatch, primarySubtag, truncate } from '../core/util.ts'

/**
 * Reading a page for the criteria that compare pages: where each link sits
 * (header, navigation, main content, footer), what it points to, and in what
 * order. Pure functions of the snapshot.
 */

/** The landmark a node sits in at the top level of the page. Main content is told apart from the page's chrome. */
export type Region = 'banner' | 'navigation' | 'main' | 'complementary' | 'contentinfo' | 'none'

/** Roles that scope a header or footer to a section, so it is not the page's banner or contentinfo (HTML-AAM). */
const SECTIONING = new Set(['main', 'article', 'complementary', 'navigation', 'region'])

export interface Visit {
  node: A11yNode
  /** Preorder position in the document. */
  index: number
  /** The outermost landmark around the node, or the node's own when it is one. */
  region: Region
  /** Inside the page's first main landmark. */
  inMain: boolean
  /** After the end of the first main landmark. */
  afterMain: boolean
  /** The node is aria-hidden or not rendered, itself or through an ancestor. */
  hidden: boolean
}

/** Walks are cached by the tree they walk: every site criterion reads the same page. */
const walks = new WeakMap<A11yNode, Visit[]>()
const componentCache = new WeakMap<A11yNode, Map<string, Component[]>>()

/** Every node in document order, with its region. */
export function walkPage(snapshot: A11ySnapshot): Visit[] {
  const cached = walks.get(snapshot.root)
  if (cached) return cached
  const visits: Visit[] = []
  walks.set(snapshot.root, visits)
  let mainSeen = false
  let mainDone = false
  const walk = (node: A11yNode, region: Region, scoped: boolean, inMain: boolean, hidden: boolean): void => {
    let ownRegion = region
    let nowInMain = inMain
    let startedMain = false
    const role = node.role
    if (region === 'none') {
      if (role === 'main' && !mainSeen) {
        ownRegion = 'main'
        nowInMain = true
        mainSeen = true
        startedMain = true
      } else if (role === 'navigation' || role === 'complementary') ownRegion = role
      else if ((role === 'banner' || role === 'contentinfo') && !scoped) ownRegion = role
    }
    const nowHidden = hidden || node.states.includes('hidden') || node.states.includes('aria-hidden')
    visits.push({ node, index: visits.length, region: ownRegion, inMain: nowInMain, afterMain: mainDone && !nowInMain, hidden: nowHidden })
    const nowScoped = scoped || SECTIONING.has(role)
    for (const child of node.children) walk(child, ownRegion, nowScoped, nowInMain, nowHidden)
    if (startedMain) mainDone = true
  }
  walk(snapshot.root, 'none', false, false, false)
  return visits
}

function attribute(node: A11yNode, name: string): string | undefined {
  const attributes = node.native.attributes as Record<string, unknown> | undefined
  const value = attributes?.[name]
  return typeof value === 'string' ? value : undefined
}

export function nodeHtml(node: A11yNode): string | undefined {
  return typeof node.native.html === 'string' ? truncate(node.native.html, 300) : undefined
}

export function nameOf(node: A11yNode): string {
  return (node.name ?? node.text ?? '').replace(/\s+/g, ' ').trim()
}

/**
 * Where an address leads, the same from any page of the site: `about` on /docs/
 * and `/docs/about` are one place. A fragment is kept, resolved against the page,
 * so `#how` on / and `/#how` elsewhere match. A trailing slash is dropped.
 */
export function addressKey(href: string, page: string): string | undefined {
  const raw = href.trim()
  if (raw === '' || raw === '#' || /^javascript:/i.test(raw)) return undefined
  try {
    const url = new URL(raw, page)
    if (url.protocol === 'mailto:') return `mailto:${decodeURIComponent(url.pathname).toLowerCase()}`
    if (url.protocol === 'tel:' || url.protocol === 'sms:') return `${url.protocol}${url.pathname.replace(/[^\d+]/g, '')}`
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return `${url.protocol}${url.pathname}`
    const path = url.pathname.replace(/\/+$/, '') || '/'
    const sameOrigin = (() => {
      try {
        return new URL(page).origin === url.origin
      } catch {
        return false
      }
    })()
    return `${sameOrigin ? '' : url.origin}${path}${url.search}${url.hash === '#' ? '' : url.hash}`
  } catch {
    return undefined
  }
}

const ITEM_ROLES = new Set(['link', 'button', 'menuitem', 'tab'])

/** A link or button a person can use to go somewhere, keyed by where it leads (or, for a button, by its name). */
export interface Item {
  key: string
  name: string
  ref: string
  html?: string | undefined
  /** The address as written, for links. */
  href?: string | undefined
}

export function itemOf(node: A11yNode, page: string): Item | undefined {
  if (!ITEM_ROLES.has(node.role)) return undefined
  const name = nameOf(node)
  const href = attribute(node, 'href')
  const linkKey = href !== undefined ? addressKey(href, page) : undefined
  const key = linkKey ?? (name ? `${node.role}:${normalizeForMatch(name)}` : undefined)
  if (!key) return undefined
  return { key, name: name || (href ?? key), ref: node.ref, html: nodeHtml(node), href }
}

export interface Component {
  kind: 'navigation' | 'banner' | 'contentinfo'
  ref: string
  /** The landmark's own accessible name (aria-label), when it has one. */
  name: string
  hidden: boolean
  items: Item[]
}

/**
 * The navigation blocks of a page: each outermost navigation landmark, and the
 * links of the header and footer outside any navigation landmark when there are
 * two or more of them.
 */
export function navigationComponents(snapshot: A11ySnapshot): Component[] {
  const page = snapshot.target
  const byPage = componentCache.get(snapshot.root) ?? new Map<string, Component[]>()
  componentCache.set(snapshot.root, byPage)
  const cached = byPage.get(page)
  if (cached) return cached
  const visits = walkPage(snapshot)
  const components: Component[] = []
  byPage.set(page, components)
  const collect = (root: A11yNode, skipNavigation: boolean): Item[] => {
    const items: Item[] = []
    const walk = (node: A11yNode) => {
      if (node !== root && skipNavigation && node.role === 'navigation') return
      const item = itemOf(node, page)
      if (item) items.push(item)
      for (const child of node.children) walk(child)
    }
    walk(root)
    return items
  }
  for (const visit of visits) {
    const { node } = visit
    // A navigation landmark counts wherever it is, a docs sidebar inside main included; a header or footer only at the top level.
    const outermost = (role: string) => node.role === role && visit.region === role && !hasAncestor(node, role, visits)
    if (node.role === 'navigation' && !hasAncestor(node, 'navigation', visits)) {
      components.push({ kind: 'navigation', ref: node.ref, name: nameOf(node), hidden: visit.hidden, items: collect(node, false) })
    } else if (outermost('banner') || outermost('contentinfo')) {
      const items = collect(node, true)
      if (items.length >= 2) components.push({ kind: node.role as 'banner' | 'contentinfo', ref: node.ref, name: nameOf(node), hidden: visit.hidden, items })
    }
  }
  return components
}

/** Parents are not recorded in the tree; a map from each child to its parent answers ancestry. */
const parents = new WeakMap<readonly Visit[], Map<A11yNode, A11yNode>>()

function parentMap(visits: readonly Visit[]): Map<A11yNode, A11yNode> {
  let map = parents.get(visits)
  if (!map) {
    map = new Map()
    for (const visit of visits) for (const child of visit.node.children) map.set(child, visit.node)
    parents.set(visits, map)
  }
  return map
}

function hasAncestor(node: A11yNode, role: string, visits: readonly Visit[]): boolean {
  const map = parentMap(visits)
  for (let current = map.get(node); current; current = map.get(current)) if (current.role === role) return true
  return false
}

/**
 * What a finding's fingerprint keeps of its set: a named set's name, or a proposed
 * set's language and viewport, which stay the same when the crawl finds other pages.
 */
export function setIdentity(set: { source: 'config' | 'template'; label: string; lang: string; viewport: string }): string {
  return set.source === 'config' ? `config:${set.label}@${set.viewport}` : `${set.lang}@${set.viewport}`
}

/** What sets are proposed from: the page's language, its viewport, and the addresses its header, navigation and footer link to. */
export interface TemplateFacts {
  lang: string
  viewport: string
  chromeLinks: string[]
}

export function templateFacts(snapshot: A11ySnapshot): TemplateFacts {
  const components = navigationComponents(snapshot)
  const links = new Set<string>()
  for (const component of components) for (const item of component.items) if (item.href !== undefined) links.add(item.key)
  return {
    lang: primarySubtag(snapshot.locale ?? ''),
    viewport: `${snapshot.viewport.width}×${snapshot.viewport.height}`,
    chromeLinks: [...links],
  }
}
