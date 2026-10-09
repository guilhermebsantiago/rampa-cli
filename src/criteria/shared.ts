import type { EngineResults, Patch, Verification } from '../core/types.ts'
import { normalizeForMatch } from '../core/util.ts'
import type { A11yNode, Surface } from '../snapshot/schema.ts'

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
  // A native node as its platform's tools show it: <android.widget.ImageView content-desc="…">.
  if (typeof node.native.source === 'string') return node.native.source
  const tag = typeof node.native.tag === 'string' ? node.native.tag : node.role
  const attributes = Object.entries(attributesOf(node))
    .map(([name, value]) => ` ${name}="${escapeHtml(value)}"`)
    .join('')
  return `<${tag}${attributes}>`
}

export function endTagOf(node: A11yNode): string {
  return `</${typeof node.native.tag === 'string' ? node.native.tag : node.role}>`
}

/**
 * On Android and iOS a name lives in a property the developer sets, not in markup, so a
 * patch shows that property: android:contentDescription="…", accessibilityLabel = "…".
 */
export type NativeSurface = 'android' | 'ios'

export function isNativeSurface(surface: Surface): surface is NativeSurface {
  return surface === 'android' || surface === 'ios'
}

const NAME_PROPERTIES: Record<NativeSurface, Record<string, string>> = {
  android: { 'content-desc': 'contentDescription', hint: 'hint', text: 'text' },
  ios: { label: 'accessibilityLabel', placeholder: 'placeholder', text: 'text' },
}

/** The property a native node's name comes from, as the collector recorded it. */
export function nameProperty(surface: NativeSurface, node: A11yNode): string {
  const from = typeof node.native.nameFrom === 'string' ? node.native.nameFrom : surface === 'android' ? 'content-desc' : 'label'
  return NAME_PROPERTIES[surface][from] ?? NAME_PROPERTIES[surface][surface === 'android' ? 'content-desc' : 'label'] ?? 'name'
}

export function propertyLine(surface: NativeSurface, property: string, value: string | boolean): string {
  if (surface === 'android') return `android:${property}="${escapeHtml(String(value))}"`
  return typeof value === 'boolean' ? `${property} = ${value}` : `${property} = "${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

export function propertyPatch(surface: NativeSurface, ref: string, property: string, from: string, to: string): Patch {
  return {
    ref,
    kind: property === 'text' ? 'set-text' : 'set-attribute',
    attribute: property,
    from,
    to,
    before: propertyLine(surface, property, from),
    after: propertyLine(surface, property, to),
  }
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
