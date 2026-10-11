import type { Confidence, Finding, ProbeCoverage } from '../core/types.ts'
import type { Locale } from '../i18n.ts'
import { matchNode } from '../probes/identity.ts'
import { type ExposedState, TOGGLES_VERSION, type ToggleCandidate, type ToggleReading, type TogglesData, type ToggleState, type ToggleTrial, readTrial } from '../probes/toggles.ts'
import type { A11yNode, ProbeRecord } from '../snapshot/schema.ts'
import type { TreeIndex } from '../snapshot/tree.ts'
import { type ProbeRule, type ProbeRuleContext, asArray, asRecord, conditionsText, probeFinding, say } from './probes.ts'

export const STATE_EXPOSURE_RULE = 'rampa/state-exposure'

/** The toggles probe's record, when it is one the rule reads. */
export function togglesRecord(records: readonly ProbeRecord[] | undefined): ProbeRecord | undefined {
  return records?.find((r) => r.kind === 'toggles' && r.version === TOGGLES_VERSION && r.status !== 'skipped')
}

export function togglesData(record: ProbeRecord): Partial<TogglesData> {
  return asRecord(record.data) as Partial<TogglesData>
}

const short = (text: string | undefined, n = 80) => {
  const value = (text ?? '').replace(/\s+/g, ' ').trim()
  return value.length > n ? `${value.slice(0, n - 1)}…` : value
}

/** `<button> "Details"`, `<div role=switch> "Dark mode"`. */
export function toggleName(candidate: Pick<ToggleCandidate, 'tag' | 'declared' | 'label'>): string {
  const role = candidate.declared?.role ? ` role=${candidate.declared.role}` : ''
  return `<${candidate.tag}${role}>${candidate.label ? ` "${short(candidate.label, 60)}"` : ''}`
}

export interface ToggleVerdict {
  candidate: ToggleCandidate
  node: A11yNode
  reading: ToggleReading
  /** failure: it happened again on a second fresh load; review: it did not, or was not tried again. */
  result: 'failure' | 'review'
  why?: 'once' | 'unconfirmed' | undefined
  /** What changed to the eye: content shown or hidden, the look of most of the window (a theme, a contrast mode), or only the control's own look. */
  scope: ChangeScope
}

export type ChangeScope = 'content' | 'page' | 'own'

/** Share of the window whose pixels changed, at which a change is the page's look (a theme), not content shown. */
const PAGE_SHARE = 0.6

/** What a trial's change was to the eye, from its signals and where its pixels changed. */
export function changeScope(reading: ToggleReading, trial: Omit<ToggleTrial, 'confirm'>, viewport: { width: number; height: number }): ChangeScope {
  if (reading.signals.some((s) => s === 'text' || s === 'layer' || s === 'region')) return 'content'
  if (!reading.signals.includes('pixels')) return 'own'
  const box = trial.pixels?.outside[0]?.bbox
  const area = Math.max(1, viewport.width * viewport.height)
  return box && (box.width * box.height) / area >= PAGE_SHARE ? 'page' : 'content'
}

export interface ToggleVerdicts {
  verdicts: ToggleVerdict[]
  /** Controls clicked whose facts match the snapshot. */
  applicable: number
  unmatched: number
  /** Toggles whose change on screen came with a change of what the browser exposes. */
  exposed: Array<{ candidate: ToggleCandidate; reading: ToggleReading }>
  /** A change that did not go back: an action, not a toggle. */
  oneWay: number
  /** Nothing changed on screen. */
  none: number
}

/** 4.1.2's reading of the toggles probe's facts. */
export function toggleVerdicts(data: Partial<TogglesData>, index: TreeIndex): ToggleVerdicts {
  const result: ToggleVerdicts = { verdicts: [], applicable: 0, unmatched: 0, exposed: [], oneWay: 0, none: 0 }
  const viewport = { width: Number(asRecord(data.viewport).width) || 1280, height: Number(asRecord(data.viewport).height) || 800 }
  for (const candidate of asArray<ToggleCandidate>(data.candidates)) {
    const trial = candidate?.trial
    if (!trial || trial.outcome || !trial.before) continue
    const node = matchNode(index, candidate.ref, candidate.id)
    if (!node) {
      result.unmatched++
      continue
    }
    result.applicable++
    const reading = readTrial(candidate, trial)
    if (reading.verdict === 'pass') result.exposed.push({ candidate, reading })
    else if (reading.kind === 'one-way') result.oneWay++
    else if (reading.kind === 'none') result.none++
    if (reading.verdict !== 'fail') continue
    if (!trial.confirm || trial.confirm.outcome || !trial.confirm.before) {
      result.verdicts.push({ candidate, node, reading, result: 'review', why: 'unconfirmed', scope: changeScope(reading, trial, viewport) })
      continue
    }
    const scope = changeScope(reading, trial, viewport)
    const again = readTrial(candidate, trial.confirm)
    result.verdicts.push(again.verdict === 'fail' ? { candidate, node, reading, result: 'failure', scope } : { candidate, node, reading, result: 'review', why: 'once', scope })
  }
  return result
}

/** How the browser exposed the control in one state: `button "Details", expanded false`. */
export function exposedText(state: ExposedState | null | undefined, locale: Locale): string {
  if (!state) return say(locale, 'no node in the browser’s tree', 'nenhum nó na árvore do navegador')
  if (state.ignored) return say(locale, 'ignored by the browser', 'ignorado pelo navegador')
  const parts = [`${state.role}${state.name ? ` "${short(state.name, 50)}"` : ''}`]
  for (const key of ['expanded', 'selected', 'checked', 'pressed'] as const) if (state[key] !== undefined) parts.push(`${key} ${String(state[key])}`)
  if (parts.length === 1) parts.push(say(locale, 'no state', 'sem estado'))
  return parts.join(', ')
}

/** What changed on screen, in a few words. */
function shownText(reading: ToggleReading, trial: Omit<ToggleTrial, 'confirm'>, locale: Locale): string {
  const first = trial.after?.[0]
  const parts: string[] = []
  if (reading.signals.includes('text') && first) {
    const lines = [...first.text.added.map((l) => `+"${short(l, 50)}"`), ...first.text.removed.map((l) => `−"${short(l, 50)}"`)].slice(0, 2).join(', ')
    parts.push(say(locale, `text came or went (${first.text.changed} characters: ${lines})`, `texto apareceu ou sumiu (${first.text.changed} caracteres: ${lines})`))
  }
  if (reading.signals.includes('layer')) {
    const name = trial.watches?.[0]?.opened?.name
    parts.push(say(locale, `a layer opened${name ? ` ("${short(name, 40)}")` : ''}`, `uma camada abriu${name ? ` ("${short(name, 40)}")` : ''}`))
  }
  if (reading.signals.includes('region')) parts.push(say(locale, 'what its aria-controls names showed or hid', 'o que seu aria-controls nomeia apareceu ou sumiu'))
  if (reading.signals.includes('pixels')) {
    const change = trial.pixels?.outside[0]
    const box = change?.bbox
    parts.push(
      say(
        locale,
        `${change?.noticeable ?? 0} pixels changed outside it${box ? ` (in ${box.width}×${box.height} at ${box.x},${box.y})` : ''}`,
        `${change?.noticeable ?? 0} pixels mudaram fora dele${box ? ` (em ${box.width}×${box.height} em ${box.x},${box.y})` : ''}`,
      ),
    )
  }
  if (reading.signals.includes('control')) {
    parts.push(say(locale, `its own look changed (${trial.pixels?.control[0]?.noticeable ?? 0} pixels between the first and the second click)`, `sua própria aparência mudou (${trial.pixels?.control[0]?.noticeable ?? 0} pixels entre o primeiro e o segundo clique)`))
  }
  return parts.join('; ')
}

function statesText(trial: Omit<ToggleTrial, 'confirm'>, locale: Locale): string {
  const states: Array<[string, ToggleState | undefined]> = [
    [say(locale, 'before', 'antes'), trial.before],
    ...(trial.after ?? []).map((state, i): [string, ToggleState] => [say(locale, `after click ${i + 1}`, `depois do clique ${i + 1}`), state]),
  ]
  return states
    .filter(([, state]) => state)
    .map(([when, state]) => `${when}: ${exposedText(state?.ax[0], locale)}`)
    .join('; ')
}

function evidenceOf(verdict: ToggleVerdict, locale: Locale): string {
  const trial = verdict.candidate.trial as ToggleTrial
  const clicks = trial.after?.length ?? 0
  const shots = [trial.before?.shot, ...(trial.after ?? []).map((s) => s.shot)].filter(Boolean)
  const back =
    verdict.reading.kind === 'two-state'
      ? say(locale, 'back as it was after the next click', 'de volta como estava depois do clique seguinte')
      : verdict.reading.kind === 'declared'
        ? say(locale, `not clicked again (${trial.stopped ?? 'it did not go back'})`, `não clicado de novo (${trial.stopped ?? 'não voltou'})`)
        : ''
  const parts = [
    say(locale, `clicked ${clicks} time(s) at ${trial.point?.x},${trial.point?.y}`, `clicado ${clicks} vez(es) em ${trial.point?.x},${trial.point?.y}`),
    shownText(verdict.reading, trial, locale),
    back,
    say(locale, `exposed ${statesText(trial, locale)}`, `exposto ${statesText(trial, locale)}`),
    shots.length > 0 ? say(locale, `captures ${shots.join(', ')}`, `capturas ${shots.join(', ')}`) : '',
    verdict.result === 'failure'
      ? say(locale, 'the same on a second fresh load', 'o mesmo numa segunda carga nova')
      : verdict.why === 'once'
        ? say(locale, 'not the same on a second fresh load', 'não o mesmo numa segunda carga nova')
        : '',
  ]
  return parts.filter(Boolean).join('; ')
}

/** A button, a link or an element with either role: one that can carry aria-expanded as it is. */
function buttonish(candidate: Pick<ToggleCandidate, 'tag' | 'declared'>): boolean {
  const role = candidate.declared.role
  if (role) return role === 'button' || role === 'link'
  return candidate.tag === 'button' || candidate.tag === 'a'
}

/** The role the attribute needs, when the control has none that takes it: aria-pressed only on a button, aria-checked on a switch or checkbox. */
function fixRole(candidate: Pick<ToggleCandidate, 'tag' | 'declared'>, attribute: string, locale: Locale): string {
  const role = candidate.declared.role
  if (role) return ''
  if (attribute === 'aria-checked') return say(locale, ', with role="switch" or role="checkbox"', ', com role="switch" ou role="checkbox"')
  const fits = attribute === 'aria-pressed' ? candidate.tag === 'button' : candidate.tag === 'button' || candidate.tag === 'a'
  return fits ? '' : say(locale, ', on a button (or role="button")', ', num botão (ou role="button")')
}

/** The attribute the fix needs: the one the control declares, else the one its kind of change asks for. */
function fixAttribute(candidate: ToggleCandidate, scope: ChangeScope): string {
  const declared = candidate.declared.states.find((s) => s !== 'aria-selected' || candidate.mode === 'select')
  if (declared) return declared
  if (candidate.mode === 'select') return candidate.declared.role === 'radio' || candidate.declared.role === 'menuitemradio' ? 'aria-checked' : 'aria-selected'
  if (['checkbox', 'switch', 'menuitemcheckbox'].includes(candidate.declared.role ?? '')) return 'aria-checked'
  if (scope === 'content') return 'aria-expanded'
  // The page's look (a theme) or only its own flips: a button is a toggle button; another element a checkbox or a switch.
  return buttonish(candidate) || scope === 'page' ? 'aria-pressed' : 'aria-checked'
}

export function stateExposureMessage(verdict: ToggleVerdict, locale: Locale): string {
  const { candidate, reading } = verdict
  const name = toggleName(candidate)
  const attribute = fixAttribute(candidate, verdict.scope)
  const trial = candidate.trial as ToggleTrial
  const before = exposedText(trial.before?.ax[0], locale)
  const what =
    candidate.mode === 'select'
      ? say(locale, 'chooses it and changes what the page shows', 'o escolhe e muda o que a página mostra')
      : verdict.scope === 'content'
        ? reading.kind === 'declared'
          ? say(locale, 'shows content', 'mostra conteúdo')
          : say(locale, 'shows or hides content, and the next click puts it back', 'mostra ou esconde conteúdo, e o clique seguinte o devolve')
        : verdict.scope === 'page'
          ? say(locale, 'changes the look of the whole page, and the next click puts it back', 'muda a aparência da página inteira, e o clique seguinte a devolve')
          : say(locale, 'flips its look between two states', 'alterna sua aparência entre dois estados')
  const how =
    reading.why === 'stuck'
      ? say(locale, `the state the browser exposes does not follow: it changed with the first click (${reading.exposed[0]}), and not back when the second click put the page back`, `o estado que o navegador expõe não acompanha: mudou com o primeiro clique (${reading.exposed[0]}), e não voltou quando o segundo clique devolveu a página`)
      : reading.why === 'stale'
        ? say(locale, `the browser exposes the same state before and after (${before}): the ${attribute} it declares is never updated`, `o navegador expõe o mesmo estado antes e depois (${before}): o ${attribute} que ele declara nunca é atualizado`)
        : say(locale, `the browser exposes no state for it, before or after (${before})`, `o navegador não expõe estado nenhum para ele, antes ou depois (${before})`)
  const fix =
    candidate.mode === 'select'
      ? say(
          locale,
          `Mark the chosen item with ${attribute}="true" (and the others "false") as it is chosen, in a role that has that state (tab in a tablist, radio in a radiogroup).`,
          `Marque o item escolhido com ${attribute}="true" (e os outros "false") quando ele é escolhido, num papel que tenha esse estado (tab numa tablist, radio num radiogroup).`,
        )
      : say(
          locale,
          `Set ${attribute} to "true" and "false" as the state changes${fixRole(candidate, attribute, locale)}, or change its name to say the state.`,
          `Mude ${attribute} para "true" e "false" conforme o estado muda${fixRole(candidate, attribute, locale)}, ou mude o nome dele para dizer o estado.`,
        )
  const review =
    verdict.result === 'review'
      ? verdict.why === 'once'
        ? say(locale, ' It did not happen again on a second fresh load: check it by hand.', ' Não aconteceu de novo numa segunda carga nova: verifique à mão.')
        : say(locale, ' It was not tried again on a second load (budget): check it by hand.', ' Não foi tentado de novo numa segunda carga (limite): verifique à mão.')
      : ''
  return say(
    locale,
    `Clicking ${name} ${what}, but ${how}: a screen reader does not say what changed (WCAG 4.1.2, the state of a control). ${fix}${review}`,
    `Clicar em ${name} ${what}, mas ${how}: o leitor de tela não diz o que mudou (WCAG 4.1.2, o estado de um controle). ${fix}${review}`,
  )
}

/** Confidence of a failure: a declared state never updated is plain; one never declared, or not changed back, less so. */
function confidenceOf(reading: ToggleReading): Confidence {
  return reading.why === 'stale' ? 'high' : 'medium'
}

const SKIP_TEXT: Record<string, [string, string]> = {
  destructive: ['a destructive or account-changing name', 'um nome destrutivo ou que muda a conta'],
  submit: ['submits a form', 'envia um formulário'],
  'sensitive-form': ['in a form with password, payment or file fields', 'em formulário com senha, pagamento ou arquivo'],
  download: ['a download', 'um download'],
  'new-window': ['opens a new window', 'abre uma nova janela'],
  'other-origin': ['another origin', 'outra origem'],
  disabled: ['disabled', 'desabilitado'],
}

/**
 * 4.1.2 Name, Role, Value: the state of a control. A toggle-like control whose click changes what shows (content that
 * came or went, a layer, what its aria-controls names, pixels outside it, all back as before after a second click), or
 * flips its own look between two states, while what the browser exposes for it (its expanded, selected, checked and
 * pressed states, its name and value) stays the same, fails, confirmed on a second fresh load: high when it declares
 * the state and never updates it, medium when it declares none or changes it once and never back. A tab or radio that
 * changes the content when chosen, with no selected or checked state changing in its group, fails the same way. Once of
 * two loads, or not tried again, goes to review. What does not go back is an action, not a toggle, and is not reported.
 */
export const stateExposureRule: ProbeRule = {
  id: STATE_EXPOSURE_RULE,
  kind: 'toggles',
  variant: 'state-exposure',
  versions: [TOGGLES_VERSION],
  criteria: ['4.1.2'],
  run(record: ProbeRecord, ctx: ProbeRuleContext) {
    const data = togglesData(record)
    const loc = ctx.locale
    const { verdicts, applicable, unmatched, exposed, oneWay, none } = toggleVerdicts(data, ctx.index)
    const findings: Finding[] = []
    const review: Finding[] = []
    for (const verdict of verdicts) {
      const finding = probeFinding({
        criterion: '4.1.2',
        rule: this.id,
        node: verdict.node,
        message: stateExposureMessage(verdict, loc),
        evidence: evidenceOf(verdict, loc),
        confidence: verdict.result === 'failure' ? confidenceOf(verdict.reading) : 'low',
        subject: `${verdict.candidate.mode}|${verdict.reading.why ?? ''}`,
      })
      ;(verdict.result === 'failure' ? findings : review).push(finding)
    }
    const candidates = asArray<ToggleCandidate>(data.candidates)
    const skipped = candidates.filter((c) => c.skip)
    const notExercised = candidates.filter((c) => c.trial?.outcome === 'not-exercised')
    const notTried = candidates.filter((c) => c.trial?.outcome === 'not-tried').length
    const alike = candidates.filter((c) => c.alike && !c.skip).length
    const found = Number(data.found) || 0
    const tried = Number(data.tried) || 0
    const exposedList = exposed
      .slice(0, 3)
      .map(({ candidate, reading }) => `${toggleName(candidate)} (${reading.exposed[0] ?? reading.exposed[1]})`)
      .join(', ')
    const notes = [
      say(loc, `${found} toggle-like control(s) found (a group of tabs once), ${tried} clicked, ${Number(data.loads) || 0} load(s)`, `${found} controle(s) do tipo alternância encontrado(s) (um grupo de abas uma vez), ${tried} clicado(s), ${Number(data.loads) || 0} carga(s)`),
      exposed.length > 0
        ? say(loc, `${exposed.length} changed what shows and what the browser exposes: ${exposedList}${exposed.length > 3 ? ', …' : ''}`, `${exposed.length} mudou(aram) o que aparece e o que o navegador expõe: ${exposedList}${exposed.length > 3 ? ', …' : ''}`)
        : '',
      oneWay > 0 ? say(loc, `${oneWay} did something that did not go back (an action, not a toggle)`, `${oneWay} fez(fizeram) algo que não voltou (uma ação, não uma alternância)`) : '',
      none > 0 ? say(loc, `${none} showed no change`, `${none} não mostrou(aram) mudança`) : '',
      skipped.length > 0
        ? `${say(loc, `${skipped.length} skipped`, `${skipped.length} pulado(s)`)}: ${skipped
            .slice(0, 3)
            .map((c) => `${toggleName(c)} (${say(loc, ...(SKIP_TEXT[c.skip?.reason ?? ''] ?? [c.skip?.reason ?? '', c.skip?.reason ?? '']))}${c.skip?.reason === 'destructive' && c.skip.detail ? ` "${c.skip.detail}"` : ''})`)
            .join(', ')}${skipped.length > 3 ? ', …' : ''}`
        : '',
      notExercised.length > 0
        ? `${say(loc, `${notExercised.length} not exercised`, `${notExercised.length} não exercitado(s)`)}: ${notExercised
            .slice(0, 3)
            .map((c) => (c.trial?.cover ? `${toggleName(c)} ${say(loc, 'under', 'sob')} <${c.trial.cover.tag}> "${short(c.trial.cover.text, 40)}"` : `${toggleName(c)} (${c.trial?.reason ?? ''})`))
            .join(', ')}`
        : '',
      alike > 0 ? say(loc, `${alike} built like others already tried, not clicked`, `${alike} construído(s) como outros já tentados, não clicado(s)`) : '',
      notTried > 0 ? say(loc, `${notTried} not tried (${data.end === 'time' ? 'time budget' : 'budget'})`, `${notTried} não tentado(s) (${data.end === 'time' ? 'limite de tempo' : 'limite'})`) : '',
      say(loc, 'nothing was submitted; navigations were intercepted', 'nada foi enviado; navegações foram interceptadas'),
    ].filter(Boolean)
    const viewport = asRecord(data.viewport)
    const status: ProbeCoverage['status'] =
      findings.length > 0 ? 'failures' : review.length > 0 ? 'needs-review' : applicable === 0 && found > 0 ? 'not-checked' : 'no-failure-found'
    const coverage: ProbeCoverage = {
      criterion: '4.1.2',
      method: `probe/toggles@${record.version}`,
      rule: this.id,
      conditions: conditionsText(
        record,
        say(
          loc,
          `toggle-like controls clicked, the browser's accessibility tree read before and after, at ${Number(viewport.width) || 0}×${Number(viewport.height) || 0}`,
          `controles do tipo alternância clicados, a árvore de acessibilidade do navegador lida antes e depois, em ${Number(viewport.width) || 0}×${Number(viewport.height) || 0}`,
        ),
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
