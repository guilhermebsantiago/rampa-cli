import type { Confidence, Finding, ProbeCoverage } from '../core/types.ts'
import type { Locale } from '../i18n.ts'
import { type ContextChange, INPUT_VERSION, type InputControl, type InputData, type InputVerdict, inputVerdicts } from '../probes/input.ts'
import type { ProbeRecord } from '../snapshot/schema.ts'
import { type ProbeRule, type ProbeRuleContext, asArray, asRecord, conditionsText, probeFinding, say } from './probes.ts'

export const ON_INPUT_RULE = 'rampa/on-input'

/** The on-input probe's record, when it is one the rule reads. */
export function inputRecord(records: readonly ProbeRecord[] | undefined): ProbeRecord | undefined {
  return records?.find((r) => r.kind === 'input' && r.version === INPUT_VERSION && r.status !== 'skipped')
}

export function inputData(record: ProbeRecord): Partial<InputData> {
  return asRecord(record.data) as Partial<InputData>
}

const short = (text: string | undefined, n = 80) => {
  const value = (text ?? '').replace(/\s+/g, ' ').trim()
  return value.length > n ? `${value.slice(0, n - 1)}…` : value
}

/** "<select> "Country"", "<input type=checkbox> "Show the terms"". */
export function controlName(control: Pick<InputControl, 'tag' | 'type' | 'label'>): string {
  const tag = control.tag === 'input' && control.type ? `input type=${control.type}` : control.tag
  return `<${tag}>${control.label ? ` "${short(control.label, 60)}"` : ''}`
}

/** What a change of context was, in a few words. */
export function changeText(change: ContextChange, locale: Locale): string {
  const detail = short(change.detail, 100)
  switch (change.kind) {
    case 'navigation':
      return say(locale, `goes to another page (${detail})`, `vai para outra página (${detail})`)
    case 'new-window':
      return say(locale, `opens a new window (${detail})`, `abre uma nova janela (${detail})`)
    case 'submission':
      return say(locale, `submits its form (${detail})`, `envia o formulário (${detail})`)
    case 'modal':
      return say(locale, `opens a modal dialog${detail ? ` ("${detail}")` : ''}`, `abre um diálogo modal${detail ? ` ("${detail}")` : ''}`)
    case 'dialog':
      return say(locale, `shows a browser dialog (${detail})`, `mostra um diálogo do navegador (${detail})`)
    case 'focus':
      return say(locale, `moves focus to ${detail}`, `move o foco para ${detail}`)
    case 'route':
      return say(locale, `changes the address to ${detail} without loading a page`, `muda o endereço para ${detail} sem carregar uma página`)
    case 'content':
      return say(locale, `changes most of the page's text (${detail})`, `muda a maior parte do texto da página (${detail})`)
    case 'focus-lost':
      return say(locale, 'sends focus back to the document', 'devolve o foco ao documento')
    case 'layer':
      return say(locale, `shows a layer over the page${detail ? ` ("${detail}")` : ''}`, `mostra uma camada sobre a página${detail ? ` ("${detail}")` : ''}`)
  }
}

function whenText(change: ContextChange, locale: Locale): string {
  return change.phase === 'commit' ? say(locale, 'when the field is left after a change', 'quando o campo é deixado depois de uma mudança') : say(locale, 'as soon as its value changes', 'assim que seu valor muda')
}

const TECHNIQUES: Partial<Record<ContextChange['kind'], string>> = { submission: 'F36', 'new-window': 'F37' }

/** Confidence of a failure: a commit (the field left) or a weaker change of context weighs less. */
function confidenceOf(change: ContextChange): Confidence {
  if (change.weight === 'medium' || change.phase === 'commit') return 'medium'
  return 'high'
}

function evidenceOf(verdict: InputVerdict, locale: Locale): string {
  const trial = verdict.control.trial
  const parts = [
    trial?.action ?? '',
    `${changeText(verdict.change, locale)}${verdict.change.phase === 'commit' ? say(locale, ' after the field was left', ' depois que o campo foi deixado') : ''}`,
    say(locale, 'nothing like it in the wait with no input before', 'nada parecido na espera sem entrada antes'),
    verdict.result === 'failure'
      ? say(locale, 'again on a second fresh load', 'de novo numa segunda carga nova')
      : verdict.why === 'once'
        ? say(locale, 'not again on a second fresh load', 'não de novo numa segunda carga nova')
        : '',
    asArray<string>(verdict.control.texts).length > 0
      ? say(locale, `texts around it: ${asArray<string>(verdict.control.texts).slice(0, 3).map((t) => `"${short(t, 80)}"`).join(', ')}`, `textos ao redor: ${asArray<string>(verdict.control.texts).slice(0, 3).map((t) => `"${short(t, 80)}"`).join(', ')}`)
      : '',
  ]
  return parts.filter(Boolean).join('; ')
}

export function onInputMessage(verdict: InputVerdict, locale: Locale): string {
  const control = controlName(verdict.control)
  const action = verdict.control.trial?.action ? ` (${verdict.control.trial.action})` : ''
  const what = `${changeText(verdict.change, locale)} ${whenText(verdict.change, locale)}`
  if (verdict.result === 'failure') {
    const technique = TECHNIQUES[verdict.change.kind]
    return say(
      locale,
      `Changing ${control}${action} ${what}, with no warning Rampa could read before it: a change of context on input (WCAG 3.2.2${technique ? `; ${technique}` : ''}). Let people confirm the change with a button (G80, H32), or say before the control what the change will do (G13). If the page already says so, the criterion is met: the 3.2.2 judgment clears this finding when it can quote that text, or waive it (rampa waive).`,
      `Mudar ${control}${action} ${what}, sem aviso que o Rampa pudesse ler antes: uma mudança de contexto na entrada (WCAG 3.2.2${technique ? `; ${technique}` : ''}). Deixe a pessoa confirmar a mudança com um botão (G80, H32), ou diga antes do controle o que a mudança fará (G13). Se a página já diz isso, o critério está atendido: o julgamento do 3.2.2 retira este achado quando consegue citar esse texto, ou dispense-o (rampa waive).`,
    )
  }
  const why =
    verdict.why === 'once'
      ? say(locale, 'It did not happen again on a second load, so it may have been the page’s own doing: check it by hand.', 'Não aconteceu de novo numa segunda carga, então pode ter sido a própria página: verifique à mão.')
      : verdict.why === 'unconfirmed'
        ? say(locale, 'It was not tried again on a second load (budget): check it by hand.', 'Não foi tentado de novo numa segunda carga (limite): verifique à mão.')
        : say(
            locale,
            'Whether that changes the context (where the person is, or what the page means) needs a person: a change of content alone is not a change of context.',
            'Se isso muda o contexto (onde a pessoa está, ou o que a página significa) precisa de uma pessoa: uma mudança de conteúdo sozinha não é mudança de contexto.',
          )
  return say(locale, `Changing ${control}${action} ${what}. ${why}`, `Mudar ${control}${action} ${what}. ${why}`)
}

const SKIP_TEXT: Record<string, [string, string]> = {
  destructive: ['a destructive or account-changing name', 'um nome destrutivo ou que muda a conta'],
  'sensitive-form': ['in a form with password, payment or file fields', 'em formulário com senha, pagamento ou arquivo'],
  secret: ['a password or file field', 'campo de senha ou arquivo'],
  disabled: ['disabled', 'desabilitado'],
  'no-choice': ['no other option', 'nenhuma outra opção'],
}

/**
 * 3.2.2 On Input, over the on-input probe. A change of a control's value followed by a change of context (WCAG's
 * definition: a new page, a new window, a submission, a modal dialog, a browser dialog, focus moved by the page) that
 * did not happen in the wait with no input before it, and happened again on a second fresh load, is a failure: high
 * for a navigation, a window, a submission or a modal dialog as the value changes; medium for a browser dialog, focus
 * moved, or anything that happened only when the field was left. Once of two loads, or not tried again, goes to
 * review; so do an address set in place, a large change of content, a layer that is not modal and focus lost to the
 * document, which may or may not change the context. Small changes of content are not reported: they are not changes
 * of context. The 3.2.2 judgment (criteria/on-input.ts) may clear a failure by quoting text that warns of it.
 */
export const onInputRule: ProbeRule = {
  id: ON_INPUT_RULE,
  kind: 'input',
  variant: 'on-input',
  versions: [INPUT_VERSION],
  criteria: ['3.2.2'],
  run(record: ProbeRecord, ctx: ProbeRuleContext) {
    const data = inputData(record)
    const loc = ctx.locale
    const { verdicts, applicable, unmatched, noisy, unchanged } = inputVerdicts(data, ctx.index)
    const findings: Finding[] = []
    const review: Finding[] = []
    for (const verdict of verdicts) {
      const finding = probeFinding({
        criterion: '3.2.2',
        rule: this.id,
        node: verdict.node,
        message: onInputMessage(verdict, loc),
        evidence: evidenceOf(verdict, loc),
        confidence: verdict.result === 'failure' ? confidenceOf(verdict.change) : 'low',
        subject: `${verdict.change.kind}|${verdict.change.phase}`,
      })
      ;(verdict.result === 'failure' ? findings : review).push(finding)
    }
    const controls = asArray<InputControl>(data.controls)
    const skipped = controls.filter((c) => c.skip)
    const notExercised = controls.filter((c) => c.trial?.outcome === 'not-exercised' || c.trial?.outcome === 'no-focus')
    const notTried = controls.filter((c) => c.trial?.outcome === 'not-tried').length
    const found = Number(data.found) || 0
    const tried = Number(data.tried) || 0
    const notes = [
      say(loc, `${found} form control(s) found (a radio group once), ${tried} changed, each on a fresh load`, `${found} controle(s) de formulário encontrado(s) (um grupo de rádios uma vez), ${tried} alterado(s), cada um numa carga nova`),
      skipped.length > 0
        ? `${say(loc, `${skipped.length} skipped`, `${skipped.length} pulado(s)`)}: ${skipped
            .slice(0, 4)
            .map((c) => `${controlName(c)} (${say(loc, ...(SKIP_TEXT[c.skip?.reason ?? ''] ?? [c.skip?.reason ?? '', c.skip?.reason ?? '']))}${c.skip?.reason === 'destructive' && c.skip.detail ? ` "${c.skip.detail}"` : ''})`)
            .join(', ')}${skipped.length > 4 ? ', …' : ''}`
        : '',
      notExercised.length > 0
        ? `${say(loc, `${notExercised.length} not exercised`, `${notExercised.length} não exercitado(s)`)}: ${notExercised
            .slice(0, 3)
            .map((c) => (c.trial?.cover ? `${controlName(c)} ${say(loc, 'under', 'sob')} <${c.trial.cover.tag}> "${short(c.trial.cover.text, 40)}"` : `${controlName(c)} (${c.trial?.reason ?? c.trial?.outcome})`))
            .join(', ')}`
        : '',
      unchanged > 0 ? say(loc, `${unchanged} did not take the change`, `${unchanged} não aceitou(aram) a mudança`) : '',
      noisy > 0 ? say(loc, `${noisy} change(s) of context the page also made with no input, not counted`, `${noisy} mudança(s) de contexto que a página também fez sem entrada, não contada(s)`) : '',
      notTried > 0 ? say(loc, `${notTried} not tried (${data.end === 'time' ? 'time budget' : 'budget'})`, `${notTried} não tentado(s) (${data.end === 'time' ? 'limite de tempo' : 'limite'})`) : '',
      say(loc, 'nothing was submitted; navigations were intercepted', 'nada foi enviado; navegações foram interceptadas'),
    ].filter(Boolean)
    const viewport = asRecord(data.viewport)
    const status: ProbeCoverage['status'] =
      findings.length > 0 ? 'failures' : review.length > 0 ? 'needs-review' : applicable === 0 && found > 0 ? 'not-checked' : 'no-failure-found'
    const coverage: ProbeCoverage = {
      criterion: '3.2.2',
      method: `probe/input@${record.version}`,
      rule: this.id,
      conditions: conditionsText(
        record,
        say(loc, `each form control changed once on a fresh load at ${Number(viewport.width) || 0}×${Number(viewport.height) || 0}`, `cada controle de formulário alterado uma vez numa carga nova em ${Number(viewport.width) || 0}×${Number(viewport.height) || 0}`),
      ),
      status,
      applicable,
      failures: findings.length,
      review: review.length,
      unmatched,
      note: notes.join('; '),
      maturity: 'experimental',
    }
    return { findings, review, coverage: [coverage] }
  },
}
