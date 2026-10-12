import type { Browser } from 'playwright-core'
import type { A11yNode, ProbeRecord } from '../snapshot/schema.ts'
import type { TreeIndex } from '../snapshot/tree.ts'
import { type ControlFacts, Harness, type HarnessAction, type SkipReason, skipReason } from './activate.ts'
import { matchNode } from './identity.ts'
import type { InPageElement, InPageIdentity, InPageRect } from './kit.ts'
import { type ProbeOptions, type ProbePage, skippedRecord } from './page.ts'

/**
 * Focus management (2.4.3), the plan's C3, on the activate-class harness (activate.ts). Two parts:
 *
 * 1. Dialogs and menus. Controls that open one (aria-haspopup, aria-controls, data-target, popovertarget, commandfor,
 *    an inline handler that names a hidden dialog; failing those, buttons named to open something when a hidden dialog
 *    is left unclaimed) are each opened on a fresh load, from the keyboard (focus, then Enter, Space, or ArrowDown for
 *    a menu; a click only when no key opens it). The probe records where focus is once it opened; when it is not
 *    inside, how many Tab presses from there get it inside (at most 40); for a modal, whether Tab lets focus out to the
 *    page behind; then Esc and where focus lands once it closed, with how many Tab stops lie between that place and
 *    the trigger. Only when Esc leaves it open, Enter on a button inside whose whole name says close, dismiss or cancel
 *    and that the skip list lets through; never "OK", "Done" or "Confirm". A failure that rests on an absence is tried
 *    again on a second load.
 * 2. The sequence. A Tab walk from the top records each stop with its box, its tabindex and the groups it sits in
 *    (landmarks, forms, fieldsets, sections, lists, tables, dialogs). Rules never fail an order from geometry
 *    (wcag-coverage.md, section 6): positive tabindex values and groups whose stops Tab visits going back up and left
 *    are candidates for the 2.4.3 judgment (criteria/focus-order.ts), whose cited transitions a verifier recomputes.
 */

export const FOCUS_ORDER_VERSION = '1'
export const FOCUS_ORDER_LIMITS = { controls: 12, timeMs: 150_000 }
const MAX_LISTED = 40
const MAX_GUESSES = 4
const MAX_CONFIRM = 6
/** Tab presses from where focus was to get inside what opened, at most. */
export const ENTER_CAP = 40
const SEQUENCE_BUDGET = 120
const OPEN_MS = 600
const IDLE_MS = 200

export type PopupKind = 'dialog' | 'menu' | 'disclosure'
export type PopupHow = 'aria-controls' | 'aria-haspopup' | 'data-target' | 'href' | 'popovertarget' | 'commandfor' | 'onclick' | 'guess'

export interface FocusPlace {
  /** inside what opened; on the trigger (or inside it); on the document (nothing focused); elsewhere. */
  where: 'inside' | 'trigger' | 'body' | 'elsewhere'
  el?: InPageElement | undefined
}

export interface OpenedPopup extends InPageElement {
  name: string
  /** A modal dialog: `dialog:modal` or aria-modal="true". */
  modal: boolean
  /** Elements inside it that Tab can reach. */
  focusables: number
}

export interface PopupTrial {
  openedWith?: 'Enter' | 'Space' | 'ArrowDown' | 'click' | undefined
  container?: OpenedPopup | undefined
  outcome?: 'not-opened' | 'not-exercised' | 'unmatched' | 'not-tried' | undefined
  reason?: string | undefined
  cover?: (InPageElement & { text: string }) | undefined
  /** Where focus was once it opened. */
  onOpen?: FocusPlace | undefined
  /** When focus was not inside: Tab presses from there until it was (null: never, within `cap`), and the first stops on the way. */
  enter?: { tabs: number | null; cap: number; via: InPageElement[]; left?: boolean | undefined } | undefined
  /** A modal, from inside: Tab pressed its focusables plus two times; where focus went when it left for the page behind. */
  hold?: { tabs: number; escaped?: FocusPlace | undefined } | undefined
  close?: { with: 'Escape' | 'close button' | 'none'; closed: boolean; button?: InPageElement | undefined } | undefined
  /** Where focus landed once it closed, and how many Tab stops lie between there and the trigger. */
  onClose?: (FocusPlace & { distance?: number | undefined; triggerShown: boolean }) | undefined
  confirm?: Omit<PopupTrial, 'confirm'> | undefined
}

export interface PopupTrigger extends InPageElement {
  popup: PopupKind
  how: PopupHow
  /** What it opens, when the page says so before it opens. */
  target?: InPageElement | undefined
  skip?: { reason: SkipReason; detail?: string | undefined } | undefined
  trial?: PopupTrial | undefined
}

export interface SeqGroup {
  key: string
  id: InPageIdentity
  tag: string
  role: string
  name: string
}

export interface SeqStop {
  n: number
  ref: string
  id: InPageIdentity
  tag: string
  role: string
  label: string
  tabindex?: number | undefined
  rect: InPageRect
  /** Keys of the groups it sits in, outermost first. */
  groups: string[]
}

export interface Sequence {
  stops: SeqStop[]
  groups: SeqGroup[]
  end: 'cycled' | 'budget' | 'time' | 'repeat'
  /** The document's direction: right-to-left pages read the other way. */
  rtl: boolean
}

export interface FocusOrderData {
  viewport: { width: number; height: number }
  found: number
  triggers: PopupTrigger[]
  tried: number
  /** Hidden dialogs on the page that no control is tied to. */
  unclaimed: number
  sequence?: Sequence | undefined
  loads: number
  actions: HarnessAction[]
  /** error: fresh pages failed to load three times in a row (the network dropped), and the probe stopped there. */
  end: 'complete' | 'budget' | 'time' | 'error'
}

interface PopupWindow {
  __rampaPopup?: { trigger: Element; container: Element | null; before: Element[]; near: Element[] }
  __rampaSelf?: boolean
  __rampaTarget?: Element | null
  __rampaKit: {
    describe(el: Element): InPageElement
    visible(el: Element): boolean
    deepActive(): Element | null
    cssPath(el: Element): string
    resolve(ref: string): Element | null
    identity(el: Element): { tag: string; sig: string }
    rect(el: Element): InPageRect
  }
  __rampaActivate: { facts(el: Element): ControlFacts }
}

/** Runs in the page; needs the kit and the activate kit. The controls that open a dialog, a menu or a disclosure. */
export function findPopupTriggers(args: { max: number; guesses: number }): { found: number; unclaimed: number; triggers: Array<PopupTrigger & { facts: ControlFacts }> } {
  const w = window as unknown as PopupWindow
  const kit = w.__rampaKit
  const DIALOG = 'dialog,[role=dialog],[role=alertdialog],[aria-modal=true]'
  const FOCUSABLE = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[tabindex]:not([tabindex="-1"]),[contenteditable]:not([contenteditable=false])'
  const showing = (el: Element) => {
    const r = el.getBoundingClientRect()
    return r.width >= 1 && r.height >= 1 && kit.visible(el)
  }
  const closed = (el: Element) => (el instanceof HTMLDialogElement ? !el.open : !showing(el))
  const byId = (id: string | null | undefined): Element | null => {
    const value = (id ?? '').trim().replace(/^#/, '')
    if (!value) return null
    try {
      return document.getElementById(decodeURIComponent(value))
    } catch {
      return document.getElementById(value)
    }
  }
  const targetOf = (el: Element): { target: Element; how: PopupHow } | undefined => {
    for (const id of (el.getAttribute('aria-controls') ?? '').split(/\s+/).filter(Boolean)) {
      const target = byId(id)
      if (target) return { target, how: 'aria-controls' }
    }
    for (const name of ['data-target', 'data-bs-target', 'data-toggle-target', 'data-modal', 'data-dialog']) {
      const value = el.getAttribute(name)
      if (value && /^#[\w-]+$/.test(value.trim())) {
        const target = byId(value)
        if (target) return { target, how: 'data-target' }
      }
    }
    const popover = byId(el.getAttribute('popovertarget'))
    if (popover) return { target: popover, how: 'popovertarget' }
    const command = byId(el.getAttribute('commandfor'))
    if (command) return { target: command, how: 'commandfor' }
    const href = el.getAttribute('href') ?? ''
    if (/^#[\w-]+$/.test(href)) {
      const target = byId(href)
      if (target?.matches(DIALOG) || target?.matches('.modal')) return { target, how: 'href' }
    }
    return undefined
  }
  const hiddenDialogs = Array.from(document.querySelectorAll(DIALOG)).filter((el) => closed(el))
  const claimed = new Set<Element>()
  const triggers: Array<PopupTrigger & { facts: ControlFacts }> = []
  const chosen = new Set<Element>()
  let found = 0
  const add = (el: Element, popup: PopupKind, how: PopupHow, target: Element | null) => {
    found++
    if (target) claimed.add(target)
    if (triggers.length >= args.max || chosen.has(el)) return
    chosen.add(el)
    triggers.push({ ...kit.describe(el), popup, how, ...(target ? { target: kit.describe(target) } : {}), facts: w.__rampaActivate.facts(el) })
  }
  const CONTROLS = 'button,[role=button],a[href],input[type=button],[aria-haspopup],[aria-expanded],[popovertarget],[commandfor]'
  for (const el of Array.from(document.querySelectorAll(CONTROLS))) {
    if (!showing(el) || el.closest(DIALOG)) continue
    const haspopup = (el.getAttribute('aria-haspopup') ?? '').toLowerCase()
    if (['listbox', 'tree', 'grid'].includes(haspopup)) continue
    const role = (el.getAttribute('role') ?? '').toLowerCase()
    if (role === 'combobox' || role === 'menuitem' || el.closest('[role=menu],[role=menubar]')) continue
    const tied = targetOf(el)
    const target = tied?.target ?? null
    if (target && !closed(target)) continue
    if (target?.matches(DIALOG) || target?.matches('.modal') || haspopup === 'dialog') add(el, 'dialog', tied?.how ?? 'aria-haspopup', target)
    else if (haspopup === 'true' || haspopup === 'menu' || target?.matches('[role=menu],[role=menubar]')) add(el, 'menu', tied?.how ?? 'aria-haspopup', target)
    else if (target && el.hasAttribute('aria-expanded') && target.querySelector(FOCUSABLE)) add(el, 'disclosure', tied?.how ?? 'aria-controls', target)
    else {
      // An inline handler that names a hidden dialog: onclick="openDialog('dialog1', this)".
      const handler = el.getAttribute('onclick') ?? ''
      const named = handler ? hiddenDialogs.find((dialog) => dialog.id && handler.includes(dialog.id)) : undefined
      if (named) add(el, 'dialog', 'onclick', named)
    }
  }
  // Hidden dialogs no control is tied to: buttons named to open something may open them; a trial will tell.
  const unclaimed = hiddenDialogs.filter((dialog) => !claimed.has(dialog)).length
  if (unclaimed > 0) {
    const OPENS = /\b(open|show|add|edit|view|details?|more|settings|options|filters?|menu|sign in|log in|login|abrir|ver|mostrar|adicionar|editar|detalhes|mais|configura\w*|op[çc][õo]es|filtr\w*|entrar|añadir|detalles|más|ajustes|opciones|iniciar sesi[óo]n)\b/i
    let guesses = 0
    for (const el of Array.from(document.querySelectorAll('button,[role=button],input[type=button]'))) {
      if (guesses >= args.guesses) break
      if (chosen.has(el) || !showing(el) || el.closest(DIALOG) || el.closest('form')) continue
      if (!OPENS.test(kit.describe(el).label)) continue
      guesses++
      add(el, 'dialog', 'guess', null)
    }
  }
  return { found, unclaimed, triggers }
}

/** Runs in the page: remembers the located trigger and what it opens (its ref, when known), for the reads below. */
export function holdPopup(args: { target?: string | undefined }): boolean {
  const w = window as unknown as PopupWindow
  const trigger = w.__rampaTarget
  if (!trigger) return false
  const container = args.target ? w.__rampaKit.resolve(args.target) : null
  // Dialogs that already show (a cookie banner) are not what the trigger opens.
  const DIALOG = 'dialog,[role=dialog],[role=alertdialog],[aria-modal=true]'
  const before = Array.from(document.querySelectorAll(DIALOG)).filter((el) => {
    if (el instanceof HTMLDialogElement && !el.open) return false
    const r = el.getBoundingClientRect()
    return r.width >= 1 && r.height >= 1 && w.__rampaKit.visible(el)
  })
  // A menu a script shows next to its trigger with nothing that names it (a dropdown's list): hidden lists beside it.
  const near: Element[] = []
  const parent = trigger.parentElement
  if (parent && parent !== document.body) {
    for (const el of Array.from(parent.querySelectorAll('ul,ol,[role=menu],[role=listbox],.dropdown-menu'))) {
      if (near.length >= 20) break
      if (el.contains(trigger) || trigger.contains(el)) continue
      const r = el.getBoundingClientRect()
      if (r.width < 1 || r.height < 1 || !w.__rampaKit.visible(el)) near.push(el)
    }
  }
  w.__rampaPopup = { trigger, container, before, near }
  return true
}

/** Runs in the page: gives the located trigger focus, as Tab would. */
export function focusTrigger(): boolean {
  const w = window as unknown as PopupWindow
  const el = w.__rampaPopup?.trigger as HTMLElement | undefined
  if (!el?.focus) return false
  w.__rampaSelf = true
  try {
    el.focus({ preventScroll: true })
  } finally {
    w.__rampaSelf = false
  }
  return w.__rampaKit.deepActive() === el
}

/**
 * Runs in the page: what the trigger opened, if anything: the element it names, now showing; else a layer the harness
 * saw open (by ref); else the element its aria-controls names, or a dialog, that shows now. Remembered for the reads below.
 */
export function popupOpened(args: { layer?: string | undefined }): OpenedPopup | null {
  const w = window as unknown as PopupWindow
  const kit = w.__rampaKit
  const popup = w.__rampaPopup
  if (!popup) return null
  const DIALOG = 'dialog,[role=dialog],[role=alertdialog],[aria-modal=true]'
  const FOCUSABLE = 'a[href],area[href],button,input:not([type=hidden]),select,textarea,summary,[tabindex]:not([tabindex="-1"]),[contenteditable]:not([contenteditable=false])'
  const showing = (el: Element) => {
    if (el instanceof HTMLDialogElement && !el.open) return false
    const r = el.getBoundingClientRect()
    return r.width >= 1 && r.height >= 1 && kit.visible(el)
  }
  let container: Element | null = popup.container && showing(popup.container) ? popup.container : null
  if (!container && args.layer) {
    const layer = kit.resolve(args.layer)
    if (layer && showing(layer)) container = layer
  }
  if (!container) {
    for (const id of (popup.trigger.getAttribute('aria-controls') ?? '').split(/\s+/).filter(Boolean)) {
      const el = document.getElementById(id)
      if (el && showing(el)) container = el
    }
  }
  if (!container) container = Array.from(document.querySelectorAll(DIALOG)).find((el) => showing(el) && !el.contains(popup.trigger) && !popup.before.includes(el)) ?? null
  if (!container && popup.trigger.hasAttribute('aria-haspopup')) container = popup.near.find((el) => showing(el) && el.querySelector('a[href],button,[role=menuitem]')) ?? null
  if (!container) return null
  popup.container = container
  const collapse = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim()
  const labelled = collapse(
    (container.getAttribute('aria-labelledby') ?? '')
      .split(/\s+/)
      .filter(Boolean)
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' '),
  )
  const heading = collapse(container.querySelector('h1,h2,h3,h4,h5,h6,[role=heading]')?.textContent)
  const name = (collapse(container.getAttribute('aria-label')) || labelled || heading || kit.describe(container).label).slice(0, 120)
  const focusables = Array.from(container.querySelectorAll(FOCUSABLE)).filter((el) => showing(el) && !(el as HTMLButtonElement).disabled).length
  let modal = container.getAttribute('aria-modal') === 'true'
  try {
    modal = modal || container.matches('dialog:modal')
  } catch {
    // An engine without :modal.
  }
  return { ...kit.describe(container), name, modal, focusables }
}

/** Runs in the page: where focus is, against the trigger and what it opened. */
export function focusPlace(): FocusPlace {
  const w = window as unknown as PopupWindow
  const kit = w.__rampaKit
  const active = kit.deepActive()
  if (!active) return { where: 'body' }
  const popup = w.__rampaPopup
  const el = kit.describe(active)
  if (popup?.container?.contains(active)) return { where: 'inside', el }
  if (popup && (popup.trigger === active || popup.trigger.contains(active))) return { where: 'trigger', el }
  return { where: 'elsewhere', el }
}

/** Runs in the page: what opened still shows, and the trigger's aria-expanded is not false. */
export function popupStillOpen(): boolean {
  const w = window as unknown as PopupWindow
  const popup = w.__rampaPopup
  const container = popup?.container
  if (!popup || !container?.isConnected) return false
  if (container instanceof HTMLDialogElement && !container.open) return false
  const r = container.getBoundingClientRect()
  if (r.width < 1 || r.height < 1 || !w.__rampaKit.visible(container)) return false
  return popup.trigger.getAttribute('aria-expanded') !== 'false'
}

/** Runs in the page: focus the first element inside what opened that takes focus, as a person who tabbed there would be. */
export function focusInside(): boolean {
  const w = window as unknown as PopupWindow
  const container = w.__rampaPopup?.container
  if (!container) return false
  if (container.contains(w.__rampaKit.deepActive())) return true
  const FOCUSABLE = 'a[href],area[href],button,input:not([type=hidden]),select,textarea,summary,[tabindex]:not([tabindex="-1"]),[contenteditable]:not([contenteditable=false])'
  const first = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).find((el) => w.__rampaKit.visible(el) && !(el as HTMLButtonElement).disabled)
  if (!first) return false
  w.__rampaSelf = true
  try {
    first.focus({ preventScroll: true })
  } finally {
    w.__rampaSelf = false
  }
  return container.contains(w.__rampaKit.deepActive())
}

/**
 * Runs in the page: the buttons inside what opened whose whole name says close, dismiss or cancel ("Close", "Close
 * dialog", "Fechar", "Cancelar", "×"), with their facts for the skip list. Never one that confirms or finishes ("OK",
 * "Done", "Confirm", "Continue") or that names something else after the word ("Cancel my order", "Close account"):
 * pressing such a button is an answer to the layer, not a way out of it.
 */
export function closeButtons(): Array<InPageElement & { facts: ControlFacts }> {
  const w = window as unknown as PopupWindow
  const container = w.__rampaPopup?.container
  if (!container) return []
  const CLOSE =
    /^(close|dismiss|cancel|fechar|dispensar|cancelar|cerrar)( (the|this|o|a|esta|este|el|la))?( (dialog|dialogue|modal|window|popup|pop up|menu|panel|overlay|banner|message|notice|notification|drawer|janela|dialogo|caixa|painel|mensagem|aviso|ventana|cuadro|mensaje))?$/
  const SYMBOL = /^[×✕✖✗xX]$/
  const collapse = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim()
  const plain = (value: string) =>
    value
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
  const out: Array<InPageElement & { facts: ControlFacts }> = []
  for (const el of Array.from(container.querySelectorAll<HTMLElement>('button,[role=button],input[type=button],a[href="#"]'))) {
    const name = collapse(el.getAttribute('aria-label') || el.getAttribute('title') || el.innerText || (el as HTMLInputElement).value)
    if (!(SYMBOL.test(name) || CLOSE.test(plain(name))) || !w.__rampaKit.visible(el)) continue
    out.push({ ...w.__rampaKit.describe(el), facts: w.__rampaActivate.facts(el) })
    if (out.length >= 4) break
  }
  return out
}

/** Runs in the page: focuses the button `ref` names, when it is inside what opened. */
export function focusCloseButton(args: { ref: string }): boolean {
  const w = window as unknown as PopupWindow
  const container = w.__rampaPopup?.container
  const el = w.__rampaKit.resolve(args.ref) as HTMLElement | null
  if (!container || !el || !container.contains(el)) return false
  w.__rampaSelf = true
  try {
    el.focus({ preventScroll: true })
  } finally {
    w.__rampaSelf = false
  }
  return w.__rampaKit.deepActive() === el
}

/**
 * Runs in the page: Tab stops between the trigger and where focus is, in the sequential order a browser follows
 * (positive tabindex values first, then the rest in document order), counting only elements that show. An element
 * out of that order (tabindex="-1", the document) is placed by document order. `triggerShown`: the trigger is still
 * in the order.
 */
export function stopsFromTrigger(): { distance?: number; triggerShown: boolean } {
  const w = window as unknown as PopupWindow
  const kit = w.__rampaKit
  const trigger = w.__rampaPopup?.trigger
  const FOCUSABLE = 'a[href],area[href],button,input:not([type=hidden]),select,textarea,summary,iframe,[tabindex],[contenteditable]:not([contenteditable=false])'
  const all = Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => {
    if (el.tabIndex < 0 || (el as HTMLButtonElement).disabled || el.closest('[inert]')) return false
    const r = el.getBoundingClientRect()
    return r.width >= 1 && r.height >= 1 && kit.visible(el)
  })
  const positive = all.filter((el) => el.tabIndex > 0).sort((a, b) => a.tabIndex - b.tabIndex)
  const order = [...positive, ...all.filter((el) => el.tabIndex === 0)]
  const place = (el: Element): number => {
    const at = order.indexOf(el as HTMLElement)
    if (at >= 0) return at
    // Out of the order: where it falls in document order.
    let i = order.findIndex((other) => Boolean(el.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING))
    if (i < 0) i = order.length
    return i - 0.5
  }
  const triggerShown = Boolean(trigger?.isConnected && order.includes(trigger as HTMLElement))
  const active = kit.deepActive()
  if (!trigger?.isConnected || !active) return { triggerShown }
  return { distance: Math.max(0, Math.ceil(Math.abs(place(active) - place(trigger))) - 1), triggerShown }
}

/** Runs in the page: who has focus, with its box, tabindex and groups, for the sequence. */
export function sequenceStop(): (Omit<SeqStop, 'n'> & { groupInfo: SeqGroup[] }) | 'frame' | null {
  const w = window as unknown as PopupWindow
  const kit = w.__rampaKit
  const active = kit.deepActive()
  if (!active) return null
  // Inside a frame, Tab moves through the frame's own document; the walk goes on past it.
  if (active.localName === 'iframe' || active.localName === 'frame') return 'frame'
  const GROUPS =
    'header,nav,main,aside,footer,form,fieldset,section[aria-label],section[aria-labelledby],table,ul,ol,dialog,[role=banner],[role=navigation],[role=main],[role=complementary],[role=contentinfo],[role=search],[role=form],[role=region],[role=group],[role=toolbar],[role=radiogroup],[role=tablist],[role=menu],[role=menubar],[role=listbox],[role=grid],[role=tree],[role=dialog],[role=alertdialog]'
  const collapse = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim()
  const nameOf = (el: Element): string => {
    const labelled = collapse(
      (el.getAttribute('aria-labelledby') ?? '')
        .split(/\s+/)
        .filter(Boolean)
        .map((id) => document.getElementById(id)?.textContent ?? '')
        .join(' '),
    )
    const own = el.localName === 'fieldset' ? collapse(el.querySelector('legend')?.textContent) : el.localName === 'table' ? collapse(el.querySelector('caption')?.textContent) : ''
    const heading = collapse(el.querySelector('h1,h2,h3,h4,h5,h6')?.textContent)
    return (collapse(el.getAttribute('aria-label')) || labelled || own || heading).slice(0, 80)
  }
  const groups: SeqGroup[] = []
  for (let a = active.parentElement; a && a !== document.body; a = a.parentElement) {
    if (!a.matches(GROUPS)) continue
    const d = kit.describe(a)
    groups.unshift({ key: d.ref, id: d.id, tag: d.tag, role: d.role, name: nameOf(a) })
  }
  const d = kit.describe(active)
  const tabindex = active.getAttribute('tabindex')
  return {
    ref: d.ref,
    id: d.id,
    tag: d.tag,
    role: d.role,
    label: d.label,
    ...(tabindex !== null && /^-?\d+$/.test(tabindex.trim()) ? { tabindex: Number.parseInt(tabindex, 10) } : {}),
    rect: kit.rect(active),
    groups: groups.map((g) => g.key),
    groupInfo: groups,
  }
}

// What the facts say, recomputed by the rule and the judgment.

/** Tab presses from the trigger into what opened, at most this many, count as next to it (SCR37: inserted after the trigger). */
export const ADJACENT_TABS = 3
/** Tab stops between the trigger and where focus lands once closed, beyond which it is far from it. */
export const FAR_STOPS = 3

export type FocusProblem = 'never-takes' | 'not-adjacent' | 'does-not-hold' | 'lost' | 'far' | 'trigger-gone'

export interface FocusVerdict {
  trigger: PopupTrigger
  node: A11yNode
  problem: FocusProblem
  status: 'failure' | 'review'
  confirmed: boolean
}

/** The problems one trial shows. */
export function trialProblems(trial: Omit<PopupTrial, 'confirm'> | undefined): FocusProblem[] {
  if (!trial || trial.outcome || !trial.container || !trial.onOpen) return []
  const problems: FocusProblem[] = []
  if (trial.onOpen.where !== 'inside') {
    const tabs = trial.enter?.tabs
    if (tabs === null || tabs === undefined) problems.push('never-takes')
    else if (tabs > ADJACENT_TABS) problems.push('not-adjacent')
  }
  if (trial.container.modal && trial.hold?.escaped) problems.push('does-not-hold')
  if (trial.close?.closed && trial.onClose) {
    if (trial.onClose.where === 'body') problems.push('lost')
    else if (trial.onClose.where === 'elsewhere') {
      if (!trial.onClose.triggerShown) problems.push('trigger-gone')
      else if ((trial.onClose.distance ?? 0) > FAR_STOPS) problems.push('far')
    }
  }
  return problems
}

export interface FocusVerdicts {
  verdicts: FocusVerdict[]
  /** Triggers that opened something, whose facts match the snapshot. */
  applicable: number
  unmatched: number
  notOpened: number
}

/**
 * 2.4.3's reading of the focus-order probe's dialogs and menus. A problem that rests on an absence (focus never got
 * in, focus lost to the document) is a failure only when a second load showed it too; the others are measured as
 * they happened. Focus elsewhere once the trigger is gone is for a person.
 */
export function focusVerdicts(data: Partial<FocusOrderData>, index: TreeIndex): FocusVerdicts {
  const out: FocusVerdicts = { verdicts: [], applicable: 0, unmatched: 0, notOpened: 0 }
  for (const trigger of Array.isArray(data.triggers) ? data.triggers : []) {
    const trial = trigger?.trial
    if (!trial) continue
    if (trial.outcome === 'not-opened') {
      out.notOpened++
      continue
    }
    if (trial.outcome || !trial.container) continue
    const node = matchNode(index, trigger.ref, trigger.id)
    if (!node) {
      out.unmatched++
      continue
    }
    out.applicable++
    const again = new Set(trialProblems(trial.confirm))
    for (const problem of trialProblems(trial)) {
      const absence = problem === 'never-takes' || problem === 'lost'
      const confirmed = again.has(problem)
      const status = problem === 'trigger-gone' ? 'review' : absence && !confirmed ? 'review' : 'failure'
      out.verdicts.push({ trigger, node, problem, status, confirmed })
    }
  }
  return out
}

/** A transition of the sequence that a candidate is about: from stop `from` to the next. */
export type Transition = [number, number]

export interface OrderCandidate {
  kind: 'tabindex' | 'interleave'
  /** interleave: the group whose stops Tab visits going back. */
  group?: SeqGroup | undefined
  /** Stops shown to the judgment, by number. */
  stops: number[]
  /** Transitions that may break the order; a judgment may cite only these. */
  suspects: Transition[]
}

/** Whether `to` comes before `from` in reading: above it and not in a column to its right, or on its row and before it. */
export function goesBack(from: InPageRect, to: InPageRect, rtl = false): boolean {
  const above = to.y + to.height <= from.y + 1
  const rightOf = rtl ? to.x + to.width <= from.x : to.x >= from.x + from.width
  if (above) return !rightOf
  const overlap = Math.min(from.y + from.height, to.y + to.height) - Math.max(from.y, to.y)
  const sameRow = overlap >= Math.min(from.height, to.height) * 0.5
  if (!sameRow) return false
  return rtl ? to.x >= from.x + from.width : to.x + to.width <= from.x
}

const MAX_CANDIDATES = 4

/**
 * Candidates for the 2.4.3 judgment, from the sequence alone. Geometry only nominates (wcag-coverage.md, section 6):
 * a positive tabindex reorders the sequence; a group (a form, a fieldset, a landmark, a list…) whose stops Tab visits
 * going back up or left at least twice may interleave parts laid out apart. Forms and fieldsets come first.
 */
export function orderCandidates(sequence: Partial<Sequence> | undefined): OrderCandidate[] {
  const stops = Array.isArray(sequence?.stops) ? sequence.stops.filter((s) => s && typeof s.n === 'number' && s.rect) : []
  const groups = new Map((Array.isArray(sequence?.groups) ? sequence.groups : []).map((g) => [g.key, g]))
  const rtl = sequence?.rtl === true
  const candidates: OrderCandidate[] = []
  const positive = stops.filter((s) => (s.tabindex ?? 0) > 0)
  if (positive.length > 0) {
    const last = Math.max(...positive.map((s) => s.n))
    const upTo = Math.min(stops.length, last + 2)
    const shown = stops.filter((s) => s.n <= Math.min(upTo, 12)).map((s) => s.n)
    const suspects: Transition[] = []
    for (const s of stops) {
      const next = stops.find((o) => o.n === s.n + 1)
      if (!next || s.n > upTo) continue
      if ((s.tabindex ?? 0) > 0 || (next.tabindex ?? 0) > 0) suspects.push([s.n, next.n])
    }
    candidates.push({ kind: 'tabindex', stops: shown, suspects })
  }
  const interleaved: OrderCandidate[] = []
  const keys = [...new Set(stops.flatMap((s) => (Array.isArray(s.groups) ? s.groups : [])))]
  for (const key of keys) {
    const inGroup = stops.filter((s) => Array.isArray(s.groups) && s.groups.includes(key))
    if (inGroup.length < 3) continue
    const suspects: Transition[] = []
    for (let i = 0; i + 1 < inGroup.length; i++) {
      const a = inGroup[i] as SeqStop
      const b = inGroup[i + 1] as SeqStop
      if (b.n !== a.n + 1) continue
      if (goesBack(a.rect, b.rect, rtl)) suspects.push([a.n, b.n])
    }
    if (suspects.length < 2) continue
    // A group whose inner group holds the same suspects says it better.
    interleaved.push({ kind: 'interleave', group: groups.get(key), stops: inGroup.slice(0, 16).map((s) => s.n), suspects })
  }
  // An outer group whose suspects an inner group holds too is said better by the inner one (the form, not main).
  const inside = (inner: string, outer: string) => stops.some((s) => Array.isArray(s.groups) && s.groups.indexOf(outer) >= 0 && s.groups.indexOf(outer) < s.groups.indexOf(inner))
  const innermost = interleaved.filter(
    (c) => !interleaved.some((o) => o !== c && o.group && c.group && inside(o.group.key, c.group.key) && c.suspects.every(([f]) => o.suspects.some(([g]) => g === f))),
  )
  const rank = (c: OrderCandidate) => (c.group && /^(form|fieldset)$/.test(c.group.tag) ? 0 : c.group?.role === 'group' || c.group?.role === 'form' ? 1 : 2)
  innermost.sort((a, b) => rank(a) - rank(b))
  return [...candidates, ...innermost].slice(0, MAX_CANDIDATES)
}

/** The focus-order probe's record, when it is one these helpers read. */
export function focusOrderRecord(records: readonly ProbeRecord[] | undefined): ProbeRecord | undefined {
  return records?.find((r) => r.kind === 'focus-order' && r.version === FOCUS_ORDER_VERSION && r.status !== 'skipped')
}

export function focusOrderData(record: ProbeRecord): Partial<FocusOrderData> {
  const data = record.data
  return (data && typeof data === 'object' && !Array.isArray(data) ? data : {}) as Partial<FocusOrderData>
}

// The probe.

async function readFocus(page: ProbePage['page']): Promise<FocusPlace> {
  return page.evaluate(focusPlace).catch((): FocusPlace => ({ where: 'body' }))
}

/** One trigger on a page of its own: open from the keyboard, where focus is, Tab into it, hold, close, where focus lands. */
async function runPopupTrial(harness: Harness, trigger: PopupTrigger, fresh: boolean): Promise<Omit<PopupTrial, 'confirm'>> {
  const probe = await harness.page(fresh)
  const page = probe.page
  const labels = { ref: trigger.ref, label: trigger.label }
  if (!(await harness.locate(probe, trigger))) return { outcome: 'unmatched' }
  const aimed = await harness.aim(probe, trigger)
  if ('cover' in aimed) return { outcome: 'not-exercised', cover: aimed.cover }
  if ('hidden' in aimed) {
    harness.log('not-exercised', { ...labels, detail: 'not showing on this load' })
    return { outcome: 'not-exercised', reason: 'not showing on this load' }
  }
  await page.evaluate(holdPopup, { target: trigger.target?.ref })
  let container: OpenedPopup | null = null
  let openedWith: PopupTrial['openedWith']
  const keys: Array<NonNullable<PopupTrial['openedWith']>> = ['Enter', 'Space', ...(trigger.popup === 'menu' ? (['ArrowDown'] as const) : [])]
  for (const key of keys) {
    if (!(await page.evaluate(focusTrigger))) break
    await page.waitForTimeout(IDLE_MS)
    harness.log('activate', { ...labels, detail: `pressed ${key}` })
    const watch = await harness.window(probe, () => page.keyboard.press(key), { ...labels, ms: OPEN_MS })
    container = await page.evaluate(popupOpened, { layer: watch.opened?.ref })
    if (container) {
      openedWith = key
      break
    }
  }
  if (!container) {
    // No key opened it (that is 2.1.1's to say): the pointer, to see what focus does once it is open.
    const again = await harness.aim(probe, trigger)
    if ('x' in again) {
      harness.log('activate', { ...labels, detail: `click at ${again.x},${again.y}` })
      const watch = await harness.window(probe, () => page.mouse.click(again.x, again.y), { ...labels, ms: OPEN_MS })
      container = await page.evaluate(popupOpened, { layer: watch.opened?.ref })
      if (container) openedWith = 'click'
    }
  }
  if (!container) return { outcome: 'not-opened' }
  const onOpen = await readFocus(page)
  let enter: PopupTrial['enter']
  if (onOpen.where !== 'inside') {
    const via: InPageElement[] = []
    let tabs: number | null = null
    let left = false
    for (let i = 1; i <= ENTER_CAP; i++) {
      await page.keyboard.press('Tab')
      const place = await readFocus(page)
      if (place.where === 'inside') {
        tabs = i
        break
      }
      if (place.where === 'body') {
        left = true
        break
      }
      if (place.el && via.length < 5) via.push(place.el)
    }
    enter = { tabs, cap: ENTER_CAP, via, ...(left ? { left: true } : {}) }
  }
  // Whether a modal holds focus is asked only where focus could get in at all.
  let hold: PopupTrial['hold']
  const reached = onOpen.where === 'inside' || (enter?.tabs ?? null) !== null
  if (container.modal && reached && (await page.evaluate(focusInside))) {
    const presses = container.focusables + 2
    let escaped: FocusPlace | undefined
    for (let i = 0; i < presses; i++) {
      await page.keyboard.press('Tab')
      const place = await readFocus(page)
      if (place.where === 'elsewhere' || place.where === 'trigger') {
        escaped = place
        break
      }
    }
    hold = { tabs: presses, ...(escaped ? { escaped } : {}) }
  }
  // Close it the way a person in it would: Esc from inside (or from the trigger, for a menu focus never entered).
  const inside = await page.evaluate(focusInside)
  if (!inside) await page.evaluate(focusTrigger)
  harness.log('activate', { ...labels, detail: 'pressed Escape' })
  await harness.window(probe, () => page.keyboard.press('Escape'), { ...labels, ms: OPEN_MS })
  let close: PopupTrial['close'] = { with: 'Escape', closed: !(await page.evaluate(popupStillOpen)) }
  if (!close.closed) {
    // Esc left it open: a button named only to close it, dismiss it or cancel, that the skip list lets through.
    let button: InPageElement | undefined
    for (const { facts, ...candidate } of await page.evaluate(closeButtons).catch(() => [])) {
      const skip = skipReason(facts, harness.origin)
      if (skip) {
        harness.skip(candidate, skip.reason, skip.detail)
        continue
      }
      if (await page.evaluate(focusCloseButton, { ref: candidate.ref }).catch(() => false)) {
        button = candidate
        break
      }
    }
    if (button) {
      harness.log('activate', { ref: button.ref, label: button.label, detail: 'pressed Enter (close button)' })
      await harness.window(probe, () => page.keyboard.press('Enter'), { ref: button.ref, label: button.label, ms: OPEN_MS })
      close = { with: 'close button', closed: !(await page.evaluate(popupStillOpen)), button }
    } else close = { with: 'none', closed: false }
  }
  let onClose: PopupTrial['onClose']
  if (close.closed) {
    const place = await readFocus(page)
    const stops = await page.evaluate(stopsFromTrigger)
    onClose = { ...place, ...(place.where === 'elsewhere' && stops.distance !== undefined ? { distance: stops.distance } : {}), triggerShown: stops.triggerShown }
  }
  return { openedWith, container, onOpen, ...(enter ? { enter } : {}), ...(hold ? { hold } : {}), close, ...(onClose ? { onClose } : {}) }
}

/** A Tab walk from the top, on the page as it loaded: each stop with its box, tabindex and groups. */
async function runSequence(probe: ProbePage, deadline: number): Promise<Sequence> {
  const page = probe.page
  await page.evaluate(() => {
    const w = window as unknown as { __rampaSelf?: boolean }
    w.__rampaSelf = true
    try {
      ;(document.activeElement as HTMLElement | null)?.blur?.()
    } finally {
      w.__rampaSelf = false
    }
    window.scrollTo({ left: 0, top: 0, behavior: 'instant' as ScrollBehavior })
  })
  const rtl = await page.evaluate(() => getComputedStyle(document.documentElement).direction === 'rtl' || document.dir === 'rtl')
  const stops: SeqStop[] = []
  const groups = new Map<string, SeqGroup>()
  const seen = new Set<string>()
  let end: Sequence['end'] = 'budget'
  for (let n = 1; n <= SEQUENCE_BUDGET; n++) {
    if (Date.now() > deadline) {
      end = 'time'
      break
    }
    await page.keyboard.press('Tab')
    const stop = await page.evaluate(sequenceStop).catch(() => null)
    if (stop === 'frame') continue
    if (!stop) {
      if (stops.length > 0) {
        end = 'cycled'
        break
      }
      continue
    }
    if (seen.has(stop.ref)) {
      end = 'repeat'
      break
    }
    seen.add(stop.ref)
    for (const group of stop.groupInfo) groups.set(group.key, group)
    const { groupInfo: _info, ...rest } = stop
    // Boxes in the page's coordinates, so stops scrolled into view between presses compare.
    const scroll = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }))
    stops.push({ n: stops.length + 1, ...rest, rect: { ...rest.rect, x: Math.round(rest.rect.x + scroll.x), y: Math.round(rest.rect.y + scroll.y) } })
  }
  return { stops, groups: [...groups.values()], end, rtl }
}

/** 2.4.3: the sequence of the page as it loaded, then each dialog, menu and disclosure opened on a fresh load. */
export async function runFocusOrderProbe(browser: Browser, url: string, options: ProbeOptions): Promise<ProbeRecord> {
  const limits = FOCUS_ORDER_LIMITS
  const harness = new Harness(browser, url, options, { kind: 'focus-order', version: FOCUS_ORDER_VERSION, variant: 'focus-management', limits })
  let data: FocusOrderData | undefined
  let conditions: ProbeRecord['conditions'] | undefined
  try {
    const first = await harness.page()
    conditions = first.conditions
    const viewport = first.page.viewportSize() ?? first.conditions.viewport
    const listed = await first.page.evaluate(findPopupTriggers, { max: MAX_LISTED, guesses: MAX_GUESSES })
    data = { viewport, found: listed.found, triggers: [], tried: 0, unclaimed: listed.unclaimed, loads: 0, actions: [], end: 'complete' }
    data.sequence = await runSequence(first, Date.now() + 30_000)
    // A fresh load that fails (the network dropped, the page timed out) leaves that trigger not exercised, not the
    // whole record; three in a row stop the probe.
    let failed = 0
    const safely = async (run: () => Promise<Omit<PopupTrial, 'confirm'>>): Promise<Omit<PopupTrial, 'confirm'>> => {
      try {
        const out = await run()
        failed = 0
        return out
      } catch (error) {
        failed++
        const reason = `the page failed to load: ${(error instanceof Error ? error.message : String(error)).split('\n')[0]?.slice(0, 160)}`
        harness.log('not-exercised', { detail: reason })
        return { outcome: 'not-exercised', reason }
      }
    }
    let confirmed = 0
    for (const { facts, ...trigger } of listed.triggers) {
      const entry: PopupTrigger = trigger
      data.triggers.push(entry)
      const skip = skipReason(facts, harness.origin)
      if (skip) {
        entry.skip = skip
        harness.skip(trigger, skip.reason, skip.detail)
        continue
      }
      if (data.tried >= limits.controls || !harness.timeLeft()) {
        if (data.end === 'complete') data.end = data.tried >= limits.controls ? 'budget' : 'time'
        entry.trial = { outcome: 'not-tried', reason: data.end }
        continue
      }
      data.tried++
      // Every trial on a fresh load: the sequence walk moved focus on the first one.
      const trial: PopupTrial = await safely(() => runPopupTrial(harness, entry, true))
      entry.trial = trial
      const problems = trialProblems(trial)
      if (problems.some((p) => p === 'never-takes' || p === 'lost') && confirmed < MAX_CONFIRM && harness.timeLeft()) {
        confirmed++
        trial.confirm = await safely(() => runPopupTrial(harness, entry, true))
      }
      if (failed >= 3) {
        data.end = 'error'
        break
      }
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
        ? `time budget reached (${limits.timeMs / 1000} s)`
        : data.end === 'error'
          ? 'fresh pages failed to load three times in a row'
          : undefined
  return harness.record(data, conditions, reason)
}

/** The focus-order probe as a step of the probe stage; a probe that fails leaves a skipped record. */
export async function focusOrderProbe(browser: Browser, url: string, options: ProbeOptions): Promise<ProbeRecord[]> {
  const started = Date.now()
  try {
    return [await runFocusOrderProbe(browser, url, options)]
  } catch (error) {
    return [skippedRecord('focus-order', FOCUS_ORDER_VERSION, 'focus-management', `probe failed: ${(error instanceof Error ? error.message : String(error)).split('\n')[0]}`, Date.now() - started)]
  }
}
