import type { PageSet, SiteCriterion, SiteElement, SiteFinding, SitePageFacts } from '../core/site.ts'
import type { Confidence } from '../core/types.ts'
import { sha256, truncate } from '../core/util.ts'
import type { Locale } from '../i18n.ts'
import { autonymOf } from '../rules/content.ts'
import type { A11yNode, A11ySnapshot } from '../snapshot/schema.ts'
import { type SiteMessage, listPages, sm } from './messages.ts'
import { type Region, addressKey, nameOf, nodeHtml, setIdentity, walkPage } from './page.ts'

/**
 * WCAG 3.2.4 Consistent Identification (AA): components that have the same function on the pages of a set are
 * identified consistently. Rampa reads what each component does from the page code, never from its name, so a
 * difference in names can be found:
 *
 * - a link by where it leads, with what belongs to its page set apart (the page's own address in a share or sign-in
 *   link, `?next=/about`), so the same link on every page has one key;
 * - a field or submit button by its form (its action, or a search form by its landmark, its field or its action);
 * - a language link by the language it leads to (hreflang, lang, or a language's own name as its text);
 * - a share link by the service it shares to;
 * - a button with a stable id by that id, and otherwise by its icon (an svg drawing, an image, an icon class): the
 *   one grouping Rampa is unsure of, since one icon may serve different functions.
 *
 * Components are compared within the part of the page they sit in (header, navigation, footer, sidebar; search,
 * language and share links anywhere), so a logo link and a Home link to the same address are two components.
 * Names are compared folded (case, accents, punctuation, numbers, the words of the page's own title). Names that
 * share no word fail when the function is read from an address, a form, a language or an id; names that share some
 * words, and any difference between buttons grouped only by their icon, need review, and for the icon ones a model
 * may answer whether both name the same function (src/site/judge.ts). The same name for different destinations
 * needs review too. Links inside the main content are left out, except search, language and share links: links in
 * text name their destination in context, which 2.4.4 judges.
 */

/** How a component's function was read: from its address, its form, its language, a stable id, or only its icon. */
export type Basis = 'address' | 'form' | 'language' | 'control' | 'icon'

export type ComponentKind = 'link' | 'relative' | 'search-field' | 'search-submit' | 'language' | 'share' | 'form-field' | 'form-submit' | 'control' | 'icon' | 'print'

export interface IdComponent {
  /** What it does, the same on every page: `link:/pricing`, `search:submit`, `language:pt`, `icon:svg:1a2b3c4d`. */
  fn: string
  basis: Basis
  kind: ComponentKind
  /** For the message: the address, the language, the service, the form's action, the field's name or the id. */
  target: string
  role: string
  /** The part of the page it sits in, with the landmark's label: `banner`, `navigation:Main`, `contentinfo`. */
  place: string
  region: Region
  /** Shown as an image (its name comes from an alt, a label or an svg title) rather than as text. */
  image: boolean
  hidden: boolean
  name: string
  ref: string
  html?: string | undefined
}

export interface IdentificationFacts {
  components: IdComponent[]
  /** Folded words of the title and of the first h1: names that differ only by them are about their own page. */
  title: string[]
  heading: string[]
}

const COMPONENT_ROLES = new Set(['link', 'button', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab', 'switch', 'searchbox', 'textbox', 'combobox', 'spinbutton'])
const FIELD_ROLES = new Set(['searchbox', 'textbox', 'combobox', 'spinbutton'])
const CHROME: ReadonlySet<Region> = new Set(['banner', 'navigation', 'contentinfo', 'complementary'])

export const SEARCH_ACTION = /(?:^|\/)(?:search|busca|buscar|pesquisa|pesquisar|procurar|buscador|recherche|suche|zoeken|ricerca)(?:\/|$|\?|\.)/i
export const SEARCH_NAMES: ReadonlySet<string> = new Set(['q', 's', 'query', 'search', 'search_query', 'searchterm', 'search_term', 'keyword', 'keywords', 'k', 'term', 'busca', 'pesquisa', 'termo', 'buscar'])
const SHARE =
  /^https?:\/\/(?:www\.)?(?:twitter\.com\/(?:intent\/tweet|share)|x\.com\/intent\/(?:tweet|post)|facebook\.com\/(?:sharer|share\.php|dialog\/share)|linkedin\.com\/(?:sharing\/share-offsite|shareArticle)|api\.whatsapp\.com\/send|wa\.me\/?\?|web\.whatsapp\.com\/send|t\.me\/share|telegram\.me\/share|reddit\.com\/submit|pinterest\.[a-z.]+\/pin\/create|bsky\.app\/intent\/compose|threads\.net\/intent\/post|tumblr\.com\/widgets\/share|getpocket\.com\/save)/i
/** Icon classes of the common icon sets, without their size and style modifiers. */
const ICON_CLASS = /^(?:fa|fas|far|fal|fab|fa-solid|fa-regular|bi|icon|glyphicon|ri|ti|mdi|lucide|feather|ph|uil|las|icofont|octicon|codicon|gg|bx|bxs)-[\w-]+$/
const ICON_MODIFIER = /-(?:lg|xs|sm|xl|fw|\dx|spin|pulse|border|pull-\w+|solid|regular|light|thin|brands|duotone|fill|outline|sharp)$/
/** An id written by a person, not generated: no long runs of digits, no framework prefixes. */
const STABLE_ID = /^[A-Za-z][\w-]{2,40}$/
const GENERATED_ID = /\d{3,}|^(?:radix|headlessui|react|mui|ember|ext-gen|yui|ui-id|tippy|popover|downshift|aria|rc-|swiper|slick|glide|splide)[-_]?|[a-f0-9]{8,}/i
/**
 * Links that go somewhere relative to the page (folded): "Next", "Previous: Intro", "« Older posts", "Voltar", "Up". Their
 * destination changes from page to page while their function does not, so they are keyed by that word.
 */
const RELATIVE =
  /^(?:[«‹←<]+\s*)?(next|previous|prev|back|up|forward|older|newer|first|last|proximo|proxima|anterior|seguinte|voltar|siguiente|atras|primeiro|primeira|ultimo|ultima|primero|suivant|precedent)\b|^[«‹←<]+$|^[»›→>]+$/
/** Query parameters that track where a visit came from: they change nothing of the function. */
const TRACKING = /^(?:utm_\w+|ref|ref_src|source|fbclid|gclid|mc_cid|mc_eid|_ga)$/i

const attribute = (node: A11yNode, name: string): string | undefined => {
  const value = (node.native.attributes as Record<string, unknown> | undefined)?.[name]
  return typeof value === 'string' ? value : undefined
}

/** Lowercase, without accents. */
export const fold = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()

export const wordsOf = (value: string): string[] => fold(value).split(/[^\p{L}\p{N}]+/u).filter(Boolean)

/** Two names that differ only in case, accents, spaces or punctuation are one. */
export const canonicalName = (name: string) => wordsOf(name).join(' ')

/**
 * Where a link leads, with what belongs to its page set apart: an address in its query (a return address, the page
 * to share) becomes `{url}`, a fragment of the page itself `{page}#…`, and, on another site, the page's own path (an
 * "Edit this page" link) `{page}`. Tracking parameters are dropped.
 */
export function functionAddress(href: string, page: string): string | undefined {
  const raw = href.trim()
  const key = addressKey(raw, page)
  if (!key) return undefined
  let url: URL
  let here: URL
  try {
    url = new URL(raw, page)
    here = new URL(page)
  } catch {
    return key
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return key
  const params = new URLSearchParams()
  for (const [name, value] of url.searchParams) {
    if (TRACKING.test(name)) continue
    params.append(name, /^(?:https?:\/\/|\/)/i.test(value) ? '{url}' : value)
  }
  const search = params.size > 0 ? `?${params.toString().replaceAll('%7Burl%7D', '{url}')}` : ''
  const trim = (path: string) => path.replace(/\/+$/, '') || '/'
  const samePage = url.origin === here.origin && trim(url.pathname) === trim(here.pathname)
  let path = trim(url.pathname)
  if (url.origin !== here.origin) {
    const own = trim(here.pathname).replace(/^\//, '')
    const decoded = safeDecode(path)
    if (own.length >= 3 && decoded.includes(own)) path = decoded.replace(own, '{page}')
  }
  const hash = url.hash.length > 1 ? url.hash : ''
  if (samePage && hash) return `{page}${hash}`
  return `${url.origin === here.origin ? '' : url.origin}${path}${search}${hash}`
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function* descendants(node: A11yNode): Generator<A11yNode> {
  for (const child of node.children) {
    yield child
    yield* descendants(child)
  }
}

/** Shown only as an image: no text of its own, and an image, an svg or an image button inside. */
function shownAsImage(node: A11yNode): boolean {
  if (node.native.tag === 'input') return attribute(node, 'type')?.toLowerCase() === 'image'
  let text = node.text?.trim() ?? ''
  let graphic = false
  for (const inner of descendants(node)) {
    if (inner.text) text += inner.text.trim()
    if (inner.native.tag === 'img' || inner.native.tag === 'svg' || inner.role === 'img' || inner.role === 'graphics-document') graphic = true
  }
  return graphic && text === ''
}

/** The icon a button is drawn with: an svg's drawing, an image's address, an icon font's class or ligature. */
function iconOf(node: A11yNode, page: string): string | undefined {
  for (const inner of [node, ...descendants(node)]) {
    if (typeof inner.native.svgHash === 'string') return `svg:${inner.native.svgHash}`
    if (inner.native.tag === 'img') {
      const src = attribute(inner, 'src')
      if (src && !src.startsWith('data:')) return `img:${addressKey(src, page) ?? src}`
    }
    const classes = (attribute(inner, 'class') ?? '').split(/\s+/)
    const icon = classes.find((token) => ICON_CLASS.test(token) && !ICON_MODIFIER.test(token))
    if (icon) return `class:${icon}`
    if (classes.some((token) => /^material-(?:icons|symbols)/.test(token)) && inner.text?.trim()) return `material:${inner.text.trim()}`
  }
  return undefined
}

/** The language a link leads to: its hreflang or lang, a language's own name as its text, or a code its address shares. */
function languageOf(node: A11yNode, name: string, href: string | undefined): string | undefined {
  const declared = attribute(node, 'hreflang') ?? node.lang ?? [...descendants(node)].find((inner) => inner.lang)?.lang
  if (declared?.trim()) return declared.trim().toLowerCase().split(/[-_]/)[0]
  const autonym = autonymOf(name)
  if (autonym) return autonym.toLowerCase().split('-')[0]
  const code = /^([a-z]{2})(?:[-_][a-z]{2})?$/i.exec(name.trim())?.[1]?.toLowerCase()
  if (code && href) {
    try {
      const url = new URL(href, 'https://site.invalid/')
      const parts = [...url.pathname.split('/'), ...url.hostname.split('.'), ...url.searchParams.values()].map((part) => part.toLowerCase().split(/[-_]/)[0])
      if (parts.includes(code)) return code
    } catch {
      return undefined
    }
  }
  return undefined
}

interface FormInfo {
  node: A11yNode
  /** Where it sends, the same from every page; `{page}` when it sends to the page itself. */
  action: string
  search: boolean
}

function formInfo(form: A11yNode, page: string, inSearch: boolean): FormInfo {
  const action = attribute(form, 'action')?.trim() ?? ''
  const key = action === '' ? '{page}' : (functionAddress(action, page) ?? action)
  const fields = [...descendants(form)].filter((inner) => FIELD_ROLES.has(inner.role))
  const search =
    inSearch ||
    form.role === 'search' ||
    SEARCH_ACTION.test(action) ||
    fields.some((field) => field.role === 'searchbox' || SEARCH_NAMES.has((attribute(field, 'name') ?? '').toLowerCase()))
  return { node: form, action: key, search }
}

function isSubmit(node: A11yNode): boolean {
  const type = attribute(node, 'type')?.toLowerCase()
  if (node.native.tag === 'input') return type === 'submit' || type === 'image'
  return node.native.tag === 'button' && (type === undefined || type === 'submit')
}

interface Place {
  region: Region
  place: string
  hidden: boolean
  inMain: boolean
  /** The page has a main landmark, so what is outside every landmark is outside the main content too. */
  hasMain: boolean
}

function componentOf(node: A11yNode, page: string, at: Place, form: FormInfo | undefined, inSearch: boolean): IdComponent | undefined {
  if (!COMPONENT_ROLES.has(node.role)) return undefined
  const name = nameOf(node)
  if (!name) return undefined
  // Outside the main content: a header, navigation, footer or sidebar, or outside every landmark of a page that has a main one.
  // On a page with no main landmark, what is outside the landmarks may be its content, whose links name their destination in context.
  const chrome = CHROME.has(at.region) || (at.region === 'none' && at.hasMain && !at.inMain)
  const base = {
    role: node.role,
    place: at.place,
    region: at.region,
    image: shownAsImage(node),
    hidden: at.hidden,
    name: truncate(name, 120),
    ref: node.ref,
    html: nodeHtml(node),
  }
  const searchForm = form?.search || inSearch
  if (FIELD_ROLES.has(node.role)) {
    if (searchForm || node.role === 'searchbox') return { ...base, fn: 'search:field', basis: 'form', kind: 'search-field', target: '' }
    if (!form || !chrome) return undefined
    const field = attribute(node, 'name') || attribute(node, 'type') || node.role
    return { ...base, fn: `form:${form.action}|field:${field.toLowerCase()}`, basis: 'form', kind: 'form-field', target: `${form.action}|${field}` }
  }
  const href = attribute(node, 'href')
  const linkTarget = href !== undefined && !/^\s*(?:#\s*$|javascript:|$)/i.test(href) ? href : undefined
  if (linkTarget) {
    const language = languageOf(node, name, linkTarget)
    if (language) return { ...base, fn: `language:${language}`, basis: 'language', kind: 'language', target: language }
    let absolute: URL | undefined
    try {
      absolute = new URL(linkTarget, page)
    } catch {
      absolute = undefined
    }
    if (absolute && SHARE.test(absolute.href)) {
      const service = `${absolute.hostname.replace(/^www\./, '')}${absolute.pathname.replace(/\/+$/, '')}`
      return { ...base, fn: `share:${service}`, basis: 'address', kind: 'share', target: absolute.hostname.replace(/^www\./, '') }
    }
    if (absolute?.protocol === 'mailto:' && absolute.pathname === '' && /(?:^|[?&])(?:body|subject)=/i.test(absolute.search)) {
      return { ...base, fn: 'share:mailto', basis: 'address', kind: 'share', target: 'e-mail' }
    }
    if (!chrome) return undefined
    // "Next" and "Previous" do something relative to the page: the next page's link is "previous" on the page after it.
    const relative = RELATIVE.exec(fold(name).trim())
    if (relative) {
      const word = relative[1] ?? fold(name).trim()
      return { ...base, fn: `relative:${word}`, basis: 'address', kind: 'relative', target: word }
    }
    const key = functionAddress(linkTarget, page)
    if (!key) return undefined
    return { ...base, fn: `link:${key}`, basis: 'address', kind: 'link', target: key }
  }
  if (href !== undefined && /^\s*javascript:\s*(?:window\.)?print\(\)/i.test(href)) return { ...base, fn: 'print', basis: 'control', kind: 'print', target: '' }
  // A button: what its form does, a stable id, or its icon.
  if (searchForm && (isSubmit(node) || node.role === 'button')) return { ...base, fn: 'search:submit', basis: 'form', kind: 'search-submit', target: '' }
  if (!chrome) return undefined
  if (form && isSubmit(node)) return { ...base, fn: `form:${form.action}|submit`, basis: 'form', kind: 'form-submit', target: form.action }
  const id = attribute(node, 'id')
  if (id && STABLE_ID.test(id) && !GENERATED_ID.test(id)) return { ...base, fn: `control:#${id}`, basis: 'control', kind: 'control', target: `#${id}` }
  const icon = iconOf(node, page)
  if (icon) return { ...base, fn: `icon:${icon}`, basis: 'icon', kind: 'icon', target: icon }
  return undefined
}

export function identificationFacts(snapshot: A11ySnapshot): IdentificationFacts {
  const page = snapshot.target
  const visits = walkPage(snapshot)
  const byNode = new Map(visits.map((visit) => [visit.node, visit]))
  const hasMain = visits.some((visit) => visit.region === 'main')
  // The label of the outermost landmark around each node: two navigation landmarks are two places.
  const components: IdComponent[] = []
  let heading: string | undefined
  const walk = (node: A11yNode, place: string, form: FormInfo | undefined, inSearch: boolean): void => {
    const visit = byNode.get(node)
    if (!visit) return
    let here = place
    if (place === '' && visit.region !== 'none' && visit.region !== 'main') here = visit.region === 'navigation' ? `navigation:${fold(nameOf(node))}` : visit.region
    const search = inSearch || node.role === 'search' || node.native.tag === 'search'
    const nowForm = node.role === 'form' || node.native.tag === 'form' ? formInfo(node, page, search) : form
    if (heading === undefined && node.native.tag === 'h1' && !visit.hidden) heading = nameOf(node)
    const component = componentOf(node, page, { region: visit.region, place: here || visit.region, hidden: visit.hidden, inMain: visit.inMain, hasMain }, nowForm, search)
    if (component) {
      components.push(component)
      return
    }
    // What is inside a link or a button is part of it.
    if (COMPONENT_ROLES.has(node.role)) return
    for (const child of node.children) walk(child, here, nowForm, search)
  }
  walk(snapshot.root, '', undefined, false)
  return { components, title: wordsOf(snapshot.title ?? ''), heading: wordsOf(heading ?? '') }
}

/** Words that do not tell two names apart. */
const STOP = new Set([
  'a', 'an', 'the', 'to', 'of', 'in', 'on', 'at', 'for', 'and', 'or', 'your', 'my', 'our', 'this', 'is',
  'o', 'os', 'as', 'um', 'uma', 'de', 'da', 'do', 'das', 'dos', 'e', 'em', 'no', 'na', 'nos', 'nas', 'para', 'seu', 'sua', 'meu', 'minha', 'ao',
  'el', 'la', 'los', 'las', 'y', 'en', 'del', 'al', 'tu', 'su', 'mi', 'un', 'una',
])

export type Relation = 'same' | 'numbers' | 'own' | 'contains' | 'overlap' | 'disjoint'

/**
 * How two names of the same component relate. `same`, `numbers` (only counts or page numbers differ: "Cart (2)",
 * "Go to page 4") and `own` (only words of each page's own title or heading differ) are consistent; `contains` and
 * `overlap` share words; `disjoint` share none.
 */
export function relation(a: string, b: string, ownA: ReadonlySet<string> = new Set(), ownB: ReadonlySet<string> = new Set()): Relation {
  const wa = wordsOf(a)
  const wb = wordsOf(b)
  if (wa.join('') === wb.join('')) return 'same'
  const numbers = (words: string[]) => words.map((word) => word.replace(/\d+/g, '#')).join('')
  if (numbers(wa) === numbers(wb)) return 'numbers'
  const strip = (words: string[], own: ReadonlySet<string>) => words.filter((word) => !own.has(word) && !/^\d+$/.test(word)).join(' ')
  if ((ownA.size > 0 || ownB.size > 0) && strip(wa, ownA) === strip(wb, ownB)) return 'own'
  const ca = new Set(wa.filter((word) => !STOP.has(word) && !/^\d+$/.test(word)))
  const cb = new Set(wb.filter((word) => !STOP.has(word) && !/^\d+$/.test(word)))
  const shared = [...ca].filter((word) => cb.has(word)).length
  if (shared === 0) return 'disjoint'
  return shared === ca.size || shared === cb.size ? 'contains' : 'overlap'
}

/** Search, language and share links are compared wherever they are; the rest within their part of the page. */
function groupKey(component: IdComponent): string {
  const anywhere = component.kind === 'search-field' || component.kind === 'search-submit' || component.kind === 'language' || component.kind === 'share' || component.kind === 'print'
  return `${component.fn}@${anywhere ? '*' : component.place}@${component.image ? 'image' : 'text'}`
}

interface Entry {
  page: number
  component: IdComponent
}

const MAX_FINDINGS = 50

/** WCAG 3.2.4: the same function has the same name on every page of the set. */
export const consistentIdentification: SiteCriterion<IdentificationFacts> = {
  id: '3.2.4',
  level: 'AA',
  name: { en: 'Consistent Identification', 'pt-BR': 'Identificação consistente' },
  version: '1',
  maturity: 'experimental',
  facts: identificationFacts,
  compare(set, pages, locale) {
    // Words every page's title has (the site's name) are not a page's own.
    const titles = pages.map((page) => new Set(page.facts.title))
    const common = new Set([...(titles[0] ?? [])].filter((word) => titles.every((title) => title.has(word))))
    const own = pages.map((page) => new Set([...page.facts.title, ...page.facts.heading].filter((word) => !common.has(word))))

    const groups = new Map<string, Map<number, IdComponent[]>>()
    pages.forEach((page, index) => {
      for (const component of page.facts.components) {
        const key = groupKey(component)
        const byPage = groups.get(key) ?? new Map<number, IdComponent[]>()
        byPage.set(index, [...(byPage.get(index) ?? []), component])
        groups.set(key, byPage)
      }
    })

    const findings: SiteFinding[] = []
    let compared = 0
    for (const [key, byPage] of groups) {
      const entries: Entry[] = []
      for (const [page, list] of byPage) {
        // A page with two names for one key (a menu and its copy worded otherwise) is ambiguous: which one is the component?
        if (new Set(list.map((component) => canonicalName(component.name))).size !== 1) continue
        entries.push({ page, component: list.find((component) => !component.hidden) ?? (list[0] as IdComponent) })
      }
      if (entries.length < 2) continue
      compared++
      const variants = variantsOf(entries, (entry) => canonicalName(entry.component.name))
      if (variants.length < 2) continue
      // A different name on every page names something of each page ("Go to page 4", "Go to page 5"), which is consistent.
      if (entries.length >= 3 && variants.length === entries.length) continue
      const major = variants[0] as Entry[]
      for (const minor of variants.slice(1)) {
        const finding = nameFinding(key, major, minor, set, pages, own, locale)
        if (finding) findings.push(finding)
      }
    }
    findings.push(...sameNameFindings(groups, set, pages, locale))
    return { compared, findings: findings.slice(0, MAX_FINDINGS) }
  },
}

/** Entries grouped by a key, the largest group first, then in page order. */
function variantsOf<T extends { page: number }>(entries: readonly T[], keyOf: (entry: T) => string): T[][] {
  const groups = new Map<string, T[]>()
  for (const entry of entries) groups.set(keyOf(entry), [...(groups.get(keyOf(entry)) ?? []), entry])
  return [...groups.values()].sort((a, b) => b.length - a.length || (a[0] as T).page - (b[0] as T).page)
}

const KIND_SUBJECT: Record<ComponentKind, SiteMessage> = {
  link: 'idLink',
  relative: 'idRelative',
  'search-field': 'idSearchField',
  'search-submit': 'idSearchSubmit',
  language: 'idLanguage',
  share: 'idShare',
  'form-field': 'idFormField',
  'form-submit': 'idFormSubmit',
  control: 'idControl',
  icon: 'idIcon',
  print: 'idPrint',
}

const PLACE_WORD: Partial<Record<Region, SiteMessage>> = {
  banner: 'inHeader',
  navigation: 'inNavigation',
  contentinfo: 'inFooter',
  complementary: 'inSidebar',
  none: 'outsideMain',
}

function languageName(code: string, locale: Locale): string {
  try {
    return new Intl.DisplayNames([locale], { type: 'language', fallback: 'code' }).of(code) ?? code
  } catch {
    return code
  }
}

/** An address as a person reads it: `{page}#main` is "this page (#main)", an address in the query is "…". */
export function showTarget(target: string, locale: Locale): string {
  const shown = target.replaceAll('{url}', '…')
  if (!shown.startsWith('{page}')) return shown.replaceAll('{page}', '…')
  const rest = shown.slice('{page}'.length)
  return `${sm(locale, 'thisPage')}${rest ? ` (${rest})` : ''}`
}

/** "The link to /pricing in the header", "The search button", "The link to the Portuguese version". */
export function describeComponent(component: IdComponent, locale: Locale): string {
  const target =
    component.kind === 'language'
      ? languageName(component.target, locale)
      : component.kind === 'form-field'
        ? (component.target.split('|')[1] ?? '')
        : component.kind === 'link' || component.kind === 'form-submit'
          ? showTarget(component.target, locale)
          : component.target
  const form = component.kind === 'form-field' ? showTarget(component.target.split('|')[0] ?? '', locale) : ''
  const subject = sm(locale, KIND_SUBJECT[component.kind], { target, form })
  const kept = component.kind === 'link' || component.kind === 'relative' || component.kind === 'form-field' || component.kind === 'form-submit' || component.kind === 'control' || component.kind === 'icon'
  const place = kept ? PLACE_WORD[component.region] : undefined
  const image = component.image && (component.kind === 'link' || component.kind === 'language') ? ` ${sm(locale, 'shownAsImage')}` : ''
  return `${subject}${image}${place ? ` ${sm(locale, place)}` : ''}`
}

const quoted = (name: string) => `“${name}”`

function citeElements(groups: ReadonlyArray<readonly Entry[]>, pages: ReadonlyArray<SitePageFacts<IdentificationFacts>>): SiteElement[] {
  const elements: SiteElement[] = []
  for (const group of groups) {
    for (const entry of group.slice(0, 3)) {
      const page = pages[entry.page] as SitePageFacts<IdentificationFacts>
      elements.push({ page: page.url, ref: entry.component.ref, name: entry.component.name, html: entry.component.html })
    }
  }
  return elements.slice(0, 24)
}

function nameFinding(
  key: string,
  major: Entry[],
  minor: Entry[],
  set: PageSet,
  pages: ReadonlyArray<SitePageFacts<IdentificationFacts>>,
  own: ReadonlyArray<ReadonlySet<string>>,
  locale: Locale,
): SiteFinding | undefined {
  const a = (major[0] as Entry).component
  const b = (minor[0] as Entry).component
  // Each page's own words are its own: compare the minority's names one by one with the majority's.
  const relations = minor.map((entry) => relation(a.name, entry.component.name, own[(major[0] as Entry).page], own[entry.page]))
  const differs = relations.filter((value) => value !== 'same' && value !== 'numbers' && value !== 'own')
  if (differs.length === 0) return undefined
  const rel: Relation = differs.includes('disjoint') ? 'disjoint' : differs.includes('overlap') ? 'overlap' : 'contains'
  const urlsOf = (entries: readonly Entry[]) => entries.map((entry) => (pages[entry.page] as SitePageFacts<IdentificationFacts>).url)
  const majorPages = urlsOf(major)
  const minorPages = urlsOf(minor)
  const tie = major.length === minor.length
  const flagged = tie ? [...majorPages, ...minorPages] : minorPages
  const subject = describeComponent(a, locale)
  const sure = a.basis !== 'icon'
  const named = tie
    ? sm(locale, 'idNamedTie', { subject, a: quoted(a.name), b: quoted(b.name), pages: listPages(flagged, locale) })
    : sm(locale, 'idNamed', { subject, a: quoted(a.name), pagesA: listPages(majorPages, locale), b: quoted(b.name), pagesB: listPages(minorPages, locale) })
  const fix = sm(locale, 'idFix')
  let status: SiteFinding['status']
  let message: string
  let question: SiteFinding['question']
  if (sure && rel === 'disjoint') {
    status = 'failure'
    message = `${named} ${fix}`
  } else if (sure) {
    status = 'review'
    message = `${named} ${sm(locale, 'idReviewPartly')}`
  } else {
    status = 'review'
    message = `${named} ${sm(locale, 'idReviewIcon')}`
    const place = PLACE_WORD[a.region]
    question = {
      kind: 'same-function',
      names: [
        { name: a.name, page: majorPages[0] as string, role: a.role },
        { name: b.name, page: minorPages[0] as string, role: b.role },
      ],
      context: `${place ? sm('en', place) : 'on the page'}, drawn with the same icon`,
      confirmed:
        rel === 'disjoint'
          ? { status: 'failure', message: `${named} ${fix}` }
          : { status: 'review', message: `${named} ${sm(locale, 'idReviewPartly')}` },
    }
  }
  const observed = [
    { pages: majorPages, order: [a.name] },
    { pages: minorPages, order: [b.name] },
  ]
  const confidence: Confidence = status === 'failure' ? (tie ? 'medium' : 'high') : 'low'
  return {
    fingerprint: sha256(['3.2.4', setIdentity(set), key, ...[canonicalName(a.name), canonicalName(b.name)].sort()].join('|')).slice(0, 12),
    criterion: '3.2.4',
    level: 'AA',
    source: 'site',
    status,
    set: set.id,
    subject,
    message,
    evidence: observed.map((entry) => sm(locale, 'idOn', { name: quoted(entry.order[0] as string), pages: listPages(entry.pages, locale) })).join('\n'),
    pages: flagged,
    comparedWith: tie ? [] : majorPages,
    items: [a.name, b.name],
    elements: citeElements([minor, major], pages),
    observed,
    confidence,
    experimental: consistentIdentification.maturity === 'experimental',
    ...(question ? { question } : {}),
  }
}

/**
 * The same name in the same place leading somewhere else on some pages: maybe two functions under one name. Only for
 * links whose destination most pages agree on; a name whose destination changes on every page ("Next", "Edit")
 * names a function relative to its page, which is consistent.
 */
function sameNameFindings(
  groups: ReadonlyMap<string, ReadonlyMap<number, readonly IdComponent[]>>,
  set: PageSet,
  pages: ReadonlyArray<SitePageFacts<IdentificationFacts>>,
  locale: Locale,
): SiteFinding[] {
  const byName = new Map<string, Map<number, IdComponent[]>>()
  for (const byPage of groups.values()) {
    for (const [page, list] of byPage) {
      for (const component of list) {
        if (component.kind !== 'link' || component.target.startsWith('{page}')) continue
        const key = `${canonicalName(component.name)}@${component.place}@${component.image ? 'image' : 'text'}`
        const entries = byName.get(key) ?? new Map<number, IdComponent[]>()
        entries.set(page, [...(entries.get(page) ?? []), component])
        byName.set(key, entries)
      }
    }
  }
  const findings: SiteFinding[] = []
  for (const [key, byPage] of byName) {
    const entries: Entry[] = []
    for (const [page, list] of byPage) {
      if (new Set(list.map((component) => component.fn)).size !== 1) continue
      entries.push({ page, component: list[0] as IdComponent })
    }
    if (entries.length < 3) continue
    const variants = variantsOf(entries, (entry) => entry.component.fn)
    const major = variants[0] as Entry[]
    if (variants.length < 2 || major.length < 2) continue
    for (const minor of variants.slice(1)) {
      // Every other page links somewhere else: a destination relative to the page.
      if (minor.length >= major.length) continue
      const a = (major[0] as Entry).component
      const b = (minor[0] as Entry).component
      const urlsOf = (list: readonly Entry[]) => list.map((entry) => (pages[entry.page] as SitePageFacts<IdentificationFacts>).url)
      const majorPages = urlsOf(major)
      const minorPages = urlsOf(minor)
      const where = PLACE_WORD[a.region]
      const message = sm(locale, 'idSameName', {
        name: quoted(a.name),
        place: where ? sm(locale, where) : '',
        a: showTarget(a.target, locale),
        pagesA: listPages(majorPages, locale),
        b: showTarget(b.target, locale),
        pagesB: listPages(minorPages, locale),
      }).replace(/ {2,}/g, ' ')
      const observed = [
        { pages: majorPages, order: [showTarget(a.target, locale)] },
        { pages: minorPages, order: [showTarget(b.target, locale)] },
      ]
      findings.push({
        fingerprint: sha256(['3.2.4', setIdentity(set), 'same-name', key, ...[a.fn, b.fn].sort()].join('|')).slice(0, 12),
        criterion: '3.2.4',
        level: 'AA',
        source: 'site',
        status: 'review',
        set: set.id,
        subject: sm(locale, 'idSameNameSubject', { name: quoted(a.name) }),
        message,
        evidence: observed.map((entry) => sm(locale, 'idLeadsTo', { target: entry.order[0] as string, pages: listPages(entry.pages, locale) })).join('\n'),
        pages: minorPages,
        comparedWith: majorPages,
        items: [a.target, b.target],
        elements: citeElements([minor, major], pages),
        observed,
        confidence: 'low',
        experimental: consistentIdentification.maturity === 'experimental',
      })
    }
  }
  return findings
}
