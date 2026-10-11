import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { checkSnapshot } from '../src/core/check.ts'
import type { Report } from '../src/core/types.ts'
import { emptyEngine } from '../src/engine/axe.ts'
import type { RgbaImage } from '../src/pixels/png.ts'
import type { Watch } from '../src/probes/activate.ts'
import { DETERMINISM_ARGS, parseProbeKinds } from '../src/probes/run.ts'
import {
  type ExposedState,
  type ToggleCandidate,
  type TogglesData,
  type ToggleState,
  type ToggleTrial,
  exposedChange,
  exposedState,
  readTrial,
  regionChange,
} from '../src/probes/toggles.ts'
import { paint } from '../src/report/color.ts'
import { renderReport } from '../src/report/pretty.ts'
import { toggleVerdicts } from '../src/rules/state-exposure.ts'
import { A11ySnapshotSchema, type A11ySnapshot, type ProbeRecord } from '../src/snapshot/schema.ts'
import { indexTree } from '../src/snapshot/tree.ts'
import { loadRecorded } from '../src/surfaces/targets.ts'
import { type Collected, collectWeb, launchBrowser } from '../src/surfaces/web.ts'
import { startFixtureServers } from './media-server.ts'
import { byRule, probeCheckOptions, reviewByRule } from './probe-helpers.ts'

const RULE = 'rampa/state-exposure'

const watch = (extra: Partial<Watch> = {}): Watch => ({ dom: 0, style: 0, samples: [], navigations: [], windows: [], submits: [], dialogs: [], modals: 0, text: { before: 1000, changed: 0 }, storage: 0, blocked: 0, ms: 600, ...extra })
const button = (extra: Partial<ExposedState> = {}): ExposedState => ({ role: 'button', name: 'Details', ...extra })
const state = (ax: ExposedState | null, text = 0, extra: Partial<ToggleState> = {}): ToggleState => ({ ax: [ax], text: { added: text ? ['Panel text'] : [], removed: [], changed: text }, ...extra })
const change = (noticeable: number) => ({ changed: noticeable, noticeable })

/** A disclosure: the first click shows 80 characters and 5,000 pixels, the second puts the page back. */
function disclosure(ax: [ExposedState | null, ExposedState | null, ExposedState | null], extra: Partial<ToggleTrial> = {}): Omit<ToggleTrial, 'confirm'> {
  return {
    box: { x: 100, y: 380, width: 120, height: 32 },
    point: { x: 160, y: 396 },
    before: state(ax[0]),
    after: [state(ax[1], 80), state(ax[2], 0)],
    watches: [watch({ dom: 3 }), watch({ dom: 3 })],
    pixels: { masked: 0, outside: [change(5000), change(20)], control: [change(4)] },
    ...extra,
  }
}

describe('reading a trial', () => {
  const declared = { mode: 'toggle' as const, declared: { states: ['aria-expanded'] } }
  const bare = { mode: 'toggle' as const, declared: { states: [] } }

  it('names the first change in what the browser exposes', () => {
    expect(exposedChange([button({ expanded: false })], [button({ expanded: true })])).toBe('expanded false → true')
    expect(exposedChange([button()], [button({ name: 'Hide details' })])).toBe('name "Details" → "Hide details"')
    expect(exposedChange([button(), { role: 'tab', selected: true }], [button(), { role: 'tab', selected: false }])).toBe('another in its group: selected true → false')
    expect(exposedChange([button()], [button()])).toBeUndefined()
    expect(exposedState({ role: 'switch', name: 'Large text', props: { checked: 'false', focusable: true } })).toEqual({ role: 'switch', name: 'Large text', checked: 'false' })
  })

  it('fails a toggle whose content goes and comes back while its exposed state stays the same', () => {
    expect(readTrial(declared, disclosure([button({ expanded: false }), button({ expanded: false }), button({ expanded: false })]))).toMatchObject({ kind: 'two-state', verdict: 'fail', why: 'stale', signals: ['text', 'pixels'] })
    expect(readTrial(bare, disclosure([button(), button(), button()]))).toMatchObject({ verdict: 'fail', why: 'missing' })
    // Changed with the first click, never back with the second: it says "expanded" over a closed panel.
    expect(readTrial(declared, disclosure([button({ expanded: false }), button({ expanded: true }), button({ expanded: true })]))).toMatchObject({ verdict: 'fail', why: 'stuck' })
  })

  it('passes a toggle that exposes its state, as a state or as its name', () => {
    expect(readTrial(declared, disclosure([button({ expanded: false }), button({ expanded: true }), button({ expanded: false })]))).toMatchObject({ verdict: 'pass', exposed: ['expanded false → true', 'expanded true → false'] })
    expect(readTrial(bare, disclosure([button({ name: 'Show' }), button({ name: 'Hide' }), button({ name: 'Show' })]))).toMatchObject({ verdict: 'pass' })
  })

  it('reads its own look flipping and flipping back as a toggle', () => {
    const own = (third: number): Omit<ToggleTrial, 'confirm'> => ({
      ...disclosure([button(), button(), button()]),
      after: [state(button()), state(button()), state(button())],
      watches: [watch({ dom: 1 }), watch({ dom: 1 }), watch({ dom: 1 })],
      pixels: { masked: 0, outside: [change(30), change(30)], control: [change(300), change(third)] },
    })
    expect(readTrial(bare, own(0))).toMatchObject({ kind: 'two-state', verdict: 'fail', why: 'missing', signals: ['control'] })
    // A third look, not the first again: a counter or a cycle, not a toggle.
    expect(readTrial(bare, own(300))).toMatchObject({ verdict: 'n/a' })
  })

  it('leaves out actions that do not go back, and clicks that change nothing', () => {
    const more = disclosure([button(), button(), button()], { after: [state(button(), 60), state(button(), 120)] })
    expect(readTrial(bare, more)).toMatchObject({ kind: 'one-way', verdict: 'n/a' })
    const nothing = disclosure([button(), button(), button()], { after: [state(button()), state(button())], watches: [watch(), watch()], pixels: { masked: 0, outside: [change(30), change(30)], control: [change(0)] } })
    expect(readTrial(bare, nothing)).toMatchObject({ kind: 'none', verdict: 'n/a' })
  })

  it('fails a declared state that stays the same when content showed and the control could not be clicked back', () => {
    const covered = disclosure([button({ expanded: false }), button({ expanded: false }), null], {
      after: [state(button({ expanded: false }), 300)],
      watches: [watch({ dom: 5, opened: { ref: '#menu', id: { tag: 'div', sig: 'div|menu||||' }, tag: 'div', role: 'generic', label: 'Menu', name: 'Menu', modal: false, cover: 0.4 } })],
      pixels: { masked: 0, outside: [change(9000)], control: [] },
      stopped: 'something covered the control after the click',
    })
    expect(readTrial(declared, covered)).toMatchObject({ kind: 'declared', verdict: 'fail', why: 'stale', signals: ['text', 'layer', 'pixels'] })
    expect(readTrial(bare, covered)).toMatchObject({ kind: 'one-way', verdict: 'n/a' })
  })

  it('fails a tab whose choice changes the content and no selected state in its group', () => {
    const tab = { mode: 'select' as const, declared: { role: 'tab', states: ['aria-selected'] } }
    const chosen = (after: Array<ExposedState | null>): Omit<ToggleTrial, 'confirm'> => ({
      box: { x: 100, y: 380, width: 80, height: 32 },
      before: { ax: [{ role: 'tab', name: 'Yearly', selected: false }, { role: 'tab', name: 'Monthly', selected: true }], text: { added: [], removed: [], changed: 0 } },
      after: [{ ax: after, text: { added: ['Yearly plan'], removed: ['Monthly plan'], changed: 24 } }],
      watches: [watch({ dom: 4 })],
      pixels: { masked: 0, outside: [change(2000)], control: [] },
    })
    expect(readTrial(tab, chosen([{ role: 'tab', name: 'Yearly', selected: false }, { role: 'tab', name: 'Monthly', selected: true }]))).toMatchObject({ kind: 'selected', verdict: 'fail', why: 'stale' })
    expect(readTrial(tab, chosen([{ role: 'tab', name: 'Yearly', selected: true }, { role: 'tab', name: 'Monthly', selected: false }]))).toMatchObject({ verdict: 'pass' })
    expect(readTrial({ mode: 'select', declared: { states: [] } }, chosen([null, null]))).toMatchObject({ verdict: 'fail', why: 'missing' })
  })

  it('counts changed pixels inside or outside a box, the noise left out', () => {
    const image = (fill: (x: number, y: number) => number): RgbaImage => {
      const data = new Uint8Array(40 * 20 * 4)
      for (let y = 0; y < 20; y++) for (let x = 0; x < 40; x++) data.set([fill(x, y), 0, 0, 255], (y * 40 + x) * 4)
      return { width: 40, height: 20, data } as RgbaImage
    }
    const before = image(() => 0)
    const after = image((x) => (x < 10 ? 200 : x >= 30 ? 20 : 0))
    const noise = image((x) => (x >= 35 ? 9 : 0))
    const box = { x: 0, y: 0, width: 8, height: 20 }
    expect(regionChange(after, before, undefined, box, true, 2)).toMatchObject({ changed: 200, noticeable: 200, bbox: { x: 0, y: 0, width: 10, height: 20 } })
    // Outside: the faint band at 30–39 changed by 20, under the noticeable step; 35–39 moved on their own and is masked.
    expect(regionChange(after, before, noise, box, false, 2)).toMatchObject({ changed: 100, noticeable: 0, masked: 100 })
  })

  it('keeps the activate class out of --probe all', () => {
    expect(parseProbeKinds('all')).not.toContain('toggles')
    expect(parseProbeKinds('toggles')).toEqual(['toggles'])
    expect(parseProbeKinds('interact')).toContain('toggles')
  })
})

const node = (ref: string, tag: string, attributes: Record<string, string>, role: string, name: string) => ({ ref, role, name, states: [], native: { tag, attributes }, children: [] })

function candidate(ref: string, label: string, trial: ToggleTrial, extra: Partial<ToggleCandidate> = {}): ToggleCandidate {
  return { ref, id: { tag: 'button', sig: `button|${ref.slice(1)}||||` }, tag: 'button', role: 'button', label, mode: 'toggle', tier: 'declared', declared: { states: ['aria-expanded'] }, why: 'aria-expanded', trial, ...extra }
}

function togglesSnapshot(candidates: ToggleCandidate[]): A11ySnapshot {
  const data: TogglesData = { viewport: { width: 1280, height: 800 }, found: candidates.length, candidates, tried: candidates.length, loads: candidates.length + 2, actions: [], end: 'complete' }
  const record: ProbeRecord = {
    kind: 'toggles',
    version: '1',
    conditions: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, browser: 'chromium 1 (headless)', variant: 'state-exposure' },
    status: 'complete',
    guard: { blocked: [], navigations: [], dialogs: [] },
    durationMs: 1,
    data,
  }
  return {
    schemaVersion: 1,
    surface: 'web',
    target: 'https://example.com/',
    title: 'Help',
    viewport: { width: 1280, height: 800, scale: 1 },
    root: { ref: 'html', role: 'document', states: [], native: { tag: 'html', attributes: {} }, children: [{ ref: 'html > body', role: 'generic', states: [], native: { tag: 'body', attributes: {} }, children: candidates.map((c) => node(c.ref, 'button', { id: c.ref.slice(1) }, 'button', c.label)) }] },
    observations: { probes: [record] },
    collectedAt: new Date(0).toISOString(),
    collector: { name: 'rampa-web', version: '0' },
  }
}

describe('4.1.2 over recorded toggles', () => {
  const stale = (): ToggleTrial => disclosure([button({ expanded: false }), button({ expanded: false }), button({ expanded: false })])
  const confirmed = candidate('#faq', 'How long does shipping take?', { ...stale(), confirm: stale() })
  const once = candidate('#once', 'Filters', { ...stale(), confirm: disclosure([button({ expanded: false }), button({ expanded: true }), button({ expanded: false })]) })
  const unconfirmed = candidate('#late', 'Sizes', stale())
  const missing = candidate('#more', 'Shipping costs', { ...disclosure([button(), button(), button()]), confirm: disclosure([button(), button(), button()]) }, { tier: 'button', declared: { states: [] }, why: 'button' })
  const good = candidate('#good', 'Returns', disclosure([button({ expanded: false }), button({ expanded: true }), button({ expanded: false })]))

  it('fails a confirmed toggle, high when it declares the state, and sends one seen once or not tried again to review', async () => {
    const snapshot = togglesSnapshot([confirmed, once, unconfirmed, missing, good])
    const verdicts = toggleVerdicts(snapshot.observations?.probes[0]?.data as TogglesData, indexTree(snapshot.root))
    expect(verdicts.verdicts.map((v) => `${v.candidate.ref} ${v.result}${v.why ? ` ${v.why}` : ''}`)).toEqual(['#faq failure', '#once review once', '#late review unconfirmed', '#more failure'])
    expect(verdicts).toMatchObject({ applicable: 5, unmatched: 0 })
    expect(verdicts.exposed.map((e) => e.candidate.ref)).toEqual(['#good'])

    const report = await checkSnapshot(snapshot, emptyEngine(), probeCheckOptions())
    const findings = byRule(report, RULE)
    expect(findings.map((f) => `${f.ref} ${f.confidence}`)).toEqual(['#faq high', '#more medium'])
    expect(findings[0]?.message).toMatch(/^Clicking <button> "How long does shipping take\?" shows or hides content, and the next click puts it back, but the browser exposes the same state before and after \(button "Details", expanded false\): the aria-expanded it declares is never updated/)
    expect(findings[1]?.message).toContain('the browser exposes no state for it, before or after (button "Details", no state)')
    expect(findings[1]?.message).toContain('Set aria-expanded to "true" and "false" as the state changes')
    expect(findings[0]?.evidence).toMatch(/^clicked 2 time\(s\) at 160,396; text came or went \(80 characters: \+"Panel text"\); 5000 pixels changed outside it; back as it was after the next click; exposed before: button "Details", expanded false; after click 1: button "Details", expanded false; after click 2: button "Details", expanded false; the same on a second fresh load$/)
    expect(reviewByRule(report, RULE).map((r) => r.ref)).toEqual(['#once', '#late'])
    const row = report.coverage.probes?.find((c) => c.rule === RULE)
    expect(row).toMatchObject({ criterion: '4.1.2', method: 'probe/toggles@1', status: 'failures', applicable: 5, failures: 2, review: 2 })
    expect(row?.note).toContain('1 changed what shows and what the browser exposes: <button> "Returns" (expanded false → true)')
    expect(renderReport(report, { verbose: true, paint: paint(false) })).toMatch(/4\.1\.2 +probe\/toggles@1 \(rampa\/state-exposure\) · toggle-like controls clicked, the browser's accessibility tree read before and after, at 1280×800/)
    const pt = await checkSnapshot(togglesSnapshot([confirmed]), emptyEngine(), probeCheckOptions({ locale: 'pt-BR' }))
    expect(byRule(pt, RULE)[0]?.message).toMatch(/^Clicar em <button> "How long does shipping take\?" mostra ou esconde conteúdo/)
  })

  it('finds nothing to report where every toggle exposes its state', async () => {
    const report = await checkSnapshot(togglesSnapshot([good]), emptyEngine(), probeCheckOptions())
    expect(byRule(report, RULE)).toEqual([])
    expect(report.coverage.probes?.find((c) => c.rule === RULE)).toMatchObject({ status: 'no-failure-found', applicable: 1 })
  })

  it('treats a fact whose element changed between loads as unmatched', async () => {
    const snapshot = togglesSnapshot([confirmed])
    const data = snapshot.observations?.probes[0]?.data as TogglesData
    data.candidates[0] = { ...confirmed, id: { tag: 'button', sig: 'button|other||||' } }
    const report = await checkSnapshot(snapshot, emptyEngine(), probeCheckOptions())
    expect(byRule(report, RULE)).toEqual([])
    expect(report.coverage.probes?.find((c) => c.rule === RULE)).toMatchObject({ unmatched: 1, applicable: 0 })
  })
})

// Integration: needs Chrome or Edge, and the fixtures over HTTP. Skipped, with the reason on stderr, when no browser starts.
const browser = await launchBrowser({ args: DETERMINISM_ARGS }).catch((error: unknown) => {
  process.stderr.write(`\nSkipping the toggles probe tests: no browser started (${error instanceof Error ? error.message.split('\n')[0] : String(error)}).\n`)
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
    result = collectWeb(browser, `${servers.origin}/${name}`, { runAxe: false, locale: 'en', probes: ['toggles'] })
    collected.set(name, result)
  }
  return result
}

const recordOf = (snapshot: A11ySnapshot) => snapshot.observations?.probes.find((p) => p.kind === 'toggles')
const dataOf = (snapshot: A11ySnapshot) => recordOf(snapshot)?.data as TogglesData

describe.skipIf(!browser)('toggles probe (4.1.2)', { timeout: 400_000 }, () => {
  it('clicks each toggle and fails those whose state on screen never reaches the browser’s tree, on a second load too', async () => {
    const { snapshot, engine } = await probed('toggles-fail.html')
    expect(A11ySnapshotSchema.safeParse(snapshot).success).toBe(true)
    expect(recordOf(snapshot)).toMatchObject({ kind: 'toggles', version: '1', status: 'complete', conditions: { variant: 'state-exposure' } })
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    expect(
      byRule(report, RULE)
        .map((f) => `${f.ref} ${f.confidence}`)
        .sort(),
    ).toEqual(
      [
        'html > body > main > section:nth-of-type(1) > button high',
        'html > body > main > section:nth-of-type(3) > div high',
        '#t2 high',
        'html > body > main > section:nth-of-type(7) > button medium',
        'html > body > main > section:nth-of-type(5) > div:nth-of-type(1) medium',
        'html > body > main > section:nth-of-type(8) > span medium',
        'html > body > main > section:nth-of-type(2) > button medium',
        'html > body > main > section:nth-of-type(6) > button medium',
      ].sort(),
    )
    expect(reviewByRule(report, RULE)).toEqual([])
    const message = (ref: string) => byRule(report, RULE).find((f) => f.ref === ref)?.message ?? ''
    expect(message('#t2')).toContain('the aria-selected it declares is never updated')
    expect(message('html > body > main > section:nth-of-type(3) > div')).toContain('flips its look between two states')
    expect(message('html > body > main > section:nth-of-type(7) > button')).toContain('it changed with the first click (expanded false → true), and not back')
    expect(message('html > body > main > section:nth-of-type(8) > span')).toContain('Set aria-checked to "true" and "false" as the state changes, with role="switch" or role="checkbox"')
    // Every failure was measured twice, each time on a fresh load; nothing reached the server but the page itself.
    expect(dataOf(snapshot).candidates.every((c) => c.trial?.confirm !== undefined)).toBe(true)
    expect((servers?.requests ?? []).filter((r) => r.includes('touched'))).toEqual([])
  })

  it('finds no failure where each toggle exposes its state, and leaves native controls alone', async () => {
    const { snapshot, engine } = await probed('toggles-pass.html')
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    expect(byRule(report, RULE)).toEqual([])
    expect(reviewByRule(report, RULE)).toEqual([])
    const data = dataOf(snapshot)
    expect(data.candidates.map((c) => c.tag)).not.toContain('summary')
    expect(data.candidates.map((c) => c.tag)).not.toContain('input')
    expect(toggleVerdicts(data, indexTree(snapshot.root)).exposed).toHaveLength(7)
    expect(report.coverage.probes?.find((c) => c.rule === RULE)).toMatchObject({ status: 'no-failure-found', applicable: 7 })
  })

  it('reports nothing for actions that do not go back, focus and hover styles, and never clicks what the skip list names', async () => {
    const { snapshot, engine } = await probed('toggles-controls.html')
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    expect(byRule(report, RULE)).toEqual([])
    expect(reviewByRule(report, RULE)).toEqual([])
    const data = dataOf(snapshot)
    expect(data.candidates.find((c) => c.label === 'Delete all')?.skip?.reason).toBe('destructive')
    // The skip link and the link to another page are not toggles.
    expect(data.candidates.map((c) => c.label)).not.toContain('Skip to content')
    expect(data.candidates.map((c) => c.label)).not.toContain('Our stores')
    const verdicts = toggleVerdicts(data, indexTree(snapshot.root))
    expect(verdicts.oneWay).toBeGreaterThanOrEqual(4)
    expect((servers?.requests ?? []).filter((r) => r.includes('touched'))).toEqual([])
  })

  it('replays a saved snapshot offline to the same findings', async () => {
    const { snapshot, engine } = await probed('toggles-fail.html')
    const live = await checkSnapshot(snapshot, engine, probeCheckOptions())
    const dir = await mkdtemp(join(tmpdir(), 'rampa-toggles-'))
    const path = join(dir, 'toggles.snapshot.json')
    await writeFile(path, JSON.stringify(snapshot), 'utf8')
    await writeFile(join(dir, 'toggles.engine.json'), JSON.stringify(engine), 'utf8')
    const loaded = await loadRecorded(path, 'en')
    const replayed = await checkSnapshot(loaded.snapshot, loaded.engine, probeCheckOptions())
    const key = (report: Report) => report.findings.map((f) => `${f.fingerprint} ${f.evidence}`)
    expect(key(replayed)).toEqual(key(live))
    expect(replayed.coverage.probes).toEqual(live.coverage.probes)
  })
})
