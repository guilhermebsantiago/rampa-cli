import type { EngineResults } from '../core/types.ts'

/**
 * Whether the engine fails an ACT test case: a violation counts only from a rule that implements
 * that ACT rule (axe-core's `actIds`). A rule for the same criterion that tests something else,
 * such as html-lang-valid on a page of ucwvc8 (language matches the content), is not the rule under test.
 */
export function engineFailsAct(engine: EngineResults, criterion: string, actRuleId: string, actIds: ReadonlyMap<string, readonly string[]>): boolean {
  return engine.rules.some((rule) => rule.outcome === 'violation' && rule.criteria.includes(criterion) && (actIds.get(rule.ruleId) ?? []).includes(actRuleId))
}

export interface Confusion {
  tp: number
  fp: number
  tn: number
  fn: number
}

export interface Scores extends Confusion {
  n: number
  precision: number | undefined
  recall: number | undefined
  f1: number | undefined
  /** 95% Wilson interval. */
  recallCi: [number, number] | undefined
  precisionCi: [number, number] | undefined
}

export function confusion(pairs: ReadonlyArray<{ expected: boolean; predicted: boolean }>): Confusion {
  const c: Confusion = { tp: 0, fp: 0, tn: 0, fn: 0 }
  for (const { expected, predicted } of pairs) {
    if (expected && predicted) c.tp++
    else if (!expected && predicted) c.fp++
    else if (!expected && !predicted) c.tn++
    else c.fn++
  }
  return c
}

export function scores(c: Confusion): Scores {
  const precision = c.tp + c.fp > 0 ? c.tp / (c.tp + c.fp) : undefined
  const recall = c.tp + c.fn > 0 ? c.tp / (c.tp + c.fn) : undefined
  const f1 = precision !== undefined && recall !== undefined && precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : undefined
  return {
    ...c,
    n: c.tp + c.fp + c.tn + c.fn,
    precision,
    recall,
    f1,
    recallCi: wilson(c.tp, c.tp + c.fn),
    precisionCi: wilson(c.tp, c.tp + c.fp),
  }
}

/** Wilson score interval; behaves well with the small samples ACT gives us. */
export function wilson(successes: number, total: number, z = 1.96): [number, number] | undefined {
  if (total === 0) return undefined
  const p = successes / total
  const denominator = 1 + (z * z) / total
  const center = (p + (z * z) / (2 * total)) / denominator
  const margin = (z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total))) / denominator
  return [Math.max(0, center - margin), Math.min(1, center + margin)]
}
