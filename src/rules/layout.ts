import type { Finding, ProbeCoverage } from '../core/types.ts'
import type { Locale } from '../i18n.ts'
import { matchNode, nameOf } from '../probes/identity.ts'
import {
  type LayoutBox,
  type LayoutMeasure,
  type MissingGroup,
  cutAtBottomEdge,
  cutAtRightEdge,
  overlapPair,
  overlapSide,
  pairOf,
  partlyClipped,
  pastRightEdge,
  readable,
  wholeBox,
} from '../probes/layout.ts'
import type { A11yNode, ProbeRecord } from '../snapshot/schema.ts'
import { type ProbeRule, type ProbeRuleContext, asArray, asRecord, conditionsText, coverageStatus, moreNotListed, probeFinding, say } from './probes.ts'

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
    ...(typeof data.scrollsY === 'boolean' ? { scrollsY: data.scrollsY, clientHeight: Number(data.clientHeight) || 0 } : {}),
    measured: Number(data.measured) || 0,
    boxes: asArray<LayoutBox>(data.boxes).filter((box) => typeof box?.ref === 'string' && box.rect && box.cut),
    overlaps: asArray<LayoutMeasure['overlaps'][number]>(data.overlaps).filter((o) => typeof o?.a === 'string' && typeof o?.b === 'string'),
    truncated: data.truncated === true,
  }
}

const r1 = (value: number) => Math.round(value)

function cutText(box: LayoutBox, locale: Locale): string {
  const across = box.cut.left + box.cut.right
  const down = box.cut.top + box.cut.bottom
  return [
    across >= 1 ? say(locale, `${r1(across)} px cut across`, `${r1(across)} px cortados na horizontal`) : '',
    down >= 1 ? say(locale, `${r1(down)} px cut down`, `${r1(down)} px cortados na vertical`) : '',
  ]
    .filter(Boolean)
    .join(', ')
}

/** Why a cut may not lose the text, as evidence: a full text elsewhere, a carousel, an ellipsis. */
function cutContext(box: LayoutBox, locale: Locale): string {
  return [
    box.full ? say(locale, '; a name or title holds the full text', '; um nome ou title tem o texto completo') : '',
    (box.hiddenPeers ?? 0) > 0
      ? say(locale, `; that container also hides ${box.hiddenPeers} other text box(es) completely`, `; esse contêiner também esconde ${box.hiddenPeers} outra(s) caixa(s) de texto por inteiro`)
      : '',
    box.ellipsis ? say(locale, '; shown with an ellipsis', '; mostrado com reticências') : '',
  ].join('')
}

function clipperName(ctx: ProbeRuleContext, box: LayoutBox): string {
  if (!box.clipBy) return say(ctx.locale, 'an ancestor', 'um ancestral')
  const node = ctx.index.get(box.clipBy)?.node
  return node ? `<${String(node.native.tag ?? 'element')}> ${box.clipBy}` : box.clipBy
}

interface Hit {
  box: LayoutBox
  node: A11yNode
}

/** Partly cut after the change, whole before it, on the same page: the comparison both layout rules make. */
function clippedHits(ctx: ProbeRuleContext, before: LayoutMeasure, after: LayoutMeasure, skip: (box: LayoutBox) => boolean) {
  const baseline = new Map(before.boxes.map((box) => [pairOf(box), box]))
  const hits: Hit[] = []
  let unmatched = 0
  for (const box of after.boxes) {
    if (skip(box) || !partlyClipped(box) || !wholeBox(baseline.get(pairOf(box)))) continue
    const node = matchNode(ctx.index, box.ref, box.id)
    if (!node) unmatched++
    else hits.push({ box, node })
  }
  return { hits, unmatched }
}

/** Text of two elements that overlaps after the change and did not before. */
function newOverlaps(ctx: ProbeRuleContext, before: LayoutMeasure, after: LayoutMeasure, skip: (ref: string) => boolean) {
  const old = new Set(before.overlaps.map(overlapPair))
  const byPair = new Map(after.boxes.map((box) => [pairOf(box), box]))
  const hits: Array<{ node: A11yNode; other: string; width: number; height: number }> = []
  let unmatched = 0
  for (const overlap of after.overlaps) {
    if (old.has(overlapPair(overlap)) || skip(overlap.a) || skip(overlap.b)) continue
    const a = byPair.get(overlapSide(overlap, 'a'))
    const b = byPair.get(overlapSide(overlap, 'b'))
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

const REFLOW_TEXT: Record<Locale, { past: string; clipped: string; clippedReview: string; overlap: string; edge: string }> = {
  en: {
    past: 'At 320 CSS px wide (1280 px at 400% zoom) the page scrolls sideways and this content runs past the right edge: reading it needs scrolling in two directions.',
    clipped: 'Text that is whole at 1280 px wide is cut off at 320 CSS px wide.',
    clippedReview: 'Text that is whole at 1280 px wide is cut at 320 CSS px wide; a name or title holds the full text, or its container hides other content too, as a carousel does. Check that the text can be read.',
    overlap: 'At 320 CSS px wide this text overlaps other text that it did not overlap at 1280 px.',
    edge: 'At 320 CSS px wide this content runs past the right edge of a window that does not scroll sideways, so its end cannot be reached. Check whether it is hidden on purpose.',
  },
  'pt-BR': {
    past: 'Com 320 px CSS de largura (1280 px com zoom de 400%) a página rola para o lado e este conteúdo passa da borda direita: lê-lo exige rolar em duas direções.',
    clipped: 'Texto que aparece inteiro com 1280 px de largura fica cortado com 320 px CSS.',
    clippedReview: 'Texto inteiro com 1280 px de largura fica cortado com 320 px CSS; um nome ou title tem o texto completo, ou o contêiner também esconde outro conteúdo, como num carrossel. Confira se o texto pode ser lido.',
    overlap: 'Com 320 px CSS de largura este texto se sobrepõe a outro texto, o que não acontecia com 1280 px.',
    edge: 'Com 320 px CSS de largura este conteúdo passa da borda direita de uma janela que não rola para o lado, e o fim dele fica inalcançável. Confira se está escondido de propósito.',
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
          evidence: say(
            ctx.locale,
            `viewport 320×256 CSS px, page scroll width ${r1(after.scrollWidth)} px; ${nameOf(node, box)} spans x ${r1(vis.x)}–${r1(right)} px, ${r1(right - after.clientWidth)} px past the right edge (${after.clientWidth} px)`,
            `janela de 320×256 px CSS, largura de rolagem da página ${r1(after.scrollWidth)} px; ${nameOf(node, box)} ocupa x ${r1(vis.x)}–${r1(right)} px, ${r1(right - after.clientWidth)} px além da borda direita (${after.clientWidth} px)`,
          ),
          confidence: 'high',
          subject: 'past-edge',
        }),
      )
    }

    // A window that does not scroll sideways (overflow hidden on html or body) cuts what runs past its edge.
    const baseline = new Map(before.boxes.map((box) => [pairOf(box), box]))
    let edges = 0
    for (const box of after.boxes) {
      if (exempt(box) || !cutAtRightEdge(box, after)) continue
      const was = baseline.get(pairOf(box))
      // Cut at 1280 px too (a ticker, a track) is not something the narrow window did.
      if (!was?.vis || was.vis.x + was.vis.width > before.clientWidth + 1) continue
      const node = matchNode(ctx.index, box.ref, box.id)
      if (!node) {
        unmatched++
        continue
      }
      if (edges++ >= MAX_REPORTED) continue
      const vis = box.vis ?? box.rect
      review.push(
        probeFinding({
          criterion: '1.4.10',
          rule: this.id,
          node,
          message: text.edge,
          evidence: say(
            ctx.locale,
            `viewport 320×256 CSS px, the window does not scroll sideways; ${nameOf(node, box)} spans x ${r1(vis.x)}–${r1(vis.x + vis.width)} px, ${r1(vis.x + vis.width - after.clientWidth)} px past the right edge (${after.clientWidth} px)`,
            `janela de 320×256 px CSS, que não rola para o lado; ${nameOf(node, box)} ocupa x ${r1(vis.x)}–${r1(vis.x + vis.width)} px, ${r1(vis.x + vis.width - after.clientWidth)} px além da borda direita (${after.clientWidth} px)`,
          ),
          confidence: 'medium',
          subject: 'edge',
        }),
      )
    }

    const pastRefs = new Set(past.map((hit) => hit.box.ref))
    const clipped = clippedHits(ctx, before, after, (box) => exempt(box) || pastRefs.has(box.ref))
    unmatched += clipped.unmatched
    let clippedFailures = 0
    for (const { box, node } of clipped.hits) {
      const doubtful = box.full || (box.hiddenPeers ?? 0) > 0 || box.ellipsis
      const evidence = say(
        ctx.locale,
        `at 1280×1024 whole; at 320×256 ${cutText(box, ctx.locale)} by ${clipperName(ctx, box)}${cutContext(box, ctx.locale)}`,
        `com 1280×1024 inteiro; com 320×256 ${cutText(box, ctx.locale)} por ${clipperName(ctx, box)}${cutContext(box, ctx.locale)}`,
      )
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
          evidence: say(
            ctx.locale,
            `${nameOf(hit.node)} and ${hit.other} overlap by ${r1(hit.width)}×${r1(hit.height)} px at 320×256`,
            `${nameOf(hit.node)} e ${hit.other} se sobrepõem em ${r1(hit.width)}×${r1(hit.height)} px com 320×256`,
          ),
          confidence: 'low',
          subject: `overlap|${hit.other}`,
        }),
      )
    }

    const failures = past.length + clipped.hits.filter(({ box }) => !(box.full || (box.hiddenPeers ?? 0) > 0 || box.ellipsis)).length
    const hidden = failures - findings.length
    const notes = [
      moreNotListed(ctx.locale, hidden),
      after.truncated ? say(ctx.locale, 'box budget reached', 'limite de caixas atingido') : '',
      after.scrollsX ? '' : say(ctx.locale, 'the page does not scroll sideways at 320 px', 'a página não rola para o lado com 320 px'),
    ].filter(Boolean)
    const coverage: ProbeCoverage = {
      criterion: '1.4.10',
      method: `probe/layout@${record.version}`,
      rule: this.id,
      conditions: conditionsText(record, say(ctx.locale, '320×256 CSS px from 1280×1024', '320×256 px CSS a partir de 1280×1024')),
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
      const evidence = say(
        ctx.locale,
        `before: whole; with the spacing: ${cutText(box, ctx.locale)} by ${clipperName(ctx, box)}${cutContext(box, ctx.locale)}`,
        `antes: inteiro; com o espaçamento: ${cutText(box, ctx.locale)} por ${clipperName(ctx, box)}${cutContext(box, ctx.locale)}`,
      )
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
          evidence: say(
            ctx.locale,
            `${nameOf(hit.node)} and ${hit.other} overlap by ${r1(hit.width)}×${r1(hit.height)} px with the spacing applied`,
            `${nameOf(hit.node)} e ${hit.other} se sobrepõem em ${r1(hit.width)}×${r1(hit.height)} px com o espaçamento aplicado`,
          ),
          confidence: 'low',
          subject: `overlap|${hit.other}`,
        }),
      )
    }

    const hidden = failures - findings.length
    const notes = [
      moreNotListed(ctx.locale, hidden),
      skipped.length > 0 ? say(ctx.locale, `not applied: ${skipped.join(', ')}`, `não aplicado: ${skipped.join(', ')}`) : '',
      after.truncated ? say(ctx.locale, 'box budget reached', 'limite de caixas atingido') : '',
    ].filter(Boolean)
    const coverage: ProbeCoverage = {
      criterion: '1.4.12',
      method: `probe/layout@${record.version}`,
      rule: this.id,
      conditions: conditionsText(record, say(ctx.locale, 'spacing overrides at 1280×1024', 'espaçamento do usuário em 1280×1024')),
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

const ZOOM_TEXT: Record<
  Locale,
  { clipped: string; clippedAlways: string; review: string; edgeX: string; edgeY: string; overlap: string; missing: string; reasons: Record<string, string> }
> = {
  en: {
    clipped: 'At 200% zoom (640×512 CSS px, which is 1280×1024 at 200%) a container that hides its overflow cuts this text off; it is whole at 1280×1024.',
    clippedAlways:
      'At 200% zoom (640×512 CSS px, which is 1280×1024 at 200%) a container that hides its overflow cuts this text off (ACT 59br37). It is cut at 1280×1024 too, so zoom did not cause it, but the text cannot be read at 200% either.',
    review:
      'At 200% zoom a container that hides its overflow cuts this text, in a way that may be on purpose: it clamps lines with an ellipsis, a name or title holds the full text, or the container hides other text too, as a carousel does. Check that the text can be read at 200%.',
    edgeX: 'At 200% zoom this text runs past the right edge of a window that does not scroll sideways (overflow hidden on html or body), so its end cannot be reached. Check whether it is hidden on purpose.',
    edgeY: 'At 200% zoom text that fit in the window at 1280×1024 falls below the bottom of a window that does not scroll down (overflow hidden on html or body), so it cannot be reached.',
    overlap: 'At 200% zoom this text overlaps other text that it did not overlap at 1280×1024.',
    missing: 'Text shown at 1280×1024 is hidden at 200% zoom (640×512 CSS px), and no other text on the page at that size has the same words. Check that it can still be reached at 200%, for example through a menu.',
    reasons: {
      'display-none': 'display: none',
      'visibility-hidden': 'visibility: hidden',
      'opacity-0': 'opacity 0',
      'no-size': 'no size',
      clipped: 'cut away by a container that hides its overflow',
      'off-page': 'moved off the page',
      removed: 'removed from the page',
    },
  },
  'pt-BR': {
    clipped: 'Com zoom de 200% (640×512 px CSS, que é 1280×1024 a 200%) um contêiner que esconde o que transborda corta este texto; com 1280×1024 ele aparece inteiro.',
    clippedAlways:
      'Com zoom de 200% (640×512 px CSS, que é 1280×1024 a 200%) um contêiner que esconde o que transborda corta este texto (ACT 59br37). Ele já fica cortado com 1280×1024, então o zoom não é a causa, mas o texto também não pode ser lido a 200%.',
    review:
      'Com zoom de 200% um contêiner que esconde o que transborda corta este texto, talvez de propósito: ele limita as linhas com reticências, um nome ou title tem o texto completo, ou o contêiner também esconde outro texto, como num carrossel. Confira se o texto pode ser lido a 200%.',
    edgeX: 'Com zoom de 200% este texto passa da borda direita de uma janela que não rola para o lado (overflow hidden em html ou body), e o fim dele fica inalcançável. Confira se está escondido de propósito.',
    edgeY: 'Com zoom de 200% texto que cabia na janela com 1280×1024 fica abaixo da borda inferior de uma janela que não rola para baixo (overflow hidden em html ou body), e não pode ser alcançado.',
    overlap: 'Com zoom de 200% este texto se sobrepõe a outro texto, o que não acontecia com 1280×1024.',
    missing:
      'Texto que aparece com 1280×1024 fica escondido com zoom de 200% (640×512 px CSS), e nenhum outro texto da página nesse tamanho tem as mesmas palavras. Confira se ele ainda pode ser alcançado a 200%, por exemplo por um menu.',
    reasons: {
      'display-none': 'display: none',
      'visibility-hidden': 'visibility: hidden',
      'opacity-0': 'opacidade 0',
      'no-size': 'sem tamanho',
      clipped: 'cortado por um contêiner que esconde o que transborda',
      'off-page': 'movido para fora da página',
      removed: 'removido da página',
    },
  },
}

/** ACT 59br37, expectation 1's exception: the clipping ancestor does not wrap and shows an ellipsis (text-overflow other than clip). */
export function nowrapEllipsis(x: LayoutBox['xClip']): boolean {
  return Boolean(x && (x.ws === 'nowrap' || x.wrap === 'nowrap') && x.to !== '' && x.to !== 'clip')
}

/**
 * ACT 59br37, expectation 2's exception, the line clamp: the clipping ancestor's line height is at least its height,
 * so it shows one line. ACT's wording alone would also excuse a box shorter than its letters, which its Failed
 * Example 4 (a 10 px box with 16 px text) rules out; so the box must also be at least as tall as its font size.
 */
export function oneLineBox(y: LayoutBox['yClip']): boolean {
  return Boolean(y && y.h > 0 && y.lh >= y.h - 0.5 && y.h >= y.fs - 0.5)
}

/**
 * 1.4.4 Resize Text at 200% zoom: 640×512 CSS px at device scale 2 (ACT 59br37's viewport), compared with the same
 * page at 1280×1024. Failure: text cut by an ancestor's overflow hidden or clip, outside ACT's no-wrap ellipsis and
 * line-clamp exceptions (high when it was whole at 1280×1024, medium when it was already cut). Review: cuts that
 * may be on purpose (line clamp, a full text in a name, a carousel), text past the edge of a window that does not
 * scroll, new overlaps, and text the width hid (display none and the like) with no control seen to show it.
 */
export const zoomRule: ProbeRule = {
  id: 'rampa/resize-text',
  kind: 'layout',
  variant: 'zoom-200',
  versions: ['1'],
  criteria: ['1.4.4'],
  run(record: ProbeRecord, ctx: ProbeRuleContext) {
    const data = asRecord(record.data)
    const before = measureOf(data.baseline)
    const after = measureOf(data.variant)
    const missing = asArray<MissingGroup>(data.missing).filter((g) => g && typeof g === 'object' && g.root && typeof g.root.ref === 'string' && typeof g.boxes === 'number')
    const text = ZOOM_TEXT[ctx.locale]
    const baseline = new Map(before.boxes.map((box) => [pairOf(box), box]))
    const findings: Finding[] = []
    const review: Finding[] = []
    let failures = 0
    let unmatched = 0
    let nowrap = 0
    let oneLine = 0
    // ACT 59br37 applies to visible text whose parent is an HTML element and that is not under aria-hidden="true".
    const inScope = (box: LayoutBox) => box.own === true && !box.ah && !box.foreign && box.twoD !== 'svg' && box.twoD !== 'math'

    for (const box of after.boxes) {
      if (!inScope(box) || !partlyClipped(box) || !readable(box)) continue
      const across = box.cut.left + box.cut.right >= 2
      const down = box.cut.top + box.cut.bottom >= Math.max(3, 0.25 * (box.line || box.rect.height))
      const xExempt = across && nowrapEllipsis(box.xClip)
      const yExempt = down && oneLineBox(box.yClip)
      const cutX = across && !xExempt
      const cutY = down && !yExempt
      if (!cutX && !cutY) {
        if (xExempt) nowrap++
        if (yExempt) oneLine++
        continue
      }
      const node = matchNode(ctx.index, box.ref, box.id)
      if (!node) {
        unmatched++
        continue
      }
      const was = baseline.get(pairOf(box))
      const zoomCaused = wholeBox(was)
      const parts: string[] = []
      if (cutX && box.xClip) {
        parts.push(
          say(
            ctx.locale,
            `${r1(box.cut.left + box.cut.right)} px cut across by ${box.xClip.by} (white-space ${box.xClip.ws}, text-overflow ${box.xClip.to})`,
            `${r1(box.cut.left + box.cut.right)} px cortados na horizontal por ${box.xClip.by} (white-space ${box.xClip.ws}, text-overflow ${box.xClip.to})`,
          ),
        )
      }
      if (cutY && box.yClip) {
        const lh = `${r1(box.yClip.lh)} px${box.yClip.normal ? ' (normal)' : ''}`
        parts.push(
          say(
            ctx.locale,
            `${r1(box.cut.top + box.cut.bottom)} px cut down by ${box.yClip.by} (box ${r1(box.yClip.h)} px high, line height ${lh}${box.yClip.clamp ? ', line clamp' : ''})`,
            `${r1(box.cut.top + box.cut.bottom)} px cortados na vertical por ${box.yClip.by} (caixa de ${r1(box.yClip.h)} px de altura, altura de linha ${lh}${box.yClip.clamp ? ', line clamp' : ''})`,
          ),
        )
      }
      const evidence = say(
        ctx.locale,
        `at 640×512 CSS px, device scale 2: ${parts.join('; ')}; at 1280×1024 ${zoomCaused ? 'whole' : 'already cut'}${cutContext(box, ctx.locale)}`,
        `com 640×512 px CSS, escala 2: ${parts.join('; ')}; com 1280×1024 ${zoomCaused ? 'inteiro' : 'já cortado'}${cutContext(box, ctx.locale)}`,
      )
      const doubtful = (cutY && box.yClip?.clamp) || box.full || (box.hiddenPeers ?? 0) > 0
      if (doubtful) {
        if (review.length < MAX_REPORTED * 2) review.push(probeFinding({ criterion: '1.4.4', rule: this.id, node, message: text.review, evidence, confidence: 'medium', subject: 'clipped' }))
        continue
      }
      failures++
      if (findings.length < MAX_REPORTED) {
        findings.push(
          probeFinding({
            criterion: '1.4.4',
            rule: this.id,
            node,
            message: zoomCaused ? text.clipped : text.clippedAlways,
            evidence,
            confidence: zoomCaused ? 'high' : 'medium',
            subject: 'clipped',
          }),
        )
      }
    }

    // The window itself: overflow hidden on html or body keeps a reader from scrolling to what zoom pushed out.
    let edges = 0
    const below: Hit[] = []
    for (const box of after.boxes) {
      if (!inScope(box)) continue
      const was = baseline.get(pairOf(box))
      if (!was?.vis) continue
      if (cutAtRightEdge(box, after) && was.vis.x + was.vis.width <= before.clientWidth + 1) {
        const node = matchNode(ctx.index, box.ref, box.id)
        if (!node) {
          unmatched++
          continue
        }
        if (edges++ >= MAX_REPORTED) continue
        const vis = box.vis ?? box.rect
        review.push(
          probeFinding({
            criterion: '1.4.4',
            rule: this.id,
            node,
            message: text.edgeX,
            evidence: say(
              ctx.locale,
              `at 640×512 CSS px the window does not scroll sideways; ${nameOf(node, box)} spans x ${r1(vis.x)}–${r1(vis.x + vis.width)} px, ${r1(vis.x + vis.width - after.clientWidth)} px past the right edge (${after.clientWidth} px)`,
              `com 640×512 px CSS a janela não rola para o lado; ${nameOf(node, box)} ocupa x ${r1(vis.x)}–${r1(vis.x + vis.width)} px, ${r1(vis.x + vis.width - after.clientWidth)} px além da borda direita (${after.clientWidth} px)`,
            ),
            confidence: 'medium',
            subject: 'edge',
          }),
        )
      } else if (cutAtBottomEdge(box, after) && before.clientHeight && was.vis.y + was.vis.height <= before.clientHeight + 1) {
        const node = matchNode(ctx.index, box.ref, box.id)
        if (!node) unmatched++
        else below.push({ box, node })
      }
    }
    const first = below[0]
    if (first) {
      const vis = first.box.vis ?? first.box.rect
      review.push(
        probeFinding({
          criterion: '1.4.4',
          rule: this.id,
          node: first.node,
          message: text.edgeY,
          evidence: say(
            ctx.locale,
            `at 640×512 CSS px the window does not scroll down; ${below.length} text box(es) inside the window at 1280×1024 reach past its bottom edge (${after.clientHeight} px), such as ${nameOf(first.node, first.box)} at y ${r1(vis.y)}–${r1(vis.y + vis.height)} px`,
            `com 640×512 px CSS a janela não rola para baixo; ${below.length} caixa(s) de texto dentro da janela com 1280×1024 passam da borda inferior (${after.clientHeight} px), como ${nameOf(first.node, first.box)} em y ${r1(vis.y)}–${r1(vis.y + vis.height)} px`,
          ),
          confidence: 'medium',
          subject: 'edge-bottom',
        }),
      )
    }

    const outOfScope = new Set(after.boxes.filter((box) => !inScope(box)).map((box) => box.ref))
    const overlaps = newOverlaps(ctx, before, after, (ref) => outOfScope.has(ref))
    unmatched += overlaps.unmatched
    for (const hit of overlaps.hits.slice(0, MAX_REPORTED)) {
      review.push(
        probeFinding({
          criterion: '1.4.4',
          rule: this.id,
          node: hit.node,
          message: text.overlap,
          evidence: say(
            ctx.locale,
            `${nameOf(hit.node)} and ${hit.other} overlap by ${r1(hit.width)}×${r1(hit.height)} px at 640×512 CSS px`,
            `${nameOf(hit.node)} e ${hit.other} se sobrepõem em ${r1(hit.width)}×${r1(hit.height)} px com 640×512 px CSS`,
          ),
          confidence: 'low',
          subject: `overlap|${hit.other}`,
        }),
      )
    }

    // Text the narrower window hid. Shown again at 1280 px means the width hid it, not a timer; a control seen
    // next to it (aria-controls, aria-expanded) may show it, which the observe class does not try.
    let notBack = 0
    let behindToggle = 0
    let missingReported = 0
    for (const group of missing) {
      if (group.back === 0) {
        notBack += group.boxes
        continue
      }
      if (group.toggle) {
        behindToggle += group.boxes
        continue
      }
      const members = asArray<MissingGroup['members'][number]>(group.members)
      const node = matchNode(ctx.index, group.root.ref, group.root.id) ?? members.map((m) => matchNode(ctx.index, m?.ref, m?.id)).find(Boolean)
      if (!node) {
        unmatched++
        continue
      }
      if (missingReported++ >= MAX_REPORTED) continue
      const sample = asArray<string>(group.sample)
        .filter((value) => typeof value === 'string')
        .map((value) => `"${value}"`)
        .join(', ')
      const reason = text.reasons[group.reason] ?? group.reason
      review.push(
        probeFinding({
          criterion: '1.4.4',
          rule: this.id,
          node,
          message: text.missing,
          evidence: say(
            ctx.locale,
            `at 1280×1024 shown; at 640×512 CSS px ${reason} (<${group.root.tag}> ${group.root.ref}): ${group.boxes} text box(es)${sample ? `, such as ${sample}` : ''}; shown again back at 1280×1024`,
            `com 1280×1024 aparece; com 640×512 px CSS ${reason} (<${group.root.tag}> ${group.root.ref}): ${group.boxes} caixa(s) de texto${sample ? `, como ${sample}` : ''}; aparece de novo com 1280×1024`,
          ),
          confidence: 'low',
          subject: `missing|${group.root.ref}`,
        }),
      )
    }

    const notes = [
      moreNotListed(ctx.locale, failures - findings.length),
      nowrap + oneLine > 0
        ? say(ctx.locale, `ACT 59br37 exceptions: ${nowrap} no-wrap ellipsis, ${oneLine} line clamp`, `exceções da ACT 59br37: ${nowrap} reticências sem quebra, ${oneLine} limite de uma linha`)
        : '',
      behindToggle > 0
        ? say(ctx.locale, `${behindToggle} hidden text box(es) sit behind a menu button, not opened`, `${behindToggle} caixa(s) de texto escondida(s) atrás de um botão de menu, não aberto`)
        : '',
      notBack > 0
        ? say(
            ctx.locale,
            `${notBack} text box(es) gone at 640 px and not back at 1280 px: not counted (a timer or a carousel)`,
            `${notBack} caixa(s) de texto sumida(s) com 640 px e não de volta com 1280 px: não contadas (um timer ou carrossel)`,
          )
        : '',
      after.truncated ? say(ctx.locale, 'box budget reached; hidden text not checked', 'limite de caixas atingido; texto escondido não verificado') : '',
    ].filter(Boolean)
    const coverage: ProbeCoverage = {
      criterion: '1.4.4',
      method: `probe/layout@${record.version}`,
      rule: this.id,
      conditions: conditionsText(record, say(ctx.locale, '640×512 CSS px at device scale 2 (1280×1024 at 200%)', '640×512 px CSS com escala 2 (1280×1024 a 200%)')),
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
