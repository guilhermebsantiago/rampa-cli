import { readFile, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { BrowserContext, Page } from 'playwright-core'
import { errorMessage, mapLimit } from '../core/util.ts'
import { type BrowserOptions, headersFor } from '../surfaces/browser-options.ts'
import { destructiveAddress } from './guard.ts'
import type { InPageIdentity, Kit } from './kit.ts'

/**
 * Text alternatives for audio and video (1.2.1, and what 1.2.2 and 1.2.3 quote): found, read and quoted, never judged
 * for equivalence (docs/plans/wcag-coverage.md, section 6). The media probe calls this after its inventory. In the page
 * it looks, around each media element and player frame and then on the whole page, for:
 *
 * - links and buttons named for a transcript or another alternative (`Transcript`, `Transcrição`, `Text version`,
 *   `Audio described version`…), and what they lead to: the part of this page a fragment names, the region a button's
 *   `aria-controls` names, or another address;
 * - `<details>` whose summary names one, and regions named for one (by their label, their first heading, or an id or
 *   class such as `transcript`);
 * - a heading that names a transcript or the media itself, and the text after it, up to the next heading of its level;
 * - what the media's `aria-describedby` or `aria-details` names;
 * - a sentence next to the media that refers to it ("The above audio contains…", "O vídeo acima mostra…").
 *
 * Then it reads what each leads to, read-only: a link into this page is resolved in the page; a link to another
 * address of the page's own origin is read with GET (at most MAX_FETCHES, redirects followed only within the origin);
 * an address of another origin gets one HEAD, never a GET. A link that leads nowhere by itself (`href="#"`, an empty
 * href, `javascript:`, a fragment the page does not hold) is checked for what may act on a press: its own click
 * listeners read over the DevTools protocol, an `onclick`, `aria-controls`, a React, Vue or jQuery handler, or a
 * listener on an ancestor or the document. Nothing is clicked or pressed.
 *
 * The facts go into the media record; the rules (src/rules/media-alternatives.ts) decide what is broken.
 */

export const MAX_FETCHES = 6
const FETCH_CONCURRENCY = 3
const FETCH_TIMEOUT_MS = 5000
const MAX_BODY_BYTES = 2 * 1024 * 1024
const MAX_HOPS = 4
const MAX_NEAR = 6
const MAX_PAGE = 6

/** Text an alternative holds or leads to: its length and its beginning, to quote. */
export interface AltText {
  /** Characters and words, whitespace collapsed; counted up to 200,000 characters (`more` past that). */
  chars: number
  words: number
  /** The beginning, cut to 300 characters. */
  excerpt: string
  more?: boolean | undefined
  /** Frames, objects and embeds inside it: they may hold text the probe does not read. */
  embeds?: number | undefined
}

/** What an address answered, read-only. */
export interface AltFetch {
  /** GET for the page's own origin, HEAD for another; FILE for a local file next to a local page. */
  method: 'GET' | 'HEAD' | 'FILE'
  url: string
  /** Where it ended after redirects, when that differs. */
  final?: string | undefined
  /** null: no answer (a timeout, a refused connection, a file that could not be read for another reason). */
  status: number | null
  error?: string | undefined
  /** The answer came from another origin than the page's (asked directly, or after a redirect): only a HEAD went there. */
  crossOrigin: boolean
  type?: string | undefined
  bytes?: number | undefined
  /** An HTML page's title and first heading. */
  title?: string | undefined
  heading?: string | undefined
  /** The text read: an HTML page's main text, or the part its fragment names; a text file; a WebVTT file's cue text. */
  text?: AltText | undefined
  /** A WebVTT file's cues. */
  cues?: number | undefined
  /** The address names a fragment that the page it leads to does not hold. */
  fragmentMissing?: boolean | undefined
}

export interface MediaAlternative {
  /**
   * link: a link named for an alternative; button: a button, tab or switch named for one (never pressed); details: a
   * `<details>` whose summary names one; region: an element named for one (label, first heading, id or class);
   * section: a heading (or a bold line) that names one or names the media, and the text after it; described: what the
   * media's aria-describedby or aria-details names; adjacent: a sentence next to the media that refers to it.
   */
  how: 'link' | 'button' | 'details' | 'region' | 'section' | 'described' | 'adjacent'
  /** name: its text names a transcript or alternative; media-name: a heading that names the media; attribute: an id or class; refers: a sentence that refers to the media; described: aria-describedby or aria-details. */
  by: 'name' | 'media-name' | 'attribute' | 'refers' | 'described'
  /** text: a transcript or text version; audio: an audio version or audio description (for a video with no sound). */
  offers: 'text' | 'audio'
  ref: string
  id: InPageIdentity
  tag: string
  /** What names it, as found: the link's or button's text, the summary, the heading, the region's label, the sentence. */
  label: string
  /** Tied to this media: inside its container, next to it, named by its aria-describedby, or under a heading that names it. */
  near: boolean
  href?: string | undefined
  /** A link to another address: where it points, absolute. */
  url?: string | undefined
  /** A link that goes nowhere by itself: `#` (or `#top`, `#!`), an empty href, `javascript:`. */
  placeholder?: 'hash' | 'empty' | 'javascript' | undefined
  /** A link into this page whose fragment names no element of it. */
  missing?: boolean | undefined
  /**
   * For a link that goes nowhere by itself, what may act on a press: none found; its own click listener; markup or a
   * framework handler that says a script does (onclick, role=button, aria-controls or aria-expanded, a React, Vue or
   * jQuery handler); a click listener on an ancestor or the document only (delegation, or analytics). Absent when the
   * listeners could not be read.
   */
  handled?: 'none' | 'own' | 'markup' | 'delegated' | undefined
  /** The text it holds, or that it leads to in this page. */
  content?: AltText | undefined
  /**
   * Whether that text shows: shown; collapsed (a closed details, or hidden with a control on the page that may show it);
   * hidden (not rendered, and nothing on the page names it or a transcript); aria-hidden (rendered, hidden from
   * assistive technology, with no such control).
   */
  shown?: 'shown' | 'collapsed' | 'hidden' | 'aria-hidden' | undefined
  fetched?: AltFetch | undefined
}

export interface AlternativeAnchor {
  ref: string
  /** A frame of another origin (a player), not a media element. */
  frame: boolean
}

export interface AlternativesFound {
  /** Per anchor: its alternatives, and the other media elements next to it (in its container, or among its two neighbours on each side). */
  near: Array<{ ref: string; alternatives: MediaAlternative[]; media: string[] }>
  page: MediaAlternative[]
}

export interface AlternativesResult {
  byRef: Map<string, MediaAlternative[]>
  /** Other media next to each anchor: an audio player next to a video with no sound may be its audio version. */
  mediaByRef: Map<string, string[]>
  page: MediaAlternative[]
  /** Every request this step made, for the probe log. */
  fetched: Array<{ method: string; url: string; status: number | null }>
}

interface AltKit {
  textOf(root: Node, skip?: readonly Element[]): AltText
  contentOf(el: Element): AltText
  levelOf(el: Element): number
  /** One of `targets` sits in the text after the heading or label `start` (what contentOf reads for it). */
  within(start: Element, targets: readonly Node[]): boolean
}

/**
 * Installs `window.__rampaAlt`, the text readers both the page search and the reading of a fetched page use. Like the
 * kit, everything it needs is inside its own body.
 */
export function installAltKit(): void {
  const w = window as unknown as { __rampaAlt?: AltKit }
  if (w.__rampaAlt) return
  const CAP = 200_000
  const SKIP = new Set(['script', 'style', 'noscript', 'template', 'video', 'audio', 'svg', 'select', 'datalist'])
  const EMBEDS = new Set(['iframe', 'object', 'embed'])
  const BOUNDARY = 'section, article, aside, main, details, dialog, [role="region"], [role="main"], [role="tabpanel"], [role="dialog"], body'
  const LABEL =
    /^[\s\W]*(?:(?:read|see|view|show|full|complete|the|a|ler|ver|leia|veja|mostrar|lea|mostrar)\s+)*(?:(?:full|complete|text|completa|integral)\s+)?(?:transcri(?:pt|ption|ção|cao|pción)s?|text version|vers[aã]o (?:em|de) texto|versi[oó]n (?:en|de) texto|lyrics)(?:\s+(?:of|for|da|do|de|del|para)\s+[^:]{0,60})?\s*[:.\-–—]?\s*/i
  const collapse = (value: string): string => value.replace(/\s+/g, ' ').trim()
  const facts = (parts: string[], embeds: number, more: boolean): AltText => {
    const text = collapse(parts.join(' '))
    return {
      chars: text.length,
      words: text ? text.split(' ').length : 0,
      excerpt: text.length > 300 ? `${text.slice(0, 299)}…` : text,
      ...(more ? { more: true } : {}),
      ...(embeds > 0 ? { embeds } : {}),
    }
  }
  /** Visits nodes in document order from `start`, inside `boundary`; 'skip' leaves a subtree out, 'stop' ends the walk. */
  const walk = (start: Node | null, boundary: Node, visit: (node: Node) => 'stop' | 'skip' | undefined): void => {
    let node: Node | null = start
    while (node) {
      const verdict = visit(node)
      if (verdict === 'stop') return
      if (verdict !== 'skip' && node.firstChild) {
        node = node.firstChild
        continue
      }
      while (node && node !== boundary && !node.nextSibling) node = node.parentNode
      if (!node || node === boundary) return
      node = node.nextSibling
    }
  }
  const reader = () => {
    const parts: string[] = []
    let length = 0
    let embeds = 0
    let more = false
    const visit = (node: Node, skip: readonly Element[]): 'stop' | 'skip' | undefined => {
      if (node.nodeType === 1) {
        const el = node as Element
        if (skip.includes(el)) return 'skip'
        const tag = el.localName
        if (EMBEDS.has(tag)) embeds++
        if (SKIP.has(tag)) return 'skip'
        if (tag === 'img') {
          const alt = el.getAttribute('alt')
          if (alt) parts.push(` ${alt} `)
        }
        // Block boundaries keep words apart.
        if (tag === 'br' || tag === 'p' || tag === 'div' || tag === 'li' || tag === 'td' || tag === 'th' || tag === 'dd' || tag === 'dt') parts.push(' ')
        return undefined
      }
      if (node.nodeType === 3) {
        if (length >= CAP) {
          more = true
          return 'stop'
        }
        const value = node.nodeValue ?? ''
        parts.push(value)
        length += value.length
      }
      return undefined
    }
    return { visit, done: () => facts(parts, embeds, more), parts }
  }
  const textOf = (root: Node, skip: readonly Element[] = []): AltText => {
    const r = reader()
    walk(root.firstChild, root, (node) => r.visit(node, skip))
    return r.done()
  }
  const levelOf = (el: Element): number => {
    const match = /^h([1-6])$/.exec(el.localName)
    if (match) return Number(match[1])
    if (el.getAttribute('role') === 'heading') return Number(el.getAttribute('aria-level')) || 2
    return 0
  }
  /** The text after `start` (a heading or a label) up to the next heading of the same level or higher, inside its section. */
  const after = (start: Element, level: number, prefix: string): AltText => {
    const boundary = start.parentElement?.closest(BOUNDARY) ?? start.ownerDocument.body ?? start.ownerDocument.documentElement
    const r = reader()
    if (prefix) r.parts.push(prefix)
    let first: Node | null = start
    while (first && first !== boundary && !first.nextSibling) first = first.parentNode
    if (first && first !== boundary) {
      walk(first.nextSibling, boundary, (node) => {
        if (node.nodeType === 1) {
          const l = levelOf(node as Element)
          if (l > 0 && l <= level) return 'stop'
        }
        return r.visit(node, [])
      })
    }
    return r.done()
  }
  /** The block a short label sits in: a bold line's paragraph, when the paragraph says nothing else. */
  const blockOf = (el: Element): Element => {
    const parent = el.parentElement
    if (parent && ['p', 'div', 'li', 'dd', 'td'].includes(parent.localName) && collapse(parent.textContent ?? '') === collapse(el.textContent ?? '')) return parent
    return el
  }
  const contentOf = (el: Element): AltText => {
    const heading = el.closest('h1, h2, h3, h4, h5, h6, [role="heading"]')
    if (heading) return after(heading, levelOf(heading), '')
    const tag = el.localName
    const parent = el.parentElement
    if (tag === 'summary' && parent?.localName === 'details') return textOf(parent, [el])
    if ((tag === 'legend' && parent?.localName === 'fieldset') || (tag === 'caption' && parent?.localName === 'table')) return textOf(parent as Element, [el])
    if (tag === 'dt') {
      const r = reader()
      for (let next = el.nextElementSibling; next && next.localName !== 'dt'; next = next.nextElementSibling) walk(next, next, (node) => r.visit(node, []))
      return r.done()
    }
    const own = collapse(el.textContent ?? '')
    const embeds = Array.from(el.querySelectorAll('iframe, object, embed')).length
    // An empty target (an anchor before the text): the text after it.
    if (own.length === 0 && embeds === 0) return after(blockOf(el), 7, '')
    // A short label of its own ("Transcript:", a bold "Transcrição"): what follows it in its block, then after it.
    if (own.length <= 200 && !el.querySelector('p, div, li, section, article, table, ul, ol') && LABEL.test(own)) return after(blockOf(el), 7, own.replace(LABEL, ''))
    const first = el.querySelector('h1, h2, h3, h4, h5, h6, [role="heading"], summary, legend')
    const label = first && LABEL.test(collapse(first.textContent ?? '')) ? [first] : []
    return textOf(el, label)
  }
  const within = (start: Element, targets: readonly Node[]): boolean => {
    // A heading's section ends at the next heading of its level; a label's (a bold line) at the next heading.
    const level = levelOf(start) || 7
    const boundary = start.parentElement?.closest(BOUNDARY) ?? start.ownerDocument.body ?? start.ownerDocument.documentElement
    let first: Node | null = start
    while (first && first !== boundary && !first.nextSibling) first = first.parentNode
    if (!first || first === boundary) return false
    const wanted = new Set(targets)
    let found = false
    walk(first.nextSibling, boundary, (node) => {
      if (wanted.has(node)) {
        found = true
        return 'stop'
      }
      if (node.nodeType === 1) {
        const l = levelOf(node as Element)
        if (l > 0 && l <= level) return 'stop'
      }
      return undefined
    })
    return found
  }
  w.__rampaAlt = { textOf, contentOf, levelOf, within }
}

interface FindArgs {
  anchors: AlternativeAnchor[]
  /** Every known player's frame, showing or not: media too, so one player's container never takes in another's. */
  players: string[]
  maxNear: number
  maxPage: number
  /** Click listeners were read and marked (markClickListeners): `__rampaClick` on nodes, `__rampaClickWindow`. */
  listeners: boolean
}

/**
 * Runs in the probe page, after installKit and installAltKit: the alternatives near each media element or player
 * frame, and those elsewhere on the page. Read-only.
 */
export function findAlternatives(args: FindArgs): AlternativesFound {
  const kit = (window as unknown as { __rampaKit: Kit }).__rampaKit
  const alt = (window as unknown as { __rampaAlt: AltKit }).__rampaAlt
  const collapse = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim()
  const cut = (value: string, n: number) => (value.length > n ? `${value.slice(0, n - 1)}…` : value)
  const TRANSCRIPT = /transcri(pt|ption|ção|cao|ções|pción|pciones|bed)|\btext version\b|vers[aã]o (em|de) texto|versi[oó]n (en|de) texto|texto (completo|integral) d[oa] (v[ií]deo|[aá]udio|podcast|epis[oó]dio)|\blyrics\b/i
  const TEXT_ALT = /\btext (alternative|description)\b|\bdescription of the (video|animation)\b|descri[cç][aã]o (em texto|textual|do v[ií]deo)|descripci[oó]n (textual|en texto|del v[ií]deo)/i
  const AUDIO_ALT = /audio[\s-]?descri|audiodescri|described (version|video)|\b(audio|narrated) version\b|descri[cç][aã]o (de|em) [aá]udio|vers[aã]o (em [aá]udio|narrada|audiodescrita)|descripci[oó]n (de|en) audio|versi[oó]n (en audio|narrada|audiodescrita)/i
  const REFERS =
    /\b(the|this) (above|following|preceding|previous|embedded) (audio|video|recording|clip|podcast|episode|speech|animation)\b|\b(audio|video|recording|clip|podcast|animation)( file| clip| player)? (above|below)\b|\b(the|this) (audio|video|recording|clip|animation) (contains|shows|says|features|presents|describes)\b|\b(o|este|esse|neste|nesse) (á|a)udio (acima|abaixo|a seguir|anterior)\b|\b(o|este|esse|neste|nesse) v[ií]deo (acima|abaixo|a seguir|anterior)\b|\b(o|este|esse) (á|a)udio (mostra|cont[eé]m|apresenta|diz|traz)\b|\b(o|este|esse) v[ií]deo (mostra|cont[eé]m|apresenta|diz|traz)\b|\b(el|este|ese) (audio|v[ií]deo) (de arriba|de abajo|anterior|siguiente|muestra|contiene|presenta|dice)\b/i
  const ATTRIBUTE = /transcri(pt|ption|cao|ção|cion|pción)|text-?version/i
  /** A player's settings about its transcript ("Transcript Preferences", "Highlight transcript"): no alternative. */
  const SETTINGS = /\b(preferences|settings|options|highlight|keyboard-enable|auto ?scroll|prefer[eê]ncias|configura[cç](?:[oõ]es|[aã]o)|ajustes|opciones|configuraci[oó]n)\b/i
  const SETTINGS_ATTRIBUTE = /pref|setting|option|config|toggle|btn|button|icon|control|toolbar|menu/i
  const GENERIC = /^(video|vídeo|audio|áudio|podcast|player|media|mídia|episode|episódio|episodio|youtube video player|vimeo video player|embedded (content|video|audio)|audio player|video player|podcast player|reprodutor|reproductor)( \d+)?$/i

  // The page, its open shadow roots and its same-origin frames.
  const roots: Array<Document | ShadowRoot> = []
  const gather = (root: Document | ShadowRoot) => {
    roots.push(root)
    for (const el of Array.from(root.querySelectorAll('*'))) {
      if (el.shadowRoot) gather(el.shadowRoot)
      if (el.localName === 'iframe' || el.localName === 'frame') {
        try {
          const doc = (el as HTMLIFrameElement).contentDocument
          if (doc?.documentElement) gather(doc)
        } catch {
          // Another origin.
        }
      }
    }
  }
  gather(document)
  const all = (selector: string): Element[] => roots.flatMap((root) => Array.from(root.querySelectorAll(selector)))

  const anchors = args.anchors.flatMap((anchor) => {
    const el = kit.resolve(anchor.ref)
    return el ? [{ ...anchor, el }] : []
  })
  const players = args.players.flatMap((ref) => {
    const el = kit.resolve(ref)
    return el ? [el] : []
  })
  const mediaEls = new Set<Element>([...all('video, audio'), ...anchors.map((a) => a.el), ...players])
  const insideMedia = (el: Element) => !!el.parentElement?.closest('video, audio')
  const shows = (el: Element): boolean => {
    if (el.closest('[aria-hidden="true"], [inert]')) return false
    const r = el.getBoundingClientRect()
    return kit.visible(el) && r.width >= 1 && r.height >= 1
  }
  const nameOf = (el: Element): string => {
    const labelledby = collapse(el.getAttribute('aria-labelledby'))
    if (labelledby) {
      const text = labelledby
        .split(' ')
        .map((id) => collapse(el.ownerDocument.getElementById(id)?.textContent))
        .join(' ')
        .trim()
      if (text) return text
    }
    return collapse(el.getAttribute('aria-label')) || collapse((el as HTMLElement).innerText ?? el.textContent) || collapse(el.getAttribute('title'))
  }
  // The element's own container: up to five levels up, short of an ancestor that holds other media.
  const containerOf = (el: Element): Element => {
    let container: Element = el
    for (let i = 0; i < 5; i++) {
      const parent: Element | null = container.parentElement
      if (!parent || parent === el.ownerDocument.body || parent === el.ownerDocument.documentElement) break
      if (Array.from(mediaEls).some((other) => other !== el && parent.contains(other))) break
      container = parent
      if (['figure', 'article', 'section', 'li'].includes(container.localName)) break
    }
    return container
  }
  /** Elements that hold nothing to read: they do not count as neighbours. */
  const INERT = new Set(['script', 'style', 'template', 'link', 'meta', 'noscript'])
  const previous = (node: Element | null): Element | null => {
    let prev = node?.previousElementSibling ?? null
    while (prev && INERT.has(prev.localName)) prev = prev.previousElementSibling
    return prev
  }
  const following = (node: Element | null): Element | null => {
    let next = node?.nextElementSibling ?? null
    while (next && INERT.has(next.localName)) next = next.nextElementSibling
    return next
  }
  /** The two elements before and after, of the media and of its container: where a sentence about it sits. */
  const neighbours = (el: Element, container: Element): Element[] => {
    const out: Element[] = []
    for (const base of container === el ? [el] : [el, container]) {
      let prev = previous(base)
      let next = following(base)
      // Up to another media's element, which is that media's neighbourhood.
      const free = (sibling: Element | null): sibling is Element => !!sibling && !Array.from(mediaEls).some((media) => sibling === media || sibling.contains(media))
      for (let i = 0; i < 2; i++) {
        if (free(prev)) out.push(prev)
        else prev = null
        if (free(next)) out.push(next)
        else next = null
        prev = previous(prev)
        next = following(next)
      }
    }
    return out
  }
  const ids = (el: Element): string[] => {
    const out: string[] = []
    for (let node: Element | null = el, i = 0; node && i < 4; node = node.parentElement, i++) if (node.id) out.push(node.id)
    return out
  }
  const controlTargets = new Set(
    all('[aria-controls], [popovertarget], [commandfor]').flatMap((el) => `${el.getAttribute('aria-controls') ?? ''} ${el.getAttribute('popovertarget') ?? ''} ${el.getAttribute('commandfor') ?? ''}`.split(/\s+/).filter(Boolean)),
  )
  const frameworkHandled = (el: Element): boolean => {
    for (let node: Element | null = el, i = 0; node && i < 3; node = node.parentElement, i++) {
      const record = node as unknown as Record<string, unknown>
      for (const key of Object.keys(record)) {
        if (key.startsWith('__reactProps$') || key.startsWith('__reactEventHandlers$')) {
          const props = record[key] as Record<string, unknown> | null
          if (props && (props.onClick || props.onMouseDown || props.onPointerDown || props.onMouseUp || props.onPointerUp)) return true
        }
        if (key === '_vei') {
          const invokers = record[key] as Record<string, unknown> | null
          if (invokers && (invokers.onClick || invokers.onMousedown || invokers.onPointerdown)) return true
        }
      }
    }
    const jq = (window as unknown as { jQuery?: { _data?: (el: unknown, key: string) => Record<string, Array<{ selector?: string }>> | undefined } }).jQuery
    if (jq && typeof jq._data === 'function') {
      try {
        if ((jq._data(el, 'events')?.click ?? []).length > 0) return true
        for (let node: Element | Document | null = el.parentElement; node; node = node instanceof Element ? (node.parentElement ?? node.ownerDocument) : null) {
          const handlers = jq._data(node, 'events')?.click ?? []
          if (handlers.some((h) => h.selector && el.matches(h.selector))) return true
          if (node instanceof Document) break
        }
      } catch {
        // A jQuery without _data.
      }
    }
    return false
  }
  const markup = (el: Element): boolean =>
    el.hasAttribute('onclick') || el.getAttribute('role') === 'button' || el.hasAttribute('aria-controls') || el.hasAttribute('aria-expanded') || el.hasAttribute('aria-haspopup') || frameworkHandled(el)
  const clickMarked = (node: unknown) => !!(node as { __rampaClick?: boolean } | null)?.__rampaClick
  /** What may act on a press of a link that goes nowhere by itself; undefined when the listeners could not be read. */
  const handledOf = (el: Element): MediaAlternative['handled'] => {
    if (markup(el)) return 'markup'
    if (!args.listeners) return undefined
    if (clickMarked(el) || Array.from(el.querySelectorAll('*')).some(clickMarked)) return 'own'
    for (let node: Node | null = el.parentNode; node; node = node.parentNode ?? (node instanceof ShadowRoot ? node.host : null)) if (clickMarked(node)) return 'delegated'
    return (window as unknown as { __rampaClickWindow?: boolean }).__rampaClickWindow ? 'delegated' : 'none'
  }
  const byId = (doc: Document, fragment: string): Element | null => {
    let id = fragment
    try {
      id = decodeURIComponent(fragment)
    } catch {
      id = fragment
    }
    return doc.getElementById(id) ?? (doc.getElementsByName(id)[0] as Element | undefined) ?? null
  }
  /** A link that goes nowhere by itself (`#`, an empty href, `javascript:`, a fragment the page does not hold). */
  const goesNowhere = (el: Element): boolean => {
    if (el.localName !== 'a' || !el.hasAttribute('href')) return true
    const raw = (el.getAttribute('href') ?? '').trim()
    if (raw === '' || /^javascript:/i.test(raw)) return true
    try {
      const url = new URL(raw, el.baseURI)
      if (url.href.split('#')[0] !== new URL(el.ownerDocument.URL).href.split('#')[0] || !(raw.startsWith('#') || url.hash)) return false
      const fragment = url.hash.slice(1)
      return fragment === '' || fragment === '!' || fragment.toLowerCase() === 'top' || !byId(el.ownerDocument, fragment)
    } catch {
      return true
    }
  }
  const PRESS = 'a[href], [role="link"], button, [role="button"], [role="tab"], [role="switch"], input[type="button"], summary'
  // Showing controls named for a transcript, which a script may use to show hidden text; a link that goes nowhere and
  // that nothing handles cannot.
  const showingControls = all(PRESS).filter((el) => {
    const name = nameOf(el)
    if (name.length > 200 || !(TRANSCRIPT.test(name) || TEXT_ALT.test(name)) || !shows(el)) return false
    return !(el.matches('a, [role="link"]') && goesNowhere(el) && handledOf(el) === 'none')
  })
  /** One of those controls next to the element: within three levels up, short of the main content or an ancestor that holds several media. */
  const nearControl = (el: Element): boolean => {
    for (let node: Element | null = el.parentElement, i = 0; node && i < 3; node = node.parentElement, i++) {
      if (node === node.ownerDocument.body || node === node.ownerDocument.documentElement || node.matches('main, [role="main"]')) break
      if (Array.from(mediaEls).filter((media) => node?.contains(media)).length > 1) break
      if (showingControls.some((control) => node?.contains(control) && !el.contains(control))) return true
    }
    return false
  }
  /**
   * Hidden text is "collapsed" when something may show it (a closed details, a control that names it in
   * aria-controls, or a showing control named for a transcript next to it); "hidden" or "aria-hidden" when nothing does.
   */
  const stateOf = (el: Element): MediaAlternative['shown'] => {
    const ariaHidden = !!el.closest('[aria-hidden="true"]')
    const rendered = kit.visible(el) && !el.closest('details:not([open])')
    if (rendered && !ariaHidden) return 'shown'
    // A closed details, or a closed dialog (something on the page opens it), may show it.
    const closed = el.closest('details:not([open]), dialog:not([open]), [role="dialog"], [role="alertdialog"], [aria-modal="true"], [popover]')
    const controlled = !!closed || ids(el).some((id) => controlTargets.has(id)) || nearControl(el)
    if (controlled) return 'collapsed'
    return rendered ? 'aria-hidden' : 'hidden'
  }
  const offersOf = (text: string): MediaAlternative['offers'] => (AUDIO_ALT.test(text) && !TRANSCRIPT.test(text) ? 'audio' : 'text')

  type Candidate = MediaAlternative & { el: Element; contentEl?: Element | undefined }
  const base = (el: Element, how: MediaAlternative['how'], by: MediaAlternative['by'], label: string, offers: MediaAlternative['offers']): Candidate => {
    const d = kit.describe(el)
    return { el, how, by, offers, ref: d.ref, id: d.id, tag: d.tag, label: cut(label, 120), near: false }
  }
  const withContent = (candidate: Candidate, contentEl: Element): Candidate => {
    candidate.contentEl = contentEl
    candidate.content = alt.contentOf(contentEl)
    candidate.shown = stateOf(contentEl)
    return candidate
  }
  const linkCandidate = (el: Element, label: string, by: MediaAlternative['by']): Candidate | undefined => {
    const c = base(el, 'link', by, label, offersOf(label))
    const raw = (el.getAttribute('href') ?? '').trim()
    c.href = cut(raw, 300)
    const doc = el.ownerDocument
    const controls = collapse(el.getAttribute('aria-controls'))
      .split(' ')
      .map((id) => (id ? doc.getElementById(id) : null))
      .find((target): target is HTMLElement => !!target)
    const nowhere = (kind?: MediaAlternative['placeholder']) => {
      if (kind) c.placeholder = kind
      else c.missing = true
      const handled = handledOf(el)
      if (handled) c.handled = handled
      if (controls) withContent(c, controls)
      return c
    }
    if (el.localName !== 'a' || !el.hasAttribute('href')) return nowhere('empty')
    if (raw === '') return nowhere('empty')
    if (/^javascript:/i.test(raw)) return nowhere('javascript')
    let url: URL
    try {
      url = new URL(raw, el.baseURI)
    } catch {
      return nowhere('empty')
    }
    if (!/^(https?|file):$/.test(url.protocol)) return undefined
    const here = new URL(doc.URL)
    if (url.href.split('#')[0] === here.href.split('#')[0] && (raw.startsWith('#') || url.hash)) {
      const fragment = url.hash.slice(1)
      if (fragment === '' || fragment === '!' || fragment.toLowerCase() === 'top') return nowhere('hash')
      const target = byId(doc, fragment)
      if (!target) return nowhere()
      return withContent(c, target)
    }
    c.url = url.href.slice(0, 500)
    return c
  }

  const candidates: Candidate[] = []
  // 1. Elements whose own text names a transcript or an alternative: links, buttons, summaries, headings, labels.
  const SIGNALS =
    'a[href], [role="link"], button, [role="button"], [role="tab"], [role="switch"], input[type="button"], summary, h1, h2, h3, h4, h5, h6, [role="heading"], figcaption, caption, legend, dt, p, strong, b'
  const signals: Array<{ el: Element; text: string }> = []
  for (const el of all(SIGNALS)) {
    if (insideMedia(el)) continue
    const text = el.localName === 'input' ? collapse((el as HTMLInputElement).value) : nameOf(el)
    if (!text || text.length > 200 || !(TRANSCRIPT.test(text) || TEXT_ALT.test(text) || AUDIO_ALT.test(text)) || SETTINGS.test(text)) continue
    const pressable = el.matches(PRESS)
    // Controls must show to be used; a heading may sit in hidden text, which is a fact to record.
    if (pressable && !shows(el)) continue
    signals.push({ el, text })
  }
  // The innermost element that says it: the link, not the paragraph around it.
  const innermost = signals.filter((outer) => !signals.some((inner) => inner !== outer && outer.el.contains(inner.el)))
  for (const { el, text } of innermost) {
    if (el.matches('a[href], [role="link"]')) {
      const c = linkCandidate(el, text, 'name')
      if (c) candidates.push(c)
    } else if (el.localName === 'summary' && el.parentElement?.localName === 'details') {
      const details = el.parentElement
      const c = base(details, 'details', 'name', text, offersOf(text))
      c.content = alt.contentOf(el)
      c.contentEl = details
      c.shown = (details as HTMLDetailsElement).open ? stateOf(details) : 'collapsed'
      candidates.push(c)
    } else if (el.matches('button, [role="button"], [role="tab"], [role="switch"], input')) {
      const c = base(el, 'button', 'name', text, offersOf(text))
      const doc = el.ownerDocument
      const targets = `${el.getAttribute('aria-controls') ?? ''} ${el.getAttribute('popovertarget') ?? ''} ${el.getAttribute('commandfor') ?? ''}`
        .split(/\s+/)
        .map((id) => (id ? doc.getElementById(id) : null))
        .filter((target): target is HTMLElement => !!target)
      if (targets[0]) withContent(c, targets[0])
      candidates.push(c)
    } else {
      // A heading or a label: the text after it.
      const c = base(el, 'section', 'name', text, offersOf(text))
      candidates.push(withContent(c, el))
    }
  }
  // 2. Regions named for a transcript by their label or title, or by an id or class.
  const REGIONS = 'section, div, aside, article, details, dialog, [role="region"], [role="tabpanel"], [role="dialog"], [role="complementary"], [role="document"]'
  const regions = all(REGIONS).filter((el) => {
    if (insideMedia(el) || Array.from(mediaEls).some((media) => el.contains(media))) return false
    // A control styled as a div (a player's "Show transcript" button) is no region.
    if (/^(button|link|tab|switch|menuitem|checkbox|radio|option|slider)$/.test(el.getAttribute('role') ?? '')) return false
    const label = collapse(el.getAttribute('aria-label')) || collapse(el.getAttribute('title'))
    const className = typeof el.className === 'string' ? el.className : ''
    const heading = collapse(el.querySelector('h1, h2, h3, h4, h5, h6, [role="heading"], legend')?.textContent)
    // Settings about a transcript (a preferences dialog) are no transcript.
    if (SETTINGS.test(label) || SETTINGS.test(heading) || ((ATTRIBUTE.test(el.id) || ATTRIBUTE.test(className)) && SETTINGS_ATTRIBUTE.test(`${el.id} ${className}`))) return false
    return (label && label.length <= 200 && TRANSCRIPT.test(label)) || ATTRIBUTE.test(el.id) || ATTRIBUTE.test(className)
  })
  for (const el of regions) {
    if (regions.some((outer) => outer !== el && outer.contains(el))) continue
    // A region a link already leads to: the link quotes it.
    if (candidates.some((c) => c.el === el || c.contentEl === el)) continue
    // Its own heading or summary, found as a section or a details: one candidate, the region, read whole.
    for (let i = candidates.length - 1; i >= 0; i--) {
      const inner = candidates[i]
      if (inner && (inner.how === 'section' || inner.how === 'details') && el.contains(inner.el)) candidates.splice(i, 1)
    }
    const label = collapse(el.getAttribute('aria-label')) || collapse(el.getAttribute('title'))
    const heading = el.querySelector('h1, h2, h3, h4, h5, h6, [role="heading"], summary, legend')
    const headingText = collapse(heading?.textContent)
    const named = (label && TRANSCRIPT.test(label)) || (headingText.length <= 200 && TRANSCRIPT.test(headingText))
    const c = base(el, 'region', named ? 'name' : 'attribute', label || (named ? headingText : `${el.localName}${el.id ? `#${el.id}` : ''}${typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : ''}`), 'text')
    candidates.push(withContent(c, el))
  }
  // A section whose heading is the target of a link found: the link quotes it. A label inside the text after a heading
  // found ("Transcript" over "Transcript coming soon."): the heading's section holds it.
  // A heading whose section holds media ("Episodes and their transcripts" over the players) titles them; it is no alternative.
  for (let i = candidates.length - 1; i >= 0; i--) {
    const c = candidates[i]
    if (!c || c.how !== 'section') continue
    const linked = candidates.some((other) => other.how === 'link' && other.contentEl && (other.contentEl === c.el || other.contentEl.contains(c.el)))
    const under = alt.levelOf(c.el) === 0 && candidates.some((other) => other !== c && other.how === 'section' && alt.levelOf(other.el) > 0 && alt.within(other.el, [c.el]))
    const titles = alt.within(c.el, Array.from(mediaEls))
    if (linked || under || titles) candidates.splice(i, 1)
  }

  // 3. Sentences that refer to the media ("the above audio…"), anywhere; tied to a media when next to it.
  const referring: Candidate[] = []
  for (const el of all('p, figcaption, li, dd, td, blockquote, caption')) {
    if (insideMedia(el) || referring.length >= 20) continue
    const text = collapse(el.textContent)
    if (!text || text.length > 4000 || !REFERS.test(text)) continue
    if (referring.some((c) => c.el.contains(el)) || candidates.some((c) => c.contentEl?.contains(el) || c.el.contains(el))) continue
    const sentence = (text.match(/[^.!?]*(?:[.!?]|$)/g) ?? []).find((s) => REFERS.test(s)) ?? text
    const c = withContent(base(el, 'adjacent', 'refers', collapse(sentence), 'text'), el)
    // A short sentence that points up ("…to hear the above part of the speech"): the text is the block before it.
    const prev = el.previousElementSibling
    if (
      c.content &&
      text.length < 200 &&
      /\b(above|preceding|previous|acima|anterior|arriba)\b/i.test(text) &&
      prev &&
      ['p', 'div', 'blockquote', 'ul', 'ol', 'dl', 'table', 'pre'].includes(prev.localName) &&
      !Array.from(mediaEls).some((media) => prev.contains(media))
    ) {
      const before = alt.textOf(prev)
      if (before.chars > 0) {
        const joined = `${before.excerpt} ${c.content.excerpt}`
        c.content = { chars: before.chars + 1 + c.content.chars, words: before.words + c.content.words, excerpt: joined.length > 300 ? `${joined.slice(0, 299)}…` : joined }
        if (stateOf(prev) !== 'shown') c.shown = stateOf(prev)
      }
    }
    referring.push(c)
  }

  const near = anchors.map((anchor) => {
    const el = anchor.el
    const container = containerOf(el)
    const around = neighbours(el, container)
    const isNear = (other: Element) => container.contains(other) || around.some((n) => n === other || n.contains(other))
    const found: Candidate[] = []
    for (const c of candidates) if (isNear(c.el)) found.push({ ...c, near: true })
    for (const c of referring) if (isNear(c.el)) found.push({ ...c, near: true })
    // What aria-describedby and aria-details name.
    const described = `${el.getAttribute('aria-describedby') ?? ''} ${el.getAttribute('aria-details') ?? ''}`.split(/\s+/).filter(Boolean)
    for (const id of described) {
      const target = el.ownerDocument.getElementById(id)
      if (!target || found.some((c) => c.el === target)) continue
      const c = base(target, 'described', 'described', cut(collapse(target.textContent), 120), 'text')
      found.push({ ...withContent(c, target), near: true })
    }
    // A heading elsewhere that names the media: its own label, title or figure caption (strong names), or the heading
    // over it (a weak name, which many media may share: the heading must then also name a transcript).
    const names = new Map<string, boolean>()
    const add = (value: string | null | undefined, strong: boolean) => {
      const text = collapse(value).toLowerCase()
      if (text.length >= 6 && text.length <= 160 && !GENERIC.test(text) && !names.get(text)) names.set(text, strong)
    }
    add(el.getAttribute('aria-label'), true)
    add(el.getAttribute('title'), true)
    const labelledby = collapse(el.getAttribute('aria-labelledby'))
    if (labelledby) add(labelledby.split(' ').map((id) => collapse(el.ownerDocument.getElementById(id)?.textContent)).join(' '), true)
    add(el.closest('figure')?.querySelector('figcaption')?.textContent, true)
    let own: Element | null = null
    {
      const walker = el.ownerDocument.createTreeWalker(el.ownerDocument.body ?? el.ownerDocument.documentElement, NodeFilter.SHOW_ELEMENT)
      walker.currentNode = el
      for (let i = 0; i < 400; i++) {
        const prev = walker.previousNode() as Element | null
        if (!prev) break
        if (alt.levelOf(prev) > 0) {
          own = prev
          break
        }
      }
      if (own) add(own.textContent, false)
    }
    if (names.size > 0) {
      for (const heading of all('h1, h2, h3, h4, h5, h6, [role="heading"]')) {
        if (heading === own || container.contains(heading) || found.some((c) => c.el === heading || c.contentEl?.contains(heading) || c.el.contains(heading))) continue
        const text = collapse(heading.textContent)
        const lower = text.toLowerCase()
        const matches = [...names.entries()].filter(([name]) => lower.includes(name))
        if (!text || text.length > 200 || matches.length === 0) continue
        const says = TRANSCRIPT.test(text) || TEXT_ALT.test(text)
        const c = withContent(base(heading, 'section', 'media-name', text, 'text'), heading)
        if (says || (matches.some(([, strong]) => strong) && (c.content?.chars ?? 0) >= 400)) found.push({ ...c, near: true })
      }
    }
    // Other media next to it: in its own container, or one of its two siblings on each side (not inside them: a
    // neighbouring section's player belongs to that section).
    const close: Element[] = []
    for (let prev = previous(el), i = 0; prev && i < 2; prev = previous(prev), i++) close.push(prev)
    for (let next = following(el), i = 0; next && i < 2; next = following(next), i++) close.push(next)
    const media = Array.from(mediaEls)
      .filter((other) => other !== el && !anchors.some((a) => a.frame && a.el === other) && ((container !== el && container.contains(other)) || close.includes(other)))
      .map((other) => kit.cssPath(other))
      .slice(0, 4)
    return { ref: anchor.ref, alternatives: found.slice(0, args.maxNear).map(({ el: _el, contentEl: _content, ...rest }) => rest), media }
  })
  const attributed = new Set(near.flatMap((n) => n.alternatives.map((a) => a.ref)))
  const page = [...candidates, ...referring]
    .filter((c) => !attributed.has(c.ref))
    .slice(0, args.maxPage)
    .map(({ el: _el, contentEl: _content, ...rest }) => rest)
  return { near, page }
}

/**
 * Click listeners read over the DevTools protocol: every node with one is marked `__rampaClick`, and the window
 * `__rampaClickWindow`. Returns false when they could not be read.
 */
async function markClickListeners(page: Page): Promise<boolean> {
  try {
    const cdp = await page.context().newCDPSession(page)
    try {
      const TYPES = new Set(['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'touchend', 'auxclick'])
      const { result } = await cdp.send('Runtime.evaluate', { expression: 'document' })
      if (!result.objectId) return false
      const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId, depth: -1, pierce: true })
      const nodes = new Set<number>()
      for (const listener of listeners) if (TYPES.has(listener.type) && listener.backendNodeId) nodes.add(listener.backendNodeId)
      for (const backendNodeId of [...nodes].slice(0, 600)) {
        try {
          const { object } = await cdp.send('DOM.resolveNode', { backendNodeId })
          if (object.objectId) await cdp.send('Runtime.callFunctionOn', { objectId: object.objectId, functionDeclaration: 'function () { this.__rampaClick = true }' })
        } catch {
          // The node went away.
        }
      }
      const win = await cdp.send('Runtime.evaluate', { expression: 'window' })
      if (win.result.objectId) {
        const own = await cdp.send('DOMDebugger.getEventListeners', { objectId: win.result.objectId, depth: 0 })
        if (own.listeners.some((listener) => TYPES.has(listener.type))) await cdp.send('Runtime.evaluate', { expression: 'window.__rampaClickWindow = true' })
      }
      return true
    } finally {
      await cdp.detach().catch(() => undefined)
    }
  } catch {
    return false
  }
}

/** Runs in the page: an HTML answer parsed (never rendered, no script runs), its title, heading and main text. */
function readHtml(args: { html: string; fragment: string }): { title: string; heading: string; text: AltText; fragmentMissing: boolean } {
  const alt = (window as unknown as { __rampaAlt: AltKit }).__rampaAlt
  const collapse = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim()
  const doc = new DOMParser().parseFromString(args.html, 'text/html')
  const title = collapse(doc.title).slice(0, 160)
  const heading = collapse(doc.querySelector('h1')?.textContent).slice(0, 160)
  if (args.fragment) {
    let id = args.fragment
    try {
      id = decodeURIComponent(id)
    } catch {
      id = args.fragment
    }
    const target = doc.getElementById(id) ?? (doc.getElementsByName(id)[0] as Element | undefined)
    if (target) return { title, heading, text: alt.contentOf(target), fragmentMissing: false }
  }
  for (const el of Array.from(doc.querySelectorAll('nav, header, footer, [role="navigation"], [role="banner"], [role="contentinfo"]'))) el.remove()
  const main = doc.querySelector('main, [role="main"]') ?? doc.body ?? doc.documentElement
  return { title, heading, text: alt.textOf(main), fragmentMissing: !!args.fragment }
}

/** A text file's or a WebVTT file's text, read in Node. */
function plainText(body: string, vtt: boolean): { text: AltText; cues?: number } {
  let source = body
  let cues: number | undefined
  if (vtt) {
    const blocks = body.replace(/\r\n?/g, '\n').split(/\n{2,}/)
    const texts: string[] = []
    cues = 0
    for (const block of blocks) {
      const lines = block.split('\n')
      const at = lines.findIndex((line) => line.includes('-->'))
      if (at < 0) continue
      cues++
      texts.push(lines.slice(at + 1).join(' ').replace(/<[^>]*>/g, ''))
    }
    source = texts.join(' ')
  }
  const text = source.replace(/\s+/g, ' ').trim()
  const capped = text.slice(0, 200_000)
  return {
    text: { chars: capped.length, words: capped ? capped.split(' ').length : 0, excerpt: capped.length > 300 ? `${capped.slice(0, 299)}…` : capped, ...(text.length > capped.length ? { more: true } : {}) },
    ...(cues !== undefined ? { cues } : {}),
  }
}

interface FetchContext {
  page: Page
  context: BrowserContext
  pageUrl: URL
  browserOptions?: BrowserOptions | undefined
  log: AlternativesResult['fetched']
}

async function readBody(ctx: FetchContext, fetched: AltFetch, body: Buffer, fragment: string): Promise<void> {
  fetched.bytes = body.length
  const type = (fetched.type ?? '').toLowerCase()
  const html = /html|xml/.test(type) || (!type && /^\s*</.test(body.subarray(0, 200).toString('utf8')))
  const text = body.toString('utf8')
  if (html) {
    const read = await ctx.page.evaluate(readHtml, { html: text.slice(0, 1_500_000), fragment }).catch(() => undefined)
    if (read) {
      if (read.title) fetched.title = read.title
      if (read.heading) fetched.heading = read.heading
      fetched.text = read.text
      if (read.fragmentMissing) fetched.fragmentMissing = true
    }
  } else if (/^text\/|vtt/.test(type) || /\.(txt|vtt|md|srt)$/i.test(fetched.url.split(/[?#]/)[0] ?? '')) {
    const read = plainText(text, /vtt/.test(type) || /\.vtt$/i.test(fetched.url.split(/[?#]/)[0] ?? ''))
    fetched.text = read.text
    if (read.cues !== undefined) fetched.cues = read.cues
  }
}

/** One address, read-only: GET within the page's origin (redirects followed while they stay in it), one HEAD elsewhere. */
async function fetchAlternative(ctx: FetchContext, address: string): Promise<AltFetch> {
  let url: URL
  try {
    url = new URL(address)
  } catch {
    return { method: 'GET', url: address, status: null, error: 'not an address', crossOrigin: false }
  }
  const fragment = url.hash.slice(1)
  url.hash = ''
  if (url.protocol === 'file:') {
    const fetched: AltFetch = { method: 'FILE', url: url.href, status: null, crossOrigin: false }
    // Only next to a page that is itself a local file, as the browser would open it.
    if (ctx.pageUrl.protocol !== 'file:') return { ...fetched, error: 'a local file linked from a web page: not read' }
    try {
      const path = fileURLToPath(url)
      const info = await stat(path)
      if (!info.isFile()) return { ...fetched, error: 'not a file' }
      fetched.status = 200
      if (info.size > MAX_BODY_BYTES) {
        fetched.bytes = info.size
        return fetched
      }
      fetched.type = /\.html?$/i.test(path) ? 'text/html' : /\.vtt$/i.test(path) ? 'text/vtt' : /\.(txt|md)$/i.test(path) ? 'text/plain' : undefined
      await readBody(ctx, fetched, await readFile(path), fragment)
      ctx.log.push({ method: 'FILE', url: url.href, status: 200 })
      return fetched
    } catch (error) {
      const missing = (error as NodeJS.ErrnoException).code === 'ENOENT'
      ctx.log.push({ method: 'FILE', url: url.href, status: missing ? 404 : null })
      return missing ? { ...fetched, status: 404, error: 'no such file' } : { ...fetched, error: errorMessage(error).slice(0, 120) }
    }
  }
  const headers = (target: URL) => {
    try {
      return headersFor(target.href, [ctx.pageUrl], ctx.browserOptions)
    } catch {
      return undefined
    }
  }
  const head = async (target: URL, from: AltFetch): Promise<AltFetch> => {
    const fetched: AltFetch = { ...from, method: 'HEAD', crossOrigin: true }
    const response = await ctx.context.request.fetch(target.href, { method: 'HEAD', timeout: FETCH_TIMEOUT_MS, maxRedirects: 3, failOnStatusCode: false }).catch((error: unknown) => errorMessage(error))
    if (typeof response === 'string') {
      ctx.log.push({ method: 'HEAD', url: target.href, status: null })
      return { ...fetched, status: null, error: response.slice(0, 120) }
    }
    ctx.log.push({ method: 'HEAD', url: target.href, status: response.status() })
    fetched.status = response.status()
    if (response.url() !== from.url) fetched.final = response.url().slice(0, 500)
    const h = response.headers()
    if (h['content-type']) fetched.type = h['content-type'].slice(0, 80)
    if (h['content-length']) fetched.bytes = Number(h['content-length'])
    await response.dispose().catch(() => undefined)
    return fetched
  }
  const start: AltFetch = { method: 'GET', url: url.href, status: null, crossOrigin: url.origin !== ctx.pageUrl.origin }
  // These requests go around the guard's route, so its rule is kept here: an address that names a destructive action is not sent.
  const refused = (target: URL): AltFetch => ({ ...start, ...(target.href !== url.href ? { final: target.href.slice(0, 500) } : {}), error: `not fetched: its address names "${destructiveAddress(target.href)}"` })
  if (destructiveAddress(url.href)) return refused(url)
  if (url.origin !== ctx.pageUrl.origin) return head(url, start)
  let current = url
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const extra = headers(current)
    const response = await ctx.context.request
      .fetch(current.href, { method: 'GET', timeout: FETCH_TIMEOUT_MS, maxRedirects: 0, failOnStatusCode: false, ...(extra ? { headers: extra } : {}) })
      .catch((error: unknown) => errorMessage(error))
    if (typeof response === 'string') {
      ctx.log.push({ method: 'GET', url: current.href, status: null })
      return { ...start, ...(current.href !== url.href ? { final: current.href } : {}), status: null, error: response.slice(0, 120) }
    }
    const status = response.status()
    ctx.log.push({ method: 'GET', url: current.href, status })
    const location = response.headers().location
    if (status >= 300 && status < 400 && location) {
      await response.dispose().catch(() => undefined)
      let next: URL
      try {
        next = new URL(location, current)
      } catch {
        return { ...start, status, error: 'a redirect to no valid address' }
      }
      next.hash = ''
      if (destructiveAddress(next.href)) return refused(next)
      // Another origin: one HEAD, never a GET.
      if (next.origin !== ctx.pageUrl.origin) return head(next, { ...start, final: next.href.slice(0, 500) })
      current = next
      continue
    }
    const fetched: AltFetch = { ...start, status, ...(current.href !== url.href ? { final: current.href.slice(0, 500) } : {}) }
    const h = response.headers()
    if (h['content-type']) fetched.type = h['content-type'].slice(0, 80)
    const length = Number(h['content-length'] ?? Number.NaN)
    if (status >= 200 && status < 300) {
      if (Number.isFinite(length) && length > MAX_BODY_BYTES) fetched.bytes = length
      else {
        const body = await response.body().catch(() => undefined)
        if (body) await readBody(ctx, fetched, body.length > MAX_BODY_BYTES ? body.subarray(0, MAX_BODY_BYTES) : body, fragment)
      }
    }
    await response.dispose().catch(() => undefined)
    return fetched
  }
  return { ...start, status: null, error: `more than ${MAX_HOPS - 1} redirects` }
}

/**
 * The alternatives of the media the probe listed and of the player frames that show, then what each leads to.
 * `deadline` (Date.now()) bounds the reads: past it, addresses are left unread.
 */
export async function collectAlternatives(
  page: Page,
  context: BrowserContext,
  pageUrl: string,
  anchors: AlternativeAnchor[],
  players: string[],
  browserOptions: BrowserOptions | undefined,
  deadline: number,
): Promise<AlternativesResult> {
  const log: AlternativesResult['fetched'] = []
  await page.evaluate(installAltKit)
  // Click listeners first: what may act on a press of a link that goes nowhere by itself.
  const listeners = await markClickListeners(page)
  const found = await page.evaluate(findAlternatives, { anchors, players, maxNear: MAX_NEAR, maxPage: MAX_PAGE, listeners })
  // Addresses tied to a media are read; those elsewhere only when the page has one media, whose they then are.
  const every = [...found.near.flatMap((n) => n.alternatives), ...(anchors.length === 1 ? found.page : [])]
  // Addresses: the ones tied to a media first.
  let base: URL | undefined
  try {
    base = new URL(page.url())
  } catch {
    base = undefined
  }
  const pageBase = base ?? new URL(pageUrl)
  const addresses = [...new Set(every.flatMap((a) => (a.url ? [a.url] : [])))].slice(0, MAX_FETCHES)
  const ctx: FetchContext = { page, context, pageUrl: pageBase, browserOptions, log }
  const results = new Map<string, AltFetch>()
  await mapLimit(addresses, FETCH_CONCURRENCY, async (address) => {
    if (Date.now() > deadline) return
    results.set(address, await fetchAlternative(ctx, address))
  })
  for (const a of every) {
    const fetched = a.url ? results.get(a.url) : undefined
    if (fetched) a.fetched = fetched
  }
  const byRef = new Map<string, MediaAlternative[]>()
  const mediaByRef = new Map<string, string[]>()
  for (const n of found.near) {
    byRef.set(n.ref, n.alternatives)
    if (n.media.length > 0) mediaByRef.set(n.ref, n.media)
  }
  return { byRef, mediaByRef, page: found.page, fetched: log }
}
