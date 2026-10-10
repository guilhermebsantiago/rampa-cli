import { fingerprint } from '../core/check.ts'
import type { Confidence, Finding, ProbeCoverage } from '../core/types.ts'
import type { Locale } from '../i18n.ts'
import type { A11yNode, A11ySnapshot, ProbeRecord } from '../snapshot/schema.ts'
import { type TreeIndex, indexTree } from '../snapshot/tree.ts'
import { DEFAULT_WCAG, type WcagVersion, beyondTarget, successCriterion } from '../wcag.ts'

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
  /**
   * axe-core results left undecided ("incomplete") on elements the probe measured itself: they are the probe rule's
   * to report (a failure, an item to review, or nothing), as with `RuleCheck.resolves`. The media probe settles
   * video-caption and no-autoplay-audio this way.
   */
  resolved?: Array<{ engineRule: string; ref: string }> | undefined
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

/** A WCAG 2.2-only criterion (2.4.11) in a run that targets WCAG 2.1: its result is beyond the target, never counted. */
export function isBeyondTarget(criterion: string, version: WcagVersion = DEFAULT_WCAG): boolean {
  return beyondTarget(criterion, version)
}

export function probeCriterionName(criterion: string, locale: Locale): string | undefined {
  return successCriterion(criterion)?.name[locale]
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
  // Whether the criterion is beyond the run's target is set by probeChecks, which knows the WCAG version.
  const html = typeof input.node.native.html === 'string' ? input.node.native.html : undefined
  return {
    fingerprint: fingerprint(input.criterion, input.node.ref, `${input.rule}|${input.subject}`),
    criterion: input.criterion,
    level: successCriterion(input.criterion)?.level,
    source: 'probe',
    ref: input.node.ref,
    target: input.node.ref,
    message: input.message,
    evidence: input.evidence,
    confidence: input.confidence,
    ruleId: input.rule,
    html,
    experimental: true,
  }
}

export function coverageStatus(failures: number, review: number): ProbeCoverage['status'] {
  return failures > 0 ? 'failures' : review > 0 ? 'needs-review' : 'no-failure-found'
}

export function conditionsText(record: ProbeRecord, what: string): string {
  return `${what} · ${record.conditions.browser}`
}

/**
 * Runs every probe rule over the snapshot's observations. A result for a WCAG 2.2-only criterion (2.4.11) in a run
 * that targets 2.1 is marked beyond the target: shown, never counted.
 */
export function probeChecks(snapshot: A11ySnapshot, locale: Locale, rules: readonly ProbeRule[], version: WcagVersion = DEFAULT_WCAG): ProbeRuleResult {
  const result = probeResults(snapshot, locale, rules, version)
  for (const finding of [...result.findings, ...result.review]) if (isBeyondTarget(finding.criterion, version)) finding.beyondTarget = true
  for (const row of result.coverage) {
    if (isBeyondTarget(row.criterion, version)) row.beyondTarget = true
    else delete row.beyondTarget
  }
  return result
}

function probeResults(snapshot: A11ySnapshot, locale: Locale, rules: readonly ProbeRule[], version: WcagVersion): ProbeRuleResult {
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
          ...(isBeyondTarget(criterion, version) ? { beyondTarget: true } : {}),
        })
      }
      continue
    }
    try {
      const out = rule.run(record, ctx)
      result.findings.push(...out.findings)
      result.review.push(...out.review)
      if (out.resolved?.length) (result.resolved ??= []).push(...out.resolved)
      // A page that needed a blocked request (a POST for its data) may have rendered less on the probe's load.
      const blocked = guardNote(record, locale)
      result.coverage.push(...out.coverage.map((row) => (blocked ? { ...row, note: row.note ? `${row.note}; ${blocked}` : blocked } : row)))
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

/** What the network guard stopped during a probe, for the coverage note: how many requests, and to which hosts. */
export function guardNote(record: ProbeRecord, locale: Locale): string | undefined {
  // Beacons (sendBeacon, resource type ping) only report analytics: a page never waits on them to show content.
  const blocked = (Array.isArray(record.guard?.blocked) ? record.guard.blocked : []).filter((entry) => entry.type !== 'ping')
  if (blocked.length === 0) return undefined
  const hosts = [
    ...new Set(
      blocked.map((entry) => {
        try {
          return new URL(entry.url).hostname
        } catch {
          return entry.url.slice(0, 40)
        }
      }),
    ),
  ]
  const list = `${hosts.slice(0, 3).join(', ')}${hosts.length > 3 ? ', …' : ''}`
  return say(
    locale,
    `the guard blocked ${blocked.length} request(s) to ${list}; content that needed them may be missing`,
    `o guarda bloqueou ${blocked.length} requisição(ões) para ${list}; conteúdo que dependia delas pode faltar`,
  )
}

/** Narrowing helpers for probe data read back from a file: a snapshot is input, not trusted code. */
export function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

/** The report's language for a piece of evidence or a note: English, or Brazilian Portuguese. */
export function say(locale: Locale, en: string, pt: string): string {
  return locale === 'pt-BR' ? pt : en
}

/** "N more failures not listed", in the report's language. */
export function moreNotListed(locale: Locale, count: number): string {
  return count > 0 ? say(locale, `${count} more failure(s) not listed`, `mais ${count} falha(s) não listada(s)`) : ''
}

export function px(value: number): string {
  return `${Math.round(value * 10) / 10} px`
}
