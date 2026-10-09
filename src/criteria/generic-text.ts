import { defaultTitle, placeholderText } from '../rules/content.ts'

/**
 * Texts that say nothing whatever the page: "Click here", "Section 2", "Untitled document".
 *
 * The real-page study of 2026-10 (docs/studies) found that a model's claims about 2.4.2, 2.4.4
 * and 2.4.6 were almost all false positives when the text was an ordinary, specific one, and true
 * when the text was one of these. So a judgment about a text on these lists keeps its confidence,
 * and a judgment about any other text is reported at low confidence: below the default threshold,
 * listed by --verbose, never failing a build, and still scored by rampa eval.
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

/** A raw address or a file name shown as the link text. */
const ADDRESS = /^(https?:\/\/|www\.)\S+$|^[\w-]+\.(pdf|docx?|xlsx?|pptx?|zip|html?|php|aspx?)$/i

export function genericLinkText(name: string): boolean {
  const text = normalize(name)
  return GENERIC_LINKS.has(text) || ADDRESS.test(name.trim())
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
