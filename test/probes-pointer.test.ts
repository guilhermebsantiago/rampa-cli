import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { checkSnapshot } from '../src/core/check.ts'
import type { Report } from '../src/core/types.ts'
import { emptyEngine } from '../src/engine/axe.ts'
import { type DragCandidate, type GestureCandidate, type PointerData, type PressCandidate, type PressEffects, type PressTrial, dragChange, pressOutcome } from '../src/probes/pointer.ts'
import { DETERMINISM_ARGS, parseProbeKinds } from '../src/probes/run.ts'
import { dragVerdicts, pressVerdicts } from '../src/rules/pointer.ts'
import { A11ySnapshotSchema, type A11yNode, type A11ySnapshot, type ProbeRecord } from '../src/snapshot/schema.ts'
import { indexTree } from '../src/snapshot/tree.ts'
import { loadRecorded } from '../src/surfaces/targets.ts'
import { type Collected, collectWeb, launchBrowser } from '../src/surfaces/web.ts'
import { startFixtureServers } from './media-server.ts'
import { byRule, probeCheckOptions, reviewByRule } from './probe-helpers.ts'

const CANCEL = 'rampa/pointer-cancellation'
const DRAG = 'rampa/dragging-movements'
const GESTURE = 'rampa/pointer-gestures'

describe('the pointer probe is opt-in', () => {
  it('stays out of --probe all and joins --probe interact', () => {
    expect(parseProbeKinds('all')).not.toContain('pointer')
    expect(parseProbeKinds('pointer')).toEqual(['pointer'])
    expect(parseProbeKinds('interact')).toContain('pointer')
  })
})

const effects = (extra: Partial<PressEffects> = {}): PressEffects => ({ state: [], dom: 0, style: 0, text: 0, samples: [], ...extra })

describe('what a press did, as 2.5.2 reads it', () => {
  it('weighs a change of context most, then a state the release did not undo, and leaves popups and other changes to a person', () => {
    const kind = (trial: Omit<PressTrial, 'confirm'>) => pressOutcome(trial).kind
    expect(kind({ context: [{ kind: 'navigation', detail: 'https://example.com/next' }], onDown: effects(), persisted: effects() })).toBe('context')
    expect(kind({ onDown: effects({ state: ['aria-pressed false → true'] }), persisted: effects({ state: ['aria-pressed false → true'] }) })).toBe('state')
    expect(kind({ onDown: effects({ state: ['checked false → true'] }), persisted: effects({ state: ['checked false → true'] }) })).toBe('state')
    // A menu that opened on the press and stayed: for a person.
    expect(kind({ onDown: effects({ state: ['aria-expanded false → true'], dom: 1 }), persisted: effects({ state: ['aria-expanded false → true'], dom: 1 }) })).toBe('expanded')
    expect(kind({ onDown: effects(), persisted: effects(), layer: { name: 'Share', modal: false, stayed: true } })).toBe('layer')
    expect(kind({ onDown: effects({ dom: 2 }), persisted: effects({ dom: 2, samples: ['<tr> added'] }) })).toBe('content')
    // Class changes outside the control count only with text that changed.
    expect(kind({ onDown: effects({ style: 3 }), persisted: effects({ style: 3 }) })).toBe('none')
    expect(kind({ onDown: effects({ style: 3, text: 40 }), persisted: effects({ style: 3, text: 40 }) })).toBe('content')
    // Undone by the release away: up reversal.
    expect(kind({ onDown: effects({ state: ['aria-pressed false → true'], dom: 1 }), persisted: effects() })).toBe('reversed')
    expect(kind({ onDown: effects(), persisted: effects() })).toBe('none')
    expect(kind({ outcome: 'not-exercised' })).toBe('none')
  })

  it('tells a drag that changed something from one that did not', () => {
    const state = () => ({ value: null as string | null, order: [] as string[], x: 0, y: 0, size: 0 })
    expect(dragChange('slider', { ...state(), value: '20' }, { ...state(), value: '50' })).toBe('value 20 → 50')
    expect(dragChange('slider', { ...state(), value: '20' }, { ...state(), value: '20' })).toBeUndefined()
    expect(dragChange('sortable', { ...state(), order: ['A', 'B', 'C'] }, { ...state(), order: ['B', 'A', 'C'] })).toBe('order of 3 items changed')
    expect(dragChange('sortable', { ...state(), order: ['A', 'B'] }, { ...state(), order: ['A', 'B'] })).toBeUndefined()
    expect(dragChange('splitter', { ...state(), value: null, size: 300 }, { ...state(), value: null, size: 360 })).toBe('pane resized by 60 px')
  })
})

// Recorded facts, no browser.

const sig = (tag: string, a: Record<string, string>) => [tag, a.id ?? '', a.role ?? '', a.type ?? '', a.name ?? '', a.href ?? ''].join('|')
const element = (id: string, tag: string, role: string, name: string, extra: Record<string, string> = {}): A11yNode => ({
  ref: `#${id}`,
  role,
  name,
  states: [],
  native: { tag, attributes: { id, ...extra } },
  children: [],
})
const described = (node: A11yNode) => ({ ref: node.ref, id: { tag: node.native.tag as string, sig: sig(node.native.tag as string, node.native.attributes as Record<string, string>) }, tag: node.native.tag as string, role: node.role, label: node.name ?? '' })

function pointerSnapshot(nodes: A11yNode[], data: Partial<PointerData>): A11ySnapshot {
  const full: PointerData = { viewport: { width: 1280, height: 800 }, found: 0, withDown: 0, presses: [], drags: [], gestures: [], listeners: true, loads: 1, actions: [], end: 'complete', ...data }
  const record: ProbeRecord = {
    kind: 'pointer',
    version: '1',
    conditions: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, browser: 'chromium 1 (headless)', variant: 'pointer' },
    status: 'complete',
    guard: { blocked: [], navigations: [], dialogs: [] },
    durationMs: 1,
    data: full,
  }
  return {
    schemaVersion: 1,
    surface: 'web',
    target: 'https://example.com/',
    title: 'Player',
    viewport: { width: 1280, height: 800, scale: 1 },
    root: { ref: 'html', role: 'document', states: [], native: { tag: 'html', attributes: {} }, children: [{ ref: 'html > body', role: 'generic', states: [], native: { tag: 'body', attributes: {} }, children: nodes }] },
    observations: { probes: [record] },
    collectedAt: new Date(0).toISOString(),
    collector: { name: 'rampa-web', version: '0' },
  }
}

describe('2.5.2, 2.5.7 and 2.5.1 over recorded facts', () => {
  const go = element('go', 'a', 'link', 'Next chapter', { href: '/next' })
  const star = element('star', 'button', 'button', 'Star', { type: 'button' })
  const once = element('once', 'button', 'button', 'Once', { type: 'button' })
  const menu = element('menu', 'button', 'button', 'Options', { type: 'button' })
  const peek = element('peek', 'span', 'button', 'Hold to peek', { role: 'button' })
  const vol = element('vol', 'div', 'slider', 'Volume', { role: 'slider' })
  const list = element('list', 'li', 'listitem', 'Task A')
  const steps = element('steps', 'li', 'listitem', 'Step 1')
  const split = element('split', 'div', 'separator', 'Resize', { role: 'separator' })
  const photos = element('photos', 'div', 'region', 'Photos', { role: 'region' })
  const gallery = element('gallery', 'div', 'region', 'Gallery', { role: 'region' })
  const nav = { kind: 'navigation', detail: 'https://example.com/next' }
  const pressed = effects({ state: ['aria-pressed false → true'] })
  const presses: PressCandidate[] = [
    { ...described(go), down: true, trial: { context: [nav], onDown: effects(), persisted: effects(), confirm: { context: [nav], onDown: effects(), persisted: effects() } } },
    { ...described(star), down: true, trial: { onDown: pressed, persisted: pressed, confirm: { onDown: pressed, persisted: pressed } } },
    { ...described(once), down: true, trial: { onDown: pressed, persisted: pressed, confirm: { onDown: effects(), persisted: effects() } } },
    { ...described(menu), down: true, trial: { onDown: effects({ state: ['aria-expanded false → true'] }), persisted: effects({ state: ['aria-expanded false → true'] }) } },
    { ...described(peek), down: true, trial: { onDown: effects({ dom: 1, text: 4 }), persisted: effects() } },
  ]
  const drags: DragCandidate[] = [
    { ...described(vol), kind: 'slider', trial: { moved: true, effect: 'value 20 → 50', alternatives: [{ kind: 'track', label: 'a click on the track', reproduced: false }] } },
    { ...described(list), kind: 'sortable', trial: { moved: true, effect: 'order of 3 items changed', alternatives: [] } },
    { ...described(steps), kind: 'sortable', trial: { moved: true, effect: 'order of 3 items changed', alternatives: [{ kind: 'button', label: 'Move Step 1 down', reproduced: true }] } },
    { ...described(split), kind: 'splitter', trial: { moved: true, effect: 'pane resized by 60 px', alternatives: [] } },
  ]
  const gestures: GestureCandidate[] = [
    { ...described(photos), kind: 'carousel', why: 'touch listeners', alternatives: [] },
    { ...described(gallery), kind: 'carousel', why: 'a swiper carousel, which swipes', alternatives: ['Previous slide', 'Next slide'] },
  ]
  const snapshot = pointerSnapshot([go, star, once, menu, peek, vol, list, steps, split, photos, gallery], { found: 5, withDown: 5, presses, drags, gestures })

  it('fails a change of context or a state committed on the press, when a second load does it again', async () => {
    const { verdicts, reversed } = pressVerdicts(snapshot.observations?.probes[0]?.data as PointerData, indexTree(snapshot.root))
    expect(verdicts.map((v) => `${v.node.ref} ${v.result} ${v.kind}${v.why ? ` ${v.why}` : ''}`)).toEqual(['#go failure context', '#star failure state', '#once review state once', '#menu review expanded judge'])
    expect(reversed).toBe(1)
    const report = await checkSnapshot(snapshot, emptyEngine(), probeCheckOptions())
    expect(byRule(report, CANCEL).map((f) => `${f.ref} ${f.confidence}`)).toEqual(['#go high', '#star medium'])
    expect(byRule(report, CANCEL)[0]?.message).toMatch(/^Pressing <a> "Next chapter" goes to another page \(https:\/\/example\.com\/next\) on the press itself \(the down-event\).*\(WCAG 2\.5\.2; F101\)/)
    expect(reviewByRule(report, CANCEL).map((r) => r.ref)).toEqual(['#once', '#menu'])
    expect(report.coverage.probes?.find((c) => c.criterion === '2.5.2')).toMatchObject({ method: 'probe/pointer@1', rule: CANCEL, status: 'failures', applicable: 5, failures: 2, review: 2 })
    const pt = await checkSnapshot(snapshot, emptyEngine(), probeCheckOptions({ locale: 'pt-BR' }))
    expect(byRule(pt, CANCEL)[1]?.message).toMatch(/^Pressionar <button> "Star" muda o controle no próprio pressionar \(aria-pressed false → true\)/)
  })

  it('fails a slider or a sorted list that only a drag changes, and leaves the rest to a person', async () => {
    const { verdicts } = dragVerdicts(snapshot.observations?.probes[0]?.data as PointerData, indexTree(snapshot.root))
    expect(verdicts.map((v) => `${v.node.ref} ${v.result} ${v.why}`)).toEqual(['#vol failure none-found', '#list failure none-found', '#steps pass alternative', '#split review kind'])
    const report = await checkSnapshot(snapshot, emptyEngine(), probeCheckOptions())
    expect(byRule(report, DRAG).map((f) => f.ref)).toEqual(['#vol', '#list'])
    expect(byRule(report, DRAG)[0]?.message).toMatch(/a click on its track changed nothing.*Arrow keys serve the keyboard, not a pointer\./)
    expect(reviewByRule(report, DRAG).map((r) => r.ref)).toEqual(['#split'])
    expect(report.coverage.probes?.find((c) => c.criterion === '2.5.7')?.note).toContain('with a single-pointer alternative: <li> "Step 1" (Move Step 1 down)')
    // 2.5.7 is new in WCAG 2.2: beyond the target under 2.1.
    const old = await checkSnapshot(snapshot, emptyEngine(), probeCheckOptions({ wcag: '2.1' }))
    expect((old.beyondTarget ?? []).filter((f) => f.ruleId === DRAG).map((f) => f.ref)).toEqual(['#vol', '#list'])
  })

  it('lists what reacts to gestures for review, never as a failure', async () => {
    const report = await checkSnapshot(snapshot, emptyEngine(), probeCheckOptions())
    expect(byRule(report, GESTURE)).toEqual([])
    const review = reviewByRule(report, GESTURE)
    expect(review.map((r) => r.ref)).toEqual(['#photos', '#gallery'])
    expect(review[0]?.message).toContain('Rampa found no previous, next or zoom control around it')
    expect(review[1]?.message).toContain('Controls around it may do the same with single clicks ("Previous slide", "Next slide")')
    expect(report.coverage.criteria?.find((c) => c.id === '2.5.1')?.status).toBe('needs-review')
  })
})

// Integration: needs Chrome or Edge, and the fixtures over HTTP. Skipped, with the reason on stderr, when no browser starts.
const browser = await launchBrowser({ args: DETERMINISM_ARGS }).catch((error: unknown) => {
  process.stderr.write(`\nSkipping the pointer probe tests: no browser started (${error instanceof Error ? error.message.split('\n')[0] : String(error)}).\n`)
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
    result = collectWeb(browser, `${servers.origin}/${name}`, { runAxe: false, locale: 'en', probes: ['pointer'] })
    collected.set(name, result)
  }
  return result
}

const recordOf = (snapshot: A11ySnapshot) => snapshot.observations?.probes.find((p) => p.kind === 'pointer')
const dataOf = (snapshot: A11ySnapshot) => recordOf(snapshot)?.data as PointerData

describe.skipIf(!browser)('pointer probe (2.5.2, 2.5.7, 2.5.1)', { timeout: 400_000 }, () => {
  it('presses each control, moves away and releases, and fails what commits on the press', async () => {
    const { snapshot, engine } = await probed('pointer-press-fail.html')
    expect(A11ySnapshotSchema.safeParse(snapshot).success).toBe(true)
    expect(recordOf(snapshot)).toMatchObject({ kind: 'pointer', version: '1', status: 'complete', conditions: { variant: 'pointer' } })
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    expect(byRule(report, CANCEL).map((f) => `${f.ref} ${f.confidence}`)).toEqual(['#go high', '#help high', '#star medium'])
    expect(reviewByRule(report, CANCEL).map((r) => r.ref)).toEqual(['#add-row', '#options'])
    // The navigation was intercepted and the window never opened: the server never saw either address.
    expect((servers?.requests ?? []).filter((r) => r.includes('/pointer/'))).toEqual([])
    const origin = servers?.origin ?? ''
    expect([...new Set(recordOf(snapshot)?.guard.navigations.map((n) => `${n.cause} ${n.url}`))]).toEqual([`intercepted ${origin}/pointer/next.html`])
    // The clock that ticks on its own is never credited to a press.
    expect(dataOf(snapshot).presses.find((p) => p.ref === '#star')?.trial?.persisted?.samples).toEqual([])
  })

  it('finds no failure where controls act on the release, undo on the release, or only give feedback', async () => {
    const { snapshot, engine } = await probed('pointer-press-pass.html')
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    expect([...byRule(report, CANCEL), ...reviewByRule(report, CANCEL)]).toEqual([])
    const { applicable, reversed } = pressVerdicts(dataOf(snapshot), indexTree(snapshot.root))
    expect({ applicable, reversed }).toEqual({ applicable: 6, reversed: 1 })
    expect(report.coverage.probes?.find((c) => c.criterion === '2.5.2')).toMatchObject({ status: 'no-failure-found', applicable: 6 })
  })

  it('reports nothing for near misses: an address rewritten on the press, a pressed look, a menu closed by the release, a drag that does nothing', async () => {
    const { snapshot, engine } = await probed('pointer-near.html')
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    expect([...byRule(report, CANCEL), ...reviewByRule(report, CANCEL), ...byRule(report, DRAG), ...reviewByRule(report, DRAG), ...reviewByRule(report, GESTURE)]).toEqual([])
    const data = dataOf(snapshot)
    // Native controls and sortable table headers are not drag widgets; the shelf's books are, and do not move.
    expect(data.drags.map((d) => `${d.ref} ${d.kind} ${d.trial?.moved}`)).toEqual(['#book-1 sortable false'])
    expect(data.presses.map((p) => p.ref)).not.toContain('#shelf')
    expect(pressVerdicts(data, indexTree(snapshot.root)).reversed).toBe(1)
    expect(report.coverage.probes?.find((c) => c.criterion === '2.5.7')).toMatchObject({ status: 'not-checked' })
  })

  it('drags sliders and sorted lists, and fails those no click or typing can change', async () => {
    const { snapshot, engine } = await probed('pointer-drag-fail.html')
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    expect(byRule(report, DRAG).map((f) => f.ref)).toEqual(['#vol', '#tasks > li:nth-of-type(1)', '#queue > li:nth-of-type(1) > div'])
    expect(byRule(report, DRAG)[0]?.evidence).toBe('dragged: value 20 → 50; tried: a click on the track (no change)')
    expect(reviewByRule(report, GESTURE).map((r) => r.ref)).toEqual(['#photos'])
    // The Remove buttons in the list are never pressed.
    expect(dataOf(snapshot).actions.filter((a) => a.action === 'activate' && /remove/i.test(a.label ?? ''))).toEqual([])
  })

  it('finds the single-pointer way next to each drag: buttons, a click on the track, a select', async () => {
    const { snapshot, engine } = await probed('pointer-drag-pass.html')
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    expect([...byRule(report, DRAG), ...reviewByRule(report, DRAG)]).toEqual([])
    const found = dataOf(snapshot).drags.map((d) => `${d.ref} ${d.trial?.alternatives?.find((a) => a.reproduced)?.label ?? 'none'}`)
    expect(found).toEqual(['#vol Decrease volume', '#bal a click on the track', '#steps > li:nth-of-type(1) Move Preheat the oven down', '#todo > li:nth-of-type(1) Move to column'])
    // The native range input is the browser's own, never a candidate.
    expect(dataOf(snapshot).drags.map((d) => d.ref)).not.toContain('#speed')
    expect(reviewByRule(report, GESTURE)[0]?.message).toContain('("Previous photo", "Next photo")')
  })

  it('replays a saved snapshot offline to the same findings', async () => {
    const { snapshot, engine } = await probed('pointer-press-fail.html')
    const live = await checkSnapshot(snapshot, engine, probeCheckOptions())
    const dir = await mkdtemp(join(tmpdir(), 'rampa-pointer-'))
    const path = join(dir, 'pointer.snapshot.json')
    await writeFile(path, JSON.stringify(snapshot), 'utf8')
    await writeFile(join(dir, 'pointer.engine.json'), JSON.stringify(engine), 'utf8')
    const loaded = await loadRecorded(path, 'en')
    const replayed = await checkSnapshot(loaded.snapshot, loaded.engine, probeCheckOptions())
    const key = (report: Report) => report.findings.map((f) => `${f.fingerprint} ${f.evidence}`)
    expect(key(replayed)).toEqual(key(live))
    expect(replayed.coverage.probes).toEqual(live.coverage.probes)
  })
})
