import type { A11yNode } from './schema.ts'

/**
 * How text looks, as the collector records it (surfaces/in-page.ts): on headings, on short blocks of text that could
 * be headings (`native.look`), and for the page's body text (`native.bodyLook` on the root). 1.3.1 compares them for
 * failure F2: text styled exactly like the page's own headings but not marked up as one.
 */
export interface Look {
  /** Font size in CSS px, to half a pixel. */
  size: number
  weight: number
  /** The first family of the font stack, lower case. */
  family: string
  color: string
  italic?: true | undefined
  /** text-transform, or small caps. */
  caps?: string | undefined
}

function asLook(value: unknown): Look | undefined {
  if (!value || typeof value !== 'object') return undefined
  const look = value as Partial<Look>
  return typeof look.size === 'number' && typeof look.weight === 'number' && typeof look.family === 'string' && typeof look.color === 'string' ? (look as Look) : undefined
}

export function lookOf(node: A11yNode): Look | undefined {
  return asLook(node.native.look)
}

export function bodyLookOf(root: A11yNode): Look | undefined {
  return asLook(root.native.bodyLook)
}

/**
 * The first families a browser's default style sheet gives text when no author style sets one: Chromium's standard font
 * setting is "Times New Roman" on every desktop platform, and the generic family or its metric twins where it is not.
 */
export const DEFAULT_FAMILIES: readonly string[] = ['times new roman', 'times', 'serif', 'tinos', 'liberation serif', 'dejavu serif']

/**
 * Body text in the browser's own default look: 16 px, weight 400, black, the default serif. On the 72 pages of the
 * second to fourth real-page studies, only the two captures that came without their styles had it (www.ufpe.br, whose
 * theme did not apply, and museudoamanha.org.br, served as a stripped page with no stylesheet at all;
 * docs/studies/notes-precision-check.md).
 */
export function isDefaultLook(look: Look | undefined): boolean {
  return look !== undefined && look.size === 16 && look.weight === 400 && look.color === 'rgb(0, 0, 0)' && DEFAULT_FAMILIES.includes(look.family) && !look.italic
}

/**
 * The fewest elements a page has for a default look with no author style at all to count as a capture that lost its
 * styles: a site's page has a header, menus and a footer to style; a page this small (a W3C ACT test case, a fixture)
 * is more likely written without CSS on purpose, and is read as it is. museudoamanha.org.br's stripped page had 260.
 */
export const PLAIN_PAGE_ELEMENTS = 150

/** The same typographic signature: size within half a pixel, and the same weight, family, style, case and color. */
export function sameLook(a: Look, b: Look): boolean {
  return Math.abs(a.size - b.size) <= 0.5 && a.weight === b.weight && a.family === b.family && a.color === b.color && Boolean(a.italic) === Boolean(b.italic) && (a.caps ?? '') === (b.caps ?? '')
}

/** Whether a look stands out from body text: two pixels larger, or bold where the body is not. */
export function standsOut(look: Look, body: Look | undefined): boolean {
  if (!body) return look.size >= 18 || look.weight >= 600
  return look.size >= body.size + 2 || (look.weight >= 600 && body.weight < 600)
}

/** The look in words, for a prompt or a message: "24 px, weight 700, georgia". */
export function describeLook(look: Look): string {
  return [`${look.size} px`, `weight ${look.weight}`, look.family, look.italic ? 'italic' : undefined, look.caps].filter(Boolean).join(', ')
}
