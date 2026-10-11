import type { SiteCriterion, SiteElement } from '../core/site.ts'
import { sha256 } from '../core/util.ts'
import type { A11yNode, A11ySnapshot } from '../snapshot/schema.ts'
import { SEARCH_ACTION, SEARCH_NAMES, fold } from './identification.ts'
import { type SiteMessage, listPages, sm } from './messages.ts'
import { addressKey, nameOf, navigationComponents, setIdentity, walkPage } from './page.ts'

/**
 * WCAG 2.4.5 Multiple Ways (AA): more than one way to locate a page within a set of pages, except a page that is a
 * step in a process. Rampa never fails it: a crawl is never known to hold every page, and which pages are steps of a
 * process is the author's to say. It lists, for each language of the crawl, the ways it found on each page (search, a
 * site map link, a navigation menu, a table of contents, related links, breadcrumbs) and which pages the navigation
 * of another page links to, so a person can check that each page can be found in two ways.
 */

export type Way = 'search' | 'siteMap' | 'navigation' | 'toc' | 'related' | 'breadcrumb'

export interface WaysFacts {
  ways: Way[]
  /** Pages of the site the page's header, navigation and footer link to (path and query, no fragment). */
  linksTo: string[]
  /** The page's own address as those links name it. */
  self: string
  /** Where each way was found, by its ref. */
  refs: Partial<Record<Way, string>>
}

const SITE_MAP_PATH = /(?:^|\/)(?:site-?map|mapa-?do-?site|mapa-?del-?sitio|mapa-?web|plan-du-site)(?:\.(?:html?|php|aspx?))?\/?$/i
const SITE_MAP_NAME = /\b(?:site ?map|mapa do site|mapa del sitio|mapa web|plan du site)\b/
const TOC_NAME = /\b(?:table of contents|contents|sumario|indice|conteudo|contenido|tabla de contenidos)\b/
const RELATED_NAME =
  /\b(?:related|see also|you may also like|more (?:articles|posts|stories|from)|read next|further reading|veja tambem|leia tambem|relacionad[oa]s|saiba mais sobre|mais (?:lidas|noticias)|articulos relacionados|ver tambien|lee tambien)\b/
const BREADCRUMB = /breadcrumb|\btrilha\b|migalha|voce esta aqui|you are here|ruta de navegacion|miga de pan|fil d.ariane/

const attribute = (node: A11yNode, name: string): string | undefined => {
  const value = (node.native.attributes as Record<string, unknown> | undefined)?.[name]
  return typeof value === 'string' ? value : undefined
}

function linksIn(node: A11yNode): A11yNode[] {
  const links: A11yNode[] = []
  const visit = (current: A11yNode) => {
    if (current.role === 'link' && attribute(current, 'href') !== undefined) links.push(current)
    for (const child of current.children) visit(child)
  }
  visit(node)
  return links
}

/** An address as `addressKey` writes it, without its fragment, and a folder's index page as the folder. */
function samePage(key: string): string {
  return (
    key
      .replace(/#.*$/, '')
      .replace(/\/index\.(?:html?|php|aspx?)(?=$|\?)/i, '')
      .replace(/\/+(?=$|\?)/, '') || '/'
  )
}

function pageKey(href: string, page: string): string | undefined {
  const key = addressKey(href, page)
  return key === undefined ? undefined : samePage(key)
}

export function waysFacts(snapshot: A11ySnapshot): WaysFacts {
  const page = snapshot.target
  const self = pageKey(page, page) ?? '/'
  const visits = walkPage(snapshot)
  const found = new Map<Way, string>()
  const parents = new Map<A11yNode, A11yNode>()
  for (const visit of visits) for (const child of visit.node.children) parents.set(child, visit.node)
  for (const visit of visits) {
    const { node } = visit
    if (visit.hidden && node.role !== 'navigation') continue
    const name = fold(nameOf(node))
    const href = attribute(node, 'href')
    const classes = fold(attribute(node, 'class') ?? '')
    if (!found.has('search')) {
      const field = node.role === 'searchbox' || ((node.role === 'textbox' || node.role === 'combobox') && SEARCH_NAMES.has((attribute(node, 'name') ?? '').toLowerCase()))
      const form = (node.role === 'form' && SEARCH_ACTION.test(attribute(node, 'action') ?? '')) || node.role === 'search' || node.native.tag === 'search'
      if (field || form) found.set('search', node.ref)
    }
    if (!found.has('siteMap') && node.role === 'link' && href !== undefined) {
      let path = ''
      try {
        path = new URL(href, page).pathname
      } catch {
        path = ''
      }
      if ((SITE_MAP_PATH.test(path) && !/\.xml$/i.test(path)) || SITE_MAP_NAME.test(name)) found.set('siteMap', node.ref)
    }
    if (!found.has('breadcrumb') && (node.role === 'navigation' || node.role === 'list') && (BREADCRUMB.test(name) || BREADCRUMB.test(classes))) found.set('breadcrumb', node.ref)
    // A table of contents of the set (G64), such as a docs sidebar: links to other pages of the site, named as contents or
    // in a navigation beside the content. A list of the page's own sections helps within the page, not to find it.
    if (!found.has('toc') && ['navigation', 'list', 'complementary', 'region'].includes(node.role)) {
      const others = new Set(
        linksIn(node).flatMap((link) => {
          const key = pageKey(attribute(link, 'href') ?? '', page)
          return key?.startsWith('/') && key !== self ? [key] : []
        }),
      )
      const sidebar = node.role === 'navigation' && (visit.region === 'main' || visit.region === 'complementary')
      if ((TOC_NAME.test(name) || sidebar) && others.size >= 3) found.set('toc', node.ref)
    }
    if (!found.has('related')) {
      const heading = node.role === 'heading' && RELATED_NAME.test(name)
      // An aside or a section named so; a navigation bar named "Related" (Sphinx) is the site's navigation.
      const landmark = ['complementary', 'region'].includes(node.role) && RELATED_NAME.test(name)
      const area = heading ? parents.get(node) : landmark ? node : undefined
      if (area && linksIn(area).length >= 2) found.set('related', node.ref)
    }
  }
  const linksTo = new Set<string>()
  let menuLinks = 0
  for (const component of navigationComponents(snapshot)) {
    for (const item of component.items) {
      if (item.href === undefined || !item.key.startsWith('/')) continue
      linksTo.add(samePage(item.key))
      if (component.kind === 'navigation' || component.kind === 'banner') menuLinks++
    }
    if (!found.has('navigation') && (component.kind === 'navigation' || component.kind === 'banner') && component.items.length >= 3) found.set('navigation', component.ref)
  }
  if (menuLinks < 3) found.delete('navigation')
  const order: Way[] = ['navigation', 'search', 'siteMap', 'toc', 'related', 'breadcrumb']
  return {
    ways: order.filter((way) => found.has(way)),
    linksTo: [...linksTo],
    self,
    refs: Object.fromEntries(found) as Partial<Record<Way, string>>,
  }
}

const WAY_WORD: Record<Way, SiteMessage> = {
  navigation: 'wayNavigation',
  search: 'waySearch',
  siteMap: 'waySiteMap',
  toc: 'wayToc',
  related: 'wayRelated',
  breadcrumb: 'wayBreadcrumb',
}

export const multipleWays: SiteCriterion<WaysFacts> = {
  id: '2.4.5',
  level: 'AA',
  name: { en: 'Multiple Ways', 'pt-BR': 'Várias formas' },
  version: '1',
  maturity: 'experimental',
  scope: 'language',
  reviewOnly: true,
  facts: waysFacts,
  compare(set, pages, locale) {
    const total = pages.length
    const order: Way[] = ['navigation', 'search', 'siteMap', 'toc', 'related', 'breadcrumb']
    const withWay = new Map(order.map((way) => [way, pages.filter((page) => page.facts.ways.includes(way))]))
    const linked = pages.filter((page) => pages.some((other) => other !== page && other.facts.linksTo.includes(page.facts.self)))
    const notLinked = pages.filter((page) => !linked.includes(page)).map((page) => page.url)
    const list = order.map((way) => sm(locale, 'wayCount', { way: sm(locale, WAY_WORD[way]), count: withWay.get(way)?.length ?? 0 })).join(', ')
    const linkedLine = sm(locale, 'waysLinked', { count: linked.length, total })
    const evidence = [
      ...order.map((way) => {
        const found = withWay.get(way) ?? []
        return sm(locale, 'waysOn', { way: sm(locale, WAY_WORD[way]), count: found.length, total, pages: found.length > 0 ? `: ${listPages(found.map((page) => page.url), locale)}` : '' })
      }),
      ...(notLinked.length > 0 ? [sm(locale, 'waysNotLinked', { pages: listPages(notLinked, locale) })] : []),
    ]
    const elements: SiteElement[] = []
    for (const way of order) {
      const page = withWay.get(way)?.[0]
      const ref = page?.facts.refs[way]
      if (page && ref) elements.push({ page: page.url, ref, name: sm(locale, WAY_WORD[way]) })
    }
    return {
      compared: total,
      findings: [
        {
          fingerprint: sha256(['2.4.5', setIdentity(set)].join('|')).slice(0, 12),
          criterion: '2.4.5',
          level: 'AA',
          source: 'site',
          status: 'review',
          set: set.id,
          subject: sm(locale, 'waysSubject'),
          message: sm(locale, 'waysMessage', { count: total, list: `${list}; ${linkedLine}` }),
          evidence: evidence.join('\n'),
          pages: pages.map((page) => page.url),
          comparedWith: [],
          items: order.filter((way) => (withWay.get(way)?.length ?? 0) > 0).map((way) => sm(locale, WAY_WORD[way])),
          elements,
          observed: order.map((way) => ({ pages: (withWay.get(way) ?? []).map((page) => page.url), order: [sm(locale, WAY_WORD[way])] })),
          confidence: 'low',
          experimental: multipleWays.maturity === 'experimental',
        },
      ],
    }
  },
}
