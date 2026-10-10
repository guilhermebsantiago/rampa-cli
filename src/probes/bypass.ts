import type { Browser, Page } from 'playwright-core'
import type { ProbeRecord } from '../snapshot/schema.ts'
import type { InPageElement, InPageRect } from './kit.ts'
import { type ProbeOptions, openProbePage } from './page.ts'

/**
 * The skip-link probe (2.4.1), part of `--probe keyboard`. From the top of a fresh page it presses Tab up to
 * FIRST_STOPS times and records the first elements that take focus: whether each shows on screen once
 * focused, and, for a link into the page itself (`#main`), what its fragment names and how many elements
 * Tab would reach between the link and that target. Then it presses Enter on up to MAX_ACTIVATIONS of
 * those in-page links, one at a time from the top, and records where focus and the window went and where
 * the next Tab lands. Observe class: Enter only on a link whose address is this page plus a fragment that
 * names an element of it, never on a link to another page, a button or anything in a form; the network
 * guard answers any navigation locally. Facts only: src/site/bypass-blocks.ts reads them.
 */

export const SKIP_LINK_VERSION = '1'
export const SKIP_LINK_VARIANT = 'skip-link'
/** Tab stops read from the top of the page: a skip link is the first or one of the first (G1, ACT cf77f2). */
export const FIRST_STOPS = 8
/** In-page links pressed with Enter, at most. */
export const MAX_ACTIVATIONS = 3
/** A skip link often slides in when focused: what shows is read after this long. */
const SHOW_MS = 400
/** Time for the page to scroll and for a script that handles the link to move focus. */
const SETTLE_MS = 300

/** What an in-page link names. */
export interface SkipTarget {
  el: InPageElement
  rect: InPageRect
}

export interface SkipStop {
  /** The Tab press number, from 1. */
  n: number
  /** null: focus went back to the document (the page has no more elements to focus). */
  el: InPageElement | null
  rect?: InPageRect | undefined
  /** On screen with focus: inside the window, at least 2×2 px after clipping, and on top at its middle. */
  shown?: boolean | undefined
  /** The address, for a link. */
  href?: string | undefined
  /** The link points into this page: its fragment, decoded. */
  fragment?: string | undefined
  /** What the fragment names, or null when nothing on the page has that id or that anchor name. */
  target?: SkipTarget | null | undefined
  /** The target comes after the link in the document. */
  forward?: boolean | undefined
  /** Elements Tab reaches after the link and before the target, in document order: what the link skips. */
  between?: number | undefined
  /** Elements Tab reaches inside the target or after it: with none, a Tab after the link's work leaves the page or wraps to its top. */
  after?: number | undefined
  /** The link is named like a skip link: "Skip to content", "Pular para o conteúdo", "Saltar al contenido". */
  skipWords?: boolean | undefined
}

export type FocusAfter = 'target' | 'inside-target' | 'link' | 'document' | 'elsewhere'
export type NextRelation = 'inside' | 'after' | 'before' | 'same' | 'none'

export interface SkipActivation {
  /** The stop pressed (SkipStop.n). */
  n: number
  ref: string
  fragment: string
  /** Tab from the top did not reach the same element again: the page changed between loads. Nothing was pressed. */
  mismatch?: boolean | undefined
  /** location.hash after Enter. */
  hash?: string | undefined
  /** How far the window scrolled down, in CSS px. */
  scrolledBy?: number | undefined
  /** Where focus was after Enter. */
  focus?: FocusAfter | undefined
  /** The target's top is inside the window after Enter. */
  targetInView?: boolean | undefined
  /** Where the next Tab after Enter landed, relative to the target. */
  next?: { el: InPageElement | null; relation: NextRelation } | undefined
  /** The page tried to load another page, which the guard answered: not an in-page link after all. */
  navigated?: boolean | undefined
}

export interface SkipLinkData {
  viewport: { width: number; height: number }
  stops: SkipStop[]
  activations: SkipActivation[]
  /** Why the first pass ended: the stop budget, or focus went back to the document, or came back to a stop. */
  end: 'budget' | 'document' | 'cycled'
}

type Kit = {
  describe(el: Element): InPageElement
  rect(el: Element): InPageRect
  visible(el: Element): boolean
  deepActive(): Element | null
  resolve(ref: string): Element | null
}

/** Runs in the page: the focused element and, for a link into the page, what it names. Needs the kit. */
export function readSkipStop(): Omit<SkipStop, 'n'> {
  const kit = (window as unknown as { __rampaKit: Kit }).__rampaKit
  const el = kit.deepActive()
  if (!el) return { el: null }
  const stop: Omit<SkipStop, 'n'> = { el: kit.describe(el), rect: kit.rect(el) }
  stop.skipWords =
    /\b(skip|jump)\b|\b(go|move) (straight |directly )?to (the )?(main|content|navigation)\b|\bpul(ar|e)\b|\bsaltar\b|\bir (para|direto|diretamente|al|a la)\b.{0,20}\b(conte[uú]do|principal|navega[cç][aã]o|contenido|menu|menú)\b|\bconte[uú]do principal\b|\bcontenido principal\b|\bmain content\b/i.test(
      stop.el?.label ?? '',
    )
  if (el.localName !== 'a' || !el.hasAttribute('href')) return stop
  const link = el as HTMLAnchorElement
  stop.href = link.href
  let here: URL
  let there: URL
  try {
    here = new URL(location.href)
    there = new URL(link.href)
  } catch {
    return stop
  }
  if (there.origin !== here.origin || there.pathname !== here.pathname || there.search !== here.search || there.hash.length <= 1) return stop
  let fragment = there.hash.slice(1)
  try {
    fragment = decodeURIComponent(fragment)
  } catch {
    // Kept as written.
  }
  stop.fragment = fragment
  // A route of a single-page app (#/about, #!/about) is not a place in the page.
  if (/^[/!]/.test(fragment)) return stop
  const target = document.getElementById(fragment) ?? Array.from(document.getElementsByName(fragment)).find((candidate) => candidate.localName === 'a') ?? null
  if (!target) {
    stop.target = null
    return stop
  }
  stop.target = { el: kit.describe(target), rect: kit.rect(target) }
  stop.forward = Boolean(link.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING)
  let between = 0
  let after = 0
  const focusable = 'a[href],area[href],button,input:not([type=hidden]),select,textarea,summary,iframe,[tabindex],[contenteditable]:not([contenteditable=false])'
  for (const candidate of Array.from(document.querySelectorAll(focusable))) {
    if (candidate === link || link.contains(candidate)) continue
    if ((candidate as HTMLElement).tabIndex < 0 || (candidate as HTMLInputElement).disabled === true) continue
    if (!kit.visible(candidate)) continue
    if (candidate === target || target.contains(candidate) || target.compareDocumentPosition(candidate) & Node.DOCUMENT_POSITION_FOLLOWING) {
      after++
      continue
    }
    if (link.compareDocumentPosition(candidate) & Node.DOCUMENT_POSITION_FOLLOWING) between++
  }
  stop.between = between
  stop.after = after
  return stop
}

/** Runs in the page: whether the focused element shows on screen. Needs the kit. */
export function focusedShown(): boolean {
  const kit = (window as unknown as { __rampaKit: Kit }).__rampaKit
  const el = kit.deepActive()
  if (!el || !kit.visible(el)) return false
  const r = el.getBoundingClientRect()
  let left = Math.max(r.left, 0)
  let top = Math.max(r.top, 0)
  let right = Math.min(r.right, window.innerWidth)
  let bottom = Math.min(r.bottom, window.innerHeight)
  if (right - left < 2 || bottom - top < 2) return false
  // Clipped away by an ancestor that hides its overflow (the visually hidden pattern, a collapsed header).
  for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
    const style = getComputedStyle(a)
    if (style.overflowX === 'visible' && style.overflowY === 'visible') continue
    const c = a.getBoundingClientRect()
    left = Math.max(left, c.left)
    top = Math.max(top, c.top)
    right = Math.min(right, c.right)
    bottom = Math.min(bottom, c.bottom)
    if (right - left < 2 || bottom - top < 2) return false
  }
  // `clip`, `clip-path` and anything on top: the middle of what shows must hit the element.
  const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2)
  return Boolean(hit && (hit === el || el.contains(hit)))
}

/** Runs in the page: focus and the window back to the top, the fragment off the address, as on load. */
export function resetToTop(): void {
  const w = window as unknown as { __rampaSelf?: boolean }
  w.__rampaSelf = true
  try {
    ;(document.activeElement as HTMLElement | null)?.blur?.()
    const body = document.body
    if (body) {
      // Focusing the body for a moment moves the sequential starting point to the top of the page.
      const had = body.getAttribute('tabindex')
      body.setAttribute('tabindex', '-1')
      body.focus({ preventScroll: true })
      if (had === null) body.removeAttribute('tabindex')
      else body.setAttribute('tabindex', had)
      body.blur()
    }
  } finally {
    w.__rampaSelf = false
  }
  if (location.hash) history.replaceState(history.state, '', `${location.pathname}${location.search}`)
  window.scrollTo({ left: 0, top: 0, behavior: 'instant' as ScrollBehavior })
}

/** Runs in the page: after Enter on the link, where focus is and whether the target came into view. Needs the kit. */
export function afterActivation(args: { ref: string; fragment: string }): { hash: string; scrollY: number; focus: FocusAfter; targetInView: boolean } {
  const kit = (window as unknown as { __rampaKit: Kit }).__rampaKit
  const target = document.getElementById(args.fragment) ?? Array.from(document.getElementsByName(args.fragment)).find((candidate) => candidate.localName === 'a') ?? null
  const link = kit.resolve(args.ref)
  const active = kit.deepActive()
  const focus: FocusAfter = !active
    ? 'document'
    : target && active === target
      ? 'target'
      : target?.contains(active)
        ? 'inside-target'
        : link && active === link
          ? 'link'
          : 'elsewhere'
  let targetInView = false
  if (target) {
    const r = target.getBoundingClientRect()
    targetInView = (r.top >= -1 && r.top < window.innerHeight) || (r.top < 0 && r.bottom > 0)
  }
  return { hash: location.hash, scrollY: Math.round(window.scrollY), focus, targetInView }
}

/** Runs in the page: where the focused element sits relative to the link's target. Needs the kit. */
export function nextRelation(args: { ref: string; fragment: string }): { el: InPageElement | null; relation: NextRelation } {
  const kit = (window as unknown as { __rampaKit: Kit }).__rampaKit
  const active = kit.deepActive()
  if (!active) return { el: null, relation: 'none' }
  const el = kit.describe(active)
  const link = kit.resolve(args.ref)
  if (link && active === link) return { el, relation: 'same' }
  const target = document.getElementById(args.fragment) ?? Array.from(document.getElementsByName(args.fragment)).find((candidate) => candidate.localName === 'a') ?? null
  if (!target) return { el, relation: 'before' }
  if (target === active || target.contains(active)) return { el, relation: 'inside' }
  return { el, relation: target.compareDocumentPosition(active) & Node.DOCUMENT_POSITION_FOLLOWING ? 'after' : 'before' }
}

const focusedRef = (page: Page) =>
  page.evaluate(() => {
    const kit = (window as unknown as { __rampaKit: Kit }).__rampaKit
    const active = kit.deepActive()
    return active ? kit.describe(active).ref : null
  })

/** An in-page link worth pressing: its fragment names an element after it. */
export function pressable(stop: SkipStop): boolean {
  return Boolean(stop.el && stop.fragment !== undefined && stop.target && stop.forward)
}

export async function skipLinkProbe(browser: Browser, url: string, options: ProbeOptions): Promise<ProbeRecord> {
  const started = Date.now()
  const probe = await openProbePage(browser, url, options, { variant: SKIP_LINK_VARIANT })
  try {
    const page = probe.page
    await page.addStyleTag({ content: '*, *::before, *::after { scroll-behavior: auto !important; }' }).catch(() => undefined)
    await page.evaluate(resetToTop)
    const stops: SkipStop[] = []
    const seen = new Set<string>()
    let end: SkipLinkData['end'] = 'budget'
    for (let n = 1; n <= FIRST_STOPS; n++) {
      await page.keyboard.press('Tab')
      const read = await page.evaluate(readSkipStop)
      const stop: SkipStop = { n, ...read }
      if (!stop.el) {
        stops.push(stop)
        end = 'document'
        break
      }
      if (seen.has(stop.el.ref)) {
        end = 'cycled'
        break
      }
      seen.add(stop.el.ref)
      // A skip link often slides in on focus: wait for it before reading whether it shows. Other stops are not read.
      if (stop.fragment !== undefined || stop.skipWords) {
        await page.waitForTimeout(SHOW_MS)
        stop.shown = await page.evaluate(focusedShown)
      }
      stops.push(stop)
    }

    const activations: SkipActivation[] = []
    for (const stop of stops.filter(pressable).slice(0, MAX_ACTIVATIONS)) {
      const ref = stop.el?.ref ?? ''
      const fragment = stop.fragment ?? ''
      await page.evaluate(resetToTop)
      for (let k = 0; k < stop.n; k++) await page.keyboard.press('Tab')
      if ((await focusedRef(page)) !== ref) {
        activations.push({ n: stop.n, ref, fragment, mismatch: true })
        continue
      }
      const before = await page.evaluate(() => Math.round(window.scrollY))
      const navigations = probe.guard.log.navigations.length
      await page.keyboard.press('Enter')
      await page.waitForTimeout(SETTLE_MS)
      const after = await page.evaluate(afterActivation, { ref, fragment })
      await page.keyboard.press('Tab')
      const next = await page.evaluate(nextRelation, { ref, fragment })
      activations.push({
        n: stop.n,
        ref,
        fragment,
        hash: after.hash,
        scrolledBy: after.scrollY - before,
        focus: after.focus,
        targetInView: after.targetInView,
        next,
        ...(probe.guard.log.navigations.length > navigations ? { navigated: true } : {}),
      })
    }
    await page.evaluate(resetToTop).catch(() => undefined)

    const data: SkipLinkData = { viewport: probe.conditions.viewport, stops, activations, end }
    return {
      kind: 'keyboard',
      version: SKIP_LINK_VERSION,
      conditions: probe.conditions,
      status: 'complete',
      guard: probe.guard.log,
      durationMs: Date.now() - started,
      data,
    }
  } finally {
    await probe.context.close()
  }
}
