import type { Browser, CDPSession, Page } from 'playwright-core'
import type { ProbeRecord } from '../snapshot/schema.ts'
import { contextOptions } from '../surfaces/browser-options.ts'
import { type ControlFacts, Harness, type HarnessAction, type Watch, skipReason } from './activate.ts'
import { contextChanges } from './input.ts'
import type { InPageElement } from './kit.ts'
import type { ProbeOptions, ProbePage } from './page.ts'

/**
 * 2.5.4 Motion Actuation, the device-motion part of the gestures probe (docs/plans/wcag-coverage.md, D2; ACT c249d5 and
 * 7677a9). It runs only on a page that listens to the device's motion or orientation on `window` (the listeners C17's
 * scope note reads, read again on the probe's page). The browser's virtual sensors are turned on before the page loads
 * (Emulation.setSensorOverrideEnabled: accelerometer, linear acceleration, gyroscope, relative and absolute orientation),
 * at rest, so the page receives trusted `devicemotion` and `deviceorientation` events as a phone sends them; where the
 * browser has no virtual sensors, or the events do not reach the page, synthetic events are dispatched on `window`.
 *
 * Three motions, each from a page at rest: a shake, a tilt to the side and a tilt forward, and what the page did in each
 * (the harness's watch: navigations, dialogs, nodes and text, scroll offsets, class and style changes). When a motion did
 * something, it is done again on a second fresh load, and then, each on a fresh load: the controls the page names for
 * what the motion does ("Shake to undo" → an Undo button) or for such functions are clicked, and what they did is
 * compared with what the motion did; a switch named for motion is toggled, and the motion made again, to see whether it
 * still acts. Facts, never verdicts: src/rules/gestures.ts decides.
 */

export const DEVICE_MOTION_VERSION = '1'
export const DEVICE_MOTION_VARIANT = 'device-motion'
export const DEVICE_MOTION_LIMITS = { controls: 12, timeMs: 90_000 }
const MAX_ALTERNATIVES = 5
const MAX_SWITCHES = 2

export const MOTION_EVENT_TYPES = ['devicemotion', 'deviceorientation', 'deviceorientationabsolute'] as const
const SENSOR_TYPES = ['accelerometer', 'linear-acceleration', 'gyroscope', 'relative-orientation', 'absolute-orientation'] as const

export interface MotionListenerFact {
  type: string
  /** The script that added it, by its address; '' for one written in the page or evaluated. */
  script: string
  line?: number | undefined
}

export type MotionPattern = 'shake' | 'tilt-sideways' | 'tilt-forward'
export const MOTION_PATTERNS: readonly MotionPattern[] = ['shake', 'tilt-sideways', 'tilt-forward']

export interface MotionEffect {
  /** navigation (a navigation, a window or a submission), dialog, content (nodes or text), scroll, style (class and style only). */
  kind: 'navigation' | 'dialog' | 'content' | 'scroll' | 'style'
  detail: string
  /** The elements that changed and how, from the harness's watch: `#list > li:nth-of-type(3)|removed`. */
  marks: string[]
  /** Lines of the page's text that went and came (the page's own changes in a wait with no input left out). */
  gone: string[]
  came: string[]
  /** What scrolled: `page` or an element's ref; `scrollable` when the browser itself lets a person scroll it. */
  scroll?: { target: string; dx: number; dy: number; scrollable: boolean } | undefined
}

export interface MotionTry {
  pattern: MotionPattern
  /** sensors: trusted events from the browser's virtual sensors; synthetic: events dispatched on window. */
  via: 'sensors' | 'synthetic'
  /** Motion and orientation events Rampa's own listener counted in the window: whether the motion reached the page. */
  events: { motion: number; orientation: number }
  effect?: MotionEffect | undefined
}

export interface MotionControl extends InPageElement {
  /** alternative: may do what the motion did; switch: may turn the response to motion off. */
  role: 'alternative' | 'switch'
  /** Why it was tried: `named for "undo" in "Shake to undo"`, `named for motion`. */
  why: string
  /** An alternative did what the motion did. */
  reproduced?: boolean | undefined
  /** A switch, toggled, left the motion with no effect. */
  stopped?: boolean | undefined
  /** What it did instead, when it did something else. */
  did?: string | undefined
  skipped?: string | undefined
}

export interface DeviceMotionData {
  listeners: MotionListenerFact[]
  /** The browser's virtual sensors were used; false when the events were synthetic. */
  sensors: boolean
  /** Lines of the page that name a motion: "Shake your phone to undo". */
  mentions: string[]
  tries: MotionTry[]
  /** The first motion that did something other than move styles, or else the first that moved styles. */
  effect?: { pattern: MotionPattern; effect: MotionEffect } | undefined
  /** The same motion on a second fresh load did the same kind of thing (true) or not (false); absent when not tried. */
  confirmed?: boolean | undefined
  /** What the motion did was to scroll the page or a box the browser lets a person scroll: the browser's scrolling does the same. */
  scrolls?: boolean | undefined
  controls: MotionControl[]
  loads: number
  actions: HarnessAction[]
  end: 'complete' | 'budget' | 'time' | 'no-listener'
}

interface SenseDiff {
  gone: string[]
  came: string[]
  scrolled: Array<{ target: string; dx: number; dy: number; scrollable: boolean }>
}

interface SenseWindow {
  __rampaKit: { describe(el: Element): InPageElement; visible(el: Element): boolean }
  __rampaActivate: { facts(el: Element): ControlFacts }
  __rampaSense?: { begin(): void; end(): SenseDiff }
  __rampaSensed?: { motion: number; orientation: number }
}

/** Runs in the page: Rampa's own listeners, which count the motion and orientation events the page receives. */
export function installSenseCounter(): void {
  const w = window as unknown as SenseWindow
  if (w.__rampaSensed) return
  const sensed = { motion: 0, orientation: 0 }
  w.__rampaSensed = sensed
  window.addEventListener(
    'devicemotion',
    () => {
      sensed.motion++
    },
    { capture: true, passive: true },
  )
  window.addEventListener(
    'deviceorientation',
    () => {
      sensed.orientation++
    },
    { capture: true, passive: true },
  )
}

/**
 * Installed on every page of the device-motion part, before the harness's wait with no input (HarnessConfig.kits): the
 * lines of the page's text and the scroll offsets of the page and of the boxes that scroll, read when a window begins and
 * when it ends. Lines that changed in the wait with no input (a clock) are the page's own, left out by their shape.
 */
export function installSenseKit(): void {
  const w = window as unknown as SenseWindow
  if (w.__rampaSense) return
  const kit = w.__rampaKit
  const mask = (line: string) => line.replace(/\d/g, '0')
  const lines = () =>
    (document.body?.innerText ?? '')
      .slice(0, 200_000)
      .split('\n')
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
  const diff = (from: string[], to: string[]) => {
    const left = new Map<string, number>()
    for (const line of from) left.set(line, (left.get(line) ?? 0) + 1)
    const came: string[] = []
    for (const line of to) {
      const n = left.get(line) ?? 0
      if (n > 0) left.set(line, n - 1)
      else came.push(line)
    }
    const gone: string[] = []
    for (const [line, n] of left) for (let i = 0; i < n; i++) gone.push(line)
    return { gone, came }
  }
  const scrollables = (): Element[] => {
    const out: Element[] = []
    const walker = document.createTreeWalker(document.body ?? document.documentElement, NodeFilter.SHOW_ELEMENT)
    for (let n = walker.nextNode(), i = 0; n && i < 20_000 && out.length < 60; n = walker.nextNode(), i++) {
      const el = n as Element
      if (el.scrollHeight <= el.clientHeight + 4 && el.scrollWidth <= el.clientWidth + 4) continue
      const style = getComputedStyle(el)
      if (/auto|scroll|hidden/.test(`${style.overflowX} ${style.overflowY}`)) out.push(el)
    }
    return out
  }
  const installed = lines()
  let noise: Set<string> | undefined
  let start: { lines: string[]; x: number; y: number; boxes: Array<{ el: Element; left: number; top: number }> } | undefined
  w.__rampaSense = {
    begin() {
      if (!noise) {
        const changed = diff(installed, lines())
        noise = new Set([...changed.gone, ...changed.came].map(mask))
      }
      start = { lines: lines(), x: window.scrollX, y: window.scrollY, boxes: scrollables().map((el) => ({ el, left: el.scrollLeft, top: el.scrollTop })) }
    },
    end() {
      if (!start) return { gone: [], came: [], scrolled: [] }
      const quiet = noise ?? new Set<string>()
      const changed = diff(start.lines, lines())
      const keep = (list: string[]) =>
        list
          .filter((line) => !quiet.has(mask(line)))
          .slice(0, 8)
          .map((line) => (line.length > 120 ? `${line.slice(0, 119)}…` : line))
      const scrolled: SenseDiff['scrolled'] = []
      const root = document.scrollingElement ?? document.documentElement
      if (window.scrollX !== start.x || window.scrollY !== start.y) {
        scrolled.push({ target: 'page', dx: Math.round(window.scrollX - start.x), dy: Math.round(window.scrollY - start.y), scrollable: root.scrollHeight > window.innerHeight + 4 || root.scrollWidth > window.innerWidth + 4 })
      }
      for (const box of start.boxes) {
        if (!box.el.isConnected || (box.el.scrollLeft === box.left && box.el.scrollTop === box.top) || box.el === root) continue
        const style = getComputedStyle(box.el)
        scrolled.push({ target: kit.describe(box.el).ref, dx: Math.round(box.el.scrollLeft - box.left), dy: Math.round(box.el.scrollTop - box.top), scrollable: /auto|scroll/.test(`${style.overflowX} ${style.overflowY}`) })
        if (scrolled.length >= 4) break
      }
      return { gone: keep(changed.gone), came: keep(changed.came), scrolled }
    },
  }
}

/** Words that name a motion, in English, Portuguese and Spanish: "shake to undo", "incline o celular para rolar". */
export const MOTION_WORDS =
  /\b(shake|shaking|tilt|tilting|motion|accelerometer|gyroscope|gyro)\b|\b(rotate|turn|move|flip|wave) (your |the )?(phone|device|tablet)\b|\bagit[ae]r?\b|\bsacud|chacoalh|\binclin[ae]r?\b|\bmovimento\b|\bmovimiento\b|girosc[oó]pio|aceler[oó]metro|\b(gire|mova|vire) o (celular|aparelho|telefone)\b|\bsacude\b|\b(mueve|gira) (el|tu) (m[oó]vil|tel[eé]fono)\b/i

/** Functions a motion often stands in for: the controls named so are tried as the motion's alternatives. */
export const FUNCTION_WORDS =
  /\b(undo|redo|shuffle|random|refresh|reload|next|previous|back|scroll|up|down|top|rotate|flip|roll|dice|desfazer|refazer|embaralhar|aleat[oó]rio|atualizar|recarregar|pr[oó]xim[oa]|anterior|voltar|rolar|subir|descer|girar|sortear|deshacer|rehacer|barajar|actualizar|recargar|siguiente|desplazar)\b/i

/** Runs in the page: the lines of its text that name a motion. */
export function findMotionTexts(args: { motion: string }): string[] {
  const motion = new RegExp(args.motion, 'i')
  const out: string[] = []
  for (const line of (document.body?.innerText ?? '').slice(0, 200_000).split('\n')) {
    const text = line.replace(/\s+/g, ' ').trim()
    if (!text || !motion.test(text) || out.includes(text)) continue
    out.push(text.length > 160 ? `${text.slice(0, 159)}…` : text)
    if (out.length >= 4) break
  }
  return out
}

/** The words a page's own sentence says a motion does: "Shake your phone to undo" → undo. */
export function motionFunctions(mentions: readonly string[]): string[] {
  const STOP = new Set(['the', 'a', 'an', 'your', 'o', 'a', 'os', 'as', 'um', 'uma', 'el', 'la', 'los', 'las', 'tu', 'seu', 'sua', 'it', 'this', 'isso'])
  const words = new Set<string>()
  for (const mention of mentions) {
    for (const match of mention.matchAll(/(?:\bto\b|\bpara\b|\bpra\b|\bfor\b)\s+([\p{L}]+(?:\s+[\p{L}]+){0,2})/giu)) {
      for (const word of (match[1] ?? '').toLowerCase().split(/\s+/)) {
        if (word.length >= 3 && !STOP.has(word)) {
          words.add(word)
          break
        }
      }
    }
  }
  return [...words].slice(0, 4)
}

/**
 * Runs in the page; needs the kit and the activate kit. The controls that may do what a motion did (named for a function
 * the page's own sentence gives the motion, then for functions a motion often stands in for), and the switches named
 * for motion that may turn it off.
 */
export function findMotionControls(args: { named: string | null; functions: string; motion: string }): Array<Omit<MotionControl, 'reproduced' | 'stopped' | 'did' | 'skipped'> & { facts: ControlFacts }> {
  const w = window as unknown as SenseWindow
  const kit = w.__rampaKit
  const named = args.named ? new RegExp(args.named, 'i') : null
  const functions = new RegExp(args.functions, 'i')
  const motion = new RegExp(args.motion, 'i')
  const collapse = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim()
  const nameOf = (el: Element) => {
    const labels = 'labels' in el ? Array.from((el as HTMLInputElement).labels ?? []).map((l) => collapse(l.textContent)).join(' ') : ''
    const labelled = (el.getAttribute('aria-labelledby') ?? '')
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ')
    return collapse(el.getAttribute('aria-label') || collapse(labelled) || labels || (el as HTMLElement).innerText || el.getAttribute('title') || (el as HTMLInputElement).value || '').slice(0, 80)
  }
  const showing = (el: Element) => kit.visible(el) && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0
  const SWITCHES = 'input[type=checkbox], input[type=radio], [role=switch], [role=checkbox], [role=menuitemcheckbox], button[aria-pressed], [role=button][aria-pressed]'
  const CONTROLS = 'button, [role=button], a[href^="#"], a[role=button], input[type=button], [role=menuitem], [role=tab]'
  const switches: Array<Omit<MotionControl, 'reproduced' | 'stopped' | 'did' | 'skipped'> & { facts: ControlFacts }> = []
  const first: typeof switches = []
  const then: typeof switches = []
  for (const el of Array.from(document.querySelectorAll(`${SWITCHES}, ${CONTROLS}`))) {
    // A checkbox's label is what shows; the input itself may be hidden behind a styled switch.
    const input = el as HTMLInputElement
    const visibleEnough = showing(el) || ('labels' in el && Array.from(input.labels ?? []).some(showing))
    if (!visibleEnough) continue
    const name = nameOf(el)
    if (!name) continue
    const described = kit.describe(el)
    const entry = { ...described, label: name, facts: w.__rampaActivate.facts(el) }
    if (el.matches(SWITCHES) && motion.test(name)) {
      if (switches.length < 2) switches.push({ ...entry, role: 'switch', why: 'named for motion' })
      continue
    }
    if (!el.matches(CONTROLS)) continue
    const own = named?.exec(name)
    if (own) first.push({ ...entry, role: 'alternative', why: `named for "${own[0].toLowerCase()}", which the page says the motion does` })
    else if (functions.test(name)) then.push({ ...entry, role: 'alternative', why: 'named for a function a motion may stand in for' })
  }
  return [...first, ...then].slice(0, 5).concat(switches)
}

/** One step of a motion: the sensors' readings, held for `ms`. */
export interface Reading {
  /** Acceleration including gravity, m/s². */
  accel: [number, number, number]
  /** Linear acceleration (gravity removed), m/s². */
  linear: [number, number, number]
  /** Rotation rate, rad/s. */
  gyro: [number, number, number]
  /** Front-to-back and side-to-side tilt, degrees. */
  beta: number
  gamma: number
  ms: number
}

const G = 9.81
const REST: Reading = { accel: [0, 0, G], linear: [0, 0, 0], gyro: [0, 0, 0], beta: 0, gamma: 0, ms: 60 }

/** A motion as a series of readings: a shake on two axes, or a tilt of 35° held for about a second and back. */
export function motionSteps(pattern: MotionPattern): Reading[] {
  const rad = (deg: number) => (deg * Math.PI) / 180
  if (pattern === 'shake') {
    const steps: Reading[] = []
    for (let i = 0; i < 14; i++) {
      const s = i % 2 === 0 ? 1 : -1
      steps.push({ accel: [20 * s, 20 * s, G + 8 * s], linear: [20 * s, 20 * s, 8 * s], gyro: [0, 0, 0], beta: 0, gamma: 0, ms: 60 })
    }
    return [...steps, REST, REST]
  }
  const sideways = pattern === 'tilt-sideways'
  const at = (deg: number, rate: number): Reading => ({
    accel: sideways ? [-G * Math.sin(rad(deg)), 0, G * Math.cos(rad(deg))] : [0, G * Math.sin(rad(deg)), G * Math.cos(rad(deg))],
    linear: [0, 0, 0],
    gyro: sideways ? [0, rate, 0] : [rate, 0, 0],
    beta: sideways ? 0 : deg,
    gamma: sideways ? deg : 0,
    ms: 60,
  })
  const rate = rad(35) / 0.3
  const steps: Reading[] = []
  for (let i = 1; i <= 5; i++) steps.push(at((35 * i) / 5, rate))
  for (let i = 0; i < 15; i++) steps.push(at(35, 0))
  for (let i = 4; i >= 0; i--) steps.push(at((35 * i) / 5, -rate))
  return [...steps, REST, REST]
}

/** The orientation of a reading as a quaternion: a rotation about x by beta, then about y by gamma. */
export function quaternion(reading: Pick<Reading, 'beta' | 'gamma'>): { x: number; y: number; z: number; w: number } {
  const b = (reading.beta * Math.PI) / 360
  const g = (reading.gamma * Math.PI) / 360
  // q = qx(beta) · qy(gamma)
  return { x: Math.sin(b) * Math.cos(g), y: Math.cos(b) * Math.sin(g), z: Math.sin(b) * Math.sin(g), w: Math.cos(b) * Math.cos(g) }
}

async function setReading(cdp: CDPSession, reading: Reading): Promise<void> {
  const xyz = (v: [number, number, number]) => ({ xyz: { x: v[0], y: v[1], z: v[2] } })
  const q = quaternion(reading)
  await Promise.all([
    cdp.send('Emulation.setSensorOverrideReadings', { type: 'accelerometer', reading: xyz(reading.accel) }),
    cdp.send('Emulation.setSensorOverrideReadings', { type: 'linear-acceleration', reading: xyz(reading.linear) }),
    cdp.send('Emulation.setSensorOverrideReadings', { type: 'gyroscope', reading: xyz(reading.gyro) }),
    cdp.send('Emulation.setSensorOverrideReadings', { type: 'relative-orientation', reading: { quaternion: q } }),
    cdp.send('Emulation.setSensorOverrideReadings', { type: 'absolute-orientation', reading: { quaternion: q } }),
  ])
}

/** Runs in the page: the readings dispatched as synthetic `devicemotion` and `deviceorientation` events on window. */
export async function dispatchMotion(steps: Reading[]): Promise<void> {
  for (const step of steps) {
    const vector = (v: [number, number, number]) => ({ x: v[0], y: v[1], z: v[2] })
    const deg = (r: number) => (r * 180) / Math.PI
    try {
      window.dispatchEvent(
        new DeviceMotionEvent('devicemotion', {
          acceleration: vector(step.linear),
          accelerationIncludingGravity: vector(step.accel),
          rotationRate: { alpha: deg(step.gyro[2]), beta: deg(step.gyro[0]), gamma: deg(step.gyro[1]) },
          interval: 16,
        }),
      )
      window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta: step.beta, gamma: step.gamma, absolute: false }))
      window.dispatchEvent(new DeviceOrientationEvent('deviceorientationabsolute', { alpha: 0, beta: step.beta, gamma: step.gamma, absolute: true }))
    } catch {
      // No such events in this browser.
    }
    await new Promise((done) => setTimeout(done, step.ms))
  }
}

/** Reads the motion listeners on `window` over the DevTools protocol, with the script and line that added each. */
export async function motionListeners(probe: ProbePage): Promise<MotionListenerFact[] | undefined> {
  try {
    const cdp = await probe.context.newCDPSession(probe.page)
    try {
      const scripts = new Map<string, string>()
      cdp.on('Debugger.scriptParsed', (event) => scripts.set(event.scriptId, event.url ?? ''))
      await cdp.send('Debugger.enable', {})
      await cdp.send('Debugger.setSkipAllPauses', { skip: true })
      // The scripts already parsed arrive as events next to the answer to Debugger.enable.
      await new Promise((done) => setTimeout(done, 100))
      const { result } = await cdp.send('Runtime.evaluate', { expression: 'window' })
      if (!result.objectId) return undefined
      const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId, depth: 0 })
      return listeners
        .filter((listener) => (MOTION_EVENT_TYPES as readonly string[]).includes(listener.type))
        .map((listener) => ({ type: listener.type, script: scripts.get(listener.scriptId) ?? '', line: listener.lineNumber + 1 }))
    } finally {
      await cdp.send('Debugger.disable').catch(() => undefined)
      await cdp.detach().catch(() => undefined)
    }
  } catch {
    return undefined
  }
}

/** What a window did, as 2.5.4 reads it: a navigation, a dialog, content, scrolling, or only styles. */
export function motionEffect(watch: Watch | undefined, sense: SenseDiff | undefined): MotionEffect | undefined {
  if (!watch) return undefined
  const marks = watch.samples.map((sample) => `${sample.ref}|${sample.what}`)
  const gone = sense?.gone ?? []
  const came = sense?.came ?? []
  const changes = contextChanges(watch, 'commit')
  const base = { marks, gone, came }
  const nav = changes.find((change) => ['navigation', 'new-window', 'submission'].includes(change.kind))
  if (nav) return { kind: 'navigation', detail: `${nav.kind}${nav.detail ? `: ${nav.detail.slice(0, 200)}` : ''}`, ...base }
  const dialog = changes.find((change) => ['modal', 'dialog', 'layer'].includes(change.kind))
  // A browser dialog reads as its own words ("alert: Shake!"); a modal or a layer by its name.
  if (dialog) return { kind: 'dialog', detail: dialog.kind === 'dialog' ? (dialog.detail ?? 'a browser dialog').slice(0, 200) : `${dialog.kind}${dialog.detail ? `: ${dialog.detail.slice(0, 200)}` : ''}`, ...base }
  if (watch.dom > 0 && (gone.length + came.length > 0 || marks.length > 0)) {
    const quote = (lines: string[]) => lines.slice(0, 2).map((line) => `"${line.length > 50 ? `${line.slice(0, 49)}…` : line}"`).join(', ')
    const detail = [gone.length > 0 ? `gone: ${quote(gone)}` : '', came.length > 0 ? `new: ${quote(came)}` : '', gone.length + came.length === 0 ? watch.samples.map((s) => `<${s.tag}> ${s.what}`).join(', ') : ''].filter(Boolean).join('; ')
    return { kind: 'content', detail, ...base }
  }
  const scroll = sense?.scrolled[0]
  if (scroll) return { kind: 'scroll', detail: `scrolled ${scroll.target === 'page' ? 'the page' : scroll.target} by ${scroll.dx},${scroll.dy} px`, ...base, scroll }
  if (watch.style > 0) return { kind: 'style', detail: `${watch.style} class or style change(s)`, ...base }
  return undefined
}

/** Whether a control did what the motion did: the same navigation, the same elements changed or the same text, the same scroll. */
export function sameMotionEffect(motion: MotionEffect | undefined, control: MotionEffect | undefined): boolean {
  if (!motion || !control || motion.kind !== control.kind) return false
  if (motion.kind === 'navigation' || motion.kind === 'dialog') return motion.detail === control.detail
  if (motion.kind === 'scroll') return motion.scroll?.target === control.scroll?.target && Math.sign(motion.scroll?.dy ?? 0) === Math.sign(control.scroll?.dy ?? 0) && Math.sign(motion.scroll?.dx ?? 0) === Math.sign(control.scroll?.dx ?? 0)
  if (motion.kind === 'content') {
    if (motion.marks.some((mark) => control.marks.includes(mark))) return true
    return motion.gone.length + motion.came.length > 0 && motion.gone.join('\n') === control.gone.join('\n') && motion.came.join('\n') === control.came.join('\n')
  }
  return false
}

interface SensorSession {
  cdp: CDPSession
  ok: boolean
}

async function counts(page: Page): Promise<{ motion: number; orientation: number }> {
  return page.evaluate(() => ({ ...((window as unknown as SenseWindow).__rampaSensed ?? { motion: 0, orientation: 0 }) })).catch(() => ({ motion: 0, orientation: 0 }))
}

/** Plays the readings through the virtual sensors, or as synthetic events, and puts the device back at rest. */
async function drive(page: Page, session: SensorSession | undefined, via: MotionTry['via'], steps: Reading[]): Promise<void> {
  if (via === 'synthetic' || !session) {
    await page.evaluate(dispatchMotion, steps).catch(() => undefined)
    return
  }
  for (const step of steps) {
    await setReading(session.cdp, step).catch(() => undefined)
    await page.waitForTimeout(step.ms)
  }
}

/** The state of the part across its pages: whether the virtual sensors reached the page. */
interface MotionState {
  sessions: WeakMap<Page, SensorSession>
  /** The virtual sensors did not reach the page once: synthetic events from then on. */
  synthetic: boolean
}

async function tryPattern(harness: Harness, state: MotionState, pattern: MotionPattern, fresh: boolean, before?: (probe: ProbePage) => Promise<boolean>): Promise<MotionTry & { outcome?: string | undefined }> {
  const probe = await harness.page(fresh)
  const page = probe.page
  if (before && !(await before(probe))) return { pattern, via: 'synthetic', events: { motion: 0, orientation: 0 }, outcome: 'not-exercised' }
  await page.evaluate(installSenseCounter).catch(() => undefined)
  const session = state.sessions.get(page)
  const via: MotionTry['via'] = state.synthetic || !session?.ok ? 'synthetic' : 'sensors'
  const start = await counts(page)
  harness.log('activate', { label: pattern, detail: `${pattern} (${via === 'sensors' ? "the browser's virtual sensors" : 'synthetic events'})` })
  const watch = await harness.window(
    probe,
    async () => {
      await page.evaluate(() => (window as unknown as SenseWindow).__rampaSense?.begin()).catch(() => undefined)
      await drive(page, session, via, motionSteps(pattern))
    },
    { ms: 500, label: pattern },
  )
  const sense = await page.evaluate(() => (window as unknown as SenseWindow).__rampaSense?.end()).catch(() => undefined)
  const end = await counts(page)
  const events = { motion: end.motion - start.motion, orientation: end.orientation - start.orientation }
  const effect = motionEffect(watch, sense)
  // Sensors that did not reach the page: synthetic events, on a page the window left as it was.
  if (via === 'sensors' && events.motion + events.orientation === 0) {
    state.synthetic = true
    if (!effect) return tryPattern(harness, state, pattern, false)
  }
  return { pattern, via, events, ...(effect ? { effect } : {}) }
}

/** The record of a part that did not run on the page: no listener, or a failure. */
function bareRecord(browser: Browser, options: ProbeOptions, data: DeviceMotionData, durationMs: number, reason?: string): ProbeRecord {
  const settings = contextOptions(options.browserOptions)
  const viewport = settings.viewport ?? { width: 1280, height: 800 }
  return {
    kind: 'gestures',
    version: DEVICE_MOTION_VERSION,
    conditions: {
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: settings.deviceScaleFactor ?? 1,
      browser: `${browser.browserType().name()} ${browser.version()} (headless)`,
      variant: DEVICE_MOTION_VARIANT,
    },
    status: reason ? 'skipped' : 'complete',
    ...(reason ? { reason } : {}),
    guard: { blocked: [], navigations: [], dialogs: [] },
    durationMs,
    data: reason ? null : data,
  }
}

/**
 * D2's 2.5.4 part on one page. `known` are the motion listeners the gestures part read on its first load; when it could
 * not read them, this part reads them on its own first load. With no listener, no page is driven.
 */
export async function runDeviceMotionProbe(browser: Browser, url: string, options: ProbeOptions, known: MotionListenerFact[] | undefined): Promise<ProbeRecord> {
  const started = Date.now()
  const empty = (listeners: MotionListenerFact[]): DeviceMotionData => ({ listeners, sensors: false, mentions: [], tries: [], controls: [], loads: 0, actions: [], end: 'no-listener' })
  if (known && known.length === 0) return bareRecord(browser, options, empty([]), Date.now() - started)
  const state: MotionState = { sessions: new WeakMap(), synthetic: false }
  const harness = new Harness(browser, url, options, {
    kind: 'gestures',
    version: DEVICE_MOTION_VERSION,
    variant: DEVICE_MOTION_VARIANT,
    limits: DEVICE_MOTION_LIMITS,
    kits: [installSenseKit],
    page: {
      context: { hasTouch: true },
      // The virtual sensors go on, at rest, before the page loads and adds its listeners.
      beforeLoad: async (page, context) => {
        const cdp = await context.newCDPSession(page)
        let ok = true
        for (const type of SENSOR_TYPES) await cdp.send('Emulation.setSensorOverrideEnabled', { enabled: true, type }).catch(() => (ok = false))
        if (ok) await setReading(cdp, REST).catch(() => (ok = false))
        state.sessions.set(page, { cdp, ok })
      },
    },
  })
  let data: DeviceMotionData | undefined
  let conditions: ProbeRecord['conditions'] | undefined
  try {
    const first = await harness.page()
    conditions = first.conditions
    const listeners = known ?? (await motionListeners(first)) ?? []
    if (listeners.length === 0) {
      await harness.close()
      return bareRecord(browser, options, empty([]), Date.now() - started)
    }
    const mentions = await first.page.evaluate(findMotionTexts, { motion: MOTION_WORDS.source }).catch(() => [])
    data = { listeners, sensors: state.sessions.get(first.page)?.ok === true, mentions, tries: [], controls: [], loads: 0, actions: [], end: 'complete' }
    let style: DeviceMotionData['effect']
    for (const pattern of MOTION_PATTERNS) {
      if (!harness.timeLeft()) {
        data.end = 'time'
        break
      }
      const tried = await tryPattern(harness, state, pattern, false)
      data.tries.push(tried)
      if (tried.effect?.kind === 'style') style ??= { pattern, effect: tried.effect }
      else if (tried.effect) {
        data.effect = { pattern, effect: tried.effect }
        break
      }
    }
    data.sensors = !state.synthetic && data.sensors
    const effect = data.effect
    if (!effect) {
      if (style) data.effect = style
    } else {
      // Again on a second fresh load, so a failure never rests on one load.
      if (harness.timeLeft()) {
        const again = await tryPattern(harness, state, effect.pattern, true)
        data.confirmed = again.effect?.kind === effect.effect.kind
      }
      data.scrolls = effect.effect.kind === 'scroll' && effect.effect.scroll?.scrollable === true
      const named = motionFunctions(mentions)
      const probe = await harness.page(true)
      const listed = await probe.page
        .evaluate(findMotionControls, {
          named: named.length > 0 ? named.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') : null,
          functions: FUNCTION_WORDS.source,
          motion: MOTION_WORDS.source,
        })
        .catch(() => [])
      const alternatives = data.scrolls ? [] : listed.filter((c) => c.role === 'alternative').slice(0, MAX_ALTERNATIVES)
      const switches = listed.filter((c) => c.role === 'switch').slice(0, MAX_SWITCHES)
      let reproduced = false
      for (const { facts, ...control } of [...alternatives, ...switches]) {
        // One control that does what the motion did is enough; the switches are still tried.
        if (control.role === 'alternative' && reproduced) continue
        const entry: MotionControl = control
        data.controls.push(entry)
        const skip = motionControlSkip(facts, harness.origin, control.role)
        if (skip) {
          entry.skipped = skip.detail ? `${skip.reason}: ${skip.detail}` : skip.reason
          harness.skip(control, skip.reason, skip.detail)
          continue
        }
        if (!harness.timeLeft()) {
          entry.skipped = 'time budget'
          data.end = 'time'
          continue
        }
        if (control.role === 'alternative') {
          const did = await clickControl(harness, control)
          if (typeof did === 'string') entry.skipped = did
          else {
            entry.reproduced = sameMotionEffect(effect.effect, did)
            if (!entry.reproduced && did) entry.did = did.detail
            reproduced ||= entry.reproduced
          }
        } else {
          // The switch toggled, then the same motion: does it still act?
          let toggled: string | undefined
          const tried = await tryPattern(harness, state, effect.pattern, true, async (p) => {
            const did = await clickControl(harness, control, p)
            if (typeof did === 'string') toggled = did
            return toggled === undefined
          })
          if (toggled) entry.skipped = toggled
          else if (!tried.outcome) entry.stopped = !tried.effect || tried.effect.kind !== effect.effect.kind
        }
      }
    }
  } catch (error) {
    await harness.close()
    return bareRecord(browser, options, empty(known ?? []), Date.now() - started, `probe failed: ${(error instanceof Error ? error.message : String(error)).split('\n')[0]}`)
  }
  await harness.close()
  if (!data || !conditions) return bareRecord(browser, options, empty([]), Date.now() - started, 'probe failed: the first page did not load')
  data.loads = harness.loads
  data.actions = harness.actions
  const record = harness.record(data, conditions, data.end === 'time' ? `time budget reached (${DEVICE_MOTION_LIMITS.timeMs / 1000} s)` : undefined)
  return record
}

/** The skip list for a control of this probe: a switch named "Disable shake to undo" holds a skip-list word, and turning motion off is what is asked of it. */
function motionControlSkip(facts: ControlFacts, origin: string, role: MotionControl['role']): ReturnType<typeof skipReason> {
  const skip = skipReason(facts, origin)
  if (skip && role === 'switch' && skip.reason === 'destructive' && ['deactivate', 'desativar', 'desactivar', 'disable'].includes(skip.detail ?? '')) return undefined
  return skip
}

/**
 * Clicks a control on a fresh load (or on `on`, the page given), and reads what it did. A string says why it was not
 * clicked.
 */
async function clickControl(harness: Harness, control: Pick<MotionControl, 'ref' | 'id' | 'label' | 'role'>, on?: ProbePage): Promise<MotionEffect | undefined | string> {
  const probe = on ?? (await harness.page(true))
  const page = probe.page
  if (!(await harness.locate(probe, control, { check: (facts) => motionControlSkip(facts, harness.origin, control.role) })))
    return harness.lastSkip ? `${harness.lastSkip.reason}${harness.lastSkip.detail ? `: ${harness.lastSkip.detail}` : ''} (read again on this load)` : 'not found on a fresh load'
  // A checkbox hidden behind a styled switch is clicked through its label.
  let at = await harness.aim(probe, control)
  if (!('x' in at)) at = await harness.aim(probe, control, 'label')
  if (!('x' in at)) return 'cover' in at ? `covered by <${at.cover.tag}>` : 'not showing'
  const point = at
  harness.log('activate', { ref: control.ref, label: control.label, detail: 'clicked' })
  const watch = await harness.window(probe, async () => {
    await page.evaluate(() => (window as unknown as SenseWindow).__rampaSense?.begin()).catch(() => undefined)
    await page.mouse.click(point.x, point.y)
  }, { ref: control.ref, label: control.label })
  const sense = await page.evaluate(() => (window as unknown as SenseWindow).__rampaSense?.end()).catch(() => undefined)
  return motionEffect(watch, sense)
}
