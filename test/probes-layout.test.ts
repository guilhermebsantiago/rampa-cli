import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
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
afterAll(async () => browser?.close())

const collected = new Map<string, Collected>()
async function probed(name: string): Promise<Collected> {
  const cached = collected.get(name)
  if (cached) return cached
  if (!browser) throw new Error('no browser')
  const result = await collectWeb(browser, fixture(name), { runAxe: false, locale: 'en', probes: ['layout'] })
  collected.set(name, result)
  return result
}

describe.skipIf(!browser)('reflow probe (1.4.10)', { timeout: 60_000 }, () => {
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

