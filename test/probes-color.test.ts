import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { checkSnapshot } from '../src/core/check.ts'
import type { EngineResults, Report } from '../src/core/types.ts'
import { emptyEngine } from '../src/engine/axe.ts'
import { grayChange, ringInk } from '../src/pixels/gray.ts'
import type { RgbaImage } from '../src/pixels/png.ts'
import type { ColorData, GrayMeasure, InstructionFact, LinkFact, StateFact } from '../src/probes/color.ts'
import { snapshotSignature } from '../src/probes/identity.ts'
import type { InPageElement } from '../src/probes/kit.ts'
import { DETERMINISM_ARGS, parseProbeKinds } from '../src/probes/run.ts'
import { grayVerdict, ringExtra } from '../src/rules/color.ts'
import { renderReport } from '../src/report/pretty.ts'
import { paint } from '../src/report/color.ts'
import { A11ySnapshotSchema, type A11yNode, type A11ySnapshot, type ProbeRecord } from '../src/snapshot/schema.ts'
import { loadRecorded } from '../src/surfaces/targets.ts'
import { type Collected, collectWeb, launchBrowser } from '../src/surfaces/web.ts'
import { byRule, fixture, probeCheckOptions, reviewByRule } from './probe-helpers.ts'

const STATE = 'rampa/color-only-state'
const REQUIRED = 'rampa/color-only-required'
const LINK = 'rampa/link-color-only'
const WORDS = 'rampa/color-words'

/** A solid image, with optional rectangles painted on it. */
function image(width: number, height: number, fill: [number, number, number], rects: Array<{ x: number; y: number; w: number; h: number; color: [number, number, number] }> = []): RgbaImage {
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const rect = rects.find((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h)
      const [r, g, b] = rect?.color ?? fill
      const i = (y * width + x) * 4
      data[i] = r
      data[i + 1] = g
      data[i + 2] = b
      data[i + 3] = 255
    }
  }
  return { width, height, data }
}

describe('the achromatopsia render', () => {
  it('keeps a change of lightness of 3:1 or more, and loses a change of hue alone', () => {
    const white = image(20, 10, [255, 255, 255])
    // A pale blue background on white: 1.24:1 in luminance.
    const pale = grayChange(image(20, 10, [0xdb, 0xe8, 0xff]), white)
    expect(pale.colorChanged).toBe(200)
    expect(pale.strongest).toBeLessThan(1.3)
    expect(pale.strong).toBe(0)
    // Red text against dark gray: 2.15:1.
    const red = grayChange(image(10, 10, [0xcc, 0, 0]), image(10, 10, [0x33, 0x33, 0x33]))
    expect(red.strongest).toBeCloseTo(2.15, 1)
    // The same blue as a background against white: 6.3:1.
    expect(grayChange(image(10, 10, [0x1a, 0x5f, 0xb4]), white).strongest).toBeGreaterThan(6)
    // Noise below the channel threshold is no change.
    expect(grayChange(image(10, 10, [250, 250, 250]), white).colorChanged).toBe(0)
  })

  it('finds ink in the halo: a bar under the box that the background does not have', () => {
    // A 40×20 box at (8, 8) in a 56×36 capture; a 3 px bar under it, from 2 px inside its bottom edge.
    const bar = image(56, 36, [255, 255, 255], [{ x: 8, y: 26, w: 40, h: 3, color: [0x22, 0x22, 0x22] }])
    const ring = ringInk(bar, { x: 8, y: 8, width: 40, height: 20 }, 8)
    expect(ring.bottom).toBe(3)
    expect(ring.top).toBe(0)
    expect(ringExtra({ current: ring, peers: [{ top: 0, bottom: 0, left: 0, right: 0 }] })).toBe('bottom')
    // The same line under every item (the tab list's border) is no mark of the current one.
    expect(ringExtra({ current: ring, peers: [ring] })).toBeUndefined()
  })

  it('reads a gray capture: color only, lightness, a halo mark, invisible or unmeasured', () => {
    const measured = (extra: Partial<GrayMeasure>): GrayMeasure => ({ status: 'measured', colorChanged: 300, strong: 0, strongest: 1.4, area: 2000, ring: { current: { top: 0, bottom: 0, left: 0, right: 0 }, peers: [{ top: 0, bottom: 0, left: 0, right: 0 }] }, ...extra })
    expect(grayVerdict(measured({}))).toBe('color-only')
    expect(grayVerdict(measured({ strongest: 3 }))).toBe('lightness')
    // The style sheet's colors count too: antialiased glyphs may never show their full color in the capture.
    expect(grayVerdict(measured({}), 3.2)).toBe('lightness')
    expect(grayVerdict({ status: 'moving' }, 4.5)).toBe('lightness')
    expect(grayVerdict(measured({ colorChanged: 2 }))).toBe('invisible')
    expect(grayVerdict(measured({ ring: { current: { top: 0, bottom: 2, left: 0, right: 0 }, peers: [{ top: 0, bottom: 0, left: 0, right: 0 }] } }))).toBe('ring')
    expect(grayVerdict({ status: 'moving' })).toBe('unmeasured')
    expect(grayVerdict(undefined)).toBe('unmeasured')
  })

  it('is a probe kind of its own, part of all', () => {
    expect(parseProbeKinds('color')).toEqual(['color'])
    expect(parseProbeKinds('all')).toContain('color')
  })
})

// ---- the rules, over recorded facts ------------------------------------------------------------------------------

const node = (ref: string, tag: string, attributes: Record<string, string> = {}, name?: string): A11yNode => ({ ref, role: tag === 'a' ? 'link' : 'generic', ...(name ? { name } : {}), states: [], native: { tag, attributes }, children: [] })
const el = (n: A11yNode, label = ''): InPageElement => ({ ref: n.ref, id: { tag: String(n.native.tag), sig: snapshotSignature(n) }, tag: String(n.native.tag), role: n.role, label })

const CURRENT = node('#nav-2', 'a', { id: 'nav-2', href: '#p' }, 'Products')
const PEER = node('#nav-1', 'a', { id: 'nav-1', href: '#h' }, 'Home')
const FIELD = node('#name', 'input', { id: 'name' })
const LABEL = node('#name-label', 'label', { id: 'name-label' })
const LINK_NODE = node('#terms', 'a', { id: 'terms', href: '#t' }, 'terms')
const HINT = node('#hint', 'p', { id: 'hint' })

const gray = (strongest: number): GrayMeasure => ({ status: 'measured', colorChanged: 320, strong: 0, strongest, area: 3000, ring: { current: { top: 0, bottom: 0, left: 0, right: 0 }, peers: [{ top: 0, bottom: 0, left: 0, right: 0 }] } })
const state = (extra: Partial<StateFact> = {}): StateFact => ({
  el: el(CURRENT, 'Products'),
  state: 'aria-current',
  value: 'page',
  group: '<nav> "Main"',
  peersFound: 3,
  peers: [el(PEER, 'Home')],
  comparison: { cues: [], colors: [{ prop: 'color', node: 'element', current: '#cc0000', peer: '#333333' }], marks: [] },
  text: { current: '#cc0000', peer: '#333333', contrast: 2.15 },
  gray: gray(2.15),
  ...extra,
})
const link = (extra: Partial<LinkFact> = {}): LinkFact => ({ el: el(LINK_NODE, 'terms'), text: 'terms', color: '#2255aa', around: '#222222', contrast: 2.23, rest: [], group: -1, ...extra })
const words = (extra: Partial<InstructionFact> = {}): InstructionFact => ({
  el: el(HINT),
  quote: 'Fields in red are required.',
  word: 'red',
  hue: 'red',
  target: 'required',
  matched: [{ el: el(LABEL, 'Full name'), color: '#cc0000', what: 'text' }],
  matchedCount: 2,
  unmarked: 2,
  ...extra,
})

function snapshotOf(data: Partial<ColorData>): A11ySnapshot {
  const full: ColorData = { viewport: { width: 1280, height: 800 }, states: [], required: [], links: [], linkGroups: [], instructions: [], found: { states: 0, required: 0, links: 0, instructions: 0 }, halo: 8, end: 'complete', ...data }
  const record: ProbeRecord = {
    kind: 'color',
    version: '1',
    conditions: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, browser: 'chromium 1 (headless)', variant: 'use-of-color' },
    status: 'complete',
    guard: { blocked: [], navigations: [], dialogs: [] },
    durationMs: 1,
    data: full,
  }
  const body: A11yNode = { ref: 'html > body', role: 'generic', states: [], native: { tag: 'body', attributes: {} }, children: [CURRENT, PEER, LABEL, FIELD, LINK_NODE, HINT] }
  return {
    schemaVersion: 1,
    surface: 'web',
    target: 'https://example.com/',
    viewport: { width: 1280, height: 800, scale: 1 },
    root: { ref: 'html', role: 'document', states: [], native: { tag: 'html', attributes: {} }, children: [body] },
    observations: { probes: [record] },
    collectedAt: new Date(0).toISOString(),
    collector: { name: 'rampa-web', version: '0' },
  }
}

const check = (snapshot: A11ySnapshot, engine: EngineResults = emptyEngine(), locale: 'en' | 'pt-BR' = 'en') => checkSnapshot(snapshot, engine, probeCheckOptions({ locale }))

describe('1.4.1 over recorded facts', () => {
  it('fails a current item that only color sets apart, gone in gray, and leaves alone one with a cue, a mark or enough lightness', async () => {
    const report = await check(snapshotOf({ states: [state()], found: { states: 1, required: 0, links: 0, instructions: 0 } }))
    const findings = byRule(report, STATE)
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({ criterion: '1.4.1', ref: '#nav-2', source: 'probe', experimental: true, confidence: 'high' })
    expect(findings[0]?.message).toContain('only its color sets it apart from the items next to it: color #cc0000 vs #333333')
    expect(findings[0]?.evidence).toContain('in the achromatopsia render (luminance only) the change is at most 2.15:1, under 3:1')
    for (const quiet of [
      state({ comparison: { cues: [{ prop: 'font-weight', node: 'element', current: '700', peer: '400' }], colors: [], marks: [] } }),
      state({ comparison: { cues: [], colors: [{ prop: 'color', node: 'element', current: '#111111', peer: '#8a8a8a' }], marks: ['icon <svg> only on the current one'] } }),
      state({ gray: gray(5.47) }),
      state({ skipped: 'peers-differ', comparison: undefined }),
    ]) {
      expect(byRule(await check(snapshotOf({ states: [quiet] })), STATE)).toEqual([])
    }
  })

  it('sends a color-only item it could not capture to review, never to the failures', async () => {
    const report = await check(snapshotOf({ states: [state({ gray: { status: 'moving' } })] }))
    expect(byRule(report, STATE)).toEqual([])
    expect(reviewByRule(report, STATE)[0]?.message).toContain('Rampa could not capture it')
  })

  it('fails a link under 3:1 against its text, leaves a link axe-core failed to it, and settles what axe-core left undecided', async () => {
    const report = await check(snapshotOf({ links: [link()] }))
    expect(byRule(report, LINK)[0]?.message).toContain('luminance contrast of 2.23:1 with the text, under 3:1 (F73)')
    const axeFailed: EngineResults = { engine: { name: 'axe-core', version: '4' }, rules: [{ ruleId: 'link-in-text-block', outcome: 'violation', criteria: ['1.4.1'], help: 'Links must be distinguishable', nodes: [{ ref: '#terms', target: '#terms', html: '<a>' }] }] }
    const deferred = await check(snapshotOf({ links: [link()] }), axeFailed)
    expect(byRule(deferred, LINK)).toEqual([])
    expect(deferred.findings.filter((f) => f.ruleId === 'link-in-text-block')).toHaveLength(1)
    const undecided: EngineResults = { engine: { name: 'axe-core', version: '4' }, rules: [{ ruleId: 'link-in-text-block', outcome: 'incomplete', criteria: ['1.4.1'], help: 'Links must be distinguishable', nodes: [{ ref: '#terms', target: '#terms', html: '<a>' }] }] }
    const settled = await check(snapshotOf({ links: [link({ rest: ['::after'] })] }), undecided)
    expect((settled.needsReview ?? []).filter((r) => r.ruleId === 'link-in-text-block')).toEqual([])
    expect(byRule(settled, LINK)).toEqual([])
  })

  it('leaves alone a link styled exactly like the text around it: nothing tells it apart, color included', async () => {
    const report = await check(snapshotOf({ links: [link({ color: '#ffffff', around: '#ffffff', contrast: 1 })], found: { states: 0, required: 0, links: 1, instructions: 0 } }))
    expect(byRule(report, LINK)).toEqual([])
    expect(report.coverage.probes?.find((c) => c.rule === LINK)?.note).toContain('1 styled like the text around them, which 1.4.1 does not fail')
    // Red against green of the same lightness is a difference of color, not the same color.
    const hue = await check(snapshotOf({ links: [link({ color: '#e00000', around: '#008f00', contrast: 1.04 })] }))
    expect(byRule(hue, LINK)).toHaveLength(1)
  })

  it('reviews links at 3:1 or more that gain nothing on hover or focus, once per page, and says G183 accepts them', async () => {
    const quiet = await check(snapshotOf({ links: [link({ contrast: 4.6, color: '#3b7dd8', group: 0 })], linkGroups: [{ ref: '#terms', hover: [], focus: [], focusVisible: true }] }))
    expect(byRule(quiet, LINK)).toEqual([])
    const review = reviewByRule(quiet, LINK)
    expect(review).toHaveLength(1)
    expect(review[0]?.message).toContain('which G183 accepts) and gain no other cue on hover or on focus')
    expect(review[0]?.message).toContain('so this is not a failure')
    const cued = await check(snapshotOf({ links: [link({ contrast: 4.6, group: 0 })], linkGroups: [{ ref: '#terms', hover: ['text-decoration: underline solid auto'], focus: ['outline: 1px auto'] }] }))
    expect(reviewByRule(cued, LINK)).toEqual([])
  })

  it('quotes a sentence that names a color, and fails it for required fields marked by that color alone', async () => {
    const report = await check(snapshotOf({ instructions: [words()] }))
    expect(byRule(report, WORDS)[0]?.message).toBe(
      'The text "Fields in red are required." tells people which fields are required by a color (red), and 2 of the red labels or fields carry no other mark (F81). People who cannot tell red apart miss it. Mark required fields in a way that does not rely on color, such as an asterisk or "(required)", and say so in the text (WCAG 1.4.1; G14).',
    )
    expect(byRule(report, WORDS)[0]?.confidence).toBe('medium')
    const none = await check(snapshotOf({ instructions: [words({ quote: 'Seats in green are available.', word: 'green', hue: 'green', target: 'generic', matched: [], matchedCount: 0, unmarked: 0 })] }))
    expect(reviewByRule(none, WORDS)[0]?.message).toContain('but nothing it seems to refer to on this page is green')
    const named = await check(snapshotOf({ instructions: [words({ otherCue: 'asterisk' })] }))
    expect(byRule(named, WORDS)).toEqual([])
    expect(reviewByRule(named, WORDS)).toEqual([])
  })

  it('says nothing about 1.4.1 for a kind of content the page does not have, rather than "no applicable content"', async () => {
    const report = await check(snapshotOf({}))
    const rows = (report.coverage.probes ?? []).filter((c) => c.criterion === '1.4.1')
    expect(rows.map((r) => `${r.rule} ${r.status}`)).toEqual([`${STATE} not-checked`, `${REQUIRED} not-checked`, `${LINK} not-checked`, `${WORDS} not-checked`])
    expect(report.coverage.criteria?.find((c) => c.id === '1.4.1')?.status).not.toBe('no-applicable-content')
  })

  it('writes in Brazilian Portuguese', async () => {
    const report = await check(snapshotOf({ states: [state()], instructions: [words({ quote: 'Os campos em vermelho são obrigatórios.', word: 'vermelho' })] }), emptyEngine(), 'pt-BR')
    expect(byRule(report, STATE)[0]?.message).toMatch(/^Este item está marcado como o atual ou selecionado/)
    expect(byRule(report, WORDS)[0]?.message).toMatch(/^O texto "Os campos em vermelho são obrigatórios." indica quais campos são obrigatórios por uma cor \(vermelho\)/)
  })
})

// ---- the probe, on fixtures --------------------------------------------------------------------------------------

// Integration: needs Chrome or Edge. Skipped, with the reason on stderr, when none starts.
const browser = await launchBrowser({ args: DETERMINISM_ARGS }).catch((error: unknown) => {
  process.stderr.write(`\nSkipping the color probe tests: no browser started (${error instanceof Error ? error.message.split('\n')[0] : String(error)}).\n`)
  return undefined
})
afterAll(async () => browser?.close(), 60_000)

const collected = new Map<string, Promise<Collected>>()
function probed(name: string): Promise<Collected> {
  if (!browser) throw new Error('no browser')
  let result = collected.get(name)
  if (!result) {
    result = collectWeb(browser, fixture(name), { runAxe: false, locale: 'en', probes: ['color'] })
    collected.set(name, result)
  }
  return result
}

const dataOf = (snapshot: A11ySnapshot) => snapshot.observations?.probes.find((p) => p.kind === 'color')?.data as ColorData | undefined
const COLOR_RULES = [STATE, REQUIRED, LINK, WORDS]
const colorFindings = (report: Report) => report.findings.filter((f) => COLOR_RULES.includes(f.ruleId ?? ''))

describe.skipIf(!browser)('color probe (1.4.1)', { timeout: 120_000 }, () => {
  it('fails a current link and a selected tab told apart by color alone, red required labels, a link under 3:1 and "Fields in red are required"', async () => {
    const { snapshot, engine } = await probed('color-fail.html')
    expect(A11ySnapshotSchema.safeParse(snapshot).success).toBe(true)
    const record = snapshot.observations?.probes.find((p) => p.kind === 'color')
    expect(record).toMatchObject({ kind: 'color', version: '1', status: 'complete', conditions: { variant: 'use-of-color' } })
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    expect(colorFindings(report).map((f) => `${f.ruleId} ${f.ref}`)).toEqual([
      `${STATE} html > body > main > nav > ul > li:nth-of-type(2) > a`,
      `${STATE} #t-year`,
      `${REQUIRED} #name`,
      `${LINK} #terms-text > a`,
      `${WORDS} #hint`,
    ])
    const data = dataOf(snapshot) as ColorData
    // The screen-reader-only "(current)" is no visual mark.
    expect(data.states[0]?.comparison?.marks).toEqual([])
    expect(data.states[0]?.gray?.strongest).toBeLessThan(3)
    expect(data.states[1]?.gray?.strongest).toBeLessThan(1.5)
    expect(data.required[0]?.gray?.status).toBe('measured')
    expect(data.instructions[0]).toMatchObject({ quote: 'Fields in red are required.', word: 'red', hue: 'red', target: 'required', matchedCount: 2, unmarked: 2 })
    expect(report.coverage.notChecked).not.toContain('1.4.1')
  })

  it('finds nothing on the same page fixed: bold and underlined, a bar of the tab\'s own, asterisks, underlined links', async () => {
    const { snapshot, engine } = await probed('color-pass.html')
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    expect(colorFindings(report)).toEqual([])
    expect((report.needsReview ?? []).filter((r) => COLOR_RULES.includes(r.ruleId))).toEqual([])
    const data = dataOf(snapshot) as ColorData
    expect(data.states.map((s) => s.comparison?.cues.map((c) => c.prop).join(','))).toEqual(['font-weight,text-decoration', ''])
    expect(data.states[1]?.gray?.strongest).toBeGreaterThanOrEqual(3)
  })

  it('fails none of the near misses: lightness of 3:1 or more, a bar outside the tab, swapped colors, items colored apart, words for optional fields', async () => {
    const { snapshot, engine } = await probed('color-near.html')
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    expect(colorFindings(report)).toEqual([])
    const data = dataOf(snapshot) as ColorData
    const verdicts = data.states.map((s) => `${s.el.label}: ${s.skipped ?? (s.comparison && (s.comparison.cues.length > 0 || s.comparison.marks.length > 0) ? 'cue' : grayVerdict(s.gray, s.comparison?.contrast))}`)
    expect(verdicts).toEqual(['Pricing: lightness', 'Overview: ring', 'Grid: lightness', 'Sport: peers-differ', 'Orders: cue'])
    expect(data.required[0]?.marks).toEqual(['"optional" on the optional labels'])
    // "Our red team" conveys nothing; "Seats in green" names a color nothing on the page has.
    expect(data.instructions.map((i) => i.quote)).toEqual(['Seats in green are available;'])
    expect(reviewByRule(report, WORDS).map((r) => r.ref)).toEqual(['#seats'])
    // The underlined-on-hover link is fine; the one with no hover cue and no focus ring goes to review, once.
    expect(data.linkGroups.map((g) => `${g.ref} hover=${g.hover?.length} focus=${g.focus?.length}`)).toEqual(['#good > a hover=1 focus=1', '#quiet > a hover=0 focus=0'])
    expect(reviewByRule(report, LINK).map((r) => r.ref)).toEqual(['#quiet > a'])
  })

  it('stays below the default threshold and prints its coverage lines', async () => {
    const { snapshot, engine } = await probed('color-fail.html')
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions({ minConfidence: 'medium' }))
    expect(colorFindings(report)).toEqual([])
    expect(report.belowThreshold.filter((f) => COLOR_RULES.includes(f.ruleId ?? ''))).toHaveLength(5)
    const text = renderReport(report, { verbose: true, paint: paint(false) })
    expect(text).toMatch(/1\.4\.1 +probe\/color@1 \(rampa\/color-only-state\) · current and selected items against their neighbours at 1280×800/)
  })

  it('replays a saved snapshot offline to the same findings', async () => {
    const { snapshot, engine } = await probed('color-fail.html')
    const live = await checkSnapshot(snapshot, engine, probeCheckOptions())
    const dir = await mkdtemp(join(tmpdir(), 'rampa-color-'))
    const path = join(dir, 'color.snapshot.json')
    await writeFile(path, JSON.stringify(snapshot), 'utf8')
    await writeFile(join(dir, 'color.engine.json'), JSON.stringify(engine), 'utf8')
    const loaded = await loadRecorded(path, 'en')
    const replayed = await checkSnapshot(loaded.snapshot, loaded.engine, probeCheckOptions())
    const key = (report: Report) => report.findings.map((f) => `${f.fingerprint} ${f.evidence}`)
    expect(key(replayed)).toEqual(key(live))
    expect(replayed.coverage.probes).toEqual(live.coverage.probes)
  })
})
