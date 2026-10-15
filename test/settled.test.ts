import { describe, expect, it } from 'vitest'
import { settledResults } from '../src/core/check.ts'
import type { Confidence, Finding } from '../src/core/types.ts'
import { type ProbeRule, probeChecks, probeFinding } from '../src/rules/probes.ts'
import type { Settlement } from '../src/rules/types.ts'
import type { A11ySnapshot } from '../src/snapshot/schema.ts'
import { node } from './helpers.ts'

/**
 * A rule that takes over what axe-core left undecided (`RuleCheck.resolves`, a probe rule's `resolved`) replaces
 * axe-core's item to review only with something the report shows: its own item to review, a failure at the threshold,
 * or a pass at a confidence that meets it. An experimental rule never takes an item to review away at the default one.
 */
describe("which of axe-core's items to review a rule settles", () => {
  const settlement = (outcome: Settlement['outcome'], extra: Partial<Settlement> = {}): Settlement => ({
    engineRule: 'video-caption',
    ref: '#film',
    rule: 'rampa/captions',
    criteria: ['1.2.2'],
    outcome,
    experimental: true,
    ...extra,
  })
  const finding = (extra: Partial<Finding> = {}): Finding => ({
    fingerprint: 'f',
    criterion: '1.2.2',
    level: 'A',
    source: 'probe',
    ref: '#film',
    target: '#film',
    message: 'The captions track of this video holds no cues.',
    confidence: 'high',
    ruleId: 'rampa/captions',
    experimental: true,
    ...extra,
  })
  const settle = (s: Settlement, threshold: Confidence, shown: Finding[] = [], below: Finding[] = []) => {
    const { settled, context } = settledResults([s], { shown, below, threshold, locale: 'en' })
    return { settled: settled.get(s.engineRule)?.has(s.ref) === true, context: context.get(`${s.engineRule}|${s.ref}`) }
  }

  it("settles an element the rule sent to its own review, or axe-core failed itself, at any threshold", () => {
    for (const threshold of ['low', 'medium', 'high'] as const) {
      expect(settle(settlement('review'), threshold)).toEqual({ settled: true, context: undefined })
      expect(settle(settlement('engine'), threshold)).toEqual({ settled: true, context: undefined })
    }
  })

  it('settles a failure the report shows, and keeps the item with the failure as its evidence when it is below the threshold', () => {
    expect(settle(settlement('fail'), 'low', [finding()])).toEqual({ settled: true, context: undefined })
    expect(settle(settlement('fail'), 'medium', [], [finding()])).toEqual({
      settled: false,
      context: "Rampa's rampa/captions measured it, below the confidence threshold: The captions track of this video holds no cues.",
    })
    // A model's finding that replaced the rule's on the same element, for the same criterion, is shown just the same.
    expect(settle(settlement('fail'), 'medium', [finding({ source: 'judgment', ruleId: undefined, experimental: undefined })])).toMatchObject({ settled: true })
  })

  it("settles a pass only when the rule's confidence meets the threshold", () => {
    expect(settle(settlement('pass'), 'low')).toEqual({ settled: true, context: undefined })
    expect(settle(settlement('pass'), 'medium')).toEqual({ settled: false, context: "Rampa's rampa/captions measured it and found no failure, below the confidence threshold." })
    // A stable rule's pass is a high-confidence result.
    expect(settle(settlement('pass', { experimental: false }), 'high')).toEqual({ settled: true, context: undefined })
  })

  it("says what the rule measured in the report's language", () => {
    const { context } = settledResults([settlement('pass')], { shown: [], below: [], threshold: 'medium', locale: 'pt-BR' })
    expect(context.get('video-caption|#film')).toBe('O rampa/captions do Rampa o mediu e não achou falha, abaixo do limiar de confiança.')
  })
})

describe("a probe rule's settlements", () => {
  const snapshot: A11ySnapshot = {
    schemaVersion: 1,
    surface: 'web',
    target: 'test://media',
    viewport: { width: 1280, height: 800, scale: 1 },
    collectedAt: '2026-10-15T00:00:00.000Z',
    collector: { name: 'test', version: '0' },
    root: node({ ref: 'html', role: 'document', children: [node({ ref: '#a', role: 'video' }), node({ ref: '#b', role: 'video' }), node({ ref: '#c', role: 'video' })] }),
    observations: {
      probes: [
        {
          kind: 'media',
          version: '1',
          conditions: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, browser: 'test', variant: 'media' },
          status: 'complete',
          guard: { blocked: [], navigations: [], dialogs: [] },
          durationMs: 1,
          data: {},
        },
      ],
    },
  }
  const rule: ProbeRule = {
    id: 'rampa/test-captions',
    kind: 'media',
    variant: 'media',
    versions: ['1'],
    criteria: ['1.2.2'],
    run(_record, ctx) {
      const at = (ref: string) => ctx.index.get(ref)?.node ?? node({ ref })
      const make = (ref: string) => probeFinding({ criterion: '1.2.2', rule: this.id, node: at(ref), message: ref, evidence: ref, confidence: 'high', subject: ref })
      return {
        findings: [make('#a')],
        review: [make('#b')],
        coverage: [],
        resolved: ['#a', '#b', '#c'].map((ref) => ({ engineRule: 'video-caption', ref })),
      }
    },
  }

  it('records, for each element it took over, whether it failed it, sent it to review or passed it', () => {
    const result = probeChecks(snapshot, 'en', [rule])
    expect(result.settlements?.map((s) => `${s.ref} ${s.outcome} ${s.experimental}`)).toEqual(['#a fail true', '#b review true', '#c pass true'])
    expect(result.settlements?.[0]).toMatchObject({ engineRule: 'video-caption', rule: 'rampa/test-captions', criteria: ['1.2.2'] })
  })
})
