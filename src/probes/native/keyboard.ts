import { cropImage, type RgbaImage } from '../../pixels/png.ts'
import type { A11yNode, Bounds, ProbeRecord } from '../../snapshot/schema.ts'
import { walkTree } from '../../snapshot/tree.ts'
import { FOCUS_MARGIN, type FocusPixels, type FocusStop, type Obscured } from '../focus.ts'
import { nativeSignature } from '../identity.ts'
import type { Control, KeyEvent, KeyboardData, TrapAttempt, WalkEnd } from '../keyboard.ts'
import type { InPageElement } from '../kit.ts'
import { type PixelDiff, diffImages } from '../pixels.ts'
import {
  type NativePlatform,
  type NativeScreen,
  NativeMatcher,
  activeNodes,
  ancestors,
  focusedNode,
  intersect,
  nativeElement,
  parentsOf,
  pixelHash,
  rectOf,
  sameBounds,
  shown,
} from './screen.ts'

/**
 * The keyboard walk on an app screen (A7 and A8 of the coverage plan, D7): Tab pressed through a hardware-keyboard
 * key event, the screen read after each press, the focused node taken from the tree. It writes the record the web walk
 * writes (probes/keyboard.ts, variant keyboard-walk, version 2), so the 2.1.1, 2.1.2, 3.2.1, 2.4.7 and 2.4.11 rules read
 * it. Where an app screen differs from a page:
 * - Tab wraps round the window instead of leaving for the browser, so the walk has gone round once when focus comes
 *   back to its first stop; coming back to another stop, or not moving, is a suspected trap.
 * - Esc is never pressed: Android reads an unhandled Esc as Back, which can leave the screen. Enter and Space are never
 *   pressed either (observe class). Traps are tried with Shift+Tab and the arrow keys only.
 * - 2.4.7 compares each stop's capture with the capture after focus moved on, and marks as noise what differs between
 *   the capture before focus arrived and the one after it left (both show the element without focus).
 * - A change of context (another app, a new window, another screen) cannot be confirmed by giving focus back, which
 *   would need Back, so it is recorded unconfirmed and 3.2.1 sends it to review.
 */

export const NATIVE_KEYBOARD_VERSION = '2'
export const NATIVE_STOP_BUDGET = 60
export const NATIVE_TIME_BUDGET_MS = 240_000
export const NATIVE_IDLE_MS = 1500

export type NativeKey = 'Tab' | 'Shift+Tab' | 'ArrowDown' | 'ArrowRight' | 'ArrowUp' | 'ArrowLeft'

/** What the walk needs from a device: reading the screen, pressing a key, a clock. */
export interface KeyDriver {
  /** Reads the screen as it is, with a screenshot when asked. */
  read(options: { screenshot: boolean }): Promise<NativeScreen>
  /** Presses a key; false when the device cannot send it (Shift+Tab needs `input keycombination`, Android 13). */
  press(key: NativeKey): Promise<boolean>
  /** Milliseconds since the probe started. */
  now(): number
  wait(ms: number): Promise<void>
}

export interface NativeWalkOptions {
  platform: NativePlatform
  /** The snapshot's tree: the walk records its refs and identities. */
  snapshotRoot: A11yNode
  conditions: ProbeRecord['conditions']
  budget?: number | undefined
  timeBudgetMs?: number | undefined
  idleMs?: number | undefined
}

/** What a native walk adds to the web walk's data. */
export interface NativeKeyboardData extends KeyboardData {
  platform: NativePlatform
  /** The node that had focus before the first Tab, as a snapshot ref: Tab wraps round, so the walk still covers the screen. */
  focusedBefore?: string | null | undefined
  /** Keys tried to leave a suspected trap, and keys the device could not send. */
  keys: { escape: string[]; unsupported: string[] }
}

const CONTROL_ROLES = new Set(['button', 'link', 'checkbox', 'radio', 'switch', 'tab', 'menuitem', 'slider', 'spinbutton', 'combobox', 'textbox', 'searchbox', 'option', 'treeitem'])
/** Containers whose items a keyboard may reach with arrows once one of them has focus. */
const WIDGET_ROLES = new Set(['list', 'tablist', 'radiogroup', 'grid', 'menu', 'tree'])
/** What draws over other content when it covers it: the platform's bars, sheets and floating buttons. */
const LAYER_CLASS = /(Toolbar|AppBar|BottomNavigation|NavigationBar|NavigationRail|BottomSheet|Snackbar|FloatingActionButton|CardView|Dialog|PopupWindow)$/
const DIALOG = /(Dialog|BottomSheet|Popup|Drawer|Sheet)/i
const EXIT_HINT = /\b(press|pressione|presione|use|tecle)\b[^.\n]{0,40}\b(esc|escape|ctrl|control|alt|shift|tab|back|voltar|f\d{1,2})\b[^.\n]{0,40}/i

/** A control the keyboard should reach: it acts on a click or a check, or has a control's role and takes focus. */
function isControl(node: A11yNode): boolean {
  if (node.states.includes('disabled') || !shown(node)) return false
  if (node.states.includes('clickable') || node.states.includes('long-clickable') || node.states.includes('checkable')) return true
  return CONTROL_ROLES.has(node.role) && node.states.includes('focusable')
}

interface Walked {
  stops: FocusStop[]
  /** The screen after each stop, in order; screens[0] belongs to stops[0]. */
  screens: NativeScreen[]
  end: WalkEnd
  trap?: TrapAttempt | undefined
}

/**
 * The context changes between a screen and the next one: another app in front, a window that opened, a screen that
 * replaced this one. One Tab moves focus by one element, so a list that scrolls to show it keeps most of what the
 * previous screen named; a new screen keeps under a quarter of it.
 */
function contextEvents(previous: NativeScreen, next: NativeScreen, at: number): KeyEvent[] {
  const events: KeyEvent[] = []
  if (previous.app && next.app && previous.app !== next.app) events.push({ type: 'open', at, detail: next.app })
  const before = windowNames(previous)
  for (const name of windowNames(next)) {
    const i = before.indexOf(name)
    if (i >= 0) before.splice(i, 1)
    else events.push({ type: 'modal', at, detail: name })
  }
  const named = new Set(namedSignatures(previous))
  if (events.length === 0 && named.size >= 5) {
    const now = new Set(namedSignatures(next))
    let kept = 0
    for (const signature of named) if (now.has(signature)) kept++
    if (kept / named.size < 0.25) events.push({ type: 'navigation', at, detail: titleOf(next) })
  }
  return events
}

function windowNames(screen: NativeScreen): string[] {
  return screen.root.children.filter((child) => child.role === 'window').map((child) => child.name || '(a window with no title)')
}

function namedSignatures(screen: NativeScreen): string[] {
  const out: string[] = []
  for (const node of activeNodes(screen.root)) if (node.name && shown(node)) out.push(nativeSignature(node))
  return out
}

function titleOf(screen: NativeScreen): string {
  return screen.root.name || screen.app || 'another screen'
}

/** Runs the walk on a device: forward with screenshots, then backward with the tree only. */
export async function nativeKeyboardWalk(driver: KeyDriver, options: NativeWalkOptions): Promise<ProbeRecord> {
  const started = driver.now()
  const budget = options.budget ?? NATIVE_STOP_BUDGET
  const deadline = started + (options.timeBudgetMs ?? NATIVE_TIME_BUDGET_MS)
  const idleMs = options.idleMs ?? NATIVE_IDLE_MS
  const matcher = new NativeMatcher(options.snapshotRoot)
  const snapshotParents = parentsOf(options.snapshotRoot)

  // What the screen does on its own, with no key pressed: subtracted from what a Tab seems to cause.
  const first = await driver.read({ screenshot: false })
  await driver.wait(idleMs)
  const base = await driver.read({ screenshot: true })
  const idle = contextEvents(first, base, driver.now() - started)

  const baseMap = matcher.map(base.root)
  const inventory = inventoryOf(base, baseMap, matcher)
  const byNode = new Map(inventory.map((entry) => [entry.snapshot, entry.control]))
  const before = focusedNode(base)
  const focusedBefore = before ? (baseMap.get(before) ?? before).ref : null
  const unsupported = new Set<string>()
  const escapeKeys = new Set<string>()

  const send = async (key: NativeKey): Promise<boolean> => {
    if (unsupported.has(key)) return false
    const sent = await driver.press(key)
    if (!sent) unsupported.add(key)
    return sent
  }

  const keyOf = (screen: NativeScreen, map: Map<A11yNode, A11yNode>): string | undefined => {
    const node = focusedNode(screen)
    return node ? (map.get(node) ?? node).ref : undefined
  }

  /** Tries to leave a cycle with Shift+Tab and the arrows, twice; Esc is never pressed (Android reads it as Back). */
  const escape = async (cycle: Set<string>): Promise<{ left: boolean; leftWith?: string; tried: string[]; rounds: number; complete: boolean }> => {
    const tries = Math.min(cycle.size + 1, 4)
    const sequences: Array<{ name: string; first?: NativeKey; key: NativeKey }> = [
      { name: 'Shift+Tab', key: 'Shift+Tab' },
      { name: 'ArrowDown, then Tab', first: 'ArrowDown', key: 'Tab' },
      { name: 'ArrowRight, then Tab', first: 'ArrowRight', key: 'Tab' },
      { name: 'ArrowUp, then Shift+Tab', first: 'ArrowUp', key: 'Shift+Tab' },
      { name: 'ArrowLeft, then Shift+Tab', first: 'ArrowLeft', key: 'Shift+Tab' },
    ]
    const tried: string[] = []
    for (let round = 1; round <= 2; round++) {
      for (const sequence of sequences) {
        if (driver.now() > deadline) return { left: false, tried, rounds: round, complete: false }
        if (sequence.first && !(await send(sequence.first))) continue
        let sent = true
        for (let i = 0; i < tries; i++) {
          if (!(await send(sequence.key))) {
            sent = false
            break
          }
          const screen = await driver.read({ screenshot: false })
          const key = keyOf(screen, matcher.map(screen.root))
          if (key !== undefined && !cycle.has(key)) {
            if (round === 1 && !tried.includes(sequence.name)) tried.push(sequence.name)
            for (const name of tried) escapeKeys.add(name)
            return { left: true, leftWith: sequence.name, tried, rounds: round, complete: true }
          }
        }
        if (sent && round === 1) tried.push(sequence.name)
      }
    }
    for (const name of tried) escapeKeys.add(name)
    return { left: false, tried, rounds: 2, complete: true }
  }

  const walk = async (key: 'Tab' | 'Shift+Tab', screenshots: boolean, from: NativeScreen): Promise<Walked> => {
    const stops: FocusStop[] = []
    const screens: NativeScreen[] = []
    const seen = new Map<string, number>()
    let firstKey: string | undefined
    let empty = 0
    let previous = from
    for (let n = 1; n <= budget; n++) {
      if (driver.now() > deadline) return { stops, screens, end: 'time' }
      const at = driver.now() - started
      if (!(await send(key))) return { stops, screens, end: 'not-run' }
      const screen = await driver.read({ screenshot: screenshots })
      const map = matcher.map(screen.root)
      const focused = focusedNode(screen)
      const mapped = focused ? map.get(focused) : undefined
      const stop: FocusStop = { n, key, at, el: focused ? nativeElement(focused, mapped) : null }
      if (focused?.bounds) stop.rect = rectOf(focused.bounds)
      const control = mapped ? byNode.get(mapped) : undefined
      if (control?.i !== undefined) stop.inv = control.i
      if (control?.widget) stop.widget = control.widget
      if (control?.radioGroup) stop.radioGroup = control.radioGroup
      const events = contextEvents(previous, screen, at)
      const left = events.some((event) => event.type === 'open' || event.type === 'navigation')
      if (left) {
        // What Tab moved focus to is on the screen that went away: the change is recorded on the screen itself.
        stop.el = nativeElement(matcher.root, matcher.root)
        delete stop.rect
        delete stop.inv
        delete stop.widget
        delete stop.radioGroup
      }
      if (events.length > 0) {
        stop.events = events
        // Giving focus back to confirm would need Back on an app screen, which the probe never presses.
        stop.confirmed = []
      }
      stops.push(stop)
      screens.push(screen)
      previous = screen
      if (left) return { stops, screens, end: 'left' }
      if (!stop.el) {
        // Three Tabs in a row that left no node focused: focus went where the dump cannot show it, or nowhere.
        empty++
        if (empty >= 3) return { stops, screens, end: 'no-focus' }
        continue
      }
      empty = 0
      const current = stop.el.ref
      firstKey ??= current
      const earlier = seen.get(current)
      if (earlier === undefined) {
        seen.set(current, stops.length - 1)
        continue
      }
      // Focus stayed where it was: a field or a view that keeps Tab, unless it is the only stop there is.
      const stuck = earlier === stops.length - 2 && focusables(screen) > 1
      if (current === firstKey && !stuck) return { stops, screens, end: 'cycled' }
      const cycleStops = stops.slice(earlier).filter((s) => s.el)
      const unique = new Map(cycleStops.map((s) => [s.el?.ref ?? '', s.el as InPageElement]))
      const cycle = new Set(unique.keys())
      const attempt = await escape(cycle)
      if (!attempt.complete) return { stops, screens, end: 'time' }
      const context = trapContext(screen, map, [...cycle])
      const trap: TrapAttempt = {
        direction: key === 'Tab' ? 'forward' : 'backward',
        cycle: [...unique.values()].map((el) => ({ ref: el.ref, id: el.id, label: el.label, tag: el.tag })),
        tried: attempt.tried,
        rounds: attempt.rounds,
        left: attempt.left,
        ...(attempt.leftWith ? { leftWith: attempt.leftWith } : {}),
        ...(context.dialog ? { dialog: context.dialog } : {}),
        ...(context.exitHint ? { exitHint: context.exitHint } : {}),
      }
      return { stops, screens, end: 'trap', trap }
    }
    return { stops, screens, end: 'budget' }
  }

  const forward = await walk('Tab', true, base)
  let backward: Walked = { stops: [], screens: [], end: 'not-run' }
  if (forward.end === 'cycled') backward = await walk('Shift+Tab', false, forward.screens.at(-1) ?? base)

  // Pixels: each forward stop against the capture after focus moved on, with the capture before it arrived as noise.
  for (const [i, stop] of forward.stops.entries()) {
    const at = forward.screens[i]
    const next = forward.screens[i + 1]
    const prior = (i === 0 ? base : forward.screens[i - 1]) ?? base
    // A stop where the app left the screen holds the screen itself, not a focused element.
    if (!stop.el || !at || !next || stop.events?.some((event) => event.type === 'open' || event.type === 'navigation')) continue
    const pixels = focusPixels(at, next, prior)
    if (!pixels) continue
    stop.focus = pixels
    if (!pixels.skipped) {
      const grid = obscured(at, matcher.map(at.root), pixels.diff.changed)
      if (grid) stop.obscured = grid
    }
  }

  // Which controls hold a node the walk reached: a card around its link, a row around its switch.
  const reached = new Set<A11yNode>()
  const snapshotByRef = new Map([...walkTree(options.snapshotRoot)].map((node) => [node.ref, node]))
  for (const stop of [...forward.stops, ...backward.stops]) {
    const node = stop.el ? snapshotByRef.get(stop.el.ref) : undefined
    if (node) reached.add(node)
  }
  const holders = new Set<A11yNode>()
  for (const node of reached) for (const ancestor of ancestors(node, snapshotParents)) holders.add(ancestor)
  // A control the screen no longer showed when the walk ended (a carousel that turned, a list that scrolled away) is not judged.
  const last = forward.screens.at(-1)
  const lastPaired = last ? new Set(matcher.map(last.root).values()) : undefined
  for (const { control, snapshot } of inventory) {
    if (holders.has(snapshot)) control.holdsReached = true
    if (lastPaired && !lastPaired.has(snapshot) && !reached.has(snapshot)) control.changed = true
  }

  const traps = [forward.trap, backward.trap].filter((trap): trap is TrapAttempt => trap !== undefined)
  const data: NativeKeyboardData = {
    platform: options.platform,
    viewport: { width: base.window.width, height: base.window.height },
    idleMs,
    idle,
    inventory: inventory.map((entry) => entry.control),
    // The web walk's starting point matters because Tab leaves a page at its end; an app's Tab wraps round.
    startFocus: null,
    focusedBefore,
    forward: forward.stops,
    backward: backward.stops,
    end: { forward: forward.end, backward: backward.end },
    traps,
    budget,
    keys: { escape: [...escapeKeys], unsupported: [...unsupported] },
  }
  const complete = forward.end === 'cycled' && (backward.end === 'cycled' || backward.end === 'not-run')
  const reason =
    forward.end === 'budget'
      ? `stop budget reached (${budget})`
      : forward.end === 'time'
        ? `time budget reached (${Math.round((options.timeBudgetMs ?? NATIVE_TIME_BUDGET_MS) / 1000)} s)`
        : forward.end === 'trap'
          ? 'focus cycled without leaving a set of elements'
          : forward.end === 'left'
            ? 'a Tab took the app to another screen or app; the walk stopped there'
            : forward.end === 'no-focus'
              ? 'Tab moved focus to nothing the screen shows: no node was marked focused'
              : forward.end === 'not-run'
                ? 'the device could not send Tab'
                : backward.end === 'not-run' && unsupported.has('Shift+Tab')
                  ? 'the backward walk did not run: the device cannot send Shift+Tab (input keycombination needs Android 13)'
                  : backward.end !== 'cycled' && backward.end !== 'not-run'
                    ? `backward walk ended: ${backward.end}`
                    : undefined
  return {
    kind: 'keyboard',
    version: NATIVE_KEYBOARD_VERSION,
    conditions: { ...options.conditions, viewport: { width: base.window.width, height: base.window.height }, variant: 'keyboard-walk' },
    status: complete && !reason ? 'complete' : 'partial',
    ...(reason ? { reason } : {}),
    guard: { blocked: [], navigations: [], dialogs: [] },
    durationMs: driver.now() - started,
    data,
  }
}

/** How many nodes on the screen can take focus. */
function focusables(screen: NativeScreen): number {
  let count = 0
  for (const node of activeNodes(screen.root)) if (node.states.includes('focusable') && shown(node) && !node.states.includes('disabled')) count++
  return count
}

interface InventoryEntry {
  control: Control & { focusable?: boolean | undefined }
  snapshot: A11yNode
}

/**
 * The controls 2.1.1 expects Tab to reach, from the screen as the walk starts, named by the snapshot's refs. A control
 * inside another control is left out (the row a switch sits in is what takes focus), and so is what a WebView shows,
 * whose keyboard order is the web content's.
 */
function inventoryOf(screen: NativeScreen, map: Map<A11yNode, A11yNode>, matcher: NativeMatcher): InventoryEntry[] {
  const parents = parentsOf(screen.root)
  const out: InventoryEntry[] = []
  // Identities several snapshot nodes share inside a scrolling list cannot be told apart once the list moves.
  const counts = new Map<string, number>()
  for (const node of walkTree(matcher.root)) {
    const signature = nativeSignature(node)
    counts.set(signature, (counts.get(signature) ?? 0) + 1)
  }
  for (const node of activeNodes(screen.root)) {
    if (node === screen.root || !isControl(node) || node.role === 'list' || node.role === 'document') continue
    const chain = ancestors(node, parents)
    if (chain.some((ancestor) => ancestor.role === 'document' || (ancestor !== screen.root && isControl(ancestor) && ancestor.role !== 'list'))) continue
    const snapshot = map.get(node) ?? node
    const element = nativeElement(node, map.get(node))
    const control: InventoryEntry['control'] = { ref: element.ref, id: element.id, tag: element.tag, role: element.role, label: element.label, i: out.length }
    control.focusable = node.states.includes('focusable')
    const widget = chain.find((ancestor) => WIDGET_ROLES.has(ancestor.role))
    if (widget) control.widget = (map.get(widget) ?? widget).ref
    if (node.role === 'radio') {
      const group = chain.find((ancestor) => ancestor.role === 'radiogroup')
      if (group) control.radioGroup = (map.get(group) ?? group).ref
    }
    if (!map.has(node) || ((counts.get(nativeSignature(node)) ?? 0) > 1 && chain.some((ancestor) => ancestor.states.includes('scrollable')))) control.changed = true
    out.push({ control, snapshot })
  }
  return out
}

/** The dialog that holds every node of a cycle, and text near them that names a way out. */
function trapContext(screen: NativeScreen, map: Map<A11yNode, A11yNode>, refs: string[]): { dialog?: string; exitHint?: string } {
  const parents = parentsOf(screen.root)
  const inverse = new Map<string, A11yNode>()
  for (const node of walkTree(screen.root)) inverse.set((map.get(node) ?? node).ref, node)
  const nodes = refs.map((ref) => inverse.get(ref)).filter((node): node is A11yNode => node !== undefined)
  const firstNode = nodes[0]
  if (!firstNode) return {}
  const chains = nodes.map((node) => new Set(ancestors(node, parents)))
  const common = ancestors(firstNode, parents).filter((ancestor) => chains.every((chain) => chain.has(ancestor)))
  const result: { dialog?: string; exitHint?: string } = {}
  const windows = screen.root.children.filter((child) => child.role === 'window')
  const dialog = common.find(
    (ancestor) =>
      (ancestor.role === 'window' && windows.indexOf(ancestor) > 0) ||
      ancestor.role === 'dialog' ||
      ancestor.role === 'alertdialog' ||
      typeof ancestor.native.paneTitle === 'string' ||
      DIALOG.test(String(ancestor.native.class ?? '')) ||
      DIALOG.test(String(ancestor.native.resourceId ?? '')),
  )
  if (dialog) result.dialog = (map.get(dialog) ?? dialog).ref
  const scope = common[1] ?? common[0]
  if (scope) {
    const text = [...walkTree(scope)].map((node) => node.text ?? '').join('\n')
    const hint = EXIT_HINT.exec(text)
    if (hint) result.exitHint = hint[0].slice(0, 120)
  }
  return result
}

const EMPTY_DIFF: PixelDiff = { area: 0, changed: 0, strong: 0, noticeable: 0, masked: 0 }

/**
 * 2.4.7 pixels at one stop: the element's box plus a margin, captured with focus on it (`at`) and once focus moved on
 * (`next`); the capture before focus arrived (`prior`) shows the element without focus too, so what differs between it
 * and `next` (the previous and the next element's indicators, anything that moves) is noise. When nothing changed in
 * the region, the whole screen is compared the same way, as ACT oj04fd counts a change anywhere.
 */
function focusPixels(at: NativeScreen, next: NativeScreen, prior: NativeScreen): FocusPixels | undefined {
  const node = focusedNode(at)
  if (!node?.bounds || !at.screenshot) return undefined
  const box = node.bounds
  const margin = FOCUS_MARGIN
  const region = intersect({ x: box.x - margin, y: box.y - margin, width: box.width + 2 * margin, height: box.height + 2 * margin }, at.window) ?? box
  const skipped = (reason: string): FocusPixels => ({ region: rectOf(region), box: rectOf(box), diff: EMPTY_DIFF, focused: '', blurred: '', skipped: reason })
  if (!next.screenshot) return skipped('no screenshot after focus moved on')
  // The next capture stands for the element without focus only when focus left it.
  if (sameNode(focusedNode(next), node)) return skipped('focus did not move on')
  const nextNode = findSame(node, next)
  if (!nextNode || !sameBounds(nextNode.bounds, box)) return skipped('the element moved when focus moved on (the screen scrolled)')
  for (const keyboard of [at.ime, next.ime]) if (keyboard && intersect(keyboard, region)) return skipped('the on-screen keyboard covers the element')
  const pixelRect = (b: Bounds) => ({ x: Math.round(b.x * at.scale), y: Math.round(b.y * at.scale), width: Math.round(b.width * at.scale), height: Math.round(b.height * at.scale) })
  const on = cropImage(at.screenshot, pixelRect(region))
  const off = cropImage(next.screenshot, pixelRect(region))
  if (!on || !off || on.width !== off.width || on.height !== off.height) return skipped('the captures do not cover the element')
  const priorNode = prior.screenshot && !sameNode(focusedNode(prior), node) ? findSame(node, prior) : undefined
  const noise = priorNode && sameBounds(priorNode.bounds, box) && prior.screenshot ? cropImage(prior.screenshot, pixelRect(region)) : undefined
  const diff = diffImages(on, off, noise && noise.width === on.width && noise.height === on.height ? noise : undefined)
  const pixels: FocusPixels = { region: rectOf(region), box: rectOf(box), diff, focused: pixelHash(on), blurred: pixelHash(off) }
  if (diff.changed === 0) {
    // The whole screen, only when nothing on it moved between the three captures: a scroll would change everything.
    const still = stillBetween(prior, next) && stillBetween(at, next)
    if (still && sameSize(at.screenshot, next.screenshot)) {
      const usePrior = prior.screenshot && sameSize(prior.screenshot, at.screenshot) ? prior.screenshot : undefined
      pixels.viewport = diffImages(at.screenshot, next.screenshot, usePrior)
    }
  }
  return pixels
}

function sameSize(a: RgbaImage, b: RgbaImage): boolean {
  return a.width === b.width && a.height === b.height
}

/** Two nodes of screens read during the walk stand for the same element: the same ref and identity. */
function sameNode(a: A11yNode | undefined, b: A11yNode | undefined): boolean {
  return Boolean(a && b && a.ref === b.ref && nativeSignature(a) === nativeSignature(b))
}

/** The node with the same ref and identity in another screen read during the walk. */
function findSame(node: A11yNode, other: NativeScreen): A11yNode | undefined {
  const signature = nativeSignature(node)
  for (const candidate of walkTree(other.root)) if (candidate.ref === node.ref && nativeSignature(candidate) === signature) return candidate
  return undefined
}

/** Nothing moved between two screens: nine in ten nodes with the same ref and identity keep their bounds. */
function stillBetween(a: NativeScreen, b: NativeScreen): boolean {
  const others = new Map<string, A11yNode>()
  for (const node of walkTree(b.root)) others.set(`${node.ref}|${nativeSignature(node)}`, node)
  let compared = 0
  let same = 0
  for (const node of walkTree(a.root)) {
    if (!node.bounds) continue
    const other = others.get(`${node.ref}|${nativeSignature(node)}`)
    if (!other?.bounds) continue
    compared++
    if (sameBounds(node.bounds, other.bounds, 0)) same++
  }
  return compared > 0 && same / compared >= 0.9
}

/** A node that paints something where it lies: text, a name, an image, a control, a bar or a sheet, or another window. */
function draws(node: A11yNode): boolean {
  return Boolean(
    node.text ||
      node.name ||
      node.role === 'img' ||
      node.role === 'window' ||
      node.states.includes('clickable') ||
      LAYER_CLASS.test(String(node.native.class ?? '')),
  )
}

/** Sibling order as the platform draws it: Android's drawing-order when the dump has it, else document order. */
function drawOrder(node: A11yNode, position: number): number {
  const raw = (node.native.uiautomator as Record<string, unknown> | undefined)?.['drawing-order']
  const value = typeof raw === 'string' ? Number.parseInt(raw, 10) : Number.NaN
  return Number.isFinite(value) ? value : position
}

/** Whether `other` is drawn over `node`: after it, at the level where their branches part. */
function drawnOver(other: A11yNode, node: A11yNode, parents: Map<A11yNode, A11yNode>): boolean {
  const chainA = [node, ...ancestors(node, parents)]
  const chainB = [other, ...ancestors(other, parents)]
  const setA = new Set(chainA)
  const common = chainB.find((ancestor) => setA.has(ancestor))
  if (!common) return false
  const branchA = chainA[chainA.indexOf(common) - 1]
  const branchB = chainB[chainB.indexOf(common) - 1]
  if (!branchA || !branchB) return false
  const ia = common.children.indexOf(branchA)
  const ib = common.children.indexOf(branchB)
  const oa = drawOrder(branchA, ia)
  const ob = drawOrder(branchB, ib)
  return ob > oa || (ob === oa && ib > ia)
}

/**
 * 2.4.11 on an app screen: a 5×5 grid over the focused node's box; a point is covered when a node drawn over it, that
 * is neither the node, inside it nor around it, paints there. `painted` and `hidden` are the pixels that changed in the
 * region when focus arrived: an element entirely under an opaque layer changes none.
 */
function obscured(screen: NativeScreen, map: Map<A11yNode, A11yNode>, changed: number): Obscured | undefined {
  const node = focusedNode(screen)
  const box = node?.bounds ? intersect(node.bounds, screen.window) : undefined
  if (!node || !box) return undefined
  const parents = parentsOf(screen.root)
  const own = new Set([node, ...ancestors(node, parents)])
  const inside = new Set(walkTree(node))
  const candidates = [...activeNodes(screen.root)].filter((other) => other.bounds && shown(other) && !own.has(other) && !inside.has(other) && drawnOver(other, node, parents))
  const tally = new Map<A11yNode, number>()
  let points = 0
  let covered = 0
  for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 5; j++) {
      const x = box.x + ((i + 0.5) * box.width) / 5
      const y = box.y + ((j + 0.5) * box.height) / 5
      points++
      const hits = candidates.filter((other) => {
        const b = other.bounds as Bounds
        return x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height
      })
      const painter = hits.find(draws) ?? hits.find((hit) => [...walkTree(hit)].some((inner) => inner !== hit && draws(inner) && inner.bounds && x >= inner.bounds.x && x < inner.bounds.x + inner.bounds.width && y >= inner.bounds.y && y < inner.bounds.y + inner.bounds.height))
      if (!painter) continue
      covered++
      tally.set(painter, (tally.get(painter) ?? 0) + 1)
    }
  }
  const result: Obscured = { points, covered, painted: changed, hidden: changed }
  const top = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
  if (top) {
    // The layer: the outermost ancestor of the cover that is still drawn over the focused node.
    let layer = top
    for (const ancestor of ancestors(top, parents)) {
      if (own.has(ancestor) || !drawnOver(ancestor, node, parents)) break
      layer = ancestor
    }
    const element = nativeElement(layer, map.get(layer))
    result.by = { ...element, position: layer.role === 'window' ? 'window' : 'layer', rect: rectOf(layer.bounds ?? box) }
  }
  return result
}
