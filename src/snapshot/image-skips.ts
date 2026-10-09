import { type Locale, type MessageKey, t } from '../i18n.ts'
import type { A11yNode } from './schema.ts'
import { walkTree } from './tree.ts'

/**
 * Why the collector left an image without a capture. It is recorded on the node as
 * `native.imageSkipped`, so a saved snapshot says it too, and the report sums it up in a note:
 * a criterion that needs the pixels (1.1.1, 1.4.5) never judges an image from someone else's.
 *
 * - outside-page: most of the image lies outside the page, such as a logo in an off-canvas menu at a negative x.
 * - clipped: most of it stays cut off by a box that holds it (a closed menu, a container with no room for it).
 * - not-shown: it is transparent where it sits, so a capture shows what is behind it.
 * - not-loaded: it was still loading after the wait.
 * - placeholder: it still shows a lazy-load placeholder (a 1×1 pixel, a data: URI, a stand-in file).
 * - blank: its capture is one flat color, the same as without it.
 * - stacked: it shares its box with other images (carousel slides in one place), and its capture came out the same as theirs.
 * - capture-failed: the screenshot could not be taken.
 * - limit: the page had more images than the collector captures.
 */
export const IMAGE_SKIPS = ['outside-page', 'clipped', 'not-shown', 'not-loaded', 'placeholder', 'blank', 'stacked', 'capture-failed', 'limit'] as const
export type ImageSkip = (typeof IMAGE_SKIPS)[number]

export function imageSkipOf(node: A11yNode): ImageSkip | undefined {
  const value = node.native.imageSkipped
  return typeof value === 'string' && (IMAGE_SKIPS as readonly string[]).includes(value) ? (value as ImageSkip) : undefined
}

export function setImageSkip(node: A11yNode, reason: ImageSkip): void {
  node.native.imageSkipped = reason
  node.image = undefined
}

const LABELS: Record<ImageSkip, MessageKey> = {
  'outside-page': 'imageSkipOutsidePage',
  clipped: 'imageSkipClipped',
  'not-shown': 'imageSkipNotShown',
  'not-loaded': 'imageSkipNotLoaded',
  placeholder: 'imageSkipPlaceholder',
  blank: 'imageSkipBlank',
  stacked: 'imageSkipStacked',
  'capture-failed': 'imageSkipCaptureFailed',
  limit: 'imageSkipLimit',
}

/** The report's note on the images left without a capture, by reason; undefined when there are none. */
export function uncapturedImagesNote(root: A11yNode, locale: Locale): string | undefined {
  const counts = new Map<ImageSkip, number>()
  for (const node of walkTree(root)) {
    const reason = imageSkipOf(node)
    if (reason) counts.set(reason, (counts.get(reason) ?? 0) + 1)
  }
  if (counts.size === 0) return undefined
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0)
  const reasons = IMAGE_SKIPS.filter((reason) => counts.has(reason))
    .map((reason) => `${counts.get(reason)} ${t(locale, LABELS[reason])}`)
    .join('; ')
  return t(locale, 'imagesNotCaptured', { count: total, reasons })
}
