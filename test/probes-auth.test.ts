import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { checkSnapshot } from '../src/core/check.ts'
import type { Report } from '../src/core/types.ts'
import { accessibleAuthentication } from '../src/criteria/accessible-authentication.ts'
import { probeJudgments } from '../src/criteria/probe-judgments.ts'
import { emptyEngine } from '../src/engine/axe.ts'
import type { JudgeRequest, ModelProvider } from '../src/providers/types.ts'
import { type AuthData, type AuthField, type AuthStep, DUMMY_CODE, DUMMY_PASSWORD, arrived, dummyFor } from '../src/probes/auth.ts'
import { withClipboard } from '../src/probes/clipboard.ts'
import { snapshotSignature } from '../src/probes/identity.ts'
import type { InPageElement } from '../src/probes/kit.ts'
import { DETERMINISM_ARGS, parseProbeKinds } from '../src/probes/run.ts'
import { renderReport } from '../src/report/pretty.ts'
import { paint } from '../src/report/color.ts'
import { A11ySnapshotSchema, type A11yNode, type A11ySnapshot, type ProbeRecord } from '../src/snapshot/schema.ts'
import { loadRecorded } from '../src/surfaces/targets.ts'
import { type Collected, collectWeb, launchBrowser } from '../src/surfaces/web.ts'
import { byRule, fixture, probeCheckOptions, reviewByRule } from './probe-helpers.ts'

const RULE = 'rampa/accessible-authentication'

describe('the authentication probe, in parts', () => {
  it('runs only when named: --probe all leaves it out', () => {
    expect(parseProbeKinds('all')).not.toContain('auth')
    expect(parseProbeKinds('auth')).toEqual(['auth'])
    expect(parseProbeKinds('all,auth')).toContain('auth')
  })

  it('takes a value as arrived when the field trims it, reformats it or holds it with separators', () => {
    expect(arrived('Rampa-probe-7319', DUMMY_PASSWORD)).toBe(true)
    expect(arrived('7319 2846', '73192846')).toBe(true)
    expect(arrived('731-928', '731928')).toBe(true)
    expect(arrived('7', '731928')).toBe(false)
    expect(arrived('', DUMMY_PASSWORD)).toBe(false)
  })

  it('pastes digits into a code or a numeric field, cut to its maxlength or to its number of boxes', () => {
    const box = (n: number) => Array.from({ length: n }, (_, i) => ({ ref: `#d${i}`, id: { tag: 'input', sig: `input|d${i}||||` }, tag: 'input', role: 'textbox', label: '' }))
    expect(dummyFor({ kind: 'password', type: 'password' })).toBe(DUMMY_PASSWORD)
    expect(dummyFor({ kind: 'password', type: 'password', maxlength: 1 })).toBe('R')
    expect(dummyFor({ kind: 'code', type: 'text', maxlength: 6 })).toBe(DUMMY_CODE.slice(0, 6))
    expect(dummyFor({ kind: 'code', type: 'text', group: box(4) })).toBe('7319')
    expect(dummyFor({ kind: 'password', type: 'tel', inputmode: 'numeric', maxlength: 6 })).toBe('731928')
  })

  it('hands the clipboard to one paste at a time', async () => {
    const browser = {} as Parameters<typeof withClipboard>[0]
    const order: string[] = []
    const slow = withClipboard(browser, async () => {
      order.push('a start')
      await new Promise((resolve) => setTimeout(resolve, 30))
      order.push('a end')
    })
    const fast = withClipboard(browser, async () => {
      order.push('b')
    })
    await Promise.all([slow, fast])
    expect(order).toEqual(['a start', 'a end', 'b'])
  })
})

// ---- the rule and the judgment, over recorded facts ----------------------------------------------------------------

const node = (ref: string, tag: string, attributes: Record<string, string> = {}): A11yNode => ({ ref, role: tag === 'input' ? 'textbox' : 'generic', states: [], native: { tag, attributes }, children: [] })
const el = (n: A11yNode, label = ''): InPageElement => ({ ref: n.ref, id: { tag: String(n.native.tag), sig: snapshotSignature(n) }, tag: String(n.native.tag), role: n.role, label })

const FORM = node('#signin', 'form', { id: 'signin' })
const PASS = node('#pass', 'input', { id: 'pass', type: 'password', name: 'password' })
const CODE = node('#d1', 'input', { id: 'd1' })
const KEYS = node('#bankpass', 'input', { id: 'bankpass', type: 'password' })
const CAPTCHA = node('#puzzle', 'div', { id: 'puzzle' })

const password = (extra: Partial<AuthField> = {}): AuthField => ({ el: el(PASS, 'Password'), kind: 'password', type: 'password', autocomplete: 'current-password', ignore: [], readonlyAtLoad: false, readonly: false, label: 'Password', listeners: [], ...extra })
const pasted = (ok: boolean, typed = true) => ({ value: DUMMY_PASSWORD, reads: ok ? [DUMMY_PASSWORD] : ['', ''], arrived: ok, events: [{ type: 'paste', trusted: true, prevented: !ok }], clipboard: true, guarded: 0, restored: true, ...(ok ? {} : { typed: { key: 'a', arrived: typed } }) })
const step = (extra: Partial<AuthStep> = {}): AuthStep => ({ el: el(FORM), kind: 'login', why: 'a password field', fields: [password({ paste: pasted(true) })], texts: ['Sign in', 'Password'], ...extra })

function snapshotOf(data: Partial<AuthData>): A11ySnapshot {
  const full: AuthData = { viewport: { width: 1280, height: 800 }, steps: [], hidden: [], captchas: [], alternatives: [], links: [], clipboard: 'ok', end: 'complete', ...data }
  const record: ProbeRecord = {
    kind: 'auth',
    version: '1',
    conditions: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, browser: 'chromium 1 (headless)', variant: 'paste' },
    status: 'complete',
    guard: { blocked: [], navigations: [], dialogs: [] },
    durationMs: 1,
    data: full,
  }
  const body: A11yNode = { ref: 'html > body', role: 'generic', states: [], native: { tag: 'body', attributes: {} }, children: [{ ...FORM, children: [PASS, CODE, KEYS] }, CAPTCHA] }
  return {
    schemaVersion: 1,
    surface: 'web',
    target: 'https://example.com/login',
    viewport: { width: 1280, height: 800, scale: 1 },
    root: { ref: 'html', role: 'document', states: [], native: { tag: 'html', attributes: {} }, children: [body] },
    observations: { probes: [record] },
    collectedAt: new Date(0).toISOString(),
    collector: { name: 'rampa-web', version: '0' },
  }
}

/** A model that answers the 3.3.8 question the same way every time, and counts the questions. */
function answering(output: Record<string, unknown>): ModelProvider & { asked: string[] } {
  const asked: string[] = []
  return {
    id: 'stub:auth',
    asked,
    async judge<T>(request: JudgeRequest<T>) {
      asked.push(request.user)
      return { output: request.schema.parse(output), inputTokens: 100, outputTokens: 20, latencyMs: 1, modelId: 'stub' }
    },
  }
}

const check = (snapshot: A11ySnapshot, extra: Parameters<typeof probeCheckOptions>[0] = {}) => checkSnapshot(snapshot, emptyEngine(), probeCheckOptions(extra))

describe('3.3.8 over recorded facts', () => {
  it('fails a password field a trusted paste does not reach while a typed key does, and leaves a field that took the paste', async () => {
    const report = await check(snapshotOf({ steps: [step({ fields: [password({ paste: pasted(false), listeners: ['beforeinput'] })] })] }))
    const findings = byRule(report, RULE)
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({ criterion: '3.3.8', ref: '#pass', source: 'probe', experimental: true, confidence: 'high' })
    expect(findings[0]?.message).toMatch(/^Pasting into this password field does not work: a trusted paste \(Ctrl\+V\)/)
    expect(findings[0]?.evidence).toContain('the key "a" typed arrived; the field listens to beforeinput')
    expect(byRule(await check(snapshotOf({ steps: [step()] })), RULE)).toEqual([])
    // A field that takes no key either is for a person to look at, not a failure.
    expect(reviewByRule(await check(snapshotOf({ steps: [step({ fields: [password({ paste: pasted(false, false) })] })] })), RULE)[0]?.message).toContain('Neither a paste nor a typed key reached this password field')
  })

  it('fails a split code that a paste fills one box of, and a read-only password filled only by a keypad of paired digits', async () => {
    const boxes = Array.from({ length: 6 }, (_, i) => ({ ...el(CODE), ref: i === 0 ? '#d1' : `#d${i + 1}` }))
    const split: AuthField = { el: el(CODE, 'Digit 1'), kind: 'code', type: 'text', autocomplete: 'one-time-code', ignore: [], readonlyAtLoad: false, readonly: false, label: 'Digit 1', group: boxes, paste: { ...pasted(false), value: '731928', reads: ['7', '7'], typed: { key: '7', arrived: true } } }
    const keypad: AuthField = { ...password(), el: el(KEYS, 'Senha'), label: 'Senha', readonlyAtLoad: true, readonly: true, keypad: { buttons: 5, samples: ['1 ou 7', '3 ou 0'], paired: true } }
    const report = await check(snapshotOf({ steps: [step({ fields: [split, keypad] })] }))
    expect(byRule(report, RULE).map((f) => `${f.ref} ${f.message.slice(0, 60)}`)).toEqual([
      '#d1 This code is asked one character per box, and pasting the wh',
      '#bankpass This password field is read-only and filled only through an ',
    ])
    expect(byRule(report, RULE)[0]?.message).toContain('fills 1 of the 6 boxes')
    expect(byRule(report, RULE)[1]?.message).toContain('whose keys each stand for two digits')
  })

  it('fails text that asks some characters of a secret, a calculation or a transcription, quoted', async () => {
    const report = await check(snapshotOf({ steps: [step({ partial: 'Enter the 2nd, 6th and last characters of your password', arithmetic: 'Quanto é 3 + 4?', transcription: { quote: 'Type the characters you see in the image' } })] }))
    const messages = byRule(report, RULE).map((f) => f.message)
    expect(messages).toHaveLength(3)
    expect(messages[0]).toContain('"Enter the 2nd, 6th and last characters of your password"')
    expect(messages[1]).toContain('This step asks a calculation to sign in: "Quanto é 3 + 4?"')
    expect(messages[2]).toContain('("Type the characters you see in the image")')
    expect(byRule(report, RULE).every((f) => f.confidence === 'medium' && f.ref === '#signin')).toBe(true)
  })

  it('sends a failure to review when the page offers another way to sign in', async () => {
    const report = await check(snapshotOf({ steps: [step({ fields: [password({ paste: pasted(false) })] })], alternatives: [{ el: el(CAPTCHA), text: 'Sign in with a passkey', step: 0 }] }))
    expect(byRule(report, RULE)).toEqual([])
    expect(reviewByRule(report, RULE)[0]?.message).toContain('The page offers another way to sign in ("Sign in with a passkey")')
  })

  it('leaves sign-up out, names object-recognition CAPTCHAs as excepted, and reviews one it cannot classify and attributes that keep password managers away', async () => {
    const report = await check(
      snapshotOf({
        steps: [step({ fields: [password({ paste: pasted(true), autocomplete: 'off', ignore: ['data-lpignore="true"'] })] }), step({ kind: 'sign-up', why: 'autocomplete="new-password"', fields: [password({ paste: pasted(false) })] })],
        captchas: [
          { el: el(CAPTCHA), vendor: 'reCAPTCHA', kind: 'object-recognition', why: 'images of objects', step: 0 },
          { el: el(CAPTCHA), vendor: 'Arkose', kind: 'unknown', why: 'puzzles that may ask to turn or match pictures', step: 0 },
        ],
      }),
    )
    expect(byRule(report, RULE)).toEqual([])
    const review = reviewByRule(report, RULE)
    expect(review.map((r) => r.ref)).toEqual(['#pass', '#puzzle'])
    expect(review[0]?.message).toContain('autocomplete="off", data-lpignore="true" may keep password managers from filling this password field')
    expect(review[1]?.message).toContain('A Arkose challenge guards this step')
    const note = report.coverage.probes?.find((c) => c.rule === RULE)?.note
    expect(note).toContain('1 sign-up form(s) left out (account creation is out of scope)')
    expect(note).toContain('1 CAPTCHA(s) that ask to recognize objects (reCAPTCHA), excepted at AA')
  })

  it('says what was found on a page with no sign-in step, and is beyond the target under WCAG 2.1', async () => {
    const none = await check(snapshotOf({ links: [{ text: 'Sign in', href: 'https://example.com/login', kind: 'login' }], end: 'no-steps' }))
    expect(none.coverage.probes?.find((c) => c.rule === RULE)).toMatchObject({ status: 'no-failure-found', applicable: 0, note: expect.stringContaining('links to sign-in or recovery pages, not followed: "Sign in"') })
    const old = await check(snapshotOf({ steps: [step({ fields: [password({ paste: pasted(false) })] })] }), { wcag: '2.1' })
    expect(old.findings.filter((f) => f.ruleId === RULE)).toEqual([])
    expect(old.beyondTarget?.filter((f) => f.ruleId === RULE)).toHaveLength(1)
  })

  it('asks the model only about quoted cognitive tests, and only with judgment on', async () => {
    expect(probeJudgments(snapshotOf({ steps: [step()] }))).toEqual([])
    const partial = snapshotOf({ steps: [step({ partial: 'Enter the 2nd, 6th and last characters of your password' })] })
    expect(probeJudgments(partial)).toEqual([accessibleAuthentication])
    // Another way to sign in sends the step to review: nothing to clear, nothing to ask.
    expect(probeJudgments(snapshotOf({ steps: [step({ partial: 'Enter the 2nd character' })], alternatives: [{ el: el(CAPTCHA), text: 'Email me a link', step: 0 }] }))).toEqual([])
    const off = await check(partial)
    expect(off.criteria.find((c) => c.criterion === '3.3.8')).toMatchObject({ candidates: 1, judged: 0 })
  })

  it('keeps the finding when the model reads a test, with its quote, and clears it when the model reads help text', async () => {
    const snapshot = snapshotOf({ steps: [step({ partial: 'Enter the 2nd, 6th and last characters of your password', texts: ['Sign in, step 2', 'Enter the 2nd, 6th and last characters of your password'] })] })
    const keep = answering({ verdict: 'fail', kind: 'partial-characters', evidence: 'Enter the 2nd, 6th and last characters of your password', confidence: 'high' })
    const kept = await check(snapshot, { llm: true, provider: keep })
    expect(keep.asked[0]).toContain('- (partial-characters) "Enter the 2nd, 6th and last characters of your password"')
    expect(byRule(kept, RULE)[0]?.evidence).toMatch(/; the model reads a cognitive function test \(some characters of a secret\): "Enter the 2nd, 6th and last characters of your password"$/)
    expect(byRule(kept, RULE)[0]).toMatchObject({ model: 'stub:auth', agreement: { votes: 1, total: 1 } })
    const clear = answering({ verdict: 'pass', kind: 'not-a-test', evidence: 'Sign in, step 2', confidence: 'medium' })
    const cleared = await check(snapshot, { llm: true, provider: clear })
    expect(byRule(cleared, RULE)).toEqual([])
    expect(cleared.coverage.probes?.find((c) => c.rule === RULE)?.note).toContain('finding cleared by the model (not a test): "Sign in, step 2"')
    // A pass that quotes text the page does not show is discarded, and the finding stays.
    const invent = answering({ verdict: 'pass', kind: 'not-a-test', evidence: 'This is only an example', confidence: 'high' })
    const kept2 = await check(snapshot, { llm: true, provider: invent })
    expect(kept2.discarded).toEqual([expect.objectContaining({ criterion: '3.3.8', reason: 'evidence is not text the page shows' })])
    expect(byRule(kept2, RULE)).toHaveLength(1)
  })
})

// ---- the probe, on fixtures --------------------------------------------------------------------------------------

// Integration: needs Chrome or Edge. Skipped, with the reason on stderr, when none starts.
const browser = await launchBrowser({ args: DETERMINISM_ARGS }).catch((error: unknown) => {
  process.stderr.write(`\nSkipping the authentication probe tests: no browser started (${error instanceof Error ? error.message.split('\n')[0] : String(error)}).\n`)
  return undefined
})
afterAll(async () => browser?.close(), 60_000)

const collected = new Map<string, Promise<Collected>>()
function probed(name: string): Promise<Collected> {
  if (!browser) throw new Error('no browser')
  let result = collected.get(name)
  if (!result) {
    result = collectWeb(browser, fixture(name), { runAxe: false, locale: 'en', probes: ['auth'] })
    collected.set(name, result)
  }
  return result
}
const dataOf = (snapshot: A11ySnapshot) => snapshot.observations?.probes.find((p) => p.kind === 'auth')?.data as AuthData
const fieldsOf = (data: AuthData) => data.steps.flatMap((s) => s.fields)

describe.skipIf(!browser)('authentication probe (3.3.8)', { timeout: 120_000 }, () => {
  it('pastes into a plain password, a code field that trims the paste, a code split in boxes and a password read-only until focus, and finds nothing', async () => {
    const { snapshot, engine } = await probed('auth-pass.html')
    expect(A11ySnapshotSchema.safeParse(snapshot).success).toBe(true)
    const record = snapshot.observations?.probes.find((p) => p.kind === 'auth')
    expect(record).toMatchObject({ kind: 'auth', version: '1', status: 'complete', conditions: { variant: 'paste' } })
    // Nothing was submitted: no request was blocked and no navigation answered.
    expect(record?.guard).toEqual({ blocked: [], navigations: [], dialogs: [] })
    const data = dataOf(snapshot)
    expect(data.clipboard).toBe('ok')
    expect(data.steps.map((s) => `${s.el.ref} ${s.kind}`)).toEqual(['#signin login', '#otp login', '#split login', '#bank login'])
    const trials = fieldsOf(data).filter((f) => f.paste)
    expect(trials.map((f) => `${f.el.ref} ${f.paste?.arrived} ${f.paste?.restored}`)).toEqual(['#pass true true', '#code true true', '#d1 true true', '#bankpass true true'])
    expect(trials.every((f) => f.paste?.events.some((e) => e.type === 'paste' && e.trusted))).toBe(true)
    expect(data.captchas.map((c) => `${c.vendor} ${c.kind}`)).toEqual(['reCAPTCHA object-recognition'])
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    expect(byRule(report, RULE)).toEqual([])
    expect(reviewByRule(report, RULE)).toEqual([])
    expect(report.coverage.probes?.find((c) => c.rule === RULE)).toMatchObject({ status: 'no-failure-found', applicable: 4 })
  })

  it('fails a beforeinput blocker, onpaste="return false", a split code with no paste handler and a read-only keypad', async () => {
    const { snapshot, engine } = await probed('auth-fail.html')
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    expect(byRule(report, RULE).map((f) => `${f.ref} ${f.message.split(':')[0]}`)).toEqual([
      '#pass1 Pasting into this password field does not work',
      '#code2 Pasting into this code field does not work',
      '#s1 This code is asked one character per box, and pasting the whole code fills 1 of the 6 boxes. People who copy the code must transcribe it one character at a time (WCAG 3.3.8; F109). Let a paste into the first box fill them all, or use a single field.',
      '#bankpass This password field is read-only and filled only through an on-screen keypad whose keys each stand for two digits',
    ])
    const data = dataOf(snapshot)
    const pass1 = fieldsOf(data).find((f) => f.el.ref === '#pass1')
    expect(pass1?.paste?.events.filter((e) => e.type === 'beforeinput').every((e) => e.trusted && e.prevented === true)).toBe(true)
    expect(pass1?.listeners).toContain('beforeinput')
    expect(snapshot.observations?.probes.find((p) => p.kind === 'auth')?.guard.blocked).toEqual([])
  })

  it('fails "Enter the 2nd, 6th and last characters", "Quanto é 3 + 4?" and an image CAPTCHA, quoting each', async () => {
    const { snapshot, engine } = await probed('auth-cognitive.html')
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    expect(byRule(report, RULE).map((f) => `${f.ref} ${f.evidence?.split('quoted from the page: ')[1]}`)).toEqual([
      '#partial "Enter the 2nd, 6th and last characters of your password"',
      '#math "Quanto é 3 + 4?"',
      '#image "Type the characters you see in the image"',
    ])
    expect(dataOf(snapshot).captchas.map((c) => `${c.vendor} ${c.kind}`)).toEqual(['image cognitive-test'])
    expect(probeJudgments(snapshot)).toEqual([accessibleAuthentication])
  })

  it('leaves out sign-up, a newsletter and a closed dialog, reviews a blocked paste next to a passkey and autocomplete="off"', async () => {
    const { snapshot, engine } = await probed('auth-near.html')
    const data = dataOf(snapshot)
    expect(data.steps.map((s) => `${s.el.ref} ${s.kind}`)).toEqual(['#signup sign-up', '#alt login', '#off login', '#recover recovery'])
    expect(data.hidden.map((h) => h.kind)).toEqual(['login'])
    expect(data.alternatives.map((a) => a.text)).toEqual(['Sign in with a passkey'])
    // The sign-up form was never pasted into.
    expect(data.steps[0]?.fields.some((f) => f.paste)).toBe(false)
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    expect(byRule(report, RULE)).toEqual([])
    expect(reviewByRule(report, RULE).map((r) => r.ref)).toEqual(['#p2', '#p3'])
    const note = report.coverage.probes?.find((c) => c.rule === RULE)?.note
    expect(note).toContain('1 sign-in form(s) not showing (a closed menu or dialog), not opened')
  })

  it('follows a page that sends itself on to the sign-in form right after it loads, and pastes there', async () => {
    const { snapshot } = await probed('auth-redirect.html')
    const data = dataOf(snapshot)
    expect(data.landed).toMatch(/auth-fail\.html\?from=challenge$/)
    expect(data.steps.map((s) => s.el.ref)).toEqual(['#blocker', '#nopaste', '#split', '#keypad'])
    expect(fieldsOf(data).find((f) => f.el.ref === '#pass1')?.paste?.arrived).toBe(false)
  })

  it('stays below the default threshold, prints its coverage line and replays offline to the same findings', async () => {
    const { snapshot, engine } = await probed('auth-fail.html')
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions({ minConfidence: 'medium' }))
    expect(byRule(report, RULE)).toEqual([])
    expect(report.belowThreshold.filter((f) => f.ruleId === RULE)).toHaveLength(4)
    expect(renderReport(report, { verbose: true, paint: paint(false) })).toMatch(/3\.3\.8 +probe\/auth@1 \(rampa\/accessible-authentication\) · trusted paste into password and code fields at 1280×800/)
    const live = await checkSnapshot(snapshot, engine, probeCheckOptions())
    const dir = await mkdtemp(join(tmpdir(), 'rampa-auth-'))
    const path = join(dir, 'auth.snapshot.json')
    await writeFile(path, JSON.stringify(snapshot), 'utf8')
    await writeFile(join(dir, 'auth.engine.json'), JSON.stringify(engine), 'utf8')
    const loaded = await loadRecorded(path, 'en')
    const replayed = await checkSnapshot(loaded.snapshot, loaded.engine, probeCheckOptions())
    const key = (r: Report) => r.findings.map((f) => `${f.fingerprint} ${f.evidence}`)
    expect(key(replayed)).toEqual(key(live))
  })
})
