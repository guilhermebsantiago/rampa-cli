import type { A11yNode } from '../snapshot/schema.ts'
import { walkTree } from '../snapshot/tree.ts'
import { sha256 } from './util.ts'

/**
 * Pictures a crawl saw on several pages, for 1.4.5: a site's logo, and the badges and partner marks in its header and
 * footer, repeat on every page, and their text is a logotype. Each captured picture is known by two keys: the hash of
 * its capture (the same pixels) and its address (the same file, at whatever size it is drawn).
 */

/** On how many other pages of the crawl a picture must show to count as the site's own mark. */
export const REPEATED_ON = 2

/** The keys of one captured picture; none for a node with no capture. */
export function pictureKeys(node: A11yNode, base: string): string[] {
  if (!node.image) return []
  const keys = [`capture:${captureHash(node.image)}`]
  const attributes = (node.native.attributes ?? {}) as Record<string, string | undefined>
  const source = node.native.tag === 'img' || node.native.tag === 'input' ? attributes.src : typeof node.native.backgroundImage === 'string' ? node.native.backgroundImage : undefined
  if (source && !source.startsWith('data:')) {
    try {
      keys.push(`src:${new URL(source, base).href}`)
    } catch {
      // An address that does not parse names nothing to compare.
    }
  }
  return keys
}

/** The hash a capture is known by: of its data URI, as recorded in the snapshot. */
export function captureHash(image: string): string {
  return sha256(image).slice(0, 32)
}

/** Every key of the captured pictures of a page. */
export function pagePictureKeys(root: A11yNode, base: string): Set<string> {
  const keys = new Set<string>()
  for (const node of walkTree(root)) for (const key of pictureKeys(node, base)) keys.add(key)
  return keys
}

/**
 * For the keys of one page, on how many other pages the crawl has seen each so far (`pages` maps a key to the pages
 * that show it). Only keys seen elsewhere are listed; undefined when none is.
 */
export function repeatedPictures(keys: Iterable<string>, pages: ReadonlyMap<string, ReadonlySet<string>>, url: string): Record<string, number> | undefined {
  const repeated: Record<string, number> = {}
  for (const key of keys) {
    const seen = pages.get(key)
    const others = seen ? seen.size - (seen.has(url) ? 1 : 0) : 0
    if (others > 0) repeated[key] = others
  }
  return Object.keys(repeated).length > 0 ? repeated : undefined
}
