/**
 * `rampa/playwright`: Rampa inside the Playwright tests a team already has.
 *
 * checkPage runs the collector and axe-core in the test's own page, so its login,
 * storage state, route mocks and app state apply, then the judgment layer, and returns
 * the report `rampa check` builds. The matchers and the fixture are plain objects for
 * `expect.extend` and `test.extend`: @playwright/test is an optional peer dependency
 * and is never imported here.
 */
import { type CheckPageOptions, checkDriver } from './api/page.ts'
import type { Report } from './core/types.ts'
import type { CdpSessionLike } from './surfaces/form-issues.ts'
import { type FrameElementLike, type HandleFrame, elementForRef, isQualifiedRef } from './snapshot/refs.ts'
import { type LibraryFrame, libraryFrameDriver } from './surfaces/frames.ts'
import type { PageDriver } from './surfaces/page.ts'
import { type RampaFixtures as Fixtures, type RampaHelper as Helper, createFixtures } from './testing/fixtures.ts'
import { createMatchers } from './testing/matchers.ts'

export type { CheckPageOptions } from './api/page.ts'
export type { RampaOptions } from './api/options.ts'
export type * from './core/types.ts'
export { type PageDriver, collectPage } from './surfaces/page.ts'
export { type AssertOptions, formatFindings } from './testing/format.ts'
export type { TestInfoLike } from './testing/fixtures.ts'
export { type MatcherResult, type MatcherState, type ToPassRampaOptions, assertRampa } from './testing/matchers.ts'

/**
 * The parts of a Playwright Page that Rampa uses. A Page from playwright, playwright-core
 * or @playwright/test fits whatever its version, which a full Page type would not.
 */
export interface PlaywrightPage {
  url(): string
  // biome-ignore lint/suspicious/noExplicitAny: Playwright's evaluate is generic; any keeps every version's overloads assignable
  evaluate(pageFunction: string | ((arg: any) => unknown), arg?: any): Promise<unknown>
  /** Every Playwright Page has it; it reaches the page's frames, other origins included. Without it, axe-core checks the top frame only. */
  evaluateHandle?: LibraryFrame['evaluateHandle']
  locator(selector: string): { first(): { screenshot(options?: { type?: 'png'; timeout?: number; animations?: 'disabled' }): Promise<Uint8Array> } }
  screenshot(options?: { path?: string; fullPage?: boolean }): Promise<Uint8Array>
}

/** A Playwright element handle, as far as a screenshot of it goes. */
interface ScreenshotHandle extends FrameElementLike<ScreenshotHandle> {
  screenshot(options?: { type?: 'png'; timeout?: number; animations?: 'disabled' }): Promise<Uint8Array>
}

export function playwrightDriver(page: PlaywrightPage): PageDriver {
  const frames = page.evaluateHandle ? libraryFrameDriver(page as LibraryFrame) : undefined
  return {
    url: () => page.url(),
    ...(frames?.child ? { child: frames.child } : {}),
    evaluate: <Arg, Result>(fn: (arg: Arg) => Result | Promise<Result>, arg: Arg) => page.evaluate(fn, arg) as Promise<Result>,
    async run(source) {
      await page.evaluate(source)
    },
    async screenshotElement(ref) {
      try {
        if (!isQualifiedRef(ref)) return await page.locator(`css=${ref}`).first().screenshot({ type: 'png', timeout: 5000, animations: 'disabled' })
        // In a frame or a shadow root: found in its own frame, so the capture is placed right.
        if (!page.evaluateHandle) return undefined
        const element = await elementForRef(page as unknown as HandleFrame<ScreenshotHandle>, ref)
        if (!element) return undefined
        try {
          return await element.screenshot({ type: 'png', timeout: 5000, animations: 'disabled' })
        } finally {
          await element.dispose()
        }
      } catch {
        return undefined
      }
    },
    async screenshotPage(path) {
      await page.screenshot({ path, fullPage: true })
    },
    async cdp() {
      // Only Chromium has CDP; Firefox and WebKit pages, and older Pages without context(), go without it.
      const context = (page as { context?: () => { newCDPSession?: (page: unknown) => Promise<CdpSessionLike> } }).context?.()
      return context?.newCDPSession?.(page)
    },
  }
}

/**
 * Checks a Playwright page as it is now: axe-core, then the judgment layer with the
 * configured model (or none with `noLlm`). `include` and `exclude` scope the check to a
 * component. Returns the report `rampa check` builds; it never says the page is accessible.
 */
export function checkPage(page: PlaywrightPage, options?: CheckPageOptions): Promise<Report> {
  return checkDriver(playwrightDriver(page), options)
}

/** `expect.extend(rampaMatchers)`: `await expect(page).toPassRampa(options)` and `expect(report).toHaveNoRampaFindings()`. */
export const rampaMatchers = createMatchers(checkPage)

/** `test.extend<RampaFixtures>(rampaFixtures)` gives every test a `rampa` helper bound to its page. */
export const rampaFixtures = createFixtures(checkPage)

export type RampaFixtures = Fixtures<PlaywrightPage>
export type RampaHelper = Helper<PlaywrightPage>
