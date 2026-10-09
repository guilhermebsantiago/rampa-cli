import { type RgbaImage, cropImage, pngDataUri } from '../pixels/png.ts'
import type { A11yNode, Bounds } from '../snapshot/schema.ts'
import { walkTree } from '../snapshot/tree.ts'

/**
 * Helpers shared by the native collectors (Android, iOS): how a node gets a ref that
 * resolves to exactly one element, how images are cut out of the screenshot, and how a
 * control without a label of its own is named by its content, as screen readers do.
 */

/** A node before refs are assigned: refs depend on which ids turn out to be unique. */
export interface NativeDraft {
  /** resource-id on Android, accessibilityIdentifier on iOS. */
  id: string | undefined
  /** The platform type used in paths: an Android class or an XCUIElementType name. */
  type: string
  node: Omit<A11yNode, 'ref' | 'children'>
  children: NativeDraft[]
}

/** An XPath string literal for any value, quotes included. */
export function xpathLiteral(value: string): string {
  if (!value.includes('"')) return `"${value}"`
  if (!value.includes("'")) return `'${value}'`
  return `concat(${value
    .split('"')
    .map((part) => `"${part}"`)
    .join(`, '"', `)})`
}

/**
 * Refs: the id itself when no other node has it, as testers look elements up; otherwise a
 * path of types with 1-based positions among siblings of the same type, starting at the
 * nearest ancestor whose id is unique (an XPath over the page source Appium shows).
 */
export function finishTree(root: NativeDraft, rootRef: string, idAttribute: string): A11yNode {
  const counts = new Map<string, number>()
  const count = (draft: NativeDraft): void => {
    if (draft.id) counts.set(draft.id, (counts.get(draft.id) ?? 0) + 1)
    for (const child of draft.children) count(child)
  }
  count(root)
  const unique = (draft: NativeDraft) => draft.id !== undefined && draft.id !== '' && counts.get(draft.id) === 1

  const build = (draft: NativeDraft, ref: string, base: string): A11yNode => {
    const sameType = new Map<string, number>()
    for (const child of draft.children) sameType.set(child.type, (sameType.get(child.type) ?? 0) + 1)
    const seen = new Map<string, number>()
    const children = draft.children.map((child) => {
      const position = (seen.get(child.type) ?? 0) + 1
      seen.set(child.type, position)
      const step = (sameType.get(child.type) ?? 0) > 1 ? `${child.type}[${position}]` : child.type
      if (unique(child) && child.id) return build(child, child.id, `//*[@${idAttribute}=${xpathLiteral(child.id)}]`)
      const path = `${base}/${step}`
      return build(child, path, path)
    })
    return { ...draft.node, ref, children }
  }
  return build(root, rootRef, rootRef)
}

/** What a screen reader reads for a container that has no label of its own: the text and image names inside it. */
export function nameFromContent(node: A11yNode): string | undefined {
  const parts: string[] = []
  const visit = (current: A11yNode): void => {
    for (const child of current.children) {
      if (child.states.includes('hidden')) continue
      if (child.name && (child.role === 'img' || !child.text)) parts.push(child.name)
      else if (child.text) parts.push(child.text)
      if (!child.name) visit(child)
    }
  }
  visit(node)
  const text = parts.join(' ').replace(/\s+/g, ' ').trim()
  return text === '' ? undefined : text.slice(0, 300)
}

const IMAGE_LIMIT = 25
/** Smaller than this in screenshot pixels, an image is an icon too small to judge. */
const MIN_IMAGE_PIXELS = 16

/** An image a person sees: an image node, or a control drawn as an image (an Android ImageButton). */
export function isImageLike(node: A11yNode): boolean {
  return node.role === 'img' || node.native.imageControl === true
}

/**
 * Cuts each named image out of the screenshot, as the web surface screenshots each image,
 * so 1.1.1 judges what people see. `scale` is screenshot pixels per bounds unit.
 */
export function captureImages(root: A11yNode, screenshot: RgbaImage, scale: number): number {
  let captured = 0
  for (const node of walkTree(root)) {
    if (captured >= IMAGE_LIMIT) break
    if (!isImageLike(node) || !node.name?.trim() || !node.bounds || node.states.includes('hidden') || node.states.includes('offscreen')) continue
    const rect = toPixels(node.bounds, scale)
    if (rect.width < MIN_IMAGE_PIXELS || rect.height < MIN_IMAGE_PIXELS) continue
    const crop = cropImage(screenshot, rect)
    if (!crop || crop.width < MIN_IMAGE_PIXELS || crop.height < MIN_IMAGE_PIXELS) continue
    node.image = pngDataUri(crop)
    captured++
  }
  return captured
}

export function toPixels(bounds: Bounds, scale: number): Bounds {
  return { x: bounds.x * scale, y: bounds.y * scale, width: bounds.width * scale, height: bounds.height * scale }
}

/** Screenshot pixels per bounds unit: 2 or 3 on iOS, where frames are in points. Near-integer ratios snap. */
export function screenshotScale(screenshotWidth: number, viewportWidth: number): number {
  if (viewportWidth <= 0) return 1
  const ratio = screenshotWidth / viewportWidth
  const nearest = Math.round(ratio)
  return nearest >= 1 && Math.abs(ratio - nearest) < 0.03 ? nearest : ratio
}

/** The node as a start tag, with only the attributes that say something: what the prompt shows as markup. */
export function sourceTag(type: string, attributes: Array<[string, string | undefined]>): string {
  const parts = attributes
    .filter((entry): entry is [string, string] => entry[1] !== undefined && entry[1] !== '')
    .map(([name, value]) => ` ${name}="${value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').slice(0, 200)}"`)
  return `<${type}${parts.join('')}>`
}
