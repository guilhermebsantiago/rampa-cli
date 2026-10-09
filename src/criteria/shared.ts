import type { EngineResults, Verification } from '../core/types.ts'
import { normalizeForMatch } from '../core/util.ts'
import type { A11yNode } from '../snapshot/schema.ts'

/** Refs of the nodes the engine already failed on these rules: they go to the report as they are, never to the model. */
export function failedByEngine(engine: EngineResults, rules: readonly string[]): Set<string> {
  return new Set(
    engine.rules
      .filter((rule) => rule.outcome === 'violation' && rules.includes(rule.ruleId))
      .flatMap((rule) => rule.nodes.flatMap((node) => (node.ref ? [node.ref] : []))),
  )
}

export function attributesOf(node: A11yNode): Record<string, string> {
  return (node.native.attributes ?? {}) as Record<string, string>
}

export function isHidden(node: A11yNode): boolean {
  return node.states.includes('hidden') || node.states.includes('aria-hidden')
}

/** Everything a person reads in a subtree: text, and the names of images, in document order. */
export function subtreeText(node: A11yNode): string {
  const parts: string[] = []
  const visit = (current: A11yNode): void => {
    if (isHidden(current)) return
    const reading = readingTextOf(current)
    if (reading !== undefined) {
      parts.push(reading)
      return
    }
    if (current.text) parts.push(current.text)
    if (current.role === 'img' && current.name) parts.push(current.name)
    for (const child of current.children) visit(child)
  }
  visit(node)
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}

/** The text of a block in reading order, when the collector recorded it. */
export function readingTextOf(node: A11yNode): string | undefined {
  const reading = node.native.readingText
  return typeof reading === 'string' ? reading : undefined
}

export function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

/** The element's start tag, from its recorded markup or rebuilt from the attributes the collector kept. */
export function startTagOf(node: A11yNode): string {
  const html = typeof node.native.html === 'string' ? node.native.html : ''
  const recorded = /^<[^>]*>/.exec(html)?.[0]
  if (recorded) return recorded
  const tag = typeof node.native.tag === 'string' ? node.native.tag : node.role
  const attributes = Object.entries(attributesOf(node))
    .map(([name, value]) => ` ${name}="${escapeHtml(value)}"`)
    .join('')
  return `<${tag}${attributes}>`
}

export function endTagOf(node: A11yNode): string {
  return `</${typeof node.native.tag === 'string' ? node.native.tag : node.role}>`
}

/** The start tag with one attribute set: its value replaced when present, the attribute added at the end otherwise. */
export function withAttribute(startTag: string, name: string, value: string): string {
  const quoted = `${name}="${escapeHtml(value)}"`
  // Preceded by whitespace, so data-autocomplete never matches autocomplete.
  const present = new RegExp(`(\\s)${name}(?:\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s"'>]+))?(?=[\\s/>])`, 'i')
  if (present.test(startTag)) return startTag.replace(present, `$1${quoted}`)
  return startTag.replace(/\s*(\/?)>$/, ` ${quoted}$1>`)
}

/** The words of a text, lowercased, without punctuation. */
export function wordsOf(text: string): string[] {
  return normalizeForMatch(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== '')
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'this', 'that', 'our', 'your', 'you', 'are', 'its', 'into', 'all',
  'uma', 'com', 'para', 'por', 'dos', 'das', 'nos', 'nas', 'que', 'del', 'los', 'las', 'une', 'les', 'des', 'und', 'der', 'die', 'das',
])

/** The words of a text that carry meaning: three letters or more, common short words left out. */
export function contentWords(text: string): Set<string> {
  return new Set(wordsOf(text).filter((word) => word.length >= 3 && !STOPWORDS.has(word)))
}

export function sharedWords(a: Set<string>, b: Set<string>): number {
  let count = 0
  for (const word of a) if (b.has(word)) count++
  return count
}

/**
 * Whether a phrase appears in a text: a short phrase as the same words in a row, a longer one
 * with nearly all its words, so a slip in a transcription does not hide a match.
 */
export function phraseIn(phrase: string, text: string | undefined): boolean {
  if (!text) return false
  const said = wordsOf(phrase)
  if (said.length === 0) return false
  const around = wordsOf(text)
  if (said.length <= 3) return ` ${around.join(' ')} `.includes(` ${said.join(' ')} `)
  const present = new Set(around)
  return said.filter((word) => present.has(word)).length >= said.length * 0.9
}

/**
 * The quoted text must be the element's current text: the same words, at most trimmed.
 * A model that quotes something else is describing another element.
 */
export function verifyQuote(evidence: string, current: string, what: string): Verification {
  const quote = normalizeForMatch(evidence)
  const text = normalizeForMatch(current)
  if (quote === '') return { ok: false, reason: 'empty evidence' }
  if (quote === text) return { ok: true }
  // A quote may drop a little at the ends, never most of the text.
  if (text.includes(quote) && quote.length >= text.length * 0.6) return { ok: true }
  return { ok: false, reason: `evidence is not the ${what}` }
}
