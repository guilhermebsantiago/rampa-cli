import type { AnyCriterion, Maturity } from './types.ts'

/**
 * Judgment modules that have not passed the evaluation gate (docs/plans/wcag-coverage.md, 4.9; docs/criteria.md calls
 * them experimental): every finding they make is capped at low confidence, below the default threshold, whatever the
 * model says. 1.3.1, 1.3.2, 1.3.3, 2.5.3 and 3.3.1 run when asked for with --criteria; 2.4.3 judges the focus-order
 * probe's Tab sequence. A module leaves this list when it is measured on real pages and its cap is lifted.
 */
export const EXPERIMENTAL_JUDGMENTS: ReadonlySet<string> = new Set(['1.3.1', '1.3.2', '1.3.3', '2.4.3', '2.5.3', '3.3.1'])

/**
 * The maturity of a judgment module, as its coverage method and its findings state it. A judgment over a probe's
 * facts (one that clears a probe rule's finding, or settles its items to review) is as experimental as the probe.
 */
export function judgmentMaturity(criterion: Pick<AnyCriterion, 'id' | 'clears' | 'settles'>): Maturity {
  return EXPERIMENTAL_JUDGMENTS.has(criterion.id) || criterion.clears !== undefined || criterion.settles !== undefined ? 'experimental' : 'stable'
}
