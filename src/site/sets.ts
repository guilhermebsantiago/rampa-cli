import type { PageSet, SiteCriteriaReport } from '../core/site.ts'
import { urlFilter } from '../surfaces/crawl.ts'
import type { TemplateFacts } from './page.ts'

/** Two pages share a template when most of the links in the smaller one's header, navigation and footer are in the other's. */
const SHARED_CHROME = 0.6
const MIN_SHARED_LINKS = 2

export interface SetPage {
  url: string
  template: TemplateFacts
}

/**
 * Sets of pages to compare. Sets named in the config come first: a page goes to
 * the first set whose patterns match its path (robots.txt syntax, as --include).
 * The other pages are grouped by language and viewport, then by template: pages
 * whose header, navigation and footer links mostly overlap, chained (single
 * linkage), so a docs page with an extra sidebar stays with the home page whose
 * header it shares. Language versions are separate sets.
 */
export function proposeSets(
  pages: readonly SetPage[],
  named: Readonly<Record<string, readonly string[]>> | undefined,
  origin: string,
): Pick<SiteCriteriaReport, 'sets' | 'unassigned'> {
  const sets: PageSet[] = []
  const unassigned: SiteCriteriaReport['unassigned'] = []
  const taken = new Set<string>()

  for (const [name, patterns] of Object.entries(named ?? {})) {
    const matches = urlFilter(patterns, origin)
    if (!matches) continue
    const members = pages.filter((page) => !taken.has(page.url) && safeMatch(matches, page.url))
    for (const [viewport, list] of groupBy(members, (page) => page.template.viewport)) {
      for (const page of list) taken.add(page.url)
      if (list.length < 2) {
        // The person put it in a set of its own: nothing to compare it with, and no template set takes it.
        for (const page of list) unassigned.push({ url: page.url, reason: 'alone' })
        continue
      }
      const id = viewportCount(members) > 1 ? `config:${name}@${viewport}` : `config:${name}`
      sets.push({ id, label: name, source: 'config', lang: commonLang(list), viewport, pages: list.map((page) => page.url) })
    }
  }

  let template = 0
  const rest = pages.filter((page) => !taken.has(page.url))
  for (const [, group] of groupBy(rest, (page) => `${page.template.lang}\u0000${page.template.viewport}`)) {
    const withChrome = group.filter((page) => page.template.chromeLinks.length > 0)
    for (const page of group) if (page.template.chromeLinks.length === 0) unassigned.push({ url: page.url, reason: 'no-navigation' })
    for (const cluster of clusters(withChrome)) {
      if (cluster.length < 2) {
        unassigned.push({ url: (cluster[0] as SetPage).url, reason: 'alone' })
        continue
      }
      template++
      const first = cluster[0] as SetPage
      sets.push({
        id: `template-${template}`,
        label: `template ${template}`,
        source: 'template',
        lang: first.template.lang,
        viewport: first.template.viewport,
        pages: cluster.map((page) => page.url),
      })
    }
  }
  const order = new Map(pages.map((page, index) => [page.url, index]))
  unassigned.sort((a, b) => (order.get(a.url) ?? 0) - (order.get(b.url) ?? 0))
  return { sets, unassigned }
}

function safeMatch(matches: (url: URL) => boolean, url: string): boolean {
  try {
    return matches(new URL(url))
  } catch {
    return false
  }
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const item of items) groups.set(key(item), [...(groups.get(key(item)) ?? []), item])
  return groups
}

function viewportCount(pages: readonly SetPage[]): number {
  return new Set(pages.map((page) => page.template.viewport)).size
}

function commonLang(pages: readonly SetPage[]): string {
  const langs = new Set(pages.map((page) => page.template.lang))
  return langs.size === 1 ? ([...langs][0] ?? '') : ''
}

/** How much two pages' chrome overlaps: shared links over the smaller set of links. */
export function chromeOverlap(a: readonly string[], b: readonly string[]): { shared: number; ratio: number } {
  const other = new Set(b)
  const shared = a.filter((link) => other.has(link)).length
  return { shared, ratio: shared / Math.max(1, Math.min(a.length, b.length)) }
}

/** Connected pages, in crawl order. */
function clusters(pages: readonly SetPage[]): SetPage[][] {
  const parent = pages.map((_, index) => index)
  const find = (index: number): number => {
    let root = index
    while (parent[root] !== root) root = parent[root] as number
    parent[index] = root
    return root
  }
  for (let i = 0; i < pages.length; i++) {
    for (let j = i + 1; j < pages.length; j++) {
      const { shared, ratio } = chromeOverlap((pages[i] as SetPage).template.chromeLinks, (pages[j] as SetPage).template.chromeLinks)
      if (shared >= MIN_SHARED_LINKS && ratio >= SHARED_CHROME) parent[find(j)] = find(i)
    }
  }
  const groups = new Map<number, SetPage[]>()
  pages.forEach((page, index) => {
    const root = find(index)
    groups.set(root, [...(groups.get(root) ?? []), page])
  })
  return [...groups.values()]
}
