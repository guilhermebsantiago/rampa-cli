import { normalizeForMatch } from '../core/util.ts'
import type { A11yNode } from './schema.ts'
import { type TreeIndex, indexTree, walkTree } from './tree.ts'

/**
 * Images hidden from assistive technology (ACT e88epe), and the cheap signals that say one may still carry
 * information. The collector captures the images these select (surfaces/image-capture.ts) and 1.1.1 judges
 * them (criteria/hidden-images.ts), so both read the same list from the same snapshot.
 *
 * ACT e88epe applies to visible img, svg and canvas elements that assistive technology ignores: not in the
 * accessibility tree (alt="", role="presentation" or "none", aria-hidden="true"), an svg with an empty name and
 * the graphics-document role, or a canvas with an empty name and no role. Never to one inside an element named
 * by its author (aria-label, aria-labelledby): that name stands for what the element holds.
 *
 * Most such images are decorative, and rightly hidden. A model looks only at those the signals leave: larger
 * than an icon, not a picture repeated on the page or a copy of one that has a name, not inside a link or
 * button (a named one says what it does, an unnamed one is the engine's), and not next to text that already
 * says what the page calls it (its file name, title or hidden alt).
 */

/** How the page hides the image from assistive technology. */
export type HiddenBy = 'empty-alt' | 'role-none' | 'aria-hidden' | 'unnamed-svg' | 'unnamed-canvas'

export interface HiddenImage {
  node: A11yNode
  by: HiddenBy
  /** For aria-hidden: whether the attribute is on the image itself, not on an element around it. */
  own: boolean
}

/** Hidden images judged per page, in document order: each one is a call to a vision model. */
export const HIDDEN_LIMIT = 10
/** Thinner than this on a side, a picture is a rule or a dot. */
const MIN_SIDE = 16
/** No larger than this on both sides, a picture is an icon: its meaning, if any, sits in the text or control next to it. */
const ICON_SIDE = 32
/** The same picture this many times on a page is an icon, a bullet or a separator. */
const REPEATED = 3
/** How much text around the image counts as next to it, on each side. */
const AROUND_CHARS = 300

const CONTROL_ROLES = new Set(['link', 'button', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab', 'option', 'checkbox', 'radio', 'switch'])

function attributesOf(node: A11yNode): Record<string, string> {
  return (node.native.attributes ?? {}) as Record<string, string>
}

function explicitRole(node: A11yNode): string {
  return (attributesOf(node).role ?? '').trim().toLowerCase().split(/\s+/)[0] ?? ''
}

/** How the page hides an img, svg or canvas from assistive technology, or undefined when it does not. */
export function hiddenBy(node: A11yNode): HiddenBy | undefined {
  const tag = node.native.tag
  if (tag !== 'img' && tag !== 'svg' && tag !== 'canvas') return undefined
  const attributes = attributesOf(node)
  if (node.states.includes('aria-hidden')) return 'aria-hidden'
  if (node.native.presentational === true) return 'role-none'
  const role = explicitRole(node)
  const named = Boolean(node.name?.trim())
  if (tag === 'img') {
    // alt="" makes an img presentational, unless something else names it or gives it a role.
    return role === '' && attributes.alt !== undefined && attributes.alt.trim() === '' && !named && !attributes.title?.trim() ? 'empty-alt' : undefined
  }
  if (tag === 'svg') {
    // An svg keeps the graphics-document role unless it is given another; with no name, it is ignored.
    if (role !== '' && role !== 'graphics-document') return undefined
    return named || typeof node.native.svgTitle === 'string' ? undefined : 'unnamed-svg'
  }
  return role === '' && !named ? 'unnamed-canvas' : undefined
}

/** On screen: rendered, inside the page and larger than a dot. A broken img shows the browser's icon, not the picture. */
function visible(node: A11yNode): boolean {
  if (node.states.includes('hidden') || node.states.includes('offscreen') || node.states.includes('broken')) return false
  return node.bounds !== undefined && node.bounds.width >= 1 && node.bounds.height >= 1
}

/** An element named by its author (aria-label, aria-labelledby) holds the image: its name stands for it (the ACT exception). */
function namedByAuthorAbove(index: TreeIndex, node: A11yNode): boolean {
  for (let ref = index.get(node.ref)?.parentRef; ref; ref = index.get(ref)?.parentRef) {
    const attributes = attributesOf(index.get(ref)?.node ?? node)
    if (attributes['aria-label']?.trim() || attributes['aria-labelledby']?.trim()) return true
  }
  return false
}

/** Every visible image the page hides from assistive technology, in document order: ACT e88epe's targets. */
export function hiddenImages(root: A11yNode, index: TreeIndex = indexTree(root)): HiddenImage[] {
  const found: HiddenImage[] = []
  for (const node of walkTree(root)) {
    const by = hiddenBy(node)
    if (!by || !visible(node)) continue
    // An svg drawn inside another is part of that picture.
    if (node.native.tag === 'svg' && insideSvg(index, node)) continue
    if (namedByAuthorAbove(index, node)) continue
    const own = by !== 'aria-hidden' || attributesOf(node)['aria-hidden']?.trim().toLowerCase() === 'true'
    found.push({ node, by, own })
  }
  return found
}

function insideSvg(index: TreeIndex, node: A11yNode): boolean {
  for (let ref = index.get(node.ref)?.parentRef; ref; ref = index.get(ref)?.parentRef) {
    if (index.get(ref)?.node.native.tag === 'svg') return true
  }
  return false
}

/** What tells one picture from another without its pixels: an img's address, an svg's drawing. */
export function pictureKey(node: A11yNode): string | undefined {
  if (node.native.tag === 'img') {
    const src = attributesOf(node).src?.trim()
    return src ? `src:${src}` : undefined
  }
  if (node.native.tag === 'svg' && typeof node.native.svgHash === 'string') return `svg:${node.native.svgHash}`
  return undefined
}

/**
 * The text assistive technology reads around the image, in document order: up to 300 characters before it and
 * 300 after, from elements not hidden from it (visually hidden text counts, since screen readers read it), and
 * the names of images it reads. The image's own content, such as a canvas's fallback text, comes after it.
 */
export interface TextAround {
  before: string
  after: string
}

export function textAround(root: A11yNode, image: A11yNode, index: TreeIndex = indexTree(root)): TextAround {
  // The image may sit inside a branch hidden from assistive technology: its place is where that branch starts.
  const path = new Set<string>([image.ref])
  for (let ref = index.get(image.ref)?.parentRef; ref; ref = index.get(ref)?.parentRef) path.add(ref)
  const parts: string[] = []
  let at = -1
  const visit = (node: A11yNode): void => {
    if (at < 0 && path.has(node.ref) && (node === image || node.states.includes('hidden') || node.states.includes('aria-hidden'))) at = parts.length
    if (node.states.includes('hidden') || node.states.includes('aria-hidden')) return
    if (node.text) parts.push(node.text)
    if (node !== image && node.role === 'img' && node.name?.trim()) parts.push(node.name.trim())
    for (const child of node.children) visit(child)
  }
  visit(root)
  if (at < 0) return { before: '', after: '' }
  const squeeze = (text: string) => text.replace(/\s+/g, ' ').trim()
  const before = squeeze(parts.slice(0, at).join(' '))
  const after = squeeze(parts.slice(at).join(' '))
  return {
    before: before.length <= AROUND_CHARS ? before : `…${before.slice(before.length - AROUND_CHARS).replace(/^\S*\s/, '')}`,
    after: after.length <= AROUND_CHARS ? after : `${after.slice(0, AROUND_CHARS).replace(/\s\S*$/, '')}…`,
  }
}

/** Words that name a kind of picture, not what it shows: "logo", "icon", "image" say nothing about the brand or the thing. */
const KIND_WORDS = new Set([
  'image', 'images', 'imagem', 'imagens', 'imagen', 'imagenes', 'img', 'picture', 'pic', 'photo', 'foto', 'fotos', 'photograph',
  'icon', 'icons', 'icone', 'icones', 'icono', 'iconos', 'logo', 'logos', 'logotipo', 'logomarca', 'logotype',
  'banner', 'graphic', 'figure', 'figura', 'thumbnail', 'thumb', 'miniatura',
])
/** What file names add besides the name: sizes, versions, formats. */
const FILE_WORDS = new Set(['svg', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'small', 'large', 'medium', 'big', 'default', 'new', 'copy', 'final', 'web', 'hd', 'retina', 'min', 'x2', 'x3', '2x', '3x'])
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'your', 'our', 'of', 'in', 'on', 'at', 'to', 'by', 'or', 'as', 'an', 'is', 'it',
  'de', 'da', 'do', 'em', 'no', 'na', 'os', 'um', 'uma', 'com', 'para', 'por', 'dos', 'das', 'el', 'la', 'en', 'del', 'los', 'las', 'que',
])

/**
 * The words of a text that say what something is: two letters or more, without kind words. A file name also
 * loses its sizes, versions and bare numbers; a claim keeps its numbers, which a chart's information often is.
 */
export function meaningWords(text: string, kind: 'text' | 'file' = 'text'): string[] {
  return normalizeForMatch(text)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => (word.length >= 2 || /\d/.test(word)) && !KIND_WORDS.has(word) && !STOPWORDS.has(word))
    .filter((word) => kind === 'text' || (!FILE_WORDS.has(word) && !/^\d+$/.test(word) && !/^[0-9a-f]{8,}$/.test(word)))
}

/** Every one of these words is in the text: it already says what they name. */
export function saidIn(words: readonly string[], text: string): boolean {
  if (words.length === 0) return false
  const present = new Set(meaningWords(text))
  return words.every((word) => present.has(word))
}

/** What the page itself calls a hidden image: the words of its file name, its title, an svg's title, and an alt that is not read. */
export function pageWords(node: A11yNode): string[] {
  const attributes = attributesOf(node)
  const file = attributes.src && !attributes.src.startsWith('data:') ? (attributes.src.split(/[?#]/)[0]?.split('/').pop() ?? '').replace(/\.[a-z0-9]+$/i, '') : ''
  const svgTitle = typeof node.native.svgTitle === 'string' ? node.native.svgTitle : ''
  return [...new Set([...meaningWords(file, 'file'), ...[attributes.alt ?? '', attributes.title ?? '', svgTitle].flatMap((text) => meaningWords(text))])]
}

/** Why a hidden image is left to the page as decorative, without a model; undefined when it may carry information. */
export type QuietReason = 'icon-size' | 'repeated' | 'copy-of-named' | 'in-control' | 'said-next-to-it'

export interface HiddenImageSignals {
  /** All the page's hidden images, for the counts. */
  all: HiddenImage[]
  /** The ones a model looks at: HIDDEN_LIMIT at most, in document order. */
  judged: HiddenImage[]
  /** Why each of the others is taken as decorative, by ref. */
  quiet: Map<string, QuietReason>
}

/**
 * Splits the page's hidden images into those a model looks at and those the cheap signals settle as decorative.
 * The collector captures the first; 1.1.1 judges those it captured.
 */
export function hiddenImageSignals(root: A11yNode): HiddenImageSignals {
  const index = indexTree(root)
  const all = hiddenImages(root, index)
  // How often each picture appears on the page, and which pictures also appear with a name screen readers read.
  const seen = new Map<string, number>()
  const named = new Set<string>()
  for (const node of walkTree(root)) {
    if (node.states.includes('hidden')) continue
    const key = pictureKey(node)
    if (!key) continue
    seen.set(key, (seen.get(key) ?? 0) + 1)
    if (!hiddenBy(node) && node.name?.trim()) named.add(key)
  }
  const quiet = new Map<string, QuietReason>()
  const judged: HiddenImage[] = []
  for (const hidden of all) {
    const reason = quietReason(hidden.node, index, root, seen, named)
    if (reason) quiet.set(hidden.node.ref, reason)
    else if (judged.length < HIDDEN_LIMIT) judged.push(hidden)
  }
  return { all, judged, quiet }
}

function quietReason(node: A11yNode, index: TreeIndex, root: A11yNode, seen: Map<string, number>, named: Set<string>): QuietReason | undefined {
  const { width = 0, height = 0 } = node.bounds ?? {}
  if (width < MIN_SIDE || height < MIN_SIDE || (width <= ICON_SIDE && height <= ICON_SIDE)) return 'icon-size'
  const key = pictureKey(node)
  if (key && named.has(key)) return 'copy-of-named'
  if (key && (seen.get(key) ?? 0) >= REPEATED) return 'repeated'
  // A named control says what it does; one with no name is the engine's to report (link-name, button-name).
  for (let ref = index.get(node.ref)?.parentRef; ref; ref = index.get(ref)?.parentRef) {
    const parent = index.get(ref)?.node
    if (parent && CONTROL_ROLES.has(parent.role)) return 'in-control'
  }
  const around = textAround(root, node, index)
  if (saidIn(pageWords(node), `${around.before} ${around.after}`)) return 'said-next-to-it'
  return undefined
}
