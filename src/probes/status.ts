import type { Browser, CDPSession, Page } from 'playwright-core'
import type { ProbeRecord } from '../snapshot/schema.ts'
import { liveAxFacts } from '../surfaces/ax-tree.ts'
import { type ControlFacts, Harness, type HarnessAction, type SkipReason, type Watch, destructiveWord, skipReason } from './activate.ts'
import { blurTarget, chooseOption, focusTarget, staleOption } from './input.ts'
import type { InPageElement, InPageIdentity } from './kit.ts'
import { type ProbeOptions, type ProbePage, skippedRecord } from './page.ts'

/**
 * Status messages (4.1.3), on the activate-class harness (activate.ts): the coverage plan's C5. The probe sets off what
 * the plan calls safe triggers, each on a page where nothing else was done: a form field is typed into and left
 * (validation on blur), a GET search form gets a query and Enter (its own submission is cancelled by the hooks, as
 * always; only a script that searches in place can answer), and client-only controls are used once: a copy, filter,
 * sort, add-to-list or load-more button clicked, a filter or sort select or checkbox changed. Nothing is submitted.
 *
 * Before and after each trigger it records the text the page shows, element by element, and the text of every live
 * region; what changed in a wait with no input before is noise. The text that appeared after the trigger is grouped into
 * messages (the element added with it, or the block whose text changed), and for each the probe records whether focus
 * is in it, whether it sits in a dialog, in a live region (the page's markup, and what the browser exposes over the
 * DevTools protocol for it and its ancestors), whether a live region received the same words, how big it is, and
 * whether it is tied to the field by aria-describedby. Facts only: the F103 triage is the rule's
 * (rules/status-messages.ts), and whether a message is a status message is the 4.1.3 judgment's.
 */

export const STATUS_VERSION = '1'
/** Triggers per page, and time. */
export const STATUS_LIMITS = { controls: 20, timeMs: 150_000 }
const MAX_LISTED = 80
const MAX_FIELDS = 8
const MAX_SEARCH = 2
const MAX_CONTROLS = 10
/** Controls built alike (same tag, classes and name): only this many are tried. */
const MAX_ALIKE = 2
/** Messages recorded per trigger; the rest are counted. */
const MAX_MESSAGES = 6
/** The wait with no input before each trigger, whose changes are noise. */
const IDLE_MS = 500
/** The wait after the trigger's change: what changes again in it with no input (a clock) is noise. */
const RECHECK_MS = 1000

export type TriggerKind = 'blur' | 'search' | 'control' | 'setting'

export interface StatusTrigger extends InPageElement {
  trigger: TriggerKind
  /** What made it one: the field's type and constraints, the search form, the word of the control's name. */
  why: string
  type?: string | undefined
  /** blur: the value typed (empty: typed and erased, to leave a required field empty); search: the query. */
  value?: string | undefined
  /** setting: the option chosen (a select), or the checkbox clicked through its label. */
  choice?: { i: number; label: string } | undefined
  via?: 'label' | undefined
  skip?: { reason: SkipReason | 'no-choice'; detail?: string | undefined } | undefined
  trial?: StatusTrial | undefined
}

/** A live region around a message, as the page's markup has it. */
export interface LiveRegion {
  ref: string
  role: string
  /** polite, assertive, or off (a timer or a marquee). */
  politeness: string
  /** The region itself was added with the message. */
  added?: boolean | undefined
}

/** Text that appeared after a trigger, grouped by the element that holds it. */
export interface StatusMessage extends InPageElement {
  text: string
  /** The element was added with its text; otherwise its text changed, or it showed. */
  added: boolean
  /** It shows (not hidden the screen-reader-only way). */
  visible: boolean
  chars: number
  /** Links, buttons and fields in it. */
  controls: number
  /** List items, options, rows and articles in it. */
  items: number
  /** Focus is in it, or on it. */
  focus?: boolean | undefined
  /** It sits in a dialog. */
  dialog?: boolean | undefined
  live?: LiveRegion | undefined
  /** What the browser exposes around it: the nearest node with a live politeness or a status, alert or log role; null for none. */
  ax?: { role: string; live?: string | undefined } | null | undefined
  /** The field that was left names it with aria-describedby or aria-errormessage. */
  describedBy?: boolean | undefined
  /** It sits in a label of the field that was left (its own label, or what its aria-labelledby names): part of the field's name. */
  inLabel?: boolean | undefined
  /** The elements around it, nearest first: where a finding goes when the message itself is not in the snapshot. */
  ancestors: Array<{ ref: string; id: InPageIdentity; tag: string }>
}

export interface Announcement {
  ref: string
  role: string
  text: string
  /** The live region was added with its text. */
  added: boolean
}

export interface StatusTrial {
  outcome?: 'not-exercised' | 'unmatched' | 'not-tried' | 'no-focus' | undefined
  reason?: string | undefined
  cover?: (InPageElement & { text: string }) | undefined
  /** What the probe did: `typed "a" and left the field`, `typed "kettle" and pressed Enter`, `clicked`. */
  action?: string | undefined
  watch?: Watch | undefined
  messages?: StatusMessage[] | undefined
  /** Messages past MAX_MESSAGES, counted. */
  more?: number | undefined
  /** Live regions whose text changed. */
  announced?: Announcement[] | undefined
  /** Elements whose text changed in the wait with no input before: left out. */
  noise?: number | undefined
  /** The field is aria-invalid after it was left. */
  invalid?: boolean | undefined
}

export interface StatusData {
  viewport: { width: number; height: number }
  /** Triggers found: fields, search forms, client-only controls. */
  found: number
  triggers: StatusTrigger[]
  tried: number
  loads: number
  /** The live regions on the first load, as the page's markup has them, with their text. */
  regions: Array<LiveRegion & { text: string }>
  /** Controls built like two others already listed: not tried. */
  alike?: number | undefined
  actions: HarnessAction[]
  end: 'complete' | 'budget' | 'time'
}

/**
 * Words of a control used without submitting anything: copy, filter, sort, add to a list or a comparison, load more.
 * Adding to favourites, a wish list or a collection writes to an account: such a control is no trigger, and the skip
 * list names favourites and wish lists.
 */
export const CLIENT_WORDS =
  /(^|\s)(copy|copiar|filter|filters|filtrar|filtro|filtros|sort|sort by|ordenar|ordem|classificar|order by|add to (list|compare)|adicionar (à|a|aos) (lista|comparação)|añadir a la lista|agregar a la lista|load more|show more|see more results|carregar mais|mostrar mais|ver mais resultados|cargar más|mostrar más|apply|aplicar|clear filters|limpar filtros|borrar filtros|check availability|calculate|calcular|simular|verificar disponibilidade)(\s|$)/i
/** Words that make a select or a checkbox a filter or a sort. */
export const SETTING_WORDS = /\b(filter|filtr\w*|sort\w*|order by|ordenar|ordem|classificar|categor\w*|price|preço|precio|brand|marca|size|tamanho|tamaño|colou?r|cor)\b/i
/** Names of a search field. */
const SEARCH_NAMES = /^(q|query|s|search|searchterm|search_query|busca|buscar|pesquisa|pesquisar|termo|term|k|keyword|keywords|text)$/i
const SEARCH_WORDS = /\b(search|busca|buscar|pesquisa|pesquisar|procurar)\b/i

/** Runs in the page; needs the kit and the activate kit. The safe triggers that show. */
export function findStatusTriggers(args: {
  max: number
  client: string
  setting: string
  searchNames: string
  searchWords: string
  maxFields: number
  maxSearch: number
  maxControls: number
  maxAlike: number
}): {
  found: number
  triggers: Array<StatusTrigger & { facts: ControlFacts }>
  regions: Array<LiveRegion & { text: string }>
  alike: number
} {
  const w = window as unknown as {
    __rampaKit: { describe(el: Element): InPageElement; visible(el: Element): boolean }
    __rampaActivate: { facts(el: Element): ControlFacts }
  }
  const kit = w.__rampaKit
  const CLIENT = new RegExp(args.client, 'i')
  const SETTING = new RegExp(args.setting, 'i')
  const SEARCH_NAMES = new RegExp(args.searchNames, 'i')
  const SEARCH = new RegExp(args.searchWords, 'i')
  const collapse = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim()
  const cut = (value: string, n: number) => (value.length > n ? `${value.slice(0, n - 1)}…` : value)
  const showing = (el: Element) => {
    if (!kit.visible(el)) return false
    const r = el.getBoundingClientRect()
    return r.width >= 2 && r.height >= 2
  }
  const labelOf = (el: Element): Element | undefined => Array.from((el as HTMLInputElement).labels ?? []).find((l) => showing(l))
  const nameOf = (el: Element): string => {
    const labelled = collapse(
      (el.getAttribute('aria-labelledby') ?? '')
        .split(/\s+/)
        .filter(Boolean)
        .map((id) => document.getElementById(id)?.textContent ?? '')
        .join(' '),
    )
    const labels = Array.from((el as HTMLInputElement).labels ?? [])
      .map((l) => collapse((l as HTMLElement).innerText ?? l.textContent))
      .join(' ')
    return collapse(el.getAttribute('aria-label') || labelled || labels || el.getAttribute('title') || el.getAttribute('placeholder') || '')
  }
  const triggers: Array<StatusTrigger & { facts: ControlFacts }> = []
  let found = 0
  const push = (el: Element, trigger: Omit<StatusTrigger, keyof InPageElement>, label: string) => {
    found++
    const described = kit.describe(el)
    triggers.push({ ...described, label: cut(label || described.label, 80), ...trigger, facts: w.__rampaActivate.facts(el) })
  }

  // Search forms: one text field, GET, no secret fields.
  const searchFields = new Set<Element>()
  let searches = 0
  for (const form of Array.from(document.forms)) {
    if (searches >= args.maxSearch) break
    if ((form.getAttribute('method') ?? 'get').toLowerCase() !== 'get') continue
    const fields = Array.from(form.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=checkbox]):not([type=radio]):not([type=reset]):not([type=image]), textarea')).filter((f) => showing(f))
    if (fields.length !== 1) continue
    const field = fields[0] as HTMLInputElement
    const type = (field.getAttribute('type') ?? 'text').toLowerCase()
    if (!['text', 'search', ''].includes(type) || field.readOnly || field.disabled) continue
    const words = [field.name, field.id, nameOf(field), form.getAttribute('role') ?? '', form.getAttribute('aria-label') ?? '', form.action].join(' ')
    if (type !== 'search' && !SEARCH_NAMES.test(field.name) && !SEARCH.test(words) && form.getAttribute('role') !== 'search' && !form.closest('[role=search]')) continue
    searchFields.add(field)
    searches++
    push(field, { trigger: 'search', why: type === 'search' ? 'type=search' : 'a search form (GET)', type }, nameOf(field))
  }

  // Fields left after typing: validation on blur. Those with constraints first.
  const fields: Array<{ el: HTMLInputElement; weight: number }> = []
  for (const el of Array.from(document.querySelectorAll('input, textarea'))) {
    const input = el as HTMLInputElement
    if (searchFields.has(el) || input.readOnly || input.disabled || !showing(el)) continue
    const type = (el.getAttribute('type') ?? (el.localName === 'textarea' ? 'textarea' : 'text')).toLowerCase()
    if (!['text', 'email', 'url', 'tel', 'number', 'textarea', ''].includes(type)) continue
    const constrained = ['email', 'url', 'tel', 'number'].includes(type) || input.required || el.getAttribute('aria-required') === 'true' || el.hasAttribute('pattern') || el.hasAttribute('minlength')
    fields.push({ el: input, weight: constrained ? 0 : 1 })
  }
  fields.sort((a, b) => a.weight - b.weight)
  for (const { el } of fields.slice(0, args.maxFields)) {
    const type = (el.getAttribute('type') ?? (el.localName === 'textarea' ? 'textarea' : 'text')).toLowerCase()
    const numeric = type === 'tel' || type === 'number' || /^(numeric|decimal|tel)$/i.test(el.getAttribute('inputmode') ?? '')
    const required = el.required || el.getAttribute('aria-required') === 'true'
    const formatted = ['email', 'url', 'tel', 'number'].includes(type) || el.hasAttribute('pattern') || el.hasAttribute('minlength')
    // An invalid value where the field states a format; left empty where it is only required.
    const value = formatted ? (numeric ? '1' : 'a') : required ? '' : numeric ? '1' : 'a'
    const why = [type, required ? 'required' : '', el.hasAttribute('pattern') ? 'pattern' : '', el.hasAttribute('minlength') ? `minlength=${el.getAttribute('minlength')}` : ''].filter(Boolean).join(', ')
    push(el, { trigger: 'blur', why, type, value }, nameOf(el))
  }
  found += Math.max(0, fields.length - args.maxFields)

  // Client-only controls: copy, filter, sort, add to a list, load more.
  let controls = 0
  // Controls built alike (the copy button of every code sample) say the same thing: two of them are tried.
  const built = new Map<string, number>()
  let alike = 0
  for (const el of Array.from(document.querySelectorAll('button, [role=button], a[href="#"], a[href=""], a:not([href]), input[type=button]'))) {
    if (controls >= args.maxControls) break
    if (!showing(el) || el.closest('[aria-hidden=true], [inert]')) continue
    const name = cut(collapse(kit.describe(el).label), 80)
    const said = collapse([name, el.getAttribute('title') ?? '', el.getAttribute('aria-label') ?? ''].join(' '))
    const word = CLIENT.exec(said)?.[2]
    if (!word) continue
    const signature = `${el.localName}|${collapse(el.getAttribute('class'))}|${name.toLowerCase()}`
    const seen = (built.get(signature) ?? 0) + 1
    built.set(signature, seen)
    if (seen > args.maxAlike) {
      found++
      alike++
      continue
    }
    controls++
    push(el, { trigger: 'control', why: `"${word.toLowerCase()}"` }, name)
  }
  // Filter and sort settings: a select or a checkbox whose label, legend or container names a filter or a sort.
  for (const el of Array.from(document.querySelectorAll('select, input[type=checkbox]'))) {
    if (controls >= args.maxControls) break
    const input = el as HTMLInputElement
    if (input.disabled) continue
    let via: 'label' | undefined
    if (!showing(el)) {
      if (el.localName !== 'input' || !labelOf(el)) continue
      via = 'label'
    }
    const legend = collapse(el.closest('fieldset')?.querySelector('legend')?.textContent)
    const box = el.closest('form, fieldset, [role=group], [class*=filter i], [class*=sort i], [id*=filter i], [id*=sort i]')
    const context = [nameOf(el), legend, el.getAttribute('name') ?? '', el.id, box?.id ?? '', box?.getAttribute('class') ?? '', box?.getAttribute('aria-label') ?? ''].join(' ')
    const word = SETTING.exec(context)?.[1]
    if (!word) continue
    let choice: { i: number; label: string } | undefined
    if (el.localName === 'select') {
      const select = el as HTMLSelectElement
      const options = Array.from(select.options)
      const current = select.selectedIndex
      const order = [...options.keys()].filter((i) => i > current).concat([...options.keys()].filter((i) => i < current))
      const next = order.find((i) => {
        const option = options[i]
        return option !== undefined && !option.disabled && collapse(option.label || option.textContent) !== ''
      })
      if (next === undefined) continue
      choice = { i: next, label: cut(collapse(options[next]?.label || options[next]?.textContent), 80) }
    }
    controls++
    push(el, { trigger: 'setting', why: `"${word.toLowerCase()}"`, type: el.localName === 'select' ? 'select' : 'checkbox', ...(choice ? { choice } : {}), ...(via ? { via } : {}) }, nameOf(el) || legend)
  }

  // The live regions on load, for the record: where announcements can go.
  const regions: Array<LiveRegion & { text: string }> = []
  for (const el of Array.from(document.querySelectorAll('[aria-live], [role~=status], [role~=alert], [role~=log], [role~=marquee], [role~=timer], output')).slice(0, 30)) {
    const live = (el.getAttribute('aria-live') ?? '').toLowerCase()
    const role = (el.getAttribute('role') ?? '').toLowerCase().split(/\s+/)[0] || el.localName
    const politeness = live || (role === 'alert' ? 'assertive' : role === 'marquee' || role === 'timer' ? 'off' : 'polite')
    if (politeness === 'off' && live === 'off') continue
    regions.push({ ref: kit.describe(el).ref, role, politeness, text: cut(collapse(el.textContent), 120) })
  }
  return { found, triggers: triggers.slice(0, args.max), regions, alike }
}

interface StatusWindow {
  __rampaKit: { describe(el: Element): InPageElement; visible(el: Element): boolean; deepActive(): Element | null }
  __rampaTarget?: Element | null
  __rampaStatusRoots?: Element[]
  __rampaStatus?: {
    snap(): number
    diff(args: { base: number; after: number; noise?: [number, number] | undefined; recheck?: number | undefined; max: number }): Pick<StatusTrial, 'messages' | 'more' | 'announced' | 'noise' | 'invalid'>
  }
}

/**
 * Installs `window.__rampaStatus` (needs the kit): snapshots of the text the page shows, element by element, and of its
 * live regions; and the difference between two of them, grouped into messages with the facts the triage reads.
 */
export function installStatusKit(): void {
  const w = window as unknown as StatusWindow
  if (w.__rampaStatus) return
  const kit = w.__rampaKit
  const SKIP = new Set(['script', 'style', 'noscript', 'template', 'head', 'title', 'option', 'optgroup'])
  const LIVE = '[aria-live], [role~=status], [role~=alert], [role~=log], [role~=marquee], [role~=timer], output'
  const collapse = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim()
  const cut = (value: string, n: number) => (value.length > n ? `${value.slice(0, n - 1)}…` : value)
  const rendered = (el: Element) => {
    if (!kit.visible(el)) return false
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }
  interface Snap {
    texts: Map<Element, string>
    shown: Map<Element, boolean>
    regions: Map<Element, string>
    all: WeakSet<Element>
  }
  const snaps: Snap[] = []
  const liveOf = (el: Element): LiveRegion | undefined => {
    for (let x: Element | null = el; x && x !== document.documentElement; x = x.parentElement) {
      const live = (x.getAttribute('aria-live') ?? '').toLowerCase()
      if (live === 'off') return undefined
      const role = (x.getAttribute('role') ?? '').toLowerCase().split(/\s+/)[0] ?? ''
      if (live || ['status', 'alert', 'log', 'marquee', 'timer'].includes(role) || x.localName === 'output') {
        const politeness = live || (role === 'alert' ? 'assertive' : role === 'marquee' || role === 'timer' ? 'off' : 'polite')
        return { ref: kit.describe(x).ref, role: role || x.localName, politeness }
      }
    }
    return undefined
  }
  w.__rampaStatus = {
    snap() {
      const texts = new Map<Element, string>()
      if (document.body) {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
        let n = 0
        for (let node = walker.nextNode(); node && n < 60_000; node = walker.nextNode(), n++) {
          const text = collapse(node.textContent)
          const el = node.parentElement
          if (!text || !el || SKIP.has(el.localName)) continue
          const known = texts.get(el)
          texts.set(el, known ? `${known} ${text}` : text)
        }
      }
      const shown = new Map<Element, boolean>()
      for (const el of texts.keys()) shown.set(el, rendered(el))
      const regions = new Map<Element, string>()
      for (const el of Array.from(document.querySelectorAll(LIVE))) regions.set(el, collapse(el.textContent))
      const all = new WeakSet<Element>(Array.from(document.querySelectorAll('*')).slice(0, 200_000))
      snaps.push({ texts, shown, regions, all })
      return snaps.length - 1
    },
    diff(args) {
      const before = snaps[args.base]
      const after = snaps[args.after]
      if (!before || !after) return { messages: [] }
      const noisy = new Set<Element>()
      if (args.noise) {
        const [a, b] = args.noise.map((i) => snaps[i])
        if (a && b) {
          for (const [el, text] of b.texts) if (a.texts.get(el) !== text || a.shown.get(el) !== b.shown.get(el)) noisy.add(el)
          for (const [el, text] of b.regions) if (a.regions.get(el) !== text) noisy.add(el)
        }
      }
      // What changes again with no input after the trigger's change (a clock, a counter that ticks) is noise too; what
      // goes away (a toast that hides) is not.
      const later = args.recheck === undefined ? undefined : snaps[args.recheck]
      if (later) {
        for (const [el, text] of later.texts) if (later.shown.get(el) === true && after.shown.get(el) === true && after.texts.get(el) !== text) noisy.add(el)
        for (const [el, text] of later.regions) if (text && after.regions.has(el) && after.regions.get(el) !== text) noisy.add(el)
      }
      const inNoise = (el: Element) => {
        for (let x: Element | null = el, i = 0; x && i < 60; x = x.parentElement, i++) if (noisy.has(x)) return true
        return false
      }
      // Elements whose own text is new, changed or newly shown.
      const changed: Element[] = []
      for (const [el, text] of after.texts) {
        if (!after.shown.get(el)) continue
        if (before.shown.get(el) === true && before.texts.get(el) === text) continue
        if (inNoise(el)) continue
        changed.push(el)
      }
      const rootOf = (el: Element): Element => {
        // The outermost element added since the first snapshot: an inserted subtree, such as a toast. Otherwise the
        // element whose own text changed or showed (a counter in a header stays itself, not the header).
        let added: Element | undefined
        for (let x: Element | null = el; x && x !== document.body; x = x.parentElement) if (!before.all.has(x)) added = x
        let root = added ?? el
        // A wrapper that holds nothing else (a hidden alert box around its paragraph) is the message's element.
        const text = collapse((root as HTMLElement).innerText)
        for (let p = root.parentElement; p && p !== document.body; p = p.parentElement) {
          if (collapse((p as HTMLElement).innerText) !== text) break
          root = p
        }
        return root
      }
      const roots: Element[] = []
      const keep = (root: Element) => {
        if (roots.some((r) => r === root || r.contains(root))) return
        for (let i = roots.length - 1; i >= 0; i--) if (root.contains(roots[i] as Element)) roots.splice(i, 1)
        roots.push(root)
      }
      // Roots whose text came (added, or shown where it was hidden), as against text that changed in place.
      const came = new Set<Element>()
      for (const el of changed) {
        const root = rootOf(el)
        keep(root)
        if (!before.all.has(el) || before.shown.get(el) !== true) came.add(root)
      }
      // Elements that came side by side (the items of a list, rows of results, the options of a panel that showed) are
      // one change: their parent's. Texts that changed in place next to each other (a button's label and a status line)
      // stay apart.
      const siblings = new Map<Element, Element[]>()
      for (const root of roots) {
        const parent = root.parentElement
        if (parent && parent !== document.body && came.has(root)) siblings.set(parent, [...(siblings.get(parent) ?? []), root])
      }
      for (const [parent, kids] of siblings) {
        if (kids.length < 2) continue
        for (const kid of kids) {
          const at = roots.indexOf(kid)
          if (at >= 0) roots.splice(at, 1)
        }
        keep(parent)
      }
      roots.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
      const active = kit.deepActive()
      const field = w.__rampaTarget ?? null
      const named = new Set<Element>()
      if (field) {
        for (const id of `${field.getAttribute('aria-describedby') ?? ''} ${field.getAttribute('aria-errormessage') ?? ''}`.split(/\s+/).filter(Boolean)) {
          const el = document.getElementById(id)
          if (el) named.add(el)
        }
      }
      const labels = new Set<Element>(field ? Array.from((field as HTMLInputElement).labels ?? []) : [])
      for (const id of (field?.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean)) {
        const el = document.getElementById(id)
        if (el) labels.add(el)
      }
      const kept = roots.slice(0, args.max)
      w.__rampaStatusRoots = kept
      const messages: StatusMessage[] = kept.map((root) => {
        const r = root.getBoundingClientRect()
        const full = collapse((root as HTMLElement).innerText ?? root.textContent)
        const live = liveOf(root)
        const liveEl = live ? Array.from(document.querySelectorAll(LIVE)).find((x) => x.contains(root) || x === root) : undefined
        const ancestors: StatusMessage['ancestors'] = []
        for (let p = root.parentElement; p && ancestors.length < 8; p = p.parentElement) {
          const d = kit.describe(p)
          ancestors.push({ ref: d.ref, id: d.id, tag: d.tag })
          if (p === document.body) break
        }
        const tied = [...named].some((el) => el === root || root.contains(el) || el.contains(root))
        return {
          ...kit.describe(root),
          text: cut(full, 300),
          added: !before.all.has(root),
          visible: rendered(root) && r.width >= 4 && r.height >= 4,
          chars: full.length,
          controls: root.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=link]').length,
          items: root.querySelectorAll('li, [role=listitem], [role=option], [role=row], article').length,
          ...(active && (active === root || root.contains(active)) ? { focus: true } : {}),
          ...(root.closest('dialog[open], [role=dialog], [role=alertdialog], [aria-modal=true]') ? { dialog: true } : {}),
          ...(live ? { live: { ...live, ...(liveEl && !before.all.has(liveEl) ? { added: true } : {}) } } : {}),
          ...(tied ? { describedBy: true } : {}),
          ...([...labels].some((label) => label === root || label.contains(root)) ? { inLabel: true } : {}),
          ancestors,
        }
      })
      const announced: Announcement[] = []
      for (const [el, text] of after.regions) {
        if (!text || before.regions.get(el) === text || inNoise(el)) continue
        const role = (el.getAttribute('role') ?? '').toLowerCase().split(/\s+/)[0] || (el.getAttribute('aria-live') ? 'region' : el.localName)
        announced.push({ ref: kit.describe(el).ref, role, text: cut(text, 200), added: !before.regions.has(el) })
        if (announced.length >= 6) break
      }
      return {
        messages,
        ...(roots.length > kept.length ? { more: roots.length - kept.length } : {}),
        ...(announced.length > 0 ? { announced } : {}),
        ...(noisy.size > 0 ? { noise: noisy.size } : {}),
        ...(field && field.getAttribute('aria-invalid') === 'true' ? { invalid: true } : {}),
      }
    },
  }
}

const sessions = new WeakMap<Page, CDPSession>()

async function sessionFor(probe: ProbePage): Promise<CDPSession | undefined> {
  const known = sessions.get(probe.page)
  if (known) return known
  const session = await probe.context.newCDPSession(probe.page).catch(() => undefined)
  if (session) sessions.set(probe.page, session)
  return session
}

/** What the browser exposes around each message: the nearest node that is live, or has a status, alert or log role. */
async function exposure(session: CDPSession | undefined, count: number): Promise<Array<StatusMessage['ax']>> {
  if (!session || count === 0) return []
  const read = await liveAxFacts(session, 'window.__rampaStatusRoots ?? []', { ancestors: true }).catch(() => undefined)
  if (!read) return []
  return read.map((entry) => {
    if (!entry) return undefined
    for (const facts of [entry.facts, ...(entry.ancestors ?? [])]) {
      const live = facts.props?.live
      if (live === 'polite' || live === 'assertive' || ['status', 'alert', 'log'].includes(facts.role)) return { role: facts.role, ...(typeof live === 'string' ? { live } : {}) }
    }
    return null
  })
}

/** A word to search for: the first long word of the page's main heading or title, else "test". */
function queryFor(page: Page): Promise<string> {
  return page
    .evaluate(() => {
      const text = `${document.querySelector('h1')?.textContent ?? ''} ${document.title}`
      return (text.match(/\p{L}{4,}/gu) ?? [])[0]?.toLowerCase() ?? 'test'
    })
    .catch(() => 'test')
}

/** The skip list for a trigger, and for the option it would choose. */
function triggerSkip(facts: ControlFacts, origin: string, trigger: Pick<StatusTrigger, 'choice'>): ReturnType<typeof skipReason> {
  const word = trigger.choice ? destructiveWord(trigger.choice.label) : undefined
  return skipReason(facts, origin) ?? (word ? { reason: 'destructive', detail: word } : undefined)
}

/** One trigger on a page of its own: a wait with no input, then the action, then what appeared. */
async function tryTrigger(harness: Harness, trigger: StatusTrigger, fresh: boolean): Promise<StatusTrial> {
  const probe = await harness.page(fresh)
  const page = probe.page
  if (!(await harness.locate(probe, trigger, { check: (facts) => triggerSkip(facts, harness.origin, trigger) }))) return { outcome: 'unmatched' }
  if (trigger.choice && (await staleOption(harness, probe, trigger, trigger.choice.i))) return { outcome: 'not-exercised', reason: 'the option to choose names a destructive action on this load' }
  const aimed = await harness.aim(probe, trigger, trigger.via === 'label' ? 'label' : 'target')
  if ('cover' in aimed) return { outcome: 'not-exercised', cover: aimed.cover }
  if ('hidden' in aimed) {
    harness.log('not-exercised', { ref: trigger.ref, label: trigger.label, detail: 'not showing on this load' })
    return { outcome: 'not-exercised', reason: 'not showing on this load' }
  }
  await page.evaluate(installStatusKit)
  const session = await sessionFor(probe)
  const typed = trigger.trigger === 'blur' || trigger.trigger === 'search'
  if (typed && !(await page.evaluate(focusTarget))) {
    harness.log('not-exercised', { ref: trigger.ref, label: trigger.label, detail: 'took no focus' })
    return { outcome: 'no-focus' }
  }
  const first = await page.evaluate(() => (window as unknown as StatusWindow).__rampaStatus?.snap() ?? -1)
  await page.waitForTimeout(IDLE_MS)
  const base = await page.evaluate(() => (window as unknown as StatusWindow).__rampaStatus?.snap() ?? -1)
  let action: string
  let act: () => Promise<unknown>
  switch (trigger.trigger) {
    case 'blur': {
      const value = trigger.value ?? 'a'
      action = value === '' ? 'typed a letter, erased it and left the field empty' : `typed "${value}" and left the field`
      act = async () => {
        if (value === '') {
          await page.keyboard.type('a')
          await page.keyboard.press('Backspace')
        } else await page.keyboard.type(value)
        await page.evaluate(blurTarget)
      }
      break
    }
    case 'search': {
      const query = await queryFor(page)
      trigger.value = query
      action = `typed "${query}" and pressed Enter`
      act = async () => {
        await page.keyboard.type(query)
        await page.keyboard.press('Enter')
      }
      break
    }
    case 'setting':
      if (trigger.choice) {
        const choice = trigger.choice
        action = `selected "${choice.label}"`
        act = () => page.evaluate(chooseOption, { i: choice.i })
      } else {
        action = 'clicked the checkbox'
        act = () => page.mouse.click(aimed.x, aimed.y)
      }
      break
    default:
      action = 'clicked'
      act = () => page.mouse.click(aimed.x, aimed.y)
  }
  harness.log('activate', { ref: trigger.ref, label: trigger.label, detail: action })
  const watch = await harness.window(probe, act, { ref: trigger.ref, label: trigger.label })
  const after = await page.evaluate(() => (window as unknown as StatusWindow).__rampaStatus?.snap() ?? -1)
  await page.waitForTimeout(RECHECK_MS)
  const recheck = await page.evaluate(() => (window as unknown as StatusWindow).__rampaStatus?.snap() ?? -1)
  const found = await page
    .evaluate((args) => (window as unknown as StatusWindow).__rampaStatus?.diff(args), { base, after, noise: [first, base] as [number, number], recheck, max: MAX_MESSAGES })
    .catch(() => undefined)
  const messages = found?.messages ?? []
  const ax = await exposure(session, messages.length)
  messages.forEach((message, i) => {
    if (ax[i] !== undefined) message.ax = ax[i]
  })
  return { action, watch, ...found, messages }
}

/** 4.1.3: each safe trigger on a page of its own, and the text that appeared after it. */
export async function runStatusProbe(browser: Browser, url: string, options: ProbeOptions): Promise<ProbeRecord> {
  const limits = STATUS_LIMITS
  const harness = new Harness(browser, url, options, { kind: 'status', version: STATUS_VERSION, variant: 'status-messages', limits })
  let data: StatusData | undefined
  let conditions: ProbeRecord['conditions'] | undefined
  try {
    const first = await harness.page()
    conditions = first.conditions
    const viewport = first.page.viewportSize() ?? first.conditions.viewport
    const listed = await first.page.evaluate(findStatusTriggers, {
      max: MAX_LISTED,
      client: CLIENT_WORDS.source,
      setting: SETTING_WORDS.source,
      searchNames: SEARCH_NAMES.source,
      searchWords: SEARCH_WORDS.source,
      maxFields: MAX_FIELDS,
      maxSearch: MAX_SEARCH,
      maxControls: MAX_CONTROLS,
      maxAlike: MAX_ALIKE,
    })
    data = { viewport, found: listed.found, triggers: [], tried: 0, loads: 0, regions: listed.regions, ...(listed.alike > 0 ? { alike: listed.alike } : {}), actions: [], end: 'complete' }
    for (const { facts, ...trigger } of listed.triggers) {
      const entry: StatusTrigger = trigger
      data.triggers.push(entry)
      const skip = triggerSkip(facts, harness.origin, trigger)
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
      entry.trial = await tryTrigger(harness, entry, false)
    }
  } finally {
    await harness.close()
  }
  if (!data || !conditions) throw new Error('the first page did not load')
  data.loads = harness.loads
  data.actions = harness.actions
  const reason = data.end === 'budget' ? `trigger budget reached (${limits.controls})` : data.end === 'time' ? `time budget reached (${limits.timeMs / 1000} s)` : undefined
  return harness.record(data, conditions, reason)
}

/** The status probe as a step of the probe stage; a probe that fails leaves a skipped record. */
export async function statusProbe(browser: Browser, url: string, options: ProbeOptions): Promise<ProbeRecord[]> {
  const started = Date.now()
  try {
    return [await runStatusProbe(browser, url, options)]
  } catch (error) {
    return [skippedRecord('status', STATUS_VERSION, 'status-messages', `probe failed: ${(error instanceof Error ? error.message : String(error)).split('\n')[0]}`, Date.now() - started)]
  }
}
