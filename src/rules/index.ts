import type { EngineResults, Finding } from '../core/types.ts'
import { normalizeForMatch, sha256 } from '../core/util.ts'
import type { Locale } from '../i18n.ts'
import type { A11ySnapshot } from '../snapshot/schema.ts'
import { indexTree } from '../snapshot/tree.ts'
import { successCriterion } from '../wcag.ts'
import { CONTENT_RULES } from './content.ts'
import { noVisibleLabelRule } from './forms.ts'
import type { RuleCheck } from './types.ts'

export type { Hit, RuleCheck, RuleContext, RuleRun } from './types.ts'

/** Every Rampa rule, for every surface; each says where it applies. */
export const RULE_CHECKS: readonly RuleCheck[] = [...CONTENT_RULES, noVisibleLabelRule]

export interface RuleStageResult {
  findings: Finding[]
  /** One entry per rule that applies to the surface: how many elements it looked at, and how many hits it had. */
  ran: Array<{ id: string; version: string; maturity: RuleCheck['maturity']; criteria: string[]; applicable: number; hits: number }>
  /**
   * Elements a stable rule failed, by criterion. A judged criterion does not send them to the model:
   * the rule already decided, and a second finding on the same element would only repeat it.
   */
  decided: Map<string, Set<string>>
}

/** The same key `fingerprint` in core/check.ts builds; kept here so the rules do not import the check loop. */
function fingerprint(criterion: string, ref: string | undefined, detail: string): string {
  return sha256(`${criterion}|${ref ?? ''}|${normalizeForMatch(detail)}`).slice(0, 12)
}

export function emptyRuleStage(): RuleStageResult {
  return { findings: [], ran: [], decided: new Map() }
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
    const hits = run.hits.filter((hit) => !failedByAxe(rule, hit.ref))
    stage.ran.push({ id: rule.id, version: rule.version, maturity: rule.maturity, criteria: [...rule.criteria], applicable: run.applicable, hits: hits.length })
    const criterion = rule.criteria[0] ?? 'best-practice'
    for (const hit of hits) {
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
  return stage
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
