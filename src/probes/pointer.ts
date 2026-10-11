import type { Browser } from 'playwright-core'
import type { ProbeRecord } from '../snapshot/schema.ts'
import { type ControlFacts, Harness, type HarnessAction, type SkipReason, skipReason } from './activate.ts'
import { blurTarget, chooseOption, contextChanges, focusTarget } from './input.ts'
import type { InPageElement } from './kit.ts'
import { type ProbeOptions, type ProbePage, skippedRecord } from './page.ts'

/**
 * Pointer probes (docs/plans/wcag-coverage.md, C7), on the activate-class harness (activate.ts):
 *
 * - 2.5.2 Pointer Cancellation: each control is pressed (the down-event), the pointer moves away and is released there.
 *   What changed on the press, and whether it was still in effect after the release, is recorded: a navigation, a
 *   window, a submission or a dialog on the press, or a state (pressed, checked, selected) that the release away did not
 *   undo, is what the plan calls a change committed on the down-event.
 * - 2.5.7 Dragging Movements: sliders, sortable and draggable items and splitters are dragged with the pointer; when the
 *   drag changed something (a value, the order of a list), the probe looks, on a fresh page, for a way to do the same
 *   with single clicks or typing: a click on the slider's track, buttons that move, raise or lower, an input for the
 *   value, a select that moves the item, or a menu the item opens. Arrow keys serve the keyboard, not a pointer, and are
 *   not tried.
 * - 2.5.1 Pointer Gestures: elements that react to swipes or pinches (carousels, maps, touch listeners) are listed with
 *   the single-pointer controls around them (previous and next, zoom in and out); nothing is swiped (the plan's D2).
 *
 * The guard is on all along, and the skip list applies to everything pressed or clicked.
 */

export const POINTER_VERSION = '1'
export const POINTER_LIMITS = { controls: 30, timeMs: 150_000 }
const MAX_PRESSES = 20
const MAX_DRAGS = 6
/** Drags cost two or three fresh pages each: they stop after this much of the time budget, so presses keep the rest. */
const DRAG_TIME_MS = 90_000
const MAX_LISTED = 80
/** Failures on the press confirmed on a second fresh load, at most. */
const MAX_CONFIRM = 5
/** How long after the press, and after the release, the page is watched. */
const PRESS_MS = 450
const RELEASE_MS = 450
const DRAG_MS = 600

/** Words of controls that move an item, or raise and lower a value, in English, Portuguese and Spanish. */
export const MOVE_WORDS =
  /\b(move|up|down|left|right|top|bottom|first|last|earlier|later|before|after|reorder|raise|lower|promote|demote)\b|[↑↓←→▲▼⬆⬇]|\bmover\b|\bsubir\b|\bdescer\b|para (cima|baixo|o topo|o fim)|acima|abaixo|\barriba\b|\babajo\b|primero|[uú]ltimo|reordenar|\bcolumn\b|\bcoluna\b|\bcolumna\b|\bposition\b|posi[cç][aã]o|posici[oó]n/i
export const MORE_WORDS =
  /\b(increase|decrease|increment|decrement|more|less|plus|minus|raise|lower|up|down|higher|smaller|bigger|larger|faster|slower)\b|^\s*[+\-−–]\s*$|[+−]|\baumentar\b|\bdiminuir\b|\bmais\b|\bmenos\b|\bsubir\b|\bbajar\b|\bincrementar\b|\bdecrementar\b/i
/** Controls that stand in for a swipe or a pinch: previous and next, zoom in and out. */
export const GESTURE_ALTERNATIVES =
  /\b(prev|previous|next|back|forward|zoom|pan)\b|[‹›«»←→]|anterior|pr[oó]xim|seguinte|siguiente|ampliar|reduzir|aproximar|afastar|acercar|alejar|go to slide|slide \d|ir para o slide/i

export interface PressEffects {
  /** ARIA state of the control itself, or its checked state or text: `aria-pressed false → true`. */
  state: string[]
  /** Mutations outside the control and the page's own changes: nodes added or removed, text, attributes other than class and style. */
  dom: number
  /** class and style changes outside the control. */
  style: number
  /** Characters of visible text that changed: lines gone plus lines new. */
  text: number
  /** What changed, a few: `<ul#menu> added`. */
  samples: string[]
}

export interface PressTrial {
  /** What the press did before the release. */
  onDown?: PressEffects | undefined
  /** What of it was still in effect after the pointer moved away and was released there. */
  persisted?: PressEffects | undefined
  /** Changes of context on the press: navigation, new-window, submission, modal, dialog, with what each was. */
  context?: Array<{ kind: string; detail?: string | undefined }> | undefined
  /** A dialog or a layer the press showed, and whether it still showed after the release. */
  layer?: { name: string; modal: boolean; stayed: boolean } | undefined
  /** The same press on a second fresh load, when the first seemed to commit on the press. */
  confirm?: Omit<PressTrial, 'confirm'> | undefined
  outcome?: 'unmatched' | 'not-exercised' | 'not-tried' | undefined
  reason?: string | undefined
}

export interface PressCandidate extends InPageElement {
  /** A pointerdown, mousedown or touchstart listener of its own (read over the DevTools protocol), or such an attribute. */
  down: boolean
  skip?: { reason: SkipReason; detail?: string | undefined } | undefined
  trial?: PressTrial | undefined
}

export type DragKind = 'slider' | 'sortable' | 'draggable' | 'splitter' | 'map' | 'other'

export interface DragAlternative {
  kind: 'track' | 'button' | 'input' | 'select' | 'menu'
  label: string
  ref?: string | undefined
  /** It did the same as the drag: changed the value, or the order of the list. */
  reproduced?: boolean | undefined
  /** It was not tried: the skip list, a cover. */
  skipped?: string | undefined
}

export interface DragTrial {
  /** The drag changed the value, the order or the size. */
  moved?: boolean | undefined
  /** What changed: `value 50 → 80`, `order of 4 items`. */
  effect?: string | undefined
  alternatives?: DragAlternative[] | undefined
  outcome?: 'unmatched' | 'not-exercised' | 'not-tried' | undefined
  reason?: string | undefined
}

export interface DragCandidate extends InPageElement {
  kind: DragKind
  /** The list that holds a sortable item, the element that holds a splitter's panes. */
  container?: InPageElement | undefined
  /** The item's text, to find it in the list after a move. */
  item?: string | undefined
  /** How many items the list holds, for sortables. */
  items?: number | undefined
  skip?: { reason: SkipReason; detail?: string | undefined } | undefined
  trial?: DragTrial | undefined
}

export interface GestureCandidate extends InPageElement {
  kind: 'carousel' | 'map' | 'touch'
  /** Why: a known library, touch listeners, `touch-action`. */
  why: string
  /** Single-pointer controls around it that stand in for the gesture: previous and next, zoom. */
  alternatives: string[]
}

export interface PointerData {
  viewport: { width: number; height: number }
  /** Controls found that may react to a press, and how many have a down listener of their own. */
  found: number
  withDown: number
  presses: PressCandidate[]
  drags: DragCandidate[]
  gestures: GestureCandidate[]
  /** The listeners could be read over the DevTools protocol. */
  listeners: boolean
  loads: number
  actions: HarnessAction[]
  end: 'complete' | 'budget' | 'time'
}

interface PointerWindow {
  __rampaKit: { describe(el: Element): InPageElement; visible(el: Element): boolean; resolve(ref: string): Element | null; deepActive(): Element | null }
  __rampaActivate: { facts(el: Element): ControlFacts }
  __rampaTarget?: Element | null
  __rampaPointer?: PointerKit
}

interface PointerKit {
  mark(): boolean
  down(): PressEffects
  after(): PressEffects
  stop(): void
}

/**
 * Installed on every page the harness opens, before its wait with no input (HarnessConfig.kits): a mutation log whose
 * targets become the page's own noise while no press is being watched; a watch from `mark()` that splits what a press
 * did into the control's own state (its ARIA state, its checked state, its text), feedback inside the control (a ripple,
 * a pressed class: left out), and changes outside it; and whether those changes are still in effect after the release.
 * Native drags of links and images are cancelled while a press is watched, so moving away never drops a link.
 */
export function installPointerKit(): void {
  const w = window as unknown as PointerWindow & { __rampaPointerDrag?: boolean }
  if (w.__rampaPointer) return
  const SKIP = new Set(['script', 'style', 'link', 'meta', 'noscript', 'template', 'title', 'head', 'base'])
  const STATE = ['aria-pressed', 'aria-checked', 'aria-selected', 'aria-expanded', 'aria-current']
  const collapse = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim()
  const noise = new WeakSet<Node>()
  let recording = false
  let records: MutationRecord[] = []
  let downRecords: MutationRecord[] = []
  const elementOf = (node: Node): Element | null => (node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement)
  // Carousels turn on their own (autoplay), slide by slide, so a slide that has not moved yet is not known as noise.
  const CAROUSELS = '.swiper, .swiper-container, .slick-slider, .glide, .flickity-enabled, .splide, .owl-carousel, .keen-slider, .embla, .carousel, [aria-roledescription="carousel" i]'
  const isNoise = (node: Node) => {
    const el = elementOf(node)
    return noise.has(node) || (el !== null && (noise.has(el) || (el.parentElement !== null && noise.has(el.parentElement)) || el.closest(CAROUSELS) !== null))
  }
  const observer = new MutationObserver((list) => {
    for (const record of list) {
      const el = elementOf(record.target)
      if (!el || SKIP.has(el.localName) || el.closest('head')) continue
      if (recording) records.push(record)
      else {
        noise.add(record.target)
        if (el) noise.add(el)
      }
    }
  })
  observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true, attributeOldValue: true, characterDataOldValue: true })
  document.addEventListener(
    'dragstart',
    (event) => {
      if (w.__rampaPointerDrag) event.preventDefault()
    },
    true,
  )
  const lines = (): string[] =>
    (document.body?.innerText ?? '')
      .slice(0, 200_000)
      .split('\n')
      .map((line) => line.replace(/\s+/g, ' ').replace(/\d/g, '0').trim())
      .filter(Boolean)
  const changedText = (from: string[], to: string[]): number => {
    const before = new Map<string, number>()
    for (const line of from) before.set(line, (before.get(line) ?? 0) + 1)
    let changed = 0
    for (const line of to) {
      const left = before.get(line) ?? 0
      if (left > 0) before.set(line, left - 1)
      else changed += line.length
    }
    for (const [line, left] of before) changed += line.length * left
    return changed
  }
  let control: Element | null = null
  let baseline: { state: Record<string, string | null>; checked: boolean | null; text: string; lines: string[] } | undefined
  const stateOf = (el: Element) => Object.fromEntries(STATE.map((name) => [name, el.getAttribute(name)]))
  const checkedOf = (el: Element) => (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio') ? el.checked : null)
  const describe = (el: Element | null) => {
    if (!el) return 'an element'
    const id = el.id ? `#${el.id}` : ''
    return `<${el.localName}${id}>`
  }
  /** Effects of a list of records, or only those still in effect (`now`). */
  const effects = (list: MutationRecord[], now: boolean): PressEffects => {
    const result: PressEffects = { state: [], dom: 0, style: 0, text: 0, samples: [] }
    const target = control
    if (!target || !baseline) return result
    const inside = (node: Node) => node === target || target.contains(node)
    let ownText = false
    for (const record of list) {
      if (isNoise(record.target)) continue
      const still = (): boolean => {
        if (!now) return true
        if (record.type === 'attributes') return (record.target as Element).getAttribute(record.attributeName ?? '') !== record.oldValue
        if (record.type === 'characterData') return (record.target as CharacterData).data !== record.oldValue
        return Array.from(record.addedNodes).some((node) => node.isConnected) || Array.from(record.removedNodes).some((node) => !node.isConnected)
      }
      if (inside(record.target)) {
        // Inside the control: its own ARIA state is read apart; nodes without text and class or style changes are
        // feedback (a ripple, a pressed look). Text that changes inside it ("Follow" to "Following") is its state.
        if (record.type === 'characterData' || (record.type === 'childList' && [...Array.from(record.addedNodes), ...Array.from(record.removedNodes)].some((node) => collapse(node.textContent) !== ''))) {
          if (still()) ownText = true
        }
        continue
      }
      if (!still()) continue
      if (record.type === 'attributes' && (record.attributeName === 'class' || record.attributeName === 'style')) {
        result.style++
        continue
      }
      if (record.type === 'childList') {
        const nodes = [...Array.from(record.addedNodes), ...Array.from(record.removedNodes)].filter(
          (node) => (node.nodeType === Node.ELEMENT_NODE && !SKIP.has((node as Element).localName)) || (node.nodeType === Node.TEXT_NODE && collapse(node.textContent) !== ''),
        )
        if (nodes.length === 0) continue
        result.dom += nodes.length
        if (result.samples.length < 3) result.samples.push(`${describe(elementOf(nodes[0] as Node) ?? elementOf(record.target))} ${record.addedNodes.length > 0 ? 'added' : 'removed'}`)
        continue
      }
      result.dom++
      if (result.samples.length < 3) result.samples.push(record.type === 'attributes' ? `${record.attributeName} of ${describe(record.target as Element)}` : `text of ${describe(elementOf(record.target))}`)
    }
    const state = stateOf(target)
    for (const name of STATE) {
      if (state[name] !== baseline.state[name]) result.state.push(`${name} ${baseline.state[name] ?? '(none)'} → ${state[name] ?? '(none)'}`)
    }
    const checked = checkedOf(target)
    if (checked !== baseline.checked) result.state.push(`checked ${baseline.checked} → ${checked}`)
    if (ownText && collapse((target as HTMLElement).innerText ?? target.textContent) !== baseline.text) {
      result.state.push(`text "${baseline.text.slice(0, 40)}" → "${collapse((target as HTMLElement).innerText ?? target.textContent).slice(0, 40)}"`)
    }
    result.text = changedText(baseline.lines, lines())
    return result
  }
  w.__rampaPointer = {
    mark() {
      control = w.__rampaTarget ?? null
      if (!control) return false
      observer.takeRecords()
      records = []
      downRecords = []
      baseline = { state: stateOf(control), checked: checkedOf(control), text: collapse((control as HTMLElement).innerText ?? control.textContent), lines: lines() }
      recording = true
      w.__rampaPointerDrag = true
      return true
    },
    down() {
      records.push(...observer.takeRecords())
      downRecords = [...records]
      return effects(downRecords, false)
    },
    after() {
      records.push(...observer.takeRecords())
      return effects(downRecords, true)
    },
    stop() {
      records.push(...observer.takeRecords())
      recording = false
      w.__rampaPointerDrag = false
      // What changed during the press is not noise for later presses; the next one gets a fresh page when it changed anything.
      records = []
    },
  }
}

/**
 * Runs in the page; needs the kit and the activate kit. Controls that may react to a press, drag widgets, and elements
 * that react to swipes or pinches. Elements the DevTools protocol found listeners on carry `__rampaPtr` (down, move,
 * touch, gesture, drag).
 */
export function findPointerTargets(args: { max: number; move: string; more: string; gestures: string }): {
  found: number
  withDown: number
  presses: Array<PressCandidate & { facts: ControlFacts }>
  drags: Array<DragCandidate & { facts: ControlFacts }>
  gestures: GestureCandidate[]
} {
  const w = window as unknown as PointerWindow
  const kit = w.__rampaKit
  const gestureWords = new RegExp(args.gestures, 'i')
  const collapse = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim()
  const cut = (value: string, n: number) => (value.length > n ? `${value.slice(0, n - 1)}…` : value)
  const showing = (el: Element) => kit.visible(el) && el.getBoundingClientRect().width >= 4 && el.getBoundingClientRect().height >= 4
  const listen = (el: Element): string => (el as unknown as { __rampaPtr?: string }).__rampaPtr ?? ''
  const labelled = (el: Element) =>
    collapse(
      (el.getAttribute('aria-labelledby') ?? '')
        .split(/\s+/)
        .filter(Boolean)
        .map((id) => document.getElementById(id)?.textContent ?? '')
        .join(' '),
    )
  const nameOf = (el: Element) =>
    cut(collapse(el.getAttribute('aria-label') || labelled(el) || (el as HTMLElement).innerText || el.textContent || el.getAttribute('title') || (el as HTMLInputElement).value || ''), 80)
  const INTERACTIVE = 'a[href], button, input, select, textarea, summary, [role=button], [role=link], [role=tab], [role=menuitem], [role=option], [role=switch], [role=checkbox], [role=radio], [role=slider], [tabindex]'
  const container = (el: Element) => el.querySelectorAll(INTERACTIVE).length > 3
  const isDragItem = (el: Element) =>
    (el.getAttribute('draggable') === 'true' && el.localName !== 'a' && el.localName !== 'img') ||
    /sortable|draggable|arrast[aá]vel|arrastrable/i.test(el.getAttribute('aria-roledescription') ?? '') ||
    el.hasAttribute('aria-grabbed') ||
    el.hasAttribute('data-rbd-drag-handle-draggable-id') ||
    el.hasAttribute('data-rfd-drag-handle-draggable-id') ||
    el.hasAttribute('data-sortable-id') ||
    (/(^|[\s_-])(sortable-item|sortable-handle|drag-handle|draggable|dnd-item|cdk-drag|ui-sortable-handle)([\s_-]|$)/i.test(el.getAttribute('class') ?? '') && el.localName !== 'th' && el.getAttribute('role') !== 'columnheader')

  // 2.5.7: drag widgets.
  const drags: Array<DragCandidate & { facts: ControlFacts }> = []
  const dragElements = new Set<Element>()
  const lists = new Set<Element>()
  // An item's own words, without the controls inside it: a "Remove" button in a list item is not the item's name.
  const ownText = (el: Element): string => {
    const clone = el.cloneNode(true) as Element
    for (const control of Array.from(clone.querySelectorAll('button, a, input, select, textarea, [role=button], [role=link]'))) control.remove()
    return cut(collapse(el.getAttribute('aria-label') || labelled(el) || clone.textContent), 80)
  }
  const addDrag = (el: Element, kind: DragKind, extra: Partial<DragCandidate> = {}) => {
    if (drags.length >= 20 || dragElements.has(el)) return
    dragElements.add(el)
    const facts = w.__rampaActivate.facts(el)
    const label = ownText(el)
    drags.push({ ...kit.describe(el), label: label || kit.describe(el).label, kind, ...extra, facts: { ...facts, texts: [label, el.getAttribute('title') ?? ''].filter(Boolean) } })
  }
  for (const el of Array.from(document.querySelectorAll('[role=slider]'))) {
    if (el.localName === 'input' || !showing(el)) continue
    addDrag(el, 'slider')
  }
  const CAROUSEL_PARTS = '.swiper, .swiper-container, .slick-slider, .glide, .flickity-enabled, .splide, .owl-carousel, .keen-slider, .embla, .carousel, [aria-roledescription="carousel" i]'
  for (const el of Array.from(document.querySelectorAll('[draggable], [aria-roledescription], [aria-grabbed], [data-rbd-drag-handle-draggable-id], [data-rfd-drag-handle-draggable-id], [data-sortable-id], [class]'))) {
    // A carousel's own drag (slick marks its list "draggable") moves slides, not the order of a list: 2.5.1 lists it.
    if (!isDragItem(el) || !showing(el) || el.closest('[role=slider]') || el.closest(CAROUSEL_PARTS)) continue
    // An item, or the handle inside an item: the list is the parent of the item that has siblings like it.
    let item: Element = el
    while (item.parentElement && item.parentElement.children.length < 2 && item.parentElement !== document.body) item = item.parentElement
    const list = item.parentElement
    if (!list || lists.has(list)) continue
    // Only a class says so: the item must sit among items like it.
    const marked =
      el.getAttribute('draggable') === 'true' ||
      /sortable|draggable|arrast/i.test(el.getAttribute('aria-roledescription') ?? '') ||
      el.hasAttribute('aria-grabbed') ||
      ['data-rbd-drag-handle-draggable-id', 'data-rfd-drag-handle-draggable-id', 'data-sortable-id'].some((name) => el.hasAttribute(name))
    if (!marked && Array.from(list.children).filter((child) => child.localName === item.localName).length < 2) continue
    lists.add(list)
    const items = Array.from(list.children).filter((child) => showing(child))
    // Drag the first item that has a next sibling, so the move has somewhere to go.
    addDrag(el, list.children.length >= 2 ? 'sortable' : 'draggable', { container: kit.describe(list), item: cut(collapse((item as HTMLElement).innerText ?? item.textContent), 60), items: items.length })
  }
  // Lists a library sorts with listeners on the list itself, with no sign on the items at load: SortableJS keeps its
  // instance on the list (`Sortable…`), and a list with a press listener of its own whose like-items show a move or
  // grab cursor is sorted the same way.
  for (const el of Array.from(document.querySelectorAll('body *'))) {
    if (drags.length >= 20) break
    if (lists.has(el) || el.children.length < 2) continue
    const sortableJs = Object.keys(el).some((key) => key.startsWith('Sortable'))
    if (!sortableJs && !listen(el).includes('down')) continue
    const items = Array.from(el.children).filter((child) => showing(child))
    const first = items[0]
    if (!first || items.length < 2 || !items.every((child) => child.localName === first.localName)) continue
    if (!sortableJs && !/^(move|grab|-webkit-grab)$/.test(getComputedStyle(first).cursor)) continue
    lists.add(el)
    addDrag(first, 'sortable', { container: kit.describe(el), item: cut(collapse((first as HTMLElement).innerText ?? first.textContent), 60), items: items.length })
  }
  for (const el of Array.from(document.querySelectorAll('[role=separator]'))) {
    if (!showing(el) || !(el.hasAttribute('tabindex') || el.hasAttribute('aria-valuenow'))) continue
    addDrag(el, 'splitter', el.parentElement ? { container: kit.describe(el.parentElement) } : {})
  }
  const MAPS = '.leaflet-container, .mapboxgl-map, .maplibregl-map, .gm-style, .ol-viewport, [aria-roledescription="map" i]'
  // Elements a pointer moves by hand: a grab cursor and a down listener of their own.
  const walker = document.createTreeWalker(document.body ?? document.documentElement, NodeFilter.SHOW_ELEMENT)
  for (let n = walker.nextNode(), i = 0; n && i < 20_000 && drags.length < 20; n = walker.nextNode(), i++) {
    const el = n as Element
    if (dragElements.has(el) || !listen(el).includes('down') || el.closest(MAPS) || !showing(el)) continue
    const cursor = getComputedStyle(el).cursor
    if (!/^(grab|-webkit-grab|move|col-resize|row-resize|ew-resize|ns-resize)$/.test(cursor)) continue
    if ([...dragElements].some((other) => other.contains(el) || el.contains(other))) continue
    addDrag(el, 'other')
  }
  for (const el of Array.from(document.querySelectorAll(MAPS)).slice(0, 3)) {
    if (!showing(el)) continue
    addDrag(el, 'map')
  }

  // 2.5.1: what reacts to a swipe or a pinch.
  const gestures: GestureCandidate[] = []
  const gestureElements = new Set<Element>()
  const alternativesNear = (el: Element): string[] => {
    const scope = el.parentElement?.parentElement ?? el.parentElement ?? el
    const found = new Set<string>()
    for (const control of Array.from(scope.querySelectorAll('button, [role=button], a[href], [role=tab]'))) {
      const name = collapse(control.getAttribute('aria-label') || (control as HTMLElement).innerText || control.getAttribute('title') || '')
      if (name && gestureWords.test(name) && showing(control)) found.add(cut(name, 40))
      if (found.size >= 4) break
    }
    return [...found]
  }
  const addGesture = (el: Element, kind: GestureCandidate['kind'], why: string) => {
    if (gestures.length >= 10 || [...gestureElements].some((other) => other.contains(el) || el.contains(other))) return
    gestureElements.add(el)
    gestures.push({ ...kit.describe(el), label: cut(collapse(el.getAttribute('aria-label') || el.getAttribute('aria-roledescription') || ''), 60) || kit.describe(el).label.slice(0, 60), kind, why, alternatives: alternativesNear(el) })
  }
  const CAROUSELS = '.swiper, .swiper-container, .slick-slider, .glide, .flickity-enabled, .splide, .owl-carousel, .keen-slider, .embla, .carousel, [aria-roledescription="carousel" i]'
  // Every carousel and map is a zone presses stay out of (moving away with the button down swipes it), listed or not.
  const zones = new Set<Element>()
  for (const el of Array.from(document.querySelectorAll(`${CAROUSELS}, ${MAPS}`))) zones.add(el)
  for (const el of Array.from(document.querySelectorAll(CAROUSELS))) {
    if (!showing(el)) continue
    const known = el.matches('.swiper, .swiper-container, .slick-slider, .glide, .flickity-enabled, .splide, .owl-carousel, .keen-slider, .embla')
    const touch = /touch|gesture/.test(listen(el)) || Array.from(el.querySelectorAll('*')).slice(0, 200).some((child) => /touch|gesture/.test(listen(child)))
    if (known || touch) addGesture(el, 'carousel', known ? `a ${el.className.toString().split(/\s+/)[0]} carousel, which swipes` : 'touch listeners')
  }
  for (const el of Array.from(document.querySelectorAll(MAPS)).slice(0, 3)) if (showing(el)) addGesture(el, 'map', 'a map, which pans with a drag and zooms with a pinch')
  const walker2 = document.createTreeWalker(document.body ?? document.documentElement, NodeFilter.SHOW_ELEMENT)
  for (let n = walker2.nextNode(), i = 0; n && i < 20_000 && gestures.length < 10; n = walker2.nextNode(), i++) {
    const el = n as Element
    const types = listen(el)
    if (!(types.includes('gesture') || (types.includes('touch') && types.includes('move'))) || !showing(el)) continue
    if (el === document.body || el === document.documentElement || dragElements.has(el) || [...dragElements].some((d) => el.contains(d) || d.contains(el))) continue
    // A listener on a block that holds most of the page is delegation, not a gesture.
    if (el.getBoundingClientRect().width * el.getBoundingClientRect().height > 0.6 * window.innerWidth * Math.max(window.innerHeight, document.documentElement.scrollHeight)) continue
    addGesture(el, 'touch', types.includes('gesture') ? 'gesture listeners' : 'touchstart and touchmove listeners')
  }

  // 2.5.2: controls that may react to a press. Those with a down listener of their own first.
  const presses: Array<PressCandidate & { facts: ControlFacts }> = []
  const seen = new Set<Element>()
  let found = 0
  let withDown = 0
  const NATIVE = (el: Element) => el.matches('select, textarea, input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=reset]):not([type=image]), [contenteditable=""], [contenteditable=true], iframe, video, audio, label, option')
  // Items of a list sorted by dragging take a release elsewhere as a drop, which 2.5.2 allows: they are 2.5.7's.
  const dragZones = [...dragElements, ...lists, ...gestureElements, ...zones]
  const consider = (el: Element, down: boolean) => {
    if (seen.has(el)) return
    seen.add(el)
    if (NATIVE(el) || !showing(el) || dragZones.some((zone) => zone === el || zone.contains(el)) || el.closest('[role=slider]')) return
    if (container(el)) return
    found++
    if (down) withDown++
    if (presses.length >= args.max) return
    presses.push({ ...kit.describe(el), label: nameOf(el) || kit.describe(el).label, down, facts: w.__rampaActivate.facts(el) })
  }
  const all = Array.from(document.querySelectorAll('*'))
  for (const el of all) if (listen(el).includes('down') && el !== document.body && el !== document.documentElement) consider(el, true)
  for (const el of all) if (el.hasAttribute('onmousedown') || el.hasAttribute('onpointerdown') || el.hasAttribute('ontouchstart')) consider(el, true)
  for (const el of Array.from(
    document.querySelectorAll('button, a[href], summary, [role=button], [role=link], [role=tab], [role=menuitem], [role=menuitemcheckbox], [role=menuitemradio], [role=option], [role=switch], [role=checkbox], [role=radio], [role=treeitem], input[type=checkbox], input[type=radio], input[type=button]'),
  )) {
    consider(el, false)
  }
  return { found, withDown, presses, drags, gestures }
}

/**
 * Marks elements that have pointer listeners of their own (`__rampaPtr`: down, move, touch, gesture, drag), read over the
 * DevTools protocol, as the hover probe reads hover listeners. Null when the protocol could not be read.
 */
export async function markPointerListeners(probe: ProbePage): Promise<boolean> {
  try {
    const cdp = await probe.context.newCDPSession(probe.page)
    try {
      const { result } = await cdp.send('Runtime.evaluate', { expression: 'document' })
      if (!result.objectId) return false
      const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId, depth: -1, pierce: true })
      const KIND: Record<string, string> = {
        pointerdown: 'down',
        mousedown: 'down',
        // A touch listener says nothing of what a mouse press does: the probe presses with a mouse.
        touchstart: 'touch',
        touchmove: 'touch move',
        pointermove: 'move',
        mousemove: 'move',
        gesturestart: 'gesture',
        gesturechange: 'gesture',
        dragstart: 'drag',
      }
      const byNode = new Map<number, Set<string>>()
      for (const listener of listeners) {
        const kinds = KIND[listener.type]
        if (!kinds || !listener.backendNodeId) continue
        const set = byNode.get(listener.backendNodeId) ?? new Set<string>()
        for (const kind of kinds.split(' ')) set.add(kind)
        byNode.set(listener.backendNodeId, set)
      }
      for (const [backendNodeId, kinds] of [...byNode.entries()].slice(0, 600)) {
        try {
          const { object } = await cdp.send('DOM.resolveNode', { backendNodeId })
          if (!object.objectId) continue
          await cdp.send('Runtime.callFunctionOn', {
            objectId: object.objectId,
            functionDeclaration: 'function (kinds) { if (this.nodeType === 1) this.__rampaPtr = kinds }',
            arguments: [{ value: [...kinds].join(' ') }],
          })
        } catch {
          // The node went away.
        }
      }
      return true
    } finally {
      await cdp.detach().catch(() => undefined)
    }
  } catch {
    return false
  }
}

/** Runs in the page: a point away from the located control, inside the window, on nothing interactive: where the pointer is released. */
export function awayPoint(): { x: number; y: number } | null {
  const w = window as unknown as PointerWindow
  const target = w.__rampaTarget
  if (!target) return null
  const box = target.getBoundingClientRect()
  const width = window.innerWidth
  const height = window.innerHeight
  const INTERACTIVE = 'a[href], button, input, select, textarea, summary, label, [role=button], [role=link], [role=tab], [role=menuitem], [role=option], [role=slider], [tabindex], [draggable=true]'
  const candidates = [
    [8, height - 8],
    [width - 8, height - 8],
    [width / 2, height - 8],
    [8, height / 2],
    [width - 8, height / 2],
    [8, 8],
    [width - 8, 8],
  ]
  for (const [x, y] of candidates as Array<[number, number]>) {
    if (x >= box.left - 60 && x <= box.right + 60 && y >= box.top - 60 && y <= box.bottom + 60) continue
    const hit = document.elementFromPoint(x, y)
    if (!hit || target.contains(hit)) continue
    // An element around the control may take the release as its own; only the page's own background will do.
    if (hit.contains(target) && hit !== document.body && hit !== document.documentElement) continue
    if (hit.closest(INTERACTIVE)) continue
    return { x: Math.round(x), y: Math.round(y) }
  }
  return null
}

const CONTEXT_KINDS = new Set(['navigation', 'new-window', 'submission', 'modal', 'dialog'])

/** Press, move away, release: what the press did, and what of it the release away left in place. */
async function tryPress(harness: Harness, press: PressCandidate, fresh: boolean): Promise<Omit<PressTrial, 'confirm'>> {
  const probe = await harness.page(fresh)
  const page = probe.page
  if (!(await harness.locate(probe, press))) return { outcome: 'unmatched' }
  const aimed = await harness.aim(probe, press)
  if ('cover' in aimed) return { outcome: 'not-exercised', reason: `covered by <${aimed.cover.tag}> "${aimed.cover.text.slice(0, 60)}"` }
  if ('hidden' in aimed) {
    harness.log('not-exercised', { ref: press.ref, label: press.label, detail: 'not showing on this load' })
    return { outcome: 'not-exercised', reason: 'not showing on this load' }
  }
  const away = await page.evaluate(awayPoint)
  if (!away) {
    harness.log('not-exercised', { ref: press.ref, label: press.label, detail: 'no place to release the pointer away from it' })
    return { outcome: 'not-exercised', reason: 'no place to release the pointer away from it' }
  }
  await page.mouse.move(aimed.x, aimed.y)
  if (!(await page.evaluate(() => (window as unknown as PointerWindow).__rampaPointer?.mark() ?? false))) return { outcome: 'unmatched' }
  harness.log('activate', { ref: press.ref, label: press.label, detail: `pressed, moved to ${away.x},${away.y} and released there` })
  const down = await harness.window(
    probe,
    async () => {
      await page.mouse.down()
    },
    { ms: PRESS_MS, ref: press.ref, label: press.label },
  )
  const onDown = await page.evaluate(() => (window as unknown as PointerWindow).__rampaPointer?.down()).catch(() => undefined)
  await harness.window(
    probe,
    async () => {
      await page.mouse.move(away.x, away.y, { steps: 6 })
      await page.mouse.up()
    },
    { ms: RELEASE_MS, ref: press.ref, label: press.label },
  )
  const persisted = await page.evaluate(() => (window as unknown as PointerWindow).__rampaPointer?.after()).catch(() => undefined)
  await page.evaluate(() => (window as unknown as PointerWindow).__rampaPointer?.stop()).catch(() => undefined)
  const context = contextChanges(down, 'input')
    .filter((change) => CONTEXT_KINDS.has(change.kind))
    .map((change) => ({ kind: change.kind, ...(change.detail ? { detail: change.detail.slice(0, 200) } : {}) }))
  let layer: PressTrial['layer']
  if (down.opened) {
    const ref = down.opened.ref
    const stayed = await page.evaluate((r) => {
      const w = window as unknown as PointerWindow
      const el = w.__rampaKit.resolve(r)
      return el !== null && w.__rampaKit.visible(el) && el.getBoundingClientRect().width > 0
    }, ref)
    layer = { name: down.opened.name, modal: down.opened.modal, stayed }
  }
  return { ...(onDown ? { onDown } : {}), ...(persisted ? { persisted } : {}), ...(context.length > 0 ? { context } : {}), ...(layer ? { layer } : {}) }
}

/** What a press did, as 2.5.2 reads it: a change of context, a state the release did not undo, a layer that stayed, other changes that stayed. */
export function pressOutcome(trial: Omit<PressTrial, 'confirm'> | undefined): { kind: 'context' | 'state' | 'expanded' | 'layer' | 'content' | 'reversed' | 'none'; detail?: string | undefined } {
  if (!trial || trial.outcome) return { kind: 'none' }
  const context = trial.context?.[0]
  if (context) return { kind: 'context', detail: `${context.kind}${context.detail ? `: ${context.detail}` : ''}` }
  const persisted = trial.persisted
  const states = persisted?.state ?? []
  const committed = states.filter((s) => !s.startsWith('aria-expanded') && !s.startsWith('aria-current'))
  if (committed.length > 0) return { kind: 'state', detail: committed.join('; ') }
  if (trial.layer?.stayed) return { kind: 'layer', detail: trial.layer.name }
  if (states.some((s) => s.startsWith('aria-expanded'))) return { kind: 'expanded', detail: states.find((s) => s.startsWith('aria-expanded')) }
  if (persisted && (persisted.dom > 0 || (persisted.style > 0 && persisted.text > 0))) return { kind: 'content', detail: persisted.samples.join(', ') || `${persisted.text} characters of text` }
  const onDown = trial.onDown
  if (onDown && (onDown.state.length > 0 || onDown.dom > 0 || (onDown.style > 0 && onDown.text > 0) || trial.layer)) return { kind: 'reversed' }
  return { kind: 'none' }
}

/** Runs in the page: the state a drag may change, read from the candidate's elements. */
export function readDrag(args: { kind: DragKind; ref: string; container?: string | undefined; item?: string | undefined }): { value: string | null; order: string[]; x: number; y: number; size: number } | null {
  const w = window as unknown as PointerWindow
  const el = w.__rampaKit.resolve(args.ref)
  const collapse = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim()
  const list = args.container ? w.__rampaKit.resolve(args.container) : null
  const order = list ? Array.from(list.children).map((child) => collapse((child as HTMLElement).innerText ?? child.textContent).slice(0, 60)) : []
  if (!el && !list) return null
  const box = el?.getBoundingClientRect()
  const value = el ? (el.getAttribute('aria-valuenow') ?? (el instanceof HTMLInputElement ? el.value : null)) : null
  const previous = el?.previousElementSibling?.getBoundingClientRect()
  return {
    value,
    order,
    x: box ? Math.round(box.left + box.width / 2) : 0,
    y: box ? Math.round(box.top + box.height / 2) : 0,
    size: previous ? Math.round(previous.width * 10) / 10 + Math.round(previous.height * 10) / 10 : 0,
  }
}

/**
 * Runs in the page: where to press and where to release for a drag of the candidate, and the track a single click may
 * set (sliders). The handle is scrolled into the middle of the window first.
 */
export function planDrag(args: { kind: DragKind; ref: string; container?: string | undefined }): { from: { x: number; y: number }; to: { x: number; y: number }; track?: { x: number; y: number } | undefined } | null {
  const w = window as unknown as PointerWindow
  const el = w.__rampaKit.resolve(args.ref)
  if (!el) return null
  el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' as ScrollBehavior })
  const box = el.getBoundingClientRect()
  const center = { x: box.left + box.width / 2, y: box.top + box.height / 2 }
  const clamp = (p: { x: number; y: number }) => ({ x: Math.round(Math.min(Math.max(p.x, 2), window.innerWidth - 2)), y: Math.round(Math.min(Math.max(p.y, 2), window.innerHeight - 2)) })
  if (args.kind === 'slider') {
    const vertical = el.getAttribute('aria-orientation') === 'vertical'
    const long = (r: DOMRect) => (vertical ? r.height : r.width)
    let track: Element = el
    let thumb = center
    if (long(box) >= 3 * (vertical ? box.width : box.height)) {
      // The slider is the track, or holds it: a long, thin element inside it (an SVG rail) is where a click lands and
      // the thumb sits, at the value's place on it.
      const short = (r: DOMRect) => (vertical ? r.width : r.height)
      const rail = Array.from(el.querySelectorAll('*'))
        .map((child) => ({ child, r: child.getBoundingClientRect() }))
        .filter(({ r }) => long(r) >= 0.5 * long(box) && short(r) >= 1 && short(r) <= 0.4 * short(box))
        .sort((a, b) => long(b.r) - long(a.r))[0]
      if (rail) track = rail.child
      const t = track.getBoundingClientRect()
      const min = Number(el.getAttribute('aria-valuemin') ?? 0)
      const max = Number(el.getAttribute('aria-valuemax') ?? 100)
      const now = Number(el.getAttribute('aria-valuenow') ?? min)
      const share = max > min ? Math.min(Math.max((now - min) / (max - min), 0), 1) : 0
      thumb = vertical ? { x: t.left + t.width / 2, y: t.bottom - share * t.height } : { x: t.left + share * t.width, y: t.top + t.height / 2 }
    } else {
      for (let a = el.parentElement, i = 0; a && i < 4; a = a.parentElement, i++) {
        if (long(a.getBoundingClientRect()) >= 3 * long(box)) {
          track = a
          break
        }
      }
    }
    const t = track.getBoundingClientRect()
    const length = long(t)
    const position = vertical ? t.bottom - thumb.y : thumb.x - t.left
    const step = (position < length / 2 ? 1 : -1) * Math.max(24, length * 0.3)
    const to = vertical ? { x: thumb.x, y: thumb.y - step } : { x: thumb.x + step, y: thumb.y }
    return { from: clamp(thumb), to: clamp(to), track: clamp(to) }
  }
  if (args.kind === 'splitter') {
    const vertical = el.getAttribute('aria-orientation') !== 'horizontal'
    return { from: clamp(center), to: clamp(vertical ? { x: center.x + 60, y: center.y } : { x: center.x, y: center.y + 60 }) }
  }
  // A sortable or draggable item: pressed on its own content, not on a control inside it (a drag does not start from
  // a button), and moved past its next sibling, or its previous one when it is the last, along the list.
  const CONTROL = 'button, a[href], input, select, textarea, [role=button], [role=link]'
  const grip =
    [center, { x: box.left + Math.min(16, box.width / 4), y: center.y }, { x: box.left + box.width / 4, y: center.y }, { x: box.right - 12, y: center.y }].find((p) => {
      const hit = document.elementFromPoint(p.x, p.y)
      if (!hit || !el.contains(hit)) return false
      const control = hit.closest(CONTROL)
      return control === null || control === el || !el.contains(control)
    }) ?? center
  let item: Element = el
  while (item.parentElement && item.parentElement.children.length < 2 && item.parentElement !== document.body) item = item.parentElement
  const next = item.nextElementSibling ?? item.previousElementSibling
  const forward = item.nextElementSibling !== null
  const ib = item.getBoundingClientRect()
  if (next) {
    const nb = next.getBoundingClientRect()
    const horizontal = Math.abs(nb.top - ib.top) < ib.height / 2 && Math.abs(nb.left - ib.left) >= ib.width / 2
    // Released inside the sibling, past its middle (before it, when moving back): never in the gap between two items.
    const share = forward ? 0.75 : 0.25
    const to = horizontal ? { x: nb.left + nb.width * share, y: grip.y } : { x: grip.x, y: nb.top + nb.height * share }
    return { from: clamp(grip), to: clamp(to) }
  }
  return { from: clamp(grip), to: clamp({ x: grip.x + 80, y: grip.y }) }
}

/** Whether a drag, or an alternative, changed what the candidate holds. */
export function dragChange(kind: DragKind, before: ReturnType<typeof readDrag>, after: ReturnType<typeof readDrag>): string | undefined {
  if (!before || !after) return undefined
  if (kind === 'slider' || kind === 'splitter') {
    if (before.value !== null && after.value !== null && before.value !== after.value) return `value ${before.value} → ${after.value}`
    if (kind === 'splitter' && Math.abs(after.size - before.size) > 3) return `pane resized by ${Math.round(Math.abs(after.size - before.size))} px`
    if (before.value === null && (Math.abs(after.x - before.x) > 3 || Math.abs(after.y - before.y) > 3)) return 'handle moved'
    return undefined
  }
  if (before.order.length > 0 && before.order.join('\n') !== after.order.join('\n')) return `order of ${before.order.length} items changed`
  if (before.order.length === 0 && (Math.abs(after.x - before.x) > 8 || Math.abs(after.y - before.y) > 8)) return 'moved'
  return undefined
}

/**
 * Runs in the page: single-pointer alternatives around a drag candidate: buttons that move, raise or lower, inputs for
 * the value, selects that move the item. Ordered by how close they sit to the candidate.
 */
export function findAlternatives(args: { kind: DragKind; ref: string; container?: string | undefined; move: string; more: string }): Array<DragAlternative & { id: InPageElement['id']; facts: ControlFacts; control: 'button' | 'input' | 'select' }> {
  const w = window as unknown as PointerWindow
  const kit = w.__rampaKit
  const el = kit.resolve(args.ref)
  if (!el) return []
  const words = new RegExp(args.kind === 'slider' || args.kind === 'splitter' ? args.more : args.move, 'i')
  const collapse = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim()
  const showing = (e: Element) => kit.visible(e) && e.getBoundingClientRect().width > 0
  let item: Element = el
  while (item.parentElement && item.parentElement.children.length < 2 && item.parentElement !== document.body) item = item.parentElement
  const list = args.container ? kit.resolve(args.container) : item.parentElement
  // The item, then its list and two levels around the list (short of a form or the page).
  const scopes: Element[] = [item]
  for (let a: Element | null = list, i = 0; a && i < 3 && a !== document.body && a.localName !== 'form'; a = a.parentElement, i++) scopes.push(a)
  const found: Array<DragAlternative & { id: InPageElement['id']; facts: ControlFacts; control: 'button' | 'input' | 'select' }> = []
  const seen = new Set<Element>()
  for (const scope of scopes) {
    for (const control of Array.from(scope.querySelectorAll('button, [role=button], input, select, a[href^="#"], a:not([href])[tabindex]'))) {
      if (found.length >= 5) return found
      if (seen.has(control) || control === el || !showing(control)) continue
      seen.add(control)
      const name = collapse(control.getAttribute('aria-label') || (control as HTMLElement).innerText || control.getAttribute('title') || (control as HTMLInputElement).value || '')
      const labels = 'labels' in control ? Array.from((control as HTMLInputElement).labels ?? []).map((l) => collapse(l.textContent)).join(' ') : ''
      const described = kit.describe(control)
      if (control.localName === 'select') {
        const options = Array.from((control as HTMLSelectElement).options).map((o) => o.label).join(' ')
        if (new RegExp(args.move, 'i').test(`${labels} ${control.getAttribute('aria-label') ?? ''} ${options}`)) found.push({ kind: 'select', label: labels || described.label, ref: described.ref, id: described.id, facts: w.__rampaActivate.facts(control), control: 'select' })
        continue
      }
      if (control.localName === 'input') {
        const type = (control as HTMLInputElement).type
        if ((type === 'number' || type === 'text') && (args.kind === 'slider' || args.kind === 'splitter' || scope === item)) {
          found.push({ kind: 'input', label: labels || name || described.label, ref: described.ref, id: described.id, facts: w.__rampaActivate.facts(control), control: 'input' })
        } else if ((type === 'button' || type === 'submit') && words.test(name)) {
          found.push({ kind: 'button', label: name, ref: described.ref, id: described.id, facts: w.__rampaActivate.facts(control), control: 'button' })
        }
        continue
      }
      if (words.test(name)) found.push({ kind: 'button', label: name.slice(0, 60), ref: described.ref, id: described.id, facts: w.__rampaActivate.facts(control), control: 'button' })
    }
  }
  return found
}

/** Runs in the page: the controls that show and name a move, for the menu an item may open when clicked. */
export function shownMoveControls(args: { move: string }): Array<{ ref: string; id: InPageElement['id']; label: string; facts: ControlFacts }> {
  const w = window as unknown as PointerWindow
  const kit = w.__rampaKit
  const words = new RegExp(args.move, 'i')
  const out: Array<{ ref: string; id: InPageElement['id']; label: string; facts: ControlFacts }> = []
  for (const control of Array.from(document.querySelectorAll('button, [role=button], [role=menuitem], [role=option], a[href^="#"]'))) {
    if (out.length >= 20) break
    if (!kit.visible(control) || control.getBoundingClientRect().width === 0) continue
    const name = (control.getAttribute('aria-label') || (control as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim()
    if (!words.test(name)) continue
    const described = kit.describe(control)
    out.push({ ref: described.ref, id: described.id, label: name.slice(0, 60), facts: w.__rampaActivate.facts(control) })
  }
  return out
}

async function drag(page: ProbePage['page'], from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  // A few small steps first: libraries wait for a minimum distance before a drag starts.
  await page.mouse.move(from.x + Math.sign(to.x - from.x) * 6, from.y + Math.sign(to.y - from.y) * 6, { steps: 3 })
  await page.mouse.move(to.x, to.y, { steps: 12 })
  await page.waitForTimeout(80)
  await page.mouse.up()
}

/** 2.5.7: the drag, then, on fresh pages, the single-pointer alternatives, until one does the same. */
async function tryDrag(harness: Harness, candidate: DragCandidate): Promise<DragTrial> {
  if (candidate.kind === 'map') return {}
  const args = { kind: candidate.kind, ref: candidate.ref, container: candidate.container?.ref, item: candidate.item }
  let probe = await harness.page(true)
  let page = probe.page
  if (!(await harness.locate(probe, candidate))) return { outcome: 'unmatched' }
  const aimed = await harness.aim(probe, candidate)
  if ('cover' in aimed) return { outcome: 'not-exercised', reason: `covered by <${aimed.cover.tag}> "${aimed.cover.text.slice(0, 60)}"` }
  if ('hidden' in aimed) return { outcome: 'not-exercised', reason: 'not showing on this load' }
  const plan = await page.evaluate(planDrag, args)
  if (!plan) return { outcome: 'unmatched' }
  const before = await page.evaluate(readDrag, args)
  harness.log('activate', { ref: candidate.ref, label: candidate.label, detail: `dragged from ${plan.from.x},${plan.from.y} to ${plan.to.x},${plan.to.y}` })
  await harness.window(probe, () => drag(page, plan.from, plan.to), { ms: DRAG_MS, ref: candidate.ref, label: candidate.label })
  const effect = dragChange(candidate.kind, before, await page.evaluate(readDrag, args))
  if (!effect) return { moved: false }
  const alternatives: DragAlternative[] = []
  const reproduces = async (act: () => Promise<unknown>, alternative: DragAlternative): Promise<boolean> => {
    const start = await page.evaluate(readDrag, args)
    await harness.window(probe, act, { ms: DRAG_MS, ref: alternative.ref ?? candidate.ref, label: alternative.label })
    alternative.reproduced = dragChange(candidate.kind, start, await page.evaluate(readDrag, args)) !== undefined
    alternatives.push(alternative)
    return alternative.reproduced
  }
  // The alternatives, each on a page where the drag has not happened.
  probe = await harness.page(true)
  page = probe.page
  if (!(await harness.locate(probe, candidate))) return { moved: true, effect, alternatives, outcome: 'unmatched' }
  const fresh = await page.evaluate(planDrag, args)
  if (candidate.kind === 'slider' && fresh?.track) {
    const track = fresh.track
    harness.log('activate', { ref: candidate.ref, label: candidate.label, detail: `clicked the track at ${track.x},${track.y}` })
    if (await reproduces(() => page.mouse.click(track.x, track.y), { kind: 'track', label: 'a click on the track' })) return { moved: true, effect, alternatives }
  }
  const listed = await page.evaluate(findAlternatives, { ...args, move: MOVE_WORDS.source, more: MORE_WORDS.source })
  for (const { facts, id, control, ...alternative } of listed) {
    // A page an alternative changed (or a click that did something else) is loaded again before the next.
    probe = await harness.page(false)
    page = probe.page
    const skip = skipReason(facts, harness.origin)
    if (skip) {
      alternatives.push({ ...alternative, skipped: skip.detail ? `${skip.reason}: ${skip.detail}` : skip.reason })
      harness.skip({ ref: alternative.ref ?? '', label: alternative.label }, skip.reason, skip.detail)
      continue
    }
    const target = { ref: alternative.ref ?? '', id, label: alternative.label }
    if (!(await harness.locate(probe, target))) continue
    const at = await harness.aim(probe, target)
    if (!('x' in at)) {
      alternatives.push({ ...alternative, skipped: 'cover' in at ? `covered by <${at.cover.tag}>` : 'not showing' })
      continue
    }
    harness.log('activate', { ref: target.ref, label: target.label, detail: control === 'input' ? 'typed a value' : control === 'select' ? 'chose another option' : 'clicked' })
    let done: boolean
    if (control === 'input') {
      const value = before?.value && Number.isFinite(Number(before.value)) ? String(Number(before.value) + 1) : '1'
      done = await reproduces(async () => {
        await page.evaluate(focusTarget)
        await page.keyboard.press('ControlOrMeta+A')
        await page.keyboard.type(value)
        await page.evaluate(blurTarget)
      }, alternative)
    } else if (control === 'select') {
      done = await reproduces(async () => {
        const index = await page.evaluate(() => {
          const select = (window as unknown as PointerWindow).__rampaTarget as HTMLSelectElement | null
          return select ? (select.selectedIndex + 1) % Math.max(1, select.options.length) : 0
        })
        await page.evaluate(chooseOption, { i: index })
      }, alternative)
    } else done = await reproduces(() => page.mouse.click(at.x, at.y), alternative)
    if (done) return { moved: true, effect, alternatives }
  }
  // Two clicks: the item, then a control that moves it in what the click showed (a menu, a "Move" panel).
  if (candidate.kind === 'sortable' || candidate.kind === 'draggable' || candidate.kind === 'other') {
    probe = await harness.page(true)
    page = probe.page
    // The candidate passed the skip list before it was dragged; what its click shows is checked again below.
    if (await harness.locate(probe, candidate)) {
      const before2 = new Set((await page.evaluate(shownMoveControls, { move: MOVE_WORDS.source })).map((c) => c.ref))
      const at = await harness.aim(probe, candidate)
      if ('x' in at) {
        harness.log('activate', { ref: candidate.ref, label: candidate.label, detail: 'clicked the item' })
        await harness.window(probe, () => page.mouse.click(at.x, at.y), { ms: DRAG_MS, ref: candidate.ref, label: candidate.label })
        const shown = (await page.evaluate(shownMoveControls, { move: MOVE_WORDS.source })).filter((c) => !before2.has(c.ref) && !skipReason(c.facts, harness.origin))
        const next = shown[0]
        if (next && (await harness.locate(probe, { ref: next.ref, id: next.id, label: next.label }))) {
          const at2 = await harness.aim(probe, { ref: next.ref, label: next.label })
          if ('x' in at2) {
            harness.log('activate', { ref: next.ref, label: next.label, detail: 'clicked what the item showed' })
            if (await reproduces(() => page.mouse.click(at2.x, at2.y), { kind: 'menu', label: next.label, ref: next.ref })) return { moved: true, effect, alternatives }
          }
        }
      }
    }
  }
  return { moved: true, effect, alternatives }
}

/** C7 on one page: presses released away (2.5.2), drags and their alternatives (2.5.7), and what reacts to gestures (2.5.1). */
export async function runPointerProbe(browser: Browser, url: string, options: ProbeOptions): Promise<ProbeRecord> {
  const limits = POINTER_LIMITS
  const harness = new Harness(browser, url, options, { kind: 'pointer', version: POINTER_VERSION, variant: 'pointer', limits, kits: [installPointerKit] })
  let data: PointerData | undefined
  let conditions: ProbeRecord['conditions'] | undefined
  try {
    const first = await harness.page()
    conditions = first.conditions
    const viewport = first.page.viewportSize() ?? first.conditions.viewport
    const listeners = await markPointerListeners(first)
    const listed = await first.page.evaluate(findPointerTargets, { max: MAX_LISTED, move: MOVE_WORDS.source, more: MORE_WORDS.source, gestures: GESTURE_ALTERNATIVES.source })
    data = { viewport, found: listed.found, withDown: listed.withDown, presses: [], drags: [], gestures: listed.gestures, listeners, loads: 0, actions: [], end: 'complete' }
    let budget = 0
    const outOfBudget = () => budget >= limits.controls || !harness.timeLeft()
    // Drags first: they are fewer and say more; presses fill the rest of the budget.
    let dragged = 0
    for (const { facts, ...candidate } of listed.drags) {
      const entry: DragCandidate = candidate
      data.drags.push(entry)
      const skip = skipReason(facts, harness.origin)
      if (skip) {
        entry.skip = skip
        harness.skip(candidate, skip.reason, skip.detail)
        continue
      }
      if (candidate.kind === 'map') continue
      if (dragged >= MAX_DRAGS || outOfBudget() || harness.now() >= DRAG_TIME_MS) {
        if (data.end === 'complete') data.end = harness.timeLeft() ? 'budget' : 'time'
        entry.trial = { outcome: 'not-tried', reason: data.end }
        continue
      }
      dragged++
      budget++
      entry.trial = await tryDrag(harness, candidate)
    }
    let pressed = 0
    let confirmed = 0
    for (const { facts, ...candidate } of listed.presses) {
      const entry: PressCandidate = candidate
      data.presses.push(entry)
      const skip = skipReason(facts, harness.origin)
      if (skip) {
        entry.skip = skip
        harness.skip(candidate, skip.reason, skip.detail)
        continue
      }
      if (pressed >= MAX_PRESSES || outOfBudget()) {
        if (data.end === 'complete') data.end = harness.timeLeft() ? 'budget' : 'time'
        entry.trial = { outcome: 'not-tried', reason: data.end }
        continue
      }
      pressed++
      budget++
      const trial: PressTrial = await tryPress(harness, candidate, false)
      entry.trial = trial
      const outcome = pressOutcome(trial).kind
      if ((outcome === 'context' || outcome === 'state') && confirmed < MAX_CONFIRM && harness.timeLeft()) {
        confirmed++
        trial.confirm = await tryPress(harness, candidate, true)
      }
    }
  } finally {
    await harness.close()
  }
  if (!data || !conditions) throw new Error('the first page did not load')
  data.loads = harness.loads
  data.actions = harness.actions
  const reason = data.end === 'budget' ? `budget reached (${MAX_DRAGS} drags, ${MAX_PRESSES} presses, ${limits.controls} in all)` : data.end === 'time' ? `time budget reached (${limits.timeMs / 1000} s)` : undefined
  return harness.record(data, conditions, reason)
}

/** The pointer probe as a step of the probe stage; a probe that fails leaves a skipped record. */
export async function pointerProbe(browser: Browser, url: string, options: ProbeOptions): Promise<ProbeRecord[]> {
  const started = Date.now()
  try {
    return [await runPointerProbe(browser, url, options)]
  } catch (error) {
    return [skippedRecord('pointer', POINTER_VERSION, 'pointer', `probe failed: ${(error instanceof Error ? error.message : String(error)).split('\n')[0]}`, Date.now() - started)]
  }
}
