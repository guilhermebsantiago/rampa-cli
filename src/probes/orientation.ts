import type { Browser, CDPSession, Page } from 'playwright-core'
import { axeSource } from '../engine/axe.ts'
import { decodePng } from '../pixels/png.ts'
import type { ProbeRecord } from '../snapshot/schema.ts'
import type { InPageElement, InPageIdentity } from './kit.ts'
import { settleInPage } from './kit.ts'
import { type ProbeOptions, openProbePage, skippedRecord } from './page.ts'
import { imageHash } from './pixels.ts'

/**
 * Orientation (1.3.4). The page is loaded upright and sideways at two window pairs (a 1280×800 window and a phone,
 * 390×844), each time with the screen orientation set over the DevTools protocol, so `screen.orientation`, the
 * `orientation` media feature and `window.orientation` (a shim where the browser has none) agree with the window.
 * Then the device is turned: the window swaps its sides, the screen orientation changes, `orientationchange` fires.
 * In each state the probe records, as facts:
 * - each element's own rotation about Z, from its computed `transform` and `rotate` (the rotation matrices), and
 *   which elements turn between the two orientations;
 * - the visible text: how much there is, how much a reader sees on top in the window, and which text one
 *   orientation shows that the other does not;
 * - a layer over most of the window, with its text (a "rotate your device" overlay), and ::before or ::after text;
 * - a quarter-size capture of the window: its hash and how much of it is not the background.
 * It also records `screen.orientation.lock()` calls, the web app manifest's `orientation`, and axe-core's
 * experimental css-orientation-lock, which only corroborates. Observe class: it resizes and turns the window.
 */

export const ORIENTATION_VERSION = '1'
const TIME_BUDGET_MS = 90_000
const SETTLE = { quietMs: 300, capMs: 3000 }
const MAX_ROTATIONS = 40
const MAX_SHOWN = 8

export type Orientation = 'portrait' | 'landscape'

export interface OrientationPair {
  /** '1280x800' or '390x844': the pair's name in the record and the coverage line. */
  name: string
  portrait: { width: number; height: number }
  /** A phone: mobile layout (the viewport meta applies), touch, its scale and a phone's user agent. */
  mobile: boolean
  scale: number
}

/** A window that turns (1280×800 and 800×1280) and a phone held upright and sideways (390×844 and 844×390). */
export const ORIENTATION_PAIRS: readonly OrientationPair[] = [
  { name: '1280x800', portrait: { width: 800, height: 1280 }, mobile: false, scale: 1 },
  { name: '390x844', portrait: { width: 390, height: 844 }, mobile: true, scale: 3 },
]

export interface OrientationElement {
  ref: string
  id: InPageIdentity
  tag: string
  label: string
  shadow?: boolean | undefined
}

/** An element whose own rotation about Z differs between the two states of one load. */
export interface RotatedElement extends OrientationElement {
  /** Its own rotation, in degrees in (-180, 180], in the state the page loaded in and after it was turned. */
  a: number
  b: number
  /** The computed `transform` and `rotate` in each state, cut to 120 characters: the rotation matrices. */
  ta: string
  tb: string
  /** Visible text characters inside it after the turn, and whether it holds media (img, svg, canvas, video). */
  chars: number
  media: boolean
  /** The share of the window its box covers after the turn. */
  area: number
}

/** A layer that covers most of the window: what a "rotate your device" overlay is. */
export interface OrientationCover extends OrientationElement {
  /** Its text, with the names of images inside, cut to 200 characters. */
  text: string
  chars: number
  /** Most of the points it covers are painted by an opaque background or an image: nothing under it shows. */
  opaque: boolean
  position: string
  /** The share of a 5×5 grid of points over the window that land in it. */
  share: number
}

export interface ShownText extends OrientationElement {
  text: string
  chars: number
}

export interface OrientationState {
  orientation: Orientation
  reached: 'load' | 'turn'
  /** What the page saw: the window, screen.orientation, the orientation media feature and window.orientation. */
  viewport: { width: number; height: number }
  screen: { type: string; angle: number }
  matchesPortrait: boolean
  windowOrientation: number | null
  /** The media feature and screen.orientation say what the probe set: the state can be compared. */
  ok: boolean
  /** Visible text in the whole document: characters and elements; characters a reader sees on top in the window. */
  chars: number
  elements: number
  viewChars: number
  /** Elements with a rotation of their own (not 0) in this state. */
  rotatedCount: number
  cover?: OrientationCover | undefined
  /** Text this state shows that the other state of the same load does not: the outermost elements, at most 8. */
  only: ShownText[]
  onlyChars: number
  /** Text drawn by ::before or ::after of html, body or a fixed layer. */
  pseudo: Array<OrientationElement & { which: string; text: string }>
  /** The window, captured at a quarter of its CSS size: hash, and the share of pixels that are not its main color. */
  shot?: { hash: string; ink: number } | undefined
}

export interface OrientationLoad {
  pair: string
  /** The orientation the page loaded in; the second state is after the device turned. */
  loaded: Orientation
  states: OrientationState[]
  /** Elements whose own rotation differs between the two states by 1° or more, at most 40. */
  rotations: RotatedElement[]
  error?: string | undefined
  ms: number
}

export interface OrientationData {
  pairs: Array<{ name: string; portrait: { width: number; height: number }; landscape: { width: number; height: number }; mobile: boolean; scale: number; userAgent?: string | undefined }>
  loads: OrientationLoad[]
  /** screen.orientation.lock() (and legacy lockOrientation) calls the page made, with their argument. */
  locks: Array<{ orientation: string; pair: string }>
  /** The web app manifest's orientation and display members, when the page links a manifest. */
  manifest?: { url: string; orientation?: string | undefined; display?: string | undefined; error?: string | undefined } | undefined
  /** axe-core's experimental css-orientation-lock, run on the first probe page: corroboration only. */
  axe?:
    | {
        outcome: 'violation' | 'pass' | 'incomplete' | 'inapplicable' | 'error'
        /** The nodes it reports (the root element, for a style sheet) and the related nodes it names: the elements the rule turns. */
        nodes: Array<{ ref?: string | undefined; target: string; related?: Array<{ ref?: string | undefined; target: string }> | undefined }>
        error?: string | undefined
      }
    | undefined
  end: 'complete' | 'time'
}

interface Window$ {
  __rampaKit: { describe(el: Element): InPageElement; visible(el: Element): boolean }
  __rampaOrient?: {
    locks: Array<{ orientation: string; at: number }>
    seen?: Element[]
    rendered?: WeakSet<Element>
    angles?: Map<Element, { angle: number; text: string }>
  }
}

/**
 * Init script, before any page script: records orientation locks, and gives a browser with no `window.orientation`
 * (desktop Chromium) one that follows `screen.orientation`, with `orientationchange`, as a phone's has.
 */
export function installOrientationHooks(): void {
  const w = window as unknown as Window & { __rampaOrient?: { locks: Array<{ orientation: string; at: number }> } }
  if (w.__rampaOrient) return
  const state = { locks: [] as Array<{ orientation: string; at: number }> }
  w.__rampaOrient = state
  const record = (value: unknown) => state.locks.push({ orientation: String(value).slice(0, 40), at: Date.now() })
  if (typeof ScreenOrientation !== 'undefined' && typeof ScreenOrientation.prototype.lock === 'function') {
    const lock = ScreenOrientation.prototype.lock
    ScreenOrientation.prototype.lock = function (this: ScreenOrientation, orientation: OrientationLockType) {
      record(orientation)
      return lock.call(this, orientation)
    } as typeof lock
  }
  const legacy = screen as unknown as Record<string, unknown>
  for (const name of ['lockOrientation', 'mozLockOrientation', 'msLockOrientation']) {
    const original = legacy[name]
    if (typeof original === 'function') {
      legacy[name] = function (this: Screen, orientation: unknown) {
        record(orientation)
        return (original as (o: unknown) => unknown).call(this, orientation)
      }
    }
  }
  if (!('orientation' in window) && screen.orientation) {
    let handler: ((event: Event) => unknown) | null = null
    Object.defineProperty(window, 'orientation', {
      configurable: true,
      enumerable: true,
      get: () => {
        const angle = screen.orientation.angle
        return angle === 270 ? -90 : angle
      },
    })
    Object.defineProperty(window, 'onorientationchange', {
      configurable: true,
      enumerable: true,
      get: () => handler,
      set: (value: unknown) => {
        handler = typeof value === 'function' ? (value as (event: Event) => unknown) : null
      },
    })
    screen.orientation.addEventListener('change', () => {
      const event = new Event('orientationchange')
      window.dispatchEvent(event)
      handler?.call(window, event)
    })
  }
}

export interface MeasureArgs {
  expect: Orientation
  reached: 'load' | 'turn'
  compare: boolean
  maxRotations: number
  maxShown: number
}

export interface MeasureResult {
  state: Omit<OrientationState, 'shot'>
  rotations: RotatedElement[]
  before?: { only: ShownText[]; onlyChars: number } | undefined
}

/**
 * Runs in the page; needs the kit. Measures one state. With `compare`, the state before (kept in the page) is
 * compared with this one: elements whose rotation changed, and text one state shows that the other does not.
 * Self-contained: Playwright serializes it with toString().
 */
export function measureOrientation(args: MeasureArgs): MeasureResult {
  const w = window as unknown as Window$
  const kit = w.__rampaKit
  const store = (w.__rampaOrient ??= { locks: [] })
  const vw = window.innerWidth
  const vh = window.innerHeight
  const collapse = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim()
  const cut = (value: string, n: number) => (value.length > n ? `${value.slice(0, n - 1)}…` : value)
  const describe = (el: Element): OrientationElement => {
    const d = kit.describe(el)
    return { ref: d.ref, id: d.id, tag: d.tag, label: d.label, ...(d.shadow ? { shadow: true } : {}) }
  }
  const SKIP = new Set(['script', 'style', 'noscript', 'template', 'head', 'title', 'meta', 'link'])
  const MEDIA = 'img,svg,canvas,video,picture,object,embed,iframe'

  // Rotation about Z from the computed transform (a 2D or 3D matrix) and the rotate property, in degrees.
  const angleOf = (style: CSSStyleDeclaration): { angle: number; text: string } => {
    let angle = 0
    const transform = style.transform
    if (transform && transform !== 'none') {
      const numbers = (/\(([^)]*)\)/.exec(transform)?.[1] ?? '').split(',').map((v) => Number.parseFloat(v))
      if (transform.startsWith('matrix3d') && numbers.length === 16) angle += (Math.atan2(numbers[1] ?? 0, numbers[0] ?? 1) * 180) / Math.PI
      else if (numbers.length === 6) angle += (Math.atan2(numbers[1] ?? 0, numbers[0] ?? 1) * 180) / Math.PI
    }
    const rotate = (style as CSSStyleDeclaration & { rotate?: string }).rotate
    if (rotate && rotate !== 'none') {
      const parts = rotate.trim().split(/\s+/)
      const last = parts[parts.length - 1] ?? ''
      const unit = /^(-?[\d.e+-]+)(deg|rad|turn|grad)$/.exec(last)
      // `rotate: 90deg` and `rotate: z 90deg` turn about Z; `0 0 1 90deg` too; x and y axes do not.
      const aboutZ = parts.length === 1 || parts[0] === 'z' || (parts.length === 4 && Number(parts[0]) === 0 && Number(parts[1]) === 0 && Number(parts[2]) > 0)
      const flipped = parts.length === 4 && Number(parts[2]) < 0
      if (unit && (aboutZ || flipped)) {
        const value = Number.parseFloat(unit[1] ?? '0')
        const deg = unit[2] === 'rad' ? (value * 180) / Math.PI : unit[2] === 'turn' ? value * 360 : unit[2] === 'grad' ? value * 0.9 : value
        angle += flipped ? -deg : deg
      }
    }
    let normal = angle % 360
    if (normal > 180) normal -= 360
    if (normal <= -180) normal += 360
    const text = cut(`${transform && transform !== 'none' ? transform : ''}${rotate && rotate !== 'none' ? ` rotate: ${rotate}` : ''}`.trim(), 120)
    return { angle: Math.round(normal * 100) / 100, text }
  }

  // Every element, once: rendered or not, its own rotation, its own text.
  const all = Array.from(document.querySelectorAll('*')).slice(0, 8000)
  const rendered = new WeakSet<Element>()
  const angles = new Map<Element, { angle: number; text: string }>()
  const seen: Element[] = []
  const ownChars = new Map<Element, number>()
  let chars = 0
  let viewChars = 0
  for (const el of all) {
    if (SKIP.has(el.localName)) continue
    if (!kit.visible(el)) continue
    const r = el.getBoundingClientRect()
    if (r.width <= 0 && r.height <= 0) continue
    rendered.add(el)
    const style = getComputedStyle(el)
    if ((style.transform && style.transform !== 'none') || ((style as CSSStyleDeclaration & { rotate?: string }).rotate ?? 'none') !== 'none') {
      const a = angleOf(style)
      if (Math.abs(a.angle) >= 0.5) angles.set(el, a)
    }
    let own = ''
    for (const node of Array.from(el.childNodes)) if (node.nodeType === Node.TEXT_NODE) own += node.textContent ?? ''
    own = collapse(own)
    if (!own) continue
    // Visually hidden text (a 1 px box) is for screen readers; it does not show in either orientation.
    if (r.width <= 1 || r.height <= 1) continue
    seen.push(el)
    ownChars.set(el, own.length)
    chars += own.length
    if (r.right > 0 && r.bottom > 0 && r.left < vw && r.top < vh) {
      const x = Math.min(Math.max(r.left + r.width / 2, 1), vw - 1)
      const y = Math.min(Math.max(r.top + r.height / 2, 1), vh - 1)
      const hit = document.elementFromPoint(x, y)
      if (hit && (hit === el || el.contains(hit) || hit.contains(el))) viewChars += own.length
    }
  }

  // A layer over most of the window: the outermost fixed element, or an absolute one as big as the window.
  const layerOf = (hit: Element | null): Element | null => {
    let layer: Element | null = null
    for (let el = hit; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
      const position = getComputedStyle(el).position
      if (position === 'fixed') layer = el
      else if (position === 'absolute' && !layer) {
        const r = el.getBoundingClientRect()
        if (r.width * r.height >= 0.8 * vw * vh) layer = el
      }
    }
    return layer
  }
  const alpha = (color: string): number => {
    const m = /rgba?\(([^)]*)\)/.exec(color)
    if (!m) return color === 'transparent' ? 0 : 1
    const parts = (m[1] ?? '').split(/[,\s/]+/).filter(Boolean)
    return parts.length >= 4 ? Number.parseFloat(parts[3] ?? '1') : 1
  }
  const counts = new Map<Element, { points: number; opaque: number }>()
  const POINTS = 5
  for (let i = 0; i < POINTS; i++) {
    for (let j = 0; j < POINTS; j++) {
      const x = ((i + 0.5) / POINTS) * vw
      const y = ((j + 0.5) / POINTS) * vh
      const hit = document.elementFromPoint(x, y)
      const layer = layerOf(hit)
      if (!layer) continue
      let opaque = false
      for (let el = hit; el; el = el.parentElement) {
        const style = getComputedStyle(el)
        if (alpha(style.backgroundColor) >= 0.9 || style.backgroundImage !== 'none' || el.matches('img,canvas,video,svg')) {
          opaque = true
          break
        }
        if (el === layer) break
      }
      const entry = counts.get(layer) ?? { points: 0, opaque: 0 }
      entry.points++
      if (opaque) entry.opaque++
      counts.set(layer, entry)
    }
  }
  let cover: OrientationCover | undefined
  const best = [...counts.entries()].sort((p, q) => q[1].points - p[1].points)[0]
  if (best && best[1].points >= 0.8 * POINTS * POINTS) {
    const [layer, entry] = best
    const names = Array.from(layer.querySelectorAll('img[alt],[aria-label],[role=img][aria-label],svg title'))
      .map((el) => collapse(el.getAttribute('alt') ?? el.getAttribute('aria-label') ?? el.textContent))
      .filter(Boolean)
    const text = collapse([(layer as HTMLElement).innerText ?? layer.textContent, ...names].join(' '))
    let opacity = 1
    for (let el: Element | null = layer; el; el = el.parentElement) opacity *= Number.parseFloat(getComputedStyle(el).opacity) || 0
    cover = {
      ...describe(layer),
      text: cut(text, 200),
      chars: collapse((layer as HTMLElement).innerText ?? layer.textContent).length,
      opaque: entry.opaque >= 0.8 * entry.points && opacity >= 0.9,
      position: getComputedStyle(layer).position,
      share: Math.round((entry.points / (POINTS * POINTS)) * 100) / 100,
    }
  }

  // Text drawn by ::before or ::after of html, body and fixed layers ("Please turn your device" in a pseudo-element).
  const pseudo: OrientationState['pseudo'] = []
  const hosts = [document.documentElement, document.body, ...all.filter((el) => rendered.has(el) && getComputedStyle(el).position === 'fixed').slice(0, 30)].filter(
    (el): el is HTMLElement => el instanceof HTMLElement,
  )
  for (const host of hosts) {
    for (const which of ['::before', '::after']) {
      const style = getComputedStyle(host, which)
      const content = style.content
      if (!content || content === 'none' || content === 'normal' || style.display === 'none' || style.visibility !== 'visible') continue
      const text = collapse(/^"(.*)"$/s.exec(content)?.[1] ?? '')
      if (text.length >= 2) pseudo.push({ ...describe(host), which, text: cut(text, 200) })
    }
  }

  const screenType = screen.orientation?.type ?? ''
  const matchesPortrait = matchMedia('(orientation: portrait)').matches
  const wo = (window as unknown as { orientation?: unknown }).orientation
  const state: Omit<OrientationState, 'shot'> = {
    orientation: args.expect,
    reached: args.reached,
    viewport: { width: vw, height: vh },
    screen: { type: screenType, angle: screen.orientation?.angle ?? 0 },
    matchesPortrait,
    windowOrientation: typeof wo === 'number' ? wo : null,
    ok: matchesPortrait === (args.expect === 'portrait') && screenType.startsWith(args.expect),
    chars,
    elements: seen.length,
    viewChars,
    rotatedCount: angles.size,
    ...(cover ? { cover } : {}),
    only: [],
    onlyChars: 0,
    pseudo,
  }

  const rotations: RotatedElement[] = []
  let before: { only: ShownText[]; onlyChars: number } | undefined
  if (args.compare && store.rendered && store.angles && store.seen) {
    // Elements that turned: rendered in both states, with a different rotation of their own.
    const prevRendered = store.rendered
    const prevAngles = store.angles
    const candidates = new Set<Element>([...prevAngles.keys(), ...angles.keys()])
    const charsInside = (el: Element) => seen.reduce((sum, t) => (el.contains(t) ? sum + (ownChars.get(t) ?? 0) : sum), 0)
    for (const el of candidates) {
      if (!prevRendered.has(el) || !rendered.has(el)) continue
      const a = prevAngles.get(el) ?? { angle: 0, text: '' }
      const b = angles.get(el) ?? { angle: 0, text: '' }
      let diff = Math.abs(a.angle - b.angle) % 360
      if (diff > 180) diff = 360 - diff
      if (diff < 1) continue
      const r = el.getBoundingClientRect()
      const visibleArea = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0))
      rotations.push({
        ...describe(el),
        a: a.angle,
        b: b.angle,
        ta: a.text,
        tb: b.text,
        chars: charsInside(el),
        media: el.matches(MEDIA) || el.querySelector(MEDIA) !== null,
        area: Math.round((visibleArea / (vw * vh)) * 100) / 100,
      })
    }
    rotations.sort((p, q) => q.chars - p.chars || q.area - p.area)
    rotations.splice(args.maxRotations)

    // Text one state shows and the other does not, as its outermost elements.
    const prevSeen = store.seen
    const nowSet = new Set(seen)
    const prevSet = new Set(prevSeen)
    const outermost = (list: Element[], set: Set<Element>) => list.filter((el) => {
      for (let p = el.parentElement; p; p = p.parentElement) if (set.has(p)) return false
      return true
    })
    const shown = (list: Element[], set: Set<Element>, own: (el: Element) => number): { only: ShownText[]; onlyChars: number } => {
      const total = list.reduce((sum, el) => sum + own(el), 0)
      const top = outermost(list, set).slice(0, args.maxShown).map((el) => {
        const text = collapse((el as HTMLElement).innerText ?? el.textContent)
        return { ...describe(el), text: cut(text, 200), chars: text.length }
      })
      return { only: top, onlyChars: total }
    }
    const onlyNow = seen.filter((el) => !prevSet.has(el))
    const onlyBefore = prevSeen.filter((el) => !nowSet.has(el))
    const now = shown(onlyNow, new Set(onlyNow), (el) => ownChars.get(el) ?? 0)
    state.only = now.only
    state.onlyChars = now.onlyChars
    const own = (el: Element) => {
      let text = ''
      for (const node of Array.from(el.childNodes)) if (node.nodeType === Node.TEXT_NODE) text += node.textContent ?? ''
      return collapse(text).length
    }
    before = shown(onlyBefore, new Set(onlyBefore), own)
  }
  store.rendered = rendered
  store.angles = angles
  store.seen = seen
  return { state, rotations, ...(before ? { before } : {}) }
}

/** The pair's window in an orientation. */
export function sizeOf(pair: OrientationPair, orientation: Orientation): { width: number; height: number } {
  return orientation === 'portrait' ? pair.portrait : { width: pair.portrait.height, height: pair.portrait.width }
}

/** Sets the window, the screen and its orientation over the DevTools protocol; both pairs are phones turned from upright (angle 0) to 90. */
async function orient(cdp: CDPSession, pair: OrientationPair, orientation: Orientation): Promise<void> {
  const size = sizeOf(pair, orientation)
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: size.width,
    height: size.height,
    deviceScaleFactor: pair.scale,
    mobile: pair.mobile,
    screenWidth: size.width,
    screenHeight: size.height,
    screenOrientation: orientation === 'portrait' ? { type: 'portraitPrimary', angle: 0 } : { type: 'landscapePrimary', angle: 90 },
  })
}

/** The window at a quarter of its CSS size: its hash, and the share of pixels that are not its most common color. */
async function capture(cdp: CDPSession, page: Page, scale: number): Promise<OrientationState['shot']> {
  try {
    const box = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: box.width, height: box.height, scale: 0.25 / scale } })
    const bytes = Buffer.from(shot.data, 'base64')
    const image = decodePng(bytes)
    const counts = new Map<number, number>()
    const total = image.width * image.height
    for (let i = 0; i < total; i++) {
      const at = i * 4
      // Colors to 4 bits a channel: anti-aliasing and gradients count as the color they are near.
      const key = (((image.data[at] ?? 0) >> 4) << 8) | (((image.data[at + 1] ?? 0) >> 4) << 4) | ((image.data[at + 2] ?? 0) >> 4)
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    const main = Math.max(0, ...counts.values())
    return { hash: imageHash(bytes), ink: total > 0 ? Math.round(((total - main) / total) * 1000) / 1000 : 0 }
  } catch {
    return undefined
  }
}

/** Runs in the page: the manifest the page links, read with a GET (the guard lets it through), and its orientation. */
export async function readManifest(): Promise<OrientationData['manifest']> {
  const link = document.querySelector('link[rel~="manifest"][href]') as HTMLLinkElement | null
  if (!link) return undefined
  const url = link.href
  try {
    const response = await fetch(url, { credentials: 'same-origin' })
    if (!response.ok) return { url, error: `HTTP ${response.status}` }
    const json = (await response.json()) as { orientation?: unknown; display?: unknown }
    return {
      url,
      ...(typeof json.orientation === 'string' ? { orientation: json.orientation.slice(0, 40) } : {}),
      ...(typeof json.display === 'string' ? { display: json.display.slice(0, 40) } : {}),
    }
  } catch (error) {
    return { url, error: (error instanceof Error ? error.message : String(error)).slice(0, 120) }
  }
}

/** axe-core's experimental css-orientation-lock on this page, with the related nodes it names: corroboration, never a verdict. */
async function axeOrientationLock(page: Page): Promise<OrientationData['axe']> {
  try {
    await page.evaluate(await axeSource())
    const result = await page.evaluate(async () => {
      type Check = { relatedNodes?: Array<{ target: unknown[] }> }
      type AxeNode = { target: unknown[]; any?: Check[]; all?: Check[]; none?: Check[] }
      const axe = (window as unknown as { axe: { run(context: unknown, options: unknown): Promise<Record<string, Array<{ nodes: AxeNode[] }>>> } }).axe
      const kit = (window as unknown as { __rampaKit: { cssPath(el: Element): string } }).__rampaKit
      const out = await axe.run(document, { runOnly: { type: 'rule', values: ['css-orientation-lock'] } })
      const refOf = (selector: string) => {
        try {
          const el = document.querySelector(selector)
          return el ? kit.cssPath(el) : undefined
        } catch {
          return undefined
        }
      }
      const describe = (node: AxeNode) => {
        const target = String(node.target[0] ?? '')
        // The related nodes sit in the checks: for this rule, the elements a style sheet turns with the orientation.
        const checks = [...(node.any ?? []), ...(node.all ?? []), ...(node.none ?? [])]
        const related = checks.flatMap((check) => check.relatedNodes ?? []).slice(0, 10).map((r) => {
          const t = String(r.target[0] ?? '')
          return { target: t, ref: refOf(t) }
        })
        return { target, ref: refOf(target), ...(related.length > 0 ? { related } : {}) }
      }
      for (const key of ['violations', 'incomplete', 'passes'] as const) {
        const nodes = (out[key] ?? []).flatMap((rule) => rule.nodes)
        if (nodes.length > 0) return { outcome: key === 'violations' ? 'violation' : key === 'incomplete' ? 'incomplete' : 'pass', nodes: nodes.slice(0, 10).map(describe) }
      }
      return { outcome: (out.inapplicable ?? []).length > 0 ? 'inapplicable' : 'pass', nodes: [] }
    })
    return result as OrientationData['axe']
  } catch (error) {
    return { outcome: 'error', nodes: [], error: (error instanceof Error ? error.message : String(error)).split('\n')[0]?.slice(0, 160) }
  }
}

/** A phone's user agent for the 390×844 pair, with the browser's own major version: some pages show their "rotate" overlay only to phones. */
function mobileUserAgent(browser: Browser): string {
  const major = browser.version().split('.')[0] ?? '120'
  return `Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Mobile Safari/537.36`
}

interface LoadShared {
  data: OrientationData
  guard: ProbeRecord['guard']
  userAgent?: string | undefined
}

/** What one load's guard did, added to the record's: each blocked request, navigation and dialog once. */
function mergeGuard(into: ProbeRecord['guard'], from: ProbeRecord['guard'], offset: number): void {
  const key = (entry: { url?: string; message?: string; method?: string; type?: string }) => `${entry.method ?? entry.type ?? ''} ${entry.url ?? entry.message ?? ''}`
  const blocked = new Set(into.blocked.map(key))
  for (const entry of from.blocked) if (!blocked.has(key(entry)) && into.blocked.length < 200) into.blocked.push({ ...entry, at: entry.at + offset })
  for (const entry of from.navigations) if (into.navigations.length < 50) into.navigations.push({ ...entry, at: entry.at + offset })
  for (const entry of from.dialogs) if (into.dialogs.length < 50) into.dialogs.push({ ...entry, at: entry.at + offset })
}

/** One fresh load in one orientation, measured, then turned and measured again. */
async function runLoad(browser: Browser, url: string, options: ProbeOptions, pair: OrientationPair, loaded: Orientation, shared: LoadShared, offset: number): Promise<OrientationLoad> {
  const started = Date.now()
  const result: OrientationLoad = { pair: pair.name, loaded, states: [], rotations: [], ms: 0 }
  const first = shared.data.loads.length === 0
  let cdp: CDPSession | undefined
  const userAgent = pair.mobile ? shared.userAgent : undefined
  const probe = await openProbePage(browser, url, options, {
    variant: 'orientation',
    viewport: sizeOf(pair, loaded),
    context: { isMobile: pair.mobile, hasTouch: pair.mobile, deviceScaleFactor: pair.scale, ...(userAgent ? { userAgent } : {}) },
    beforeLoad: async (page, context) => {
      await context.addInitScript(installOrientationHooks)
      cdp = await context.newCDPSession(page)
      await orient(cdp, pair, loaded)
    },
  })
  try {
    const page = probe.page
    if (!cdp) throw new Error('no DevTools session')
    const session = cdp
    const turned: Orientation = loaded === 'portrait' ? 'landscape' : 'portrait'
    const before = await page.evaluate<MeasureResult, MeasureArgs>(measureOrientation, { expect: loaded, reached: 'load', compare: false, maxRotations: MAX_ROTATIONS, maxShown: MAX_SHOWN })
    const loadedState: OrientationState = { ...before.state, shot: await capture(session, page, pair.scale) }
    if (first) {
      shared.data.manifest = await page.evaluate(readManifest).catch(() => undefined)
      shared.data.axe = await axeOrientationLock(page)
    }
    // The device turns: the window swaps its sides and the screen orientation changes, as on a phone.
    await orient(session, pair, turned)
    await page.waitForTimeout(150)
    await page.evaluate(settleInPage, SETTLE)
    const after = await page.evaluate<MeasureResult, MeasureArgs>(measureOrientation, { expect: turned, reached: 'turn', compare: true, maxRotations: MAX_ROTATIONS, maxShown: MAX_SHOWN })
    if (after.before) {
      loadedState.only = after.before.only
      loadedState.onlyChars = after.before.onlyChars
    }
    result.states = [loadedState, { ...after.state, shot: await capture(session, page, pair.scale) }]
    result.rotations = after.rotations
    const locks = await page.evaluate(() => (window as unknown as { __rampaOrient?: { locks: Array<{ orientation: string }> } }).__rampaOrient?.locks ?? [])
    for (const lock of locks) {
      if (!shared.data.locks.some((seen) => seen.orientation === lock.orientation && seen.pair === pair.name)) shared.data.locks.push({ orientation: lock.orientation, pair: pair.name })
    }
    return result
  } catch (error) {
    result.error = (error instanceof Error ? error.message : String(error)).split('\n')[0]?.slice(0, 200)
    return result
  } finally {
    result.ms = Date.now() - started
    mergeGuard(shared.guard, probe.guard.log, offset)
    await cdp?.detach().catch(() => undefined)
    await probe.context.close()
  }
}

/** 1.3.4: both pairs, each loaded upright and then sideways, and turned after each load. */
export async function runOrientationProbe(browser: Browser, url: string, options: ProbeOptions): Promise<ProbeRecord> {
  const started = Date.now()
  const userAgent = options.browserOptions?.userAgent ? undefined : mobileUserAgent(browser)
  const data: OrientationData = {
    pairs: ORIENTATION_PAIRS.map((pair) => ({
      name: pair.name,
      portrait: pair.portrait,
      landscape: sizeOf(pair, 'landscape'),
      mobile: pair.mobile,
      scale: pair.scale,
      ...(pair.mobile && userAgent ? { userAgent: 'phone (Android Chrome)' } : {}),
    })),
    loads: [],
    locks: [],
    end: 'complete',
  }
  const guard: ProbeRecord['guard'] = { blocked: [], navigations: [], dialogs: [] }
  const shared: LoadShared = { data, guard, userAgent }
  for (const pair of ORIENTATION_PAIRS) {
    for (const loaded of ['portrait', 'landscape'] as const) {
      if (Date.now() - started > TIME_BUDGET_MS) {
        data.end = 'time'
        break
      }
      const offset = Date.now() - started
      const load = await runLoad(browser, url, options, pair, loaded, shared, offset).catch(
        (error: unknown): OrientationLoad => ({ pair: pair.name, loaded, states: [], rotations: [], error: (error instanceof Error ? error.message : String(error)).split('\n')[0]?.slice(0, 200), ms: 0 }),
      )
      data.loads.push(load)
    }
  }
  const measured = data.loads.filter((load) => load.states.length === 2)
  if (measured.length === 0) {
    const reason = data.loads.find((load) => load.error)?.error ?? 'no orientation could be measured'
    return { ...skippedRecord('orientation', ORIENTATION_VERSION, 'orientation', `probe failed: ${reason}`, Date.now() - started), guard, data }
  }
  const failed = data.loads.length - measured.length
  const partial = data.end === 'time' || failed > 0
  return {
    kind: 'orientation',
    version: ORIENTATION_VERSION,
    conditions: {
      viewport: ORIENTATION_PAIRS[0]?.portrait ?? { width: 800, height: 1280 },
      deviceScaleFactor: 1,
      browser: `${browser.browserType().name()} ${browser.version()} (headless)`,
      variant: 'orientation',
      ...(options.browserOptions?.colorScheme ? { colorScheme: options.browserOptions.colorScheme } : {}),
      ...(options.browserOptions?.reducedMotion ? { reducedMotion: true } : {}),
    },
    status: partial ? 'partial' : 'complete',
    ...(data.end === 'time' ? { reason: `time budget reached (${TIME_BUDGET_MS / 1000} s)` } : failed > 0 ? { reason: `${failed} of ${data.loads.length} load(s) could not be measured` } : {}),
    guard,
    durationMs: Date.now() - started,
    data,
  }
}

/** The orientation probe as a step of the probe stage; a probe that fails leaves a skipped record. */
export async function orientationProbe(browser: Browser, url: string, options: ProbeOptions): Promise<ProbeRecord[]> {
  const started = Date.now()
  try {
    return [await runOrientationProbe(browser, url, options)]
  } catch (error) {
    return [skippedRecord('orientation', ORIENTATION_VERSION, 'orientation', `probe failed: ${(error instanceof Error ? error.message : String(error)).split('\n')[0]}`, Date.now() - started)]
  }
}
