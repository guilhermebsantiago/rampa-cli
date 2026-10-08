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
