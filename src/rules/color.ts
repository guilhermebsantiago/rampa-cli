import type { Confidence, Finding, ProbeCoverage } from '../core/types.ts'
import type { Locale } from '../i18n.ts'
import type { BandInk } from '../pixels/gray.ts'
import type { ColorData, Comparison, GrayMeasure, InstructionFact, LinkFact, LinkGroupFact, RequiredFact, StateFact, StyleDiff } from '../probes/color.ts'
import { matchNode, nameOf } from '../probes/identity.ts'
import type { A11yNode, ProbeRecord } from '../snapshot/schema.ts'
import { type ProbeRule, type ProbeRuleContext, type ProbeRuleResult, asArray, asRecord, conditionsText, coverageStatus, moreNotListed, probeFinding, say } from './probes.ts'

/**
 * 1.4.1 Use of Color, over the color probe (src/probes/color.ts). Four rules, one per kind of thing the probe reads.
 * Thresholds live here:
 *
 * - WCAG's Understanding for 1.4.1 counts a difference in lightness as a visual distinction of its own when the
 *   relative luminance of the two colors gives a contrast of 3:1 or more. A difference of color fails only when, in
 *   the achromatopsia render, the change it makes stays under 3:1 (LIGHTNESS), and it changed some pixels at all.
 * - "If content relies on the user's ability to accurately perceive or differentiate a particular color", another
 *   indicator is needed whatever the contrast: a sentence that names a color ("fields in red are required").
 */

/** A change of lightness this strong is a distinction of its own (Understanding 1.4.1; G183 for links). */
export const LIGHTNESS = 3
/** A swap of colors that changed fewer pixels than this showed no difference worth the name. */
const MIN_CHANGED = 4
/** An indicator in the halo: at least this many rows of ink more than every peer shows on the same side. */
const RING_EXTRA = 0.5
const MAX_REPORTED = 10

const r2 = (value: number) => Math.round(value * 100) / 100

/** Two #rrggbb colors no channel of which differs by more than a rounding step: the same color to the eye. */
export function sameColor(a: string, b: string): boolean {
  const channels = (hex: string) => {
    const n = Number.parseInt(hex.replace('#', '').slice(0, 6), 16)
    return Number.isNaN(n) ? undefined : [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }
  const x = channels(a)
  const y = channels(b)
  return !!x && !!y && x.every((v, i) => Math.abs(v - (y[i] ?? 0)) <= 8)
}
const ratio = (value: number) => `${r2(value)}:1`

export function diffText(diffs: readonly StyleDiff[], limit = 3): string {
  const where = (d: StyleDiff) => (d.node === 'element' ? '' : ` (${d.node})`)
  const listed = diffs.slice(0, limit).map((d) => `${d.prop}${where(d)} ${d.current} vs ${d.peer}`)
  return `${listed.join('; ')}${diffs.length > limit ? ` (+${diffs.length - limit})` : ''}`
}

/** A side of the halo where the current item shows ink that none of its peers shows. */
export function ringExtra(ring: GrayMeasure['ring']): keyof BandInk | undefined {
  if (!ring || ring.peers.length === 0) return undefined
  for (const side of ['bottom', 'top', 'left', 'right'] as const) {
    const most = Math.max(...ring.peers.map((p) => Number(p[side]) || 0))
    if ((Number(ring.current[side]) || 0) >= most + RING_EXTRA) return side
  }
  return undefined
}

export type GrayVerdict = 'color-only' | 'lightness' | 'invisible' | 'ring' | 'unmeasured'

/**
 * What a difference of color alone comes to: a lightness difference of 3:1 or more, by the style sheet's colors or in
 * the gray capture, is a cue of its own; otherwise the capture must show a change, under 3:1 in gray, with no mark in
 * the halo that the peers lack.
 */
export function grayVerdict(gray: GrayMeasure | undefined, styleContrast?: number): GrayVerdict {
  if ((Number(styleContrast) || 0) >= LIGHTNESS) return 'lightness'
  if (!gray || gray.status !== 'measured') return 'unmeasured'
  if ((Number(gray.colorChanged) || 0) < MIN_CHANGED) return 'invisible'
  if ((Number(gray.strongest) || 0) >= LIGHTNESS) return 'lightness'
  if (ringExtra(gray.ring)) return 'ring'
  return 'color-only'
}

function grayText(gray: GrayMeasure | undefined, halo: number, locale: Locale): string {
  if (!gray || gray.status !== 'measured') {
    const why = gray?.status ?? 'not measured'
    return say(locale, `the gray capture could not be taken (${why})`, `a captura em cinza não pôde ser feita (${why})`)
  }
  return say(
    locale,
    `captured with a halo of ${halo} px, then again with the other item's colors on it: ${gray.colorChanged} px changed color, and in the achromatopsia render (luminance only) the change is at most ${ratio(gray.strongest ?? 1)}, under ${LIGHTNESS}:1; the halo shows no mark the others lack`,
    `capturado com um halo de ${halo} px e de novo com as cores do outro item: ${gray.colorChanged} px mudaram de cor, e na renderização de acromatopsia (só luminância) a mudança chega a ${ratio(gray.strongest ?? 1)}, abaixo de ${LIGHTNESS}:1; o halo não mostra marca que os outros não têm`,
  )
}

const STATE_NAME: Record<StateFact['state'], string> = { 'aria-current': 'aria-current', 'aria-selected': 'aria-selected', 'aria-pressed': 'aria-pressed', class: 'class' }

interface Tally {
  findings: Finding[]
  review: Finding[]
  applicable: number
  unmatched: number
  counts: Record<string, number>
}
const tally = (): Tally => ({ findings: [], review: [], applicable: 0, unmatched: 0, counts: {} })
const bump = (t: Tally, key: string) => {
  t.counts[key] = (t.counts[key] ?? 0) + 1
}

function coverageRow(record: ProbeRecord, rule: string, t: Tally, what: [string, string], notes: string[], locale: Locale): ProbeCoverage {
  const viewport = asRecord(asRecord(record.data).viewport)
  const nothing = t.applicable === 0 && t.findings.length === 0 && t.review.length === 0
  return {
    criterion: '1.4.1',
    method: `probe/color@${record.version}`,
    rule,
    conditions: conditionsText(record, say(locale, `${what[0]} at ${Number(viewport.width) || 0}×${Number(viewport.height) || 0}`, `${what[1]} em ${Number(viewport.width) || 0}×${Number(viewport.height) || 0}`)),
    // One kind of content among the many 1.4.1 covers: a page with none of it says nothing about the criterion.
    status: nothing ? 'not-checked' : coverageStatus(t.findings.length, t.review.length),
    applicable: t.applicable,
    failures: t.findings.length,
    review: t.review.length,
    unmatched: t.unmatched,
    note: notes.filter(Boolean).join('; '),
    maturity: 'experimental',
  }
}

function colorData(record: ProbeRecord): ColorData {
  const data = asRecord(record.data)
  const found = asRecord(data.found)
  return {
    viewport: { width: Number(asRecord(data.viewport).width) || 0, height: Number(asRecord(data.viewport).height) || 0 },
    states: asArray<StateFact>(data.states).filter((s) => s && typeof s.el?.ref === 'string'),
    required: asArray<RequiredFact>(data.required).filter((r) => r && typeof r.field?.ref === 'string'),
    links: asArray<LinkFact>(data.links).filter((l) => l && typeof l.el?.ref === 'string'),
    linkGroups: asArray<LinkGroupFact>(data.linkGroups),
    instructions: asArray<InstructionFact>(data.instructions).filter((i) => i && typeof i.el?.ref === 'string' && typeof i.quote === 'string'),
    found: { states: Number(found.states) || 0, required: Number(found.required) || 0, links: Number(found.links) || 0, instructions: Number(found.instructions) || 0 },
    halo: Number(data.halo) || 8,
    end: data.end === 'time' ? 'time' : 'complete',
  }
}

const cuesOf = (c: Comparison | undefined): number => (c ? asArray(c.cues).length + asArray(c.marks).length : 0)
const colorsIn = (c: Comparison | undefined): StyleDiff[] => (c ? asArray<StyleDiff>(c.colors) : [])

const STATE_TEXT: Record<Locale, { fail: string; review: string }> = {
  en: {
    fail: 'This item is marked as the current or selected one ({state}), and only its color sets it apart from the items next to it: {diffs}. Without color vision the difference disappears. Add a cue that does not rely on color, such as an underline, a border, bold text or an icon (WCAG 1.4.1; G182).',
    review:
      'This item is marked as the current or selected one ({state}), and only its color sets it apart from the items next to it: {diffs}. Rampa could not capture it to see whether the difference has enough lightness to show without color ({why}). Check it.',
  },
  'pt-BR': {
    fail: 'Este item está marcado como o atual ou selecionado ({state}), e só a cor o distingue dos itens ao lado: {diffs}. Sem visão de cores a diferença some. Acrescente uma pista que não dependa de cor, como sublinhado, borda, negrito ou um ícone (WCAG 1.4.1; G182).',
    review:
      'Este item está marcado como o atual ou selecionado ({state}), e só a cor o distingue dos itens ao lado: {diffs}. O Rampa não conseguiu capturá-lo para ver se a diferença tem luminosidade suficiente para aparecer sem cor ({why}). Confira.',
  },
}

/** 1.4.1: a current, selected or pressed item that differs from its peers only by color, gone in the gray render. */
export const colorStateRule: ProbeRule = {
  id: 'rampa/color-only-state',
  kind: 'color',
  variant: 'use-of-color',
  versions: ['1'],
  criteria: ['1.4.1'],
  run(record: ProbeRecord, ctx: ProbeRuleContext): ProbeRuleResult {
    const data = colorData(record)
    const t = tally()
    const text = STATE_TEXT[ctx.locale]
    let failures = 0
    for (const state of data.states) {
      if (state.skipped === 'no-peer') {
        bump(t, 'no-peer')
        continue
      }
      if (state.skipped === 'peers-differ') {
        bump(t, 'peers-differ')
        continue
      }
      const comparison = state.comparison
      if (!comparison) continue
      const node = matchNode(ctx.index, state.el.ref, state.el.id)
      if (!node) {
        t.unmatched++
        continue
      }
      t.applicable++
      if (cuesOf(comparison) > 0) {
        bump(t, 'distinct')
        continue
      }
      const colors = colorsIn(comparison)
      if (colors.length === 0) {
        bump(t, 'same')
        continue
      }
      const verdict = grayVerdict(state.gray, comparison.contrast)
      if (verdict === 'lightness') bump(t, 'lightness')
      else if (verdict === 'invisible') bump(t, 'same')
      else if (verdict === 'ring') bump(t, 'ring')
      if (verdict !== 'color-only' && verdict !== 'unmeasured') continue
      const peer = state.peers[0]
      const stateText = `${STATE_NAME[state.state]}="${state.value}"`
      const textColors = state.text ? say(ctx.locale, `; text ${state.text.current} vs ${state.text.peer}, ${ratio(state.text.contrast)}`, `; texto ${state.text.current} contra ${state.text.peer}, ${ratio(state.text.contrast)}`) : ''
      const evidence = `${nameOf(node, state.el)} (${stateText})${state.group ? say(ctx.locale, ` in ${state.group}`, ` em ${state.group}`) : ''} ${say(ctx.locale, 'against', 'contra')} <${peer?.tag ?? 'element'}> "${peer?.label ?? ''}": ${diffText(colors)}${textColors}; ${grayText(state.gray, data.halo, ctx.locale)}`
      if (verdict === 'unmeasured') {
        if (t.review.length >= MAX_REPORTED) continue
        t.review.push(
          probeFinding({
            criterion: '1.4.1',
            rule: this.id,
            node,
            message: text.review.replace('{state}', stateText).replace('{diffs}', diffText(colors)).replace('{why}', state.gray?.status ?? say(ctx.locale, 'past the budget', 'além do limite')),
            evidence,
            confidence: 'medium',
            subject: `state|${state.state}`,
          }),
        )
        continue
      }
      failures++
      if (t.findings.length >= MAX_REPORTED) continue
      t.findings.push(
        probeFinding({
          criterion: '1.4.1',
          rule: this.id,
          node,
          message: text.fail.replace('{state}', stateText).replace('{diffs}', diffText(colors)),
          evidence,
          confidence: 'high',
          subject: `state|${state.state}`,
        }),
      )
    }
    const c = t.counts
    const notes = [
      say(ctx.locale, `${data.found.states} current or selected item(s) found`, `${data.found.states} item(ns) atual(is) ou selecionado(s) encontrado(s)`),
      c.distinct ? say(ctx.locale, `${c.distinct} set apart by more than color`, `${c.distinct} distinguido(s) por mais que a cor`) : '',
      c.lightness ? say(ctx.locale, `${c.lightness} by color with a lightness difference of ${LIGHTNESS}:1 or more`, `${c.lightness} por cor com diferença de luminosidade de ${LIGHTNESS}:1 ou mais`) : '',
      c.ring ? say(ctx.locale, `${c.ring} with a mark next to it that the others lack`, `${c.ring} com uma marca ao lado que os outros não têm`) : '',
      c.same ? say(ctx.locale, `${c.same} look the same as the items next to them`, `${c.same} parecem iguais aos itens ao lado`) : '',
      c['no-peer'] ? say(ctx.locale, `${c['no-peer']} with no item of the same kind next to them`, `${c['no-peer']} sem item do mesmo tipo ao lado`) : '',
      c['peers-differ'] ? say(ctx.locale, `${c['peers-differ']} whose neighbours differ among themselves`, `${c['peers-differ']} cujos vizinhos diferem entre si`) : '',
      moreNotListed(ctx.locale, failures - t.findings.length),
      data.end === 'time' ? say(ctx.locale, 'time budget reached', 'limite de tempo atingido') : '',
    ]
    return { findings: t.findings, review: t.review, coverage: [coverageRow(record, this.id, t, ['current and selected items against their neighbours', 'itens atuais e selecionados contra os vizinhos'], notes, ctx.locale)] }
  },
}

const REQUIRED_TEXT: Record<Locale, { fail: string; review: string }> = {
  en: {
    fail: 'Required fields differ from optional ones only by color: {diffs}, and no asterisk, word or icon marks them (F81). Mark required fields in a way that does not rely on color, such as "(required)" or an asterisk the form explains (WCAG 1.4.1; G14, G205).',
    review: 'Required fields differ from optional ones only by color: {diffs}. Rampa could not capture them to see whether the difference has enough lightness to show without color ({why}). Check it.',
  },
  'pt-BR': {
    fail: 'Campos obrigatórios só diferem dos opcionais pela cor: {diffs}, e nenhum asterisco, palavra ou ícone os marca (F81). Marque os campos obrigatórios de um jeito que não dependa de cor, como "(obrigatório)" ou um asterisco que o formulário explique (WCAG 1.4.1; G14, G205).',
    review: 'Campos obrigatórios só diferem dos opcionais pela cor: {diffs}. O Rampa não conseguiu capturá-los para ver se a diferença tem luminosidade suficiente para aparecer sem cor ({why}). Confira.',
  },
}

/** 1.4.1 (F81): required fields whose labels or fields differ from the optional ones only by color, gone in gray. */
export const colorRequiredRule: ProbeRule = {
  id: 'rampa/color-only-required',
  kind: 'color',
  variant: 'use-of-color',
  versions: ['1'],
  criteria: ['1.4.1'],
  run(record: ProbeRecord, ctx: ProbeRuleContext): ProbeRuleResult {
    const data = colorData(record)
    const t = tally()
    const text = REQUIRED_TEXT[ctx.locale]
    for (const group of data.required) {
      const node = matchNode(ctx.index, group.field.ref, group.field.id)
      if (!node) {
        t.unmatched++
        continue
      }
      t.applicable++
      if (asArray(group.marks).length > 0 || cuesOf(group.labels) > 0 || cuesOf(group.fields) > 0) {
        bump(t, 'distinct')
        continue
      }
      const colors = [...colorsIn(group.labels).map((d) => ({ ...d, node: say(ctx.locale, 'label', 'rótulo') })), ...colorsIn(group.fields).map((d) => ({ ...d, node: say(ctx.locale, 'field', 'campo') }))]
      if (colors.length === 0) {
        bump(t, 'same')
        continue
      }
      const verdict = grayVerdict(group.gray, Math.max(Number(group.labels?.contrast) || 0, Number(group.fields?.contrast) || 0))
      if (verdict === 'lightness') bump(t, 'lightness')
      else if (verdict === 'invisible') bump(t, 'same')
      else if (verdict === 'ring') bump(t, 'ring')
      if (verdict !== 'color-only' && verdict !== 'unmeasured') continue
      const diffs = say(ctx.locale, `the required "${group.label.label}" against the optional "${group.peerLabel.label}", ${diffText(colors)}`, `o obrigatório "${group.label.label}" contra o opcional "${group.peerLabel.label}", ${diffText(colors)}`)
      const evidence = `${say(ctx.locale, `${group.required} required and ${group.optional} optional field(s) in`, `${group.required} campo(s) obrigatório(s) e ${group.optional} opcional(is) em`)} <${group.form.tag}>; ${diffs}${group.text ? say(ctx.locale, `; label text ${group.text.current} vs ${group.text.peer}, ${ratio(group.text.contrast)}`, `; texto dos rótulos ${group.text.current} contra ${group.text.peer}, ${ratio(group.text.contrast)}`) : ''}; ${grayText(group.gray, data.halo, ctx.locale)}`
      if (verdict === 'unmeasured') {
        t.review.push(probeFinding({ criterion: '1.4.1', rule: this.id, node, message: text.review.replace('{diffs}', diffs).replace('{why}', group.gray?.status ?? say(ctx.locale, 'not measured', 'não medido')), evidence, confidence: 'medium', subject: 'required' }))
        continue
      }
      t.findings.push(probeFinding({ criterion: '1.4.1', rule: this.id, node, message: text.fail.replace('{diffs}', diffs), evidence, confidence: 'high', subject: 'required' }))
    }
    const c = t.counts
    const notes = [
      say(ctx.locale, `${data.found.required} form(s) with required and optional fields`, `${data.found.required} formulário(s) com campos obrigatórios e opcionais`),
      c.distinct ? say(ctx.locale, `${c.distinct} mark required fields by more than color`, `${c.distinct} marcam os obrigatórios com mais que cor`) : '',
      c.lightness ? say(ctx.locale, `${c.lightness} by color with a lightness difference of ${LIGHTNESS}:1 or more`, `${c.lightness} por cor com diferença de luminosidade de ${LIGHTNESS}:1 ou mais`) : '',
      c.same ? say(ctx.locale, `${c.same} show no difference between required and optional fields (3.3.2 asks for one)`, `${c.same} não mostram diferença entre obrigatórios e opcionais (o 3.3.2 pede uma)`) : '',
      c.ring ? say(ctx.locale, `${c.ring} with a mark next to the field`, `${c.ring} com uma marca ao lado do campo`) : '',
    ]
    return { findings: t.findings, review: t.review, coverage: [coverageRow(record, this.id, t, ['required fields against optional ones', 'campos obrigatórios contra opcionais'], notes, ctx.locale)] }
  },
}

const LINK_TEXT: Record<Locale, { fail: string; review: string }> = {
  en: {
    fail: 'This link in a block of text is told apart from the text around it only by its color, and that color has a luminance contrast of {contrast} with the text, under 3:1 (F73). Underline it, or give it another cue that does not rely on color (WCAG 1.4.1; G183).',
    review:
      '{count} link(s) in text are told apart from the text around them only by color ({range} against it, 3:1 or more, which G183 accepts) and gain no other cue {when}. The earlier version of G183, and many audit checklists, also asked for a cue on hover and on focus; WCAG\'s current text does not, so this is not a failure. Check that people can find these links.',
  },
  'pt-BR': {
    fail: 'Este link num bloco de texto só se distingue do texto ao redor pela cor, e essa cor tem contraste de luminância de {contrast} com o texto, abaixo de 3:1 (F73). Sublinhe-o, ou dê a ele outra pista que não dependa de cor (WCAG 1.4.1; G183).',
    review:
      '{count} link(s) em texto só se distinguem do texto ao redor pela cor ({range} contra ele, 3:1 ou mais, o que a G183 aceita) e não ganham outra pista {when}. A versão anterior da G183, e muitas listas de auditoria, também pediam uma pista no hover e no foco; o texto atual da WCAG não pede, então isto não é uma falha. Confira se as pessoas encontram esses links.',
  },
}

/**
 * 1.4.1 (F73, G183): a link in a block of text that only color tells apart from the text around it, with less than
 * 3:1 between the two colors. axe-core's link-in-text-block checks the same at rest; an element it already failed is
 * left to it, and what it left undecided (a background image, a pseudo-element) is settled here. Links at 3:1 or
 * more that gain no cue on hover or focus go to review, once per page: G183's current text accepts them.
 */
export const linkColorRule: ProbeRule = {
  id: 'rampa/link-color-only',
  kind: 'color',
  variant: 'use-of-color',
  versions: ['1'],
  criteria: ['1.4.1'],
  run(record: ProbeRecord, ctx: ProbeRuleContext): ProbeRuleResult {
    const data = colorData(record)
    const t = tally()
    const text = LINK_TEXT[ctx.locale]
    const axeFailed = new Set<string>()
    for (const rule of ctx.engine?.rules ?? []) {
      if (rule.ruleId !== 'link-in-text-block' || rule.outcome !== 'violation') continue
      for (const n of rule.nodes) axeFailed.add(n.ref ?? n.target)
    }
    const resolved: Array<{ engineRule: string; ref: string }> = []
    const quiet: Array<{ node: A11yNode; link: LinkFact; group: LinkGroupFact }> = []
    let failures = 0
    let unmeasured = 0
    for (const link of data.links) {
      const node = matchNode(ctx.index, link.el.ref, link.el.id)
      if (!node) {
        t.unmatched++
        continue
      }
      t.applicable++
      if (axeFailed.has(node.ref)) {
        bump(t, 'axe')
        continue
      }
      resolved.push({ engineRule: 'link-in-text-block', ref: node.ref })
      if (asArray(link.rest).length > 0) {
        bump(t, 'distinct')
        continue
      }
      if (link.background && link.background.contrast >= LIGHTNESS) {
        bump(t, 'distinct')
        continue
      }
      // A link styled exactly like the text around it is not told apart by color either: the Understanding says it does not fail 1.4.1.
      if (sameColor(link.color, link.around) && !link.background) {
        bump(t, 'same')
        continue
      }
      if (link.contrast < LIGHTNESS) {
        failures++
        if (t.findings.length >= MAX_REPORTED) continue
        t.findings.push(
          probeFinding({
            criterion: '1.4.1',
            rule: this.id,
            node,
            message: text.fail.replace('{contrast}', ratio(link.contrast)),
            evidence: say(
              ctx.locale,
              `${nameOf(node, link.el)}: link ${link.color} against text ${link.around}, ${ratio(link.contrast)}; no underline, border, weight, style, icon or pseudo-element sets it apart at rest`,
              `${nameOf(node, link.el)}: link ${link.color} contra texto ${link.around}, ${ratio(link.contrast)}; nenhum sublinhado, borda, peso, estilo, ícone ou pseudoelemento o distingue em repouso`,
            ),
            confidence: 'high',
            subject: 'link',
          }),
        )
        continue
      }
      bump(t, 'lightness')
      const group = link.group >= 0 ? data.linkGroups[link.group] : undefined
      if (!group || group.hover === null || group.focus === null) {
        unmeasured++
        continue
      }
      if (asArray(group.hover).length === 0 || asArray(group.focus).length === 0) quiet.push({ node, link, group })
    }
    // One item for the page: these links meet the current G183, and the hover and focus cue is the older version's.
    const first = quiet[0]
    if (first) {
      const noHover = quiet.filter((q) => asArray(q.group.hover).length === 0).length
      const noFocus = quiet.filter((q) => asArray(q.group.focus).length === 0).length
      const when =
        noHover === quiet.length && noFocus === quiet.length
          ? say(ctx.locale, 'on hover or on focus', 'no hover nem no foco')
          : noHover === quiet.length
            ? say(ctx.locale, 'on hover', 'no hover')
            : noFocus === quiet.length
              ? say(ctx.locale, 'on focus', 'no foco')
              : say(ctx.locale, 'on hover or on focus, for some of them', 'no hover ou no foco, em alguns')
      const contrasts = quiet.map((q) => q.link.contrast)
      const range = `${ratio(Math.min(...contrasts))}${Math.max(...contrasts) !== Math.min(...contrasts) ? `–${ratio(Math.max(...contrasts))}` : ''}`
      const samples = quiet.slice(0, 5).map((q) => `"${q.link.text}" ${q.link.color}/${q.link.around}`)
      const measured = (g: LinkGroupFact) =>
        say(ctx.locale, `hover: ${asArray(g.hover).join(', ') || 'nothing'}; focus: ${asArray(g.focus).join(', ') || 'nothing'}`, `hover: ${asArray(g.hover).join(', ') || 'nada'}; foco: ${asArray(g.focus).join(', ') || 'nada'}`)
      t.review.push(
        probeFinding({
          criterion: '1.4.1',
          rule: this.id,
          node: first.node,
          message: text.review.replace('{count}', String(quiet.length)).replace('{range}', range).replace('{when}', when),
          evidence: `${samples.join(', ')}${quiet.length > 5 ? ` (+${quiet.length - 5})` : ''}; ${measured(first.group)}`,
          confidence: 'low',
          subject: 'link-hover-focus',
        }),
      )
    }
    const c = t.counts
    const groups = data.linkGroups.length
    const notes = [
      say(ctx.locale, `${data.found.links} link(s) in blocks of text`, `${data.found.links} link(s) em blocos de texto`),
      data.found.links > data.links.length ? say(ctx.locale, `the first ${data.links.length} read (budget)`, `os primeiros ${data.links.length} lidos (limite)`) : '',
      c.distinct ? say(ctx.locale, `${c.distinct} set apart by more than color`, `${c.distinct} distinguido(s) por mais que a cor`) : '',
      c.same ? say(ctx.locale, `${c.same} styled like the text around them, which 1.4.1 does not fail`, `${c.same} com o mesmo estilo do texto ao redor, o que o 1.4.1 não reprova`) : '',
      c.lightness ? say(ctx.locale, `${c.lightness} by color at ${LIGHTNESS}:1 or more against the text (G183)`, `${c.lightness} por cor a ${LIGHTNESS}:1 ou mais contra o texto (G183)`) : '',
      c.axe ? say(ctx.locale, `${c.axe} already failed by axe-core's link-in-text-block`, `${c.axe} já reprovado(s) pelo link-in-text-block do axe-core`) : '',
      groups > 0 ? say(ctx.locale, `hover and focus measured on ${groups} style(s) of link`, `hover e foco medidos em ${groups} estilo(s) de link`) : '',
      unmeasured > 0 ? say(ctx.locale, `${unmeasured} not hovered or focused (budget)`, `${unmeasured} sem hover nem foco (limite)`) : '',
      moreNotListed(ctx.locale, failures - t.findings.length),
    ]
    return {
      findings: t.findings,
      review: t.review,
      coverage: [coverageRow(record, this.id, t, ['links in text against the text around them, at rest, on hover and on focus', 'links em texto contra o texto ao redor, em repouso, no hover e no foco'], notes, ctx.locale)],
      ...(resolved.length > 0 ? { resolved } : {}),
    }
  },
}

const TARGET_NAME: Record<InstructionFact['target'], Record<Locale, string>> = {
  required: { en: 'required fields (labels, fields and asterisks)', 'pt-BR': 'campos obrigatórios (rótulos, campos e asteriscos)' },
  error: { en: 'errors (invalid fields and error messages)', 'pt-BR': 'erros (campos inválidos e mensagens de erro)' },
  link: { en: 'links', 'pt-BR': 'links' },
  generic: { en: 'any text or field on the page', 'pt-BR': 'qualquer texto ou campo da página' },
}

const WORDS_TEXT: Record<Locale, { fail: string; none: string; review: string }> = {
  en: {
    fail: 'The text "{quote}" tells people which fields are required by a color ({word}), and {count} of the {word} labels or fields carry no other mark (F81). People who cannot tell {word} apart miss it. Mark required fields in a way that does not rely on color, such as an asterisk or "(required)", and say so in the text (WCAG 1.4.1; G14).',
    none: 'The text "{quote}" refers to a color ({word}) to convey something, but nothing it seems to refer to on this page is {word}. Check what it refers to: an image, a chart, or text whose color changed.',
    review: 'The text "{quote}" conveys something by a color ({word}): {count} element(s) on the page are {word}, such as {samples}. If nothing but the color marks them, people who cannot tell {word} apart miss it (WCAG 1.4.1; G14). Check them.',
  },
  'pt-BR': {
    fail: 'O texto "{quote}" indica quais campos são obrigatórios por uma cor ({word}), e {count} dos rótulos ou campos nessa cor não têm outra marca (F81). Quem não distingue essa cor perde a informação. Marque os campos obrigatórios de um jeito que não dependa de cor, como um asterisco ou "(obrigatório)", e diga isso no texto (WCAG 1.4.1; G14).',
    none: 'O texto "{quote}" se refere a uma cor ({word}) para transmitir algo, mas nada a que ele parece se referir nesta página tem essa cor. Confira a que ele se refere: uma imagem, um gráfico, ou um texto cuja cor mudou.',
    review: 'O texto "{quote}" transmite algo por uma cor ({word}): {count} elemento(s) da página têm essa cor, como {samples}. Se só a cor os marca, quem não distingue essa cor perde a informação (WCAG 1.4.1; G14). Confira.',
  },
}

/**
 * 1.4.1: a sentence that refers to a color to convey something ("Fields in red are required"), quoted, and checked
 * against the hue of what it names. The Understanding asks for another indicator whatever the contrast when content
 * relies on perceiving a particular color. Required fields can be checked for a text mark, so they can fail; the
 * rest goes to review with the elements found.
 */
export const colorWordsRule: ProbeRule = {
  id: 'rampa/color-words',
  kind: 'color',
  variant: 'use-of-color',
  versions: ['1'],
  criteria: ['1.4.1'],
  run(record: ProbeRecord, ctx: ProbeRuleContext): ProbeRuleResult {
    const data = colorData(record)
    const t = tally()
    const text = WORDS_TEXT[ctx.locale]
    for (const instruction of data.instructions) {
      const node = matchNode(ctx.index, instruction.el.ref, instruction.el.id)
      if (!node) {
        t.unmatched++
        continue
      }
      t.applicable++
      if (instruction.otherCue) {
        bump(t, 'cue')
        continue
      }
      const quote = instruction.quote.length > 160 ? `${instruction.quote.slice(0, 159)}…` : instruction.quote
      const matched = asArray<InstructionFact['matched'][number]>(instruction.matched)
      const samples = matched
        .slice(0, 3)
        .map((m) => `<${m.el.tag}>${m.el.label ? ` "${m.el.label.length > 30 ? `${m.el.label.slice(0, 29)}…` : m.el.label}"` : ''} (${m.what === 'border' ? say(ctx.locale, 'border', 'borda') : say(ctx.locale, 'text', 'texto')} ${m.color})`)
        .join(', ')
      const kind = TARGET_NAME[instruction.target]?.[ctx.locale] ?? instruction.target
      const evidence = say(
        ctx.locale,
        `"${quote}" names ${instruction.word} (hue ${instruction.hue}) for ${kind}; ${instruction.matchedCount} of them have that hue${samples ? `: ${samples}` : ''}${instruction.target === 'required' ? `; ${instruction.unmarked} without a text mark` : ''}`,
        `"${quote}" cita ${instruction.word} (matiz ${instruction.hue}) para ${kind}; ${instruction.matchedCount} deles têm esse matiz${samples ? `: ${samples}` : ''}${instruction.target === 'required' ? `; ${instruction.unmarked} sem marca em texto` : ''}`,
      )
      const fill = (template: string, count: number) =>
        template.replace('{quote}', quote).replaceAll('{word}', instruction.word).replace('{count}', String(count)).replace('{samples}', samples)
      const subject = `words|${instruction.quote}`
      if (instruction.matchedCount === 0) {
        t.review.push(probeFinding({ criterion: '1.4.1', rule: this.id, node, message: fill(text.none, 0), evidence, confidence: 'low', subject }))
        continue
      }
      if (instruction.target === 'required') {
        if (instruction.unmarked > 0) {
          t.findings.push(probeFinding({ criterion: '1.4.1', rule: this.id, node, message: fill(text.fail, instruction.unmarked), evidence, confidence: 'medium' as Confidence, subject }))
        } else bump(t, 'marked')
        continue
      }
      t.review.push(probeFinding({ criterion: '1.4.1', rule: this.id, node, message: fill(text.review, instruction.matchedCount), evidence, confidence: 'low', subject }))
    }
    const c = t.counts
    const notes = [
      say(ctx.locale, `${data.found.instructions} sentence(s) that convey something by a color`, `${data.found.instructions} frase(s) que transmitem algo por uma cor`),
      c.cue ? say(ctx.locale, `${c.cue} also name a cue other than color`, `${c.cue} também citam uma pista além da cor`) : '',
      c.marked ? say(ctx.locale, `${c.marked} whose colored fields also carry a text mark`, `${c.marked} cujos campos coloridos também têm marca em texto`) : '',
    ]
    return { findings: t.findings, review: t.review, coverage: [coverageRow(record, this.id, t, ['sentences that name a color, against the hue of what they name', 'frases que citam uma cor, contra o matiz do que nomeiam'], notes, ctx.locale)] }
  },
}

export const COLOR_RULES: readonly ProbeRule[] = [colorStateRule, colorRequiredRule, linkColorRule, colorWordsRule]
