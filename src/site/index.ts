import type { PageSet, SiteCriteriaReport, SiteCriterion, SiteCriterionSummary, SiteFinding, SitePageFacts } from '../core/site.ts'
import { CONFIDENCE_RANK, type Confidence } from '../core/types.ts'
import type { Locale } from '../i18n.ts'
import type { Painter } from '../report/color.ts'
import type { A11ySnapshot } from '../snapshot/schema.ts'
import { compareCriteria } from '../wcag.ts'
import { consistentHelp } from './consistent-help.ts'
import { consistentNavigation } from './consistent-navigation.ts'
import { listPages, pathOf, sm } from './messages.ts'
import { type TemplateFacts, templateFacts } from './page.ts'
import { proposeSets } from './sets.ts'

// biome-ignore lint/suspicious/noExplicitAny: registry of criteria with different facts
export const SITE_CRITERIA: ReadonlyArray<SiteCriterion<any>> = [consistentNavigation, consistentHelp]

/** What the site criteria keep of one page: small, so a crawl of many pages holds no snapshot. */
export interface SitePageRecord {
  url: string
  template: TemplateFacts
  /** Each site criterion's facts, by criterion id. */
  facts: Record<string, unknown>
}

/** Read right after a page is collected. */
export function siteFactsOf(snapshot: A11ySnapshot, url = snapshot.target): SitePageRecord {
  const page = { ...snapshot, target: url }
  return {
    url,
    template: templateFacts(page),
    facts: Object.fromEntries(SITE_CRITERIA.map((criterion) => [criterion.id, criterion.facts(page)])),
  }
}

export interface SiteCriteriaOptions {
  origin: string
  locale: Locale
  minConfidence: Confidence
  waivers?: ReadonlySet<string> | undefined
  /** Sets named in the config: a name and path patterns in robots.txt syntax, as --include. */
  pageSets?: Readonly<Record<string, readonly string[]>> | undefined
}

/**
 * Proposes the sets, runs every site criterion on each set of two or more pages,
 * and sorts the results: failures by confidence against the threshold
 * (experimental checks always fall below it), needs review apart.
 */
export function runSiteCriteria(pages: readonly SitePageRecord[], options: SiteCriteriaOptions): SiteCriteriaReport {
  const { sets, unassigned } = proposeSets(pages, options.pageSets, options.origin)
  const byUrl = new Map(pages.map((page) => [page.url, page]))
  const all: SiteFinding[] = []
  const criteria: SiteCriterionSummary[] = []
  for (const criterion of SITE_CRITERIA) {
    const summary: SiteCriterionSummary = {
      criterion: criterion.id,
      level: criterion.level,
      version: criterion.version,
      maturity: criterion.maturity,
      setsCompared: 0,
      compared: 0,
      findings: 0,
      review: 0,
    }
    for (const set of sets) {
      const members: Array<SitePageFacts<unknown>> = set.pages.flatMap((url) => {
        const page = byUrl.get(url)
        return page ? [{ url, facts: page.facts[criterion.id] }] : []
      })
      if (members.length < 2) continue
      summary.setsCompared++
      const result = criterion.compare(set, members, options.locale)
      summary.compared += result.compared
      for (const finding of result.findings) {
        if (finding.status === 'review') summary.review++
        else summary.findings++
        all.push(finding)
      }
    }
    criteria.push(summary)
  }

  all.sort((a, b) => compareCriteria(a.criterion, b.criterion) || a.set.localeCompare(b.set) || a.subject.localeCompare(b.subject))
  const threshold = CONFIDENCE_RANK[options.minConfidence]
  const report: SiteCriteriaReport = { sets, unassigned, criteria, findings: [], belowThreshold: [], review: [], waived: [] }
  for (const finding of all) {
    if (options.waivers?.has(finding.fingerprint)) report.waived.push(finding)
    else if (finding.status === 'review') report.review.push(finding)
    else if (CONFIDENCE_RANK[finding.experimental ? 'low' : finding.confidence] >= threshold) report.findings.push(finding)
    else report.belowThreshold.push(finding)
  }
  return report
}

/** The criteria that compared something, to take them off the site's "not checked" list. */
export function siteCriteriaChecked(report: SiteCriteriaReport): string[] {
  return report.criteria.filter((criterion) => criterion.setsCompared > 0).map((criterion) => criterion.criterion)
}

/** The note a single-page web report carries instead: these criteria need several pages. */
export function singlePageNote(locale: Locale): string {
  return sm(locale, 'singlePage')
}

function criterionTitle(id: string, locale: Locale): string {
  const criterion = SITE_CRITERIA.find((entry) => entry.id === id)
  return criterion ? `WCAG ${id} (${criterion.level}) — ${criterion.name[locale] ?? criterion.name.en}` : `WCAG ${id}`
}

function setLabel(set: PageSet, locale: Locale): string {
  const label = set.source === 'config' ? sm(locale, 'setConfig', { label: set.label }) : sm(locale, 'setTemplate', { n: set.id.replace(/^template-/, '') })
  return sm(locale, 'setLine', {
    label,
    count: set.pages.length,
    lang: set.lang ? `, ${set.lang}` : '',
    viewport: set.viewport,
    pages: listPages(set.pages, locale),
  })
}

function renderFinding(finding: SiteFinding, locale: Locale, p: Painter, mark: string): string[] {
  const lines = [`  ${mark} ${finding.subject}${finding.experimental ? p.dim(` · ${sm(locale, 'experimental')}`) : ''}`]
  lines.push(`    ${finding.message}`)
  for (const entry of finding.evidence.split(' · ')) lines.push(p.dim(`    ${entry}`))
  const byPage = new Map<string, string[]>()
  for (const element of finding.elements) byPage.set(element.page, [...(byPage.get(element.page) ?? []), element.ref])
  for (const [page, refs] of [...byPage.entries()].slice(0, 3)) {
    lines.push(p.gray(`    ${sm(locale, 'elementsOn', { page: pathOf(page), refs: [...new Set(refs)].slice(0, 4).join(' · ') })}`))
  }
  lines.push(p.gray(`    id ${finding.fingerprint}`))
  return lines
}

/** The site report's section for the criteria across pages: the sets, then failures and needs review by criterion. */
export function renderSiteCriteria(report: SiteCriteriaReport | undefined, locale: Locale, options: { paint: Painter; verbose: boolean }): string[] {
  // No page was checked: the site report already says so.
  if (!report || (report.sets.length === 0 && report.unassigned.length === 0)) return []
  const { paint: p, verbose } = options
  const lines: string[] = [p.bold(sm(locale, 'sectionTitle')), p.dim(sm(locale, 'sectionLine'))]
  const compared = report.sets.filter((set) => set.pages.length >= 2)
  if (compared.length === 0) lines.push(p.dim(sm(locale, 'noSet')))
  for (const set of compared) lines.push(p.dim(`  ${setLabel(set, locale)}`))
  const noNav = report.unassigned.filter((entry) => entry.reason === 'no-navigation').map((entry) => entry.url)
  const alone = report.unassigned.filter((entry) => entry.reason === 'alone').map((entry) => entry.url)
  if (noNav.length > 0) lines.push(p.dim(`  ${sm(locale, 'unassignedNoNav', { pages: listPages(noNav, locale) })}`))
  if (alone.length > 0) lines.push(p.dim(`  ${sm(locale, 'unassignedAlone', { pages: listPages(alone, locale) })}`))
  lines.push('')

  const shown = verbose ? [...report.findings, ...report.belowThreshold] : report.findings
  for (const id of [...new Set(shown.map((finding) => finding.criterion))].sort(compareCriteria)) {
    lines.push(p.bold(criterionTitle(id, locale)))
    for (const finding of shown.filter((entry) => entry.criterion === id)) lines.push(...renderFinding(finding, locale, p, p.redBold('✗')))
    lines.push('')
  }
  if (report.review.length > 0) {
    if (verbose) {
      lines.push(p.bold(sm(locale, 'review')))
      for (const finding of report.review) lines.push(...renderFinding(finding, locale, p, p.yellow(`? ${finding.criterion}`)))
      lines.push('')
    } else lines.push(p.yellow(sm(locale, 'reviewHidden2', { count: report.review.length })))
  }
  if (!verbose && report.belowThreshold.length > 0) lines.push(p.yellow(sm(locale, 'belowThreshold', { count: report.belowThreshold.length })))
  if (lines[lines.length - 1] !== '') lines.push('')
  return lines
}

/** One line for the coverage block: what the comparison covered. */
export function siteCriteriaCoverage(report: SiteCriteriaReport | undefined, locale: Locale): { label: string; value: string } | undefined {
  if (!report) return undefined
  const ran = report.criteria.filter((criterion) => criterion.setsCompared > 0)
  const idle = report.criteria.filter((criterion) => criterion.setsCompared === 0).map((criterion) => criterion.criterion)
  const parts = ran.map((criterion) => sm(locale, 'coverageRan', { id: criterion.criterion, sets: criterion.setsCompared, compared: criterion.compared }))
  if (idle.length > 0) parts.push(sm(locale, 'coverageNothing', { ids: idle.join(', ') }))
  return { label: sm(locale, 'coverageLabel'), value: parts.join('; ') }
}
