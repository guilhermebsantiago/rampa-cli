import type { BrowserContext, Frame, Page, Route } from 'playwright-core'
import type { ProbeRecord } from '../snapshot/schema.ts'

/**
 * The network guard, on for the whole life of a probe page (docs/probes.md):
 * - only GET, HEAD and OPTIONS reach the network; other requests (sendBeacon included) are aborted and logged;
 * - once the page is loaded (armed), every navigation is answered locally with 204 and logged: the page's own, a
 *   frame's (an iframe sent elsewhere, or one added after load) and a window's the page opened;
 * - once armed, a request of a safe method whose address names a destructive action in a path segment or the query
 *   (`/logout`, `/account/delete?id=1`, `?action=remove`; `destructiveAddress`) is aborted and logged, whatever loads
 *   it: a script's fetch or XHR, an image, a style, a frame's own resources;
 * - WebSockets and EventSource are blocked;
 * - popups are closed, dialogs dismissed (confirm answers cancel), downloads refused.
 * window.open and form submission are hooked in the page itself (kit.ts).
 * Before the guard is armed the page loads as it would for any visitor, and as Rampa collected it: its own GETs on
 * load go through, whatever their address.
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

/**
 * Words that name a destructive action in an address (en, pt-BR, es), read where a path segment or a query
 * parameter's name or value begins: `/logout`, `/users/sign_out`, `/cart/remove-item`, `/delete.php?id=3`,
 * `?action=deletePost`. Kept short on purpose: a GET to such an address is what a badly built server may act on, and
 * nothing a probe needs.
 */
export const DESTRUCTIVE_ADDRESS_WORDS: readonly string[] = [
  'logout', 'log-out', 'logoff', 'log-off', 'signout', 'sign-out', 'delete', 'remove', 'destroy', 'unsubscribe', 'deactivate',
  'sair', 'excluir', 'remover', 'apagar', 'descadastrar',
  'eliminar', 'borrar', 'cerrar-sesion',
]
const ADDRESS_WORDS = DESTRUCTIVE_ADDRESS_WORDS.map((word) => ({ word, tokens: word.split('-') }))
/** Files, not actions: a segment with one of these extensions (`delete.svg`, an icon) is never read for words. */
const STATIC_FILE = /\.(png|jpe?g|gif|webp|avif|svg|ico|bmp|tiff?|css|js|mjs|cjs|map|woff2?|ttf|otf|eot|mp4|m4v|webm|mov|mp3|m4a|wav|ogg|oga|opus|flac|vtt|srt|pdf|wasm)$/i

/** A segment's words, in order: decoded, camelCase split, lower case, no accents, an extension (`.php`, `.aspx`) dropped. */
function addressTokens(segment: string): string[] {
  let text = segment
  try {
    text = decodeURIComponent(segment)
  } catch {
    // A malformed escape: read it as it is.
  }
  if (STATIC_FILE.test(text)) return []
  return text
    .replace(/\.[a-z0-9]{1,5}$/i, '')
    .replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
}

/**
 * The destructive word an address names, or undefined: a path segment, or a query parameter's name or value, that is
 * the word or begins with it (`delete`, `delete-account`, `deleteItem`, `logout.php`, `sign_out`). The word inside a
 * segment (`/how-to-delete`, `/makeup-remover`), another word that begins the same (`/deleted`), a static file
 * (`/icons/delete.svg`) and the fragment do not count.
 */
export function destructiveAddress(url: string): string | undefined {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return undefined
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined
  const parts = [...parsed.pathname.split('/'), ...[...parsed.searchParams].flat()]
  for (const part of parts) {
    if (part === '') continue
    const tokens = addressTokens(part)
    const found = ADDRESS_WORDS.find((entry) => entry.tokens.every((token, i) => tokens[i] === token))
    if (found) return found.word
  }
  return undefined
}

export type GuardLog = ProbeRecord['guard']

export interface GuardOptions {
  /** Exact origins (`https://staging.example.com`, `http://127.0.0.1:5173`) where a submission window lets writes through. */
  allowSubmit?: readonly string[] | undefined
}

export interface Guard {
  log: GuardLog
  /** The probe's own page: any other page the context opens is a popup. */
  watch(page: Page): void
  /**
   * From now on, every navigation (the watched page's, a frame's, a popup's) is answered locally instead of followed,
   * and a request to an address that names a destructive action is aborted.
   */
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

  const block = async (route: Route, method: string, type: string, cause?: string) => {
    log.blocked.push({ method, url: route.request().url().slice(0, 300), at: now(), type, ...(cause ? { cause } : {}) })
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
      if (armed && request.isNavigationRequest()) {
        let frame: Frame | undefined
        try {
          frame = request.frame()
        } catch {
          frame = undefined
        }
        const url = request.url().slice(0, 300)
        if (ownPage && frame === ownPage.mainFrame()) {
          // A submission with GET, or the next step after one, loads in the window when its origin is allowed.
          if (submitting && allow.has(origin)) {
            ;(log.submitted ??= []).push({ method, url, at: now(), type })
            return await route.fallback()
          }
          log.navigations.push({ url, at: now() })
          return await route.fulfill({ status: 204, body: '' })
        }
        // Any other frame: one of the page's own (an iframe sent elsewhere, or added after load), or a window the page
        // opened, which Playwright never reports as a page once its first load is answered with 204.
        let page: Page | undefined
        try {
          page = frame?.page() ?? undefined
        } catch {
          page = undefined
        }
        if (ownPage && page === ownPage) log.blocked.push({ method, url, at: now(), type, cause: 'frame' })
        else log.navigations.push({ url, at: now(), cause: 'popup' })
        return await route.fulfill({ status: 204, body: '' })
      }
      if (armed) {
        // Whatever loads it (a script's fetch or XHR, an image, a style, a frame's resource): a GET to /logout is not sent.
        const word = destructiveAddress(request.url())
        if (word) return await block(route, method, type, `destructive: ${word}`)
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
