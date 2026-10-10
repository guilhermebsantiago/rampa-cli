import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { checkSnapshot } from '../src/core/check.ts'
import type { Report } from '../src/core/types.ts'
import { characterKeyShortcuts, probeJudgments } from '../src/criteria/character-key-shortcuts.ts'
import { emptyEngine } from '../src/engine/axe.ts'
import type { JudgeRequest, ModelProvider } from '../src/providers/types.ts'
import { DETERMINISM_ARGS } from '../src/probes/run.ts'
import { type KeyChange, PRINTABLE_KEYS, type ShortcutsData } from '../src/probes/shortcuts.ts'
import { renderReport } from '../src/report/pretty.ts'
import { paint } from '../src/report/color.ts'
import { changed, shortcutVerdicts } from '../src/rules/shortcuts.ts'
import { A11ySnapshotSchema, type A11ySnapshot, type ProbeRecord } from '../src/snapshot/schema.ts'
import { loadRecorded } from '../src/surfaces/targets.ts'
import { type Collected, collectWeb, launchBrowser } from '../src/surfaces/web.ts'
import { byRule, fixture, probeCheckOptions } from './probe-helpers.ts'

const RULE = 'rampa/character-key-shortcuts'

/** A model that answers the 2.1.4 question the same way every time, and counts the questions. */
function answering(output: Record<string, unknown>): ModelProvider & { asked: string[] } {
  const asked: string[] = []
  return {
    id: 'stub:shortcuts',
    asked,
    async judge<T>(request: JudgeRequest<T>) {
      asked.push(request.user)
      return { output: request.schema.parse(output), inputTokens: 100, outputTokens: 20, latencyMs: 1, modelId: 'stub' }
    },
  }
}

const none = (extra: Partial<KeyChange> = {}): KeyChange => ({ dom: 0, style: 0, pixels: 0, events: [], samples: [], ...extra })
const added = (label: string): KeyChange => none({ dom: 1, pixels: 120, samples: [{ ref: '#list > li', id: { tag: 'li', sig: 'li|||||' }, tag: 'li', label, what: 'added' }] })
const input = { ref: '#q', id: { tag: 'input', sig: 'input|q||search||' }, tag: 'input', role: 'textbox', label: 'Search' }

const data = (extra: Partial<ShortcutsData> = {}): ShortcutsData => ({
  viewport: { width: 1280, height: 800 },
  listeners: { keydown: 1, keyup: 0, keypress: 0 },
  pressed: PRINTABLE_KEYS.length,
  idle: { dom: 0, pixels: 0 },
  keys: [],
  settings: [],
  hidden: [],
  selects: [],
  openers: [],
  instructions: [],
  controlCount: 3,
  documented: [],
  end: 'complete',
  ...extra,
})

function snapshotOf(shortcuts: ShortcutsData): A11ySnapshot {
  const record: ProbeRecord = {
    kind: 'shortcuts',
    version: '1',
    conditions: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, browser: 'chromium 1 (headless)', variant: 'character-keys' },
    status: 'complete',
    guard: { blocked: [], navigations: [], dialogs: [] },
    durationMs: 1,
    data: shortcuts,
  }
  return {
    schemaVersion: 1,
    surface: 'web',
    target: 'https://example.com/',
    viewport: { width: 1280, height: 800, scale: 1 },
    root: { ref: 'html', role: 'document', states: [], native: { tag: 'html', attributes: {} }, children: [{ ref: 'html > body', role: 'generic', states: [], native: { tag: 'body', attributes: {} }, children: [] }] },
    observations: { probes: [record] },
    collectedAt: new Date(0).toISOString(),
    collector: { name: 'rampa-web', version: '0' },
  }
}

const twice = (key: string, change: KeyChange, control: KeyChange = none()) => ({ key, first: change, control, second: change })

describe('2.1.4 over recorded key presses', () => {
  it('counts a change a reader would notice, and leaves a few stray pixels out', () => {
    expect(changed(none())).toBe(false)
    expect(changed(none({ pixels: 5 }))).toBe(false)
    expect(changed(none({ pixels: 40 }))).toBe(true)
    expect(changed(none({ style: 3 }))).toBe(false)
    expect(changed(none({ scroll: { x: 0, y: 2 } }))).toBe(false)
    expect(changed(none({ scroll: { x: 0, y: 400 } }))).toBe(true)
    expect(changed(none({ focus: input }))).toBe(true)
    expect(changed(none({ events: ['navigation'] }))).toBe(true)
    expect(changed(added('Pears'))).toBe(true)
  })

  it('keeps a key only when both presses changed the page and the wait with no key did not', () => {
    const verdicts = shortcutVerdicts(
      data({
        keys: [twice('n', added('New')), twice('c', added('Tick'), none({ dom: 1 })), { key: 'o', first: added('Once'), control: none(), second: none() }, { key: 'z', first: added('Late') }],
      }),
    )
    expect(verdicts.active.map((t) => t.key)).toEqual(['n'])
    expect(verdicts.noisy).toEqual(['c'])
    expect(verdicts.once).toEqual(['o'])
    expect(verdicts.unconfirmed).toEqual(['z'])
  })

  it('fails the page once for its shortcuts, says a setting elsewhere satisfies the criterion, and lets a working setting clear a key', () => {
    const remap = { ref: '#remap', id: { tag: 'input', sig: 'input|remap||checkbox||' }, tag: 'input', role: 'checkbox', label: 'Use Ctrl with +', kind: 'checkbox' as const, context: 'Use Ctrl with +', toggled: true, restored: true }
    const snapshot = snapshotOf(
      data({
        keys: [twice('+', added('Pears')), twice('s', none({ focus: input, pixels: 300 }))],
        settings: [{ ...remap, keys: [{ key: '+', change: none() }, { key: 's', change: none({ focus: input }) }] }],
      }),
    )
    const result = probeJudgments(snapshot)
    expect(result).toEqual([])
    return checkSnapshot(snapshot, emptyEngine(), probeCheckOptions()).then((report) => {
      const findings = byRule(report, RULE)
      expect(findings).toHaveLength(1)
      expect(findings[0]).toMatchObject({ ref: 'html > body', criterion: '2.1.4', confidence: 'medium', source: 'probe', experimental: true })
      expect(findings[0]?.message).toMatch(/^Pressing "s" with focus on the page, and no other key held, changes it/)
      expect(findings[0]?.message).toContain('If a setting elsewhere, such as another page or the account settings, already does this, the criterion is satisfied: waive this finding (rampa waive).')
      expect(findings[0]?.evidence).toBe('"s" moved focus to <input> "Search"; each on two presses with focus on the body, and nothing changed in the same wait with no key')
      const coverage = report.coverage.probes?.find((c) => c.criterion === '2.1.4')
      expect(coverage).toMatchObject({ method: 'probe/shortcuts@1', rule: RULE, status: 'failures', applicable: 2, failures: 1 })
      expect(coverage?.note).toContain('<input type=checkbox> "Use Ctrl with +" turns off or remaps "+"')
    })
  })

  it('says why nothing was pressed: no key listener, or a field that kept focus', async () => {
    const quiet = await checkSnapshot(snapshotOf(data({ listeners: { keydown: 0, keyup: 0, keypress: 0 }, pressed: 0, end: 'no-listeners' })), emptyEngine(), probeCheckOptions())
    expect(quiet.coverage.probes?.find((c) => c.criterion === '2.1.4')).toMatchObject({ status: 'no-failure-found', applicable: 0, note: expect.stringContaining('no key listener') })
    expect(quiet.coverage.criteria?.find((c) => c.id === '2.1.4')?.status).toBe('no-applicable-content')
    const stuck = await checkSnapshot(snapshotOf(data({ pressed: 0, end: 'focus-stuck' })), emptyEngine(), probeCheckOptions())
    expect(stuck.coverage.probes?.find((c) => c.criterion === '2.1.4')).toMatchObject({ status: 'not-checked', applicable: 0 })
    expect(stuck.coverage.criteria?.find((c) => c.id === '2.1.4')?.status).toBe('not-checked')
  })
})

describe('2.1.4 "clearly labeled": the model may only clear', () => {
  const hiddenData = () =>
    data({
      keys: [twice('j', none({ dom: 3, pixels: 900, samples: [{ ref: '#m1', id: { tag: 'li', sig: 'li|m1||||' }, tag: 'li', label: 'Lunch', what: 'aria-selected' }] }))],
      hidden: [{ ref: '#kbd-off', id: { tag: 'input', sig: 'input|kbd-off||checkbox||' }, tag: 'input', role: 'checkbox', label: 'Turn off single-key shortcuts', context: 'Turn off single-key shortcuts' }],
      openers: [{ ref: '#open', id: { tag: 'button', sig: 'button|open||button||' }, tag: 'button', role: 'button', label: 'Keyboard shortcut settings', why: 'controls' }],
      instructions: ['Press j and k to move between messages.'],
      controls: ['Keyboard shortcut settings'],
    })

  it('is asked only when a hidden setting or a control that may lead to one exists, and only with judgment on', async () => {
    const snapshot = snapshotOf(hiddenData())
    expect(probeJudgments(snapshot)).toEqual([characterKeyShortcuts])
    expect(probeJudgments(snapshotOf(data({ keys: [twice('j', added('x'))] })))).toEqual([])
    const off = await checkSnapshot(snapshot, emptyEngine(), probeCheckOptions())
    expect(byRule(off, RULE)[0]?.message).toContain('A setting that may turn them off is not showing (<input type=checkbox> "Turn off single-key shortcuts"), and <button> "Keyboard shortcut settings" may lead to it')
    expect(off.criteria.find((c) => c.criterion === '2.1.4')).toMatchObject({ candidates: 1, judged: 0 })
  })

  it('clears the finding when a showing control clearly leads to the setting', async () => {
    const model = answering({ verdict: 'pass', control: 'Keyboard shortcut settings', evidence: 'Keyboard shortcut settings', confidence: 'high' })
    const report = await checkSnapshot(snapshotOf(hiddenData()), emptyEngine(), probeCheckOptions({ llm: true, provider: model }))
    expect(model.asked).toHaveLength(1)
    expect(model.asked[0]).toContain('- "Keyboard shortcut settings"')
    expect(model.asked[0]).toContain('- "Turn off single-key shortcuts"')
    expect(byRule(report, RULE)).toEqual([])
    expect(report.findings.filter((f) => f.criterion === '2.1.4')).toEqual([])
    const coverage = report.coverage.probes?.find((c) => c.criterion === '2.1.4')
    expect(coverage).toMatchObject({ status: 'no-failure-found', failures: 0 })
    expect(coverage?.note).toContain('finding cleared by the model: "Keyboard shortcut settings" clearly leads to the settings')
    expect(report.coverage.criteria?.find((c) => c.id === '2.1.4')?.methods).toContainEqual(expect.objectContaining({ kind: 'judgment', id: 'judgment/2.1.4@1', ran: true }))
  })

  it('keeps the finding, with the model named, when no control is clearly labeled, and never makes one of its own', async () => {
    const model = answering({ verdict: 'fail', control: '', evidence: 'Only "Open" is shown', confidence: 'medium' })
    const report = await checkSnapshot(snapshotOf(hiddenData()), emptyEngine(), probeCheckOptions({ llm: true, provider: model }))
    const findings = report.findings.filter((f) => f.criterion === '2.1.4')
    expect(findings.map((f) => f.source)).toEqual(['probe'])
    expect(findings[0]?.evidence).toMatch(/; the model found no showing control that clearly leads to a way to turn them off or remap them$/)
    expect(findings[0]).toMatchObject({ model: 'stub:shortcuts', agreement: { votes: 1, total: 1 } })
  })

  it('discards a pass that names a control the page does not show, and keeps the finding as it was', async () => {
    const model = answering({ verdict: 'pass', control: 'Settings', evidence: 'Settings', confidence: 'high' })
    const report = await checkSnapshot(snapshotOf(hiddenData()), emptyEngine(), probeCheckOptions({ llm: true, provider: model }))
    expect(report.discarded).toEqual([expect.objectContaining({ criterion: '2.1.4', reason: 'the control is not one the page shows' })])
    expect(byRule(report, RULE)).toHaveLength(1)
    expect(byRule(report, RULE)[0]?.model).toBeUndefined()
  })
})

// Integration: needs Chrome or Edge. Skipped, with the reason on stderr, when none starts.
const browser = await launchBrowser({ args: DETERMINISM_ARGS }).catch((error: unknown) => {
  process.stderr.write(`\nSkipping the shortcuts probe tests: no browser started (${error instanceof Error ? error.message.split('\n')[0] : String(error)}).\n`)
  return undefined
})
// Closing Edge can take long on a loaded machine.
afterAll(async () => browser?.close(), 60_000)

const collected = new Map<string, Promise<Collected>>()
function probed(name: string): Promise<Collected> {
  if (!browser) throw new Error('no browser')
  let result = collected.get(name)
  if (!result) {
    result = collectWeb(browser, fixture(name), { runAxe: false, locale: 'en', probes: ['shortcuts'] })
    collected.set(name, result)
  }
  return result
}

const dataOf = (snapshot: A11ySnapshot) => snapshot.observations?.probes.find((p) => p.kind === 'shortcuts')?.data as ShortcutsData | undefined

describe.skipIf(!browser)('shortcuts probe (2.1.4)', { timeout: 180_000 }, () => {
  it('presses every printable key with focus on the body, behind the guard, and finds the page-wide shortcuts', async () => {
    const { snapshot, engine } = await probed('shortcuts-fail.html')
    expect(A11ySnapshotSchema.safeParse(snapshot).success).toBe(true)
    const record = snapshot.observations?.probes.find((p) => p.kind === 'shortcuts')
    expect(record).toMatchObject({ kind: 'shortcuts', version: '1', status: 'complete', conditions: { variant: 'character-keys' } })
    // "h" sets location.href: the guard answers the navigation locally, and the page stays.
    expect(record?.guard.navigations.map((n) => n.url)).toContain('https://example.invalid/home')
    expect(record?.guard.blocked).toEqual([])
    const data = dataOf(snapshot)
    expect(data?.pressed).toBe(PRINTABLE_KEYS.length)
    expect(data?.listeners?.keydown).toBeGreaterThan(0)
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    const findings = byRule(report, RULE)
    expect(findings).toHaveLength(1)
    expect(findings[0]?.message).toMatch(/^Pressing ("[?snh]", ){3}"[?snh]" with focus on the page/)
    expect(findings[0]?.message).toContain('Toggling <input type=checkbox> "Play keyboard sounds" did not stop them.')
    for (const effect of ['"s" moved focus to <input>', '"n" added <li> "New note"', '"?" moved focus to <dialog>', 'opened a modal dialog', '"h" started a navigation (answered by the guard)']) {
      expect(findings[0]?.evidence).toContain(effect)
    }
    // The clock that ticks on its own is never credited to a key, and Ctrl+K is not a single-key shortcut.
    expect(shortcutVerdicts(data as ShortcutsData).active.map((t) => t.key).sort()).toEqual(['?', 'h', 'n', 's'])
    expect(report.coverage.probes?.find((c) => c.criterion === '2.1.4')).toMatchObject({ status: 'failures', applicable: 4, failures: 1 })
    expect(report.coverage.notChecked).not.toContain('2.1.4')
  })

  it('finds nothing when a checkbox remaps "+" and a switch turns "d" off, a list box types ahead only on focus, and a clock ticks', async () => {
    const { snapshot, engine } = await probed('shortcuts-pass.html')
    const data = dataOf(snapshot) as ShortcutsData
    expect(shortcutVerdicts(data).active.map((t) => t.key).sort()).toEqual(['+', 'd'])
    expect(data.settings.map((s) => `${s.ref} ${s.kind} ${s.toggled} ${s.restored}`)).toEqual(['#remap checkbox true true', '#dark-keys switch true true'])
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    expect(byRule(report, RULE)).toEqual([])
    const coverage = report.coverage.probes?.find((c) => c.criterion === '2.1.4')
    expect(coverage).toMatchObject({ status: 'no-failure-found', applicable: 2, failures: 0 })
    expect(coverage?.note).toContain('<input type=checkbox> "Use Ctrl together with the "+" key" turns off or remaps "+"')
    expect(coverage?.note).toContain('"Single-key shortcut for dark mode" turns off or remaps "d"')
  })

  it('leaves a setting in a closed dialog to the model, which may clear the finding', async () => {
    const { snapshot, engine } = await probed('shortcuts-hidden.html')
    const data = dataOf(snapshot) as ShortcutsData
    expect(data.hidden.map((h) => `${h.ref} in ${h.container?.ref}`)).toEqual(['#kbd-off in #kbd-settings'])
    expect(data.openers.map((o) => `${o.label} (${o.why})`)).toEqual(['Keyboard shortcut settings (controls)'])
    const off = await checkSnapshot(snapshot, engine, probeCheckOptions())
    expect(byRule(off, RULE).map((f) => f.confidence)).toEqual(['medium'])
    expect(byRule(off, RULE)[0]?.message).toContain('Rampa never clicks to open it')
    const model = answering({ verdict: 'pass', control: 'Keyboard shortcut settings', evidence: 'Keyboard shortcut settings', confidence: 'high' })
    const cleared = await checkSnapshot(snapshot, engine, probeCheckOptions({ llm: true, provider: model }))
    expect(model.asked).toHaveLength(1)
    expect(byRule(cleared, RULE)).toEqual([])
  })

  it('writes in the report language, stays below the default threshold, and prints the coverage line', async () => {
    const { snapshot, engine } = await probed('shortcuts-fail.html')
    const pt = await checkSnapshot(snapshot, engine, probeCheckOptions({ locale: 'pt-BR' }))
    expect(byRule(pt, RULE)[0]?.message).toMatch(/^Pressionar .* com o foco na página, sem outra tecla segurada, muda a página/)
    expect(byRule(pt, RULE)[0]?.message).toContain('dispense este achado (rampa waive)')
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions({ minConfidence: 'medium' }))
    expect(byRule(report, RULE)).toEqual([])
    expect(report.belowThreshold.filter((f) => f.ruleId === RULE)).toHaveLength(1)
    const text = renderReport(report, { verbose: true, paint: paint(false) })
    expect(text).toMatch(/2\.1\.4 +probe\/shortcuts@1 \(rampa\/character-key-shortcuts\) · printable keys with focus on the body at 1280×800/)
  })

  it('replays a saved snapshot offline to the same findings', async () => {
    const { snapshot, engine } = await probed('shortcuts-fail.html')
    const live = await checkSnapshot(snapshot, engine, probeCheckOptions())
    const dir = await mkdtemp(join(tmpdir(), 'rampa-shortcuts-'))
    const path = join(dir, 'shortcuts.snapshot.json')
    await writeFile(path, JSON.stringify(snapshot), 'utf8')
    await writeFile(join(dir, 'shortcuts.engine.json'), JSON.stringify(engine), 'utf8')
    const loaded = await loadRecorded(path, 'en')
    const replayed = await checkSnapshot(loaded.snapshot, loaded.engine, probeCheckOptions())
    const key = (report: Report) => report.findings.map((f) => `${f.fingerprint} ${f.evidence}`)
    expect(key(replayed)).toEqual(key(live))
    expect(replayed.coverage.probes).toEqual(live.coverage.probes)
  })
})
