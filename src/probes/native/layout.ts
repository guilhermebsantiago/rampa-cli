import type { A11yNode, Bounds, ProbeRecord } from '../../snapshot/schema.ts'
import { walkTree } from '../../snapshot/tree.ts'
import { nativeSignature, nativeType } from '../identity.ts'
import type { InPageIdentity } from '../kit.ts'
import { type LayoutBox, type LayoutMeasure, type LayoutOverlap, type MissingGroup, readable, slimPair } from '../layout.ts'
import {
  type NativePlatform,
  type NativeScreen,
  NativeMatcher,
  activeNodes,
  ancestors,
  drawnText,
  intersect,
  nativeElement,
  parentsOf,
  rectOf,
  scrolls,
} from './screen.ts'

/**
 * Text at 200% on an app screen (B4 of the coverage plan, D7): the screen read at the system's default text size and
 * again with text at 200% (Android's font_scale 2.0; on iOS the nearest Dynamic Type size, set by the UI test). It
 * writes the layout record the 200% zoom probe writes (probes/layout.ts: a baseline and a variant measure of text
 * boxes, and text that went missing), under its own variant, `text-size-200`, which `rampa/resize-text` reads.
 *
 * What a dump can show, and so what is measured:
 * - Android reports each node's bounds clipped to what its ancestors show. Text never needs less height at a larger
 *   size when it is no wider, so a text box that comes out shorter than it was at 100% is cut by at least the
 *   difference, at the edge of the ancestor it is flush with; through a container that scrolls, it is reachable and
 *   not cut. Text cut inside a box that keeps its size (a fixed-height button) cannot be seen this way.
 * - iOS frames are not clipped: text that reaches past the window, outside any container that scrolls, is cut by the
 *   part past the edge.
 * - Text an app shortens itself ("Free delivery on…") is cut to an ellipsis. A TextView's own ellipsize, and Compose's,
 *   keep the full text in the dump, so they are not seen.
 * - Text shown at 100% and gone from the dump at 200%, outside containers that scroll, went missing; the screen read
 *   again once the setting is back says whether the size, not a timer, hid it.
 * - Text of two nodes that overlaps at 200% and did not at 100%.
 */

export const NATIVE_LAYOUT_VERSION = '1'
export const TEXT_SIZE_VARIANT = 'text-size-200'
const MAX_OVERLAPS = 400
const MISSING_BUDGET = 200

/** An issue Apple's accessibility audit reported at the larger size (iOS 17 and later), tied to a snapshot node when it can be. */
export interface AuditIssue {
  /** textClipped, dynamicType... */
  type: string
  description: string
  ref?: string | undefined
  id?: InPageIdentity | undefined
  label?: string | undefined
}

export interface NativeTextSizeData {
  platform: NativePlatform
  /** The window at the default size. */
  from: { width: number; height: number }
  /** How much larger body text is: 2 for font_scale 2.0, 33/17 for iOS's AX2. */
  scale: number
  /** How the size was set: `font_scale 2.0`, or the content size category. */
  setting: string
  baseline: LayoutMeasure
  variant: LayoutMeasure
  missing: MissingGroup[]
  audit?: AuditIssue[] | undefined
}

interface Built {
  box: LayoutBox
  node: A11yNode
}

const cut60 = (value: string) => (value.length > 60 ? `${value.slice(0, 59)}…` : value)
const ELLIPSIS = /(…|\.\.\.)\s*$/

/** Every node that draws text, as a layout box: the snapshot's ref and identity, and a key that pairs it across screens. */
function textBoxes(screen: NativeScreen, map: Map<A11yNode, A11yNode>, matcher: NativeMatcher): Built[] {
  const parents = parentsOf(screen.root)
  const out: Built[] = []
  for (const node of activeNodes(screen.root)) {
    const value = drawnText(node)
    if (!value || !node.bounds || node.states.includes('hidden') || node.bounds.width < 1 || node.bounds.height < 1) continue
    const mapped = map.get(node)
    const element = nativeElement(node, mapped)
    const key = mapped ? matcher.keyOf(mapped) : undefined
    const vis = intersect(node.bounds, screen.window)
    const box: LayoutBox = {
      ref: element.ref,
      ...(key !== undefined ? { key } : {}),
      id: element.id,
      tag: element.tag,
      kind: 'text',
      text: cut60(value),
      rect: rectOf(node.bounds),
      line: 0,
      vis: vis ? rectOf(vis) : null,
      cut: { left: 0, right: 0, top: 0, bottom: 0 },
      own: true,
      ah: false,
      foreign: false,
    }
    const chain = ancestors(node, parents)
    const scroller = chain.find(scrolls)
    if (scroller) box.scroller = (map.get(scroller) ?? scroller).ref
    // A name that holds the whole text (a content description) is a way to read it when it is cut.
    if (node.name && node.native.nameFrom === 'content-desc' && node.name.length > value.length) box.full = true
    // iOS frames are not clipped: what reaches past the window, outside anything that scrolls, cannot be seen.
    if (screen.platform === 'ios' && !scroller && vis) {
      const w = screen.window
      box.cut = {
        left: Math.max(0, w.x - node.bounds.x),
        right: Math.max(0, node.bounds.x + node.bounds.width - (w.x + w.width)),
        top: Math.max(0, w.y - node.bounds.y),
        bottom: Math.max(0, node.bounds.y + node.bounds.height - (w.y + w.height)),
      }
      if (box.cut.left + box.cut.right + box.cut.top + box.cut.bottom > 0) box.clipBy = (map.get(screen.root) ?? screen.root).ref
    }
    out.push({ box, node })
  }
  return out
}

/** Pairs of text boxes of different nodes, neither inside the other, whose boxes overlap by 4×4 px or more. */
function overlapsOf(built: Built[], screen: NativeScreen): LayoutOverlap[] {
  const parents = parentsOf(screen.root)
  const out: LayoutOverlap[] = []
  for (let i = 0; i < built.length && out.length < MAX_OVERLAPS; i++) {
    const a = built[i] as Built
    if (!a.box.vis) continue
    const chainA = new Set(ancestors(a.node, parents))
    for (let j = i + 1; j < built.length && out.length < MAX_OVERLAPS; j++) {
      const b = built[j] as Built
      if (!b.box.vis || chainA.has(b.node) || ancestors(b.node, parents).includes(a.node)) continue
      const overlap = intersect(a.box.vis, b.box.vis)
      if (!overlap || overlap.width < 4 || overlap.height < 4) continue
      out.push({ a: a.box.ref, b: b.box.ref, ...(a.box.key !== undefined ? { ka: a.box.key } : {}), ...(b.box.key !== undefined ? { kb: b.box.key } : {}), width: overlap.width, height: overlap.height })
    }
  }
  return out
}

function measureOf(screen: NativeScreen, built: Built[]): LayoutMeasure {
  return {
    viewport: { width: screen.window.width, height: screen.window.height },
    clientWidth: screen.window.width,
    scrollWidth: screen.window.width,
    // An app screen does not scroll sideways as a page does; a container that scrolls is marked on each box.
    scrollsX: false,
    measured: built.length,
    boxes: built.map((item) => item.box),
    overlaps: overlapsOf(built, screen),
    truncated: false,
  }
}

/**
 * Android: a box that came out shorter at 200% than at 100%, no wider than before, is cut by at least the difference,
 * at the edge it shares with its ancestors. Bounds are clipped all the way up, so every ancestor on that edge is flush
 * with it; the outermost one (short of the window) is named as what cuts it. When a container that scrolls is among
 * its ancestors and ends on that same edge, the text is only scrolled partly out of view: the rest can be reached.
 */
function shrinkCut(item: Built, before: LayoutBox, screen: NativeScreen, map: Map<A11yNode, A11yNode>): void {
  const { box, node } = item
  const now = node.bounds
  if (!now || !box.vis) return
  const lost = before.rect.height - now.height
  if (lost <= 2 || now.width > before.rect.width * 1.1 + 2) return
  const parents = parentsOf(screen.root)
  const chain = ancestors(node, parents).filter((ancestor) => ancestor.bounds && ancestor !== screen.root)
  const near = (a: number, b: number) => Math.abs(a - b) <= 1
  const bottom = now.y + now.height
  const atBottom = chain.filter((ancestor) => near((ancestor.bounds as Bounds).y + (ancestor.bounds as Bounds).height, bottom))
  const atTop = chain.filter((ancestor) => near((ancestor.bounds as Bounds).y, now.y))
  // The cut is on the side the box shares with an ancestor it no longer fills; bottom when both or neither.
  const side: 'top' | 'bottom' = atBottom.length === 0 && atTop.length > 0 ? 'top' : 'bottom'
  const flush = side === 'top' ? atTop : atBottom
  // No ancestor on that edge: the box shrank for a reason the dump does not show, which is not evidence of a cut.
  // A container that scrolls around the text and ends where the text is cut: scrolled partly out, not cut.
  if (flush.length === 0 || flush.some(scrolls)) return
  const clipper = flush.at(-1)
  box.cut = { ...box.cut, [side]: lost }
  box.rect = side === 'top' ? { ...box.rect, y: box.rect.y - lost, height: box.rect.height + lost } : { ...box.rect, height: box.rect.height + lost }
  if (clipper) box.clipBy = (map.get(clipper) ?? clipper).ref
}

/**
 * Android and iOS: text the app shortened itself at 200% ("Free delivery on…"), which the matcher cannot pair by name;
 * paired here with the node of the same type, id and role whose text at 100% starts with what is left.
 */
function pairTruncated(variant: Built[], baseline: Built[]): void {
  const used = new Set(variant.flatMap((item) => (item.box.key !== undefined ? [item.box.key] : [])))
  for (const item of variant) {
    if (item.box.key !== undefined) continue
    const shown = drawnText(item.node) ?? ''
    if (!ELLIPSIS.test(shown)) continue
    const stem = shown.replace(ELLIPSIS, '').trim()
    if (stem.length < 2) continue
    const id = nativeId(item.node)
    const candidates = baseline.filter((other) => {
      if (other.box.key === undefined || used.has(other.box.key)) return false
      const full = drawnText(other.node) ?? ''
      return nativeType(other.node) === nativeType(item.node) && nativeId(other.node) === id && other.node.role === item.node.role && full.length > stem.length && full.startsWith(stem)
    })
    const pair = candidates.length === 1 ? candidates[0] : undefined
    if (!pair || pair.box.key === undefined) continue
    used.add(pair.box.key)
    const full = drawnText(pair.node) ?? ''
    const perChar = (item.node.bounds?.width ?? 0) / Math.max(1, shown.length)
    item.box.ref = pair.box.ref
    item.box.id = pair.box.id
    item.box.tag = pair.box.tag
    item.box.key = pair.box.key
    item.box.ellipsis = true
    // The characters left out, at the width each shown character takes: an estimate of what is cut across.
    item.box.cut = { ...item.box.cut, right: Math.max(2, Math.round((full.length - stem.length) * perChar)) }
    if (pair.box.full) item.box.full = true
  }
}

function nativeId(node: A11yNode): string {
  return String(node.native.resourceId ?? node.native.identifier ?? '')
}

/** Text shown at 100% that no node shows at 200%, outside containers that scroll, grouped by the nearest container still there. */
function missingText(baseline: Built[], variant: Built[], base: NativeScreen, baseMap: Map<A11yNode, A11yNode>, scaledMap: Map<A11yNode, A11yNode>, backMap: Map<A11yNode, A11yNode> | undefined): MissingGroup[] {
  const shownNow = new Set(variant.filter((item) => readable(item.box)).flatMap((item) => (item.box.key !== undefined ? [item.box.key] : [])))
  const textNow = new Set(variant.filter((item) => readable(item.box)).map((item) => item.box.text.toLowerCase()))
  const present = new Set(scaledMap.values())
  const parents = parentsOf(base.root)
  const groups = new Map<A11yNode, MissingGroup & { nodes: A11yNode[] }>()
  let looked = 0
  for (const item of baseline) {
    if (looked >= MISSING_BUDGET) break
    const key = item.box.key
    if (key === undefined || item.box.scroller || !readable(item.box) || shownNow.has(key) || textNow.has(item.box.text.toLowerCase())) continue
    looked++
    const chain = ancestors(item.node, parents)
    // The nearest container the larger text left on the screen: what it was pushed out of.
    const holder = chain.find((ancestor) => {
      const mapped = baseMap.get(ancestor)
      return mapped !== undefined && present.has(mapped) && ancestor !== base.root
    })
    const root = holder ?? item.node
    let group = groups.get(root)
    if (!group) {
      const element = nativeElement(root, baseMap.get(root))
      group = { root: { ref: element.ref, id: element.id, tag: element.tag, label: element.label }, reason: holder ? 'clipped' : 'removed', boxes: 0, sample: [], members: [], nodes: [] }
      groups.set(root, group)
    }
    group.boxes++
    const mapped = baseMap.get(item.node)
    if (mapped) group.nodes.push(mapped)
    if (group.sample.length < 3) group.sample.push(item.box.text)
    if (group.members.length < 5) group.members.push({ ref: item.box.ref, id: item.box.id })
  }
  // Shown again once the setting is back: the size hid it, not a timer or a carousel.
  const shownBack = backMap ? new Set([...backMap.entries()].filter(([node]) => node.bounds && node.bounds.width >= 2 && node.bounds.height >= 2).map(([, mapped]) => mapped)) : undefined
  return [...groups.values()].map(({ nodes, ...group }) => (shownBack ? { ...group, back: nodes.filter((node) => shownBack.has(node)).length } : group))
}

export interface TextSizeInput {
  platform: NativePlatform
  snapshotRoot: A11yNode
  conditions: ProbeRecord['conditions']
  /** The screen at the default size, at 200%, and back at the default once the setting is restored. */
  base: NativeScreen
  scaled: NativeScreen
  back?: NativeScreen | undefined
  setting: string
  scale: number
  durationMs: number
  audit?: Array<{ type: string; description: string; node?: A11yNode | undefined }> | undefined
}

/** The share of the screen's named nodes still there in another screen: under a fifth, the app showed another screen. */
export function sameScreenShare(a: NativeScreen, b: NativeScreen): number {
  const names = (screen: NativeScreen) => {
    const out = new Set<string>()
    for (const node of activeNodes(screen.root)) if (node.name && node.bounds) out.add(nativeSignature(node))
    return out
  }
  const before = names(a)
  if (before.size === 0) return 1
  const after = names(b)
  let kept = 0
  for (const signature of before) if (after.has(signature)) kept++
  return kept / before.size
}

/** The text-size record, built from the screens a device (or an XCUITest export) gave. */
export function textSizeRecord(input: TextSizeInput): ProbeRecord {
  const matcher = new NativeMatcher(input.snapshotRoot)
  const conditions: ProbeRecord['conditions'] = { ...input.conditions, viewport: { width: input.scaled.window.width, height: input.scaled.window.height }, variant: TEXT_SIZE_VARIANT }
  const share = sameScreenShare(input.base, input.scaled)
  if (share < 0.2) {
    return {
      kind: 'layout',
      version: NATIVE_LAYOUT_VERSION,
      conditions,
      status: 'skipped',
      reason: `the app showed another screen when the text size changed (${Math.round(share * 100)}% of the named nodes stayed): nothing was compared`,
      guard: { blocked: [], navigations: [], dialogs: [] },
      durationMs: input.durationMs,
      data: null,
    }
  }
  const baseMap = matcher.map(input.base.root)
  const scaledMap = matcher.map(input.scaled.root)
  const baseline = textBoxes(input.base, baseMap, matcher)
  const variant = textBoxes(input.scaled, scaledMap, matcher)
  pairTruncated(variant, baseline)
  if (input.platform === 'android') {
    const before = new Map(baseline.flatMap((item) => (item.box.key !== undefined ? [[item.box.key, item.box] as const] : [])))
    for (const item of variant) {
      const was = item.box.key !== undefined ? before.get(item.box.key) : undefined
      if (was && !item.box.ellipsis) shrinkCut(item, was, input.scaled, scaledMap)
    }
  }
  const backMap = input.back ? matcher.map(input.back.root) : undefined
  const missing = missingText(baseline, variant, input.base, baseMap, scaledMap, backMap)
  const slim = slimPair(measureOf(input.base, baseline), measureOf(input.scaled, variant))
  const audit = (input.audit ?? []).map((issue): AuditIssue => {
    if (!issue.node) return { type: issue.type, description: issue.description }
    const element = nativeElement(issue.node, scaledMap.get(issue.node))
    return { type: issue.type, description: issue.description, ref: element.ref, id: element.id, label: element.label }
  })
  const data: NativeTextSizeData = {
    platform: input.platform,
    from: { width: input.base.window.width, height: input.base.window.height },
    scale: input.scale,
    setting: input.setting,
    baseline: slim.before,
    variant: slim.after,
    missing,
    ...(input.audit ? { audit } : {}),
  }
  return {
    kind: 'layout',
    version: NATIVE_LAYOUT_VERSION,
    conditions,
    status: input.back || input.platform === 'ios' ? 'complete' : 'partial',
    ...(input.back || input.platform === 'ios' ? {} : { reason: 'the screen was not read again once the text size was restored' }),
    guard: { blocked: [], navigations: [], dialogs: [] },
    durationMs: input.durationMs,
    data,
  }
}

/** The node of a screen at a frame and with a label, as Apple's audit names the element of an issue. */
export function nodeAt(screen: NativeScreen, frame: Bounds | undefined, label: string | undefined): A11yNode | undefined {
  if (!frame) return undefined
  const near = (a: number, b: number) => Math.abs(a - b) <= 1
  for (const node of walkTree(screen.root)) {
    const b = node.bounds
    if (!b || !near(b.x, frame.x) || !near(b.y, frame.y) || !near(b.width, frame.width) || !near(b.height, frame.height)) continue
    if (label === undefined || node.name === label || node.text === label) return node
  }
  return undefined
}
