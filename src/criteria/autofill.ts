/**
 * The HTML autofill field names that WCAG 2.1 §7 lists as input purposes, with what each
 * means and the input types it may go on. Validity and type rules mirror axe-core's
 * `autocomplete-valid` and `autocomplete-appropriate` checks, so a value Rampa suggests
 * never trips the engine.
 */

interface Purpose {
  en: string
  'pt-BR': string
  /** Input types the token is appropriate for; select and textarea take any token. */
  types?: readonly string[]
}

const NUMERIC = ['text', 'search', 'number', 'tel']
const URL_TYPES = ['text', 'search', 'url']
const TEL = ['text', 'search', 'tel']

/** WCAG 2.1 §7, Input Purposes for User Interface Components, in its order. The Portuguese descriptions carry their article, as the messages need it. */
export const PURPOSES = {
  name: { en: 'full name', 'pt-BR': 'o nome completo' },
  'honorific-prefix': { en: 'title or prefix', 'pt-BR': 'o pronome de tratamento' },
  'given-name': { en: 'first name', 'pt-BR': 'o primeiro nome' },
  'additional-name': { en: 'middle name', 'pt-BR': 'o nome do meio' },
  'family-name': { en: 'last name', 'pt-BR': 'o sobrenome' },
  'honorific-suffix': { en: 'name suffix', 'pt-BR': 'o sufixo do nome' },
  nickname: { en: 'nickname', 'pt-BR': 'o apelido' },
  'organization-title': { en: 'job title', 'pt-BR': 'o cargo' },
  username: { en: 'username', 'pt-BR': 'o nome de usuário', types: ['text', 'search', 'email'] },
  'new-password': { en: 'new password', 'pt-BR': 'a nova senha', types: ['text', 'search', 'password'] },
  'current-password': { en: 'current password', 'pt-BR': 'a senha atual', types: ['text', 'search', 'password'] },
  organization: { en: 'company name', 'pt-BR': 'o nome da empresa' },
  'street-address': { en: 'street address', 'pt-BR': 'o endereço' },
  'address-line1': { en: 'first line of the street address', 'pt-BR': 'a primeira linha do endereço' },
  'address-line2': { en: 'second line of the street address', 'pt-BR': 'a segunda linha do endereço' },
  'address-line3': { en: 'third line of the street address', 'pt-BR': 'a terceira linha do endereço' },
  'address-level4': { en: 'most specific part of the address', 'pt-BR': 'a parte mais específica do endereço' },
  'address-level3': { en: 'third administrative level of the address', 'pt-BR': 'o terceiro nível administrativo do endereço' },
  'address-level2': { en: 'city or town', 'pt-BR': 'a cidade' },
  'address-level1': { en: 'state or province', 'pt-BR': 'o estado ou a província' },
  country: { en: 'country code', 'pt-BR': 'o código do país' },
  'country-name': { en: 'country', 'pt-BR': 'o país' },
  'postal-code': { en: 'postal code', 'pt-BR': 'o CEP' },
  'cc-name': { en: 'name on the card', 'pt-BR': 'o nome no cartão' },
  'cc-given-name': { en: 'first name on the card', 'pt-BR': 'o primeiro nome no cartão' },
  'cc-additional-name': { en: 'middle name on the card', 'pt-BR': 'o nome do meio no cartão' },
  'cc-family-name': { en: 'last name on the card', 'pt-BR': 'o sobrenome no cartão' },
  'cc-number': { en: 'card number', 'pt-BR': 'o número do cartão', types: NUMERIC },
  'cc-exp': { en: 'card expiry date', 'pt-BR': 'a validade do cartão', types: ['text', 'search', 'month', 'tel'] },
  'cc-exp-month': { en: 'card expiry month', 'pt-BR': 'o mês de validade do cartão', types: NUMERIC },
  'cc-exp-year': { en: 'card expiry year', 'pt-BR': 'o ano de validade do cartão', types: NUMERIC },
  'cc-csc': { en: 'card security code', 'pt-BR': 'o código de segurança do cartão', types: NUMERIC },
  'cc-type': { en: 'card type', 'pt-BR': 'o tipo de cartão' },
  'transaction-currency': { en: 'preferred currency', 'pt-BR': 'a moeda preferida' },
  'transaction-amount': { en: 'amount to pay', 'pt-BR': 'o valor a pagar', types: NUMERIC },
  language: { en: 'preferred language', 'pt-BR': 'o idioma preferido' },
  bday: { en: 'date of birth', 'pt-BR': 'a data de nascimento', types: ['text', 'search', 'date'] },
  'bday-day': { en: 'day of birth', 'pt-BR': 'o dia do nascimento', types: NUMERIC },
  'bday-month': { en: 'month of birth', 'pt-BR': 'o mês do nascimento', types: NUMERIC },
  'bday-year': { en: 'year of birth', 'pt-BR': 'o ano do nascimento', types: NUMERIC },
  sex: { en: 'gender identity', 'pt-BR': 'a identidade de gênero' },
  url: { en: 'website', 'pt-BR': 'o site', types: URL_TYPES },
  photo: { en: 'photo', 'pt-BR': 'a foto', types: URL_TYPES },
  tel: { en: 'telephone number', 'pt-BR': 'o telefone', types: TEL },
  'tel-country-code': { en: 'telephone country code', 'pt-BR': 'o código do país do telefone', types: TEL },
  'tel-national': { en: 'telephone number without the country code', 'pt-BR': 'o telefone sem o código do país', types: TEL },
  'tel-area-code': { en: 'telephone area code', 'pt-BR': 'o DDD do telefone', types: TEL },
  'tel-local': { en: 'local telephone number', 'pt-BR': 'o número local do telefone', types: TEL },
  'tel-local-prefix': { en: 'first part of the local telephone number', 'pt-BR': 'a primeira parte do número local', types: TEL },
  'tel-local-suffix': { en: 'second part of the local telephone number', 'pt-BR': 'a segunda parte do número local', types: TEL },
  'tel-extension': { en: 'telephone extension', 'pt-BR': 'o ramal', types: TEL },
  email: { en: 'email address', 'pt-BR': 'o e-mail', types: ['text', 'search', 'email'] },
  impp: { en: 'instant messaging address', 'pt-BR': 'o endereço de mensagens instantâneas', types: URL_TYPES },
} as const satisfies Record<string, Purpose>

export type PurposeToken = keyof typeof PURPOSES

/** Valid in HTML but not among WCAG's purposes, so a field that asks for it does not fall under 1.3.5. */
const OTHER_FIELDS: Record<string, Purpose> = {
  'one-time-code': { en: 'one-time code', 'pt-BR': 'o código de uso único', types: ['text', 'search', 'password'] },
}

/** Field names that may take a home, work, mobile, fax or pager qualifier. */
const CONTACT_FIELDS = new Set(['tel', 'tel-country-code', 'tel-national', 'tel-area-code', 'tel-local', 'tel-local-prefix', 'tel-local-suffix', 'tel-extension', 'email', 'impp'])
const QUALIFIERS = new Set(['home', 'work', 'mobile', 'fax', 'pager'])
const LOCATIONS = new Set(['billing', 'shipping'])
/** Values that turn autofill off or on; axe-core accepts the common invented ones too. */
const STATES = new Set(['on', 'off', 'none', 'false', 'true', 'disabled', 'enabled', 'undefined', 'null', 'xoff', 'xon'])

export const PURPOSE_TOKENS = Object.keys(PURPOSES) as PurposeToken[]

export function isPurpose(token: string): token is PurposeToken {
  return Object.hasOwn(PURPOSES, token)
}

export function describeField(token: string, locale: 'en' | 'pt-BR'): string | undefined {
  const entry = (PURPOSES as Record<string, Purpose>)[token] ?? OTHER_FIELDS[token]
  return entry?.[locale]
}

export type AutocompleteValue =
  | { kind: 'missing' }
  /** on, off or another value that turns autofill on or off without naming a purpose. */
  | { kind: 'state'; raw: string }
  | { kind: 'token'; raw: string; field: string; section?: string | undefined; location?: string | undefined; qualifier?: string | undefined; webauthn: boolean }
  | { kind: 'invalid'; raw: string }

/** Reads an autocomplete value the way axe-core validates it: [section-*] [billing|shipping] [qualifier] field [webauthn]. */
export function parseAutocomplete(raw: string | undefined): AutocompleteValue {
  if (raw === undefined || raw.trim() === '') return { kind: 'missing' }
  const value = raw.trim()
  const terms = value.toLowerCase().split(/\s+/)
  if (terms.length === 1 && STATES.has(terms[0] ?? '')) return { kind: 'state', raw: value }
  const webauthn = terms.at(-1) === 'webauthn'
  if (webauthn) terms.pop()
  let section: string | undefined
  let location: string | undefined
  let qualifier: string | undefined
  if ((terms[0]?.length ?? 0) > 8 && terms[0]?.startsWith('section-')) section = terms.shift()
  if (LOCATIONS.has(terms[0] ?? '')) location = terms.shift()
  if (QUALIFIERS.has(terms[0] ?? '')) qualifier = terms.shift()
  const field = terms[0] ?? ''
  const known = isPurpose(field) || Object.hasOwn(OTHER_FIELDS, field)
  if (terms.length !== 1 || !known || (qualifier && !CONTACT_FIELDS.has(field))) return { kind: 'invalid', raw: value }
  return { kind: 'token', raw: value, field, section, location, qualifier, webauthn }
}

/** The input type as the browser reads it: missing or unknown types are text. */
export function inputType(tag: string, type: string | undefined): string {
  if (tag !== 'input') return tag
  const normalized = (type ?? '').trim().toLowerCase()
  return INPUT_TYPES.has(normalized) ? normalized : 'text'
}

const INPUT_TYPES = new Set([
  'button', 'checkbox', 'color', 'date', 'datetime-local', 'email', 'file', 'hidden', 'image', 'month', 'number',
  'password', 'radio', 'range', 'reset', 'search', 'submit', 'tel', 'text', 'time', 'url', 'week',
])

/** Whether the token may go on this control; mirrors axe-core's autocomplete-appropriate check. */
export function isAppropriate(token: string, control: string): boolean {
  if (control === 'select' || control === 'textarea') return true
  const entry = (PURPOSES as Record<string, Purpose>)[token] ?? OTHER_FIELDS[token]
  return (entry?.types ?? ['text']).includes(control)
}

/**
 * Tokens close enough that calling one wrong for the other would be noise rather than a
 * failure: "tel" on a field that wants the number without the country code, "username"
 * on a sign-in field that takes the email address.
 */
const FAMILIES: readonly (readonly string[])[] = [
  ['tel', 'tel-national', 'tel-local'],
  ['street-address', 'address-line1'],
  ['country', 'country-name'],
  ['email', 'username'],
  ['new-password', 'current-password'],
  ['name', 'cc-name'],
  ['given-name', 'cc-given-name'],
  ['family-name', 'cc-family-name'],
  ['additional-name', 'cc-additional-name'],
]

export function samePurpose(a: string, b: string): boolean {
  return a === b || FAMILIES.some((family) => family.includes(a) && family.includes(b))
}

/** The value to write: the purpose, keeping the section and billing or shipping, and a qualifier where it still applies. */
export function autocompleteValueFor(purpose: PurposeToken, current: AutocompleteValue): string {
  if (current.kind !== 'token') return purpose
  const qualifier = current.qualifier && CONTACT_FIELDS.has(purpose) ? current.qualifier : undefined
  const webauthn = current.webauthn && (purpose === 'username' || purpose === 'current-password') ? 'webauthn' : undefined
  return [current.section, current.location, qualifier, purpose, webauthn].filter(Boolean).join(' ')
}
