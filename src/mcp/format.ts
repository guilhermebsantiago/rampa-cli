import { z } from 'zod'
import { type GroupOf, groupList } from '../core/groups.ts'
import type { EngineResults, Finding, Report } from '../core/types.ts'
import { type Locale, t } from '../i18n.ts'
import { estimateCostUsd } from '../providers/models.ts'
import { groupWhy, groupsClause, memberAbout, plural, reviewGroups, reviewOnly, thresholdLevel, truncationText } from '../report/common.ts'
import { beyondTargetNote, displayTarget, usageLine } from '../report/pretty.ts'
import { criteriaFor, criterionLabel, successCriterion, versionOf } from '../wcag.ts'

/**
 * What a check returns to an agent: `structuredContent` follows CheckResultSchema, and the
 * text block says the same in plain words. Clients differ in which of the two reaches the
 * model (Claude Code 2.1 passes only the structured content when both are present), so each
 * carries the findings, the notes and the coverage statement on its own.
 * Names are snake_case, like the tool arguments.
 */

const PatchSchema = z.object({
  kind: z.enum(['set-attribute', 'set-text', 'replace-element']),
  attribute: z.string().optional(),
  from: z.string().optional(),
  to: z.string(),
  before: z.string().optional().describe('The markup as it is'),
  after: z.string().optional().describe('The markup with the fix'),
})

export const FindingSchema = z.object({
  id: z.string().describe('Stable id of the finding; explain_finding takes it'),
  criterion: z.string(),
  criterion_name: z.string().optional(),
  level: z.enum(['A', 'AA', 'AAA']).optional(),
  source: z
    .enum(['engine', 'judgment', 'rule', 'probe'])
    .describe(
      'engine: an axe-core rule failed; rule: a Rampa rule over the page failed, with no model; judgment: a model claim that passed verification; probe: a rule over what a probe measured on the page',
    ),
  selector: z.string().optional().describe('The element: a CSS selector on the web, the native locator elsewhere'),
  message: z.string(),
  evidence: z.string().optional().describe('Text quoted from the element, checked to be on the page'),
  patch: PatchSchema.optional(),
  confidence: z.enum(['low', 'medium', 'high']),
  agreement: z.object({ votes: z.number().int(), total: z.number().int() }).optional(),
  rule_id: z.string().optional(),
  help_url: z.string().optional(),
  html: z.string().optional(),
  how_to_fix: z.string().optional().describe("axe-core's fix summary for this element"),
  group: z.string().optional().describe('Set on the example of a group of near-identical findings: the id of the group in groups, which lists every member'),
})
export type AgentFinding = z.infer<typeof FindingSchema>

export const GroupSchema = z
  .object({
    id: z.string().describe('The id of the group, not of a finding'),
    criterion: z.string(),
    check: z.string().describe('The check behind every member: a rule id, or judgment/<criterion> for a model judgment'),
    claim: z.string().optional().describe('The kind of claim every member makes, such as "ambiguous" for links that share a text'),
    count: z.number().int(),
    example: z.string().describe('The id of the member findings lists'),
    members: z
      .array(z.object({ id: z.string(), selector: z.string().optional(), about: z.string().optional().describe('What the finding is about: the link text, the alternative, or its evidence') }))
      .describe('Every member, the example first; explain_finding takes any of their ids'),
  })
  .describe('More than five findings on the page with the same criterion, check and claim, listed once by their example')

// The short parts come first and the findings last, so a reader that skims, or a client that cuts a long result, keeps the coverage.
export const CheckResultSchema = z.object({
  target: z.string(),
  surface: z.string(),
  wcag_target: z.enum(['wcag21-aa', 'wcag22-aa']).describe('What the check stated coverage against: WCAG 2.2 A/AA by default, or 2.1 with wcag "2.1"'),
  judgment: z.enum(['on', 'off']).describe('on: a model judged the residue; off: no_llm, axe-core only'),
  model: z.string().optional(),
  engine: z.object({ name: z.string(), version: z.string() }),
  summary: z.object({
    findings: z.number().int(),
    from_engine: z.number().int(),
    judged: z.number().int(),
    left_out: z.number().int().describe('Findings past max_findings: counted here, not listed'),
    below_threshold: z.number().int(),
    waived: z.number().int(),
    discarded_claims: z.number().int().describe('Model claims dropped because their evidence was not on the page'),
    cannot_tell: z.number().int(),
    not_judged: z.number().int().describe('Candidates no model judged: no_llm, a cache miss offline, or a model error'),
    needs_review: z.number().int().describe('Elements axe-core could not decide: a person looks at them; never failures'),
    groups: z.number().int().describe('Groups of near-identical findings listed once each; every member counts in findings'),
  }),
  coverage: z.object({
    statement: z.string(),
    checked_by_engine: z.array(z.string()).describe('Criteria where an axe-core rule able to report a failure decided at least one element'),
    checked_by_rules: z
      .array(z.string())
      .optional()
      .describe("Criteria where one of Rampa's own rules, with no model, decided at least one element (rather than sending it to review)"),
    judged: z.array(z.string()),
    needs_review_only: z.array(z.string()).describe('Criteria whose only automated result is something to review: not checked'),
    not_checked: z.array(z.string()),
    criteria: z
      .array(
        z.object({
          id: z.string(),
          status: z.enum(['failures', 'needs-review', 'no-failure-found', 'no-applicable-content', 'not-checked', 'satisfied-by-definition']),
          beyond_target: z.boolean().optional(),
          checked_by: z.array(z.string()).describe('Methods that applied: axe-core rule ids, Rampa rule ids (rampa/...), or judgment/<criterion>@<version>'),
        }),
      )
      .describe('Each criterion of the target. Never "passed": no-failure-found covers only what was checked'),
  }),
  needs_review: z
    .array(
      z.object({
        criterion: z.string(),
        rule_id: z.string(),
        count: z.number().int(),
        reason: z.string(),
        selectors: z.array(z.string()).describe('The first few elements'),
      }),
    )
    .describe('What axe-core or Rampa rules could not decide, by criterion and rule. Not failures: tell the user, do not "fix" them blindly'),
  notes: z.array(z.string()),
  usage: z.object({
    model_calls: z.number().int(),
    cached_calls: z.number().int(),
    input_tokens: z.number().int(),
    output_tokens: z.number().int(),
    estimated_cost_usd: z.number().nullable().describe('Price of the judgments in this report, cached ones included; 0 for local models, null when unknown'),
  }),
  errors: z.array(z.string()),
  findings: z.array(FindingSchema),
  groups: z
    .array(GroupSchema)
    .describe(
      'Bursts of near-identical findings, to review together: findings lists each group once, by its example. Each member is a finding of its own, checked and counted like any other; if the example turns out wrong, check the others before fixing them',
    ),
})
export type CheckResult = z.infer<typeof CheckResultSchema>

export function coverageStatement(locale: Locale): string {
  return `${t(locale, 'disclaimer')} ${t(locale, 'manualReview')}`
}

/** axe-core's `Fix any of the following:` summary, on one line. */
function fixSummary(message: string | undefined): string | undefined {
  if (!message) return undefined
  const [first = '', ...rest] = message
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  return rest.length > 0 ? `${first} ${rest.join('; ')}` : first || undefined
}

/** An axe target is a JSON list of selectors, one per frame or shadow root; a single one is the element's CSS selector. */
function selectorOf(finding: Finding): string | undefined {
  if (finding.ref) return finding.ref
  if (!finding.target) return undefined
  try {
    const parsed: unknown = JSON.parse(finding.target)
    if (Array.isArray(parsed) && parsed.length === 1 && typeof parsed[0] === 'string') return parsed[0]
  } catch {
    // not JSON: already a selector
  }
  return finding.target
}

export function agentFinding(finding: Finding, engine: EngineResults): AgentFinding {
  const node =
    finding.source === 'engine'
      ? engine.rules.find((rule) => rule.ruleId === finding.ruleId && rule.outcome === 'violation')?.nodes.find((n) => n.target === finding.target)
      : undefined
  return {
    id: finding.fingerprint,
    criterion: finding.criterion,
    criterion_name: successCriterion(finding.criterion)?.name.en,
    level: finding.level,
    source: finding.source,
    selector: selectorOf(finding),
    message: finding.message,
    evidence: finding.evidence,
    patch: finding.patch && {
      kind: finding.patch.kind,
      attribute: finding.patch.attribute,
      from: finding.patch.from,
      to: finding.patch.to,
      before: finding.patch.before,
      after: finding.patch.after,
    },
    confidence: finding.confidence,
    agreement: finding.agreement,
    rule_id: finding.ruleId,
    help_url: finding.helpUrl,
    html: finding.html,
    how_to_fix: fixSummary(node?.message),
  }
}

/**
 * At most `max` findings, taken in turns from each rule and each judged criterion, then put back in report order.
 * Taking the first `max` would let a rule that fails on hundreds of elements (contrast, say) push the judged findings out of the list.
 */
export function pickFindings(findings: readonly Finding[], max: number): Finding[] {
  if (findings.length <= max) return [...findings]
  const groups = new Map<string, number[]>()
  for (const [index, finding] of findings.entries()) {
    const key = `${finding.criterion}|${finding.source !== 'judgment' ? finding.ruleId : 'judgment'}`
    groups.set(key, [...(groups.get(key) ?? []), index])
  }
  const chosen = new Set<number>()
  for (let round = 0; chosen.size < max; round++) {
    const takers = [...groups.values()].filter((indexes) => round < indexes.length)
    if (takers.length === 0) break
    for (const indexes of takers) {
      if (chosen.size >= max) break
      chosen.add(indexes[round] as number)
    }
  }
  return findings.filter((_, index) => chosen.has(index))
}

/** A page can fail one axe-core rule on hundreds of elements; past `maxFindings` the rest are counted, not listed, to keep the agent's context usable. */
export function checkResult(report: Report, engine: EngineResults, maxFindings = Number.POSITIVE_INFINITY): CheckResult {
  // A burst of near-identical findings takes one place in the list, by its example; groups lists its members (core/groups.ts).
  const grouped = groupList(report.findings, 'findings')
  const groupOf = groupsByMember(grouped)
  const entries = report.findings.filter((finding) => (groupOf.get(finding)?.members[0] ?? finding) === finding)
  const listed = pickFindings(entries, maxFindings)
  const findings = listed.map((finding) => {
    const group = groupOf.get(finding)
    return group ? { ...agentFinding(finding, engine), group: group.group.id } : agentFinding(finding, engine)
  })
  const isListed = new Set(listed.flatMap((finding) => groupOf.get(finding)?.members ?? [finding]))
  const groups = grouped.filter((entry) => listed.includes(entry.members[0] as Finding))
  const leftOut = report.findings.filter((finding) => !isListed.has(finding))
  const sum = (key: 'judged' | 'discarded' | 'cannotTell' | 'candidates') =>
    report.criteria.filter((c) => c.applicable).reduce((total, c) => total + c[key], 0)
  const notes = notesOf(report, findings)
  if (leftOut.length > 0) {
    const counts = new Map<string, number>()
    for (const finding of leftOut) counts.set(finding.criterion, (counts.get(finding.criterion) ?? 0) + 1)
    const list = [...counts].map(([criterion, count]) => `${criterion}: ${count}`).join(', ')
    notes.unshift(t(report.locale, 'agentLeftOut', { count: leftOut.length, list }))
  }
  return {
    target: report.target,
    surface: report.surface,
    wcag_target: report.wcagTarget ?? 'wcag21-aa',
    // A check without a model is a tool error before it gets here, so the report never says no-model.
    judgment: report.llm === 'on' ? 'on' : 'off',
    model: report.model,
    engine: report.engine,
    summary: {
      findings: report.findings.length,
      from_engine: report.findings.filter((f) => f.source === 'engine').length,
      judged: report.findings.filter((f) => f.source === 'judgment').length,
      left_out: leftOut.length,
      below_threshold: report.belowThreshold.length,
      waived: report.waived.length,
      discarded_claims: sum('discarded'),
      cannot_tell: sum('cannotTell'),
      not_judged: sum('candidates') - sum('judged'),
      needs_review: report.needsReview?.length ?? 0,
      groups: groups.length,
    },
    coverage: {
      statement: coverageStatement(report.locale),
      checked_by_engine: report.coverage.engine,
      ...(report.coverage.rules?.length ? { checked_by_rules: report.coverage.rules } : {}),
      judged: report.coverage.judged,
      needs_review_only: reviewOnly(report),
      not_checked: report.coverage.notChecked,
      criteria: (report.coverage.criteria ?? []).map((record) => ({
        id: record.id,
        status: record.status,
        ...(record.target === 'beyond' ? { beyond_target: true } : {}),
        checked_by: record.methods.filter((m) => m.ran && (m.applicable > 0 || m.kind === 'judgment')).map((m) => m.id),
      })),
    },
    needs_review: reviewGroups(report).map((group) => ({
      criterion: group.criterion,
      rule_id: group.ruleId,
      count: group.items.length,
      reason: group.reason,
      selectors: group.items.slice(0, 5).flatMap((item) => (item.ref ?? item.target ? [item.ref ?? item.target ?? ''] : [])),
    })),
    notes,
    usage: {
      model_calls: report.usage.calls,
      cached_calls: report.usage.cachedCalls,
      input_tokens: report.usage.inputTokens,
      output_tokens: report.usage.outputTokens,
      estimated_cost_usd: estimateCostUsd(report.model, report.usage.inputTokens, report.usage.outputTokens) ?? null,
    },
    errors: report.errors,
    findings,
    groups: groups.map(({ group, members }) => ({
      id: group.id,
      criterion: group.criterion,
      check: group.check,
      ...(group.claim ? { claim: group.claim } : {}),
      count: group.count,
      example: group.example,
      members: members.map((member) => {
        const about = memberAbout(member)
        const selector = selectorOf(member)
        return { id: member.fingerprint, ...(selector ? { selector } : {}), ...(about ? { about } : {}) }
      }),
    })),
  }
}

function groupsByMember(groups: readonly GroupOf[]): Map<Finding, GroupOf> {
  const byMember = new Map<Finding, GroupOf>()
  for (const group of groups) for (const member of group.members) byMember.set(member, group)
  return byMember
}

/** The members of the groups a result lists, besides their examples, as explain_finding remembers them. */
export function memberFindings(report: Report, engine: EngineResults, result: CheckResult): AgentFinding[] {
  const listed = new Set(result.groups.map((group) => group.id))
  return groupList(report.findings, 'findings')
    .filter((entry) => listed.has(entry.group.id))
    .flatMap((entry) => entry.members.slice(1).map((member) => ({ ...agentFinding(member, engine), group: entry.group.id })))
}

function notesOf(report: Report, findings: AgentFinding[]): string[] {
  const locale = report.locale
  // A page cut at the collector's budget first: everything else describes only its start.
  const cut = truncationText(report)
  const notes: string[] = cut ? [cut] : []
  const sum = (key: 'discarded' | 'cannotTell' | 'offlineMisses' | 'errors' | 'candidates') =>
    report.criteria.reduce((total, c) => total + c[key], 0)
  if (report.llm === 'off' && sum('candidates') > 0) {
    const criteria = report.criteria.filter((c) => c.candidates > 0).map((c) => c.criterion)
    notes.push(t(locale, 'agentJudgmentSkipped', { count: sum('candidates'), criteria: criteria.join(', '), engineName: report.engine.name }))
  }
  if (findings.some((f) => f.criterion === '1.1.1' && f.source === 'judgment' && f.patch)) notes.push(t(locale, 'agentReviewAlt'))
  if (sum('discarded') > 0) notes.push(t(locale, 'discarded', { count: sum('discarded') }))
  if (sum('cannotTell') > 0) notes.push(t(locale, 'cannotTell', { count: sum('cannotTell') }))
  if (sum('offlineMisses') > 0) notes.push(t(locale, 'offlineMisses', { count: sum('offlineMisses') }))
  if (sum('errors') > 0) notes.push(t(locale, 'judgmentErrors', { count: sum('errors'), error: report.errors[0] ?? '' }))
  if (report.belowThreshold.length > 0) notes.push(t(locale, 'agentBelowThreshold', { count: report.belowThreshold.length, level: thresholdLevel(report) }))
  const beyond = beyondTargetNote(report)
  if (beyond) notes.push(beyond)
  return notes
}

/** Members of a group the text lists; the structured content has every one. */
const LISTED_MEMBERS = 20

/** Plain text for the agent and for whoever reads the transcript: no colors, tool arguments instead of CLI flags. */
export function checkText(report: Report, result: CheckResult): string {
  const locale = report.locale
  const lines: string[] = []
  lines.push(`Rampa: ${displayTarget(report.target)}`)
  const version = versionOf(report.wcagTarget)
  const meta = [`${t(locale, 'surface')}: ${report.surface}`, t(locale, 'wcagTarget', { version }), `${report.engine.name} ${report.engine.version}`]
  if (report.model) meta.push(`${t(locale, 'model')}: ${report.model}`)
  lines.push(meta.join(' · '), '')

  if (result.findings.length === 0) lines.push(t(locale, report.blocked ? 'blockedHeadline' : 'noFindings'))
  else {
    lines.push(
      t(locale, 'agentFindings', {
        count: result.summary.findings,
        engine: result.summary.from_engine,
        engineName: report.engine.name,
        judged: result.summary.judged,
      }),
    )
    // Findings in groups are counted one by one above; the clause says how many are listed once as a group.
    const grouped = groupsClause([report], locale)
    if (grouped) lines.push(grouped)
  }
  const groups = new Map(result.groups.map((group) => [group.id, group]))
  // A rule that fails on many elements usually gives each the same advice; it is written out once.
  const advice = new Map<string, number>()
  for (const [index, finding] of result.findings.entries()) {
    lines.push('', `${index + 1}. ${criterionLabel(finding.criterion, locale)}`)
    // A group of near-identical findings: what it is, then its example as any finding, then every element.
    const group = finding.group ? groups.get(finding.group) : undefined
    if (group) lines.push(`   ${t(locale, 'groupTitle', { count: group.count })} (${t(locale, 'groupLabel')} ${group.id})`, `   ${groupWhy(group, locale)}`, `   ${t(locale, 'groupExample')}:`)
    if (finding.selector) lines.push(`   ${t(locale, 'agentElement')}: ${finding.selector}`)
    lines.push(`   ${finding.message}`)
    if (finding.evidence) lines.push(`   ${t(locale, 'evidence')}: "${finding.evidence}"`)
    if (finding.patch?.before && finding.patch.after) {
      lines.push(`   ${t(locale, 'patch')}:`, `     - ${finding.patch.before}`, `     + ${finding.patch.after}`)
    } else if (finding.html) {
      lines.push(`   ${t(locale, 'agentMarkup')}: ${finding.html}`)
    }
    if (finding.how_to_fix) {
      const key = `${finding.rule_id}|${finding.how_to_fix}`
      const first = advice.get(key)
      lines.push(`   ${t(locale, 'agentHowToFix')}: ${first === undefined ? finding.how_to_fix : t(locale, 'agentSameFix', { n: first })}`)
      if (first === undefined) advice.set(key, index + 1)
    }
    const details =
      finding.source === 'engine'
        ? [`${t(locale, 'engineRule')} ${finding.rule_id ?? ''} (${report.engine.name})`, finding.help_url]
        : finding.source === 'rule'
          ? [`${t(locale, 'rampaRule')} ${finding.rule_id ?? ''}`, finding.help_url]
        : [finding.agreement && `${finding.agreement.votes}/${finding.agreement.total} ${t(locale, 'runs')}`, t(locale, 'verified')]
    lines.push(`   ${[`${t(locale, 'confidence')} ${t(locale, finding.confidence)}`, ...details, `id ${finding.id}`].filter(Boolean).join(' · ')}`)
    if (group) {
      lines.push(`   ${plural(locale, 'reviewElements', group.members.length)}:`)
      for (const member of group.members.slice(0, LISTED_MEMBERS)) lines.push(`   - ${member.selector ?? ''}${member.about ? ` · "${member.about}"` : ''} · id ${member.id}`)
      if (group.members.length > LISTED_MEMBERS) lines.push(`   - ${plural(locale, 'andMore', group.members.length - LISTED_MEMBERS)}`)
    }
  }

  if (result.needs_review.length > 0) {
    lines.push('', `${t(locale, 'reviewTitle')}: ${t(locale, 'reviewIntro', { engine: report.engine.name })}`)
    for (const group of result.needs_review) {
      lines.push(`- ${criterionLabel(group.criterion, locale)}: ${group.count} · ${group.rule_id} · ${group.reason}${group.selectors.length > 0 ? ` (${group.selectors.join(', ')})` : ''}`)
    }
  }
  if (result.notes.length > 0) {
    lines.push('', `${t(locale, 'agentNotes')}:`)
    for (const note of result.notes) lines.push(`- ${note}`)
  }
  const usage = usageLine(report)
  if (usage) lines.push('', usage)

  const list = (items: readonly string[]) => (items.length === 0 ? '—' : items.join(', '))
  const notChecked = report.coverage.notChecked
  lines.push('', t(locale, 'coverageTitle'))
  lines.push(`  ${t(locale, 'coverageEngine', { engine: report.engine.name })} ${list(report.coverage.engine)}`)
  if (report.coverage.rules?.length) lines.push(`  ${t(locale, 'coverageRules')} ${list(report.coverage.rules)}`)
  lines.push(`  ${t(locale, 'coverageJudged')} ${list(report.coverage.judged)}`)
  if (result.coverage.needs_review_only.length > 0) lines.push(`  ${t(locale, 'coverageReview')} ${list(result.coverage.needs_review_only)}`)
  lines.push(
    `  ${t(locale, 'coverageNotChecked')} ${t(locale, 'agentNotCheckedList', { count: notChecked.length, total: criteriaFor(version).length, version, list: list(notChecked) })}`,
  )
  lines.push(`  ${t(locale, version === '2.1' ? 'coverageParsing21' : 'coverageParsing22')}`)
  lines.push(t(locale, 'disclaimer'), t(locale, 'manualReview'))
  return lines.join('\n')
}
