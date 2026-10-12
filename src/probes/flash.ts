import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Browser, BrowserContext, Page } from 'playwright-core'
import { FLASH, FLASH_AREA_LIMIT, type FlashFrame, type FlashGrid, type FlashMeasure, analyzeFlashes } from '../pixels/flash.ts'
import { tryDecodePng } from '../pixels/png.ts'
import type { ProbeRecord } from '../snapshot/schema.ts'
import { type BrowserOptions, headersFor } from '../surfaces/browser-options.ts'
import type { InPageElement, InPageRect, Kit } from './kit.ts'
import { destructiveAddress } from './guard.ts'
import { type ProbeOptions, openProbePage, skippedRecord } from './page.ts'

/**
 * Three Flashes or Below Threshold (2.3.1), item D1 of docs/plans/wcag-coverage.md. One analyzer (pixels/flash.ts)
 * counts flashes on downsampled grids of frames, whatever they come from:
 *
 * - **Animated images** (GIF, APNG, animated WebP), in `img` elements and CSS backgrounds: their bytes are fetched
 *   once more with GET and decoded frame by frame with the browser's `ImageDecoder`, each frame scaled to the size
 *   the page shows it at, and timed by its own duration (10 ms or less counts as 100 ms, as Chromium plays it). A
 *   looping image is analyzed while looping.
 * - **Video**: each `video` that shows is played **muted** (its sound is never turned on) for 3 s of media time, and
 *   each frame the browser presents is drawn into a small canvas and read. A video from another origin without CORS
 *   cannot be read, and says so. A video with controls is also read at the size full screen would give it.
 * - **Everything else on screen** (CSS animations and transitions, canvas, SVG animations, scripts that restyle the
 *   page): the window is captured at a quarter scale (a cell per 4 × 4 CSS px) every 16 ms of the page's own time,
 *   for 3 s. Playwright's fake clock drives timers and `requestAnimationFrame`, and CSS and SVG animations are paused
 *   and set to each instant, so the frames are where the page would be at those times however slow the machine is.
 *   Videos and animated images, read on their own, are left out of these captures. The top of the page is captured,
 *   then up to two more windows for canvases and animations further down.
 *
 * The window is 1024 × 768 CSS px, the screen WCAG's 341 × 256 field is defined on. The probe is opt-in
 * (`--probe flash`, never part of `all`): it plays media and takes some 200 captures. It never unmutes anything.
 */

export const FLASH_VERSION = '1'
export const FLASH_VARIANT = 'flash'
export const FLASH_VIEWPORT = { width: 1024, height: 768 }
/** The page's own time between two captures of the window. */
export const STEP_MS = 16
/** How long each window is captured, in the page's time: the top of the page, then the windows further down. */
const SCENE_MS = [3000, 2000, 2000] as const
/** CSS px per cell in window captures (a quarter scale). */
const SCREEN_CELL = 4
const TIME_BUDGET_MS = 60_000
const MAX_IMAGES = 12
const MAX_IMAGE_BYTES = 8_000_000
const MAX_IMAGE_FRAMES = 300
/** An animated image is analyzed over this much of its time at most, its loops included. */
const IMAGE_SPAN_MS = 6000
const MAX_VIDEOS = 3
const VIDEO_SPAN_MS = 3000
/** Real time a video may take to give 3 s of frames; a slow machine gets fewer frames, never a longer wait. */
const VIDEO_WAIT_MS = 9000
/** Cells across the longer side of an image or a video at most. */
const MAX_CELLS = 96

export interface FlashSource {
  kind: 'screen' | 'image' | 'video'
  /** The image or the video. */
  el?: InPageElement | undefined
  /** For a window capture: the element at the middle of the area that flashes most, for general and for red flashes. */
  at?: { general?: InPageElement | undefined; red?: InPageElement | undefined } | undefined
  /** Where it is, in CSS px from the page's top left corner. */
  box: InPageRect
  status: 'analyzed' | 'unreadable' | 'static' | 'failed' | 'time'
  /** Why it was not analyzed: 'cross-origin', 'too-large', 'did-not-play'… */
  reason?: string | undefined
  /** The image's or video's address, cut to 200 characters. */
  url?: string | undefined
  /** 'image/gif', 'image/png' (APNG), 'image/webp'. */
  format?: string | undefined
  frames?: number | undefined
  durationMs?: number | undefined
  stepMs?: number | undefined
  /** An image analyzed while looping. */
  loop?: boolean | undefined
  /** Video: frames the sampling missed (the browser presented them while the probe was busy). */
  gaps?: number | undefined
  /** CSS px per cell. */
  cell?: { width: number; height: number } | undefined
  general?: FlashMeasure | undefined
  red?: FlashMeasure | undefined
  /** A video with controls, read at the size full screen would show it in a 1024 × 768 window. */
  fullScreen?: { width: number; height: number; general: FlashMeasure; red: FlashMeasure } | undefined
}

export interface FlashData {
  viewport: { width: number; height: number }
  /** The definitions the analysis applied (pixels/flash.ts). */
  definitions: { luminanceDelta: number; darkerBelow: number; redRatio: number; chromaDelta: number; windowMs: number; transitions: number; field: { width: number; height: number } }
  found: {
    /** Running CSS animations and transitions, canvases and animated SVGs when the probe started. */
    animations: number
    canvases: number
    svgs: number
    videos: number
    /** Images read (img elements and CSS backgrounds), and those that are animated. */
    images: number
    animated: number
    /** Canvases and animations below the windows captured. */
    below: number
  }
  sources: FlashSource[]
  end: 'complete' | 'time'
}

interface Found {
  animations: InPageRect[]
  animationCount: number
  canvases: InPageRect[]
  svgs: InPageRect[]
  videos: Array<{ key: string; el: InPageElement; box: InPageRect; url: string; controls: boolean; width: number; height: number }>
  images: Array<{ key: string; el: InPageElement; box: InPageRect; url: string }>
  page: { width: number; height: number }
}

interface VideoState {
  key: string
  done: boolean
  error?: string | undefined
  frames: Array<{ t: number; n: number; rgb: string }>
}

interface FlashKit {
  inventory(max: number): Found
  scroll(y: number): { x: number; y: number }
  freeze(): number
  seek(t: number): void
  pauseVideos(): void
  hit(point: { x: number; y: number }): InPageElement | null
  sample(arg: { items: Array<{ key: string; cols: number; rows: number }>; spanMs: number }): void
  status(): Array<{ key: string; done: boolean }>
  take(key: string): VideoState | null
}

/** Installs `window.__rampaFlash`; needs the kit. Serialized by Playwright: references nothing outside its body. */
export function installFlashKit(): void {
  const w = window as unknown as { __rampaKit: Kit; __rampaFlash?: FlashKit }
  if (w.__rampaFlash) return
  const kit = w.__rampaKit
  const docBox = (el: Element): InPageRect => {
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.left + window.scrollX), y: Math.round(r.top + window.scrollY), width: Math.round(r.width), height: Math.round(r.height) }
  }
  const shown = (el: Element): boolean => {
    if (typeof el.checkVisibility === 'function' && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true } as CheckVisibilityOptions)) return false
    const r = el.getBoundingClientRect()
    return r.width >= 8 && r.height >= 8
  }
  const keyed = new Map<string, Element>()
  let next = 0
  const frozen = new Map<Animation, { base: number; at: number }>()
  const svgBase = new Map<SVGSVGElement, number>()
  let now = 0
  const videos = new Map<string, VideoState>()

  const inventory: FlashKit['inventory'] = (max) => {
    const found: Found = { animations: [], animationCount: 0, canvases: [], svgs: [], videos: [], images: [], page: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight } }
    for (const animation of document.getAnimations()) {
      if (animation.playState !== 'running') continue
      found.animationCount++
      const target = (animation.effect as KeyframeEffect | null)?.target
      if (target && found.animations.length < 200 && shown(target)) found.animations.push(docBox(target))
    }
    for (const canvas of Array.from(document.querySelectorAll('canvas'))) if (shown(canvas)) found.canvases.push(docBox(canvas))
    for (const svg of Array.from(document.querySelectorAll('svg'))) {
      if (svg.querySelector('animate, animateTransform, animateMotion, set') && shown(svg)) found.svgs.push(docBox(svg))
    }
    for (const video of Array.from(document.querySelectorAll('video'))) {
      if (!shown(video) || !video.currentSrc) continue
      const key = `v${next++}`
      keyed.set(key, video)
      found.videos.push({ key, el: kit.describe(video), box: docBox(video), url: video.currentSrc.slice(0, 2000), controls: video.controls, width: video.videoWidth, height: video.videoHeight })
    }
    const urls = (value: string) => Array.from(value.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/g)).map((m) => m[2] ?? '')
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      if (found.images.length >= max) break
      let url = ''
      if (el instanceof HTMLImageElement) url = el.currentSrc || el.src
      else {
        const background = getComputedStyle(el).backgroundImage
        if (background && background !== 'none') url = urls(background).find((u) => !/^data:image\/svg/i.test(u)) ?? ''
      }
      if (!url || /\.svg(\?|#|$)/i.test(url) || /^data:image\/svg/i.test(url) || !shown(el)) continue
      const key = `i${next++}`
      keyed.set(key, el)
      found.images.push({ key, el: kit.describe(el), box: docBox(el), url: new URL(url, document.baseURI).href })
    }
    return found
  }

  const scroll: FlashKit['scroll'] = (y) => {
    window.scrollTo({ left: 0, top: y, behavior: 'instant' as ScrollBehavior })
    return { x: Math.round(window.scrollX), y: Math.round(window.scrollY) }
  }

  /** Pauses what runs on its own clock (CSS and SVG animations), from this instant: seek() then moves it. */
  const freeze: FlashKit['freeze'] = () => {
    now = 0
    let count = 0
    for (const animation of document.getAnimations()) {
      const ours = frozen.has(animation)
      if (!ours && animation.playState !== 'running') continue
      if (!ours) animation.pause()
      frozen.set(animation, { base: Number(animation.currentTime ?? 0), at: 0 })
      count++
    }
    for (const svg of Array.from(document.querySelectorAll('svg'))) {
      if (!svg.querySelector('animate, animateTransform, animateMotion, set')) continue
      svg.pauseAnimations()
      svgBase.set(svg, svg.getCurrentTime())
      count++
    }
    return count
  }

  const seek: FlashKit['seek'] = (t) => {
    now = t
    // Animations a script started since: paused where they are, and moved with the rest from now on.
    for (const animation of document.getAnimations()) {
      if (frozen.has(animation) || animation.playState !== 'running') continue
      animation.pause()
      frozen.set(animation, { base: Number(animation.currentTime ?? 0), at: now })
    }
    for (const [animation, { base, at }] of frozen) {
      try {
        animation.currentTime = base + (now - at)
      } catch {
        // An animation that was cancelled meanwhile.
      }
    }
    for (const [svg, base] of svgBase) svg.setCurrentTime(base + now / 1000)
  }

  const pauseVideos: FlashKit['pauseVideos'] = () => {
    for (const video of Array.from(document.querySelectorAll('video'))) {
      video.muted = true
      video.pause()
    }
  }

  const hit: FlashKit['hit'] = ({ x, y }) => {
    let el = document.elementFromPoint(x, y)
    while (el?.shadowRoot) {
      const inner: Element | null = el.shadowRoot.elementFromPoint(x, y)
      if (!inner || inner === el) break
      el = inner
    }
    return el && el !== document.documentElement ? kit.describe(el) : null
  }

  const base64 = (bytes: Uint8Array): string => {
    let text = ''
    for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192))
    return btoa(text)
  }

  const sample: FlashKit['sample'] = ({ items, spanMs }) => {
    for (const { key, cols, rows } of items) {
      const video = keyed.get(key) as HTMLVideoElement | undefined
      const state: VideoState = { key, done: false, frames: [] }
      videos.set(key, state)
      if (!video || typeof video.requestVideoFrameCallback !== 'function') {
        state.error = 'no-frame-callback'
        state.done = true
        continue
      }
      const canvas = document.createElement('canvas')
      canvas.width = cols
      canvas.height = rows
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) {
        state.error = 'no-canvas'
        state.done = true
        continue
      }
      context.imageSmoothingQuality = 'high'
      let start: number | null = null
      const step = (_now: number, meta: VideoFrameCallbackMetadata) => {
        if (state.done) return
        let data: Uint8ClampedArray
        try {
          context.drawImage(video, 0, 0, cols, rows)
          data = context.getImageData(0, 0, cols, rows).data
        } catch (error) {
          state.error = error instanceof DOMException && error.name === 'SecurityError' ? 'cross-origin' : 'unreadable'
          state.done = true
          return
        }
        const rgb = new Uint8Array(cols * rows * 3)
        for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
          rgb[j] = data[i] ?? 0
          rgb[j + 1] = data[i + 1] ?? 0
          rgb[j + 2] = data[i + 2] ?? 0
        }
        if (start === null) start = meta.mediaTime
        const t = (meta.mediaTime - start) * 1000
        state.frames.push({ t, n: meta.presentedFrames, rgb: base64(rgb) })
        if (t >= spanMs || state.frames.length >= 400) {
          state.done = true
          return
        }
        video.requestVideoFrameCallback(step)
      }
      video.addEventListener('ended', () => {
        state.done = true
      }, { once: true })
      // Never with sound: muted before it plays, and never unmuted.
      video.muted = true
      video.requestVideoFrameCallback(step)
      video.play().catch(() => {
        if (state.frames.length === 0) state.error = 'did-not-play'
        state.done = true
      })
    }
  }

  const status: FlashKit['status'] = () => [...videos.values()].map((v) => ({ key: v.key, done: v.done }))
  const take: FlashKit['take'] = (key) => {
    const state = videos.get(key)
    const video = keyed.get(key) as HTMLVideoElement | undefined
    if (video) {
      video.muted = true
      video.pause()
    }
    if (state) state.done = true
    return state ?? null
  }

  w.__rampaFlash = { inventory, scroll, freeze, seek, pauseVideos, hit, sample, status, take }
}

const flash = (page: Page) => ({
  call: <K extends keyof FlashKit>(name: K, arg: Parameters<FlashKit[K]>[0]) =>
    page.evaluate(({ name, arg }) => ((window as unknown as { __rampaFlash: Record<string, (a: unknown) => unknown> }).__rampaFlash[name] as (a: unknown) => unknown)(arg), { name, arg }) as Promise<ReturnType<FlashKit[K]>>,
})

/** A grid for content shown at `width` × `height` CSS px: cells of 4 px, or larger for large content. */
function gridFor(width: number, height: number): { cols: number; rows: number; cellWidth: number; cellHeight: number } {
  const cell = Math.max(4, Math.ceil(Math.max(width, height) / MAX_CELLS))
  const cols = Math.max(1, Math.round(width / cell))
  const rows = Math.max(1, Math.round(height / cell))
  return { cols, rows, cellWidth: width / cols, cellHeight: height / rows }
}

/** Which formats may hold several frames: GIF with more than one graphic control block, PNG with acTL, WebP with ANIM. */
export function animatedFormat(bytes: Uint8Array): string | undefined {
  const ascii = (at: number, length: number) => String.fromCharCode(...bytes.subarray(at, at + length))
  if (ascii(0, 4) === 'GIF8') {
    let blocks = 0
    for (let i = 0; i + 2 < bytes.length && blocks < 2; i++) if (bytes[i] === 0x21 && bytes[i + 1] === 0xf9 && bytes[i + 2] === 0x04) blocks++
    return blocks >= 2 ? 'image/gif' : undefined
  }
  if (bytes[0] === 0x89 && ascii(1, 3) === 'PNG') {
    // Chunks: length, type, data, CRC. acTL comes before the first IDAT in an animated PNG.
    for (let i = 8; i + 8 <= bytes.length; ) {
      const length = (((bytes[i] ?? 0) << 24) | ((bytes[i + 1] ?? 0) << 16) | ((bytes[i + 2] ?? 0) << 8) | (bytes[i + 3] ?? 0)) >>> 0
      const type = ascii(i + 4, 4)
      if (type === 'acTL') return 'image/png'
      if (type === 'IDAT') return undefined
      i += 12 + length
    }
    return undefined
  }
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    for (let i = 12; i + 4 <= Math.min(bytes.length, 4096); i++) if (ascii(i, 4) === 'ANIM') return 'image/webp'
  }
  return undefined
}

/** Runs in the decoder page: every frame of an animated image, scaled to a grid, with its duration. */
export async function decodeFramesInPage(arg: { b64: string; type: string; cols: number; rows: number; maxFrames: number }): Promise<{ frames: Array<{ d: number; rgb: string }>; repetition: number; error?: string }> {
  const data = Uint8Array.from(atob(arg.b64), (c) => c.charCodeAt(0))
  if (typeof ImageDecoder === 'undefined' || !(await ImageDecoder.isTypeSupported(arg.type))) return { frames: [], repetition: 0, error: 'no-decoder' }
  const decoder = new ImageDecoder({ data, type: arg.type })
  try {
    await decoder.tracks.ready
    await decoder.completed
    const track = decoder.tracks.selectedTrack
    if (!track) return { frames: [], repetition: 0, error: 'no-track' }
    const canvas = new OffscreenCanvas(arg.cols, arg.rows)
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return { frames: [], repetition: 0, error: 'no-canvas' }
    context.imageSmoothingQuality = 'high'
    const frames: Array<{ d: number; rgb: string }> = []
    for (let i = 0; i < Math.min(track.frameCount, arg.maxFrames); i++) {
      const { image } = await decoder.decode({ frameIndex: i })
      context.clearRect(0, 0, arg.cols, arg.rows)
      context.drawImage(image, 0, 0, arg.cols, arg.rows)
      const pixels = context.getImageData(0, 0, arg.cols, arg.rows).data
      const rgb = new Uint8Array(arg.cols * arg.rows * 3)
      for (let p = 0, j = 0; p < pixels.length; p += 4, j += 3) {
        // Transparent pixels show the page behind: white is the usual page.
        const a = (pixels[p + 3] ?? 255) / 255
        rgb[j] = Math.round((pixels[p] ?? 0) * a + 255 * (1 - a))
        rgb[j + 1] = Math.round((pixels[p + 1] ?? 0) * a + 255 * (1 - a))
        rgb[j + 2] = Math.round((pixels[p + 2] ?? 0) * a + 255 * (1 - a))
      }
      let text = ''
      for (let k = 0; k < rgb.length; k += 8192) text += String.fromCharCode(...rgb.subarray(k, k + 8192))
      frames.push({ d: (image.duration ?? 0) / 1000, rgb: btoa(text) })
      image.close()
    }
    const repetition = track.repetitionCount
    return { frames, repetition: Number.isFinite(repetition) ? repetition : -1 }
  } catch (error) {
    return { frames: [], repetition: 0, error: error instanceof Error ? error.name : 'decode-failed' }
  } finally {
    decoder.close()
  }
}

const fromBase64 = (value: string) => new Uint8Array(Buffer.from(value, 'base64'))

/** A page in a context of its own, on an https address answered locally: ImageDecoder needs a secure context. */
export async function decoderPage(browser: Browser): Promise<{ page: Page; context: BrowserContext }> {
  const context = await browser.newContext()
  await context.route('**/*', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>decoder</title>' }))
  const page = await context.newPage()
  await page.goto('https://rampa-decoder.invalid/')
  return { page, context }
}

export async function imageBytes(context: BrowserContext, url: string, pageUrl: string, browserOptions: BrowserOptions | undefined): Promise<Uint8Array | string> {
  if (url.startsWith('data:')) {
    const comma = url.indexOf(',')
    const meta = url.slice(5, comma)
    const body = url.slice(comma + 1)
    return meta.endsWith(';base64') ? fromBase64(body) : new TextEncoder().encode(decodeURIComponent(body))
  }
  if (url.startsWith('file:')) {
    // Only next to a page that is itself a file, as the browser would load it.
    if (!pageUrl.startsWith('file:')) return 'not-fetched'
    const bytes = await readFile(fileURLToPath(url)).catch(() => undefined)
    return bytes ? (bytes.length > MAX_IMAGE_BYTES ? 'too-large' : new Uint8Array(bytes)) : 'not-fetched'
  }
  if (!/^https?:/i.test(url)) return 'not-fetched'
  // This GET goes around the guard's route, so its rule is kept here: an address that names a destructive action is not fetched.
  if (destructiveAddress(url)) return 'not-fetched'
  // The same GET the page made: the context's cookies, and --header only for the site being checked, as for the page.
  let headers: Record<string, string> | undefined
  try {
    headers = headersFor(url, [new URL(pageUrl)], browserOptions)
  } catch {
    headers = undefined
  }
  const response = await context.request.get(url, { timeout: 5000, maxRedirects: 3, failOnStatusCode: false, ...(headers ? { headers } : {}) }).catch(() => undefined)
  if (!response || !response.ok()) return 'not-fetched'
  const length = Number(response.headers()['content-length'] ?? 0)
  if (length > MAX_IMAGE_BYTES) return 'too-large'
  const body = await response.body().catch(() => undefined)
  if (!body) return 'not-fetched'
  return body.length > MAX_IMAGE_BYTES ? 'too-large' : new Uint8Array(body)
}

/** The frames of an animated image on its own timeline, repeated while it loops, up to IMAGE_SPAN_MS. */
function imageTimeline(decoded: Array<{ d: number; rgb: string }>, repetition: number): { frames: FlashFrame[]; loop: boolean; once: number } {
  const durations = decoded.map((f) => (f.d <= 10 ? 100 : f.d))
  const once = durations.reduce((a, b) => a + b, 0)
  const loop = repetition !== 0 && once > 0
  const span = loop ? Math.min(IMAGE_SPAN_MS, Math.max(2 * once, 2000)) : once
  const grids = decoded.map((f) => fromBase64(f.rgb))
  const frames: FlashFrame[] = []
  let t = 0
  for (let pass = 0; frames.length < 2000; pass++) {
    for (let i = 0; i < grids.length; i++) {
      frames.push({ t, rgb: grids[i] as Uint8Array })
      t += durations[i] ?? 100
    }
    if (!loop || t >= span || (repetition > 0 && pass >= repetition)) break
  }
  // The last frame stays on screen for its duration: a closing frame marks when it ends.
  const last = frames[frames.length - 1]
  if (last) frames.push({ t, rgb: last.rgb })
  return { frames, loop, once }
}

const round = (value: number) => Math.round(value * 10) / 10

async function analyzeImages(browser: Browser, probeContext: BrowserContext, pageUrl: string, browserOptions: BrowserOptions | undefined, found: Found, deadline: number, sources: FlashSource[]): Promise<{ animated: number; boxes: InPageRect[]; read: number }> {
  let decoder: { page: Page; context: BrowserContext } | undefined
  const boxes: InPageRect[] = []
  let animated = 0
  let read = 0
  const bytesOf = new Map<string, Promise<Uint8Array | string>>()
  try {
    for (const image of found.images) {
      if (Date.now() > deadline) break
      if (!bytesOf.has(image.url)) bytesOf.set(image.url, imageBytes(probeContext, image.url, pageUrl, browserOptions).catch(() => 'not-fetched'))
      const bytes = await (bytesOf.get(image.url) as Promise<Uint8Array | string>)
      read++
      const source: FlashSource = { kind: 'image', el: image.el, box: image.box, url: image.url.slice(0, 200), status: 'failed' }
      if (typeof bytes === 'string') {
        // An image the probe could not read again: it may be animated, so it says so.
        if (bytes !== 'not-fetched') sources.push({ ...source, status: 'unreadable', reason: bytes })
        else if (/\.(gif|webp|apng)(\?|#|$)/i.test(image.url)) sources.push({ ...source, status: 'unreadable', reason: 'not-fetched' })
        continue
      }
      const format = animatedFormat(bytes)
      if (!format) continue
      if (sources.filter((s) => s.kind === 'image').length >= MAX_IMAGES) {
        sources.push({ ...source, format, status: 'time', reason: 'limit' })
        continue
      }
      decoder ??= await decoderPage(browser)
      const grid = gridFor(image.box.width, image.box.height)
      const decoded = await decoder.page.evaluate(decodeFramesInPage, { b64: Buffer.from(bytes).toString('base64'), type: format, cols: grid.cols, rows: grid.rows, maxFrames: MAX_IMAGE_FRAMES })
      if (decoded.error || decoded.frames.length === 0) {
        sources.push({ ...source, format, status: 'unreadable', reason: decoded.error ?? 'no-frames' })
        continue
      }
      if (decoded.frames.length < 2) continue
      animated++
      boxes.push(image.box)
      const timeline = imageTimeline(decoded.frames, decoded.repetition)
      const analysis = analyzeFlashes(grid, timeline.frames, { exact: true })
      sources.push({
        ...source,
        format,
        status: 'analyzed',
        frames: decoded.frames.length,
        durationMs: Math.round(timeline.once),
        stepMs: analysis.stepMs,
        loop: timeline.loop,
        cell: { width: round(grid.cellWidth), height: round(grid.cellHeight) },
        general: analysis.general,
        red: analysis.red,
      })
    }
  } finally {
    await decoder?.context.close().catch(() => undefined)
  }
  return { animated, boxes, read }
}

async function analyzeVideos(page: Page, found: Found, deadline: number, sources: FlashSource[]): Promise<void> {
  const videos = found.videos.slice(0, MAX_VIDEOS)
  if (videos.length === 0) return
  const kit = flash(page)
  const grids = new Map(videos.map((v) => [v.key, gridFor(v.box.width, v.box.height)]))
  await kit.call('sample', { items: videos.map((v) => ({ key: v.key, cols: grids.get(v.key)?.cols ?? 1, rows: grids.get(v.key)?.rows ?? 1 })), spanMs: VIDEO_SPAN_MS })
  // Until every video gave its frames (or ended, or failed), within a cap of real time.
  const cap = Math.min(deadline, Date.now() + VIDEO_WAIT_MS)
  while (Date.now() < cap) {
    const status = await kit.call('status', undefined as never)
    if (status.every((s) => s.done)) break
    await page.waitForTimeout(200)
  }
  for (const video of videos) {
    const state = await kit.call('take', video.key)
    const grid = grids.get(video.key) as ReturnType<typeof gridFor>
    const source: FlashSource = { kind: 'video', el: video.el, box: video.box, url: video.url.slice(0, 200), status: 'failed' }
    if (!state || (state.error && state.frames.length < 3)) {
      sources.push({ ...source, status: 'unreadable', reason: state?.error ?? 'no-frames' })
      continue
    }
    if (state.frames.length < 3) {
      sources.push({ ...source, status: 'unreadable', reason: 'no-frames' })
      continue
    }
    const frames: FlashFrame[] = state.frames.map((f) => ({ t: f.t, rgb: fromBase64(f.rgb) }))
    let gaps = 0
    for (let i = 1; i < state.frames.length; i++) gaps += Math.max(0, (state.frames[i]?.n ?? 0) - (state.frames[i - 1]?.n ?? 0) - 1)
    const analysis = analyzeFlashes(grid, frames)
    const out: FlashSource = { ...source, status: 'analyzed', frames: frames.length, durationMs: analysis.durationMs, stepMs: analysis.stepMs, gaps, cell: { width: round(grid.cellWidth), height: round(grid.cellHeight) }, general: analysis.general, red: analysis.red }
    if (video.controls && video.width > 0 && video.height > 0) {
      // Full screen fits the picture to the screen: the same frames, with larger cells.
      const scale = Math.min(FLASH_VIEWPORT.width / video.width, FLASH_VIEWPORT.height / video.height)
      const width = Math.round(video.width * scale)
      const height = Math.round(video.height * scale)
      if (width > video.box.width * 1.1) {
        const big = analyzeFlashes({ ...grid, cellWidth: width / grid.cols, cellHeight: height / grid.rows }, frames)
        out.fullScreen = { width, height, general: big.general, red: big.red }
      }
    }
    sources.push(out)
  }
}

/** Cells of a window capture covered by a box (viewport coordinates), for the mask. */
function maskOf(boxes: readonly InPageRect[], scroll: { x: number; y: number }, cols: number, rows: number): Uint8Array {
  const mask = new Uint8Array(cols * rows)
  for (const box of boxes) {
    const x0 = Math.max(0, Math.floor((box.x - scroll.x) / SCREEN_CELL))
    const y0 = Math.max(0, Math.floor((box.y - scroll.y) / SCREEN_CELL))
    const x1 = Math.min(cols, Math.ceil((box.x - scroll.x + box.width) / SCREEN_CELL))
    const y1 = Math.min(rows, Math.ceil((box.y - scroll.y + box.height) / SCREEN_CELL))
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) mask[y * cols + x] = 1
  }
  return mask
}

/**
 * The windows to capture: the top of the page, then windows for canvases and animations below it. Content is covered
 * by a window that shows half of it, or as much of it as would fail (a quarter of the 341 × 256 field).
 */
function scenesFor(found: Found, viewport: { width: number; height: number }): { scenes: number[]; below: number } {
  const scenes = [0]
  const maxY = Math.max(0, found.page.height - viewport.height)
  const moving = [...found.canvases, ...found.animations, ...found.svgs].sort((a, b) => a.y - b.y)
  const shown = (box: InPageRect, y: number) => {
    const height = Math.max(0, Math.min(box.y + box.height, y + viewport.height) - Math.max(box.y, y))
    const width = Math.max(0, Math.min(box.x + box.width, viewport.width) - Math.max(box.x, 0))
    return width * height >= Math.min(0.5 * box.width * box.height, FLASH_AREA_LIMIT)
  }
  let below = 0
  for (const box of moving) {
    if (box.width < 1 || box.height < 1 || scenes.some((y) => shown(box, y))) continue
    const y = Math.min(maxY, Math.max(0, Math.round(box.y - 64)))
    if (scenes.length >= SCENE_MS.length || scenes.some((other) => Math.abs(other - y) < viewport.height / 2)) {
      below++
      continue
    }
    scenes.push(y)
  }
  return { scenes, below }
}

async function captureScenes(page: Page, context: BrowserContext, found: Found, masked: readonly InPageRect[], deadline: number, sources: FlashSource[]): Promise<boolean> {
  const kit = flash(page)
  const viewport = page.viewportSize() ?? FLASH_VIEWPORT
  const { scenes } = scenesFor(found, viewport)
  await kit.call('pauseVideos', undefined as never)
  const cdp = await context.newCDPSession(page)
  let timedOut = false
  try {
    // From here on the page's time moves only when the probe moves it. Pausing a moment ahead of the page's own
    // time: the clock refuses to go back, and on a slow machine the page's time moves on while the call travels.
    const pageNow = await page.evaluate(() => Date.now())
    await page.clock.pauseAt(pageNow + 1000).catch(() => page.clock.pauseAt(Date.now() + 5000))
    for (let s = 0; s < scenes.length; s++) {
      if (Date.now() > deadline) {
        timedOut = true
        break
      }
      const scroll = await kit.call('scroll', scenes[s] ?? 0)
      // Let the page answer the scroll (lazy content, sticky headers) in its own time.
      await page.clock.runFor(200)
      await kit.call('freeze', undefined as never)
      const cols = Math.ceil(viewport.width / SCREEN_CELL)
      const rows = Math.ceil(viewport.height / SCREEN_CELL)
      const frames: FlashFrame[] = []
      const span = SCENE_MS[s] ?? 2000
      let partial = false
      for (let t = 0; t <= span; t += STEP_MS) {
        if (Date.now() > deadline) {
          partial = true
          timedOut = true
          break
        }
        await kit.call('seek', t)
        const shot = (await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: scroll.x, y: scroll.y, width: viewport.width, height: viewport.height, scale: 1 / SCREEN_CELL }, captureBeyondViewport: false })) as { data: string }
        const image = tryDecodePng(Buffer.from(shot.data, 'base64'))
        if (image) {
          const rgb = new Uint8Array(cols * rows * 3)
          for (let y = 0; y < Math.min(rows, image.height); y++) {
            for (let x = 0; x < Math.min(cols, image.width); x++) {
              const i = (y * image.width + x) * 4
              const j = (y * cols + x) * 3
              rgb[j] = image.data[i] ?? 0
              rgb[j + 1] = image.data[i + 1] ?? 0
              rgb[j + 2] = image.data[i + 2] ?? 0
            }
          }
          frames.push({ t, rgb })
        }
        await page.clock.runFor(STEP_MS)
      }
      const grid: FlashGrid = { cols, rows, cellWidth: SCREEN_CELL, cellHeight: SCREEN_CELL, mask: maskOf(masked, scroll, cols, rows) }
      const analysis = analyzeFlashes(grid, frames)
      const middle = async (m: FlashMeasure) => (m.box ? ((await kit.call('hit', { x: m.box.x + m.box.width / 2, y: m.box.y + m.box.height / 2 }).catch(() => null)) ?? undefined) : undefined)
      const at = { general: await middle(analysis.general), red: await middle(analysis.red) }
      const toPage = (m: FlashMeasure): FlashMeasure => (m.box ? { ...m, box: { ...m.box, x: m.box.x + scroll.x, y: m.box.y + scroll.y } } : m)
      sources.push({
        kind: 'screen',
        ...(at.general || at.red ? { at } : {}),
        box: { x: scroll.x, y: scroll.y, width: viewport.width, height: viewport.height },
        status: partial && frames.length < 3 ? 'time' : 'analyzed',
        ...(partial ? { reason: 'time' } : {}),
        frames: analysis.frames,
        durationMs: analysis.durationMs,
        stepMs: analysis.stepMs,
        cell: { width: SCREEN_CELL, height: SCREEN_CELL },
        general: toPage(analysis.general),
        red: toPage(analysis.red),
      })
    }
  } finally {
    await cdp.detach().catch(() => undefined)
  }
  return timedOut
}

export async function runFlashProbe(browser: Browser, url: string, options: ProbeOptions): Promise<ProbeRecord> {
  const started = Date.now()
  const deadline = started + TIME_BUDGET_MS
  const probe = await openProbePage(browser, url, options, { viewport: FLASH_VIEWPORT, desktop: true, variant: FLASH_VARIANT, clock: true })
  try {
    const page = probe.page
    const viewport = page.viewportSize() ?? FLASH_VIEWPORT
    await page.evaluate(installFlashKit)
    const kit = flash(page)
    const found = await kit.call('inventory', 60)
    const sources: FlashSource[] = []
    const images = await analyzeImages(browser, probe.context, url, options.browserOptions, found, deadline, sources)
    await analyzeVideos(page, found, deadline, sources)
    const masked = [...images.boxes, ...found.videos.map((v) => v.box)]
    const timedOut = await captureScenes(page, probe.context, found, masked, deadline, sources)
    const data: FlashData = {
      viewport,
      definitions: { luminanceDelta: FLASH.luminanceDelta, darkerBelow: FLASH.darkerBelow, redRatio: FLASH.redRatio, chromaDelta: FLASH.chromaDelta, windowMs: FLASH.windowMs, transitions: FLASH.transitions, field: { ...FLASH.field } },
      found: { animations: found.animationCount, canvases: found.canvases.length, svgs: found.svgs.length, videos: found.videos.length, images: images.read, animated: images.animated, below: scenesFor(found, viewport).below },
      sources,
      end: timedOut ? 'time' : 'complete',
    }
    return {
      kind: 'flash',
      version: FLASH_VERSION,
      conditions: { ...probe.conditions, viewport },
      status: timedOut ? 'partial' : 'complete',
      ...(timedOut ? { reason: `time budget reached (${TIME_BUDGET_MS / 1000} s)` } : {}),
      guard: probe.guard.log,
      durationMs: Date.now() - started,
      data,
    }
  } finally {
    await probe.context.close()
  }
}

/** The flash probe as a step of the probe stage; a probe that fails leaves a skipped record. */
export async function flashProbe(browser: Browser, url: string, options: ProbeOptions): Promise<ProbeRecord[]> {
  const started = Date.now()
  try {
    return [await runFlashProbe(browser, url, options)]
  } catch (error) {
    return [skippedRecord('flash', FLASH_VERSION, FLASH_VARIANT, `probe failed: ${(error instanceof Error ? error.message : String(error)).split('\n')[0]}`, Date.now() - started)]
  }
}
