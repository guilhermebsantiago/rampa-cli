import { InvalidArgumentError } from 'commander'
import type { Finding, Report } from '../core/types.ts'

/**
 * When `rampa check` exits with 1, so CI can gate on it:
 * - confirmed (default): any finding at or above --min-confidence
 * - any: also the findings below it
 * - A: confirmed findings on Level A criteria
 * - AA: confirmed findings on Level A or AA criteria, what AA conformance needs
 * - none (or never): never on findings
 * Waived findings never count.
 */
export const FAIL_ON = ['confirmed', 'any', 'A', 'AA', 'none', 'never'] as const
export type FailOn = (typeof FAIL_ON)[number]

/** Accepts the levels in any case: `--fail-on aa`. */
export function parseFailOn(value: string): FailOn {
  const policy = FAIL_ON.find((choice) => choice.toLowerCase() === value.trim().toLowerCase())
  if (!policy) throw new InvalidArgumentError(`Allowed choices are ${FAIL_ON.join(', ')}.`)
  return policy
}

export function failingFindings(reports: readonly Report[], policy: FailOn): Finding[] {
  // A WCAG 2.2-only result in a 2.1 report is shown but never gates; needs-review items never do.
  const counted = (finding: Finding) => !finding.beyondTarget
  const confirmed = reports.flatMap((report) => report.findings).filter(counted)
  switch (policy) {
    case 'none':
    case 'never':
      return []
    case 'any':
      return [...confirmed, ...reports.flatMap((report) => report.belowThreshold).filter(counted)]
    case 'A':
      return confirmed.filter((finding) => finding.level === 'A')
    case 'AA':
      return confirmed.filter((finding) => finding.level === 'A' || finding.level === 'AA')
    case 'confirmed':
      return confirmed
  }
}

/**
 * 0 passes, 1 fails the policy, 2 means the run cannot vouch for itself: the model failed
 * on every candidate of a criterion, whatever the policy says.
 */
export function exitCode(reports: readonly Report[], policy: FailOn): 0 | 1 | 2 {
  if (reports.some((report) => report.criteria.some((criterion) => criterion.errors > 0 && criterion.judged === 0))) return 2
  return failingFindings(reports, policy).length > 0 ? 1 : 0
}
