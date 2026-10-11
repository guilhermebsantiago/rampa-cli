import { describe, expect, it } from 'vitest'
import type { JudgmentCache } from '../src/core/cache.ts'
import { withSiteCriteria } from '../src/core/coverage.ts'
import type { SiteFinding } from '../src/core/site.ts'
import type { Report } from '../src/core/types.ts'
import type { JudgeRequest, ModelProvider } from '../src/providers/types.ts'
import { functionAddress, identificationFacts, relation } from '../src/site/identification.ts'
import { type SitePageRecord, judgeSiteQuestions, runSiteCriteria, siteFactsOf } from '../src/site/index.ts'
import { waysFacts } from '../src/site/multiple-ways.ts'
import type { A11yNode, A11ySnapshot } from '../src/snapshot/schema.ts'
import { node } from './helpers.ts'

const ORIGIN = 'https://example.com'
const u = (path: string) => `${ORIGIN}${path}`

const NAV: Array<[string, string]> = [
  ['Home', '/'],
  ['Products', '/products'],
  ['About', '/about'],
  ['Blog', '/blog'],
  ['Docs', '/docs'],
  ['Pricing', '/pricing'],
  ['Careers', '/careers'],
  ['Contact', '/contact'],
]

let counter = 0
function link(ref: string, name: string, href: string, extra: Partial<A11yNode> = {}): A11yNode {
  return node({ ref, role: 'link', name, text: name, native: { tag: 'a', attributes: { href }, html: `<a href="${href}">${name}</a>` }, ...extra })
}

interface Spec {
  title?: string
  /** The h1, the page's path by default. */
  heading?: string
  search?: string
  login?: string
  /** An icon-only button in the header: its name and its svg drawing. */
  icon?: [string, string]
  theme?: string
  cart?: number
  privacy?: string
  subscribe?: string
  main?: A11yNode[]
  /** Name of the help link in the footer, recognized by its text only. */
  support?: [string, string]
  /** More links in the footer: a name and an address. */
  footer?: Array<[string, string]>
}

/** A page of a small site: a header with a search form, a sign-in link and buttons, a main navigation, and a footer. */
function page(path: string, spec: Spec = {}): A11ySnapshot {
  counter++
  const header = node({
    ref: 'header',
    role: 'banner',
    native: { tag: 'header' },
    children: [
      link('header > a.logo', 'Acme', '/', { text: undefined, children: [node({ ref: 'header > a.logo > img', role: 'img', name: 'Acme', native: { tag: 'img', attributes: { src: '/logo.png', alt: 'Acme' } } })] }),
      node({
        ref: 'header > form',
        role: 'search',
        native: { tag: 'form', attributes: { action: '/search', role: 'search' } },
        children: [
          node({ ref: 'header > form > input', role: 'searchbox', name: 'Search the site', native: { tag: 'input', attributes: { type: 'search', name: 'q' } } }),
          node({ ref: 'header > form > button', role: 'button', name: spec.search ?? 'Search', text: spec.search ?? 'Search', native: { tag: 'button' } }),
        ],
      }),
      link('header > a.login', spec.login ?? 'Log in', `/login?next=${encodeURIComponent(path)}`),
      link('header > a.cart', `Cart (${spec.cart ?? 0})`, '/cart'),
      link('header > a.lang', 'Português', `/pt${path}`, { native: { tag: 'a', attributes: { href: `/pt${path}`, hreflang: 'pt-BR' } } }),
      node({ ref: '#theme', role: 'button', name: spec.theme ?? 'Dark mode', text: spec.theme ?? 'Dark mode', native: { tag: 'button', attributes: { id: 'theme', type: 'button' } } }),
      node({
        ref: 'header > button.menu',
        role: 'button',
        name: (spec.icon ?? ['Menu', 'aa11'])[0],
        native: { tag: 'button', attributes: { type: 'button', 'aria-label': (spec.icon ?? ['Menu', 'aa11'])[0] } },
        children: [node({ ref: 'header > button.menu > svg', role: 'graphics-document', states: ['aria-hidden'], native: { tag: 'svg', svgHash: (spec.icon ?? ['Menu', 'aa11'])[1] } })],
      }),
      node({
        ref: 'header > nav',
        role: 'navigation',
        name: 'Main',
        native: { tag: 'nav', attributes: { 'aria-label': 'Main' } },
        children: NAV.map(([name, href], index) => link(`header > nav > a:nth-of-type(${index + 1})`, name, href)),
      }),
    ],
  })
  const main = node({ ref: 'main', role: 'main', native: { tag: 'main' }, children: [node({ ref: 'main > h1', role: 'heading', name: spec.heading ?? path, text: spec.heading ?? path, native: { tag: 'h1' } }), ...(spec.main ?? [])] })
  const footer = node({
    ref: 'footer',
    role: 'contentinfo',
    native: { tag: 'footer' },
    children: [
      node({
        ref: 'footer > form',
        role: 'form',
        native: { tag: 'form', attributes: { action: '/newsletter', method: 'post' } },
        children: [
          node({ ref: 'footer > form > input', role: 'textbox', name: 'Your e-mail', native: { tag: 'input', attributes: { type: 'email', name: 'email' } } }),
          node({ ref: 'footer > form > button', role: 'button', name: spec.subscribe ?? 'Subscribe', text: spec.subscribe ?? 'Subscribe', native: { tag: 'button' } }),
        ],
      }),
      link('footer > a.privacy', 'Privacy', spec.privacy ?? '/privacy'),
      link('footer > a.top', 'Back to top', '#top'),
      ...(spec.support ? [link('footer > a.support', spec.support[0], spec.support[1])] : []),
      ...(spec.footer ?? []).map(([name, href], index) => link(`footer > a.more:nth-of-type(${index + 1})`, name, href)),
    ],
  })
  return {
    schemaVersion: 1,
    surface: 'web',
    target: u(path),
    title: spec.title ?? `${path} · Acme`,
    locale: 'en',
    viewport: { width: 1280, height: 800, scale: 1 },
    collectedAt: '2026-10-11T00:00:00.000Z',
    collector: { name: 'test', version: String(counter) },
    root: node({ ref: 'html', role: 'document', native: { tag: 'html' }, children: [node({ ref: 'body', role: 'generic', native: { tag: 'body' }, children: [header, main, footer] })] }),
  }
}

function run(snapshots: A11ySnapshot[], options: Partial<Parameters<typeof runSiteCriteria>[1]> = {}) {
  const records: SitePageRecord[] = snapshots.map((snapshot) => siteFactsOf(snapshot))
  return runSiteCriteria(records, { origin: ORIGIN, locale: 'en', minConfidence: 'low', ...options })
}

const of = (findings: readonly SiteFinding[], criterion: string) => findings.filter((finding) => finding.criterion === criterion)
/** Failures, wherever the threshold put them. */
const failed = (report: { findings: SiteFinding[]; belowThreshold: SiteFinding[] }, criterion: string) => of([...report.findings, ...report.belowThreshold], criterion)
const paths = (urls: readonly string[]) => urls.map((url) => new URL(url).pathname)

describe('3.2.4 Consistent Identification', () => {
  it('folds names, and tells names that share no word from names that share some', () => {
    expect(relation('Log in', 'Login')).toBe('same')
    expect(relation('Search…', 'search')).toBe('same')
    expect(relation('Cart (0)', 'Cart (12)')).toBe('numbers')
    expect(relation('Go to page 4', 'Go to page 5')).toBe('numbers')
    expect(relation('Share “Pricing”', 'Share “Docs”', new Set(['pricing']), new Set(['docs']))).toBe('own')
    expect(relation('Log in', 'Sign in')).toBe('disjoint')
    expect(relation('Search', 'Find')).toBe('disjoint')
    expect(relation('Dark mode', 'Toggle dark mode')).toBe('contains')
    expect(relation('Our plans', 'Plans and prices')).toBe('contains')
    expect(relation('Read the docs', 'Docs home')).toBe('overlap')
  })

  it('reads where a link leads with what belongs to its page set apart', () => {
    expect(functionAddress('/login?next=%2Fabout', u('/about'))).toBe('/login?next={url}')
    expect(functionAddress('/login?next=/pricing&utm_source=x', u('/pricing'))).toBe('/login?next={url}')
    expect(functionAddress('#top', u('/about'))).toBe('{page}#top')
    expect(functionAddress('/about#team', u('/'))).toBe('/about#team')
    expect(functionAddress('https://github.com/acme/site/edit/main/docs/getting-started.md', u('/docs/getting-started'))).toBe(
      'https://github.com/acme/site/edit/main/{page}.md',
    )
    expect(functionAddress('javascript:void(0)', u('/'))).toBeUndefined()
  })

  it('finds nothing when components keep their names, with counts, return addresses and language links that change', () => {
    const report = run([page('/'), page('/products', { cart: 2 }), page('/about'), page('/blog')])
    expect([...of(report.findings, '3.2.4'), ...of(report.belowThreshold, '3.2.4'), ...of(report.review, '3.2.4')]).toEqual([])
    // Logo, search field and button, sign-in, cart, language, theme, menu, eight navigation links, the newsletter field and button, privacy, back to top.
    expect(report.criteria.find((c) => c.criterion === '3.2.4')?.compared).toBe(20)
    const facts = identificationFacts(page('/about'))
    expect(facts.components.find((component) => component.name === 'Português')).toMatchObject({ fn: 'language:pt', basis: 'language' })
    expect(facts.components.find((component) => component.name === 'Acme')).toMatchObject({ fn: 'link:/', image: true, place: 'banner' })
    expect(facts.components.find((component) => component.name === 'Your e-mail')).toMatchObject({ fn: 'form:/newsletter|field:email', basis: 'form' })
  })

  it('fails a component named differently on one page, with the names and pages, and the elements on each', () => {
    const report = run([page('/'), page('/products'), page('/about', { search: 'Find', login: 'Sign in', subscribe: 'Sign up' }), page('/blog')])
    const failures = failed(report, '3.2.4')
    expect(failures.map((finding) => [finding.subject, finding.items, paths(finding.pages), paths(finding.comparedWith)])).toEqual([
      ['The link to /login?next=… in the header', ['Log in', 'Sign in'], ['/about'], ['/', '/products', '/blog']],
      ['The search button', ['Search', 'Find'], ['/about'], ['/', '/products', '/blog']],
      ['The submit button of the form to /newsletter in the footer', ['Subscribe', 'Sign up'], ['/about'], ['/', '/products', '/blog']],
    ])
    const search = failures[1] as SiteFinding
    expect(search).toMatchObject({ status: 'failure', confidence: 'high', experimental: true })
    expect(search.message).toBe(
      'The search button is named “Search” on /, /products, /blog, and “Find” on /about. Components with the same function must be identified the same way on every page of the set (3.2.4, F31): give it one name.',
    )
    expect(search.evidence).toBe('“Search” on /, /products, /blog\n“Find” on /about')
    expect(search.elements.map((element) => [new URL(element.page).pathname, element.ref])).toEqual([
      ['/about', 'header > form > button'],
      ['/', 'header > form > button'],
      ['/products', 'header > form > button'],
      ['/blog', 'header > form > button'],
    ])
    // At the default threshold, an experimental check reports nothing.
    expect(run([page('/'), page('/about', { search: 'Find' }), page('/blog')], { minConfidence: 'medium' }).findings).toEqual([])
  })

  it('sends names that share words, buttons grouped only by their icon, and one name for two destinations to review', () => {
    const report = run([
      page('/'),
      page('/products', { theme: 'Toggle dark mode' }),
      page('/about', { icon: ['Navigation', 'aa11'], privacy: '/legal/privacy' }),
      page('/blog'),
      // Another drawing is another function: nothing to compare with.
      page('/contact', { icon: ['Filter', 'bb22'] }),
    ])
    expect(failed(report, '3.2.4')).toEqual([])
    const review = of(report.review, '3.2.4')
    expect(review.map((finding) => [finding.subject, finding.items, paths(finding.pages)])).toEqual([
      ['The button drawn with the same icon in the header', ['Menu', 'Navigation'], ['/about']],
      ['The control #theme in the header', ['Dark mode', 'Toggle dark mode'], ['/products']],
      ['The name “Privacy”', ['/privacy', '/legal/privacy'], ['/about']],
    ])
    expect(review[0]?.message).toContain('Needs review: they are grouped only by their icon')
    expect(review[0]?.question).toMatchObject({
      kind: 'same-function',
      names: [
        { name: 'Menu', page: u('/'), role: 'button' },
        { name: 'Navigation', page: u('/about'), role: 'button' },
      ],
      confirmed: { status: 'failure' },
    })
    expect(review[1]?.message).toContain('Needs review: the names share some words')
    expect(review[1]?.question).toBeUndefined()
    expect(review[2]?.message).toBe(
      '“Privacy” in the footer leads to /privacy on /, /products, /blog, /contact, and to /legal/privacy on /about. Needs review: one name for two destinations may be two functions under one name; check that it is the same function, or name them apart (3.2.4).',
    )
  })

  it('takes a name that changes on every page as about its page, and keeps fingerprints free of the pages', () => {
    const named = (path: string, label: string) => page(path, { main: [link('main > a.share', label, `https://twitter.com/intent/tweet?url=${encodeURIComponent(u(path))}`)] })
    const each = run([named('/', 'Share Home'), named('/products', 'Share Products'), named('/about', 'Share About')])
    expect(of(each.review, '3.2.4')).toEqual([])
    // "Next" on one page and "Previous" on the following one lead to the same page: two functions relative to their page.
    const sequence = run([
      page('/one', { footer: [['Next', '/two']] }),
      page('/two', { footer: [['Previous', '/one'], ['Next', '/three']] }),
      page('/three', { footer: [['Previous', '/two'], ['Next', '/four']] }),
    ])
    expect([...failed(sequence, '3.2.4'), ...of(sequence.review, '3.2.4')]).toEqual([])
    expect(identificationFacts(page('/two', { footer: [['« Previous: One', '/one']] })).components.at(-1)).toMatchObject({ fn: 'relative:previous', kind: 'relative' })
    // A page with no main landmark: links outside the landmarks may be its content, named in context, so they are not compared.
    const bare = (path: string, name: string) => {
      const snapshot = page(path)
      const body = snapshot.root.children[0] as A11yNode
      body.children = [link('body > a.story', name, '/story')]
      return snapshot
    }
    expect(identificationFacts(bare('/a', 'Read more')).components).toEqual([])
    const a = run([page('/'), page('/products'), page('/about', { search: 'Find' })])
    const b = run([page('/x'), page('/y'), page('/z', { search: 'Find' }), page('/w')])
    expect(failed(a, '3.2.4')[0]?.fingerprint).toBe(failed(b, '3.2.4')[0]?.fingerprint)
  })
})

/** A model that answers by a rule, records each question, and can be told to quote something else. */
function stub(answer: (user: string, schemaName: string, call: number) => Record<string, string>): ModelProvider & { calls: number } {
  const provider = {
    id: 'stub:site',
    calls: 0,
    async judge<T>(request: JudgeRequest<T>) {
      provider.calls++
      return { output: request.schema.parse(answer(request.user, request.schemaName, provider.calls)), inputTokens: 100, outputTokens: 20, latencyMs: 1, modelId: 'stub' }
    },
  }
  return provider
}

function memoryCache(): JudgmentCache {
  const store = new Map<string, Awaited<ReturnType<JudgmentCache['get']>>>()
  return {
    async get(key) {
      return store.get(key)
    },
    async set(key, value) {
      store.set(key, value)
    },
  }
}

const names = (user: string) => [...user.matchAll(/Name: (.*)/g)].map((match) => match[1] as string)

describe('questions across pages for a model', () => {
  const pages = () => [page('/'), page('/products'), page('/about', { icon: ['Navigation', 'aa11'] }), page('/blog')]
  const options = (provider: ModelProvider | undefined, cache = memoryCache(), offline = false) => ({ provider, cache, offline, locale: 'en' as const, minConfidence: 'low' as const })

  it('makes a failure of two names on one icon that a model judges the same function, by a majority of three runs', async () => {
    const report = run(pages())
    const model = stub((user, _schema, call) => {
      const [first, second] = names(user)
      return { first: first ?? '', second: second ?? '', verdict: call === 2 ? 'cannot_tell' : 'same_function', reason: 'Both open the menu.' }
    })
    await judgeSiteQuestions(report, options(model))
    expect(model.calls).toBe(3)
    expect(of(report.review, '3.2.4')).toEqual([])
    const [failure] = failed(report, '3.2.4')
    expect(failure).toMatchObject({ status: 'failure', confidence: 'medium', judgment: { verdict: 'same_function', votes: 2, total: 3, outcome: 'failure', model: 'stub:site' } })
    expect(failure?.message).toContain('Components with the same function must be identified the same way')
    expect(failure?.message).toContain('A model judged “Menu” and “Navigation” the same function (2 of 3 runs).')
    expect(report.criteria.find((c) => c.criterion === '3.2.4')).toMatchObject({ judged: 1, findings: 1, review: 0 })
    expect(report.usage).toMatchObject({ calls: 3, cachedCalls: 0, inputTokens: 300 })
  })

  it('clears what a model judges different functions, sets aside answers that quote other names, and reads the cache offline', async () => {
    const cache = memoryCache()
    const cleared = run(pages())
    await judgeSiteQuestions(cleared, options(stub((user) => ({ first: names(user)[0] ?? '', second: names(user)[1] ?? '', verdict: 'different_functions', reason: 'One opens a menu.' })), cache))
    expect(of(cleared.review, '3.2.4')).toEqual([])
    expect(cleared.cleared?.map((finding) => finding.judgment?.outcome)).toEqual(['cleared'])
    expect(cleared.criteria.find((c) => c.criterion === '3.2.4')).toMatchObject({ judged: 1, cleared: 1, review: 0 })

    // The same questions offline come from the cache, with no call: the model's id is part of the key.
    const again = run(pages())
    const unreachable = stub(() => {
      throw new Error('offline: no call')
    })
    await judgeSiteQuestions(again, options(unreachable, cache, true))
    expect(unreachable.calls).toBe(0)
    expect(again.cleared).toHaveLength(1)
    expect(again.usage).toMatchObject({ calls: 0, cachedCalls: 3 })

    const misquoted = run(pages())
    await judgeSiteQuestions(misquoted, options(stub(() => ({ first: 'Menu', second: 'Search', verdict: 'same_function', reason: '' }))))
    const [kept] = of(misquoted.review, '3.2.4')
    expect(kept?.judgment).toMatchObject({ discarded: true, outcome: 'review' })
    expect(kept?.message).toContain('its answer was set aside')

    // Without a model and nothing cached, the question stays to review.
    const none = run(pages())
    await judgeSiteQuestions(none, options(undefined, memoryCache(), true))
    expect(of(none.review, '3.2.4')[0]?.judgment).toBeUndefined()
  })

  it('asks whether help known only by its text is help, and fails the move when it is', async () => {
    const moved = (path: string, first: boolean) => page(path, { support: ['Support', '/hub'], main: first ? [] : [] })
    // On /about the "Support" link sits in the header instead of the footer.
    const about = page('/about')
    const header = about.root.children[0]?.children[0] as A11yNode
    header.children.push(link('header > a.support', 'Support', '/hub'))
    const report = run([moved('/', true), moved('/products', true), about, moved('/blog', true)])
    const [review] = of(report.review, '3.2.6')
    expect(review?.question).toMatchObject({ kind: 'help', name: 'Support', href: '/hub' })
    const model = stub(() => ({ quote: 'Support', verdict: 'help', reason: 'A support hub.' }))
    await judgeSiteQuestions(report, options(model))
    const [failure] = failed(report, '3.2.6')
    expect(failure?.message).toContain('Help repeated on several pages must keep the same order')
    expect(failure?.message).toContain('A model judged “Support” a way to get help (3 of 3 runs).')
  })
})

describe('2.4.2 titles across pages', () => {
  it('sends a title shared by pages with different content to review, and leaves one page at two addresses alone', () => {
    const titled = (path: string, title: string, text: string) => page(path, { title, heading: title, main: [node({ ref: 'main > p', role: 'paragraph', text, native: { tag: 'p' } })] })
    const report = run([titled('/', 'Acme', 'Home text'), titled('/index.html', 'Acme', 'Home text'), titled('/a', 'Post · Acme', 'One'), titled('/b', 'Post · Acme', 'Two')])
    expect(of(report.review, '2.4.2').map((finding) => [finding.subject, paths(finding.pages)])).toEqual([['The title “Post · Acme”', ['/a', '/b']]])
    const spa = run([titled('/', 'App', 'Home'), titled('/x', 'App', 'X'), titled('/y', 'App', 'Y')])
    expect(of(spa.review, '2.4.2')[0]?.message).toContain('Every page compared has the title “App” (3 pages): a single-page app may keep its title when its route changes.')
    expect(of([...spa.findings, ...spa.belowThreshold], '2.4.2')).toEqual([])
  })
})

describe('2.4.5 Multiple Ways', () => {
  it('lists the ways found on each page and the pages no navigation links to, for review only', () => {
    // A list of the page's own sections helps within the page; a docs sidebar of other pages is a table of contents of the set.
    const sections = node({
      ref: 'main > nav.sections',
      role: 'navigation',
      name: 'On this page',
      native: { tag: 'nav' },
      children: [link('main > nav.sections > a:nth-of-type(1)', 'Intro', '#intro'), link('main > nav.sections > a:nth-of-type(2)', 'Usage', '#usage'), link('main > nav.sections > a:nth-of-type(3)', 'Limits', '#limits')],
    })
    const toc = node({
      ref: 'main > nav.toc',
      role: 'navigation',
      name: 'Guides',
      native: { tag: 'nav' },
      children: [link('main > nav.toc > a:nth-of-type(1)', 'Ramps', '/guides/ramps'), link('main > nav.toc > a:nth-of-type(2)', 'Rails', '/guides/rails'), link('main > nav.toc > a:nth-of-type(3)', 'Lifts', '/guides/lifts')],
    })
    const related = [
      node({ ref: 'main > section', role: 'region', native: { tag: 'section' }, children: [
        node({ ref: 'main > section > h2', role: 'heading', name: 'Related articles', text: 'Related articles', native: { tag: 'h2' } }),
        link('main > section > a:nth-of-type(1)', 'Rails', '/rails'),
        link('main > section > a:nth-of-type(2)', 'Lifts', '/lifts'),
      ] }),
    ]
    expect(waysFacts(page('/products', { main: [sections] })).ways).toEqual(['navigation', 'search'])
    const facts = waysFacts(page('/products', { main: [toc, ...related] }))
    expect(facts.ways).toEqual(['navigation', 'search', 'toc', 'related'])
    expect(facts.self).toBe('/products')

    const report = run([page('/'), page('/products', { main: [toc] }), page('/about'), page('/news')])
    const [ways] = of(report.review, '2.4.5')
    expect(ways).toMatchObject({ status: 'review', experimental: true })
    expect(ways?.message).toContain(
      'Ways to find the 4 pages compared: a navigation menu on 4, search on 4, a site map link on 0, a table of contents on 1, related links on 0, breadcrumbs on 0; 3 of 4 pages are linked from the navigation of another page.',
    )
    expect(ways?.evidence.split('\n').at(-1)).toBe('Not linked from the header, navigation or footer of another page: /news')
    expect(of([...report.findings, ...report.belowThreshold], '2.4.5')).toEqual([])
    expect(report.criteria.find((c) => c.criterion === '2.4.5')).toMatchObject({ reviewOnly: true, review: 1, findings: 0 })

    // In the coverage, 2.4.5 needs review: it leaves "not checked", and is not listed as compared.
    const manual = 'Check it by hand.'
    const base: Report['coverage'] = {
      engine: [],
      judged: [],
      notChecked: ['2.4.5', '3.2.4'],
      criteria: [
        { id: '2.4.5', level: 'AA', target: 'in', status: 'not-checked', methods: [], manual },
        { id: '3.2.4', level: 'AA', target: 'in', status: 'not-checked', methods: [], manual },
      ],
    }
    const coverage = withSiteCriteria(base, report, { version: '2.2', locale: 'en', minConfidence: 'low' })
    expect(coverage.criteria?.find((record) => record.id === '2.4.5')).toMatchObject({ status: 'needs-review', methods: [{ kind: 'site', reviewOnly: true, review: 1 }] })
    expect(coverage.criteria?.find((record) => record.id === '3.2.4')).toMatchObject({ status: 'no-failure-found' })
    expect(coverage.notChecked).toEqual([])
    expect(coverage.site).not.toContain('2.4.5')
  })
})
