import type { BrowserContext, Page } from 'playwright-core'
import { RampaError, errorMessage } from '../core/util.ts'
import { type BrowserOptions, headersFor, sameSite, wholeNumber } from './browser-options.ts'
import { type Robots, compilePattern, normalizePattern, robotsAllows, robotsFromResponse, robotsPath } from './robots.ts'
import type { FetchBytes } from './sitemap.ts'

/** The crawl flags of `rampa check`, as the command line gives them. */
export interface CrawlFlags {
  crawl?: boolean | undefined
  maxPages?: string | undefined
  maxDepth?: string | undefined
  sitemap?: boolean | string | undefined
  include?: string[] | undefined
  exclude?: string[] | undefined
  ignoreQuery?: boolean | undefined
  crawlConcurrency?: string | undefined
}

export interface CrawlOptions {
  /** Pages loaded at most, per site, whether they turn out checkable or not. */
  maxPages: number
  /** Links followed away from a start page; undefined leaves only --max-pages. */
  maxDepth: number | undefined
  /** Take the pages from a sitemap instead of following links: true finds it through robots.txt or /sitemap.xml. */
  sitemap: boolean | string
  include: string[]
  exclude: string[]
  /** Addresses that differ only in the query are the same page. */
  ignoreQuery: boolean
  /** Pages loaded at the same time. */
  concurrency: number
}

export const DEFAULT_MAX_PAGES = 10
export const DEFAULT_CRAWL_CONCURRENCY = 2

/** --sitemap implies --crawl; the other crawl flags mean nothing without one of the two. */
export function crawlRequested(flags: CrawlFlags): boolean {
  if (flags.crawl || (flags.sitemap !== undefined && flags.sitemap !== false)) return true
  const given: Array<[string, boolean]> = [
    ['--max-pages', flags.maxPages !== undefined],
    ['--max-depth', flags.maxDepth !== undefined],
    ['--include', Boolean(flags.include?.length)],
    ['--exclude', Boolean(flags.exclude?.length)],
    ['--ignore-query', Boolean(flags.ignoreQuery)],
    ['--crawl-concurrency', flags.crawlConcurrency !== undefined],
  ]
  const stray = given.filter(([, set]) => set).map(([flag]) => flag)
  if (stray.length > 0) throw new RampaError('crawl-only', `${stray.join(', ')} only ${stray.length === 1 ? 'applies' : 'apply'} with --crawl or --sitemap.`)
  return false
}

export function parseCrawlFlags(flags: CrawlFlags): CrawlOptions {
  const sitemap = typeof flags.sitemap === 'string' && flags.sitemap.trim() !== '' ? flags.sitemap.trim() : flags.sitemap !== undefined && flags.sitemap !== false
  if (sitemap !== false && flags.maxDepth !== undefined) {
    throw new RampaError('crawl-only', '--max-depth applies when following links; with --sitemap, the sitemap lists the pages.')
  }
  if (typeof sitemap === 'string') notAWindowsPath('--sitemap', sitemap)
  for (const pattern of flags.include ?? []) notAWindowsPath('--include', pattern)
  for (const pattern of flags.exclude ?? []) notAWindowsPath('--exclude', pattern)
  return {
    maxPages: flags.maxPages === undefined ? DEFAULT_MAX_PAGES : wholeNumber(flags.maxPages, '--max-pages', 1),
    maxDepth: flags.maxDepth === undefined ? undefined : wholeNumber(flags.maxDepth, '--max-depth', 0),
    sitemap,
    include: flags.include ?? [],
    exclude: flags.exclude ?? [],
    ignoreQuery: Boolean(flags.ignoreQuery),
    concurrency: flags.crawlConcurrency === undefined ? DEFAULT_CRAWL_CONCURRENCY : wholeNumber(flags.crawlConcurrency, '--crawl-concurrency', 1),
  }
}

/**
 * Git Bash on Windows turns an argument that starts with / into a Windows path
 * (/blog/ becomes C:/Program Files/Git/blog/) before Rampa sees it, and the
 * pattern would then match nothing. No path on a site looks like that.
 */
function notAWindowsPath(flag: string, value: string): void {
  if (!/^[A-Za-z]:[\\/]/.test(value)) return
  throw new RampaError(
    'windows-path',
    `${flag} got "${value}", a Windows path: Git Bash rewrites arguments that start with /. Run with MSYS_NO_PATHCONV=1, or start the pattern with * (such as "*/blog/").`,
  )
}

/** An http(s) address without its fragment, or undefined for mailto:, javascript:, tel: and the like. */
export function pageUrl(raw: string, base?: string): URL | undefined {
  try {
    const url = new URL(raw, base)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    url.hash = ''
    return url
  } catch {
    return undefined
  }
}

/**
 * The address a page is known by, so each page is checked once: no fragment,
 * no trailing slash except the root's, and no query with --ignore-query.
 */
export function pageKey(url: URL, ignoreQuery = false): string {
  const path = url.pathname.replace(/\/+$/, '') || '/'
  return `${url.origin}${path}${ignoreQuery ? '' : url.search}`
}

/** Links to files, not pages: never loaded, so they cost neither a request nor a place under --max-pages. */
const NOT_A_PAGE =
  /\.(?:pdf|zip|gz|tgz|bz2|xz|rar|7z|tar|jpe?g|png|gif|webp|avif|svg|ico|bmp|tiff?|heic|mp3|mp4|m4a|m4v|wav|ogg|oga|ogv|webm|mov|avi|mkv|flac|aac|docx?|xlsx?|pptx?|odt|ods|odp|rtf|csv|tsv|json|xml|rss|atom|txt|css|js|mjs|map|woff2?|ttf|otf|eot|exe|dmg|msi|pkg|deb|rpm|apk|ipa|iso|bin|epub|mobi|wasm)$/i

/**
 * --include and --exclude use robots.txt syntax against the path and query: a
 * prefix, `*` for anything, `$` for the end. A pattern that does not start with
 * / or * matches anywhere; one that starts with the site's address is read
 * from its path.
 */
export function urlFilter(patterns: readonly string[], origin: string): ((url: URL) => boolean) | undefined {
  if (patterns.length === 0) return undefined
  const regexes = patterns.map((raw) => {
    let pattern = raw.trim()
    if (pattern.startsWith(origin)) pattern = pattern.slice(origin.length) || '/'
    if (!pattern.startsWith('/') && !pattern.startsWith('*')) pattern = `*${pattern}`
    return compilePattern(normalizePattern(pattern))
  })
  return (url) => {
    const path = robotsPath(url)
    return regexes.some((regex) => regex.test(path))
  }
}

export type SkipReason = 'robots' | 'http' | 'not-html' | 'off-site' | 'error'

/** A page the crawl found and did not check, and why. */
export interface CrawlSkip {
  url: string
  reason: SkipReason
  /** Data, not words: an HTTP status, a content type, an address or an error, so the report can say it in any language. */
  detail?: string | undefined
  /** The page that links to it, or "sitemap". */
  from?: string | undefined
}

export interface CrawlTask {
  url: string
  key: string
  /** Links away from a start page; 0 for a start page. */
  depth: number
  from?: string | undefined
  /** The order pages leave the queue in. */
  index: number
  /** Given on the command line: always loaded, unless robots.txt disallows it. */
  start: boolean
}

/** Thrown from inside a page visit to stop collecting a page the crawl will not check; no skip means a duplicate. */
export class SkipPage extends Error {
  readonly skip: CrawlSkip | undefined
  constructor(skip: CrawlSkip | undefined) {
    super(skip ? `${skip.reason}: ${skip.url}` : 'already checked')
    this.skip = skip
  }
}

/**
 * The pages of one site still to load, and every page the crawl has met.
 * Breadth first: start pages, then the pages they link to, and so on.
 */
export class Frontier {
  readonly origin: string
  readonly skipped: CrawlSkip[] = []
  private readonly robots: Robots
  private readonly options: CrawlOptions
  private readonly include: ((url: URL) => boolean) | undefined
  private readonly exclude: ((url: URL) => boolean) | undefined
  private readonly queue: CrawlTask[] = []
  /** Every page met: queued, loaded, filtered out or skipped. Each is considered once. */
  private readonly known = new Set<string>()
  private readonly loadedKeys = new Set<string>()
  /** Allowed pages found beyond --max-depth; one may still turn up closer to a start page. */
  private readonly tooDeep = new Set<string>()
  private loads = 0
  private signal: Promise<void> | undefined
  private wake: (() => void) | undefined

  constructor(origin: string, robots: Robots, options: CrawlOptions) {
    this.origin = origin
    this.robots = robots
    this.options = options
    this.include = urlFilter(options.include, origin)
    this.exclude = urlFilter(options.exclude, origin)
  }

  /** Pages taken from the queue so far, which is what --max-pages counts. */
  get loaded(): number {
    return this.loads
  }

  /** Pages found and allowed that the crawl did not get to: beyond --max-pages or --max-depth. */
  get notLoaded(): number {
    return this.queue.filter((task) => !this.loadedKeys.has(task.key)).length + this.tooDeep.size
  }

  get beyondDepth(): number {
    return this.tooDeep.size
  }

  /**
   * Queues pages of this site: start pages (only robots.txt can stop them) or
   * links and sitemap entries, which must also pass --include and --exclude
   * and be pages rather than files. Returns how many were queued.
   */
  offer(urls: Iterable<string>, depth: number, from?: string, start = false): number {
    let added = 0
    for (const raw of urls) {
      const url = pageUrl(raw, from?.startsWith('http') ? from : undefined)
      if (!url || url.origin !== this.origin) continue
      const key = pageKey(url, this.options.ignoreQuery)
      const deep = this.options.maxDepth !== undefined && depth > this.options.maxDepth
      if (this.known.has(key)) {
        if (deep || !this.tooDeep.delete(key)) continue
      } else {
        this.known.add(key)
        if (!start && !this.wanted(url)) continue
        if (!robotsAllows(this.robots, url)) {
          this.skipped.push({ url: url.href, reason: 'robots', from })
          continue
        }
        if (deep) {
          this.tooDeep.add(key)
          continue
        }
      }
      this.queue.push({ url: url.href, key, depth, from, index: -1, start })
      added++
    }
    if (added > 0) this.notify()
    return added
  }

  private wanted(url: URL): boolean {
    if (NOT_A_PAGE.test(url.pathname)) return false
    if (this.include && !this.include(url)) return false
    return !this.exclude?.(url)
  }

  /** The next page to load, or undefined when the queue is empty or --max-pages is reached. */
  next(): CrawlTask | undefined {
    while (this.loads < this.options.maxPages) {
      const task = this.queue.shift()
      if (!task) return undefined
      // A redirect may already have brought the crawl to this page.
      if (this.loadedKeys.has(task.key)) continue
      this.loadedKeys.add(task.key)
      task.index = this.loads++
      return task
    }
    return undefined
  }

  /**
   * Decides, once a page has loaded, whether to check it, from where it ended
   * up, its HTTP status and its content type. Undefined means check it;
   * "duplicate" means a redirect led to a page already checked.
   */
  arrived(task: CrawlTask, finalUrl: string, status?: number, contentType?: string): CrawlSkip | 'duplicate' | undefined {
    const skip = (reason: SkipReason, detail?: string): CrawlSkip => ({ url: task.url, reason, detail, from: task.from })
    const final = pageUrl(finalUrl)
    if (!final || final.origin !== this.origin) return skip('off-site', finalUrl)
    const key = pageKey(final, this.options.ignoreQuery)
    if (key !== task.key) {
      if (this.loadedKeys.has(key)) return 'duplicate'
      this.loadedKeys.add(key)
      this.known.add(key)
      // The browser follows redirects on its own, so robots.txt is checked again where the page landed.
      if (!robotsAllows(this.robots, final)) return skip('robots', `→ ${final.href}`)
    }
    if (status !== undefined && status >= 400) return skip('http', `HTTP ${status}`)
    if (contentType && !/html/i.test(contentType)) return skip('not-html', contentType.split(';')[0]?.trim())
    return undefined
  }

  skip(task: CrawlTask, reason: SkipReason, detail?: string): void {
    this.skipped.push({ url: task.url, reason, detail, from: task.from })
  }

  /** Resolves the next time pages are queued, so idle workers can start on them. */
  changed(): Promise<void> {
    this.signal ??= new Promise<void>((resolve) => {
      this.wake = resolve
    })
    return this.signal
  }

  private notify(): void {
    const wake = this.wake
    this.signal = undefined
    this.wake = undefined
    wake?.()
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Visits pages with at most `concurrency` loading at once. A visit queues the
 * links it finds while it is still running, so idle workers start on them
 * early. With a Crawl-delay, page loads start at least that far apart.
 */
export async function runCrawl(
  frontier: Frontier,
  options: { concurrency: number; delayMs?: number | undefined },
  visit: (task: CrawlTask) => Promise<void>,
): Promise<void> {
  const running = new Set<Promise<void>>()
  let nextStart = 0
  const start = async (task: CrawlTask) => {
    if (options.delayMs) {
      const now = Date.now()
      const at = Math.max(now, nextStart)
      nextStart = at + options.delayMs
      if (at > now) await sleep(at - now)
    }
    try {
      await visit(task)
    } catch (error) {
      frontier.skip(task, 'error', errorMessage(error))
    }
  }
  for (;;) {
    while (running.size < Math.max(1, options.concurrency)) {
      const task = frontier.next()
      if (!task) break
      const run: Promise<void> = start(task).finally(() => running.delete(run))
      running.add(run)
    }
    if (running.size === 0) return
    await Promise.race([...running, frontier.changed()])
  }
}

/** Every link on the rendered page, including the ones a script added: `<a href>` and `<area href>`, resolved against the base URL. */
export async function pageLinks(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const links: string[] = []
    for (const element of Array.from(document.querySelectorAll('a[href], area[href]'))) {
      if (element.hasAttribute('download')) continue
      try {
        links.push(new URL(element.getAttribute('href') ?? '', document.baseURI).href)
      } catch {
        // Not a valid address.
      }
    }
    return links
  })
}

const MAX_REDIRECTS = 10

/**
 * GETs robots.txt, sitemaps and start pages with the browser's session (its
 * cookies and storage state). Redirects are followed one by one, so --header
 * values go to the site and nowhere else.
 */
export function siteFetcher(context: BrowserContext, browserOptions: BrowserOptions, sites: readonly URL[], timeoutMs = 30_000): FetchBytes {
  return async (url) => {
    let current = url
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      try {
        const response = await context.request.get(current, {
          headers: headersFor(current, sites, browserOptions),
          timeout: timeoutMs,
          maxRedirects: 0,
          failOnStatusCode: false,
        })
        const location = response.headers().location
        if (response.status() >= 300 && response.status() < 400 && location) {
          await response.dispose()
          current = new URL(location, current).href
          continue
        }
        return { status: response.status(), url: current, body: await response.body() }
      } catch (error) {
        return { status: 0, url: current, body: new Uint8Array(), error: errorMessage(error) }
      }
    }
    return { status: 0, url: current, body: new Uint8Array(), error: `more than ${MAX_REDIRECTS} redirects` }
  }
}

/** One site of a crawl: its origin, its robots.txt and the start pages that belong to it. */
export interface SiteStart {
  origin: string
  robotsUrl: string
  robots: Robots
  /** Each start page as given, and where it led after redirects. */
  starts: Array<{ requested: string; url: string }>
  skipped: CrawlSkip[]
}

/**
 * Groups the start URLs into sites. robots.txt is read before any page: a
 * start page it disallows is not loaded. A start page that redirects to its
 * www. twin or from http to https moves its site there; one that redirects to
 * another host (a login provider, say) is reported and not followed.
 */
export async function resolveSites(urls: readonly string[], fetch: FetchBytes): Promise<SiteStart[]> {
  const sites = new Map<string, Promise<SiteStart>>()
  const siteFor = (origin: string): Promise<SiteStart> => {
    let site = sites.get(origin)
    if (!site) {
      const robotsUrl = `${origin}/robots.txt`
      site = fetch(robotsUrl).then((response) => ({
        origin,
        robotsUrl,
        robots: robotsFromResponse(response.status, Buffer.from(response.body).toString('utf8'), response.error),
        starts: [],
        skipped: [],
      }))
      sites.set(origin, site)
    }
    return site
  }

  for (const raw of urls) {
    const requested = pageUrl(raw)
    if (!requested) throw new RampaError('crawl-target', `--crawl needs http(s) URLs; got ${raw}. A folder target already checks every .html file in it.`)
    const first = await siteFor(requested.origin)
    if (!robotsAllows(first.robots, requested)) {
      first.skipped.push({ url: requested.href, reason: 'robots', detail: first.robots.detail })
      continue
    }
    const response = await fetch(requested.href)
    const landed = pageUrl(response.url) ?? requested
    if (landed.origin === requested.origin) {
      first.starts.push({ requested: requested.href, url: landed.href })
      continue
    }
    if (!sameSite(requested, landed)) {
      first.skipped.push({ url: requested.href, reason: 'off-site', detail: landed.href })
      continue
    }
    const moved = await siteFor(landed.origin)
    if (!robotsAllows(moved.robots, landed)) {
      moved.skipped.push({ url: landed.href, reason: 'robots', detail: `← ${requested.href}` })
      continue
    }
    moved.starts.push({ requested: requested.href, url: landed.href })
  }
  const resolved = await Promise.all(sites.values())
  // A site whose only start page redirected to its twin has nothing of its own to report.
  return resolved.filter((site) => site.starts.length > 0 || site.skipped.length > 0)
}

/** Where to read the page list: the sitemap given, else the ones robots.txt names, else /sitemap.xml. */
export function sitemapLocations(option: boolean | string, site: SiteStart): string[] {
  if (typeof option === 'string') {
    try {
      return [new URL(option, `${site.origin}/`).href]
    } catch {
      throw new RampaError('invalid-sitemap', `--sitemap must be a URL or a path on the site, such as /sitemap.xml. Got "${option}".`)
    }
  }
  return site.robots.sitemaps.length > 0 ? [...new Set(site.robots.sitemaps)] : [`${site.origin}/sitemap.xml`]
}
