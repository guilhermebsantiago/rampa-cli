import { z } from 'zod'
import { CRITERIA, DEFAULT_CRITERIA } from '../criteria/index.ts'
import { RampaError } from '../core/util.ts'
import { WCAG21_A_AA, successCriterion } from '../wcag.ts'
import { type AgentFinding, FindingSchema } from './format.ts'
import { GUIDES, actRuleUrl, axeRulesByCriterion, engineRulesOf, understandingUrl } from './guide.ts'

/** list_criteria and explain_finding: what Rampa knows about a criterion, with no page and no model. */

const STATEMENT = 'Rampa never declares a page accessible: what no check here covers needs manual review and testing with people.'

export const CriteriaListSchema = z.object({
  judged: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      level: z.string(),
      default: z.boolean(),
      axe_checks: z.string(),
      rampa_judges: z.string(),
      example: z.string().optional(),
      engine_rules: z.array(z.string()),
      act_rules: z.array(z.string()),
      needs_vision: z.boolean(),
      understanding_url: z.string().optional(),
    }),
  ),
  default_criteria: z.array(z.string()),
  wcag: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        level: z.string(),
        checked_by: z.array(z.enum(['axe-core', 'rampa judgment'])),
        axe_rules: z.array(z.string()),
      }),
    )
    .describe('Every WCAG 2.1 A/AA criterion; checked_by is empty when only a person can check it'),
  statement: z.string(),
})
export type CriteriaList = z.infer<typeof CriteriaListSchema>

export function criteriaList(): CriteriaList {
  const rules = axeRulesByCriterion()
  return {
    judged: [...CRITERIA.values()].map((criterion) => {
      const guide = GUIDES[criterion.id]
      const engineRules = [...criterion.engineRules]
      return {
        id: criterion.id,
        name: successCriterion(criterion.id)?.name.en ?? `WCAG ${criterion.id}`,
        level: criterion.level,
        default: DEFAULT_CRITERIA.includes(criterion.id),
        axe_checks: guide?.axeChecks ?? (engineRules.length > 0 ? `rules ${engineRules.join(', ')}` : 'nothing for this criterion'),
        rampa_judges: guide?.rampaJudges ?? 'what those rules cannot decide',
        example: guide?.example,
        engine_rules: engineRules,
        act_rules: [...criterion.act],
        needs_vision: Boolean(criterion.needs.vision),
        understanding_url: understandingUrl(criterion.id),
      }
    }),
    default_criteria: [...DEFAULT_CRITERIA],
    wcag: WCAG21_A_AA.map((sc) => {
      const axe = rules.get(sc.id) ?? []
      const checkedBy: Array<'axe-core' | 'rampa judgment'> = []
      if (axe.length > 0) checkedBy.push('axe-core')
      if (CRITERIA.has(sc.id)) checkedBy.push('rampa judgment')
      return { id: sc.id, name: sc.name.en, level: sc.level, checked_by: checkedBy, axe_rules: axe }
    }),
    statement: STATEMENT,
  }
}

export function criteriaListText(list: CriteriaList): string {
  const lines = [
    `Rampa judges ${list.judged.length} WCAG 2.1 success criteria with a model, on what axe-core cannot decide. Default set: ${list.default_criteria.join(', ')}.`,
  ]
  for (const criterion of list.judged) {
    const tags = [criterion.default ? 'default' : 'not default', criterion.needs_vision ? 'needs a model with vision' : undefined].filter(Boolean)
    lines.push('', `${criterion.id} ${criterion.name} (${criterion.level}), ${tags.join(', ')}`)
    lines.push(`  axe-core checks: ${criterion.axe_checks}`)
    lines.push(`  Rampa judges: ${criterion.rampa_judges}`)
    if (criterion.example) lines.push(`  Catches: ${criterion.example}`)
  }
  const group = (label: string, keep: (checkedBy: string[]) => boolean) => {
    const ids = list.wcag.filter((sc) => keep(sc.checked_by)).map((sc) => sc.id)
    if (ids.length > 0) lines.push(`  ${label} (${ids.length}): ${ids.join(', ')}`)
  }
  lines.push('', `All ${list.wcag.length} WCAG 2.1 A/AA criteria (whether a rule applies depends on the page):`)
  group('axe-core and Rampa judgment', (by) => by.length === 2)
  group('Rampa judgment only', (by) => by.length === 1 && by[0] === 'rampa judgment')
  group('axe-core only, in part', (by) => by.length === 1 && by[0] === 'axe-core')
  group('no automated check', (by) => by.length === 0)
  lines.push('', list.statement)
  return lines.join('\n')
}

const ExplainedFindingSchema = FindingSchema.extend({
  target: z.string(),
  why: z.string(),
  fix: z.string(),
})

export const ExplanationSchema = z.object({
  warning: z.string().optional().describe('Set when the finding_id was not found, so this explains only the criterion'),
  criterion: z.object({
    id: z.string(),
    name: z.string(),
    level: z.string().optional(),
    understanding_url: z.string().optional(),
    judged_by_rampa: z.boolean(),
    default: z.boolean(),
    axe_rules: z.array(z.string()),
    act_rules: z.array(z.object({ id: z.string(), url: z.string() })),
  }),
  wcag_text: z.string().optional().describe('Normative text, quoted from WCAG 2.1'),
  note: z.string().optional(),
  axe_checks: z.string().optional(),
  rampa_judges: z.string().optional(),
  fails_when: z.array(z.string()),
  how_to_fix: z.array(z.string()),
  finding: ExplainedFindingSchema.optional(),
})
export type Explanation = z.infer<typeof ExplanationSchema>

export interface RememberedFinding {
  finding: AgentFinding
  /** The page the finding came from. */
  target: string
}

export function explain(criterionId: string, remembered?: RememberedFinding): Explanation {
  const sc = successCriterion(criterionId)
  if (!sc && !remembered) {
    throw new RampaError('unknown-criterion', `Unknown criterion ${criterionId}. Pass a WCAG 2.1 A/AA success criterion such as "1.1.1"; list_criteria lists them.`)
  }
  const module = CRITERIA.get(criterionId)
  const guide = GUIDES[criterionId]
  const axeRules = engineRulesOf(criterionId, module)
  const understanding = understandingUrl(criterionId)
  const generalFix = [
    'For an axe-core finding, the rule says what fails on the element, and its help page shows how to fix it.',
    `The W3C Understanding document explains the intent of the criterion and its sufficient techniques${understanding ? `: ${understanding}` : '.'}`,
    axeRules.length > 0
      ? 'axe-core checks only part of this criterion; what its rules cannot decide needs manual review.'
      : 'No automated check in Rampa covers this criterion: review it by hand and test with people.',
  ]
  return {
    criterion: {
      id: criterionId,
      name: sc?.name.en ?? (criterionId === 'best-practice' ? 'Best practice, not a WCAG criterion' : criterionId),
      level: sc?.level,
      understanding_url: understanding,
      judged_by_rampa: module !== undefined,
      default: DEFAULT_CRITERIA.includes(criterionId),
      axe_rules: axeRules,
      act_rules: (module?.act ?? []).map((id) => ({ id, url: actRuleUrl(id) })),
    },
    wcag_text: guide?.wcag,
    note: guide?.note,
    axe_checks: guide?.axeChecks,
    rampa_judges: guide?.rampaJudges,
    fails_when: guide?.failsWhen ?? [],
    how_to_fix: guide?.fix ?? generalFix,
    finding: remembered && explainFinding(remembered, guide?.fix[0]),
  }
}

function explainFinding({ finding, target }: RememberedFinding, generalFix: string | undefined): z.infer<typeof ExplainedFindingSchema> {
  const why =
    finding.source === 'engine'
      ? `The axe-core rule ${finding.rule_id ?? ''} failed on this element: ${finding.message}.`
      : [
          finding.message,
          finding.evidence ? `The evidence quoted from the element, "${finding.evidence}", is on the page: the claim passed Rampa's verification.` : undefined,
          finding.agreement && finding.agreement.total > 1 ? `${finding.agreement.votes} of ${finding.agreement.total} runs agreed.` : undefined,
        ]
          .filter(Boolean)
          .join(' ')
  let fix: string
  if (finding.patch?.before && finding.patch.after) {
    fix = `Replace ${finding.patch.before} with ${finding.patch.after}.`
    if (finding.criterion === '1.1.1' && finding.source === 'judgment') fix += ' The suggested text describes what a model saw in the image: have a person review it.'
  } else if (finding.how_to_fix) {
    fix = `${finding.how_to_fix}${/[.!?]$/.test(finding.how_to_fix) ? '' : '.'}${finding.help_url ? ` More: ${finding.help_url}` : ''}`
  } else {
    fix = generalFix ?? (finding.help_url ? `See ${finding.help_url}` : 'See the W3C Understanding document.')
  }
  return { ...finding, target, why, fix }
}

export function explanationText(explanation: Explanation): string {
  const { criterion } = explanation
  const lines = [`WCAG ${criterion.id}${criterion.level ? ` (${criterion.level})` : ''} — ${criterion.name}`]
  if (criterion.understanding_url) lines.push(`Understanding: ${criterion.understanding_url}`)
  if (explanation.wcag_text) lines.push(`WCAG text: "${explanation.wcag_text}"`)
  if (explanation.note) lines.push(explanation.note)
  lines.push('')
  if (explanation.axe_checks) lines.push(`axe-core checks: ${explanation.axe_checks}${criterion.axe_rules.length > 0 ? ` (rules ${criterion.axe_rules.join(', ')})` : ''}`)
  else if (criterion.axe_rules.length > 0) lines.push(`axe-core rules: ${criterion.axe_rules.join(', ')}`)
  if (explanation.rampa_judges) lines.push(`Rampa judges: ${explanation.rampa_judges}${criterion.default ? '' : ' (not in the default set)'}`)
  else lines.push('Rampa does not judge this criterion with a model.')
  if (explanation.fails_when.length > 0) {
    lines.push('', 'Rampa reports a failure when:')
    for (const item of explanation.fails_when) lines.push(`- ${item}`)
  }
  lines.push('', 'How to fix:')
  for (const item of explanation.how_to_fix) lines.push(`- ${item}`)
  if (criterion.act_rules.length > 0) lines.push('', `W3C ACT rules: ${criterion.act_rules.map((rule) => `${rule.id} ${rule.url}`).join(', ')}`)
  const finding = explanation.finding
  if (finding) {
    lines.push('', `Finding ${finding.id} on ${finding.target}:`)
    if (finding.selector) lines.push(`  Element: ${finding.selector}`)
    lines.push(`  Why: ${finding.why}`, `  Fix: ${finding.fix}`)
  }
  return lines.join('\n')
}
