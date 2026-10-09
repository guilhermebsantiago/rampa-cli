import { describe, expect, it } from 'vitest'
import { type SiteReport, siteExitCode } from '../src/core/site.ts'
import { paint } from '../src/report/color.ts'
import { renderSiteReport } from '../src/report/site.ts'
import { consistentHelp, helpFacts } from '../src/site/consistent-help.ts'
import { helpOfItem } from '../src/site/help.ts'
import { type SitePageRecord, pageSetsOf, runSiteCriteria, siteCriteriaChecked, siteFactsOf } from '../src/site/index.ts'
import { compareOrders } from '../src/site/order.ts'
import { addressKey, navigationComponents } from '../src/site/page.ts'
import type { A11yNode, A11ySnapshot } from '../src/snapshot/schema.ts'
import { describeConditions } from '../src/surfaces/browser-options.ts'
import { node } from './helpers.ts'

const ORIGIN = 'https://example.com'
const u = (path: string) => `${ORIGIN}${path}`

type Links = Array<[string, string]>

interface PageSpec {
  lang?: string
  /** Links in the header, outside any nav. */
  header?: Links
  /** Navigation landmarks inside the header. */
  nav?: Array<{ label?: string; links: Links; hidden?: boolean }>
  main?: Links
  /** Navigation inside main, such as a docs sidebar. */
  mainNav?: Links
  footer?: Links
  /** Nodes after the footer, at body level. */
  after?: A11yNode[]
  /** No landmarks at all: header and footer links in plain divs. */
  plain?: boolean
}

let counter = 0
function links(prefix: string, list: Links): A11yNode[] {
  return list.map(([name, href], index) =>
    node({
      ref: `${prefix} > a:nth-of-type(${index + 1})`,
      role: 'link',
      name,
      text: name,
      native: { tag: 'a', attributes: { href }, html: `<a href="${href}">${name}</a>` },
    }),
  )
}

function page(path: string, spec: PageSpec): A11ySnapshot {
  counter++
  const body: A11yNode[] = []
  const navs = (spec.nav ?? []).map((nav, index) =>
    node({
      ref: `header > nav:nth-of-type(${index + 1})`,
      role: 'navigation',
      name: nav.label,
      states: nav.hidden ? ['hidden'] : [],
      native: { tag: 'nav', attributes: nav.label ? { 'aria-label': nav.label } : {} },
      children: links(`header > nav:nth-of-type(${index + 1})`, nav.links),
    }),
  )
  if (spec.plain) {
    body.push(node({ ref: 'div.top', role: 'generic', native: { tag: 'div' }, children: links('div.top', [...(spec.header ?? []), ...(spec.nav ?? []).flatMap((n) => n.links)]) }))
    body.push(node({ ref: 'div.content', role: 'generic', native: { tag: 'div' }, children: links('div.content', spec.main ?? []) }))
    body.push(node({ ref: 'div.bottom', role: 'generic', native: { tag: 'div' }, children: links('div.bottom', spec.footer ?? []) }))
  } else {
    body.push(node({ ref: 'header', role: 'banner', native: { tag: 'header' }, children: [...links('header', spec.header ?? []), ...navs] }))
    const mainChildren = links('main', spec.main ?? [])
    if (spec.mainNav) {
      mainChildren.unshift(
        node({ ref: 'main > nav', role: 'navigation', name: 'Docs', native: { tag: 'nav' }, children: links('main > nav', spec.mainNav) }),
      )
    }
    body.push(node({ ref: 'main', role: 'main', native: { tag: 'main' }, children: mainChildren }))
    if (spec.footer) body.push(node({ ref: 'footer', role: 'contentinfo', native: { tag: 'footer' }, children: links('footer', spec.footer) }))
  }
  body.push(...(spec.after ?? []))
  return {
    schemaVersion: 1,
    surface: 'web',
    target: u(path),
    locale: spec.lang ?? 'en',
    viewport: { width: 1280, height: 800, scale: 1 },
    collectedAt: '2026-10-09T00:00:00.000Z',
    collector: { name: 'test', version: String(counter) },
    root: node({ ref: 'html', role: 'document', native: { tag: 'html' }, children: [node({ ref: 'body', role: 'generic', native: { tag: 'body' }, children: body })] }),
  }
}

const MAIN: Links = [
  ['Home', '/'],
  ['Docs', '/docs/'],
  ['Pricing', '/pricing'],
  ['Blog', '/blog'],
  ['Contact', '/contact'],
]
const FOOTER: Links = [
  ['Privacy', '/privacy'],
  ['Terms', '/terms'],
  ['help@example.com', 'mailto:help@example.com'],
]

function run(snapshots: A11ySnapshot[], options: Partial<Parameters<typeof runSiteCriteria>[1]> = {}) {
  const records: SitePageRecord[] = snapshots.map((snapshot) => siteFactsOf(snapshot))
  return runSiteCriteria(records, { origin: ORIGIN, locale: 'en', minConfidence: 'low', ...options })
}

const swap = (list: Links, a: number, b: number): Links => {
  const copy = [...list]
  ;[copy[a], copy[b]] = [copy[b] as [string, string], copy[a] as [string, string]]
  return copy
}

describe('relative order', () => {
  it('compares only the pairs pages share, so added and missing items never count', () => {
    const same = compareOrders([
      { page: 'a', order: ['home', 'docs', 'blog'] },
      { page: 'b', order: ['home', 'sub', 'docs', 'blog', 'rss'] },
      { page: 'c', order: ['home', 'blog'] },
    ])
    expect(same.inverted).toEqual([])
    const flipped = compareOrders([
      { page: 'a', order: ['home', 'docs', 'blog'] },
      { page: 'b', order: ['home', 'docs', 'blog'] },
      { page: 'c', order: ['home', 'blog', 'docs'] },
    ])
    expect(flipped.inverted).toEqual([{ a: 'docs', b: 'blog', aFirst: ['a', 'b'], bFirst: ['c'] }])
    expect(flipped.deviants).toEqual(['c'])
    const tie = compareOrders([
      { page: 'a', order: ['docs', 'blog'] },
      { page: 'b', order: ['blog', 'docs'] },
    ])
    expect(tie.deviants).toEqual([])
    expect(tie.ties).toHaveLength(1)
  })

  it('reads a menu item that wraps a link as the link alone', () => {
    const snapshot = page('/', { nav: [{ label: 'Main', links: MAIN.slice(0, 2) }] })
    const nav = snapshot.root.children[0]?.children[0]?.children[0] as A11yNode
    const wrapped = nav.children.map((link) => node({ ref: `${link.ref} li`, role: 'menuitem', name: link.name, children: [link] }))
    nav.children = [...wrapped, node({ ref: 'header > nav > button', role: 'menuitem', name: 'More', native: { tag: 'button' } })]
    expect(navigationComponents(snapshot)[0]?.items.map((item) => item.key)).toEqual(['/', '/docs', 'menuitem:more'])
  })

  it('resolves addresses so the same place matches from any page', () => {
    expect(addressKey('#how', u('/'))).toBe('/#how')
    expect(addressKey('/#how', u('/criteria/'))).toBe('/#how')
    expect(addressKey('about', u('/docs/'))).toBe('/docs/about')
    expect(addressKey('/pricing/', u('/'))).toBe('/pricing')
    expect(addressKey('mailto:Help@Example.com?subject=hi', u('/'))).toBe('mailto:help@example.com')
    expect(addressKey('tel:+55 (11) 5555-0100', u('/'))).toBe('tel:+551155550100')
    expect(addressKey('https://github.com/x/', u('/'))).toBe('https://github.com/x')
    expect(addressKey('#', u('/'))).toBeUndefined()
    expect(addressKey('javascript:void(0)', u('/'))).toBeUndefined()
  })
})

describe('3.2.3 Consistent Navigation', () => {
  it('finds nothing when the navigation keeps its order, with items added, removed or a sub-navigation added', () => {
    const report = run([
      page('/', { nav: [{ label: 'Main', links: MAIN }], footer: FOOTER }),
      page('/docs/', { nav: [{ label: 'Main', links: MAIN }], mainNav: [['Start', '/docs/start'], ['API', '/docs/api']], footer: FOOTER }),
      page('/blog', { nav: [{ label: 'Main', links: [...MAIN.slice(0, 4), ['RSS', '/rss'], ...MAIN.slice(4)] }], footer: FOOTER }),
      page('/pricing', { nav: [{ label: 'Main', links: MAIN.filter(([name]) => name !== 'Pricing') }], footer: FOOTER }),
    ])
    expect(report.sets).toHaveLength(1)
    expect(report.sets[0]?.pages).toHaveLength(4)
    expect([...report.findings, ...report.belowThreshold, ...report.review]).toEqual([])
    expect(report.criteria.find((c) => c.criterion === '3.2.3')).toMatchObject({ setsCompared: 1, findings: 0, review: 0 })
  })

  it('names the page whose navigation is in another order, the items, the elements and the order on each page', () => {
    const report = run([
      page('/', { nav: [{ label: 'Main', links: MAIN }], footer: FOOTER }),
      page('/docs/', { nav: [{ label: 'Main', links: MAIN }], footer: FOOTER }),
      page('/blog', { nav: [{ label: 'Main', links: MAIN }], footer: FOOTER }),
      page('/pricing', { nav: [{ label: 'Main', links: swap(MAIN, 1, 2) }], footer: FOOTER }),
    ])
    const nav = report.findings.filter((finding) => finding.criterion === '3.2.3')
    expect(nav).toHaveLength(1)
    const [finding] = nav
    expect(finding).toMatchObject({
      status: 'failure',
      confidence: 'high',
      experimental: true,
      subject: 'The navigation “Main”',
      pages: [u('/pricing')],
      comparedWith: [u('/'), u('/docs/'), u('/blog')],
      items: ['Docs', 'Pricing'],
    })
    expect(finding?.message).toBe(
      'The navigation “Main” lists “Docs”, “Pricing” in a different relative order on /pricing than on /, /docs/, /blog. Keep repeated navigation in the same relative order on every page of the set (F66); links may be added or left out.',
    )
    expect(finding?.evidence).toBe('Order on /, /docs/, /blog: Docs → Pricing\nOrder on /pricing: Pricing → Docs')
    expect(finding?.elements).toContainEqual({ page: u('/pricing'), ref: 'header > nav:nth-of-type(1)', name: 'Main' })
    expect(finding?.elements).toContainEqual({ page: u('/pricing'), ref: 'header > nav:nth-of-type(1) > a:nth-of-type(3)', name: 'Docs' })
  })

  it('names both pages when two pages disagree and neither is the odd one out', () => {
    const report = run([
      page('/', { nav: [{ links: MAIN }] }),
      page('/about', { nav: [{ links: swap(MAIN, 3, 4) }] }),
    ])
    const [finding] = report.findings.filter((entry) => entry.criterion === '3.2.3')
    expect(finding).toMatchObject({ status: 'failure', confidence: 'medium', pages: [u('/'), u('/about')], comparedWith: [] })
    expect(finding?.subject).toBe('The navigation (Home, Docs, Pricing, …)')
  })

  it('leaves out an address the block links to twice, so a logo and a Home link cannot fake an inversion', () => {
    const withLogo: Links = [['Rampa', '/'], ['Docs', '/docs/'], ['Blog', '/blog'], ['Home', '/']]
    const report = run([
      page('/', { nav: [{ links: withLogo }] }),
      page('/docs/', { nav: [{ links: [['Home', '/'], ['Docs', '/docs/'], ['Blog', '/blog']] }] }),
    ])
    expect(report.findings.filter((entry) => entry.criterion === '3.2.3')).toEqual([])
  })

  it('sends an inversion between blocks that share few links, or that are hidden on one page, to needs review', () => {
    const report = run([
      page('/', { nav: [{ links: MAIN }] }),
      page('/a', { nav: [{ links: MAIN }] }),
      page('/b', { nav: [{ links: swap(MAIN, 0, 1), hidden: true }] }),
    ])
    const [review] = report.review.filter((entry) => entry.criterion === '3.2.3')
    expect(review?.message).toContain('Needs review: the block is hidden on some of these pages and shown on others.')
    expect(report.findings.filter((entry) => entry.criterion === '3.2.3')).toEqual([])
  })

  it('matches a desktop menu with the desktop menu and its hidden mobile twin with the mobile twin, wherever they sit', () => {
    const mobile: Links = [MAIN[4], ...MAIN.slice(0, 4)] as Links
    const report = run([
      page('/', { nav: [{ label: 'Main', links: MAIN }, { label: 'Menu', links: mobile, hidden: true }] }),
      page('/a', { nav: [{ label: 'Menu', links: mobile, hidden: true }, { label: 'Main', links: MAIN }] }),
      page('/b', { nav: [{ label: 'Main', links: MAIN }, { label: 'Menu', links: mobile, hidden: true }] }),
    ])
    expect([...report.findings, ...report.review].filter((finding) => finding.criterion === '3.2.3')).toEqual([])
    expect(report.criteria.find((c) => c.criterion === '3.2.3')?.compared).toBe(2)
  })

  it('lists a page alone in a named set, and counts a criterion as checked only when it compared something', () => {
    const report = run([page('/', { nav: [{ links: MAIN }] }), page('/a', { nav: [{ links: MAIN }] }), page('/pricing', { nav: [{ links: MAIN }] })], {
      pageSets: { pricing: ['/pricing'] },
    })
    expect(report.unassigned).toEqual([{ url: u('/pricing'), reason: 'alone' }])
    expect(report.sets.map((set) => set.pages.length)).toEqual([2])
    expect(siteCriteriaChecked(report)).toEqual(['3.2.3', '3.2.6'])

    // Two named pages with nothing to compare: the set ran, but nothing was compared.
    const empty = run([page('/b/1', { nav: [{ links: [['Home', '/']] }] }), page('/b/2', { nav: [{ links: [['Home', '/']] }] })], { pageSets: { blog: ['/b/'] } })
    expect(empty.criteria.map((c) => [c.criterion, c.setsCompared, c.compared])).toEqual([
      ['3.2.3', 1, 0],
      ['3.2.6', 1, 0],
    ])
    expect(siteCriteriaChecked(empty)).toEqual([])
  })

  it('checks the sets named in the config before a crawl starts', () => {
    expect(pageSetsOf(undefined)).toBeUndefined()
    expect(pageSetsOf({ docs: '/docs/', blog: ['/blog/', ' /news/ '] })).toEqual({ docs: ['/docs/'], blog: ['/blog/', '/news/'] })
    expect(() => pageSetsOf(['/docs/'])).toThrow('pageSets in the config must be an object.')
    expect(() => pageSetsOf({ docs: [] })).toThrow('pageSets in the config has no list of path patterns for "docs".')
    expect(() => pageSetsOf({ docs: [3] })).toThrow('has no list of path patterns for "docs"')
  })

  it('compares language versions as separate sets', () => {
    const pt: Links = [['Início', '/pt/'], ['Preços', '/pt/precos'], ['Documentação', '/pt/docs/'], ['Blog', '/blog']]
    const report = run([
      page('/', { nav: [{ links: MAIN }] }),
      page('/docs/', { nav: [{ links: MAIN }] }),
      page('/pt/', { lang: 'pt-BR', nav: [{ links: pt }] }),
      page('/pt/precos', { lang: 'pt-BR', nav: [{ links: pt }] }),
    ])
    expect(report.sets.map((set) => [set.lang, set.pages.map((url) => new URL(url).pathname)])).toEqual([
      ['en', ['/', '/docs/']],
      ['pt', ['/pt/', '/pt/precos']],
    ])
    expect([...report.findings, ...report.review]).toEqual([])
  })

  it('uses the sets named in the config, and groups the other pages by template', () => {
    const report = run(
      [
        page('/', { nav: [{ links: MAIN }] }),
        page('/docs/a', { nav: [{ links: MAIN }] }),
        page('/docs/b', { nav: [{ links: swap(MAIN, 0, 4) }] }),
        page('/blog', { nav: [{ links: MAIN }] }),
      ],
      { pageSets: { docs: ['/docs/'] } },
    )
    expect(report.sets.map((set) => [set.id, set.source, set.pages.length])).toEqual([
      ['config:docs', 'config', 2],
      ['template-1', 'template', 2],
    ])
    const [finding] = report.findings.filter((entry) => entry.criterion === '3.2.3')
    expect(finding?.set).toBe('config:docs')
    expect(finding?.pages).toEqual([u('/docs/a'), u('/docs/b')])
  })

  it('reports pages without navigation, compares nothing, and keeps experimental findings below the default threshold', () => {
    const none = run([page('/', { plain: true, nav: [{ links: MAIN }] }), page('/a', { plain: true, nav: [{ links: swap(MAIN, 0, 1) }] })])
    expect(none.sets).toEqual([])
    expect(none.unassigned).toEqual([
      { url: u('/'), reason: 'no-navigation' },
      { url: u('/a'), reason: 'no-navigation' },
    ])
    expect(none.criteria.map((c) => c.setsCompared)).toEqual([0, 0])

    const snapshots = [page('/', { nav: [{ links: MAIN }] }), page('/a', { nav: [{ links: MAIN }] }), page('/b', { nav: [{ links: swap(MAIN, 1, 2) }] })]
    const medium = run(snapshots, { minConfidence: 'medium' })
    expect(medium.findings).toEqual([])
    expect(medium.belowThreshold.map((finding) => finding.criterion)).toEqual(['3.2.3'])
    const waived = run(snapshots, { waivers: new Set([medium.belowThreshold[0]?.fingerprint ?? '']) })
    expect(waived.findings).toEqual([])
    expect(waived.waived).toHaveLength(1)
    // The fingerprint names the component and the items, never the pages: the same problem found from other pages keeps it.
    const again = run([page('/x', { nav: [{ links: MAIN }] }), page('/y', { nav: [{ links: MAIN }] }), page('/z', { nav: [{ links: swap(MAIN, 1, 2) }] })])
    expect(again.findings[0]?.fingerprint).toBe(medium.belowThreshold[0]?.fingerprint)
  })
})

describe('3.2.6 Consistent Help', () => {
  it('recognizes help by where it leads, and by its text only as uncertain', () => {
    const item = (name: string, href?: string) => ({ key: href ?? name, name, ref: 'a', href })
    expect(helpOfItem(item('Write to us', 'mailto:help@example.com'))).toEqual({ type: 'contact-details', certain: true })
    expect(helpOfItem(item('Call', 'tel:+5511'))).toEqual({ type: 'contact-details', certain: true })
    expect(helpOfItem(item('WhatsApp', 'https://wa.me/5511999990000'))).toEqual({ type: 'human-contact', certain: true })
    expect(helpOfItem(item('Fale conosco', '/fale-conosco'))).toEqual({ type: 'human-contact', certain: true })
    expect(helpOfItem(item('Dúvidas', '/ajuda/perguntas-frequentes'))).toEqual({ type: 'self-help', certain: true })
    expect(helpOfItem(item('Docs', 'https://support.example.com/'))).toEqual({ type: 'self-help', certain: true })
    expect(helpOfItem(item('Get in touch', '/hello'))).toEqual({ type: 'human-contact', certain: false })
    expect(helpOfItem(item('Pricing', '/pricing'))).toBeUndefined()
    expect(helpOfItem(item('Helpful tips', '/tips'))).toBeUndefined()
  })

  it('finds a chat widget and keeps track of what is in the main content', () => {
    const widget = node({ ref: '#intercom-container', role: 'generic', native: { tag: 'div', attributes: { id: 'intercom-container' } }, children: [node({ ref: '#intercom-container > iframe', role: 'generic', native: { tag: 'iframe', attributes: { src: 'https://widget.intercom.io/x' } } })] })
    const facts = helpFacts(page('/', { nav: [{ links: MAIN }], main: [['email us', 'mailto:sales@example.com']], footer: FOOTER, after: [widget] }))
    expect(facts.tokens.filter((token) => token.help).map((token) => [token.id, token.help?.type])).toEqual([
      ['/contact@before-main', 'human-contact'],
      ['mailto:help@example.com@after-main', 'contact-details'],
      ['chat:Intercom@after-main', 'chat'],
    ])
    expect(facts.inMain.map((entry) => entry.key)).toEqual(['mailto:sales@example.com'])
  })

  it('finds nothing when help keeps its place, and when it is missing from some pages', () => {
    const report = run([
      page('/', { nav: [{ links: MAIN }], footer: FOOTER }),
      page('/a', { nav: [{ links: MAIN }], footer: FOOTER }),
      page('/b', { nav: [{ links: MAIN.slice(0, 4) }], footer: FOOTER.slice(0, 2) }),
    ])
    expect([...report.findings, ...report.review].filter((finding) => finding.criterion === '3.2.6')).toEqual([])
    expect(report.criteria.find((c) => c.criterion === '3.2.6')?.compared).toBe(2)
  })

  it('names the page where the contact details moved from the footer to the header', () => {
    const report = run([
      page('/', { nav: [{ links: MAIN }], footer: FOOTER }),
      page('/a', { nav: [{ links: MAIN }], footer: FOOTER }),
      page('/b', { header: [['help@example.com', 'mailto:help@example.com']], nav: [{ links: MAIN }], footer: FOOTER.slice(0, 2) }),
    ])
    const help = report.findings.filter((finding) => finding.criterion === '3.2.6')
    expect(help).toHaveLength(1)
    expect(help[0]).toMatchObject({ status: 'failure', confidence: 'high', pages: [u('/b')], comparedWith: [u('/'), u('/a')] })
    expect(help[0]?.message).toBe(
      'The contact detail “help@example.com” (mailto:help@example.com) is before the main content on /b, and after the main content on /, /a. Help repeated on several pages must keep the same order relative to the rest of the page (3.2.6).',
    )
    expect(help[0]?.evidence).toBe('after the main content on /, /a\nbefore the main content on /b')
    expect(help[0]?.elements).toContainEqual({ page: u('/b'), ref: 'header > a:nth-of-type(1)', name: 'help@example.com', html: '<a href="mailto:help@example.com">help@example.com</a>' })
  })

  it('names the page where the contact link changed place in the header, and leaves another link moving to 3.2.3', () => {
    const moved = run([
      page('/', { nav: [{ links: MAIN }] }),
      page('/a', { nav: [{ links: MAIN }] }),
      page('/b', { nav: [{ links: [MAIN[4], ...MAIN.slice(0, 4)] as Links }] }),
    ])
    const help = moved.findings.filter((finding) => finding.criterion === '3.2.6')
    expect(help.map((finding) => [finding.subject, finding.pages])).toEqual([['The contact link “Contact” (/contact)', [u('/b')]]])
    expect(help[0]?.evidence).toBe('Order on /, /a: Home → Docs → Pricing → Blog → Contact\nOrder on /b: Contact → Home → Docs → Pricing → Blog')
    expect(moved.findings.filter((finding) => finding.criterion === '3.2.3').map((finding) => finding.pages)).toEqual([[u('/b')]])

    // Blog moving past Contact is Blog's move: 3.2.3 reports it, 3.2.6 does not.
    const other = run([
      page('/', { nav: [{ links: MAIN }] }),
      page('/a', { nav: [{ links: MAIN }] }),
      page('/b', { nav: [{ links: [...MAIN.slice(0, 3), MAIN[4], MAIN[3]] as Links }] }),
    ])
    expect(other.findings.filter((finding) => finding.criterion === '3.2.6')).toEqual([])
    expect(other.findings.filter((finding) => finding.criterion === '3.2.3')).toHaveLength(1)
  })

  it('reads the visible menu when a hidden mobile copy repeats it, so a moved contact link is still found', () => {
    const moved: Links = [MAIN[4], ...MAIN.slice(0, 4)] as Links
    const report = run([
      page('/', { nav: [{ label: 'Main', links: MAIN }, { label: 'Menu', links: MAIN, hidden: true }] }),
      page('/a', { nav: [{ label: 'Main', links: MAIN }, { label: 'Menu', links: MAIN, hidden: true }] }),
      page('/b', { nav: [{ label: 'Main', links: moved }, { label: 'Menu', links: MAIN, hidden: true }] }),
    ])
    const help = report.findings.filter((finding) => finding.criterion === '3.2.6')
    expect(help.map((finding) => [finding.subject, finding.pages])).toEqual([['The contact link “Contact” (/contact)', [u('/b')]]])
    expect(help[0]?.elements.find((element) => element.page === u('/b') && element.name === 'Contact')?.ref).toBe('header > nav:nth-of-type(1) > a:nth-of-type(1)')
  })

  it('keeps a finding of one language apart from the same finding in another', () => {
    const pt: Links = [['Início', '/pt/'], ['Contato', '/contact']]
    const en: Links = [['Home', '/'], ['Contact', '/contact']]
    const report = run([
      page('/', { nav: [{ links: en }], footer: FOOTER }),
      page('/a', { nav: [{ links: en }], footer: FOOTER }),
      page('/b', { nav: [{ links: en }], header: [['help@example.com', 'mailto:help@example.com']], footer: FOOTER.slice(0, 2) }),
      page('/pt/', { lang: 'pt-BR', nav: [{ links: pt }], footer: FOOTER }),
      page('/pt/a', { lang: 'pt-BR', nav: [{ links: pt }], footer: FOOTER }),
      page('/pt/b', { lang: 'pt-BR', nav: [{ links: pt }], header: [['help@example.com', 'mailto:help@example.com']], footer: FOOTER.slice(0, 2) }),
    ])
    const help = report.findings.filter((finding) => finding.criterion === '3.2.6')
    expect(help.map((finding) => finding.pages.map((url) => new URL(url).pathname))).toEqual([['/b'], ['/pt/b']])
    expect(help[0]?.fingerprint).not.toBe(help[1]?.fingerprint)
  })

  it('sends help recognized by its text only, and help only inside the main content, to needs review', () => {
    const byName: Links = [['Home', '/'], ['Docs', '/docs/'], ['Get in touch', '/hello']]
    const report = run([
      page('/', { nav: [{ links: byName }], footer: FOOTER }),
      page('/a', { nav: [{ links: byName }], footer: FOOTER }),
      page('/b', { nav: [{ links: [['Home', '/'], ['Docs', '/docs/']] }], footer: [['Get in touch', '/hello'], ...FOOTER] }),
      page('/c', { nav: [{ links: [['Home', '/'], ['Docs', '/docs/']] }], main: [['help@example.com', 'mailto:help@example.com']], footer: FOOTER.slice(0, 2) }),
    ])
    expect(report.findings.filter((finding) => finding.criterion === '3.2.6')).toEqual([])
    const reviews = report.review.filter((finding) => finding.criterion === '3.2.6')
    expect(reviews.map((finding) => [finding.subject, finding.pages.map((url) => new URL(url).pathname)])).toEqual([
      ['The contact detail “help@example.com” (mailto:help@example.com)', ['/c']],
      ['The contact link “Get in touch” (/hello)', ['/b']],
    ])
    expect(reviews[1]?.message).toContain('Needs review: recognized as help by its text only.')
    expect(reviews[0]?.message).toContain('only inside the main content on /c')
  })

  it('reads the snapshot only through its facts, with no model', () => {
    expect(consistentHelp.maturity).toBe('experimental')
    expect(navigationComponents(page('/', { nav: [{ label: 'Main', links: MAIN }], footer: FOOTER })).map((c) => [c.kind, c.items.length])).toEqual([
      ['navigation', 5],
      ['contentinfo', 3],
    ])
  })
})

describe('the site report', () => {
  const pages = [page('/', { nav: [{ label: 'Main', links: MAIN }], footer: FOOTER }), page('/a', { nav: [{ label: 'Main', links: MAIN }], footer: FOOTER }), page('/b', { nav: [{ label: 'Main', links: swap(MAIN, 1, 2) }], footer: FOOTER })]

  function site(minConfidence: 'low' | 'medium'): SiteReport {
    const siteCriteria = run(pages, { minConfidence })
    return {
      schemaVersion: 1,
      kind: 'site',
      rampaVersion: 'test',
      createdAt: '2026-10-09T00:00:00.000Z',
      site: ORIGIN,
      start: [{ requested: u('/'), url: u('/') }],
      crawl: { mode: 'links', maxPages: 10, concurrency: 2, include: [], exclude: [], ignoreQuery: false, robots: { url: u('/robots.txt'), status: 'missing', group: 'none' }, sitemaps: [], sitemapErrors: [] },
      browser: describeConditions({ timeoutMs: 30_000, waitUntil: 'load', waitFor: [] } as never),
      locale: 'en',
      llm: 'off',
      engine: { name: 'axe-core', version: '4.14.0' },
      notChecked: [],
      notLoaded: 0,
      beyondDepth: 0,
      summary: {
        pagesChecked: 3,
        findings: { total: 0, repeated: 0, pageSpecific: 0 },
        repeated: [],
        pageSpecific: pages.map((snapshot) => ({ url: snapshot.target, findings: [] })),
        usage: { calls: 0, cachedCalls: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0, reusedAcrossPages: 0 },
        coverage: { engine: [], judged: [], notChecked: [] },
      },
      pages: pages.map((snapshot) => ({
        schemaVersion: 1,
        rampaVersion: 'test',
        createdAt: '2026-10-09T00:00:00.000Z',
        target: snapshot.target,
        surface: 'web',
        locale: 'en',
        llm: 'off',
        engine: { name: 'axe-core', version: '4.14.0' },
        findings: [],
        belowThreshold: [],
        waived: [],
        discarded: [],
        criteria: [],
        coverage: { engine: [], judged: [], notChecked: [] },
        usage: { calls: 0, cachedCalls: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0 },
        errors: [],
      })),
      siteCriteria,
    }
  }

  it('prints the sets, the findings across pages and what was compared, and counts them in the exit code', () => {
    const below = site('medium')
    const text = renderSiteReport(below, { verbose: false, paint: paint(false) })
    expect(text).toContain('Across pages')
    expect(text).toContain('Set template 1 (shared header, navigation and footer): 3 pages, en, 1280×800: /, /a, /b')
    expect(text).toContain('1 finding(s) across pages from experimental checks are below the threshold')
    expect(text).toContain('Compared across pages:          3.2.3 (1 set(s), 2 compared); 3.2.6 (1 set(s), 2 compared)')
    expect(siteExitCode([below], 'confirmed')).toBe(0)
    expect(siteExitCode([below], 'any')).toBe(1)

    const verbose = renderSiteReport(below, { verbose: true, paint: paint(false) })
    expect(verbose).toContain('WCAG 3.2.3 (AA) — Consistent Navigation')
    expect(verbose).toContain('✗ The navigation “Main” · experimental')
    expect(verbose).toContain('Order on /b: Pricing → Docs')
    expect(verbose).toContain('on /b: header > nav:nth-of-type(1)')

    const low = site('low')
    expect(siteExitCode([low], 'confirmed')).toBe(1)
    expect(renderSiteReport(low, { verbose: false, paint: paint(false) })).not.toContain('No confirmed failures')
  })
})
