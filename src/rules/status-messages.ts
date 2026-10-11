import { fingerprint } from '../core/check.ts'
import type { Finding, ProbeCoverage } from '../core/types.ts'
import type { Locale } from '../i18n.ts'
import { matchNode } from '../probes/identity.ts'
import { type Announcement, STATUS_VERSION, type StatusData, type StatusMessage, type StatusTrigger } from '../probes/status.ts'
import { liveRegions } from '../snapshot/ax.ts'
import type { A11yNode, A11ySnapshot, ProbeRecord } from '../snapshot/schema.ts'
import type { TreeIndex } from '../snapshot/tree.ts'
import { type ProbeRule, type ProbeRuleContext, asArray, asRecord, conditionsText, probeFinding, say } from './probes.ts'

export const STATUS_RULE = 'rampa/status-messages'

/** The status probe's record, when it is one the rule reads. */
export function statusRecord(records: readonly ProbeRecord[] | undefined): ProbeRecord | undefined {
  return records?.find((r) => r.kind === 'status' && r.version === STATUS_VERSION && r.status !== 'skipped')
}

export function statusData(record: ProbeRecord): Partial<StatusData> {
  return asRecord(record.data) as Partial<StatusData>
}

const short = (text: string | undefined, n = 80) => {
  const value = (text ?? '').replace(/\s+/g, ' ').trim()
  return value.length > n ? `${value.slice(0, n - 1)}…` : value
}

const words = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)

/** Whether a live region said the message: one text holds the other, or most of the message's words are in it. */
export function sameWords(region: string, message: string): boolean {
  const a = words(region).join(' ')
  const b = words(message).join(' ')
  if (a === '' || b === '') return false
  if (a.includes(b) || (a.length >= 3 && b.includes(a))) return true
  const said = new Set(words(region))
  const own = words(message)
  return own.filter((w) => said.has(w)).length >= Math.max(1, Math.ceil(own.length * 0.6))
}

/**
 * The F103 triage of one message, deterministic, in this order. focused: focus is in it, so it is not delivered without
 * focus; dialog: it sits in a dialog, a change of context; live: the browser exposes a live region, or a status, alert
 * or log role, around it (the page's markup when the browser's tree was not read), shown or not; hidden: it does not
 * show (text only a screen reader gets, outside a live region, is not a message to anyone); announced: a live region elsewhere received
 * the same words, or, for a text tied to the field that was left (in its label or its description), a live region
 * received the field's message in other words (W3C's tutorial puts "Error:" in the label and the advice in a live
 * region); content: it is large (over 300 characters, three links or fields, three list items): a panel, a list
 * of results, more items; unexposed: none of these, and only a person, or the 4.1.3 judgment, can say whether it is a
 * status message.
 */
export type Triage = 'hidden' | 'focused' | 'dialog' | 'live' | 'announced' | 'content' | 'unexposed'

export const LARGE_MESSAGE = { chars: 300, controls: 3, items: 3 }

export function triage(message: StatusMessage, announced: readonly Announcement[]): Triage {
  if (message.focus) return 'focused'
  if (message.dialog) return 'dialog'
  const live =
    message.ax !== undefined
      ? message.ax !== null && (message.ax.live === 'polite' || message.ax.live === 'assertive' || ['status', 'alert', 'log'].includes(message.ax.role))
      : message.live !== undefined && message.live.politeness !== 'off'
  // A live region announces what it receives, shown or not (a hidden announcer).
  if (live) return 'live'
  if (!message.visible) return 'hidden'
  if (announced.some((a) => sameWords(a.text, message.text))) return 'announced'
  if ((message.inLabel || message.describedBy) && announced.length > 0) return 'announced'
  if (message.chars > LARGE_MESSAGE.chars || message.controls >= LARGE_MESSAGE.controls || message.items >= LARGE_MESSAGE.items) return 'content'
  return 'unexposed'
}

export interface StatusVerdict {
  trigger: StatusTrigger
  message: StatusMessage
  triage: Triage
  /** The snapshot node a finding goes on: the message's own element, or the nearest element around it that the snapshot has. */
  node: A11yNode
  /** The node is the message's own element (it was in the page on load). */
  exact: boolean
  /** What a finding is about: the message's text, cut. */
  subject: string
  /** The fingerprint of the rule's item to review on it, which the 4.1.3 judgment settles. */
  key: string
}

export interface StatusVerdicts {
  verdicts: StatusVerdict[]
  /** Messages whose element, or an element around it, the snapshot has. */
  applicable: number
  unmatched: number
  counts: Record<Triage, number>
  /** Live regions whose text changed after a trigger. */
  announced: Array<Announcement & { trigger: StatusTrigger }>
  /** The same text on the same element after another trigger: reported once. */
  repeated: number
}

/** The fingerprint of the rule's item to review on a node about a subject: what the 4.1.3 judgment settles. */
export function statusKey(ref: string, subject: string): string {
  return fingerprint('4.1.3', ref, `${STATUS_RULE}|${subject}`)
}

/** 4.1.3's reading of the status probe's facts; the rule and the judgment read the same. */
export function statusVerdicts(data: Partial<StatusData>, index: TreeIndex): StatusVerdicts {
  const counts: Record<Triage, number> = { hidden: 0, focused: 0, dialog: 0, live: 0, announced: 0, content: 0, unexposed: 0 }
  const result: StatusVerdicts = { verdicts: [], applicable: 0, unmatched: 0, counts, announced: [], repeated: 0 }
  const keys = new Set<string>()
  for (const trigger of asArray<StatusTrigger>(data.triggers)) {
    const trial = trigger?.trial
    if (!trial || trial.outcome) continue
    const announced = asArray<Announcement>(trial.announced)
    for (const a of announced) result.announced.push({ ...a, trigger })
    for (const message of asArray<StatusMessage>(trial.messages)) {
      const own = matchNode(index, message.ref, message.id)
      const around = own ? undefined : asArray<StatusMessage['ancestors'][number]>(message.ancestors).map((a) => matchNode(index, a.ref, a.id)).find((n) => n !== undefined)
      const node = own ?? around
      if (!node) {
        result.unmatched++
        continue
      }
      const subject = short(message.text, 100)
      const key = statusKey(node.ref, subject)
      if (keys.has(key)) {
        result.repeated++
        continue
      }
      keys.add(key)
      result.applicable++
      const kind = triage(message, announced)
      counts[kind]++
      result.verdicts.push({ trigger, message, triage: kind, node, exact: own !== undefined, subject, key })
    }
  }
  return result
}

/** `<input type=email> "E-mail"`, `<button> "Copy link"`. */
function controlName(trigger: Pick<StatusTrigger, 'tag' | 'type' | 'label'>): string {
  const tag = trigger.tag === 'input' && trigger.type ? `input type=${trigger.type}` : trigger.tag
  return `<${tag}>${trigger.label ? ` "${short(trigger.label, 60)}"` : ''}`
}

/** What the probe did, as a sentence's object: "left <input type=email> "E-mail" after typing "a"". */
export function triggerText(trigger: StatusTrigger, locale: Locale): string {
  const name = controlName(trigger)
  switch (trigger.trigger) {
    case 'blur':
      return trigger.value === ''
        ? say(locale, `left ${name} empty after typing in it`, `deixou ${name} vazio depois de digitar nele`)
        : say(locale, `left ${name} after typing "${trigger.value ?? 'a'}"`, `deixou ${name} depois de digitar "${trigger.value ?? 'a'}"`)
    case 'search':
      return say(locale, `searched for "${trigger.value ?? ''}" in ${name} and pressed Enter`, `buscou "${trigger.value ?? ''}" em ${name} e apertou Enter`)
    case 'setting':
      return trigger.choice
        ? say(locale, `selected "${short(trigger.choice.label, 40)}" in ${name}`, `selecionou "${short(trigger.choice.label, 40)}" em ${name}`)
        : say(locale, `checked ${name}`, `marcou ${name}`)
    default:
      return say(locale, `clicked ${name}`, `clicou em ${name}`)
  }
}

function evidenceOf(verdict: StatusVerdict, locale: Locale): string {
  const m = verdict.message
  const trial = verdict.trigger.trial
  const parts = [
    say(locale, `the probe ${triggerText(verdict.trigger, locale)}`, `a sonda ${triggerText(verdict.trigger, locale)}`),
    say(locale, `then "${short(m.text, 150)}" appeared`, `então "${short(m.text, 150)}" apareceu`),
    m.added ? say(locale, `in <${m.tag}> added with it`, `em <${m.tag}> adicionado com ele`) : say(locale, `in <${m.tag}> ${m.ref}`, `em <${m.tag}> ${m.ref}`),
    verdict.exact ? '' : say(locale, `reported on the nearest element the page had on load, ${verdict.node.ref}`, `relatado no elemento mais próximo que a página tinha ao carregar, ${verdict.node.ref}`),
    say(locale, 'focus did not move to it', 'o foco não foi para ele'),
    m.ax === null
      ? say(locale, 'the browser exposes no live region, and no status, alert or log role, around it', 'o navegador não expõe região ao vivo, nem papel status, alert ou log, em volta dele')
      : say(locale, 'no live region around it in the markup', 'nenhuma região ao vivo em volta dele no markup'),
    asArray(trial?.announced).length > 0
      ? say(locale, `live regions that changed say something else: ${asArray<Announcement>(trial?.announced).slice(0, 2).map((a) => `${a.ref} ("${short(a.text, 40)}")`).join(', ')}`, `regiões ao vivo que mudaram dizem outra coisa: ${asArray<Announcement>(trial?.announced).slice(0, 2).map((a) => `${a.ref} ("${short(a.text, 40)}")`).join(', ')}`)
      : say(locale, 'no live region changed', 'nenhuma região ao vivo mudou'),
    m.describedBy ? say(locale, `the field names it with aria-describedby or aria-errormessage${trial?.invalid ? ' and is aria-invalid' : ''}`, `o campo o nomeia com aria-describedby ou aria-errormessage${trial?.invalid ? ' e está aria-invalid' : ''}`) : '',
  ]
  return parts.filter(Boolean).join('; ')
}

export function statusReviewMessage(verdict: StatusVerdict, locale: Locale): string {
  const quote = short(verdict.message.text, 120)
  return say(
    locale,
    `After the probe ${triggerText(verdict.trigger, locale)}, "${quote}" appeared without focus moving to it, and nothing exposes it as a status: no live region, no status, alert or log role. If it is a status message (the result of the action, a wait, progress, or an error), assistive technology is not told about it (WCAG 4.1.3; F103): put it in a container that is in the page before it changes, with role="status" (role="alert" for an error that needs attention at once) or aria-live="polite". Whether it is a status message needs a person, or the 4.1.3 judgment.`,
    `Depois que a sonda ${triggerText(verdict.trigger, locale)}, "${quote}" apareceu sem o foco ir até ele, e nada o expõe como status: nenhuma região ao vivo, nenhum papel status, alert ou log. Se é uma mensagem de status (o resultado da ação, uma espera, um progresso ou um erro), a tecnologia assistiva não é avisada (WCAG 4.1.3; F103): coloque-a num contêiner que já está na página antes de mudar, com role="status" (role="alert" para um erro que pede atenção imediata) ou aria-live="polite". Se é uma mensagem de status precisa de uma pessoa, ou do julgamento do 4.1.3.`,
  )
}

const SKIP_TEXT: Record<string, [string, string]> = {
  destructive: ['a destructive or account-changing name', 'um nome destrutivo ou que muda a conta'],
  submit: ['submits a form', 'envia um formulário'],
  'sensitive-form': ['in a form with password, payment or file fields', 'em formulário com senha, pagamento ou arquivo'],
  secret: ['a password or file field', 'campo de senha ou arquivo'],
  disabled: ['disabled', 'desabilitado'],
  'new-window': ['opens a new window', 'abre uma nova janela'],
  'other-origin': ['another origin', 'outra origem'],
  download: ['a download', 'um download'],
}

/** The B2 inventory (rules/browser-tree.ts): the live regions the snapshot exposes on load, and which of them the probe saw receive text. */
function inventoryNote(snapshot: A11ySnapshot, announced: StatusVerdicts['announced'], locale: Locale): string {
  const regions = liveRegions(snapshot.root).filter((node) => node.ax !== undefined && node.ax.ignored !== true)
  const received = [...new Map(announced.map((a) => [a.ref, a])).values()]
  const known = new Set(regions.map((r) => r.ref))
  const list = received
    .slice(0, 3)
    .map((a) => `${a.ref} ("${short(a.text, 40)}"${known.has(a.ref) ? '' : say(locale, ', not on load', ', não estava na carga')})`)
    .join(', ')
  if (regions.length === 0 && received.length === 0) return say(locale, 'no live region on load (rampa/live-regions) and none received text', 'nenhuma região ao vivo na carga (rampa/live-regions) e nenhuma recebeu texto')
  return say(
    locale,
    `${regions.length} live region(s) on load (rampa/live-regions); ${received.length} received text after a trigger${list ? `: ${list}` : ''}`,
    `${regions.length} região(ões) ao vivo na carga (rampa/live-regions); ${received.length} recebeu(eram) texto depois de um gatilho${list ? `: ${list}` : ''}`,
  )
}

/**
 * 4.1.3 Status Messages, over the status probe. Each text that appeared after a safe trigger goes through the F103
 * triage (see `triage`). What is exposed (a live region, a status, alert or log role, or a live region that received
 * the same words), what took focus, what sits in a dialog, what does not show and what is too large to be a message are
 * counted. What is left, new text with none of that, goes to review: only a person, or the 4.1.3 judgment
 * (criteria/status-messages.ts), can say whether it is a status message, and the judgment's verified answer settles the
 * item: a fail becomes its finding, with role="status" as the patch where the message's element was in the page on
 * load. The rule itself never fails anything.
 */
export const statusMessagesRule: ProbeRule = {
  id: STATUS_RULE,
  kind: 'status',
  variant: 'status-messages',
  versions: [STATUS_VERSION],
  criteria: ['4.1.3'],
  run(record: ProbeRecord, ctx: ProbeRuleContext) {
    const data = statusData(record)
    const loc = ctx.locale
    const { verdicts, applicable, unmatched, counts, announced, repeated } = statusVerdicts(data, ctx.index)
    const review: Finding[] = []
    for (const verdict of verdicts) {
      if (verdict.triage !== 'unexposed') continue
      review.push(
        probeFinding({
          criterion: '4.1.3',
          rule: this.id,
          node: verdict.node,
          message: statusReviewMessage(verdict, loc),
          evidence: evidenceOf(verdict, loc),
          confidence: 'low',
          subject: verdict.subject,
        }),
      )
    }
    const triggers = asArray<StatusTrigger>(data.triggers)
    const byKind = (kind: StatusTrigger['trigger']) => triggers.filter((t) => t.trigger === kind && t.trial && !t.trial.outcome).length
    const skipped = triggers.filter((t) => t.skip)
    const notExercised = triggers.filter((t) => t.trial?.outcome === 'not-exercised' || t.trial?.outcome === 'no-focus')
    const notTried = triggers.filter((t) => t.trial?.outcome === 'not-tried').length
    const found = Number(data.found) || 0
    const tried = Number(data.tried) || 0
    const exposedList = verdicts
      .filter((v) => v.triage === 'live' || v.triage === 'announced')
      .slice(0, 2)
      .map((v) => `"${short(v.message.text, 40)}"`)
      .join(', ')
    const notes = [
      say(
        loc,
        `${found} trigger(s) found, ${tried} tried, ${Number(data.loads) || 0} load(s): ${byKind('blur')} field(s) left after typing, ${byKind('search')} search(es), ${byKind('control')} control(s) clicked, ${byKind('setting')} setting(s) changed`,
        `${found} gatilho(s) encontrado(s), ${tried} tentado(s), ${Number(data.loads) || 0} carga(s): ${byKind('blur')} campo(s) deixado(s) depois de digitar, ${byKind('search')} busca(s), ${byKind('control')} controle(s) clicado(s), ${byKind('setting')} configuração(ões) mudada(s)`,
      ),
      say(
        loc,
        `${applicable} text(s) appeared after them: ${counts.live} in a live region or a status, alert or log role, ${counts.announced} said by a live region${exposedList ? ` (${exposedList})` : ''}, ${counts.focused} with focus, ${counts.dialog} in a dialog, ${counts.content} too large to be a message, ${counts.hidden} not showing, ${counts.unexposed} not exposed (to review)`,
        `${applicable} texto(s) apareceu(eram) depois deles: ${counts.live} numa região ao vivo ou com papel status, alert ou log, ${counts.announced} dito(s) por uma região ao vivo${exposedList ? ` (${exposedList})` : ''}, ${counts.focused} com foco, ${counts.dialog} num diálogo, ${counts.content} grande(s) demais para ser mensagem, ${counts.hidden} sem aparecer, ${counts.unexposed} não exposto(s) (para revisão)`,
      ),
      repeated > 0 ? say(loc, `${repeated} repeated the same text on the same element after another trigger, counted once`, `${repeated} repetiu(ram) o mesmo texto no mesmo elemento depois de outro gatilho, contado(s) uma vez`) : '',
      Number(data.alike) > 0 ? say(loc, `${Number(data.alike)} control(s) built like two others, not tried`, `${Number(data.alike)} controle(s) construído(s) como outros dois, não tentado(s)`) : '',
      inventoryNote(ctx.snapshot, announced, loc),
      skipped.length > 0
        ? `${say(loc, `${skipped.length} skipped`, `${skipped.length} pulado(s)`)}: ${skipped
            .slice(0, 3)
            .map((t) => `${controlName(t)} (${say(loc, ...(SKIP_TEXT[t.skip?.reason ?? ''] ?? [t.skip?.reason ?? '', t.skip?.reason ?? '']))}${t.skip?.reason === 'destructive' && t.skip.detail ? ` "${t.skip.detail}"` : ''})`)
            .join(', ')}${skipped.length > 3 ? ', …' : ''}`
        : '',
      notExercised.length > 0
        ? `${say(loc, `${notExercised.length} not exercised`, `${notExercised.length} não exercitado(s)`)}: ${notExercised
            .slice(0, 3)
            .map((t) => (t.trial?.cover ? `${controlName(t)} ${say(loc, 'under', 'sob')} <${t.trial.cover.tag}> "${short(t.trial.cover.text, 40)}"` : `${controlName(t)} (${t.trial?.reason ?? t.trial?.outcome})`))
            .join(', ')}`
        : '',
      notTried > 0 ? say(loc, `${notTried} not tried (${data.end === 'time' ? 'time budget' : 'budget'})`, `${notTried} não tentado(s) (${data.end === 'time' ? 'limite de tempo' : 'limite'})`) : '',
      say(loc, 'nothing was submitted: the search forms’ own submissions were cancelled, and navigations intercepted', 'nada foi enviado: os envios dos formulários de busca foram cancelados, e as navegações interceptadas'),
    ].filter(Boolean)
    const viewport = asRecord(data.viewport)
    const status: ProbeCoverage['status'] = review.length > 0 ? 'needs-review' : tried === 0 && found > 0 ? 'not-checked' : 'no-failure-found'
    const coverage: ProbeCoverage = {
      criterion: '4.1.3',
      method: `probe/status@${record.version}`,
      rule: this.id,
      conditions: conditionsText(
        record,
        say(
          loc,
          `fields left, searches and client-only controls, each on a fresh load at ${Number(viewport.width) || 0}×${Number(viewport.height) || 0}`,
          `campos deixados, buscas e controles só do lado do cliente, cada um numa carga nova em ${Number(viewport.width) || 0}×${Number(viewport.height) || 0}`,
        ),
      ),
      status,
      applicable,
      failures: 0,
      review: review.length,
      unmatched,
      note: notes.join('; '),
      maturity: 'experimental',
    }
    return { findings: [], review, coverage: [coverage] }
  },
}
