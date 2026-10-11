/**
 * Motion in a time series of window captures, for WCAG 2.2.2 (Pause, Stop, Hide): which parts of the window change,
 * when, and for how long. Frames are grids of cells (each the average of the pixels under it, as the capture's scale
 * gives them), taken at known instants of the page's own time. A cell changes between two frames when one of its
 * channels moves by `delta` or more; changed cells near each other (within `reach` cells) form one region, so the
 * glyphs of a ticker or the parts of a carousel are one thing that moves. For each region the module gives the first
 * and last moment it changed and its episodes (runs of change with no gap over `gapMs`), so the rule can tell motion
 * that lasts from a one-off change (an image that loads late). It measures; thresholds that decide a failure (more
 * than five seconds) are applied by the rule (rules/motion.ts).
 */

export interface MotionFrame {
  /** Milliseconds of the page's time since the first frame. */
  t: number
  /** sRGB, three bytes per cell, row by row. */
  rgb: Uint8Array
}

export interface MotionGrid {
  cols: number
  rows: number
  /** CSS px each cell covers, across and down. */
  cell: number
  /** Cells left out (1): media read on their own (a video, an animated image). */
  mask?: Uint8Array | undefined
}

export interface MotionRegion {
  /** Where it is, in CSS px from the grid's top left corner. */
  box: { x: number; y: number; width: number; height: number }
  /** Cells that changed at least once. */
  cells: number
  /** CSS px² those cells cover. */
  area: number
  /** The first and the last moment a change was seen (the frame that showed it), in ms. */
  firstMs: number
  lastMs: number
  /** Runs of change with no gap over `gapMs`, and the longest one, in ms. */
  episodes: number
  longestMs: number
  /** When each run of change began, in ms (the first 40). */
  starts: number[]
  /** Frames that showed a change in the region. */
  changes: number
}

export const MOTION = {
  /** A channel that moves by this much (of 255) in a cell's average is a change. */
  delta: 12,
  /** Changes this far apart are one episode. */
  gapMs: 1000,
  /** Changed cells this many cells apart (8 px at 4 px a cell) are one region. */
  reach: 2,
  /** Regions smaller than this are left out: a pixel of antialiasing, a caret. */
  minCells: 3,
  /** WCAG 2.2.2: moving, blinking or scrolling content that lasts more than five seconds. */
  lastsMs: 5000,
} as const

/**
 * Regions of the grid that changed, with when and how long. `frames` must be in time order and the same size as the
 * grid. A region is reported once, with every frame that changed any of its cells.
 */
export function motionRegions(grid: MotionGrid, frames: readonly MotionFrame[], options: { delta?: number; gapMs?: number; reach?: number; minCells?: number } = {}): MotionRegion[] {
  const delta = options.delta ?? MOTION.delta
  const gapMs = options.gapMs ?? MOTION.gapMs
  const reach = options.reach ?? MOTION.reach
  const minCells = options.minCells ?? MOTION.minCells
  const cells = grid.cols * grid.rows
  const n = frames.length
  if (n < 2 || cells === 0) return []
  // For each cell, the frames that showed it changed.
  const changed: Array<number[] | undefined> = new Array(cells)
  const active = new Uint8Array(cells)
  for (let c = 0; c < cells; c++) {
    if (grid.mask?.[c]) continue
    const i = c * 3
    let list: number[] | undefined
    for (let k = 1; k < n; k++) {
      const a = frames[k - 1]?.rgb
      const b = frames[k]?.rgb
      if (!a || !b) continue
      const d = Math.max(Math.abs((a[i] ?? 0) - (b[i] ?? 0)), Math.abs((a[i + 1] ?? 0) - (b[i + 1] ?? 0)), Math.abs((a[i + 2] ?? 0) - (b[i + 2] ?? 0)))
      if (d >= delta) (list ??= []).push(k)
    }
    if (list) {
      changed[c] = list
      active[c] = 1
    }
  }
  const seen = new Uint8Array(cells)
  const regions: MotionRegion[] = []
  for (let start = 0; start < cells; start++) {
    if (!active[start] || seen[start]) continue
    const queue = [start]
    seen[start] = 1
    const members: number[] = []
    let minX = grid.cols
    let minY = grid.rows
    let maxX = -1
    let maxY = -1
    while (queue.length > 0) {
      const c = queue.pop() as number
      members.push(c)
      const x = c % grid.cols
      const y = Math.floor(c / grid.cols)
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
      for (let dy = -reach; dy <= reach; dy++) {
        const ny = y + dy
        if (ny < 0 || ny >= grid.rows) continue
        for (let dx = -reach; dx <= reach; dx++) {
          const nx = x + dx
          if ((dx === 0 && dy === 0) || nx < 0 || nx >= grid.cols) continue
          const other = ny * grid.cols + nx
          if (active[other] && !seen[other]) {
            seen[other] = 1
            queue.push(other)
          }
        }
      }
    }
    if (members.length < minCells) continue
    const moments = new Set<number>()
    for (const c of members) for (const k of changed[c] ?? []) moments.add(k)
    const times = [...moments].sort((a, b) => a - b).map((k) => frames[k]?.t ?? 0)
    let episodes = 0
    let longest = 0
    let from = times[0] ?? 0
    let previous = Number.NEGATIVE_INFINITY
    const starts: number[] = []
    for (const t of times) {
      if (t - previous > gapMs) {
        episodes++
        from = t
        if (starts.length < 40) starts.push(Math.round(t))
      }
      longest = Math.max(longest, t - from)
      previous = t
    }
    regions.push({
      box: { x: minX * grid.cell, y: minY * grid.cell, width: (maxX - minX + 1) * grid.cell, height: (maxY - minY + 1) * grid.cell },
      cells: members.length,
      area: members.length * grid.cell * grid.cell,
      firstMs: Math.round(times[0] ?? 0),
      lastMs: Math.round(times[times.length - 1] ?? 0),
      episodes,
      longestMs: Math.round(longest),
      starts,
      changes: times.length,
    })
  }
  return regions.sort((a, b) => b.area - a.area)
}

/**
 * Motion that lasts more than five seconds: changes seen at least five seconds apart, the last one past the five
 * seconds. A part that changes once (an image that loads late) or settles within five seconds (an entrance animation)
 * does not last. `stepMs` is the time between frames: a change is known to a frame, so the five seconds are counted
 * from the frame before the first change.
 */
export function lastsLonger(region: Pick<MotionRegion, 'firstMs' | 'lastMs' | 'changes'>, stepMs: number, lastsMs: number = MOTION.lastsMs): boolean {
  return region.changes >= 2 && region.lastMs - region.firstMs + stepMs > lastsMs && region.lastMs > lastsMs
}

/** Whether two boxes overlap, and by how much of the first one's area (0 to 1). */
export function overlapShare(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): number {
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
  const area = a.width * a.height
  return area > 0 ? (width * height) / area : 0
}
