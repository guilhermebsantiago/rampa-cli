import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { type Server, createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Browser } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { exitCode } from '../src/cli/exit-code.ts'
import { applyTextSpacing } from '../src/probes/layout.ts'
import { checkSnapshot } from '../src/core/check.ts'
import { RampaError } from '../src/core/util.ts'
import { paint } from '../src/report/color.ts'
import { renderHtml } from '../src/report/html.ts'
import { renderMarkdown } from '../src/report/markdown.ts'
import { renderReport } from '../src/report/pretty.ts'
import { blockedNote } from '../src/snapshot/blocked.ts'
import { A11ySnapshotSchema } from '../src/snapshot/schema.ts'
import { walkTree } from '../src/snapshot/tree.ts'
import { type BlockedFacts, blockedPage } from '../src/surfaces/bot-check.ts'
import { openPage } from '../src/surfaces/browser-options.ts'
import { collectWeb } from '../src/surfaces/web.ts'
import { launchTestBrowser } from './browser.ts'
import { probeCheckOptions } from './probe-helpers.ts'

// Regression tests for what the robustness study of 2026-10-23 (docs/studies/robustness-2026-10-23.md) found on real
// sites, each condition reproduced by a local page. Integration: Microsoft Edge here, Google Chrome on CI.
const launched = await launchTestBrowser('the robustness tests')
const browser: Browser | undefined = 'browser' in launched ? launched.browser : undefined
if ('skip' in launched) console.warn(launched.skip)

const page = (title: string, body: string, lang = 'en') => `<!doctype html><html lang="${lang}"><head><title>${title}</title></head><body>${body}</body></html>`

/** What HUMAN's captcha does to its frame (seen on zillow.com): every property of the element, its own, reads as undefined, and every method does nothing. */
const MASK = `<script>
  const frame = document.querySelector('#verify iframe')
  for (let proto = Object.getPrototypeOf(frame); proto; proto = Object.getPrototypeOf(proto)) {
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name === 'constructor' || Object.prototype.hasOwnProperty.call(frame, name)) continue
      const described = Object.getOwnPropertyDescriptor(proto, name)
      try { Object.defineProperty(frame, name, { value: typeof described.value === 'function' ? function () {} : undefined, configurable: true }) } catch {}
    }
  }
  // Only its getRootNode() replaced: read as any element, with no root to anchor its id in.
  Object.defineProperty(document.querySelector('#odd'), 'getRootNode', { value: function () {} })
</script>`

let requests: Record<string, number> = {}
const ROUTES: Record<string, (request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse) => void> = {
  '/masked': (_, response) =>
    response.end(page('Shop', `<main><h1>Shop</h1><div id="verify"><iframe title="Human verification challenge" src="about:blank"></iframe></div><p>Fresh fruit every day.</p><p id="odd">Open on Sundays.</p></main>${MASK}`)),
  // Cloudflare's challenge: 403, the cf-mitigated header, and its challenge script's options object.
  '/cloudflare': (_, response) => {
    response.writeHead(403, { 'Content-Type': 'text/html', 'cf-mitigated': 'challenge', server: 'cloudflare' })
    response.end(page('Just a moment...', '<div class="main-wrapper" role="main"><h1>www.example.com</h1><p>Performing security verification</p></div><script>window._cf_chl_opt = { cZone: "www.example.com" }</script>', 'en-US'))
  },
  // Akamai's "Access Denied", as itau.com.br sent it.
  '/akamai': (_, response) => {
    response.writeHead(403, { 'Content-Type': 'text/html', server: 'AkamaiGHost' })
    response.end(
      '<html><head><title>Access Denied</title></head><body><h1>Access Denied</h1>You don\'t have permission to access "http://www.example.com/" on this server.<p>Reference #18.cd290c17.1792762826.467ee9f</p><p>https://errors.edgesuite.net/18.cd290c17.1792762826.467ee9f</p></body></html>',
    )
  },
  // DataDome's captcha: a short page that holds the captcha in a frame from captcha-delivery.com.
  '/datadome': (_, response) => {
    response.writeHead(403, { 'Content-Type': 'text/html' })
    response.end('<html lang="en"><head><title>example.com</title></head><body style="margin:0"><iframe src="/geo.captcha-delivery.com/captcha/" title="DataDome CAPTCHA" width="100%" height="100%"></iframe></body></html>')
  },
  '/geo.captcha-delivery.com/captcha/': (_, response) => response.end(page('DataDome', '<p>Slide right to complete the puzzle</p>')),
  // A site's own short page for a refusal, with no vendor's mark (bb.com.br, mercadolivre.com.br).
  '/refused': (_, response) => {
    response.writeHead(403, { 'Content-Type': 'text/html' })
    response.end('<html><body><h1>Ops!</h1><h2>Erro no acesso.</h2><p>Por favor, confira a URL requisitada ou volte para a <a href="/">página inicial</a>.</p></body></html>')
  },
  // A site's own 404 page, checked as the page that came, with a note.
  '/missing': (_, response) => {
    response.writeHead(404, { 'Content-Type': 'text/html' })
    response.end(page('Page not found', '<main><h1>Page not found</h1><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" width="40" height="40"><a href="/">Home</a></main>'))
  },
  // A loading screen that says "Just a moment": a page of the site, sent with 200 and no vendor's header.
  '/loading': (_, response) => response.end(page('Just a moment...', '<main><h1>Loading your dashboard</h1><p>Please wait.</p></main>')),
  // An interstitial that sets a cookie and reloads (amazon.com answers 202 so), then a page whose body arrives after the wait after load gave up.
  '/interstitial': (request, response) => {
    if (!(request.headers.cookie ?? '').includes('passed=1')) {
      response.writeHead(202, { 'Content-Type': 'text/html' })
      return void response.end('<html class="a-no-js"><head><script>document.cookie = "passed=1; path=/"; setTimeout(() => location.reload(), 100)</script></head><body></body></html>')
    }
    response.writeHead(200, { 'Content-Type': 'text/html' })
    response.write('<!doctype html><html lang="en"><head><title>Store</title></head>')
    setTimeout(() => response.end('<body><main><h1>Store</h1><p>Spend less, smile more.</p></main></body></html>'), 4000)
  },
  // An HTTP error with an empty body, which the browser fails the navigation on (x.com answers automated browsers so).
  '/empty-403': (_, response) => void response.writeHead(403).end(),
  // A custom element whose class defines a `style` of its own, as YouTube's yt-attributed-string does (a symbol).
  '/own-style': (_, response) =>
    response.end(
      page(
        'Videos',
        '<main><h1>Videos</h1><p>Watch <x-text>this</x-text> now.</p></main><script>customElements.define("x-text", class extends HTMLElement { get style() { return Symbol("bi") } })</script>',
      ),
    ),
  // A page whose load event never fires: an image that never arrives, as an ad that keeps loading (uol.com.br, folha.uol.com.br).
  '/never-loads': (_, response) => response.end(page('News', '<main><h1>Today</h1><p>The headlines are here.</p><img src="/hang" alt="" width="300" height="250"></main>')),
  '/hang': () => undefined,
  // Connections cut, then an empty 403 once they go through: the second try's error is the one that says why.
  '/cut-then-403': (request, response) => {
    if ((requests['/cut-then-403'] ?? 0) <= 2) return void request.socket.destroy()
    response.writeHead(403).end()
  },
  // A connection cut on the first request only, as a network that drops for a moment does.
  '/flaky': (request, response) => {
    // Chromium tries a request again once by itself when its connection is cut, so two cut connections make one failed navigation.
    if ((requests['/flaky'] ?? 0) <= 2) return void request.socket.destroy()
    response.end(page('Flaky', '<main><h1>Back</h1></main>'))
  },
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
})
afterAll(async () => {
  server?.closeAllConnections()
  await new Promise((done) => server?.close(done))
  await browser?.close()
}, 60_000)

const texts = (root: import('../src/snapshot/schema.ts').A11yNode) => [...walkTree(root)].map((node) => node.text ?? '').join(' ')

describe.skipIf(!browser)('pages real sites sent the collector', { timeout: 120_000 }, () => {
  const collect = (path: string, extra: Partial<Parameters<typeof collectWeb>[2]> = {}) => collectWeb(browser as Browser, `${origin}${path}`, { runAxe: true, locale: 'en', ...extra })

  it('reads a page where a script masked an element, leaving the element out and saying so', async () => {
    const { snapshot, engine } = await collect('/masked', { captureImages: true, presentation: true })
    expect(() => A11ySnapshotSchema.parse(snapshot)).not.toThrow()
    expect(snapshot.reach?.masked).toBe(1)
    expect(texts(snapshot.root)).toContain('Fresh fruit every day.')
    expect(texts(snapshot.root)).toContain('Open on Sundays.')
    expect([...walkTree(snapshot.root)].some((node) => node.native.tag === 'iframe')).toBe(false)
    // axe-core stops on the masked element: the check goes on without it, and says so.
    expect(engine).toMatchObject({ engine: { name: 'none' }, rules: [], error: expect.stringMatching(/^axe-core: TypeError: /) })
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    expect(report.notes?.[0]).toMatch(/^The engine stopped with an error on this page \(axe-core: TypeError: .+\), so none of its rules ran/)
    expect(report.notes).toContain(
      "1 element(s) had their DOM properties masked by a page script, so that reading them gives nothing (bot checks hide their frames so from automated browsers): they and what they hold are not in the snapshot, so Rampa's rules and the judged criteria did not read them.",
    )
  })

  it('does not check a bot check sent in place of the page, says what it was, and the run exits 2', async () => {
    const { snapshot, engine } = await collect('/cloudflare', { probes: ['keyboard'], presentation: true, captureImages: true })
    expect(() => A11ySnapshotSchema.parse(snapshot)).not.toThrow()
    expect(snapshot.blocked).toEqual({ kind: 'challenge', vendor: 'Cloudflare', evidence: 'header', detail: 'cf-mitigated: challenge', status: 403, title: 'Just a moment...' })
    expect(snapshot.root.children).toEqual([])
    expect(engine).toEqual({ engine: { name: 'none', version: '0' }, rules: [] })
    expect(snapshot.observations?.probes.map((record) => `${record.kind} ${record.status} ${record.reason}`)).toEqual(['keyboard skipped not run: the site sent a bot check or a refusal in place of the page'])
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions({ minConfidence: 'medium' }))
    expect(report.findings).toEqual([])
    expect(report.needsReview ?? []).toEqual([])
    expect(report.coverage.notChecked).toHaveLength(55)
    expect(report.blocked?.vendor).toBe('Cloudflare')
    expect(report.notes?.[0]).toBe(
      "The site sent a bot check (Cloudflare) in place of the page, with HTTP 403 (the response header cf-mitigated: challenge). That page is not the site's, so nothing on it was checked, and the run cannot vouch for this address (rampa check exits 2). Rampa never solves or gets around a bot check: if the site is yours, let the machine that runs Rampa through (an allow rule, or a header the protection accepts, sent with --header), or check a copy without the protection.",
    )
    expect(exitCode([report], 'none')).toBe(2)
    // No report format reads it as a pass.
    const headline = 'Nothing on this page was checked: the site sent a bot check or a refusal in place of it.'
    expect(renderReport(report, { verbose: false, paint: paint(false) })).toContain(headline)
    expect(renderReport(report, { verbose: false, paint: paint(false) })).not.toContain('No confirmed failures')
    expect(renderMarkdown([report])).toContain(`**${headline}**`)
    expect(renderHtml([report])).toContain(headline)
    // The cognitive profile has nothing to screen either: no check says it ran.
    const profiled = await checkSnapshot(snapshot, engine, probeCheckOptions({ profiles: ['cognitive'] }))
    expect(new Set(profiled.advisory?.checks.map((check) => `${check.ran} ${check.reason}`))).toEqual(new Set(['false not run: the site sent a bot check or a refusal in place of the page']))
  })

  it("recognizes Akamai's and DataDome's pages by their marks, and a site's own short refusal by its status", async () => {
    const akamai = await collect('/akamai')
    expect(akamai.snapshot.blocked).toMatchObject({ kind: 'challenge', vendor: 'Akamai', evidence: 'mark', detail: 'Reference 18.cd290c17.1792762826.467ee9f', status: 403 })
    const datadome = await collect('/datadome')
    expect(datadome.snapshot.blocked).toMatchObject({ kind: 'challenge', vendor: 'DataDome', evidence: 'mark', detail: 'captcha-delivery.com' })
    const refused = await collect('/refused')
    expect(refused.snapshot.blocked).toEqual({ kind: 'refused', evidence: 'status', detail: 'HTTP 403', status: 403 })
    const report = await checkSnapshot(refused.snapshot, refused.engine, probeCheckOptions({ locale: 'pt-BR' }))
    expect(report.notes?.[0]).toMatch(/^O site recusou a página com HTTP 403 e mandou uma página curta no lugar, como proteções contra robôs fazem/)
  })

  it("checks a site's own error page as the page that came, and says with which status", async () => {
    const { snapshot, engine } = await collect('/missing')
    expect(snapshot.blocked).toBeUndefined()
    expect(snapshot.httpStatus).toBe(404)
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    expect(report.findings.map((finding) => finding.ruleId)).toContain('image-alt')
    expect(report.httpStatus).toBe(404)
    expect(report.notes?.[0]).toBe('The server answered HTTP 404 for this address: what was checked is the page that came with that status, an error page, not the page the address names.')
    expect(exitCode([report], 'none')).toBe(0)
  })

  it("spaces the text of a custom element whose class hides its inline style, as on youtube.com (probe layout, 1.4.12)", async () => {
    const context = await (browser as Browser).newContext()
    try {
      const tab = await context.newPage()
      await tab.goto(`${origin}/own-style`)
      const count = await tab.evaluate(applyTextSpacing, { wordSpacing: true })
      expect(count).toBeGreaterThanOrEqual(6)
      const spaced = await tab.evaluate(() => Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'style')?.get?.call(document.querySelector('x-text'))?.getPropertyValue('line-height'))
      expect(spaced).toBe('1.5')
    } finally {
      await context.close()
    }
  })

  it('checks a page of the site whose title says "Just a moment", and a local file titled as a challenge, as any page', async () => {
    const { snapshot } = await collect('/loading')
    expect(snapshot.blocked).toBeUndefined()
    expect(snapshot.title).toBe('Just a moment...')
    // Only a server sends a bot check: a local file is read whatever its title says.
    const file = join(mkdtempSync(join(tmpdir(), 'rampa-challenge-')), 'captcha.html')
    writeFileSync(file, page('Prove your humanity', '<main><h1>Our captcha, in design review</h1></main>'))
    const local = await collectWeb(browser as Browser, pathToFileURL(file).href, { runAxe: false, locale: 'en' })
    expect(local.snapshot.blocked).toBeUndefined()
    expect(texts(local.snapshot.root)).toContain('Our captcha, in design review')
  })

  it('reads a page whose load event never fires as it is when the timeout runs out, and says so; a page that never arrives still fails', async () => {
    const { snapshot, engine } = await collect('/never-loads', { timeoutMs: 1500 })
    expect(snapshot.reach?.loadTimedOutMs).toBe(1500)
    expect(texts(snapshot.root)).toContain('The headlines are here.')
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    expect(report.notes?.[0]).toBe(
      "The page's load event had not fired after 1500 ms (--timeout), often because an ad or a widget keeps loading: Rampa read the page as it was then, so what was still loading may be missing.",
    )
    await expect(collect('/hang', { timeoutMs: 800 })).rejects.toThrow('did not reach load within 800 ms')
  })

  it('reads the page an interstitial reloads into once it has loaded, not half parsed', async () => {
    const { snapshot } = await collect('/interstitial')
    expect(snapshot.title).toBe('Store')
    expect(texts(snapshot.root)).toContain('Spend less, smile more.')
    expect(snapshot.httpStatus).toBeUndefined()
  })
})

describe.skipIf(!browser)('pages the browser could not load', { timeout: 60_000 }, () => {
  const open = async (url: string) => {
    const context = await (browser as Browser).newContext()
    try {
      return await openPage(await context.newPage(), url)
    } finally {
      await context.close()
    }
  }

  it('says in words why a page could not be loaded, without the browser library call log', async () => {
    const closed = createServer()
    await new Promise<void>((done) => closed.listen(0, '127.0.0.1', done))
    const port = (closed.address() as AddressInfo).port
    await new Promise((done) => closed.close(done))
    const refused = await open(`http://127.0.0.1:${port}/`).catch((error: unknown) => error)
    expect(refused).toBeInstanceOf(RampaError)
    expect((refused as Error).message).toBe(`http://127.0.0.1:${port}/ could not be loaded (net::ERR_CONNECTION_REFUSED): nothing answered at that address.`)
    const empty = await open(`${origin}/empty-403`).catch((error: unknown) => error)
    expect((empty as Error).message).toBe(
      `${origin}/empty-403 could not be loaded (net::ERR_HTTP_RESPONSE_CODE_FAILURE): the server answered with an HTTP error (403) and an empty page, as some bot protection does with automated browsers.`,
    )
  })

  it('tries once more when the connection is cut, as a network that drops for a moment does', async () => {
    requests = {}
    const response = await open(`${origin}/flaky`)
    expect(response?.status()).toBe(200)
    expect(requests['/flaky']).toBeGreaterThanOrEqual(3)
    // A second try that fails another way says why with its own error.
    const refused = await open(`${origin}/cut-then-403`).catch((error: unknown) => error)
    expect((refused as Error).message).toBe(
      `${origin}/cut-then-403 could not be loaded (net::ERR_EMPTY_RESPONSE, then net::ERR_HTTP_RESPONSE_CODE_FAILURE on a second try): the server answered with an HTTP error (403) and an empty page, as some bot protection does with automated browsers.`,
    )
  })
})

describe.skipIf(!browser)('rampa check on a bot check', { timeout: 120_000 }, () => {
  it('exits 2 and says on stderr that nothing was checked', async () => {
    const child = spawn(process.execPath, ['src/cli.ts', 'check', `${origin}/akamai`, '--no-llm', '--format', 'json'], {
      env: { ...process.env, NO_COLOR: '1', RAMPA_LOCALE: 'en', RAMPA_MODEL: '' },
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr.on('data', (chunk) => (stderr += chunk))
    const code = await new Promise((done) => child.on('close', done))
    expect(code).toBe(2)
    expect(stderr).toContain(`rampa: ${origin}/akamai: the site sent a bot check or a refusal in place of the page, so nothing was checked; the report says what it sent.`)
    const report = JSON.parse(stdout) as { findings: unknown[]; blocked: { vendor: string }; notes: string[] }
    expect(report.findings).toEqual([])
    expect(report.blocked.vendor).toBe('Akamai')
    expect(report.notes[0]).toMatch(/^The site sent a bot check \(Akamai\) in place of the page, with HTTP 403 \(its mark on the page: Reference 18\.cd290c17/)
  })
})

describe('telling a bot check from a page', () => {
  const facts = (overrides: Partial<BlockedFacts> = {}): BlockedFacts => ({ title: '', text: 200, elements: 30, marks: [], ...overrides })

  it("needs a vendor's header, its mark on a short page, a challenge title, or a refusal", () => {
    expect(blockedPage(facts({ title: 'Prove your humanity' }), { status: 200, headers: {} })).toMatchObject({ kind: 'challenge', evidence: 'title' })
    expect(blockedPage(facts({ title: 'Just a moment...' }), { status: 200, headers: {} })).toBeUndefined()
    expect(blockedPage(facts({ title: 'Just a moment...' }), { status: 503, headers: {} })).toMatchObject({ kind: 'challenge', evidence: 'title', status: 503 })
    // A vendor's header is on every page of the sites behind it: with a 200, such a title is the site's own page.
    expect(blockedPage(facts({ title: 'Acesso negado' }), { status: 200, headers: { server: 'AkamaiGHost', 'cf-ray': '8f1' } })).toBeUndefined()
    expect(blockedPage(facts({ title: 'Acesso negado' }), { status: 403, headers: { server: 'AkamaiGHost' } })).toMatchObject({ vendor: 'Akamai', evidence: 'title' })
    expect(blockedPage(facts(), { status: 429, headers: { server: 'cloudflare' } })).toEqual({ kind: 'refused', vendor: 'Cloudflare', evidence: 'status', detail: 'HTTP 429', status: 429 })
    expect(blockedNote({ kind: 'refused', vendor: 'Cloudflare', evidence: 'status', detail: 'HTTP 403', status: 403, title: 'Ops!' }, 'en')).toMatch(
      /^The site refused the page with HTTP 403 \(Cloudflare\) and sent a short page in its place, "Ops!", as bot protection does with automated browsers\. That page/,
    )
    expect(blockedPage(facts(), { status: 404, headers: {} })).toBeUndefined()
    expect(blockedPage(facts(), undefined)).toBeUndefined()
  })

  it("checks a site's own long page as usual, whatever vendor script or status it has, unless the vendor's header names a challenge", () => {
    const long = facts({ text: 8000, elements: 1200, marks: [{ vendor: 'DataDome', detail: 'captcha-delivery.com' }], title: 'Access denied' })
    expect(blockedPage(long, { status: 403, headers: {} })).toBeUndefined()
    expect(blockedPage(long, { status: 403, headers: { 'cf-mitigated': 'challenge' } })).toMatchObject({ vendor: 'Cloudflare', evidence: 'header' })
  })
})
