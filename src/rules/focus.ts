import type { Finding } from '../core/types.ts'
import type { Locale } from '../i18n.ts'
import { cssContrast } from '../pixels/indicator.ts'
import { type CaretFact, type FocusPixels, NOISE_LIMIT, type FocusStop } from '../probes/focus.ts'
import { matchNode, nameOf } from '../probes/identity.ts'
import type { PixelDiff } from '../probes/pixels.ts'
import type { A11yNode, ProbeRecord } from '../snapshot/schema.ts'
import { stoppedEarly, walkOf } from './keyboard.ts'
import { type ProbeRule, appPlatform, conditionsText, coverageStatus, moreNotListed, probeFinding, say } from './probes.ts'

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

/** Input types whose box takes typed text and shows a caret, as the probe reads them (probes/focus.ts, caretOf). */
const TYPED = new Set(['', 'text', 'search', 'email', 'url', 'tel', 'password', 'number'])

/** Whether the snapshot says an element takes typed text: a text-like input, a textarea, or editable content. */
export function takesText(node: A11yNode): boolean {
  if (node.states.includes('readonly') || node.states.includes('disabled')) return false
  const tag = node.native.tag
  if (tag === 'textarea') return true
  if (tag === 'input') {
    const type = (node.native.attributes as Record<string, unknown> | undefined)?.type
    return TYPED.has(typeof type === 'string' ? type.trim().toLowerCase() : '')
  }
  // contenteditable: the snapshot keeps no such attribute, and the browser's tree marks the element editable.
  const editable = node.ax?.props?.editable
  return typeof editable === 'string' && editable !== ''
}

/**
 * The text caret a focused element shows, which is a focus indicator of its own. WCAG's Understanding for 2.4.7, in
 * its Examples: "When text fields receive focus, a vertical bar is displayed in the field, indicating that the user
 * can insert text, OR all of the text is highlighted, indicating that the user can type over the text." The
 * Understanding for 1.4.11 passes a text input whose other indicator is under 3:1 because "the cursor/caret which is
 * displayed when the input receives focus does provide a sufficiently strong visual indication" (Figure 33, "Text
 * input focus style"), and fails a custom caret under 3:1 against the field that is the only indication (Figure 44).
 * Captures hide the caret, which blinks, so the probe reads it from the field's styles (probes/focus.ts).
 *
 * Returns the recorded caret; 'assumed' for a recording made before the probe read carets, of an element the snapshot
 * says takes typed text (the browser's default caret, in the text color); undefined when there is none: a read-only
 * field, anything that takes no text.
 */
export function caretOf(pixels: FocusPixels, node: A11yNode): CaretFact | 'assumed' | undefined {
  if (pixels.caret === null) return undefined
  if (pixels.caret && typeof pixels.caret.color === 'string') return pixels.caret
  return takesText(node) ? 'assumed' : undefined
}

/** A caret that changes the field's pixels noticeably, as the pixel diff counts it: by 3:1, or by 48 in a color channel. */
export function caretShows(caret: CaretFact): boolean {
  if ((cssContrast(caret.color, caret.background) ?? 1) >= 3) return true
  const channels = (hex: string) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) || 0)
  const a = channels(caret.color)
  const b = channels(caret.background)
  return a.some((v, i) => Math.abs(v - (b[i] ?? 0)) >= 48)
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
 * never "passed". Noise over 10% of the region: cannot tell. A text field that shows its caret has a visible
 * indicator whatever else its pixels do (caretOf): it is not reported, unless other content covers it.
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
    // On an app screen focus cannot be taken away without moving it on: the captures are with focus, after it moved on, and before it arrived.
    const app = appPlatform(record) !== undefined
    const findings: Finding[] = []
    const review: Finding[] = []
    let failures = 0
    let unmatched = 0
    let applicable = 0
    let noisy = 0
    let carets = 0
    let assumed = 0
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
      // An element entirely under other content shows no change either: the cause is 2.4.11, and the indicator may exist.
      const grid = stop.obscured
      const covered = grid && grid.points > 0 && grid.covered === grid.points && grid.painted === 0 && grid.hidden === 0
      // A text field's caret shows where focus is (Understanding 2.4.7), unless something covers the field.
      const caret = app ? undefined : caretOf(pixels, node)
      if (caret && !covered && (caret === 'assumed' || caretShows(caret))) {
        carets++
        if (caret === 'assumed') assumed++
        continue
      }
      const caretText =
        caret && caret !== 'assumed'
          ? say(ctx.locale, `; its text caret, ${caret.color} on ${caret.background}, does not show`, `; o cursor de texto, ${caret.color} sobre ${caret.background}, não aparece`)
          : ''
      if (verdict === 'none') {
        failures++
        if (findings.length < MAX_REPORTED) {
          findings.push(
            probeFinding({
              criterion: '2.4.7',
              rule: this.id,
              node,
              message: text.none,
              evidence: app
                ? say(
                    ctx.locale,
                    `${keys}: ${nameOf(node, stop.el)} with focus, against the screen once focus moved on and before it arrived; 0 px changed in the ${region}, 0 px in the ${pixels.viewport?.area ?? 0} px of the screen${covered ? `; the element is entirely under ${grid.by?.ref ?? 'other content'} (see 2.4.11), so an indicator it has cannot show` : ''}`,
                    `${keys}: ${nameOf(node, stop.el)} com foco, contra a tela depois que o foco seguiu e antes de chegar; 0 px mudaram nos ${region}, 0 px nos ${pixels.viewport?.area ?? 0} px da tela${covered ? `; o elemento está todo sob ${grid.by?.ref ?? 'outro conteúdo'} (veja 2.4.11), e um indicador que tenha não aparece` : ''}`,
                  )
                : say(
                    ctx.locale,
                    `${keys}: ${nameOf(node, stop.el)} focused and blurred; 0 px changed in the ${region}, 0 px in the ${pixels.viewport?.area ?? 0} px of the viewport (captured twice)${covered ? `; the element is entirely under ${grid.by?.ref ?? 'other content'} (see 2.4.11), so an indicator it has cannot show` : caretText}`,
                    `${keys}: ${nameOf(node, stop.el)} com e sem foco; 0 px mudaram nos ${region}, 0 px nos ${pixels.viewport?.area ?? 0} px da janela (capturado duas vezes)${covered ? `; o elemento está todo sob ${grid.by?.ref ?? 'outro conteúdo'} (veja 2.4.11), e um indicador que tenha não aparece` : caretText}`,
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
      carets > 0
        ? say(
            ctx.locale,
            `${carets} text field(s) whose focus shows only as the text caret, which the Understanding for 2.4.7 counts as a visible indicator: not reported${assumed > 0 ? ` (${assumed} recorded before Rampa read carets: the browser's default caret is assumed)` : ''}`,
            `${carets} campo(s) de texto cujo foco aparece só como o cursor de texto, que o Understanding da 2.4.7 conta como indicador visível: não relatado(s)${assumed > 0 ? ` (${assumed} gravado(s) antes de o Rampa ler o cursor: supõe-se o cursor padrão do navegador)` : ''}`,
          )
        : '',
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
          conditions: conditionsText(
            record,
            app
              ? say(ctx.locale, `captures with focus, after it moved on and before it arrived, at ${walk.viewport.width}×${walk.viewport.height}`, `capturas com foco, depois que ele seguiu e antes de chegar, em ${walk.viewport.width}×${walk.viewport.height}`)
              : say(ctx.locale, `focused and blurred captures at ${walk.viewport.width}×${walk.viewport.height}`, `capturas com e sem foco em ${walk.viewport.width}×${walk.viewport.height}`),
          ),
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
export const focusObscuredRule: ProbeRule = obscuredRuleFor('keyboard-walk')

/** The same rule over the narrow walk at 390×844: a separate coverage line, findings keyed by the window size. */
export const focusObscuredNarrowRule: ProbeRule = obscuredRuleFor('keyboard-walk-390x844')

function obscuredRuleFor(variant: string): ProbeRule {
  return {
    id: 'rampa/focus-obscured',
    kind: 'keyboard',
    variant,
    versions: FOCUS_VERSIONS,
    criteria: ['2.4.11'],
    run(record: ProbeRecord, ctx) {
      const walk = walkOf(record)
      // An app screen has no CSS: no scroll-padding to suggest, and the pixel check is the change on focus, not painting.
      const app = appPlatform(record) !== undefined
      const findings: Finding[] = []
      let failures = 0
      let unmatched = 0
      const measured = new Set<string>()
      let translucent = 0
      let selfHidden = 0
      const reported = new Set<string>()
      for (const stop of [...walk.forward, ...walk.backward] as FocusStop[]) {
        const grid = stop.obscured
        if (!stop.el || !grid || grid.points === 0) continue
        measured.add(stop.el.ref)
        if (grid.covered < grid.points || reported.has(stop.el.ref)) continue
        if (grid.selfHidden) {
          selfHidden++
          continue
        }
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
          ? `${by.label ? `<${by.tag}> "${by.label.slice(0, 40)}"` : `<${by.tag}>`} ${by.ref} (${app ? '' : `position: ${by.position}, `}${Math.round(by.rect.width)}×${Math.round(by.rect.height)} px ${at} y ${Math.round(by.rect.y)})`
          : say(ctx.locale, 'other content', 'outro conteúdo')
        const padding = (side: 'top' | 'bottom') =>
          say(
            ctx.locale,
            `; scroll-padding-${side}: ${Math.round(by?.rect.height ?? 0)}px on html would keep focused elements clear of it`,
            `; scroll-padding-${side}: ${Math.round(by?.rect.height ?? 0)}px no html manteria os elementos focados livres dele`,
          )
        const hint = app ? '' : by && by.position !== 'static' && by.rect.y <= 1 ? padding('top') : by && by.position !== 'static' && by.rect.y + by.rect.height >= walk.viewport.height - 1 ? padding('bottom') : ''
        findings.push(
          probeFinding({
            criterion: '2.4.11',
            rule: this.id,
            node,
            message: OBSCURED_TEXT[ctx.locale],
            evidence: app
              ? say(
                  ctx.locale,
                  `${stop.key} ×${stop.n} on a ${walk.viewport.width}×${walk.viewport.height} screen: ${nameOf(node, stop.el)} at y ${Math.round(stop.rect?.y ?? 0)}; ${grid.covered} of ${grid.points} grid points lie under ${cover}, drawn over it; ${grid.painted} px around it changed when it took focus`,
                  `${stop.key} ×${stop.n} numa tela de ${walk.viewport.width}×${walk.viewport.height}: ${nameOf(node, stop.el)} em y ${Math.round(stop.rect?.y ?? 0)}; ${grid.covered} de ${grid.points} pontos da grade ficam sob ${cover}, desenhado por cima; ${grid.painted} px em volta mudaram quando ele recebeu o foco`,
                )
              : say(
                  ctx.locale,
                  `${stop.key} ×${stop.n} in a ${walk.viewport.width}×${walk.viewport.height} window: ${nameOf(node, stop.el)} at y ${Math.round(stop.rect?.y ?? 0)}; ${grid.covered} of ${grid.points} grid points hit ${cover}; painting it changed ${grid.painted} px and hiding it ${grid.hidden} px${hint}`,
                  `${stop.key} ×${stop.n} numa janela de ${walk.viewport.width}×${walk.viewport.height}: ${nameOf(node, stop.el)} em y ${Math.round(stop.rect?.y ?? 0)}; ${grid.covered} de ${grid.points} pontos da grade atingem ${cover}; pintá-lo mudou ${grid.painted} px e escondê-lo, ${grid.hidden} px${hint}`,
                ),
            confidence: 'high',
            subject: variant === 'keyboard-walk' ? 'obscured' : `obscured@${walk.viewport.width}x${walk.viewport.height}`,
          }),
        )
      }
      const notes = [
        translucent > 0
          ? say(ctx.locale, `${translucent} stop(s) fully under content that lets pixels through: not reported`, `${translucent} parada(s) sob conteúdo translúcido: não relatada(s)`)
          : '',
        moreNotListed(ctx.locale, failures - findings.length),
        selfHidden > 0
          ? say(ctx.locale, `${selfHidden} control(s) that paint nothing of their own (drawn by a label or a sibling): not judged`, `${selfHidden} controle(s) que não pintam nada próprio (desenhados por um rótulo ou um irmão): não julgado(s)`)
          : '',
      ].filter(Boolean)
      return {
        findings,
        review: [],
        coverage: [
          {
            criterion: '2.4.11',
            method: `probe/keyboard@${record.version}`,
            rule: this.id,
            conditions: conditionsText(
              record,
              app
                ? say(ctx.locale, `5×5 grid over the focused node's bounds at ${walk.viewport.width}×${walk.viewport.height}, forward walk`, `grade de 5×5 pontos sobre os limites do nó focado em ${walk.viewport.width}×${walk.viewport.height}, navegação para a frente`)
                : say(ctx.locale, `5×5 hit grid at ${walk.viewport.width}×${walk.viewport.height}, both directions`, `grade de 5×5 pontos em ${walk.viewport.width}×${walk.viewport.height}, nos dois sentidos`),
            ),
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
}
