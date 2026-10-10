import { shown } from '../criteria/labels-or-instructions.ts'
import { attributesOf, readingTextOf } from '../criteria/shared.ts'
import { idKey } from '../snapshot/refs.ts'
import type { A11yNode, A11ySnapshot } from '../snapshot/schema.ts'
import { type TreeIndex, indexTree, inheritedLang, walkTree } from '../snapshot/tree.ts'

/** The snapshot read once for all the advisory checks: tree index, document order and ids. */
export interface Page {
  snapshot: A11ySnapshot
  index: TreeIndex
  ordered: A11yNode[]
  position: Map<A11yNode, number>
  byId: Map<string, A11yNode>
}

export function readPage(snapshot: A11ySnapshot): Page {
  const ordered = [...walkTree(snapshot.root)]
  const byId = new Map<string, A11yNode>()
  for (const node of ordered) {
    const id = attributesOf(node).id
    if (id && !byId.has(idKey(node.ref, id))) byId.set(idKey(node.ref, id), node)
  }
  return { snapshot, index: indexTree(snapshot.root), ordered, position: new Map(ordered.map((node, i) => [node, i])), byId }
}

export function tagOf(node: A11yNode): string {
  return typeof node.native.tag === 'string' ? node.native.tag : ''
}

export function parentOf(page: Page, node: A11yNode): A11yNode | undefined {
  const parentRef = page.index.get(node.ref)?.parentRef
  return parentRef ? page.index.get(parentRef)?.node : undefined
}

/** The ancestors of a node, closest first. */
export function ancestorsOf(page: Page, node: A11yNode): A11yNode[] {
  const out: A11yNode[] = []
  for (let current = parentOf(page, node); current; current = parentOf(page, current)) out.push(current)
  return out
}

export function languageOf(page: Page, node: A11yNode): string {
  return node.lang ?? inheritedLang(page.index, node.ref, page.snapshot.locale) ?? page.snapshot.locale ?? 'und'
}

export function formOf(page: Page, node: A11yNode): A11yNode | undefined {
  return ancestorsOf(page, node).find((ancestor) => tagOf(ancestor) === 'form')
}

/** A field a person can type into or tick now: rendered on screen, enabled and not read-only. */
export function usable(node: A11yNode): boolean {
  return shown(node) && !node.states.includes('aria-hidden') && !node.states.includes('disabled') && !node.states.includes('readonly')
}

/** The whole text of a block in reading order: the collector keeps a short copy for criteria and the rest apart. */
export function blockText(node: A11yNode): { text: string; cut: boolean } | undefined {
  const full = node.native.fullText
  if (typeof full === 'string') return { text: full, cut: full.length >= 20_000 }
  const reading = readingTextOf(node)
  // A snapshot recorded before fullText existed cut every block at 1000 characters.
  return reading === undefined ? undefined : { text: reading, cut: reading.length >= 1000 }
}

/** A run of text as people read it: a block in reading order, or the own text of a node outside any block. */
export interface TextRun {
  node: A11yNode
  text: string
  /** The collector cut the text: what lies past the cut was not seen. */
  cut: boolean
  language: string
  /** In a label, button, heading, legend, navigation or form: where COGA says to start using clear words. */
  interface: boolean
  /** In code, pre, kbd, samp or var: not prose. */
  code: boolean
}

const INTERFACE_TAGS = new Set(['label', 'legend', 'button', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'summary', 'option', 'th', 'caption', 'nav', 'form', 'select'])
const INTERFACE_ROLES = new Set(['button', 'heading', 'navigation', 'menu', 'menubar', 'menuitem', 'tab', 'tablist', 'form', 'search', 'columnheader'])
const CODE_TAGS = new Set(['code', 'pre', 'kbd', 'samp', 'var'])
const BUTTON_INPUTS = new Set(['submit', 'button', 'reset'])

export function textRuns(page: Page): TextRun[] {
  const runs: TextRun[] = []
  const visit = (node: A11yNode, inInterface: boolean, inCode: boolean): void => {
    if (!shown(node)) return
    const tag = tagOf(node)
    const isInterface = inInterface || INTERFACE_TAGS.has(tag) || INTERFACE_ROLES.has(node.role)
    const isCode = inCode || CODE_TAGS.has(tag)
    const push = (text: string, cut = false) => {
      if (text.trim()) runs.push({ node, text, cut, language: languageOf(page, node), interface: isInterface, code: isCode })
    }
    const block = blockText(node)
    if (block) {
      // The block's text already holds its children's, in reading order; code inside it is blanked, not prose.
      push(isCode ? block.text : withoutCode(node, block.text), block.cut)
      return
    }
    if (node.text) push(node.text)
    const attributes = attributesOf(node)
    // What a field shows before anyone types, and the words on an input button.
    if (attributes.placeholder?.trim()) push(attributes.placeholder)
    if (tag === 'input' && BUTTON_INPUTS.has((attributes.type ?? '').toLowerCase()) && node.name) push(node.name)
    for (const child of node.children) visit(child, isInterface, isCode)
  }
  visit(page.snapshot.root, false, false)
  return runs
}

/** A block's text with the text of the code, kbd, samp and var inside it blanked, so offsets stay where they were. */
function withoutCode(block: A11yNode, text: string): string {
  const codeTexts: string[] = []
  const visit = (node: A11yNode, inCode: boolean): void => {
    const code = inCode || CODE_TAGS.has(tagOf(node))
    if (code && node.text?.trim()) codeTexts.push(node.text.trim())
    for (const child of node.children) visit(child, code)
  }
  for (const child of block.children) visit(child, false)
  let out = text
  let from = 0
  for (const code of codeTexts) {
    const at = out.indexOf(code, from)
    if (at < 0) continue
    out = `${out.slice(0, at)}${' '.repeat(code.length)}${out.slice(at + code.length)}`
    from = at + code.length
  }
  return out
}

/** Finds the run that holds a node's text: the node's own run, or the block around it. */
export function runFinder(page: Page, runs: readonly TextRun[]): (node: A11yNode) => number | undefined {
  const byNode = new Map<A11yNode, number>()
  for (const [index, run] of runs.entries()) if (!byNode.has(run.node)) byNode.set(run.node, index)
  return (node) => {
    for (const candidate of [node, ...ancestorsOf(page, node)]) {
      const index = byNode.get(candidate)
      if (index !== undefined) return index
    }
    return undefined
  }
}
