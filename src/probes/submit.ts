import type { Browser, Page, Request } from 'playwright-core'
import { RampaError } from '../core/util.ts'
import { commitmentOf } from '../rules/scope.ts'
import type { ProbeRecord } from '../snapshot/schema.ts'
import { type ControlFacts, type HarnessAction, destructiveCode, destructiveWord, installActivateKit, skipReason, skipText } from './activate.ts'
import { type AfterField, type FormConstraint, REQUIRED_MARK, REUSE_WORDS, formProbe, readAfter, valueFor } from './form.ts'
import { originOf } from './guard.ts'
import { blurTarget, focusTarget } from './input.ts'
import { type InPageElement, installKit, settleInPage } from './kit.ts'
import { type ProbeOptions, type ProbePage, openProbePage, skippedRecord } from './page.ts'

/**
 * Form submissions (docs/plans/wcag-coverage.md, D5; docs/probes.md, "Submitting forms"). Only with `--allow-submit`
 * naming the page's exact origin (scheme, host and port), the form probe submits the page's forms, to see:
 *
 * - 3.3.1 and 3.3.3: the errors the server finds. Each form is submitted once with invalid values derived from its
 *   fields' constraints (as C6 types them), with the browser's own validation turned off for that one submission, so
 *   the entries reach the server; the form that comes back is read field by field, as the error state rules read one.
 * - 3.3.7 across steps: the form is then submitted with valid synthetic values; when that leads to another step, the
 *   probe compares what the step asks with what earlier steps were given (auto-populated, offered to select, or a
 *   control to reuse it).
 * - 3.3.4: a step whose control commits (buy, pay, place an order, sign an agreement, delete data, hand in answers) is
 *   reached and never pressed; the probe records what the step shows: the entries shown again for review, a
 *   confirmation checkbox, a way to reverse it.
 *
 * What never happens, flag or not: a form with a password, payment or file field, or a CAPTCHA, is never filled in
 * or submitted; a control whose name is on the skip list (delete, pay, buy, sign out, subscribe, confirm, save…; only
 * the words that name submitting itself, such as "Submit", "Send", "Enviar" or "Save and continue", are let through)
 * is never pressed; a form that posts to another origin is never submitted; a consent checkbox is never ticked. The
 * guard (guard.ts) lets a write through only during the window the probe opens around its own press, and only to an
 * origin the flag names; every request to another origin is blocked once the page has loaded. `--submit-dry-run`
 * lists what would be submitted, and submits nothing.
 */

export const SUBMIT_VERSION = '1'
/** Forms tried per page, steps per form, writes the guard may let through per page, and time. */
export const SUBMIT_LIMITS = { flows: 3, steps: 5, writes: 12, timeMs: 150_000 }
const MAX_CONTROLS = 30
/** How long a submission may take to answer: a navigation's load, or the page's own requests going quiet. */
const ANSWER_MS = 15_000
const NAVIGATION_START_MS = 2000
const QUIET_MS = 500
const QUIET_CAP_MS = 8000

/**
 * The words of the skip list that only name submitting itself: a control named so may be pressed, on an allowed origin
 * only. Everything else on the list (delete, pay, buy, confirm, save, subscribe, sign out…) stays a reason to stop.
 */
export const NEUTRAL_SUBMIT_WORDS: readonly string[] = ['submit', 'send', 'save and continue', 'save and next', 'enviar', 'envie', 'envia', 'submeter', 'salvar e continuar', 'salvar e avancar', 'guardar y continuar']
const NEUTRAL_PHRASES = NEUTRAL_SUBMIT_WORDS.map((word) => skipText(word).trim())

/** Links and buttons that go back to change an entry, at the start of their name (en, pt-BR, es). */
export const EDIT_WORDS = /^\s*(edit|change|modify|amend|back|go back|previous|alterar|editar|corrigir|modificar|voltar|anterior|cambiar|volver)\b/i

/** A control of a step's form, as the page showed it when the step arrived. */
export interface StepControl extends InPageElement {
  name: string
  /** text, email, tel, number, url, search, textarea, select, radio, checkbox, date… */
  type: string
  label: string
  /** Its legend, group name or the heading before it. */
  group: string
  token?: string | undefined
  /** The purpose its autocomplete token names, with a qualifier for contact fields (`home tel`). */
  purpose?: string | undefined
  location?: string | undefined
  section?: string | undefined
  constraints: Record<string, string>
  required?: 'attribute' | 'aria' | 'label' | undefined
  /** Its value on arrival: what a later step filled in by itself. */
  value: string
  checked?: boolean | undefined
  /** A select's options or a datalist's values, as text: what the field offers to choose. */
  options?: string[] | undefined
  shows: boolean
}

type ListedControl = StepControl & { facts: ControlFacts }

export interface StepForm extends InPageElement {
  /** Where the submit control sends it: its `formaction`, or the form's `action`. */
  action: string
  method: string
  /** Its `formtarget` or `target`, when it submits into another window. */
  target?: string | undefined
  label: string
  controls: ListedControl[]
  submit?: (InPageElement & { label: string; facts: ControlFacts }) | undefined
  /** A password, payment or file field: never filled in, never submitted. */
  sensitive: boolean
  captcha: boolean
  search: boolean
  /** Names of its checkboxes: a confirmation box ("I have reviewed my order") is one of 3.3.4's mechanisms. */
  checkboxes: string[]
  /** Controls in it that offer to reuse an entry ("Same as billing address"). */
  reuse: string[]
}

export interface PageFacts {
  url: string
  title: string
  heading: string
  forms: StepForm[]
  /** The page's lines of text up to 160 characters (at most 150): where a review step names itself, or a refund policy shows. */
  texts: string[]
  /** Links and buttons that go back to change an entry: Edit, Change, Back, Alterar, Editar, Voltar… */
  edit: string[]
  /** Of the values asked for, those the page shows in its text. */
  echoed: string[]
  /** The text of alerts, status and live regions, and of error summaries, that show. */
  alerts: string[]
  /** The page's visible text, to tell a message that came with an answer from one that was always there (not recorded). */
  body: string
}

export type SubmitConstraint = FormConstraint | 'purpose'

/** What the probe put in one control for one submission. */
export interface SubmitEntry {
  ref: string
  name: string
  label: string
  type: string
  /** What was typed or chosen: '' empties the field; for a checkbox or a radio, 'on' checks it; for a select, the option's text. */
  value: string
  /** For a select: the index of the option chosen. */
  option?: number | undefined
  /** On an invalid submission: the constraint the value breaks. */
  constraint?: SubmitConstraint | undefined
  /** The constraint as the markup states it: type="email", minlength="8", autocomplete="email". */
  rule?: string | undefined
}

/** A field the probe broke, read on the page that came back. */
export interface SubmittedField {
  name: string
  /** Its ref when the step arrived: on the first step, the snapshot's. */
  ref: string
  id: InPageElement['id']
  label: string
  constraint: SubmitConstraint
  rule: string
  typed: string
  constraints: Record<string, string>
  /** The field is no longer on the page. */
  gone?: boolean | undefined
  /** Its value now. */
  value?: string | undefined
  /** As the error state rules read it on the page that came back. */
  after?: AfterField | undefined
  /** Refs of its messages that were not on the page before the submission. */
  fresh?: string[] | undefined
}

export interface Submission {
  kind: 'invalid' | 'valid'
  entries: SubmitEntry[]
  /** The browser's own validation was turned off for this submission, so the entries reached the server. */
  noValidate: boolean
  /** The writes and navigations the guard let through, with the answer's status when there was one. */
  requests: Array<{ method: string; url: string; status?: number | undefined }>
  /** Requests the guard blocked meanwhile (other origins, beacons). */
  blocked: number
  /** same-step: the form came back; next-step: another form; ended: no form; the rest stopped the flow. */
  outcome: 'same-step' | 'next-step' | 'ended' | 'other-origin' | 'not-exercised' | 'no-answer'
  reason?: string | undefined
  url: string
  /** After an invalid submission that came back: the fields broken, read as B8 reads them. */
  fields?: SubmittedField[] | undefined
  /** Alerts and error summaries that showed and were not on the page before. */
  alerts?: string[] | undefined
  /** Labels of fields that held a valid entry and came back empty. */
  cleared?: string[] | undefined
  ms: number
}

export interface SubmitStep {
  index: number
  url: string
  title: string
  heading: string
  form: InPageElement & { label: string; action: string; method: string }
  control?: string | undefined
  controls: StepControl[]
  reuse: string[]
  submissions: Submission[]
  /** With --submit-dry-run: what the probe would put in each control, and nothing was sent. */
  planned?: { invalid: SubmitEntry[]; valid: SubmitEntry[] } | undefined
}

/** The step whose control commits: reached, never pressed. */
export interface CommitStep {
  step: number
  control: string
  kind: string
  checkboxes: string[]
  texts: string[]
  /** Values entered on earlier steps that this step shows again. */
  echoed: string[]
  /** How many values earlier steps were given (of four characters or more). */
  entered: number
  edit: string[]
}

export type StopReason = 'commit' | 'skip-list' | 'sensitive' | 'captcha' | 'new-window' | 'other-origin' | 'no-submit-control' | 'not-exercised' | 'no-progress' | 'ended' | 'steps' | 'budget' | 'time' | 'no-answer' | 'dry-run'

export interface SubmitFlow {
  /** The form the flow started from, on the first page: the snapshot's. */
  form: InPageElement & { label: string; action: string; method: string }
  steps: SubmitStep[]
  commit?: CommitStep | undefined
  stopped: { reason: StopReason; detail?: string | undefined }
}

export interface SubmitData {
  viewport: { width: number; height: number }
  /** The origins --allow-submit named. */
  allowed: string[]
  /** The page's origin. */
  origin: string
  dryRun: boolean
  /** Forms on the first page the probe could start from. */
  found: number
  flows: SubmitFlow[]
  /** Writes and navigations the guard let through. */
  writes: number
  loads: number
  actions: HarnessAction[]
  end: 'complete' | 'budget' | 'time'
}

/**
 * `--allow-submit` values as exact origins: http or https, a host, a port when it is not the default; no path, query,
 * fragment, user or wildcard. Throws a usage error otherwise, naming the origin the person may have meant.
 */
export function parseAllowSubmit(values: readonly string[] | string | undefined): string[] {
  const list = values === undefined ? [] : typeof values === 'string' ? [values] : values
  const origins: string[] = []
  for (const raw of list) {
    const value = raw.trim()
    const refuse = (why: string) => new RampaError('invalid-option', `--allow-submit takes one exact origin, such as http://localhost:5173 or https://staging.example.com: ${why}. Got "${raw}".`)
    if (value === '') throw refuse('it is empty')
    if (value.includes('*')) throw refuse('no wildcards; name each origin, one flag each')
    let url: URL
    try {
      url = new URL(value)
    } catch {
      throw refuse('it is not an address with a scheme')
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw refuse('only http and https origins')
    if (url.username || url.password) throw refuse('no user or password in it')
    if (url.hostname === '') throw refuse('it has no host')
    if (url.pathname !== '/' || url.search || url.hash || /[?#]/.test(value) || !/^[a-z][a-z0-9+.-]*:\/\/[^/]+\/?$/i.test(value)) {
      throw refuse(`an origin has no path, query or fragment; did you mean ${url.origin}?`)
    }
    if (!origins.includes(url.origin)) origins.push(url.origin)
  }
  return origins
}

/** Runs in the page; needs the kit and the activate kit. The page's forms, with their controls and submit control. */
export function listPage(args: { reuse: string; required: string; edit: string; values: string[]; maxControls: number }): PageFacts {
  const w = window as unknown as {
    __rampaKit: { describe(el: Element): InPageElement; visible(el: Element): boolean }
    __rampaActivate: { facts(el: Element): ControlFacts }
  }
  const kit = w.__rampaKit
  const reuseWords = new RegExp(args.reuse, 'i')
  const requiredMark = new RegExp(args.required, 'i')
  const editWords = new RegExp(args.edit, 'i')
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
  const groupOf = (el: Element): string => {
    const legend = el.closest('fieldset')?.querySelector('legend')
    if (legend) return cut(textOf(legend), 80)
    const group = el.closest('[role=group],[role=region],section')
    const named = group ? collapse(group.getAttribute('aria-label')) || textOf(group.querySelector('h1,h2,h3,h4,h5,h6,[role=heading]')) : ''
    if (named) return cut(named, 80)
    const flow = (el as HTMLInputElement).form ?? document.body
    const headings = Array.from(flow.querySelectorAll('h1,h2,h3,h4,h5,h6,[role=heading]')).filter((h) => h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)
    return cut(textOf(headings.at(-1)), 80)
  }
  const typeOf = (el: Element) => (el.localName === 'textarea' ? 'textarea' : el.localName === 'select' ? 'select' : ((el as HTMLInputElement).type || 'text').toLowerCase())
  // Where a submission goes, from the attributes: `button.formAction` gives the document's address when its attribute is
  // missing, and a control named "action" shadows `form.action`.
  const actionOf = (submitter: Element | undefined, form: HTMLFormElement): string => {
    const raw = submitter?.getAttribute('formaction') || form.getAttribute('action') || ''
    try {
      return raw.trim() === '' ? document.URL : new URL(raw, document.baseURI).href
    } catch {
      return raw
    }
  }
  const IGNORED = new Set(['hidden', 'submit', 'reset', 'button', 'image'])
  const CAPTCHA = '.g-recaptcha, .h-captcha, .cf-turnstile, [data-sitekey], iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="turnstile"], iframe[title*="captcha" i]'

  const forms: StepForm[] = []
  for (const formEl of Array.from(document.forms)) {
    const form = formEl as HTMLFormElement
    const controls: ListedControl[] = []
    const checkboxes: string[] = []
    for (const el of Array.from(form.elements)) {
      if (controls.length >= args.maxControls) break
      if (!['input', 'select', 'textarea'].includes(el.localName)) continue
      const input = el as HTMLInputElement
      const type = typeOf(el)
      if (IGNORED.has(type) || input.disabled || input.readOnly) continue
      const label = cut(nameOf(el) || (type === 'checkbox' || type === 'radio' ? textOf(el.parentElement) : ''), 120)
      const constraints: Record<string, string> = {}
      let required: StepControl['required']
      if (input.required) required = 'attribute'
      else if (el.getAttribute('aria-required') === 'true') required = 'aria'
      else if (requiredMark.test(label)) required = 'label'
      if (required) constraints.required = ''
      for (const name of ['minlength', 'maxlength', 'pattern', 'min', 'max', 'step']) {
        const value = el.getAttribute(name)
        if (value !== null && value !== '' && !(name === 'pattern' && el.localName !== 'input')) constraints[name] = value
      }
      if (['email', 'url', 'number', 'tel', 'date'].includes(type)) constraints.type = type
      const raw = collapse(el.getAttribute('autocomplete')).toLowerCase()
      const terms = raw.split(' ').filter(Boolean)
      if (terms.at(-1) === 'webauthn') terms.pop()
      const section = terms[0]?.startsWith('section-') ? terms.shift() : undefined
      const location = terms[0] === 'billing' || terms[0] === 'shipping' ? terms.shift() : undefined
      const qualifier = ['home', 'work', 'mobile', 'fax', 'pager'].includes(terms[0] ?? '') ? terms.shift() : undefined
      const field = terms.length === 1 && !['on', 'off', 'none', 'false', 'true'].includes(terms[0] ?? '') ? terms[0] : undefined
      const purpose = field ? (qualifier ? `${qualifier} ${field}` : field) : undefined
      let options: string[] | undefined
      if (el.localName === 'select') options = Array.from((el as HTMLSelectElement).options).slice(0, 30).map((o) => cut(collapse(`${o.label || o.textContent} ${o.value}`), 80))
      else if (input.list) options = Array.from(input.list.options).slice(0, 30).map((o) => cut(collapse(`${o.label} ${o.value}`), 80))
      const value = el.localName === 'select' ? collapse((el as HTMLSelectElement).selectedOptions[0]?.value ?? '') : input.value
      if (type === 'checkbox' && label) checkboxes.push(label)
      controls.push({
        ...kit.describe(el),
        name: el.getAttribute('name') ?? '',
        type,
        label,
        group: groupOf(el),
        ...(raw ? { token: raw } : {}),
        ...(purpose ? { purpose } : {}),
        ...(location ? { location } : {}),
        ...(section ? { section } : {}),
        constraints,
        ...(required ? { required } : {}),
        value: cut(value, 120),
        ...(type === 'checkbox' || type === 'radio' ? { checked: input.checked } : {}),
        ...(options ? { options } : {}),
        shows: showing(el) || Array.from(input.labels ?? []).some((l) => showing(l)),
        facts: w.__rampaActivate.facts(el),
      })
    }
    // The submit control: a submit button or image input of the form, the first that shows.
    const submitters = Array.from(form.elements).filter((el) => {
      const type = (el.getAttribute('type') ?? '').toLowerCase()
      return (el.localName === 'button' && (type === 'submit' || type === '')) || (el.localName === 'input' && (type === 'submit' || type === 'image'))
    })
    const submitter = (submitters.find((el) => showing(el)) ?? submitters[0]) as HTMLButtonElement | HTMLInputElement | undefined
    const label = cut(
      collapse(form.getAttribute('aria-label')) ||
        textOf(form.getAttribute('aria-labelledby') ? document.getElementById(form.getAttribute('aria-labelledby') ?? '') : null) ||
        textOf(form.querySelector('h1,h2,h3,h4,h5,h6,legend')) ||
        collapse(form.getAttribute('name') ?? form.getAttribute('id')),
      80,
    )
    const reuse = Array.from(form.querySelectorAll('input[type=checkbox],input[type=radio],button,[role=switch],[role=checkbox],a[href]'))
      .map((el) => (el.localName === 'input' ? nameOf(el) || textOf(el.parentElement) : collapse(el.getAttribute('aria-label')) || textOf(el)))
      .filter((name) => reuseWords.test(name))
      .slice(0, 4)
      .map((name) => cut(name, 80))
    const search = form.closest('[role=search], search') !== null || form.getAttribute('role') === 'search' || (controls.length === 1 && (controls[0]?.type === 'search' || /^(q|s|query|search|busca|pesquisa|buscar)$/i.test(controls[0]?.name ?? '')))
    const submitLabel = submitter ? cut(collapse(submitter.getAttribute('aria-label')) || (submitter.localName === 'input' ? collapse(submitter.value) || collapse(submitter.getAttribute('alt')) : textOf(submitter)) || collapse(submitter.getAttribute('title')), 80) : ''
    forms.push({
      ...kit.describe(form),
      action: actionOf(submitter, form),
      method: (submitter?.getAttribute('formmethod') || form.getAttribute('method') || 'get').trim().toLowerCase(),
      ...((submitter?.getAttribute('formtarget') || form.getAttribute('target') || '').trim() ? { target: (submitter?.getAttribute('formtarget') || form.getAttribute('target') || '').trim() } : {}),
      label,
      controls,
      ...(submitter ? { submit: { ...kit.describe(submitter), label: submitLabel, facts: w.__rampaActivate.facts(submitter) } } : {}),
      sensitive: w.__rampaActivate.facts(form).sensitiveForm,
      captcha: form.querySelector(CAPTCHA) !== null,
      search,
      checkboxes: checkboxes.slice(0, 8),
      reuse,
    })
  }
  const body = (document.body?.innerText ?? '').slice(0, 60_000)
  const lines = body
    .split('\n')
    .map((line) => collapse(line))
    .filter((line) => line.length > 0 && line.length <= 160)
  const heading = Array.from(document.querySelectorAll('h1, h2')).find((h) => kit.visible(h))
  const edit = Array.from(document.querySelectorAll('a[href], button, [role=button], [role=link]'))
    .filter((el) => showing(el))
    .map((el) => collapse(el.getAttribute('aria-label')) || textOf(el))
    .filter((name) => name.length > 0 && name.length <= 60 && editWords.test(name))
    .slice(0, 6)
  const lower = body.toLowerCase()
  const echoed = [...new Set(args.values.filter((value) => value.length >= 4 && lower.includes(value.toLowerCase())))]
  const ALERT = '[role=alert], [role=status], [aria-live=assertive], [aria-live=polite], .error-summary, .govuk-error-summary, .alert-danger, .alert-error, .errorlist, .usa-alert--error'
  const alerts = Array.from(document.querySelectorAll(ALERT))
    .filter((el) => showing(el) && textOf(el) !== '')
    .map((el) => cut(textOf(el), 200))
    .slice(0, 5)
  return { url: location.href, title: cut(document.title, 200), heading: cut(textOf(heading), 200), forms, texts: lines.slice(0, 150), edit, echoed, alerts, body }
}

/** Runs in the page: sets the located select's value (or a date's), as a browser does (input, then change). */
function setValue(args: { value: string }): boolean {
  const el = (window as unknown as { __rampaTarget?: Element | null }).__rampaTarget as HTMLInputElement | HTMLSelectElement | null
  if (!el?.isConnected) return false
  el.value = args.value
  el.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
  return true
}

/** Runs in the page: checks the located checkbox or radio with a click, unless it is checked already. */
function checkTarget(): boolean {
  const el = (window as unknown as { __rampaTarget?: Element | null }).__rampaTarget as HTMLInputElement | null
  if (!el?.isConnected) return false
  if (!el.checked) el.click()
  return el.checked
}

/** Runs in the page: turns the located form's own validation off or on; returns what it was. */
function setNoValidate(args: { on: boolean }): boolean {
  const target = (window as unknown as { __rampaTarget?: Element | null }).__rampaTarget as HTMLElement | null
  const form = (target as HTMLInputElement | null)?.form ?? (target?.closest('form') as HTMLFormElement | null)
  if (!form) return false
  const was = form.noValidate
  form.noValidate = args.on
  return was
}

const TEXT_TYPES = new Set(['text', 'email', 'url', 'tel', 'number', 'search', 'textarea'])
const DATE_TYPES = new Set(['date', 'time', 'datetime-local', 'month', 'week'])

function compile(pattern: string): RegExp | undefined {
  for (const flags of ['v', 'u']) {
    try {
      return new RegExp(`^(?:${pattern})$`, flags)
    } catch {
      // Try the next flag, as the browser does.
    }
  }
  return undefined
}

/**
 * A string a simple pattern accepts, built from it: the first branch of an alternation, the first character of a class
 * (`1` for digits, `a` for word characters), the smallest count of a quantifier. Undefined for what it cannot build (a
 * negated class, a lookaround, a backreference); the caller checks the result against the pattern either way.
 */
export function sampleFor(pattern: string): string | undefined {
  let i = 0
  const atom = (): string | undefined => {
    const c = pattern[i]
    if (c === undefined) return undefined
    if (c === '(') {
      i++
      if (pattern.startsWith('?:', i)) i += 2
      else if (pattern[i] === '?') return undefined
      const inner = alternation()
      if (inner === undefined || pattern[i] !== ')') return undefined
      i++
      return inner
    }
    if (c === '[') {
      i++
      if (pattern[i] === '^') return undefined
      let first: string | undefined
      while (i < pattern.length && pattern[i] !== ']') {
        let ch = pattern[i] as string
        if (ch === '\\') {
          i++
          const e = pattern[i] ?? ''
          ch = e === 'd' ? '1' : e === 'w' ? 'a' : e === 's' ? ' ' : e
        }
        first ??= ch
        i++
      }
      i++
      return first
    }
    if (c === '\\') {
      i++
      const e = pattern[i++] ?? ''
      if (/[1-9bBkpP]/.test(e)) return undefined
      return e === 'd' ? '1' : e === 'w' ? 'a' : e === 's' ? ' ' : e === 'D' ? 'a' : e === 'W' ? '-' : e
    }
    if (c === '^' || c === '$') {
      i++
      return ''
    }
    i++
    return c === '.' ? 'a' : c
  }
  const quantified = (): string | undefined => {
    const base = atom()
    if (base === undefined) return undefined
    const q = pattern[i]
    let count = 1
    if (q === '*' || q === '?') {
      count = 0
      i++
    } else if (q === '+') i++
    else if (q === '{') {
      const m = /^\{(\d+)(,\d*)?\}/.exec(pattern.slice(i))
      if (!m) return undefined
      count = Number(m[1])
      i += m[0].length
    }
    if (pattern[i] === '?') i++
    return base.repeat(count)
  }
  const sequence = (): string | undefined => {
    let out = ''
    while (i < pattern.length && pattern[i] !== '|' && pattern[i] !== ')') {
      const part = quantified()
      if (part === undefined) return undefined
      out += part
    }
    return out
  }
  function alternation(): string | undefined {
    const first = sequence()
    while (pattern[i] === '|') {
      i++
      if (sequence() === undefined) return undefined
    }
    return first
  }
  const result = alternation()
  return result !== undefined && i === pattern.length ? result : undefined
}

/** The invalid value C6 would type into a field, derived from its stated constraints; for e-mail by purpose too. */
export function invalidFor(control: Pick<StepControl, 'type' | 'constraints' | 'purpose' | 'required'>): { value: string; constraint: SubmitConstraint; rule: string } | undefined {
  if (!TEXT_TYPES.has(control.type)) return undefined
  const c = control.constraints
  const numeric = control.type === 'tel' || control.type === 'number'
  if (control.type === 'email' || control.type === 'url') return { value: 'rampa', constraint: 'type', rule: `type="${control.type}"` }
  if (c.pattern) {
    const regex = compile(c.pattern)
    const value = regex ? ['a', '1', 'ab', '12', 'a1', 'A', 'rampa', '!', '123456789012345'].find((candidate) => !regex.test(candidate)) : undefined
    if (value) return { value, constraint: 'pattern', rule: `pattern="${c.pattern}"` }
  }
  const minLength = Number(c.minlength ?? 0)
  if (minLength >= 2) return { value: (numeric ? '1' : 'a').repeat(minLength - 1), constraint: 'minlength', rule: `minlength="${minLength}"` }
  const step = Number(c.step ?? '')
  if (control.type === 'number' && c.min !== undefined && Number.isFinite(Number(c.min))) return { value: String(Number(c.min) - (step > 0 ? step : 1)), constraint: 'min', rule: `min="${c.min}"` }
  if (control.type === 'number' && c.max !== undefined && Number.isFinite(Number(c.max))) return { value: String(Number(c.max) + (step > 0 ? step : 1)), constraint: 'max', rule: `max="${c.max}"` }
  if (control.purpose?.split(' ').at(-1) === 'email') return { value: 'rampa', constraint: 'purpose', rule: 'autocomplete="email"' }
  if (control.required) return { value: '', constraint: 'required', rule: control.required === 'label' ? 'a required mark in its label' : control.required === 'aria' ? 'aria-required="true"' : 'required' }
  return undefined
}

/** A synthetic value a field accepts, by its purpose, its type and its constraints; undefined when none is known. */
export function validFor(control: Pick<StepControl, 'type' | 'constraints' | 'purpose' | 'options'>): string | undefined {
  const c = control.constraints
  if (DATE_TYPES.has(control.type)) {
    if (control.type !== 'date') return undefined
    return c.min && c.min > '2026-01-15' ? c.min : c.max && c.max < '2026-01-15' ? c.max : '2026-01-15'
  }
  if (!TEXT_TYPES.has(control.type)) return undefined
  let value: string
  if (control.type === 'number') {
    const min = Number(c.min)
    const max = Number(c.max)
    value = c.min !== undefined && Number.isFinite(min) ? String(min) : c.max !== undefined && Number.isFinite(max) ? String(Math.min(max, 1)) : '1'
  } else if (control.type === 'url') value = 'https://example.com/rampa'
  else if (control.type === 'tel' && !control.purpose) value = '85999990000'
  else value = valueFor({ purpose: control.purpose, type: control.type === 'textarea' ? 'text' : control.type })
  const regex = c.pattern ? compile(c.pattern) : undefined
  if (regex && !regex.test(value)) {
    const sample = sampleFor(c.pattern ?? '')
    const fits = [sample, '12345-678', '12345678', '123.456.789-09', '(85) 99999-0000', '85999990000', 'AB12', 'Rampa'].find((candidate) => candidate !== undefined && regex.test(candidate))
    if (fits === undefined) return undefined
    value = fits
  }
  const minLength = Number(c.minlength ?? 0)
  if (value.length < minLength) value = value.padEnd(minLength, /^\d+$/.test(value) ? '0' : 'a')
  const maxLength = Number(c.maxlength ?? 0)
  if (maxLength > 0 && value.length > maxLength) value = value.slice(0, maxLength)
  return value
}

/** What the probe puts in each control of a form, for an invalid or a valid submission. */
export function planEntries(form: Pick<StepForm, 'controls'>, kind: 'invalid' | 'valid', origin: string): SubmitEntry[] {
  const entries: SubmitEntry[] = []
  const radios = new Set<string>()
  for (const control of form.controls) {
    if (!control.shows) continue
    const base = { ref: control.ref, name: control.name, label: control.label, type: control.type }
    if (control.type === 'radio') {
      // One radio per group, the first not on the skip list, when none is chosen.
      const group = control.name || control.ref
      if (radios.has(group) || form.controls.some((other) => other.type === 'radio' && (other.name || other.ref) === group && other.checked)) continue
      if (skipReason(control.facts, origin)) continue
      radios.add(group)
      entries.push({ ...base, value: 'on' })
      continue
    }
    if (control.type === 'checkbox') {
      // Only a required box is ticked, and never one that consents, agrees or confirms (the skip list).
      if (!control.required || control.checked || skipReason(control.facts, origin)) continue
      entries.push({ ...base, value: 'on' })
      continue
    }
    if (control.type === 'select') {
      // A select still on its placeholder (an option with no value) gets the next option.
      const options = control.options ?? []
      if (control.value === '' && options.length > 1) entries.push({ ...base, value: options[1] ?? '', option: 1 })
      continue
    }
    const invalid = kind === 'invalid' ? invalidFor(control) : undefined
    if (invalid) {
      entries.push({ ...base, value: invalid.value, constraint: invalid.constraint, rule: invalid.rule })
      continue
    }
    const value = validFor(control)
    if (value !== undefined) entries.push({ ...base, value })
  }
  return entries
}

/** Why a step's form is not submitted; undefined when it may be. */
export function stopFor(form: Pick<StepForm, 'submit' | 'sensitive' | 'captcha' | 'action' | 'method' | 'target'>, allowed: readonly string[]): SubmitFlow['stopped'] | undefined {
  // A control that commits is never pressed: that step is what 3.3.4 reads, payment fields or not.
  const kind = form.submit ? [form.submit.label, ...form.submit.facts.texts].map(commitmentOf).find((found) => found !== undefined) : undefined
  if (kind) return { reason: 'commit', detail: kind }
  if (form.sensitive) return { reason: 'sensitive', detail: 'a password, payment or file field' }
  if (form.captcha) return { reason: 'captcha' }
  if (!form.submit) return { reason: 'no-submit-control' }
  const word = submitSkipWord(form.submit.facts)
  if (word) return { reason: 'skip-list', detail: word }
  if (form.method === 'dialog') return { reason: 'no-submit-control', detail: 'method="dialog"' }
  // A submission into another window is one the probe could not follow; the activate class skips new windows too.
  if (form.target && !['_self', '_top', '_parent'].includes(form.target.toLowerCase())) return { reason: 'new-window', detail: `target="${form.target}"` }
  const action = originOf(form.action)
  if (!action || !allowed.includes(action)) return { reason: 'other-origin', detail: action || form.action.slice(0, 120) }
  return undefined
}

/** The skip-list word a submit control's name or code holds, the words that only name submitting set aside. */
export function submitSkipWord(facts: Pick<ControlFacts, 'texts' | 'code' | 'method'>): string | undefined {
  const neutral = (text: string) => {
    let folded = skipText(text)
    for (const phrase of NEUTRAL_PHRASES) folded = folded.replaceAll(` ${phrase} `, ' ')
    return folded
  }
  if (facts.method && facts.method.toLowerCase() !== 'post' && facts.method.toLowerCase() !== 'get') return `data-method="${facts.method}"`
  return destructiveWord(...facts.texts.map(neutral)) ?? destructiveCode(...facts.code)
}

const strip = (controls: ListedControl[]): StepControl[] => controls.map(({ facts: _facts, ...control }) => control)
const formOf = (form: StepForm) => ({ ref: form.ref, id: form.id, tag: form.tag, role: form.role, label: form.label, action: form.action.slice(0, 300), method: form.method })

/** Forms a flow may start from: not a site search, with a control or a submit button. */
function candidates(forms: StepForm[]): StepForm[] {
  return forms.filter((form) => !form.search && (form.controls.some((control) => control.shows) || form.submit !== undefined))
}

/** The kits again on a new document, and a settle. */
async function prepare(page: Page): Promise<void> {
  await page.evaluate(installKit)
  await page.evaluate(installActivateKit)
  await page.evaluate(settleInPage, { quietMs: 300, capMs: 3000 }).catch(() => undefined)
}

async function readPage(page: Page, values: string[]): Promise<PageFacts> {
  return page.evaluate(listPage, { reuse: REUSE_WORDS.source, required: REQUIRED_MARK.source, edit: EDIT_WORDS.source, values, maxControls: MAX_CONTROLS })
}

async function locate(page: Page, target: Pick<InPageElement, 'ref' | 'id'>): Promise<boolean> {
  return page
    .evaluate((args) => (window as unknown as { __rampaActivate?: { locate(a: { ref: string; sig: string }): boolean } }).__rampaActivate?.locate(args) ?? false, { ref: target.ref, sig: target.id.sig })
    .catch(() => false)
}

/** One flow's run: the page, its guard's counts, the log and the budget shared by every flow of the page. */
interface Run {
  allowed: string[]
  origin: string
  started: number
  actions: HarnessAction[]
  /** Every fresh page's guard log, on the run's clock. */
  guard: ProbeRecord['guard']
  writes: number
  loads: number
  found: number
  viewport: { width: number; height: number }
  end: SubmitData['end']
}

/** A page's guard log joins the run's, on the run's clock. */
function mergeGuard(run: Run, probe: ProbePage): void {
  const shift = probe.guard.start - run.started
  for (const entry of probe.guard.log.blocked) run.guard.blocked.push({ ...entry, at: entry.at + shift })
  for (const entry of probe.guard.log.navigations) run.guard.navigations.push({ ...entry, at: entry.at + shift })
  for (const entry of probe.guard.log.dialogs) run.guard.dialogs.push({ ...entry, at: entry.at + shift })
  for (const entry of probe.guard.log.submitted ?? []) (run.guard.submitted ??= []).push({ ...entry, at: entry.at + shift })
}

const log = (run: Run, action: HarnessAction['action'], fields: Omit<HarnessAction, 'at' | 'action'> = {}) =>
  run.actions.push({ at: Date.now() - run.started, action, ...Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined && value !== '')) })
const timeLeft = (run: Run) => Date.now() - run.started < SUBMIT_LIMITS.timeMs

/** Types, chooses or ticks each entry, as a person would: focus, select all, erase, type, leave. */
async function fill(page: Page, form: StepForm, entries: SubmitEntry[]): Promise<void> {
  for (const entry of entries) {
    const control = form.controls.find((c) => c.ref === entry.ref)
    if (!control || !(await locate(page, control))) continue
    if (entry.type === 'checkbox' || entry.type === 'radio') {
      await page.evaluate(checkTarget).catch(() => false)
      continue
    }
    if (entry.type === 'select') {
      await page.evaluate((args) => {
        const select = (window as unknown as { __rampaTarget?: Element | null }).__rampaTarget as HTMLSelectElement | null
        const option = select?.options[args.i]
        if (!select || !option) return
        select.selectedIndex = args.i
        select.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
        select.dispatchEvent(new Event('change', { bubbles: true }))
      }, { i: entry.option ?? 0 })
      continue
    }
    if (DATE_TYPES.has(entry.type)) {
      await page.evaluate(setValue, { value: entry.value }).catch(() => false)
      continue
    }
    if (!(await page.evaluate(focusTarget).catch(() => false))) continue
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.press('Backspace')
    if (entry.value) await page.keyboard.type(entry.value, { delay: 5 })
    await page.evaluate(blurTarget).catch(() => undefined)
  }
}

/** Waits until the page's own requests have been quiet for a while, at most a few seconds. */
async function quietRequests(page: Page, pending: () => number): Promise<void> {
  const until = Date.now() + QUIET_CAP_MS
  let quietSince = Date.now()
  while (Date.now() < until) {
    if (pending() > 0) quietSince = Date.now()
    else if (Date.now() - quietSince >= QUIET_MS) return
    await page.waitForTimeout(100)
  }
}

/**
 * The one press that submits: the guard's window opens, the page's hook lets the form's submission go, the control is
 * clicked where it shows, and the window closes once the answer has loaded (a navigation) or the page's requests are
 * quiet (a script's fetch). Nothing else ever opens the window.
 */
async function press(probe: ProbePage, form: StepForm, run: Run): Promise<Pick<Submission, 'requests' | 'blocked' | 'ms'> & { navigated: boolean; reason?: string | undefined }> {
  const page = probe.page
  const submit = form.submit
  const begun = Date.now()
  if (!submit || !(await locate(page, submit))) return { requests: [], blocked: 0, ms: 0, navigated: false, reason: 'the submit control is gone' }
  const aimed = await page
    .evaluate(() => (window as unknown as { __rampaActivate?: { aim(a: object): { x: number; y: number } | { cover: { tag: string; text: string } } | { hidden: true } } }).__rampaActivate?.aim({}) ?? { hidden: true as const })
    .catch(() => ({ hidden: true as const }))
  if (!('x' in aimed)) {
    const reason = 'cover' in aimed ? `covered by <${aimed.cover.tag}> "${aimed.cover.text.slice(0, 60)}"` : 'the submit control does not show'
    return { requests: [], blocked: 0, ms: 0, navigated: false, reason }
  }
  const writesBefore = probe.guard.log.submitted?.length ?? 0
  const blockedBefore = probe.guard.log.blocked.length
  const main = page.mainFrame()
  let navigation: Request | undefined
  let pending = 0
  const onRequest = (request: Request) => {
    if (request.isNavigationRequest() && request.frame() === main) navigation ??= request
    if (['fetch', 'xhr', 'document'].includes(request.resourceType())) pending++
  }
  const onDone = (request: Request) => {
    if (['fetch', 'xhr', 'document'].includes(request.resourceType())) pending = Math.max(0, pending - 1)
  }
  page.on('request', onRequest)
  page.on('requestfinished', onDone)
  page.on('requestfailed', onDone)
  const loaded = page.waitForEvent('load', { timeout: ANSWER_MS }).then(
    () => true,
    () => false,
  )
  probe.guard.openSubmit()
  try {
    await page.evaluate(() => {
      ;(window as unknown as { __rampaSubmit?: boolean }).__rampaSubmit = true
    })
    log(run, 'submit', { ref: submit.ref, label: submit.label, detail: `pressed "${submit.label}" (${form.method.toUpperCase()} ${form.action.slice(0, 120)})` })
    await page.mouse.click(aimed.x, aimed.y)
    const until = Date.now() + NAVIGATION_START_MS
    while (Date.now() < until && !navigation && pending === 0) await page.waitForTimeout(100)
    // A script's fetch may end in a navigation of its own: the window stays open until that one has loaded too.
    if (!navigation) await quietRequests(page, () => pending)
    if (navigation) await loaded
  } finally {
    probe.guard.closeSubmit()
    page.off('request', onRequest)
    page.off('requestfinished', onDone)
    page.off('requestfailed', onDone)
    await page
      .evaluate(() => {
        ;(window as unknown as { __rampaSubmit?: boolean }).__rampaSubmit = false
      })
      .catch(() => undefined)
  }
  const passed = (probe.guard.log.submitted ?? []).slice(writesBefore)
  run.writes += passed.length
  // The answer's status: the last response of the navigation's redirects.
  let status: number | undefined
  if (navigation) {
    let last: Request = navigation
    for (let next = last.redirectedTo(); next; next = next.redirectedTo()) last = next
    status = (await last.response().catch(() => null))?.status()
  }
  const requests = passed.map((entry, i) => ({ method: entry.method, url: entry.url, ...(i === 0 && status !== undefined ? { status } : {}) }))
  for (const request of requests) log(run, 'submit', { detail: `sent: ${request.method} ${request.url}${request.status !== undefined ? ` → ${request.status}` : ''}` })
  return { requests, blocked: probe.guard.log.blocked.length - blockedBefore, ms: Date.now() - begun, navigated: navigation !== undefined }
}

/** The form on the page that came back that is the same step: one that holds at least half of the step's named controls. */
function sameForm(step: StepForm, facts: PageFacts): StepForm | undefined {
  const names = step.controls.map((control) => control.name).filter(Boolean)
  return facts.forms.find((form) => {
    if (names.length === 0) return form.submit?.label === step.submit?.label && form.action === step.action
    const kept = form.controls.filter((control) => names.includes(control.name)).length
    return kept >= Math.ceil(names.length / 2)
  })
}

const collapse = (text: string) => text.replace(/\s+/g, ' ').trim()

/** One submission of a step's form, and what came back. */
async function submitOnce(probe: ProbePage, form: StepForm, kind: Submission['kind'], arrival: PageFacts, run: Run): Promise<{ submission: Submission; facts?: PageFacts | undefined; next?: StepForm | undefined }> {
  const page = probe.page
  const entries = planEntries(form, kind, run.origin)
  log(run, 'activate', { ref: form.ref, label: form.label, detail: `${kind === 'invalid' ? 'invalid' : 'valid'} entries in ${entries.length} control(s)` })
  await fill(page, form, entries)
  let noValidate = false
  if (kind === 'invalid' && form.submit && (await locate(page, form.submit))) {
    // Only for the invalid entries: the browser's own validation would stop them before the server sees them.
    await page.evaluate(setNoValidate, { on: true }).catch(() => false)
    noValidate = true
  }
  const pressed = await press(probe, form, run)
  const base = { kind, entries, noValidate, requests: pressed.requests, blocked: pressed.blocked, ms: pressed.ms }
  if (pressed.reason) {
    log(run, 'not-exercised', { ref: form.submit?.ref, label: form.submit?.label, detail: pressed.reason })
    return { submission: { ...base, outcome: 'not-exercised', reason: pressed.reason, url: page.url() } }
  }
  const url = page.url()
  if (!run.allowed.includes(originOf(url))) {
    log(run, 'navigation', { detail: `left the allowed origin for ${url.slice(0, 200)}; the flow stops` })
    return { submission: { ...base, outcome: 'other-origin', url } }
  }
  await prepare(page).catch(() => undefined)
  const facts = await readPage(page, [])
  const fresh = (text: string) => !collapse(arrival.body).includes(collapse(text))
  const alerts = facts.alerts.filter(fresh)
  const same = sameForm(form, facts)
  if (same) {
    if (pressed.requests.length === 0 && !pressed.navigated && alerts.length === 0 && kind === 'valid') {
      return { submission: { ...base, outcome: 'no-answer', url, reason: 'nothing was sent: the page or the browser held the submission' }, facts, next: same }
    }
    const fields: SubmittedField[] = []
    const cleared: string[] = []
    for (const entry of entries) {
      const before = form.controls.find((c) => c.ref === entry.ref)
      const now = same.controls.find((c) => c.name !== '' && c.name === entry.name) ?? same.controls.find((c) => c.ref === entry.ref)
      if (!before) continue
      if (!entry.constraint) {
        if (TEXT_TYPES.has(entry.type) && entry.value !== '' && now && now.value === '') cleared.push(entry.label || entry.name)
        continue
      }
      const field: SubmittedField = { name: entry.name, ref: before.ref, id: before.id, label: before.label, constraint: entry.constraint, rule: entry.rule ?? '', typed: entry.value, constraints: before.constraints }
      if (!now) {
        fields.push({ ...field, gone: true })
        continue
      }
      const after = await readAfter(probe, now.ref).catch(() => undefined)
      fields.push({ ...field, value: now.value, ...(after ? { after, fresh: after.messages.filter((m) => fresh(m.text)).map((m) => m.ref) } : {}) })
    }
    return { submission: { ...base, outcome: 'same-step', url, fields, ...(alerts.length > 0 ? { alerts } : {}), ...(cleared.length > 0 ? { cleared } : {}) }, facts, next: same }
  }
  const next = candidates(facts.forms)[0]
  return { submission: { ...base, outcome: next ? 'next-step' : 'ended', url, ...(alerts.length > 0 ? { alerts } : {}) }, facts, ...(next ? { next } : {}) }
}

function stepOf(index: number, facts: PageFacts, form: StepForm): SubmitStep {
  return { index, url: facts.url.slice(0, 300), title: facts.title, heading: facts.heading, form: formOf(form), ...(form.submit ? { control: form.submit.label } : {}), controls: strip(form.controls), reuse: form.reuse, submissions: [] }
}

/** Values given on earlier steps, for a later step to show again or fill in: four characters or more. */
function enteredValues(flow: SubmitFlow): string[] {
  const values = flow.steps.flatMap((step) => step.submissions.filter((s) => s.outcome === 'next-step' || s.outcome === 'ended').flatMap((s) => s.entries))
  return [...new Set(values.filter((entry) => TEXT_TYPES.has(entry.type) && entry.value.length >= 4).map((entry) => entry.value))]
}

/** The budget of the page, spent: time, or the writes the guard may let through. */
function budgetStop(run: Run): SubmitFlow['stopped'] | undefined {
  if (timeLeft(run) && run.writes < SUBMIT_LIMITS.writes) return undefined
  const reason = timeLeft(run) ? 'budget' : 'time'
  if (run.end === 'complete') run.end = reason
  return { reason }
}

/**
 * One form of the first page, on a fresh page of its own, followed step by step until it stops. The flow joins `flows`
 * as soon as it starts, so what it submitted stays on record even when the probe fails half-way; false when there was
 * no such form.
 */
async function runFlow(browser: Browser, url: string, options: ProbeOptions, which: number, run: Run, flows: SubmitFlow[]): Promise<boolean> {
  const probe = await openProbePage(browser, url, options, { variant: 'submit', allowSubmit: run.allowed })
  run.loads++
  log(run, 'load', { detail: run.loads === 1 ? probe.page.url() : `fresh page ${run.loads}` })
  try {
    const page = probe.page
    run.viewport = page.viewportSize() ?? probe.conditions.viewport
    if (!run.allowed.includes(originOf(page.url()))) {
      log(run, 'skip', { detail: `the page landed on ${page.url().slice(0, 200)}, an origin --allow-submit does not name` })
      return false
    }
    await page.evaluate(installActivateKit)
    let facts = await readPage(page, [])
    const forms = candidates(facts.forms)
    run.found = forms.length
    let form = forms[which]
    if (!form) return false
    // Every way out of the loop below says why it stopped; an error leaves this.
    const flow: SubmitFlow = { form: formOf(form), steps: [], stopped: { reason: 'not-exercised', detail: 'the probe stopped on an error' } }
    flows.push(flow)
    for (let index = 1; ; index++) {
      if (index > SUBMIT_LIMITS.steps) {
        flow.stopped = { reason: 'steps', detail: `${SUBMIT_LIMITS.steps} steps` }
        break
      }
      const step = stepOf(index, facts, form)
      flow.steps.push(step)
      let moved = false
      for (const kind of ['invalid', 'valid'] as const) {
        // Checked before every press: the form that comes back may carry another control, action or field.
        const stop = stopFor(form, run.allowed) ?? budgetStop(run)
        if (stop) {
          flow.stopped = stop
          log(run, 'skip', { ref: form.submit?.ref ?? form.ref, label: form.submit?.label ?? form.label, detail: `${stop.reason}${stop.detail ? `: ${stop.detail}` : ''}; never pressed` })
          if (stop.reason === 'commit') {
            const values = enteredValues(flow)
            const shown = values.length > 0 ? await readPage(page, values) : facts
            flow.commit = { step: index, control: form.submit?.label ?? '', kind: stop.detail ?? '', checkboxes: form.checkboxes, texts: shown.texts, echoed: shown.echoed, entered: values.length, edit: shown.edit }
          }
          break
        }
        if (kind === 'invalid' && !planEntries(form, 'invalid', run.origin).some((entry) => entry.constraint)) continue
        const arrival = facts
        const { submission, facts: after, next } = await submitOnce(probe, form, kind, arrival, run)
        step.submissions.push(submission)
        if (submission.outcome === 'same-step' && after && next) {
          facts = after
          form = next
          if (kind === 'valid') {
            flow.stopped = { reason: 'no-progress', detail: 'the form came back after the valid entries' }
            break
          }
          continue
        }
        if (submission.outcome === 'next-step' && after && next) {
          facts = after
          form = next
          moved = true
          break
        }
        flow.stopped =
          submission.outcome === 'ended'
            ? { reason: 'ended', detail: after?.heading || after?.title || undefined }
            : { reason: submission.outcome === 'other-origin' ? 'other-origin' : submission.outcome === 'no-answer' ? 'no-answer' : 'not-exercised', detail: submission.reason ?? submission.url.slice(0, 200) }
        break
      }
      if (!moved) break
    }
    return true
  } finally {
    mergeGuard(run, probe)
    await probe.context.close().catch(() => undefined)
  }
}

/** --submit-dry-run: the forms of the first page, and what the probe would put in each control; nothing is sent. */
async function dryRun(browser: Browser, url: string, options: ProbeOptions, run: Run): Promise<SubmitData> {
  const probe = await openProbePage(browser, url, options, { variant: 'submit' })
  run.loads++
  try {
    const page = probe.page
    await page.evaluate(installActivateKit)
    const facts = await readPage(page, [])
    const forms = candidates(facts.forms)
    const flows: SubmitFlow[] = forms.slice(0, SUBMIT_LIMITS.flows).map((form) => {
      const step = stepOf(1, facts, form)
      step.planned = { invalid: planEntries(form, 'invalid', run.origin), valid: planEntries(form, 'valid', run.origin) }
      return { form: formOf(form), steps: [step], stopped: stopFor(form, run.allowed) ?? { reason: 'dry-run' } }
    })
    return { viewport: page.viewportSize() ?? probe.conditions.viewport, allowed: run.allowed, origin: run.origin, dryRun: true, found: forms.length, flows, writes: 0, loads: run.loads, actions: run.actions, end: 'complete' }
  } finally {
    mergeGuard(run, probe)
    await probe.context.close().catch(() => undefined)
  }
}

/** D5 on one page: each form of the page followed (three at most), or, with --submit-dry-run, only listed. */
export async function runSubmitProbe(browser: Browser, url: string, options: ProbeOptions): Promise<ProbeRecord> {
  const allowed = [...(options.allowSubmit ?? [])]
  const origin = originOf(url)
  const run: Run = { allowed, origin, started: Date.now(), actions: [], guard: { blocked: [], navigations: [], dialogs: [] }, writes: 0, loads: 0, found: 0, viewport: { width: 0, height: 0 }, end: 'complete' }
  const empty = (dryRun: boolean): SubmitData => ({ viewport: { width: 0, height: 0 }, allowed, origin, dryRun, found: 0, flows: [], writes: 0, loads: 0, actions: [], end: 'complete' })
  const conditions = (data: SubmitData): ProbeRecord['conditions'] => ({ viewport: data.viewport, deviceScaleFactor: 1, browser: `${browser.browserType().name()} ${browser.version()} (headless)`, variant: 'submit' })
  if (options.submitDryRun) {
    const data = await dryRun(browser, url, options, run)
    return { kind: 'form', version: SUBMIT_VERSION, conditions: conditions(data), status: 'skipped', reason: 'dry run (--submit-dry-run): nothing was submitted', guard: run.guard, durationMs: Date.now() - run.started, data }
  }
  if (!origin || !allowed.includes(origin)) {
    const why = origin ? `the page's origin ${origin} is not one --allow-submit names (${allowed.join(', ')})` : 'a page with no http(s) origin (a local file) is never submitted'
    return { ...skippedRecord('form', SUBMIT_VERSION, 'submit', `${why}; nothing was submitted`, 0), data: empty(false) }
  }
  const data = empty(false)
  let failure: string | undefined
  for (let which = 0; which < SUBMIT_LIMITS.flows; which++) {
    if (!timeLeft(run)) {
      run.end = 'time'
      break
    }
    try {
      if (!(await runFlow(browser, url, options, which, run, data.flows))) break
    } catch (error) {
      // What went out before the error is in the guard's log, merged as the page closed: the record keeps it.
      failure = (error instanceof Error ? error.message : String(error)).split('\n')[0]
      log(run, 'not-exercised', { detail: `the probe failed: ${failure}; no further form is submitted` })
      break
    }
    // No other form on the page: no fresh page for nothing.
    if (which + 1 >= run.found) break
  }
  data.found = run.found
  data.writes = run.writes
  data.loads = run.loads
  data.actions = run.actions.sort((a, b) => a.at - b.at)
  data.end = run.end
  data.viewport = run.viewport
  for (const list of [run.guard.blocked, run.guard.navigations, run.guard.dialogs, run.guard.submitted ?? []]) list.sort((a, b) => a.at - b.at)
  const reason = failure
    ? `probe failed: ${failure}; no further form was submitted`
    : run.end === 'budget'
      ? `budget reached (${SUBMIT_LIMITS.writes} writes)`
      : run.end === 'time'
        ? `time budget reached (${SUBMIT_LIMITS.timeMs / 1000} s)`
        : undefined
  return { kind: 'form', version: SUBMIT_VERSION, conditions: conditions(data), status: reason ? 'partial' : 'complete', ...(reason ? { reason } : {}), guard: run.guard, durationMs: Date.now() - run.started, data }
}

const quoted = (value: string) => `"${value.length > 40 ? `${value.slice(0, 39)}…` : value}"`

/** One line per entry: `email = "rampa" (breaks type="email")`. */
function entriesText(entries: readonly SubmitEntry[]): string {
  if (entries.length === 0) return 'nothing to fill in'
  return entries.map((entry) => `${entry.name || entry.label || entry.ref} = ${entry.type === 'checkbox' || entry.type === 'radio' ? 'checked' : quoted(entry.value)}${entry.rule ? ` (breaks ${entry.rule})` : ''}`).join('; ')
}

/**
 * What the CLI prints on stderr after the probe ran on a page: with --submit-dry-run, the forms and every value the
 * probe would send; otherwise what the guard let through and where each form stopped. English, like Rampa's other
 * stderr lines.
 */
export function describeSubmitRecord(record: ProbeRecord, url: string): string[] {
  const data = (record.data ?? {}) as Partial<SubmitData>
  const flows = Array.isArray(data.flows) ? data.flows : []
  const allowed = Array.isArray(data.allowed) ? data.allowed : []
  const origin = data.origin || originOf(url)
  const stopText = (stop: SubmitFlow['stopped']) =>
    stop.reason === 'commit'
      ? `stops at a control that commits (${stop.detail}): never pressed`
      : stop.reason === 'dry-run'
        ? ''
        : `${stop.reason === 'ended' || stop.reason === 'no-progress' ? 'ended' : 'never submitted'} (${stop.reason}${stop.detail ? `: ${stop.detail}` : ''})`
  if (data.dryRun) {
    const named = origin !== '' && allowed.includes(origin)
    const lines = [`rampa: --submit-dry-run on ${url}: nothing was submitted. Origin ${origin || '(none)'} ${named ? 'is named by --allow-submit' : 'is not named by --allow-submit, so nothing would be sent'}.`]
    if (flows.length === 0) lines.push('  no form to submit on this page')
    for (const flow of flows) {
      const step = flow.steps[0]
      lines.push(`  form ${quoted(flow.form.label || flow.steps[0]?.heading || '(unnamed)')} → ${flow.form.method.toUpperCase()} ${flow.form.action}${step?.control ? `, pressing ${quoted(step.control)}` : ''}`)
      const stop = stopText(flow.stopped)
      if (stop) {
        lines.push(`    ${stop}`)
        continue
      }
      if (step?.planned) {
        if (step.planned.invalid.some((entry) => entry.constraint)) lines.push(`    1. invalid entries, the browser's own validation off: ${entriesText(step.planned.invalid)}`)
        lines.push(`    ${step.planned.invalid.some((entry) => entry.constraint) ? '2' : '1'}. valid entries: ${entriesText(step.planned.valid)}`)
        lines.push('    then the same on each step that follows, until a control that commits, which is never pressed')
      }
    }
    return lines
  }
  if (record.status === 'skipped') return [`rampa: --allow-submit: nothing was submitted on ${url}: ${(record.reason ?? 'skipped').replace(/; nothing (more )?was submitted$/, '')}.`]
  const sent = Array.isArray(record.guard.submitted) ? record.guard.submitted : []
  const requests = sent.map((entry) => `${entry.method} ${originOf(entry.url) === origin ? entry.url.slice(origin.length) || '/' : entry.url}`)
  const lines = [
    `rampa: --allow-submit: ${sent.length} request(s) let through to ${origin} on ${url}${requests.length > 0 ? `: ${requests.slice(0, 8).join(', ')}${requests.length > 8 ? ', …' : ''}` : ''}; ${record.guard.blocked.length} blocked.`,
  ]
  for (const flow of flows) lines.push(`  form ${quoted(flow.form.label || flow.steps[0]?.heading || '(unnamed)')}: ${flow.steps.length} step(s); ${stopText(flow.stopped)}`)
  return lines
}

/** The form probe (C6), then its submissions (D5) when --allow-submit or --submit-dry-run asks for them. */
export async function formAndSubmitProbes(browser: Browser, url: string, options: ProbeOptions): Promise<ProbeRecord[]> {
  const records = await formProbe(browser, url, options)
  if ((options.allowSubmit?.length ?? 0) === 0 && !options.submitDryRun) return records
  const started = Date.now()
  try {
    records.push(await runSubmitProbe(browser, url, options))
  } catch (error) {
    records.push(skippedRecord('form', SUBMIT_VERSION, 'submit', `probe failed: ${(error instanceof Error ? error.message : String(error)).split('\n')[0]}; nothing more was submitted`, Date.now() - started))
  }
  return records
}
