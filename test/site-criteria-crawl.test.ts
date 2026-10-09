import { spawn } from 'node:child_process'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { type CheckCommandOptions, runCheck } from '../src/cli/commands/check.ts'
import type { SiteReport } from '../src/core/site.ts'
import { browserForTests } from './browser.ts'
import { type ConsistencySite, type ConsistencyVariant, startConsistencySite } from './consistency-fixture.ts'

// Integration: crawls the consistency fixture on 127.0.0.1 with Chrome or Edge, and compares its pages.
const available = await browserForTests('the site criteria crawl tests').then(async (browser) => {
  await browser?.close()
  return browser !== undefined
})

const context = { locale: 'en' as const, motion: false, config: {} }
const sites: ConsistencySite[] = []
afterEach(async () => {
  await Promise.all(sites.splice(0).map((site) => site.close()))
})

async function crawl(variant: ConsistencyVariant, flags: Partial<CheckCommandOptions> = {}, config: Record<string, unknown> = {}) {
  const site = await startConsistencySite(variant)
  sites.push(site)
  const dir = await mkdtemp(join(tmpdir(), 'rampa-site-criteria-'))
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
  const code = await runCheck([`${site.origin}/`], options, { ...context, config })
  const report = JSON.parse(await readFile(output, 'utf8')) as SiteReport
  const path = (url: string) => new URL(url).pathname
  return { code, report, site, path }
}

describe.skipIf(!available)('criteria across the pages of a crawl', { timeout: 90_000 }, () => {
  it('finds nothing on a consistent site, with a sub-navigation, an added item and a language version', async () => {
    const { report, path } = await crawl('consistent')
    const across = report.siteCriteria
    expect(across).toBeDefined()
    expect(across?.sets.map((set) => [set.lang, set.pages.map(path)])).toEqual([
      ['en', ['/', '/docs/', '/pricing', '/blog', '/contact', '/privacy', '/help', '/changelog']],
      ['pt', ['/pt/', '/pt/precos', '/pt/contato', '/pt/privacidade']],
    ])
    expect(across?.unassigned.map((entry) => [path(entry.url), entry.reason])).toEqual([['/plain', 'no-navigation']])
    expect([...(across?.findings ?? []), ...(across?.belowThreshold ?? []), ...(across?.review ?? [])]).toEqual([])
    expect(across?.criteria.map((c) => [c.criterion, c.setsCompared])).toEqual([
      ['3.2.3', 2],
      ['3.2.6', 2],
    ])
    expect(report.summary.coverage.notChecked).not.toContain('3.2.3')
  })

  it('names the page whose navigation and help changed order, with the order observed on each page', async () => {
    const { code, report, path } = await crawl('inconsistent')
    expect(code).toBe(1)
    const findings = report.siteCriteria?.findings ?? []
    expect(findings.map((finding) => [finding.criterion, finding.subject, finding.pages.map(path)])).toEqual([
      ['3.2.3', 'The navigation “Main”', ['/pricing']],
      ['3.2.6', 'The contact detail “help@acme.test” (mailto:help@acme.test)', ['/pricing']],
    ])
    expect(findings[0]?.evidence).toMatch(/^Order on \/, \/docs\/, \/blog, \/contact and \d+ more: Docs → Pricing · Order on \/pricing: Pricing → Docs$/)
    expect(findings[0]?.elements.find((element) => path(element.page) === '/pricing' && element.name === 'Docs')?.ref).toMatch(/nav/)
    expect(findings[1]?.evidence).toMatch(/^after the main content on .+ · before the main content on \/pricing$/)
    expect(report.siteCriteria?.review).toEqual([])
  })

  it('compares the sets named in the config', async () => {
    const { report, path } = await crawl('inconsistent', { include: ['/pricing', '/help'] }, { pageSets: { money: ['/pricing', '/help'] } })
    const sets = report.siteCriteria?.sets ?? []
    expect(sets[0]).toMatchObject({ id: 'config:money', source: 'config' })
    expect(sets[0]?.pages.map(path)).toEqual(['/pricing', '/help'])
    // Two pages that disagree: neither is the odd one out, so both are named.
    const nav = report.siteCriteria?.findings.find((finding) => finding.criterion === '3.2.3' && finding.set === 'config:money')
    expect(nav?.pages.map(path)).toEqual(['/pricing', '/help'])
  })
})

describe.skipIf(!available)('rampa check --crawl, across pages', { timeout: 90_000 }, () => {
  it('prints the sets and, with --verbose, the experimental findings with their evidence', async () => {
    const site = await startConsistencySite('inconsistent')
    sites.push(site)
    const { code, stdout } = await cli(['check', `${site.origin}/`, '--crawl', '--no-llm', '--max-pages', '20', '--verbose', '--criteria', '2.4.2'])
    expect(code).toBe(0)
    expect(stdout).toContain('Across pages')
    expect(stdout).toContain('Set template 2 (shared header, navigation and footer): 4 pages, pt, 1280×800: /pt/, /pt/precos, /pt/contato, /pt/privacidade')
    expect(stdout).toContain('WCAG 3.2.3 (AA) — Consistent Navigation')
    expect(stdout).toContain('✗ The navigation “Main” · experimental')
    expect(stdout).toContain('Order on /pricing: Pricing → Docs')
    expect(stdout).toContain('WCAG 3.2.6 (A) — Consistent Help')
    expect(stdout).toContain('No navigation found on: /plain')
    expect(stdout).toMatch(/Compared across pages: +3\.2\.3 \(2 set\(s\), \d+ compared\); 3\.2\.6 \(2 set\(s\), \d+ compared\)/)
  })

  it('says on a single page that 3.2.3 and 3.2.6 need a crawl', async () => {
    const site = await startConsistencySite('consistent')
    sites.push(site)
    const { stdout } = await cli(['check', `${site.origin}/`, '--no-llm', '--criteria', '2.4.2'])
    expect(stdout).toContain('Not checked on a single page: 3.2.3 Consistent Navigation and 3.2.6 Consistent Help compare the pages of a site; run with --crawl or --sitemap.')
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
