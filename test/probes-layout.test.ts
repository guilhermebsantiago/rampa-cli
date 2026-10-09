import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { check } from '../src/api/check.ts'
import { checkSnapshot } from '../src/core/check.ts'
import type { Report } from '../src/core/types.ts'
import { DETERMINISM_ARGS } from '../src/probes/run.ts'
import { renderReport } from '../src/report/pretty.ts'
import { paint } from '../src/report/color.ts'
import { A11ySnapshotSchema, type A11ySnapshot } from '../src/snapshot/schema.ts'
import { walkTree } from '../src/snapshot/tree.ts'
import { loadRecorded } from '../src/surfaces/targets.ts'
import { type Collected, collectWeb, launchBrowser } from '../src/surfaces/web.ts'
import { byRule, fixture, probeCheckOptions, reviewByRule } from './probe-helpers.ts'

// Integration: needs Chrome or Edge. Skipped, with the reason on stderr, when none starts.
const browser = await launchBrowser({ args: DETERMINISM_ARGS }).catch((error: unknown) => {
  process.stderr.write(`\nSkipping the layout probe tests: no browser started (${error instanceof Error ? error.message.split('\n')[0] : String(error)}).\n`)
  return undefined
})
// Closing Edge can take long on a loaded machine.
afterAll(async () => browser?.close(), 60_000)

const collected = new Map<string, Collected>()
async function probed(name: string): Promise<Collected> {
  const cached = collected.get(name)
  if (cached) return cached
  if (!browser) throw new Error('no browser')
  const result = await collectWeb(browser, fixture(name), { runAxe: false, locale: 'en', probes: ['layout'] })
  collected.set(name, result)
  return result
}

describe.skipIf(!browser)('layout probes (1.4.10, 1.4.12, 1.4.4)', { timeout: 60_000 }, () => {
  it('records the layout at 1280×1024 and at 320×256 in the snapshot', async () => {
    const { snapshot } = await probed('reflow-fail.html')
    expect(A11ySnapshotSchema.safeParse(snapshot).success).toBe(true)
    const record = snapshot.observations?.probes.find((p) => p.conditions.variant === 'reflow-320x256')
    expect(record).toMatchObject({ kind: 'layout', version: '1', status: 'complete', conditions: { viewport: { width: 320, height: 256 }, deviceScaleFactor: 1 } })
    expect(record?.guard.blocked).toEqual([])
  })

  it('fails content past the right edge and text cut at 320 px that was whole at 1280 px', async () => {
    const { snapshot, engine } = await probed('reflow-fail.html')
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    const findings = byRule(report, 'rampa/reflow')
    expect(findings.map((f) => f.ref).sort()).toEqual(['#promo', '#wide-text'])
    const past = findings.find((f) => f.ref === '#wide-text')
    expect(past?.evidence).toMatch(/page scroll width 900 px; <p> "This column is 900 pixels wide.*px past the right edge \(320 px\)/)
    expect(findings.find((f) => f.ref === '#promo')?.evidence).toMatch(/at 1280×1024 whole; at 320×256 \d+ px cut down by <div> #promo/)
    expect(findings.every((f) => f.source === 'probe' && f.experimental && f.confidence === 'high' && f.criterion === '1.4.10')).toBe(true)
    expect(report.coverage.probes?.find((c) => c.criterion === '1.4.10')).toEqual(expect.objectContaining({ status: 'failures', failures: 2, method: 'probe/layout@1' }))
    expect(report.coverage.notChecked).not.toContain('1.4.10')
  })

  it('finds nothing in fluid content, data tables, code, carousels, visually hidden text or a hidden off-canvas menu', async () => {
    const { snapshot, engine } = await probed('reflow-pass.html')
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    expect(byRule(report, 'rampa/reflow')).toEqual([])
    const coverage = report.coverage.probes?.find((c) => c.criterion === '1.4.10')
    expect(coverage?.failures).toBe(0)
    expect(coverage?.applicable).toBeGreaterThan(5)
  })

  it('sends text cut by a window that cannot scroll sideways to review, and leaves a menu waiting off-canvas alone', async () => {
    const { snapshot, engine } = await probed('reflow-hidden.html')
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    // A script can scroll a window with overflow hidden; a person cannot, so nothing here "scrolls sideways".
    expect(byRule(report, 'rampa/reflow')).toEqual([])
    const review = reviewByRule(report, 'rampa/reflow')
    expect(review.map((f) => f.ref)).toEqual(['#notice'])
    expect(review[0]?.evidence).toMatch(/the window does not scroll sideways; <p> "Offices close.*px past the right edge \(320 px\)$/)
  })

  it('runs from the programmatic check() too', async () => {
    if (!browser) return
    const [report] = await check(resolve('test/fixtures/probes/reflow-fail.html'), { noLlm: true, config: false, waivers: [], probes: ['layout'], browser })
    expect(report?.coverage.probes?.find((c) => c.criterion === '1.4.10')).toMatchObject({ status: 'failures', failures: 2 })
    // Experimental: below the default threshold.
    expect(report?.belowThreshold.filter((f) => f.ruleId === 'rampa/reflow')).toHaveLength(2)
  })

  it('keeps experimental findings below the default threshold', async () => {
    const { snapshot, engine } = await probed('reflow-fail.html')
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions({ minConfidence: 'medium' }))
    expect(byRule(report, 'rampa/reflow')).toEqual([])
    expect(report.belowThreshold.filter((f) => f.ruleId === 'rampa/reflow')).toHaveLength(2)
    const text = renderReport(report, { verbose: true, paint: paint(false) })
    expect(text).toContain('1.4.10  probe/layout@1 (rampa/reflow) · 320×256 CSS px from 1280×1024')
  })

  it('replays a saved snapshot offline to the same findings', async () => {
    const { snapshot, engine } = await probed('reflow-fail.html')
    const live = await checkSnapshot(snapshot, engine, probeCheckOptions())
    const dir = await mkdtemp(join(tmpdir(), 'rampa-probes-'))
    const path = join(dir, 'reflow.snapshot.json')
    await writeFile(path, JSON.stringify(snapshot), 'utf8')
    await writeFile(join(dir, 'reflow.engine.json'), JSON.stringify(engine), 'utf8')
    const loaded = await loadRecorded(path, 'en')
    const replayed = await checkSnapshot(loaded.snapshot, loaded.engine, probeCheckOptions())
    const key = (report: Report) => report.findings.map((f) => `${f.fingerprint} ${f.evidence}`)
    expect(key(replayed)).toEqual(key(live))
    expect(replayed.coverage.probes).toEqual(live.coverage.probes)
  })

  it('fails text cut by raised spacing (F104, C35, C36) and an ellipsis with no full text; overlaps go to review', async () => {
    const { snapshot, engine } = await probed('spacing-fail.html')
    const record = snapshot.observations?.probes.find((p) => p.conditions.variant === 'text-spacing')
    expect(record?.data).toMatchObject({ spacing: { applied: ['line-height 1.5', 'letter-spacing 0.12em', 'word-spacing 0.16em', 'p margin-bottom 2em'], skipped: [] } })
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    const findings = byRule(report, 'rampa/text-spacing')
    expect(findings.map((f) => `${f.ref} ${f.confidence}`).sort()).toEqual(['#badge medium', '#card high', '#cart high'])
    expect(findings.find((f) => f.ref === '#card')?.evidence).toMatch(/^before: whole; with the spacing: \d+ px cut down by <div> #card$/)
    expect(findings.find((f) => f.ref === '#badge')?.evidence).toContain('shown with an ellipsis')
    const review = reviewByRule(report, 'rampa/text-spacing')
    expect(review.map((f) => f.ref)).toEqual(['#after-title'])
    expect(review[0]?.evidence).toMatch(/and <div> "Limited edition item" overlap by \d+×\d+ px/)
    expect(report.coverage.probes?.find((c) => c.criterion === '1.4.12')).toMatchObject({ status: 'failures', failures: 3, review: 1 })
  })

  it('writes the evidence and the coverage line in the report language', async () => {
    const { snapshot, engine } = await probed('spacing-fail.html')
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions({ locale: 'pt-BR' }))
    expect(byRule(report, 'rampa/text-spacing').find((f) => f.ref === '#card')?.evidence).toMatch(/^antes: inteiro; com o espaçamento: \d+ px cortados na vertical por <div> #card$/)
    expect(report.coverage.probes?.find((c) => c.criterion === '1.4.12')?.conditions).toMatch(/^espaçamento do usuário em 1280×1024 · /)
  })

  it('finds nothing when boxes grow, the full text is in a title, text scrolls, or text was already cut', async () => {
    const { snapshot, engine } = await probed('spacing-pass.html')
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    expect(byRule(report, 'rampa/text-spacing')).toEqual([])
    expect(reviewByRule(report, 'rampa/text-spacing')).toEqual([])
    expect(report.coverage.probes?.find((c) => c.criterion === '1.4.12')?.status).toBe('no-failure-found')
  })

  it('leaves out word spacing for a language written without spaces, and says so', async () => {
    if (!browser) return
    const page = 'data:text/html;charset=utf-8,<html lang="ja"><body><p>テキストの間隔</p></body></html>'
    const { snapshot, engine } = await collectWeb(browser, page, { runAxe: false, locale: 'en', probes: ['layout'] })
    const record = snapshot.observations?.probes.find((p) => p.conditions.variant === 'text-spacing')
    expect(record?.data).toMatchObject({ spacing: { skipped: ['word-spacing (lang ja)'] } })
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    expect(report.coverage.probes?.find((c) => c.criterion === '1.4.12')?.note).toContain('not applied: word-spacing (lang ja)')
  })

  it('records the page at 640×512 CSS px and device scale 2 for 1.4.4 (200% zoom)', async () => {
    const { snapshot } = await probed('zoom-fail.html')
    expect(A11ySnapshotSchema.safeParse(snapshot).success).toBe(true)
    const record = snapshot.observations?.probes.find((p) => p.conditions.variant === 'zoom-200')
    expect(record).toMatchObject({ kind: 'layout', version: '1', status: 'complete', conditions: { viewport: { width: 640, height: 512 }, deviceScaleFactor: 2 } })
    expect(record?.data).toMatchObject({ from: { width: 1280, height: 1024 }, scale: 2 })
  })

  it('fails text cut at 200% zoom as ACT 59br37 does: high when zoom cut it, medium when it was already cut', async () => {
    const { snapshot, engine } = await probed('zoom-fail.html')
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    const findings = byRule(report, 'rampa/resize-text')
    expect(findings.map((f) => `${f.ref} ${f.confidence}`).sort()).toEqual(['#banner high', '#narrow high', '#tiny medium', '#vh-box high', '#word-clip medium'])
    expect(findings.every((f) => f.source === 'probe' && f.experimental && f.criterion === '1.4.4')).toBe(true)
    expect(findings.find((f) => f.ref === '#banner')?.evidence).toMatch(/^at 640×512 CSS px, device scale 2: \d+ px cut down by #banner \(box \d+ px high, line height \d+ px \(normal\)\); at 1280×1024 whole$/)
    // The ellipsis excuses a horizontal cut only; a box shorter than its letters is cut down (Failed Example 4).
    expect(findings.find((f) => f.ref === '#tiny')?.evidence).toMatch(/cut down by #tiny \(box 10 px high.*at 1280×1024 already cut/)
    expect(findings.find((f) => f.ref === '#word-clip')?.evidence).toMatch(/cut across by #word-clip \(white-space nowrap, text-overflow clip\)/)
    expect(report.coverage.probes?.find((c) => c.criterion === '1.4.4')).toMatchObject({ method: 'probe/layout@1', rule: 'rampa/resize-text', status: 'failures', failures: 5 })
    expect(report.coverage.criteria?.find((c) => c.id === '1.4.4')?.methods).toContainEqual(expect.objectContaining({ kind: 'probe', id: 'rampa/resize-text', ran: true, maturity: 'experimental' }))
  })

  it('sends text the narrow window hid, and new overlaps, to review; a menu behind a button and content a script removed are only counted', async () => {
    const { snapshot, engine } = await probed('zoom-fail.html')
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    const review = reviewByRule(report, 'rampa/resize-text')
    expect(review.map((f) => f.ref).sort()).toEqual(['#product > p', '#side-note'])
    expect(review.find((f) => f.ref === '#side-note')?.evidence).toMatch(/^at 1280×1024 shown; at 640×512 CSS px display: none \(<p> #side-note\): 1 text box\(es\), such as "Members get early access/)
    expect(review.find((f) => f.ref === '#product > p')?.evidence).toMatch(/and <span> "Now \$24\.00 each" overlap by \d+×\d+ px at 640×512 CSS px/)
    const note = report.coverage.probes?.find((c) => c.criterion === '1.4.4')?.note
    expect(note).toContain('2 hidden text box(es) sit behind a menu button, not opened')
    expect(note).toContain('1 text box(es) gone at 640 px and not back at 1280 px')
  })

  it('finds nothing in ACT 59br37 passed and inapplicable shapes and in near misses, and counts the exceptions', async () => {
    const { snapshot, engine } = await probed('zoom-pass.html')
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    expect(byRule(report, 'rampa/resize-text')).toEqual([])
    expect(reviewByRule(report, 'rampa/resize-text')).toEqual([])
    const coverage = report.coverage.probes?.find((c) => c.criterion === '1.4.4')
    expect(coverage).toMatchObject({ status: 'no-failure-found', failures: 0, review: 0 })
    expect(coverage?.note).toContain('ACT 59br37 exceptions: 1 no-wrap ellipsis, 1 line clamp')
  })

  it('sends cuts that may be on purpose and text past the edges of a window that never scrolls to review', async () => {
    const { snapshot, engine } = await probed('zoom-review.html')
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    expect(byRule(report, 'rampa/resize-text')).toEqual([])
    const review = reviewByRule(report, 'rampa/resize-text')
    expect(review.map((f) => f.ref).sort()).toEqual(['#clamped', '#footer-note', '#titled', '#wide'])
    expect(review.find((f) => f.ref === '#clamped')?.evidence).toContain(', line clamp)')
    expect(review.find((f) => f.ref === '#titled')?.evidence).toContain('a name or title holds the full text')
    expect(review.find((f) => f.ref === '#wide')?.evidence).toMatch(/the window does not scroll sideways; .*px past the right edge \(640 px\)$/)
    expect(review.find((f) => f.ref === '#footer-note')?.evidence).toMatch(/the window does not scroll down; 1 text box\(es\) inside the window at 1280×1024 reach past its bottom edge \(512 px\)/)
  })

  it('writes the 1.4.4 evidence in the report language', async () => {
    const { snapshot, engine } = await probed('zoom-fail.html')
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions({ locale: 'pt-BR' }))
    expect(byRule(report, 'rampa/resize-text').find((f) => f.ref === '#banner')?.evidence).toMatch(/^com 640×512 px CSS, escala 2: \d+ px cortados na vertical por #banner .*; com 1280×1024 inteiro$/)
    expect(report.coverage.probes?.find((c) => c.criterion === '1.4.4')?.conditions).toMatch(/^640×512 px CSS com escala 2 \(1280×1024 a 200%\) · /)
  })

  it('reports nothing about an element whose identity changed between loads', async () => {
    const { snapshot, engine } = await probed('reflow-fail.html')
    const changed = structuredClone(snapshot) as A11ySnapshot
    for (const node of walkTree(changed.root)) {
      if (node.ref === '#wide-text') node.native = { ...node.native, tag: 'div' }
    }
    const report = await checkSnapshot(changed, engine, probeCheckOptions())
    expect(byRule(report, 'rampa/reflow').map((f) => f.ref)).toEqual(['#promo'])
    expect(report.coverage.probes?.find((c) => c.criterion === '1.4.10')?.unmatched).toBe(1)
  })
})

