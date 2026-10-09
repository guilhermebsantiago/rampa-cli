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
  axeLocale: unknown
  maxNodes: number
}

export async function collectInPage(options: InPageOptions): Promise<InPageResult> {
  const MAX_HTML = 600
  const READING_BLOCKS = new Set(['p', 'li', 'td', 'th', 'dt', 'dd', 'blockquote', 'figcaption', 'caption', 'label', 'legend', 'summary', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'])
  const MAX_PASS_NODES = 200
  const SKIP = new Set(['script', 'style', 'noscript', 'template', 'head', 'meta', 'link', 'title', 'base'])
  const KEEP_ATTRS = ['id', 'class', 'lang', 'href', 'src', 'alt', 'title', 'type', 'role', 'name', 'for', 'aria-label', 'aria-labelledby', 'aria-hidden', 'aria-level', 'aria-describedby', 'placeholder', 'autocomplete', 'pattern']
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

  /** Text in reading order whose closest lang ancestor is `el`. */
  const langText = (el: Element): string => textInOrder(el, true)

  /** Text in reading order, without what is hidden from the accessibility tree. */
  const readingText = (el: Element): string => collapse(textInOrder(el, false)).slice(0, 1000)

  const textInOrder = (el: Element, stopAtLang: boolean): string => {
    const parts: string[] = []
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
    let node: Node | null = walker.nextNode()
    while (node) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const element = node as Element
        if (SKIP.has(element.localName)) {
          node = walker.nextSibling() ?? nextOutside(walker, el)
          continue
        }
        if (element !== el && stopAtLang && element.hasAttribute('lang')) {
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
        // An image is read by its accessible name: alt, aria-label, or the text aria-labelledby points to.
        if (element.localName === 'img') {
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
      if (value !== null) attributes[name] = value.slice(0, 200)
    }
    const native: Record<string, unknown> = { tag: el.localName, attributes }
    const tag = el.localName
    if (el.hasAttribute('lang') || ['img', 'a', 'button', 'input', 'select', 'textarea', 'canvas', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'label'].includes(tag)) {
      // The root keeps only its start tag: its outerHTML is the whole document, injected engine script included.
      native.html = el === document.documentElement ? startTag(el) : el.outerHTML.slice(0, MAX_HTML)
    }
    if (el.hasAttribute('lang')) native.langText = langText(el)
    // Only blocks with inline children need it; for the rest, the node's own text is already in order.
    if (READING_BLOCKS.has(tag) && el.children.length > 0) native.readingText = readingText(el)
    // A picture set in CSS has no alt to read, and banners with words baked in often arrive this way.
    if (tag !== 'html' && tag !== 'body') {
      const background = backgroundUrl(el)
      if (background) native.backgroundImage = background
    }
    return native
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
      run(context: Document, options: unknown): Promise<Record<'violations' | 'incomplete' | 'passes' | 'inapplicable', AxeRuleResult[]>>
    }
    const axe = (window as unknown as { axe: AxeApi }).axe
    if (options.axeLocale) axe.configure({ locale: options.axeLocale })
    const raw = await axe.run(document, { runOnly: { type: 'tag', values: options.axeTags } })
    const refOfTarget = (target: unknown): string | undefined => {
      if (!Array.isArray(target) || target.length !== 1 || typeof target[0] !== 'string') return undefined
      try {
        const el = document.querySelector(target[0])
        return el ? (refs.get(el) ?? cssPath(el)) : undefined
      } catch {
        return undefined
      }
    }
    const mapRules = (rules: AxeRuleResult[], limit: number): InPageAxeRule[] =>
      rules.map((rule) => ({
        id: rule.id,
        tags: rule.tags,
        help: rule.help,
        helpUrl: rule.helpUrl,
        impact: rule.impact ?? null,
        nodes: rule.nodes.slice(0, limit).map((node) => ({
          ref: refOfTarget(node.target),
          target: JSON.stringify(node.target),
          html: String(node.html).slice(0, MAX_HTML),
          message: node.failureSummary,
          impact: node.impact ?? null,
        })),
      }))
    result.axe = {
      version: axe.version,
      violations: mapRules(raw.violations, Number.POSITIVE_INFINITY),
      incomplete: mapRules(raw.incomplete, Number.POSITIVE_INFINITY),
      passes: mapRules(raw.passes, MAX_PASS_NODES),
      inapplicable: mapRules(raw.inapplicable, 0),
    }
  }

  return result
}
