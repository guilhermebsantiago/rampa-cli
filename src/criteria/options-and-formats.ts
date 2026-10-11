import { normalizeForMatch } from '../core/util.ts'
import type { A11yNode } from '../snapshot/schema.ts'
import type { TreeIndex } from '../snapshot/tree.ts'
import { attributesOf, isHoneypot } from './shared.ts'

/**
 * Two 3.3.2 cases the coverage plan (C14) sends to judgment, found here from facts of the snapshot; the module
 * (labels-or-instructions.ts) asks the model and verifies. Both stay below the default confidence threshold.
 *
 * - An option group with no visible question: radios (or checkboxes) that share a name, with no legend or group name,
 *   and no visible text between them and the field or heading before them. Whether the options' own labels say what
 *   the choice is about ("Credit card", "Pix") or not ("Yes", "No") is the model's call.
 * - A date typed in a text field, with no format shown: the label, name or autocomplete token says date, birth or
 *   expiry (in English, Portuguese or Spanish), the field is a text field with no pattern (fields with a pattern are
 *   judged already), and nothing visible around it shows a format or an example (DD/MM/YYYY, "dia", 01/02/2000).
 */

const tagOf = (node: A11yNode) => (typeof node.native.tag === 'string' ? node.native.tag : '')

function shown(node: A11yNode): boolean {
  if (node.states.includes('hidden') || node.states.includes('offscreen') || node.native.textVisible === false) return false
  return !node.bounds || (node.bounds.width > 1 && node.bounds.height > 1)
}

function isInside(node: A11yNode, container: A11yNode, index: TreeIndex): boolean {
  for (let ref: string | undefined = node.ref; ref; ref = index.get(ref)?.parentRef) if (ref === container.ref) return true
  return false
}

const FIELD_ROLES = new Set(['textbox', 'searchbox', 'combobox', 'listbox', 'spinbutton', 'slider', 'checkbox', 'radio', 'switch'])

export interface OptionGroup {
  /** The options, in page order. */
  options: A11yNode[]
  /** The text each option shows. */
  labels: string[]
  type: 'radio' | 'checkbox'
}

/**
 * Radios, and checkboxes, that share a name in one form, two or more on screen, each with a visible label, with no
 * legend or group name, and nothing visible right before them: no text, no heading, between the first option and the
 * field, button or start of form before it.
 */
export function unaskedOptionGroups(ordered: A11yNode[], index: TreeIndex, labelOf: (option: A11yNode) => string | undefined, groupNameOf: (option: A11yNode) => string | undefined): OptionGroup[] {
  const groups = new Map<string, { options: A11yNode[]; type: 'radio' | 'checkbox' }>()
  for (const node of ordered) {
    if (tagOf(node) !== 'input' || (node.role !== 'radio' && node.role !== 'checkbox') || !shown(node) || isHoneypot(node)) continue
    const name = attributesOf(node).name?.trim()
    if (!name) continue
    const form = formOf(node, index)
    const key = `${form?.ref ?? ''}|${node.role}|${name}`
    const group = groups.get(key) ?? { options: [], type: node.role }
    group.options.push(node)
    groups.set(key, group)
  }
  const found: OptionGroup[] = []
  for (const { options, type } of groups.values()) {
    if (options.length < 2 || options.some((option) => groupNameOf(option) !== undefined)) continue
    const labels = options.map((option) => labelOf(option))
    if (labels.some((label) => !label)) continue
    const first = options[0] as A11yNode
    if (textBefore(ordered, first, options, index)) continue
    found.push({ options, labels: labels as string[], type })
  }
  return found
}

/** The form a field belongs to, if any. */
function formOf(node: A11yNode, index: TreeIndex): A11yNode | undefined {
  for (let ref = index.get(node.ref)?.parentRef; ref; ref = index.get(ref)?.parentRef) {
    const parent = index.get(ref)?.node
    if (parent && (tagOf(parent) === 'form' || parent.role === 'form')) return parent
  }
  return undefined
}

/**
 * Whether visible text, or a heading, sits right before the first option: walking back in reading order past the
 * options' own labels, it comes before another field, a button or the start of the form. Unsure (too far to tell) is a yes.
 */
function textBefore(ordered: A11yNode[], first: A11yNode, options: A11yNode[], index: TreeIndex): boolean {
  const start = ordered.indexOf(first)
  const form = formOf(first, index)
  // A label element of one of the options: by for=, or wrapping it.
  const optionLabel = (node: A11yNode) => tagOf(node) === 'label' && options.some((option) => node.native.labelControl === option.ref || isInside(option, node, index))
  for (let i = start - 1, steps = 0; i >= 0; i--, steps++) {
    if (steps > 30) return true
    const node = ordered[i] as A11yNode
    if (node === form) return false
    if (isInside(first, node, index)) continue
    if (FIELD_ROLES.has(node.role) || node.role === 'button' || ['input', 'select', 'textarea', 'button'].includes(tagOf(node))) return false
    if (!shown(node)) continue
    if (node.role === 'heading') return true
    if (node.text?.trim() && !optionLabel(node) && ![...ancestorsOf(node, index)].some(optionLabel)) return true
  }
  return false
}

function* ancestorsOf(node: A11yNode, index: TreeIndex): Generator<A11yNode> {
  for (let ref = index.get(node.ref)?.parentRef; ref; ref = index.get(ref)?.parentRef) {
    const parent = index.get(ref)?.node
    if (parent) yield parent
  }
}

// Dates typed in text fields.

/** Words for a date in a field's label or name, by language, without accents ("data" is a date only in Portuguese). */
const DATE_WORDS: Record<'en' | 'pt' | 'es', string[]> = {
  en: ['date', 'birth', 'birthday', 'birthdate', 'dob', 'expiry', 'expiration'],
  pt: ['data', 'nascimento', 'validade', 'vencimento'],
  es: ['fecha', 'nacimiento', 'vencimiento', 'caducidad'],
}
const dateWords = (words: string[]) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${words.join('|')})(?![\\p{L}\\p{N}])`, 'iu')
/** The autocomplete tokens of a whole date typed in one field. */
const DATE_TOKENS = new Set(['bday', 'cc-exp'])
/** What shows a format: its parts named (DD, MM/AA, dia, mes, year) or an example of it (01/02/2000, 12-2030). */
const FORMAT_SHOWN = /(?<![\p{L}\p{N}])(?:dd|mm|yy|yyyy|aa|aaaa|jj|ddmmaaaa|ddmmyyyy|day|month|year|dia|mes|ano)(?![\p{L}\p{N}])|\d{1,4}\s*[/.-]\s*\d{1,4}/iu
const TEXT_TYPES = new Set(['', 'text', 'tel'])
/** A date widget library on the field: it may write the format itself when the field is used. */
const PICKER = /date-?picker|flatpickr|hasdatepicker|pikaday|datetimepicker/i

const fold = (text: string) => normalizeForMatch(text).normalize('NFD').replace(/\p{M}/gu, '')

/**
 * Whether a field asks for a whole date typed as text: a text field (no pattern, no date picker) whose label, name, id
 * or autocomplete token says date, birth or expiry. Names and ids are read in English too, as they are often written so.
 */
export function asksForDate(field: A11yNode, language: string, label: string | undefined): boolean {
  if (tagOf(field) !== 'input' || field.states.includes('readonly') || field.states.includes('disabled') || isHoneypot(field)) return false
  const attributes = attributesOf(field)
  if (!TEXT_TYPES.has((attributes.type ?? '').trim().toLowerCase()) || attributes.pattern?.trim()) return false
  if (PICKER.test(attributes.class ?? '')) return false
  const token = (attributes.autocomplete ?? '').trim().toLowerCase().split(/\s+/).pop() ?? ''
  if (DATE_TOKENS.has(token)) return true
  const primary = language.trim().toLowerCase().split(/[-_]/)[0] ?? ''
  const words = dateWords([...DATE_WORDS.en, ...(primary === 'pt' ? DATE_WORDS.pt : primary === 'es' ? DATE_WORDS.es : [])])
  return [label, field.name, attributes.name, attributes.id]
    .filter((text): text is string => Boolean(text))
    .some((text) => words.test(fold(text.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' '))))
}

/** The first text that shows a date's format: its parts named ("DD/MM/AAAA", "dia", "year") or an example ("01/02/2000"). */
export function formatShownIn(texts: ReadonlyArray<string | undefined>): string | undefined {
  return texts.find((text) => text !== undefined && FORMAT_SHOWN.test(fold(text)))
}
