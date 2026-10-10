import { contrastRatio, relativeLuminance } from './contrast.ts'
import type { PixelRect, RgbaImage } from './png.ts'

/**
 * The achromatopsia render for 1.4.1 (Use of Color): each pixel reduced to its relative luminance, which is all a
 * person with no color vision gets from it. Two captures of the same box, before and after a change of color, are
 * compared in that render: a change whose luminance contrast stays under 3:1 is a difference that disappears
 * without color vision. WCAG's Understanding for 1.4.1 counts a difference in lightness of 3:1 or more as a visual
 * distinction of its own.
 */

/** A pixel changed when one of its channels moved by this much: anti-aliasing noise between two captures stays below. */
export const COLOR_DELTA = 24
/** The share of the strongest changed pixels left out as noise when reading how strong a change is. */
const NOISE_SHARE = 0.005

export interface GrayChange {
  /** Pixels compared. */
  area: number
  /** Pixels whose color changed (a channel by COLOR_DELTA or more): what a person with color vision sees change. */
  colorChanged: number
  /** Of those, how many changed by a luminance contrast of 3:1 or more: what stays visible in the gray render. */
  strong: number
  /** The luminance contrast of the change at its strongest, with the top 0.5% of changed pixels left out as noise. */
  strongest: number
}

const at = (image: RgbaImage, x: number, y: number) => (y * image.width + x) * 4
const lum = (image: RgbaImage, i: number) => relativeLuminance(image.data[i] ?? 0, image.data[i + 1] ?? 0, image.data[i + 2] ?? 0)

/** Compares two captures of the same box in the gray render; `a` and `b` may differ in size by a rounding pixel. */
export function grayChange(a: RgbaImage, b: RgbaImage): GrayChange {
  const width = Math.min(a.width, b.width)
  const height = Math.min(a.height, b.height)
  const contrasts: number[] = []
  let strong = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = at(a, x, y)
      const j = at(b, x, y)
      const delta = Math.max(
        Math.abs((a.data[i] ?? 0) - (b.data[j] ?? 0)),
        Math.abs((a.data[i + 1] ?? 0) - (b.data[j + 1] ?? 0)),
        Math.abs((a.data[i + 2] ?? 0) - (b.data[j + 2] ?? 0)),
      )
      if (delta < COLOR_DELTA) continue
      const ratio = contrastRatio(lum(a, i), lum(b, j))
      contrasts.push(ratio)
      if (ratio >= 3) strong++
    }
  }
  contrasts.sort((p, q) => p - q)
  const index = Math.min(contrasts.length - 1, Math.floor(contrasts.length * (1 - NOISE_SHARE)))
  const strongest = contrasts.length === 0 ? 1 : Math.round((contrasts[index] ?? 1) * 100) / 100
  return { area: width * height, colorChanged: contrasts.length, strong, strongest }
}

/** The share of pixels that differ between two captures of the same box beyond rendering noise. */
export function movedShare(a: RgbaImage, b: RgbaImage): number {
  if (a.width !== b.width || a.height !== b.height) return 1
  let changed = 0
  for (let i = 0; i < a.data.length; i += 4) {
    const diff = Math.max(Math.abs((a.data[i] ?? 0) - (b.data[i] ?? 0)), Math.abs((a.data[i + 1] ?? 0) - (b.data[i + 1] ?? 0)), Math.abs((a.data[i + 2] ?? 0) - (b.data[i + 2] ?? 0)))
    if (diff > 2) changed++
  }
  return changed / Math.max(1, a.width * a.height)
}

/** Ink in the four bands around a box, in rows (or columns) of ink: ink pixels divided by the band's length. */
export interface BandInk {
  top: number
  bottom: number
  left: number
  right: number
}

/** Ink is a pixel whose luminance contrast with its band's most common color is at least this. */
const INK_CONTRAST = 1.5
/** How far a band reaches inside the box, past its edge, in pixels. */
const INSIDE = 2

/**
 * The halo around an element in the gray render: for each side, a band from INSIDE pixels within the box to `halo`
 * pixels outside it, as wide (or tall) as the box. What it measures is ink a side shows that the band's own
 * background does not: an indicator bar under a tab, a mark beside a menu item, drawn by an element that is not
 * the item's own.
 */
export function ringInk(image: RgbaImage, box: PixelRect, halo: number): BandInk {
  const x0 = Math.round(box.x)
  const y0 = Math.round(box.y)
  const x1 = Math.round(box.x + box.width)
  const y1 = Math.round(box.y + box.height)
  const band = (left: number, top: number, right: number, bottom: number, length: number): number => {
    const l = Math.max(0, left)
    const t = Math.max(0, top)
    const r = Math.min(image.width, right)
    const b = Math.min(image.height, bottom)
    if (r <= l || b <= t || length <= 0) return 0
    const counts = new Map<number, number>()
    for (let y = t; y < b; y++) {
      for (let x = l; x < r; x++) {
        const i = at(image, x, y)
        const rgb = ((image.data[i] ?? 0) << 16) | ((image.data[i + 1] ?? 0) << 8) | (image.data[i + 2] ?? 0)
        counts.set(rgb, (counts.get(rgb) ?? 0) + 1)
      }
    }
    const mode = [...counts.entries()].sort((p, q) => q[1] - p[1])[0]?.[0] ?? 0
    const base = relativeLuminance((mode >> 16) & 0xff, (mode >> 8) & 0xff, mode & 0xff)
    let ink = 0
    for (const [rgb, count] of counts) {
      if (contrastRatio(relativeLuminance((rgb >> 16) & 0xff, (rgb >> 8) & 0xff, rgb & 0xff), base) >= INK_CONTRAST) ink += count
    }
    return Math.round((ink / length) * 100) / 100
  }
  return {
    top: band(x0, y0 - halo, x1, y0 + INSIDE, x1 - x0),
    bottom: band(x0, y1 - INSIDE, x1, y1 + halo, x1 - x0),
    left: band(x0 - halo, y0, x0 + INSIDE, y1, y1 - y0),
    right: band(x1 - INSIDE, y0, x1 + halo, y1, y1 - y0),
  }
}
