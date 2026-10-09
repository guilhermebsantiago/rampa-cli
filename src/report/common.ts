import { reviewOnlyCriteria } from '../core/coverage.ts'
import type { CoverageMethod, CoverageStatus, CriterionCoverage, Finding, Report, ReviewItem } from '../core/types.ts'
import { type Locale, type MessageKey, t } from '../i18n.ts'
import { type WcagVersion, compareCriteria, criteriaFor, successCriterion, versionOf } from '../wcag.ts'
import { displayTarget, usageLine } from './pretty.ts'

/** Helpers shared by the Markdown, HTML and SARIF reports. */

export const PROJECT_URL = 'https://rampa.guilhermebs.com.br'
export const WAIVERS_FILE = '.rampa/waivers.json'

/** A message written `one|other`: the first form for a count of 1, the second for any other. */
export function plural(locale: Locale, key: MessageKey, count: number, vars: Record<string, string | number> = {}): string {
  const forms = t(locale, key).split('|')
  const form = (count === 1 ? forms[0] : forms[1]) ?? forms[0] ?? ''
  const values: Record<string, string | number> = { count, ...vars }
  return form.replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? `{${name}}`))
}

/** The WCAG version a report checked against. */
export function wcagVersion(report: Pick<Report, 'wcagTarget'>): WcagVersion {
  return versionOf(report.wcagTarget)
}

/** How many criteria a report states coverage against: 50 for WCAG 2.1, 55 for 2.2. */
export function targetTotal(report: Pick<Report, 'wcagTarget'>): number {
  return criteriaFor(wcagVersion(report)).length
}

/** What happened to 4.1.1 Parsing, which no run checks: satisfied by definition under 2.1, removed in 2.2. */
export function parsingNote(report: Pick<Report, 'wcagTarget' | 'locale'>): string {
  return t(report.locale, wcagVersion(report) === '2.1' ? 'coverageParsing21' : 'coverageParsing22')
}

/** The W3C Recommendation a report checked against. */
export function wcagUrl(version: WcagVersion): string {
  return version === '2.1' ? 'https://www.w3.org/TR/WCAG21/' : 'https://www.w3.org/TR/WCAG22/'
}

/** W3C's Understanding page of a WCAG success criterion: its intent, with examples and techniques. WCAG 2.2's pages cover the 2.1 criteria too. */
export function understandingUrl(id: string): string | undefined {
  const sc = successCriterion(id)
  if (!sc) return undefined
  const slug = sc.name.en
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `https://www.w3.org/WAI/WCAG22/Understanding/${slug}.html`
}

export function criterionName(id: string, locale: Locale): string | undefined {
  const sc = successCriterion(id)
  return sc ? (sc.name[locale] ?? sc.name.en) : undefined
}

/** `WCAG 2.4.4 (A)`, or the bare id for a rule outside WCAG A/AA. */
export function criterionTag(finding: Finding): string {
  if (!successCriterion(finding.criterion)) return finding.criterion
  return finding.level ? `WCAG ${finding.criterion} (${finding.level})` : `WCAG ${finding.criterion}`
}

/** A page as reports name it: its file relative to the repository, else its address. */
export function pageLabel(report: Report): string {
  return report.sourceFile ?? displayTarget(report.target)
}

/** `file:line` when the finding was traced to the source, else the selector of its element. */
export function findingPlace(finding: Finding): string {
  if (finding.location) return `${finding.location.file}:${finding.location.startLine}`
  return finding.ref ?? finding.target ?? ''
}

/** What a report shows: confirmed findings, plus those below the confidence threshold with --verbose. */
export function shownFindings(report: Report, verbose: boolean): Finding[] {
  const findings = verbose ? [...report.findings, ...report.belowThreshold] : [...report.findings]
  return findings.sort((a, b) => compareCriteria(a.criterion, b.criterion))
}

export interface LevelCounts {
  total: number
  A: number
  AA: number
}

export function countLevels(findings: readonly Finding[]): LevelCounts {
  return {
    total: findings.length,
    A: findings.filter((finding) => finding.level === 'A').length,
    AA: findings.filter((finding) => finding.level === 'AA').length,
  }
}

/** "6 at Level A, 3 at Level AA", leaving out a level with none. */
export function levelBreakdown(counts: LevelCounts, locale: Locale, version: WcagVersion): string {
  const parts: string[] = []
  if (counts.A > 0) parts.push(t(locale, 'atLevel', { count: counts.A, level: 'A' }))
  if (counts.AA > 0) parts.push(t(locale, 'atLevel', { count: counts.AA, level: 'AA' }))
  const other = counts.total - counts.A - counts.AA
  if (other > 0) parts.push(t(locale, 'outsideLevels', { count: other, version }))
  return parts.join(', ')
}

/** Criteria whose only automated result is "needs review"; empty for reports written before Rampa recorded it. */
export function reviewOnly(report: Report): string[] {
  return reviewOnlyCriteria(report.coverage.criteria ?? [], [...report.coverage.engine, ...(report.coverage.rules ?? [])], report.coverage.judged)
}

export interface CoverageRow {
  key: 'engine' | 'rules' | 'judged' | 'review' | 'notChecked'
  label: string
  criteria: string[]
  text: string
}

/**
 * The lines of coverage, as the terminal report words them. "Needs review only" is there when there is any,
 * or always for a table; the line for Rampa's rules when a rule decided something on the page, or when
 * `withRules` asks for it (a table of several pages keeps its columns).
 */
export function coverageRows(report: Report, always = false, withRules = (report.coverage.rules?.length ?? 0) > 0): CoverageRow[] {
  const { locale } = report
  const list = (items: readonly string[]) => (items.length === 0 ? '—' : items.join(', '))
  const review = reviewOnly(report)
  const rules = report.coverage.rules ?? []
  return [
    { key: 'engine', label: t(locale, 'coverageEngine', { engine: report.engine.name }), criteria: report.coverage.engine, text: list(report.coverage.engine) },
    ...(withRules ? [{ key: 'rules' as const, label: t(locale, 'coverageRules'), criteria: rules, text: list(rules) }] : []),
    { key: 'judged', label: t(locale, 'coverageJudged'), criteria: report.coverage.judged, text: list(report.coverage.judged) },
    ...(review.length > 0 || always ? [{ key: 'review' as const, label: t(locale, 'coverageReview'), criteria: review, text: list(review) }] : []),
    {
      key: 'notChecked',
      label: t(locale, 'coverageNotChecked'),
      criteria: report.coverage.notChecked,
      text: t(locale, 'coverageNotCheckedOf', { count: report.coverage.notChecked.length, total: targetTotal(report), version: wcagVersion(report) }),
    },
  ]
}

/** One sentence: what was checked, judged and left unchecked on a page, and that it is not a verdict of accessibility. */
export function coverageStatement(report: Report): string {
  const { locale } = report
  const parts = coverageRows(report).map((row) => `${row.label} ${row.text}`)
  return `${parts.join('; ')}. ${parsingNote(report)} ${t(locale, 'disclaimer')} ${t(locale, 'manualReview')}`
}

const STATUS_KEYS: Record<CoverageStatus, MessageKey> = {
  failures: 'statusFailures',
  'needs-review': 'statusNeedsReview',
  'no-failure-found': 'statusNoFailure',
  'no-applicable-content': 'statusNoContent',
  'not-checked': 'statusNotChecked',
  'satisfied-by-definition': 'statusByDefinition',
}

/** A criterion's status in words; never "passed". */
export function statusText(status: CoverageStatus, locale: Locale): string {
  return t(locale, STATUS_KEYS[status])
}

/** `axe-core color-contrast (40 applicable, 0 failed, 12 to review)`, or `judgment/2.4.4@3 did not run`. */
export function methodText(method: CoverageMethod, report: Pick<Report, 'locale' | 'engine'>): string {
  const { locale } = report
  // Rampa's own rules (src/rules) carry their prefix, rampa/; the engine's rules are named after the engine.
  const name =
    method.kind === 'judgment'
      ? `${t(locale, 'methodJudgment')} ${method.id.replace(/^judgment\//, '')}`
      : method.id.startsWith('rampa/')
        ? method.id
        : `${report.engine.name} ${method.id}`
  if (!method.ran) return `${name} ${t(locale, 'methodNotRun')}`
  const tags = [method.reviewOnly ? t(locale, 'methodReviewOnly') : undefined, method.maturity === 'experimental' ? t(locale, 'methodExperimental') : undefined].filter(Boolean)
  const counts = t(locale, 'methodCounts', { applicable: method.applicable, failures: method.failures, review: method.review })
  return `${name} (${counts}${tags.length > 0 ? `; ${tags.join(', ')}` : ''})`
}

/** The methods behind a criterion: those that applied in full, then a count of the rules with nothing to check. */
export function methodsText(record: CriterionCoverage, report: Pick<Report, 'locale' | 'engine'>): string {
  // The engine's idle rules are counted; Rampa's own (rampa/...) are few and keep their names.
  const idle = record.methods.filter((m) => m.ran && m.kind !== 'judgment' && !m.id.startsWith('rampa/') && m.applicable === 0 && m.failures === 0 && m.review === 0)
  const shown = record.methods.filter((m) => !idle.includes(m)).map((m) => methodText(m, report))
  if (idle.length === 1 && idle[0]) shown.push(methodText(idle[0], report))
  else if (idle.length > 1) shown.push(t(report.locale, 'methodsIdle', { count: idle.length, engine: report.engine.name }))
  return shown.join('; ') || '—'
}

export interface ReviewGroup {
  criterion: string
  ruleId: string
  items: ReviewItem[]
  /** The engine's reason for the first element; elements of one rule usually share it. */
  reason: string
  helpUrl?: string | undefined
}

/** Review items by criterion and rule, in criterion order. */
export function reviewGroups(report: Report): ReviewGroup[] {
  const groups = new Map<string, ReviewGroup>()
  for (const item of report.needsReview ?? []) {
    const key = `${item.criterion}|${item.ruleId}`
    const group = groups.get(key)
    if (group) group.items.push(item)
    else groups.set(key, { criterion: item.criterion, ruleId: item.ruleId, items: [item], reason: item.message, helpUrl: item.helpUrl })
  }
  return [...groups.values()].sort((a, b) => compareCriteria(a.criterion, b.criterion) || a.ruleId.localeCompare(b.ruleId))
}

/** One line: how many elements need review, by criterion. Undefined when none do. */
export function reviewNote(report: Report): string | undefined {
  const items = report.needsReview ?? []
  if (items.length === 0) return undefined
  const counts = new Map<string, number>()
  for (const item of items) counts.set(item.criterion, (counts.get(item.criterion) ?? 0) + 1)
  const list = [...counts].sort(([a], [b]) => compareCriteria(a, b)).map(([criterion, count]) => `${criterion}: ${count}`)
  return t(report.locale, 'reviewNote', { count: items.length, engine: report.engine.name, list: list.join(', ') })
}

/** The model and the engine behind a set of reports, for a one-line attribution. */
export function toolsLine(reports: readonly Report[]): string {
  const engines = [...new Set(reports.map((report) => `${report.engine.name} ${report.engine.version}`))]
  const models = [...new Set(reports.flatMap((report) => (report.llm === 'on' && report.model ? [report.model] : [])))]
  return [...engines, ...models].join(' · ')
}

export interface DiffLine {
  kind: 'context' | 'removed' | 'added'
  text: string
}

/** A patch as lines: the ones it changes, between the ones it keeps, as a unified diff shows them. */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split(/\r?\n/)
  const b = after.split(/\r?\n/)
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head++
  let tailA = a.length
  let tailB = b.length
  while (tailA > head && tailB > head && a[tailA - 1] === b[tailB - 1]) {
    tailA--
    tailB--
  }
  const line = (kind: DiffLine['kind']) => (text: string) => ({ kind, text })
  return [
    ...a.slice(0, head).map(line('context')),
    ...a.slice(head, tailA).map(line('removed')),
    ...b.slice(head, tailB).map(line('added')),
    ...a.slice(tailA).map(line('context')),
  ]
}

/** The patch of a finding, as written in the source file when it was traced there. */
export function patchOf(finding: Finding): { before: string; after: string } | undefined {
  const before = finding.location?.fix?.before ?? finding.patch?.before
  const after = finding.location?.fix?.after ?? finding.patch?.after
  return before && after && before !== after ? { before, after } : undefined
}

/** Model usage summed over pages, worded like the terminal report; one line for the whole run. */
export function runUsageLine(reports: readonly Report[]): string | undefined {
  const first = reports[0]
  if (!first) return undefined
  const usage = reports.reduce(
    (sum, report) => ({
      calls: sum.calls + report.usage.calls,
      cachedCalls: sum.cachedCalls + report.usage.cachedCalls,
      inputTokens: sum.inputTokens + report.usage.inputTokens,
      outputTokens: sum.outputTokens + report.usage.outputTokens,
      latencyMs: sum.latencyMs + report.usage.latencyMs,
    }),
    { calls: 0, cachedCalls: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0 },
  )
  return usageLine({ ...first, usage })
}

/**
 * A link target, only for http and https. Engine results are produced inside the page
 * being checked, so a hostile page could plant a javascript: URL in them.
 */
export function safeUrl(url: string | undefined): string | undefined {
  if (!url) return undefined
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : undefined
  } catch {
    return undefined
  }
}

/** Escapes text for HTML element content and attribute values. */
export function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}
