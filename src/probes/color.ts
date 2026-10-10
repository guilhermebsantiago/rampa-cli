import type { Browser, Page } from 'playwright-core'
import { type BandInk, grayChange, movedShare, ringInk } from '../pixels/gray.ts'
import { type RgbaImage, tryDecodePng } from '../pixels/png.ts'
import type { ProbeRecord } from '../snapshot/schema.ts'
import type { InPageElement, InPageRect, Kit } from './kit.ts'
import { type ProbeOptions, openProbePage, skippedRecord } from './page.ts'

/**
 * Use of Color (1.4.1). The probe reads, on a fresh page, four kinds of things that are often told apart by color
 * alone, and records facts; the rules (src/rules/color.ts) decide.
 *
 * - **Current state.** An element marked current (`aria-current`), selected (`aria-selected` on a tab), pressed
 *   (`aria-pressed`) or given a state class (`active`, `is-current`, `current-menu-item`…) inside navigation, tabs,
 *   menus, toolbars, pagination or breadcrumbs is compared with its peers, the same items next to it that are not
 *   current: their computed styles (font weight, style, size and family, text decoration, borders, outline,
 *   shadows, background images, transforms, `::before` and `::after`), the visible elements inside them (icons,
 *   marks) and their visible text (a "✓" or "(current)"). When only colors differ, the item is captured with a
 *   halo of 8 px around it, then again with the peer's colors put on it; the two captures are compared in an
 *   achromatopsia render (each pixel reduced to its relative luminance, src/pixels/gray.ts). The halo is also
 *   compared with the peers' halos, for an indicator drawn by an element that is not the item's own.
 * - **Required fields.** In a form with required and optional fields, the labels (and the fields) of the two
 *   kinds are compared the same way, after looking for text marks: an asterisk, "required", "(optional)".
 * - **Links in text.** Each link inside a block of text: what tells it apart from the text around it at rest
 *   (underline, border, weight, an icon), the luminance contrast of its color with the text's, and what changes
 *   when the pointer hovers it and when it takes focus.
 * - **Color words.** Sentences that refer to a color to convey something ("Fields in red are required", "Os campos
 *   em vermelho são obrigatórios") are quoted, with the hue of what they seem to name: the labels and fields, error
 *   messages, links or text on the page that have that hue, and whether those carry another mark.
 *
 * Observe class: the probe reads styles, moves the pointer onto links, gives them focus, scrolls, takes
 * screenshots and changes colors for a moment (put back right after each capture). It never clicks or types.
 */

export const COLOR_VERSION = '1'
/** Pixels around an element in its captures: outlines, shadows and indicators next to it fall inside. */
export const HALO = 8
const TIME_BUDGET_MS = 45_000
const MAX_STATES = 20
const MAX_STATES_MEASURED = 10
const MAX_REQUIRED = 5
const MAX_LINKS = 150
const MAX_LINK_GROUPS = 8
const MAX_INSTRUCTIONS = 10
/** At most this many peers are compared with one item. */
const MAX_PEERS = 2

export type HueKey = 'red' | 'orange' | 'yellow' | 'green' | 'cyan' | 'blue' | 'purple' | 'pink' | 'gray' | 'neutral'

/** One property that differs between an element and its peer. */
export interface StyleDiff {
  /** 'font-weight', 'color', 'border-bottom'… */
  prop: string
  /** Where: 'element', 'item' (the repeating unit that holds it), or either with '::before' or '::after'. */
  node: string
  current: string
  peer: string
}

export interface Comparison {
  /** Differences other than color: a person with no color vision sees them. */
  cues: StyleDiff[]
  /** Differences of color only (color, backgrounds, border and outline colors, opacity, shadow colors). */
  colors: StyleDiff[]
  /** Visible elements or text marks only one side has: an icon, a "✓", "(current)". */
  marks: string[]
  /**
   * The largest luminance contrast between the two sides' colors, as the style sheet gives them, each composited on
   * what is behind it: 3:1 or more is a difference of lightness, which 1.4.1 counts as a cue of its own.
   */
  contrast?: number | undefined
}

export interface GrayMeasure {
  status: 'measured' | 'not-shown' | 'moving' | 'shifted' | 'capture-failed' | 'time'
  /** The captured box (the item with its halo), in CSS px from the viewport's top left corner. */
  clip?: InPageRect | undefined
  /** Pixels compared, pixels whose color changed when the peer's colors were put on, and how many changed by 3:1 or more in luminance. */
  area?: number | undefined
  colorChanged?: number | undefined
  strong?: number | undefined
  /** The luminance contrast of that change at its strongest (top 0.5% left out): under 3:1, the difference is gone in gray. */
  strongest?: number | undefined
  /** Ink in the halo around the item (with its peer's colors on) and around each peer, in the gray render. */
  ring?: { current: BandInk; peers: BandInk[] } | undefined
}

export interface StateFact {
  /** The element marked current or selected, as the snapshot holds it. */
  el: InPageElement
  /** The repeating unit that holds it (an `li`), when it is not the element itself. */
  item?: InPageElement | undefined
  /** What marks it: aria-current, aria-selected, aria-pressed, or a class. */
  state: 'aria-current' | 'aria-selected' | 'aria-pressed' | 'class'
  /** The attribute's value or the class. */
  value: string
  /** The container the items sit in: its tag and role, and its name. */
  group: string
  /** Peers found next to it, and those compared. */
  peersFound: number
  peers: InPageElement[]
  skipped?: 'no-peer' | 'peers-differ' | undefined
  comparison?: Comparison | undefined
  /** The text colors, as the style sheet gives them composited on what is behind, and their luminance contrast. */
  text?: { current: string; peer: string; contrast: number } | undefined
  gray?: GrayMeasure | undefined
}

export interface RequiredFact {
  /** The form, or the page's body for fields outside any form. */
  form: InPageElement
  /** The first required field and its label; the first optional field and its label. */
  field: InPageElement
  label: InPageElement
  peerField: InPageElement
  peerLabel: InPageElement
  required: number
  optional: number
  /** Text marks that tell the two kinds apart: an asterisk or "required" on the required, "(optional)" on the optional. */
  marks: string[]
  labels?: Comparison | undefined
  fields?: Comparison | undefined
  text?: { current: string; peer: string; contrast: number } | undefined
  /** What the gray capture compared: the label, or the field when only the fields differ. */
  measured?: 'label' | 'field' | undefined
  gray?: GrayMeasure | undefined
}

export interface LinkFact {
  el: InPageElement
  /** The link's text, cut to 80 characters. */
  text: string
  /** Its text color and the color of the text around it, composited on what is behind, and their luminance contrast. */
  color: string
  around: string
  contrast: number
  /** What tells it apart from the text around it at rest, other than color: 'underline', 'border-bottom', 'icon'… */
  rest: string[]
  /** It paints its own background, which may tell it apart (with the contrast against the block's background). */
  background?: { color: string; contrast: number } | undefined
  /** Links with the same styles share one hover and focus measurement. */
  group: number
}

export interface LinkGroupFact {
  /** The link the group was measured on. */
  ref: string
  /** What changed, other than color, with the pointer on the link; null when it could not be measured. */
  hover: string[] | null
  /** What changed, other than color, when the link took focus (the browser's focus ring counts); null when not measured. */
  focus: string[] | null
  /** The link matched :focus-visible when it took focus, as it does from the keyboard. */
  focusVisible?: boolean | undefined
}

export interface InstructionTarget {
  el: InPageElement
  /** The hue's color, as #rrggbb. */
  color: string
  /** text: the element's text has the hue; border: a field's border has it. */
  what: 'text' | 'border'
  /** A text mark the element (or the label of the field) carries: "*", "required". */
  mark?: string | undefined
}

export interface InstructionFact {
  /** The element whose text holds the sentence. */
  el: InPageElement
  /** The sentence, as the page writes it, cut to 300 characters. */
  quote: string
  /** The color word as written, and its hue. */
  word: string
  hue: HueKey
  /** What the sentence seems to name: required fields, errors, links, or anything. */
  target: 'required' | 'error' | 'link' | 'generic'
  /** A cue other than color that the sentence itself names: "asterisk", "*", "bold"… */
  otherCue?: string | undefined
  /** Elements of that kind that have the hue, at most 5, and how many there are. */
  matched: InstructionTarget[]
  matchedCount: number
  /** Of the matched required labels and fields, how many carry no text mark. */
  unmarked: number
}

export interface ColorData {
  viewport: { width: number; height: number }
  states: StateFact[]
  required: RequiredFact[]
  links: LinkFact[]
  linkGroups: LinkGroupFact[]
  instructions: InstructionFact[]
  /** Candidates found before the budgets cut them. */
  found: { states: number; required: number; links: number; instructions: number }
  halo: number
  end: 'complete' | 'time'
}

interface ColorKit {
  facts(arg: { maxStates: number; maxRequired: number; maxLinks: number; maxInstructions: number; maxPeers: number }): Omit<ColorData, 'viewport' | 'linkGroups' | 'halo' | 'end'>
  /** Scrolls a measured candidate (or one of its peers) into view; the box of the item and the clip with its halo. */
  place(arg: { key: string; peer?: number | undefined; halo: number }): { status: 'ready' | 'not-shown'; box?: InPageRect; clip?: InPageRect }
  /** Puts the peer's colors on the candidate's elements; the box afterwards. */
  swap(key: string): InPageRect | null
  restore(): void
  /** Scrolls a link into view and records how it looks at rest; its box. */
  linkRest(ref: string): InPageRect | null
  /** What changed on the link, other than color, since linkRest. */
  linkNow(ref: string): { cues: string[]; focusVisible: boolean }
  focusLink(ref: string): boolean
  blurAll(): void
}

/**
 * Runs in the page; needs the probe kit (`window.__rampaKit`). Installs `window.__rampaColor`. Serialized by the
 * browser library, so it references nothing outside its own body.
 */
export function installColorKit(): void {
  const w = window as unknown as { __rampaColor?: ColorKit; __rampaKit: Kit }
  if (w.__rampaColor) return
  const kit = w.__rampaKit

  // ---- colors -------------------------------------------------------------------------------------------------
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const ctx2d = canvas.getContext('2d', { willReadFrequently: true })
  const rgba = (css: string): [number, number, number, number] => {
    if (!ctx2d || !css) return [0, 0, 0, 0]
    ctx2d.clearRect(0, 0, 1, 1)
    ctx2d.fillStyle = 'rgba(0, 0, 0, 0)'
    ctx2d.fillStyle = css
    ctx2d.fillRect(0, 0, 1, 1)
    const [r = 0, g = 0, b = 0, a = 0] = Array.from(ctx2d.getImageData(0, 0, 1, 1).data)
    return [r, g, b, a / 255]
  }
  const hex = (c: readonly number[]): string => `#${[c[0] ?? 0, c[1] ?? 0, c[2] ?? 0].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`
  const norm = (css: string): string => {
    const c = rgba(css)
    return c[3] >= 0.999 ? hex(c) : c[3] <= 0.001 ? 'transparent' : `${hex(c)}/${Math.round(c[3] * 100) / 100}`
  }
  const channel = (v: number) => {
    const c = v / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  const luminance = (c: readonly number[]) => 0.2126 * channel(c[0] ?? 0) + 0.7152 * channel(c[1] ?? 0) + 0.0722 * channel(c[2] ?? 0)
  const contrast = (a: readonly number[], b: readonly number[]) => {
    const la = luminance(a)
    const lb = luminance(b)
    return Math.round(((Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)) * 100) / 100
  }
  const over = (top: readonly number[], bottom: readonly number[]): number[] => {
    const a = top[3] ?? 1
    return [0, 1, 2].map((i) => (top[i] ?? 0) * a + (bottom[i] ?? 0) * (1 - a))
  }
  /** The color behind an element: the nearest ancestor background that paints, composited down to white. */
  const backdrop = (el: Element): number[] => {
    const layers: Array<[number, number, number, number]> = []
    for (let node: Element | null = el; node; node = node.parentElement ?? ((node.getRootNode() as ShadowRoot).host ?? null)) {
      const c = rgba(getComputedStyle(node).backgroundColor)
      if (c[3] > 0) layers.push(c)
      if (c[3] >= 0.999) break
    }
    let color = [255, 255, 255]
    for (const layer of layers.reverse()) color = over(layer, color)
    return color
  }
  const textColor = (el: Element): number[] => {
    const s = getComputedStyle(el)
    const own = rgba(s.webkitTextFillColor || s.color)
    let opacity = 1
    for (let node: Element | null = el; node; node = node.parentElement) opacity *= Number.parseFloat(getComputedStyle(node).opacity) || 0
    const c: [number, number, number, number] = [own[0], own[1], own[2], own[3] * opacity]
    return over(c, backdrop(el))
  }
  const hueOf = (c: readonly number[]): 'red' | 'orange' | 'yellow' | 'green' | 'cyan' | 'blue' | 'purple' | 'pink' | 'gray' | 'neutral' => {
    const r = (c[0] ?? 0) / 255
    const g = (c[1] ?? 0) / 255
    const b = (c[2] ?? 0) / 255
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const l = (max + min) / 2
    const d = max - min
    if (l < 0.08 || l > 0.96) return 'neutral'
    const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
    if (s < 0.18 || d < 0.08) return l < 0.2 || l > 0.9 ? 'neutral' : 'gray'
    let h = 0
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h = (h * 60 + 360) % 360
    if (h < 15 || h >= 345) return 'red'
    if (h < 45) return 'orange'
    if (h < 70) return 'yellow'
    if (h < 165) return 'green'
    if (h < 195) return 'cyan'
    if (h < 255) return 'blue'
    if (h < 290) return 'purple'
    return 'pink'
  }

  // ---- visibility and text ------------------------------------------------------------------------------------
  const shown = (el: Element): boolean => {
    if (!kit.visible(el)) return false
    const r = el.getBoundingClientRect()
    return r.width >= 2 && r.height >= 2
  }
  /** The sr-only pattern: a 1 px box, or a clip that leaves nothing. */
  const clippedAway = (el: Element): boolean => {
    const r = el.getBoundingClientRect()
    if (r.width <= 1 || r.height <= 1) return true
    const s = getComputedStyle(el)
    return /rect\(\s*0(px)?[\s,]+0(px)?[\s,]+0(px)?[\s,]+0(px)?\s*\)/.test(s.clip) || /inset\(\s*50%/.test(s.clipPath)
  }
  /** Text a person sees inside `root`: not hidden, not visually hidden the sr-only way. */
  const visibleText = (root: Element): string => {
    const out: string[] = []
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const value = node.textContent ?? ''
      if (!value.trim()) continue
      let ok = true
      for (let el = node.parentElement; el && ok; el = el === root ? null : el.parentElement) {
        if (!kit.visible(el) || clippedAway(el)) ok = false
      }
      if (ok) out.push(value)
    }
    return out.join(' ').replace(/\s+/g, ' ').trim()
  }
  const short = (text: string, max = 80) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)
  /** Elements matching a selector in the document and its open shadow roots (not frames). */
  const deepAll = (selector: string): Element[] => {
    const found: Element[] = []
    const visit = (root: Document | ShadowRoot) => {
      for (const el of Array.from(root.querySelectorAll(selector))) found.push(el)
      for (const el of Array.from(root.querySelectorAll('*'))) if (el.shadowRoot) visit(el.shadowRoot)
    }
    visit(document)
    return found
  }
  const parentOf = (el: Element): Element | null => el.parentElement ?? ((el.getRootNode() as ShadowRoot).host ?? null)

  // ---- styles -------------------------------------------------------------------------------------------------
  const px = (value: string) => Math.round((Number.parseFloat(value) || 0) * 10) / 10
  const stripColors = (value: string) => value.replace(/(rgba?|hsla?|color|oklch|oklab|lab|lch)\([^)]*\)/g, '').replace(/\s+/g, ' ').trim()
  const SIDES = ['top', 'right', 'bottom', 'left'] as const
  const border = (s: CSSStyleDeclaration, side: (typeof SIDES)[number]): string => {
    const style = s.getPropertyValue(`border-${side}-style`)
    const width = px(s.getPropertyValue(`border-${side}-width`))
    return style === 'none' || style === 'hidden' || width === 0 ? 'none' : `${width}px ${style}`
  }
  const outline = (s: CSSStyleDeclaration): string => {
    const width = px(s.outlineWidth)
    return s.outlineStyle === 'none' || width === 0 ? 'none' : `${width}px ${s.outlineStyle}`
  }
  const decoration = (s: CSSStyleDeclaration): string => {
    const line = s.textDecorationLine
    return !line || line === 'none' ? 'none' : `${line} ${s.textDecorationStyle} ${s.textDecorationThickness}`
  }
  /** Everything that shows without color, as one record of strings. */
  const shapeOf = (s: CSSStyleDeclaration, el: Element | null): Record<string, string> => {
    const weight = Number.parseInt(s.fontWeight, 10)
    const shape: Record<string, string> = {
      'font-weight': Number.isNaN(weight) ? s.fontWeight : String(weight),
      'font-style': s.fontStyle,
      'font-size': `${px(s.fontSize)}px`,
      'font-family': s.fontFamily,
      'font-variant': s.fontVariantCaps,
      'text-transform': s.textTransform,
      'letter-spacing': s.letterSpacing === 'normal' ? '0px' : `${px(s.letterSpacing)}px`,
      'text-decoration': decoration(s),
      outline: outline(s),
      'background-image': s.backgroundImage,
      transform: s.transform,
      filter: s.filter,
      'box-shadow': stripColors(s.boxShadow),
      'text-shadow': stripColors(s.textShadow),
    }
    for (const side of SIDES) shape[`border-${side}`] = border(s, side)
    if (el && s.display === 'list-item') shape['list-style'] = s.listStyleType
    return shape
  }
  const colorsOf = (s: CSSStyleDeclaration, el: Element | null): Record<string, string> => {
    const colors: Record<string, string> = {
      color: norm(s.color),
      'background-color': norm(s.backgroundColor),
      opacity: String(Math.round((Number.parseFloat(s.opacity) || 0) * 100) / 100),
    }
    if (s.webkitTextFillColor && norm(s.webkitTextFillColor) !== colors.color) colors['-webkit-text-fill-color'] = norm(s.webkitTextFillColor)
    for (const side of SIDES) if (border(s, side) !== 'none') colors[`border-${side}-color`] = norm(s.getPropertyValue(`border-${side}-color`))
    if (outline(s) !== 'none') colors['outline-color'] = norm(s.outlineColor)
    if (decoration(s) !== 'none') colors['text-decoration-color'] = norm(s.textDecorationColor)
    if (s.boxShadow && s.boxShadow !== 'none') colors['box-shadow'] = s.boxShadow
    if (s.textShadow && s.textShadow !== 'none') colors['text-shadow'] = s.textShadow
    if (el instanceof SVGElement) {
      colors.fill = norm(s.fill)
      colors.stroke = norm(s.stroke)
    }
    return colors
  }
  const PSEUDOS = ['::before', '::after'] as const
  const pseudoContent = (s: CSSStyleDeclaration): string | null => {
    const content = s.content
    if (!content || content === 'none' || content === 'normal' || s.display === 'none') return null
    return content
  }
  /** Whether a pseudo-element paints anything: text, a picture, or a box with a fill, a border or a shadow. */
  const pseudoPaints = (s: CSSStyleDeclaration): boolean => {
    const content = pseudoContent(s)
    if (content === null) return false
    if (/url\(|counter/.test(content) || content.replace(/^["']|["']$/g, '').trim() !== '') return true
    const width = Number.parseFloat(s.width)
    const height = Number.parseFloat(s.height)
    const box = !(width === 0 || height === 0)
    const fills = rgba(s.backgroundColor)[3] > 0 || s.backgroundImage !== 'none' || SIDES.some((side) => border(s, side) !== 'none') || (s.boxShadow !== 'none' && s.boxShadow !== '')
    return box && fills
  }
  const COLOR_PROPS = new Set(['color', '-webkit-text-fill-color', 'background-color', 'opacity', 'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color', 'outline-color', 'text-decoration-color', 'box-shadow', 'text-shadow', 'fill', 'stroke'])

  /** Visible pictures and painted boxes inside an element, by kind: icons and marks that text does not show. */
  const marksOf = (root: Element): Map<string, number> => {
    const kinds = new Map<string, number>()
    for (const el of Array.from(root.querySelectorAll('svg, img, i, picture, span, b, em, strong, div, small, sup, abbr'))) {
      if (!shown(el) || clippedAway(el)) continue
      if (el.parentElement?.closest('svg') && el.localName !== 'svg') continue
      const tag = el.localName
      let kind = ''
      if (tag === 'svg' || tag === 'img' || tag === 'picture') kind = `icon <${tag}>`
      else {
        const hasText = Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim() !== '')
        const s = getComputedStyle(el)
        if (tag === 'i' && !hasText) kind = 'icon <i>'
        else if (!hasText && el.children.length === 0 && (rgba(s.backgroundColor)[3] > 0 || s.backgroundImage !== 'none' || SIDES.some((side) => border(s, side) !== 'none'))) kind = `mark <${tag}>`
      }
      if (kind) kinds.set(kind, (kinds.get(kind) ?? 0) + 1)
    }
    return kinds
  }
  const MARK_CHARS = /[*✓✔☑•●◆►▶▸→›»«‹←✗✘★☆|]/gu
  const MARK_WORDS = /\((current|atual|actual|selected|selecionad[oa]|seleccionad[oa]|active|ativ[oa]|activ[oa])\)|you are here|você está aqui|está aquí|current page|página atual|página actual/i

  /** How the element `a` (the current one) and its peer `b` differ, on themselves and their pseudo-elements. */
  /** A color as colorsOf writes it (#rrggbb, #rrggbb/alpha, transparent, a shadow), as RGBA. */
  const parseColor = (value: string): [number, number, number, number] | null => {
    if (value === 'transparent') return [0, 0, 0, 0]
    const m = /^#([0-9a-f]{6})(?:\/([\d.]+))?$/.exec(value)
    if (m) {
      const n = Number.parseInt(m[1] ?? '0', 16)
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255, m[2] ? Number(m[2]) : 1]
    }
    const css = /(rgba?|hsla?|color|oklch|oklab|lab|lch)\([^)]*\)/.exec(value)?.[0]
    return css ? rgba(css) : null
  }
  const compareOne = (a: Element, b: Element, node: string, out: Comparison): void => {
    const pairs: Array<[CSSStyleDeclaration, CSSStyleDeclaration, string, Element | null]> = [[getComputedStyle(a), getComputedStyle(b), node, a]]
    for (const pseudo of PSEUDOS) {
      const sa = getComputedStyle(a, pseudo)
      const sb = getComputedStyle(b, pseudo)
      const pa = pseudoPaints(sa)
      const pb = pseudoPaints(sb)
      if (!pa && !pb) continue
      if (pa !== pb) {
        out.cues.push({ prop: 'content', node: `${node}${pseudo}`, current: pa ? short(pseudoContent(sa) ?? '', 40) : 'none', peer: pb ? short(pseudoContent(sb) ?? '', 40) : 'none' })
        continue
      }
      if (pseudoContent(sa) !== pseudoContent(sb)) out.cues.push({ prop: 'content', node: `${node}${pseudo}`, current: short(pseudoContent(sa) ?? '', 40), peer: short(pseudoContent(sb) ?? '', 40) })
      const wa = `${px(sa.width)}×${px(sa.height)}`
      const wb = `${px(sb.width)}×${px(sb.height)}`
      if (wa !== wb) out.cues.push({ prop: 'size', node: `${node}${pseudo}`, current: wa, peer: wb })
      pairs.push([sa, sb, `${node}${pseudo}`, null])
    }
    for (const [sa, sb, where, el] of pairs) {
      const shapeA = shapeOf(sa, el)
      const shapeB = shapeOf(sb, el)
      for (const prop of new Set([...Object.keys(shapeA), ...Object.keys(shapeB)])) {
        const va = shapeA[prop] ?? ''
        const vb = shapeB[prop] ?? ''
        if (va === vb) continue
        if (prop === 'font-size' && Math.abs(Number.parseFloat(va) - Number.parseFloat(vb)) < 0.5) continue
        out.cues.push({ prop, node: where, current: short(va, 60), peer: short(vb, 60) })
      }
      const colorA = colorsOf(sa, el)
      const colorB = colorsOf(sb, el)
      for (const prop of new Set([...Object.keys(colorA), ...Object.keys(colorB)])) {
        const va = colorA[prop] ?? ''
        const vb = colorB[prop] ?? ''
        if (va === vb) continue
        // A shadow on one side only is a shape, already counted.
        if ((prop === 'box-shadow' || prop === 'text-shadow') && (!va || !vb)) continue
        if (!va || !vb) continue
        out.colors.push({ prop, node: where, current: short(va, 60), peer: short(vb, 60) })
        const ca = parseColor(va)
        const cb = parseColor(vb)
        if (ca && cb && prop !== 'opacity') {
          // A background sits on what is behind its element; text, borders and shadows on the element's own background.
          const behind = (el: Element) => backdrop(prop === 'background-color' ? (parentOf(el) ?? el) : el)
          out.contrast = Math.max(out.contrast ?? 1, contrast(over(ca, behind(a)), over(cb, behind(b))))
        }
      }
    }
  }

  /** Compares a current item with a peer: the item roots, the elements, the marks and the visible text. */
  /** The nodes from an item root down to its element, both included. */
  const chainOf = (item: Element, el: Element): Element[] => {
    const chain: Element[] = []
    for (let node: Element | null = el; node; node = node === item ? null : node.parentElement) chain.unshift(node)
    return chain[0] === item ? chain : item === el ? [el] : [item, el]
  }
  /**
   * A wrapper only one side has (the current link wrapped in an `em` that paints a bar): what it paints is a
   * difference. A border, an outline, a shadow, a background image or a pseudo-element that paints is a cue; a
   * background color is a color, which the swap takes away (`peer: null`).
   */
  const wrapperPaint = (node: Element, where: string, side: 'current' | 'peer', out: Comparison, pairs: Pair[] | undefined) => {
    const s = getComputedStyle(node)
    const shapes: Array<[string, string]> = []
    for (const sd of SIDES) if (border(s, sd) !== 'none') shapes.push([`border-${sd}`, border(s, sd)])
    if (outline(s) !== 'none') shapes.push(['outline', outline(s)])
    if (s.boxShadow && s.boxShadow !== 'none') shapes.push(['box-shadow', stripColors(s.boxShadow)])
    if (s.backgroundImage !== 'none') shapes.push(['background-image', short(s.backgroundImage, 40)])
    if (decoration(s) !== 'none') shapes.push(['text-decoration', decoration(s)])
    for (const pseudo of PSEUDOS) if (pseudoPaints(getComputedStyle(node, pseudo))) shapes.push(['content', `${pseudo} ${short(pseudoContent(getComputedStyle(node, pseudo)) ?? '', 30)}`])
    for (const [prop, value] of shapes) out.cues.push({ prop, node: where, current: side === 'current' ? value : 'none', peer: side === 'current' ? 'none' : value })
    const bg = rgba(s.backgroundColor)
    if (bg[3] > 0) {
      const value = norm(s.backgroundColor)
      out.colors.push({ prop: 'background-color', node: where, current: side === 'current' ? value : 'transparent', peer: side === 'current' ? 'transparent' : value })
      if (side === 'current') pairs?.push({ node, peer: null })
    }
  }

  /**
   * Compares a current item with a peer: every node from the item root down to the element (and their
   * pseudo-elements), wrappers only one side has, the item's height, the marks and the visible text. `pairs`, when
   * given, receives the nodes whose colors the gray capture swaps for the peer's.
   */
  const compare = (current: { item: Element; el: Element }, peer: { item: Element; el: Element }, pairs?: Pair[]): Comparison => {
    const out: Comparison = { cues: [], colors: [], marks: [] }
    const a = chainOf(current.item, current.el)
    const b = chainOf(peer.item, peer.el)
    const label = (i: number, n: number, node: Element) => (i === n - 1 ? 'element' : i === 0 ? 'item' : `wrapper <${node.localName}>`)
    const aligned: Array<[Element, Element, string]> = []
    if (a.length === b.length) a.forEach((node, i) => aligned.push([node, b[i] as Element, label(i, a.length, node)]))
    else {
      if (a.length > 1 && b.length > 1) aligned.push([a[0] as Element, b[0] as Element, 'item'])
      aligned.push([a[a.length - 1] as Element, b[b.length - 1] as Element, 'element'])
      for (const node of a.slice(1, -1)) wrapperPaint(node, `wrapper <${node.localName}>`, 'current', out, pairs)
      for (const node of b.slice(1, -1)) wrapperPaint(node, `wrapper <${node.localName}>`, 'peer', out, undefined)
    }
    for (const [node, other, where] of aligned) {
      compareOne(node, other, where, out)
      if (pairs) {
        pairs.push({ node, peer: other })
        for (const pseudo of PSEUDOS) pairs.push({ node, peer: other, pseudo })
      }
    }
    const ra = current.item.getBoundingClientRect()
    const rb = peer.item.getBoundingClientRect()
    if (Math.abs(ra.height - rb.height) >= 3) out.cues.push({ prop: 'height', node: 'item', current: `${px(String(ra.height))}px`, peer: `${px(String(rb.height))}px` })
    const ma = marksOf(current.item)
    const mb = marksOf(peer.item)
    for (const kind of new Set([...ma.keys(), ...mb.keys()])) {
      const ca = ma.get(kind) ?? 0
      const cb = mb.get(kind) ?? 0
      if (ca > cb) out.marks.push(`${kind} only on the current one`)
      else if (cb > ca) out.marks.push(`${kind} only on the others`)
    }
    const ta = visibleText(current.item)
    const tb = visibleText(peer.item)
    const charsA = new Set(ta.match(MARK_CHARS) ?? [])
    const charsB = new Set(tb.match(MARK_CHARS) ?? [])
    for (const c of charsA) if (!charsB.has(c)) out.marks.push(`"${c}" only on the current one`)
    for (const c of charsB) if (!charsA.has(c)) out.marks.push(`"${c}" only on the others`)
    const wa = MARK_WORDS.exec(ta)?.[0]
    if (wa && !MARK_WORDS.test(tb)) out.marks.push(`"${wa}" only on the current one`)
    return out
  }

  // ---- current state ------------------------------------------------------------------------------------------
  const STATE_CLASS = /^(is-|has-)?(active|current|selected)$|[-_](active|current|selected)$|^current[-_](menu|page)[-_](item|ancestor|parent)$/i
  const GROUPS = 'nav, [role="navigation"], [role="tablist"], [role="menubar"], [role="menu"], [role="toolbar"], [role="listbox"], .pagination, .breadcrumb, [aria-label*="pagination" i], [aria-label*="breadcrumb" i]'
  const CONTROL = 'a[href], button, [role="tab"], [role="menuitem"], [role="option"], [role="link"], [role="button"]'
  const stateOf = (el: Element): { state: StateFact['state']; value: string } | null => {
    const current = el.getAttribute('aria-current')
    if (current !== null && current !== '' && current.toLowerCase() !== 'false') return { state: 'aria-current', value: current }
    if (el.getAttribute('aria-selected') === 'true' && /^(tab|option|gridcell|row|treeitem|menuitemradio)$/.test(el.getAttribute('role') ?? '')) return { state: 'aria-selected', value: 'true' }
    if (el.getAttribute('aria-pressed') === 'true') return { state: 'aria-pressed', value: 'true' }
    const token = Array.from(el.classList).find((c) => STATE_CLASS.test(c))
    if (token && el.closest(GROUPS)) return { state: 'class', value: token }
    return null
  }
  const isCurrent = (el: Element): boolean => stateOf(el) !== null || el.getAttribute('aria-selected') === 'true' || Array.from(el.classList).some((c) => STATE_CLASS.test(c))
  const signature = (el: Element) => `${el.localName}|${el.getAttribute('role') ?? ''}`
  /** The steps from an item root down to the element: tag and index among same-tag siblings. */
  const pathTo = (item: Element, el: Element): Array<[string, number]> => {
    const steps: Array<[string, number]> = []
    for (let node: Element = el; node !== item; ) {
      const parent = node.parentElement
      if (!parent) break
      const same = Array.from(parent.children).filter((c) => c.localName === node.localName)
      steps.unshift([node.localName, same.indexOf(node)])
      node = parent
    }
    return steps
  }
  const follow = (item: Element, steps: Array<[string, number]>, sig: string): Element | null => {
    let node: Element | null = item
    for (const [tag, index] of steps) {
      const same: Element[] = node ? Array.from(node.children).filter((c) => c.localName === tag) : []
      node = same[index] ?? same[0] ?? null
      if (!node) break
    }
    if (node && signature(node) === sig) return node
    const [tag] = sig.split('|')
    const found = item.matches(CONTROL) && signature(item) === sig ? item : Array.from(item.querySelectorAll(tag ?? '*')).find((c) => signature(c) === sig)
    return found ?? null
  }
  /** The repeating unit that holds the element, and its peers: the units next to it that hold an element of the same kind. */
  const peersOf = (el: Element): { item: Element; peers: Array<{ item: Element; el: Element }>; found: number } | null => {
    const sig = signature(el)
    let node: Element = el
    for (let depth = 0; depth < 4; depth++) {
      const parent = node.parentElement
      if (!parent) return null
      const steps = pathTo(node, el)
      const siblings = Array.from(parent.children).filter((c) => c !== node && c.localName === node.localName)
      const peers: Array<{ item: Element; el: Element; distance: number }> = []
      for (const sibling of siblings) {
        const match = follow(sibling, steps, sig)
        if (!match || !shown(match) || isCurrent(match) || isCurrent(sibling) || (visibleText(match) === '' && visibleText(el) !== '')) continue
        peers.push({ item: sibling, el: match, distance: Math.abs(Array.from(parent.children).indexOf(sibling) - Array.from(parent.children).indexOf(node)) })
      }
      if (peers.length > 0) {
        peers.sort((a, b) => a.distance - b.distance)
        return { item: node, peers: peers.map(({ item, el: match }) => ({ item, el: match })), found: peers.length }
      }
      if (parent.matches(GROUPS) || parent === document.body) return null
      node = parent
    }
    return null
  }
  const groupName = (el: Element): string => {
    const group = el.closest(GROUPS) ?? el.parentElement
    if (!group) return ''
    const role = group.getAttribute('role')
    const name = group.getAttribute('aria-label') ?? ''
    return `<${group.localName}${role ? ` role=${role}` : ''}>${name ? ` "${short(name, 40)}"` : ''}`
  }

  // Elements whose colors swap with their peer's for one capture, and what to put back.
  type Pair = { node: Element; peer: Element | null; pseudo?: string | undefined }
  const swaps = new Map<string, { pairs: Pair[]; capture: Element[]; peers: Element[] }>()
  type Undo = { el: HTMLElement | SVGElement; prop: string; value: string; priority: string; unstyled: boolean } | { sheet: CSSStyleSheet; root: Document | ShadowRoot } | { attr: Element }
  const undo: Undo[] = []

  const facts: ColorKit['facts'] = (budget) => {
    // Current state.
    const candidates: Array<{ el: Element; state: StateFact['state']; value: string }> = []
    const seen = new Set<Element>()
    const add = (el: Element | null, state: StateFact['state'], value: string) => {
      if (!el || seen.has(el) || !shown(el)) return
      seen.add(el)
      candidates.push({ el, state, value })
    }
    for (const el of deepAll('[aria-current], [aria-selected="true"], [aria-pressed="true"], [class]')) {
      const s = stateOf(el)
      if (!s) continue
      // A state class on a list item belongs to the link or button inside it.
      const target = el.matches(CONTROL) ? el : s.state === 'class' ? el.querySelector(CONTROL) : el
      add(target, s.state, s.value)
    }
    const states: StateFact[] = []
    for (const candidate of candidates) {
      if (states.length >= budget.maxStates) break
      const found = peersOf(candidate.el)
      const fact: StateFact = { el: kit.describe(candidate.el), state: candidate.state, value: candidate.value, group: groupName(candidate.el), peersFound: found?.found ?? 0, peers: [] }
      if (!found) {
        fact.skipped = 'no-peer'
        states.push(fact)
        continue
      }
      if (found.item !== candidate.el) fact.item = kit.describe(found.item)
      const peers = found.peers.slice(0, budget.maxPeers)
      fact.peers = peers.map((p) => kit.describe(p.el))
      // Peers that differ among themselves (each item its own color) say nothing about what marks the current one.
      if (peers.length >= 2) {
        const [p1, p2] = peers as [{ item: Element; el: Element }, { item: Element; el: Element }]
        const among = compare(p1, p2)
        if (among.cues.length > 0 || among.colors.length > 0 || among.marks.length > 0) {
          fact.skipped = 'peers-differ'
          states.push(fact)
          continue
        }
      }
      const first = peers[0] as { item: Element; el: Element }
      const pairs: Pair[] = []
      const comparison = compare({ item: found.item, el: candidate.el }, first, pairs)
      fact.comparison = comparison
      const tc = textColor(candidate.el)
      const tp = textColor(first.el)
      fact.text = { current: hex(tc), peer: hex(tp), contrast: contrast(tc, tp) }
      const key = `s${states.length}`
      swaps.set(key, { pairs, capture: [found.item, candidate.el], peers: peers.map((p) => p.item) })
      ;(fact as StateFact & { key?: string }).key = key
      states.push(fact)
    }

    // Required fields.
    const required: RequiredFact[] = []
    const FIELD = 'input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image]):not([type=file]):not([type=range]):not([type=color]), select, textarea'
    const REQUIRED_WORDS = /\*|required|mandatory|obrigat[óo]ri|requerid|obligatori|necess[áa]ri/i
    const OPTIONAL_WORDS = /optional|opcional|facultativ|não obrigat|no obligatori/i
    const labelOf = (field: Element): Element | null => {
      const labels = Array.from((field as HTMLInputElement).labels ?? [])
      const label = labels.find((l) => shown(l) && !clippedAway(l) && visibleText(l) !== '')
      if (label) return label
      const by = (field.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean)
      for (const id of by) {
        const el = (field.getRootNode() as Document | ShadowRoot).getElementById?.(id)
        if (el && shown(el) && visibleText(el) !== '') return el
      }
      return null
    }
    const forms = new Map<Element, Element[]>()
    for (const field of deepAll(FIELD)) {
      if (!shown(field) || (field as HTMLInputElement).disabled) continue
      const form = field.closest('form') ?? document.body
      forms.set(form, [...(forms.get(form) ?? []), field])
    }
    let requiredFound = 0
    for (const [form, fields] of forms) {
      const isRequired = (f: Element) => (f as HTMLInputElement).required || f.getAttribute('aria-required') === 'true'
      const labeled = fields.map((f) => ({ f, label: labelOf(f) })).filter((x): x is { f: Element; label: Element } => x.label !== null)
      const req = labeled.filter((x) => isRequired(x.f))
      const opt = labeled.filter((x) => !isRequired(x.f))
      if (req.length === 0 || opt.length === 0) continue
      requiredFound++
      if (required.length >= budget.maxRequired) continue
      const r = req[0] as { f: Element; label: Element }
      const o = opt[0] as { f: Element; label: Element }
      const marks: string[] = []
      const reqText = req.map((x) => visibleText(x.label))
      const optText = opt.map((x) => visibleText(x.label))
      const reqMark = reqText.map((t) => REQUIRED_WORDS.exec(t)?.[0]).find(Boolean)
      if (reqMark && req.every((x, i) => REQUIRED_WORDS.test(reqText[i] ?? '') || x.f.getAttribute('placeholder')?.match(REQUIRED_WORDS))) marks.push(`"${reqMark}" on the required labels`)
      const optMark = optText.map((t) => OPTIONAL_WORDS.exec(t)?.[0]).find(Boolean)
      if (optMark && opt.every((_, i) => OPTIONAL_WORDS.test(optText[i] ?? ''))) marks.push(`"${optMark}" on the optional labels`)
      const placeholder = r.f.getAttribute('placeholder') ?? ''
      if (REQUIRED_WORDS.test(placeholder) && !OPTIONAL_WORDS.test(placeholder)) marks.push(`placeholder "${short(placeholder, 40)}"`)
      for (const id of (r.f.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean)) {
        const hint = (r.f.getRootNode() as Document | ShadowRoot).getElementById?.(id)
        const text = hint && shown(hint) ? visibleText(hint) : ''
        if (REQUIRED_WORDS.test(text)) marks.push(`hint "${short(text, 40)}"`)
      }
      const labelPairs: Pair[] = []
      const fieldPairs: Pair[] = []
      const labels = compare({ item: r.label, el: r.label }, { item: o.label, el: o.label }, labelPairs)
      const fieldsCompared = r.f.localName === o.f.localName ? compare({ item: r.f, el: r.f }, { item: o.f, el: o.f }, fieldPairs) : undefined
      const tc = textColor(r.label)
      const tp = textColor(o.label)
      const fact: RequiredFact = {
        form: kit.describe(form),
        field: kit.describe(r.f),
        label: kit.describe(r.label),
        peerField: kit.describe(o.f),
        peerLabel: kit.describe(o.label),
        required: req.length,
        optional: opt.length,
        marks,
        labels,
        ...(fieldsCompared ? { fields: fieldsCompared } : {}),
        text: { current: hex(tc), peer: hex(tp), contrast: contrast(tc, tp) },
      }
      const key = `r${required.length}`
      const labelColors = labels.colors.length > 0
      const pairs: Pair[] = labelColors ? labelPairs : fieldsCompared && fieldsCompared.colors.length > 0 ? fieldPairs : []
      if (pairs.length > 0) {
        fact.measured = labelColors ? 'label' : 'field'
        const shot = labelColors ? r.label : r.f
        swaps.set(key, { pairs, capture: [shot], peers: [labelColors ? o.label : o.f] })
        ;(fact as RequiredFact & { key?: string }).key = key
      }
      required.push(fact)
    }

    // Links in text.
    const links: LinkFact[] = []
    const BLOCK = /^(block|list-item|table-cell|table-caption|flex|grid|flow-root)$/
    const blockOf = (el: Element): Element | null => {
      for (let node = parentOf(el); node; node = parentOf(node)) if (BLOCK.test(getComputedStyle(node).display)) return node
      return null
    }
    const groups = new Map<string, number>()
    // Style rules on :hover, :focus, :focus-visible or :focus-within, each with its selector stripped of those states.
    let stateRules: Array<{ id: number; selector: string }> | undefined
    let unreadableSheets = false
    const STATE_PSEUDO = /:(hover|focus-visible|focus-within|focus|active)\b/g
    const collectStateRules = () => {
      const out: Array<{ id: number; selector: string }> = []
      const visit = (rules: CSSRuleList) => {
        for (const rule of Array.from(rules)) {
          if (rule instanceof CSSStyleRule) {
            if (!STATE_PSEUDO.test(rule.selectorText)) continue
            STATE_PSEUDO.lastIndex = 0
            for (const part of rule.selectorText.split(',')) {
              if (!/:(hover|focus)/.test(part)) continue
              const selector = part.replace(STATE_PSEUDO, '').trim() || '*'
              out.push({ id: out.length, selector })
            }
          } else if ('cssRules' in rule && (rule as CSSGroupingRule).cssRules) visit((rule as CSSGroupingRule).cssRules)
        }
      }
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          visit(sheet.cssRules)
        } catch {
          unreadableSheets = true
        }
      }
      return out
    }
    const stateRulesOf = (el: Element): string => {
      stateRules ??= collectStateRules()
      if (unreadableSheets) return `own:${kit.cssPath(el)}`
      return stateRules
        .filter((rule) => {
          try {
            return el.matches(rule.selector) || el.matches(`${rule.selector} *`)
          } catch {
            return false
          }
        })
        .map((rule) => rule.id)
        .join(',')
    }
    let linksFound = 0
    for (const link of deepAll('a[href]')) {
      if (!shown(link) || (link.getAttribute('role') ?? 'link') !== 'link') continue
      const s = getComputedStyle(link)
      if (s.display !== 'inline') continue
      const text = visibleText(link)
      if (!text) continue
      const block = blockOf(link)
      if (!block) continue
      // In a block of text: the block holds text outside its links.
      const blockText = visibleText(block)
      const linkText = Array.from(block.querySelectorAll('a[href]')).map((a) => visibleText(a)).join('')
      if (blockText.replace(/\s/g, '').length - linkText.replace(/\s/g, '').length < 20) continue
      linksFound++
      if (links.length >= budget.maxLinks) continue
      const bs = getComputedStyle(block)
      const rest: string[] = []
      const deco = decoration(s)
      if (deco !== 'none' && !/underline|overline|line-through/.test(decoration(bs))) rest.push(deco.split(' ')[0] ?? 'underline')
      for (const side of SIDES) if (border(s, side) !== 'none') rest.push(`border-${side}`)
      if (outline(s) !== 'none') rest.push('outline')
      if (s.boxShadow && s.boxShadow !== 'none') rest.push('box-shadow')
      if ((Number.parseInt(s.fontWeight, 10) >= 600) !== (Number.parseInt(bs.fontWeight, 10) >= 600)) rest.push(`font-weight ${s.fontWeight}`)
      if (s.fontStyle !== bs.fontStyle) rest.push(`font-style ${s.fontStyle}`)
      if (s.fontFamily !== bs.fontFamily) rest.push('font-family')
      if (Math.abs(px(s.fontSize) - px(bs.fontSize)) >= 1) rest.push(`font-size ${px(s.fontSize)}px`)
      if (s.textTransform !== bs.textTransform) rest.push(`text-transform ${s.textTransform}`)
      if (s.backgroundImage !== 'none') rest.push('background-image')
      for (const pseudo of PSEUDOS) if (pseudoPaints(getComputedStyle(link, pseudo))) rest.push(pseudo)
      if (Array.from(link.querySelectorAll('svg, img')).some((i) => shown(i) && i.getBoundingClientRect().width >= 6)) rest.push('icon')
      const color = textColor(link)
      const around = textColor(block)
      const fact: LinkFact = { el: kit.describe(link), text: short(text), color: hex(color), around: hex(around), contrast: contrast(color, around), rest, group: 0 }
      const own = rgba(s.backgroundColor)
      if (own[3] > 0) {
        const behind = backdrop(block)
        const bg = over(own, behind)
        fact.background = { color: hex(bg), contrast: contrast(bg, behind) }
      }
      // Links alike at rest may still differ on hover or focus: the style rules for those states that match each are part of its group.
      const sig = [fact.color, fact.around, rest.join(','), s.transition, link.className, stateRulesOf(link)].join('|')
      let group = groups.get(sig)
      if (group === undefined) {
        group = groups.size
        groups.set(sig, group)
      }
      fact.group = group
      links.push(fact)
    }

    // Color words.
    const instructions: InstructionFact[] = []
    const WORD_HUE: Record<string, string> = {}
    const words: Array<[string, string]> = [
      ['red', 'red'], ['vermelho', 'red'], ['vermelha', 'red'], ['vermelhos', 'red'], ['vermelhas', 'red'], ['rojo', 'red'], ['roja', 'red'], ['rojos', 'red'], ['rojas', 'red'],
      ['orange', 'orange'], ['laranja', 'orange'], ['naranja', 'orange'], ['anaranjado', 'orange'],
      ['yellow', 'yellow'], ['amarelo', 'yellow'], ['amarela', 'yellow'], ['amarelos', 'yellow'], ['amarelas', 'yellow'], ['amarillo', 'yellow'], ['amarilla', 'yellow'], ['amarillos', 'yellow'], ['amarillas', 'yellow'],
      ['green', 'green'], ['verde', 'green'], ['verdes', 'green'],
      ['blue', 'blue'], ['azul', 'blue'], ['azuis', 'blue'], ['azules', 'blue'],
      ['purple', 'purple'], ['violet', 'purple'], ['roxo', 'purple'], ['roxa', 'purple'], ['roxos', 'purple'], ['roxas', 'purple'], ['violeta', 'purple'], ['morado', 'purple'], ['morada', 'purple'],
      ['pink', 'pink'], ['magenta', 'pink'], ['rosa', 'pink'], ['rosas', 'pink'], ['rosado', 'pink'], ['rosada', 'pink'],
      ['gray', 'gray'], ['grey', 'gray'], ['cinza', 'gray'], ['cinzas', 'gray'], ['cinzento', 'gray'], ['gris', 'gray'], ['grises', 'gray'],
    ]
    for (const [word, hue] of words) WORD_HUE[word] = hue
    const COLOR = words.map(([word]) => word).join('|')
    const LEAD = 'in|shown in|marked in|highlighted in|displayed in|written in|colou?red|em|na cor|de cor|marcad[oa]s? em|destacad[oa]s? em|indicad[oa]s? em|sinalizad[oa]s? em|escrit[oa]s? em|en|de color|marcad[oa]s? en|resaltad[oa]s? en|indicad[oa]s? en'
    const NOUN_EN = 'fields?|items?|text|labels?|boxes|links?|words?|borders?|ones|options?|cells?|rows?|dots?|icons?|asterisks?|marks?|entries|squares?|circles?'
    const NOUN_PT_ES = 'campos?|itens?|textos?|r[óo]tulos?|caixas?|links?|palavras?|bordas?|op[çc][õo]es|c[ée]lulas?|linhas?|marca[çc][õo]es|asteriscos?|elementos?|etiquetas?|casillas?|enlaces?|opciones|celdas?|filas?|quadrados?|c[íi]rculos?'
    const REF = new RegExp(`\\b(?:${LEAD})\\s+(?:a\\s+|cor\\s+)?(${COLOR})\\b|\\b(${COLOR})\\s+(?:${NOUN_EN})\\b|\\b(?:${NOUN_PT_ES})\\s+(?:(?:em|en)\\s+)?(${COLOR})\\b`, 'i')
    const INFO = /\b(required|mandatory|must|obligatory|errors?|invalid|incorrect|indicat\w*|means?|denot\w*|available|unavailable|selected|current|active|click|select|choose|press)\b|obrigat[óo]ri|\berro|inv[áa]lid|indica|significa|dispon[íi]ve|selecionad|\batual|\bativ[oa]|clique|escolha|selecione|obligatori|requerid|seleccionad|\bactual|haga clic|elija/i
    const OTHER_CUE = /asterisk|asterisco|\*|\bbold\b|negrito|negrita|underlin|sublinhad|subrayad|\bicons?\b|ícone|icono|s[íi]mbolo|\bsymbol|marked with|marcad[oa]s? com|marcad[oa]s? con|\bwith an? (?:star|check)/i
    const targetOf = (sentence: string): InstructionFact['target'] => {
      if (/required|mandatory|obrigat|obligator|requerid|must be (filled|completed)|preench/i.test(sentence)) return 'required'
      if (/error|\berro|invalid|inv[áa]lid|incorrect|incorret/i.test(sentence)) return 'error'
      if (/\blinks?\b|enlace/i.test(sentence)) return 'link'
      return 'generic'
    }
    const blocks = new Set<Element>()
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    const COLOR_WORD = new RegExp(`\\b(?:${COLOR})\\b`, 'i')
    let scanned = 0
    for (let node = walker.nextNode(); node && scanned < 4000; node = walker.nextNode()) {
      const value = node.textContent ?? ''
      if (value.trim().length < 3 || !COLOR_WORD.test(value)) continue
      const parent = node.parentElement
      if (!parent || parent.closest('script, style, noscript, template')) continue
      scanned++
      let block: Element = parent
      while (block.parentElement && !BLOCK.test(getComputedStyle(block).display) && block !== document.body) block = block.parentElement
      blocks.add(block)
    }
    let instructionsFound = 0
    // Elements with their own visible text, and fields, by hue: what an instruction may name.
    let inventory: Array<{ el: Element; hue: string; color: string; what: 'text' | 'border'; kind: Set<string>; mark?: string | undefined }> | undefined
    const takeInventory = () => {
      const list: NonNullable<typeof inventory> = []
      const requiredLabels = new Set<Element>()
      const requiredFields = new Set<Element>()
      for (const field of deepAll(FIELD)) {
        if ((field as HTMLInputElement).required || field.getAttribute('aria-required') === 'true') {
          requiredFields.add(field)
          for (const label of Array.from((field as HTMLInputElement).labels ?? [])) requiredLabels.add(label)
        }
      }
      let count = 0
      for (const el of deepAll('body *')) {
        if (count > 3000) break
        if (/^(script|style|noscript|template|svg|path)$/.test(el.localName)) continue
        const own = Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim() !== '')
        const isField = el.matches(FIELD)
        if (!own && !isField) continue
        if (!shown(el)) continue
        count++
        const kind = new Set<string>(['generic'])
        const label = el.closest('label')
        if (requiredLabels.has(el) || (label && requiredLabels.has(label)) || requiredFields.has(el)) kind.add('required')
        if (/^\s*\*\s*$/.test(el.textContent ?? '') && el.closest('form, label, fieldset')) kind.add('required')
        if (el.getAttribute('role') === 'alert' || /error|erro|invalid|danger/i.test(typeof el.className === 'string' ? el.className : '') || el.getAttribute('aria-invalid') === 'true') kind.add('error')
        if (el.closest('a[href]')) kind.add('link')
        const markText = isField ? visibleText(Array.from((el as HTMLInputElement).labels ?? [])[0] ?? el) : visibleText(label ?? el)
        const mark = REQUIRED_WORDS.exec(markText)?.[0]
        if (own) {
          const c = textColor(el)
          list.push({ el, hue: hueOf(c), color: hex(c), what: 'text', kind, ...(mark ? { mark } : {}) })
        }
        if (isField) {
          const s = getComputedStyle(el)
          const side = SIDES.find((sd) => border(s, sd) !== 'none')
          if (side) {
            const c = rgba(s.getPropertyValue(`border-${side}-color`))
            if (c[3] > 0) list.push({ el, hue: hueOf(c), color: hex(c), what: 'border', kind, ...(mark ? { mark } : {}) })
          }
        }
      }
      return list
    }
    for (const block of blocks) {
      if (!shown(block)) continue
      const text = visibleText(block)
      if (!text || text.length > 4000) continue
      for (const sentence of text.split(/(?<=[.!?;:])\s+|\n+/)) {
        const match = REF.exec(sentence)
        if (!match || sentence.length > 300 || !INFO.test(sentence)) continue
        const word = (match[1] ?? match[2] ?? match[3] ?? '').toLowerCase()
        const hue = WORD_HUE[word]
        if (!hue) continue
        instructionsFound++
        if (instructions.length >= budget.maxInstructions) continue
        inventory ??= takeInventory()
        const target = targetOf(sentence)
        const matchedAll = inventory.filter((item) => item.hue === hue && item.kind.has(target) && item.el !== block && !block.contains(item.el))
        const other = OTHER_CUE.exec(sentence.replace(match[0], ''))?.[0]
        instructions.push({
          el: kit.describe(block),
          quote: sentence.trim(),
          word: match[1] ?? match[2] ?? match[3] ?? word,
          hue: hue as HueKey,
          target,
          ...(other ? { otherCue: other } : {}),
          matched: matchedAll.slice(0, 5).map((item) => ({ el: kit.describe(item.el), color: item.color, what: item.what, ...(item.mark ? { mark: item.mark } : {}) })),
          matchedCount: matchedAll.length,
          unmarked: matchedAll.filter((item) => item.kind.has('required') && !item.mark).length,
        })
      }
    }
    return {
      states,
      required,
      links,
      instructions,
      found: { states: candidates.length, required: requiredFound, links: linksFound, instructions: instructionsFound },
    }
  }

  // ---- captures -----------------------------------------------------------------------------------------------
  const union = (els: Element[]): InPageRect => {
    let left = Number.POSITIVE_INFINITY
    let top = Number.POSITIVE_INFINITY
    let right = Number.NEGATIVE_INFINITY
    let bottom = Number.NEGATIVE_INFINITY
    for (const el of els) {
      const r = el.getBoundingClientRect()
      left = Math.min(left, r.left)
      top = Math.min(top, r.top)
      right = Math.max(right, r.right)
      bottom = Math.max(bottom, r.bottom)
    }
    return { x: left, y: top, width: right - left, height: bottom - top }
  }
  const finish = (els: Element[]) => {
    for (const el of els) {
      for (const animation of el.getAnimations?.({ subtree: true }) ?? []) {
        try {
          if (animation.effect?.getComputedTiming().endTime !== Number.POSITIVE_INFINITY) animation.finish()
        } catch {
          // An animation that cannot finish keeps running.
        }
      }
    }
  }
  const place: ColorKit['place'] = ({ key, peer, halo }) => {
    const entry = swaps.get(key)
    const els = peer === undefined ? entry?.capture : entry?.peers[peer] ? [entry.peers[peer] as Element] : undefined
    if (!els || els.length === 0 || !els.every((el) => el.isConnected && shown(el))) return { status: 'not-shown' }
    let box = union(els)
    const inView = () => box.y - halo >= 0 && box.x - halo >= 0 && box.y + box.height + halo <= window.innerHeight && box.x + box.width + halo <= window.innerWidth
    if (!inView()) {
      ;(els[0] as Element).scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' as ScrollBehavior })
      box = union(els)
    }
    finish(els)
    const x = Math.max(0, Math.floor(box.x - halo))
    const y = Math.max(0, Math.floor(box.y - halo))
    const right = Math.min(window.innerWidth, Math.ceil(box.x + box.width + halo))
    const bottom = Math.min(window.innerHeight, Math.ceil(box.y + box.height + halo))
    if (right - x < 4 || bottom - y < 4) return { status: 'not-shown' }
    return { status: 'ready', box: { x: box.x, y: box.y, width: box.width, height: box.height }, clip: { x, y, width: right - x, height: bottom - y } }
  }
  const swap: ColorKit['swap'] = (key) => {
    const entry = swaps.get(key)
    if (!entry) return null
    for (const { node, peer, pseudo } of entry.pairs) {
      if (!peer) {
        // A wrapper only the current item has: its background goes, as if it were not there.
        const el = node as HTMLElement
        for (const [prop, value] of [['background-color', 'transparent'], ['transition', 'none']] as const) {
          undo.push({ el, prop, value: el.style.getPropertyValue(prop), priority: el.style.getPropertyPriority(prop), unstyled: !el.hasAttribute('style') })
          el.style.setProperty(prop, value, 'important')
        }
        continue
      }
      const a = getComputedStyle(node, pseudo ?? null)
      const b = getComputedStyle(peer, pseudo ?? null)
      if (pseudo && (!pseudoPaints(a) || !pseudoPaints(b))) continue
      const ca = colorsOf(a, pseudo ? null : node)
      const cb = colorsOf(b, pseudo ? null : peer)
      const props = Object.keys(ca).filter((prop) => COLOR_PROPS.has(prop) && cb[prop] !== undefined && cb[prop] !== ca[prop])
      // A property the current one sets and the peer does not (a shadow) stays as it is: it is a shape, counted apart.
      if (props.length === 0) continue
      const value = (prop: string) => (prop === 'box-shadow' ? b.boxShadow : prop === 'text-shadow' ? b.textShadow : b.getPropertyValue(prop))
      if (!pseudo) {
        const el = node as HTMLElement
        for (const prop of [...props, 'transition']) {
          undo.push({ el, prop, value: el.style.getPropertyValue(prop), priority: el.style.getPropertyPriority(prop), unstyled: !el.hasAttribute('style') })
          el.style.setProperty(prop, prop === 'transition' ? 'none' : value(prop), 'important')
        }
        continue
      }
      // Pseudo-elements take no inline style: a rule in a sheet of the element's own root, by a marker attribute.
      const root = node.getRootNode() as Document | ShadowRoot
      const marker = `c8-${undo.length}`
      node.setAttribute('data-rampa-color', marker)
      undo.push({ attr: node })
      try {
        const sheet = new CSSStyleSheet()
        sheet.replaceSync(`[data-rampa-color="${marker}"]${pseudo} { ${props.map((prop) => `${prop}: ${value(prop)} !important;`).join(' ')} transition: none !important; }`)
        root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet]
        undo.push({ sheet, root })
      } catch {
        // A root that takes no adopted sheet keeps its pseudo-element's colors.
      }
    }
    finish(entry.capture)
    return union(entry.capture)
  }
  const restore: ColorKit['restore'] = () => {
    for (let entry = undo.pop(); entry; entry = undo.pop()) {
      if ('sheet' in entry) entry.root.adoptedStyleSheets = entry.root.adoptedStyleSheets.filter((s) => s !== entry.sheet)
      else if ('attr' in entry) entry.attr.removeAttribute('data-rampa-color')
      else {
        if (entry.value) entry.el.style.setProperty(entry.prop, entry.value, entry.priority)
        else entry.el.style.removeProperty(entry.prop)
        if (entry.unstyled && entry.el.getAttribute('style') === '') entry.el.removeAttribute('style')
      }
    }
  }

  // ---- links: hover and focus ---------------------------------------------------------------------------------
  const looks = new Map<string, { shape: Record<string, string>; background: string }>()
  const look = (el: Element) => {
    finish([el])
    const s = getComputedStyle(el)
    const shape = shapeOf(s, el)
    for (const pseudo of PSEUDOS) shape[`${pseudo} paints`] = String(pseudoPaints(getComputedStyle(el, pseudo)))
    for (const pseudo of PSEUDOS) {
      const ps = getComputedStyle(el, pseudo)
      if (pseudoPaints(ps)) {
        shape[`${pseudo} size`] = `${px(ps.width)}×${px(ps.height)}`
        shape[`${pseudo} transform`] = ps.transform
        shape[`${pseudo} opacity`] = ps.opacity
      }
    }
    return { shape, background: norm(s.backgroundColor) }
  }
  const linkRest: ColorKit['linkRest'] = (ref) => {
    const el = kit.resolve(ref)
    if (!el || !shown(el)) return null
    const r0 = el.getBoundingClientRect()
    if (r0.top < 0 || r0.bottom > window.innerHeight || r0.left < 0 || r0.right > window.innerWidth) el.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior })
    looks.set(ref, look(el))
    // The first line of the link: an inline link that wraps has a box wider than its text.
    const rects = Array.from(el.getClientRects())
    const r = rects[0] ?? el.getBoundingClientRect()
    return { x: r.x, y: r.y, width: r.width, height: r.height }
  }
  const linkNow: ColorKit['linkNow'] = (ref) => {
    const el = kit.resolve(ref)
    const before = looks.get(ref)
    if (!el || !before) return { cues: [], focusVisible: false }
    const now = look(el)
    const cues: string[] = []
    for (const prop of Object.keys(now.shape)) {
      if (now.shape[prop] === before.shape[prop]) continue
      if (prop === 'font-size' && Math.abs(Number.parseFloat(now.shape[prop] ?? '0') - Number.parseFloat(before.shape[prop] ?? '0')) < 0.5) continue
      cues.push(`${prop}: ${short(now.shape[prop] ?? '', 40)}`)
    }
    // A background that appears (or goes) is a box around the text, whatever its color.
    if ((now.background === 'transparent') !== (before.background === 'transparent')) cues.push(`background: ${now.background}`)
    let focusVisible = false
    try {
      focusVisible = el.matches(':focus-visible')
    } catch {
      focusVisible = false
    }
    return { cues, focusVisible }
  }
  const focusLink: ColorKit['focusLink'] = (ref) => {
    const el = kit.resolve(ref) as HTMLElement | null
    if (!el) return false
    el.focus({ preventScroll: true })
    return kit.deepActive() === el
  }
  const blurAll: ColorKit['blurAll'] = () => {
    for (let i = 0; i < 3; i++) {
      const active = kit.deepActive() as HTMLElement | null
      if (!active) return
      active.blur()
    }
  }

  w.__rampaColor = { facts, place, swap, restore, linkRest, linkNow, focusLink, blurAll }
}

type Keyed<T> = T & { key?: string | undefined }

async function shoot(page: Page, clip: InPageRect): Promise<RgbaImage | undefined> {
  const png = await page.screenshot({ clip, scale: 'css', caret: 'hide', animations: 'disabled', timeout: 5000 }).catch(() => undefined)
  return png ? tryDecodePng(png) : undefined
}

const relative = (box: InPageRect, clip: InPageRect): InPageRect => ({ x: box.x - clip.x, y: box.y - clip.y, width: box.width, height: box.height })

/**
 * Captures the candidate with its halo twice as it is, then with its peer's colors on, and compares the two in the
 * gray render; then the halo around each peer, for an indicator drawn outside the item.
 */
async function measureGray(page: Page, key: string, peers: number, deadline: number): Promise<GrayMeasure> {
  if (Date.now() > deadline) return { status: 'time' }
  try {
    const placed = await page.evaluate((arg) => (window as unknown as { __rampaColor: ColorKit }).__rampaColor.place(arg), { key, halo: HALO })
    if (placed.status !== 'ready' || !placed.clip || !placed.box) return { status: 'not-shown' }
    const clip = placed.clip
    const first = await shoot(page, clip)
    const again = await shoot(page, clip)
    if (!first || !again) return { status: 'capture-failed', clip }
    if (movedShare(first, again) > 0.002) return { status: 'moving', clip }
    let swapped: RgbaImage | undefined
    try {
      const box = await page.evaluate((k) => (window as unknown as { __rampaColor: ColorKit }).__rampaColor.swap(k), key)
      if (!box || Math.abs(box.x - placed.box.x) > 1 || Math.abs(box.y - placed.box.y) > 1) return { status: 'shifted', clip }
      swapped = await shoot(page, clip)
    } finally {
      await page.evaluate(() => (window as unknown as { __rampaColor: ColorKit }).__rampaColor.restore()).catch(() => undefined)
    }
    if (!swapped) return { status: 'capture-failed', clip }
    const change = grayChange(first, swapped)
    const current = ringInk(swapped, relative(placed.box, clip), HALO)
    const rings: BandInk[] = []
    for (let i = 0; i < peers; i++) {
      const at = await page.evaluate((arg) => (window as unknown as { __rampaColor: ColorKit }).__rampaColor.place(arg), { key, peer: i, halo: HALO })
      if (at.status !== 'ready' || !at.clip || !at.box) continue
      const image = await shoot(page, at.clip)
      if (image) rings.push(ringInk(image, relative(at.box, at.clip), HALO))
    }
    return { status: 'measured', clip, area: change.area, colorChanged: change.colorChanged, strong: change.strong, strongest: change.strongest, ring: { current, peers: rings } }
  } catch {
    return { status: 'capture-failed' }
  }
}

/** Hover and focus on one link of each style group: what changes, other than color. */
async function measureLink(page: Page, ref: string, viewport: { width: number; height: number }): Promise<LinkGroupFact> {
  const fact: LinkGroupFact = { ref, hover: null, focus: null }
  try {
    await page.mouse.move(viewport.width - 2, viewport.height - 2)
    await page.evaluate(() => (window as unknown as { __rampaColor: ColorKit }).__rampaColor.blurAll())
    const box = await page.evaluate((r) => (window as unknown as { __rampaColor: ColorKit }).__rampaColor.linkRest(r), ref)
    if (!box) return fact
    await page.mouse.move(box.x + Math.min(box.width / 2, 12), box.y + box.height / 2, { steps: 3 })
    await page.waitForTimeout(150)
    fact.hover = (await page.evaluate((r) => (window as unknown as { __rampaColor: ColorKit }).__rampaColor.linkNow(r), ref)).cues
    await page.mouse.move(viewport.width - 2, viewport.height - 2)
    await page.waitForTimeout(150)
    await page.evaluate((r) => (window as unknown as { __rampaColor: ColorKit }).__rampaColor.linkRest(r), ref)
    const focused = await page.evaluate((r) => (window as unknown as { __rampaColor: ColorKit }).__rampaColor.focusLink(r), ref)
    if (focused) {
      await page.waitForTimeout(150)
      const now = await page.evaluate((r) => (window as unknown as { __rampaColor: ColorKit }).__rampaColor.linkNow(r), ref)
      fact.focus = now.cues
      fact.focusVisible = now.focusVisible
    }
  } catch {
    // A link that went away leaves its group unmeasured.
  } finally {
    await page.evaluate(() => (window as unknown as { __rampaColor: ColorKit }).__rampaColor.blurAll()).catch(() => undefined)
  }
  return fact
}

export async function runColorProbe(browser: Browser, url: string, options: ProbeOptions): Promise<ProbeRecord> {
  const started = Date.now()
  const deadline = started + TIME_BUDGET_MS
  const probe = await openProbePage(browser, url, options, { variant: 'use-of-color' })
  try {
    const page = probe.page
    const viewport = page.viewportSize() ?? probe.conditions.viewport
    await page.mouse.move(viewport.width - 2, viewport.height - 2)
    await page.evaluate(installColorKit)
    const found = await page.evaluate(
      (budget) => (window as unknown as { __rampaColor: ColorKit }).__rampaColor.facts(budget),
      { maxStates: MAX_STATES, maxRequired: MAX_REQUIRED, maxLinks: MAX_LINKS, maxInstructions: MAX_INSTRUCTIONS, maxPeers: MAX_PEERS },
    )
    let end: ColorData['end'] = 'complete'
    let measured = 0
    for (const state of found.states as Array<Keyed<StateFact>>) {
      const key = state.key
      delete state.key
      if (!key || !state.comparison) continue
      // Only an item whose difference from its peers is color alone, with no mark, needs the gray capture.
      if (state.comparison.cues.length > 0 || state.comparison.marks.length > 0 || state.comparison.colors.length === 0) continue
      if (measured >= MAX_STATES_MEASURED) continue
      measured++
      state.gray = await measureGray(page, key, state.peers.length, deadline)
      if (state.gray.status === 'time') end = 'time'
    }
    for (const group of found.required as Array<Keyed<RequiredFact>>) {
      const key = group.key
      delete group.key
      if (!key) continue
      const cues = (group.labels?.cues.length ?? 0) + (group.fields?.cues.length ?? 0) + (group.labels?.marks.length ?? 0) + (group.fields?.marks.length ?? 0) + group.marks.length
      if (cues > 0) continue
      group.gray = await measureGray(page, key, 1, deadline)
      if (group.gray.status === 'time') end = 'time'
    }
    const linkGroups: LinkGroupFact[] = []
    const measuredGroups = new Map<number, number>()
    for (const link of found.links) {
      // Hover and focus matter for links that only color tells apart at rest, with enough lightness for G183.
      if (link.rest.length > 0 || link.contrast < 3 || (link.background?.contrast ?? 0) >= 3 || measuredGroups.has(link.group)) continue
      if (linkGroups.length >= MAX_LINK_GROUPS || Date.now() > deadline) {
        if (Date.now() > deadline) end = 'time'
        continue
      }
      measuredGroups.set(link.group, linkGroups.length)
      linkGroups.push(await measureLink(page, link.el.ref, viewport))
    }
    // Groups renumbered to the measured list; a group never measured has none.
    for (const link of found.links) {
      const index = measuredGroups.get(link.group)
      link.group = index ?? -1
    }
    const data: ColorData = { viewport, ...found, linkGroups, halo: HALO, end }
    return {
      kind: 'color',
      version: COLOR_VERSION,
      conditions: { ...probe.conditions, viewport },
      status: end === 'time' ? 'partial' : 'complete',
      ...(end === 'time' ? { reason: `time budget reached (${TIME_BUDGET_MS / 1000} s)` } : {}),
      guard: probe.guard.log,
      durationMs: Date.now() - started,
      data,
    }
  } finally {
    await probe.context.close()
  }
}

/** The color probe as a step of the probe stage; a probe that fails leaves a skipped record. */
export async function colorProbe(browser: Browser, url: string, options: ProbeOptions): Promise<ProbeRecord[]> {
  const started = Date.now()
  try {
    return [await runColorProbe(browser, url, options)]
  } catch (error) {
    return [skippedRecord('color', COLOR_VERSION, 'use-of-color', `probe failed: ${(error instanceof Error ? error.message : String(error)).split('\n')[0]}`, Date.now() - started)]
  }
}
