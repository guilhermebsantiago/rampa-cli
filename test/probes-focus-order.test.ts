import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { checkSnapshot } from '../src/core/check.ts'
import type { Report } from '../src/core/types.ts'
import { focusOrder, focusOrderJudgments } from '../src/criteria/focus-order.ts'
import { emptyEngine } from '../src/engine/axe.ts'
import { type FocusOrderData, type PopupTrial, type PopupTrigger, type SeqStop, type Sequence, goesBack, orderCandidates, trialProblems } from '../src/probes/focus-order.ts'
import { DETERMINISM_ARGS, parseProbeKinds } from '../src/probes/run.ts'
import type { JudgeRequest, ModelProvider } from '../src/providers/types.ts'
import { paint } from '../src/report/color.ts'
import { renderReport } from '../src/report/pretty.ts'
import { A11ySnapshotSchema, type A11yNode, type A11ySnapshot, type ProbeRecord } from '../src/snapshot/schema.ts'
import { loadRecorded } from '../src/surfaces/targets.ts'
import { type Collected, collectWeb, launchBrowser } from '../src/surfaces/web.ts'
import { startFixtureServers } from './media-server.ts'
import { byRule, probeCheckOptions, reviewByRule } from './probe-helpers.ts'

const RULE = 'rampa/focus-management'

const rect = (x: number, y: number, width = 100, height = 20) => ({ x, y, width, height })

describe('the order of the Tab sequence, as candidates', () => {
  it('goes back when the next stop is above and not in a column to the right, or before it on its row', () => {
    expect(goesBack(rect(0, 100), rect(0, 20))).toBe(true)
    expect(goesBack(rect(0, 100), rect(300, 20))).toBe(false)
    expect(goesBack(rect(200, 20), rect(0, 20))).toBe(true)
    expect(goesBack(rect(0, 20), rect(200, 20))).toBe(false)
    expect(goesBack(rect(200, 20), rect(0, 60))).toBe(false)
    // Right to left, the row reads the other way.
    expect(goesBack(rect(0, 20), rect(200, 20), true)).toBe(true)
  })

  const stop = (n: number, x: number, y: number, groups: string[], extra: Partial<SeqStop> = {}): SeqStop => ({ n, ref: `#s${n}`, id: { tag: 'input', sig: `input|s${n}||||` }, tag: 'input', role: 'textbox', label: `Field ${n}`, rect: rect(x, y), groups, ...extra })
  const groups = [
    { key: '#main', id: { tag: 'main', sig: 'main|main||||' }, tag: 'main', role: 'main', name: '' },
    { key: '#ship', id: { tag: 'form', sig: 'form|ship||||' }, tag: 'form', role: 'form', name: 'Shipping address' },
    { key: '#foot', id: { tag: 'nav', sig: 'nav|foot||||' }, tag: 'nav', role: 'navigation', name: 'Footer' },
  ]

  it('nominates a form Tab visits going back up twice, and not its landmark, which says the same', () => {
    const sequence: Sequence = { stops: [stop(1, 0, 300, ['#main', '#ship']), stop(2, 0, 100, ['#main', '#ship']), stop(3, 0, 400, ['#main', '#ship']), stop(4, 0, 200, ['#main', '#ship'])], groups, end: 'cycled', rtl: false }
    expect(orderCandidates(sequence)).toEqual([expect.objectContaining({ kind: 'interleave', group: groups[1], suspects: [[1, 2], [3, 4]] })])
  })

  it('leaves columns read down before across alone, and nominates a positive tabindex', () => {
    const columns: Sequence = {
      stops: [stop(1, 0, 0, ['#foot']), stop(2, 0, 30, ['#foot']), stop(3, 0, 60, ['#foot']), stop(4, 200, 0, ['#foot']), stop(5, 200, 30, ['#foot']), stop(6, 200, 60, ['#foot'])],
      groups,
      end: 'cycled',
      rtl: false,
    }
    expect(orderCandidates(columns)).toEqual([])
    const positive: Sequence = { ...columns, stops: [stop(1, 0, 900, [], { tabindex: 3 }), ...columns.stops.slice(1).map((s) => ({ ...s }))] }
    expect(orderCandidates(positive)).toEqual([expect.objectContaining({ kind: 'tabindex', suspects: [[1, 2]] })])
  })

  it('reads the problems of one trial', () => {
    const container = { ref: '#d', id: { tag: 'div', sig: 'div|d|dialog|||' }, tag: 'div', role: 'dialog', label: 'Help', name: 'Help', modal: true, focusables: 2 }
    const base: PopupTrial = { openedWith: 'Enter', container, onOpen: { where: 'inside' }, close: { with: 'Escape', closed: true }, onClose: { where: 'trigger', triggerShown: true } }
    expect(trialProblems(base)).toEqual([])
    expect(trialProblems({ ...base, onOpen: { where: 'trigger' }, enter: { tabs: null, cap: 40, via: [] } })).toEqual(['never-takes'])
    expect(trialProblems({ ...base, onOpen: { where: 'trigger' }, enter: { tabs: 1, cap: 40, via: [] } })).toEqual([])
    expect(trialProblems({ ...base, onOpen: { where: 'trigger' }, enter: { tabs: 9, cap: 40, via: [] } })).toEqual(['not-adjacent'])
    expect(trialProblems({ ...base, hold: { tabs: 4, escaped: { where: 'elsewhere' } } })).toEqual(['does-not-hold'])
    expect(trialProblems({ ...base, onClose: { where: 'body', triggerShown: true } })).toEqual(['lost'])
    expect(trialProblems({ ...base, onClose: { where: 'elsewhere', distance: 9, triggerShown: true } })).toEqual(['far'])
    expect(trialProblems({ ...base, onClose: { where: 'elsewhere', distance: 2, triggerShown: true } })).toEqual([])
    expect(trialProblems({ ...base, onClose: { where: 'elsewhere', distance: 9, triggerShown: false } })).toEqual(['trigger-gone'])
  })

  it('keeps the activate class out of --probe all', () => {
    expect(parseProbeKinds('all')).not.toContain('focus-order')
    expect(parseProbeKinds('focus-order')).toEqual(['focus-order'])
    expect(parseProbeKinds('interact')).toContain('focus-order')
  })
})

const node = (ref: string, tag: string, attributes: Record<string, string>, role: string, name: string): A11yNode => ({ ref, role, name, states: [], native: { tag, attributes }, children: [] })

function focusSnapshot(triggers: PopupTrigger[], sequence?: Sequence, extraNodes: A11yNode[] = []): A11ySnapshot {
  const data: FocusOrderData = { viewport: { width: 1280, height: 800 }, found: triggers.length, triggers, tried: triggers.length, unclaimed: 0, ...(sequence ? { sequence } : {}), loads: 3, actions: [], end: 'complete' }
  const record: ProbeRecord = {
    kind: 'focus-order',
    version: '1',
    conditions: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, browser: 'chromium 1 (headless)', variant: 'focus-management' },
    status: 'complete',
    guard: { blocked: [], navigations: [], dialogs: [] },
    durationMs: 1,
    data,
  }
  const nodes = triggers.map((t) => node(t.ref, 'button', { id: t.ref.slice(1), type: 'button' }, 'button', t.label))
  return {
    schemaVersion: 1,
    surface: 'web',
    target: 'https://example.com/',
    title: 'Account',
    viewport: { width: 1280, height: 800, scale: 1 },
    root: { ref: 'html', role: 'document', states: [], native: { tag: 'html', attributes: {} }, children: [{ ref: 'html > body', role: 'generic', states: [], native: { tag: 'body', attributes: {} }, children: [...nodes, ...extraNodes] }] },
    observations: { probes: [record] },
    collectedAt: new Date(0).toISOString(),
    collector: { name: 'rampa-web', version: '0' },
  }
}

const dialog = { ref: '#d', id: { tag: 'div', sig: 'div|d|dialog|||' }, tag: 'div', role: 'dialog', label: 'Help', name: 'Help', modal: true, focusables: 2 }
const trigger = (ref: string, label: string, trial: PopupTrial): PopupTrigger => ({ ref, id: { tag: 'button', sig: `button|${ref.slice(1)}||button||` }, tag: 'button', role: 'button', label, popup: 'dialog', how: 'aria-controls', trial })
const ok: PopupTrial = { openedWith: 'Enter', container: dialog, onOpen: { where: 'inside' }, close: { with: 'Escape', closed: true }, onClose: { where: 'trigger', triggerShown: true } }

describe('2.4.3 over recorded dialogs and menus', () => {
  const never = trigger('#terms', 'Read the terms', { ...ok, onOpen: { where: 'trigger' }, enter: { tabs: null, cap: 40, via: [], left: true }, confirm: { ...ok, onOpen: { where: 'trigger' }, enter: { tabs: null, cap: 40, via: [], left: true } } })
  const lost = trigger('#help', 'Help', { ...ok, onClose: { where: 'body', triggerShown: true }, confirm: { ...ok, onClose: { where: 'body', triggerShown: true } } })
  const once = trigger('#once', 'Once', { ...ok, onClose: { where: 'body', triggerShown: true }, confirm: ok })
  const far = trigger('#prefs', 'Preferences', { ...ok, onClose: { where: 'elsewhere', el: { ref: '#skip', id: { tag: 'a', sig: 'a|skip||||#main' }, tag: 'a', role: 'link', label: 'Skip to content' }, distance: 9, triggerShown: true } })
  const fine = trigger('#fine', 'Fine', ok)
  const closed = trigger('#none', 'Nothing', { outcome: 'not-opened' })

  it('fails focus that never gets in or is lost, twice, and focus sent far; once is for review', async () => {
    const report = await checkSnapshot(focusSnapshot([never, lost, once, far, fine, closed]), emptyEngine(), probeCheckOptions())
    expect(byRule(report, RULE).map((f) => `${f.ref} ${f.confidence}`)).toEqual(['#terms high', '#help high', '#prefs medium'])
    const [first, second, third] = byRule(report, RULE)
    expect(first?.message).toMatch(/^Opening this modal dialog with Enter leaves keyboard focus outside it, and Tab from there does not get into it within 40 presses/)
    expect(first?.evidence).toContain('Tab ×until focus left the page did not get in')
    expect(first?.evidence).toContain('the same on a second fresh load')
    expect(second?.message).toMatch(/^Closing this modal dialog with Esc leaves keyboard focus on the document instead of the control that opened it/)
    expect(third?.message).toContain('sends keyboard focus to <a> "Skip to content", 9 Tab stops away from the control that opened it (WCAG 2.4.3; F85)')
    expect(reviewByRule(report, RULE).map((r) => r.ref)).toEqual(['#once'])
    const row = report.coverage.probes?.find((c) => c.rule === RULE)
    expect(row).toMatchObject({ criterion: '2.4.3', method: 'probe/focus-order@1', status: 'failures', applicable: 5, failures: 3, review: 1 })
    expect(row?.note).toContain('1 opened nothing')
    const pt = await checkSnapshot(focusSnapshot([lost]), emptyEngine(), probeCheckOptions({ locale: 'pt-BR' }))
    expect(byRule(pt, RULE)[0]?.message).toMatch(/^Fechar este diálogo modal com Esc deixa o foco do teclado no documento/)
    expect(renderReport(report, { verbose: true, paint: paint(false) })).toMatch(/2\.4\.3 +probe\/focus-order@1 \(rampa\/focus-management\) · dialogs and menus opened from the keyboard/)
  })
})

/** A model that fails or passes every order, citing the transitions it is told to, and keeps the prompts. */
function judge(answer: 'fail' | 'pass', cite: (prompt: string) => Array<{ from: number; to: number }> = suspects): ModelProvider & { asked: string[] } {
  const asked: string[] = []
  return {
    id: 'stub:order',
    asked,
    async judge<T>(request: JudgeRequest<T>) {
      asked.push(request.user)
      const output = answer === 'fail' ? { verdict: 'fail', transitions: cite(request.user), evidence: 'The order breaks the form.', confidence: 'high' } : { verdict: 'pass', transitions: [], evidence: 'The order is fine.', confidence: 'high' }
      return { output: request.schema.parse(output), inputTokens: 100, outputTokens: 20, latencyMs: 1, modelId: 'stub' }
    },
  }
}

function suspects(prompt: string): Array<{ from: number; to: number }> {
  const line = /Suspect transitions: (.*)/.exec(prompt)?.[1] ?? ''
  return [...line.matchAll(/(\d+) → (\d+)/g)].map((m) => ({ from: Number(m[1]), to: Number(m[2]) }))
}

describe('2.4.3 order: the model decides, a verifier recomputes the transitions it cites', () => {
  const stop = (n: number, y: number, extra: Partial<SeqStop> = {}): SeqStop => ({ n, ref: `#f${n}`, id: { tag: 'input', sig: `input|f${n}||||` }, tag: 'input', role: 'textbox', label: `Field ${n}`, rect: rect(0, y), groups: ['#ship'], ...extra })
  const sequence: Sequence = {
    stops: [stop(1, 300), stop(2, 100), stop(3, 400), stop(4, 200)],
    groups: [{ key: '#ship', id: { tag: 'form', sig: 'form|ship||||' }, tag: 'form', role: 'form', name: 'Shipping address' }],
    end: 'cycled',
    rtl: false,
  }
  const form = node('#ship', 'form', { id: 'ship' }, 'form', 'Shipping address')

  it('is asked only when the sequence holds a candidate', async () => {
    expect(focusOrderJudgments(focusSnapshot([], sequence, [form]))).toEqual([focusOrder])
    expect(focusOrderJudgments(focusSnapshot([], { ...sequence, stops: sequence.stops.map((s, i) => ({ ...s, rect: rect(0, i * 40) })) }, [form]))).toEqual([])
  })

  it('reports a verified fail below the threshold, on the group, with the transitions as the stops have them', async () => {
    const model = judge('fail')
    const report = await checkSnapshot(focusSnapshot([], sequence, [form]), emptyEngine(), probeCheckOptions({ llm: true, provider: model }))
    expect(model.asked[0]).toContain('The stops of <form role=form> "Shipping address", in Tab order:\n1. <input> "Field 1" at x 0, y 300')
    expect(model.asked[0]).toContain('Suspect transitions: 1 → 2, 3 → 4')
    const findings = report.findings.filter((f) => f.criterion === '2.4.3')
    expect(findings).toEqual([expect.objectContaining({ source: 'judgment', ref: '#ship', confidence: 'low' })])
    expect(findings[0]?.evidence).toBe('Tab 1 → 2: <input> "Field 1" (x 0, y 300) → <input> "Field 2" (x 0, y 100); Tab 3 → 4: <input> "Field 3" (x 0, y 400) → <input> "Field 4" (x 0, y 200)')
    expect(findings[0]?.message).toMatch(/^In <form role=form> "Shipping address", Tab goes back up or left between controls/)
    const passed = await checkSnapshot(focusSnapshot([], sequence, [form]), emptyEngine(), probeCheckOptions({ llm: true, provider: judge('pass') }))
    expect(passed.findings.filter((f) => f.criterion === '2.4.3')).toEqual([])
  })

  it('discards a fail that cites a transition the stops do not show going back', async () => {
    const report = await checkSnapshot(focusSnapshot([], sequence, [form]), emptyEngine(), probeCheckOptions({ llm: true, provider: judge('fail', () => [{ from: 2, to: 3 }]) }))
    expect(report.discarded).toEqual([expect.objectContaining({ criterion: '2.4.3', reason: 'a cited transition is not one the recorded stops show going back or reordered' })])
    expect(report.findings.filter((f) => f.criterion === '2.4.3')).toEqual([])
  })
})

// Integration: needs Chrome or Edge, and the fixtures over HTTP. Skipped, with the reason on stderr, when no browser starts.
const browser = await launchBrowser({ args: DETERMINISM_ARGS }).catch((error: unknown) => {
  process.stderr.write(`\nSkipping the focus-order probe tests: no browser started (${error instanceof Error ? error.message.split('\n')[0] : String(error)}).\n`)
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
    result = collectWeb(browser, `${servers.origin}/${name}`, { runAxe: false, locale: 'en', probes: ['focus-order'] })
    collected.set(name, result)
  }
  return result
}

const recordOf = (snapshot: A11ySnapshot) => snapshot.observations?.probes.find((p) => p.kind === 'focus-order')
const dataOf = (snapshot: A11ySnapshot) => recordOf(snapshot)?.data as FocusOrderData
const opened = (snapshot: A11ySnapshot) =>
  dataOf(snapshot).triggers.map((t) => `${t.ref} ${t.skip ? `skip ${t.skip.reason}` : (t.trial?.outcome ?? `${t.trial?.openedWith} ${t.trial?.onOpen?.where}${t.trial?.enter ? ` tab×${t.trial.enter.tabs}` : ''} ${t.trial?.close?.closed ? `closed→${t.trial.onClose?.where}` : 'stays'}`)}`)

describe.skipIf(!browser)('focus-order probe (2.4.3)', { timeout: 400_000 }, () => {
  it('fails a modal focus never gets into, one that lets focus out or loses it, a menu far from its button, and focus sent far', async () => {
    const { snapshot, engine } = await probed('focus-order-fail.html')
    expect(A11ySnapshotSchema.safeParse(snapshot).success).toBe(true)
    expect(recordOf(snapshot)).toMatchObject({ kind: 'focus-order', version: '1', status: 'complete', conditions: { variant: 'focus-management' } })
    expect(opened(snapshot)).toEqual([
      '#open-terms Enter trigger tab×null closed→trigger',
      '#open-help Enter inside closed→body',
      '#open-menu Enter trigger tab×10 closed→trigger',
      '#open-prefs Enter inside closed→elsewhere',
    ])
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    expect(byRule(report, RULE).map((f) => `${f.ref} ${f.confidence}`)).toEqual(['#open-terms high', '#open-help high', '#open-help high', '#open-menu medium', '#open-prefs medium'])
    expect(byRule(report, RULE).map((f) => f.message.split(':')[0])).toEqual([
      'Opening this modal dialog with Enter leaves keyboard focus outside it, and Tab from there does not get into it within 40 presses',
      'While this modal dialog is open, Tab moves keyboard focus out of it to the page behind (<a> "Orders"), which a modal dialog covers (WCAG 2.4.3). Keep focus inside while it is open',
      'Closing this modal dialog with Esc leaves keyboard focus on the document instead of the control that opened it',
      'Opening this menu with Enter leaves keyboard focus outside it, and it takes 10 Tab presses to get into it',
      'Closing this modal dialog with Esc sends keyboard focus to <a> "Skip to content", 9 Tab stops away from the control that opened it (WCAG 2.4.3; F85). Return focus to that control, or to the next step of the task.',
    ])
    // The order: the search field's positive tabindex, and the form Tab visits going back up.
    const sequence = dataOf(snapshot).sequence
    expect(sequence?.stops[0]?.ref).toBe('#search')
    expect(orderCandidates(sequence).map((c) => `${c.kind} ${c.group?.key ?? ''}`)).toEqual(['tabindex ', 'interleave #shipping'])
    const model = judge('fail')
    const judged = await checkSnapshot(snapshot, engine, probeCheckOptions({ llm: true, provider: model }))
    expect(model.asked).toHaveLength(2)
    expect(judged.findings.filter((f) => f.criterion === '2.4.3' && f.source === 'judgment').map((f) => f.ref)).toEqual(['#search', '#shipping'])
    // Nothing left the page: every link inside the dialogs and menus stayed unpressed.
    expect((servers?.requests ?? []).filter((r) => r.includes('/focus-order/'))).toEqual([])
  })

  it('finds nothing where focus moves in, stays in, and comes back', async () => {
    const { snapshot, engine } = await probed('focus-order-pass.html')
    expect(opened(snapshot)).toEqual([
      '#open-native Enter inside closed→trigger',
      '#open-custom Enter inside closed→trigger',
      '#open-menu Enter inside closed→trigger',
      '#toggle-more Enter trigger tab×1 stays',
    ])
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    expect(byRule(report, RULE)).toEqual([])
    expect(reviewByRule(report, RULE)).toEqual([])
    expect(report.coverage.probes?.find((c) => c.rule === RULE)).toMatchObject({ status: 'no-failure-found', applicable: 4 })
    expect(orderCandidates(dataOf(snapshot).sequence)).toEqual([])
    expect(focusOrderJudgments(snapshot)).toEqual([])
  })

  it('leaves the near misses alone: a dialog next to its button, columns, a guessed trigger; a removed trigger is for review', async () => {
    const { snapshot, engine } = await probed('focus-order-near.html')
    expect(opened(snapshot)).toEqual([
      '#open-tip Enter trigger tab×1 stays',
      '#open-coupon Enter inside closed→elsewhere',
      '#open-delete skip destructive',
      '#open-settings Enter inside closed→trigger',
    ])
    expect(dataOf(snapshot).triggers.find((t) => t.ref === '#open-settings')?.how).toBe('guess')
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions({ llm: true, provider: judge('pass') }))
    expect(byRule(report, RULE)).toEqual([])
    expect(reviewByRule(report, RULE).map((r) => r.ref)).toEqual(['#open-coupon'])
    expect(report.findings.filter((f) => f.criterion === '2.4.3')).toEqual([])
    expect(orderCandidates(dataOf(snapshot).sequence).map((c) => c.kind)).toEqual(['tabindex'])
  })

  it('replays a saved snapshot offline to the same findings', async () => {
    const { snapshot, engine } = await probed('focus-order-fail.html')
    const live = await checkSnapshot(snapshot, engine, probeCheckOptions())
    const dir = await mkdtemp(join(tmpdir(), 'rampa-focus-order-'))
    const path = join(dir, 'focus.snapshot.json')
    await writeFile(path, JSON.stringify(snapshot), 'utf8')
    await writeFile(join(dir, 'focus.engine.json'), JSON.stringify(engine), 'utf8')
    const loaded = await loadRecorded(path, 'en')
    const replayed = await checkSnapshot(loaded.snapshot, loaded.engine, probeCheckOptions())
    const key = (report: Report) => report.findings.map((f) => `${f.fingerprint} ${f.evidence}`)
    expect(key(replayed)).toEqual(key(live))
    expect(replayed.coverage.probes).toEqual(live.coverage.probes)
  })
})
