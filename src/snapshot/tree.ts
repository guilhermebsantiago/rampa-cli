import type { A11yNode } from './schema.ts'

export interface IndexedNode {
  node: A11yNode
  parentRef: string | undefined
  depth: number
}

export type TreeIndex = Map<string, IndexedNode>

export function indexTree(root: A11yNode): TreeIndex {
  const index: TreeIndex = new Map()
  const stack: Array<{ node: A11yNode; parentRef: string | undefined; depth: number }> = [
    { node: root, parentRef: undefined, depth: 0 },
  ]
  while (stack.length > 0) {
    const entry = stack.pop()
    if (!entry) break
    index.set(entry.node.ref, entry)
    for (let i = entry.node.children.length - 1; i >= 0; i--) {
      const child = entry.node.children[i]
      if (child) stack.push({ node: child, parentRef: entry.node.ref, depth: entry.depth + 1 })
    }
  }
  return index
}

/** Depth-first, document order. */
export function* walkTree(root: A11yNode): Generator<A11yNode> {
  const stack: A11yNode[] = [root]
  while (stack.length > 0) {
    const node = stack.pop()
    if (!node) break
    yield node
    for (let i = node.children.length - 1; i >= 0; i--) {
      const child = node.children[i]
      if (child) stack.push(child)
    }
  }
}

/** Language a node inherits from its closest ancestor that declares one. */
export function inheritedLang(index: TreeIndex, ref: string, fallback?: string): string | undefined {
  let current = index.get(ref)?.parentRef
  while (current !== undefined) {
    const entry = index.get(current)
    if (!entry) break
    if (entry.node.lang) return entry.node.lang
    current = entry.parentRef
  }
  return fallback
}

/**
 * Text that inherits its language from `node`: its own text plus the text of
 * descendants, stopping at descendants that declare their own language.
 * Image names count, because they are read in the same language.
 */
export function textInheritingLang(node: A11yNode): string {
  const parts: string[] = []
  const visit = (current: A11yNode, isRoot: boolean): void => {
    if (!isRoot && current.lang !== undefined && current.lang.trim() !== '') return
    if (current.text) parts.push(current.text)
    if (current.role === 'img' && current.name) parts.push(current.name)
    for (const child of current.children) visit(child, false)
  }
  visit(node, true)
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}
