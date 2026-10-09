import type { Browser } from 'playwright-core'
import type { ProbeRecord } from '../snapshot/schema.ts'
import type { InPageIdentity, InPageRect } from './kit.ts'
import { settleInPage } from './kit.ts'
import { type ProbeOptions, openProbePage, skippedRecord } from './page.ts'

/**
 * The layout measurement core (1.4.10 reflow, 1.4.12 text spacing, later 1.4.4 at 200%):
 * for every element that owns text or is a control, its text box, the part of it that
 * ancestors with overflow hidden leave visible, and overlaps between text of different
 * elements. Measured before and after a change on the same page, so rules compare an
 * element with itself.
 */

export const LAYOUT_VERSION = '1'
/** The page is laid out at 1280×1024 first: 320×256 is that window at 400% zoom (Understanding 1.4.10). */
export const LAYOUT_BASE = { width: 1280, height: 1024 }
export const REFLOW_VIEWPORT = { width: 320, height: 256 }

export interface LayoutBox {
  ref: string
  /**
   * The element's key on this page, kept in the page across the two measurements: a ref shifts when
   * responsive scripts add or remove siblings, the element does not. Pairs a box with itself.
   */
  key?: number | undefined
  id: InPageIdentity
  tag: string
  kind: 'text' | 'control'
  /** The element's own text (or a control's label), cut to 60 characters. */
  text: string
  /** The union of the element's own text fragments, or a control's box, in document coordinates. */
  rect: InPageRect
  /** Height of the first line of text: the scale for vertical clipping. */
  line: number
  /** The part of `rect` that ancestors with overflow hidden or clip leave visible; null when none of it is. */
  vis: InPageRect | null
  /** How many CSS px of `rect` fall outside the visible part, per side. */
  cut: { left: number; right: number; top: number; bottom: number }
  /** The nearest element whose overflow cuts the text. */
  clipBy?: string | undefined
  /** The element that cuts the text shows an ellipsis (text-overflow: ellipsis). */
  ellipsis?: boolean | undefined
  /** Inside content that needs two dimensions, exempt from 1.4.10: img, video, canvas, svg, math, pre, code, a data table... */
  twoD?: string | undefined
  /** An ancestor that scrolls sideways on its own (overflow-x auto or scroll, with more content than room). */
  scroller?: string | undefined
  /** Inside a fixed or sticky layer. */
  fixed?: boolean | undefined
  /** A title or aria-label holds the full text, a way to read it when it is cut. */
  full?: boolean | undefined
  /** Other boxes the same element hides completely, as a carousel or a marquee does. */
  hiddenPeers?: number | undefined
}

export interface LayoutOverlap {
  a: string
  b: string
  /** The two elements' keys (LayoutBox.key). */
  ka?: number | undefined
  kb?: number | undefined
  width: number
  height: number
}

export interface LayoutMeasure {
  viewport: { width: number; height: number }
  /** document.documentElement.clientWidth: the width a reader sees without scrolling. */
  clientWidth: number
  scrollWidth: number
  /** A person can scroll the window sideways: it moves when scrolled, and neither html nor body hides overflow. */
  scrollsX: boolean
  /** Boxes measured; `boxes` keeps only those a rule may need. */
  measured: number
  boxes: LayoutBox[]
  overlaps: LayoutOverlap[]
  truncated: boolean
}

export interface LayoutLimits {
  maxBoxes: number
  maxOverlaps: number
}

const LIMITS: LayoutLimits = { maxBoxes: 4000, maxOverlaps: 400 }

/** Runs in the page; needs the kit (kit.ts). Self-contained: Playwright serializes it with toString(). */
export function measureLayout(limits: LayoutLimits): LayoutMeasure {
  const kit = (window as unknown as { __rampaKit: { cssPath(el: Element): string; identity(el: Element): InPageIdentity; visible(el: Element): boolean } }).__rampaKit
  // Instant: with scroll-behavior: smooth, a plain scrollTo animates and has not moved yet when it returns.
  const jump = (left: number, top: number) => window.scrollTo({ left, top, behavior: 'instant' as ScrollBehavior })
  jump(0, 0)
  const root = document.documentElement
  const clientWidth = root.clientWidth
  const scrollWidth = Math.max(root.scrollWidth, document.body?.scrollWidth ?? 0)
  jump(100000, 0)
  // A script can scroll a window whose overflow is hidden; a person cannot. Hidden on html or body
  // (body's value goes to the window when html's is visible) means nobody reaches what is past the edge.
  const locked = (el: Element | null) => (el ? ['hidden', 'clip'].includes(getComputedStyle(el).overflowX) : false)
  const scrollsX = window.scrollX > 0 && !locked(root) && !locked(document.body)
  jump(0, 0)
  const sx = window.scrollX
  const sy = window.scrollY
  const SKIP = new Set(['script', 'style', 'noscript', 'template', 'head', 'meta', 'link', 'title', 'base', 'option', 'optgroup', 'br', 'wbr'])
  const CONTROL =
    'a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],[role=checkbox],[role=radio],[role=switch],[role=tab],[role=menuitem],[role=slider],[role=combobox],[role=textbox]'
  const TWO_D = 'img,video,canvas,svg,math,pre,code,iframe,object,embed,[role=application]'
  const styles = new Map<Element, CSSStyleDeclaration>()
  const style = (el: Element): CSSStyleDeclaration => {
    let value = styles.get(el)
    if (!value) {
      value = getComputedStyle(el)
      styles.set(el, value)
    }
    return value
  }
  const collapse = (value: string | null | undefined): string => (value ?? '').replace(/\s+/g, ' ').trim()
  const round = (value: number): number => Math.round(value * 10) / 10
  const toRect = (r: { left: number; top: number; right: number; bottom: number }): InPageRect => ({
    x: round(r.left + sx),
    y: round(r.top + sy),
    width: round(r.right - r.left),
    height: round(r.bottom - r.top),
  })
  const twoD = (el: Element): string | undefined => {
    const media = el.closest(TWO_D)
    if (media) return media.getAttribute('role') === 'application' ? 'application' : media.localName
    const table = el.closest('table')
    if (table?.querySelector('th')) return 'table'
    return undefined
  }

  interface Work {
    el: Element
    box: LayoutBox
    fragments: Array<{ left: number; top: number; right: number; bottom: number }>
    clipper: Element | null
  }
  const work: Work[] = []
  let truncated = false
  const store = window as unknown as { __rampaKeys?: WeakMap<Element, number>; __rampaNextKey?: number }
  const keys = store.__rampaKeys ?? new WeakMap<Element, number>()
  store.__rampaKeys = keys
  const keyOf = (el: Element): number => {
    let key = keys.get(el)
    if (key === undefined) {
      key = (store.__rampaNextKey ?? 0) + 1
      store.__rampaNextKey = key
      keys.set(el, key)
    }
    return key
  }

  const elements: Element[] = []
  const gather = (scope: Document | ShadowRoot) => {
    for (const el of Array.from(scope.querySelectorAll('*'))) {
      elements.push(el)
      if (el.shadowRoot) gather(el.shadowRoot)
    }
  }
  gather(document)

  for (const el of elements) {
    if (SKIP.has(el.localName) || el === root || el === document.body) continue
    if (work.length >= limits.maxBoxes) {
      truncated = true
      break
    }
    const ownText = Array.from(el.childNodes).filter((node) => node.nodeType === Node.TEXT_NODE && collapse(node.textContent) !== '')
    const isControl = el.matches(CONTROL)
    if (ownText.length === 0 && !isControl) continue
    if (!kit.visible(el)) continue
    const fragments: Work['fragments'] = []
    for (const node of ownText) {
      const range = document.createRange()
      range.selectNodeContents(node)
      for (const r of Array.from(range.getClientRects())) {
        if (r.width > 0 && r.height > 0 && fragments.length < 60) fragments.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom })
      }
    }
    let kind: LayoutBox['kind'] = isControl ? 'control' : 'text'
    if (fragments.length === 0) {
      if (!isControl) continue
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      fragments.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom })
      kind = 'control'
    }
    const union = {
      left: Math.min(...fragments.map((f) => f.left)),
      top: Math.min(...fragments.map((f) => f.top)),
      right: Math.max(...fragments.map((f) => f.right)),
      bottom: Math.max(...fragments.map((f) => f.bottom)),
    }
    // Ancestors whose overflow clips this element's content: the element itself, then its containing blocks.
    const clip = { left: Number.NEGATIVE_INFINITY, top: Number.NEGATIVE_INFINITY, right: Number.POSITIVE_INFINITY, bottom: Number.POSITIVE_INFINITY }
    // What is painted: also cut by containers that scroll, whose hidden part is reachable but not visible.
    const paint = { left: Number.NEGATIVE_INFINITY, top: Number.NEGATIVE_INFINITY, right: Number.POSITIVE_INFINITY, bottom: Number.POSITIVE_INFINITY }
    let clipper: Element | null = null
    let scroller: Element | null = null
    let fixed = false
    let current: Element | null = el
    let needPositioned = false
    // A field scrolls its own value: text inside an input or select is never clipped content.
    const isField = el.localName === 'input' || el.localName === 'textarea' || el.localName === 'select'
    while (current && current !== root && current !== document.body) {
      const s = style(current)
      const skip = current !== el && needPositioned && s.position === 'static' && s.transform === 'none'
      if (!skip) {
        needPositioned = false
        const ox = s.overflowX
        const oy = s.overflowY
        if ((ox === 'auto' || ox === 'scroll') && current.scrollWidth > current.clientWidth + 1 && !scroller) scroller = current
        const clipsX = ox === 'hidden' || ox === 'clip'
        const clipsY = oy === 'hidden' || oy === 'clip'
        if ((ox !== 'visible' || oy !== 'visible') && !(isField && current === el)) {
          const r = current.getBoundingClientRect()
          const left = r.left + current.clientLeft
          const top = r.top + current.clientTop
          const padding = { left, top, right: left + current.clientWidth, bottom: top + current.clientHeight }
          if (ox !== 'visible') {
            paint.left = Math.max(paint.left, padding.left)
            paint.right = Math.min(paint.right, padding.right)
          }
          if (oy !== 'visible') {
            paint.top = Math.max(paint.top, padding.top)
            paint.bottom = Math.min(paint.bottom, padding.bottom)
          }
          const cutsX = clipsX && (union.left < padding.left - 0.5 || union.right > padding.right + 0.5)
          const cutsY = clipsY && (union.top < padding.top - 0.5 || union.bottom > padding.bottom + 0.5)
          if ((cutsX || cutsY) && !clipper) clipper = current
          if (clipsX) {
            clip.left = Math.max(clip.left, padding.left)
            clip.right = Math.min(clip.right, padding.right)
          }
          if (clipsY) {
            clip.top = Math.max(clip.top, padding.top)
            clip.bottom = Math.min(clip.bottom, padding.bottom)
          }
        }
        if (s.position === 'fixed' || s.position === 'sticky') fixed = true
        if (s.position === 'fixed') break
        if (s.position === 'absolute') needPositioned = true
      }
      const parent: Element | null = current.parentElement
      if (parent) current = parent
      else {
        const host = current.getRootNode()
        current = host instanceof ShadowRoot ? host.host : null
      }
    }
    const visible = {
      left: Math.max(union.left, clip.left),
      top: Math.max(union.top, clip.top),
      right: Math.min(union.right, clip.right),
      bottom: Math.min(union.bottom, clip.bottom),
    }
    const shown = visible.right - visible.left > 0.5 && visible.bottom - visible.top > 0.5
    const text = ownText.length > 0 ? collapse(ownText.map((node) => node.textContent).join(' ')) : collapse(el.getAttribute('aria-label') ?? (el as HTMLElement).innerText ?? '')
    const whole = collapse(el.textContent)
    const names = [el.getAttribute('title'), el.closest('[title]')?.getAttribute('title'), el.getAttribute('aria-label')].map(collapse)
    const box: LayoutBox = {
      ref: kit.cssPath(el),
      key: keyOf(el),
      id: kit.identity(el),
      tag: el.localName,
      kind,
      text: text.length > 60 ? `${text.slice(0, 59)}…` : text,
      rect: toRect(union),
      line: round((fragments[0]?.bottom ?? 0) - (fragments[0]?.top ?? 0)),
      vis: shown ? toRect(visible) : null,
      cut: {
        left: round(Math.max(0, clip.left - union.left)),
        right: round(Math.max(0, union.right - clip.right)),
        top: round(Math.max(0, clip.top - union.top)),
        bottom: round(Math.max(0, union.bottom - clip.bottom)),
      },
    }
    if (clipper) {
      box.clipBy = kit.cssPath(clipper)
      if (style(clipper).textOverflow === 'ellipsis' || style(el).textOverflow === 'ellipsis') box.ellipsis = true
    }
    const exempt = twoD(el)
    if (exempt) box.twoD = exempt
    if (scroller) box.scroller = kit.cssPath(scroller)
    if (fixed) box.fixed = true
    if (whole && names.some((name) => name.length >= Math.min(whole.length, 200) * 0.8 && name.length > 0)) box.full = true
    const painted = fragments.map((f) => ({
      left: Math.max(f.left, clip.left, paint.left),
      top: Math.max(f.top, clip.top, paint.top),
      right: Math.min(f.right, clip.right, paint.right),
      bottom: Math.min(f.bottom, clip.bottom, paint.bottom),
    }))
    work.push({ el, box, fragments: painted, clipper })
  }

  // Elements that hide other boxes completely, as carousels and marquees do.
  const hides = new Map<Element, number>()
  for (const item of work) if (!item.box.vis && item.clipper) hides.set(item.clipper, (hides.get(item.clipper) ?? 0) + 1)
  for (const item of work) {
    const peers = item.clipper ? (hides.get(item.clipper) ?? 0) - (item.box.vis ? 0 : 1) : 0
    if (peers > 0) item.box.hiddenPeers = peers
  }

  // Overlaps between visible text fragments of different elements, outside fixed layers.
  const frags: Array<{ i: number; left: number; top: number; right: number; bottom: number }> = []
  for (const [i, item] of work.entries()) {
    if (item.box.kind !== 'text' || item.box.fixed || !item.box.vis) continue
    for (const f of item.fragments) if (f.right - f.left > 0.5 && f.bottom - f.top > 0.5) frags.push({ i, ...f })
  }
  frags.sort((a, b) => a.top - b.top)
  const overlaps: LayoutOverlap[] = []
  const seen = new Set<string>()
  for (let a = 0; a < frags.length && overlaps.length < limits.maxOverlaps; a++) {
    const fa = frags[a]
    if (!fa) continue
    for (let b = a + 1; b < frags.length; b++) {
      const fb = frags[b]
      if (!fb || fb.top >= fa.bottom) break
      if (fb.i === fa.i) continue
      const width = Math.min(fa.right, fb.right) - Math.max(fa.left, fb.left)
      const height = Math.min(fa.bottom, fb.bottom) - Math.max(fa.top, fb.top)
      if (width < 2 || height < 2) continue
      const ea = work[fa.i]
      const eb = work[fb.i]
      if (!ea || !eb || ea.el.contains(eb.el) || eb.el.contains(ea.el)) continue
      const key = fa.i < fb.i ? `${fa.i}|${fb.i}` : `${fb.i}|${fa.i}`
      if (seen.has(key)) continue
      seen.add(key)
      overlaps.push({ a: ea.box.ref, b: eb.box.ref, ka: ea.box.key, kb: eb.box.key, width: round(width), height: round(height) })
      if (overlaps.length >= limits.maxOverlaps) break
    }
  }

  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    clientWidth,
    scrollWidth,
    scrollsX,
    measured: work.length,
    boxes: work.map((item) => item.box),
    overlaps,
    truncated,
  }
}

/** Whether a box is cut by its ancestors enough to lose text: 2 px across, or a quarter of a line down. */
export function partlyClipped(box: LayoutBox): boolean {
  if (!box.vis) return false
  const across = box.cut.left + box.cut.right
  const down = box.cut.top + box.cut.bottom
  return across >= 2 || down >= Math.max(3, 0.25 * (box.line || box.rect.height))
}

/** Whole: nothing cut, with 1 px of tolerance. */
export function wholeBox(box: LayoutBox | undefined): boolean {
  return Boolean(box?.vis) && box !== undefined && box.cut.left + box.cut.right < 1 && box.cut.top + box.cut.bottom < 1
}

export function pastRightEdge(box: LayoutBox, measure: LayoutMeasure): boolean {
  // A fixed layer does not move with the page: one parked past the edge (an off-canvas menu) is never scrolled to.
  return Boolean(measure.scrollsX && box.vis && !box.scroller && !box.fixed && box.vis.x + box.vis.width > measure.clientWidth + 1)
}

/**
 * Partly cut by the right edge of a window that does not scroll sideways (overflow hidden on
 * html or body): the part past the edge cannot be reached at all. Wholly outside is not counted,
 * since off-canvas menus wait there.
 */
export function cutAtRightEdge(box: LayoutBox, measure: LayoutMeasure): boolean {
  return Boolean(!measure.scrollsX && box.vis && !box.scroller && !box.fixed && box.vis.x < measure.clientWidth - 1 && box.vis.x + box.vis.width > measure.clientWidth + 1)
}

/**
 * Keeps what a rule may read: the boxes that are cut, past the edge or overlapping after the
 * change, and the same elements before it. A page with thousands of text boxes stays small.
 */
export function slimPair(before: LayoutMeasure, after: LayoutMeasure): { before: LayoutMeasure; after: LayoutMeasure } {
  const keep = new Set<string>()
  for (const box of after.boxes) {
    if (partlyClipped(box) || box.ellipsis || pastRightEdge(box, after) || cutAtRightEdge(box, after) || (box.scroller && !box.twoD)) keep.add(pairOf(box))
  }
  for (const overlap of after.overlaps) for (const side of overlapSides(overlap)) keep.add(side)
  const afterOverlaps = new Set(after.overlaps.map(overlapPair))
  return {
    before: { ...before, boxes: before.boxes.filter((box) => keep.has(pairOf(box))), overlaps: before.overlaps.filter((o) => afterOverlaps.has(overlapPair(o))) },
    after: { ...after, boxes: after.boxes.filter((box) => keep.has(pairOf(box))) },
  }
}

/** What pairs a box before a change with itself after it: its key when it has one, else its ref. */
export function pairOf(box: Pick<LayoutBox, 'key' | 'ref'>): string {
  return typeof box.key === 'number' ? `k${box.key}` : box.ref
}

function overlapSides(o: LayoutOverlap): [string, string] {
  return typeof o.ka === 'number' && typeof o.kb === 'number' ? [`k${o.ka}`, `k${o.kb}`] : [o.a, o.b]
}

/** An overlap's two sides, in order, so that a|b and b|a are one pair. */
export function overlapPair(o: LayoutOverlap): string {
  return overlapSides(o).sort().join('|')
}

/** The pairing key of one side of an overlap: 'a' or 'b'. */
export function overlapSide(o: LayoutOverlap, side: 'a' | 'b'): string {
  const [a, b] = overlapSides(o)
  return side === 'a' ? a : b
}

const SETTLE = { quietMs: 300, capMs: 3000 }

/** 1.4.10: the page laid out at 1280×1024, then resized to 320×256 CSS px, as 400% zoom would. */
export async function reflowProbe(browser: Browser, url: string, options: ProbeOptions): Promise<ProbeRecord> {
  const started = Date.now()
  const probe = await openProbePage(browser, url, options, { viewport: LAYOUT_BASE, desktop: true, variant: 'reflow-320x256' })
  try {
    const before = await probe.page.evaluate(measureLayout, LIMITS)
    // Resizing instead of reloading is what zoom does: the page keeps its state.
    await probe.page.setViewportSize(REFLOW_VIEWPORT)
    await probe.page.evaluate(settleInPage, SETTLE)
    const after = await probe.page.evaluate(measureLayout, LIMITS)
    const slim = slimPair(before, after)
    return {
      kind: 'layout',
      version: LAYOUT_VERSION,
      conditions: { ...probe.conditions, viewport: REFLOW_VIEWPORT },
      status: before.truncated || after.truncated ? 'partial' : 'complete',
      ...(before.truncated || after.truncated ? { reason: `box budget reached (${LIMITS.maxBoxes})` } : {}),
      guard: probe.guard.log,
      durationMs: Date.now() - started,
      data: { from: LAYOUT_BASE, baseline: slim.before, variant: slim.after },
    }
  } finally {
    await probe.context.close()
  }
}

/** Languages written without spaces between words: word spacing does not apply to them (Understanding 1.4.12). */
const NO_WORD_SPACES = new Set(['ja', 'zh', 'th', 'lo', 'km', 'my', 'bo'])

export interface SpacingApplied {
  /** The metrics set on every element, as a user style sheet would. */
  applied: string[]
  /** Metrics left out because the page's language does not use them. */
  skipped: string[]
  /** Elements styled, open shadow roots included. */
  elements: number
}

/**
 * Runs in the page. Line height 1.5, letter spacing 0.12em and word spacing 0.16em on every
 * element, and 2em after each paragraph (the W3C bookmarklet's choice), as inline !important
 * declarations: they win over the author's !important, as a user style sheet does.
 */
export function applyTextSpacing(options: { wordSpacing: boolean }): number {
  let count = 0
  const style = (scope: Document | ShadowRoot) => {
    for (const el of Array.from(scope.querySelectorAll('*'))) {
      if (!(el instanceof HTMLElement) && !(el instanceof SVGElement)) continue
      const target = el as HTMLElement
      target.style.setProperty('line-height', '1.5', 'important')
      target.style.setProperty('letter-spacing', '0.12em', 'important')
      if (options.wordSpacing) target.style.setProperty('word-spacing', '0.16em', 'important')
      if (el.localName === 'p') target.style.setProperty('margin-bottom', '2em', 'important')
      count++
      if (el.shadowRoot) style(el.shadowRoot)
    }
  }
  style(document)
  return count
}

/** 1.4.12: the page at 1280×1024, measured, then measured again with the four spacing values applied. */
export async function textSpacingProbe(browser: Browser, url: string, options: ProbeOptions): Promise<ProbeRecord> {
  const started = Date.now()
  const probe = await openProbePage(browser, url, options, { viewport: LAYOUT_BASE, desktop: true, variant: 'text-spacing' })
  try {
    const lang = (await probe.page.evaluate(() => document.documentElement.lang || '')).toLowerCase().split('-')[0] ?? ''
    const wordSpacing = !NO_WORD_SPACES.has(lang)
    const before = await probe.page.evaluate(measureLayout, LIMITS)
    const elements = await probe.page.evaluate(applyTextSpacing, { wordSpacing })
    await probe.page.evaluate(settleInPage, SETTLE)
    const after = await probe.page.evaluate(measureLayout, LIMITS)
    const slim = slimPair(before, after)
    const spacing: SpacingApplied = {
      applied: ['line-height 1.5', 'letter-spacing 0.12em', ...(wordSpacing ? ['word-spacing 0.16em'] : []), 'p margin-bottom 2em'],
      skipped: wordSpacing ? [] : [`word-spacing (lang ${lang})`],
      elements,
    }
    return {
      kind: 'layout',
      version: LAYOUT_VERSION,
      conditions: { ...probe.conditions, viewport: LAYOUT_BASE },
      status: before.truncated || after.truncated ? 'partial' : 'complete',
      ...(before.truncated || after.truncated ? { reason: `box budget reached (${LIMITS.maxBoxes})` } : {}),
      guard: probe.guard.log,
      durationMs: Date.now() - started,
      data: { spacing, baseline: slim.before, variant: slim.after },
    }
  } finally {
    await probe.context.close()
  }
}

/** Reflow and text spacing, each on its own fresh page; one that fails leaves a skipped record and the other still runs. */
export async function layoutProbes(browser: Browser, url: string, options: ProbeOptions): Promise<ProbeRecord[]> {
  const records: ProbeRecord[] = []
  for (const [variant, probe] of [
    ['reflow-320x256', reflowProbe],
    ['text-spacing', textSpacingProbe],
  ] as const) {
    const started = Date.now()
    try {
      records.push(await probe(browser, url, options))
    } catch (error) {
      records.push(skippedRecord('layout', LAYOUT_VERSION, variant, `probe failed: ${(error instanceof Error ? error.message : String(error)).split('\n')[0]}`, Date.now() - started))
    }
  }
  return records
}
