import { createHash } from 'node:crypto'
import { contrastRatio, hexColor, relativeLuminance } from '../pixels/contrast.ts'
import type { RgbaImage } from '../pixels/png.ts'

/**
 * Pixel comparisons for the focus probes. Two captures of the same region are compared pixel
 * by pixel; a third capture of the unchanged state marks pixels that move on their own
 * (carousels, video, caret blink) as noise, and those are never counted.
 */

export interface PixelDiff {
  /** Pixels compared (the region's area, in CSS px). */
  area: number
  /** Pixels that differ at all, outside the noise mask. */
  changed: number
  /** Changed pixels whose two colors differ by at least 3:1 contrast. */
  strong: number
  /** Changed pixels that differ by 3:1, or by at least 48 in one channel (a change of hue, such as a yellow highlight). */
  noticeable: number
  /** Pixels that changed on their own between two captures of the same state. */
  masked: number
  /** Where the change is, relative to the region. */
  bbox?: { x: number; y: number; width: number; height: number } | undefined
  /** The most frequent colors of the changed pixels, before and after. */
  before?: string | undefined
  after?: string | undefined
}

const rgbAt = (image: RgbaImage, at: number) => ((image.data[at] ?? 0) << 16) | ((image.data[at + 1] ?? 0) << 8) | (image.data[at + 2] ?? 0)
const luminance = (rgb: number) => relativeLuminance((rgb >> 16) & 0xff, (rgb >> 8) & 0xff, rgb & 0xff)

/** Compares `a` (changed state) with `b` (unchanged state); `noise` is a second capture of `b`'s state. */
export function diffImages(a: RgbaImage, b: RgbaImage, noise?: RgbaImage): PixelDiff {
  const width = Math.min(a.width, b.width)
  const height = Math.min(a.height, b.height)
  const diff: PixelDiff = { area: width * height, changed: 0, strong: 0, noticeable: 0, masked: 0 }
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = -1
  let maxY = -1
  const befores = new Map<number, number>()
  const afters = new Map<number, number>()
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ia = (y * a.width + x) * 4
      const ib = (y * b.width + x) * 4
      const before = rgbAt(b, ib)
      if (noise && x < noise.width && y < noise.height && rgbAt(noise, (y * noise.width + x) * 4) !== before) {
        diff.masked++
        continue
      }
      const after = rgbAt(a, ia)
      if (after === before) continue
      diff.changed++
      const strong = contrastRatio(luminance(after), luminance(before)) >= 3
      if (strong) diff.strong++
      const channel = Math.max(Math.abs(((after >> 16) & 0xff) - ((before >> 16) & 0xff)), Math.abs(((after >> 8) & 0xff) - ((before >> 8) & 0xff)), Math.abs((after & 0xff) - (before & 0xff)))
      if (strong || channel >= 48) diff.noticeable++
      befores.set(before, (befores.get(before) ?? 0) + 1)
      afters.set(after, (afters.get(after) ?? 0) + 1)
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  }
  if (diff.changed > 0) {
    diff.bbox = { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
    const top = (counts: Map<number, number>) => [...counts.entries()].sort((p, q) => q[1] - p[1])[0]?.[0]
    const before = top(befores)
    const after = top(afters)
    if (before !== undefined) diff.before = hexColor(before)
    if (after !== undefined) diff.after = hexColor(after)
  }
  return diff
}

export function imageHash(png: Uint8Array): string {
  return createHash('sha256').update(png).digest('hex').slice(0, 16)
}
