import type { Browser, CDPSession, Page } from 'playwright-core'
import type { ProbeRecord } from '../snapshot/schema.ts'
import { type ControlFacts, Harness, type HarnessAction, skipReason } from './activate.ts'
import { type DeviceMotionData, type MotionListenerFact, motionListeners, runDeviceMotionProbe } from './device-motion.ts'
import { contextChanges } from './input.ts'
import type { InPageElement, InPageRect } from './kit.ts'
import { pauseClock } from './motion.ts'
import { type ProbeOptions, type ProbePage, skippedRecord } from './page.ts'
import { markPointerListeners } from './pointer.ts'
import { type Thumb, thumbDistance, thumbOf } from './variants.ts'

/**
 * Gestures and device motion (docs/plans/wcag-coverage.md, D2), on the activate-class harness (activate.ts):
 *
 * - 2.5.1 Pointer Gestures: the carousels, maps, image viewers and elements with touch or gesture listeners the pointer
 *   probe lists (C7) are swiped along a path and pinched with two fingers, as touch events sent over the DevTools
 *   protocol (Input.dispatchTouchEvent) on a page with touch enabled. The page's clock is Playwright's fake one, paused:
 *   an element that turns on its own (autoplay) is let turn first, so its next turn cannot fall in the gesture's window.
 *   What the element shows (the slide most in view, its text, a map's zoom from its tiles' addresses, transforms, a grey
 *   thumbnail) is read before and after. When a gesture changed it, the single-pointer controls around it that may do the
 *   same (next and previous, the dot after the current one, zoom in and out) are clicked, each on a fresh load, and what
 *   they did is compared with what the gesture did: the same move along the slides, the same zoom, the same result. A
 *   gesture that changed something with no such control around it is tried again on a second fresh load.
 * - 2.5.4 Motion Actuation (device-motion.ts): on a page with motion or orientation listeners, the device is shaken and
 *   tilted through the browser's virtual sensors (or synthetic events), and what it did is searched for among the page's
 *   controls, with a switch that turns motion off.
 *
 * Facts, never verdicts: the rules (src/rules/gestures.ts) decide. The guard is on all along, and the skip list applies
 * to every control clicked.
 */

export const GESTURES_VERSION = '1'
export const GESTURES_VARIANT = 'gestures'
export const GESTURE_LIMITS = { controls: 30, timeMs: 150_000 }
const MAX_TARGETS = 6
const MAX_ALTERNATIVES = 4
/** The page's clock moves this far, in steps, before a gesture, to see whether the element turns on its own. */
const QUIET_MS = 8000
const QUIET_STEP_MS = 250
/**
 * After a gesture or a click, the page's clock moves this far (and 200 ms more once transitions are made to end), so its
 * timers and frames finish what it started. With the turn found in steps of 250 ms and a gesture of about 150 ms, an
 * autoplay that turns every 2 s or more cannot turn again before the element is read.
 */
const AFTER_MS = 800
/** How long the paused page is watched for pixels that change on their own (a CSS animation, a video). */
const RESTLESS_MS = 300
/** Thumbnails this far apart (mean grey levels, 0 to 255) differ. */
export const PIXEL_CHANGE = 8
/** On a drawing area, a thin stroke is the change: a mean of one grey level. */
const STROKE_CHANGE = 1

export type GestureName = 'swipe-left' | 'swipe-right' | 'pinch-out'
export type GestureTargetKind = 'carousel' | 'map' | 'viewer' | 'touch' | 'drawing'

/** What an element shows, read in the page: enough to tell whether a gesture or a click changed it, and how. */
export interface ViewState {
  /** A carousel's slides by their content, each once (clones folded), in the page's order. */
  ring: string[]
  /** The slide that shows most, by its content. */
  focus?: string | undefined
  /** The element's visible text and pictures, cut short. */
  parts: string
  /** Transforms inside the element and the offsets of boxes the page scrolls itself (overflow hidden), hashed. */
  layout: string
  /** Offsets of boxes the browser scrolls (overflow auto or scroll), hashed: a swipe the browser takes as a scroll. */
  scroll: string
  /** A map's zoom level, read from its tiles' addresses (…/z/x/y.png). */
  zoom?: number | undefined
  /** The browser's own pinch zoom of the page (visualViewport.scale). */
  scale: number
  /** The element as a 16×16 grey thumbnail. */
  thumb?: Thumb | undefined
}

export interface GestureTry {
  gesture: GestureName
  /** What changed in the element: slide, content, zoom, layout, pixels; scroll (the browser's); empty when nothing did. */
  changed: string[]
  /** The gesture made the page navigate, open a window, submit or show a dialog: the harness's watch. */
  context?: string | undefined
  /** The browser zoomed the page itself: nothing on the page took the pinch. */
  browserZoom?: boolean | undefined
  before?: ViewState | undefined
  after?: ViewState | undefined
  outcome?: 'unmatched' | 'not-exercised' | undefined
  reason?: string | undefined
}

export type AlternativeKind = 'next' | 'previous' | 'dot' | 'zoom-in' | 'zoom-out'

export interface GestureAlternative {
  kind: AlternativeKind
  label: string
  ref: string
  /** It did what the gesture did. */
  reproduced?: boolean | undefined
  /** What it changed, when it changed the element in another way, or nothing (`[]`). */
  changed?: string[] | undefined
  /** It was not tried: the skip list, another layer over it, not showing. */
  skipped?: string | undefined
}

export interface GestureTarget extends InPageElement {
  kind: GestureTargetKind
  /** Why it is a candidate: a known library, touch listeners, `touch-action`. */
  why: string
  /** Its name and the texts around it (heading, description, instructions), for messages and the essential judgment. */
  texts: string[]
  /** Looks like a signature pad or a drawing area, where the path is the point: `a signature pad`. */
  essential?: string | undefined
  /** It turned on its own while the page's clock ran with no input (autoplay); the gesture came right after a turn. */
  autoplay?: boolean | undefined
  /** Its pixels changed with the page's clock stopped (a CSS animation, a video): a change seen only in pixels is not the gesture's. */
  restless?: boolean | undefined
  tries: GestureTry[]
  /**
   * The first gesture that changed it, and how (`slide "Photo 1" → "Photo 2"`); `context` when what it did was to make
   * the page navigate, open a window, submit or show a dialog.
   */
  effect?: { gesture: GestureName; changed: string[]; detail: string; context?: boolean | undefined } | undefined
  alternatives: GestureAlternative[]
  /** The same gesture on a second fresh load changed it again (true) or not (false); absent when not tried. */
  confirmed?: boolean | undefined
  outcome?: 'unmatched' | 'not-exercised' | 'not-tried' | undefined
  reason?: string | undefined
}

export interface GesturesData {
  viewport: { width: number; height: number }
  /** Touch events sent over the DevTools protocol, on a page with touch enabled. */
  touch: boolean
  /** The pointer listeners could be read over the DevTools protocol. */
  listeners: boolean
  targets: GestureTarget[]
  loads: number
  actions: HarnessAction[]
  end: 'complete' | 'budget' | 'time'
}

interface GestureWindow {
  __rampaKit: { describe(el: Element): InPageElement; visible(el: Element): boolean; resolve(ref: string): Element | null }
  __rampaActivate: { facts(el: Element): ControlFacts }
}

/** Words of controls that stand in for a gesture, in English, Portuguese and Spanish; read in the page as sources. */
export const ALTERNATIVE_WORDS = {
  next: /\b(next|forward|siguiente|seguinte|avan[cç]ar|adelante)\b|pr[oó]xim|^\s*[›»→❯⟩>]\s*$/i,
  previous: /\b(prev|previous|back|anterior|voltar|atr[aá]s|retroceder)\b|^\s*[‹«←❮⟨<]\s*$/i,
  zoomIn: /zoom ?in\b|\bampliar\b|\baproximar\b|\bacercar\b|mais zoom|m[aá]s zoom|^\s*\+\s*$/i,
  zoomOut: /zoom ?out\b|\breduzir\b|\bafastar\b|\balejar\b|menos zoom|^\s*[-−–]\s*$/i,
  dot: /\bslide \d|go to slide|ir para o slide|ir al slide|diapositiva \d|^\s*\d{1,2}\s*$|\bpage \d|\bp[aá]gina \d/i,
  dotClass: /dot|bullet|pagination|indicator|pager/i,
}

/** Names and classes that make a drawing area or a signature pad: a gesture there is likely essential. */
export const DRAWING_WORDS = /sign(ature)?\b|signature|assinatura|assine|firma|\bdraw|drawing|desenh|dibuj|sketch|paint|pintar|handwrit|caligraf/i

/**
 * Runs in the page; needs the kit and the activate kit, and the pointer listeners marked (`__rampaPtr`). The elements
 * that react to swipes or pinches: carousels of the known libraries or with touch, gesture or pointer listeners, maps,
 * image viewers, drawing areas, and other elements with touch-and-move or gesture listeners, or pointer listeners on an
 * element that keeps the browser from panning it (`touch-action`). Drag widgets (sliders, sortable items) are the
 * pointer probe's. A block that holds most of the page is delegation, not a gesture.
 */
export function findGestureTargets(args: { max: number; drawing: string }): Array<Omit<GestureTarget, 'tries' | 'alternatives'>> {
  const w = window as unknown as GestureWindow
  const kit = w.__rampaKit
  const drawing = new RegExp(args.drawing, 'i')
  const collapse = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim()
  const cut = (value: string, n: number) => (value.length > n ? `${value.slice(0, n - 1)}…` : value)
  const showing = (el: Element, min = 40) => kit.visible(el) && el.getBoundingClientRect().width >= min && el.getBoundingClientRect().height >= min
  const listen = (el: Element): string => (el as unknown as { __rampaPtr?: string }).__rampaPtr ?? ''
  const byIds = (ids: string | null) =>
    collapse(
      (ids ?? '')
        .split(/\s+/)
        .filter(Boolean)
        .map((id) => document.getElementById(id)?.textContent ?? '')
        .join(' '),
    )
  // The element's name, its own text, the heading before it, its description and the text next to it.
  const textsAround = (el: Element): string[] => {
    const out: string[] = []
    const add = (text: string) => {
      const value = cut(collapse(text), 200)
      if (value && !out.includes(value)) out.push(value)
    }
    add(el.getAttribute('aria-label') ?? '')
    add(byIds(el.getAttribute('aria-labelledby')))
    add(el.getAttribute('title') ?? '')
    add(byIds(el.getAttribute('aria-describedby')))
    add((el as HTMLElement).innerText ?? '')
    for (let a: Element | null = el, i = 0; a && i < 4 && out.length < 6; a = a.parentElement, i++) {
      for (let s = a.previousElementSibling, j = 0; s && j < 3; s = s.previousElementSibling, j++) {
        if (/^h[1-6]$/.test(s.localName) || s.getAttribute('role') === 'heading' || s.localName === 'p' || s.localName === 'label') add((s as HTMLElement).innerText ?? '')
      }
    }
    return out.slice(0, 6)
  }
  const CAROUSELS = '.swiper, .swiper-container, .slick-slider, .glide, .flickity-enabled, .splide, .owl-carousel, .keen-slider, .embla, .carousel, [aria-roledescription="carousel" i]'
  const KNOWN = '.swiper, .swiper-container, .slick-slider, .glide, .flickity-enabled, .splide, .owl-carousel, .keen-slider, .embla'
  const MAPS = '.leaflet-container, .mapboxgl-map, .maplibregl-map, .gm-style, .ol-viewport, [aria-roledescription="map" i]'
  const VIEWERS = '.openseadragon-container, .swiper-zoom-container, pinch-zoom, .pinch-zoom, .panzoom, [data-panzoom], .viewer-canvas, .pswp__zoom-wrap, .zoomist-container, [data-pinch-zoom]'
  const DRAGS = '[role=slider], [role=separator], [draggable=true], [aria-grabbed], [aria-roledescription*="sortable" i], [aria-roledescription*="draggable" i]'
  const out: Array<Omit<GestureTarget, 'tries' | 'alternatives'>> = []
  const taken: Element[] = []
  const add = (el: Element, kind: GestureTargetKind, why: string, essential?: string) => {
    if (out.length >= args.max || taken.some((other) => other === el || other.contains(el) || el.contains(other))) return
    taken.push(el)
    const described = kit.describe(el)
    out.push({ ...described, label: cut(collapse(el.getAttribute('aria-label') || byIds(el.getAttribute('aria-labelledby')) || el.getAttribute('aria-roledescription') || ''), 60) || described.label.slice(0, 60), kind, why, texts: textsAround(el), ...(essential ? { essential } : {}) })
  }
  const huge = (el: Element) => {
    const r = el.getBoundingClientRect()
    return r.width * r.height > 0.6 * window.innerWidth * Math.max(window.innerHeight, document.documentElement.scrollHeight)
  }
  // Drawing areas first: a canvas or an SVG drawn on with the pointer, named for a signature or a drawing.
  for (const el of Array.from(document.querySelectorAll('canvas, svg'))) {
    if (!showing(el, 60)) continue
    const parent = el.parentElement
    const types = `${listen(el)} ${parent ? listen(parent) : ''}`
    if (!/down|touch|move/.test(types)) continue
    const words = [el.id, el.getAttribute('class') ?? '', el.getAttribute('aria-label') ?? '', parent?.id ?? '', parent?.getAttribute('class') ?? '', ...textsAround(el)].join(' ')
    if (!drawing.test(words)) continue
    add(el, 'drawing', 'a canvas drawn on with the pointer', /sign|assin|firma/i.test(words) ? 'a signature pad' : 'a drawing area')
  }
  for (const el of Array.from(document.querySelectorAll(CAROUSELS))) {
    if (!showing(el)) continue
    const known = el.matches(KNOWN)
    const listened = /touch|gesture|down/.test(listen(el)) || Array.from(el.querySelectorAll('*')).slice(0, 300).some((child) => /touch|gesture|down/.test(listen(child)))
    if (known || listened) add(el, 'carousel', known ? `a ${(el.getAttribute('class') ?? '').split(/\s+/)[0]} carousel, which swipes` : 'a carousel with touch or pointer listeners')
  }
  for (const el of Array.from(document.querySelectorAll(MAPS)).slice(0, 3)) if (showing(el)) add(el, 'map', 'a map, which zooms with a pinch')
  for (const el of Array.from(document.querySelectorAll(VIEWERS)).slice(0, 3)) if (showing(el)) add(el, 'viewer', 'an image viewer that zooms with a pinch')
  const walker = document.createTreeWalker(document.body ?? document.documentElement, NodeFilter.SHOW_ELEMENT)
  for (let n = walker.nextNode(), i = 0; n && i < 20_000 && out.length < args.max; n = walker.nextNode(), i++) {
    const el = n as Element
    const types = listen(el)
    if (!types || el === document.body || el === document.documentElement || !showing(el) || huge(el)) continue
    if (el.matches(DRAGS) || el.closest(DRAGS) || el.querySelector(DRAGS)) continue
    const touchAction = getComputedStyle(el).touchAction
    const gesture = types.includes('gesture') || (types.includes('touch') && types.includes('move'))
    // Pointer events with the browser's panning turned off: what Hammer.js and pinch-zoom libraries do.
    const pointer = types.includes('down') && types.includes('move') && /none|pan-x|pan-y|pinch-zoom/.test(touchAction) && !/^(grab|-webkit-grab|move)$/.test(getComputedStyle(el).cursor)
    if (!gesture && !pointer) continue
    const img = el.localName === 'img' || el.querySelector('img') !== null
    add(el, img && /none|pinch/.test(touchAction) ? 'viewer' : 'touch', types.includes('gesture') ? 'gesture listeners' : gesture ? 'touchstart and touchmove listeners' : `pointer listeners and touch-action: ${touchAction}`)
  }
  return out
}

/**
 * Runs in the page; needs the kit. What the element shows now: a carousel's slides and the one most in view, its visible
 * text and pictures, transforms and scroll offsets inside it, a map's zoom from its tiles' addresses, and where it is
 * (`clip`, in page coordinates, for a capture). With `finish`, transitions and animations that end are made to end first.
 */
export function readView(args: { ref: string; finish: boolean }): (Omit<ViewState, 'thumb'> & { clip: InPageRect | null }) | null {
  const kit = (window as unknown as GestureWindow).__rampaKit
  const root = kit.resolve(args.ref)
  if (!root) return null
  if (args.finish) {
    for (const animation of document.getAnimations()) {
      try {
        if (animation.effect?.getComputedTiming().endTime !== Number.POSITIVE_INFINITY) animation.finish()
      } catch {
        // An animation that cannot finish keeps running.
      }
    }
  }
  const collapse = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim()
  const box = root.getBoundingClientRect()
  const left = Math.max(box.left, 0)
  const top = Math.max(box.top, 0)
  const right = Math.min(box.right, window.innerWidth)
  const bottom = Math.min(box.bottom, window.innerHeight)
  const clip = right - left >= 4 && bottom - top >= 4 ? { x: Math.round(left + window.scrollX), y: Math.round(top + window.scrollY), width: Math.round(right - left), height: Math.round(bottom - top) } : null
  // Elements under an animation that never ends (a spinner) move on their own: left out of the layout.
  const busy = new Set<Element>()
  for (const animation of document.getAnimations()) {
    try {
      const target = (animation.effect as KeyframeEffect | null)?.target
      if (target && animation.effect?.getComputedTiming().endTime === Number.POSITIVE_INFINITY) busy.add(target)
    } catch {
      // No target.
    }
  }
  const underBusy = (el: Element) => {
    for (let a: Element | null = el; a && a !== root.parentElement; a = a.parentElement) if (busy.has(a)) return true
    return false
  }
  const hash = (text: string) => {
    let h = 5381
    for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0
    return h.toString(16)
  }
  const base = (src: string) => (src.startsWith('data:') ? src.slice(0, 40) : (src.split(/[?#]/)[0] ?? '').split('/').slice(-2).join('/'))
  const keyOf = (el: Element): string => {
    const text = collapse((el as HTMLElement).innerText ?? el.textContent).slice(0, 80)
    const images = Array.from(el.querySelectorAll('img'))
      .slice(0, 2)
      .map((img) => base(img.getAttribute('src') || img.currentSrc || ''))
    const background = getComputedStyle(el).backgroundImage
    return [text, ...images, background && background !== 'none' ? base(background.replace(/^url\(["']?|["']?\)$/g, '')) : ''].filter(Boolean).join(' | ').slice(0, 120)
  }
  // The slides: a known library's, or the children of the element (or of one inside it) that are each nearly as large.
  const SLIDES = '.swiper-slide, .slick-slide, .glide__slide, .carousel-item, .splide__slide, .owl-item, .keen-slider__slide, .embla__slide, .flickity-cell, .carousel-cell, [aria-roledescription="slide" i]'
  let slides = Array.from(root.querySelectorAll(SLIDES))
  if (slides.length < 2) {
    let best: Element[] = []
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT)
    for (let n: Node | null = root, i = 0; n && i < 3000; n = walker.nextNode(), i++) {
      const el = n as Element
      if (el.children.length < 2 || el.children.length > 60) continue
      const large = Array.from(el.children).filter((child) => {
        const r = child.getBoundingClientRect()
        return r.width >= 0.4 * box.width && r.height >= 0.3 * box.height && child.localName !== 'button'
      })
      if (large.length >= 2 && large.length > best.length) best = large
    }
    slides = best
  }
  const ring: string[] = []
  let focus: string | undefined
  let most = 0
  for (const slide of slides.slice(0, 60)) {
    const key = keyOf(slide)
    if (key && !ring.includes(key) && ring.length < 24) ring.push(key)
    const style = getComputedStyle(slide)
    if (style.display === 'none' || style.visibility === 'hidden' || Number.parseFloat(style.opacity) < 0.5) continue
    const r = slide.getBoundingClientRect()
    const seen = Math.max(0, Math.min(r.right, right) - Math.max(r.left, left)) * Math.max(0, Math.min(r.bottom, bottom) - Math.max(r.top, top))
    if (key && seen > most + 1) {
      most = seen
      focus = key
    }
  }
  const images = Array.from(root.querySelectorAll('img'))
    .filter((img) => {
      const r = img.getBoundingClientRect()
      return r.width > 0 && r.right > left && r.left < right && r.bottom > top && r.top < bottom
    })
    .slice(0, 12)
  const parts = `${collapse((root as HTMLElement).innerText ?? root.textContent).slice(0, 200)} ${images.map((img) => base(img.getAttribute('src') || img.currentSrc || '')).join(' ')}`.trim()
  const transforms: string[] = []
  const pageScrolled: string[] = []
  const userScrolled: string[] = []
  const all = [root, ...Array.from(root.querySelectorAll('*')).slice(0, 600)]
  for (const [i, el] of all.entries()) {
    if (underBusy(el)) continue
    const style = getComputedStyle(el)
    if (style.transform && style.transform !== 'none') transforms.push(`${i}:${style.transform.replace(/(\d+\.\d)\d+/g, '$1')}`)
    if (el.scrollLeft !== 0 || el.scrollTop !== 0) {
      const own = /auto|scroll/.test(`${style.overflowX} ${style.overflowY}`)
      ;(own ? userScrolled : pageScrolled).push(`${i}:${Math.round(el.scrollLeft)},${Math.round(el.scrollTop)}`)
    }
  }
  // A map's zoom: the level most of its tiles in view are at.
  const levels = new Map<number, number>()
  for (const img of images) {
    const match = /\/(\d{1,2})\/\d+\/\d+(?:@\dx)?\.(?:png|jpe?g|webp)/i.exec(img.getAttribute('src') || img.currentSrc || '')
    if (match) levels.set(Number(match[1]), (levels.get(Number(match[1])) ?? 0) + 1)
  }
  const zoom = [...levels.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
  return {
    ring: ring.length >= 2 ? ring : [],
    ...(ring.length >= 2 && focus ? { focus } : {}),
    parts,
    layout: hash([...transforms, ...pageScrolled].join(';')),
    scroll: hash(userScrolled.join(';')),
    ...(zoom !== undefined ? { zoom } : {}),
    scale: Math.round((window.visualViewport?.scale ?? 1) * 100) / 100,
    clip,
  }
}

/** What changed between two readings of one element: slide, content, zoom, layout, pixels; scroll is the browser's own. */
export function viewChange(a: ViewState | undefined, b: ViewState | undefined, restless = false, pixels = PIXEL_CHANGE): string[] {
  if (!a || !b) return []
  const changed: string[] = []
  if (a.focus !== undefined && b.focus !== undefined && a.focus !== b.focus) changed.push('slide')
  if (a.parts !== b.parts) changed.push('content')
  if (a.zoom !== undefined && b.zoom !== undefined && a.zoom !== b.zoom) changed.push('zoom')
  if (a.layout !== b.layout) changed.push('layout')
  if (!restless && a.thumb && b.thumb && thumbDistance(a.thumb, b.thumb) >= pixels) changed.push('pixels')
  if (a.scroll !== b.scroll) changed.push('scroll')
  return changed
}

/** The changes a page's own script made: not the browser's scrolling, not pixels alone. */
export const STRONG_CHANGES = ['slide', 'content', 'zoom', 'layout']

/** A gesture's effect: anything but the browser's own scrolling, and the slides and pixels that scrolling moved. */
export function effectOf(changed: readonly string[]): string[] {
  const scrolled = changed.includes('scroll')
  return changed.filter((kind) => kind !== 'scroll' && !(scrolled && (kind === 'pixels' || kind === 'slide')))
}

/** How a change reads in a message: `slide "Photo 1" → "Photo 2"`, `zoom 5 → 6`. */
export function describeChange(a: ViewState | undefined, b: ViewState | undefined, changed: readonly string[]): string {
  const short = (value: string | undefined) => {
    const text = (value ?? '').replace(/\s+/g, ' ').trim()
    return text.length > 40 ? `${text.slice(0, 39)}…` : text
  }
  if (changed.includes('slide') && a?.focus && b?.focus) return `slide "${short(a.focus)}" → "${short(b.focus)}"`
  if (changed.includes('zoom') && a?.zoom !== undefined && b?.zoom !== undefined) return `zoom ${a.zoom} → ${b.zoom}`
  if (changed.includes('content')) return `content "${short(a?.parts)}" → "${short(b?.parts)}"`
  if (changed.includes('layout')) return 'its contents moved or were scaled'
  if (changed.includes('pixels')) return 'its pixels changed'
  return changed.join(', ')
}

/**
 * Whether a control did what the gesture did, each from its own fresh load: the same move along a carousel's slides (a
 * load whose carousel turned on its own starts elsewhere, so the move is compared, not the slide), the same direction of
 * zoom, or, from the same start, the same result: the same content, or a picture closer to the gesture's than to the start.
 */
export function sameEffect(g0: ViewState | undefined, g1: ViewState | undefined, a0: ViewState | undefined, a1: ViewState | undefined): boolean {
  if (!g0 || !g1 || !a0 || !a1) return false
  if (effectOf(viewChange(a0, a1)).length === 0) return false
  const sameRing = g0.ring.length >= 2 && [...g0.ring].sort().join('\n') === [...a0.ring].sort().join('\n')
  if (sameRing && g0.focus && g1.focus && a0.focus && a1.focus) {
    const n = g0.ring.length
    const shift = (ring: string[], from: string, to: string) => (ring.indexOf(to) - ring.indexOf(from) + n) % n
    const gesture = shift(g0.ring, g0.focus, g1.focus)
    if (gesture !== 0) return shift(a0.ring, a0.focus, a1.focus) === gesture
  }
  if (g0.zoom !== undefined && g1.zoom !== undefined && a0.zoom !== undefined && a1.zoom !== undefined && g0.zoom !== g1.zoom) return Math.sign(g1.zoom - g0.zoom) === Math.sign(a1.zoom - a0.zoom)
  const sameStart = g0.parts === a0.parts && (!g0.thumb || !a0.thumb || thumbDistance(g0.thumb, a0.thumb) < PIXEL_CHANGE)
  if (!sameStart) return false
  if (g0.parts !== g1.parts) return a1.parts === g1.parts
  if (g0.focus !== undefined && g1.focus !== undefined && g0.focus !== g1.focus) return a1.focus === g1.focus
  if (g1.thumb && a1.thumb && g0.thumb) return thumbDistance(a1.thumb, g1.thumb) < Math.max(PIXEL_CHANGE, 0.5 * thumbDistance(g0.thumb, g1.thumb))
  return g1.layout === a1.layout
}

/**
 * Runs in the page; needs the kit and the activate kit. The single-pointer controls around an element that may do what a
 * gesture did, in the order they are tried: for a swipe to the left, next, then the dot after the current one, then
 * previous; for a swipe to the right, the reverse; for a pinch, zoom in, then zoom out. One of each kind.
 */
export function listAlternatives(args: { ref: string; gesture: GestureName; words: Record<keyof typeof ALTERNATIVE_WORDS, string> }): Array<Omit<GestureAlternative, 'reproduced' | 'changed' | 'skipped'> & { id: InPageElement['id']; facts: ControlFacts }> {
  const w = window as unknown as GestureWindow
  const kit = w.__rampaKit
  const root = kit.resolve(args.ref)
  if (!root) return []
  const words = Object.fromEntries(Object.entries(args.words).map(([key, source]) => [key, new RegExp(source, 'i')])) as Record<keyof typeof ALTERNATIVE_WORDS, RegExp>
  const collapse = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim()
  const cut = (value: string, n: number) => (value.length > n ? `${value.slice(0, n - 1)}…` : value)
  const CONTROLS = 'button, [role=button], a[href^="#"], a[role=button], a:not([href]), [role=tab], input[type=button], [tabindex]:not([tabindex="-1"])'
  const DOTS = '[class*=bullet], [class*=dot], [class*=indicator] > *, [class*=pagination] > *, [class*=pager] > *'
  const scopes: Element[] = [root]
  for (let a = root.parentElement, i = 0; a && i < 3 && a !== document.body && a !== document.documentElement; a = a.parentElement, i++) scopes.push(a)
  const nameOf = (el: Element) =>
    collapse(
      el.getAttribute('aria-label') ||
        (el.getAttribute('aria-labelledby') ?? '')
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? '')
          .join(' ') ||
        (el as HTMLElement).innerText ||
        el.getAttribute('title') ||
        (el as HTMLInputElement).value ||
        '',
    )
  const own = (el: Element) => el.getAttribute('class') ?? ''
  const classify = (el: Element, name: string): AlternativeKind | null => {
    const cls = own(el)
    if (words.zoomIn.test(name) || /zoom-?in/i.test(cls)) return 'zoom-in'
    if (words.zoomOut.test(name) || /zoom-?out/i.test(cls)) return 'zoom-out'
    if (words.next.test(name) || /(^|[\s_-])(next|forward)([\s_-]|$)|arrow-?right|arrow--right|button-next/i.test(cls)) return 'next'
    if (words.previous.test(name) || /(^|[\s_-])(prev|previous|back)([\s_-]|$)|arrow-?left|arrow--left|button-prev/i.test(cls)) return 'previous'
    if (words.dot.test(name) || el.getAttribute('role') === 'tab' || words.dotClass.test(`${cls} ${own(el.parentElement ?? el)}`)) return 'dot'
    return null
  }
  // How far a control sits from the element's box (0 inside it): the nearest of each kind is the element's own.
  const box = root.getBoundingClientRect()
  const gap = (el: Element) => {
    const r = el.getBoundingClientRect()
    const dx = Math.max(box.left - r.right, r.left - box.right, 0)
    const dy = Math.max(box.top - r.bottom, r.top - box.bottom, 0)
    return Math.hypot(dx, dy)
  }
  const reach = Math.max(160, 0.6 * box.height)
  // Another carousel's or map's controls are its own.
  const ZONES = '.swiper, .swiper-container, .slick-slider, .glide, .flickity-enabled, .splide, .owl-carousel, .keen-slider, .embla, .carousel, [aria-roledescription="carousel" i], .leaflet-container, .mapboxgl-map, .maplibregl-map, .gm-style, .ol-viewport'
  const found: Array<{ el: Element; kind: AlternativeKind; name: string; gap: number }> = []
  const seen = new Set<Element>()
  for (const scope of scopes) {
    for (const el of Array.from(scope.querySelectorAll(`${CONTROLS}, ${DOTS}`))) {
      if (seen.has(el) || el === root || found.length >= 80) continue
      seen.add(el)
      if (!kit.visible(el) || el.getBoundingClientRect().width < 4 || el.getBoundingClientRect().height < 4) continue
      // A container of controls (a pagination bar) is not one of them.
      if (el.querySelector(`${CONTROLS}, ${DOTS}`)) continue
      const zone: Element | null = el.closest(ZONES)
      if (zone && zone !== root && !zone.contains(root)) continue
      const distance = gap(el)
      if (distance > reach) continue
      const name = nameOf(el)
      const kind = classify(el, name)
      if (kind) found.push({ el, kind, name, gap: distance })
    }
  }
  found.sort((a, b) => a.gap - b.gap)
  const active = (el: Element) =>
    /(^|[\s_-])(active|current|selected|is-active|is-selected)([\s_-]|$)|bullet-active|slick-active/i.test(`${own(el)} ${own(el.parentElement ?? el)}`) ||
    ['true', 'page', 'step', 'location'].includes(el.getAttribute('aria-current') ?? '') ||
    el.getAttribute('aria-selected') === 'true' ||
    el.getAttribute('aria-pressed') === 'true'
  // The dots of the nearest group, in the page's order.
  const nearestDot = found.find((f) => f.kind === 'dot')
  const dots = found
    .filter((f) => f.kind === 'dot' && f.el.parentElement === nearestDot?.el.parentElement)
    .sort((a, b) => (a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
  let dot: (typeof found)[number] | undefined
  if (dots.length >= 2) {
    const current = dots.findIndex((d) => active(d.el))
    const step = args.gesture === 'swipe-right' ? -1 : 1
    dot = dots[current >= 0 ? (current + step + dots.length) % dots.length : 1]
  }
  const order: AlternativeKind[] = args.gesture === 'swipe-left' ? ['next', 'dot', 'previous'] : args.gesture === 'swipe-right' ? ['previous', 'dot', 'next'] : ['zoom-in', 'zoom-out']
  const out: Array<Omit<GestureAlternative, 'reproduced' | 'changed' | 'skipped'> & { id: InPageElement['id']; facts: ControlFacts }> = []
  for (const kind of order) {
    const pick = kind === 'dot' ? dot : found.find((f) => f.kind === kind)
    if (!pick) continue
    const described = kit.describe(pick.el)
    out.push({ kind, label: cut(pick.name || described.label, 60), ref: described.ref, id: described.id, facts: w.__rampaActivate.facts(pick.el) })
  }
  return out
}

/**
 * No focus ring in a capture: a touch that focused something is not the gesture's effect. No overscroll on the page
 * itself: a swipe that reaches the edge of a page would otherwise go back in the browser's history (or pull to refresh).
 */
const NO_RINGS = '*:focus, *:focus-visible { outline: none !important; } * { caret-color: transparent !important; } html, body { overscroll-behavior: none !important; }'

const sessions = new WeakMap<Page, CDPSession>()
const paused = new WeakSet<Page>()

async function cdpOf(probe: ProbePage): Promise<CDPSession> {
  const known = sessions.get(probe.page)
  if (known) return known
  const cdp = await probe.context.newCDPSession(probe.page)
  sessions.set(probe.page, cdp)
  await probe.page.addStyleTag({ content: NO_RINGS }).catch(() => undefined)
  return cdp
}

/** Pauses the page's clock once: its timers run only when the probe moves it. */
async function freeze(page: Page): Promise<void> {
  if (paused.has(page)) return
  await pauseClock(page)
  paused.add(page)
}

async function thumbAt(cdp: CDPSession, clip: InPageRect | null): Promise<Thumb | undefined> {
  if (!clip) return undefined
  try {
    const shot = (await cdp.send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 1 }, captureBeyondViewport: false })) as { data: string }
    return thumbOf(Buffer.from(shot.data, 'base64'))
  } catch {
    return undefined
  }
}

async function view(page: Page, cdp: CDPSession, ref: string, thumb = true): Promise<ViewState | undefined> {
  const read = await page.evaluate(readView, { ref, finish: true }).catch(() => null)
  if (!read) return undefined
  const { clip, ...state } = read
  const t = thumb ? await thumbAt(cdp, clip) : undefined
  return { ...state, ...(t ? { thumb: t } : {}) }
}

/** Runs in the page: transitions and animations that end are made to end now. */
function finishAnimations(): void {
  for (const animation of document.getAnimations()) {
    try {
      if (animation.effect?.getComputedTiming().endTime !== Number.POSITIVE_INFINITY) animation.finish()
    } catch {
      // An animation that cannot finish keeps running.
    }
  }
}

/** Moves the paused clock in slices, so frames and timers run as they would. */
async function run(page: Page, ms: number, slice: number): Promise<void> {
  for (let left = ms; left > 0; left -= slice) await page.clock.runFor(Math.min(slice, left)).catch(() => undefined)
}

/** Lets what an input started finish: the page's time moves on, transitions end, and what they set off runs. */
async function settle(page: Page): Promise<void> {
  await run(page, AFTER_MS, 100)
  await page.evaluate(finishAnimations).catch(() => undefined)
  await page.waitForTimeout(120)
  await run(page, 200, 100)
}

/**
 * Moves the page's clock with no input until the element turns on its own (autoplay), at most 8 s: a gesture right after
 * a turn has the autoplay's whole period before the next. True when it turned.
 */
async function quiet(page: Page, ref: string): Promise<boolean> {
  const sign = (state: Omit<ViewState, 'thumb'> | null) => (state ? `${state.focus ?? ''}|${state.parts}|${state.layout}|${state.zoom ?? ''}` : '')
  let last = sign(await page.evaluate(readView, { ref, finish: true }).catch(() => null))
  for (let t = 0; t < QUIET_MS; t += QUIET_STEP_MS) {
    await run(page, QUIET_STEP_MS, 100)
    const now = sign(await page.evaluate(readView, { ref, finish: true }).catch(() => null))
    if (now !== last) {
      // Transitions were made to end in the reading; what they set off runs, without moving the clock any further.
      await page.waitForTimeout(120)
      return true
    }
    last = now
  }
  return false
}

/** The points of a gesture over a box of the window: a swipe across its middle, or two fingers spreading from its centre. */
export function gesturePath(gesture: GestureName, box: { x: number; y: number; width: number; height: number }, viewport: { width: number; height: number }): Array<Array<{ x: number; y: number }>> {
  const clamp = (p: { x: number; y: number }) => ({ x: Math.round(Math.min(Math.max(p.x, 2), viewport.width - 2)), y: Math.round(Math.min(Math.max(p.y, 2), viewport.height - 2)) })
  const steps = 8
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  const frames: Array<Array<{ x: number; y: number }>> = []
  if (gesture === 'pinch-out') {
    const small = Math.max(12, Math.min(box.width, box.height) * 0.1)
    const large = Math.max(small + 40, Math.min(box.width, box.height) * 0.35)
    for (let i = 0; i <= steps; i++) {
      const r = small + ((large - small) * i) / steps
      frames.push([clamp({ x: cx - r, y: cy }), clamp({ x: cx + r, y: cy })])
    }
    return frames
  }
  const from = gesture === 'swipe-left' ? box.x + box.width * 0.75 : box.x + box.width * 0.25
  const to = gesture === 'swipe-left' ? box.x + box.width * 0.25 : box.x + box.width * 0.75
  for (let i = 0; i <= steps; i++) frames.push([clamp({ x: from + ((to - from) * i) / steps, y: cy })])
  return frames
}

/** Sends a gesture's touch points over the DevTools protocol, moving the page's clock a frame between moves. */
async function touch(page: Page, cdp: CDPSession, frames: Array<Array<{ x: number; y: number }>>): Promise<void> {
  const points = (frame: Array<{ x: number; y: number }>) => frame.map((p, id) => ({ x: p.x, y: p.y, id, radiusX: 4, radiusY: 4, force: 1 }))
  const [first, ...rest] = frames
  if (!first) return
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(first) })
  await run(page, 16, 16)
  for (const frame of rest) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(frame) })
    await run(page, 16, 16)
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}

/** Runs in the page: the element's box in the window, once it has been scrolled into view. */
function boxOf(ref: string): { x: number; y: number; width: number; height: number } | null {
  const el = (window as unknown as GestureWindow).__rampaKit.resolve(ref)
  if (!el) return null
  const r = el.getBoundingClientRect()
  const left = Math.max(r.left, 0)
  const top = Math.max(r.top, 0)
  const width = Math.min(r.right, window.innerWidth) - left
  const height = Math.min(r.bottom, window.innerHeight) - top
  return width >= 8 && height >= 8 ? { x: left, y: top, width, height } : null
}

interface Trial {
  tried: GestureTry
  autoplay: boolean
  restless: boolean
}

/** One gesture on the element, on the harness's page (a fresh one when `fresh`, or when the last window changed it). */
async function tryGesture(harness: Harness, target: GestureTarget, gesture: GestureName, fresh: boolean): Promise<Trial> {
  const probe = await harness.page(fresh)
  const page = probe.page
  const none = (outcome: GestureTry['outcome'], reason?: string): Trial => ({ tried: { gesture, changed: [], outcome, ...(reason ? { reason } : {}) }, autoplay: false, restless: false })
  // The element a gesture is made on is a surface (a carousel, a map), never on the skip list: what is pressed around it is.
  if (!(await harness.locate(probe, target, { check: false }))) return none('unmatched')
  const aimed = await harness.aim(probe, target)
  if ('cover' in aimed) return none('not-exercised', `covered by <${aimed.cover.tag}> "${aimed.cover.text.slice(0, 60)}"`)
  if ('hidden' in aimed) return none('not-exercised', 'not showing on this load')
  const cdp = await cdpOf(probe)
  await freeze(page)
  const autoplay = await quiet(page, target.ref)
  const before = await view(page, cdp, target.ref)
  await page.waitForTimeout(RESTLESS_MS)
  const still = await view(page, cdp, target.ref)
  const restless = Boolean(before?.thumb && still?.thumb && thumbDistance(before.thumb, still.thumb) >= PIXEL_CHANGE)
  const box = await page.evaluate(boxOf, target.ref).catch(() => null)
  if (!box) return none('not-exercised', 'not showing on this load')
  const frames = gesturePath(gesture, box, page.viewportSize() ?? { width: 1280, height: 800 })
  harness.log('activate', { ref: target.ref, label: target.label, detail: `${gesture} from ${frames[0]?.map((p) => `${p.x},${p.y}`).join(' ')} to ${frames.at(-1)?.map((p) => `${p.x},${p.y}`).join(' ')}` })
  const watch = await harness.window(
    probe,
    async () => {
      await touch(page, cdp, frames)
      await settle(page)
    },
    { ms: 0, ref: target.ref, label: target.label },
  )
  const after = await view(page, cdp, target.ref)
  const browserZoom = Boolean(before && after && after.scale !== before.scale)
  const changed = browserZoom ? [] : viewChange(before, after, restless, target.kind === 'drawing' ? STROKE_CHANGE : PIXEL_CHANGE)
  const context = contextChanges(watch, 'commit').find((change) => ['navigation', 'new-window', 'submission', 'modal', 'dialog'].includes(change.kind))
  return {
    tried: { gesture, changed, ...(context ? { context: `${context.kind}${context.detail ? `: ${context.detail.slice(0, 200)}` : ''}` } : {}), ...(browserZoom ? { browserZoom: true } : {}), ...(before ? { before } : {}), ...(after ? { after } : {}) },
    autoplay,
    restless,
  }
}

/**
 * One control around the element, clicked on a fresh load (or on the load the controls were listed on, which nothing
 * has touched yet), and what it did to the element.
 */
async function tryAlternative(harness: Harness, target: GestureTarget, alternative: GestureAlternative & { id: InPageElement['id'] }, fresh: boolean): Promise<{ changed?: string[]; before?: ViewState; after?: ViewState; skipped?: string }> {
  const probe = await harness.page(fresh)
  const page = probe.page
  if (!(await harness.locate(probe, target, { check: false }))) return { skipped: 'the element was not found on a fresh load' }
  const aimed = await harness.aim(probe, target)
  if (!('x' in aimed)) return { skipped: 'cover' in aimed ? `the element is covered by <${aimed.cover.tag}>` : 'the element is not showing' }
  const cdp = await cdpOf(probe)
  await freeze(page)
  await quiet(page, target.ref)
  const before = await view(page, cdp, target.ref)
  const control = { ref: alternative.ref, id: alternative.id, label: alternative.label }
  if (!(await harness.locate(probe, control))) return { skipped: 'not found on a fresh load' }
  const at = await harness.aim(probe, control)
  if (!('x' in at)) return { skipped: 'cover' in at ? `covered by <${at.cover.tag}>` : 'not showing' }
  harness.log('activate', { ref: alternative.ref, label: alternative.label, detail: `clicked, as a single-pointer way to do what the ${target.kind} did` })
  await harness.window(
    probe,
    async () => {
      await page.mouse.click(at.x, at.y)
      await settle(page)
    },
    { ms: 0, ref: alternative.ref, label: alternative.label },
  )
  // Back on the element: the click may have scrolled the page.
  if (await harness.locate(probe, target, { check: false })) await harness.aim(probe, target)
  const after = await view(page, cdp, target.ref)
  return { changed: effectOf(viewChange(before, after)), ...(before ? { before } : {}), ...(after ? { after } : {}) }
}

/** The gestures tried on each kind of element, in order, until one changes it. */
export function gesturesFor(kind: GestureTargetKind): GestureName[] {
  if (kind === 'carousel') return ['swipe-left', 'swipe-right']
  if (kind === 'map') return ['pinch-out']
  if (kind === 'viewer') return ['pinch-out', 'swipe-left']
  if (kind === 'drawing') return ['swipe-left']
  return ['swipe-left', 'swipe-right', 'pinch-out']
}

/** 2.5.1 on one element: its gestures until one changes it; the controls that may do the same; a second load when none did. */
async function exercise(harness: Harness, target: GestureTarget): Promise<void> {
  let fresh = false
  for (const gesture of gesturesFor(target.kind)) {
    if (!harness.timeLeft()) break
    const trial = await tryGesture(harness, target, gesture, fresh)
    target.tries.push(trial.tried)
    if (trial.tried.outcome) {
      target.outcome = trial.tried.outcome
      if (trial.tried.reason) target.reason = trial.tried.reason
      return
    }
    if (trial.autoplay) target.autoplay = true
    if (trial.restless) target.restless = true
    const changed = effectOf(trial.tried.changed)
    if (changed.length > 0 || trial.tried.context) {
      target.effect = { gesture, changed, detail: trial.tried.context ?? describeChange(trial.tried.before, trial.tried.after, changed), ...(trial.tried.context ? { context: true } : {}) }
      break
    }
    // A browser zoom changes the page, and a page that could not be read again may have gone: the next gesture gets a fresh one.
    fresh = Boolean(trial.tried.browserZoom) || !trial.tried.after
  }
  const effect = target.effect
  if (!effect) return
  const reference = target.tries.find((t) => t.gesture === effect.gesture)
  // A drawing area's path is the point (essential): what stands in for it is for a person.
  if (!target.essential && reference && !effect.context) {
    const probe = await harness.page(true)
    const listed = (await harness.locate(probe, target, { check: false }))
      ? await probe.page.evaluate(listAlternatives, { ref: target.ref, gesture: effect.gesture, words: Object.fromEntries(Object.entries(ALTERNATIVE_WORDS).map(([key, value]) => [key, value.source])) as Record<keyof typeof ALTERNATIVE_WORDS, string> }).catch(() => [])
      : []
    let untouched = true
    for (const { facts, ...alternative } of listed.slice(0, MAX_ALTERNATIVES)) {
      const entry: GestureAlternative = { kind: alternative.kind, label: alternative.label, ref: alternative.ref }
      target.alternatives.push(entry)
      const skip = skipReason(facts, harness.origin)
      if (skip) {
        entry.skipped = skip.detail ? `${skip.reason}: ${skip.detail}` : skip.reason
        harness.skip({ ref: alternative.ref, label: alternative.label }, skip.reason, skip.detail)
        continue
      }
      if (!harness.timeLeft()) {
        entry.skipped = 'time budget'
        continue
      }
      const done = await tryAlternative(harness, target, alternative, !untouched)
      untouched = false
      if (done.skipped) {
        entry.skipped = done.skipped
        continue
      }
      entry.reproduced = sameEffect(reference.before, reference.after, done.before, done.after)
      if (!entry.reproduced) entry.changed = done.changed ?? []
      if (entry.reproduced) return
    }
  }
  // Nothing around it to do the same: the gesture again on a second fresh load, so a failure never rests on one load.
  const failing = !target.essential && !effect.context && effect.changed.some((kind) => STRONG_CHANGES.includes(kind)) && target.alternatives.length === 0
  if (failing && harness.timeLeft()) {
    const again = await tryGesture(harness, target, effect.gesture, true)
    if (!again.tried.outcome) target.confirmed = effectOf(again.tried.changed).length > 0 || Boolean(again.tried.context)
  }
}

/** D2's 2.5.1 part on one page; also reads the motion listeners the 2.5.4 part needs, on the same first load. */
export async function runGesturesProbe(browser: Browser, url: string, options: ProbeOptions): Promise<{ record: ProbeRecord; motion: MotionListenerFact[] | undefined }> {
  const harness = new Harness(browser, url, options, { kind: 'gestures', version: GESTURES_VERSION, variant: GESTURES_VARIANT, limits: GESTURE_LIMITS, page: { clock: true, context: { hasTouch: true } } })
  let data: GesturesData | undefined
  let conditions: ProbeRecord['conditions'] | undefined
  let motion: MotionListenerFact[] | undefined
  try {
    const first = await harness.page()
    conditions = first.conditions
    const viewport = first.page.viewportSize() ?? first.conditions.viewport
    const listeners = await markPointerListeners(first)
    motion = await motionListeners(first)
    const found = await first.page.evaluate(findGestureTargets, { max: MAX_TARGETS * 2, drawing: DRAWING_WORDS.source })
    data = { viewport, touch: true, listeners, targets: [], loads: 0, actions: [], end: 'complete' }
    for (const candidate of found) {
      const target: GestureTarget = { ...candidate, tries: [], alternatives: [] }
      data.targets.push(target)
      if (data.targets.length > MAX_TARGETS || !harness.timeLeft()) {
        if (data.end === 'complete') data.end = harness.timeLeft() ? 'budget' : 'time'
        target.outcome = 'not-tried'
        target.reason = data.end
        continue
      }
      await exercise(harness, target)
    }
  } finally {
    await harness.close()
  }
  if (!data || !conditions) throw new Error('the first page did not load')
  data.loads = harness.loads
  data.actions = harness.actions
  const reason = data.end === 'budget' ? `budget reached (${MAX_TARGETS} elements)` : data.end === 'time' ? `time budget reached (${GESTURE_LIMITS.timeMs / 1000} s)` : undefined
  return { record: harness.record(data, conditions, reason), motion }
}

/**
 * The gestures probe as a step of the probe stage: two records, one per variant (`gestures` for 2.5.1, `device-motion`
 * for 2.5.4). A part that fails leaves a skipped record.
 */
export async function gesturesProbe(browser: Browser, url: string, options: ProbeOptions): Promise<ProbeRecord[]> {
  const started = Date.now()
  const records: ProbeRecord[] = []
  let motion: MotionListenerFact[] | undefined
  try {
    const result = await runGesturesProbe(browser, url, options)
    records.push(result.record)
    motion = result.motion
  } catch (error) {
    records.push(skippedRecord('gestures', GESTURES_VERSION, GESTURES_VARIANT, `probe failed: ${(error instanceof Error ? error.message : String(error)).split('\n')[0]}`, Date.now() - started))
  }
  records.push(await runDeviceMotionProbe(browser, url, options, motion))
  return records
}

export type { DeviceMotionData }
