import type { Finding, ProbeCoverage } from '../core/types.ts'
import { describeField } from '../criteria/autofill.ts'
import { errorFields } from '../criteria/error-messages.ts'
import { shown, shownText } from '../criteria/labels-or-instructions.ts'
import type { Locale } from '../i18n.ts'
import { type AfterField, FORM_VERSION, type FormData, type FormField, type RedundantPair, type TrialResult } from '../probes/form.ts'
import { matchNode } from '../probes/identity.ts'
import type { A11yNode, ProbeRecord } from '../snapshot/schema.ts'
import { errorSuggestionRule, errorWithoutTextRule, suggestionHit, withoutTextHit } from './errors.ts'
import { type ProbeRule, type ProbeRuleContext, asArray, asRecord, conditionsText, probeFinding, say } from './probes.ts'
import type { Hit } from './types.ts'

export const ERROR_ON_LEAVE_RULE = 'rampa/error-on-leave'
export const SUGGESTION_ON_LEAVE_RULE = 'rampa/suggestion-on-leave'
export const REDUNDANT_ENTRY_RULE = 'rampa/redundant-entry'

export function formData(record: ProbeRecord): Partial<FormData> {
  return asRecord(record.data) as Partial<FormData>
}

const short = (text: string | undefined, n = 80) => {
  const value = (text ?? '').replace(/\s+/g, ' ').trim()
  return value.length > n ? `${value.slice(0, n - 1)}…` : value
}
const collapse = (text: string) => text.replace(/\s+/g, ' ').trim()

/** What the probe did to a field, in a few words: `typed "rampa" (type="email") and left it`. */
function didText(trial: TrialResult, locale: Locale): string {
  return trial.typed
    ? say(locale, `typed "${short(trial.typed, 30)}" (${trial.rule}) and left the field`, `digitou "${short(trial.typed, 30)}" (${trial.rule}) e saiu do campo`)
    : say(locale, `emptied the field (${trial.rule}) and left it`, `esvaziou o campo (${trial.rule}) e saiu dele`)
}

/** How a field reacted to the probe's invalid entries, as 3.3.1 and 3.3.3 read it on the page after each. */
export interface FieldReading {
  field: FormField
  node: A11yNode
  /** page: an error of the page's own showed (a message, aria-invalid, an error class); browser: only :user-invalid; nothing. */
  shown: 'page' | 'browser' | 'nothing'
  /** The trial whose page 3.3.1 read: the first one after which the page showed an error of its own. */
  trial?: TrialResult | undefined
  after?: AfterField | undefined
}

export interface FormReadings {
  readings: FieldReading[]
  /** Fields typed into whose facts do not match the snapshot. */
  unmatched: number
  /** Fields already in an error state on load: B8's rules read those. */
  onLoad: number
}

/**
 * The fields the probe typed into, with what the page showed. A message counts as the page's reaction when it was not
 * already on screen, with the same text, where the snapshot has it: a hint worded like an error that was always there
 * is not an error that appeared.
 */
export function formReadings(data: Partial<FormData>, ctx: Pick<ProbeRuleContext, 'index' | 'snapshot'>): FormReadings {
  const result: FormReadings = { readings: [], unmatched: 0, onLoad: 0 }
  const inError = new Set(errorFields(ctx.snapshot).map((field) => field.node.ref))
  for (const field of asArray<FormField>(data.fields)) {
    const results = asArray<TrialResult>(field?.results).filter((r) => !r.outcome)
    if (results.length === 0) continue
    const node = matchNode(ctx.index, field.ref, field.id)
    if (!node) {
      result.unmatched++
      continue
    }
    if (inError.has(node.ref)) {
      result.onLoad++
      continue
    }
    let reading: FieldReading = { field, node, shown: results.some((r) => r.userInvalid) ? 'browser' : 'nothing' }
    for (const trial of results) {
      const after = trial.after
      if (!after) continue
      const marked = after.state.includes('aria-invalid') || after.state.includes('class')
      if (marked || freshMessages(after, ctx.index).length > 0) {
        reading = { field, node, shown: 'page', trial, after }
        break
      }
    }
    result.readings.push(reading)
  }
  return result
}

/** Messages shown after the entry that the snapshot did not already show at the same place with the same text. */
function freshMessages(after: AfterField, index: ProbeRuleContext['index']): AfterField['messages'] {
  return asArray<AfterField['messages'][number]>(after.messages).filter((message) => {
    if (!message.shown) return false
    const before = index.get(message.ref)?.node
    return !(before && shown(before) && collapse(shownText(before)) === collapse(message.text))
  })
}

/** The facts the error rules of B8 read, with the browser's flags read by the probe when the collector recorded none. */
function factsOf(reading: FieldReading, trial: TrialResult, after: AfterField): AfterField {
  return { ...after, validity: after.validity.length > 0 ? after.validity : trial.validity, label: after.label || reading.field.label }
}

const SKIP_TEXT: Record<string, [string, string]> = {
  destructive: ['a destructive or account-changing name', 'um nome destrutivo ou que muda a conta'],
  'sensitive-form': ['in a form with password, payment or file fields', 'em formulário com senha, pagamento ou arquivo'],
  secret: ['a password or file field', 'campo de senha ou arquivo'],
  disabled: ['disabled', 'desabilitado'],
}

/** What the probe did on the page, for the coverage notes of 3.3.1 and 3.3.3. */
function fieldNotes(data: Partial<FormData>, readings: FormReadings, loc: Locale): string[] {
  const fields = asArray<FormField>(data.fields)
  const skipped = fields.filter((f) => f.skip)
  const notExercised = fields.filter((f) => asArray<TrialResult>(f.results).length > 0 && asArray<TrialResult>(f.results).every((r) => r.outcome && r.outcome !== 'not-tried'))
  const notTried = fields.filter((f) => asArray<TrialResult>(f.results).some((r) => r.outcome === 'not-tried')).length
  const count = (shown: FieldReading['shown']) => readings.readings.filter((r) => r.shown === shown).length
  const found = Number(data.found) || 0
  return [
    say(
      loc,
      `${found} text field(s) found, ${found - (Number(data.unconstrained) || 0)} with a constraint the probe can break; ${Number(data.tried) || 0} given an invalid value derived from it, then left`,
      `${found} campo(s) de texto encontrado(s), ${found - (Number(data.unconstrained) || 0)} com uma restrição que a sonda pode quebrar; ${Number(data.tried) || 0} recebeu(eram) um valor inválido derivado dela, e foi(foram) deixado(s)`,
    ),
    say(loc, `${count('page')} showed an error of the page's own`, `${count('page')} mostrou(aram) um erro da própria página`),
    count('browser') > 0
      ? say(loc, `${count('browser')} left to the browser's own validation, which names the error when the form is sent (never tried: nothing is submitted)`, `${count('browser')} deixado(s) à validação do navegador, que nomeia o erro quando o formulário é enviado (nunca tentado: nada é enviado)`)
      : '',
    count('nothing') > 0 ? say(loc, `${count('nothing')} showed nothing`, `${count('nothing')} não mostrou(aram) nada`) : '',
    readings.onLoad > 0 ? say(loc, `${readings.onLoad} already in an error state on load (the error state rules read those)`, `${readings.onLoad} já com erro ao carregar (as regras de estado de erro leem esses)`) : '',
    skipped.length > 0
      ? `${say(loc, `${skipped.length} skipped`, `${skipped.length} pulado(s)`)}: ${skipped
          .slice(0, 3)
          .map((f) => `<${f.tag}> "${short(f.label, 40)}" (${say(loc, ...(SKIP_TEXT[f.skip?.reason ?? ''] ?? [f.skip?.reason ?? '', f.skip?.reason ?? '']))})`)
          .join(', ')}${skipped.length > 3 ? ', …' : ''}`
      : '',
    notExercised.length > 0 ? say(loc, `${notExercised.length} not exercised (covered, hidden or took no focus)`, `${notExercised.length} não exercitado(s) (coberto, escondido ou sem foco)`) : '',
    notTried > 0 ? say(loc, `${notTried} not tried (${data.end === 'time' ? 'time budget' : 'budget'})`, `${notTried} não tentado(s) (${data.end === 'time' ? 'limite de tempo' : 'limite'})`) : '',
    say(loc, 'nothing was submitted; errors the server finds are not seen', 'nada foi enviado; erros que o servidor encontra não são vistos'),
  ].filter(Boolean)
}

function rowFor(criterion: string, rule: string, record: ProbeRecord, data: Partial<FormData>, loc: Locale, counts: { applicable: number; failures: number; review: number; unmatched: number }, notes: string[]): ProbeCoverage {
  const viewport = asRecord(data.viewport)
  const status: ProbeCoverage['status'] = counts.failures > 0 ? 'failures' : counts.review > 0 ? 'needs-review' : counts.applicable > 0 ? 'no-failure-found' : 'not-checked'
  return {
    criterion,
    method: `probe/form@${record.version}`,
    rule,
    conditions: conditionsText(
      record,
      say(
        loc,
        `invalid values typed into each field, then the field left, never submitted, at ${Number(viewport.width) || 0}×${Number(viewport.height) || 0}`,
        `valores inválidos digitados em cada campo, depois o campo deixado, nunca enviado, em ${Number(viewport.width) || 0}×${Number(viewport.height) || 0}`,
      ),
    ),
    status,
    ...counts,
    note: notes.join('; '),
    maturity: 'experimental',
  }
}

/**
 * 3.3.1 Error Identification, over the form probe: B8's decision (rampa/error-without-text) on the page after an
 * invalid entry was left: a field the page marked invalid (aria-invalid) with no message a person sees and assistive
 * technology reads fails; one marked only by an error class goes to review. A message that showed but is neither tied
 * to the field (aria-describedby, aria-errormessage, an error summary) nor announced (an alert, a status, a live
 * region) goes to review: people who cannot see it next to the field are not told. A field left to the browser's own
 * validation is not reported: the browser names the error when the form is sent.
 */
export const errorOnLeaveRule: ProbeRule = {
  id: ERROR_ON_LEAVE_RULE,
  kind: 'form',
  variant: 'form',
  versions: [FORM_VERSION],
  criteria: ['3.3.1'],
  run(record: ProbeRecord, ctx: ProbeRuleContext) {
    const data = formData(record)
    const loc = ctx.locale
    const readings = formReadings(data, ctx)
    const findings: Finding[] = []
    const review: Finding[] = []
    let applicable = 0
    for (const reading of readings.readings) {
      if (reading.shown !== 'page' || !reading.trial || !reading.after) continue
      applicable++
      const trial = reading.trial
      const facts = factsOf(reading, trial, reading.after)
      const did = didText(trial, loc)
      const hit = withoutTextHit(facts)
      if (hit) {
        const finding = probeFinding({
          criterion: '3.3.1',
          rule: this.id,
          node: reading.node,
          message: `${errorWithoutTextRule.message(hit, loc)} ${say(loc, `Seen after Rampa ${did}; nothing was submitted.`, `Visto depois que o Rampa ${did}; nada foi enviado.`)}`,
          evidence: `${did}; ${hit.evidence ?? ''}`,
          confidence: hit.outcome === 'fail' ? (hit.confidence ?? 'medium') : 'low',
          subject: `${trial.constraint}|${hit.subject}`,
        })
        ;(hit.outcome === 'fail' ? findings : review).push(finding)
        continue
      }
      const usable = facts.messages.filter((message) => message.shown && message.inTree)
      const tied = usable.some((message) => message.via !== 'near') || usable.some((message) => facts.announced.includes(message.ref))
      if (usable.length > 0 && !tied) {
        const message = usable[0]?.text ?? ''
        const label = facts.label ? `"${short(facts.label, 60)}"` : say(loc, 'this field', 'este campo')
        review.push(
          probeFinding({
            criterion: '3.3.1',
            rule: this.id,
            node: reading.node,
            message: say(
              loc,
              `The field ${label} showed the error "${short(message, 100)}" after Rampa ${did}, but the message is neither tied to the field (aria-describedby, aria-errormessage) nor announced (role="alert", a live region): a person on the field with a screen reader may never hear it (WCAG 3.3.1). Tie it with aria-describedby or aria-errormessage, and set aria-invalid="true" on the field.`,
              `O campo ${label} mostrou o erro "${short(message, 100)}" depois que o Rampa ${did}, mas a mensagem não está ligada ao campo (aria-describedby, aria-errormessage) nem é anunciada (role="alert", região viva): quem está no campo com leitor de tela pode nunca ouvi-la (WCAG 3.3.1). Ligue-a com aria-describedby ou aria-errormessage, e marque o campo com aria-invalid="true".`,
            ),
            evidence: `${did}; ${say(loc, 'message', 'mensagem')} "${short(message, 100)}" ${say(loc, 'next to the field, not tied, not announced', 'ao lado do campo, sem ligação, não anunciada')}${facts.state.length > 0 ? `; ${facts.state.join(', ')}` : say(loc, '; the field is not marked invalid', '; o campo não está marcado como inválido')}`,
            confidence: 'low',
            subject: `untied|${trial.constraint}`,
          }),
        )
      }
    }
    const notes = fieldNotes(data, readings, loc)
    return { findings, review, coverage: [rowFor('3.3.1', this.id, record, data, loc, { applicable, failures: findings.length, review: review.length, unmatched: readings.unmatched }, notes)] }
  },
}

/**
 * 3.3.3 Error Suggestion, over the form probe: B8's decision (rampa/error-suggestion) on the page after an invalid
 * entry was left: the page showed a message, the browser finds the field invalid against a constraint its markup
 * states (the one the probe broke), and neither the message, the label nor a hint states that constraint.
 */
export const suggestionOnLeaveRule: ProbeRule = {
  id: SUGGESTION_ON_LEAVE_RULE,
  kind: 'form',
  variant: 'form',
  versions: [FORM_VERSION],
  criteria: ['3.3.3'],
  run(record: ProbeRecord, ctx: ProbeRuleContext) {
    const data = formData(record)
    const loc = ctx.locale
    const readings = formReadings(data, ctx)
    const findings: Finding[] = []
    const review: Finding[] = []
    let applicable = 0
    for (const reading of readings.readings) {
      if (reading.shown !== 'page') continue
      // Each trial that broke a stated rule (not "required": saying a field is empty is 3.3.1's) and showed a message.
      for (const trial of asArray<TrialResult>(reading.field.results)) {
        if (trial.outcome || trial.constraint === 'required' || !trial.after) continue
        const facts = factsOf(reading, trial, trial.after)
        if (freshMessages(facts, ctx.index).length === 0) continue
        const decided = suggestionHit(facts, loc)
        if (!decided.applicable) continue
        applicable++
        const hit: Hit | undefined = decided.hit
        if (hit) {
          const did = didText(trial, loc)
          const finding = probeFinding({
            criterion: '3.3.3',
            rule: this.id,
            node: reading.node,
            message: `${errorSuggestionRule.message(hit, loc)} ${say(loc, `Seen after Rampa ${did}; nothing was submitted.`, `Visto depois que o Rampa ${did}; nada foi enviado.`)}`,
            evidence: `${did}; ${hit.evidence ?? ''}`,
            confidence: hit.outcome === 'fail' ? (hit.confidence ?? 'medium') : 'low',
            subject: `${trial.constraint}|${hit.subject}`,
          })
          ;(hit.outcome === 'fail' ? findings : review).push(finding)
        }
        break
      }
    }
    const notes = fieldNotes(data, readings, loc)
    return { findings, review, coverage: [rowFor('3.3.3', this.id, record, data, loc, { applicable, failures: findings.length, review: review.length, unmatched: readings.unmatched }, notes)] }
  },
}

/** How a pair reads for 3.3.7. */
export interface PairVerdict {
  pair: RedundantPair
  node: A11yNode
  result: 'failure' | 'review' | 'pass'
  why: 'reuse' | 'populated' | 'offered' | 'confirm' | 'later' | 'not-tried' | 'no-reuse'
}

/** 3.3.7's reading of the pairs the probe found and tried. */
export function pairVerdicts(data: Partial<FormData>, index: ProbeRuleContext['index']): { verdicts: PairVerdict[]; unmatched: number } {
  const verdicts: PairVerdict[] = []
  let unmatched = 0
  for (const pair of asArray<RedundantPair>(data.pairs)) {
    const node = matchNode(index, pair?.again?.ref, pair?.again?.id)
    if (!node || !matchNode(index, pair.first?.ref, pair.first?.id)) {
      unmatched++
      continue
    }
    const trial = pair.trial ?? {}
    const verdict = (result: PairVerdict['result'], why: PairVerdict['why']) => verdicts.push({ pair, node, result, why })
    if (asArray(pair.reuse).length > 0) verdict('pass', 'reuse')
    else if (trial.populated) verdict('pass', 'populated')
    else if (trial.offered) verdict('pass', 'offered')
    else if (pair.confirm) verdict('review', 'confirm')
    else if (trial.outcome === 'hidden') verdict('review', 'later')
    else if (trial.outcome || trial.populated === undefined) verdict('review', 'not-tried')
    else verdict(pair.address ? 'failure' : 'review', 'no-reuse')
  }
  return { verdicts, unmatched }
}

function entryText(entry: RedundantPair['first'], loc: Locale): string {
  const group = entry.group && !collapse(entry.label).toLowerCase().includes(collapse(entry.group).toLowerCase()) ? ` (${short(entry.group, 40)})` : ''
  return `"${short(entry.label, 50) || entry.tag}"${group}`
}

function askedFor(pair: RedundantPair, loc: Locale): string {
  const purpose = pair.basis === 'autocomplete' ? pair.first.purpose?.split(' ').at(-1) : undefined
  const described = purpose ? describeField(purpose, loc) : undefined
  return described ?? `"${short(pair.first.label, 40)}"`
}

/**
 * 3.3.7 Redundant Entry, over the form probe, on one page: two fields of one form that ask for the same thing, the
 * second later in the flow. When a control offers to reuse the entry ("Same as billing address"), the probe typed into
 * the first and the second was filled in, or the second offered the value, nothing is reported. Billing and shipping
 * (by their autocomplete tokens or the names of their groups) that do none of that fail; other pairs go to review: a
 * field that asks to confirm an entry may be the security or essential exception, and the same label may ask about
 * another person. A second field in a step that does not show yet goes to review.
 */
export const redundantEntryRule: ProbeRule = {
  id: REDUNDANT_ENTRY_RULE,
  kind: 'form',
  variant: 'form',
  versions: [FORM_VERSION],
  criteria: ['3.3.7'],
  run(record: ProbeRecord, ctx: ProbeRuleContext) {
    const data = formData(record)
    const loc = ctx.locale
    const { verdicts, unmatched } = pairVerdicts(data, ctx.index)
    const findings: Finding[] = []
    const review: Finding[] = []
    for (const verdict of verdicts) {
      if (verdict.result === 'pass') continue
      const { pair } = verdict
      const what = askedFor(pair, loc)
      const both = say(loc, `${entryText(pair.first, loc)} and again ${entryText(pair.again, loc)}`, `${entryText(pair.first, loc)} e de novo ${entryText(pair.again, loc)}`)
      const tokens = pair.basis === 'autocomplete' ? ` (autocomplete="${pair.first.token}", "${pair.again.token}")` : ''
      const typed = pair.trial?.typed ? say(loc, `typed "${pair.trial.typed}" into the first and left it: the second was not filled in and offered nothing`, `digitou "${pair.trial.typed}" no primeiro e saiu: o segundo não foi preenchido e não ofereceu nada`) : ''
      const evidence = [`${both}${tokens}`, typed, say(loc, 'no control in the form offers to reuse the entry', 'nenhum controle no formulário oferece reaproveitar a entrada')].filter(Boolean).join('; ')
      let message: string
      if (verdict.why === 'no-reuse' && verdict.result === 'failure') {
        message = say(
          loc,
          `The form asks for ${what} twice, ${both}, and the second is neither filled in from the first nor offered to select, and no control offers to reuse it ("Same as billing address"): people must enter it again (WCAG 3.3.7). Fill it in from the first entry, offer it to select, or add a checkbox to reuse it.`,
          `O formulário pede ${what} duas vezes, ${both}, e o segundo não é preenchido a partir do primeiro nem oferecido para escolher, e nenhum controle oferece reaproveitá-lo ("Igual ao endereço de cobrança"): a pessoa precisa digitar de novo (WCAG 3.3.7). Preencha a partir da primeira entrada, ofereça para escolher, ou adicione uma caixa para reaproveitar.`,
        )
      } else {
        const why =
          verdict.why === 'confirm'
            ? say(loc, 'The second asks to confirm the entry, which the criterion allows when it is essential or needed for security; otherwise it must be filled in or offered.', 'O segundo pede para confirmar a entrada, o que o critério permite quando é essencial ou necessário para a segurança; fora isso, deve ser preenchido ou oferecido.')
            : verdict.why === 'later'
              ? say(loc, 'The second is in a part of the form that does not show yet (a later step), which the probe does not reach: check that it is filled in or offered there.', 'O segundo está numa parte do formulário que ainda não aparece (um passo seguinte), que a sonda não alcança: confira se ele é preenchido ou oferecido lá.')
              : verdict.why === 'not-tried'
                ? say(loc, `The probe did not type into them (${pair.trial?.reason ?? pair.trial?.outcome ?? 'not tried'}): check that the second is filled in or offered.`, `A sonda não digitou neles (${pair.trial?.reason ?? pair.trial?.outcome ?? 'não tentado'}): confira se o segundo é preenchido ou oferecido.`)
                : say(loc, 'Whether they ask for the same information (and not, say, about another person) needs a person; if they do, the second must be filled in or offered.', 'Se eles pedem a mesma informação (e não, por exemplo, de outra pessoa) precisa de uma pessoa; se pedirem, o segundo deve ser preenchido ou oferecido.')
        message = say(loc, `The form may ask for ${what} twice, ${both}, with no control to reuse the entry. ${why} (WCAG 3.3.7)`, `O formulário pode pedir ${what} duas vezes, ${both}, sem controle para reaproveitar a entrada. ${why} (WCAG 3.3.7)`)
      }
      const finding = probeFinding({
        criterion: '3.3.7',
        rule: this.id,
        node: verdict.node,
        message,
        evidence,
        confidence: verdict.result === 'failure' ? 'medium' : 'low',
        subject: `${pair.basis}|${pair.first.purpose ?? collapse(pair.first.label).toLowerCase()}|${verdict.why}`,
      })
      ;(verdict.result === 'failure' ? findings : review).push(finding)
    }
    const passed = verdicts.filter((v) => v.result === 'pass')
    const notes = [
      say(loc, `${verdicts.length} pair(s) of fields that ask for the same thing in one form`, `${verdicts.length} par(es) de campos que pedem a mesma coisa num formulário`),
      passed.length > 0
        ? `${say(loc, 'no failure', 'sem falha')}: ${passed
            .slice(0, 3)
            .map((v) =>
              v.why === 'reuse'
                ? say(loc, `"${short(v.pair.reuse[0]?.label, 50)}" offers to reuse ${entryText(v.pair.first, loc)}${v.pair.trial?.toggled ? ` (${v.pair.trial.toggled.effect})` : ''}`, `"${short(v.pair.reuse[0]?.label, 50)}" oferece reaproveitar ${entryText(v.pair.first, loc)}${v.pair.trial?.toggled ? ` (${v.pair.trial.toggled.effect})` : ''}`)
                : v.why === 'populated'
                  ? say(loc, `${entryText(v.pair.again, loc)} is filled in from the first`, `${entryText(v.pair.again, loc)} é preenchido a partir do primeiro`)
                  : say(loc, `${entryText(v.pair.again, loc)} offers the first entry`, `${entryText(v.pair.again, loc)} oferece a primeira entrada`),
            )
            .join(', ')}`
        : '',
      say(loc, 'steps on other pages are not seen; nothing was submitted', 'passos em outras páginas não são vistos; nada foi enviado'),
    ].filter(Boolean)
    const viewport = asRecord(data.viewport)
    // No pair on the page: nothing here asks twice, which the note bounds to this page (no-applicable-content in the per-criterion coverage).
    const status: ProbeCoverage['status'] = findings.length > 0 ? 'failures' : review.length > 0 ? 'needs-review' : 'no-failure-found'
    const coverage: ProbeCoverage = {
      criterion: '3.3.7',
      method: `probe/form@${record.version}`,
      rule: this.id,
      conditions: conditionsText(
        record,
        say(loc, `fields of one form that ask twice, on one page at ${Number(viewport.width) || 0}×${Number(viewport.height) || 0}`, `campos de um formulário que pedem duas vezes, numa página em ${Number(viewport.width) || 0}×${Number(viewport.height) || 0}`),
      ),
      status,
      applicable: verdicts.length,
      failures: findings.length,
      review: review.length,
      unmatched,
      note: verdicts.length === 0 ? say(loc, 'no field asks again for what another field of its form asked; steps on other pages are not seen', 'nenhum campo pede de novo o que outro campo do formulário pediu; passos em outras páginas não são vistos') : notes.join('; '),
      maturity: 'experimental',
    }
    return { findings, review, coverage: [coverage] }
  },
}

export const FORM_RULES: readonly ProbeRule[] = [errorOnLeaveRule, suggestionOnLeaveRule, redundantEntryRule]
