import type { Browser, CDPSession, Page } from 'playwright-core'
import { type RgbaImage, decodePng } from '../pixels/png.ts'
import type { AxFacts, ProbeRecord } from '../snapshot/schema.ts'
import { liveAxFacts } from '../surfaces/ax-tree.ts'
import { ACTIVATE_LIMITS, type ControlFacts, Harness, type HarnessAction, type SkipReason, type Watch, skipReason } from './activate.ts'
import type { InPageElement, InPageRect } from './kit.ts'
import { type ProbeOptions, type ProbePage, skippedRecord } from './page.ts'
import { imageHash } from './pixels.ts'

/**
 * State exposure (4.1.2), on the activate-class harness (activate.ts): the coverage plan's C4 toggle probe. Each
 * toggle-like control that shows (a disclosure or menu button, an accordion header, a tab, a switch or checkbox built
 * from other elements, a toggle button) is clicked, behind the guard, on a page where nothing else was clicked. Before
 * and after each click the probe captures the window and reads, over the DevTools protocol, what the browser exposes
 * for the control (its role, name, value and its expanded, selected, checked and pressed states), and for the other
 * tabs or radios of its group. A toggle is clicked twice (three times when only its own look changes) to see that it
 * goes back; a tab or radio once. When the pixels or the content change and the exposed state does not, the rule
 * (rules/state-exposure.ts) fails 4.1.2, confirmed on a second fresh load. Facts only here: the counts of changed
 * pixels, the text that came and went, the states read, the capture hashes.
 */

export const TOGGLES_VERSION = '1'
/** Controls tried per page (a group of tabs counts once), and time. */
export const TOGGLES_LIMITS = { controls: ACTIVATE_LIMITS.controls, timeMs: 150_000 }
const MAX_LISTED = 120
/** Controls built alike (same tag, role, classes and parent): only this many are tried. */
const MAX_ALIKE = 2
/** Members of a group (tabs, radios) whose states are read with the control. */
const MAX_GROUP = 12
/** Failures confirmed on a second fresh load, at most. */
const MAX_CONFIRM = 10
/** The pointer rests on the control this long before the first capture, so hover styles are in every capture. */
const HOVER_MS = 250
/** The second capture of the unchanged state, for the noise mask. */
const NOISE_MS = 150
/** Pixels around the control's box that count as the control's own (focus rings, shadows). */
export const CONTROL_MARGIN = 12
/**
 * The margin when the control's own look is compared between two clicks: both captures were taken with the pointer on it
 * and focus in it, so its ring is in both, and content shown right under it must not count as its own look.
 */
export const OWN_MARGIN = 2

/** Pixels outside the control, changed noticeably, that make a change of the page's look. */
export const OUTSIDE_MIN = 150
/** Pixels inside the control's box, changed noticeably, that make a change of its look. */
export const CONTROL_MIN = 24
/** A channel difference at which a changed pixel is noticeable. */
const NOTICEABLE = 32

export type ToggleMode = 'toggle' | 'select'
export type ToggleTier = 'declared' | 'hinted' | 'button'

/** What the browser exposes for one element, as compared before and after a click. */
export interface ExposedState {
  role: string
  name?: string | undefined
  value?: string | undefined
  description?: string | undefined
  expanded?: boolean | undefined
  selected?: boolean | undefined
  checked?: string | undefined
  pressed?: string | undefined
  ignored?: boolean | undefined
}

/** One state of the page during a trial. */
export interface ToggleState {
  /** The browser's facts for the control, then the other members of its group; null where it keeps no node. */
  ax: Array<ExposedState | null>
  /** Lines of visible text (digits masked) that came and went since before the first click, a few of each, and their characters. */
  text: { added: string[]; removed: string[]; changed: number }
  /** Whether each element its aria-controls names shows. */
  regions?: boolean[] | undefined
  /** Hash of the window's capture. */
  shot?: string | undefined
}

export interface PixelChange {
  changed: number
  noticeable: number
  bbox?: InPageRect | undefined
}

export interface ToggleTrial {
  outcome?: 'not-exercised' | 'unmatched' | 'not-tried' | undefined
  reason?: string | undefined
  cover?: (InPageElement & { text: string }) | undefined
  /** The control's box in the window, where every capture was taken. */
  box?: InPageRect | undefined
  /** Where it was clicked. */
  point?: { x: number; y: number } | undefined
  before?: ToggleState | undefined
  /** After the first click, the second, the third. */
  after?: ToggleState[] | undefined
  /** The harness's window for each click. */
  watches?: Watch[] | undefined
  /**
   * Pixels compared. outside: before against after each click, outside the control's box and its margin, with the
   * pixels that moved on their own between two captures of the state before masked. control: inside the box, after the
   * first click against after the second, and against after the third.
   */
  pixels?: { masked: number; outside: PixelChange[]; control: PixelChange[] } | undefined
  /** Why fewer clicks were made than planned: the control was covered, moved or gone. */
  stopped?: string | undefined
  /** The same trial on a second fresh load, for a failure. */
  confirm?: Omit<ToggleTrial, 'confirm'> | undefined
}

export interface ToggleCandidate extends InPageElement {
  mode: ToggleMode
  tier: ToggleTier
  /** Its explicit role and the ARIA state attributes it carries on load. */
  declared: { role?: string | undefined; states: string[] }
  /** What made it a candidate: a state attribute, a role, a class or data attribute, a word of its name. */
  why: string
  /** The other members of its group (tabs, radios), by ref: their states are read with its own. */
  group?: string[] | undefined
  /** What its aria-controls names, by ref. */
  controls?: string[] | undefined
  /** One of several controls built alike past the first MAX_ALIKE: not tried. */
  alike?: boolean | undefined
  skip?: { reason: SkipReason; detail?: string | undefined } | undefined
  trial?: ToggleTrial | undefined
}

export interface TogglesData {
  viewport: { width: number; height: number }
  /** Toggle-like controls found that show (a group of tabs once). */
  found: number
  candidates: ToggleCandidate[]
  /** Controls clicked. */
  tried: number
  loads: number
  actions: HarnessAction[]
  end: 'complete' | 'budget' | 'time'
}

/** Words of a class, id or data attribute that name a toggle (accordion, collapse, switch, tab...). */
export const TOGGLE_HINT =
  /(^|[\s_-])(toggle|toggler|switch|switcher|accordion|accordeon|acordeon|collaps\w*|expand\w*|expander|disclos\w*|dropdown|drop-down|hamburger|burger|menu-?(btn|button|toggle|trigger|icon)|nav-?toggle|navbar-toggler|faq|tab|tabs|tab-?link|checkbox|chip|segment\w*|show-?more|read-?more|see-?more|reveal|spoiler|fold|unfold|sanfona)([\s_-]|$)/i
/** Words a toggle's name starts with, in English, Portuguese and Spanish. */
export const TOGGLE_WORDS =
  /^(show|hide|more|less|expand|collapse|toggle|details|menu|filters?|options|read more|see more|view more|view all|mostrar|ocultar|esconder|exibir|ver mais|ver menos|ver todos|saiba mais|leia mais|expandir|recolher|retrair|detalhes|filtros?|opç(õ|o)es|ver más|leer más|contraer|detalles|opciones)(\b|$)/i
/** Classes of a container of tabs. */
const TAB_CONTAINER = /(^|[\s_-])(tabs|tab-?list|tab-?nav|tab-?bar|nav-tabs|nav-pills|tabset|segmented|segmented-control)([\s_-]|$)/i

/** Runs in the page; needs the kit and the activate kit. The toggle-like controls that show, a group of tabs once. */
export function findToggles(args: { max: number; hint: string; words: string; tabs: string; maxGroup: number; maxAlike: number }): {
  found: number
  candidates: Array<ToggleCandidate & { facts: ControlFacts }>
} {
  const w = window as unknown as {
    __rampaKit: { describe(el: Element): InPageElement; visible(el: Element): boolean }
    __rampaActivate: { facts(el: Element): ControlFacts }
  }
  const kit = w.__rampaKit
  const HINT = new RegExp(args.hint, 'i')
  const WORDS = new RegExp(args.words, 'i')
  const TABS = new RegExp(args.tabs, 'i')
  const collapse = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim()
  const showing = (el: Element) => {
    if (!kit.visible(el)) return false
    const r = el.getBoundingClientRect()
    return r.width >= 4 && r.height >= 4
  }
  const roleOf = (el: Element) => (el.getAttribute('role') ?? '').trim().toLowerCase().split(/\s+/)[0] ?? ''
  const classOf = (el: Element) => collapse(el.getAttribute('class'))
  const STATE = /(^|\s)(active|selected|current|is-active|is-selected|is-current|on|checked|is-checked|open|is-open|show|expanded|is-expanded)(\s|$)/i
  const STATE_ATTRS = ['aria-expanded', 'aria-pressed', 'aria-checked', 'aria-selected']
  const ROLE_MODE: Record<string, ToggleMode> = { tab: 'select', radio: 'select', menuitemradio: 'select', checkbox: 'toggle', switch: 'toggle', menuitemcheckbox: 'toggle' }
  // Roles of widgets that are not toggles this probe reads: fields, lists, grids, composite containers.
  const OTHER_ROLES = new Set(['combobox', 'textbox', 'searchbox', 'listbox', 'option', 'gridcell', 'row', 'slider', 'spinbutton', 'scrollbar', 'menu', 'menubar', 'tablist', 'tree', 'grid', 'treegrid', 'dialog', 'alertdialog', 'radiogroup', 'group', 'progressbar', 'separator'])
  const NATIVE = 'input, select, textarea, option, optgroup, summary, details, label, video, audio, iframe, object, embed'
  const FIELD = 'input:not([type=hidden]), select, textarea'
  const buttonLike = (el: Element) => {
    if (el.localName === 'button' || roleOf(el) === 'button') return true
    if (el.localName !== 'a') return false
    const href = el.getAttribute('href')
    return href === null || href.trim() === '' || href.trim().startsWith('#') || /^\s*javascript:/i.test(href)
  }
  const realLink = (el: Element) => {
    if (el.localName !== 'a' && el.localName !== 'area') return false
    const href = (el.getAttribute('href') ?? '').trim()
    return href !== '' && !href.startsWith('#') && !/^javascript:/i.test(href)
  }
  const pointer = (el: Element) => getComputedStyle(el).cursor === 'pointer'
  const toggleData = (el: Element) => (el.getAttribute('data-bs-toggle') ?? el.getAttribute('data-toggle') ?? '').trim().toLowerCase()
  const codeOf = (el: Element) =>
    [el.id, classOf(el), ...Array.from(el.attributes).filter((a) => a.name.startsWith('data-') && a.value.length <= 60).map((a) => `${a.name.slice(5)} ${a.value}`)].join(' ')
  const signature = (el: Element) => {
    const classes = (el.getAttribute('class') ?? '')
      .split(/\s+/)
      .filter((c) => c && !STATE.test(c))
      .sort()
      .join('.')
    const parent = el.parentElement
    return `${el.localName}|${roleOf(el)}|${classes}|${parent?.localName ?? ''}.${(parent?.getAttribute('class') ?? '').split(/\s+/).filter((c) => c && !STATE.test(c)).sort().join('.')}`
  }
  const isCurrent = (el: Element) =>
    el.getAttribute('aria-selected') === 'true' ||
    el.getAttribute('aria-checked') === 'true' ||
    (el.getAttribute('aria-current') ?? 'false') !== 'false' ||
    STATE.test(classOf(el)) ||
    STATE.test(classOf(el.parentElement ?? el))

  /** The group a selection control belongs to: its container and the members, in order. */
  const groupOf = (el: Element): { box: Element; members: Element[] } | undefined => {
    const role = roleOf(el)
    if (role === 'tab') {
      const box = el.closest('[role=tablist]') ?? el.parentElement
      if (!box) return undefined
      return { box, members: Array.from(box.querySelectorAll('[role=tab]')).filter((m) => (m.closest('[role=tablist]') ?? el.parentElement) === box) }
    }
    if (role === 'radio' || role === 'menuitemradio') {
      const box = el.closest('[role=radiogroup], [role=menu], [role=group]') ?? el.parentElement
      if (!box) return undefined
      return { box, members: Array.from(box.querySelectorAll(`[role=${role}]`)) }
    }
    const data = toggleData(el)
    if (data === 'tab' || data === 'pill' || data === 'list') {
      for (let a = el.parentElement, n = 0; a && n < 4; a = a.parentElement, n++) {
        const members = Array.from(a.querySelectorAll('[data-toggle=tab],[data-toggle=pill],[data-toggle=list],[data-bs-toggle=tab],[data-bs-toggle=pill],[data-bs-toggle=list]'))
        if (members.length >= 2) return { box: a, members }
      }
      return undefined
    }
    for (let a = el.parentElement, n = 0; a && n < 3; a = a.parentElement, n++) {
      if (!TABS.test(classOf(a))) continue
      const members = Array.from(a.querySelectorAll(el.localName)).filter((m) => showing(m) && !m.querySelector(el.localName))
      if (members.length >= 2 && members.length <= 20) return { box: a, members }
    }
    return undefined
  }

  const inTabs = (el: Element) => {
    for (let a = el.parentElement, n = 0; a && n < 3; a = a.parentElement, n++) if (TABS.test(classOf(a))) return true
    return false
  }
  // A link to a part of this page (a skip link, a table of contents) moves there: it is not a toggle, unless it is a tab.
  const inPageLink = (el: Element) => {
    if (el.localName !== 'a') return false
    const href = (el.getAttribute('href') ?? '').trim()
    if (!href.startsWith('#') || href === '#') return false
    let id = href.slice(1)
    try {
      id = decodeURIComponent(id)
    } catch {
      // keep it as written
    }
    return id.toLowerCase() === 'top' || document.getElementById(id) !== null || document.getElementsByName(id).length > 0
  }

  const pool = new Set<Element>()
  const selector = [
    'button',
    '[role]',
    'a',
    '[aria-expanded]',
    '[aria-pressed]',
    '[aria-checked]',
    '[aria-selected]',
    '[aria-controls]',
    '[data-toggle]',
    '[data-bs-toggle]',
    '[onclick]',
    '[class*=toggle i]',
    '[class*=switch i]',
    '[class*=accordion i]',
    '[class*=collaps i]',
    '[class*=expand i]',
    '[class*=tab i]',
    '[class*=check i]',
    '[class*=dropdown i]',
    '[class*=disclos i]',
    '[class*=burger i]',
    '[class*=faq i]',
  ].join(',')
  for (const el of Array.from(document.querySelectorAll(selector)).slice(0, 20_000)) pool.add(el)

  type Found = ToggleCandidate & { facts: ControlFacts; order: number; sig: string }
  const found: Found[] = []
  const groups = new Set<Element>()
  let order = 0
  for (const el of pool) {
    order++
    if (el.matches(NATIVE) || el.closest('label') || el.closest('[aria-hidden=true], [inert]')) continue
    const role = roleOf(el)
    if (OTHER_ROLES.has(role)) continue
    const states = STATE_ATTRS.filter((name) => el.hasAttribute(name) && !(name === 'aria-selected' && role !== 'tab'))
    const data = toggleData(el)
    if (['modal', 'tooltip', 'popover'].includes(data)) continue
    if ((el.getAttribute('aria-haspopup') ?? '') === 'dialog' && states.length === 0) continue
    const controls = (el.getAttribute('aria-controls') ?? '').split(/\s+/).filter(Boolean)
    let tier: ToggleTier | undefined
    let why = ''
    if (states.length > 0) {
      tier = 'declared'
      why = states.join(', ')
    } else if (ROLE_MODE[role]) {
      tier = 'declared'
      why = `role=${role}`
    } else if (controls.length > 0 && buttonLike(el)) {
      tier = 'declared'
      why = 'aria-controls'
    } else {
      if (realLink(el)) continue
      const generic = !buttonLike(el) && role !== 'link'
      if (generic && !pointer(el)) continue
      const label = collapse(kit.describe(el).label)
      const code = codeOf(el)
      const hinted = data !== '' ? `data-toggle=${data}` : HINT.exec(code)?.[2] ? `class or id "${HINT.exec(code)?.[2]}"` : label.length <= 40 && WORDS.test(label) && !generic ? `name "${label}"` : ''
      if (hinted) {
        tier = 'hinted'
        why = hinted
      } else if (buttonLike(el) && (!inPageLink(el) || inTabs(el))) {
        tier = 'button'
        why = el.localName === 'a' ? 'scripted link' : 'button'
      } else continue
    }
    if (role === 'link' && tier === 'button') continue
    if (!showing(el) || el.querySelector(FIELD)) continue
    // A wrapper around another candidate (a list item holding its tab link) is left to the inner one.
    if (tier !== 'declared' && el.querySelector('button, [role=button], [role=tab], [aria-expanded], [aria-pressed], a[href]')) continue
    const described = kit.describe(el)
    if (!described.label && tier !== 'declared') continue
    let mode: ToggleMode = ROLE_MODE[role] ?? (states.includes('aria-selected') ? 'select' : 'toggle')
    let member: Element = el
    let group: string[] | undefined
    const grouped = mode === 'select' || data === 'tab' || data === 'pill' || data === 'list' ? groupOf(el) : tier !== 'declared' ? groupOf(el) : undefined
    if (grouped && grouped.members.length >= 2) {
      if (groups.has(grouped.box)) continue
      groups.add(grouped.box)
      mode = 'select'
      const members = grouped.members.filter((m) => showing(m)).slice(0, args.maxGroup + 1)
      // The member to click: the first that is not the current one.
      member = members.find((m) => !isCurrent(m)) ?? members[1] ?? el
      if (!showing(member)) continue
      group = members.filter((m) => m !== member).map((m) => kit.describe(m).ref).slice(0, args.maxGroup)
      if (member !== el) why = `${why}; one of ${members.length} in a group`
    } else if (mode === 'select' && role !== 'tab') mode = 'toggle'
    const target = kit.describe(member)
    const memberStates = STATE_ATTRS.filter((name) => member.hasAttribute(name) && !(name === 'aria-selected' && roleOf(member) !== 'tab'))
    found.push({
      ...target,
      label: target.label || described.label,
      mode,
      tier,
      declared: { ...(roleOf(member) ? { role: roleOf(member) } : {}), states: member === el ? states : memberStates },
      why,
      ...(group && group.length > 0 ? { group } : {}),
      ...(controls.length > 0
        ? {
            controls: controls
              .map((id) => document.getElementById(id))
              .filter((c): c is HTMLElement => c !== null)
              .map((c) => kit.describe(c).ref)
              .slice(0, 4),
          }
        : {}),
      facts: w.__rampaActivate.facts(member),
      order,
      sig: signature(member),
    })
  }
  const rank: Record<ToggleTier, number> = { declared: 0, hinted: 1, button: 2 }
  found.sort((a, b) => rank[a.tier] - rank[b.tier] || a.order - b.order)
  const seen = new Map<string, number>()
  const candidates: Array<ToggleCandidate & { facts: ControlFacts }> = []
  for (const { order: _, sig, ...candidate } of found) {
    if (candidates.length >= args.max) break
    const count = (seen.get(sig) ?? 0) + 1
    seen.set(sig, count)
    candidates.push(count > args.maxAlike ? { ...candidate, alike: true } : candidate)
  }
  return { found: found.length, candidates }
}

interface ToggleWindow {
  __rampaKit: { resolve(ref: string): Element | null; visible(el: Element): boolean }
  __rampaTarget?: Element | null
  __rampaAxTargets?: Array<Element | null>
  __rampaToggle?: {
    targets(args: { group: string[] }): number
    box(): InPageRect | null
    save(): void
    state(args: { controls: string[] }): Omit<ToggleState, 'ax' | 'shot'>
    restore(): boolean
    hits(args: { x: number; y: number }): boolean
    blur(): void
  }
  __rampaSelf?: boolean
}

/** Installs `window.__rampaToggle` (needs the kit and the activate kit): what a trial reads in the page between clicks. */
export function installToggleKit(): void {
  const w = window as unknown as ToggleWindow
  if (w.__rampaToggle) return
  const kit = w.__rampaKit
  const lines = (): string[] =>
    (document.body?.innerText ?? '')
      .slice(0, 200_000)
      .split('\n')
      // Digits are masked: a clock or a counter that ticks is not content that came or went.
      .map((line) => line.replace(/\s+/g, ' ').replace(/\d/g, '0').trim())
      .filter(Boolean)
  let saved: { lines: string[]; x: number; y: number } | undefined
  const showing = (el: Element | null): boolean => {
    if (!el?.isConnected || !kit.visible(el)) return false
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }
  const cut = (value: string) => (value.length > 120 ? `${value.slice(0, 119)}…` : value)
  w.__rampaToggle = {
    targets(args) {
      const target = w.__rampaTarget ?? null
      w.__rampaAxTargets = [target, ...args.group.map((ref) => kit.resolve(ref)).map((el) => (el === target ? null : el))]
      return w.__rampaAxTargets.length
    },
    box() {
      const el = w.__rampaTarget
      if (!el?.isConnected) return null
      const r = el.getBoundingClientRect()
      const round = (v: number) => Math.round(v * 10) / 10
      return { x: round(r.x), y: round(r.y), width: round(r.width), height: round(r.height) }
    },
    save() {
      saved = { lines: lines(), x: window.scrollX, y: window.scrollY }
    },
    state(args) {
      const now = lines()
      const before = new Map<string, number>()
      for (const line of saved?.lines ?? []) before.set(line, (before.get(line) ?? 0) + 1)
      const added: string[] = []
      let changed = 0
      for (const line of now) {
        const left = before.get(line) ?? 0
        if (left > 0) before.set(line, left - 1)
        else {
          changed += line.length
          if (added.length < 4) added.push(cut(line))
        }
      }
      const removed: string[] = []
      for (const [line, left] of before) {
        if (left <= 0) continue
        changed += line.length * left
        if (removed.length < 4) removed.push(cut(line))
      }
      return { text: { added, removed, changed }, ...(args.controls.length > 0 ? { regions: args.controls.map((ref) => showing(kit.resolve(ref))) } : {}) }
    },
    restore() {
      if (!saved || (window.scrollX === saved.x && window.scrollY === saved.y)) return false
      window.scrollTo({ left: saved.x, top: saved.y, behavior: 'instant' as ScrollBehavior })
      return true
    },
    hits(args) {
      const target = w.__rampaTarget
      if (!target?.isConnected) return false
      let hit = document.elementFromPoint(args.x, args.y)
      while (hit?.shadowRoot) {
        const inner = hit.shadowRoot.elementFromPoint(args.x, args.y)
        if (!inner || inner === hit) break
        hit = inner
      }
      for (let n: Node | null = hit; n; n = n.parentNode ?? (n instanceof ShadowRoot ? n.host : null)) if (n === target) return true
      return false
    },
    // Focus left by an earlier trial on the same page would leave its ring between the captures.
    blur() {
      let active = document.activeElement
      while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement
      if (!active || active === document.body || active === document.documentElement) return
      w.__rampaSelf = true
      try {
        ;(active as HTMLElement).blur?.()
      } finally {
        w.__rampaSelf = false
      }
    },
  }
}

/** The part of the browser's facts a state change shows in. */
export function exposedState(facts: AxFacts | undefined): ExposedState | null {
  if (!facts) return null
  const props = facts.props ?? {}
  const state: ExposedState = { role: facts.role }
  if (facts.ignored) state.ignored = true
  if (facts.name) state.name = facts.name
  if (facts.value) state.value = facts.value
  if (facts.description) state.description = facts.description
  if (typeof props.expanded === 'boolean') state.expanded = props.expanded
  if (typeof props.selected === 'boolean') state.selected = props.selected
  if (typeof props.checked === 'string') state.checked = props.checked
  if (typeof props.pressed === 'string') state.pressed = props.pressed
  return state
}

const STATE_KEYS = ['expanded', 'selected', 'checked', 'pressed', 'name', 'value', 'role', 'ignored'] as const

/** The first difference between what was exposed in two states, as "expanded false → true", or undefined. */
export function exposedChange(before: ReadonlyArray<ExposedState | null> | undefined, after: ReadonlyArray<ExposedState | null> | undefined): string | undefined {
  const a = before ?? []
  const b = after ?? []
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i]
    const y = b[i]
    if (!x || !y) continue
    for (const key of STATE_KEYS) {
      const from = x[key]
      const to = y[key]
      if (from === to) continue
      const say = (v: unknown) => (v === undefined ? 'none' : typeof v === 'string' && key !== 'checked' && key !== 'pressed' ? `"${v}"` : String(v))
      return `${i > 0 ? 'another in its group: ' : ''}${key} ${say(from)} → ${say(to)}`
    }
  }
  return undefined
}

/** Pixels that differ between two captures, inside or outside a box (with a margin), the noise mask left out. */
export function regionChange(a: RgbaImage, b: RgbaImage, noise: RgbaImage | undefined, box: InPageRect, inside: boolean, margin = CONTROL_MARGIN): PixelChange & { masked: number } {
  const width = Math.min(a.width, b.width)
  const height = Math.min(a.height, b.height)
  const left = Math.floor(box.x - margin)
  const top = Math.floor(box.y - margin)
  const right = Math.ceil(box.x + box.width + margin)
  const bottom = Math.ceil(box.y + box.height + margin)
  const out: PixelChange & { masked: number } = { changed: 0, noticeable: 0, masked: 0 }
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = -1
  let maxY = -1
  const at = (image: RgbaImage, x: number, y: number) => (y * image.width + x) * 4
  for (let y = 0; y < height; y++) {
    const rowIn = y >= top && y < bottom
    for (let x = 0; x < width; x++) {
      const within = rowIn && x >= left && x < right
      if (within !== inside) continue
      const ib = at(b, x, y)
      if (noise && x < noise.width && y < noise.height) {
        const n = at(noise, x, y)
        if (noise.data[n] !== b.data[ib] || noise.data[n + 1] !== b.data[ib + 1] || noise.data[n + 2] !== b.data[ib + 2]) {
          out.masked++
          continue
        }
      }
      const ia = at(a, x, y)
      const dr = Math.abs((a.data[ia] ?? 0) - (b.data[ib] ?? 0))
      const dg = Math.abs((a.data[ia + 1] ?? 0) - (b.data[ib + 1] ?? 0))
      const db = Math.abs((a.data[ia + 2] ?? 0) - (b.data[ib + 2] ?? 0))
      if (dr === 0 && dg === 0 && db === 0) continue
      out.changed++
      if (Math.max(dr, dg, db) < NOTICEABLE) continue
      out.noticeable++
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  }
  if (out.noticeable > 0) out.bbox = { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
  return out
}

// What a trial shows, as the 4.1.2 rule reads it (rules/state-exposure.ts).

export type ToggleSignal = 'text' | 'layer' | 'region' | 'pixels' | 'control'

export interface ToggleReading {
  /** What changed to the eye with the first click (or, for the control's own look, between the second and the first). */
  signals: ToggleSignal[]
  /**
   * two-state: the change went back with the second click (or the control's look flipped and flipped back); selected:
   * a tab or radio was chosen and the content changed; declared: a control that declares a state showed content and
   * could not be clicked back; one-way: a change that did not go back (an action, not a toggle); none: nothing showed.
   */
  kind: 'two-state' | 'selected' | 'declared' | 'one-way' | 'none'
  /** The first change in what the browser exposes, with the first click, then with the second. */
  exposed: [string | undefined, string | undefined]
  /** fail: a change on screen and none exposed (or the exposed state did not come back with the content); pass; n/a. */
  verdict: 'fail' | 'pass' | 'n/a'
  /** stale: the state is exposed, but never changes; stuck: it changed once and did not change back; missing: none exposed. */
  why?: 'stale' | 'stuck' | 'missing' | undefined
}

const sameRegions = (a: boolean[] | undefined, b: boolean[] | undefined) => JSON.stringify(a ?? []) === JSON.stringify(b ?? [])

/** Whether a control declares, on load, the kind of state a toggle has. */
export function declaresState(candidate: Pick<ToggleCandidate, 'declared'>): boolean {
  return candidate.declared.states.length > 0 || ['tab', 'checkbox', 'switch', 'radio', 'menuitemcheckbox', 'menuitemradio'].includes(candidate.declared.role ?? '')
}

/** Reads one trial: what changed on screen, what the browser exposed, and whether the two agree. */
export function readTrial(candidate: Pick<ToggleCandidate, 'mode' | 'declared'>, trial: Omit<ToggleTrial, 'confirm'>): ToggleReading {
  const before = trial.before
  const [first, second] = trial.after ?? []
  const [w1] = trial.watches ?? []
  const outside = trial.pixels?.outside ?? []
  const control = trial.pixels?.control ?? []
  const none: ToggleReading = { signals: [], kind: 'none', exposed: [undefined, undefined], verdict: 'n/a' }
  if (!before || !first || !w1) return none
  const signals: ToggleSignal[] = []
  if (first.text.changed > 0 && w1.dom > 0) signals.push('text')
  if (w1.opened || w1.modals > 0) signals.push('layer')
  if (!sameRegions(before.regions, first.regions)) signals.push('region')
  if ((outside[0]?.noticeable ?? 0) >= OUTSIDE_MIN) signals.push('pixels')
  const ownFlip = (control[0]?.noticeable ?? 0) >= CONTROL_MIN
  const ownBack = control[1] !== undefined && control[1].noticeable < CONTROL_MIN
  if (ownFlip) signals.push('control')
  const exposed: ToggleReading['exposed'] = [exposedChange(before.ax, first.ax), second ? exposedChange(first.ax, second.ax) : undefined]
  const shown = signals.some((s) => s !== 'control')
  const strong = signals.some((s) => s === 'text' || s === 'layer' || s === 'region')
  if (candidate.mode === 'select') {
    if (!shown) return { ...none, signals, exposed }
    return exposed[0] ? { signals, kind: 'selected', exposed, verdict: 'pass' } : { signals, kind: 'selected', exposed, verdict: 'fail', why: declaresState(candidate) ? 'stale' : 'missing' }
  }
  // Back as it was after the second click: no text left changed, the controlled regions as before, the pixels outside close to before.
  const back =
    second !== undefined &&
    second.text.changed === 0 &&
    sameRegions(before.regions, second.regions) &&
    (outside[1] === undefined || outside[1].noticeable < Math.max(OUTSIDE_MIN, 0.2 * (outside[0]?.noticeable ?? 0)))
  const contentToggle = shown && back
  const ownToggle = ownFlip && ownBack
  const declared = declaresState(candidate)
  if (contentToggle || ownToggle) {
    if (!exposed[0] && !exposed[1]) return { signals, kind: 'two-state', exposed, verdict: 'fail', why: declared ? 'stale' : 'missing' }
    // The state changed with the content, and did not change back when the content went: it no longer says what shows.
    if (contentToggle && exposed[0] && !exposed[1]) return { signals, kind: 'two-state', exposed, verdict: 'fail', why: 'stuck' }
    return { signals, kind: 'two-state', exposed, verdict: 'pass' }
  }
  // A control that declares a state (aria-expanded) and showed content, though it could not be clicked back.
  if (declared && strong && !back) return exposed[0] ? { signals, kind: 'declared', exposed, verdict: 'pass' } : { signals, kind: 'declared', exposed, verdict: 'fail', why: 'stale' }
  if (shown) return { signals, kind: 'one-way', exposed, verdict: 'n/a' }
  return { ...none, signals, exposed }
}

/** A failure worth measuring again on a second fresh load. */
function worthConfirming(candidate: ToggleCandidate, trial: Omit<ToggleTrial, 'confirm'>): boolean {
  return !trial.outcome && readTrial(candidate, trial).verdict === 'fail'
}

const sessions = new WeakMap<Page, CDPSession>()

async function sessionFor(probe: ProbePage): Promise<CDPSession | undefined> {
  const known = sessions.get(probe.page)
  if (known) return known
  const session = await probe.context.newCDPSession(probe.page).catch(() => undefined)
  if (session) sessions.set(probe.page, session)
  return session
}

async function capture(page: Page): Promise<Buffer | undefined> {
  return page.screenshot({ scale: 'css', caret: 'hide', animations: 'disabled', timeout: 5000 }).catch(() => undefined)
}

async function readState(page: Page, session: CDPSession | undefined, controls: string[]): Promise<Omit<ToggleState, 'shot'>> {
  const ax = session ? await liveAxFacts(session, 'window.__rampaAxTargets ?? []').catch(() => []) : []
  const rest = await page.evaluate((args) => (window as unknown as ToggleWindow).__rampaToggle?.state(args), { controls }).catch(() => undefined)
  return { ax: ax.map((entry) => exposedState(entry?.facts)), ...(rest ?? { text: { added: [], removed: [], changed: 0 } }) }
}

/** One trial of one control: hover, capture and read; click, restore the scroll, capture and read; again for a toggle. */
async function tryToggle(harness: Harness, candidate: ToggleCandidate, fresh: boolean): Promise<Omit<ToggleTrial, 'confirm'>> {
  const probe = await harness.page(fresh)
  const page = probe.page
  if (!(await harness.locate(probe, candidate))) return { outcome: 'unmatched' }
  const aimed = await harness.aim(probe, candidate)
  if ('cover' in aimed) return { outcome: 'not-exercised', cover: aimed.cover }
  if ('hidden' in aimed) {
    harness.log('not-exercised', { ref: candidate.ref, label: candidate.label, detail: 'not showing on this load' })
    return { outcome: 'not-exercised', reason: 'not showing on this load' }
  }
  await page.evaluate(installToggleKit)
  const session = await sessionFor(probe)
  await page.evaluate((args) => (window as unknown as ToggleWindow).__rampaToggle?.targets(args), { group: candidate.group ?? [] })
  const controls = candidate.controls ?? []
  await page.evaluate(() => (window as unknown as ToggleWindow).__rampaToggle?.blur())
  // The pointer rests on the control first: hover styles and hover content are in every capture.
  await page.mouse.move(aimed.x, aimed.y)
  await page.waitForTimeout(HOVER_MS)
  const box = (await page.evaluate(() => (window as unknown as ToggleWindow).__rampaToggle?.box() ?? null)) ?? undefined
  if (!box) return { outcome: 'not-exercised', reason: 'gone before the click' }
  await page.evaluate(() => (window as unknown as ToggleWindow).__rampaToggle?.save())
  const before: ToggleState = await readState(page, session, controls)
  const base = await capture(page)
  await page.waitForTimeout(NOISE_MS)
  const noisePng = await capture(page)
  if (base) before.shot = imageHash(base)
  const shots: Array<Buffer | undefined> = []
  const after: ToggleState[] = []
  const watches: Watch[] = []
  let stopped: string | undefined
  const click = async (n: number): Promise<boolean> => {
    if (n > 0) {
      const still = await page.evaluate(() => (window as unknown as ToggleWindow).__rampaToggle?.box() ?? null).catch(() => null)
      if (!still) {
        stopped = 'the control was gone after the click'
        return false
      }
      if (Math.abs(still.x - box.x) > 4 || Math.abs(still.y - box.y) > 4) {
        stopped = 'the control moved after the click'
        return false
      }
      if (!(await page.evaluate((args) => (window as unknown as ToggleWindow).__rampaToggle?.hits(args) ?? false, aimed).catch(() => false))) {
        stopped = 'something covered the control after the click'
        return false
      }
    }
    harness.log('activate', { ref: candidate.ref, label: candidate.label, detail: `click ${n + 1} at ${aimed.x},${aimed.y}` })
    const watch = await harness.window(probe, () => page.mouse.click(aimed.x, aimed.y), { ref: candidate.ref, label: candidate.label })
    watches.push(watch)
    await page.evaluate(() => (window as unknown as ToggleWindow).__rampaToggle?.restore()).catch(() => undefined)
    const state: ToggleState = await readState(page, session, controls)
    const png = await capture(page)
    if (png) state.shot = imageHash(png)
    after.push(state)
    shots.push(png)
    return true
  }
  await click(0)
  if (candidate.mode === 'toggle' && (await click(1))) {
    // Only the control's own look changed between the two clicks: a third shows whether it flips back.
    const first = shots[0]
    const second = shots[1]
    if (first && second && regionChange(decodePng(second), decodePng(first), undefined, box, true, OWN_MARGIN).noticeable >= CONTROL_MIN) await click(2)
  }
  const pixels = comparePixels(base, noisePng, shots, box)
  return { box, point: { x: aimed.x, y: aimed.y }, before, after, watches, ...(pixels ? { pixels } : {}), ...(stopped ? { stopped } : {}) }
}

/** The pixel comparisons of a trial, from its captures. */
function comparePixels(base: Buffer | undefined, noisePng: Buffer | undefined, shots: Array<Buffer | undefined>, box: InPageRect): ToggleTrial['pixels'] {
  if (!base) return undefined
  const b = decodePng(base)
  const noise = noisePng ? decodePng(noisePng) : undefined
  const images = shots.map((png) => (png ? decodePng(png) : undefined))
  let masked = 0
  const outside: PixelChange[] = []
  for (const image of images.slice(0, 2)) {
    if (!image) break
    const { masked: m, ...change } = regionChange(image, b, noise, box, false)
    masked = Math.max(masked, m)
    outside.push(change)
  }
  const control: PixelChange[] = []
  const [first, second, third] = images
  if (first && second) {
    const { masked: _, ...change } = regionChange(second, first, undefined, box, true, OWN_MARGIN)
    control.push(change)
    if (third) {
      const { masked: __, ...again } = regionChange(third, first, undefined, box, true, OWN_MARGIN)
      control.push(again)
    }
  }
  return { masked, outside, control }
}

/** 4.1.2: each toggle-like control clicked on a page of its own, its exposed state read before and after. */
export async function runTogglesProbe(browser: Browser, url: string, options: ProbeOptions): Promise<ProbeRecord> {
  const limits = TOGGLES_LIMITS
  const harness = new Harness(browser, url, options, { kind: 'toggles', version: TOGGLES_VERSION, variant: 'state-exposure', limits })
  let data: TogglesData | undefined
  let conditions: ProbeRecord['conditions'] | undefined
  try {
    const first = await harness.page()
    conditions = first.conditions
    const viewport = first.page.viewportSize() ?? first.conditions.viewport
    const listed = await first.page.evaluate(findToggles, {
      max: MAX_LISTED,
      hint: TOGGLE_HINT.source,
      words: TOGGLE_WORDS.source,
      tabs: TAB_CONTAINER.source,
      maxGroup: MAX_GROUP,
      maxAlike: MAX_ALIKE,
    })
    data = { viewport, found: listed.found, candidates: [], tried: 0, loads: 0, actions: [], end: 'complete' }
    let confirmed = 0
    for (const { facts, ...candidate } of listed.candidates) {
      const entry: ToggleCandidate = candidate
      data.candidates.push(entry)
      const skip = skipReason(facts, harness.origin)
      if (skip) {
        entry.skip = skip
        harness.skip(candidate, skip.reason, skip.detail)
        continue
      }
      if (entry.alike) continue
      if (data.tried >= limits.controls || !harness.timeLeft()) {
        if (data.end === 'complete') data.end = data.tried >= limits.controls ? 'budget' : 'time'
        entry.trial = { outcome: 'not-tried', reason: data.end }
        continue
      }
      data.tried++
      const trial: ToggleTrial = await tryToggle(harness, entry, false)
      entry.trial = trial
      if (worthConfirming(entry, trial) && confirmed < MAX_CONFIRM && harness.timeLeft()) {
        confirmed++
        trial.confirm = await tryToggle(harness, entry, true)
      }
    }
  } finally {
    await harness.close()
  }
  if (!data || !conditions) throw new Error('the first page did not load')
  data.loads = harness.loads
  data.actions = harness.actions
  const reason = data.end === 'budget' ? `control budget reached (${limits.controls})` : data.end === 'time' ? `time budget reached (${limits.timeMs / 1000} s)` : undefined
  return harness.record(data, conditions, reason)
}

/** The toggles probe as a step of the probe stage; a probe that fails leaves a skipped record. */
export async function togglesProbe(browser: Browser, url: string, options: ProbeOptions): Promise<ProbeRecord[]> {
  const started = Date.now()
  try {
    return [await runTogglesProbe(browser, url, options)]
  } catch (error) {
    return [skippedRecord('toggles', TOGGLES_VERSION, 'state-exposure', `probe failed: ${(error instanceof Error ? error.message : String(error)).split('\n')[0]}`, Date.now() - started)]
  }
}
