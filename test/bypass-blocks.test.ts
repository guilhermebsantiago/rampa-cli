import { type Server, createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { type CheckCommandOptions, runCheck } from '../src/cli/commands/check.ts'
import { firstPageLink } from '../src/cli/commands/eval-rules.ts'
import { checkSnapshot } from '../src/core/check.ts'
import { withSiteCriteria } from '../src/core/coverage.ts'
import type { SiteReport } from '../src/core/site.ts'
import type { Report } from '../src/core/types.ts'
import { type SkipActivation, type SkipStop, skipLinkProbe } from '../src/probes/bypass.ts'
import { DETERMINISM_ARGS } from '../src/probes/run.ts'
import { bypassBlocks, bypassFacts, inPageFragment, judgeSet, skipVerdict } from '../src/site/bypass-blocks.ts'
import { runSiteCriteria, siteFactsOf } from '../src/site/index.ts'
import type { A11yNode, A11ySnapshot } from '../src/snapshot/schema.ts'
import { collectWeb, launchBrowser } from '../src/surfaces/web.ts'
import { node } from './helpers.ts'
import { fixture, probeCheckOptions } from './probe-helpers.ts'

const ORIGIN = 'https://example.com'
const u = (path: string) => `${ORIGIN}${path}`

interface Spec {
  /** Links before the content, in a plain div unless `nav` is set. */
  menu?: string[]
  nav?: boolean
  /** Inserted into the menu: a link of this page's own. */
  extra?: string
  /** A link or button before the menu. */
  first?: { role: 'link' | 'button'; name: string; href?: string }
  /** The content: its first text, a paragraph. */
  content: string
  main?: boolean
  heading?: string
  /** An id on the content's container. */
  id?: string
}

const MENU = ['Home', 'Products', 'Pricing', 'Docs', 'Blog', 'Contact']

let counter = 0
function sitePage(path: string, spec: Spec): A11ySnapshot {
  counter++
  const link = (name: string, index: number, prefix: string) =>
    node({ ref: `${prefix} > a:nth-of-type(${index + 1})`, role: 'link', name, text: name, native: { tag: 'a', attributes: { href: `/${name.toLowerCase()}` } } })
  const items = [...(spec.menu ?? MENU)]
  if (spec.extra) items.splice(2, 0, spec.extra)
  const menu = node({ ref: spec.nav ? 'nav' : 'div.menu', role: spec.nav ? 'navigation' : 'generic', native: { tag: spec.nav ? 'nav' : 'div' }, children: items.map((name, index) => link(name, index, spec.nav ? 'nav' : 'div.menu')) })
  const contentChildren: A11yNode[] = []
  if (spec.heading) contentChildren.push(node({ ref: '#content > h1', role: 'heading', name: spec.heading, text: spec.heading, native: { tag: 'h1' } }))
  contentChildren.push(node({ ref: '#content > p', role: 'paragraph', text: spec.content, native: { tag: 'p' } }))
  const content = node({
    ref: '#content',
    role: spec.main ? 'main' : 'generic',
    native: { tag: spec.main ? 'main' : 'div', attributes: spec.id ? { id: spec.id } : {} },
    children: contentChildren,
  })
  const body: A11yNode[] = []
  if (spec.first) {
    body.push(
      node({
        ref: 'body > :first-child',
        role: spec.first.role,
        name: spec.first.name,
        text: spec.first.name,
        native: { tag: spec.first.role === 'link' ? 'a' : 'button', attributes: spec.first.href ? { href: spec.first.href } : {} },
      }),
    )
  }
  body.push(menu, content)
  return {
    schemaVersion: 1,
    surface: 'web',
    target: u(path),
    locale: 'en',
    viewport: { width: 1280, height: 800, scale: 1 },
    collectedAt: '2026-10-10T00:00:00.000Z',
    collector: { name: 'test', version: String(counter) },
    root: node({ ref: 'html', role: 'document', lang: 'en', native: { tag: 'html' }, children: [node({ ref: 'body', native: { tag: 'body' }, children: body })] }),
  }
}

const judge = (pages: A11ySnapshot[]) =>
  Object.fromEntries(judgeSet(pages.map((page) => ({ url: page.target, facts: bypassFacts(page) }))).map((page) => [new URL(page.url).pathname, page.judgment]))

describe('2.4.1 across pages', () => {
  it('fails pages whose repeated menu comes before the content with no way past it', () => {
    const judged = judge([sitePage('/', { content: 'Spring coats, made to last and easy to repair.' }), sitePage('/about', { content: 'Acme has made coats in Porto since 1952.' })])
    expect(judged['/']?.status).toBe('fail')
    expect(judged['/']?.block.map((unit) => unit.name)).toEqual(MENU)
    expect(judged['/']?.content?.name).toBe('Spring coats, made to last and easy to repair.')
    expect(judged['/about']?.status).toBe('fail')
  })

  it('passes a page with a main landmark, a heading, or a link into the page that lands on its content', () => {
    const judged = judge([
      sitePage('/', { content: 'Spring coats, made to last and easy to repair.' }),
      sitePage('/main', { content: 'Our stores are open every day.', main: true }),
      sitePage('/heading', { content: 'Coats for rain and wind.', heading: 'Rain coats' }),
      sitePage('/skip', { content: 'Jackets for the cold.', id: 'content', first: { role: 'link', name: 'Skip to content', href: '#content' } }),
    ])
    expect(judged['/']?.status).toBe('fail')
    expect(judged['/main']).toMatchObject({ status: 'pass', mechanisms: ['main landmark'] })
    expect(judged['/heading']).toMatchObject({ status: 'pass', mechanisms: ['heading “Rain coats”'] })
    expect(judged['/skip']).toMatchObject({ status: 'pass', mechanisms: ['link “Skip to content” → #content'] })
  })

  it('sends to review a page whose only way past is a control Rampa cannot try', () => {
    const judged = judge([
      sitePage('/', { content: 'Spring coats, made to last and easy to repair.' }),
      sitePage('/button', { content: 'Coats for rain and wind.', first: { role: 'button', name: 'Skip to main content' } }),
      sitePage('/toggle', { content: 'Jackets for the cold.', first: { role: 'button', name: 'Menu' } }),
      // Named like a skip link, pointing to nothing the snapshot holds: a script may handle it.
      sitePage('/script', { content: 'Boots for snow.', first: { role: 'link', name: 'Skip to content', href: '#missing' } }),
    ])
    expect(judged['/button']).toMatchObject({ status: 'review', unverified: [{ kind: 'skip', name: 'Skip to main content' }] })
    expect(judged['/toggle']).toMatchObject({ status: 'review', unverified: [{ kind: 'toggle', name: 'Menu' }] })
    expect(judged['/script']).toMatchObject({ status: 'review', unverified: [{ kind: 'skip' }] })
  })

  it('leaves alone a block too small to matter, content before the menu, and a menu with a link of its own page', () => {
    const judged = judge([
      sitePage('/', { menu: ['Home'], content: 'Spring coats, made to last and easy to repair.' }),
      sitePage('/b', { menu: ['Home'], content: 'Acme has made coats in Porto since 1952.' }),
    ])
    expect(judged['/']).toMatchObject({ status: 'none', reason: 'small' })
    // In a navigation landmark, a link of this page's own (the current section) does not end the block.
    const nav = judge([
      sitePage('/', { nav: true, content: 'Spring coats, made to last and easy to repair.', main: true }),
      sitePage('/sale', { nav: true, extra: 'Sale', content: 'Half price on every coat this week.', main: true }),
    ])
    expect(nav['/sale']?.block.map((unit) => unit.name)).toEqual(['Home', 'Products', 'Sale', 'Pricing', 'Docs', 'Blog', 'Contact'])
    expect(nav['/sale']?.status).toBe('pass')
  })

  it('compares every page of a language, landmarks or not, and reports one finding below the threshold', () => {
    const pages = [
      sitePage('/', { content: 'Spring coats, made to last and easy to repair.' }),
      sitePage('/about', { content: 'Acme has made coats in Porto since 1952.' }),
      sitePage('/stores', { content: 'Our stores are open every day.', main: true }),
    ]
    const report = runSiteCriteria(
      pages.map((page) => siteFactsOf(page)),
      { origin: ORIGIN, locale: 'en', minConfidence: 'medium' },
    )
    // No template set (no landmarks), so 3.2.3 and 3.2.6 compare nothing; 2.4.1 compares all three.
    expect(report.sets).toEqual([])
    expect(report.criteria.map((c) => [c.criterion, c.setsCompared, c.compared])).toEqual([
      ['2.4.1', 1, 3],
      ['3.2.3', 0, 0],
      ['3.2.6', 0, 0],
    ])
    expect(report.findings).toEqual([])
    const [finding] = report.belowThreshold
    expect(finding).toMatchObject({ criterion: '2.4.1', status: 'failure', experimental: true, pages: [u('/'), u('/about')], comparedWith: [u('/stores')] })
    expect(finding?.message).toContain('On /, /about, 6 link(s) and control(s) repeat on other pages of the site')
    expect(finding?.evidence.split('\n')[0]).toBe(
      'on /: 6 repeated item(s) before the content (“Home”, “Products”, “Pricing”, “Docs”, “Blog”, “Contact”); the content starts at “Spring coats, made to last and easy to repair.”; no landmark, heading or skip link after them',
    )
    // The fingerprint names the set and the block, never the pages.
    const again = runSiteCriteria(
      [sitePage('/x', { content: 'Boots for snow.' }), sitePage('/y', { content: 'Hats for the sun.' })].map((page) => siteFactsOf(page)),
      { origin: ORIGIN, locale: 'en', minConfidence: 'low' },
    )
    expect(again.findings[0]?.fingerprint).toBe(finding?.fingerprint)
    expect(bypassBlocks.act).toEqual(['cf77f2'])
  })

  it('settles the pages\' "needs review", which only axe-core\'s bypass gave, when the comparison found a way past every block', () => {
    const pages = [sitePage('/', { content: 'Spring coats.', main: true }), sitePage('/about', { content: 'Acme in Porto since 1952.', main: true })]
    const report = runSiteCriteria(
      pages.map((page) => siteFactsOf(page)),
      { origin: ORIGIN, locale: 'en', minConfidence: 'low' },
    )
    const axe = { kind: 'axe' as const, id: 'bypass', ran: true, applicable: 2, failures: 0, review: 0, reviewOnly: true, maturity: 'stable' as const }
    const record = { id: '2.4.1', level: 'A' as const, target: 'in' as const, status: 'needs-review' as const, methods: [axe], manual: '' }
    const coverage = withSiteCriteria({ engine: [], judged: [], notChecked: [], criteria: [record] }, report, { version: '2.2', locale: 'en', minConfidence: 'low' })
    expect(coverage.criteria?.find((c) => c.id === '2.4.1')?.status).toBe('no-failure-found')
    // Something listed to review on a page keeps it.
    const reviewed = withSiteCriteria({ engine: [], judged: [], notChecked: [], criteria: [{ ...record, methods: [{ ...axe, review: 1 }] }] }, report, { version: '2.2', locale: 'en', minConfidence: 'low' })
    expect(reviewed.criteria?.find((c) => c.id === '2.4.1')?.status).toBe('needs-review')
  })

  it('reads a link into the page from its address, and follows the first link to another page for the ACT measure', () => {
    expect(inPageFragment('#main', u('/a'))).toBe('main')
    expect(inPageFragment(`${u('/a')}#main`, u('/a'))).toBe('main')
    expect(inPageFragment('#top%20section', u('/a'))).toBe('top section')
    expect(inPageFragment('/b#main', u('/a'))).toBeUndefined()
    expect(inPageFragment('#/about', u('/a'))).toBeUndefined()
    expect(inPageFragment('#', u('/a'))).toBeUndefined()
    const page = sitePage('/', { content: 'Spring coats.', first: { role: 'link', name: 'Skip', href: '#content' } })
    expect(firstPageLink(page, page.target)).toBe(u('/home'))
  })
})

describe('the skip-link verdict', () => {
  const el = (ref: string) => ({ ref, id: { tag: 'a', sig: 'a' }, tag: 'a', role: 'link', label: ref })
  const stop = (extra: Partial<SkipStop> = {}): SkipStop => ({
    n: 1,
    el: el('a.skip'),
    fragment: 'main',
    target: { el: el('#main'), rect: { x: 0, y: 0, width: 10, height: 10 } },
    forward: true,
    between: 3,
    after: 2,
    shown: true,
    skipWords: true,
    ...extra,
  })
  const pressed = (extra: Partial<SkipActivation>): SkipActivation => ({ n: 1, ref: 'a.skip', fragment: 'main', hash: '#main', scrolledBy: 0, focus: 'document', targetInView: true, ...extra })
  const next = stop({ n: 2, el: el('nav a'), fragment: undefined, target: undefined })

  it('works when focus or the next Tab goes to the target or past it', () => {
    expect(skipVerdict(stop(), pressed({ focus: 'target' }), next)).toEqual({ works: true, between: 3 })
    expect(skipVerdict(stop(), pressed({ next: { el: el('#main a'), relation: 'inside' } }), next)).toEqual({ works: true, between: 3 })
    // Nothing to reach after the target: Tab wraps to the top of the page, which is not where it went before.
    expect(skipVerdict(stop({ after: 0 }), pressed({ next: { el: el('a.skip'), relation: 'same' } }), next)).toEqual({ works: true, between: 3 })
  })

  it('does not work when the next Tab goes where it went before Enter, or the fragment names nothing', () => {
    expect(skipVerdict(stop(), pressed({ focus: 'link', next: { el: el('nav a'), relation: 'before' } }), next)).toEqual({ works: false, problem: 'not-moved', between: 3 })
    expect(skipVerdict(stop({ after: 0 }), pressed({ focus: 'link', next: { el: el('nav a'), relation: 'before' } }), next)).toMatchObject({ works: false, problem: 'not-moved' })
    expect(skipVerdict(stop({ target: null, forward: undefined }), undefined)).toEqual({ works: false, problem: 'no-target' })
    expect(skipVerdict(stop({ target: null, skipWords: false }), undefined)).toBeUndefined()
    expect(skipVerdict(stop(), pressed({ navigated: true }))).toMatchObject({ works: false, problem: 'navigated' })
  })

  it('works for a screen reader but not for the eye when it never shows', () => {
    expect(skipVerdict(stop({ shown: false }), pressed({ focus: 'target' }), next)).toEqual({ works: true, problem: 'hidden-on-focus', between: 3 })
  })
})

// Integration: needs Chrome or Edge. Skipped, with the reason on stderr, when none starts.
const browser = await launchBrowser({ args: DETERMINISM_ARGS }).catch((error: unknown) => {
  process.stderr.write(`\nSkipping the skip-link probe tests: no browser started (${error instanceof Error ? error.message.split('\n')[0] : String(error)}).\n`)
  return undefined
})
let server: Server | undefined
afterAll(async () => {
  server?.closeAllConnections()
  await new Promise((done) => (server ? server.close(done) : done(undefined)))
  await browser?.close()
}, 60_000)

async function probedPage(name: string): Promise<Report> {
  if (!browser) throw new Error('no browser')
  const url = fixture(name)
  const { snapshot, engine } = await collectWeb(browser, url, { runAxe: true, locale: 'en' })
  snapshot.observations = { probes: [await skipLinkProbe(browser, url, { kinds: ['keyboard'] })] }
  return checkSnapshot(snapshot, engine, probeCheckOptions())
}

const review241 = (report: Report) => (report.needsReview ?? []).filter((item) => item.ruleId === 'rampa/bypass-blocks')
const status241 = (report: Report) => report.coverage.criteria?.find((c) => c.id === '2.4.1')?.status

describe.skipIf(!browser)('the skip-link probe (2.4.1)', { timeout: 120_000 }, () => {
  it('finds a skip link that shows on focus and moves focus to the content', async () => {
    const report = await probedPage('bypass-skip.html')
    expect(review241(report)).toEqual([])
    expect(status241(report)).toBe('no-failure-found')
    const row = report.coverage.probes?.find((c) => c.criterion === '2.4.1')
    expect(row).toMatchObject({ rule: 'rampa/bypass-blocks', method: 'probe/keyboard@1', status: 'no-failure-found', applicable: 1 })
    expect(row?.note).toContain('link “Skip to main content” → #main works (6 element(s) skipped)')
    // axe-core's bypass, which can only pass or ask for review, is settled by the probe rule.
    expect((report.needsReview ?? []).filter((item) => item.ruleId === 'bypass')).toEqual([])
  })

  it('sends to review a skip link that points nowhere, one that does not move focus, and one that never shows', async () => {
    const report = await probedPage('bypass-broken.html')
    const items = review241(report)
    expect(items.map((item) => item.ref)).toEqual(['html > body > a:nth-of-type(1)', '#dead', 'html > body > a:nth-of-type(3)'])
    expect(items[0]?.message).toBe('This skip link points to #content, but nothing on the page has that id or anchor name: it goes nowhere.')
    expect(items[1]?.message).toContain('Pressing Enter on this skip link did not move focus to #main')
    expect(items[1]?.evidence).toContain('after Enter, focus on the link')
    expect(items[2]?.message).toContain('never shows on screen')
    // The page still has a main landmark: the criterion needs review because of the links, not a failure.
    expect(report.findings.filter((f) => f.criterion === '2.4.1')).toEqual([])
    expect(status241(report)).toBe('needs-review')
  })

  it('sends to review a page with links before its content and no way past them, never a failure on one page', async () => {
    const report = await probedPage('bypass-none.html')
    const [item, ...rest] = review241(report)
    expect(rest).toEqual([])
    expect(item?.ref).toBe('html')
    expect(item?.message).toContain('The page starts with 6 link(s) and control(s) before its content')
    expect(item?.evidence).toBe('before the content (“Spring collection”): “Home”, “Products”, “Pricing”, “Docs”, “Blog”, “Contact”')
    expect(report.findings.filter((f) => f.criterion === '2.4.1')).toEqual([])
  })

  it('leaves a skip button to review: the observe class never presses a button', async () => {
    const report = await probedPage('bypass-button.html')
    const [item] = review241(report)
    expect(item?.ref).toBe('html > body > button')
    expect(item?.message).toContain('a control it cannot try (“Skip to main content”)')
  })

  it('runs with --probe keyboard, as a third record next to the two walks', async () => {
    if (!browser) throw new Error('no browser')
    const { snapshot } = await collectWeb(browser, fixture('bypass-skip.html'), { runAxe: false, locale: 'en', probes: ['keyboard'] })
    const probes = snapshot.observations?.probes ?? []
    expect(probes.map((probe) => `${probe.kind} ${probe.conditions.variant}`)).toEqual(['keyboard keyboard-walk', 'keyboard keyboard-walk-390x844', 'keyboard skip-link'])
    // On Chrome on Linux the two walks of this page end partial (docs/probes.md); the skip-link record does not depend on them.
    expect(probes.find((probe) => probe.conditions.variant === 'skip-link')?.status).toBe('complete')
  })
})

describe.skipIf(!browser)('2.4.1 in a crawl', { timeout: 120_000 }, () => {
  it('fails the pages whose repeated menu has no way past it, and not the page with a main landmark', async () => {
    const menu = '<div class="menu"><a href="/">Home</a> <a href="/about">About</a> <a href="/stores">Stores</a> <a href="/blog">Blog</a></div>'
    const pages: Record<string, string> = {
      '/': `${menu}<div><p>Spring coats, made to last and easy to repair.</p></div>`,
      '/about': `${menu}<div><p>Acme has made coats in Porto since 1952.</p></div>`,
      '/stores': `${menu}<main><p>Our stores are open every day of the week.</p></main>`,
    }
    server = createServer((request, response) => {
      const body = pages[request.url ?? '']
      if (request.url === '/robots.txt' || !body) {
        response.writeHead(404, { 'content-type': 'text/plain' })
        response.end('not found')
        return
      }
      response.writeHead(200, { 'content-type': 'text/html' })
      response.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Acme ${request.url}</title></head><body>${body}</body></html>`)
    })
    await new Promise<void>((done) => server?.listen(0, '127.0.0.1', done))
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    const dir = await mkdtemp(join(tmpdir(), 'rampa-bypass-'))
    const output = join(dir, 'site.json')
    const options: CheckCommandOptions = {
      criteria: '2.4.2',
      llm: false,
      runs: '1',
      format: 'json',
      output,
      failOn: 'confirmed',
      minConfidence: 'low',
      cacheDir: join(dir, 'cache'),
      concurrency: '2',
      crawl: true,
      maxPages: '5',
    }
    await runCheck([`${origin}/`], options, { locale: 'en', motion: false, config: {} })
    const report = JSON.parse(await readFile(output, 'utf8')) as SiteReport
    const path = (url: string) => new URL(url).pathname
    const bypass = report.siteCriteria?.findings.filter((finding) => finding.criterion === '2.4.1') ?? []
    expect(bypass.map((finding) => [finding.status, finding.pages.map(path).sort()])).toEqual([['failure', ['/', '/about']]])
    expect(report.siteCriteria?.criteria.find((c) => c.criterion === '2.4.1')).toMatchObject({ setsCompared: 1, compared: 3, findings: 1 })
    const coverage = report.summary.coverage.criteria?.find((c) => c.id === '2.4.1')
    expect(coverage?.status).toBe('failures')
    expect(coverage?.methods.find((m) => m.kind === 'site')).toMatchObject({ id: 'site/2.4.1@1', ran: true, applicable: 3, failures: 1 })
  })
})
