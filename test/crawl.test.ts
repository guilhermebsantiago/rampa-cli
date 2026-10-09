import { describe, expect, it } from 'vitest'
import {
  type CrawlOptions,
  type CrawlTask,
  Frontier,
  type SiteStart,
  crawlRequested,
  pageKey,
  pageUrl,
  parseCrawlFlags,
  resolveSites,
  runCrawl,
  sitemapLocations,
  urlFilter,
} from '../src/surfaces/crawl.ts'
import { parseRobots } from '../src/surfaces/robots.ts'
import type { FetchBytes } from '../src/surfaces/sitemap.ts'

const ORIGIN = 'https://example.com'
const u = (path: string) => `${ORIGIN}${path}`
const noRules = parseRobots('')
const options = (extra: Partial<CrawlOptions> = {}): CrawlOptions => ({
  maxPages: 10,
  maxDepth: undefined,
  sitemap: false,
  include: [],
  exclude: [],
  ignoreQuery: false,
  concurrency: 2,
  ...extra,
})

function drain(frontier: Frontier): CrawlTask[] {
  const tasks: CrawlTask[] = []
  for (let task = frontier.next(); task; task = frontier.next()) tasks.push(task)
  return tasks
}

describe('page addresses', () => {
  it('strip fragments and trailing slashes, and the query only with --ignore-query', () => {
    const key = (raw: string, ignoreQuery = false) => pageKey(pageUrl(raw) as URL, ignoreQuery)
    expect(key('https://Example.com:443/about/#team')).toBe('https://example.com/about')
    expect(key('https://example.com/about')).toBe(key('https://example.com/about//'))
    expect(key('https://example.com')).toBe('https://example.com/')
    expect(key('https://example.com/blog?page=2')).toBe('https://example.com/blog?page=2')
    expect(key('https://example.com/blog/?page=2', true)).toBe('https://example.com/blog')
  })

  it('are web pages only', () => {
    expect(pageUrl('mailto:hi@example.com')).toBeUndefined()
    expect(pageUrl('javascript:void(0)')).toBeUndefined()
    expect(pageUrl('tel:+558500000000')).toBeUndefined()
    expect(pageUrl('/docs#install', 'https://example.com/a/')?.href).toBe('https://example.com/docs')
  })
})

describe('--include and --exclude', () => {
  const matches = (patterns: string[], path: string) => urlFilter(patterns, ORIGIN)?.(new URL(path, ORIGIN))

  it('read patterns as robots.txt does: a prefix, * and $', () => {
    expect(matches(['/blog'], '/blog/post')).toBe(true)
    expect(matches(['/blog'], '/blogger')).toBe(true)
    expect(matches(['/blog/'], '/blogger')).toBe(false)
    expect(matches(['/*.html$'], '/a/b.html')).toBe(true)
    expect(matches(['/*.html$'], '/a/b.html?x=1')).toBe(false)
  })

  it('match a pattern without a leading slash anywhere, and read a full URL of the site as its path', () => {
    expect(matches(['logout'], '/account/logout?next=/')).toBe(true)
    expect(matches([`${ORIGIN}/docs/`], '/docs/install')).toBe(true)
    expect(matches(['https://other.example/docs/'], '/docs/install')).toBe(false)
    expect(urlFilter([], ORIGIN)).toBeUndefined()
  })
})

describe('crawl flags', () => {
  it('need --crawl or --sitemap', () => {
    expect(crawlRequested({})).toBe(false)
    expect(crawlRequested({ crawl: true })).toBe(true)
    expect(crawlRequested({ sitemap: true })).toBe(true)
    expect(() => crawlRequested({ maxPages: '5' })).toThrow('--max-pages only applies with --crawl or --sitemap.')
    expect(() => crawlRequested({ include: ['/a'], ignoreQuery: true })).toThrow('--include, --ignore-query only apply with --crawl or --sitemap.')
  })

  it('default to 10 pages, two at a time, following links with no depth limit', () => {
    expect(parseCrawlFlags({ crawl: true })).toEqual(options())
    expect(parseCrawlFlags({ sitemap: true }).sitemap).toBe(true)
    expect(parseCrawlFlags({ crawl: true, sitemap: ' /sm.xml ' }).sitemap).toBe('/sm.xml')
    expect(parseCrawlFlags({ crawl: true, maxPages: '3', maxDepth: '0', crawlConcurrency: '1' })).toMatchObject({ maxPages: 3, maxDepth: 0, concurrency: 1 })
  })

  it('reject numbers that make no sense, and a depth with a sitemap', () => {
    expect(() => parseCrawlFlags({ crawl: true, maxPages: '0' })).toThrow('--max-pages must be a whole number of at least 1. Got "0".')
    expect(() => parseCrawlFlags({ crawl: true, maxDepth: '-1' })).toThrow('--max-depth')
    expect(() => parseCrawlFlags({ crawl: true, crawlConcurrency: 'two' })).toThrow('--crawl-concurrency')
    expect(() => parseCrawlFlags({ sitemap: true, maxDepth: '2' })).toThrow('--max-depth applies when following links')
  })

  it('stop when Git Bash has turned a path pattern into a Windows path, instead of matching nothing', () => {
    expect(() => parseCrawlFlags({ crawl: true, include: ['C:/Program Files/Git/blog/'] })).toThrow('MSYS_NO_PATHCONV=1')
    expect(() => parseCrawlFlags({ crawl: true, exclude: ['D:\\admin'] })).toThrow('--exclude got "D:\\admin"')
    expect(() => parseCrawlFlags({ sitemap: 'C:/Program Files/Git/sitemap.xml' })).toThrow('--sitemap got')
    expect(parseCrawlFlags({ crawl: true, include: ['*/blog/', '/docs'] }).include).toEqual(['*/blog/', '/docs'])
  })
})

describe('Frontier', () => {
  it('queues each page once, breadth first, on the same origin only', () => {
    const frontier = new Frontier(ORIGIN, noRules, options())
    frontier.offer([u('/')], 0, undefined, true)
    frontier.offer([u('/a'), u('/a/'), u('/a#x'), 'https://other.example/', 'http://example.com/b', u('/b'), 'mailto:x@example.com'], 1, u('/'))
    expect(drain(frontier).map((task) => [task.url, task.depth, task.index])).toEqual([
      [u('/'), 0, 0],
      [u('/a'), 1, 1],
      [u('/b'), 1, 2],
    ])
  })

  it('never queues files, and filters links but not start pages', () => {
    const frontier = new Frontier(ORIGIN, noRules, options({ include: ['/docs'], exclude: ['/docs/old'] }))
    frontier.offer([u('/')], 0, undefined, true)
    frontier.offer([u('/docs/a'), u('/docs/old/b'), u('/blog'), u('/docs/guide.pdf'), u('/docs/logo.SVG')], 1, u('/'))
    expect(drain(frontier).map((task) => task.url)).toEqual([u('/'), u('/docs/a')])
  })

  it('records once each page robots.txt disallows, with the page that links to it', () => {
    const frontier = new Frontier(ORIGIN, parseRobots('User-agent: *\nDisallow: /private/'), options())
    frontier.offer([u('/private/a'), u('/private/a')], 1, u('/'))
    frontier.offer([u('/private/a')], 1, u('/other'))
    expect(frontier.skipped).toEqual([{ url: u('/private/a'), reason: 'robots', from: u('/') }])
    expect(drain(frontier)).toEqual([])
  })

  it('stops at --max-pages and counts what it left', () => {
    const frontier = new Frontier(ORIGIN, noRules, options({ maxPages: 2 }))
    frontier.offer([u('/'), u('/a'), u('/b'), u('/c')], 0, undefined, true)
    expect(drain(frontier)).toHaveLength(2)
    expect(frontier.loaded).toBe(2)
    expect(frontier.notLoaded).toBe(2)
  })

  it('leaves pages beyond --max-depth, unless they turn up again closer to a start page', () => {
    const frontier = new Frontier(ORIGIN, noRules, options({ maxDepth: 1 }))
    frontier.offer([u('/deep'), u('/deeper')], 2, u('/a'))
    expect(frontier.beyondDepth).toBe(2)
    frontier.offer([u('/deep')], 1, u('/'))
    expect(drain(frontier).map((task) => task.url)).toEqual([u('/deep')])
    expect(frontier.beyondDepth).toBe(1)
    expect(frontier.notLoaded).toBe(1)
  })

  it('decides after loading, from the final address, the status and the content type', () => {
    const frontier = new Frontier(ORIGIN, parseRobots('User-agent: *\nDisallow: /private/'), options())
    frontier.offer(['/', '/old', '/moved', '/x', '/y', '/z', '/plain'].map(u), 0, undefined, true)
    const tasks = drain(frontier)
    const task = (index: number) => tasks[index] as CrawlTask
    expect(frontier.arrived(task(0), u('/'), 200, 'text/html; charset=utf-8')).toBeUndefined()
    expect(frontier.arrived(task(1), u('/'), 200, 'text/html')).toBe('duplicate')
    expect(frontier.arrived(task(2), u('/private/p'), 200, 'text/html')).toMatchObject({ reason: 'robots', detail: `→ ${u('/private/p')}` })
    expect(frontier.arrived(task(3), 'https://login.example.net/', 200, 'text/html')).toMatchObject({ reason: 'off-site', detail: 'https://login.example.net/' })
    expect(frontier.arrived(task(4), u('/y'), 404, 'text/html')).toMatchObject({ reason: 'http', detail: 'HTTP 404' })
    expect(frontier.arrived(task(5), u('/z'), 200, 'application/pdf')).toMatchObject({ reason: 'not-html', detail: 'application/pdf' })
    expect(frontier.arrived(task(6), u('/plain'), 200, undefined)).toBeUndefined()
  })

  it('does not load a queued page again once a redirect brought the crawl there', () => {
    const frontier = new Frontier(ORIGIN, noRules, options())
    frontier.offer([u('/old'), u('/new')], 0, undefined, true)
    const old = frontier.next() as CrawlTask
    expect(frontier.arrived(old, u('/new/'), 200, 'text/html')).toBeUndefined()
    expect(frontier.next()).toBeUndefined()
  })
})

describe('runCrawl', () => {
  it('keeps at most --crawl-concurrency pages loading, and starts on links before the page that has them is done', async () => {
    const frontier = new Frontier(ORIGIN, noRules, options())
    frontier.offer([u('/')], 0, undefined, true)
    let inFlight = 0
    let most = 0
    const events: string[] = []
    await runCrawl(frontier, { concurrency: 2 }, async (task) => {
      inFlight++
      most = Math.max(most, inFlight)
      events.push(`start ${new URL(task.url).pathname}`)
      if (task.depth === 0) frontier.offer([u('/a'), u('/b'), u('/c')], 1, task.url)
      await new Promise((resolve) => setTimeout(resolve, 20))
      events.push(`end ${new URL(task.url).pathname}`)
      inFlight--
    })
    expect(most).toBe(2)
    expect(events.indexOf('start /a')).toBeLessThan(events.indexOf('end /'))
    expect(events.filter((event) => event.startsWith('start'))).toHaveLength(4)
  })

  it('records a page whose visit fails, and goes on', async () => {
    const frontier = new Frontier(ORIGIN, noRules, options())
    frontier.offer([u('/'), u('/b')], 0, undefined, true)
    const visited: string[] = []
    await runCrawl(frontier, { concurrency: 1 }, async (task) => {
      visited.push(task.url)
      if (task.url === u('/')) throw new Error('boom')
    })
    expect(visited).toEqual([u('/'), u('/b')])
    expect(frontier.skipped).toEqual([{ url: u('/'), reason: 'error', detail: 'boom' }])
  })

  it('starts page loads at least a Crawl-delay apart', async () => {
    const frontier = new Frontier(ORIGIN, noRules, options())
    frontier.offer([u('/'), u('/a'), u('/b')], 0, undefined, true)
    const starts: number[] = []
    await runCrawl(frontier, { concurrency: 3, delayMs: 60 }, async () => {
      starts.push(Date.now())
    })
    expect(starts).toHaveLength(3)
    expect((starts[2] as number) - (starts[0] as number)).toBeGreaterThanOrEqual(110)
  })
})

function fetchFrom(responses: Record<string, { status: number; body?: string; url?: string }>, asked: string[] = []): FetchBytes {
  return async (url) => {
    asked.push(url)
    const response = responses[url] ?? { status: 404 }
    return { status: response.status, url: response.url ?? url, body: new TextEncoder().encode(response.body ?? '') }
  }
}

describe('resolveSites', () => {
  it('reads robots.txt before any page, and does not load a start page it disallows', async () => {
    const asked: string[] = []
    const [site] = await resolveSites([u('/')], fetchFrom({ [u('/robots.txt')]: { status: 200, body: 'User-agent: *\nDisallow: /' } }, asked))
    expect(site?.starts).toEqual([])
    expect(site?.skipped).toEqual([{ url: u('/'), reason: 'robots' }])
    expect(asked).toEqual([u('/robots.txt')])
  })

  it('moves the site to its www. twin or to https when the start page redirects there', async () => {
    const sites = await resolveSites(
      ['http://example.com/'],
      fetchFrom({
        'http://example.com/': { status: 200, url: 'https://www.example.com/' },
        'https://www.example.com/robots.txt': { status: 200, body: 'User-agent: *\nCrawl-delay: 1\n' },
      }),
    )
    expect(sites).toHaveLength(1)
    expect(sites[0]).toMatchObject({ origin: 'https://www.example.com', starts: [{ requested: 'http://example.com/', url: 'https://www.example.com/' }] })
    expect(sites[0]?.robots.crawlDelaySeconds).toBe(1)
  })

  it('does not follow a start page to another host, such as a login provider', async () => {
    const [site] = await resolveSites(['https://app.example.com/'], fetchFrom({ 'https://app.example.com/': { status: 200, url: 'https://login.example.net/authorize' } }))
    expect(site?.starts).toEqual([])
    expect(site?.skipped).toEqual([{ url: 'https://app.example.com/', reason: 'off-site', detail: 'https://login.example.net/authorize' }])
  })

  it('crawls nothing when robots.txt cannot be read', async () => {
    const [site] = await resolveSites([u('/')], fetchFrom({ [u('/robots.txt')]: { status: 503 } }))
    expect(site?.robots.status).toBe('unreachable')
    expect(site?.skipped).toEqual([{ url: u('/'), reason: 'robots', detail: 'HTTP 503' }])
  })

  it('takes web addresses only', async () => {
    await expect(resolveSites(['./dist'], fetchFrom({}))).rejects.toThrow('--crawl needs http(s) URLs')
  })
})

describe('sitemapLocations', () => {
  const site = (sitemaps: string[]): SiteStart => ({ origin: ORIGIN, robotsUrl: u('/robots.txt'), robots: { ...noRules, sitemaps }, starts: [], skipped: [] })

  it('uses the sitemap given, then the ones robots.txt names, then /sitemap.xml', () => {
    expect(sitemapLocations('/sitemap_index.xml', site([]))).toEqual([u('/sitemap_index.xml')])
    expect(sitemapLocations('https://cdn.example.net/s.xml', site([]))).toEqual(['https://cdn.example.net/s.xml'])
    expect(sitemapLocations(true, site([u('/a.xml'), u('/a.xml')]))).toEqual([u('/a.xml')])
    expect(sitemapLocations(true, site([]))).toEqual([u('/sitemap.xml')])
  })
})
