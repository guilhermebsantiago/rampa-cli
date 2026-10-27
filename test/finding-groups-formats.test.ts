import { readFileSync } from 'node:fs'
import { afterAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { exitCode, failingFindings } from '../src/cli/exit-code.ts'
import { type SitePage, type SiteReport, summarizeSite } from '../src/core/site.ts'
import { findingGroups } from '../src/core/groups.ts'
import type { Finding, Report } from '../src/core/types.ts'
import { AXE_TAGS, axeSource } from '../src/engine/axe.ts'
import { CheckResultSchema, checkResult, checkText, memberFindings } from '../src/mcp/format.ts'
import { paint } from '../src/report/color.ts'
import { formatReports } from '../src/report/formats.ts'
import { renderHtml } from '../src/report/html.ts'
import { renderMarkdown } from '../src/report/markdown.ts'
import { renderReport } from '../src/report/pretty.ts'
import { toSarif } from '../src/report/sarif.ts'
import { renderSiteReport } from '../src/report/site.ts'
import { describeConditions } from '../src/surfaces/browser-options.ts'
import { launchBrowser } from '../src/surfaces/web.ts'
import { burstReport, judged } from './group-fixtures.ts'
import { asRemote, recordedReport } from './report-fixtures.ts'

const plain = { verbose: false, paint: paint(false) }
const EXAMPLE = 'The link text "Click here" does not tell where the link goes, and nothing around it does.'
const occurrences = (text: string, part: string) => text.split(part).length - 1
const burstIds = (report: Report) => report.findings.filter((finding) => finding.criterion === '2.4.4').map((finding) => finding.fingerprint)

/** The burst moved below the confidence threshold: a group of that list, which only --verbose and --fail-on any show. */
async function belowBurst(): Promise<Report> {
  const report = await burstReport()
  const burst = report.findings.filter((finding) => finding.criterion === '2.4.4').map((finding): Finding => ({ ...finding, confidence: 'low' }))
  return { ...report, findings: report.findings.filter((finding) => finding.criterion !== '2.4.4'), belowThreshold: burst }
}

describe('a group in the terminal report', () => {
  it('shows one entry with the count, one example and every element with its id', async () => {
    const report = await burstReport()
    const text = renderReport(report, plain)
    expect(occurrences(text, '8 near-identical findings, grouped to review together')).toBe(1)
    expect(text).toContain('Same check (judgment/2.4.4) and same claim (generic) on 8 elements of this page, so a person can review them together.')
    expect(text).toContain('Each one is a finding of its own, checked and counted like any other.')
    expect(occurrences(text, EXAMPLE)).toBe(1)
    expect(text).toContain('Example: html > body > main > p:nth-of-type(2) > a')
    for (const id of burstIds(report)) expect(text).toContain(`id ${id}`)
    expect(text).toContain(`group ${findingGroups(report)[0]?.id}`)
    // The group says what it is and never that its members count less, or that anything passes.
    const block = text.slice(text.indexOf('8 near-identical'), text.indexOf(`group ${findingGroups(report)[0]?.id}`))
    expect(block).not.toMatch(/pass|accessible|compliant|fewer|less|only one|skipped|not checked/i)
  })

  it('lists the first ten elements, and all of them with --verbose', async () => {
    const report = await burstReport({ count: 13 })
    const short = renderReport(report, plain)
    expect(short).toContain('…and 3 more; --verbose lists them all')
    const ids = burstIds(report)
    expect(ids.filter((id) => short.includes(`id ${id}`))).toHaveLength(10)
    const long = renderReport(report, { ...plain, verbose: true })
    expect(ids.every((id) => long.includes(`id ${id}`))).toBe(true)
    expect(long).not.toContain('more; --verbose lists them all')
  })

  it('marks a group below the threshold as such, under --verbose only', async () => {
    const report = await belowBurst()
    expect(renderReport(report, plain)).not.toContain('near-identical')
    const text = renderReport(report, { ...plain, verbose: true })
    expect(text).toContain('~ 8 near-identical findings, grouped to review together')
    expect(text).toContain('below the confidence threshold (medium)')
  })

  it('speaks Portuguese with the CLI\'s own words', async () => {
    const text = renderReport(await burstReport({ locale: 'pt-BR' }), plain)
    expect(text).toContain('8 achados quase idênticos, agrupados para revisar juntos')
    expect(text).toContain('Mesma verificação (judgment/2.4.4) e mesma alegação (generic) em 8 elementos desta página, para uma pessoa revisar juntos.')
    expect(text).toContain('Cada um é um achado próprio, verificado e contado como qualquer outro.')
    expect(text).toContain('Exemplo: html > body > main > p:nth-of-type(2) > a')
    expect(text).toContain('8 elementos:')
    expect(renderReport(await burstReport({ locale: 'pt-BR', count: 12 }), plain)).toContain('…e mais 2; o --verbose lista todos')
  })
})

describe('a group in JSON', () => {
  const schema = JSON.parse(readFileSync('schema/report.schema.json', 'utf8')) as Parameters<typeof z.fromJSONSchema>[0]
  const validator = z.fromJSONSchema(schema)
  const valid = (value: unknown) => {
    const result = validator.safeParse(value)
    if (!result.success) throw new Error(JSON.stringify(result.error.issues.slice(0, 5), null, 2))
  }

  it('adds the groups and keeps every finding exactly as it was', async () => {
    const report = await burstReport()
    const json = JSON.parse(formatReports('json', [report], plain))
    expect(json.schemaVersion).toBe(1)
    expect(json.findings).toEqual(JSON.parse(JSON.stringify(report.findings)))
    expect(json.findings).toHaveLength(16)
    expect(json.groups).toEqual([
      {
        id: expect.stringMatching(/^g-[0-9a-f]{12}$/),
        list: 'findings',
        criterion: '2.4.4',
        level: 'A',
        source: 'judgment',
        check: 'judgment/2.4.4',
        claim: 'generic',
        count: 8,
        members: burstIds(report),
        example: burstIds(report)[0],
      },
    ])
    // Every member names a finding of the list the group says.
    const ids = new Set(json.findings.map((finding: Finding) => finding.fingerprint))
    expect(json.groups[0].members.every((id: string) => ids.has(id))).toBe(true)
  })

  it('validates against schema/report.schema.json, one page or several, with groups or none', async () => {
    const burst = JSON.parse(formatReports('json', [await burstReport()], plain))
    const recorded = (await recordedReport()).report
    const several = JSON.parse(formatReports('json', [await burstReport(), recorded, await belowBurst()], plain))
    valid(burst)
    valid(several)
    valid(JSON.parse(formatReports('json', [recorded], plain)))
    expect(several.map((page: Report) => page.groups?.map((group) => group.list))).toEqual([['findings'], undefined, ['belowThreshold']])
    // A broken group fails it, so the check above means something.
    valid({ ...burst, groups: [] })
    expect(validator.safeParse({ ...burst, groups: [{ ...burst.groups[0], count: 3 }] }).success).toBe(false)
    expect(validator.safeParse({ ...burst, groups: [{ ...burst.groups[0], id: burst.groups[0].members[0] }] }).success).toBe(false)
    expect(validator.safeParse({ ...burst, schemaVersion: 2 }).success).toBe(false)
  })
})

describe('a group and the exit code', () => {
  it('fails the run as its members would: each one counts, and --fail-on keeps its meaning', async () => {
    const report = await burstReport()
    const { groups: _groups, ...ungrouped } = report
    expect(exitCode([report], 'confirmed')).toBe(1)
    expect(failingFindings([report], 'confirmed')).toHaveLength(16)
    expect(failingFindings([report], 'confirmed')).toEqual(failingFindings([ungrouped as Report], 'confirmed'))
    // Below the threshold, the group fails only --fail-on any, as its members do.
    const below = await belowBurst()
    expect(failingFindings([{ ...below, findings: [] }], 'confirmed')).toEqual([])
    expect(exitCode([{ ...below, findings: [] }], 'confirmed')).toBe(0)
    expect(exitCode([{ ...below, findings: [] }], 'any')).toBe(1)
    expect(failingFindings([{ ...below, findings: [] }], 'any')).toHaveLength(8)
  })
})

describe('a group in SARIF', () => {
  it('is one result at its example, with every member a related location', async () => {
    const report = await burstReport()
    const results = toSarif([report]).runs[0]?.results ?? []
    expect(results).toHaveLength(16 - 8 + 1)
    const grouped = results.filter((result) => result.relatedLocations)
    expect(grouped).toHaveLength(1)
    const [result] = grouped
    if (!result) throw new Error('no group result')
    expect(result.ruleId).toBe('WCAG-2.4.4')
    expect(result.level).toBe('error')
    expect(result.locations).toHaveLength(1)
    expect(result.locations[0]?.physicalLocation.region?.startLine).toBe(31)
    expect(result.relatedLocations?.map((location) => location.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(result.relatedLocations?.map((location) => location.logicalLocations?.[0]?.fullyQualifiedName)).toEqual(report.findings.filter((f) => f.criterion === '2.4.4').map((f) => f.ref))
    expect(result.fixes).toBeUndefined()
    const text = result.message.text
    expect(text.startsWith('8 near-identical findings, grouped to review together. Same check (judgment/2.4.4) and same claim (generic)')).toBe(true)
    expect(text).toContain(`Example: ${EXAMPLE}`)
    expect(text).toContain('[examples/store/before.html:31](1), [html > body > footer > ul > li:nth-of-type(1) > a](2)')
    for (const id of burstIds(report)) expect(text).toContain(id)
    expect(result.properties).toMatchObject({ failsGate: true, findingIds: burstIds(report), group: { check: 'judgment/2.4.4', claim: 'generic', count: 8, list: 'findings' } })
    expect(result.properties).not.toHaveProperty('patch')
    expect(toSarif([report]).runs[0]?.properties.coverage).toMatchObject([{ groups: [{ criterion: '2.4.4', count: 8 }] }])
  })

  it('takes the strictest level of its members, as the gate does', async () => {
    const report = await burstReport()
    const level = (log: ReturnType<typeof toSarif>) => log.runs[0]?.results.find((result) => result.relatedLocations)?.level
    expect(level(toSarif([report], { failOn: 'none' }))).toBe('warning')
    const below = await belowBurst()
    expect(level(toSarif([below]))).toBeUndefined()
    expect(level(toSarif([below], { verbose: true }))).toBe('note')
    expect(level(toSarif([below], { failOn: 'any' }))).toBe('error')
    // One member that fails the gate makes the group fail it, even when the others would not.
    const others = report.findings.map((finding) => (finding.criterion === '2.4.4' && finding.fingerprint !== burstIds(report)[3] ? { ...finding, beyondTarget: true } : finding))
    const one = toSarif([{ ...report, findings: others }]).runs[0]?.results.find((result) => result.relatedLocations)
    expect(one?.level).toBe('error')
    expect(one?.properties.failsGate).toBe(true)
    const none = report.findings.map((finding) => (finding.criterion === '2.4.4' ? { ...finding, beyondTarget: true } : finding))
    expect(level(toSarif([{ ...report, findings: none }]))).toBe('warning')
  })

  it('validates against the official SARIF 2.1.0 schema', async () => {
    const sarifSchema = JSON.parse(readFileSync('test/fixtures/sarif-schema-2.1.0.json', 'utf8'))
    const strip = (value: unknown): unknown =>
      Array.isArray(value)
        ? value.map(strip)
        : value && typeof value === 'object'
          ? Object.fromEntries(Object.entries(value).filter(([key, item]) => !(key === 'format' && item === 'uri-reference')).map(([key, item]) => [key, strip(item)]))
          : value
    const validator = z.fromJSONSchema(strip(sarifSchema) as Parameters<typeof z.fromJSONSchema>[0])
    for (const log of [toSarif([await burstReport()]), toSarif([await burstReport({ count: 30 }), await belowBurst()], { verbose: true })]) {
      const result = validator.safeParse(log)
      if (!result.success) throw new Error(JSON.stringify(result.error.issues.slice(0, 5), null, 2))
    }
  })
})

describe('a group in Markdown', () => {
  it('is one block with the count, an example and every element folded', async () => {
    const report = await burstReport()
    const markdown = renderMarkdown([report])
    expect(markdown).toContain('**16 confirmed findings** on 1 page checked against WCAG 2.2 A/AA: 13 at Level A, 3 at Level AA. 8 of them are in 1 group of near-identical findings, listed once.')
    expect(occurrences(markdown, 'near-identical findings, grouped to review together')).toBe(1)
    expect(occurrences(markdown, EXAMPLE)).toBe(1)
    expect(markdown).toContain(
      '**[WCAG 2.4.4 (A)](https://www.w3.org/WAI/WCAG22/Understanding/link-purpose-in-context.html "Link Purpose (In Context)")** — **8 near-identical findings, grouped to review together**\\',
    )
    expect(markdown).toContain('Example — `examples/store/before.html:31`:\\\nThe link text')
    expect(markdown).toContain(`<details>\n<summary>8 elements · group ${findingGroups(report)[0]?.id}</summary>\n\n- \`examples/store/before.html:31\` "Click here" · id \`1af8a73e209d\``)
    for (const id of burstIds(report)) expect(markdown).toContain(`id \`${id}\``)
    // The fold after the fifth block counts the findings it holds, every member of a group included.
    expect(markdown).toContain('<summary>11 more findings on this page</summary>')
    expect(markdown).not.toContain('\n\n\n')
  })

  it('speaks Portuguese', async () => {
    const markdown = renderMarkdown([await burstReport({ locale: 'pt-BR' })])
    expect(markdown).toContain('8 deles estão em 1 grupo de achados quase idênticos, listado uma vez.')
    expect(markdown).toContain('**8 achados quase idênticos, agrupados para revisar juntos**')
    expect(markdown).toContain('<summary>8 elementos · grupo g-')
  })
})

describe('a group in HTML', () => {
  it('is one item with the count, an example and every element in a <details>', async () => {
    const report = await burstReport()
    const html = renderHtml([report])
    expect(html).toContain('<p class="lead">16 confirmed findings on 1 page checked against WCAG 2.2 A/AA: 13 at Level A, 3 at Level AA. 8 of them are in 1 group of near-identical findings, listed once.</p>')
    expect(occurrences(html, '<li class="finding group">')).toBe(1)
    expect(html).toContain('<p class="group-title"><strong>8 near-identical findings, grouped to review together</strong></p>')
    expect(occurrences(html, 'The link text &quot;Click here&quot; does not tell where the link goes')).toBe(1)
    expect(html).toContain(`<details><summary>8 elements · group <code>${findingGroups(report)[0]?.id}</code></summary><ul class="members">`)
    for (const id of burstIds(report)) expect(html).toContain(`id <code>${id}</code>`)
    expect(renderHtml([await burstReport({ locale: 'pt-BR' })])).toContain('<p class="group-title"><strong>8 achados quase idênticos, agrupados para revisar juntos</strong></p>')
  })
})

describe('a group through MCP', () => {
  it('takes one place in the list, by its example, and lists every member', async () => {
    const report = await burstReport()
    const engine = { engine: { name: 'axe-core', version: 'test' }, rules: [] }
    const result = checkResult(report, engine)
    expect(CheckResultSchema.safeParse(result).success).toBe(true)
    expect(result.summary).toMatchObject({ findings: 16, judged: 15, left_out: 0, groups: 1 })
    expect(result.findings).toHaveLength(9)
    const example = result.findings.find((finding) => finding.group)
    expect(example).toMatchObject({ id: '1af8a73e209d', criterion: '2.4.4', group: result.groups[0]?.id })
    expect(result.groups[0]).toMatchObject({ criterion: '2.4.4', check: 'judgment/2.4.4', claim: 'generic', count: 8, example: '1af8a73e209d' })
    expect(result.groups[0]?.members.map((member) => member.id)).toEqual(burstIds(report))
    expect(result.groups[0]?.members[1]).toEqual({ id: burstIds(report)[1], selector: 'html > body > footer > ul > li:nth-of-type(1) > a', about: 'Click here' })
    // explain_finding remembers every member, not only the example.
    expect(memberFindings(report, engine, result).map((finding) => finding.id)).toEqual(burstIds(report).slice(1))
    const text = checkText(report, result)
    expect(text).toContain('8 of them are in 1 group of near-identical findings, listed once.')
    expect(occurrences(text, '8 near-identical findings, grouped to review together')).toBe(1)
    expect(occurrences(text, EXAMPLE)).toBe(1)
    for (const id of burstIds(report)) expect(text).toContain(`id ${id}`)
  })

  it('counts a group as one entry against max_findings, and its members as listed', async () => {
    const report = await burstReport()
    const result = checkResult(report, { engine: { name: 'axe-core', version: 'test' }, rules: [] }, 5)
    expect(result.findings).toHaveLength(5)
    const listed = result.findings.length - 1 + (result.groups[0]?.count ?? 0)
    expect(result.summary.left_out).toBe(16 - (result.groups.length > 0 ? listed : result.findings.length))
  })
})

describe('a group in the site view', () => {
  const page = (url: string, findings: Finding[]): SitePage => ({
    url,
    report: { ...(structuredClone(baseReport) as Report), target: url, findings },
    signatures: findings.map((finding) => `S-${finding.ref}`),
  })
  const baseReport: Report = {
    schemaVersion: 1,
    rampaVersion: 'test',
    createdAt: '2026-10-27T00:00:00.000Z',
    target: 'https://shop.test/',
    surface: 'web',
    locale: 'en',
    llm: 'on',
    engine: { name: 'axe-core', version: 'test' },
    findings: [],
    belowThreshold: [],
    waived: [],
    discarded: [],
    criteria: [],
    coverage: { engine: [], judged: ['2.4.4'], notChecked: [] },
    usage: { calls: 0, cachedCalls: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0 },
    errors: [],
  }
  const site = (pages: SitePage[]): SiteReport => ({
    schemaVersion: 1,
    kind: 'site',
    rampaVersion: 'test',
    createdAt: '2026-10-27T00:00:00.000Z',
    site: 'https://shop.test',
    start: [{ requested: 'https://shop.test/', url: 'https://shop.test/' }],
    crawl: { mode: 'links', maxPages: 3, maxDepth: undefined, concurrency: 2, include: [], exclude: [], ignoreQuery: false, robots: { url: 'https://shop.test/robots.txt', status: 'parsed', group: '*' }, sitemaps: [], sitemapErrors: [] },
    browser: describeConditions({}),
    locale: 'en',
    llm: 'on',
    engine: { name: 'axe-core', version: 'test' },
    notChecked: [],
    notLoaded: 0,
    beyondDepth: 0,
    summary: summarizeSite(pages, 0),
    pages: pages.map((entry) => entry.report),
  })
  const footer = Array.from({ length: 7 }, (_, index) => judged('2.4.4', 'ambiguous', index))
  const own = Array.from({ length: 6 }, (_, index) => judged('2.4.4', 'generic', 40 + index, { ref: `main > a:nth-of-type(${index + 1})` }))

  it('collapses a burst repeated on several pages, and one particular to a page, into one entry each', () => {
    const text = renderSiteReport(site([page('https://shop.test/', footer), page('https://shop.test/b', [...footer, ...own])]), plain)
    expect(occurrences(text, '7 near-identical findings, grouped to review together')).toBe(1)
    expect(text).toContain('Same check (judgment/2.4.4) and same claim (ambiguous) on 7 elements that repeat on the same pages, so a person')
    expect(occurrences(text, '6 near-identical findings, grouped to review together')).toBe(1)
    expect(text).toContain('Same check (judgment/2.4.4) and same claim (generic) on 6 elements of this page')
    for (const finding of own) expect(text).toContain(`id ${finding.fingerprint}`)
  })

  it('keeps five repeated judgments on their own', () => {
    const text = renderSiteReport(site([page('https://shop.test/', footer.slice(0, 5)), page('https://shop.test/b', footer.slice(0, 5))]), plain)
    expect(text).not.toContain('near-identical')
    expect(occurrences(text, 'on 2 of 2 pages')).toBe(5)
  })
})

// The report holds itself to what it reports: the group's markup too, folded parts opened.
const browser = await launchBrowser().catch(() => undefined)
afterAll(async () => browser?.close())

describe.skipIf(!browser)('a group in the HTML report, in a browser', { timeout: 30_000 }, () => {
  it('passes axe-core in light and dark mode, on a desktop and a phone', async () => {
    if (!browser) return
    const html = renderHtml([await burstReport({ count: 30 }), asRemote(await belowBurst())], { verbose: true })
    for (const colorScheme of ['light', 'dark'] as const) {
      for (const width of [1280, 320]) {
        const context = await browser.newContext({ viewport: { width, height: 800 }, colorScheme })
        const page = await context.newPage()
        await page.setContent(html)
        await page.evaluate(() => {
          for (const details of document.querySelectorAll('details')) details.open = true
        })
        await page.addScriptTag({ content: await axeSource() })
        const result = await page.evaluate(async (tags) => {
          const axe = (window as unknown as { axe: { run(context: Document, options: unknown): Promise<{ violations: Array<{ id: string }> }> } }).axe
          const { violations } = await axe.run(document, { runOnly: { type: 'tag', values: tags } })
          return { violations: violations.map((violation) => violation.id), scrolls: document.documentElement.scrollWidth > window.innerWidth }
        }, [...AXE_TAGS, 'best-practice'])
        await context.close()
        expect(result, `${colorScheme} at ${width}px`).toEqual({ violations: [], scrolls: false })
      }
    }
  })
})
