import type { EngineRuleResult } from '../core/types.ts'

/**
 * WCAG 2.2 2.5.8 Target Size (Minimum), on the web: axe-core's target-size, which checks the size and
 * the spacing of each target, with two exceptions it does not know. The collector records them on each
 * target (surfaces/in-page.ts); here an exempt target leaves the failures and the undecided results,
 * and is kept as a pass that says why, so a reader of the engine results can audit the exception.
 *
 * - User agent control: a native control the author did not restyle (a default checkbox or date field).
 * - Equivalent: another link to the same address is at least 24 by 24 CSS pixels.
 *
 * The rule is experimental (engine/axe.ts, EXPERIMENTAL_RULES): its findings report at low confidence
 * until it passes the evaluation gate of docs/plans/wcag-coverage.md, 4.9.
 */
export const TARGET_SIZE = 'target-size'

export function applyTargetSizeExceptions(rules: EngineRuleResult[]): EngineRuleResult[] {
  const exempt: EngineRuleResult['nodes'] = []
  const kept: EngineRuleResult[] = []
  let template: EngineRuleResult | undefined
  for (const rule of rules) {
    if (rule.ruleId !== TARGET_SIZE || (rule.outcome !== 'violation' && rule.outcome !== 'incomplete')) {
      kept.push(rule)
      continue
    }
    template ??= rule
    const remaining = rule.nodes.filter((node) => !node.exempt)
    exempt.push(...rule.nodes.filter((node) => node.exempt))
    if (remaining.length > 0) kept.push({ ...rule, nodes: remaining })
  }
  if (exempt.length === 0 || !template) return rules
  const pass = kept.find((rule) => rule.ruleId === TARGET_SIZE && rule.outcome === 'pass')
  if (pass) pass.nodes = [...pass.nodes, ...exempt]
  else kept.push({ ...template, outcome: 'pass', nodes: exempt })
  return kept
}
