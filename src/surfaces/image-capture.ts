import { createHash } from 'node:crypto'
import { tryDecodePng } from '../pixels/png.ts'
import { type ImageSkip, setImageSkip } from '../snapshot/image-skips.ts'
import type { A11yNode } from '../snapshot/schema.ts'
import { walkTree } from '../snapshot/tree.ts'

/**
 * Captures each image as people see it, for criteria that judge the pixels (1.1.1, 1.4.5). `rampa check`
 * (`collectWeb`) and a test's own Playwright or Puppeteer page (`collectPage`) share it, so both
 * record the same captures and the same reasons for leaving an image out.
 *
 * Before each element screenshot the image is scrolled into view and given time to load and decode,
 * so a lazy image (loading="lazy", a data-src swap) is captured, not its placeholder. An image is
 * left without a capture, with the reason on the node (snapshot/image-skips.ts), when the capture
 * would not be its own pixels: outside the page, cut off by its container, transparent, still a
 * placeholder, blank, or stacked with other images in one box (carousel slides) and not told apart
 * from them once the others are hidden.
 */

export interface CaptureDriver {
  /** Runs a self-contained function in the page with one JSON argument. */
  evaluate<Arg, Result>(fn: (arg: Arg) => Result | Promise<Result>, arg: Arg): Promise<Result>
  /** A PNG of the element a ref resolves to, as rendered; undefined when it cannot be taken. */
  screenshot(ref: string): Promise<Uint8Array | undefined>
}

export interface CaptureOptions {
  /** Images captured per page; the rest are recorded as over the limit. */
  limit?: number | undefined
  /** Called before each image is prepared: rampa check hides the fixed layers that do not hold it. */
  beforeEach?: ((node: A11yNode) => Promise<void>) | undefined
  /** Longest wait for one image to load, and for all of them together, in milliseconds. */
  waitMs?: number | undefined
  budgetMs?: number | undefined
}

export const IMAGE_LIMIT = 25
const WAIT_MS = 3000
const BUDGET_MS = 15_000

export function isCapturableImage(node: A11yNode): boolean {
  const attributes = (node.native.attributes ?? {}) as Record<string, string>
  return (
    node.native.tag === 'img' ||
    node.role === 'img' ||
    (node.native.tag === 'input' && attributes.type === 'image') ||
    (node.native.tag === 'canvas' && Boolean(node.name))
  )
}

/** A lazy image that has not loaded yet has no size; its markup says it will load when it is scrolled to. */
function lazyHint(node: A11yNode): boolean {
  const html = typeof node.native.html === 'string' ? node.native.html : ''
  return /\sloading\s*=\s*["']?lazy|\sdata-(?:lazy-)?src(?:set)?\s*=|\sdata-original\s*=/i.test(html)
}

/** The images to capture, in document order: rendered, loaded or about to load, and larger than an icon's dot. */
export function imageTargets(root: A11yNode): A11yNode[] {
  const targets: A11yNode[] = []
  for (const node of walkTree(root)) {
    if (!isCapturableImage(node) || node.states.includes('hidden') || node.states.includes('broken')) continue
    const sized = node.bounds !== undefined && node.bounds.width >= 8 && node.bounds.height >= 8
    if (sized || (Boolean(node.name?.trim()) && lazyHint(node))) targets.push(node)
  }
  return targets
}

interface Shot {
  node: A11yNode
  png: Uint8Array
  source: string
  stackedWith: string[]
}

export async function captureImageNodes(driver: CaptureDriver, root: A11yNode, options: CaptureOptions = {}): Promise<void> {
  const limit = options.limit ?? IMAGE_LIMIT
  const deadline = Date.now() + (options.budgetMs ?? BUDGET_MS)
  const shots: Shot[] = []
  for (const [index, node] of imageTargets(root).entries()) {
    if (index >= limit) {
      setImageSkip(node, 'limit')
      continue
    }
    let changed = false
    try {
      await options.beforeEach?.(node)
      const waitMs = Math.max(0, Math.min(options.waitMs ?? WAIT_MS, deadline - Date.now()))
      const prepared = await driver.evaluate(prepareImageInPage, { ref: node.ref, waitMs })
      changed = prepared.changed
      if (prepared.status !== 'ready') {
        setImageSkip(node, prepared.status)
        continue
      }
      const png = await driver.screenshot(node.ref)
      if (!png) {
        setImageSkip(node, 'capture-failed')
        continue
      }
      const flat = flatColor(png)
      if (flat !== undefined) {
        // One flat color: a plain picture, or nothing of the image at all? The same box without it tells.
        changed = true
        await driver.evaluate(hideImageInPage, node.ref)
        const behind = await driver.screenshot(node.ref)
        const without = behind ? flatColor(behind) : undefined
        if (without === undefined || sameColor(flat, without)) {
          setImageSkip(node, 'blank')
          continue
        }
      }
      shots.push({ node, png, source: prepared.source, stackedWith: prepared.stackedWith })
    } catch {
      setImageSkip(node, 'capture-failed')
    } finally {
      if (changed) await driver.evaluate(restoreImageInPage, null).catch(() => undefined)
    }
  }

  // Stacked images whose captures came out the same though their pictures differ: none of them is its own.
  const byRef = new Map(shots.map((shot) => [shot.node.ref, shot]))
  const hashes = new Map(shots.map((shot) => [shot, createHash('sha256').update(shot.png).digest('hex')]))
  const notOwn = new Set<Shot>()
  for (const shot of shots) {
    for (const ref of shot.stackedWith) {
      const other = byRef.get(ref)
      if (other && other.source !== shot.source && hashes.get(other) === hashes.get(shot)) {
        notOwn.add(shot)
        notOwn.add(other)
      }
    }
  }
  for (const shot of shots) {
    if (notOwn.has(shot)) setImageSkip(shot.node, 'stacked')
    else shot.node.image = `data:image/png;base64,${Buffer.from(shot.png).toString('base64')}`
  }
}

/** The color of a capture that is one flat color (all but a few stray pixels), as 0xRRGGBBAA; undefined otherwise. */
export function flatColor(png: Uint8Array): number | undefined {
  const image = tryDecodePng(png)
  if (!image || image.width * image.height === 0) return undefined
  const { data } = image
  const pixels = image.width * image.height
  const [r, g, b, a] = [data[0] ?? 0, data[1] ?? 0, data[2] ?? 0, data[3] ?? 0]
  let off = 0
  for (let i = 0; i < data.length; i += 4) {
    const near =
      Math.abs((data[i] ?? 0) - r) <= 6 && Math.abs((data[i + 1] ?? 0) - g) <= 6 && Math.abs((data[i + 2] ?? 0) - b) <= 6 && Math.abs((data[i + 3] ?? 0) - a) <= 6
    if (!near && ++off > pixels * 0.005) return undefined
  }
  return ((r << 24) | (g << 16) | (b << 8) | a) >>> 0
}

function sameColor(a: number, b: number): boolean {
  for (let shift = 0; shift < 32; shift += 8) if (Math.abs(((a >>> shift) & 0xff) - ((b >>> shift) & 0xff)) > 6) return false
  return true
}

export interface PreparedImage {
  status: 'ready' | ImageSkip
  /** The picture the element shows: an image's current source, so stacked copies of one picture are not told apart. */
  source: string
  /** Refs of the other images stacked in the same box, hidden while this one is captured. */
  stackedWith: string[]
  /** Whether the page was changed for the capture; restoreImageInPage puts it back. */
  changed: boolean
}

/**
 * Runs in the page (serialized by the browser library, so it references nothing outside its body).
 * Scrolls the image into view, waits for it to load and decode, measures how much of it shows,
 * and, when other images share its box, hides them and makes this one visible for the capture.
 */
export async function prepareImageInPage(arg: { ref: string; waitMs: number }): Promise<PreparedImage> {
  type Undo = { el: HTMLElement; prop: string; value: string; priority: string } | { el: Element; scrollLeft: number; scrollTop: number }
  const page = window as unknown as {
    __rampaImageUndo?: Undo[]
    __rampaRefs?: Map<Element, string>
    __rampaNodes?: Map<string, Element>
    __rampaResolve?: (ref: string) => Element | null
  }
  const undo: Undo[] = page.__rampaImageUndo ?? []
  page.__rampaImageUndo = undo
  const result = (status: PreparedImage['status'], source = '', stackedWith: string[] = []): PreparedImage => ({ status, source, stackedWith, changed: undo.length > 0 })
  const force = (el: Element, prop: string, value: string): void => {
    const style = (el as HTMLElement).style as CSSStyleDeclaration | undefined
    if (!style) return
    undo.push({ el: el as HTMLElement, prop, value: style.getPropertyValue(prop), priority: style.getPropertyPriority(prop) })
    style.setProperty(prop, value, 'important')
  }

  // The collector's own map first: a ref into a frame or a shadow root is no CSS selector (snapshot/refs.ts).
  let el: Element | null = page.__rampaNodes?.get(arg.ref) ?? null
  try {
    el ??= page.__rampaResolve ? page.__rampaResolve(arg.ref) : document.querySelector(arg.ref)
  } catch {
    el = null
  }
  if (!el) return result('capture-failed')
  const target = el
  // An image in a frame is measured in the frame: its window, its document, its constructors.
  const view = (target.ownerDocument.defaultView ?? window) as Window & typeof globalThis
  const doc = target.ownerDocument
  const img = target instanceof view.HTMLImageElement ? target : undefined
  const sourceOf = (node: Element): string => (node instanceof view.HTMLImageElement ? node.currentSrc || node.src || '' : '')
  const deadline = Date.now() + arg.waitMs
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
  // A frame, or a short pause where frames do not run (a page in the background).
  const frame = () => new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 50)
    requestAnimationFrame(() => {
      clearTimeout(timer)
      resolve()
    })
  })

  // Into view, in every box that scrolls, so lazy loading starts and a carousel track shows this slide.
  // Boxes the visitor cannot scroll (overflow: hidden) get their position back after the capture.
  const scrolling = doc.scrollingElement ?? doc.documentElement
  for (let box = target.parentElement; box; box = box.parentElement) {
    if (box === scrolling || box === doc.body) continue
    if (box.scrollWidth > box.clientWidth || box.scrollHeight > box.clientHeight) undo.push({ el: box, scrollLeft: box.scrollLeft, scrollTop: box.scrollTop })
  }
  target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' as ScrollBehavior })
  await frame()
  await frame()

  // Where lazy loaders keep the real address until the image comes into view.
  const LAZY = ['data-src', 'data-lazy-src', 'data-original', 'data-lazy', 'data-srcset', 'data-lazy-srcset']
  const absolute = (address: string): string => {
    try {
      return new URL(address, doc.baseURI).href
    } catch {
      return address
    }
  }
  const lazySources = (image: HTMLImageElement): string[] =>
    LAZY.flatMap((name) => {
      const value = image.getAttribute(name)?.trim()
      if (!value) return []
      // A srcset lists addresses with their widths; a plain address may itself hold commas (a data: URI).
      const addresses = name.endsWith('srcset') ? value.split(',').map((candidate) => candidate.trim().split(/\s+/)[0] ?? '') : [value]
      return addresses.filter(Boolean).map(absolute)
    })
  const placeholder = (image: HTMLImageElement): boolean => {
    // A 1×1 or 2×2 pixel stretched over the box: the stand-in lazy loaders put there until the swap.
    if (image.complete && image.naturalWidth > 0 && image.naturalWidth <= 2 && image.naturalHeight <= 2) return true
    const wanted = lazySources(image)
    if (wanted.length === 0) return false
    const current = sourceOf(image)
    // Swapped already: the image shows one of the addresses the lazy attribute holds.
    if (wanted.includes(current)) return false
    if (current === '' || current.startsWith('data:')) return true
    const file = current.split(/[?#]/)[0]?.split('/').pop() ?? ''
    return /placeholder|blank|spacer|lazy|loading|transparent/i.test(file)
  }
  if (img) {
    while (Date.now() < deadline && (!img.complete || (lazySources(img).length > 0 && placeholder(img)))) await sleep(50)
    if (img.complete && img.naturalWidth > 0 && typeof img.decode === 'function') {
      await Promise.race([img.decode().catch(() => undefined), sleep(Math.max(100, deadline - Date.now()))])
    }
  }
  // A box that moves while things above it load would be cut at the wrong place: wait until it stays put.
  const where = () => {
    const box = target.getBoundingClientRect()
    return `${Math.round(box.left)},${Math.round(box.top)},${Math.round(box.width)},${Math.round(box.height)}`
  }
  let last = where()
  for (let i = 0; i < 10; i++) {
    await frame()
    const now = where()
    if (now === last) break
    last = now
    target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' as ScrollBehavior })
  }

  if (img) {
    if (!img.complete || img.naturalWidth === 0) return result('not-loaded')
    if (placeholder(img)) return result('placeholder')
  }
  const rect = target.getBoundingClientRect()
  if (rect.width < 8 || rect.height < 8) return result(img ? 'not-loaded' : 'clipped')

  // How much of it shows: inside the page, and inside the boxes that clip what overflows them. Only a
  // box on the element's containing-block chain clips it: an absolute element escapes static parents.
  const area = rect.width * rect.height
  let left = rect.left
  let top = rect.top
  let right = rect.right
  let bottom = rect.bottom
  let position = view.getComputedStyle(target).position
  for (let box = target.parentElement; box && box !== doc.body && box !== doc.documentElement; box = box.parentElement) {
    const style = view.getComputedStyle(box)
    if (style.display === 'contents') continue
    const transformed = style.transform !== 'none' || style.filter !== 'none' || style.perspective !== 'none' || /paint|layout|strict|content/.test(style.contain)
    const contains = position === 'fixed' ? transformed : position === 'absolute' ? style.position !== 'static' || transformed : true
    if (!contains) continue
    position = style.position
    if (style.display === 'inline') continue
    const outer = box.getBoundingClientRect()
    const padLeft = outer.left + box.clientLeft
    const padTop = outer.top + box.clientTop
    if (style.overflowX !== 'visible') {
      left = Math.max(left, padLeft)
      right = Math.min(right, padLeft + box.clientWidth)
    }
    if (style.overflowY !== 'visible') {
      top = Math.max(top, padTop)
      bottom = Math.min(bottom, padTop + box.clientHeight)
    }
  }
  // The page area: the viewport for an element fixed to it, else the document, whose width stops at the
  // viewport when the page hides what overflows sideways (off-canvas menus wait there).
  let pageLeft = 0
  let pageTop = 0
  let pageRight = view.innerWidth
  let pageBottom = view.innerHeight
  if (position !== 'fixed') {
    const hidesX = [doc.documentElement, doc.body].some((node) => node && /hidden|clip/.test(view.getComputedStyle(node).overflowX))
    pageLeft = -view.scrollX
    pageTop = -view.scrollY
    pageRight = pageLeft + (hidesX ? scrolling.clientWidth : Math.max(scrolling.scrollWidth, scrolling.clientWidth))
    pageBottom = pageTop + Math.max(scrolling.scrollHeight, scrolling.clientHeight)
  }
  const overlap = (l: number, t: number, r: number, b: number) => (Math.max(0, Math.min(r, pageRight) - Math.max(l, pageLeft)) * Math.max(0, Math.min(b, pageBottom) - Math.max(t, pageTop))) / area
  if (overlap(rect.left, rect.top, rect.right, rect.bottom) < 0.5) return result('outside-page')
  if (overlap(left, top, right, bottom) < 0.5) return result('clipped')

  // Other pictures in (nearly) the same box, such as carousel slides stacked in one place.
  const source = sourceOf(target)
  const refs = page.__rampaRefs
  const others: Element[] = []
  // In the image's own document or shadow root.
  const scope = target.getRootNode() as Document | ShadowRoot
  for (const other of Array.from(scope.querySelectorAll('img, svg, canvas, video, input[type="image"], [role="img"]'))) {
    if (other === target || other.contains(target) || target.contains(other) || other.parentElement?.closest('svg')) continue
    if (typeof other.checkVisibility === 'function' && !other.checkVisibility({ visibilityProperty: true } as CheckVisibilityOptions)) continue
    const box = other.getBoundingClientRect()
    const shared = Math.max(0, Math.min(box.right, rect.right) - Math.max(box.left, rect.left)) * Math.max(0, Math.min(box.bottom, rect.bottom) - Math.max(box.top, rect.top))
    const union = area + box.width * box.height - shared
    if (union <= 0 || shared / union < 0.8) continue
    // The same picture twice, such as a carousel's copy of its first slide, is not another picture.
    if (img && other instanceof view.HTMLImageElement && sourceOf(other) === source) continue
    others.push(other)
  }

  // Finished transitions first: a fade that is under way is not what the image looks like.
  const chain: Element[] = []
  for (let node: Element | null = target; node && node !== doc.documentElement; node = node.parentElement) chain.push(node)
  for (const node of chain) {
    for (const animation of node.getAnimations?.() ?? []) {
      try {
        if (animation.effect?.getComputedTiming().endTime !== Number.POSITIVE_INFINITY) animation.finish()
      } catch {
        // An animation that cannot finish keeps running.
      }
    }
  }

  if (others.length > 0) {
    // Hide each other picture's branch below the closest box it shares with this one, and make this
    // image's own branch visible up to the highest such box: the capture is this picture alone.
    let highest: Element = target
    for (const other of others) {
      const ancestors = new Set<Element>()
      for (let node: Element | null = target; node; node = node.parentElement) ancestors.add(node)
      let branch: Element = other
      while (branch.parentElement && !ancestors.has(branch.parentElement)) branch = branch.parentElement
      const common = branch.parentElement
      force(branch, 'visibility', 'hidden')
      if (common && common.contains(highest)) highest = common
    }
    for (let node: Element | null = target; node && node !== highest; node = node.parentElement) {
      const style = view.getComputedStyle(node)
      if (Number.parseFloat(style.opacity) < 1) {
        force(node, 'transition', 'none')
        force(node, 'opacity', '1')
      }
      if (style.visibility !== 'visible') force(node, 'visibility', 'visible')
    }
  }

  let opacity = 1
  for (const node of chain) {
    const value = Number.parseFloat(view.getComputedStyle(node).opacity)
    if (!Number.isNaN(value)) opacity *= value
  }
  if (opacity < 0.05) return result('not-shown', source)
  const stackedWith = others.flatMap((other) => {
    const ref = refs?.get(other)
    return ref ? [ref] : []
  })
  return result('ready', source, stackedWith)
}

/** Runs in the page: makes the image transparent, to capture what lies behind it. */
export function hideImageInPage(ref: string): void {
  type Undo = { el: HTMLElement; prop: string; value: string; priority: string }
  const page = window as unknown as { __rampaImageUndo?: Undo[]; __rampaNodes?: Map<string, Element>; __rampaResolve?: (ref: string) => Element | null }
  const undo = page.__rampaImageUndo ?? []
  page.__rampaImageUndo = undo
  let found: Element | null = page.__rampaNodes?.get(ref) ?? null
  try {
    found ??= page.__rampaResolve ? page.__rampaResolve(ref) : document.querySelector(ref)
  } catch {
    found = null
  }
  const el = found as HTMLElement | null
  if (!el?.style) return
  for (const [prop, value] of [
    ['transition', 'none'],
    ['opacity', '0'],
  ] as const) {
    undo.push({ el, prop, value: el.style.getPropertyValue(prop), priority: el.style.getPropertyPriority(prop) })
    el.style.setProperty(prop, value, 'important')
  }
}

/**
 * Runs in the page: hides an element's text and children, so a capture shows its CSS background alone. It does
 * inline what the screenshot's style sheet does for refs that are CSS selectors, for an element in a frame or a
 * shadow root, where no page-wide selector reaches; restoreImageInPage puts it back.
 */
export function blankContentInPage(ref: string): boolean {
  type Undo = { el: HTMLElement; prop: string; value: string; priority: string }
  const page = window as unknown as { __rampaImageUndo?: Undo[]; __rampaNodes?: Map<string, Element>; __rampaResolve?: (ref: string) => Element | null }
  const undo = page.__rampaImageUndo ?? []
  page.__rampaImageUndo = undo
  let el: Element | null = page.__rampaNodes?.get(ref) ?? null
  try {
    el ??= page.__rampaResolve ? page.__rampaResolve(ref) : null
  } catch {
    el = null
  }
  if (!el) return false
  const force = (node: Element, prop: string, value: string) => {
    const style = (node as HTMLElement).style as CSSStyleDeclaration | undefined
    if (!style) return
    undo.push({ el: node as HTMLElement, prop, value: style.getPropertyValue(prop), priority: style.getPropertyPriority(prop) })
    style.setProperty(prop, value, 'important')
  }
  force(el, 'color', 'transparent')
  force(el, 'text-shadow', 'none')
  for (const child of Array.from(el.children)) force(child, 'visibility', 'hidden')
  return true
}

/** Runs in the page: puts back every style and scroll position changed for the last capture, newest first. */
export function restoreImageInPage(): void {
  type Undo = { el: HTMLElement; prop: string; value: string; priority: string } | { el: Element; scrollLeft: number; scrollTop: number }
  const page = window as unknown as { __rampaImageUndo?: Undo[] }
  const undo = page.__rampaImageUndo ?? []
  for (let entry = undo.pop(); entry; entry = undo.pop()) {
    if ('prop' in entry) {
      if (entry.value) entry.el.style.setProperty(entry.prop, entry.value, entry.priority)
      else entry.el.style.removeProperty(entry.prop)
    } else {
      entry.el.scrollLeft = entry.scrollLeft
      entry.el.scrollTop = entry.scrollTop
    }
  }
}
