import type { Finding, Report } from '../core/types.ts'
import { type Locale, type MessageKey, t } from '../i18n.ts'
import { WCAG21_A_AA, compareCriteria, successCriterion } from '../wcag.ts'
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

/** W3C's Understanding page of a WCAG 2.1 success criterion: its intent, with examples and techniques. */
export function understandingUrl(id: string): string | undefined {
  const sc = successCriterion(id)
  if (!sc) return undefined
  const slug = sc.name.en
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `https://www.w3.org/WAI/WCAG21/Understanding/${slug}.html`
}

export function criterionName(id: string, locale: Locale): string | undefined {
  const sc = successCriterion(id)
  return sc ? (sc.name[locale] ?? sc.name.en) : undefined
}

/** `WCAG 2.4.4 (A)`, or the bare id for a rule outside WCAG 2.1 A/AA. */
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
export function levelBreakdown(counts: LevelCounts, locale: Locale): string {
  const parts: string[] = []
  if (counts.A > 0) parts.push(t(locale, 'atLevel', { count: counts.A, level: 'A' }))
  if (counts.AA > 0) parts.push(t(locale, 'atLevel', { count: counts.AA, level: 'AA' }))
  const other = counts.total - counts.A - counts.AA
  if (other > 0) parts.push(t(locale, 'outsideLevels', { count: other }))
  return parts.join(', ')
}

/** The three lines of coverage, as the terminal report words them. */
export function coverageRows(report: Report): Array<{ label: string; criteria: string[]; text: string }> {
  const { locale } = report
  const list = (items: readonly string[]) => (items.length === 0 ? '—' : items.join(', '))
  return [
    { label: t(locale, 'coverageEngine', { engine: report.engine.name }), criteria: report.coverage.engine, text: list(report.coverage.engine) },
    { label: t(locale, 'coverageJudged'), criteria: report.coverage.judged, text: list(report.coverage.judged) },
    {
      label: t(locale, 'coverageNotChecked'),
      criteria: report.coverage.notChecked,
      text: t(locale, 'coverageNotCheckedOf', { count: report.coverage.notChecked.length, total: WCAG21_A_AA.length }),
    },
  ]
}

/** One sentence: what was checked, judged and left unchecked on a page, and that it is not a verdict of accessibility. */
export function coverageStatement(report: Report): string {
  const { locale } = report
  const parts = coverageRows(report).map((row) => `${row.label} ${row.text}`)
  return `${parts.join('; ')}. ${t(locale, 'disclaimer')} ${t(locale, 'manualReview')}`
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

/** Escapes text for HTML element content and attribute values. */
export function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}
