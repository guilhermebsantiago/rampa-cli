import { mkdtemp, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { type CheckCommandOptions, runCheck } from '../src/cli/commands/check.ts'
import type { SiteReport } from '../src/core/site.ts'
import { runSiteCriteria, siteFactsOf } from '../src/site/index.ts'
import { loadSnapshot } from '../src/surfaces/targets.ts'
import { browserForTests } from './browser.ts'
import { type IdentificationSite, type IdentificationVariant, startIdentificationSite } from './identification-fixture.ts'

// Integration: crawls the identification fixture on 127.0.0.1 with Chrome or Edge, and compares its pages (3.2.4, 2.4.2, 2.4.5).
const available = await browserForTests('the consistent identification crawl tests').then(async (browser) => {
  await browser?.close()
  return browser !== undefined
})

const context = { locale: 'en' as const, motion: false, config: {} }
const sites: IdentificationSite[] = []
afterEach(async () => {
  await Promise.all(sites.splice(0).map((site) => site.close()))
})

async function crawl(variant: IdentificationVariant, flags: Partial<CheckCommandOptions> = {}) {
  const site = await startIdentificationSite(variant)
  sites.push(site)
  const dir = await mkdtemp(join(tmpdir(), 'rampa-identification-'))
  const output = join(dir, 'site.json')
  const options: CheckCommandOptions = {
    criteria: '2.4.2',
    llm: false,
    runs: '1',
    format: 'json',
    output,
    failOn: 'confirmed',
    minConfidence: 'low',
    cacheDir: join(dir, 'cache'),
    concurrency: '4',
    crawl: true,
    maxPages: '20',
    ...flags,
  }
  const code = await runCheck([`${site.origin}/`], options, context)
  const report = JSON.parse(await readFile(output, 'utf8')) as SiteReport
  const path = (url: string) => new URL(url).pathname
  return { code, report, site, path }
}

describe.skipIf(!available)('3.2.4 across the pages of a crawl', { timeout: 90_000 }, () => {
  it('finds nothing to fail or review when components keep their names, with counts and page addresses that change', async () => {
    const { report, path } = await crawl('consistent')
    const across = report.siteCriteria
    expect(across?.sets.map((set) => set.pages.map(path))).toEqual([['/', '/products', '/about', '/blog', '/sitemap', '/blog/first', '/blog/second']])
    const items = [...(across?.findings ?? []), ...(across?.belowThreshold ?? []), ...(across?.review ?? [])]
    expect(items.filter((finding) => finding.criterion === '3.2.4')).toEqual([])
    // The two blog posts share a title, and every crawl lists the ways to find its pages: both to review, never failures.
    expect(items.map((finding) => [finding.criterion, finding.status])).toEqual([
      ['2.4.2', 'review'],
      ['2.4.5', 'review'],
    ])
    expect(across?.criteria.find((c) => c.criterion === '3.2.4')?.compared).toBeGreaterThanOrEqual(15)
    const coverage = report.summary.coverage
    expect(coverage.criteria?.find((record) => record.id === '3.2.4')?.status).toBe('no-failure-found')
    expect(coverage.criteria?.find((record) => record.id === '2.4.5')?.status).toBe('needs-review')
    expect(coverage.notChecked).not.toContain('3.2.4')
    expect(coverage.notChecked).not.toContain('2.4.5')
  })

  it('fails names that share no word, sends the rest to review, and gives the same result from the saved snapshots', async () => {
    const saved = await mkdtemp(join(tmpdir(), 'rampa-identification-saved-'))
    const { code, report, site, path } = await crawl('inconsistent', { save: saved })
    expect(code).toBe(1)
    const failures = (report.siteCriteria?.findings ?? []).filter((finding) => finding.criterion === '3.2.4')
    expect(failures.map((finding) => [finding.subject, finding.items, finding.pages.map(path)])).toEqual([
      ['The link to /login?next=… in the header', ['Log in', 'Sign in'], ['/about']],
      ['The search button', ['Search', 'Find'], ['/about']],
      ['The submit button of the form to /newsletter in the footer', ['Subscribe', 'Sign up'], ['/about']],
    ])
    expect(failures[1]?.elements.find((element) => path(element.page) === '/about')?.ref).toMatch(/form > button$/)
    const review = (report.siteCriteria?.review ?? []).filter((finding) => finding.criterion === '3.2.4')
    expect(review.map((finding) => [finding.subject, finding.items])).toEqual([
      ['The button drawn with the same icon in the header', ['Menu', 'Navigation']],
      ['The control #theme-toggle in the header', ['Dark mode', 'Toggle dark mode']],
      ['The name “Privacy”', ['/privacy', '/legal/privacy']],
    ])
    expect(review[0]?.question?.kind).toBe('same-function')

    const files = (await readdir(saved)).filter((file) => file.endsWith('.snapshot.json'))
    const pages = await Promise.all(files.map(async (file) => siteFactsOf(await loadSnapshot(join(saved, file)))))
    const replay = runSiteCriteria(pages, { origin: site.origin, locale: 'en', minConfidence: 'low' })
    const ids = (list: ReadonlyArray<{ criterion: string; fingerprint: string }>) => list.filter((finding) => finding.criterion === '3.2.4').map((finding) => finding.fingerprint).sort()
    expect(ids(replay.findings)).toEqual(ids(failures))
    expect(ids(replay.review)).toEqual(ids(review))
  })
})
