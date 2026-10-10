import { type ErrorField, errorFields } from '../criteria/error-messages.ts'
import { exampleOf } from '../criteria/labels-or-instructions.ts'
import type { Locale } from '../i18n.ts'
import type { Hit, RuleCheck } from './types.ts'

/**
 * Error states the page already shows (B8; src/criteria/error-messages.ts finds them). Nothing is submitted: the
 * rules read pages a server rendered with errors, and pages a test drove into an error state (fill a field,
 * leave it, then `checkPage`). Both are narrow: on a page with no field in an error state, they say nothing about
 * 3.3.1 and 3.3.3, which stay "not checked".
 */

const say = (locale: Locale, en: string, pt: string) => (locale === 'pt-BR' ? pt : en)
const quote = (text: string) => `"${text.length > 100 ? `${text.slice(0, 99)}…` : text}"`

function stateText(field: ErrorField): string {
  const parts = field.state.map((source) =>
    source === 'aria-invalid'
      ? `aria-invalid="${(field.node.native.attributes as Record<string, string> | undefined)?.['aria-invalid'] ?? 'true'}"`
      : source === 'user-invalid'
        ? `:user-invalid${field.validity.length > 0 ? ` (${field.validity.join(', ')})` : ''}`
        : 'an error class on the field or its group',
  )
  return parts.join(', ')
}

/** 3.3.1: a field in an error state with no error text a person can see and assistive technology can read. */
export const errorWithoutTextRule: RuleCheck = {
  id: 'rampa/error-without-text',
  version: '1',
  criteria: ['3.3.1'],
  maturity: 'experimental',
  surfaces: ['web'],
  narrow: true,
  act: [],
  engineRules: [],
  help: {
    en: 'A field in error needs text that says so, which people see and screen readers read',
    'pt-BR': 'Um campo com erro precisa de um texto que diga isso, visível e lido por leitores de tela',
  },
  helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/error-identification.html',
  run(snapshot) {
    const fields = errorFields(snapshot)
    const hits: Hit[] = []
    for (const field of fields) {
      const usable = field.messages.filter((message) => message.shown && message.inTree)
      if (usable.length > 0) continue
      // The browser's own validation (:user-invalid) shows nothing unless the page styles it, and the browser names the
      // error itself when the form is sent: only the page's own marks (aria-invalid, a class) claim an error is shown.
      if (!field.state.includes('aria-invalid') && !field.state.includes('class')) continue
      const hidden = field.messages.filter((message) => !message.shown)
      const silent = field.messages.filter((message) => message.shown && !message.inTree)
      const why = silent.length > 0 ? 'silent' : hidden.length > 0 ? 'hidden' : 'none'
      // Only a class says the field is in error: a person decides whether it is one.
      const sure = field.state.includes('aria-invalid')
      const message = (silent[0] ?? hidden[0])?.text
      hits.push({
        ref: field.node.ref,
        outcome: sure ? 'fail' : 'review',
        subject: `${why}|${field.label}`,
        evidence: [stateText(field), message ? quote(message) : '', field.label ? `label ${quote(field.label)}` : ''].filter(Boolean).join('; '),
        facts: { label: field.label, why, state: stateText(field), message: message ?? '', sure },
        confidence: 'medium',
      })
    }
    return { hits, applicable: fields.length }
  },
  message(hit, locale) {
    const label = String(hit.facts.label)
    const field = label ? say(locale, `The field ${quote(label)}`, `O campo ${quote(label)}`) : say(locale, 'This field', 'Este campo')
    if (hit.facts.sure !== true) {
      return say(
        locale,
        `${field} looks marked as in error by a class on it or on its group, and no error text shows near it. If it is in error, say what is wrong in text next to it, tied with aria-describedby or aria-errormessage (WCAG 3.3.1).`,
        `${field} parece marcado com erro por uma classe nele ou no grupo dele, e nenhum texto de erro aparece perto dele. Se houver erro, diga o que está errado em texto ao lado, ligado com aria-describedby ou aria-errormessage (WCAG 3.3.1).`,
      )
    }
    if (hit.facts.why === 'silent') {
      return say(
        locale,
        `${field} is marked invalid (${hit.facts.state}), and its error text is hidden from assistive technology (aria-hidden), so screen reader users are not told what is wrong (WCAG 3.3.1). Remove aria-hidden from the message.`,
        `${field} está marcado como inválido (${hit.facts.state}), e o texto de erro está escondido de tecnologias assistivas (aria-hidden): quem usa leitor de tela não fica sabendo o que está errado (WCAG 3.3.1). Tire o aria-hidden da mensagem.`,
      )
    }
    if (hit.facts.why === 'hidden') {
      return say(
        locale,
        `${field} is marked invalid (${hit.facts.state}), but its error text is not shown, so nobody is told what is wrong (WCAG 3.3.1). Show the message when the field is in error.`,
        `${field} está marcado como inválido (${hit.facts.state}), mas o texto de erro não aparece, e ninguém fica sabendo o que está errado (WCAG 3.3.1). Mostre a mensagem quando o campo estiver com erro.`,
      )
    }
    return say(
      locale,
      `${field} is marked invalid (${hit.facts.state}), and no text says what is wrong: an error shown only by its state or its color is not identified in text (WCAG 3.3.1). Show a message next to it that says what is wrong, tied with aria-describedby or aria-errormessage.`,
      `${field} está marcado como inválido (${hit.facts.state}), e nenhum texto diz o que está errado: um erro mostrado só pelo estado ou pela cor não é identificado em texto (WCAG 3.3.1). Mostre ao lado uma mensagem que diga o que está errado, ligada com aria-describedby ou aria-errormessage.`,
    )
  },
}

/** The constraint a validity flag breaks, and whether a text states it. */
interface Constraint {
  flag: string
  /** What the markup asks, for the message: minlength="8". */
  rule: string
  stated(text: string, field: ErrorField): boolean
  /** Not stated: a failure when the check is plain (a number, a type); review when it needs reading (a pattern, a date). */
  outcome: 'fail' | 'review'
}

const NUMBER_IN = (value: string) => new RegExp(`(^|[^\\d.,])${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\d])`)
const TYPE_WORDS: Record<string, RegExp> = {
  email: /@|e-?mail|correio/i,
  url: /https?:|\burl\b|\blink\b|endere[cç]o|\bsite\b|web/i,
  number: /\d|\bn[uú]mero|\bnumber|\bnum[eé]ric|\bd[ií]gitos?\b|\bdigits?\b/i,
  tel: /\d|telefone|phone|tel[eé]fono|n[uú]mero|number/i,
  date: /\d|\bdate\b|\bdata\b|\bfecha\b|dd|aaaa|yyyy/i,
}

function constraintsOf(field: ErrorField): Constraint[] {
  const c = field.constraints
  const out: Constraint[] = []
  for (const flag of field.validity) {
    if (flag === 'tooShort' && c.minlength) out.push({ flag, rule: `minlength="${c.minlength}"`, stated: (t) => NUMBER_IN(c.minlength ?? '').test(t), outcome: 'fail' })
    if (flag === 'tooLong' && c.maxlength) out.push({ flag, rule: `maxlength="${c.maxlength}"`, stated: (t) => NUMBER_IN(c.maxlength ?? '').test(t), outcome: 'fail' })
    const dateLike = ['date', 'time', 'datetime-local', 'month', 'week'].includes(field.type)
    if (flag === 'rangeUnderflow' && c.min) out.push({ flag, rule: `min="${c.min}"`, stated: (t) => NUMBER_IN(c.min ?? '').test(t), outcome: dateLike ? 'review' : 'fail' })
    if (flag === 'rangeOverflow' && c.max) out.push({ flag, rule: `max="${c.max}"`, stated: (t) => NUMBER_IN(c.max ?? '').test(t), outcome: dateLike ? 'review' : 'fail' })
    if (flag === 'stepMismatch' && c.step) out.push({ flag, rule: `step="${c.step}"`, stated: (t) => NUMBER_IN(c.step ?? '').test(t), outcome: 'review' })
    if ((flag === 'typeMismatch' || flag === 'badInput') && TYPE_WORDS[field.type === 'datetime-local' ? 'date' : field.type]) {
      const words = TYPE_WORDS[field.type === 'datetime-local' ? 'date' : field.type] as RegExp
      out.push({ flag, rule: `type="${field.type}"`, stated: (t) => words.test(t), outcome: 'fail' })
    }
    if (flag === 'patternMismatch' && c.pattern) {
      const pattern = c.pattern
      out.push({ flag, rule: `pattern="${pattern}"`, stated: (t) => exampleOf(pattern, [t]) !== undefined, outcome: 'review' })
    }
  }
  return out
}

/**
 * 3.3.3: a field the browser finds invalid against a constraint its markup states (minlength, max, type, pattern),
 * with an error message that does not say what the constraint asks. The label and the hints tied to the field
 * count too: a suggestion already on screen is still there when the error shows.
 */
export const errorSuggestionRule: RuleCheck = {
  id: 'rampa/error-suggestion',
  version: '1',
  criteria: ['3.3.3'],
  maturity: 'experimental',
  surfaces: ['web'],
  narrow: true,
  act: [],
  engineRules: [],
  help: {
    en: 'When the page knows the rule an entry breaks, the error message should say it',
    'pt-BR': 'Quando a página conhece a regra que a entrada quebra, a mensagem de erro deve dizê-la',
  },
  helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/error-suggestion.html',
  run(snapshot, _engine, ctx) {
    const hits: Hit[] = []
    let applicable = 0
    for (const field of errorFields(snapshot)) {
      const messages = field.messages.filter((message) => message.shown)
      // With no message, 3.3.1 reports the field; a suggestion needs a message to live in.
      if (messages.length === 0) continue
      const constraints = constraintsOf(field)
      if (constraints.length === 0) continue
      applicable++
      const texts = [...messages.map((message) => message.text), field.label, ...field.hints].filter(Boolean).join(' · ')
      const missing = constraints.filter((constraint) => !constraint.stated(texts, field))
      if (missing.length === 0) continue
      const outcome = missing.some((constraint) => constraint.outcome === 'fail') ? 'fail' : 'review'
      hits.push({
        ref: field.node.ref,
        outcome,
        subject: missing.map((constraint) => constraint.flag).join(','),
        evidence: `${missing.map((constraint) => `${constraint.flag}: ${constraint.rule}`).join('; ')}; ${say(ctx.locale, 'message', 'mensagem')} ${quote(messages[0]?.text ?? '')}${field.label ? `; ${say(ctx.locale, 'label', 'rótulo')} ${quote(field.label)}` : ''}${field.hints.length > 0 ? `; ${say(ctx.locale, 'hint', 'dica')} ${quote(field.hints[0] ?? '')}` : ''}`,
        facts: { label: field.label, rules: missing.map((constraint) => constraint.rule).join(', '), message: messages[0]?.text ?? '', outcome },
        confidence: 'medium',
      })
    }
    return { hits, applicable }
  },
  message(hit, locale) {
    const label = String(hit.facts.label)
    const field = label ? say(locale, `the field ${quote(label)}`, `o campo ${quote(label)}`) : say(locale, 'this field', 'este campo')
    if (hit.outcome === 'review') {
      return say(
        locale,
        `The page knows what ${field} accepts (${hit.facts.rules}), and its error message ${quote(String(hit.facts.message))} shows no example of it. Check that the message, the label or a hint says how to fix the entry (WCAG 3.3.3).`,
        `A página sabe o que ${field} aceita (${hit.facts.rules}), e a mensagem de erro ${quote(String(hit.facts.message))} não mostra um exemplo disso. Confira se a mensagem, o rótulo ou uma dica diz como corrigir (WCAG 3.3.3).`,
      )
    }
    return say(
      locale,
      `The page knows what ${field} accepts (${hit.facts.rules}), but its error message ${quote(String(hit.facts.message))}, its label and its hints do not say it, so the person is not told how to fix the entry (WCAG 3.3.3). Say it in the message: the number of characters, the range, the format with an example.`,
      `A página sabe o que ${field} aceita (${hit.facts.rules}), mas a mensagem de erro ${quote(String(hit.facts.message))}, o rótulo e as dicas não dizem isso, e a pessoa não sabe como corrigir (WCAG 3.3.3). Diga na mensagem: o número de caracteres, o intervalo, o formato com um exemplo.`,
    )
  },
}

export const ERROR_RULES: readonly RuleCheck[] = [errorWithoutTextRule, errorSuggestionRule]
