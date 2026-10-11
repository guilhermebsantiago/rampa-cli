import { createHash } from 'node:crypto'
import type { RgbaImage } from '../../pixels/png.ts'
import type { A11yNode, Bounds } from '../../snapshot/schema.ts'
import { walkTree } from '../../snapshot/tree.ts'
import { nativeSignature, snapshotSignature, tagOf } from '../identity.ts'
import type { InPageElement, InPageRect } from '../kit.ts'

/**
 * What the native probes share (docs/probes.md, "App screens"): a screen as one step left it, read the way the
 * collector reads it (src/surfaces/android/uiautomator.ts, src/surfaces/ios.ts), and how a node of that screen is tied
 * to the snapshot node it stands for. The probes write the same records the web probes write, with the snapshot's
 * refs and identities in them, so the probe rules read them unchanged.
 */

export type NativePlatform = 'android' | 'ios'

/** One state of an app screen, read after a step: a key pressed, a setting changed, the device turned. */
export interface NativeScreen {
  platform: NativePlatform
  /** The normalized tree, as the collector builds it: refs, roles, names, states and bounds. */
  root: A11yNode
  /** The app's window, in the tree's units: screen pixels on Android, points on iOS. */
  window: Bounds
  screenshot?: RgbaImage | undefined
  /** Screenshot pixels per tree unit: 1 on Android. */
  scale: number
  /** The display's rotation in quarter turns, as the platform reported it; undefined when it did not say. */
  rotation?: number | undefined
  /** The on-screen keyboard (a system window over the app), when the dump shows it. */
  ime?: Bounds | undefined
  /** The app in front: the Android package, the iOS bundle id. */
  app?: string | undefined
}

/** A node a person can see: it has a box of at least 1×1 and is neither hidden nor scrolled off the screen. */
export function shown(node: A11yNode): boolean {
  return Boolean(node.bounds && node.bounds.width >= 1 && node.bounds.height >= 1 && !node.states.includes('hidden') && !node.states.includes('offscreen'))
}

/** Nodes of the windows a person is on: a window the dump marks inactive (the one under a dialog) is left out. */
export function* activeNodes(root: A11yNode): Generator<A11yNode> {
  const stack: A11yNode[] = [root]
  while (stack.length > 0) {
    const node = stack.pop()
    if (!node) break
    if (node !== root && node.role === 'window' && node.states.includes('inactive')) continue
    yield node
    for (let i = node.children.length - 1; i >= 0; i--) {
      const child = node.children[i]
      if (child) stack.push(child)
    }
  }
}

/** The node with input focus, in the window a person is on; the last one in document order when the dump marks several. */
export function focusedNode(screen: NativeScreen): A11yNode | undefined {
  let found: A11yNode | undefined
  for (const node of activeNodes(screen.root)) if (node !== screen.root && node.states.includes('focused')) found = node
  return found
}

/** The box around every node with bounds: the app's window. */
export function windowOf(root: A11yNode): Bounds {
  let x0 = Number.POSITIVE_INFINITY
  let y0 = Number.POSITIVE_INFINITY
  let x1 = 0
  let y1 = 0
  for (const node of walkTree(root)) {
    const b = node.bounds
    if (!b || node.states.includes('offscreen')) continue
    x0 = Math.min(x0, b.x)
    y0 = Math.min(y0, b.y)
    x1 = Math.max(x1, b.x + b.width)
    y1 = Math.max(y1, b.y + b.height)
  }
  if (!Number.isFinite(x0)) return { x: 0, y: 0, width: 0, height: 0 }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

export function intersect(a: Bounds, b: Bounds): Bounds | undefined {
  const x0 = Math.max(a.x, b.x)
  const y0 = Math.max(a.y, b.y)
  const x1 = Math.min(a.x + a.width, b.x + b.width)
  const y1 = Math.min(a.y + a.height, b.y + b.height)
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : undefined
}

export function sameBounds(a: Bounds | undefined, b: Bounds | undefined, tolerance = 1): boolean {
  return Boolean(a && b && Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance && Math.abs(a.width - b.width) <= tolerance && Math.abs(a.height - b.height) <= tolerance)
}

export function rectOf(bounds: Bounds): InPageRect {
  return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
}

/** What a message calls a node: its name, its text, or what it draws, cut to 80 characters. */
export function labelOf(node: A11yNode): string {
  const rendered = typeof node.native.renderedText === 'string' ? node.native.renderedText : ''
  const value = (node.name || node.text || rendered || '').replace(/\s+/g, ' ').trim()
  return value.length > 80 ? `${value.slice(0, 79)}…` : value
}

/** A node as a probe record names it: the snapshot node it stands for when the probe could tell, else itself. */
export function nativeElement(node: A11yNode, mapped: A11yNode | undefined): InPageElement {
  const target = mapped ?? node
  const tag = tagOf(target) ?? target.role
  return { ref: target.ref, id: { tag, sig: snapshotSignature(target) }, tag, role: target.role, label: labelOf(target) }
}

/**
 * Ties the nodes of a screen read during a probe to the snapshot's nodes. Refs are paths, and a list that scrolled or a
 * dialog that opened shifts them, so nodes are paired by identity (type, resource-id or identifier, role, name): one
 * node of that identity on each side is a pair; as many on each side are paired in document order; otherwise a node
 * keeps its pair only when its ref is the same. The rest stay unpaired, and the rules count their facts as unmatched.
 */
export class NativeMatcher {
  readonly root: A11yNode
  private readonly bySignature = new Map<string, A11yNode[]>()
  private readonly order = new Map<A11yNode, number>()

  constructor(root: A11yNode) {
    this.root = root
    let index = 0
    for (const node of walkTree(root)) {
      this.order.set(node, index++)
      if (node === root) continue
      const signature = nativeSignature(node)
      const list = this.bySignature.get(signature)
      if (list) list.push(node)
      else this.bySignature.set(signature, [node])
    }
  }

  /** The snapshot node's place in document order: a key that stays the same for every screen paired with it. */
  keyOf(node: A11yNode): number | undefined {
    return this.order.get(node)
  }

  /** Every node of `screenRoot` paired with the snapshot node it stands for, when that can be told. */
  map(screenRoot: A11yNode): Map<A11yNode, A11yNode> {
    const result = new Map<A11yNode, A11yNode>([[screenRoot, this.root]])
    const local = new Map<string, A11yNode[]>()
    for (const node of walkTree(screenRoot)) {
      if (node === screenRoot) continue
      const signature = nativeSignature(node)
      const list = local.get(signature)
      if (list) list.push(node)
      else local.set(signature, [node])
    }
    for (const [signature, nodes] of local) {
      const candidates = this.bySignature.get(signature) ?? []
      if (candidates.length === 0) continue
      if (candidates.length === nodes.length) {
        nodes.forEach((node, i) => {
          const pair = candidates[i]
          if (pair) result.set(node, pair)
        })
        continue
      }
      const byRef = new Map(candidates.map((candidate) => [candidate.ref, candidate]))
      for (const node of nodes) {
        const same = byRef.get(node.ref)
        if (same) result.set(node, same)
      }
    }
    return result
  }
}

/** The ancestors of every node, from the root down, so a probe can walk up from a node. */
export function parentsOf(root: A11yNode): Map<A11yNode, A11yNode> {
  const parents = new Map<A11yNode, A11yNode>()
  for (const node of walkTree(root)) for (const child of node.children) parents.set(child, node)
  return parents
}

export function ancestors(node: A11yNode, parents: Map<A11yNode, A11yNode>): A11yNode[] {
  const out: A11yNode[] = []
  for (let current = parents.get(node); current; current = parents.get(current)) out.push(current)
  return out
}

/** iOS containers that scroll; Android marks its own with `scrollable`. */
const IOS_SCROLLERS = new Set(['scrollView', 'table', 'collectionView', 'webView', 'textView', 'outline', 'browser'])

/** A node a person can scroll: what is past its edge can still be reached. */
export function scrolls(node: A11yNode): boolean {
  if (node.states.includes('scrollable')) return true
  return typeof node.native.elementType === 'string' && IOS_SCROLLERS.has(node.native.elementType)
}

/** The text a node draws itself: a label's text, a field's value or hint. */
export function drawnText(node: A11yNode): string | undefined {
  const rendered = typeof node.native.renderedText === 'string' ? node.native.renderedText : undefined
  const value = (rendered ?? node.text ?? '').replace(/\s+/g, ' ').trim()
  return value === '' ? undefined : value
}

/** A short hash of an image's pixels, for the record: captures are kept as hashes, never as images. */
export function pixelHash(image: RgbaImage): string {
  return createHash('sha256').update(image.data).digest('hex').slice(0, 16)
}

/**
 * The share of the image that is not its main color, from every fourth pixel in each direction: how much of the
 * window is drawn, for a screen with too little text to compare (a game, a map).
 */
export function inkShare(image: RgbaImage): number {
  const counts = new Map<number, number>()
  let total = 0
  for (let y = 0; y < image.height; y += 4) {
    for (let x = 0; x < image.width; x += 4) {
      const at = (y * image.width + x) * 4
      // Colors within 8 of each other in every channel count as one, as compression and anti-aliasing leave them.
      const key = ((image.data[at] ?? 0) >> 3) * 1024 + ((image.data[at + 1] ?? 0) >> 3) * 32 + ((image.data[at + 2] ?? 0) >> 3)
      counts.set(key, (counts.get(key) ?? 0) + 1)
      total++
    }
  }
  if (total === 0) return 0
  const main = Math.max(...counts.values())
  return Math.round(((total - main) / total) * 1000) / 1000
}
