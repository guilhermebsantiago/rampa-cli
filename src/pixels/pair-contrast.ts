import { contrastRatio, hexColor, relativeLuminance } from './contrast.ts'
import type { PixelRect, RgbaImage } from './png.ts'

/**
 * Contrast from a pair of captures of the same box: as rendered, and bare, with the text (or the icon)
 * made transparent and everything else left as it was. The pixels that differ are the glyphs, and the
 * bare capture holds, for each of them, the color right behind it: a background image, a gradient, a
 * text shadow or whatever else the page paints there. This is how Rampa measures what axe-core cannot
 * decide (docs/rules.md, "Pixel rules").
 *
 * It follows ACT's reading of contrast for text over images and gradients (afw4f7, 09o5cg): the highest
 * possible contrast between the text's color and the colors behind it. When even that falls short, the
 * text fails whatever part of it one looks at. When the lowest contrast is enough, every part of the text
 * has it. In between, part of the text has enough and part does not, and a person decides.
 *
 * The text's color comes from the style sheet when nothing blends it (an opacity, a filter, a blend mode,
 * text clipped to a background): then every glyph pixel is compared exactly, an alpha in the color is
 * composited over what lies behind each pixel, and anti-aliasing does not matter. When the style sheet
 * cannot say, or its color is nowhere in the pixels, the color is read from the pixels: the most
 * contrasting color that enough glyph pixels share, as in contrast.ts.
 */

export type Rgba = readonly [number, number, number, number]

export interface PairInput {
  rendered: RgbaImage
  bare: RgbaImage
  /** Where to look, in image pixels: the element's own lines of text, or an icon's box. The whole image when empty. */
  regions?: readonly PixelRect[] | undefined
  /** The color the style sheet paints with, alpha from 0 to 1, when nothing else blends it. */
  foreground?: Rgba | undefined
  /** Icons: parts of the icon count as next to each other too, such as a white glyph on a colored disc. */
  internal?: boolean | undefined
}

export interface PairMeasure {
  /** Glyph (or icon) pixels compared. */
  pixels: number
  /** #rrggbb, or #rrggbbaa for a color with alpha from the style sheet. */
  foreground: string
  foregroundFrom: 'css' | 'pixels'
  /** Behind the glyphs: the most common color, the one that gives the lowest contrast and the one that gives the highest. */
  background: { common: string; worst: string; best: string }
  /** The highest contrast the glyphs reach against what is behind them, leaving out the top 0.5% of pixels as noise. */
  highest: number
  /** The lowest, leaving out the bottom 1%. */
  lowest: number
  /** The typical width of a stroke, in image pixels. */
  stroke: number
  /** Pixel colors only: whether one color holds the strokes. Text in a gradient, or a picture, has many. */
  uniform: boolean
}

export type PairReason = 'size-mismatch' | 'no-text-pixels' | 'unstable'

export type PairResult = { ok: true; measure: PairMeasure } | { ok: false; reason: PairReason }

/** A channel difference at most this large is rendering noise (gradient dithering), not a glyph. */
const NOISE = 2
/** A pixel this close to the composited text color shows the text's own color: a stroke covers it fully. */
const SAME = 12
const MIN_PIXELS = 6

const luminance = (r: number, g: number, b: number) => relativeLuminance(r, g, b)
const pack = (r: number, g: number, b: number) => (r << 16) | (g << 8) | b

function percentile(sorted: Float64Array, share: number): number {
  if (sorted.length === 0) return 1
  const at = Math.min(sorted.length - 1, Math.max(0, Math.floor(share * (sorted.length - 1))))
  return sorted[at] ?? 1
}

function percentileOf(values: Float64Array, share: number): number {
  return percentile(Float64Array.from(values).sort(), share)
}

export function measurePair(input: PairInput): PairResult {
  const { rendered, bare } = input
  if (Math.abs(rendered.width - bare.width) > 1 || Math.abs(rendered.height - bare.height) > 1) return { ok: false, reason: 'size-mismatch' }
  const width = Math.min(rendered.width, bare.width)
  const height = Math.min(rendered.height, bare.height)
  const inside = new Uint8Array(width * height)
  const regions = input.regions && input.regions.length > 0 ? input.regions : [{ x: 0, y: 0, width, height }]
  for (const region of regions) {
    const x0 = Math.max(0, Math.floor(region.x))
    const y0 = Math.max(0, Math.floor(region.y))
    const x1 = Math.min(width, Math.ceil(region.x + region.width))
    const y1 = Math.min(height, Math.ceil(region.y + region.height))
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) inside[y * width + x] = 1
  }

  // The glyphs: pixels that differ between the two captures, inside the regions.
  const glyph = new Uint8Array(width * height)
  const at: number[] = []
  let area = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (!inside[i]) continue
      area++
      const a = (y * rendered.width + x) * 4
      const b = (y * bare.width + x) * 4
      const diff = Math.max(
        Math.abs((rendered.data[a] ?? 0) - (bare.data[b] ?? 0)),
        Math.abs((rendered.data[a + 1] ?? 0) - (bare.data[b + 1] ?? 0)),
        Math.abs((rendered.data[a + 2] ?? 0) - (bare.data[b + 2] ?? 0)),
      )
      if (diff > NOISE) {
        glyph[i] = 1
        at.push(i)
      }
    }
  }
  if (at.length < MIN_PIXELS) return { ok: false, reason: 'no-text-pixels' }
  // Glyphs never fill the box they sit in; a box that changed almost everywhere is a background that moved.
  if (at.length > area * 0.85) return { ok: false, reason: 'unstable' }

  const fg = new Int32Array(at.length)
  const bg = new Int32Array(at.length)
  for (let k = 0; k < at.length; k++) {
    const i = at[k] ?? 0
    const x = i % width
    const y = (i - x) / width
    const a = (y * rendered.width + x) * 4
    const b = (y * bare.width + x) * 4
    fg[k] = pack(rendered.data[a] ?? 0, rendered.data[a + 1] ?? 0, rendered.data[a + 2] ?? 0)
    bg[k] = pack(bare.data[b] ?? 0, bare.data[b + 1] ?? 0, bare.data[b + 2] ?? 0)
  }
  const stroke = medianRun(glyph, width, height)

  const pixels = pixelContrasts(fg, bg, Boolean(input.internal))
  let css = input.foreground && input.foreground[3] > 0 ? cssContrasts(input.foreground, fg, bg) : undefined
  // Pixels never show more contrast than the color that paints them: when they do, the style sheet's color was read
  // mid-transition (a fade the screenshot then finished) or something else paints the text, and the pixels decide.
  if (css && (pixels.rendered ?? 0) > percentileOf(css.contrast, 0.995) * 1.05 + 0.05) css = undefined
  const chosen = css ?? pixels
  const order = Array.from(chosen.contrast.keys()).sort((p, q) => (chosen.contrast[p] ?? 0) - (chosen.contrast[q] ?? 0))
  const sorted = Float64Array.from(order, (k) => chosen.contrast[k] ?? 1)
  let highest = percentile(sorted, 0.995)
  const lowest = percentile(sorted, 0.01)
  const worstAt = order[Math.floor(0.01 * (order.length - 1))] ?? 0
  const bestAt = order[Math.floor(0.995 * (order.length - 1))] ?? 0
  if (chosen.internal !== undefined) highest = Math.max(highest, chosen.internal)
  // Read from the pixels, the color may be a blend: the contrast each pixel shows, as rendered, is the floor of what the text reaches.
  if (chosen.rendered !== undefined) highest = Math.max(highest, chosen.rendered)

  const common = new Map<number, number>()
  for (const color of bg) common.set(color, (common.get(color) ?? 0) + 1)
  let mode = bg[0] ?? 0
  let top = 0
  for (const [color, count] of common) {
    if (count > top) {
      top = count
      mode = color
    }
  }
  return {
    ok: true,
    measure: {
      pixels: at.length,
      foreground: chosen.foreground,
      foregroundFrom: css ? 'css' : 'pixels',
      background: { common: hexColor(mode), worst: hexColor(bg[worstAt] ?? 0), best: hexColor(bg[bestAt] ?? 0) },
      highest: round(highest),
      lowest: round(lowest),
      stroke,
      uniform: chosen.uniform,
    },
  }
}

const round = (value: number) => Math.round(value * 1000) / 1000

interface Contrasts {
  contrast: Float64Array
  foreground: string
  uniform: boolean
  internal?: number | undefined
  /** Pixel colors only: the highest contrast the glyph pixels show against what is behind them, as rendered. */
  rendered?: number | undefined
}

/**
 * The style sheet's color, composited over what lies behind each glyph pixel. It must show up in the
 * pixels: some glyph pixels must have that color, or something the style sheet does not say (a filter,
 * a blend mode, a mask) changed it, and the pixels are read instead.
 */
function cssContrasts(color: Rgba, fg: Int32Array, bg: Int32Array): Contrasts | undefined {
  const [r, g, b, alpha] = color
  const contrast = new Float64Array(fg.length)
  let seen = 0
  for (let k = 0; k < fg.length; k++) {
    const behind = bg[k] ?? 0
    const br = (behind >> 16) & 0xff
    const bgreen = (behind >> 8) & 0xff
    const bb = behind & 0xff
    const cr = Math.round(r * alpha + br * (1 - alpha))
    const cg = Math.round(g * alpha + bgreen * (1 - alpha))
    const cb = Math.round(b * alpha + bb * (1 - alpha))
    const shown = fg[k] ?? 0
    if (Math.max(Math.abs(((shown >> 16) & 0xff) - cr), Math.abs(((shown >> 8) & 0xff) - cg), Math.abs((shown & 0xff) - cb)) <= SAME) seen++
    contrast[k] = contrastRatio(luminance(cr, cg, cb), luminance(br, bgreen, bb))
  }
  if (seen < Math.max(2, fg.length * 0.01)) return undefined
  const hex = hexColor(pack(r, g, b))
  const foreground = alpha < 1 ? `${hex}${Math.round(alpha * 255).toString(16).padStart(2, '0')}` : hex
  return { contrast, foreground, uniform: true }
}

/**
 * The color read from the pixels: of the colors that enough glyph pixels share, the one that stands out
 * most from what is behind it. Anti-aliasing only blends a stroke toward its background, so that color is
 * the stroke's own when some pixels are fully covered (strokes of three pixels or more).
 */
function pixelContrasts(fg: Int32Array, bg: Int32Array, internal: boolean): Contrasts {
  const counts = new Map<number, { count: number; sum: number }>()
  const shownContrast = new Float64Array(fg.length)
  for (let k = 0; k < fg.length; k++) {
    const shown = fg[k] ?? 0
    const behind = bg[k] ?? 0
    const ratio = contrastRatio(luminance((shown >> 16) & 0xff, (shown >> 8) & 0xff, shown & 0xff), luminance((behind >> 16) & 0xff, (behind >> 8) & 0xff, behind & 0xff))
    shownContrast[k] = ratio
    const entry = counts.get(shown)
    if (entry) {
      entry.count++
      entry.sum += ratio
    } else counts.set(shown, { count: 1, sum: ratio })
  }
  const enough = Math.max(2, fg.length * 0.02)
  let chosen = fg[0] ?? 0
  let best = -1
  const frequent: number[] = []
  for (const [color, entry] of counts) {
    if (entry.count < enough) continue
    frequent.push(color)
    const mean = entry.sum / entry.count
    if (mean > best) {
      best = mean
      chosen = color
    }
  }
  if (best < 0) {
    // No color repeats: every pixel is a blend (a gradient fill, a photo). The per-pixel contrast is all there is.
    let most = 0
    for (const [color, entry] of counts) {
      if (entry.count > most) {
        most = entry.count
        chosen = color
      }
    }
  }
  const cr = (chosen >> 16) & 0xff
  const cg = (chosen >> 8) & 0xff
  const cb = chosen & 0xff
  const chosenLuminance = luminance(cr, cg, cb)
  const contrast = new Float64Array(fg.length)
  let near = 0
  for (let k = 0; k < fg.length; k++) {
    const behind = bg[k] ?? 0
    contrast[k] = contrastRatio(chosenLuminance, luminance((behind >> 16) & 0xff, (behind >> 8) & 0xff, behind & 0xff))
    const shown = fg[k] ?? 0
    if (Math.max(Math.abs(((shown >> 16) & 0xff) - cr), Math.abs(((shown >> 8) & 0xff) - cg), Math.abs((shown & 0xff) - cb)) <= SAME) near++
  }
  // The parts of an icon against each other: a glyph drawn in white on a disc of another color.
  let between: number | undefined
  if (internal) {
    const major = frequent.filter((color) => (counts.get(color)?.count ?? 0) >= fg.length * 0.05)
    for (const p of major) {
      for (const q of major) {
        const ratio = contrastRatio(luminance((p >> 16) & 0xff, (p >> 8) & 0xff, p & 0xff), luminance((q >> 16) & 0xff, (q >> 8) & 0xff, q & 0xff))
        if (between === undefined || ratio > between) between = ratio
      }
    }
  }
  shownContrast.sort()
  return { contrast, foreground: hexColor(chosen), uniform: best >= 0 && near >= fg.length * 0.12, internal: between, rendered: percentile(shownContrast, 0.995) }
}

/** The typical width of a stroke: the median run of glyph pixels along each row. */
function medianRun(mask: Uint8Array, width: number, height: number): number {
  const runs: number[] = []
  for (let y = 0; y < height; y++) {
    let run = 0
    for (let x = 0; x <= width; x++) {
      if (x < width && mask[y * width + x]) run++
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
