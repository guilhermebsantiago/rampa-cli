import type { A11yNode, ProbeRecord } from '../../snapshot/schema.ts'
import { walkTree } from '../../snapshot/tree.ts'
import { nativeSignature } from '../identity.ts'
import type { Orientation, OrientationCover, OrientationData, OrientationLoad, OrientationState, RotatedElement, ShownText } from '../orientation.ts'
import {
  type NativePlatform,
  type NativeScreen,
  NativeMatcher,
  activeNodes,
  drawnText,
  inkShare,
  intersect,
  labelOf,
  nativeElement,
  pixelHash,
  shown,
} from './screen.ts'

/**
 * Orientation on an app screen (B6 of the coverage plan, D7): the device set upright, turned sideways, and set upright
 * again, the screen read each time. It writes the record the web orientation probe writes (probes/orientation.ts),
 * which `rampa/orientation` reads:
 * - An app that keeps its screen upright while the device is held sideways shows its content turned a quarter
 *   against the device, which is what ACT b33eff fails on the web. The display's rotation, as the platform reports
 *   it, against the rotation the probe asked for, is recorded as the rotation of the whole screen (the snapshot's root).
 * - The text each state shows that the other does not, and a layer over most of the window, for a "rotate your
 *   device" message and content lost in one orientation. A dump holds only what is on the screen, so a list that
 *   shows fewer rows sideways shows less text: content gone with no message is only ever sent to review.
 */

export const NATIVE_ORIENTATION_VERSION = '1'
const MAX_SHOWN = 8

export interface OrientationStep {
  /** The orientation the probe asked for. */
  requested: Orientation
  /** The device rotation asked for, in quarter turns: 0 upright, 1 (or 3) sideways. */
  quarter: number
  screen: NativeScreen
  /** The display's rotation the platform reported, in quarter turns; undefined when it did not say. */
  display: number | undefined
  /** The device took the setting: Android's user_rotation read back, the orientation an XCUITest export says it set. */
  set: boolean
}

export interface NativeOrientationData extends OrientationData {
  platform: NativePlatform
  /** Per step: what the probe asked for, and what the display did. */
  steps: Array<{ requested: Orientation; quarter: number; display: number | null; set: boolean; window: { width: number; height: number } }>
}

/** An angle in quarter turns as degrees in (-180, 180]. */
function degrees(quarters: number): number {
  const q = ((quarters % 4) + 4) % 4
  return q === 3 ? -90 : q * 90
}

/** The display's rotation: what the platform said, else the window's shape (wider than tall is sideways). */
function displayOf(step: OrientationStep): number {
  if (step.display !== undefined) return step.display
  const sideways = step.screen.window.width > step.screen.window.height
  return sideways ? (step.quarter % 2 === 1 ? step.quarter : 1) : 0
}

interface TextItem {
  node: A11yNode
  signature: string
  text: string
}

function textsOf(screen: NativeScreen): TextItem[] {
  const out: TextItem[] = []
  for (const node of activeNodes(screen.root)) {
    const text = drawnText(node)
    if (!text || !shown(node) || !node.bounds || !intersect(node.bounds, screen.window)) continue
    out.push({ node, signature: `${nativeSignature(node)}|${text}`, text })
  }
  return out
}

/**
 * A layer over most of the window: the last node whose box holds at least 80% of a 5×5 grid of points over the
 * window and that leaves some of the screen's text outside it, so it lies over other content. Whether it is opaque
 * cannot be told from a dump, so it is never counted as hiding what is under it.
 */
function coverOf(screen: NativeScreen, map: Map<A11yNode, A11yNode>, texts: TextItem[]): OrientationCover | undefined {
  const w = screen.window
  let found: OrientationCover | undefined
  for (const node of activeNodes(screen.root)) {
    if (node === screen.root || !node.bounds || !shown(node)) continue
    const b = node.bounds
    let inside = 0
    for (let i = 0; i < 5; i++) {
      for (let j = 0; j < 5; j++) {
        const x = w.x + ((i + 0.5) * w.width) / 5
        const y = w.y + ((j + 0.5) * w.height) / 5
        if (x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height) inside++
      }
    }
    if (inside < 20) continue
    const subtree = new Set(walkTree(node))
    if (texts.every((item) => subtree.has(item.node))) continue
    const own = [...subtree].flatMap((inner) => {
      const value = drawnText(inner) ?? (inner.role === 'img' ? inner.name : undefined)
      return value ? [value] : []
    })
    const text = own.join(' ').replace(/\s+/g, ' ').trim()
    const element = nativeElement(node, map.get(node))
    found = { ...element, text: text.slice(0, 200), chars: text.replace(/\s/g, '').length, opaque: false, position: node.role === 'window' ? 'window' : 'layer', share: inside / 25 }
  }
  return found
}

function stateOf(step: OrientationStep, reached: 'load' | 'turn', other: OrientationStep, matcher: NativeMatcher): OrientationState {
  const screen = step.screen
  const map = matcher.map(screen.root)
  const texts = textsOf(screen)
  const elsewhere = new Set(textsOf(other.screen).map((item) => item.signature))
  const only: ShownText[] = []
  let onlyChars = 0
  for (const item of texts) {
    if (elsewhere.has(item.signature)) continue
    const chars = item.text.replace(/\s/g, '').length
    onlyChars += chars
    if (only.length < MAX_SHOWN) {
      const element = nativeElement(item.node, map.get(item.node))
      only.push({ ref: element.ref, id: element.id, tag: element.tag, label: element.label, text: item.text.slice(0, 200), chars })
    }
  }
  const chars = texts.reduce((sum, item) => sum + item.text.replace(/\s/g, '').length, 0)
  const display = displayOf(step)
  const turned = degrees(display - step.quarter) !== 0
  const cover = coverOf(screen, map, texts)
  return {
    orientation: step.requested,
    reached,
    viewport: { width: screen.window.width, height: screen.window.height },
    screen: { type: display % 2 === 0 ? 'portrait-primary' : 'landscape-primary', angle: degrees(display) < 0 ? 270 : degrees(display) },
    matchesPortrait: screen.window.height >= screen.window.width,
    windowOrientation: degrees(display),
    ok: step.set,
    chars,
    elements: texts.length,
    viewChars: chars,
    rotatedCount: turned ? 1 : 0,
    ...(cover ? { cover } : {}),
    only,
    onlyChars,
    pseudo: [],
    ...(screen.screenshot ? { shot: { hash: pixelHash(screen.screenshot), ink: inkShare(screen.screenshot) } } : {}),
  }
}

/** The whole screen as a rotated element, when the display did not follow the device between two steps. */
function rotationsOf(a: OrientationStep, b: OrientationStep, matcher: NativeMatcher, chars: number): RotatedElement[] {
  const angleA = degrees(displayOf(a) - a.quarter)
  const angleB = degrees(displayOf(b) - b.quarter)
  if (angleA === angleB) return []
  const root = matcher.root
  const element = nativeElement(root, root)
  const media = [...walkTree(b.screen.root)].some((node) => node.role === 'img' && shown(node))
  const describe = (step: OrientationStep) => `display at ${degrees(displayOf(step))}°, device at ${degrees(step.quarter)}°`
  return [
    {
      ...element,
      label: element.label || labelOf(root) || String(root.native.package ?? root.native.bundleIdentifier ?? ''),
      a: angleA,
      b: angleB,
      ta: describe(a),
      tb: describe(b),
      chars,
      media,
      area: 1,
      // The angles behind a and b: how the device was held and where the display was, in each state.
      turn: { device: [degrees(a.quarter), degrees(b.quarter)], display: [degrees(displayOf(a)), degrees(displayOf(b))] },
    } as RotatedElement,
  ]
}

export interface OrientationInput {
  platform: NativePlatform
  snapshotRoot: A11yNode
  conditions: ProbeRecord['conditions']
  /** Upright, sideways, and upright again: two turns, each compared as the web probe compares a load and a turn. */
  steps: OrientationStep[]
  durationMs: number
  /** A phone (the coverage line says so) rather than a tablet. */
  mobile: boolean
  /** Screenshot pixels per unit, for the record. */
  scale: number
}

export function orientationRecord(input: OrientationInput): ProbeRecord {
  const matcher = new NativeMatcher(input.snapshotRoot)
  const upright = input.steps.find((step) => step.requested === 'portrait')
  const window = upright?.screen.window ?? input.steps[0]?.screen.window ?? { x: 0, y: 0, width: 0, height: 0 }
  const portrait = { width: Math.min(window.width, window.height), height: Math.max(window.width, window.height) }
  const name = `${portrait.width}x${portrait.height}`
  const loads: OrientationLoad[] = []
  for (let i = 0; i + 1 < input.steps.length; i++) {
    const a = input.steps[i] as OrientationStep
    const b = input.steps[i + 1] as OrientationStep
    if (a.requested === b.requested) continue
    const first = stateOf(a, 'load', b, matcher)
    const second = stateOf(b, 'turn', a, matcher)
    loads.push({ pair: name, loaded: a.requested, states: [first, second], rotations: rotationsOf(a, b, matcher, second.chars), ms: 0 })
  }
  const data: NativeOrientationData = {
    platform: input.platform,
    pairs: [{ name, portrait, landscape: { width: portrait.height, height: portrait.width }, mobile: input.mobile, scale: input.scale }],
    loads,
    locks: [],
    end: 'complete',
    steps: input.steps.map((step) => ({ requested: step.requested, quarter: step.quarter, display: step.display ?? null, set: step.set, window: { width: step.screen.window.width, height: step.screen.window.height } })),
  }
  const unset = input.steps.filter((step) => !step.set).length
  return {
    kind: 'orientation',
    version: NATIVE_ORIENTATION_VERSION,
    conditions: { ...input.conditions, viewport: { width: window.width, height: window.height }, variant: 'orientation' },
    status: loads.length === 0 ? 'skipped' : unset > 0 ? 'partial' : 'complete',
    ...(loads.length === 0 ? { reason: 'the screen was not read in both orientations' } : unset > 0 ? { reason: `the device did not take the rotation in ${unset} step(s)` } : {}),
    guard: { blocked: [], navigations: [], dialogs: [] },
    durationMs: input.durationMs,
    data: loads.length === 0 ? null : data,
  }
}
