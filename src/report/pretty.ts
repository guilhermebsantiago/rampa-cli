import { relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { adoptionLines, noNewFindings } from '../adoption/render.ts'
import type { Finding, Report } from '../core/types.ts'
import { type Locale, t } from '../i18n.ts'
import { estimateCostUsd } from '../providers/models.ts'
import { probeCriterionName } from '../rules/probes.ts'
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
    lines.push(p.green(noNewFindings(report) ?? t(locale, 'noFindings')))
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

  if (report.needsReview && report.needsReview.length > 0) {
    lines.push(p.bold(t(locale, 'needsReviewTitle')))
    for (const item of report.needsReview) lines.push(...renderReview(item, locale, p))
    lines.push('')
  }

  const notes = notesOf(report, verbose)
  if (notes.length > 0) {
    for (const note of notes) lines.push(p.yellow(note))
    lines.push('')
  }
  const adoption = adoptionLines(report, verbose, p)
  if (adoption.length > 0) lines.push(...adoption, '')

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

  const usage = usageLine(report)
  if (usage) lines.push(p.dim(usage), '')

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
  for (const line of probeCoverageLines(report)) lines.push(`  ${line}`)
  lines.push(p.bold(t(locale, report.surface === 'web' ? 'disclaimer' : report.surface === 'image' ? 'disclaimerImage' : 'disclaimerScreen')))
  lines.push(p.dim(t(locale, 'manualReview')))
  return lines.join('\n')
}

/** What the judgment took: model calls, tokens and the estimated price, counting cached results at what they cost. */
export function usageLine(report: Report): string | undefined {
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
  const cost = estimateCostUsd(report.model, usage.inputTokens, usage.outputTokens)
  if (cost === undefined) return line
  if (cost === 0) return `${line} · ${t(locale, 'usageLocal')}`
  return `${line} · ${cost < 0.0001 ? `< US$ ${decimal(0.0001, 4)}` : `≈ US$ ${decimal(cost, 4)}`}`
}

export function renderFinding(finding: Finding, locale: Locale, p: Painter): string[] {
  const lines: string[] = []
  lines.push(`  ${p.redBold('✗')} ${finding.ref ?? finding.target ?? ''}`)
  lines.push(`    ${finding.message}`)
  if (finding.evidence) lines.push(`    ${t(locale, 'evidence')}: "${finding.evidence}"`)
  if (finding.patch?.before && finding.patch.after) {
    lines.push(`    ${t(locale, 'patch')}:`)
    lines.push(`      ${p.red(`- ${finding.patch.before}`)}`)
    lines.push(`      ${p.green(`+ ${finding.patch.after}`)}`)
  }
  // A screenshot has no tree: the element was placed by a model, and the reader should know.
  if (finding.locatedBy) lines.push(p.dim(`    ${t(locale, 'locatedBy', { model: finding.locatedBy })}${finding.html ? ` · ${finding.html}` : ''}`))
  if (finding.source === 'probe') {
    const parts = [`${t(locale, 'confidence')} ${t(locale, finding.confidence)}`, t(locale, 'experimental'), `${t(locale, 'probeRule')} ${finding.ruleId}`]
    if (finding.beyondTarget) parts.push(t(locale, 'beyondTarget'))
    parts.push(`id ${finding.fingerprint}`)
    lines.push(p.dim(`    ${parts.join(' · ')}`))
  } else if (finding.source === 'engine') {
    // The id is what a waiver names, so engine findings print it too.
    lines.push(p.dim(`    ${t(locale, finding.confidence)} · ${t(locale, 'engineRule')} ${finding.ruleId} · id ${finding.fingerprint}`))
  } else {
    const parts = [`${t(locale, 'confidence')} ${t(locale, finding.confidence)}`]
    if (finding.agreement) parts.push(`${finding.agreement.votes}/${finding.agreement.total} ${t(locale, 'runs')}`)
    parts.push(t(locale, 'verified'))
    parts.push(`id ${finding.fingerprint}`)
    lines.push(p.dim(`    ${parts.join(' · ')}`))
  }
  return lines
}

function renderReview(finding: Finding, locale: Locale, p: Painter): string[] {
  const label = probeCriterionName(finding.criterion, locale)
  const lines = [`  ${p.yellow('?')} ${finding.criterion}${label ? ` ${label}` : ''} · ${finding.ref ?? finding.target ?? ''}`, `    ${finding.message}`]
  if (finding.evidence) lines.push(`    ${t(locale, 'evidence')}: ${finding.evidence}`)
  lines.push(p.dim(`    ${t(locale, finding.confidence)} · ${t(locale, 'probeRule')} ${finding.ruleId} · id ${finding.fingerprint}`))
  return lines
}

/** One line per criterion a probe rule checked: the method, its conditions and what it found. */
export function probeCoverageLines(report: Report): string[] {
  const { locale } = report
  const rows = report.coverage.probes ?? []
  if (rows.length === 0) return []
  const lines = [t(locale, 'coverageProbed')]
  for (const row of [...rows].sort((a, b) => compareCriteria(a.criterion, b.criterion))) {
    const status =
      row.status === 'failures'
        ? t(locale, 'probeStatusFailures', { count: row.failures })
        : row.status === 'needs-review'
          ? t(locale, 'probeStatusReview', { count: row.review })
          : row.status === 'no-failure-found'
            ? t(locale, 'probeStatusClean')
            : t(locale, 'probeStatusNotChecked')
    // Experimental failures sit below the threshold: the line says so, next to "No confirmed failures".
    const listed = [...report.findings, ...(report.baseline?.known ?? [])]
    const hidden = row.failures > 0 && !listed.some((f) => f.source === 'probe' && f.criterion === row.criterion && f.ruleId === row.rule && !report.belowThreshold.includes(f))
    const extra = [
      hidden ? t(locale, 'probeBelowThreshold') : undefined,
      row.status !== 'not-checked' ? t(locale, 'probeApplicable', { count: row.applicable }) : undefined,
      row.failures > 0 && row.review > 0 ? t(locale, 'probeStatusReview', { count: row.review }) : undefined,
      row.unmatched > 0 ? t(locale, 'probeUnmatched', { count: row.unmatched }) : undefined,
      row.beyondTarget ? t(locale, 'beyondTarget') : undefined,
      row.note,
    ].filter(Boolean)
    lines.push(`  ${row.criterion.padEnd(7)} ${row.method} (${row.rule}) · ${row.conditions}: ${status}${extra.length > 0 ? ` · ${extra.join(' · ')}` : ''}`)
  }
  return lines
}

export function notesOf(report: Report, verbose: boolean): string[] {
  const locale = report.locale
  // What the collector could not see comes first: it frames everything below it.
  const notes: string[] = [...(report.notes ?? [])]
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
