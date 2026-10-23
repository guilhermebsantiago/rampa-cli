import { type Locale, t } from '../i18n.ts'
import { FRAME_SEPARATOR, SHADOW_SEPARATOR } from './refs.ts'
import type { A11ySnapshot, Reach } from './schema.ts'
import { walkTree } from './tree.ts'

/**
 * What the collector could not read on a page, from the snapshot's `reach`, so a report says it instead of
 * dropping it: frames whose content is not in the snapshot (another origin: axe-core checked them, Rampa's rules
 * and the judged criteria did not read them), frames nothing checked, and closed shadow roots, which no script
 * can open. Hidden frames are not content, and frames axe-core leaves out by design are not gaps.
 */

type ReachFrame = NonNullable<Reach['frames']>[number]

/** Reasons that are not gaps: a frame that is not rendered, or one axe-core leaves out on purpose. */
const BY_DESIGN = new Set(['hidden', 'skipped'])

/** The part of `reach` that was not reached; undefined when everything was. */
export function unreached(reach: Reach | undefined): Reach | undefined {
  if (!reach) return undefined
  const frames = (reach.frames ?? []).filter(
    (frame) => !BY_DESIGN.has(frame.reason ?? '') && (!frame.collected || (frame.engine === false && !BY_DESIGN.has(frame.engineReason ?? ''))),
  )
  const closed = reach.shadowRoots?.closed ?? 0
  if (frames.length === 0 && closed === 0 && !reach.truncated && !reach.masked && reach.loadTimedOutMs === undefined) return undefined
  return {
    ...(frames.length > 0 ? { frames } : {}),
    ...(closed > 0 && reach.shadowRoots ? { shadowRoots: reach.shadowRoots } : {}),
    ...(reach.truncated ? { truncated: true } : {}),
    ...(reach.masked ? { masked: reach.masked } : {}),
    ...(reach.loadTimedOutMs !== undefined ? { loadTimedOutMs: reach.loadTimedOutMs } : {}),
  }
}

const MAX_LISTED = 5

function listed(frames: readonly ReachFrame[], why: (frame: ReachFrame) => string | undefined): string {
  const shown = frames.slice(0, MAX_LISTED).map((frame) => {
    const reason = why(frame)
    return reason ? `${frame.ref} (${reason})` : frame.ref
  })
  const more = frames.length - shown.length
  return `${shown.join(', ')}${more > 0 ? ` +${more}` : ''}`
}

/** The report's notes on what the collector could not read, in the report's language; empty when it read everything. */
export function reachNotes(reach: Reach | undefined, locale: Locale): string[] {
  const gaps = unreached(reach)
  if (!gaps) return []
  const notes: string[] = []
  // A page read before its load event fired frames everything else: said first.
  if (gaps.loadTimedOutMs !== undefined) notes.push(t(locale, 'reachLoadTimedOut', { ms: gaps.loadTimedOutMs }))
  const frames = gaps.frames ?? []
  // axe-core may run in a frame that has not loaded, on its blank document: that checks nothing.
  const engineOnly = frames.filter((frame) => !frame.collected && frame.engine === true && frame.reason !== 'not-loaded')
  const unchecked = frames.filter((frame) => !frame.collected && (frame.engine !== true || frame.reason === 'not-loaded'))
  const noEngine = frames.filter((frame) => frame.collected && frame.engine === false)
  const address = (frame: ReachFrame) => [frame.reason === 'loaded-late' ? frame.reason : undefined, frame.url].filter(Boolean).join(', ')
  if (engineOnly.length > 0) notes.push(t(locale, 'reachEngineOnly', { count: engineOnly.length, frames: listed(engineOnly, address) }))
  if (unchecked.length > 0) {
    notes.push(t(locale, 'reachUnchecked', { count: unchecked.length, frames: listed(unchecked, (frame) => [frame.reason, frame.engineReason].filter(Boolean).join('; ')) }))
  }
  if (noEngine.length > 0) notes.push(t(locale, 'reachNoEngine', { count: noEngine.length, frames: listed(noEngine, (frame) => frame.engineReason) }))
  if (gaps.truncated) notes.push(t(locale, 'reachTruncated'))
  if (gaps.masked) notes.push(t(locale, 'reachMasked', { count: gaps.masked }))
  const closed = gaps.shadowRoots?.closed ?? 0
  if (closed > 0) {
    const hosts = gaps.shadowRoots?.closedHosts ?? []
    notes.push(t(locale, 'reachClosedShadow', { count: closed, hosts: hosts.length > 0 ? hosts.join(', ') : '?' }))
  }
  return notes
}

/**
 * The page's own document cut at the collector's budget of elements (`snapshot.truncated`): how many elements it read.
 * A snapshot recorded before the collector kept its limit (`elementLimit`) gives the elements of the page's own
 * document in its tree, which is the limit unless the run was scoped to a part of the page.
 */
export function pageCut(snapshot: Pick<A11ySnapshot, 'truncated' | 'elementLimit' | 'root'>): number | undefined {
  if (!snapshot.truncated) return undefined
  if (snapshot.elementLimit) return snapshot.elementLimit
  let count = 0
  for (const node of walkTree(snapshot.root)) if (!node.ref.includes(SHADOW_SEPARATOR) && !node.ref.includes(FRAME_SEPARATOR)) count++
  return count
}

/**
 * The report's note on a page cut at the collector's budget: where it was cut, that the checks that read the snapshot
 * did not run past it (Rampa's rules and judged criteria, with the criteria they checked only up to the cut), that a
 * probe's findings past it cannot be pointed at, and that the engine, which runs in the page, read all of it.
 */
export function truncationNote(cut: { elements: number; criteria: readonly string[] }, context: { engine?: string | undefined; probes: boolean }, locale: Locale): string {
  return [
    t(locale, 'pageTruncated', { count: cut.elements }),
    cut.criteria.length > 0 ? t(locale, 'pageTruncatedCriteria', { criteria: cut.criteria.join(', ') }) : '',
    context.probes ? t(locale, 'pageTruncatedProbes') : '',
    context.engine ? t(locale, 'pageTruncatedEngine', { engine: context.engine }) : '',
  ]
    .filter(Boolean)
    .join(' ')
}
