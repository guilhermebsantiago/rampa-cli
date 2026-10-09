import { fingerprint } from '../core/check.ts'
import type { Confidence, Finding, ProbeCoverage } from '../core/types.ts'
import type { Locale } from '../i18n.ts'
import type { A11yNode, A11ySnapshot, ProbeRecord } from '../snapshot/schema.ts'
import { type TreeIndex, indexTree } from '../snapshot/tree.ts'
import { successCriterion } from '../wcag.ts'

/**
 * Rules over probe observations: pure functions of the snapshot, so a saved snapshot gives the
 * same findings offline. Thresholds live here, never in the probes. Every probe rule is
 * experimental until it passes the evaluation gate (docs/plans/wcag-coverage.md, 4.9).
 */

export interface ProbeRuleContext {
  snapshot: A11ySnapshot
  index: TreeIndex
  locale: Locale
}

export interface ProbeRuleResult {
  findings: Finding[]
  review: Finding[]
  coverage: ProbeCoverage[]
}

export interface ProbeRule {
  /** 'rampa/reflow' */
  id: string
  /** The probe kind and variant whose records this rule reads. */
  kind: ProbeRecord['kind']
  variant?: string | undefined
  /** Probe versions the rule understands; other records are not read. */
  versions: readonly string[]
  criteria: readonly string[]
  run(record: ProbeRecord, ctx: ProbeRuleContext): ProbeRuleResult
}

/** WCAG 2.2-only criteria Rampa's 2.1 table does not list yet; a result for them is beyond the target. */
const WCAG22_ONLY: Record<string, { level: 'A' | 'AA'; name: Record<Locale, string> }> = {
  '2.4.11': { level: 'AA', name: { en: 'Focus Not Obscured (Minimum)', 'pt-BR': 'Foco não obscurecido (mínimo)' } },
}

export function isBeyondTarget(criterion: string): boolean {
  return criterion in WCAG22_ONLY && !successCriterion(criterion)
}

export function probeCriterionName(criterion: string, locale: Locale): string | undefined {
  return WCAG22_ONLY[criterion]?.name[locale]
}

export interface ProbeFindingInput {
  criterion: string
  rule: string
  node: A11yNode
  message: string
  evidence: string
  confidence: Confidence
  /** What the finding is about, stable from run to run, for the fingerprint (not the measured numbers). */
  subject: string
}

export function probeFinding(input: ProbeFindingInput): Finding {
  const beyond = isBeyondTarget(input.criterion)
  const html = typeof input.node.native.html === 'string' ? input.node.native.html : undefined
  return {
    fingerprint: fingerprint(input.criterion, input.node.ref, `${input.rule}|${input.subject}`),
    criterion: input.criterion,
    level: successCriterion(input.criterion)?.level ?? WCAG22_ONLY[input.criterion]?.level,
    source: 'probe',
    ref: input.node.ref,
    target: input.node.ref,
    message: input.message,
    evidence: input.evidence,
    confidence: input.confidence,
    ruleId: input.rule,
    html,
    experimental: true,
    ...(beyond ? { beyondTarget: true } : {}),
  }
}

export function coverageStatus(failures: number, review: number): ProbeCoverage['status'] {
  return failures > 0 ? 'failures' : review > 0 ? 'needs-review' : 'no-failure-found'
}

/** The rules every report runs; a rule with no record to read reports nothing, not even coverage. */
export const PROBE_RULES: ProbeRule[] = []

export function conditionsText(record: ProbeRecord, what: string): string {
  return `${what} · ${record.conditions.browser}`
}

/** Runs every probe rule over the snapshot's observations. */
export function probeChecks(snapshot: A11ySnapshot, locale: Locale, rules: readonly ProbeRule[] = PROBE_RULES): ProbeRuleResult {
  const result: ProbeRuleResult = { findings: [], review: [], coverage: [] }
  const records = snapshot.observations?.probes ?? []
  if (records.length === 0) return result
  const ctx: ProbeRuleContext = { snapshot, index: indexTree(snapshot.root), locale }
  for (const rule of rules) {
    const record = records.find((r) => r.kind === rule.kind && (rule.variant === undefined || r.conditions.variant === rule.variant))
    if (!record) continue
    const method = `probe/${record.kind}@${record.version}`
    if (record.status === 'skipped' || !rule.versions.includes(record.version)) {
      const note = record.status === 'skipped' ? (record.reason ?? 'skipped') : `probe version ${record.version} is not one this rule reads`
      for (const criterion of rule.criteria) {
        result.coverage.push({
          criterion,
          method,
          rule: rule.id,
          conditions: record.conditions.variant ?? '',
          status: 'not-checked',
          applicable: 0,
          failures: 0,
          review: 0,
          unmatched: 0,
          note,
          maturity: 'experimental',
          ...(isBeyondTarget(criterion) ? { beyondTarget: true } : {}),
        })
      }
      continue
    }
    try {
      const out = rule.run(record, ctx)
      result.findings.push(...out.findings)
      result.review.push(...out.review)
      result.coverage.push(...out.coverage)
    } catch (error) {
      // A record that does not have the shape the rule expects (an edited or foreign snapshot) checks nothing.
      for (const criterion of rule.criteria) {
        result.coverage.push({
          criterion,
          method,
          rule: rule.id,
          conditions: record.conditions.variant ?? '',
          status: 'not-checked',
          applicable: 0,
          failures: 0,
          review: 0,
          unmatched: 0,
          note: `unreadable probe record: ${error instanceof Error ? error.message : String(error)}`,
          maturity: 'experimental',
        })
      }
    }
  }
  return result
}

/** Narrowing helpers for probe data read back from a file: a snapshot is input, not trusted code. */
export function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

export function px(value: number): string {
  return `${Math.round(value * 10) / 10} px`
}
