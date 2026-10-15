import type { Browser, BrowserContext, BrowserContextOptions, CDPSession, Page, Request } from 'playwright-core'
import { RampaError } from '../core/util.ts'
import type { ProbeRecord } from '../snapshot/schema.ts'
import { type BrowserOptions, contextOptions, openPage, prepareContext } from '../surfaces/browser-options.ts'
import { type Guard, installGuard } from './guard.ts'
import { installHooks, installKit, settleInPage } from './kit.ts'

export const PROBE_KINDS = ['layout', 'keyboard', 'hover', 'orientation', 'shortcuts', 'media', 'color', 'states', 'variants', 'auth', 'flash', 'links', 'input', 'toggles', 'status', 'motion', 'form', 'pointer', 'parity', 'focus-order', 'gestures', 'cognitive'] as const
export type ProbeKind = (typeof PROBE_KINDS)[number]
/**
 * Kinds that run only when named: `--probe all` leaves them out. The authentication probe types into the password
 * fields of real sign-in forms (a dummy value, cleared), which nobody should get from a catch-all. The flash probe
 * plays media (muted) and takes some 200 captures of the window, which costs more than a catch-all should. The probes
 * of the activate class built on the harness (activate.ts) click controls, press keys on them, open dialogs and menus,
 * change settings, type into fields, drag, swipe, pinch or move the device, which the plan keeps opt-in (wcag-coverage.md, 4.4). The state-variants probe loads other pages over the network
 * (the page's versions in other languages), which a catch-all should not do either. The motion probe (2.2.2, 2.2.1)
 * moves the page's time for minutes, up to 20 hours, and presses controls named to pause, stop or hide what moves.
 * The cognitive observation (cognitive.ts) feeds only the advisories of `--profile cognitive`, which turns it on by
 * itself: a WCAG run has no use for its facts.
 */
export const OPT_IN_KINDS: readonly ProbeKind[] = ['variants', 'auth', 'flash', 'links', 'input', 'toggles', 'status', 'motion', 'form', 'pointer', 'parity', 'focus-order', 'gestures', 'cognitive']
/**
 * `--probe interact`: the plan's name for the activate class, every probe that presses, clicks, changes a setting,
 * types into a field, drags, swipes, pinches or moves the device (wcag-coverage.md, 4.4). The shortcuts probe is one of them, and stays in `all` as it
 * always was: it only presses printable keys with focus on the body (and Space on shortcut settings, toggled back),
 * and behind the guard a key can neither write, nor navigate any frame or window, nor send a GET to an address that
 * names a destructive action (guard.ts). What it can still set off is a GET to another address, which a server that
 * acts on GETs may act on (docs/probes.md, "The network guard"). The motion probe presses only pause, stop, hide and
 * extend controls, and costs a minute or more a page, so it runs only when named.
 */
export const INTERACT_KINDS: readonly ProbeKind[] = ['shortcuts', 'links', 'input', 'toggles', 'status', 'form', 'pointer', 'parity', 'focus-order', 'gestures']

export interface ProbeOptions {
  kinds: readonly ProbeKind[]
  browserOptions?: BrowserOptions | undefined
  timeoutMs?: number | undefined
  /**
   * `--allow-submit`: exact origins (scheme, host and port) where the form probe may submit forms (docs/probes.md,
   * "Submitting forms"). Every other probe ignores it, and its pages' guards never let a write through.
   */
  allowSubmit?: readonly string[] | undefined
  /** `--submit-dry-run`: the form probe lists what it would submit, and submits nothing. */
  submitDryRun?: boolean | undefined
  /**
   * How long the cognitive observation watches each load after its load event, in milliseconds (cognitive.ts): 8 s by
   * default, 3 s with --fast, or `coga.observe` seconds from the config.
   */
  observeMs?: number | undefined
}

/** One loaded probe page, behind its guard, with the kit installed. */
export interface ProbePage {
  page: Page
  context: BrowserContext
  guard: Guard
  conditions: ProbeRecord['conditions']
  /** With `follow`: the address the page landed on, when it is not the one asked for. */
  landed?: string | undefined
}

const QUIET_NAVIGATION_MS = 1500
const FOLLOW_CAP_MS = 15_000

/** A page evaluation that gives up after `ms`: a page busy with a challenge's computation does not answer. */
async function within<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms)
  })
  try {
    return await Promise.race([promise.catch(() => fallback), late])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Waits until the main frame has not navigated (nor started to) for a while, and shows something: a page with next to
 * no text and no control (a "Loading…" interstitial, a bot check computing before it sends itself on) has not landed.
 */
async function land(page: Page): Promise<void> {
  let last = Date.now()
  const onNavigation = (frame: { parentFrame(): unknown }) => {
    if (!frame.parentFrame()) last = Date.now()
  }
  const onRequest = (request: Request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) last = Date.now()
  }
  page.on('framenavigated', onNavigation)
  page.on('request', onRequest)
  const cap = Date.now() + FOLLOW_CAP_MS
  try {
    while (Date.now() < cap) {
      await page.waitForLoadState('load', { timeout: Math.max(1, cap - Date.now()) }).catch(() => undefined)
      await page.waitForTimeout(250)
      if (Date.now() - last < QUIET_NAVIGATION_MS) continue
      const bare = await within(
        page.evaluate(() => (document.body?.innerText ?? '').trim().length < 40 && !document.querySelector('input:not([type=hidden]), button, a[href], select, textarea')),
        1000,
        true,
      )
      if (!bare) break
    }
  } finally {
    page.off('framenavigated', onNavigation)
    page.off('request', onRequest)
  }
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
  /**
   * Follows the page's own navigations on load until it lands: an SSO sign-in page that bounces through other
   * addresses, or a challenge page that submits a form to itself. Until the page has gone 1.5 s without navigating
   * (at most 15 s), navigations and the page's own GET form submissions go through; then the guard arms as usual.
   */
  follow?: boolean | undefined
  /**
   * The form probe's submissions only: the origins its guard lets a submission reach, during the window the probe
   * opens around the press (guard.ts). Such a page also blocks every other origin once it has loaded.
   */
  allowSubmit?: readonly string[] | undefined
  /**
   * Gives the page no user activation: the kit is installed over the DevTools protocol (`quietEvaluate`) instead of
   * Playwright's evaluate, which runs every call as a user gesture, and the page is not waited on to settle. For the
   * cognitive observation, which must see what a page does before anyone touches it (a permission prompt, sound).
   */
  quiet?: boolean | undefined
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
    const guard = await installGuard(context, page.allowSubmit && page.allowSubmit.length > 0 ? { allowSubmit: page.allowSubmit } : {})
    await context.addInitScript(installHooks)
    if (page.clock) await context.clock.install()
    const opened = await context.newPage()
    guard.watch(opened)
    await page.beforeLoad?.(opened, context)
    if (page.follow) await opened.addInitScript(() => {
      ;(window as unknown as { __rampaFollow?: boolean }).__rampaFollow = true
    })
    await openPage(opened, url, options.browserOptions, options.timeoutMs)
    if (page.follow) await land(opened)
    guard.arm()
    if (page.follow) {
      // A page still busy (a challenge that never finished) may never answer: the probe stops rather than wait for it.
      const answered = await within(
        opened.evaluate(() => {
          ;(window as unknown as { __rampaFollow?: boolean }).__rampaFollow = false
          return true
        }),
        5000,
        false,
      )
      if (!answered || !(await within(opened.evaluate(installKit).then(() => true), 5000, false))) {
        throw new RampaError('probe-page-busy', 'the page did not land: it kept navigating or computing for 15 s after it loaded')
      }
    } else if (page.quiet) await quietEvaluate(opened, installKit)
    else await opened.evaluate(installKit)
    if (!page.quiet) await opened.evaluate(settleInPage, { quietMs: 300, capMs: 3000 })
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
      ...(page.follow && opened.url() !== url ? { landed: opened.url() } : {}),
    }
  } catch (error) {
    await context.close().catch(() => undefined)
    throw error
  }
}

const sessions = new WeakMap<Page, Promise<CDPSession>>()

/**
 * Runs `fn(arg)` in the page's main world over the DevTools protocol (Runtime.evaluate), as no person's gesture.
 * Playwright's own evaluate runs every call with `userGesture: true`, which gives the page user activation: from then
 * on `navigator.userActivation.hasBeenActive` is true, and the browser lets the page play sound or ask for permissions
 * as if someone had clicked. `fn` must be self-contained, as for page.evaluate, and `arg` and the result must be JSON.
 */
export async function quietEvaluate<A, R>(page: Page, fn: (arg: A) => R | Promise<R>, arg?: A): Promise<R> {
  let session = sessions.get(page)
  if (!session) {
    session = page.context().newCDPSession(page)
    sessions.set(page, session)
  }
  const cdp = await session
  const expression = `(${fn.toString()})(${arg === undefined ? '' : JSON.stringify(arg)})`
  const answer = (await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: false })) as {
    result?: { value?: unknown }
    exceptionDetails?: { text?: string; exception?: { description?: string } }
  }
  if (answer.exceptionDetails) throw new Error(answer.exceptionDetails.exception?.description?.split('\n')[0] ?? answer.exceptionDetails.text ?? 'evaluation threw')
  return answer.result?.value as R
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
