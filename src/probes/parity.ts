import type { Browser } from 'playwright-core'
import type { A11yNode, ProbeRecord } from '../snapshot/schema.ts'
import type { TreeIndex } from '../snapshot/tree.ts'
import { type ControlFacts, Harness, type HarnessAction, type SkipReason, type Watch, skipReason } from './activate.ts'
import { matchNode } from './identity.ts'
import { readFocus, trapContext, tryEscape } from './keyboard.ts'
import type { InPageElement, InPageIdentity } from './kit.ts'
import { type ProbeOptions, type ProbePage, skippedRecord } from './page.ts'

/**
 * Keyboard parity (2.1.1, 2.1.2), the plan's C2, on the activate-class harness (activate.ts). Three parts, each on
 * fresh loads behind the guard:
 *
 * 1. Controls whose keyboard support is the page's own doing: elements with an interactive role that are not native
 *    controls, items of composite widgets that Tab does not reach (a tab, a menu item), elements with their own
 *    pointer listeners and no click or key listener (F54), elements with a click listener and no role (F42), and
 *    elements the page styles with a pointer cursor. For each, the keys a person would use are pressed first (Enter,
 *    Space; an arrow on a slider, a spin button, a combo box or a popup button; for an item of a composite widget,
 *    the arrows from the item Tab reaches), each after focus and a wait with no key; then the control is hovered and
 *    clicked. What each did is recorded as a net effect: navigations, windows, submissions, dialogs, a layer that
 *    showed, state attributes that changed, elements that showed or hid, text that changed. The keyboard and the mouse
 *    are compared as facts: rules decide (rules/parity.ts). A control whose keys did nothing while the click did
 *    something is tried again on a second load.
 * 2. Hover menus: links hidden until a pointer hovers their trigger. The trigger is hovered; then focused, tabbed
 *    from, and pressed (ArrowDown, Space, Enter) to see whether a keyboard shows them; and the page is searched for
 *    the same addresses in links Tab reaches.
 * 3. Exit instructions (A7's): when the page has text that names a key to leave ("press Ctrl+M to leave the editor"),
 *    a Tab walk looks for a cycle focus cannot leave, and the keys the text names are pressed inside it.
 */

export const PARITY_VERSION = '1'
/** Controls tried per page, and the time of the whole probe; the controls stop at CONTROLS_UNTIL, the menus at MENUS_UNTIL. */
export const PARITY_LIMITS = { controls: 30, timeMs: 280_000 }
const CONTROLS_UNTIL = 200_000
const MENUS_UNTIL = 250_000
const MAX_LISTED = 120
const CURSOR_MAX = 8
const MENU_BUDGET = 8
const MAX_CONFIRM = 8
const MENU_CONFIRM = 4
/** The wait with no key after focus, whose effect is what focus alone does. */
const IDLE_MS = 200
/** The wait after the pointer moves onto a control, before it is clicked. */
const HOVER_MS = 350
/**
 * How long the keys' window and the click's window last, the same for both so neither is favored: an effect that
 * comes later than this (a fetch before anything renders) is missed on both sides.
 */
const INPUT_MS = 700
/** Arrow presses to get from the item Tab reaches to another item of the same widget. */
const MAX_ARRIVE = 15
const WALK_BUDGET = 150
/** Text that changed, in characters, below which a change is not an effect. */
export const MIN_TEXT = 3
/** Pixels the page scrolled, below which a scroll is not an effect. */
export const MIN_SCROLL = 40

export type ParityWhy = 'role' | 'pointer-only' | 'handler' | 'cursor'

export interface EffectEvent {
  kind: 'navigation' | 'window' | 'submit' | 'dialog' | 'download' | 'route' | 'fragment' | 'modal'
  detail?: string | undefined
}

export interface EffectItem {
  /** Empty for an element the effect removed from the page. */
  ref: string
  tag: string
  label: string
  /** Links that show inside it. */
  links?: number | undefined
}

export interface StateChange {
  ref: string
  tag: string
  label: string
  attr: string
  from: string
  to: string
}

/** What a window of input changed, net: the page as it was before, against the page after. Facts only. */
export interface Effect {
  events: EffectEvent[]
  /** A dialog or a fixed layer over a quarter of the window that showed. */
  opened?: { ref: string; id: InPageIdentity; tag: string; name: string; modal: boolean } | undefined
  states: StateChange[]
  shown: EffectItem[]
  hidden: EffectItem[]
  /** How many there were, the lists holding the first 20 (12 states). */
  counts: { states: number; shown: number; hidden: number }
  /** Lines of visible text that came and went (digits masked), and their characters. */
  text: { added: string[]; removed: string[]; changed: number }
  scroll?: { x: number; y: number } | undefined
  /** Where focus went, when it moved. */
  focus?: { ref: string; tag: string; label: string } | undefined
}

export interface KeyPath {
  /** 'Enter', 'Space', 'ArrowRight', 'arrive', 'arrive, Enter'. */
  path: string
  /** Focus the control itself, or the item of its widget that Tab reaches and arrow to it. */
  setup: 'self' | 'arrive'
  keys: string[]
}

export interface KeyAttempt {
  path: string
  /** The keys pressed, in order: 'ArrowRight ×2, Enter'. */
  pressed?: string | undefined
  /** Focus reached the control (to arrive: the item Tab reaches). */
  focused: boolean
  /** Tab reaches the control: it is focusable with a tabindex of 0 or more. */
  tabbable?: boolean | undefined
  /** arrive: the item the arrows started from, and whether they got focus to the control. */
  from?: string | undefined
  arrived?: boolean | undefined
  /** What focus alone did: the wait with no key after it. */
  focus?: Effect | undefined
  /** What the keys did. */
  effect?: Effect | undefined
}

export type ParityResult = 'same' | 'partial' | 'none' | 'unreachable' | 'inert'

export interface ParityTrial {
  keys: KeyAttempt[]
  /** What moving the pointer onto the control did, before the click: not compared. */
  hover?: Effect | undefined
  click?: Effect | undefined
  /** The probe's reading, recomputed by the rule from the facts above. */
  result?: ParityResult | undefined
  /** The key path whose effect covers the click's. */
  match?: string | undefined
  /** A link Tab reaches that goes where the click went. */
  elsewhere?: { ref: string; label: string; href: string } | undefined
  outcome?: 'not-exercised' | 'unmatched' | 'not-tried' | 'delegates' | undefined
  /** The click would land on a focusable element inside the control: that element is the control. */
  delegates?: InPageElement | undefined
  cover?: (InPageElement & { text: string }) | undefined
  reason?: string | undefined
  /** The same trial on a second fresh load, when the keys did nothing the click did. */
  confirm?: Omit<ParityTrial, 'confirm'> | undefined
}

export interface ParityControl extends InPageElement {
  why: ParityWhy
  /** Its own listeners (read over the DevTools protocol) and inline handlers. */
  listeners?: string[] | undefined
  /** The composite widget it is an item of. */
  widget?: { ref: string; role: string } | undefined
  haspopup?: string | undefined
  /** Its texts and the text around it, for the 2.1.1 judgment. */
  texts: string[]
  skip?: { reason: SkipReason; detail?: string | undefined } | undefined
  trial?: ParityTrial | undefined
}

export interface MenuTrial {
  /** Hovering the trigger showed the links. */
  hover: boolean
  /** They still showed once the pointer left. */
  staysOpen?: boolean | undefined
  /** What showed them from the keyboard, when something did. */
  revealedBy?: 'focus' | 'Tab' | 'ArrowDown' | 'Space' | 'Enter' | undefined
  /** What was tried from the keyboard, in order. */
  tried: string[]
  /** Links of the menu whose address a link Tab reaches elsewhere on the page also has. */
  elsewhere: number
  missing: Array<{ href: string; label: string }>
  outcome?: 'not-exercised' | 'unmatched' | 'not-tried' | undefined
  reason?: string | undefined
  confirm?: Omit<MenuTrial, 'confirm'> | undefined
}

export interface HoverMenu {
  /** The element whose hover shows the menu (its parent element). */
  trigger: InPageElement
  /** What a keyboard can focus in the trigger, outside the menu. */
  focusable?: (InPageElement & { href?: string | undefined }) | undefined
  container: InPageElement
  links: Array<{ href: string; label: string }>
  linkCount: number
  trial?: MenuTrial | undefined
}

export interface TrapExit {
  cycle: Array<{ ref: string; id: InPageIdentity; label: string; tag: string }>
  /** The text that names a way out, as A7 reads it. */
  hint: string
  /** The keys read from it, as pressed: 'Control+m', 'Escape'. */
  keys: string[]
  /** Tab, Shift+Tab, Esc or an arrow left the cycle before any instruction: no trap. */
  escaped?: string | undefined
  left: boolean
  leftWith?: string | undefined
  rounds: number
}

export interface ParityData {
  viewport: { width: number; height: number }
  /** Elements whose own listeners were read over the DevTools protocol; null when it could not be read. */
  listeners: number | null
  found: number
  controls: ParityControl[]
  /** Controls pressed or clicked (the budget counts these). */
  tried: number
  menusFound: number
  menus: HoverMenu[]
  /** The page has text that names a key to leave something. */
  exitText: boolean
  traps: TrapExit[]
  loads: number
  actions: HarnessAction[]
  /** error: fresh pages failed to load three times in a row (the network dropped), and the probe stopped there. */
  end: 'complete' | 'budget' | 'time' | 'error'
}

const COMPOSITE_ITEMS = new Set(['tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'treeitem', 'radio'])

interface EffectWindow {
  __rampaEffect?: { begin(): void; end(args: { noise: boolean }): NetEffect }
}

/** The part of an effect read in the page. */
export interface NetEffect {
  states: StateChange[]
  shown: EffectItem[]
  hidden: EffectItem[]
  counts: { states: number; shown: number; hidden: number }
  text: { added: string[]; removed: string[]; changed: number }
}

/**
 * Installs `window.__rampaEffect` (needs the kit and the activate kit): the page's state at begin(), against the page
 * at end(). State is read from attributes a reader hears (aria-expanded, aria-pressed, aria-checked, aria-selected,
 * aria-current, aria-valuenow, hidden, open…) and the checked state of inputs; what shows from the elements a reader
 * meets (controls, headings, paragraphs, list items, dialogs, images); text as lines with digits masked. What changed
 * where the page changes on its own (the harness's noise, and what changed in a wait with `noise`) is left out.
 */
export function installEffectWatch(): void {
  const w = window as unknown as EffectWindow & {
    __rampaKit: { describe(el: Element): InPageElement; visible(el: Element): boolean }
    __rampaActivate?: { noisy?(el: Element): boolean }
  }
  if (w.__rampaEffect) return
  const kit = w.__rampaKit
  const collapse = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim()
  const cut = (value: string, n: number) => (value.length > n ? `${value.slice(0, n - 1)}…` : value)
  const STATES = ['aria-expanded', 'aria-pressed', 'aria-checked', 'aria-selected', 'aria-current', 'aria-valuenow', 'aria-valuetext', 'aria-hidden', 'hidden', 'open', 'aria-disabled']
  const TRACK =
    'a[href],button,input,select,textarea,summary,details,dialog,[role],[tabindex],[aria-expanded],[aria-pressed],[aria-checked],[aria-selected],[aria-current],[aria-hidden],[hidden],img,svg,video,canvas,iframe,h1,h2,h3,h4,h5,h6,p,li,dt,dd,td,th,label,section,article,form,table,ul,ol,nav,figure,blockquote,output'
  const SKIP = new Set(['script', 'style', 'link', 'meta', 'noscript', 'template'])
  const quiet = new WeakSet<Element>()
  // The harness's noise, unless it learned the body itself as noise (a class set on html after load), which says nothing.
  const noisy = (el: Element): boolean => {
    const activate = w.__rampaActivate
    if (activate?.noisy && document.body && !activate.noisy(document.body) && activate.noisy(el)) return true
    for (let a: Element | null = el, i = 0; a && a !== document.body && i < 12; a = a.parentElement, i++) if (quiet.has(a)) return true
    return false
  }
  // A frame that is not the page's own (an advertisement, an embed) loads and shows on its own schedule.
  const embed = (el: Element): boolean => {
    if (el.localName !== 'iframe') return false
    const src = el.getAttribute('src') ?? ''
    try {
      return src === '' || src === 'about:blank' || new URL(src, location.href).origin !== location.origin
    } catch {
      return true
    }
  }
  const stateOf = (el: Element): Map<string, string> => {
    const map = new Map<string, string>()
    for (const name of STATES) {
      const value = el.getAttribute(name)
      if (value !== null) map.set(name, value)
    }
    if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) map.set('checked', String(el.checked))
    if (el instanceof HTMLDetailsElement || el instanceof HTMLDialogElement) map.set('open', String(el.open))
    return map
  }
  interface Entry {
    shown: boolean
    state: Map<string, string>
  }
  const showing = (el: Element): boolean => {
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0 && kit.visible(el)
  }
  const snap = (): Map<Element, Entry> => {
    const map = new Map<Element, Entry>()
    const list = document.body ? document.body.querySelectorAll(TRACK) : []
    for (let i = 0; i < list.length && i < 6000; i++) {
      const el = list[i] as Element
      if (SKIP.has(el.localName)) continue
      map.set(el, { shown: showing(el), state: stateOf(el) })
    }
    return map
  }
  // The text each showing element holds in its own text nodes.
  const texts = (): Map<Element, string> => {
    const map = new Map<Element, string>()
    if (!document.body) return map
    const shownCache = new Map<Element, boolean>()
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(), i = 0; n && i < 30_000; n = walker.nextNode(), i++) {
      const value = collapse(n.nodeValue)
      const parent = n.parentElement
      if (!value || !parent || SKIP.has(parent.localName)) continue
      let shown = shownCache.get(parent)
      if (shown === undefined) {
        shown = showing(parent)
        shownCache.set(parent, shown)
      }
      if (shown) map.set(parent, `${map.get(parent) ?? ''} ${value}`.trim())
    }
    return map
  }
  const linksIn = (el: Element): number => Array.from(el.querySelectorAll('a[href]')).filter((a) => showing(a)).length
  const item = (el: Element, removed: boolean): EffectItem => {
    if (removed || !el.isConnected) return { ref: '', tag: el.localName, label: cut(collapse(el.textContent), 80) }
    const d = kit.describe(el)
    const links = linksIn(el)
    return { ref: d.ref, tag: d.tag, label: d.label, ...(links > 0 ? { links } : {}) }
  }
  // Only the outermost of elements that showed (or hid) together.
  const outermost = (els: Element[]): Element[] => {
    const set = new Set(els)
    return els.filter((el) => {
      for (let a = el.parentElement; a; a = a.parentElement) if (set.has(a)) return false
      return true
    })
  }
  let before: { map: Map<Element, Entry>; texts: Map<Element, string> } | undefined
  w.__rampaEffect = {
    begin() {
      before = { map: snap(), texts: texts() }
    },
    end(args) {
      const from = before ?? { map: new Map<Element, Entry>(), texts: new Map<Element, string>() }
      const after = snap()
      const states: StateChange[] = []
      let stateCount = 0
      const shownEls: Element[] = []
      const hiddenEls: Element[] = []
      for (const [el, now] of after) {
        const was = from.map.get(el)
        if (now.shown && (!was || !was.shown)) {
          if (args.noise) quiet.add(el)
          else if (!noisy(el) && !embed(el)) shownEls.push(el)
        }
        if (!was) continue
        if (!now.shown && was.shown) {
          if (args.noise) quiet.add(el)
          else if (!noisy(el) && !embed(el)) hiddenEls.push(el)
        }
        const names = new Set([...was.state.keys(), ...now.state.keys()])
        for (const name of names) {
          const a = was.state.get(name) ?? '(none)'
          const b = now.state.get(name) ?? '(none)'
          if (a === b) continue
          if (args.noise) {
            quiet.add(el)
            continue
          }
          if (noisy(el)) continue
          stateCount++
          if (states.length < 12) {
            const d = kit.describe(el)
            states.push({ ref: d.ref, tag: d.tag, label: d.label, attr: name, from: cut(a, 40), to: cut(b, 40) })
          }
        }
      }
      for (const [el, was] of from.map) {
        if (after.has(el) || !was.shown) continue
        // Removed from the page.
        if (args.noise) quiet.add(el)
        else if (!noisy(el) && !embed(el)) hiddenEls.push(el)
      }
      // Text, element by element: what an element shows now that it did not, and what it no longer shows.
      const now = texts()
      const addedKept: string[] = []
      const removedKept: string[] = []
      for (const [el, text] of now) {
        const was = from.texts.get(el)
        // Digits masked: a clock that ticks is not new text.
        if (was !== undefined && was.replace(/\d/g, '0') === text.replace(/\d/g, '0')) continue
        if (args.noise) {
          quiet.add(el)
          continue
        }
        if (noisy(el)) continue
        addedKept.push(text)
        if (was !== undefined) removedKept.push(was)
      }
      for (const [el, was] of from.texts) {
        if (now.has(el)) continue
        if (args.noise) {
          quiet.add(el)
          continue
        }
        if (!noisy(el)) removedKept.push(was)
      }
      const shown = outermost(shownEls)
      const hidden = outermost(hiddenEls)
      before = undefined
      if (args.noise) return { states: [], shown: [], hidden: [], counts: { states: 0, shown: 0, hidden: 0 }, text: { added: [], removed: [], changed: 0 } }
      return {
        states,
        shown: shown.slice(0, 20).map((el) => item(el, false)),
        hidden: hidden.slice(0, 20).map((el) => item(el, !el.isConnected)),
        counts: { states: stateCount, shown: shown.length, hidden: hidden.length },
        text: {
          added: addedKept.slice(0, 6).map((line) => cut(line, 100)),
          removed: removedKept.slice(0, 6).map((line) => cut(line, 100)),
          changed: [...addedKept, ...removedKept].reduce((sum, line) => sum + line.length, 0),
        },
      }
    },
  }
}

/** Runs in the page; needs the kit and the activate kit. The controls whose keyboard support is the page's own doing. */
export function findParityControls(args: { max: number; cursorMax: number }): { found: number; controls: Array<ParityControl & { facts: ControlFacts }> } {
  const w = window as unknown as {
    __rampaKit: { describe(el: Element): InPageElement; visible(el: Element): boolean; cssPath(el: Element): string }
    __rampaActivate: { facts(el: Element): ControlFacts }
  }
  const kit = w.__rampaKit
  const collapse = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim()
  const cut = (value: string, n: number) => (value.length > n ? `${value.slice(0, n - 1)}…` : value)
  const NATIVE = 'a[href],area[href],button,input:not([type=hidden]),select,textarea,summary,iframe,label,video,audio,[contenteditable]:not([contenteditable=false])'
  const ROLES = new Set(['button', 'link', 'checkbox', 'radio', 'switch', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'treeitem', 'slider', 'spinbutton', 'combobox'])
  const ITEMS = new Set(['tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'treeitem', 'radio'])
  const OTHER_ROLES = new Set(['textbox', 'searchbox', 'scrollbar', 'tablist', 'menu', 'menubar', 'listbox', 'tree', 'grid', 'treegrid', 'gridcell', 'radiogroup', 'toolbar', 'dialog', 'alertdialog', 'application'])
  const CONTROL = `${NATIVE},${[...ROLES].map((role) => `[role=${role}]`).join(',')}`
  const WIDGETS = '[role=tablist],[role=menu],[role=menubar],[role=listbox],[role=radiogroup],[role=tree],[role=treegrid],[role=grid],[role=toolbar]'
  const POINTER = new Set(['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'touchend'])
  const KEYS = new Set(['keydown', 'keyup', 'keypress'])
  const SKIP = new Set(['html', 'head', 'body', 'script', 'style', 'link', 'meta', 'noscript', 'template', 'title', 'base', 'br', 'hr', 'option', 'optgroup', 'source', 'track'])
  const area = Math.max(1, window.innerWidth * window.innerHeight)
  const roleOf = (el: Element) => (collapse(el.getAttribute('role')).toLowerCase().split(' ')[0] ?? '')
  const own = (el: Element): string[] => {
    const types = new Set(((el as unknown as { __rampaParityListen?: string }).__rampaParityListen ?? '').split(' ').filter(Boolean))
    for (const type of ['click', ...POINTER, ...KEYS]) if (el.hasAttribute(`on${type}`)) types.add(type)
    return [...types].sort()
  }
  const showing = (el: Element) => {
    const r = el.getBoundingClientRect()
    return r.width >= 4 && r.height >= 4 && kit.visible(el)
  }
  const textOf = (el: Element | null | undefined) => collapse((el as HTMLElement | null)?.innerText ?? el?.textContent)
  const textsNear = (el: Element, label: string): string[] => {
    const texts = [label, collapse(el.getAttribute('title')), collapse(el.getAttribute('aria-label'))]
    for (const id of (el.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean)) texts.push(textOf(document.getElementById(id)))
    for (let a = el.parentElement, n = 0; a && n < 3 && a !== document.body; a = a.parentElement, n++) {
      const text = textOf(a)
      if (text.length > 0 && text.length <= 300) texts.push(text)
    }
    for (let s = el.previousElementSibling, n = 0; s && n < 2; s = s.previousElementSibling, n++) {
      const text = textOf(s)
      if (text.length > 0 && text.length <= 200) texts.push(text)
    }
    return [...new Set(texts.map((t) => cut(t, 300)).filter(Boolean))].slice(0, 6)
  }
  const buckets: Record<ParityWhy, Element[]> = { role: [], 'pointer-only': [], handler: [], cursor: [] }
  const reasons = new Map<Element, { why: ParityWhy; listeners: string[] }>()
  const chosen = new Set<Element>()
  const insideChosen = (el: Element) => {
    for (let a = el.parentElement; a; a = a.parentElement) if (chosen.has(a)) return true
    return false
  }
  const all = document.body ? document.body.getElementsByTagName('*') : ([] as unknown as HTMLCollectionOf<Element>)
  let cursorsSeen = 0
  for (let i = 0; i < all.length && i < 20_000; i++) {
    const el = all[i] as Element
    if (SKIP.has(el.localName)) continue
    if (el.localName !== 'svg' && el.closest('svg')) continue
    const types = own(el)
    const native = el.matches(NATIVE)
    const role = roleOf(el)
    const pointer = types.some((t) => POINTER.has(t))
    const keyed = types.some((t) => KEYS.has(t))
    let why: ParityWhy | undefined
    if (ROLES.has(role) && (!native || (ITEMS.has(role) && (el as HTMLElement).tabIndex < 0))) why = 'role'
    else if (pointer && !types.includes('click') && !keyed) why = 'pointer-only'
    else if (!native && role === '' && types.includes('click')) why = 'handler'
    else if (!native && (role === '' || role === 'presentation' || role === 'none' || role === 'generic') && types.length === 0 && cursorsSeen < args.cursorMax * 4) {
      const style = getComputedStyle(el)
      if (style.cursor !== 'pointer') continue
      if (el.parentElement && getComputedStyle(el.parentElement).cursor === 'pointer') continue
      cursorsSeen++
      why = 'cursor'
    }
    if (!why) continue
    if (OTHER_ROLES.has(role)) continue
    // The keys and the click go to the control around it.
    if (el.parentElement?.closest(CONTROL)) continue
    if (insideChosen(el)) continue
    if (el.closest('[inert]')) continue
    if (!showing(el)) continue
    const r = el.getBoundingClientRect()
    // A wrapper the size of the page that listens for its children's clicks is not a control.
    if (why !== 'role' && (r.width * r.height) / area > 0.5) continue
    chosen.add(el)
    buckets[why].push(el)
    reasons.set(el, { why, listeners: types })
  }
  const ordered = [...buckets.role, ...buckets['pointer-only'], ...buckets.handler, ...buckets.cursor.slice(0, args.cursorMax)]
  const found = buckets.role.length + buckets['pointer-only'].length + buckets.handler.length + buckets.cursor.length
  const controls: Array<ParityControl & { facts: ControlFacts }> = []
  for (const el of ordered) {
    if (controls.length >= args.max) break
    const reason = reasons.get(el)
    if (!reason) continue
    const described = kit.describe(el)
    const widget = el.parentElement?.closest(WIDGETS)
    const haspopup = el.getAttribute('aria-haspopup')
    controls.push({
      ...described,
      why: reason.why,
      ...(reason.listeners.length > 0 ? { listeners: reason.listeners } : {}),
      ...(widget ? { widget: { ref: kit.cssPath(widget), role: roleOf(widget) } } : {}),
      ...(haspopup && haspopup !== 'false' ? { haspopup } : {}),
      texts: textsNear(el, described.label),
      facts: w.__rampaActivate.facts(el),
    })
  }
  return { found, controls }
}

/**
 * The keys a person would use on a control, in the order they are tried. An item of a composite widget (a tab, a
 * menu item, an option) is reached with the arrows from the item Tab reaches, so those come first.
 */
export function keyPaths(control: Pick<ParityControl, 'role' | 'widget' | 'haspopup'>): KeyPath[] {
  const paths: KeyPath[] = []
  if (control.widget && COMPOSITE_ITEMS.has(control.role)) {
    paths.push({ path: 'arrive', setup: 'arrive', keys: [] }, { path: 'arrive, Enter', setup: 'arrive', keys: ['Enter'] }, { path: 'arrive, Space', setup: 'arrive', keys: ['Space'] })
  }
  paths.push({ path: 'Enter', setup: 'self', keys: ['Enter'] }, { path: 'Space', setup: 'self', keys: ['Space'] })
  if (['slider', 'spinbutton', 'scrollbar'].includes(control.role)) {
    paths.push({ path: 'ArrowRight', setup: 'self', keys: ['ArrowRight'] }, { path: 'ArrowUp', setup: 'self', keys: ['ArrowUp'] })
  }
  if (control.role === 'combobox' || (control.haspopup !== undefined && control.haspopup !== 'false')) paths.push({ path: 'ArrowDown', setup: 'self', keys: ['ArrowDown'] })
  return paths
}

/**
 * The attempts that reach the control as a keyboard does: through the arrows of its widget, which must get focus to
 * it, and, for an item of a widget, focus on the item itself only when Tab reaches it.
 */
export function reachingAttempts(keys: readonly KeyAttempt[]): KeyAttempt[] {
  const list = listOf<KeyAttempt>(keys)
  const composite = list.some((k) => typeof k.path === 'string' && k.path.startsWith('arrive'))
  return list.filter((k) => k.focused && (k.path.startsWith('arrive') ? k.arrived === true : !composite || k.tabbable !== false))
}

interface TargetWindow {
  __rampaTarget?: Element | null
  __rampaSelf?: boolean
  __rampaKit: { describe(el: Element): InPageElement; visible(el: Element): boolean; deepActive(): Element | null; cssPath(el: Element): string }
}

/** Runs in the page: gives the located control focus, as a script would. */
export function focusParityTarget(): { focused: boolean; tabbable: boolean } {
  const w = window as unknown as TargetWindow
  const el = w.__rampaTarget as HTMLElement | null | undefined
  if (!el?.isConnected || typeof el.focus !== 'function') return { focused: false, tabbable: false }
  w.__rampaSelf = true
  try {
    el.focus({ preventScroll: true })
  } finally {
    w.__rampaSelf = false
  }
  const focused = w.__rampaKit.deepActive() === el
  // An anchor with no address reports tabIndex 0 but takes no focus from Tab.
  const bare = (el.localName === 'a' || el.localName === 'area') && !el.hasAttribute('href') && !el.hasAttribute('tabindex')
  return { focused, tabbable: focused && el.tabIndex >= 0 && !bare }
}

/**
 * Runs in the page: focuses the item of the located control's widget that Tab reaches (tabindex 0), or the widget
 * itself when it holds focus for its items (aria-activedescendant), and says which arrow keys lead to the control.
 */
export function arriveStart(): { focused: boolean; tabbable: boolean; from?: string; keys?: string[] } {
  const w = window as unknown as TargetWindow
  const target = w.__rampaTarget as HTMLElement | null | undefined
  if (!target?.isConnected) return { focused: false, tabbable: false }
  const WIDGETS = '[role=tablist],[role=menu],[role=menubar],[role=listbox],[role=radiogroup],[role=tree],[role=treegrid],[role=grid],[role=toolbar]'
  const widget = target.parentElement?.closest(WIDGETS) as HTMLElement | null | undefined
  if (!widget) return { focused: false, tabbable: false }
  const ITEMS = '[role=tab],[role=menuitem],[role=menuitemcheckbox],[role=menuitemradio],[role=option],[role=treeitem],[role=radio]'
  const items = Array.from(widget.querySelectorAll<HTMLElement>(ITEMS)).filter((item) => item.parentElement?.closest(WIDGETS) === widget)
  let start: HTMLElement | undefined = items.find((item) => item !== target && item.tabIndex >= 0 && w.__rampaKit.visible(item))
  if (!start && widget.tabIndex >= 0) start = widget
  if (!start) return { focused: false, tabbable: false }
  const role = (widget.getAttribute('role') ?? '').toLowerCase()
  const orientation = widget.getAttribute('aria-orientation') ?? (['tablist', 'menubar', 'toolbar'].includes(role) ? 'horizontal' : 'vertical')
  const forward = start === widget || Boolean(start.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING)
  const primary = orientation === 'horizontal' ? (forward ? 'ArrowRight' : 'ArrowLeft') : forward ? 'ArrowDown' : 'ArrowUp'
  const other = orientation === 'horizontal' ? (forward ? 'ArrowDown' : 'ArrowUp') : forward ? 'ArrowRight' : 'ArrowLeft'
  w.__rampaSelf = true
  try {
    start.focus({ preventScroll: true })
  } finally {
    w.__rampaSelf = false
  }
  const focused = w.__rampaKit.deepActive() === start
  return { focused, tabbable: focused, from: w.__rampaKit.describe(start).label || w.__rampaKit.cssPath(start), keys: [primary, other] }
}

/** Runs in the page: focus is on the located control, or its widget points at it with aria-activedescendant. */
export function arrivedAt(): boolean {
  const w = window as unknown as TargetWindow
  const target = w.__rampaTarget
  const active = w.__rampaKit.deepActive()
  if (!target || !active) return false
  if (active === target) return true
  const descendant = active.getAttribute('aria-activedescendant')
  return Boolean(descendant && target.id === descendant)
}

/** Runs in the page: where focus is, by ref. */
export function activeRef(): string {
  const w = window as unknown as TargetWindow
  const active = w.__rampaKit.deepActive()
  return active ? w.__rampaKit.cssPath(active) : ''
}

/** Runs in the page: takes focus off whatever has it, as a script would. */
export function blurParity(): void {
  const w = window as unknown as TargetWindow
  w.__rampaSelf = true
  try {
    ;(w.__rampaKit.deepActive() as HTMLElement | null)?.blur?.()
  } finally {
    w.__rampaSelf = false
  }
}

/**
 * Runs in the page: while on, Space, the arrows, Page Up and Down, Home and End do not scroll the page when the
 * page's own handlers left them alone on an element that is not a native control. The browser's scroll would
 * otherwise show and hide content (lazy images, sticky bars) and pass for the key's effect.
 */
export function holdScroll(on: boolean): void {
  const w = window as unknown as { __rampaHold?: boolean; __rampaHoldSet?: boolean }
  w.__rampaHold = on
  if (w.__rampaHoldSet) return
  w.__rampaHoldSet = true
  const NATIVE = 'input,select,textarea,button,summary,a[href],[contenteditable]:not([contenteditable=false]),video,audio,iframe'
  const KEYS = new Set([' ', 'Spacebar', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End'])
  window.addEventListener('keydown', (event) => {
    if (!w.__rampaHold || event.defaultPrevented || !KEYS.has(event.key)) return
    const target = event.composedPath()[0]
    if (target instanceof Element && target.closest(NATIVE)) return
    event.preventDefault()
  })
}

/**
 * Runs in the page: the focusable element inside the located control that a click at this point would land on, if
 * there is one: then that element is what the pointer operates, and the control is left to it.
 */
export function hitDelegate(point: { x: number; y: number }): InPageElement | null {
  const w = window as unknown as TargetWindow
  const target = w.__rampaTarget
  if (!target) return null
  let hit = document.elementFromPoint(point.x, point.y)
  while (hit?.shadowRoot) {
    const inner = hit.shadowRoot.elementFromPoint(point.x, point.y)
    if (!inner || inner === hit) break
    hit = inner
  }
  if (!hit || hit === target || !target.contains(hit)) return null
  const FOCUSABLE = 'a[href],area[href],button,input:not([type=hidden]),select,textarea,summary,[tabindex]:not([tabindex="-1"]),[contenteditable]:not([contenteditable=false])'
  const inner = hit.closest(FOCUSABLE)
  if (!inner || inner === target || !target.contains(inner)) return null
  return w.__rampaKit.describe(inner)
}

/** Runs in the page: a link Tab reaches, outside the located control, whose address is `url` (fragment aside). */
export function sameAddress(args: { url: string }): { ref: string; label: string; href: string } | null {
  const w = window as unknown as TargetWindow
  const target = w.__rampaTarget
  const bare = (value: string) => value.replace(/#.*$/, '').replace(/\/$/, '')
  let wanted: string
  try {
    wanted = bare(new URL(args.url, location.href).href)
  } catch {
    return null
  }
  for (const a of Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
    // A link inside the control counts (a card whose title is a link): it is the way a keyboard gets there.
    if (a === target || (target && a.contains(target))) continue
    if (a.tabIndex < 0 || !w.__rampaKit.visible(a) || a.getBoundingClientRect().width < 1) continue
    if (a.closest('[inert],[aria-hidden="true"]')) continue
    if (bare(a.href) === wanted) return { ref: w.__rampaKit.cssPath(a), label: w.__rampaKit.describe(a).label, href: a.href }
  }
  return null
}

/**
 * Runs in the page; needs the kit. Menus of links a pointer shows by hovering: links the page hides (display: none,
 * visibility: hidden) whose hidden container sits in a small element that shows. Links hidden by other means (moved
 * off the page, clipped, transparent) still take focus from Tab, so they are left out.
 */
export function findHoverMenus(args: { max: number }): { found: number; menus: HoverMenu[] } {
  const w = window as unknown as { __rampaKit: { describe(el: Element): InPageElement; visible(el: Element): boolean } }
  const kit = w.__rampaKit
  const shows = (el: Element) => (typeof el.checkVisibility === 'function' ? el.checkVisibility({ visibilityProperty: true } as CheckVisibilityOptions) : true)
  const area = Math.max(1, window.innerWidth * window.innerHeight)
  const FOCUSABLE = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[tabindex]:not([tabindex="-1"])'
  const containers = new Map<Element, HTMLAnchorElement[]>()
  for (const a of Array.from(document.querySelectorAll<HTMLAnchorElement>('body a[href]'))) {
    if (shows(a)) continue
    const href = a.getAttribute('href') ?? ''
    if (href === '' || href.startsWith('#') || /^javascript:/i.test(href)) continue
    if (a.closest('template,noscript,dialog,[role=dialog],[role=alertdialog],[aria-modal=true],details:not([open])')) continue
    // The outermost ancestor that does not show, under one that does.
    let root: Element = a
    while (root.parentElement && root.parentElement !== document.body && !shows(root.parentElement)) root = root.parentElement
    if (root === a || !root.parentElement || root.parentElement === document.body) continue
    containers.set(root, [...(containers.get(root) ?? []), a])
  }
  const menus: HoverMenu[] = []
  let found = 0
  for (const [container, links] of containers) {
    const trigger = container.parentElement
    if (!trigger || !shows(trigger)) continue
    const r = trigger.getBoundingClientRect()
    if (r.width < 4 || r.height < 4 || (r.width * r.height) / area > 0.25) continue
    found++
    if (menus.length >= args.max) continue
    const focusable = Array.from(trigger.querySelectorAll(FOCUSABLE)).find((el) => !container.contains(el) && kit.visible(el)) ?? (trigger.matches(FOCUSABLE) ? trigger : undefined)
    menus.push({
      trigger: kit.describe(trigger),
      ...(focusable ? { focusable: { ...kit.describe(focusable), ...(focusable instanceof HTMLAnchorElement ? { href: focusable.href } : {}) } } : {}),
      container: kit.describe(container),
      links: links.slice(0, 12).map((link) => ({ href: link.href, label: kit.describe(link).label })),
      linkCount: links.length,
    })
  }
  return { found, menus }
}

interface MenuWindow {
  __rampaMenu?: { trigger: Element; container: Element; focusable: Element | null }
  __rampaSelf?: boolean
  __rampaKit: { resolve(ref: string): Element | null; identity(el: Element): { sig: string }; visible(el: Element): boolean; deepActive(): Element | null; cssPath(el: Element): string; describe(el: Element): InPageElement }
}

/** Runs in the page: finds a hover menu again by its refs and identities. */
export function locateMenu(args: { trigger: string; triggerSig: string; container: string; containerSig: string; focusable?: string | undefined }): boolean {
  const w = window as unknown as MenuWindow
  const kit = w.__rampaKit
  const trigger = kit.resolve(args.trigger)
  const container = kit.resolve(args.container)
  if (!trigger || !container || kit.identity(trigger).sig !== args.triggerSig || kit.identity(container).sig !== args.containerSig) return false
  const focusable = args.focusable ? kit.resolve(args.focusable) : null
  w.__rampaMenu = { trigger, container, focusable }
  return true
}

/** Runs in the page: the located menu shows, with at least one of its links. */
export function menuShown(): boolean {
  const w = window as unknown as MenuWindow
  const menu = w.__rampaMenu
  if (!menu?.container.isConnected) return false
  const shows = (el: Element) => (typeof el.checkVisibility === 'function' ? el.checkVisibility({ visibilityProperty: true } as CheckVisibilityOptions) : true)
  if (!shows(menu.container)) return false
  return Array.from(menu.container.querySelectorAll('a[href]')).some((a) => shows(a) && a.getBoundingClientRect().width > 0)
}

/** Runs in the page: focus the located menu's trigger as a keyboard would reach it. */
export function focusMenu(): boolean {
  const w = window as unknown as MenuWindow
  const el = w.__rampaMenu?.focusable as HTMLElement | null | undefined
  if (!el?.focus) return false
  w.__rampaSelf = true
  try {
    el.focus({ preventScroll: true })
  } finally {
    w.__rampaSelf = false
  }
  return w.__rampaKit.deepActive() === el
}

/** Runs in the page: focus is inside the located menu. */
export function focusInMenu(): boolean {
  const w = window as unknown as MenuWindow
  const active = w.__rampaKit.deepActive()
  return Boolean(active && w.__rampaMenu?.container.contains(active))
}

/** Runs in the page: the located menu's links whose address a link Tab reaches elsewhere on the page also has. */
export function menuElsewhere(): { elsewhere: number; missing: Array<{ href: string; label: string }> } {
  const w = window as unknown as MenuWindow
  const menu = w.__rampaMenu
  if (!menu) return { elsewhere: 0, missing: [] }
  const bare = (value: string) => value.replace(/#.*$/, '').replace(/\/$/, '')
  const shows = (el: Element) => (typeof el.checkVisibility === 'function' ? el.checkVisibility({ visibilityProperty: true } as CheckVisibilityOptions) : true)
  const reachable = new Set<string>()
  for (const a of Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
    if (menu.container.contains(a) || a.tabIndex < 0 || !shows(a) || a.closest('[inert]')) continue
    reachable.add(bare(a.href))
  }
  let elsewhere = 0
  const missing: Array<{ href: string; label: string }> = []
  for (const a of Array.from(menu.container.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
    if (reachable.has(bare(a.href))) elsewhere++
    else if (missing.length < 12) missing.push({ href: a.href, label: w.__rampaKit.describe(a).label })
  }
  return { elsewhere, missing }
}

/** The exit-hint reading of A7 (keyboard.ts, trapContext): text that names a key to press. */
export const EXIT_TEXT = /\b(press|pressione|presione|use|tecle)\b[^.\n]{0,40}\b(esc|escape|ctrl|control|alt|shift|tab|f\d{1,2})\b/i

/** Runs in the page: whether any text names a key to press to leave something. */
export function exitTextOnPage(source: string): boolean {
  return new RegExp(source, 'i').test((document.body?.innerText ?? '').slice(0, 100_000))
}

const MODIFIERS: Record<string, string> = { ctrl: 'Control', control: 'Control', alt: 'Alt', option: 'Alt', shift: 'Shift', meta: 'Meta', cmd: 'Meta', command: 'Meta' }
const NAMED: Record<string, string> = { esc: 'Escape', escape: 'Escape', tab: 'Tab', enter: 'Enter' }

/**
 * The key combinations an exit instruction names, as Playwright presses them: "Press Ctrl+M to leave" gives
 * `Control+m`, "pressione Esc" gives `Escape`, "Alt + Shift + F6" gives `Alt+Shift+F6`. A single letter or digit
 * counts only with a modifier.
 */
export function exitKeys(hint: string): string[] {
  const keys: string[] = []
  const pattern = /((?:\b(?:ctrl|control|alt|option|shift|meta|cmd|command)\s*[+-]\s*)*)\b(esc|escape|tab|enter|f\d{1,2}|[a-z0-9])\b/gi
  for (const match of hint.matchAll(pattern)) {
    const mods = (match[1] ?? '')
      .split(/[+-]/)
      .map((m) => m.trim().toLowerCase())
      .filter(Boolean)
      .map((m) => MODIFIERS[m] ?? '')
      .filter(Boolean)
    const raw = (match[2] ?? '').toLowerCase()
    const named = NAMED[raw] ?? (/^f\d{1,2}$/.test(raw) ? raw.toUpperCase() : undefined)
    if (!named && mods.length === 0) continue
    const key = named ?? raw
    const combo = [...new Set(mods), key].join('+')
    if (!keys.includes(combo)) keys.push(combo)
  }
  return keys.slice(0, 3)
}

// Effects, compared as facts: the rules (rules/parity.ts) and the 2.1.1 judgment read the same functions.

/** An effect from the harness's window and the page's net change. */
export function effectOf(watch: Watch, net: NetEffect | undefined): Effect {
  const events: EffectEvent[] = []
  for (const n of watch.navigations ?? []) {
    if (n.download) events.push({ kind: 'download', detail: n.url })
    else if (!n.same) events.push({ kind: 'navigation', detail: n.url })
  }
  for (const url of watch.windows ?? []) events.push({ kind: 'window', detail: url })
  for (const action of watch.submits ?? []) events.push({ kind: 'submit', detail: action })
  for (const dialog of watch.dialogs ?? []) events.push({ kind: 'dialog', detail: dialog })
  if ((watch.modals ?? 0) > 0) events.push({ kind: 'modal' })
  if (watch.url) events.push({ kind: watch.hashOnly ? 'fragment' : 'route', detail: watch.url })
  const opened = watch.opened
  return {
    events,
    ...(opened ? { opened: { ref: opened.ref, id: opened.id, tag: opened.tag, name: opened.name, modal: opened.modal } } : {}),
    states: net?.states ?? [],
    shown: net?.shown ?? [],
    hidden: net?.hidden ?? [],
    counts: net?.counts ?? { states: 0, shown: 0, hidden: 0 },
    text: net?.text ?? { added: [], removed: [], changed: 0 },
    ...(watch.scroll ? { scroll: watch.scroll } : {}),
    ...(watch.focus ? { focus: { ref: watch.focus.ref, tag: watch.focus.tag, label: watch.focus.label } } : {}),
  }
}

const listOf = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : [])

/**
 * Nothing happened: no event, no layer, no state, nothing shown or hidden, under MIN_TEXT characters of text. A scroll
 * counts for a click and for Enter only: Space and the arrows scroll the page by default.
 */
export function effectEmpty(effect: Effect | undefined, path?: string): boolean {
  if (!effect) return true
  if (listOf(effect.events).length > 0 || effect.opened) return false
  if (listOf(effect.states).length > 0 || (effect.counts?.shown ?? 0) > 0 || (effect.counts?.hidden ?? 0) > 0) return false
  if ((effect.text?.changed ?? 0) >= MIN_TEXT) return false
  const scrolls = path === undefined || path === 'Enter'
  if (scrolls && effect.scroll && Math.abs(effect.scroll.x) + Math.abs(effect.scroll.y) >= MIN_SCROLL) return false
  return true
}

const bareUrl = (value: string | undefined) => (value ?? '').replace(/#.*$/, '').replace(/\/$/, '')
const related = (a: string, b: string) => a === b || a.startsWith(`${b} > `) || b.startsWith(`${a} > `)

/**
 * Whether what the keys did (and what focus did before them) covers what the click did: every navigation, window,
 * submission, download and address of the click with the same address, its dialog and layer, every state attribute
 * it changed on the same element, every element it showed or hid (or one inside or around it), and a change of text
 * when it changed text. The keys may do more (move focus, change more).
 */
export function covers(click: Effect, keys: Array<Effect | undefined>): boolean {
  const effects = keys.filter((e): e is Effect => e !== undefined)
  const events = effects.flatMap((e) => listOf<EffectEvent>(e.events))
  for (const event of listOf<EffectEvent>(click.events)) {
    if (event.kind === 'dialog') {
      if (!events.some((e) => e.kind === 'dialog')) return false
    } else if (event.kind === 'modal') {
      if (!events.some((e) => e.kind === 'modal') && !effects.some((e) => e.opened?.modal)) return false
    } else if (event.kind === 'fragment') {
      if (!events.some((e) => (e.kind === 'fragment' || e.kind === 'route') && e.detail === event.detail) && !effects.some((e) => e.scroll)) return false
    } else if (!events.some((e) => e.kind === event.kind && bareUrl(e.detail) === bareUrl(event.detail))) return false
  }
  const opened = click.opened
  if (opened && !effects.some((e) => e.opened && (e.opened.ref === opened.ref || (opened.name !== '' && e.opened.name === opened.name))) && !events.some((e) => e.kind === 'modal')) return false
  const states = new Set(effects.flatMap((e) => listOf<StateChange>(e.states).map((s) => `${s.ref}|${s.attr}`)))
  if (listOf<StateChange>(click.states).some((s) => !states.has(`${s.ref}|${s.attr}`))) return false
  const shown = effects.flatMap((e) => listOf<EffectItem>(e.shown).map((s) => s.ref))
  if (listOf<EffectItem>(click.shown).some((s) => s.ref !== '' && !shown.some((ref) => ref !== '' && related(ref, s.ref)))) return false
  const hidden = effects.flatMap((e) => listOf<EffectItem>(e.hidden))
  for (const item of listOf<EffectItem>(click.hidden)) {
    if (item.ref !== '' ? !hidden.some((h) => h.ref !== '' && related(h.ref, item.ref)) : !hidden.some((h) => h.ref === '')) return false
  }
  if ((click.text?.changed ?? 0) >= MIN_TEXT && !effects.some((e) => (e.text?.changed ?? 0) >= MIN_TEXT)) return false
  return true
}

/** The probe's facts read as a parity result; the rule reads the same. */
export function parityResult(trial: Pick<ParityTrial, 'keys' | 'click'>): { result: ParityResult; match?: string | undefined } {
  if (!trial.click || effectEmpty(trial.click)) return { result: 'inert' }
  // An attempt counts when focus got there as a keyboard gets it there.
  const counted = reachingAttempts(listOf<KeyAttempt>(trial.keys))
  if (counted.length === 0) return { result: 'unreachable' }
  for (const attempt of counted) if (covers(trial.click, [attempt.focus, attempt.effect])) return { result: 'same', match: attempt.path }
  if (counted.every((k) => effectEmpty(k.effect, k.path))) return { result: 'none' }
  return { result: 'partial' }
}

/** What a trial says of the control, recomputed from its facts, with its confirmation on a second load. */
export interface ParityVerdict {
  control: ParityControl
  node: A11yNode
  result: 'none' | 'partial' | 'unreachable'
  /** none and unreachable: the same on a second load, where the click did something again. */
  confirmed: boolean
  status: 'failure' | 'review'
}

export interface ParityVerdicts {
  verdicts: ParityVerdict[]
  /** Controls whose click did something, whose facts match the snapshot. */
  applicable: number
  same: number
  inert: number
  unmatched: number
  /** The click went where a link Tab reaches also goes. */
  elsewhere: number
  /** Not focusable, with an explicit role: the keyboard walk's to report (2.1.1, rampa/keyboard-reach). */
  deferred: number
}

/**
 * 2.1.1's reading of the parity probe's facts. `walked`: a keyboard walk went round the same page, so a control with a
 * role that takes no focus at all is its finding, not this one's.
 */
export function parityVerdicts(data: Partial<ParityData>, index: TreeIndex, walked = false): ParityVerdicts {
  const out: ParityVerdicts = { verdicts: [], applicable: 0, same: 0, inert: 0, unmatched: 0, elsewhere: 0, deferred: 0 }
  for (const control of listOf<ParityControl>(data.controls)) {
    const trial = control?.trial
    if (!trial || trial.outcome || !trial.click) continue
    const { result } = parityResult(trial)
    if (result === 'inert') {
      out.inert++
      continue
    }
    const node = matchNode(index, control.ref, control.id)
    if (!node) {
      out.unmatched++
      continue
    }
    out.applicable++
    if (result === 'same') {
      out.same++
      continue
    }
    if (trial.elsewhere) {
      out.elsewhere++
      continue
    }
    // The walk's rule leaves out items of a widget it reached; anything else with a role that Tab missed is its finding.
    if (result === 'unreachable' && control.why === 'role' && !control.widget && walked) {
      out.deferred++
      continue
    }
    const confirm = trial.confirm
    const again = confirm && !confirm.outcome && confirm.click && !effectEmpty(confirm.click) ? parityResult(confirm).result : undefined
    const confirmed = result === 'partial' ? again !== 'same' : again === result
    out.verdicts.push({ control, node, result, confirmed, status: result === 'partial' || confirmed ? 'failure' : 'review' })
  }
  return out
}

/** Facts of an effect as short lines, each with an id ("C1", "K2") the 2.1.1 judgment cites. */
export function effectLines(effect: Effect | undefined, prefix: string, locale: 'en' | 'pt-BR' = 'en'): Array<{ id: string; text: string }> {
  if (!effect) return []
  const pt = locale === 'pt-BR'
  const t = (en: string, br: string) => (pt ? br : en)
  const lines: string[] = []
  const said = (item: EffectItem) => `<${item.tag}>${item.label ? ` "${item.label}"` : ''}`
  for (const event of listOf<EffectEvent>(effect.events)) {
    const detail = (event.detail ?? '').slice(0, 160)
    switch (event.kind) {
      case 'navigation':
        lines.push(t(`went to ${detail}`, `foi para ${detail}`))
        break
      case 'window':
        lines.push(t(`opened a new window at ${detail}`, `abriu uma nova janela em ${detail}`))
        break
      case 'submit':
        lines.push(t(`submitted a form to ${detail}`, `enviou um formulário para ${detail}`))
        break
      case 'download':
        lines.push(t(`downloaded ${detail}`, `baixou ${detail}`))
        break
      case 'dialog':
        lines.push(t(`showed a browser dialog: ${detail}`, `mostrou um diálogo do navegador: ${detail}`))
        break
      case 'modal':
        lines.push(t('opened a modal dialog', 'abriu um diálogo modal'))
        break
      case 'route':
        lines.push(t(`changed the address to ${detail} without loading a page`, `mudou o endereço para ${detail} sem carregar uma página`))
        break
      case 'fragment':
        lines.push(t(`moved to ${detail}`, `foi para ${detail}`))
        break
    }
  }
  const opened = effect.opened
  if (opened) {
    const name = opened.name ? ` "${opened.name}"` : ''
    lines.push(t(`showed a ${opened.modal ? 'modal ' : ''}dialog or layer${name}`, `mostrou um diálogo ${opened.modal ? 'modal ' : ''}ou camada${name}`))
  }
  const shown = listOf<EffectItem>(effect.shown).filter((item) => !opened || item.ref !== opened.ref)
  const hidden = listOf<EffectItem>(effect.hidden)
  for (const item of shown) lines.push(`${t('showed', 'mostrou')} ${said(item)}${item.links ? ` (${item.links} link(s))` : ''}`)
  for (const item of hidden) lines.push(`${item.ref === '' ? t('removed', 'removeu') : t('hid', 'ocultou')} ${said(item)}`)
  // The hidden or open attribute of an element that showed or hid is how it did: said once, above.
  const moved = new Set([...listOf<EffectItem>(effect.shown), ...hidden].map((item) => item.ref).concat(opened ? [opened.ref] : []))
  for (const s of listOf<StateChange>(effect.states)) {
    if ((s.attr === 'hidden' || s.attr === 'open' || s.attr === 'aria-hidden') && moved.has(s.ref)) continue
    const change =
      s.from === '(none)' ? `${s.attr} ${t('added', 'adicionado')}${s.to ? ` (${s.to})` : ''}` : s.to === '(none)' ? `${s.attr} ${t('removed', 'removido')}` : `${s.attr} ${s.from} → ${s.to}`
    lines.push(`<${s.tag}>${s.label ? ` "${s.label}"` : ''}: ${change}`)
  }
  const text = effect.text
  if (text && text.changed >= MIN_TEXT) {
    const quote = (list: unknown) =>
      listOf<string>(list)
        .slice(0, 3)
        .map((value) => `"${value}"`)
        .join(', ')
    const parts = [
      listOf<string>(text.added).length > 0 ? `${t('text added', 'texto adicionado')}: ${quote(text.added)}` : '',
      listOf<string>(text.removed).length > 0 ? `${t('text removed', 'texto removido')}: ${quote(text.removed)}` : '',
    ].filter(Boolean)
    if (parts.length > 0) lines.push(parts.join('; '))
  }
  if (effect.scroll && Math.abs(effect.scroll.x) + Math.abs(effect.scroll.y) >= MIN_SCROLL) lines.push(t(`scrolled the page by ${Math.round(effect.scroll.y)} px`, `rolou a página ${Math.round(effect.scroll.y)} px`))
  return lines.slice(0, 12).map((line, i) => ({ id: `${prefix}${i + 1}`, text: line }))
}

/** The key attempts of a trial worth showing: those where focus got to the control. */
export function attemptsOf(trial: Pick<ParityTrial, 'keys'>): KeyAttempt[] {
  return listOf<KeyAttempt>(trial.keys).filter((k) => k.focused)
}

/** The parity probe's record, when it is one these helpers read. */
export function parityRecord(records: readonly ProbeRecord[] | undefined): ProbeRecord | undefined {
  return records?.find((r) => r.kind === 'parity' && r.version === PARITY_VERSION && r.status !== 'skipped')
}

export function parityData(record: ProbeRecord): Partial<ParityData> {
  const data = record.data
  return (data && typeof data === 'object' && !Array.isArray(data) ? data : {}) as Partial<ParityData>
}

/** An executed exit instruction for a cycle that shares an element with `refs`, from the parity record, if any. */
export function exitFor(records: readonly ProbeRecord[] | undefined, refs: readonly string[]): TrapExit | undefined {
  const record = parityRecord(records)
  if (!record) return undefined
  const wanted = new Set(refs)
  return listOf<TrapExit>(parityData(record).traps).find((trap) => listOf<TrapExit['cycle'][number]>(trap?.cycle).some((el) => wanted.has(el.ref)) && listOf<string>(trap.keys).length > 0 && !trap.escaped)
}

// The probe.

/** Marks elements with their own click, pointer and key listeners (`__rampaParityListen`), read over the DevTools protocol. */
async function markParityListeners(probe: ProbePage): Promise<number | null> {
  try {
    const cdp = await probe.context.newCDPSession(probe.page)
    try {
      const { result } = await cdp.send('Runtime.evaluate', { expression: 'document' })
      if (!result.objectId) return null
      const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId, depth: -1, pierce: true })
      const TYPES = new Set(['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'touchend', 'keydown', 'keyup', 'keypress'])
      const byNode = new Map<number, Set<string>>()
      for (const listener of listeners) {
        if (!TYPES.has(listener.type) || !listener.backendNodeId) continue
        byNode.set(listener.backendNodeId, (byNode.get(listener.backendNodeId) ?? new Set()).add(listener.type))
      }
      let marked = 0
      for (const [backendNodeId, types] of [...byNode.entries()].slice(0, 600)) {
        try {
          const { object } = await cdp.send('DOM.resolveNode', { backendNodeId })
          if (!object.objectId) continue
          await cdp.send('Runtime.callFunctionOn', {
            objectId: object.objectId,
            functionDeclaration: 'function (types) { if (this.nodeType === 1) this.__rampaParityListen = types }',
            arguments: [{ value: [...types].join(' ') }],
          })
          marked++
        } catch {
          // The node went away.
        }
      }
      return marked
    } finally {
      await cdp.detach().catch(() => undefined)
    }
  } catch {
    return null
  }
}

/** The harness's page, with the effect watch installed and what changes on its own in a short wait learned. */
async function parityPage(harness: Harness, fresh: boolean): Promise<ProbePage> {
  const probe = await harness.page(fresh)
  const page = probe.page
  const installed = await page.evaluate(() => (window as unknown as EffectWindow).__rampaEffect !== undefined).catch(() => false)
  if (!installed) {
    await page.evaluate(installEffectWatch)
    await page.evaluate(holdScroll, false)
    await page.evaluate(() => (window as unknown as EffectWindow).__rampaEffect?.begin())
    await page.waitForTimeout(300)
    await page.evaluate(() => (window as unknown as EffectWindow).__rampaEffect?.end({ noise: true }))
  }
  return probe
}

async function measured(harness: Harness, probe: ProbePage, act: () => Promise<unknown>, options: { ms?: number; ref?: string; label?: string }): Promise<Effect> {
  await probe.page.evaluate(() => (window as unknown as EffectWindow).__rampaEffect?.begin()).catch(() => undefined)
  const watch = await harness.window(probe, act, options)
  const net = await probe.page.evaluate(() => (window as unknown as EffectWindow).__rampaEffect?.end({ noise: false })).catch(() => undefined)
  return effectOf(watch, net)
}

type Aimed = { x: number; y: number }

async function locateAndAim(harness: Harness, probe: ProbePage, control: ParityControl): Promise<Aimed | Pick<ParityTrial, 'outcome' | 'cover' | 'reason'>> {
  if (!(await harness.locate(probe, control))) return { outcome: 'unmatched' }
  const aimed = await harness.aim(probe, control)
  if ('cover' in aimed) return { outcome: 'not-exercised', cover: aimed.cover }
  if ('hidden' in aimed) {
    harness.log('not-exercised', { ref: control.ref, label: control.label, detail: 'not showing on this load' })
    return { outcome: 'not-exercised', reason: 'not showing on this load' }
  }
  return aimed
}

const isAimed = (value: Aimed | object): value is Aimed => 'x' in value

/** One key path on the page as it is: focus (and a wait with no key), then the keys. */
async function attempt(harness: Harness, probe: ProbePage, control: ParityControl, path: KeyPath): Promise<KeyAttempt> {
  const page = probe.page
  const labels = { ref: control.ref, label: control.label }
  await page.mouse.move(0, 0).catch(() => undefined)
  let start: { focused: boolean; tabbable: boolean; from?: string; keys?: string[] } = { focused: false, tabbable: false }
  const focus = await measured(
    harness,
    probe,
    async () => {
      start = await page.evaluate(path.setup === 'self' ? focusParityTarget : arriveStart)
    },
    { ...labels, ms: IDLE_MS },
  )
  if (!start.focused) return { path: path.path, focused: false, ...(path.setup === 'self' ? { tabbable: false } : {}) }
  const pressed: string[] = []
  // Set inside the window's input: a holder, so the reading after it is not narrowed away.
  const reach: { arrived?: boolean } = {}
  await page.evaluate(holdScroll, true)
  harness.log('activate', { ...labels, detail: `pressed ${path.path}` })
  const effect = await measured(
    harness,
    probe,
    async () => {
      if (path.setup === 'arrive') {
        const from = await page.evaluate(activeRef)
        reach.arrived = await page.evaluate(arrivedAt)
        for (const key of start.keys ?? []) {
          let n = 0
          while (!reach.arrived && n < MAX_ARRIVE) {
            await page.keyboard.press(key)
            n++
            reach.arrived = await page.evaluate(arrivedAt)
            // Focus did not move with this arrow: the widget runs the other way.
            if (n === 2 && !reach.arrived && (await page.evaluate(activeRef)) === from) break
          }
          if (n > 0) pressed.push(`${key} ×${n}`)
          if (reach.arrived) break
        }
        if (!reach.arrived) return
      }
      for (const key of path.keys) {
        await page.keyboard.press(key)
        pressed.push(key)
      }
    },
    { ...labels, ms: INPUT_MS },
  )
  await page.evaluate(holdScroll, false).catch(() => undefined)
  return {
    path: path.path,
    pressed: pressed.join(', '),
    focused: true,
    ...(path.setup === 'self' ? { tabbable: start.tabbable } : { from: start.from, arrived: reach.arrived === true }),
    focus,
    effect,
  }
}

/** Keys first, while the page stays as it loaded; then the pointer; then the keys left, each on a fresh page, until one matches. */
async function runTrial(harness: Harness, control: ParityControl, fresh: boolean): Promise<Omit<ParityTrial, 'confirm'>> {
  const paths = keyPaths(control)
  const keys: KeyAttempt[] = []
  const labels = { ref: control.ref, label: control.label }
  let probe = await parityPage(harness, fresh)
  let aimed = await locateAndAim(harness, probe, control)
  if (!isAimed(aimed)) return { keys, ...aimed }
  const delegate = await probe.page.evaluate(hitDelegate, aimed).catch(() => null)
  if (delegate) {
    harness.skip(control, 'delegates', `a click lands on <${delegate.tag}> "${delegate.label}" inside it`)
    return { keys, outcome: 'delegates', delegates: delegate }
  }
  // A path that cannot get focus there once never will: the same setup is not tried again.
  let selfFocus: boolean | undefined
  let arrives = true
  const skipped = (path: KeyPath) => (path.setup === 'self' && selfFocus === false) || (path.setup === 'arrive' && !arrives)
  const note = (path: KeyPath, tried: KeyAttempt) => {
    if (path.setup === 'self') selfFocus = tried.focused
    else if (!tried.focused || tried.arrived === false) arrives = false
  }
  let changed = false
  let next = 0
  for (; next < paths.length; next++) {
    const path = paths[next] as KeyPath
    if (skipped(path)) continue
    const tried = await attempt(harness, probe, control, path)
    keys.push(tried)
    note(path, tried)
    if (!tried.focused) continue
    if (!effectEmpty(tried.focus) || !effectEmpty(tried.effect, path.path)) {
      changed = true
      next++
      break
    }
  }
  // The pointer: on this page when nothing changed it, or on a fresh one; aimed again, in case the keys scrolled.
  probe = await parityPage(harness, changed)
  aimed = await locateAndAim(harness, probe, control)
  if (!isAimed(aimed)) return { keys, ...aimed }
  await probe.page.evaluate(blurParity).catch(() => undefined)
  const point = aimed
  const hover = await measured(harness, probe, () => probe.page.mouse.move(point.x, point.y, { steps: 2 }), { ...labels, ms: HOVER_MS })
  harness.log('activate', { ...labels, detail: `click at ${point.x},${point.y}` })
  const click = await measured(harness, probe, () => probe.page.mouse.click(point.x, point.y), { ...labels, ms: INPUT_MS })
  let reading = parityResult({ keys, click })
  // The keys left, each on a fresh page, while none did what the click did.
  for (; reading.result !== 'same' && reading.result !== 'inert' && next < paths.length && harness.now() < CONTROLS_UNTIL; next++) {
    const path = paths[next] as KeyPath
    if (skipped(path)) continue
    probe = await parityPage(harness, true)
    const again = await locateAndAim(harness, probe, control)
    if (!isAimed(again)) break
    const tried = await attempt(harness, probe, control, path)
    keys.push(tried)
    note(path, tried)
    reading = parityResult({ keys, click })
  }
  let elsewhere: ParityTrial['elsewhere']
  if (reading.result !== 'same' && reading.result !== 'inert') {
    const leads = click.events.find((e) => (e.kind === 'navigation' || e.kind === 'window') && e.detail)
    if (leads?.detail) elsewhere = (await probe.page.evaluate(sameAddress, { url: leads.detail }).catch(() => null)) ?? undefined
  }
  return { keys, hover, click, result: reading.result, ...(reading.match ? { match: reading.match } : {}), ...(elsewhere ? { elsewhere } : {}) }
}

/** One hover menu: hovered, then left, then tried from the keyboard, and its links looked for elsewhere. */
async function runMenuTrial(harness: Harness, menu: HoverMenu, fresh: boolean): Promise<Omit<MenuTrial, 'confirm'>> {
  let probe = await parityPage(harness, fresh)
  const refs = { trigger: menu.trigger.ref, triggerSig: menu.trigger.id.sig, container: menu.container.ref, containerSig: menu.container.id.sig, focusable: menu.focusable?.ref }
  const empty = { hover: false, tried: [] as string[], elsewhere: 0, missing: [] as MenuTrial['missing'] }
  // The trigger is only hovered here; the skip list is read on what the keys are pressed on, below.
  if (!(await harness.locate(probe, menu.trigger, { check: false })) || !(await probe.page.evaluate(locateMenu, refs).catch(() => false))) return { ...empty, outcome: 'unmatched' }
  const aimed = await harness.aim(probe, menu.trigger)
  if ('cover' in aimed) return { ...empty, outcome: 'not-exercised', reason: `covered by <${aimed.cover.tag}> "${aimed.cover.text.slice(0, 60)}"` }
  if ('hidden' in aimed) return { ...empty, outcome: 'not-exercised', reason: 'not showing on this load' }
  const labels = { ref: menu.trigger.ref, label: menu.trigger.label }
  const page = probe.page
  await page.mouse.move(0, 0).catch(() => undefined)
  harness.log('activate', { ...labels, detail: 'hover' })
  await harness.window(probe, () => page.mouse.move(aimed.x, aimed.y, { steps: 2 }), { ...labels, ms: HOVER_MS })
  const hover = await page.evaluate(menuShown)
  if (!hover) return { ...empty, hover: false }
  await harness.window(probe, () => page.mouse.move(0, 0), { ...labels, ms: HOVER_MS })
  const staysOpen = await page.evaluate(menuShown)
  // The keyboard, on a page where the menu does not show.
  if (staysOpen) {
    probe = await parityPage(harness, true)
    if (!(await harness.locate(probe, menu.trigger, { check: false })) || !(await probe.page.evaluate(locateMenu, refs).catch(() => false))) return { ...empty, hover, staysOpen, outcome: 'unmatched' }
  }
  const tried: string[] = []
  let revealedBy: MenuTrial['revealedBy']
  const keyPage = probe.page
  const shown = async () => (await keyPage.evaluate(menuShown).catch(() => false)) || (await keyPage.evaluate(focusInMenu).catch(() => false))
  // What the keys are pressed on (Space and Enter among them) is read against the skip list on this page first.
  const left = menu.focusable && !(await harness.locate(probe, menu.focusable)) ? harness.lastSkip : undefined
  if (left) tried.push(`skipped: ${left.reason}${left.detail ? ` (${left.detail})` : ''}`)
  else if (menu.focusable) {
    const steps: Array<{ name: NonNullable<MenuTrial['revealedBy']>; key?: string }> = [{ name: 'focus' }, { name: 'Tab', key: 'Tab' }, { name: 'ArrowDown', key: 'ArrowDown' }, { name: 'Space', key: 'Space' }, { name: 'Enter', key: 'Enter' }]
    for (const step of steps) {
      if (!harness.timeLeft()) break
      const focused = await keyPage.evaluate(focusMenu).catch(() => false)
      if (!focused) {
        tried.push('focus: the trigger took no focus')
        break
      }
      tried.push(step.name)
      if (step.key) harness.log('activate', { ...labels, detail: `pressed ${step.key}` })
      await harness.window(probe, async () => (step.key ? keyPage.keyboard.press(step.key) : undefined), { ...labels, ms: HOVER_MS })
      if (await shown()) {
        revealedBy = step.name
        break
      }
    }
  } else tried.push('nothing in the trigger takes focus')
  const elsewhere = revealedBy ? { elsewhere: 0, missing: [] } : await keyPage.evaluate(menuElsewhere).catch(() => ({ elsewhere: 0, missing: [] }))
  return { hover, ...(staysOpen ? { staysOpen } : {}), ...(revealedBy ? { revealedBy } : {}), tried, elsewhere: elsewhere.elsewhere, missing: elsewhere.missing }
}

/** A Tab walk from the top that stops at the first cycle focus cannot leave; then the keys the page's text names. */
async function runTrapExit(harness: Harness, deadline: number): Promise<TrapExit | undefined> {
  const probe = await parityPage(harness, true)
  const page = probe.page
  await page.evaluate(blurParity)
  const order: string[] = []
  const elements = new Map<string, { ref: string; id: InPageIdentity; label: string; tag: string }>()
  let cycle: string[] | undefined
  for (let n = 0; n < WALK_BUDGET && harness.now() < deadline; n++) {
    await page.keyboard.press('Tab')
    const read = await page.evaluate(readFocus)
    if (!read.el) {
      if (order.length > 0) return undefined
      continue
    }
    if (read.frame) continue
    const at = order.indexOf(read.el.ref)
    if (at >= 0) {
      cycle = order.slice(at)
      break
    }
    order.push(read.el.ref)
    elements.set(read.el.ref, { ref: read.el.ref, id: read.el.id, label: read.el.label, tag: read.el.tag })
  }
  if (!cycle || cycle.length === 0) return undefined
  const members = cycle.map((ref) => elements.get(ref)).filter((el): el is NonNullable<typeof el> => el !== undefined)
  const set = new Set(cycle)
  const context = await page.evaluate(trapContext, cycle)
  const hint = context.exitHint ?? ''
  const keys = exitKeys(hint)
  // Tab, Shift+Tab, Esc and the arrows first, as A7 tries them: a cycle they leave is no trap.
  const plain = await tryEscape(page, set, 1)
  if (plain.left) return { cycle: members, hint, keys, escaped: plain.leftWith, left: true, rounds: 0 }
  if (keys.length === 0) return { cycle: members, hint, keys, left: false, rounds: 0 }
  const inCycle = async () => set.has((await page.evaluate(readFocus)).el?.ref ?? '(document)')
  for (let round = 1; round <= 2; round++) {
    // Back inside the cycle, where the instruction applies.
    if (!(await inCycle())) {
      await page.evaluate((ref) => {
        const w = window as unknown as { __rampaSelf?: boolean; __rampaKit: { resolve(ref: string): Element | null } }
        w.__rampaSelf = true
        try {
          ;(w.__rampaKit.resolve(ref) as HTMLElement | null)?.focus?.()
        } finally {
          w.__rampaSelf = false
        }
      }, cycle[0] ?? '')
    }
    for (const combo of keys) {
      harness.log('activate', { ref: cycle[0], label: members[0]?.label, detail: `pressed ${combo} (exit instruction)` })
      await page.keyboard.press(combo)
      await page.waitForTimeout(150)
      if (!(await inCycle())) return { cycle: members, hint, keys, left: true, leftWith: combo, rounds: round }
      for (const key of ['Tab', 'Shift+Tab']) {
        for (let i = 0; i < set.size + 2; i++) {
          await page.keyboard.press(key)
          if (!(await inCycle())) return { cycle: members, hint, keys, left: true, leftWith: `${combo}, then ${key}`, rounds: round }
        }
      }
    }
  }
  return { cycle: members, hint, keys, left: false, rounds: 2 }
}

/** 2.1.1 and 2.1.2: the controls, the hover menus and the exit instructions of one page, within the budgets. */
export async function runParityProbe(browser: Browser, url: string, options: ProbeOptions): Promise<ProbeRecord> {
  const limits = PARITY_LIMITS
  const harness = new Harness(browser, url, options, { kind: 'parity', version: PARITY_VERSION, variant: 'keyboard-parity', limits })
  let data: ParityData | undefined
  let conditions: ProbeRecord['conditions'] | undefined
  try {
    const first = await parityPage(harness, false)
    conditions = first.conditions
    const viewport = first.page.viewportSize() ?? first.conditions.viewport
    const listeners = await markParityListeners(first)
    const listed = await first.page.evaluate(findParityControls, { max: MAX_LISTED, cursorMax: CURSOR_MAX })
    const menus = await first.page.evaluate(findHoverMenus, { max: MENU_BUDGET })
    const exitText = await first.page.evaluate(exitTextOnPage, EXIT_TEXT.source)
    data = { viewport, listeners, found: listed.found, controls: [], tried: 0, menusFound: menus.found, menus: [], exitText, traps: [], loads: 0, actions: [], end: 'complete' }
    // A fresh load that fails (the network dropped, the page timed out) leaves that control not exercised, not the
    // whole record; three in a row stop the probe.
    let failed = 0
    const safely = async <T>(run: () => Promise<T>, fallback: (reason: string) => T): Promise<T> => {
      try {
        const out = await run()
        failed = 0
        return out
      } catch (error) {
        failed++
        const reason = `the page failed to load: ${(error instanceof Error ? error.message : String(error)).split('\n')[0]?.slice(0, 160)}`
        harness.log('not-exercised', { detail: reason })
        return fallback(reason)
      }
    }
    const broken = () => {
      if (failed < 3) return false
      if (data) data.end = 'error'
      return true
    }
    let confirmed = 0
    // A trial that pressed or clicked nothing (the click would land on a link inside, the control was gone or covered)
    // left the page as it was: the next control uses it.
    let touched = false
    for (const { facts, ...control } of listed.controls) {
      const entry: ParityControl = control
      data.controls.push(entry)
      const skip = skipReason(facts, harness.origin)
      if (skip) {
        entry.skip = skip
        harness.skip(control, skip.reason, skip.detail)
        continue
      }
      if (data.tried >= limits.controls || harness.now() >= CONTROLS_UNTIL || broken()) {
        if (data.end === 'complete') data.end = data.tried >= limits.controls ? 'budget' : 'time'
        entry.trial = { keys: [], outcome: 'not-tried', reason: data.end }
        continue
      }
      const fresh = touched
      const trial: ParityTrial = await safely(() => runTrial(harness, entry, fresh), (reason) => ({ keys: [], outcome: 'not-exercised', reason }))
      entry.trial = trial
      touched = trial.keys.length > 0 || trial.click !== undefined || trial.outcome === 'not-exercised'
      // The budget counts controls pressed or clicked: one whose click lands on a link inside it costs a hit test.
      if (trial.keys.length > 0 || trial.click !== undefined) data.tried++
      if ((trial.result === 'none' || trial.result === 'unreachable') && !trial.elsewhere && confirmed < MAX_CONFIRM && harness.now() < CONTROLS_UNTIL) {
        confirmed++
        trial.confirm = await safely(() => runTrial(harness, entry, true), (reason) => ({ keys: [], outcome: 'not-exercised', reason }))
        touched = true
      }
    }
    let menuConfirmed = 0
    for (const menu of menus.menus) {
      data.menus.push(menu)
      if (harness.now() >= MENUS_UNTIL || broken()) {
        if (data.end === 'complete') data.end = 'time'
        menu.trial = { hover: false, tried: [], elsewhere: 0, missing: [], outcome: 'not-tried', reason: data.end }
        continue
      }
      const failedMenu = (reason: string): MenuTrial => ({ hover: false, tried: [], elsewhere: 0, missing: [], outcome: 'not-exercised', reason })
      const trial: MenuTrial = await safely(() => runMenuTrial(harness, menu, true), failedMenu)
      menu.trial = trial
      if (trial.hover && !trial.revealedBy && trial.missing.length > 0 && menuConfirmed < MENU_CONFIRM && harness.now() < MENUS_UNTIL) {
        menuConfirmed++
        trial.confirm = await safely(() => runMenuTrial(harness, menu, true), failedMenu)
      }
    }
    if (exitText && harness.timeLeft() && !broken()) {
      const trap = await safely(
        () => runTrapExit(harness, limits.timeMs),
        () => undefined,
      )
      if (trap) data.traps.push(trap)
    }
  } finally {
    await harness.close()
  }
  if (!data || !conditions) throw new Error('the first page did not load')
  data.loads = harness.loads
  data.actions = harness.actions
  const reason =
    data.end === 'budget'
      ? `control budget reached (${limits.controls})`
      : data.end === 'time'
        ? `time budget reached (controls until ${CONTROLS_UNTIL / 1000} s, menus until ${MENUS_UNTIL / 1000} s, all within ${limits.timeMs / 1000} s)`
        : data.end === 'error'
          ? 'fresh pages failed to load three times in a row'
          : undefined
  return harness.record(data, conditions, reason)
}

/** The parity probe as a step of the probe stage; a probe that fails leaves a skipped record. */
export async function parityProbe(browser: Browser, url: string, options: ProbeOptions): Promise<ProbeRecord[]> {
  const started = Date.now()
  try {
    return [await runParityProbe(browser, url, options)]
  } catch (error) {
    return [skippedRecord('parity', PARITY_VERSION, 'keyboard-parity', `probe failed: ${(error instanceof Error ? error.message : String(error)).split('\n')[0]}`, Date.now() - started)]
  }
}

