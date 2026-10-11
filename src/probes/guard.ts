import type { BrowserContext, Page, Route } from 'playwright-core'
import type { ProbeRecord } from '../snapshot/schema.ts'

/**
 * The network guard, on for the whole life of a probe page (docs/probes.md):
 * - only GET, HEAD and OPTIONS reach the network; other requests (sendBeacon included) are aborted and logged;
 * - once the page is loaded, a top-level navigation is answered locally with 204 and logged;
 * - WebSockets and EventSource are blocked;
 * - popups are closed, dialogs dismissed (confirm answers cancel), downloads refused.
 * window.open and form submission are hooked in the page itself (kit.ts).
 *
 * With `allowSubmit` (the form probe's submissions, `--allow-submit`, docs/probes.md), and only then, the guard has a
 * submission window the probe opens around the one press that submits a form it chose. While the window is open, and
 * only for an origin the list names exactly (scheme, host and port), a write by the page's document, fetch or XHR goes
 * through, and so does a top-level navigation; each is logged in `submitted`. Outside the window, or for any other
 * origin, nothing changes. Such a page is also strict: once it has loaded, every request to an origin the list does
 * not name is blocked, whatever its method, so a step the submission leads to cannot reach a third party.
 */

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
/** The resource types a form's submission is made of: its navigation, or a page script's fetch or XHR. Beacons never are. */
const SUBMIT_TYPES = new Set(['document', 'fetch', 'xhr'])

export type GuardLog = ProbeRecord['guard']

export interface GuardOptions {
  /** Exact origins (`https://staging.example.com`, `http://127.0.0.1:5173`) where a submission window lets writes through. */
  allowSubmit?: readonly string[] | undefined
}

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
  /**
   * Opens the submission window: until `closeSubmit`, writes and navigations to the allowed origins go through. Throws
   * when the guard has no allowed origin, so no probe can open it by mistake.
   */
  openSubmit(): void
  closeSubmit(): void
  /** The origins the guard lets a submission reach; empty for every page but the form probe's submissions. */
  readonly allowed: readonly string[]
}

/** The origin of an address, or '' when it has none (data:, about:, a malformed address). */
export function originOf(url: string): string {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : ''
  } catch {
    return ''
  }
}

export async function installGuard(context: BrowserContext, options: GuardOptions = {}): Promise<Guard> {
  const start = Date.now()
  const now = () => Date.now() - start
  const log: GuardLog = { blocked: [], navigations: [], dialogs: [] }
  const allowed = [...new Set(options.allowSubmit ?? [])]
  const allow = new Set(allowed)
  // A page that may submit is strict once loaded: nothing reaches an origin the list does not name.
  const strict = allow.size > 0
  let ownPage: Page | undefined
  let armed = false
  let submitting = false

  const block = async (route: Route, method: string, type: string) => {
    log.blocked.push({ method, url: route.request().url().slice(0, 300), at: now(), type })
    return route.abort('blockedbyclient')
  }
  const handle = async (route: Route) => {
    const request = route.request()
    const method = request.method()
    const type = request.resourceType()
    const origin = originOf(request.url())
    try {
      if (strict && armed && origin !== '' && !allow.has(origin)) return await block(route, method, type)
      if (!SAFE_METHODS.has(method)) {
        // The one way a write gets out: the probe's submission window is open, the origin is named exactly, and the
        // request is the form's own (its navigation, or a script's fetch or XHR), never a beacon.
        if (submitting && allow.has(origin) && SUBMIT_TYPES.has(type)) {
          ;(log.submitted ??= []).push({ method, url: request.url().slice(0, 300), at: now(), type })
          return await route.fallback()
        }
        return await block(route, method, type)
      }
      if (type === 'eventsource') {
        log.blocked.push({ method: 'EVENTSOURCE', url: request.url().slice(0, 300), at: now() })
        return await route.abort('blockedbyclient')
      }
      if (armed && ownPage && request.isNavigationRequest()) {
        const frame = request.frame()
        if (frame === ownPage.mainFrame()) {
          // A submission with GET, or the next step after one, loads in the window when its origin is allowed.
          if (submitting && allow.has(origin)) {
            ;(log.submitted ??= []).push({ method, url: request.url().slice(0, 300), at: now(), type })
            return await route.fallback()
          }
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
    allowed,
    watch(page: Page) {
      ownPage = page
    },
    arm() {
      armed = true
    },
    openSubmit() {
      if (allow.size === 0) throw new Error('the guard has no origin to submit to')
      submitting = true
    },
    closeSubmit() {
      submitting = false
    },
  }
}
