import type { A11yNode } from './schema.ts'

/**
 * Contrast the web collector measured from pixels (surfaces/contrast-capture.ts), recorded on each
 * node it measured as `native.pixelContrast`, keyed by kind, and summed up on the root as
 * `native.pixelContrastRun`. These are facts, never verdicts: the rules in rules/contrast.ts apply
 * the thresholds, so a saved snapshot is judged again offline. Both are additive fields on `native`,
 * so `schemaVersion` stays 1.
 *
 * - text: an element whose text contrast axe-core could not decide (a background image, a gradient,
 *   an element over it, a pseudo-element), measured against what is behind its glyphs.
 * - placeholder: the placeholder of an empty field, which axe-core does not check.
 */

export const PIXEL_KINDS = ['text', 'placeholder'] as const
export type PixelKind = (typeof PIXEL_KINDS)[number]

export interface PixelContrastFact {
  kind: PixelKind
  /**
   * measured: the numbers below hold. unmeasured: the pixels could not tell, and `reason` says why.
   * exempt: the element needs no contrast, such as a disabled control (`reason`).
   */
  status: 'measured' | 'unmeasured' | 'exempt'
  reason?: string | undefined
  /** text: axe-core's reason for leaving it undecided, such as bgImage or bgGradient. */
  axeReason?: string | undefined
  /** placeholder: the placeholder's words. */
  text?: string | undefined
  /** CSS px and weight of the text, for the large-text threshold. */
  fontSize?: number | undefined
  fontWeight?: number | undefined
  /** #rrggbb, or #rrggbbaa when the style sheet's color has alpha. */
  foreground?: string | undefined
  foregroundFrom?: 'css' | 'pixels' | undefined
  /** What lies behind the glyphs: the most common color, the one with the lowest contrast and the one with the highest. */
  background?: { common: string; worst: string; best: string } | undefined
  /** The highest and lowest contrast between the glyphs and what is behind them (ACT's highest possible contrast). */
  highest?: number | undefined
  lowest?: number | undefined
  /** Glyph pixels compared, and their typical stroke width, in image pixels. */
  pixels?: number | undefined
  stroke?: number | undefined
  /** Pixel colors only: whether one color holds the strokes. */
  uniform?: boolean | undefined
  /** Below 1 when the element or an ancestor was translucent when captured: by design, or a fade under way. */
  opacity?: number | undefined
}

export interface PixelContrastRun {
  version: string
  /** Elements measured at most per page, by kind. */
  limits: Record<PixelKind, number>
  /** Candidates the page had, by kind. */
  found: Record<PixelKind, number>
  /** Candidates measured (or found not measurable, with the reason on the node). */
  measured: Record<PixelKind, number>
  /** Candidates left out, past the limit or the time budget; axe-core's undecided results stay to review. */
  leftOut: Record<PixelKind, number>
  /** limit: past the number of elements per page; time: the page's time budget ran out first. */
  stopped?: 'limit' | 'time' | undefined
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** The fact of one kind on a node; a snapshot is input, so anything else reads as no fact. */
export function pixelFactOf(node: A11yNode, kind: PixelKind): PixelContrastFact | undefined {
  const all = node.native.pixelContrast
  if (!isRecord(all)) return undefined
  const fact = all[kind]
  if (!isRecord(fact) || fact.kind !== kind) return undefined
  if (fact.status !== 'measured' && fact.status !== 'unmeasured' && fact.status !== 'exempt') return undefined
  if (fact.status === 'measured' && (typeof fact.highest !== 'number' || typeof fact.lowest !== 'number')) return undefined
  return fact as unknown as PixelContrastFact
}

export function setPixelFact(node: A11yNode, fact: PixelContrastFact): void {
  const all = isRecord(node.native.pixelContrast) ? node.native.pixelContrast : {}
  node.native.pixelContrast = { ...all, [fact.kind]: fact }
}

export function pixelRunOf(root: A11yNode): PixelContrastRun | undefined {
  const run = root.native.pixelContrastRun
  if (!isRecord(run) || !isRecord(run.leftOut) || !isRecord(run.limits)) return undefined
  return run as unknown as PixelContrastRun
}
