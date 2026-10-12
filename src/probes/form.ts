import type { Browser } from 'playwright-core'
import { errorFieldAt, isAnnounced } from '../criteria/error-messages.ts'
import { type ErrorFieldFacts, errorFieldFacts } from '../rules/errors.ts'
import type { A11yNode, A11ySnapshot, ProbeRecord } from '../snapshot/schema.ts'
import { collectInPage } from '../surfaces/in-page.ts'
import { type ControlFacts, Harness, type HarnessAction, type SkipReason, type Watch, skipReason } from './activate.ts'
import { blurTarget, contextChanges, focusTarget, hasFocus } from './input.ts'
import type { InPageElement } from './kit.ts'
import { type ProbeOptions, type ProbePage, skippedRecord } from './page.ts'

/**
 * Form probes (docs/plans/wcag-coverage.md, C6), on the activate-class harness (activate.ts):
 *
 * - 3.3.1 and 3.3.3, errors on leaving a field. For each text field that shows and states a constraint (a type, a
 *   pattern, minlength, min or max, required, or a required mark in its label), the probe types a value that breaks
 *   it, derived from the constraint (`rampa` into an e-mail field, one character too few, one below the minimum, a
 *   value the pattern refuses), and leaves the field; for a required field it empties the field and leaves it. When
 *   the page reacted, the page as it is then is read the way the collector reads a page, and the field is read the
 *   way the error state rules of B8 read one (criteria/error-messages.ts): its state, its messages and how they are
 *   tied to it, its hints, the browser's validity flags. Rules (rules/form.ts) run B8's decisions on those facts.
 * - 3.3.7, redundant entry on one page: fields of one form that ask for the same thing twice (the same autocomplete
 *   purpose, or the same label in two groups, such as billing and shipping), and the controls that offer to reuse an
 *   entry ("Same as billing"). The probe toggles such a control, or types into the first field and sees whether the
 *   second was filled in or offers the value.
 *
 * It never submits: it never presses Enter, the hooks cancel any submission, and the network guard lets only GET,
 * HEAD and OPTIONS through. The skip list applies: password and file fields, and every field of a form with a
 * password, file or payment field, are never typed into.
 */

export const FORM_VERSION = '1'
/** Fields and pairs tried per page, and time. */
export const FORM_LIMITS = { controls: 26, timeMs: 150_000 }
const MAX_FIELDS = 20
const MAX_PAIRS = 6
const MAX_LISTED = 60
/** The window while typing; leaving the field gets the harness's window, which waits for the page to be quiet. */
const TYPING_MS = 400

export type FormConstraint = 'type' | 'pattern' | 'minlength' | 'min' | 'max' | 'required'

export interface PlannedTrial {
  constraint: FormConstraint
  /** What to type: '' empties the field. */
  value: string
  /** The constraint as the markup states it: type="email", minlength="8", required, a required mark in its label. */
  rule: string
}

/** The field as the error state rules read it on the page after it was left. */
export interface AfterField extends ErrorFieldFacts {
  /** Refs of its messages that are, or sit in, an alert, a status or a live region: announced when they change. */
  announced: string[]
}

export interface TrialResult {
  constraint: FormConstraint
  rule: string
  /** What the probe typed: '' when it emptied the field. */
  typed: string
  /** The field's value after it was left, when the page changed what was typed (a mask). */
  value?: string | undefined
  /** The browser's validity flags once the field was left. */
  validity: string[]
  userInvalid: boolean
  /** The page changed something a reader would notice, or a class or style, while typing or on leaving. */
  reacted: boolean
  /** Read when the page reacted, or the browser found the field invalid. */
  after?: AfterField | undefined
  /** Changes of context while typing or leaving (3.2.2's to judge): navigation, new-window, submission… */
  context?: string[] | undefined
  outcome?: 'unmatched' | 'not-exercised' | 'no-focus' | 'not-tried' | undefined
  reason?: string | undefined
}

export interface FormField extends InPageElement {
  type: string
  label: string
  constraints: Record<string, string>
  /** Why it counts as required: the attribute, aria-required, or a mark in its label ("Name *"). */
  required?: 'attribute' | 'aria' | 'label' | undefined
  trials: PlannedTrial[]
  skip?: { reason: SkipReason; detail?: string | undefined } | undefined
  results?: TrialResult[] | undefined
}

/** A text field that may ask for something another field asked for. */
export interface EntryField extends InPageElement {
  label: string
  /** The name of its group: a legend, a group's name, or the heading of its part of the form. */
  group: string
  /** Its autocomplete value, as written. */
  token?: string | undefined
  /** The purpose its token names, with a qualifier for contact fields (`home tel`). */
  purpose?: string | undefined
  /** billing or shipping, from the token. */
  location?: string | undefined
  section?: string | undefined
  type: string
  shows: boolean
}

export interface ReuseControl extends InPageElement {
  label: string
  control: 'checkbox' | 'radio' | 'switch' | 'button' | 'select' | 'link'
  shows: boolean
  checked?: boolean | undefined
}

export interface RedundantTrial {
  /** The value typed into the first field. */
  typed?: string | undefined
  /** The second field had that value once the first was left. */
  populated?: boolean | undefined
  /** The second field offered it when it took focus (a datalist, a list of suggestions). */
  offered?: boolean | undefined
  /** A reuse control toggled, and what it did to the second field. */
  toggled?: { label: string; effect: 'filled' | 'hidden' | 'shown' | 'disabled' | 'nothing' } | undefined
  outcome?: 'unmatched' | 'not-exercised' | 'hidden' | 'skipped' | 'not-tried' | 'no-focus' | undefined
  reason?: string | undefined
}

export interface RedundantPair {
  first: EntryField
  again: EntryField
  /** The same autocomplete purpose, or the same label in another group. */
  basis: 'autocomplete' | 'label'
  /** Billing and shipping: by their tokens, or by the names of their groups. */
  address: boolean
  /** The second field's label asks to confirm or repeat the entry ("Confirm e-mail"). */
  confirm: boolean
  /** Controls in the same form that offer to reuse an entry ("Same as billing address"). */
  reuse: ReuseControl[]
  trial?: RedundantTrial | undefined
}

export interface FormData {
  viewport: { width: number; height: number }
  /** Text fields that show. */
  found: number
  /** Of those, fields that state no constraint the probe can break. */
  unconstrained: number
  fields: FormField[]
  /** Fields typed into. */
  tried: number
  pairs: RedundantPair[]
  loads: number
  actions: HarnessAction[]
  end: 'complete' | 'budget' | 'time'
}

/** A required mark in a label: "Name *", "E-mail (required)", "(obrigatório)", "(obligatorio)". */
export const REQUIRED_MARK = /\*\s*:?\s*$|^\s*\*|\((required|obrigat[oó]ri[oa]|obligatori[oa])\)/i
/** Labels that ask to enter something again: "Confirm e-mail", "Repeat password", "Confirme o e-mail", "Repita". */
export const CONFIRM_WORDS = /\b(confirm|confirmation|repeat|re-?enter|re-?type|again|verify)\b|confirm[ae]|confirma[cç][aã]o|repita|repetir|novamente|de novo|vuelva a|otra vez/i
/** Controls that offer to reuse an entry: "Same as billing", "Use my billing address", "Igual ao endereço de cobrança", "Mismo domicilio". */
export const REUSE_WORDS =
  /\bsame\b|\buse (my |the |this |these )?(billing|shipping|delivery|saved|previous|above|same)\b|\bcopy (from|of)?\s*(billing|shipping|above)\b|\bidentical\b|\bigua(l|is) (a|ao|à|aos)\b|\bmesm[oa]s?\b|\busar (o |os |a |as |meu |meus )?(endere[cç]o|dados) (de|da|do|acima)|\bcopiar (os )?dados\b|\bmism[oa]s?\b|\busar (la |los )?(direcci[oó]n|datos) de\b/i
/** Names of the groups of a checkout that ask for one address twice. */
export const ADDRESS_GROUPS = /\b(billing|shipping|delivery|invoice|postal|mailing)\b|cobran[cç]a|entrega|fatura(mento)?|faturamento|facturaci[oó]n|env[ií]o|correspond[eê]ncia/i

/** Purposes a form may rightly ask for twice, or that are secrets: never a redundant entry. */
export const NOT_REDUNDANT = new Set(['new-password', 'current-password', 'one-time-code', 'cc-number', 'cc-csc', 'cc-exp', 'cc-exp-month', 'cc-exp-year'])

/** A pair as the page lists it, with what the skip list reads about each field. */
export type ListedPair = Omit<RedundantPair, 'first' | 'again'> & { first: EntryField & { facts: ControlFacts }; again: EntryField & { facts: ControlFacts } }

/** Runs in the page; needs the kit and the activate kit. The text fields that show, the trials each allows, and the pairs that ask twice. */
export function findFormFields(args: { max: number; confirm: string; reuse: string; groups: string; required: string; notRedundant: string[] }): {
  found: number
  unconstrained: number
  fields: Array<FormField & { facts: ControlFacts }>
  pairs: ListedPair[]
} {
  const w = window as unknown as {
    __rampaKit: { describe(el: Element): InPageElement; visible(el: Element): boolean }
    __rampaActivate: { facts(el: Element): ControlFacts }
  }
  const kit = w.__rampaKit
  const confirmWords = new RegExp(args.confirm, 'i')
  const reuseWords = new RegExp(args.reuse, 'i')
  const groupWords = new RegExp(args.groups, 'i')
  const requiredMark = new RegExp(args.required, 'i')
  const collapse = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim()
  const cut = (value: string, n: number) => (value.length > n ? `${value.slice(0, n - 1)}…` : value)
  const textOf = (el: Element | null | undefined) => collapse((el as HTMLElement | null)?.innerText || el?.textContent)
  const showing = (el: Element) => kit.visible(el) && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0
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
  const compile = (pattern: string): RegExp | undefined => {
    for (const flags of ['v', 'u']) {
      try {
        return new RegExp(`^(?:${pattern})$`, flags)
      } catch {
        // Try the next flag; the browser ignores a pattern that does not compile.
      }
    }
    return undefined
  }
  const TEXT_TYPES = ['text', 'email', 'url', 'tel', 'number', 'search', 'password']
  const typeOf = (el: Element) => (el.localName === 'textarea' ? 'textarea' : ((el as HTMLInputElement).type || 'text').toLowerCase())
  const isText = (el: Element) => el.localName === 'textarea' || TEXT_TYPES.includes(typeOf(el))

  const fields: Array<FormField & { facts: ControlFacts }> = []
  let found = 0
  let unconstrained = 0
  for (const el of Array.from(document.querySelectorAll('input, textarea'))) {
    const input = el as HTMLInputElement
    if (!isText(el) || input.readOnly || input.disabled || !showing(el)) continue
    found++
    const type = typeOf(el)
    const label = nameOf(el)
    const constraints: Record<string, string> = {}
    let required: FormField['required']
    if (input.required) required = 'attribute'
    else if (el.getAttribute('aria-required') === 'true') required = 'aria'
    else if (requiredMark.test(label)) required = 'label'
    if (required) constraints.required = ''
    const minLength = input.minLength > 0 ? input.minLength : 0
    if (minLength > 0) constraints.minlength = String(minLength)
    const maxLength = el.getAttribute('maxlength')
    if (maxLength) constraints.maxlength = maxLength
    const pattern = el.localName === 'input' ? el.getAttribute('pattern') : null
    if (pattern) constraints.pattern = pattern
    const min = el.getAttribute('min')
    const max = el.getAttribute('max')
    const step = Number(el.getAttribute('step') ?? '')
    if (type === 'number' && min !== null) constraints.min = min
    if (type === 'number' && max !== null) constraints.max = max
    if (['email', 'url', 'number', 'tel'].includes(type)) constraints.type = type
    const trials: PlannedTrial[] = []
    const regex = pattern ? compile(pattern) : undefined
    const numeric = type === 'tel' || type === 'number' || /^(numeric|decimal|tel)$/i.test(el.getAttribute('inputmode') ?? '')
    if (type === 'email' || type === 'url') trials.push({ constraint: 'type', value: 'rampa', rule: `type="${type}"` })
    else if (regex) {
      const value = ['a', '1', 'ab', '12', 'a1', 'A', 'rampa', '!', '123456789012345'].find((candidate) => !regex.test(candidate))
      if (value) trials.push({ constraint: 'pattern', value, rule: `pattern="${pattern}"` })
    } else if (minLength >= 2) trials.push({ constraint: 'minlength', value: (numeric ? '1' : 'a').repeat(minLength - 1), rule: `minlength="${minLength}"` })
    else if (type === 'number' && min !== null && Number.isFinite(Number(min)) && min.trim() !== '') {
      trials.push({ constraint: 'min', value: String(Number(min) - (step > 0 ? step : 1)), rule: `min="${min}"` })
    } else if (type === 'number' && max !== null && Number.isFinite(Number(max)) && max.trim() !== '') {
      trials.push({ constraint: 'max', value: String(Number(max) + (step > 0 ? step : 1)), rule: `max="${max}"` })
    }
    if (required) trials.push({ constraint: 'required', value: '', rule: required === 'label' ? 'a required mark in its label' : required === 'aria' ? 'aria-required="true"' : 'required' })
    if (trials.length === 0) {
      unconstrained++
      continue
    }
    if (fields.length >= args.max) continue
    fields.push({ ...kit.describe(el), type, label: cut(label, 80), constraints, ...(required ? { required } : {}), trials, facts: w.__rampaActivate.facts(el) })
  }

  // 3.3.7: fields of one form that ask for the same thing twice.
  type Entry = EntryField & { facts: ControlFacts; el: Element; flow: Element | null; key: string }
  const groupOf = (el: Element): string => {
    const fieldset = el.closest('fieldset')
    const legend = fieldset?.querySelector('legend')
    if (legend) return cut(textOf(legend), 80)
    const group = el.closest('[role=group],[role=region],section')
    const named = group ? collapse(group.getAttribute('aria-label')) || textOf(group.querySelector('h1,h2,h3,h4,h5,h6,[role=heading]')) : ''
    if (named) return cut(named, 80)
    // The heading closest before the field, inside its form.
    const flow = (el as HTMLInputElement).form ?? document.body
    const headings = Array.from(flow.querySelectorAll('h1,h2,h3,h4,h5,h6,[role=heading]')).filter((h) => h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)
    return cut(textOf(headings.at(-1)), 80)
  }
  const normalize = (label: string) =>
    label
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .replace(/\((required|optional|obrigatorio|opcional|obligatorio)\)|\*|:/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  const entries: Entry[] = []
  for (const el of Array.from(document.querySelectorAll('input, textarea'))) {
    const input = el as HTMLInputElement
    if (!isText(el) || typeOf(el) === 'password' || input.disabled || el.closest('[aria-hidden=true]')) continue
    const raw = collapse(el.getAttribute('autocomplete')).toLowerCase()
    const terms = raw.split(' ').filter(Boolean)
    if (terms.at(-1) === 'webauthn') terms.pop()
    const section = terms[0]?.startsWith('section-') ? terms.shift() : undefined
    const location = terms[0] === 'billing' || terms[0] === 'shipping' ? terms.shift() : undefined
    const qualifier = ['home', 'work', 'mobile', 'fax', 'pager'].includes(terms[0] ?? '') ? terms.shift() : undefined
    const field = terms.length === 1 && !['on', 'off', 'none', 'false', 'true'].includes(terms[0] ?? '') ? terms[0] : undefined
    const label = cut(nameOf(el), 80)
    const purpose = field ? (qualifier ? `${qualifier} ${field}` : field) : undefined
    entries.push({
      ...kit.describe(el),
      label,
      group: groupOf(el),
      ...(raw ? { token: raw } : {}),
      ...(purpose ? { purpose } : {}),
      ...(location ? { location } : {}),
      ...(section ? { section } : {}),
      type: typeOf(el),
      shows: showing(el),
      facts: w.__rampaActivate.facts(el),
      el,
      flow: input.form ?? el.closest('[role=form]'),
      key: normalize(label),
    })
    if (entries.length >= 200) break
  }
  const sameFlow = (a: Entry, b: Entry): Element | null => {
    if (a.flow || b.flow) return a.flow === b.flow ? a.flow : null
    // Fields outside a form belong together when their closest common ancestor is not the whole page.
    let common: Element | null = a.el.parentElement
    while (common && !common.contains(b.el)) common = common.parentElement
    return common && common !== document.body && common !== document.documentElement ? common : null
  }
  const reuseIn = (flow: Element): ReuseControl[] => {
    const found: ReuseControl[] = []
    for (const el of Array.from(flow.querySelectorAll('input[type=checkbox],input[type=radio],button,[role=switch],[role=checkbox],[role=button],a[href],select'))) {
      if (found.length >= 4) break
      if (el.localName === 'select') {
        const option = Array.from((el as HTMLSelectElement).options).find((o) => reuseWords.test(collapse(o.label || o.textContent)))
        if (option) found.push({ ...kit.describe(el), label: cut(collapse(option.label || option.textContent), 80), control: 'select', shows: showing(el) })
        continue
      }
      const name = el.localName === 'input' ? nameOf(el) || textOf(el.parentElement) : collapse(el.getAttribute('aria-label')) || textOf(el)
      if (!reuseWords.test(name)) continue
      const role = el.getAttribute('role')
      const control: ReuseControl['control'] =
        role === 'switch' ? 'switch' : role === 'checkbox' || (el as HTMLInputElement).type === 'checkbox' ? 'checkbox' : (el as HTMLInputElement).type === 'radio' ? 'radio' : el.localName === 'a' ? 'link' : 'button'
      const labelOf = Array.from((el as HTMLInputElement).labels ?? []).find((l) => showing(l))
      const checked = el.localName === 'input' ? (el as HTMLInputElement).checked : el.getAttribute('aria-checked') === 'true' || el.getAttribute('aria-pressed') === 'true'
      found.push({ ...kit.describe(el), label: cut(name, 80), control, shows: showing(el) || labelOf !== undefined, ...(control !== 'button' && control !== 'link' ? { checked } : {}) })
    }
    return found
  }
  const digitless = (text: string) => text.replace(/\d+/g, '#').trim()
  const pairs: ListedPair[] = []
  const strip = ({ el: _el, flow: _flow, key: _key, ...entry }: Entry) => entry
  for (let j = 1; j < entries.length && pairs.length < 10; j++) {
    const again = entries[j] as Entry
    for (let i = 0; i < j; i++) {
      const first = entries[i] as Entry
      const flow = sameFlow(first, again)
      if (!flow) continue
      let basis: RedundantPair['basis'] | undefined
      if (first.purpose && again.purpose) {
        if (first.purpose !== again.purpose || args.notRedundant.includes(first.purpose.split(' ').at(-1) ?? '')) continue
        // Two sections are two people or things (a second traveller): not the same data asked twice.
        if ((first.section ?? '') !== (again.section ?? '')) continue
        basis = 'autocomplete'
      } else if (first.key.length >= 2 && first.key === again.key) basis = 'label'
      if (!basis) continue
      // Groups named alike but for a number ("Passenger 1", "Passenger 2") ask about two people.
      if (first.group !== again.group && digitless(first.group) === digitless(again.group)) continue
      // The same label in the same group is not a second step: it is the same question twice, which a person must look at.
      const address = (first.location !== undefined && again.location !== undefined && first.location !== again.location) || (first.group !== again.group && groupWords.test(first.group) && groupWords.test(again.group))
      pairs.push({ first: strip(first), again: strip(again), basis, address, confirm: confirmWords.test(again.label), reuse: reuseIn(flow) })
      break
    }
  }
  return { found, unconstrained, fields, pairs }
}

interface FormWindow {
  __rampaTarget?: Element | null
  __rampaKit: { cssPath(el: Element): string; visible(el: Element): boolean }
}

/** Runs in the page: the located field's validity flags, whether :user-invalid matches, its value and its ref now. */
export function readField(): { validity: string[]; userInvalid: boolean; value: string; ref: string | null; shows: boolean; disabled: boolean } {
  const w = window as unknown as FormWindow
  const el = w.__rampaTarget as HTMLInputElement | null
  if (!el?.isConnected) return { validity: [], userInvalid: false, value: '', ref: null, shows: false, disabled: false }
  const FLAGS = ['valueMissing', 'typeMismatch', 'patternMismatch', 'tooLong', 'tooShort', 'rangeUnderflow', 'rangeOverflow', 'stepMismatch', 'badInput', 'customError'] as const
  let userInvalid = false
  try {
    userInvalid = el.matches(':user-invalid')
  } catch {
    userInvalid = false
  }
  const validity = el.validity && !el.validity.valid ? FLAGS.filter((flag) => el.validity[flag]) : []
  const rect = el.getBoundingClientRect()
  return { validity, userInvalid, value: String(el.value ?? '').slice(0, 80), ref: w.__rampaKit.cssPath(el), shows: w.__rampaKit.visible(el) && rect.width > 0 && rect.height > 0, disabled: el.disabled || el.readOnly }
}

/**
 * Runs in the page: the text a reader sees around the located field (its form, or the block that holds it). A message a
 * style sheet shows (`input:user-invalid + .error { display: block }`) changes it with no mutation of the page.
 */
export function textAround(): string {
  const el = (window as unknown as FormWindow).__rampaTarget as HTMLInputElement | null
  if (!el?.isConnected) return ''
  const box = el.form ?? el.closest('fieldset, [role=group], [role=form], section, article, main') ?? el.parentElement?.parentElement ?? document.body
  return ((box as HTMLElement).innerText ?? '').slice(0, 20_000)
}

/** Runs in the page: whether the located field offers a value when it has focus: its datalist, or a list of options that shows it. */
export function offersValue(args: { value: string }): boolean {
  const el = (window as unknown as FormWindow).__rampaTarget as HTMLInputElement | null
  if (!el?.isConnected) return false
  const want = args.value.toLowerCase()
  if (el.list && Array.from(el.list.options).some((o) => o.value.toLowerCase().includes(want) || (o.label ?? '').toLowerCase().includes(want))) return true
  const kit = (window as unknown as FormWindow).__rampaKit
  for (const option of Array.from(document.querySelectorAll('[role=option], [role=listbox] li, [role=menuitem]'))) {
    if (kit.visible(option) && option.getBoundingClientRect().width > 0 && (option.textContent ?? '').toLowerCase().includes(want)) return true
  }
  return false
}

/** Synthetic values for a field that asks for the person's data, by purpose: what the probe types into the first field of a pair. */
const VALUES: Record<string, string> = {
  name: 'Rampa Teste',
  'given-name': 'Rampa',
  'family-name': 'Teste',
  email: 'rampa.teste@example.com',
  tel: '85999990000',
  'tel-national': '85999990000',
  'postal-code': '60000000',
  'street-address': 'Rua Rampa 100',
  'address-line1': 'Rua Rampa 100',
  'address-line2': 'Apto 1',
  'address-level2': 'Fortaleza',
  'address-level1': 'CE',
  'country-name': 'Brasil',
  organization: 'Rampa',
}

export function valueFor(entry: Pick<EntryField, 'purpose' | 'type'>): string {
  const purpose = entry.purpose?.split(' ').at(-1)
  if (purpose && VALUES[purpose]) return VALUES[purpose]
  if (entry.type === 'email') return VALUES.email as string
  if (entry.type === 'tel' || entry.type === 'number') return '12345'
  return 'Rampa Teste'
}

/** The page as the collector reads it, and the field at `ref` in it, as the error state rules read it. */
export async function readAfter(probe: ProbePage, ref: string): Promise<AfterField | undefined> {
  const tree = await probe.page.evaluate(collectInPage, { maxNodes: 5000 })
  const snapshot = { root: tree.root as A11yNode } as A11ySnapshot
  const field = errorFieldAt(snapshot, ref)
  if (!field) return undefined
  const facts = errorFieldFacts(field)
  return { ...facts, announced: facts.messages.filter((message) => isAnnounced(snapshot, message.ref)).map((message) => message.ref) }
}

function contextOf(...watches: Watch[]): string[] {
  return [...new Set(watches.flatMap((watch) => contextChanges(watch, 'commit').filter((change) => change.weight !== 'review').map((change) => change.kind)))]
}

/** Every trial of one field, on one page, in order: the field is emptied before each. */
async function tryField(harness: Harness, field: FormField, fresh: boolean): Promise<TrialResult[]> {
  const probe = await harness.page(fresh)
  const page = probe.page
  const skipped = (outcome: TrialResult['outcome'], reason?: string) => field.trials.map((trial) => ({ constraint: trial.constraint, rule: trial.rule, typed: trial.value, validity: [], userInvalid: false, reacted: false, outcome, ...(reason ? { reason } : {}) }))
  if (!(await harness.locate(probe, field))) return skipped('unmatched')
  const aimed = await harness.aim(probe, field)
  if ('cover' in aimed) return skipped('not-exercised', `covered by <${aimed.cover.tag}> "${aimed.cover.text.slice(0, 60)}"`)
  if ('hidden' in aimed) {
    harness.log('not-exercised', { ref: field.ref, label: field.label, detail: 'not showing on this load' })
    return skipped('not-exercised', 'not showing on this load')
  }
  const results: TrialResult[] = []
  for (const trial of field.trials) {
    const base = { constraint: trial.constraint, rule: trial.rule, typed: trial.value }
    if (!(await page.evaluate(focusTarget)) || !(await page.evaluate(hasFocus))) {
      harness.log('not-exercised', { ref: field.ref, label: field.label, detail: 'took no focus' })
      results.push({ ...base, validity: [], userInvalid: false, reacted: false, outcome: 'no-focus' })
      continue
    }
    harness.log('activate', { ref: field.ref, label: field.label, detail: trial.value ? `typed "${trial.value}" (${trial.rule})` : `emptied it (${trial.rule})` })
    const around = await page.evaluate(textAround)
    // Empty the field first, as a person who starts again; an empty value is typed and erased, so the field counts as edited.
    const typing = await harness.window(
      probe,
      async () => {
        await page.keyboard.press('ControlOrMeta+A')
        await page.keyboard.press('Backspace')
        if (trial.value) await page.keyboard.type(trial.value, { delay: 15 })
        else {
          await page.keyboard.type('a')
          await page.keyboard.press('Backspace')
        }
      },
      { ms: TYPING_MS, ref: field.ref, label: field.label },
    )
    const leaving = await harness.window(probe, () => page.evaluate(blurTarget), { ref: field.ref, label: field.label, blurred: true })
    const read = await page.evaluate(readField)
    // The page changed something, or a style sheet showed text around the field (its own value is not text a reader sees there).
    const reacted = typing.dom + typing.style + leaving.dom + leaving.style > 0 || (await page.evaluate(textAround)) !== around
    const context = contextOf(typing, leaving)
    // Reading the whole page costs; it is done only when the page reacted. With no reaction, only the browser's own
    // validation (:user-invalid) marks the field, and a message there would be one that was always on the page.
    const after = read.ref && reacted ? await readAfter(probe, read.ref).catch(() => undefined) : undefined
    results.push({
      ...base,
      ...(read.value !== trial.value ? { value: read.value } : {}),
      validity: read.validity,
      userInvalid: read.userInvalid,
      reacted,
      ...(after ? { after } : {}),
      ...(context.length > 0 ? { context } : {}),
    })
  }
  return results
}

/** One pair that asks twice: a reuse control toggled, or the first field typed into and the second read. */
async function tryPair(harness: Harness, pair: ListedPair): Promise<RedundantTrial> {
  const toggle = pair.reuse.find((control) => control.shows && control.control !== 'link' && control.control !== 'select')
  if (toggle) {
    const probe = await harness.page(true)
    const page = probe.page
    // The field asked again is only read here: the skip list is for the toggle, read on this page by `locate`.
    if (!(await harness.locate(probe, pair.again, { check: false }))) return { outcome: 'unmatched' }
    const before = await page.evaluate(readField)
    if (!(await harness.locate(probe, toggle))) return harness.lastSkip ? { outcome: 'skipped', reason: harness.lastSkip.reason } : { outcome: 'unmatched' }
    let aimed = await harness.aim(probe, toggle)
    // A styled checkbox hides its input and shows its label.
    if ('hidden' in aimed && (toggle.control === 'checkbox' || toggle.control === 'radio')) aimed = await harness.aim(probe, toggle, 'label')
    if (!('x' in aimed)) return { outcome: 'not-exercised', reason: 'cover' in aimed ? `covered by <${aimed.cover.tag}>` : 'not showing' }
    harness.log('activate', { ref: toggle.ref, label: toggle.label, detail: 'clicked the reuse control' })
    await harness.window(probe, () => page.mouse.click(aimed.x, aimed.y), { ref: toggle.ref, label: toggle.label })
    if (!(await harness.locate(probe, pair.again, { check: false }))) return { toggled: { label: toggle.label, effect: 'hidden' } }
    const after = await page.evaluate(readField)
    const effect: NonNullable<RedundantTrial['toggled']>['effect'] =
      before.shows && !after.shows ? 'hidden' : !before.shows && after.shows ? 'shown' : after.disabled && !before.disabled ? 'disabled' : after.value !== before.value && after.value !== '' ? 'filled' : 'nothing'
    return { toggled: { label: toggle.label, effect } }
  }
  if (!pair.again.shows) return { outcome: 'hidden' }
  for (const entry of [pair.first, pair.again]) {
    const skip = skipReason(entry.facts, harness.origin)
    if (skip) {
      harness.skip(entry, skip.reason, skip.detail)
      return { outcome: 'skipped', reason: skip.detail ? `${skip.reason}: ${skip.detail}` : skip.reason }
    }
  }
  const probe = await harness.page(true)
  const page = probe.page
  if (!(await harness.locate(probe, pair.first))) return { outcome: 'unmatched' }
  const aimed = await harness.aim(probe, pair.first)
  if (!('x' in aimed)) return { outcome: 'not-exercised', reason: 'cover' in aimed ? `covered by <${aimed.cover.tag}>` : 'not showing' }
  if (!(await page.evaluate(focusTarget))) return { outcome: 'no-focus' }
  const typed = valueFor(pair.first)
  harness.log('activate', { ref: pair.first.ref, label: pair.first.label, detail: `typed "${typed}"` })
  await harness.window(probe, () => page.keyboard.type(typed, { delay: 10 }), { ms: TYPING_MS, ref: pair.first.ref, label: pair.first.label })
  await harness.window(probe, () => page.evaluate(blurTarget), { ref: pair.first.ref, label: pair.first.label, blurred: true })
  if (!(await harness.locate(probe, pair.again))) return { typed, outcome: 'unmatched' }
  const read = await page.evaluate(readField)
  const populated = read.value.trim() !== '' && read.value.trim().toLowerCase() === typed.toLowerCase()
  if (populated) return { typed, populated: true }
  await page.evaluate(focusTarget)
  await harness.window(probe, async () => undefined, { ms: 600, ref: pair.again.ref, label: pair.again.label })
  const offered = await page.evaluate(offersValue, { value: typed })
  await page.evaluate(blurTarget).catch(() => undefined)
  return { typed, populated: false, offered }
}

/** C6 on one page: the fields' errors on leaving them (3.3.1, 3.3.3), then the fields that ask twice (3.3.7). */
export async function runFormProbe(browser: Browser, url: string, options: ProbeOptions): Promise<ProbeRecord> {
  const limits = FORM_LIMITS
  const harness = new Harness(browser, url, options, { kind: 'form', version: FORM_VERSION, variant: 'form', limits })
  let data: FormData | undefined
  let conditions: ProbeRecord['conditions'] | undefined
  try {
    const first = await harness.page()
    conditions = first.conditions
    const viewport = first.page.viewportSize() ?? first.conditions.viewport
    const listed = await first.page.evaluate(findFormFields, {
      max: MAX_LISTED,
      confirm: CONFIRM_WORDS.source,
      reuse: REUSE_WORDS.source,
      groups: ADDRESS_GROUPS.source,
      required: REQUIRED_MARK.source,
      notRedundant: [...NOT_REDUNDANT],
    })
    data = { viewport, found: listed.found, unconstrained: listed.unconstrained, fields: [], tried: 0, pairs: [], loads: 0, actions: [], end: 'complete' }
    let budget = 0
    for (const { facts, ...field } of listed.fields) {
      const entry: FormField = field
      data.fields.push(entry)
      const skip = skipReason(facts, harness.origin)
      if (skip) {
        entry.skip = skip
        harness.skip(field, skip.reason, skip.detail)
        continue
      }
      if (data.tried >= MAX_FIELDS || budget >= limits.controls || !harness.timeLeft()) {
        if (data.end === 'complete') data.end = harness.timeLeft() ? 'budget' : 'time'
        entry.results = field.trials.map((trial) => ({ constraint: trial.constraint, rule: trial.rule, typed: trial.value, validity: [], userInvalid: false, reacted: false, outcome: 'not-tried' as const, reason: data?.end }))
        continue
      }
      data.tried++
      budget++
      // The first field uses the page the list was read on; the harness gives a fresh one once a field changed it.
      entry.results = await tryField(harness, field, false)
    }
    for (const pair of listed.pairs.slice(0, MAX_PAIRS + 4)) {
      const { facts: firstFacts, ...firstEntry } = pair.first
      const { facts: againFacts, ...againEntry } = pair.again
      const entry: RedundantPair = { ...pair, first: firstEntry, again: againEntry }
      data.pairs.push(entry)
      if (data.pairs.length > MAX_PAIRS || budget >= limits.controls || !harness.timeLeft()) {
        if (data.end === 'complete') data.end = harness.timeLeft() ? 'budget' : 'time'
        entry.trial = { outcome: 'not-tried', reason: data.end }
        continue
      }
      budget++
      entry.trial = await tryPair(harness, { ...entry, first: { ...firstEntry, facts: firstFacts }, again: { ...againEntry, facts: againFacts } })
    }
  } finally {
    await harness.close()
  }
  if (!data || !conditions) throw new Error('the first page did not load')
  data.loads = harness.loads
  data.actions = harness.actions
  const reason = data.end === 'budget' ? `budget reached (${MAX_FIELDS} fields, ${MAX_PAIRS} pairs)` : data.end === 'time' ? `time budget reached (${limits.timeMs / 1000} s)` : undefined
  return harness.record(data, conditions, reason)
}

/** The form probe as a step of the probe stage; a probe that fails leaves a skipped record. */
export async function formProbe(browser: Browser, url: string, options: ProbeOptions): Promise<ProbeRecord[]> {
  const started = Date.now()
  try {
    return [await runFormProbe(browser, url, options)]
  } catch (error) {
    return [skippedRecord('form', FORM_VERSION, 'form', `probe failed: ${(error instanceof Error ? error.message : String(error)).split('\n')[0]}`, Date.now() - started)]
  }
}
