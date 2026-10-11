import { spawn } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BrowserContext, Route } from 'playwright-core'
import { afterAll, describe, expect, it } from 'vitest'
import { checkSnapshot } from '../src/core/check.ts'
import type { Report } from '../src/core/types.ts'
import type { RampaError } from '../src/core/util.ts'
import { emptyEngine } from '../src/engine/axe.ts'
import type { AfterField } from '../src/probes/form.ts'
import { installGuard } from '../src/probes/guard.ts'
import { DETERMINISM_ARGS } from '../src/probes/run.ts'
import {
  type StepControl,
  type StepForm,
  type SubmitData,
  type SubmitFlow,
  describeSubmitRecord,
  invalidFor,
  parseAllowSubmit,
  planEntries,
  sampleFor,
  stopFor,
  submitSkipWord,
  validFor,
} from '../src/probes/submit.ts'
import { paint } from '../src/report/color.ts'
import { renderHtml } from '../src/report/html.ts'
import { renderMarkdown } from '../src/report/markdown.ts'
import { renderReport, submissionLine } from '../src/report/pretty.ts'
import { A11ySnapshotSchema, type A11yNode, type A11ySnapshot, type ProbeRecord } from '../src/snapshot/schema.ts'
import { loadRecorded } from '../src/surfaces/targets.ts'
import { type Collected, collectWeb, launchBrowser } from '../src/surfaces/web.ts'
import { byRule, probeCheckOptions, reviewByRule } from './probe-helpers.ts'
import { startSubmitServers } from './submit-server.ts'

const ON_SUBMIT = 'rampa/error-on-submit'
const SUGGESTION = 'rampa/suggestion-on-submit'
const STEPS = 'rampa/redundant-entry-steps'
const PREVENTION = 'rampa/error-prevention-steps'

describe('--allow-submit takes exact origins only', () => {
  it('keeps scheme, host and port, and drops a default port and a trailing slash', () => {
    expect(parseAllowSubmit(['http://localhost:5173', 'https://staging.example.com/', 'http://127.0.0.1:80', 'http://localhost:5173'])).toEqual(['http://localhost:5173', 'https://staging.example.com', 'http://127.0.0.1'])
    expect(parseAllowSubmit(undefined)).toEqual([])
    expect(parseAllowSubmit('HTTP://Example.COM:8080')).toEqual(['http://example.com:8080'])
  })

  it.each([
    ['*', 'no wildcards'],
    ['https://*.example.com', 'no wildcards'],
    ['http://localhost:*', 'no wildcards'],
    ['https://example.com/checkout', 'did you mean https://example.com?'],
    ['https://example.com/?a=1', 'did you mean https://example.com?'],
    ['https://example.com#x', 'did you mean https://example.com?'],
    ['example.com', 'not an address with a scheme'],
    ['file:///C:/site/index.html', 'only http and https origins'],
    ['ftp://example.com', 'only http and https origins'],
    ['https://user:secret@example.com', 'no user or password'],
    ['   ', 'it is empty'],
  ])('refuses %s', (value, why) => {
    let error: RampaError | undefined
    try {
      parseAllowSubmit([value])
    } catch (caught) {
      error = caught as RampaError
    }
    expect(error?.code).toBe('invalid-option')
    expect(error?.message).toContain(why)
  })
})

// The guard, driven by hand: the route handler it installs, fed requests as Playwright gives them.

interface FakeRequest {
  method: string
  url: string
  type?: string
  navigation?: boolean
}

async function fakeGuard(allowSubmit?: string[]) {
  let handler: ((route: Route) => Promise<void>) | undefined
  const frame = {}
  const page = { mainFrame: () => frame }
  const context = {
    route: async (_pattern: string, fn: (route: Route) => Promise<void>) => {
      handler = fn
    },
    routeWebSocket: async () => undefined,
    on: () => undefined,
  } as unknown as BrowserContext
  const guard = await installGuard(context, allowSubmit ? { allowSubmit } : {})
  guard.watch(page as never)
  const send = async (request: FakeRequest): Promise<'aborted' | 'fallback' | 'fulfilled'> => {
    let outcome: 'aborted' | 'fallback' | 'fulfilled' = 'fallback'
    const route = {
      request: () => ({
        method: () => request.method,
        url: () => request.url,
        resourceType: () => request.type ?? 'document',
        isNavigationRequest: () => request.navigation === true,
        frame: () => frame,
      }),
      abort: async () => {
        outcome = 'aborted'
      },
      fallback: async () => {
        outcome = 'fallback'
      },
      fulfill: async () => {
        outcome = 'fulfilled'
      },
    } as unknown as Route
    await handler?.(route)
    return outcome
  }
  return { guard, send }
}

describe('the network guard with --allow-submit', () => {
  it('without an allowed origin, never lets a write through and has no window to open', async () => {
    const { guard, send } = await fakeGuard()
    expect(await send({ method: 'POST', url: 'http://127.0.0.1:5173/form' })).toBe('aborted')
    expect(() => guard.openSubmit()).toThrow('the guard has no origin to submit to')
    expect(guard.allowed).toEqual([])
  })

  it('lets a write through only during the window, only to the origin named, and only as a navigation, fetch or XHR', async () => {
    const { guard, send } = await fakeGuard(['http://127.0.0.1:5173'])
    // Loading: other origins' resources still load, as for every probe; writes never do.
    expect(await send({ method: 'GET', url: 'https://cdn.example.com/app.js', type: 'script' })).toBe('fallback')
    expect(await send({ method: 'POST', url: 'http://127.0.0.1:5173/form' })).toBe('aborted')
    guard.arm()
    // Loaded: every other origin is blocked, whatever the method.
    expect(await send({ method: 'GET', url: 'https://cdn.example.com/late.js', type: 'script' })).toBe('aborted')
    expect(await send({ method: 'GET', url: 'http://localhost:5173/pixel.gif', type: 'image' })).toBe('aborted')
    // A navigation of the page is answered locally, outside the window.
    expect(await send({ method: 'GET', url: 'http://127.0.0.1:5173/next', navigation: true })).toBe('fulfilled')
    guard.openSubmit()
    expect(await send({ method: 'POST', url: 'http://127.0.0.1:5173/form', type: 'document', navigation: true })).toBe('fallback')
    expect(await send({ method: 'POST', url: 'http://127.0.0.1:5173/api', type: 'fetch' })).toBe('fallback')
    expect(await send({ method: 'GET', url: 'http://127.0.0.1:5173/step2', navigation: true })).toBe('fallback')
    expect(await send({ method: 'POST', url: 'http://127.0.0.1:5173/beacon', type: 'ping' })).toBe('aborted')
    expect(await send({ method: 'POST', url: 'http://localhost:5173/form', type: 'fetch' })).toBe('aborted')
    expect(await send({ method: 'POST', url: 'http://127.0.0.1:5174/form', type: 'fetch' })).toBe('aborted')
    expect(await send({ method: 'POST', url: 'https://127.0.0.1:5173/form', type: 'fetch' })).toBe('aborted')
    guard.closeSubmit()
    expect(await send({ method: 'POST', url: 'http://127.0.0.1:5173/form', type: 'fetch' })).toBe('aborted')
    expect(guard.log.submitted?.map((entry) => `${entry.method} ${entry.url}`)).toEqual(['POST http://127.0.0.1:5173/form', 'POST http://127.0.0.1:5173/api', 'GET http://127.0.0.1:5173/step2'])
    expect(guard.log.blocked.map((entry) => `${entry.method} ${entry.url}`)).toEqual([
      'POST http://127.0.0.1:5173/form',
      'GET https://cdn.example.com/late.js',
      'GET http://localhost:5173/pixel.gif',
      'POST http://127.0.0.1:5173/beacon',
      'POST http://localhost:5173/form',
      'POST http://127.0.0.1:5174/form',
      'POST https://127.0.0.1:5173/form',
      'POST http://127.0.0.1:5173/form',
    ])
  })
})

// What the probe puts in, and what it never presses.

const id = (tag: string, a: Record<string, string> = {}) => ({ tag, sig: [tag, a.id ?? '', a.role ?? '', a.type ?? '', a.name ?? '', a.href ?? ''].join('|') })
const facts = (texts: string[] = [], extra: Record<string, unknown> = {}) => ({ texts, code: [], disabled: false, submit: false, sensitiveForm: false, download: false, ...extra })

function control(name: string, extra: Partial<StepControl> = {}, texts: string[] = []): StepControl & { facts: ReturnType<typeof facts> } {
  return { ref: `#${name}`, id: id('input', { id: name, name }), tag: 'input', role: 'textbox', name, type: 'text', label: name, group: '', constraints: {}, value: '', shows: true, ...extra, facts: facts(texts) }
}

function form(extra: Partial<StepForm> = {}, submit = 'Send'): StepForm {
  return {
    ref: 'html > body > form',
    id: id('form'),
    tag: 'form',
    role: 'form',
    label: '',
    action: 'http://127.0.0.1:5173/form',
    method: 'post',
    controls: [],
    submit: { ref: 'html > body > form > button', id: id('button'), tag: 'button', role: 'button', label: submit, facts: facts([submit], { submit: true }) },
    sensitive: false,
    captcha: false,
    search: false,
    checkboxes: [],
    reuse: [],
    ...extra,
  }
}

describe('what the form probe submits', () => {
  it('builds a value a simple pattern accepts, and refuses to guess the rest', () => {
    expect(sampleFor(String.raw`\d{5}-?\d{3}`)).toBe('11111111')
    expect(sampleFor(String.raw`\d{3}\.\d{3}\.\d{3}-\d{2}`)).toBe('111.111.111-11')
    expect(sampleFor('[A-Z]{2}[0-9]+')).toBe('AA0')
    expect(sampleFor('(?:abc|de)f?')).toBe('abc')
    expect(sampleFor('[^a]+')).toBeUndefined()
    expect(sampleFor('(?=x)x')).toBeUndefined()
    // The purpose's own value (60000000) does not fit the pattern: a sample built from the pattern does.
    expect(validFor({ type: 'text', constraints: { pattern: String.raw`\d{5}-\d{3}` }, purpose: 'postal-code' })).toBe('11111-111')
    expect(validFor({ type: 'email', constraints: {}, purpose: undefined })).toBe('rampa.teste@example.com')
    expect(validFor({ type: 'number', constraints: { min: '18', max: '120' }, purpose: undefined })).toBe('18')
    expect(validFor({ type: 'text', constraints: { minlength: '15' }, purpose: 'name' })).toBe('Rampa Testeaaaa')
    expect(validFor({ type: 'text', constraints: { pattern: '[^a-z]{4}x' }, purpose: undefined })).toBeUndefined()
  })

  it('derives the invalid value from a stated constraint, and from an e-mail purpose', () => {
    expect(invalidFor({ type: 'email', constraints: { type: 'email' }, purpose: undefined, required: undefined })).toEqual({ value: 'rampa', constraint: 'type', rule: 'type="email"' })
    expect(invalidFor({ type: 'text', constraints: {}, purpose: 'email', required: undefined })).toEqual({ value: 'rampa', constraint: 'purpose', rule: 'autocomplete="email"' })
    expect(invalidFor({ type: 'number', constraints: { min: '18' }, purpose: undefined, required: undefined })).toEqual({ value: '17', constraint: 'min', rule: 'min="18"' })
    expect(invalidFor({ type: 'text', constraints: { required: '' }, purpose: undefined, required: 'label' })).toEqual({ value: '', constraint: 'required', rule: 'a required mark in its label' })
    expect(invalidFor({ type: 'text', constraints: {}, purpose: 'name', required: undefined })).toBeUndefined()
  })

  it('never ticks a box that consents, chooses one radio per group, and leaves hidden fields (honeypots) alone', () => {
    const entries = planEntries(
      form({
        controls: [
          control('terms', { type: 'checkbox', required: 'attribute', label: 'I agree to the terms' }, ['I agree to the terms']),
          control('adult', { type: 'checkbox', required: 'attribute', label: 'I am over 18' }, ['I am over 18']),
          control('news', { type: 'checkbox', label: 'Newsletter' }, ['Newsletter']),
          control('a', { type: 'radio', name: 'plan', ref: '#a' }),
          control('b', { type: 'radio', name: 'plan', ref: '#b' }),
          control('trap', { shows: false }),
          control('email', { type: 'email', constraints: { type: 'email' } }),
        ],
      }),
      'invalid',
      'http://127.0.0.1:5173',
    )
    expect(entries.map((entry) => `${entry.name}=${entry.value}${entry.constraint ? `!${entry.constraint}` : ''}`)).toEqual(['adult=on', 'plan=on', 'email=rampa!type'])
  })

  it('never presses a control that commits, a form with a secret or a CAPTCHA, a skip-list word, or a form that posts elsewhere', () => {
    const allowed = ['http://127.0.0.1:5173']
    expect(stopFor(form(), allowed)).toBeUndefined()
    expect(stopFor(form({}, 'Save and continue'), allowed)).toBeUndefined()
    expect(stopFor(form({}, 'Enviar'), allowed)).toBeUndefined()
    // A payment step with "Pay now" is the commitment 3.3.4 reads, not just a sensitive form.
    expect(stopFor(form({ sensitive: true }, 'Pay now'), allowed)).toEqual({ reason: 'commit', detail: 'financial' })
    expect(stopFor(form({}, 'Delete my account'), allowed)).toEqual({ reason: 'commit', detail: 'data' })
    expect(stopFor(form({}, 'Place order'), allowed)).toEqual({ reason: 'commit', detail: 'financial' })
    expect(stopFor(form({ sensitive: true }, 'Sign in'), allowed)).toEqual({ reason: 'sensitive', detail: 'a password, payment or file field' })
    expect(stopFor(form({ captcha: true }), allowed)).toEqual({ reason: 'captcha' })
    expect(stopFor(form({ submit: undefined }), allowed)).toEqual({ reason: 'no-submit-control' })
    expect(stopFor(form({}, 'Subscribe'), allowed)).toEqual({ reason: 'skip-list', detail: 'subscribe' })
    expect(stopFor(form({}, 'Confirm'), allowed)).toEqual({ reason: 'skip-list', detail: 'confirm' })
    expect(stopFor(form({}, 'Save'), allowed)).toEqual({ reason: 'skip-list', detail: 'save' })
    expect(stopFor(form({ target: '_blank' }), allowed)).toEqual({ reason: 'new-window', detail: 'target="_blank"' })
    expect(stopFor(form({ target: '_self' }), allowed)).toBeUndefined()
    expect(stopFor(form({ action: 'http://localhost:5173/form' }), allowed)).toEqual({ reason: 'other-origin', detail: 'http://localhost:5173' })
    expect(stopFor(form({ action: 'https://127.0.0.1:5173/form' }), allowed)).toEqual({ reason: 'other-origin', detail: 'https://127.0.0.1:5173' })
    expect(submitSkipWord({ texts: ['Submit'], code: ['btn-logout'] })).toBe('logout')
    expect(submitSkipWord({ texts: ['Submit'], code: [], method: 'delete' })).toBe('data-method="delete"')
  })
})

// The rules over recorded submissions, no browser.

const sig = (tag: string, a: Record<string, string>) => id(tag, a).sig
const field = (fieldId: string, attributes: Record<string, string> = {}): A11yNode => ({ ref: `#${fieldId}`, role: 'textbox', name: fieldId, states: [], native: { tag: 'input', attributes: { id: fieldId, name: fieldId, ...attributes } }, children: [] })
const formNode = (ref: string, children: A11yNode[]): A11yNode => ({ ref, role: 'form', states: [], native: { tag: 'form', attributes: {} }, children })
const after = (ref: string, extra: Partial<AfterField> = {}): AfterField => ({ ref, label: ref.slice(1), type: 'text', state: [], validity: [], messages: [], hints: [], constraints: {}, announced: [], ...extra })
const ORIGIN = 'http://127.0.0.1:5173'
const flowForm = (ref: string) => ({ ref, id: { tag: 'form', sig: 'form|||||' }, tag: 'form', role: 'form', label: '', action: `${ORIGIN}/form`, method: 'post' })
const answer = { requests: [{ method: 'POST', url: `${ORIGIN}/form`, status: 200 }], blocked: 0, ms: 100 }

function submitSnapshot(nodes: A11yNode[], flows: SubmitFlow[], record: Partial<ProbeRecord> = {}): A11ySnapshot {
  const data: SubmitData = { viewport: { width: 1280, height: 800 }, allowed: [ORIGIN], origin: ORIGIN, dryRun: false, found: flows.length, flows, writes: 3, loads: flows.length, actions: [], end: 'complete' }
  const probe: ProbeRecord = {
    kind: 'form',
    version: '1',
    conditions: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, browser: 'chromium 1 (headless)', variant: 'submit' },
    status: 'complete',
    guard: { blocked: [], navigations: [], dialogs: [], submitted: [{ method: 'POST', url: `${ORIGIN}/form`, at: 1 }] },
    durationMs: 1,
    data,
    ...record,
  }
  return {
    schemaVersion: 1,
    surface: 'web',
    target: `${ORIGIN}/form`,
    title: 'Form',
    viewport: { width: 1280, height: 800, scale: 1 },
    root: { ref: 'html', role: 'document', states: [], native: { tag: 'html', attributes: {} }, children: [{ ref: 'html > body', role: 'generic', states: [], native: { tag: 'body', attributes: {} }, children: nodes }] },
    observations: { probes: [probe] },
    collectedAt: new Date(0).toISOString(),
    collector: { name: 'rampa-web', version: '0' },
  }
}

const stepControl = (name: string, extra: Partial<StepControl> = {}): StepControl => ({ ref: `#${name}`, id: id('input', { id: name, name }), tag: 'input', role: 'textbox', name, type: 'text', label: name, group: '', constraints: {}, value: '', shows: true, ...extra })

describe('3.3.1 and 3.3.3 over recorded answers: the error state rules on the form the server sent back', () => {
  const email = field('email', { type: 'email' })
  const age = field('age', { type: 'number' })
  const user = field('username')
  const nodes = [formNode('html > body > form', [email, age, user])]
  const flow: SubmitFlow = {
    form: flowForm('html > body > form'),
    steps: [
      {
        index: 1,
        url: `${ORIGIN}/form`,
        title: 'Contact',
        heading: 'Contact us',
        form: flowForm('html > body > form'),
        control: 'Send',
        controls: [],
        reuse: [],
        submissions: [
          {
            kind: 'invalid',
            entries: [],
            noValidate: true,
            ...answer,
            outcome: 'same-step',
            url: `${ORIGIN}/form`,
            cleared: ['Full name'],
            fields: [
              { name: 'email', ref: '#email', id: id('input', { id: 'email', name: 'email', type: 'email' }), label: 'E-mail', constraint: 'type', rule: 'type="email"', typed: 'rampa', constraints: { type: 'email' }, after: after('#email', { label: 'E-mail', type: 'email', state: ['aria-invalid'], invalid: 'true' }), fresh: [] },
              {
                name: 'age',
                ref: '#age',
                id: id('input', { id: 'age', name: 'age', type: 'number' }),
                label: 'Age',
                constraint: 'min',
                rule: 'min="18"',
                typed: '17',
                constraints: { type: 'number', min: '18' },
                after: after('#age', { label: 'Age', type: 'number', state: ['aria-invalid'], invalid: 'true', messages: [{ ref: '#age-error', text: 'Invalid age.', via: 'aria-describedby', shown: true, inTree: true }] }),
                fresh: ['#age-error'],
              },
              {
                name: 'username',
                ref: '#username',
                id: id('input', { id: 'username', name: 'username' }),
                label: 'Username',
                constraint: 'minlength',
                rule: 'minlength="4"',
                typed: 'aaa',
                constraints: { minlength: '4' },
                after: after('#username', { label: 'Username', messages: [{ ref: 'html > body > form > span', text: 'Use at least 4 characters.', via: 'near', shown: true, inTree: true }] }),
                fresh: ['html > body > form > span'],
              },
            ],
          },
        ],
      },
    ],
    stopped: { reason: 'ended' },
  }
  const snapshot = submitSnapshot(nodes, [flow])

  it('fails a field the server marked invalid with no text, and sends a message tied to nothing to review', async () => {
    expect(A11ySnapshotSchema.safeParse(snapshot).success).toBe(true)
    const report = await checkSnapshot(snapshot, emptyEngine(), probeCheckOptions())
    expect(byRule(report, ON_SUBMIT).map((f) => `${f.ref} ${f.confidence}`)).toEqual(['#email medium'])
    expect(byRule(report, ON_SUBMIT)[0]?.message).toContain('Seen after Rampa typed "rampa" (type="email") and submitted the form (POST /form → 200), with --allow-submit.')
    expect(reviewByRule(report, ON_SUBMIT).map((r) => r.ref)).toEqual(['#username'])
    expect(byRule(report, SUGGESTION).map((f) => f.ref)).toEqual(['#age'])
    expect(report.coverage.probes?.find((c) => c.rule === ON_SUBMIT)).toMatchObject({ criterion: '3.3.1', method: 'probe/form@1', status: 'failures', applicable: 3, failures: 1, review: 1 })
    expect(report.coverage.probes?.find((c) => c.rule === SUGGESTION)).toMatchObject({ criterion: '3.3.3', status: 'failures', applicable: 2, failures: 1 })
    expect(report.coverage.probes?.find((c) => c.rule === ON_SUBMIT)?.conditions).toContain(`forms submitted to ${ORIGIN} (--allow-submit)`)
    // The page cleared what was right: 3.3.7's to look at.
    expect(reviewByRule(report, STEPS).map((r) => r.message)).toEqual([expect.stringContaining('it had cleared 1 field(s) Rampa had filled in correctly ("Full name")')])
    expect(report.submissions).toEqual({ allowed: [ORIGIN], dryRun: false, sent: 1, blocked: 0 })
    const pt = await checkSnapshot(snapshot, emptyEngine(), probeCheckOptions({ locale: 'pt-BR' }))
    expect(byRule(pt, ON_SUBMIT)[0]?.message).toContain('Visto depois que o Rampa digitou "rampa" (type="email") e enviou o formulário (POST /form → 200), com --allow-submit.')
  })

  it('sends an error that names no field to review, and says nothing when the text names one', async () => {
    const summary = (alert: string): SubmitFlow => ({
      ...flow,
      steps: [{ ...(flow.steps[0] as SubmitFlow['steps'][number]), submissions: [{ kind: 'invalid', entries: [], noValidate: true, ...answer, outcome: 'same-step', url: `${ORIGIN}/form`, alerts: [alert], fields: [{ name: 'email', ref: '#email', id: id('input', { id: 'email', name: 'email', type: 'email' }), label: 'E-mail', constraint: 'type', rule: 'type="email"', typed: 'rampa', constraints: {}, after: after('#email'), fresh: [] }] }] }],
    })
    const vague = await checkSnapshot(submitSnapshot(nodes, [summary('Something went wrong.')]), emptyEngine(), probeCheckOptions())
    expect(reviewByRule(vague, ON_SUBMIT).map((r) => `${r.ref} ${r.message}`)).toEqual([expect.stringMatching(/^html > body > form After Rampa submitted the form with invalid entries \(POST \/form → 200\), the page showed "Something went wrong\.", but no field is marked/)])
    const named = await checkSnapshot(submitSnapshot(nodes, [summary('Check the e-mail field.')]), emptyEngine(), probeCheckOptions())
    expect(reviewByRule(named, ON_SUBMIT)).toEqual([])
  })
})

describe('3.3.7 and 3.3.4 over recorded steps', () => {
  const nodes = [formNode('html > body > form', [field('name'), field('email', { type: 'email' })])]
  const step1 = (submission: Partial<SubmitFlow['steps'][number]['submissions'][number]> = {}): SubmitFlow['steps'][number] => ({
    index: 1,
    url: `${ORIGIN}/step1`,
    title: 'Your details',
    heading: 'Your details',
    form: flowForm('html > body > form'),
    control: 'Continue',
    controls: [stepControl('name', { purpose: 'name', token: 'name' }), stepControl('email', { type: 'email', purpose: 'email', token: 'email' })],
    reuse: [],
    submissions: [
      {
        kind: 'invalid',
        entries: [
          { ref: '#name', name: 'name', label: 'Full name', type: 'text', value: 'Rampa Teste' },
          { ref: '#email', name: 'email', label: 'E-mail', type: 'email', value: 'rampa', constraint: 'type', rule: 'type="email"' },
        ],
        noValidate: true,
        ...answer,
        outcome: 'next-step',
        url: `${ORIGIN}/step2`,
        ...submission,
      },
    ],
  })
  const step2 = (controls: StepControl[], reuse: string[] = []): SubmitFlow['steps'][number] => ({ index: 2, url: `${ORIGIN}/step2`, title: 'Almost done', heading: 'Almost done', form: flowForm('html > body > form'), control: 'Place order', controls, reuse, submissions: [] })
  const commit = (extra: Partial<NonNullable<SubmitFlow['commit']>> = {}): SubmitFlow['commit'] => ({ step: 2, control: 'Place order', kind: 'financial', checkboxes: [], texts: ['Almost done', 'E-mail', 'Place order'], echoed: [], entered: 2, edit: [], ...extra })
  const bare: SubmitFlow = { form: flowForm('html > body > form'), steps: [step1(), step2([stepControl('email2', { type: 'email', purpose: 'email', token: 'email', label: 'E-mail' })])], commit: commit(), stopped: { reason: 'commit', detail: 'financial' } }

  it('fails a later step that asks again with nothing filled in, and a commitment with no safeguard on the way', async () => {
    const report = await checkSnapshot(submitSnapshot(nodes, [bare]), emptyEngine(), probeCheckOptions())
    expect(byRule(report, STEPS).map((f) => `${f.ref} ${f.confidence}`)).toEqual(['html > body > form medium'])
    expect(byRule(report, STEPS)[0]?.message).toMatch(/^Step 2 of the form \(\/step2\) asks again for email address \("E-mail"\), which step 1 was given/)
    expect(byRule(report, PREVENTION).map((f) => `${f.ref} ${f.confidence}`)).toEqual(['html > body > form medium'])
    expect(byRule(report, PREVENTION)[0]?.message).toContain('commits a purchase or a payment with "Place order", and on the way there Rampa saw none of the safeguards')
    expect(byRule(report, PREVENTION)[0]?.message).toContain('Rampa reached the step and never pressed "Place order".')
    const pt = await checkSnapshot(submitSnapshot(nodes, [bare]), emptyEngine(), probeCheckOptions({ locale: 'pt-BR' }))
    expect(byRule(pt, PREVENTION)[0]?.message).toMatch(/^O passo 2 do formulário \(\/step2\) efetiva uma compra ou um pagamento com "Place order"/)
  })

  it('finds no failure where the later step fills the entry in, offers it or reuses it, and sends a confirmation to review', async () => {
    const flows: SubmitFlow[] = [
      { ...bare, steps: [step1(), step2([stepControl('email2', { type: 'email', purpose: 'email', value: 'rampa' })])] },
      { ...bare, steps: [step1(), step2([stepControl('email2', { type: 'email', purpose: 'email', options: ['rampa (used before)'] })])] },
      { ...bare, steps: [step1(), step2([stepControl('email2', { type: 'email', purpose: 'email' })], ['Use the same e-mail'])] },
      { ...bare, steps: [step1(), step2([stepControl('email2', { type: 'email', purpose: 'email', label: 'Confirm e-mail' })])] },
      { ...bare, steps: [step1(), step2([stepControl('full', { label: 'name' })])] },
    ]
    const report = await checkSnapshot(submitSnapshot(nodes, flows), emptyEngine(), probeCheckOptions())
    expect(byRule(report, STEPS)).toEqual([])
    expect(reviewByRule(report, STEPS).map((r) => r.message)).toEqual([
      expect.stringMatching(/^Step 2 of the form \(\/step2\) may ask again for email address \("Confirm e-mail"\), which step 1 was given, and does not fill it in or offer it\. It asks to confirm the entry/),
      expect.stringMatching(/^Step 2 of the form \(\/step2\) may ask again for "name" \("name"\), which step 1 was given, .* Whether it is the same information/),
    ])
    expect(report.coverage.probes?.find((c) => c.rule === STEPS)).toMatchObject({ applicable: 5, failures: 0, review: 2 })
  })

  it('sends a commitment to review when a review step, a confirmation box, a way back or checked entries came first', async () => {
    const seen = async (flow: SubmitFlow) => reviewByRule(await checkSnapshot(submitSnapshot(nodes, [flow]), emptyEngine(), probeCheckOptions()), PREVENTION).map((r) => r.message)
    expect(await seen({ ...bare, commit: commit({ texts: ['Review your order', 'Place order'] }) })).toEqual([expect.stringContaining('a review step (“review your order”)')])
    expect(await seen({ ...bare, commit: commit({ echoed: ['Rampa Teste', 'rampa'], edit: ['Change'] }) })).toEqual([expect.stringContaining('a review step (2 of 2 entries shown again; with “Change”)')])
    expect(await seen({ ...bare, commit: commit({ checkboxes: ['I have reviewed my order'] }) })).toEqual([expect.stringContaining('a checkbox “I have reviewed my order”')])
    expect(await seen({ ...bare, commit: commit({ texts: ['You can cancel within 14 days for a full refund.'] }) })).toEqual([expect.stringContaining('a word about reversing it')])
    const checked: SubmitFlow = { ...bare, steps: [step1({ outcome: 'same-step', alerts: ['Enter an email address like name@example.com'] }), ...bare.steps.slice(1)] }
    expect(await seen(checked)).toEqual([expect.stringContaining('the server checked the entries: invalid ones came back with errors')])
    // A commitment on the first page is the scope note's, not this rule's.
    const first = await checkSnapshot(submitSnapshot(nodes, [{ ...bare, steps: [step2([])], commit: commit({ step: 1 }) }]), emptyEngine(), probeCheckOptions())
    expect([...byRule(first, PREVENTION), ...reviewByRule(first, PREVENTION)]).toEqual([])
    expect(first.coverage.probes?.find((c) => c.rule === PREVENTION)?.note).toContain('1 control(s) that commit on the first page: the scope note covers them')
  })

  it('reports nothing, and says why, for a dry run or an origin the flag does not name', async () => {
    const dry = submitSnapshot(nodes, [], { status: 'skipped', reason: 'dry run (--submit-dry-run): nothing was submitted', guard: { blocked: [], navigations: [], dialogs: [] } })
    ;(dry.observations?.probes[0]?.data as SubmitData).dryRun = true
    const report = await checkSnapshot(dry, emptyEngine(), probeCheckOptions())
    expect(report.coverage.probes?.filter((c) => c.method === 'probe/form@1').map((c) => `${c.criterion} ${c.status} ${c.note}`)).toEqual([
      '3.3.1 not-checked dry run (--submit-dry-run): nothing was submitted',
      '3.3.3 not-checked dry run (--submit-dry-run): nothing was submitted',
      '3.3.7 not-checked dry run (--submit-dry-run): nothing was submitted',
      '3.3.4 not-checked dry run (--submit-dry-run): nothing was submitted',
    ])
    expect(report.submissions).toEqual({ allowed: [ORIGIN], dryRun: true, sent: 0, blocked: 0 })
    expect(submissionLine(report)).toBe('--submit-dry-run: nothing was submitted; the forms and the values the probe would send are in the probe record.')
    const reason = `the page's origin ${ORIGIN} is not one --allow-submit names (http://localhost:5173); nothing was submitted`
    const refused = await checkSnapshot(submitSnapshot(nodes, [], { status: 'skipped', reason, guard: { blocked: [], navigations: [], dialogs: [] } }), emptyEngine(), probeCheckOptions())
    expect(submissionLine(refused)).toBe(`--allow-submit ${ORIGIN}: nothing was submitted (the page's origin ${ORIGIN} is not one --allow-submit names (http://localhost:5173)).`)
    const sent = await checkSnapshot(submitSnapshot(nodes, [bare]), emptyEngine(), probeCheckOptions())
    const pretty = renderReport(sent, { verbose: false, paint: paint(false) })
    // The header says it, once, before any finding.
    expect(pretty.split('\n').slice(0, 4)).toContain(`Forms submitted (--allow-submit ${ORIGIN}): 1 request(s) let through to it, 0 blocked elsewhere. Run it on test environments only.`)
    expect(pretty.split('Forms submitted (--allow-submit').length).toBe(2)
    const markdown = renderMarkdown([sent])
    expect(markdown.indexOf(`> **Forms submitted (--allow-submit ${ORIGIN}): 1 request(s) let through to it`)).toBeGreaterThan(0)
    expect(markdown.indexOf('> **Forms submitted')).toBeLessThan(markdown.indexOf('WCAG 3.3.4'))
    expect(markdown.split('Forms submitted (--allow-submit').length).toBe(2)
    expect(renderHtml([sent])).toContain(`<p class="page-lead"><strong>Forms submitted (--allow-submit ${ORIGIN}): 1 request(s) let through to it, 0 blocked elsewhere. Run it on test environments only.</strong></p>`)
  })
})

// The CLI refuses what is not an exact origin before anything loads, and rampa mcp has no such flag.

function cli(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    // Async on purpose: the fixture server answers from this process.
    const child = spawn(process.execPath, ['src/cli.ts', ...args], { env: { ...process.env, NO_COLOR: '1', RAMPA_LOCALE: 'en', RAMPA_MODEL: '' } })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })
}

describe('the rampa CLI and --allow-submit', { timeout: 60_000 }, () => {
  it('refuses a wildcard or a path before starting a browser', async () => {
    const wildcard = await cli(['check', 'https://example.com', '--probe', 'form', '--allow-submit', 'https://*.example.com'])
    expect(wildcard.code).toBe(2)
    expect(wildcard.stderr).toContain('--allow-submit takes one exact origin, such as http://localhost:5173 or https://staging.example.com: no wildcards')
    const path = await cli(['check', 'https://example.com', '--probe', 'form', '--allow-submit', 'https://example.com/checkout'])
    expect(path.code).toBe(2)
    expect(path.stderr).toContain('did you mean https://example.com?')
  })

  it('is not an option of rampa mcp', async () => {
    const run = await cli(['mcp', '--allow-submit', 'http://localhost:5173'])
    expect(run.code).toBe(2)
    expect(run.stderr).toContain("unknown option '--allow-submit'")
  })
})

// Integration: needs Chrome or Edge, and the fixture servers. Skipped, with the reason on stderr, when no browser starts.
const browser = await launchBrowser({ args: DETERMINISM_ARGS }).catch((error: unknown) => {
  process.stderr.write(`\nSkipping the form submission tests: no browser started (${error instanceof Error ? error.message.split('\n')[0] : String(error)}).\n`)
  return undefined
})
const servers = browser ? await startSubmitServers() : undefined
afterAll(async () => {
  await browser?.close()
  await servers?.close()
}, 60_000)

const collected = new Map<string, Promise<Collected>>()
function submitted(path: string): Promise<Collected> {
  if (!browser || !servers) throw new Error('no browser')
  let result = collected.get(path)
  if (!result) {
    result = collectWeb(browser, `${servers.origin}${path}`, { runAxe: false, locale: 'en', probes: ['form'], submit: { allowed: [servers.origin] } })
    collected.set(path, result)
  }
  return result
}
const submitRecord = (snapshot: A11ySnapshot) => snapshot.observations?.probes.find((p) => p.kind === 'form' && p.conditions.variant === 'submit')
const dataOf = (snapshot: A11ySnapshot) => submitRecord(snapshot)?.data as SubmitData
/** What the probe POSTed to the server, by path, and whatever reached the other origin. */
const postsTo = (prefix: string) => (servers?.posts ?? []).filter((post) => post.path.startsWith(prefix)).map((post) => post.path)

describe.skipIf(!browser)('form submissions with --allow-submit (3.3.1, 3.3.3, 3.3.4, 3.3.7)', { timeout: 400_000 }, () => {
  it('submits nothing without the flag, and nothing to an origin the flag does not name', async () => {
    if (!browser || !servers) return
    const before = servers.posts.length
    const plain = await collectWeb(browser, `${servers.origin}/errors/`, { runAxe: false, locale: 'en', probes: ['form'] })
    expect(plain.snapshot.observations?.probes.map((p) => `${p.kind}:${p.conditions.variant}`)).toEqual(['form:form'])
    const elsewhere = await collectWeb(browser, `${servers.origin}/errors/`, { runAxe: false, locale: 'en', probes: ['form'], submit: { allowed: [servers.other] } })
    expect(submitRecord(elsewhere.snapshot)).toMatchObject({ status: 'skipped', reason: `the page's origin ${servers.origin} is not one --allow-submit names (${servers.other}); nothing was submitted` })
    // Even the flag alone does not reach the probe: only the form probe reads it.
    const otherProbe = await collectWeb(browser, `${servers.origin}/errors/`, { runAxe: false, locale: 'en', probes: ['layout'], submit: { allowed: [servers.origin] } })
    expect(submitRecord(otherProbe.snapshot)).toBeUndefined()
    expect(servers.posts.length).toBe(before)
    expect(servers.requests.filter((r) => !r.startsWith('GET '))).toEqual([])
    expect(servers.otherRequests).toEqual([])
  })

  it('lists what it would submit in a dry run, and submits nothing', async () => {
    if (!browser || !servers) return
    const before = servers.posts.length
    const { snapshot } = await collectWeb(browser, `${servers.origin}/errors/`, { runAxe: false, locale: 'en', probes: ['form'], submit: { allowed: [servers.origin], dryRun: true } })
    const record = submitRecord(snapshot) as ProbeRecord
    expect(record).toMatchObject({ status: 'skipped', reason: 'dry run (--submit-dry-run): nothing was submitted' })
    expect(record.guard.submitted).toBeUndefined()
    const planned = (record.data as SubmitData).flows[0]?.steps[0]?.planned
    expect(planned?.invalid.map((e) => `${e.name}=${e.value}${e.constraint ? `!${e.constraint}` : ''}`)).toEqual(['name=Rampa Teste', 'email=rampa!type', 'age=17!min', 'username=aaa!minlength', 'cep=a!pattern'])
    expect(planned?.valid.map((e) => `${e.name}=${e.value}`)).toEqual(['name=Rampa Teste', 'email=rampa.teste@example.com', 'age=18', 'username=Rampa Teste', 'cep=60000000'])
    const lines = describeSubmitRecord(record, `${servers.origin}/errors/`)
    expect(lines[0]).toBe(`rampa: --submit-dry-run on ${servers.origin}/errors/: nothing was submitted. Origin ${servers.origin} is named by --allow-submit.`)
    expect(lines).toContain(`  form "Contact us" → POST ${servers.origin}/errors/, pressing "Send"`)
    expect(servers.posts.length).toBe(before)
  })

  it('reads the errors the server finds: untied, unnamed and unsuggested ones', async () => {
    const { snapshot, engine } = await submitted('/errors/')
    expect(A11ySnapshotSchema.safeParse(snapshot).success).toBe(true)
    const record = submitRecord(snapshot)
    expect(record).toMatchObject({ kind: 'form', version: '1', status: 'complete', conditions: { variant: 'submit' } })
    const submissions = dataOf(snapshot).flows[0]?.steps[0]?.submissions ?? []
    expect(submissions.map((s) => `${s.kind} ${s.outcome} ${s.noValidate}`)).toEqual(['invalid same-step true', 'valid ended false'])
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    expect(byRule(report, ON_SUBMIT).map((f) => f.ref)).toEqual(['#email'])
    expect(reviewByRule(report, ON_SUBMIT).map((r) => r.ref)).toEqual(['#username'])
    expect(byRule(report, SUGGESTION).map((f) => f.ref)).toEqual(['#age'])
    expect(reviewByRule(report, STEPS).map((r) => r.message)).toEqual([expect.stringContaining('("Full name")')])
    // C6 still ran first, and still submitted nothing of its own.
    expect(snapshot.observations?.probes.map((p) => `${p.kind}:${p.conditions.variant}`)).toEqual(['form:form', 'form:submit'])
    expect(postsTo('/errors/')).toEqual(['/errors/', '/errors/'])
    expect(record?.guard.submitted?.map((s) => `${s.method} ${s.url.replace(servers?.origin ?? '', '')}`)).toEqual(['POST /errors/', 'POST /errors/'])
  })

  it('walks a flow to its review step, finds the e-mail carried over, and never places the order', async () => {
    const { snapshot, engine } = await submitted('/review/step1')
    const flow = dataOf(snapshot).flows[0]
    expect(flow?.steps.map((s) => `${s.index} ${new URL(s.url).pathname} ${s.submissions.map((x) => `${x.kind}:${x.outcome}`).join(',')}`)).toEqual([
      '1 /review/step1 invalid:same-step,valid:next-step',
      '2 /review/step2 invalid:same-step,valid:next-step',
      '3 /review/step3 ',
    ])
    expect(flow?.stopped).toEqual({ reason: 'commit', detail: 'financial' })
    expect(flow?.commit).toMatchObject({ step: 3, control: 'Place order', echoed: ['Rampa Teste', 'rampa.teste@example.com', 'Rua Rampa 100', 'Fortaleza'], edit: ['Change', 'Change'] })
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    expect([...byRule(report, ON_SUBMIT), ...reviewByRule(report, ON_SUBMIT), ...byRule(report, SUGGESTION), ...byRule(report, STEPS), ...reviewByRule(report, STEPS), ...byRule(report, PREVENTION)]).toEqual([])
    expect(reviewByRule(report, PREVENTION).map((r) => r.message)).toEqual([expect.stringContaining('a review step (“review your order”; 4 of 4 entries shown again; with “Change”); the server checked the entries')])
    expect(report.coverage.probes?.find((c) => c.rule === STEPS)).toMatchObject({ status: 'no-failure-found', applicable: 1 })
    expect(postsTo('/review/')).toEqual(['/review/step1', '/review/step1', '/review/step2', '/review/step2'])
    expect(servers?.requests.some((r) => r.includes('/review/place'))).toBe(false)
  })

  it('fails a flow that asks for the e-mail again and commits with no safeguard, and never places the order', async () => {
    const { snapshot, engine } = await submitted('/bare/step1')
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    expect(byRule(report, PREVENTION).map((f) => f.ref)).toEqual(['html > body > main > form'])
    expect(byRule(report, STEPS).map((f) => f.evidence)).toEqual([expect.stringContaining('step 1 "E-mail" (autocomplete="email") was given "rampa"; step 2 (/bare/step2) "E-mail" (autocomplete="email") arrived empty')])
    expect(report.coverage.probes?.find((c) => c.rule === ON_SUBMIT)?.note).toContain('1 submission(s) with invalid entries were accepted and moved on, with no error')
    expect(postsTo('/bare/')).toEqual(['/bare/step1'])
    expect(servers?.requests.some((r) => r.includes('/bare/place'))).toBe(false)
  })

  it('keeps every other origin blocked: a form that posts there, and a submission that tries to reach it', async () => {
    const { snapshot } = await submitted('/leak/')
    const flows = dataOf(snapshot).flows
    expect(flows.map((f) => `${f.form.label} ${f.stopped.reason}`)).toEqual(['Elsewhere other-origin', 'Here ended'])
    // The form that posts elsewhere is never pressed.
    expect(flows[0]?.steps[0]?.submissions).toEqual([])
    const record = submitRecord(snapshot)
    const other = servers?.other ?? ''
    expect(record?.guard.blocked.map((b) => `${b.method} ${b.url.replace(other, 'OTHER').replace(servers?.origin ?? '', '')} ${b.type}`).sort()).toEqual(['GET OTHER/pixel.gif image', 'POST /beacon-home ping', 'POST OTHER/beacon fetch'])
    expect(postsTo('/leak/')).toEqual(['/leak/ok'])
    expect(servers?.requests.some((r) => r.includes('beacon'))).toBe(false)
    expect(servers?.otherRequests).toEqual([])
  })

  it('never submits a sign-in form, a deletion or a subscription', async () => {
    const { snapshot } = await submitted('/never/')
    expect(dataOf(snapshot).flows.map((f) => `${f.form.label}: ${f.stopped.reason} ${f.stopped.detail ?? ''}`.trim())).toEqual([
      'Sign in: sensitive a password, payment or file field',
      'Danger zone: commit data',
      'Newsletter: skip-list subscribe',
    ])
    expect(submitRecord(snapshot)?.guard.submitted).toBeUndefined()
    expect(postsTo('/never/')).toEqual([])
  })

  it('replays a saved snapshot offline to the same findings and header', async () => {
    const { snapshot, engine } = await submitted('/bare/step1')
    const live = await checkSnapshot(snapshot, engine, probeCheckOptions())
    const dir = await mkdtemp(join(tmpdir(), 'rampa-submit-'))
    const path = join(dir, 'bare.snapshot.json')
    await writeFile(path, JSON.stringify(snapshot), 'utf8')
    await writeFile(join(dir, 'bare.engine.json'), JSON.stringify(engine), 'utf8')
    const loaded = await loadRecorded(path, 'en')
    const replayed = await checkSnapshot(loaded.snapshot, loaded.engine, probeCheckOptions())
    const key = (report: Report) => [...report.findings, ...(report.needsReview ?? [])].map((f) => `${'fingerprint' in f ? f.fingerprint : ''} ${f.ref} ${f.evidence ?? ''}`)
    expect(key(replayed)).toEqual(key(live))
    expect(replayed.submissions).toEqual(live.submissions)
    // The POST; the server's redirect to the next step is followed by the browser, not routed through the guard.
    expect(replayed.submissions).toMatchObject({ allowed: [servers?.origin], dryRun: false, sent: 1 })
  })

  it('says it loudly on the command line, and only does it with --probe form', async () => {
    if (!servers) return
    const before = servers.posts.length
    const off = await cli(['check', `${servers.origin}/bare/step1`, '--no-llm', '--allow-submit', servers.origin])
    expect(off.stderr).toContain('rampa: --allow-submit takes effect only with --probe form (or --probe interact); nothing is submitted.')
    expect(servers.posts.length).toBe(before)
    const dry = await cli(['check', `${servers.origin}/review/step1`, '--no-llm', '--probe', 'form', '--submit-dry-run'])
    expect(dry.stderr).toContain(`rampa: --submit-dry-run on ${servers.origin}/review/step1: nothing was submitted. Origin ${servers.origin} is not named by --allow-submit, so nothing would be sent.`)
    expect(dry.stdout).toContain('--submit-dry-run: nothing was submitted')
    expect(servers.posts.length).toBe(before)
    const run = await cli(['check', `${servers.origin}/bare/step1`, '--no-llm', '--probe', 'form', '--allow-submit', servers.origin, '--format', 'json'])
    expect(run.stderr).toContain(`rampa: --allow-submit: the form probe will SUBMIT forms on ${servers.origin}, writing to that server. Use it on test environments only.`)
    expect(run.stderr).toContain(`rampa: --allow-submit: 1 request(s) let through to ${servers.origin} on ${servers.origin}/bare/step1: POST /bare/step1; 0 blocked.`)
    expect(run.stderr).toContain('  form "Your details": 2 step(s); stops at a control that commits (financial): never pressed')
    const report = JSON.parse(run.stdout) as Report
    expect(report.submissions).toEqual({ allowed: [servers.origin], dryRun: false, sent: 1, blocked: 0 })
    expect(servers.posts.slice(before).map((post) => post.path)).toEqual(['/bare/step1'])
  })
})
