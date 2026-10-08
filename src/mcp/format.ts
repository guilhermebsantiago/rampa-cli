import { z } from 'zod'
import type { EngineResults, Finding, Report } from '../core/types.ts'
import { type Locale, t } from '../i18n.ts'
import { estimateCostUsd } from '../providers/models.ts'
import { displayTarget } from '../report/pretty.ts'
import { WCAG21_A_AA, criterionLabel, successCriterion } from '../wcag.ts'

/**
 * What a check returns to an agent: `structuredContent` follows CheckResultSchema, and the
 * text block says the same in plain words. Names are snake_case, like the tool arguments.
 */

const PatchSchema = z.object({
  kind: z.enum(['set-attribute', 'set-text']),
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
  model: z.string().optional(),
})
export type AgentFinding = z.infer<typeof FindingSchema>

export const CheckResultSchema = z.object({
  target: z.string(),
  surface: z.string(),
  judgment: z.enum(['on', 'off', 'no-model']).describe('on: a model judged the residue; off: no_llm, axe-core only'),
  model: z.string().optional(),
  engine: z.object({ name: z.string(), version: z.string() }),
  findings: z.array(FindingSchema),
  summary: z.object({
    findings: z.number().int(),
    from_engine: z.number().int(),
    judged: z.number().int(),
    below_threshold: z.number().int(),
    waived: z.number().int(),
    discarded_claims: z.number().int().describe('Model claims dropped because their evidence was not on the page'),
    cannot_tell: z.number().int(),
    not_judged: z.number().int().describe('Candidates no model judged: no_llm, a cache miss offline, or a model error'),
  }),
  coverage: z.object({
    checked_by_engine: z.array(z.string()),
    judged: z.array(z.string()),
    not_checked: z.array(z.string()),
    statement: z.string(),
  }),
  usage: z.object({
    model_calls: z.number().int(),
    cached_calls: z.number().int(),
    input_tokens: z.number().int(),
    output_tokens: z.number().int(),
    estimated_cost_usd: z.number().nullable().describe('Price of the judgments in this report, cached ones included; 0 for local models, null when unknown'),
  }),
  notes: z.array(z.string()),
  errors: z.array(z.string()),
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
    model: finding.model,
  }
}

export function checkResult(report: Report, engine: EngineResults): CheckResult {
  const findings = report.findings.map((finding) => agentFinding(finding, engine))
  const sum = (key: 'judged' | 'discarded' | 'cannotTell' | 'candidates') =>
    report.criteria.filter((c) => c.applicable).reduce((total, c) => total + c[key], 0)
  return {
    target: report.target,
    surface: report.surface,
    judgment: report.llm,
    model: report.model,
    engine: report.engine,
    findings,
    summary: {
      findings: findings.length,
      from_engine: findings.filter((f) => f.source === 'engine').length,
      judged: findings.filter((f) => f.source === 'judgment').length,
      below_threshold: report.belowThreshold.length,
      waived: report.waived.length,
      discarded_claims: sum('discarded'),
      cannot_tell: sum('cannotTell'),
      not_judged: sum('candidates') - sum('judged'),
    },
    coverage: {
      checked_by_engine: report.coverage.engine,
      judged: report.coverage.judged,
      not_checked: report.coverage.notChecked,
      statement: coverageStatement(report.locale),
    },
    usage: {
      model_calls: report.usage.calls,
      cached_calls: report.usage.cachedCalls,
      input_tokens: report.usage.inputTokens,
      output_tokens: report.usage.outputTokens,
      estimated_cost_usd: estimateCostUsd(report.model, report.usage.inputTokens, report.usage.outputTokens) ?? null,
    },
    notes: notesOf(report, findings),
    errors: report.errors,
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

/** The same usage line as the terminal report: calls, tokens and the estimated price. */
function usageLine(report: Report, result: CheckResult): string | undefined {
  const { usage, locale } = report
  if (usage.calls + usage.cachedCalls === 0) return undefined
  const decimal = (value: number, digits: number) => {
    const text = value.toFixed(digits)
    return locale === 'pt-BR' ? text.replace('.', ',') : text
  }
  const line = t(locale, 'usage', {
    calls: usage.calls,
    cached: usage.cachedCalls,
    input: decimal(usage.inputTokens / 1000, 1),
    output: decimal(usage.outputTokens / 1000, 1),
  })
  const cost = result.usage.estimated_cost_usd
  if (cost === null) return line
  if (cost === 0) return `${line} · ${t(locale, 'usageLocal')}`
  return `${line} · ${cost < 0.0001 ? `< US$ ${decimal(0.0001, 4)}` : `≈ US$ ${decimal(cost, 4)}`}`
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
    if (finding.how_to_fix) lines.push(`   ${t(locale, 'agentHowToFix')}: ${finding.how_to_fix}`)
    const details =
      finding.source === 'engine'
        ? [`${report.engine.name} ${t(locale, 'engineRule')} ${finding.rule_id ?? ''}`, finding.help_url]
        : [
            `${t(locale, 'confidence')} ${t(locale, finding.confidence)}`,
            finding.agreement && `${finding.agreement.votes}/${finding.agreement.total} ${t(locale, 'runs')}`,
            t(locale, 'verified'),
          ]
    lines.push(`   ${[...details, `id ${finding.id}`].filter(Boolean).join(' · ')}`)
  }

  if (result.notes.length > 0) {
    lines.push('', `${t(locale, 'agentNotes')}:`)
    for (const note of result.notes) lines.push(`- ${note}`)
  }
  const usage = usageLine(report, result)
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
