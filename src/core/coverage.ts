import { EXPERIMENTAL_RULES, REVIEW_ONLY_RULES } from '../engine/axe.ts'
import type { Locale } from '../i18n.ts'
import { WCAG_CRITERIA, type WcagVersion, beyondTarget, compareCriteria, criteriaFor, successCriterion } from '../wcag.ts'
import type {
  AnyCriterion,
  CoverageMethod,
  CoverageStatus,
  CriterionCoverage,
  CriterionSummary,
  EngineResults,
  Finding,
  Report,
  ReviewItem,
} from './types.ts'

/**
 * What a run checked, per WCAG criterion and per method, worded so that nothing reads as "passed":
 * a criterion has failures, needs review, has no failure found in what was checked, had nothing
 * a check applies to, or was not checked. See docs/plans/wcag-coverage.md, 4.7.
 */

/** axe-core results the engine could not decide: a person looks at them; they are never findings. */
export function reviewItems(engine: EngineResults): ReviewItem[] {
  // Native surfaces word their undecided results as notes (rulesNotes); here only axe-core's.
  if (engine.engine.name !== 'axe-core') return []
  const items: ReviewItem[] = []
  for (const rule of engine.rules) {
    if (rule.outcome !== 'incomplete') continue
    const criterion = [...rule.criteria].filter((id) => successCriterion(id)).sort(compareCriteria)[0]
    if (!criterion) continue
    for (const node of rule.nodes) {
      items.push({
        criterion,
        level: successCriterion(criterion)?.level,
        ruleId: rule.ruleId,
        ref: node.ref,
        target: node.target,
        html: node.html,
        message: reasonOf(node.message) ?? rule.help,
        helpUrl: rule.helpUrl,
      })
    }
  }
  return items.sort((a, b) => compareCriteria(a.criterion, b.criterion))
}

/** axe-core's `Fix any of the following:` summary, on one line and without the instruction. */
export function reasonOf(message: string | undefined): string | undefined {
  if (!message) return undefined
  const lines = message
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !/^(fix|corrija|corrigir)\b.*:$/i.test(line))
  return lines.length > 0 ? lines.join('; ') : undefined
}

interface CoverageInput {
  engine: EngineResults
  summaries: CriterionSummary[]
  criteria: AnyCriterion[]
  /** Whether a model judged the candidates (false with --no-llm or without a model). */
  llmActive: boolean
  reported: Finding[]
  belowThreshold: Finding[]
  review: ReviewItem[]
  version: WcagVersion
  locale: Locale
}

/** One record per criterion of the target, plus the 2.2-only criteria a 2.1 run had results for. */
export function criteriaCoverage(input: CoverageInput): CriterionCoverage[] {
  const { engine, version, locale } = input
  const kind: CoverageMethod['kind'] = engine.engine.name === 'axe-core' ? 'axe' : 'rule'
  const reportedRules = new Set(input.reported.flatMap((f) => (f.ruleId ? [f.ruleId] : [])))
  const belowRules = new Set(input.belowThreshold.flatMap((f) => (f.ruleId ? [f.ruleId] : [])))
  const records: CriterionCoverage[] = []

  for (const sc of WCAG_CRITERIA) {
    const beyond = beyondTarget(sc.id, version)
    if (!beyond && !criteriaFor(version).includes(sc)) continue

    const methods: CoverageMethod[] = []
    const byRule = new Map<string, CoverageMethod & { decided: number }>()
    for (const rule of engine.rules) {
      if (!rule.criteria.includes(sc.id)) continue
      let method = byRule.get(rule.ruleId)
      if (!method) {
        method = {
          kind,
          id: rule.ruleId,
          ran: true,
          applicable: 0,
          failures: 0,
          review: 0,
          ...(REVIEW_ONLY_RULES.has(rule.ruleId) ? { reviewOnly: true } : {}),
          maturity: EXPERIMENTAL_RULES.has(rule.ruleId) ? 'experimental' : 'stable',
          decided: 0,
        }
        byRule.set(rule.ruleId, method)
      }
      const nodes = rule.nodes.length
      if (rule.outcome === 'violation') method.failures += nodes
      if (rule.outcome === 'incomplete') method.review += nodes
      if (rule.outcome !== 'inapplicable') method.applicable += nodes
      if (rule.outcome === 'violation' || rule.outcome === 'pass') method.decided += nodes
    }
    for (const { decided: _, ...method } of byRule.values()) methods.push(method)

    const module = input.criteria.find((criterion) => criterion.id === sc.id)
    const summary = input.summaries.find((s) => s.criterion === sc.id)
    let judgedDecided = 0
    if (module && summary?.applicable) {
      const ran = input.llmActive && (summary.judged > 0 || summary.candidates === 0)
      judgedDecided = summary.judged - summary.cannotTell
      methods.push({
        kind: 'judgment',
        id: `judgment/${sc.id}@${module.version}`,
        ran,
        applicable: summary.candidates,
        failures: summary.failed,
        review: summary.cannotTell,
        maturity: 'stable',
      })
    }

    const ruleDecided = [...byRule.values()].some((method) => !method.reviewOnly && method.decided > 0)
    const findingsHere = input.reported.some((f) => f.criterion === sc.id) || methods.some((m) => m.failures > 0 && reportedRules.has(m.id))
    const belowHere = input.belowThreshold.some((f) => f.criterion === sc.id) || methods.some((m) => m.failures > 0 && belowRules.has(m.id))
    // A rule that can only pass or ask for review leaves its criterion to a person when nothing else decided
    // it: bypass passes on a page with any heading, and that says nothing about whether blocks can be skipped.
    const onlyReviewApplied = !ruleDecided && judgedDecided <= 0 && methods.some((m) => m.reviewOnly && m.applicable > 0)
    const reviewHere = belowHere || onlyReviewApplied || methods.some((m) => m.review > 0) || input.review.some((item) => item.criterion === sc.id)

    let status: CoverageStatus
    if (sc.removedIn && version === '2.1') status = 'satisfied-by-definition'
    else if (findingsHere) status = 'failures'
    else if (reviewHere) status = 'needs-review'
    else if (ruleDecided || judgedDecided > 0) status = 'no-failure-found'
    else if (methods.some((m) => m.ran)) status = 'no-applicable-content'
    else status = 'not-checked'

    // A 2.2-only criterion in a 2.1 run is listed only when something ran for it.
    if (beyond && !methods.some((m) => m.ran)) continue
    records.push({ id: sc.id, level: sc.level, target: beyond ? 'beyond' : 'in', status, methods, manual: sc.manual[locale] ?? sc.manual.en })
  }
  return records
}

/**
 * The criteria in a run's target that some rule able to report a failure decided for at least one
 * element. Rules that can only pass or ask for review, and rules whose every result was undecided,
 * do not count: a criterion they alone touched needs review, it was not checked.
 */
export function engineCoverage(engine: EngineResults, version: WcagVersion): string[] {
  const inTarget = new Set(criteriaFor(version).flatMap((sc) => (sc.removedIn ? [] : [sc.id])))
  const covered = new Set<string>()
  for (const rule of engine.rules) {
    if (REVIEW_ONLY_RULES.has(rule.ruleId)) continue
    if (rule.outcome !== 'violation' && rule.outcome !== 'pass') continue
    if (rule.nodes.length === 0 && rule.outcome === 'pass') continue
    for (const id of rule.criteria) if (inTarget.has(id)) covered.add(id)
  }
  return [...covered].sort(compareCriteria)
}

/** Criteria whose only automated result is "needs review": not checked, but not untouched either. */
export function reviewOnlyCriteria(records: readonly CriterionCoverage[], engine: readonly string[], judged: readonly string[]): string[] {
  return records.filter((r) => r.target === 'in' && r.status === 'needs-review' && !engine.includes(r.id) && !judged.includes(r.id)).map((r) => r.id)
}

const STATUS_ORDER: CoverageStatus[] = ['failures', 'needs-review', 'no-failure-found', 'no-applicable-content', 'not-checked', 'satisfied-by-definition']

/** The coverage of several pages: each criterion with the most telling status any page had, and its methods summed. */
export function mergeCoverage(reports: readonly Report[], version: WcagVersion): Report['coverage'] {
  const inTarget = criteriaFor(version).flatMap((sc) => (sc.removedIn ? [] : [sc.id]))
  const engine = new Set(reports.flatMap((report) => report.coverage.engine))
  const judged = new Set(reports.flatMap((report) => report.coverage.judged))
  const merged = new Map<string, CriterionCoverage>()
  for (const report of reports) {
    for (const record of report.coverage.criteria ?? []) {
      const seen = merged.get(record.id)
      if (!seen) {
        merged.set(record.id, { ...record, methods: record.methods.map((method) => ({ ...method })) })
        continue
      }
      if (STATUS_ORDER.indexOf(record.status) < STATUS_ORDER.indexOf(seen.status)) seen.status = record.status
      for (const method of record.methods) {
        const same = seen.methods.find((m) => m.id === method.id)
        if (!same) seen.methods.push({ ...method })
        else {
          same.ran ||= method.ran
          same.applicable += method.applicable
          same.failures += method.failures
          same.review += method.review
        }
      }
    }
  }
  const criteria = [...merged.values()].sort((a, b) => compareCriteria(a.id, b.id))
  const review = reviewOnlyCriteria(criteria, [...engine], [...judged])
  return {
    engine: [...engine].sort(compareCriteria),
    judged: [...judged].sort(compareCriteria),
    notChecked: inTarget.filter((id) => !engine.has(id) && !judged.has(id) && !review.includes(id)),
    ...(criteria.length > 0 ? { criteria } : {}),
  }
}

/** The coverage records of a report, or of an older report, which had none. */
export function coverageRecords(report: Report): CriterionCoverage[] {
  return report.coverage.criteria ?? []
}
