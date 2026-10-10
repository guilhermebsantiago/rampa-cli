import type { Browser, Page } from 'playwright-core'
import type { ProbeRecord } from '../snapshot/schema.ts'
import type { InPageElement, InPageIdentity, Kit } from './kit.ts'
import { type ProbeOptions, openProbePage, skippedRecord } from './page.ts'

/**
 * Audio and video (1.2.1–1.2.5, 1.4.2). Hooks installed before the page's own scripts watch what plays on load:
 * every media element that starts playing, `new Audio()` objects played from script, and Web Audio graphs that
 * reach the speakers. While something plays with its sound on, its level is read from a copy of its stream
 * (`captureStream`, then an analyser), never from the speakers: the browser's output is muted in headless mode,
 * and the probe never unmutes anything. After that watch, every audio and video element of the page, its open
 * shadow roots and its same-origin frames is listed; those that show and are not playing are played muted for a
 * few seconds, to learn their duration, whether they have an audio track and how loud it is, and their text
 * tracks are made to load (mode `hidden`) to count their cues. Then everything is put back. Observe class: the
 * probe plays media muted and reads it; it never clicks, and the network guard is on.
 *
 * The rules (src/rules/media.ts) turn these facts into findings: a captions track that fails to load or holds no
 * cues (1.2.2), audio that plays on its own for more than 3 s with no way to stop it (1.4.2), and items to review
 * for the rest, listing what was found.
 */

export const MEDIA_VERSION = '1'
/** Sound above this level (dBFS) counts as audible. */
export const AUDIBLE_DB = -50
/** How long the probe watches the page after it starts loading, at least, for audio that plays on its own. */
const WATCH_MS = 4500
/** Audio playing with sound is watched until it has played this long, or stopped. */
const WATCH_PLAYED_MS = 3600
const WATCH_CAP_MS = 12_000
/** How long media that is not playing is played, muted, to read it. */
const SAMPLE_MS = 2500
const MAX_SAMPLED = 12
const MAX_ITEMS = 60
const MAX_SIGNALS = 3

/** A text track of a media element, made to load by the probe. */
export interface MediaTrack {
  /** captions, subtitles, descriptions, chapters or metadata. */
  kind: string
  label: string
  srclang: string
  src: string
  default: boolean
  /** The track element's readyState after the sample: none, loading, loaded or error (it failed to load). */
  state: 'none' | 'loading' | 'loaded' | 'error'
  cues: number | null
  /** The first cue's text, cut to 80 characters. */
  first?: string | undefined
}

/** Text near a media element, or anywhere on the page, that names a transcript or an audio description. */
export interface MediaSignal {
  ref: string
  id: InPageIdentity
  tag: string
  text: string
  /** Inside the media element's own container, or referenced by its aria-describedby or aria-details. */
  near: boolean
}

/** A showing, named control that may pause, stop, mute or turn down the sound. */
export interface MediaControl {
  ref: string
  id: InPageIdentity
  tag: string
  label: string
  /** play-pause: play, pause or stop; mute: mute, sound or audio; volume: a volume slider. */
  kind: 'play-pause' | 'mute' | 'volume'
  near: boolean
}

/** What played on its own, with its sound on, while the probe watched the page load. */
export interface AutoplayFact {
  /** It played with its sound on (not muted, volume above 0) while the probe pressed nothing. */
  started: boolean
  /** It has `autoplay`, its sound on, and never started: the browser's autoplay policy (or a load error) stopped it. */
  blocked: boolean
  /** Milliseconds after the page started loading. */
  at: number | null
  /** Media time it played with its sound on during the watch, in ms. */
  playedMs: number
  /**
   * Of that, how long it sounded: from the first to the last moment above the audible level (pauses between words
   * count). Null when the level could not be read (media from another origin), 0 when nothing was audible.
   */
  audibleMs: number | null
  /** Its loudest level in dBFS; null when not read. */
  peakDb: number | null
  /** The audio decoder ran while it played: it has sound, even when its level could not be read. */
  decoded: boolean
  /** Still playing with its sound on when the watch ended. */
  playing: boolean
  /** It stopped on its own (paused, ended) or the page muted it or turned it down, and when (ms after load). */
  stopped?: { how: 'paused' | 'ended' | 'muted' | 'volume'; at: number } | undefined
  /** How long the watch lasted after it started, in ms. */
  watchedMs: number
  loop: boolean
}

export interface MediaItem extends InPageElement {
  kind: 'video' | 'audio'
  /** The same-origin frame it is in, by ref. */
  frame?: string | undefined
  src: string
  /** Its media comes from another origin: its level cannot be read without CORS. */
  crossOrigin: boolean
  visible: boolean
  box: { width: number; height: number }
  attributes: { autoplay: boolean; loop: boolean; muted: boolean; controls: boolean; preload: string }
  /** What the probe did to read it. */
  sample: 'played' | 'already-playing' | 'not-showing' | 'no-source' | 'error' | 'budget' | 'did-not-start'
  /** Seconds; null when unknown, and for live media. */
  duration: number | null
  /** Its duration is infinite: a live stream. */
  live: boolean
  hasAudio: boolean | null
  hasVideo: boolean | null
  /** The level read from its stream while it played: loudest, how long it sounded (as in AutoplayFact), ms read. */
  level: { peakDb: number; audibleMs: number; sampledMs: number } | null
  error?: string | undefined
  tracks: MediaTrack[]
  autoplay?: AutoplayFact | undefined
  transcript: MediaSignal[]
  description: MediaSignal[]
  /** Showing controls near it, and controls naming it in aria-controls. */
  controls: MediaControl[]
  /** Its aria-label, title or aria-describedby text, cut to 120 characters. */
  name: string
}

/** A frame of another origin, which the probe cannot read; `player` names a known media player's host. */
export interface MediaFrame {
  ref: string
  id: InPageIdentity
  src: string
  host: string
  player: string | null
  visible: boolean
}

/** Web Audio graphs that reached the speakers during the watch. */
export interface WebAudioFact {
  contexts: number
  running: number
  sources: number
  connected: boolean
  audibleMs: number | null
  peakDb: number | null
  /** A context with sources stayed suspended: the browser's autoplay policy held it. */
  blocked: boolean
}

export interface MediaData {
  items: MediaItem[]
  /** Audio played from script with no element in the page (`new Audio()`). */
  detached: Array<{ src: string; crossOrigin: boolean; autoplay: AutoplayFact }>
  /** Frames of another origin; those of known players first. */
  frames: MediaFrame[]
  webAudio: WebAudioFact
  /** Showing controls anywhere on the page named for pausing, stopping, muting or the volume. */
  pageControls: MediaControl[]
  /** Transcript and audio description signals anywhere on the page. */
  pageTranscript: MediaSignal[]
  pageDescription: MediaSignal[]
  /** The browser's autoplay policy for media elements as the page loaded, where the browser tells it. */
  autoplayPolicy: string | null
  /** How long the watch lasted after the page started loading, and the sample, in ms. */
  watchMs: number
  sampleMs: number
  /** More media than the budgets: listed but not played, or left out. */
  unsampled: number
  omitted: number
}

/** Known players that live in frames of another origin, by host. */
export const PLAYER_HOSTS: ReadonlyArray<[RegExp, string]> = [
  [/(^|\.)(youtube\.com|youtube-nocookie\.com|youtu\.be)$/, 'YouTube'],
  [/(^|\.)vimeo\.com$/, 'Vimeo'],
  [/(^|\.)(dailymotion\.com|dai\.ly)$/, 'Dailymotion'],
  [/(^|\.)(wistia\.com|wistia\.net)$/, 'Wistia'],
  [/(^|\.)brightcove\.(net|com)$/, 'Brightcove'],
  [/(^|\.)(jwplayer\.com|jwplatform\.com|jwpcdn\.com)$/, 'JW Player'],
  [/(^|\.)kaltura\.com$/, 'Kaltura'],
  [/(^|\.)vidyard\.com$/, 'Vidyard'],
  [/(^|\.)loom\.com$/, 'Loom'],
  [/(^|\.)twitch\.tv$/, 'Twitch'],
  [/(^|\.)facebook\.com$/, 'Facebook'],
  [/(^|\.)tiktok\.com$/, 'TikTok'],
  [/(^|\.)streamable\.com$/, 'Streamable'],
  [/(^|\.)ted\.com$/, 'TED'],
  [/(^|\.)globo\.com$/, 'Globo'],
  [/(^|\.)soundcloud\.com$/, 'SoundCloud'],
  [/(^|\.)spotify\.com$/, 'Spotify'],
  [/(^|\.)mixcloud\.com$/, 'Mixcloud'],
  [/(^|\.)deezer\.com$/, 'Deezer'],
  [/(^|\.)podcasts\.apple\.com$/, 'Apple Podcasts'],
  [/(^|\.)bandcamp\.com$/, 'Bandcamp'],
]

/** The player a frame's host belongs to, or null. */
export function playerOf(host: string): string | null {
  const lower = host.toLowerCase()
  for (const [pattern, name] of PLAYER_HOSTS) if (pattern.test(lower)) return name
  return null
}

interface Watch {
  firstAt: number | null
  lastTime: number
  playedMs: number
  /**
   * Sound is timed as a span: from the first to the last moment above the audible level, in media time played, each
   * confirmed by the reading before it (a single loud reading is a glitch). Pauses inside speech count as sound.
   */
  firstLoud: number
  lastLoud: number
  wasLoud: boolean
  peak: number
  /** true: the level is read; false: no audio track in the stream; null: not readable (another origin). */
  measurable: boolean | null
  decodedStart: number
  decoded: boolean
  stopped?: { how: 'paused' | 'ended' | 'muted' | 'volume'; at: number } | undefined
  analyser?: AnalyserNode | undefined
  triedAt: number
  /** The probe played it muted itself: never an autoplay. */
  own: boolean
}

interface ContextWatch {
  sources: number
  connected: boolean
  analyser?: AnalyserNode | undefined
  firstLoud: number
  lastLoud: number
  wasLoud: boolean
  runningMs: number
  peak: number
  suspended: boolean
}

interface MediaHookState {
  start: number
  policy: string | null
  watched: Map<HTMLMediaElement, Watch>
  contexts: Map<BaseAudioContext, ContextWatch>
  own: WeakSet<BaseAudioContext>
  ctx?: AudioContext | undefined
  /** Stops watching sound after this many ms (performance.now). */
  until: number
}

/**
 * Installed before any page script runs, in every frame. It watches what plays: media elements (their events,
 * and `play()` called by script, which catches `new Audio()` objects outside the page), and Web Audio graphs
 * connected to the speakers, which it fans out to an analyser of its own. Every 100 ms it adds up, for each
 * element playing with its sound on, the media time played and the part of it above the audible level.
 * It never changes what plays.
 */
export function installMediaHooks(): void {
  const w = window as unknown as { __rampaMedia?: MediaHookState }
  if (w.__rampaMedia) return
  const nav = navigator as Navigator & { getAutoplayPolicy?: (type: string) => string }
  let policy: string | null = null
  try {
    policy = typeof nav.getAutoplayPolicy === 'function' ? nav.getAutoplayPolicy('mediaelement') : null
  } catch {
    policy = null
  }
  const state: MediaHookState = { start: performance.now(), policy, watched: new Map(), contexts: new Map(), own: new WeakSet(), until: performance.now() + 20_000 }
  w.__rampaMedia = state
  const threshold = 10 ** (-50 / 20)
  const decodedBytes = (el: HTMLMediaElement): number => (el as HTMLMediaElement & { webkitAudioDecodedByteCount?: number }).webkitAudioDecodedByteCount ?? 0
  const watch = (el: HTMLMediaElement) => {
    if (state.watched.has(el)) return
    state.watched.set(el, { firstAt: null, lastTime: el.currentTime, playedMs: 0, firstLoud: -1, lastLoud: -1, wasLoud: false, peak: 0, measurable: null, decodedStart: decodedBytes(el), decoded: false, triedAt: -1, own: false })
  }
  for (const type of ['play', 'playing']) {
    window.addEventListener(
      type,
      (event) => {
        if (event.target instanceof HTMLMediaElement) watch(event.target)
      },
      true,
    )
  }
  const play = HTMLMediaElement.prototype.play
  HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
    watch(this)
    return play.call(this)
  }
  const ownContext = (): AudioContext | undefined => {
    try {
      if (!state.ctx) {
        state.ctx = new AudioContext()
        state.own.add(state.ctx)
      }
      if (state.ctx.state === 'suspended') state.ctx.resume().catch(() => undefined)
      return state.ctx
    } catch {
      return undefined
    }
  }
  const rms = (analyser: AnalyserNode): number => {
    const samples = new Float32Array(analyser.fftSize)
    analyser.getFloatTimeDomainData(samples)
    let sum = 0
    for (const value of samples) sum += value * value
    return Math.sqrt(sum / samples.length)
  }
  // Web Audio: a node connected to the speakers is also connected to an analyser on the same context.
  const contextOf = (ctx: BaseAudioContext): ContextWatch => {
    let info = state.contexts.get(ctx)
    if (!info) {
      info = { sources: 0, connected: false, firstLoud: -1, lastLoud: -1, wasLoud: false, runningMs: 0, peak: 0, suspended: false }
      state.contexts.set(ctx, info)
    }
    return info
  }
  try {
    const connect = AudioNode.prototype.connect as (this: AudioNode, ...args: unknown[]) => unknown
    const disconnect = AudioNode.prototype.disconnect as (this: AudioNode, ...args: unknown[]) => unknown
    ;(AudioNode.prototype as unknown as { connect: unknown }).connect = function (this: AudioNode, ...args: unknown[]) {
      const result = connect.apply(this, args)
      try {
        if (args[0] instanceof AudioDestinationNode && !state.own.has(this.context)) {
          const info = contextOf(this.context)
          info.connected = true
          if (!info.analyser) {
            info.analyser = this.context.createAnalyser()
            info.analyser.fftSize = 2048
          }
          connect.call(this, info.analyser)
        }
      } catch {
        // A graph the analyser cannot join is still the page's to play.
      }
      return result
    }
    ;(AudioNode.prototype as unknown as { disconnect: unknown }).disconnect = function (this: AudioNode, ...args: unknown[]) {
      const result = disconnect.apply(this, args)
      try {
        const info = state.contexts.get(this.context)
        if (args[0] instanceof AudioDestinationNode && info?.analyser) disconnect.call(this, info.analyser)
      } catch {
        // Not connected to the analyser.
      }
      return result
    }
    const start = AudioScheduledSourceNode.prototype.start
    AudioScheduledSourceNode.prototype.start = function (this: AudioScheduledSourceNode, ...args: Parameters<AudioScheduledSourceNode['start']>) {
      try {
        if (!state.own.has(this.context)) contextOf(this.context).sources++
      } catch {
        // Counting only.
      }
      return start.apply(this, args)
    }
  } catch {
    // No Web Audio in this browser.
  }
  let last = performance.now()
  const timer = setInterval(() => {
    const now = performance.now()
    const tick = now - last
    last = now
    if (now > state.until) {
      clearInterval(timer)
      return
    }
    for (const [el, info] of state.watched) {
      if (info.own) continue
      const sounding = !el.muted && el.volume > 0
      if (el.paused || el.ended) {
        if (info.firstAt !== null && !info.stopped) info.stopped = { how: el.ended ? 'ended' : 'paused', at: Math.round(now) }
        info.lastTime = el.currentTime
        continue
      }
      const delta = Math.min(0.6, Math.max(0, el.currentTime - info.lastTime))
      info.lastTime = el.currentTime
      if (!sounding) {
        if (info.firstAt !== null && !info.stopped) info.stopped = { how: el.muted ? 'muted' : 'volume', at: Math.round(now) }
        continue
      }
      if (info.firstAt === null) info.firstAt = Math.round(now)
      if (info.stopped) continue
      info.playedMs += delta * 1000
      if (decodedBytes(el) > info.decodedStart) info.decoded = true
      // The level of a copy of the element's stream; muting or hiding the element would not change it.
      if (!info.analyser && info.measurable !== false && now - info.triedAt > 300 && el.readyState >= 1) {
        info.triedAt = now
        try {
          const stream = (el as HTMLMediaElement & { captureStream(): MediaStream }).captureStream()
          if (stream.getAudioTracks().length === 0) info.measurable = el.readyState >= 2 ? false : null
          else {
            const ctx = ownContext()
            if (ctx) {
              const analyser = ctx.createAnalyser()
              analyser.fftSize = 2048
              ctx.createMediaStreamSource(stream).connect(analyser)
              info.analyser = analyser
              info.measurable = true
            }
          }
        } catch {
          info.measurable = null
        }
      }
      if (info.analyser && state.ctx?.state === 'running' && delta > 0) {
        const level = rms(info.analyser)
        if (level > info.peak) info.peak = level
        const loud = level > threshold
        if (loud && info.wasLoud) {
          if (info.firstLoud < 0) info.firstLoud = info.playedMs - delta * 1000
          info.lastLoud = info.playedMs
        }
        info.wasLoud = loud
      }
    }
    for (const [ctx, info] of state.contexts) {
      if (ctx.state !== 'running') {
        if (ctx.state === 'suspended' && info.sources > 0) info.suspended = true
        continue
      }
      if (!info.connected) continue
      info.runningMs += tick
      if (info.analyser) {
        const level = rms(info.analyser)
        if (level > info.peak) info.peak = level
        const loud = level > threshold
        if (loud && info.wasLoud) {
          if (info.firstLoud < 0) info.firstLoud = info.runningMs - tick
          info.lastLoud = info.runningMs
        }
        info.wasLoud = loud
      }
    }
  }, 100)
}

/** What the watch saw so far, in the page and its same-origin frames. */
interface WatchSummary {
  now: number
  /** Something plays with its sound on and has not played long enough, or an autoplay element is still loading. */
  pending: boolean
}

function readWatch(args: { playedMs: number; runMs: number }): WatchSummary {
  const states: MediaHookState[] = []
  const visit = (win: Window) => {
    try {
      const state = (win as unknown as { __rampaMedia?: MediaHookState }).__rampaMedia
      if (state) states.push(state)
      for (let i = 0; i < win.frames.length; i++) {
        const child = win.frames[i]
        if (child) visit(child)
      }
    } catch {
      // A frame of another origin.
    }
  }
  visit(window)
  let pending = false
  for (const state of states) {
    for (const [el, info] of state.watched) {
      if (info.own || info.stopped || info.firstAt === null) continue
      if (el.paused || el.ended || el.muted || el.volume === 0) continue
      // Long enough to tell more than 3 s, and, when the level is read, long enough for the sound to show it (it may start late).
      const sounded = info.firstLoud < 0 ? 0 : info.lastLoud - info.firstLoud
      if (info.playedMs < args.playedMs || (info.measurable === true && sounded < args.playedMs && info.playedMs < args.playedMs + 3000)) pending = true
    }
    for (const [ctx, info] of state.contexts) if (ctx.state === 'running' && info.connected && info.runningMs < args.runMs) pending = true
  }
  // An element that should start on its own with sound, and is still loading.
  for (const el of Array.from(document.querySelectorAll('video[autoplay], audio[autoplay]')) as HTMLMediaElement[]) {
    if (el.paused && !el.muted && !el.error && el.networkState === 2 && el.readyState < 3) pending = true
  }
  return { now: Math.round(performance.now()), pending }
}

interface CollectArgs {
  maxItems: number
  maxSampled: number
  maxSignals: number
  sampleMs: number
  audibleDb: number
}

interface CollectResult {
  items: MediaItem[]
  detached: MediaData['detached']
  frames: MediaFrame[]
  webAudio: WebAudioFact
  pageControls: MediaControl[]
  pageTranscript: MediaSignal[]
  pageDescription: MediaSignal[]
  policy: string | null
  watchMs: number
  unsampled: number
  omitted: number
}

/**
 * Lists the page's media, reads what the watch saw, plays muted what shows and is not playing, and loads the text
 * tracks. Everything it changes (muted, paused, time, track modes) is put back.
 */
async function collectMedia(args: CollectArgs): Promise<CollectResult> {
  const kit = (window as unknown as { __rampaKit: Kit }).__rampaKit
  const states: MediaHookState[] = []
  const visit = (win: Window) => {
    try {
      const state = (win as unknown as { __rampaMedia?: MediaHookState }).__rampaMedia
      if (state) states.push(state)
      for (let i = 0; i < win.frames.length; i++) {
        const child = win.frames[i]
        if (child) visit(child)
      }
    } catch {
      // A frame of another origin.
    }
  }
  visit(window)
  const watchOf = (el: HTMLMediaElement): Watch | undefined => {
    for (const state of states) {
      const info = state.watched.get(el)
      if (info) return info
    }
    return undefined
  }
  const top = states[0]
  const collapse = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim()
  const cut = (value: string, n: number) => (value.length > n ? `${value.slice(0, n - 1)}…` : value)
  const db = (level: number) => (level > 0 ? Math.round(20 * Math.log10(level) * 10) / 10 : -120)
  const threshold = 10 ** (args.audibleDb / 20)

  // Every media element and frame: the page, its open shadow roots, its same-origin frames.
  const media: Array<{ el: HTMLMediaElement; frame?: string | undefined }> = []
  const frames: MediaFrame[] = []
  let omitted = 0
  const walk = (root: Document | ShadowRoot, frame: string | undefined) => {
    const all = root.querySelectorAll('*')
    for (const el of Array.from(all)) {
      if (el.localName === 'video' || el.localName === 'audio') {
        if (media.length < args.maxItems) media.push({ el: el as HTMLMediaElement, frame })
        else omitted++
      }
      if (el.shadowRoot) walk(el.shadowRoot, frame)
      if (el.localName === 'iframe' || el.localName === 'frame') {
        let doc: Document | null = null
        try {
          doc = (el as HTMLIFrameElement).contentDocument
        } catch {
          doc = null
        }
        if (doc?.documentElement) walk(doc, kit.cssPath(el))
        else {
          const src = (el as HTMLIFrameElement).src || el.getAttribute('src') || ''
          let host = ''
          try {
            host = new URL(src, location.href).hostname
          } catch {
            host = ''
          }
          if (host && /^https?:/i.test(src)) {
            const d = kit.describe(el)
            const r = el.getBoundingClientRect()
            frames.push({ ref: d.ref, id: d.id, src: src.slice(0, 200), host, player: null, visible: kit.visible(el) && r.width > 1 && r.height > 1 })
          }
        }
      }
    }
  }
  walk(document, undefined)

  // Controls and signals, in the page and its same-origin frames.
  const roots: Array<Document | ShadowRoot> = []
  const gather = (root: Document | ShadowRoot) => {
    roots.push(root)
    for (const el of Array.from(root.querySelectorAll('*'))) {
      if (el.shadowRoot) gather(el.shadowRoot)
      if (el.localName === 'iframe' || el.localName === 'frame') {
        try {
          const doc = (el as HTMLIFrameElement).contentDocument
          if (doc?.documentElement) gather(doc)
        } catch {
          // Another origin.
        }
      }
    }
  }
  gather(document)
  const nameOf = (el: Element): string => {
    const labelledby = collapse(el.getAttribute('aria-labelledby'))
    if (labelledby) {
      const doc = el.ownerDocument
      const text = labelledby
        .split(' ')
        .map((id) => collapse(doc.getElementById(id)?.textContent))
        .join(' ')
        .trim()
      if (text) return text
    }
    const own =
      el.getAttribute('aria-label') ||
      (el.localName === 'input' && ['button', 'submit', 'reset'].includes((el as HTMLInputElement).type) ? (el as HTMLInputElement).value : '') ||
      collapse((el as HTMLElement).innerText ?? el.textContent) ||
      el.getAttribute('title') ||
      (el.querySelector('img[alt]') as HTMLImageElement | null)?.alt ||
      collapse(el.querySelector('svg title')?.textContent) ||
      ''
    return collapse(own)
  }
  const shows = (el: Element): boolean => {
    if (el.closest('[aria-hidden="true"], [inert]')) return false
    const r = el.getBoundingClientRect()
    return kit.visible(el) && r.width >= 1 && r.height >= 1
  }
  const PLAY = /\b(play|pause|paused|stop|resume|reproduzir|reproduzindo|pausar|pausa|parar|tocar|retomar|reproducir|detener|reanudar)\b/i
  const MUTE = /\b(mute|unmute|muted|sound|sounds|audio|volume|som|sons|áudio|silenciar|sem som|mudo|sonido|volumen|silencio)\b/i
  const VOLUME = /\b(volume|volumen)\b/i
  const controlKind = (el: Element, name: string): MediaControl['kind'] | undefined => {
    const role = el.getAttribute('role') ?? ''
    if ((el.localName === 'input' && (el as HTMLInputElement).type === 'range') || role === 'slider') return VOLUME.test(name) ? 'volume' : undefined
    if (MUTE.test(name)) return 'mute'
    if (PLAY.test(name)) return 'play-pause'
    return undefined
  }
  const controlCandidates: Array<{ el: Element; label: string; kind: MediaControl['kind'] }> = []
  for (const root of roots) {
    for (const el of Array.from(root.querySelectorAll('button, [role="button"], [role="switch"], [role="checkbox"], [role="slider"], input, summary, a[href]'))) {
      if (el.localName === 'input' && !['button', 'submit', 'image', 'checkbox', 'range'].includes((el as HTMLInputElement).type)) continue
      const label = nameOf(el)
      if (!label || label.length > 80) continue
      const kind = controlKind(el, label)
      if (!kind || !shows(el)) continue
      controlCandidates.push({ el, label: cut(label, 80), kind })
    }
  }
  const TRANSCRIPT = /transcri(pt|ption|ção|cao|ções|pción|pciones|bed)|\btext version\b|vers[aã]o (em|de) texto|versi[oó]n (en|de) texto|texto (completo|integral) d[oa] (v[ií]deo|[aá]udio|podcast)/i
  const DESCRIPTION = /audio[\s-]?descri|audiodescri|described (version|video)|descri[cç][aã]o (de|em) [aá]udio|descripci[oó]n (de|en) audio|audio described/i
  const signalCandidates: Array<{ el: Element; text: string; transcript: boolean; description: boolean }> = []
  for (const root of roots) {
    for (const el of Array.from(root.querySelectorAll('a, button, summary, [role="button"], [role="link"], [role="tab"], h1, h2, h3, h4, h5, h6, figcaption, caption, label, legend, dt, p, strong, b, option'))) {
      const text = collapse((el as HTMLElement).innerText ?? el.textContent) || collapse(el.getAttribute('aria-label'))
      if (!text || text.length > 200) continue
      const transcript = TRANSCRIPT.test(text)
      const description = DESCRIPTION.test(text)
      if (!transcript && !description) continue
      if (!shows(el) && el.localName !== 'option') continue
      signalCandidates.push({ el, text: cut(text, 120), transcript, description })
    }
  }
  // The innermost element that says it: the link, not the paragraph around it.
  for (let i = signalCandidates.length - 1; i >= 0; i--) {
    const outer = signalCandidates[i]
    if (outer && signalCandidates.some((inner) => inner !== outer && outer.el.contains(inner.el))) signalCandidates.splice(i, 1)
  }
  const asSignal = (s: { el: Element; text: string }, near: boolean): MediaSignal => {
    const d = kit.describe(s.el)
    return { ref: d.ref, id: d.id, tag: d.tag, text: s.text, near }
  }
  const asControl = (c: { el: Element; label: string; kind: MediaControl['kind'] }, near: boolean): MediaControl => {
    const d = kit.describe(c.el)
    return { ref: d.ref, id: d.id, tag: d.tag, label: c.label, kind: c.kind, near }
  }
  const mediaEls = new Set(media.map((m) => m.el))
  // The element's own container: up to four levels up, short of an ancestor that holds other media.
  const containerOf = (el: Element): Element => {
    let container: Element = el
    for (let i = 0; i < 5; i++) {
      const parent: Element | null = container.parentElement
      if (!parent || parent === el.ownerDocument.body || parent === el.ownerDocument.documentElement) break
      const others = Array.from(parent.querySelectorAll('video, audio')).some((other) => other !== el && mediaEls.has(other as HTMLMediaElement))
      if (others) break
      container = parent
      if (['figure', 'article', 'section', 'li'].includes(container.localName)) break
    }
    return container
  }
  const referenced = (el: Element): Element[] => {
    const ids = `${el.getAttribute('aria-describedby') ?? ''} ${el.getAttribute('aria-details') ?? ''}`.split(/\s+/).filter(Boolean)
    return ids.flatMap((id) => {
      const target = el.ownerDocument.getElementById(id)
      return target ? [target] : []
    })
  }

  const items: MediaItem[] = []
  const elementOf = new Map<MediaItem, HTMLMediaElement>()
  const sampled: Array<{ el: HTMLMediaElement; item: MediaItem; muted: boolean; time: number; analyser?: AnalyserNode | undefined; peak: number; firstLoud: number; lastLoud: number; wasLoud: boolean; sampledMs: number; lastTime: number; captureTried: boolean }> = []
  const span = (first: number, last: number) => (first < 0 ? 0 : Math.round(last - first))
  const modes: Array<{ track: TextTrack; mode: TextTrackMode }> = []
  let ctx: AudioContext | undefined
  const ownContext = (): AudioContext | undefined => {
    try {
      if (!ctx) {
        ctx = new AudioContext()
        for (const state of states) state.own.add(ctx)
      }
      return ctx
    } catch {
      return undefined
    }
  }
  const sameOrigin = (src: string): boolean => {
    if (!src || src.startsWith('blob:') || src.startsWith('data:')) return true
    try {
      return new URL(src, location.href).origin === location.origin
    } catch {
      return true
    }
  }
  const errorName = (code: number | undefined) => (code === 1 ? 'aborted' : code === 2 ? 'network' : code === 3 ? 'decode' : code === 4 ? 'source not supported' : undefined)
  let unsampled = 0

  for (const { el, frame } of media) {
    const d = kit.describe(el)
    const r = el.getBoundingClientRect()
    const visible = kit.visible(el) && r.width > 1 && r.height > 1
    const src = el.currentSrc || el.getAttribute('src') || (el.querySelector('source') as HTMLSourceElement | null)?.src || ''
    const watch = watchOf(el)
    const container = containerOf(el)
    const refs = referenced(el)
    const isNear = (other: Element) => container.contains(other) || refs.some((target) => target === other || target.contains(other))
    const ariaControls = (other: Element) => !!el.id && (other.getAttribute('aria-controls') ?? '').split(/\s+/).includes(el.id)
    const name = collapse(el.getAttribute('aria-label') || el.getAttribute('title') || refs.map((target) => collapse(target.textContent)).join(' '))
    const item: MediaItem = {
      ...d,
      kind: el.localName === 'audio' ? 'audio' : 'video',
      ...(frame ? { frame } : {}),
      src: src.slice(0, 200),
      crossOrigin: !sameOrigin(src) && !el.hasAttribute('crossorigin'),
      visible,
      box: { width: Math.round(r.width), height: Math.round(r.height) },
      attributes: { autoplay: el.autoplay, loop: el.loop, muted: el.hasAttribute('muted'), controls: el.controls, preload: el.getAttribute('preload') ?? '' },
      sample: 'not-showing',
      duration: null,
      live: false,
      hasAudio: null,
      hasVideo: el.localName === 'audio' ? false : null,
      level: null,
      tracks: [],
      transcript: [],
      description: [],
      controls: controlCandidates.filter((c) => isNear(c.el) || ariaControls(c.el)).slice(0, 4).map((c) => asControl(c, true)),
      name: cut(name, 120),
    }
    const near = signalCandidates.filter((s) => isNear(s.el))
    item.transcript = near.filter((s) => s.transcript).slice(0, args.maxSignals).map((s) => asSignal(s, true))
    item.description = near.filter((s) => s.description).slice(0, args.maxSignals).map((s) => asSignal(s, true))
    // What the watch saw it do on its own, with its sound on.
    const sounding = !el.muted && el.volume > 0
    if (watch && !watch.own && watch.firstAt !== null) {
      item.autoplay = {
        started: true,
        blocked: false,
        at: watch.firstAt,
        playedMs: Math.round(watch.playedMs),
        audibleMs: watch.measurable === true ? span(watch.firstLoud, watch.lastLoud) : watch.measurable === false ? 0 : null,
        peakDb: watch.measurable === true ? db(watch.peak) : null,
        decoded: watch.decoded,
        playing: !el.paused && !el.ended && sounding && !watch.stopped,
        ...(watch.stopped ? { stopped: watch.stopped } : {}),
        watchedMs: Math.round(performance.now() - watch.firstAt),
        loop: el.loop,
      }
    } else if (el.autoplay && el.paused && sounding) {
      item.autoplay = { started: false, blocked: true, at: null, playedMs: 0, audibleMs: null, peakDb: null, decoded: false, playing: false, watchedMs: 0, loop: el.loop }
    }
    // Text tracks: made to load, to count their cues.
    for (const trackEl of Array.from(el.querySelectorAll('track'))) {
      const track = trackEl.track
      if (track.mode === 'disabled') {
        modes.push({ track, mode: track.mode })
        track.mode = 'hidden'
      }
    }
    if (!src && el.readyState === 0) item.sample = 'no-source'
    else if (el.error) {
      item.sample = 'error'
      item.error = errorName(el.error.code)
    } else if (!el.paused && !el.ended) {
      item.sample = 'already-playing'
      sampled.push({ el, item, muted: el.muted, time: el.currentTime, peak: 0, firstLoud: -1, lastLoud: -1, wasLoud: false, sampledMs: 0, lastTime: el.currentTime, captureTried: false })
    } else if (visible || el.controls || item.autoplay?.blocked) {
      if (sampled.filter((s) => s.item.sample === 'played').length >= args.maxSampled) {
        item.sample = 'budget'
        unsampled++
      } else {
        item.sample = 'played'
        const entry = { el, item, muted: el.muted, time: el.currentTime, peak: 0, firstLoud: -1, lastLoud: -1, wasLoud: false, sampledMs: 0, lastTime: el.currentTime, captureTried: false }
        sampled.push(entry)
        if (watch) watch.own = true
        el.muted = true
        el.play().catch(() => undefined)
      }
    }
    items.push(item)
    elementOf.set(item, el)
  }

  // Muted playback: duration, audio track, level, while the tracks load.
  const capture = (entry: (typeof sampled)[number]) => {
    if (entry.captureTried || entry.el.readyState < 1) return
    entry.captureTried = true
    try {
      const stream = (entry.el as HTMLMediaElement & { captureStream(): MediaStream }).captureStream()
      const audio = stream.getAudioTracks().length
      const video = stream.getVideoTracks().length
      entry.item.hasAudio = audio > 0
      if (entry.item.kind === 'video') entry.item.hasVideo = video > 0
      if (audio > 0) {
        const own = ownContext()
        if (own) {
          if (own.state === 'suspended') own.resume().catch(() => undefined)
          const analyser = own.createAnalyser()
          analyser.fftSize = 2048
          own.createMediaStreamSource(stream).connect(analyser)
          entry.analyser = analyser
        }
      }
    } catch {
      // Media from another origin: its stream cannot be read.
      entry.item.crossOrigin = true
    }
  }
  const samples = new Float32Array(2048)
  const started = performance.now()
  if (sampled.length > 0) {
    while (performance.now() - started < args.sampleMs) {
      await new Promise((resolve) => setTimeout(resolve, 100))
      for (const entry of sampled) {
        capture(entry)
        const delta = Math.min(0.6, Math.max(0, entry.el.currentTime - entry.lastTime))
        entry.lastTime = entry.el.currentTime
        if (!entry.analyser || ctx?.state !== 'running' || delta === 0) continue
        entry.analyser.getFloatTimeDomainData(samples)
        let sum = 0
        for (const value of samples) sum += value * value
        const level = Math.sqrt(sum / samples.length)
        if (level > entry.peak) entry.peak = level
        entry.sampledMs += delta * 1000
        const loud = level > threshold
        if (loud && entry.wasLoud) {
          if (entry.firstLoud < 0) entry.firstLoud = entry.sampledMs - delta * 1000
          entry.lastLoud = entry.sampledMs
        }
        entry.wasLoud = loud
      }
    }
  } else if (modes.length > 0) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(args.sampleMs, 1500)))
  }

  // Read back, then put back what the probe changed.
  for (const entry of sampled) {
    const { el, item } = entry
    capture(entry)
    if (el.error) {
      item.error = errorName(el.error.code)
      if (item.sample === 'played') item.sample = 'error'
    }
    const decodedAudio = (el as HTMLMediaElement & { webkitAudioDecodedByteCount?: number }).webkitAudioDecodedByteCount ?? 0
    const decodedVideo = (el as HTMLMediaElement & { webkitVideoDecodedByteCount?: number }).webkitVideoDecodedByteCount ?? 0
    if (item.hasAudio === null && el.readyState >= 2) item.hasAudio = decodedAudio > 0 ? true : decodedVideo > 0 ? false : null
    if (item.kind === 'video' && item.hasVideo === null && el.readyState >= 2) item.hasVideo = (el as HTMLVideoElement).videoWidth > 0
    if (item.sample === 'played' && el.readyState < 2 && !el.error && el.currentTime === entry.time) item.sample = 'did-not-start'
    if (entry.analyser && entry.sampledMs > 0) item.level = { peakDb: db(entry.peak), audibleMs: span(entry.firstLoud, entry.lastLoud), sampledMs: Math.round(entry.sampledMs) }
    if (item.sample === 'played') {
      el.pause()
      try {
        el.currentTime = entry.time
      } catch {
        // Not seekable.
      }
      el.muted = entry.muted
      const watch = watchOf(el)
      if (watch) watch.own = true
    }
  }
  for (const item of items) {
    const el = elementOf.get(item)
    if (!el) continue
    if (Number.isFinite(el.duration)) item.duration = Math.round(el.duration * 10) / 10
    else if (el.duration === Number.POSITIVE_INFINITY) item.live = true
    item.tracks = Array.from(el.querySelectorAll('track')).map((trackEl) => {
      const cues = trackEl.track.cues
      const first = cues && cues.length > 0 ? collapse((cues[0] as VTTCue).text) : ''
      return {
        kind: trackEl.kind || 'subtitles',
        label: cut(collapse(trackEl.label), 60),
        srclang: trackEl.srclang,
        src: (trackEl.getAttribute('src') ?? '').slice(0, 200),
        default: trackEl.default,
        state: (['none', 'loading', 'loaded', 'error'] as const)[trackEl.readyState] ?? 'none',
        cues: cues ? cues.length : null,
        ...(first ? { first: cut(first, 80) } : {}),
      }
    })
  }
  for (const { track, mode } of modes) track.mode = mode
  await ctx?.close().catch(() => undefined)

  // Audio played from script outside the page (new Audio()).
  const detached: MediaData['detached'] = []
  for (const state of states) {
    for (const [el, info] of state.watched) {
      if (el.isConnected || info.own || info.firstAt === null) continue
      const src = (el.currentSrc || el.src || '').slice(0, 200)
      detached.push({
        src,
        crossOrigin: !sameOrigin(src),
        autoplay: {
          started: true,
          blocked: false,
          at: info.firstAt,
          playedMs: Math.round(info.playedMs),
          audibleMs: info.measurable === true ? span(info.firstLoud, info.lastLoud) : info.measurable === false ? 0 : null,
          peakDb: info.measurable === true ? db(info.peak) : null,
          decoded: info.decoded,
          playing: !el.paused && !el.ended && !el.muted && el.volume > 0 && !info.stopped,
          ...(info.stopped ? { stopped: info.stopped } : {}),
          watchedMs: Math.round(performance.now() - info.firstAt),
          loop: el.loop,
        },
      })
    }
  }
  const webAudio: WebAudioFact = { contexts: 0, running: 0, sources: 0, connected: false, audibleMs: null, peakDb: null, blocked: false }
  let peak = 0
  for (const state of states) {
    for (const [audio, info] of state.contexts) {
      if (state.own.has(audio)) continue
      webAudio.contexts++
      if (info.runningMs > 0) webAudio.running++
      webAudio.sources += info.sources
      webAudio.connected ||= info.connected
      if (info.analyser && info.runningMs > 0) webAudio.audibleMs = Math.max(webAudio.audibleMs ?? 0, span(info.firstLoud, info.lastLoud))
      peak = Math.max(peak, info.peak)
      webAudio.blocked ||= info.suspended && info.runningMs === 0
    }
  }
  if (webAudio.audibleMs !== null) webAudio.peakDb = db(peak)

  const nearRefs = new Set(items.flatMap((item) => [...item.controls, ...item.transcript, ...item.description].map((x) => x.ref)))
  const pageControls = controlCandidates
    .filter((c) => !nearRefs.has(kit.cssPath(c.el)))
    .slice(0, 8)
    .map((c) => asControl(c, false))
  const pageTranscript = signalCandidates
    .filter((s) => s.transcript && !nearRefs.has(kit.cssPath(s.el)))
    .slice(0, args.maxSignals)
    .map((s) => asSignal(s, false))
  const pageDescription = signalCandidates
    .filter((s) => s.description && !nearRefs.has(kit.cssPath(s.el)))
    .slice(0, args.maxSignals)
    .map((s) => asSignal(s, false))
  return {
    items,
    detached,
    frames,
    webAudio,
    pageControls,
    pageTranscript,
    pageDescription,
    policy: top?.policy ?? null,
    watchMs: Math.round(performance.now() - (top?.start ?? 0)),
    unsampled,
    omitted,
  }
}

async function watchPage(page: Page, started: number): Promise<void> {
  // Until the page has loaded for WATCH_MS, and whatever plays with its sound on has played long enough (or stopped).
  for (;;) {
    const summary = await page.evaluate(readWatch, { playedMs: WATCH_PLAYED_MS, runMs: WATCH_PLAYED_MS })
    if ((summary.now >= WATCH_MS && !summary.pending) || summary.now >= WATCH_CAP_MS || Date.now() - started > WATCH_CAP_MS) return
    await page.waitForTimeout(300)
  }
}

/** 1.2.1–1.2.5 and 1.4.2: the watch on load, then the inventory and the muted sample. */
export async function runMediaProbe(browser: Browser, url: string, options: ProbeOptions): Promise<ProbeRecord> {
  const started = Date.now()
  const probe = await openProbePage(browser, url, options, {
    variant: 'media',
    beforeLoad: async (_page, context) => {
      await context.addInitScript(installMediaHooks)
    },
  })
  try {
    const page = probe.page
    await watchPage(page, started)
    const result = await page.evaluate(collectMedia, { maxItems: MAX_ITEMS, maxSampled: MAX_SAMPLED, maxSignals: MAX_SIGNALS, sampleMs: SAMPLE_MS, audibleDb: AUDIBLE_DB })
    const frames = result.frames
      .map((frame) => ({ ...frame, player: playerOf(frame.host) }))
      .sort((a, b) => Number(b.player !== null) - Number(a.player !== null))
      .slice(0, 20)
    const data: MediaData = {
      items: result.items,
      detached: result.detached,
      frames,
      webAudio: result.webAudio,
      pageControls: result.pageControls,
      pageTranscript: result.pageTranscript,
      pageDescription: result.pageDescription,
      autoplayPolicy: result.policy,
      watchMs: result.watchMs,
      sampleMs: SAMPLE_MS,
      unsampled: result.unsampled,
      omitted: result.omitted,
    }
    const partial = result.unsampled > 0 || result.omitted > 0
    return {
      kind: 'media',
      version: MEDIA_VERSION,
      conditions: probe.conditions,
      status: partial ? 'partial' : 'complete',
      ...(partial ? { reason: `media budget reached (${MAX_SAMPLED} played, ${MAX_ITEMS} listed)` } : {}),
      guard: probe.guard.log,
      durationMs: Date.now() - started,
      data,
    }
  } finally {
    await probe.context.close()
  }
}

/** The media probe as a step of the probe stage; a probe that fails leaves a skipped record. */
export async function mediaProbe(browser: Browser, url: string, options: ProbeOptions): Promise<ProbeRecord[]> {
  const started = Date.now()
  try {
    return [await runMediaProbe(browser, url, options)]
  } catch (error) {
    return [skippedRecord('media', MEDIA_VERSION, 'media', `probe failed: ${(error instanceof Error ? error.message : String(error)).split('\n')[0]}`, Date.now() - started)]
  }
}
