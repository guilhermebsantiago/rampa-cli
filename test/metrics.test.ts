import { describe, expect, it } from 'vitest'
import { axeActIds } from '../src/engine/axe.ts'
import { confusion, engineFailsAct, scores, wilson } from '../src/eval/metrics.ts'

describe('metrics', () => {
  it('computes precision, recall and F1 from page verdicts', () => {
    const result = scores(
      confusion([
        { expected: true, predicted: true },
        { expected: true, predicted: false },
        { expected: false, predicted: true },
        { expected: false, predicted: false },
        { expected: true, predicted: true },
      ]),
    )
    expect(result).toMatchObject({ tp: 2, fn: 1, fp: 1, tn: 1, n: 5 })
    expect(result.precision).toBeCloseTo(2 / 3)
    expect(result.recall).toBeCloseTo(2 / 3)
    expect(result.f1).toBeCloseTo(2 / 3)
  })

  it('leaves precision undefined when nothing was flagged', () => {
    expect(scores(confusion([{ expected: true, predicted: false }])).precision).toBeUndefined()
  })

  it('gives a wide Wilson interval for tiny samples', () => {
    const [low, high] = wilson(3, 3) ?? [0, 0]
    expect(high).toBe(1)
    expect(low).toBeGreaterThan(0.4)
    expect(low).toBeLessThan(0.5)
  })
})

describe('engine verdicts in the eval', () => {
  const engine = (ruleId: string, criteria: string[]) => ({
    engine: { name: 'axe-core', version: 'test' },
    rules: [{ ruleId, outcome: 'violation' as const, criteria, help: '', nodes: [{ target: '["html"]', html: '<html>' }] }],
  })

  it('counts an axe-core violation only for the ACT rule that axe-core rule implements', () => {
    const actIds = axeActIds()
    expect(actIds.get('html-lang-valid')).toEqual(['bf051a'])
    // html-lang-valid tests bf051a; on a page of ucwvc8 (language matches the content) it is not the rule under test.
    expect(engineFailsAct(engine('html-lang-valid', ['3.1.1']), '3.1.1', 'bf051a', actIds)).toBe(true)
    expect(engineFailsAct(engine('html-lang-valid', ['3.1.1']), '3.1.1', 'ucwvc8', actIds)).toBe(false)
    expect(engineFailsAct(engine('image-alt', ['1.1.1']), '1.1.1', '23a2a8', actIds)).toBe(true)
    expect(engineFailsAct(engine('image-alt', ['1.1.1']), '4.1.2', '23a2a8', actIds)).toBe(false)
  })
})
