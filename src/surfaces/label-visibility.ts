import { tryDecodePng } from '../pixels/png.ts'
import type { A11yNode } from '../snapshot/schema.ts'
import { indexTree, walkTree } from '../snapshot/tree.ts'

/**
 * 3.3.2 rests on labels people can see. A label the snapshot places on screen, rendered and larger than a
 * pixel, can still show nothing: white text on white, clipped by clip-path, pushed out of its box by
 * text-indent, transparent, or covered by something else. Each label 3.3.2 relies on (a label element tied to
 * a field, or an element a field's aria-labelledby names) is captured as rendered and again with its text made
 * transparent. When the two captures are the same, its text shows nothing. The collector records the answer on
 * the label's node as `native.textVisible`: false when the pixels did not change, true when they did. Absent,
 * the label was not measured, and the criteria read the snapshot as before.
 *
 * `rampa check` (`collectWeb`) and a test's own page (`collectPage`) share it, as they share image-capture.ts.
 */

export interface LabelDriver {
  /** Runs a self-contained function in the page with one JSON argument. */
  evaluate<Arg, Result>(fn: (arg: Arg) => Result | Promise<Result>, arg: Arg): Promise<Result>
  /** A PNG of the element a ref resolves to, as rendered; undefined when it cannot be taken. */
  screenshot(ref: string): Promise<Uint8Array | undefined>
}

export interface LabelOptions {
  /** Called before each label is captured: rampa check hides the fixed layers that do not hold it. */
  beforeEach?: ((node: A11yNode) => Promise<void>) | undefined
  limit?: number | undefined
  budgetMs?: number | undefined
}

/** Labels measured per page, in document order; each takes two screenshots. */
export const LABEL_LIMIT = 30
const BUDGET_MS = 10_000
/** A pixel counts as changed when a color channel moves by more than this: less is text no one can tell from its background. */
const CHANNEL_TOLERANCE = 10
/** Fewer changed pixels than this is noise, not a letter. */
const MIN_CHANGED = 4

/** Field types 3.3.2 does not judge (labels-or-instructions.ts, SKIPPED_TYPES): no typed input, or they name themselves. */
const SKIPPED_TYPES = new Set(['hidden', 'submit', 'reset', 'button', 'image', 'checkbox', 'radio', 'file', 'range', 'color'])

function attributesOf(node: A11yNode): Record<string, string> {
  return (node.native.attributes ?? {}) as Record<string, string>
}

function isField(node: A11yNode): boolean {
  const tag = node.native.tag
  if (tag !== 'input' && tag !== 'select' && tag !== 'textarea') return false
  if (node.states.includes('hidden') || node.states.includes('aria-hidden') || node.states.includes('disabled') || node.states.includes('readonly')) return false
  return tag !== 'input' || !SKIPPED_TYPES.has((attributesOf(node).type ?? 'text').trim().toLowerCase())
}

/** On screen as the snapshot has it: rendered, inside the page and larger than a pixel (labels-or-instructions.ts, shown). */
function onScreen(node: A11yNode): boolean {
  if (node.states.includes('hidden') || node.states.includes('offscreen')) return false
  return node.bounds !== undefined && node.bounds.width > 1 && node.bounds.height > 1
}

/** The label has text of its own, outside the field it may wrap, and no picture that could be what people see. */
function measurable(label: A11yNode): boolean {
  let text = false
  const visit = (node: A11yNode): boolean => {
    if (node.native.tag === 'input' || node.native.tag === 'select' || node.native.tag === 'textarea') return true
    // An icon can be the label people see; transparent text would not change it, so the pixels could not tell.
    if (node.native.tag === 'img' || node.native.tag === 'svg' || node.native.tag === 'canvas' || node.role === 'img' || typeof node.native.backgroundImage === 'string') return false
    if (node.text?.trim()) text = true
    return node.children.every(visit)
  }
  return visit(label) && text
}

/** The labels 3.3.2 relies on that the snapshot places on screen, in document order. */
export function labelTargets(root: A11yNode): A11yNode[] {
  const index = indexTree(root)
  const byId = new Map<string, A11yNode>()
  const fields = new Set<string>()
  const wanted = new Set<A11yNode>()
  for (const node of walkTree(root)) {
    const id = attributesOf(node).id
    if (id && !byId.has(id)) byId.set(id, node)
    if (isField(node)) fields.add(node.ref)
  }
  for (const node of walkTree(root)) {
    if (!fields.has(node.ref)) continue
    for (const id of (attributesOf(node)['aria-labelledby'] ?? '').split(/\s+/)) {
      const target = id ? byId.get(id) : undefined
      if (target) wanted.add(target)
    }
  }
  for (const node of walkTree(root)) {
    if (node.native.tag !== 'label') continue
    const control = node.native.labelControl
    // The field it labels, by for= or by wrapping it.
    if (typeof control === 'string' ? fields.has(control) : [...walkTree(node)].some((inner) => inner !== node && fields.has(inner.ref))) wanted.add(node)
  }
  return [...walkTree(root)].filter((node) => wanted.has(node) && onScreen(node) && measurable(node) && index.has(node.ref))
}

/** Measures each label and records `native.textVisible`. A label that could not be captured gets no fact. */
export async function measureLabels(driver: LabelDriver, root: A11yNode, options: LabelOptions = {}): Promise<void> {
  const deadline = Date.now() + (options.budgetMs ?? BUDGET_MS)
  const limit = options.limit ?? LABEL_LIMIT
  for (const [index, node] of labelTargets(root).entries()) {
    if (index >= limit || Date.now() > deadline) break
    try {
      await options.beforeEach?.(node)
      const rendered = await driver.screenshot(node.ref)
      if (!rendered) continue
      const changed = await driver.evaluate(textTransparentInPage, { ref: node.ref, on: true })
      if (!changed) continue
      let bare: Uint8Array | undefined
      try {
        bare = await driver.screenshot(node.ref)
      } finally {
        await driver.evaluate(textTransparentInPage, { ref: node.ref, on: false })
      }
      const shows = bare ? textShows(rendered, bare) : undefined
      if (shows !== undefined) node.native.textVisible = shows
    } catch {
      // Detached or not capturable: the label keeps no fact, and 3.3.2 reads it as before.
    }
  }
}

/** Whether two captures of one box differ where the text was: at least a few pixels, by more than a faint tint. */
export function textShows(rendered: Uint8Array, bare: Uint8Array): boolean | undefined {
  const a = tryDecodePng(rendered)
  const b = tryDecodePng(bare)
  if (!a || !b) return undefined
  // A box that moved or changed size between the captures cannot be compared pixel for pixel: its text showed something.
  if (a.width !== b.width || a.height !== b.height) return true
  let changed = 0
  for (let i = 0; i < a.data.length; i += 4) {
    const moved = Math.max(
      Math.abs((a.data[i] ?? 0) - (b.data[i] ?? 0)),
      Math.abs((a.data[i + 1] ?? 0) - (b.data[i + 1] ?? 0)),
      Math.abs((a.data[i + 2] ?? 0) - (b.data[i + 2] ?? 0)),
    )
    if (moved > CHANNEL_TOLERANCE && ++changed >= MIN_CHANGED) return true
  }
  return false
}

/**
 * Runs in the page (serialized by the browser library, so it references nothing outside its body). With `on`,
 * makes the text of the element and of everything in it transparent, ::before and ::after included; text painted
 * through background-clip: text loses that background too. A field inside the label (a wrapped input) keeps its
 * own text as it was: the properties it would inherit are pinned to their values first. Without `on`, puts it all
 * back. Returns whether the element was found.
 */
export function textTransparentInPage(arg: { ref: string; on: boolean }): boolean {
  const STYLE_ID = 'rampa-label-test'
  const MARK = 'data-rampa-label-test'
  const CLIP = 'data-rampa-clip-text'
  type Undo = { el: HTMLElement; prop: string; value: string; priority: string }
  const page = window as unknown as { __rampaLabelUndo?: Undo[] }
  let el: Element | null = null
  try {
    el = document.querySelector(arg.ref)
  } catch {
    el = null
  }
  if (!arg.on) {
    for (const node of Array.from(document.querySelectorAll(`[${MARK}], [${CLIP}]`))) {
      node.removeAttribute(MARK)
      node.removeAttribute(CLIP)
    }
    document.getElementById(STYLE_ID)?.remove()
    const undo = page.__rampaLabelUndo ?? []
    for (let entry = undo.pop(); entry; entry = undo.pop()) {
      if (entry.value) entry.el.style.setProperty(entry.prop, entry.value, entry.priority)
      else entry.el.style.removeProperty(entry.prop)
    }
    return el !== null
  }
  if (!el) return false
  // The text properties a field inside the label would inherit from it, pinned before the label changes.
  const undo: Undo[] = []
  page.__rampaLabelUndo = undo
  const TEXT = ['color', '-webkit-text-fill-color', '-webkit-text-stroke-color', 'text-shadow', 'text-decoration-color', 'caret-color']
  for (const field of Array.from(el.querySelectorAll<HTMLElement>('input, select, textarea'))) {
    const computed = getComputedStyle(field)
    for (const prop of TEXT) {
      undo.push({ el: field, prop, value: field.style.getPropertyValue(prop), priority: field.style.getPropertyPriority(prop) })
      field.style.setProperty(prop, computed.getPropertyValue(prop), 'important')
    }
  }
  const style = document.createElement('style')
  style.id = STYLE_ID
  const fields = ':not(input):not(select):not(textarea):not(option)'
  const scope = [`[${MARK}]`, `[${MARK}] *${fields}`]
  const transparent = 'color: transparent !important; -webkit-text-fill-color: transparent !important; -webkit-text-stroke-color: transparent !important; text-shadow: none !important; text-decoration-color: transparent !important; transition: none !important;'
  style.textContent = `${[...scope, ...scope.map((s) => `${s}::before`), ...scope.map((s) => `${s}::after`)].join(', ')} { ${transparent} } [${CLIP}] { background-image: none !important; }`
  ;(document.head ?? document.documentElement).appendChild(style)
  el.setAttribute(MARK, '')
  for (const node of [el, ...Array.from(el.querySelectorAll('*'))]) {
    const computed = getComputedStyle(node) as CSSStyleDeclaration & { webkitBackgroundClip?: string }
    if (computed.backgroundClip === 'text' || computed.webkitBackgroundClip === 'text') node.setAttribute(CLIP, '')
  }
  return true
}
