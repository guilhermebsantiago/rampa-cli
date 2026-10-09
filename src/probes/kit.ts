/**
 * In-page helpers every probe shares, installed once per probe page as `window.__rampaKit`.
 * Playwright serializes these functions with toString(), so each must not reference anything
 * outside its own body: no imports, no module-level helpers. Refs follow the collector's rule
 * (src/surfaces/in-page.ts), so a probe's facts point at the snapshot's nodes.
 */

export interface InPageRect {
  x: number
  y: number
  width: number
  height: number
}

/** Who an observation is about, checked against the snapshot node with the same ref (identity.ts). */
export interface InPageIdentity {
  tag: string
  /** tag|id|role|type|name|href, each attribute cut to 100 characters. */
  sig: string
}

export interface InPageElement {
  ref: string
  id: InPageIdentity
  tag: string
  role: string
  /** A short label for messages: aria-label, alt, title, or the text, cut to 80 characters. */
  label: string
  /** The element sits in an open shadow root: its ref cannot match the snapshot. */
  shadow?: boolean | undefined
}

export interface Kit {
  cssPath(el: Element): string
  identity(el: Element): InPageIdentity
  describe(el: Element): InPageElement
  visible(el: Element): boolean
  /** The focused element, through open shadow roots; same-origin frames report the frame element. */
  deepActive(): Element | null
  rect(el: Element): InPageRect
  /** Hook events since the last drain: window.open, submit, showModal, history, script focus. */
  drain(): Array<{ type: string; at: number; detail?: string | undefined; ref?: string | undefined }>
}

/** Installs `window.__rampaKit`; safe to call twice. */
export function installKit(): void {
  const w = window as unknown as { __rampaKit?: Kit; __rampaEvents?: Array<{ type: string; at: number; detail?: string; target?: Element | null }> }
  if (w.__rampaKit) return
  const escapeId = (value: string): string => CSS.escape(value)
  const hasUniqueId = (el: Element): boolean => {
    if (el.id === '') return false
    const root = el.getRootNode() as Document | ShadowRoot
    return root.querySelectorAll(`#${escapeId(el.id)}`).length === 1
  }
  const cssPath = (el: Element): string => {
    if (hasUniqueId(el) && el.getRootNode() === document) return `#${escapeId(el.id)}`
    const parts: string[] = []
    let current: Element | null = el
    while (current) {
      if (current !== el && hasUniqueId(current) && current.getRootNode() === document) {
        parts.unshift(`#${escapeId(current.id)}`)
        break
      }
      const parent: Element | null = current.parentElement
      const tag = current.localName
      if (!parent) {
        const root = current.getRootNode()
        if (root instanceof ShadowRoot) {
          // Not a CSS selector any more: the host's path, then the path inside its shadow root.
          return `${cssPath(root.host)} >>> ${[tag, ...parts].join(' > ')}`
        }
        parts.unshift(tag)
        break
      }
      const sameTag = Array.from(parent.children).filter((child) => child.localName === tag)
      parts.unshift(sameTag.length > 1 ? `${tag}:nth-of-type(${sameTag.indexOf(current) + 1})` : tag)
      current = parent
    }
    return parts.join(' > ')
  }
  const cut = (value: string | null): string => (value ?? '').slice(0, 100)
  const identity = (el: Element): InPageIdentity => ({
    tag: el.localName,
    sig: [el.localName, cut(el.getAttribute('id')), cut(el.getAttribute('role')), cut(el.getAttribute('type')), cut(el.getAttribute('name')), cut(el.getAttribute('href'))].join('|'),
  })
  const collapse = (value: string | null | undefined): string => (value ?? '').replace(/\s+/g, ' ').trim()
  const roleOf = (el: Element): string => {
    const explicit = collapse(el.getAttribute('role')).split(' ')[0]
    if (explicit) return explicit
    const tag = el.localName
    if (tag === 'a') return el.hasAttribute('href') ? 'link' : 'generic'
    if (tag === 'button' || tag === 'summary') return 'button'
    if (tag === 'select') return 'combobox'
    if (tag === 'textarea') return 'textbox'
    if (tag === 'input') {
      const type = (el.getAttribute('type') ?? 'text').toLowerCase()
      if (type === 'checkbox' || type === 'radio') return type
      if (['button', 'submit', 'reset', 'image'].includes(type)) return 'button'
      if (type === 'range') return 'slider'
      return 'textbox'
    }
    if (tag === 'iframe') return 'iframe'
    return 'generic'
  }
  const label = (el: Element): string => {
    const text =
      el.getAttribute('aria-label') ||
      el.getAttribute('alt') ||
      (el instanceof HTMLInputElement && ['button', 'submit', 'reset'].includes(el.type) ? el.value : '') ||
      collapse((el as HTMLElement).innerText ?? el.textContent) ||
      el.getAttribute('title') ||
      el.getAttribute('placeholder') ||
      el.getAttribute('name') ||
      ''
    const value = collapse(text)
    return value.length > 80 ? `${value.slice(0, 79)}…` : value
  }
  const describe = (el: Element): InPageElement => {
    const shadow = el.getRootNode() instanceof ShadowRoot
    return { ref: cssPath(el), id: identity(el), tag: el.localName, role: roleOf(el), label: label(el), ...(shadow ? { shadow: true } : {}) }
  }
  const visible = (el: Element): boolean =>
    typeof el.checkVisibility === 'function'
      ? el.checkVisibility({ visibilityProperty: true, opacityProperty: true, checkVisibilityCSS: true } as CheckVisibilityOptions)
      : true
  const deepActive = (): Element | null => {
    let active: Element | null = document.activeElement
    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement
    if (!active || active === document.body || active === document.documentElement) return null
    return active
  }
  const round = (value: number): number => Math.round(value * 10) / 10
  const rect = (el: Element): InPageRect => {
    const r = el.getBoundingClientRect()
    return { x: round(r.x), y: round(r.y), width: round(r.width), height: round(r.height) }
  }
  const drain = () => {
    const events = w.__rampaEvents ?? []
    w.__rampaEvents = []
    return events.map((event) => ({ type: event.type, at: event.at, detail: event.detail, ref: event.target ? cssPath(event.target) : undefined }))
  }
  w.__rampaKit = { cssPath, identity, describe, visible, deepActive, rect, drain }
}

/**
 * Hooks installed before any page script runs (context.addInitScript). They record what a
 * page does on its own, never stopping it except where the probe must stay read-only:
 * window.open returns null and form submission is cancelled.
 */
export function installHooks(): void {
  const w = window as unknown as { __rampaEvents?: Array<{ type: string; at: number; detail?: string; target?: Element | null }>; __rampaSelf?: boolean }
  if (w.__rampaEvents) return
  w.__rampaEvents = []
  const push = (type: string, detail?: string, target?: Element | null) => {
    if (w.__rampaSelf) return
    w.__rampaEvents?.push({ type, at: Date.now(), detail: detail?.slice(0, 300), target: target ?? null })
  }
  window.open = ((url?: string | URL) => {
    push('open', String(url ?? ''))
    return null
  }) as typeof window.open
  HTMLFormElement.prototype.submit = function (this: HTMLFormElement) {
    push('submit', this.action, this)
  }
  HTMLFormElement.prototype.requestSubmit = function (this: HTMLFormElement) {
    push('submit', this.action, this)
  }
  document.addEventListener(
    'submit',
    (event) => {
      push('submit', (event.target as HTMLFormElement | null)?.action, event.target as Element | null)
      event.preventDefault()
    },
    true,
  )
  const showModal = HTMLDialogElement.prototype.showModal
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    push('modal', undefined, this)
    return showModal.call(this)
  }
  for (const method of ['pushState', 'replaceState'] as const) {
    const original = history[method]
    history[method] = function (this: History, data: unknown, unused: string, url?: string | URL | null) {
      push('history', String(url ?? ''))
      return original.call(this, data, unused, url)
    }
  }
  const focus = HTMLElement.prototype.focus
  HTMLElement.prototype.focus = function (this: HTMLElement, options?: FocusOptions) {
    push('script-focus', undefined, this)
    return focus.call(this, options)
  }
  const blur = HTMLElement.prototype.blur
  HTMLElement.prototype.blur = function (this: HTMLElement) {
    push('script-blur', undefined, this)
    return blur.call(this)
  }
}

/**
 * Waits until the page has been quiet (no mutation, no layout shift) for `quietMs`, at most
 * `capMs`, with fonts loaded first. Returns how long it waited.
 */
export async function settleInPage(options: { quietMs: number; capMs: number }): Promise<number> {
  const start = performance.now()
  try {
    await Promise.race([document.fonts?.ready, new Promise((resolve) => setTimeout(resolve, options.capMs))])
  } catch {
    // Fonts that fail to load still let the page settle.
  }
  return new Promise<number>((resolve) => {
    let last = performance.now()
    const touch = () => {
      last = performance.now()
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
    const tick = () => {
      const now = performance.now()
      if (now - last >= options.quietMs || now - start >= options.capMs) {
        observer.disconnect()
        shifts?.disconnect()
        resolve(Math.round(now - start))
      } else setTimeout(tick, 50)
    }
    setTimeout(tick, 50)
  })
}
