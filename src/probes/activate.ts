import type { Browser } from 'playwright-core'
import type { ProbeRecord } from '../snapshot/schema.ts'
import type { GuardLog } from './guard.ts'
import type { InPageElement } from './kit.ts'
import { type ProbeOptions, type ProbePage, type ProbePageOptions, openProbePage } from './page.ts'

/**
 * The activate class (docs/plans/wcag-coverage.md, 4.4; docs/probes.md): a harness for probes that click, change a
 * setting or type, which the observe class never does. The shortcuts probe was the first of the class; this
 * generalizes what it does (a change watch with noise learned in a wait with no input, the guard on all along) and adds:
 *
 * - a skip list: controls whose name or code is destructive, transactional or account-changing (en, pt-BR, es),
 *   submit buttons, controls in forms with password, payment or file fields, downloads, new windows, other origins;
 * - a budget of controls and of time per page;
 * - a fresh page (a new browser context, so storage does not carry over either) before the next control once one
 *   changed anything, or before every control when a probe asks for it, so effects never stack;
 * - overlays: a control under another layer (a cookie wall) is not exercised and the layer is named; a dialog or layer
 *   that an activation opens is recorded, and its own controls are not exercised;
 * - navigations a control starts are intercepted in the page before any request is made (the Navigation API's
 *   `navigate` event, cancelled once the page has loaded), and recorded: never followed. The network guard stays the
 *   backstop, answering any top-level navigation that slips through with 204;
 * - a log of every action (load, activation, skip, intercepted navigation, window, submission, download, dialog) and the
 *   guard's log of every blocked request, both written to the probe record.
 */

/** Controls and time per page; a probe can ask for less or more (the on-input probe changes at most 40 controls). */
export const ACTIVATE_LIMITS = { controls: 30, timeMs: 90_000 }

/**
 * Words that name a destructive, transactional or account-changing action, or a consent, in English, Brazilian
 * Portuguese and Spanish, written as `skipText` leaves them (lower case, no accents). A control whose name, title,
 * label or value holds one is never touched.
 */
export const SKIP_WORDS: Readonly<Record<'en' | 'pt-BR' | 'es', readonly string[]>> = {
  en: [
    'delete', 'deleting', 'remove', 'erase', 'destroy', 'discard', 'trash', 'wipe', 'purge', 'empty trash', 'empty cart', 'empty basket',
    'clear all', 'clear cart', 'clear history', 'clear data', 'buy', 'buy now', 'purchase', 'checkout', 'check out', 'pay', 'pay now', 'payment',
    'place order', 'order now', 'donate', 'add to cart', 'add to bag', 'add to basket', 'subscribe', 'unsubscribe', 'opt out', 'sign out',
    'signout', 'log out', 'logout', 'log off', 'logoff', 'deactivate', 'close account', 'delete account', 'cancel subscription', 'cancel order',
    'cancel membership', 'cancel plan', 'cancel account', 'cancel booking', 'cancel reservation', 'submit', 'send', 'post', 'publish', 'confirm',
    'approve', 'accept', 'agree', 'allow', 'consent', 'transfer', 'withdraw', 'book now', 'reserve', 'renew', 'upgrade', 'downgrade', 'follow',
    'unfollow', 'like', 'unlike', 'vote', 'upvote', 'downvote', 'report abuse', 'report spam', 'block', 'ban', 'invite', 'reset', 'archive',
    'install', 'uninstall', 'download', 'print', 'save', 'join', 'leave group', 'reply', 'bookmark', 'favorite', 'favourite', 'unfavorite',
    'unfavourite', 'add to favorites', 'add to favourites', 'add to wishlist', 'revoke', 'deploy',
  ],
  'pt-BR': [
    'excluir', 'apagar', 'deletar', 'remover', 'eliminar', 'descartar', 'esvaziar', 'limpar tudo', 'limpar carrinho', 'limpar historico', 'comprar',
    'compre', 'comprar agora', 'compre agora', 'finalizar compra', 'finalizar pedido', 'fechar pedido', 'fazer pedido', 'pagar', 'pague',
    'pagamento', 'doar', 'doe', 'doacao', 'adicionar ao carrinho', 'adicionar a sacola', 'assinar', 'assine', 'cancelar assinatura',
    'cancelar inscricao', 'cancelar pedido', 'cancelar conta', 'cancelar plano', 'descadastrar', 'desinscrever', 'sair', 'deslogar', 'desconectar',
    'encerrar sessao', 'encerrar conta', 'desativar', 'enviar', 'envie', 'submeter', 'publicar', 'postar', 'confirmar', 'aprovar', 'aceitar',
    'aceito', 'concordo', 'permitir', 'transferir', 'sacar', 'reservar', 'renovar', 'contratar', 'seguir', 'deixar de seguir', 'curtir', 'votar',
    'denunciar', 'bloquear', 'redefinir', 'arquivar', 'instalar', 'desinstalar', 'baixar', 'imprimir', 'salvar', 'participar', 'finalizar',
    'concluir', 'inscrever', 'agendar', 'favoritar', 'adicionar aos favoritos', 'adicionar a lista de desejos',
  ],
  es: [
    'eliminar', 'borrar', 'quitar', 'suprimir', 'descartar', 'vaciar', 'vaciar carrito', 'comprar', 'compra ahora', 'comprar ahora',
    'finalizar compra', 'tramitar pedido', 'realizar pedido', 'hacer pedido', 'pagar', 'paga', 'pago', 'donar', 'dona', 'donacion',
    'anadir al carrito', 'agregar al carrito', 'suscribir', 'suscribirse', 'suscribete', 'darse de baja', 'darme de baja', 'cancelar suscripcion',
    'cancelar pedido', 'cancelar cuenta', 'cerrar sesion', 'salir', 'desconectar', 'desactivar', 'enviar', 'envia', 'publicar', 'confirmar',
    'aprobar', 'aceptar', 'acepto', 'permitir', 'transferir', 'retirar', 'reservar', 'renovar', 'contratar', 'seguir', 'dejar de seguir',
    'me gusta', 'votar', 'denunciar', 'bloquear', 'restablecer', 'archivar', 'instalar', 'desinstalar', 'descargar', 'imprimir', 'guardar', 'unirse',
    'anadir a favoritos', 'agregar a favoritos', 'anadir a la lista de deseos',
  ],
}

/**
 * Words that skip a control only when it is a plain button (`ControlFacts.button`: not a toggle, not a control that
 * opens a menu or dialog, not a link to an address) whose name begins with one: "Order", "Book a table", "Register",
 * "Share", "Activar cuenta". As nouns, or on links, they name ordinary navigation ("Order history", "Book reviews",
 * a "Register" link to the sign-up page), which the probes need; "Order by" sorts, and "Order history" is a list.
 */
export const SKIP_BUTTON_WORDS: readonly string[] = ['order', 'reorder', 'book', 'register', 'share', 'cadastrar', 'compartilhar', 'compartir', 'registrar', 'registrarse', 'activar']
/** What a button word may be followed by and be no action of its own: a sort, or a noun ("Order history" opens a list). */
const BUTTON_WORD_EXCEPTIONS = ['order by', 'order history', 'order status', 'order details', 'order summary', 'order tracking', 'book reviews']

/**
 * The same kind of words, read in a control's code: its id, class, inline handler, data attributes, and its address's
 * path and query (`deleteItem(3)`, `btn-logout`, `javascript:removeItem(3)`, `/account/delete?id=1`). Only words that
 * are verbs in code too: `send` and `submit` are left out, because analytics calls (`ga('send', …)`) sit in front of
 * most scripted navigations.
 */
export const SKIP_CODE_WORDS: readonly string[] = [
  'delete', 'remove', 'destroy', 'erase', 'purge', 'trash', 'logout', 'log out', 'signout', 'sign out', 'logoff', 'log off', 'unsubscribe',
  'checkout', 'purchase', 'buy', 'pay', 'payment', 'donate', 'deactivate', 'add to cart', 'download', 'print', 'excluir', 'deletar', 'apagar',
  'remover', 'eliminar', 'borrar', 'comprar', 'pagar', 'descadastrar', 'sair', 'deslogar', 'cerrar sesion', 'encerrar sessao', 'desativar',
  'desactivar',
]

/** Lower case, no accents, camelCase split, every run of other characters one space, padded with spaces. */
export function skipText(text: string): string {
  const words = text
    .replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
  return ` ${words} `
}

const NAME_PHRASES = [...new Set(Object.values(SKIP_WORDS).flat().map((word) => skipText(word).trim()))]
const CODE_PHRASES = [...new Set(SKIP_CODE_WORDS.map((word) => skipText(word).trim()))]

function firstPhrase(phrases: readonly string[], texts: ReadonlyArray<string | undefined>): string | undefined {
  for (const text of texts) {
    if (!text) continue
    const normalized = skipText(text)
    const found = phrases.find((phrase) => normalized.includes(` ${phrase} `))
    if (found) return found
  }
  return undefined
}

/** The skip-list word a control's visible or accessible texts hold, each text read on its own. */
export function destructiveWord(...texts: ReadonlyArray<string | undefined>): string | undefined {
  return firstPhrase(NAME_PHRASES, texts)
}

/** The skip-list word a control's code holds (id, class, handler, address, data attributes). */
export function destructiveCode(...texts: ReadonlyArray<string | undefined>): string | undefined {
  return firstPhrase(CODE_PHRASES, texts)
}

/** The button word (`SKIP_BUTTON_WORDS`) a plain button's name begins with. */
export function buttonWord(...texts: ReadonlyArray<string | undefined>): string | undefined {
  for (const text of texts) {
    if (!text) continue
    const normalized = skipText(text)
    if (BUTTON_WORD_EXCEPTIONS.some((phrase) => normalized.startsWith(` ${phrase} `))) continue
    const found = SKIP_BUTTON_WORDS.find((word) => normalized.startsWith(` ${word} `))
    if (found) return found
  }
  return undefined
}

/** What the page tells about a control, for the skip list. Read in the page by the kit (`facts`). */
export interface ControlFacts {
  /**
   * Accessible name and visible texts: its label, title, aria-label, alt, value, and the alt, title and aria-label of
   * what it holds (an icon's `<img alt>`, an `<svg><title>`).
   */
  texts: string[]
  /** Its id, class, name attribute, inline click and change handlers, address (path and query), data-* values. */
  code: string[]
  /**
   * A plain button: a button, an image or button input, `role=button` or `menuitem`, or a link that goes nowhere
   * (`href="#"`, `javascript:`, none), that is not a toggle (`aria-pressed`) and opens no menu or dialog
   * (`aria-haspopup`, `aria-expanded`). Only such a control is skipped for a button word.
   */
  button?: boolean | undefined
  disabled: boolean
  /** A submit button, image input, or a button with no type inside a form. */
  submit: boolean
  /** Inside a form that holds a password, file or payment field (`autocomplete="cc-…"`, or a name or id with cc-, card, cvv or cvc). */
  sensitiveForm: boolean
  /** A `download` attribute, or an address that ends in a file extension. */
  download: boolean
  /** Its `target`, when it opens in another window. */
  target?: string | undefined
  /** The origin its address resolves to, when it has an http(s) address. */
  origin?: string | undefined
  /** `data-method` (Rails UJS) other than get: activating it sends another method. */
  method?: string | undefined
  /** A password or file field itself. */
  secret?: boolean | undefined
}

export const SKIP_REASONS = ['destructive', 'submit', 'sensitive-form', 'download', 'new-window', 'other-origin', 'disabled', 'secret'] as const
export type SkipReason = (typeof SKIP_REASONS)[number]

/** Why the harness never touches a control, or undefined when it may. `origin` is the page's own. */
export function skipReason(facts: ControlFacts, origin: string): { reason: SkipReason; detail?: string | undefined } | undefined {
  if (facts.disabled) return { reason: 'disabled' }
  if (facts.secret) return { reason: 'secret' }
  if (facts.sensitiveForm) return { reason: 'sensitive-form' }
  if (facts.submit) return { reason: 'submit' }
  if (facts.method && facts.method.toLowerCase() !== 'get') return { reason: 'submit', detail: `data-method="${facts.method}"` }
  if (facts.download) return { reason: 'download' }
  if (facts.target && !['_self', '_top', '_parent', ''].includes(facts.target.toLowerCase())) return { reason: 'new-window', detail: `target="${facts.target}"` }
  if (facts.origin && facts.origin !== origin) return { reason: 'other-origin', detail: facts.origin }
  const word = destructiveWord(...facts.texts) ?? (facts.button ? buttonWord(...facts.texts) : undefined)
  if (word) return { reason: 'destructive', detail: word }
  const code = destructiveCode(...facts.code)
  if (code) return { reason: 'destructive', detail: code }
  return undefined
}

/** A skip decision, as `skipReason` makes it; a probe with its own exceptions passes its own to `Harness.locate`. */
export type SkipCheck = (facts: ControlFacts) => { reason: SkipReason | string; detail?: string | undefined } | undefined

/** One entry of the harness log: what it did, on which element, at what time (ms since the probe started). */
export interface HarnessAction {
  at: number
  action: 'load' | 'learn' | 'activate' | 'skip' | 'not-exercised' | 'navigation' | 'window' | 'submit' | 'download' | 'dialog' | 'blocked' | 'unmatched'
  ref?: string | undefined
  label?: string | undefined
  detail?: string | undefined
}

/** A navigation the page started, as the `navigate` event saw it; cross-document ones were cancelled. */
export interface InterceptedNavigation {
  url: string
  /** push, replace, reload or traverse. */
  type: string
  /** A change within the document: a fragment, pushState or replaceState. Never cancelled. */
  same: boolean
  download?: boolean | undefined
  at: number
}

export interface ChangeSample {
  ref: string
  id: InPageElement['id']
  tag: string
  label: string
  /** What happened to it: added, removed, text, or the attribute that changed. */
  what: string
}

/** A dialog or a layer over the page that showed during a window: its controls are not exercised. */
export interface OpenedLayer extends InPageElement {
  /** Its name: aria-label, its labelling element, its first heading, or the start of its text. */
  name: string
  modal: boolean
  /** Share of the window it covers, 0 to 1. */
  cover: number
}

/** What happened in one window (an activation, or a wait with no input). Facts only: rules decide what counts. */
export interface Watch {
  /** Mutations a reader would notice: nodes added or removed, text, ARIA, role and state attributes. */
  dom: number
  /** class and style changes. */
  style: number
  samples: ChangeSample[]
  /** Where focus is now, when it moved off the element that had it. */
  focus?: InPageElement | undefined
  /** Focus went back to the document. */
  focusLost?: boolean | undefined
  scroll?: { x: number; y: number } | undefined
  /** The address now, when it changed without a page load (a fragment, pushState). */
  url?: string | undefined
  /** Only the fragment of the address changed: the page scrolled, nothing else needs a fresh page. */
  hashOnly?: boolean | undefined
  /** Navigations the page started (cross-document ones intercepted), and those the guard answered (`guard: true`). */
  navigations: Array<InterceptedNavigation & { guard?: boolean | undefined }>
  /** Addresses of windows the page tried to open (window.open returns null; popups are closed). */
  windows: string[]
  /** Form submissions, cancelled: the form's action. */
  submits: string[]
  /** Browser dialogs (alert, confirm, prompt), dismissed. */
  dialogs: string[]
  /** showModal calls. */
  modals: number
  /** A dialog or layer that showed. */
  opened?: OpenedLayer | undefined
  /** Lines of visible text before, and characters in lines that changed (removed plus added). */
  text: { before: number; changed: number }
  /** The page's title and first heading now, when the address changed in place. */
  title?: string | undefined
  heading?: string | undefined
  /** Writes to localStorage, sessionStorage or document.cookie. */
  storage: number
  /** Requests the guard blocked during the window. */
  blocked: number
  /** window.close() or print() calls, ignored. */
  ignored?: string[] | undefined
  ms: number
}

/**
 * Whether a window changed the page so that the next control must get a fresh one. Text that changed with no mutation
 * outside the noise is the page's own doing (a carousel), not the input's.
 */
export function changedPage(watch: Watch): boolean {
  return (
    watch.dom > 0 ||
    (watch.url !== undefined && watch.hashOnly !== true) ||
    watch.storage > 0 ||
    watch.opened !== undefined ||
    watch.modals > 0 ||
    watch.focusLost === true
  )
}

interface ActivateWindow {
  __rampaKit: {
    describe(el: Element): InPageElement
    visible(el: Element): boolean
    deepActive(): Element | null
    resolve(ref: string): Element | null
    identity(el: Element): { tag: string; sig: string }
    drain(): Array<{ type: string; at: number; detail?: string; ref?: string }>
  }
  __rampaSelf?: boolean
  __rampaArmed?: boolean
  __rampaNav?: InterceptedNavigation[]
  __rampaStorage?: number
  __rampaIgnored?: string[]
  __rampaActivate?: {
    /** With `own`, the texts are the element's own words, without the controls inside it (a list item's "Remove"). */
    facts(el: Element, options?: { own?: boolean }): ControlFacts
    locate(args: { ref: string; sig: string }): boolean
    target(): Element | null
    aim(args: { el?: 'target' | 'label' }): { x: number; y: number } | { cover: InPageElement & { text: string } } | { hidden: true }
    begin(): void
    peek(): number
    quiet(args: { quietMs: number; capMs: number }): Promise<number>
    end(args: { noise: boolean }): Omit<Watch, 'blocked' | 'ms'>
    /** The element, or an ancestor, changed in a wait with no input: what changes there is the page's own doing. */
    noisy(el: Element): boolean
  }
  __rampaTarget?: Element | null
}

/**
 * Hooks installed before any page script runs, in every frame. Once the probe arms them (`__rampaArmed`, top window
 * only), every navigation the page starts is recorded from the Navigation API's `navigate` event, and a navigation to
 * another document (or a download) is cancelled there, before any request leaves. Writes to storage and cookies are
 * counted; window.close() and print() are ignored and recorded.
 */
export function installActivateHooks(): void {
  const w = window as unknown as ActivateWindow & { navigation?: EventTarget }
  if (w.__rampaNav) return
  w.__rampaNav = []
  w.__rampaStorage = 0
  w.__rampaIgnored = []
  w.navigation?.addEventListener('navigate', (event: Event) => {
    if (!w.__rampaArmed) return
    const e = event as Event & { destination?: { url?: string; sameDocument?: boolean }; navigationType?: string; downloadRequest?: string | null }
    const same = e.destination?.sameDocument === true
    const download = e.downloadRequest !== null && e.downloadRequest !== undefined
    w.__rampaNav?.push({ url: String(e.destination?.url ?? '').slice(0, 500), type: String(e.navigationType ?? ''), same, ...(download ? { download: true } : {}), at: Date.now() })
    if ((!same || download) && e.cancelable) e.preventDefault()
  })
  const count = () => {
    if (w.__rampaArmed) w.__rampaStorage = (w.__rampaStorage ?? 0) + 1
  }
  for (const method of ['setItem', 'removeItem', 'clear'] as const) {
    const original = Storage.prototype[method] as (...args: unknown[]) => unknown
    ;(Storage.prototype as unknown as Record<string, unknown>)[method] = function (this: Storage, ...args: unknown[]) {
      count()
      return original.apply(this, args)
    }
  }
  const cookie = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie')
  if (cookie?.get && cookie.set) {
    const { get, set } = cookie
    Object.defineProperty(Document.prototype, 'cookie', {
      configurable: true,
      get(this: Document) {
        return get.call(this)
      },
      set(this: Document, value: string) {
        count()
        set.call(this, value)
      },
    })
  }
  const close = window.close.bind(window)
  window.close = () => {
    if (w.__rampaArmed) w.__rampaIgnored?.push('close')
    else close()
  }
  window.print = () => {
    if (w.__rampaArmed) w.__rampaIgnored?.push('print')
  }
}

/**
 * Installs `window.__rampaActivate` (needs the kit): the facts the skip list reads, locating a control by its ref and
 * identity, aiming at it (in view, on top), and the change watch. The watch is the shortcuts probe's, generalized: a
 * mutation observer that counts what a reader would notice outside what changed in a wait with no input (noise), plus
 * focus, scroll, the address, intercepted navigations, the kit's hooks (window.open, submit, showModal, history), a
 * dialog or layer that showed, how much visible text changed, and storage writes.
 */
export function installActivateKit(): void {
  const w = window as unknown as ActivateWindow
  if (w.__rampaActivate) return
  const kit = w.__rampaKit
  const collapse = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim()
  const cut = (value: string, n: number) => (value.length > n ? `${value.slice(0, n - 1)}…` : value)
  const STATE = /^(aria-|role$|hidden$|open$|checked$|selected$|disabled$|value$|src$|href$|inert$|title$|alt$|tabindex$|contenteditable$)/
  const SKIP = new Set(['script', 'style', 'link', 'meta', 'noscript', 'template', 'title', 'head', 'base'])
  const FILE = /\.(pdf|zip|gz|tgz|7z|rar|tar|exe|msi|dmg|pkg|apk|ipa|deb|rpm|iso|docx?|xlsx?|pptx?|odt|ods|odp|csv|epub|mp3|mp4|mov|avi|wav)(\?|#|$)/i
  const noise = new WeakSet<Node>()
  let records: MutationRecord[] = []
  let recording = false
  const observer = new MutationObserver((list) => {
    if (recording) records.push(...list)
  })
  observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true, characterDataOldValue: true })
  const elementOf = (node: Node): Element | null => (node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement)
  const inNoise = (node: Node): boolean => {
    for (let n: Node | null = node, i = 0; n && i < 40; n = n.parentNode, i++) if (noise.has(n)) return true
    return false
  }
  const skipped = (node: Node): boolean => {
    const el = elementOf(node)
    return !el || SKIP.has(el.localName) || el.closest('head') !== null
  }
  const labelledBy = (el: Element): string =>
    collapse(
      (el.getAttribute('aria-labelledby') ?? '')
        .split(/\s+/)
        .filter(Boolean)
        .map((id) => document.getElementById(id)?.textContent ?? '')
        .join(' '),
    )
  // The names an element's content gives it besides its text: an icon's alt, an <svg>'s <title>, an aria-label or title inside.
  const innerNames = (root: Element): string[] => {
    const out: string[] = []
    for (const child of Array.from(root.querySelectorAll('img[alt], area[alt], input[type=image][alt], svg title, [aria-label], [title]')).slice(0, 20)) {
      if (child.localName === 'title') out.push(collapse(child.textContent))
      else for (const attribute of ['alt', 'aria-label', 'title']) out.push(collapse(child.getAttribute(attribute)))
    }
    return out.filter(Boolean)
  }
  const nameOf = (el: Element): string => {
    const labels = 'labels' in el ? Array.from((el as HTMLInputElement).labels ?? []).map((l) => collapse(l.textContent)).join(' ') : ''
    return collapse(
      el.getAttribute('aria-label') ||
        labelledBy(el) ||
        labels ||
        collapse((el as HTMLElement).innerText ?? el.textContent) ||
        el.getAttribute('alt') ||
        innerNames(el).join(' ') ||
        el.getAttribute('title') ||
        '',
    )
  }
  const CONTROLS_INSIDE = 'button, a, input, select, textarea, [role=button], [role=link]'
  const facts = (el: Element, options?: { own?: boolean }): ControlFacts => {
    const input = el as HTMLInputElement
    const form = (el as HTMLInputElement).form ?? el.closest('form')
    const type = (el.getAttribute('type') ?? '').toLowerCase()
    const href = (el.getAttribute('href') ?? '').trim()
    let origin: string | undefined
    if (href !== '' && !href.startsWith('#') && !/^javascript:/i.test(href)) {
      try {
        const url = new URL(href, document.baseURI)
        if (url.protocol === 'http:' || url.protocol === 'https:') origin = url.origin
      } catch {
        origin = undefined
      }
    }
    const data = Array.from(el.attributes)
      .filter((a) => a.name.startsWith('data-') && a.value.length <= 200)
      .map((a) => `${a.name.slice(5)} ${a.value}`)
    // Its own words (a list item's, without the "Remove" button inside it), or its name and everything it holds.
    let names: string[]
    if (options?.own) {
      const clone = el.cloneNode(true) as Element
      for (const control of Array.from(clone.querySelectorAll(CONTROLS_INSIDE))) control.remove()
      names = [collapse(el.getAttribute('aria-label') || labelledBy(el) || clone.textContent), ...innerNames(clone)]
    } else names = [nameOf(el), ...innerNames(el)]
    const texts = [...names, el.getAttribute('title') ?? '', el.getAttribute('aria-label') ?? '', el.getAttribute('alt') ?? '', el.localName === 'input' && ['button', 'submit', 'reset'].includes(type) ? input.value : '']
      .map((t) => cut(collapse(t), 200))
      .filter(Boolean)
    // The address's path and query, as the page wrote it (never the page's own address a fragment link resolves to).
    let path = ''
    if (href !== '' && !href.startsWith('#') && !/^javascript:/i.test(href)) {
      path = href.replace(/#.*$/, '').replace(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i, '')
      try {
        path = decodeURIComponent(path)
      } catch {
        // A malformed escape: read it as it is.
      }
    }
    // The attribute, not the property: a page may define its own `id` property on an element (undefined, or another node).
    const code = [el.getAttribute('id') ?? '', el.getAttribute('class') ?? '', el.getAttribute('name') ?? '', el.getAttribute('onclick') ?? '', el.getAttribute('onchange') ?? '', el.getAttribute('oninput') ?? '', /^\s*javascript:/i.test(href) ? href : '', path, ...data]
      .map((t) => cut(t, 300))
      .filter(Boolean)
    const submit =
      (el.localName === 'input' && ['submit', 'image'].includes(type)) || (el.localName === 'button' && (type === 'submit' || (type === '' && form !== null)))
    // A plain button: it acts on its own, rather than toggling, opening a menu or dialog, or leading to an address.
    const role = (el.getAttribute('role') ?? '').trim().split(/\s+/)[0]?.toLowerCase() ?? ''
    const leads = (el.localName === 'a' || el.localName === 'area') && href !== '' && href !== '#' && !/^javascript:/i.test(href)
    const buttonLike =
      !leads &&
      (role === 'button' ||
        role === 'menuitem' ||
        (role === '' &&
          ((el.localName === 'button' && type !== 'reset') || (el.localName === 'input' && ['button', 'submit', 'image'].includes(type)) || el.localName === 'a')))
    const opens = el.hasAttribute('aria-pressed') || el.hasAttribute('aria-expanded') || !['', 'false'].includes((el.getAttribute('aria-haspopup') ?? '').trim().toLowerCase())
    // Payment fields by their autocomplete token, or by a name or id that says so (cc-number, cardNumber, cvv) when the token is missing.
    const PAYMENT = 'input[type=password],input[type=file],[autocomplete^="cc-"],input[name^="cc-" i],input[id^="cc-" i],input[name^="cc_" i],input[id^="cc_" i],input[name*="card" i],input[id*="card" i],input[name*="cvv" i],input[id*="cvv" i],input[name*="cvc" i],input[id*="cvc" i]'
    const sensitiveForm = form !== null && form.querySelector(PAYMENT) !== null
    const target = el.getAttribute('target') ?? undefined
    const method = el.getAttribute('data-method') ?? undefined
    return {
      texts,
      code,
      ...(buttonLike && !opens ? { button: true } : {}),
      disabled: (el as HTMLInputElement).disabled === true || el.getAttribute('aria-disabled') === 'true',
      submit,
      sensitiveForm,
      download: el.hasAttribute('download') || (href !== '' && FILE.test(href)),
      ...(target ? { target } : {}),
      ...(origin ? { origin } : {}),
      ...(method ? { method } : {}),
      ...(el.localName === 'input' && (type === 'password' || type === 'file') ? { secret: true } : {}),
    }
  }
  const viewportArea = () => Math.max(1, window.innerWidth * window.innerHeight)
  const coverOf = (el: Element): number => {
    const r = el.getBoundingClientRect()
    const width = Math.max(0, Math.min(r.right, window.innerWidth) - Math.max(r.left, 0))
    const height = Math.max(0, Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0))
    return (width * height) / viewportArea()
  }
  const DIALOG = 'dialog[open],[role=dialog],[role=alertdialog],[aria-modal=true]'
  // A dialog that shows, or a fixed layer over a quarter of the window: what an activation may open, or what covers a control.
  const layers = (): Element[] => {
    const found = new Set<Element>()
    for (const el of Array.from(document.querySelectorAll(DIALOG))) if (kit.visible(el) && el.getBoundingClientRect().width > 0) found.add(el)
    const walker = document.createTreeWalker(document.body ?? document.documentElement, NodeFilter.SHOW_ELEMENT)
    for (let n = walker.nextNode(), i = 0; n && i < 20_000; n = walker.nextNode(), i++) {
      const el = n as HTMLElement
      if (el.offsetParent !== null || SKIP.has(el.localName)) continue
      const style = getComputedStyle(el)
      if (style.position !== 'fixed' || style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) continue
      if (coverOf(el) >= 0.25) found.add(el)
    }
    return [...found]
  }
  const layerName = (el: Element): string => {
    const labelled = collapse(
      (el.getAttribute('aria-labelledby') ?? '')
        .split(/\s+/)
        .filter(Boolean)
        .map((id) => document.getElementById(id)?.textContent ?? '')
        .join(' '),
    )
    const heading = collapse(el.querySelector('h1,h2,h3,h4,h5,h6,[role=heading]')?.textContent)
    return cut(collapse(el.getAttribute('aria-label')) || labelled || heading || collapse((el as HTMLElement).innerText ?? el.textContent), 120)
  }
  // Inside `el`, across open shadow roots.
  const inside = (node: Node | null, el: Element): boolean => {
    for (let n: Node | null = node; n; n = n.parentNode ?? (n instanceof ShadowRoot ? n.host : null)) if (n === el) return true
    return false
  }
  const textLines = (): string[] =>
    (document.body?.innerText ?? '')
      .slice(0, 200_000)
      .split('\n')
      // Digits are masked: a clock or a counter that ticks is not new text.
      .map((line) => line.replace(/\s+/g, ' ').replace(/\d/g, '0').trim())
      .filter(Boolean)
  const firstHeading = (): string => {
    for (const h of Array.from(document.querySelectorAll('h1'))) if (kit.visible(h)) return cut(collapse(h.textContent), 200)
    return ''
  }
  let start:
    | { url: string; x: number; y: number; active: Element | null; lines: string[]; nav: number; storage: number; ignored: number; layers: Set<Element>; title: string }
    | undefined
  w.__rampaActivate = {
    facts,
    noisy: (el) => inNoise(el),
    locate(args) {
      const el = kit.resolve(args.ref)
      w.__rampaTarget = el && kit.identity(el).sig === args.sig ? el : null
      return w.__rampaTarget !== null
    },
    target: () => w.__rampaTarget ?? null,
    aim(args) {
      const target = w.__rampaTarget
      if (!target?.isConnected) return { hidden: true }
      let el: Element = target
      if (args.el === 'label') {
        const label = Array.from((target as HTMLInputElement).labels ?? []).find((l) => kit.visible(l) && l.getBoundingClientRect().width > 0)
        if (!label) return { hidden: true }
        el = label
      }
      el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' as ScrollBehavior })
      const rect = Array.from(el.getClientRects()).find((r) => r.width >= 1 && r.height >= 1)
      if (!rect || !kit.visible(el)) return { hidden: true }
      const x = Math.min(Math.max(rect.left + rect.width / 2, 1), window.innerWidth - 1)
      const y = Math.min(Math.max(rect.top + rect.height / 2, 1), window.innerHeight - 1)
      let hit = document.elementFromPoint(x, y)
      while (hit?.shadowRoot) {
        const inner = hit.shadowRoot.elementFromPoint(x, y)
        if (!inner || inner === hit) break
        hit = inner
      }
      // On top: the control itself, something inside it (or inside its label), or an ancestor that lets it through.
      if (hit && (inside(hit, el) || inside(hit, target) || inside(el, hit))) return { x: Math.round(x), y: Math.round(y) }
      if (!hit) return { hidden: true }
      // Name the layer, not the leaf: the outermost fixed or sticky ancestor of what is on top.
      let layer: Element = hit
      for (let a: Element | null = hit; a && a !== document.body; a = a.parentElement) {
        const position = getComputedStyle(a).position
        if (position === 'fixed' || position === 'sticky') layer = a
      }
      return { cover: { ...kit.describe(layer), text: cut(collapse((layer as HTMLElement).innerText ?? layer.textContent), 120) } }
    },
    begin() {
      observer.takeRecords()
      records = []
      recording = true
      kit.drain()
      start = {
        url: location.href,
        x: window.scrollX,
        y: window.scrollY,
        active: kit.deepActive(),
        lines: textLines(),
        nav: w.__rampaNav?.length ?? 0,
        storage: w.__rampaStorage ?? 0,
        ignored: w.__rampaIgnored?.length ?? 0,
        layers: new Set(layers()),
        title: document.title,
      }
    },
    // Something happened since begin(): a mutation outside the noise, a navigation, or a hook event (window.open, submit…).
    peek() {
      records.push(...observer.takeRecords())
      const pending = (window as unknown as { __rampaEvents?: unknown[] }).__rampaEvents?.length ?? 0
      return records.filter((r) => !skipped(r.target) && !inNoise(r.target)).length + (w.__rampaNav?.length ?? 0) - (start?.nav ?? 0) + pending
    },
    // Resolves once no mutation outside the noise has happened for quietMs, at most capMs: a ticking clock or a
    // carousel the page runs on its own does not hold the window open.
    quiet(args) {
      return new Promise<number>((resolve) => {
        const begun = performance.now()
        let last = begun
        const watcher = new MutationObserver((list) => {
          if (list.some((r) => !skipped(r.target) && !inNoise(r.target))) last = performance.now()
        })
        watcher.observe(document, { subtree: true, childList: true, attributes: true, characterData: true })
        const tick = () => {
          const now = performance.now()
          if (now - last >= args.quietMs || now - begun >= args.capMs) {
            watcher.disconnect()
            resolve(Math.round(now - begun))
          } else setTimeout(tick, 50)
        }
        setTimeout(tick, 50)
      })
    },
    end(args) {
      records.push(...observer.takeRecords())
      recording = false
      const from = start ?? { url: location.href, x: window.scrollX, y: window.scrollY, active: null, lines: [], nav: 0, storage: 0, ignored: 0, layers: new Set<Element>(), title: document.title }
      let dom = 0
      let style = 0
      const samples: ChangeSample[] = []
      const sample = (el: Element | null, what: string) => {
        if (!el || samples.length >= 3 || el === document.documentElement) return
        const d = kit.describe(el)
        samples.push({ ref: d.ref, id: d.id, tag: d.tag, label: d.label, what })
      }
      for (const record of records) {
        const target = record.target
        if (skipped(target) || inNoise(target)) continue
        if (record.type === 'childList') {
          for (const node of [...Array.from(record.addedNodes), ...Array.from(record.removedNodes)]) {
            const meaningful = (node.nodeType === Node.ELEMENT_NODE && !SKIP.has((node as Element).localName)) || (node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() !== '')
            if (!meaningful) continue
            if (args.noise) {
              const parent = elementOf(target)
              noise.add(parent && parent !== document.body && parent !== document.documentElement ? target : node)
            }
            dom++
            sample(node.nodeType === Node.ELEMENT_NODE ? (node as Element) : elementOf(target), Array.from(record.addedNodes).includes(node) ? 'added' : 'removed')
          }
        } else if (record.type === 'characterData') {
          if ((target.textContent ?? '').trim() === '' && (record.oldValue ?? '').trim() === '') continue
          if (args.noise) noise.add(elementOf(target) ?? target)
          dom++
          sample(elementOf(target), 'text')
        } else if (record.type === 'attributes') {
          const name = record.attributeName ?? ''
          if (STATE.test(name)) {
            if (args.noise) noise.add(target)
            dom++
            sample(target as Element, name)
          } else if (name === 'class' || name === 'style') {
            if (args.noise) noise.add(target)
            style++
          }
        }
      }
      records = []
      const hooks = kit.drain()
      const active = kit.deepActive()
      const scroll = { x: window.scrollX - from.x, y: window.scrollY - from.y }
      // Lines of text that went or came, as a multiset: a list re-sorted in place changes nothing.
      const lines = textLines()
      const before = new Map<string, number>()
      for (const line of from.lines) before.set(line, (before.get(line) ?? 0) + 1)
      let changed = 0
      for (const line of lines) {
        const left = before.get(line) ?? 0
        if (left > 0) before.set(line, left - 1)
        else changed += line.length
      }
      for (const [line, left] of before) changed += line.length * left
      let opened: OpenedLayer | undefined
      if (!args.noise) {
        for (const layer of layers()) {
          if (from.layers.has(layer) || [...from.layers].some((old) => old.contains(layer))) continue
          const modal = layer.matches('dialog:modal, [aria-modal=true]')
          opened = { ...kit.describe(layer), name: layerName(layer), modal, cover: Math.round(coverOf(layer) * 100) / 100 }
          break
        }
      }
      const navigations = (w.__rampaNav ?? []).slice(from.nav)
      const moved = active !== from.active
      return {
        dom,
        style,
        samples,
        // Named as a person would hear it: a field by its label, which the kit's short label does not read.
        ...(moved && active ? { focus: { ...kit.describe(active), label: cut(nameOf(active), 80) || kit.describe(active).label } } : {}),
        ...(moved && !active && from.active ? { focusLost: true } : {}),
        ...(scroll.x !== 0 || scroll.y !== 0 ? { scroll } : {}),
        ...(location.href !== from.url
          ? { url: location.href, ...(location.href.replace(/#.*$/, '') === from.url.replace(/#.*$/, '') ? { hashOnly: true } : {}), title: cut(document.title, 200), heading: firstHeading() }
          : {}),
        navigations,
        windows: hooks.filter((h) => h.type === 'open').map((h) => {
          try {
            return new URL(h.detail ?? '', location.href).href
          } catch {
            return h.detail ?? ''
          }
        }),
        submits: hooks.filter((h) => h.type === 'submit').map((h) => h.detail ?? ''),
        dialogs: [],
        modals: hooks.filter((h) => h.type === 'modal').length,
        ...(opened ? { opened } : {}),
        text: { before: from.lines.reduce((sum, line) => sum + line.length, 0), changed },
        storage: (w.__rampaStorage ?? 0) - from.storage,
        ...((w.__rampaIgnored?.length ?? 0) > from.ignored ? { ignored: (w.__rampaIgnored ?? []).slice(from.ignored) } : {}),
      }
    },
  }
}

/** Runs in the page: from now on, navigations the page starts are recorded and, to another document, cancelled. */
export function armActivate(): void {
  ;(window as unknown as { __rampaArmed?: boolean }).__rampaArmed = true
}

export interface HarnessConfig {
  kind: ProbeRecord['kind']
  version: string
  variant: string
  limits: { controls: number; timeMs: number }
  /**
   * How each fresh page opens, beyond the harness's own hooks: Playwright's fake clock installed before the page loads
   * (the motion probe moves the page's time itself), init scripts of the probe's own, and context settings that win
   * over the run's (the gestures probe turns touch on).
   */
  page?: Pick<ProbePageOptions, 'clock' | 'viewport' | 'desktop' | 'beforeLoad' | 'context'> | undefined
  /**
   * In-page kits a probe adds to every page the harness opens, installed after the activate kit and before the wait
   * with no input, so they see that wait too (the pointer probe learns the page's own changes in it).
   */
  kits?: ReadonlyArray<() => void> | undefined
}

/** How long a window lasts at least after the input, and how long it may wait for a late navigation. */
const MIN_WINDOW_MS = 500
const LATE_NAVIGATION_MS = 1000
const WINDOW_SETTLE = { quietMs: 300, capMs: 2500 }
/** The wait with no input after each load, whose changes become noise. */
export const LEARN_MS = 600

/**
 * One activate-class probe on one page: the fresh pages it opens, its budget, its log, and the guard's log merged
 * across those pages on one clock.
 */
export class Harness {
  readonly started = Date.now()
  readonly actions: HarnessAction[] = []
  readonly guard: GuardLog = { blocked: [], navigations: [], dialogs: [] }
  readonly config: HarnessConfig
  loads = 0
  activated = 0
  private current: ProbePage | undefined
  private dirty = false
  private readonly intercepted: GuardLog['navigations'] = []
  private readonly browser: Browser
  private readonly url: string
  private readonly options: ProbeOptions
  /** The page's origin, for the skip list. */
  origin = ''

  constructor(browser: Browser, url: string, options: ProbeOptions, config: HarnessConfig) {
    this.browser = browser
    this.url = url
    this.options = options
    this.config = config
  }

  now(): number {
    return Date.now() - this.started
  }

  log(action: HarnessAction['action'], fields: Omit<HarnessAction, 'at' | 'action'> = {}): void {
    this.actions.push({ at: this.now(), action, ...Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined && value !== '')) })
  }

  /** Time is left in the budget. */
  timeLeft(): boolean {
    return this.now() < this.config.limits.timeMs
  }

  /** The page under test: the one open, or a fresh one when the last window changed it or `fresh` asks for one. */
  async page(fresh = false): Promise<ProbePage> {
    if (this.current && !this.dirty && !fresh) return this.current
    await this.closeCurrent()
    const own = this.config.page
    const probe = await openProbePage(this.browser, this.url, this.options, {
      ...(own?.clock ? { clock: true } : {}),
      ...(own?.viewport ? { viewport: own.viewport } : {}),
      ...(own?.desktop ? { desktop: true } : {}),
      ...(own?.context ? { context: own.context } : {}),
      variant: this.config.variant,
      beforeLoad: async (page, context) => {
        await page.addInitScript(installActivateHooks)
        await own?.beforeLoad?.(page, context)
      },
    })
    this.current = probe
    this.dirty = false
    this.loads++
    this.origin = await probe.page.evaluate(() => location.origin).catch(() => '')
    await probe.page.evaluate(installActivateKit)
    for (const kit of this.config.kits ?? []) await probe.page.evaluate(kit)
    await probe.page.evaluate(armActivate)
    this.log('load', { detail: this.loads === 1 ? probe.page.url() : `fresh page ${this.loads}` })
    // What the page changes on its own in a short wait becomes noise for the windows that follow.
    await this.window(probe, async () => undefined, { noise: true, ms: LEARN_MS })
    this.log('learn', { detail: `${LEARN_MS} ms with no input` })
    return probe
  }

  /**
   * Finds a control in the page by ref and identity, and reads the skip list again on what it found there, right
   * before the probe uses it: the facts a probe listed come from another load, and a ref and identity (tag, id, role,
   * type, name attribute, address) say nothing of its name, which may have changed since ("Save" then "Delete").
   * `check` is the probe's own decision (`skipReason` with its exceptions, as at listing; by default `skipReason`), or
   * false for what is not a control and was never on the list (a surface a gesture is made on). `own` reads the
   * element's own words, as the listing did for a draggable item. Logs the control when the page no longer has it, or
   * when the list now says to leave it, and answers false either way: the probe does not touch it.
   */
  async locate(probe: ProbePage, target: Pick<InPageElement, 'ref' | 'id' | 'label'>, options: { check?: SkipCheck | false; own?: boolean } = {}): Promise<boolean> {
    this.lastSkip = undefined
    const read = options.check !== false
    const found = await probe.page
      .evaluate(
        (args) => {
          const activate = (window as unknown as ActivateWindow).__rampaActivate
          if (!activate?.locate(args)) return null
          const el = activate.target()
          return { facts: el && args.read ? activate.facts(el, { own: args.own }) : null }
        },
        { ref: target.ref, sig: target.id.sig, read, own: options.own === true },
      )
      .catch(() => null)
    if (!found) {
      this.log('unmatched', { ref: target.ref, label: target.label })
      return false
    }
    if (!read) return true
    const check = options.check === undefined || options.check === false ? (facts: ControlFacts) => skipReason(facts, this.origin) : options.check
    // A control whose facts cannot be read is not used: what cannot be checked is not touched.
    const skip = found.facts ? check(found.facts) : { reason: 'unmatched', detail: 'its facts could not be read' }
    if (skip) {
      this.lastSkip = skip
      this.skip(target, skip.reason, `${skip.detail ? `${skip.detail}, ` : ''}read again on the page it was about to be used on`)
      return false
    }
    return true
  }

  /** Why the last `locate` left its control alone, when the skip list (read again) was the reason; reset by each call. */
  lastSkip: { reason: string; detail?: string | undefined } | undefined

  /**
   * Brings the located control (or its label) into view and checks that it is on top at its middle. A control under
   * another layer is not exercised, and the layer is named in the log.
   */
  async aim(probe: ProbePage, target: Pick<InPageElement, 'ref' | 'label'>, el: 'target' | 'label' = 'target'): Promise<{ x: number; y: number } | { cover: InPageElement & { text: string } } | { hidden: true }> {
    const aimed = await probe.page.evaluate((args) => (window as unknown as ActivateWindow).__rampaActivate?.aim(args) ?? { hidden: true as const }, { el }).catch(() => ({ hidden: true as const }))
    if ('cover' in aimed) this.log('not-exercised', { ref: target.ref, label: target.label, detail: `covered by <${aimed.cover.tag}> "${aimed.cover.text.slice(0, 60)}"` })
    return aimed
  }

  /**
   * One window: the watch starts, `act` runs (the input, or nothing), and the window lasts until the page is quiet
   * (at least 0.5 s, at most about 4 s), a little longer when nothing at all happened yet, in case a script navigates
   * late (an analytics callback before it leaves). With `noise`, what changed is learned as noise.
   */
  async window(probe: ProbePage, act: () => Promise<unknown>, options: { noise?: boolean; ms?: number; ref?: string; label?: string; blurred?: boolean } = {}): Promise<Watch> {
    const page = probe.page
    const from = Date.now()
    await page.evaluate(() => (window as unknown as ActivateWindow).__rampaActivate?.begin())
    await act()
    if (options.ms !== undefined) await page.waitForTimeout(options.ms)
    else {
      await page.waitForTimeout(MIN_WINDOW_MS)
      await page.evaluate((args) => (window as unknown as ActivateWindow).__rampaActivate?.quiet(args), WINDOW_SETTLE).catch(() => undefined)
      const quiet = await page.evaluate(() => (window as unknown as ActivateWindow).__rampaActivate?.peek() ?? 0).catch(() => 0)
      if (quiet === 0 && probe.guard.log.navigations.every((n) => n.at < from - probe.guard.start)) {
        const until = Date.now() + LATE_NAVIGATION_MS
        while (Date.now() < until) {
          await page.waitForTimeout(100)
          if ((await page.evaluate(() => (window as unknown as ActivateWindow).__rampaActivate?.peek() ?? 0).catch(() => 0)) > 0) break
        }
      }
    }
    const ended = await page.evaluate((args) => (window as unknown as ActivateWindow).__rampaActivate?.end(args), { noise: options.noise === true }).catch(() => undefined)
    const to = Date.now()
    const inWindow = (at: number) => at + probe.guard.start >= from && at + probe.guard.start <= to
    const guarded = probe.guard.log.navigations.filter((n) => inWindow(n.at))
    const watch: Watch = {
      dom: 0,
      style: 0,
      samples: [],
      navigations: [],
      windows: [],
      submits: [],
      dialogs: [],
      modals: 0,
      text: { before: 0, changed: 0 },
      storage: 0,
      ...ended,
      blocked: probe.guard.log.blocked.filter((b) => inWindow(b.at)).length,
      ms: to - from,
    }
    watch.navigations = [
      ...watch.navigations.map((n) => ({ ...n, at: n.at - this.started })),
      ...guarded.filter((n) => n.cause !== 'popup').map((n) => ({ url: n.url, type: 'guard', same: false, at: n.at + probe.guard.start - this.started, guard: true })),
    ]
    watch.windows = [...watch.windows, ...guarded.filter((n) => n.cause === 'popup').map((n) => n.url)]
    watch.dialogs = probe.guard.log.dialogs.filter((d) => inWindow(d.at)).map((d) => `${d.type}: ${d.message}`.slice(0, 200))
    if (!options.noise) {
      for (const n of watch.navigations) {
        this.log(n.download ? 'download' : 'navigation', { ref: options.ref, label: options.label, detail: `${n.guard ? 'answered by the guard' : n.same ? `${n.type} within the page` : `${n.type} intercepted`}: ${n.url}` })
        // Navigations stopped in the page join the guard's log, next to those it answered itself.
        if (!n.guard && !n.same) this.intercepted.push({ url: n.url.slice(0, 300), at: n.at, cause: n.download ? 'download intercepted' : 'intercepted' })
      }
      for (const url of watch.windows) this.log('window', { ref: options.ref, label: options.label, detail: url })
      for (const action of watch.submits) this.log('submit', { ref: options.ref, label: options.label, detail: `cancelled: ${action}` })
      for (const dialog of watch.dialogs) this.log('dialog', { ref: options.ref, label: options.label, detail: `dismissed: ${dialog}` })
      if (watch.opened) this.log('not-exercised', { ref: watch.opened.ref, label: watch.opened.name, detail: `opened by ${options.label ? `"${options.label}"` : 'the input'}; its controls are not exercised` })
      // With `blurred`, the probe took focus away itself (it left a field): focus back on the document is its own doing.
      if (changedPage(options.blurred ? { ...watch, focusLost: false } : watch)) this.dirty = true
    }
    return watch
  }

  /** Logs a skipped control. */
  skip(target: Pick<InPageElement, 'ref' | 'label'>, reason: string, detail?: string): void {
    this.log('skip', { ref: target.ref, label: target.label, detail: detail ? `${reason}: ${detail}` : reason })
  }

  private async closeCurrent(): Promise<void> {
    const probe = this.current
    if (!probe) return
    this.current = undefined
    // The guard's log of that page, on the harness's clock; intercepted navigations join it.
    const shift = probe.guard.start - this.started
    for (const entry of probe.guard.log.blocked) {
      this.guard.blocked.push({ ...entry, at: entry.at + shift })
      this.actions.push({ at: entry.at + shift, action: 'blocked', detail: `${entry.method} ${entry.url}` })
    }
    for (const entry of probe.guard.log.navigations) this.guard.navigations.push({ ...entry, at: entry.at + shift })
    for (const entry of probe.guard.log.dialogs) this.guard.dialogs.push({ ...entry, at: entry.at + shift })
    await probe.context.close().catch(() => undefined)
  }

  /** Closes the last page; the merged guard log then holds every page's. */
  async close(): Promise<void> {
    await this.closeCurrent()
    this.guard.navigations.push(...this.intercepted)
    this.intercepted.length = 0
    this.guard.navigations.sort((a, b) => a.at - b.at)
    this.guard.blocked.sort((a, b) => a.at - b.at)
    this.actions.sort((a, b) => a.at - b.at)
  }

  record(data: unknown, conditions: ProbeRecord['conditions'], reason?: string): ProbeRecord {
    return {
      kind: this.config.kind,
      version: this.config.version,
      conditions,
      status: reason ? 'partial' : 'complete',
      ...(reason ? { reason } : {}),
      guard: this.guard,
      durationMs: this.now(),
      data,
    }
  }
}
