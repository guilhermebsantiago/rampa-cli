import type { EngineResults } from '../core/types.ts'
import { type Rgba, measurePair } from '../pixels/pair-contrast.ts'
import { tryDecodePng } from '../pixels/png.ts'
import { PIXEL_KINDS, type PixelContrastFact, type PixelContrastRun, type PixelKind, setPixelFact } from '../snapshot/pixel-contrast.ts'
import type { A11yNode } from '../snapshot/schema.ts'
import { indexTree } from '../snapshot/tree.ts'
import type { CaptureDriver } from './image-capture.ts'

/**
 * Measures contrast from pixels where no style sheet can say what it is (docs/rules.md, "Pixel rules"):
 *
 * - text axe-core's color-contrast left undecided, because of a background image, a gradient, an element
 *   over or under it, or a pseudo-element (WCAG 1.4.3);
 * - the placeholder of an empty field, which axe-core does not check (1.4.3).
 *
 * Each element is scrolled into view and captured twice: as rendered, and with its own text (the
 * placeholder) made transparent, everything else as it was. pixels/pair-contrast.ts compares
 * the two. The results are facts on the node (snapshot/pixel-contrast.ts); the rules decide. `rampa check`
 * (`collectWeb`) and a test's own page (`collectPage`) share this module, as they share image-capture.ts.
 */

/** Elements measured at most per page, by kind. */
export const CONTRAST_LIMITS: Record<PixelKind, number> = { text: 20, placeholder: 10 }
/** The whole measurement stops after this long on one page; what is left is counted as left out. */
export const CONTRAST_BUDGET_MS = 6000
const WAIT_MS = 1500
const VERSION = '1'

/**
 * axe-core's reasons for an undecided color-contrast that pixels can settle. Left out: a single character
 * or symbols (shortTextContent, nonBmp), text the same color as its background (equalRatio, usually hidden
 * on purpose) and an empty field (emptyValue): those stay with axe-core, to review.
 */
export const MEASURED_AXE_REASONS: ReadonlySet<string> = new Set([
  'bgImage',
  'bgGradient',
  'imgNode',
  'bgOverlap',
  'complexTextShadows',
  'fgAlpha',
  'elmPartiallyObscured',
  'elmPartiallyObscuring',
  'outsideViewport',
  'pseudoContent',
  'colorParse',
  'default',
])

export interface ContrastLayers {
  /** Marks fixed and sticky layers once; returns how many there are. */
  mark(): Promise<number>
  /** Hides the layers that do not hold the element about to be captured. */
  show(ref: string): Promise<void>
  restore(): Promise<void>
}

/** A screenshot of a box of the viewport, in CSS px: cheaper than an element screenshot, which `rampa check` can take. */
export interface ContrastDriver extends CaptureDriver {
  screenshotBox?(box: { x: number; y: number; width: number; height: number }): Promise<Uint8Array | undefined>
}

export interface ContrastCaptureOptions {
  limits?: Partial<Record<PixelKind, number>> | undefined
  budgetMs?: number | undefined
  /** rampa check hides cookie banners and sticky headers that would paint over the element. */
  layers?: ContrastLayers | undefined
}

interface Target {
  kind: PixelKind
  node: A11yNode
  /** The element captured: the text's element, or the field. */
  capture: string
  axeReason?: string | undefined
  exempt?: string | undefined
}

export async function captureContrast(driver: ContrastDriver, root: A11yNode, engine: EngineResults, options: ContrastCaptureOptions = {}): Promise<void> {
  const index = indexTree(root)
  const limits = { ...CONTRAST_LIMITS, ...options.limits }
  const targets: Record<PixelKind, Target[]> = { text: [], placeholder: [] }

  const seen = new Set<string>()
  for (const rule of engine.rules) {
    if (rule.ruleId !== 'color-contrast' || rule.outcome !== 'incomplete') continue
    for (const result of rule.nodes) {
      const node = result.ref ? index.get(result.ref)?.node : undefined
      // axe-core gives no key for its default reason ("Unable to determine contrast ratio").
      const reason = result.reasonKey ?? 'default'
      if (!node || seen.has(node.ref) || !MEASURED_AXE_REASONS.has(reason)) continue
      if (node.states.includes('hidden') || node.states.includes('disabled')) continue
      seen.add(node.ref)
      targets.text.push({ kind: 'text', node, capture: node.ref, axeReason: reason })
    }
  }
  const found = await driver.evaluate(findContrastTargetsInPage, null).catch(() => ({ placeholders: [] }) as FoundTargets)
  for (const ref of found.placeholders) {
    const node = index.get(ref)?.node
    if (node && !node.states.includes('hidden')) targets.placeholder.push({ kind: 'placeholder', node, capture: ref })
  }
  if (PIXEL_KINDS.every((kind) => targets[kind].length === 0)) return

  const run: PixelContrastRun = {
    version: VERSION,
    limits,
    found: { text: targets.text.length, placeholder: targets.placeholder.length },
    measured: { text: 0, placeholder: 0 },
    leftOut: { text: 0, placeholder: 0 },
  }
  const deadline = Date.now() + (options.budgetMs ?? CONTRAST_BUDGET_MS)
  const layers = options.layers && (await options.layers.mark().catch(() => 0)) > 0 ? options.layers : undefined
  try {
    for (const kind of PIXEL_KINDS) {
      let taken = 0
      for (const target of targets[kind]) {
        if (target.exempt) {
          setPixelFact(target.node, { kind, status: 'exempt', reason: target.exempt })
          continue
        }
        if (taken >= limits[kind]) {
          run.leftOut[kind]++
          run.stopped ??= 'limit'
          continue
        }
        if (Date.now() >= deadline) {
          run.leftOut[kind]++
          run.stopped = 'time'
          continue
        }
        taken++
        run.measured[kind]++
        await layers?.show(target.capture).catch(() => undefined)
        setPixelFact(target.node, await measureTarget(driver, target, Math.max(0, Math.min(WAIT_MS, deadline - Date.now()))))
      }
    }
  } finally {
    await layers?.restore().catch(() => undefined)
  }
  root.native.pixelContrastRun = run
}

async function measureTarget(driver: ContrastDriver, target: Target, waitMs: number): Promise<PixelContrastFact> {
  const { kind } = target
  const base: PixelContrastFact = { kind, status: 'unmeasured', ...(target.axeReason ? { axeReason: target.axeReason } : {}) }
  try {
    const prepared = await driver.evaluate(prepareContrastInPage, { ref: target.node.ref, capture: target.capture, kind, waitMs })
    if (prepared.text) base.text = prepared.text.slice(0, 200)
    if (prepared.fontSize !== undefined) base.fontSize = prepared.fontSize
    if (prepared.fontWeight !== undefined) base.fontWeight = prepared.fontWeight
    if (prepared.opacity !== undefined) base.opacity = prepared.opacity
    if (prepared.status !== 'ready') return { ...base, reason: prepared.status }
    // The box as it shows in the viewport when the driver can take it; the element otherwise.
    const box = { x: prepared.x, y: prepared.y, width: prepared.width, height: prepared.height }
    const shoot = () => (prepared.inViewport && driver.screenshotBox ? driver.screenshotBox(box) : driver.screenshot(target.capture))
    const shown = await shoot()
    if (!shown) return { ...base, reason: 'capture-failed' }
    await driver.evaluate(hideForContrastInPage, { ref: target.node.ref, capture: target.capture, kind })
    const bare = await shoot()
    if (!bare) return { ...base, reason: 'capture-failed' }
    const rendered = tryDecodePng(shown)
    const behind = tryDecodePng(bare)
    if (!rendered || !behind || prepared.width <= 0 || prepared.height <= 0) return { ...base, reason: 'capture-failed' }
    const sx = rendered.width / prepared.width
    const sy = rendered.height / prepared.height
    // One pixel of slack: an element screenshot rounds its box to whole device pixels.
    const regions = prepared.regions.map((r) => ({ x: r.x * sx - 1, y: r.y * sy - 1, width: r.width * sx + 2, height: r.height * sy + 2 }))
    const result = measurePair({ rendered, bare: behind, regions, foreground: prepared.foreground })
    if (!result.ok) return { ...base, reason: result.reason }
    const m = result.measure
    return {
      ...base,
      status: 'measured',
      foreground: m.foreground,
      foregroundFrom: m.foregroundFrom,
      background: m.background,
      highest: m.highest,
      lowest: m.lowest,
      pixels: m.pixels,
      // In captured pixels: whether a stroke covers whole pixels depends on the device scale, not on CSS.
      stroke: m.stroke,
      ...(m.foregroundFrom === 'pixels' ? { uniform: m.uniform } : {}),
    }
  } catch {
    return { ...base, reason: 'capture-failed' }
  } finally {
    await driver.evaluate(restoreContrastInPage, null).catch(() => undefined)
  }
}

export interface FoundTargets {
  /** Refs of empty fields that show a placeholder. */
  placeholders: string[]
}

/**
 * Runs in the page (serialized by the browser library, so it references nothing outside its body). Finds
 * the fields that show a placeholder, by the refs the collector left on the page (`window.__rampaRefs`).
 */
export function findContrastTargetsInPage(): FoundTargets {
  const refs = (window as unknown as { __rampaRefs?: Map<Element, string> }).__rampaRefs
  const found: FoundTargets = { placeholders: [] }
  if (!refs) return found
  const shown = (el: Element): boolean => {
    if (typeof el.checkVisibility === 'function' && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true } as CheckVisibilityOptions)) return false
    const rect = el.getBoundingClientRect()
    // Visually hidden text (the sr-only pattern) keeps a 1 by 1 box.
    return rect.width > 1 && rect.height > 1
  }
  for (const el of Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input[placeholder], textarea[placeholder]'))) {
    // A disabled field is an inactive component: its text has no contrast requirement.
    if (!el.placeholder.trim() || el.disabled || (el instanceof HTMLInputElement && el.type === 'hidden')) continue
    if (!el.matches(':placeholder-shown') || !shown(el)) continue
    const ref = refs.get(el)
    if (ref) found.placeholders.push(ref)
  }
  return found
}

export interface PreparedContrast {
  status: 'ready' | 'not-shown' | 'outside-page' | 'clipped' | 'too-large' | 'moving' | 'capture-failed'
  /** The captured element's box, in CSS px, from the viewport's top left corner. */
  x: number
  y: number
  width: number
  height: number
  /** The whole box is inside the viewport, so a screenshot of the viewport's box shows all of it. */
  inViewport: boolean
  /** Where to look, relative to that box, in CSS px: the element's own lines of text, or a field's content box. */
  regions: Array<{ x: number; y: number; width: number; height: number }>
  fontSize?: number | undefined
  fontWeight?: number | undefined
  /** The color the style sheet paints the text with, when nothing blends it. */
  foreground?: Rgba | undefined
  /** The placeholder's words. */
  text?: string | undefined
  /** Below 1 when the element or an ancestor is translucent at capture time: by design, or a fade under way. */
  opacity?: number | undefined
}

/**
 * Runs in the page. Scrolls the element into view, waits for fonts and for images behind it, and reads
 * what the measurement needs: the box, the element's own lines of text, its font, and the color the
 * style sheet paints it with when nothing blends it. Scroll positions it changes are restored by
 * restoreContrastInPage.
 */
export async function prepareContrastInPage(arg: { ref: string; capture: string; kind: 'text' | 'placeholder'; waitMs: number }): Promise<PreparedContrast> {
  type Undo =
    | { el: HTMLElement; prop: string; value: string; priority: string }
    | { el: Element; attr: string; value: string | null }
    | { el: Element; scrollLeft: number; scrollTop: number }
    | { el: Element; unstyled: true }
  const page = window as unknown as { __rampaContrastUndo?: Undo[] }
  const undo: Undo[] = []
  page.__rampaContrastUndo = undo
  const empty = (status: PreparedContrast['status']): PreparedContrast => ({ status, x: 0, y: 0, width: 0, height: 0, inViewport: false, regions: [] })
  const find = (selector: string): Element | null => {
    try {
      return document.querySelector(selector)
    } catch {
      return null
    }
  }
  const el = find(arg.ref)
  const shot = find(arg.capture)
  if (!el || !shot) return empty('capture-failed')
  const deadline = Date.now() + arg.waitMs
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
  const frame = () =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 50)
      requestAnimationFrame(() => {
        clearTimeout(timer)
        resolve()
      })
    })

  // Into view, in every box that scrolls, so lazy backgrounds load and the element is painted where it shows.
  // The page scrolls only when the element is not in view already, and goes back after the captures: content
  // a script animates with the scroll position (a pinned hero, a scrubbed fade) is measured as it rests.
  const scrolling = document.scrollingElement ?? document.documentElement
  undo.push({ el: scrolling, scrollLeft: scrolling.scrollLeft, scrollTop: scrolling.scrollTop })
  const inView = () => {
    const r = shot.getBoundingClientRect()
    return r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight && r.right <= window.innerWidth
  }
  for (let box = shot.parentElement; box; box = box.parentElement) {
    if (box === scrolling || box === document.body) continue
    if (box.scrollWidth > box.clientWidth || box.scrollHeight > box.clientHeight) undo.push({ el: box, scrollLeft: box.scrollLeft, scrollTop: box.scrollTop })
  }
  // Scripts that reveal content as it scrolls into view (a fade, a slide) write its style for a while:
  // wait until the element and its ancestors have been left alone for a moment, or the wait runs out.
  let touched = 0
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      const target = record.target
      if (target.contains(shot) || target.contains(el) || el.contains(target)) {
        touched = Date.now()
        return
      }
    }
  })
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class'], subtree: true })
  if (!inView()) shot.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' as ScrollBehavior })
  await frame()
  await frame()
  await Promise.race([document.fonts.ready, sleep(Math.max(100, Math.min(500, deadline - Date.now())))])
  const settled = Math.min(deadline, Date.now() + 600)
  while (Date.now() < settled && touched > 0 && Date.now() - touched < 150) await sleep(50)
  observer.disconnect()
  // Pictures behind or under the element finish loading first: a half-loaded background measures wrong.
  const near = (other: Element, box: DOMRect) => {
    const r = other.getBoundingClientRect()
    return r.right > box.left && r.left < box.right && r.bottom > box.top && r.top < box.bottom
  }
  let box = shot.getBoundingClientRect()
  const pending = () => Array.from(document.images).filter((img) => !img.complete && near(img, box))
  while (Date.now() < deadline && pending().length > 0) await sleep(50)
  // A box that moves while things above it load would be cut at the wrong place.
  for (let i = 0; i < 10; i++) {
    await frame()
    const now = shot.getBoundingClientRect()
    if (now.x === box.x && now.y === box.y && now.width === box.width && now.height === box.height) break
    box = now
    if (!inView()) shot.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' as ScrollBehavior })
  }
  // Finished transitions: a fade under way is not how the element looks.
  for (let node: Element | null = shot; node && node !== document.documentElement; node = node.parentElement) {
    for (const animation of node.getAnimations?.() ?? []) {
      try {
        if (animation.effect?.getComputedTiming().endTime !== Number.POSITIVE_INFINITY) animation.finish()
      } catch {
        // An animation that cannot finish keeps running.
      }
    }
  }

  // Font, color and the text the measurement needs, read once the element looks as it will in the captures.
  const style = getComputedStyle(el)
  const pseudo = arg.kind === 'placeholder' ? getComputedStyle(el, '::placeholder') : style
  const result: PreparedContrast = { status: 'ready', x: 0, y: 0, width: 0, height: 0, inViewport: false, regions: [] }
  result.fontSize = Number.parseFloat(pseudo.fontSize) || undefined
  const weight = Number.parseInt(pseudo.fontWeight, 10)
  result.fontWeight = Number.isNaN(weight) ? (pseudo.fontWeight === 'bold' ? 700 : 400) : weight
  if (arg.kind === 'placeholder') result.text = (el as HTMLInputElement).placeholder

  // A color as [r, g, b, alpha] in sRGB, whatever syntax the style sheet used (oklch, color-mix...).
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const context = canvas.getContext('2d', { willReadFrequently: true })
  const rgba = (css: string): [number, number, number, number] | undefined => {
    if (!context || !css) return undefined
    context.clearRect(0, 0, 1, 1)
    context.fillStyle = 'rgba(0, 0, 0, 0)'
    context.fillStyle = css
    context.fillRect(0, 0, 1, 1)
    const [r = 0, g = 0, b = 0, a = 0] = Array.from(context.getImageData(0, 0, 1, 1).data)
    return [r, g, b, a / 255]
  }
  // What the style sheet's color cannot account for: a blend with what is behind, a filter, text clipped to a background.
  const blended = (start: Element): boolean => {
    for (let node: Element | null = start; node; node = node.parentElement) {
      const s = getComputedStyle(node)
      if (Number.parseFloat(s.opacity) < 1 || s.filter !== 'none' || s.mixBlendMode !== 'normal') return true
    }
    return false
  }
  if (arg.kind === 'text' && el instanceof SVGElement) {
    // SVG text is painted with fill, not color.
    const solid = style.fill && style.fill !== 'none' && !style.fill.includes('url(') && !(Number.parseFloat(style.fillOpacity) < 1)
    if (solid && !blended(el)) result.foreground = rgba(style.fill)
  } else if (arg.kind === 'text') {
    const clip = style.backgroundClip === 'text' || style.getPropertyValue('-webkit-background-clip') === 'text'
    if (!clip && !blended(el)) result.foreground = rgba(style.webkitTextFillColor || style.color)
  } else {
    const color = rgba(pseudo.webkitTextFillColor || pseudo.color)
    const opacity = Number.parseFloat(pseudo.opacity)
    if (color && !blended(el)) result.foreground = [color[0], color[1], color[2], color[3] * (Number.isNaN(opacity) ? 1 : opacity)]
  }

  box = shot.getBoundingClientRect()
  if (typeof shot.checkVisibility === 'function' && !shot.checkVisibility({ opacityProperty: true, visibilityProperty: true } as CheckVisibilityOptions)) return empty('not-shown')
  if (box.width < 4 || box.height < 4) return empty('not-shown')
  if (box.width * box.height * window.devicePixelRatio ** 2 > 8_000_000) return empty('too-large')
  let opacity = 1
  for (let node: Element | null = shot; node; node = node.parentElement) opacity *= Number.parseFloat(getComputedStyle(node).opacity) || 0
  if (opacity < 0.05) return empty('not-shown')
  if (opacity < 1) result.opacity = Math.round(opacity * 100) / 100

  // How much of it shows: inside the page, and inside the boxes on its containing-block chain that clip it.
  const area = box.width * box.height
  let left = box.left
  let top = box.top
  let right = box.right
  let bottom = box.bottom
  let position = getComputedStyle(shot).position
  for (let node = shot.parentElement; node && node !== document.body && node !== document.documentElement; node = node.parentElement) {
    const s = getComputedStyle(node)
    if (s.display === 'contents') continue
    const transformed = s.transform !== 'none' || s.filter !== 'none' || s.perspective !== 'none' || /paint|layout|strict|content/.test(s.contain)
    const contains = position === 'fixed' ? transformed : position === 'absolute' ? s.position !== 'static' || transformed : true
    if (!contains) continue
    position = s.position
    if (s.display === 'inline') continue
    const outer = node.getBoundingClientRect()
    const padLeft = outer.left + node.clientLeft
    const padTop = outer.top + node.clientTop
    if (s.overflowX !== 'visible') {
      left = Math.max(left, padLeft)
      right = Math.min(right, padLeft + node.clientWidth)
    }
    if (s.overflowY !== 'visible') {
      top = Math.max(top, padTop)
      bottom = Math.min(bottom, padTop + node.clientHeight)
    }
  }
  let pageLeft = 0
  let pageTop = 0
  let pageRight = window.innerWidth
  let pageBottom = window.innerHeight
  if (position !== 'fixed') {
    const hidesX = [document.documentElement, document.body].some((node) => node && /hidden|clip/.test(getComputedStyle(node).overflowX))
    pageLeft = -window.scrollX
    pageTop = -window.scrollY
    pageRight = pageLeft + (hidesX ? scrolling.clientWidth : Math.max(scrolling.scrollWidth, scrolling.clientWidth))
    pageBottom = pageTop + Math.max(scrolling.scrollHeight, scrolling.clientHeight)
  }
  const overlap = (l: number, t: number, r: number, b: number) =>
    (Math.max(0, Math.min(r, pageRight) - Math.max(l, pageLeft)) * Math.max(0, Math.min(b, pageBottom) - Math.max(t, pageTop))) / area
  if (overlap(box.left, box.top, box.right, box.bottom) < 0.5) return empty('outside-page')
  if (overlap(left, top, right, bottom) < 0.5) return empty('clipped')
  // A video playing behind the text paints a new background between the two captures.
  for (const video of Array.from(document.querySelectorAll('video'))) {
    if (!video.paused && !video.ended && video.readyState >= 2 && near(video, box)) return empty('moving')
  }

  result.x = box.left
  result.y = box.top
  result.width = box.width
  result.height = box.height
  result.inViewport = inView()
  const relative = (r: DOMRect | DOMRectReadOnly) => {
    const x = Math.max(r.left, box.left)
    const y = Math.max(r.top, box.top)
    const w = Math.min(r.right, box.right) - x
    const h = Math.min(r.bottom, box.bottom) - y
    return w > 0 && h > 0 ? { x: x - box.left, y: y - box.top, width: w, height: h } : undefined
  }
  if (arg.kind === 'text') {
    // Only the element's own text: a link or a bold word inside it is another element, measured on its own.
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType !== Node.TEXT_NODE || !(child.textContent ?? '').trim()) continue
      const range = document.createRange()
      range.selectNodeContents(child)
      for (const rect of Array.from(range.getClientRects())) {
        const inside = relative(rect)
        if (inside && result.regions.length < 50) result.regions.push(inside)
      }
    }
  } else if (arg.kind === 'placeholder') {
    const s = getComputedStyle(el)
    const px = (value: string) => Number.parseFloat(value) || 0
    const inset = { x: px(s.borderLeftWidth) + px(s.paddingLeft), y: px(s.borderTopWidth) + px(s.paddingTop) }
    const width = box.width - inset.x - px(s.borderRightWidth) - px(s.paddingRight)
    const height = box.height - inset.y - px(s.borderBottomWidth) - px(s.paddingBottom)
    if (width > 0 && height > 0) result.regions.push({ x: inset.x, y: inset.y, width, height })
  }
  return result
}

/** Runs in the page: makes the element's own text, or the placeholder, transparent, everything else as it was. */
export async function hideForContrastInPage(arg: { ref: string; capture: string; kind: 'text' | 'placeholder' }): Promise<number> {
  type Undo =
    | { el: HTMLElement; prop: string; value: string; priority: string }
    | { el: Element; attr: string; value: string | null }
    | { el: Element; scrollLeft: number; scrollTop: number }
    | { el: Element; unstyled: true }
  const page = window as unknown as { __rampaContrastUndo?: Undo[] }
  const undo = page.__rampaContrastUndo ?? []
  page.__rampaContrastUndo = undo
  const force = (el: Element, prop: string, value: string): void => {
    const style = (el as HTMLElement).style as CSSStyleDeclaration | undefined
    if (!style) return
    // An element with no style attribute gets none back, not an empty one.
    if (!el.hasAttribute('style')) undo.push({ el, unstyled: true })
    undo.push({ el: el as HTMLElement, prop, value: style.getPropertyValue(prop), priority: style.getPropertyPriority(prop) })
    style.setProperty(prop, value, 'important')
  }
  const el = document.querySelector(arg.ref)
  const shot = document.querySelector(arg.capture)
  if (!el || !shot) return 0
  if (arg.kind === 'text' && el instanceof SVGElement) {
    for (const child of Array.from(el.children)) force(child, 'fill', getComputedStyle(child).fill)
    force(el, 'fill', 'transparent')
    // Only a stroke that is there: setting one, even transparent, widens the box the screenshot takes.
    if (getComputedStyle(el).stroke !== 'none') force(el, 'stroke', 'transparent')
  } else if (arg.kind === 'text') {
    // The children keep their colors: only this element's own glyphs go. Its text shadow stays, as a background does.
    for (const child of Array.from(el.children)) {
      const s = getComputedStyle(child)
      force(child, 'color', s.color)
      force(child, '-webkit-text-fill-color', s.webkitTextFillColor || s.color)
    }
    const shadow = getComputedStyle(el).textShadow
    if (shadow && shadow !== 'none') force(el, 'text-shadow', shadow)
    force(el, 'transition', 'none')
    force(el, 'color', 'transparent')
    force(el, '-webkit-text-fill-color', 'transparent')
  } else {
    undo.push({ el, attr: 'placeholder', value: el.getAttribute('placeholder') })
    el.removeAttribute('placeholder')
  }
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 50)
    requestAnimationFrame(() => {
      clearTimeout(timer)
      resolve()
    })
  })
  return undo.length
}

/** Runs in the page: puts back every style, attribute and scroll position changed for the last measurement, newest first. */
export function restoreContrastInPage(): void {
  type Undo =
    | { el: HTMLElement; prop: string; value: string; priority: string }
    | { el: Element; attr: string; value: string | null }
    | { el: Element; scrollLeft: number; scrollTop: number }
    | { el: Element; unstyled: true }
  const page = window as unknown as { __rampaContrastUndo?: Undo[] }
  const undo = page.__rampaContrastUndo ?? []
  for (let entry = undo.pop(); entry; entry = undo.pop()) {
    if ('prop' in entry) {
      if (entry.value) entry.el.style.setProperty(entry.prop, entry.value, entry.priority)
      else entry.el.style.removeProperty(entry.prop)
    } else if ('attr' in entry) {
      if (entry.value === null) entry.el.removeAttribute(entry.attr)
      else entry.el.setAttribute(entry.attr, entry.value)
    } else if ('unstyled' in entry) {
      if (entry.el.getAttribute('style') === '') entry.el.removeAttribute('style')
    } else {
      entry.el.scrollLeft = entry.scrollLeft
      entry.el.scrollTop = entry.scrollTop
    }
  }
}
