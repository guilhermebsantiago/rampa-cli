import { spawn } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { type CheckCommandOptions, runCheck } from '../src/cli/commands/check.ts'
import type { SiteReport } from '../src/core/site.ts'
import { browserForTests } from './browser.ts'
import { type FixtureOptions, type FixtureSite, startFakeJudge, startFixtureSite } from './site-fixture.ts'

// Integration: crawls a small site served on 127.0.0.1 with Chrome or Edge (or Playwright's Chromium).
const available = await browserForTests('the crawl tests').then(async (browser) => {
  await browser?.close()
  return browser !== undefined
})

const context = { locale: 'en' as const, motion: false, config: {} }
const sites: FixtureSite[] = []
afterEach(async () => {
  await Promise.all(sites.splice(0).map((site) => site.close()))
})

async function crawl(flags: Partial<CheckCommandOptions>, robots?: FixtureOptions['robots']) {
  const site = await startFixtureSite({ robots })
  sites.push(site)
  const dir = await mkdtemp(join(tmpdir(), 'rampa-crawl-'))
  const output = join(dir, 'site.json')
  const options: CheckCommandOptions = {
    criteria: '1.1.1,2.4.2,2.4.4,2.4.6,3.1.1,3.1.2',
    llm: false,
    runs: '1',
    format: 'json',
    output,
    failOn: 'confirmed',
    minConfidence: 'medium',
    cacheDir: join(dir, 'cache'),
    concurrency: '4',
    crawl: true,
    ...flags,
  }
  const code = await runCheck([`${site.origin}/`], options, context)
  const report = JSON.parse(await readFile(output, 'utf8')) as SiteReport
  const paths = report.pages.map((page) => {
    const url = new URL(page.target)
    return `${url.pathname}${url.search}`
  })
  return { code, report, site, paths }
}

describe.skipIf(!available)('rampa check --crawl', { timeout: 60_000 }, () => {
  it('follows links on the site, checks each page once, and reports what repeats on every page once', async () => {
    const { code, report, site, paths } = await crawl({})
    expect(code).toBe(1)
    expect(report.kind).toBe('site')
    expect(paths).toEqual(['/', '/about', '/pricing/', '/blog', '/blog/post-1', '/blog?page=2'])
    expect(report.summary.repeated.map((group) => [group.criterion, group.ruleId, group.pages.length])).toEqual([
      ['1.1.1', 'image-alt', 6],
      ['2.4.4', 'link-name', 6],
    ])
    expect(report.summary.pageSpecific[1]).toEqual({ url: `${site.origin}/about`, findings: [expect.any(Number)] })
    expect(report.summary.findings).toEqual({ total: 13, repeated: 12, pageSpecific: 1 })
    // Pages that fail are recorded as they finish loading, so the order can vary.
    expect(report.notChecked.map((skip) => [new URL(skip.url).pathname, skip.reason, skip.detail]).sort()).toEqual([
      ['/broken', 'http', 'HTTP 404'],
      ['/members', 'http', 'HTTP 401'],
      ['/private/secret', 'robots', undefined],
    ])
    expect(report.crawl.robots).toMatchObject({ status: 'parsed', group: '*' })

    const requested = site.paths()
    expect(requested[0]).toBe('/robots.txt')
    expect(requested).not.toContain('/private/secret')
    expect(requested).not.toContain('/report.pdf')
  })

  it('reads the pages from the sitemap instead, through an index and a gzipped file', async () => {
    const { report, site, paths } = await crawl({ crawl: undefined, sitemap: true })
    expect(paths).toEqual(['/', '/about', '/orphan', '/pricing/'])
    expect(report.crawl.mode).toBe('sitemap')
    expect(report.crawl.sitemaps).toEqual([`${site.origin}/sitemap.xml`, `${site.origin}/sitemap-pages.xml.gz`])
    expect(report.notChecked).toEqual([{ url: `${site.origin}/private/secret`, reason: 'robots', from: 'sitemap' }])
    expect(site.paths()).not.toContain('/blog')
  })

  it('stops at --max-pages and --max-depth, and says how many pages it left', async () => {
    const few = await crawl({ maxPages: '3' })
    expect(few.paths).toEqual(['/', '/about', '/pricing/'])
    expect(few.report.notLoaded).toBe(3)
    const shallow = await crawl({ maxDepth: '1' })
    expect(shallow.paths).toEqual(['/', '/about', '/pricing/', '/blog'])
    expect(shallow.report.beyondDepth).toBe(3)
  })

  it('applies --include, --exclude and --ignore-query to the links it follows', async () => {
    expect((await crawl({ include: ['/blog'] })).paths).toEqual(['/', '/blog', '/blog/post-1', '/blog?page=2'])
    expect((await crawl({ exclude: ['/blog', '/pricing'], ignoreQuery: true })).paths).toEqual(['/', '/about'])
    expect((await crawl({ include: ['/blog'], ignoreQuery: true })).paths).toEqual(['/', '/blog', '/blog/post-1'])
  })

  it('checks pages behind a sign-in with --cookie or --storage-state', async () => {
    expect((await crawl({ cookie: ['session=ok'], include: ['/members'] })).paths).toEqual(['/', '/members'])
    const dir = await mkdtemp(join(tmpdir(), 'rampa-state-'))
    const state = join(dir, 'auth.json')
    const cookie = { name: 'session', value: 'ok', domain: '127.0.0.1', path: '/', expires: -1, httpOnly: true, secure: false, sameSite: 'Lax' }
    await writeFile(state, JSON.stringify({ cookies: [cookie], origins: [] }))
    const signedIn = await crawl({ storageState: state, include: ['/members'] })
    expect(signedIn.paths).toEqual(['/', '/members'])
    expect(signedIn.report.browser).toMatchObject({ storageState: true })
  })

  it('sends --header with every request for the site, robots.txt and the start page included', async () => {
    const { site, paths } = await crawl({ header: ['X-Test: ok'], maxPages: '2' })
    expect(paths).toEqual(['/', '/about'])
    const own = site.requests.filter((request) => request.server === 'site' && ['/robots.txt', '/', '/about'].includes(request.path))
    expect(own.map((request) => request.path)).toEqual(expect.arrayContaining(['/robots.txt', '/', '/about']))
    expect(own.every((request) => request.headers['x-test'] === 'ok')).toBe(true)
  })

  it('follows the robots.txt group for Rampa, which can let it into a site closed to other crawlers', async () => {
    const { report, site, paths } = await crawl({ maxPages: '2' }, 'User-agent: *\nDisallow: /\n\nUser-agent: Rampa\nAllow: /\nDisallow: /about\n')
    expect(report.crawl.robots.group).toBe('rampa')
    expect(paths).toEqual(['/', '/pricing/'])
    expect(report.notChecked[0]).toMatchObject({ url: `${site.origin}/about`, reason: 'robots' })
    expect(site.paths()).not.toContain('/about')
  })

  it('loads nothing and exits 2 when robots.txt disallows Rampa or cannot be read', async () => {
    const blocked = await crawl({}, 'User-agent: Rampa\nDisallow: /\n\nUser-agent: *\nAllow: /\n')
    expect(blocked.code).toBe(2)
    expect(blocked.report.pages).toEqual([])
    expect(blocked.report.notChecked).toEqual([{ url: `${blocked.site.origin}/`, reason: 'robots' }])
    expect(blocked.site.paths()).toEqual(['/robots.txt'])

    const unreadable = await crawl({}, 503)
    expect(unreadable.code).toBe(2)
    expect(unreadable.report.crawl.robots).toMatchObject({ status: 'unreachable', detail: 'HTTP 503' })
    expect(unreadable.site.paths()).toEqual(['/robots.txt'])
  })

  it('asks the model once for a header link that is on every page, and counts the calls the cache saved', async () => {
    const judge = await startFakeJudge((_system, user) => {
      const name = /<link>([\s\S]*?)<\/link>/.exec(user)?.[1] ?? ''
      return name === 'Members'
        ? { promises: name, leadsTo: 'unknown', verdict: 'fail', evidence: name, problem: 'generic', suggestedText: 'Members area', confidence: 'high' }
        : { promises: name, leadsTo: 'unknown', verdict: 'pass', evidence: name, problem: 'none', suggestedText: '', confidence: 'high' }
    })
    const previous = process.env.RAMPA_OPENAI_COMPATIBLE_URL
    process.env.RAMPA_OPENAI_COMPATIBLE_URL = judge.url
    try {
      const { report } = await crawl({ llm: true, model: 'openai-compatible:fake-judge', criteria: '2.4.4' })
      expect(report.pages).toHaveLength(6)
      expect(judge.prompts.filter((prompt) => prompt.includes('<link>Members</link>'))).toHaveLength(1)
      expect(report.summary.usage.calls).toBe(judge.prompts.length)
      // Six header links on each of the five pages after the first, at least.
      expect(report.summary.usage.reusedAcrossPages).toBeGreaterThanOrEqual(30)
      const members = report.summary.repeated.find((group) => group.source === 'judgment')
      expect(members?.message).toBe('The link text "Members" does not tell where the link goes, and nothing around it does.')
      expect(members?.pages).toHaveLength(6)
      expect(members?.agreement).toEqual({ votes: 1, total: 1 })
    } finally {
      if (previous === undefined) delete process.env.RAMPA_OPENAI_COMPATIBLE_URL
      else process.env.RAMPA_OPENAI_COMPATIBLE_URL = previous
      await judge.close()
    }
  })
})

function cli(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    // Async on purpose: the fixture server answers from this process.
    const child = spawn(process.execPath, ['src/cli.ts', ...args], { env: { ...process.env, NO_COLOR: '1', RAMPA_LOCALE: 'en', RAMPA_MODEL: '' } })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })
}

describe('the rampa CLI', { timeout: 60_000 }, () => {
  it('refuses crawl options without --crawl, before starting a browser', async () => {
    const { code, stderr } = await cli(['check', 'https://example.com', '--max-pages', '2', '--exclude', '/admin'])
    expect(code).toBe(2)
    expect(stderr).toContain('--max-pages, --exclude only apply with --crawl or --sitemap.')
  })

  it.skipIf(!available)('crawls on a phone in dark mode and prints the site report', async () => {
    const site = await startFixtureSite()
    sites.push(site)
    const { code, stdout } = await cli(['check', `${site.origin}/`, '--crawl', '--no-llm', '--max-pages', '4', '--device', 'iPhone 13', '--color-scheme', 'dark'])
    expect(code).toBe(1)
    expect(stdout).toContain(`Site ${site.origin} · 4 page(s) checked`)
    expect(stdout).toContain('Browser: iPhone 13 (390×664) · dark color scheme')
    expect(stdout).toContain('on 4 of 4 pages: /, /about, /pricing/, /blog')
    expect(stdout).toContain('This report does not declare the site accessible.')
  })

  it.skipIf(!available)('writes the site summary and every page report as JSON', async () => {
    const site = await startFixtureSite()
    sites.push(site)
    const { code, stdout } = await cli(['check', `${site.origin}/`, '--sitemap', '--no-llm', '--format', 'json'])
    expect(code).toBe(1)
    const report = JSON.parse(stdout) as SiteReport
    expect(report).toMatchObject({ kind: 'site', site: site.origin, crawl: { mode: 'sitemap' } })
    expect(report.pages.map((page) => page.target)).toContain(`${site.origin}/orphan`)
    expect(report.summary.pagesChecked).toBe(report.pages.length)
  })
})
