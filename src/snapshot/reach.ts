import { type Locale, t } from '../i18n.ts'
import { PLAIN_PAGE_ELEMENTS, bodyLookOf, isDefaultLook } from './look.ts'
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
  const sheets = reach.stylesheets && (reach.stylesheets.failed.length > 0 || reach.stylesheets.unstyled) ? reach.stylesheets : undefined
  if (frames.length === 0 && closed === 0 && !reach.truncated && !reach.masked && reach.loadTimedOutMs === undefined && !sheets && !reach.overlay) return undefined
  return {
    ...(frames.length > 0 ? { frames } : {}),
    ...(closed > 0 && reach.shadowRoots ? { shadowRoots: reach.shadowRoots } : {}),
    ...(reach.truncated ? { truncated: true } : {}),
    ...(reach.masked ? { masked: reach.masked } : {}),
    ...(reach.loadTimedOutMs !== undefined ? { loadTimedOutMs: reach.loadTimedOutMs } : {}),
    ...(sheets ? { stylesheets: sheets } : {}),
    ...(reach.overlay ? { overlay: reach.overlay } : {}),
  }
}

/**
 * Whether the page was read without its styles, which makes every judgment that rests on what is visible a suggestion
 * (core/check.ts), and how Rampa tells:
 * - `stylesheets`: the collector found the page's linked stylesheets had not applied, even after one more load
 *   (`reach.stylesheets.unstyled` with sheets linked); a failed link whose address is the page itself is no stylesheet,
 *   so a recording that counted one (www.thejournal.ie, fourth real-page study) is read as styled when every other
 *   failure was such a link and some sheet applied;
 * - `look`: the page came with no style at all and its body text had the browser's default look (snapshot/look.ts),
 *   recorded by the collector as `unstyled` with no sheet linked; for a recording made before the collector looked
 *   (no `authorStyles` on the root), read from its body look and size alone (www.ufpe.br in the third study,
 *   museudoamanha.org.br in the fourth: the only two of the 72 recorded pages with that look).
 */
export function captureStyle(snapshot: Pick<A11ySnapshot, 'reach' | 'root' | 'target'>): { unstyled: boolean; by?: 'stylesheets' | 'look' | undefined; selfLinks?: number | undefined } {
  const sheets = snapshot.reach?.stylesheets
  if (sheets?.unstyled) {
    const selfLinks = sheets.failed.filter((sheet) => samePage(sheet.href, snapshot.target)).length
    if (selfLinks > 0 && selfLinks === sheets.failed.length && sheets.applied > 0) return { unstyled: false, selfLinks }
    return { unstyled: true, by: sheets.linked === 0 ? 'look' : 'stylesheets' }
  }
  if (sheets === undefined && snapshot.root.native.authorStyles === undefined && isDefaultLook(bodyLookOf(snapshot.root))) {
    let elements = 0
    for (const node of walkTree(snapshot.root)) if (!node.ref.includes(SHADOW_SEPARATOR) && !node.ref.includes(FRAME_SEPARATOR)) elements++
    if (elements >= PLAIN_PAGE_ELEMENTS) return { unstyled: true, by: 'look' }
  }
  return { unstyled: false }
}

/** Whether an address is the page's own, without its fragment. */
function samePage(href: string, target: string): boolean {
  try {
    const page = new URL(target)
    const url = new URL(href, page)
    page.hash = ''
    url.hash = ''
    return url.href === page.href
  } catch {
    return false
  }
}

/** The snapshot's `reach` as a report states it: a recorded unstyled verdict that `captureStyle` corrects is dropped. */
export function reachSeen(snapshot: Pick<A11ySnapshot, 'reach' | 'root' | 'target'>): Reach | undefined {
  const reach = snapshot.reach
  const sheets = reach?.stylesheets
  if (!reach || !sheets?.unstyled || captureStyle(snapshot).unstyled) return reach
  const { unstyled: _dropped, ...kept } = sheets
  return { ...reach, stylesheets: kept }
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
  // A page read without its stylesheets frames everything else: said first, then a load that timed out.
  if (gaps.stylesheets) {
    const sheets = gaps.stylesheets
    const list = sheets.failed
      .slice(0, MAX_LISTED)
      .map((sheet) => `${sheet.href} (${sheet.reason})`)
      .join(', ')
    notes.push(
      t(locale, sheets.unstyled ? (sheets.linked === 0 ? 'reachUnstyledLook' : 'reachUnstyled') : 'reachStylesheets', { failed: sheets.failed.length, linked: sheets.linked, list: list || '?' }),
    )
  }
  if (gaps.loadTimedOutMs !== undefined) notes.push(t(locale, 'reachLoadTimedOut', { ms: gaps.loadTimedOutMs }))
  if (gaps.overlay) notes.push(t(locale, 'reachOverlay', { selector: gaps.overlay.selector, coverage: `${Math.round(gaps.overlay.coverage * 100)}%` }))
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
