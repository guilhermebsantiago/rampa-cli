import type { Browser, BrowserContext, BrowserContextOptions, Page } from 'playwright-core'
import type { ProbeRecord } from '../snapshot/schema.ts'
import { type BrowserOptions, contextOptions, openPage, prepareContext } from '../surfaces/browser-options.ts'
import { type Guard, installGuard } from './guard.ts'
import { installHooks, installKit, settleInPage } from './kit.ts'

export const PROBE_KINDS = ['layout', 'keyboard', 'hover', 'orientation', 'shortcuts', 'media'] as const
export type ProbeKind = (typeof PROBE_KINDS)[number]

export interface ProbeOptions {
  kinds: readonly ProbeKind[]
  browserOptions?: BrowserOptions | undefined
  timeoutMs?: number | undefined
}

/** One loaded probe page, behind its guard, with the kit installed. */
export interface ProbePage {
  page: Page
  context: BrowserContext
  guard: Guard
  conditions: ProbeRecord['conditions']
}

export interface ProbePageOptions {
  /** Overrides the context's viewport, such as 1280×1024 for the layout probes. */
  viewport?: { width: number; height: number } | undefined
  /** Desktop mode: the viewport meta is ignored, as with browser zoom. */
  desktop?: boolean | undefined
  variant?: string | undefined
  /**
   * Installs Playwright's fake clock before the page loads. Time still flows as usual; the probe can jump it
   * forward (`page.clock.runFor`) to see what a page's timers do after a while, without waiting.
   */
  clock?: boolean | undefined
  /** Context settings that win over the run's and over `desktop`: a phone's touch, scale and user agent. */
  context?: BrowserContextOptions | undefined
  /** Runs once the page exists and before it loads: emulation over the DevTools protocol, init scripts. */
  beforeLoad?: ((page: Page, context: BrowserContext) => Promise<void>) | undefined
}

export async function openProbePage(browser: Browser, url: string, options: ProbeOptions, page: ProbePageOptions = {}): Promise<ProbePage> {
  const base = contextOptions(options.browserOptions)
  const settings: BrowserContextOptions = {
    ...base,
    ...(page.desktop ? { isMobile: false, hasTouch: false, deviceScaleFactor: 1 } : {}),
    ...(page.viewport ? { viewport: page.viewport } : {}),
    ...page.context,
    acceptDownloads: false,
    serviceWorkers: 'block',
  }
  const context = await browser.newContext(settings)
  try {
    await prepareContext(context, url, options.browserOptions)
    // Registered after the header route, so the guard sees every request first.
    const guard = await installGuard(context)
    await context.addInitScript(installHooks)
    if (page.clock) await context.clock.install()
    const opened = await context.newPage()
    guard.watch(opened)
    await page.beforeLoad?.(opened, context)
    await openPage(opened, url, options.browserOptions, options.timeoutMs)
    guard.arm()
    await opened.evaluate(installKit)
    await opened.evaluate(settleInPage, { quietMs: 300, capMs: 3000 })
    const viewport = settings.viewport ?? { width: 1280, height: 800 }
    return {
      page: opened,
      context,
      guard,
      conditions: {
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: settings.deviceScaleFactor ?? 1,
        browser: `${browser.browserType().name()} ${browser.version()} (headless)`,
        ...(page.variant ? { variant: page.variant } : {}),
        ...(options.browserOptions?.colorScheme ? { colorScheme: options.browserOptions.colorScheme } : {}),
        ...(options.browserOptions?.reducedMotion ? { reducedMotion: true } : {}),
      },
    }
  } catch (error) {
    await context.close().catch(() => undefined)
    throw error
  }
}

/** A probe that could not run still leaves a record, so the report can say what was not checked and why. */
export function skippedRecord(kind: ProbeRecord['kind'], version: string, variant: string | undefined, reason: string, durationMs: number): ProbeRecord {
  return {
    kind,
    version,
    conditions: { viewport: { width: 0, height: 0 }, deviceScaleFactor: 1, browser: 'unknown', ...(variant ? { variant } : {}) },
    status: 'skipped',
    reason,
    guard: { blocked: [], navigations: [], dialogs: [] },
    durationMs,
    data: null,
  }
}

/** Waits until `ms` have passed since `since` (Date.now()). */
export async function waitUntil(page: Page, since: number, ms: number): Promise<void> {
  const left = since + ms - Date.now()
  if (left > 0) await page.waitForTimeout(left)
}
