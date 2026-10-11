import { contrastRatio, hexColor, relativeLuminance } from './contrast.ts'
import type { PixelRect, RgbaImage } from './png.ts'

/**
 * The visual indicator of a state, read from two captures of the same region: the state on (focused, selected) and
 * off (blurred, the state's marks taken away). The pixels whose color changed are the indicator. WCAG 1.4.11 asks
 * that visual information needed to identify a state have 3:1 against its adjacent colors; the Understanding
 * measures a focus indicator against the colors next to it in the focused state (its Figures 8 to 14), and leaves a
 * change of background inside the component out of scope (Figure 15). So this module reports, for the changed
 * pixels, their main colors in the "on" capture and the colors next to each of them, with the contrast between.
 *
 * Anti-aliasing blends an indicator's edges with what is next to it. Those blends are spread over many colors, each
 * with few pixels, so they are neither a main color of the indicator nor a significant adjacent color.
 */

/** A pixel changed when one of its channels moved by this much: the faintest change a person might still see. */
export const CHANGE_DELTA = 8
/** Pixels this close (largest channel difference) to a cluster's color belong to it. */
const SAME = 24
/** A cluster is a main color of the indicator from this share of the judged pixels. */
const MAIN_SHARE = 0.15
/** An adjacent color counts from this share of the pixels next to the cluster. */
const ADJACENT_SHARE = 0.15
/** How far from the indicator its neighbours are read, in pixels. */
const REACH = 2
/** A change over this share of the component's own box is a change of its background (out of scope for focus). */
export const FILL_SHARE = 0.5
/** At most this many cluster pixels are walked for neighbours; larger clusters are sampled evenly. */
const MAX_WALK = 40_000

export interface AdjacentColor {
  /** #rrggbb in the "on" capture. */
  color: string
  /** Share of the pixels next to the indicator color that have this color. */
  share: number
}

export interface IndicatorColor {
  /** #rrggbb: the most common exact color of the cluster, in the "on" capture. */
  color: string
  pixels: number
  /** The significant colors next to it (unchanged pixels or another part of the indicator), most common first. */
  adjacent: AdjacentColor[]
  /** Its best contrast with one of those; 1 when none is significant. */
  contrast: number
}

export interface StateChange {
  /** Pixels compared. */
  area: number
  /** Pixels whose color changed (a channel by CHANGE_DELTA or more), outside the noise mask. */
  changed: number
  /** Pixels that changed on their own between two captures of the "off" state, left out. */
  masked: number
  /** Changed pixels inside the component's box, and outside it. */
  inside: number
  outside: number
  /** Changed pixels inside the excluded regions (the component's text, for state indicators). */
  excluded: number
  /** The share of the box (excluded regions aside) whose color changed. */
  fill: number
  /**
   * Which changed pixels were judged: all of them, those outside the box (the box's background changed, and a ring
   * outside it remains), those outside the excluded regions, or none (a change of the background inside the box).
   */
  part: 'all' | 'outside' | 'non-excluded' | 'fill' | 'none'
  /** Pixels judged. */
  judged: number
  /** The main colors of the judged pixels, most pixels first, at most three. */
  colors: IndicatorColor[]
  /** The best contrast any main color reaches with a color next to it; 1 when nothing could be judged. */
  contrast: number
}

export interface StateChangeOptions {
  /** The component's box, in image pixels. */
  box: PixelRect
  /** Regions left out of the judgment (the component's own text), in image pixels. */
  exclude?: readonly PixelRect[] | undefined
  /**
   * 'focus': a change over most of the box is a change of background, out of scope (Understanding 1.4.11, Figure
   * 15); a ring outside it is still judged. 'state': the background of a selected item is its indicator, judged.
   */
  mode: 'focus' | 'state'
}

const at = (image: RgbaImage, x: number, y: number) => (y * image.width + x) * 4
const rgbOf = (image: RgbaImage, i: number) => ((image.data[i] ?? 0) << 16) | ((image.data[i + 1] ?? 0) << 8) | (image.data[i + 2] ?? 0)
const channelDistance = (a: number, b: number) => Math.max(Math.abs(((a >> 16) & 0xff) - ((b >> 16) & 0xff)), Math.abs(((a >> 8) & 0xff) - ((b >> 8) & 0xff)), Math.abs((a & 0xff) - (b & 0xff)))
export const luminanceOfRgb = (rgb: number) => relativeLuminance((rgb >> 16) & 0xff, (rgb >> 8) & 0xff, rgb & 0xff)

const inside = (rect: PixelRect, x: number, y: number) => x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height

/** Groups colors by count: each joins the first, more common, color within SAME of it. */
function clusters(counts: Map<number, number>): Array<{ rgb: number; pixels: number }> {
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1])
  const out: Array<{ rgb: number; pixels: number }> = []
  for (const [rgb, count] of sorted) {
    const home = out.find((cluster) => channelDistance(cluster.rgb, rgb) <= SAME)
    if (home) home.pixels += count
    else out.push({ rgb, pixels: count })
  }
  return out.sort((a, b) => b.pixels - a.pixels)
}

/**
 * Compares the "on" capture with the "off" capture of the same region. `noise` is a second capture of the "off"
 * state: pixels that differ between the two move on their own and are left out.
 */
export function stateChange(on: RgbaImage, off: RgbaImage, noise: RgbaImage | undefined, options: StateChangeOptions): StateChange {
  const width = Math.min(on.width, off.width)
  const height = Math.min(on.height, off.height)
  const box = options.box
  const exclude = options.exclude ?? []
  // 1: changed (and not in an excluded region); 2: moved on its own.
  const changedMask = new Uint8Array(width * height)
  const result: StateChange = { area: width * height, changed: 0, masked: 0, inside: 0, outside: 0, excluded: 0, fill: 0, part: 'none', judged: 0, colors: [], contrast: 1 }
  let boxArea = 0
  let boxChanged = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const inBox = inside(box, x, y)
      const excluded = exclude.some((rect) => inside(rect, x, y))
      if (inBox && !excluded) boxArea++
      const i = at(on, x, y)
      const j = at(off, x, y)
      const before = rgbOf(off, j)
      if (noise && x < noise.width && y < noise.height && channelDistance(rgbOf(noise, at(noise, x, y)), before) > 2) {
        result.masked++
        changedMask[y * width + x] = 2
        continue
      }
      if (channelDistance(rgbOf(on, i), before) < CHANGE_DELTA) continue
      result.changed++
      if (excluded) {
        result.excluded++
        continue
      }
      changedMask[y * width + x] = 1
      if (inBox) {
        result.inside++
        boxChanged++
      } else result.outside++
    }
  }
  result.fill = boxArea > 0 ? Math.round((boxChanged / boxArea) * 1000) / 1000 : 0
  if (result.changed === 0) return result
  // Which changed pixels make the indicator.
  let judge: (x: number, y: number) => boolean
  if (options.mode === 'focus' && result.fill >= FILL_SHARE) {
    // The component's new background, and an outline or shadow of the same color, are one block of background.
    const fills = new Map<number, number>()
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (changedMask[y * width + x] !== 1 || !inside(box, x, y)) continue
        const rgb = rgbOf(on, at(on, x, y))
        fills.set(rgb, (fills.get(rgb) ?? 0) + 1)
      }
    }
    const fillColor = clusters(fills)[0]?.rgb ?? -1
    const ring = (x: number, y: number) => changedMask[y * width + x] === 1 && !inside(box, x, y) && channelDistance(rgbOf(on, at(on, x, y)), fillColor) > SAME
    let outsideRing = 0
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (ring(x, y)) outsideRing++
    const perimeter = 2 * (box.width + box.height)
    if (outsideRing < perimeter / 2) {
      result.part = 'fill'
      return result
    }
    result.part = 'outside'
    judge = ring
  } else {
    result.part = exclude.length > 0 ? 'non-excluded' : 'all'
    judge = (x, y) => changedMask[y * width + x] === 1
  }
  const counts = new Map<number, number>()
  const judged: number[] = []
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!judge(x, y)) continue
      judged.push(y * width + x)
      const rgb = rgbOf(on, at(on, x, y))
      counts.set(rgb, (counts.get(rgb) ?? 0) + 1)
    }
  }
  result.judged = judged.length
  if (judged.length === 0) {
    result.part = 'none'
    return result
  }
  const main = clusters(counts)
    .filter((cluster) => cluster.pixels >= judged.length * MAIN_SHARE)
    .slice(0, 3)
  for (const cluster of main) {
    const members: number[] = []
    for (const index of judged) {
      if (channelDistance(rgbOf(on, at(on, index % width, Math.floor(index / width))), cluster.rgb) <= SAME) members.push(index)
    }
    const step = Math.max(1, Math.ceil(members.length / MAX_WALK))
    const neighbours = new Map<number, number>()
    let total = 0
    for (let m = 0; m < members.length; m += step) {
      const index = members[m] as number
      const x0 = index % width
      const y0 = Math.floor(index / width)
      for (let dy = -REACH; dy <= REACH; dy++) {
        for (let dx = -REACH; dx <= REACH; dx++) {
          if (dx === 0 && dy === 0) continue
          const x = x0 + dx
          const y = y0 + dy
          if (x < 0 || y < 0 || x >= width || y >= height) continue
          // What sits on the indicator (the component's text) is not what it must stand out from.
          if (exclude.some((rect) => inside(rect, x, y))) continue
          const rgb = rgbOf(on, at(on, x, y))
          const kind = changedMask[y * width + x]
          // The indicator's own pixels and its anti-aliased edge are not its neighbours; an unchanged pixel always is,
          // however close its color: a pale indicator on white has white next to it.
          if (kind === 2 || (kind === 1 && channelDistance(rgb, cluster.rgb) <= SAME)) continue
          neighbours.set(rgb, (neighbours.get(rgb) ?? 0) + 1)
          total++
        }
      }
    }
    const adjacent = clusters(neighbours)
      .filter((group) => total > 0 && group.pixels >= total * ADJACENT_SHARE)
      .map((group) => ({ color: hexColor(group.rgb), share: Math.round((group.pixels / total) * 100) / 100, rgb: group.rgb }))
    const own = luminanceOfRgb(cluster.rgb)
    const contrast = adjacent.reduce((best, group) => Math.max(best, contrastRatio(own, luminanceOfRgb(group.rgb))), 1)
    result.colors.push({ color: hexColor(cluster.rgb), pixels: cluster.pixels, adjacent: adjacent.map(({ color, share }) => ({ color, share })), contrast: Math.round(contrast * 100) / 100 })
  }
  result.contrast = result.colors.reduce((best, color) => Math.max(best, color.contrast), 1)
  return result
}

/** "#rrggbb" or "#rrggbbaa" as numbers, alpha from 0 to 1; undefined for anything else. */
export function parseHex(value: string): { rgb: number; alpha: number } | undefined {
  const match = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(value.trim())
  if (!match) return undefined
  return { rgb: Number.parseInt(match[1] as string, 16), alpha: match[2] ? Number.parseInt(match[2], 16) / 255 : 1 }
}

/** A color with alpha composited over an opaque one, both packed as 0xrrggbb. */
export function composite(top: number, alpha: number, under: number): number {
  const mix = (shift: number) => Math.round(((top >> shift) & 0xff) * alpha + ((under >> shift) & 0xff) * (1 - alpha))
  return (mix(16) << 16) | (mix(8) << 8) | mix(0)
}

/** The contrast between a style sheet color (#rrggbb or #rrggbbaa) and an opaque #rrggbb next to it. */
export function cssContrast(css: string, against: string): number | undefined {
  const color = parseHex(css)
  const other = parseHex(against)
  if (!color || !other || color.alpha === 0) return undefined
  const own = composite(color.rgb, color.alpha, other.rgb)
  return contrastRatio(luminanceOfRgb(own), luminanceOfRgb(other.rgb))
}
