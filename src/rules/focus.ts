import type { Finding } from '../core/types.ts'
import type { Locale } from '../i18n.ts'
import { NOISE_LIMIT, type FocusStop } from '../probes/focus.ts'
import { matchNode, nameOf } from '../probes/identity.ts'
import type { PixelDiff } from '../probes/pixels.ts'
import type { ProbeRecord } from '../snapshot/schema.ts'
import { stoppedEarly, walkOf } from './keyboard.ts'
import { type ProbeRule, conditionsText, coverageStatus, moreNotListed, probeFinding, say } from './probes.ts'

const MAX_REPORTED = 10
const FOCUS_VERSIONS = ['2'] as const

const VISIBLE_TEXT: Record<Locale, { none: string; removed: string; elsewhere: string; faint: string }> = {
  en: {
    none: 'When this element receives keyboard focus, no pixel changes, in its box or anywhere in the viewport: there is no visible focus indicator.',
    removed: 'Focus is taken away from this element as soon as it arrives (F55): a keyboard user cannot see or keep where they are.',
    elsewhere: 'When this element receives focus nothing changes around it, but something changes elsewhere in the viewport. Check that the change shows where focus is.',
    faint: 'The change when this element receives focus is faint: fewer pixels change noticeably (by 3:1 contrast, or by 48 in a color channel) than a 1 px outline around it would paint. Check that the indicator can be seen.',
  },
  'pt-BR': {
    none: 'Quando este elemento recebe o foco do teclado, nenhum pixel muda, nem na caixa dele nem em outro lugar da janela: não há indicador de foco visível.',
    removed: 'O foco é retirado deste elemento assim que chega (F55): quem usa teclado não consegue ver nem manter onde está.',
    elsewhere: 'Quando este elemento recebe o foco nada muda em volta dele, mas algo muda em outro lugar da janela. Confira se a mudança mostra onde está o foco.',
    faint: 'A mudança quando este elemento recebe foco é fraca: menos pixels mudam de forma perceptível (contraste de 3:1, ou 48 num canal de cor) do que um contorno de 1 px em volta dele pintaria. Confira se o indicador é visível.',
  },
}

const changeText = (diff: PixelDiff, locale: Locale) =>
  say(
    locale,
    `${diff.changed} of ${diff.area} px changed, ${diff.strong} by at least 3:1, ${diff.noticeable ?? diff.strong} noticeably${diff.before && diff.after ? ` (mostly ${diff.before} → ${diff.after})` : ''}${diff.masked > 0 ? `; ${diff.masked} px that move on their own left out` : ''}`,
    `${diff.changed} de ${diff.area} px mudaram, ${diff.strong} com pelo menos 3:1, ${diff.noticeable ?? diff.strong} de forma perceptível${diff.before && diff.after ? ` (sobretudo ${diff.before} → ${diff.after})` : ''}${diff.masked > 0 ? `; ${diff.masked} px que mudam sozinhos ficaram de fora` : ''}`,
  )

/**
 * 2.4.7 Focus Visible, with the plan's correction: a changed pixel does not prove focus is
 * visible. No pixel changed in the box or the viewport: failure, high (ACT oj04fd). Focus
 * removed on arrival (F55): failure, high. A change only away from the element, or a faint one
 * (fewer noticeably changed pixels than the element's perimeter): review. Anything else: no failure found,
 * never "passed". Noise over 10% of the region: cannot tell.
 */
export const focusVisibleRule: ProbeRule = {
  id: 'rampa/focus-visible',
  kind: 'keyboard',
  variant: 'keyboard-walk',
  versions: FOCUS_VERSIONS,
  criteria: ['2.4.7'],
  run(record: ProbeRecord, ctx) {
    const walk = walkOf(record)
    const text = VISIBLE_TEXT[ctx.locale]
    const findings: Finding[] = []
    const review: Finding[] = []
    let failures = 0
    let unmatched = 0
    let applicable = 0
    let noisy = 0
    const seen = new Set<string>()
    for (const stop of walk.forward as FocusStop[]) {
      if (!stop.el || seen.has(stop.el.ref)) continue
      seen.add(stop.el.ref)
      const keys = `Tab ×${stop.n}`
      if (stop.after === null && !stop.frame) {
        applicable++
        const node = matchNode(ctx.index, stop.el.ref, stop.el.id)
        if (!node) {
          unmatched++
          continue
        }
        failures++
        if (findings.length < MAX_REPORTED) {
          findings.push(probeFinding({ criterion: '2.4.7', rule: this.id, node, message: text.removed, evidence: say(ctx.locale, `${keys}: focus on ${nameOf(node, stop.el)}; 150 ms later focus is back on the document`, `${keys}: foco em ${nameOf(node, stop.el)}; 150 ms depois o foco está de volta no documento`), confidence: 'high', subject: 'removed' }))
        }
        continue
      }
      const pixels = stop.focus
      if (!pixels || pixels.skipped || !pixels.diff) continue
      applicable++
      const { diff } = pixels
      if (diff.changed === 0 && diff.masked / Math.max(1, diff.area) > NOISE_LIMIT) {
        noisy++
        continue
      }
      const perimeter = Math.round(2 * (pixels.box.width + pixels.box.height))
      let verdict: 'none' | 'elsewhere' | 'faint' | undefined
      if (diff.changed === 0) {
        if (!pixels.viewport) continue
        if (pixels.viewport.masked / Math.max(1, pixels.viewport.area) > NOISE_LIMIT && pixels.viewport.changed === 0) {
          noisy++
          continue
        }
        verdict = pixels.viewport.changed === 0 ? 'none' : 'elsewhere'
      } else if ((diff.noticeable ?? diff.strong) < perimeter) verdict = 'faint'
      if (!verdict) continue
      const node = matchNode(ctx.index, stop.el.ref, stop.el.id)
      if (!node) {
        unmatched++
        continue
      }
      const region = say(ctx.locale, `${pixels.region.width}×${pixels.region.height} px around the element`, `${pixels.region.width}×${pixels.region.height} px em volta do elemento`)
      if (verdict === 'none') {
        failures++
        // An element entirely under other content shows no change either: the cause is 2.4.11, and the indicator may exist.
        const grid = stop.obscured
        const covered = grid && grid.points > 0 && grid.covered === grid.points && grid.painted === 0 && grid.hidden === 0
        if (findings.length < MAX_REPORTED) {
          findings.push(
            probeFinding({
              criterion: '2.4.7',
              rule: this.id,
              node,
              message: text.none,
              evidence: say(
                ctx.locale,
                `${keys}: ${nameOf(node, stop.el)} focused and blurred; 0 px changed in the ${region}, 0 px in the ${pixels.viewport?.area ?? 0} px of the viewport (captured twice)${covered ? `; the element is entirely under ${grid.by?.ref ?? 'other content'} (see 2.4.11), so an indicator it has cannot show` : ''}`,
                `${keys}: ${nameOf(node, stop.el)} com e sem foco; 0 px mudaram nos ${region}, 0 px nos ${pixels.viewport?.area ?? 0} px da janela (capturado duas vezes)${covered ? `; o elemento está todo sob ${grid.by?.ref ?? 'outro conteúdo'} (veja 2.4.11), e um indicador que tenha não aparece` : ''}`,
              ),
              confidence: covered ? 'medium' : 'high',
              subject: 'none',
            }),
          )
        }
      } else if (verdict === 'elsewhere') {
        review.push(probeFinding({ criterion: '2.4.7', rule: this.id, node, message: text.elsewhere, evidence: say(ctx.locale, `${keys}: 0 px changed in the ${region}; ${changeText(pixels.viewport as PixelDiff, ctx.locale)} elsewhere in the viewport`, `${keys}: 0 px mudaram nos ${region}; ${changeText(pixels.viewport as PixelDiff, ctx.locale)} em outro lugar da janela`), confidence: 'medium', subject: 'elsewhere' }))
      } else {
        review.push(probeFinding({ criterion: '2.4.7', rule: this.id, node, message: text.faint, evidence: say(ctx.locale, `${keys}: ${changeText(diff, ctx.locale)} in the ${region}; a 1 px outline around its ${pixels.box.width}×${pixels.box.height} px box would paint ${perimeter} px`, `${keys}: ${changeText(diff, ctx.locale)} nos ${region}; um contorno de 1 px em volta da caixa de ${pixels.box.width}×${pixels.box.height} px pintaria ${perimeter} px`), confidence: 'low', subject: 'faint' }))
      }
    }
    const hidden = failures - findings.length
    const notes = [
      moreNotListed(ctx.locale, hidden),
      noisy > 0 ? say(ctx.locale, `${noisy} stop(s) could not be judged: too many pixels move on their own`, `${noisy} parada(s) sem julgamento: pixels demais mudam sozinhos`) : '',
      walk.end.forward === 'cycled' ? '' : stoppedEarly(walk, ctx.locale),
    ].filter(Boolean)
    return {
      findings,
      review,
      coverage: [
        {
          criterion: '2.4.7',
          method: `probe/keyboard@${record.version}`,
          rule: this.id,
          conditions: conditionsText(record, say(ctx.locale, `focused and blurred captures at ${walk.viewport.width}×${walk.viewport.height}`, `capturas com e sem foco em ${walk.viewport.width}×${walk.viewport.height}`)),
          status: coverageStatus(failures, review.length),
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

const OBSCURED_TEXT: Record<Locale, string> = {
  en: 'When this element receives keyboard focus, it is entirely hidden behind other content, so a keyboard user cannot see where focus is.',
  'pt-BR': 'Quando este elemento recebe o foco do teclado, ele fica totalmente escondido atrás de outro conteúdo, e quem usa teclado não vê onde está o foco.',
}

/**
 * 2.4.11 Focus Not Obscured (Minimum), new in WCAG 2.2. Every point of a 5×5 grid over the
 * element hits author content outside it, and neither painting nor hiding the element changes a
 * pixel: failure, high, naming the cover. A cover that lets pixels through (translucent) or
 * covers only part of the element is not reported. Beyond the target of a WCAG 2.1 report.
 */
export const focusObscuredRule: ProbeRule = {
  id: 'rampa/focus-obscured',
  kind: 'keyboard',
  variant: 'keyboard-walk',
  versions: FOCUS_VERSIONS,
  criteria: ['2.4.11'],
  run(record: ProbeRecord, ctx) {
    const walk = walkOf(record)
    const findings: Finding[] = []
    let failures = 0
    let unmatched = 0
    const measured = new Set<string>()
    let translucent = 0
    const reported = new Set<string>()
    for (const stop of [...walk.forward, ...walk.backward] as FocusStop[]) {
      const grid = stop.obscured
      if (!stop.el || !grid || grid.points === 0) continue
      measured.add(stop.el.ref)
      if (grid.covered < grid.points || reported.has(stop.el.ref)) continue
      if (grid.painted !== 0 || grid.hidden !== 0) {
        translucent++
        continue
      }
      const node = matchNode(ctx.index, stop.el.ref, stop.el.id)
      if (!node) {
        unmatched++
        continue
      }
      reported.add(stop.el.ref)
      failures++
      if (findings.length >= MAX_REPORTED) continue
      const by = grid.by
      const at = say(ctx.locale, 'at', 'em')
      const cover = by
        ? `${by.label ? `<${by.tag}> "${by.label.slice(0, 40)}"` : `<${by.tag}>`} ${by.ref} (position: ${by.position}, ${Math.round(by.rect.width)}×${Math.round(by.rect.height)} px ${at} y ${Math.round(by.rect.y)})`
        : say(ctx.locale, 'other content', 'outro conteúdo')
      const padding = (side: 'top' | 'bottom') =>
        say(
          ctx.locale,
          `; scroll-padding-${side}: ${Math.round(by?.rect.height ?? 0)}px on html would keep focused elements clear of it`,
          `; scroll-padding-${side}: ${Math.round(by?.rect.height ?? 0)}px no html manteria os elementos focados livres dele`,
        )
      const hint = by && by.position !== 'static' && by.rect.y <= 1 ? padding('top') : by && by.position !== 'static' && by.rect.y + by.rect.height >= walk.viewport.height - 1 ? padding('bottom') : ''
      findings.push(
        probeFinding({
          criterion: '2.4.11',
          rule: this.id,
          node,
          message: OBSCURED_TEXT[ctx.locale],
          evidence: say(
            ctx.locale,
            `${stop.key} ×${stop.n}: ${nameOf(node, stop.el)} at y ${Math.round(stop.rect?.y ?? 0)}; ${grid.covered} of ${grid.points} grid points hit ${cover}; painting it changed ${grid.painted} px and hiding it ${grid.hidden} px${hint}`,
            `${stop.key} ×${stop.n}: ${nameOf(node, stop.el)} em y ${Math.round(stop.rect?.y ?? 0)}; ${grid.covered} de ${grid.points} pontos da grade atingem ${cover}; pintá-lo mudou ${grid.painted} px e escondê-lo, ${grid.hidden} px${hint}`,
          ),
          confidence: 'high',
          subject: 'obscured',
        }),
      )
    }
    const notes = [
      translucent > 0
        ? say(ctx.locale, `${translucent} stop(s) fully under content that lets pixels through: not reported`, `${translucent} parada(s) sob conteúdo translúcido: não relatada(s)`)
        : '',
      moreNotListed(ctx.locale, failures - findings.length),
    ].filter(Boolean)
    return {
      findings,
      review: [],
      coverage: [
        {
          criterion: '2.4.11',
          method: `probe/keyboard@${record.version}`,
          rule: this.id,
          conditions: conditionsText(record, say(ctx.locale, `5×5 hit grid at ${walk.viewport.width}×${walk.viewport.height}, both directions`, `grade de 5×5 pontos em ${walk.viewport.width}×${walk.viewport.height}, nos dois sentidos`)),
          status: coverageStatus(failures, 0),
          applicable: measured.size,
          failures,
          review: 0,
          unmatched,
          ...(notes.length > 0 ? { note: notes.join('; ') } : {}),
          maturity: 'experimental',
          beyondTarget: true,
        },
      ],
    }
  },
}
