import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { checkSnapshot } from '../src/core/check.ts'
import type { Report } from '../src/core/types.ts'
import { onInput, onInputJudgments } from '../src/criteria/on-input.ts'
import { emptyEngine } from '../src/engine/axe.ts'
import type { JudgeRequest, ModelProvider } from '../src/providers/types.ts'
import type { Watch } from '../src/probes/activate.ts'
import { type InputControl, type InputData, type InputTrial, contextChanges, inputVerdicts, pickChoice } from '../src/probes/input.ts'
import { DETERMINISM_ARGS, parseProbeKinds } from '../src/probes/run.ts'
import { renderReport } from '../src/report/pretty.ts'
import { paint } from '../src/report/color.ts'
import { A11ySnapshotSchema, type A11yNode, type A11ySnapshot, type ProbeRecord } from '../src/snapshot/schema.ts'
import { indexTree } from '../src/snapshot/tree.ts'
import { loadRecorded } from '../src/surfaces/targets.ts'
import { type Collected, collectWeb, launchBrowser } from '../src/surfaces/web.ts'
import { startFixtureServers } from './media-server.ts'
import { byRule, probeCheckOptions, reviewByRule } from './probe-helpers.ts'

const RULE = 'rampa/on-input'

const watch = (extra: Partial<Watch> = {}): Watch => ({ dom: 0, style: 0, samples: [], navigations: [], windows: [], submits: [], dialogs: [], modals: 0, text: { before: 1000, changed: 0 }, storage: 0, blocked: 0, ms: 600, ...extra })
const leave = (url: string): Partial<Watch> => ({ navigations: [{ url, type: 'push', same: false, at: 1 }] })
const field = { ref: '#next', id: { tag: 'input', sig: 'input|next||||' }, tag: 'input', role: 'textbox', label: 'Number' }

describe('changes of context on input', () => {
  it('weighs a navigation, a window, a submission and a modal most, a dialog and focus moved less, and leaves the rest to a person', () => {
    const kinds = (w: Partial<Watch>, phase: 'input' | 'commit' = 'input') => contextChanges(watch(w), phase).map((c) => `${c.kind}:${c.weight}`)
    expect(kinds(leave('https://example.com/br'))).toEqual(['navigation:high'])
    expect(kinds({ windows: ['https://example.com/terms'] })).toEqual(['new-window:high'])
    expect(kinds({ submits: ['https://example.com/results'] })).toEqual(['submission:high'])
    expect(kinds({ modals: 1 })).toEqual(['modal:high'])
    expect(kinds({ dialogs: ['confirm: Sure?'] })).toEqual(['dialog:medium'])
    expect(kinds({ focus: field })).toEqual(['focus:medium'])
    expect(kinds({ focusLost: true })).toEqual(['focus-lost:review'])
    expect(kinds({ url: 'https://example.com/?view=grid' })).toEqual(['route:review'])
    // A fragment, a download and a navigation within the page are not changes of context.
    expect(kinds({ url: 'https://example.com/#part', hashOnly: true })).toEqual([])
    expect(kinds({ navigations: [{ url: 'https://example.com/#x', type: 'push', same: true, at: 1 }] })).toEqual([])
    // A large change of text with mutations is for a person; a small one, or text that changed on its own, is nothing.
    expect(kinds({ dom: 30, text: { before: 1000, changed: 800 } })).toEqual(['content:review'])
    expect(kinds({ dom: 3, text: { before: 1000, changed: 120 } })).toEqual([])
    expect(kinds({ dom: 0, text: { before: 1000, changed: 900 } })).toEqual([])
    // After the field was left, focus is the person's doing.
    expect(kinds({ focus: field }, 'commit')).toEqual([])
  })

  it('chooses another option that is enabled and not destructive', () => {
    const choices = (labels: string[], selected = 0, disabled: number[] = []) => labels.map((label, i) => ({ i, label, selected: i === selected, disabled: disabled.includes(i) }))
    expect(pickChoice({ control: 'select', choices: choices(['Choose', 'Brasil', 'Chile']) })?.label).toBe('Brasil')
    expect(pickChoice({ control: 'select', choices: choices(['Choose', 'Brasil', 'Chile'], 0, [1]) })?.label).toBe('Chile')
    expect(pickChoice({ control: 'select', choices: choices(['Light', 'Dark'], 1) })?.label).toBe('Light')
    expect(pickChoice({ control: 'select', choices: choices(['Choose an action', 'Delete', 'Archive']) })).toBeUndefined()
    expect(pickChoice({ control: 'select', choices: choices(['Only']) })).toBeUndefined()
  })

  it('keeps the activate class out of --probe all', () => {
    expect(parseProbeKinds('all')).not.toContain('input')
    expect(parseProbeKinds('input')).toEqual(['input'])
    expect(parseProbeKinds('interact')).toContain('input')
  })
})

const node = (ref: string, tag: string, attributes: Record<string, string>, role: string, name: string): A11yNode => ({ ref, role, name, states: [], native: { tag, attributes }, children: [] })

const control = (ref: string, tag: string, attributes: Record<string, string>, label: string, trial: InputTrial, extra: Partial<InputControl> = {}): InputControl => ({
  ref,
  id: { tag, sig: [tag, attributes.id ?? '', attributes.role ?? '', attributes.type ?? '', attributes.name ?? '', ''].join('|') },
  tag,
  role: tag === 'select' ? 'combobox' : 'textbox',
  label,
  control: tag === 'select' ? 'select' : 'text',
  ...(attributes.type ? { type: attributes.type } : {}),
  texts: [label],
  trial,
  ...extra,
})

function inputSnapshot(controls: InputControl[], notices: string[] = []): A11ySnapshot {
  const data: InputData = { viewport: { width: 1280, height: 800 }, found: controls.length, controls, tried: controls.length, loads: controls.length + 1, notices, actions: [], end: 'complete' }
  const record: ProbeRecord = {
    kind: 'input',
    version: '1',
    conditions: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, browser: 'chromium 1 (headless)', variant: 'on-input' },
    status: 'complete',
    guard: { blocked: [], navigations: [], dialogs: [] },
    durationMs: 1,
    data,
  }
  const nodes = controls.map((c) => node(c.ref, c.tag, { id: c.ref.slice(1), ...(c.type ? { type: c.type } : {}) }, c.role, c.label))
  return {
    schemaVersion: 1,
    surface: 'web',
    target: 'https://example.com/',
    title: 'Store',
    viewport: { width: 1280, height: 800, scale: 1 },
    root: { ref: 'html', role: 'document', states: [], native: { tag: 'html', attributes: {} }, children: [{ ref: 'html > body', role: 'generic', states: [], native: { tag: 'body', attributes: {} }, children: nodes }] },
    observations: { probes: [record] },
    collectedAt: new Date(0).toISOString(),
    collector: { name: 'rampa-web', version: '0' },
  }
}

const tried = (input: Partial<Watch>, extra: Partial<InputTrial> = {}): InputTrial => ({ action: 'selected "Brasil"', focused: true, changed: true, idle: watch(), input: watch(input), ...extra })

describe('3.2.2 over recorded changes', () => {
  const country = control('#country', 'select', { id: 'country' }, 'Country', tried(leave('https://example.com/br'), { confirm: { changed: true, idle: watch(), input: watch(leave('https://example.com/br')) } }))
  const page = control(
    '#page',
    'input',
    { id: 'page', type: 'number' },
    'Go to page',
    tried({}, { action: 'typed "1"', commit: watch(leave('https://example.com/?page=1')), confirm: { changed: true, idle: watch(), input: watch(), commit: watch(leave('https://example.com/?page=1')) } }),
  )
  const once = control('#once', 'select', { id: 'once' }, 'Size', tried({ windows: ['https://example.com/ad'] }, { confirm: { changed: true, idle: watch(), input: watch() } }))
  const ticking = control('#tick', 'select', { id: 'tick' }, 'Region', tried(leave('https://example.com/home'), { idle: watch(leave('https://example.com/home')) }))
  const view = control('#view', 'select', { id: 'view' }, 'View', tried({ url: 'https://example.com/?view=grid', dom: 20, text: { before: 600, changed: 900 } }))
  const unconfirmed = control('#late', 'select', { id: 'late' }, 'Late', tried({ submits: ['https://example.com/x'] }))
  const quiet = control('#plan', 'select', { id: 'plan' }, 'Plan', tried({ dom: 2, text: { before: 1000, changed: 10 } }))

  it('fails a change of context that repeated on a second load and not in the wait with no input', () => {
    const snapshot = inputSnapshot([country, page, once, ticking, view, unconfirmed, quiet])
    const verdicts = inputVerdicts(snapshot.observations?.probes[0]?.data as InputData, indexTree(snapshot.root))
    expect(verdicts.verdicts.map((v) => `${v.control.ref} ${v.result} ${v.change.kind}/${v.change.phase}${v.why ? ` ${v.why}` : ''}`)).toEqual([
      '#country failure navigation/input',
      '#page failure navigation/commit',
      '#once review new-window/input once',
      '#view review route/input judge',
      '#late review submission/input unconfirmed',
    ])
    expect(verdicts).toMatchObject({ applicable: 7, noisy: 1, unmatched: 0 })
  })

  it('reports failures below the default threshold, high as the value changes and medium when the field is left, and the rest for review', async () => {
    const report = await checkSnapshot(inputSnapshot([country, page, once, view]), emptyEngine(), probeCheckOptions())
    const findings = byRule(report, RULE)
    expect(findings.map((f) => `${f.ref} ${f.confidence}`)).toEqual(['#country high', '#page medium'])
    expect(findings[0]?.message).toMatch(/^Changing <select> "Country" \(selected "Brasil"\) goes to another page \(https:\/\/example\.com\/br\) as soon as its value changes, with no warning Rampa could read before it: a change of context on input \(WCAG 3\.2\.2\)\./)
    expect(findings[1]?.message).toContain('when the field is left after a change')
    expect(findings[0]?.evidence).toContain('again on a second fresh load')
    expect(reviewByRule(report, RULE).map((r) => r.ref)).toEqual(['#once', '#view'])
    const row = report.coverage.probes?.find((c) => c.criterion === '3.2.2')
    expect(row).toMatchObject({ method: 'probe/input@1', rule: RULE, status: 'failures', applicable: 4, failures: 2, review: 2 })
    expect(report.coverage.criteria?.find((c) => c.id === '3.2.2')?.status).toBe('failures')
    const pt = await checkSnapshot(inputSnapshot([country]), emptyEngine(), probeCheckOptions({ locale: 'pt-BR' }))
    expect(byRule(pt, RULE)[0]?.message).toMatch(/^Mudar <select> "Country" \(selected "Brasil"\) vai para outra página/)
    expect(renderReport(report, { verbose: true, paint: paint(false) })).toMatch(/3\.2\.2 +probe\/input@1 \(rampa\/on-input\) · each form control changed once on a fresh load at 1280×800/)
  })

  it('finds nothing to report on controls that only change content', async () => {
    const report = await checkSnapshot(inputSnapshot([quiet]), emptyEngine(), probeCheckOptions())
    expect(byRule(report, RULE)).toEqual([])
    expect(report.coverage.probes?.find((c) => c.criterion === '3.2.2')).toMatchObject({ status: 'no-failure-found', applicable: 1 })
  })
})

/** A model that answers the 3.2.2 question per control, and keeps the prompts. */
function warning(answers: Record<string, Record<string, unknown>>): ModelProvider & { asked: string[] } {
  const asked: string[] = []
  return {
    id: 'stub:on-input',
    asked,
    async judge<T>(request: JudgeRequest<T>) {
      asked.push(request.user)
      const name = /Control: (.*)/.exec(request.user)?.[1] ?? ''
      const output = Object.entries(answers).find(([key]) => name.includes(key))?.[1] ?? { verdict: 'fail', evidence: '', confidence: 'high' }
      return { output: request.schema.parse(output), inputTokens: 100, outputTokens: 20, latencyMs: 1, modelId: 'stub' }
    },
  }
}

describe('3.2.2 advance warning: the model may only clear', () => {
  const warned = control('#country', 'select', { id: 'country' }, 'Country', tried(leave('https://example.com/br'), { confirm: { changed: true, idle: watch(), input: watch(leave('https://example.com/br')) } }), {
    texts: ['Country', 'Selecting a country reloads the page with prices in its currency.'],
  })
  const silent = control('#currency', 'select', { id: 'currency' }, 'Currency', tried(leave('https://example.com/brl'), { confirm: { changed: true, idle: watch(), input: watch(leave('https://example.com/brl')) } }))

  it('is asked only for failures, and only with judgment on', async () => {
    const snapshot = inputSnapshot([warned, silent])
    expect(onInputJudgments(snapshot)).toEqual([onInput])
    expect(onInputJudgments(inputSnapshot([]))).toEqual([])
    const off = await checkSnapshot(snapshot, emptyEngine(), probeCheckOptions())
    expect(byRule(off, RULE)).toHaveLength(2)
    expect(off.criteria.find((c) => c.criterion === '3.2.2')).toMatchObject({ candidates: 2, judged: 0 })
  })

  it('clears a failure when it quotes a warning before the control, and keeps one with none', async () => {
    const model = warning({
      Country: { verdict: 'pass', evidence: 'Selecting a country reloads the page with prices in its currency.', confidence: 'high' },
      Currency: { verdict: 'fail', evidence: '', confidence: 'high' },
    })
    const report = await checkSnapshot(inputSnapshot([warned, silent], ['Prices are shown in your currency.']), emptyEngine(), probeCheckOptions({ llm: true, provider: model }))
    expect(model.asked).toHaveLength(2)
    expect(model.asked.find((p) => p.includes('"Country"'))).toContain('- "Selecting a country reloads the page with prices in its currency."')
    expect(model.asked.find((p) => p.includes('"Currency"'))).toContain('Sentences elsewhere on the page that speak of such changes:\n- "Prices are shown in your currency."')
    const findings = byRule(report, RULE)
    expect(findings.map((f) => f.ref)).toEqual(['#currency'])
    expect(findings[0]).toMatchObject({ model: 'stub:on-input' })
    expect(findings[0]?.evidence).toMatch(/the model found no text that warns of the change$/)
    expect(report.coverage.probes?.find((c) => c.criterion === '3.2.2')?.note).toContain('finding cleared by the model, which reads a warning before the control: "Selecting a country reloads the page with prices in its currency."')
  })

  it('discards a pass that quotes no text the page shows, or only a label', async () => {
    const invented = await checkSnapshot(
      inputSnapshot([warned]),
      emptyEngine(),
      probeCheckOptions({ llm: true, provider: warning({ Country: { verdict: 'pass', evidence: 'Changing this reloads the page', confidence: 'high' } }) }),
    )
    expect(invented.discarded).toEqual([expect.objectContaining({ criterion: '3.2.2', reason: 'evidence is not text the page shows' })])
    expect(byRule(invented, RULE)).toHaveLength(1)
    const label = await checkSnapshot(inputSnapshot([warned]), emptyEngine(), probeCheckOptions({ llm: true, provider: warning({ Country: { verdict: 'pass', evidence: 'Country', confidence: 'high' } }) }))
    expect(label.discarded).toEqual([expect.objectContaining({ reason: 'a pass must quote the text that warns' })])
  })
})

// Integration: needs Chrome or Edge, and the fixtures over HTTP. Skipped, with the reason on stderr, when no browser starts.
const browser = await launchBrowser({ args: DETERMINISM_ARGS }).catch((error: unknown) => {
  process.stderr.write(`\nSkipping the on-input probe tests: no browser started (${error instanceof Error ? error.message.split('\n')[0] : String(error)}).\n`)
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
    result = collectWeb(browser, `${servers.origin}/${name}`, { runAxe: false, locale: 'en', probes: ['input'] })
    collected.set(name, result)
  }
  return result
}

const recordOf = (snapshot: A11ySnapshot) => snapshot.observations?.probes.find((p) => p.kind === 'input')
const dataOf = (snapshot: A11ySnapshot) => recordOf(snapshot)?.data as InputData

describe.skipIf(!browser)('on-input probe (3.2.2)', { timeout: 400_000 }, () => {
  it('changes each control on a fresh load and fails the changes of context, confirmed on a second load', async () => {
    const { snapshot, engine } = await probed('input-fail.html')
    expect(A11ySnapshotSchema.safeParse(snapshot).success).toBe(true)
    expect(recordOf(snapshot)).toMatchObject({ kind: 'input', version: '1', status: 'complete', conditions: { variant: 'on-input' } })
    const data = dataOf(snapshot)
    expect(data.controls.map((c) => `${c.ref} ${c.trial?.action}`)).toEqual([
      '#country selected "Brasil"',
      '#terms pressed Space',
      '#sort-form > fieldset > label:nth-of-type(1) > input checked "Name" with Space',
      '#area typed "1"',
      '#number typed "1"',
      '#lang selected "Português"',
      '#page typed "1"',
      '#view selected "Grid"',
    ])
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    expect(byRule(report, RULE).map((f) => `${f.ref} ${f.confidence}`)).toEqual([
      '#country high',
      '#terms high',
      '#sort-form > fieldset > label:nth-of-type(1) > input high',
      '#area medium',
      '#lang high',
      '#page medium',
    ])
    expect(byRule(report, RULE).find((f) => f.ref === '#area')?.message).toContain('moves focus to <input> "Number"')
    expect(reviewByRule(report, RULE).map((r) => r.ref)).toEqual(['#view'])
    // Nothing was submitted and no page was left: the server saw the page's own loads, nothing else.
    expect((servers?.requests ?? []).filter((r) => r.includes('/input/'))).toEqual([])
    const origin = servers?.origin ?? ''
    expect([...new Set(recordOf(snapshot)?.guard.navigations.map((n) => `${n.cause} ${n.url}`))]).toEqual([`intercepted ${origin}/input/br.html`, `intercepted ${origin}/input/results.html?page=1`])
    expect(data.actions.filter((a) => a.action === 'submit').map((a) => a.detail)).toEqual([`cancelled: ${origin}/input/results.html`, `cancelled: ${origin}/input/results.html`])
    // The clock that ticks on its own is never credited to an input.
    expect(inputVerdicts(data, indexTree(snapshot.root)).noisy).toBe(0)
  })

  it('finds no change of context where a change only shows or updates content', async () => {
    const { snapshot, engine } = await probed('input-pass.html')
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    expect(byRule(report, RULE)).toEqual([])
    expect(reviewByRule(report, RULE)).toEqual([])
    expect(report.coverage.probes?.find((c) => c.criterion === '3.2.2')).toMatchObject({ status: 'no-failure-found', applicable: 9 })
    // Selects, a checkbox and text fields take the change the same way in every Chromium; a date field's arrow key may not.
    const changed = dataOf(snapshot).controls.filter((c) => c.trial?.changed === true).map((c) => c.ref)
    expect(changed).toEqual(expect.arrayContaining(['#contact', '#same', '#street', '#city', '#plan', '#jump', '#notes']))
  })

  it('never changes a control the skip list names, and its log matches what reached the server', async () => {
    const { snapshot } = await probed('input-destructive.html')
    const data = dataOf(snapshot)
    expect(data.controls.map((c) => `${c.ref} ${c.skip ? `skip ${c.skip.reason}` : (c.trial?.action ?? '')}`)).toEqual([
      '#delete skip destructive',
      '#unsub skip destructive',
      '#excluir skip destructive',
      '#bulk skip destructive',
      '#user skip sensitive-form',
      '#pw skip secret',
      '#remember skip sensitive-form',
      '#avatar skip secret',
      '#theme selected "Dark"',
    ])
    const origin = servers?.origin ?? ''
    expect(recordOf(snapshot)?.guard.blocked.map((b) => `${b.method} ${b.url}`)).toEqual([`POST ${origin}/touched?theme`])
    expect(recordOf(snapshot)?.guard.navigations).toEqual([])
    expect(data.actions.filter((a) => a.action === 'activate').map((a) => a.ref)).toEqual(['#theme'])
    expect((servers?.requests ?? []).filter((r) => r.includes('/touched'))).toEqual([])
  })

  it('gives the judgment the warning before a control, which may clear it', async () => {
    const { snapshot, engine } = await probed('input-notice.html')
    const off = await checkSnapshot(snapshot, engine, probeCheckOptions())
    expect(byRule(off, RULE).map((f) => f.ref)).toEqual(['#country', '#terms', '#currency'])
    const model = warning({
      Country: { verdict: 'pass', evidence: 'Selecting a country reloads the page with prices in its currency.', confidence: 'high' },
      terms: { verdict: 'pass', evidence: 'Show the terms (opens in a new window)', confidence: 'high' },
    })
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions({ llm: true, provider: model }))
    expect(model.asked).toHaveLength(3)
    expect(byRule(report, RULE).map((f) => f.ref)).toEqual(['#currency'])
    expect(model.asked.find((p) => p.includes('"Currency"'))).not.toContain('- "Selecting a country reloads the page with prices in its currency."\nSentences')
  })

  it('replays a saved snapshot offline to the same findings', async () => {
    const { snapshot, engine } = await probed('input-fail.html')
    const live = await checkSnapshot(snapshot, engine, probeCheckOptions())
    const dir = await mkdtemp(join(tmpdir(), 'rampa-input-'))
    const path = join(dir, 'input.snapshot.json')
    await writeFile(path, JSON.stringify(snapshot), 'utf8')
    await writeFile(join(dir, 'input.engine.json'), JSON.stringify(engine), 'utf8')
    const loaded = await loadRecorded(path, 'en')
    const replayed = await checkSnapshot(loaded.snapshot, loaded.engine, probeCheckOptions())
    const key = (report: Report) => report.findings.map((f) => `${f.fingerprint} ${f.evidence}`)
    expect(key(replayed)).toEqual(key(live))
    expect(replayed.coverage.probes).toEqual(live.coverage.probes)
  })
})
