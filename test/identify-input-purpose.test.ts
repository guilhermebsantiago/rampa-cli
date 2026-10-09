import { describe, expect, it } from 'vitest'
import { memoryCache } from '../src/core/cache.ts'
import { checkSnapshot } from '../src/core/check.ts'
import type { EngineResults } from '../src/core/types.ts'
import { autocompleteValueFor, isAppropriate, parseAutocomplete, samePurpose } from '../src/criteria/autofill.ts'
import { type IdentifyInputPurposeJudgment, identifyInputPurpose } from '../src/criteria/identify-input-purpose.ts'
import { withAttribute } from '../src/criteria/shared.ts'
import type { ModelProvider } from '../src/providers/types.ts'
import type { A11yNode, A11ySnapshot } from '../src/snapshot/schema.ts'
import { node } from './helpers.ts'

const noFindings: EngineResults = { engine: { name: 'axe-core', version: 'test' }, rules: [] }

function field(ref: string, name: string | undefined, attributes: Record<string, string>, extra: Partial<A11yNode> = {}): A11yNode {
  const tag = extra.native?.tag ?? 'input'
  const attrs = Object.entries(attributes)
    .map(([key, value]) => ` ${key}="${value}"`)
    .join('')
  return node({ ref, role: 'textbox', name, ...extra, native: { tag, attributes, html: `<${tag}${attrs}>` } })
}

/** A checkout page: a delivery form, a site search, a discount code and a few fields that take no input. */
function checkout(): A11ySnapshot {
  return {
    schemaVersion: 1,
    surface: 'web',
    target: 'test://checkout',
    locale: 'en',
    viewport: { width: 1280, height: 800, scale: 1 },
    collectedAt: '2026-10-08T00:00:00.000Z',
    collector: { name: 'test', version: '0' },
    root: node({
      ref: 'html',
      role: 'document',
      lang: 'en',
      children: [
        field('#q', 'Search the shop', { id: 'q', type: 'search' }, { role: 'searchbox' }),
        node({ ref: 'h1', role: 'heading', name: 'Delivery details', native: { tag: 'h1' } }),
        node({
          ref: 'form',
          role: 'form',
          native: { tag: 'form' },
          children: [
            field('#email', 'Email', { id: 'email', type: 'email', name: 'email' }),
            field('#phone', 'Phone', { id: 'phone', type: 'tel', autocomplete: 'email' }),
            field('#zip', undefined, { id: 'zip', placeholder: 'Postcode', autocomplete: 'off' }),
            field('#code', 'Discount code', { id: 'code' }),
            field('#broken', 'City', { id: 'broken', autocomplete: 'town' }),
            field('#off', 'Old address', { id: 'off' }, { states: ['disabled'] }),
            field('#ro', 'Account number', { id: 'ro' }, { states: ['readonly'] }),
            field('#gone', 'Fax', { id: 'gone' }, { states: ['hidden'] }),
            field('#unnamed', undefined, { id: 'unnamed' }),
            field('#news', 'Send me offers', { id: 'news', type: 'checkbox' }, { role: 'checkbox' }),
            node({
              ref: '#country',
              role: 'combobox',
              name: 'Country',
              native: { tag: 'select', attributes: { id: 'country' }, html: '<select id="country">' },
              children: ['Brazil', 'Portugal', 'Angola'].map((country) => node({ ref: `option-${country}`, name: country, native: { tag: 'option' } })),
            }),
            node({ ref: 'button', role: 'button', name: 'Continue to payment', native: { tag: 'button' } }),
          ],
        }),
        // A footer that switches the page's language, and a sign-up block built without a form element.
        node({
          ref: 'footer form',
          role: 'form',
          native: { tag: 'form' },
          children: [
            node({
              ref: '#lang',
              role: 'combobox',
              name: 'Language',
              native: { tag: 'select', attributes: { id: 'lang' }, html: '<select id="lang">' },
              children: ['English', 'Português'].map((language) => node({ ref: `option-${language}`, name: language, native: { tag: 'option' } })),
            }),
          ],
        }),
        node({
          ref: 'div.signup',
          native: { tag: 'div' },
          children: [field('#first', 'First name', { id: 'first' }), node({ ref: 'div.signup > div', native: { tag: 'div' }, children: [field('#last', 'Last name', { id: 'last' })] })],
        }),
      ],
    }),
  }
}

const engineFailsTown: EngineResults = {
  engine: { name: 'axe-core', version: 'test' },
  rules: [{ ruleId: 'autocomplete-valid', outcome: 'violation', criteria: ['1.3.5'], help: '', nodes: [{ ref: '#broken', target: '#broken', html: '' }] }],
}

function candidate(ref: string) {
  const found = identifyInputPurpose.candidates(checkout(), engineFailsTown).find((c) => c.ref === ref)
  if (!found) throw new Error(`no candidate ${ref}`)
  return found
}

const emailFail: IdentifyInputPurposeJudgment = {
  asks: 'their email address',
  about: 'user',
  purpose: 'email',
  verdict: 'fail',
  evidence: 'Email',
  confidence: 'high',
}

describe('autocomplete values', () => {
  it('reads a value the way axe-core validates it', () => {
    expect(parseAutocomplete(undefined)).toEqual({ kind: 'missing' })
    expect(parseAutocomplete('  ')).toEqual({ kind: 'missing' })
    expect(parseAutocomplete('off')).toEqual({ kind: 'state', raw: 'off' })
    expect(parseAutocomplete('section-a shipping work email webauthn')).toMatchObject({
      kind: 'token',
      field: 'email',
      section: 'section-a',
      location: 'shipping',
      qualifier: 'work',
      webauthn: true,
    })
    expect(parseAutocomplete('one-time-code')).toMatchObject({ kind: 'token', field: 'one-time-code' })
    // A contact qualifier only goes with telephone, email and messaging fields.
    expect(parseAutocomplete('work name').kind).toBe('invalid')
    expect(parseAutocomplete('gender').kind).toBe('invalid')
    expect(parseAutocomplete('email tel').kind).toBe('invalid')
  })

  it('allows a token only on the input types axe-core allows it on', () => {
    expect(isAppropriate('email', 'email')).toBe(true)
    expect(isAppropriate('name', 'email')).toBe(false)
    expect(isAppropriate('name', 'text')).toBe(true)
    expect(isAppropriate('bday-day', 'tel')).toBe(true)
    expect(isAppropriate('bday', 'number')).toBe(false)
    expect(isAppropriate('current-password', 'password')).toBe(true)
    expect(isAppropriate('country-name', 'select')).toBe(true)
  })

  it('treats close tokens as the same purpose', () => {
    expect(samePurpose('tel', 'tel-national')).toBe(true)
    expect(samePurpose('email', 'username')).toBe(true)
    expect(samePurpose('tel', 'email')).toBe(false)
    expect(samePurpose('bday', 'bday-day')).toBe(false)
  })

  it('keeps the section and billing or shipping when it replaces a token', () => {
    expect(autocompleteValueFor('email', parseAutocomplete(undefined))).toBe('email')
    expect(autocompleteValueFor('email', parseAutocomplete('off'))).toBe('email')
    expect(autocompleteValueFor('tel', parseAutocomplete('section-a billing work email'))).toBe('section-a billing work tel')
    expect(autocompleteValueFor('address-line1', parseAutocomplete('shipping work email'))).toBe('shipping address-line1')
    expect(autocompleteValueFor('current-password', parseAutocomplete('username webauthn'))).toBe('current-password webauthn')
  })

  it('sets an attribute in a start tag without touching look-alikes', () => {
    expect(withAttribute('<input id="a" type="email">', 'autocomplete', 'email')).toBe('<input id="a" type="email" autocomplete="email">')
    expect(withAttribute('<input id="a" />', 'autocomplete', 'email')).toBe('<input id="a" autocomplete="email"/>')
    expect(withAttribute('<input autocomplete="off" id="a">', 'autocomplete', 'tel')).toBe('<input autocomplete="tel" id="a">')
    expect(withAttribute('<input data-autocomplete="x" autocomplete=off>', 'autocomplete', 'tel')).toBe('<input data-autocomplete="x" autocomplete="tel">')
  })
})

describe('1.3.5 candidates', () => {
  it('judges every text-like field that takes input, and leaves the rest out', () => {
    const refs = identifyInputPurpose.candidates(checkout(), engineFailsTown).map((c) => c.ref)
    // Search boxes, fields the engine failed, fields that take no input and fields with nothing to read stay out.
    expect(refs).toEqual(['#email', '#phone', '#zip', '#code', '#country', '#lang', '#first', '#last'])
  })

  it('lists the fields around one that has no form element, and none for a lone selector', () => {
    expect(candidate('#last').context.otherFields).toEqual(['First name'])
    expect(candidate('#last').context.facts).toContain('Not inside a form element\nOther fields around it: "First name"')
    expect(candidate('#lang').context.otherFields).toEqual([])
  })

  it('gives the model the field, its autocomplete and the form around it', () => {
    const email = candidate('#email')
    expect(email.context).toMatchObject({ label: 'Email', control: 'email', autocomplete: { kind: 'missing' } })
    expect(email.context.facts).toContain('Field: input type="email"')
    expect(email.context.facts).toContain('autocomplete: none, the attribute is missing')
    expect(email.context.facts).toContain('Under the visible heading: Delivery details')
    expect(email.context.facts).toContain('Other fields in the same form: "Phone", "Postcode", "Discount code"')
    expect(email.context.facts).toContain('Buttons in the same form: "Continue to payment"')
    expect(candidate('#phone').context.facts).toContain('autocomplete="email": email address')
    expect(candidate('#zip').context).toMatchObject({ label: 'Postcode', control: 'text' })
    expect(candidate('#zip').context.facts).toContain('autocomplete="off": names no purpose')
    expect(candidate('#country').context.facts).toContain('Options: Brazil, Portugal, Angola')
  })

  it('puts the label in the prompt and the facts inside <content>', () => {
    const prompt = identifyInputPurpose.prompt(candidate('#email'), checkout())
    expect(prompt.user).toContain('<label>Email</label>')
    expect(prompt.user).toMatch(/<content>\nField: input type="email"[\s\S]*<\/content>$/)
    expect(prompt.images).toBeUndefined()
  })
})

describe('1.3.5 verification', () => {
  it('keeps a missing token on the user\'s own data', () => {
    expect(identifyInputPurpose.verify(emailFail, candidate('#email'), checkout())).toEqual({ ok: true })
  })

  it('needs the label quoted, or the placeholder when there is no label', () => {
    expect(identifyInputPurpose.verify({ ...emailFail, evidence: 'Phone' }, candidate('#email'), checkout()).ok).toBe(false)
    const zip = { ...emailFail, purpose: 'postal-code', evidence: 'Postcode' } as const
    expect(identifyInputPurpose.verify(zip, candidate('#zip'), checkout())).toEqual({ ok: true })
  })

  it('drops a fail about someone else, about nothing personal, or without a purpose', () => {
    expect(identifyInputPurpose.verify({ ...emailFail, about: 'someone_else' }, candidate('#email'), checkout())).toEqual({
      ok: false,
      reason: 'fail verdict for information that is not about the user',
    })
    expect(identifyInputPurpose.verify({ ...emailFail, about: 'not_personal' }, candidate('#email'), checkout()).ok).toBe(false)
    expect(identifyInputPurpose.verify({ ...emailFail, purpose: 'none' }, candidate('#email'), checkout()).ok).toBe(false)
  })

  it('drops purposes outside the WCAG list or not about the user', () => {
    expect(identifyInputPurpose.verify({ ...emailFail, purpose: 'one-time-code' }, candidate('#email'), checkout()).ok).toBe(false)
    const amount = { ...emailFail, purpose: 'transaction-amount', evidence: 'Discount code' } as const
    expect(identifyInputPurpose.verify(amount, candidate('#code'), checkout()).ok).toBe(false)
  })

  it('drops a token that cannot go on the control, so the patch never breaks the engine rule', () => {
    const verdict = identifyInputPurpose.verify({ ...emailFail, purpose: 'name' }, candidate('#email'), checkout())
    expect(verdict).toEqual({ ok: false, reason: 'autocomplete="name" does not apply to an input of type email' })
  })

  it('drops a mismatch claim when the field already names that purpose', () => {
    const phone = candidate('#phone')
    expect(identifyInputPurpose.verify({ ...emailFail, evidence: 'Phone', purpose: 'tel' }, phone, checkout())).toEqual({ ok: true })
    expect(identifyInputPurpose.verify({ ...emailFail, evidence: 'Phone', purpose: 'email' }, phone, checkout()).ok).toBe(false)
  })

  it('drops a language or country claim on a selector that is alone, as a page switcher is', () => {
    const language = { ...emailFail, evidence: 'Language', purpose: 'language' } as const
    expect(identifyInputPurpose.verify(language, candidate('#lang'), checkout())).toEqual({
      ok: false,
      reason: 'a language or country selector with no other field around it switches the page; it collects nothing',
    })
    const country = { ...emailFail, evidence: 'Country', purpose: 'country-name' } as const
    expect(identifyInputPurpose.verify(country, candidate('#country'), checkout())).toEqual({ ok: true })
  })

  it('lets a pass through with only the quote checked', () => {
    const pass = { ...emailFail, verdict: 'pass', about: 'not_personal', purpose: 'none', evidence: 'Discount code' } as const
    expect(identifyInputPurpose.verify(pass, candidate('#code'), checkout())).toEqual({ ok: true })
  })
})

describe('1.3.5 messages and patches', () => {
  it('says what the field asks for and what the token says, in both locales', () => {
    expect(identifyInputPurpose.message(emailFail, candidate('#email'), 'en')).toBe(
      'The field "Email" asks for the user\'s email address but does not identify that purpose: autocomplete="email" is missing.',
    )
    expect(identifyInputPurpose.message(emailFail, candidate('#email'), 'pt-BR')).toBe(
      'O campo "Email" pede o e-mail de quem preenche, mas não identifica essa finalidade: falta autocomplete="email".',
    )
    const phone = { ...emailFail, evidence: 'Phone', purpose: 'tel' } as const
    expect(identifyInputPurpose.message(phone, candidate('#phone'), 'en')).toBe(
      'The field "Phone" asks for the user\'s telephone number, but autocomplete="email" says it holds their email address.',
    )
    expect(identifyInputPurpose.message(phone, candidate('#phone'), 'pt-BR')).toBe(
      'O campo "Phone" pede o telefone de quem preenche, mas autocomplete="email" indica o e-mail.',
    )
    const zip = { ...emailFail, purpose: 'postal-code', evidence: 'Postcode' } as const
    expect(identifyInputPurpose.message(zip, candidate('#zip'), 'en')).toBe(
      'The field "Postcode" asks for the user\'s postal code, but autocomplete="off" does not identify that purpose.',
    )
  })

  it('adds or replaces the autocomplete attribute', () => {
    expect(identifyInputPurpose.patch?.(emailFail, candidate('#email'), checkout())).toEqual({
      ref: '#email',
      kind: 'set-attribute',
      attribute: 'autocomplete',
      from: undefined,
      to: 'email',
      before: '<input id="email" type="email" name="email">',
      after: '<input id="email" type="email" name="email" autocomplete="email">',
    })
    const phone = { ...emailFail, evidence: 'Phone', purpose: 'tel' } as const
    expect(identifyInputPurpose.patch?.(phone, candidate('#phone'), checkout())).toMatchObject({
      from: 'email',
      to: 'tel',
      after: '<input id="phone" type="tel" autocomplete="tel">',
    })
  })
})

describe('1.3.5 through the pipeline', () => {
  it('reports the verified fails and nothing else', async () => {
    const answers: Record<string, IdentifyInputPurposeJudgment> = {
      Email: emailFail,
      Phone: { ...emailFail, evidence: 'Phone', purpose: 'tel' },
      Postcode: { ...emailFail, evidence: 'Postcode', purpose: 'postal-code' },
      'Discount code': { ...emailFail, verdict: 'pass', about: 'not_personal', purpose: 'none', evidence: 'Discount code' },
      // A fail that says the data is someone else's contradicts itself: dropped.
      Country: { ...emailFail, evidence: 'Country', about: 'someone_else', purpose: 'country-name' },
      Language: { ...emailFail, verdict: 'pass', about: 'not_personal', purpose: 'none', evidence: 'Language' },
      'First name': { ...emailFail, verdict: 'pass', about: 'not_personal', purpose: 'none', evidence: 'First name' },
      'Last name': { ...emailFail, verdict: 'pass', about: 'not_personal', purpose: 'none', evidence: 'Last name' },
    }
    const provider: ModelProvider = {
      id: 'test:scripted',
      async judge<T>(request: { user: string; schema: { parse(value: unknown): T } }) {
        const label = /<label>(.*)<\/label>/.exec(request.user)?.[1] ?? ''
        return { output: request.schema.parse(answers[label]), inputTokens: 50, outputTokens: 10, latencyMs: 1, modelId: 'scripted' }
      },
    } as ModelProvider
    const report = await checkSnapshot(checkout(), engineFailsTown, {
      criteria: [identifyInputPurpose],
      llm: true,
      provider,
      runs: 1,
      cache: memoryCache(),
      offline: false,
      locale: 'en',
      minConfidence: 'medium',
      concurrency: 1,
    })
    expect(report.findings.filter((f) => f.source === 'judgment').map((f) => f.ref)).toEqual(['#email', '#phone', '#zip'])
    expect(report.criteria[0]).toMatchObject({ candidates: 8, failed: 3, passed: 4, discarded: 1 })
    expect(report.discarded[0]).toMatchObject({ ref: '#country', reason: 'fail verdict for information that is not about the user' })
    expect(report.coverage.judged).toContain('1.3.5')
  })
})
