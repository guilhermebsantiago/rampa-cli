import type { Browser, Page } from 'playwright-core'
import { errorMessage } from '../core/util.ts'
import { tryDecodePng } from '../pixels/png.ts'
import { autonymOf } from '../rules/content.ts'
import type { ProbeRecord } from '../snapshot/schema.ts'
import { prepareImageInPage, restoreImageInPage } from '../surfaces/image-capture.ts'
import type { InPageElement } from './kit.ts'
import { type ProbeOptions, openProbePage, skippedRecord } from './page.ts'

/**
 * State variants (D6 of the coverage plan): the same content in another state than the one the page loaded in.
 *
 * - Carousels (1.1.1, F20). The page loads with Playwright's fake clock; the probe finds carousels (an
 *   `aria-roledescription` of carousel or slide, or the class names carousel libraries write) and the large images in
 *   them, then jumps the clock forward in steps, so a carousel that plays by itself moves on, and records at each step
 *   which picture shows and what it is named. An image whose `src` a script swaps is followed the same way. Each picture
 *   seen is captured once, as a 16×16 grey thumbnail, so a rule can tell two pictures apart by their pixels, not their
 *   file names; slides that never showed are made visible one at a time for their capture, as the image captures of
 *   1.1.1 do. Observe class: nothing is clicked.
 * - Language versions (3.1.1). The page's `<link rel="alternate" hreflang>` and its language switcher (links with
 *   `hreflang`, or whose text is a language's own name) lead to the same content in other languages. Each version, up to
 *   four, is loaded on its own (GET, behind the guard), and the probe records the language its root declares, its title
 *   and the text that inherits that language, for the rule to read with the language identifier.
 */

export const VARIANTS_VERSION = '1'
const STEPS = 8
const STEP_MS = 2000
const MAX_CAROUSELS = 4
const MAX_SLIDES = 12
const MAX_SWAPS = 4
const MAX_LANGUAGES = 4
const TEXT_LIMIT = 3000
const TIME_BUDGET_MS = 90_000

/** A picture, 16×16 in grey, as 512 hex digits: enough to tell two photos apart, not to rebuild either. */
export type Thumb = string

export interface VariantImage extends InPageElement {
  /** The address it shows (currentSrc). */
  src: string
  /** Its accessible name: aria-labelledby, aria-label, alt or title. */
  name: string
}

export interface VariantPicture extends VariantImage {
  /** How the picture came to show: by itself on the clock, or made visible by the probe (a stacked slide). */
  shown: 'clock' | 'made-visible'
  thumb?: Thumb | undefined
  /** Why no capture was taken: not loaded, clipped, outside the page... */
  skipped?: string | undefined
}

export interface CarouselRecord {
  el: InPageElement
  /** How it was found: roledescription, class, or swap (an image whose src a script changes). */
  why: 'roledescription' | 'class' | 'swap'
  /** The slide-sized images in it, as the page loaded. */
  images: VariantImage[]
  /** At each step of the clock (0 = as loaded), the image that showed most, with its address and name then. */
  states: Array<{ at: number; image?: VariantImage | undefined }>
  /** Each distinct picture seen or made visible: an element with one address. */
  pictures: VariantPicture[]
}

export interface LanguageVersion {
  /** The address as the page gives it, made absolute. */
  href: string
  via: 'hreflang' | 'switcher'
  /** The language the link claims: its hreflang, or the language whose name its text is. */
  claimed: string
  /** The link on this page, when it is one (a `<link>` in the head is not in the snapshot). */
  link?: InPageElement | undefined
  /** Where the version landed after redirects. */
  url?: string | undefined
  /** The lang its root element declares; null when it declares none. */
  declared?: string | null | undefined
  title?: string | undefined
  /**
   * Text in the language the root declares, in reading order, names of images included, at most 3,000 characters: what
   * inherits it, and parts marked with that same language; parts marked with another language are left out.
   */
  text?: string | undefined
  /** Why it was not read. */
  reason?: string | undefined
}

export interface VariantsData {
  viewport: { width: number; height: number }
  /** The clock: steps of STEP_MS after the load. False when the fake clock did not work, so only the load state was seen. */
  clock: boolean
  steps: number
  stepMs: number
  carousels: CarouselRecord[]
  /** This page's own declared language. */
  lang: string | null
  languages: LanguageVersion[]
  /** Versions found past the limit, not read. */
  languagesLeftOut: number
}

interface Kit {
  describe(el: Element): InPageElement
  resolve(ref: string): Element | null
  visible(el: Element): boolean
}

/** Runs in the page: the carousels, outermost first, with their slide-sized images. Needs the kit. */
export function carouselsInPage(arg: { maxCarousels: number; maxSlides: number }): Array<{ el: InPageElement; why: 'roledescription' | 'class'; images: VariantImage[] }> {
  const kit = (window as unknown as { __rampaKit: Kit }).__rampaKit
  const SIGNAL = /(?:^|[\s_-])(?:carousel|carrossel|carrousel|carrusel|slider|slideshow|swiper|slick|splide|glide|flickity|owl|embla|keen-slider|bxslider|orbit|rotator)(?:$|[\s_-])/i
  const described = (el: Element) => /carousel|carrossel|carrusel|slide/i.test(el.getAttribute('aria-roledescription') ?? '')
  const classed = (el: Element) => SIGNAL.test(`${el.getAttribute('class') ?? ''} ${el.id}`)
  const found = Array.from(document.querySelectorAll('body [aria-roledescription], body [class], body [id]')).filter((el) => described(el) || classed(el))
  const outermost = found.filter((el) => !found.some((other) => other !== el && other.contains(el)))
  // Slides that carry the class themselves (slider-item), one image each, under a container that does not: their
  // container is the carousel. Two carousels side by side, each with its slides, stay two.
  const siblings = new Map<Element, Element[]>()
  for (const el of outermost) {
    const parent = el.parentElement
    if (parent && parent !== document.body && el.querySelectorAll('img').length <= 1) siblings.set(parent, [...(siblings.get(parent) ?? []), el])
  }
  const roots = outermost.flatMap((el) => {
    const parent = el.parentElement
    const group = parent ? siblings.get(parent) : undefined
    if (!parent || !group || group.length < 2) return [el]
    return group[0] === el ? [parent] : []
  })
  const collapse = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim()
  const nameOf = (img: Element): string => {
    const ids = collapse(img.getAttribute('aria-labelledby'))
    if (ids) {
      const text = ids
        .split(' ')
        .map((id) => collapse(document.getElementById(id)?.textContent))
        .filter(Boolean)
        .join(' ')
      if (text) return text
    }
    return collapse(img.getAttribute('aria-label')) || collapse(img.getAttribute('alt')) || collapse(img.getAttribute('title'))
  }
  const out: Array<{ el: InPageElement; why: 'roledescription' | 'class'; images: VariantImage[] }> = []
  for (const root of roots) {
    const images = Array.from(root.querySelectorAll('img')).slice(0, 60)
    if (images.length === 0) continue
    const area = (img: Element) => {
      const r = img.getBoundingClientRect()
      return r.width * r.height
    }
    const largest = Math.max(...images.map(area))
    // Slide-sized: thumbnails, dots and icons beside the slides are left out; a slide not rendered has no box yet.
    const slides = images.filter((img) => area(img) === 0 || area(img) >= largest * 0.4).filter((img) => area(img) > 0 || largest > 0)
    if (slides.length === 0 || largest < 40 * 40) continue
    out.push({
      el: kit.describe(root),
      why: described(root) ? 'roledescription' : 'class',
      images: slides.slice(0, arg.maxSlides).map((img) => ({ ...kit.describe(img), src: (img as HTMLImageElement).currentSrc || (img as HTMLImageElement).src || '', name: nameOf(img) })),
    })
    if (out.length >= arg.maxCarousels) break
  }
  return out
}

/** Runs in the page: the image of a carousel that shows most now, inside the carousel's box and the window. Needs the kit. */
export function shownInPage(refs: string[]): Array<VariantImage | null> {
  const kit = (window as unknown as { __rampaKit: Kit }).__rampaKit
  const collapse = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim()
  // Finished transitions first: a fade that is under way shows two pictures at once.
  for (const animation of document.getAnimations()) {
    try {
      if (animation.effect?.getComputedTiming().endTime !== Number.POSITIVE_INFINITY) animation.finish()
    } catch {
      // An animation that cannot finish keeps running.
    }
  }
  return refs.map((ref) => {
    const root = kit.resolve(ref)
    if (!root) return null
    const box = root.getBoundingClientRect()
    let best: { img: HTMLImageElement; seen: number } | undefined
    const opacity = (el: Element): number => {
      let value = 1
      for (let node: Element | null = el; node && node !== root.parentElement; node = node.parentElement) value *= Number.parseFloat(getComputedStyle(node).opacity) || 0
      return value
    }
    for (const img of Array.from(root.querySelectorAll('img'))) {
      if (!kit.visible(img)) continue
      // What shows inside the carousel's box, wherever the carousel is on the page.
      const r = img.getBoundingClientRect()
      const width = Math.max(0, Math.min(r.right, box.right) - Math.max(r.left, box.left))
      const height = Math.max(0, Math.min(r.bottom, box.bottom) - Math.max(r.top, box.top))
      const seen = width * height * (opacity(img) >= 0.5 ? 1 : 0)
      if (seen > 0 && (!best || seen > best.seen)) best = { img, seen }
    }
    if (!best) return null
    const img = best.img
    const ids = collapse(img.getAttribute('aria-labelledby'))
    const labelled = ids
      ? ids
          .split(' ')
          .map((id) => collapse(document.getElementById(id)?.textContent))
          .filter(Boolean)
          .join(' ')
      : ''
    const name = labelled || collapse(img.getAttribute('aria-label')) || collapse(img.getAttribute('alt')) || collapse(img.getAttribute('title'))
    return { ...kit.describe(img), src: img.currentSrc || img.src || '', name }
  })
}

/**
 * Runs in the page: waits until an image has loaded and decoded the picture it now points to (a swapped `src` loads
 * after the swap), at most `tries` × 50 ms. Counts its waits rather than reading the clock, which the probe fakes.
 */
export async function decodedInPage(arg: { ref: string; tries: number }): Promise<'ready' | 'not-loaded' | 'placeholder'> {
  const kit = (window as unknown as { __rampaKit: Kit }).__rampaKit
  const img = kit.resolve(arg.ref)
  if (!(img instanceof HTMLImageElement)) return 'ready'
  for (let i = 0; i < arg.tries && (!img.complete || img.naturalWidth === 0); i++) await new Promise((resolve) => setTimeout(resolve, 50))
  if (!img.complete || img.naturalWidth === 0) return 'not-loaded'
  // A pixel or two stretched over the box: the stand-in a lazy loader shows until the real picture comes.
  if (img.naturalWidth <= 2 && img.naturalHeight <= 2) return 'placeholder'
  await Promise.race([img.decode().catch(() => undefined), new Promise((resolve) => setTimeout(resolve, 500))])
  return 'ready'
}

/** Runs in the page: images large enough to be a banner, outside the carousels, with their address and name. Needs the kit. */
export function largeImagesInPage(arg: { exclude: string[]; max: number }): VariantImage[] {
  const kit = (window as unknown as { __rampaKit: Kit }).__rampaKit
  const roots = arg.exclude.map((ref) => kit.resolve(ref)).filter((el): el is Element => el !== null)
  const out: VariantImage[] = []
  for (const img of Array.from(document.querySelectorAll('img'))) {
    if (roots.some((root) => root.contains(img)) || !kit.visible(img)) continue
    const r = img.getBoundingClientRect()
    if (r.width < 120 || r.height < 80) continue
    out.push({ ...kit.describe(img), src: img.currentSrc || img.src || '', name: (img.getAttribute('aria-label') || img.getAttribute('alt') || img.getAttribute('title') || '').replace(/\s+/g, ' ').trim() })
    if (out.length >= arg.max) break
  }
  return out
}

/** Runs in the page: what the version's root declares, its title, and the text that inherits that language. */
export function languageTextInPage(limit: number): { declared: string | null; title: string; text: string } {
  const SKIP = new Set(['script', 'style', 'noscript', 'template', 'svg', 'math', 'code', 'pre', 'textarea'])
  const primary = (tag: string | null) => (tag ?? '').trim().toLowerCase().split(/[-_]/)[0] ?? ''
  const root = primary(document.documentElement.getAttribute('lang'))
  const parts: string[] = []
  let length = 0
  const visit = (el: Element): void => {
    if (length >= limit) return
    for (const child of Array.from(el.childNodes)) {
      if (length >= limit) return
      if (child.nodeType === Node.TEXT_NODE) {
        const text = (child.textContent ?? '').replace(/\s+/g, ' ').trim()
        if (text) {
          parts.push(text)
          length += text.length + 1
        }
        continue
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue
      const element = child as Element
      if (SKIP.has(element.localName) || element.getAttribute('aria-hidden') === 'true') continue
      // Text that declares another language than the root's is not the page's; a part marked in the root's own
      // language (translated content wrapped in lang="de" on a lang="de" page) is.
      const own = primary(element.getAttribute('lang'))
      if (own !== '' && own !== root) continue
      if (typeof element.checkVisibility === 'function' && !element.checkVisibility({ visibilityProperty: true, checkVisibilityCSS: true } as CheckVisibilityOptions)) continue
      if (element.localName === 'img') {
        const alt = (element.getAttribute('alt') ?? '').trim()
        if (alt) parts.push(alt)
        continue
      }
      visit(element)
    }
  }
  if (document.body) visit(document.body)
  return { declared: document.documentElement.getAttribute('lang'), title: document.title.replace(/\s+/g, ' ').trim(), text: parts.join(' ').slice(0, limit) }
}

/** Runs in the page: the page's own language, its alternates in the head, and its links that may switch the language. Needs the kit. */
export function languageLinksInPage(): {
  lang: string | null
  alternates: Array<{ href: string; hreflang: string }>
  links: Array<{ el: InPageElement; href: string; hreflang: string; text: string }>
} {
  const kit = (window as unknown as { __rampaKit: Kit }).__rampaKit
  const alternates = Array.from(document.querySelectorAll('link[hreflang][href]'))
    .filter((link) => /(^|\s)alternate(\s|$)/i.test(link.getAttribute('rel') ?? ''))
    .map((link) => ({ href: (link as HTMLLinkElement).href, hreflang: (link.getAttribute('hreflang') ?? '').trim() }))
  const links = Array.from(document.querySelectorAll('a[href]'))
    .slice(0, 2000)
    .flatMap((a) => {
      const text = ((a as HTMLElement).innerText || a.textContent || a.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim()
      const hreflang = (a.getAttribute('hreflang') ?? '').trim()
      if (!hreflang && (text === '' || text.length > 40)) return []
      return [{ el: kit.describe(a), href: (a as HTMLAnchorElement).href, hreflang, text }]
    })
  return { lang: document.documentElement.getAttribute('lang'), alternates, links }
}

/** A capture as a 16×16 grey thumbnail: each cell the mean luminance of its part of the picture. */
export function thumbOf(png: Uint8Array): Thumb | undefined {
  const image = tryDecodePng(png)
  if (!image || image.width < 4 || image.height < 4) return undefined
  const cells: number[] = []
  for (let cy = 0; cy < 16; cy++) {
    for (let cx = 0; cx < 16; cx++) {
      const x0 = Math.floor((cx * image.width) / 16)
      const x1 = Math.max(x0 + 1, Math.floor(((cx + 1) * image.width) / 16))
      const y0 = Math.floor((cy * image.height) / 16)
      const y1 = Math.max(y0 + 1, Math.floor(((cy + 1) * image.height) / 16))
      let sum = 0
      let count = 0
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * image.width + x) * 4
          sum += 0.2126 * (image.data[i] ?? 0) + 0.7152 * (image.data[i + 1] ?? 0) + 0.0722 * (image.data[i + 2] ?? 0)
          count++
        }
      }
      cells.push(Math.round(sum / Math.max(1, count)))
    }
  }
  return cells.map((value) => value.toString(16).padStart(2, '0')).join('')
}

/** How far apart two thumbnails are: the mean difference of their cells, 0 to 255. */
export function thumbDistance(a: Thumb, b: Thumb): number {
  if (a.length !== b.length || a.length === 0) return Number.POSITIVE_INFINITY
  let sum = 0
  for (let i = 0; i < a.length; i += 2) sum += Math.abs(Number.parseInt(a.slice(i, i + 2), 16) - Number.parseInt(b.slice(i, i + 2), 16))
  return sum / (a.length / 2)
}

async function capture(page: Page, ref: string): Promise<{ thumb?: Thumb | undefined; skipped?: string | undefined }> {
  if (ref.includes(' >>> ') || ref.includes(' |> ')) return { skipped: 'in a shadow root or a frame' }
  try {
    const png = await page.locator(`css=${ref}`).first().screenshot({ type: 'png', timeout: 3000, animations: 'disabled', scale: 'css' })
    const thumb = thumbOf(png)
    return thumb ? { thumb } : { skipped: 'capture-failed' }
  } catch (error) {
    return { skipped: `capture-failed: ${errorMessage(error).slice(0, 80)}` }
  }
}

const key = (image: VariantImage) => `${image.ref}|${image.src}`

/** Follows each carousel, and each image a script swaps, over the clock; captures each picture once. */
async function carousels(page: Page, clock: boolean, deadline: number): Promise<CarouselRecord[]> {
  const found = await page.evaluate(carouselsInPage, { maxCarousels: MAX_CAROUSELS, maxSlides: MAX_SLIDES })
  const records: CarouselRecord[] = found.map((carousel) => ({ ...carousel, states: [], pictures: [] }))
  const carouselRefs = found.map((carousel) => carousel.el.ref)
  // Large images outside the carousels: one whose address a script changes on the clock is followed as a carousel of one image.
  const banners = new Map<string, CarouselRecord & { last: string; changes: number }>()
  for (const image of await page.evaluate(largeImagesInPage, { exclude: carouselRefs, max: 20 })) {
    banners.set(image.ref, { el: { ...image }, why: 'swap', images: [image], states: [{ at: 0, image }], pictures: [], last: image.src, changes: 0 })
  }
  const seen = new Map<string, VariantPicture>()
  const take = async (record: CarouselRecord, image: VariantImage, shown: VariantPicture['shown']) => {
    if (seen.has(key(image))) return
    const loaded = await page.evaluate(decodedInPage, { ref: image.ref, tries: 60 }).catch(() => 'not-loaded' as const)
    // A lazy loader's stand-in is no picture: the image is captured again once its own picture comes.
    if (loaded === 'placeholder') return
    const picture: VariantPicture = { ...image, shown, ...(loaded === 'ready' ? await capture(page, image.ref) : { skipped: loaded }) }
    seen.set(key(image), picture)
    record.pictures.push(picture)
  }
  const sample = async (at: number) => {
    const shown = await page.evaluate(shownInPage, carouselRefs)
    for (const [i, record] of records.entries()) {
      const image = shown[i] ?? undefined
      record.states.push({ at, ...(image ? { image } : {}) })
      if (image) await take(record, image, 'clock')
    }
    if (at === 0 || banners.size === 0) return
    for (const image of await page.evaluate(largeImagesInPage, { exclude: carouselRefs, max: 40 })) {
      const banner = banners.get(image.ref)
      if (!banner) continue
      banner.states.push({ at, image })
      if (image.src !== banner.last) {
        banner.changes++
        banner.last = image.src
      }
      // Each picture is captured the first time it shows after a change; the first one, when it comes back round.
      if (banner.changes > 0) await take(banner, image, 'clock')
    }
  }
  await sample(0)
  for (let step = 1; clock && step <= STEPS && Date.now() < deadline; step++) {
    await page.clock.runFor(STEP_MS)
    await page.waitForTimeout(150)
    await sample(step * STEP_MS)
  }
  // A picture that changes once is an image loading late (a lazy loader's swap); one that changes again rotates.
  for (const { last: _last, changes, ...banner } of banners.values()) {
    if (changes < 2 || records.filter((record) => record.why === 'swap').length >= MAX_SWAPS) continue
    const first = banner.images[0] as VariantImage
    if (!seen.has(key(first))) banner.pictures.unshift({ ...first, shown: 'clock', skipped: 'shown before the first change only' })
    records.push(banner)
  }
  // Slides that never showed: made visible one at a time, as the image captures of 1.1.1 do.
  await page.evaluate(() => {
    const w = window as unknown as { __rampaResolve?: (ref: string) => Element | null; __rampaKit: Kit }
    w.__rampaResolve = (ref: string) => w.__rampaKit.resolve(ref)
  })
  for (const record of records) {
    if (record.why === 'swap') continue
    for (const image of record.images) {
      if (Date.now() > deadline) break
      if ([...seen.values()].some((picture) => picture.ref === image.ref)) continue
      try {
        const prepared = await page.evaluate(prepareImageInPage, { ref: image.ref, waitMs: 2000 })
        const picture: VariantPicture = { ...image, src: prepared.source || image.src, shown: 'made-visible', ...(prepared.status === 'ready' ? await capture(page, image.ref) : { skipped: prepared.status }) }
        seen.set(key(picture), picture)
        record.pictures.push(picture)
      } finally {
        await page.evaluate(restoreImageInPage, null).catch(() => undefined)
      }
    }
  }
  return records
}

const primary = (tag: string) => tag.toLowerCase().split(/[-_]/)[0] ?? ''
const withoutHash = (address: string) => address.split('#')[0] ?? address

/** The other language versions the page leads to: its alternates first, then its switcher's links; one per language. */
export function languageVersions(
  page: string,
  found: ReturnType<typeof languageLinksInPage>,
  max = MAX_LANGUAGES,
): { versions: LanguageVersion[]; leftOut: number } {
  const own = found.lang ? primary(found.lang) : undefined
  const candidates: LanguageVersion[] = []
  for (const alternate of found.alternates) {
    if (alternate.hreflang === '' || alternate.hreflang.toLowerCase() === 'x-default') continue
    candidates.push({ href: alternate.href, via: 'hreflang', claimed: alternate.hreflang })
  }
  for (const link of found.links) {
    const claimed = link.hreflang || autonymOf(link.text)
    if (!claimed) continue
    candidates.push({ href: link.href, via: 'switcher', claimed, link: link.el })
  }
  const languages = new Set<string>()
  const addresses = new Set<string>()
  const versions: LanguageVersion[] = []
  let leftOut = 0
  for (const candidate of candidates) {
    let url: URL
    try {
      url = new URL(candidate.href)
    } catch {
      continue
    }
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || withoutHash(url.href) === withoutHash(page)) continue
    const language = primary(candidate.claimed)
    // This page's own language, and a language already read, are not read again.
    if (language === own || languages.has(language) || addresses.has(withoutHash(url.href))) {
      // A switcher's link to a version an alternate already names keeps the link, so a finding can point at it.
      const same = versions.find((version) => withoutHash(version.href) === withoutHash(url.href) || primary(version.claimed) === language)
      if (same && !same.link && candidate.link) same.link = candidate.link
      continue
    }
    if (versions.length >= max) {
      leftOut++
      languages.add(language)
      continue
    }
    languages.add(language)
    addresses.add(withoutHash(url.href))
    versions.push({ ...candidate, href: url.href })
  }
  return { versions, leftOut }
}

async function readVersion(browser: Browser, version: LanguageVersion, options: ProbeOptions): Promise<LanguageVersion> {
  try {
    const probe = await openProbePage(browser, version.href, options, { variant: 'language-version' })
    try {
      const read = await probe.page.evaluate(languageTextInPage, TEXT_LIMIT)
      return { ...version, url: probe.page.url(), declared: read.declared, title: read.title, text: read.text }
    } finally {
      await probe.context.close()
    }
  } catch (error) {
    return { ...version, reason: `not read: ${errorMessage(error).slice(0, 120)}` }
  }
}

export async function runVariantsProbe(browser: Browser, url: string, options: ProbeOptions): Promise<ProbeRecord> {
  const started = Date.now()
  const deadline = started + TIME_BUDGET_MS
  const probe = await openProbePage(browser, url, options, { variant: 'state-variants', clock: true })
  try {
    const { page } = probe
    let clock = true
    try {
      await page.clock.runFor(1)
    } catch {
      clock = false
    }
    const records = await carousels(page, clock, deadline)
    const found = await page.evaluate(languageLinksInPage)
    const { versions, leftOut } = languageVersions(page.url(), found)
    const languages: LanguageVersion[] = []
    for (const version of versions) {
      if (Date.now() > deadline) {
        languages.push({ ...version, reason: 'time budget reached' })
        continue
      }
      languages.push(await readVersion(browser, version, options))
    }
    const viewport = page.viewportSize() ?? probe.conditions.viewport
    const data: VariantsData = { viewport, clock, steps: STEPS, stepMs: STEP_MS, carousels: records, lang: found.lang, languages, languagesLeftOut: leftOut }
    const late = Date.now() > deadline
    return {
      kind: 'variants',
      version: VARIANTS_VERSION,
      conditions: { ...probe.conditions, viewport },
      status: late ? 'partial' : 'complete',
      ...(late ? { reason: `time budget reached (${TIME_BUDGET_MS / 1000} s)` } : {}),
      guard: probe.guard.log,
      durationMs: Date.now() - started,
      data,
    }
  } finally {
    await probe.context.close()
  }
}

/** The state-variants probe as a step of the probe stage; a probe that fails leaves a skipped record. */
export async function variantsProbe(browser: Browser, url: string, options: ProbeOptions): Promise<ProbeRecord[]> {
  const started = Date.now()
  try {
    return [await runVariantsProbe(browser, url, options)]
  } catch (error) {
    return [skippedRecord('variants', VARIANTS_VERSION, 'state-variants', `probe failed: ${errorMessage(error)}`, Date.now() - started)]
  }
}
