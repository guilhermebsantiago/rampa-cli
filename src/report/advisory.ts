import { COGA_PATTERNS, cogaPattern, patternTitle } from '../advisory/coga.ts'
import { impactName } from '../advisory/label.ts'
import { am, amPlural } from '../advisory/messages.ts'
import { COGNITIVE_CHECKS } from '../advisory/profile.ts'
import type { Advisory, AdvisorySection, TextMeasurement } from '../advisory/types.ts'
import type { Report } from '../core/types.ts'
import { type Locale, languageName, t } from '../i18n.ts'
import { MARTINS_RANGES } from '../text/formulas.ts'
import type { Painter } from './color.ts'
import { escapeHtml as e, pageLabel, safeUrl } from './common.ts'

/**
 * How advisories show in each report: a section of their own after the WCAG findings, grouped by check
 * and ordered by impact, with the fixed label on every group, and never the ✗ of a failure (◇ instead).
 * Then the text measurements, as context, and the profile's lines in the coverage.
 */

/** Elements listed per check, and advisories per page, before the rest are counted (--verbose lists them all). */
const PER_GROUP = 3
const PER_PAGE = 20

interface Group {
  label: string
  impact: Advisory['impact']
  advisories: Advisory[]
}

/** Advisories of one kind, grouped by label and impact, in the order the profile sorted them. */
function groupsOf(advisories: readonly Advisory[]): Group[] {
  const groups = new Map<string, Group>()
  for (const advisory of advisories) {
    const key = `${advisory.label}|${advisory.impact}`
    const group = groups.get(key) ?? { label: advisory.label, impact: advisory.impact, advisories: [] }
    group.advisories.push(advisory)
    groups.set(key, group)
  }
  return [...groups.values()]
}

/** What a page's advisory section shows: confirmed ones, plus those below the threshold with --verbose. */
export function shownAdvisories(section: AdvisorySection, verbose: boolean): Advisory[] {
  return verbose ? [...section.results, ...section.belowThreshold] : section.results
}

/** "CPF ×4, CEP ×2, RG": the abbreviations reported beyond the target, as one line. */
function beyondList(beyond: readonly Advisory[]): string {
  return beyond
    .map((advisory) => {
      const count = Number(advisory.facts?.occurrences ?? 1)
      return count > 1 ? `${advisory.subject ?? ''} ×${count}` : (advisory.subject ?? '')
    })
    .join(', ')
}

function number(value: number, locale: Locale): string {
  return new Intl.NumberFormat(locale).format(value)
}

function sourceText(advisory: Advisory, locale: Locale): string {
  return am(locale, advisory.source === 'judgment' ? 'sourceJudgment' : 'sourceRule')
}

function metaParts(advisory: Advisory, locale: Locale): string[] {
  const parts = [`${t(locale, 'confidence')} ${t(locale, advisory.confidence)}`, sourceText(advisory, locale), `id ${advisory.fingerprint}`]
  for (const related of advisory.related ?? []) {
    if ('finding' in related) parts.push(am(locale, 'related', { criterion: related.criterion, id: related.finding }))
  }
  return parts
}

// Terminal

export function advisoryLines(report: Report, verbose: boolean, p: Painter): string[] {
  const section = report.advisory
  if (!section) return []
  const locale = report.locale
  const lines: string[] = [p.bold(am(locale, 'sectionTitle'))]
  const shown = shownAdvisories(section, verbose)
  const advisories = shown.filter((advisory) => advisory.kind === 'advisory')
  const beyond = shown.filter((advisory) => advisory.kind === 'beyond-target')
  if (advisories.length > 0) lines.push(p.dim(`  ${am(locale, 'impactLegend')}`))
  else if (beyond.length === 0) lines.push(`  ${am(locale, 'noAdvisories')}`)
  let listed = 0
  for (const group of groupsOf(advisories)) {
    lines.push(`  ${p.cyanBold('◇')} ${p.bold(group.label)} · ${impactName(group.impact, locale)}`)
    const room = verbose ? group.advisories.length : Math.max(0, Math.min(PER_GROUP, PER_PAGE - listed))
    for (const advisory of group.advisories.slice(0, room)) {
      listed++
      lines.push(`    ${p.gray(advisory.ref ?? '')}`)
      lines.push(`    ${advisory.message}`)
      if (advisory.evidence) lines.push(`    ${t(locale, 'evidence')}: ${advisory.evidence}`)
      if (advisory.patch?.before && advisory.patch.after) {
        lines.push(`    ${t(locale, 'patch')}:`)
        lines.push(`      ${p.red(`- ${advisory.patch.before}`)}`)
        lines.push(`      ${p.green(`+ ${advisory.patch.after}`)}`)
      }
      lines.push(p.dim(`    ${metaParts(advisory, locale).join(' · ')}`))
    }
    if (group.advisories.length > room) lines.push(p.dim(`    ${am(locale, 'moreAdvisories', { count: group.advisories.length - room })}`))
  }
  if (beyond.length > 0) {
    lines.push('', p.bold(am(locale, 'beyondTitle')))
    lines.push(`  ${p.cyanBold('◇')} ${amPlural(locale, 'beyondAbbrLine', beyond.length, { list: beyondList(beyond) })}`)
  }
  for (const note of section.notes) lines.push(p.yellow(`  ${note}`))
  lines.push('')
  for (const measurement of section.textMetrics?.measurements ?? []) lines.push(...metricsLines(measurement, locale, p), '')
  return lines
}

/** A crawl's view: advisories counted per page, apart from the findings; the JSON report has them all. */
export function siteAdvisoryLines(pages: readonly Report[], path: (url: string) => string, p: Painter): string[] {
  const withProfile = pages.filter((report) => report.advisory)
  const first = withProfile[0]
  if (!first) return []
  const locale = first.locale
  const lines = [p.bold(am(locale, 'sectionTitle'))]
  const counted = withProfile.filter((report) => (report.advisory?.results.length ?? 0) > 0)
  if (counted.length === 0) lines.push(`  ${am(locale, 'noAdvisories')}`)
  for (const report of counted) lines.push(`  ${p.cyanBold('◇')} ${path(report.target)}  ${amPlural(locale, 'advisoryCount', report.advisory?.results.length ?? 0)}`)
  if (counted.length > 0) lines.push(p.dim(`  ${am(locale, 'siteAdvisories')}`))
  lines.push('')
  return lines
}

export function metricsText(measurement: TextMeasurement, locale: Locale): { title: string; lines: string[] } {
  const title = am(locale, 'metricsTitle', {
    scope: am(locale, measurement.scope === 'main' ? 'scopeMain' : 'scopePage'),
    language: languageName(measurement.language, locale),
  })
  const count = (key: 'countWords' | 'countSentences' | 'countParagraphs', value: number) => amPlural(locale, key, value, { count: number(value, locale) })
  const lines = [
    `${am(locale, 'metricsCounts', {
      words: count('countWords', measurement.words),
      sentences: count('countSentences', measurement.sentences),
      paragraphs: count('countParagraphs', measurement.paragraphs),
      median: measurement.sentenceWords.median,
      max: measurement.sentenceWords.max,
    })}.`,
  ]
  const longest = measurement.longestSentences[0]
  if (longest) lines.push(am(locale, 'metricsLongest', { text: longest.text }))
  if (measurement.listsAsProse.length > 0) lines.push(`${amPlural(locale, 'metricsLists', measurement.listsAsProse.length)}.`)
  if (measurement.english) {
    const english = measurement.english
    lines.push(
      `${am(locale, 'metricsEnglish', { paragraphs: count('countParagraphs', english.paragraphsOver50Words), sentences: count('countSentences', english.sentencesOver25Words) })}.`,
    )
  }
  const formula = measurement.formula
  if (formula?.id === 'flesch-pt-martins-1996' && formula.band) {
    lines.push(am(locale, 'metricsFleschPt', { value: number(formula.value, locale), band: am(locale, `band_${formula.band}`), range: MARTINS_RANGES[formula.band] }))
    lines.push(am(locale, 'metricsMartinsCaveat'))
  } else if (formula?.id === 'flesch-kincaid-en') {
    lines.push(am(locale, 'metricsFleschEn', { value: number(formula.value, locale), grade: number(formula.grade ?? 0, locale) }))
    lines.push(am(locale, 'metricsHeuristic'))
  } else if (measurement.formulaSkipped === 'under-100-words') lines.push(am(locale, 'metricsUnder100'))
  else if (measurement.formulaSkipped === 'no-formula-for-language') lines.push(am(locale, 'metricsNoFormula'))
  if (formula) lines.push(am(locale, 'metricsCaveat'))
  return { title, lines }
}

function metricsLines(measurement: TextMeasurement, locale: Locale, p: Painter): string[] {
  const { title, lines } = metricsText(measurement, locale)
  return [p.bold(title), ...lines.map((line) => `  ${line}`)]
}

// Coverage

/** The checks that ran, in the order of their patterns (o3p01 before o4p03). */
function screenedChecks(section: AdvisorySection) {
  return COGNITIVE_CHECKS.filter((check) => section.checks.some((summary) => summary.check === check.id && summary.ran)).sort((a, b) => a.pattern.localeCompare(b.pattern))
}

/** The screened patterns, each with the part of it the profile looks at. */
function screenedList(section: AdvisorySection, locale: Locale): string[] {
  return screenedChecks(section).map(
    (check) => `${check.pattern} ${patternTitle(check.pattern, locale)} (${am(locale, `part_${check.pattern as 'o3p01' | 'o4p03' | 'o4p06' | 'o4p08'}`)})`,
  )
}

/** The profile's lines of the coverage block: what was screened in part, what did not run, what was not checked. */
export function cogaCoverage(report: Report, verbose: boolean): { title: string; lines: string[] } | { off: string } | undefined {
  const locale = report.locale
  const section = report.advisory
  if (!section) return report.surface === 'web' ? { off: am(locale, 'cogaOff') } : undefined
  const screened = screenedList(section, locale)
  const lines = [am(locale, 'cogaScreened', { count: screened.length, total: COGA_PATTERNS.length, list: screened.join(', ') || '—' })]
  const notRun = section.checks
    .filter((summary) => !summary.ran)
    .map((summary) => {
      const check = COGNITIVE_CHECKS.find((candidate) => candidate.id === summary.check)
      return check ? `${check.pattern} ${patternTitle(check.pattern, locale)} (${summary.reason ?? '—'})` : summary.check
    })
  if (notRun.length > 0) lines.push(am(locale, 'cogaNotRun', { list: notRun.join('; ') }))
  const notChecked = Object.entries(section.coverage.patterns).filter(([, status]) => status !== 'screened')
  lines.push(
    verbose
      ? am(locale, 'cogaNotCheckedList', { list: notChecked.map(([slug]) => `${slug.slice(0, 5)} ${patternTitle(slug.slice(0, 5), locale)}`).join(', ') })
      : am(locale, 'cogaNotChecked', { count: notChecked.length }),
  )
  if (section.coverage.beyondTarget.length > 0) lines.push(am(locale, 'cogaBeyond'))
  return { title: am(locale, 'cogaCoverageTitle'), lines }
}

/** One clause for the coverage sentence of the Markdown, HTML and SARIF reports. */
export function cogaClause(report: Report): string | undefined {
  const coverage = cogaCoverage(report, false)
  if (!coverage) return undefined
  if ('off' in coverage) return coverage.off.replace(/\.$/, '')
  const section = report.advisory as AdvisorySection
  const screened = screenedChecks(section).map((check) => check.pattern)
  return am(report.locale, 'cogaStatement', { count: screened.length, total: COGA_PATTERNS.length, list: screened.join(', ') || '—' })
}

// Markdown

export interface MarkdownPieces {
  prose: (text: string) => string
  code: (text: string) => string
}

function fenced(body: string, language: string): string[] {
  const longest = Math.max(0, ...(body.match(/`+/g) ?? []).map((run) => run.length))
  const fence = '`'.repeat(Math.max(3, longest + 1))
  return [`${fence}${language}`, body, fence]
}

/**
 * A collapsed section after the findings, counted apart from them. It is built last and gets what the size
 * limit leaves, so advisories are what a long comment drops first.
 */
export function advisoryMarkdown(reports: readonly Report[], verbose: boolean, budget: number, md: MarkdownPieces): string[] {
  const withProfile = reports.filter((report) => report.advisory)
  if (withProfile.length === 0) return []
  const locale = reports[0]?.locale ?? 'en'
  const total = withProfile.reduce((sum, report) => sum + shownAdvisories(report.advisory as AdvisorySection, verbose).length, 0)
  const head = ['<details>', `<summary>${am(locale, 'advisoriesSummary', { count: total })}</summary>`, '', `_${am(locale, 'sectionTitle')}. ${am(locale, 'impactLegend')}_`, '']
  const body: string[] = []
  let used = head.join('\n').length + 20
  let omitted = 0
  for (const report of withProfile) {
    const section = report.advisory as AdvisorySection
    const shown = shownAdvisories(section, verbose)
    const blocks: string[] = []
    for (const advisory of shown.filter((item) => item.kind === 'advisory')) {
      const block = advisoryBlock(advisory, locale, md)
      if (used + block.length > budget) {
        omitted++
        continue
      }
      used += block.length
      blocks.push(block)
    }
    const beyond = shown.filter((item) => item.kind === 'beyond-target')
    const context: string[] = []
    if (beyond.length > 0) context.push(`◇ ${md.prose(amPlural(locale, 'beyondAbbrLine', beyond.length, { list: beyondList(beyond) }))} _(${md.prose(am(locale, 'beyondTitle'))})_`, '')
    for (const measurement of section.textMetrics?.measurements ?? []) {
      const { title, lines } = metricsText(measurement, locale)
      context.push(`**${md.prose(title)}**`, '', ...lines.map((line) => `- ${md.prose(line)}`), '')
    }
    // The one-line list and the measurements go in whole or not at all; the JSON and HTML reports have them.
    const contextLength = context.join('\n').length
    if (used + contextLength <= budget) {
      used += contextLength
      blocks.push(...context)
    }
    if (blocks.length === 0) continue
    if (withProfile.length > 1) body.push(`#### ${md.code(pageLabel(report))}`, '')
    if (shown.length === 0) body.push(md.prose(am(locale, 'noAdvisories')), '')
    body.push(...blocks)
  }
  if (omitted > 0) body.push(`> ${amPlural(locale, 'omittedAdvisories', omitted)}`, '')
  return [...head, ...body, '</details>', '']
}

function advisoryBlock(advisory: Advisory, locale: Locale, md: MarkdownPieces): string {
  const lines: string[] = []
  const url = safeUrl(advisory.basis.url)
  const label = url ? `[${md.prose(advisory.label)}](<${url}>)` : md.prose(advisory.label)
  lines.push(`**${label}** · ${impactName(advisory.impact, locale)}${advisory.ref ? ` — ${md.code(advisory.ref)}` : ''}\\`)
  lines.push(md.prose(advisory.message), '')
  if (advisory.patch?.before && advisory.patch.after && advisory.patch.before !== advisory.patch.after) {
    lines.push(...fenced(`- ${advisory.patch.before}\n+ ${advisory.patch.after}`, 'diff'))
  }
  const meta: string[] = []
  if (advisory.evidence) meta.push(`${t(locale, 'evidence')}: "${md.prose(advisory.evidence)}"`)
  meta.push(...metaParts(advisory, locale).map((part) => (part.startsWith('id ') ? `id ${md.code(advisory.fingerprint)}` : md.prose(part))))
  lines.push(meta.join(' · '), '')
  return lines.join('\n')
}

// HTML

export function advisoryHtml(report: Report, index: number, verbose: boolean): string {
  const section = report.advisory
  if (!section) return ''
  const locale = report.locale
  const id = `advisories-${index + 1}`
  const shown = shownAdvisories(section, verbose)
  const out: string[] = [`<section class="advisories" aria-labelledby="${id}">`, `<h3 id="${id}">${e(am(locale, 'sectionTitle'))}</h3>`]
  const advisories = shown.filter((advisory) => advisory.kind === 'advisory')
  if (advisories.length > 0) out.push(`<p class="notes">${e(am(locale, 'impactLegend'))}</p>`)
  else if (!shown.some((advisory) => advisory.kind === 'beyond-target')) out.push(`<p class="notes">${e(am(locale, 'noAdvisories'))}</p>`)
  for (const group of groupsOf(advisories)) {
    const first = group.advisories[0]
    if (!first) continue
    out.push('<div class="criterion">')
    out.push(`<h4>${e(group.label)} · ${e(impactName(group.impact, locale))}</h4>`)
    if (first.basis.framework === 'coga') {
      const pattern = cogaPattern(first.basis.pattern)
      const page = safeUrl(first.basis.url)
      const note = safeUrl(first.basis.tr)
      const links = [
        page ? `<a href="${e(page)}">${e(am(locale, 'patternLink', { pattern: pattern.id, title: patternTitle(pattern.id, locale) }))}</a>` : '',
        note ? `<a href="${e(note)}">${e(am(locale, 'noteLink'))}</a>` : '',
      ].filter(Boolean)
      out.push(`<p class="understanding">${links.join(' · ')}</p>`)
    }
    out.push(`<ol class="findings">${group.advisories.map((advisory) => advisoryItem(advisory, locale)).join('\n')}</ol>`)
    out.push('</div>')
  }
  const beyond = shown.filter((advisory) => advisory.kind === 'beyond-target')
  if (beyond.length > 0) {
    out.push(`<h4>${e(am(locale, 'beyondTitle'))}</h4>`)
    out.push(`<p>◇ ${e(amPlural(locale, 'beyondAbbrLine', beyond.length, { list: beyondList(beyond) }))}</p>`)
  }
  if (section.notes.length > 0) out.push(`<ul class="notes">${section.notes.map((note) => `<li>${e(note)}</li>`).join('')}</ul>`)
  for (const measurement of section.textMetrics?.measurements ?? []) {
    const { title, lines } = metricsText(measurement, locale)
    out.push(`<h4>${e(title)}</h4>`, `<ul class="notes">${lines.map((line) => `<li>${e(line)}</li>`).join('')}</ul>`)
  }
  out.push('</section>')
  return out.join('\n')
}

function advisoryItem(advisory: Advisory, locale: Locale): string {
  const out: string[] = ['<li class="finding advisory">']
  if (advisory.ref) out.push(`<p class="where"><code>${e(advisory.ref)}</code></p>`)
  out.push(`<p class="message">${e(advisory.message)}</p>`)
  if (advisory.evidence) out.push(`<p>${e(t(locale, 'evidence'))}: <q>${e(advisory.evidence)}</q></p>`)
  if (advisory.patch?.before && advisory.patch.after && advisory.patch.before !== advisory.patch.after) {
    out.push(
      `<div class="patch"><p class="patch-title">${e(t(locale, 'suggestedChange'))} <span class="legend">${e(t(locale, 'diffLegend'))}</span></p><pre class="diff"><code><del>- ${e(advisory.patch.before)}</del><ins>+ ${e(advisory.patch.after)}</ins></code></pre></div>`,
    )
  }
  const meta = metaParts(advisory, locale).map((part) => (part.startsWith('id ') ? `id <code>${e(advisory.fingerprint)}</code>` : e(part)))
  out.push(`<p class="meta">${meta.join(' · ')}</p>`)
  out.push('</li>')
  return out.join('')
}
