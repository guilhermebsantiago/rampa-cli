import type { Finding, ProbeCoverage } from '../core/types.ts'
import type { Locale } from '../i18n.ts'
import { formatRatio } from '../pixels/contrast.ts'
import { type IndicatorColor, type StateChange, cssContrast } from '../pixels/indicator.ts'
import type { FocusIndicator, FocusStop } from '../probes/focus.ts'
import { matchNode, nameOf } from '../probes/identity.ts'
import { STATES_VARIANT, type IndicatorStateFact, type StatesData, type StyleChange, type TextStateFact } from '../probes/states.ts'
import type { PixelContrastFact } from '../snapshot/pixel-contrast.ts'
import type { ProbeRecord } from '../snapshot/schema.ts'
import { contrastCall, isLargeText } from './contrast.ts'
import { walkOf } from './keyboard.ts'
import { type ProbeRule, type ProbeRuleContext, type ProbeRuleResult, asArray, asRecord, conditionsText, coverageStatus, moreNotListed, probeFinding, say } from './probes.ts'

/**
 * Contrast in states (C15 of docs/plans/wcag-coverage.md), read from probe records:
 *
 * - `rampa/focus-indicator-contrast` (1.4.11): the focus indicator the keyboard walk captured (probes/focus.ts),
 *   as the main colors of the pixels that change on focus against the colors next to them in the focused state.
 * - `rampa/state-text-contrast` (1.4.3): text measured in its hover and focus states (probes/states.ts).
 * - `rampa/state-indicator-contrast` (1.4.11): the indicator of a selected, current, pressed or checked item.
 *
 * Thresholds live here. The Understanding for 1.4.11 asks 3:1 of a state's visual indicator against its adjacent
 * colors; it exempts the browser's default focus style and inactive components, and leaves a change of background
 * inside a focused component out of scope (its Figure 15). An indicator passes when one of its main colors reaches
 * 3:1 with a color next to it (the Understanding's Figure 11: partly inside, partly outside a button). Everything is
 * experimental until the evaluation gate (4.9).
 */

const MAX_REPORTED = 10
const NON_TEXT = 3
const FOCUS_VERSIONS = ['2'] as const
/** Fewer changed pixels outside the text than this share of the item's perimeter: its text alone shows the state. */
const MIN_INDICATOR_SHARE = 0.25
/** Text styles that show a state without color: bold, an underline… */
const TEXT_CUES = new Set(['font-weight', 'font-style', 'font-size', 'text-decoration-line', 'text-transform', 'letter-spacing'])

type Tally = Record<string, number>
const bump = (tally: Tally, key: string) => {
  tally[key] = (tally[key] ?? 0) + 1
}

const ratio = (value: number, locale: Locale) => {
  const text = formatRatio(value)
  return locale === 'pt-BR' ? text.replace('.', ',') : text
}

/** Where the changed pixels are, relative to the component's box. */
function placeOf(change: StateChange, locale: Locale): string {
  const total = Math.max(1, change.inside + change.outside)
  if (change.part === 'outside' || change.outside / total >= 0.6) return say(locale, 'around it', 'em volta dele')
  if (change.inside / total >= 0.6) return say(locale, 'inside it', 'dentro dele')
  return say(locale, 'on and around it', 'nele e em volta dele')
}

/** "#cccccc next to #ffffff (90%), #0b5394 (12%): 1.61:1" for the main colors of an indicator. */
function colorsText(colors: readonly IndicatorColor[], locale: Locale): string {
  return colors
    .map((c) => {
      const next = c.adjacent.length > 0 ? c.adjacent.map((a) => `${a.color} (${Math.round(a.share * 100)}%)`).join(', ') : say(locale, 'no single color', 'nenhuma cor única')
      return say(locale, `${c.color} (${c.pixels} px) next to ${next}: ${ratio(c.contrast, locale)}`, `${c.color} (${c.pixels} px) ao lado de ${next}: ${ratio(c.contrast, locale)}`)
    })
    .join('; ')
}

/** The best contrast a style sheet color that changed reaches against the measured adjacent colors. */
function cssBest(styles: ReadonlyArray<{ prop: string; value: string }>, colors: readonly IndicatorColor[]): { prop: string; value: string; contrast: number } | undefined {
  let best: { prop: string; value: string; contrast: number } | undefined
  for (const style of styles) {
    for (const color of colors) {
      for (const next of color.adjacent) {
        const contrast = cssContrast(style.value, next.color)
        if (contrast !== undefined && (!best || contrast > best.contrast)) best = { ...style, contrast }
      }
    }
  }
  return best
}

/** Colors from a box-shadow value: each `#rrggbb(aa)` in it. */
const shadowColors = (value: string) => value.match(/#[0-9a-f]{6}(?:[0-9a-f]{2})?\b/gi) ?? []

/**
 * The colors of the style properties that changed on focus and draw something: an outline, a border or an underline
 * that is there in the focused state, and box shadows. The text's own color is not a ring; the pixels measure it.
 */
function indicatorStyles(indicator: FocusIndicator): Array<{ prop: string; value: string }> {
  const out: Array<{ prop: string; value: string }> = []
  const styles = asArray<{ prop: string; focused: string; blurred: string }>(indicator.styles)
  const changed = new Set(styles.map((s) => s.prop))
  // The focused value of a property: from the changes, or from what the element draws when it did not change.
  const drawnValues = asRecord(indicator.drawn)
  const value = (prop: string) => styles.find((s) => s.prop === prop)?.focused ?? (typeof drawnValues[prop] === 'string' ? (drawnValues[prop] as string) : undefined)
  const drawn = (style: string | undefined, width: string | undefined) => style !== undefined && style !== 'none' && style !== 'hidden' && Number.parseFloat(width ?? '0') > 0
  if (['outline-color', 'outline-style', 'outline-width'].some((p) => changed.has(p))) {
    const color = value('outline-color')
    if (color && drawn(value('outline-style'), value('outline-width'))) out.push({ prop: 'outline-color', value: color })
  }
  for (const side of ['top', 'right', 'bottom', 'left']) {
    const color = value(`border-${side}-color`)
    if (color && changed.has(`border-${side}-color`) && drawn(value(`border-${side}-style`), value(`border-${side}-width`))) out.push({ prop: `border-${side}-color`, value: color })
  }
  const shadow = value('box-shadow')
  if (shadow) for (const color of shadowColors(shadow)) out.push({ prop: 'box-shadow', value: color })
  const decoration = value('text-decoration-color')
  if (decoration && changed.has('text-decoration-line') && value('text-decoration-line') !== 'none') out.push({ prop: 'text-decoration-color', value: decoration })
  return out
}

const FOCUS_TEXT: Record<Locale, { fail: (colors: string, place: string, best: string) => string; busy: string; css: string }> = {
  en: {
    fail: (colors, place, best) =>
      `When this element has keyboard focus, its focus indicator (${colors}, ${place}) has a contrast of ${best} at most with the colors next to it, under the 3:1 that WCAG 1.4.11 asks of visual information needed to identify a state. Give the indicator a color with at least 3:1 against what surrounds it, such as an outline of 2 px that is dark on a light page.`,
    busy: 'When this element has keyboard focus, its focus indicator is under 3:1 against the pixels next to it, but no single color surrounds it (an image, a gradient): check that the indicator stands out from what is behind it (WCAG 1.4.11).',
    css: 'When this element has keyboard focus, the pixels of its focus indicator are under 3:1 against the colors next to it, but the color the style sheet gives it reaches 3:1: the indicator may be too thin to show its own color (anti-aliasing). Check that it can be seen (WCAG 1.4.11).',
  },
  'pt-BR': {
    fail: (colors, place, best) =>
      `Quando este elemento recebe o foco do teclado, o indicador de foco (${colors}, ${place}) tem contraste de no máximo ${best} com as cores ao lado, abaixo dos 3:1 que a WCAG 1.4.11 pede para informação visual necessária para identificar um estado. Dê ao indicador uma cor com pelo menos 3:1 contra o que o cerca, como um contorno de 2 px escuro numa página clara.`,
    busy: 'Quando este elemento recebe o foco do teclado, o indicador de foco fica abaixo de 3:1 contra os pixels ao lado, mas nenhuma cor única o cerca (uma imagem, um degradê): confira se o indicador se destaca do que está atrás (WCAG 1.4.11).',
    css: 'Quando este elemento recebe o foco do teclado, os pixels do indicador de foco ficam abaixo de 3:1 contra as cores ao lado, mas a cor que a folha de estilo dá a ele chega a 3:1: o indicador pode ser fino demais para mostrar a própria cor (suavização). Confira se ele é visível (WCAG 1.4.11).',
  },
}

/**
 * 1.4.11 for focus indicators, from the keyboard walk's focused and blurred captures. Not judged: the browser's own
 * ring (exempt), a change of background inside the component (out of scope), no change (2.4.7's to report), stops
 * recorded before Rampa measured indicators. Under 3:1 against every significant adjacent color: failure, unless no
 * single color surrounds the indicator or the style sheet's color reaches 3:1 (review).
 */
export const focusIndicatorRule: ProbeRule = {
  id: 'rampa/focus-indicator-contrast',
  kind: 'keyboard',
  variant: 'keyboard-walk',
  versions: FOCUS_VERSIONS,
  criteria: ['1.4.11'],
  run(record: ProbeRecord, ctx: ProbeRuleContext): ProbeRuleResult {
    const walk = walkOf(record)
    const text = FOCUS_TEXT[ctx.locale]
    const findings: Finding[] = []
    const review: Finding[] = []
    const tally: Tally = {}
    let applicable = 0
    let failures = 0
    let unmatched = 0
    const seen = new Set<string>()
    for (const stop of walk.forward as FocusStop[]) {
      if (!stop.el || seen.has(stop.el.ref)) continue
      seen.add(stop.el.ref)
      const pixels = stop.focus
      if (!pixels || pixels.skipped || !pixels.diff || pixels.diff.changed === 0) continue
      const indicator = pixels.indicator
      const change = indicator?.change
      if (!indicator || !change || !Array.isArray(change.colors)) {
        bump(tally, 'old')
        continue
      }
      applicable++
      if (indicator.browserRing) {
        bump(tally, 'browser')
        continue
      }
      if (change.part === 'fill') {
        bump(tally, 'fill')
        continue
      }
      if (change.judged === 0 || change.colors.length === 0 || change.contrast >= NON_TEXT) continue
      const node = matchNode(ctx.index, stop.el.ref, stop.el.id)
      if (!node) {
        unmatched++
        continue
      }
      const keys = `Tab ×${stop.n}`
      const place = placeOf(change, ctx.locale)
      const styles = indicatorStyles(indicator)
      const css = cssBest(styles, change.colors)
      const measured = say(
        ctx.locale,
        `${keys}: ${nameOf(node, stop.el)} focused and blurred; ${change.judged} px of its indicator ${place}: ${colorsText(change.colors, ctx.locale)}`,
        `${keys}: ${nameOf(node, stop.el)} com e sem foco; ${change.judged} px do indicador ${place}: ${colorsText(change.colors, ctx.locale)}`,
      )
      const styleText = styles.length > 0 ? say(ctx.locale, `; style sheet: ${styles.map((s) => `${s.prop} ${s.value}`).join(', ')}`, `; folha de estilo: ${styles.map((s) => `${s.prop} ${s.value}`).join(', ')}`) : ''
      if (!change.colors.some((c) => c.adjacent.length > 0)) {
        review.push(probeFinding({ criterion: '1.4.11', rule: this.id, node, message: text.busy, evidence: `${measured}${styleText}`, confidence: 'low', subject: 'focus-indicator-busy' }))
        continue
      }
      if (css && css.contrast >= NON_TEXT) {
        review.push(probeFinding({ criterion: '1.4.11', rule: this.id, node, message: text.css, evidence: `${measured}${styleText} (${css.prop} ${css.value}: ${ratio(css.contrast, ctx.locale)})`, confidence: 'low', subject: 'focus-indicator-css' }))
        continue
      }
      failures++
      if (findings.length >= MAX_REPORTED) continue
      const perimeter = 2 * (pixels.box.width + pixels.box.height)
      const main = change.colors.map((c) => c.color).join(', ')
      findings.push(
        probeFinding({
          criterion: '1.4.11',
          rule: this.id,
          node,
          message: text.fail(main, place, ratio(change.contrast, ctx.locale)),
          evidence: `${measured}${styleText}`,
          // A ring at least a pixel wide all round, with the style sheet agreeing, is a clear reading.
          confidence: change.judged >= perimeter ? 'high' : 'medium',
          subject: 'focus-indicator',
        }),
      )
    }
    const notes = [
      moreNotListed(ctx.locale, failures - findings.length),
      tally.browser ? say(ctx.locale, `${tally.browser} with the browser's own focus ring, which 1.4.11 exempts`, `${tally.browser} com o anel de foco do próprio navegador, que a 1.4.11 isenta`) : '',
      tally.fill
        ? say(ctx.locale, `${tally.fill} whose focus changes the background inside the component, which 1.4.11 leaves out of scope (Understanding, Figure 15)`, `${tally.fill} cujo foco muda o fundo dentro do componente, o que a 1.4.11 deixa fora do escopo (Understanding, Figura 15)`)
        : '',
      tally.old ? say(ctx.locale, `${tally.old} stop(s) recorded without the indicator's colors (an older recording)`, `${tally.old} parada(s) gravada(s) sem as cores do indicador (uma gravação mais antiga)`) : '',
    ].filter(Boolean)
    const coverage: ProbeCoverage = {
      criterion: '1.4.11',
      method: `probe/keyboard@${record.version}`,
      rule: this.id,
      conditions: conditionsText(record, say(ctx.locale, `focus indicators against the colors next to them, at ${walk.viewport.width}×${walk.viewport.height}`, `indicadores de foco contra as cores ao lado, em ${walk.viewport.width}×${walk.viewport.height}`)),
      status: applicable === 0 && tally.old ? 'not-checked' : coverageStatus(failures, review.length),
      applicable,
      failures,
      review: review.length,
      unmatched,
      ...(notes.length > 0 ? { note: notes.join('; ') } : {}),
      maturity: 'experimental',
    }
    return { findings, review, coverage: [coverage] }
  },
}

/** The states probe's data read back from a record: a snapshot is input, so every list is checked. */
export function statesData(record: ProbeRecord): StatesData {
  const data = asRecord(record.data)
  const found = asRecord(data.found)
  const viewport = asRecord(data.viewport)
  const facts = <T extends { el?: unknown }>(value: unknown) => asArray<T>(value).filter((fact) => fact && typeof (fact.el as { ref?: unknown } | undefined)?.ref === 'string')
  return {
    viewport: { width: Number(viewport.width) || 0, height: Number(viewport.height) || 0 },
    hover: facts<TextStateFact>(data.hover),
    focus: facts<TextStateFact>(data.focus),
    selected: facts<IndicatorStateFact>(data.selected),
    found: { controls: Number(found.controls) || 0, groups: Number(found.groups) || 0, disabled: Number(found.disabled) || 0, selected: Number(found.selected) || 0, disabledSelected: Number(found.disabledSelected) || 0 },
    halo: Number(data.halo) || 0,
    end: data.end === 'time' ? 'time' : 'complete',
  }
}

const UNMEASURED: Record<string, [string, string]> = {
  'not-shown': ['it is not shown', 'ele não aparece'],
  'outside-page': ['most of it lies outside the page', 'a maior parte fica fora da página'],
  clipped: ['most of it is cut off by the box that holds it', 'a maior parte é cortada pela caixa que o contém'],
  'too-large': ['it is too large to capture', 'é grande demais para capturar'],
  moving: ['what is behind it moves on its own', 'o que está atrás se move sozinho'],
  shifted: ['it moved between the captures', 'ele se moveu entre as capturas'],
  'capture-failed': ['the screenshot could not be taken', 'a captura de tela falhou'],
  'size-mismatch': ['its captures came out different sizes', 'as capturas saíram de tamanhos diferentes'],
  'no-text-pixels': ['its glyphs did not show in the pixels', 'os glifos não apareceram nos pixels'],
  unstable: ['what is behind it changed between the captures', 'o que está atrás mudou entre as capturas'],
}
const unmeasured = (reason: string | undefined, locale: Locale) => {
  const pair = UNMEASURED[reason ?? '']
  return pair ? say(locale, pair[0], pair[1]) : (reason ?? '')
}

const STATE_NAME: Record<Locale, Record<'hover' | 'focus', string>> = {
  en: { hover: 'When the pointer is over this control (hover)', focus: 'When this control has focus' },
  'pt-BR': { hover: 'Quando o ponteiro está sobre este controle (hover)', focus: 'Quando este controle tem o foco' },
}

const changesText = (changed: readonly StyleChange[]) =>
  changed
    .slice(0, 4)
    .map((c) => `${c.prop} ${c.rest} → ${c.now}`)
    .join(', ')

function measureText(fact: PixelContrastFact, locale: Locale): string {
  const bg = fact.background ? (fact.background.worst === fact.background.best ? fact.background.common : `${fact.background.worst}…${fact.background.best}`) : '?'
  const font = fact.fontSize ? ` · ${Math.round(fact.fontSize * 10) / 10}px, ${fact.fontWeight ?? 400}` : ''
  return say(
    locale,
    `${fact.foreground ?? '?'} on ${bg}: ${ratio(fact.highest ?? 1, locale)} at best, ${ratio(fact.lowest ?? 1, locale)} at worst${font}`,
    `${fact.foreground ?? '?'} sobre ${bg}: ${ratio(fact.highest ?? 1, locale)} no melhor ponto, ${ratio(fact.lowest ?? 1, locale)} no pior${font}`,
  )
}

/**
 * 1.4.3 in the hover and focus states: text whose color, or whatever is behind it, changes in the state, measured
 * from pixels there. Even the highest contrast below the threshold: failure. Part above and part below, or a reading
 * that is not sure (thin strokes, a translucent element): review. A control axe-core already failed at rest is left
 * to it. Disabled controls are exempt and never measured.
 */
export const stateTextRule: ProbeRule = {
  id: 'rampa/state-text-contrast',
  kind: 'states',
  variant: STATES_VARIANT,
  versions: ['1'],
  criteria: ['1.4.3'],
  run(record: ProbeRecord, ctx: ProbeRuleContext): ProbeRuleResult {
    const data = statesData(record)
    const findings: Finding[] = []
    const review: Finding[] = []
    const tally: Tally = {}
    let applicable = 0
    let failures = 0
    let unmatched = 0
    const axeFailed = new Set<string>()
    for (const rule of ctx.engine?.rules ?? []) {
      if (rule.ruleId !== 'color-contrast' || rule.outcome !== 'violation') continue
      for (const n of rule.nodes) axeFailed.add(n.ref ?? n.target)
    }
    for (const fact of [...data.hover, ...data.focus]) {
      const changed = asArray<StyleChange>(fact.changed)
      if (changed.length === 0) {
        bump(tally, 'same')
        continue
      }
      const node = matchNode(ctx.index, fact.el.ref, fact.el.id)
      if (!node) {
        unmatched++
        continue
      }
      applicable++
      if (axeFailed.has(node.ref) || (fact.text && axeFailed.has(fact.text))) {
        bump(tally, 'axe')
        continue
      }
      const measure = fact.measure
      const state = fact.state === 'focus' ? 'focus' : 'hover'
      const lead = STATE_NAME[ctx.locale][state]
      const alike = fact.alike > 1 ? say(ctx.locale, ` (and ${fact.alike - 1} alike control(s))`, ` (e ${fact.alike - 1} controle(s) igual(is))`) : ''
      const what = say(ctx.locale, `${state}: ${nameOf(node, fact.el)}${alike}; changed: ${changesText(changed)}`, `${state}: ${nameOf(node, fact.el)}${alike}; mudou: ${changesText(changed)}`)
      if (!measure || measure.status !== 'measured') {
        review.push(
          probeFinding({
            criterion: '1.4.3',
            rule: this.id,
            node,
            message: say(
              ctx.locale,
              `${lead}, the color of its text or of what is behind it changes, and Rampa could not measure the contrast there (${unmeasured(measure?.reason, ctx.locale) || 'not measured'}). Check that the text keeps 4.5:1 (3:1 when large) in this state (WCAG 1.4.3).`,
              `${lead}, a cor do texto ou do que está atrás dele muda, e o Rampa não conseguiu medir o contraste nesse estado (${unmeasured(measure?.reason, ctx.locale) || 'não medido'}). Confira se o texto mantém 4,5:1 (3:1 quando grande) nesse estado (WCAG 1.4.3).`,
            ),
            evidence: what,
            confidence: 'low',
            subject: `state-text-${state}-unmeasured`,
          }),
        )
        continue
      }
      const large = isLargeText(measure.fontSize, measure.fontWeight)
      const threshold = large ? 3 : 4.5
      const call = contrastCall(measure, threshold)
      if (call.outcome === 'pass') continue
      const need = large ? say(ctx.locale, '3:1 for large text', '3:1 para texto grande') : say(ctx.locale, '4.5:1', '4,5:1')
      const evidence = `${what}; ${measureText(measure, ctx.locale)}`
      if (call.outcome === 'fail') {
        failures++
        if (findings.length >= MAX_REPORTED) continue
        findings.push(
          probeFinding({
            criterion: '1.4.3',
            rule: this.id,
            node,
            message: say(
              ctx.locale,
              `${lead}, its text has a contrast of ${ratio(measure.highest ?? 1, ctx.locale)} at best with what is behind it, under the ${need} WCAG 1.4.3 asks. Text must keep its contrast in every state a person puts it in; change the ${state} colors.`,
              `${lead}, o texto tem contraste de no máximo ${ratio(measure.highest ?? 1, ctx.locale)} com o que está atrás dele, abaixo dos ${need} que a WCAG 1.4.3 pede. O texto precisa manter o contraste em todo estado em que a pessoa o coloca; mude as cores de ${state}.`,
            ),
            evidence,
            confidence: measure.foregroundFrom === 'css' ? 'high' : 'medium',
            subject: `state-text-${state}`,
          }),
        )
        continue
      }
      review.push(
        probeFinding({
          criterion: '1.4.3',
          rule: this.id,
          node,
          message: say(
            ctx.locale,
            `${lead}, part of its text reaches ${need} against what is behind it and part does not, or the pixels cannot say for sure (${call.why}). Check the text in this state (WCAG 1.4.3).`,
            `${lead}, parte do texto chega a ${need} contra o que está atrás dele e parte não, ou os pixels não dão certeza (${call.why}). Confira o texto nesse estado (WCAG 1.4.3).`,
          ),
          evidence,
          confidence: 'low',
          subject: `state-text-${state}-review`,
        }),
      )
    }
    const tried = data.hover.length + data.focus.length
    const notes = [
      moreNotListed(ctx.locale, failures - findings.length),
      say(
        ctx.locale,
        `${data.found.controls} control(s) with text in ${data.found.groups} style(s); ${data.hover.length} hovered and ${data.focus.length} focused; ${tally.same ?? 0} kept their colors`,
        `${data.found.controls} controle(s) com texto em ${data.found.groups} estilo(s); ${data.hover.length} com hover e ${data.focus.length} com foco; ${tally.same ?? 0} mantiveram as cores`,
      ),
      tally.axe ? say(ctx.locale, `${tally.axe} already failed at rest by axe-core`, `${tally.axe} já reprovado(s) em repouso pelo axe-core`) : '',
      data.found.disabled ? say(ctx.locale, `${data.found.disabled} disabled, exempt`, `${data.found.disabled} desabilitado(s), isento(s)`) : '',
      data.end === 'time' ? say(ctx.locale, 'the time budget ran out', 'o tempo acabou') : '',
    ].filter(Boolean)
    return {
      findings,
      review,
      coverage: [
        {
          criterion: '1.4.3',
          method: `probe/states@${record.version}`,
          rule: this.id,
          conditions: conditionsText(record, say(ctx.locale, `text in hover and focus states at ${data.viewport.width}×${data.viewport.height}`, `texto nos estados de hover e foco em ${data.viewport.width}×${data.viewport.height}`)),
          status: tried === 0 ? 'not-checked' : coverageStatus(failures, review.length),
          applicable,
          failures,
          review: review.length,
          unmatched,
          ...(notes.length > 0 ? { note: notes.join('; ') } : {}),
          maturity: 'experimental',
        },
      ],
    }
  },
}

const MARK_TEXT: Record<Locale, (mark: string) => string> = {
  en: (mark) => `This item is marked as the current or selected one (${mark})`,
  'pt-BR': (mark) => `Este item está marcado como o atual ou selecionado (${mark})`,
}

/**
 * 1.4.11 for the indicator of a selected, current, pressed or checked item: the pixels that change when its marks
 * are taken off, its text left out. Under 3:1 against the colors next to it, with nothing in its text showing the
 * state: failure. With only a change of text color besides, or no single color around it, or a capture that failed:
 * review. A bolder or underlined text shows the state on its own, and the indicator is then supplemental.
 */
export const stateIndicatorRule: ProbeRule = {
  id: 'rampa/state-indicator-contrast',
  kind: 'states',
  variant: STATES_VARIANT,
  versions: ['1'],
  criteria: ['1.4.11'],
  run(record: ProbeRecord, ctx: ProbeRuleContext): ProbeRuleResult {
    const data = statesData(record)
    const findings: Finding[] = []
    const review: Finding[] = []
    const tally: Tally = {}
    let applicable = 0
    let failures = 0
    let unmatched = 0
    for (const fact of data.selected) {
      const node = matchNode(ctx.index, fact.el.ref, fact.el.id)
      if (!node) {
        unmatched++
        continue
      }
      const mark = `${fact.state === 'class' ? `class "${fact.value}"` : `${fact.state}="${fact.value}"`}`
      const lead = MARK_TEXT[ctx.locale](mark)
      if (fact.status !== 'measured' || !fact.change) {
        if (fact.status === 'moving' || fact.status === 'shifted' || fact.status === 'capture-failed') {
          applicable++
          review.push(
            probeFinding({
              criterion: '1.4.11',
              rule: this.id,
              node,
              message: say(ctx.locale, `${lead}, and Rampa could not capture it to measure how its state shows (${unmeasured(fact.status, ctx.locale)}). Check that the indicator of its state has 3:1 against the colors next to it (WCAG 1.4.11).`, `${lead}, e o Rampa não conseguiu capturá-lo para medir como o estado aparece (${unmeasured(fact.status, ctx.locale)}). Confira se o indicador do estado tem 3:1 contra as cores ao lado (WCAG 1.4.11).`),
              evidence: say(ctx.locale, `marks: ${fact.removed.join(', ')}`, `marcas: ${fact.removed.join(', ')}`),
              confidence: 'low',
              subject: 'state-indicator-unmeasured',
            }),
          )
        } else bump(tally, fact.status)
        continue
      }
      const change = fact.change
      applicable++
      if (change.changed === 0) {
        bump(tally, 'unchanged')
        continue
      }
      const box = fact.clip ? { width: Math.max(0, fact.clip.width - 2 * data.halo), height: Math.max(0, fact.clip.height - 2 * data.halo) } : { width: 0, height: 0 }
      const perimeter = 2 * (box.width + box.height)
      if (change.judged < Math.max(4, perimeter * MIN_INDICATOR_SHARE) || change.colors.length === 0) {
        bump(tally, 'text')
        continue
      }
      if (change.contrast >= NON_TEXT) continue
      const text = asArray<StyleChange>(fact.text)
      const cues = text.filter((t) => TEXT_CUES.has(t.prop))
      if (cues.length > 0) {
        bump(tally, 'supplemental')
        continue
      }
      const place = placeOf(change, ctx.locale)
      const evidence = say(
        ctx.locale,
        `marks taken off: ${fact.removed.join(', ')}; ${change.changed} px changed, ${change.judged} outside its text, ${place}: ${colorsText(change.colors, ctx.locale)}${text.length > 0 ? `; its text: ${changesText(text)}` : '; its text does not change'}`,
        `marcas retiradas: ${fact.removed.join(', ')}; ${change.changed} px mudaram, ${change.judged} fora do texto, ${place}: ${colorsText(change.colors, ctx.locale)}${text.length > 0 ? `; o texto: ${changesText(text)}` : '; o texto não muda'}`,
      )
      if (!change.colors.some((c) => c.adjacent.length > 0)) {
        review.push(probeFinding({ criterion: '1.4.11', rule: this.id, node, message: say(ctx.locale, `${lead}. Its indicator is under 3:1 against the pixels next to it, but no single color surrounds it (an image, a gradient): check that it stands out (WCAG 1.4.11).`, `${lead}. O indicador fica abaixo de 3:1 contra os pixels ao lado, mas nenhuma cor única o cerca (uma imagem, um degradê): confira se ele se destaca (WCAG 1.4.11).`), evidence, confidence: 'low', subject: 'state-indicator-busy' }))
        continue
      }
      if (text.some((t) => t.prop === 'color')) {
        review.push(
          probeFinding({
            criterion: '1.4.11',
            rule: this.id,
            node,
            message: say(
              ctx.locale,
              `${lead}. Its state shows by a change of its text color and by an indicator (${change.colors.map((c) => c.color).join(', ')}, ${place}) with ${ratio(change.contrast, ctx.locale)} at most against the colors next to it, under 3:1. Check that the state can be told without the indicator, or give it 3:1 (WCAG 1.4.11; 1.4.1 for the color alone).`,
              `${lead}. O estado aparece por uma mudança na cor do texto e por um indicador (${change.colors.map((c) => c.color).join(', ')}, ${place}) com no máximo ${ratio(change.contrast, ctx.locale)} contra as cores ao lado, abaixo de 3:1. Confira se dá para perceber o estado sem o indicador, ou dê a ele 3:1 (WCAG 1.4.11; 1.4.1 para a cor sozinha).`,
            ),
            evidence,
            confidence: 'medium',
            subject: 'state-indicator-color',
          }),
        )
        continue
      }
      failures++
      if (findings.length >= MAX_REPORTED) continue
      findings.push(
        probeFinding({
          criterion: '1.4.11',
          rule: this.id,
          node,
          message: say(
            ctx.locale,
            `${lead}, and the only thing that shows it is an indicator (${change.colors.map((c) => c.color).join(', ')}, ${place}) with a contrast of ${ratio(change.contrast, ctx.locale)} at most with the colors next to it, under the 3:1 WCAG 1.4.11 asks of visual information needed to identify a state. Give the indicator 3:1 against what surrounds it, or add a cue in the text (bold, an underline).`,
            `${lead}, e a única coisa que mostra isso é um indicador (${change.colors.map((c) => c.color).join(', ')}, ${place}) com contraste de no máximo ${ratio(change.contrast, ctx.locale)} com as cores ao lado, abaixo dos 3:1 que a WCAG 1.4.11 pede para informação visual necessária para identificar um estado. Dê ao indicador 3:1 contra o que o cerca, ou acrescente uma marca no texto (negrito, sublinhado).`,
          ),
          evidence,
          confidence: 'medium',
          subject: 'state-indicator',
        }),
      )
    }
    const notes = [
      moreNotListed(ctx.locale, failures - findings.length),
      say(ctx.locale, `${data.found.selected} selected, current, pressed or checked item(s) found, ${data.selected.length} captured`, `${data.found.selected} item(ns) selecionado(s), atual(is), pressionado(s) ou marcado(s), ${data.selected.length} capturado(s)`),
      tally.text ? say(ctx.locale, `${tally.text} shown by their text alone`, `${tally.text} mostrado(s) só pelo texto`) : '',
      tally.supplemental ? say(ctx.locale, `${tally.supplemental} with an indicator under 3:1 next to a bolder or underlined text, which shows the state on its own`, `${tally.supplemental} com indicador abaixo de 3:1 ao lado de texto em negrito ou sublinhado, que mostra o estado sozinho`) : '',
      tally.unchanged ? say(ctx.locale, `${tally.unchanged} looked the same with their marks taken off (the page shows the state another way, or not at all)`, `${tally.unchanged} ficaram iguais sem as marcas (a página mostra o estado de outro jeito, ou não mostra)`) : '',
      data.found.disabledSelected ? say(ctx.locale, `${data.found.disabledSelected} disabled, exempt`, `${data.found.disabledSelected} desabilitado(s), isento(s)`) : '',
    ].filter(Boolean)
    return {
      findings,
      review,
      coverage: [
        {
          criterion: '1.4.11',
          method: `probe/states@${record.version}`,
          rule: this.id,
          conditions: conditionsText(record, say(ctx.locale, `selected and current items with their marks on and off at ${data.viewport.width}×${data.viewport.height}`, `itens selecionados e atuais com e sem as marcas em ${data.viewport.width}×${data.viewport.height}`)),
          status: data.selected.length === 0 ? 'not-checked' : coverageStatus(failures, review.length),
          applicable,
          failures,
          review: review.length,
          unmatched,
          ...(notes.length > 0 ? { note: notes.join('; ') } : {}),
          maturity: 'experimental',
        },
      ],
    }
  },
}

export const STATE_CONTRAST_RULES: readonly ProbeRule[] = [focusIndicatorRule, stateTextRule, stateIndicatorRule]
