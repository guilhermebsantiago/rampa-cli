import { FRAME_SEPARATOR } from '../snapshot/refs.ts'
import type { Reach } from '../snapshot/schema.ts'
import type { CdpSessionLike } from './form-issues.ts'
import type { EngineFrame } from './frames.ts'
import type { InPageFrame } from './in-page.ts'

/**
 * The snapshot's `reach`: the frames the collector met and what axe-core did in each, the open shadow roots it
 * read, and the closed ones the browser reports, which no script can read. snapshot/reach.ts turns the gaps into
 * the report's notes, so nothing the collector could not read is dropped without a word.
 */

const MAX_HOSTS = 10

export interface ReachInput {
  frames: readonly InPageFrame[]
  /** What axe-core did per frame; undefined when it did not run on the page. */
  engineFrames?: readonly EngineFrame[] | undefined
  shadowRoots: number
  closed?: { count: number; hosts: string[] } | undefined
  unsettledAfterMs?: number | undefined
}

/** Undefined when the page has no frame and no shadow root, and settled in time: the snapshot stays as it always was. */
export function buildReach(input: ReachInput): Reach | undefined {
  const engine = new Map((input.engineFrames ?? []).map((frame) => [frame.ref, frame]))
  const ran = input.engineFrames !== undefined
  const missed = (input.engineFrames ?? []).filter((frame) => !frame.engine).map((frame) => `${frame.ref}${FRAME_SEPARATOR}`)
  // A frame axe-core never listed was left out on purpose (hidden from assistive technology, or outside the checked
  // part of the page), unless it sits in a frame axe-core could not check.
  const unlisted = (ref: string) => (missed.some((prefix) => ref.startsWith(prefix)) ? 'inside a frame axe-core could not check' : 'skipped')
  const engineFields = (ref: string, found: EngineFrame | undefined) =>
    !ran ? {} : found ? { engine: found.engine, ...(found.engine ? {} : { engineReason: found.reason ?? 'not checked' }) } : { engine: false, engineReason: unlisted(ref) }
  const frames: NonNullable<Reach['frames']> = input.frames.map((frame) => {
    const found = engine.get(frame.ref)
    engine.delete(frame.ref)
    return { ref: frame.ref, ...(frame.url ? { url: frame.url } : {}), collected: frame.collected, ...(frame.reason ? { reason: frame.reason } : {}), ...engineFields(frame.ref, found) }
  })
  // Frames axe-core reached that the collector never met: they sit inside frames the page may not read.
  for (const found of engine.values()) frames.push({ ref: found.ref, collected: false, reason: 'cross-origin', ...engineFields(found.ref, found) })
  const closed = input.closed?.count ?? 0
  const reach: Reach = {
    ...(frames.length > 0 ? { frames } : {}),
    ...(input.shadowRoots > 0 || closed > 0
      ? { shadowRoots: { open: input.shadowRoots, ...(input.closed ? { closed, ...(input.closed.hosts.length > 0 ? { closedHosts: input.closed.hosts } : {}) } : {}) } }
      : {}),
    ...(input.unsettledAfterMs !== undefined ? { unsettledAfterMs: input.unsettledAfterMs } : {}),
  }
  return Object.keys(reach).length > 0 ? reach : undefined
}

interface CdpNode {
  backendNodeId?: number
  children?: CdpNode[]
  shadowRoots?: Array<CdpNode & { shadowRootType?: string }>
  contentDocument?: CdpNode
  templateContent?: CdpNode
}

/**
 * The closed shadow roots of the page and of the frames in its process, as the browser itself reports them
 * (CDP DOM.getDocument, pierced), with the refs of up to 10 of their hosts. Undefined without CDP.
 */
export async function closedShadowRoots(open: () => Promise<CdpSessionLike | undefined>): Promise<{ count: number; hosts: string[] } | undefined> {
  let session: CdpSessionLike | undefined
  try {
    session = await open()
    if (!session) return undefined
    const { root } = (await session.send('DOM.getDocument', { depth: -1, pierce: true })) as { root: CdpNode }
    const hosts: number[] = []
    let count = 0
    const stack: CdpNode[] = [root]
    while (stack.length > 0) {
      const node = stack.pop()
      if (!node) break
      for (const shadow of node.shadowRoots ?? []) {
        if (shadow.shadowRootType !== 'closed') continue
        count++
        if (node.backendNodeId !== undefined && hosts.length < MAX_HOSTS) hosts.push(node.backendNodeId)
      }
      // Pushed last first, so the hosts come out in document order.
      const next = [...(node.shadowRoots ?? []), ...(node.contentDocument ? [node.contentDocument] : []), ...(node.templateContent ? [node.templateContent] : []), ...(node.children ?? [])]
      for (let i = next.length - 1; i >= 0; i--) {
        const child = next[i]
        if (child) stack.push(child)
      }
    }
    if (count === 0) return { count, hosts: [] }
    const refs: string[] = []
    for (const backendNodeId of hosts) {
      try {
        const { object } = (await session.send('DOM.resolveNode', { backendNodeId })) as { object: { objectId?: string } }
        if (!object.objectId) continue
        const { result } = (await session.send('Runtime.callFunctionOn', {
          objectId: object.objectId,
          functionDeclaration: 'function () { try { const top = window.top; return top && top.__rampaRefOf ? top.__rampaRefOf(this) : undefined } catch (error) { return undefined } }',
          returnByValue: true,
        })) as { result: { value?: unknown } }
        if (typeof result.value === 'string') refs.push(result.value)
      } catch {
        // The host went away.
      }
    }
    return { count, hosts: refs }
  } catch {
    return undefined
  } finally {
    await session?.detach().catch(() => undefined)
  }
}
