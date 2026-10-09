import type { Browser, Page } from 'playwright-core'
import type { ProbeRecord } from '../snapshot/schema.ts'
import type { InPageElement, InPageIdentity, InPageRect } from './kit.ts'
import { type ProbeOptions, type ProbePage, openProbePage, skippedRecord, waitUntil } from './page.ts'

/**
 * The keyboard walk (2.1.1, 2.1.2, 3.2.1; 2.4.7 and 2.4.11 add pixels in focus.ts). Tab
 * forward until focus leaves the page's elements or the budget runs out, then Shift+Tab
 * backward. Each stop records who has focus, where, and what the page did in response:
 * navigations, new windows, submissions, dialogs, focus moved by script. Observe class only:
 * Tab, Shift+Tab, Esc, and arrows only to try to leave a suspected trap.
 */

export const KEYBOARD_VERSION = '1'
export const STOP_BUDGET = 150
/** Focus is read again this long after each key press: a script that moves focus has had its turn. */
export const REREAD_MS = 150
const IDLE_MS = 1500
const TIME_BUDGET_MS = 120_000

export interface Control {
  ref: string
  id: InPageIdentity
  tag: string
  role: string
  label: string
  /** The tabindex attribute, when set. */
  tabindex?: number | undefined
  href?: string | undefined
  /** The composite widget (listbox, menu, tablist, grid...) the control is an item of. */
  widget?: string | undefined
  /** Radio buttons of one group: Tab reaches one, arrows the rest. */
  radioGroup?: string | undefined
  /** A focusable element the walk reached sits inside this control. */
  holdsReached?: boolean | undefined
  shadow?: boolean | undefined
}

export interface KeyEvent {
  type: string
  at: number
  detail?: string | undefined
  ref?: string | undefined
  el?: InPageElement | undefined
}

export interface KeyStop {
  /** The key press number in this walk, from 1. */
  n: number
  key: 'Tab' | 'Shift+Tab'
  at: number
  /** null: focus is on the document itself, outside the page's elements (the browser's turn). */
  el: InPageElement | null
  rect?: InPageRect | undefined
  scroll?: { x: number; y: number } | undefined
  /** The focused element is a frame: focus is inside its document. */
  frame?: boolean | undefined
  widget?: string | undefined
  href?: string | undefined
  radioGroup?: string | undefined
  /** Focus REREAD_MS later, when it is no longer on `el`. */
  after?: InPageElement | null | undefined
  /** `after` is inside `el` or holds it: the widget moved focus within itself. */
  afterWithin?: boolean | undefined
  /** What happened between this key press and the next. */
  events?: KeyEvent[] | undefined
}

export interface TrapAttempt {
  direction: 'forward' | 'backward'
  /** The stops focus kept cycling through. */
  cycle: Array<{ ref: string; id: InPageIdentity; label: string; tag: string }>
  /** Keys tried to leave, in order, in each round. */
  tried: string[]
  /** Rounds of attempts; a trap is reported only when every round failed. */
  rounds: number
  left: boolean
  /** How focus left, when it did. */
  leftWith?: string | undefined
  /** A dialog that holds the cycle, when there is one. */
  dialog?: string | undefined
  /** Text near the cycle that names a way out ("press Ctrl+M to leave"). */
  exitHint?: string | undefined
}

export type WalkEnd = 'cycled' | 'budget' | 'trap' | 'time' | 'frame' | 'not-run'

export interface KeyboardData {
  viewport: { width: number; height: number }
  idleMs: number
  /** What the page did with no input, subtracted from what a Tab seems to cause. */
  idle: KeyEvent[]
  inventory: Control[]
  forward: KeyStop[]
  backward: KeyStop[]
  end: { forward: WalkEnd; backward: WalkEnd }
  traps: TrapAttempt[]
  budget: number
}

/** Runs in the page: the controls 2.1.1 expects Tab to reach. Needs the kit. */
export function inventoryControls(): Control[] {
  const kit = (window as unknown as { __rampaKit: { describe(el: Element): InPageElement; visible(el: Element): boolean; cssPath(el: Element): string } }).__rampaKit
  const NATIVE = 'a[href],area[href],button,input:not([type=hidden]),select,textarea,summary,iframe,[contenteditable]:not([contenteditable=false])'
  const ROLES = [
    'button', 'link', 'checkbox', 'radio', 'switch', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option',
    'slider', 'spinbutton', 'combobox', 'textbox', 'searchbox', 'treeitem', 'gridcell', 'scrollbar',
  ]
  const WIDGETS = '[role=tablist],[role=menu],[role=menubar],[role=listbox],[role=radiogroup],[role=tree],[role=treegrid],[role=grid],[role=toolbar],select,datalist'
  const selector = `${NATIVE},${ROLES.map((role) => `[role=${role}]`).join(',')}`
  const controls: Control[] = []
  for (const el of Array.from(document.querySelectorAll(selector))) {
    if (controls.length >= 1000) break
    if (el.localName === 'summary' && el.parentElement?.localName !== 'details') continue
    if (el.closest('[inert]') || el.closest('[aria-hidden="true"]')) continue
    if ((el as HTMLInputElement).disabled === true || el.closest('[aria-disabled="true"]') || el.closest('fieldset:disabled')) continue
    if (!kit.visible(el)) continue
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) continue
    // Moved off the page on purpose (skip links before focus): not visible content.
    if (r.right + window.scrollX <= 0 || r.bottom + window.scrollY <= 0) continue
    // Hidden by a container that clips it, such as a carousel slide out of view: not visible content.
    let clipped = false
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const s = getComputedStyle(a)
      if (s.overflowX === 'visible' && s.overflowY === 'visible') continue
      const c = a.getBoundingClientRect()
      if (r.right <= c.left + 1 || r.left >= c.right - 1 || r.bottom <= c.top + 1 || r.top >= c.bottom - 1) {
        clipped = true
        break
      }
    }
    if (clipped) continue
    const described = kit.describe(el)
    const widget = el.parentElement?.closest(WIDGETS)
    const tabindex = el.getAttribute('tabindex')
    const control: Control = { ref: described.ref, id: described.id, tag: described.tag, role: described.role, label: described.label }
    if (tabindex !== null && /^-?\d+$/.test(tabindex.trim())) control.tabindex = Number.parseInt(tabindex, 10)
    if (el.localName === 'a' || el.localName === 'area') control.href = (el as HTMLAnchorElement).href
    if (widget) control.widget = kit.cssPath(widget)
    if (el instanceof HTMLInputElement && el.type === 'radio' && el.name) control.radioGroup = `${el.form ? kit.cssPath(el.form) : ''}|${el.name}`
    if (described.shadow) control.shadow = true
    controls.push(control)
  }
  return controls
}

interface FocusRead {
  el: InPageElement | null
  rect?: InPageRect
  scroll: { x: number; y: number }
  frame?: boolean
  widget?: string
  href?: string
  radioGroup?: string
}

/** Runs in the page: who has focus now. Needs the kit. */
export function readFocus(): FocusRead {
  const kit = (window as unknown as { __rampaKit: { describe(el: Element): InPageElement; deepActive(): Element | null; rect(el: Element): InPageRect; cssPath(el: Element): string } }).__rampaKit
  const el = kit.deepActive()
  const scroll = { x: Math.round(window.scrollX), y: Math.round(window.scrollY) }
  if (!el) return { el: null, scroll }
  const read: FocusRead = { el: kit.describe(el), rect: kit.rect(el), scroll }
  if (el.localName === 'iframe' || el.localName === 'frame' || el.localName === 'object' || el.localName === 'embed') read.frame = true
  const widget = el.parentElement?.closest('[role=tablist],[role=menu],[role=menubar],[role=listbox],[role=radiogroup],[role=tree],[role=treegrid],[role=grid],[role=toolbar]')
  if (widget) read.widget = kit.cssPath(widget)
  if (el instanceof HTMLAnchorElement) read.href = el.href
  if (el instanceof HTMLInputElement && el.type === 'radio' && el.name) read.radioGroup = `${el.form ? kit.cssPath(el.form) : ''}|${el.name}`
  return read
}

/** Runs in the page: whether `inner` is `outer` or inside it. */
export function contains(args: { outer: string; inner: string }): boolean {
  try {
    const outer = document.querySelector(args.outer)
    const inner = document.querySelector(args.inner)
    return Boolean(outer && inner && (outer === inner || outer.contains(inner) || inner.contains(outer)))
  } catch {
    return false
  }
}

/** Runs in the page: the dialog that holds every ref, and text near them that names a way out. */
export function trapContext(refs: string[]): { dialog?: string; exitHint?: string } {
  const kit = (window as unknown as { __rampaKit: { cssPath(el: Element): string } }).__rampaKit
  const elements = refs.map((ref) => {
    try {
      return document.querySelector(ref)
    } catch {
      return null
    }
  })
  const first = elements.find((el): el is Element => el !== null)
  if (!first) return {}
  const dialog = first.closest('dialog[open],[role=dialog],[role=alertdialog],[aria-modal=true]')
  const result: { dialog?: string; exitHint?: string } = {}
  if (dialog && elements.every((el) => !el || dialog.contains(el))) result.dialog = kit.cssPath(dialog)
  // The smallest ancestor that holds the whole cycle, and its text.
  let scope: Element | null = first
  while (scope && !elements.every((el) => !el || scope?.contains(el))) scope = scope.parentElement
  const text = ((scope?.parentElement ?? scope) as HTMLElement | null)?.innerText ?? ''
  const hint = /\b(press|pressione|presione|use|tecle)\b[^.\n]{0,40}\b(esc|escape|ctrl|control|alt|shift|tab|f\d{1,2})\b[^.\n]{0,40}/i.exec(text)
  if (hint) result.exitHint = hint[0].slice(0, 120)
  return result
}

const OUTSIDE = '(document)'
const keyOf = (read: { el: InPageElement | null; frame?: boolean | undefined }): string => (read.el ? read.el.ref : OUTSIDE)

/** Per-stop extra work (A8 adds pixels here): called with focus on the stop, before focus is read again. */
export type StopHook = (page: Page, stop: KeyStop, probe: ProbePage) => Promise<void>

interface WalkResult {
  stops: KeyStop[]
  end: WalkEnd
  trap?: TrapAttempt | undefined
}

async function drainEvents(page: Page, start: number): Promise<KeyEvent[]> {
  const events = await page.evaluate(() =>
    (window as unknown as { __rampaKit: { drain(): Array<{ type: string; at: number; detail?: string; ref?: string }> } }).__rampaKit.drain(),
  )
  return events.map((event) => ({ ...event, at: event.at - start }))
}

/** The guard's navigations and dialogs in a time window, as events. */
function guardEvents(probe: ProbePage, from: number, to: number): KeyEvent[] {
  const events: KeyEvent[] = []
  for (const nav of probe.guard.log.navigations) {
    if (nav.at >= from && nav.at < to) events.push({ type: nav.cause === 'popup' ? 'popup' : 'navigation', at: nav.at, detail: nav.url })
  }
  for (const dialog of probe.guard.log.dialogs) {
    if (dialog.at >= from && dialog.at < to) events.push({ type: `dialog-${dialog.type}`, at: dialog.at, detail: dialog.message })
  }
  return events
}

async function press(page: Page, key: 'Tab' | 'Shift+Tab' | string): Promise<void> {
  await page.keyboard.press(key)
}

/** Tries to leave a set of stops with Tab, Shift+Tab, Esc and the arrows, `rounds` times over. */
async function tryEscape(page: Page, cycle: Set<string>, rounds: number): Promise<{ left: boolean; leftWith?: string; tried: string[]; rounds: number }> {
  const tries = cycle.size + 2
  const sequences: Array<{ name: string; first?: string; key: string }> = [
    { name: 'Tab', key: 'Tab' },
    { name: 'Shift+Tab', key: 'Shift+Tab' },
    { name: 'Escape, then Tab', first: 'Escape', key: 'Tab' },
    { name: 'ArrowDown, then Tab', first: 'ArrowDown', key: 'Tab' },
    { name: 'ArrowRight, then Tab', first: 'ArrowRight', key: 'Tab' },
    { name: 'ArrowUp, then Shift+Tab', first: 'ArrowUp', key: 'Shift+Tab' },
    { name: 'ArrowLeft, then Shift+Tab', first: 'ArrowLeft', key: 'Shift+Tab' },
  ]
  const tried: string[] = []
  for (let round = 1; round <= rounds; round++) {
    for (const sequence of sequences) {
      if (round === 1) tried.push(sequence.name)
      if (sequence.first) await press(page, sequence.first)
      for (let i = 0; i < tries; i++) {
        await press(page, sequence.key)
        const read = await page.evaluate(readFocus)
        if (!cycle.has(keyOf(read))) return { left: true, leftWith: sequence.name, tried, rounds: round }
      }
    }
  }
  return { left: false, tried, rounds }
}

async function walk(page: Page, probe: ProbePage, key: 'Tab' | 'Shift+Tab', budget: number, deadline: number, hook?: StopHook): Promise<WalkResult> {
  const stops: KeyStop[] = []
  const seen = new Map<string, number>()
  let frameRun = 0
  for (let n = 1; n <= budget; n++) {
    if (Date.now() > deadline) return { stops, end: 'time' }
    const pressedAt = Date.now()
    const from = probe.guard.now()
    await press(page, key)
    const read = await page.evaluate(readFocus)
    const early = await drainEvents(page, probe.guard.start)
    const stop: KeyStop = { n, key, at: from, el: read.el, scroll: read.scroll }
    // Focus that landed on one element and was moved on by script before it could be read:
    // the key reached the first element; the second is where the script sent it.
    const landed = early.filter((event) => event.type === 'focusin' && event.el)
    const target = landed[0]?.el
    const movedOn = Boolean(target && read.el && target.ref !== read.el.ref && !read.frame)
    // Focus that landed and was taken away at once (F55): the key reached the element, then the document had focus.
    const removed = Boolean(target && !read.el)
    if (removed && target) {
      stop.el = target
      stop.after = null
    } else if (movedOn && target) {
      stop.el = target
      stop.after = read.el
      stop.afterWithin = await page.evaluate(contains, { outer: target.ref, inner: read.el?.ref ?? '' })
    } else {
      if (read.rect) stop.rect = read.rect
      if (read.frame) stop.frame = true
      if (read.widget) stop.widget = read.widget
      if (read.href) stop.href = read.href
      if (read.radioGroup) stop.radioGroup = read.radioGroup
    }
    await waitUntil(page, pressedAt, REREAD_MS)
    const again = await page.evaluate(readFocus)
    if (!movedOn && !removed && keyOf(again) !== keyOf(read)) {
      stop.after = again.el
      if (read.el && again.el) stop.afterWithin = await page.evaluate(contains, { outer: read.el.ref, inner: again.el.ref })
    }
    const late = await drainEvents(page, probe.guard.start)
    // The key's window ends here: what the page does in reaction to the hook's own blur and refocus is not the key's doing.
    const until = probe.guard.now()
    // Pixels and other per-stop work, once the page has had its turn and focus is still where Tab put it.
    if (hook && read.el && !movedOn && !removed && keyOf(again) === keyOf(read)) await hook(page, stop, probe)
    const events = [...early, ...late, ...guardEvents(probe, from, until)].filter(
      (event) => event.type !== 'focusin' && event.type !== 'script-focus' && event.type !== 'script-blur',
    )
    if (events.length > 0) stop.events = events
    stops.push(stop)

    const current = removed && target ? target.ref : keyOf(again.el || !read.el ? again : read)
    if (current === OUTSIDE) {
      // Focus went back to the document: the walk went once around the page.
      if (stops.some((s) => s.el)) return { stops, end: 'cycled' }
      if (n >= 2) return { stops, end: 'cycled' }
      continue
    }
    if (read.frame) {
      // Inside a frame, Tab moves through the frame's own document; the frame element stays focused.
      frameRun++
      if (frameRun > 60) return { stops, end: 'frame' }
      continue
    }
    frameRun = 0
    const first = seen.get(current)
    if (first === undefined) {
      seen.set(current, stops.length - 1)
      continue
    }
    // Focus came back to a stop without leaving the page's elements: a suspected trap.
    const cycleStops = stops.slice(first).filter((s) => s.el)
    const cycle = new Set(cycleStops.map((s) => keyOf(s)))
    const attempt = await tryEscape(page, cycle, 2)
    const unique = new Map(cycleStops.map((s) => [s.el?.ref ?? '', s.el]))
    const context = await page.evaluate(trapContext, [...unique.keys()])
    const trap: TrapAttempt = {
      direction: key === 'Tab' ? 'forward' : 'backward',
      cycle: [...unique.values()].filter((el): el is InPageElement => el !== null).map((el) => ({ ref: el.ref, id: el.id, label: el.label, tag: el.tag })),
      tried: attempt.tried,
      rounds: attempt.rounds,
      left: attempt.left,
      ...(attempt.leftWith ? { leftWith: attempt.leftWith } : {}),
      ...(context.dialog ? { dialog: context.dialog } : {}),
      ...(context.exitHint ? { exitHint: context.exitHint } : {}),
    }
    return { stops, end: 'trap', trap }
  }
  return { stops, end: 'budget' }
}

/** After the walk: which controls hold an element Tab reached (a label wrapping its field, a card around its link). */
function markHolders(inventory: Control[], reached: Set<string>): (page: Page) => Promise<void> {
  return async (page) => {
    const holders = await page.evaluate(
      ({ refs, candidates }) => {
        const found: string[] = []
        const targets = refs.map((ref) => {
          try {
            return document.querySelector(ref)
          } catch {
            return null
          }
        })
        for (const ref of candidates) {
          let el: Element | null = null
          try {
            el = document.querySelector(ref)
          } catch {
            el = null
          }
          if (el && targets.some((target) => target && target !== el && el?.contains(target))) found.push(ref)
        }
        return found
      },
      { refs: [...reached], candidates: inventory.filter((c) => !reached.has(c.ref)).map((c) => c.ref) },
    )
    const set = new Set(holders)
    for (const control of inventory) if (set.has(control.ref)) control.holdsReached = true
  }
}

export interface KeyboardProbeOptions {
  /** Per-stop work on the forward walk (2.4.7 pixels). */
  forwardHook?: StopHook | undefined
  /** Per-stop work on the backward walk (2.4.11 coverage). */
  backwardHook?: StopHook | undefined
  version?: string | undefined
  /** Extra data the hooks gathered, stored with the record. */
  extra?: (() => Record<string, unknown>) | undefined
  /** Another window size than the run's, such as the narrow walk for 2.4.11. */
  viewport?: { width: number; height: number } | undefined
  variant?: string | undefined
}

export async function runKeyboardWalk(browser: Browser, url: string, options: ProbeOptions, hooks: KeyboardProbeOptions = {}): Promise<ProbeRecord> {
  const started = Date.now()
  const probe = await openProbePage(browser, url, options, { variant: hooks.variant ?? 'keyboard-walk', viewport: hooks.viewport })
  try {
    const page = probe.page
    const deadline = started + TIME_BUDGET_MS
    // What the page does on its own, with no key pressed.
    const idleFrom = probe.guard.now()
    await drainEvents(page, probe.guard.start)
    await page.waitForTimeout(IDLE_MS)
    const idle = [...(await drainEvents(page, probe.guard.start)), ...guardEvents(probe, idleFrom, probe.guard.now())]
    const inventory = await page.evaluate(inventoryControls)
    // Scrolling that animates moves the focused element while it is measured: the walk scrolls at once.
    await page.addStyleTag({ content: '*, *::before, *::after { scroll-behavior: auto !important; }' }).catch(() => undefined)
    await page.evaluate(() => {
      ;(document.activeElement as HTMLElement | null)?.blur?.()
      window.scrollTo(0, 0)
    })

    const forward = await walk(page, probe, 'Tab', STOP_BUDGET, deadline, hooks.forwardHook)
    let backward: WalkResult = { stops: [], end: 'not-run' }
    if (forward.end === 'cycled') backward = await walk(page, probe, 'Shift+Tab', Math.min(STOP_BUDGET, forward.stops.length + 10), deadline, hooks.backwardHook)
    const reached = new Set([...forward.stops, ...backward.stops].flatMap((stop) => (stop.el ? [stop.el.ref] : [])))
    await markHolders(inventory, reached)(page)

    const traps = [forward.trap, backward.trap].filter((trap): trap is TrapAttempt => trap !== undefined)
    const data: KeyboardData = {
      viewport: probe.conditions.viewport,
      idleMs: IDLE_MS,
      idle,
      inventory,
      forward: forward.stops,
      backward: backward.stops,
      end: { forward: forward.end, backward: backward.end },
      traps,
      budget: STOP_BUDGET,
      ...(hooks.extra?.() ?? {}),
    }
    const complete = forward.end === 'cycled' && (backward.end === 'cycled' || backward.end === 'not-run')
    const reason =
      forward.end === 'budget'
        ? `stop budget reached (${STOP_BUDGET})`
        : forward.end === 'time'
          ? `time budget reached (${TIME_BUDGET_MS / 1000} s)`
          : forward.end === 'trap'
            ? 'focus cycled without leaving a set of elements'
            : forward.end === 'frame'
              ? 'focus stayed inside a frame'
              : backward.end !== 'cycled'
                ? `backward walk ended: ${backward.end}`
                : undefined
    return {
      kind: 'keyboard',
      version: hooks.version ?? KEYBOARD_VERSION,
      conditions: probe.conditions,
      status: complete ? 'complete' : 'partial',
      ...(reason && !complete ? { reason } : {}),
      guard: probe.guard.log,
      durationMs: Date.now() - started,
      data,
    }
  } finally {
    await probe.context.close()
  }
}

/** Version 2 adds the focus pixels (2.4.7) and the obscured checks (2.4.11) to every stop. */
export const FOCUS_VERSION = '2'

/** The second window size for 2.4.11: a phone held upright, where sticky bars cover the most. */
export const NARROW_VIEWPORT = { width: 390, height: 844 }

/**
 * The walk at the run's window size, with every check, then a lighter walk at 390×844 that
 * only runs the 2.4.11 grid: a sticky header or a bottom bar covers far more of a narrow window.
 */
export async function keyboardProbe(browser: Browser, url: string, options: ProbeOptions): Promise<ProbeRecord[]> {
  const { backwardFocusHook, forwardFocusHook } = await import('./focus.ts')
  const records = [await runKeyboardWalk(browser, url, options, { forwardHook: forwardFocusHook, backwardHook: backwardFocusHook, version: FOCUS_VERSION })]
  const variant = `keyboard-walk-${NARROW_VIEWPORT.width}x${NARROW_VIEWPORT.height}`
  const started = Date.now()
  try {
    records.push(
      await runKeyboardWalk(browser, url, options, { forwardHook: backwardFocusHook, backwardHook: backwardFocusHook, version: FOCUS_VERSION, viewport: NARROW_VIEWPORT, variant }),
    )
  } catch (error) {
    records.push(skippedRecord('keyboard', FOCUS_VERSION, variant, `probe failed: ${(error instanceof Error ? error.message : String(error)).split('\n')[0]}`, Date.now() - started))
  }
  return records
}
