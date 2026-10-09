import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { exitCode } from '../src/cli/exit-code.ts'
import { memoryCache } from '../src/core/cache.ts'
import { type CheckOptions, checkSnapshot } from '../src/core/check.ts'
import type { EngineRuleResult } from '../src/core/types.ts'
import { runRules } from '../src/engine/rules.ts'
import { applyTargetSizeExceptions } from '../src/rules/target-size.ts'
import type { A11yNode, A11ySnapshot } from '../src/snapshot/schema.ts'
import { collectWeb } from '../src/surfaces/web.ts'
import { launchTestBrowser } from './browser.ts'

function options(extra: Partial<CheckOptions> = {}): CheckOptions {
  return { criteria: [], llm: false, provider: undefined, runs: 1, cache: memoryCache(), offline: false, locale: 'en', minConfidence: 'medium', concurrency: 1, ...extra }
}

const node = (id: string, exempt?: 'user-agent-control' | 'equivalent-target') => ({ ref: `#${id}`, target: JSON.stringify([`#${id}`]), html: `<a id="${id}">`, ...(exempt ? { exempt } : {}) })

describe('target-size exceptions', () => {
  it('moves exempt targets out of the failures and keeps them as passes that say why', () => {
    const base = { ruleId: 'target-size', criteria: ['2.5.8'], help: 'All touch targets must be 24px large, or leave sufficient space' }
    const rules: EngineRuleResult[] = [
      { ...base, outcome: 'violation', nodes: [node('dot'), node('box', 'user-agent-control')] },
      { ...base, outcome: 'incomplete', nodes: [node('more', 'equivalent-target')] },
      { ...base, outcome: 'pass', nodes: [node('card')] },
      { ruleId: 'image-alt', outcome: 'pass', criteria: ['1.1.1'], help: '', nodes: [node('img')] },
    ]
    const applied = applyTargetSizeExceptions(rules)
    expect(applied.map((rule) => [rule.ruleId, rule.outcome, rule.nodes.map((n) => n.ref)])).toEqual([
      ['target-size', 'violation', ['#dot']],
      ['target-size', 'pass', ['#card', '#box', '#more']],
      ['image-alt', 'pass', ['#img']],
    ])
    expect(applied[1]?.nodes.find((n) => n.ref === '#box')?.exempt).toBe('user-agent-control')
    expect(applyTargetSizeExceptions(rules.slice(3))).toEqual(rules.slice(3))
  })
})

describe('target size on iOS, from bounds', () => {
  const control = (ref: string, x: number, y: number, width: number, height: number, extra: Partial<A11yNode> = {}): A11yNode => ({
    ref,
    role: 'button',
    name: ref,
    states: [],
    native: {},
    children: [],
    bounds: { x, y, width, height },
    ...extra,
  })
  const snapshot = (children: A11yNode[]): A11ySnapshot => ({
    schemaVersion: 1,
    surface: 'ios',
    target: 'com.example.editor',
    viewport: { width: 393, height: 852, scale: 3 },
    root: { ref: '/app', role: 'application', states: [], native: {}, children },
    collectedAt: '2026-10-09T00:00:00.000Z',
    collector: { name: 'test', version: '0' },
  })

  it('fails small controls that touch, and passes small ones with room and large ones', () => {
    const engine = runRules(
      snapshot([
        control('crop', 16, 100, 20, 20),
        control('rotate', 36, 100, 20, 20),
        control('zoom-in', 16, 200, 16, 16),
        control('zoom-out', 44, 200, 16, 16),
        control('done', 300, 100, 44, 44),
        control('disabled', 100, 100, 10, 10, { states: ['disabled'] }),
      ]),
      { locale: 'en' },
    )
    const sizes = engine.rules.filter((rule) => rule.ruleId === 'target-size')
    expect(sizes.find((r) => r.outcome === 'violation')?.nodes.map((n) => n.ref)).toEqual(['crop', 'rotate'])
    expect(sizes.find((r) => r.outcome === 'pass')?.nodes.map((n) => n.ref)).toEqual(['zoom-in', 'zoom-out', 'done'])
    const crop = sizes.find((r) => r.outcome === 'violation')?.nodes[0]
    expect(crop).toMatchObject({ confidence: 'low', evidence: '20×20 pt' })
    expect(crop?.detail).toContain('too close to "rotate"')
    expect(sizes[0]?.help).toContain('applied to non-web software')
  })

  it('does not measure Android dumps, whose bounds are screen pixels with no density', () => {
    const android = { ...snapshot([control('crop', 16, 100, 20, 20), control('rotate', 36, 100, 20, 20)]), surface: 'android' as const }
    expect(runRules(android, { locale: 'en' }).rules.some((rule) => rule.ruleId === 'target-size')).toBe(false)
  })
})

// Integration: axe-core in a real browser; skipped, with the reason printed, when none starts.
const launched = await launchTestBrowser('the target size tests')
const browser = 'browser' in launched ? launched.browser : undefined
if ('skip' in launched) console.warn(launched.skip)
afterAll(async () => browser?.close())

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
})
