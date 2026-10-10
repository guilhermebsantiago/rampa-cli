import { readFileSync } from 'node:fs'
import { type Server, createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Browser, Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { memoryCache } from '../src/core/cache.ts'
import { checkSnapshot } from '../src/core/check.ts'
import type { EngineResults, Finding } from '../src/core/types.ts'
import { tryDecodePng } from '../src/pixels/png.ts'
import { type PlaywrightPage, collectPage, playwrightDriver } from '../src/playwright.ts'
import { installKit } from '../src/probes/kit.ts'
import { type PuppeteerPage, puppeteerDriver } from '../src/puppeteer.ts'
import { coverageStatement } from '../src/report/common.ts'
import { createLocator } from '../src/source/locate.ts'
import { reachNotes, unreached } from '../src/snapshot/reach.ts'
import { resolveRefInPage } from '../src/snapshot/refs.ts'
import { A11ySnapshotSchema, type A11ySnapshot } from '../src/snapshot/schema.ts'
import { walkTree } from '../src/snapshot/tree.ts'
import { buildReach } from '../src/surfaces/reach.ts'
import { collectWeb } from '../src/surfaces/web.ts'
import { launchTestBrowser } from './browser.ts'
import { node } from './helpers.ts'

// Integration: Microsoft Edge here, Google Chrome on CI (RAMPA_BROWSER_CHANNEL=chrome). Skipped, with the reason, without a browser.
const launched = await launchTestBrowser('the collector reach tests')
const browser: Browser | undefined = 'browser' in launched ? launched.browser : undefined
if ('skip' in launched) console.warn(launched.skip)

/**
 * The page is served from 127.0.0.1 and its #remote frame from localhost: another origin (and another site, so
 * Chromium may put it in another process), which the page's own scripts cannot read.
 */
const ACT_AKN7BN: Record<string, string> = {
  // ACT akn7bn's own test cases, as published.
  '/akn7bn-failed-1': '<!DOCTYPE html><html lang="en"><head><title>Failed Example 1</title></head><body><iframe tabindex="-1" srcdoc="<a href=\'/\'>Home</a>"></iframe></body></html>',
  '/akn7bn-passed-1': '<!DOCTYPE html><html lang="en"><head><title>Passed Example 1</title></head><body><iframe srcdoc="<a href=\'/\'>Home</a>"></iframe></body></html>',
  '/akn7bn-inapplicable-1': '<!DOCTYPE html><html lang="en"><head><title>Inapplicable Example 1</title></head><body><iframe tabindex="-1" srcdoc="<h1>Hello world</h1>"></iframe></body></html>',
}
let server: Server | undefined
let origin = ''
beforeAll(async () => {
  server = createServer((request, response) => {
    const port = (server?.address() as AddressInfo).port
    response.setHeader('Content-Type', 'text/html')
    const path = request.url ?? '/'
    if (path in ACT_AKN7BN) return void response.end(ACT_AKN7BN[path])
    if (path.startsWith('/widget')) return void response.end(readFileSync('test/fixtures/reach/widget.html', 'utf8'))
    // A lazy frame far below the fold: the browser has not loaded it when the page is read.
    if (path === '/lazy') return void response.end('<!doctype html><html lang="en"><head><title>Lazy</title></head><body><h1>Lazy</h1><div style="height:8000px"></div><iframe id="later" title="Later" loading="lazy" src="/widget.html"></iframe></body></html>')
    response.end(readFileSync('test/fixtures/reach/page.html', 'utf8').replace('{{REMOTE}}', `http://localhost:${port}/widget.html`))
  })
  await new Promise<void>((done) => server?.listen(0, '127.0.0.1', done))
  origin = `http://127.0.0.1:${(server?.address() as AddressInfo).port}`
})
afterAll(async () => {
  server?.closeAllConnections()
  await new Promise((done) => server?.close(done))
  await browser?.close()
}, 60_000)

const violations = (engine: EngineResults) =>
  engine.rules
    .filter((rule) => rule.outcome === 'violation')
    .flatMap((rule) => rule.nodes.map((node) => `${rule.ruleId} ${node.ref}`))
    .sort()

describe.skipIf(!browser)('axe-core in every frame', { timeout: 60_000 }, () => {
  it('checks frames of the same origin, nested frames, frames of another origin and open shadow roots, each result in its frame', async () => {
    if (!browser) return
    const { engine } = await collectWeb(browser, `${origin}/page.html`, { runAxe: true, locale: 'en' })
    expect(violations(engine)).toEqual([
      'button-name #outer |> html > body > iframe |> html > body > button',
      'button-name html > body > main > shadow-card >>> div:nth-of-type(2) > button',
      'frame-focusable-content html > body > main > iframe:nth-of-type(2) |> html',
      'image-alt #local |> html > body > img',
      // Another origin: the page cannot read the frame, so the frame's ref is followed by axe-core's own selector in it.
      'image-alt #remote |> img',
    ])
    // axe-core's own target keeps the frame path too.
    const remote = engine.rules.find((rule) => rule.ruleId === 'image-alt' && rule.outcome === 'violation')?.nodes.find((node) => node.ref?.startsWith('#remote'))
    expect(JSON.parse(remote?.target ?? '[]')).toEqual(['#remote', 'img'])
  })

  it('finds ACT akn7bn Failed Example 1, and nothing on its passed and inapplicable examples', async () => {
    if (!browser) return
    const outcome = async (path: string) => {
      const { engine } = await collectWeb(browser, `${origin}${path}`, { runAxe: true, locale: 'en' })
      return engine.rules.find((rule) => rule.ruleId === 'frame-focusable-content')?.outcome ?? 'not run'
    }
    expect(await outcome('/akn7bn-failed-1')).toBe('violation')
    expect(await outcome('/akn7bn-passed-1')).not.toBe('violation')
    expect(await outcome('/akn7bn-inapplicable-1')).not.toBe('violation')
  })

})

/** A Playwright page of its own, on the fixture, closed after the callback. */
async function onPage<T>(path: string, use: (page: Page) => Promise<T>): Promise<T> {
  if (!browser) throw new Error('no browser')
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  try {
    const page = await context.newPage()
    await page.goto(`${origin}${path}`)
    return await use(page)
  } finally {
    await context.close()
  }
}

const refsOf = (snapshot: A11ySnapshot) => [...walkTree(snapshot.root)].map((n) => n.ref)
/** Images compared by presence: rendering may differ by a pixel between two captures. */
const comparable = (snapshot: A11ySnapshot) =>
  JSON.parse(JSON.stringify({ ...snapshot, collectedAt: '' }, (key, value) => (key === 'image' ? typeof value === 'string' && value.startsWith('data:image/png') : value)))

describe.skipIf(!browser)('the snapshot past the top document', { timeout: 60_000 }, () => {
  it('holds open shadow roots and frames of the same origin, nested ones too, under their host and frame', async () => {
    if (!browser) return
    const { snapshot } = await collectWeb(browser, `${origin}/page.html`, { runAxe: true, locale: 'en' })
    expect(A11ySnapshotSchema.safeParse(snapshot).success).toBe(true)
    const refs = refsOf(snapshot)
    expect(refs).toEqual(
      expect.arrayContaining([
        '#local |> html',
        '#local |> html > body > img',
        '#outer |> html > body > iframe |> html > body > button',
        'html > body > main > shadow-card >>> div:nth-of-type(1) > img',
        'html > body > main > shadow-card >>> div:nth-of-type(2) > button',
      ]),
    )
    // A slot shows what is assigned to it: the light child sits under the slot, as it is rendered.
    const index = new Map([...walkTree(snapshot.root)].map((n) => [n.ref, n]))
    const slot = index.get('html > body > main > shadow-card >>> div:nth-of-type(2) > slot')
    expect(slot?.children.map((child) => child.ref)).toEqual(['html > body > main > shadow-card > span'])
    // Nothing of another origin's frame or of a closed shadow root.
    expect(index.get('#remote')?.children).toEqual([])
    expect(index.get('html > body > main > closed-card')?.children).toEqual([])
    // Frame elements are placed in the page: their content's boxes are in the page's coordinates.
    const frame = index.get('#local')?.bounds
    const image = index.get('#local |> html > body > img')?.bounds
    expect(frame && image && image.x >= frame.x && image.y >= frame.y && image.x < frame.x + frame.width).toBe(true)
  })

  it('says that a frame that has not loaded yet was not checked, though axe-core ran in its blank document', async () => {
    if (!browser) return
    const { snapshot } = await collectWeb(browser, `${origin}/lazy`, { runAxe: true, locale: 'en' })
    expect(snapshot.reach?.frames).toEqual([{ ref: '#later', url: `${origin}/widget.html`, collected: false, reason: 'not-loaded', engine: true }])
    expect(reachNotes(snapshot.reach, 'en')).toEqual(['1 frame(s) were not checked at all, so whatever they hold was missed: #later (not-loaded).'])
  })

  it('records what it reached and what it could not', async () => {
    if (!browser) return
    const { snapshot } = await collectWeb(browser, `${origin}/page.html`, { runAxe: true, locale: 'en' })
    expect(snapshot.reach?.frames).toEqual([
      { ref: '#local', url: 'about:srcdoc', collected: true, engine: true },
      { ref: 'html > body > main > iframe:nth-of-type(2)', url: 'about:srcdoc', collected: true, engine: true },
      { ref: '#outer', url: 'about:srcdoc', collected: true, engine: true },
      { ref: '#outer |> html > body > iframe', url: 'about:srcdoc', collected: true, engine: true },
      { ref: '#remote', url: expect.stringMatching(/^http:\/\/localhost:\d+\/widget\.html$/), collected: false, reason: 'cross-origin', engine: true },
    ])
    expect(snapshot.reach?.shadowRoots).toEqual({ open: 1, closed: 1, closedHosts: ['html > body > main > closed-card'] })
  })

  it('says in the report what it could not read: a frame of another origin and a closed shadow root', async () => {
    if (!browser) return
    const { snapshot, engine } = await collectWeb(browser, `${origin}/page.html`, { runAxe: true, locale: 'en' })
    const report = await checkSnapshot(snapshot, engine, { criteria: [], llm: false, provider: undefined, runs: 1, cache: memoryCache(), offline: false, locale: 'en', minConfidence: 'low', concurrency: 1 })
    expect(report.notes?.[0]).toMatch(/^1 frame\(s\) from another origin were checked by axe-core only: .*#remote \(http:\/\/localhost:\d+\/widget\.html\)\.$/)
    expect(report.notes?.[1]).toBe('1 closed shadow root(s) cannot be read by any script, so nothing inside them was checked (hosts: html > body > main > closed-card).')
    expect(report.coverage.reach?.frames?.map((frame) => frame.ref)).toEqual(['#remote'])
    // The coverage statement (SARIF's coverage notification) says it too.
    expect(coverageStatement(report)).toContain('closed shadow root(s)')
    // Findings inside frames and shadow roots carry their qualified refs.
    const refs = report.findings.map((finding) => `${finding.ruleId} ${finding.ref}`)
    expect(refs).toContain('image-alt #local |> html > body > img')
    expect(refs).toContain('button-name html > body > main > shadow-card >>> div:nth-of-type(2) > button')
  })

  it('captures images in frames and shadow roots as rendered', async () => {
    if (!browser) return
    const { snapshot } = await collectWeb(browser, `${origin}/page.html`, { runAxe: false, locale: 'en', captureImages: true })
    const index = new Map([...walkTree(snapshot.root)].map((n) => [n.ref, n]))
    for (const ref of ['#local |> html > body > img', 'html > body > main > shadow-card >>> div:nth-of-type(1) > img']) {
      const image = index.get(ref)?.image
      expect(image, ref).toMatch(/^data:image\/png;base64,/)
      const png = tryDecodePng(Buffer.from(image?.split(',')[1] ?? '', 'base64'))
      const middle = png ? ((png.height >> 1) * png.width + (png.width >> 1)) * 4 : -1
      // The fixture's teal square, not the page around it.
      expect(png ? [png.data[middle], png.data[middle + 1], png.data[middle + 2]] : [], ref).toEqual([0, 128, 128])
    }
  })

  it('gives every node a ref that finds it again, and the same ref the probe kit gives', async () => {
    if (!browser) return
    await onPage('/page.html', async (page) => {
      const { snapshot } = await collectPage(playwrightDriver(page), { locale: 'en' })
      await page.evaluate(installKit)
      const refs = refsOf(snapshot)
      const mismatches = await page.evaluate(
        ({ refs, resolver }) => {
          const resolve = new Function(`return (${resolver})`)() as (ref: string) => Element | null
          const w = window as unknown as { __rampaNodes: Map<string, Element>; __rampaKit: { cssPath(el: Element): string; resolve(ref: string): Element | null } }
          return refs.flatMap((ref) => {
            const el = w.__rampaNodes.get(ref)
            if (!el) return [`${ref}: not in the map`]
            const problems: string[] = []
            if (resolve(ref) !== el) problems.push(`${ref}: resolveRefInPage finds another element`)
            if (w.__rampaKit.resolve(ref) !== el) problems.push(`${ref}: the kit finds another element`)
            if (w.__rampaKit.cssPath(el) !== ref) problems.push(`${ref}: the kit says ${w.__rampaKit.cssPath(el)}`)
            return problems
          })
        },
        { refs, resolver: resolveRefInPage.toString() },
      )
      expect(mismatches).toEqual([])
      expect(refs.length).toBeGreaterThan(30)
    })
  })

  it('collects the same snapshot and engine results from a test’s own Playwright page as rampa check', async () => {
    if (!browser) return
    const cli = await collectWeb(browser, `${origin}/page.html`, { runAxe: true, locale: 'en', captureImages: true })
    const api = await onPage('/page.html', (page) => collectPage(playwrightDriver(page), { locale: 'en', captureImages: true }))
    expect(comparable(api.snapshot)).toEqual(comparable(cli.snapshot))
    expect(violations(api.engine)).toEqual(violations(cli.engine))
  })

  it('reaches frames, and captures in them, through the Puppeteer adapter too', async () => {
    if (!browser) return
    const collected = await onPage('/page.html', (page) => {
      // Puppeteer's page API, served by a Playwright page: evaluate(fn, ...args), evaluateHandle, $(selector), screenshot(options).
      const like: PuppeteerPage = {
        url: () => page.url(),
        evaluate: (fn, ...args) => page.evaluate(fn as never, args[0]),
        evaluateHandle: (fn, arg) => page.evaluateHandle(fn, arg) as never,
        $: async (selector) => {
          const handle = await page.$(selector)
          return handle && { screenshot: (options) => handle.screenshot(options), dispose: () => handle.dispose() }
        },
        screenshot: (options) => page.screenshot(options),
      }
      return collectPage(puppeteerDriver(like), { locale: 'en', captureImages: true })
    })
    expect(violations(collected.engine)).toContain('image-alt #remote |> img')
    expect(violations(collected.engine)).toContain('button-name #outer |> html > body > iframe |> html > body > button')
    const index = new Map([...walkTree(collected.snapshot.root)].map((n) => [n.ref, n]))
    expect(index.get('#local |> html > body > img')?.image).toMatch(/^data:image\/png;base64,/)
    expect(index.get('html > body > main > shadow-card >>> div:nth-of-type(1) > img')?.image).toMatch(/^data:image\/png;base64,/)
  })

  it('without the frame API, checks the top frame and says which frames axe-core did not reach', async () => {
    if (!browser) return
    const collected = await onPage('/page.html', (page) => {
      // A page-like object as an older library would give it: no evaluateHandle, so no way into frames.
      const bare: PlaywrightPage = { url: () => page.url(), evaluate: (fn, arg) => page.evaluate(fn as never, arg), locator: (selector) => page.locator(selector), screenshot: (options) => page.screenshot(options) }
      return collectPage(playwrightDriver(bare), { locale: 'en' })
    })
    // Shadow roots are in the top frame: still checked.
    expect(violations(collected.engine)).toEqual(['button-name html > body > main > shadow-card >>> div:nth-of-type(2) > button'])
    const notes = reachNotes(collected.snapshot.reach, 'en')
    expect(notes[0]).toBe('1 frame(s) were not checked at all, so whatever they hold was missed: #remote (cross-origin; the browser library gives no access to frames).')
    expect(notes[1]).toMatch(/^axe-core did not run in 4 frame\(s\) whose content was collected: #local \(the browser library gives no access to frames\)/)
  })
})

describe('reach in the report, offline', () => {
  it('leaves hidden frames and frames axe-core skips on purpose out of the gaps', () => {
    const reach = buildReach({
      frames: [
        { ref: '#hidden', url: 'https://ads.example/x', collected: false, reason: 'hidden' },
        { ref: '#muted', url: 'about:srcdoc', collected: true },
        { ref: '#map', url: 'https://maps.example/embed', collected: false, reason: 'cross-origin' },
      ],
      engineFrames: [{ ref: '#map', engine: false, reason: 'over the limit of 30 frames per page' }],
      shadowRoots: 0,
    })
    expect(reach?.frames?.find((frame) => frame.ref === '#muted')).toEqual({ ref: '#muted', url: 'about:srcdoc', collected: true, engine: false, engineReason: 'skipped' })
    expect(unreached(reach)?.frames?.map((frame) => frame.ref)).toEqual(['#map'])
    expect(reachNotes(reach, 'pt-BR')).toEqual(['1 frame(s) não foi(ram) verificado(s), e o que ele(s) contém ficou de fora: #map (cross-origin; over the limit of 30 frames per page).'])
  })

  it('keeps a snapshot with no frame and no shadow root as it always was', () => {
    expect(buildReach({ frames: [], engineFrames: [], shadowRoots: 0, closed: { count: 0, hosts: [] } })).toBeUndefined()
    expect(reachNotes(undefined, 'en')).toEqual([])
  })

  it('never places an element of a frame or a shadow root on a line of the page file', () => {
    const snapshot: A11ySnapshot = {
      schemaVersion: 1,
      surface: 'web',
      target: 'page.html',
      viewport: { width: 1280, height: 800, scale: 1 },
      root: node({
        ref: 'html',
        role: 'document',
        native: { tag: 'html', attributes: {} },
        children: [
          node({ ref: 'html > body > img', role: 'img', native: { tag: 'img', attributes: { src: 'a.png' }, html: '<img src="a.png">' } }),
          node({ ref: '#f |> html > body > img', role: 'img', native: { tag: 'img', attributes: { src: 'a.png' }, html: '<img src="a.png">' } }),
          node({ ref: 'x-card >>> img', role: 'img', native: { tag: 'img', attributes: { src: 'a.png' }, html: '<img src="a.png">' } }),
        ],
      }),
      collectedAt: '',
      collector: { name: 'test', version: '0' },
    }
    const text = '<html><body>\n<img src="a.png">\n<iframe id="f" srcdoc=""></iframe><x-card></x-card>\n</body></html>'
    const locate = createLocator(snapshot, { file: 'page.html', text })
    const finding = (ref: string): Finding => ({ fingerprint: ref, criterion: '1.1.1', level: 'A', source: 'engine', ref, message: '', confidence: 'high', html: '<img src="a.png">' })
    // The page's own image keeps its line: its twins in the frame and the shadow root do not count against it.
    expect(locate(finding('html > body > img'))?.startLine).toBe(2)
    expect(locate(finding('#f |> html > body > img'))).toBeUndefined()
    expect(locate(finding('x-card >>> img'))).toBeUndefined()
  })
})
