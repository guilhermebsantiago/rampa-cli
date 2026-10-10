/**
 * `rampa/puppeteer`: checkPage for a Puppeteer page. It runs the same in-page collector,
 * axe-core injection, scoping and judgment as `rampa/playwright`; only the four driver
 * calls differ. Puppeteer is never imported, so any version with these methods fits.
 */
import { type CheckPageOptions, checkDriver } from './api/page.ts'
import type { Report } from './core/types.ts'
import type { CdpSessionLike } from './surfaces/form-issues.ts'
import { type FrameElementLike, type HandleFrame, elementForRef, isQualifiedRef } from './snapshot/refs.ts'
import { type LibraryFrame, libraryFrameDriver } from './surfaces/frames.ts'
import type { PageDriver } from './surfaces/page.ts'
import { createMatchers } from './testing/matchers.ts'

export type { CheckPageOptions } from './api/page.ts'
export type { RampaOptions } from './api/options.ts'
export type * from './core/types.ts'
export { type PageDriver, collectPage } from './surfaces/page.ts'
export { type AssertOptions, formatFindings } from './testing/format.ts'
export { type MatcherResult, type MatcherState, type ToPassRampaOptions, assertRampa } from './testing/matchers.ts'

/** The parts of a Puppeteer Page that Rampa uses. */
export interface PuppeteerPage {
  url(): string
  // biome-ignore lint/suspicious/noExplicitAny: Puppeteer's evaluate is generic over its arguments; any keeps it assignable
  evaluate(pageFunction: string | ((...args: any[]) => unknown), ...args: any[]): Promise<unknown>
  /** Every Puppeteer Page has it; it reaches the page's frames, other origins included. Without it, axe-core checks the top frame only. */
  evaluateHandle?: LibraryFrame['evaluateHandle']
  $(selector: string): Promise<PuppeteerElement | null>
  screenshot(options?: { path?: string; fullPage?: boolean }): Promise<Uint8Array | string>
}

export interface PuppeteerElement {
  screenshot(options?: { type?: 'png' }): Promise<Uint8Array | string>
  dispose(): Promise<void>
}

/** A Puppeteer element handle that may show a frame. */
interface PuppeteerFrameElement extends PuppeteerElement, FrameElementLike<PuppeteerFrameElement> {}

export function puppeteerDriver(page: PuppeteerPage): PageDriver {
  const frames = page.evaluateHandle ? libraryFrameDriver(page as LibraryFrame) : undefined
  return {
    url: () => page.url(),
    ...(frames?.child ? { child: frames.child } : {}),
    evaluate: <Arg, Result>(fn: (arg: Arg) => Result | Promise<Result>, arg: Arg) => page.evaluate(fn, arg) as Promise<Result>,
    async run(source) {
      await page.evaluate(source)
    },
    async screenshotElement(ref) {
      // A ref into a frame or a shadow root is found in its own frame, so the capture is placed right.
      const element = isQualifiedRef(ref)
        ? page.evaluateHandle
          ? await elementForRef(page as unknown as HandleFrame<PuppeteerFrameElement>, ref).catch(() => undefined)
          : undefined
        : await page.$(ref).catch(() => null)
      if (!element) return undefined
      try {
        const png = await element.screenshot({ type: 'png' })
        return typeof png === 'string' ? Buffer.from(png, 'base64') : png
      } catch {
        // Not visible or detached: criteria that need the image skip this node.
        return undefined
      } finally {
        await element.dispose().catch(() => undefined)
      }
    },
    async screenshotPage(path) {
      await page.screenshot({ path, fullPage: true })
    },
    async cdp() {
      // Puppeteer 19 and later open a CDP session on the page itself; Firefox pages have none.
      const create = (page as { createCDPSession?: () => Promise<CdpSessionLike> }).createCDPSession
      return create ? create.call(page) : undefined
    },
  }
}

/** Checks a Puppeteer page as it is now, like `checkPage` in rampa/playwright, and returns the report `rampa check` builds. */
export function checkPage(page: PuppeteerPage, options?: CheckPageOptions): Promise<Report> {
  return checkDriver(puppeteerDriver(page), options)
}

/** `expect.extend(rampaMatchers)` in Jest or Vitest: `await expect(page).toPassRampa(options)` and `expect(report).toHaveNoRampaFindings()`. */
export const rampaMatchers = createMatchers(checkPage)
