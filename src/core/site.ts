import { startTagOf } from '../criteria/shared.ts'
import type { Locale } from '../i18n.ts'
import type { A11ySnapshot } from '../snapshot/schema.ts'
import { indexTree } from '../snapshot/tree.ts'
import type { BrowserConditions } from '../surfaces/browser-options.ts'
import type { CrawlSkip } from '../surfaces/crawl.ts'
import type { Robots } from '../surfaces/robots.ts'
import { type Level, type WcagTarget, compareCriteria, versionOf } from '../wcag.ts'
import { mergeCoverage } from './coverage.ts'
import type { JudgmentCache } from './cache.ts'
import type { Confidence, Finding, Patch, Report, Usage } from './types.ts'
import { normalizeForMatch, sha256 } from './util.ts'

/**
 * Attributes that change from page to page on the same component: the current
 * page in a menu, generated ids and the references to them, open and selected
 * state, styling hooks. They are left out of a finding's signature.
 */
const VOLATILE_ATTRIBUTE =
  /^(?:id|class|style|nonce|data-.*|aria-current|aria-expanded|aria-selected|aria-pressed|aria-checked|for|headers|form|list|aria-labelledby|aria-describedby|aria-controls|aria-owns|aria-activedescendant|aria-details|aria-errormessage)$/i

/** Attributes that hold an address. */
const URL_ATTRIBUTE = new Set(['href', 'src', 'action', 'formaction', 'poster', 'cite', 'data'])

/**
 * The address an attribute points to, the same from any page: `img/logo.png`
 * on /about and `../img/logo.png` on /docs/start are one image. An in-page
 * anchor such as `#main` means the same on every page and stays as it is.
 */
function resolveAddress(value: string, page: string): string {
  if (value === '' || value.startsWith('#')) return value
  try {
    const url = new URL(value, page)
    return url.origin === new URL(page).origin ? `${url.pathname}${url.search}${url.hash}` : url.href
  } catch {
    return value
  }
}

/**
 * A start tag with its attributes sorted and the volatile ones dropped, and its
 * addresses resolved against the page when one is given: `<a href="/">`
 * whatever page it is on.
 */
export function normalizeStartTag(tag: string, page?: string): string {
  const match = /^<([a-zA-Z][\w:-]*)([^>]*)>?/.exec(tag.trim())
  if (!match) return ''
  const attributes: string[] = []
  for (const attribute of (match[2] ?? '').matchAll(/([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    const name = (attribute[1] ?? '').toLowerCase()
    if (name === '' || VOLATILE_ATTRIBUTE.test(name)) continue
    let value = (attribute[2] ?? attribute[3] ?? attribute[4] ?? '').replace(/\s+/g, ' ').trim()
    if (page && URL_ATTRIBUTE.has(name)) value = resolveAddress(value, page)
    attributes.push(`${name}="${value}"`)
  }
  return `<${(match[1] ?? '').toLowerCase()}${attributes
    .sort()
    .map((attribute) => ` ${attribute}`)
    .join('')}>`
}

function textOfHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ')
}

/**
 * What makes two findings on different pages the same problem: the criterion,
 * the rule, the element (start tag without volatile attributes, and its name
 * or text) and the message. A header link flagged on every page has one
 * signature, whatever its CSS path on each page.
 */
export function findingSignatures(findings: readonly Finding[], snapshot: A11ySnapshot): string[] {
  const index = indexTree(snapshot.root)
  return findings.map((finding) => {
    const node = finding.ref ? index.get(finding.ref)?.node : undefined
    const startTag = node ? startTagOf(node) : (/^<[^>]*>/.exec(finding.html ?? '')?.[0] ?? '')
    // The whole document's text would make every page different; a page-level finding is told apart by its message.
    const label = node ? (node.role === 'document' ? '' : (node.name ?? node.text ?? '')) : textOfHtml(finding.html ?? '')
    const parts = [
      finding.criterion,
      finding.source,
      finding.ruleId ?? '',
      normalizeStartTag(startTag, snapshot.target),
      normalizeForMatch(label).slice(0, 300),
      normalizeForMatch(finding.message),
    ]
    return sha256(parts.join('\u0000')).slice(0, 16)
  })
}

/** A judgment cache that also counts the judgments a page took from an earlier page of the same run. */
export interface ReuseCounter extends JudgmentCache {
  /** The page being judged; set before each page, with pages judged one at a time. */
  page: number
  /** Cache hits whose exact input (prompt, image, model, settings) first came up on an earlier page. */
  reused: number
}

export function countReuse(inner: JudgmentCache): ReuseCounter {
  const firstSeen = new Map<string, number>()
  const counter: ReuseCounter = {
    page: 0,
    reused: 0,
    async get(key) {
      const value = await inner.get(key)
      const first = firstSeen.get(key)
      if (first === undefined) firstSeen.set(key, counter.page)
      else if (value && first < counter.page) counter.reused++
      return value
    },
    async set(key, value) {
      if (!firstSeen.has(key)) firstSeen.set(key, counter.page)
      await inner.set(key, value)
    },
  }
  return counter
}

/** One checked page of a site. */
export interface SitePage {
  /** Where the page is, after redirects. */
  url: string
  report: Report
  /** One per finding of `report.findings`, from findingSignatures. */
  signatures: string[]
}

/** A finding that repeats on two or more pages, reported once. */
export interface RepeatedFinding {
  signature: string
  criterion: string
  level: Level | undefined
  source: 'engine' | 'judgment' | 'rule' | 'probe'
  ruleId?: string | undefined
  helpUrl?: string | undefined
  message: string
  evidence?: string | undefined
  patch?: Patch | undefined
  confidence: Confidence
  agreement?: Finding['agreement']
  /** The element on the first page where it was found. */
  ref?: string | undefined
  html?: string | undefined
  /** Pages it is on, in page order. */
  pages: string[]
  /** Each occurrence: an index into the site report's `pages`, and into that page's `findings`. */
  occurrences: Array<{ page: number; finding: number }>
  /** Fingerprints of the occurrences, to waive the finding everywhere. */
  fingerprints: string[]
}

export interface SiteSummary {
  pagesChecked: number
  findings: { total: number; repeated: number; pageSpecific: number }
  /** Findings on two or more pages, each once. */
  repeated: RepeatedFinding[]
  /** Per page, the findings that are not in a repeated group: indexes into that page's `findings`. */
  pageSpecific: Array<{ url: string; findings: number[] }>
  usage: Usage & { reusedAcrossPages: number }
  /** What was covered on at least one page. */
  coverage: Report['coverage']
}

/** Groups repeated findings, adds up the usage and joins the coverage of every page. */
export function summarizeSite(pages: readonly SitePage[], reusedAcrossPages: number): SiteSummary {
  const groups = new Map<string, Array<{ page: number; finding: number }>>()
  pages.forEach((page, pageIndex) => {
    page.report.findings.forEach((_, findingIndex) => {
      const signature = page.signatures[findingIndex] ?? `${pageIndex}:${findingIndex}`
      const list = groups.get(signature) ?? []
      list.push({ page: pageIndex, finding: findingIndex })
      groups.set(signature, list)
    })
  })

  const repeated: RepeatedFinding[] = []
  const inGroup = new Set<string>()
  for (const [signature, occurrences] of groups) {
    const pageIndexes = [...new Set(occurrences.map((occurrence) => occurrence.page))]
    if (pageIndexes.length < 2) continue
    for (const occurrence of occurrences) inGroup.add(`${occurrence.page}:${occurrence.finding}`)
    const first = occurrences[0] as { page: number; finding: number }
    const finding = pages[first.page]?.report.findings[first.finding] as Finding
    repeated.push({
      signature,
      criterion: finding.criterion,
      level: finding.level,
      source: finding.source,
      ruleId: finding.ruleId,
      helpUrl: finding.helpUrl,
      message: finding.message,
      evidence: finding.evidence,
      patch: finding.patch,
      confidence: finding.confidence,
      agreement: finding.agreement,
      ref: finding.ref ?? finding.target,
      html: finding.html,
      pages: pageIndexes.map((index) => pages[index]?.url ?? ''),
      occurrences,
      fingerprints: [...new Set(occurrences.map((o) => pages[o.page]?.report.findings[o.finding]?.fingerprint ?? ''))],
    })
  }
  repeated.sort((a, b) => compareCriteria(a.criterion, b.criterion) || b.pages.length - a.pages.length)

  const pageSpecific = pages.map((page, pageIndex) => ({
    url: page.url,
    findings: page.report.findings.flatMap((_, findingIndex) => (inGroup.has(`${pageIndex}:${findingIndex}`) ? [] : [findingIndex])),
  }))
  const total = pages.reduce((sum, page) => sum + page.report.findings.length, 0)
  const specificCount = pageSpecific.reduce((sum, page) => sum + page.findings.length, 0)

  const usage = { calls: 0, cachedCalls: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0, reusedAcrossPages }
  for (const page of pages) {
    usage.calls += page.report.usage.calls
    usage.cachedCalls += page.report.usage.cachedCalls
    usage.inputTokens += page.report.usage.inputTokens
    usage.outputTokens += page.report.usage.outputTokens
    usage.latencyMs += page.report.usage.latencyMs
  }

  const coverage = mergeCoverage(
    pages.map((page) => page.report),
    versionOf(pages[0]?.report.wcagTarget),
  )
  return {
    pagesChecked: pages.length,
    findings: { total, repeated: total - specificCount, pageSpecific: specificCount },
    repeated,
    pageSpecific,
    usage,
    coverage,
  }
}

/** A crawl's report: the site summary, how the crawl went, and the full report of every page. */
export interface SiteReport {
  schemaVersion: 1
  kind: 'site'
  rampaVersion: string
  createdAt: string
  /** The origin crawled. */
  site: string
  start: Array<{ requested: string; url: string }>
  crawl: {
    mode: 'links' | 'sitemap'
    maxPages: number
    maxDepth?: number | undefined
    concurrency: number
    include: string[]
    exclude: string[]
    ignoreQuery: boolean
    robots: { url: string; status: Robots['status']; group: Robots['group']; crawlDelaySeconds?: number | undefined; detail?: string | undefined }
    /** Sitemap files read, with --sitemap. */
    sitemaps: string[]
    sitemapErrors: Array<{ url: string; detail: string }>
  }
  /** What the browser emulated and carried; header and cookie values are never recorded. */
  browser: BrowserConditions
  /** What every page was checked against. */
  wcagTarget?: WcagTarget | undefined
  locale: Locale
  llm: Report['llm']
  model?: string | undefined
  engine: { name: string; version: string }
  /** Pages found and not checked: robots.txt, HTTP errors, files, redirects off the site, failures. */
  notChecked: CrawlSkip[]
  /** Pages found and allowed that were never loaded: beyond --max-pages or --max-depth. */
  notLoaded: number
  /** Of notLoaded, the ones beyond --max-depth. */
  beyondDepth: number
  summary: SiteSummary
  pages: Report[]
  /** Criteria that compare pages of a set with each other (3.2.3, 3.2.6); see SiteCriterion. */
  siteCriteria?: SiteCriteriaReport | undefined
}

/** The exit code of a crawl, by the same rules as a check, and 2 when a site had no page to check. */
export function siteExitCode(sites: readonly SiteReport[], failOn: string): number {
  if (sites.length === 0 || sites.some((site) => site.pages.length === 0)) return 2
  const reports = sites.flatMap((site) => site.pages)
  if (reports.some((report) => report.criteria.some((c) => c.errors > 0 && c.judged === 0))) return 2
  if (failOn === 'never') return 0
  const failing = reports.some(
    (report) =>
      report.findings.length > 0 ||
      (failOn === 'any' && report.belowThreshold.length > 0) ||
      (failOn === 'advisory' && (report.advisory?.results.length ?? 0) > 0),
  )
  // Findings across pages count like a page's; needs review and findings beyond the target never do.
  const across = sites.some((site) => (site.siteCriteria?.findings.length ?? 0) > 0 || (failOn === 'any' && (site.siteCriteria?.belowThreshold.length ?? 0) > 0))
  return failing || across ? 1 : 0
}

// Criteria over a set of pages (src/site/)

/**
 * Pages a site criterion compares with each other. WCAG leaves "set of web pages" to the
 * author, so Rampa proposes sets from the pages' shared header, navigation and footer links,
 * one per language, and a person can name sets in the config (`pageSets`).
 */
export interface PageSet {
  id: string
  /** The config's name for the set, or a description of the template it was proposed from. */
  label: string
  source: 'config' | 'template'
  /** Primary language subtag of the pages, '' when they declare none. */
  lang: string
  /** Width × height in CSS px: pages are only compared at one viewport. */
  viewport: string
  pages: string[]
}

/** What a site criterion reads from one page: taken from the snapshot right after it is collected, so a crawl keeps no snapshot in memory. */
export interface SitePageFacts<Facts = unknown> {
  url: string
  facts: Facts
}

/** One element a site finding cites, on one page. */
export interface SiteElement {
  page: string
  ref: string
  name?: string | undefined
  html?: string | undefined
}

/** A failure or a needs-review item from comparing the pages of a set. */
export interface SiteFinding {
  /** Stable across runs: the criterion, the component and the items involved, never the page list. */
  fingerprint: string
  criterion: string
  level: Level
  source: 'site'
  /** A failure, or something a person must look at: never a failure and never in the exit code. */
  status: 'failure' | 'review'
  set: string
  /** The component or mechanism compared, as a person would name it: `navigation "Main"`, `mailto:help@example.com`. */
  subject: string
  message: string
  /** The order observed on each page, as text: one line per distinct order. */
  evidence: string
  /** Pages whose order differs from the rest of the set; on a tie, every page involved. */
  pages: string[]
  /** Pages compared with them. */
  comparedWith: string[]
  /** The items whose relative order changed, as named on the pages. */
  items: string[]
  elements: SiteElement[]
  /** The order observed, page by page: items common to the pages compared, in document order. */
  observed: Array<{ pages: string[]; order: string[] }>
  confidence: Confidence
  /** Experimental checks report below the default threshold until they pass the evaluation gate (docs/plans/wcag-coverage.md, 4.9). */
  experimental: boolean
}

/** One site criterion's run over the sets of a crawl. */
export interface SiteCriterionSummary {
  criterion: string
  level: Level
  version: string
  maturity: 'stable' | 'experimental'
  /** Sets with two or more pages, where something could be compared. */
  setsCompared: number
  /** Components or mechanisms found on two or more pages of a set and compared. */
  compared: number
  findings: number
  review: number
}

export interface SiteCriteriaReport {
  sets: PageSet[]
  /** Pages that went into no set, and why: no navigation found, or a set of their own. */
  unassigned: Array<{ url: string; reason: 'no-navigation' | 'alone' }>
  criteria: SiteCriterionSummary[]
  findings: SiteFinding[]
  belowThreshold: SiteFinding[]
  /** Never failures and never in the exit code: a person decides. */
  review: SiteFinding[]
  waived: SiteFinding[]
  /**
   * Failures on a criterion beyond the run's target, such as 3.2.6 (new in WCAG 2.2) under --wcag 2.1:
   * reported, never counted toward the target or the exit code.
   */
  beyondTarget?: SiteFinding[] | undefined
}

/**
 * A WCAG criterion decided by comparing pages of a set, such as 3.2.3 Consistent
 * Navigation. Like a page criterion it never sees the DOM: `facts` reads one snapshot,
 * and `compare` reads the facts of the pages of one set. No model is involved.
 */
export interface SiteCriterion<Facts = unknown> {
  id: string
  level: Level
  name: { en: string; 'pt-BR': string }
  /** Bump when the logic changes. */
  version: string
  maturity: 'stable' | 'experimental'
  /** ACT rules it is measured against (`rampa eval --rules site/<id>`, which follows one link per test page). */
  act?: readonly string[] | undefined
  /**
   * Which pages it compares: `set` (the default), the sets proposed from shared templates or named in the config;
   * `language`, every page of the same language and viewport outside the named sets, templates or not, since a
   * page with no landmarks (and so no template) is the one most likely to fail 2.4.1.
   */
  scope?: 'set' | 'language' | undefined
  facts(snapshot: A11ySnapshot): Facts
  compare(set: PageSet, pages: ReadonlyArray<SitePageFacts<Facts>>, locale: Locale): { compared: number; findings: SiteFinding[] }
}
