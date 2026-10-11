import type { Confidence, Finding, ProbeCoverage } from '../core/types.ts'
import type { Locale } from '../i18n.ts'
import { matchNode } from '../probes/identity.ts'
import {
  type Effect,
  type HoverMenu,
  type KeyAttempt,
  type MenuTrial,
  PARITY_VERSION,
  type ParityControl,
  type ParityData,
  type ParityVerdict,
  type TrapExit,
  effectEmpty,
  effectLines,
  parityData,
  parityRecord,
  parityVerdicts,
} from '../probes/parity.ts'
import type { A11ySnapshot, ProbeRecord } from '../snapshot/schema.ts'
import { exitText, walkOf } from './keyboard.ts'
import { type ProbeRule, type ProbeRuleContext, asArray, asRecord, conditionsText, moreNotListed, probeFinding, say } from './probes.ts'

export const PARITY_RULE = 'rampa/keyboard-parity'
export const HOVER_MENU_RULE = 'rampa/hover-menu'
export const TRAP_EXIT_RULE = 'rampa/trap-exit'

const MAX_REPORTED = 10

export { parityRecord, parityData }

/** A keyboard walk went round the same page: a control with a role that takes no focus is its finding (rampa/keyboard-reach). */
export function walkedRound(snapshot: A11ySnapshot): boolean {
  const record = snapshot.observations?.probes.find((r) => r.kind === 'keyboard' && r.conditions.variant === 'keyboard-walk' && r.status !== 'skipped')
  return record !== undefined && walkOf(record).end.forward === 'cycled'
}

const short = (text: string | undefined, n = 80) => {
  const value = (text ?? '').replace(/\s+/g, ' ').trim()
  return value.length > n ? `${value.slice(0, n - 1)}…` : value
}

/** What an effect did, in a few of its facts. */
export function effectSummary(effect: Effect | undefined, locale: Locale, n = 2): string {
  const lines = effectLines(effect, 'X', locale).map((line) => line.text)
  if (lines.length === 0) return say(locale, 'nothing', 'nada')
  return `${lines.slice(0, n).join('; ')}${lines.length > n ? '; …' : ''}`
}

/** "Enter: nothing", "ArrowRight ×2 from "One": never reached it", "Space: showed <div> "Panel"". */
export function attemptText(attempt: KeyAttempt, locale: Locale): string {
  const keys = attempt.pressed || attempt.path
  if (!attempt.focused) return say(locale, `${attempt.path}: it took no focus`, `${attempt.path}: ele não recebeu foco`)
  if (attempt.arrived === false) {
    return say(locale, `${keys} from "${short(attempt.from, 40)}": never reached it`, `${keys} a partir de "${short(attempt.from, 40)}": nunca chegou a ele`)
  }
  const what = effectEmpty(attempt.effect, attempt.path) ? say(locale, 'nothing', 'nada') : effectSummary(attempt.effect, locale)
  const from = attempt.from ? say(locale, ` from "${short(attempt.from, 40)}"`, ` a partir de "${short(attempt.from, 40)}"`) : ''
  return `${keys}${from}: ${what}`
}

const POINTER_ONLY = new Set(['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'touchend'])

function techniqueOf(control: ParityControl, result: ParityVerdict['result']): string {
  const listeners = asArray<string>(control.listeners)
  if (listeners.some((l) => POINTER_ONLY.has(l)) && !listeners.includes('click') && !listeners.some((l) => l.startsWith('key'))) return 'F54'
  if (result === 'unreachable' && (control.why === 'handler' || control.why === 'cursor')) return 'F42'
  return ''
}

function parityMessage(verdict: ParityVerdict, locale: Locale): string {
  const control = verdict.control
  const trial = control.trial
  const what = effectSummary(trial?.click, locale)
  const technique = techniqueOf(control, verdict.result)
  const wcag = `WCAG 2.1.1${technique ? `; ${technique}` : ''}`
  const keys = [...new Set(asArray<KeyAttempt>(trial?.keys).filter((k) => k.focused).map((k) => k.path.replace(/^arrive(, )?/, '').trim() || 'arrows'))]
  const keyList = keys.length > 0 ? keys.join(', ') : 'Enter, Space'
  if (verdict.status === 'review') {
    return say(
      locale,
      `Clicking this ${control.why === 'role' ? 'control' : 'element'} ${what}, and the keyboard (${keyList}) did not, on one load; it was not confirmed on a second load, so check it by hand.`,
      `Clicar neste ${control.why === 'role' ? 'controle' : 'elemento'} ${what}, e o teclado (${keyList}) não, numa carga; não foi confirmado numa segunda carga, então verifique à mão.`,
    )
  }
  switch (verdict.result) {
    case 'none':
      return say(
        locale,
        `Clicking this control ${what}, but ${keyList} on it ${keys.length > 1 ? 'do' : 'does'} nothing: someone who uses a keyboard cannot operate it (${wcag}). Make Enter and Space do what the click does (a native <button> does this by itself), and arrows where the widget's pattern uses them.`,
        `Clicar neste controle ${what}, mas ${keyList} nele não faz(em) nada: quem usa teclado não consegue operá-lo (${wcag}). Faça Enter e Espaço fazerem o que o clique faz (um <button> nativo já faz isso), e as setas onde o padrão do componente as usa.`,
      )
    case 'unreachable':
      if (control.widget) {
        return say(
          locale,
          `Clicking this item ${what}, but the keyboard cannot get to it: Tab does not reach it, and the arrow keys of its ${control.widget.role || 'widget'} do not move to it (${wcag}). Move focus between the items with the arrows (a roving tabindex), as the widget's pattern says.`,
          `Clicar neste item ${what}, mas o teclado não chega a ele: o Tab não o alcança, e as setas do seu ${control.widget.role || 'componente'} não vão até ele (${wcag}). Mova o foco entre os itens com as setas (tabindex móvel), como diz o padrão do componente.`,
        )
      }
      return say(
        locale,
        `Clicking this element ${what}, but it cannot take keyboard focus, so no key can operate it (${wcag}). Use a native control (a <button>, or a link with an href), or give it a role, tabindex="0" and key handlers.`,
        `Clicar neste elemento ${what}, mas ele não recebe foco do teclado, então nenhuma tecla consegue operá-lo (${wcag}). Use um controle nativo (um <button>, ou um link com href), ou dê a ele um role, tabindex="0" e tratadores de teclas.`,
      )
    case 'partial':
      return say(
        locale,
        `Clicking this control ${what}; the keyboard (${keyList}) does something else. Check that the keyboard reaches the same function (${wcag}): the 2.1.1 judgment clears this finding when the two effects are equivalent.`,
        `Clicar neste controle ${what}; o teclado (${keyList}) faz outra coisa. Confira se o teclado chega à mesma função (${wcag}): o julgamento do 2.1.1 retira este achado quando os dois efeitos são equivalentes.`,
      )
  }
}

function parityEvidence(verdict: ParityVerdict, locale: Locale): string {
  const control = verdict.control
  const trial = control.trial
  const tried = asArray<KeyAttempt>(trial?.keys)
  const keys = tried.length > 0 ? tried.map((k) => attemptText(k, locale)).join('; ') : say(locale, 'no key could be pressed', 'nenhuma tecla pôde ser pressionada')
  const tabbable = tried.find((k) => k.tabbable !== undefined)?.tabbable
  const parts = [
    say(locale, `keys, after focus: ${keys}`, `teclas, depois do foco: ${keys}`),
    tabbable === false && tried.some((k) => k.focused && k.arrived === undefined) ? say(locale, 'Tab does not reach it (tabindex below 0)', 'o Tab não chega a ele (tabindex abaixo de 0)') : '',
    say(locale, `then a click: ${effectSummary(trial?.click, locale, 3)}`, `depois um clique: ${effectSummary(trial?.click, locale, 3)}`),
    verdict.confirmed && verdict.result !== 'partial' ? say(locale, 'the same on a second fresh load', 'o mesmo numa segunda carga nova') : '',
    asArray<string>(control.listeners).length > 0 ? say(locale, `its own listeners: ${asArray<string>(control.listeners).join(', ')}`, `seus próprios ouvintes: ${asArray<string>(control.listeners).join(', ')}`) : '',
  ]
  return parts.filter(Boolean).join('; ')
}

const confidenceOf = (verdict: ParityVerdict): Confidence => (verdict.status === 'review' ? 'low' : verdict.result === 'partial' ? 'medium' : 'high')

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

const controlName = (control: Pick<ParityControl, 'tag' | 'role' | 'label'>) => `<${control.tag}${control.role && control.role !== 'generic' ? ` role=${control.role}` : ''}>${control.label ? ` "${short(control.label, 40)}"` : ''}`

const viewportOf = (data: Partial<ParityData>) => {
  const viewport = asRecord(data.viewport)
  return `${Number(viewport.width) || 0}×${Number(viewport.height) || 0}`
}

/**
 * 2.1.1, keys against the pointer (rule `rampa/keyboard-parity`). For each control whose keyboard support is the
 * page's own: when the click did something and no key the control's pattern uses did anything, on two fresh loads,
 * the control fails, high (F54 when it listens only to pointer events, F42 when it is an element with a click
 * listener and no role). When it takes no focus at all, the same. When the keys did something else, it fails at
 * medium, and the 2.1.1 judgment may clear it by showing the two effects equivalent. Once of two loads: review.
 * Not reported: a click that did nothing, keys that did what the click did, a click that went where a link Tab
 * reaches also goes, and a control with a role that takes no focus when a keyboard walk went round the page
 * (rampa/keyboard-reach reports it).
 */
export const keyboardParityRule: ProbeRule = {
  id: PARITY_RULE,
  kind: 'parity',
  variant: 'keyboard-parity',
  versions: [PARITY_VERSION],
  criteria: ['2.1.1'],
  run(record: ProbeRecord, ctx: ProbeRuleContext) {
    const data = parityData(record)
    const loc = ctx.locale
    const read = parityVerdicts(data, ctx.index, walkedRound(ctx.snapshot))
    const findings: Finding[] = []
    const review: Finding[] = []
    let failures = 0
    for (const verdict of read.verdicts) {
      const finding = probeFinding({
        criterion: '2.1.1',
        rule: this.id,
        node: verdict.node,
        message: parityMessage(verdict, loc),
        evidence: parityEvidence(verdict, loc),
        confidence: confidenceOf(verdict),
        subject: `parity|${verdict.result}`,
      })
      if (verdict.status === 'review') review.push(finding)
      else {
        failures++
        if (findings.length < MAX_REPORTED) findings.push(finding)
      }
    }
    const controls = asArray<ParityControl>(data.controls)
    const skipped = controls.filter((c) => c.skip)
    const notExercised = controls.filter((c) => c.trial?.outcome === 'not-exercised')
    const delegated = controls.filter((c) => c.trial?.outcome === 'delegates').length
    const notTried = controls.filter((c) => c.trial?.outcome === 'not-tried').length
    const notes = [
      say(
        loc,
        `${Number(data.found) || 0} control(s) whose keyboard support is the page's own, ${Number(data.tried) || 0} tried: keys first, then a click, on fresh loads`,
        `${Number(data.found) || 0} controle(s) cujo suporte a teclado é da própria página, ${Number(data.tried) || 0} testado(s): teclas primeiro, depois um clique, em cargas novas`,
      ),
      read.same > 0 ? say(loc, `${read.same} did the same with the keyboard`, `${read.same} fez(fizeram) o mesmo com o teclado`) : '',
      read.inert > 0 ? say(loc, `${read.inert} did nothing seen when clicked`, `${read.inert} não fez(fizeram) nada visível ao clicar`) : '',
      read.elsewhere > 0 ? say(loc, `${read.elsewhere} went where a link Tab reaches also goes`, `${read.elsewhere} foi(foram) aonde um link alcançado pelo Tab também vai`) : '',
      read.deferred > 0 ? say(loc, `${read.deferred} with a role that takes no focus, left to the keyboard walk`, `${read.deferred} com role que não recebe foco, deixado(s) para a navegação por teclado`) : '',
      delegated > 0 ? say(loc, `${delegated} where the click lands on a focusable element inside`, `${delegated} em que o clique cai num elemento focável dentro`) : '',
      skipped.length > 0
        ? `${say(loc, `${skipped.length} skipped`, `${skipped.length} pulado(s)`)}: ${skipped
            .slice(0, 4)
            .map((c) => `${controlName(c)} (${say(loc, ...(SKIP_TEXT[c.skip?.reason ?? ''] ?? [c.skip?.reason ?? '', c.skip?.reason ?? '']))}${c.skip?.reason === 'destructive' && c.skip.detail ? ` "${c.skip.detail}"` : ''})`)
            .join(', ')}${skipped.length > 4 ? ', …' : ''}`
        : '',
      notExercised.length > 0
        ? `${say(loc, `${notExercised.length} not exercised`, `${notExercised.length} não exercitado(s)`)}: ${notExercised
            .slice(0, 3)
            .map((c) => (c.trial?.cover ? `${controlName(c)} ${say(loc, 'under', 'sob')} <${c.trial.cover.tag}> "${short(c.trial.cover.text, 40)}"` : `${controlName(c)} (${c.trial?.reason ?? ''})`))
            .join(', ')}`
        : '',
      notTried > 0 ? say(loc, `${notTried} not tried (${data.end === 'time' ? 'time budget' : 'budget'})`, `${notTried} não testado(s) (${data.end === 'time' ? 'limite de tempo' : 'limite'})`) : '',
      data.listeners === null ? say(loc, 'listeners could not be read', 'os ouvintes não puderam ser lidos') : '',
      moreNotListed(loc, failures - findings.length),
    ].filter(Boolean)
    // Not checked: every control tried was under another layer or gone on its load.
    const tried = Number(data.tried) || 0
    const exercised = controls.filter((c) => c.trial && (!c.trial.outcome || c.trial.outcome === 'delegates')).length
    const status: ProbeCoverage['status'] = failures > 0 ? 'failures' : review.length > 0 ? 'needs-review' : tried > 0 && exercised === 0 ? 'not-checked' : 'no-failure-found'
    return {
      findings,
      review,
      coverage: [
        {
          criterion: '2.1.1',
          method: `probe/parity@${record.version}`,
          rule: this.id,
          conditions: conditionsText(record, say(loc, `keys against a click, each control on fresh loads at ${viewportOf(data)}`, `teclas contra um clique, cada controle em cargas novas em ${viewportOf(data)}`)),
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

/** What a hover menu's trial says: shown from the keyboard, its links elsewhere, or hover only. */
export function menuVerdict(trial: MenuTrial | undefined): 'keyboard' | 'elsewhere' | 'hover-only' | 'unconfirmed' | undefined {
  if (!trial || trial.outcome || !trial.hover) return undefined
  if (trial.revealedBy) return 'keyboard'
  if (asArray(trial.missing).length === 0) return 'elsewhere'
  const confirm = trial.confirm
  const again = confirm && !confirm.outcome && confirm.hover && !confirm.revealedBy && asArray(confirm.missing).length > 0
  return again ? 'hover-only' : 'unconfirmed'
}

/**
 * 2.1.1, hover menus (rule `rampa/hover-menu`). Links a page hides until a pointer hovers their trigger, which no key
 * showed (focus on the trigger, Tab from it, ArrowDown, Space, Enter) and whose addresses no link Tab reaches
 * elsewhere on the page has, on two fresh loads: failure, high; medium when the trigger is itself a link to another
 * page, which may list them. Once of two loads: review.
 */
export const hoverMenuRule: ProbeRule = {
  id: HOVER_MENU_RULE,
  kind: 'parity',
  variant: 'keyboard-parity',
  versions: [PARITY_VERSION],
  criteria: ['2.1.1'],
  run(record: ProbeRecord, ctx: ProbeRuleContext) {
    const data = parityData(record)
    const loc = ctx.locale
    const findings: Finding[] = []
    const review: Finding[] = []
    let applicable = 0
    let unmatched = 0
    let keyboard = 0
    let elsewhere = 0
    for (const menu of asArray<HoverMenu>(data.menus)) {
      const verdict = menuVerdict(menu?.trial)
      if (!verdict) continue
      const node = matchNode(ctx.index, menu.trigger?.ref, menu.trigger?.id)
      if (!node) {
        unmatched++
        continue
      }
      applicable++
      if (verdict === 'keyboard') {
        keyboard++
        continue
      }
      if (verdict === 'elsewhere') {
        elsewhere++
        continue
      }
      const trial = menu.trial as MenuTrial
      const missing = asArray<{ href: string; label: string }>(trial.missing)
      const list = missing
        .slice(0, 4)
        .map((link) => `"${short(link.label, 40)}"`)
        .join(', ')
      // A trigger that is a link to another page: that page may list the menu's links.
      const href = menu.focusable?.href ?? ''
      const linkPage = /^https?:/i.test(href) && href.replace(/#.*$/, '') !== ctx.snapshot.target.replace(/#.*$/, '')
      // Named by what shows of it: the snapshot's text of the trigger holds the hidden menu's too.
      const triggerName = `<${menu.trigger.tag}>${menu.trigger.label ? ` "${short(menu.trigger.label, 60)}"` : ''}`
      const message = say(
        loc,
        `Hovering ${triggerName} shows a menu of ${Number(menu.linkCount) || missing.length} link(s) (${list}${missing.length > 4 ? ', …' : ''}) that no key shows, and no link Tab reaches on the page goes to the same places: someone who uses a keyboard cannot reach them (WCAG 2.1.1). Show the menu on focus and from a button with aria-expanded, as a disclosure.${linkPage ? ' The trigger is a link: if the page it opens links them, check that it does.' : ''}`,
        `Passar o mouse sobre ${triggerName} mostra um menu de ${Number(menu.linkCount) || missing.length} link(s) (${list}${missing.length > 4 ? ', …' : ''}) que nenhuma tecla mostra, e nenhum link alcançado pelo Tab na página vai aos mesmos lugares: quem usa teclado não consegue chegar a eles (WCAG 2.1.1). Mostre o menu no foco e a partir de um botão com aria-expanded, como uma revelação.${linkPage ? ' O gatilho é um link: se a página que ele abre os lista, confira.' : ''}`,
      )
      const evidence = [
        say(loc, `hover showed ${menu.container?.tag ? `<${menu.container.tag}>` : 'the menu'}`, `o hover mostrou ${menu.container?.tag ? `<${menu.container.tag}>` : 'o menu'}`),
        trial.staysOpen ? say(loc, 'it stayed once the pointer left', 'ele ficou depois que o ponteiro saiu') : '',
        say(loc, `from the keyboard: ${asArray<string>(trial.tried).join(', ') || 'nothing could be tried'}; none showed it`, `pelo teclado: ${asArray<string>(trial.tried).join(', ') || 'nada pôde ser tentado'}; nenhum o mostrou`),
        say(loc, `${missing.length} of its link(s) not reached elsewhere: ${missing.slice(0, 3).map((l) => l.href).join(', ')}`, `${missing.length} de seus link(s) não alcançado(s) em outro lugar: ${missing.slice(0, 3).map((l) => l.href).join(', ')}`),
        verdict === 'hover-only' ? say(loc, 'the same on a second fresh load', 'o mesmo numa segunda carga nova') : say(loc, 'not confirmed on a second load', 'não confirmado numa segunda carga'),
      ]
        .filter(Boolean)
        .join('; ')
      const finding = probeFinding({ criterion: '2.1.1', rule: this.id, node, message, evidence, confidence: verdict === 'unconfirmed' ? 'low' : linkPage ? 'medium' : 'high', subject: `hover-menu|${menu.container?.ref ?? ''}` })
      ;(verdict === 'hover-only' ? findings : review).push(finding)
    }
    const found = Number(data.menusFound) || 0
    if (found === 0 && applicable === 0) return { findings, review, coverage: [] }
    const notes = [
      say(loc, `${found} menu(s) of hidden links found, ${applicable} shown by hover`, `${found} menu(s) de links ocultos encontrado(s), ${applicable} mostrado(s) pelo hover`),
      keyboard > 0 ? say(loc, `${keyboard} shown from the keyboard too`, `${keyboard} mostrado(s) também pelo teclado`) : '',
      elsewhere > 0 ? say(loc, `${elsewhere} whose links Tab reaches elsewhere`, `${elsewhere} cujos links o Tab alcança em outro lugar`) : '',
    ].filter(Boolean)
    // Hidden links that hover does not show either are no hover menu: nothing is missed from the keyboard there.
    const status: ProbeCoverage['status'] = findings.length > 0 ? 'failures' : review.length > 0 ? 'needs-review' : 'no-failure-found'
    return {
      findings,
      review,
      coverage: [
        {
          criterion: '2.1.1',
          method: `probe/parity@${record.version}`,
          rule: this.id,
          conditions: conditionsText(record, say(loc, `menus hovered, then tried from the keyboard, at ${viewportOf(data)}`, `menus com hover, depois testados pelo teclado, em ${viewportOf(data)}`)),
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

/** The keyboard walk has a trap with the same elements: rampa/keyboard-trap reports what the exit instruction did. */
function walkHasCycle(snapshot: A11ySnapshot, refs: readonly string[]): boolean {
  const record = snapshot.observations?.probes.find((r) => r.kind === 'keyboard' && r.conditions.variant === 'keyboard-walk' && r.status !== 'skipped')
  if (!record) return false
  const wanted = new Set(refs)
  return walkOf(record).traps.some((trap) => !trap.left && asArray<{ ref: string }>(trap.cycle).some((el) => wanted.has(el.ref)))
}

/**
 * 2.1.2, exit instructions executed (rule `rampa/trap-exit`). When a page's text names a key to leave a part of it,
 * the parity probe walks with Tab to a cycle focus cannot leave and presses the keys the text names inside it, twice:
 * focus still inside is a failure, high; focus out is no failure, and the coverage note says how it left. A cycle the
 * keyboard walk also found is left to rampa/keyboard-trap, which reads the same facts.
 */
export const trapExitRule: ProbeRule = {
  id: TRAP_EXIT_RULE,
  kind: 'parity',
  variant: 'keyboard-parity',
  versions: [PARITY_VERSION],
  criteria: ['2.1.2'],
  run(record: ProbeRecord, ctx: ProbeRuleContext) {
    const data = parityData(record)
    const loc = ctx.locale
    const findings: Finding[] = []
    const notes: string[] = []
    let applicable = 0
    let unmatched = 0
    let deferred = 0
    if (!data.exitText) return { findings, review: [], coverage: [] }
    for (const exit of asArray<TrapExit>(data.traps)) {
      const cycle = asArray<TrapExit['cycle'][number]>(exit?.cycle)
      if (cycle.length === 0) continue
      if (exit.escaped) {
        notes.push(say(loc, `focus cycled through ${cycle.length} element(s) and left with ${exit.escaped}`, `o foco circulou por ${cycle.length} elemento(s) e saiu com ${exit.escaped}`))
        continue
      }
      if (asArray(exit.keys).length === 0) {
        notes.push(say(loc, `a cycle of ${cycle.length} element(s) with no key named near it (rampa/keyboard-trap reports it)`, `um ciclo de ${cycle.length} elemento(s) sem tecla indicada perto (rampa/keyboard-trap o relata)`))
        continue
      }
      if (walkHasCycle(ctx.snapshot, cycle.map((el) => el.ref))) {
        deferred++
        notes.push(say(loc, 'the keyboard walk found the same cycle: rampa/keyboard-trap reports it', 'a navegação por teclado achou o mesmo ciclo: rampa/keyboard-trap o relata'))
        continue
      }
      applicable++
      if (exit.left) {
        notes.push(say(loc, `the page's exit instruction ("${short(exit.hint, 60)}") worked: focus left with ${exit.leftWith ?? ''}`, `a instrução de saída da página ("${short(exit.hint, 60)}") funcionou: o foco saiu com ${exit.leftWith ?? ''}`))
        continue
      }
      const first = cycle.map((el) => matchNode(ctx.index, el.ref, el.id)).find((node) => node !== undefined)
      if (!first) {
        unmatched++
        continue
      }
      const text = exitText(exit, loc)
      findings.push(probeFinding({ criterion: '2.1.2', rule: this.id, node: first, message: text.message, evidence: text.evidence, confidence: 'high', subject: 'trap-exit' }))
    }
    // Every cycle left to the keyboard walk's rule: this method decided nothing.
    const status: ProbeCoverage['status'] = findings.length > 0 ? 'failures' : deferred > 0 && applicable === 0 ? 'not-checked' : 'no-failure-found'
    return {
      findings,
      review: [],
      coverage: [
        {
          criterion: '2.1.2',
          method: `probe/parity@${record.version}`,
          rule: this.id,
          conditions: conditionsText(record, say(loc, `exit instructions pressed inside a cycle of Tab stops at ${viewportOf(data)}`, `instruções de saída pressionadas dentro de um ciclo de paradas do Tab em ${viewportOf(data)}`)),
          status,
          applicable,
          failures: findings.length,
          review: 0,
          unmatched,
          ...(notes.length > 0 ? { note: notes.join('; ') } : asArray(data.traps).length === 0 ? { note: say(loc, 'the page names a key to leave, and the Tab walk found no cycle', 'a página indica uma tecla para sair, e a navegação pelo Tab não achou ciclo') } : {}),
          maturity: 'experimental',
        },
      ],
    }
  },
}

export const PARITY_RULES: readonly ProbeRule[] = [keyboardParityRule, hoverMenuRule, trapExitRule]
