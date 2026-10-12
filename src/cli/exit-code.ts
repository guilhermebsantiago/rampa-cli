import { InvalidArgumentError } from 'commander'
import type { Advisory } from '../advisory/types.ts'
import { FAIL_ON, type FailOn, cannotVouch, failingFindings } from '../core/gate.ts'
import type { Report } from '../core/types.ts'

// The policies and which findings fail them live in core/gate.ts, which SARIF's levels share.
export { FAIL_ON, type FailOn, failingFindings }

/** Accepts the levels in any case: `--fail-on aa`. */
export function parseFailOn(value: string): FailOn {
  const policy = FAIL_ON.find((choice) => choice.toLowerCase() === value.trim().toLowerCase())
  if (!policy) throw new InvalidArgumentError(`Allowed choices are ${FAIL_ON.join(', ')}.`)
  return policy
}

/** Advisories that fail the run: only under --fail-on advisory, and only confirmed ones (never waived or below the threshold). */
export function failingAdvisories(reports: readonly Report[], policy: FailOn): Advisory[] {
  return policy === 'advisory' ? reports.flatMap((report) => report.advisory?.results ?? []) : []
}

/**
 * 0 passes, 1 fails the policy, 2 means the run cannot vouch for itself, whatever the policy says: the model failed
 * on every candidate of a criterion, or judgment was asked for and the model judged none of the candidates that
 * needed it (offline with nothing cached, no model found, the time limit run out). --no-llm, and a page with nothing
 * to judge, are not that.
 */
export function exitCode(reports: readonly Report[], policy: FailOn): 0 | 1 | 2 {
  if (reports.some(cannotVouch)) return 2
  // The model step of an advisory check matters only when advisories can fail the run.
  if (policy === 'advisory' && reports.some((report) => report.advisory?.checks.some((check) => (check.model?.errors ?? 0) > 0 && check.model?.answered === 0))) return 2
  return failingFindings(reports, policy).length + failingAdvisories(reports, policy).length > 0 ? 1 : 0
}
