import type { EngineResults, Finding, ReviewItem } from '../core/types.ts'
import { normalizeForMatch, sha256 } from '../core/util.ts'
import type { Locale } from '../i18n.ts'
import type { A11ySnapshot } from '../snapshot/schema.ts'
import { indexTree } from '../snapshot/tree.ts'
import { compareCriteria, successCriterion } from '../wcag.ts'
import { CONTENT_RULES } from './content.ts'
import { CONTRAST_RULES } from './contrast.ts'
import { noVisibleLabelRule } from './forms.ts'
import { STRUCTURE_RULES } from './structure.ts'
import type { RuleCheck } from './types.ts'

export type { Hit, RuleCheck, RuleContext, RuleRun } from './types.ts'

/** Every Rampa rule, for every surface; each says where it applies. */
export const RULE_CHECKS: readonly RuleCheck[] = [...CONTENT_RULES, noVisibleLabelRule, ...STRUCTURE_RULES, ...CONTRAST_RULES]

/** One rule that applies to the surface, as it ran on a page. */
export interface RuleRan {
  id: string
  version: string
  maturity: RuleCheck['maturity']
  criteria: string[]
  /** Elements the rule looked at. */
  applicable: number
  /** Hits left after axe-core's own failures: failures plus review. */
  hits: number
  /** Hits that fail the criterion (findings; below the threshold while the rule is experimental). */
  failures: number
  /** Hits sent to review (report.needsReview): undecided, never a failure. */
  review: number
  /** What limits the result, such as elements left out past a budget. */
  note?: string | undefined
}

export interface RuleStageResult {
  /** The rules' failures. */
  findings: Finding[]
  /**
   * The hits a person must decide (outcome review): they go to the report's needsReview, next to what
   * axe-core could not decide, so they are never a failure, whatever the confidence threshold.
   */
  review: ReviewItem[]
  /** One entry per rule that applies to the surface: how many elements it looked at, and what it found. */
  ran: RuleRan[]
  /**
   * Elements a stable rule failed, by criterion. A judged criterion does not send them to the model:
   * the rule already decided, and a second finding on the same element would only repeat it.
   */
  decided: Map<string, Set<string>>
  /**
   * Elements whose undecided engine result a rule settled, by engine rule (`RuleCheck.resolves`): they leave
   * axe-core's results to review and its coverage counts, because the rule reports them.
   */
  resolved: Map<string, Set<string>>
}

/** The same key `fingerprint` in core/check.ts builds; kept here so the rules do not import the check loop. */
function fingerprint(criterion: string, ref: string | undefined, detail: string): string {
  return sha256(`${criterion}|${ref ?? ''}|${normalizeForMatch(detail)}`).slice(0, 12)
}

export function emptyRuleStage(): RuleStageResult {
  return { findings: [], review: [], ran: [], decided: new Map(), resolved: new Map() }
}

/**
 * Runs the rules that apply to the snapshot's surface. A rule never reports an element axe-core
 * already failed for the same criterion: that failure is axe's, and it is in the report once.
 */
export function runRuleChecks(snapshot: A11ySnapshot, engine: EngineResults, locale: Locale, rules: readonly RuleCheck[] = RULE_CHECKS): RuleStageResult {
  const stage = emptyRuleStage()
  const ctx = { locale, index: indexTree(snapshot.root) }
  const engineFailed = new Map<string, Set<string>>()
  for (const rule of engine.rules) {
    if (rule.outcome !== 'violation') continue
    for (const node of rule.nodes) {
      const ref = node.ref ?? node.target
      const keys = [rule.ruleId, ...rule.criteria]
      for (const key of keys) engineFailed.set(key, (engineFailed.get(key) ?? new Set()).add(ref))
    }
  }
  const failedByAxe = (rule: RuleCheck, ref: string) =>
    [...rule.engineRules, ...rule.criteria].some((key) => engineFailed.get(key)?.has(ref) === true)

  for (const rule of rules) {
    if (!rule.surfaces.includes(snapshot.surface)) continue
    const run = rule.run(snapshot, engine, ctx)
    // A rule for one kind of content among many says nothing about its criterion on a page that has none.
    if (rule.narrow && run.applicable === 0) continue
    const hits = run.hits.filter((hit) => !failedByAxe(rule, hit.ref))
    const review = hits.filter((hit) => hit.outcome === 'review').length
    stage.ran.push({
      id: rule.id,
      version: rule.version,
      maturity: rule.maturity,
      criteria: [...rule.criteria],
      applicable: run.applicable,
      hits: hits.length,
      failures: hits.length - review,
      review,
      ...(run.note ? { note: run.note } : {}),
    })
    for (const engineRule of rule.resolves ?? []) {
      for (const ref of run.resolved ?? []) stage.resolved.set(engineRule, (stage.resolved.get(engineRule) ?? new Set()).add(ref))
    }
    const criterion = rule.criteria[0] ?? 'best-practice'
    for (const hit of hits) {
      if (hit.outcome === 'review') {
        stage.review.push({
          criterion,
          level: successCriterion(criterion)?.level,
          ruleId: rule.id,
          ref: hit.ref,
          target: hit.ref,
          html: hit.html,
          message: rule.message(hit, locale),
          evidence: hit.evidence,
          helpUrl: rule.helpUrl,
        })
        continue
      }
      const sure = rule.maturity === 'stable' && hit.outcome === 'fail'
      stage.findings.push({
        fingerprint: fingerprint(criterion, hit.ref, `${rule.id}|${hit.subject}`),
        criterion,
        level: successCriterion(criterion)?.level,
        source: 'rule',
        ref: hit.ref,
        target: hit.ref,
        message: rule.message(hit, locale),
        evidence: hit.evidence,
        subject: hit.subject,
        patch: rule.patch?.(hit, snapshot),
        confidence: sure ? (hit.confidence ?? 'high') : 'low',
        ruleId: rule.id,
        helpUrl: rule.helpUrl,
        html: hit.html,
      })
      if (sure) {
        for (const id of rule.criteria) stage.decided.set(id, (stage.decided.get(id) ?? new Set()).add(hit.ref))
      }
    }
  }
  stage.review.sort((a, b) => compareCriteria(a.criterion, b.criterion))
  return stage
}

/**
 * The engine's results without the undecided ones a rule settled (`RuleStageResult.resolved`): what is left
 * for axe-core's review items and coverage counts. A result with no node left is dropped.
 */
export function withoutResolved(engine: EngineResults, resolved: ReadonlyMap<string, ReadonlySet<string>>): EngineResults {
  if (resolved.size === 0) return engine
  const rules = engine.rules.flatMap((rule) => {
    const refs = rule.outcome === 'incomplete' ? resolved.get(rule.ruleId) : undefined
    if (!refs) return [rule]
    const nodes = rule.nodes.filter((node) => !refs.has(node.ref ?? node.target))
    if (nodes.length === rule.nodes.length) return [rule]
    return nodes.length > 0 ? [{ ...rule, nodes }] : []
  })
  return { ...engine, rules }
}

/** The rules a `--rules` list names, by id with or without the `rampa/` prefix. */
export function resolveRules(ids: readonly string[]): RuleCheck[] {
  const wanted = ids.map((id) => (id.includes('/') ? id : `rampa/${id}`))
  return wanted.map((id) => {
    const rule = RULE_CHECKS.find((candidate) => candidate.id === id)
    if (!rule) throw new Error(`No Rampa rule ${id}. Available: ${RULE_CHECKS.map((r) => r.id).join(', ')}`)
    return rule
  })
}
