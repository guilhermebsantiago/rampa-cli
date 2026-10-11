import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { checkSnapshot } from '../src/core/check.ts'
import type { EngineResults, Report } from '../src/core/types.ts'
import { timingAdjustable, timingJudgments } from '../src/criteria/timing-adjustable.ts'
import { emptyEngine } from '../src/engine/axe.ts'
import { type MotionFrame, lastsLonger, motionRegions } from '../src/pixels/motion.ts'
import { snapshotSignature } from '../src/probes/identity.ts'
import type { InPageElement } from '../src/probes/kit.ts'
import type { MotionControl, MotionData, MotionItem } from '../src/probes/motion.ts'
import { DETERMINISM_ARGS, parseProbeKinds } from '../src/probes/run.ts'
import type { TimeData, TimeEvent, TimeWarning } from '../src/probes/time-limits.ts'
import type { JudgeRequest, ModelProvider } from '../src/providers/types.ts'
import { paint } from '../src/report/color.ts'
import { renderReport } from '../src/report/pretty.ts'
import { resolveProbeRules } from '../src/cli/commands/eval-rules.ts'
import { A11ySnapshotSchema, type A11yNode, type A11ySnapshot, type ProbeRecord } from '../src/snapshot/schema.ts'
import { loadRecorded } from '../src/surfaces/targets.ts'
import { type Collected, collectWeb, launchBrowser } from '../src/surfaces/web.ts'
import { startFixtureServers } from './media-server.ts'
import { byRule, probeCheckOptions, reviewByRule } from './probe-helpers.ts'

const MOTION_RULE = 'rampa/pause-stop-hide'
const TIME_RULE = 'rampa/timing-adjustable'

// ---- the pixel analysis -------------------------------------------------------------------------------------------

/** Frames of `cols` × `rows` cells every `step` ms for `ms`; `paint(x, y, t)` gives each cell's gray. */
function frames(cols: number, rows: number, ms: number, paint: (x: number, y: number, t: number) => number, step = 230): MotionFrame[] {
  const out: MotionFrame[] = []
  for (let t = 0; t <= ms; t += step) {
    const rgb = new Uint8Array(cols * rows * 3)
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) rgb.fill(paint(x, y, t), (y * cols + x) * 3, (y * cols + x) * 3 + 3)
    out.push({ t, rgb })
  }
  return out
}

describe('motion in a series of window captures', () => {
  const grid = { cols: 60, rows: 30, cell: 4 }

  it('finds a ticker that moves the whole time as one region that lasts', () => {
    // A bright bar that slides one cell to the right every frame, on row 10.
    const series = frames(60, 30, 10_000, (x, y, t) => (y >= 10 && y < 13 && x === Math.floor(t / 230) % 60 ? 0 : 255))
    const [ticker, ...rest] = motionRegions(grid, series)
    expect(rest).toEqual([])
    expect(ticker).toMatchObject({ box: { x: 0, y: 40, width: 176, height: 12 }, episodes: 1, firstMs: 230 })
    expect(ticker?.lastMs).toBeGreaterThan(9800)
    expect(lastsLonger(ticker as NonNullable<typeof ticker>, 230)).toBe(true)
  })

  it('tells a carousel that turns every 3 s from an image that loads late and an entrance that ends', () => {
    const carousel = frames(60, 30, 10_000, (x, y, t) => (x < 20 && y < 10 ? (Math.floor(t / 3000) % 2 === 0 ? 40 : 200) : 255))
    const [turning] = motionRegions(grid, carousel)
    expect(turning).toMatchObject({ episodes: 3, starts: [3220, 6210, 9200] })
    expect(lastsLonger(turning as NonNullable<typeof turning>, 230)).toBe(true)
    // Once, at 6 s: no motion that lasts.
    const late = frames(60, 30, 10_000, (x, y, t) => (x < 20 && y < 10 && t >= 6000 ? 40 : 255))
    expect(motionRegions(grid, late).map((r) => lastsLonger(r, 230))).toEqual([false])
    // Two seconds of fading in: it ends before five seconds.
    const entrance = frames(60, 30, 10_000, (x, y, t) => (x < 20 && y < 10 ? Math.min(255, Math.round((t / 2000) * 255)) : 255))
    expect(motionRegions(grid, entrance).map((r) => lastsLonger(r, 230))).toEqual([false])
  })

  it('joins cells close to each other, leaves tiny changes and masked media out', () => {
    // Two blinking squares with 1 cell between them are one region; one 6 cells away is another; a single cell is left out.
    const blink = (on: boolean) => (on ? 0 : 255)
    const series = frames(60, 30, 6000, (x, y, t) => {
      const on = Math.floor(t / 500) % 2 === 0
      if (y < 4 && ((x >= 0 && x < 4) || (x >= 5 && x < 9))) return blink(on)
      if (y < 4 && x >= 16 && x < 20) return blink(on)
      if (x === 50 && y === 20) return blink(on)
      return 255
    })
    expect(motionRegions(grid, series).map((r) => `${r.box.x}+${r.box.width}`)).toEqual(['0+36', '64+16'])
    const mask = new Uint8Array(60 * 30).fill(1)
    expect(motionRegions({ ...grid, mask }, series)).toEqual([])
  })
})

describe('the motion probe kind', () => {
  it('runs only when named, never with all or interact', () => {
    expect(parseProbeKinds('motion')).toEqual(['motion'])
    expect(parseProbeKinds('all')).not.toContain('motion')
    expect(parseProbeKinds('interact')).not.toContain('motion')
    expect(parseProbeKinds('all,motion')).toContain('motion')
  })

  it('lists its ACT rules, so rampa eval --rules runs the probe on their test cases', () => {
    expect(resolveProbeRules(['pause-stop-hide', 'rampa/timing-adjustable', 'reflow']).map((r) => `${r.id} ${r.act?.join(',')}`)).toEqual([
      'rampa/pause-stop-hide efbfc7',
      'rampa/timing-adjustable bc659a',
    ])
  })
})

// ---- 2.2.2 over recorded facts ------------------------------------------------------------------------------------

const node = (ref: string, tag: string, attributes: Record<string, string> = {}, name = ''): A11yNode => ({ ref, role: 'generic', name, states: [], native: { tag, attributes }, children: [] })
const el = (n: A11yNode, label = ''): InPageElement => ({ ref: n.ref, id: { tag: String(n.native.tag), sig: snapshotSignature(n) }, tag: String(n.native.tag), role: n.role, label })

const TICKER = node('#ticker', 'div', { id: 'ticker' })
const ONLINE = node('#online', 'span', { id: 'online' })
const NEWS = node('#news', 'section', { id: 'news' })
const BADGE = node('#live', 'span', { id: 'live' })
const CLIP = node('#clip', 'video', { id: 'clip' })
const MARQUEE = node('#scroll', 'marquee', { id: 'scroll' })
const PAUSE = node('#pause', 'button', { id: 'pause' }, 'Pause')

function item(key: string, n: A11yNode, extra: Partial<MotionItem>): MotionItem {
  return { key, el: el(n), box: { x: 0, y: 0, width: 600, height: 40 }, kinds: ['animation'], lastsMs: -1, parallel: true, controls: [], confirmed: true, ...extra }
}
const control = (key: string, extra: Partial<MotionControl> = {}): MotionControl => ({ key, el: el(PAUSE, 'Pause'), name: 'Pause', kind: 'pause', word: 'pause', shows: true, near: [{ item: 'm0', how: 'container', distance: 0 }], ...extra })

function motionSnapshot(items: MotionItem[], controls: MotionControl[] = []): A11ySnapshot {
  const data: MotionData = {
    viewport: { width: 1280, height: 800 },
    stepMs: 230,
    seriesMs: 10_000,
    extendedMs: 130_000,
    scenes: [{ y: 0, frames: 69, spanMs: 130_000 }],
    found: { animations: 1, short: 0, smil: 0, videos: 0, images: 0, animated: 0, unread: 0, canvases: 0, marquees: 0, texts: 1, alone: 0, regions: 2, lasting: 2, brief: 0, below: 0, tracked: 40 },
    items,
    controls,
    loads: 2,
    actions: [],
    end: 'complete',
  }
  const record: ProbeRecord = {
    kind: 'motion',
    version: '1',
    conditions: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, browser: 'chromium 1 (headless)', variant: 'motion' },
    status: 'complete',
    guard: { blocked: [], navigations: [], dialogs: [] },
    durationMs: 1,
    data,
  }
  return snapshotOf([TICKER, ONLINE, NEWS, BADGE, CLIP, MARQUEE, PAUSE], [record])
}

function snapshotOf(children: A11yNode[], probes: ProbeRecord[], extra: Partial<A11ySnapshot['root']['native']> = {}): A11ySnapshot {
  const body: A11yNode = { ref: 'html > body', role: 'generic', states: [], native: { tag: 'body', attributes: {} }, children }
  return {
    schemaVersion: 1,
    surface: 'web',
    target: 'https://example.com/',
    title: 'News',
    viewport: { width: 1280, height: 800, scale: 1 },
    root: { ref: 'html', role: 'document', states: [], native: { tag: 'html', attributes: {}, ...extra }, children: [body] },
    observations: { probes },
    collectedAt: new Date(0).toISOString(),
    collector: { name: 'rampa-web', version: '0' },
  }
}

const check = (snapshot: A11ySnapshot, locale: 'en' | 'pt-BR' = 'en', engine: EngineResults = emptyEngine()) => checkSnapshot(snapshot, engine, probeCheckOptions({ locale }))

describe('2.2.2 over recorded motion', () => {
  const ticker = item('m0', TICKER, { animation: { names: ['scroll'], properties: ['transform'], infinite: true, endMs: -1, count: 1, colorOnly: false } })
  const online = item('m1', ONLINE, { kinds: ['text'], text: { ref: '#online', changes: 31, firstMs: 230, lastMs: 130_000, intervalMs: 1500, values: ['120', '853', '2'] }, lastsMs: 129_770 })

  it('fails what moves or updates with no control near it, confirmed on a second load', async () => {
    const report = await check(motionSnapshot([ticker, online]))
    const findings = byRule(report, MOTION_RULE)
    expect(findings.map((f) => `${f.ref} ${f.confidence}`)).toEqual(['#ticker high', '#online high'])
    expect(findings[0]).toMatchObject({ criterion: '2.2.2', source: 'probe', experimental: true })
    expect(findings[0]?.message).toMatch(/^This animation \(scroll\) moves by itself for more than 5 seconds next to other content, and the page has no control near it to pause, stop or hide it \(WCAG 2\.2\.2\)\./)
    expect(findings[1]?.message).toMatch(/^Text that updates by itself \("120", "853", "2"…\) updates by itself next to other content, .* \(WCAG 2\.2\.2; ACT efbfc7\)/)
    expect(findings[1]?.evidence).toBe('its text changed 31 times with no input, from 0.2 s to 130.0 s of the page\'s time, about every 1.5 s: "120", "853", "2"; no control near it named to pause, stop or hide it; it moved again on a second fresh load')
    expect(report.coverage.probes?.find((c) => c.rule === MOTION_RULE)).toMatchObject({ method: 'probe/motion@1', status: 'failures', applicable: 2, failures: 2 })
    expect(report.coverage.criteria?.find((c) => c.id === '2.2.2')?.status).toBe('failures')
    const pt = await check(motionSnapshot([ticker]), 'pt-BR')
    expect(byRule(pt, MOTION_RULE)[0]?.message).toMatch(/^Esta animação \(scroll\) se move sozinho por mais de 5 segundos/)
  })

  it('passes what a control stopped and a video with its own controls, never as a pass', async () => {
    const stopped = { ...ticker, controls: ['c0'], stoppedBy: 'c0' }
    const video = item('m1', CLIP, { kinds: ['video'], video: { url: 'https://example.com/v.webm', durationMs: 6000, loop: true, muted: true, controls: true, autoplay: true }, nativeControls: true })
    const report = await check(motionSnapshot([stopped, video], [control('c0', { trial: { outcome: 'tried', results: [{ item: 'm0', before: 'moving', after: 'stopped' }] } })]))
    expect(byRule(report, MOTION_RULE)).toEqual([])
    expect(reviewByRule(report, MOTION_RULE)).toEqual([])
    const row = report.coverage.probes?.find((c) => c.rule === MOTION_RULE)
    expect(row).toMatchObject({ status: 'no-failure-found', applicable: 2 })
    expect(row?.note).toContain('stopped or hidden by a control the probe pressed: <button> "Pause"')
    expect(row?.note).toContain("1 video(s) with the browser's own controls")
  })

  it('fails with medium confidence when the control pressed did not stop it', async () => {
    const kept = { ...ticker, controls: ['c0'] }
    const report = await check(motionSnapshot([kept], [control('c0', { trial: { outcome: 'tried', results: [{ item: 'm0', before: 'moving', after: 'moving' }] } })]))
    const [finding] = byRule(report, MOTION_RULE)
    expect(finding?.confidence).toBe('medium')
    expect(finding?.message).toContain('the page\'s <button> "Pause" did not stop or hide it: pressed on a fresh load, it kept moving')
  })

  it('sends to review what it could not decide', async () => {
    const covered = { ...ticker, controls: ['c0'] }
    const colors = item('m1', BADGE, { animation: { names: ['glow'], properties: ['backgroundColor'], infinite: true, endMs: -1, count: 1, colorOnly: true } })
    const once = { ...online, key: 'm2', confirmed: false }
    const frequency = item('m3', NEWS, { kinds: ['text'], text: { ref: '#news', changes: 5, firstMs: 2000, lastMs: 10_000, intervalMs: 2000, values: ['1'] }, controls: ['c1'] })
    const report = await check(
      motionSnapshot(
        [covered, colors, once, frequency],
        [
          control('c0', { trial: { outcome: 'not-exercised', reason: 'under another layer', cover: { ...el(NEWS), text: 'We use cookies' } } }),
          control('c1', { name: 'Change frequency', kind: 'frequency', word: 'frequency', near: [{ item: 'm3', how: 'distance', distance: 20 }] }),
        ],
      ),
    )
    expect(byRule(report, MOTION_RULE)).toEqual([])
    const review = reviewByRule(report, MOTION_RULE)
    expect(review.map((r) => r.ref)).toEqual(['#ticker', '#live', '#online', '#news'])
    expect(review[0]?.message).toContain('Rampa did not press them: <button> "Pause" (under <section> "We use cookies")')
    expect(review[1]?.message).toContain('only changes colors')
    expect(review[2]?.message).toContain('on one load, but not on a second one with no input')
    expect(review[3]?.message).toContain('<button> "Change frequency" may set how often it changes')
    expect(report.coverage.probes?.find((c) => c.rule === MOTION_RULE)?.status).toBe('needs-review')
  })

  it('leaves content alone on the page out, and a marquee axe-core already failed to axe-core', async () => {
    const alone = { ...online, parallel: false }
    const marquee = item('m2', MARQUEE, { kinds: ['marquee'] })
    const engine: EngineResults = { ...emptyEngine(), rules: [{ ruleId: 'marquee', outcome: 'violation', impact: 'serious', criteria: ['2.2.2'], help: 'marquee', helpUrl: '', nodes: [{ target: '#scroll', ref: '#scroll', html: '<marquee>' }] }] } as unknown as EngineResults
    const report = await check(motionSnapshot([alone, marquee]), 'en', engine)
    expect(byRule(report, MOTION_RULE)).toEqual([])
    expect(report.coverage.probes?.find((c) => c.rule === MOTION_RULE)?.note).toMatch(/1 not shown next to other content \(not applicable\); 1 left to axe-core \(marquee, blink\)/)
  })

  it('prints its coverage line', async () => {
    const report = await check(motionSnapshot([ticker]))
    expect(renderReport(report, { verbose: true, paint: paint(false) })).toMatch(/2\.2\.2 +probe\/motion@1 \(rampa\/pause-stop-hide\) · the window over 10\.0 s of the page's time and its top over 130\.0 s/)
  })
})

// ---- 2.2.1 over recorded facts ------------------------------------------------------------------------------------

const STAY = node('#stay', 'button', { id: 'stay' }, 'Stay signed in')
const DIALOG = node('#warn', 'div', { id: 'warn', role: 'alertdialog' })
const SAVED = node('#saved', 'p', { id: 'saved', role: 'status' })

const leave = (at: number, from: number, extra: Partial<TimeEvent> = {}): TimeEvent => ({ kind: 'navigation', at, from, url: 'https://example.com/expired', blocked: 0, ...extra })
const warning = (at: number, extra: Partial<TimeWarning> = {}): TimeWarning => ({
  at,
  from: at - 5000,
  kind: 'layer',
  text: 'Your session is about to expire. You will be signed out in 2 minutes. Stay signed in',
  el: el(DIALOG),
  controls: [{ el: el(STAY, 'Stay signed in'), name: 'Stay signed in', extend: true }],
  ...extra,
})

function timeSnapshot(data: Partial<TimeData>, root: Partial<A11ySnapshot['root']['native']> = {}): A11ySnapshot {
  const full: TimeData = {
    viewport: { width: 1280, height: 800 },
    checkpoints: [10_000, 30_000, 60_000],
    reachedMs: 72_000_000,
    events: [],
    warnings: [],
    countdowns: [],
    notices: [],
    requests: { allowed: 0, blocked: 0 },
    loads: 2,
    actions: [],
    end: 'complete',
    ...data,
  }
  const record: ProbeRecord = {
    kind: 'motion',
    version: '1',
    conditions: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, browser: 'chromium 1 (headless)', variant: 'time-limits' },
    status: 'complete',
    guard: { blocked: [], navigations: [], dialogs: [] },
    durationMs: 1,
    data: full,
  }
  return snapshotOf([DIALOG, STAY, SAVED], [record], root)
}

const confirmed = (eventAt: number, extra: Partial<NonNullable<TimeData['refine']>> = {}): NonNullable<TimeData['refine']> => ({ from: eventAt - 180_000, to: eventAt, stepMs: 5000, eventAt, eventKind: 'navigation', confirmed: true, ...extra })

describe('2.2.1 over recorded time', () => {
  it('fails a page that leaves after 15 minutes with no warning, confirmed on a second load', async () => {
    const report = await check(timeSnapshot({ events: [leave(900_000, 720_000)], refine: confirmed(900_000) }))
    const [finding, ...rest] = byRule(report, TIME_RULE)
    expect(rest).toEqual([])
    expect(finding).toMatchObject({ criterion: '2.2.1', ref: 'html > body', confidence: 'high', source: 'probe' })
    expect(finding?.message).toMatch(/^After 15 min with no input, the page goes to https:\/\/example\.com\/expired, and nothing warned of it before: a time limit people cannot turn off, adjust or extend \(WCAG 2\.2\.1\)\./)
    expect(finding?.evidence).toBe("between 12 min and 15 min of the page's time with no input, it goes to https://example.com/expired; again on a second fresh load, at 15 min (checked every 5 s)")
    expect(report.coverage.probes?.find((c) => c.rule === TIME_RULE)).toMatchObject({ status: 'failures', applicable: 1 })
    const pt = await check(timeSnapshot({ events: [leave(900_000, 720_000)], refine: confirmed(900_000) }), 'pt-BR')
    expect(byRule(pt, TIME_RULE)[0]?.message).toMatch(/^Depois de 15 min sem entrada, a página vai para https:\/\/example\.com\/expired, e nada avisou antes/)
  })

  it('finds no failure when the warning came in time and its control extended the time', async () => {
    const extended = { control: { el: el(STAY), name: 'Stay signed in', extend: true }, outcome: 'extended' as const, pressedAt: 780_000, watchedTo: 1_020_000, blocked: 0 }
    const report = await check(timeSnapshot({ events: [leave(900_000, 720_000)], warnings: [warning(780_000)], refine: confirmed(900_000, { warningAt: 780_000 }), extension: extended }))
    expect(byRule(report, TIME_RULE)).toEqual([])
    expect(report.coverage.probes?.find((c) => c.rule === TIME_RULE)?.note).toContain('a warning came 2 min before it, and its "Stay signed in" extended the time once')
  })

  it('fails a warning with no way to extend, one whose control did not extend, and one that came too late', async () => {
    const ok = { control: { el: el(STAY), name: 'OK', extend: false }, outcome: 'not-extended' as const, pressedAt: 480_000, eventAt: 600_000, blocked: 0 }
    const none = await check(timeSnapshot({ events: [leave(600_000, 420_000)], warnings: [warning(480_000)], refine: confirmed(600_000, { warningAt: 480_000 }), extension: ok }))
    expect(byRule(none, TIME_RULE).map((f) => f.confidence)).toEqual(['high'])
    expect(byRule(none, TIME_RULE)[0]?.message).toContain('with no control to ask for more time (its "OK", pressed on a fresh load, did not extend it)')
    const stay = { ...ok, control: { el: el(STAY), name: 'Stay signed in', extend: true } }
    const broken = await check(timeSnapshot({ events: [leave(600_000, 420_000)], warnings: [warning(480_000)], refine: confirmed(600_000, { warningAt: 480_000 }), extension: stay }))
    expect(byRule(broken, TIME_RULE)[0]).toMatchObject({ confidence: 'medium' })
    expect(byRule(broken, TIME_RULE)[0]?.message).toContain('Its warning\'s "Stay signed in" was pressed on a fresh load, and the page still did so at 10 min')
    const late = await check(
      timeSnapshot({ events: [leave(600_000, 420_000)], warnings: [warning(590_000)], refine: confirmed(600_000, { warningAt: 590_000 }), extension: { ...stay, outcome: 'extended' } }),
    )
    expect(byRule(late, TIME_RULE)[0]?.message).toContain('its warning came only 10 s before, and WCAG 2.2.1 asks for at least 20 seconds')
  })

  it('sends to review what may be the guard’s doing, what happened once, a press it could not make, and text that went away', async () => {
    const blocked = await check(timeSnapshot({ events: [leave(3_600_000, 3_000_000, { blocked: 2 })], refine: confirmed(3_600_000) }))
    expect(reviewByRule(blocked, TIME_RULE).map((r) => r.message.slice(0, 44))).toEqual(['After 60 min with no input, the page goes to'])
    expect(reviewByRule(blocked, TIME_RULE)[0]?.message).toContain('right after a request the probe refused')
    const once = await check(timeSnapshot({ events: [leave(3_600_000, 3_000_000)], refine: confirmed(3_600_000, { confirmed: false }) }))
    expect(reviewByRule(once, TIME_RULE)[0]?.message).toContain('on one load but not again on a second one')
    const covered = { control: { el: el(STAY), name: 'Stay signed in', extend: true }, outcome: 'not-exercised' as const, reason: 'under another layer', blocked: 0 }
    const untried = await check(timeSnapshot({ events: [leave(600_000, 420_000)], warnings: [warning(480_000)], refine: confirmed(600_000, { warningAt: 480_000 }), extension: covered }))
    expect(byRule(untried, TIME_RULE)).toEqual([])
    expect(reviewByRule(untried, TIME_RULE)[0]?.message).toContain('which Rampa did not press (under another layer)')
    const removed = await check(timeSnapshot({ events: [{ kind: 'removed', at: 10_000, from: 0, el: el(SAVED), text: 'Your draft was saved a moment ago.', blocked: 0 }] }))
    expect(reviewByRule(removed, TIME_RULE).map((r) => `${r.ref} ${r.message.slice(0, 40)}`)).toEqual(['#saved This text went away by itself after 10 s'])
    expect(removed.coverage.probes?.find((c) => c.rule === TIME_RULE)?.status).toBe('needs-review')
  })

  it('leaves a meta refresh to axe-core and the Refresh header to its rule, and says when nothing happened', async () => {
    const meta = await check(timeSnapshot({ events: [{ kind: 'meta', at: 30_000, from: 10_000, url: 'https://example.com/', blocked: 0 }] }))
    expect(byRule(meta, TIME_RULE)).toEqual([])
    expect(meta.coverage.probes?.find((c) => c.rule === TIME_RULE)?.note).toContain('a meta refresh is axe-core’s (meta-refresh)')
    const header = await check(timeSnapshot({ events: [leave(30_000, 10_000, { kind: 'reload' })], refine: confirmed(30_000) }, { httpRefresh: '30' }))
    expect(byRule(header, TIME_RULE)).toEqual([])
    const quiet = await check(timeSnapshot({}))
    expect(quiet.coverage.probes?.find((c) => c.rule === TIME_RULE)).toMatchObject({ status: 'no-failure-found', applicable: 0 })
    expect(quiet.coverage.probes?.find((c) => c.rule === TIME_RULE)?.note).toContain("no time limit seen with no input up to 20 h of the page's time")
    expect(quiet.coverage.criteria?.find((c) => c.id === '2.2.1')?.status).toBe('no-applicable-content')
  })
})

/** A model that answers the 2.2.1 question, and keeps the prompts. */
function exceptions(answer: Record<string, unknown>): ModelProvider & { asked: string[] } {
  const asked: string[] = []
  return {
    id: 'stub:timing',
    asked,
    async judge<T>(request: JudgeRequest<T>) {
      asked.push(request.user)
      return { output: request.schema.parse(answer), inputTokens: 100, outputTokens: 20, latencyMs: 1, modelId: 'stub' }
    },
  }
}

describe('2.2.1 exceptions: the model may only clear', () => {
  const exam = timeSnapshot({
    events: [{ kind: 'submit', at: 600_000, from: 420_000, url: 'https://example.com/results', blocked: 0 }],
    refine: confirmed(600_000, { eventKind: 'submit' }),
    countdowns: ['Time left: 10:00'],
    notices: ['This is a timed test: you have 10 minutes to answer every question.'],
  })

  it('is asked only for a failure, with the page’s words about time', async () => {
    expect(timingJudgments(exam)).toEqual([timingAdjustable])
    expect(timingJudgments(timeSnapshot({}))).toEqual([])
    const off = await check(exam)
    expect(byRule(off, TIME_RULE)).toHaveLength(1)
  })

  it('clears a timed test when it quotes the page, and keeps the finding otherwise', async () => {
    const model = exceptions({ verdict: 'pass', exception: 'essential', evidence: 'This is a timed test: you have 10 minutes to answer every question.', confidence: 'high' })
    const report = await checkSnapshot(exam, emptyEngine(), probeCheckOptions({ llm: true, provider: model }))
    expect(model.asked).toHaveLength(1)
    expect(model.asked[0]).toContain('What happened: after 10 min with no input, the page submits a form to https://example.com/results')
    expect(model.asked[0]).toContain('- "Time left: 10:00"')
    expect(byRule(report, TIME_RULE)).toEqual([])
    expect(report.coverage.probes?.find((c) => c.rule === TIME_RULE)?.note).toContain('finding cleared by the model, which reads an essential time limit: "This is a timed test')
    const kept = await checkSnapshot(exam, emptyEngine(), probeCheckOptions({ llm: true, provider: exceptions({ verdict: 'fail', exception: 'none', evidence: '', confidence: 'high' }) }))
    expect(byRule(kept, TIME_RULE)[0]?.evidence).toMatch(/the model found no text that shows an exception or a way to turn off, adjust or extend the time$/)
  })

  it('discards a pass that quotes nothing the page shows, or names no exception', async () => {
    const invented = await checkSnapshot(exam, emptyEngine(), probeCheckOptions({ llm: true, provider: exceptions({ verdict: 'pass', exception: 'essential', evidence: 'The exam is timed by law.', confidence: 'high' }) }))
    expect(invented.discarded).toEqual([expect.objectContaining({ criterion: '2.2.1', reason: 'evidence is not text the page shows' })])
    expect(byRule(invented, TIME_RULE)).toHaveLength(1)
    const unnamed = await checkSnapshot(exam, emptyEngine(), probeCheckOptions({ llm: true, provider: exceptions({ verdict: 'pass', exception: 'none', evidence: 'This is a timed test: you have 10 minutes to answer every question.', confidence: 'high' }) }))
    expect(unnamed.discarded).toEqual([expect.objectContaining({ reason: 'a pass must name the exception or option' })])
  })
})

// ---- the probe, on the fixtures -----------------------------------------------------------------------------------

// Integration: needs Chrome or Edge, and the fixtures over HTTP. Skipped, with the reason on stderr, when no browser starts.
const browser = await launchBrowser({ args: DETERMINISM_ARGS }).catch((error: unknown) => {
  process.stderr.write(`\nSkipping the motion probe tests: no browser started (${error instanceof Error ? error.message.split('\n')[0] : String(error)}).\n`)
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
    result = collectWeb(browser, `${servers.origin}/${name}`, { runAxe: false, locale: 'en', probes: ['motion'] })
    collected.set(name, result)
  }
  return result
}
const recordOf = (snapshot: A11ySnapshot, variant: string) => snapshot.observations?.probes.find((p) => p.kind === 'motion' && p.conditions.variant === variant)
const motionOf = (snapshot: A11ySnapshot) => recordOf(snapshot, 'motion')?.data as MotionData
const timeOf = (snapshot: A11ySnapshot) => recordOf(snapshot, 'time-limits')?.data as TimeData

describe.skipIf(!browser)('motion probe (2.2.2)', { timeout: 400_000 }, () => {
  it('fails a carousel, a ticker and a counter with no way to stop them', async () => {
    const { snapshot, engine } = await probed('motion-fail.html')
    expect(A11ySnapshotSchema.safeParse(snapshot).success).toBe(true)
    expect(recordOf(snapshot, 'motion')).toMatchObject({ kind: 'motion', version: '1', status: 'complete' })
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    // The carousel is named by the element about its size around it: its frame, or the section when fonts make it tight.
    expect(byRule(report, MOTION_RULE).map((f) => `${f.ref?.startsWith('#news') ? '#news' : f.ref} ${f.confidence}`).sort()).toEqual(['#news medium', '#online high', '#ticker > span high'])
    expect(reviewByRule(report, MOTION_RULE)).toEqual([])
    const data = motionOf(snapshot)
    expect(data.items.find((i) => i.el.ref === '#online')?.text?.intervalMs).toBeGreaterThanOrEqual(1300)
    expect(data.items.find((i) => i.el.ref === '#online')?.text?.intervalMs).toBeLessThanOrEqual(1700)
    expect(data.items.every((i) => i.confirmed === true)).toBe(true)
    // "Next story" is not a control that stops anything: never pressed.
    expect(data.actions.filter((a) => a.action === 'activate')).toEqual([])
  })

  it('presses the controls that stop each, and finds no failure', async () => {
    const { snapshot, engine } = await probed('motion-pass.html')
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    expect(byRule(report, MOTION_RULE)).toEqual([])
    expect(reviewByRule(report, MOTION_RULE)).toEqual([])
    const data = motionOf(snapshot)
    const stoppedBy = Object.fromEntries(data.items.map((i) => [i.el.ref.startsWith('#news') ? '#news' : i.el.ref, i.nativeControls ? 'native' : data.controls.find((c) => c.key === i.stoppedBy)?.name]))
    // A video that had not started playing when the page was read is not counted; one that had has its own controls.
    const { '#clip': clip, ...rest } = stoppedBy
    expect(rest).toEqual({ '#ticker > span': 'Stop scrolling', '#online': 'Pause updates', '#news': 'Pause' })
    expect([undefined, 'native']).toContain(clip)
    // The entrance animation ends within five seconds, and the hidden spinner never runs.
    expect(data.found.short + data.found.brief).toBeGreaterThan(0)
    expect(data.actions.filter((a) => a.action === 'activate').map((a) => a.label).sort()).toEqual(['Pause', 'Pause updates', 'Stop scrolling'])
  })

  it('sends to review a control under a cookie wall, a frequency control and colors that pulse', async () => {
    const { snapshot, engine } = await probed('motion-review.html')
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    expect(byRule(report, MOTION_RULE)).toEqual([])
    expect(reviewByRule(report, MOTION_RULE).map((r) => r.ref).sort()).toEqual(['#live', '#ticker > span', '#trades'])
    expect(data(snapshot).controls.find((c) => c.name === 'Pause ticker')?.trial).toMatchObject({ outcome: 'not-exercised' })
    expect(data(snapshot).actions.filter((a) => a.action === 'activate')).toEqual([])
  })
})
const data = motionOf

describe.skipIf(!browser)('time-limit probe (2.2.1)', { timeout: 400_000 }, () => {
  it('fails a session that ends after 15 minutes with no warning, and sends a message that disappears to review', async () => {
    const { snapshot, engine } = await probed('time-fail.html')
    expect(recordOf(snapshot, 'time-limits')).toMatchObject({ kind: 'motion', version: '1', status: 'complete' })
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    expect(byRule(report, TIME_RULE).map((f) => `${f.ref} ${f.confidence}`)).toEqual(['html > body high'])
    expect(byRule(report, TIME_RULE)[0]?.message).toMatch(/^After 15 min with no input, the page goes to http:\/\/127\.0\.0\.1:\d+\/time\/expired\.html, and nothing warned of it before/)
    expect(reviewByRule(report, TIME_RULE).map((r) => r.ref)).toEqual(['#saved'])
    expect(timeOf(snapshot).refine).toMatchObject({ eventAt: 900_000, confirmed: true })
    // The navigation was intercepted: the server never saw the address it went to.
    expect((servers?.requests ?? []).filter((r) => r.includes('/time/expired'))).toEqual([])
  })

  it('presses "Stay signed in" when the warning shows, and finds no failure when it extends the time', async () => {
    const { snapshot, engine } = await probed('time-extend.html')
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    expect(byRule(report, TIME_RULE)).toEqual([])
    expect(reviewByRule(report, TIME_RULE)).toEqual([])
    const time = timeOf(snapshot)
    expect(time.refine).toMatchObject({ warningAt: 780_000, eventAt: 900_000, confirmed: true })
    expect(time.extension).toMatchObject({ outcome: 'extended', control: { name: 'Stay signed in', extend: true } })
    // "Sign out now" is never pressed.
    expect(time.actions.filter((a) => a.action === 'activate').map((a) => a.label)).toEqual(['Stay signed in'])
  })

  it('fails a warning whose only control does not extend the time', async () => {
    const { snapshot, engine } = await probed('time-noextend.html')
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    expect(byRule(report, TIME_RULE).map((f) => f.confidence)).toEqual(['high'])
    expect(byRule(report, TIME_RULE)[0]?.message).toContain('(its "OK", pressed on a fresh load, did not extend it)')
    expect(timeOf(snapshot).extension).toMatchObject({ outcome: 'not-extended', control: { name: 'OK', extend: false } })
  })

  it('gives the judgment the words of a timed test, which may clear it', async () => {
    const { snapshot, engine } = await probed('time-exam.html')
    const off = await checkSnapshot(snapshot, engine, probeCheckOptions())
    expect(byRule(off, TIME_RULE).map((f) => f.message.slice(0, 48))).toEqual(['After 10 min with no input, the page submits a f'])
    const model = exceptions({ verdict: 'pass', exception: 'essential', evidence: 'This is a timed test: you have 10 minutes to answer every question.', confidence: 'high' })
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions({ llm: true, provider: model }))
    expect(model.asked[0]).toContain('This is a timed test: you have 10 minutes to answer every question.')
    expect(byRule(report, TIME_RULE)).toEqual([])
  })

  it('replays a saved snapshot offline to the same findings', async () => {
    const { snapshot, engine } = await probed('time-fail.html')
    const live = await checkSnapshot(snapshot, engine, probeCheckOptions())
    const dir = await mkdtemp(join(tmpdir(), 'rampa-motion-'))
    const path = join(dir, 'motion.snapshot.json')
    await writeFile(path, JSON.stringify(snapshot), 'utf8')
    await writeFile(join(dir, 'motion.engine.json'), JSON.stringify(engine), 'utf8')
    const loaded = await loadRecorded(path, 'en')
    const replayed = await checkSnapshot(loaded.snapshot, loaded.engine, probeCheckOptions())
    const key = (report: Report) => report.findings.map((f) => `${f.fingerprint} ${f.evidence}`)
    expect(key(replayed)).toEqual(key(live))
    expect(replayed.coverage.probes).toEqual(live.coverage.probes)
  })
})
