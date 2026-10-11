import type { Browser } from 'playwright-core'
import type { A11yNode, ProbeRecord } from '../snapshot/schema.ts'
import type { TreeIndex } from '../snapshot/tree.ts'
import { type ControlFacts, Harness, type HarnessAction, type SkipReason, type Watch, destructiveWord, skipReason } from './activate.ts'
import { matchNode } from './identity.ts'
import type { InPageElement, InPageIdentity } from './kit.ts'
import { type ProbeOptions, type ProbePage, skippedRecord } from './page.ts'

/**
 * On Input (3.2.2), on the activate-class harness (activate.ts). For each form control that shows (at most 40, a
 * radio group counting once), on a fresh load of its own, the probe gives it focus (what focus alone does is 3.2.1's),
 * waits with no input, then changes its value the least surprising way: another option of a select, Space on a
 * checkbox or on another radio of the group, one character typed into a text field, one arrow key on a slider or a
 * date. A field whose change event fires when it is left is then left. It never submits, never presses Enter, and the
 * guard is on: a navigation is intercepted, a window is not opened, a submission is cancelled, all recorded. When a
 * change of context followed, a second fresh load repeats the change. The texts around each control that may warn of
 * what a change does are recorded for the 3.2.2 judgment, which may only clear a finding by quoting one.
 */

export const INPUT_VERSION = '1'
/** Controls changed per page (a radio group counts once), and time. */
export const INPUT_LIMITS = { controls: 40, timeMs: 180_000 }
const MAX_LISTED = 100
/** Changes of context confirmed on a second load, at most. */
const MAX_CONFIRM = 10
/** The wait with no input after focus, before the change. */
const IDLE_MS = 800

export type ControlKind = 'select' | 'checkbox' | 'radio' | 'text' | 'number' | 'range' | 'date' | 'textarea'

export interface Choice {
  i: number
  label: string
  selected: boolean
  disabled: boolean
  /** A radio of the group: where it is. */
  ref?: string | undefined
  id?: InPageIdentity | undefined
}

export interface InputTrial {
  /** What the probe did: `selected "Brasil"`, `pressed Space`, `typed "a"`, `pressed ArrowUp`. */
  action?: string | undefined
  /** The control took focus before the change. */
  focused?: boolean | undefined
  /** Its value or state changed. */
  changed?: boolean | undefined
  /** The wait with no input after focus. */
  idle?: Watch | undefined
  /** The window after the change. */
  input?: Watch | undefined
  /** For a field whose change event fires when it is left: the window after it was left. */
  commit?: Watch | undefined
  /** The same change on a second fresh load, when the first was followed by a change of context. */
  confirm?: Omit<InputTrial, 'confirm'> | undefined
  outcome?: 'not-exercised' | 'unmatched' | 'not-tried' | 'no-focus' | undefined
  cover?: (InPageElement & { text: string }) | undefined
  reason?: string | undefined
}

export interface InputControl extends InPageElement {
  control: ControlKind
  type?: string | undefined
  /** Clicked through its label: the control itself does not show (a styled checkbox). */
  via?: 'label' | undefined
  /** It takes digits (`type="tel"`, `type="number"`, `inputmode="numeric"`): a digit is typed, not a letter. */
  numeric?: boolean | undefined
  /** Texts around it that may say what a change does: its label, description, legend, the instructions near it. */
  texts: string[]
  /** select: its options; radio: the radios of its group. */
  choices?: Choice[] | undefined
  skip?: { reason: SkipReason | 'no-choice'; detail?: string | undefined } | undefined
  trial?: InputTrial | undefined
}

export interface InputData {
  viewport: { width: number; height: number }
  /** Form controls found that show (a radio group once). */
  found: number
  controls: InputControl[]
  /** Controls changed. */
  tried: number
  loads: number
  /** Sentences on the page that speak of what a change does ("reloads the page", "opens in a new window"). */
  notices: string[]
  actions: HarnessAction[]
  end: 'complete' | 'budget' | 'time'
}

/** Words of sentences that may warn of a change of context, in English, Portuguese and Spanish. */
export const NOTICE = /\b(reload|refresh|redirect|new (window|tab)|opens? in|take[s]? you|navigat|automatic|submit|updates? the page|change[sd]? the page|recarreg|atualiz|redirecion|nova (janela|aba|guia)|abr(e|irá) em|automaticamente|enviad|recarga|actualiz|redirig|nueva (ventana|pestaña)|se abre)/i

/** Runs in the page; needs the kit and the activate kit. The form controls that show, with what may warn of a change. */
export function findInputControls(args: { max: number; notice: string }): {
  found: number
  controls: Array<InputControl & { facts: ControlFacts }>
  notices: string[]
} {
  const w = window as unknown as {
    __rampaKit: { describe(el: Element): InPageElement; visible(el: Element): boolean }
    __rampaActivate: { facts(el: Element): ControlFacts }
  }
  const kit = w.__rampaKit
  const notice = new RegExp(args.notice, 'i')
  const collapse = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim()
  const cut = (value: string, n: number) => (value.length > n ? `${value.slice(0, n - 1)}…` : value)
  const textOf = (el: Element | null | undefined) => collapse((el as HTMLElement | null)?.innerText ?? el?.textContent)
  const showing = (el: Element) => kit.visible(el) && el.getBoundingClientRect().width > 0
  const labelOf = (el: Element): Element | undefined => Array.from((el as HTMLInputElement).labels ?? []).find((l) => showing(l))
  const nameOf = (el: Element): string => {
    const labelled = collapse(
      (el.getAttribute('aria-labelledby') ?? '')
        .split(/\s+/)
        .filter(Boolean)
        .map((id) => document.getElementById(id)?.textContent ?? '')
        .join(' '),
    )
    const labels = Array.from((el as HTMLInputElement).labels ?? []).map((l) => textOf(l)).join(' ')
    return collapse(el.getAttribute('aria-label') || labelled || labels || el.getAttribute('title') || el.getAttribute('placeholder') || '')
  }
  const FIELDS = 'select, input:not([type=hidden]), textarea, button'
  // Other controls than this one (and its radio group) inside an element.
  const others = (box: Element, el: Element): boolean => {
    const name = (el as HTMLInputElement).type === 'radio' ? (el as HTMLInputElement).name : ''
    return Array.from(box.querySelectorAll(FIELDS)).some((f) => f !== el && !(name && (f as HTMLInputElement).type === 'radio' && (f as HTMLInputElement).name === name))
  }
  // What may tell a person, before the change, what it does: the label, the description, the legend, the text of the
  // control's own block (up to the first ancestor that holds another control), and blocks of text just before it.
  const textsNear = (el: Element): string[] => {
    const texts = [nameOf(el)]
    for (const id of (el.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean)) texts.push(textOf(document.getElementById(id)))
    texts.push(collapse(el.getAttribute('title')))
    texts.push(textOf(el.closest('fieldset')?.querySelector('legend')))
    let block: Element = el
    for (let a = el.parentElement, n = 0; a && n < 4 && a !== document.body; a = a.parentElement, n++) {
      if (a.localName !== 'fieldset' && others(a, el)) break
      const text = textOf(a)
      if (text.length > 0 && text.length <= 400) texts.push(text)
      block = a
      if (a.localName === 'form' || a.localName === 'fieldset') break
    }
    for (let s = block.previousElementSibling, n = 0; s && n < 2; s = s.previousElementSibling, n++) {
      if (s.matches(FIELDS) || s.querySelector(FIELDS)) break
      const text = textOf(s)
      if (text.length > 0 && text.length <= 300 && showing(s)) texts.push(text)
    }
    return [...new Set(texts.map((t) => cut(t, 300)).filter(Boolean))].slice(0, 8)
  }
  const controls: Array<InputControl & { facts: ControlFacts }> = []
  const groups = new Set<string>()
  let found = 0
  for (const el of Array.from(document.querySelectorAll('select, input, textarea'))) {
    const input = el as HTMLInputElement
    const type = (el.getAttribute('type') ?? (el.localName === 'input' ? 'text' : '')).toLowerCase()
    let control: ControlKind
    if (el.localName === 'select') control = 'select'
    else if (el.localName === 'textarea') control = 'textarea'
    else if (type === 'checkbox' || type === 'radio') control = type
    else if (type === 'range') control = 'range'
    else if (type === 'number') control = 'number'
    else if (['date', 'time', 'datetime-local', 'month', 'week'].includes(type)) control = 'date'
    else if (['text', 'search', 'email', 'url', 'tel', '', 'password', 'file'].includes(type)) control = 'text'
    else continue
    if (input.readOnly) continue
    let via: 'label' | undefined
    if (!showing(el)) {
      // A styled checkbox or radio hides the input and shows its label.
      if ((control !== 'checkbox' && control !== 'radio') || !labelOf(el)) continue
      via = 'label'
    }
    let choices: Choice[] | undefined
    if (control === 'radio') {
      const name = input.name
      const key = `${input.form ? Array.from(document.forms).indexOf(input.form) : -1}|${name}`
      if (name) {
        if (groups.has(key)) continue
        groups.add(key)
      }
      const scope: ParentNode = input.form ?? document
      const group = name ? Array.from(scope.querySelectorAll(`input[type=radio][name="${CSS.escape(name)}"]`)) : [el]
      choices = group.map((radio, i) => ({
        i,
        label: cut(nameOf(radio), 80),
        selected: (radio as HTMLInputElement).checked,
        disabled: (radio as HTMLInputElement).disabled || !(showing(radio) || labelOf(radio) !== undefined),
        ref: kit.describe(radio).ref,
        id: kit.describe(radio).id,
      }))
    } else if (control === 'select') {
      choices = Array.from((el as HTMLSelectElement).options)
        .slice(0, 60)
        .map((option, i) => ({ i, label: cut(collapse(option.label || option.textContent), 80), selected: option.selected, disabled: option.disabled }))
    }
    found++
    if (controls.length >= args.max) continue
    const described = kit.describe(el)
    const numeric = type === 'tel' || type === 'number' || /^(numeric|decimal|tel)$/i.test(el.getAttribute('inputmode') ?? '')
    // A radio group is named by its legend when its radios are named by their own labels.
    const legend = control === 'radio' ? textOf(el.closest('fieldset')?.querySelector('legend')) : ''
    controls.push({
      ...described,
      // An unlabeled select is named by the option it shows, not by the text of all its options.
      label: cut(legend || nameOf(el) || (el.localName === 'select' ? collapse((el as HTMLSelectElement).selectedOptions[0]?.label) : '') || described.label, 80),
      control,
      ...(type ? { type } : {}),
      ...(via ? { via } : {}),
      ...(numeric ? { numeric: true } : {}),
      texts: textsNear(el),
      ...(choices ? { choices } : {}),
      facts: w.__rampaActivate.facts(el),
    })
  }
  // Sentences anywhere on the page that speak of what a change does.
  const notices: string[] = []
  for (const el of Array.from(document.body?.querySelectorAll('p,li,span,div,small,label,legend,dd,td,strong,em,h2,h3,h4') ?? [])) {
    if (notices.length >= 10) break
    let own = ''
    for (const node of Array.from(el.childNodes)) if (node.nodeType === Node.TEXT_NODE) own += node.textContent ?? ''
    if (!notice.test(own) || !showing(el)) continue
    const text = cut(textOf(el), 300)
    if (text && !notices.includes(text)) notices.push(text)
  }
  return { found, controls, notices }
}

/** The option or radio the probe chooses: the first one after the current that is enabled and not destructive. */
export function pickChoice(control: Pick<InputControl, 'control' | 'choices'>): Choice | undefined {
  const choices = control.choices ?? []
  const current = choices.findIndex((c) => c.selected)
  const order = [...choices.slice(current + 1), ...choices.slice(0, Math.max(0, current))]
  return order.find((c) => !c.selected && !c.disabled && c.label.trim() !== '' && destructiveWord(c.label) === undefined)
}

interface InputWindow {
  __rampaTarget?: Element | null
  __rampaSelf?: boolean
  __rampaKit: { deepActive(): Element | null }
}

/** Runs in the page: the located control's value and state, to see that the change took. */
export function readValue(): string {
  const el = (window as unknown as InputWindow).__rampaTarget as HTMLInputElement | HTMLSelectElement | null
  if (!el?.isConnected) return 'gone'
  const input = el as HTMLInputElement
  return [el.value, typeof input.checked === 'boolean' ? String(input.checked) : '', el instanceof HTMLSelectElement ? String(el.selectedIndex) : ''].join('|')
}

/** Runs in the page: gives the located control focus, as a script would; true when it has it. */
export function focusTarget(): boolean {
  const w = window as unknown as InputWindow
  const el = w.__rampaTarget as HTMLElement | null
  if (!el?.isConnected) return false
  w.__rampaSelf = true
  try {
    el.focus({ preventScroll: true })
  } finally {
    w.__rampaSelf = false
  }
  return w.__rampaKit.deepActive() === el
}

/** Runs in the page: the located control still has focus. */
export function hasFocus(): boolean {
  const w = window as unknown as InputWindow
  return w.__rampaTarget !== null && w.__rampaTarget !== undefined && w.__rampaKit.deepActive() === w.__rampaTarget
}

/** Runs in the page: takes focus off the located control, which fires its change event. */
export function blurTarget(): void {
  const w = window as unknown as InputWindow
  w.__rampaSelf = true
  try {
    ;(w.__rampaTarget as HTMLElement | null)?.blur()
  } finally {
    w.__rampaSelf = false
  }
}

/** Runs in the page: chooses an option of the located select, as a browser does (input, then change). */
export function chooseOption(args: { i: number }): boolean {
  const select = (window as unknown as InputWindow).__rampaTarget as HTMLSelectElement | null
  const option = select?.options[args.i]
  if (!select || !option) return false
  if (!select.multiple) select.selectedIndex = args.i
  else option.selected = true
  select.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
  select.dispatchEvent(new Event('change', { bubbles: true }))
  return true
}

/** Runs in the page: whether the located slider is at its maximum, so the arrow goes the other way. */
export function atMaximum(): boolean {
  const input = (window as unknown as InputWindow).__rampaTarget as HTMLInputElement | null
  if (!input) return false
  const max = input.max === '' ? 100 : Number(input.max)
  return Number(input.value) >= max
}

const TEXT_LIKE = new Set<ControlKind>(['text', 'number', 'textarea', 'date', 'range'])

/** One change of one control on a page of its own. */
async function tryControl(harness: Harness, control: InputControl, choice: Choice | undefined, fresh: boolean): Promise<Omit<InputTrial, 'confirm'>> {
  const probe = await harness.page(fresh)
  const page = probe.page
  // A radio is changed by checking another radio of its group.
  const target = control.control === 'radio' && choice?.ref && choice.id ? { ref: choice.ref, id: choice.id, label: choice.label } : control
  if (!(await harness.locate(probe, target))) return { outcome: 'unmatched' }
  const aimed = await harness.aim(probe, { ref: target.ref, label: target.label }, control.via === 'label' ? 'label' : 'target')
  if ('cover' in aimed) return { outcome: 'not-exercised', cover: aimed.cover }
  if ('hidden' in aimed) {
    harness.log('not-exercised', { ref: target.ref, label: target.label, detail: 'not showing on this load' })
    return { outcome: 'not-exercised', reason: 'not showing on this load' }
  }
  const before = await page.evaluate(readValue)
  // Focus first, as a person does before changing a setting; what focus alone does is 3.2.1's, not this criterion's.
  const focused = await page.evaluate(focusTarget)
  const keyed = control.control !== 'select' && !(control.via === 'label' && (control.control === 'checkbox' || control.control === 'radio'))
  if (keyed && !focused) {
    harness.log('not-exercised', { ref: target.ref, label: target.label, detail: 'took no focus' })
    return { outcome: 'no-focus', focused }
  }
  const idle = await harness.window(probe, async () => undefined, { ms: IDLE_MS, ref: target.ref, label: target.label })
  if (keyed && !(await page.evaluate(hasFocus))) {
    harness.log('not-exercised', { ref: target.ref, label: target.label, detail: 'focus moved away before the change' })
    return { outcome: 'no-focus', focused, idle, reason: 'focus moved away before the change' }
  }
  const { action, act } = await inputFor(probe, control, choice, aimed)
  harness.log('activate', { ref: target.ref, label: target.label, detail: action })
  const input = await harness.window(probe, act, { ref: target.ref, label: target.label })
  // The change event of a field fires when it is left: leave it, and see what that change did.
  const commit = TEXT_LIKE.has(control.control) && control.control !== 'range' ? await harness.window(probe, () => page.evaluate(blurTarget), { ref: target.ref, label: target.label }) : undefined
  const after = await page.evaluate(readValue).catch(() => 'gone')
  return { action, focused, changed: after !== before, idle, input, ...(commit ? { commit } : {}) }
}

/** The least surprising change for a control, and what it is called in the log. */
async function inputFor(probe: ProbePage, control: InputControl, choice: Choice | undefined, aimed: { x: number; y: number }): Promise<{ action: string; act: () => Promise<unknown> }> {
  const page = probe.page
  switch (control.control) {
    case 'select':
      return { action: `selected "${choice?.label ?? ''}"`, act: () => page.evaluate(chooseOption, { i: choice?.i ?? 0 }) }
    case 'checkbox':
    case 'radio':
      // A hidden input is toggled through its label, as a pointer would; a showing one with Space, as a keyboard would.
      if (control.control === 'radio') {
        const which = choice?.label ? ` "${choice.label}"` : ''
        return control.via === 'label'
          ? { action: `checked${which} through its label`, act: () => page.mouse.click(aimed.x, aimed.y) }
          : { action: `checked${which} with Space`, act: () => page.keyboard.press('Space') }
      }
      return control.via === 'label' ? { action: 'clicked its label', act: () => page.mouse.click(aimed.x, aimed.y) } : { action: 'pressed Space', act: () => page.keyboard.press('Space') }
    case 'range': {
      const key = (await page.evaluate(atMaximum)) ? 'ArrowLeft' : 'ArrowRight'
      return { action: `pressed ${key}`, act: () => page.keyboard.press(key) }
    }
    case 'date':
      return { action: 'pressed ArrowUp', act: () => page.keyboard.press('ArrowUp') }
    default: {
      const character = control.control === 'number' || control.numeric ? '1' : 'a'
      return { action: `typed "${character}"`, act: () => page.keyboard.type(character) }
    }
  }
}

// What a change did, as 3.2.2 reads it (rules/on-input.ts, criteria/on-input.ts).

export type ChangeKind = 'navigation' | 'new-window' | 'submission' | 'modal' | 'dialog' | 'focus' | 'route' | 'content' | 'focus-lost' | 'layer'
export type ChangeWeight = 'high' | 'medium' | 'review'

export interface ContextChange {
  kind: ChangeKind
  phase: 'input' | 'commit'
  weight: ChangeWeight
  /** The address, the form's action, the dialog's text, where focus went. */
  detail?: string | undefined
}

/** Visible text that changed, as a share of the page's, at which a change of content is large enough to look at. */
export const LARGE_CHANGE = { share: 0.5, characters: 200 }

/**
 * The changes of context in one window, as WCAG defines them (a change of user agent, viewport or focus, or of content
 * that changes the meaning of the page): a navigation, a new window, a submission or a modal dialog weigh most; a
 * browser dialog or focus moved by the page, less; an address set in place, a large change of content, focus lost to
 * the document or a layer that is not modal are for a person to judge. After a field was left, focus is not read: the
 * person moved it.
 */
export function contextChanges(watch: Watch | undefined, phase: 'input' | 'commit'): ContextChange[] {
  if (!watch) return []
  const changes: ContextChange[] = []
  const add = (kind: ChangeKind, weight: ChangeWeight, detail?: string) => changes.push({ kind, phase, weight, ...(detail ? { detail } : {}) })
  for (const n of watch.navigations ?? []) if (!n.same && !n.download) add('navigation', 'high', n.url)
  for (const url of watch.windows ?? []) add('new-window', 'high', url)
  for (const action of watch.submits ?? []) add('submission', 'high', action)
  if ((watch.modals ?? 0) > 0 || watch.opened?.modal) add('modal', 'high', watch.opened?.name)
  else if (watch.opened) add('layer', 'review', watch.opened.name)
  for (const dialog of watch.dialogs ?? []) add('dialog', 'medium', dialog)
  if (phase === 'input' && watch.focus) add('focus', 'medium', `<${watch.focus.tag}>${watch.focus.label ? ` "${watch.focus.label}"` : ''}`)
  if (phase === 'input' && watch.focusLost) add('focus-lost', 'review')
  if (watch.url && !watch.hashOnly) add('route', 'review', watch.url)
  const text = watch.text ?? { before: 0, changed: 0 }
  if ((watch.dom ?? 0) > 0 && text.changed >= LARGE_CHANGE.characters && text.changed >= LARGE_CHANGE.share * text.before) add('content', 'review', `${text.changed} of ${text.before} characters`)
  return changes
}

const WEIGHT_ORDER: ChangeWeight[] = ['high', 'medium', 'review']

export interface InputVerdict {
  control: InputControl
  node: A11yNode
  /** The strongest change of context the change was followed by. */
  change: ContextChange
  /** failure: it happened again on a second load, and not in the wait with no input; review: otherwise. */
  result: 'failure' | 'review'
  /** Why it is for review. */
  why?: 'once' | 'unconfirmed' | 'judge' | undefined
}

export interface InputVerdicts {
  verdicts: InputVerdict[]
  /** Controls changed whose facts match the snapshot. */
  applicable: number
  unmatched: number
  /** A change of context that also happened in the wait with no input: the page's own doing. */
  noisy: number
  /** The value did not change (a read-only widget, a key the field refused). */
  unchanged: number
}

/** 3.2.2's reading of the on-input probe's facts; the rule and the judgment read the same. */
export function inputVerdicts(data: Partial<InputData>, index: TreeIndex): InputVerdicts {
  const result: InputVerdicts = { verdicts: [], applicable: 0, unmatched: 0, noisy: 0, unchanged: 0 }
  for (const control of Array.isArray(data.controls) ? data.controls : []) {
    const trial = control?.trial
    if (!trial || trial.outcome || !trial.input) continue
    const node = matchNode(index, control.ref, control.id)
    if (!node) {
      result.unmatched++
      continue
    }
    result.applicable++
    if (trial.changed === false) {
      result.unchanged++
      continue
    }
    const idleKinds = new Set(contextChanges(trial.idle, 'input').map((c) => c.kind))
    const seen = [...contextChanges(trial.input, 'input'), ...contextChanges(trial.commit, 'commit')]
    const changes = seen.filter((c) => !idleKinds.has(c.kind))
    if (changes.length < seen.length && changes.length === 0) result.noisy++
    const strongest = [...changes].sort((a, b) => WEIGHT_ORDER.indexOf(a.weight) - WEIGHT_ORDER.indexOf(b.weight))[0]
    if (!strongest) continue
    if (strongest.weight === 'review') {
      result.verdicts.push({ control, node, change: strongest, result: 'review', why: 'judge' })
      continue
    }
    if (!trial.confirm || trial.confirm.outcome || !trial.confirm.input) {
      result.verdicts.push({ control, node, change: strongest, result: 'review', why: 'unconfirmed' })
      continue
    }
    const again = new Set([...contextChanges(trial.confirm.input, 'input'), ...contextChanges(trial.confirm.commit, 'commit')].map((c) => c.kind))
    result.verdicts.push(again.has(strongest.kind) ? { control, node, change: strongest, result: 'failure' } : { control, node, change: strongest, result: 'review', why: 'once' })
  }
  return result
}

/** Whether a trial was followed by a change of context worth confirming on a second load. */
function worthConfirming(trial: Omit<InputTrial, 'confirm'>): boolean {
  const idle = new Set(contextChanges(trial.idle, 'input').map((c) => c.kind))
  return [...contextChanges(trial.input, 'input'), ...contextChanges(trial.commit, 'commit')].some((c) => c.weight !== 'review' && !idle.has(c.kind))
}

/** 3.2.2: each form control changed once on a fresh load, and again when that changed the context. */
export async function runInputProbe(browser: Browser, url: string, options: ProbeOptions): Promise<ProbeRecord> {
  const limits = INPUT_LIMITS
  const harness = new Harness(browser, url, options, { kind: 'input', version: INPUT_VERSION, variant: 'on-input', limits })
  let data: InputData | undefined
  let conditions: ProbeRecord['conditions'] | undefined
  try {
    const first = await harness.page()
    conditions = first.conditions
    const viewport = first.page.viewportSize() ?? first.conditions.viewport
    const listed = await first.page.evaluate(findInputControls, { max: MAX_LISTED, notice: NOTICE.source })
    data = { viewport, found: listed.found, controls: [], tried: 0, loads: 0, notices: listed.notices, actions: [], end: 'complete' }
    let confirmed = 0
    for (const { facts, ...control } of listed.controls) {
      const entry: InputControl = control
      data.controls.push(entry)
      const skip = skipReason(facts, harness.origin)
      if (skip) {
        entry.skip = skip
        harness.skip(control, skip.reason, skip.detail)
        continue
      }
      const choice = control.control === 'select' || control.control === 'radio' ? pickChoice(control) : undefined
      if ((control.control === 'select' || control.control === 'radio') && !choice) {
        const destructive = (control.choices ?? []).some((c) => !c.selected && destructiveWord(c.label) !== undefined)
        entry.skip = { reason: destructive ? 'destructive' : 'no-choice', detail: destructive ? 'every other option' : 'no other option' }
        harness.skip(control, entry.skip.reason, entry.skip.detail)
        continue
      }
      if (data.tried >= limits.controls || !harness.timeLeft()) {
        if (data.end === 'complete') data.end = data.tried >= limits.controls ? 'budget' : 'time'
        entry.trial = { outcome: 'not-tried', reason: data.end }
        continue
      }
      data.tried++
      // The first control uses the page the list was read on, untouched; every other gets a fresh load.
      const trial: InputTrial = await tryControl(harness, control, choice, data.tried > 1)
      entry.trial = trial
      if (!trial.outcome && worthConfirming(trial) && confirmed < MAX_CONFIRM && harness.timeLeft()) {
        confirmed++
        trial.confirm = await tryControl(harness, control, choice, true)
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

/** The on-input probe as a step of the probe stage; a probe that fails leaves a skipped record. */
export async function inputProbe(browser: Browser, url: string, options: ProbeOptions): Promise<ProbeRecord[]> {
  const started = Date.now()
  try {
    return [await runInputProbe(browser, url, options)]
  } catch (error) {
    return [skippedRecord('input', INPUT_VERSION, 'on-input', `probe failed: ${(error instanceof Error ? error.message : String(error)).split('\n')[0]}`, Date.now() - started)]
  }
}
