import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { memoryCache } from '../src/core/cache.ts'
import { checkSnapshot } from '../src/core/check.ts'
import type { Report } from '../src/core/types.ts'
import { CRITERIA, DEFAULT_CRITERIA } from '../src/criteria/index.ts'
import { type ErrorIdentificationJudgment, errorFields, errorIdentification, errorMessageCandidates, isErrorWording } from '../src/criteria/error-messages.ts'
import { ACT_RULES } from '../src/eval/act.ts'
import { checkPage } from '../src/playwright.ts'
import type { JudgeRequest, ModelProvider } from '../src/providers/types.ts'
import { type Collected, collectWeb, launchBrowser } from '../src/surfaces/web.ts'
import { probeCheckOptions } from './probe-helpers.ts'

const fixture = (name: string) => pathToFileURL(resolve('test/fixtures/rules', name)).href
const errorsOf = (report: Report, rule: string) => [...report.findings, ...report.belowThreshold].filter((f) => f.ruleId === rule)
const reviewOf = (report: Report, rule: string) => (report.needsReview ?? []).filter((r) => r.ruleId === rule)
const statusOf = (report: Report, id: string) => report.coverage.criteria?.find((c) => c.id === id)?.status

describe('error wording', () => {
  it('reads text that says an entry is wrong or missing, in English, Portuguese and Spanish', () => {
    for (const text of [
      'Invalid value for age.',
      'Please fill the field correctly.',
      'Name and color cannot be empty.',
      'Email is required',
      'Passwords do not match',
      'CPF inválido',
      'O campo nome é obrigatório',
      'A senha não pode ficar em branco',
      'Por favor, preencha este campo',
      'El correo es obligatorio',
    ]) {
      expect(isErrorWording(text), text).toBe(true)
    }
    for (const text of ['To see all products, leave the field empty.', 'Password must be at least 8 characters.', 'Name (required)', 'Required fields are marked with *', 'Senha: no mínimo 8 caracteres', 'Errata']) {
      expect(isErrorWording(text), text).toBe(false)
    }
  })

  it('is a judged criterion on request, measured on ACT 36b590, and not a default', () => {
    expect(CRITERIA.get('3.3.1')).toBe(errorIdentification)
    expect(DEFAULT_CRITERIA).not.toContain('3.3.1')
    expect(ACT_RULES['3.3.1']).toEqual({ syntax: [], semantic: ['36b590'] })
  })
})

// Integration: needs Chrome or Edge.
const browser = await launchBrowser().catch((error: unknown) => {
  process.stderr.write(`\nSkipping the error state tests: no browser started (${error instanceof Error ? error.message.split('\n')[0] : String(error)}).\n`)
  return undefined
})
afterAll(async () => browser?.close(), 60_000)

const collected = new Map<string, Promise<Collected>>()
function collect(name: string): Promise<Collected> {
  if (!browser) throw new Error('no browser')
  let result = collected.get(name)
  if (!result) {
    result = collectWeb(browser, fixture(name), { runAxe: true, locale: 'en' })
    collected.set(name, result)
  }
  return result
}

/** A model that answers by the message, as a careful reader would; it records what it was asked. */
function scriptedModel(): ModelProvider & { asked: string[] } {
  const asked: string[] = []
  const answers: Record<string, Partial<ErrorIdentificationJudgment>> = {
    'Please fill the field correctly.': { isError: true, field: '', cause: '', verdict: 'fail', problem: 'field_not_identified' },
    'Invalid age.': { isError: true, field: 'Age', cause: '', verdict: 'fail', problem: 'cause_not_described' },
    'The invite code has 6 letters.': { isError: true, field: 'Invite code', cause: 'has 6 letters', verdict: 'pass', problem: 'none' },
    'This CEP is invalid.': { isError: true, field: 'CEP', cause: '', verdict: 'fail', problem: 'cause_not_described' },
  }
  return {
    id: 'stub:errors',
    asked,
    async judge<T>(request: JudgeRequest<T>) {
      const message = /<message>([\s\S]*?)<\/message>/.exec(request.user)?.[1] ?? ''
      asked.push(message)
      const output = { isError: true, field: '', cause: '', verdict: 'pass', problem: 'none', evidence: message, confidence: 'high', ...answers[message] }
      return { output: request.schema.parse(output), inputTokens: 100, outputTokens: 20, latencyMs: 1, modelId: 'stub' }
    },
  }
}

describe.skipIf(!browser)('error states the page already shows (3.3.1, 3.3.3)', { timeout: 60_000 }, () => {
  it('records aria-invalid, aria-errormessage and the validity of a field marked invalid', async () => {
    const { snapshot } = await collect('errors-fail.html')
    const fields = Object.fromEntries(errorFields(snapshot).map((field) => [field.node.ref, field]))
    expect(Object.keys(fields)).toEqual(['#email', '#age', '#code', '#cep', '#city'])
    expect(fields['#email']).toMatchObject({ label: 'Email', type: 'email', state: ['aria-invalid'], validity: ['typeMismatch'], messages: [] })
    expect(fields['#age']?.messages).toEqual([expect.objectContaining({ via: 'aria-describedby', text: 'Invalid age.', shown: true, inTree: true })])
    expect(fields['#code']?.messages).toEqual([expect.objectContaining({ via: 'aria-errormessage', shown: true, inTree: false })])
    expect(fields['#city']).toMatchObject({ state: ['class'], messages: [] })
  })

  it('fails a field marked invalid with no error text, or with text hidden from assistive technology, and sends a class alone to review', async () => {
    const { snapshot, engine } = await collect('errors-fail.html')
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    expect(errorsOf(report, 'rampa/error-without-text').map((f) => `${f.ref} ${f.confidence} ${f.source}`)).toEqual(['#email low rule', '#code low rule'])
    expect(errorsOf(report, 'rampa/error-without-text')[0]?.message).toMatch(/^The field "Email" is marked invalid \(aria-invalid="true"\), and no text says what is wrong/)
    expect(errorsOf(report, 'rampa/error-without-text')[1]?.message).toMatch(/hidden from assistive technology \(aria-hidden\)/)
    expect(reviewOf(report, 'rampa/error-without-text').map((r) => r.ref)).toEqual(['#city'])
    expect(statusOf(report, '3.3.1')).toBe('failures')
  })

  it('fails an error message that leaves out a rule the markup states, and sends a pattern with no example to review', async () => {
    const { snapshot, engine } = await collect('errors-fail.html')
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    const failures = errorsOf(report, 'rampa/error-suggestion')
    expect(failures.map((f) => `${f.criterion} ${f.ref}`)).toEqual(['3.3.3 #age'])
    expect(failures[0]?.evidence).toBe('rangeUnderflow: min="18"; message "Invalid age."; label "Age"')
    expect(reviewOf(report, 'rampa/error-suggestion').map((r) => r.ref)).toEqual(['#cep'])
    expect(statusOf(report, '3.3.3')).toBe('failures')
  })

  it('finds nothing when every error is named in text near its field, in a summary, and states its rule', async () => {
    const { snapshot, engine } = await collect('errors-pass.html')
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    expect(errorsOf(report, 'rampa/error-without-text')).toEqual([])
    expect(errorsOf(report, 'rampa/error-suggestion')).toEqual([])
    expect(reviewOf(report, 'rampa/error-suggestion')).toEqual([])
    expect(statusOf(report, '3.3.1')).toBe('no-failure-found')
    expect(statusOf(report, '3.3.3')).toBe('no-failure-found')
    // A hidden message template and aria-invalid="false" are no error state; an instruction is no error message.
    expect(errorFields(snapshot).map((field) => field.node.ref)).toEqual(['#name', '#email', '#age', '#cep'])
    expect(errorMessageCandidates(snapshot).map((c) => c.context.text)).toEqual(['Enter an email address like name@example.com', 'You must be 18 or older to sign up.', 'Enter the CEP in the format 12345-678.'])
  })

  it('leaves 3.3.1 and 3.3.3 not checked on a page that shows no error', async () => {
    const { snapshot, engine } = await collect('errors-live.html')
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    expect(statusOf(report, '3.3.1')).toBe('not-checked')
    expect(statusOf(report, '3.3.3')).toBe('not-checked')
  })

  it('checks a page a test drove into an error state: fill, leave the field, then checkPage', async () => {
    if (!browser) return
    const context = await browser.newContext()
    try {
      const page = await context.newPage()
      await page.goto(fixture('errors-live.html'))
      await page.fill('#password', 'abc')
      await page.fill('#nick', 'al')
      await page.locator('#nick').blur()
      await page.fill('#city', 'a')
      await page.locator('#city').blur()
      await page.locator('#password').focus()
      await page.locator('#password').blur()
      const report = await checkPage(page, { config: false, waivers: [], cache: memoryCache(), noLlm: true, minConfidence: 'low' })
      const failures = report.findings.filter((f) => f.ruleId === 'rampa/error-suggestion')
      // The password's message does not say 8 characters; the nickname's says 3.
      expect(failures.map((f) => `${f.ref} ${f.criterion}`)).toEqual(['#password 3.3.3'])
      expect(failures[0]?.evidence).toBe('tooShort: minlength="8"; message "Invalid password."; label "Password"')
      // The city is :user-invalid with no message of the page's own: the browser names its error when the form is sent.
      const city = errorFields((await collectWeb(browser, fixture('errors-live.html'), { runAxe: false, locale: 'en', mutate: async (p) => { await p.fill('#city', 'a'); await p.locator('#city').blur() } })).snapshot)
      expect(city.map((field) => `${field.node.ref} ${field.state.join(',')} ${field.validity.join(',')}`)).toEqual(['#city user-invalid tooShort'])
      expect(report.findings.filter((f) => f.ruleId === 'rampa/error-without-text')).toEqual([])
      expect(statusOf(report, '3.3.1')).toBe('no-failure-found')
    } finally {
      await context.close()
    }
  })

  it('asks a model, per ACT 36b590, whether each error message names its field and what is wrong, and keeps it below the threshold', async () => {
    const { snapshot, engine } = await collect('errors-fail.html')
    const candidates = errorMessageCandidates(snapshot)
    expect(candidates.map((c) => c.context.text)).toEqual(['Please fill the field correctly.', 'Invalid age.', 'The invite code has 6 letters.', 'This CEP is invalid.'])
    const prompt = errorIdentification.prompt(candidates[1] as (typeof candidates)[number], snapshot)
    expect(prompt.user).toContain('<message>Invalid age.</message>')
    expect(prompt.user).toContain('- "Age" (number, marked invalid (aria-invalid)): tied to the message by aria-describedby or aria-errormessage; the field just before the message')
    const model = scriptedModel()
    const report = await checkSnapshot(snapshot, engine, { ...probeCheckOptions(), criteria: [errorIdentification], llm: true, provider: model })
    expect(model.asked).toHaveLength(4)
    const judged = report.findings.filter((f) => f.source === 'judgment' && f.criterion === '3.3.1')
    expect(judged.map((f) => `${f.ref} ${f.confidence}`)).toEqual(['html > body > main > form > p low', '#age-error low', '#code-error low', '#cep-error low'])
    expect(judged[0]?.message).toMatch(/^This error message does not say which field is in error: "Please fill the field correctly\."/)
    expect(judged[1]?.message).toMatch(/^This error message says there is an error, but not what is wrong or how to fix it: "Invalid age\."/)
    // The model passed it, but it is hidden from assistive technology: ACT 36b590's third expectation fails it.
    expect(judged[2]?.message).toMatch(/^This error message is hidden from assistive technology \(aria-hidden\)/)
    // Experimental: at the default threshold the judged findings are reported below it.
    const strict = await checkSnapshot(snapshot, engine, { ...probeCheckOptions(), criteria: [errorIdentification], llm: true, provider: scriptedModel(), minConfidence: 'medium' })
    expect(strict.findings.filter((f) => f.source === 'judgment')).toEqual([])
    expect(strict.belowThreshold.filter((f) => f.source === 'judgment')).toHaveLength(4)
  })

  it('discards a claim the snapshot contradicts: a message tied to one field, or one naming the cause', () => {
    const base = { text: 'Name and color cannot be empty.', hiddenFromAt: false, facts: '', labels: ['Name', 'Address', 'Pick a color'], tied: 0 }
    const fields = [
      { identity: 'Name|Shipping', words: ['name', 'shipping'] },
      { identity: 'Address|Shipping', words: ['address', 'shipping'] },
      { identity: 'group|Pick a color', words: ['pick', 'color'] },
    ]
    const claim = (problem: ErrorIdentificationJudgment['problem'], text = base.text) =>
      ({ isError: true, field: '', cause: '', verdict: 'fail', problem, evidence: text, confidence: 'high' }) as ErrorIdentificationJudgment
    const candidate = (extra: object = {}) => ({ ref: '#e', context: { ...base, fields, ...extra } })
    expect(errorIdentification.verify(claim('field_not_identified'), candidate(), {} as never)).toEqual({ ok: false, reason: 'the message names one field: "name"' })
    expect(errorIdentification.verify(claim('field_not_identified', 'Please fill the field correctly.'), candidate({ text: 'Please fill the field correctly.', tied: 1 }), {} as never)).toMatchObject({ ok: false })
    expect(errorIdentification.verify(claim('cause_not_described'), candidate(), {} as never)).toEqual({ ok: false, reason: 'the message says what is wrong or how to fix it: "cannot be empty"' })
    // Two fields named Name: the message names neither.
    const twice = [...fields, { identity: 'Name|Billing', words: ['name', 'billing'] }]
    expect(errorIdentification.verify(claim('field_not_identified', 'Please fill Name.'), candidate({ text: 'Please fill Name.', fields: twice }), {} as never)).toEqual({ ok: true })
    expect(errorIdentification.verify(claim('cause_not_described', 'Invalid value for age.'), candidate({ text: 'Invalid value for age.' }), {} as never)).toEqual({ ok: true })
  })
})
