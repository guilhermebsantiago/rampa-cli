import { FRAME_SEPARATOR, SHADOW_SEPARATOR, idKey } from '../snapshot/refs.ts'
import type { A11yNode, AxFacts, AxTree } from '../snapshot/schema.ts'
import { walkTree } from '../snapshot/tree.ts'
import type { CdpSessionLike } from './form-issues.ts'

/**
 * The browser's own accessibility tree, read over CDP after collection and written onto the snapshot's nodes as
 * `ax` (docs/rules.md). Rampa's collector computes roles and names itself (surfaces/in-page.ts), an approximation
 * of the ARIA and HTML-AAM algorithms; Chromium's tree is what assistive technology actually gets.
 *
 * Nodes are matched through their backend node id: the DOM tree (DOM.getDocument, pierced) gives every element's
 * backend id and is enough to rebuild each element's ref exactly as the collector built it (snapshot/refs.ts), and
 * every node of the accessibility tree (Accessibility.getFullAXTree, one call per document) names its element by the
 * same id. Frames whose document the page may read are read too; frames of another origin are not in the snapshot.
 */

export interface AxLimits {
  /** A page with more elements than this is not read: its tree would cost seconds and tens of megabytes. */
  elements: number
  /** Frames whose tree is read after the page's own, in document order. */
  frames: number
  /** Longest time for the whole read; what is left is recorded as left out. */
  totalMs: number
  /** Elements whose own event listeners are read, for the custom-control rule. */
  listeners: number
}

export const AX_LIMITS: AxLimits = { elements: 40_000, frames: 10, totalMs: 10_000, listeners: 50 }

/** The limits of a read: the defaults, with any the caller changed. */
export function axLimits(option: boolean | Partial<AxLimits> | undefined): AxLimits {
  return typeof option === 'object' ? { ...AX_LIMITS, ...option } : AX_LIMITS
}

/** A node of CDP's DOM tree, as DOM.getDocument returns it. */
export interface CdpDomNode {
  nodeType: number
  backendNodeId: number
  localName?: string
  nodeName?: string
  /** Name, value, name, value... */
  attributes?: string[]
  children?: CdpDomNode[]
  shadowRoots?: CdpDomNode[]
  shadowRootType?: string
  contentDocument?: CdpDomNode
  templateContent?: CdpDomNode
  frameId?: string
}

interface AxValue {
  type?: string
  value?: unknown
  relatedNodes?: Array<{ backendDOMNodeId?: number; idref?: string; text?: string }>
  sources?: Array<{ type?: string; value?: AxValue; attribute?: string; nativeSource?: string; superseded?: boolean; invalid?: boolean }>
}

/** A node of Chromium's accessibility tree, as Accessibility.getFullAXTree returns it. */
export interface CdpAxNode {
  nodeId: string
  ignored?: boolean
  ignoredReasons?: Array<{ name: string; value?: AxValue }>
  role?: AxValue
  name?: AxValue
  description?: AxValue
  value?: AxValue
  properties?: Array<{ name: string; value?: AxValue }>
  backendDOMNodeId?: number
  frameId?: string
}

/** An element of the DOM tree, with the ref the collector gives it. */
export interface DomElement {
  ref: string
  attributes: Record<string, string>
}

/** CSS.escape, as the collector escapes ids (https://drafts.csswg.org/cssom/#serialize-an-identifier). */
export function cssEscape(value: string): string {
  let result = ''
  const first = value.charCodeAt(0)
  if (value.length === 1 && first === 0x2d) return `\\${value}`
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code === 0) {
      result += '�'
      continue
    }
    if ((code >= 0x01 && code <= 0x1f) || code === 0x7f || (i === 0 && code >= 0x30 && code <= 0x39) || (i === 1 && code >= 0x30 && code <= 0x39 && first === 0x2d)) {
      result += `\\${code.toString(16)} `
      continue
    }
    if (code >= 0x80 || code === 0x2d || code === 0x5f || (code >= 0x30 && code <= 0x39) || (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) {
      result += value.charAt(i)
      continue
    }
    result += `\\${value.charAt(i)}`
  }
  return result
}

function attributesOf(node: CdpDomNode): Record<string, string> {
  const out: Record<string, string> = {}
  const list = node.attributes ?? []
  for (let i = 0; i + 1 < list.length; i += 2) out[list[i] as string] = list[i + 1] as string
  return out
}

const elementChildren = (node: CdpDomNode): CdpDomNode[] => (node.children ?? []).filter((child) => child.nodeType === 1)

/**
 * Every element of the DOM tree by backend node id, with the ref the collector gives it (in-page.ts, `cssPath`):
 * its path in its own document or open shadow root, anchored at an id unique in a document, behind the ref of
 * the shadow host (` >>> `) or the frame element (` |> `) that holds it. User-agent and closed shadow roots and
 * template contents are not in the collector's tree, so they are left out here too. Also returns the frames whose
 * document is in the tree, with the frame id CDP reads them by.
 */
export function domElements(root: CdpDomNode): {
  elements: Map<number, DomElement>
  frames: Array<{ ref: string; frameId: string }>
  /** The element each id names in its document or shadow root (the first, as getElementById finds it), keyed as refs.ts `idKey`. */
  byId: Map<string, string>
} {
  const elements = new Map<number, DomElement>()
  const frames: Array<{ ref: string; frameId: string }> = []
  const byId = new Map<string, string>()

  /** How many elements of the document carry each id: an id anchors a ref only when it is unique there. */
  const idCounts = (document: CdpDomNode): Map<string, number> => {
    const counts = new Map<string, number>()
    const stack = [...(document.children ?? [])]
    while (stack.length > 0) {
      const node = stack.pop() as CdpDomNode
      if (node.nodeType !== 1) continue
      const id = attributesOf(node).id
      if (id) counts.set(id, (counts.get(id) ?? 0) + 1)
      stack.push(...(node.children ?? []))
    }
    return counts
  }

  /** The elements of one document or shadow root, under the ref prefix of what holds it. */
  const visitScope = (scope: CdpDomNode, prefix: string, ids: Map<string, number> | undefined): void => {
    const visit = (el: CdpDomNode, siblings: CdpDomNode[], parentPath: string | undefined): void => {
      const attributes = attributesOf(el)
      const tag = el.localName ?? (el.nodeName ?? '').toLowerCase()
      const id = attributes.id ?? ''
      let path: string
      if (ids && id !== '' && ids.get(id) === 1) path = `#${cssEscape(id)}`
      else {
        const same = siblings.filter((sibling) => (sibling.localName ?? (sibling.nodeName ?? '').toLowerCase()) === tag)
        const step = same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(el) + 1})` : tag
        path = parentPath === undefined ? step : `${parentPath} > ${step}`
      }
      const ref = `${prefix}${path}`
      elements.set(el.backendNodeId, { ref, attributes })
      if (id !== '' && !byId.has(`${prefix}${id}`)) byId.set(`${prefix}${id}`, ref)
      const open = (el.shadowRoots ?? []).find((shadow) => shadow.shadowRootType === 'open')
      if (open) visitScope(open, `${ref}${SHADOW_SEPARATOR}`, undefined)
      if (el.contentDocument) {
        if (el.frameId) frames.push({ ref, frameId: el.frameId })
        visitScope(el.contentDocument, `${ref}${FRAME_SEPARATOR}`, idCounts(el.contentDocument))
      }
      const kids = elementChildren(el)
      for (const child of kids) visit(child, kids, path)
    }
    const top = elementChildren(scope)
    for (const el of top) visit(el, top, undefined)
  }

  visitScope(root, '', idCounts(root))
  return { elements, frames, byId }
}

/** Properties kept, with the values that say nothing left out. */
const PROPS: Record<string, (value: unknown) => boolean> = {
  focusable: (v) => v === true,
  disabled: (v) => v === true,
  editable: (v) => typeof v === 'string' && v !== '',
  checked: (v) => v === 'true' || v === 'false' || v === 'mixed',
  pressed: (v) => v === 'true' || v === 'false' || v === 'mixed',
  expanded: (v) => typeof v === 'boolean',
  selected: (v) => typeof v === 'boolean',
  required: (v) => v === true,
  invalid: (v) => typeof v === 'string' && v !== 'false',
  readonly: (v) => v === true,
  modal: (v) => v === true,
  hasPopup: (v) => typeof v === 'string' && v !== 'false',
  level: (v) => typeof v === 'number',
  live: (v) => v === 'polite' || v === 'assertive',
  atomic: (v) => typeof v === 'boolean',
  relevant: (v) => typeof v === 'string',
  busy: (v) => v === true,
  multiselectable: (v) => v === true,
  valuemin: (v) => typeof v === 'number',
  valuemax: (v) => typeof v === 'number',
  valuetext: (v) => typeof v === 'string' && v !== '',
  roledescription: (v) => typeof v === 'string' && v !== '',
  keyshortcuts: (v) => typeof v === 'string' && v !== '',
  autocomplete: (v) => typeof v === 'string' && v !== '' && v !== 'none',
}

/** Relations kept, as the refs of the elements they point to. */
const RELATIONS = new Set(['labelledby', 'describedby', 'controls', 'owns', 'activedescendant', 'errormessage', 'details', 'flowto'])

const MAX_TEXT = 300

const collapse = (value: unknown): string => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : typeof value === 'number' ? String(value) : '')

/**
 * Where the name the browser computed came from: the first source that is not superseded and gave a value.
 * Attributes by their name (aria-labelledby, aria-label, alt, title, value, placeholder); the elements HTML takes
 * names from by what they are (label, legend, caption, figcaption, title for an svg); contents for name from content.
 */
export function nameSourceOf(name: AxValue | undefined): string | undefined {
  for (const source of name?.sources ?? []) {
    if (source.superseded || source.invalid) continue
    if (collapse(source.value?.value) === '') continue
    if (source.attribute) return source.attribute
    switch (source.nativeSource) {
      case 'label':
      case 'labelfor':
      case 'labelwrapped':
        return 'label'
      case 'tablecaption':
        return 'caption'
      case 'title':
        // The <title> element of an svg or of the page; the title attribute is reported as an attribute.
        return 'title-element'
      case undefined:
        break
      default:
        return source.nativeSource
    }
    return source.type === 'relatedElement' ? 'related-element' : source.type
  }
  return undefined
}

/** The facts the snapshot keeps for one node of the browser's tree; `rampaName` is the collector's own name, for the comparison. */
export function axFactsOf(node: CdpAxNode, rampaName: string | undefined, refOf: (backendId: number) => string | undefined): AxFacts {
  if (node.ignored) {
    const reasons = (node.ignoredReasons ?? []).map((reason) => reason.name).filter(Boolean)
    return { role: collapse(node.role?.value) || 'none', ignored: true, ...(reasons.length > 0 ? { ignoredReasons: reasons } : {}) }
  }
  const facts: AxFacts = { role: collapse(node.role?.value) || 'none' }
  const name = collapse(node.name?.value)
  if (name !== collapse(rampaName)) facts.name = name.slice(0, MAX_TEXT)
  const from = name ? nameSourceOf(node.name) : undefined
  if (from) facts.nameFrom = from
  const description = collapse(node.description?.value)
  if (description) facts.description = description.slice(0, MAX_TEXT)
  const value = collapse(node.value?.value)
  if (value) facts.value = value.slice(0, MAX_TEXT)
  const props: NonNullable<AxFacts['props']> = {}
  const relations: NonNullable<AxFacts['relations']> = {}
  for (const property of node.properties ?? []) {
    const raw = property.value?.value
    const keep = PROPS[property.name]
    if (keep?.(raw)) props[property.name] = raw as string | number | boolean
    if (RELATIONS.has(property.name)) {
      const refs = (property.value?.relatedNodes ?? []).flatMap((related) => {
        const ref = related.backendDOMNodeId === undefined ? undefined : refOf(related.backendDOMNodeId)
        return ref ? [ref] : []
      })
      if (refs.length > 0) relations[property.name] = refs.slice(0, 20)
    }
  }
  // atomic and relevant say something only about a live region.
  if (props.live === undefined) {
    delete props.atomic
    delete props.relevant
  }
  if (Object.keys(props).length > 0) facts.props = props
  if (Object.keys(relations).length > 0) facts.relations = relations
  return facts
}

/** Roles of controls: an element the browser exposes with one of them is not a custom control without a role. */
const CONTROL_ROLES = new Set([
  'button', 'checkbox', 'combobox', 'link', 'listbox', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'radio', 'scrollbar',
  'searchbox', 'slider', 'spinbutton', 'switch', 'tab', 'textbox', 'treeitem', 'gridcell', 'columnheader', 'rowheader', 'menu', 'menubar',
  'tablist', 'tree', 'treegrid', 'grid', 'radiogroup', 'DisclosureTriangle', 'PopUpButton', 'MenuListOption', 'MenuListPopup', 'ToggleButton',
])

/** The events that make an element a control when it listens to them itself. */
export const CONTROL_EVENTS = ['click', 'keydown', 'keyup', 'keypress', 'mousedown', 'mouseup', 'pointerdown', 'pointerup'] as const

/** Elements the custom-control rule asks about: a role that is not a control's, made focusable by tabindex or given an inline handler. */
function listenerCandidate(facts: AxFacts, attributes: Record<string, string>): boolean {
  if (facts.ignored || CONTROL_ROLES.has(facts.role) || facts.props?.editable !== undefined) return false
  const tabindex = Number.parseInt(attributes.tabindex ?? '', 10)
  const inline = CONTROL_EVENTS.some((event) => attributes[`on${event}`] !== undefined)
  return (Number.isFinite(tabindex) && tabindex >= 0) || inline
}

async function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`no answer within ${Math.round(ms)} ms`)), Math.max(0, ms))
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Reads the browser's accessibility tree onto the collected tree (`node.ax`) and returns the record of what it read
 * for the snapshot (`axTree`). Undefined when there is no CDP (another browser, a library without sessions); any
 * failure past that leaves the tree as it was and says why in the record.
 */
export async function attachAxTree(open: () => Promise<CdpSessionLike | undefined>, root: A11yNode, limits: AxLimits = AX_LIMITS): Promise<AxTree | undefined> {
  let opened: CdpSessionLike | undefined
  try {
    opened = await open()
  } catch {
    return undefined
  }
  if (!opened) return undefined
  const session = opened
  const deadline = Date.now() + limits.totalMs
  const left = () => deadline - Date.now()
  const record: AxTree = { source: 'cdp', nodes: 0, withoutNode: 0, namesDiffer: 0 }
  const send = <T>(method: string, params?: Record<string, unknown>): Promise<T> => within(session.send(method, params) as Promise<T>, left())
  try {
    const count = await send<{ result: { value?: unknown } }>('Runtime.evaluate', { expression: 'document.getElementsByTagName("*").length', returnByValue: true })
    const elementsOnPage = typeof count.result.value === 'number' ? count.result.value : 0
    if (elementsOnPage > limits.elements) return { ...record, skipped: `the page has ${elementsOnPage} elements, over the limit of ${limits.elements}` }

    const { root: domRoot } = await send<{ root: CdpDomNode }>('DOM.getDocument', { depth: -1, pierce: true })
    const { elements, frames, byId } = domElements(domRoot)
    const byRef = new Map<string, A11yNode>()
    for (const node of walkTree(root)) byRef.set(node.ref, node)
    const refOf = (backendId: number) => elements.get(backendId)?.ref

    const documents: Array<{ ref: string | undefined; frameId: string | undefined }> = [{ ref: undefined, frameId: undefined }]
    const leftOut: NonNullable<AxTree['framesLeftOut']> = []
    for (const frame of frames) {
      // Only frames whose document the collector put in the tree: the frame element has the frame's root as a child.
      if (!byRef.get(frame.ref)?.children.some((child) => child.ref.startsWith(`${frame.ref}${FRAME_SEPARATOR}`))) continue
      if (documents.length - 1 >= limits.frames) leftOut.push({ ref: frame.ref, reason: `over the limit of ${limits.frames} frames` })
      else documents.push({ ref: frame.ref, frameId: frame.frameId })
    }

    const seen = new Set<A11yNode>()
    for (const document of documents) {
      if (left() <= 0) {
        if (document.ref) leftOut.push({ ref: document.ref, reason: `over the time budget of ${limits.totalMs / 1000} s` })
        else return { ...record, skipped: `over the time budget of ${limits.totalMs / 1000} s` }
        continue
      }
      let nodes: CdpAxNode[]
      try {
        const answer = await send<{ nodes: CdpAxNode[] }>('Accessibility.getFullAXTree', document.frameId ? { frameId: document.frameId } : {})
        nodes = answer.nodes
      } catch (error) {
        const reason = error instanceof Error ? error.message.split('\n')[0] ?? 'error' : 'error'
        if (document.ref) {
          leftOut.push({ ref: document.ref, reason })
          continue
        }
        return { ...record, skipped: reason }
      }
      for (const axNode of nodes) {
        if (axNode.backendDOMNodeId === undefined) continue
        const element = elements.get(axNode.backendDOMNodeId)
        const node = element ? byRef.get(element.ref) : undefined
        if (!node || seen.has(node)) continue
        seen.add(node)
        node.ax = axFactsOf(axNode, node.name, refOf)
        // The browser relates only elements in its tree: what aria-controls names while hidden is read from the DOM.
        const controls = element?.attributes['aria-controls']
        if (controls && !node.ax.ignored && !node.ax.relations?.controls) {
          const refs = controls.split(/\s+/).flatMap((id) => (id ? [byId.get(idKey(node.ref, id))] : [])).filter((ref): ref is string => ref !== undefined)
          if (refs.length > 0) node.ax.relations = { ...node.ax.relations, controls: refs.slice(0, 20) }
        }
        if (node.ax.name !== undefined) record.namesDiffer++
      }
    }
    record.nodes = seen.size
    record.withoutNode = byRef.size - seen.size
    if (leftOut.length > 0) record.framesLeftOut = leftOut

    // Custom controls: an element focusable by tabindex, or with an inline handler, whose role is not a control's.
    const candidates: Array<{ node: A11yNode; backendId: number }> = []
    for (const [backendId, element] of elements) {
      const node = byRef.get(element.ref)
      if (!node?.ax || node.states.includes('hidden') || node.states.includes('aria-hidden')) continue
      if (listenerCandidate(node.ax, element.attributes)) candidates.push({ node, backendId })
    }
    if (candidates.length > 0) {
      let read = 0
      for (const { node, backendId } of candidates.slice(0, limits.listeners)) {
        if (left() <= 0) break
        const facts = await listenersOf(send, backendId, elements.get(backendId)?.attributes ?? {}).catch(() => undefined)
        if (!facts || !node.ax) continue
        read++
        // An empty list says the element was asked about and listens to none of the control events itself.
        node.ax.listeners = facts.events
        if (facts.scrollable) node.ax.scrollable = true
      }
      record.listeners = { read, leftOut: candidates.length - read }
    }
    return record
  } catch (error) {
    return { ...record, skipped: error instanceof Error ? (error.message.split('\n')[0] ?? 'error') : 'error' }
  } finally {
    await session.detach().catch(() => undefined)
  }
}

/** The control events an element listens to itself (its own listeners and inline handlers), and whether it scrolls. */
async function listenersOf(
  send: <T>(method: string, params?: Record<string, unknown>) => Promise<T>,
  backendNodeId: number,
  attributes: Record<string, string>,
): Promise<{ events: string[]; scrollable: boolean }> {
  const { object } = await send<{ object: { objectId?: string } }>('DOM.resolveNode', { backendNodeId })
  if (!object.objectId) return { events: [], scrollable: false }
  try {
    const { listeners } = await send<{ listeners: Array<{ type: string }> }>('DOMDebugger.getEventListeners', { objectId: object.objectId, depth: 0 })
    const events = new Set<string>(listeners.map((listener) => listener.type).filter((type) => (CONTROL_EVENTS as readonly string[]).includes(type)))
    for (const event of CONTROL_EVENTS) if (attributes[`on${event}`] !== undefined) events.add(event)
    const { result } = await send<{ result: { value?: unknown } }>('Runtime.callFunctionOn', {
      objectId: object.objectId,
      functionDeclaration:
        'function () { const s = getComputedStyle(this); const y = /(auto|scroll)/.test(s.overflowY) && this.scrollHeight > this.clientHeight + 1; const x = /(auto|scroll)/.test(s.overflowX) && this.scrollWidth > this.clientWidth + 1; return x || y }',
      returnByValue: true,
    })
    return { events: CONTROL_EVENTS.filter((event) => events.has(event)), scrollable: result.value === true }
  } finally {
    await send('Runtime.releaseObject', { objectId: object.objectId }).catch(() => undefined)
  }
}
