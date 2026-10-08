import { describe, expect, it } from 'vitest'
import { confusion, scores, wilson } from '../src/eval/metrics.ts'

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
