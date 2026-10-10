import { type Locale, t } from '../i18n.ts'
import type { Reach } from './schema.ts'

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
  if (frames.length === 0 && closed === 0 && !reach.truncated) return undefined
  return {
    ...(frames.length > 0 ? { frames } : {}),
    ...(closed > 0 && reach.shadowRoots ? { shadowRoots: reach.shadowRoots } : {}),
    ...(reach.truncated ? { truncated: true } : {}),
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
  const closed = gaps.shadowRoots?.closed ?? 0
  if (closed > 0) {
    const hosts = gaps.shadowRoots?.closedHosts ?? []
    notes.push(t(locale, 'reachClosedShadow', { count: closed, hosts: hosts.length > 0 ? hosts.join(', ') : '?' }))
  }
  return notes
}
