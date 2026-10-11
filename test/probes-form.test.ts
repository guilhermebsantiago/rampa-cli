import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { checkSnapshot } from '../src/core/check.ts'
import type { Report } from '../src/core/types.ts'
import { emptyEngine } from '../src/engine/axe.ts'
import { type AfterField, type FormData, type FormField, type RedundantPair, type TrialResult, valueFor } from '../src/probes/form.ts'
import { DETERMINISM_ARGS, parseProbeKinds } from '../src/probes/run.ts'
import { pairVerdicts } from '../src/rules/form.ts'
import { A11ySnapshotSchema, type A11yNode, type A11ySnapshot, type ProbeRecord } from '../src/snapshot/schema.ts'
import { indexTree } from '../src/snapshot/tree.ts'
import { loadRecorded } from '../src/surfaces/targets.ts'
import { type Collected, collectWeb, launchBrowser } from '../src/surfaces/web.ts'
import { startFixtureServers } from './media-server.ts'
import { byRule, probeCheckOptions, reviewByRule } from './probe-helpers.ts'

const ERROR = 'rampa/error-on-leave'
const SUGGESTION = 'rampa/suggestion-on-leave'
const REDUNDANT = 'rampa/redundant-entry'

describe('the form probe is opt-in', () => {
  it('stays out of --probe all and joins --probe interact', () => {
    expect(parseProbeKinds('all')).not.toContain('form')
    expect(parseProbeKinds('form')).toEqual(['form'])
    expect(parseProbeKinds('interact')).toContain('form')
  })

  it('types synthetic values that look like the purpose of the first field of a pair', () => {
    expect(valueFor({ purpose: 'billing street-address', type: 'text' })).toBe('Rua Rampa 100')
    expect(valueFor({ purpose: 'home email', type: 'email' })).toBe('rampa.teste@example.com')
    expect(valueFor({ type: 'tel' })).toBe('12345')
    expect(valueFor({ type: 'text' })).toBe('Rampa Teste')
  })
})

// Recorded facts, no browser.

const sig = (tag: string, a: Record<string, string>) => [tag, a.id ?? '', a.role ?? '', a.type ?? '', a.name ?? '', a.href ?? ''].join('|')
const input = (id: string, attributes: Record<string, string> = {}, states: string[] = []): A11yNode => ({
  ref: `#${id}`,
  role: 'textbox',
  name: id,
  states,
  native: { tag: 'input', attributes: { id, name: id, ...attributes } },
  children: [],
})
const span = (id: string, text: string): A11yNode => ({ ref: `#${id}`, role: 'generic', states: [], native: { tag: 'span', attributes: { id, class: 'error' } }, text, children: [] })

function after(ref: string, extra: Partial<AfterField> = {}): AfterField {
  return { ref, label: ref.slice(1), type: 'text', state: ['user-invalid'], validity: [], messages: [], hints: [], constraints: {}, announced: [], ...extra }
}

function field(node: A11yNode, results: TrialResult[], extra: Partial<FormField> = {}): FormField {
  const attributes = node.native.attributes as Record<string, string>
  return {
    ref: node.ref,
    id: { tag: 'input', sig: sig('input', attributes) },
    tag: 'input',
    role: 'textbox',
    label: node.name ?? '',
    type: attributes.type ?? 'text',
    constraints: {},
    trials: results.map((r) => ({ constraint: r.constraint, value: r.typed, rule: r.rule })),
    results,
    ...extra,
  }
}

const trial = (extra: Partial<TrialResult>): TrialResult => ({ constraint: 'type', rule: 'type="email"', typed: 'rampa', validity: ['typeMismatch'], userInvalid: true, reacted: true, ...extra })

function formSnapshot(nodes: A11yNode[], data: Partial<FormData>): A11ySnapshot {
  const full: FormData = { viewport: { width: 1280, height: 800 }, found: 0, unconstrained: 0, fields: [], tried: 0, pairs: [], loads: 1, actions: [], end: 'complete', ...data }
  const record: ProbeRecord = {
    kind: 'form',
    version: '1',
    conditions: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, browser: 'chromium 1 (headless)', variant: 'form' },
    status: 'complete',
    guard: { blocked: [], navigations: [], dialogs: [] },
    durationMs: 1,
    data: full,
  }
  const form: A11yNode = { ref: 'html > body > form', role: 'form', states: [], native: { tag: 'form', attributes: {} }, children: nodes }
  return {
    schemaVersion: 1,
    surface: 'web',
    target: 'https://example.com/',
    title: 'Join',
    viewport: { width: 1280, height: 800, scale: 1 },
    root: { ref: 'html', role: 'document', states: [], native: { tag: 'html', attributes: {} }, children: [{ ref: 'html > body', role: 'generic', states: [], native: { tag: 'body', attributes: {} }, children: [form] }] },
    observations: { probes: [record] },
    collectedAt: new Date(0).toISOString(),
    collector: { name: 'rampa-web', version: '0' },
  }
}

describe('3.3.1 and 3.3.3 over recorded entries: the error state rules on the page after an entry was left', () => {
  const email = input('email', { type: 'email', 'aria-describedby': 'email-error' })
  const age = input('age', { type: 'number', min: '18', 'aria-describedby': 'age-error' })
  const user = input('user', { minlength: '4' })
  const city = input('city', { minlength: '2' })
  const hinted = input('nick', { minlength: '3' })
  const code = input('code', { minlength: '6', 'aria-invalid': 'true', 'aria-describedby': 'code-error' })
  const nodes = [email, span('email-error', ''), age, span('age-error', ''), user, city, hinted, span('nick-hint', 'Invalid characters are removed.'), code, span('code-error', 'The code has 6 letters.')]
  const fields = [
    // Marked invalid, and no text.
    field(email, [trial({ after: after('#email', { type: 'email', state: ['aria-invalid', 'user-invalid'], invalid: 'true', validity: ['typeMismatch'], constraints: { type: 'email' } }) })]),
    // A message tied to the field that names no rule.
    field(age, [
      trial({
        constraint: 'min',
        rule: 'min="18"',
        typed: '17',
        validity: ['rangeUnderflow'],
        after: after('#age', { type: 'number', state: ['aria-invalid', 'user-invalid'], invalid: 'true', validity: ['rangeUnderflow'], constraints: { min: '18', type: 'number' }, messages: [{ ref: '#age-error', text: 'Invalid age.', via: 'aria-describedby', shown: true, inTree: true }] }),
      }),
    ]),
    // A message next to the field, neither tied nor announced.
    field(user, [
      trial({
        constraint: 'minlength',
        rule: 'minlength="4"',
        typed: 'aaa',
        validity: ['tooShort'],
        after: after('#user', { validity: ['tooShort'], constraints: { minlength: '4' }, messages: [{ ref: 'html > body > form > div', text: 'Use at least 4 characters.', via: 'near', shown: true, inTree: true }] }),
      }),
    ]),
    // The browser's own validation only.
    field(city, [trial({ constraint: 'minlength', rule: 'minlength="2"', typed: 'a', validity: ['tooShort'], reacted: false, after: after('#city', { validity: ['tooShort'] }) })]),
    // A hint worded as an error that was on the page before: not an error that appeared.
    field(hinted, [trial({ constraint: 'minlength', rule: 'minlength="3"', typed: 'aa', validity: ['tooShort'], after: after('#nick', { messages: [{ ref: '#nick-hint', text: 'Invalid characters are removed.', via: 'near', shown: true, inTree: true }] }) })]),
    // In an error state on load: B8's rules read it.
    field(code, [trial({ constraint: 'minlength', rule: 'minlength="6"', typed: 'aaaaa', validity: ['tooShort'], after: after('#code', { state: ['aria-invalid'], invalid: 'true' }) })]),
  ]
  const snapshot = formSnapshot(nodes, { found: 6, tried: 6, fields })

  it('fails a field marked invalid with no text, and sends a message tied to nothing to review', async () => {
    const report = await checkSnapshot(snapshot, emptyEngine(), probeCheckOptions())
    const failures = byRule(report, ERROR)
    expect(failures.map((f) => `${f.ref} ${f.confidence}`)).toEqual(['#email medium'])
    expect(failures[0]?.message).toMatch(/^The field "email" is marked invalid \(aria-invalid="true", :user-invalid \(typeMismatch\)\), and no text says what is wrong/)
    expect(failures[0]?.message).toContain('Seen after Rampa typed "rampa" (type="email") and left the field; nothing was submitted.')
    expect(reviewByRule(report, ERROR).map((r) => r.ref)).toEqual(['#user'])
    expect(reviewByRule(report, ERROR)[0]?.message).toContain('is neither tied to the field (aria-describedby, aria-errormessage) nor announced')
    const row = report.coverage.probes?.find((c) => c.criterion === '3.3.1')
    expect(row).toMatchObject({ method: 'probe/form@1', rule: ERROR, status: 'failures', applicable: 3, failures: 1, review: 1 })
    expect(row?.note).toContain('2 left to the browser')
    expect(row?.note).toContain('1 already in an error state on load')
  })

  it('fails a message that does not state the rule the field breaks', async () => {
    const report = await checkSnapshot(snapshot, emptyEngine(), probeCheckOptions())
    expect(byRule(report, SUGGESTION).map((f) => f.ref)).toEqual(['#age'])
    expect(byRule(report, SUGGESTION)[0]?.evidence).toBe('typed "17" (min="18") and left the field; rangeUnderflow: min="18"; message "Invalid age."; label "age"')
    // "Use at least 4 characters." states the rule.
    expect(report.coverage.probes?.find((c) => c.criterion === '3.3.3')).toMatchObject({ status: 'failures', applicable: 2, failures: 1 })
    const pt = await checkSnapshot(snapshot, emptyEngine(), probeCheckOptions({ locale: 'pt-BR' }))
    expect(byRule(pt, SUGGESTION)[0]?.message).toMatch(/Visto depois que o Rampa digitou "17" \(min="18"\) e saiu do campo; nada foi enviado\.$/)
  })

  it('says nothing when no field showed an error of the page’s own', async () => {
    const quiet = formSnapshot(nodes.slice(5, 8), { found: 2, tried: 2, fields: fields.slice(3, 5) })
    const report = await checkSnapshot(quiet, emptyEngine(), probeCheckOptions())
    expect([...byRule(report, ERROR), ...reviewByRule(report, ERROR), ...byRule(report, SUGGESTION)]).toEqual([])
    expect(report.coverage.probes?.find((c) => c.criterion === '3.3.1')).toMatchObject({ status: 'not-checked', applicable: 0 })
    expect(report.coverage.criteria?.find((c) => c.id === '3.3.1')?.status).toBe('not-checked')
  })
})

describe('3.3.7 over recorded pairs', () => {
  const entry = (id: string, label: string, group: string, extra: Partial<RedundantPair['first']> = {}): RedundantPair['first'] => ({
    ref: `#${id}`,
    id: { tag: 'input', sig: sig('input', { id, name: id }) },
    tag: 'input',
    role: 'textbox',
    label,
    group,
    type: 'text',
    shows: true,
    ...extra,
  })
  const pair = (first: string, again: string, extra: Partial<RedundantPair> = {}): RedundantPair => ({
    first: entry(first, 'Street', 'Billing address', { purpose: 'street-address', token: 'billing street-address', location: 'billing' }),
    again: entry(again, 'Street', 'Shipping address', { purpose: 'street-address', token: 'shipping street-address', location: 'shipping' }),
    basis: 'autocomplete',
    address: true,
    confirm: false,
    reuse: [],
    trial: { typed: 'Rua Rampa 100', populated: false, offered: false },
    ...extra,
  })
  const pairs = [
    pair('b1', 's1'),
    pair('b2', 's2', { reuse: [{ ref: '#same', id: { tag: 'input', sig: 'input|same||checkbox||' }, tag: 'input', role: 'checkbox', label: 'Same as billing', control: 'checkbox', shows: true, checked: true }] }),
    pair('b3', 's3', { trial: { typed: 'Rua Rampa 100', populated: true } }),
    pair('b4', 's4', { trial: { typed: 'Rua Rampa 100', populated: false, offered: true } }),
    pair('b5', 's5', { confirm: true }),
    pair('b6', 's6', { trial: { outcome: 'hidden' } }),
    pair('b7', 's7', { address: false, basis: 'label' }),
    pair('b8', 's8', { trial: { outcome: 'skipped', reason: 'sensitive-form' } }),
  ]
  const nodes = pairs.flatMap((p) => [input(p.first.ref.slice(1)), input(p.again.ref.slice(1))])
  const snapshot = formSnapshot(nodes, { pairs })

  it('fails billing and shipping asked twice with nothing to reuse, and sends the doubtful pairs to review', async () => {
    const { verdicts } = pairVerdicts(snapshot.observations?.probes[0]?.data as FormData, indexTree(snapshot.root))
    expect(verdicts.map((v) => `${v.node.ref} ${v.result} ${v.why}`)).toEqual([
      '#s1 failure no-reuse',
      '#s2 pass reuse',
      '#s3 pass populated',
      '#s4 pass offered',
      '#s5 review confirm',
      '#s6 review later',
      '#s7 review no-reuse',
      '#s8 review not-tried',
    ])
    const report = await checkSnapshot(snapshot, emptyEngine(), probeCheckOptions())
    expect(byRule(report, REDUNDANT).map((f) => `${f.ref} ${f.confidence}`)).toEqual(['#s1 medium'])
    expect(byRule(report, REDUNDANT)[0]?.message).toMatch(/^The form asks for street address twice, "Street" \(Billing address\) and again "Street" \(Shipping address\)/)
    expect(reviewByRule(report, REDUNDANT).map((r) => r.ref)).toEqual(['#s5', '#s6', '#s7', '#s8'])
    expect(report.coverage.probes?.find((c) => c.criterion === '3.3.7')).toMatchObject({ status: 'failures', applicable: 8, failures: 1, review: 4 })
    const pt = await checkSnapshot(snapshot, emptyEngine(), probeCheckOptions({ locale: 'pt-BR' }))
    expect(byRule(pt, REDUNDANT)[0]?.message).toMatch(/^O formulário pede o endereço duas vezes/)
  })

  it('is beyond the target under WCAG 2.1', async () => {
    const report = await checkSnapshot(snapshot, emptyEngine(), probeCheckOptions({ wcag: '2.1' }))
    expect([...report.findings, ...report.belowThreshold].filter((f) => f.ruleId === REDUNDANT)).toEqual([])
    expect((report.beyondTarget ?? []).map((f) => `${f.ref} ${f.beyondTarget}`)).toEqual(['#s1 true'])
  })
})

// Integration: needs Chrome or Edge, and the fixtures over HTTP. Skipped, with the reason on stderr, when no browser starts.
const browser = await launchBrowser({ args: DETERMINISM_ARGS }).catch((error: unknown) => {
  process.stderr.write(`\nSkipping the form probe tests: no browser started (${error instanceof Error ? error.message.split('\n')[0] : String(error)}).\n`)
  return undefined
})
const servers = browser ? await startFixtureServers() : undefined
afterAll(async () => {
  await browser?.close()
  await servers?.close()
}, 60_000)

const collected = new Map<string, Promise<Collected>>()
function probed(name: string): Promise<Collected> {
  if (!browser || !servers) throw new Error('no browser')
  let result = collected.get(name)
  if (!result) {
    result = collectWeb(browser, `${servers.origin}/${name}`, { runAxe: false, locale: 'en', probes: ['form'] })
    collected.set(name, result)
  }
  return result
}

const recordOf = (snapshot: A11ySnapshot) => snapshot.observations?.probes.find((p) => p.kind === 'form')
const dataOf = (snapshot: A11ySnapshot) => recordOf(snapshot)?.data as FormData

describe.skipIf(!browser)('form probe (3.3.1, 3.3.3, 3.3.7)', { timeout: 400_000 }, () => {
  it('types an invalid value into each field, leaves it, and reads the errors the page shows', async () => {
    const { snapshot, engine } = await probed('form-fail.html')
    expect(A11ySnapshotSchema.safeParse(snapshot).success).toBe(true)
    expect(recordOf(snapshot)).toMatchObject({ kind: 'form', version: '1', status: 'complete', conditions: { variant: 'form' } })
    const data = dataOf(snapshot)
    expect(data.fields.map((f) => `${f.ref} ${f.trials.map((t) => `${t.constraint}:${t.value}`).join(',')}`)).toEqual([
      '#email type:rampa,required:',
      '#age min:17',
      '#username minlength:aaa',
      '#cep pattern:a',
      '#phone required:',
    ])
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    expect(byRule(report, ERROR).map((f) => f.ref)).toEqual(['#email'])
    expect(reviewByRule(report, ERROR).map((r) => r.ref)).toEqual(['#username', '#phone'])
    expect(byRule(report, SUGGESTION).map((f) => f.ref)).toEqual(['#age', '#username'])
    expect(reviewByRule(report, SUGGESTION).map((r) => r.ref)).toEqual(['#cep'])
    // Nothing was submitted; the username check the page sent on leaving the field was blocked.
    const origin = servers?.origin ?? ''
    expect(recordOf(snapshot)?.guard.blocked.map((b) => `${b.method} ${b.url}`)).toEqual([`POST ${origin}/check-username`])
    expect((servers?.requests ?? []).filter((r) => !r.startsWith('GET '))).toEqual([])
    expect(data.actions.filter((a) => a.action === 'submit')).toEqual([])
  })

  it('finds no failure where each error names its field and its rule', async () => {
    const { snapshot, engine } = await probed('form-pass.html')
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    expect([...byRule(report, ERROR), ...byRule(report, SUGGESTION)]).toEqual([])
    expect([...reviewByRule(report, ERROR), ...reviewByRule(report, SUGGESTION)]).toEqual([])
    expect(report.coverage.probes?.find((c) => c.criterion === '3.3.1')).toMatchObject({ status: 'no-failure-found', applicable: 6 })
    expect(report.coverage.probes?.find((c) => c.criterion === '3.3.3')).toMatchObject({ status: 'no-failure-found', applicable: 5 })
    expect(report.coverage.probes?.find((c) => c.criterion === '3.3.1')?.note).toContain('1 left to the browser')
  })

  it('leaves out hints that were always there, errors on load, errors on submit and forms with a password', async () => {
    const { snapshot, engine } = await probed('form-near.html')
    const data = dataOf(snapshot)
    expect(data.fields.filter((f) => f.skip).map((f) => `${f.ref} ${f.skip?.reason}`)).toEqual(['#user sensitive-form', '#pw secret', '#holder sensitive-form', '#card-number sensitive-form'])
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    expect([...byRule(report, ERROR), ...reviewByRule(report, ERROR), ...byRule(report, SUGGESTION), ...reviewByRule(report, SUGGESTION)]).toEqual([])
    const row = report.coverage.probes?.find((c) => c.criterion === '3.3.1')
    expect(row).toMatchObject({ status: 'no-failure-found', applicable: 1 })
    expect(row?.note).toContain('2 left to the browser')
    expect(row?.note).toContain('1 already in an error state on load')
    expect((servers?.requests ?? []).filter((r) => r.includes('/touched'))).toEqual([])
  })

  it('fails billing and shipping asked twice, and sends a confirmation and a later step to review', async () => {
    const { snapshot, engine } = await probed('form-redundant.html')
    expect(dataOf(snapshot).pairs.map((p) => `${p.first.ref}>${p.again.ref} ${p.basis}${p.address ? ' address' : ''}${p.confirm ? ' confirm' : ''}`)).toEqual([
      '#b-street>#s-street autocomplete address',
      '#b-city>#s-city label address',
      '#email>#email2 autocomplete confirm',
      '#name>#from autocomplete',
    ])
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    expect(byRule(report, REDUNDANT).map((f) => f.ref)).toEqual(['#s-street', '#s-city'])
    expect(byRule(report, REDUNDANT)[0]?.evidence).toContain('typed "Rua Rampa 100" into the first and left it: the second was not filled in and offered nothing')
    expect(reviewByRule(report, REDUNDANT).map((r) => r.ref)).toEqual(['#email2', '#from'])
  })

  it('finds no failure where a control reuses the entry, the page fills it in, or offers it', async () => {
    const { snapshot, engine } = await probed('form-reuse.html')
    const { verdicts } = pairVerdicts(dataOf(snapshot), indexTree(snapshot.root))
    expect(verdicts.map((v) => `${v.node.ref} ${v.result} ${v.why}`)).toEqual(['#s-street pass reuse', '#receipt pass populated', '#invoice-name pass offered'])
    expect(dataOf(snapshot).pairs[0]?.trial?.toggled).toEqual({ label: 'Shipping address is the same as my billing address', effect: 'shown' })
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    expect([...byRule(report, REDUNDANT), ...reviewByRule(report, REDUNDANT)]).toEqual([])
    expect(report.coverage.probes?.find((c) => c.criterion === '3.3.7')).toMatchObject({ status: 'no-failure-found', applicable: 3 })
  })

  it('replays a saved snapshot offline to the same findings', async () => {
    const { snapshot, engine } = await probed('form-fail.html')
    const live = await checkSnapshot(snapshot, engine, probeCheckOptions())
    const dir = await mkdtemp(join(tmpdir(), 'rampa-form-'))
    const path = join(dir, 'form.snapshot.json')
    await writeFile(path, JSON.stringify(snapshot), 'utf8')
    await writeFile(join(dir, 'form.engine.json'), JSON.stringify(engine), 'utf8')
    const loaded = await loadRecorded(path, 'en')
    const replayed = await checkSnapshot(loaded.snapshot, loaded.engine, probeCheckOptions())
    const key = (report: Report) => [...report.findings, ...(report.needsReview ?? [])].map((f) => `${'fingerprint' in f ? f.fingerprint : ''} ${f.ref} ${f.evidence ?? ''}`)
    expect(key(replayed)).toEqual(key(live))
    expect(replayed.coverage.probes).toEqual(live.coverage.probes)
  })
})
