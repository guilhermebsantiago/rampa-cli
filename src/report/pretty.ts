import { relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Finding, Report } from '../core/types.ts'
import { type Locale, t } from '../i18n.ts'
import { WCAG21_A_AA, compareCriteria, criterionLabel } from '../wcag.ts'
import type { Painter } from './color.ts'

export interface PrettyOptions {
  verbose: boolean
  paint: Painter
}

export function renderReport(report: Report, options: PrettyOptions): string {
  const { paint: p, verbose } = options
  const locale = report.locale
  const lines: string[] = []

  lines.push(p.bold(displayTarget(report.target)))
  const meta = [`${t(locale, 'surface')}: ${report.surface}`, `${report.engine.name} ${report.engine.version}`]
  if (report.model) meta.push(`${t(locale, 'model')}: ${report.model}`)
  lines.push(p.dim(meta.join(' · ')))
  lines.push('')

  const findings = verbose ? [...report.findings, ...report.belowThreshold] : report.findings
  if (findings.length === 0) {
    lines.push(p.green(t(locale, 'noFindings')))
    lines.push('')
  }

  const byCriterion = new Map<string, Finding[]>()
  for (const finding of findings) {
    const list = byCriterion.get(finding.criterion) ?? []
    list.push(finding)
    byCriterion.set(finding.criterion, list)
  }
  for (const criterion of [...byCriterion.keys()].sort(compareCriteria)) {
    lines.push(p.bold(criterionLabel(criterion, locale)))
    for (const finding of byCriterion.get(criterion) ?? []) lines.push(...renderFinding(finding, locale, p))
    lines.push('')
  }

  const notes = notesOf(report, verbose)
  if (notes.length > 0) {
    for (const note of notes) lines.push(p.yellow(note))
    lines.push('')
  }

  if (verbose && report.discarded.length > 0) {
    lines.push(p.bold(t(locale, 'discardedTitle')))
    for (const item of report.discarded) {
      lines.push(`  ${p.gray(item.ref)}  ${item.reason}`)
      const claim = (item.output ?? {}) as Record<string, unknown>
      const parts = [claim.verdict, claim.detectedLanguage && `${t(locale, 'detected')} ${claim.detectedLanguage}`, claim.problem !== 'none' && claim.problem]
        .filter((part): part is string => typeof part === 'string' && part !== '')
      if (typeof claim.evidence === 'string') parts.push(`"${claim.evidence.length > 70 ? `${claim.evidence.slice(0, 69)}…` : claim.evidence}"`)
      if (parts.length > 0) lines.push(p.dim(`    ${t(locale, 'modelSaid')}: ${parts.join(' · ')}`))
    }
    lines.push('')
  }

  lines.push(p.bold(t(locale, 'coverageTitle')))
  const labels = [t(locale, 'coverageEngine', { engine: report.engine.name }), t(locale, 'coverageJudged'), t(locale, 'coverageNotChecked')]
  const width = Math.max(...labels.map((label) => label.length)) + 2
  const pad = (label: string) => label.padEnd(width)
  lines.push(`  ${pad(t(locale, 'coverageEngine', { engine: report.engine.name }))}${list(report.coverage.engine)}`)
  lines.push(`  ${pad(t(locale, 'coverageJudged'))}${list(report.coverage.judged)}`)
  const notCheckedText = verbose
    ? list(report.coverage.notChecked)
    : t(locale, 'coverageNotCheckedCount', { count: report.coverage.notChecked.length, total: WCAG21_A_AA.length })
  lines.push(`  ${pad(t(locale, 'coverageNotChecked'))}${notCheckedText}`)
  lines.push(p.bold(t(locale, 'disclaimer')))
  lines.push(p.dim(t(locale, 'manualReview')))
  return lines.join('\n')
}

function renderFinding(finding: Finding, locale: Locale, p: Painter): string[] {
  const lines: string[] = []
  lines.push(`  ${p.redBold('✗')} ${finding.ref ?? finding.target ?? ''}`)
  lines.push(`    ${finding.message}`)
  if (finding.evidence) lines.push(`    ${t(locale, 'evidence')}: "${finding.evidence}"`)
  if (finding.patch?.before && finding.patch.after) {
    lines.push(`    ${t(locale, 'patch')}:`)
    lines.push(`      ${p.red(`- ${finding.patch.before}`)}`)
    lines.push(`      ${p.green(`+ ${finding.patch.after}`)}`)
  }
  if (finding.source === 'engine') {
    lines.push(p.dim(`    ${finding.confidence === 'high' ? t(locale, 'high') : finding.confidence} · ${t(locale, 'engineRule')} ${finding.ruleId}`))
  } else {
    const parts = [`${t(locale, 'confidence')} ${t(locale, finding.confidence)}`]
    if (finding.agreement) parts.push(`${finding.agreement.votes}/${finding.agreement.total} ${t(locale, 'runs')}`)
    parts.push(t(locale, 'verified'))
    parts.push(`id ${finding.fingerprint}`)
    lines.push(p.dim(`    ${parts.join(' · ')}`))
  }
  return lines
}

function notesOf(report: Report, verbose: boolean): string[] {
  const locale = report.locale
  const notes: string[] = []
  const sum = (key: 'discarded' | 'cannotTell' | 'offlineMisses' | 'errors' | 'candidates') =>
    report.criteria.reduce((total, c) => total + c[key], 0)
  if (report.llm === 'off') {
    const candidates = sum('candidates')
    if (candidates > 0) {
      notes.push(t(locale, 'judgmentSkipped', { count: candidates, criteria: report.criteria.map((c) => c.criterion).join(', ') }))
    }
  }
  if (report.llm === 'no-model') notes.push(t(locale, 'noModel'))
  if (sum('discarded') > 0) notes.push(t(locale, 'discarded', { count: sum('discarded') }))
  if (sum('cannotTell') > 0) notes.push(t(locale, 'cannotTell', { count: sum('cannotTell') }))
  if (sum('offlineMisses') > 0) notes.push(t(locale, 'offlineMisses', { count: sum('offlineMisses') }))
  if (sum('errors') > 0) notes.push(t(locale, 'judgmentErrors', { count: sum('errors'), error: report.errors[0] ?? '' }))
  if (!verbose && report.belowThreshold.length > 0) notes.push(t(locale, 'belowThreshold', { count: report.belowThreshold.length }))
  return notes
}

/** Local files show relative to the working directory, never as an absolute path. */
export function displayTarget(target: string): string {
  if (!target.startsWith('file://')) return target
  try {
    const path = relative(process.cwd(), fileURLToPath(target))
    return path.startsWith('..') ? target : path.split(sep).join('/')
  } catch {
    return target
  }
}

function list(items: readonly string[]): string {
  return items.length === 0 ? '—' : items.join(', ')
}
