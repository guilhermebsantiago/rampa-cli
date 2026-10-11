import type { A11yNode } from '../snapshot/schema.ts'
import type { TreeIndex } from '../snapshot/tree.ts'
import type { InPageIdentity } from './kit.ts'

/**
 * Probes run on a fresh load, and pages change between loads (random ids, A/B tests, ads).
 * A fact is tied to a snapshot node only when the ref resolves and the node has the same
 * tag and key attributes; otherwise it is unmatched, and rules treat it as cannot tell.
 */

const cut = (value: unknown): string => (typeof value === 'string' ? value.slice(0, 100) : '')
const text = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined)

/** A node of an app screen's platform type: an Android class, or an XCUIElement type name. */
export function nativeType(node: A11yNode): string | undefined {
  return text(node.native.class) ?? text(node.native.elementType)
}

/**
 * The identity of a node of an app screen (Android, iOS), which has no tag and no attributes: its platform type, its
 * resource-id or accessibilityIdentifier, its role and its name. The native probes (probes/native/) tie each node they
 * saw to the snapshot node it stands for and record this signature, which the rules compute again from the snapshot.
 */
export function nativeSignature(node: A11yNode): string {
  const id = text(node.native.resourceId) ?? text(node.native.identifier) ?? ''
  return ['native', cut(nativeType(node) ?? ''), cut(id), cut(node.role), cut(node.name)].join('|')
}

/** The identity the kit computes in the page, computed again from a snapshot node; an app screen's nodes have their own. */
export function snapshotSignature(node: A11yNode): string {
  // Every node a web collector writes has its tag; app screens' nodes have none.
  if (typeof node.native.tag !== 'string') return nativeSignature(node)
  const attributes = (node.native.attributes ?? {}) as Record<string, unknown>
  const tag = node.native.tag
  return [tag, cut(attributes.id), cut(attributes.role), cut(attributes.type), cut(attributes.name), cut(attributes.href)].join('|')
}

/** The snapshot node a probe fact is about, or undefined when the ref or the identity does not match. */
export function matchNode(index: TreeIndex, ref: unknown, id: unknown): A11yNode | undefined {
  if (typeof ref !== 'string') return undefined
  const node = index.get(ref)?.node
  if (!node) return undefined
  const identity = id as Partial<InPageIdentity> | undefined
  if (!identity || typeof identity.sig !== 'string') return undefined
  return snapshotSignature(node) === identity.sig ? node : undefined
}

/** How a message names a node's kind: its tag on the web, its class without the package (Button) or its element type on app screens. */
export function tagOf(node: A11yNode): string | undefined {
  if (typeof node.native.tag === 'string') return node.native.tag
  const type = nativeType(node)
  return type ? (type.split('.').pop() ?? type) : undefined
}

/** How a finding names an element: its role and name, or its tag and text. */
export function nameOf(node: A11yNode | undefined, fallback: { tag?: string | undefined; label?: string | undefined } = {}): string {
  const tag = (node ? tagOf(node) : undefined) ?? fallback.tag ?? 'element'
  const value = (node?.name || node?.text || fallback.label || '').replace(/\s+/g, ' ').trim()
  const short = value.length > 60 ? `${value.slice(0, 59)}…` : value
  return short ? `<${tag}> "${short}"` : `<${tag}>`
}
