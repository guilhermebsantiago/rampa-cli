import { afterAll, describe, expect, it } from 'vitest'
import { checkSnapshot } from '../src/core/check.ts'
import type { Report } from '../src/core/types.ts'
import { DETERMINISM_ARGS } from '../src/probes/run.ts'
import { A11ySnapshotSchema } from '../src/snapshot/schema.ts'
import { collectWeb, launchBrowser } from '../src/surfaces/web.ts'
import { byRule, fixture, probeCheckOptions, reviewByRule } from './probe-helpers.ts'

// Integration: needs Chrome or Edge. Skipped, with the reason on stderr, when none starts.
const browser = await launchBrowser({ args: DETERMINISM_ARGS }).catch((error: unknown) => {
  process.stderr.write(`\nSkipping the keyboard probe tests: no browser started (${error instanceof Error ? error.message.split('\n')[0] : String(error)}).\n`)
  return undefined
})
// Closing Edge can take long on a loaded machine.
afterAll(async () => browser?.close(), 60_000)

const reports = new Map<string, Promise<Report>>()
function probed(name: string): Promise<Report> {
  let report = reports.get(name)
  if (!report) {
    report = (async () => {
      if (!browser) throw new Error('no browser')
      const { snapshot, engine } = await collectWeb(browser, fixture(name), { runAxe: false, locale: 'en', probes: ['keyboard'] })
      expect(A11ySnapshotSchema.safeParse(snapshot).success).toBe(true)
      return checkSnapshot(snapshot, engine, probeCheckOptions())
    })()
    reports.set(name, report)
  }
  return report
}

const coverageOf = (report: Report, criterion: string) => report.coverage.probes?.find((c) => c.criterion === criterion)

describe.skipIf(!browser)('keyboard walk', { timeout: 120_000 }, () => {
  it('2.1.1: fails controls Tab never reaches, with the walk as evidence', async () => {
    const report = await probed('keyboard-fail.html')
    const findings = byRule(report, 'rampa/keyboard-reach')
    expect(findings.map((f) => `${f.ref} ${f.confidence}`)).toEqual(['#fake-save high', '#hidden-from-tab medium', '#colors > li:nth-of-type(1) high'])
    expect(findings[0]?.evidence).toMatch(/^Tab ×\d+ forward and Shift\+Tab ×\d+ backward reached \d+ element\(s\), never <div> "Save for later"; it has role="button" and no tabindex/)
    expect(findings[1]?.evidence).toContain('it has tabindex="-1"')
    // The listbox is reported once, not once per option.
    expect(findings.filter((f) => f.ref?.startsWith('#colors'))).toHaveLength(1)
    expect(coverageOf(report, '2.1.1')).toMatchObject({ status: 'failures', failures: 3, method: 'probe/keyboard@1' })
  })

  it('3.2.1: fails a navigation, a new window, a submission and a focus move caused by focus alone', async () => {
    const report = await probed('keyboard-fail.html')
    const findings = byRule(report, 'rampa/on-focus')
    expect(findings.map((f) => `${f.ref} ${f.confidence}`)).toEqual(['#country high', '#help high', '#coupon high', '#mover medium'])
    expect(findings[0]?.evidence).toMatch(/^Tab ×2: focus on <input> "Country"; then tried to load another page \(https:\/\/example\.invalid\/shipping\) at \+\d+ ms; nothing like it in 1500 ms/)
    expect(findings[1]?.evidence).toContain('opened a new window (https://example.invalid/help)')
    expect(findings[2]?.evidence).toContain('submitted a form (https://example.invalid/coupon)')
    expect(findings[3]?.evidence).toContain('focus went to <a> "Place order" #end')
    // The guard answered the navigation: the page never left.
    expect(coverageOf(report, '3.2.1')?.failures).toBe(4)
  })

  it('2.1.2: fails a widget that sends focus back to its start, after Tab, Shift+Tab, Esc and the arrows fail twice', async () => {
    const report = await probed('keyboard-trap.html')
    const [trap, ...rest] = byRule(report, 'rampa/keyboard-trap')
    expect(rest).toEqual([])
    expect(trap?.confidence).toBe('high')
    expect(trap?.evidence).toMatch(/^Tab cycles through 3 element\(s\) \(<button> "Bold", <button> "Italic", <textarea> "Text"\); focus did not leave with Tab; Shift\+Tab; Escape, then Tab;.* in 2 round\(s\)$/)
    // The walk was cut short by the trap: what Tab missed cannot be judged.
    expect(coverageOf(report, '2.1.1')).toMatchObject({ status: 'not-checked' })
    expect(byRule(report, 'rampa/keyboard-reach')).toEqual([])
  })

  it('2.1.2: a dialog that holds focus and ignores Esc goes to review, not to failures', async () => {
    const report = await probed('keyboard-dialog.html')
    expect(byRule(report, 'rampa/keyboard-trap')).toEqual([])
    const review = reviewByRule(report, 'rampa/keyboard-trap')
    expect(review).toHaveLength(1)
    expect(review[0]?.evidence).toContain('all inside #consent')
  })

  it('finds nothing with roving tabindex, radio groups, duplicate links, clipped slides, skip links or background timers', async () => {
    const report = await probed('keyboard-pass.html')
    for (const rule of ['rampa/keyboard-reach', 'rampa/keyboard-trap', 'rampa/on-focus']) {
      expect(byRule(report, rule)).toEqual([])
      expect(reviewByRule(report, rule)).toEqual([])
    }
    expect(coverageOf(report, '2.1.1')).toMatchObject({ status: 'no-failure-found' })
    expect(coverageOf(report, '3.2.1')).toMatchObject({ status: 'no-failure-found' })
  })
})
