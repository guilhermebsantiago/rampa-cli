import type { Patch } from '../core/types.ts'
import { normalizeForMatch, truncate } from '../core/util.ts'
import { attributesOf, escapeHtml, isHidden, startTagOf, subtreeText, withAttribute } from '../criteria/shared.ts'
import type { Locale } from '../i18n.ts'
import type { A11yNode, A11ySnapshot } from '../snapshot/schema.ts'
import { inheritedLang, walkTree } from '../snapshot/tree.ts'
import type { Hit, RuleCheck, Text } from './types.ts'

/**
 * Content rules (wave A3 of docs/plans/wcag-coverage.md): failures a rule can name with no model,
 * because the text itself gives them away. Each list is short on purpose: a rule reports only what
 * no page means on purpose, and leaves every other weak alternative, title or heading to judgment.
 */

const UNDERSTANDING = 'https://www.w3.org/WAI/WCAG22/Understanding/'

const say = (text: Text, locale: Locale) => text[locale]

// 1.1.1, F30: a text alternative that is not an alternative.

/** Words a page uses as an alternative only when nobody wrote one; a trailing number ("image 3", "foto_01") counts too. */
const PLACEHOLDER_ALT = new Set([
  'image', 'img', 'imagem', 'imagen', 'photo', 'foto', 'picture', 'pic', 'untitled', 'sem título', 'placeholder',
  'spacer', 'thumbnail', 'thumb', 'alt', 'alt text', 'texto alternativo', 'image placeholder', 'insert image here',
  'image description', 'descrição da imagem', 'graphic',
])

const IMAGE_EXTENSION = /\.(png|jpe?g|gif|webp|svg|avif|bmp|tiff?|heic|ico)$/i
/** Names cameras, phones and screenshot tools give files: IMG_2034, DSC01234, PXL_20230812_142233, Screenshot 2023-08-12. */
const CAMERA_NAME = /^(img|dsc[nf]?|dcim|pxl|mvimg|gopr|dji|cimg|pict|wp)[ _-]?\d{3,}[\w-]*$/i
const SCREENSHOT_NAME = /^(screenshot|screen shot|captura de tela|whatsapp image)\b.*\d{4}/i

export type PlaceholderKind = 'file-name' | 'camera-name' | 'placeholder-word' | 'same-as-file'

/**
 * Why an alternative is a placeholder, or undefined. Stricter than `looksLikePlaceholder` in the 1.1.1
 * module, which only flags candidates for the model: "logo" or "banner" may be all an image needs, so
 * they stay with judgment, and a file name must look like one (no spaces, an extension or a separator).
 */
export function placeholderAlt(alt: string, src?: string): PlaceholderKind | undefined {
  const value = alt.trim().replace(/\s+/g, ' ')
  if (value === '') return undefined
  if (!/\s/.test(value) && (IMAGE_EXTENSION.test(value) || /^(https?:\/\/|\.{0,2}\/)\S+$/i.test(value))) return 'file-name'
  if (CAMERA_NAME.test(value) || SCREENSHOT_NAME.test(value)) return 'camera-name'
  const word = normalizeForMatch(value).replace(/[\s_-]*\d+$/, '').trim()
  if (PLACEHOLDER_ALT.has(word)) return 'placeholder-word'
  const file = fileStem(src)
  if (file && !/\s/.test(value) && /[_-]/.test(value) && normalizeForMatch(file) === normalizeForMatch(value)) return 'same-as-file'
  return undefined
}

function fileStem(src: string | undefined): string | undefined {
  if (!src || src.startsWith('data:')) return undefined
  const file = src.split(/[?#]/)[0]?.split('/').pop()
  return file ? file.replace(/\.[a-z0-9]+$/i, '') : undefined
}

function isImage(node: A11yNode): boolean {
  const attributes = attributesOf(node)
  if (node.role === 'presentation' || node.role === 'none') return false
  return node.native.tag === 'img' || (node.native.tag === 'input' && attributes.type?.toLowerCase() === 'image') || (node.role === 'img' && node.native.tag !== 'svg')
}

const PLACEHOLDER_REASONS: Record<PlaceholderKind, Text> = {
  'file-name': { en: 'is a file name', 'pt-BR': 'é um nome de arquivo' },
  'camera-name': { en: 'is the name a camera or a screenshot tool gave the file', 'pt-BR': 'é o nome que a câmera ou a ferramenta de captura deu ao arquivo' },
  'placeholder-word': { en: 'is a placeholder, not a description', 'pt-BR': 'é um texto provisório, não uma descrição' },
  'same-as-file': { en: "repeats the image's file name", 'pt-BR': 'repete o nome do arquivo da imagem' },
}

export const placeholderAltRule: RuleCheck = {
  id: 'rampa/placeholder-alt',
  version: '1',
  criteria: ['1.1.1'],
  maturity: 'experimental',
  surfaces: ['web'],
  act: [],
  engineRules: ['image-alt', 'input-image-alt', 'role-img-alt'],
  help: {
    en: 'A text alternative must describe the image, not name its file or hold a placeholder (F30)',
    'pt-BR': 'O texto alternativo precisa descrever a imagem, não nomear o arquivo nem ser um texto provisório (F30)',
  },
  helpUrl: 'https://www.w3.org/WAI/WCAG22/Techniques/failures/F30',
  run(snapshot) {
    const hits: Hit[] = []
    let applicable = 0
    for (const node of walkTree(snapshot.root)) {
      if (!isImage(node) || isHidden(node)) continue
      const alt = node.name?.trim() ?? ''
      if (alt === '') continue
      applicable++
      const src = attributesOf(node).src
      const kind = placeholderAlt(alt, src)
      if (!kind) continue
      const attribute = attributesOf(node).alt !== undefined ? 'alt' : 'aria-label'
      hits.push({ ref: node.ref, outcome: 'fail', subject: alt, evidence: `${attribute}="${alt}"`, facts: { alt, kind }, html: startTagOf(node) })
    }
    return { hits, applicable }
  },
  message(hit, locale) {
    const reason = say(PLACEHOLDER_REASONS[hit.facts.kind as PlaceholderKind], locale)
    return locale === 'pt-BR'
      ? `O texto alternativo "${hit.facts.alt}" ${reason}: o leitor de tela lê isso no lugar da imagem. Descreva o que a imagem transmite, ou use alt="" se ela for decorativa.`
      : `The text alternative "${hit.facts.alt}" ${reason}: a screen reader reads it in place of the image. Describe what the image conveys, or use alt="" if it is decorative.`
  },
}

// 2.4.2: a title a framework or an editor wrote, which nobody changed.

const DEFAULT_TITLES = new Set([
  'react app', 'vite app', 'vite + ts', 'vite + react', 'vite + react + ts', 'vite + vue', 'vite + vue + ts', 'vite + svelte',
  'vite + svelte + ts', 'vite + preact', 'vite + preact + ts', 'vite + lit', 'vite + lit + ts', 'vite + solid', 'vite + solid + ts',
  'vite + qwik', 'vite + qwik + ts', 'create next app', 'svelte app', 'ionic app', 'document', 'untitled', 'untitled document',
  'untitled page', 'untitled-1', 'new page', 'page title', 'insert title here', 'your title here', 'index.html', 'index.htm',
  'documento', 'sem título', 'documento sem título', 'página sem título', 'título da página', 'sin título', 'documento sin título',
])

/** Lowercased, with the spacing collapsed: "Vite + React + TS" becomes "vite + react + ts". */
export function defaultTitle(title: string): boolean {
  return DEFAULT_TITLES.has(title.trim().replace(/\s+/g, ' ').toLowerCase())
}

export const defaultTitleRule: RuleCheck = {
  id: 'rampa/default-title',
  page: true,
  version: '1',
  criteria: ['2.4.2'],
  maturity: 'experimental',
  surfaces: ['web'],
  act: [],
  engineRules: ['document-title'],
  help: {
    en: 'The page title must describe the page, not be the default a framework or editor wrote',
    'pt-BR': 'O título da página precisa descrever a página, não ser o padrão que um framework ou editor escreveu',
  },
  helpUrl: `${UNDERSTANDING}page-titled.html`,
  run(snapshot) {
    const title = snapshot.title?.trim() ?? ''
    if (title === '') return { hits: [], applicable: 0 }
    if (!defaultTitle(title)) return { hits: [], applicable: 1 }
    // The page's only h1, when it has one, is a better title than the default; a person still checks it.
    const h1s = [...walkTree(snapshot.root)].filter((node) => node.native.tag === 'h1' && !isHidden(node) && node.name?.trim())
    const heading = h1s.length === 1 ? h1s[0]?.name?.trim() : undefined
    const facts: Hit['facts'] = { title }
    if (heading && heading.length <= 70 && !defaultTitle(heading)) facts.heading = heading
    return { hits: [{ ref: snapshot.root.ref, outcome: 'fail', subject: title, evidence: `<title>${title}</title>`, facts }], applicable: 1 }
  },
  message(hit, locale) {
    return locale === 'pt-BR'
      ? `O título da página "${hit.facts.title}" é o padrão de um framework ou editor: não diz nada sobre esta página, e todas as abas com ele parecem iguais.`
      : `The page title "${hit.facts.title}" is a framework or editor default: it says nothing about this page, and every tab that has it looks the same.`
  },
  patch(hit): Patch | undefined {
    const heading = typeof hit.facts.heading === 'string' ? hit.facts.heading : undefined
    if (!heading) return undefined
    const from = String(hit.facts.title)
    return { ref: hit.ref, kind: 'set-text', from, to: heading, before: `<title>${escapeHtml(from)}</title>`, after: `<title>${escapeHtml(heading)}</title>` }
  },
}

// 2.4.6: headings and labels still holding the template's placeholder text.

const LOREM = /^lorem ipsum\b|\blorem ipsum dolor\b/i
/**
 * Phrases page builders and themes ship in a new heading block. "Heading 1" or a bare "Heading" are
 * left out: a design system's documentation shows them as samples, on purpose.
 */
const PLACEHOLDER_HEADINGS = new Set([
  'add your heading text here', 'your heading here', 'your heading text here', 'heading goes here', 'title goes here', 'your title here',
  'insert title here', 'insert heading here', 'this is a heading', 'add a heading', 'add a title', 'type your heading here',
  'adicione seu título aqui', 'seu título aqui', 'insira o título aqui', 'título aqui', 'escribe tu título aquí', 'añade tu título aquí',
])
/** A label that is only one of these words and a number ("Field 1", "Campo 2"); the bare words can be real labels. */
const NUMBERED_LABELS = new Set(['label', 'field', 'input', 'text field', 'campo', 'rótulo', 'etiqueta'])
const PLACEHOLDER_LABELS = new Set(['field label', 'input label', 'label text', 'your label', 'label here', 'seu rótulo', 'texto do rótulo'])
const FIELD_ROLES = new Set(['textbox', 'searchbox', 'combobox', 'listbox', 'spinbutton', 'slider', 'checkbox', 'radio'])

/** "Field 1", "Add Your Heading Text Here", "Lorem ipsum dolor…": text a template ships with. */
export function placeholderText(text: string, kind: 'heading' | 'label'): boolean {
  const value = text.trim().replace(/\s+/g, ' ')
  if (LOREM.test(value)) return true
  const words = value.toLowerCase().replace(/[.:…*]+$/, '').trim()
  if (kind === 'heading') return PLACEHOLDER_HEADINGS.has(words)
  const numbered = /^(.*?)[\s_-]*\d+$/.exec(words)
  return PLACEHOLDER_LABELS.has(words) || (numbered?.[1] !== undefined && NUMBERED_LABELS.has(numbered[1]))
}

export const placeholderTextRule: RuleCheck = {
  id: 'rampa/placeholder-text',
  version: '1',
  criteria: ['2.4.6'],
  maturity: 'experimental',
  surfaces: ['web'],
  act: [],
  engineRules: ['empty-heading', 'label'],
  help: {
    en: "Headings and labels must describe their topic or purpose, not keep a template's placeholder",
    'pt-BR': 'Títulos e rótulos precisam descrever o assunto ou o propósito, não manter o texto provisório do modelo',
  },
  helpUrl: `${UNDERSTANDING}headings-and-labels.html`,
  run(snapshot) {
    const hits: Hit[] = []
    let applicable = 0
    for (const node of walkTree(snapshot.root)) {
      if (isHidden(node)) continue
      const kind = node.role === 'heading' ? 'heading' : FIELD_ROLES.has(node.role) ? 'label' : undefined
      const text = node.name?.trim()
      if (!kind || !text) continue
      applicable++
      if (!placeholderText(text, kind)) continue
      hits.push({ ref: node.ref, outcome: 'fail', subject: text, evidence: truncate(text, 120), facts: { text: truncate(text, 80), kind }, html: startTagOf(node) })
    }
    return { hits, applicable }
  },
  message(hit, locale) {
    const heading = hit.facts.kind === 'heading'
    if (locale === 'pt-BR') {
      return `${heading ? 'O título' : 'O rótulo'} "${hit.facts.text}" é texto provisório de um modelo: não diz ${heading ? 'do que trata a seção' : 'o que preencher'}.`
    }
    return `The ${heading ? 'heading' : 'label'} "${hit.facts.text}" is a template's placeholder text: it does not say ${heading ? 'what the section is about' : 'what to enter'}.`
  },
}

// 1.4.4, ACT b4f0c3: a viewport meta element that blocks zoom.

/** What the collector records for each `<meta name="viewport">` that has a content attribute. */
export interface MetaViewport {
  ref: string
  content: string
}

/**
 * A property value as browsers read it: yes is 1, no is 0, device-width and device-height are 10,
 * a number is its leading digits ("1px" is 1), and anything else is 0, as Chromium parses it and as
 * ACT b4f0c3 expects ("maximum-scale=invalid" fails).
 */
function viewportNumber(value: string): number {
  const lower = value.toLowerCase()
  if (lower === 'yes') return 1
  if (lower === 'no') return 0
  if (lower === 'device-width' || lower === 'device-height') return 10
  const match = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(value)
  return match ? Number.parseFloat(match[0]) : 0
}

export function viewportProperties(content: string): Map<string, string> {
  const properties = new Map<string, string>()
  for (const part of content.replace(/\s*=\s*/g, '=').split(/[,;\s]+/)) {
    const [key, value] = part.split('=')
    if (key && value !== undefined) properties.set(key.toLowerCase(), value)
  }
  return properties
}

/**
 * ACT b4f0c3. Applies to a content attribute that sets user-scalable or maximum-scale; fails when
 * user-scalable is no (0, or any number between -1 and 1, the way browsers parse it) or when
 * maximum-scale is below 2. A negative maximum-scale is dropped, so it passes; a value that is not
 * a number at all reads as 0, so it fails, which is what axe-core 4.14 misses.
 */
export function viewportBlocksZoom(content: string): { applies: boolean; problems: string[] } {
  const properties = viewportProperties(content)
  const scalable = properties.get('user-scalable')
  const maximum = properties.get('maximum-scale')
  const problems: string[] = []
  if (scalable !== undefined) {
    const value = viewportNumber(scalable)
    if (Math.abs(value) < 1) problems.push(`user-scalable=${scalable}`)
  }
  if (maximum !== undefined) {
    const value = viewportNumber(maximum)
    if (value >= 0 && value < 2) problems.push(`maximum-scale=${maximum}`)
  }
  return { applies: scalable !== undefined || maximum !== undefined, problems }
}

/** The content with the properties that block zoom left out. */
export function zoomableContent(content: string): string {
  const kept = content
    .replace(/\s*=\s*/g, '=')
    .split(/[,;]+/)
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .filter((part) => {
      const [key = '', value = ''] = part.split('=')
      const lower = key.toLowerCase()
      if (lower === 'user-scalable') return !viewportBlocksZoom(part).problems.length
      if (lower === 'maximum-scale') return !viewportBlocksZoom(`maximum-scale=${value}`).problems.length
      return true
    })
  return kept.join(', ')
}

export function metaViewportsOf(snapshot: A11ySnapshot): MetaViewport[] {
  const value = snapshot.root.native.metaViewport
  return Array.isArray(value) ? value.filter((item): item is MetaViewport => typeof item?.ref === 'string' && typeof item?.content === 'string') : []
}

export const metaViewportRule: RuleCheck = {
  id: 'rampa/meta-viewport',
  page: true,
  version: '1',
  criteria: ['1.4.4'],
  maturity: 'experimental',
  surfaces: ['web'],
  act: ['b4f0c3'],
  engineRules: ['meta-viewport'],
  help: {
    en: 'The viewport meta element must not stop people from zooming (ACT b4f0c3)',
    'pt-BR': 'O meta viewport não pode impedir o zoom (ACT b4f0c3)',
  },
  helpUrl: 'https://www.w3.org/WAI/standards-guidelines/act/rules/b4f0c3/',
  run(snapshot) {
    const hits: Hit[] = []
    let applicable = 0
    for (const meta of metaViewportsOf(snapshot)) {
      const { applies, problems } = viewportBlocksZoom(meta.content)
      if (!applies) continue
      applicable++
      if (problems.length === 0) continue
      const html = `<meta name="viewport" content="${escapeHtml(meta.content)}">`
      hits.push({ ref: meta.ref, outcome: 'fail', subject: meta.content, evidence: problems.join(', '), facts: { content: meta.content, problems: problems.join(', ') }, html })
    }
    return { hits, applicable }
  },
  message(hit, locale) {
    return locale === 'pt-BR'
      ? `O meta viewport tem ${hit.facts.problems}: em navegadores móveis que o respeitam, a pessoa não consegue ampliar o texto até 200%.`
      : `The viewport meta element sets ${hit.facts.problems}: in mobile browsers that honor it, people cannot zoom text to 200%.`
  },
  patch(hit): Patch | undefined {
    const from = String(hit.facts.content)
    const to = zoomableContent(from)
    return {
      ref: hit.ref,
      kind: 'set-attribute',
      attribute: 'content',
      from,
      to,
      before: `<meta name="viewport" content="${escapeHtml(from)}">`,
      after: `<meta name="viewport" content="${escapeHtml(to)}">`,
    }
  },
}

// 2.2.1: the HTTP Refresh header, which works like <meta http-equiv="refresh"> but where axe-core cannot see it.

/**
 * The time of a Refresh value, by the HTML "shared declarative refresh steps": leading digits
 * (a fraction is ignored), then the end, or a separator before a URL. Undefined when the value is
 * not valid, in which case browsers ignore it.
 */
export function refreshSeconds(value: string): number | undefined {
  const match = /^[\t\n\f\r ]*(\d*)(\.[\d.]*)?/.exec(value)
  const digits = match?.[1] ?? ''
  const fraction = match?.[2] ?? ''
  if (digits === '' && fraction === '') return undefined
  const rest = value.slice(match?.[0].length ?? 0)
  if (rest !== '' && !/^[\t\n\f\r ;,]/.test(rest)) return undefined
  return digits === '' ? 0 : Number.parseInt(digits, 10)
}

/** Longer than 20 hours is allowed by the 20 hour exception; zero is an immediate redirect, which is no time limit. */
export const REFRESH_LIMIT_SECONDS = 72_000

export const refreshHeaderRule: RuleCheck = {
  id: 'rampa/refresh-header',
  page: true,
  version: '1',
  criteria: ['2.2.1'],
  maturity: 'experimental',
  surfaces: ['web'],
  act: ['bc659a'],
  engineRules: ['meta-refresh'],
  help: {
    en: 'The HTTP Refresh header must not reload or redirect the page after a delay (as ACT bc659a for the meta element)',
    'pt-BR': 'O cabeçalho HTTP Refresh não pode recarregar nem redirecionar a página depois de um tempo (como a ACT bc659a para o meta)',
  },
  helpUrl: `${UNDERSTANDING}timing-adjustable.html`,
  run(snapshot) {
    const header = snapshot.root.native.httpRefresh
    if (typeof header !== 'string' || header.trim() === '') return { hits: [], applicable: 0 }
    const seconds = refreshSeconds(header)
    if (seconds === undefined) return { hits: [], applicable: 0 }
    if (seconds === 0 || seconds > REFRESH_LIMIT_SECONDS) return { hits: [], applicable: 1 }
    const redirect = /[;,]\s*(url\s*=\s*)?\S/i.test(header.slice(String(seconds).length))
    return {
      hits: [{ ref: snapshot.root.ref, outcome: 'fail', subject: header, evidence: `Refresh: ${header}`, facts: { header, seconds, redirect } }],
      applicable: 1,
    }
  },
  message(hit, locale) {
    const seconds = Number(hit.facts.seconds)
    const redirect = hit.facts.redirect === true
    return locale === 'pt-BR'
      ? `O servidor envia o cabeçalho "Refresh: ${hit.facts.header}": a página ${redirect ? 'redireciona' : 'recarrega'} sozinha depois de ${seconds} s, e a pessoa não pode desligar, ajustar nem estender esse tempo. Redirecione no servidor (301/302) ou deixe a pessoa decidir.`
      : `The server sends "Refresh: ${hit.facts.header}": the page ${redirect ? 'redirects' : 'reloads'} by itself after ${seconds} s, and people cannot turn off, adjust or extend that time. Redirect on the server (301/302) or let people decide.`
  },
}

// 3.1.2: a language switcher whose links say each language's own name, in that language, with no lang.

const LANGUAGE_CODES = [
  'en', 'en-US', 'en-GB', 'pt', 'pt-BR', 'pt-PT', 'es', 'es-ES', 'es-419', 'es-MX', 'fr', 'fr-CA', 'de', 'it', 'nl', 'sv', 'da', 'nb', 'no',
  'fi', 'pl', 'cs', 'sk', 'hu', 'ro', 'bg', 'el', 'tr', 'ru', 'uk', 'he', 'ar', 'fa', 'hi', 'bn', 'ur', 'id', 'ms', 'th', 'vi', 'ja',
  'ko', 'zh', 'zh-Hans', 'zh-Hant', 'zh-CN', 'zh-TW', 'ca', 'eu', 'gl', 'hr', 'sr', 'sl', 'lt', 'lv', 'et', 'is', 'ga', 'cy', 'sw',
  'tl', 'af',
]

function displayName(code: string, inLanguage: string, languageDisplay: 'dialect' | 'standard' = 'dialect'): string | undefined {
  try {
    return new Intl.DisplayNames([inLanguage], { type: 'language', fallback: 'none', languageDisplay }).of(code)
  } catch {
    return undefined
  }
}

const folded = (text: string) => normalizeForMatch(text).replace(/[^\p{L}\p{N}() ]+/gu, ' ').replace(/\s+/g, ' ').trim()

let autonyms: Map<string, string> | undefined

/** Each language's name in itself, from CLDR through Intl.DisplayNames: "português", "English", "日本語". */
function autonymIndex(): Map<string, string> {
  if (autonyms) return autonyms
  autonyms = new Map()
  // Both "American English" and "English (United States)": switchers use either.
  for (const code of LANGUAGE_CODES) {
    for (const name of [displayName(code, code), displayName(code, code, 'standard')]) {
      if (name && !autonyms.has(folded(name))) autonyms.set(folded(name), code)
    }
  }
  return autonyms
}

/** The language whose own name the text is, when it is nothing else: "Português", "English (United States)". */
export function autonymOf(text: string): string | undefined {
  const value = folded(text)
  if (value === '' || value.length > 40) return undefined
  return autonymIndex().get(value)
}

const primary = (tag: string) => tag.toLowerCase().split(/[-_]/)[0] ?? ''

const SWITCHER_ROLES = new Set(['link', 'button', 'menuitem', 'menuitemradio', 'option', 'tab'])

export const languageSwitcherRule: RuleCheck = {
  id: 'rampa/language-switcher-lang',
  version: '1',
  criteria: ['3.1.2'],
  maturity: 'experimental',
  surfaces: ['web'],
  act: [],
  engineRules: ['valid-lang'],
  help: {
    en: "A link that names a language in that language must say which language it is in (lang), so it is read with the right pronunciation",
    'pt-BR': 'Um link que diz o nome de um idioma nesse idioma precisa declarar o idioma (lang), para ser lido com a pronúncia certa',
  },
  helpUrl: `${UNDERSTANDING}language-of-parts.html`,
  run(snapshot, _engine, ctx) {
    const hits: Hit[] = []
    let applicable = 0
    for (const node of walkTree(snapshot.root)) {
      if (!SWITCHER_ROLES.has(node.role) || isHidden(node)) continue
      const text = subtreeText(node)
      const code = autonymOf(text)
      if (!code) continue
      // Any lang inside or on the control marks its text; the judged 3.1.2 criterion checks whether it is right.
      if ([...walkTree(node)].some((inner) => inner.lang !== undefined)) continue
      const page = inheritedLang(ctx.index, node.ref, snapshot.locale)
      if (!page) continue
      applicable++
      if (primary(page) === primary(code)) continue
      // Italiano on a Portuguese page is spelled the same in both languages: nothing is mispronounced.
      const inPage = displayName(primary(code), page)
      if (inPage && folded(inPage) === folded(text)) continue
      hits.push({ ref: node.ref, outcome: 'fail', subject: text, evidence: truncate(text, 60), facts: { text: truncate(text, 60), lang: code, page }, html: startTagOf(node) })
    }
    return { hits, applicable }
  },
  message(hit, locale) {
    const language = displayName(String(hit.facts.lang), locale) ?? String(hit.facts.lang)
    return locale === 'pt-BR'
      ? `"${hit.facts.text}" está em ${language}, mas herda o idioma da página (${hit.facts.page}): o leitor de tela pronuncia o nome do idioma do jeito errado. Declare lang="${hit.facts.lang}" no link.`
      : `"${hit.facts.text}" is in ${language}, but it inherits the page's language (${hit.facts.page}): a screen reader mispronounces the language's name. Add lang="${hit.facts.lang}" to the link.`
  },
  patch(hit, snapshot): Patch | undefined {
    const node = [...walkTree(snapshot.root)].find((candidate) => candidate.ref === hit.ref)
    if (!node) return undefined
    const before = startTagOf(node)
    const lang = String(hit.facts.lang)
    return { ref: hit.ref, kind: 'set-attribute', attribute: 'lang', to: lang, before, after: withAttribute(before, 'lang', lang) }
  },
}

export const CONTENT_RULES: readonly RuleCheck[] = [placeholderAltRule, metaViewportRule, refreshHeaderRule, defaultTitleRule, placeholderTextRule, languageSwitcherRule]
