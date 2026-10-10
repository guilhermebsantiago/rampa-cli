import type { A11yNode } from '../snapshot/schema.ts'

/** CSS selectors that limit a check to part of the page, as axe-core's own context does. */
export interface Scope {
  include: string[]
  exclude: string[]
}

/** Undefined when there is nothing to scope to, so the check covers the whole page. */
export function normalizeScope(include?: string | readonly string[], exclude?: string | readonly string[]): Scope | undefined {
  const list = (value: string | readonly string[] | undefined): string[] =>
    (value === undefined ? [] : typeof value === 'string' ? [value] : [...value]).map((selector) => selector.trim()).filter((selector) => selector !== '')
  const scope = { include: list(include), exclude: list(exclude) }
  return scope.include.length + scope.exclude.length > 0 ? scope : undefined
}

export interface ScopeQuery {
  include: string[]
  exclude: string[]
  /** Refs of the snapshot nodes, to map matched elements back to them; empty to only validate the selectors. */
  refs: string[]
}

export interface ScopeAnswer {
  /** Selectors the browser could not parse, with its error. */
  invalid: Array<{ selector: string; error: string }>
  /** Include selectors that match no element. */
  unmatched: string[]
  /** Refs of the nodes the include selectors match. */
  included: string[]
  /** Refs of the nodes the exclude selectors match. */
  excluded: string[]
}

/**
 * Runs inside the browser page through `evaluate`, like `collectInPage`: it must not
 * reference anything outside its own body. Elements are mapped back to the refs the
 * collector gave them by querying each ref, so it works with any ref the collector builds.
 */
export function resolveScopeInPage(query: ScopeQuery): ScopeAnswer {
  const invalid: Array<{ selector: string; error: string }> = []
  const select = (selector: string): Element[] => {
    try {
      return Array.from(document.querySelectorAll(selector))
    } catch (error) {
      invalid.push({ selector, error: error instanceof Error ? error.message : String(error) })
      return []
    }
  }
  const includes = query.include.map((selector) => ({ selector, elements: select(selector) }))
  const excludes = query.exclude.map((selector) => ({ selector, elements: select(selector) }))
  const wanted = new Set<Element>([...includes, ...excludes].flatMap((match) => match.elements))
  const refOf = new Map<Element, string>()
  // The collector's own map when it ran on this page: a ref into a frame or a shadow root is no CSS selector.
  const nodes = (window as unknown as { __rampaNodes?: Map<string, Element> }).__rampaNodes
  for (const ref of query.refs) {
    if (refOf.size === wanted.size) break
    let element: Element | null = nodes?.get(ref) ?? null
    try {
      element ??= document.querySelector(ref)
    } catch {
      element = null
    }
    if (element && wanted.has(element) && !refOf.has(element)) refOf.set(element, ref)
  }
  const refsOf = (elements: Element[]): string[] =>
    elements.flatMap((element) => {
      const ref = refOf.get(element)
      return ref === undefined ? [] : [ref]
    })
  const failed = new Set(invalid.map((entry) => entry.selector))
  return {
    invalid,
    unmatched: includes.filter((match) => match.elements.length === 0 && !failed.has(match.selector)).map((match) => match.selector),
    included: includes.flatMap((match) => refsOf(match.elements)),
    excluded: excludes.flatMap((match) => refsOf(match.elements)),
  }
}

/** Roles whose name labels a region or a group of fields, which stays useful context around a component. */
const CONTEXT_NAME_ROLES = new Set(['banner', 'complementary', 'contentinfo', 'dialog', 'form', 'group', 'main', 'navigation', 'radiogroup', 'region', 'search'])

/**
 * The part of the tree a scoped check covers, with axe-core's rules: an element is in
 * scope when its closest matched ancestor (itself included) is an include, or when there
 * are no include selectors and none of its ancestors is excluded.
 *
 * Elements in scope keep their whole subtree, minus what is excluded. Their ancestors stay
 * as a skeleton, so the language, landmark and field group around a component are still
 * known, but nothing else those ancestors hold is: no text, no name taken from their
 * content, and no other children. Returns undefined when nothing is in scope.
 */
export function scopeTree(root: A11yNode, included: ReadonlySet<string>, excluded: ReadonlySet<string>): A11yNode | undefined {
  const visit = (node: A11yNode, parentIn: boolean): { node: A11yNode; lost: boolean } | undefined => {
    const inScope = excluded.has(node.ref) ? false : included.has(node.ref) ? true : parentIn
    const children: A11yNode[] = []
    let lost = false
    for (const child of node.children) {
      const kept = visit(child, inScope)
      if (!kept) {
        lost = true
        continue
      }
      children.push(kept.node)
      if (kept.lost) lost = true
    }
    if (inScope) return { node: lost ? withoutRecordedText(node, children) : { ...node, children }, lost }
    if (children.length === 0) return undefined
    return { node: skeleton(node, children), lost: true }
  }
  return visit(root, included.size === 0)?.node
}

/** Texts the collector recorded for the whole subtree would still read what was removed from it. */
function withoutRecordedText(node: A11yNode, children: A11yNode[]): A11yNode {
  const { readingText: _reading, fullText: _full, langText: _lang, ...native } = node.native
  return { ...node, native, children }
}

function skeleton(node: A11yNode, children: A11yNode[]): A11yNode {
  // The start tag still serves a patch to an attribute such as lang; the rest of the markup is out of scope.
  const { html, ...native } = withoutRecordedText(node, children).native
  const startTag = typeof html === 'string' ? /^<[^>]*>/.exec(html)?.[0] : undefined
  return {
    ref: node.ref,
    role: node.role,
    name: CONTEXT_NAME_ROLES.has(node.role) ? node.name : undefined,
    lang: node.lang,
    states: node.states,
    bounds: node.bounds,
    native: startTag === undefined ? native : { ...native, html: startTag },
    children,
  }
}
