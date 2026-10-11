import type { Confidence, Finding, ProbeCoverage } from '../core/types.ts'
import type { Locale } from '../i18n.ts'
import { matchNode } from '../probes/identity.ts'
import { TIME_LIMITS_VARIANT, TIME_LIMITS_VERSION, TWENTY_HOURS_MS, type TimeData, type TimeEvent, type TimeExtension, type TimeWarning } from '../probes/time-limits.ts'
import type { A11yNode, A11ySnapshot, ProbeRecord } from '../snapshot/schema.ts'
import type { TreeIndex } from '../snapshot/tree.ts'
import { type ProbeRule, type ProbeRuleContext, asArray, asRecord, conditionsText, probeFinding, say } from './probes.ts'

/**
 * 2.2.1 Timing Adjustable, from the time-limit probe's facts (probes/time-limits.ts). With nobody touching the page
 * and its time jumped up to 20 hours, a navigation, a reload, a form submitted or most of the text replaced is a time
 * limit the content sets. It fails when no warning came before it, when the warning gave no way to extend the time,
 * when the warning's control did not extend it, or when the warning came less than 20 seconds before. A consequence
 * after a refused request (the page may have needed it), seen on one load only, or a warning whose control the probe
 * could not press, goes to review; so does text that went away by itself and never came back. A meta refresh is
 * axe-core's; the HTTP Refresh header, rampa/refresh-header's. Exceptions (real-time events, essential limits, more
 * than 20 hours) are the model's to clear, by quoting the page (criteria/timing-adjustable.ts), never to create.
 */

export const TIMING_ADJUSTABLE_RULE = 'rampa/timing-adjustable'
/** WCAG 2.2.1, "extend": the user is warned before time expires and given at least 20 seconds. */
export const WARNING_LEAD_MS = 20_000

export function timeRecord(records: readonly ProbeRecord[] | undefined): ProbeRecord | undefined {
  return records?.find((r) => r.kind === 'motion' && r.conditions.variant === TIME_LIMITS_VARIANT && r.version === TIME_LIMITS_VERSION && r.status !== 'skipped')
}

export function timeData(record: ProbeRecord): TimeData {
  const data = asRecord(record.data) as Partial<TimeData>
  const number = (value: unknown) => Number(value) || 0
  const requests = asRecord(data.requests)
  const refine = data.refine && typeof data.refine === 'object' ? data.refine : undefined
  const extension = data.extension && typeof data.extension === 'object' && data.extension.control ? data.extension : undefined
  return {
    viewport: { width: number(asRecord(data.viewport).width), height: number(asRecord(data.viewport).height) },
    checkpoints: asArray<number>(data.checkpoints).filter((n) => typeof n === 'number'),
    reachedMs: number(data.reachedMs),
    ...(typeof data.meta === 'string' ? { meta: data.meta } : {}),
    events: asArray<TimeEvent>(data.events).filter((e) => e && typeof e.kind === 'string' && typeof e.at === 'number'),
    warnings: asArray<TimeWarning>(data.warnings).filter((w) => w && typeof w.kind === 'string' && typeof w.at === 'number').map((w) => ({ ...w, controls: asArray(w.controls) })),
    ...(refine ? { refine } : {}),
    ...(extension ? { extension } : {}),
    countdowns: asArray<string>(data.countdowns).filter((t) => typeof t === 'string'),
    notices: asArray<string>(data.notices).filter((t) => typeof t === 'string'),
    requests: { allowed: number(requests.allowed), blocked: number(requests.blocked) },
    loads: number(data.loads),
    actions: asArray(data.actions),
    end: data.end === 'time' ? 'time' : 'complete',
  }
}

export type TimeWhy = 'no-warning' | 'no-extension' | 'not-extended' | 'short-warning' | 'blocked' | 'once' | 'untried' | 'dialog' | 'removed' | 'address' | 'warning-only'

export interface TimeVerdict {
  node: A11yNode
  result: 'failure' | 'review'
  why: TimeWhy
  confidence: Confidence
  event?: TimeEvent | undefined
  warning?: TimeWarning | undefined
  extension?: TimeExtension | undefined
  /** When the consequence came, and the warning before it, as precisely as the probe timed them. */
  eventAt?: number | undefined
  warningAt?: number | undefined
}

export interface TimeVerdicts {
  verdicts: TimeVerdict[]
  /** The time limit the page enforced, when the warning's control extended it (no failure), with the times. */
  extended?: { warningAt: number; eventAt: number; extension: TimeExtension } | undefined
  /** The consequence, when one came: a navigation, reload, submission or text replaced. */
  limit?: TimeEvent | undefined
  /** What was left to another rule: a meta refresh (axe-core), the Refresh header (rampa/refresh-header). */
  leftTo: string[]
  unmatched: number
}

const TERMINAL = new Set<TimeEvent['kind']>(['navigation', 'reload', 'submit', 'content'])

/** 2.2.1's reading of the time-limit probe's facts; the rule and the judgment read the same. */
export function timeVerdicts(data: TimeData, snapshot: A11ySnapshot, index: TreeIndex): TimeVerdicts {
  const out: TimeVerdicts = { verdicts: [], leftTo: [], unmatched: 0 }
  const body = index.get('html > body')?.node ?? snapshot.root
  const header = typeof snapshot.root.native.httpRefresh === 'string' && snapshot.root.native.httpRefresh.trim() !== ''
  if (data.events.some((e) => e.kind === 'meta')) out.leftTo.push('meta-refresh')
  const limit = data.events.find((e) => TERMINAL.has(e.kind) && e.at <= TWENTY_HOURS_MS && !(e.kind === 'reload' && header))
  if (data.events.some((e) => e.kind === 'reload' && header)) out.leftTo.push('rampa/refresh-header')
  const refine = data.refine
  const warnings = data.warnings.filter((w) => w.kind !== 'text')
  if (limit) {
    out.limit = limit
    const eventAt = refine?.eventAt ?? limit.at
    const warning = (refine?.warningAt !== undefined ? warnings.find((w) => w.at === refine.warningAt) : undefined) ?? warnings.find((w) => w.at <= limit.at)
    const warningAt = refine?.warningAt ?? warning?.at
    const extension = data.extension
    const verdict = (result: TimeVerdict['result'], why: TimeWhy, confidence: Confidence): TimeVerdict => ({
      node: body,
      result,
      why,
      confidence,
      event: limit,
      ...(warning ? { warning } : {}),
      ...(extension ? { extension } : {}),
      eventAt,
      ...(warningAt !== undefined ? { warningAt } : {}),
    })
    if (limit.blocked > 0) out.verdicts.push(verdict('review', 'blocked', 'low'))
    else if (!refine?.confirmed) out.verdicts.push(verdict('review', 'once', 'low'))
    else if (!warning) out.verdicts.push(verdict('failure', 'no-warning', 'high'))
    else if (warning.kind === 'dialog') out.verdicts.push(verdict('review', 'dialog', 'low'))
    else if (!extension) out.verdicts.push(verdict('failure', warning.controls.some((c) => c.extend) ? 'untried' : 'no-extension', warning.controls.some((c) => c.extend) ? 'low' : 'high'))
    else if (extension.outcome === 'extended') {
      if (warningAt !== undefined && eventAt - warningAt < WARNING_LEAD_MS) out.verdicts.push(verdict('failure', 'short-warning', 'medium'))
      else out.extended = { warningAt: warningAt ?? warning.at, eventAt, extension }
    } else if (extension.outcome === 'not-extended') {
      // A press that was blocked from the network may not have reached the server; a control named for something
      // else ("OK") that did not extend means the warning offers no way to.
      if (extension.blocked > 0) out.verdicts.push(verdict('review', 'blocked', 'low'))
      else if (extension.control.extend === false) out.verdicts.push(verdict('failure', 'no-extension', 'high'))
      else out.verdicts.push(verdict('failure', 'not-extended', 'medium'))
    } else out.verdicts.push(verdict('review', 'untried', 'low'))
    // A failure for want of a control the probe could not press is never one: it may work.
    for (const v of out.verdicts) if (v.why === 'untried') v.result = 'review'
  } else {
    // A warning and nothing after it, in up to 20 hours of the page's time (or 30 minutes after it on the second load).
    const warning = warnings[0]
    if (warning) out.verdicts.push({ node: body, result: 'review', why: 'warning-only', confidence: 'low', warning })
    const address = data.events.find((e) => e.kind === 'address')
    if (address) out.verdicts.push({ node: body, result: 'review', why: 'address', confidence: 'low', event: address, eventAt: address.at })
  }
  // Text that went away by itself and never came back (a message that disappears), before any consequence that took
  // the rest of the page with it.
  for (const removed of data.events.filter((e) => e.kind === 'removed' && (!limit || e.at < limit.at)).slice(0, 5)) {
    const node = removed.el ? matchNode(index, removed.el.ref, removed.el.id) : undefined
    if (removed.el && !node) {
      out.unmatched++
      continue
    }
    out.verdicts.push({ node: node ?? body, result: 'review', why: 'removed', confidence: 'low', event: removed, eventAt: removed.at })
  }
  return out
}

/** "45 s", "30 min", "2 h 30 min": the same in both languages. */
export function duration(ms: number, _locale?: Locale): string {
  const s = Math.round(ms / 1000)
  if (s < 120) return `${s} s`
  const m = Math.round(s / 60)
  if (m < 120) return `${m} min`
  const h = Math.floor(m / 60)
  const rest = m % 60
  return rest === 0 ? `${h} h` : `${h} h ${rest} min`
}

const cut = (text: string | undefined, n = 120) => {
  const value = (text ?? '').replace(/\s+/g, ' ').trim()
  return value.length > n ? `${value.slice(0, n - 1)}…` : value
}

/** What the consequence was, in a few words. */
export function eventText(event: TimeEvent, locale: Locale): string {
  switch (event.kind) {
    case 'navigation':
      return say(locale, `goes to ${cut(event.url, 100)}`, `vai para ${cut(event.url, 100)}`)
    case 'reload':
      return say(locale, 'reloads itself', 'recarrega a si mesma')
    case 'submit':
      return say(locale, `submits a form${event.url ? ` to ${cut(event.url, 100)}` : ''}`, `envia um formulário${event.url ? ` para ${cut(event.url, 100)}` : ''}`)
    case 'content':
      return say(locale, `replaces most of its text (${event.text ?? ''})`, `troca a maior parte do texto (${(event.text ?? '').replace('of the text replaced', 'do texto trocado')})`)
    case 'address':
      return say(locale, `changes its address to ${cut(event.url, 100)} in place`, `muda o endereço para ${cut(event.url, 100)} sem carregar`)
    case 'removed':
      return say(locale, `removes "${cut(event.text, 80)}"`, `remove "${cut(event.text, 80)}"`)
    case 'window':
      return say(locale, `opens a window (${cut(event.url, 100)})`, `abre uma janela (${cut(event.url, 100)})`)
    case 'meta':
      return say(locale, 'refreshes by its meta element', 'atualiza pelo seu elemento meta')
  }
}

const SCR = 'SCR16, SCR1'

export function timeMessage(verdict: TimeVerdict, locale: Locale): string {
  const when = verdict.eventAt !== undefined ? duration(verdict.eventAt, locale) : ''
  const event = verdict.event ? eventText(verdict.event, locale) : ''
  const control = verdict.extension ? `"${cut(verdict.extension.control.name, 40)}"` : ''
  const lead = verdict.warningAt !== undefined && verdict.eventAt !== undefined ? duration(Math.max(0, verdict.eventAt - verdict.warningAt), locale) : ''
  const exception = say(
    locale,
    'If the time limit is part of a real-time event or essential to the activity, or longer than 20 hours, the criterion is met: the 2.2.1 judgment clears this finding when it can quote the page saying so, or waive it (rampa waive).',
    'Se o limite de tempo faz parte de um evento em tempo real ou é essencial à atividade, ou passa de 20 horas, o critério está atendido: o julgamento do 2.2.1 retira este achado quando consegue citar a página dizendo isso, ou dispense-o (rampa waive).',
  )
  switch (verdict.why) {
    case 'no-warning':
      return say(
        locale,
        `After ${when} with no input, the page ${event}, and nothing warned of it before: a time limit people cannot turn off, adjust or extend (WCAG 2.2.1). Warn before the time runs out and let people ask for more time with one action (${SCR}), or let them turn the limit off. ${exception}`,
        `Depois de ${when} sem entrada, a página ${event}, e nada avisou antes: um limite de tempo que a pessoa não pode desligar, ajustar nem estender (WCAG 2.2.1). Avise antes de o tempo acabar e deixe a pessoa pedir mais tempo com uma ação (${SCR}), ou deixe-a desligar o limite. ${exception}`,
      )
    case 'no-extension': {
      const pressed = verdict.extension?.outcome === 'not-extended' ? verdict.extension.control.name : undefined
      return say(
        locale,
        `After ${when} with no input, the page ${event}. A warning showed ${lead} before ("${cut(verdict.warning?.text, 100)}"), with no control to ask for more time${pressed ? ` (its "${cut(pressed, 30)}", pressed on a fresh load, did not extend it)` : ''} (WCAG 2.2.1). Add one, such as "Stay signed in", that extends the time with one action (${SCR}). ${exception}`,
        `Depois de ${when} sem entrada, a página ${event}. Um aviso apareceu ${lead} antes ("${cut(verdict.warning?.text, 100)}"), sem controle para pedir mais tempo${pressed ? ` (seu "${cut(pressed, 30)}", pressionado numa carga nova, não o estendeu)` : ''} (WCAG 2.2.1). Adicione um, como "Continuar conectado", que estenda o tempo com uma ação (${SCR}). ${exception}`,
      )
    }
    case 'not-extended':
      return say(
        locale,
        `After ${when} with no input, the page ${event}. Its warning's ${control} was pressed on a fresh load, and the page still did so at ${duration(verdict.extension?.eventAt ?? 0, locale)} (WCAG 2.2.1). Make the control extend the time limit (${SCR}). ${exception}`,
        `Depois de ${when} sem entrada, a página ${event}. O ${control} do aviso foi pressionado numa carga nova, e a página fez isso mesmo assim em ${duration(verdict.extension?.eventAt ?? 0, locale)} (WCAG 2.2.1). Faça o controle estender o limite de tempo (${SCR}). ${exception}`,
      )
    case 'short-warning':
      return say(
        locale,
        `After ${when} with no input, the page ${event}; its warning came only ${lead} before, and WCAG 2.2.1 asks for at least 20 seconds to ask for more time. Warn earlier (${SCR}). ${exception}`,
        `Depois de ${when} sem entrada, a página ${event}; o aviso veio só ${lead} antes, e a WCAG 2.2.1 pede pelo menos 20 segundos para pedir mais tempo. Avise antes (${SCR}). ${exception}`,
      )
    case 'blocked':
      return say(
        locale,
        `After ${when} with no input, the page ${event}, right after a request the probe refused (the network guard, or its budget of requests while time jumps). The page may have needed it: check by hand whether this time limit can be turned off, adjusted or extended (WCAG 2.2.1).`,
        `Depois de ${when} sem entrada, a página ${event}, logo depois de uma requisição que a sonda recusou (o guarda de rede, ou seu limite de requisições enquanto o tempo salta). A página pode ter precisado dela: verifique à mão se esse limite de tempo pode ser desligado, ajustado ou estendido (WCAG 2.2.1).`,
      )
    case 'once':
      return say(
        locale,
        `After ${when} with no input, the page ${event}, on one load but not again on a second one. Check by hand whether the page sets a time limit (WCAG 2.2.1).`,
        `Depois de ${when} sem entrada, a página ${event}, numa carga mas não de novo numa segunda. Verifique à mão se a página impõe um limite de tempo (WCAG 2.2.1).`,
      )
    case 'untried':
      return say(
        locale,
        `After ${when} with no input, the page ${event}. A warning showed before it with ${verdict.warning?.controls.filter((c) => c.extend).map((c) => `"${cut(c.name, 40)}"`).join(', ') || 'a control'}, which Rampa did not press${verdict.extension?.reason ? ` (${verdict.extension.reason})` : verdict.extension?.outcome === 'navigated' ? say(locale, ' (pressing it started a navigation)', '') : ''}. Check by hand that it extends the time (WCAG 2.2.1).`,
        `Depois de ${when} sem entrada, a página ${event}. Um aviso apareceu antes com ${verdict.warning?.controls.filter((c) => c.extend).map((c) => `"${cut(c.name, 40)}"`).join(', ') || 'um controle'}, que o Rampa não pressionou${verdict.extension?.reason ? ` (${verdict.extension.reason})` : verdict.extension?.outcome === 'navigated' ? ' (pressioná-lo iniciou uma navegação)' : ''}. Verifique à mão que ele estende o tempo (WCAG 2.2.1).`,
      )
    case 'dialog':
      return say(
        locale,
        `After ${when} with no input, the page ${event}, after a browser dialog ("${cut(verdict.warning?.text, 100)}"), which Rampa answers with Cancel. Check by hand that accepting it extends the time (WCAG 2.2.1).`,
        `Depois de ${when} sem entrada, a página ${event}, depois de um diálogo do navegador ("${cut(verdict.warning?.text, 100)}"), que o Rampa responde com Cancelar. Verifique à mão que aceitá-lo estende o tempo (WCAG 2.2.1).`,
      )
    case 'warning-only':
      return say(
        locale,
        `A warning about time showed after ${duration(verdict.warning?.at ?? 0, locale)} with no input ("${cut(verdict.warning?.text, 100)}"), and nothing followed in the time the probe watched. Check by hand whether a time limit applies, perhaps on the server (WCAG 2.2.1).`,
        `Um aviso sobre tempo apareceu depois de ${duration(verdict.warning?.at ?? 0, locale)} sem entrada ("${cut(verdict.warning?.text, 100)}"), e nada veio depois no tempo que a sonda observou. Verifique à mão se há limite de tempo, talvez no servidor (WCAG 2.2.1).`,
      )
    case 'address':
      return say(
        locale,
        `After ${when} with no input, the page ${event}. Check by hand whether that ends what the person was doing (WCAG 2.2.1).`,
        `Depois de ${when} sem entrada, a página ${event}. Verifique à mão se isso encerra o que a pessoa fazia (WCAG 2.2.1).`,
      )
    case 'removed':
      return say(
        locale,
        `This text went away by itself after ${when} with no input, and did not come back: "${cut(verdict.event?.text, 100)}". If people need it, that is a time limit on reading it (WCAG 2.2.1): keep it until they dismiss it, or let them ask for more time.`,
        `Este texto sumiu sozinho depois de ${when} sem entrada, e não voltou: "${cut(verdict.event?.text, 100)}". Se a pessoa precisa dele, isso é um limite de tempo para lê-lo (WCAG 2.2.1): mantenha-o até ela fechá-lo, ou deixe-a pedir mais tempo.`,
      )
  }
}

function evidenceOf(verdict: TimeVerdict, data: TimeData, locale: Locale): string {
  const parts: string[] = []
  const e = verdict.event
  if (e) parts.push(say(locale, `between ${duration(e.from, locale)} and ${duration(e.at, locale)} of the page's time with no input, it ${eventText(e, locale)}`, `entre ${duration(e.from, locale)} e ${duration(e.at, locale)} do tempo da página sem entrada, ela ${eventText(e, locale)}`))
  if (data.refine && e && e.kind !== 'removed') {
    parts.push(
      data.refine.confirmed
        ? say(locale, `again on a second fresh load, at ${duration(data.refine.eventAt ?? 0, locale)} (checked every ${duration(data.refine.stepMs, locale)})`, `de novo numa segunda carga nova, em ${duration(data.refine.eventAt ?? 0, locale)} (verificado a cada ${duration(data.refine.stepMs, locale)})`)
        : say(locale, 'not again on a second fresh load', 'não de novo numa segunda carga nova'),
    )
  }
  if (verdict.warning) parts.push(say(locale, `warning (${verdict.warning.kind}) at ${duration(verdict.warningAt ?? verdict.warning.at, locale)}: "${cut(verdict.warning.text, 160)}"`, `aviso (${verdict.warning.kind}) em ${duration(verdict.warningAt ?? verdict.warning.at, locale)}: "${cut(verdict.warning.text, 160)}"`))
  if (verdict.warning && verdict.warning.controls.length > 0) parts.push(say(locale, `its controls: ${verdict.warning.controls.map((c) => `"${cut(c.name, 30)}"`).join(', ')}`, `seus controles: ${verdict.warning.controls.map((c) => `"${cut(c.name, 30)}"`).join(', ')}`))
  const x = verdict.extension
  if (x && x.outcome === 'not-extended') parts.push(say(locale, `"${cut(x.control.name, 30)}" pressed at ${duration(x.pressedAt ?? 0, locale)}; it still came at ${duration(x.eventAt ?? 0, locale)}`, `"${cut(x.control.name, 30)}" pressionado em ${duration(x.pressedAt ?? 0, locale)}; veio mesmo assim em ${duration(x.eventAt ?? 0, locale)}`))
  if (e && e.blocked > 0) parts.push(say(locale, `${e.blocked} request(s) refused just before`, `${e.blocked} requisição(ões) recusada(s) logo antes`))
  if (data.countdowns.length > 0 && e?.kind !== 'removed') parts.push(say(locale, `on load: ${data.countdowns.slice(0, 3).map((t) => `"${cut(t, 60)}"`).join(', ')}`, `ao carregar: ${data.countdowns.slice(0, 3).map((t) => `"${cut(t, 60)}"`).join(', ')}`))
  return parts.join('; ')
}

export const timingAdjustableRule: ProbeRule = {
  id: TIMING_ADJUSTABLE_RULE,
  kind: 'motion',
  variant: TIME_LIMITS_VARIANT,
  versions: [TIME_LIMITS_VERSION],
  criteria: ['2.2.1'],
  act: ['bc659a'],
  undecidedReview: true,
  run(record: ProbeRecord, ctx: ProbeRuleContext) {
    const data = timeData(record)
    const loc = ctx.locale
    const result = timeVerdicts(data, ctx.snapshot, ctx.index)
    const findings: Finding[] = []
    const review: Finding[] = []
    for (const verdict of result.verdicts) {
      const finding = probeFinding({
        criterion: '2.2.1',
        rule: TIMING_ADJUSTABLE_RULE,
        node: verdict.node,
        message: timeMessage(verdict, loc),
        evidence: evidenceOf(verdict, data, loc),
        confidence: verdict.confidence,
        subject: `${verdict.why}|${verdict.event?.kind ?? verdict.warning?.kind ?? ''}|${verdict.event?.kind === 'removed' ? cut(verdict.event.text, 60) : (verdict.event?.url ?? '').replace(/[?#].*$/, '')}`,
      })
      ;(verdict.result === 'failure' ? findings : review).push(finding)
    }
    const reached = data.reachedMs >= TWENTY_HOURS_MS ? '20 h' : duration(data.reachedMs, loc)
    const notes = [
      result.limit
        ? say(loc, `with no input, the page ${eventText(result.limit, loc)} after ${duration(data.refine?.eventAt ?? result.limit.at, loc)}`, `sem entrada, a página ${eventText(result.limit, loc)} depois de ${duration(data.refine?.eventAt ?? result.limit.at, loc)}`)
        : say(loc, `no time limit seen with no input up to ${reached} of the page's time`, `nenhum limite de tempo visto sem entrada até ${reached} do tempo da página`),
      result.extended
        ? say(
            loc,
            `a warning came ${duration(result.extended.eventAt - result.extended.warningAt, loc)} before it, and its "${cut(result.extended.extension.control.name, 40)}" extended the time once (WCAG asks for at least ten extensions; one was tried)`,
            `um aviso veio ${duration(result.extended.eventAt - result.extended.warningAt, loc)} antes, e seu "${cut(result.extended.extension.control.name, 40)}" estendeu o tempo uma vez (a WCAG pede ao menos dez extensões; uma foi testada)`,
          )
        : '',
      result.leftTo.includes('meta-refresh') ? say(loc, 'a meta refresh is axe-core’s (meta-refresh)', 'um meta refresh fica com o axe-core (meta-refresh)') : '',
      result.leftTo.includes('rampa/refresh-header') ? say(loc, 'the Refresh header is rampa/refresh-header’s', 'o cabeçalho Refresh fica com rampa/refresh-header') : '',
      data.requests.blocked > 0 ? say(loc, `${data.requests.blocked} request(s) refused past the probe's budget of 40 while time jumped`, `${data.requests.blocked} requisição(ões) recusada(s) além do limite de 40 da sonda enquanto o tempo saltava`) : '',
      data.end === 'time' ? say(loc, 'the time budget ran out', 'o tempo acabou') : '',
      say(loc, 'time limits on the server, after an interaction or behind a sign-in are not seen', 'limites de tempo no servidor, depois de uma interação ou atrás de login não são vistos'),
    ].filter(Boolean)
    const applicable = result.limit || result.verdicts.length > 0 ? Math.max(1, result.verdicts.length) : 0
    const coverage: ProbeCoverage = {
      criterion: '2.2.1',
      method: `probe/motion@${record.version}`,
      rule: TIMING_ADJUSTABLE_RULE,
      conditions: conditionsText(record, say(loc, `the page's time jumped with no input up to 20 h at ${data.viewport.width}×${data.viewport.height}; a warning's control to extend pressed`, `o tempo da página saltou sem entrada até 20 h em ${data.viewport.width}×${data.viewport.height}; o controle de estender de um aviso pressionado`)),
      status: findings.length > 0 ? 'failures' : review.length > 0 ? 'needs-review' : 'no-failure-found',
      applicable,
      failures: findings.length,
      review: review.length,
      unmatched: result.unmatched,
      note: notes.join('; '),
      maturity: 'experimental',
    }
    return { findings, review, coverage: [coverage] }
  },
}
