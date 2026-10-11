import type { Finding, ProbeCoverage, Report } from '../core/types.ts'
import { describeField } from '../criteria/autofill.ts'
import type { Locale } from '../i18n.ts'
import { CONFIRM_WORDS, NOT_REDUNDANT } from '../probes/form.ts'
import { matchNode } from '../probes/identity.ts'
import { SUBMIT_VERSION, type StepControl, type SubmitData, type SubmitFlow, type SubmitStep, type Submission, type SubmittedField } from '../probes/submit.ts'
import type { A11yNode, A11ySnapshot, ProbeRecord } from '../snapshot/schema.ts'
import { errorSuggestionRule, errorWithoutTextRule, suggestionHit, withoutTextHit } from './errors.ts'
import { type ProbeRule, type ProbeRuleContext, asArray, asRecord, conditionsText, probeFinding, say } from './probes.ts'
import { CONFIRM_BOX, REVERSAL_TEXT, REVIEW_TEXT, commitmentOf, fold } from './scope.ts'

/**
 * Rules over the form probe's submissions (D5; `--allow-submit`, docs/probes.md, "Submitting forms"). Pure functions of
 * the record, so a saved snapshot is judged again offline:
 *
 * - 3.3.1 (rampa/error-on-submit) and 3.3.3 (rampa/suggestion-on-submit): the error state rules of B8 (rules/errors.ts)
 *   on each field the probe broke, on the form the server sent back.
 * - 3.3.7 (rampa/redundant-entry-steps): what a later step asks again of what an earlier step was given, and fields the
 *   page cleared when it sent the form back with errors.
 * - 3.3.4 (rampa/error-prevention-steps): the step whose control commits, reached and never pressed: what it shows of a
 *   review step, a confirmation box, a way to reverse it, and whether the server checked the entries on the way. Any of
 *   those is review; none of them is a failure.
 *
 * Facts of the first step are tied to the snapshot's own fields; later steps are pages the snapshot never saw, so their
 * facts are tied to the form the flow started from, and the message names the step and the field.
 */

export const ERROR_ON_SUBMIT_RULE = 'rampa/error-on-submit'
export const SUGGESTION_ON_SUBMIT_RULE = 'rampa/suggestion-on-submit'
export const REDUNDANT_STEPS_RULE = 'rampa/redundant-entry-steps'
export const PREVENTION_STEPS_RULE = 'rampa/error-prevention-steps'

export function submitData(record: ProbeRecord): Partial<SubmitData> {
  return asRecord(record.data) as Partial<SubmitData>
}

const short = (text: string | undefined, n = 80) => {
  const value = (text ?? '').replace(/\s+/g, ' ').trim()
  return value.length > n ? `${value.slice(0, n - 1)}…` : value
}

/** The validity flag of the constraint a value was made to break, as the browser would set it. */
const FLAG: Record<string, string> = { type: 'typeMismatch', pattern: 'patternMismatch', minlength: 'tooShort', min: 'rangeUnderflow', max: 'rangeOverflow' }

const TEXT_TYPES = new Set(['text', 'email', 'url', 'tel', 'number', 'search', 'textarea'])

function pathOf(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.pathname}${parsed.search}`
  } catch {
    return url
  }
}

const flowsOf = (data: Partial<SubmitData>) => asArray<SubmitFlow>(data.flows)
const stepsOf = (flow: SubmitFlow) => asArray<SubmitStep>(flow?.steps)
const submissionsOf = (step: SubmitStep) => asArray<Submission>(step?.submissions)

/**
 * The snapshot node a fact is about: on the first step, the field itself (or the form, when no field is named); on a
 * later step, a page the snapshot never saw, the form the flow started from.
 */
function nodeOf(ctx: Pick<ProbeRuleContext, 'index'>, flow: SubmitFlow, step: number, target?: Pick<SubmittedField, 'ref' | 'id'>): A11yNode | undefined {
  if (step === 1 && target) return matchNode(ctx.index, target.ref, target.id)
  return matchNode(ctx.index, flow.form?.ref, flow.form?.id)
}

/** What the server sent back, in a few words: `POST /errors/ → 200`. */
function answerText(submission: Submission, loc: Locale): string {
  const first = asArray<Submission['requests'][number]>(submission.requests)[0]
  if (!first) return say(loc, 'the page answered without sending anything', 'a página respondeu sem enviar nada')
  return `${first.method} ${pathOf(first.url)}${first.status !== undefined ? ` → ${first.status}` : ''}`
}

/** What the probe did to a field before the answer: `typed "rampa" (type="email") into it and submitted the form (POST /errors/ → 200)`. */
function didText(field: Pick<SubmittedField, 'typed' | 'rule'>, step: SubmitStep, submission: Submission, loc: Locale): string {
  const where = step.index > 1 ? say(loc, ` on step ${step.index} (${pathOf(step.url)})`, ` no passo ${step.index} (${pathOf(step.url)})`) : ''
  const entry = field.typed
    ? say(loc, `typed "${short(field.typed, 30)}" (${field.rule})`, `digitou "${short(field.typed, 30)}" (${field.rule})`)
    : say(loc, `left the field empty (${field.rule})`, `deixou o campo vazio (${field.rule})`)
  return say(loc, `${entry}${where} and submitted the form (${answerText(submission, loc)})`, `${entry}${where} e enviou o formulário (${answerText(submission, loc)})`)
}

/** Fields of an invalid submission the form came back with, read as the error state rules read them. */
function returned(submission: Submission): SubmittedField[] {
  if (submission.kind !== 'invalid' || submission.outcome !== 'same-step') return []
  return asArray<SubmittedField>(submission.fields).filter((field) => field?.after && !field.gone)
}

/** The page showed an error of its own for the field: a mark (aria-invalid, an error class) or a message that came with the answer. */
function errorShown(field: SubmittedField): boolean {
  const after = field.after
  if (!after) return false
  const fresh = new Set(asArray<string>(field.fresh))
  return after.state.includes('aria-invalid') || after.state.includes('class') || after.messages.some((message) => message.shown && fresh.has(message.ref))
}

/** The answer to an invalid submission showed errors: on a field, or in an alert or summary. */
function errorsShown(submission: Submission): boolean {
  return returned(submission).some(errorShown) || (submission.kind === 'invalid' && submission.outcome === 'same-step' && asArray(submission.alerts).length > 0)
}

/** The coverage note every rule shares: what was submitted, where, and what the guard did. */
function runNotes(record: ProbeRecord, data: Partial<SubmitData>, loc: Locale): string[] {
  const flows = flowsOf(data)
  const steps = flows.reduce((sum, flow) => sum + stepsOf(flow).length, 0)
  const submissions = flows.flatMap((flow) => stepsOf(flow).flatMap(submissionsOf))
  const blocked = asArray(record.guard?.blocked).length
  const stops = flows
    .map((flow) => flow.stopped)
    .filter((stop) => stop && !['ended', 'commit', 'no-progress'].includes(stop.reason))
    .map((stop) => `${stop.reason}${stop.detail ? ` (${short(stop.detail, 40)})` : ''}`)
  return [
    say(
      loc,
      `${flows.length} form(s) followed over ${steps} step(s) on ${asArray<string>(data.allowed).join(', ')} (--allow-submit); ${submissions.length} submission(s), ${Number(data.writes) || 0} request(s) let through, ${blocked} blocked`,
      `${flows.length} formulário(s) seguido(s) por ${steps} passo(s) em ${asArray<string>(data.allowed).join(', ')} (--allow-submit); ${submissions.length} envio(s), ${Number(data.writes) || 0} requisição(ões) liberada(s), ${blocked} bloqueada(s)`,
    ),
    stops.length > 0 ? say(loc, `forms stopped short: ${stops.join(', ')}`, `formulários interrompidos: ${stops.join(', ')}`) : '',
  ].filter(Boolean)
}

function row(criterion: string, rule: string, record: ProbeRecord, data: Partial<SubmitData>, loc: Locale, counts: { applicable: number; failures: number; review: number; unmatched: number }, notes: string[]): ProbeCoverage {
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
        `forms submitted to ${asArray<string>(data.allowed).join(', ')} (--allow-submit): invalid entries derived from each field's constraints, then valid synthetic ones, step by step; never a control that commits, at ${Number(viewport.width) || 0}×${Number(viewport.height) || 0}`,
        `formulários enviados a ${asArray<string>(data.allowed).join(', ')} (--allow-submit): entradas inválidas derivadas das restrições de cada campo, depois válidas e sintéticas, passo a passo; nunca um controle que efetiva, em ${Number(viewport.width) || 0}×${Number(viewport.height) || 0}`,
      ),
    ),
    status,
    ...counts,
    note: notes.join('; '),
    maturity: 'experimental',
  }
}

/**
 * 3.3.1 Error Identification, on what the server sent back: B8's decision (rampa/error-without-text) on each field the
 * probe broke. A field marked invalid (aria-invalid) with no message a person sees and assistive technology reads
 * fails; one marked only by an error class, and a message that is neither tied to its field nor announced, go to
 * review; so does an error that shows only in a text that names no field.
 */
export const errorOnSubmitRule: ProbeRule = {
  id: ERROR_ON_SUBMIT_RULE,
  kind: 'form',
  variant: 'submit',
  versions: [SUBMIT_VERSION],
  criteria: ['3.3.1'],
  run(record, ctx) {
    const data = submitData(record)
    const loc = ctx.locale
    const findings: Finding[] = []
    const review: Finding[] = []
    let applicable = 0
    let unmatched = 0
    let accepted = 0
    for (const flow of flowsOf(data)) {
      for (const step of stepsOf(flow)) {
        for (const submission of submissionsOf(step)) {
          if (submission.kind !== 'invalid') continue
          if (submission.outcome === 'next-step' || submission.outcome === 'ended') accepted++
          const fields = returned(submission)
          let shown = false
          for (const field of fields) {
            if (!errorShown(field) || !field.after) continue
            shown = true
            const node = nodeOf(ctx, flow, step.index, field)
            if (!node) {
              unmatched++
              continue
            }
            applicable++
            const facts = { ...field.after, label: field.after.label || field.label }
            const did = didText(field, step, submission, loc)
            const hit = withoutTextHit(facts)
            if (hit) {
              const finding = probeFinding({
                criterion: '3.3.1',
                rule: this.id,
                node,
                message: `${errorWithoutTextRule.message(hit, loc)} ${say(loc, `Seen after Rampa ${did}, with --allow-submit.`, `Visto depois que o Rampa ${did}, com --allow-submit.`)}`,
                evidence: `${did}; ${hit.evidence ?? ''}`,
                confidence: hit.outcome === 'fail' ? (hit.confidence ?? 'medium') : 'low',
                subject: `${step.index}|${field.name}|${field.constraint}|${hit.subject}`,
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
                  node,
                  message: say(
                    loc,
                    `The field ${label} showed the error "${short(message, 100)}" after Rampa ${did}, but the message is neither tied to the field (aria-describedby, aria-errormessage) nor announced (role="alert", a live region): a person on the field with a screen reader may never hear it (WCAG 3.3.1). Tie it with aria-describedby or aria-errormessage, and set aria-invalid="true" on the field.`,
                    `O campo ${label} mostrou o erro "${short(message, 100)}" depois que o Rampa ${did}, mas a mensagem não está ligada ao campo (aria-describedby, aria-errormessage) nem é anunciada (role="alert", região viva): quem está no campo com leitor de tela pode nunca ouvi-la (WCAG 3.3.1). Ligue-a com aria-describedby ou aria-errormessage, e marque o campo com aria-invalid="true".`,
                  ),
                  evidence: `${did}; ${say(loc, 'message', 'mensagem')} "${short(message, 100)}" ${say(loc, 'next to the field, not tied, not announced', 'ao lado do campo, sem ligação, não anunciada')}`,
                  confidence: 'low',
                  subject: `untied|${step.index}|${field.name}`,
                }),
              )
            }
          }
          // An error came back that no field shows: does its text name one?
          const alerts = asArray<string>(submission.alerts)
          if (!shown && submission.outcome === 'same-step' && alerts.length > 0) {
            const labels = asArray<SubmittedField>(submission.fields)
              .map((field) => fold(field.label ?? ''))
              .filter((label) => label.length >= 2)
            if (labels.length > 0 && alerts.some((alert) => labels.some((label) => fold(alert).includes(label)))) continue
            const node = nodeOf(ctx, flow, step.index > 1 ? 2 : 1)
            if (!node) {
              unmatched++
              continue
            }
            applicable++
            const did = say(loc, `submitted the form with invalid entries${step.index > 1 ? ` on step ${step.index}` : ''} (${answerText(submission, loc)})`, `enviou o formulário com entradas inválidas${step.index > 1 ? ` no passo ${step.index}` : ''} (${answerText(submission, loc)})`)
            review.push(
              probeFinding({
                criterion: '3.3.1',
                rule: this.id,
                node,
                message: say(
                  loc,
                  `After Rampa ${did}, the page showed "${short(alerts[0], 100)}", but no field is marked or has a message of its own, and the text names none of them: a person cannot tell which entry is wrong (WCAG 3.3.1). Name each field in error, next to it and in the summary, tied with aria-describedby or aria-errormessage.`,
                  `Depois que o Rampa ${did}, a página mostrou "${short(alerts[0], 100)}", mas nenhum campo está marcado nem tem mensagem própria, e o texto não nomeia nenhum deles: a pessoa não sabe qual entrada está errada (WCAG 3.3.1). Nomeie cada campo com erro, ao lado dele e no resumo, ligado com aria-describedby ou aria-errormessage.`,
                ),
                evidence: `${did}; "${short(alerts[0], 100)}"`,
                confidence: 'low',
                subject: `summary|${step.index}`,
              }),
            )
          }
        }
      }
    }
    const notes = [
      ...runNotes(record, data, loc),
      accepted > 0 ? say(loc, `${accepted} submission(s) with invalid entries were accepted and moved on, with no error`, `${accepted} envio(s) com entradas inválidas foram aceitos e seguiram adiante, sem erro`) : '',
      say(loc, 'errors on other origins, in frames and for rules only the server knows are not judged', 'erros em outras origens, em frames e de regras que só o servidor conhece não são julgados'),
    ].filter(Boolean)
    return { findings, review, coverage: [row('3.3.1', this.id, record, data, loc, { applicable, failures: findings.length, review: review.length, unmatched }, notes)] }
  },
}

/**
 * 3.3.3 Error Suggestion, on what the server sent back: B8's decision (rampa/error-suggestion) on each field the probe
 * broke against a constraint its markup states (minlength, min, max, a type, a pattern) that came back with a message
 * of its own: neither the message, the label nor a hint states the constraint.
 */
export const suggestionOnSubmitRule: ProbeRule = {
  id: SUGGESTION_ON_SUBMIT_RULE,
  kind: 'form',
  variant: 'submit',
  versions: [SUBMIT_VERSION],
  criteria: ['3.3.3'],
  run(record, ctx) {
    const data = submitData(record)
    const loc = ctx.locale
    const findings: Finding[] = []
    const review: Finding[] = []
    let applicable = 0
    let unmatched = 0
    for (const flow of flowsOf(data)) {
      for (const step of stepsOf(flow)) {
        for (const submission of submissionsOf(step)) {
          for (const field of returned(submission)) {
            const flag = FLAG[field.constraint]
            if (!flag || !field.after) continue
            const fresh = new Set(asArray<string>(field.fresh))
            if (!field.after.messages.some((message) => message.shown && fresh.has(message.ref))) continue
            const facts = { ...field.after, label: field.after.label || field.label, validity: [flag], constraints: { ...field.after.constraints, ...field.constraints } }
            const decided = suggestionHit(facts, loc)
            if (!decided.applicable) continue
            const node = nodeOf(ctx, flow, step.index, field)
            if (!node) {
              unmatched++
              continue
            }
            applicable++
            const hit = decided.hit
            if (!hit) continue
            const did = didText(field, step, submission, loc)
            const finding = probeFinding({
              criterion: '3.3.3',
              rule: this.id,
              node,
              message: `${errorSuggestionRule.message(hit, loc)} ${say(loc, `Seen after Rampa ${did}, with --allow-submit.`, `Visto depois que o Rampa ${did}, com --allow-submit.`)}`,
              evidence: `${did}; ${hit.evidence ?? ''}`,
              confidence: hit.outcome === 'fail' ? (hit.confidence ?? 'medium') : 'low',
              subject: `${step.index}|${field.name}|${field.constraint}|${hit.subject}`,
            })
            ;(hit.outcome === 'fail' ? findings : review).push(finding)
          }
        }
      }
    }
    const notes = [...runNotes(record, data, loc), say(loc, 'rules only the server knows (not in the markup) are not judged', 'regras que só o servidor conhece (fora da marcação) não são julgadas')]
    return { findings, review, coverage: [row('3.3.3', this.id, record, data, loc, { applicable, failures: findings.length, review: review.length, unmatched }, notes)] }
  },
}

const normalize = (label: string) =>
  fold(label)
    .replace(/\((required|optional|obrigatorio|opcional|obligatorio)\)|\*|:/g, '')
    .replace(/\s+/g, ' ')
    .trim()

/** What a later field asks that an earlier one asked: the same autocomplete purpose in the same section, or the same label. */
function sameAsk(earlier: StepControl, later: StepControl): 'autocomplete' | 'label' | undefined {
  if (earlier.purpose && later.purpose) {
    if (earlier.purpose !== later.purpose || NOT_REDUNDANT.has(earlier.purpose.split(' ').at(-1) ?? '')) return undefined
    return (earlier.section ?? '') === (later.section ?? '') ? 'autocomplete' : undefined
  }
  const key = normalize(earlier.label ?? '')
  return key.length >= 2 && key === normalize(later.label ?? '') ? 'label' : undefined
}

/** The controls a step was given in the submission that moved the flow on, with what went in. */
function given(step: SubmitStep): Array<{ control: StepControl; value: string }> {
  const moved = submissionsOf(step).find((submission) => submission.outcome === 'next-step' || submission.outcome === 'ended')
  const out: Array<{ control: StepControl; value: string }> = []
  for (const entry of asArray<Submission['entries'][number]>(moved?.entries)) {
    if (!TEXT_TYPES.has(entry.type) || entry.value === '') continue
    const control = asArray<StepControl>(step.controls).find((c) => (entry.name !== '' && c.name === entry.name) || c.ref === entry.ref)
    if (control) out.push({ control, value: entry.value })
  }
  return out
}

/**
 * 3.3.7 Redundant Entry across steps: a field of a later step that asks for what an earlier step was given (the same
 * autocomplete purpose in the same section, or the same label), neither filled in on arrival, nor offered to select,
 * nor with a control to reuse it. The same purpose fails; the same label, or a field that asks to confirm the entry, goes
 * to review. Fields the page cleared when it sent the form back with errors go to review too.
 */
export const redundantStepsRule: ProbeRule = {
  id: REDUNDANT_STEPS_RULE,
  kind: 'form',
  variant: 'submit',
  versions: [SUBMIT_VERSION],
  criteria: ['3.3.7'],
  run(record, ctx) {
    const data = submitData(record)
    const loc = ctx.locale
    const findings: Finding[] = []
    const review: Finding[] = []
    let applicable = 0
    let unmatched = 0
    let passed = 0
    for (const flow of flowsOf(data)) {
      const earlier: Array<{ step: number; control: StepControl; value: string }> = []
      for (const step of stepsOf(flow)) {
        if (step.index >= 2) {
          for (const control of asArray<StepControl>(step.controls)) {
            if (!TEXT_TYPES.has(control.type) || !control.shows) continue
            const match = earlier.map((entry) => ({ entry, basis: sameAsk(entry.control, control) })).find((candidate) => candidate.basis !== undefined)
            if (!match?.basis) continue
            const { entry: first, basis } = match
            const node = nodeOf(ctx, flow, step.index)
            if (!node) {
              unmatched++
              continue
            }
            applicable++
            const value = first.value.trim().toLowerCase()
            const populated = (control.value ?? '').trim().toLowerCase() === value
            const offered = asArray<string>(control.options).some((option) => option.toLowerCase().includes(value))
            if (populated || offered || asArray(step.reuse).length > 0) {
              passed++
              continue
            }
            const confirm = CONFIRM_WORDS.test(control.label ?? '')
            const fail = basis === 'autocomplete' && !confirm
            const purpose = basis === 'autocomplete' ? control.purpose?.split(' ').at(-1) : undefined
            const what = (purpose ? describeField(purpose, loc) : undefined) ?? `"${short(first.control.label, 40)}"`
            const where = `${pathOf(step.url)}`
            const evidence = say(
              loc,
              `step ${first.step} "${short(first.control.label, 40)}"${first.control.token ? ` (autocomplete="${first.control.token}")` : ''} was given "${short(first.value, 40)}"; step ${step.index} (${where}) "${short(control.label, 40)}"${control.token ? ` (autocomplete="${control.token}")` : ''} arrived empty, offered nothing, and no control offers to reuse it`,
              `o passo ${first.step} "${short(first.control.label, 40)}"${first.control.token ? ` (autocomplete="${first.control.token}")` : ''} recebeu "${short(first.value, 40)}"; o passo ${step.index} (${where}) "${short(control.label, 40)}"${control.token ? ` (autocomplete="${control.token}")` : ''} chegou vazio, não ofereceu nada, e nenhum controle oferece reaproveitar`,
            )
            const message = fail
              ? say(
                  loc,
                  `Step ${step.index} of the form (${where}) asks again for ${what} ("${short(control.label, 40)}"), which step ${first.step} was given, and neither fills it in, offers it to select, nor has a control to reuse it: people must enter it again (WCAG 3.3.7). Fill it in from the earlier step, or offer it to select.`,
                  `O passo ${step.index} do formulário (${where}) pede de novo ${what} ("${short(control.label, 40)}"), que o passo ${first.step} já recebeu, e não o preenche, não o oferece para escolher nem tem controle para reaproveitá-lo: a pessoa precisa digitar de novo (WCAG 3.3.7). Preencha a partir do passo anterior, ou ofereça para escolher.`,
                )
              : say(
                  loc,
                  `Step ${step.index} of the form (${where}) may ask again for ${what} ("${short(control.label, 40)}"), which step ${first.step} was given, and does not fill it in or offer it. ${confirm ? 'It asks to confirm the entry, which the criterion allows when that is essential or needed for security.' : 'Whether it is the same information (and not, say, about another person) needs a person.'} If it is not an exception, fill it in or offer it (WCAG 3.3.7).`,
                  `O passo ${step.index} do formulário (${where}) pode pedir de novo ${what} ("${short(control.label, 40)}"), que o passo ${first.step} já recebeu, e não o preenche nem o oferece. ${confirm ? 'Ele pede para confirmar a entrada, o que o critério permite quando é essencial ou necessário para a segurança.' : 'Se é a mesma informação (e não, por exemplo, de outra pessoa) precisa de uma pessoa.'} Se não for uma exceção, preencha ou ofereça (WCAG 3.3.7).`,
                )
            const finding = probeFinding({ criterion: '3.3.7', rule: this.id, node, message, evidence, confidence: fail ? 'medium' : 'low', subject: `${basis}|${step.index}|${control.name || control.ref}|${confirm ? 'confirm' : 'again'}` })
            ;(fail ? findings : review).push(finding)
          }
        }
        // The form came back with errors and without what was entered right.
        for (const submission of submissionsOf(step)) {
          const cleared = asArray<string>(submission.cleared)
          if (submission.kind !== 'invalid' || submission.outcome !== 'same-step' || cleared.length === 0) continue
          const node = nodeOf(ctx, flow, step.index > 1 ? 2 : 1)
          if (!node) {
            unmatched++
            continue
          }
          applicable++
          const list = cleared
            .slice(0, 4)
            .map((label) => `"${short(label, 40)}"`)
            .join(', ')
          review.push(
            probeFinding({
              criterion: '3.3.7',
              rule: this.id,
              node,
              message: say(
                loc,
                `When the form came back with errors${step.index > 1 ? ` on step ${step.index}` : ''}, it had cleared ${cleared.length} field(s) Rampa had filled in correctly (${list}): people must enter them again after any error (WCAG 3.3.7). Keep what was entered when the form comes back with errors, unless it is a secret.`,
                `Quando o formulário voltou com erros${step.index > 1 ? ` no passo ${step.index}` : ''}, tinha apagado ${cleared.length} campo(s) que o Rampa preencheu corretamente (${list}): a pessoa precisa digitar de novo depois de qualquer erro (WCAG 3.3.7). Mantenha o que foi digitado quando o formulário volta com erros, a menos que seja um segredo.`,
              ),
              evidence: say(loc, `${list} filled in, empty after the answer (${answerText(submission, loc)})`, `${list} preenchido(s), vazio(s) depois da resposta (${answerText(submission, loc)})`),
              confidence: 'low',
              subject: `cleared|${step.index}`,
            }),
          )
        }
        for (const entry of given(step)) earlier.push({ step: step.index, ...entry })
      }
    }
    const steps = flowsOf(data).reduce((sum, flow) => sum + stepsOf(flow).length, 0)
    const notes = [
      ...runNotes(record, data, loc),
      passed > 0 ? say(loc, `${passed} field(s) asked again were filled in, offered, or had a control to reuse the entry`, `${passed} campo(s) pedido(s) de novo foram preenchidos, oferecidos, ou tinham controle para reaproveitar`) : '',
      steps < 2 ? say(loc, 'no flow went past its first step', 'nenhum fluxo passou do primeiro passo') : '',
    ].filter(Boolean)
    return { findings, review, coverage: [row('3.3.7', this.id, record, data, loc, { applicable, failures: findings.length, review: review.length, unmatched }, notes)] }
  },
}

const KIND_TEXT: Record<string, [string, string]> = {
  financial: ['a purchase or a payment', 'uma compra ou um pagamento'],
  legal: ['a legal agreement', 'um compromisso legal'],
  data: ['the deletion of data', 'a exclusão de dados'],
  test: ['test answers', 'respostas de prova'],
}

/**
 * 3.3.4 Error Prevention (Legal, Financial, Data) across steps: the step whose control commits (rules/scope.ts's words),
 * reached after at least one earlier step and never pressed. Seen on the way: a review step (the step names itself so,
 * or shows the entries again), a confirmation checkbox, a word about reversing it, or the server checking the entries
 * (invalid ones came back with errors). Any of them is review: a person checks that it works. None of them fails. A
 * commitment on the first page is the scope note's (rampa/error-prevention-scope).
 */
export const preventionStepsRule: ProbeRule = {
  id: PREVENTION_STEPS_RULE,
  kind: 'form',
  variant: 'submit',
  versions: [SUBMIT_VERSION],
  criteria: ['3.3.4'],
  run(record, ctx) {
    const data = submitData(record)
    const loc = ctx.locale
    const findings: Finding[] = []
    const review: Finding[] = []
    let applicable = 0
    let unmatched = 0
    let first = 0
    for (const flow of flowsOf(data)) {
      const commit = flow.commit
      if (!commit) continue
      if (commit.step < 2) {
        first++
        continue
      }
      const kind = commitmentOf(commit.control ?? '') ?? commit.kind
      const node = nodeOf(ctx, flow, 2)
      if (!node) {
        unmatched++
        continue
      }
      applicable++
      const text = asArray<string>(commit.texts).map(fold).join(' \u0000 ')
      const reviewWord = REVIEW_TEXT.exec(text)?.[0]
      const echoed = asArray<string>(commit.echoed)
      const entered = Number(commit.entered) || 0
      const shownAgain = entered > 0 && echoed.length >= Math.min(2, entered)
      const box = asArray<string>(commit.checkboxes).find((name) => CONFIRM_BOX.test(fold(name)))
      const reversal = REVERSAL_TEXT.exec(text)?.[0]
      const checked = stepsOf(flow).some((step) => step.index < commit.step && submissionsOf(step).some(errorsShown))
      const edit = asArray<string>(commit.edit)
      const seen: string[] = []
      if (reviewWord || shownAgain) {
        const parts = [reviewWord ? `“${reviewWord}”` : '', shownAgain ? say(loc, `${echoed.length} of ${entered} entries shown again`, `${echoed.length} de ${entered} entradas mostradas de novo`) : '', edit.length > 0 ? say(loc, `with “${short(edit[0], 30)}”`, `com “${short(edit[0], 30)}”`) : '']
        seen.push(say(loc, `a review step (${parts.filter(Boolean).join('; ')})`, `uma etapa de revisão (${parts.filter(Boolean).join('; ')})`))
      }
      if (box) seen.push(say(loc, `a checkbox “${short(box, 60)}”`, `uma caixa “${short(box, 60)}”`))
      if (reversal) seen.push(say(loc, `a word about reversing it (“${reversal}”)`, `uma menção a desfazer (“${reversal}”)`))
      if (checked) seen.push(say(loc, 'the server checked the entries: invalid ones came back with errors', 'o servidor conferiu as entradas: as inválidas voltaram com erros'))
      const what = say(loc, ...(KIND_TEXT[kind] ?? [kind, kind]))
      const where = pathOf(asArray<SubmitStep>(flow.steps).find((step) => step.index === commit.step)?.url ?? '')
      const control = short(commit.control, 40)
      const evidence = [
        say(loc, `step ${commit.step} (${where}): "${control}", never pressed`, `passo ${commit.step} (${where}): "${control}", nunca apertado`),
        seen.length > 0 ? seen.join('; ') : say(loc, `no review step, no confirmation box, no way to reverse it; ${entered} entries, ${echoed.length} shown again; invalid entries accepted without an error`, `sem etapa de revisão, caixa de confirmação ou jeito de desfazer; ${entered} entradas, ${echoed.length} mostradas de novo; entradas inválidas aceitas sem erro`),
      ].join('; ')
      if (seen.length === 0) {
        findings.push(
          probeFinding({
            criterion: '3.3.4',
            rule: this.id,
            node,
            message: say(
              loc,
              `Step ${commit.step} of the form (${where}) commits ${what} with "${control}", and on the way there Rampa saw none of the safeguards 3.3.4 asks for: no step that shows the entries again for review, no box to confirm them, no word of a way to reverse it, and the server accepted invalid entries without an error, so they were not checked either (WCAG 3.3.4). Add a review step that shows the entries with a way to change them, a confirmation checkbox, or a way to cancel the submission. Rampa reached the step and never pressed "${control}".`,
              `O passo ${commit.step} do formulário (${where}) efetiva ${what} com "${control}", e no caminho até lá o Rampa não viu nenhuma das salvaguardas que o 3.3.4 pede: nenhuma etapa que mostre de novo as entradas para revisão, nenhuma caixa para confirmá-las, nenhuma menção a um jeito de desfazer, e o servidor aceitou entradas inválidas sem erro, então elas também não foram conferidas (WCAG 3.3.4). Adicione uma etapa de revisão que mostre as entradas com um jeito de alterá-las, uma caixa de confirmação, ou um jeito de cancelar o envio. O Rampa chegou à etapa e nunca apertou "${control}".`,
            ),
            evidence,
            confidence: 'medium',
            subject: `none|${kind}|${normalize(commit.control ?? '')}`,
          }),
        )
        continue
      }
      review.push(
        probeFinding({
          criterion: '3.3.4',
          rule: this.id,
          node,
          message: say(
            loc,
            `Step ${commit.step} of the form (${where}) commits ${what} with "${control}". On the way there Rampa saw ${seen.join('; ')}. Check that the person can review, correct and confirm the entries, or reverse the submission, before it is final (WCAG 3.3.4). Rampa reached the step and never pressed "${control}".`,
            `O passo ${commit.step} do formulário (${where}) efetiva ${what} com "${control}". No caminho até lá o Rampa viu ${seen.join('; ')}. Confira se a pessoa pode revisar, corrigir e confirmar as entradas, ou desfazer o envio, antes de ficar definitivo (WCAG 3.3.4). O Rampa chegou à etapa e nunca apertou "${control}".`,
          ),
          evidence,
          confidence: 'low',
          subject: `seen|${kind}|${normalize(commit.control ?? '')}`,
        }),
      )
    }
    const notes = [
      ...runNotes(record, data, loc),
      applicable === 0 ? say(loc, 'no step that commits was reached after an earlier step', 'nenhum passo que efetiva foi alcançado depois de um passo anterior') : '',
      first > 0 ? say(loc, `${first} control(s) that commit on the first page: the scope note covers them`, `${first} controle(s) que efetivam na primeira página: a nota de escopo os cobre`) : '',
      say(loc, 'a control that commits is never pressed', 'um controle que efetiva nunca é apertado'),
    ].filter(Boolean)
    return { findings, review, coverage: [row('3.3.4', this.id, record, data, loc, { applicable, failures: findings.length, review: review.length, unmatched }, notes)] }
  },
}

export const SUBMIT_RULES: readonly ProbeRule[] = [errorOnSubmitRule, suggestionOnSubmitRule, redundantStepsRule, preventionStepsRule]

/** What the report's header says about submissions, from the form probe's submit record; undefined when there is none. */
export function submissionSummary(snapshot: A11ySnapshot): Report['submissions'] {
  const record = (snapshot.observations?.probes ?? []).find((r) => r.kind === 'form' && r.conditions.variant === 'submit')
  if (!record) return undefined
  const data = submitData(record)
  const dryRun = data.dryRun === true
  const sent = asArray(record.guard?.submitted).length
  return {
    allowed: asArray<string>(data.allowed),
    dryRun,
    sent,
    blocked: asArray(record.guard?.blocked).length,
    ...(record.status === 'skipped' && !dryRun ? { skipped: record.reason ?? 'skipped' } : {}),
  }
}
