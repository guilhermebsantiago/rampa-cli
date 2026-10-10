import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { checkSnapshot } from '../src/core/check.ts'
import type { Report } from '../src/core/types.ts'
import type { OrientationData, OrientationLoad, OrientationState } from '../src/probes/orientation.ts'
import { DETERMINISM_ARGS } from '../src/probes/run.ts'
import { isQuarterTurn, isTurnMessage, relativeTurn } from '../src/rules/orientation.ts'
import { probeChecks } from '../src/rules/probes.ts'
import { PROBE_RULES } from '../src/rules/registry.ts'
import { renderReport } from '../src/report/pretty.ts'
import { paint } from '../src/report/color.ts'
import { A11ySnapshotSchema, type A11ySnapshot, type ProbeRecord } from '../src/snapshot/schema.ts'
import { loadRecorded } from '../src/surfaces/targets.ts'
import { type Collected, collectWeb, launchBrowser } from '../src/surfaces/web.ts'
import { byRule, fixture, probeCheckOptions, reviewByRule } from './probe-helpers.ts'

const RULE = 'rampa/orientation'

describe('1.3.4 wording and angles', () => {
  it('knows a "turn your device" message in English, Portuguese and Spanish, and leaves look-alikes out', () => {
    for (const text of [
      'Please rotate your device to landscape to continue.',
      'Turn your phone upright to use the app.',
      'Best viewed in landscape',
      'Gire o celular para a posição horizontal',
      'Vire o aparelho para continuar',
      'Gira tu móvil para ver el contenido',
    ]) {
      expect(isTurnMessage(text), text).toBe(true)
    }
    for (const text of ['Turn left at the station', 'Turn on your phone notifications', 'Portrait of the artist as a young man', 'Rotate the image in the editor', '']) {
      expect(isTurnMessage(text), text).toBe(false)
    }
  })

  it('measures the change of rotation as a turn, a quarter within 5°', () => {
    expect(relativeTurn(90, 0)).toBe(270)
    expect(relativeTurn(2.5, 92.5)).toBe(90)
    expect(isQuarterTurn(90, 0)).toBe(true)
    expect(isQuarterTurn(0, -90)).toBe(true)
    expect(isQuarterTurn(45, 135)).toBe(true)
    expect(isQuarterTurn(0, 84)).toBe(false)
    expect(isQuarterTurn(-8, -8)).toBe(false)
    expect(isQuarterTurn(0, 180)).toBe(false)
  })
})

/** A recorded orientation probe, built by hand: the rule reads only these facts. */
const state = (orientation: 'portrait' | 'landscape', extra: Partial<OrientationState> = {}): OrientationState => ({
  orientation,
  reached: 'load',
  viewport: orientation === 'portrait' ? { width: 800, height: 1280 } : { width: 1280, height: 800 },
  screen: { type: `${orientation}-primary`, angle: orientation === 'portrait' ? 0 : 90 },
  matchesPortrait: orientation === 'portrait',
  windowOrientation: orientation === 'portrait' ? 0 : 90,
  ok: true,
  chars: 400,
  elements: 6,
  viewChars: 400,
  rotatedCount: 0,
  only: [],
  onlyChars: 0,
  pseudo: [],
  ...extra,
})

const load = (loaded: 'portrait' | 'landscape', states: [Partial<OrientationState>, Partial<OrientationState>], extra: Partial<OrientationLoad> = {}): OrientationLoad => {
  const turned = loaded === 'portrait' ? 'landscape' : 'portrait'
  return { pair: '1280x800', loaded, states: [state(loaded, states[0]), state(turned, { reached: 'turn', ...states[1] })], rotations: [], ms: 1, ...extra }
}

function recorded(loads: OrientationLoad[], data: Partial<OrientationData> = {}): ReturnType<typeof probeChecks> {
  const record: ProbeRecord = {
    kind: 'orientation',
    version: '1',
    conditions: { viewport: { width: 800, height: 1280 }, deviceScaleFactor: 1, browser: 'chromium 1 (headless)', variant: 'orientation' },
    status: 'complete',
    guard: { blocked: [], navigations: [], dialogs: [] },
    durationMs: 1,
    data: {
      pairs: [{ name: '1280x800', portrait: { width: 800, height: 1280 }, landscape: { width: 1280, height: 800 }, mobile: false, scale: 1 }],
      loads,
      locks: [],
      end: 'complete',
      ...data,
    } satisfies OrientationData,
  }
  const snapshot: A11ySnapshot = {
    schemaVersion: 1,
    surface: 'web',
    target: 'https://example.com/',
    viewport: { width: 1280, height: 800, scale: 1 },
    root: {
      ref: 'html',
      role: 'document',
      states: [],
      native: { tag: 'html', attributes: {} },
      children: [
        {
          ref: 'html > body',
          role: 'generic',
          states: [],
          native: { tag: 'body', attributes: {} },
          children: [{ ref: '#overlay', role: 'alert', states: ['hidden'], native: { tag: 'div', attributes: { id: 'overlay', role: 'alert' } }, children: [] }],
        },
      ],
    },
    observations: { probes: [record] },
    collectedAt: new Date(0).toISOString(),
    collector: { name: 'rampa-web', version: '0' },
  }
  return probeChecks(snapshot, 'en', PROBE_RULES)
}

const overlay = { ref: '#overlay', id: { tag: 'div', sig: 'div|overlay|alert|||' }, tag: 'div', label: '', text: 'Please turn your phone sideways', chars: 31, opaque: true, position: 'fixed', share: 1 }

describe('1.3.4 over recorded orientation states', () => {
  it('fails content gone behind a turn message, on the overlay, and counts it once across comparisons', () => {
    const result = recorded([load('portrait', [{ cover: overlay, chars: 431 }, {}]), load('landscape', [{}, { cover: overlay, chars: 431 }])])
    expect(result.findings.map((f) => `${f.ref} ${f.confidence}`)).toEqual(['#overlay high'])
    expect(result.findings[0]?.message).toMatch(/^In portrait orientation, the page hides its content and asks to turn the device: it works only in landscape/)
    expect(result.findings[0]?.evidence).toContain('31 character(s) of text a reader can see, against 400')
    expect(result.findings[0]?.evidence).toContain('it says "Please turn your phone sideways"; seen in 3 comparison(s)')
    expect(result.coverage[0]).toMatchObject({ criterion: '1.3.4', status: 'failures', applicable: 6, failures: 1, review: 0 })
  })

  it('ignores a layer that covers the window in both orientations, such as a cookie wall', () => {
    const wall = { ...overlay, text: 'We use cookies. Rotate your device? No: accept or refuse.', ref: '#overlay' }
    const result = recorded([load('portrait', [{ cover: wall }, { cover: wall }]), load('landscape', [{ cover: wall }, { cover: wall }])])
    expect(result.findings).toEqual([])
    expect(result.review).toEqual([])
  })

  it('sends content gone with no message to review only when two comparisons agree', () => {
    const once = recorded([load('portrait', [{ chars: 30 }, {}])])
    expect(once.review).toEqual([])
    expect(once.coverage[0]?.note).toContain('content differed in one comparison only')
    const twice = recorded([load('portrait', [{ chars: 30 }, {}]), load('landscape', [{}, { chars: 30 }])])
    expect(twice.findings).toEqual([])
    expect(twice.review.map((f) => f.ref)).toEqual(['html > body'])
    expect(twice.review[0]?.message).toMatch(/^In portrait orientation, most of the text the page shows in landscape is gone, with no message/)
  })

  it('reads a message drawn by a pseudo-element, and a message with the content still showing goes to review', () => {
    const pseudo = [{ ref: 'html > body', id: { tag: 'body', sig: 'body|||||' }, tag: 'body', label: '', which: '::after', text: 'Rotate your device' }]
    const result = recorded([load('landscape', [{}, { pseudo }])])
    expect(result.findings).toEqual([])
    expect(result.review.map((f) => f.message)).toEqual([expect.stringMatching(/^In portrait orientation, the page shows a message about turning the device, while its content still shows/)])
  })

  it('fails a quarter turn of the main content, reviews a small element, and never reports an element it cannot match', () => {
    const turned = (ref: string, tag: string, chars: number) => ({ ref, id: { tag, sig: `${tag}|||||` }, tag, label: '', a: 90, b: 0, ta: 'matrix(0, 1, -1, 0, 0, 0)', tb: '', chars, media: false, area: 1 })
    const result = recorded([load('portrait', [{}, {}], { rotations: [turned('html', 'html', 400), { ...turned('#overlay', 'div', 12), id: { tag: 'div', sig: 'div|overlay|alert|||' }, area: 0.01 }, turned('#gone', 'p', 50)] })])
    expect(result.findings.map((f) => f.ref)).toEqual(['html'])
    expect(result.findings[0]?.message).toContain('so it reads upright only in landscape')
    expect(result.findings[0]?.evidence).toMatch(/at 800×1280 \(portrait\): matrix\(0, 1, -1, 0, 0, 0\) \(90°\); turned to 1280×800 \(landscape\): no rotation \(0°\): 90° between the two/)
    expect(result.review.map((f) => f.ref)).toEqual(['#overlay'])
    expect(result.coverage[0]?.unmatched).toBe(1)
  })

  it('notes locks, the manifest and what axe-core says, and compares nothing in a state whose orientation did not take', () => {
    const result = recorded([load('portrait', [{ ok: false }, {}])], {
      locks: [{ orientation: 'portrait-primary', pair: '1280x800' }],
      manifest: { url: 'https://example.com/app.webmanifest', orientation: 'portrait' },
      axe: { outcome: 'violation', nodes: [{ target: 'html', ref: 'html', related: [{ target: '.game', ref: '.game' }] }] },
    })
    expect(result.coverage[0]).toMatchObject({ status: 'no-failure-found', applicable: 0 })
    const note = result.coverage[0]?.note ?? ''
    for (const part of ['screen.orientation.lock("portrait-primary")', 'the web app manifest sets orientation "portrait"', 'css-orientation-lock flags .game, which the probe did not see turn', 'the orientation could not be set in 1 state(s)']) {
      expect(note).toContain(part)
    }
  })
})

// Integration: needs Chrome or Edge. Skipped, with the reason on stderr, when none starts.
const browser = await launchBrowser({ args: DETERMINISM_ARGS }).catch((error: unknown) => {
  process.stderr.write(`\nSkipping the orientation probe tests: no browser started (${error instanceof Error ? error.message.split('\n')[0] : String(error)}).\n`)
  return undefined
})
// Closing Edge can take long on a loaded machine.
afterAll(async () => browser?.close(), 60_000)

const collected = new Map<string, Promise<Collected>>()
function probed(name: string): Promise<Collected> {
  if (!browser) throw new Error('no browser')
  let result = collected.get(name)
  if (!result) {
    result = collectWeb(browser, fixture(name), { runAxe: false, locale: 'en', probes: ['orientation'] })
    collected.set(name, result)
  }
  return result
}

const dataOf = (snapshot: A11ySnapshot) => snapshot.observations?.probes.find((p) => p.kind === 'orientation')?.data as OrientationData | undefined

describe.skipIf(!browser)('orientation probe (1.3.4)', { timeout: 120_000 }, () => {
  it('loads each pair upright and sideways, turns it, and records what the page saw, behind the guard', async () => {
    const { snapshot } = await probed('orientation-fail.html')
    expect(A11ySnapshotSchema.safeParse(snapshot).success).toBe(true)
    const record = snapshot.observations?.probes.find((p) => p.kind === 'orientation')
    expect(record).toMatchObject({ kind: 'orientation', version: '1', status: 'complete', conditions: { variant: 'orientation' } })
    expect(record?.guard).toEqual({ blocked: [], navigations: [], dialogs: [] })
    const data = dataOf(snapshot)
    expect(data?.loads.map((l) => `${l.pair} ${l.loaded}: ${l.states.map((s) => `${s.orientation} ${s.reached}`).join(', ')}`)).toEqual([
      '1280x800 portrait: portrait load, landscape turn',
      '1280x800 landscape: landscape load, portrait turn',
      '390x844 portrait: portrait load, landscape turn',
      '390x844 landscape: landscape load, portrait turn',
    ])
    const states = data?.loads.flatMap((l) => l.states) ?? []
    // The media query, screen.orientation and window.orientation (a shim on the desktop pair) agree with each state.
    expect(states.every((s) => s.ok)).toBe(true)
    expect(states.map((s) => `${s.screen.type} ${s.windowOrientation}`)).toEqual(expect.arrayContaining(['portrait-primary 0', 'landscape-primary 90']))
    expect(states.filter((s) => s.orientation === 'portrait').every((s) => s.cover?.ref === '#turn' && s.cover.opaque)).toBe(true)
    expect(states.filter((s) => s.orientation === 'landscape').every((s) => s.cover === undefined && s.chars > 250)).toBe(true)
    expect(states.every((s) => s.shot && /^[0-9a-f]{16}$/.test(s.shot.hash))).toBe(true)
    expect(data?.locks).toEqual(expect.arrayContaining([expect.objectContaining({ orientation: 'landscape' })]))
    expect(data?.manifest).toMatchObject({ orientation: 'landscape', display: 'fullscreen' })
  })

  it('fails content hidden behind a "rotate your device" overlay, and notes the lock and the manifest', async () => {
    const { snapshot, engine } = await probed('orientation-fail.html')
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    const findings = byRule(report, RULE)
    expect(findings.map((f) => `${f.ref} ${f.confidence}`)).toEqual(['#turn high'])
    expect(findings[0]).toMatchObject({ source: 'probe', experimental: true, criterion: '1.3.4' })
    expect(findings[0]?.message).toMatch(/^In portrait orientation, the page hides its content and asks to turn the device: it works only in landscape/)
    expect(findings[0]?.evidence).toMatch(/at 800×1280 \(portrait\), \d+ character\(s\) of text a reader can see, against \d+ at 1280×800 \(landscape\); a fixed layer covers 100% of the window; it says "Please rotate your device to landscape to continue\."; seen in 6 comparison\(s\) at 1280×800 and 390×844 \(phone\)$/)
    const coverage = report.coverage.probes?.find((c) => c.criterion === '1.3.4')
    expect(coverage).toMatchObject({ method: 'probe/orientation@1', rule: RULE, status: 'failures', failures: 1 })
    expect(coverage?.note).toContain('screen.orientation.lock("landscape")')
    expect(coverage?.note).toContain('the web app manifest sets orientation "landscape"')
    expect(report.coverage.notChecked).not.toContain('1.3.4')
    expect(report.coverage.criteria?.find((c) => c.id === '1.3.4')?.methods).toContainEqual(expect.objectContaining({ kind: 'probe', id: RULE, ran: true, maturity: 'experimental' }))
  })

  it('fails a page drawn sideways in portrait (ACT b33eff), with axe-core corroborating, and leaves a turned arrow out', async () => {
    const { snapshot, engine } = await probed('orientation-rotate.html')
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    const findings = byRule(report, RULE)
    expect(findings.map((f) => `${f.ref} ${f.confidence}`)).toEqual(['html high'])
    expect(findings[0]?.message).toContain('so it reads upright only in landscape')
    expect(findings[0]?.evidence).toMatch(/at 800×1280 \(portrait\): matrix\(0, 1, -1, 0, 0, 0\) \(90°\); turned to 1280×800 \(landscape\): no rotation \(0°\): 90° between the two/)
    expect(findings[0]?.evidence).toContain("axe-core's experimental css-orientation-lock flags it too")
    expect(reviewByRule(report, RULE)).toEqual([])
    expect(report.coverage.probes?.find((c) => c.criterion === '1.3.4')?.note).toContain('1 element(s) with no text or images turn a quarter, not reported')
  })

  it('fails a page that checks window.orientation once on load, by comparing the two loads', async () => {
    const { snapshot, engine } = await probed('orientation-script.html')
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    const findings = byRule(report, RULE)
    // The overlay exists only on a sideways load, so the snapshot does not hold it: the finding sits on the page.
    expect(findings.map((f) => `${f.ref} ${f.confidence}`)).toEqual(['html > body high'])
    expect(findings[0]?.message).toMatch(/^In landscape orientation, the page hides its content and asks to turn the device: it works only in portrait/)
    expect(findings[0]?.evidence).toContain('it says "Turn your phone upright to use the app."; seen in 2 comparison(s)')
  })

  it('finds nothing in a responsive page, a turned chevron, a tilted sticker or a line that mentions turning the phone', async () => {
    const { snapshot, engine } = await probed('orientation-pass.html')
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    expect(byRule(report, RULE)).toEqual([])
    expect(reviewByRule(report, RULE)).toEqual([])
    expect(report.coverage.probes?.find((c) => c.criterion === '1.3.4')).toMatchObject({ status: 'no-failure-found', failures: 0, review: 0 })
    expect(report.coverage.criteria?.find((c) => c.id === '1.3.4')?.status).toBe('no-failure-found')
  })

  it('sends content gone with no message, and a small labeled element that turns, to review', async () => {
    const { snapshot, engine } = await probed('orientation-review.html')
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    expect(byRule(report, RULE)).toEqual([])
    const review = reviewByRule(report, RULE)
    expect(review.map((f) => f.ref).sort()).toEqual(['#badge', 'html > body'])
    expect(review.find((f) => f.ref === '#badge')?.message).toMatch(/^An element with text or images turns by a quarter turn/)
    expect(review.find((f) => f.ref === 'html > body')?.message).toMatch(/^In portrait orientation, most of the text the page shows in landscape is gone, with no message/)
    expect(report.coverage.probes?.find((c) => c.criterion === '1.3.4')).toMatchObject({ status: 'needs-review', failures: 0, review: 2 })
  })

  it('writes in the report language, stays below the default threshold, and prints the coverage line', async () => {
    const { snapshot, engine } = await probed('orientation-fail.html')
    const pt = await checkSnapshot(snapshot, engine, probeCheckOptions({ locale: 'pt-BR' }))
    expect(byRule(pt, RULE)[0]?.message).toMatch(/^Na orientação retrato, a página esconde o conteúdo e pede para girar o aparelho/)
    expect(pt.coverage.probes?.find((c) => c.criterion === '1.3.4')?.conditions).toMatch(/^retrato e paisagem em 1280×800 e 390×844 \(celular\) · /)
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions({ minConfidence: 'medium' }))
    expect(byRule(report, RULE)).toEqual([])
    expect(report.belowThreshold.filter((f) => f.ruleId === RULE)).toHaveLength(1)
    const text = renderReport(report, { verbose: true, paint: paint(false) })
    expect(text).toMatch(/1\.3\.4 +probe\/orientation@1 \(rampa\/orientation\) · portrait and landscape at 1280×800 and 390×844 \(phone\)/)
  })

  it('replays a saved snapshot offline to the same findings', async () => {
    const { snapshot, engine } = await probed('orientation-rotate.html')
    const live = await checkSnapshot(snapshot, engine, probeCheckOptions())
    const dir = await mkdtemp(join(tmpdir(), 'rampa-orientation-'))
    const path = join(dir, 'orientation.snapshot.json')
    await writeFile(path, JSON.stringify(snapshot), 'utf8')
    await writeFile(join(dir, 'orientation.engine.json'), JSON.stringify(engine), 'utf8')
    const loaded = await loadRecorded(path, 'en')
    const replayed = await checkSnapshot(loaded.snapshot, loaded.engine, probeCheckOptions())
    const key = (report: Report) => report.findings.map((f) => `${f.fingerprint} ${f.evidence}`)
    expect(key(replayed)).toEqual(key(live))
    expect(replayed.coverage.probes).toEqual(live.coverage.probes)
  })
})
