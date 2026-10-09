import { type PixelRect, type RgbaImage, clipRect } from './png.ts'

/**
 * Text contrast measured from a screenshot, for surfaces where no style sheet says what
 * the colors are. The background is the color that covers most of the box; the text is
 * the most contrasting color that a meaningful number of pixels share. Anti-aliasing only
 * blends text toward the background, so taking the most contrasting color can overstate
 * the ratio but not understate it, as long as some pixels are fully covered by a stroke.
 * They are when strokes are at least three pixels wide; when they are thinner (small text
 * at a low resolution), or the background is an image or a gradient, the box is reported
 * as not measurable instead of guessed. Lines that cross the box (a field's underline, a
 * border) are not text and are left out before the text color is chosen.
 */

export interface ContrastMeasure {
  ratio: number
  /** #rrggbb */
  foreground: string
  background: string
  /** Share of the box in the background color. */
  backgroundShare: number
  /** Typical stroke width, in pixels. */
  stroke: number
}

export type ContrastReason = 'outside' | 'too-small' | 'busy-background' | 'no-text-pixels' | 'thin-text'

export type ContrastResult = { ok: true; measure: ContrastMeasure } | { ok: false; reason: ContrastReason }

/** Below this, the background is not one color: an image, a gradient, or a box that holds several things. */
const MIN_BACKGROUND_SHARE = 0.3
/** Pixels this close to a color count as that color (largest channel difference). */
const SAME_COLOR = 8
/** A run of three text pixels has a fully covered one in the middle; narrower strokes may have none. */
const MIN_STROKE = 3

export function relativeLuminance(r: number, g: number, b: number): number {
  const channel = (value: number): number => {
    const c = value / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

export function contrastRatio(a: number, b: number): number {
  const [light, dark] = a >= b ? [a, b] : [b, a]
  return (light + 0.05) / (dark + 0.05)
}

export function hexColor(rgb: number): string {
  return `#${rgb.toString(16).padStart(6, '0')}`
}

const red = (rgb: number) => (rgb >> 16) & 0xff
const green = (rgb: number) => (rgb >> 8) & 0xff
const blue = (rgb: number) => rgb & 0xff
const distance = (a: number, b: number) => Math.max(Math.abs(red(a) - red(b)), Math.abs(green(a) - green(b)), Math.abs(blue(a) - blue(b)))
const luminanceOf = (rgb: number) => relativeLuminance(red(rgb), green(rgb), blue(rgb))
const rgbAt = (image: RgbaImage, at: number) => ((image.data[at] ?? 0) << 16) | ((image.data[at + 1] ?? 0) << 8) | (image.data[at + 2] ?? 0)

export function measureTextContrast(image: RgbaImage, box: PixelRect): ContrastResult {
  const rect = clipRect(image, box)
  if (!rect) return { ok: false, reason: 'outside' }
  // A box mostly outside the screenshot is a stale or scrolled node, not text to measure.
  if (rect.width * rect.height < box.width * box.height * 0.5) return { ok: false, reason: 'outside' }
  if (rect.width < 4 || rect.height < 4) return { ok: false, reason: 'too-small' }

  const counts = new Map<number, number>()
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    let at = (y * image.width + rect.x) * 4
    for (let x = 0; x < rect.width; x++, at += 4) {
      const rgb = rgbAt(image, at)
      counts.set(rgb, (counts.get(rgb) ?? 0) + 1)
    }
  }
  const total = rect.width * rect.height
  let background = 0
  let top = 0
  for (const [rgb, count] of counts) {
    if (count > top) {
      top = count
      background = rgb
    }
  }
  const backgroundLuminance = luminanceOf(background)
  let backgroundPixels = 0
  const inkColors = new Set<number>()
  for (const [rgb, count] of counts) {
    if (distance(rgb, background) <= SAME_COLOR) backgroundPixels += count
    // Text differs from the background in lightness, or in hue at about the same lightness.
    else if (contrastRatio(luminanceOf(rgb), backgroundLuminance) >= 1.1 || distance(rgb, background) >= 32) inkColors.add(rgb)
  }
  const backgroundShare = backgroundPixels / total
  if (backgroundShare < MIN_BACKGROUND_SHARE) return { ok: false, reason: 'busy-background' }

  const { colors, text } = textPixels(image, rect, inkColors)
  const found = new Map<number, number>()
  let textCount = 0
  for (let i = 0; i < text.length; i++) {
    if (!text[i]) continue
    const rgb = colors[i] ?? 0
    found.set(rgb, (found.get(rgb) ?? 0) + 1)
    textCount++
  }
  if (textCount < Math.max(6, total * 0.005)) return { ok: false, reason: 'no-text-pixels' }
  const stroke = medianRun(text, rect.width, rect.height)
  if (stroke < MIN_STROKE) return { ok: false, reason: 'thin-text' }

  // The most contrasting color among those enough pixels share; a stray pixel is not the text.
  const enough = Math.max(2, textCount * 0.01)
  let foreground = background
  let ratio = 1
  for (const [rgb, count] of found) {
    if (count < enough) continue
    const candidate = contrastRatio(luminanceOf(rgb), backgroundLuminance)
    if (candidate > ratio) {
      ratio = candidate
      foreground = rgb
    }
  }
  if (foreground === background) return { ok: false, reason: 'no-text-pixels' }
  return { ok: true, measure: { ratio, foreground: hexColor(foreground), background: hexColor(background), backgroundShare, stroke } }
}

/**
 * Which pixels of the box are text: those that differ from the background, minus lines.
 * A run across most of the box is an underline, a border or a divider, never a stroke of a
 * letter, and it is often darker than the text (a field's underline under its placeholder).
 */
function textPixels(image: RgbaImage, rect: PixelRect, inkColors: Set<number>): { colors: Int32Array; text: Uint8Array } {
  const { width, height } = rect
  const colors = new Int32Array(width * height)
  const text = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    let at = ((rect.y + y) * image.width + rect.x) * 4
    for (let x = 0; x < width; x++, at += 4) {
      const rgb = rgbAt(image, at)
      colors[y * width + x] = rgb
      if (inkColors.has(rgb)) text[y * width + x] = 1
    }
  }
  const line = new Uint8Array(width * height)
  const markRuns = (count: number, length: number, index: (outer: number, inner: number) => number, longest: number) => {
    for (let outer = 0; outer < count; outer++) {
      let start = 0
      for (let inner = 0; inner <= length; inner++) {
        if (inner < length && text[index(outer, inner)]) continue
        if (inner - start >= longest) for (let k = start; k < inner; k++) line[index(outer, k)] = 1
        start = inner + 1
      }
    }
  }
  markRuns(height, width, (y, x) => y * width + x, Math.max(8, width * 0.4))
  // Stems of tall letters can fill much of a tight line box; borders fill all of it.
  markRuns(width, height, (x, y) => y * width + x, Math.max(8, height * 0.8))
  for (let i = 0; i < text.length; i++) if (line[i]) text[i] = 0
  return { colors, text }
}

/**
 * The typical width of a stroke, from runs of text pixels along each row: vertical stems
 * outnumber horizontal bars, so the median run is about one stem wide.
 */
function medianRun(text: Uint8Array, width: number, height: number): number {
  const runs: number[] = []
  for (let y = 0; y < height; y++) {
    let run = 0
    for (let x = 0; x <= width; x++) {
      if (x < width && text[y * width + x]) run++
      else if (run > 0) {
        runs.push(run)
        run = 0
      }
    }
  }
  if (runs.length === 0) return 0
  runs.sort((a, b) => a - b)
  return runs[Math.floor(runs.length / 2)] ?? 0
}

/** Two decimals; a ratio below a threshold never reads as the threshold it misses: 4.499 reads 4.49, not 4.50. */
export function formatRatio(ratio: number): string {
  let shown = Math.round(ratio * 100) / 100
  for (const threshold of [3, 4.5, 7]) if (ratio < threshold && shown >= threshold) shown = Math.floor(ratio * 100) / 100
  return `${shown.toFixed(2)}:1`
}
