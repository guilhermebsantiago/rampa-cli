import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { checkSnapshot } from '../src/core/check.ts'
import type { EngineResults, Report } from '../src/core/types.ts'
import { emptyEngine } from '../src/engine/axe.ts'
import { type StateChange, cssContrast, stateChange } from '../src/pixels/indicator.ts'
import type { RgbaImage } from '../src/pixels/png.ts'
import type { FocusPixels, FocusStop } from '../src/probes/focus.ts'
import { snapshotSignature } from '../src/probes/identity.ts'
import type { InPageElement } from '../src/probes/kit.ts'
import { DETERMINISM_ARGS, parseProbeKinds } from '../src/probes/run.ts'
import type { IndicatorStateFact, StatesData, TextStateFact } from '../src/probes/states.ts'
import { renderReport } from '../src/report/pretty.ts'
import { paint } from '../src/report/color.ts'
import type { PixelContrastFact } from '../src/snapshot/pixel-contrast.ts'
import { A11ySnapshotSchema, type A11yNode, type A11ySnapshot, type ProbeRecord } from '../src/snapshot/schema.ts'
import { loadRecorded } from '../src/surfaces/targets.ts'
import { type Collected, collectWeb, launchBrowser } from '../src/surfaces/web.ts'
import { byRule, fixture, probeCheckOptions, reviewByRule } from './probe-helpers.ts'

const FOCUS = 'rampa/focus-indicator-contrast'
const TEXT = 'rampa/state-text-contrast'
const INDICATOR = 'rampa/state-indicator-contrast'
const RULES = [FOCUS, TEXT, INDICATOR]

type Rgb = [number, number, number]
/** A solid image with rectangles painted on it, later ones on top. */
function image(width: number, height: number, fill: Rgb, rects: Array<{ x: number; y: number; w: number; h: number; color: Rgb }> = []): RgbaImage {
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let color = fill
      for (const r of rects) if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) color = r.color
      data.set([...color, 255], (y * width + x) * 4)
    }
  }
  return { width, height, data }
}
/** A ring of `width` px around a box, `gap` px away from it. */
const ring = (box: { x: number; y: number; w: number; h: number }, gap: number, width: number, color: Rgb) => [
  { x: box.x - gap - width, y: box.y - gap - width, w: box.w + 2 * (gap + width), h: width, color },
  { x: box.x - gap - width, y: box.y + box.h + gap, w: box.w + 2 * (gap + width), h: width, color },
  { x: box.x - gap - width, y: box.y - gap, w: width, h: box.h + 2 * gap, color },
  { x: box.x + box.w + gap, y: box.y - gap, w: width, h: box.h + 2 * gap, color },
]

const WHITE: Rgb = [255, 255, 255]
const BLUE: Rgb = [0x1f, 0x5f, 0x8b]
const YELLOW: Rgb = [255, 255, 0]
const BOX = { x: 20, y: 20, w: 60, h: 24 }
const BOX_RECT = { x: 20, y: 20, width: 60, height: 24 }

describe('the indicator of a state, from two captures', () => {
  it('measures a pale ring on white against the white next to it', () => {
    const off = image(100, 64, WHITE)
    const on = image(100, 64, WHITE, ring(BOX, 2, 2, [0xc8, 0xc8, 0xc8]))
    const change = stateChange(on, off, off, { box: BOX_RECT, mode: 'focus' })
    expect(change).toMatchObject({ part: 'all', inside: 0 })
    expect(change.colors).toHaveLength(1)
    expect(change.colors[0]).toMatchObject({ color: '#c8c8c8', adjacent: [{ color: '#ffffff', share: 1 }] })
    expect(change.contrast).toBeCloseTo(1.67, 1)
  })

  it('passes a ring partly inside a blue button that contrasts with the button, not the page (Understanding, Figure 11)', () => {
    const off = image(100, 64, WHITE, [{ ...BOX, color: BLUE }])
    // A 4 px yellow ring: 2 px over the button's edge, 2 px outside it.
    const on = image(100, 64, WHITE, [{ ...BOX, color: BLUE }, ...ring({ x: BOX.x + 2, y: BOX.y + 2, w: BOX.w - 4, h: BOX.h - 4 }, 0, 4, YELLOW)])
    const change = stateChange(on, off, undefined, { box: BOX_RECT, mode: 'focus' })
    expect(change.colors[0]?.color).toBe('#ffff00')
    expect(change.colors[0]?.adjacent.map((a) => a.color).sort()).toEqual(['#1f5f8b', '#ffffff'])
    expect(change.contrast).toBeGreaterThan(6)
  })

  it('leaves a change of background inside the component out of scope, but still judges a ring outside it (Figure 15)', () => {
    const off = image(100, 64, WHITE, [{ ...BOX, color: [0xe8, 0xe8, 0xe8] }])
    const filled = image(100, 64, WHITE, [{ ...BOX, color: [0xc9, 0xc9, 0xc9] }])
    expect(stateChange(filled, off, undefined, { box: BOX_RECT, mode: 'focus' })).toMatchObject({ part: 'fill', colors: [], contrast: 1 })
    const ringed = image(100, 64, WHITE, [{ ...BOX, color: [0xc9, 0xc9, 0xc9] }, ...ring(BOX, 2, 2, [0xee, 0xee, 0xee])])
    const change = stateChange(ringed, off, undefined, { box: BOX_RECT, mode: 'focus' })
    expect(change.part).toBe('outside')
    expect(change.colors[0]?.color).toBe('#eeeeee')
    expect(change.contrast).toBeLessThan(1.5)
    // An outline in the new background's own color makes one block with it (GOV.UK's yellow skip link).
    const block = image(100, 64, WHITE, [{ ...BOX, color: [0xff, 0xdd, 0x00] }, ...ring(BOX, 0, 3, [0xff, 0xdd, 0x00])])
    expect(stateChange(block, off, undefined, { box: BOX_RECT, mode: 'focus' }).part).toBe('fill')
  })

  it('reads a pale pill against the page around it, never against the text on it, and finds white next to a near-white color', () => {
    const text = { x: 30, y: 26, width: 40, height: 12 }
    const glyphs = Array.from({ length: 8 }, (_, i) => ({ x: 31 + i * 5, y: 27, w: 2, h: 10, color: [0x11, 0x11, 0x11] as Rgb }))
    const off = image(100, 64, WHITE, glyphs)
    const on = image(100, 64, WHITE, [{ ...BOX, color: [0xed, 0xf1, 0xf5] }, ...glyphs])
    const change = stateChange(on, off, off, { box: BOX_RECT, exclude: [text], mode: 'state' })
    expect(change.part).toBe('non-excluded')
    expect(change.excluded).toBeGreaterThan(0)
    expect(change.colors[0]).toMatchObject({ color: '#edf1f5', adjacent: [{ color: '#ffffff', share: 1 }] })
    expect(change.contrast).toBeLessThan(1.2)
  })

  it('leaves out pixels that move on their own', () => {
    const off = image(100, 64, WHITE)
    const noise = image(100, 64, WHITE, [{ x: 0, y: 0, w: 100, h: 4, color: [0, 0, 0] }])
    const on = image(100, 64, WHITE, [{ x: 0, y: 0, w: 100, h: 4, color: [200, 0, 0] }])
    expect(stateChange(on, off, noise, { box: BOX_RECT, mode: 'focus' })).toMatchObject({ changed: 0, masked: 400, part: 'none' })
  })

  it('composites a style sheet color with alpha before measuring it', () => {
    expect(cssContrast('#000000', '#ffffff')).toBeCloseTo(21, 0)
    expect(cssContrast('#00000080', '#ffffff')).toBeCloseTo(4.0, 1)
    expect(cssContrast('#00000000', '#ffffff')).toBeUndefined()
  })

  it('is a probe kind of its own, part of all', () => {
    expect(parseProbeKinds('states')).toEqual(['states'])
    expect(parseProbeKinds('all')).toContain('states')
  })
})

// ---- the rules, over recorded facts ------------------------------------------------------------------------------

const node = (ref: string, tag: string, attributes: Record<string, string> = {}, name?: string): A11yNode => ({ ref, role: tag === 'a' ? 'link' : 'button', ...(name ? { name } : {}), states: [], native: { tag, attributes }, children: [] })
const el = (n: A11yNode, label = ''): InPageElement => ({ ref: n.ref, id: { tag: String(n.native.tag), sig: snapshotSignature(n) }, tag: String(n.native.tag), role: n.role, label })

const LINK = node('#docs', 'a', { id: 'docs', href: '#d' }, 'Docs')
const BUTTON = node('#save', 'button', { id: 'save' }, 'Save')
const TAB = node('#week', 'button', { id: 'week', role: 'tab' }, 'Week')

const change = (extra: Partial<StateChange> = {}): StateChange => ({
  area: 4000,
  changed: 300,
  masked: 0,
  inside: 0,
  outside: 300,
  excluded: 0,
  fill: 0,
  part: 'all',
  judged: 300,
  colors: [{ color: '#c8c8c8', pixels: 300, adjacent: [{ color: '#ffffff', share: 1 }], contrast: 1.67 }],
  contrast: 1.67,
  ...extra,
})
const pixels = (extra: Partial<FocusPixels> = {}): FocusPixels => ({
  region: { x: 0, y: 0, width: 124, height: 88 },
  box: { x: 32, y: 32, width: 60, height: 24 },
  diff: { area: 10912, changed: 300, strong: 0, noticeable: 300, masked: 0 },
  focused: 'a',
  blurred: 'b',
  indicator: { change: change(), styles: [{ prop: 'outline-color', focused: '#c8c8c8', blurred: '#0b57d0' }, { prop: 'outline-style', focused: 'solid', blurred: 'none' }, { prop: 'outline-width', focused: '2px', blurred: '3px' }] },
  ...extra,
})
const stop = (n: A11yNode, n2: number, focus: FocusPixels): FocusStop => ({ n: n2, key: 'Tab', at: n2 * 100, el: el(n, n.name), rect: focus.box, focus })

const body = (children: A11yNode[]): A11yNode => ({ ref: 'html > body', role: 'generic', states: [], native: { tag: 'body', attributes: {} }, children })
function snapshotWith(records: ProbeRecord[], children: A11yNode[] = [LINK, BUTTON, TAB]): A11ySnapshot {
  return {
    schemaVersion: 1,
    surface: 'web',
    target: 'https://example.com/',
    viewport: { width: 1280, height: 800, scale: 1 },
    root: { ref: 'html', role: 'document', states: [], native: { tag: 'html', attributes: {} }, children: [body(children)] },
    observations: { probes: records },
    collectedAt: new Date(0).toISOString(),
    collector: { name: 'rampa-web', version: '0' },
  }
}
const record = (kind: ProbeRecord['kind'], variant: string, data: unknown, version = kind === 'keyboard' ? '2' : '1'): ProbeRecord => ({
  kind,
  version,
  conditions: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, browser: 'chromium 1 (headless)', variant },
  status: 'complete',
  guard: { blocked: [], navigations: [], dialogs: [] },
  durationMs: 1,
  data,
})
const walk = (stops: FocusStop[]) =>
  record('keyboard', 'keyboard-walk', { viewport: { width: 1280, height: 800 }, idleMs: 0, idle: [], inventory: [], forward: stops, backward: [], end: { forward: 'cycled', backward: 'cycled' }, traps: [], budget: 150 })

const measured = (extra: Partial<PixelContrastFact> = {}): PixelContrastFact => ({
  kind: 'text',
  status: 'measured',
  foreground: '#8fb0e6',
  foregroundFrom: 'css',
  background: { common: '#ffffff', worst: '#ffffff', best: '#ffffff' },
  highest: 2.2,
  lowest: 2.2,
  pixels: 120,
  stroke: 2,
  fontSize: 16,
  fontWeight: 400,
  ...extra,
})
const text = (extra: Partial<TextStateFact> = {}): TextStateFact => ({ el: el(LINK, 'Docs'), text: '#docs', state: 'hover', alike: 3, changed: [{ prop: 'color', rest: '#0b57d0', now: '#8fb0e6' }], measure: measured(), ...extra })
const indicator = (extra: Partial<IndicatorStateFact> = {}): IndicatorStateFact => ({
  el: el(TAB, 'Week'),
  state: 'aria-selected',
  value: 'true',
  removed: ['aria-selected="true"'],
  status: 'measured',
  clip: { x: 100, y: 100, width: 82, height: 50 },
  text: [],
  change: change({ inside: 195, outside: 0, judged: 195, changed: 195, part: 'non-excluded', colors: [{ color: '#d0d7de', pixels: 195, adjacent: [{ color: '#ffffff', share: 1 }], contrast: 1.45 }], contrast: 1.45 }),
  ...extra,
})
const statesRecord = (data: Partial<StatesData>) =>
  record('states', 'state-contrast', { viewport: { width: 1280, height: 800 }, hover: [], focus: [], selected: [], found: { controls: 4, groups: 2, disabled: 0, selected: 1, disabledSelected: 0 }, halo: 8, end: 'complete', ...data } satisfies StatesData)

const check = (snapshot: A11ySnapshot, engine: EngineResults = emptyEngine(), locale: 'en' | 'pt-BR' = 'en') => checkSnapshot(snapshot, engine, probeCheckOptions({ locale }))

describe('1.4.11 focus indicators over recorded facts', () => {
  it('fails a ring under 3:1 against the colors next to it, and names its colors and the style sheet', async () => {
    const report = await check(snapshotWith([walk([stop(LINK, 1, pixels())])]))
    const [finding, ...rest] = byRule(report, FOCUS)
    expect(rest).toEqual([])
    expect(finding).toMatchObject({ criterion: '1.4.11', ref: '#docs', source: 'probe', experimental: true, confidence: 'high' })
    expect(finding?.message).toContain('its focus indicator (#c8c8c8, around it) has a contrast of 1.67:1 at most with the colors next to it, under the 3:1')
    expect(finding?.evidence).toBe('Tab ×1: <a> "Docs" focused and blurred; 300 px of its indicator around it: #c8c8c8 (300 px) next to #ffffff (100%): 1.67:1; style sheet: outline-color #c8c8c8')
  })

  it('exempts the browser\'s own ring, leaves a change of background out of scope, and passes 3:1', async () => {
    const report = await check(
      snapshotWith([
        walk([
          stop(LINK, 1, pixels({ indicator: { change: change(), styles: [], browserRing: true } })),
          stop(BUTTON, 2, pixels({ indicator: { change: change({ part: 'fill', colors: [], contrast: 1, judged: 0 }), styles: [] } })),
          stop(TAB, 3, pixels({ indicator: { change: change({ colors: [{ color: '#949494', pixels: 300, adjacent: [{ color: '#ffffff', share: 1 }], contrast: 3.03 }], contrast: 3.03 }), styles: [] } })),
        ]),
      ]),
    )
    expect(byRule(report, FOCUS)).toEqual([])
    expect(reviewByRule(report, FOCUS)).toEqual([])
    const row = report.coverage.probes?.find((c) => c.rule === FOCUS)
    expect(row).toMatchObject({ status: 'no-failure-found', applicable: 3 })
    expect(row?.note).toContain("1 with the browser's own focus ring, which 1.4.11 exempts")
    expect(row?.note).toContain('1 whose focus changes the background inside the component, which 1.4.11 leaves out of scope (Understanding, Figure 15)')
  })

  it('sends to review a ring whose style sheet color reaches 3:1 (a blend in the pixels), and one with no single color around it', async () => {
    const thin = pixels({ indicator: { change: change(), styles: [{ prop: 'outline-color', focused: '#595959', blurred: '#0b57d0' }, { prop: 'outline-style', focused: 'solid', blurred: 'none' }], drawn: { 'outline-style': 'solid', 'outline-width': '1px' } } })
    const busy = pixels({ indicator: { change: change({ colors: [{ color: '#c8c8c8', pixels: 300, adjacent: [], contrast: 1 }], contrast: 1 }), styles: [] } })
    const report = await check(snapshotWith([walk([stop(LINK, 1, thin), stop(BUTTON, 2, busy)])]))
    expect(byRule(report, FOCUS)).toEqual([])
    expect(reviewByRule(report, FOCUS).map((f) => f.ref)).toEqual(['#docs', '#save'])
    expect(reviewByRule(report, FOCUS)[0]?.evidence).toContain('(outline-color #595959: 7.00:1)')
  })

  it('says a recording made before indicators were measured is not checked', async () => {
    const old = pixels()
    delete old.indicator
    const report = await check(snapshotWith([walk([stop(LINK, 1, old)])]))
    expect(report.coverage.probes?.find((c) => c.rule === FOCUS)).toMatchObject({ status: 'not-checked' })
  })
})

describe('1.4.3 in hover and focus states, and 1.4.11 for selected items, over recorded facts', () => {
  it('fails text under 4.5:1 on hover, passes 3:1 for large text, and leaves to axe-core what it failed at rest', async () => {
    const report = await check(snapshotWith([statesRecord({ hover: [text()], focus: [text({ el: el(BUTTON, 'Save'), text: '#save', state: 'focus', measure: measured({ highest: 3.4, lowest: 3.4, fontSize: 24 }) })] })]))
    const [finding, ...rest] = byRule(report, TEXT)
    expect(rest).toEqual([])
    expect(finding).toMatchObject({ criterion: '1.4.3', ref: '#docs', confidence: 'high' })
    expect(finding?.message).toBe('When the pointer is over this control (hover), its text has a contrast of 2.20:1 at best with what is behind it, under the 4.5:1 WCAG 1.4.3 asks. Text must keep its contrast in every state a person puts it in; change the hover colors.')
    expect(finding?.evidence).toBe('hover: <a> "Docs" (and 2 alike control(s)); changed: color #0b57d0 → #8fb0e6; #8fb0e6 on #ffffff: 2.20:1 at best, 2.20:1 at worst · 16px, 400')
    const axe: EngineResults = { engine: { name: 'axe-core', version: '4' }, rules: [{ ruleId: 'color-contrast', outcome: 'violation', criteria: ['1.4.3'], help: 'contrast', nodes: [{ ref: '#docs', target: '#docs', html: '<a>' }] }] }
    const left = await check(snapshotWith([statesRecord({ hover: [text()] })]), axe)
    expect(byRule(left, TEXT)).toEqual([])
    expect(left.coverage.probes?.find((c) => c.rule === TEXT)?.note).toContain('1 already failed at rest by axe-core')
  })

  it('reviews text part above and part below, and text it could not measure', async () => {
    const report = await check(snapshotWith([statesRecord({ hover: [text({ measure: measured({ highest: 6, lowest: 2 }) }), text({ el: el(BUTTON, 'Save'), text: '#save', measure: { kind: 'text', status: 'unmeasured', reason: 'moving' } })] })]))
    expect(byRule(report, TEXT)).toEqual([])
    expect(reviewByRule(report, TEXT).map((f) => f.ref)).toEqual(['#docs', '#save'])
    expect(reviewByRule(report, TEXT)[1]?.message).toContain('Rampa could not measure the contrast there (what is behind it moves on its own)')
  })

  it('fails a selected tab shown only by a pale bar, and leaves alone one whose text is bold too', async () => {
    const report = await check(snapshotWith([statesRecord({ selected: [indicator()] })]))
    const [finding] = byRule(report, INDICATOR)
    expect(finding).toMatchObject({ criterion: '1.4.11', ref: '#week', confidence: 'medium' })
    expect(finding?.message).toContain('This item is marked as the current or selected one (aria-selected="true"), and the only thing that shows it is an indicator (#d0d7de, inside it) with a contrast of 1.45:1 at most')
    expect(finding?.evidence).toBe('marks taken off: aria-selected="true"; 195 px changed, 195 outside its text, inside it: #d0d7de (195 px) next to #ffffff (100%): 1.45:1; its text does not change')
    const bold = await check(snapshotWith([statesRecord({ selected: [indicator({ text: [{ prop: 'font-weight', rest: '400', now: '700' }] })] })]))
    expect(byRule(bold, INDICATOR)).toEqual([])
    expect(bold.coverage.probes?.find((c) => c.rule === INDICATOR)?.note).toContain('1 with an indicator under 3:1 next to a bolder or underlined text')
  })

  it('reviews an indicator under 3:1 next to a change of text color alone, and counts a state shown by the text only', async () => {
    const color = await check(snapshotWith([statesRecord({ selected: [indicator({ text: [{ prop: 'color', rest: '#111111', now: '#0b57d0' }] })] })]))
    expect(byRule(color, INDICATOR)).toEqual([])
    expect(reviewByRule(color, INDICATOR)[0]?.message).toContain('Its state shows by a change of its text color and by an indicator')
    const glyphs = await check(snapshotWith([statesRecord({ selected: [indicator({ change: change({ judged: 2, changed: 80, excluded: 78 }) })] })]))
    expect(byRule(glyphs, INDICATOR)).toEqual([])
    expect(glyphs.coverage.probes?.find((c) => c.rule === INDICATOR)?.note).toContain('1 shown by their text alone')
  })

  it('says "not checked" on a page with nothing of the kind, never "no applicable content"', async () => {
    const report = await check(snapshotWith([statesRecord({ found: { controls: 0, groups: 0, disabled: 0, selected: 0, disabledSelected: 0 } })]))
    expect((report.coverage.probes ?? []).filter((c) => c.rule === TEXT || c.rule === INDICATOR).map((c) => c.status)).toEqual(['not-checked', 'not-checked'])
  })

  it('writes in Brazilian Portuguese', async () => {
    const report = await check(snapshotWith([statesRecord({ hover: [text()], selected: [indicator()] }), walk([stop(LINK, 1, pixels())])]), emptyEngine(), 'pt-BR')
    expect(byRule(report, TEXT)[0]?.message).toMatch(/^Quando o ponteiro está sobre este controle \(hover\), o texto tem contraste de no máximo 2,20:1/)
    expect(byRule(report, INDICATOR)[0]?.message).toMatch(/^Este item está marcado como o atual ou selecionado/)
    expect(byRule(report, FOCUS)[0]?.message).toMatch(/^Quando este elemento recebe o foco do teclado, o indicador de foco \(#c8c8c8, em volta dele\) tem contraste de no máximo 1,67:1/)
  })
})

// ---- the probes, on fixtures -------------------------------------------------------------------------------------

// Integration: needs Chrome or Edge. Skipped, with the reason on stderr, when none starts.
const browser = await launchBrowser({ args: DETERMINISM_ARGS }).catch((error: unknown) => {
  process.stderr.write(`\nSkipping the state contrast probe tests: no browser started (${error instanceof Error ? error.message.split('\n')[0] : String(error)}).\n`)
  return undefined
})
afterAll(async () => browser?.close(), 60_000)

const collected = new Map<string, Promise<Collected>>()
function probed(name: string): Promise<Collected> {
  if (!browser) throw new Error('no browser')
  let result = collected.get(name)
  if (!result) {
    result = collectWeb(browser, fixture(name), { runAxe: true, locale: 'en', probes: ['keyboard', 'states'] })
    collected.set(name, result)
  }
  return result
}
const stateFindings = (report: Report) => report.findings.filter((f) => RULES.includes(f.ruleId ?? '')).map((f) => `${f.ruleId} ${f.ref}`)
const stateReview = (report: Report) => (report.needsReview ?? []).filter((f) => RULES.includes(f.ruleId)).map((f) => `${f.ruleId} ${f.ref}`)

describe.skipIf(!browser)('contrast in states (1.4.3, 1.4.11)', { timeout: 180_000 }, () => {
  it('fails pale and outside rings, pale text on hover and on focus, and selected items shown by a pale bar, a pale pill or a pale check', async () => {
    const { snapshot, engine } = await probed('states-fail.html')
    expect(A11ySnapshotSchema.safeParse(snapshot).success).toBe(true)
    expect(snapshot.observations?.probes.find((p) => p.kind === 'states')).toMatchObject({ kind: 'states', version: '1', status: 'complete', conditions: { variant: 'state-contrast' } })
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    expect(stateFindings(report).sort()).toEqual(
      [`${FOCUS} #pale-ring`, `${FOCUS} #yellow-out`, `${TEXT} #hover-light`, `${TEXT} #btn-hover`, `${TEXT} #focus-text`, `${INDICATOR} #t-week`, `${INDICATOR} #here`, `${INDICATOR} #agree`].sort(),
    )
    expect(stateReview(report)).toEqual([])
    const ring = byRule(report, FOCUS).find((f) => f.ref === '#pale-ring')
    expect(ring?.evidence).toMatch(/#c8c8c8 \(\d+ px\) next to #ffffff \(100%\): 1\.67:1; style sheet: outline-color #c8c8c8$/)
    const focusText = byRule(report, TEXT).find((f) => f.ref === '#focus-text')
    expect(focusText?.evidence).toMatch(/^focus: <button> "Yellow on focus"; changed: background-color #1a5fb4 → #ffd54f.*#ffffff on #ffd54f: 1\.\d\d:1 at best/)
    // axe-core sees none of these at rest.
    expect(report.findings.filter((f) => f.ruleId === 'color-contrast')).toEqual([])
  })

  it('finds nothing on the same page fixed', async () => {
    const { snapshot, engine } = await probed('states-pass.html')
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    expect(stateFindings(report)).toEqual([])
    expect(stateReview(report)).toEqual([])
    expect(report.coverage.probes?.filter((c) => RULES.includes(c.rule)).map((c) => `${c.rule} ${c.status}`)).toEqual([`${FOCUS} no-failure-found`, `${TEXT} no-failure-found`, `${INDICATOR} no-failure-found`])
  })

  it('fails none of the near misses: rings that contrast with the button, a change of background, the browser ring, 3.03:1, disabled controls, bold or underlined text next to a pale indicator', async () => {
    const { snapshot, engine } = await probed('states-near.html')
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    expect(stateFindings(report)).toEqual([])
    expect(stateReview(report)).toEqual([])
    const focus = report.coverage.probes?.find((c) => c.rule === FOCUS)
    expect(focus?.note).toMatch(/\d+ with the browser's own focus ring, which 1\.4\.11 exempts; 1 whose focus changes the background inside the component/)
    const states = report.coverage.probes?.find((c) => c.rule === INDICATOR)
    expect(states?.note).toContain('2 with an indicator under 3:1 next to a bolder or underlined text, which shows the state on its own; 1 disabled, exempt')
    // The disabled button and the disabled tab are never hovered or focused.
    expect(report.coverage.probes?.find((c) => c.rule === TEXT)?.note).toContain('2 disabled, exempt')
  })

  it('stays below the default threshold and prints its coverage lines', async () => {
    const { snapshot, engine } = await probed('states-fail.html')
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions({ minConfidence: 'medium' }))
    expect(stateFindings(report)).toEqual([])
    expect(report.belowThreshold.filter((f) => RULES.includes(f.ruleId ?? ''))).toHaveLength(8)
    const printed = renderReport(report, { verbose: true, paint: paint(false) })
    expect(printed).toMatch(/1\.4\.11 +probe\/keyboard@2 \(rampa\/focus-indicator-contrast\) · focus indicators against the colors next to them, at 1280×800/)
    expect(printed).toMatch(/1\.4\.3 +probe\/states@1 \(rampa\/state-text-contrast\) · text in hover and focus states at 1280×800/)
  })

  it('replays a saved snapshot offline to the same findings', async () => {
    const { snapshot, engine } = await probed('states-fail.html')
    const live = await checkSnapshot(snapshot, engine, probeCheckOptions())
    const dir = await mkdtemp(join(tmpdir(), 'rampa-states-'))
    const path = join(dir, 'states.snapshot.json')
    await writeFile(path, JSON.stringify(snapshot), 'utf8')
    await writeFile(join(dir, 'states.engine.json'), JSON.stringify(engine), 'utf8')
    const loaded = await loadRecorded(path, 'en')
    const replayed = await checkSnapshot(loaded.snapshot, loaded.engine, probeCheckOptions())
    const key = (report: Report) => report.findings.map((f) => `${f.fingerprint} ${f.evidence}`)
    expect(key(replayed)).toEqual(key(live))
    expect(replayed.coverage.probes).toEqual(live.coverage.probes)
  })
})
