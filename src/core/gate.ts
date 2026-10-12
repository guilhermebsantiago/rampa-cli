import { t } from '../i18n.ts'
import { type Confidence, CONFIDENCE_RANK, type CriterionSummary, type Finding, type Report } from './types.ts'
import { RampaError } from './util.ts'

/**
 * The CI gate, shared by the exit code (cli/exit-code.ts) and the SARIF levels (report/sarif.ts), so a finding is
 * an `error` in code scanning exactly when it fails the run.
 */

/** The confidence levels, lowest first: the values `minConfidence` takes. */
export const CONFIDENCE_LEVELS = ['low', 'medium', 'high'] as const satisfies readonly Confidence[]

/**
 * When `rampa check` exits with 1, so CI can gate on it:
 * - confirmed (default): any finding at or above --min-confidence
 * - any: also the findings below it
 * - A: confirmed findings on Level A criteria
 * - AA: confirmed findings on Level A or AA criteria, what AA conformance needs
 * - advisory: confirmed findings, and also the confirmed advisories of a --profile; no other policy sees advisories
 * - none (or never): never on findings
 * Waived findings never count.
 */
export const FAIL_ON = ['confirmed', 'any', 'A', 'AA', 'advisory', 'none', 'never'] as const
export type FailOn = (typeof FAIL_ON)[number]

/**
 * A minConfidence from outside the type system (a config file, a call from JavaScript): an unknown level would rank as
 * undefined, every finding would fall below it, and the gate would pass whatever the page has.
 */
export function assertConfidence(value: unknown, name = 'minConfidence'): Confidence {
  if (typeof value === 'string' && Object.hasOwn(CONFIDENCE_RANK, value)) return value as Confidence
  throw new RampaError('invalid-option', `${name} must be one of ${CONFIDENCE_LEVELS.join(', ')}. Got ${JSON.stringify(value) ?? String(value)}.`)
}

/**
 * Whether a finding is reported as confirmed under the threshold: its confidence reaches it, and it is not experimental,
 * since a check that has not passed the evaluation gate reports below the default threshold (only `low` shows it).
 */
export function meetsThreshold(finding: Pick<Finding, 'confidence' | 'experimental'>, minConfidence: Confidence): boolean {
  return CONFIDENCE_RANK[finding.confidence] >= CONFIDENCE_RANK[minConfidence] && (!finding.experimental || minConfidence === 'low')
}

/**
 * Whether one finding fails the policy: `confirmed` when it is in a report's findings, false when it is below the
 * threshold. A WCAG 2.2-only result in a 2.1 report is shown but never gates; waived findings never reach here.
 */
export function failsPolicy(finding: Pick<Finding, 'level' | 'beyondTarget'>, confirmed: boolean, policy: FailOn): boolean {
  if (finding.beyondTarget) return false
  switch (policy) {
    case 'none':
    case 'never':
      return false
    case 'any':
      return true
    case 'A':
      return confirmed && finding.level === 'A'
    case 'AA':
      return confirmed && (finding.level === 'A' || finding.level === 'AA')
    case 'advisory':
    case 'confirmed':
      return confirmed
  }
}

/** The findings that fail the policy, confirmed ones first. Needs-review items are never findings. */
export function failingFindings(reports: readonly Report[], policy: FailOn): Finding[] {
  return [
    ...reports.flatMap((report) => report.findings).filter((finding) => failsPolicy(finding, true, policy)),
    ...reports.flatMap((report) => report.belowThreshold).filter((finding) => failsPolicy(finding, false, policy)),
  ]
}

/** A criterion whose every candidate the model failed on: the run cannot vouch for it. */
export function brokenCriteria(report: Pick<Report, 'criteria'>): CriterionSummary[] {
  return report.criteria.filter((criterion) => criterion.errors > 0 && criterion.judged === 0)
}

/**
 * Judgment was asked for (not --no-llm), some candidates needed a model, and the model judged none of them: offline
 * with nothing in the cache, no model found, the time limit run out before the first answer, or the model failing on
 * all of them. Returns how many candidates needed the model, or undefined when the run judged something or had nothing
 * to judge. What a criterion decided by itself, without a model (`decided`), neither needs nor counts as the model.
 */
export function unjudgedCandidates(report: Pick<Report, 'llm' | 'criteria'>): number | undefined {
  if (report.llm === 'off') return undefined
  let needed = 0
  let judged = 0
  for (const summary of report.criteria) {
    if (!summary.applicable) continue
    needed += Math.max(0, summary.candidates - (summary.decided ?? 0))
    judged += Math.max(0, summary.judged - (summary.decided ?? 0))
  }
  return needed > 0 && judged === 0 ? needed : undefined
}

/** Whether the run cannot vouch for a report: a criterion the model failed on every candidate of, or nothing judged at all. */
export function cannotVouch(report: Pick<Report, 'llm' | 'criteria'>): boolean {
  return brokenCriteria(report).length > 0 || unjudgedCandidates(report) !== undefined
}

/**
 * The note of a run that asked for judgment and judged nothing (`unjudgedCandidates`), with the reason:
 * no model, cache misses, the time limit, model errors. Undefined when the model judged something, or had nothing to judge.
 */
export function nothingJudgedNote(report: Pick<Report, 'llm' | 'criteria' | 'locale'>): string | undefined {
  const count = unjudgedCandidates(report)
  if (count === undefined) return undefined
  const { locale } = report
  const sum = (key: 'offlineMisses' | 'timedOut' | 'errors') => report.criteria.reduce((total, summary) => total + (summary[key] ?? 0), 0)
  const reasons =
    report.llm === 'no-model'
      ? [t(locale, 'nothingJudgedNoModel')]
      : [
          ...(sum('offlineMisses') > 0 ? [t(locale, 'nothingJudgedOffline', { count: sum('offlineMisses') })] : []),
          ...(sum('timedOut') > 0 ? [t(locale, 'nothingJudgedTime', { count: sum('timedOut') })] : []),
          ...(sum('errors') > 0 ? [t(locale, 'nothingJudgedErrors', { count: sum('errors') })] : []),
        ]
  return t(locale, 'nothingJudged', { count, reason: reasons.join('; ') || t(locale, 'nothingJudgedUnknown') })
}
