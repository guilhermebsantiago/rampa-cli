import type { Browser, Page } from 'playwright-core'
import { decodePng } from '../pixels/png.ts'
import type { ProbeRecord } from '../snapshot/schema.ts'
import type { InPageElement, InPageIdentity, InPageRect } from './kit.ts'
import { settleInPage } from './kit.ts'
import { type ProbeOptions, type ProbePage, openProbePage, skippedRecord } from './page.ts'
import { diffImages } from './pixels.ts'

/**
 * Content on hover or focus (1.4.13). The probe finds elements that may show content when hovered or focused,
 * then tries each one: the pointer moves onto it, and, separately, it takes focus. When new content shows, the
 * probe measures the three conditions of the criterion:
 * - persistent: the content is still there after 10 s on Playwright's fake clock, with the pointer or focus kept;
 * - hoverable: the content stays while the pointer moves onto it in small steps across any gap (F95);
 * - dismissible: Esc, with neither pointer nor focus moved, hides it, which matters only when it covers other content.
 * Observe class: pointer moves, focus() and blur(), Esc, scrolling an element into view. It never clicks.
 */

export const HOVER_VERSION = '1'
export const TRIGGER_BUDGET = 30
/** Triggers taken from one style rule, or of one family: a menu of twenty items with the same rule needs a few, not all. */
const PER_RULE = 5
const TIME_BUDGET_MS = 120_000
/** Content often shows after a short delay (tooltip libraries use 0 to 400 ms) and a fade. */
const SHOW_MS = 350
/** How long content must stay with the pointer or focus kept on its trigger, on the fake clock. */
export const PERSIST_MS = 10_000
/** Esc is measured twice before content counts as not dismissed: a fade-out can take a moment. */
const DISMISS_WAITS = [250, 350]
const SETTLE = { quietMs: 100, capMs: 600 }
/** How far from its trigger content that is not tied to it in the DOM may appear, in CSS px. */
const NEAR_PX = 250

export type TriggerSource = 'describedby' | 'attribute' | 'popup' | 'css-hover' | 'css-focus' | 'pseudo' | 'listener-hover' | 'listener-focus'

export interface HoverTrigger extends InPageElement {
  /** Its place in the page's list while the probe runs. */
  t: number
  rect: InPageRect
  sources: TriggerSource[]
  /** The style rule that made it a trigger, cut to 120 characters. */
  rule?: string | undefined
  /** A rule shows its ::before or ::after on hover or focus. */
  pseudo?: string | undefined
  /** It can take focus, itself or (for :focus-within) through a descendant. */
  focusable: boolean
}

export interface HoverContent {
  ref: string
  id: InPageIdentity
  tag: string
  role: string
  label: string
  /** Where it showed, in viewport CSS px; for ::before or ::after, the box of the pixels that changed. */
  rect: InPageRect
  /** How it is tied to the trigger: aria-describedby, aria-controls, inside it, near it in the DOM, near it on screen, or its pseudo-element. */
  relation: 'describedby' | 'controls' | 'inside' | 'sibling' | 'near' | 'pseudo'
  /** Its own or nearest positioned ancestor's `position`. */
  position: string
  /** '::after' when the content is the trigger's pseudo-element. */
  pseudo?: string | undefined
}

export interface HoverAttempt {
  /** Index into HoverData.triggers. */
  trigger: number
  mode: 'hover' | 'focus'
  /** New content showed. */
  shown: boolean
  /** The content, the main piece first; at most three. */
  content?: HoverContent[] | undefined
  /** Other content the main piece covers: elements that were showing before, under it where it paints. */
  covers?: { count: number; sample: Array<{ ref: string; id: InPageIdentity; tag: string; label: string }>; byPixels?: boolean | undefined } | undefined
  /** Still showing after PERSIST_MS on the fake clock; `failed` of `rounds` tries lost it. */
  persistent?: { ok: boolean; rounds: number; failed: number; afterMs: number } | undefined
  /** The pointer moved onto it in steps; `gap` is the distance between trigger and content. null: it could not be reached. */
  hoverable?: { ok: boolean | null; rounds: number; failed: number; gap: number; why?: string | undefined } | undefined
  /** Esc hid it, or it still showed `afterMs` later; `focusMoved`: Esc also took focus off the trigger (focus mode). */
  dismissible?: { ok: boolean; afterMs: number; focusMoved?: boolean | undefined; staysAfterLeave?: boolean | undefined } | undefined
  /** The trigger is aria-invalid and the content is what describes it: maybe an input error, which need not be dismissible. */
  inputError?: boolean | undefined
  error?: string | undefined
  ms: number
}

export interface HoverData {
  viewport: { width: number; height: number }
  /** Triggers found, before the budget. */
  found: number
  /** Of those, triggers left out as more of a family already tried five times (same sources, tag, classes and rule). */
  alike: number
  budget: number
  triggers: HoverTrigger[]
  attempts: HoverAttempt[]
  /** Style sheets the page could not read (other origins): rules in them were not looked at. */
  unreadableSheets: number
  /** Elements with hover or focus listeners read over the DevTools protocol; null when that failed. */
  listeners: number | null
  /** The fake clock worked, so persistence was measured. */
  clock: boolean
  end: 'complete' | 'time'
}

interface Page$ {
  __rampaKit: {
    describe(el: Element): InPageElement
    visible(el: Element): boolean
    rect(el: Element): InPageRect
    deepActive(): Element | null
    cssPath(el: Element): string
  }
  __rampaTriggers?: Element[]
  __rampaFocusTargets?: Array<Element | null>
  __rampaSeen?: WeakSet<Element>
  __rampaPseudoBefore?: Record<string, string | null>
  __rampaContent?: Element[]
  __rampaPseudo?: { which: string } | null
  __rampaSelf?: boolean
}

/** Runs in the page: the elements that may show content on hover or focus, best candidates first. Needs the kit. */
export function findTriggers(args: { budget: number; perRule: number }): { triggers: HoverTrigger[]; found: number; alike: number; unreadable: number } {
  const w = window as unknown as Page$
  const kit = w.__rampaKit
  const vw = window.innerWidth
  const vh = window.innerHeight
  const usable = (el: Element): boolean => {
    if (el === document.documentElement || el === document.body || !kit.visible(el)) return false
    const r = el.getBoundingClientRect()
    if (r.width < 4 || r.height < 4 || r.right + window.scrollX <= 0 || r.bottom + window.scrollY <= 0) return false
    // A wrapper as big as half the window is not a trigger, even when a delegating listener sits on it.
    return r.width * r.height < 0.5 * vw * vh
  }
  const RANK: Record<string, number> = { describedby: 0, attribute: 1, pseudo: 2, popup: 3, 'css-hover': 4, 'css-focus': 4, 'listener-hover': 5, 'listener-focus': 5 }
  const entries = new Map<Element, { sources: Set<TriggerSource>; rule?: string; pseudo?: string; within?: boolean }>()
  const add = (el: Element, source: TriggerSource, extra: { rule?: string; pseudo?: string; within?: boolean } = {}) => {
    if (!usable(el)) return false
    let entry = entries.get(el)
    if (!entry) {
      entry = { sources: new Set() }
      entries.set(el, entry)
    }
    entry.sources.add(source)
    if (extra.rule && !entry.rule) entry.rule = extra.rule.slice(0, 120)
    if (extra.pseudo && !entry.pseudo) entry.pseudo = extra.pseudo
    if (extra.within) entry.within = true
    return true
  }
  const rendered = (el: Element): boolean => {
    if (!kit.visible(el)) return false
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }

  // aria-describedby that points to content not showing now, or to a tooltip. `title` is the browser's own tooltip, out of scope.
  for (const el of Array.from(document.querySelectorAll('[aria-describedby]'))) {
    for (const id of (el.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean)) {
      const target = document.getElementById(id)
      if (target && (!rendered(target) || target.getAttribute('role') === 'tooltip')) {
        add(el, 'describedby')
        break
      }
    }
  }
  // Attributes common tooltip and popover libraries read.
  const ATTRIBUTES =
    '[data-tooltip],[data-tip],[data-tippy-content],[data-bs-toggle="tooltip"],[data-bs-toggle="popover"],[data-toggle="tooltip"],[data-toggle="popover"],[data-balloon-pos],[data-microtip-position]'
  for (const el of Array.from(document.querySelectorAll(ATTRIBUTES))) add(el, 'attribute')
  for (const el of Array.from(document.querySelectorAll('[aria-haspopup]:not([aria-haspopup="false"]),[aria-expanded]'))) add(el, 'popup')

  // Style rules on :hover, :focus or :focus-within that show another element or a pseudo-element.
  const SHOWING = new Set(['display', 'visibility', 'opacity', 'transform', 'translate', 'scale', 'clip', 'clip-path', 'max-height', 'height', 'max-width', 'width', 'left', 'right', 'top', 'bottom', 'content', 'z-index'])
  const rules: CSSStyleRule[] = []
  let unreadable = 0
  const walk = (list: CSSRuleList) => {
    for (const rule of Array.from(list)) {
      if (rule instanceof CSSStyleRule) {
        rules.push(rule)
        if (rule.cssRules && rule.cssRules.length > 0) walk(rule.cssRules)
      } else if ('cssRules' in rule && (rule as CSSGroupingRule).cssRules) walk((rule as CSSGroupingRule).cssRules)
    }
  }
  const sheets = [...Array.from(document.styleSheets), ...((document as Document & { adoptedStyleSheets?: CSSStyleSheet[] }).adoptedStyleSheets ?? [])]
  for (const sheet of sheets) {
    try {
      walk(sheet.cssRules)
    } catch {
      unreadable++
    }
  }
  const DYNAMIC = /:(hover|focus-within|focus-visible|focus)(?![\w-])/g
  // Splits a selector list at top-level commas, and finds top-level positions, outside () and [].
  const splitList = (text: string): string[] => {
    const out: string[] = []
    let depth = 0
    let start = 0
    for (let i = 0; i < text.length; i++) {
      const c = text[i]
      if (c === '(' || c === '[') depth++
      else if (c === ')' || c === ']') depth--
      else if (c === ',' && depth === 0) {
        out.push(text.slice(start, i).trim())
        start = i + 1
      }
    }
    out.push(text.slice(start).trim())
    return out.filter(Boolean)
  }
  for (const rule of rules) {
    const selectorText = rule.selectorText ?? ''
    if (!/:(hover|focus)/.test(selectorText) || selectorText.includes('&')) continue
    let shows = false
    for (let i = 0; i < rule.style.length; i++) if (SHOWING.has(rule.style[i] ?? '')) shows = true
    if (!shows) continue
    for (const selector of splitList(selectorText)) {
      // The last top-level dynamic pseudo-class: the compound it sits in is the trigger.
      let depth = 0
      let at = -1
      let length = 0
      let kind = ''
      for (let i = 0; i < selector.length; i++) {
        const c = selector[i]
        if (c === '(' || c === '[') depth++
        else if (c === ')' || c === ']') depth--
        else if (c === ':' && depth === 0 && selector[i - 1] !== ':' && selector[i + 1] !== ':') {
          const match = /^:(hover|focus-within|focus-visible|focus)(?![\w-])/.exec(selector.slice(i))
          if (match) {
            at = i
            length = match[0].length
            kind = match[1] ?? ''
          }
        }
      }
      if (at < 0) continue
      // The compound ends at the next top-level combinator or pseudo-element.
      let end = selector.length
      depth = 0
      for (let i = at + length; i < selector.length; i++) {
        const c = selector[i]
        if (c === '(' || c === '[') depth++
        else if (c === ')' || c === ']') depth--
        else if (depth === 0 && (c === ' ' || c === '>' || c === '+' || c === '~' || (c === ':' && selector[i + 1] === ':'))) {
          end = i
          break
        }
      }
      const triggerSelector = (selector.slice(0, at) + selector.slice(at + length, end)).replace(DYNAMIC, '').trim()
      const rest = selector.slice(end)
      if (!triggerSelector || /[>+~]$/.test(triggerSelector)) continue
      const pseudo = /^\s*::?(before|after)\b/.exec(rest)?.[1]
      const contentPart = rest.replace(/::?(before|after|marker|placeholder|first-line|first-letter)\b.*$/, '').replace(DYNAMIC, '')
      if (!pseudo && contentPart.trim() === '') continue
      let candidates: Element[] = []
      try {
        candidates = Array.from(document.querySelectorAll(triggerSelector))
      } catch {
        continue
      }
      const source: TriggerSource = kind === 'hover' ? 'css-hover' : 'css-focus'
      let siblings: Element[] | undefined
      let taken = 0
      for (const el of candidates) {
        if (taken >= args.perRule) break
        let related = false
        if (pseudo) related = true
        else {
          const combinator = contentPart.trimStart()[0]
          try {
            if (combinator === '+' || combinator === '~') {
              siblings ??= Array.from(document.querySelectorAll(`${triggerSelector}${contentPart}`))
              related = siblings.some((c) => el.parentElement?.contains(c) && (el.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0)
            } else related = el.querySelector(`:scope${contentPart}`) !== null
          } catch {
            related = false
          }
        }
        if (!related) continue
        if (add(el, pseudo ? 'pseudo' : source, { rule: selector, ...(pseudo ? { pseudo: `::${pseudo}` } : {}), ...(kind === 'focus-within' ? { within: true } : {}) })) {
          if (pseudo) entries.get(el)?.sources.add(source)
          taken++
        }
      }
    }
  }

  // Elements with their own hover or focus listeners, marked over the DevTools protocol before this ran.
  for (const el of Array.from(document.querySelectorAll('body *'))) {
    const types = (el as Element & { __rampaListen?: string }).__rampaListen
    if (!types) continue
    // A container that delegates for many elements is not one trigger.
    if (el.querySelectorAll('*').length > 50) continue
    if (/mouse|pointer/.test(types)) add(el, 'listener-hover')
    if (/focus/.test(types)) add(el, 'listener-focus')
  }

  const FOCUSABLE = 'a[href],area[href],button,input:not([type=hidden]),select,textarea,summary,iframe,[tabindex],[contenteditable]:not([contenteditable=false])'
  const focusTarget = (el: Element, within: boolean): Element | null => {
    const own = el.matches(FOCUSABLE) && (el as HTMLElement).tabIndex >= 0 && !(el as HTMLInputElement).disabled
    if (own) return el
    if (!within) return null
    return Array.from(el.querySelectorAll(FOCUSABLE)).find((d) => (d as HTMLElement).tabIndex >= 0 && kit.visible(d)) ?? null
  }
  const ordered = [...entries.entries()].sort((a, b) => {
    const ra = Math.min(...[...a[1].sources].map((s) => RANK[s] ?? 9))
    const rb = Math.min(...[...b[1].sources].map((s) => RANK[s] ?? 9))
    if (ra !== rb) return ra - rb
    return a[0].compareDocumentPosition(b[0]) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
  })
  // A few of each family: the same sources, tag, classes and rule are the same component (twenty "Copy" buttons).
  const families = new Map<string, number>()
  const diverse = ordered.filter(([el, entry]) => {
      const classes = (el.getAttribute('class') ?? '').trim().split(/\s+/).slice(0, 2).join('.')
      const family = `${[...entry.sources].sort().join('/')}|${el.localName}|${classes}|${entry.rule ?? ''}`
      const count = families.get(family) ?? 0
      families.set(family, count + 1)
      return count < args.perRule
    })
  const kept = diverse.slice(0, args.budget)
  w.__rampaTriggers = kept.map(([el]) => el)
  w.__rampaFocusTargets = kept.map(([el, entry]) => focusTarget(el, entry.within === true || entry.sources.has('css-focus') || entry.sources.has('listener-focus')))
  const triggers = kept.map(([el, entry], t) => ({
    ...kit.describe(el),
    t,
    rect: kit.rect(el),
    sources: [...entry.sources].sort((a, b) => (RANK[a] ?? 9) - (RANK[b] ?? 9)),
    ...(entry.rule ? { rule: entry.rule } : {}),
    ...(entry.pseudo ? { pseudo: entry.pseudo } : {}),
    focusable: (w.__rampaFocusTargets?.[t] ?? null) !== null,
  }))
  return { triggers, found: entries.size, alike: ordered.length - diverse.length, unreadable }
}

/**
 * Runs in the page: scrolls trigger `t` into view, and picks a resting place for the pointer far from it and from
 * every trigger, so that what shows next is the trigger's doing. Null when the trigger is gone.
 */
export function placeTrigger(t: number): { rect: InPageRect; rest: { x: number; y: number }; scrolled: boolean } | null {
  const w = window as unknown as Page$
  const el = w.__rampaTriggers?.[t]
  if (!el?.isConnected) return null
  const sx = window.scrollX
  const sy = window.scrollY
  el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' as ScrollBehavior })
  const scrolled = window.scrollX !== sx || window.scrollY !== sy
  const r = el.getBoundingClientRect()
  const vw = document.documentElement.clientWidth || window.innerWidth
  const vh = document.documentElement.clientHeight || window.innerHeight
  const cx = r.left + r.width / 2
  const cy = r.top + r.height / 2
  const points = [
    { x: vw - 3, y: vh / 2 },
    { x: 3, y: vh / 2 },
    { x: vw / 2, y: vh - 3 },
    { x: vw - 3, y: vh - 3 },
    { x: 3, y: vh - 3 },
    { x: vw - 3, y: 3 },
    { x: 3, y: 3 },
    { x: vw / 2, y: 3 },
  ].sort((a, b) => Math.hypot(b.x - cx, b.y - cy) - Math.hypot(a.x - cx, a.y - cy))
  const triggers = w.__rampaTriggers ?? []
  const quiet = points.find((p) => {
    const hit = document.elementFromPoint(p.x, p.y)
    if (!hit || hit === document.documentElement || hit === document.body) return true
    if ((hit as Element & { __rampaListen?: string }).__rampaListen) return false
    return !triggers.some((tr) => tr.contains(hit))
  })
  return { rect: w.__rampaKit.rect(el), rest: quiet ?? points[0] ?? { x: 0, y: 0 }, scrolled }
}

/** Runs in the page: what shows before the trigger is touched, and the text of its pseudo-elements. */
export function scanBefore(t: number): number {
  const w = window as unknown as Page$
  const kit = w.__rampaKit
  const vw = window.innerWidth
  const vh = window.innerHeight
  const seen = new WeakSet<Element>()
  let count = 0
  for (const el of Array.from(document.body?.querySelectorAll('*') ?? [])) {
    if (!kit.visible(el)) continue
    const r = el.getBoundingClientRect()
    if (r.width * r.height < 4 || r.right <= 0 || r.bottom <= 0 || r.left >= vw || r.top >= vh) continue
    seen.add(el)
    count++
  }
  w.__rampaSeen = seen
  w.__rampaContent = []
  w.__rampaPseudo = null
  const trigger = w.__rampaTriggers?.[t]
  const pseudoText = (which: string): string | null => {
    if (!trigger) return null
    const s = getComputedStyle(trigger, which)
    const c = s.content
    if (!c || c === 'none' || c === 'normal' || s.display === 'none' || s.visibility !== 'visible' || Number(s.opacity) < 0.05) return null
    const text = (/^"(.*)"$/s.exec(c)?.[1] ?? '').trim()
    return text || null
  }
  w.__rampaPseudoBefore = { '::before': pseudoText('::before'), '::after': pseudoText('::after') }
  return count
}

/** Runs in the page: gives trigger `t` (or its focusable descendant) focus, as a script would. */
export function focusTrigger(t: number): boolean {
  const w = window as unknown as Page$
  const target = w.__rampaFocusTargets?.[t]
  if (!target?.isConnected) return false
  w.__rampaSelf = true
  try {
    ;(target as HTMLElement).focus({ preventScroll: true })
  } finally {
    w.__rampaSelf = false
  }
  return w.__rampaKit.deepActive() === target
}

/** Runs in the page: whether focus is still on trigger `t`'s focus target. */
export function focusStillOn(t: number): boolean {
  const w = window as unknown as Page$
  return w.__rampaKit.deepActive() === w.__rampaFocusTargets?.[t]
}

/** Runs in the page: takes focus away from whatever has it, so the next attempt starts from nothing. */
export function blurAll(): void {
  const w = window as unknown as Page$
  const active = w.__rampaKit.deepActive() as HTMLElement | null
  if (!active) return
  w.__rampaSelf = true
  try {
    active.blur()
  } finally {
    w.__rampaSelf = false
  }
}

/** Runs in the page: what showed since scanBefore and is tied to trigger `t`, the main piece first. Needs the kit. */
export function findContent(args: { t: number; near: number }): { content: HoverContent[]; inputError: boolean } {
  const { t } = args
  const w = window as unknown as Page$
  const kit = w.__rampaKit
  const trigger = w.__rampaTriggers?.[t]
  const seen = w.__rampaSeen ?? new WeakSet<Element>()
  if (!trigger?.isConnected) return { content: [], inputError: false }
  const vw = window.innerWidth
  const vh = window.innerHeight
  const shown = (el: Element): boolean => {
    if (!kit.visible(el)) return false
    const r = el.getBoundingClientRect()
    return r.width * r.height >= 4 && r.right > 0 && r.bottom > 0 && r.left < vw && r.top < vh
  }
  const fresh: Element[] = []
  for (const el of Array.from(document.body?.querySelectorAll('*') ?? [])) if (!seen.has(el) && shown(el)) fresh.push(el)
  const freshSet = new Set(fresh)
  const tops = fresh.filter((el) => !(el.parentElement && freshSet.has(el.parentElement)))
  const ids = (name: string) => (trigger.getAttribute(name) ?? '').split(/\s+/).filter(Boolean)
  const described = [...ids('aria-describedby'), ...ids('aria-errormessage')]
  const controls = [...ids('aria-controls'), ...ids('aria-owns')]
  const linked = (el: Element, list: string[]) =>
    list.some((id) => {
      try {
        return el.id === id || el.closest(`#${CSS.escape(id)}`) !== null || el.querySelector(`#${CSS.escape(id)}`) !== null
      } catch {
        return false
      }
    })
  const tr = trigger.getBoundingClientRect()
  const distance = (r: DOMRect) => Math.hypot(Math.max(0, r.left - tr.right, tr.left - r.right), Math.max(0, r.top - tr.bottom, tr.top - r.bottom))
  const collapse = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim()
  const MEDIA = 'img,svg,video,canvas,input,button,select,textarea,iframe'
  const ROLES = new Set(['tooltip', 'menu', 'menubar', 'listbox', 'dialog', 'tree', 'grid'])
  const found: Array<{ el: Element; relation: HoverContent['relation']; area: number; rank: number }> = []
  for (const el of tops) {
    if (el === trigger || el.contains(trigger)) continue
    if (['script', 'style', 'link', 'meta', 'br', 'wbr', 'template'].includes(el.localName)) continue
    let relation: HoverContent['relation']
    if (linked(el, described)) relation = 'describedby'
    else if (linked(el, controls)) relation = 'controls'
    else if (trigger.contains(el)) relation = 'inside'
    else {
      let near = false
      for (let a = trigger.parentElement, n = 0; a && n < 3 && a !== document.body; a = a.parentElement, n++) {
        if (a.contains(el)) {
          near = true
          break
        }
      }
      if (near) relation = 'sibling'
      else if (distance(el.getBoundingClientRect()) <= args.near) relation = 'near'
      else continue
    }
    const r = el.getBoundingClientRect()
    if (r.width * r.height < 100) continue
    const text = collapse((el as HTMLElement).innerText ?? el.textContent)
    if (!text && !el.matches(MEDIA) && el.querySelector(MEDIA) === null) continue
    const role = el.getAttribute('role') ?? ''
    const rank = (relation === 'describedby' ? 0 : relation === 'controls' ? 1 : 3) - (ROLES.has(role) ? 1 : 0)
    found.push({ el, relation, area: r.width * r.height, rank })
  }
  found.sort((a, b) => a.rank - b.rank || b.area - a.area)
  const kept = found.slice(0, 3)
  w.__rampaContent = kept.map((f) => f.el)
  const positionOf = (el: Element): string => {
    for (let a: Element | null = el; a && a !== document.body; a = a.parentElement) {
      const p = getComputedStyle(a).position
      if (p !== 'static') return p
    }
    return 'static'
  }
  const content: HoverContent[] = kept.map((f) => {
    const d = kit.describe(f.el)
    return { ref: d.ref, id: d.id, tag: d.tag, role: d.role, label: d.label, rect: kit.rect(f.el), relation: f.relation, position: positionOf(f.el) }
  })
  // The trigger's own ::before or ::after, when it showed text it did not show before.
  const pseudoText = (which: string): string | null => {
    const s = getComputedStyle(trigger, which)
    const c = s.content
    if (!c || c === 'none' || c === 'normal' || s.display === 'none' || s.visibility !== 'visible' || Number(s.opacity) < 0.05) return null
    const value = (/^"(.*)"$/s.exec(c)?.[1] ?? '').trim()
    return value || null
  }
  const before = w.__rampaPseudoBefore ?? {}
  for (const which of ['::before', '::after']) {
    const now = pseudoText(which)
    if (now && now !== before[which] && now.length >= 2) {
      if (!w.__rampaPseudo) w.__rampaPseudo = { which }
      const d = kit.describe(trigger)
      content.push({ ref: d.ref, id: d.id, tag: d.tag, role: d.role, label: now.slice(0, 80), rect: kit.rect(trigger), relation: 'pseudo', position: 'pseudo', pseudo: which })
    }
  }
  const inputError = trigger.getAttribute('aria-invalid') === 'true' && kept.some((f) => f.relation === 'describedby')
  return { content, inputError }
}

/** Runs in the page: whether the main piece of content (an element, else the trigger's pseudo-element) still shows. */
export function contentShown(t: number): boolean {
  const w = window as unknown as Page$
  const kit = w.__rampaKit
  const el = w.__rampaContent?.[0]
  if (el) {
    if (!el.isConnected || !kit.visible(el)) return false
    const r = el.getBoundingClientRect()
    return r.width * r.height >= 4 && r.right > 0 && r.bottom > 0 && r.left < window.innerWidth && r.top < window.innerHeight
  }
  const pseudo = w.__rampaPseudo
  const trigger = w.__rampaTriggers?.[t]
  if (!pseudo || !trigger?.isConnected) return false
  const s = getComputedStyle(trigger, pseudo.which)
  const c = s.content
  return Boolean(c && c !== 'none' && c !== 'normal' && c !== '""' && s.display !== 'none' && s.visibility === 'visible' && Number(s.opacity) >= 0.05)
}

/** Runs in the page: the main content element's box now, or null when it is the pseudo-element or gone. */
export function contentRect(): InPageRect | null {
  const w = window as unknown as Page$
  const el = w.__rampaContent?.[0]
  return el?.isConnected ? w.__rampaKit.rect(el) : null
}

/**
 * Runs in the page: other content the main piece covers. An element that showed before, with text of its own or
 * media, not part of the content or the trigger, whose box meets the content's by at least 4×4 px, and where the
 * content is what the browser hits at the middle of that overlap (its pointer-events forced on for the test).
 * For a pseudo-element, `rect` is the box of the pixels that changed, and an overlap is enough.
 */
export function coveredBy(args: { t: number; rect?: InPageRect | null }): NonNullable<HoverAttempt['covers']> {
  const w = window as unknown as Page$
  const kit = w.__rampaKit
  const trigger = w.__rampaTriggers?.[args.t]
  const content = w.__rampaContent?.[0]
  const seen = w.__rampaSeen
  const empty = { count: 0, sample: [] }
  if (!trigger || !seen) return empty
  const box = content?.isConnected ? content.getBoundingClientRect() : args.rect ? new DOMRect(args.rect.x, args.rect.y, args.rect.width, args.rect.height) : null
  if (!box) return empty
  const target = content as HTMLElement | undefined
  const saved = target ? [target.style.getPropertyValue('pointer-events'), target.style.getPropertyPriority('pointer-events')] : undefined
  if (target) target.style.setProperty('pointer-events', 'auto', 'important')
  const sample: Array<{ ref: string; id: InPageIdentity; tag: string; label: string }> = []
  let count = 0
  try {
    const MEDIA = 'img,svg,video,canvas,input,button,select,textarea,iframe'
    for (const el of Array.from(document.body?.querySelectorAll('*') ?? [])) {
      if (!seen.has(el)) continue
      if (content && (content.contains(el) || el.contains(content))) continue
      if (trigger.contains(el) || el.contains(trigger)) continue
      const own = Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim() !== '')
      if (!own && !el.matches(MEDIA)) continue
      const r = el.getBoundingClientRect()
      const left = Math.max(r.left, box.left)
      const right = Math.min(r.right, box.right)
      const top = Math.max(r.top, box.top)
      const bottom = Math.min(r.bottom, box.bottom)
      if (right - left < 4 || bottom - top < 4) continue
      if (content) {
        const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2)
        if (!hit || !content.contains(hit)) continue
      }
      count++
      if (sample.length < 3) {
        const d = kit.describe(el)
        sample.push({ ref: d.ref, id: d.id, tag: d.tag, label: d.label })
      }
    }
  } finally {
    if (target && saved) {
      if (saved[0]) target.style.setProperty('pointer-events', saved[0], saved[1])
      else target.style.removeProperty('pointer-events')
    }
  }
  return { count, sample, ...(content ? {} : { byPixels: true }) }
}

const round = (value: number) => Math.round(value * 10) / 10

/** The part of `outer` outside `inner` with the largest area: where a pseudo-element tooltip sits next to its trigger. */
function outsidePart(outer: InPageRect, inner: InPageRect): InPageRect | null {
  const parts: InPageRect[] = [
    { x: outer.x, y: outer.y, width: outer.width, height: inner.y - outer.y },
    { x: outer.x, y: inner.y + inner.height, width: outer.width, height: outer.y + outer.height - (inner.y + inner.height) },
    { x: outer.x, y: outer.y, width: inner.x - outer.x, height: outer.height },
    { x: inner.x + inner.width, y: outer.y, width: outer.x + outer.width - (inner.x + inner.width), height: outer.height },
  ].filter((p) => p.width >= 3 && p.height >= 3)
  return parts.sort((a, b) => b.width * b.height - a.width * a.height)[0] ?? null
}

/** The point of `rect` closest to `from`, kept `inset` px inside it. */
function nearestInside(rect: InPageRect, from: { x: number; y: number }, inset: number): { x: number; y: number } {
  const ix = Math.min(inset, rect.width / 2)
  const iy = Math.min(inset, rect.height / 2)
  return {
    x: Math.min(Math.max(from.x, rect.x + ix), rect.x + rect.width - ix),
    y: Math.min(Math.max(from.y, rect.y + iy), rect.y + rect.height - iy),
  }
}

function gapBetween(a: InPageRect, b: InPageRect): number {
  return round(Math.hypot(Math.max(0, b.x - (a.x + a.width), a.x - (b.x + b.width)), Math.max(0, b.y - (a.y + a.height), a.y - (b.y + b.height))))
}

interface Shown {
  content: HoverContent[]
  inputError: boolean
  /** For a pseudo-element: the box of the pixels that changed, and its part outside the trigger. */
  pixels?: { box: InPageRect; outside: InPageRect | null } | undefined
  triggerRect: InPageRect
  rest: { x: number; y: number }
}

class TriggerGone extends Error {}

/** One attempt's session on the probe page: moving the pointer, focusing, reading what shows. */
class HoverSession {
  readonly page: Page
  private readonly viewport: { width: number; height: number }

  constructor(page: Page, viewport: { width: number; height: number }) {
    this.page = page
    this.viewport = viewport
  }

  async reset(rest: { x: number; y: number }): Promise<void> {
    await this.page.evaluate(blurAll)
    await this.page.mouse.move(rest.x, rest.y)
    await this.page.waitForTimeout(120)
  }

  private async capture(clip: InPageRect): Promise<Buffer> {
    return this.page.screenshot({ clip, caret: 'hide', scale: 'css' })
  }

  private region(rect: InPageRect): InPageRect {
    const x = Math.max(0, Math.floor(rect.x - 160))
    const y = Math.max(0, Math.floor(rect.y - 160))
    const right = Math.min(this.viewport.width, Math.ceil(rect.x + rect.width + 160))
    const bottom = Math.min(this.viewport.height, Math.ceil(rect.y + rect.height + 160))
    return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) }
  }

  /** Puts the page at rest, then hovers or focuses the trigger and reads what showed. */
  async show(trigger: HoverTrigger, mode: 'hover' | 'focus'): Promise<Shown> {
    const placed = await this.page.evaluate(placeTrigger, trigger.t)
    if (!placed) throw new TriggerGone('the trigger is gone from the page')
    await this.reset(placed.rest)
    // What a scroll sets off (a header that shrinks, images that load) is not the trigger's doing: let it happen first.
    if (placed.scrolled) await this.page.evaluate(settleInPage, SETTLE)
    await this.page.evaluate(scanBefore, trigger.t)
    const clip = trigger.pseudo ? this.region(placed.rect) : undefined
    const before = clip ? await this.capture(clip) : undefined
    if (mode === 'hover') {
      await this.page.mouse.move(placed.rect.x + placed.rect.width / 2, placed.rect.y + placed.rect.height / 2, { steps: 5 })
    } else if (!(await this.page.evaluate(focusTrigger, trigger.t))) {
      throw new TriggerGone('the trigger did not take focus')
    }
    await this.page.waitForTimeout(SHOW_MS)
    await this.page.evaluate(settleInPage, SETTLE)
    const found = await this.page.evaluate(findContent, { t: trigger.t, near: NEAR_PX })
    const shown: Shown = { ...found, triggerRect: placed.rect, rest: placed.rest }
    const pseudo = found.content.find((c) => c.relation === 'pseudo')
    if (pseudo && clip && before) {
      const diff = diffImages(decodePng(await this.capture(clip)), decodePng(before))
      if (diff.bbox) {
        const box = { x: clip.x + diff.bbox.x, y: clip.y + diff.bbox.y, width: diff.bbox.width, height: diff.bbox.height }
        shown.pixels = { box, outside: outsidePart(box, placed.rect) }
        pseudo.rect = box
      }
    }
    return shown
  }

  shownNow(trigger: HoverTrigger): Promise<boolean> {
    return this.page.evaluate(contentShown, trigger.t)
  }

  /** Persistent: still showing after the fake clock jumps PERSIST_MS, pointer or focus kept where it is. */
  async persists(trigger: HoverTrigger): Promise<boolean> {
    await this.page.clock.runFor(PERSIST_MS)
    await this.page.waitForTimeout(100)
    return this.shownNow(trigger)
  }

  /**
   * Hoverable: from the trigger's middle to its edge nearest the content, then across any gap onto the content in
   * steps of about 8 px every 16 ms, as a hand would. True when the content still shows 250 ms after arriving.
   */
  async hoverOnto(trigger: HoverTrigger, shown: Shown): Promise<{ ok: boolean | null; gap: number; why?: string }> {
    const tr = shown.triggerRect
    const main = shown.content[0]
    if (!main) return { ok: null, gap: 0, why: 'no content' }
    // A pseudo-element whose pixels were not captured (no rule named it) has no box to move onto.
    if (main.relation === 'pseudo' && !shown.pixels) return { ok: null, gap: 0, why: 'not measured' }
    const area = main.relation === 'pseudo' ? (shown.pixels?.outside ?? null) : ((await this.page.evaluate(contentRect)) ?? main.rect)
    if (!area) return { ok: true, gap: 0, why: 'inside the trigger' }
    const view = { x: 1, y: 1, width: this.viewport.width - 2, height: this.viewport.height - 2 }
    const visible = {
      x: Math.max(area.x, view.x),
      y: Math.max(area.y, view.y),
      width: Math.min(area.x + area.width, view.x + view.width) - Math.max(area.x, view.x),
      height: Math.min(area.y + area.height, view.y + view.height) - Math.max(area.y, view.y),
    }
    if (visible.width < 2 || visible.height < 2) return { ok: null, gap: gapBetween(tr, area), why: 'outside the window' }
    const centre = { x: tr.x + tr.width / 2, y: tr.y + tr.height / 2 }
    const target = nearestInside(visible, centre, 4)
    const inside = target.x > tr.x && target.x < tr.x + tr.width && target.y > tr.y && target.y < tr.y + tr.height
    const gap = gapBetween(tr, area)
    if (inside && main.relation !== 'pseudo') return { ok: true, gap, why: 'inside the trigger' }
    const edge = nearestInside(tr, target, 1)
    await this.page.mouse.move(centre.x, centre.y)
    await this.page.mouse.move(edge.x, edge.y, { steps: 3 })
    const steps = Math.max(2, Math.ceil(Math.hypot(target.x - edge.x, target.y - edge.y) / 8))
    for (let i = 1; i <= steps; i++) {
      await this.page.mouse.move(edge.x + ((target.x - edge.x) * i) / steps, edge.y + ((target.y - edge.y) * i) / steps)
      await this.page.waitForTimeout(16)
    }
    await this.page.waitForTimeout(250)
    return { ok: await this.shownNow(trigger), gap }
  }

  /** Dismissible: Esc with nothing moved; the content must be gone, measured twice before it counts as still there. */
  async dismiss(trigger: HoverTrigger, mode: 'hover' | 'focus'): Promise<{ ok: boolean; afterMs: number; focusMoved?: boolean }> {
    await this.page.keyboard.press('Escape')
    let still = true
    let afterMs = 0
    for (const wait of DISMISS_WAITS) {
      await this.page.waitForTimeout(wait)
      afterMs += wait
      still = await this.shownNow(trigger)
      if (!still) break
    }
    if (mode === 'focus') return { ok: !still, afterMs, focusMoved: !(await this.page.evaluate(focusStillOn, trigger.t)) }
    return { ok: !still, afterMs }
  }
}

/** Tries one trigger in one mode, through the three conditions. */
async function attempt(session: HoverSession, trigger: HoverTrigger, index: number, mode: 'hover' | 'focus', clock: boolean): Promise<HoverAttempt> {
  const started = Date.now()
  const result: HoverAttempt = { trigger: index, mode, shown: false, ms: 0 }
  let shown: Shown | undefined
  try {
    shown = await session.show(trigger, mode)
    if (shown.content.length === 0) return result
    result.shown = true
    result.content = shown.content
    if (shown.inputError) result.inputError = true
    result.covers = await session.page.evaluate(coveredBy, { t: trigger.t, rect: shown.pixels?.outside ?? shown.pixels?.box ?? null })
    // Shows the content again when a step made it go; false when it no longer shows at all.
    const again = async (): Promise<boolean> => {
      if (await session.shownNow(trigger)) return true
      shown = await session.show(trigger, mode)
      return shown.content.length > 0
    }

    // Persistent: a verdict that rests on the content going away is measured twice.
    if (clock) {
      let failed = 0
      let rounds = 0
      while (rounds < 2) {
        rounds++
        if (await session.persists(trigger)) break
        failed++
        if (rounds < 2 && !(await again())) break
      }
      result.persistent = { ok: failed < rounds, rounds, failed, afterMs: PERSIST_MS }
      if (!(await again())) return result
    }

    // Hoverable, for content the pointer brought: moving onto it must not make it go.
    if (mode === 'hover') {
      let failed = 0
      let rounds = 0
      let gap = 0
      let why: string | undefined
      let reachable = true
      while (rounds < 2) {
        rounds++
        const moved = await session.hoverOnto(trigger, shown)
        gap = moved.gap
        why = moved.why
        if (moved.ok === null) {
          reachable = false
          break
        }
        if (moved.ok) break
        failed++
        if (rounds < 2 && !(await again())) break
      }
      result.hoverable = { ok: reachable ? failed < rounds : null, rounds, failed, gap, ...(why ? { why } : {}) }
      if (!(await again())) return result
    }

    // Dismissible: Esc, with pointer and focus where they are.
    result.dismissible = await session.dismiss(trigger, mode)
    if (!result.dismissible.ok && shown) {
      // Content that stays when the pointer and focus leave may not be the trigger's (a banner, an image that loaded late).
      await session.reset(shown.rest)
      result.dismissible.staysAfterLeave = await session.shownNow(trigger)
    }
    return result
  } catch (error) {
    result.error = (error instanceof Error ? error.message : String(error)).split('\n')[0]?.slice(0, 200)
    return result
  } finally {
    result.ms = Date.now() - started
    if (shown) await session.reset(shown.rest).catch(() => undefined)
  }
}

/** Marks elements that have their own hover or focus listeners (`__rampaListen`), read over the DevTools protocol. */
async function markListeners(probe: ProbePage): Promise<number | null> {
  try {
    const cdp = await probe.context.newCDPSession(probe.page)
    try {
      const { result } = await cdp.send('Runtime.evaluate', { expression: 'document' })
      if (!result.objectId) return null
      const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId, depth: -1, pierce: true })
      const TYPES = new Set(['mouseenter', 'mouseover', 'pointerenter', 'pointerover', 'focus', 'focusin'])
      const byNode = new Map<number, Set<string>>()
      for (const listener of listeners) {
        if (!TYPES.has(listener.type) || !listener.backendNodeId) continue
        byNode.set(listener.backendNodeId, (byNode.get(listener.backendNodeId) ?? new Set()).add(listener.type))
      }
      let marked = 0
      for (const [backendNodeId, types] of [...byNode.entries()].slice(0, 400)) {
        try {
          const { object } = await cdp.send('DOM.resolveNode', { backendNodeId })
          if (!object.objectId) continue
          await cdp.send('Runtime.callFunctionOn', {
            objectId: object.objectId,
            functionDeclaration: 'function (types) { if (this.nodeType === 1) this.__rampaListen = types }',
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

/** 1.4.13: finds the triggers, then tries each, hovered and then focused, within the budgets. */
export async function runHoverProbe(browser: Browser, url: string, options: ProbeOptions): Promise<ProbeRecord> {
  const started = Date.now()
  // A pointer that hovers: desktop mode, so touch emulation (--device) does not turn hover off.
  const probe = await openProbePage(browser, url, options, { desktop: true, variant: 'hover-focus', clock: true })
  try {
    const page = probe.page
    const viewport = page.viewportSize() ?? probe.conditions.viewport
    const listeners = await markListeners(probe)
    const { triggers, found, alike, unreadable } = await page.evaluate(findTriggers, { budget: TRIGGER_BUDGET, perRule: PER_RULE })
    let clock = true
    try {
      await page.clock.runFor(1)
    } catch {
      clock = false
    }
    const session = new HoverSession(page, viewport)
    const attempts: HoverAttempt[] = []
    let end: HoverData['end'] = 'complete'
    const deadline = started + TIME_BUDGET_MS
    for (const [index, trigger] of triggers.entries()) {
      for (const mode of ['hover', 'focus'] as const) {
        if (mode === 'focus' && !trigger.focusable) continue
        if (Date.now() > deadline) {
          end = 'time'
          break
        }
        attempts.push(await attempt(session, trigger, index, mode, clock))
      }
      if (end === 'time') break
    }
    const data: HoverData = { viewport, found, alike, budget: TRIGGER_BUDGET, triggers, attempts, unreadableSheets: unreadable, listeners, clock, end }
    const cut = end === 'time' || found - alike > TRIGGER_BUDGET
    return {
      kind: 'hover',
      version: HOVER_VERSION,
      conditions: { ...probe.conditions, viewport },
      status: cut ? 'partial' : 'complete',
      ...(end === 'time'
        ? { reason: `time budget reached (${TIME_BUDGET_MS / 1000} s)` }
        : found - alike > TRIGGER_BUDGET
          ? { reason: `trigger budget reached (${TRIGGER_BUDGET} of ${found - alike})` }
          : {}),
      guard: probe.guard.log,
      durationMs: Date.now() - started,
      data,
    }
  } finally {
    await probe.context.close()
  }
}

/** The hover probe as a step of the probe stage; a probe that fails leaves a skipped record. */
export async function hoverProbe(browser: Browser, url: string, options: ProbeOptions): Promise<ProbeRecord[]> {
  const started = Date.now()
  try {
    return [await runHoverProbe(browser, url, options)]
  } catch (error) {
    return [skippedRecord('hover', HOVER_VERSION, 'hover-focus', `probe failed: ${(error instanceof Error ? error.message : String(error)).split('\n')[0]}`, Date.now() - started)]
  }
}
