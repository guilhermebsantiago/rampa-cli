import { truncate } from '../core/util.ts'
import { isHidden, startTagOf } from '../criteria/shared.ts'
import type { Locale } from '../i18n.ts'
import type { A11yNode } from '../snapshot/schema.ts'
import { type MotionFacts, motionFactsOf } from '../surfaces/motion.ts'
import type { Hit, RuleCheck } from './types.ts'

/**
 * Scope notes (C17 of docs/plans/wcag-coverage.md): criteria Rampa cannot check, whose scope it can see. Each says
 * that the criterion applies on this page, what made it apply, and what a person has to verify. They are items to
 * review, never failures, and a page without such content gets nothing (the criterion stays not checked):
 *
 * - 3.3.4 Error Prevention (Legal, Financial, Data): payment fields (the `cc-*` and `transaction-*` autocomplete
 *   tokens, card fields named so, a payment provider's frame), and controls that buy, pay, sign, delete data or submit
 *   test answers. Rampa never submits them (section 4.4 of the plan), so it cannot see whether the step is reversible,
 *   checked or confirmed; it lists what it saw on the page that may be one of those mechanisms.
 * - 2.5.4 Motion Actuation: the page listens to device motion or orientation, or its scripts do so after an
 *   interaction (src/surfaces/motion.ts). Synthetic motion, the disable switch and the alternative are wave D.
 */

const UNDERSTANDING = 'https://www.w3.org/WAI/WCAG22/Understanding/'

export const fold = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()

const attribute = (node: A11yNode, name: string): string | undefined => {
  const value = (node.native.attributes as Record<string, unknown> | undefined)?.[name]
  return typeof value === 'string' ? value : undefined
}

// 3.3.4: what makes a page a legal, financial or data step.

/** The autocomplete tokens of payment (HTML Living Standard, autofill): a card, an amount. */
const PAYMENT_TOKENS = new Set([
  'cc-name', 'cc-given-name', 'cc-additional-name', 'cc-family-name', 'cc-number', 'cc-exp', 'cc-exp-month', 'cc-exp-year', 'cc-csc', 'cc-type',
  'transaction-currency', 'transaction-amount',
])
/** Card fields that do not say so in autocomplete, by their name, id, placeholder or label (folded). */
const CARD_FIELD =
  /\b(?:card ?number|cardnumber|cc-?num(?:ber)?|credit ?card|debit ?card|cvv2?|cvc|csc|security code|card ?expir\w*|expiry date|numero do cartao|numero de cartao|codigo de seguranca|validade do cartao|numero de (?:la )?tarjeta|codigo de seguridad|fecha de (?:caducidad|vencimiento))\b/
/** Payment providers' hosted fields and checkout frames. */
const PAYMENT_FRAME =
  /js\.stripe\.com|__privateStripe|checkoutshopper|adyen|braintreegateway|paypal\.com\/(?:sdk|checkoutnow|smart)|mercadopago|pagseguro|squareup|sq-payment|checkout\.com|pagar\.me|ebanx|cielo|getnet|iugu|vindi|paddle\.com|klarna/i

export type Commitment = 'financial' | 'legal' | 'data' | 'test'

/** Buttons that commit a purchase, a payment, a transfer, a booking, a bid or a donation (en, pt-BR, es), folded. */
/**
 * Paying or giving, with how or how often: "Donate monthly", "Pay with card", "Donate by credit/debit card Visa…",
 * "Pagar com cartão", "Doar mensalmente"; and the wallets' own buttons.
 */
const PAY_WITH =
  /^(?:buy|purchase|pay|donate|comprar|pagar|doar|donar|contribuir)(?: (?:now|once|monthly|yearly|today|agora|mensalmente|anualmente|ahora|mensualmente))?(?: (?:by|with|via|using|com|por|pelo|pela|con|usando|mediante) [\p{L}\p{N} -]{2,})?$|^(?:apple pay|google pay|paypal|samsung pay|pay with \S+|buy with \S+|mercado pago|picpay)$/u
const FINANCIAL =
  /^(?:buy(?: now| it now)?|purchase|pay(?: now)?|place (?:my |your |the )?order|complete (?:my |your |the )?(?:order|purchase|payment|booking)|confirm (?:my |your |the )?(?:order|purchase|payment|booking|reservation|transfer)|submit (?:my |your |the )?(?:order|payment)|transfer(?: money| funds)?|send money|make (?:a )?payment|donate(?: now)?|place (?:a )?bid|bid now|book now|reserve now|cancel (?:my |your )?(?:subscription|order|plan)|comprar(?: agora| ahora| ja)?|finalizar (?:a )?(?:compra|pedido|pagamento|pago)|fechar pedido|confirmar (?:o |a |el |la )?(?:pedido|compra|pagamento|pago|reserva|transferencia|pix)|pagar(?: agora| ahora| com pix| con tarjeta)?|efetuar pagamento|realizar (?:o )?(?:pagamento|pedido|pago)|fazer pagamento|transferir|enviar pix|doar(?: agora)?|donar(?: ahora)?|reservar(?: agora| ahora)?|contratar(?: agora| ahora)?|dar lance|cancelar (?:minha |mi )?(?:assinatura|suscripcion|pedido|plano|plan))$/
/** Buttons that accept a contract or terms that bind (folded); a cookie banner's "Accept" or "I agree" is not one. */
const LEGAL =
  /\b(?:sign (?:the )?(?:contract|agreement|document|lease)|accept (?:the )?(?:contract|agreement|offer|proposal|quote)|agree (?:to|with) (?:the )?(?:contract|agreement)|assinar (?:o )?(?:contrato|documento|termo|acordo)|aceitar (?:a |o )?(?:proposta|oferta|contrato)|firmar (?:el )?(?:contrato|documento|acuerdo)|aceptar (?:la |el )?(?:oferta|propuesta|contrato))\b/
/** Buttons that delete or close what a person keeps on the site (folded). */
const DELETION =
  /^(?:delete|erase|excluir|apagar|eliminar|borrar)(?: (?:my|your|minha|meu|sua|seu|mi|mis|tu|tus))? ?(?:account|profile|data|all|everything|conta|perfil|dados|tudo|cuenta|datos|todo)?$|^(?:close|deactivate|remove|encerrar|desativar|cerrar|desactivar) (?:my |your |minha |sua |mi |tu )?(?:account|conta|cuenta|profile|perfil)$|^(?:delete|erase|remove|excluir|apagar|eliminar|borrar) (?:my |minha |mis |meus )?(?:personal )?(?:data|dados|datos)(?: pessoais| personales)?$/
/** Buttons that hand in the answers of a test or an exam (folded). */
const TEST =
  /^(?:submit (?:my |your |the )?(?:test|exam|quiz|answers|assessment)|finish (?:the )?(?:test|exam|quiz)|enviar (?:as )?(?:respostas|prova|respuestas|examen)|finalizar (?:a |el )?(?:prova|teste|simulado|avaliacao|examen)|entregar (?:a )?prova|terminar (?:el )?examen)$/

/** What a page may show of the three mechanisms 3.3.4 accepts (folded). */
export const CONFIRM_BOX =
  /\b(?:i (?:have )?(?:read|reviewed|checked|confirm|agree|accept|understand)|i confirm|li e (?:concordo|aceito)|declaro|confirmo|concordo|estou ciente|he leido|acepto|entiendo)\b/
export const REVIEW_TEXT =
  /\b(?:review (?:your |the )?(?:order|details|information|payment)|order (?:summary|review)|confirm (?:your |the )?(?:order|details|information)|resumo do (?:pedido|pagamento)|revise (?:o |seu )?(?:pedido|dados)|revisar (?:o )?pedido|confira (?:o |seu )?pedido|resumen (?:del |de tu )?(?:pedido|compra)|revisa (?:tu )?pedido)\b/
export const REVERSAL_TEXT =
  /\b(?:cancel (?:within|at any time|anytime|free)|undo|refund|money[- ]back|direito de arrependimento|cancelar (?:em ate|a qualquer momento|gratis)|desfazer|reembolso|estorno|deshacer|devolucion)\b/
const TYPE_TO_CONFIRM = /\b(?:type|enter|digite|escreva|escribe)\b.{0,40}\b(?:confirm|confirmar|delete|excluir|eliminar)\b/

const BUTTON_ROLES = new Set(['button', 'menuitem'])
const FIELD_ROLES = new Set(['textbox', 'combobox', 'spinbutton', 'searchbox'])

interface Group {
  /** The form it is in, or the control itself when it is in none. */
  ref: string
  html?: string | undefined
  kinds: Set<Commitment | 'payment'>
  tokens: string[]
  controls: string[]
  frames: string[]
  confirm: string[]
}

function nameOf(node: A11yNode): string {
  return (node.name ?? node.text ?? attribute(node, 'value') ?? '').replace(/\s+/g, ' ').trim()
}

/** What a control commits when its name says so (folded): a purchase or payment, a legal agreement, a deletion, test answers. The form probe never presses one. */
export function commitmentOf(name: string): Commitment | undefined {
  // "Pay $49.00", "Pagar R$ 49,90": the amount is not part of what the button does.
  const folded = fold(name)
    .replace(/[^\p{L}\p{N} -]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b(?:r|us|usd|brl|eur|gbp)\b(?= \d)/g, ' ')
    .replace(/\b\d+\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!folded) return undefined
  // A long name holds more than what the button does (an svg's style, a card brand list): its first words say it.
  const head = folded.length > 80 ? folded.slice(0, 80).replace(/ \S*$/, '') : folded
  if (PAY_WITH.test(head)) return 'financial'
  if (folded.length > 60) return undefined
  if (TEST.test(folded)) return 'test'
  if (DELETION.test(folded)) return 'data'
  if (LEGAL.test(folded)) return 'legal'
  if (FINANCIAL.test(folded)) return 'financial'
  return undefined
}

function paymentTokens(node: A11yNode): string[] {
  const tokens = (attribute(node, 'autocomplete') ?? '').toLowerCase().split(/\s+/).filter((token) => PAYMENT_TOKENS.has(token))
  if (tokens.length > 0) return tokens
  const described = fold([attribute(node, 'name'), attribute(node, 'id'), attribute(node, 'placeholder'), node.name].filter(Boolean).join(' ').replace(/[_-]+/g, ' '))
  const match = CARD_FIELD.exec(described)?.[0]
  return match ? [match] : []
}

/**
 * The page's headings, labels and short texts, folded, each apart, for the mechanisms a person may find there: a
 * review step names itself in a heading or a line ("Order summary", "You can cancel within 14 days"); a word in an
 * article ("volunteers undo vandalism") says nothing about the form.
 */
const SHORT_TEXT = 160

function pageText(root: A11yNode): string {
  const parts: string[] = []
  const visit = (node: A11yNode) => {
    if (isHidden(node)) return
    const text = node.text?.trim() ?? ''
    if (node.role === 'heading' && (node.name || text)) parts.push(node.name || text)
    else if (text && text.length <= SHORT_TEXT) parts.push(text)
    for (const child of node.children) visit(child)
  }
  visit(root)
  return parts.map(fold).join(' \u0000 ').slice(0, 200_000)
}

const MAX_HITS = 5

const say = (locale: Locale, en: string, pt: string) => (locale === 'pt-BR' ? pt : en)

export const errorPreventionScopeRule: RuleCheck = {
  id: 'rampa/error-prevention-scope',
  version: '1',
  criteria: ['3.3.4'],
  maturity: 'experimental',
  surfaces: ['web'],
  narrow: true,
  act: [],
  engineRules: [],
  help: {
    en: 'A page that takes a payment, a legal commitment, test answers or the deletion of data needs a way to reverse, check or confirm it (3.3.4)',
    'pt-BR': 'Uma página que recebe pagamento, compromisso legal, respostas de prova ou exclusão de dados precisa de um jeito de desfazer, conferir ou confirmar (3.3.4)',
  },
  helpUrl: `${UNDERSTANDING}error-prevention-legal-financial-data.html`,
  run(snapshot) {
    const groups = new Map<string, Group>()
    const groupOf = (form: A11yNode | undefined, node: A11yNode): Group => {
      const key = form?.ref ?? node.ref
      let group = groups.get(key)
      if (!group) {
        group = { ref: key, html: startTagOf(form ?? node), kinds: new Set(), tokens: [], controls: [], frames: [], confirm: [] }
        groups.set(key, group)
      }
      return group
    }
    const visit = (node: A11yNode, form: A11yNode | undefined) => {
      if (isHidden(node)) return
      const here = node.role === 'form' || node.native.tag === 'form' ? node : form
      if (FIELD_ROLES.has(node.role)) {
        const tokens = paymentTokens(node)
        if (tokens.length > 0) {
          const group = groupOf(here, node)
          group.kinds.add('payment')
          for (const token of tokens) if (!group.tokens.includes(token)) group.tokens.push(token)
        }
      } else if (node.native.tag === 'iframe') {
        const src = [attribute(node, 'src'), attribute(node, 'name'), attribute(node, 'title'), attribute(node, 'id')].filter(Boolean).join(' ')
        const provider = PAYMENT_FRAME.exec(src)?.[0]
        if (provider) {
          const group = groupOf(here, node)
          group.kinds.add('payment')
          if (!group.frames.includes(provider)) group.frames.push(provider)
        }
      } else if (BUTTON_ROLES.has(node.role)) {
        const name = nameOf(node)
        const kind = commitmentOf(name)
        if (kind) {
          const group = groupOf(here, node)
          group.kinds.add(kind)
          if (!group.controls.includes(name)) group.controls.push(truncate(name, 60))
        }
      } else if (node.role === 'checkbox' && here) {
        const name = nameOf(node)
        if (CONFIRM_BOX.test(fold(name))) groupOf(here, node).confirm.push(truncate(name, 80))
      }
      for (const child of node.children) visit(child, here)
    }
    visit(snapshot.root, undefined)
    // A confirmation checkbox in a form that commits nothing is not a group of its own.
    const found = [...groups.values()].filter((group) => group.kinds.size > 0)
    if (found.length === 0) return { hits: [], applicable: 0 }

    const text = pageText(snapshot.root)
    const review = REVIEW_TEXT.exec(text)?.[0]
    const reversal = REVERSAL_TEXT.exec(text)?.[0]
    const typed = TYPE_TO_CONFIRM.exec(text)?.[0]
    const hits: Hit[] = found.slice(0, MAX_HITS).map((group) => {
      const kinds = [...group.kinds].sort()
      const seen = [
        ...group.confirm.map((name) => `checkbox:${name}`),
        ...(review ? [`review:${review}`] : []),
        ...(reversal ? [`reversal:${reversal}`] : []),
        ...(typed && group.kinds.has('data') ? [`typed:${typed}`] : []),
      ]
      return {
        ref: group.ref,
        outcome: 'review',
        subject: `${kinds.join('+')}|${group.controls[0] ?? group.tokens[0] ?? group.frames[0] ?? ''}`,
        evidence: [...group.tokens, ...group.frames, ...group.controls.map((name) => `“${name}”`)].join(', '),
        facts: {
          kinds: kinds.join(','),
          tokens: group.tokens.join(', '),
          frames: group.frames.join(', '),
          controls: group.controls.map((name) => `“${name}”`).join(', '),
          seen: seen.join('\u0001'),
          more: found.length > MAX_HITS ? found.length - MAX_HITS : 0,
        },
        html: group.html,
      }
    })
    // What was found past the cap is counted in the last message, not as elements looked at: nothing here is decided.
    return { hits, applicable: hits.length }
  },
  message(hit, locale) {
    const kinds = String(hit.facts.kinds).split(',')
    const what: string[] = []
    if (kinds.includes('payment')) {
      const list = [hit.facts.tokens, hit.facts.frames].filter(Boolean).join(', ')
      what.push(say(locale, `payment fields (${list})`, `campos de pagamento (${list})`))
    }
    const controls = String(hit.facts.controls)
    if (kinds.includes('financial')) what.push(say(locale, `a control that buys, pays or transfers: ${controls}`, `um controle que compra, paga ou transfere: ${controls}`))
    if (kinds.includes('legal')) what.push(say(locale, `a control that accepts a binding agreement: ${controls}`, `um controle que aceita um compromisso legal: ${controls}`))
    if (kinds.includes('data')) what.push(say(locale, `a control that deletes data: ${controls}`, `um controle que exclui dados: ${controls}`))
    if (kinds.includes('test')) what.push(say(locale, `a control that hands in test answers: ${controls}`, `um controle que entrega respostas de prova: ${controls}`))
    const seen = String(hit.facts.seen)
      .split('\u0001')
      .filter(Boolean)
      .map((entry) => {
        const [kind, value] = [entry.slice(0, entry.indexOf(':')), entry.slice(entry.indexOf(':') + 1)]
        if (kind === 'checkbox') return say(locale, `a checkbox “${value}”`, `uma caixa “${value}”`)
        if (kind === 'review') return say(locale, `a review step (“${value}”)`, `uma etapa de revisão (“${value}”)`)
        if (kind === 'reversal') return say(locale, `a word about reversing it (“${value}”)`, `uma menção a desfazer (“${value}”)`)
        return say(locale, `a field to type a confirmation (“${value}”)`, `um campo para digitar uma confirmação (“${value}”)`)
      })
    const lead = say(locale, `3.3.4 applies here: ${what.join('; ')}.`, `O 3.3.4 se aplica aqui: ${what.join('; ')}.`)
    const verify = say(
      locale,
      'Check that the submission can be reversed, that the data entered is checked for input errors and can be corrected, or that a step lets the person review, confirm and correct it before it is final (WCAG 3.3.4). Rampa submits nothing, so it cannot tell.',
      'Confira se o envio pode ser desfeito, se os dados digitados são conferidos contra erros e podem ser corrigidos, ou se uma etapa deixa a pessoa revisar, confirmar e corrigir antes de ficar definitivo (WCAG 3.3.4). O Rampa não envia nada, então não sabe dizer.',
    )
    const found =
      seen.length > 0
        ? say(locale, `Seen on this page: ${seen.join('; ')}.`, `Visto nesta página: ${seen.join('; ')}.`)
        : say(locale, 'Not seen on this page: a confirmation checkbox, a review step or a way to reverse it; a later step may have one.', 'Não visto nesta página: caixa de confirmação, etapa de revisão ou jeito de desfazer; uma etapa seguinte pode ter.')
    const more = Number(hit.facts.more) > 0 ? ` ${say(locale, `${hit.facts.more} more on the page.`, `Mais ${hit.facts.more} na página.`)}` : ''
    return `${lead} ${verify} ${found}${more}`
  },
}

// 2.5.4: the page uses the device's motion.

/** The listeners and calls, with where each is: a script's host and file, or "inline" for a script written in the page. */
function listenerText(motion: MotionFacts): string {
  const where = (script: string, line?: number) => `${script ? shortScript(script) : 'inline'}${line ? `:${line}` : ''}`
  const listeners = motion.listeners.slice(0, 4).map((listener) => `${listener.type} (${where(listener.script, listener.line)})`)
  const mentions = motion.mentions.slice(0, 4).map((mention) => `${mention.api === 'sensor' ? `new ${mention.name}()` : mention.api === 'requestPermission' ? `${mention.name}.requestPermission()` : mention.api === 'handler' ? `on${mention.name}` : `addEventListener("${mention.name}")`} (${where(mention.script)})`)
  return [...listeners, ...mentions].join(', ')
}

function shortScript(url: string): string {
  try {
    const parsed = new URL(url)
    const file = parsed.pathname.split('/').filter(Boolean).at(-1) ?? parsed.pathname
    return `${parsed.hostname}/…/${truncate(file, 40)}`
  } catch {
    return truncate(url, 60)
  }
}

export const motionActuationScopeRule: RuleCheck = {
  id: 'rampa/motion-actuation-scope',
  version: '1',
  criteria: ['2.5.4'],
  maturity: 'experimental',
  surfaces: ['web'],
  page: true,
  narrow: true,
  // ACT c249d5 and 7677a9 need the device moved (wave D): this rule only says that the criterion applies.
  act: [],
  engineRules: [],
  help: {
    en: 'A page that responds to moving or tilting the device needs a control on screen for the same function, and a way to turn motion off (2.5.4)',
    'pt-BR': 'Uma página que responde a mover ou inclinar o aparelho precisa de um controle na tela para a mesma função e de um jeito de desligar o movimento (2.5.4)',
  },
  helpUrl: `${UNDERSTANDING}motion-actuation.html`,
  run(snapshot) {
    const motion = motionFactsOf(snapshot.root)
    if (!motion || (motion.listeners.length === 0 && motion.mentions.length === 0)) return { hits: [], applicable: 0 }
    const listens = motion.listeners.length > 0
    return {
      hits: [
        {
          ref: snapshot.root.ref,
          outcome: 'review',
          subject: listens ? `listeners:${[...new Set(motion.listeners.map((listener) => listener.type))].sort().join(',')}` : `scripts:${[...new Set(motion.mentions.map((mention) => mention.name))].sort().join(',')}`,
          evidence: listenerText(motion),
          facts: { listens, count: motion.listeners.length + motion.mentions.length },
          html: startTagOf(snapshot.root),
        },
      ],
      applicable: 1,
    }
  },
  message(hit, locale) {
    const lead = hit.facts.listens
      ? say(locale, `2.5.4 applies here: the page listens to the device's motion (${hit.evidence}).`, `O 2.5.4 se aplica aqui: a página escuta o movimento do aparelho (${hit.evidence}).`)
      : say(
          locale,
          `2.5.4 may apply here: the page's scripts use the device's motion, perhaps after a tap (${hit.evidence}).`,
          `O 2.5.4 pode se aplicar aqui: os scripts da página usam o movimento do aparelho, talvez depois de um toque (${hit.evidence}).`,
        )
    const verify = say(
      locale,
      'Check that whatever is done by moving or tilting the device can also be done with a control on the screen, and that responding to motion can be turned off to avoid accidental actuation, unless the motion is essential or goes through an accessibility-supported interface (WCAG 2.5.4). If the script only collects data (analytics, fraud checks) and nothing on the page responds to motion, 2.5.4 does not apply.',
      'Confira se o que se faz movendo ou inclinando o aparelho também pode ser feito com um controle na tela, e se dá para desligar a resposta ao movimento para evitar acionamentos sem querer, a menos que o movimento seja essencial ou passe por uma interface com suporte de acessibilidade (WCAG 2.5.4). Se o script só coleta dados (análise, antifraude) e nada na página responde ao movimento, o 2.5.4 não se aplica.',
    )
    return `${lead} ${verify}`
  },
}

export const SCOPE_RULES: readonly RuleCheck[] = [errorPreventionScopeRule, motionActuationScopeRule]
