import { readFileSync } from 'node:fs'
import { type Server, createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Browser } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { EngineResults } from '../src/core/types.ts'
import { collectPage, playwrightDriver } from '../src/playwright.ts'
import { collectWeb } from '../src/surfaces/web.ts'
import { launchTestBrowser } from './browser.ts'

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

  it('reaches the same frames from a test’s own Playwright page', async () => {
    if (!browser) return
    const cli = await collectWeb(browser, `${origin}/page.html`, { runAxe: true, locale: 'en' })
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    try {
      const page = await context.newPage()
      await page.goto(`${origin}/page.html`)
      const api = await collectPage(playwrightDriver(page), { locale: 'en' })
      expect(violations(api.engine)).toEqual(violations(cli.engine))
    } finally {
      await context.close()
    }
  })
})
