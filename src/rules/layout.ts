import type { Finding, ProbeCoverage } from '../core/types.ts'
import type { Locale } from '../i18n.ts'
import { matchNode, nameOf } from '../probes/identity.ts'
import { type LayoutBox, type LayoutMeasure, partlyClipped, pastRightEdge, wholeBox } from '../probes/layout.ts'
import type { A11yNode, ProbeRecord } from '../snapshot/schema.ts'
import { type ProbeRule, type ProbeRuleContext, asArray, asRecord, conditionsText, coverageStatus, probeFinding } from './probes.ts'

/** Findings per rule and kind; the rest are counted in the coverage line, never dropped silently. */
const MAX_REPORTED = 10

/** Reads a measure back from a record: a snapshot is input, so every field is checked. */
export function measureOf(value: unknown): LayoutMeasure {
  const data = asRecord(value)
  const viewport = asRecord(data.viewport)
  return {
    viewport: { width: Number(viewport.width) || 0, height: Number(viewport.height) || 0 },
    clientWidth: Number(data.clientWidth) || 0,
    scrollWidth: Number(data.scrollWidth) || 0,
    scrollsX: data.scrollsX === true,
    measured: Number(data.measured) || 0,
    boxes: asArray<LayoutBox>(data.boxes).filter((box) => typeof box?.ref === 'string' && box.rect && box.cut),
    overlaps: asArray<LayoutMeasure['overlaps'][number]>(data.overlaps).filter((o) => typeof o?.a === 'string' && typeof o?.b === 'string'),
    truncated: data.truncated === true,
  }
}

const r1 = (value: number) => Math.round(value)

function cutText(box: LayoutBox): string {
  const across = box.cut.left + box.cut.right
  const down = box.cut.top + box.cut.bottom
  return [across >= 1 ? `${r1(across)} px cut across` : '', down >= 1 ? `${r1(down)} px cut down` : ''].filter(Boolean).join(', ')
}

function clipperName(ctx: ProbeRuleContext, box: LayoutBox): string {
  if (!box.clipBy) return 'an ancestor'
  const node = ctx.index.get(box.clipBy)?.node
  return node ? `<${String(node.native.tag ?? 'element')}> ${box.clipBy}` : box.clipBy
}

interface Hit {
  box: LayoutBox
  node: A11yNode
}

/** Partly cut after the change, whole before it, on the same page: the comparison both layout rules make. */
function clippedHits(ctx: ProbeRuleContext, before: LayoutMeasure, after: LayoutMeasure, skip: (box: LayoutBox) => boolean) {
  const baseline = new Map(before.boxes.map((box) => [box.ref, box]))
  const hits: Hit[] = []
  let unmatched = 0
  for (const box of after.boxes) {
    if (skip(box) || !partlyClipped(box) || !wholeBox(baseline.get(box.ref))) continue
    const node = matchNode(ctx.index, box.ref, box.id)
    if (!node) unmatched++
    else hits.push({ box, node })
  }
  return { hits, unmatched }
}

/** Text of two elements that overlaps after the change and did not before. */
function newOverlaps(ctx: ProbeRuleContext, before: LayoutMeasure, after: LayoutMeasure, skip: (ref: string) => boolean) {
  const old = new Set(before.overlaps.flatMap((o) => [`${o.a}|${o.b}`, `${o.b}|${o.a}`]))
  const byRef = new Map(after.boxes.map((box) => [box.ref, box]))
  const hits: Array<{ node: A11yNode; other: string; width: number; height: number }> = []
  let unmatched = 0
  for (const overlap of after.overlaps) {
    if (old.has(`${overlap.a}|${overlap.b}`) || skip(overlap.a) || skip(overlap.b)) continue
    const a = byRef.get(overlap.a)
    const b = byRef.get(overlap.b)
    const node = a ? matchNode(ctx.index, a.ref, a.id) : undefined
    const other = b ? matchNode(ctx.index, b.ref, b.id) : undefined
    if (!node || !other) {
      unmatched++
      continue
    }
    hits.push({ node, other: nameOf(other), width: overlap.width, height: overlap.height })
  }
  return { hits, unmatched }
}

const REFLOW_TEXT: Record<Locale, { past: string; clipped: string; clippedReview: string; overlap: string }> = {
  en: {
    past: 'At 320 CSS px wide (1280 px at 400% zoom) the page scrolls sideways and this content runs past the right edge: reading it needs scrolling in two directions.',
    clipped: 'Text that is whole at 1280 px wide is cut off at 320 CSS px wide.',
    clippedReview: 'Text that is whole at 1280 px wide is cut at 320 CSS px wide; a name or title holds the full text, or its container hides other content too, as a carousel does. Check that the text can be read.',
    overlap: 'At 320 CSS px wide this text overlaps other text that it did not overlap at 1280 px.',
  },
  'pt-BR': {
    past: 'Com 320 px CSS de largura (1280 px com zoom de 400%) a página rola para o lado e este conteúdo passa da borda direita: lê-lo exige rolar em duas direções.',
    clipped: 'Texto que aparece inteiro com 1280 px de largura fica cortado com 320 px CSS.',
    clippedReview: 'Texto inteiro com 1280 px de largura fica cortado com 320 px CSS; um nome ou title tem o texto completo, ou o contêiner também esconde outro conteúdo, como num carrossel. Confira se o texto pode ser lido.',
    overlap: 'Com 320 px CSS de largura este texto se sobrepõe a outro texto, o que não acontecia com 1280 px.',
  },
}

/**
 * 1.4.10 Reflow. Failure (high): the page scrolls sideways at 320×256 and visible text or a
 * control outside content that needs two dimensions extends past the right edge. Failure
 * (high): text cut at 320 that was whole at 1280. Review: the cut text has its full text in a
 * name or title, or its container hides other boxes too; new text-on-text overlaps.
 */
export const reflowRule: ProbeRule = {
  id: 'rampa/reflow',
  kind: 'layout',
  variant: 'reflow-320x256',
  versions: ['1'],
  criteria: ['1.4.10'],
  run(record: ProbeRecord, ctx: ProbeRuleContext) {
    const data = asRecord(record.data)
    const before = measureOf(data.baseline)
    const after = measureOf(data.variant)
    const text = REFLOW_TEXT[ctx.locale]
    const findings: Finding[] = []
    const review: Finding[] = []
    let unmatched = 0
    const exempt = (box: LayoutBox) => Boolean(box.twoD)

    const past: Hit[] = []
    for (const box of after.boxes) {
      if (exempt(box) || !pastRightEdge(box, after)) continue
      const node = matchNode(ctx.index, box.ref, box.id)
      if (!node) unmatched++
      else past.push({ box, node })
    }
    past.sort((a, b) => (b.box.vis?.x ?? 0) + (b.box.vis?.width ?? 0) - ((a.box.vis?.x ?? 0) + (a.box.vis?.width ?? 0)))
    for (const { box, node } of past.slice(0, MAX_REPORTED)) {
      const vis = box.vis ?? box.rect
      const right = vis.x + vis.width
      findings.push(
        probeFinding({
          criterion: '1.4.10',
          rule: this.id,
          node,
          message: text.past,
          evidence: `viewport 320×256 CSS px, page scroll width ${r1(after.scrollWidth)} px; ${nameOf(node, box)} spans x ${r1(vis.x)}–${r1(right)} px, ${r1(right - after.clientWidth)} px past the right edge (${after.clientWidth} px)`,
          confidence: 'high',
          subject: 'past-edge',
        }),
      )
    }

    const pastRefs = new Set(past.map((hit) => hit.box.ref))
    const clipped = clippedHits(ctx, before, after, (box) => exempt(box) || pastRefs.has(box.ref))
    unmatched += clipped.unmatched
    let clippedFailures = 0
    for (const { box, node } of clipped.hits) {
      const doubtful = box.full || (box.hiddenPeers ?? 0) > 0 || box.ellipsis
      const evidence = `at 1280×1024 whole; at 320×256 ${cutText(box)} by ${clipperName(ctx, box)}${box.full ? '; a name or title holds the full text' : ''}${(box.hiddenPeers ?? 0) > 0 ? `; that container also hides ${box.hiddenPeers} other text box(es) completely` : ''}${box.ellipsis ? '; shown with an ellipsis' : ''}`
      if (doubtful) {
        review.push(probeFinding({ criterion: '1.4.10', rule: this.id, node, message: text.clippedReview, evidence, confidence: 'medium', subject: 'clipped' }))
      } else if (clippedFailures < MAX_REPORTED) {
        clippedFailures++
        findings.push(probeFinding({ criterion: '1.4.10', rule: this.id, node, message: text.clipped, evidence, confidence: 'high', subject: 'clipped' }))
      }
    }

    const exemptRefs = new Set(after.boxes.filter(exempt).map((box) => box.ref))
    const overlaps = newOverlaps(ctx, before, after, (ref) => exemptRefs.has(ref))
    unmatched += overlaps.unmatched
    for (const hit of overlaps.hits.slice(0, MAX_REPORTED)) {
      review.push(
        probeFinding({
          criterion: '1.4.10',
          rule: this.id,
          node: hit.node,
          message: text.overlap,
          evidence: `${nameOf(hit.node)} and ${hit.other} overlap by ${r1(hit.width)}×${r1(hit.height)} px at 320×256`,
          confidence: 'low',
          subject: `overlap|${hit.other}`,
        }),
      )
    }

    const failures = past.length + clipped.hits.filter(({ box }) => !(box.full || (box.hiddenPeers ?? 0) > 0 || box.ellipsis)).length
    const hidden = failures - findings.length
    const notes = [
      hidden > 0 ? `${hidden} more failure(s) not listed` : '',
      after.truncated ? 'box budget reached' : '',
      after.scrollsX ? '' : 'the page does not scroll sideways at 320 px',
    ].filter(Boolean)
    const coverage: ProbeCoverage = {
      criterion: '1.4.10',
      method: `probe/layout@${record.version}`,
      rule: this.id,
      conditions: conditionsText(record, '320×256 CSS px from 1280×1024'),
      status: coverageStatus(failures, review.length),
      applicable: after.measured,
      failures,
      review: review.length,
      unmatched,
      ...(notes.length > 0 ? { note: notes.join('; ') } : {}),
      maturity: 'experimental',
    }
    return { findings, review, coverage: [coverage] }
  },
}

const SPACING_TEXT: Record<Locale, { clipped: string; ellipsis: string; review: string; overlap: string }> = {
  en: {
    clipped: 'With text spacing raised as a user would (line height 1.5, letter spacing 0.12em, word spacing 0.16em, 2em after paragraphs), this text is cut off.',
    ellipsis: 'With text spacing raised as a user would, this text is cut to an ellipsis, and no name or title gives the full text.',
    review: 'With text spacing raised as a user would, this text is cut; a name or title holds the full text, or its container hides other content too, as a carousel does. Check that the text can be read.',
    overlap: 'With text spacing raised as a user would, this text overlaps other text that it did not overlap before.',
  },
  'pt-BR': {
    clipped: 'Com o espaçamento de texto aumentado como um usuário faria (altura de linha 1,5, entre letras 0,12em, entre palavras 0,16em, 2em após parágrafos), este texto fica cortado.',
    ellipsis: 'Com o espaçamento de texto aumentado como um usuário faria, este texto é cortado em reticências, e nenhum nome ou title traz o texto completo.',
    review: 'Com o espaçamento de texto aumentado, este texto fica cortado; um nome ou title tem o texto completo, ou o contêiner também esconde outro conteúdo, como num carrossel. Confira se o texto pode ser lido.',
    overlap: 'Com o espaçamento de texto aumentado como um usuário faria, este texto se sobrepõe a outro texto, o que não acontecia antes.',
  },
}

/**
 * 1.4.12 Text Spacing. The four values go on every element as user overrides, and the page is
 * compared with itself before them. Failure (high): text cut that was whole (F104). Failure
 * (medium): an ellipsis with no name or title holding the full text. Review: doubtful cuts and
 * new text-on-text overlaps.
 */
export const textSpacingRule: ProbeRule = {
  id: 'rampa/text-spacing',
  kind: 'layout',
  variant: 'text-spacing',
  versions: ['1'],
  criteria: ['1.4.12'],
  run(record: ProbeRecord, ctx: ProbeRuleContext) {
    const data = asRecord(record.data)
    const before = measureOf(data.baseline)
    const after = measureOf(data.variant)
    const spacing = asRecord(data.spacing)
    const skipped = asArray<string>(spacing.skipped).filter((value) => typeof value === 'string')
    const text = SPACING_TEXT[ctx.locale]
    const findings: Finding[] = []
    const review: Finding[] = []
    let failures = 0

    const clipped = clippedHits(ctx, before, after, () => false)
    for (const { box, node } of clipped.hits) {
      const evidence = `before: whole; with the spacing: ${cutText(box)} by ${clipperName(ctx, box)}${box.ellipsis ? ', shown with an ellipsis' : ''}${box.full ? '; a name or title holds the full text' : ''}${(box.hiddenPeers ?? 0) > 0 ? `; that container also hides ${box.hiddenPeers} other text box(es) completely` : ''}`
      if (box.ellipsis && box.full) continue
      if (box.ellipsis) {
        failures++
        if (findings.length < MAX_REPORTED) findings.push(probeFinding({ criterion: '1.4.12', rule: this.id, node, message: text.ellipsis, evidence, confidence: 'medium', subject: 'ellipsis' }))
      } else if (box.full || (box.hiddenPeers ?? 0) > 0) {
        review.push(probeFinding({ criterion: '1.4.12', rule: this.id, node, message: text.review, evidence, confidence: 'medium', subject: 'clipped' }))
      } else {
        failures++
        if (findings.length < MAX_REPORTED) findings.push(probeFinding({ criterion: '1.4.12', rule: this.id, node, message: text.clipped, evidence, confidence: 'high', subject: 'clipped' }))
      }
    }

    const overlaps = newOverlaps(ctx, before, after, () => false)
    for (const hit of overlaps.hits.slice(0, MAX_REPORTED)) {
      review.push(
        probeFinding({
          criterion: '1.4.12',
          rule: this.id,
          node: hit.node,
          message: text.overlap,
          evidence: `${nameOf(hit.node)} and ${hit.other} overlap by ${r1(hit.width)}×${r1(hit.height)} px with the spacing applied`,
          confidence: 'low',
          subject: `overlap|${hit.other}`,
        }),
      )
    }

    const hidden = failures - findings.length
    const notes = [
      hidden > 0 ? `${hidden} more failure(s) not listed` : '',
      skipped.length > 0 ? `not applied: ${skipped.join(', ')}` : '',
      after.truncated ? 'box budget reached' : '',
    ].filter(Boolean)
    const coverage: ProbeCoverage = {
      criterion: '1.4.12',
      method: `probe/layout@${record.version}`,
      rule: this.id,
      conditions: conditionsText(record, 'spacing overrides at 1280×1024'),
      status: coverageStatus(failures, review.length),
      applicable: after.measured,
      failures,
      review: review.length,
      unmatched: clipped.unmatched + overlaps.unmatched,
      ...(notes.length > 0 ? { note: notes.join('; ') } : {}),
      maturity: 'experimental',
    }
    return { findings, review, coverage: [coverage] }
  },
}
