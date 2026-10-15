import type { IconControlFacts, NewWindowFacts, Presentation, TextBlockFacts } from '../snapshot/schema.ts'
import type { CdpSessionLike } from './form-issues.ts'

/**
 * How the page sets its reading text and its controls, measured in the browser for the cognitive profile
 * (docs/cognitive-profile.md, "Legibility, icons and new windows"). Runs only with `--profile cognitive`, after the
 * collector, and reads the elements the collector kept (`window.__rampaRefs`), so it stays within the collector's cap
 * of elements and every fact names a ref of the tree.
 *
 * - Blocks of reading text (paragraphs, list items, cells and text blocks whose text is not split among other blocks),
 *   inside main or article when the page has them: the lines the text is drawn on at this viewport, with
 *   `Range.getClientRects()` per text node, the characters on each line, the distance between lines, the alignment,
 *   capitals, italics, and the font: the first family of the CSS list the browser has, and over CDP the font it drew
 *   the glyphs with (`CSS.getPlatformFontsForNode`), once per family.
 * - Controls that show no words: only an svg, an image, an icon font, a pseudo-element, a symbol or a CSS background.
 * - Links that open a new window (a target, or an inline handler that calls window.open), with what they show, what
 *   assistive technology reads, and their description.
 *
 * Facts, never verdicts: the advisory checks (src/advisory/checks/legibility.ts, icon-only.ts, new-window.ts) decide.
 */

export const PRESENTATION_VERSION = '1'

export interface PresentationLimits {
  /** Blocks of reading text measured, in document order. */
  blocks: number
  controls: number
  links: number
  /** Distinct fonts asked over CDP for the font the browser drew. */
  fonts: number
}

export const PRESENTATION_LIMITS: PresentationLimits = { blocks: 200, controls: 300, links: 300, fonts: 8 }

/** What the page hands back: the facts, and the blocks to ask the browser about over CDP (one per font). */
export interface InPagePresentation extends Omit<Presentation, 'version'> {
  /** Indexes into `blocks`; their text elements wait on the page in `window.__rampaFontProbes`, in the same order. */
  probes: number[]
}

/**
 * Runs inside the page (serialized by the browser library, so it references nothing outside its body).
 * Blocks under 6 words are kept only when they are set in capitals, the one check that reads short passages.
 */
export function presentationInPage(limits: PresentationLimits): InPagePresentation {
  const started = performance.now()
  const refs = (window as unknown as { __rampaRefs?: Map<Element, string> }).__rampaRefs
  const viewport = { width: window.innerWidth, height: window.innerHeight }
  const result: InPagePresentation = { viewport, scope: 'page', blocks: [], controls: [], links: [], leftOut: { blocks: 0, controls: 0, links: 0 }, ms: 0, probes: [] }
  if (!refs) return result

  const SKIP = new Set(['script', 'style', 'noscript', 'template', 'head', 'meta', 'link', 'title'])
  const collapse = (value: string | null | undefined): string => (value ?? '').replace(/\s+/g, ' ').trim()
  const cut = (value: string, max: number): string => (value.length > max ? `${value.slice(0, max - 1)}…` : value)
  const isShadowRoot = (node: Node): node is ShadowRoot => node.nodeType === 11 && 'host' in node
  const isDocument = (node: Node): node is Document => node.nodeType === 9
  const styles = new Map<Element, CSSStyleDeclaration>()
  const styleOf = (el: Element): CSSStyleDeclaration => {
    let style = styles.get(el)
    if (!style) {
      style = (el.ownerDocument.defaultView ?? window).getComputedStyle(el)
      styles.set(el, style)
    }
    return style
  }
  const composedClosest = (el: Element, selector: string): Element | null => {
    for (let current: Element | null = el; current; ) {
      const found = current.closest(selector)
      if (found) return found
      const root = current.getRootNode()
      current = isShadowRoot(root) ? root.host : isDocument(root) ? (root === document ? null : (root.defaultView?.frameElement ?? null)) : null
    }
    return null
  }
  const visibleCache = new Map<Element, boolean>()
  const rendered = (el: Element): boolean => {
    let known = visibleCache.get(el)
    if (known === undefined) {
      known = typeof el.checkVisibility === 'function' ? el.checkVisibility({ visibilityProperty: true, checkVisibilityCSS: true, opacityProperty: true } as CheckVisibilityOptions) : true
      visibleCache.set(el, known)
    }
    return known
  }
  /** The visually hidden pattern: a box of 1 px or less, a clip that leaves nothing, or a box moved out of the page. */
  const clippedCache = new Map<Element, boolean>()
  const clippedAway = (el: Element): boolean => {
    let known = clippedCache.get(el)
    if (known !== undefined) return known
    const style = styleOf(el)
    const rect = el.getBoundingClientRect()
    const tiny = style.display !== 'inline' && style.display !== 'contents' && (rect.width <= 1 || rect.height <= 1) && style.overflow !== 'visible'
    const clip = /rect\(\s*0(px)?[\s,]+0(px)?[\s,]+0(px)?[\s,]+0(px)?\s*\)/.test(style.clip) || /inset\(\s*(50|100)%|circle\(\s*0/.test(style.clipPath)
    const away = (style.position === 'absolute' || style.position === 'fixed') && (rect.right + window.scrollX < 0 || rect.bottom + window.scrollY < 0 || rect.left > document.documentElement.scrollWidth + 100)
    const indented = Number.parseFloat(style.textIndent) < -999 && style.overflow !== 'visible'
    known = tiny || clip || away || indented || Number.parseFloat(style.fontSize) < 2
    clippedCache.set(el, known)
    return known
  }
  /** Shown to a sighted person: rendered, and neither it nor an ancestor up to `stop` visually hidden. */
  const shows = (el: Element, stop: Element): boolean => {
    if (!rendered(el)) return false
    for (let current: Element | null = el; current; current = current === stop ? null : current.parentElement) {
      if (clippedAway(current)) return false
    }
    return true
  }

  // ---- blocks of reading text ------------------------------------------------------------------------------------
  const BLOCK_TAGS = new Set(['p', 'li', 'dd', 'dt', 'blockquote', 'figcaption', 'div', 'section', 'article', 'td', 'address'])
  const BLOCK_DISPLAY = /^(block|list-item|table-cell|flow-root|inline-block)$/
  const INLINE_DISPLAY = /^(inline|inline-block|inline-flex|inline-grid|inline-table|ruby|ruby-text|contents)$/
  /** Not reading text: navigation, page header and footer, asides, menus, and text that names a control or is code. */
  const OUTSIDE =
    'nav, header, footer, aside, [role="navigation"], [role="banner"], [role="contentinfo"], [role="complementary"], [role="menu"], [role="menubar"], [role="toolbar"], [role="tablist"], a, button, [role="button"], [role="link"], label, legend, summary, select, option, textarea, pre, code, kbd, samp, svg, math, h1, h2, h3, h4, h5, h6, [role="heading"], [contenteditable=""], [contenteditable="true"]'
  const MAINS = 'main, [role="main"], article'
  const PUA = /^[\s\uE000-\uF8FF\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}]+$/u
  const SMALL_CAPS = new Set(['small-caps', 'all-small-caps', 'petite-caps', 'all-petite-caps', 'unicase', 'titling-caps'])
  const MIN_WORDS = 6
  const LONG_WORDS = 25

  let hasMain = false
  for (const el of refs.keys()) {
    if (el.matches(MAINS) && rendered(el)) {
      hasMain = true
      break
    }
  }
  result.scope = hasMain ? 'main' : 'page'

  /** Its children with text are all inline: the block's text is its own, not split among blocks measured on their own. */
  const ownsItsText = (el: Element): boolean => {
    const stack = Array.from(el.children)
    while (stack.length > 0) {
      const child = stack.pop() as Element
      if (SKIP.has(child.localName)) continue
      const display = styleOf(child).display
      if (display === 'none') continue
      if (display === 'contents') {
        stack.push(...Array.from(child.children))
        continue
      }
      if (!INLINE_DISPLAY.test(display) && collapse(child.textContent) !== '') return false
    }
    return true
  }

  const splitFamilies = (list: string): string[] =>
    (list.match(/"[^"]*"|'[^']*'|[^,]+/g) ?? []).map((part) => part.trim().replace(/^["']|["']$/g, '').trim()).filter(Boolean)
  const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'math', 'emoji', 'fangsong'])
  let canvas: CanvasRenderingContext2D | null | undefined
  const known = new Map<string, boolean>()
  /** Whether the browser has a family: text set in it measures otherwise than in each fallback alone. */
  const available = (family: string): boolean => {
    const key = family.toLowerCase()
    if (GENERIC.has(key)) return true
    const cached = known.get(key)
    if (cached !== undefined) return cached
    if (canvas === undefined) canvas = document.createElement('canvas').getContext('2d')
    let found = false
    if (canvas) {
      const probe = 'mmmmmmmmmmlli1WQ@#ãç'
      const quoted = `"${family.replace(/"/g, '')}"`
      for (const base of ['monospace', 'serif', 'sans-serif']) {
        canvas.font = `40px ${base}`
        const alone = canvas.measureText(probe).width
        canvas.font = `40px ${quoted}, ${base}`
        if (Math.abs(canvas.measureText(probe).width - alone) > 0.1) {
          found = true
          break
        }
      }
    }
    known.set(key, found)
    return found
  }
  /** The family the list resolves to: the first one the browser has, or the browser's default (serif) past the end. */
  const resolveFamily = (list: string): string => splitFamilies(list).find(available) ?? 'serif'

  interface Fragment {
    top: number
    bottom: number
    left: number
    right: number
    chars: number
  }
  const median = (values: number[]): number => {
    if (values.length === 0) return 0
    const sorted = [...values].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    return sorted.length % 2 === 1 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
  }
  /** Fragments on the same line overlap vertically; on one line, a gap of 3 em or more starts another column. */
  const linesOf = (fragments: Fragment[], em: number): Array<{ top: number; chars: number }> => {
    const bands: Array<{ top: number; bottom: number; parts: Fragment[] }> = []
    for (const fragment of [...fragments].sort((a, b) => a.top + a.bottom - (b.top + b.bottom))) {
      const band = bands.at(-1)
      const overlap = band ? Math.min(band.bottom, fragment.bottom) - Math.max(band.top, fragment.top) : 0
      if (band && overlap >= 0.5 * Math.min(band.bottom - band.top, fragment.bottom - fragment.top)) {
        band.parts.push(fragment)
        band.top = Math.min(band.top, fragment.top)
        band.bottom = Math.max(band.bottom, fragment.bottom)
      } else bands.push({ top: fragment.top, bottom: fragment.bottom, parts: [fragment] })
    }
    const lines: Array<{ top: number; chars: number }> = []
    for (const band of bands) {
      const parts = band.parts.sort((a, b) => a.left - b.left)
      let current = { top: band.top, chars: 0 }
      let right = Number.NEGATIVE_INFINITY
      for (const part of parts) {
        if (current.chars > 0 && part.left - right >= 3 * em) {
          lines.push(current)
          current = { top: band.top, chars: 0 }
        }
        current.chars += part.chars
        right = Math.max(right, part.right)
      }
      if (current.chars > 0) lines.push(current)
    }
    return lines
  }

  const probeElements: Element[] = []
  const probedFonts = new Set<string>()
  const LETTER = /\p{L}/gu
  const UPPER = /\p{Lu}/gu
  const LOWER = /\p{Ll}/gu
  const RTL = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/gu
  const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu
  const count = (text: string, pattern: RegExp): number => text.match(pattern)?.length ?? 0

  for (const [el, ref] of refs) {
    if (!BLOCK_TAGS.has(el.localName) || el === document.body) continue
    const raw = el.textContent ?? ''
    if (raw.length < 25 || !rendered(el)) continue
    const style = styleOf(el)
    if (!BLOCK_DISPLAY.test(style.display)) continue
    if ((el.parentElement && composedClosest(el.parentElement, OUTSIDE)) || el.matches(OUTSIDE)) continue
    if (hasMain && !composedClosest(el, MAINS)) continue
    if (!ownsItsText(el)) continue

    const fragments: Fragment[] = []
    const bySize = new Map<number, number>()
    const byFamily = new Map<string, { chars: number; element: Element }>()
    let text = ''
    let letters = 0
    let cased = 0
    let upper = 0
    let italic = 0
    let rtl = 0
    let cjk = 0
    const capsFrom = { 'text-transform': 0, 'font-variant': 0, text: 0 }
    const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    const range = el.ownerDocument.createRange()
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const value = (node.textContent ?? '').replace(/\s+/g, ' ')
      const parent = node.parentElement
      if (!parent || value.trim() === '' || SKIP.has(parent.localName) || !shows(parent, el)) continue
      range.selectNodeContents(node)
      const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0.5 && rect.height > 0.5)
      const width = rects.reduce((sum, rect) => sum + rect.width, 0)
      if (width === 0) continue
      for (const rect of rects) fragments.push({ top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, chars: (value.length * rect.width) / width })
      text += value
      const own = styleOf(parent)
      const size = Math.round((Number.parseFloat(own.fontSize) || 0) * 10) / 10
      bySize.set(size, (bySize.get(size) ?? 0) + value.length)
      const family = byFamily.get(own.fontFamily) ?? { chars: 0, element: parent }
      family.chars += value.length
      byFamily.set(own.fontFamily, family)
      const nodeLetters = count(value, LETTER)
      const nodeUpper = count(value, UPPER)
      const nodeCased = nodeUpper + count(value, LOWER)
      letters += nodeLetters
      cased += nodeCased
      rtl += count(value, RTL)
      cjk += count(value, CJK)
      if (own.fontStyle !== 'normal') italic += nodeLetters
      if (own.textTransform === 'uppercase') {
        upper += nodeCased
        capsFrom['text-transform'] += nodeCased
      } else if (SMALL_CAPS.has(own.fontVariantCaps) && own.textTransform !== 'lowercase') {
        upper += nodeCased
        capsFrom['font-variant'] += nodeCased - nodeUpper
        capsFrom.text += nodeUpper
      } else if (own.textTransform !== 'lowercase') {
        upper += nodeUpper
        capsFrom.text += nodeUpper
      }
    }
    range.detach()
    const shown = collapse(text)
    const words = shown.split(' ').filter((word) => /[\p{L}\p{N}]/u.test(word)).length
    if (words < MIN_WORDS && !(cjk > letters / 2 && shown.length >= 15)) continue
    const size = [...bySize].sort((a, b) => b[1] - a[1])[0]?.[0] ?? (Number.parseFloat(style.fontSize) || 16)
    const lines = linesOf(fragments, size || 16)
    const long = words >= LONG_WORDS || lines.length >= 3
    // A short block is kept only when it is set in capitals: the one check that reads short passages.
    if (!long && !(cased > 0 && upper / cased >= 0.9)) continue
    if (result.blocks.length >= limits.blocks) {
      result.leftOut.blocks++
      continue
    }
    const counts = lines.map((line) => Math.round(line.chars))
    const tops = lines.map((line) => line.top).sort((a, b) => a - b)
    const gaps = tops.slice(1).map((top, i) => top - (tops[i] as number)).filter((gap) => gap > 1)
    const dominant = [...byFamily].sort((a, b) => b[1].chars - a[1].chars)[0]
    const family = dominant?.[0] ?? style.fontFamily
    const font = resolveFamily(family)
    const caps = Object.entries(capsFrom).sort((a, b) => b[1] - a[1])[0]
    const block: TextBlockFacts = {
      ref,
      tag: el.localName,
      chars: shown.length,
      words,
      sample: cut(shown, 120),
      lines: lines.length,
      charsPerLine: { median: Math.round(median(counts.length > 1 ? counts.slice(0, -1) : counts)), max: Math.max(0, ...counts) },
      ...(gaps.length > 0 ? { lineGap: Math.round(median(gaps) * 10) / 10 } : {}),
      fontSize: size,
      lineHeight: style.lineHeight,
      family: cut(family, 160),
      font,
      align: style.textAlign,
      direction: style.direction,
      ...(rtl > letters / 2 ? { script: 'rtl' as const } : cjk > letters / 2 ? { script: 'cjk' as const } : {}),
      letters,
      cased,
      upper,
      italic,
      ...(caps && caps[1] > 0 ? { capsBy: caps[0] as TextBlockFacts['capsBy'] } : {}),
    }
    result.blocks.push(block)
    // One block per font is asked over CDP which font the browser drew its glyphs with.
    if (dominant && !probedFonts.has(family) && probedFonts.size < limits.fonts) {
      probedFonts.add(family)
      result.probes.push(result.blocks.length - 1)
      probeElements.push(dominant[1].element)
    }
  }
  ;(window as unknown as { __rampaFontProbes?: Element[] }).__rampaFontProbes = probeElements

  // ---- controls that show no words --------------------------------------------------------------------------------
  const byIds = (el: Element, attribute: string): string => {
    const root = el.getRootNode() as Document | ShadowRoot
    return collapse(
      (el.getAttribute(attribute) ?? '')
        .split(/\s+/)
        .map((id) => (id && typeof root.getElementById === 'function' ? (root.getElementById(id)?.textContent ?? '') : ''))
        .join(' '),
    )
  }
  /**
   * The control's name, as the browser computes it in the common cases: aria-labelledby, aria-label, then its content
   * with the alternatives of images and svg titles, then title. The browser's own name (`ax`) wins where Rampa read it.
   */
  const nameOf = (el: Element): string => {
    const labelled = byIds(el, 'aria-labelledby') || collapse(el.getAttribute('aria-label'))
    if (labelled) return labelled
    const out: string[] = []
    const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.nodeType === Node.TEXT_NODE) {
        const parent = node.parentElement
        if (parent && !SKIP.has(parent.localName) && rendered(parent) && !composedClosest(parent, '[aria-hidden="true"]')) out.push(node.textContent ?? '')
        continue
      }
      const element = node as Element
      if (element.getAttribute('aria-hidden') === 'true') continue
      if (element.localName === 'img') out.push(element.getAttribute('alt') ?? '')
      else if (element !== el && element.getAttribute('aria-label')) out.push(element.getAttribute('aria-label') ?? '')
      else if (element.localName === 'title' && element.parentElement?.localName === 'svg') out.push(element.textContent ?? '')
    }
    return collapse(out.join(' ')) || collapse(el.getAttribute('title'))
  }
  const CONTROL = 'a[href], button, [role="button"], [role="link"], [role="menuitem"], [role="tab"]'
  const ICON_FONT = /icon|awesome|glyph|material symbols|feather|fontello|icomoon/i
  const LOGO = /logo|brand|marca/i
  const contentOf = (el: Element, pseudo: string): string => {
    const content = (el.ownerDocument.defaultView ?? window).getComputedStyle(el, pseudo).content
    if (!content || content === 'none' || content === 'normal') return ''
    return content.replace(/^["']|["']$/g, '')
  }
  const hasWords = (value: string): boolean => count(value, LETTER) >= 2 || /\p{N}/u.test(value)
  const pseudoIcon = (el: Element): boolean =>
    ['::before', '::after'].some((pseudo) => {
      const content = contentOf(el, pseudo)
      return content !== '' && (PUA.test(content) || ICON_FONT.test((el.ownerDocument.defaultView ?? window).getComputedStyle(el, pseudo).fontFamily))
    })
  const pseudoWords = (el: Element): boolean =>
    ['::before', '::after'].some((pseudo) => {
      const content = contentOf(el, pseudo)
      return hasWords(content) && !PUA.test(content) && !ICON_FONT.test((el.ownerDocument.defaultView ?? window).getComputedStyle(el, pseudo).fontFamily)
    })
  const hintOf = (el: Element): string =>
    cut(collapse([el.getAttribute('class'), el.getAttribute('src'), el.getAttribute('alt'), el.getAttribute('data-icon')].filter(Boolean).join(' ')), 80)

  for (const [el, ref] of refs) {
    if (!el.matches(CONTROL) || !rendered(el)) continue
    if (el.parentElement && composedClosest(el.parentElement, CONTROL)) continue
    if (composedClosest(el, '[aria-hidden="true"]') || el.matches(':disabled') || el.getAttribute('aria-disabled') === 'true') continue
    const box = el.getBoundingClientRect()
    if (box.width < 8 || box.height < 8 || clippedAway(el)) continue
    const parts: Array<{ el: Element; kind: IconControlFacts['icon']; glyph?: string }> = []
    let words = pseudoWords(el)
    if (pseudoIcon(el)) parts.push({ el, kind: 'pseudo' })
    const visit = (holder: Element | ShadowRoot): void => {
      for (const child of Array.from(holder.childNodes)) {
        if (words) return
        if (child.nodeType === Node.TEXT_NODE) {
          const value = collapse(child.textContent)
          const parent = child.parentElement ?? (isShadowRoot(holder) ? holder.host : null)
          if (!value || !parent || !shows(parent, el)) continue
          if (PUA.test(value) || ICON_FONT.test(styleOf(parent).fontFamily)) parts.push({ el: parent, kind: 'icon-font' })
          else if (hasWords(value)) words = true
          else parts.push({ el: parent, kind: 'symbol', glyph: value.slice(0, 8) })
          continue
        }
        if (child.nodeType !== Node.ELEMENT_NODE) continue
        const element = child as Element
        if (SKIP.has(element.localName)) continue
        if (styleOf(element).display === 'contents') {
          visit(element)
          continue
        }
        if (!shows(element, el)) continue
        const tag = element.localName
        if (tag === 'svg') parts.push({ el: element, kind: 'svg' })
        else if (tag === 'img') parts.push({ el: element, kind: 'img' })
        else if (tag === 'picture') {
          const img = element.querySelector('img')
          if (img && rendered(img)) parts.push({ el: img, kind: 'img' })
        } else if (pseudoWords(element)) words = true
        else if (pseudoIcon(element) && collapse(element.textContent) === '') parts.push({ el: element, kind: 'pseudo' })
        else {
          visit(element)
          if (element.shadowRoot) visit(element.shadowRoot)
        }
      }
    }
    visit(el)
    if (el.shadowRoot) visit(el.shadowRoot)
    if (words) continue
    if (parts.length === 0) {
      // Nothing drawn inside: a picture set as the control's CSS background is its icon.
      if (!/url\(/.test(styleOf(el).backgroundImage)) continue
      parts.push({ el, kind: 'background' })
    }
    // The largest part is what people see; an icon is small, and a logo or a photo is not an icon.
    let main = parts[0] as (typeof parts)[number]
    let area = -1
    for (const part of parts) {
      const rect = part.el.getBoundingClientRect()
      if (rect.width * rect.height > area) {
        area = rect.width * rect.height
        main = part
      }
    }
    const rect = main.el.getBoundingClientRect()
    if (main.kind !== 'background' && main.kind !== 'pseudo' && (rect.width > 64 || rect.height > 64)) continue
    if (main.kind === 'background' && (box.width > 64 || box.height > 64)) continue
    const hint = hintOf(main.el === el ? el : main.el)
    if ([hint, el.getAttribute('class') ?? '', el.id].some((mark) => LOGO.test(mark))) continue
    if (result.controls.length >= limits.controls) {
      result.leftOut.controls++
      continue
    }
    const name = cut(nameOf(el), 120)
    result.controls.push({ ref, icon: main.kind, ...(main.glyph ? { glyph: main.glyph } : {}), ...(hint ? { hint } : {}), ...(name ? { name } : {}) })
  }

  // ---- links that open a new window --------------------------------------------------------------------------------
  const visibleText = (root: Element): string => {
    const out: string[] = []
    const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement
      if (!parent || SKIP.has(parent.localName) || !shows(parent, root) || PUA.test(node.textContent ?? '') || ICON_FONT.test(styleOf(parent).fontFamily)) continue
      out.push(node.textContent ?? '')
    }
    return collapse(out.join(' '))
  }
  /** What is read but not shown: aria-label, visually hidden text, and the text alternatives of icons and images inside. */
  const hiddenText = (el: Element): string => {
    const out = [el.getAttribute('aria-label') ?? '', byIds(el, 'aria-labelledby')]
    const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.nodeType === Node.TEXT_NODE) {
        const parent = node.parentElement
        if (parent && !SKIP.has(parent.localName) && rendered(parent) && !shows(parent, el)) out.push(node.textContent ?? '')
        continue
      }
      const element = node as Element
      if (element.getAttribute('aria-hidden') === 'true') continue
      if (element.localName === 'img') out.push(element.getAttribute('alt') ?? '')
      if (element !== el) out.push(element.getAttribute('aria-label') ?? '')
      if (element.localName === 'title' && element.parentElement?.localName === 'svg') out.push(element.textContent ?? '')
    }
    return collapse(out.join(' '))
  }
  /** An icon in or right after the link with no text alternative: what a person may see, and assistive technology does not read. */
  const silentIcon = (el: Element): string | undefined => {
    const silent = (icon: Element | null): boolean => {
      if (!icon || !rendered(icon)) return false
      const tag = icon.localName
      if (tag === 'img') return collapse(icon.getAttribute('alt')) === '' || icon.getAttribute('aria-hidden') === 'true'
      if (tag === 'svg') return icon.getAttribute('aria-hidden') === 'true' || (!collapse(icon.getAttribute('aria-label')) && !collapse(icon.querySelector('title')?.textContent))
      return (pseudoIcon(icon) || ICON_FONT.test(styleOf(icon).fontFamily)) && !collapse(icon.getAttribute('aria-label'))
    }
    const inside = Array.from(el.querySelectorAll('svg, img, i, span')).find((icon) => (icon.localName === 'svg' || icon.localName === 'img' || collapse(icon.textContent) === '' || PUA.test(icon.textContent ?? '')) && silent(icon))
    if (inside) return hintOf(inside) || inside.localName
    if (pseudoIcon(el)) return hintOf(el) || el.localName
    const next = el.nextElementSibling
    if (next && collapse(next.textContent) === '' && silent(next)) return hintOf(next) || next.localName
    return undefined
  }
  const frameNamed = (name: string): boolean => {
    try {
      return document.querySelector(`iframe[name="${CSS.escape(name)}"], frame[name="${CSS.escape(name)}"]`) !== null
    } catch {
      return false
    }
  }

  for (const [el, ref] of refs) {
    if ((el.localName !== 'a' && el.localName !== 'area') || !el.hasAttribute('href')) continue
    const href = collapse(el.getAttribute('href')).toLowerCase()
    if (/^(mailto|tel|sms):/.test(href) || el.hasAttribute('download')) continue
    const target = collapse(el.getAttribute('target'))
    const lower = target.toLowerCase()
    let by: NewWindowFacts['by'] | undefined
    if (target && lower !== '_self' && lower !== '_parent' && lower !== '_top' && !frameNamed(target)) by = 'target'
    else if (/\bwindow\.open\s*\(/.test(el.getAttribute('onclick') ?? '')) by = 'script'
    if (!by || (by === 'target' && /^javascript:/.test(href))) continue
    if (!rendered(el) || composedClosest(el, '[aria-hidden="true"]')) continue
    if (el.localName === 'a' && clippedAway(el)) continue
    if (result.links.length >= limits.links) {
      result.leftOut.links++
      continue
    }
    const hidden = hiddenText(el)
    const description = collapse([byIds(el, 'aria-describedby'), el.getAttribute('aria-description') ?? '', el.getAttribute('title') ?? ''].join(' '))
    const icon = silentIcon(el)
    result.links.push({
      ref,
      by,
      ...(by === 'target' ? { target: cut(target, 40) } : {}),
      text: cut(el.localName === 'area' ? '' : visibleText(el), 200),
      ...(hidden ? { hidden: cut(hidden, 200) } : {}),
      ...(description ? { description: cut(description, 200) } : {}),
      ...(icon ? { icon } : {}),
    })
  }

  result.ms = Math.round(performance.now() - started)
  return result
}

/** What collecting the presentation needs from the browser library: Playwright pages and the test drivers fit it. */
export interface PresentationDriver {
  evaluate<Arg, Result>(fn: (arg: Arg) => Result | Promise<Result>, arg: Arg): Promise<Result>
  /** A CDP session on the page, in Chromium; without it the font is the first family of the CSS list the browser has. */
  cdp?: (() => Promise<CdpSessionLike | undefined>) | undefined
}

/** The presentation facts of the page, after the collector left its refs on it. */
export async function collectPresentation(driver: PresentationDriver, limits: PresentationLimits = PRESENTATION_LIMITS): Promise<Presentation> {
  const started = performance.now()
  const { probes, ...facts } = await driver.evaluate(presentationInPage, limits)
  if (probes.length > 0 && driver.cdp) {
    const drawn = await platformFonts(driver.cdp, probes.length)
    const byFamily = new Map<string, string>()
    for (const [index, block] of probes.entries()) {
      const font = drawn[index]
      const fact = facts.blocks[block]
      if (font && fact) byFamily.set(fact.family, font)
    }
    for (const block of facts.blocks) {
      const font = byFamily.get(block.family)
      if (font) block.platformFont = font
    }
  }
  return { version: PRESENTATION_VERSION, ...facts, ms: Math.round(performance.now() - started) }
}

/**
 * The font the browser drew most glyphs of each probed element with (CSS.getPlatformFontsForNode). Any failure (no
 * CDP, another browser, an element gone) leaves that font unknown; the check then reads the CSS list.
 */
async function platformFonts(open: () => Promise<CdpSessionLike | undefined>, count: number): Promise<Array<string | undefined>> {
  const out: Array<string | undefined> = []
  let session: CdpSessionLike | undefined
  try {
    session = await open()
    if (!session) return out
    await session.send('DOM.enable')
    await session.send('DOM.getDocument', { depth: 0 })
    await session.send('CSS.enable')
    for (let index = 0; index < count; index++) {
      try {
        const { result } = (await session.send('Runtime.evaluate', { expression: `(window.__rampaFontProbes || [])[${index}]` })) as { result: { objectId?: string } }
        if (!result.objectId) {
          out.push(undefined)
          continue
        }
        const { nodeId } = (await session.send('DOM.requestNode', { objectId: result.objectId })) as { nodeId: number }
        const { fonts } = (await session.send('CSS.getPlatformFontsForNode', { nodeId })) as { fonts: Array<{ familyName: string; glyphCount: number }> }
        out.push([...fonts].sort((a, b) => b.glyphCount - a.glyphCount)[0]?.familyName)
      } catch {
        out.push(undefined)
      }
    }
    await session.send('CSS.disable').catch(() => undefined)
    await session.send('DOM.disable').catch(() => undefined)
  } catch {
    // No CDP for this page: the fonts stay as the CSS list resolves them.
  } finally {
    await session?.detach().catch(() => undefined)
  }
  return out
}
