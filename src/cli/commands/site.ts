import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Browser } from 'playwright-core'
import { resolveProfiles } from '../../advisory/profile.ts'
import { loadWaivers } from '../../config.ts'
import { fileCache } from '../../core/cache.ts'
import { type CheckOptions, checkSnapshot } from '../../core/check.ts'
import { type SitePage, type SiteReport, countReuse, findingSignatures, siteExitCode, summarizeSite } from '../../core/site.ts'
import type { Report } from '../../core/types.ts'
import { RampaError } from '../../core/util.ts'
import { resolveCriteria } from '../../criteria/index.ts'
import { emptyEngine } from '../../engine/axe.ts'
import { chooseModel } from '../../providers/detect.ts'
import type { ModelProvider } from '../../providers/types.ts'
import { colorsEnabled, paint } from '../../report/color.ts'
import { renderSiteReport } from '../../report/site.ts'
import { type BrowserOptions, addSiteCookies, contextOptions, describeConditions, webUrl } from '../../surfaces/browser-options.ts'
import {
  type CrawlOptions,
  Frontier,
  type SiteStart,
  SkipPage,
  type SkipReason,
  pageLinks,
  parseCrawlFlags,
  resolveSites,
  runCrawl,
  siteFetcher,
  sitemapLocations,
} from '../../surfaces/crawl.ts'
import { type FetchBytes, type SitemapRead, readSitemaps } from '../../surfaces/sitemap.ts'
import { recordingName } from '../../surfaces/targets.ts'
import { type Collected, collectWeb, launchBrowser } from '../../surfaces/web.ts'
import { VERSION } from '../../version.ts'
import type { GlobalContext } from '../context.ts'
import { type CheckCommandOptions, resolveProvider, wcagOption } from './check.ts'
import { DEFAULT_WCAG, wcagTarget } from '../../wcag.ts'

const SKIP_ORDER: readonly SkipReason[] = ['robots', 'off-site', 'http', 'not-html', 'error']

interface SiteRun {
  browser: Browser
  fetch: FetchBytes
  crawl: CrawlOptions
  browserOptions: BrowserOptions
  options: CheckCommandOptions
  context: GlobalContext
  provider: ModelProvider | undefined
  check: Omit<CheckOptions, 'cache'>
  needsImages: boolean
  progress: (message: string) => void
}

/** `rampa check <url> --crawl`: the pages of a site, one summary for the site and a report per page. */
export async function runSiteCheck(targets: string[], options: CheckCommandOptions, context: GlobalContext, browserOptions: BrowserOptions): Promise<number> {
  const crawl = parseCrawlFlags(options)
  const starts = targets.map((target) => {
    const url = webUrl(target)
    if (!url) throw new RampaError('crawl-target', `--crawl needs http(s) URLs; got ${target}. A folder target already checks every .html file in it.`)
    return url
  })
  const criteria = resolveCriteria(options.criteria.split(','))
  const spec = options.llm ? await chooseModel(options.model, context.config.model) : undefined
  const provider = await resolveProvider(spec, Boolean(options.offline), options.reasoning ?? context.config.reasoning)
  const check: Omit<CheckOptions, 'cache'> = {
    criteria,
    llm: options.llm,
    provider,
    runs: Math.max(1, Number.parseInt(options.runs, 10) || 1),
    offline: Boolean(options.offline),
    locale: context.locale,
    minConfidence: options.minConfidence,
    concurrency: Math.max(1, Number.parseInt(options.concurrency, 10) || 4),
    waivers: await loadWaivers(),
    profiles: resolveProfiles(options.profile, context.config.profiles),
    coga: context.config.coga,
    wcag: wcagOption(options.wcag),
  }
  const progress = (message: string) => {
    if (process.stderr.isTTY && options.format === 'pretty') process.stderr.write(`\x1b[2K${message}\r`)
  }

  const sites: SiteReport[] = []
  const browser = await launchBrowser()
  try {
    // robots.txt, sitemaps and start pages are fetched with the same session as the pages.
    const session = await browser.newContext(contextOptions(browserOptions))
    for (const start of starts) await addSiteCookies(session, start.href, browserOptions)
    const fetch = siteFetcher(session, browserOptions, starts, browserOptions.timeoutMs)
    progress('… robots.txt')
    const run: SiteRun = {
      browser,
      fetch,
      crawl,
      browserOptions,
      options,
      context,
      provider,
      check,
      needsImages: options.llm && criteria.some((criterion) => criterion.needs.vision),
      progress,
    }
    for (const site of await resolveSites(targets, fetch)) sites.push(await checkSite(site, run))
  } finally {
    progress('')
    await browser.close()
  }

  const json = `${JSON.stringify(sites.length === 1 ? sites[0] : sites, null, 2)}\n`
  if (options.format === 'json' && !options.output) process.stdout.write(json)
  if (options.format !== 'json') {
    const p = paint(colorsEnabled())
    const text = sites.map((site) => renderSiteReport(site, { verbose: Boolean(options.verbose), paint: p })).join('\n\n')
    process.stdout.write(`\n${text}\n`)
  }
  if (options.output) {
    await mkdir(dirname(options.output), { recursive: true })
    await writeFile(options.output, json, 'utf8')
  }
  return siteExitCode(sites, options.failOn)
}

async function checkSite(site: SiteStart, run: SiteRun): Promise<SiteReport> {
  const { crawl, options } = run
  const frontier = new Frontier(site.origin, site.robots, crawl)
  frontier.skipped.push(...site.skipped)
  frontier.offer(
    site.starts.map((start) => start.url),
    0,
    undefined,
    true,
  )

  let sitemaps: SitemapRead = { urls: [], read: [], failed: [] }
  if (crawl.sitemap !== false && site.starts.length > 0) {
    run.progress('… sitemap')
    sitemaps = await readSitemaps(sitemapLocations(crawl.sitemap, site), run.fetch)
    if (sitemaps.read.length === 0) {
      const tried = sitemaps.failed.map((failure) => `${failure.url} (${failure.detail})`).join(', ')
      throw new RampaError('no-sitemap', `No sitemap could be read for ${site.origin}: ${tried}. Pass --sitemap <url>, or --crawl to follow links instead.`)
    }
    frontier.offer(sitemaps.urls, 1, 'sitemap')
  }

  const cache = countReuse(fileCache(options.cacheDir))
  const pages: Array<SitePage & { index: number }> = []
  // Pages load in parallel but are judged one at a time, in turn: a judgment made for one
  // page is in the cache before the next page asks for it, so a shared header costs one call.
  let judging: Promise<unknown> = Promise.resolve()
  let turns = 0

  await runCrawl(frontier, { concurrency: crawl.concurrency, delayMs: (site.robots.crawlDelaySeconds ?? 0) * 1000 }, async (task) => {
    run.progress(`… ${frontier.loaded}/${crawl.maxPages} ${task.url}`)
    let finalUrl = task.url
    let collected: Collected
    try {
      collected = await collectWeb(run.browser, task.url, {
        runAxe: true,
        locale: run.context.locale,
        screenshotDir: options.screenshots ? '.rampa/screenshots' : undefined,
        captureImages: run.needsImages,
        browserOptions: run.browserOptions,
        wcag: run.check.wcag,
        inspect: async (page, response) => {
          finalUrl = page.url()
          const verdict = frontier.arrived(task, finalUrl, response?.status(), response?.headers()['content-type'])
          if (verdict) throw new SkipPage(verdict === 'duplicate' ? undefined : verdict)
          if (crawl.sitemap === false) frontier.offer(await pageLinks(page), task.depth + 1, finalUrl)
        },
      })
    } catch (error) {
      if (!(error instanceof SkipPage)) throw error
      if (error.skip) frontier.skipped.push(error.skip)
      return
    }
    const snapshot = { ...collected.snapshot, target: finalUrl }
    if (options.save) await saveRecording(options.save, snapshot, collected)
    const turn = judging.then(() => {
      cache.page = turns++
      return checkSnapshot(snapshot, collected.engine, { ...run.check, cache })
    })
    judging = turn.catch(() => undefined)
    const report = await turn
    pages.push({ url: finalUrl, report, signatures: findingSignatures(report.findings, snapshot), index: task.index })
  })

  pages.sort((a, b) => a.index - b.index)
  const first: Report | undefined = pages[0]?.report
  return {
    schemaVersion: 1,
    kind: 'site',
    rampaVersion: VERSION,
    createdAt: new Date().toISOString(),
    site: site.origin,
    start: site.starts,
    crawl: {
      mode: crawl.sitemap === false ? 'links' : 'sitemap',
      maxPages: crawl.maxPages,
      maxDepth: crawl.maxDepth,
      concurrency: crawl.concurrency,
      include: crawl.include,
      exclude: crawl.exclude,
      ignoreQuery: crawl.ignoreQuery,
      robots: {
        url: site.robotsUrl,
        status: site.robots.status,
        group: site.robots.group,
        crawlDelaySeconds: site.robots.crawlDelaySeconds,
        detail: site.robots.detail,
      },
      sitemaps: sitemaps.read,
      sitemapErrors: sitemaps.failed,
    },
    browser: describeConditions(run.browserOptions),
    wcagTarget: wcagTarget(run.check.wcag ?? DEFAULT_WCAG),
    locale: run.context.locale,
    llm: first?.llm ?? (!options.llm ? 'off' : run.provider || options.offline ? 'on' : 'no-model'),
    model: run.provider?.id,
    engine: first?.engine ?? emptyEngine().engine,
    // Failures are recorded as pages finish loading; a fixed order keeps reports comparable between runs.
    notChecked: [...frontier.skipped].sort((a, b) => SKIP_ORDER.indexOf(a.reason) - SKIP_ORDER.indexOf(b.reason) || a.url.localeCompare(b.url)),
    notLoaded: frontier.notLoaded,
    beyondDepth: frontier.beyondDepth,
    summary: summarizeSite(pages, cache.reused),
    pages: pages.map((page) => page.report),
  }
}

async function saveRecording(dir: string, snapshot: Collected['snapshot'], collected: Collected): Promise<void> {
  await mkdir(dir, { recursive: true })
  const name = recordingName(snapshot.target)
  await writeFile(join(dir, `${name}.snapshot.json`), `${JSON.stringify(snapshot)}\n`, 'utf8')
  await writeFile(join(dir, `${name}.engine.json`), `${JSON.stringify(collected.engine)}\n`, 'utf8')
}
