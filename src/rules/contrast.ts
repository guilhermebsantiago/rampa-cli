import { truncate } from '../core/util.ts'
import { startTagOf } from '../criteria/shared.ts'
import type { Locale } from '../i18n.ts'
import { formatRatio } from '../pixels/contrast.ts'
import { type PixelContrastFact, type PixelKind, pixelFactOf, pixelRunOf } from '../snapshot/pixel-contrast.ts'
import type { A11yNode, A11ySnapshot } from '../snapshot/schema.ts'
import { walkTree } from '../snapshot/tree.ts'
import type { Hit, RuleCheck, RuleRun } from './types.ts'

/**
 * Pixel rules (wave B3 of docs/plans/wcag-coverage.md): text contrast the collector measured from pixels
 * (surfaces/contrast-capture.ts), judged here with WCAG's thresholds, so a saved snapshot is judged
 * again offline. The reading is ACT's highest possible contrast (afw4f7, 09o5cg):
 *
 * - fail: even the highest contrast between the glyphs and what is behind them is below the threshold;
 * - no failure found: even the lowest contrast reaches it;
 * - review: part of the text reaches it and part does not, or the pixels could not tell.
 */

const UNDERSTANDING = 'https://www.w3.org/WAI/WCAG22/Understanding/'
/** Without fully covered pixels a stroke never shows its own color: below this width, a color read from pixels may be a blend. */
const MIN_STROKE = 3

type Text = Record<Locale, string>
const say = (locale: Locale, text: Text) => text[locale]

/** Large text by WCAG: 18 pt, or 14 pt bold, computed as axe-core does (points rounded up from CSS px). */
export function isLargeText(fontSize: number | undefined, fontWeight: number | undefined): boolean {
  if (!fontSize) return false
  const points = Math.ceil(fontSize * 72) / 96
  return points >= 18 || ((fontWeight ?? 400) >= 700 && points >= 14)
}

export interface ContrastCall {
  outcome: 'fail' | 'pass' | 'review'
  /**
   * below: under the threshold everywhere; enough: over it everywhere; mixed: both; thin, varied: a color read from pixels
   * that may be off; translucent: under the threshold while the element was translucent, which may be a fade under way.
   */
  why: 'below' | 'enough' | 'mixed' | 'thin' | 'varied' | 'translucent' | 'unmeasured'
}

export function contrastCall(fact: PixelContrastFact, threshold: number): ContrastCall {
  if (fact.status !== 'measured' || fact.highest === undefined || fact.lowest === undefined) return { outcome: 'review', why: 'unmeasured' }
  const fromPixels = fact.foregroundFrom !== 'css'
  if (fact.highest < threshold) {
    // A color read from thin strokes may be a blend of the stroke and its background, so lower than it is.
    if (fromPixels && (fact.stroke ?? 0) < MIN_STROKE) return { outcome: 'review', why: 'thin' }
    // A script may have been fading the element in (a reveal tied to the scroll position) when it was captured.
    if (fact.opacity !== undefined && fact.opacity < 1) return { outcome: 'review', why: 'translucent' }
    return { outcome: 'fail', why: 'below' }
  }
  if (fact.lowest >= threshold) {
    // Of many colors (a gradient fill, a picture), the one read may not be the least contrasting.
    if (fromPixels && fact.uniform === false) return { outcome: 'review', why: 'varied' }
    return { outcome: 'pass', why: 'enough' }
  }
  return { outcome: 'review', why: 'mixed' }
}

const AXE_REASONS: Record<string, Text> = {
  bgImage: { en: 'a background image', 'pt-BR': 'uma imagem de fundo' },
  bgGradient: { en: 'a gradient', 'pt-BR': 'um degradê' },
  imgNode: { en: 'an image in the element', 'pt-BR': 'uma imagem no elemento' },
  bgOverlap: { en: 'an element over or under it', 'pt-BR': 'um elemento sobre ou sob ele' },
  complexTextShadows: { en: 'text shadows', 'pt-BR': 'sombras no texto' },
  fgAlpha: { en: 'a translucent text color', 'pt-BR': 'uma cor de texto translúcida' },
  elmPartiallyObscured: { en: 'an element partly over it', 'pt-BR': 'um elemento que o cobre em parte' },
  elmPartiallyObscuring: { en: 'it partly covers other elements', 'pt-BR': 'ele cobre em parte outros elementos' },
  outsideViewport: { en: 'it was outside the viewport', 'pt-BR': 'estava fora da área visível' },
  pseudoContent: { en: 'a pseudo-element', 'pt-BR': 'um pseudoelemento' },
  colorParse: { en: 'a color it could not read', 'pt-BR': 'uma cor que ele não conseguiu ler' },
  default: { en: 'no reason given', 'pt-BR': 'sem motivo informado' },
}

const UNMEASURED: Record<string, Text> = {
  'not-shown': { en: 'it is not shown', 'pt-BR': 'ele não aparece' },
  'outside-page': { en: 'most of it lies outside the page', 'pt-BR': 'a maior parte fica fora da página' },
  clipped: { en: 'most of it is cut off by the box that holds it', 'pt-BR': 'a maior parte é cortada pela caixa que o contém' },
  'too-large': { en: 'it is too large to capture', 'pt-BR': 'é grande demais para capturar' },
  moving: { en: 'a video plays behind it', 'pt-BR': 'um vídeo toca atrás dele' },
  'capture-failed': { en: 'the screenshot could not be taken', 'pt-BR': 'a captura de tela falhou' },
  'size-mismatch': { en: 'its two captures came out different sizes', 'pt-BR': 'as duas capturas saíram de tamanhos diferentes' },
  'no-text-pixels': {
    en: 'its glyphs did not show in the pixels (covered by something, or drawn in a way that making the text transparent does not reach)',
    'pt-BR': 'os glifos não apareceram nos pixels (cobertos por algo, ou desenhados de um jeito que deixar o texto transparente não alcança)',
  },
  unstable: { en: 'what is behind it changed between the two captures', 'pt-BR': 'o que está atrás mudou entre as duas capturas' },
}

const unmeasuredReason = (reason: string | undefined, locale: Locale) => say(locale, UNMEASURED[reason ?? ''] ?? { en: reason ?? 'unknown', 'pt-BR': reason ?? 'desconhecido' })

/** "4.5:1", or "3:1 for large text". */
function thresholdText(large: boolean, locale: Locale): string {
  return large ? say(locale, { en: '3:1 for large text', 'pt-BR': '3:1 para texto grande' }) : say(locale, { en: '4.5:1', 'pt-BR': '4,5:1' })
}

const ratio = (value: unknown, locale: Locale) => {
  const text = formatRatio(Number(value) || 1)
  return locale === 'pt-BR' ? text.replace('.', ',') : text
}

function evidenceOf(fact: PixelContrastFact): string | undefined {
  if (fact.status !== 'measured' || !fact.background) return undefined
  const { common, worst, best } = fact.background
  const range = worst === best ? common : `${common}; ${worst}…${best}`
  const font = fact.fontSize ? ` · ${Math.round(fact.fontSize * 10) / 10}px, ${fact.fontWeight ?? 400}` : ''
  return `${fact.foreground} on ${range} · ${formatRatio(fact.highest ?? 1)} at best, ${formatRatio(fact.lowest ?? 1)} at worst${font}`
}

function factsOf(fact: PixelContrastFact, call: ContrastCall, extra: Record<string, string | number | boolean>): Hit['facts'] {
  return {
    ...extra,
    why: call.why,
    status: fact.status,
    reason: fact.reason ?? '',
    axeReason: fact.axeReason ?? '',
    foreground: fact.foreground ?? '',
    background: fact.background ? (fact.background.worst === fact.background.best ? fact.background.common : `${fact.background.worst}…${fact.background.best}`) : '',
    highest: fact.highest ?? 0,
    lowest: fact.lowest ?? 0,
    opacity: fact.opacity ?? 1,
  }
}

/** "3 not measured, past the limit of 20 per page" for the coverage line; undefined when nothing was left out. */
function leftOutNote(snapshot: A11ySnapshot, kind: PixelKind, locale: Locale): string | undefined {
  const run = pixelRunOf(snapshot.root)
  const count = run?.leftOut[kind] ?? 0
  if (!run || count <= 0) return undefined
  const limit = run.limits[kind] ?? 0
  return run.stopped === 'time'
    ? say(locale, { en: `${count} not measured: the page's time budget ran out`, 'pt-BR': `${count} não medido(s): o tempo da página acabou` })
    : say(locale, { en: `${count} not measured, past the limit of ${limit} per page`, 'pt-BR': `${count} não medido(s), além do limite de ${limit} por página` })
}

function nameOf(node: A11yNode): string {
  return (node.text?.trim() || node.name?.trim() || '').replace(/\s+/g, ' ')
}

/** Text axe-core's color-contrast left undecided, measured against what is behind its glyphs. */
export const pixelContrastRule: RuleCheck = {
  id: 'rampa/pixel-contrast',
  version: '1',
  criteria: ['1.4.3'],
  maturity: 'experimental',
  surfaces: ['web'],
  act: ['afw4f7', '09o5cg'],
  // 09o5cg asks for 7:1: its failed examples may meet 4.5:1, so only its passed and inapplicable pages count.
  actPassedOnly: ['09o5cg'],
  engineRules: ['color-contrast'],
  resolves: ['color-contrast'],
  narrow: true,
  undecidedReview: true,
  help: {
    en: 'Text over an image or a gradient must keep a contrast of 4.5:1 with what is behind it (3:1 for large text)',
    'pt-BR': 'Texto sobre imagem ou degradê precisa manter contraste de 4,5:1 com o que está atrás (3:1 para texto grande)',
  },
  helpUrl: `${UNDERSTANDING}contrast-minimum.html`,
  run(snapshot, _engine, ctx) {
    const hits: Hit[] = []
    const resolved: string[] = []
    for (const node of walkTree(snapshot.root)) {
      const fact = pixelFactOf(node, 'text')
      if (!fact || fact.status === 'exempt') continue
      resolved.push(node.ref)
      const large = isLargeText(fact.fontSize, fact.fontWeight)
      const call = contrastCall(fact, large ? 3 : 4.5)
      if (call.outcome === 'pass') continue
      const text = nameOf(node) || node.ref
      hits.push({
        ref: node.ref,
        outcome: call.outcome,
        subject: text,
        evidence: evidenceOf(fact),
        facts: factsOf(fact, call, { text: truncate(text, 60), large }),
        html: startTagOf(node),
      })
    }
    return withNote({ hits, applicable: resolved.length, resolved }, leftOutNote(snapshot, 'text', ctx.locale))
  },
  message(hit, locale) {
    const f = hit.facts
    const quoted = String(f.text)
    const threshold = thresholdText(f.large === true, locale)
    const because = say(locale, AXE_REASONS[String(f.axeReason)] ?? AXE_REASONS.default ?? { en: '', 'pt-BR': '' })
    const colors = `${f.foreground} ${say(locale, { en: 'on', 'pt-BR': 'sobre' })} ${f.background}`
    switch (f.why) {
      case 'below':
        return say(locale, {
          en: `The text "${quoted}" has at most ${ratio(f.highest, locale)} contrast with what is behind it (${colors}), measured from pixels because axe-core could not decide (${because}). WCAG 1.4.3 asks for ${threshold}.`,
          'pt-BR': `O texto "${quoted}" tem no máximo ${ratio(f.highest, locale)} de contraste com o que está atrás (${colors}), medido nos pixels porque o axe-core não conseguiu decidir (${because}). O WCAG 1.4.3 pede ${threshold}.`,
        })
      case 'mixed':
        return say(locale, {
          en: `Part of the text "${quoted}" has enough contrast and part does not: from ${ratio(f.lowest, locale)} to ${ratio(f.highest, locale)} against what is behind it (${colors}), where WCAG 1.4.3 asks for ${threshold}. Check the part over ${because}.`,
          'pt-BR': `Parte do texto "${quoted}" tem contraste suficiente e parte não: de ${ratio(f.lowest, locale)} a ${ratio(f.highest, locale)} com o que está atrás (${colors}), e o WCAG 1.4.3 pede ${threshold}. Confira a parte sobre ${because}.`,
        })
      case 'translucent':
        return say(locale, {
          en: `The text "${quoted}" has at most ${ratio(f.highest, locale)} contrast with what is behind it (${colors}), but it was translucent when captured (opacity ${f.opacity}): by design, or a fade under way. Check it once the page has settled; WCAG 1.4.3 asks for ${threshold}.`,
          'pt-BR': `O texto "${quoted}" tem no máximo ${ratio(f.highest, locale)} de contraste com o que está atrás (${colors}), mas estava translúcido na captura (opacidade ${String(f.opacity).replace('.', ',')}): de propósito, ou no meio de uma transição. Confira com a página parada; o WCAG 1.4.3 pede ${threshold}.`,
        })
      case 'thin':
      case 'varied':
        return say(locale, {
          en: `The contrast of "${quoted}" reads from ${ratio(f.lowest, locale)} to ${ratio(f.highest, locale)} in the pixels (${colors}), but its color could not be read for sure (${f.why === 'thin' ? 'strokes too thin' : 'many colors in the text'}). WCAG 1.4.3 asks for ${threshold}.`,
          'pt-BR': `O contraste de "${quoted}" vai de ${ratio(f.lowest, locale)} a ${ratio(f.highest, locale)} nos pixels (${colors}), mas a cor do texto não pôde ser lida com certeza (${f.why === 'thin' ? 'traços finos demais' : 'muitas cores no texto'}). O WCAG 1.4.3 pede ${threshold}.`,
        })
      default:
        return say(locale, {
          en: `axe-core could not decide the contrast of "${quoted}" (${because}), and the pixels could not either: ${unmeasuredReason(String(f.reason), locale)}.`,
          'pt-BR': `O axe-core não conseguiu decidir o contraste de "${quoted}" (${because}), e os pixels também não: ${unmeasuredReason(String(f.reason), locale)}.`,
        })
    }
  },
}

/** The placeholder of an empty field: text, which axe-core does not check. */
export const placeholderContrastRule: RuleCheck = {
  id: 'rampa/placeholder-contrast',
  version: '1',
  criteria: ['1.4.3'],
  maturity: 'experimental',
  surfaces: ['web'],
  act: [],
  engineRules: [],
  narrow: true,
  undecidedReview: true,
  help: {
    en: "A field's placeholder is text: it needs a contrast of 4.5:1 with the field (3:1 for large text)",
    'pt-BR': 'O placeholder de um campo é texto: precisa de contraste de 4,5:1 com o campo (3:1 para texto grande)',
  },
  helpUrl: `${UNDERSTANDING}contrast-minimum.html`,
  run(snapshot, _engine, ctx) {
    const hits: Hit[] = []
    let applicable = 0
    for (const node of walkTree(snapshot.root)) {
      const fact = pixelFactOf(node, 'placeholder')
      if (!fact || fact.status === 'exempt') continue
      applicable++
      const large = isLargeText(fact.fontSize, fact.fontWeight)
      const call = contrastCall(fact, large ? 3 : 4.5)
      if (call.outcome === 'pass') continue
      const text = (fact.text ?? '').replace(/\s+/g, ' ').trim() || node.ref
      hits.push({
        ref: node.ref,
        outcome: call.outcome,
        subject: text,
        evidence: evidenceOf(fact),
        facts: factsOf(fact, call, { text: truncate(text, 60), large }),
        html: startTagOf(node),
      })
    }
    return withNote({ hits, applicable }, leftOutNote(snapshot, 'placeholder', ctx.locale))
  },
  message(hit, locale) {
    const f = hit.facts
    const threshold = thresholdText(f.large === true, locale)
    const colors = `${f.foreground} ${say(locale, { en: 'on', 'pt-BR': 'sobre' })} ${f.background}`
    if (f.why === 'below') {
      return say(locale, {
        en: `The placeholder "${f.text}" has a contrast of ${ratio(f.highest, locale)} with the field (${colors}). Placeholder text is text, and WCAG 1.4.3 asks for ${threshold}.`,
        'pt-BR': `O placeholder "${f.text}" tem contraste de ${ratio(f.highest, locale)} com o campo (${colors}). Placeholder é texto, e o WCAG 1.4.3 pede ${threshold}.`,
      })
    }
    if (f.status !== 'measured') {
      return say(locale, {
        en: `The contrast of the placeholder "${f.text}" could not be measured: ${unmeasuredReason(String(f.reason), locale)}.`,
        'pt-BR': `O contraste do placeholder "${f.text}" não pôde ser medido: ${unmeasuredReason(String(f.reason), locale)}.`,
      })
    }
    return say(locale, {
      en: `The placeholder "${f.text}" has a contrast from ${ratio(f.lowest, locale)} to ${ratio(f.highest, locale)} with the field (${colors}), where WCAG 1.4.3 asks for ${threshold}: check it by eye.`,
      'pt-BR': `O placeholder "${f.text}" tem contraste de ${ratio(f.lowest, locale)} a ${ratio(f.highest, locale)} com o campo (${colors}), e o WCAG 1.4.3 pede ${threshold}: confira a olho.`,
    })
  },
}

function withNote(run: RuleRun, note: string | undefined): RuleRun {
  return note ? { ...run, note } : run
}

export const CONTRAST_RULES: readonly RuleCheck[] = [pixelContrastRule, placeholderContrastRule]
