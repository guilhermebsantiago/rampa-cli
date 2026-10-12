import type { Browser, CDPSession, Page } from 'playwright-core'
import { MOTION, type MotionFrame, type MotionRegion, lastsLonger, motionRegions, overlapShare } from '../pixels/motion.ts'
import { mapLimit } from '../core/util.ts'
import { tryDecodePng } from '../pixels/png.ts'
import type { ProbeRecord } from '../snapshot/schema.ts'
import { type ControlFacts, Harness, type HarnessAction, type SkipReason, skipReason } from './activate.ts'
import { animatedFormat, decodeFramesInPage, decoderPage, imageBytes } from './flash.ts'
import type { InPageElement, InPageRect } from './kit.ts'
import { type AnimationFact, type ItemState, type MotionInventory, type MotionKit, type RawControl, type TextTarget, installMotionKit } from './motion-kit.ts'
import { type ProbeOptions, type ProbePage, skippedRecord } from './page.ts'
import { TIME_LIMITS_VERSION, timeLimitsProbe } from './time-limits.ts'

/**
 * Pause, Stop, Hide (2.2.2), item C10 of docs/plans/wcag-coverage.md. Content that moves, blinks or scrolls, starts
 * on its own, lasts more than five seconds and is shown next to other content needs a way to pause, stop or hide it;
 * so does content that updates on its own. The probe records facts; rules/motion.ts decides.
 *
 * 1. **An inventory** of what may move: running CSS and script animations (`document.getAnimations()`), SVG animations
 *    (SMIL), videos that play on their own, animated images (GIF, APNG, animated WebP, decoded as the flash probe
 *    does), canvases and `marquee` elements.
 * 2. **A time series of the window**: Playwright's fake clock is paused and moved by the probe; CSS and SVG animations
 *    are paused and set to each instant (as for 2.3.1), so the window is captured at a quarter scale every 230 ms of
 *    the page's own time for 10 s, then every 5 s up to 2 min 10 s, however slow the machine is. Parts of the window
 *    that keep changing for more than 5 s are motion; the element at their middle is what moves.
 * 3. **Text that changes on its own** (ACT efbfc7): over the same time, the deepest elements whose `innerText` changed
 *    more than once, still changing after 5 s, with other text around them.
 * 4. **Controls tried**: controls named to pause, stop or hide (`pause`, `stop`, `parar`, `pausar`, `detener`,
 *    `ocultar`…) near what moves are pressed once each on a fresh load, through the activate-class harness (its skip
 *    list, overlays and interception), and the probe records whether the motion stopped. A control that does not show
 *    is reached through one that may show it ("Control changes", "Settings"). A control that changes the frequency is
 *    recorded, never set. What moved and was not stopped is watched again on a second fresh load.
 *
 * Opt-in (`--probe motion`, never part of `all`): it presses controls, and it takes some 100 captures and a fresh load
 * per control. It also runs the time-limit probe (2.2.1, time-limits.ts) on pages of its own.
 */

export const MOTION_VERSION = '1'
export const MOTION_VARIANT = 'motion'
/** The page's time between two captures: not a round number, so a 200 ms or 1 s blink is never sampled at one phase. */
export const STEP_MS = 230
/** The main series, for the top of the page; further windows get a shorter one. */
export const SERIES_MS = 10_000
const OTHER_SCENE_MS = 7000
/** After the main series, the top of the page every 5 s of the page's time, for slow carousels and text that updates every minute. */
export const EXTENDED_MS = 130_000
const EXTENDED_STEP_MS = 5000
/** Real time the extended series may take: pages that draw every frame cost more to move on. */
const EXTENDED_REAL_MS = 15_000
const CELL = 4
const MAX_ITEMS = 20
const MAX_IMAGES = 60
const MAX_DECODED = 12
/** Real time the animated images may take to fetch again, all together. */
const DECODE_BUDGET_MS = 15_000
/** Addresses of formats that never animate. */
const STILL_FORMATS = /\.(jpe?g|svg|bmp|ico)(\?|#|$)/i
const MAX_TRIALS = 8
const TIME_BUDGET_MS = 110_000
/** After a press: time for a slide to finish moving, then time to watch. */
const SETTLE_MS = 1150
const WATCH_MS = 4600
const BEFORE_MS = 2300
const CONFIRM_LEAD_MS = 5060

export type MotionKind = 'text' | 'animation' | 'smil' | 'video' | 'image' | 'pixels' | 'marquee'

export interface MotionItem {
  key: string
  /** The element that moves (for text, the outermost of what changes together). */
  el: InPageElement
  /** Page coordinates. */
  box: InPageRect
  kinds: MotionKind[]
  /** Other elements found moving inside it (a caption inside a carousel), by ref. */
  members?: string[] | undefined
  text?: { ref: string; changes: number; firstMs: number; lastMs: number; intervalMs: number; values: string[] } | undefined
  animation?: Pick<AnimationFact, 'names' | 'properties' | 'infinite' | 'endMs' | 'count' | 'colorOnly'> | undefined
  smil?: { count: number; infinite: boolean; activeMs: number } | undefined
  video?: { url: string; durationMs: number; loop: boolean; muted: boolean; controls: boolean; autoplay: boolean } | undefined
  image?: { url: string; format: string; frames: number; loopMs: number; loop: boolean } | undefined
  /** Where the window showed it move: its area, the first and last change, runs of change, and the time between them (0 when it moves all along). */
  pixels?: { area: number; firstMs: number; lastMs: number; episodes: number; periodMs: number; scene: number } | undefined
  /** How long it was seen moving, in the page's time; -1 when it runs with no end (an infinite animation, a looping video or image). */
  lastsMs: number
  /** Shown next to other content: text, images or controls outside it. */
  parallel: boolean
  /** The browser's own controls (a video's `controls`): a pause the person can use. */
  nativeControls?: boolean | undefined
  /** Controls near it, by key, in the order they are tried. */
  controls: string[]
  /** The control whose press stopped or hid it. */
  stoppedBy?: string | undefined
  /** Moved again on a second fresh load (only asked of what no control stopped). */
  confirmed?: boolean | undefined
}

export interface MotionResult {
  item: string
  /** Before the press, on the same load. */
  before: 'moving' | 'still' | 'gone'
  /** After it: stopped, hidden (or removed), still moving, gone before the press, or not known. */
  after: 'stopped' | 'hidden' | 'moving' | 'unknown'
  detail?: string | undefined
}

export interface MotionTrial {
  outcome: 'tried' | 'not-exercised' | 'unmatched' | 'not-tried'
  reason?: string | undefined
  cover?: (InPageElement & { text: string }) | undefined
  /** The control pressed first to show this one. */
  via?: string | undefined
  results?: MotionResult[] | undefined
  /** Navigations the press started (intercepted), and requests the guard blocked during it. */
  navigations?: number | undefined
  blocked?: number | undefined
}

export interface MotionControl {
  key: string
  el: InPageElement
  name: string
  kind: RawControl['kind']
  word: string
  shows: boolean
  near: RawControl['near']
  skip?: { reason: SkipReason; detail?: string | undefined } | undefined
  /** For an opener: the controls it may show, by key. */
  opens?: string[] | undefined
  trial?: MotionTrial | undefined
}

export interface MotionData {
  viewport: { width: number; height: number }
  stepMs: number
  seriesMs: number
  /** How far the page's time went in the extended series of the top of the page. */
  extendedMs: number
  scenes: Array<{ y: number; frames: number; spanMs: number }>
  found: {
    /** Running animations that last more than 5 s, by element, and those that end sooner. */
    animations: number
    short: number
    smil: number
    videos: number
    images: number
    animated: number
    /** Images that may animate (not JPEG or SVG) and could not be fetched again within the time cap. */
    unread: number
    canvases: number
    marquees: number
    /** Elements whose text changed more than once (ACT efbfc7), and those of them alone on the page. */
    texts: number
    alone: number
    /** Parts of the window that changed, those that changed for more than 5 s, and those for 5 s or less. */
    regions: number
    lasting: number
    brief: number
    /** Animations found further down the page than the windows captured. */
    below: number
    /** Elements tracked for their text. */
    tracked: number
  }
  items: MotionItem[]
  controls: MotionControl[]
  loads: number
  actions: HarnessAction[]
  end: 'complete' | 'time' | 'budget'
}

const motion = (page: Page) => ({
  call: <K extends keyof MotionKit>(name: K, arg: Parameters<MotionKit[K]>[0]) =>
    page.evaluate(({ name, arg }) => ((window as unknown as { __rampaMotion: Record<string, (a: unknown) => unknown> }).__rampaMotion[name] as (a: unknown) => unknown)(arg), { name, arg }) as Promise<ReturnType<MotionKit[K]>>,
})

/** A caret that blinks is the browser's, not the page's motion. */
const NO_CARET = '*, *::before, *::after { caret-color: transparent !important; }'

/** Pauses the page's clock a moment ahead of its own time (the clock refuses to go back). */
export async function pauseClock(page: Page): Promise<void> {
  const pageNow = await page.evaluate(() => Date.now())
  await page.clock.pauseAt(pageNow + 1000).catch(() => page.clock.pauseAt(Date.now() + 5000))
}

/** Moves the paused clock by `ms`, in slices, so timers and frames run as they would; false when `until` (real time) passed. */
export async function advance(page: Page, ms: number, until = Number.POSITIVE_INFINITY, slice = 500): Promise<boolean> {
  for (let left = ms; left > 0; left -= slice) {
    if (Date.now() > until) return false
    await page.clock.runFor(Math.min(slice, left))
  }
  return true
}

async function capture(cdp: CDPSession, clip: InPageRect, scale: number): Promise<{ cols: number; rows: number; rgb: Uint8Array } | undefined> {
  if (clip.width < 1 || clip.height < 1) return undefined
  const shot = (await cdp.send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale }, captureBeyondViewport: false })) as { data: string }
  const image = tryDecodePng(Buffer.from(shot.data, 'base64'))
  if (!image) return undefined
  const rgb = new Uint8Array(image.width * image.height * 3)
  for (let i = 0, j = 0; i < image.data.length; i += 4, j += 3) {
    rgb[j] = image.data[i] ?? 0
    rgb[j + 1] = image.data[i + 1] ?? 0
    rgb[j + 2] = image.data[i + 2] ?? 0
  }
  return { cols: image.width, rows: image.height, rgb }
}

/** Whether a series of captures of the same box changed, by the same measure as the window series. */
function changedFrames(frames: Array<{ cols: number; rows: number; rgb: Uint8Array } | undefined>): number {
  let changes = 0
  for (let k = 1; k < frames.length; k++) {
    const a = frames[k - 1]
    const b = frames[k]
    if (!a || !b || a.cols !== b.cols || a.rows !== b.rows) continue
    for (let i = 0; i < a.rgb.length; i++) {
      if (Math.abs((a.rgb[i] ?? 0) - (b.rgb[i] ?? 0)) >= MOTION.delta) {
        changes++
        break
      }
    }
  }
  return changes
}

/** Cells of a window capture covered by boxes (page coordinates), for the mask. */
function maskOf(boxes: readonly InPageRect[], scroll: { x: number; y: number }, cols: number, rows: number): Uint8Array {
  const mask = new Uint8Array(cols * rows)
  for (const box of boxes) {
    const x0 = Math.max(0, Math.floor((box.x - scroll.x) / CELL))
    const y0 = Math.max(0, Math.floor((box.y - scroll.y) / CELL))
    const x1 = Math.min(cols, Math.ceil((box.x - scroll.x + box.width) / CELL))
    const y1 = Math.min(rows, Math.ceil((box.y - scroll.y + box.height) / CELL))
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) mask[y * cols + x] = 1
  }
  return mask
}

/** The windows to capture: the top of the page, then up to two more for animations, canvases and marquees below it. */
function scenesFor(inventory: MotionInventory, viewport: { width: number; height: number }): { scenes: number[]; below: number } {
  const scenes = [0]
  const maxY = Math.max(0, inventory.page.height - viewport.height)
  const boxes = [...inventory.animations.map((a) => a.box), ...inventory.smil.map((s) => s.box), ...inventory.canvases, ...inventory.marquees.map((m) => m.box)].sort((a, b) => a.y - b.y)
  const inside = (box: InPageRect, y: number) => box.y + Math.min(box.height, viewport.height) / 2 >= y && box.y < y + viewport.height && box.x < viewport.width
  let below = 0
  for (const box of boxes) {
    if (box.width < 1 || box.height < 1 || scenes.some((y) => inside(box, y))) continue
    const y = Math.min(maxY, Math.max(0, Math.round(box.y - 64)))
    if (scenes.length >= 3 || scenes.some((other) => Math.abs(other - y) < viewport.height / 2)) {
      below++
      continue
    }
    scenes.push(y)
  }
  return { scenes, below }
}

interface Decoded {
  el: InPageElement
  box: InPageRect
  url: string
  format: string
  frames: number
  loopMs: number
  loop: boolean
}

/** Animated images: their frames and loop, read from their bytes (the flash probe's decoder). */
async function decodeImages(browser: Browser, probe: ProbePage, url: string, options: ProbeOptions, inventory: MotionInventory, deadline: number): Promise<{ decoded: Decoded[]; unread: number }> {
  const out: Decoded[] = []
  let decoder: Awaited<ReturnType<typeof decoderPage>> | undefined
  // JPEG, SVG and the like never animate; the rest are fetched again, a few at a time, within a time cap.
  const until = Math.min(deadline, Date.now() + DECODE_BUDGET_MS)
  const urls = [...new Set(inventory.images.map((image) => image.url).filter((u) => !STILL_FORMATS.test(u)))]
  const fetched = new Map<string, Uint8Array | string>()
  await mapLimit(urls, 6, async (u) => {
    if (Date.now() > until) return
    const late = new Promise<string>((resolve) => setTimeout(() => resolve('time'), Math.max(0, until - Date.now())).unref?.())
    fetched.set(u, await Promise.race([imageBytes(probe.context, u, url, options.browserOptions).catch(() => 'not-fetched'), late]))
  })
  try {
    for (const image of inventory.images) {
      if (Date.now() > deadline || out.length >= MAX_DECODED) break
      const bytes = fetched.get(image.url)
      if (bytes === undefined || typeof bytes === 'string') continue
      const format = animatedFormat(bytes)
      if (!format) continue
      decoder ??= await decoderPage(browser)
      const decoded = await decoder.page.evaluate(decodeFramesInPage, { b64: Buffer.from(bytes).toString('base64'), type: format, cols: 1, rows: 1, maxFrames: 300 })
      if (decoded.error || decoded.frames.length < 2) continue
      // Chromium plays frames of 10 ms or less at 100 ms.
      const loopMs = Math.round(decoded.frames.reduce((sum, f) => sum + (f.d <= 10 ? 100 : f.d), 0))
      out.push({ el: image.el, box: image.box, url: image.url.slice(0, 200), format, frames: decoded.frames.length, loopMs, loop: decoded.repetition !== 0 })
    }
  } finally {
    await decoder?.context.close().catch(() => undefined)
  }
  // Images that may animate and could not be read again in time (or at all): their motion is not known.
  const unread = urls.filter((u) => typeof (fetched.get(u) ?? 'time') === 'string').length
  return { decoded: out, unread }
}

interface Series {
  scenes: MotionData['scenes']
  regions: Array<MotionRegion & { scene: number; scroll: { x: number; y: number } }>
  extendedMs: number
  timedOut: boolean
}

/**
 * The window over the page's time: CSS and SVG animations set to each instant, timers and frames run by the fake
 * clock, text read at each step. The top of the page for 10 s and then every 5 s up to 2 min 10 s; further windows
 * for 7 s.
 */
async function windowSeries(probe: ProbePage, scenes: number[], masked: readonly InPageRect[], deadline: number): Promise<Series> {
  const page = probe.page
  const kit = motion(page)
  const viewport = page.viewportSize() ?? probe.conditions.viewport
  const cols = Math.ceil(viewport.width / CELL)
  const rows = Math.ceil(viewport.height / CELL)
  const cdp = await probe.context.newCDPSession(page)
  const out: Series = { scenes: [], regions: [], extendedMs: 0, timedOut: false }
  let clock = 0
  try {
    await pauseClock(page)
    for (let s = 0; s < scenes.length; s++) {
      if (Date.now() > deadline) {
        out.timedOut = true
        break
      }
      const scroll = await kit.call('scroll', scenes[s] ?? 0)
      await page.clock.runFor(200)
      clock += 200
      await kit.call('freeze', undefined as never)
      const span = s === 0 ? SERIES_MS : OTHER_SCENE_MS
      const frames: MotionFrame[] = []
      const shoot = async (t: number) => {
        await kit.call('seek', t)
        await kit.call('textStep', clock)
        const shot = await capture(cdp, { x: scroll.x, y: scroll.y, width: viewport.width, height: viewport.height }, 1 / CELL)
        if (shot && shot.cols * shot.rows === cols * rows) frames.push({ t, rgb: shot.rgb })
        else if (shot) {
          // A capture a pixel off in size: fitted to the grid.
          const rgb = new Uint8Array(cols * rows * 3)
          for (let y = 0; y < Math.min(rows, shot.rows); y++) rgb.set(shot.rgb.subarray(y * shot.cols * 3, y * shot.cols * 3 + Math.min(cols, shot.cols) * 3), y * cols * 3)
          frames.push({ t, rgb })
        }
      }
      for (let t = 0; t <= span; t += STEP_MS) {
        if (Date.now() > deadline) {
          out.timedOut = true
          break
        }
        await shoot(t)
        await page.clock.runFor(STEP_MS)
        clock += STEP_MS
      }
      let reached = frames[frames.length - 1]?.t ?? 0
      if (s === 0 && !out.timedOut) {
        // The top of the page, later: slow carousels, text that updates every minute.
        const until = Math.min(deadline, Date.now() + EXTENDED_REAL_MS)
        for (let t = Math.ceil((reached + 1) / EXTENDED_STEP_MS) * EXTENDED_STEP_MS; t <= EXTENDED_MS; t += EXTENDED_STEP_MS) {
          const step = t - reached - STEP_MS
          if (!(await advance(page, Math.max(0, step), until))) break
          clock += Math.max(0, step)
          await shoot(t)
          await page.clock.runFor(STEP_MS)
          clock += STEP_MS
          reached = t
        }
        out.extendedMs = reached
      }
      const mask = maskOf(masked, scroll, cols, rows)
      for (const region of motionRegions({ cols, rows, cell: CELL, mask }, frames)) out.regions.push({ ...region, scene: s, scroll })
      out.scenes.push({ y: scroll.y, frames: frames.length, spanMs: frames[frames.length - 1]?.t ?? 0 })
    }
  } finally {
    await cdp.detach().catch(() => undefined)
  }
  return out
}

interface Candidate {
  el: InPageElement
  box: InPageRect
  kinds: MotionKind[]
  text?: MotionItem['text']
  animation?: MotionItem['animation']
  smil?: MotionItem['smil']
  video?: MotionItem['video']
  image?: MotionItem['image']
  pixels?: MotionItem['pixels']
  lastsMs: number
  nativeControls?: boolean
}

/** Joins what was found about the same element, or about an element and what moves inside it. */
async function mergeCandidates(page: Page, candidates: Candidate[]): Promise<Array<Candidate & { members: string[] }>> {
  const kit = motion(page)
  const refs = [...new Set(candidates.map((c) => c.el.ref))].slice(0, 80)
  const pairs: Array<[string, string]> = refs.flatMap((a) => refs.filter((b) => b !== a).map((b): [string, string] => [a, b]))
  const answers = pairs.length > 0 ? await kit.call('contains', pairs) : []
  const holds = new Set(pairs.filter((_, i) => answers[i]).map(([a, b]) => `${a}\n${b}`))
  const groups: Array<Candidate & { members: string[] }> = []
  for (const candidate of candidates) {
    const group = groups.find((g) => g.el.ref === candidate.el.ref || holds.has(`${g.el.ref}\n${candidate.el.ref}`) || holds.has(`${candidate.el.ref}\n${g.el.ref}`))
    if (!group) {
      groups.push({ ...candidate, kinds: [...candidate.kinds], members: [] })
      continue
    }
    if (group.el.ref !== candidate.el.ref) {
      if (holds.has(`${candidate.el.ref}\n${group.el.ref}`)) {
        // The new one holds the group: it becomes the element, the old one a member.
        group.members.push(group.el.ref)
        group.el = candidate.el
        group.box = candidate.box
      } else if (!group.members.includes(candidate.el.ref)) group.members.push(candidate.el.ref)
    }
    absorb(group, candidate)
  }
  return groups
}

function absorb(group: Candidate & { members: string[] }, other: Candidate): void {
  for (const kind of other.kinds) if (!group.kinds.includes(kind)) group.kinds.push(kind)
  group.text ??= other.text
  group.animation ??= other.animation
  group.smil ??= other.smil
  group.video ??= other.video
  group.image ??= other.image
  group.pixels ??= other.pixels
  if (other.nativeControls) group.nativeControls = true
  group.lastsMs = group.lastsMs === -1 || other.lastsMs === -1 ? -1 : Math.max(group.lastsMs, other.lastsMs)
}

/** The pixel facts of a region that moved. */
function pixelFacts(region: Series['regions'][number]): NonNullable<MotionItem['pixels']> {
  // Motion that goes on for seconds at a time needs no long watch; a carousel that moves now and then does, as long
  // as the time between its moves, read where the series is fine (its first ten seconds).
  const fine = region.starts.filter((t) => t <= SERIES_MS + STEP_MS)
  const gaps = (fine.length >= 2 ? fine : region.starts).slice(1).map((t, i) => t - ((fine.length >= 2 ? fine : region.starts)[i] ?? 0)).sort((a, b) => a - b)
  const periodMs = region.episodes >= 2 && region.longestMs < 2000 ? (gaps[Math.floor(gaps.length / 2)] ?? 0) : 0
  return { area: region.area, firstMs: region.firstMs, lastMs: region.lastMs, episodes: region.episodes, periodMs, scene: region.scene }
}

/** What the probe found moving, from the inventory, the window series and the text that changed. */
async function findItems(page: Page, inventory: MotionInventory, decoded: Decoded[], series: Series, texts: TextTarget[]): Promise<{ items: Candidate[]; brief: number; lasting: number }> {
  const kit = motion(page)
  const candidates: Candidate[] = []
  let brief = 0
  let lasting = 0
  const moving: Array<{ region: Series['regions'][number]; box: InPageRect; used: boolean }> = []
  for (const region of series.regions) {
    if (!lastsLonger(region, STEP_MS)) {
      brief++
      continue
    }
    lasting++
    moving.push({ region, box: { x: region.box.x + region.scroll.x, y: region.box.y + region.scroll.y, width: region.box.width, height: region.box.height }, used: false })
  }
  const capturedAt = (box: InPageRect) => series.scenes.some((scene) => box.y < scene.y + (page.viewportSize()?.height ?? 800) && box.y + box.height > scene.y)
  const seenMoving = (box: InPageRect): boolean => {
    let any = false
    for (const m of moving) {
      if (overlapShare(m.box, box) > 0.3 || overlapShare(box, m.box) > 0.3) {
        m.used = true
        any = true
      }
    }
    return any
  }
  for (const a of inventory.animations) {
    // An animation counts when the window shows it move; one the series did not capture is left out (counted).
    if (!capturedAt(a.box) || !seenMoving(a.box)) continue
    candidates.push({ el: a.el, box: a.box, kinds: ['animation'], animation: { names: a.names, properties: a.properties, infinite: a.infinite, endMs: a.endMs, count: a.count, colorOnly: a.colorOnly }, lastsMs: a.infinite ? -1 : a.endMs })
  }
  for (const s of inventory.smil) {
    if (!(s.infinite || s.activeMs > MOTION.lastsMs) || !capturedAt(s.box) || !seenMoving(s.box)) continue
    candidates.push({ el: s.el, box: s.box, kinds: ['smil'], smil: { count: s.count, infinite: s.infinite, activeMs: s.activeMs }, lastsMs: s.infinite ? -1 : s.activeMs })
  }
  for (const m of inventory.marquees) {
    if (!seenMoving(m.box) && capturedAt(m.box)) continue
    candidates.push({ el: m.el, box: m.box, kinds: ['marquee'], lastsMs: -1 })
  }
  for (const v of inventory.videos) {
    const lasts = v.loop || v.durationMs === -1 || v.durationMs > MOTION.lastsMs
    if (v.paused || !lasts) continue
    candidates.push({ el: v.el, box: v.box, kinds: ['video'], video: { url: v.url.slice(0, 200), durationMs: v.durationMs, loop: v.loop, muted: v.muted, controls: v.controls, autoplay: v.autoplay }, lastsMs: v.loop || v.durationMs === -1 ? -1 : v.durationMs, ...(v.controls ? { nativeControls: true } : {}) })
  }
  for (const d of decoded) {
    if (!(d.loop || d.loopMs > MOTION.lastsMs)) continue
    candidates.push({ el: d.el, box: d.box, kinds: ['image'], image: { url: d.url, format: d.format, frames: d.frames, loopMs: d.loopMs, loop: d.loop }, lastsMs: d.loop ? -1 : d.loopMs })
  }
  for (const t of texts) {
    seenMoving(t.box)
    candidates.push({ el: t.el, box: t.box, kinds: ['text'], text: { ref: t.el.ref, changes: t.changes, firstMs: t.firstMs, lastMs: t.lastMs, intervalMs: t.intervalMs, values: t.values }, lastsMs: t.lastMs - t.firstMs })
  }
  // What moved on the window and nothing above explains: a script carousel, a canvas, a frame of another origin.
  const viewport = page.viewportSize() ?? { width: 1280, height: 800 }
  for (const m of moving) {
    if (m.used) continue
    const view = { x: m.box.x - m.region.scroll.x, y: m.box.y - m.region.scroll.y, width: m.box.width, height: m.box.height }
    await kit.call('scroll', m.region.scroll.y)
    const found = view.x < viewport.width && view.y < viewport.height ? await kit.call('region', view) : null
    if (!found) continue
    candidates.push({ el: found.el, box: found.box, kinds: ['pixels'], pixels: pixelFacts(m.region), lastsMs: m.region.lastMs - m.region.firstMs })
  }
  // Pixels that confirm an animation, text or a video: kept with it, for the evidence.
  for (const candidate of candidates) {
    if (candidate.pixels) continue
    const m = moving.find((x) => overlapShare(x.box, candidate.box) > 0.3 || overlapShare(candidate.box, x.box) > 0.3)
    if (m) candidate.pixels = pixelFacts(m.region)
  }
  await kit.call('scroll', 0)
  return { items: candidates, brief, lasting }
}

/** The states the trials compare, for each item: by its ref, and the text element's when it is another. */
const stateArgs = (items: readonly MotionItem[]) => items.map((item) => ({ key: item.key, ref: item.el.ref, ...(item.text && item.text.ref !== item.el.ref ? { textRef: item.text.ref } : {}) }))

/** Items that only pixels show moving (a script carousel, a canvas, a frame of another origin): watched by capture. */
const pixelOnly = (item: MotionItem) => item.kinds.includes('pixels') && !item.kinds.some((k) => k === 'animation' || k === 'video' || k === 'text' || k === 'smil' || k === 'image')

/** How long to watch an item to see it change again: two and a half of its intervals, at least `least`, at most 15 s. */
function watchFor(item: MotionItem, least: number): number {
  const period = item.text?.intervalMs ?? item.pixels?.periodMs ?? 0
  return Math.max(least, Math.min(15_000, Math.round(period * 2.5)))
}

/**
 * Pixel captures of the items only pixels show moving, every step of the page's time for `ms`: each is scrolled into
 * the window before its capture. How many frames changed, per item; undefined for an item that could not be captured.
 * With `untilChange`, the watch ends once every item changed.
 */
async function pixelWatch(page: Page, cdp: CDPSession, items: readonly MotionItem[], ms: number, deadline: number, untilChange = false): Promise<{ changes: Map<string, number | undefined>; elapsed: number }> {
  const kit = motion(page)
  const watched = items.filter(pixelOnly)
  const frames = new Map<string, Array<{ cols: number; rows: number; rgb: Uint8Array } | undefined>>(watched.map((item) => [item.key, []]))
  const viewport = page.viewportSize() ?? { width: 1280, height: 800 }
  let elapsed = 0
  for (let t = 0; watched.length > 0 && t <= ms; t += STEP_MS) {
    if (Date.now() > deadline) break
    for (const item of watched) {
      const box = await kit.call('reveal', item.el.ref)
      let shot: { cols: number; rows: number; rgb: Uint8Array } | undefined
      if (box) {
        const x = Math.max(0, box.x)
        const y = Math.max(0, box.y)
        const width = Math.min(box.x + box.width, viewport.width) - x
        const height = Math.min(box.y + box.height, viewport.height) - y
        const scroll = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }))
        shot = width >= 1 && height >= 1 ? await capture(cdp, { x: x + scroll.x, y: y + scroll.y, width, height }, 1 / CELL).catch(() => undefined) : undefined
      }
      frames.get(item.key)?.push(shot)
    }
    if (untilChange && watched.every((item) => changedFrames(frames.get(item.key) ?? []) > 0)) break
    await page.clock.runFor(STEP_MS)
    elapsed += STEP_MS
  }
  return { changes: new Map([...frames].map(([key, list]) => [key, list.filter(Boolean).length >= 2 ? changedFrames(list) : undefined])), elapsed }
}

/**
 * Waits, in real time, for the transitions and other finite animations under way to end (at most 2 s): on the probe's
 * fresh loads CSS runs on its own clock, so a slide that began to move before a press still moves after it.
 */
async function settleTransitions(page: Page): Promise<void> {
  const until = Date.now() + 2000
  while (Date.now() < until) {
    const running = await page
      .evaluate(() => document.getAnimations().filter((a) => a.playState === 'running' && Number.isFinite(Number((a.effect as KeyframeEffect | null)?.getComputedTiming().activeDuration))).length)
      .catch(() => 0)
    if (running === 0) return
    await page.waitForTimeout(100)
  }
}

/** What became of an item after a press, from the readings before and after the watch, and the pixel watch. */
function judgeAfter(item: MotionItem, before: ItemState | undefined, after: ItemState | undefined, textChanged: boolean, pixelChanges: number | undefined): MotionResult['after'] {
  if (!after || after.gone || !after.visible) return 'hidden'
  if (item.kinds.includes('text') && textChanged) return 'moving'
  if ((item.kinds.includes('animation') || item.kinds.includes('marquee')) && after.running > 0) return 'moving'
  if (item.kinds.includes('smil') && after.smilRunning && after.smilTime !== before?.smilTime) return 'moving'
  if (item.kinds.includes('video') && after.videoPlaying) return 'moving'
  if (item.kinds.includes('image') && after.src === before?.src) return 'moving'
  if (pixelOnly(item)) return pixelChanges === undefined ? 'unknown' : pixelChanges > 0 ? 'moving' : 'stopped'
  // A marquee drawn by the browser shows no animation the page can read.
  if (item.kinds.includes('marquee')) return 'unknown'
  return 'stopped'
}

/** Whether an item moved on a load, from two readings and a pixel watch between them. */
function movedBetween(item: MotionItem, a: ItemState | undefined, b: ItemState | undefined, pixelChanges: number | undefined): boolean {
  if (!a || !b || a.gone || b.gone) return false
  if (item.kinds.includes('text') && a.text !== b.text) return true
  if ((item.kinds.includes('animation') || item.kinds.includes('marquee')) && b.running > 0) return true
  if (item.kinds.includes('smil') && b.smilRunning) return true
  if (item.kinds.includes('video') && b.videoPlaying) return true
  if (item.kinds.includes('image') && b.visible) return true
  return (pixelChanges ?? 0) > 0
}

/**
 * One control pressed on a fresh load: the motion under way, the press (after its opener when it does not show),
 * time for the page to answer, then a watch of what still moves.
 */
async function tryControl(harness: Harness, control: MotionControl, opener: MotionControl | undefined, items: MotionItem[], deadline: number): Promise<MotionTrial> {
  const probe = await harness.page(true)
  const page = probe.page
  await page.addStyleTag({ content: NO_CARET }).catch(() => undefined)
  await page.evaluate(installMotionKit)
  const kit = motion(page)
  await pauseClock(page)
  const cdp = await probe.context.newCDPSession(page)
  const blockedAt = probe.guard.log.blocked.length
  const navAt = probe.guard.log.navigations.length
  const nav = () => page.evaluate(() => ((window as unknown as { __rampaNav?: unknown[] }).__rampaNav ?? []).length).catch(() => 0)
  const navStart = await nav()
  try {
    // The motion under way, as on the first load: read, then watched until what only pixels show has moved.
    await advance(page, BEFORE_MS)
    const first = await kit.call('states', stateArgs(items))
    const lead = Math.max(STEP_MS * 4, ...items.filter(pixelOnly).map((item) => watchFor(item, 0)))
    const beforePixels = (await pixelWatch(page, cdp, items, lead, deadline, true)).changes
    const second = await kit.call('states', stateArgs(items))
    const before = new Map(
      items.map((item) => {
        const a = first.find((s) => s.key === item.key)
        const b = second.find((s) => s.key === item.key)
        // Text seen changing on the first load counts as moving: it may update less often than this short wait.
        const state: MotionResult['before'] = !b || b.gone ? 'gone' : movedBetween(item, a, b, beforePixels.get(item.key)) || (item.kinds.includes('text') && b.visible) ? 'moving' : 'still'
        return [item.key, state] as const
      }),
    )
    if (opener) {
      if (!(await harness.locate(probe, opener.el, { check: (facts) => skipOf(facts, harness.origin, opener.name) }))) return { outcome: 'unmatched', via: opener.key, reason: 'the control that shows it is not on this load' }
      const at = await harness.aim(probe, opener.el)
      if (!('x' in at)) return { outcome: 'not-exercised', via: opener.key, reason: 'cover' in at ? 'the control that shows it is under another layer' : 'the control that shows it does not show', ...('cover' in at ? { cover: at.cover } : {}) }
      harness.log('activate', { ref: opener.el.ref, label: opener.name, detail: `pressed to show "${control.name}"` })
      await page.mouse.click(at.x, at.y)
      await advance(page, 600)
    }
    if (!(await harness.locate(probe, control.el, { check: (facts) => skipOf(facts, harness.origin, control.name) }))) return { outcome: 'unmatched', ...(opener ? { via: opener.key } : {}) }
    const at = await harness.aim(probe, control.el)
    if (!('x' in at)) return { outcome: 'not-exercised', reason: 'cover' in at ? 'under another layer' : 'does not show', ...('cover' in at ? { cover: at.cover } : {}), ...(opener ? { via: opener.key } : {}) }
    harness.log('activate', { ref: control.el.ref, label: control.name, detail: `pressed to ${control.kind}` })
    const textsBefore = await kit.call('states', stateArgs(items))
    await page.mouse.click(at.x, at.y)
    await advance(page, SETTLE_MS)
    await settleTransitions(page)
    const settled = await kit.call('states', stateArgs(items))
    // What changes slowly is watched for at least two and a half of its intervals.
    const pixelMs = Math.max(WATCH_MS, ...items.filter(pixelOnly).map((item) => watchFor(item, WATCH_MS)))
    const watched = await pixelWatch(page, cdp, items, pixelMs, deadline)
    const pixels = watched.changes
    const textMs = Math.max(WATCH_MS, ...items.filter((item) => item.text).map((item) => watchFor(item, WATCH_MS)))
    await advance(page, Math.max(0, textMs - watched.elapsed))
    const end = await kit.call('states', stateArgs(items))
    const results: MotionResult[] = items.map((item) => {
      const was = before.get(item.key) ?? 'still'
      const a = settled.find((s) => s.key === item.key)
      const b = end.find((s) => s.key === item.key)
      const pressedAt = textsBefore.find((s) => s.key === item.key)
      if (was !== 'moving') return { item: item.key, before: was, after: 'unknown' }
      const textChanged = !!a && !!b && a.text !== b.text
      let after = judgeAfter(item, a, b, textChanged, pixels.get(item.key))
      // A carousel that a press hid or replaced right away still counts as hidden.
      if (after === 'stopped' && pressedAt && b && !b.gone && pressedAt.visible && !b.visible) after = 'hidden'
      return { item: item.key, before: was, after }
    })
    return {
      outcome: 'tried',
      results,
      ...(opener ? { via: opener.key } : {}),
      navigations: probe.guard.log.navigations.length - navAt + Math.max(0, (await nav()) - navStart),
      blocked: probe.guard.log.blocked.length - blockedAt,
    }
  } finally {
    await cdp.detach().catch(() => undefined)
  }
}

/** What moved and no control stopped, watched again on a fresh load with no input. */
async function confirmItems(harness: Harness, items: MotionItem[], deadline: number): Promise<Map<string, boolean>> {
  const probe = await harness.page(true)
  const page = probe.page
  await page.addStyleTag({ content: NO_CARET }).catch(() => undefined)
  await page.evaluate(installMotionKit)
  const kit = motion(page)
  await pauseClock(page)
  const cdp = await probe.context.newCDPSession(page)
  try {
    // Past five seconds of the page's time, then until each has had time to change again.
    await advance(page, CONFIRM_LEAD_MS)
    const a = await kit.call('states', stateArgs(items))
    const pixelMs = Math.max(STEP_MS * 14, ...items.filter(pixelOnly).map((item) => watchFor(item, 0)))
    const watched = await pixelWatch(page, cdp, items, pixelMs, deadline, true)
    const pixels = watched.changes
    const textMs = Math.max(0, ...items.filter((item) => item.text).map((item) => watchFor(item, WATCH_MS)))
    await advance(page, Math.max(0, textMs - watched.elapsed))
    const b = await kit.call('states', stateArgs(items))
    return new Map(items.map((item) => [item.key, movedBetween(item, a.find((s) => s.key === item.key), b.find((s) => s.key === item.key), pixels.get(item.key))]))
  } finally {
    await cdp.detach().catch(() => undefined)
  }
}

const HOW_ORDER: RawControl['near'][number]['how'][] = ['controls', 'container', 'distance', 'page']
const TRIABLE: ReadonlyArray<RawControl['kind']> = ['pause', 'stop', 'hide', 'close', 'setting']

/** The controls near an item, in the order they are tried: what it names, what holds both, the nearest, the page's. */
function nearControls(item: MotionItem, controls: readonly MotionControl[]): MotionControl[] {
  const near = controls
    .map((c) => ({ c, n: c.near.find((x) => x.item === item.key) }))
    .filter((x): x is { c: MotionControl; n: RawControl['near'][number] } => x.n !== undefined)
  return near.sort((a, b) => HOW_ORDER.indexOf(a.n.how) - HOW_ORDER.indexOf(b.n.how) || a.n.distance - b.n.distance).map((x) => x.c)
}

/** A control is pressed only when the skip list allows it; "Desativar animações" names no account, whatever the word. */
function skipOf(facts: ControlFacts, origin: string, name: string): MotionControl['skip'] {
  const skip = skipReason(facts, origin)
  if (skip?.reason === 'destructive' && ['deactivate', 'desativar', 'desactivar', 'disable'].includes(skip.detail ?? '') && /anima|motion|moviment|carousel|carrossel|carrusel|slide/i.test(name)) return undefined
  return skip
}

export async function runMotionProbe(browser: Browser, url: string, options: ProbeOptions): Promise<ProbeRecord> {
  const started = Date.now()
  const deadline = started + TIME_BUDGET_MS
  const harness = new Harness(browser, url, options, {
    kind: 'motion',
    version: MOTION_VERSION,
    variant: MOTION_VARIANT,
    limits: { controls: MAX_TRIALS, timeMs: TIME_BUDGET_MS },
    page: { clock: true },
  })
  let data: MotionData | undefined
  let conditions: ProbeRecord['conditions'] | undefined
  try {
    const first = await harness.page()
    conditions = first.conditions
    const page = first.page
    const viewport = page.viewportSize() ?? first.conditions.viewport
    await page.addStyleTag({ content: NO_CARET }).catch(() => undefined)
    await page.evaluate(installMotionKit)
    const kit = motion(page)
    const inventory = await kit.call('inventory', MAX_IMAGES)
    const { decoded, unread } = await decodeImages(browser, first, url, options, inventory, deadline)
    const tracked = await kit.call('textStart', 4000)
    const { scenes, below } = scenesFor(inventory, viewport)
    // Media read on their own are left out of the window: videos play in real time, animated images on their own clock.
    const masked = [...decoded.map((d) => d.box), ...inventory.videos.map((v) => v.box)]
    const series = await windowSeries(first, scenes, masked, deadline)
    const texts = await kit.call('textTargets', { lastsMs: MOTION.lastsMs, fineMs: SERIES_MS + 1000 })
    const found = await findItems(page, inventory, decoded, series, texts.filter((t) => !t.alone))
    const merged = (await mergeCandidates(page, found.items)).slice(0, MAX_ITEMS)
    const items: MotionItem[] = []
    for (const [i, candidate] of merged.entries()) {
      const { members, ...rest } = candidate
      items.push({ key: `m${i}`, ...rest, ...(members.length > 0 ? { members } : {}), parallel: await kit.call('parallel', candidate.el.ref), controls: [] })
    }
    const raw = items.length > 0 ? await kit.call('controls', items.map((item) => ({ key: item.key, ref: item.el.ref }))) : []
    const controls: MotionControl[] = raw.map(({ facts, opens, ...control }, i) => {
      const skip = skipOf(facts, harness.origin, control.name)
      return { key: `c${i}`, ...control, ...(skip ? { skip } : {}), ...(opens ? { opens } : {}) }
    })
    // Openers point at the hidden controls they may show, by key.
    for (const opener of controls.filter((c) => c.kind === 'opener')) {
      const refs = raw[Number(opener.key.slice(1))]?.opens ?? []
      opener.opens = controls.filter((c) => refs.includes(c.el.ref)).map((c) => c.key)
    }
    for (const item of items) item.controls = nearControls(item, controls).map((c) => c.key)
    data = {
      viewport,
      stepMs: STEP_MS,
      seriesMs: SERIES_MS,
      extendedMs: series.extendedMs,
      scenes: series.scenes,
      found: {
        animations: inventory.animations.length,
        short: inventory.short,
        smil: inventory.smil.length,
        videos: inventory.videos.length,
        images: inventory.images.length,
        animated: decoded.length,
        unread,
        canvases: inventory.canvases.length,
        marquees: inventory.marquees.length,
        texts: texts.length,
        alone: texts.filter((t) => t.alone).length,
        regions: series.regions.length,
        lasting: found.lasting,
        brief: found.brief,
        below,
        tracked,
      },
      items,
      controls,
      loads: 0,
      actions: [],
      end: series.timedOut ? 'time' : 'complete',
    }

    // Controls pressed, nearest first, until each item is stopped or has no control left to try.
    let trials = 0
    const open = () => items.filter((item) => item.parallel && !item.nativeControls && !item.stoppedBy)
    const record = (control: MotionControl, trial: MotionTrial) => {
      control.trial = trial
      for (const result of trial.results ?? []) {
        const item = items.find((i) => i.key === result.item)
        if (item && !item.stoppedBy && result.before === 'moving' && (result.after === 'stopped' || result.after === 'hidden')) item.stoppedBy = control.key
      }
    }
    for (;;) {
      const pending = open()
      const next = pending
        .flatMap((item) => item.controls.map((key) => controls.find((c) => c.key === key)))
        .find((c): c is MotionControl => !!c && !c.trial && !c.skip && TRIABLE.includes(c.kind) && c.shows)
      const viaOpener = next
        ? undefined
        : pending
            .flatMap((item) => item.controls.map((key) => controls.find((c) => c.key === key)))
            .map((c) => (c && !c.trial && !c.skip && TRIABLE.includes(c.kind) && !c.shows ? { c, opener: controls.find((o) => o.kind === 'opener' && !o.skip && (o.opens ?? []).includes(c.key)) } : undefined))
            .find((x): x is { c: MotionControl; opener: MotionControl } => !!x?.opener)
      const control = next ?? viaOpener?.c
      if (!control) break
      if (trials >= MAX_TRIALS || Date.now() > deadline - 8000) {
        for (const c of controls) if (!c.trial && !c.skip && TRIABLE.includes(c.kind)) c.trial = { outcome: 'not-tried', reason: trials >= MAX_TRIALS ? 'budget' : 'time' }
        data.end = trials >= MAX_TRIALS ? 'budget' : 'time'
        break
      }
      trials++
      record(control, await tryControl(harness, control, viaOpener?.opener, pending, deadline))
    }
    for (const control of controls) if (control.skip) harness.skip({ ref: control.el.ref, label: control.name }, control.skip.reason, control.skip.detail)

    // What still moves and no control stopped: once more, on a fresh load with no input.
    const unresolved = open()
    if (unresolved.length > 0 && Date.now() < deadline - 5000) {
      const moved = await confirmItems(harness, unresolved, deadline)
      for (const item of unresolved) item.confirmed = moved.get(item.key) === true
    }
  } finally {
    await harness.close()
  }
  if (!data || !conditions) throw new Error('the first page did not load')
  data.loads = harness.loads
  data.actions = harness.actions
  const reason = data.end === 'time' ? `time budget reached (${TIME_BUDGET_MS / 1000} s)` : data.end === 'budget' ? `control budget reached (${MAX_TRIALS})` : undefined
  return harness.record(data, { ...conditions, variant: MOTION_VARIANT }, reason)
}

/** The motion probe as a step of the probe stage: 2.2.2 on its pages, then 2.2.1 on its own; a part that fails leaves a skipped record. */
export async function motionProbe(browser: Browser, url: string, options: ProbeOptions): Promise<ProbeRecord[]> {
  const records: ProbeRecord[] = []
  const started = Date.now()
  try {
    records.push(await runMotionProbe(browser, url, options))
  } catch (error) {
    records.push(skippedRecord('motion', MOTION_VERSION, MOTION_VARIANT, `probe failed: ${(error instanceof Error ? error.message : String(error)).split('\n')[0]}`, Date.now() - started))
  }
  const motionData = records[0]?.data as MotionData | null | undefined
  records.push(...(await timeLimitsProbe(browser, url, options, (motionData?.items ?? []).map((item) => item.el.ref))))
  return records
}

export { TIME_LIMITS_VERSION }
