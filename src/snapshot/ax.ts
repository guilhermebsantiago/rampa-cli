import { type Locale, t } from '../i18n.ts'
import type { A11yNode, A11ySnapshot, AxFacts, AxTree } from './schema.ts'
import { walkTree } from './tree.ts'

/**
 * Reading the browser's accessibility tree that the collector recorded on each node (`node.ax`, see
 * surfaces/ax-tree.ts). The collector's own `role` and `name` stay as they were, so a criterion or a rule moves to
 * what the browser computes one at a time (docs/plans/wcag-coverage.md, B2), through these helpers.
 */

/** The browser's facts for a node, when it recorded them and the browser keeps a node for it. */
export function axOf(node: A11yNode): AxFacts | undefined {
  return node.ax
}

/** Whether the browser exposes the node to assistive technology: it has a node for it, and does not ignore it. */
export function exposed(node: A11yNode): boolean {
  return node.ax !== undefined && node.ax.ignored !== true
}

/**
 * The name assistive technology gets: the browser's, where it recorded one for the node (it records its own only
 * when it differs from the collector's), else the collector's. A node the browser ignores keeps the collector's
 * name, which describes its markup (a hidden image's alt).
 */
export function exposedName(node: A11yNode): string | undefined {
  if (!node.ax || node.ax.ignored) return node.name
  return node.ax.name ?? node.name
}

/** Chromium's internal roles, in the ARIA words the collector uses for the same elements. */
const INTERNAL_ROLES: Record<string, string> = {
  image: 'img',
  RootWebArea: 'document',
  DisclosureTriangle: 'button',
  PopUpButton: 'combobox',
  MenuListPopup: 'listbox',
  MenuListOption: 'option',
  ToggleButton: 'button',
  SvgRoot: 'graphics-document',
  LayoutTable: 'presentation',
  LayoutTableRow: 'presentation',
  LayoutTableCell: 'presentation',
  sectionheader: 'generic',
  sectionfooter: 'generic',
  Section: 'generic',
}

/** The role the browser exposes, in ARIA's words where Chromium uses its own; undefined when the browser has no node for it. */
export function exposedRole(node: A11yNode): string | undefined {
  if (!node.ax) return undefined
  if (node.ax.ignored) return 'none'
  return INTERNAL_ROLES[node.ax.role] ?? node.ax.role
}

/** Where the browser's name came from (aria-label, aria-labelledby, label, contents...), when it recorded one. */
export function nameSource(node: A11yNode): string | undefined {
  return exposed(node) ? node.ax?.nameFrom : undefined
}

/** Whether the collector read the browser's tree for this snapshot, and onto how many nodes. */
export function axTreeRead(snapshot: Pick<A11ySnapshot, 'axTree'>): boolean {
  return snapshot.axTree !== undefined && snapshot.axTree.skipped === undefined && snapshot.axTree.nodes > 0
}

/**
 * Elements the collector names from their text although ARIA gives them no name (a list item, a label, a caption):
 * where the browser computes none for them, their `name` stands for their text, and stays.
 */
const NAMED_FROM_TEXT = new Set(['li', 'label', 'legend', 'caption', 'figcaption', 'dt', 'dd'])

/**
 * The name a criterion that moved to the browser's names reads: the browser's, where it computed one; none where it
 * computed none for an element that would have one (a link whose only text is hidden from assistive technology);
 * the collector's for an element the browser ignores or never names (a list item, a label).
 */
export function browserName(node: A11yNode): string | undefined {
  if (!node.ax || node.ax.ignored || node.ax.name === undefined) return node.name
  if (node.ax.name !== '') return node.ax.name
  return NAMED_FROM_TEXT.has(String(node.native.tag)) ? node.name : undefined
}

/** A copy of the tree with each node's name as `browserName` reads it: what a criterion that moved to the browser's names reads. */
export function withExposedNames(root: A11yNode): A11yNode {
  const copy = (node: A11yNode): A11yNode => ({ ...node, name: browserName(node), children: node.children.map(copy) })
  return copy(root)
}

const views = new WeakMap<A11ySnapshot, A11ySnapshot>()

/**
 * The snapshot as a criterion that moved to the browser's names reads it (`Criterion.names === 'browser'`): the same
 * nodes and refs, with names as `browserName` gives them. The snapshot itself when the browser's tree was not read.
 * Built once per snapshot.
 */
export function browserNamed(snapshot: A11ySnapshot): A11ySnapshot {
  if (!snapshot.axTree || snapshot.axTree.namesDiffer === 0) return snapshot
  const known = views.get(snapshot)
  if (known) return known
  const view = { ...snapshot, root: withExposedNames(snapshot.root) }
  views.set(snapshot, view)
  return view
}

/** Every node of the tree the browser exposes as a live region root: aria-live polite or assertive, or an implicitly live role. */
export function liveRegions(root: A11yNode): A11yNode[] {
  const found: A11yNode[] = []
  const visit = (node: A11yNode, inside: boolean): void => {
    const live = exposed(node) && (node.ax?.props?.live !== undefined || ['timer', 'marquee'].includes(node.ax?.role ?? ''))
    if (live && !inside) found.push(node)
    for (const child of node.children) visit(child, inside || live)
  }
  visit(root, false)
  return found
}

/** What the report says about the browser's tree when the collector read less than all of it; empty when it read it all. */
export function axNotes(axTree: AxTree | undefined, locale: Locale): string[] {
  if (!axTree) return []
  const notes: string[] = []
  if (axTree.skipped) notes.push(t(locale, 'axSkipped', { reason: axTree.skipped }))
  const frames = axTree.framesLeftOut ?? []
  if (frames.length > 0) {
    const shown = frames.slice(0, 5).map((frame) => `${frame.ref} (${frame.reason})`)
    notes.push(t(locale, 'axFramesLeftOut', { count: frames.length, frames: `${shown.join(', ')}${frames.length > 5 ? ` +${frames.length - 5}` : ''}` }))
  }
  if ((axTree.listeners?.leftOut ?? 0) > 0) notes.push(t(locale, 'axListenersLeftOut', { count: axTree.listeners?.leftOut ?? 0 }))
  return notes
}

/** For tests and tools: the nodes whose browser name differs from the collector's. */
export function namesThatDiffer(root: A11yNode): A11yNode[] {
  return [...walkTree(root)].filter((node) => exposed(node) && node.ax?.name !== undefined)
}

export type { AxFacts, AxTree }
