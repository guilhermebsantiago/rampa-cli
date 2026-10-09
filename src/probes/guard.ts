import type { BrowserContext, Page, Route } from 'playwright-core'
import type { ProbeRecord } from '../snapshot/schema.ts'

/**
 * The network guard, on for the whole life of a probe page (docs/probes.md):
 * - only GET, HEAD and OPTIONS reach the network; other requests (sendBeacon included) are aborted and logged;
 * - once the page is loaded, a top-level navigation is answered locally with 204 and logged;
 * - WebSockets and EventSource are blocked;
 * - popups are closed, dialogs dismissed (confirm answers cancel), downloads refused.
 * window.open and form submission are hooked in the page itself (kit.ts).
 */

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export type GuardLog = ProbeRecord['guard']

export interface Guard {
  log: GuardLog
  /** The probe's own page: any other page the context opens is a popup. */
  watch(page: Page): void
  /** From now on, top-level navigations of the watched page are answered locally instead of followed. */
  arm(): void
  /** Milliseconds since the probe started, the clock every `at` uses. */
  now(): number
  /** Absolute start time (Date.now()), to place in-page hook events on the same clock. */
  start: number
}

export async function installGuard(context: BrowserContext): Promise<Guard> {
  const start = Date.now()
  const now = () => Date.now() - start
  const log: GuardLog = { blocked: [], navigations: [], dialogs: [] }
  let ownPage: Page | undefined
  let armed = false

  const handle = async (route: Route) => {
    const request = route.request()
    const method = request.method()
    try {
      if (!SAFE_METHODS.has(method)) {
        log.blocked.push({ method, url: request.url().slice(0, 300), at: now() })
        return await route.abort('blockedbyclient')
      }
      if (request.resourceType() === 'eventsource') {
        log.blocked.push({ method: 'EVENTSOURCE', url: request.url().slice(0, 300), at: now() })
        return await route.abort('blockedbyclient')
      }
      if (armed && ownPage && request.isNavigationRequest()) {
        const frame = request.frame()
        if (frame === ownPage.mainFrame()) {
          log.navigations.push({ url: request.url().slice(0, 300), at: now() })
          return await route.fulfill({ status: 204, body: '' })
        }
      }
      return await route.fallback()
    } catch {
      // The page closed while the request was in flight.
    }
  }
  await context.route('**/*', handle)
  await context.routeWebSocket(/.*/, (socket) => {
    log.blocked.push({ method: 'WEBSOCKET', url: socket.url().slice(0, 300), at: now() })
    socket.close().catch(() => undefined)
  })
  context.on('dialog', (dialog) => {
    log.dialogs.push({ type: dialog.type(), message: dialog.message().slice(0, 300), at: now() })
    dialog.dismiss().catch(() => undefined)
  })
  context.on('page', (page) => {
    // Every probe opens exactly one page; any other is a popup the page tried to open.
    if (ownPage && page !== ownPage) {
      log.navigations.push({ url: page.url().slice(0, 300), at: now(), cause: 'popup' })
      page.close().catch(() => undefined)
    }
  })
  return {
    log,
    now,
    start,
    watch(page: Page) {
      ownPage = page
    },
    arm() {
      armed = true
    },
  }
}
