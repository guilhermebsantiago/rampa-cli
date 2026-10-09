import { parseAutocomplete } from '../criteria/autofill.ts'

/**
 * What a field asks for, and the ways people write it, for COGA o4p08 Accept Different Input Formats.
 * The variants are values people type as they write them on paper: "Dates, postal codes, and phone
 * numbers are a particular nightmare" (COGA §6.8.2, Sam). Region-specific purposes (postal codes, phone
 * numbers, dates) are checked only where the region is known, from the page language or the address.
 */

export type FormatPurpose = 'postal' | 'phone' | 'card' | 'cpf' | 'cnpj' | 'date' | 'account'

/** Identifiers, not quantities: a number field refuses how people write them. */
export const IDENTIFIERS: ReadonlySet<FormatPurpose> = new Set(['postal', 'phone', 'card', 'cpf', 'cnpj', 'account'])

export type Region = 'BR' | 'US' | 'GB'

/** Values people write, per purpose and region; the first ones keep their separators. Empty: not checked there. */
const VARIANTS: Record<FormatPurpose, Partial<Record<Region, readonly string[]>> & { any?: readonly string[] }> = {
  postal: {
    BR: ['01310-100', '01310100'],
    US: ['94103-1234', '94103'],
    GB: ['SW1A 1AA', 'SW1A1AA', 'sw1a 1aa'],
  },
  phone: {
    BR: ['(11) 91234-5678', '11 91234-5678', '11912345678', '+55 11 91234-5678'],
    US: ['(415) 555-0123', '415-555-0123', '415 555 0123', '+1 415 555 0123'],
    GB: ['020 7946 0018', '+44 20 7946 0018', '07700 900123'],
  },
  card: { any: ['4111 1111 1111 1111', '4111111111111111'] },
  cpf: { any: ['123.456.789-09', '12345678909'] },
  cnpj: { any: ['12.345.678/0001-95', '12345678000195'] },
  date: {
    BR: ['25/12/1990', '5/3/1990'],
    US: ['12/25/1990', '3/5/1990'],
    GB: ['25/12/1990', '5/3/1990'],
  },
  // Bank account numbers differ by bank: only a number field is claimed, never a pattern or a length.
  account: {},
}

/** Values for the message about a number field, when the region is not known: any of them has separators. */
const NUMBER_EXAMPLES: Record<FormatPurpose, string> = {
  postal: '94103-1234',
  phone: '+1 415 555 0123',
  card: '4111 1111 1111 1111',
  cpf: '123.456.789-09',
  cnpj: '12.345.678/0001-95',
  date: '12/25/1990',
  account: '12345-6',
}

export function variantsFor(purpose: FormatPurpose, region: Region | undefined): readonly string[] {
  const table = VARIANTS[purpose]
  return table.any ?? (region ? (table[region] ?? []) : [])
}

/** A value with separators, for the message about a number field. */
export function exampleWithSeparators(purpose: FormatPurpose, region: Region | undefined): string {
  const separated = variantsFor(purpose, region).find((value) => /[^\dA-Za-z]/.test(value))
  if (separated) return separated
  if (purpose === 'postal' && region === 'BR') return '01310-100'
  return NUMBER_EXAMPLES[purpose]
}

/** The region whose formats apply: the page language's region, else the address's country. */
export function regionOf(language: string, target: string): Region | undefined {
  const [primary, ...rest] = language.toLowerCase().split('-')
  const region = rest.find((part) => part.length === 2)?.toUpperCase()
  if (region === 'BR' || region === 'US' || region === 'GB') return region
  if (region === 'UK') return 'GB'
  if (region) return undefined
  let host = ''
  try {
    host = new URL(target).hostname
  } catch {
    // a file or a snapshot: no address to read
  }
  if (host.endsWith('.br')) return 'BR'
  if (host.endsWith('.uk')) return 'GB'
  if (host.endsWith('.gov') || host.endsWith('.us')) return 'US'
  // Portuguese with no region and no Brazilian address: Portugal writes these values differently.
  if (primary === 'pt') return host === '' ? 'BR' : undefined
  return undefined
}

const KEYWORDS: Array<[FormatPurpose, RegExp]> = [
  ['cnpj', /\bcnpj\b/],
  ['cpf', /\bcpf\b/],
  // "Caixa postal" is a PO box, not a postal code: "postal" alone is not enough.
  ['postal', /\b(?:cep|zip|zipcode|zip code|postcode|post code|postal code|codigo postal)\b/],
  ['phone', /\b(?:telefone|celular|fone|tel|phone|telephone|mobile|whatsapp|cell)\b/],
  ['card', /\b(?:cartao de credito|cartao de debito|numero do cartao|credit card|debit card|card number|cardnumber|cc number|ccnumber|ccnum)\b/],
  ['date', /\b(?:data de nascimento|nascimento|date of birth|birth date|birthdate|dob|birthday)\b/],
  ['account', /\b(?:numero da conta|conta corrente|conta poupanca|agencia|account number|sort code|routing number)\b/],
]
/** "Data" is a date only in Portuguese; in English it is data. */
const DATE_WORD: Record<string, RegExp> = { pt: /\bdata\b/, en: /\bdate\b/ }
/** A health card ("Cartão SUS", the CNS) is not a payment card. */
const NOT_PAYMENT_CARD = /\b(?:sus|cns|cartao nacional de saude|saude)\b/

/** Split fields (tel-area-code, bday-day) and national numbers are left out: their parts have formats of their own. */
const TOKEN_PURPOSES: Record<string, FormatPurpose> = {
  'postal-code': 'postal',
  tel: 'phone',
  'cc-number': 'card',
  bday: 'date',
}

export interface PurposeFinding {
  purpose: FormatPurpose
  from: 'autocomplete' | 'type' | 'inputmode' | 'keywords'
  /** The keyword, the token or the type it came from. */
  evidence: string
}

/**
 * The field's purpose: from its autocomplete token, then words in its name, id or label, then its type or
 * inputmode. The plan puts type before the words; they come second here because type="tel" is a common way
 * to get a numeric keypad on a CPF or CEP field, and a CPF field checked against phone formats would be
 * wrong. Words that point to two purposes ("CPF ou CNPJ") give none: no single format applies.
 */
export function purposeOf(field: {
  autocomplete?: string | undefined
  type: string
  inputmode?: string | undefined
  words: string[]
  language: string
}): PurposeFinding | undefined {
  const token = parseAutocomplete(field.autocomplete)
  if (token.kind === 'token' && TOKEN_PURPOSES[token.field]) return { purpose: TOKEN_PURPOSES[token.field] as FormatPurpose, from: 'autocomplete', evidence: `autocomplete="${token.raw}"` }
  const text = field.words.map(normalizeWords).join(' | ')
  const found = new Map<FormatPurpose, string>()
  const dateWord = DATE_WORD[field.language.split('-')[0]?.toLowerCase() ?? '']
  for (const [purpose, pattern] of [...KEYWORDS, ...(dateWord ? [['date', dateWord] as [FormatPurpose, RegExp]] : [])]) {
    const match = pattern.exec(text)
    if (!match || found.has(purpose)) continue
    if (purpose === 'card' && NOT_PAYMENT_CARD.test(text)) continue
    found.set(purpose, match[0])
  }
  if (found.size === 1) {
    const [purpose, keyword] = [...found][0] as [FormatPurpose, string]
    return { purpose, from: 'keywords', evidence: keyword }
  }
  if (found.size > 1) return undefined
  if (field.type === 'tel') return { purpose: 'phone', from: 'type', evidence: 'type="tel"' }
  if (field.inputmode?.toLowerCase() === 'tel') return { purpose: 'phone', from: 'inputmode', evidence: 'inputmode="tel"' }
  return undefined
}

/** Lowercase, no accents, camelCase and snake_case split: "txtCpf" and "cpf_titular" both read "cpf". */
export function normalizeWords(text: string): string {
  return text
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[_\-.[\]]+/g, ' ')
}

export type CompiledPattern = { ok: true; regex: RegExp; source: string } | { ok: false; source: string }

/**
 * A pattern attribute as the browser compiles it (HTML, the pattern attribute): anchored as ^(?:…)$ with
 * the v flag. A pattern that does not compile is ignored by browsers, so nothing is claimed from it.
 */
export function compilePattern(pattern: string): CompiledPattern {
  const source = `^(?:${pattern})$`
  try {
    return { ok: true, regex: new RegExp(source, 'v'), source: `/${source}/v` }
  } catch {
    return { ok: false, source: `/${source}/v` }
  }
}

const EXAMPLE_MARKER = /(?:\bex(?:emplo)?\.?:|\bex\.|\bpor exemplo:?|\be\.g\.:?|\bfor example:?|\bexample:|\beg:)\s*/giu

/**
 * Examples of a value shown with a field: a placeholder that looks like a value, and what follows "Ex.:",
 * "exemplo:", "e.g." or "for example" in its label or hint. An example has a digit, and letters only in a
 * postcode: "dd/mm/aaaa" describes a format, it is not a value.
 */
export function examplesIn(texts: Array<string | undefined>, placeholder: string | undefined, purpose: FormatPurpose): string[] {
  const out = new Set<string>()
  const valueLike = (value: string) => /\d/.test(value) && (purpose === 'postal' ? /^[\dA-Za-z().\-/+ ]+$/ : /^[\d().\-/+ ]+$/).test(value)
  const clean = (value: string) => value.replace(/[.,;:]+$/, '').replace(/^\((.*)\)$/, '$1').trim()
  if (placeholder && valueLike(clean(placeholder))) out.add(clean(placeholder))
  for (const text of [placeholder, ...texts]) {
    if (!text) continue
    for (const marker of text.matchAll(EXAMPLE_MARKER)) {
      const rest = text.slice((marker.index ?? 0) + marker[0].length)
      const pieces = rest.split(/\s+/).slice(0, 4)
      // The longest run of pieces that reads as a value: "(11) 91234-5678" is two pieces, "123.456.789-09 (só números)" one.
      for (let count = pieces.length; count >= 1; count--) {
        let value = clean(pieces.slice(0, count).join(' '))
        if (value.endsWith(')') && !value.includes('(')) value = value.slice(0, -1)
        if (valueLike(value)) {
          out.add(value)
          break
        }
      }
    }
  }
  return [...out]
}
