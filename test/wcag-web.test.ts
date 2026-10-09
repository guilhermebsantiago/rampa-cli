import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { exitCode } from '../src/cli/exit-code.ts'
import { memoryCache } from '../src/core/cache.ts'
import { type CheckOptions, checkSnapshot } from '../src/core/check.ts'
import type { CriterionCoverage, Report } from '../src/core/types.ts'
import { collectWeb } from '../src/surfaces/web.ts'
import { launchTestBrowser } from './browser.ts'

// Integration: axe-core in a real browser, one for the whole file; skipped, with the reason printed, when none starts.
const launched = await launchTestBrowser('the WCAG 2.2 coverage tests')
const browser = 'browser' in launched ? launched.browser : undefined
if ('skip' in launched) console.warn(launched.skip)
// Closing can be slow while other suites run their own browsers.
afterAll(async () => browser?.close(), 60_000)

function options(extra: Partial<CheckOptions> = {}): CheckOptions {
  return { criteria: [], llm: false, provider: undefined, runs: 1, cache: memoryCache(), offline: false, locale: 'en', minConfidence: 'medium', concurrency: 1, ...extra }
}

const record = (report: Report, id: string): CriterionCoverage | undefined => report.coverage.criteria?.find((r) => r.id === id)

describe('needs review on a real page', { timeout: 60_000 }, () => {
  it.skipIf(!browser)('shows 2.4.1 and 1.2.2 as needs review, with what axe-core found, when no rule can fail', async () => {
    if (!browser) return
    const url = pathToFileURL(resolve('test/fixtures/coverage/review.html')).href
    const { snapshot, engine } = await collectWeb(browser, url, { runAxe: true, locale: 'en' })
    const report = await checkSnapshot(snapshot, engine, options())
    expect(record(report, '2.4.1')?.status).toBe('needs-review')
    expect(record(report, '1.2.2')?.status).toBe('needs-review')
    expect(report.coverage.engine).not.toContain('2.4.1')
    expect(report.coverage.engine).not.toContain('1.2.2')
    expect(report.coverage.notChecked).not.toContain('2.4.1')
    const reviewed = report.needsReview?.map((item) => [item.criterion, item.ruleId]) ?? []
    expect(reviewed).toContainEqual(['2.4.1', 'bypass'])
    expect(reviewed).toContainEqual(['1.2.2', 'video-caption'])
    expect(report.findings.filter((f) => ['1.2.2', '2.4.1'].includes(f.criterion))).toEqual([])
  })
})

async function collect(name: string, wcag?: '2.1' | '2.2') {
  if (!browser) throw new Error('no browser')
  const url = pathToFileURL(resolve(`test/fixtures/target-size/${name}.html`)).href
  return collectWeb(browser, url, { runAxe: true, locale: 'en', ...(wcag ? { wcag } : {}) })
}

describe.skipIf(!browser)('2.5.8 Target Size (Minimum) on the web', { timeout: 60_000 }, () => {
  it('fails touching icon buttons, close dots, small pagination links, a lone small link and redrawn checkboxes', async () => {
    const { snapshot, engine } = await collect('fail')
    const report = await checkSnapshot(snapshot, engine, options({ minConfidence: 'low' }))
    const failing = report.findings.filter((f) => f.criterion === '2.5.8')
    expect(failing.map((f) => f.ref).sort()).toEqual(
      ['#crop', '#rotate', '#flip', '#dot-1', '#dot-2', '#dot-3', '#page-1', '#page-2', '#page-3', '#photos', '#grid', '#snap'].sort(),
    )
    expect(failing.every((f) => f.ruleId === 'target-size' && f.level === 'AA' && f.confidence === 'low')).toBe(true)
    expect(report.coverage.criteria?.find((r) => r.id === '2.5.8')).toMatchObject({
      status: 'failures',
      methods: [{ kind: 'axe', id: 'target-size', maturity: 'experimental' }],
    })
  })

  it('reports below the default threshold while experimental, so the exit code stays as it was', async () => {
    const { snapshot, engine } = await collect('fail')
    const report = await checkSnapshot(snapshot, engine, options())
    expect(report.findings.filter((f) => f.criterion === '2.5.8')).toEqual([])
    expect(report.belowThreshold.filter((f) => f.criterion === '2.5.8')).toHaveLength(12)
    expect(report.coverage.criteria?.find((r) => r.id === '2.5.8')?.status).toBe('needs-review')
    expect(exitCode([report], 'confirmed')).toBe(0)
  })

  it('passes spaced 16 px buttons, native date fields and checkboxes, inline links and a link with a larger equivalent', async () => {
    const { snapshot, engine } = await collect('pass')
    const sizes = engine.rules.filter((rule) => rule.ruleId === 'target-size')
    expect(sizes.filter((rule) => rule.outcome === 'violation' || rule.outcome === 'incomplete')).toEqual([])
    const exempt = sizes.flatMap((rule) => rule.nodes.filter((n) => n.exempt).map((n) => [n.ref, n.exempt]))
    expect(exempt).toEqual([
      ['#flexible', 'user-agent-control'],
      ['#pets', 'user-agent-control'],
      ['#more', 'equivalent-target'],
    ])
    const report = await checkSnapshot(snapshot, engine, options({ minConfidence: 'low' }))
    expect(report.findings.filter((f) => f.criterion === '2.5.8')).toEqual([])
    expect(report.coverage.criteria?.find((r) => r.id === '2.5.8')?.status).toBe('no-failure-found')
    // The checker leaves no trace in the page it measured.
    expect(snapshot.root.children.some((child) => child.role === 'iframe')).toBe(false)
  })

  it('does not run under --wcag 2.1, where 2.5.8 is beyond the target', async () => {
    const { snapshot, engine } = await collect('fail', '2.1')
    expect(engine.rules.some((rule) => rule.ruleId === 'target-size')).toBe(false)
    const report = await checkSnapshot(snapshot, engine, options({ wcag: '2.1', minConfidence: 'low' }))
    expect(report.coverage.criteria?.some((r) => r.id === '2.5.8')).toBe(false)
    expect(report.coverage.notChecked).not.toContain('2.5.8')
  })

  it('runs no deprecated or experimental axe-core rule, and finds nothing on 4.1.1, under either version', async () => {
    const axe = createRequire(import.meta.url)('axe-core') as { getRules(): Array<{ ruleId: string; tags: string[] }> }
    const tags = new Map(axe.getRules().map((rule) => [rule.ruleId, rule.tags]))
    for (const version of ['2.1', '2.2'] as const) {
      const { snapshot, engine } = await collect('fail', version)
      for (const rule of engine.rules) {
        expect(tags.get(rule.ruleId), rule.ruleId).not.toContain('deprecated')
        expect(tags.get(rule.ruleId), rule.ruleId).not.toContain('experimental')
        expect(rule.criteria, rule.ruleId).not.toContain('4.1.1')
      }
      const report = await checkSnapshot(snapshot, engine, options({ wcag: version, minConfidence: 'low' }))
      expect([...report.findings, ...report.belowThreshold].some((f) => f.criterion === '4.1.1')).toBe(false)
    }
  })
})
