import { type Server, createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Browser } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { memoryCache } from '../src/core/cache.ts'
import { checkSnapshot } from '../src/core/check.ts'
import { resolveCriteria } from '../src/criteria/index.ts'
import type { JudgeRequest, ModelProvider } from '../src/providers/types.ts'
import { pixelFactOf } from '../src/snapshot/pixel-contrast.ts'
import { walkTree } from '../src/snapshot/tree.ts'
import { collectWeb } from '../src/surfaces/web.ts'
import { launchTestBrowser } from './browser.ts'

// Regression tests for the two capture events behind most of the third real-page study's test-half false positives
// (docs/studies/notes-precision-probe.md): a page read without its stylesheets (www.ufpe.br), and a layer over the
// viewport while pixels were measured (www.ed.ac.uk's consent backdrop). Integration: Microsoft Edge here, Chrome on CI.
const launched = await launchTestBrowser('the capture guard tests')
const browser: Browser | undefined = 'browser' in launched ? launched.browser : undefined
if ('skip' in launched) console.warn(launched.skip)

const page = (title: string, head: string, body: string) => `<!doctype html><html lang="en"><head><title>${title}</title>${head}</head><body>${body}</body></html>`

/** A hidden type-ahead list, as www.ufpe.br's: two entries share a text and lead to two places. Styled, the list does not show. */
const LISTING = '<main><h1>Departments</h1><p>Find a department.</p><ul id="search-list" class="dropdown-menu"><li><a href="/caa/documentos">Documentos</a></li><li><a href="/cav/documentos">Documentos</a></li></ul></main>'

/** A site's page: a header menu of 60 departments, a footer of 60 more and paragraphs of text, around the hidden list. */
const PLAIN_SITE = `<header><nav><ul>${Array.from({ length: 60 }, (_, i) => `<li><a href="/department/${i}">Department number ${i}</a></li>`).join('')}</ul></nav></header>${LISTING}<section>${Array.from({ length: 20 }, (_, i) => `<p>Paragraph ${i} of the page, long enough to be body text.</p>`).join('')}</section><footer><ul>${Array.from({ length: 60 }, (_, i) => `<li><a href="/service/${i}">Service number ${i}</a></li>`).join('')}</ul></footer>`

const requests: Record<string, number> = {}
// A second origin for the same server (localhost against 127.0.0.1), set once the server listens.
let other = ''
const ROUTES: Record<string, (request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse) => void> = {
  // The theme stylesheet is missing: the page is read as the browser shows it without styles, after one more load.
  '/unstyled': (_, response) => response.end(page('Departments', '<link rel="stylesheet" href="/theme-missing.css">', LISTING)),
  '/theme-missing.css': (_, response) => void response.writeHead(404).end(),
  // The stylesheet fails once and loads on the next request: the retry gives a styled page.
  '/flaky': (_, response) => response.end(page('Departments', '<link rel="stylesheet" href="/theme-flaky.css">', LISTING)),
  '/theme-flaky.css': (_, response) => {
    if ((requests['/theme-flaky.css'] ?? 0) <= 1) return void response.writeHead(404).end()
    response.writeHead(200, { 'Content-Type': 'text/css' })
    response.end('.dropdown-menu { display: none } body { font-family: Arial }')
  },
  // A styled page: nothing to record.
  '/styled': (_, response) => response.end(page('Departments', '<link rel="stylesheet" href="/theme.css">', LISTING)),
  '/theme.css': (_, response) => {
    response.writeHead(200, { 'Content-Type': 'text/css' })
    response.end('.dropdown-menu { display: none } body { font-family: Arial }')
  },
  // museudoamanha.org.br in the fourth real-page study: a site's page served with no style at all, its body text in
  // the browser's default look. Loaded once more, then read as unstyled.
  '/plain-site': (_, response) => response.end(page('Departments', '', PLAIN_SITE)),
  // The same look on a page this small (an ACT test case, a fixture) is a page written without CSS: read as it is.
  '/plain-small': (_, response) => response.end(page('Departments', '', LISTING)),
  // A site's page with a style element: its styles applied, whatever its body font.
  '/plain-styled': (_, response) => response.end(page('Departments', '<style>.dropdown-menu { display: none }</style>', PLAIN_SITE)),
  // www.thejournal.ie: a stylesheet link whose address is the page itself, the only one on the page's origin; the
  // theme comes from another origin and applies.
  '/self-link': (_, response) => response.end(page('Departments', `<link rel="stylesheet" href="/self-link"><link rel="stylesheet" href="${other}/theme.css">`, LISTING)),
  // A consent backdrop in a closed shadow root over text on a gradient, which axe-core leaves to the pixels.
  '/overlay': (_, response) =>
    response.end(
      page(
        'Study',
        '<style>main { padding: 40px } .card { background: linear-gradient(#ffffff, #fdfdfd); color: #111111; padding: 24px; font-size: 18px }</style>',
        '<main><h1>Study</h1><p class="card">Study with us today and tomorrow.</p><p>Plain text under the card.</p></main><x-consent></x-consent><script>customElements.define("x-consent", class extends HTMLElement { connectedCallback() { const root = this.attachShadow({ mode: "closed" }); root.innerHTML = "<div style=\\"position: fixed; inset: 0; background: rgba(0, 0, 0, 0.5); z-index: 1000\\"></div>" } })</script>',
      ),
    ),
  // An application whose root is a custom element that holds the whole page: not a layer over it.
  '/app': (_, response) =>
    response.end(page('App', '', '<x-app><main><h1>Dashboard</h1><p>Welcome back. Your orders, your returns and your settings are below.</p><p>More text so the app holds the page.</p></main></x-app><script>customElements.define("x-app", class extends HTMLElement {})</script>')),
}

let server: Server | undefined
let origin = ''
beforeAll(async () => {
  server = createServer((request, response) => {
    const path = (request.url ?? '/').split('?')[0] ?? '/'
    requests[path] = (requests[path] ?? 0) + 1
    const route = ROUTES[path]
    if (!route) return void response.writeHead(404).end()
    if (!response.hasHeader('Content-Type')) response.setHeader('Content-Type', 'text/html')
    route(request, response)
  })
  await new Promise<void>((done) => server?.listen(0, '127.0.0.1', done))
  origin = `http://127.0.0.1:${(server?.address() as AddressInfo).port}`
  other = `http://localhost:${(server?.address() as AddressInfo).port}`
})
afterAll(async () => {
  server?.closeAllConnections()
  await new Promise((done) => server?.close(done))
  await browser?.close()
}, 60_000)

const collect = (path: string, extra: Partial<Parameters<typeof collectWeb>[2]> = {}) => collectWeb(browser as Browser, `${origin}${path}`, { runAxe: true, locale: 'en', ...extra })

/** A model that fails every link as ambiguous, as the first pass did on www.ufpe.br's hidden list. */
function failsLinks(): ModelProvider {
  return {
    id: 'test:fails',
    async judge<T>(request: JudgeRequest<T>) {
      const link = /<link>([\s\S]*?)<\/link>/.exec(request.user)?.[1] ?? ''
      const output = { promises: '', leadsTo: '', verdict: 'fail', evidence: link, problem: 'ambiguous', suggestedText: `${link} do CAA`, confidence: 'high' }
      return { output: request.schema.parse(output), inputTokens: 10, outputTokens: 5, latencyMs: 1, modelId: 'fails' }
    },
  }
}

describe.skipIf(!browser)('a page read without its stylesheets', () => {
  it('loads the page once more, records the stylesheets that did not apply, measures no pixels, and makes every judgment a suggestion', { timeout: 60_000 }, async () => {
    const { snapshot, engine } = await collect('/unstyled', { pixelContrast: true })
    expect(requests['/unstyled']).toBe(2)
    expect(snapshot.reach?.stylesheets).toMatchObject({ linked: 1, applied: 0, unstyled: true, retried: true })
    expect(snapshot.reach?.stylesheets?.failed).toEqual([{ href: `${origin}/theme-missing.css`, reason: 'HTTP 404' }])
    expect(snapshot.root.native.pixelContrastRun).toBeUndefined()
    const report = await checkSnapshot(snapshot, engine, {
      criteria: resolveCriteria(['2.4.4']),
      llm: true,
      provider: failsLinks(),
      runs: 1,
      cache: memoryCache(),
      offline: false,
      locale: 'en',
      minConfidence: 'medium',
      concurrency: 2,
    })
    expect(report.findings.filter((f) => f.source === 'judgment')).toHaveLength(0)
    const suggestions = (report.needsReview ?? []).filter((item) => item.model)
    expect(suggestions.length).toBeGreaterThanOrEqual(2)
    expect(suggestions[0]?.evidence).toContain('read without its stylesheets')
    expect(report.notes?.[0]).toContain('The page was read without its own stylesheets, even after one more load')
    expect(report.coverage.reach?.stylesheets?.unstyled).toBe(true)
  })

  it('is read styled when the stylesheet loads on the second try, and says it was loaded again', { timeout: 60_000 }, async () => {
    const { snapshot } = await collect('/flaky')
    expect(snapshot.reach?.stylesheets).toEqual({ linked: 1, applied: 1, failed: [], retried: true })
    const list = [...walkTree(snapshot.root)].find((node) => node.native.attributes && (node.native.attributes as Record<string, string>).id === 'search-list')
    expect(list?.states).toContain('hidden')
  })

  it('records nothing for a page whose stylesheets applied', { timeout: 60_000 }, async () => {
    const { snapshot } = await collect('/styled')
    expect(snapshot.reach?.stylesheets).toBeUndefined()
    expect(requests['/styled']).toBe(1)
  })
})

describe.skipIf(!browser)('a page served with no style at all', () => {
  it("reads a site's page whose body text has the browser's default look as unstyled, after one more load", { timeout: 60_000 }, async () => {
    const { snapshot, engine } = await collect('/plain-site', { pixelContrast: true })
    expect(requests['/plain-site']).toBe(2)
    expect(snapshot.reach?.stylesheets).toEqual({ linked: 0, applied: 0, failed: [], unstyled: true, retried: true })
    expect(snapshot.root.native.authorStyles).toBe(0)
    expect(snapshot.root.native.pixelContrastRun).toBeUndefined()
    const report = await checkSnapshot(snapshot, engine, {
      criteria: resolveCriteria(['2.4.4']),
      llm: true,
      provider: failsLinks(),
      runs: 1,
      cache: memoryCache(),
      offline: false,
      locale: 'en',
      minConfidence: 'medium',
      concurrency: 2,
    })
    expect(report.findings.filter((f) => f.source === 'judgment')).toHaveLength(0)
    expect((report.needsReview ?? []).filter((item) => item.model).length).toBeGreaterThanOrEqual(2)
    expect(report.notes?.[0]).toContain('The page came with no stylesheet applied, even after one more load')
    expect(report.coverage.reach?.stylesheets?.unstyled).toBe(true)
  })

  it("reads a small page with the default look as it is, and a site's page with a style element as styled", { timeout: 60_000 }, async () => {
    const small = await collect('/plain-small')
    expect(small.snapshot.reach?.stylesheets).toBeUndefined()
    expect(requests['/plain-small']).toBe(1)
    const styled = await collect('/plain-styled')
    expect(styled.snapshot.reach?.stylesheets).toBeUndefined()
    expect(styled.snapshot.root.native.authorStyles).toBe(1)
    expect(requests['/plain-styled']).toBe(1)
  })

  it('does not count a stylesheet link to the page itself (www.thejournal.ie)', { timeout: 60_000 }, async () => {
    const { snapshot } = await collect('/self-link')
    expect(snapshot.reach?.stylesheets).toBeUndefined()
    // The page, and the browser asking for it once more as a stylesheet: no reload.
    expect(requests['/self-link']).toBe(2)
  })
})

describe.skipIf(!browser)('a layer over the viewport while pixels are measured', () => {
  it('hides a consent backdrop in a closed shadow root while contrast is captured, and records it', { timeout: 60_000 }, async () => {
    const { snapshot } = await collect('/overlay', { pixelContrast: true })
    expect(snapshot.reach?.overlay).toMatchObject({ selector: 'x-consent', hidden: true })
    expect(snapshot.reach?.overlay?.coverage).toBeGreaterThanOrEqual(0.75)
    const card = [...walkTree(snapshot.root)].find((node) => node.text?.startsWith('Study with us'))
    const fact = card ? pixelFactOf(card, 'text') : undefined
    expect(fact?.status).toBe('measured')
    // Dimmed by the backdrop, #111111 on #ffffff reads about 4:1; the page's own pixels give over 15:1.
    expect(fact?.highest ?? 0).toBeGreaterThan(10)
  })

  it('does not take an application\'s root element for a layer over the page', { timeout: 60_000 }, async () => {
    const { snapshot } = await collect('/app')
    expect(snapshot.reach?.overlay).toBeUndefined()
  })
})
