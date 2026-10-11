import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { checkSnapshot } from '../src/core/check.ts'
import type { Report } from '../src/core/types.ts'
import { keyboardParity, parityJudgments } from '../src/criteria/keyboard-parity.ts'
import { emptyEngine } from '../src/engine/axe.ts'
import {
  type Effect,
  type KeyAttempt,
  type ParityControl,
  type ParityData,
  type ParityTrial,
  covers,
  effectEmpty,
  exitKeys,
  keyPaths,
  parityResult,
  parityVerdicts,
} from '../src/probes/parity.ts'
import { DETERMINISM_ARGS, parseProbeKinds } from '../src/probes/run.ts'
import type { JudgeRequest, ModelProvider } from '../src/providers/types.ts'
import { paint } from '../src/report/color.ts'
import { renderReport } from '../src/report/pretty.ts'
import { A11ySnapshotSchema, type A11yNode, type A11ySnapshot, type ProbeRecord } from '../src/snapshot/schema.ts'
import { indexTree } from '../src/snapshot/tree.ts'
import { loadRecorded } from '../src/surfaces/targets.ts'
import { type Collected, collectWeb, launchBrowser } from '../src/surfaces/web.ts'
import { startFixtureServers } from './media-server.ts'
import { byRule, probeCheckOptions, reviewByRule } from './probe-helpers.ts'

const RULE = 'rampa/keyboard-parity'
const MENU_RULE = 'rampa/hover-menu'
const EXIT_RULE = 'rampa/trap-exit'

const effect = (extra: Partial<Effect> = {}): Effect => ({ events: [], states: [], shown: [], hidden: [], counts: { states: 0, shown: 0, hidden: 0 }, text: { added: [], removed: [], changed: 0 }, ...extra })
const shows = (ref: string, label = 'Panel'): Partial<Effect> => ({ shown: [{ ref, tag: 'div', label }], counts: { states: 0, shown: 1, hidden: 0 }, text: { added: [label], removed: [], changed: label.length } })
const goes = (url: string): Partial<Effect> => ({ events: [{ kind: 'navigation', detail: url }] })
const key = (path: string, extra: Partial<Effect> | undefined, more: Partial<KeyAttempt> = {}): KeyAttempt => ({ path, pressed: path, focused: true, tabbable: true, focus: effect(), ...(extra ? { effect: effect(extra) } : { effect: effect() }), ...more })

describe('keys against a click, as facts', () => {
  it('reads the keys an exit instruction names', () => {
    expect(exitKeys('Press Ctrl+M to leave the editor')).toEqual(['Control+m'])
    expect(exitKeys('pressione Esc para sair do editor')).toEqual(['Escape'])
    expect(exitKeys('Use Alt + Shift + F6 to move out')).toEqual(['Alt+Shift+F6'])
    expect(exitKeys('press Tab twice')).toEqual(['Tab'])
    // A single letter counts only with a modifier.
    expect(exitKeys('use a mouse or press q')).toEqual([])
  })

  it('tries the keys a pattern uses, the arrows of a widget first', () => {
    const paths = (control: Pick<ParityControl, 'role' | 'widget' | 'haspopup'>) => keyPaths(control).map((p) => p.path)
    expect(paths({ role: 'button' })).toEqual(['Enter', 'Space'])
    expect(paths({ role: 'slider' })).toEqual(['Enter', 'Space', 'ArrowRight', 'ArrowUp'])
    expect(paths({ role: 'button', haspopup: 'menu' })).toEqual(['Enter', 'Space', 'ArrowDown'])
    expect(paths({ role: 'tab', widget: { ref: '#tabs', role: 'tablist' } })).toEqual(['arrive', 'arrive, Enter', 'arrive, Space', 'Enter', 'Space'])
  })

  it('compares what the keys did with what the click did', () => {
    const click = effect(shows('#panel'))
    expect(effectEmpty(effect())).toBe(true)
    expect(effectEmpty(effect({ scroll: { x: 0, y: 300 } }), 'Space')).toBe(true)
    expect(effectEmpty(effect({ scroll: { x: 0, y: 300 } }), 'Enter')).toBe(false)
    expect(covers(click, [effect(shows('#panel'))])).toBe(true)
    // An element inside the one that showed, or around it, is the same showing.
    expect(covers(click, [effect(shows('#panel > p'))])).toBe(true)
    expect(covers(click, [effect(shows('#other'))])).toBe(false)
    expect(covers(effect(goes('https://example.com/guide')), [effect(goes('https://example.com/guide#top'))])).toBe(true)
    expect(covers(effect(goes('https://example.com/guide')), [effect(goes('https://example.com/other'))])).toBe(false)
    expect(parityResult({ keys: [key('Enter', shows('#panel'))], click })).toEqual({ result: 'same', match: 'Enter' })
    expect(parityResult({ keys: [key('Enter', undefined), key('Space', undefined)], click }).result).toBe('none')
    expect(parityResult({ keys: [key('Enter', shows('#other'))], click }).result).toBe('partial')
    expect(parityResult({ keys: [{ path: 'Enter', focused: false }], click }).result).toBe('unreachable')
    expect(parityResult({ keys: [key('Enter', undefined)], click: effect() }).result).toBe('inert')
    // Focus alone may do it: a menu that shows on focus-within.
    expect(parityResult({ keys: [key('Enter', undefined, { focus: effect(shows('#panel')) })], click }).result).toBe('same')
    // An item of a widget counts only as the arrows reach it, or as Tab does.
    const composite = [key('arrive', undefined, { arrived: false, tabbable: undefined }), key('Enter', shows('#panel'), { tabbable: false })]
    expect(parityResult({ keys: composite, click }).result).toBe('unreachable')
    expect(parityResult({ keys: [key('arrive', shows('#panel'), { arrived: true, tabbable: undefined })], click }).result).toBe('same')
  })

  it('keeps the activate class out of --probe all', () => {
    expect(parseProbeKinds('all')).not.toContain('parity')
    expect(parseProbeKinds('parity')).toEqual(['parity'])
    expect(parseProbeKinds('interact')).toContain('parity')
  })
})

const node = (ref: string, tag: string, attributes: Record<string, string>, role: string, name: string): A11yNode => ({ ref, role, name, states: [], native: { tag, attributes }, children: [] })

const control = (ref: string, label: string, trial: ParityTrial, extra: Partial<ParityControl> = {}): ParityControl => ({
  ref,
  id: { tag: 'div', sig: `div|${ref.slice(1)}|button|||` },
  tag: 'div',
  role: 'button',
  label,
  why: 'role',
  texts: [label],
  trial,
  ...extra,
})

function paritySnapshot(controls: ParityControl[], extra: ProbeRecord[] = []): A11ySnapshot {
  const data: ParityData = { viewport: { width: 1280, height: 800 }, listeners: 3, found: controls.length, controls, tried: controls.length, menusFound: 0, menus: [], exitText: false, traps: [], loads: 4, actions: [], end: 'complete' }
  const record: ProbeRecord = {
    kind: 'parity',
    version: '1',
    conditions: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, browser: 'chromium 1 (headless)', variant: 'keyboard-parity' },
    status: 'complete',
    guard: { blocked: [], navigations: [], dialogs: [] },
    durationMs: 1,
    data,
  }
  const nodes = controls.map((c) => node(c.ref, 'div', { id: c.ref.slice(1), role: 'button' }, 'button', c.label))
  return {
    schemaVersion: 1,
    surface: 'web',
    target: 'https://example.com/',
    title: 'Store',
    viewport: { width: 1280, height: 800, scale: 1 },
    root: { ref: 'html', role: 'document', states: [], native: { tag: 'html', attributes: {} }, children: [{ ref: 'html > body', role: 'generic', states: [], native: { tag: 'body', attributes: {} }, children: nodes }] },
    observations: { probes: [record, ...extra] },
    collectedAt: new Date(0).toISOString(),
    collector: { name: 'rampa-web', version: '0' },
  }
}

const noneTrial = (click: Partial<Effect>, confirmed = true): ParityTrial => ({
  keys: [key('Enter', undefined), key('Space', undefined)],
  click: effect(click),
  result: 'none',
  ...(confirmed ? { confirm: { keys: [key('Enter', undefined), key('Space', undefined)], click: effect(click), result: 'none' } } : {}),
})

describe('2.1.1 over recorded keys and clicks', () => {
  const details = control('#details', 'Show details', noneTrial(shows('#panel')))
  const once = control('#once', 'Once', noneTrial(shows('#once-panel'), false))
  const play = control('#play', 'Play', { keys: [key('Enter', { text: { added: ['Pause'], removed: ['Play'], changed: 9 } })], click: effect({ states: [{ ref: '#play', tag: 'div', label: 'Play', attr: 'aria-pressed', from: 'false', to: 'true' }], counts: { states: 1, shown: 0, hidden: 0 }, text: { added: ['Pause'], removed: ['Play'], changed: 9 } }), result: 'partial' })
  const same = control('#same', 'Same', { keys: [key('Enter', shows('#same-panel'))], click: effect(shows('#same-panel')), result: 'same' })
  const card = control('#card', 'Oak chairs', { keys: [{ path: 'Enter', focused: false }], click: effect(goes('https://example.com/chairs')), result: 'unreachable', elsewhere: { ref: '#card > a', label: 'Oak chairs', href: 'https://example.com/chairs' } }, { why: 'handler' })

  it('fails what the click did and the keys did not, twice; once is for review; equivalents and other ways are not reported', async () => {
    const report = await checkSnapshot(paritySnapshot([details, once, play, same, card]), emptyEngine(), probeCheckOptions())
    const findings = byRule(report, RULE)
    expect(findings.map((f) => `${f.ref} ${f.confidence}`)).toEqual(['#details high', '#play medium'])
    expect(findings[0]?.message).toMatch(/^Clicking this control showed <div> "Panel"/)
    expect(findings[0]?.message).toContain('but Enter, Space on it do nothing: someone who uses a keyboard cannot operate it (WCAG 2.1.1)')
    expect(findings[0]?.evidence).toContain('keys, after focus: Enter: nothing; Space: nothing; then a click: showed <div> "Panel"')
    expect(findings[0]?.evidence).toContain('the same on a second fresh load')
    expect(findings[1]?.message).toContain('the keyboard (Enter) does something else')
    expect(reviewByRule(report, RULE).map((r) => r.ref)).toEqual(['#once'])
    const row = report.coverage.probes?.find((c) => c.rule === RULE)
    expect(row).toMatchObject({ criterion: '2.1.1', method: 'probe/parity@1', status: 'failures', applicable: 5, failures: 2, review: 1 })
    expect(row?.note).toContain('1 did the same with the keyboard')
    expect(row?.note).toContain('1 went where a link Tab reaches also goes')
    const pt = await checkSnapshot(paritySnapshot([details]), emptyEngine(), probeCheckOptions({ locale: 'pt-BR' }))
    expect(byRule(pt, RULE)[0]?.message).toMatch(/^Clicar neste controle mostrou <div> "Panel"; texto adicionado: "Panel", mas Enter, Space nele não faz\(em\) nada/)
    expect(renderReport(report, { verbose: true, paint: paint(false) })).toMatch(/2\.1\.1 +probe\/parity@1 \(rampa\/keyboard-parity\) · keys against a click/)
  })

  it('leaves a control with a role that takes no focus to the keyboard walk, when it went round the page', () => {
    const unreachable = control('#fake', 'Save', { keys: [{ path: 'Enter', focused: false }], click: effect(shows('#saved')), result: 'unreachable' })
    const snapshot = paritySnapshot([unreachable])
    const data = snapshot.observations?.probes[0]?.data as ParityData
    expect(parityVerdicts(data, indexTree(snapshot.root), false).verdicts.map((v) => v.result)).toEqual(['unreachable'])
    expect(parityVerdicts(data, indexTree(snapshot.root), true)).toMatchObject({ verdicts: [], deferred: 1 })
  })
})

/** A model that answers the 2.1.1 question per control, from the facts in its prompt, and keeps the prompts. */
function judge(answers: Record<string, 'equivalent' | 'path-dependent' | 'invented' | 'idle' | 'fail'>): ModelProvider & { asked: string[] } {
  const asked: string[] = []
  return {
    id: 'stub:parity',
    asked,
    async judge<T>(request: JudgeRequest<T>) {
      asked.push(request.user)
      const name = /Control: (.*)/.exec(request.user)?.[1] ?? ''
      const answer = Object.entries(answers).find(([label]) => name.includes(label))?.[1] ?? 'fail'
      const clickId = /- (C\d+):/.exec(request.user)?.[1] ?? 'C1'
      const enter = /- keys "Enter" \(pressed: [^)]*\):\n {2}- (K\d+):/.exec(request.user)?.[1] ?? 'K1'
      const texts = request.user.split('Texts of the control and around it:\n')[1]?.split('\n') ?? []
      const quote = (texts.find((line) => /signature/i.test(line)) ?? '- ""').replace(/^- "|"$/g, '')
      const outputs: Record<string, Record<string, unknown>> = {
        equivalent: { verdict: 'pass', reason: 'equivalent', keys: 'Enter', facts: [clickId, enter], evidence: '', confidence: 'high' },
        'path-dependent': { verdict: 'pass', reason: 'path-dependent', keys: '', facts: [], evidence: quote, confidence: 'high' },
        invented: { verdict: 'pass', reason: 'path-dependent', keys: '', facts: [], evidence: 'Sign here with a stylus', confidence: 'high' },
        idle: { verdict: 'pass', reason: 'equivalent', keys: 'Space', facts: [clickId, 'K9'], evidence: '', confidence: 'high' },
        fail: { verdict: 'fail', reason: 'none', keys: '', facts: [], evidence: '', confidence: 'high' },
      }
      return { output: request.schema.parse(outputs[answer]), inputTokens: 100, outputTokens: 20, latencyMs: 1, modelId: 'stub' }
    },
  }
}

describe('2.1.1 equivalence and the path-dependent exception: the model may only clear', () => {
  const play = control('#play', 'Play', { keys: [key('Enter', { text: { added: ['Pause'], removed: ['Play'], changed: 9 } }), key('Space', undefined)], click: effect({ states: [{ ref: '#play', tag: 'div', label: 'Play', attr: 'aria-pressed', from: 'false', to: 'true' }], counts: { states: 1, shown: 0, hidden: 0 }, text: { added: ['Pause'], removed: ['Play'], changed: 9 } }), result: 'partial' })
  const pad = control('#pad', '', { keys: [{ path: 'Enter', focused: false }], click: effect({ text: { added: ['1 stroke(s) drawn'], removed: [], changed: 17 } }), result: 'unreachable', confirm: { keys: [{ path: 'Enter', focused: false }], click: effect({ text: { added: ['1 stroke(s) drawn'], removed: [], changed: 17 } }), result: 'unreachable' } }, { why: 'pointer-only', role: 'generic', listeners: ['mousedown'], texts: ['Draw your signature with the mouse in the box below.'] })
  const details = control('#details', 'Show details', noneTrial(shows('#panel')))

  it('is asked only for failures, and only with judgment on', async () => {
    const snapshot = paritySnapshot([play, pad, details])
    expect(parityJudgments(snapshot)).toEqual([keyboardParity])
    expect(parityJudgments(paritySnapshot([]))).toEqual([])
    const off = await checkSnapshot(snapshot, emptyEngine(), probeCheckOptions())
    expect(byRule(off, RULE).map((f) => f.ref)).toEqual(['#play', '#pad', '#details'])
    expect(off.criteria.find((c) => c.criterion === '2.1.1')).toMatchObject({ candidates: 3, judged: 0 })
  })

  it('clears an equivalent effect and a path-dependent function, and keeps the rest', async () => {
    const model = judge({ Play: 'equivalent', '<div>': 'path-dependent', 'Show details': 'fail' })
    const report = await checkSnapshot(paritySnapshot([play, pad, details]), emptyEngine(), probeCheckOptions({ llm: true, provider: model }))
    expect(model.asked).toHaveLength(3)
    expect(model.asked.find((p) => p.includes('"Play"'))).toContain('- keys "Enter" (pressed: Enter):\n  - K1: text added: "Pause"; text removed: "Play"')
    expect(byRule(report, RULE).map((f) => f.ref)).toEqual(['#details'])
    expect(byRule(report, RULE)[0]?.evidence).toMatch(/the model found no key path that reaches the same function, and no function that depends on the path$/)
    const note = report.coverage.probes?.find((c) => c.rule === RULE)?.note ?? ''
    expect(note).toContain('finding cleared by the model: Enter reaches the same function as the click (C1, K1)')
    expect(note).toContain(`finding cleared by the model: the function depends on the pointer's path ("Draw your signature with the mouse in the box below.")`)
  })

  it('discards a quote the page does not show, and an equivalence that cites keys that did nothing', async () => {
    const invented = await checkSnapshot(paritySnapshot([pad]), emptyEngine(), probeCheckOptions({ llm: true, provider: judge({ '<div>': 'invented' }) }))
    expect(invented.discarded).toEqual([expect.objectContaining({ criterion: '2.1.1', reason: 'evidence is not text the page shows' })])
    expect(byRule(invented, RULE)).toHaveLength(1)
    const idle = await checkSnapshot(paritySnapshot([play]), emptyEngine(), probeCheckOptions({ llm: true, provider: judge({ Play: 'idle' }) }))
    expect(idle.discarded).toEqual([expect.objectContaining({ reason: 'an equivalent pass must name a key path that did something' })])
    expect(byRule(idle, RULE)).toHaveLength(1)
  })
})

// Integration: needs Chrome or Edge, and the fixtures over HTTP. Skipped, with the reason on stderr, when no browser starts.
const browser = await launchBrowser({ args: DETERMINISM_ARGS }).catch((error: unknown) => {
  process.stderr.write(`\nSkipping the parity probe tests: no browser started (${error instanceof Error ? error.message.split('\n')[0] : String(error)}).\n`)
  return undefined
})
const servers = browser ? await startFixtureServers() : undefined
afterAll(async () => {
  await browser?.close()
  await servers?.close()
}, 60_000)

const collected = new Map<string, Promise<Collected>>()
function probed(name: string, kinds: Array<'parity' | 'keyboard'> = ['parity']): Promise<Collected> {
  if (!browser || !servers) throw new Error('no browser')
  const key = `${name}|${kinds.join(',')}`
  let result = collected.get(key)
  if (!result) {
    result = collectWeb(browser, `${servers.origin}/${name}`, { runAxe: false, locale: 'en', probes: kinds })
    collected.set(key, result)
  }
  return result
}

const recordOf = (snapshot: A11ySnapshot) => snapshot.observations?.probes.find((p) => p.kind === 'parity')
const dataOf = (snapshot: A11ySnapshot) => recordOf(snapshot)?.data as ParityData
const results = (snapshot: A11ySnapshot) => dataOf(snapshot).controls.map((c) => `${c.ref} ${c.skip ? `skip ${c.skip.reason}` : (c.trial?.outcome ?? parityResult(c.trial ?? { keys: [] }).result)}`)

describe.skipIf(!browser)('parity probe (2.1.1, 2.1.2)', { timeout: 400_000 }, () => {
  it('fails controls the click operates and the keys do not, twice, and a menu only hover shows', async () => {
    const { snapshot, engine } = await probed('parity-fail.html')
    expect(A11ySnapshotSchema.safeParse(snapshot).success).toBe(true)
    expect(recordOf(snapshot)).toMatchObject({ kind: 'parity', version: '1', status: 'complete', conditions: { variant: 'keyboard-parity' } })
    expect(results(snapshot)).toEqual(['#details none', '#guide none', '#filters none', '#photo unreachable'])
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    expect(byRule(report, RULE).map((f) => `${f.ref} ${f.confidence}`)).toEqual(['#details high', '#guide high', '#filters high', '#photo high'])
    expect(byRule(report, RULE).find((f) => f.ref === '#filters')?.message).toContain('(WCAG 2.1.1; F54)')
    expect(byRule(report, RULE).find((f) => f.ref === '#photo')?.message).toContain('it cannot take keyboard focus, so no key can operate it (WCAG 2.1.1; F42)')
    expect(byRule(report, RULE).find((f) => f.ref === '#guide')?.message).toMatch(/went to http:\/\/127\.0\.0\.1:\d+\/parity\/guide\.html/)
    const menu = byRule(report, MENU_RULE)
    expect(menu.map((f) => `${f.ref} ${f.confidence}`)).toEqual(['#about high'])
    expect(menu[0]?.message).toMatch(/^Hovering <li> "About us" shows a menu of 2 link\(s\) \("Annual report", "Board"\) that no key shows/)
    // The click on the scripted link was intercepted: the server saw the page's own loads, nothing else.
    expect((servers?.requests ?? []).filter((r) => r.includes('/parity/'))).toEqual([])
    const origin = servers?.origin ?? ''
    expect([...new Set(recordOf(snapshot)?.guard.navigations.map((n) => `${n.cause} ${n.url}`))]).toEqual([`intercepted ${origin}/parity/guide.html`])
  })

  it('fails tabs the arrows do not reach, a slider only the pointer moves, and an exit instruction that does not work', async () => {
    // The page probed with the keyboard walk too; read here as if the parity probe ran alone (rules read only the snapshot).
    const both = await probed('parity-widgets.html', ['keyboard', 'parity'])
    const snapshot: A11ySnapshot = { ...both.snapshot, observations: { probes: (both.snapshot.observations?.probes ?? []).filter((p) => p.kind === 'parity') } }
    const engine = both.engine
    expect(results(snapshot)).toEqual(['#tab-1 inert', '#tab-2 unreachable', '#volume none'])
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    expect(byRule(report, RULE).map((f) => `${f.ref} ${f.confidence}`)).toEqual(['#tab-2 high', '#volume high'])
    expect(byRule(report, RULE)[0]?.message).toContain('Tab does not reach it, and the arrow keys of its tablist do not move to it')
    expect(byRule(report, RULE)[1]?.evidence).toContain('ArrowRight: nothing; ArrowUp: nothing')
    const exit = byRule(report, EXIT_RULE)
    expect(exit.map((f) => `${f.ref} ${f.confidence}`)).toEqual(['#bold high'])
    expect(exit[0]?.message).toContain('the way out the page names ("Press Ctrl+M to leave the editor") does not work: pressing Ctrl+M inside it')
    expect(dataOf(snapshot).traps).toEqual([expect.objectContaining({ hint: 'Press Ctrl+M to leave the editor', keys: ['Control+m'], left: false, rounds: 2 })])
  })

  it('turns the keyboard walk’s exit-text review into a failure when the instruction does not work', async () => {
    const { snapshot, engine } = await probed('parity-widgets.html', ['keyboard', 'parity'])
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    expect(byRule(report, 'rampa/keyboard-trap').map((f) => f.ref)).toEqual(['#bold'])
    expect(reviewByRule(report, 'rampa/keyboard-trap')).toEqual([])
    expect(byRule(report, EXIT_RULE)).toEqual([])
    expect(report.coverage.probes?.find((c) => c.rule === EXIT_RULE)).toMatchObject({ status: 'not-checked', note: 'the keyboard walk found the same cycle: rampa/keyboard-trap reports it' })
  })

  it('finds nothing where the keys do what the click does, a card’s link goes the same way, and the exit instruction works', async () => {
    const { snapshot, engine } = await probed('parity-pass.html')
    expect(results(snapshot)).toEqual(['#details same', '#gift same', '#tab-2 same', '#tab-3 same', '#volume same', '#share same', '#card unreachable'])
    expect(dataOf(snapshot).controls.find((c) => c.ref === '#card')?.trial?.elsewhere?.label).toBe('Oak chairs')
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    expect(byRule(report, RULE)).toEqual([])
    expect(byRule(report, MENU_RULE)).toEqual([])
    expect(byRule(report, EXIT_RULE)).toEqual([])
    expect(report.coverage.probes?.find((c) => c.rule === RULE)).toMatchObject({ status: 'no-failure-found', applicable: 7 })
    expect(dataOf(snapshot).menus.map((m) => `${m.trigger.ref} ${m.trial?.revealedBy ?? (m.trial?.missing.length === 0 ? 'elsewhere' : 'hover only')}`)).toEqual(['#about focus', '#help elsewhere'])
    expect(dataOf(snapshot).traps).toEqual([expect.objectContaining({ keys: ['Control+m'], left: true })])
  })

  it('never touches what the skip list names, and leaves the near misses to the judgment', async () => {
    const { snapshot, engine } = await probed('parity-near.html')
    const data = dataOf(snapshot)
    expect(results(snapshot)).toEqual(['#delete skip destructive', '#open same', '#play partial', '#next same', '#pad unreachable', '#tracked inert', '#card delegates', 'html > body > main > p:nth-of-type(1) > span inert'])
    // The tracker's beacon was blocked; the delete button was never pressed.
    expect(recordOf(snapshot)?.guard.blocked.map((b) => `${b.method} ${new URL(b.url).pathname}${new URL(b.url).search}`)).toEqual(['POST /touched?beacon'])
    expect((servers?.requests ?? []).filter((r) => r.includes('/touched'))).toEqual([])
    expect(data.actions.some((a) => a.action === 'activate' && a.ref === '#delete')).toBe(false)
    const off = await checkSnapshot(snapshot, engine, probeCheckOptions())
    expect(byRule(off, RULE).map((f) => `${f.ref} ${f.confidence}`)).toEqual(['#play medium', '#pad high'])
    const model = judge({ Play: 'equivalent', '<div>': 'path-dependent' })
    const judged = await checkSnapshot(snapshot, engine, probeCheckOptions({ llm: true, provider: model }))
    expect(model.asked).toHaveLength(2)
    expect(byRule(judged, RULE)).toEqual([])
  })

  it('replays a saved snapshot offline to the same findings', async () => {
    const { snapshot, engine } = await probed('parity-fail.html')
    const live = await checkSnapshot(snapshot, engine, probeCheckOptions())
    const dir = await mkdtemp(join(tmpdir(), 'rampa-parity-'))
    const path = join(dir, 'parity.snapshot.json')
    await writeFile(path, JSON.stringify(snapshot), 'utf8')
    await writeFile(join(dir, 'parity.engine.json'), JSON.stringify(engine), 'utf8')
    const loaded = await loadRecorded(path, 'en')
    const replayed = await checkSnapshot(loaded.snapshot, loaded.engine, probeCheckOptions())
    const key = (report: Report) => report.findings.map((f) => `${f.fingerprint} ${f.evidence}`)
    expect(key(replayed)).toEqual(key(live))
    expect(replayed.coverage.probes).toEqual(live.coverage.probes)
  })
})
