import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { memoryCache } from '../src/core/cache.ts'
import { checkSnapshot } from '../src/core/check.ts'
import type { Report } from '../src/core/types.ts'
import { playwrightDriver } from '../src/playwright.ts'
import { pixelFactOf, pixelRunOf } from '../src/snapshot/pixel-contrast.ts'
import type { A11ySnapshot } from '../src/snapshot/schema.ts'
import { indexTree } from '../src/snapshot/tree.ts'
import { collectPage } from '../src/surfaces/page.ts'
import { type WebCollectOptions, collectWeb, launchBrowser } from '../src/surfaces/web.ts'

// Integration: needs Chrome or Edge (or Playwright's Chromium). Skipped when none is installed. The fixtures
// keep a margin of at least 0.2 from each threshold, and every color behind the text is flat or a gradient of
// known ends, so the outcomes hold whatever font a platform renders the text in.
const browser = await launchBrowser().catch(() => undefined)
afterAll(async () => browser?.close(), 60_000)

const fixture = (name: string) => pathToFileURL(resolve('test/fixtures/rules', `contrast-${name}`)).href

async function check(name: string, options: Partial<WebCollectOptions> = {}): Promise<{ report: Report; snapshot: A11ySnapshot }> {
  if (!browser) throw new Error('no browser')
  const { snapshot, engine } = await collectWeb(browser, fixture(name), { runAxe: true, locale: 'en', ...options })
  const report = await checkSnapshot(snapshot, engine, {
    criteria: [],
    llm: false,
    provider: undefined,
    runs: 1,
    cache: memoryCache(),
    offline: false,
    locale: 'en',
    minConfidence: 'low',
    concurrency: 1,
  })
  return { report, snapshot }
}

/** What the report says about one element for a rule: a failure, an item to review, or nothing (no failure found). */
function outcomes(report: Report, rule: string, ids: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const id of ids) {
    const ref = `#${id}`
    if (report.findings.some((f) => f.ruleId === rule && f.ref === ref)) out[id] = 'fail'
    else if ((report.needsReview ?? []).some((item) => item.ruleId === rule && item.ref === ref)) out[id] = 'review'
    else out[id] = 'none'
  }
  return out
}

describe.skipIf(!browser)('contrast measured from pixels', { timeout: 60_000 }, () => {
  it('settles the text axe-core could not decide over images, gradients and pseudo-elements (1.4.3)', async () => {
    const { report, snapshot } = await check('text.html')
    const ids = ['fail-gradient', 'fail-image', 'near-fail', 'small-fail', 'hero-fail', 'near-pass', 'pass-gradient', 'pass-image', 'large-pass', 'pseudo-pass', 'mixed']
    expect(outcomes(report, 'rampa/pixel-contrast', ids)).toEqual({
      'fail-gradient': 'fail',
      'fail-image': 'fail',
      'near-fail': 'fail',
      'small-fail': 'fail',
      'hero-fail': 'fail',
      'near-pass': 'none',
      'pass-gradient': 'none',
      'pass-image': 'none',
      'large-pass': 'none',
      'pseudo-pass': 'none',
      mixed: 'review',
    })
    // Every one of them was measured, from the style sheet's color, and none is left to axe-core's review.
    const index = indexTree(snapshot.root)
    for (const id of ids) expect(pixelFactOf(index.get(`#${id}`)?.node ?? snapshot.root, 'text')).toMatchObject({ status: 'measured', foregroundFrom: 'css' })
    expect((report.needsReview ?? []).filter((item) => item.ruleId === 'color-contrast')).toEqual([])
    expect(report.findings.find((f) => f.ref === '#fail-gradient')?.message).toMatch(/^The text "Sale ends on Friday at noon" has at most 2\.\d\d:1 contrast/)
    const record = report.coverage.criteria?.find((c) => c.id === '1.4.3')
    expect(record?.methods.find((m) => m.id === 'rampa/pixel-contrast')).toMatchObject({ applicable: 11, failures: 5, review: 1 })
  })

  it('measures placeholders, which axe-core does not check, and leaves out disabled and filled fields', async () => {
    const { report, snapshot } = await check('placeholders.html')
    expect(outcomes(report, 'rampa/placeholder-contrast', ['ph-fail', 'ph-near-fail', 'ph-textarea', 'ph-pass', 'ph-near-pass', 'ph-large'])).toEqual({
      'ph-fail': 'fail',
      'ph-near-fail': 'fail',
      'ph-textarea': 'fail',
      'ph-pass': 'none',
      'ph-near-pass': 'none',
      'ph-large': 'none',
    })
    const index = indexTree(snapshot.root)
    for (const id of ['ph-disabled', 'ph-filled']) expect(index.get(`#${id}`)?.node.native.pixelContrast).toBeUndefined()
    expect(report.findings.find((f) => f.ref === '#ph-fail')?.message).toBe(
      'The placeholder "Search products" has a contrast of 1.92:1 with the field (#bbbbbb on #ffffff). Placeholder text is text, and WCAG 1.4.3 asks for 4.5:1.',
    )
  })

  it('measures icon-only controls against the pixels next to their icon (1.4.11), and exempts disabled ones', async () => {
    const { report, snapshot } = await check('icons.html')
    const ids = ['icon-fail', 'icon-near-fail', 'icon-img-fail', 'icon-sr-fail', 'icon-pass', 'icon-near-pass', 'icon-link-pass', 'icon-disabled']
    expect(outcomes(report, 'rampa/icon-contrast', ids)).toEqual({
      'icon-fail': 'fail',
      'icon-near-fail': 'fail',
      'icon-img-fail': 'fail',
      'icon-sr-fail': 'fail',
      'icon-pass': 'none',
      'icon-near-pass': 'none',
      'icon-link-pass': 'none',
      'icon-disabled': 'none',
    })
    const index = indexTree(snapshot.root)
    expect(pixelFactOf(index.get('#icon-disabled')?.node ?? snapshot.root, 'icon')).toEqual({ kind: 'icon', status: 'exempt', reason: 'disabled' })
    // Not icon-only controls: visible text next to the icon, a logo, a photo, and a checkbox the browser draws.
    for (const id of ['icon-and-text', 'logo-link', 'photo-link', 'native-checkbox']) expect(index.get(`#${id}`)?.node.native.pixelContrast).toBeUndefined()
    expect(report.findings.find((f) => f.ref === '#icon-fail')?.message).toMatch(
      /^The icon of this button \("Close"\) has at most 1\.6\d:1 contrast with the pixels next to it \(#cccccc on #ffffff\)\./,
    )
    const record = report.coverage.criteria?.find((c) => c.id === '1.4.11')
    expect(record?.status).toBe('failures')
    expect(record?.methods).toEqual([
      expect.objectContaining({ kind: 'rule', id: 'rampa/icon-contrast', applicable: 7, failures: 4, review: 0, note: '1 disabled control(s) exempt' }),
    ])
  })

  it('measures text in view where it rests, though another measurement scrolled the page', async () => {
    const { report, snapshot } = await check('scroll.html')
    expect(outcomes(report, 'rampa/pixel-contrast', ['below', 'hero'])).toEqual({ below: 'none', hero: 'none' })
    // Captured as the page loaded: the script fades it only once the page scrolls.
    const hero = pixelFactOf(indexTree(snapshot.root).get('#hero')?.node ?? snapshot.root, 'text')
    expect(hero).toMatchObject({ status: 'measured', foregroundFrom: 'css' })
    expect(hero?.opacity).toBeUndefined()
  })

  it('stops at the limit, says how many it left out, and leaves those to axe-core', async () => {
    const { report, snapshot } = await check('text.html', { pixelContrast: { limits: { text: 3 } } })
    expect(pixelRunOf(snapshot.root)).toMatchObject({ found: { text: 11 }, measured: { text: 3 }, leftOut: { text: 8 }, stopped: 'limit' })
    expect((report.needsReview ?? []).filter((item) => item.ruleId === 'color-contrast')).toHaveLength(8)
    const method = report.coverage.criteria?.find((c) => c.id === '1.4.3')?.methods.find((m) => m.id === 'rampa/pixel-contrast')
    expect(method).toMatchObject({ applicable: 3, note: '8 not measured, past the limit of 3 per page' })
  })

  it('does nothing without axe-core, or when turned off', async () => {
    if (!browser) return
    const { snapshot } = await collectWeb(browser, fixture('text.html'), { runAxe: true, locale: 'en', pixelContrast: false })
    expect(snapshot.root.native.pixelContrastRun).toBeUndefined()
  })

  it('measures the same in a test’s own page, and leaves that page as it was', async () => {
    if (!browser) return
    // A short viewport, so the page scrolls and the test's own position can be kept.
    const context = await browser.newContext({ viewport: { width: 1280, height: 300 } })
    try {
      const page = await context.newPage()
      await page.goto(fixture('placeholders.html'))
      await page.evaluate(() => window.scrollTo(0, 40))
      const fields = await collectPage(playwrightDriver(page), { locale: 'en' })
      const index = indexTree(fields.snapshot.root)
      expect(pixelFactOf(index.get('#ph-fail')?.node ?? fields.snapshot.root, 'placeholder')).toMatchObject({ status: 'measured', foreground: '#bbbbbb', highest: 1.92 })
      // The placeholder is back, no inline style is left behind (Playwright's own screenshots leave empty ones), and the scroll position is kept.
      expect(
        await page.evaluate(() => ({
          placeholder: document.querySelector('#ph-fail')?.getAttribute('placeholder'),
          styled: Array.from(document.querySelectorAll('[style]')).filter((el) => el.getAttribute('style') !== '').map((el) => el.id),
          scroll: window.scrollY,
        })),
      ).toEqual({ placeholder: 'Search products', styled: [], scroll: 40 })

      await page.goto(fixture('text.html'))
      const before = await page.evaluate(() => Array.from(document.querySelectorAll('p, h1')).map((el) => [el.id, el.getAttribute('style')]))
      const texts = await collectPage(playwrightDriver(page), { locale: 'en' })
      expect(pixelFactOf(indexTree(texts.snapshot.root).get('#mixed')?.node ?? texts.snapshot.root, 'text')).toMatchObject({ status: 'measured' })
      // Colors made transparent for the second capture are back, written as the browser writes them.
      const after = await page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLElement>('p, h1')).map((el) => [el.id, el.style.getPropertyValue('-webkit-text-fill-color'), el.style.getPropertyPriority('color')]),
      )
      expect(after).toEqual(before.map(([id]) => [id, '', '']))
      expect(await page.evaluate(() => getComputedStyle(document.querySelector('#fail-gradient') as Element).color)).toBe('rgb(170, 170, 170)')
    } finally {
      await context.close()
    }
  })
})
