import { defaultTitle, placeholderText } from '../rules/content.ts'

/**
 * Texts that say nothing whatever the page: "Click here", "Section 2", "Untitled document".
 *
 * The real-page study of 2026-10 (docs/studies) found that a model's claims about 2.4.2, 2.4.4 and 2.4.6 were almost
 * all false positives: on its dev pages, 0 true failures among 38 link and heading findings, and on its held-out pages,
 * 0 again. The claims that verification let through were readings of ordinary, specific texts ("ISTs", "Download",
 * "Introduction") or of whether a sentence completes a generic one; only claims on these texts were debatable at all
 * (docs/studies/notes-244-246.md).
 *
 * - 2.4.4: a claim that a link says nothing is a finding only when its text is one of these and the link has no
 *   context of its own (sentence, paragraph, list item, cell, header cells, description) that could complete it
 *   (`Criterion.grounded` in link-purpose.ts). 2.4.6: a claim that a heading or label says nothing is a finding only
 *   when its text is one of these, or another fact shows it names nothing (headings-and-labels.ts, `saysNothing`).
 *   Any other claim is the model's suggestion, in the report's needsReview, never a failure.
 * - 2.4.2: a judgment about a title on these lists keeps its confidence, and one about any other title is reported at
 *   low confidence, below the default threshold.
 */

const normalize = (text: string) =>
  text
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.:!…»›→>]+$/u, '')
    .trim()
    .toLowerCase()

const GENERIC_LINKS = new Set([
  'click here', 'click', 'here', 'this', 'this link', 'link', 'read more', 'more', 'learn more', 'more info', 'more information',
  'details', 'go', 'continue', 'see more', 'view more', 'find out more',
  'clique aqui', 'clique', 'aqui', 'este link', 'link', 'saiba mais', 'leia mais', 'mais', 'ver mais', 'veja mais', 'mais informações',
  'detalhes', 'acesse', 'acesse aqui', 'confira',
  'haga clic aquí', 'clic aquí', 'aquí', 'leer más', 'más', 'ver más', 'más información', 'detalles',
])

/**
 * The words of a link text that only says "follow me" (WCAG technique F84's "click here" and "more"): a verb that names
 * no destination, and a word that only points. "Check it out", "Read this", "Veja aqui" and "Clique aqui para ver
 * mais" are made of nothing else; "Download", "Press" or "Open" alone name an action and are left to the model.
 */
const FOLLOW_VERBS = new Set([
  'click', 'tap', 'press', 'go', 'see', 'view', 'read', 'learn', 'find', 'check', 'visit', 'open', 'follow', 'continue', 'discover',
  'clique', 'clica', 'clicar', 'toque', 'veja', 'ver', 'leia', 'ler', 'saiba', 'saber', 'confira', 'conferir', 'acesse', 'acessar', 'visite', 'abra', 'siga', 'continue', 'descubra',
  'haz', 'haga', 'clic', 'pulsa', 'pulse', 'vea', 'mira', 'lee', 'lea', 'leer', 'conoce', 'descubre', 'visita', 'accede', 'acceda', 'abre', 'sigue', 'continúa',
])
const POINTERS = new Set(['here', 'this', 'that', 'it', 'there', 'now', 'more', 'out', 'aqui', 'isto', 'isso', 'este', 'esta', 'agora', 'mais', 'aquí', 'esto', 'ahora', 'más'])
const FILLERS = new Set(['to', 'the', 'a', 'on', 'for', 'and', 'para', 'o', 'a', 'e', 'em', 'de', 'el', 'la', 'y', 'en', 'por'])

function followOnly(text: string): boolean {
  if (!/^[\p{L}\s'’,.:!…»›→>-]+$/u.test(text)) return false
  const words = normalize(text).split(/[\s,'’-]+/).filter(Boolean)
  if (words.length < 2 || words.length > 6) return false
  return words.every((word) => FOLLOW_VERBS.has(word) || POINTERS.has(word) || FILLERS.has(word)) && words.some((word) => FOLLOW_VERBS.has(word)) && words.some((word) => POINTERS.has(word))
}

/** A raw address or a file name shown as the link text. */
const ADDRESS = /^(https?:\/\/|www\.)\S+$|^[\w-]+\.(pdf|docx?|xlsx?|pptx?|zip|html?|php|aspx?)$/i

/** A link text that names no destination: a generic phrase, or a "follow me" made only of such words. */
export function genericLinkText(name: string): boolean {
  return GENERIC_LINKS.has(normalize(name)) || followOnly(name)
}

/**
 * A link text that is an address with more than a site's name in it, or a file name: "https://example.org/r?id=7",
 * "report_v2.pdf". A bare host such as "www.example.org" names the site it leads to, which can be its purpose.
 */
export function addressText(name: string): boolean {
  const text = name.trim()
  if (!ADDRESS.test(text)) return false
  if (!/^(https?:\/\/|www\.)/i.test(text)) return true
  try {
    const url = new URL(/^www\./i.test(text) ? `http://${text}` : text)
    return url.pathname.replace(/\/+$/, '') !== '' || url.search !== ''
  } catch {
    return true
  }
}

/** A numbering or a bare structural word: "Section 2", "Part 3", "Título". */
const NUMBERED_HEADING = /^(section|part|chapter|step|item|block|seção|secao|parte|capítulo|passo|bloco|sección|capítulo|paso)\s*\d+$/u
const BARE_HEADINGS = new Set(['title', 'heading', 'header', 'subtitle', 'untitled', 'título', 'titulo', 'cabeçalho', 'subtítulo', 'sem título', 'encabezado'])
const BARE_LABELS = new Set(['input', 'text', 'field', 'value', 'campo', 'texto', 'entrada', 'valor', 'valor 1'])

export function genericHeadingOrLabel(text: string, kind: 'heading' | 'label'): boolean {
  if (placeholderText(text, kind)) return true
  const value = normalize(text)
  if (kind === 'heading') return NUMBERED_HEADING.test(value) || BARE_HEADINGS.has(value)
  return BARE_LABELS.has(value) || /^(field|input|campo|entrada)\s*\d+$/u.test(value)
}

const BARE_TITLES = new Set(['home', 'page', 'index', 'welcome', 'new tab', 'início', 'inicio', 'página', 'pagina', 'bem-vindo', 'bem vindo', 'bienvenido'])

export function genericTitle(title: string): boolean {
  return defaultTitle(title) || BARE_TITLES.has(normalize(title)) || ADDRESS.test(title.trim())
}
