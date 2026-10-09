import type { Finding, ProbeCoverage } from '../core/types.ts'
import type { Locale } from '../i18n.ts'
import { matchNode, nameOf } from '../probes/identity.ts'
import type { Control, KeyEvent, KeyStop, TrapAttempt } from '../probes/keyboard.ts'
import type { ProbeRecord } from '../snapshot/schema.ts'
import { type ProbeRule, type ProbeRuleContext, asArray, asRecord, conditionsText, coverageStatus, probeFinding } from './probes.ts'

const MAX_REPORTED = 10
export const KEYBOARD_VERSIONS = ['1', '2'] as const

export interface Walk {
  forward: KeyStop[]
  backward: KeyStop[]
  end: { forward: string; backward: string }
  inventory: Control[]
  idle: KeyEvent[]
  idleMs: number
  traps: TrapAttempt[]
  viewport: { width: number; height: number }
}

/** Reads the walk back from a record: a snapshot is input, so every list is checked. */
export function walkOf(record: ProbeRecord): Walk {
  const data = asRecord(record.data)
  const end = asRecord(data.end)
  const stops = (value: unknown) => asArray<KeyStop>(value).filter((stop) => stop && typeof stop.n === 'number' && (stop.el === null || typeof stop.el?.ref === 'string'))
  const viewport = asRecord(data.viewport)
  return {
    forward: stops(data.forward),
    backward: stops(data.backward),
    end: { forward: String(end.forward ?? ''), backward: String(end.backward ?? '') },
    inventory: asArray<Control>(data.inventory).filter((control) => typeof control?.ref === 'string'),
    idle: asArray<KeyEvent>(data.idle).filter((event) => typeof event?.type === 'string'),
    idleMs: Number(data.idleMs) || 0,
    traps: asArray<TrapAttempt>(data.traps).filter((trap) => Array.isArray(trap?.cycle)),
    viewport: { width: Number(viewport.width) || 0, height: Number(viewport.height) || 0 },
  }
}

function coverageFor(criterion: string, rule: string, record: ProbeRecord, what: string, counts: { applicable: number; failures: number; review: number; unmatched: number }, note?: string): ProbeCoverage {
  return {
    criterion,
    method: `probe/keyboard@${record.version}`,
    rule,
    conditions: conditionsText(record, what),
    status: coverageStatus(counts.failures, counts.review),
    ...counts,
    ...(note ? { note } : {}),
    maturity: 'experimental',
  }
}

function notChecked(criterion: string, rule: string, record: ProbeRecord, what: string, note: string): ProbeCoverage {
  return { ...coverageFor(criterion, rule, record, what, { applicable: 0, failures: 0, review: 0, unmatched: 0 }, note), status: 'not-checked' }
}

const walkText = (walk: Walk) =>
  `Tab ×${walk.forward.length} forward${walk.backward.length > 0 ? ` and Shift+Tab ×${walk.backward.length} backward` : ''}`

const viewportText = (walk: Walk) => `keyboard walk at ${walk.viewport.width}×${walk.viewport.height}`

const REACH_TEXT: Record<Locale, { message: string; widget: string }> = {
  en: {
    message: 'The keyboard walk never reached this control with Tab or Shift+Tab: someone who uses a keyboard cannot operate it.',
    widget: 'The keyboard walk never reached this widget or any of its items with Tab or Shift+Tab: someone who uses a keyboard cannot operate it.',
  },
  'pt-BR': {
    message: 'A navegação por teclado nunca chegou a este controle com Tab ou Shift+Tab: quem usa teclado não consegue operá-lo.',
    widget: 'A navegação por teclado nunca chegou a este componente nem a seus itens com Tab ou Shift+Tab: quem usa teclado não consegue operá-lo.',
  },
}

const NATIVE_FOCUSABLE = new Set(['a', 'area', 'button', 'input', 'select', 'textarea', 'summary', 'iframe'])

/**
 * 2.1.1 Keyboard. A visible, enabled native control or explicit widget role, not inert, hidden
 * or clipped out of view, that neither walk reached. Left out: items of a composite widget
 * that was reached (roving tabindex, aria-activedescendant), radios of a group that was
 * reached, links whose address a reached link has, and controls that hold a reached element.
 * Reported only when the walk went once round the page.
 */
export const keyboardReachRule: ProbeRule = {
  id: 'rampa/keyboard-reach',
  kind: 'keyboard',
  variant: 'keyboard-walk',
  versions: KEYBOARD_VERSIONS,
  criteria: ['2.1.1'],
  run(record, ctx) {
    const walk = walkOf(record)
    const what = viewportText(walk)
    if (walk.end.forward !== 'cycled') {
      return { findings: [], review: [], coverage: [notChecked('2.1.1', this.id, record, what, `the walk did not go round the page (${walk.end.forward}), so what it missed is unknown`)] }
    }
    const stops = [...walk.forward, ...walk.backward].filter((stop) => stop.el)
    const reached = new Set(stops.map((stop) => stop.el?.ref))
    const widgets = new Set(stops.flatMap((stop) => (stop.widget ? [stop.widget] : [])))
    const hrefs = new Set(stops.flatMap((stop) => (stop.href ? [stop.href] : [])))
    const radios = new Set(stops.flatMap((stop) => (stop.radioGroup ? [stop.radioGroup] : [])))
    const flaggedWidgets = new Set<string>()
    const text = REACH_TEXT[ctx.locale]
    const findings: Finding[] = []
    let failures = 0
    let unmatched = 0
    for (const control of walk.inventory) {
      if (reached.has(control.ref) || control.holdsReached || control.shadow) continue
      if (control.widget && (widgets.has(control.widget) || reached.has(control.widget))) continue
      if (control.radioGroup && radios.has(control.radioGroup)) continue
      if (control.href && hrefs.has(control.href)) continue
      if (control.widget) {
        if (flaggedWidgets.has(control.widget)) continue
        flaggedWidgets.add(control.widget)
      }
      const node = matchNode(ctx.index, control.ref, control.id)
      if (!node) {
        unmatched++
        continue
      }
      const negative = control.tabindex !== undefined && control.tabindex < 0
      const why = negative
        ? `it has tabindex="${control.tabindex}", which takes it out of the Tab order`
        : NATIVE_FOCUSABLE.has(control.tag)
          ? 'it is a native control that never took focus'
          : `it has role="${control.role}" and no tabindex, so it cannot take focus`
      failures++
      if (findings.length >= MAX_REPORTED) continue
      findings.push(
        probeFinding({
          criterion: '2.1.1',
          rule: this.id,
          node,
          message: control.widget ? text.widget : text.message,
          evidence: `${walkText(walk)} reached ${reached.size} element(s), never ${nameOf(node, control)}; ${why}`,
          // A negative tabindex is often a duplicate of a link that is reached by another address, which the walk cannot see.
          confidence: negative ? 'medium' : 'high',
          subject: 'unreached',
        }),
      )
    }
    const hidden = failures - findings.length
    return {
      findings,
      review: [],
      coverage: [coverageFor('2.1.1', this.id, record, what, { applicable: walk.inventory.length, failures, review: 0, unmatched }, hidden > 0 ? `${hidden} more failure(s) not listed` : undefined)],
    }
  },
}

const TRAP_TEXT: Record<Locale, { trap: string; dialog: string; hint: string }> = {
  en: {
    trap: 'Keyboard focus cannot leave this group of elements: Tab, Shift+Tab, Esc and the arrow keys all keep it inside.',
    dialog: 'Focus stays inside this dialog, and Esc does not close it. That is fine when a control inside closes it from the keyboard; check that one does.',
    hint: 'Focus cannot leave this group of elements with Tab, Shift+Tab, Esc or the arrows, but nearby text names a way out. Check that it works.',
  },
  'pt-BR': {
    trap: 'O foco do teclado não consegue sair deste grupo de elementos: Tab, Shift+Tab, Esc e as setas o mantêm dentro.',
    dialog: 'O foco fica preso neste diálogo, e Esc não o fecha. Tudo bem se um controle dentro dele o fecha pelo teclado; confira se algum fecha.',
    hint: 'O foco não sai deste grupo de elementos com Tab, Shift+Tab, Esc ou as setas, mas um texto próximo indica uma saída. Confira se ela funciona.',
  },
}

/**
 * 2.1.2 No Keyboard Trap (ACT 80af7b). Focus came back to a stop without leaving the page's
 * elements, then two rounds of Tab, Shift+Tab, Esc and the arrows all failed to leave the
 * cycle: failure, high. Inside a dialog, or with nearby text that names an exit key: review.
 */
export const keyboardTrapRule: ProbeRule = {
  id: 'rampa/keyboard-trap',
  kind: 'keyboard',
  variant: 'keyboard-walk',
  versions: KEYBOARD_VERSIONS,
  criteria: ['2.1.2'],
  run(record, ctx) {
    const walk = walkOf(record)
    const what = viewportText(walk)
    const text = TRAP_TEXT[ctx.locale]
    const findings: Finding[] = []
    const review: Finding[] = []
    let unmatched = 0
    const notes: string[] = []
    for (const trap of walk.traps) {
      if (trap.left) {
        notes.push(`focus cycled through ${trap.cycle.length} element(s) and left with ${trap.leftWith ?? 'a key'}`)
        continue
      }
      const matched = trap.cycle.map((el) => ({ el, node: matchNode(ctx.index, el.ref, el.id) }))
      const first = matched.find((item) => item.node)
      if (!first?.node) {
        unmatched++
        continue
      }
      const names = matched.slice(0, 4).map((item) => (item.node ? nameOf(item.node) : item.el.ref))
      const evidence = `${trap.direction === 'forward' ? 'Tab' : 'Shift+Tab'} cycles through ${trap.cycle.length} element(s) (${names.join(', ')}${trap.cycle.length > 4 ? ', …' : ''}); focus did not leave with ${trap.tried.join('; ')}, in ${trap.rounds} round(s)${trap.dialog ? `; all inside ${trap.dialog}` : ''}${trap.exitHint ? `; nearby text: "${trap.exitHint}"` : ''}`
      if (trap.dialog) review.push(probeFinding({ criterion: '2.1.2', rule: this.id, node: first.node, message: text.dialog, evidence, confidence: 'medium', subject: 'trap' }))
      else if (trap.exitHint) review.push(probeFinding({ criterion: '2.1.2', rule: this.id, node: first.node, message: text.hint, evidence, confidence: 'medium', subject: 'trap' }))
      else findings.push(probeFinding({ criterion: '2.1.2', rule: this.id, node: first.node, message: text.trap, evidence, confidence: 'high', subject: 'trap' }))
    }
    const applicable = new Set([...walk.forward, ...walk.backward].flatMap((stop) => (stop.el ? [stop.el.ref] : []))).size
    if (walk.end.forward === 'budget' || walk.end.forward === 'time') notes.push(`the walk stopped early (${walk.end.forward}); a trap after that point is not seen`)
    if (walk.end.forward === 'frame') notes.push('focus stayed inside a frame, which the walk cannot see into')
    const counts = { applicable, failures: findings.length, review: review.length, unmatched }
    return { findings, review, coverage: [coverageFor('2.1.2', this.id, record, what, counts, notes.join('; ') || undefined)] }
  },
}

const CHANGE_WORDS: Record<Locale, Record<string, string>> = {
  en: {
    navigation: 'tried to load another page',
    popup: 'opened a new window',
    open: 'opened a new window',
    submit: 'submitted a form',
    modal: 'opened a modal dialog',
    dialog: 'opened a browser dialog',
    focus: 'moved focus elsewhere by script',
    history: 'changed the address without loading a page',
  },
  'pt-BR': {
    navigation: 'tentou carregar outra página',
    popup: 'abriu uma nova janela',
    open: 'abriu uma nova janela',
    submit: 'enviou um formulário',
    modal: 'abriu um diálogo modal',
    dialog: 'abriu um diálogo do navegador',
    focus: 'moveu o foco para outro lugar por script',
    history: 'mudou o endereço sem carregar uma página',
  },
}

const ON_FOCUS_TEXT: Record<Locale, { change: string; review: string }> = {
  en: {
    change: 'Moving keyboard focus to this element, with nothing activated, {what}: a change of context on focus.',
    review: 'Moving keyboard focus to this element {what}. Check whether the content changed in a way that changes its meaning.',
  },
  'pt-BR': {
    change: 'Mover o foco do teclado para este elemento, sem ativar nada, {what}: uma mudança de contexto ao receber foco.',
    review: 'Mover o foco do teclado para este elemento {what}. Confira se o conteúdo mudou de um jeito que muda seu sentido.',
  },
}

const HIGH_EVENTS = new Set(['navigation', 'popup', 'open', 'submit', 'modal'])

/**
 * 3.2.1 On Focus. During the walk, a navigation, new window, form submission or modal dialog
 * that followed a Tab, minus what the page did on its own with no key pressed: failure, high.
 * A browser dialog, or focus moved by script outside the focused widget: failure, medium.
 * An address change with no page load: review.
 */
export const onFocusRule: ProbeRule = {
  id: 'rampa/on-focus',
  kind: 'keyboard',
  variant: 'keyboard-walk',
  versions: KEYBOARD_VERSIONS,
  criteria: ['3.2.1'],
  run(record, ctx) {
    const walk = walkOf(record)
    const what = viewportText(walk)
    const idle = new Set(walk.idle.map((event) => `${event.type}|${event.detail ?? ''}`))
    const words = CHANGE_WORDS[ctx.locale]
    const text = ON_FOCUS_TEXT[ctx.locale]
    const findings: Finding[] = []
    const review: Finding[] = []
    let unmatched = 0
    const visited = new Set<string>()
    // Each element once: the backward walk focuses the same elements again.
    for (const stop of [...walk.forward, ...walk.backward]) {
      if (!stop.el || visited.has(stop.el.ref)) continue
      visited.add(stop.el.ref)
      const events = (stop.events ?? []).filter((event) => !idle.has(`${event.type}|${event.detail ?? ''}`))
      const high = events.filter((event) => HIGH_EVENTS.has(event.type))
      const dialogs = events.filter((event) => event.type.startsWith('dialog-'))
      const moved = stop.after && !stop.afterWithin && stop.after.ref !== stop.el.ref ? stop.after : undefined
      const history = events.filter((event) => event.type === 'history')
      if (high.length + dialogs.length + history.length === 0 && !moved) continue
      const node = matchNode(ctx.index, stop.el.ref, stop.el.id)
      if (!node) {
        unmatched++
        continue
      }
      const keys = `${stop.key} ×${stop.n}`
      const describe = (event: KeyEvent) => `${words[event.type.startsWith('dialog-') ? 'dialog' : event.type] ?? event.type}${event.detail ? ` (${event.detail.slice(0, 120)})` : ''} at +${Math.max(0, Math.round(event.at - stop.at))} ms`
      const idleNote = `nothing like it in ${walk.idleMs} ms with no key pressed`
      if (high.length > 0 || dialogs.length > 0 || moved) {
        const parts = [...high, ...dialogs].map(describe)
        if (moved) parts.push(`${words.focus}: focus went to ${moved.label ? `<${moved.tag}> "${moved.label}"` : `<${moved.tag}>`} ${moved.ref}`)
        const confidence = high.length > 0 ? 'high' : 'medium'
        const kinds = [...high.map((event) => words[event.type] ?? event.type), ...(dialogs.length > 0 ? [words.dialog] : []), ...(moved ? [words.focus] : [])]
        if (findings.length < MAX_REPORTED) {
          findings.push(
            probeFinding({
              criterion: '3.2.1',
              rule: this.id,
              node,
              message: text.change.replace('{what}', [...new Set(kinds)].join(', ')),
              evidence: `${keys}: focus on ${nameOf(node, stop.el)}; then ${parts.join('; ')}; ${idleNote}`,
              confidence,
              subject: [...new Set([...high, ...dialogs].map((event) => event.type))].concat(moved ? ['focus'] : []).join(','),
            }),
          )
        }
      } else if (history.length > 0) {
        review.push(
          probeFinding({
            criterion: '3.2.1',
            rule: this.id,
            node,
            message: text.review.replace('{what}', words.history ?? 'history'),
            evidence: `${keys}: focus on ${nameOf(node, stop.el)}; then ${history.map(describe).join('; ')}; ${idleNote}`,
            confidence: 'low',
            subject: 'history',
          }),
        )
      }
    }
    const notes = walk.end.forward === 'cycled' ? undefined : `the walk stopped early (${walk.end.forward})`
    return { findings, review, coverage: [coverageFor('3.2.1', this.id, record, what, { applicable: visited.size, failures: findings.length, review: review.length, unmatched }, notes)] }
  },
}
