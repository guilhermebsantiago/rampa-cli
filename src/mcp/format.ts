import { z } from 'zod'
import type { EngineResults, Finding, Report } from '../core/types.ts'
import { type Locale, t } from '../i18n.ts'
import { estimateCostUsd } from '../providers/models.ts'
import { displayTarget, usageLine } from '../report/pretty.ts'
import { WCAG21_A_AA, criterionLabel, successCriterion } from '../wcag.ts'

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
  source: z.enum(['engine', 'judgment']).describe('engine: an axe-core rule failed; judgment: a model claim that passed verification'),
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
})
export type AgentFinding = z.infer<typeof FindingSchema>

// The short parts come first and the findings last, so a reader that skims, or a client that cuts a long result, keeps the coverage.
export const CheckResultSchema = z.object({
  target: z.string(),
  surface: z.string(),
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
  }),
  coverage: z.object({
    statement: z.string(),
    checked_by_engine: z.array(z.string()),
    judged: z.array(z.string()),
    not_checked: z.array(z.string()),
  }),
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
    const key = `${finding.criterion}|${finding.source === 'engine' ? finding.ruleId : 'judgment'}`
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
  const listed = pickFindings(report.findings, maxFindings)
  const findings = listed.map((finding) => agentFinding(finding, engine))
  const isListed = new Set(listed)
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
    },
    coverage: {
      statement: coverageStatement(report.locale),
      checked_by_engine: report.coverage.engine,
      judged: report.coverage.judged,
      not_checked: report.coverage.notChecked,
    },
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
  }
}

function notesOf(report: Report, findings: AgentFinding[]): string[] {
  const locale = report.locale
  const notes: string[] = []
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
  if (report.belowThreshold.length > 0) notes.push(t(locale, 'agentBelowThreshold', { count: report.belowThreshold.length }))
  return notes
}

/** Plain text for the agent and for whoever reads the transcript: no colors, tool arguments instead of CLI flags. */
export function checkText(report: Report, result: CheckResult): string {
  const locale = report.locale
  const lines: string[] = []
  lines.push(`Rampa: ${displayTarget(report.target)}`)
  const meta = [`${t(locale, 'surface')}: ${report.surface}`, `${report.engine.name} ${report.engine.version}`]
  if (report.model) meta.push(`${t(locale, 'model')}: ${report.model}`)
  lines.push(meta.join(' · '), '')

  if (result.findings.length === 0) lines.push(t(locale, 'noFindings'))
  else {
    lines.push(
      t(locale, 'agentFindings', {
        count: result.summary.findings,
        engine: result.summary.from_engine,
        engineName: report.engine.name,
        judged: result.summary.judged,
      }),
    )
  }
  // A rule that fails on many elements usually gives each the same advice; it is written out once.
  const advice = new Map<string, number>()
  for (const [index, finding] of result.findings.entries()) {
    lines.push('', `${index + 1}. ${criterionLabel(finding.criterion, locale)}`)
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
        : [finding.agreement && `${finding.agreement.votes}/${finding.agreement.total} ${t(locale, 'runs')}`, t(locale, 'verified')]
    lines.push(`   ${[`${t(locale, 'confidence')} ${t(locale, finding.confidence)}`, ...details, `id ${finding.id}`].filter(Boolean).join(' · ')}`)
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
  lines.push(`  ${t(locale, 'coverageJudged')} ${list(report.coverage.judged)}`)
  lines.push(
    `  ${t(locale, 'coverageNotChecked')} ${t(locale, 'agentNotCheckedList', { count: notChecked.length, total: WCAG21_A_AA.length, list: list(notChecked) })}`,
  )
  lines.push(t(locale, 'disclaimer'), t(locale, 'manualReview'))
  return lines.join('\n')
}
