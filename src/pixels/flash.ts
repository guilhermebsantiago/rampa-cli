/**
 * Flashes for WCAG 2.3.1 (Three Flashes or Below Threshold), counted on downsampled grids of frames.
 *
 * WCAG's definitions, as this module applies them:
 *
 * - **General flash**: a pair of opposing changes in relative luminance of 10% or more of the maximum (0.1), where the
 *   darker state is below 0.80. A transition is the change between a peak and a valley of luminance over time (the
 *   Understanding for 2.3.1), so a slow fade counts once, however many frames it takes.
 * - **Red flash**: a pair of opposing transitions involving a saturated red: one of the two states has
 *   R/(R + G + B) of 0.8 or more, and the two differ by more than 0.2 in CIE 1976 u′v′ chromaticity (WCAG 2.2's
 *   definition of the red flash threshold).
 * - **More than three flashes in one second**: seven transitions or more within one second (three flashes are six).
 * - **Area**: 25% of a 10° visual field, which WCAG estimates as a 341 × 256 rectangle on a 1024 × 768 screen: the
 *   Understanding counts the contiguous area flashing at the same time within such a field. Here the cells that make
 *   seven transitions or more in the same one-second window form connected regions, and each region's largest share
 *   of one 341 × 256 field is its area.
 *
 * A grid's cell averages the pixels under it, so a fine balanced pattern (a small checkerboard that inverts) averages
 * out, as the Understanding says it should: such patterns do not violate the thresholds. Thresholds that decide a
 * failure (the area) are applied by the rule (rules/flash.ts); this module measures.
 */

export const FLASH = {
  luminanceDelta: 0.1,
  darkerBelow: 0.8,
  redRatio: 0.8,
  chromaDelta: 0.2,
  windowMs: 1000,
  /** Transitions within one window that make more than three flashes. */
  transitions: 7,
  field: { width: 341, height: 256 },
  fieldShare: 0.25,
} as const

/** 25% of the 341 × 256 field: 21,824 CSS px². */
export const FLASH_AREA_LIMIT = FLASH.fieldShare * FLASH.field.width * FLASH.field.height

export interface FlashGrid {
  cols: number
  rows: number
  /** CSS px each cell covers, across and down. */
  cellWidth: number
  cellHeight: number
  /** Cells left out (1): a video or an animated image that another analysis reads. */
  mask?: Uint8Array | undefined
}

export interface FlashFrame {
  /** Milliseconds from the first frame. */
  t: number
  /** sRGB, three bytes per cell, row by row. */
  rgb: Uint8Array
}

export interface FlashMeasure {
  /** The most opposing transitions one cell made within any one-second window. */
  maxTransitions: number
  /**
   * The largest contiguous area, in CSS px², inside one 341 × 256 field, whose cells each made seven transitions or
   * more in the same one-second window. 0 when no cell did.
   */
  area: number
  /** That window: start and end (ms), its first and last frame, and the most transitions a cell of the area made. */
  window?: { start: number; end: number; first: number; last: number; transitions: number } | undefined
  /** Where that area is, in CSS px from the grid's top left corner. */
  box?: { x: number; y: number; width: number; height: number } | undefined
}

export interface FlashAnalysis {
  frames: number
  durationMs: number
  /** The median time between frames. */
  stepMs: number
  general: FlashMeasure
  red: FlashMeasure
}

const LINEAR = (() => {
  const table = new Float64Array(256)
  for (let i = 0; i < 256; i++) {
    const c = i / 255
    table[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return table
})()

/** CIE 1976 u′v′ of the D65 white point: the chromaticity given to black, which has none. */
const D65 = { u: 0.1978, v: 0.4683 }

/** u′v′ of an sRGB color. */
export function chromaticity(r: number, g: number, b: number): { u: number; v: number } {
  const R = LINEAR[r] ?? 0
  const G = LINEAR[g] ?? 0
  const B = LINEAR[b] ?? 0
  const X = 0.4124 * R + 0.3576 * G + 0.1805 * B
  const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B
  const Z = 0.0193 * R + 0.1192 * G + 0.9505 * B
  const d = X + 15 * Y + 3 * Z
  if (d < 1e-6) return D65
  return { u: (4 * X) / d, v: (9 * Y) / d }
}

/** Relative luminance of an sRGB color. */
export function luminance(r: number, g: number, b: number): number {
  return 0.2126 * (LINEAR[r] ?? 0) + 0.7152 * (LINEAR[g] ?? 0) + 0.0722 * (LINEAR[b] ?? 0)
}

/** R / (R + G + B) of an sRGB color, 0 for black. */
export function redRatio(r: number, g: number, b: number): number {
  const sum = r + g + b
  return sum === 0 ? 0 : r / sum
}

/** Frame indices of the general transitions of one cell's luminance series. */
function generalTransitions(series: Float64Array): number[] {
  const out: number[] = []
  const delta = FLASH.luminanceDelta
  const dark = FLASH.darkerBelow
  let dir = 0
  let ext = series[0] ?? 0
  let lo = ext
  let hi = ext
  for (let k = 1; k < series.length; k++) {
    const v = series[k] ?? 0
    if (dir === 0) {
      if (v < lo) lo = v
      if (v > hi) hi = v
      if (v - lo >= delta && lo < dark) {
        out.push(k)
        dir = 1
        ext = v
      } else if (hi - v >= delta && v < dark) {
        out.push(k)
        dir = -1
        ext = v
      }
    } else if (dir === 1) {
      if (v > ext) ext = v
      // Down from the peak: the darker state is where it lands.
      else if (ext - v >= delta && v < dark) {
        out.push(k)
        dir = -1
        ext = v
      }
    } else if (v < ext) ext = v
    // Up from the valley: the darker state is the valley.
    else if (v - ext >= delta && ext < dark) {
      out.push(k)
      dir = 1
      ext = v
    }
  }
  return out
}

/** Frame indices of the red transitions of one cell: into and out of a saturated red, far enough in chromaticity. */
function redTransitions(ratio: Float64Array, u: Float64Array, v: Float64Array): number[] {
  const out: number[] = []
  let state = 0
  let refU = 0
  let refV = 0
  let refRatio = 0
  for (let k = 0; k < ratio.length; k++) {
    const r = ratio[k] ?? 0
    const isRed = r >= FLASH.redRatio
    const cu = u[k] ?? 0
    const cv = v[k] ?? 0
    if (state === 0) {
      state = isRed ? 1 : 2
      refU = cu
      refV = cv
      refRatio = r
      continue
    }
    const far = Math.hypot(cu - refU, cv - refV) > FLASH.chromaDelta
    if (state === 1) {
      if (isRed) {
        // The reddest moment of this red state is the reference to leave it from.
        if (r > refRatio) {
          refRatio = r
          refU = cu
          refV = cv
        }
      } else if (far) {
        out.push(k)
        state = 2
        refU = cu
        refV = cv
        refRatio = r
      }
    } else if (!isRed) {
      if (r < refRatio) {
        refRatio = r
        refU = cu
        refV = cv
      }
    } else if (far) {
      out.push(k)
      state = 1
      refU = cu
      refV = cv
      refRatio = r
    }
  }
  return out
}

/** The first frame index at or after `time`, from `from` on. */
function frameAt(times: Float64Array, time: number, from: number): number {
  let k = from
  while (k < times.length && (times[k] ?? 0) < time) k++
  return k
}

function measure(grid: FlashGrid, times: Float64Array, transitions: Array<number[] | undefined>, jitterMs: number): FlashMeasure {
  const cells = grid.cols * grid.rows
  const n = times.length
  // A transition sampled every `jitterMs` is known to that much: the window is shortened by it, so content at exactly
  // three flashes a second is never counted as more for when its frames happened to be taken.
  const span = FLASH.windowMs - jitterMs
  // The most transitions each cell made in any window, with two pointers over its transition frames.
  let maxTransitions = 0
  const candidates: number[] = []
  for (let c = 0; c < cells; c++) {
    const list = transitions[c]
    if (!list || list.length === 0) continue
    let best = 0
    let start = 0
    for (let end = 0; end < list.length; end++) {
      const tEnd = times[list[end] as number] ?? 0
      while ((times[list[start] as number] ?? 0) <= tEnd - span) start++
      best = Math.max(best, end - start + 1)
    }
    if (best > maxTransitions) maxTransitions = best
    if (best >= FLASH.transitions) candidates.push(c)
  }
  const result: FlashMeasure = { maxTransitions, area: 0 }
  if (candidates.length === 0) return result
  // Prefix counts of transitions per candidate cell, by frame.
  const prefix = candidates.map((c) => {
    const counts = new Uint16Array(n + 1)
    const list = transitions[c] ?? []
    let i = 0
    for (let k = 0; k < n; k++) {
      counts[k + 1] = (counts[k] ?? 0) + (list[i] === k ? 1 : 0)
      if (list[i] === k) i++
    }
    return counts
  })
  const cellArea = grid.cellWidth * grid.cellHeight
  const fieldCols = Math.max(1, Math.round(FLASH.field.width / grid.cellWidth))
  const fieldRows = Math.max(1, Math.round(FLASH.field.height / grid.cellHeight))
  const flagged = new Uint8Array(cells)
  const counts = new Uint16Array(cells)
  const seen = new Uint8Array(cells)
  let end = 0
  for (let s = 0; s < n; s++) {
    end = Math.max(end, s)
    end = frameAt(times, (times[s] ?? 0) + span, end)
    flagged.fill(0)
    let any = false
    for (let i = 0; i < candidates.length; i++) {
      const p = prefix[i] as Uint16Array
      const count = (p[end] ?? 0) - (p[s] ?? 0)
      if (count >= FLASH.transitions) {
        const c = candidates[i] as number
        flagged[c] = 1
        counts[c] = count
        any = true
      }
    }
    if (!any) continue
    seen.fill(0)
    for (const start of candidates) {
      if (!flagged[start] || seen[start]) continue
      // One contiguous region (4-neighbours), with its bounding box and the most transitions in it.
      const region: number[] = []
      const queue = [start]
      seen[start] = 1
      let minX = grid.cols
      let minY = grid.rows
      let maxX = -1
      let maxY = -1
      let most = 0
      while (queue.length > 0) {
        const c = queue.pop() as number
        region.push(c)
        const x = c % grid.cols
        const y = Math.floor(c / grid.cols)
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
        most = Math.max(most, counts[c] ?? 0)
        for (const [nx, ny] of [
          [x - 1, y],
          [x + 1, y],
          [x, y - 1],
          [x, y + 1],
        ] as const) {
          if (nx < 0 || ny < 0 || nx >= grid.cols || ny >= grid.rows) continue
          const other = ny * grid.cols + nx
          if (flagged[other] && !seen[other]) {
            seen[other] = 1
            queue.push(other)
          }
        }
      }
      if (region.length * cellArea <= result.area) continue
      // The region's largest share of one field: a sliding window over its bounding box.
      const w = maxX - minX + 1
      const h = maxY - minY + 1
      let bestCount = region.length
      let at = { x: minX, y: minY, width: w, height: h }
      if (w > fieldCols || h > fieldRows) {
        const sum = new Int32Array((w + 1) * (h + 1))
        const mark = new Uint8Array(w * h)
        for (const c of region) mark[(Math.floor(c / grid.cols) - minY) * w + ((c % grid.cols) - minX)] = 1
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            sum[(y + 1) * (w + 1) + x + 1] = (mark[y * w + x] ?? 0) + (sum[y * (w + 1) + x + 1] ?? 0) + (sum[(y + 1) * (w + 1) + x] ?? 0) - (sum[y * (w + 1) + x] ?? 0)
          }
        }
        const fw = Math.min(fieldCols, w)
        const fh = Math.min(fieldRows, h)
        bestCount = 0
        for (let y = 0; y + fh <= h; y++) {
          for (let x = 0; x + fw <= w; x++) {
            const inside = (sum[(y + fh) * (w + 1) + x + fw] ?? 0) - (sum[y * (w + 1) + x + fw] ?? 0) - (sum[(y + fh) * (w + 1) + x] ?? 0) + (sum[y * (w + 1) + x] ?? 0)
            if (inside > bestCount) {
              bestCount = inside
              at = { x: minX + x, y: minY + y, width: fw, height: fh }
            }
          }
        }
      }
      const area = bestCount * cellArea
      if (area > result.area) {
        result.area = area
        result.window = { start: Math.round(times[s] ?? 0), end: Math.round((times[s] ?? 0) + span), first: s, last: Math.max(s, end - 1), transitions: most }
        result.box = { x: at.x * grid.cellWidth, y: at.y * grid.cellHeight, width: at.width * grid.cellWidth, height: at.height * grid.cellHeight }
      }
    }
  }
  return result
}

/**
 * Counts general and red flashes over a sequence of grids, and the area flashing too often at once. `exact`: the
 * frames are the moments the content changes (the frames of an animated image), not samples taken every few
 * milliseconds, so transitions are timed exactly; otherwise a window is shortened by the median step between frames.
 */
export function analyzeFlashes(grid: FlashGrid, frames: readonly FlashFrame[], options: { exact?: boolean | undefined } = {}): FlashAnalysis {
  const n = frames.length
  const cells = grid.cols * grid.rows
  const times = Float64Array.from(frames.map((f) => f.t))
  const steps = frames.slice(1).map((f, i) => f.t - (frames[i]?.t ?? 0)).sort((a, b) => a - b)
  const base = { frames: n, durationMs: n > 0 ? Math.round((frames[n - 1]?.t ?? 0) - (frames[0]?.t ?? 0)) : 0, stepMs: Math.round((steps[Math.floor(steps.length / 2)] ?? 0) * 10) / 10 }
  if (n < 3 || cells === 0) return { ...base, general: { maxTransitions: 0, area: 0 }, red: { maxTransitions: 0, area: 0 } }
  const general: Array<number[] | undefined> = new Array(cells)
  const red: Array<number[] | undefined> = new Array(cells)
  const lum = new Float64Array(n)
  const ratio = new Float64Array(n)
  const u = new Float64Array(n)
  const v = new Float64Array(n)
  for (let c = 0; c < cells; c++) {
    if (grid.mask?.[c]) continue
    // A cell whose color hardly moves has no transition: most of a page.
    const first = frames[0]?.rgb
    let lowR = first?.[c * 3] ?? 0
    let highR = lowR
    let lowG = first?.[c * 3 + 1] ?? 0
    let highG = lowG
    let lowB = first?.[c * 3 + 2] ?? 0
    let highB = lowB
    for (let k = 1; k < n; k++) {
      const rgb = frames[k]?.rgb
      const r = rgb?.[c * 3] ?? 0
      const g = rgb?.[c * 3 + 1] ?? 0
      const b = rgb?.[c * 3 + 2] ?? 0
      if (r < lowR) lowR = r
      if (r > highR) highR = r
      if (g < lowG) lowG = g
      if (g > highG) highG = g
      if (b < lowB) lowB = b
      if (b > highB) highB = b
    }
    if (highR - lowR < 8 && highG - lowG < 8 && highB - lowB < 8) continue
    for (let k = 0; k < n; k++) {
      const rgb = frames[k]?.rgb
      const r = rgb?.[c * 3] ?? 0
      const g = rgb?.[c * 3 + 1] ?? 0
      const b = rgb?.[c * 3 + 2] ?? 0
      lum[k] = luminance(r, g, b)
      ratio[k] = redRatio(r, g, b)
      const uv = chromaticity(r, g, b)
      u[k] = uv.u
      v[k] = uv.v
    }
    const g = generalTransitions(lum)
    if (g.length > 0) general[c] = g
    const rt = redTransitions(ratio, u, v)
    if (rt.length > 0) red[c] = rt
  }
  const jitter = options.exact ? 0 : Math.min(base.stepMs, 100)
  return { ...base, general: measure(grid, times, general, jitter), red: measure(grid, times, red, jitter) }
}
