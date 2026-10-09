import { relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { adoptionLines, noNewFindings } from '../adoption/render.ts'
import { am } from '../advisory/messages.ts'
import type { Finding, Report } from '../core/types.ts'
import { type Locale, t } from '../i18n.ts'
import { estimateCostUsd, subscriptionOf } from '../providers/models.ts'
import { compareCriteria, criterionLabel, criteriaFor, versionOf } from '../wcag.ts'
import { advisoryLines, cogaCoverage } from './advisory.ts'
import type { Painter } from './color.ts'
import { coverageRows, methodsText, plural, reviewGroups, statusText } from './common.ts'

export interface PrettyOptions {
  verbose: boolean
  paint: Painter
}

export function renderReport(report: Report, options: PrettyOptions): string {
  const { paint: p, verbose } = options
  const locale = report.locale
  const lines: string[] = []

  lines.push(p.bold(displayTarget(report.target)))
  const version = versionOf(report.wcagTarget)
  const meta = [`${t(locale, 'surface')}: ${report.surface}`, t(locale, 'wcagTarget', { version }), `${report.engine.name} ${report.engine.version}`]
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
  // Advisories of a --profile come after the WCAG findings, in a section of their own.
  lines.push(...advisoryLines(report, verbose, p))

  const review = reviewGroups(report)
  if (review.length > 0) {
    lines.push(p.bold(t(locale, 'reviewTitle')), p.dim(t(locale, 'reviewIntro', { engine: report.engine.name })))
    for (const group of review) {
      lines.push(`  ${p.yellow('?')} ${criterionLabel(group.criterion, locale)}: ${plural(locale, 'reviewElements', group.items.length)} · ${group.ruleId}`)
      lines.push(p.dim(`    ${group.reason}`))
      if (verbose) for (const item of group.items.slice(0, 20)) lines.push(p.dim(`    ${item.ref ?? item.target ?? ''}${item.message !== group.reason ? `: ${item.message}` : ''}`))
    }
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
  const rows = coverageRows(report)
  const width = Math.max(...rows.map((row) => row.label.length)) + 2
  for (const row of rows) {
    const text =
      row.key !== 'notChecked'
        ? row.text
        : verbose
          ? list(row.criteria)
          : t(locale, 'coverageNotCheckedCount', { count: row.criteria.length, total: criteriaFor(version).length, version })
    lines.push(`  ${row.label.padEnd(width)}${text}`)
  }
  lines.push(p.dim(`  ${t(locale, version === '2.1' ? 'coverageParsing21' : 'coverageParsing22')}`))
  // The cognitive profile's coverage, after the WCAG lines: what it screened, never a verdict.
  const coga = cogaCoverage(report, verbose)
  if (coga && 'off' in coga) lines.push(p.dim(`  ${coga.off}`))
  else if (coga) lines.push(`  ${coga.title}`, ...coga.lines.map((line) => `    ${line}`))
  if (verbose) lines.push(...criteriaLines(report, p))
  lines.push(p.bold(t(locale, report.surface === 'web' ? 'disclaimer' : report.surface === 'image' ? 'disclaimerImage' : 'disclaimerScreen')))
  lines.push(p.dim(t(locale, 'manualReview')))
  if (report.advisory) lines.push(p.dim(am(locale, 'cogaPeople')))
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
  // A subscription has no per-token price to show; the usage counts against the plan's limits instead.
  const subscription = subscriptionOf(report.model)
  if (subscription) return `${line} · ${t(locale, 'usageSubscription', subscription)}`
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
  if (finding.source === 'engine') {
    // The id is what a waiver names, so engine findings print it too.
    lines.push(p.dim(`    ${t(locale, finding.confidence)} · ${t(locale, 'engineRule')} ${finding.ruleId} · id ${finding.fingerprint}`))
  } else if (finding.source === 'rule') {
    lines.push(p.dim(`    ${t(locale, 'confidence')} ${t(locale, finding.confidence)} · ${t(locale, 'rampaRule')} ${finding.ruleId} · id ${finding.fingerprint}`))
  } else {
    const parts = [`${t(locale, 'confidence')} ${t(locale, finding.confidence)}`]
    if (finding.agreement) parts.push(`${finding.agreement.votes}/${finding.agreement.total} ${t(locale, 'runs')}`)
    parts.push(t(locale, 'verified'))
    parts.push(`id ${finding.fingerprint}`)
    lines.push(p.dim(`    ${parts.join(' · ')}`))
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
  const beyond = beyondTargetNote(report)
  if (beyond) notes.push(beyond)
  return notes
}

/** Findings on WCAG 2.2 criteria in a 2.1 run, counted by criterion; undefined when there are none. */
export function beyondTargetNote(report: Report): string | undefined {
  const beyond = report.beyondTarget ?? []
  if (beyond.length === 0) return undefined
  const counts = new Map<string, number>()
  for (const finding of beyond) counts.set(finding.criterion, (counts.get(finding.criterion) ?? 0) + 1)
  const list = [...counts].sort(([a], [b]) => compareCriteria(a, b)).map(([criterion, count]) => `${criterion} (${count})`)
  return t(report.locale, 'beyondTarget', { count: beyond.length, list: list.join(', ') })
}

/** --verbose: each criterion with its status and the methods behind it, then what stays manual. */
function criteriaLines(report: Report, p: Painter): string[] {
  const records = report.coverage.criteria ?? []
  if (records.length === 0) return []
  const { locale } = report
  const lines = ['', p.bold(`  ${t(locale, 'coverageCriteria')}`)]
  for (const record of records) {
    const status = `${statusText(record.status, locale)}${record.target === 'beyond' ? ` (${t(locale, 'statusBeyond')})` : ''}`
    lines.push(`  ${record.id.padEnd(7)}${status.padEnd(26)} ${methodsText(record, report)}`)
    lines.push(p.dim(`         ${t(locale, 'manualLabel')}: ${record.manual}`))
  }
  return lines
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
