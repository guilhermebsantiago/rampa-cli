import type { Page, Request } from 'playwright-core'

/**
 * The wait after load. Many pages render after the load event: a framework fetches data and draws it, a widget
 * mounts, a consent banner slides in. The collector waits until the page has been quiet for a short window,
 * on the network (no request for content in flight) and in the DOM (no mutation, no layout shift), and stops
 * waiting at a cap, so a page that never settles (a ticker, a poll) costs only the cap. A page still busy at the
 * cap is recorded in the snapshot (`reach.unsettledAfterMs`).
 */

export interface SettleOptions {
  /** How long the network and the DOM must stay quiet. */
  quietMs: number
  /** The longest wait. */
  capMs: number
}

/** The probes' setting (docs/plans/wcag-coverage.md, 4.5): 300 ms of quiet, at most 3 s. */
export const SETTLE: SettleOptions = { quietMs: 300, capMs: 3000 }

/** Requests that bring content: frame documents, scripts, styles and data. Images, fonts, media, beacons and sockets do not hold the wait. */
const CONTENT = new Set(['document', 'script', 'stylesheet', 'xhr', 'fetch'])

export interface NetworkWatch {
  /** Requests for content in flight. */
  pending(): number
  /** When a request for content last started or ended (Date.now()). */
  last(): number
  stop(): void
}

/** Watches the page's requests for content; started before navigation, so requests from before load are counted. */
export function watchNetwork(page: Page): NetworkWatch {
  const inflight = new Set<Request>()
  let last = Date.now()
  const started = (request: Request) => {
    if (!CONTENT.has(request.resourceType())) return
    inflight.add(request)
    last = Date.now()
  }
  const ended = (request: Request) => {
    if (inflight.delete(request)) last = Date.now()
  }
  page.on('request', started)
  page.on('requestfinished', ended)
  page.on('requestfailed', ended)
  return {
    pending: () => inflight.size,
    last: () => last,
    stop() {
      page.off('request', started)
      page.off('requestfinished', ended)
      page.off('requestfailed', ended)
    },
  }
}

/** Runs in the page: starts recording when the DOM last changed, as Date.now(), from mutations and layout shifts. */
export function watchChangesInPage(): void {
  const w = window as unknown as { __rampaChanged?: number; __rampaUnwatch?: () => void }
  w.__rampaUnwatch?.()
  w.__rampaChanged = Date.now()
  const touch = () => {
    w.__rampaChanged = Date.now()
  }
  const observer = new MutationObserver(touch)
  observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true })
  let shifts: PerformanceObserver | undefined
  try {
    shifts = new PerformanceObserver(touch)
    shifts.observe({ type: 'layout-shift', buffered: false })
  } catch {
    shifts = undefined
  }
  w.__rampaUnwatch = () => {
    observer.disconnect()
    shifts?.disconnect()
    w.__rampaUnwatch = undefined
  }
}

/** Runs in the page: milliseconds since the DOM last changed; with `stop`, stops watching too. */
export function sinceChangeInPage(stop: boolean): number {
  const w = window as unknown as { __rampaChanged?: number; __rampaUnwatch?: () => void }
  const since = Date.now() - (w.__rampaChanged ?? 0)
  if (stop) w.__rampaUnwatch?.()
  return since
}

/** Runs in the page: waits for web fonts, at most `ms`, since text set in a fallback font is measured and captured wrong. */
export async function fontsInPage(ms: number): Promise<void> {
  try {
    await Promise.race([document.fonts?.ready, new Promise((resolve) => setTimeout(resolve, ms))])
  } catch {
    // Fonts that fail to load still let the page settle.
  }
}

/**
 * Waits until the network and the DOM have both been quiet for `quietMs`, at most `capMs`. Returns how long it
 * waited and whether the page settled. A page that navigates meanwhile ends the wait; the collector then
 * reads the page it lands on.
 */
export async function settlePage(page: Page, network: NetworkWatch, options: SettleOptions = SETTLE): Promise<{ waitedMs: number; settled: boolean }> {
  const started = Date.now()
  const deadline = started + options.capMs
  const done = (settled: boolean) => ({ waitedMs: Date.now() - started, settled })
  try {
    await page.evaluate(watchChangesInPage)
    await page.evaluate(fontsInPage, options.capMs)
    for (;;) {
      const dom = await page.evaluate(sinceChangeInPage, false)
      const net = network.pending() > 0 ? 0 : Date.now() - network.last()
      if (dom >= options.quietMs && net >= options.quietMs) return done(true)
      const left = deadline - Date.now()
      if (left <= 0) return done(false)
      await new Promise((resolve) => setTimeout(resolve, Math.min(50, left)))
    }
  } catch {
    return done(true)
  } finally {
    await page.evaluate(sinceChangeInPage, true).catch(() => undefined)
  }
}
