import type { Finding, ProbeCoverage } from '../core/types.ts'
import type { Locale } from '../i18n.ts'
import type { HoverAttempt, HoverContent, HoverTrigger } from '../probes/hover.ts'
import { matchNode, nameOf } from '../probes/identity.ts'
import type { A11yNode, ProbeRecord } from '../snapshot/schema.ts'
import { type ProbeRule, type ProbeRuleContext, asArray, asRecord, conditionsText, coverageStatus, moreNotListed, probeFinding, say } from './probes.ts'

/** Findings per condition; the rest are counted in the coverage line, never dropped silently. */
const MAX_REPORTED = 10

type Condition = 'dismissible' | 'hoverable' | 'persistent'
type Mode = HoverAttempt['mode']

const TEXT: Record<
  Locale,
  {
    dismissible: string
    hoverable: string
    persistent: string
    inputError: string
    once: string
    focusMoved: string
    stays: string
    modes: Record<'hover' | 'focus' | 'both', string>
  }
> = {
  en: {
    dismissible:
      'Content that appears {modes} covers other content and does not close with Esc. Let people dismiss it without moving the pointer or focus, for example with Esc (WCAG 1.4.13, dismissible; SCR39).',
    hoverable:
      'Content that appears when the pointer hovers here disappears when the pointer moves onto it, so someone who magnifies the screen cannot read it (WCAG 1.4.13, hoverable; F95).',
    persistent: 'Content that appears {modes} disappears on its own while the pointer or focus stays on its trigger (WCAG 1.4.13, persistent).',
    inputError:
      'Content that appears {modes} covers other content and does not close with Esc, but it describes a field marked invalid and may be an input error message, which need not be dismissible. Check.',
    once: 'Content that appears {modes} failed the {condition} check in one of two tries. Check it by hand.',
    focusMoved: 'Esc hid the content that appears on focus only by taking focus off its trigger. Check that it can be dismissed without moving focus.',
    stays:
      'Content that appeared {modes} covers other content and does not close with Esc, but it also stays when the pointer and focus leave, so it may not belong to this element. Check what shows it and whether it can be dismissed.',
    modes: { hover: 'on hover', focus: 'on focus', both: 'on hover and on focus' },
  },
  'pt-BR': {
    dismissible:
      'O conteúdo que aparece {modes} cobre outro conteúdo e não fecha com Esc. Permita dispensá-lo sem mover o ponteiro nem o foco, por exemplo com Esc (WCAG 1.4.13, dispensável; SCR39).',
    hoverable:
      'O conteúdo que aparece quando o ponteiro passa aqui some quando o ponteiro se move para cima dele, e quem amplia a tela não consegue lê-lo (WCAG 1.4.13, passível de hover; F95).',
    persistent: 'O conteúdo que aparece {modes} some sozinho enquanto o ponteiro ou o foco continuam no gatilho (WCAG 1.4.13, persistente).',
    inputError:
      'O conteúdo que aparece {modes} cobre outro conteúdo e não fecha com Esc, mas descreve um campo marcado como inválido e pode ser uma mensagem de erro de entrada, que não precisa ser dispensável. Confira.',
    once: 'O conteúdo que aparece {modes} falhou na verificação {condition} em uma de duas tentativas. Confira à mão.',
    focusMoved: 'O Esc escondeu o conteúdo que aparece no foco só tirando o foco do gatilho. Confira se ele pode ser dispensado sem mover o foco.',
    stays:
      'O conteúdo que apareceu {modes} cobre outro conteúdo e não fecha com Esc, mas também continua quando o ponteiro e o foco saem, então pode não pertencer a este elemento. Confira o que o mostra e se ele pode ser dispensado.',
    modes: { hover: 'no hover', focus: 'no foco', both: 'no hover e no foco' },
  },
}

const CONDITION_NAME: Record<Locale, Record<Condition, string>> = {
  en: { dismissible: 'dismissible', hoverable: 'hoverable', persistent: 'persistent' },
  'pt-BR': { dismissible: 'de dispensável', hoverable: 'de passível de hover', persistent: 'de persistente' },
}

const r1 = (value: number) => Math.round(value)

function contentName(content: HoverContent | undefined, locale: Locale): string {
  if (!content) return say(locale, 'the content', 'o conteúdo')
  const label = content.label.length > 60 ? `${content.label.slice(0, 59)}…` : content.label
  if (content.pseudo) return say(locale, `its ${content.pseudo} "${label}"`, `o ${content.pseudo} "${label}"`)
  const role = content.role && content.role !== 'generic' ? ` role=${content.role}` : ''
  return `<${content.tag}${role}>${label ? ` "${label}"` : ''}`
}

function where(content: HoverContent | undefined, locale: Locale): string {
  if (!content) return ''
  const r = content.rect
  const position = content.pseudo ? say(locale, 'measured from the pixels that changed', 'medido pelos pixels que mudaram') : `position ${content.position}`
  return say(locale, ` at x ${r1(r.x)}, y ${r1(r.y)}, ${r1(r.width)}×${r1(r.height)} px (${position})`, ` em x ${r1(r.x)}, y ${r1(r.y)}, ${r1(r.width)}×${r1(r.height)} px (${position})`)
}

function modesOf(modes: readonly Mode[]): 'hover' | 'focus' | 'both' {
  return modes.includes('hover') && modes.includes('focus') ? 'both' : modes.includes('focus') ? 'focus' : 'hover'
}

function coversText(attempt: HoverAttempt, locale: Locale): string {
  const covers = attempt.covers
  if (!covers || covers.count === 0) return ''
  const sample = asArray<{ tag?: string; label?: string }>(covers.sample)
    .map((s) => `<${s.tag ?? 'element'}>${s.label ? ` "${s.label.length > 40 ? `${s.label.slice(0, 39)}…` : s.label}"` : ''}`)
    .join(', ')
  return say(
    locale,
    `, over ${covers.count} other element(s)${sample ? ` such as ${sample}` : ''}${covers.byPixels ? ' (by the pixels that changed)' : ''}`,
    `, sobre ${covers.count} outro(s) elemento(s)${sample ? ` como ${sample}` : ''}${covers.byPixels ? ' (pelos pixels que mudaram)' : ''}`,
  )
}

/** What one attempt says about one condition: a confirmed failure, a doubt, or nothing. */
function verdict(attempt: HoverAttempt, condition: Condition): 'fail' | 'review' | 'input-error' | 'focus-moved' | 'stays' | undefined {
  if (!attempt.shown) return undefined
  if (condition === 'dismissible') {
    const d = attempt.dismissible
    if (!d) return undefined
    const covers = (attempt.covers?.count ?? 0) > 0
    if (d.ok === false && covers) return attempt.inputError ? 'input-error' : d.staysAfterLeave ? 'stays' : 'fail'
    if (d.ok === true && d.focusMoved && covers) return 'focus-moved'
    return undefined
  }
  const check = condition === 'hoverable' ? attempt.hoverable : attempt.persistent
  if (!check || check.ok === null || check.failed === 0) return undefined
  // A verdict that rests on the content going away counts only when it went away in both tries.
  return check.failed >= 2 ? 'fail' : 'review'
}

function evidenceFor(condition: Condition, trigger: string, attempt: HoverAttempt, modes: readonly Mode[], locale: Locale): string {
  const content = attempt.content?.[0]
  const mode = TEXT[locale].modes[modesOf(modes)]
  const shown = say(locale, `${mode}, ${trigger} showed ${contentName(content, locale)}${where(content, locale)}`, `${mode}, ${trigger} mostrou ${contentName(content, locale)}${where(content, locale)}`)
  if (condition === 'dismissible') {
    const moved = attempt.dismissible?.focusMoved
    const stays = attempt.dismissible?.staysAfterLeave
    const left =
      stays === undefined
        ? ''
        : stays
          ? say(locale, ', and it stayed after the pointer and focus left', ', e continuou depois que ponteiro e foco saíram')
          : say(locale, ', and it went away once the pointer and focus left', ', e sumiu quando ponteiro e foco saíram')
    return say(
      locale,
      `${shown}${coversText(attempt, locale)}; Esc pressed without moving the pointer or focus: ${attempt.dismissible?.ok ? `it closed${moved ? ', and focus left the trigger' : ''}` : `it still showed ${attempt.dismissible?.afterMs ?? 0} ms later`}${left}`,
      `${shown}${coversText(attempt, locale)}; Esc pressionado sem mover ponteiro nem foco: ${attempt.dismissible?.ok ? `fechou${moved ? ', e o foco saiu do gatilho' : ''}` : `continuava visível ${attempt.dismissible?.afterMs ?? 0} ms depois`}${left}`,
    )
  }
  if (condition === 'hoverable') {
    const h = attempt.hoverable
    return say(
      locale,
      `${shown}, ${r1(h?.gap ?? 0)} px from the trigger; the pointer moved onto it in 8 px steps every 16 ms and it disappeared, in ${h?.failed ?? 0} of ${h?.rounds ?? 0} tries`,
      `${shown}, a ${r1(h?.gap ?? 0)} px do gatilho; o ponteiro foi até ele em passos de 8 px a cada 16 ms e ele sumiu, em ${h?.failed ?? 0} de ${h?.rounds ?? 0} tentativas`,
    )
  }
  const p = attempt.persistent
  const seconds = Math.round((p?.afterMs ?? 0) / 1000)
  return say(
    locale,
    `${shown}; ${seconds} s later on the fake clock, with the pointer or focus still on the trigger, it was gone, in ${p?.failed ?? 0} of ${p?.rounds ?? 0} tries`,
    `${shown}; ${seconds} s depois no relógio simulado, com ponteiro ou foco ainda no gatilho, tinha sumido, em ${p?.failed ?? 0} de ${p?.rounds ?? 0} tentativas`,
  )
}

/**
 * 1.4.13 Content on Hover or Focus, over the hover probe's attempts. Failure (high): content that covers other
 * content stays after Esc (dismissible); content goes when the pointer moves onto it, twice (hoverable, F95);
 * content goes on its own within 10 s, twice (persistent). Review: a condition that failed once of two tries;
 * content that does not close but may be an input error; Esc that hid the content by moving focus.
 */
export const hoverRule: ProbeRule = {
  id: 'rampa/hover-content',
  kind: 'hover',
  variant: 'hover-focus',
  versions: ['1'],
  criteria: ['1.4.13'],
  run(record: ProbeRecord, ctx: ProbeRuleContext) {
    const data = asRecord(record.data)
    const triggers = asArray<HoverTrigger>(data.triggers).filter((t) => t && typeof t.ref === 'string')
    const attempts = asArray<HoverAttempt>(data.attempts).filter((a) => a && typeof a.trigger === 'number' && (a.mode === 'hover' || a.mode === 'focus'))
    const text = TEXT[ctx.locale]
    const findings: Finding[] = []
    const review: Finding[] = []
    const failures: Record<Condition, number> = { dismissible: 0, hoverable: 0, persistent: 0 }
    const listed: Record<Condition, number> = { dismissible: 0, hoverable: 0, persistent: 0 }
    let applicable = 0
    let unmatched = 0
    let notCovering = 0
    let unreachable = 0

    for (const [index, trigger] of triggers.entries()) {
      const mine = attempts.filter((a) => a.trigger === index && a.shown)
      if (mine.length === 0) continue
      const node: A11yNode | undefined = matchNode(ctx.index, trigger.ref, trigger.id)
      if (!node) {
        unmatched++
        continue
      }
      applicable++
      const name = nameOf(node, trigger)
      if (mine.some((a) => a.dismissible?.ok === false && (a.covers?.count ?? 0) === 0)) notCovering++
      if (mine.some((a) => a.hoverable?.ok === null && a.hoverable.why === 'outside the window')) unreachable++
      for (const condition of ['dismissible', 'hoverable', 'persistent'] as const) {
        const outcomes = mine.map((a) => ({ a, v: verdict(a, condition) })).filter((o) => o.v !== undefined)
        const failed = outcomes.filter((o) => o.v === 'fail')
        const first = failed[0]
        if (first) {
          failures[condition]++
          const modes = failed.map((o) => o.a.mode)
          if (listed[condition]++ >= MAX_REPORTED) continue
          findings.push(
            probeFinding({
              criterion: '1.4.13',
              rule: this.id,
              node,
              message: text[condition].replace('{modes}', text.modes[modesOf(modes)]),
              evidence: evidenceFor(condition, name, first.a, modes, ctx.locale),
              confidence: 'high',
              subject: condition,
            }),
          )
          continue
        }
        // No confirmed failure for this condition: the doubts go to review, one per trigger and condition.
        const doubt = outcomes[0]
        if (!doubt || review.length >= MAX_REPORTED * 3) continue
        const modes = outcomes.filter((o) => o.v === doubt.v).map((o) => o.a.mode)
        const message =
          doubt.v === 'input-error'
            ? text.inputError.replace('{modes}', text.modes[modesOf(modes)])
            : doubt.v === 'focus-moved'
              ? text.focusMoved
              : doubt.v === 'stays'
                ? text.stays.replace('{modes}', text.modes[modesOf(modes)])
                : text.once.replace('{modes}', text.modes[modesOf(modes)]).replace('{condition}', CONDITION_NAME[ctx.locale][condition])
        review.push(
          probeFinding({
            criterion: '1.4.13',
            rule: this.id,
            node,
            message,
            evidence: evidenceFor(condition, name, doubt.a, modes, ctx.locale),
            confidence: 'medium',
            subject: `${condition}|${doubt.v}`,
          }),
        )
      }
    }

    const total = failures.dismissible + failures.hoverable + failures.persistent
    const tried = new Set(attempts.map((a) => a.trigger)).size
    const hovered = attempts.filter((a) => a.mode === 'hover').length
    const focused = attempts.filter((a) => a.mode === 'focus').length
    const errors = attempts.filter((a) => a.error).length
    const found = Number(data.found) || 0
    const alike = Number(data.alike) || 0
    const unreadable = Number(data.unreadableSheets) || 0
    const notes = [
      say(
        ctx.locale,
        `${tried} trigger(s) tried of ${found} found (${hovered} hovered, ${focused} focused); ${applicable} showed content`,
        `${tried} gatilho(s) testado(s) de ${found} encontrado(s) (${hovered} com hover, ${focused} com foco); ${applicable} mostraram conteúdo`,
      ),
      alike > 0 ? say(ctx.locale, `${alike} more of a kind already tried five times not tried`, `mais ${alike} do mesmo tipo, já testado cinco vezes, não testado(s)`) : '',
      moreNotListed(ctx.locale, total - findings.length),
      notCovering > 0
        ? say(ctx.locale, `${notCovering} did not close with Esc but cover no other content, which the criterion allows`, `${notCovering} não fecharam com Esc mas não cobrem outro conteúdo, o que o critério permite`)
        : '',
      unreachable > 0 ? say(ctx.locale, `${unreachable} could not be reached by the pointer (outside the window)`, `${unreachable} fora do alcance do ponteiro (fora da janela)`) : '',
      record.reason?.startsWith('trigger budget') ? say(ctx.locale, 'trigger budget reached', 'limite de gatilhos atingido') : '',
      record.reason?.startsWith('time budget') ? say(ctx.locale, 'time budget reached', 'limite de tempo atingido') : '',
      unreadable > 0 ? say(ctx.locale, `${unreadable} style sheet(s) from other origins not read`, `${unreadable} folha(s) de estilo de outras origens não lida(s)`) : '',
      data.listeners === null ? say(ctx.locale, 'event listeners not read', 'ouvintes de eventos não lidos') : '',
      data.clock === false ? say(ctx.locale, 'fake clock unavailable: persistence not measured', 'relógio simulado indisponível: persistência não medida') : '',
      errors > 0 ? say(ctx.locale, `${errors} attempt(s) could not finish`, `${errors} tentativa(s) não terminaram`) : '',
    ].filter(Boolean)
    const viewport = asRecord(data.viewport)
    const coverage: ProbeCoverage = {
      criterion: '1.4.13',
      method: `probe/hover@${record.version}`,
      rule: this.id,
      conditions: conditionsText(
        record,
        say(
          ctx.locale,
          `hover and focus on up to ${Number(data.budget) || 0} triggers at ${Number(viewport.width) || 0}×${Number(viewport.height) || 0}`,
          `hover e foco em até ${Number(data.budget) || 0} gatilhos em ${Number(viewport.width) || 0}×${Number(viewport.height) || 0}`,
        ),
      ),
      status: coverageStatus(total, review.length),
      applicable,
      failures: total,
      review: review.length,
      unmatched,
      note: notes.join('; '),
      maturity: 'experimental',
    }
    return { findings, review, coverage: [coverage] }
  },
}
