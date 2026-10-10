/**
 * Runs inside the browser page through `page.evaluate`. Playwright serializes
 * the function with toString(), so it must not reference anything outside its
 * own body: no imports, no module-level helpers.
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

export interface InPageResult {
  title: string
  lang: string | undefined
  viewport: { width: number; height: number; scale: number }
  root: InPageNode
  truncated: boolean
  axe?: {
    version: string
    violations: InPageAxeRule[]
    incomplete: InPageAxeRule[]
    passes: InPageAxeRule[]
    inapplicable: InPageAxeRule[]
  }
}

export interface InPageOptions {
  runAxe: boolean
  axeTags: string[]
  /** Rules to run besides the tags, such as experimental ones the tags leave out. */
  axeRules?: string[] | undefined
  axeLocale: unknown
  maxNodes: number
  /** axe-core's own context, to check part of the page: selectors to include and exclude. The whole document when absent. */
  axeContext?: { include?: string[] | undefined; exclude?: string[] | undefined } | undefined
}

export async function collectInPage(options: InPageOptions): Promise<InPageResult> {
  const MAX_HTML = 600
  const READING_BLOCKS = new Set(['p', 'li', 'td', 'th', 'dt', 'dd', 'blockquote', 'figcaption', 'caption', 'label', 'legend', 'summary', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'])
  const MAX_PASS_NODES = 200
  const SKIP = new Set(['script', 'style', 'noscript', 'template', 'head', 'meta', 'link', 'title', 'base'])
  const KEEP_ATTRS = ['id', 'class', 'lang', 'href', 'src', 'alt', 'title', 'type', 'role', 'name', 'for', 'aria-label', 'aria-labelledby', 'aria-hidden', 'aria-level', 'aria-describedby', 'placeholder', 'autocomplete', 'pattern',
    // What a field accepts, and whether its form validates it: the cognitive profile reads them (coga/input-formats).
    'maxlength', 'minlength', 'min', 'max', 'step', 'inputmode', 'required', 'aria-required', 'novalidate', 'formnovalidate']
  const NAME_FROM_CONTENT = new Set(['a', 'button', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'summary', 'option', 'th', 'td', 'li', 'label', 'legend', 'caption', 'figcaption'])
  const refs = new Map<Element, string>()
  let count = 0
  let truncated = false

  const escapeId = (value: string): string => CSS.escape(value)
  const hasUniqueId = (el: Element): boolean => el.id !== '' && document.querySelectorAll(`#${escapeId(el.id)}`).length === 1
  const cssPath = (el: Element): string => {
    if (hasUniqueId(el)) return `#${escapeId(el.id)}`
    const parts: string[] = []
    let current: Element | null = el
    while (current) {
      if (current !== el && hasUniqueId(current)) {
        parts.unshift(`#${escapeId(current.id)}`)
        break
      }
      const parent: Element | null = current.parentElement
      const tag = current.localName
      if (!parent) {
        parts.unshift(tag)
        break
      }
      const sameTag = Array.from(parent.children).filter((child) => child.localName === tag)
      parts.unshift(sameTag.length > 1 ? `${tag}:nth-of-type(${sameTag.indexOf(current) + 1})` : tag)
      current = parent
    }
    return parts.join(' > ')
  }

  const collapse = (value: string | null | undefined): string => (value ?? '').replace(/\s+/g, ' ').trim()

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
    const walker = document.createTreeWalker(label, NodeFilter.SHOW_TEXT)
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
        .map((id) => collapse(document.getElementById(id)?.textContent))
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

  const ownText = (el: Element): string | undefined => {
    let text = ''
    for (const child of Array.from(el.childNodes)) {
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
    if (el.closest('[aria-hidden="true"]')) return []
    const byIds = (attribute: string): string =>
      (el.getAttribute(attribute) ?? '')
        .split(/\s+/)
        .map((id) => (id ? collapse(document.getElementById(id)?.textContent) : ''))
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
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
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
      const rect = el.getBoundingClientRect()
      const left = rect.right + window.scrollX
      const top = rect.bottom + window.scrollY
      if (rect.width > 0 && (left <= 0 || top <= 0)) states.push('offscreen')
    }
    if (el.closest('[aria-hidden="true"]')) states.push('aria-hidden')
    if ((el as HTMLInputElement).disabled === true || el.getAttribute('aria-disabled') === 'true') states.push('disabled')
    if ((el as HTMLInputElement).readOnly === true || el.getAttribute('aria-readonly') === 'true') states.push('readonly')
    if ((el as HTMLInputElement).checked === true || el.getAttribute('aria-checked') === 'true') states.push('checked')
    const expanded = el.getAttribute('aria-expanded')
    if (expanded === 'true') states.push('expanded')
    if (expanded === 'false') states.push('collapsed')
    if (el.getAttribute('aria-selected') === 'true' || (el instanceof HTMLOptionElement && el.selected)) states.push('selected')
    if (el instanceof HTMLElement && el.tabIndex >= 0) states.push('focusable')
    // An image that failed to load shows the browser's broken-image icon, not the picture its alternative describes.
    if (el instanceof HTMLImageElement && el.complete && el.naturalWidth === 0) states.push('broken')
    return states
  }

  const boundsOf = (el: Element): InPageNode['bounds'] => {
    const rect = el.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) return undefined
    const round = (value: number) => Math.round(value * 10) / 10
    return { x: round(rect.x + window.scrollX), y: round(rect.y + window.scrollY), width: round(rect.width), height: round(rect.height) }
  }

  const startTag = (el: Element): string =>
    `<${el.localName}${Array.from(el.attributes)
      .map((attribute) => ` ${attribute.name}="${attribute.value.replaceAll('"', '&quot;')}"`)
      .join('')}>`

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
      native.html = el === document.documentElement ? startTag(el) : el.outerHTML.slice(0, MAX_HTML)
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
    const explicit = collapse(el.getAttribute('role')).toLowerCase().split(' ')[0] ?? ''
    // role="presentation" loses to focus and to global ARIA attributes, and the element keeps its own role.
    if (explicit === 'presentation' || explicit === 'none') native.presentational = !roleConflict(el)
    if (tag === 'table' || explicit === 'table' || explicit === 'grid' || explicit === 'treegrid') native.table = tableFacts(el)
    return native
  }

  /**
   * How much of an element's text shows when its box cuts it off: the visible width (or height, for text clamped to
   * some lines) over the width or height its content needs, rounded to hundredths. Undefined when nothing is cut.
   */
  const shownShare = (el: Element): number | undefined => {
    if (!(el instanceof HTMLElement) || el.clientWidth === 0 || el.clientHeight === 0) return undefined
    const style = getComputedStyle(el)
    const clamped = style.getPropertyValue('-webkit-line-clamp')
    const cutX = el.scrollWidth > el.clientWidth + 1 && style.overflowX !== 'visible'
    const cutY = el.scrollHeight > el.clientHeight + 1 && (style.overflowY !== 'visible' || (clamped !== '' && clamped !== 'none'))
    if (!cutX && !cutY) return undefined
    const share = (cutX ? el.clientWidth / el.scrollWidth : 1) * (cutY ? el.clientHeight / el.scrollHeight : 1)
    return Math.round(share * 100) / 100
  }

  const GLOBAL_ARIA = ['aria-atomic', 'aria-busy', 'aria-controls', 'aria-current', 'aria-describedby', 'aria-details', 'aria-disabled', 'aria-dropeffect', 'aria-errormessage', 'aria-flowto', 'aria-grabbed', 'aria-haspopup', 'aria-invalid', 'aria-keyshortcuts', 'aria-label', 'aria-labelledby', 'aria-live', 'aria-owns', 'aria-relevant', 'aria-roledescription']
  const roleConflict = (el: Element): boolean =>
    el.hasAttribute('tabindex') || (el instanceof HTMLElement && el.tabIndex >= 0 && ['a', 'button', 'input', 'select', 'textarea'].includes(el.localName)) || GLOBAL_ARIA.some((name) => el.hasAttribute(name))

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
        cell.closest('[aria-hidden="true"]') !== null,
    })
    let truncatedCells = false
    if (table instanceof HTMLTableElement) {
      const taken = new Set<string>()
      const rows = Array.from(table.rows)
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
      kind: table instanceof HTMLTableElement ? 'html' : 'aria',
      busy: table.getAttribute('aria-busy') === 'true',
      caption: table instanceof HTMLTableElement && table.caption ? collapse(table.caption.textContent).slice(0, 200) : '',
      summary: collapse(table.getAttribute('summary')).slice(0, 200),
      cells,
      truncated: truncatedCells,
    }
  }

  /** The first url() of the element's computed background-image; gradients are not pictures. */
  const backgroundUrl = (el: Element): string | undefined => {
    const value = getComputedStyle(el).backgroundImage
    if (!value || !value.includes('url(')) return undefined
    const url = /url\(\s*(["']?)(.*?)\1\s*\)/.exec(value)?.[2]
    if (!url) return undefined
    return url.startsWith('data:') ? 'data:…' : url.slice(0, 200)
  }

  const build = (el: Element): InPageNode | undefined => {
    if (SKIP.has(el.localName)) return undefined
    if (count >= options.maxNodes) {
      truncated = true
      return undefined
    }
    count++
    const ref = cssPath(el)
    refs.set(el, ref)
    const role = collapse(el.getAttribute('role')).split(' ')[0] || implicitRole(el)
    const node: InPageNode = {
      ref,
      role,
      name: accessibleName(el, role),
      text: ownText(el),
      lang: el.getAttribute('lang') ?? undefined,
      states: statesOf(el),
      bounds: boundsOf(el),
      native: nativeOf(el),
      children: [],
    }
    for (const child of Array.from(el.children)) {
      const built = build(child)
      if (built) node.children.push(built)
    }
    return node
  }

  const root = build(document.documentElement)
  if (!root) throw new Error('The page has no document element')
  // The head is left out of the tree; the viewport meta element is a fact rules read (ACT b4f0c3). Names are case-insensitive.
  const metaViewport = Array.from(document.querySelectorAll('meta[name][content]'))
    .filter((meta) => collapse(meta.getAttribute('name')).toLowerCase() === 'viewport')
    .map((meta) => ({ ref: cssPath(meta), content: (meta.getAttribute('content') ?? '').slice(0, 500) }))
  if (metaViewport.length > 0) root.native.metaViewport = metaViewport
  // Left on the page so the collector can map nodes it learns about over CDP (Chromium's form issues) to refs.
  ;(window as unknown as { __rampaRefs?: Map<Element, string> }).__rampaRefs = refs

  const result: InPageResult = {
    title: document.title,
    lang: document.documentElement.getAttribute('lang') ?? undefined,
    viewport: { width: window.innerWidth, height: window.innerHeight, scale: window.devicePixelRatio },
    root,
    truncated,
  }

  if (options.runAxe) {
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
      run(context: unknown, options: unknown): Promise<Record<'violations' | 'incomplete' | 'passes' | 'inapplicable', AxeRuleResult[]>>
    }
    const axe = (window as unknown as { axe: AxeApi }).axe
    if (options.axeLocale) axe.configure({ locale: options.axeLocale })
    const extra = options.axeRules && options.axeRules.length > 0 ? { rules: Object.fromEntries(options.axeRules.map((id) => [id, { enabled: true }])) } : {}
    const raw = await axe.run(options.axeContext ?? document, { runOnly: { type: 'tag', values: options.axeTags }, ...extra })
    const refOfTarget = (target: unknown): string | undefined => {
      if (!Array.isArray(target) || target.length !== 1 || typeof target[0] !== 'string') return undefined
      try {
        const el = document.querySelector(target[0])
        return el ? (refs.get(el) ?? cssPath(el)) : undefined
      } catch {
        return undefined
      }
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
        const page = getComputedStyle(el)
        const bare = doc.defaultView?.getComputedStyle(copy)
        if (!bare) return false
        if (page.appearance === 'none' || page.appearance !== bare.appearance) return false
        const type = (el.getAttribute('type') ?? '').toLowerCase()
        const props = type === 'checkbox' || type === 'radio' ? BOX : [...BOX, 'font-size']
        if (props.some((prop) => page.getPropertyValue(prop) !== bare.getPropertyValue(prop))) return false
        const mine = el.getBoundingClientRect()
        const theirs = copy.getBoundingClientRect()
        return mine.width >= theirs.width - 0.5 && mine.height >= theirs.height - 0.5
      } finally {
        copy.remove()
      }
    }
    /** An equivalent target: another visible link to the same address whose box holds a 24 by 24 square. */
    const equivalentTarget = (el: Element): boolean => {
      const link = el.closest('a[href], area[href]') as HTMLAnchorElement | HTMLAreaElement | null
      if (!link) return false
      for (const other of Array.from(document.querySelectorAll<HTMLAnchorElement | HTMLAreaElement>('a[href], area[href]'))) {
        if (other === link || other.href !== link.href || other.contains(link) || link.contains(other)) continue
        const box = other.getBoundingClientRect()
        const style = getComputedStyle(other)
        if (box.width >= 24 && box.height >= 24 && style.visibility !== 'hidden' && style.display !== 'none') return true
      }
      return false
    }
    const exemptOf = (target: unknown): InPageAxeNode['exempt'] => {
      if (!Array.isArray(target) || target.length !== 1 || typeof target[0] !== 'string') return undefined
      try {
        const el = document.querySelector(target[0])
        if (!el) return undefined
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
          const exempt = exceptions && rule.id === 'target-size' ? exemptOf(node.target) : undefined
          // Why axe-core left a contrast undecided (bgImage, bgGradient...): the pixel measurement reads it.
          const reasonKey = exceptions && rule.id === 'color-contrast' ? messageKeyOf(node) : undefined
          return {
            ref: refOfTarget(node.target),
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
      result.axe = {
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

  return result
}
