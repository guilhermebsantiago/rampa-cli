import type { Browser, Page } from 'playwright-core'
import type { ProbeRecord } from '../snapshot/schema.ts'
import { allowClipboard, pasteShortcut, readClipboard, withClipboard, writeClipboard } from './clipboard.ts'
import type { InPageElement, Kit } from './kit.ts'
import { type ProbeOptions, openProbePage, skippedRecord } from './page.ts'

/**
 * Accessible Authentication (Minimum), 3.3.8. On a fresh page, the probe finds the steps of an authentication
 * process the page shows: sign-in (a password, a one-time code, or an identifier asked first) and recovery ("Forgot
 * your password?"). Sign-up and change-password forms are recorded and left out, as the Understanding leaves account
 * creation out. For each step it records:
 *
 * - every password and code field, with its type, `autocomplete`, the attributes that tell password managers to skip
 *   it (`data-lpignore`, `data-1p-ignore`, `data-bwignore`, `data-form-type="other"`), whether it is read-only after it
 *   takes focus (some pages lift `readonly` on focus to stop autofill), and the event listeners it has;
 * - a **trusted paste** into each of those fields (src/probes/clipboard.ts): a dummy value is written to the
 *   clipboard, the field takes focus, and the real Ctrl+V (Cmd+V on macOS) is pressed. Whether the value arrived is
 *   read back from the field, or from the boxes of a code split one character per box, joined, ignoring spaces and
 *   separators, so a field that trims or reformats what is pasted passes. A paste that did not arrive is tried a
 *   second time; then one key is typed, to tell a field that refuses pastes from one that refuses all input. The
 *   field gets its value back afterwards;
 * - an on-screen keypad next to a read-only password field (buttons of single digits, or pairs such as "1 ou 7");
 * - text that asks for some characters of a password ("Enter the 2nd, 6th and last characters", F109), arithmetic
 *   ("Quanto é 3 + 4?"), and image CAPTCHAs with a field to transcribe them into, quoted;
 * - CAPTCHA widgets, classified by what they ask: object recognition (reCAPTCHA's and hCaptcha's image challenges,
 *   which the criterion excepts at AA), none (reCAPTCHA v3, Turnstile, Friendly Captcha), or a cognitive test.
 *   No CAPTCHA is ever clicked or solved;
 * - other ways to sign in that the page offers (a passkey, "Sign in with…", "Email me a link"), and links to sign-in
 *   and recovery pages.
 *
 * Observe class, with one exception the plan names (4.4): it types a dummy value into password and code fields, and
 * clears it. It never presses Enter, never clicks, never submits; the network guard blocks any POST a field sends on
 * its own when it is full, and cancels form submission.
 */

export const AUTH_VERSION = '1'
const TIME_BUDGET_MS = 60_000
const MAX_STEPS = 6
const MAX_FIELDS = 10
/** How long a paste is given to land, and a key to be typed. */
const LAND_MS = 250
/** The dummy values: never a real secret, and easy to recognize in the guard's log. */
export const DUMMY_PASSWORD = 'Rampa-probe-7319'
export const DUMMY_CODE = '73192846'

export interface PasteTrial {
  /** The value pasted (a dummy, cut to the field's maxlength; digits for a numeric field or a code). */
  value: string
  /** What the field held after each paste (the boxes joined, for a split code). */
  reads: string[]
  /** The value arrived, as written or with spaces and separators taken out or reformatted. */
  arrived: boolean
  /** The paste and beforeinput events the page received, whether they were trusted, and whether a handler cancelled them (null: not seen bubbling). */
  events: Array<{ type: string; trusted: boolean; prevented: boolean | null }>
  /** After a paste that did not arrive, one key typed into the field, and whether it arrived. */
  typed?: { key: string; arrived: boolean } | undefined
  /** The clipboard held the value right before the paste. */
  clipboard: boolean
  /** Requests the guard blocked during the trial, and navigations it answered: a field that sends itself when full. */
  guarded: number
  /** The field got its own value back. */
  restored: boolean
}

export interface Keypad {
  /** Buttons that type a digit, or a pair of digits ("1 ou 7"). */
  buttons: number
  samples: string[]
  /** Each button stands for two digits: the person must work out which of their own. */
  paired: boolean
}

export interface AuthField {
  el: InPageElement
  kind: 'password' | 'code' | 'identifier'
  type: string
  autocomplete: string
  ignore: string[]
  /** A text field drawn as dots with -webkit-text-security, which password managers do not take for a password field. */
  masked?: boolean | undefined
  /** Read-only when the page loaded, and still after it took focus. */
  readonlyAtLoad: boolean
  readonly: boolean
  maxlength?: number | undefined
  inputmode?: string | undefined
  /** Its visible label, or its name. */
  label: string
  /** A code with one box per character: the boxes, in order (the field is the first). */
  group?: InPageElement[] | undefined
  /** Event types it listens to that can stop a paste or a key: paste, beforeinput, input, keydown, keypress. Null: not read. */
  listeners?: string[] | null | undefined
  paste?: PasteTrial | undefined
  keypad?: Keypad | undefined
}

export interface AuthStep {
  /** The form, or the element that holds the fields and a button when there is no form. */
  el: InPageElement
  kind: 'login' | 'recovery' | 'sign-up' | 'change-password'
  /** What decided the kind, quoted: the button, the heading, the fields. */
  why: string
  fields: AuthField[]
  /** Visible texts of the step (labels, legends, instructions, headings), at most 20, cut to 200 characters. */
  texts: string[]
  /** Text that asks for some characters of a secret (F109), quoted. */
  partial?: string | undefined
  /** An arithmetic question, quoted. */
  arithmetic?: string | undefined
  /** An image CAPTCHA with a field to transcribe it into: the instruction or the image's name, quoted. */
  transcription?: { quote: string; image?: InPageElement | undefined } | undefined
  submit?: string | undefined
}

export interface Captcha {
  el: InPageElement
  /** reCAPTCHA, hCaptcha, Turnstile, Friendly Captcha, Arkose, GeeTest, image, or unknown. */
  vendor: string
  /** What it asks of a person, as far as the page shows: object recognition (excepted at AA), nothing, a cognitive test, or unknown. */
  kind: 'object-recognition' | 'personal-content' | 'cognitive-test' | 'no-test' | 'unknown'
  why: string
  /** The step it sits in (index into steps), or -1. */
  step: number
}

export interface AuthData {
  viewport: { width: number; height: number }
  steps: AuthStep[]
  /** Forms with password or code fields that are not showing (a closed menu or dialog): never opened. */
  hidden: Array<{ el: InPageElement; kind: string }>
  captchas: Captcha[]
  /** Other ways to sign in the page offers, near a step. */
  alternatives: Array<{ el: InPageElement; text: string; step: number }>
  /** Links that lead to sign-in or recovery pages, which the probe does not follow. */
  links: Array<{ text: string; href: string; kind: 'login' | 'recovery' }>
  /** A bot check that covers the page instead of its content (DataDome, a "Just a moment" challenge): its vendor or title. */
  wall?: string | undefined
  /** The address the page landed on after its own redirects (an SSO sign-in), when it is not the one asked for. */
  landed?: string | undefined
  /** Whether the page could use the clipboard; without it, nothing was pasted. */
  clipboard: 'ok' | 'unavailable'
  end: 'complete' | 'time' | 'no-steps'
}

interface AuthKit {
  find(budget: { maxSteps: number; maxFields: number }): Omit<AuthData, 'viewport' | 'clipboard' | 'end'>
  /** Scrolls the field into view, focuses it, reads whether it is read-only now, and empties it (and its boxes). */
  prepare(ref: string, group: string[]): { ok: boolean; readonly: boolean; values: string[] }
  /** The field's value, or its boxes' joined. */
  read(ref: string, group: string[]): string
  focus(ref: string): boolean
  empty(ref: string, group: string[]): void
  /** Puts the values back, with input and change events, and takes focus away. */
  restore(ref: string, group: string[], values: string[]): boolean
  /** paste and beforeinput events since the last drain. */
  drain(): Array<{ type: string; trusted: boolean; prevented: boolean | null }>
}

/** Runs in the page; needs the probe kit. Installs `window.__rampaAuth`. Serialized: references nothing outside its body. */
export function installAuthKit(): void {
  const w = window as unknown as { __rampaAuth?: AuthKit; __rampaKit: Kit }
  if (w.__rampaAuth) return
  const kit = w.__rampaKit
  const collapse = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim()
  const short = (text: string, max = 200) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)
  const shown = (el: Element): boolean => {
    if (!kit.visible(el)) return false
    const r = el.getBoundingClientRect()
    return r.width >= 2 && r.height >= 2
  }
  const deepAll = (selector: string): Element[] => {
    const found: Element[] = []
    const visit = (root: Document | ShadowRoot) => {
      for (const el of Array.from(root.querySelectorAll(selector))) found.push(el)
      for (const el of Array.from(root.querySelectorAll('*'))) if (el.shadowRoot) visit(el.shadowRoot)
    }
    visit(document)
    return found
  }
  const textOf = (el: Element) => collapse((el as HTMLElement).innerText ?? el.textContent)
  const labelOf = (field: Element): string => {
    const labels = Array.from((field as HTMLInputElement).labels ?? []).map(textOf).filter(Boolean)
    if (labels[0]) return short(labels[0], 120)
    const by = (field.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean)
    const root = field.getRootNode() as Document | ShadowRoot
    const named = by.map((id) => root.getElementById?.(id)).filter((el): el is HTMLElement => !!el).map(textOf).join(' ')
    return short(collapse(named || field.getAttribute('aria-label') || field.getAttribute('placeholder') || field.getAttribute('title') || field.getAttribute('name') || field.id), 120)
  }

  // ---- what a field is ------------------------------------------------------------------------------------------
  const TEXTLIKE = /^(text|password|email|tel|number|search|url|)$/
  const CODE_WORDS = /\b(otp|one[-\s]?time|verification|verify|security code|auth(entication)? code|access code|login code|sms code|2fa|mfa|totp|token|c[oó]digo (de )?(verifica[cç][aã]o|seguran[cç]a|acesso|autentica[cç][aã]o|confirma[cç][aã]o|sms)|c[oó]digo enviado|c[oó]digo de \d|code (sent|from)|verificaci[oó]n)\b/i
  const ID_WORDS = /user|login|e-?mail|cpf|cnpj|usu[aá]rio|usuario|matr[ií]cula|account|conta|cuenta|identif|documento|nis\b|celular|phone|telefone|tel[eé]fono/i
  const CAPTCHA = /captcha|captch/i
  const description = (el: Element) => [el.getAttribute('name'), el.id, el.getAttribute('autocomplete'), el.getAttribute('placeholder'), el.getAttribute('aria-label'), labelOf(el)].join(' ')
  const isPassword = (el: Element): boolean => {
    if (!(el instanceof HTMLInputElement)) return false
    if (el.type === 'password') return true
    // autocomplete="new-password" alone is a common trick to keep autofill off any field (a CPF): not a password.
    if (/current-password/.test(el.autocomplete)) return true
    const security = getComputedStyle(el).getPropertyValue('-webkit-text-security')
    return TEXTLIKE.test(el.type) && !!security && security !== 'none'
  }
  const isCode = (el: Element): boolean => {
    if (!(el instanceof HTMLInputElement) || !TEXTLIKE.test(el.type) || CAPTCHA.test(description(el))) return false
    return /one-time-code/.test(el.autocomplete) || CODE_WORDS.test(description(el))
  }
  const isIdentifier = (el: Element): boolean => {
    if (!(el instanceof HTMLInputElement) || !TEXTLIKE.test(el.type) || el.type === 'password' || CAPTCHA.test(description(el))) return false
    return /username|email|webauthn/.test(el.autocomplete) || el.type === 'email' || ID_WORDS.test(description(el))
  }
  /** One box per character: at least four short boxes side by side in one container. */
  const groupOf = (el: Element): Element[] | null => {
    if (!(el instanceof HTMLInputElement)) return null
    const short1 = (f: Element) => f instanceof HTMLInputElement && TEXTLIKE.test(f.type) && ((f.maxLength > 0 && f.maxLength <= 2) || f.getBoundingClientRect().width <= 64)
    if (!short1(el)) return null
    for (let box: Element | null = el.parentElement, depth = 0; box && depth < 3; box = box.parentElement, depth++) {
      const boxes = Array.from(box.querySelectorAll('input')).filter((f) => shown(f) && short1(f))
      if (boxes.length >= 4 && boxes.length <= 12) return boxes
    }
    return null
  }

  // ---- steps ----------------------------------------------------------------------------------------------------
  const SIGNUP = /sign ?up|register|create (an |your |my )?account|join (now|us|free)|cadastr|criar (sua |uma |minha )?conta|registr|inscrev|crear (una |tu |mi )?cuenta|reg[ií]strate/i
  const RECOVERY = /forgot|reset|recover|lost your|trouble signing|esqueci|esqueceu|recuperar|recupere|redefinir|restablecer|olvid|recupera/i
  const LOGIN = /sign ?in|log ?in|entrar|acessar|acesse|login|iniciar sesi[oó]n|ingresar|continuar|continue|next|pr[oó]xim|avan[cç]ar|verify|verificar|confirmar|confirm|validar|autenticar|submit|enviar/i
  const CHANGE = /change (your )?password|update (your )?password|alterar (a |sua )?senha|trocar (a |sua )?senha|cambiar (la |tu )?contrase/i
  // An identifier asked first is a sign-in step only when the page says so: an e-mail field and "Send" may be a newsletter.
  const LOGIN_STRONG = /sign ?in|log ?in|entrar|acessar|acesse|login|iniciar sesi[oó]n|ingresar|identifique-se|autentica|my account|minha conta/i
  const NEWSLETTER = /newsletter|subscribe|assin|inscrev|suscrib|boletim|novidades|news/i
  const containerOf = (field: Element): Element => {
    const form = field.closest('form')
    if (form) return form
    for (let box: Element | null = field.parentElement, depth = 0; box && depth < 6; box = box.parentElement, depth++) {
      if (box.querySelector('button, [role="button"], input[type="submit"], input[type="button"]')) return box
    }
    return field.parentElement ?? document.body
  }
  const submitOf = (container: Element): string => {
    const buttons = Array.from(container.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"]')).filter(shown)
    const submit = buttons.find((b) => (b as HTMLButtonElement).type === 'submit') ?? buttons[buttons.length - 1]
    if (!submit) return ''
    return short(collapse(submit instanceof HTMLInputElement ? submit.value : textOf(submit) || submit.getAttribute('aria-label')), 80)
  }
  const headingOf = (container: Element): string => {
    const own = container.querySelector('h1, h2, h3, legend, [role="heading"]')
    if (own && shown(own)) return short(textOf(own), 120)
    // The nearest heading before the step, within its section.
    let node: Element | null = container
    for (let depth = 0; node && depth < 4; depth++, node = node.parentElement) {
      for (let prev = node.previousElementSibling; prev; prev = prev.previousElementSibling) {
        const heading = prev.matches('h1, h2, h3, [role="heading"]') ? prev : prev.querySelector('h1, h2, h3, [role="heading"]')
        if (heading && shown(heading)) return short(textOf(heading), 120)
      }
    }
    return ''
  }
  const textsOf = (container: Element): string[] => {
    const out: string[] = []
    const seen = new Set<string>()
    const add = (text: string) => {
      const value = short(collapse(text))
      if (value && !seen.has(value) && out.length < 20) {
        seen.add(value)
        out.push(value)
      }
    }
    for (const el of Array.from(container.querySelectorAll('h1, h2, h3, h4, legend, label, p, li, small, span, div, td, img[alt]'))) {
      if (!shown(el)) continue
      if (el.localName === 'img') {
        add(el.getAttribute('alt') ?? '')
        continue
      }
      // Leaf text: the element's own text nodes, so a wrapper does not repeat its children's.
      const own = Array.from(el.childNodes).filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent ?? '').join(' ')
      if (collapse(own)) add(own)
    }
    for (const field of Array.from(container.querySelectorAll('input, select, textarea'))) {
      const placeholder = field.getAttribute('placeholder')
      if (placeholder && shown(field)) add(placeholder)
    }
    return out
  }
  const PARTIAL = [
    /\b(?:enter|type|provide|input|select|give)\b[^.?!]{0,60}?\b(?:\d{1,2}(?:st|nd|rd|th)|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last)\b[^.?!]{0,80}?\b(?:characters?|digits?|letters?)\b[^.?!]*/i,
    /\b(?:characters?|digits?|letters?)\s+\d{1,2}(?:\s*(?:,|and|&)\s*\d{1,2})+\b[^.?!]*/i,
    /\b(?:digite|informe|insira|preencha|selecione|indique)\b[^.?!]{0,60}?(?:\d{1,2}\s*[ºª°]|\bprimeir[oa]|\bsegund[oa]|\bterceir[oa]|\bquart[oa]|\bquint[oa]|\bsext[oa]|\bs[ée]tim[oa]|\boitav[oa]|\bnon[oa]|\bd[ée]cim[oa]|\b[úu]ltim[oa])[^.?!]{0,80}?\b(?:caracteres?|d[íi]gitos?|letras?|posi[çc][õo]es|posi[çc][ãa]o)\b[^.?!]*/i,
    /\b(?:caracteres?|d[íi]gitos?|letras?|posi[çc][õo]es)\s+\d{1,2}(?:\s*(?:,|e)\s*\d{1,2})+\b[^.?!]*/i,
    /\b(?:introduce|introduzca|escribe|escriba|indique|ingresa|ingrese)\b[^.?!]{0,60}?(?:\d{1,2}\s*[ºª°]|\bprimer[oa]?|\bsegund[oa]|\btercer[oa]?|\bcuart[oa]|\bquint[oa]|\bsext[oa]|\bs[ée]ptim[oa]|\boctav[oa]|\b[úu]ltim[oa])[^.?!]{0,80}?\b(?:caracteres?|car[áa]cter|d[íi]gitos?|letras?|posici[oó]n(?:es)?)\b[^.?!]*/i,
  ]
  const ORDINAL = 'first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last|primeir[oa]|segund[oa]|terceir[oa]|quart[oa]|quint[oa]|sext[oa]|s[ée]tim[oa]|oitav[oa]|[úu]ltim[oa]|primer[oa]?|tercer[oa]?|s[ée]ptim[oa]|octav[oa]'
  const UNIT = 'character|digit|letter|caractere|d[íi]gito|letra|car[áa]cter'
  const POSITION_LABEL = new RegExp(`^(?:(?:\\d{1,2}\\s*(?:st|nd|rd|th|º|ª|°)?|${ORDINAL})\\s*(?:${UNIT})|(?:${UNIT})\\s*(?:n[ºo°.]?\\s*)?\\d{1,2})`, 'i')
  const ORDINAL_NUMBER: Array<[RegExp, number]> = [[/first|primeir|primer/i, 1], [/second|segund/i, 2], [/third|terceir|tercer/i, 3], [/fourth|quart|cuart/i, 4], [/fifth|quint/i, 5], [/sixth|sext/i, 6], [/seventh|s[ée]tim|s[ée]ptim/i, 7], [/eighth|oitav|octav/i, 8], [/last|[úu]ltim/i, -1]]
  /** Fields that each ask one position of a secret, when they ask only some of them (2, 6, last): a code split into boxes 1 to N asks it all. */
  const asksSomePositions = (fields: Element[]): boolean => {
    const positions = fields.map((f) => labelOf(f)).filter((label) => POSITION_LABEL.test(label)).map((label) => {
      const digits = /(\d{1,2})/.exec(label)
      if (digits) return Number(digits[1])
      return ORDINAL_NUMBER.find(([re]) => re.test(label))?.[1] ?? 0
    })
    if (positions.length < 2) return false
    const sorted = [...positions].sort((a, b) => a - b)
    return !sorted.every((n, i) => n === i + 1)
  }
  const ARITHMETIC = /(?:\b(?:what\s+is|how\s+much\s+is|quanto\s+[ée]|qual\s+[ée]\s+o\s+resultado\s+de|cu[áa]nto\s+es|solve|resolva|calcule|resuelva)\b[^.?!=]{0,20}?)?\b\d{1,3}\s*(?:\+|-|−|×|x|\*|÷|\/|plus|minus|times|mais|menos|vezes|m[áa]s)\s*\d{1,3}\s*(?:=\s*\?|=|\?)/i
  const TRANSCRIBE = /type the (characters|letters|text|code|word)s? (you see|shown|in the image|above|below)|enter the (characters|letters|text|code) (you see|shown|in the image|above|below)|digite (os caracteres|as letras|o texto|o c[oó]digo) (da imagem|que voc[eê] v[eê]|acima|abaixo|exibid)|informe (os caracteres|o c[oó]digo) da imagem|escriba (los caracteres|el texto) (de la imagen|que ve)/i

  const classify = (container: Element, fields: Element[]): { kind: AuthStep['kind']; why: string } | null => {
    const passwords = fields.filter(isPassword)
    const codes = fields.filter((f) => !isPassword(f) && (isCode(f) || groupOf(f) !== null))
    const identifiers = fields.filter((f) => !isPassword(f) && !isCode(f) && groupOf(f) === null && isIdentifier(f))
    const submit = submitOf(container)
    const heading = headingOf(container)
    const words = `${submit} ${heading}`
    const fresh = passwords.filter((f) => /new-password/.test((f as HTMLInputElement).autocomplete))
    const current = passwords.filter((f) => /current-password/.test((f as HTMLInputElement).autocomplete))
    if (CHANGE.test(words) || (fresh.length > 0 && current.length > 0)) return { kind: 'change-password', why: words.trim() || 'a current and a new password' }
    // Some characters of a secret, each in a field of its own (F109): several password fields, and still a sign-in.
    const partialText = textsOf(container).some((t) => PARTIAL.some((re) => re.test(t)))
    if ((partialText || asksSomePositions(fields)) && !(SIGNUP.test(submit) && !LOGIN.test(submit))) return { kind: 'login', why: 'fields for characters of a secret' }
    if (passwords.length >= 2 || (passwords.length > 0 && fresh.length === passwords.length) || (SIGNUP.test(submit) && !LOGIN.test(submit)) || (SIGNUP.test(heading) && !LOGIN.test(submit))) {
      return { kind: 'sign-up', why: fresh.length > 0 ? 'autocomplete="new-password"' : passwords.length >= 2 ? `${passwords.length} password fields` : words.trim() }
    }
    if (passwords.length === 0 && RECOVERY.test(`${words} ${document.title}`) && (codes.length > 0 || identifiers.length > 0)) return { kind: 'recovery', why: words.trim() || document.title }
    if (passwords.length > 0 || codes.length > 0) return { kind: 'login', why: passwords.length > 0 ? 'a password field' : 'a one-time code field' }
    if (identifiers.length > 0 && LOGIN_STRONG.test(`${words} ${document.title}`) && !SIGNUP.test(words) && !NEWSLETTER.test(`${words} ${textOf(container).slice(0, 300)}`)) return { kind: 'login', why: `the identifier first ("${submit || heading}")` }
    return null
  }

  const IGNORE_ATTRS = ['data-lpignore', 'data-1p-ignore', 'data-bwignore', 'data-form-type']
  const fieldFact = (el: Element, kind: AuthField['kind'], group: Element[] | null): AuthField => {
    const input = el as HTMLInputElement
    const security = getComputedStyle(el).getPropertyValue('-webkit-text-security')
    const ignore = IGNORE_ATTRS.filter((name) => el.hasAttribute(name) && (name !== 'data-form-type' || el.getAttribute(name) === 'other') && el.getAttribute(name) !== 'false').map((name) => `${name}="${el.getAttribute(name)}"`)
    return {
      el: kit.describe(el),
      kind,
      type: input.type,
      autocomplete: el.getAttribute('autocomplete') ?? '',
      ignore,
      ...(input.type !== 'password' && security && security !== 'none' ? { masked: true } : {}),
      readonlyAtLoad: input.readOnly,
      readonly: input.readOnly,
      ...(input.maxLength > 0 ? { maxlength: input.maxLength } : {}),
      ...(el.getAttribute('inputmode') ? { inputmode: el.getAttribute('inputmode') ?? '' } : {}),
      label: labelOf(el),
      ...(group ? { group: group.map((g) => kit.describe(g)) } : {}),
    }
  }

  const KEY_TEXT = /^\s*(\d)\s*$|^\s*(\d)\s*(?:ou|or|o|e|,|\/|-|\||ó)\s*(\d)\s*$/i
  const keypadNear = (field: Element, container: Element): Keypad | undefined => {
    // The step and at most two levels above it: digits farther away are pagination, a calendar, a phone number.
    for (let box: Element | null = container, depth = 0; box && box !== document.body && depth < 3; box = box.parentElement, depth++) {
      const keys = Array.from(box.querySelectorAll('button, [role="button"], input[type="button"], a, li, span, div'))
        .filter((k) => shown(k) && k.children.length <= 1)
        .map((k) => collapse(k instanceof HTMLInputElement ? k.value : textOf(k) || k.getAttribute('aria-label')))
        .filter((t) => KEY_TEXT.test(t))
      const unique = [...new Set(keys)]
      if (unique.length >= 5 && box.contains(field)) return { buttons: unique.length, samples: unique.slice(0, 6), paired: unique.some((t) => /\d\s*\D+\s*\d/.test(t)) }
    }
    return undefined
  }

  const find: AuthKit['find'] = (budget) => {
    const candidates = deepAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=submit]):not([type=button]):not([type=image]):not([type=file]), select')
    const byContainer = new Map<Element, Element[]>()
    for (const field of candidates) byContainer.set(containerOf(field), [...(byContainer.get(containerOf(field)) ?? []), field])
    const steps: AuthStep[] = []
    const hidden: AuthData['hidden'] = []
    let fieldCount = 0
    for (const [container, fields] of byContainer) {
      const visible = fields.filter(shown)
      const kind = classify(container, visible.length > 0 ? visible : fields)
      if (!kind) continue
      if (visible.length === 0 || !shown(container)) {
        hidden.push({ el: kit.describe(container), kind: kind.kind })
        continue
      }
      if (steps.length >= budget.maxSteps) continue
      const facts: AuthField[] = []
      const grouped = new Set<Element>()
      for (const field of visible) {
        if (grouped.has(field) || field.localName === 'select') continue
        const group = !isPassword(field) ? groupOf(field) : null
        if (group) for (const box of group) grouped.add(box)
        const role: AuthField['kind'] | null = isPassword(field) ? 'password' : group || isCode(field) ? 'code' : isIdentifier(field) ? 'identifier' : null
        if (!role) continue
        const fact = fieldFact(group ? (group[0] as Element) : field, role, group)
        if (role !== 'identifier' && fieldCount++ >= budget.maxFields) continue
        if (role === 'password' && (field as HTMLInputElement).readOnly) {
          const keypad = keypadNear(field, container)
          if (keypad) fact.keypad = keypad
        }
        facts.push(fact)
      }
      const texts = textsOf(container)
      const step: AuthStep = { el: kit.describe(container), kind: kind.kind, why: kind.why, fields: facts, texts }
      const submit = submitOf(container)
      if (submit) step.submit = submit
      const heading = headingOf(container)
      if (heading && !texts.includes(heading)) texts.unshift(heading)
      for (const text of texts) {
        for (const re of PARTIAL) {
          const m = re.exec(text)
          if (m && !step.partial) step.partial = short(collapse(m[0]))
        }
        const a = ARITHMETIC.exec(text)
        if (a && !step.arithmetic) step.arithmetic = short(text, 160)
        const t = TRANSCRIBE.exec(text)
        if (t && !step.transcription) step.transcription = { quote: short(text, 160) }
      }
      if (!step.partial && asksSomePositions(visible)) step.partial = visible.filter((f) => POSITION_LABEL.test(labelOf(f))).map((f) => labelOf(f)).join(', ')
      // An image CAPTCHA: a picture named for it, next to a field to type it into.
      const image = Array.from(container.querySelectorAll('img, canvas')).find((img) => shown(img) && CAPTCHA.test([img.getAttribute('src'), img.getAttribute('alt'), img.id, img.getAttribute('class'), img.getAttribute('title')].join(' ')))
      const typed = visible.find((f) => f instanceof HTMLInputElement && TEXTLIKE.test(f.type) && CAPTCHA.test(description(f)))
      if (image && typed) step.transcription = { quote: step.transcription?.quote ?? short(labelOf(typed) || image.getAttribute('alt') || 'captcha', 160), image: kit.describe(image) }
      steps.push(step)
    }

    // CAPTCHA widgets, wherever they are; tied to the step that holds them.
    const captchas: Captcha[] = []
    const stepOf = (el: Element) => {
      const index = steps.findIndex((s) => {
        const container = kit.resolve(s.el.ref)
        return container?.contains(el) === true
      })
      return index >= 0 ? index : steps.findIndex((s) => s.kind === 'login' || s.kind === 'recovery')
    }
    const seenCaptcha = new Set<Element>()
    const addCaptcha = (el: Element, vendor: string, kind: Captcha['kind'], why: string) => {
      const host = el.closest('.g-recaptcha, .h-captcha, .cf-turnstile, .frc-captcha') ?? el
      if (seenCaptcha.has(host)) return
      seenCaptcha.add(host)
      // One widget draws several frames (a checkbox, a challenge): one entry per vendor and step.
      const step = stepOf(host)
      if (captchas.some((c) => c.vendor === vendor && c.step === step)) return
      captchas.push({ el: kit.describe(host), vendor, kind, why, step })
    }
    for (const frame of deepAll('iframe')) {
      const src = frame.getAttribute('src') ?? ''
      if (/google\.com\/recaptcha|recaptcha\.net/.test(src)) {
        if (/size=invisible/.test(src) || !shown(frame)) addCaptcha(frame, 'reCAPTCHA', 'no-test', 'invisible: it scores the visit and shows a challenge only when it doubts')
        else addCaptcha(frame, 'reCAPTCHA', 'object-recognition', 'a checkbox that may open a challenge to select images of objects')
      } else if (/hcaptcha\.com/.test(src)) addCaptcha(frame, 'hCaptcha', shown(frame) ? 'object-recognition' : 'no-test', 'image challenges of objects')
      else if (/challenges\.cloudflare\.com/.test(src)) addCaptcha(frame, 'Turnstile', 'no-test', 'no puzzle: at most a checkbox')
      else if (/friendlycaptcha|frcapi/.test(src)) addCaptcha(frame, 'Friendly Captcha', 'no-test', 'a computation the browser does, no puzzle')
      else if (/arkoselabs|funcaptcha/.test(src)) addCaptcha(frame, 'Arkose', 'unknown', 'puzzles that may ask to turn or match pictures')
      else if (/geetest/.test(src)) addCaptcha(frame, 'GeeTest', 'unknown', 'a slider puzzle')
    }
    for (const el of deepAll('.g-recaptcha, [data-sitekey], .h-captcha, .cf-turnstile, .frc-captcha')) {
      const cls = typeof el.className === 'string' ? el.className : ''
      const size = el.getAttribute('data-size') ?? ''
      if (/h-captcha/.test(cls)) addCaptcha(el, 'hCaptcha', size === 'invisible' ? 'no-test' : 'object-recognition', 'image challenges of objects')
      else if (/cf-turnstile/.test(cls)) addCaptcha(el, 'Turnstile', 'no-test', 'no puzzle: at most a checkbox')
      else if (/frc-captcha/.test(cls)) addCaptcha(el, 'Friendly Captcha', 'no-test', 'a computation the browser does, no puzzle')
      else addCaptcha(el, 'reCAPTCHA', size === 'invisible' ? 'no-test' : 'object-recognition', size === 'invisible' ? 'invisible: it scores the visit' : 'a checkbox that may open a challenge to select images of objects')
    }
    for (const script of deepAll('script[src*="recaptcha/api.js?render="], script[src*="recaptcha/enterprise.js?render="]')) {
      if (!/render=explicit/.test(script.getAttribute('src') ?? '') && captchas.length === 0) addCaptcha(document.body, 'reCAPTCHA v3', 'no-test', 'scores the visit, asks nothing')
    }
    for (const [index, step] of steps.entries()) {
      if (step.transcription) {
        const target = step.transcription.image ? kit.resolve(step.transcription.image.ref) : kit.resolve(step.el.ref)
        if (target) captchas.push({ el: kit.describe(target), vendor: 'image', kind: 'cognitive-test', why: 'characters to transcribe from a picture', step: index })
      }
    }

    // Other ways to sign in, near a step: inside it, or in the section that holds it.
    const ALT = /passkey|chave de acesso|security key|chave de seguran[cç]a|biometr|face id|touch id|windows hello|sign in with|log ?in with|continue with|entrar com|login com|acessar com|continuar com|iniciar sesi[oó]n con|email me|e-mail me|send me a (sign[- ]in )?(link|code)|magic link|link m[áa]gico|sign in another way|use another (way|method)|other (sign[- ]in )?options|try another way|outras op[çc][õo]es|outra forma de (entrar|acesso)|certificado digital|qr ?code|c[oó]digo qr/i
    const alternatives: AuthData['alternatives'] = []
    for (const [index, step] of steps.entries()) {
      if (step.kind !== 'login' && step.kind !== 'recovery') continue
      const container = kit.resolve(step.el.ref)
      if (!container) continue
      const scope = container.closest('section, main, [role="main"], article, [role="dialog"], dialog') ?? container.parentElement ?? container
      for (const control of Array.from(scope.querySelectorAll('a[href], button, [role="button"], [role="link"]'))) {
        if (!shown(control)) continue
        const text = collapse(textOf(control) || control.getAttribute('aria-label') || control.getAttribute('title'))
        if (!text || !ALT.test(text) || alternatives.some((a) => a.el.ref === kit.cssPath(control))) continue
        alternatives.push({ el: kit.describe(control), text: short(text, 80), step: index })
      }
    }

    // Links to sign-in and recovery pages: where a person can run the probe next.
    const links: AuthData['links'] = []
    for (const a of deepAll('a[href]')) {
      if (!shown(a) || links.length >= 10) continue
      const text = collapse(textOf(a) || a.getAttribute('aria-label'))
      const href = (a as HTMLAnchorElement).href
      if (!text || !href || href.startsWith('javascript:')) continue
      const kind = RECOVERY.test(text) ? 'recovery' : /^(sign ?in|log ?in|entrar|acessar|login|iniciar sesi[oó]n|minha conta|my account|entrar com gov\.br)\b/i.test(text) ? 'login' : null
      if (kind && !links.some((l) => l.href === href)) links.push({ text: short(text, 60), href: href.slice(0, 300), kind })
    }
    // A bot check in place of the page: a challenge frame over most of the window, or a challenge page's title.
    let wall: string | undefined
    const WALLS: Array<[RegExp, string]> = [[/captcha-delivery\.com|datadome/, 'DataDome'], [/px-captcha|perimeterx|px-cdn/, 'HUMAN (PerimeterX)'], [/challenges\.cloudflare\.com|cdn-cgi\/challenge/, 'Cloudflare'], [/hcaptcha\.com/, 'hCaptcha'], [/recaptcha/, 'reCAPTCHA'], [/geetest/, 'GeeTest'], [/arkoselabs|funcaptcha/, 'Arkose']]
    for (const frame of deepAll('iframe')) {
      const r = frame.getBoundingClientRect()
      if (r.width * r.height < 0.6 * window.innerWidth * window.innerHeight || !shown(frame)) continue
      const vendor = WALLS.find(([re]) => re.test(frame.getAttribute('src') ?? ''))?.[1]
      if (vendor) wall = vendor
    }
    if (!wall && /just a moment|attention required|checking your browser|verificando (se|seu navegador)|um momento|un momento/i.test(document.title)) wall = document.title.slice(0, 60)
    return { steps, hidden, captchas, alternatives, links, ...(wall ? { wall } : {}) }
  }

  // ---- trials ---------------------------------------------------------------------------------------------------
  const resolveAll = (ref: string, group: string[]): HTMLInputElement[] => {
    const refs = group.length > 0 ? group : [ref]
    return refs.map((r) => kit.resolve(r)).filter((el): el is HTMLInputElement => el instanceof HTMLInputElement)
  }
  const setValue = (el: HTMLInputElement, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    if (setter) setter.call(el, value)
    else el.value = value
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }
  const log: Array<{ type: string; trusted: boolean; prevented: boolean | null; id: number }> = []
  let next = 0
  for (const type of ['paste', 'beforeinput'] as const) {
    window.addEventListener(
      type,
      (event) => {
        if (type === 'beforeinput' && (event as InputEvent).inputType !== 'insertFromPaste') return
        const entry = { type, trusted: event.isTrusted, prevented: null as boolean | null, id: next++ }
        log.push(entry)
        ;(event as Event & { __rampa?: typeof entry }).__rampa = entry
      },
      true,
    )
    window.addEventListener(type, (event) => {
      const entry = (event as Event & { __rampa?: { prevented: boolean | null } }).__rampa
      if (entry) entry.prevented = event.defaultPrevented
    })
  }
  const prepare: AuthKit['prepare'] = (ref, group) => {
    const fields = resolveAll(ref, group)
    const first = fields[0]
    if (!first || !shown(first)) return { ok: false, readonly: false, values: [] }
    const r = first.getBoundingClientRect()
    if (r.top < 0 || r.bottom > window.innerHeight) first.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior })
    const values = fields.map((f) => f.value)
    first.focus()
    // Some pages lift readonly when the field takes focus, to keep autofill away until then.
    const readonly = first.readOnly || first.disabled
    if (!readonly) for (const f of fields) if (f.value) setValue(f, '')
    first.focus()
    return { ok: kit.deepActive() === first, readonly, values }
  }
  const read: AuthKit['read'] = (ref, group) => resolveAll(ref, group).map((f) => f.value).join('')
  const focus: AuthKit['focus'] = (ref) => {
    const el = kit.resolve(ref) as HTMLElement | null
    el?.focus()
    return !!el && kit.deepActive() === el
  }
  const empty: AuthKit['empty'] = (ref, group) => {
    for (const f of resolveAll(ref, group)) if (f.value) setValue(f, '')
  }
  const restore: AuthKit['restore'] = (ref, group, values) => {
    const fields = resolveAll(ref, group)
    fields.forEach((f, i) => {
      if (f.value !== (values[i] ?? '')) setValue(f, values[i] ?? '')
    })
    for (let i = 0; i < 3; i++) {
      const active = kit.deepActive() as HTMLElement | null
      if (!active) break
      active.blur()
    }
    return fields.every((f, i) => f.value === (values[i] ?? ''))
  }
  const drain: AuthKit['drain'] = () => log.splice(0).map(({ type, trusted, prevented }) => ({ type, trusted, prevented }))
  w.__rampaAuth = { find, prepare, read, focus, empty, restore, drain }
}

type Win = { __rampaAuth: AuthKit }

/** The value the field holds, compared with what was pasted: spaces and separators aside, case aside. */
export function arrived(read: string, value: string): boolean {
  const norm = (text: string) => text.toLowerCase().replace(/[\s\-._()/]/g, '')
  const got = norm(read)
  const want = norm(value)
  return got.length > 0 && (got === want || got.includes(want))
}

/** What to paste into a field: digits for a code or a numeric field, a dummy password otherwise, cut to its maxlength. */
export function dummyFor(field: Pick<AuthField, 'kind' | 'type' | 'inputmode' | 'maxlength' | 'group'>): string {
  const numeric = field.kind === 'code' || /^(numeric|decimal|tel)$/.test(field.inputmode ?? '') || field.type === 'number' || field.type === 'tel'
  const base = numeric ? DUMMY_CODE : DUMMY_PASSWORD
  const length = field.group ? field.group.length : field.maxlength && field.maxlength > 0 ? Math.min(field.maxlength, base.length) : base.length
  return base.slice(0, Math.max(1, length))
}

/** Event types on the field that can stop a paste or a key, read over the DevTools protocol. */
async function listenersOf(page: Page, ref: string): Promise<string[] | null> {
  try {
    const cdp = await page.context().newCDPSession(page)
    try {
      const { result } = await cdp.send('Runtime.evaluate', { expression: `window.__rampaKit.resolve(${JSON.stringify(ref)})`, objectGroup: 'rampa-auth' })
      if (!result.objectId) return null
      const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId, depth: 0 })
      await cdp.send('Runtime.releaseObjectGroup', { objectGroup: 'rampa-auth' })
      return [...new Set(listeners.map((l) => l.type).filter((t) => /^(paste|beforeinput|input|keydown|keypress|keyup)$/.test(t)))].sort()
    } finally {
      await cdp.detach().catch(() => undefined)
    }
  } catch {
    return null
  }
}

async function pasteInto(page: Page, field: AuthField, guardSize: () => number): Promise<PasteTrial | 'readonly' | 'gone'> {
  const ref = field.el.ref
  const group = (field.group ?? []).map((g) => g.ref)
  const value = dummyFor(field)
  const prepared = await page.evaluate(([r, g]) => (window as unknown as Win).__rampaAuth.prepare(r, g), [ref, group] as const)
  if (prepared.readonly) return 'readonly'
  if (!prepared.ok) return 'gone'
  const guardBefore = guardSize()
  const trial: PasteTrial = { value, reads: [], arrived: false, events: [], clipboard: false, guarded: 0, restored: false }
  try {
    for (let attempt = 0; attempt < 2 && !trial.arrived; attempt++) {
      if (attempt > 0) {
        await page.evaluate(([r, g]) => (window as unknown as Win).__rampaAuth.empty(r, g), [ref, group] as const)
        await page.evaluate((r) => (window as unknown as Win).__rampaAuth.focus(r), ref)
      }
      trial.clipboard = await writeClipboard(page, value)
      await page.evaluate(() => (window as unknown as Win).__rampaAuth.drain())
      await pasteShortcut(page)
      await page.waitForTimeout(LAND_MS)
      const got = await page.evaluate(([r, g]) => (window as unknown as Win).__rampaAuth.read(r, g), [ref, group] as const)
      trial.reads.push(got)
      trial.events.push(...(await page.evaluate(() => (window as unknown as Win).__rampaAuth.drain())))
      trial.arrived = arrived(got, value)
    }
    if (!trial.arrived) {
      // One key: a field that takes keys but not pastes refuses the paste itself.
      await page.evaluate(([r, g]) => (window as unknown as Win).__rampaAuth.empty(r, g), [ref, group] as const)
      await page.evaluate((r) => (window as unknown as Win).__rampaAuth.focus(r), ref)
      const key = /\d/.test(value) && !/[a-z]/i.test(value) ? '7' : 'a'
      await page.keyboard.press(key)
      await page.waitForTimeout(LAND_MS)
      const got = await page.evaluate(([r, g]) => (window as unknown as Win).__rampaAuth.read(r, g), [ref, group] as const)
      trial.typed = { key, arrived: got.toLowerCase().includes(key) }
    }
  } finally {
    trial.restored = await page.evaluate(([r, g, v]) => (window as unknown as Win).__rampaAuth.restore(r, g, v), [ref, group, prepared.values] as const).catch(() => false)
    trial.guarded = guardSize() - guardBefore
  }
  return trial
}

export async function runAuthProbe(browser: Browser, url: string, options: ProbeOptions): Promise<ProbeRecord> {
  const started = Date.now()
  const deadline = started + TIME_BUDGET_MS
  // A sign-in page often bounces through other addresses on load (SSO, a challenge page): follow it until it lands.
  const probe = await openProbePage(browser, url, options, { variant: 'paste', follow: true })
  try {
    const page = probe.page
    const viewport = page.viewportSize() ?? probe.conditions.viewport
    const allowed = await allowClipboard(probe.context)
    await page.evaluate(installAuthKit)
    const found = await page.evaluate((budget) => (window as unknown as Win).__rampaAuth.find(budget), { maxSteps: MAX_STEPS, maxFields: MAX_FIELDS })
    let end = (found.steps.some((s) => s.kind === 'login' || s.kind === 'recovery') ? 'complete' : 'no-steps') as AuthData['end']
    let clipboard = (allowed ? 'ok' : 'unavailable') as AuthData['clipboard']
    const guardSize = () => probe.guard.log.blocked.length + probe.guard.log.navigations.length
    if (end === 'complete') {
      await withClipboard(browser, async () => {
        const saved = await readClipboard(page)
        if (saved === null) clipboard = 'unavailable'
        try {
          for (const step of found.steps) {
            if (step.kind !== 'login' && step.kind !== 'recovery') continue
            for (const field of step.fields) {
              if (field.kind === 'identifier') continue
              field.listeners = await listenersOf(page, field.el.ref)
              if (Date.now() > deadline) {
                end = 'time'
                continue
              }
              if (clipboard === 'unavailable') continue
              const trial = await pasteInto(page, field, guardSize).catch(() => 'gone' as const)
              if (trial === 'readonly') field.readonly = true
              else if (trial !== 'gone') {
                // A field read-only at load that took focus and a paste was read-only only until then.
                field.readonly = false
                field.paste = trial
              }
            }
          }
        } finally {
          if (saved !== null) await writeClipboard(page, saved)
        }
      })
    }
    const data: AuthData = { viewport, ...found, ...(probe.landed ? { landed: probe.landed.slice(0, 300) } : {}), clipboard, end }
    return {
      kind: 'auth',
      version: AUTH_VERSION,
      conditions: { ...probe.conditions, viewport },
      status: end === 'time' ? 'partial' : 'complete',
      ...(end === 'time' ? { reason: `time budget reached (${TIME_BUDGET_MS / 1000} s)` } : {}),
      guard: probe.guard.log,
      durationMs: Date.now() - started,
      data,
    }
  } finally {
    await probe.context.close()
  }
}

/** The authentication probe as a step of the probe stage; a probe that fails leaves a skipped record. */
export async function authProbe(browser: Browser, url: string, options: ProbeOptions): Promise<ProbeRecord[]> {
  const started = Date.now()
  try {
    return [await runAuthProbe(browser, url, options)]
  } catch (error) {
    return [skippedRecord('auth', AUTH_VERSION, 'paste', `probe failed: ${(error instanceof Error ? error.message : String(error)).split('\n')[0]}`, Date.now() - started)]
  }
}
