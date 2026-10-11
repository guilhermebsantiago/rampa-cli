import type { SiteCriterion, SiteFinding } from '../core/site.ts'
import { normalizeForMatch, sha256 } from '../core/util.ts'
import type { A11ySnapshot } from '../snapshot/schema.ts'
import { listPages, sm } from './messages.ts'
import { nameOf, setIdentity, walkPage } from './page.ts'

/**
 * WCAG 2.4.2 Page Titled, across pages: titles that several pages of a language share. A title tells pages apart
 * when it says what is specific to each, so pages with one title and different content need review. It never fails
 * a page: a shared title can still describe each page's purpose (two steps of one form). The same content at two
 * addresses (`/` and `/index.html`) is one page, not a shared title. A single-page app that keeps its title when its
 * route changes shows here too: every page the crawl loaded by its address has the same title.
 */

export interface TitleFacts {
  title: string
  /** The document's ref, which findings cite. */
  ref: string
  /** A hash of the main content's text (or of the page's text outside its header, navigation and footer). */
  content: string
}

export function titleFacts(snapshot: A11ySnapshot): TitleFacts {
  const visits = walkPage(snapshot)
  const hasMain = visits.some((visit) => visit.region === 'main')
  const parts: string[] = []
  let length = 0
  for (const visit of visits) {
    if (visit.hidden || length > 4000) continue
    const inside = hasMain ? visit.inMain : visit.region === 'none'
    if (!inside) continue
    const text = visit.node.text?.trim() || (visit.node.role === 'img' ? nameOf(visit.node) : '')
    if (!text) continue
    parts.push(text)
    length += text.length
  }
  return { title: (snapshot.title ?? '').replace(/\s+/g, ' ').trim(), ref: snapshot.root.ref, content: sha256(normalizeForMatch(parts.join(' ')).slice(0, 4000)).slice(0, 16) }
}

export const pageTitles: SiteCriterion<TitleFacts> = {
  id: '2.4.2',
  level: 'A',
  name: { en: 'Page Titled', 'pt-BR': 'Página com título' },
  version: '1',
  maturity: 'experimental',
  scope: 'language',
  reviewOnly: true,
  facts: titleFacts,
  compare(set, pages, locale) {
    const titled = pages.filter((page) => page.facts.title !== '')
    const byTitle = new Map<string, typeof titled>()
    for (const page of titled) {
      const key = normalizeForMatch(page.facts.title)
      byTitle.set(key, [...(byTitle.get(key) ?? []), page])
    }
    const findings: SiteFinding[] = []
    for (const [key, group] of byTitle) {
      // Pages with the same content are one page at two addresses: their shared title is no problem.
      if (group.length < 2 || new Set(group.map((page) => page.facts.content)).size < 2) continue
      const title = `“${(group[0] as (typeof group)[number]).facts.title}”`
      const urls = group.map((page) => page.url)
      const all = group.length === titled.length && titled.length >= 3
      const message = [
        all ? sm(locale, 'titleAll', { title, count: group.length }) : sm(locale, 'titleShared', { title, count: group.length, pages: listPages(urls, locale) }),
        sm(locale, 'titleReview'),
      ].join(' ')
      findings.push({
        fingerprint: sha256(['2.4.2', setIdentity(set), key].join('|')).slice(0, 12),
        criterion: '2.4.2',
        level: 'A',
        source: 'site',
        status: 'review',
        set: set.id,
        subject: sm(locale, 'titleSubject', { title }),
        message,
        evidence: sm(locale, 'titleOn', { title, pages: listPages(urls, locale) }),
        pages: urls,
        comparedWith: [],
        items: [(group[0] as (typeof group)[number]).facts.title],
        elements: group.slice(0, 6).map((page) => ({ page: page.url, ref: page.facts.ref, name: page.facts.title })),
        observed: [{ pages: urls, order: [(group[0] as (typeof group)[number]).facts.title] }],
        confidence: 'low',
        experimental: pageTitles.maturity === 'experimental',
      })
    }
    return { compared: titled.length, findings }
  },
}
