import type { Page } from 'playwright-core'
import { decodePng } from '../pixels/png.ts'
import type { InPageElement, InPageRect } from './kit.ts'
import type { KeyStop, StopHook } from './keyboard.ts'
import { type PixelDiff, diffImages, imageHash } from './pixels.ts'

/**
 * Pixels for 2.4.7 Focus Visible and 2.4.11 Focus Not Obscured, taken during the keyboard walk.
 *
 * 2.4.7: at each forward stop, the element's box plus a 32 px margin is captured focused, then
 * twice after focus is taken away with blur() (the second capture marks pixels that move on
 * their own). When nothing changes in the box, the full viewport is captured focused and
 * blurred to confirm, as ACT oj04fd counts a change anywhere in the viewport.
 *
 * 2.4.11: at every stop, a 5×5 elementFromPoint grid over the part of the element in the
 * viewport. When every point hits author content outside the element, two pixel checks
 * confirm: the element painted magenta, then hidden; neither may change a pixel.
 */

export const FOCUS_MARGIN = 32
/** Above this share of the region, pixels that move on their own make "nothing changed" unknowable. */
export const NOISE_LIMIT = 0.1

export interface FocusPixels {
  /** The captured region, in viewport CSS px. */
  region: InPageRect
  /** The focused element's box inside the viewport. */
  box: InPageRect
  diff: PixelDiff
  /** Hashes of the focused and the blurred capture. */
  focused: string
  blurred: string
  /** The confirmation over the whole viewport, taken when nothing changed in the region. */
  viewport?: PixelDiff | undefined
  /** Why no comparison was made: outside the viewport, focus could not be restored... */
  skipped?: string | undefined
}

export interface Obscured {
  /** Grid points inside the viewport part of the element. */
  points: number
  /** Points where something else is on top. */
  covered: number
  /** What covers it most often, raised to its fixed or sticky layer. */
  by?: (InPageElement & { position: string; rect: InPageRect }) | undefined
  /** Pixels that changed when the element was painted, and when it was hidden. */
  painted?: number | undefined
  hidden?: number | undefined
}

export type FocusStop = KeyStop & { focus?: FocusPixels | undefined; obscured?: Obscured | undefined }

/** Runs in the page: the grid test over the focused element. Needs the kit. */
export function obscuredGrid(): Obscured {
  const kit = (window as unknown as { __rampaKit: { describe(el: Element): InPageElement; deepActive(): Element | null; rect(el: Element): InPageRect } }).__rampaKit
  const el = kit.deepActive()
  if (!el) return { points: 0, covered: 0 }
  const r = el.getBoundingClientRect()
  const x0 = Math.max(r.left, 0)
  const x1 = Math.min(r.right, window.innerWidth)
  const y0 = Math.max(r.top, 0)
  const y1 = Math.min(r.bottom, window.innerHeight)
  if (x1 - x0 < 1 || y1 - y0 < 1) return { points: 0, covered: 0 }
  const tally = new Map<Element, number>()
  let points = 0
  let covered = 0
  for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 5; j++) {
      const x = x0 + ((i + 0.5) * (x1 - x0)) / 5
      const y = y0 + ((j + 0.5) * (y1 - y0)) / 5
      let hit = document.elementFromPoint(x, y)
      while (hit?.shadowRoot) {
        const inner = hit.shadowRoot.elementFromPoint(x, y)
        if (!inner || inner === hit) break
        hit = inner
      }
      points++
      // An ancestor on top means the element lets the pointer through: not evidence of a cover.
      if (!hit || hit === el || el.contains(hit) || hit.contains(el)) continue
      covered++
      tally.set(hit, (tally.get(hit) ?? 0) + 1)
    }
  }
  const result: Obscured = { points, covered }
  const top = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
  if (top) {
    let layer: Element = top
    for (let a: Element | null = top; a && a !== document.body; a = a.parentElement) {
      const position = getComputedStyle(a).position
      if (position === 'fixed' || position === 'sticky') layer = a
    }
    result.by = { ...kit.describe(layer), position: getComputedStyle(layer).position, rect: kit.rect(layer) }
  }
  return result
}

/** Runs in the page: blur the focused element without the hooks counting it as the page's own doing. */
export function selfBlur(): void {
  const w = window as unknown as { __rampaSelf?: boolean; __rampaBlurred?: Element | null; __rampaKit: { deepActive(): Element | null } }
  w.__rampaSelf = true
  try {
    const el = w.__rampaKit.deepActive()
    w.__rampaBlurred = el
    ;(el as HTMLElement | null)?.blur?.()
    ;(document.activeElement as HTMLElement | null)?.blur?.()
  } finally {
    w.__rampaSelf = false
  }
}

/**
 * Runs in the page: gives focus back to the element selfBlur took it from, without scrolling,
 * so the next key press reaches the element's own handlers (a trap, a roving widget) as it
 * would have with no capture in between. Returns whether the element has focus again.
 */
export function selfRefocus(): boolean {
  const w = window as unknown as { __rampaSelf?: boolean; __rampaBlurred?: Element | null; __rampaKit: { deepActive(): Element | null } }
  const el = w.__rampaBlurred as HTMLElement | null | undefined
  if (!el?.focus) return false
  w.__rampaSelf = true
  try {
    el.focus({ preventScroll: true })
  } finally {
    w.__rampaSelf = false
  }
  return w.__rampaKit.deepActive() === el
}

/** Runs in the page: paint or hide the focused element for the obscured check, and put it back. */
export function styleFocused(mode: 'paint' | 'hide' | 'restore'): void {
  const w = window as unknown as { __rampaSelf?: boolean; __rampaKit: { deepActive(): Element | null }; __rampaStyled?: { el: HTMLElement; style: string | null } }
  if (mode === 'restore') {
    const saved = w.__rampaStyled
    if (!saved) return
    if (saved.style === null) saved.el.removeAttribute('style')
    else saved.el.setAttribute('style', saved.style)
    w.__rampaStyled = undefined
    // A hidden element loses focus; it gets it back, so the walk goes on from where Tab put it.
    if (w.__rampaKit.deepActive() !== saved.el) {
      w.__rampaSelf = true
      try {
        saved.el.focus({ preventScroll: true })
      } finally {
        w.__rampaSelf = false
      }
    }
    return
  }
  const el = (w.__rampaStyled?.el ?? w.__rampaKit.deepActive()) as HTMLElement | null
  if (!el) return
  if (!w.__rampaStyled) w.__rampaStyled = { el, style: el.getAttribute('style') }
  if (mode === 'paint') {
    el.style.setProperty('background', '#ff00ff', 'important')
    el.style.setProperty('outline', '4px solid #ff00ff', 'important')
    el.style.setProperty('color', '#00ff00', 'important')
  } else {
    el.style.setProperty('visibility', 'hidden', 'important')
  }
}

type Clip = { x: number; y: number; width: number; height: number }

async function capture(page: Page, clip?: Clip): Promise<Buffer> {
  return page.screenshot({ ...(clip ? { clip } : {}), animations: 'disabled', caret: 'hide', scale: 'css' })
}

function regionOf(rect: InPageRect, viewport: { width: number; height: number }): { region: Clip; box: Clip } | undefined {
  const x0 = Math.max(0, rect.x)
  const y0 = Math.max(0, rect.y)
  const x1 = Math.min(viewport.width, rect.x + rect.width)
  const y1 = Math.min(viewport.height, rect.y + rect.height)
  if (x1 - x0 < 1 || y1 - y0 < 1) return undefined
  const rx0 = Math.max(0, Math.floor(x0 - FOCUS_MARGIN))
  const ry0 = Math.max(0, Math.floor(y0 - FOCUS_MARGIN))
  const rx1 = Math.min(viewport.width, Math.ceil(x1 + FOCUS_MARGIN))
  const ry1 = Math.min(viewport.height, Math.ceil(y1 + FOCUS_MARGIN))
  return {
    region: { x: rx0, y: ry0, width: rx1 - rx0, height: ry1 - ry0 },
    box: { x: Math.round(x0 * 10) / 10, y: Math.round(y0 * 10) / 10, width: Math.round((x1 - x0) * 10) / 10, height: Math.round((y1 - y0) * 10) / 10 },
  }
}

const readRef = (page: Page) =>
  page.evaluate(() => {
    const kit = (window as unknown as { __rampaKit: { deepActive(): Element | null; cssPath(el: Element): string } }).__rampaKit
    const el = kit.deepActive()
    return el ? kit.cssPath(el) : null
  })

/** The grid test, then the two pixel checks when every point is covered. Focus stays where it is. */
async function obscuredCheck(page: Page, stop: FocusStop, focusedRegion?: { clip: Clip; png: Buffer }): Promise<void> {
  const grid = await page.evaluate(obscuredGrid)
  stop.obscured = grid
  if (grid.points === 0 || grid.covered < grid.points || !stop.rect) return
  const viewport = page.viewportSize() ?? { width: 1280, height: 800 }
  const area = regionOf(stop.rect, viewport)
  if (!area) return
  const clip = focusedRegion?.clip ?? area.region
  const base = decodePng(focusedRegion?.png ?? (await capture(page, clip)))
  try {
    await page.evaluate(styleFocused, 'paint' as const)
    const painted = decodePng(await capture(page, clip))
    await page.evaluate(styleFocused, 'restore' as const)
    await page.evaluate(styleFocused, 'hide' as const)
    const hidden = decodePng(await capture(page, clip))
    grid.painted = diffImages(painted, base).changed
    grid.hidden = diffImages(hidden, base).changed
  } finally {
    await page.evaluate(styleFocused, 'restore' as const)
  }
}

const drain = (page: Page) => page.evaluate(() => (window as unknown as { __rampaKit: { drain(): unknown[] } }).__rampaKit.drain())

/** Forward stops: 2.4.7 pixels and 2.4.11. Leaves focus back on the element, so the next Tab moves on from it. */
/**
 * Runs in the page: waits until scrolling stops (smooth scrolling, scroll libraries), at most
 * 1.5 s, and returns the focused element's box then, with the scroll position.
 */
export async function settledFocus(): Promise<{ rect: InPageRect; scroll: { x: number; y: number } } | null> {
  const kit = (window as unknown as { __rampaKit: { deepActive(): Element | null; rect(el: Element): InPageRect } }).__rampaKit
  const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)))
  const start = performance.now()
  let last = `${window.scrollX},${window.scrollY}`
  let still = 0
  while (performance.now() - start < 1500 && still < 4) {
    await frame()
    const now = `${window.scrollX},${window.scrollY}`
    still = now === last ? still + 1 : 0
    last = now
  }
  const el = kit.deepActive()
  return el ? { rect: kit.rect(el), scroll: { x: Math.round(window.scrollX), y: Math.round(window.scrollY) } } : null
}

/** The element's box once scrolling has settled; the stop keeps the settled box. */
async function settle(page: Page, stop: FocusStop): Promise<void> {
  const settled = await page.evaluate(settledFocus)
  if (!settled) return
  stop.rect = settled.rect
  stop.scroll = settled.scroll
}

export const forwardFocusHook: StopHook = async (page, keyStop) => {
  const stop = keyStop as FocusStop
  if (!stop.el || stop.frame) return
  await settle(page, stop)
  if (!stop.rect) return
  const viewport = page.viewportSize() ?? { width: 1280, height: 800 }
  const area = regionOf(stop.rect, viewport)
  if (!area) {
    await page.evaluate(obscuredGrid).then((grid) => {
      stop.obscured = grid
    })
    return
  }
  const focusedPng = await capture(page, area.region)
  await obscuredCheck(page, stop, { clip: area.region, png: focusedPng })
  await page.evaluate(selfBlur)
  const blurredPng = await capture(page, area.region)
  const noisePng = await capture(page, area.region)
  const focused = decodePng(focusedPng)
  const diff = diffImages(focused, decodePng(blurredPng), decodePng(noisePng))
  const pixels: FocusPixels = { region: area.region, box: area.box, diff, focused: imageHash(focusedPng), blurred: imageHash(blurredPng) }
  const back = await page.evaluate(selfRefocus)
  if (diff.changed === 0 && diff.masked / Math.max(1, diff.area) <= NOISE_LIMIT) {
    // Nothing changed near the element: confirm over the whole viewport, focused again.
    if (back && (await readRef(page)) === stop.el.ref) {
      const wholeFocused = decodePng(await capture(page))
      await page.evaluate(selfBlur)
      const wholeBlurred = decodePng(await capture(page))
      const wholeNoise = decodePng(await capture(page))
      pixels.viewport = diffImages(wholeFocused, wholeBlurred, wholeNoise)
      await page.evaluate(selfRefocus)
    } else {
      pixels.skipped = 'focus did not come back to the element for the viewport confirmation'
    }
  }
  stop.focus = pixels
  // What the page did in reaction to the probe's own blur and refocus is not the next stop's doing.
  await drain(page)
}

/** Backward stops: 2.4.11 only; Shift+Tab scrolls elements in from the top, under sticky headers. */
export const backwardFocusHook: StopHook = async (page, keyStop) => {
  const stop = keyStop as FocusStop
  if (!stop.el || stop.frame) return
  await settle(page, stop)
  await obscuredCheck(page, stop)
  await drain(page)
}
