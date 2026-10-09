import { AXE_REVIEW_RULES, EXPERIMENTAL_RULES, REVIEW_ONLY_RULES } from '../engine/axe.ts'
import type { Locale } from '../i18n.ts'
import type { RuleRan } from '../rules/index.ts'
import type { SiteCriteriaReport, SiteFinding } from './site.ts'
import { WCAG_CRITERIA, type WcagVersion, beyondTarget, compareCriteria, criteriaFor, successCriterion } from '../wcag.ts'
import {
  type AnyCriterion,
  CONFIDENCE_RANK,
  type Confidence,
  type CoverageMethod,
  type CoverageStatus,
  type CriterionCoverage,
  type CriterionSummary,
  type EngineResults,
  type Finding,
  type Report,
  type ReviewItem,
} from './types.ts'

/**
 * What a run checked, per WCAG criterion and per method, worded so that nothing reads as "passed":
 * a criterion has failures, needs review, has no failure found in what was checked, had nothing
 * a check applies to, or was not checked. See docs/plans/wcag-coverage.md, 4.7.
 */

/**
 * axe-core results the engine could not decide, and the violations of the experimental rules Rampa runs
 * for review only (AXE_REVIEW_RULES): a person looks at them; they are never findings.
 */
export function reviewItems(engine: EngineResults): ReviewItem[] {
  // Native surfaces word their undecided results as notes (rulesNotes); here only axe-core's.
  if (engine.engine.name !== 'axe-core') return []
  const items: ReviewItem[] = []
  for (const rule of engine.rules) {
    if (rule.outcome !== 'incomplete' && !(rule.outcome === 'violation' && AXE_REVIEW_RULES.includes(rule.ruleId))) continue
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
  /** Rampa's own rules (src/rules) as they ran on the page; each is a method of kind `rule` for its criteria. */
  rules?: readonly RuleRan[] | undefined
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
          ...(REVIEW_ONLY_RULES.has(rule.ruleId) || AXE_REVIEW_RULES.includes(rule.ruleId) ? { reviewOnly: true } : {}),
          maturity: EXPERIMENTAL_RULES.has(rule.ruleId) || AXE_REVIEW_RULES.includes(rule.ruleId) ? 'experimental' : 'stable',
          decided: 0,
        }
        byRule.set(rule.ruleId, method)
      }
      // An experimental rule Rampa runs for review only reports its violations as review, and never decides.
      const forReview = AXE_REVIEW_RULES.includes(rule.ruleId)
      const nodes = rule.nodes.length
      if (rule.outcome === 'violation' && !forReview) method.failures += nodes
      if (rule.outcome === 'incomplete' || (rule.outcome === 'violation' && forReview)) method.review += nodes
      if (rule.outcome !== 'inapplicable') method.applicable += nodes
      if (rule.outcome === 'pass' || (rule.outcome === 'violation' && !forReview)) method.decided += nodes
    }
    // Rampa's rules: an element a rule looked at and did not send to review is decided, failed or not.
    for (const rule of input.rules ?? []) {
      if (!rule.criteria.includes(sc.id)) continue
      byRule.set(rule.id, {
        kind: 'rule',
        id: rule.id,
        ran: true,
        applicable: rule.applicable,
        failures: rule.failures,
        review: rule.review,
        maturity: rule.maturity,
        decided: Math.max(0, rule.applicable - rule.review),
      })
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
    // A method that had something to check and did not run (judgment with --no-llm) leaves the criterion not
    // checked, even when a rule that ran found nothing to apply to: that rule looked for something else.
    else if (methods.some((m) => m.ran) && !methods.some((m) => !m.ran && m.applicable > 0)) status = 'no-applicable-content'
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
    if (REVIEW_ONLY_RULES.has(rule.ruleId) || AXE_REVIEW_RULES.includes(rule.ruleId)) continue
    if (rule.outcome !== 'violation' && rule.outcome !== 'pass') continue
    if (rule.nodes.length === 0 && rule.outcome === 'pass') continue
    for (const id of rule.criteria) if (inTarget.has(id)) covered.add(id)
  }
  return [...covered].sort(compareCriteria)
}

/**
 * The criteria in a run's target that one of Rampa's own rules (src/rules) decided for at least one
 * element: it looked at the element and failed it or let it be, rather than sending it to review.
 * An experimental rule counts, as an experimental axe-core rule does; its failures stay below the threshold.
 */
export function ruleCoverage(rules: readonly RuleRan[], version: WcagVersion): string[] {
  const inTarget = new Set(criteriaFor(version).flatMap((sc) => (sc.removedIn ? [] : [sc.id])))
  const covered = new Set<string>()
  for (const rule of rules) {
    if (rule.applicable - rule.review <= 0) continue
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
  const rules = new Set(reports.flatMap((report) => report.coverage.rules ?? []))
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
  const review = reviewOnlyCriteria(criteria, [...engine, ...rules], [...judged])
  return {
    engine: [...engine].sort(compareCriteria),
    judged: [...judged].sort(compareCriteria),
    notChecked: inTarget.filter((id) => !engine.has(id) && !rules.has(id) && !judged.has(id) && !review.includes(id)),
    ...(rules.size > 0 ? { rules: [...rules].sort(compareCriteria) } : {}),
    ...(criteria.length > 0 ? { criteria } : {}),
  }
}

/** The coverage records of a report, or of an older report, which had none. */
export function coverageRecords(report: Report): CriterionCoverage[] {
  return report.coverage.criteria ?? []
}

/**
 * A crawl's coverage with the criteria that compare its pages (3.2.3, 3.2.6): each that ran is a method of
 * kind `site` on its criterion, and gives the status it found, the most telling one winning as across pages.
 * A criterion that compared something leaves "not checked" and is listed in `site`. Under --wcag 2.1, 3.2.6
 * is beyond the target: its record says so, and its failures (report.beyondTarget) still give its status.
 */
export function withSiteCriteria(
  coverage: Report['coverage'],
  site: SiteCriteriaReport,
  options: { version: WcagVersion; locale: Locale; minConfidence: Confidence },
): Report['coverage'] {
  const threshold = CONFIDENCE_RANK[options.minConfidence]
  const shown = (finding: SiteFinding) => CONFIDENCE_RANK[finding.experimental ? 'low' : finding.confidence] >= threshold
  const records = (coverage.criteria ?? []).map((record) => ({ ...record, methods: [...record.methods] }))
  const compared: string[] = []
  for (const summary of site.criteria) {
    const sc = successCriterion(summary.criterion)
    if (!sc) continue
    const beyond = beyondTarget(sc.id, options.version)
    const ran = summary.setsCompared > 0
    const method: CoverageMethod = {
      kind: 'site',
      id: `site/${sc.id}@${summary.version}`,
      ran,
      applicable: summary.compared,
      failures: summary.findings,
      review: summary.review,
      maturity: summary.maturity,
    }
    const mine = (findings: readonly SiteFinding[] | undefined) => (findings ?? []).filter((finding) => finding.criterion === sc.id)
    const beyondFound = mine(site.beyondTarget)
    let status: CoverageStatus | undefined
    if (mine(site.findings).length > 0 || beyondFound.some(shown)) status = 'failures'
    else if (mine(site.belowThreshold).length > 0 || mine(site.review).length > 0 || beyondFound.length > 0) status = 'needs-review'
    else if (summary.compared > 0) status = 'no-failure-found'
    else if (ran) status = 'no-applicable-content'
    if (summary.compared > 0 && !beyond) compared.push(sc.id)

    const record = records.find((entry) => entry.id === sc.id)
    if (record) {
      record.methods.push(method)
      if (status && STATUS_ORDER.indexOf(status) < STATUS_ORDER.indexOf(record.status)) record.status = status
    } else if (!beyond || ran) {
      // A 2.2-only criterion in a 2.1 run is listed only when something ran for it, as on a page.
      records.push({
        id: sc.id,
        level: sc.level,
        target: beyond ? 'beyond' : 'in',
        status: status ?? 'not-checked',
        methods: [method],
        manual: sc.manual[options.locale] ?? sc.manual.en,
      })
    }
  }
  records.sort((a, b) => compareCriteria(a.id, b.id))
  const siteList = [...new Set([...(coverage.site ?? []), ...compared])].sort(compareCriteria)
  return {
    ...coverage,
    notChecked: coverage.notChecked.filter((id) => !siteList.includes(id)),
    ...(siteList.length > 0 ? { site: siteList } : {}),
    ...(records.length > 0 ? { criteria: records } : {}),
  }
}
