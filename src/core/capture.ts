import { IMAGE_SKIPS, type ImageSkip, imageSkipOf } from '../snapshot/image-skips.ts'
import { captureStyle, pageCut } from '../snapshot/reach.ts'
import type { A11yNode, A11ySnapshot } from '../snapshot/schema.ts'
import { walkTree } from '../snapshot/tree.ts'
import type { CriterionSummary } from './types.ts'

/**
 * How faithfully the page was read, in one record of the report (`Report.capture`): facts the report gives in its notes
 * and in scattered fields (`coverage.reach`, `coverage.truncated`, `blocked`, `httpStatus`, the criteria's summaries),
 * gathered so a reader, or a tool such as a review package, finds them in one place, with two the report did not give
 * before: how many images have a capture, and a page still changing when the wait after load ended (`unsettledAfterMs`).
 * It reports and decides nothing: no verdict, finding, note or exit code reads it.
 *
 * Every input is already in the snapshot or in the criteria's summaries, so a recording of any age gives the record on
 * replay, and the snapshot's schema is unchanged. Every field but `version` and `styled` is absent when there is
 * nothing to say: a page read in full gives `{ version: 1, styled: true }`, with `images` when it has images.
 *
 * It holds no share of an image's crop covered by other page content, nor anything else derived from boxes about paint
 * order. The snapshot keeps boxes, not paint order, z-index or transparency, and a count on the 48 recorded dev pages of
 * the second to fifth real-page studies found boxes alone misleading: they flagged 129 of 703 crops (0.18) at a covered
 * share of 0.05 or more, while by eye 9 of 25 crops looked at had content painted over them, and 1 of the 15 looked at
 * with a share of 1 (counted, in-sample, dev; docs/studies/notes-crop-overlay.md, sections 4 and 6).
 */
export interface CaptureRecord {
  /** 1: this shape. The report's own `schemaVersion` does not move with it. */
  version: 1
  /**
   * false when the page was read without its styles (`captureStyle(snapshot).unstyled`, snapshot/reach.ts): every
   * judgment that rests on what is visible was then the model's suggestion, and nothing was measured from pixels.
   */
  styled: boolean
  /**
   * How Rampa told, when `styled` is false (`captureStyle(snapshot).by`): `stylesheets`, the page's linked stylesheets
   * had not applied even after one more load; `look`, the page came with no style at all and its body text had the
   * browser's default look (read from the look alone for a recording made before the collector recorded its stylesheets).
   */
  styledBy?: 'stylesheets' | 'look' | undefined
  /**
   * The page's linked stylesheets, from `reach.stylesheets`, which the collector records when some had not applied or
   * the page was loaded once more for them: how many were linked, applied and failed, and whether the page was loaded
   * again. Counts only; the addresses stay in `coverage.reach.stylesheets`.
   */
  stylesheets?: { linked: number; applied: number; failed: number; retried?: boolean | undefined } | undefined
  /**
   * `reach.overlay`: a layer that lay over most of the viewport when the page was read (a consent backdrop, a welcome
   * dialog), at `coverage` of the points sampled, and whether it was hidden while images, labels and contrast were captured.
   */
  overlay?: { selector: string; coverage: number; hidden: boolean } | undefined
  /** The site sent a bot check or a refusal in place of the page (`snapshot.blocked`): nothing of it was read. The detail stays in `Report.blocked`. */
  blocked?: true | undefined
  /** `snapshot.httpStatus`, recorded when it was an error (400 or more): the page read is the error page that came with it. */
  httpStatus?: number | undefined
  /** `pageCut(snapshot)`: the collector stopped reading the page's own document at its budget, after this many elements. */
  cut?: { elements: number } | undefined
  /** `reach.unsettledAfterMs`: the page was still changing (network or DOM) when the wait after load reached its cap, in milliseconds. */
  unsettledAfterMs?: number | undefined
  /** `reach.loadTimedOutMs`: the page's load event had not fired when the timeout ran out, in milliseconds, and it was read as it was. */
  loadTimedOutMs?: number | undefined
  /**
   * Image nodes with and without a capture, and why without. An image node is an element the collector crops as a
   * picture for the criteria that judge pixels (1.1.1, 1.4.5): role `img`; tag `img`, `svg` or `canvas`; an `input` of
   * type `image`; or a native image control (`native.imageControl`, Android). On the web (surfaces/image-capture.ts) the
   * collector either attaches the crop (`image`) or records why it took none (`native.imageSkipped`, the reasons of
   * snapshot/image-skips.ts); on Android and iOS it crops named images from the screenshot and records no reason.
   * - `captured`: image nodes with a crop. The crops of CSS backgrounds, which other elements carry for 1.4.5, are not counted.
   * - `notCaptured` and `reasons`: every node with a reason, the nodes the report's note on images left without a capture counts.
   * Absent when no image node has a crop and no node has a reason: a page with no image the collector tried to capture, or one
   * collected without image capture (no criterion that needs vision, or `--no-llm`). An image the collector does not try
   * (hidden, broken, smaller than 8 px, an unnamed svg the signals of snapshot/hidden-images.ts leave out) is in neither count.
   */
  images?: { captured: number; notCaptured: number; reasons: Partial<Record<ImageSkip, number>> } | undefined
  /**
   * Per criterion with candidates the model did not judge, from its summary (`Report.criteria`): `capped`, past the cap
   * on candidates (`--max-candidates`); `timedOut`, past the time limit (`--time-limit`); `offlineMisses`, no cached
   * answer offline, counted as the summary counts them (a second pass with no cached answer included); `errors`, a
   * model error. `candidates` is the criterion's candidates on the page. Absent when the model judged every candidate it
   * was meant to; a run without judgment (`--no-llm`) judges none by design, and its report says so in `llm`.
   */
  notJudged?: Array<{ criterion: string; candidates: number; capped?: number | undefined; timedOut?: number | undefined; offlineMisses?: number | undefined; errors?: number | undefined }> | undefined
}

/** The capture record of a report: what the snapshot and the criteria's summaries say of how faithfully the page was read. No model, file or network. */
export function captureRecord(snapshot: A11ySnapshot, summaries: readonly CriterionSummary[]): CaptureRecord {
  const style = captureStyle(snapshot)
  const reach = snapshot.reach
  const sheets = reach?.stylesheets
  const overlay = reach?.overlay
  const elements = pageCut(snapshot)
  const images = imageCounts(snapshot.root)
  const notJudged = summaries.flatMap((summary) => {
    const { capped = 0, timedOut = 0, offlineMisses = 0, errors = 0 } = summary
    if (capped + timedOut + offlineMisses + errors === 0) return []
    return [
      {
        criterion: summary.criterion,
        candidates: summary.candidates,
        ...(capped > 0 ? { capped } : {}),
        ...(timedOut > 0 ? { timedOut } : {}),
        ...(offlineMisses > 0 ? { offlineMisses } : {}),
        ...(errors > 0 ? { errors } : {}),
      },
    ]
  })
  return {
    version: 1,
    styled: !style.unstyled,
    ...(style.unstyled && style.by ? { styledBy: style.by } : {}),
    ...(sheets
      ? { stylesheets: { linked: sheets.linked, applied: sheets.applied, failed: sheets.failed.length, ...(sheets.retried !== undefined ? { retried: sheets.retried } : {}) } }
      : {}),
    ...(overlay ? { overlay: { selector: overlay.selector, coverage: overlay.coverage, hidden: overlay.hidden } } : {}),
    ...(snapshot.blocked ? { blocked: true as const } : {}),
    ...(snapshot.httpStatus ? { httpStatus: snapshot.httpStatus } : {}),
    ...(elements !== undefined ? { cut: { elements } } : {}),
    ...(reach?.unsettledAfterMs !== undefined ? { unsettledAfterMs: reach.unsettledAfterMs } : {}),
    ...(reach?.loadTimedOutMs !== undefined ? { loadTimedOutMs: reach.loadTimedOutMs } : {}),
    ...(images ? { images } : {}),
    ...(notJudged.length > 0 ? { notJudged } : {}),
  }
}

/** An element the collector crops as a picture for the criteria that judge pixels, on the web or a native surface. */
function isImageNode(node: A11yNode): boolean {
  const tag = node.native.tag
  const attributes = (node.native.attributes ?? {}) as Record<string, unknown>
  return node.role === 'img' || tag === 'img' || tag === 'svg' || tag === 'canvas' || (tag === 'input' && attributes.type === 'image') || node.native.imageControl === true
}

/** Image nodes with a crop, and every node with a reason for having none, by reason in the order of IMAGE_SKIPS; undefined when there are neither. */
function imageCounts(root: A11yNode): CaptureRecord['images'] {
  let captured = 0
  const skipped = new Map<ImageSkip, number>()
  for (const node of walkTree(root)) {
    const reason = imageSkipOf(node)
    if (reason) skipped.set(reason, (skipped.get(reason) ?? 0) + 1)
    else if (node.image && isImageNode(node)) captured++
  }
  const notCaptured = [...skipped.values()].reduce((sum, count) => sum + count, 0)
  if (captured + notCaptured === 0) return undefined
  const reasons: Partial<Record<ImageSkip, number>> = {}
  for (const reason of IMAGE_SKIPS) {
    const count = skipped.get(reason)
    if (count) reasons[reason] = count
  }
  return { captured, notCaptured, reasons }
}
