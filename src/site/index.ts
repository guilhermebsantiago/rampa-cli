import type { PageSet, SiteCriteriaReport, SiteCriterion, SiteCriterionSummary, SiteFinding, SitePageFacts } from '../core/site.ts'
import { CONFIDENCE_RANK, type Confidence } from '../core/types.ts'
import { RampaError } from '../core/util.ts'
import { type Locale, t } from '../i18n.ts'
import type { Painter } from '../report/color.ts'
import type { A11ySnapshot } from '../snapshot/schema.ts'
import { DEFAULT_WCAG, type WcagVersion, beyondTarget, compareCriteria } from '../wcag.ts'
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
  /** The run's WCAG target, 2.2 by default: under 2.1, 3.2.6 is beyond it, and its failures are reported apart. */
  wcag?: WcagVersion | undefined
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
  const version = options.wcag ?? DEFAULT_WCAG
  const report: SiteCriteriaReport = { sets, unassigned, criteria, findings: [], belowThreshold: [], review: [], waived: [] }
  const beyond: SiteFinding[] = []
  for (const finding of all) {
    if (options.waivers?.has(finding.fingerprint)) report.waived.push(finding)
    else if (finding.status === 'review') report.review.push(finding)
    // A WCAG 2.2 criterion in a 2.1 run (3.2.6) is reported apart, and never counted.
    else if (beyondTarget(finding.criterion, version)) beyond.push(finding)
    else if (CONFIDENCE_RANK[finding.experimental ? 'low' : finding.confidence] >= threshold) report.findings.push(finding)
    else report.belowThreshold.push(finding)
  }
  if (beyond.length > 0) report.beyondTarget = beyond
  return report
}

/**
 * The config's `pageSets`, checked: a name for each set and a list of path patterns. A single
 * pattern given as a string is read as a list of one.
 */
export function pageSetsOf(value: unknown): Record<string, string[]> | undefined {
  if (value === undefined) return undefined
  const fail = (why: string): never => {
    throw new RampaError('invalid-config', `pageSets in the config ${why}. Write it as { "docs": ["/docs/"], "blog": ["/blog/"] }: a name for each set and path patterns, as --include takes.`)
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail('must be an object')
  const sets: Record<string, string[]> = {}
  for (const [name, patterns] of Object.entries(value as Record<string, unknown>)) {
    const list = typeof patterns === 'string' ? [patterns] : patterns
    if (!Array.isArray(list) || list.length === 0 || !list.every((pattern) => typeof pattern === 'string' && pattern.trim() !== '')) {
      fail(`has no list of path patterns for "${name}"`)
    }
    sets[name] = (list as string[]).map((pattern) => pattern.trim())
  }
  return sets
}

/** The criteria that compared something, to take them off the site's "not checked" list. */
export function siteCriteriaChecked(report: SiteCriteriaReport): string[] {
  return report.criteria.filter((criterion) => criterion.compared > 0).map((criterion) => criterion.criterion)
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
  for (const entry of finding.evidence.split('\n')) lines.push(p.dim(`    ${entry}`))
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
  const beyond = report.beyondTarget ?? []
  if (beyond.length > 0) {
    // As a page's findings beyond the target: said in one line, listed with --verbose, never counted.
    const counts = new Map<string, number>()
    for (const finding of beyond) counts.set(finding.criterion, (counts.get(finding.criterion) ?? 0) + 1)
    const list = [...counts].sort(([a], [b]) => compareCriteria(a, b)).map(([criterion, count]) => `${criterion} (${count})`)
    lines.push(p.dim(t(locale, 'beyondTarget', { count: beyond.length, list: list.join(', ') })))
    if (verbose) for (const finding of beyond) lines.push(...renderFinding(finding, locale, p, p.dim(`◌ ${finding.criterion}`)))
  }
  if (lines[lines.length - 1] !== '') lines.push('')
  return lines
}

/** One line for the coverage block: what the comparison covered, with a criterion beyond the run's target marked so. */
export function siteCriteriaCoverage(report: SiteCriteriaReport | undefined, locale: Locale, version: WcagVersion = DEFAULT_WCAG): { label: string; value: string } | undefined {
  if (!report) return undefined
  const ran = report.criteria.filter((criterion) => criterion.setsCompared > 0)
  const idle = report.criteria.filter((criterion) => criterion.setsCompared === 0).map((criterion) => criterion.criterion)
  const parts = ran.map((criterion) => {
    const text = sm(locale, 'coverageRan', { id: criterion.criterion, sets: criterion.setsCompared, compared: criterion.compared })
    return beyondTarget(criterion.criterion, version) ? `${text} (${t(locale, 'statusBeyond')})` : text
  })
  if (idle.length > 0) parts.push(sm(locale, 'coverageNothing', { ids: idle.join(', ') }))
  return { label: sm(locale, 'coverageLabel'), value: parts.join('; ') }
}
