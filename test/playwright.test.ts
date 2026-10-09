import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Browser, BrowserContext } from 'playwright-core'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { memoryCache } from '../src/core/cache.ts'
import { check } from '../src/index.ts'
import { type AssertOptions, type ToPassRampaOptions, checkPage, collectPage, playwrightDriver, rampaFixtures, rampaMatchers } from '../src/playwright.ts'
import { checkPage as checkPuppeteerPage, type PuppeteerPage } from '../src/puppeteer.ts'
import { collectWeb } from '../src/surfaces/web.ts'
import { launchTestBrowser } from './browser.ts'
import { stubModel } from './stub-model.ts'

declare module 'vitest' {
  interface Matchers<R extends void | Promise<void> = void | Promise<void>, T = unknown> {
    toPassRampa(options?: ToPassRampaOptions): Promise<void>
    toHaveNoRampaFindings(options?: AssertOptions): void
  }
}

expect.extend(rampaMatchers)

// Integration: a real Playwright page in Microsoft Edge here, Google Chrome on CI (RAMPA_BROWSER_CHANNEL=chrome).
// Without a browser the tests are skipped, and the reason is printed.
const launched = await launchTestBrowser('the Playwright integration tests')
const browser: Browser | undefined = 'browser' in launched ? launched.browser : undefined
if ('skip' in launched) console.warn(launched.skip)
afterAll(async () => browser?.close())

const SHOP = 'https://shop.test'
const contexts: BrowserContext[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map((context) => context.close()))
})

/** No network: every request to the shop is answered by a route mock, and the cart only renders for a signed-in session. */
async function openShop(options: { csp?: string } = {}) {
  if (!browser) throw new Error('no browser')
  const checkout = await readFile('test/fixtures/checkout.html', 'utf8')
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  contexts.push(context)
  await context.route(`${SHOP}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('.svg')) return route.fulfill({ body: await readFile(`examples/store${path}`), contentType: 'image/svg+xml' })
    const signedIn = ((await route.request().allHeaders()).cookie ?? '').includes('session=1')
    const body = signedIn ? checkout : '<!doctype html><html lang="en"><title>Sign in</title><h1>Sign in</h1></html>'
    return route.fulfill({ body, contentType: 'text/html', headers: options.csp ? { 'content-security-policy': options.csp } : {} })
  })
  await context.addCookies([{ name: 'session', value: '1', url: SHOP }])
  const page = await context.newPage()
  await page.goto(`${SHOP}/cart`)
  return page
}

/** No rampa.config, no waivers file and a fresh cache: only what each test passes counts. */
const isolated = () => ({ config: false, waivers: [], cache: memoryCache() }) as const

const example = (name: string) => pathToFileURL(resolve('examples/store', name)).href

// A cold browser on a CI runner needs more than the default 5 s for the first page.
describe.skipIf(!browser)('checkPage in a real browser', { timeout: 30_000 }, () => {
  it('checks the page the test opened, with its cookies and route mocks', async () => {
    const page = await openShop()
    const report = await checkPage(page, { ...isolated(), noLlm: true })
    expect(report.target).toBe(`${SHOP}/cart`)
    expect(report.llm).toBe('off')
    expect(report.scope).toBeUndefined()
    // The cart only exists for the signed-in session the test set up.
    expect(report.criteria.find((c) => c.criterion === '2.4.4')?.candidates).toBe(2)
    expect(report.findings).toEqual([expect.objectContaining({ criterion: '1.1.1', source: 'engine', ruleId: 'image-alt', ref: 'html > body > header > img' })])
    expect(report.coverage.notChecked.length).toBeGreaterThan(30)
  })

  it('collects the same snapshot and engine results as rampa check', async () => {
    if (!browser) return
    const url = example('before.html')
    const cli = await collectWeb(browser, url, { runAxe: true, locale: 'en', captureImages: true })
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    contexts.push(context)
    const page = await context.newPage()
    await page.goto(url)
    const api = await collectPage(playwrightDriver(page), { locale: 'en', captureImages: true })
    // Screenshots are compared by presence: rendering may differ by a pixel between two captures.
    const comparable = (snapshot: typeof cli.snapshot) =>
      JSON.parse(JSON.stringify({ ...snapshot, collectedAt: '' }, (key, value) => (key === 'image' ? typeof value === 'string' && value.startsWith('data:image/png') : value)))
    expect(comparable(api.snapshot)).toEqual(comparable(cli.snapshot))
    expect(api.engine).toEqual(cli.engine)
  })

  it('judges with the configured model and keeps verified claims with evidence and a patch', async () => {
    const page = await openShop()
    const model = stubModel()
    const report = await checkPage(page, { ...isolated(), model, criteria: ['1.1.1', '2.4.4'] })
    expect(report.llm).toBe('on')
    expect(report.model).toBe('stub:rules')
    const link = report.findings.find((f) => f.criterion === '2.4.4' && f.evidence === 'Click here')
    expect(link).toMatchObject({ source: 'judgment', ref: '#cart > p > a', patch: { to: 'Shipping and returns' } })
    // 1.1.1 needs vision: the image reaches the model as rendered.
    expect(model.asked).toContainEqual({ criterion: '1.1.1', subject: 'IMG_2034.jpg', images: 1 })
    expect(report.findings.find((f) => f.criterion === '1.1.1' && f.source === 'judgment')?.patch?.after).toContain('alt="Blue ceramic mug"')
  })

  it('scopes the check to a component: nothing outside it is checked or sent to the model', async () => {
    const page = await openShop()
    const model = stubModel()
    const report = await checkPage(page, { ...isolated(), model, include: '#cart' })
    expect(report.scope).toEqual({ include: ['#cart'], exclude: [] })
    expect(model.asked.map((a) => a.subject).sort()).toEqual(['Click here', 'IMG_2034.jpg', 'Section 2'])
    expect(report.findings.map((f) => `${f.criterion} ${f.ref}`).sort()).toEqual([
      '1.1.1 #cart > ul > li > img',
      '2.4.4 #cart > p > a',
      '2.4.6 #cart-title',
    ])
    // The page's title and language are not the component's: reported as not applicable, and left unchecked.
    expect(report.criteria.filter((c) => !c.applicable).map((c) => c.criterion)).toEqual(['2.4.2', '3.1.1'])
    expect(report.coverage.notChecked).toEqual(expect.arrayContaining(['2.4.2', '3.1.1']))
    expect(model.asked.some((a) => a.criterion === '2.4.2' || a.criterion === '3.1.1')).toBe(false)
  })

  it('leaves excluded parts out and keeps judging the page as a whole', async () => {
    const page = await openShop()
    const model = stubModel()
    const report = await checkPage(page, { ...isolated(), model, exclude: '.ad', criteria: ['2.4.2', '2.4.4'] })
    expect(model.asked.map((a) => a.subject)).not.toContain('Read more')
    expect(report.findings.map((f) => f.evidence ?? f.ruleId)).toEqual(['image-alt', 'Untitled document', 'Click here'])
    expect(report.criteria.every((c) => c.applicable)).toBe(true)
  })

  it('fails loudly when a scope selector matches nothing or does not parse', async () => {
    const page = await openShop()
    await expect(checkPage(page, { ...isolated(), noLlm: true, include: '#basket' })).rejects.toThrow('No element on https://shop.test/cart matches the include selector "#basket".')
    await expect(checkPage(page, { ...isolated(), noLlm: true, include: '#cart >' })).rejects.toThrow('"#cart >" is not a valid CSS selector')
  })

  it('runs axe-core on a page whose CSP blocks inline scripts', async () => {
    const page = await openShop({ csp: "default-src 'self'; script-src 'self'" })
    // The page really blocks an inline script tag, which is why Rampa evaluates axe-core instead of adding one.
    await page.addScriptTag({ content: 'window.injected = true' }).catch(() => undefined)
    expect(await page.evaluate(() => 'injected' in window)).toBe(false)
    const report = await checkPage(page, { ...isolated(), noLlm: true })
    expect(report.engine.name).toBe('axe-core')
    expect(report.findings.map((f) => f.ruleId)).toEqual(['image-alt'])
  })

  it('leaves the page scrolled where the test left it after capturing images', async () => {
    const page = await openShop()
    await page.setViewportSize({ width: 1280, height: 200 })
    const bottom = await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight)
      return window.scrollY
    })
    expect(bottom).toBeGreaterThan(100)
    const model = stubModel()
    await checkPage(page, { ...isolated(), model, criteria: ['1.1.1'] })
    expect(model.asked).toContainEqual({ criterion: '1.1.1', subject: 'IMG_2034.jpg', images: 1 })
    expect(await page.evaluate(() => window.scrollY)).toBe(bottom)
  })

  it('reports in Portuguese with locale pt-BR', async () => {
    const page = await openShop()
    const report = await checkPage(page, { ...isolated(), model: stubModel(), criteria: ['2.4.4'], locale: 'pt-BR', include: '#cart' })
    expect(report.locale).toBe('pt-BR')
    expect(report.findings[0]?.message).toBe('O texto do link "Click here" não diz para onde o link leva, e nada ao redor diz.')
  })
})

describe.skipIf(!browser)('matchers and fixture in a real browser', { timeout: 30_000 }, () => {
  it('passes a clean component and lists each finding of a failing one', async () => {
    const page = await openShop()
    await expect(page).toPassRampa({ ...isolated(), model: stubModel(), include: '#newsletter' })
    const failure = await expect(page).toPassRampa({ ...isolated(), model: stubModel(), include: '#cart' }).then(
      () => undefined,
      (error: Error) => error.message,
    )
    expect(failure).toContain('expect(page).toPassRampa()')
    expect(failure).toContain('Rampa: 3 failures in https://shop.test/cart (scope: #cart)')
    expect(failure).toContain('2. WCAG 2.4.4 (A) — Link Purpose (In Context)')
    expect(failure).toContain('Element:   #cart > p > a')
    expect(failure).toContain('Message:   The link text "Click here" does not tell where the link goes, and nothing around it does.')
    expect(failure).toContain('Evidence:  "Click here"')
    expect(failure).toContain('Patch:     - <a href="/shipping">Click here</a>\n              + <a href="/shipping">Shipping and returns</a>')
  })

  it('asserts on a report with toHaveNoRampaFindings', async () => {
    const page = await openShop()
    const report = await checkPage(page, { ...isolated(), noLlm: true, exclude: 'header' })
    expect(report).toHaveNoRampaFindings()
    // Judgment was off, so a test that requires it fails.
    expect(() => expect(report).toHaveNoRampaFindings({ requireJudgment: true })).toThrow('the judgment layer was off (noLlm), so only axe-core ran')
  })

  it('gives a test a rampa helper that checks its page and attaches the report', async () => {
    const page = await openShop()
    const attachments: Array<{ name: string; body: string }> = []
    const testInfo = { annotations: [] as Array<{ type: string; description?: string }>, attach: async (name: string, options: { body: string }) => void attachments.push({ name, body: options.body }) }
    await rampaFixtures.rampa({ page, rampaOptions: { ...isolated(), noLlm: true } }, async (rampa) => {
      const report = await rampa.check({ include: '#newsletter' })
      expect(report).toHaveNoRampaFindings()
      await rampa.check()
    }, testInfo)
    expect(attachments.map((a) => a.name)).toEqual(['rampa-report.json', 'rampa-report-2.json'])
    expect(JSON.parse(attachments[0]?.body ?? '{}').scope).toEqual({ include: ['#newsletter'], exclude: [] })
    expect(testInfo.annotations[1]).toEqual({ type: 'rampa', description: expect.stringContaining('1 finding · judged: none · not checked automatically:') })
  })
})

describe.skipIf(!browser)('check on web targets', { timeout: 60_000 }, () => {
  it('checks an .html file in the browser it is given and leaves it open, or starts and closes its own', async () => {
    if (!browser) return
    const options = { ...isolated(), noLlm: true }
    const [given] = await check(resolve('examples/store/before.html'), { ...options, browser })
    expect(given?.target).toBe(example('before.html'))
    expect(given?.findings.map((f) => f.ruleId)).toEqual(['image-alt'])
    expect(browser.isConnected()).toBe(true)
    const [own] = await check(resolve('examples/store/after.html'), options)
    expect(own?.findings).toEqual([])
  })
})

describe.skipIf(!browser)('rampa/puppeteer adapter', { timeout: 30_000 }, () => {
  it('runs the same checks through the Puppeteer page API', async () => {
    const page = await openShop()
    // Puppeteer's page API, served by a Playwright page: evaluate(fn, ...args), $(selector), screenshot(options).
    const puppeteerLike: PuppeteerPage = {
      url: () => page.url(),
      evaluate: (fn, ...args) => page.evaluate(fn as never, args[0]),
      $: async (selector) => {
        const handle = await page.$(selector)
        return handle && { screenshot: (options) => handle.screenshot(options), dispose: () => handle.dispose() }
      },
      screenshot: (options) => page.screenshot(options),
    }
    const viaPuppeteer = await checkPuppeteerPage(puppeteerLike, { ...isolated(), model: stubModel(), include: '#cart' })
    const viaPlaywright = await checkPage(page, { ...isolated(), model: stubModel(), include: '#cart' })
    const strip = (report: typeof viaPlaywright) => ({ ...report, createdAt: '', usage: { ...report.usage, latencyMs: 0 } })
    expect(strip(viaPuppeteer)).toEqual(strip(viaPlaywright))
    expect(viaPuppeteer.findings).toHaveLength(3)
  })
})
