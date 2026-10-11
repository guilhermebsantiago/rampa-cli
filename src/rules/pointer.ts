import type { Confidence, Finding, ProbeCoverage } from '../core/types.ts'
import type { Locale } from '../i18n.ts'
import { matchNode } from '../probes/identity.ts'
import { type DragAlternative, type DragCandidate, type GestureCandidate, POINTER_VERSION, type PointerData, type PressCandidate, type PressTrial, pressOutcome } from '../probes/pointer.ts'
import type { A11yNode, ProbeRecord } from '../snapshot/schema.ts'
import { type ProbeRule, type ProbeRuleContext, asArray, asRecord, conditionsText, probeFinding, say } from './probes.ts'

export const POINTER_CANCELLATION_RULE = 'rampa/pointer-cancellation'
export const DRAGGING_MOVEMENTS_RULE = 'rampa/dragging-movements'
export const POINTER_GESTURES_RULE = 'rampa/pointer-gestures'

export function pointerData(record: ProbeRecord): Partial<PointerData> {
  return asRecord(record.data) as Partial<PointerData>
}

const short = (text: string | undefined, n = 60) => {
  const value = (text ?? '').replace(/\s+/g, ' ').trim()
  return value.length > n ? `${value.slice(0, n - 1)}…` : value
}

function nameOf(element: { tag: string; label?: string | undefined }): string {
  return `<${element.tag}>${element.label ? ` "${short(element.label, 50)}"` : ''}`
}

function viewportText(data: Partial<PointerData>): string {
  const viewport = asRecord(data.viewport)
  return `${Number(viewport.width) || 0}×${Number(viewport.height) || 0}`
}

const SKIP_TEXT: Record<string, [string, string]> = {
  destructive: ['a destructive or account-changing name', 'um nome destrutivo ou que muda a conta'],
  submit: ['it submits', 'envia'],
  'sensitive-form': ['in a form with password, payment or file fields', 'em formulário com senha, pagamento ou arquivo'],
  download: ['a download', 'um download'],
  'new-window': ['opens a new window', 'abre nova janela'],
  'other-origin': ['another origin', 'outra origem'],
  disabled: ['disabled', 'desabilitado'],
  secret: ['a password or file field', 'campo de senha ou arquivo'],
}

function contextText(detail: string | undefined, locale: Locale): string {
  const [kind, ...rest] = (detail ?? '').split(': ')
  const what = short(rest.join(': '), 100)
  switch (kind) {
    case 'navigation':
      return say(locale, `goes to another page (${what})`, `vai para outra página (${what})`)
    case 'new-window':
      return say(locale, `opens a window (${what})`, `abre uma janela (${what})`)
    case 'submission':
      return say(locale, 'submits its form', 'envia o formulário')
    case 'modal':
      return say(locale, `opens a modal dialog${what ? ` ("${what}")` : ''}`, `abre um diálogo modal${what ? ` ("${what}")` : ''}`)
    default:
      return say(locale, `shows a browser dialog (${what})`, `mostra um diálogo do navegador (${what})`)
  }
}

export interface PressVerdict {
  press: PressCandidate
  node: A11yNode
  kind: ReturnType<typeof pressOutcome>['kind']
  detail?: string | undefined
  result: 'failure' | 'review'
  why?: 'once' | 'unconfirmed' | 'judge' | undefined
}

/** 2.5.2's reading of the presses: a change of context or a state the release did not undo, again on a second load, fails. */
export function pressVerdicts(data: Partial<PointerData>, index: ProbeRuleContext['index']): { verdicts: PressVerdict[]; applicable: number; unmatched: number; reversed: number } {
  const result = { verdicts: [] as PressVerdict[], applicable: 0, unmatched: 0, reversed: 0 }
  for (const press of asArray<PressCandidate>(data.presses)) {
    const trial = press?.trial
    if (!trial || trial.outcome) continue
    const node = matchNode(index, press.ref, press.id)
    if (!node) {
      result.unmatched++
      continue
    }
    result.applicable++
    const { kind, detail } = pressOutcome(trial)
    if (kind === 'reversed') result.reversed++
    if (kind === 'none' || kind === 'reversed') continue
    if (kind === 'context' || kind === 'state') {
      const confirm = trial.confirm as PressTrial['confirm']
      if (!confirm || confirm.outcome) result.verdicts.push({ press, node, kind, detail, result: 'review', why: 'unconfirmed' })
      else if (pressOutcome(confirm).kind === kind) result.verdicts.push({ press, node, kind, detail, result: 'failure' })
      else result.verdicts.push({ press, node, kind, detail, result: 'review', why: 'once' })
      continue
    }
    result.verdicts.push({ press, node, kind, detail, result: 'review', why: 'judge' })
  }
  return result
}

function pressMessage(verdict: PressVerdict, locale: Locale): string {
  const control = nameOf(verdict.press)
  const essential = say(locale, ' If acting on the press is essential (a piano keyboard, a game), the criterion allows it: waive the finding (rampa waive).', ' Se agir no pressionar é essencial (um teclado de piano, um jogo), o critério permite: dispense o achado (rampa waive).')
  if (verdict.result === 'failure' && verdict.kind === 'context') {
    return say(
      locale,
      `Pressing ${control} ${contextText(verdict.detail, locale)} on the press itself (the down-event), before the pointer is released, and moving the pointer away before releasing does not stop it (WCAG 2.5.2; F101). Run the action on the up-event (a click), so people who press the wrong control can slide off it.${essential}`,
      `Pressionar ${control} ${contextText(verdict.detail, locale)} no próprio pressionar (o evento de descida), antes de o ponteiro ser solto, e afastar o ponteiro antes de soltar não impede isso (WCAG 2.5.2; F101). Faça a ação no evento de subida (um clique), para quem pressiona o controle errado poder deslizar para fora dele.${essential}`,
    )
  }
  if (verdict.result === 'failure') {
    return say(
      locale,
      `Pressing ${control} changes it on the press itself (${verdict.detail}), and the change stays when the pointer moves away and is released elsewhere: there is no way to abort it (WCAG 2.5.2). Change it on the up-event (a click), or undo the change when the pointer is released outside the control.${essential}`,
      `Pressionar ${control} muda o controle no próprio pressionar (${verdict.detail}), e a mudança fica quando o ponteiro se afasta e é solto em outro lugar: não há como abortar (WCAG 2.5.2). Mude no evento de subida (um clique), ou desfaça a mudança quando o ponteiro for solto fora do controle.${essential}`,
    )
  }
  const what =
    verdict.kind === 'context'
      ? contextText(verdict.detail, locale)
      : verdict.kind === 'state'
        ? say(locale, `changes it (${verdict.detail})`, `muda o controle (${verdict.detail})`)
        : verdict.kind === 'layer' || verdict.kind === 'expanded'
          ? say(locale, `opens ${verdict.kind === 'layer' && verdict.detail ? `"${short(verdict.detail, 60)}"` : 'something (aria-expanded)'}`, `abre ${verdict.kind === 'layer' && verdict.detail ? `"${short(verdict.detail, 60)}"` : 'algo (aria-expanded)'}`)
          : say(locale, `changes the page (${short(verdict.detail, 80)})`, `muda a página (${short(verdict.detail, 80)})`)
  const why =
    verdict.why === 'once'
      ? say(locale, 'It did not happen again on a second load: check it by hand.', 'Não aconteceu de novo numa segunda carga: verifique à mão.')
      : verdict.why === 'unconfirmed'
        ? say(locale, 'It was not tried again on a second load: check it by hand.', 'Não foi tentado de novo numa segunda carga: verifique à mão.')
        : verdict.kind === 'layer' || verdict.kind === 'expanded'
          ? say(locale, 'Opening a menu or a popup is often not the function itself: check that nothing is chosen or done on the press, and that what opened can be closed.', 'Abrir um menu ou um popup muitas vezes não é a função em si: confira se nada é escolhido ou feito no pressionar, e se o que abriu pode ser fechado.')
          : say(locale, 'Check whether a function ran on the press with no way to abort it.', 'Confira se uma função rodou no pressionar sem como abortar.')
  return say(
    locale,
    `Pressing ${control} ${what} on the press, and it stays after the pointer is released elsewhere. ${why} (WCAG 2.5.2)`,
    `Pressionar ${control} ${what} no pressionar, e isso fica depois que o ponteiro é solto em outro lugar. ${why} (WCAG 2.5.2)`,
  )
}

function pressEvidence(verdict: PressVerdict, locale: Locale): string {
  const trial = verdict.press.trial
  const parts = [
    say(locale, 'pressed, moved away and released there', 'pressionado, afastado e solto lá'),
    trial?.onDown && (trial.onDown.state.length > 0 || trial.onDown.dom > 0) ? say(locale, `on the press: ${[...trial.onDown.state, ...trial.onDown.samples].slice(0, 3).join('; ')}`, `no pressionar: ${[...trial.onDown.state, ...trial.onDown.samples].slice(0, 3).join('; ')}`) : '',
    verdict.kind === 'context' ? verdict.detail ?? '' : '',
    trial?.persisted && (trial.persisted.state.length > 0 || trial.persisted.dom > 0) ? say(locale, `after the release: ${[...trial.persisted.state, ...trial.persisted.samples].slice(0, 3).join('; ')}`, `depois de soltar: ${[...trial.persisted.state, ...trial.persisted.samples].slice(0, 3).join('; ')}`) : '',
    trial?.layer ? say(locale, `opened "${short(trial.layer.name, 40)}"${trial.layer.stayed ? ', still open after the release' : ''}`, `abriu "${short(trial.layer.name, 40)}"${trial.layer.stayed ? ', ainda aberto depois de soltar' : ''}`) : '',
    verdict.result === 'failure' ? say(locale, 'again on a second fresh load', 'de novo numa segunda carga nova') : verdict.why === 'once' ? say(locale, 'not again on a second fresh load', 'não de novo numa segunda carga nova') : '',
  ]
  return parts.filter(Boolean).join('; ')
}

function skippedNote<T extends { skip?: { reason: string; detail?: string | undefined } | undefined; tag: string; label?: string | undefined }>(items: T[], loc: Locale): string {
  const skipped = items.filter((item) => item.skip)
  if (skipped.length === 0) return ''
  return `${say(loc, `${skipped.length} skipped`, `${skipped.length} pulado(s)`)}: ${skipped
    .slice(0, 3)
    .map((item) => `${nameOf(item)} (${say(loc, ...(SKIP_TEXT[item.skip?.reason ?? ''] ?? [item.skip?.reason ?? '', item.skip?.reason ?? '']))}${item.skip?.reason === 'destructive' && item.skip.detail ? ` "${item.skip.detail}"` : ''})`)
    .join(', ')}${skipped.length > 3 ? ', …' : ''}`
}

/**
 * 2.5.2 Pointer Cancellation, over the pointer probe. A press (the down-event), the pointer moved away and released
 * there: a navigation, a window, a submission or a dialog on the press, or a state of the control (pressed, checked,
 * selected, its text) that the release away left in place, again on a second fresh load, fails (F101). A menu or popup
 * that opens on the press and stays, or other changes that stay, go to review; changes the release undid (up reversal)
 * and feedback inside the control (a ripple, a pressed look) are not reported.
 */
export const pointerCancellationRule: ProbeRule = {
  id: POINTER_CANCELLATION_RULE,
  kind: 'pointer',
  variant: 'pointer',
  versions: [POINTER_VERSION],
  criteria: ['2.5.2'],
  run(record: ProbeRecord, ctx: ProbeRuleContext) {
    const data = pointerData(record)
    const loc = ctx.locale
    const { verdicts, applicable, unmatched, reversed } = pressVerdicts(data, ctx.index)
    const findings: Finding[] = []
    const review: Finding[] = []
    for (const verdict of verdicts) {
      const confidence: Confidence = verdict.result === 'failure' ? (verdict.kind === 'context' ? 'high' : 'medium') : 'low'
      const finding = probeFinding({
        criterion: '2.5.2',
        rule: this.id,
        node: verdict.node,
        message: pressMessage(verdict, loc),
        evidence: pressEvidence(verdict, loc),
        confidence,
        subject: `${verdict.kind}|${(verdict.detail ?? '').split(': ')[0]}`,
      })
      ;(verdict.result === 'failure' ? findings : review).push(finding)
    }
    const presses = asArray<PressCandidate>(data.presses)
    const tried = presses.filter((p) => p.trial && !p.trial.outcome).length
    const notExercised = presses.filter((p) => p.trial?.outcome === 'not-exercised').length
    const notTried = presses.filter((p) => p.trial?.outcome === 'not-tried').length
    const notes = [
      say(
        loc,
        `${Number(data.found) || 0} control(s) found (${Number(data.withDown) || 0} with a press listener of their own${data.listeners === false ? '; listeners could not be read' : ''}), ${tried} pressed, the pointer moved away and released there`,
        `${Number(data.found) || 0} controle(s) encontrado(s) (${Number(data.withDown) || 0} com ouvinte de pressionar próprio${data.listeners === false ? '; ouvintes não puderam ser lidos' : ''}), ${tried} pressionado(s), o ponteiro afastado e solto lá`,
      ),
      reversed > 0 ? say(loc, `${reversed} changed on the press and were undone by the release away (up reversal)`, `${reversed} mudaram no pressionar e foram desfeitos ao soltar fora (reversão na subida)`) : '',
      skippedNote(presses, loc),
      notExercised > 0 ? say(loc, `${notExercised} not exercised (covered, hidden, or no place to release away)`, `${notExercised} não exercitado(s) (coberto, escondido ou sem lugar para soltar fora)`) : '',
      notTried > 0 ? say(loc, `${notTried} not tried (${data.end === 'time' ? 'time budget' : 'budget'})`, `${notTried} não tentado(s) (${data.end === 'time' ? 'limite de tempo' : 'limite'})`) : '',
      say(loc, 'mouse only, no touch; nothing was submitted', 'só mouse, sem toque; nada foi enviado'),
    ].filter(Boolean)
    // No control at all: no applicable content on this page; controls that could not be pressed: not checked.
    const status: ProbeCoverage['status'] = findings.length > 0 ? 'failures' : review.length > 0 ? 'needs-review' : applicable > 0 || presses.length === 0 ? 'no-failure-found' : 'not-checked'
    return {
      findings,
      review,
      coverage: [
        {
          criterion: '2.5.2',
          method: `probe/pointer@${record.version}`,
          rule: this.id,
          conditions: conditionsText(record, say(loc, `each control pressed, the pointer moved away and released, at ${viewportText(data)}`, `cada controle pressionado, o ponteiro afastado e solto, em ${viewportText(data)}`)),
          status,
          applicable,
          failures: findings.length,
          review: review.length,
          unmatched,
          note: notes.join('; '),
          maturity: 'experimental',
        },
      ],
    }
  },
}

const KIND_TEXT: Record<string, [string, string]> = {
  slider: ['a slider', 'um controle deslizante'],
  sortable: ['an item of a list that is sorted by dragging', 'um item de uma lista ordenada arrastando'],
  draggable: ['an item that is dragged', 'um item que se arrasta'],
  splitter: ['a splitter between panes', 'um divisor entre painéis'],
  other: ['an element that is moved by dragging', 'um elemento que se move arrastando'],
  map: ['a map', 'um mapa'],
}

export interface DragVerdict {
  drag: DragCandidate
  node: A11yNode
  result: 'failure' | 'review' | 'pass'
  why: 'alternative' | 'none-found' | 'none-worked' | 'map' | 'kind'
}

/** 2.5.7's reading of the drags: a drag that changed something, with no single-pointer way found to do the same. */
export function dragVerdicts(data: Partial<PointerData>, index: ProbeRuleContext['index']): { verdicts: DragVerdict[]; unmatched: number; noEffect: number } {
  const result = { verdicts: [] as DragVerdict[], unmatched: 0, noEffect: 0 }
  for (const drag of asArray<DragCandidate>(data.drags)) {
    if (!drag || drag.skip) continue
    if (drag.kind !== 'map' && (!drag.trial || drag.trial.outcome)) continue
    const node = matchNode(index, drag.ref, drag.id)
    if (!node) {
      result.unmatched++
      continue
    }
    if (drag.kind === 'map') {
      result.verdicts.push({ drag, node, result: 'review', why: 'map' })
      continue
    }
    if (drag.trial?.moved !== true) {
      result.noEffect++
      continue
    }
    const alternatives = asArray<DragAlternative>(drag.trial.alternatives)
    if (alternatives.some((a) => a.reproduced)) {
      result.verdicts.push({ drag, node, result: 'pass', why: 'alternative' })
      continue
    }
    // Alternatives other than the track click that were found, tried or not: a person must look at them.
    const others = alternatives.filter((a) => a.kind !== 'track')
    if (drag.kind !== 'slider' && drag.kind !== 'sortable' && drag.kind !== 'draggable') result.verdicts.push({ drag, node, result: 'review', why: 'kind' })
    else if (others.length > 0) result.verdicts.push({ drag, node, result: 'review', why: 'none-worked' })
    else result.verdicts.push({ drag, node, result: 'failure', why: 'none-found' })
  }
  return result
}

function dragMessage(verdict: DragVerdict, locale: Locale): string {
  const { drag } = verdict
  const element = nameOf(drag)
  const kind = say(locale, ...(KIND_TEXT[drag.kind] ?? [drag.kind, drag.kind]))
  const effect = short(drag.trial?.effect, 60)
  const keys = say(locale, 'Arrow keys serve the keyboard, not a pointer.', 'Teclas de seta servem o teclado, não um ponteiro.')
  const fix =
    drag.kind === 'slider'
      ? say(locale, 'Let a click on the track set the value, or add buttons that raise and lower it, or an input for it.', 'Deixe um clique no trilho definir o valor, ou adicione botões que aumentem e diminuam, ou um campo para ele.')
      : say(locale, 'Add buttons that move the item up and down, or a menu or select to choose its place.', 'Adicione botões que movam o item para cima e para baixo, ou um menu ou seleção para escolher o lugar.')
  const essential = say(locale, ' If dragging is essential, the criterion allows it: waive the finding (rampa waive).', ' Se arrastar é essencial, o critério permite: dispense o achado (rampa waive).')
  if (verdict.why === 'map') {
    return say(
      locale,
      `${element} is ${kind}, which pans with a drag: check that buttons, a search or links move it too, with single clicks (WCAG 2.5.7). Rampa does not drag maps.`,
      `${element} é ${kind}, que se move arrastando: confira se botões, uma busca ou links também o movem com cliques simples (WCAG 2.5.7). O Rampa não arrasta mapas.`,
    )
  }
  if (verdict.result === 'failure') {
    const tried = drag.kind === 'slider' ? say(locale, 'a click on its track changed nothing, and no button, input or select around it changes the value', 'um clique no trilho não mudou nada, e nenhum botão, campo ou seleção ao redor muda o valor') : say(locale, 'no button, input, select or menu around it moves the item', 'nenhum botão, campo, seleção ou menu ao redor move o item')
    return say(
      locale,
      `${element} is ${kind}: dragging it changes it (${effect}), and Rampa found no way to do the same without dragging: ${tried} (WCAG 2.5.7). ${keys} ${fix}${essential}`,
      `${element} é ${kind}: arrastá-lo o muda (${effect}), e o Rampa não achou como fazer o mesmo sem arrastar: ${tried} (WCAG 2.5.7). ${keys} ${fix}${essential}`,
    )
  }
  const others = asArray<{ label: string; skipped?: string }>(drag.trial?.alternatives).filter((a) => (a as { kind?: string }).kind !== 'track')
  const list = others.map((a) => `"${short(a.label, 30)}"${a.skipped ? ` (${a.skipped})` : ''}`).join(', ')
  const why =
    verdict.why === 'none-worked'
      ? say(locale, `The controls around it (${list}) did not do the same when clicked or used once`, `Os controles ao redor (${list}) não fizeram o mesmo ao serem usados uma vez`)
      : say(locale, 'Whether a single-pointer way to do the same exists needs a person', 'Se existe um jeito de fazer o mesmo com um ponteiro simples precisa de uma pessoa')
  return say(
    locale,
    `${element} is ${kind}: dragging it changes it (${effect}). ${why}: check that the same can be done with single clicks or typing (WCAG 2.5.7). ${keys}`,
    `${element} é ${kind}: arrastá-lo o muda (${effect}). ${why}: confira se o mesmo pode ser feito com cliques simples ou digitando (WCAG 2.5.7). ${keys}`,
  )
}

/**
 * 2.5.7 Dragging Movements, over the pointer probe. A slider or a sortable or draggable item that a pointer drag
 * changed (its value, the order of its list), where no click on the track, no button, input or select around it, and no
 * menu the item opens did the same, fails; when such controls were found but did not do the same, or for splitters and
 * other elements moved by dragging, it goes to review, and maps (never dragged) too. Arrow keys are not counted: they
 * serve the keyboard. Native range inputs are the browser's own and are not listed.
 */
export const draggingMovementsRule: ProbeRule = {
  id: DRAGGING_MOVEMENTS_RULE,
  kind: 'pointer',
  variant: 'pointer',
  versions: [POINTER_VERSION],
  criteria: ['2.5.7'],
  run(record: ProbeRecord, ctx: ProbeRuleContext) {
    const data = pointerData(record)
    const loc = ctx.locale
    const { verdicts, unmatched, noEffect } = dragVerdicts(data, ctx.index)
    const findings: Finding[] = []
    const review: Finding[] = []
    for (const verdict of verdicts) {
      if (verdict.result === 'pass') continue
      const alternatives = asArray<{ kind: string; label: string; reproduced?: boolean; skipped?: string }>(verdict.drag.trial?.alternatives)
      const evidence = [
        verdict.drag.trial?.effect ? say(loc, `dragged: ${verdict.drag.trial.effect}`, `arrastado: ${verdict.drag.trial.effect}`) : '',
        alternatives.length > 0
          ? say(loc, `tried: ${alternatives.map((a) => `${a.label}${a.skipped ? ` (not tried: ${a.skipped})` : ' (no change)'}`).join(', ')}`, `tentado: ${alternatives.map((a) => `${a.label}${a.skipped ? ` (não tentado: ${a.skipped})` : ' (sem mudança)'}`).join(', ')}`)
          : say(loc, 'no single-pointer alternative found around it', 'nenhuma alternativa de ponteiro simples encontrada ao redor'),
      ]
        .filter(Boolean)
        .join('; ')
      const finding = probeFinding({
        criterion: '2.5.7',
        rule: this.id,
        node: verdict.node,
        message: dragMessage(verdict, loc),
        evidence,
        confidence: verdict.result === 'failure' ? 'medium' : 'low',
        subject: `${verdict.drag.kind}|${verdict.why}`,
      })
      ;(verdict.result === 'failure' ? findings : review).push(finding)
    }
    const drags = asArray<DragCandidate>(data.drags)
    const counts = new Map<string, number>()
    for (const drag of drags) counts.set(drag.kind, (counts.get(drag.kind) ?? 0) + 1)
    const passed = verdicts.filter((v) => v.result === 'pass')
    const applicable = verdicts.filter((v) => v.why !== 'map').length
    const notes = [
      drags.length > 0
        ? say(loc, `${drags.length} drag widget(s) found: ${[...counts].map(([kind, n]) => `${n} ${kind}`).join(', ')}`, `${drags.length} widget(s) de arrastar encontrado(s): ${[...counts].map(([kind, n]) => `${n} ${kind}`).join(', ')}`)
        : say(loc, 'no slider, sortable or draggable item, splitter or map found', 'nenhum controle deslizante, item ordenável ou arrastável, divisor ou mapa encontrado'),
      noEffect > 0 ? say(loc, `${noEffect} did not change when dragged`, `${noEffect} não mudou(aram) ao ser(em) arrastado(s)`) : '',
      drags.some((d) => d.trial?.outcome === 'not-tried')
        ? say(loc, `${drags.filter((d) => d.trial?.outcome === 'not-tried').length} not tried (budget)`, `${drags.filter((d) => d.trial?.outcome === 'not-tried').length} não tentado(s) (limite)`)
        : '',
      passed.length > 0
        ? say(
            loc,
            `with a single-pointer alternative: ${passed.map((v) => `${nameOf(v.drag)} (${asArray<{ label: string; reproduced?: boolean }>(v.drag.trial?.alternatives).find((a) => a.reproduced)?.label ?? ''})`).join(', ')}`,
            `com alternativa de ponteiro simples: ${passed.map((v) => `${nameOf(v.drag)} (${asArray<{ label: string; reproduced?: boolean }>(v.drag.trial?.alternatives).find((a) => a.reproduced)?.label ?? ''})`).join(', ')}`,
          )
        : '',
      skippedNote(drags, loc),
      say(loc, 'arrow keys are not counted as an alternative; drags on a canvas, or with no sign in the markup, are not seen', 'teclas de seta não contam como alternativa; arrastos num canvas, ou sem sinal na marcação, não são vistos'),
    ].filter(Boolean)
    // No drag widget at all: no applicable content on this page, which the note bounds; widgets that could not be dragged: not checked.
    const status: ProbeCoverage['status'] = findings.length > 0 ? 'failures' : review.length > 0 ? 'needs-review' : applicable > 0 || drags.length === 0 ? 'no-failure-found' : 'not-checked'
    return {
      findings,
      review,
      coverage: [
        {
          criterion: '2.5.7',
          method: `probe/pointer@${record.version}`,
          rule: this.id,
          conditions: conditionsText(record, say(loc, `each drag widget dragged with the mouse, then single clicks and typing tried on a fresh page, at ${viewportText(data)}`, `cada widget de arrastar arrastado com o mouse, depois cliques simples e digitação tentados numa página nova, em ${viewportText(data)}`)),
          status,
          applicable,
          failures: findings.length,
          review: review.length,
          unmatched,
          note: notes.join('; '),
          maturity: 'experimental',
        },
      ],
    }
  },
}

/**
 * 2.5.1 Pointer Gestures, over the pointer probe, for review only (the plan's C7: "needs review only"; D2 adds swipes
 * and pinches): each element that reacts to a swipe or a pinch (a carousel, a map, touch or gesture listeners) is an
 * item to review, naming the previous, next or zoom controls found around it, which nothing here presses. Never a
 * failure.
 */
export const pointerGesturesRule: ProbeRule = {
  id: POINTER_GESTURES_RULE,
  kind: 'pointer',
  variant: 'pointer',
  versions: [POINTER_VERSION],
  criteria: ['2.5.1'],
  run(record: ProbeRecord, ctx: ProbeRuleContext) {
    const data = pointerData(record)
    const loc = ctx.locale
    const review: Finding[] = []
    const covered: string[] = []
    let unmatched = 0
    let applicable = 0
    for (const gesture of asArray<GestureCandidate>(data.gestures)) {
      const node = matchNode(ctx.index, gesture?.ref, gesture?.id)
      if (!node) {
        unmatched++
        continue
      }
      applicable++
      const alternatives = asArray<string>(gesture.alternatives)
      if (alternatives.length > 0) covered.push(`${nameOf(gesture)} (${alternatives.slice(0, 2).map((a) => `"${a}"`).join(', ')})`)
      const what = gesture.kind === 'map' ? say(loc, 'pans and zooms with gestures', 'se move e aproxima com gestos') : say(loc, 'reacts to swipes', 'reage a deslizes')
      const list = alternatives.slice(0, 3).map((a) => `"${short(a, 30)}"`).join(', ')
      const found =
        alternatives.length > 0
          ? say(loc, `Controls around it may do the same with single clicks (${list}): check that they do everything the gesture does.`, `Controles ao redor podem fazer o mesmo com cliques simples (${list}): confira se fazem tudo o que o gesto faz.`)
          : say(loc, 'Rampa found no previous, next or zoom control around it: check that the same can be done with single clicks.', 'O Rampa não achou controle de anterior, próximo ou zoom ao redor: confira se o mesmo pode ser feito com cliques simples.')
      review.push(
        probeFinding({
          criterion: '2.5.1',
          rule: this.id,
          node,
          message: say(
            loc,
            `${nameOf(gesture)} ${what} (${gesture.why}). A path-based or multipoint gesture needs a single-pointer alternative, unless the gesture is essential (WCAG 2.5.1). ${found} Rampa does not swipe or pinch yet.`,
            `${nameOf(gesture)} ${what} (${gesture.why}). Um gesto de trajetória ou multiponto precisa de uma alternativa de ponteiro simples, a não ser que o gesto seja essencial (WCAG 2.5.1). ${found} O Rampa ainda não desliza nem faz pinça.`,
          ),
          evidence: [gesture.why, alternatives.length > 0 ? say(loc, `controls around it: ${list}`, `controles ao redor: ${list}`) : say(loc, 'no previous, next or zoom control around it', 'nenhum controle de anterior, próximo ou zoom ao redor')].join('; '),
          confidence: 'low',
          subject: `${gesture.kind}|${alternatives.length > 0 ? 'controls' : 'none'}`,
        }),
      )
    }
    const note = [
      applicable > 0
        ? say(loc, `${applicable} element(s) that may react to swipes or pinches`, `${applicable} elemento(s) que pode(m) reagir a deslizes ou pinças`)
        : say(loc, 'no carousel, map or touch listener found; gestures with no sign in the markup are not seen', 'nenhum carrossel, mapa ou ouvinte de toque encontrado; gestos sem sinal na marcação não são vistos'),
      covered.length > 0 ? say(loc, `with controls around them: ${covered.slice(0, 3).join(', ')}`, `com controles ao redor: ${covered.slice(0, 3).join(', ')}`) : '',
      say(loc, 'listed for review only: nothing is swiped or pinched', 'listado só para revisão: nada é deslizado nem pinçado'),
    ]
      .filter(Boolean)
      .join('; ')
    return {
      findings: [],
      review,
      coverage: [
        {
          criterion: '2.5.1',
          method: `probe/pointer@${record.version}`,
          rule: this.id,
          conditions: conditionsText(record, say(loc, `elements that react to gestures listed at ${viewportText(data)}`, `elementos que reagem a gestos listados em ${viewportText(data)}`)),
          // Every element found is for review; with none, 2.5.1 has no applicable content on this page, which the note bounds.
          status: review.length > 0 ? 'needs-review' : 'no-failure-found',
          applicable,
          failures: 0,
          review: review.length,
          unmatched,
          note,
          maturity: 'experimental',
        },
      ],
    }
  },
}

export const POINTER_RULES: readonly ProbeRule[] = [pointerGesturesRule, pointerCancellationRule, draggingMovementsRule]
