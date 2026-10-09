import type { A11yNode } from '../snapshot/schema.ts'
import type { TreeIndex } from '../snapshot/tree.ts'
import type { InPageIdentity } from './kit.ts'

/**
 * Probes run on a fresh load, and pages change between loads (random ids, A/B tests, ads).
 * A fact is tied to a snapshot node only when the ref resolves and the node has the same
 * tag and key attributes; otherwise it is unmatched, and rules treat it as cannot tell.
 */

const cut = (value: unknown): string => (typeof value === 'string' ? value.slice(0, 100) : '')

/** The identity the kit computes in the page, computed again from a snapshot node. */
export function snapshotSignature(node: A11yNode): string {
  const attributes = (node.native.attributes ?? {}) as Record<string, unknown>
  const tag = typeof node.native.tag === 'string' ? node.native.tag : ''
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

/** How a finding names an element: its role and name, or its tag and text. */
export function nameOf(node: A11yNode | undefined, fallback: { tag?: string | undefined; label?: string | undefined } = {}): string {
  const tag = typeof node?.native.tag === 'string' ? node.native.tag : (fallback.tag ?? 'element')
  const text = (node?.name || node?.text || fallback.label || '').replace(/\s+/g, ' ').trim()
  const short = text.length > 60 ? `${text.slice(0, 59)}…` : text
  return short ? `<${tag}> "${short}"` : `<${tag}>`
}
