import type { Browser, Page } from 'playwright-core'
import { movedShare } from '../pixels/gray.ts'
import { type StateChange, stateChange } from '../pixels/indicator.ts'
import { type RgbaImage, tryDecodePng } from '../pixels/png.ts'
import type { PixelContrastFact } from '../snapshot/pixel-contrast.ts'
import type { ProbeRecord } from '../snapshot/schema.ts'
import { type ContrastDriver, measureTarget } from '../surfaces/contrast-capture.ts'
import type { InPageElement, InPageRect, Kit } from './kit.ts'
import { type ProbeOptions, openProbePage, skippedRecord } from './page.ts'

/**
 * Contrast in states other than the one a page loads in (C15 of docs/plans/wcag-coverage.md):
 *
 * - **Hover and focus (1.4.3).** Links and buttons with text are hovered (the pointer moved onto them) and, apart,
 *   given focus with `focus()`. When their text color or what lies behind it changes, the text is measured from
 *   pixels in that state, as rendered and with its glyphs made transparent (surfaces/contrast-capture.ts), so the
 *   rules can apply 1.4.3's thresholds to the hover and focus states, which axe-core never sees. Controls that look
 *   alike (same tag, classes, colors and font) share one measurement.
 * - **Selected and current (1.4.11).** An item marked current (`aria-current`), selected (`aria-selected` on a tab or
 *   option), pressed (`aria-pressed`), checked (`aria-checked` on a custom checkbox, switch or radio), or given a
 *   state class (`active`, `is-current`…) inside navigation, tabs, menus, toolbars or pagination, is captured with a
 *   halo of 8 px, then again with its marks taken off (the attribute set to false or removed, the class removed) and
 *   put back. The pixels that changed are the state's indicator: their main colors and the colors next to them, with
 *   the item's text left out (pixels/indicator.ts). The item's text styles in both states say whether its text shows
 *   the state too (bold, an underline, another color).
 *
 * Disabled controls are inactive components, which 1.4.3 and 1.4.11 exempt: counted, never measured. Native
 * checkboxes and radio buttons are drawn by the browser and left out. The focus indicator itself (1.4.11) is measured
 * by the keyboard walk (probes/focus.ts), from the same focused and blurred captures that serve 2.4.7.
 *
 * Observe class: the probe moves the pointer, calls `focus()` and `blur()`, scrolls, takes screenshots, and changes
 * an item's state attribute or class for one capture, put back right after. It never clicks or types.
 */

export const STATES_VERSION = '1'
export const STATES_VARIANT = 'state-contrast'
/** Pixels around a selected item in its captures: a bar or a ring next to it falls inside. */
export const STATE_HALO = 8
const TIME_BUDGET_MS = 40_000
const MAX_CONTROLS = 80
/** Groups of alike controls measured per state (hover, focus). */
const MAX_GROUPS = 10
const MAX_SELECTED = 12
const SETTLE_MS = 150

export interface StyleChange {
  /** 'color', 'background-color', 'background-color (parent)'… */
  prop: string
  rest: string
  now: string
}

export interface TextStateFact {
  /** The control, as the snapshot holds it. */
  el: InPageElement
  state: 'hover' | 'focus'
  /** The ref of the element that holds the text measured (the control, or a span inside it). */
  text?: string | undefined
  /** Controls that look alike and share this measurement, this one included. */
  alike: number
  /** Properties that may change the text's contrast and changed in this state; colors as #rrggbb(aa). */
  changed: StyleChange[]
  /** The text measured from pixels in this state, when something changed (the B3 pair measurement). */
  measure?: PixelContrastFact | undefined
}

export interface IndicatorStateFact {
  el: InPageElement
  /** What marks it. */
  state: 'aria-current' | 'aria-selected' | 'aria-pressed' | 'aria-checked' | 'class'
  value: string
  /** The marks taken off for the "off" capture: `aria-current`, `class active on <li>`… */
  removed: string[]
  status: 'measured' | 'not-shown' | 'moving' | 'shifted' | 'capture-failed' | 'time'
  /** The captured box with its halo, in CSS px from the viewport's top left corner. */
  clip?: InPageRect | undefined
  /** The text's styles that differ between the item on and off: font weight, decoration, color… */
  text?: StyleChange[] | undefined
  /** The changed pixels, the item's text left out. */
  change?: StateChange | undefined
}

export interface StatesData {
  viewport: { width: number; height: number }
  hover: TextStateFact[]
  focus: TextStateFact[]
  selected: IndicatorStateFact[]
  found: {
    /** Controls with text that were read, and the groups of alike ones. */
    controls: number
    groups: number
    /** Disabled controls with text: exempt, never hovered or focused. */
    disabled: number
    selected: number
    /** Selected, current, pressed or checked items that are disabled: exempt. */
    disabledSelected: number
  }
  halo: number
  end: 'complete' | 'time'
}

interface StatesKit {
  controls(max: number): { groups: Array<{ key: string; el: InPageElement; textRef: string; alike: number }>; found: number; disabled: number }
  into(key: string): InPageRect | null
  styles(key: string): Record<string, string> | null
  focus(key: string): boolean
  blurAll(): void
  selected(max: number): { items: Array<{ key: string; el: InPageElement; state: IndicatorStateFact['state']; value: string; removed: string[] }>; found: number; disabled: number }
  place(arg: { key: string; halo: number }): { status: 'ready' | 'not-shown'; clip?: InPageRect; box?: InPageRect; text?: InPageRect[] }
  toggle(arg: { key: string; on: boolean }): InPageRect | null
  textStyle(key: string): Record<string, string> | null
}

/** Installs `window.__rampaStates`; needs the kit. Serialized by Playwright: references nothing outside its body. */
export function installStatesKit(): void {
  type Mark = { el: Element; attr: string; value: string | null } | { el: Element; cls: string }
  const w = window as unknown as { __rampaKit: Kit; __rampaStates?: StatesKit; __rampaResolve?: (ref: string) => Element | null }
  if (w.__rampaStates) return
  const kit = w.__rampaKit
  // The contrast capture's in-page functions find elements by ref through this.
  w.__rampaResolve = (ref: string) => kit.resolve(ref)
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const context = canvas.getContext('2d', { willReadFrequently: true })
  const hex = (css: string): string => {
    if (!context || !css || css === 'none') return css
    context.clearRect(0, 0, 1, 1)
    context.fillStyle = 'rgba(0, 0, 0, 0)'
    context.fillStyle = css
    context.fillRect(0, 0, 1, 1)
    const [r = 0, g = 0, b = 0, a = 0] = Array.from(context.getImageData(0, 0, 1, 1).data)
    const two = (n: number) => n.toString(16).padStart(2, '0')
    return `#${two(r)}${two(g)}${two(b)}${a < 255 ? two(a) : ''}`
  }
  const shown = (el: Element): boolean => {
    if (typeof el.checkVisibility === 'function' && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true } as CheckVisibilityOptions)) return false
    const r = el.getBoundingClientRect()
    return r.width > 2 && r.height > 2
  }
  const disabled = (el: Element): boolean => el.matches(':disabled') || el.closest('[aria-disabled="true"]') !== null || el.closest('fieldset:disabled') !== null
  /**
   * The element holding the first visible piece of the control's text: text pushed out of the control's box (a
   * negative text-indent, the image-replacement pattern) is not visible text.
   */
  const textHolder = (control: Element): Element | null => {
    const box = control.getBoundingClientRect()
    const walker = document.createTreeWalker(control, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!/[\p{L}\p{N}]/u.test(node.textContent ?? '')) continue
      const parent = node.parentElement
      if (!parent || !shown(parent)) continue
      const range = document.createRange()
      range.selectNodeContents(node)
      const r = range.getBoundingClientRect()
      if (r.width <= 2 || r.height <= 2) continue
      const overlap = Math.max(0, Math.min(r.right, box.right) - Math.max(r.left, box.left)) * Math.max(0, Math.min(r.bottom, box.bottom) - Math.max(r.top, box.top))
      if (overlap >= 0.5 * r.width * r.height) return parent
    }
    return null
  }
  const keyed = new Map<string, { control: Element; text: Element | null; item?: Element | undefined; marks?: Mark[] | undefined }>()
  let next = 0
  const finish = (el: Element) => {
    for (let node: Element | null = el; node && node !== document.documentElement; node = node.parentElement) {
      for (const animation of node.getAnimations?.() ?? []) {
        try {
          if (animation.effect?.getComputedTiming().endTime !== Number.POSITIVE_INFINITY) animation.finish()
        } catch {
          // An animation that cannot finish keeps running.
        }
      }
    }
  }
  const CONTROL = 'a[href], button, [role="button"], [role="link"], [role="tab"], [role="menuitem"], input[type="button"], input[type="submit"], input[type="reset"], summary'

  /**
   * The page's style rules for hover and focus, each as the selector it would match without the state: controls that
   * look alike but answer to different hover or focus rules are measured apart. Style sheets of other origins cannot
   * be read and add nothing.
   */
  const stateSelectors: string[] = []
  const STATE_PSEUDO = /:(hover|focus-visible|focus-within|focus|active)\b/g
  const collect = (rules: CSSRuleList) => {
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSStyleRule) {
        if (/:(hover|focus)/.test(rule.selectorText)) stateSelectors.push(rule.selectorText.replace(STATE_PSEUDO, ''))
      } else if ('cssRules' in rule) {
        try {
          collect((rule as CSSGroupingRule).cssRules)
        } catch {
          // An imported sheet of another origin.
        }
      }
    }
  }
  for (const sheet of [...Array.from(document.styleSheets), ...(document.adoptedStyleSheets ?? [])]) {
    try {
      collect(sheet.cssRules)
    } catch {
      // A style sheet of another origin.
    }
  }
  const stateRulesOf = (el: Element): string =>
    stateSelectors
      .map((selector, index) => {
        try {
          return el.matches(selector) || el.querySelector(selector) !== null ? index : -1
        } catch {
          return -1
        }
      })
      .filter((index) => index >= 0)
      .join(',')

  const controls: StatesKit['controls'] = (max) => {
    const groups = new Map<string, { key: string; el: InPageElement; textRef: string; alike: number }>()
    let found = 0
    let off = 0
    for (const control of Array.from(document.querySelectorAll(CONTROL))) {
      if (found >= max) break
      if (control.parentElement?.closest(CONTROL) || !shown(control)) continue
      if (disabled(control)) {
        off++
        continue
      }
      const holder = control instanceof HTMLInputElement ? control : textHolder(control)
      if (!holder) continue
      found++
      const s = getComputedStyle(control)
      const t = getComputedStyle(holder)
      const classes = Array.from(control.classList).sort().slice(0, 3).join('.')
      const signature = [control.localName, control.getAttribute('role') ?? '', classes, t.color, s.backgroundColor, t.fontSize, t.fontWeight, control.parentElement?.localName ?? '', stateRulesOf(control)].join('|')
      const group = groups.get(signature)
      if (group) {
        group.alike++
        continue
      }
      const key = `c${next++}`
      keyed.set(key, { control, text: holder })
      groups.set(signature, { key, el: kit.describe(control), textRef: kit.cssPath(holder), alike: 1 })
    }
    return { groups: [...groups.values()], found, disabled: off }
  }

  const into: StatesKit['into'] = (key) => {
    const entry = keyed.get(key)
    if (!entry || !entry.control.isConnected) return null
    const r = entry.control.getBoundingClientRect()
    if (r.top < 0 || r.left < 0 || r.bottom > window.innerHeight || r.right > window.innerWidth) entry.control.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' as ScrollBehavior })
    return kit.rect(entry.control)
  }

  const styles: StatesKit['styles'] = (key) => {
    const entry = keyed.get(key)
    if (!entry || !entry.control.isConnected) return null
    const text = entry.text ?? entry.control
    finish(text)
    const out: Record<string, string> = {}
    const t = getComputedStyle(text)
    out.color = hex(t.color)
    out['-webkit-text-fill-color'] = hex(t.webkitTextFillColor || t.color)
    out['text-shadow'] = t.textShadow
    out.opacity = t.opacity
    out.filter = t.filter
    // What lies behind the text: its element, up to the control, and two levels above the control.
    const chain: Array<{ node: Element; where: string }> = []
    for (let node: Element | null = text; node && chain.length < 6; node = node.parentElement) {
      chain.push({ node, where: node === text ? '' : node === entry.control ? ' (control)' : ` (${node.localName})` })
      if (node === entry.control) break
    }
    const above = entry.control.parentElement
    if (above) chain.push({ node: above, where: ' (parent)' })
    if (above?.parentElement) chain.push({ node: above.parentElement, where: ' (grandparent)' })
    for (const { node, where } of chain) {
      const s = getComputedStyle(node)
      out[`background-color${where}`] = hex(s.backgroundColor)
      out[`background-image${where}`] = s.backgroundImage
      if (node !== text) out[`opacity${where}`] = s.opacity
    }
    return out
  }

  const focus: StatesKit['focus'] = (key) => {
    const entry = keyed.get(key)
    if (!entry) return false
    ;(entry.control as HTMLElement).focus?.({ preventScroll: true })
    return kit.deepActive() === entry.control
  }

  const blurAll: StatesKit['blurAll'] = () => {
    const active = kit.deepActive() as HTMLElement | null
    active?.blur?.()
    ;(document.activeElement as HTMLElement | null)?.blur?.()
  }

  // ---- selected, current, pressed, checked ---------------------------------------------------------------------
  const STATE_CLASS = /^(is-|has-)?(active|current|selected|checked)$|[-_](active|current|selected|checked)$|^current[-_](menu|page)[-_](item|ancestor|parent)$/i
  const GROUPS = 'nav, [role="navigation"], [role="tablist"], [role="menubar"], [role="menu"], [role="toolbar"], [role="listbox"], [role="radiogroup"], .pagination, .breadcrumb, [aria-label*="pagination" i]'
  const ITEM = 'a[href], button, [role="tab"], [role="menuitem"], [role="option"], [role="link"], [role="button"], [role="checkbox"], [role="switch"], [role="radio"], [role="menuitemcheckbox"], [role="menuitemradio"]'

  const selected: StatesKit['selected'] = (max) => {
    const items: Array<{ key: string; el: InPageElement; state: IndicatorStateFact['state']; value: string; removed: string[] }> = []
    const seen = new Set<Element>()
    let found = 0
    let off = 0
    const add = (el: Element, item: Element, state: IndicatorStateFact['state'], value: string) => {
      if (seen.has(el) || seen.has(item)) return
      seen.add(el)
      seen.add(item)
      if (!shown(el) || el instanceof HTMLInputElement) return
      if (disabled(el)) {
        off++
        return
      }
      found++
      if (items.length >= max) return
      // Every mark of the state on the element and on the unit that holds it, so the "off" capture has none.
      const marks: Mark[] = []
      const removed: string[] = []
      for (const attr of ['aria-current', 'aria-selected', 'aria-pressed', 'aria-checked']) {
        const v = el.getAttribute(attr)
        if (v !== null && v !== 'false' && v !== '') {
          marks.push({ el, attr, value: v })
          removed.push(`${attr}="${v}"`)
        }
      }
      for (let node: Element | null = el; node; node = node === item ? null : node.parentElement) {
        for (const cls of Array.from(node.classList)) {
          if (!STATE_CLASS.test(cls)) continue
          marks.push({ el: node, cls })
          removed.push(`class "${cls}"${node === el ? '' : ` on <${node.localName}>`}`)
        }
      }
      const key = `s${next++}`
      keyed.set(key, { control: el, text: textHolder(el), item, marks })
      items.push({ key, el: kit.describe(el), state, value, removed })
    }
    const unitOf = (el: Element): Element => {
      // The list item or the tab that holds the control, when it carries the class: what paints the indicator.
      const parent = el.parentElement
      return parent && (parent.localName === 'li' || parent.getAttribute('role') === 'presentation') ? parent : el
    }
    for (const el of Array.from(document.querySelectorAll('[aria-current], [aria-selected="true"], [aria-pressed="true"], [aria-checked="true"]'))) {
      const current = el.getAttribute('aria-current')
      if (current !== null) {
        if (current === '' || current.toLowerCase() === 'false') continue
        add(el, unitOf(el), 'aria-current', current)
      } else if (el.getAttribute('aria-selected') === 'true' && /^(tab|option|gridcell|row|treeitem)$/.test(el.getAttribute('role') ?? '')) add(el, unitOf(el), 'aria-selected', 'true')
      else if (el.getAttribute('aria-pressed') === 'true') add(el, el, 'aria-pressed', 'true')
      else if (el.getAttribute('aria-checked') === 'true' && /^(checkbox|switch|radio|menuitemcheckbox|menuitemradio)$/.test(el.getAttribute('role') ?? '')) add(el, el, 'aria-checked', 'true')
    }
    for (const group of Array.from(document.querySelectorAll(GROUPS))) {
      for (const node of Array.from(group.querySelectorAll('*'))) {
        const token = Array.from(node.classList).find((c) => STATE_CLASS.test(c))
        if (!token) continue
        const el = node.matches(ITEM) ? node : node.querySelector(ITEM)
        if (!el) continue
        add(el, node.contains(el) && node !== el ? node : unitOf(el), 'class', token)
      }
    }
    return { items, found, disabled: off }
  }

  const textRects = (el: Element): InPageRect[] => {
    const rects: InPageRect[] = []
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node && rects.length < 40; node = walker.nextNode()) {
      if (!(node.textContent ?? '').trim()) continue
      const range = document.createRange()
      range.selectNodeContents(node)
      for (const r of Array.from(range.getClientRects())) if (r.width > 0 && r.height > 0) rects.push({ x: r.x, y: r.y, width: r.width, height: r.height })
    }
    return rects
  }

  const place: StatesKit['place'] = ({ key, halo }) => {
    const entry = keyed.get(key)
    if (!entry || !entry.control.isConnected || !shown(entry.control)) return { status: 'not-shown' }
    const target = entry.item ?? entry.control
    const r0 = target.getBoundingClientRect()
    if (r0.top < halo || r0.left < halo || r0.bottom > window.innerHeight - halo || r0.right > window.innerWidth - halo) target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' as ScrollBehavior })
    const a = target.getBoundingClientRect()
    const b = entry.control.getBoundingClientRect()
    const left = Math.min(a.left, b.left)
    const top = Math.min(a.top, b.top)
    const right = Math.max(a.right, b.right)
    const bottom = Math.max(a.bottom, b.bottom)
    const x0 = Math.max(0, Math.floor(left - halo))
    const y0 = Math.max(0, Math.floor(top - halo))
    const x1 = Math.min(window.innerWidth, Math.ceil(right + halo))
    const y1 = Math.min(window.innerHeight, Math.ceil(bottom + halo))
    if (x1 - x0 < 4 || y1 - y0 < 4) return { status: 'not-shown' }
    return {
      status: 'ready',
      clip: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 },
      box: { x: left, y: top, width: right - left, height: bottom - top },
      text: textRects(entry.control),
    }
  }

  const toggle: StatesKit['toggle'] = ({ key, on }) => {
    const entry = keyed.get(key)
    if (!entry?.marks) return null
    for (const mark of entry.marks) {
      if ('attr' in mark) {
        if (on) mark.el.setAttribute(mark.attr, mark.value ?? '')
        else if (mark.attr === 'aria-current') mark.el.removeAttribute(mark.attr)
        else mark.el.setAttribute(mark.attr, 'false')
      } else if (on) mark.el.classList.add(mark.cls)
      else mark.el.classList.remove(mark.cls)
    }
    return kit.rect(entry.control)
  }

  const textStyle: StatesKit['textStyle'] = (key) => {
    const entry = keyed.get(key)
    const holder = entry?.text
    if (!holder) return null
    const s = getComputedStyle(holder)
    return {
      color: hex(s.color),
      'font-weight': s.fontWeight,
      'font-style': s.fontStyle,
      'font-size': s.fontSize,
      'text-decoration-line': s.textDecorationLine,
      'text-transform': s.textTransform,
      'letter-spacing': s.letterSpacing,
    }
  }

  w.__rampaStates = { controls, into, styles, focus, blurAll, selected, place, toggle, textStyle }
}

const states = (page: Page) => ({
  call: <K extends keyof StatesKit>(name: K, arg: Parameters<StatesKit[K]>[0]) =>
    page.evaluate(({ name, arg }) => ((window as unknown as { __rampaStates: Record<string, (a: unknown) => unknown> }).__rampaStates[name] as (a: unknown) => unknown)(arg), { name, arg }) as Promise<ReturnType<StatesKit[K]>>,
})

/** Properties whose change may change the text's contrast; others (cursor, outline) are left out. */
const RELEVANT = /^(color|-webkit-text-fill-color|text-shadow|opacity|filter|background-color|background-image)/

function changes(rest: Record<string, string> | null, now: Record<string, string> | null): StyleChange[] {
  if (!rest || !now) return []
  const out: StyleChange[] = []
  for (const [prop, value] of Object.entries(now)) {
    if (!RELEVANT.test(prop)) continue
    const before = rest[prop] ?? ''
    if (value !== before) out.push({ prop, rest: before, now: value })
  }
  return out
}

async function shoot(page: Page, clip: InPageRect): Promise<RgbaImage | undefined> {
  // Finished transitions: a state change that animates is captured where it ends.
  const png = await page.screenshot({ clip, scale: 'css', caret: 'hide', animations: 'disabled', timeout: 5000 }).catch(() => undefined)
  return png ? tryDecodePng(png) : undefined
}

function driverFor(page: Page): ContrastDriver {
  return {
    // biome-ignore lint/suspicious/noExplicitAny: Playwright's evaluate infers its argument type from a generic it cannot see here
    evaluate: <Arg, Result>(fn: (arg: Arg) => Result | Promise<Result>, arg: Arg) => page.evaluate(fn as (arg: any) => Result | Promise<Result>, arg),
    // Only boxes inside the viewport are measured: the control was scrolled into view before its state was set.
    screenshot: async () => undefined,
    screenshotBox: (clip) => page.screenshot({ type: 'png', clip, timeout: 3000, animations: 'disabled' }).catch(() => undefined),
  }
}

const fakeNode = (ref: string) => ({ ref, role: 'generic', states: [], native: {}, children: [] })

async function measureText(page: Page, textRef: string, waitMs: number): Promise<PixelContrastFact> {
  return measureTarget(driverFor(page), { kind: 'text', node: fakeNode(textRef), capture: textRef }, waitMs)
}

async function textState(page: Page, group: { key: string; el: InPageElement; textRef: string; alike: number }, state: 'hover' | 'focus', viewport: { width: number; height: number }, deadline: number): Promise<TextStateFact | undefined> {
  const kit = states(page)
  await page.mouse.move(viewport.width - 2, viewport.height - 2)
  await kit.call('blurAll', undefined as never)
  const box = await kit.call('into', group.key)
  if (!box || box.width < 2 || box.height < 2) return undefined
  const rest = await kit.call('styles', group.key)
  if (state === 'hover') {
    await page.mouse.move(box.x + Math.min(box.width / 2, 24), box.y + box.height / 2, { steps: 2 })
  } else if (!(await kit.call('focus', group.key))) return undefined
  await page.waitForTimeout(SETTLE_MS)
  const now = await kit.call('styles', group.key)
  const fact: TextStateFact = { el: group.el, text: group.textRef, state, alike: group.alike, changed: changes(rest, now) }
  if (fact.changed.length > 0 && Date.now() < deadline) fact.measure = await measureText(page, group.textRef, Math.max(0, Math.min(1500, deadline - Date.now())))
  if (state === 'focus') await kit.call('blurAll', undefined as never)
  await page.mouse.move(viewport.width - 2, viewport.height - 2)
  return fact
}

async function indicatorState(page: Page, item: { key: string; el: InPageElement; state: IndicatorStateFact['state']; value: string; removed: string[] }, deadline: number): Promise<IndicatorStateFact> {
  const kit = states(page)
  const fact: IndicatorStateFact = { el: item.el, state: item.state, value: item.value, removed: item.removed, status: 'capture-failed' }
  if (Date.now() > deadline) return { ...fact, status: 'time' }
  const placed = await kit.call('place', { key: item.key, halo: STATE_HALO })
  if (placed.status !== 'ready' || !placed.clip || !placed.box) return { ...fact, status: 'not-shown' }
  const clip = placed.clip
  fact.clip = clip
  const on = await shoot(page, clip)
  const again = await shoot(page, clip)
  if (!on || !again) return fact
  if (movedShare(on, again) > 0.002) return { ...fact, status: 'moving' }
  const onText = await kit.call('textStyle', item.key)
  let off: RgbaImage | undefined
  let offAgain: RgbaImage | undefined
  let offText: Record<string, string> | null = null
  try {
    const moved = await kit.call('toggle', { key: item.key, on: false })
    if (!moved) return fact
    off = await shoot(page, clip)
    offAgain = await shoot(page, clip)
    offText = await kit.call('textStyle', item.key)
  } finally {
    await kit.call('toggle', { key: item.key, on: true }).catch(() => null)
  }
  if (!off || !offAgain) return fact
  const relative = (r: InPageRect) => ({ x: r.x - clip.x, y: r.y - clip.y, width: r.width, height: r.height })
  // One pixel around each line of text: its anti-aliased edge is the text's too.
  const exclude = (placed.text ?? []).map((r) => ({ x: Math.floor(r.x - clip.x) - 1, y: Math.floor(r.y - clip.y) - 1, width: Math.ceil(r.width) + 2, height: Math.ceil(r.height) + 2 }))
  fact.change = stateChange(on, off, offAgain, { box: relative(placed.box), exclude, mode: 'state' })
  fact.text = []
  if (onText && offText) for (const [prop, value] of Object.entries(onText)) if (offText[prop] !== value) fact.text.push({ prop, rest: offText[prop] ?? '', now: value })
  fact.status = 'measured'
  return fact
}

export async function runStatesProbe(browser: Browser, url: string, options: ProbeOptions): Promise<ProbeRecord> {
  const started = Date.now()
  const deadline = started + TIME_BUDGET_MS
  // Desktop mode, so a pointer can hover even when --device emulates a phone.
  const probe = await openProbePage(browser, url, options, { desktop: true, variant: STATES_VARIANT })
  try {
    const page = probe.page
    const viewport = page.viewportSize() ?? probe.conditions.viewport
    await page.mouse.move(viewport.width - 2, viewport.height - 2)
    await page.evaluate(installStatesKit)
    const kit = states(page)
    const found = await kit.call('controls', MAX_CONTROLS)
    const marked = await kit.call('selected', MAX_SELECTED)
    let end: StatesData['end'] = 'complete'
    const hover: TextStateFact[] = []
    const focus: TextStateFact[] = []
    for (const state of ['hover', 'focus'] as const) {
      for (const group of found.groups.slice(0, MAX_GROUPS)) {
        if (Date.now() > deadline) {
          end = 'time'
          break
        }
        const fact = await textState(page, group, state, viewport, deadline).catch(() => undefined)
        if (fact) (state === 'hover' ? hover : focus).push(fact)
      }
    }
    const selected: IndicatorStateFact[] = []
    for (const item of marked.items) {
      const fact = await indicatorState(page, item, deadline).catch((): IndicatorStateFact => ({ el: item.el, state: item.state, value: item.value, removed: item.removed, status: 'capture-failed' }))
      if (fact.status === 'time') end = 'time'
      selected.push(fact)
    }
    const data: StatesData = {
      viewport,
      hover,
      focus,
      selected,
      found: { controls: found.found, groups: found.groups.length, disabled: found.disabled, selected: marked.found, disabledSelected: marked.disabled },
      halo: STATE_HALO,
      end,
    }
    return {
      kind: 'states',
      version: STATES_VERSION,
      conditions: { ...probe.conditions, viewport },
      status: end === 'time' ? 'partial' : 'complete',
      ...(end === 'time' ? { reason: `time budget reached (${TIME_BUDGET_MS / 1000} s)` } : {}),
      guard: probe.guard.log,
      durationMs: Date.now() - started,
      data,
    }
  } finally {
    await probe.context.close()
  }
}

/** The states probe as a step of the probe stage; a probe that fails leaves a skipped record. */
export async function statesProbe(browser: Browser, url: string, options: ProbeOptions): Promise<ProbeRecord[]> {
  const started = Date.now()
  try {
    return [await runStatesProbe(browser, url, options)]
  } catch (error) {
    return [skippedRecord('states', STATES_VERSION, STATES_VARIANT, `probe failed: ${(error instanceof Error ? error.message : String(error)).split('\n')[0]}`, Date.now() - started)]
  }
}
