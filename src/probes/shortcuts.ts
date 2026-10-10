import type { Browser, CDPSession, Page } from 'playwright-core'
import { decodePng, type RgbaImage } from '../pixels/png.ts'
import type { ProbeRecord } from '../snapshot/schema.ts'
import type { InPageElement } from './kit.ts'
import { settleInPage } from './kit.ts'
import { type ProbePage, type ProbeOptions, openProbePage, skippedRecord } from './page.ts'

/**
 * Character key shortcuts (2.1.4). With focus on the page's body, the probe presses each printable key on its own,
 * no modifier held, and records what changed: the DOM (nodes, text, ARIA and state attributes), focus, scrolling,
 * the address, navigations, windows, dialogs, and the window's pixels. What the page does on its own is subtracted:
 * a wait of the same length with no key, before the keys and again before each confirming press. A key that
 * changed the page is pressed a second time. Then the probe looks for settings that turn shortcuts off or remap
 * them (checkboxes, switches and radios named for shortcuts or keys), toggles each with Space, presses the keys
 * again, and toggles it back; settings it cannot reach without a click (a closed dialog) are listed with the
 * controls that may open them, for a model to judge whether the way there is clearly labeled.
 * Activate class: it presses single printable keys and Space on the settings it found. It never clicks, never
 * types into a field (focus is taken back to the body before every key), and the network guard is on.
 */

export const SHORTCUTS_VERSION = '1'
const TIME_BUDGET_MS = 90_000
/** How long a key is given to change the page, and the wait with no key it is compared with. */
export const OBSERVE_MS = 150
const IDLE_ROUNDS = 3
/** At most this long waiting for the network to go quiet before the first key. */
const NETWORK_QUIET_MS = 5000
const IDLE_MS = 400
/** A wait with no key after every so many keys, to keep learning what changes on its own. */
const LEARN_EVERY = 12
/** Keys confirmed with a second press, at most; settings tried, and keys pressed again for each. */
const CONFIRM_BUDGET = 24
const SETTING_BUDGET = 5
const KEYS_PER_SETTING = 10
const RESTORE_SETTLE = { quietMs: 120, capMs: 1000 }
/** A pixel changed when one of its channels moved by this much: anti-aliasing noise stays below. */
const PIXEL_DELTA = 32
/**
 * A key whose only effect is pixels is pressed again when at least this many changed (in the half-size capture):
 * a few letters' worth. The rule counts pixels from the same number.
 */
export const SCREEN_PIXELS = 12
/** Pixels that change on their own are masked with a margin (in the half-size capture): a clock's next digits differ. */
const NOISE_MARGIN = 6

/**
 * Printable keys, pressed one at a time: letters, digits and the ASCII punctuation and symbols, then capitals.
 * Space is left out: the browser scrolls the page on Space, which is not the page's shortcut.
 */
export const PRINTABLE_KEYS: readonly string[] = [
  ...'abcdefghijklmnopqrstuvwxyz',
  '?',
  '/',
  ...'0123456789',
  ...'.,;\'[]\\-=`',
  ...'!@#$%^&*()_+{}|:"<>~',
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
]

export interface ChangeSample {
  ref: string
  id: InPageElement['id']
  tag: string
  label: string
  /** What happened to it: added, removed, text, or the attribute that changed. */
  what: string
}

/** What one key press (or one wait with no key) changed. Facts only: the rule decides what counts. */
export interface KeyChange {
  /** Mutations that matter to a reader: nodes added or removed, text, ARIA, role and state attributes. */
  dom: number
  /** class and style changes, which only the pixels can tell apart from bookkeeping. */
  style: number
  /** Pixels of the window that changed by at least 32 in a channel, outside those that change on their own. */
  pixels: number
  /** Where focus went, when it left the body. */
  focus?: InPageElement | undefined
  /** How far the window scrolled. */
  scroll?: { x: number; y: number } | undefined
  /** The address changed (a fragment, pushState). */
  url?: boolean | undefined
  /** window.open, form submission, a modal dialog, history entries, navigations the guard answered, browser dialogs. */
  events: string[]
  samples: ChangeSample[]
}

export interface KeyTrial {
  key: string
  /** The first press, with focus on the body. */
  first: KeyChange
  /** A wait of the same length with no key, just before the second press. */
  control?: KeyChange | undefined
  /** The second press. */
  second?: KeyChange | undefined
}

export interface SettingTrial extends InPageElement {
  kind: 'checkbox' | 'switch' | 'radio'
  /** Its label and the text around it that named it a shortcut setting, cut to 160 characters. */
  context: string
  /** Space changed its state. */
  toggled: boolean
  /** Each key that changed the page, pressed again with the setting toggled. */
  keys: Array<{ key: string; change: KeyChange }>
  /** Space put it back as it was. */
  restored: boolean
}

export interface HiddenSetting extends InPageElement {
  context: string
  /** The outermost element that hides it, and its text. */
  container?: (InPageElement & { text: string }) | undefined
}

export interface ShortcutsData {
  viewport: { width: number; height: number }
  /** keydown, keyup and keypress listeners the page registered, read over the DevTools protocol; null when that failed. */
  listeners: { keydown: number; keyup: number; keypress: number } | null
  /** Printable keys pressed with focus on the body. */
  pressed: number
  /** The wait with no key before the first key, three times: what changes on its own. */
  idle: { dom: number; pixels: number }
  /** Keys whose first press changed anything, with the confirmation. */
  keys: KeyTrial[]
  /** Settings named for shortcuts that the probe could reach and toggle with Space. */
  settings: SettingTrial[]
  /** Settings named for shortcuts that are not showing (a closed dialog or menu). */
  hidden: HiddenSetting[]
  /** Selects named for shortcuts: found, not exercised. */
  selects: Array<InPageElement & { context: string }>
  /** Showing controls whose name points to settings, or that control a hidden setting's container. */
  openers: Array<InPageElement & { why: 'name' | 'controls' }>
  /** Showing text that speaks of shortcuts or keys ("press + to add"). */
  instructions: string[]
  /** The names of every showing control, when there are at most 25 of them. */
  controls?: string[] | undefined
  controlCount: number
  /** aria-keyshortcuts values on the page. */
  documented: string[]
  end: 'complete' | 'time' | 'no-listeners' | 'focus-stuck'
}

interface Window$ {
  __rampaKit: { describe(el: Element): InPageElement; visible(el: Element): boolean; deepActive(): Element | null; drain(): Array<{ type: string; at: number }> }
  __rampaSelf?: boolean
  __rampaKeys?: {
    toBody(): boolean
    begin(): { x: number; y: number; url: string }
    end(args: { noise: boolean; x: number; y: number; url: string }): Omit<KeyChange, 'pixels' | 'events'>
  }
  __rampaSettings?: Element[]
  __rampaRestore?: Element[]
}

/**
 * Runs in the page; needs the kit. A mutation observer that records between begin() and end(): end() sums what
 * changed outside the elements that changed on their own (noise). With `noise` (a wait with no key), what changed
 * is also marked as noise, so later windows leave it out.
 */
export function installKeyWatch(): void {
  const w = window as unknown as Window$
  if (w.__rampaKeys) return
  const kit = w.__rampaKit
  const STATE = /^(aria-|role$|hidden$|open$|checked$|selected$|disabled$|value$|src$|href$|inert$|title$|alt$|tabindex$|contenteditable$)/
  const SKIP = new Set(['script', 'style', 'link', 'meta', 'noscript', 'template', 'title', 'head', 'base'])
  const noise = new WeakSet<Node>()
  let records: MutationRecord[] = []
  let recording = false
  const observer = new MutationObserver((list) => {
    if (recording) records.push(...list)
  })
  observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true, characterDataOldValue: true })
  const elementOf = (node: Node): Element | null => (node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement)
  const inNoise = (node: Node): boolean => {
    for (let n: Node | null = node, i = 0; n && i < 40; n = n.parentNode, i++) if (noise.has(n)) return true
    return false
  }
  const skipped = (node: Node): boolean => {
    const el = elementOf(node)
    return !el || SKIP.has(el.localName) || el.closest('head') !== null
  }
  w.__rampaKeys = {
    // Focus back to the body; false when a field keeps it (a script that refocuses it), and then no key is pressed.
    toBody() {
      w.__rampaSelf = true
      try {
        for (let i = 0; i < 3; i++) {
          const active = kit.deepActive() as HTMLElement | null
          if (!active) return true
          active.blur()
          ;(document.activeElement as HTMLElement | null)?.blur?.()
        }
      } finally {
        w.__rampaSelf = false
      }
      return kit.deepActive() === null
    },
    begin() {
      observer.takeRecords()
      records = []
      recording = true
      return { x: window.scrollX, y: window.scrollY, url: location.href }
    },
    end(args) {
      records.push(...observer.takeRecords())
      recording = false
      let dom = 0
      let style = 0
      const samples: ChangeSample[] = []
      const sample = (el: Element | null, what: string) => {
        if (!el || samples.length >= 3 || el === document.documentElement) return
        const d = kit.describe(el)
        samples.push({ ref: d.ref, id: d.id, tag: d.tag, label: d.label, what })
      }
      for (const record of records) {
        const target = record.target
        if (skipped(target) || inNoise(target)) continue
        if (record.type === 'childList') {
          const nodes = [...Array.from(record.addedNodes), ...Array.from(record.removedNodes)]
          for (const node of nodes) {
            const meaningful =
              (node.nodeType === Node.ELEMENT_NODE && !SKIP.has((node as Element).localName)) || (node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() !== '')
            if (!meaningful) continue
            if (args.noise) {
              // What a page adds to its body on its own (a toast, an ad) is noise; the body itself is not.
              const parent = elementOf(target)
              noise.add(parent && parent !== document.body && parent !== document.documentElement ? target : node)
            }
            dom++
            const added = Array.from(record.addedNodes).includes(node)
            sample(node.nodeType === Node.ELEMENT_NODE ? (node as Element) : elementOf(target), added ? 'added' : 'removed')
          }
        } else if (record.type === 'characterData') {
          if ((target.textContent ?? '').trim() === '' && (record.oldValue ?? '').trim() === '') continue
          if (args.noise) noise.add(elementOf(target) ?? target)
          dom++
          sample(elementOf(target), 'text')
        } else if (record.type === 'attributes') {
          const name = record.attributeName ?? ''
          if (STATE.test(name)) {
            if (args.noise) noise.add(target)
            dom++
            sample(target as Element, name)
          } else if (name === 'class' || name === 'style') {
            if (args.noise) noise.add(target)
            style++
          }
        }
      }
      records = []
      const active = kit.deepActive()
      const scroll = { x: window.scrollX - args.x, y: window.scrollY - args.y }
      return {
        dom,
        style,
        ...(active ? { focus: kit.describe(active) } : {}),
        ...(scroll.x !== 0 || scroll.y !== 0 ? { scroll } : {}),
        ...(location.href !== args.url ? { url: true } : {}),
        samples,
      }
    },
  }
}

/** Runs in the page: takes focus back to the body; false when a field keeps it (a script that refocuses it). */
export function toBody(): boolean {
  const w = window as unknown as Window$
  const kit = w.__rampaKit
  w.__rampaSelf = true
  try {
    for (let i = 0; i < 3; i++) {
      const active = kit.deepActive() as HTMLElement | null
      if (!active) return true
      active.blur()
      ;(document.activeElement as HTMLElement | null)?.blur?.()
    }
  } finally {
    w.__rampaSelf = false
  }
  return kit.deepActive() === null
}

/**
 * Runs in the page; needs the kit. Settings named for shortcuts or keys (showing ones the probe can toggle, hidden
 * ones it lists), selects, controls that may lead to settings, text about shortcuts, and every control's name on a
 * small page.
 */
export function findShortcutSettings(args: { budget: number }): Omit<ShortcutsData, 'viewport' | 'listeners' | 'pressed' | 'idle' | 'keys' | 'settings' | 'end'> & {
  settings: Array<Omit<SettingTrial, 'toggled' | 'keys' | 'restored'> & { i: number }>
} {
  const w = window as unknown as Window$
  const kit = w.__rampaKit
  const collapse = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim()
  const cut = (value: string, n: number) => (value.length > n ? `${value.slice(0, n - 1)}…` : value)
  const SHORTCUT = /\b(shortcuts?|hot ?keys?|access ?keys?|keyboard|keys?|key ?bindings?|keybindings?|ctrl|control key|atalhos?|teclas?|teclado|atajos?|raccourcis?|tastenk[uü]rzel)\b/i
  const SETTINGS = /\b(shortcuts?|keyboard|hot ?keys?|settings|preferences|customi[sz]e|atalhos?|teclado|configura[cç][oõ]es|prefer[eê]ncias|ajustes|atajos?|configuraci[oó]n|preferencias)\b/i
  const INSTRUCTION = /\b(shortcuts?|hot ?keys?|keyboard|press|pressione|aperte|tecle|presione|pulse|atalhos?|atajos?)\b/i
  const textOf = (el: Element) => collapse((el as HTMLElement).innerText ?? el.textContent)
  const nameOf = (el: Element): string => {
    const labelled = collapse(
      (el.getAttribute('aria-labelledby') ?? '')
        .split(/\s+/)
        .filter(Boolean)
        .map((id) => document.getElementById(id)?.textContent ?? '')
        .join(' '),
    )
    const labels = el instanceof HTMLInputElement || el instanceof HTMLSelectElement ? Array.from(el.labels ?? []).map((l) => collapse(l.textContent)).join(' ') : ''
    return collapse(el.getAttribute('aria-label') || labelled || labels || (el instanceof HTMLInputElement && ['button', 'submit', 'reset'].includes(el.type) ? el.value : '') || textOf(el) || el.getAttribute('title') || '')
  }
  // The label and the text around a setting: the fieldset's legend, and the nearest ancestor with a little text.
  const contextOf = (el: Element): string => {
    const parts = [nameOf(el)]
    const legend = el.closest('fieldset')?.querySelector('legend')
    if (legend) parts.push(collapse(legend.textContent))
    for (let a = el.parentElement, n = 0; a && n < 3 && a !== document.body; a = a.parentElement, n++) {
      const text = collapse(a.textContent)
      if (text.length > 0 && text.length <= 300) {
        parts.push(text)
        break
      }
    }
    return cut(collapse(parts.join(' · ')), 160)
  }
  const sensitiveForm = (el: Element): boolean => {
    const form = el.closest('form')
    return form !== null && form.querySelector('input[type=password],input[type=file],[autocomplete^="cc-"]') !== null
  }
  const outermostHidden = (el: Element): Element | null => {
    let hidden: Element | null = null
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) if (!kit.visible(a)) hidden = a
    return hidden
  }

  const settings: Array<Omit<SettingTrial, 'toggled' | 'keys' | 'restored'> & { i: number }> = []
  const hidden: HiddenSetting[] = []
  const selects: Array<InPageElement & { context: string }> = []
  const containers: Element[] = []
  w.__rampaSettings = []
  w.__rampaRestore = []
  const CANDIDATES = 'input[type=checkbox],input[type=radio],[role=switch],[role=checkbox],[role=menuitemcheckbox],[role=radio],select'
  for (const el of Array.from(document.querySelectorAll(CANDIDATES))) {
    if ((el as HTMLInputElement).disabled || el.getAttribute('aria-disabled') === 'true' || sensitiveForm(el)) continue
    const context = contextOf(el)
    if (!SHORTCUT.test(context)) continue
    const showing = kit.visible(el) && el.getBoundingClientRect().width > 0
    if (!showing) {
      if (hidden.length >= 10) continue
      const box = outermostHidden(el)
      if (box && !containers.includes(box)) containers.push(box)
      hidden.push({ ...kit.describe(el), label: cut(nameOf(el), 80), context, ...(box ? { container: { ...kit.describe(box), text: cut(textOf(box) || collapse(box.textContent), 160) } } : {}) })
      continue
    }
    if (el.localName === 'select') {
      if (selects.length < 5) selects.push({ ...kit.describe(el), label: cut(nameOf(el), 80), context })
      continue
    }
    if (settings.length >= args.budget) continue
    const role = el.getAttribute('role')
    const isRadio = (el as HTMLInputElement).type === 'radio' || role === 'radio'
    // A radio group is toggled by choosing another radio of it, and put back by choosing the one that was checked.
    let target: Element = el
    let restore: Element = el
    if (isRadio) {
      const name = (el as HTMLInputElement).name
      const group = name ? Array.from(document.querySelectorAll(`input[type=radio][name="${CSS.escape(name)}"]`)) : [el]
      const checked = group.find((r) => (r as HTMLInputElement).checked) ?? el
      const other = group.find((r) => r !== checked && kit.visible(r) && !(r as HTMLInputElement).disabled)
      if (!other || settings.some((s) => s.ref === kit.describe(checked).ref)) continue
      target = other
      restore = checked
    }
    const i = w.__rampaSettings.length
    w.__rampaSettings.push(target)
    w.__rampaRestore.push(restore)
    settings.push({ ...kit.describe(target), label: cut(nameOf(target), 80), kind: isRadio ? 'radio' : role === 'switch' ? 'switch' : 'checkbox', context, i })
  }

  // Showing controls that may lead to settings: named for them, or controlling a hidden setting's container.
  const CONTROLS = 'a[href],button,summary,input[type=button],[role=button],[role=link],[role=menuitem],[role=tab]'
  const showingControls = Array.from(document.querySelectorAll(CONTROLS)).filter((el) => kit.visible(el) && el.getBoundingClientRect().width > 0)
  const openers: ShortcutsData['openers'] = []
  const refersTo = (el: Element, box: Element): boolean => {
    const id = box.id
    const ids = ['aria-controls', 'aria-owns', 'popovertarget', 'commandfor'].flatMap((name) => (el.getAttribute(name) ?? '').split(/\s+/).filter(Boolean))
    const targets = ['data-target', 'data-bs-target', 'href'].map((name) => el.getAttribute(name) ?? '').filter((v) => v.startsWith('#'))
    if (id && (ids.includes(id) || targets.includes(`#${id}`))) return true
    // The summary of a closed details element opens it.
    return el.localName === 'summary' && el.parentElement === box
  }
  for (const el of showingControls) {
    if (openers.length >= 15) break
    // A switch or checkbox named for shortcuts is a setting, tried as one, not a way to one.
    if (el.matches(CANDIDATES)) continue
    const name = nameOf(el)
    if (containers.some((box) => refersTo(el, box) || (box.localName === 'details' && el.localName === 'summary' && box.contains(el)))) openers.push({ ...kit.describe(el), label: cut(name, 80), why: 'controls' })
    // A control's name, not a sentence: "Keyboard shortcuts", "Settings", not a paragraph that mentions settings.
    else if (name.length > 0 && name.length <= 60 && SETTINGS.test(name) && !openers.some((o) => o.label === name)) openers.push({ ...kit.describe(el), label: cut(name, 80), why: 'name' })
  }

  // Showing text about shortcuts: an instruction ("press + to add"), a link to a shortcuts page.
  const instructions: string[] = []
  for (const el of Array.from(document.body?.querySelectorAll('p,li,label,span,div,dt,dd,td,h1,h2,h3,h4,h5,h6,kbd') ?? [])) {
    if (instructions.length >= 8) break
    let own = ''
    for (const node of Array.from(el.childNodes)) if (node.nodeType === Node.TEXT_NODE) own += node.textContent ?? ''
    if (!INSTRUCTION.test(own) || !kit.visible(el)) continue
    const text = cut(textOf(el), 200)
    if (text && !instructions.includes(text)) instructions.push(text)
  }
  const names = showingControls.map((el) => cut(nameOf(el), 80)).filter(Boolean)
  const documented = [...new Set(Array.from(document.querySelectorAll('[aria-keyshortcuts]')).map((el) => cut(collapse(el.getAttribute('aria-keyshortcuts')), 40)))].slice(0, 10)
  return {
    settings,
    hidden,
    selects,
    openers,
    instructions,
    ...(showingControls.length <= 25 ? { controls: names } : {}),
    controlCount: showingControls.length,
    documented,
  }
}

/** Runs in the page: a setting's state (checked, aria-checked, aria-pressed), to see that Space toggled it. */
export function settingState(args: { i: number; restore: boolean }): string {
  const w = window as unknown as Window$
  const el = (args.restore ? w.__rampaRestore : w.__rampaSettings)?.[args.i]
  if (!el?.isConnected) return 'gone'
  const input = el as HTMLInputElement
  return [typeof input.checked === 'boolean' ? String(input.checked) : '', el.getAttribute('aria-checked') ?? '', el.getAttribute('aria-pressed') ?? ''].join('|')
}

/** Runs in the page: gives a setting focus, as a script would, so Space toggles it. */
export function focusSetting(args: { i: number; restore: boolean }): boolean {
  const w = window as unknown as Window$
  const el = (args.restore ? w.__rampaRestore : w.__rampaSettings)?.[args.i] as HTMLElement | undefined
  if (!el?.isConnected) return false
  w.__rampaSelf = true
  try {
    el.focus({ preventScroll: false })
  } finally {
    w.__rampaSelf = false
  }
  return w.__rampaKit.deepActive() === el
}

/** Pixels that changed by PIXEL_DELTA in a channel, outside the noise mask. */
export function changedPixels(a: RgbaImage, b: RgbaImage, mask?: Uint8Array): number {
  if (a.width !== b.width || a.height !== b.height) return a.width * a.height
  let count = 0
  const total = a.width * a.height
  for (let i = 0; i < total; i++) {
    if (mask?.[i]) continue
    const at = i * 4
    const delta = Math.max(Math.abs((a.data[at] ?? 0) - (b.data[at] ?? 0)), Math.abs((a.data[at + 1] ?? 0) - (b.data[at + 1] ?? 0)), Math.abs((a.data[at + 2] ?? 0) - (b.data[at + 2] ?? 0)))
    if (delta >= PIXEL_DELTA) count++
  }
  return count
}

/** Marks in `mask` the pixels that differ between two captures of the same state, with a margin around each. */
export function addNoise(mask: Uint8Array, a: RgbaImage, b: RgbaImage, margin = NOISE_MARGIN): number {
  if (a.width !== b.width || a.height !== b.height) return 0
  const changedAt: number[] = []
  for (let i = 0; i < a.width * a.height; i++) {
    const at = i * 4
    const delta = Math.max(Math.abs((a.data[at] ?? 0) - (b.data[at] ?? 0)), Math.abs((a.data[at + 1] ?? 0) - (b.data[at + 1] ?? 0)), Math.abs((a.data[at + 2] ?? 0) - (b.data[at + 2] ?? 0)))
    if (delta >= PIXEL_DELTA) changedAt.push(i)
  }
  let count = 0
  for (const i of changedAt) {
    const x = i % a.width
    const y = Math.floor(i / a.width)
    for (let yy = Math.max(0, y - margin); yy <= Math.min(a.height - 1, y + margin); yy++) {
      for (let xx = Math.max(0, x - margin); xx <= Math.min(a.width - 1, x + margin); xx++) {
        const j = yy * a.width + xx
        if (!mask[j]) {
          mask[j] = 1
          count++
        }
      }
    }
  }
  return count
}

class FocusStuck extends Error {}

/** Runs in the page: focus back to the body, hook events of earlier windows dropped, recording on. */
export function startWindow(): { x: number; y: number; url: string } | null {
  const w = window as unknown as Window$
  if (!w.__rampaKeys?.toBody()) return null
  w.__rampaKit.drain()
  return w.__rampaKeys?.begin() ?? { x: window.scrollX, y: window.scrollY, url: location.href }
}

/** Runs in the page: recording off, what changed, and the hook events (window.open, submit, modal, history). */
export function endWindow(args: { noise: boolean; x: number; y: number; url: string }): {
  end: Omit<KeyChange, 'pixels' | 'events'> | undefined
  hooks: Array<{ type: string; at: number }>
} {
  const w = window as unknown as Window$
  const end = w.__rampaKeys?.end(args)
  return { end, hooks: w.__rampaKit.drain() }
}

/** One page under test: the rest state's capture, the noise mask, and the measurement of one window. */
class KeySession {
  readonly page: Page
  private readonly probe: ProbePage
  private readonly cdp: CDPSession | undefined
  private rest: RgbaImage | undefined
  private box: { width: number; height: number; scale: number } | undefined
  mask: Uint8Array | undefined

  constructor(probe: ProbePage, cdp: CDPSession | undefined) {
    this.page = probe.page
    this.probe = probe
    this.cdp = cdp
  }

  /** The window at half its CSS size, over the DevTools protocol: a quarter of the pixels to encode and compare. */
  async capture(): Promise<RgbaImage | undefined> {
    try {
      if (!this.cdp) return decodePng(await this.page.screenshot({ scale: 'css', caret: 'hide' }))
      this.box ??= await this.page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight, scale: window.devicePixelRatio || 1 }))
      const box = this.box
      const shot = await this.cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: box.width, height: box.height, scale: 0.5 / box.scale } })
      return decodePng(Buffer.from(shot.data, 'base64'))
    } catch {
      return undefined
    }
  }

  /** The page as it is now is the rest state the next window is compared with (after a setting was toggled). */
  async settle(): Promise<void> {
    await this.page.evaluate(toBody)
    await this.page.evaluate(settleInPage, RESTORE_SETTLE)
    this.rest = await this.capture()
  }

  /** What the page does on its own in IDLE_ROUNDS waits: changed elements become noise, changed pixels the mask. */
  async idle(): Promise<{ dom: number; pixels: number }> {
    if (!(await this.page.evaluate(toBody))) throw new FocusStuck('a field keeps focus')
    let dom = 0
    let pixels = 0
    let before = await this.capture()
    if (before) this.mask = new Uint8Array(before.width * before.height)
    for (let round = 0; round < IDLE_ROUNDS; round++) {
      const begin = await this.page.evaluate(() => (window as unknown as Window$).__rampaKeys?.begin() ?? { x: 0, y: 0, url: '' })
      await this.page.waitForTimeout(IDLE_MS)
      const end = await this.page.evaluate((args) => (window as unknown as Window$).__rampaKeys?.end(args), { ...begin, noise: true })
      dom += end?.dom ?? 0
      const after = await this.capture()
      if (before && after && this.mask) pixels += addNoise(this.mask, before, after)
      before = after
    }
    this.rest = before
    return { dom, pixels }
  }

  /**
   * One window of OBSERVE_MS with focus on the body: a key pressed at its start, or none (`key` null) to see what
   * the page does on its own. After a change, Esc, focus back to the body and the scroll put back.
   */
  async window(key: string | null): Promise<KeyChange> {
    const page = this.page
    const from = this.probe.guard.now()
    // Focus back to the body, hook events of earlier windows dropped, recording on: one round trip.
    const start = await page.evaluate(startWindow)
    if (!start) throw new FocusStuck('a field keeps focus')
    const begin = start
    if (key !== null) await page.keyboard.press(key)
    await page.waitForTimeout(OBSERVE_MS)
    const { end, hooks } = await page.evaluate(endWindow, { ...begin, noise: key === null })
    const to = this.probe.guard.now()
    const events = [
      ...hooks.filter((e) => ['open', 'submit', 'modal', 'history'].includes(e.type)).map((e) => e.type),
      ...this.probe.guard.log.navigations.filter((n) => n.at >= from && n.at <= to).map((n) => (n.cause === 'popup' ? 'popup' : 'navigation')),
      ...this.probe.guard.log.dialogs.filter((d) => d.at >= from && d.at <= to).map((d) => `dialog-${d.type}`),
    ]
    const after = await this.capture()
    const pixels = this.rest && after ? changedPixels(this.rest, after, this.mask) : 0
    // With no key pressed, whatever moved is the page's own doing: those pixels are left out from now on.
    if (key === null && this.rest && after && this.mask) addNoise(this.mask, this.rest, after)
    const change: KeyChange = {
      dom: end?.dom ?? 0,
      style: end?.style ?? 0,
      pixels,
      ...(end?.focus ? { focus: end.focus } : {}),
      ...(end?.scroll ? { scroll: end.scroll } : {}),
      ...(end?.url ? { url: true } : {}),
      events: [...new Set(events)],
      samples: end?.samples ?? [],
    }
    if (worthConfirming(change)) {
      await page.keyboard.press('Escape')
      await page.evaluate(toBody)
      await page.evaluate((at) => window.scrollTo({ left: at.x, top: at.y, behavior: 'instant' as ScrollBehavior }), begin)
      await page.evaluate(settleInPage, RESTORE_SETTLE)
      // A change that stays (an item added to a list) is the new rest state.
      this.rest = await this.capture()
      await page.evaluate(() => (window as unknown as Window$).__rampaKit.drain())
    } else this.rest = after ?? this.rest
    return change
  }
}

/** Anything at all changed: after such a window the page is put back (Esc, focus, scroll). */
export function anyChange(change: KeyChange): boolean {
  return change.dom > 0 || change.pixels > 0 || change.focus !== undefined || change.scroll !== undefined || change.url === true || change.events.length > 0
}

/** A change worth a second press: anything but a few stray pixels. The rule decides what counts. */
export function worthConfirming(change: KeyChange): boolean {
  return change.dom > 0 || change.pixels >= SCREEN_PIXELS || change.focus !== undefined || change.scroll !== undefined || change.url === true || change.events.length > 0
}

/** Keys with an effect other than pixels first, then by how many pixels changed: what the confirmation budget goes to. */
function strength(trial: KeyTrial): number {
  const c = trial.first
  const signals = (c.dom > 0 ? 1 : 0) + (c.focus ? 1 : 0) + (c.scroll ? 1 : 0) + (c.url ? 1 : 0) + c.events.length
  return signals * 1_000_000_000 + c.pixels
}

/** keydown, keyup and keypress listeners anywhere in the page, read over the DevTools protocol. */
async function keyListeners(probe: ProbePage): Promise<ShortcutsData['listeners']> {
  try {
    const cdp = await probe.context.newCDPSession(probe.page)
    try {
      const counts = { keydown: 0, keyup: 0, keypress: 0 }
      for (const expression of ['window', 'document']) {
        const { result } = await cdp.send('Runtime.evaluate', { expression })
        if (!result.objectId) continue
        const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId, depth: expression === 'document' ? -1 : 0, pierce: true })
        for (const listener of listeners) if (listener.type in counts) counts[listener.type as keyof typeof counts]++
      }
      return counts
    } finally {
      await cdp.detach().catch(() => undefined)
    }
  } catch {
    return null
  }
}

/** 2.1.4: every printable key with focus on the body, the confirmation, then the settings. */
export async function runShortcutsProbe(browser: Browser, url: string, options: ProbeOptions): Promise<ProbeRecord> {
  const started = Date.now()
  const deadline = started + TIME_BUDGET_MS
  const probe = await openProbePage(browser, url, options, { variant: 'character-keys' })
  try {
    const page = probe.page
    await page.evaluate(installKeyWatch)
    const viewport = page.viewportSize() ?? probe.conditions.viewport
    const listeners = await keyListeners(probe)
    const data: ShortcutsData = {
      viewport,
      listeners,
      pressed: 0,
      idle: { dom: 0, pixels: 0 },
      keys: [],
      settings: [],
      hidden: [],
      selects: [],
      openers: [],
      instructions: [],
      controlCount: 0,
      documented: [],
      end: 'complete',
    }
    // Shortcuts are wired by scripts that may load after the page settles: give them a moment of network quiet.
    await page.waitForLoadState('networkidle', { timeout: NETWORK_QUIET_MS }).catch(() => undefined)
    const found = await page.evaluate(findShortcutSettings, { budget: SETTING_BUDGET })
    const { settings: candidates, ...rest } = found
    Object.assign(data, rest)
    const cdp = await probe.context.newCDPSession(page).catch(() => undefined)
    const session = new KeySession(probe, cdp)
    try {
      if (listeners && listeners.keydown + listeners.keyup + listeners.keypress === 0) data.end = 'no-listeners'
      else {
        data.idle = await session.idle()
        // First round: every key once.
        for (const [n, key] of PRINTABLE_KEYS.entries()) {
          if (Date.now() > deadline) {
            data.end = 'time'
            break
          }
          // Now and then a wait with no key, to learn what the page changes on its own (a clock, a carousel).
          if (n > 0 && n % LEARN_EVERY === 0) await session.window(null)
          const first = await session.window(key)
          data.pressed++
          if (worthConfirming(first)) data.keys.push({ key, first })
        }
        // The keys with the clearest effect are confirmed first; a page full of stray pixels cannot crowd them out.
        data.keys.sort((a, b) => strength(b) - strength(a))
        // Second round: each key that changed something, after a wait of the same length with no key.
        for (const trial of data.keys.slice(0, CONFIRM_BUDGET)) {
          if (Date.now() > deadline) {
            data.end = 'time'
            break
          }
          trial.control = await session.window(null)
          trial.second = await session.window(trial.key)
        }
        // Settings: toggle each, press the keys that changed the page again, toggle it back.
        const active = data.keys.filter((t) => t.second && worthConfirming(t.second) && !(t.control && anyChange(t.control))).slice(0, KEYS_PER_SETTING)
        if (active.length > 0) {
          for (const candidate of candidates) {
            if (Date.now() > deadline) {
              data.end = 'time'
              break
            }
            const { i, ...described } = candidate
            const before = await page.evaluate(settingState, { i, restore: false })
            const focused = await page.evaluate(focusSetting, { i, restore: false })
            if (focused) await page.keyboard.press('Space')
            await page.waitForTimeout(150)
            const after = await page.evaluate(settingState, { i, restore: false })
            const toggled = focused && before !== after && after !== 'gone'
            const keys: SettingTrial['keys'] = []
            // The toggled setting looks different now: that is the rest state the keys are compared with.
            await session.settle()
            if (toggled) for (const trial of active) keys.push({ key: trial.key, change: await session.window(trial.key) })
            let restored = !toggled
            if (toggled) {
              // Space again on a checkbox or switch; on a radio group, Space on the radio that was checked.
              if (await page.evaluate(focusSetting, { i, restore: true })) await page.keyboard.press('Space')
              await page.waitForTimeout(150)
              restored = (await page.evaluate(settingState, { i, restore: false })) === before
            }
            await session.settle()
            data.settings.push({ ...described, toggled, keys, restored })
          }
        }
      }
    } catch (error) {
      if (!(error instanceof FocusStuck)) throw error
      data.end = 'focus-stuck'
    } finally {
      await cdp?.detach().catch(() => undefined)
    }
    const reason =
      data.end === 'time'
        ? `time budget reached (${TIME_BUDGET_MS / 1000} s)`
        : data.end === 'focus-stuck'
          ? 'focus could not be taken back to the body, so no key was pressed into a field'
          : data.keys.length > CONFIRM_BUDGET
            ? `confirmation budget reached (${CONFIRM_BUDGET} of ${data.keys.length})`
            : undefined
    return {
      kind: 'shortcuts',
      version: SHORTCUTS_VERSION,
      conditions: { ...probe.conditions, viewport },
      status: reason ? 'partial' : 'complete',
      ...(reason ? { reason } : {}),
      guard: probe.guard.log,
      durationMs: Date.now() - started,
      data,
    }
  } finally {
    await probe.context.close()
  }
}

/** The shortcuts probe as a step of the probe stage; a probe that fails leaves a skipped record. */
export async function shortcutsProbe(browser: Browser, url: string, options: ProbeOptions): Promise<ProbeRecord[]> {
  const started = Date.now()
  try {
    return [await runShortcutsProbe(browser, url, options)]
  } catch (error) {
    return [skippedRecord('shortcuts', SHORTCUTS_VERSION, 'character-keys', `probe failed: ${(error instanceof Error ? error.message : String(error)).split('\n')[0]}`, Date.now() - started)]
  }
}
