import type { A11yNode } from '../snapshot/schema.ts'
import type { Item } from './page.ts'

/**
 * The help mechanisms WCAG 3.2.6 lists: human contact details, a human contact
 * mechanism, a self-help option, and a fully automated contact mechanism (a chat).
 */
export type HelpType = 'contact-details' | 'human-contact' | 'self-help' | 'chat'

export interface HelpKind {
  type: HelpType
  /** Recognized by where it leads or by a known widget; false when only the link text suggests it. */
  certain: boolean
}

const fold = (value: string) =>
  value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()

/** Path segments of contact pages, in en, pt-BR and es (and a few common others). */
const CONTACT_SEGMENT =
  /^(?:contact|contacts|contact-?us|get-in-touch|contato|contatos|fale-?conosco|fale-com-a-gente|atendimento|sac|ouvidoria|contacto|contactos|contactanos|contactenos|kontakt|nous-contacter|contactez-nous)$/
/** Path segments of help, support and FAQ pages. */
const SELF_HELP_SEGMENT =
  /^(?:help|help-?center|helpcenter|ajuda|central-de-ajuda|ayuda|centro-de-ayuda|support|suporte|soporte|faq|faqs|perguntas-frequentes|duvidas|duvidas-frequentes|preguntas-frecuentes|knowledge-?base|hilfe|aide)$/
/** Hosts of help sites: help.example.com, suporte.example.com.br. */
const SELF_HELP_HOST = /^(?:help|support|ajuda|suporte|ayuda|soporte|faq|docs-help)\./
/** Messaging links that reach a person. */
const MESSAGING = /^(?:https?:\/\/)?(?:wa\.me|api\.whatsapp\.com|web\.whatsapp\.com|m\.me|(?:www\.)?messenger\.com)\b/i

/** Link text that suggests help when the address does not say: classified, but only as needs review. */
const HELP_WORDS =
  /\b(?:contact(?:\s+us)?|get in touch|contato|fale conosco|fale com a gente|atendimento|contacto|contactanos|help|ajuda|ayuda|support|suporte|soporte|faq|faqs|perguntas frequentes|preguntas frecuentes|duvidas|central de ajuda|centro de ayuda|chat)\b/

export function helpOfItem(item: Item): HelpKind | undefined {
  const href = item.href?.trim() ?? ''
  const lower = href.toLowerCase()
  if (lower.startsWith('mailto:') || lower.startsWith('tel:') || lower.startsWith('sms:')) return { type: 'contact-details', certain: true }
  if (lower.startsWith('whatsapp:') || MESSAGING.test(href)) return { type: 'human-contact', certain: true }
  if (href && !lower.startsWith('#')) {
    try {
      const url = new URL(href, 'https://site.invalid/')
      const segments = url.pathname.split('/').filter(Boolean).map((segment) => fold(decodeURIComponent(segment)).replace(/\.(?:html?|php|aspx?)$/, ''))
      if (segments.some((segment) => CONTACT_SEGMENT.test(segment))) return { type: 'human-contact', certain: true }
      if (segments.some((segment) => SELF_HELP_SEGMENT.test(segment)) || SELF_HELP_HOST.test(url.hostname)) return { type: 'self-help', certain: true }
    } catch {
      // Not an address; the text may still say.
    }
  }
  const words = fold(item.name)
  const match = HELP_WORDS.exec(words)?.[0]
  if (!match) return undefined
  if (/chat/.test(match)) return { type: 'chat', certain: false }
  if (/faq|help|ajuda|ayuda|support|suporte|soporte|perguntas|preguntas|duvidas|central|centro/.test(match)) return { type: 'self-help', certain: false }
  return { type: 'human-contact', certain: false }
}

/** Chat widgets, by the ids, classes and frame addresses their vendors use. */
const WIDGETS: ReadonlyArray<[string, RegExp]> = [
  ['Intercom', /intercom-(?:container|frame|launcher|lightweight-app)|widget\.intercom\.io|js\.intercomcdn\.com/i],
  ['Drift', /drift-(?:widget|frame)|js\.driftt\.com/i],
  ['Crisp', /crisp-client|client\.crisp\.chat/i],
  ['Tawk.to', /tawk(?:-|\.to)/i],
  ['Zendesk', /ze-snippet|zopim|webwidget|static\.zdassets\.com/i],
  ['HubSpot', /hubspot-messages-iframe|hs-chat|js\.usemessages\.com/i],
  ['LiveChat', /livechat-(?:widget|compact)|chat-widget-container|livechatinc\.com/i],
  ['Freshchat', /fc_frame|fc_widget|freshchat|wchat\.freshchat\.com/i],
  ['Tidio', /tidio-chat|code\.tidio\.co/i],
  ['JivoChat', /jivo-iframe|jivosite|jivochat/i],
  ['Olark', /olark/i],
  ['Chatwoot', /woot-widget|chatwoot/i],
  ['Gorgias', /gorgias-chat/i],
  ['Help Scout', /beacon-container|beacon-v2\.helpscout\.net/i],
  ['Smartsupp', /smartsupp/i],
  ['Userlike', /userlike/i],
  ['Octadesk', /octadesk/i],
  ['Blip', /blip-chat|chat\.blip\.ai/i],
  ['Kommunicate', /kommunicate/i],
  ['Landbot', /landbot/i],
]

/** The chat vendor whose widget this node is, read from its id, class, src and title. */
export function chatWidgetOf(node: A11yNode): string | undefined {
  const attributes = (node.native.attributes ?? {}) as Record<string, unknown>
  const text = ['id', 'class', 'src', 'title', 'name']
    .map((name) => attributes[name])
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
  if (!text) return undefined
  return WIDGETS.find(([, pattern]) => pattern.test(text))?.[0]
}
