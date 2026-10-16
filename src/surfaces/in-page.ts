/**
 * Runs inside the browser page through `page.evaluate`. Playwright serializes
 * each exported function with toString(), so it must not reference anything
 * outside its own body: no imports, no module-level helpers.
 *
 * Refs follow snapshot/refs.ts: a CSS selector per document or shadow root,
 * joined by ` >>> ` into an open shadow root and by ` |> ` into a frame.
 */

export interface InPageNode {
  ref: string
  role: string
  name?: string | undefined
  text?: string | undefined
  lang?: string | undefined
  states: string[]
  bounds?: { x: number; y: number; width: number; height: number } | undefined
  native: Record<string, unknown>
  children: InPageNode[]
}

export interface InPageAxeNode {
  ref?: string | undefined
  target: string
  html: string
  message?: string | undefined
  impact?: string | null | undefined
  /** target-size only: an exception of WCAG 2.5.8 the page shows for this target (rules/target-size.ts applies it). */
  exempt?: 'user-agent-control' | 'equivalent-target' | undefined
  /** color-contrast only: axe-core's reason key, such as bgImage for an undecided result (surfaces/contrast-capture.ts reads it). */
  reasonKey?: string | undefined
}

export interface InPageAxeRule {
  id: string
  tags: string[]
  help: string
  helpUrl: string
  impact?: string | null | undefined
  nodes: InPageAxeNode[]
}

export interface InPageAxe {
  version: string
  violations: InPageAxeRule[]
  incomplete: InPageAxeRule[]
  passes: InPageAxeRule[]
  inapplicable: InPageAxeRule[]
}

/** A frame element the collector met, and whether its document is in the tree under it. */
export interface InPageFrame {
  ref: string
  /** The frame's address: its document's URL when the page may read it (about:srcdoc for srcdoc), else its src. */
  url?: string | undefined
  collected: boolean
  /** hidden: the frame is not rendered; cross-origin: the page may not read it; not-loaded: it still shows its first blank document; empty: it has no document. */
  reason?: 'hidden' | 'cross-origin' | 'not-loaded' | 'empty' | undefined
}

export interface InPageResult {
  title: string
  lang: string | undefined
  viewport: { width: number; height: number; scale: number }
  root: InPageNode
  truncated: boolean
  frames: InPageFrame[]
  /** Open shadow roots whose content is in the tree. */
  shadowRoots: number
  /** Elements of shadow roots and frames, which have a budget of their own (maxNodes), were left out past it. */
  beyondTruncated: boolean
}

export interface InPageOptions {
  maxNodes: number
}

/**
 * The collector's budget of elements for the page's own document (and another of the same size for its shadow roots
 * and frames). A page with more is cut there: the snapshot records `truncated` and `elementLimit`, and the report says
 * that what comes after the cut was not checked by the checks that read the snapshot.
 */
export const MAX_NODES = 5000

export async function collectInPage(options: InPageOptions): Promise<InPageResult> {
  const MAX_HTML = 600
  const READING_BLOCKS = new Set(['p', 'li', 'td', 'th', 'dt', 'dd', 'blockquote', 'figcaption', 'caption', 'label', 'legend', 'summary', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'])
  const SKIP = new Set(['script', 'style', 'noscript', 'template', 'head', 'meta', 'link', 'title', 'base'])
  const KEEP_ATTRS = ['id', 'class', 'lang', 'href', 'src', 'alt', 'title', 'type', 'role', 'name', 'for', 'aria-label', 'aria-labelledby', 'aria-hidden', 'aria-level', 'aria-describedby', 'placeholder', 'autocomplete', 'pattern',
    // What a field accepts, and whether its form validates it: the cognitive profile reads them (coga/input-formats).
    'maxlength', 'minlength', 'min', 'max', 'step', 'inputmode', 'required', 'aria-required', 'novalidate', 'formnovalidate',
    // Error states the page already shows (3.3.1, 3.3.3): fields marked invalid, their messages, and live regions.
    'aria-invalid', 'aria-errormessage', 'aria-live',
    // What a form does and the language a link leads to: 3.2.4 groups components by function, 3.3.4 reads forms that commit.
    'action', 'method', 'hreflang']
  const NAME_FROM_CONTENT = new Set(['a', 'button', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'summary', 'option', 'th', 'td', 'li', 'label', 'legend', 'caption', 'figcaption'])
  const refs = new Map<Element, string>()
  let count = 0
  let truncated = false
  let shadowRoots = 0
  let beyond = 0
  let beyondTruncated = false
  const frames: InPageFrame[] = []

  const escapeId = (value: string): string => CSS.escape(value)
  const isDocument = (node: Node): node is Document => node.nodeType === 9
  const isShadowRoot = (node: Node): node is ShadowRoot => node.nodeType === 11 && 'host' in node
  // An id anchors a ref only in a document (the page's or a frame's), as in the probe kit: a shadow root's chain starts at its own children.
  const hasUniqueId = (el: Element): boolean => {
    if (el.id === '') return false
    const root = el.getRootNode()
    return isDocument(root) && root.querySelectorAll(`#${escapeId(el.id)}`).length === 1
  }
  /** The element's ref (snapshot/refs.ts): its path in its own document or shadow root, behind the ref of the host or frame that holds it. */
  const cssPath = (el: Element): string => {
    const parts: string[] = []
    let current: Element | null = el
    while (current) {
      if (hasUniqueId(current)) {
        parts.unshift(`#${escapeId(current.id)}`)
        break
      }
      const parent: Element | null = current.parentElement
      const tag = current.localName
      // At the top of a shadow root the siblings are the root's own children.
      const siblings = parent ? parent.children : (current.parentNode as ParentNode | null)?.children
      const sameTag = siblings ? Array.from(siblings).filter((child) => child.localName === tag) : [current]
      // Escaped like an id: a parsed tag name may hold `.` or `:` (`<x-a.b>`, `<foo:bar>`), which a selector reads as a class or a pseudo-class.
      const step = CSS.escape(tag)
      parts.unshift(sameTag.length > 1 ? `${step}:nth-of-type(${sameTag.indexOf(current) + 1})` : step)
      if (!parent) break
      current = parent
    }
    const path = parts.join(' > ')
    const root = el.getRootNode()
    if (isShadowRoot(root)) return `${cssPath(root.host)} >>> ${path}`
    const frame = el.ownerDocument === document ? null : el.ownerDocument.defaultView?.frameElement
    return frame ? `${cssPath(frame)} |> ${path}` : path
  }

  const collapse = (value: string | null | undefined): string => (value ?? '').replace(/\s+/g, ' ').trim()

  // Elements of a frame belong to the frame's window: its constructors, its styles, its ids. These helpers read
  // an element through its own document and window, so the same code serves the page, its frames and shadow roots.
  /** `el instanceof HTMLImageElement`, with the constructor of the element's own window. */
  const kind = (el: Element, name: string): boolean => {
    const ctor = (el.ownerDocument.defaultView as unknown as Record<string, unknown> | null)?.[name]
    return typeof ctor === 'function' && el instanceof (ctor as new () => Element)
  }
  const styleOf = (el: Element): CSSStyleDeclaration => (el.ownerDocument.defaultView ?? window).getComputedStyle(el)
  /** The element an id names where `el` looks ids up: its shadow root, or its document. */
  const byId = (el: Element, id: string): Element | null => {
    const root = el.getRootNode() as Document | ShadowRoot
    return typeof root.getElementById === 'function' ? root.getElementById(id) : null
  }
  /** The frame element that shows a document of this page's origin, or null for the page itself. */
  const frameOf = (doc: Document): Element | null => (doc === document ? null : (doc.defaultView?.frameElement ?? null))
  /** `el.closest(selector)`, continued past the host of a shadow root and the frame element of a frame's document. */
  const composedClosest = (el: Element, selector: string): Element | null => {
    for (let current: Element | null = el; current; ) {
      const found = current.closest(selector)
      if (found) return found
      const root = current.getRootNode()
      current = isShadowRoot(root) ? root.host : isDocument(root) ? frameOf(root) : null
    }
    return null
  }
  /** Where a frame's viewport sits in the page's viewport: the frame element's content box, frame by frame. */
  const offsets = new Map<Document, { x: number; y: number }>()
  const offsetOf = (doc: Document): { x: number; y: number } => {
    const known = offsets.get(doc)
    if (known) return known
    const frame = frameOf(doc)
    let offset = { x: 0, y: 0 }
    if (frame) {
      const outer = offsetOf(frame.ownerDocument)
      const box = frame.getBoundingClientRect()
      const style = styleOf(frame)
      offset = {
        x: outer.x + box.left + frame.clientLeft + (Number.parseFloat(style.paddingLeft) || 0),
        y: outer.y + box.top + frame.clientTop + (Number.parseFloat(style.paddingTop) || 0),
      }
    }
    offsets.set(doc, offset)
    return offset
  }
  /** The element's box in the page's viewport, wherever its frame is. */
  const pageRect = (el: Element): { x: number; y: number; width: number; height: number; right: number; bottom: number } => {
    const rect = el.getBoundingClientRect()
    const { x, y } = offsetOf(el.ownerDocument)
    return { x: rect.x + x, y: rect.y + y, width: rect.width, height: rect.height, right: rect.right + x, bottom: rect.bottom + y }
  }

  const implicitRole = (el: Element): string => {
    const tag = el.localName
    const type = (el.getAttribute('type') ?? '').toLowerCase()
    switch (tag) {
      case 'html':
        return 'document'
      case 'a':
      case 'area':
        return el.hasAttribute('href') ? 'link' : 'generic'
      case 'button':
        return 'button'
      case 'img':
        return el.getAttribute('alt') === '' ? 'presentation' : 'img'
      case 'h1':
      case 'h2':
      case 'h3':
      case 'h4':
      case 'h5':
      case 'h6':
        return 'heading'
      case 'input':
        if (type === 'checkbox') return 'checkbox'
        if (type === 'radio') return 'radio'
        if (['button', 'submit', 'reset', 'image'].includes(type)) return 'button'
        if (type === 'range') return 'slider'
        if (type === 'number') return 'spinbutton'
        if (type === 'search') return 'searchbox'
        if (type === 'hidden') return 'none'
        return 'textbox'
      case 'select':
        return (el as HTMLSelectElement).multiple || (el as HTMLSelectElement).size > 1 ? 'listbox' : 'combobox'
      case 'textarea':
        return 'textbox'
      case 'nav':
        return 'navigation'
      case 'main':
        return 'main'
      case 'header':
        return 'banner'
      case 'footer':
        return 'contentinfo'
      case 'aside':
        return 'complementary'
      case 'form':
        return 'form'
      case 'section':
        return 'region'
      case 'article':
        return 'article'
      case 'ul':
      case 'ol':
        return 'list'
      case 'li':
        return 'listitem'
      case 'table':
        return 'table'
      case 'tr':
        return 'row'
      case 'td':
        return 'cell'
      case 'th':
        return 'columnheader'
      case 'p':
        return 'paragraph'
      case 'blockquote':
        return 'blockquote'
      case 'dialog':
        return 'dialog'
      case 'figure':
        return 'figure'
      case 'fieldset':
        return 'group'
      case 'svg':
        return 'graphics-document'
      default:
        return 'generic'
    }
  }

  /** A label's text without the control it wraps: a select would otherwise add every option to its own name. */
  const labelText = (label: Element, control: Element): string => {
    if (!label.contains(control)) return label.textContent ?? ''
    let text = ''
    const walker = label.ownerDocument.createTreeWalker(label, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!control.contains(node)) text += ` ${node.textContent ?? ''}`
    }
    return text
  }

  const accessibleName = (el: Element, role: string): string | undefined => {
    const labelledBy = el.getAttribute('aria-labelledby')
    if (labelledBy) {
      const text = labelledBy
        .split(/\s+/)
        .map((id) => collapse(byId(el, id)?.textContent))
        .filter(Boolean)
        .join(' ')
      if (text) return text
    }
    const ariaLabel = collapse(el.getAttribute('aria-label'))
    if (ariaLabel) return ariaLabel
    const tag = el.localName
    if (tag === 'img' || tag === 'area' || (tag === 'input' && el.getAttribute('type') === 'image')) {
      const alt = el.getAttribute('alt')
      if (alt !== null) return collapse(alt)
    }
    if ((tag === 'input' || tag === 'select' || tag === 'textarea') && 'labels' in el) {
      const labels = (el as HTMLInputElement).labels
      const text = labels ? Array.from(labels).map((label) => collapse(labelText(label, el))).filter(Boolean).join(' ') : ''
      if (text) return text
    }
    // A fieldset is a group named by its legend.
    if (tag === 'fieldset') {
      const legend = Array.from(el.children).find((child) => child.localName === 'legend')
      const text = collapse(legend?.textContent)
      if (text) return text.slice(0, 300)
    }
    if (NAME_FROM_CONTENT.has(tag) || role === 'link' || role === 'button' || role === 'heading') {
      const text = collapse(el.textContent)
      if (text) return text.slice(0, 300)
    }
    const title = collapse(el.getAttribute('title'))
    return title || undefined
  }

  /** A slot in a shadow root shows the nodes assigned to it, if any, instead of its own children. */
  const assignedTo = (el: Element): Node[] | undefined => {
    if (el.localName !== 'slot' || !isShadowRoot(el.getRootNode())) return undefined
    const assigned = (el as HTMLSlotElement).assignedNodes()
    return assigned.length > 0 ? assigned : undefined
  }

  const ownText = (el: Element): string | undefined => {
    let text = ''
    for (const child of assignedTo(el) ?? Array.from(el.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) text += ` ${child.textContent ?? ''}`
    }
    return collapse(text) || undefined
  }

  /**
   * Text that inherits its language from `el`, as ACT defines it (rules ucwvc8, off6ek): text nodes in reading order
   * whose closest ancestor with a non-empty lang is `el`, and the names and descriptions of those elements that come
   * from attributes. The page title, which inherits the root's language, is the snapshot's title.
   */
  const langText = (el: Element): string => textInOrder(el, true)

  /** What a screen reader reads for an element besides its text: names and descriptions set in attributes. */
  const attributeTexts = (el: Element): string[] => {
    if (composedClosest(el, '[aria-hidden="true"]')) return []
    const byIds = (attribute: string): string =>
      (el.getAttribute(attribute) ?? '')
        .split(/\s+/)
        .map((id) => (id ? collapse(byId(el, id)?.textContent) : ''))
        .filter(Boolean)
        .join(' ')
    const texts: string[] = []
    const tag = el.localName
    const labelledBy = byIds('aria-labelledby')
    const label = labelledBy || collapse(el.getAttribute('aria-label'))
    if (label) texts.push(label)
    else if (tag === 'img' || tag === 'area' || (tag === 'input' && el.getAttribute('type') === 'image')) texts.push(collapse(el.getAttribute('alt')))
    texts.push(collapse(el.getAttribute('title')), byIds('aria-describedby'), collapse(el.getAttribute('aria-description')))
    return texts.filter(Boolean)
  }

  /** Text in reading order, without what is hidden from the accessibility tree. */
  const readingText = (el: Element): string => collapse(textInOrder(el, false))

  const textInOrder = (el: Element, stopAtLang: boolean): string => {
    const parts: string[] = stopAtLang ? attributeTexts(el) : []
    const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
    let node: Node | null = walker.nextNode()
    while (node) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const element = node as Element
        if (SKIP.has(element.localName)) {
          node = walker.nextSibling() ?? nextOutside(walker, el)
          continue
        }
        // An empty lang declares nothing: its text still inherits, as ACT reads it.
        if (element !== el && stopAtLang && (element.getAttribute('lang') ?? '').trim() !== '') {
          node = walker.nextSibling() ?? nextOutside(walker, el)
          continue
        }
        if (element !== el && !stopAtLang && (element.getAttribute('aria-hidden') === 'true' || element.hasAttribute('hidden'))) {
          node = walker.nextSibling() ?? nextOutside(walker, el)
          continue
        }
        // Text that is neither rendered nor in the accessibility tree (display: none) is not in scope.
        if (element !== el && typeof element.checkVisibility === 'function' && !element.checkVisibility({ visibilityProperty: true, checkVisibilityCSS: true } as CheckVisibilityOptions)) {
          node = walker.nextSibling() ?? nextOutside(walker, el)
          continue
        }
        if (stopAtLang) {
          // Names and descriptions set in attributes are read in the element's language too.
          parts.push(...attributeTexts(element))
        } else if (element.localName === 'img') {
          // An image is read by its accessible name: alt, aria-label, or the text aria-labelledby points to.
          const name = accessibleName(element, implicitRole(element))
          if (name) parts.push(name)
        }
      } else {
        const text = collapse(node.textContent)
        if (text) parts.push(text)
      }
      node = walker.nextNode()
    }
    return parts.join(' ')
  }

  const nextOutside = (walker: TreeWalker, scope: Element): Node | null => {
    let current: Node | null = walker.currentNode
    while (current && current !== scope) {
      const parent: Node | null = walker.parentNode()
      if (!parent) return null
      const sibling = walker.nextSibling()
      if (sibling) return sibling
      current = parent
    }
    return null
  }

  const statesOf = (el: Element): string[] => {
    const states: string[] = []
    const visible = typeof el.checkVisibility === 'function' ? el.checkVisibility({ visibilityProperty: true, checkVisibilityCSS: true } as CheckVisibilityOptions) : true
    if (!visible) states.push('hidden')
    else {
      const rect = pageRect(el)
      const left = rect.right + window.scrollX
      const top = rect.bottom + window.scrollY
      if (rect.width > 0 && (left <= 0 || top <= 0)) states.push('offscreen')
    }
    if (composedClosest(el, '[aria-hidden="true"]')) states.push('aria-hidden')
    if ((el as HTMLInputElement).disabled === true || el.getAttribute('aria-disabled') === 'true') states.push('disabled')
    if ((el as HTMLInputElement).readOnly === true || el.getAttribute('aria-readonly') === 'true') states.push('readonly')
    if ((el as HTMLInputElement).checked === true || el.getAttribute('aria-checked') === 'true') states.push('checked')
    const expanded = el.getAttribute('aria-expanded')
    if (expanded === 'true') states.push('expanded')
    if (expanded === 'false') states.push('collapsed')
    if (el.getAttribute('aria-selected') === 'true' || (kind(el, 'HTMLOptionElement') && (el as HTMLOptionElement).selected)) states.push('selected')
    if (kind(el, 'HTMLElement') && (el as HTMLElement).tabIndex >= 0) states.push('focusable')
    // An image that failed to load shows the browser's broken-image icon, not the picture its alternative describes.
    if (kind(el, 'HTMLImageElement') && (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth === 0) states.push('broken')
    return states
  }

  /** In page coordinates: the page's viewport plus its scroll, for elements of frames too. */
  const boundsOf = (el: Element): InPageNode['bounds'] => {
    const rect = pageRect(el)
    if (rect.width === 0 && rect.height === 0) return undefined
    const round = (value: number) => Math.round(value * 10) / 10
    return { x: round(rect.x + window.scrollX), y: round(rect.y + window.scrollY), width: round(rect.width), height: round(rect.height) }
  }

  const startTag = (el: Element): string =>
    `<${el.localName}${Array.from(el.attributes)
      .map((attribute) => ` ${attribute.name}="${attribute.value.replaceAll('"', '&quot;')}"`)
      .join('')}>`

  /** Text that keeps its spaces and line breaks as written: `pre`, and any box styled white-space: pre, pre-wrap or break-spaces. */
  const keepsSpaces = (style: CSSStyleDeclaration): boolean => {
    const collapseValue = style.getPropertyValue('white-space-collapse')
    return collapseValue ? collapseValue === 'preserve' || collapseValue === 'break-spaces' : ['pre', 'pre-wrap', 'break-spaces'].includes(style.whiteSpace)
  }
  let measure: CanvasRenderingContext2D | null | undefined
  /** Whether the box's font gives every character the same width, so spaces line text up in columns. */
  const monospace = (style: CSSStyleDeclaration): boolean | undefined => {
    if (measure === undefined) measure = document.createElement('canvas').getContext('2d')
    if (!measure) return undefined
    measure.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
    return Math.abs(measure.measureText('iiiiiiiiii').width - measure.measureText('WWWWWWWWWW').width) < 1
  }
  /**
   * Text laid out with white space (1.3.2, F33 and F34): what the outermost box that keeps spaces shows, with its line
   * breaks and runs of spaces or tabs, when it has both. A field's value (textarea) is not page text.
   */
  const preformatted = (el: Element, style: CSSStyleDeclaration): Record<string, unknown> | undefined => {
    if (el.localName === 'textarea' || !keepsSpaces(style)) return undefined
    const parent = el.parentElement
    if (parent && keepsSpaces(styleOf(parent))) return undefined
    const text = kind(el, 'HTMLElement') ? (el as HTMLElement).innerText : (el.textContent ?? '')
    if (!/\S[^\n]*\n[^\n]*\S/.test(text) || !/[  ]{2,}|\t/.test(text)) return undefined
    const mono = monospace(style)
    return { text: text.slice(0, 8000), ...(mono !== undefined ? { mono } : {}), tabSize: Number.parseInt(style.getPropertyValue('tab-size'), 10) || 8 }
  }
  /** Containers whose children CSS may place out of the markup's order, with their kind of layout. */
  const reorderParents = new Map<Element, 'flex' | 'grid' | 'other'>()
  /**
   * What may show a container's children in another order than the markup's (1.3.2, F1): `order` on a flex or grid
   * item, a reversed flex direction or wrap, explicit grid placement or dense packing, and children positioned absolutely.
   * Only for a container with two children or more that hold something to read; geometry decides later whether the
   * order did change, and the rules whether it matters.
   */
  const reorderOf = (el: Element, style: CSSStyleDeclaration): { by: string[]; layout: 'flex' | 'grid' | 'other' } | undefined => {
    const kids = Array.from(el.shadowRoot ? el.shadowRoot.children : el.children).filter((child) => !SKIP.has(child.localName))
    if (kids.length < 2) return undefined
    const display = style.display
    const flex = display.includes('flex')
    const grid = display.includes('grid')
    const by = new Set<string>()
    if (flex && style.flexDirection.endsWith('reverse')) by.add(style.flexDirection)
    if (flex && style.flexWrap === 'wrap-reverse') by.add('wrap-reverse')
    if (grid && style.gridAutoFlow.includes('dense')) by.add('grid-dense')
    for (const child of kids) {
      const own = styleOf(child)
      if (own.display === 'none') continue
      if ((flex || grid) && own.order !== '0' && own.order !== '') by.add('order')
      if (grid && (own.gridRowStart !== 'auto' || own.gridColumnStart !== 'auto')) by.add('grid-placement')
      if (own.position === 'absolute' || own.position === 'fixed') by.add('absolute')
    }
    if (by.size === 0) return undefined
    const reading = kids.filter((child) => collapse(child.textContent) !== '' || child.querySelector('img[alt]:not([alt=""])') !== null)
    if (reading.length < 2) return undefined
    return { by: [...by], layout: flex ? 'flex' : grid ? 'grid' : 'other' }
  }
  /** The first text an element shows: its font is the box's, as people see it. */
  const firstTextElement = (el: Element): Element => {
    const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (collapse(node.textContent) !== '' && node.parentElement) return node.parentElement
    }
    return el
  }
  /** A child of such a container: its own order, position and placement, and the size and weight of its text. */
  const boxFacts = (el: Element, style: CSSStyleDeclaration, layout: 'flex' | 'grid' | 'other'): Record<string, unknown> => {
    const facts: Record<string, unknown> = {}
    const order = Number.parseInt(style.order, 10)
    if (layout !== 'other' && order) facts.order = order
    if (style.position === 'absolute' || style.position === 'fixed') facts.position = style.position
    if (layout === 'grid' && (style.gridRowStart !== 'auto' || style.gridColumnStart !== 'auto')) facts.placed = `${style.gridRowStart} / ${style.gridColumnStart}`
    const text = styleOf(firstTextElement(el))
    facts.font = [Math.round((Number.parseFloat(text.fontSize) || 0) * 10) / 10, Number.parseInt(text.fontWeight, 10) || 400]
    return facts
  }

  const nativeOf = (el: Element): Record<string, unknown> => {
    const attributes: Record<string, string> = {}
    for (const name of KEEP_ATTRS) {
      const value = el.getAttribute(name)
      // An address is kept whole, so the link can be followed; a cut one would lead somewhere else.
      if (value !== null) attributes[name] = value.slice(0, name === 'href' ? 2000 : 200)
    }
    const native: Record<string, unknown> = { tag: el.localName, attributes }
    const tag = el.localName
    if (el.hasAttribute('lang') || ['img', 'a', 'button', 'input', 'select', 'textarea', 'canvas', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'label'].includes(tag)) {
      // The root keeps only its start tag: its outerHTML is the whole document, injected engine script included.
      native.html = el === el.ownerDocument.documentElement ? startTag(el) : el.outerHTML.slice(0, MAX_HTML)
    }
    if (el.hasAttribute('lang')) native.langText = langText(el)
    // A heading or label cut off on screen (ellipsis, line clamp, a fixed box): the share of it that shows.
    if (/^h[1-6]$/.test(tag) || tag === 'label' || tag === 'legend' || el.getAttribute('role') === 'heading') {
      const shown = shownShare(el)
      if (shown !== undefined) native.shown = shown
    }
    // Only blocks with inline children need it; for the rest, the node's own text is already in order.
    // A short div or span reads as one sentence, such as "Read more about the archive" around a link.
    const sentence = (tag === 'div' || tag === 'span') && (el.textContent ?? '').length <= 300
    if ((READING_BLOCKS.has(tag) || sentence) && el.children.length > 0) {
      const reading = readingText(el)
      native.readingText = reading.slice(0, 1000)
      // Text measurements and the search for an abbreviation's expansion need the whole block; criteria keep the short one.
      if (reading.length > 1000) native.fullText = reading.slice(0, 20000)
    }
    // A picture set in CSS has no alt to read, and banners with words baked in often arrive this way.
    if (tag !== 'html' && tag !== 'body') {
      const background = backgroundUrl(el)
      if (background) native.backgroundImage = background
    }
    // Structure facts the rules read: what a label labels, a role the browser keeps or drops, a table's grid.
    if (tag === 'label') {
      const control = (el as HTMLLabelElement).control
      native.labelControl = control ? cssPath(control) : null
    }
    // An inline svg (not one nested in another): the <title> child that names it (SVG-AAM), and a hash of its
    // drawing, so 1.1.1 can tell an unnamed svg hidden from assistive technology and a repeated icon (ACT e88epe).
    if (tag === 'svg' && !el.parentElement?.closest('svg')) {
      const title = Array.from(el.children).find((child) => child.localName === 'title')
      const titleText = collapse(title?.textContent)
      if (titleText) native.svgTitle = titleText.slice(0, 200)
      let hash = 0x811c9dc5
      const drawing = el.innerHTML.replace(/\s+/g, ' ')
      for (let i = 0; i < drawing.length; i++) hash = Math.imul(hash ^ drawing.charCodeAt(i), 0x01000193)
      native.svgHash = (hash >>> 0).toString(16).padStart(8, '0')
    }
    // Reading order (1.3.2): text laid out with white space (F33, F34), and boxes CSS may show in another order than
    // the markup's (F1). The root keeps neither: its outerHTML and its layout are the whole page's.
    if (tag !== 'html') {
      const style = styleOf(el)
      const laidOut = preformatted(el, style)
      if (laidOut) native.preformatted = laidOut
      const parent = el.parentElement ?? (isShadowRoot(el.getRootNode()) ? (el.getRootNode() as ShadowRoot).host : null)
      const container = parent ? reorderParents.get(parent) : undefined
      if (container) Object.assign(native, boxFacts(el, style, container))
      const reorder = reorderOf(el, style)
      if (reorder) {
        native.reorder = reorder.by
        reorderParents.set(el, reorder.layout)
      }
    }
    const explicit = collapse(el.getAttribute('role')).toLowerCase().split(' ')[0] ?? ''
    // role="presentation" loses to focus and to global ARIA attributes, and the element keeps its own role.
    if (explicit === 'presentation' || explicit === 'none') native.presentational = !roleConflict(el)
    if (tag === 'table' || explicit === 'table' || explicit === 'grid' || explicit === 'treegrid') native.table = tableFacts(el)
    if (tag === 'input' || tag === 'select' || tag === 'textarea') Object.assign(native, invalidFacts(el))
    // How a control, a picture or an icon is drawn, and a turned block of text: what an instruction may call round or tilted (1.3.3).
    const shape = shapeOf(el, explicit)
    if (shape) native.shape = shape
    // The typography of a heading, and of a short block of text that could pass for one (1.3.1, F2).
    const look = lookOf(el, tag, explicit)
    if (look) native.look = look
    return native
  }

  /** The typography of text, as 1.3.1 compares it (snapshot/look.ts): size to half a pixel, weight, first font family, style, case, color. */
  const lookFrom = (style: CSSStyleDeclaration): Record<string, unknown> => {
    const weight = Number.parseInt(style.fontWeight, 10)
    const look: Record<string, unknown> = {
      size: Math.round((Number.parseFloat(style.fontSize) || 0) * 2) / 2,
      weight: Number.isNaN(weight) ? (style.fontWeight === 'bold' ? 700 : 400) : weight,
      family: (style.fontFamily.split(',')[0] ?? '').replace(/["']/g, '').trim().toLowerCase(),
      color: style.color,
    }
    if (style.fontStyle === 'italic' || style.fontStyle.startsWith('oblique')) look.italic = true
    const caps = style.textTransform !== 'none' ? style.textTransform : style.fontVariantCaps && style.fontVariantCaps !== 'normal' ? style.fontVariantCaps : ''
    if (caps) look.caps = caps
    return look
  }
  /** Blocks that may hold a short text styled as a heading. */
  const HEADING_LIKE_TAGS = new Set(['p', 'div', 'span', 'strong', 'b', 'font', 'dt', 'center'])
  /** What such a block may not hold: its text would be a link, a control, a picture or a block of its own. */
  const NOT_IN_HEADING_LIKE = new Set(['a', 'button', 'input', 'select', 'textarea', 'img', 'svg', 'video', 'audio', 'iframe', 'canvas', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'div', 'ul', 'ol', 'dl', 'table', 'li', 'label', 'form', 'section', 'article', 'nav', 'header', 'footer', 'aside', 'blockquote', 'pre'])
  /** What such a block may not sit in: its text then belongs to a heading, a control or a caption. */
  const NOT_AROUND_HEADING_LIKE = 'h1, h2, h3, h4, h5, h6, [role="heading"], a, button, label, legend, summary, caption, th, option, select, textarea, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="option"]'
  const BLOCK_DISPLAY = /^(block|flex|grid|list-item|flow-root|table-caption)$/
  const lookBudget = { headings: 300, blocks: 800 }
  /** The element that holds all of a block's text, down a chain of single children; undefined when the text is split among elements. */
  const textCarrier = (el: Element): Element | undefined => {
    let current = el
    for (let depth = 0; depth < 4; depth++) {
      const own = Array.from(current.childNodes).some((child) => child.nodeType === Node.TEXT_NODE && collapse(child.textContent) !== '')
      const inner = Array.from(current.children).filter((child) => collapse(child.textContent) !== '')
      if (own) return inner.length === 0 ? current : undefined
      if (inner.length !== 1) return undefined
      current = inner[0] as Element
    }
    return undefined
  }
  /**
   * The look of a heading's text, and of a short block of text that could pass for a heading: a block element of up to
   * 120 characters and 15 words, with no link, control, picture or block inside it, not inside a heading, a control or
   * a caption, whose text is all in one element (`<p><strong>Shipping</strong></p>` reads the strong). Budgeted.
   */
  const lookOf = (el: Element, tag: string, role: string): Record<string, unknown> | undefined => {
    if (/^h[1-6]$/.test(tag) || role === 'heading') {
      if (lookBudget.headings <= 0) return undefined
      lookBudget.headings--
      return lookFrom(styleOf(textCarrier(el) ?? el))
    }
    if (!HEADING_LIKE_TAGS.has(tag) || role !== '' || lookBudget.blocks <= 0) return undefined
    const text = collapse(el.textContent)
    if (text.length < 2 || text.length > 120 || text.split(' ').length > 15) return undefined
    const inner = el.getElementsByTagName('*')
    if (inner.length > 3 || Array.from(inner).some((child) => NOT_IN_HEADING_LIKE.has(child.localName))) return undefined
    if (el.parentElement && composedClosest(el.parentElement, NOT_AROUND_HEADING_LIKE)) return undefined
    const style = styleOf(el)
    if (!BLOCK_DISPLAY.test(style.display)) return undefined
    const carrier = textCarrier(el)
    if (!carrier) return undefined
    lookBudget.blocks--
    return lookFrom(carrier === el ? style : styleOf(carrier))
  }
  /** The look most of the page's body text has: the style of its longer runs of text, weighed by their length (1.3.1, F2). */
  const bodyLook = (): Record<string, unknown> | undefined => {
    if (!document.body) return undefined
    const tally = new Map<string, { look: Record<string, unknown>; chars: number }>()
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    let read = 0
    for (let node = walker.nextNode(); node && read < 2000; node = walker.nextNode()) {
      const parent = node.parentElement
      const text = collapse(node.textContent)
      if (!parent || text.length < 20 || SKIP.has(parent.localName)) continue
      if (parent.closest('h1, h2, h3, h4, h5, h6, [role="heading"], a, button, nav, header, footer, label, legend, option')) continue
      if (typeof parent.checkVisibility === 'function' && !parent.checkVisibility({ visibilityProperty: true, checkVisibilityCSS: true } as CheckVisibilityOptions)) continue
      read++
      const look = lookFrom(styleOf(parent))
      const key = JSON.stringify(look)
      const entry = tally.get(key) ?? { look, chars: 0 }
      entry.chars += text.length
      tally.set(key, entry)
    }
    return [...tally.values()].sort((a, b) => b.chars - a.chars)[0]?.look
  }

  /** Elements whose look an instruction may describe ("the round button", "the star icon"); text blocks are read for a rotation only. */
  const SHAPED_TAGS = new Set(['button', 'a', 'img', 'svg', 'canvas', 'input', 'select', 'i'])
  const SHAPED_ROLES = new Set(['button', 'link', 'img', 'tab', 'checkbox', 'radio', 'switch'])
  const ICON_CLASS = /(?:^|[\s_-])(?:icon|icons|ico|fa|fas|far|fab|bi|glyphicon|material-icons|material-symbols-outlined|mdi)(?:$|[\s_-])/i
  const TURNABLE_TAGS = new Set(['div', 'p', 'span', 'section', 'figure', 'li'])
  /** Elements read per page: controls and pictures, and blocks of text, each with its own budget. */
  const shapeBudget = { controls: 800, text: 600 }
  /** The angle of a computed transform and rotate, in whole degrees; undefined when it turns nothing. */
  const rotationOf = (style: CSSStyleDeclaration): number | undefined => {
    let angle = 0
    const matrix = /^matrix(3d)?\(([^)]*)\)$/.exec(style.transform ?? '')
    if (matrix) {
      const m = (matrix[2] ?? '').split(',').map((part) => Number.parseFloat(part))
      angle += (Math.atan2(m[1] ?? 0, m[0] ?? 1) * 180) / Math.PI
    }
    const rotate = /(-?[\d.]+)deg\s*$/.exec(style.rotate ?? '')
    if (rotate) angle += Number.parseFloat(rotate[1] ?? '0')
    const turned = Math.round((((angle % 360) + 540) % 360) - 180)
    return Math.abs(turned) >= 3 ? turned : undefined
  }
  /**
   * For a control, a picture or an icon: whether its corners make it a circle or a pill (each radius at least half its
   * shorter side, on a box that paints something), and its rotation. For a block with text of its own: its rotation.
   * Undefined when it has neither, or past the budget.
   */
  const shapeOf = (el: Element, role: string): { corners?: 'circle' | 'pill'; rotate?: number } | undefined => {
    const tag = el.localName
    const control = SHAPED_TAGS.has(tag) || SHAPED_ROLES.has(role) || ICON_CLASS.test(el.getAttribute('class') ?? '')
    if (!control && !(TURNABLE_TAGS.has(tag) && (ownText(el)?.length ?? 0) >= 3)) return undefined
    const budget = control ? 'controls' : 'text'
    if (shapeBudget[budget] <= 0) return undefined
    shapeBudget[budget]--
    const style = styleOf(el)
    const shape: { corners?: 'circle' | 'pill'; rotate?: number } = {}
    const rotate = rotationOf(style)
    if (rotate !== undefined) shape.rotate = rotate
    if (control) {
      const width = (el as HTMLElement).offsetWidth || el.getBoundingClientRect().width
      const height = (el as HTMLElement).offsetHeight || el.getBoundingClientRect().height
      const side = Math.min(width, height)
      const paints =
        ['img', 'svg', 'canvas', 'input'].includes(tag) ||
        !/rgba\(.*,\s*0\)$|transparent/.test(style.backgroundColor) ||
        style.backgroundImage !== 'none' ||
        Number.parseFloat(style.borderTopWidth) > 0 ||
        style.boxShadow !== 'none'
      const radius = (value: string): number => {
        const first = value.trim().split(/\s+/)[0] ?? '0'
        return first.endsWith('%') ? (Number.parseFloat(first) / 100) * side : Number.parseFloat(first) || 0
      }
      const corners = [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomRightRadius, style.borderBottomLeftRadius].map(radius)
      if (side >= 8 && paints && corners.every((r) => r >= side / 2 - 1)) {
        shape.corners = Math.abs(width - height) <= Math.max(width, height) * 0.15 ? 'circle' : 'pill'
      }
    }
    return shape.corners || shape.rotate !== undefined ? shape : undefined
  }

  /**
   * A field in an error state the page shows: `:user-invalid` (the browser's own validation, after someone typed, as a
   * test that fills a field does), or `aria-invalid` set. For those, the constraints the value breaks, as the browser
   * reads them (tooShort, typeMismatch…), so 3.3.3 knows which rule a message should state.
   */
  const VALIDITY_FLAGS = ['valueMissing', 'typeMismatch', 'patternMismatch', 'tooLong', 'tooShort', 'rangeUnderflow', 'rangeOverflow', 'stepMismatch', 'badInput', 'customError'] as const
  const invalidFacts = (el: Element): Record<string, unknown> => {
    let userInvalid = false
    try {
      userInvalid = el.matches(':user-invalid')
    } catch {
      userInvalid = false
    }
    const aria = (el.getAttribute('aria-invalid') ?? '').trim().toLowerCase()
    if (!userInvalid && (aria === '' || aria === 'false')) return {}
    const validity = (el as HTMLInputElement).validity
    const flags = validity && !validity.valid ? VALIDITY_FLAGS.filter((flag) => validity[flag]) : []
    return { ...(userInvalid ? { userInvalid: true } : {}), ...(flags.length > 0 ? { validity: flags } : {}) }
  }

  /**
   * How much of an element's text shows when its box cuts it off: the visible width (or height, for text clamped to
   * some lines) over the width or height its content needs, rounded to hundredths. Undefined when nothing is cut.
   */
  const shownShare = (el: Element): number | undefined => {
    if (!kind(el, 'HTMLElement') || el.clientWidth === 0 || el.clientHeight === 0) return undefined
    const style = styleOf(el)
    const clamped = style.getPropertyValue('-webkit-line-clamp')
    const cutX = el.scrollWidth > el.clientWidth + 1 && style.overflowX !== 'visible'
    const cutY = el.scrollHeight > el.clientHeight + 1 && (style.overflowY !== 'visible' || (clamped !== '' && clamped !== 'none'))
    if (!cutX && !cutY) return undefined
    const share = (cutX ? el.clientWidth / el.scrollWidth : 1) * (cutY ? el.clientHeight / el.scrollHeight : 1)
    return Math.round(share * 100) / 100
  }

  const GLOBAL_ARIA = ['aria-atomic', 'aria-busy', 'aria-controls', 'aria-current', 'aria-describedby', 'aria-details', 'aria-disabled', 'aria-dropeffect', 'aria-errormessage', 'aria-flowto', 'aria-grabbed', 'aria-haspopup', 'aria-invalid', 'aria-keyshortcuts', 'aria-label', 'aria-labelledby', 'aria-live', 'aria-owns', 'aria-relevant', 'aria-roledescription']
  const roleConflict = (el: Element): boolean =>
    el.hasAttribute('tabindex') || (kind(el, 'HTMLElement') && (el as HTMLElement).tabIndex >= 0 && ['a', 'button', 'input', 'select', 'textarea'].includes(el.localName)) || GLOBAL_ARIA.some((name) => el.hasAttribute(name))

  const MAX_CELLS = 1000
  /** All tables of a page together: a page of layout tables must not make the snapshot huge. */
  let cellBudget = 4000
  /**
   * The table's cells on the HTML table grid, with their spans, scope, headers and ids, so a rule can run
   * the HTML algorithm that assigns header cells to cells. An ARIA table (role table or grid) is read from
   * its rows and cells, one slot per cell, aria-colspan included.
   */
  const tableFacts = (table: Element) => {
    interface Cell {
      ref: string
      header: boolean
      x: number
      y: number
      w: number
      h: number
      scope: string
      headers: string[]
      id: string
      role: string
      empty: boolean
      hidden: boolean
    }
    const cells: Cell[] = []
    const fact = (cell: Element, header: boolean, x: number, y: number, w: number, h: number, scope: string): Cell => ({
      ref: cssPath(cell),
      header,
      x,
      y,
      w,
      h,
      scope,
      headers: collapse(cell.getAttribute('headers')).split(' ').filter(Boolean),
      id: cell.id,
      role: collapse(cell.getAttribute('role')).toLowerCase().split(' ')[0] ?? '',
      empty: collapse(cell.textContent) === '' && !cell.querySelector('img[alt]:not([alt=""]), [aria-label], svg[role="img"], input, select, textarea, button'),
      hidden:
        (typeof cell.checkVisibility === 'function' && !cell.checkVisibility({ visibilityProperty: true, checkVisibilityCSS: true } as CheckVisibilityOptions)) ||
        composedClosest(cell, '[aria-hidden="true"]') !== null,
    })
    let truncatedCells = false
    if (kind(table, 'HTMLTableElement')) {
      const taken = new Set<string>()
      const rows = Array.from((table as HTMLTableElement).rows)
      rows.forEach((row, y) => {
        let x = 0
        for (const cell of Array.from(row.cells)) {
          if (cells.length >= MAX_CELLS || cellBudget <= 0) {
            truncatedCells = true
            return
          }
          while (taken.has(`${x},${y}`)) x++
          const w = Math.max(1, Math.min(cell.colSpan || 1, 1000))
          // A rowspan never reaches past the last row; 0 means "to the end".
          const h = Math.max(1, Math.min(cell.rowSpan === 0 ? rows.length - y : cell.rowSpan || 1, rows.length - y))
          for (let dx = 0; dx < w; dx++) for (let dy = 0; dy < h; dy++) taken.add(`${x + dx},${y + dy}`)
          cells.push(fact(cell, cell.localName === 'th', x, y, w, h, collapse(cell.getAttribute('scope')).toLowerCase()))
          cellBudget--
          x += w
        }
      })
    } else {
      // Rows of this table, not of a table nested in it.
      const rows = Array.from(table.querySelectorAll('[role="row"]')).filter(
        (row) => row.parentElement?.closest('[role="table"], [role="grid"], [role="treegrid"], table') === table,
      )
      rows.forEach((row, y) => {
        let x = 0
        const own = Array.from(row.querySelectorAll('[role="cell"], [role="gridcell"], [role="columnheader"], [role="rowheader"]')).filter((cell) => cell.closest('[role="row"]') === row)
        for (const cell of own) {
          const role = collapse(cell.getAttribute('role')).toLowerCase()
          const w = Math.max(1, Number.parseInt(cell.getAttribute('aria-colspan') ?? '1', 10) || 1)
          if (cells.length >= MAX_CELLS || cellBudget <= 0) {
            truncatedCells = true
            return
          }
          cells.push(fact(cell, role === 'columnheader' || role === 'rowheader', x, y, w, 1, role === 'columnheader' ? 'col' : role === 'rowheader' ? 'row' : ''))
          cellBudget--
          x += w
        }
      })
    }
    return {
      kind: kind(table, 'HTMLTableElement') ? 'html' : 'aria',
      busy: table.getAttribute('aria-busy') === 'true',
      caption: kind(table, 'HTMLTableElement') && (table as HTMLTableElement).caption ? collapse((table as HTMLTableElement).caption?.textContent).slice(0, 200) : '',
      summary: collapse(table.getAttribute('summary')).slice(0, 200),
      cells,
      truncated: truncatedCells,
    }
  }

  /** The first url() of the element's computed background-image; gradients are not pictures. */
  const backgroundUrl = (el: Element): string | undefined => {
    const value = styleOf(el).backgroundImage
    if (!value || !value.includes('url(')) return undefined
    const url = /url\(\s*(["']?)(.*?)\1\s*\)/.exec(value)?.[2]
    if (!url) return undefined
    return url.startsWith('data:') ? 'data:…' : url.slice(0, 200)
  }

  const build = (el: Element): InPageNode | undefined => {
    if (SKIP.has(el.localName)) return undefined
    // The page's own document has the budget it always had; shadow roots and frames have one of their own, so a
    // page of web components (an icon set, a code editor) cannot crowd the page's own content out.
    if (el.getRootNode() === document) {
      if (count >= options.maxNodes) {
        truncated = true
        return undefined
      }
      count++
    } else {
      if (beyond >= options.maxNodes) {
        beyondTruncated = true
        return undefined
      }
      beyond++
    }
    const ref = cssPath(el)
    refs.set(el, ref)
    const role = collapse(el.getAttribute('role')).split(' ')[0] || implicitRole(el)
    const node: InPageNode = {
      ref,
      role,
      name: accessibleName(el, role),
      // A shadow host's own text shows only through the slots of its shadow root, where the tree holds it.
      text: el.shadowRoot ? undefined : ownText(el),
      lang: el.getAttribute('lang') ?? undefined,
      states: statesOf(el),
      bounds: boundsOf(el),
      native: nativeOf(el),
      children: [],
    }
    for (const child of childrenOf(el, node)) {
      const built = build(child)
      if (built) node.children.push(built)
    }
    return node
  }

  /**
   * What is rendered inside an element, as people get it: the open shadow root instead of the element's own children,
   * the nodes assigned to a slot instead of its fallback, and the document of a frame this page may read. Frames are
   * recorded either way, with why their content is missing when it is.
   */
  const childrenOf = (el: Element, node: InPageNode): Element[] => {
    if (el.shadowRoot) {
      shadowRoots++
      return Array.from(el.shadowRoot.children)
    }
    const assigned = assignedTo(el)
    if (assigned) return assigned.filter((child): child is Element => child.nodeType === 1)
    if (el.localName === 'iframe' || el.localName === 'frame') {
      let doc: Document | null = null
      try {
        doc = (el as HTMLIFrameElement).contentDocument
      } catch {
        doc = null
      }
      // A frame that has an address but still shows the blank document it starts with has not loaded (loading=lazy below the fold).
      const src = (el.getAttribute('src') ?? '').trim()
      const loading = doc?.URL === 'about:blank' && src !== '' && src !== 'about:blank' && !/^javascript:/i.test(src)
      const address = ((doc && !loading ? doc.URL : (el as HTMLIFrameElement).src) ?? '').slice(0, 300)
      const reason = node.states.includes('hidden') ? 'hidden' : !doc ? 'cross-origin' : loading ? 'not-loaded' : !doc.documentElement ? 'empty' : undefined
      frames.push({ ref: node.ref, url: address || undefined, collected: reason === undefined, reason })
      return reason === undefined && doc?.documentElement ? [doc.documentElement] : []
    }
    return Array.from(el.children)
  }

  const root = build(document.documentElement)
  if (!root) throw new Error('The page has no document element')
  // The head is left out of the tree; the viewport meta element is a fact rules read (ACT b4f0c3). Names are case-insensitive.
  const metaViewport = Array.from(document.querySelectorAll('meta[name][content]'))
    .filter((meta) => collapse(meta.getAttribute('name')).toLowerCase() === 'viewport')
    .map((meta) => ({ ref: cssPath(meta), content: (meta.getAttribute('content') ?? '').slice(0, 500) }))
  if (metaViewport.length > 0) root.native.metaViewport = metaViewport
  const body = bodyLook()
  if (body) root.native.bodyLook = body
  // Left on the page so the collector can map nodes it learns about over CDP (Chromium's form issues) and the
  // engine's results to refs, and find the element of a ref again (image captures, scoping).
  const page = window as unknown as { __rampaRefs?: Map<Element, string>; __rampaNodes?: Map<string, Element>; __rampaRefOf?: (el: Element) => string }
  page.__rampaRefs = refs
  page.__rampaNodes = new Map(Array.from(refs, ([el, ref]) => [ref, el]))
  page.__rampaRefOf = (el: Element) => refs.get(el) ?? cssPath(el)

  return {
    title: document.title,
    lang: document.documentElement.getAttribute('lang') ?? undefined,
    viewport: { width: window.innerWidth, height: window.innerHeight, scale: window.devicePixelRatio },
    root,
    truncated,
    frames,
    shadowRoots,
    beyondTruncated,
  }
}

/**
 * What the document is: HTML (XHTML too), a standalone SVG document, or other XML. Chromium shows an XML document that
 * has no style sheet as its source tree, in an XHTML page of its own that holds the document hidden: that page is the
 * browser's, not the document, so it counts as XML.
 */
export function documentKindInPage(): { kind: 'html' | 'svg' | 'xml'; contentType: string } {
  const contentType = document.contentType
  const root = document.documentElement
  if (!root) return { kind: 'html', contentType }
  if (contentType !== 'text/html' && document.getElementById('webkit-xml-viewer-source-xml')) return { kind: 'xml', contentType }
  if (root.namespaceURI === 'http://www.w3.org/1999/xhtml') return { kind: 'html', contentType }
  if (root.namespaceURI === 'http://www.w3.org/2000/svg' && root.localName === 'svg') return { kind: 'svg', contentType }
  return { kind: 'xml', contentType }
}

/** What axe-core's partial run in one frame hands back: its results, kept in the page for the top frame, and the frames it holds. */
export interface InPagePartial {
  partial?: unknown
  frames: Array<{ frameSelector: unknown; frameContext: unknown }>
}

/**
 * Runs axe-core in this frame only (`axe.runPartial`), after listing the frames it holds with the context each
 * must be checked in (`axe.utils.getFrameContexts`). The collector visits those frames through the browser
 * library, which reaches frames of other origins too, and finishes the run in the top frame (`axeFinishInPage`).
 * With `keep`, the result stays on the page for the finish instead of crossing to the collector and back.
 */
export async function axePartialInPage(arg: { context: unknown; options: unknown; keep: boolean }): Promise<InPagePartial> {
  interface AxePartialApi {
    runPartial(context: unknown, options: unknown): Promise<unknown>
    utils: { getFrameContexts(context: unknown, options: unknown): Array<{ frameSelector: unknown; frameContext: unknown }> }
  }
  const page = window as unknown as { axe: AxePartialApi; __rampaAxePartial?: unknown }
  const context = arg.context ?? document
  const frames = page.axe.utils.getFrameContexts(context, arg.options)
  const partial = await page.axe.runPartial(context, arg.options)
  if (!arg.keep) return { partial, frames }
  page.__rampaAxePartial = partial
  return { frames }
}

/**
 * Runs in the frame that holds a frame axe-core named: that frame element's ref, as the collector in the top
 * frame gave it (snapshot/refs.ts). Null when the top frame is not this page's to read (another origin).
 */
export function frameRefInPage(selector: unknown): string | null {
  const page = window as unknown as { axe?: { utils: { shadowSelect(selector: unknown): Element | null } } }
  let el: Element | null = null
  try {
    el = page.axe?.utils.shadowSelect(selector) ?? null
  } catch {
    el = null
  }
  if (!el) return null
  try {
    const top = window.top as unknown as { __rampaRefOf?: (el: Element) => string } | null
    return typeof top?.__rampaRefOf === 'function' ? top.__rampaRefOf(el) : null
  } catch {
    return null
  }
}

/**
 * Runs in the top frame: finishes axe-core's run with the partial results of every frame, in the order
 * `axePartialInPage` listed them (null for a frame that could not be checked), and maps each result to the
 * collector's ref of its element. axe-core gives a frame's element as the frame's selector, then the
 * element's; a shadow root's as an array of selectors. An element in a frame of another origin cannot be
 * found from here: its ref is the frame's, then axe-core's own selectors in it.
 */
export async function axeFinishInPage(arg: { partials: unknown[]; options: unknown; locale: unknown }): Promise<InPageAxe> {
  const MAX_HTML = 600
  const MAX_PASS_NODES = 200
  interface AxeNodeResult {
    target: unknown
    html: string
    failureSummary?: string
    impact?: string | null
    any?: Array<{ data?: unknown }>
    all?: Array<{ data?: unknown }>
    none?: Array<{ data?: unknown }>
  }
  interface AxeRuleResult {
    id: string
    tags: string[]
    help: string
    helpUrl: string
    impact?: string | null
    nodes: AxeNodeResult[]
  }
  interface AxeApi {
    version: string
    configure(spec: { locale: unknown }): void
    finishRun(partials: unknown[], options: unknown): Promise<Record<'violations' | 'incomplete' | 'passes' | 'inapplicable', AxeRuleResult[]>>
  }
  const page = window as unknown as { axe: AxeApi; __rampaAxePartial?: unknown; __rampaRefOf?: (el: Element) => string }
  const axe = page.axe
  if (arg.locale) axe.configure({ locale: arg.locale })
  const top = page.__rampaAxePartial
  page.__rampaAxePartial = undefined
  const raw = await axe.finishRun([top, ...arg.partials], arg.options)

  const refOf = (el: Element): string | undefined => page.__rampaRefOf?.(el)
  const partText = (part: unknown): string => (Array.isArray(part) ? part.map(String).join(' >>> ') : String(part))
  /** axe-core's selector for one document: a string, or an array that crosses shadow roots. */
  const selectIn = (scope: Document, part: unknown): Element | null => {
    const chain = Array.isArray(part) ? part : [part]
    let root: Document | ShadowRoot | null = scope
    let el: Element | null = null
    for (const selector of chain) {
      if (!root || typeof selector !== 'string') return null
      el = root.querySelector(selector)
      if (!el) return null
      root = el.shadowRoot
    }
    return el
  }
  const located = new Map<string, { el?: Element | undefined; ref?: string | undefined }>()
  const locate = (target: unknown): { el?: Element | undefined; ref?: string | undefined } => {
    if (!Array.isArray(target) || target.length === 0) return {}
    const key = JSON.stringify(target)
    const known = located.get(key)
    if (known) return known
    let found: { el?: Element | undefined; ref?: string | undefined } = {}
    try {
      let scope: Document = document
      let el: Element | null = null
      for (let i = 0; i < target.length; i++) {
        if (i > 0 && el) {
          let doc: Document | null = null
          try {
            doc = (el as HTMLIFrameElement).contentDocument
          } catch {
            doc = null
          }
          if (!doc) {
            const frameRef = refOf(el)
            found = frameRef ? { ref: `${frameRef} |> ${target.slice(i).map(partText).join(' |> ')}` } : {}
            el = null
            break
          }
          scope = doc
        }
        el = selectIn(scope, target[i])
        if (!el) break
      }
      if (el) found = { el, ref: refOf(el) }
    } catch {
      found = {}
    }
    located.set(key, found)
    return found
  }

  // WCAG 2.5.8 exceptions that axe-core's target-size does not know (docs/plans/wcag-coverage.md, A5). The facts are
  // recorded on the node, and the engine moves exempt targets out of the failures, so a recording replays the same.
  let clean: Document | undefined
  let frame: HTMLIFrameElement | undefined
  const cleanDocument = (): Document | undefined => {
    if (clean) return clean
    try {
      frame = document.createElement('iframe')
      frame.setAttribute('aria-hidden', 'true')
      frame.tabIndex = -1
      frame.style.cssText = 'position:absolute;left:-10000px;top:0;width:800px;height:400px;border:0;visibility:hidden'
      document.body.appendChild(frame)
      const doc = frame.contentDocument
      if (!doc) return undefined
      try {
        // Standards mode, as the page most likely is; a page that enforces Trusted Types refuses it.
        doc.open()
        doc.write('<!doctype html><html><head></head><body></body></html>')
        doc.close()
      } catch {
        // The empty document the frame starts with will do.
      }
      if (!doc.body) return undefined
      clean = doc
      return doc
    } catch {
      return undefined
    }
  }
  // An element of a frame is styled by its own window.
  const styleOf = (el: Element): CSSStyleDeclaration => (el.ownerDocument.defaultView ?? window).getComputedStyle(el)
  const NATIVE_CONTROLS = new Set(['input', 'select', 'button', 'textarea'])
  const BOX = ['padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width', 'box-sizing']
  /**
   * A user agent control: a native control the author did not restyle. Its padding, borders, font size and
   * appearance equal those of a copy in an empty frame, where no author style applies, and layout did not
   * make it smaller than that copy (a flex row may stretch a checkbox, which only helps).
   */
  const userAgentControl = (el: Element): boolean => {
    if (!NATIVE_CONTROLS.has(el.localName) || (el.localName === 'input' && (el.getAttribute('type') ?? '').toLowerCase() === 'hidden')) return false
    const doc = cleanDocument()
    if (!doc) return false
    const copy = doc.importNode(el, true) as HTMLElement
    copy.removeAttribute('id')
    doc.body.appendChild(copy)
    try {
      const own = styleOf(el)
      const bare = doc.defaultView?.getComputedStyle(copy)
      if (!bare) return false
      if (own.appearance === 'none' || own.appearance !== bare.appearance) return false
      const type = (el.getAttribute('type') ?? '').toLowerCase()
      const props = type === 'checkbox' || type === 'radio' ? BOX : [...BOX, 'font-size']
      if (props.some((prop) => own.getPropertyValue(prop) !== bare.getPropertyValue(prop))) return false
      const mine = el.getBoundingClientRect()
      const theirs = copy.getBoundingClientRect()
      return mine.width >= theirs.width - 0.5 && mine.height >= theirs.height - 0.5
    } finally {
      copy.remove()
    }
  }
  /** An equivalent target: another visible link to the same address, in the same document, whose box holds a 24 by 24 square. */
  const equivalentTarget = (el: Element): boolean => {
    const link = el.closest('a[href], area[href]') as HTMLAnchorElement | HTMLAreaElement | null
    if (!link) return false
    for (const other of Array.from(el.ownerDocument.querySelectorAll<HTMLAnchorElement | HTMLAreaElement>('a[href], area[href]'))) {
      if (other === link || other.href !== link.href || other.contains(link) || link.contains(other)) continue
      const box = other.getBoundingClientRect()
      const style = styleOf(other)
      if (box.width >= 24 && box.height >= 24 && style.visibility !== 'hidden' && style.display !== 'none') return true
    }
    return false
  }
  const exemptOf = (el: Element | undefined): InPageAxeNode['exempt'] => {
    if (!el) return undefined
    try {
      if (userAgentControl(el)) return 'user-agent-control'
      if (equivalentTarget(el)) return 'equivalent-target'
    } catch {
      return undefined
    }
    return undefined
  }

  const messageKeyOf = (node: AxeNodeResult): string | undefined => {
    for (const check of [...(node.any ?? []), ...(node.all ?? []), ...(node.none ?? [])]) {
      const key = (check.data as { messageKey?: unknown } | null | undefined)?.messageKey
      if (typeof key === 'string') return key
    }
    return undefined
  }

  const mapRules = (rules: AxeRuleResult[], limit: number, exceptions = false): InPageAxeRule[] =>
    rules.map((rule) => ({
      id: rule.id,
      tags: rule.tags,
      help: rule.help,
      helpUrl: rule.helpUrl,
      impact: rule.impact ?? null,
      nodes: rule.nodes.slice(0, limit).map((node) => {
        const where = locate(node.target)
        const exempt = exceptions && rule.id === 'target-size' ? exemptOf(where.el) : undefined
        // Why axe-core left a contrast undecided (bgImage, bgGradient...): the pixel measurement reads it.
        const reasonKey = exceptions && rule.id === 'color-contrast' ? messageKeyOf(node) : undefined
        return {
          ref: where.ref,
          target: JSON.stringify(node.target),
          html: String(node.html).slice(0, MAX_HTML),
          message: node.failureSummary,
          impact: node.impact ?? null,
          ...(exempt ? { exempt } : {}),
          ...(reasonKey ? { reasonKey } : {}),
        }
      }),
    }))
  try {
    return {
      version: axe.version,
      violations: mapRules(raw.violations, Number.POSITIVE_INFINITY, true),
      incomplete: mapRules(raw.incomplete, Number.POSITIVE_INFINITY, true),
      passes: mapRules(raw.passes, MAX_PASS_NODES),
      inapplicable: mapRules(raw.inapplicable, 0),
    }
  } finally {
    frame?.remove()
  }
}
