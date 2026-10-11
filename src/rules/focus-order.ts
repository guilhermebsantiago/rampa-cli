import type { Finding, ProbeCoverage } from '../core/types.ts'
import type { Locale } from '../i18n.ts'
import {
  ADJACENT_TABS,
  ENTER_CAP,
  FOCUS_ORDER_VERSION,
  type FocusPlace,
  type FocusProblem,
  type FocusVerdict,
  type PopupTrigger,
  focusOrderData,
  focusVerdicts,
  orderCandidates,
} from '../probes/focus-order.ts'
import type { ProbeRecord } from '../snapshot/schema.ts'
import { type ProbeRule, type ProbeRuleContext, asArray, asRecord, conditionsText, moreNotListed, probeFinding, say } from './probes.ts'

export const FOCUS_MANAGEMENT_RULE = 'rampa/focus-management'

const MAX_REPORTED = 10

const short = (text: string | undefined, n = 60) => {
  const value = (text ?? '').replace(/\s+/g, ' ').trim()
  return value.length > n ? `${value.slice(0, n - 1)}…` : value
}

const named = (el: { tag?: string; label?: string } | undefined) => (el ? `<${el.tag ?? 'element'}>${el.label ? ` "${short(el.label)}"` : ''}` : '')

function kindText(trigger: PopupTrigger, modal: boolean, locale: Locale): string {
  if (trigger.popup === 'menu') return say(locale, 'menu', 'menu')
  if (trigger.popup === 'disclosure') return say(locale, 'panel', 'painel')
  return modal ? say(locale, 'modal dialog', 'diálogo modal') : say(locale, 'dialog', 'diálogo')
}

function placeText(place: FocusPlace | undefined, locale: Locale): string {
  switch (place?.where) {
    case 'inside':
      return say(locale, `inside it, on ${named(place.el)}`, `dentro dele, em ${named(place.el)}`)
    case 'trigger':
      return say(locale, 'on the control that opened it', 'no controle que o abriu')
    case 'body':
      return say(locale, 'on the document (nothing focused)', 'no documento (nada com foco)')
    case 'elsewhere':
      return say(locale, `on ${named(place.el)}`, `em ${named(place.el)}`)
    default:
      return say(locale, 'unknown', 'desconhecido')
  }
}

function message(verdict: FocusVerdict, locale: Locale): string {
  const trial = verdict.trigger.trial
  const modal = trial?.container?.modal === true
  const kind = kindText(verdict.trigger, modal, locale)
  const key = trial?.openedWith === 'click' ? say(locale, 'a click', 'um clique') : (trial?.openedWith ?? 'Enter')
  const closeWith = trial?.close?.with === 'close button' ? say(locale, 'its close button', 'seu botão de fechar') : 'Esc'
  switch (verdict.problem) {
    case 'never-takes':
      return modal
        ? say(
            locale,
            `Opening this ${kind} with ${key} leaves keyboard focus outside it, and Tab from there does not get into it within ${ENTER_CAP} presses: someone who uses a keyboard cannot reach what it asks (WCAG 2.4.3). Move focus into the dialog when it opens (SCR37; the APG dialog pattern), or use <dialog> with showModal().`,
            `Abrir este ${kind} com ${key} deixa o foco do teclado fora dele, e o Tab a partir dali não entra nele em ${ENTER_CAP} toques: quem usa teclado não alcança o que ele pede (WCAG 2.4.3). Mova o foco para dentro do diálogo quando ele abre (SCR37; o padrão de diálogo da APG), ou use <dialog> com showModal().`,
          )
        : say(
            locale,
            `Opening this ${kind} with ${key} leaves keyboard focus outside it, and Tab from there does not get into it within ${ENTER_CAP} presses: it is not next to the control that opens it in the focus order (WCAG 2.4.3; F85). Insert it right after that control in the DOM, or move focus into it when it opens.`,
            `Abrir este ${kind} com ${key} deixa o foco do teclado fora dele, e o Tab a partir dali não entra nele em ${ENTER_CAP} toques: ele não fica logo depois do controle que o abre na ordem do foco (WCAG 2.4.3; F85). Insira-o logo depois desse controle no DOM, ou mova o foco para dentro dele quando ele abre.`,
          )
    case 'not-adjacent':
      return say(
        locale,
        `Opening this ${kind} with ${key} leaves keyboard focus outside it, and it takes ${trial?.enter?.tabs ?? '?'} Tab presses to get into it: it is not next to the control that opens it in the focus order (WCAG 2.4.3; F85). Insert it right after that control in the DOM, or move focus into it when it opens.`,
        `Abrir este ${kind} com ${key} deixa o foco do teclado fora dele, e são precisos ${trial?.enter?.tabs ?? '?'} toques de Tab para entrar nele: ele não fica logo depois do controle que o abre na ordem do foco (WCAG 2.4.3; F85). Insira-o logo depois desse controle no DOM, ou mova o foco para dentro dele quando ele abre.`,
      )
    case 'does-not-hold':
      return say(
        locale,
        `While this ${kind} is open, Tab moves keyboard focus out of it to the page behind (${named(trial?.hold?.escaped?.el)}), which a modal dialog covers (WCAG 2.4.3). Keep focus inside while it is open: <dialog> with showModal() does, or make the rest of the page inert.`,
        `Enquanto este ${kind} está aberto, o Tab leva o foco do teclado para fora dele, para a página atrás (${named(trial?.hold?.escaped?.el)}), que um diálogo modal cobre (WCAG 2.4.3). Mantenha o foco dentro enquanto ele está aberto: <dialog> com showModal() faz isso, ou torne o resto da página inerte.`,
      )
    case 'lost':
      return say(
        locale,
        `Closing this ${kind} with ${closeWith} leaves keyboard focus on the document instead of the control that opened it: the next Tab starts from wherever the browser puts it (WCAG 2.4.3). Return focus to that control when it closes.`,
        `Fechar este ${kind} com ${closeWith} deixa o foco do teclado no documento, e não no controle que o abriu: o próximo Tab começa de onde o navegador decidir (WCAG 2.4.3). Devolva o foco a esse controle quando ele fecha.`,
      )
    case 'far':
      return say(
        locale,
        `Closing this ${kind} with ${closeWith} sends keyboard focus to ${named(trial?.onClose?.el)}, ${trial?.onClose?.distance ?? '?'} Tab stops away from the control that opened it (WCAG 2.4.3; F85). Return focus to that control, or to the next step of the task.`,
        `Fechar este ${kind} com ${closeWith} manda o foco do teclado para ${named(trial?.onClose?.el)}, a ${trial?.onClose?.distance ?? '?'} paradas de Tab do controle que o abriu (WCAG 2.4.3; F85). Devolva o foco a esse controle, ou ao próximo passo da tarefa.`,
      )
    case 'trigger-gone':
      return say(
        locale,
        `Closing this ${kind} removed the control that opened it, and keyboard focus went to ${named(trial?.onClose?.el)}. Check that focus lands where the task goes on.`,
        `Fechar este ${kind} removeu o controle que o abriu, e o foco do teclado foi para ${named(trial?.onClose?.el)}. Confira se o foco cai onde a tarefa continua.`,
      )
  }
}

function evidence(verdict: FocusVerdict, locale: Locale): string {
  const trial = verdict.trigger.trial
  const container = trial?.container
  const parts = [
    say(locale, `focus on it, then ${trial?.openedWith ?? '?'}`, `foco nele, depois ${trial?.openedWith ?? '?'}`),
    container ? say(locale, `opened ${named({ tag: container.tag, label: container.name })}${container.modal ? ' (modal)' : ''}`, `abriu ${named({ tag: container.tag, label: container.name })}${container.modal ? ' (modal)' : ''}`) : '',
    say(locale, `focus then ${placeText(trial?.onOpen, locale)}`, `foco então ${placeText(trial?.onOpen, locale)}`),
  ]
  const enter = trial?.enter
  if (enter) {
    const via = asArray<{ tag?: string; label?: string }>(enter.via)
      .slice(0, 3)
      .map((el) => named(el))
      .join(', ')
    parts.push(
      enter.tabs === null
        ? say(locale, `Tab ×${enter.left ? 'until focus left the page' : enter.cap} did not get in${via ? ` (it went to ${via}, …)` : ''}`, `Tab ×${enter.left ? 'até o foco sair da página' : enter.cap} não entrou${via ? ` (foi para ${via}, …)` : ''}`)
        : say(locale, `Tab ×${enter.tabs} got in${via ? `, by way of ${via}` : ''}`, `Tab ×${enter.tabs} entrou${via ? `, passando por ${via}` : ''}`),
    )
  }
  if (trial?.hold) {
    parts.push(
      trial.hold.escaped
        ? say(locale, `from inside, Tab went out to ${named(trial.hold.escaped.el)}`, `de dentro, o Tab saiu para ${named(trial.hold.escaped.el)}`)
        : say(locale, `from inside, Tab ×${trial.hold.tabs} stayed in`, `de dentro, Tab ×${trial.hold.tabs} ficou dentro`),
    )
  }
  if (trial?.close) {
    parts.push(
      trial.close.closed
        ? say(locale, `${trial.close.with === 'close button' ? `Enter on ${named(trial.close.button)}` : 'Esc'} closed it; focus then ${placeText(trial.onClose, locale)}${trial.onClose?.distance !== undefined && trial.onClose.where === 'elsewhere' ? `, ${trial.onClose.distance} Tab stop(s) from the trigger` : ''}`, `${trial.close.with === 'close button' ? `Enter em ${named(trial.close.button)}` : 'Esc'} o fechou; foco então ${placeText(trial.onClose, locale)}${trial.onClose?.distance !== undefined && trial.onClose.where === 'elsewhere' ? `, a ${trial.onClose.distance} parada(s) de Tab do gatilho` : ''}`)
        : say(locale, 'neither Esc nor a close button closed it', 'nem Esc nem um botão de fechar o fechou'),
    )
  }
  if (verdict.confirmed) parts.push(say(locale, 'the same on a second fresh load', 'o mesmo numa segunda carga nova'))
  else if (verdict.status === 'review' && verdict.problem !== 'trigger-gone') parts.push(say(locale, 'not seen again on a second load', 'não visto de novo numa segunda carga'))
  return parts.filter(Boolean).join('; ')
}

const CONFIDENCE: Record<FocusProblem, 'high' | 'medium'> = { 'never-takes': 'high', 'does-not-hold': 'high', lost: 'high', 'not-adjacent': 'medium', far: 'medium', 'trigger-gone': 'medium' }

/**
 * 2.4.3 Focus Order, dialogs and menus (rule `rampa/focus-management`). For each control that opened a dialog, a menu
 * or a disclosure from the keyboard: focus that stays outside and that Tab does not bring in within 40 presses, twice
 * (high); focus that stays outside with more than three Tab presses to get in (F85, medium); a modal that lets Tab out
 * to the page behind (high); focus left on the document once it closed, twice (high); focus sent more than three Tab
 * stops from the trigger once it closed (medium). Once of two loads, and focus elsewhere when closing removed the
 * trigger, go to review. The order of the page itself is not judged here: positive tabindex values and groups Tab
 * visits going back are the 2.4.3 judgment's (criteria/focus-order.ts), and the coverage note counts them.
 */
export const focusManagementRule: ProbeRule = {
  id: FOCUS_MANAGEMENT_RULE,
  kind: 'focus-order',
  variant: 'focus-management',
  versions: [FOCUS_ORDER_VERSION],
  criteria: ['2.4.3'],
  run(record: ProbeRecord, ctx: ProbeRuleContext) {
    const data = focusOrderData(record)
    const loc = ctx.locale
    const read = focusVerdicts(data, ctx.index)
    const findings: Finding[] = []
    const review: Finding[] = []
    let failures = 0
    for (const verdict of read.verdicts) {
      const finding = probeFinding({
        criterion: '2.4.3',
        rule: this.id,
        node: verdict.node,
        message: message(verdict, loc),
        evidence: evidence(verdict, loc),
        confidence: verdict.status === 'review' ? 'low' : CONFIDENCE[verdict.problem],
        subject: `focus|${verdict.problem}`,
      })
      if (verdict.status === 'review') review.push(finding)
      else {
        failures++
        if (findings.length < MAX_REPORTED) findings.push(finding)
      }
    }
    const triggers = asArray<PopupTrigger>(data.triggers)
    const skipped = triggers.filter((t) => t.skip)
    const notExercised = triggers.filter((t) => t.trial?.outcome === 'not-exercised')
    const notTried = triggers.filter((t) => t.trial?.outcome === 'not-tried').length
    const sequence = data.sequence
    const candidates = orderCandidates(sequence)
    const found = Number(data.found) || 0
    const notes = [
      found === 0
        ? say(loc, 'no dialog, menu or disclosure found', 'nenhum diálogo, menu ou painel de revelação encontrado')
        : say(loc, `${found} control(s) that open a dialog, a menu or a panel, ${Number(data.tried) || 0} tried, each on a fresh load`, `${found} controle(s) que abrem diálogo, menu ou painel, ${Number(data.tried) || 0} testado(s), cada um numa carga nova`),
      read.notOpened > 0 ? say(loc, `${read.notOpened} opened nothing`, `${read.notOpened} não abriu(abriram) nada`) : '',
      skipped.length > 0
        ? `${say(loc, `${skipped.length} skipped`, `${skipped.length} pulado(s)`)}: ${skipped
            .slice(0, 3)
            .map((t) => `${named(t)}${t.skip?.detail ? ` ("${t.skip.detail}")` : ` (${t.skip?.reason ?? ''})`}`)
            .join(', ')}`
        : '',
      notExercised.length > 0 ? say(loc, `${notExercised.length} not exercised`, `${notExercised.length} não exercitado(s)`) : '',
      notTried > 0 ? say(loc, `${notTried} not tried (${data.end === 'time' ? 'time budget' : 'budget'})`, `${notTried} não testado(s) (${data.end === 'time' ? 'limite de tempo' : 'limite'})`) : '',
      Number(data.unclaimed) > 0 ? say(loc, `${Number(data.unclaimed)} hidden dialog(s) no control is tied to`, `${Number(data.unclaimed)} diálogo(s) oculto(s) sem controle ligado`) : '',
      sequence
        ? say(
            loc,
            `the Tab sequence: ${asArray(sequence.stops).length} stop(s), ${candidates.length} order(s) for the 2.4.3 judgment`,
            `a sequência do Tab: ${asArray(sequence.stops).length} parada(s), ${candidates.length} ordem(ns) para o julgamento do 2.4.3`,
          )
        : '',
      say(loc, `next to the trigger: within ${ADJACENT_TABS} Tab presses`, `ao lado do gatilho: até ${ADJACENT_TABS} toques de Tab`),
      moreNotListed(loc, failures - findings.length),
    ].filter(Boolean)
    const viewport = asRecord(data.viewport)
    const status: ProbeCoverage['status'] = failures > 0 ? 'failures' : review.length > 0 ? 'needs-review' : read.applicable === 0 && found > 0 ? 'not-checked' : 'no-failure-found'
    return {
      findings,
      review,
      coverage: [
        {
          criterion: '2.4.3',
          method: `probe/focus-order@${record.version}`,
          rule: this.id,
          conditions: conditionsText(
            record,
            say(
              loc,
              `dialogs and menus opened from the keyboard, each on a fresh load at ${Number(viewport.width) || 0}×${Number(viewport.height) || 0}`,
              `diálogos e menus abertos pelo teclado, cada um numa carga nova em ${Number(viewport.width) || 0}×${Number(viewport.height) || 0}`,
            ),
          ),
          status,
          applicable: read.applicable,
          failures,
          review: review.length,
          unmatched: read.unmatched,
          note: notes.join('; '),
          maturity: 'experimental',
        },
      ],
    }
  },
}
