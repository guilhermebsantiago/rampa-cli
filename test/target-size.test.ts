import { describe, expect, it } from 'vitest'
import type { EngineRuleResult } from '../src/core/types.ts'
import { runRules } from '../src/engine/rules.ts'
import { applyTargetSizeExceptions } from '../src/rules/target-size.ts'
import type { A11yNode, A11ySnapshot } from '../src/snapshot/schema.ts'

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
