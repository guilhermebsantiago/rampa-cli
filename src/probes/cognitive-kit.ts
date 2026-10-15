import type { InPageElement, InPageRect, Kit } from './kit.ts'

/**
 * The cognitive observation's helpers in the page (probes/cognitive.ts). `installCogaRecorder` is an init script: it
 * runs before any page script and records what the page does on its own (layout shifts, permission requests, media
 * that starts, dialogs and layers that appear, carousels that turn) into `window.__rampaCoga`. The other functions
 * read it, list running animations, or dispatch the clipboard events. Each runs through `quietEvaluate`, so the page
 * never gets user activation from Rampa. Playwright-style serialization: every function references nothing outside
 * its own body.
 *
 * Facts only: the thresholds that turn them into advisories live in src/advisory/checks/.
 */

export const COGNITIVE_VERSION = '1'
/** The load watched with the run's settings and `prefers-reduced-motion: no-preference`: interruptions, layout shifts, paste. */
export const OBSERVE_VARIANT = 'observe'
/** The same page loaded at the same time with `prefers-reduced-motion: reduce`: motion that keeps running. */
export const REDUCE_VARIANT = 'reduce'
/** The window after the load event, by default and with --fast. */
export const OBSERVE_MS = 8000
export const FAST_OBSERVE_MS = 3000
/** How often the recorder samples dialogs, layers, carousels and videos. */
export const SAMPLE_MS = 300
/** The dummy values the clipboard events carry: never a real secret, and easy to recognize. */
export const PASTE_VALUES = { password: 'Rampa-probe-7319', code: '73192846', email: 'rampa.teste@example.com', text: 'Rampa teste' }

/** An element the page showed: the kit's description while it is in the page; only its tag and text once it left. */
export type CogaElement = Partial<InPageElement> & { tag: string; label: string }

export interface CogaShift {
  /** Milliseconds from the start of navigation (performance.now()). */
  atMs: number
  /** The browser's layout-shift score of this one shift. */
  score: number
  /** hadRecentInput: a shift within 500 ms of input; Rampa gives none, so it is false unless something else did. */
  input: boolean
  sources: Array<{
    el: CogaElement
    /** Its box before and after, in the window's coordinates, as the browser reports them. */
    before: InPageRect
    after: InPageRect
    /** It is a link or a control, or holds one. */
    interactive: boolean
  }>
}

export interface CogaLayer {
  el: CogaElement
  /** role=dialog or alertdialog, an open <dialog>, or aria-modal="true". */
  dialog: boolean
  /** A modal dialog (:modal, or aria-modal="true"). */
  modal: boolean
  /** Its own position, or that of the fixed or sticky ancestor that keeps it on screen. */
  position: string
  firstMs: number
  lastMs: number
  samples: number
  /** The largest share of the window it covered, its box clipped to the window. */
  cover: number
  /** Page content lay under it at some point of the window it covered (it is on top of something, not the page itself). */
  coversContent: boolean
  /** Its visible text when first seen, cut to 160 characters. */
  text: string
  /** Characters of that text outside its links and buttons. */
  prose: number
  /** Its text, id or class names cookies or consent, or a consent platform. */
  consent: boolean
  /** A dialog inside a layer already listed: that layer's index. */
  within: number
  box: InPageRect
}

export interface CogaPermission {
  /** notifications, geolocation, camera, microphone, camera-microphone, clipboard-read */
  api: string
  atMs: number
  /** navigator.userActivation.hasBeenActive when the page asked: null when the browser does not say. */
  activated: boolean | null
}

export interface CogaPlay {
  el: CogaElement
  tag: string
  src: string
  atMs: number
  muted: boolean
  volume: number
  autoplay: boolean
  /** play(): a script called it; autoplay: the attribute started it, or would have. */
  how: 'play' | 'autoplay'
  /** playing; blocked by the browser's autoplay policy (NotAllowedError, or an autoplay element still paused with data); other. */
  outcome: 'playing' | 'blocked' | 'pending' | 'other'
  /** The browser decoded sound from it (webkitAudioDecodedByteCount): null when it did not play. */
  audible: boolean | null
  activated: boolean | null
  /** The element was in the page (an `Audio()` made by a script is not). */
  attached: boolean
}

export interface CogaCarousel {
  el: CogaElement
  box: InPageRect
  slides: number
  /** When the slides showing changed, in milliseconds from the start of navigation. */
  changes: number[]
  samples: number
}

export interface CogaVideo {
  el: CogaElement
  box: InPageRect
  visible: boolean
  src: string
  autoplay: boolean
  loop: boolean
  muted: boolean
  controls: boolean
  /** -1: a live stream; 0: unknown. */
  durationMs: number
  /** When the recorder saw it playing, first and last; null: never. */
  playing: { firstMs: number; lastMs: number; samples: number } | null
  /** Index of the carousel it sits in, or -1. */
  carousel: number
}

export interface CogaAnimation {
  el: CogaElement
  box: InPageRect
  visible: boolean
  /** css-animation, css-transition, script (Web Animations), smil (SVG). */
  kind: string
  /** The CSS animation name, the property a transition changes, or the script animation's id. */
  name: string
  /** What the keyframes change: transform, opacity, backgroundColor… */
  properties: string[]
  infinite: boolean
  /** -1 when infinite. */
  iterations: number
  /** One cycle, in milliseconds. */
  durationMs: number
  /** When it ends from its start (delay, cycles, end delay); -1 when infinite. */
  endMs: number
  /** Only colors change: no movement, no change of opacity or size. */
  colorOnly: boolean
  /** Index of the nearest animated ancestor in the same list, or -1. */
  ancestor: number
  /** Index of the carousel it sits in, or -1. */
  carousel: number
}

export interface CogaImage {
  el: CogaElement
  box: InPageRect
  src: string
  /** image/gif, image/png (APNG) or image/webp when its bytes hold more than one frame. */
  format?: string | undefined
  /** null: its bytes could not be read (reason). */
  animated: boolean | null
  /** How many times it plays: -1 with no end, null when unknown. */
  loops: number | null
  reason?: string | undefined
}

export interface CogaField {
  el: CogaElement
  kind: 'password' | 'code' | 'email' | 'text'
  type: string
  autocomplete: string
  label: string
  /** An onpaste attribute in the markup. */
  onpaste: boolean
  /** A synthetic paste event carrying a dummy value: cancelled by the page, and whether any field of its group changed after it (a handler that inserts the value itself). */
  paste: { prevented: boolean; changed: boolean; readClipboard: boolean }
  /** The same through a beforeinput event of type insertFromPaste; null when the browser would not build it. */
  beforeinput: { prevented: boolean; changed: boolean } | null
  /** A synthetic copy event: cancelled, and whether a handler put something in its place. Null on password fields, which browsers never copy from. */
  copy: { prevented: boolean; data: boolean } | null
}

export interface CogaText {
  /** The longest block of text in the main content: where copy and the context menu were tried. */
  el: CogaElement
  chars: number
  copy: { prevented: boolean; data: boolean }
  contextmenu: { prevented: boolean }
  /** Characters of the page's text blocks, those that cannot be selected (user-select: none on them or an ancestor), and the outermost element that sets it. */
  userSelect: { chars: number; none: number; by?: CogaElement | undefined }
}

export interface CogaClipboard {
  fields: CogaField[]
  text?: CogaText | undefined
  /** What the page said in alert boxes while the events were dispatched ("Pasting is not allowed"). */
  alerts?: string[] | undefined
}

export interface CogaData {
  /** The window after the load event, in milliseconds. */
  windowMs: number
  /** Milliseconds from the start of navigation: the load event, the end of the window, the recorder's first sample. */
  loadMs: number
  endMs: number
  firstSampleMs: number
  sampleMs: number
  samples: number
  viewport: { width: number; height: number }
  /** When the page first had user activation, or -1: never while it was watched. */
  activatedMs: number
  animations: { firstMs: number; first: CogaAnimation[]; lastMs: number; last: CogaAnimation[] }
  videos: CogaVideo[]
  images: CogaImage[]
  carousels: CogaCarousel[]
  layers: CogaLayer[]
  permissions: CogaPermission[]
  plays: CogaPlay[]
  shifts: CogaShift[]
  /** alert, confirm and prompt boxes the page opened, which the guard dismissed. */
  alerts: Array<{ type: string; atMs: number; message: string }>
  /** New windows the page tried to open (window.open, or a link that opens one). */
  windows: Array<{ url: string; atMs: number }>
  /** The observe load only: the clipboard events tried at the end. */
  clipboard?: CogaClipboard | undefined
}

/** What the recorder keeps in the page between reads. */
interface Recorder {
  nodes: Element[]
  shifts: Array<{ atMs: number; score: number; input: boolean; sources: Array<{ node: number; tag: string; text: string; before: InPageRect; after: InPageRect; interactive: boolean }> }>
  permissions: CogaPermission[]
  plays: Array<Omit<CogaPlay, 'el' | 'audible'> & { node: number; text: string }>
  layers: Array<Omit<CogaLayer, 'el' | 'within' | 'box'> & { node: number; box: InPageRect }>
  carousels: Array<{ node: number; slides: number; last: string; changes: number[]; samples: number; box: InPageRect }>
  videos: Array<{ node: number; firstMs: number; lastMs: number; samples: number }>
  firstSampleMs: number
  activatedMs: number
  samples: number
  stopped: boolean
  /** The clipboard trial is running: a read of the clipboard then is the page's paste handler, not a request on load. */
  trial: boolean
  clipboardReads: number
}

/** Installs `window.__rampaCoga` and its observers; an init script, so it runs before the page's own scripts. */
export function installCogaRecorder(): void {
  const w = window as unknown as { __rampaCoga?: Recorder }
  if (w.__rampaCoga) return
  const clock = performance.now.bind(performance)
  const now = () => Math.round(clock())
  const later = window.setTimeout.bind(window)
  const styleOf = window.getComputedStyle.bind(window)
  const activation = (navigator as unknown as { userActivation?: { hasBeenActive: boolean } }).userActivation
  const activated = (): boolean | null => (activation ? activation.hasBeenActive : null)
  const rec: Recorder = {
    nodes: [],
    shifts: [],
    permissions: [],
    plays: [],
    layers: [],
    carousels: [],
    videos: [],
    firstSampleMs: -1,
    activatedMs: -1,
    samples: 0,
    stopped: false,
    trial: false,
    clipboardReads: 0,
  }
  w.__rampaCoga = rec
  const indexes = new Map<Element, number>()
  const nodeIndex = (el: Element): number => {
    const known = indexes.get(el)
    if (known !== undefined) return known
    if (rec.nodes.length >= 3000) return -1
    rec.nodes.push(el)
    indexes.set(el, rec.nodes.length - 1)
    return rec.nodes.length - 1
  }
  const collapse = (value: string | null | undefined): string => (value ?? '').replace(/\s+/g, ' ').trim()
  const cut = (value: string, n: number): string => (value.length > n ? `${value.slice(0, n - 1)}…` : value)
  const rectOf = (r: { x: number; y: number; width: number; height: number } | null | undefined): InPageRect =>
    r ? { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) } : { x: 0, y: 0, width: 0, height: 0 }
  const CONTROL =
    'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="switch"], [role="menuitem"], [role="tab"], [role="option"], [contenteditable=""], [contenteditable="true"]'
  const interactive = (el: Element): boolean => {
    try {
      return el.matches(CONTROL) || el.querySelector(CONTROL) !== null
    } catch {
      return false
    }
  }
  const textOf = (el: Element): string => collapse((el as HTMLElement).innerText ?? el.textContent)

  // Layout shifts, from the start of the document (buffered).
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (rec.shifts.length >= 300) return
        const shift = entry as unknown as {
          startTime: number
          value: number
          hadRecentInput: boolean
          sources?: Array<{ node: Node | null; previousRect: DOMRectReadOnly; currentRect: DOMRectReadOnly }>
        }
        rec.shifts.push({
          atMs: Math.round(shift.startTime),
          score: Math.round(shift.value * 10000) / 10000,
          input: Boolean(shift.hadRecentInput),
          sources: (shift.sources ?? []).slice(0, 5).map((source) => {
            const node = source.node
            const el = node ? (node.nodeType === 1 ? (node as Element) : node.parentElement) : null
            return {
              node: el ? nodeIndex(el) : -1,
              tag: el?.localName ?? '',
              text: el ? cut(textOf(el), 80) : '',
              before: rectOf(source.previousRect),
              after: rectOf(source.currentRect),
              interactive: el ? interactive(el) : false,
            }
          }),
        })
      }
    })
    observer.observe({ type: 'layout-shift', buffered: true } as PerformanceObserverInit)
  } catch {
    // A browser without layout-shift entries records none.
  }

  // Permission requests: recorded, never granted. Each is answered as when a person closes the prompt.
  const asked = (api: string) => {
    if (rec.permissions.length < 50) rec.permissions.push({ api, atMs: now(), activated: activated() })
  }
  try {
    const N = (window as unknown as { Notification?: { requestPermission?: unknown } }).Notification
    if (N && typeof N.requestPermission === 'function') {
      N.requestPermission = (callback?: (permission: string) => void) => {
        asked('notifications')
        if (typeof callback === 'function') later(() => callback('default'), 0)
        return Promise.resolve('default')
      }
    }
  } catch {
    // Read-only in this browser.
  }
  try {
    const geo = navigator.geolocation
    if (geo) {
      const deny = (error: unknown) => {
        if (typeof error === 'function') later(() => (error as (e: unknown) => void)({ code: 1, message: 'User denied Geolocation', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 }), 0)
      }
      Object.defineProperty(geo, 'getCurrentPosition', {
        configurable: true,
        value: (_ok: unknown, error?: unknown) => {
          asked('geolocation')
          deny(error)
        },
      })
      Object.defineProperty(geo, 'watchPosition', {
        configurable: true,
        value: (_ok: unknown, error?: unknown) => {
          asked('geolocation')
          deny(error)
          return 0
        },
      })
    }
  } catch {
    // Read-only in this browser.
  }
  const mediaApi = (constraints: unknown): string => {
    const c = (constraints ?? {}) as { audio?: unknown; video?: unknown }
    return c.video && c.audio ? 'camera-microphone' : c.video ? 'camera' : 'microphone'
  }
  try {
    const devices = navigator.mediaDevices
    if (devices && typeof devices.getUserMedia === 'function') {
      Object.defineProperty(devices, 'getUserMedia', {
        configurable: true,
        value: (constraints?: unknown) => {
          asked(mediaApi(constraints))
          return Promise.reject(new DOMException('Permission denied', 'NotAllowedError'))
        },
      })
    }
    for (const legacy of ['getUserMedia', 'webkitGetUserMedia']) {
      if (typeof (navigator as unknown as Record<string, unknown>)[legacy] === 'function') {
        Object.defineProperty(navigator, legacy, {
          configurable: true,
          value: (constraints: unknown, _ok: unknown, error: unknown) => {
            asked(mediaApi(constraints))
            if (typeof error === 'function') later(() => (error as (e: unknown) => void)(new DOMException('Permission denied', 'NotAllowedError')), 0)
          },
        })
      }
    }
  } catch {
    // Read-only in this browser.
  }
  try {
    const board = navigator.clipboard as unknown as Record<string, unknown> | undefined
    if (board) {
      for (const method of ['readText', 'read']) {
        if (typeof board[method] !== 'function') continue
        Object.defineProperty(board, method, {
          configurable: true,
          value: () => {
            if (rec.trial) rec.clipboardReads++
            else asked('clipboard-read')
            return Promise.reject(new DOMException('Read permission denied.', 'NotAllowedError'))
          },
        })
      }
    }
  } catch {
    // Read-only in this browser.
  }

  // Media that starts, or tries to: a script's play(), or the autoplay attribute.
  const playOf = (el: HTMLMediaElement, how: 'play' | 'autoplay') => {
    const node = nodeIndex(el)
    const muted = el.muted || el.volume === 0
    const known = rec.plays.find((play) => play.node === node && play.node >= 0 && play.muted === muted)
    if (known) return known
    const play = {
      node,
      text: cut(collapse(el.getAttribute('aria-label') ?? el.getAttribute('title')), 80),
      tag: el.localName || (el instanceof HTMLAudioElement ? 'audio' : 'video'),
      src: cut(el.currentSrc || el.src || el.querySelector('source')?.getAttribute('src') || '', 300),
      atMs: now(),
      muted,
      volume: Math.round(el.volume * 100) / 100,
      autoplay: el.autoplay,
      how,
      outcome: 'pending' as CogaPlay['outcome'],
      activated: activated(),
      attached: el.isConnected,
    }
    if (rec.plays.length < 40) rec.plays.push(play)
    return play
  }
  try {
    const play = HTMLMediaElement.prototype.play
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      const entry = playOf(this, 'play')
      const started = play.call(this)
      if (started && typeof started.then === 'function') {
        started.then(
          () => {
            entry.outcome = 'playing'
          },
          (error: unknown) => {
            entry.outcome = (error as { name?: string } | null)?.name === 'NotAllowedError' ? 'blocked' : 'other'
          },
        )
      }
      return started
    }
  } catch {
    // Read-only in this browser.
  }
  document.addEventListener(
    'playing',
    (event) => {
      const target = event.target
      if (target instanceof HTMLMediaElement) playOf(target, target.autoplay ? 'autoplay' : 'play').outcome = 'playing'
    },
    true,
  )

  // The sampler: dialogs, layers on top of the page, carousels and videos, every SAMPLE_MS from DOMContentLoaded.
  const COLS = 12
  const ROWS = 8
  const DIALOGS = 'dialog[open], [role="dialog"], [role="alertdialog"], [aria-modal="true"]'
  const FLOATING =
    '[role="alert"], [role="status"], [aria-live="assertive"], [aria-live="polite"], [class*="toast" i], [class*="snackbar" i], [class*="popup" i], [id*="popup" i], [class*="modal" i], [id*="modal" i], [class*="newsletter" i], [class*="cookie" i], [id*="cookie" i], [class*="consent" i], [id*="consent" i], [class*="banner" i]'
  const CAROUSELS =
    '[aria-roledescription*="carousel" i], .carousel, .swiper, .swiper-container, .slick-slider, .splide, .glide, .owl-carousel, .flickity-enabled, .keen-slider, .embla, [class*="carousel" i], [class*="slider" i]:not(input), [class*="slideshow" i]'
  const SLIDES =
    '[aria-roledescription*="slide" i], .swiper-slide, .slick-slide, .splide__slide, .glide__slide, .carousel-item, .owl-item, .flickity-cell, .keen-slider__slide, .embla__slide, [class*="slide" i]'
  const CONSENT = /\bcookies?\b|\bconsent|consentimento|\blgpd\b|\bgdpr\b/i
  const CONSENT_IDS = /onetrust|cookiebot|didomi|usercentrics|cookie|consent|truste|quantcast|osano|iubenda|termly|klaro|tarteaucitron|cookieyes|complianz|\bcmp\b/i
  const shown = (el: Element): boolean => {
    if (typeof el.checkVisibility === 'function' && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true } as CheckVisibilityOptions)) return false
    const r = el.getBoundingClientRect()
    return r.width >= 2 && r.height >= 2
  }
  const parentOf = (el: Element): Element | null => {
    if (el.parentElement) return el.parentElement
    const root = el.getRootNode()
    return root instanceof ShadowRoot ? root.host : null
  }
  const layerOf = (el: Element, positions: Map<Element, string>): { el: Element; position: string } | null => {
    let current: Element | null = el
    for (let depth = 0; current && depth < 40; depth++, current = parentOf(current)) {
      if (current === document.body || current === document.documentElement) return null
      let position = positions.get(current)
      if (position === undefined) {
        position = styleOf(current).position
        positions.set(current, position)
      }
      if (position === 'fixed' || position === 'sticky') return { el: current, position }
    }
    return null
  }
  const proseOf = (el: Element, text: string): number => {
    let controls = 0
    for (const control of Array.from(el.querySelectorAll('a[href], button, [role="button"], input, select, textarea')).slice(0, 50)) controls += textOf(control).length
    return Math.max(0, text.length - controls)
  }
  const consentOf = (el: Element, text: string): boolean => {
    if (CONSENT.test(text)) return true
    let current: Element | null = el
    for (let depth = 0; current && depth < 3; depth++, current = parentOf(current)) {
      if (CONSENT_IDS.test(`${current.id} ${typeof current.className === 'string' ? current.className : ''}`)) return true
    }
    return false
  }
  const remember = (el: Element, position: string, dialog: boolean, cover: number, covers: boolean, t: number, first: boolean) => {
    const node = nodeIndex(el)
    if (node < 0) return
    const box = rectOf(el.getBoundingClientRect())
    let layer = rec.layers.find((entry) => entry.node === node)
    if (!layer) {
      if (rec.layers.length >= 60) return
      const text = cut(textOf(el), 160)
      let modal = false
      try {
        modal = el.matches(':modal') || el.getAttribute('aria-modal') === 'true'
      } catch {
        modal = el.getAttribute('aria-modal') === 'true'
      }
      layer = { node, dialog, modal, position, firstMs: t, lastMs: t, samples: 0, cover: 0, coversContent: false, text, prose: proseOf(el, text), consent: consentOf(el, text), box }
      rec.layers.push(layer)
    }
    if (layer.lastMs !== t || layer.samples === 0) layer.samples++
    layer.lastMs = t
    layer.cover = Math.max(layer.cover, Math.round(cover * 1000) / 1000)
    layer.coversContent ||= covers
    if (first) layer.box = box
  }
  const coverOf = (el: Element): number => {
    const r = el.getBoundingClientRect()
    const vw = window.innerWidth || 1
    const vh = window.innerHeight || 1
    const width = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0))
    const height = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0))
    return (width * height) / (vw * vh)
  }
  /** Something of the page lies under the layer at (x, y): an element neither inside it nor one of its ancestors. */
  const coversAt = (layer: Element, x: number, y: number): boolean => {
    for (const under of document.elementsFromPoint(x, y)) {
      if (under === layer || layer.contains(under) || under.contains(layer)) continue
      if (under === document.body || under === document.documentElement) continue
      return true
    }
    return false
  }
  const slidesOf = (carousel: Element): Element[] => {
    const byParent = new Map<Element, Element[]>()
    for (const slide of Array.from(carousel.querySelectorAll(SLIDES)).slice(0, 200)) {
      const parent = slide.parentElement
      if (!parent || !carousel.contains(parent)) continue
      const list = byParent.get(parent) ?? []
      list.push(slide)
      byParent.set(parent, list)
    }
    let best: Element[] = []
    for (const list of byParent.values()) if (list.length > best.length) best = list
    return best.length >= 2 ? best : []
  }
  const signatureOf = (carousel: Element, slides: Element[]): string => {
    const frame = carousel.getBoundingClientRect()
    if (slides.length > 0) {
      const showing: number[] = []
      slides.forEach((slide, i) => {
        if (typeof slide.checkVisibility === 'function' && !slide.checkVisibility({ opacityProperty: true, visibilityProperty: true } as CheckVisibilityOptions)) return
        const r = slide.getBoundingClientRect()
        const area = r.width * r.height
        if (area <= 0) return
        const width = Math.max(0, Math.min(r.right, frame.right) - Math.max(r.left, frame.left))
        const height = Math.max(0, Math.min(r.bottom, frame.bottom) - Math.max(r.top, frame.top))
        if (width * height >= area / 2) showing.push(i)
      })
      return showing.join(',')
    }
    // No slides to read: the first moved track, and how far the carousel is scrolled.
    for (const child of Array.from(carousel.querySelectorAll('*')).slice(0, 60)) {
      const transform = styleOf(child).transform
      if (transform && transform !== 'none') return `${transform}|${Math.round(carousel.scrollLeft)}`
    }
    return carousel.scrollLeft > 0 ? `|${Math.round(carousel.scrollLeft)}` : ''
  }
  let carouselEls: Array<{ el: Element; slides: Element[] }> = []
  const findCarousels = () => {
    const found: Element[] = []
    for (const el of Array.from(document.querySelectorAll(CAROUSELS)).slice(0, 200)) {
      if (found.some((outer) => outer.contains(el))) continue
      const r = el.getBoundingClientRect()
      if (r.width < 200 || r.height < 80 || !shown(el)) continue
      found.push(el)
      if (found.length >= 6) break
    }
    carouselEls = found.map((el) => ({ el, slides: slidesOf(el) }))
  }

  const sample = () => {
    const t = now()
    const first = rec.samples === 0
    if (rec.activatedMs < 0 && activated()) rec.activatedMs = t
    const vw = window.innerWidth
    const vh = window.innerHeight
    const positions = new Map<Element, string>()
    // Dialogs, wherever they sit.
    for (const el of Array.from(document.querySelectorAll(DIALOGS)).slice(0, 20)) {
      if (!shown(el)) continue
      const holder = layerOf(el, positions)
      let modal = false
      try {
        modal = el.matches(':modal')
      } catch {
        modal = false
      }
      const r = el.getBoundingClientRect()
      const covers = r.width > 0 && r.height > 0 ? coversAt(el, Math.min(vw - 1, Math.max(0, r.left + r.width / 2)), Math.min(vh - 1, Math.max(0, r.top + r.height / 2))) : false
      remember(el, holder?.position ?? styleOf(el).position, true, coverOf(el), covers || modal, t, first)
    }
    // What is on top of the page, on a grid over the window: fixed and sticky layers.
    const hits = new Map<Element, { position: string; points: Array<[number, number]> }>()
    for (let i = 0; i < COLS; i++) {
      for (let j = 0; j < ROWS; j++) {
        const x = ((i + 0.5) * vw) / COLS
        const y = ((j + 0.5) * vh) / ROWS
        const top = document.elementFromPoint(x, y)
        if (!top) continue
        const layer = layerOf(top, positions)
        if (!layer) continue
        const entry = hits.get(layer.el) ?? { position: layer.position, points: [] }
        entry.points.push([x, y])
        hits.set(layer.el, entry)
      }
    }
    for (const [el, entry] of hits) {
      const covers = entry.points.slice(0, 6).some(([x, y]) => coversAt(el, x, y))
      remember(el, entry.position, el.matches(DIALOGS), coverOf(el), covers, t, first)
    }
    // Small floating messages the grid may miss: live regions, toasts, banners.
    for (const el of Array.from(document.querySelectorAll(FLOATING)).slice(0, 40)) {
      if (!shown(el) || textOf(el).length < 10) continue
      const layer = layerOf(el, positions)
      if (!layer || hits.has(layer.el)) continue
      const r = layer.el.getBoundingClientRect()
      if (r.bottom <= 0 || r.top >= vh || r.right <= 0 || r.left >= vw) continue
      remember(layer.el, layer.position, layer.el.matches(DIALOGS), coverOf(layer.el), false, t, first)
    }
    // Carousels: which slides show.
    if (rec.samples % 4 === 0) findCarousels()
    for (const { el, slides } of carouselEls) {
      const node = nodeIndex(el)
      if (node < 0) continue
      let entry = rec.carousels.find((c) => c.node === node)
      if (!entry) {
        entry = { node, slides: slides.length, last: '', changes: [], samples: 0, box: rectOf(el.getBoundingClientRect()) }
        rec.carousels.push(entry)
      }
      const signature = signatureOf(el, slides)
      if (signature !== '' && entry.last !== '' && signature !== entry.last && entry.changes.length < 50) entry.changes.push(t)
      if (signature !== '') entry.last = signature
      entry.samples++
    }
    // Videos playing.
    for (const video of Array.from(document.querySelectorAll('video')).slice(0, 20)) {
      if (video.paused || video.ended || video.readyState < 3) continue
      const node = nodeIndex(video)
      if (node < 0) continue
      const entry = rec.videos.find((v) => v.node === node)
      if (entry) {
        entry.lastMs = t
        entry.samples++
      } else rec.videos.push({ node, firstMs: t, lastMs: t, samples: 1 })
    }
  }
  const tick = () => {
    if (rec.stopped) return
    try {
      sample()
    } catch {
      // A page in the middle of changing: the next sample reads it.
    }
    rec.samples++
    if (rec.samples < 600) later(tick, 300)
  }
  const start = () => {
    if (rec.firstSampleMs >= 0) return
    rec.firstSampleMs = now()
    tick()
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true })
  else start()
}

/** The running animations: CSS animations and transitions, script animations and SVG (SMIL) animations, by element and name. */
export function cogaAnimations(): { atMs: number; items: CogaAnimation[] } {
  const kit = (window as unknown as { __rampaKit: Kit }).__rampaKit
  const coga = (window as unknown as { __rampaCoga?: { nodes: Element[]; carousels: Array<{ node: number }> } }).__rampaCoga
  const carousels = (coga?.carousels ?? []).map((c) => coga?.nodes[c.node]).filter((el): el is Element => Boolean(el))
  const COLOR = new Set([
    'color', 'backgroundColor', 'borderColor', 'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor', 'outlineColor', 'fill', 'stroke',
    'boxShadow', 'textShadow', 'caretColor', 'textDecorationColor', 'accentColor', 'stopColor', 'floodColor', 'lightingColor', 'columnRuleColor',
  ])
  const box = (el: Element): InPageRect => {
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.left + window.scrollX), y: Math.round(r.top + window.scrollY), width: Math.round(r.width), height: Math.round(r.height) }
  }
  const items: CogaAnimation[] = []
  const targets: Element[] = []
  const byTarget = new Map<Element, Map<string, CogaAnimation>>()
  const add = (target: Element, fact: Omit<CogaAnimation, 'el' | 'box' | 'visible' | 'ancestor' | 'carousel'>) => {
    const own = byTarget.get(target) ?? new Map<string, CogaAnimation>()
    const known = own.get(`${fact.kind}|${fact.name}`)
    if (known) {
      known.infinite ||= fact.infinite
      known.endMs = known.infinite ? -1 : Math.max(known.endMs, fact.endMs)
      for (const p of fact.properties) if (!known.properties.includes(p) && known.properties.length < 8) known.properties.push(p)
      known.colorOnly &&= fact.colorOnly
      return
    }
    if (items.length >= 150) return
    const item: CogaAnimation = { ...fact, el: kit.describe(target), box: box(target), visible: kit.visible(target), ancestor: -1, carousel: carousels.findIndex((c) => c === target || c.contains(target)) }
    items.push(item)
    targets.push(target)
    own.set(`${fact.kind}|${fact.name}`, item)
    byTarget.set(target, own)
  }
  for (const animation of document.getAnimations()) {
    if (animation.playState !== 'running') continue
    const effect = animation.effect as KeyframeEffect | null
    const target = effect?.target
    if (!effect || !target) continue
    const timing = effect.getComputedTiming()
    const infinite = !Number.isFinite(Number(timing.activeDuration))
    const properties: string[] = []
    try {
      for (const frame of effect.getKeyframes()) {
        for (const key of Object.keys(frame)) if (!['offset', 'computedOffset', 'easing', 'composite'].includes(key) && !properties.includes(key)) properties.push(key)
      }
    } catch {
      // Keyframes the browser will not list.
    }
    const named = animation as unknown as { animationName?: string; transitionProperty?: string }
    const kind = typeof named.animationName === 'string' ? 'css-animation' : typeof named.transitionProperty === 'string' ? 'css-transition' : 'script'
    const iterations = Number(timing.iterations)
    add(target, {
      kind,
      name: (named.animationName ?? named.transitionProperty ?? animation.id) || '',
      properties: properties.slice(0, 8),
      infinite,
      iterations: Number.isFinite(iterations) ? iterations : -1,
      durationMs: Math.round(Number(timing.duration) || 0),
      endMs: infinite ? -1 : Math.round(Number(timing.endTime) || 0),
      colorOnly: properties.length > 0 && properties.every((p) => COLOR.has(p)),
    })
  }
  for (const svg of Array.from(document.querySelectorAll('svg')).slice(0, 100)) {
    const smil = Array.from(svg.querySelectorAll('animate, animateTransform, animateMotion, set'))
    if (smil.length === 0) continue
    const paused = (svg as unknown as { animationsPaused?: () => boolean }).animationsPaused?.() ?? false
    if (paused) continue
    let infinite = false
    let longest = 0
    const properties: string[] = []
    for (const a of smil) {
      if ((a.getAttribute('repeatCount') ?? '').trim() === 'indefinite' || (a.getAttribute('repeatDur') ?? '').trim() === 'indefinite') infinite = true
      const dur = (a.getAttribute('dur') ?? '').trim()
      const ms = /^([\d.]+)ms$/.test(dur) ? Number.parseFloat(dur) : /^([\d.]+)s?$/.test(dur) ? Number.parseFloat(dur) * 1000 : 0
      const repeat = Number.parseFloat(a.getAttribute('repeatCount') ?? '1') || 1
      longest = Math.max(longest, ms * repeat)
      const property = a.localName === 'animateTransform' ? 'transform' : a.localName === 'animateMotion' ? 'offset' : (a.getAttribute('attributeName') ?? '')
      if (property && !properties.includes(property)) properties.push(property)
    }
    add(svg, {
      kind: 'smil',
      name: smil[0]?.localName ?? 'animate',
      properties: properties.slice(0, 8),
      infinite,
      iterations: infinite ? -1 : 1,
      durationMs: Math.round(longest),
      endMs: infinite ? -1 : Math.round(longest),
      colorOnly: properties.length > 0 && properties.every((p) => ['fill', 'stroke', 'color', 'stop-color'].includes(p)),
    })
  }
  // The nearest animated ancestor, so a spinner of three rings is one thing that moves.
  for (const [i, target] of targets.entries()) {
    for (let parent = target.parentElement; parent; parent = parent.parentElement) {
      if (!byTarget.has(parent)) continue
      const index = targets.indexOf(parent)
      const item = items[i]
      if (item && index >= 0) item.ancestor = index
      break
    }
  }
  return { atMs: Math.round(performance.now()), items }
}

/** Everything the recorder kept, described for the record; stops the sampler. */
export function cogaRead(): {
  nowMs: number
  loadMs: number
  timeOrigin: number
  firstSampleMs: number
  samples: number
  activatedMs: number
  viewport: { width: number; height: number }
  layers: CogaLayer[]
  permissions: CogaPermission[]
  plays: CogaPlay[]
  shifts: CogaShift[]
  carousels: CogaCarousel[]
  videos: CogaVideo[]
  opened: Array<{ url: string; at: number }>
} {
  const kit = (window as unknown as { __rampaKit: Kit }).__rampaKit
  const rec = (window as unknown as { __rampaCoga: Recorder }).__rampaCoga
  rec.stopped = true
  const describe = (node: number, tag: string, label: string): CogaElement => {
    const el = node >= 0 ? rec.nodes[node] : undefined
    return el?.isConnected ? kit.describe(el) : { tag, label }
  }
  const box = (el: Element | undefined): InPageRect => {
    if (!el?.isConnected) return { x: 0, y: 0, width: 0, height: 0 }
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.left + window.scrollX), y: Math.round(r.top + window.scrollY), width: Math.round(r.width), height: Math.round(r.height) }
  }
  const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
  // Autoplay elements that never played though they had data: the browser's autoplay policy stopped them.
  for (const media of Array.from(document.querySelectorAll('audio, video')).slice(0, 40) as HTMLMediaElement[]) {
    if (!media.autoplay || media.muted || !media.paused) continue
    const node = rec.nodes.indexOf(media)
    if (node >= 0 && rec.plays.some((play) => play.node === node)) continue
    rec.plays.push({
      node: rec.nodes.push(media) - 1,
      text: '',
      tag: media.localName,
      src: (media.currentSrc || media.src || '').slice(0, 300),
      atMs: Math.round(nav?.loadEventEnd ?? 0),
      muted: false,
      volume: Math.round(media.volume * 100) / 100,
      autoplay: true,
      how: 'autoplay',
      outcome: media.readyState >= 2 && media.networkState !== 3 ? 'blocked' : 'other',
      activated: null,
      attached: true,
    })
  }
  const layers: CogaLayer[] = rec.layers.map((layer) => ({
    el: describe(layer.node, rec.nodes[layer.node]?.localName ?? '', layer.text.slice(0, 80)),
    dialog: layer.dialog,
    modal: layer.modal,
    position: layer.position,
    firstMs: layer.firstMs,
    lastMs: layer.lastMs,
    samples: layer.samples,
    cover: layer.cover,
    coversContent: layer.coversContent,
    text: layer.text,
    prose: layer.prose,
    consent: layer.consent,
    within: -1,
    box: layer.box,
  }))
  rec.layers.forEach((layer, i) => {
    const el = rec.nodes[layer.node]
    if (!el) return
    const holder = rec.layers.findIndex((other) => other !== layer && !other.dialog && rec.nodes[other.node]?.contains(el))
    const own = layers[i]
    if (own && holder >= 0) own.within = holder
  })
  const carousels = rec.carousels.map((c) => ({
    el: describe(c.node, rec.nodes[c.node]?.localName ?? '', ''),
    box: rec.nodes[c.node]?.isConnected ? box(rec.nodes[c.node]) : c.box,
    slides: c.slides,
    changes: c.changes,
    samples: c.samples,
  }))
  const carouselEls = rec.carousels.map((c) => rec.nodes[c.node])
  const videos: CogaVideo[] = (Array.from(document.querySelectorAll('video')).slice(0, 20) as HTMLVideoElement[]).map((video) => {
    const node = rec.nodes.indexOf(video)
    const seen = node >= 0 ? rec.videos.find((v) => v.node === node) : undefined
    const duration = video.duration
    return {
      el: kit.describe(video),
      box: box(video),
      visible: kit.visible(video),
      src: (video.currentSrc || video.src || '').slice(0, 300),
      autoplay: video.autoplay,
      loop: video.loop,
      muted: video.muted,
      controls: video.controls,
      durationMs: duration === Number.POSITIVE_INFINITY ? -1 : Number.isFinite(duration) ? Math.round(duration * 1000) : 0,
      playing: seen ? { firstMs: seen.firstMs, lastMs: seen.lastMs, samples: seen.samples } : null,
      carousel: carouselEls.findIndex((c) => c?.contains(video)),
    }
  })
  const plays: CogaPlay[] = rec.plays.map((play) => {
    const el = rec.nodes[play.node] as HTMLMediaElement | undefined
    const decoded = el ? (el as unknown as { webkitAudioDecodedByteCount?: number }).webkitAudioDecodedByteCount : undefined
    return {
      el: el?.isConnected ? kit.describe(el) : { tag: play.tag, label: play.text || (play.src.startsWith('data:') ? 'data:' : play.src.split(/[?#]/)[0]?.split('/').pop()) || '' },
      tag: play.tag,
      src: play.src,
      atMs: play.atMs,
      muted: play.muted,
      volume: play.volume,
      autoplay: play.autoplay,
      how: play.how,
      outcome: play.outcome,
      audible: play.outcome === 'playing' && typeof decoded === 'number' ? decoded > 0 : null,
      activated: play.activated,
      attached: play.attached,
    }
  })
  const shifts: CogaShift[] = rec.shifts.map((shift) => ({
    atMs: shift.atMs,
    score: shift.score,
    input: shift.input,
    sources: shift.sources.map((source) => ({ el: describe(source.node, source.tag, source.text), before: source.before, after: source.after, interactive: source.interactive })),
  }))
  const opened = kit
    .drain()
    .filter((event) => event.type === 'open')
    .map((event) => ({ url: event.detail ?? '', at: event.at }))
  return {
    nowMs: Math.round(performance.now()),
    loadMs: Math.round(nav?.loadEventEnd || 0),
    timeOrigin: performance.timeOrigin,
    firstSampleMs: rec.firstSampleMs,
    samples: rec.samples,
    activatedMs: rec.activatedMs,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    layers,
    permissions: rec.permissions,
    plays,
    shifts,
    carousels,
    videos,
    opened,
  }
}

/** Images on show that may animate (not JPEG, SVG, BMP or icons), to fetch again and read their frames. */
export function cogaImages(max: number): Array<{ el: InPageElement; box: InPageRect; src: string }> {
  const kit = (window as unknown as { __rampaKit: Kit }).__rampaKit
  const still = /\.(jpe?g|svg|bmp|ico)(\?|#|$)/i
  const out: Array<{ el: InPageElement; box: InPageRect; src: string }> = []
  for (const img of Array.from(document.images)) {
    if (out.length >= max) break
    const src = img.currentSrc || img.src
    if (!src || still.test(src) || src.startsWith('data:image/jpeg') || src.startsWith('data:image/svg')) continue
    if (!img.complete || img.naturalWidth < 2 || !kit.visible(img)) continue
    const r = img.getBoundingClientRect()
    if (r.width < 32 || r.height < 32) continue
    out.push({ el: kit.describe(img), box: { x: Math.round(r.left + window.scrollX), y: Math.round(r.top + window.scrollY), width: Math.round(r.width), height: Math.round(r.height) }, src: src.slice(0, 2000) })
  }
  return out
}

/**
 * The clipboard events, dispatched by Rampa itself on the page (nothing is typed, clicked or sent): a paste event and
 * a beforeinput of a paste on each text field, carrying a dummy value, and a copy event; then a copy event and a
 * context menu event on the longest block of text, and the share of text that `user-select: none` keeps from being
 * selected. Every field gets its value back.
 */
export async function cogaClipboard(arg: { max: number; password: string; code: string; email: string; text: string }): Promise<CogaClipboard> {
  const kit = (window as unknown as { __rampaKit: Kit }).__rampaKit
  const rec = (window as unknown as { __rampaCoga?: { trial: boolean; clipboardReads: number } }).__rampaCoga ?? { trial: false, clipboardReads: 0 }
  const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
  const collapse = (value: string | null | undefined): string => (value ?? '').replace(/\s+/g, ' ').trim()
  const TEXT_TYPES = new Set(['text', 'password', 'email', 'tel', 'number', 'search', 'url'])
  rec.trial = true
  const fields: CogaField[] = []
  const candidates = (Array.from(document.querySelectorAll('input, textarea')) as Array<HTMLInputElement | HTMLTextAreaElement>).filter((el) => {
    if (el instanceof HTMLInputElement && !TEXT_TYPES.has(el.type)) return false
    if (el.disabled || el.readOnly) return false
    const r = el.getBoundingClientRect()
    return r.width >= 4 && r.height >= 4 && kit.visible(el)
  })
  const kindOf = (el: HTMLInputElement | HTMLTextAreaElement): CogaField['kind'] => {
    const autocomplete = (el.getAttribute('autocomplete') ?? '').toLowerCase()
    const words = `${el.name} ${el.id} ${el.getAttribute('placeholder') ?? ''} ${el.getAttribute('aria-label') ?? ''}`.toLowerCase()
    if (el instanceof HTMLInputElement && el.type === 'password') return 'password'
    if (/current-password|new-password/.test(autocomplete)) return 'password'
    if (autocomplete.includes('one-time-code') || /\b(otp|token|pin|c[oó]digo|code|verification)\b/.test(words)) return 'code'
    if ((el instanceof HTMLInputElement && el.type === 'email') || autocomplete.includes('email') || /e-?mail/.test(words)) return 'email'
    return 'text'
  }
  const labelOf = (el: HTMLInputElement | HTMLTextAreaElement): string => {
    const labels = el.labels ? Array.from(el.labels).map((label) => collapse(label.innerText)).filter(Boolean) : []
    return (labels[0] || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.name || el.id || '').slice(0, 80)
  }
  const groupOf = (el: Element): Array<HTMLInputElement | HTMLTextAreaElement> => {
    const scope = el.closest('form') ?? el.parentElement?.parentElement?.parentElement ?? document.body
    return (Array.from(scope.querySelectorAll('input, textarea')) as Array<HTMLInputElement | HTMLTextAreaElement>).slice(0, 30)
  }
  for (const el of candidates.slice(0, arg.max)) {
    const kind = kindOf(el)
    const numeric = el instanceof HTMLInputElement && (el.type === 'number' || el.type === 'tel' || el.inputMode === 'numeric')
    const value = kind === 'password' ? arg.password : kind === 'code' || numeric ? arg.code : kind === 'email' ? arg.email : arg.text
    const group = groupOf(el)
    const values = () => group.map((field) => field.value)
    const before = values()
    const changed = () => values().some((v, i) => v !== before[i])
    const restore = () =>
      group.forEach((field, i) => {
        if (field.value !== before[i]) field.value = before[i] ?? ''
      })
    const reads = rec.clipboardReads
    const data = new DataTransfer()
    data.setData('text/plain', value)
    const paste = new ClipboardEvent('paste', { bubbles: true, cancelable: true, composed: true, clipboardData: data })
    el.dispatchEvent(paste)
    await pause(60)
    const pasteResult = { prevented: paste.defaultPrevented, changed: changed(), readClipboard: rec.clipboardReads > reads }
    restore()
    let beforeinput: CogaField['beforeinput'] = null
    try {
      const transfer = new DataTransfer()
      transfer.setData('text/plain', value)
      const event = new InputEvent('beforeinput', { bubbles: true, cancelable: true, composed: true, inputType: 'insertFromPaste', data: value, dataTransfer: transfer })
      el.dispatchEvent(event)
      await pause(60)
      beforeinput = { prevented: event.defaultPrevented, changed: changed() }
      restore()
    } catch {
      beforeinput = null
    }
    let copy: CogaField['copy'] = null
    if (kind !== 'password') {
      const transfer = new DataTransfer()
      const event = new ClipboardEvent('copy', { bubbles: true, cancelable: true, composed: true, clipboardData: transfer })
      el.dispatchEvent(event)
      copy = { prevented: event.defaultPrevented, data: transfer.types.length > 0 }
    }
    fields.push({
      el: kit.describe(el),
      kind,
      type: el instanceof HTMLInputElement ? el.type : 'textarea',
      autocomplete: (el.getAttribute('autocomplete') ?? '').slice(0, 60),
      label: labelOf(el),
      onpaste: el.hasAttribute('onpaste'),
      paste: pasteResult,
      beforeinput,
      copy,
    })
  }

  // The text: the longest block in the main content, and how much of the page's text cannot be selected.
  const BLOCKS = 'p, li, td, th, dd, dt, blockquote, figcaption, h1, h2, h3, h4, h5, h6, pre'
  const scope = document.querySelector('main, [role="main"], article') ?? document.body
  let longest: Element | undefined
  let longestChars = 0
  let chars = 0
  let none = 0
  let by: Element | undefined
  const own = new Map<Element, boolean>()
  const setsNone = (el: Element): boolean => {
    let value = own.get(el)
    if (value === undefined) {
      const style = getComputedStyle(el)
      value = (style.userSelect || (style as unknown as { webkitUserSelect?: string }).webkitUserSelect) === 'none'
      own.set(el, value)
    }
    return value
  }
  /** The outermost element, from the block up, whose user-select is none. */
  const selectNone = (el: Element): Element | undefined => {
    let found: Element | undefined
    for (let current: Element | null = el; current; current = current.parentElement) if (setsNone(current)) found = current
    return found
  }
  for (const block of Array.from(document.querySelectorAll(BLOCKS)).slice(0, 600)) {
    if (!kit.visible(block)) continue
    // A block inside another block counts once, with its parent.
    if (block.parentElement?.closest(BLOCKS)) continue
    const text = collapse((block as HTMLElement).innerText)
    if (text.length === 0) continue
    chars += text.length
    const setter = selectNone(block)
    if (setter) {
      none += text.length
      if (!by || setter.contains(by)) by = setter
    }
    if (scope.contains(block) && text.length > longestChars) {
      longest = block
      longestChars = text.length
    }
  }
  let text: CogaText | undefined
  if (longest) {
    const transfer = new DataTransfer()
    const copyEvent = new ClipboardEvent('copy', { bubbles: true, cancelable: true, composed: true, clipboardData: transfer })
    longest.dispatchEvent(copyEvent)
    const r = longest.getBoundingClientRect()
    const menu = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      composed: true,
      button: 2,
      buttons: 2,
      clientX: Math.max(0, Math.min(window.innerWidth - 1, r.left + Math.min(20, r.width / 2))),
      clientY: Math.max(0, Math.min(window.innerHeight - 1, r.top + Math.min(10, r.height / 2))),
    })
    longest.dispatchEvent(menu)
    text = {
      el: kit.describe(longest),
      chars: longestChars,
      copy: { prevented: copyEvent.defaultPrevented, data: transfer.types.length > 0 },
      contextmenu: { prevented: menu.defaultPrevented },
      userSelect: { chars, none, ...(by ? { by: kit.describe(by) } : {}) },
    }
  }
  rec.trial = false
  return { fields, ...(text ? { text } : {}) }
}

/** How many times an animated image plays, from its bytes: -1 with no end, or the count; null when the format does not say. */
export function imageLoops(bytes: Uint8Array, format: string): number | null {
  const ascii = (at: number, length: number) => String.fromCharCode(...bytes.subarray(at, at + length))
  const u16 = (at: number) => (bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8)
  const u32be = (at: number) => (((bytes[at] ?? 0) << 24) | ((bytes[at + 1] ?? 0) << 16) | ((bytes[at + 2] ?? 0) << 8) | (bytes[at + 3] ?? 0)) >>> 0
  if (format === 'image/gif') {
    // The NETSCAPE2.0 application extension holds the loop count; without it, a GIF plays once.
    for (let i = 0; i + 19 < bytes.length; i++) {
      if (bytes[i] === 0x21 && bytes[i + 1] === 0xff && bytes[i + 2] === 0x0b && (ascii(i + 3, 11) === 'NETSCAPE2.0' || ascii(i + 3, 11) === 'ANIMEXTS1.0')) {
        const loops = u16(i + 16)
        return loops === 0 ? -1 : loops + 1
      }
    }
    return 1
  }
  if (format === 'image/png') {
    for (let i = 8; i + 16 <= bytes.length; ) {
      const length = u32be(i)
      if (ascii(i + 4, 4) === 'acTL') {
        const plays = u32be(i + 12)
        return plays === 0 ? -1 : plays
      }
      i += 12 + length
    }
    return null
  }
  if (format === 'image/webp') {
    for (let i = 12; i + 14 <= Math.min(bytes.length, 8192); i++) {
      if (ascii(i, 4) === 'ANIM') {
        const loops = u16(i + 12)
        return loops === 0 ? -1 : loops
      }
    }
    return null
  }
  return null
}
