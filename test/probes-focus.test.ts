import { afterAll, describe, expect, it } from 'vitest'
import { checkSnapshot } from '../src/core/check.ts'
import type { Report } from '../src/core/types.ts'
import { exitCode } from '../src/cli/exit-code.ts'
import type { RgbaImage } from '../src/pixels/png.ts'
import { diffImages } from '../src/probes/pixels.ts'
import { DETERMINISM_ARGS } from '../src/probes/run.ts'
import { collectWeb, launchBrowser } from '../src/surfaces/web.ts'
import { byRule, fixture, probeCheckOptions, reviewByRule } from './probe-helpers.ts'

const solid = (width: number, height: number, rgb: [number, number, number]): RgbaImage => {
  const data = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i++) data.set([...rgb, 255], i * 4)
  return { width, height, data }
}

describe('pixel diff', () => {
  it('counts changed pixels, those that change by 3:1, and leaves out pixels that move on their own', () => {
    const before = solid(10, 10, [255, 255, 255])
    const after = solid(10, 10, [255, 255, 255])
    // A 1 px dark ring on the top row, and a faint change on the second row.
    for (let x = 0; x < 10; x++) after.data.set([0, 0, 0, 255], x * 4)
    for (let x = 0; x < 10; x++) after.data.set([244, 244, 244, 255], (10 + x) * 4)
    const noise = solid(10, 10, [255, 255, 255])
    // The last row flickers between two captures of the same state: masked.
    for (let x = 0; x < 10; x++) noise.data.set([10, 10, 10, 255], (90 + x) * 4)
    for (let x = 0; x < 10; x++) after.data.set([200, 0, 0, 255], (90 + x) * 4)
    const diff = diffImages(after, before, noise)
    expect(diff).toMatchObject({ area: 100, changed: 20, strong: 10, noticeable: 10, masked: 10, bbox: { x: 0, y: 0, width: 10, height: 2 }, before: '#ffffff' })
    expect(diffImages(before, before)).toMatchObject({ changed: 0, strong: 0, masked: 0 })
  })
})

// Integration: needs Chrome or Edge. Skipped, with the reason on stderr, when none starts.
const browser = await launchBrowser({ args: DETERMINISM_ARGS }).catch((error: unknown) => {
  process.stderr.write(`\nSkipping the focus probe tests: no browser started (${error instanceof Error ? error.message.split('\n')[0] : String(error)}).\n`)
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
      return checkSnapshot(snapshot, engine, probeCheckOptions())
    })()
    reports.set(name, report)
  }
  return report
}

describe.skipIf(!browser)('focus visible and focus not obscured', { timeout: 120_000 }, () => {
  it('2.4.7: fails no change anywhere and focus removed on arrival; a faint change and a change elsewhere go to review', async () => {
    const report = await probed('focus-fail.html')
    const findings = byRule(report, 'rampa/focus-visible')
    expect(findings.map((f) => `${f.ref} ${f.confidence}`)).toEqual(['#no-ring high', '#blurry high'])
    expect(findings[0]?.evidence).toMatch(/^Tab ×2: <a> "No ring" focused and blurred; 0 px changed in the \d+×\d+ px around the element, 0 px in the 1024000 px of the viewport \(captured twice\)$/)
    expect(findings[1]?.evidence).toContain('150 ms later focus is back on the document')
    const review = reviewByRule(report, 'rampa/focus-visible')
    expect(review.map((f) => f.ref)).toEqual(['#faint', '#far'])
    expect(review[0]?.evidence).toMatch(/0 by at least 3:1, 0 noticeably \(mostly #ffffff → #f4f4f4\).*a 1 px outline around its/)
    expect(review[1]?.evidence).toMatch(/0 px changed in the .* elsewhere in the viewport/)
    // A visible ring is "no failure found", never a pass: nothing is said about #ok.
    expect([...findings, ...review].some((f) => f.ref === '#ok')).toBe(false)
    expect(report.coverage.probes?.find((c) => c.criterion === '2.4.7')).toMatchObject({ status: 'failures', failures: 2, review: 2, method: 'probe/keyboard@2' })
  })

  it('2.4.11: fails an element entirely under an opaque banner, names the banner, and never counts toward the exit code', async () => {
    const report = await probed('focus-obscured.html')
    // Once at the run's window size and once in the narrow walk at 390×844, as two findings.
    const [finding, narrow, ...rest] = byRule(report, 'rampa/focus-obscured')
    expect(rest).toEqual([])
    expect(finding?.ref).toBe('#second')
    expect(finding?.evidence).toMatch(/^Tab ×2 in a 1280×800 window: /)
    expect(narrow?.ref).toBe('#second')
    expect(narrow?.evidence).toMatch(/^Tab ×2 in a 390×844 window: .*#cookies \(position: fixed, 390×\d+ px/)
    expect(narrow?.fingerprint).not.toBe(finding?.fingerprint)
    expect(report.coverage.probes?.filter((c) => c.criterion === '2.4.11').map((c) => c.conditions.split(' · ')[0])).toEqual([
      '5×5 hit grid at 1280×800, both directions',
      '5×5 hit grid at 390×844, both directions',
    ])
    expect(finding?.beyondTarget).toBe(true)
    expect(finding?.evidence).toMatch(/25 of 25 grid points hit <div> "Cookies" #cookies \(position: fixed, .*painting it changed 0 px and hiding it 0 px; scroll-padding-bottom: \d+px on html/)
    // The same element shows no focus change either: reported under 2.4.7 at medium, pointing at 2.4.11.
    const visible = byRule(report, 'rampa/focus-visible').find((f) => f.ref === '#second')
    expect(visible?.confidence).toBe('medium')
    expect(visible?.evidence).toContain('(see 2.4.11)')
    const only = { ...report, findings: report.findings.filter((f) => f.criterion === '2.4.11') }
    expect(exitCode([only], 'confirmed')).toBe(0)
    expect(exitCode([only], 'any')).toBe(0)
  })

  it('finds nothing with a visible ring, a sticky header kept clear by scroll-padding, and a translucent bar', async () => {
    const report = await probed('focus-pass.html')
    expect(byRule(report, 'rampa/focus-visible')).toEqual([])
    expect(reviewByRule(report, 'rampa/focus-visible')).toEqual([])
    expect(byRule(report, 'rampa/focus-obscured')).toEqual([])
    expect(report.coverage.probes?.find((c) => c.criterion === '2.4.11')?.note).toContain('lets pixels through')
  })
})
