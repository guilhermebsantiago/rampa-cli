import type { RepeatedFinding, SiteReport } from '../core/site.ts'
import type { CriterionSummary, Finding } from '../core/types.ts'
import { type Locale, t } from '../i18n.ts'
import { estimateCostUsd } from '../providers/models.ts'
import type { CrawlSkip } from '../surfaces/crawl.ts'
import { compareCriteria, criteriaFor, criterionLabel, versionOf } from '../wcag.ts'
import { type PrettyOptions, renderFinding } from './pretty.ts'

const messages = {
  en: {
    site: 'Site {site}',
    pagesChecked: '{count} page(s) checked',
    crawlLinks: 'Crawl: links from {start}',
    crawlSitemap: 'Crawl: pages from {sitemaps}',
    upTo: 'up to {count} pages',
    depth: 'depth up to {depth}',
    include: 'include {patterns}',
    exclude: 'exclude {patterns}',
    ignoreQuery: 'query ignored',
    robotsRampa: 'robots.txt: rules for Rampa',
    robotsEveryone: 'robots.txt: rules for every crawler',
    robotsNoGroup: 'robots.txt: no rules for Rampa',
    robotsMissing: 'no robots.txt',
    robotsUnreachable: 'robots.txt unreadable',
    browser: 'Browser',
    dark: 'dark color scheme',
    light: 'light color scheme',
    reducedMotion: 'reduced motion',
    locale: 'locale {locale}',
    userAgent: 'custom user agent',
    waitFor: 'waits for {steps}',
    storageState: 'storage state',
    headers: 'headers {names}',
    cookies: 'cookies {names}',
    startRedirected: 'Start {from} led to {to}',
    noPages: 'No page could be checked.',
    repeatedTitle: 'On several pages, most likely a shared component: fix it once',
    onPages: 'on {count} of {total} pages: {pages}',
    andMore: 'and {count} more',
    moreElements: 'and {count} more element(s)',
    pageByPage: 'Page by page',
    nothingElse: 'Nothing found only on: {pages}',
    pagesChecked2: 'Pages checked: {pages}',
    notCheckedTitle: 'Not checked',
    skipRobots: 'robots.txt disallows it',
    skipNotHtml: 'not an HTML page ({type})',
    skipOffSite: 'led to another site: {url}',
    skipError: 'did not load: {error}',
    linkedFrom: 'linked from {page}',
    fromSitemap: 'in the sitemap',
    notLoaded: '{count} more page(s) found and not loaded (--max-pages {max})',
    beyondDepth: '{count} more page(s) found beyond --max-depth {depth}',
    reused: '{count} reused from an earlier page with the same input',
    robotsUnreadable: 'robots.txt at {url} could not be read ({detail}), so nothing was crawled (RFC 9309). A single page can still be checked without --crawl.',
    sitemapFailed: 'Could not read the sitemap {url} ({detail}).',
    crawlDelay: 'robots.txt asks for {seconds} s between pages, and Rampa waited that long.',
    discardedOn: 'Discarded by verification on this page',
    coveragePages: 'Pages:',
    coveragePagesCount: '{checked} checked of {found} found',
    disclaimer: 'This report does not declare the site accessible.',
  },
  'pt-BR': {
    site: 'Site {site}',
    pagesChecked: '{count} página(s) verificada(s)',
    crawlLinks: 'Rastreamento: links a partir de {start}',
    crawlSitemap: 'Rastreamento: páginas de {sitemaps}',
    upTo: 'até {count} páginas',
    depth: 'profundidade até {depth}',
    include: 'inclui {patterns}',
    exclude: 'exclui {patterns}',
    ignoreQuery: 'query ignorada',
    robotsRampa: 'robots.txt: regras para o Rampa',
    robotsEveryone: 'robots.txt: regras para todos os robôs',
    robotsNoGroup: 'robots.txt: nenhuma regra para o Rampa',
    robotsMissing: 'sem robots.txt',
    robotsUnreachable: 'robots.txt ilegível',
    browser: 'Navegador',
    dark: 'esquema de cores escuro',
    light: 'esquema de cores claro',
    reducedMotion: 'movimento reduzido',
    locale: 'idioma {locale}',
    userAgent: 'user agent próprio',
    waitFor: 'espera {steps}',
    storageState: 'storage state',
    headers: 'cabeçalhos {names}',
    cookies: 'cookies {names}',
    startRedirected: 'O início {from} levou a {to}',
    noPages: 'Nenhuma página pôde ser verificada.',
    repeatedTitle: 'Em várias páginas, provavelmente um componente compartilhado: corrija uma vez',
    onPages: 'em {count} de {total} páginas: {pages}',
    andMore: 'e mais {count}',
    moreElements: 'e mais {count} elemento(s)',
    pageByPage: 'Página a página',
    nothingElse: 'Nada encontrado só em: {pages}',
    pagesChecked2: 'Páginas verificadas: {pages}',
    notCheckedTitle: 'Não verificadas',
    skipRobots: 'o robots.txt não permite',
    skipNotHtml: 'não é uma página HTML ({type})',
    skipOffSite: 'levou a outro site: {url}',
    skipError: 'não carregou: {error}',
    linkedFrom: 'link em {page}',
    fromSitemap: 'no sitemap',
    notLoaded: '{count} página(s) encontrada(s) e não carregada(s) (--max-pages {max})',
    beyondDepth: '{count} página(s) encontrada(s) além de --max-depth {depth}',
    reused: '{count} reaproveitada(s) de uma página anterior com a mesma entrada',
    robotsUnreadable: 'O robots.txt em {url} não pôde ser lido ({detail}), então nada foi rastreado (RFC 9309). Uma página isolada ainda pode ser verificada sem --crawl.',
    sitemapFailed: 'Não foi possível ler o sitemap {url} ({detail}).',
    crawlDelay: 'O robots.txt pede {seconds} s entre páginas, e o Rampa esperou esse tempo.',
    discardedOn: 'Descartado pela verificação nesta página',
    coveragePages: 'Páginas:',
    coveragePagesCount: '{checked} verificada(s) de {found} encontrada(s)',
    disclaimer: 'Este relatório não declara o site acessível.',
  },
} as const

type SiteMessage = keyof (typeof messages)['en']

function st(locale: Locale, key: SiteMessage, vars: Record<string, string | number> = {}): string {
  const template: string = messages[locale][key] ?? messages.en[key]
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`))
}

/** Page lists stay short in the terminal; the JSON report has every page. */
const MAX_LISTED_PAGES = 8
const MAX_LISTED_ELEMENTS = 10

/**
 * Engine findings with the same rule, message and pages print as one block that
 * lists their elements: a template with twenty images without a text
 * alternative reads as one problem with twenty places to fix. A judgment
 * finding has its own evidence and patch, so it stays on its own.
 */
function blocksOf(groups: readonly RepeatedFinding[]): RepeatedFinding[][] {
  const blocks = new Map<string, RepeatedFinding[]>()
  for (const group of groups) {
    const key = group.source === 'engine' ? `${group.ruleId}\u0000${group.message}\u0000${group.pages.join('\u0000')}` : group.signature
    blocks.set(key, [...(blocks.get(key) ?? []), group])
  }
  return [...blocks.values()]
}

/**
 * The site view of a crawl: what repeats across pages once, then what is
 * particular to each page, what was not checked and the coverage.
 */
export function renderSiteReport(site: SiteReport, options: PrettyOptions): string {
  const { paint: p, verbose } = options
  const locale = site.locale
  const path = (url: string) => sitePath(url, site.site)
  const lines: string[] = []

  lines.push(p.bold(`${st(locale, 'site', { site: site.site })} · ${st(locale, 'pagesChecked', { count: site.pages.length })}`))
  const meta = [`${t(locale, 'surface')}: web`, `${site.engine.name} ${site.engine.version}`]
  if (site.model) meta.push(`${t(locale, 'model')}: ${site.model}`)
  lines.push(p.dim(meta.join(' · ')))
  lines.push(p.dim(crawlLine(site, path)))
  const browser = browserLine(site)
  if (browser) lines.push(p.dim(browser))
  for (const start of site.start) {
    if (start.url !== start.requested) lines.push(p.dim(st(locale, 'startRedirected', { from: start.requested, to: start.url })))
  }
  lines.push('')

  if (site.pages.length === 0) lines.push(p.yellow(st(locale, 'noPages')), '')
  else if (site.summary.findings.total === 0) lines.push(p.green(t(locale, 'noFindings')), '')

  if (site.summary.repeated.length > 0) {
    lines.push(p.bold(st(locale, 'repeatedTitle')), '')
    for (const [criterion, groups] of byCriterion(site.summary.repeated)) {
      lines.push(p.bold(criterionLabel(criterion, locale)))
      for (const block of blocksOf(groups)) {
        const first = block[0] as RepeatedFinding
        // renderFinding starts with the element's line; a block lists all its elements there instead.
        const [, ...rest] = renderFinding(asFinding(first), locale, p)
        for (const group of block.slice(0, MAX_LISTED_ELEMENTS)) lines.push(`  ${p.redBold('✗')} ${group.ref ?? ''}`)
        if (block.length > MAX_LISTED_ELEMENTS) lines.push(p.dim(`    ${st(locale, 'moreElements', { count: block.length - MAX_LISTED_ELEMENTS })}`))
        // A block spans elements and pages, while an id names one finding on one page: waive from a page's own report.
        lines.push(...rest.map((line) => line.replace(/ · id .*$/, '')))
        lines.push(`    ${st(locale, 'onPages', { count: first.pages.length, total: site.pages.length, pages: pageList(first.pages.map(path), locale) })}`)
      }
      lines.push('')
    }
  }

  if (site.pages.length > 0) {
    const quiet: string[] = []
    const sections: string[] = []
    site.pages.forEach((report, pageIndex) => {
      const specific = site.summary.pageSpecific[pageIndex]?.findings.map((index) => report.findings[index] as Finding) ?? []
      const findings = verbose ? [...specific, ...report.belowThreshold] : specific
      const discarded = verbose ? report.discarded : []
      if (findings.length === 0 && discarded.length === 0) {
        quiet.push(path(report.target))
        return
      }
      sections.push(p.bold(path(report.target)))
      for (const [criterion, list] of byCriterion(findings)) {
        sections.push(`  ${p.bold(criterionLabel(criterion, locale))}`)
        for (const finding of list) sections.push(...renderFinding(finding, locale, p).map((line) => `  ${line}`))
      }
      if (discarded.length > 0) {
        sections.push(`  ${p.bold(st(locale, 'discardedOn'))}`)
        for (const item of discarded) sections.push(`    ${p.gray(item.ref)}  ${item.reason}`)
      }
      sections.push('')
    })
    lines.push(p.bold(st(locale, 'pageByPage')))
    lines.push(...sections)
    if (quiet.length > 0) {
      const key = site.summary.findings.total === 0 && !verbose ? 'pagesChecked2' : 'nothingElse'
      lines.push(p.dim(st(locale, key, { pages: pageList(quiet, locale) })), '')
    }
  }

  if (site.notChecked.length > 0 || site.notLoaded > 0) {
    lines.push(p.bold(st(locale, 'notCheckedTitle')))
    const width = Math.min(48, Math.max(0, ...site.notChecked.map((skip) => path(skip.url).length)) + 2)
    for (const skip of site.notChecked) lines.push(`  ${path(skip.url).padEnd(width)}${p.dim(skipText(skip, locale, path))}`)
    const shallow = site.notLoaded - site.beyondDepth
    if (shallow > 0) lines.push(p.dim(`  ${st(locale, 'notLoaded', { count: shallow, max: site.crawl.maxPages })}`))
    if (site.beyondDepth > 0) lines.push(p.dim(`  ${st(locale, 'beyondDepth', { count: site.beyondDepth, depth: site.crawl.maxDepth ?? 0 })}`))
    lines.push('')
  }

  const notes = siteNotes(site, verbose)
  if (notes.length > 0) {
    for (const note of notes) lines.push(p.yellow(note))
    lines.push('')
  }

  const usage = usageLine(site)
  if (usage) lines.push(p.dim(usage), '')

  lines.push(p.bold(t(locale, 'coverageTitle')))
  const engineLabel = t(locale, 'coverageEngine', { engine: site.engine.name })
  const labels = [engineLabel, t(locale, 'coverageJudged'), t(locale, 'coverageNotChecked'), st(locale, 'coveragePages')]
  const width = Math.max(...labels.map((label) => label.length)) + 2
  const coverage = site.summary.coverage
  const version = versionOf(site.pages[0]?.wcagTarget)
  lines.push(`  ${engineLabel.padEnd(width)}${list(coverage.engine)}`)
  lines.push(`  ${t(locale, 'coverageJudged').padEnd(width)}${list(coverage.judged)}`)
  const notChecked = verbose
    ? list(coverage.notChecked)
    : t(locale, 'coverageNotCheckedCount', { count: coverage.notChecked.length, total: criteriaFor(version).length, version })
  lines.push(`  ${t(locale, 'coverageNotChecked').padEnd(width)}${notChecked}`)
  lines.push(p.dim(`  ${t(locale, version === '2.1' ? 'coverageParsing21' : 'coverageParsing22')}`))
  const found = site.pages.length + site.notChecked.length + site.notLoaded
  lines.push(`  ${st(locale, 'coveragePages').padEnd(width)}${st(locale, 'coveragePagesCount', { checked: site.pages.length, found })}`)
  lines.push(p.bold(st(locale, 'disclaimer')))
  lines.push(p.dim(t(locale, 'manualReview')))
  return lines.join('\n')
}

/** A page's address without the site's origin: `/about` rather than `https://example.com/about`. */
export function sitePath(url: string, origin: string): string {
  return url.startsWith(origin) ? url.slice(origin.length) || '/' : url
}

function pageList(pages: readonly string[], locale: Locale): string {
  if (pages.length <= MAX_LISTED_PAGES) return pages.join(', ')
  const rest = pages.length - (MAX_LISTED_PAGES - 1)
  return `${pages.slice(0, MAX_LISTED_PAGES - 1).join(', ')} ${st(locale, 'andMore', { count: rest })}`
}

function byCriterion<T extends { criterion: string }>(items: readonly T[]): Array<[string, T[]]> {
  const groups = new Map<string, T[]>()
  for (const item of items) groups.set(item.criterion, [...(groups.get(item.criterion) ?? []), item])
  return [...groups.entries()].sort(([a], [b]) => compareCriteria(a, b))
}

/** A repeated group printed like any finding: the element and message of its first occurrence. */
function asFinding(group: RepeatedFinding): Finding {
  return {
    fingerprint: group.fingerprints[0] ?? group.signature,
    criterion: group.criterion,
    level: group.level,
    source: group.source,
    ref: group.ref,
    message: group.message,
    evidence: group.evidence,
    patch: group.patch,
    confidence: group.confidence,
    agreement: group.agreement,
    ruleId: group.ruleId,
    helpUrl: group.helpUrl,
    html: group.html,
  }
}

function crawlLine(site: SiteReport, path: (url: string) => string): string {
  const locale = site.locale
  const crawl = site.crawl
  const parts =
    crawl.mode === 'sitemap'
      ? [st(locale, 'crawlSitemap', { sitemaps: crawl.sitemaps.length > 0 ? crawl.sitemaps.map(path).join(', ') : '—' })]
      : [st(locale, 'crawlLinks', { start: site.start.map((start) => path(start.url)).join(', ') || '—' })]
  parts.push(st(locale, 'upTo', { count: crawl.maxPages }))
  if (crawl.maxDepth !== undefined) parts.push(st(locale, 'depth', { depth: crawl.maxDepth }))
  if (crawl.include.length > 0) parts.push(st(locale, 'include', { patterns: crawl.include.join(', ') }))
  if (crawl.exclude.length > 0) parts.push(st(locale, 'exclude', { patterns: crawl.exclude.join(', ') }))
  if (crawl.ignoreQuery) parts.push(st(locale, 'ignoreQuery'))
  const robots = crawl.robots
  parts.push(
    robots.status === 'missing'
      ? st(locale, 'robotsMissing')
      : robots.status === 'unreachable'
        ? st(locale, 'robotsUnreachable')
        : robots.group === 'rampa'
          ? st(locale, 'robotsRampa')
          : robots.group === '*'
            ? st(locale, 'robotsEveryone')
            : st(locale, 'robotsNoGroup'),
  )
  return parts.join(' · ')
}

/** Only what differs from the default desktop page, so the line is there when it matters. */
function browserLine(site: SiteReport): string | undefined {
  const locale = site.locale
  const b = site.browser
  const parts: string[] = []
  if (b.device) parts.push(`${b.device} (${b.viewport.width}×${b.viewport.height})`)
  else if (b.viewport.width !== 1280 || b.viewport.height !== 800) parts.push(`${b.viewport.width}×${b.viewport.height}`)
  if (b.colorScheme) parts.push(st(locale, b.colorScheme))
  if (b.reducedMotion) parts.push(st(locale, 'reducedMotion'))
  if (b.locale) parts.push(st(locale, 'locale', { locale: b.locale }))
  if (b.userAgent) parts.push(st(locale, 'userAgent'))
  const waits = [...(b.waitUntil !== 'load' ? [b.waitUntil] : []), ...(b.waitFor ?? [])]
  if (waits.length > 0) parts.push(st(locale, 'waitFor', { steps: waits.join(', ') }))
  if (b.storageState) parts.push(st(locale, 'storageState'))
  if (b.headers?.length) parts.push(st(locale, 'headers', { names: b.headers.join(', ') }))
  if (b.cookies?.length) parts.push(st(locale, 'cookies', { names: b.cookies.join(', ') }))
  return parts.length > 0 ? `${st(locale, 'browser')}: ${parts.join(' · ')}` : undefined
}

function skipText(skip: CrawlSkip, locale: Locale, path: (url: string) => string): string {
  const detail = skip.detail
  let text: string
  switch (skip.reason) {
    case 'robots':
      text = detail ? `${st(locale, 'skipRobots')} (${detail.replace(/(https?:\/\/\S+)/, (url) => path(url))})` : st(locale, 'skipRobots')
      break
    case 'http':
      text = detail ?? 'HTTP'
      break
    case 'not-html':
      text = st(locale, 'skipNotHtml', { type: detail ?? '?' })
      break
    case 'off-site':
      text = st(locale, 'skipOffSite', { url: detail ?? '?' })
      break
    default:
      text = st(locale, 'skipError', { error: detail ?? '?' })
  }
  if (skip.from === 'sitemap') return `${text} · ${st(locale, 'fromSitemap')}`
  if (skip.from) return `${text} · ${st(locale, 'linkedFrom', { page: path(skip.from) })}`
  return text
}

/** The notes of every page added up, plus what the crawl itself has to say. */
function siteNotes(site: SiteReport, verbose: boolean): string[] {
  const locale = site.locale
  const notes: string[] = []
  const sum = (key: keyof Omit<CriterionSummary, 'criterion' | 'applicable'>) =>
    site.pages.reduce((total, report) => total + report.criteria.reduce((n, c) => n + c[key], 0), 0)
  if (site.crawl.robots.status === 'unreachable') {
    notes.push(st(locale, 'robotsUnreadable', { url: site.crawl.robots.url, detail: site.crawl.robots.detail ?? '?' }))
  }
  for (const failure of site.crawl.sitemapErrors) notes.push(st(locale, 'sitemapFailed', { url: failure.url, detail: failure.detail }))
  if (site.crawl.robots.crawlDelaySeconds) notes.push(st(locale, 'crawlDelay', { seconds: site.crawl.robots.crawlDelaySeconds }))
  if (site.llm === 'off') {
    const candidates = sum('candidates')
    const criteria = [...new Set(site.pages.flatMap((report) => report.criteria.map((c) => c.criterion)))].join(', ')
    if (candidates > 0) notes.push(t(locale, 'judgmentSkipped', { count: candidates, criteria }))
  }
  if (site.llm === 'no-model') notes.push(t(locale, 'noModel'))
  if (sum('discarded') > 0) notes.push(t(locale, 'discarded', { count: sum('discarded') }))
  if (sum('cannotTell') > 0) notes.push(t(locale, 'cannotTell', { count: sum('cannotTell') }))
  if (sum('offlineMisses') > 0) notes.push(t(locale, 'offlineMisses', { count: sum('offlineMisses') }))
  if (sum('errors') > 0) {
    const error = site.pages.flatMap((report) => report.errors)[0] ?? ''
    notes.push(t(locale, 'judgmentErrors', { count: sum('errors'), error }))
  }
  const below = site.pages.reduce((total, report) => total + report.belowThreshold.length, 0)
  if (!verbose && below > 0) notes.push(t(locale, 'belowThreshold', { count: below }))
  return notes
}

/** Model calls of the whole crawl, and how many an earlier page saved. */
function usageLine(site: SiteReport): string | undefined {
  const { locale } = site
  const usage = site.summary.usage
  if (usage.calls + usage.cachedCalls === 0) return undefined
  const decimal = (value: number, digits: number) => {
    const text = value.toFixed(digits)
    return locale === 'pt-BR' ? text.replace('.', ',') : text
  }
  const parts = [
    t(locale, 'usage', {
      calls: usage.calls,
      cached: usage.cachedCalls,
      input: decimal(usage.inputTokens / 1000, 1),
      output: decimal(usage.outputTokens / 1000, 1),
    }),
  ]
  if (usage.reusedAcrossPages > 0) parts.push(st(locale, 'reused', { count: usage.reusedAcrossPages }))
  const cost = estimateCostUsd(site.model, usage.inputTokens, usage.outputTokens)
  if (cost === 0) parts.push(t(locale, 'usageLocal'))
  else if (cost !== undefined) parts.push(cost < 0.0001 ? `< US$ ${decimal(0.0001, 4)}` : `≈ US$ ${decimal(cost, 4)}`)
  return parts.join(' · ')
}

function list(items: readonly string[]): string {
  return items.length === 0 ? '—' : items.join(', ')
}
