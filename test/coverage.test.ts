import { describe, expect, it } from 'vitest'
import { exitCode } from '../src/cli/exit-code.ts'
import { memoryCache } from '../src/core/cache.ts'
import { type CheckOptions, checkSnapshot } from '../src/core/check.ts'
import { mergeCoverage } from '../src/core/coverage.ts'
import type { CriterionCoverage, EngineResults, EngineRuleResult, Report } from '../src/core/types.ts'
import { languageOfParts } from '../src/criteria/language-of-parts.ts'
import { checkResult, checkText } from '../src/mcp/format.ts'
import { paint } from '../src/report/color.ts'
import { renderHtml } from '../src/report/html.ts'
import { renderMarkdown } from '../src/report/markdown.ts'
import { renderReport } from '../src/report/pretty.ts'
import { toSarif } from '../src/report/sarif.ts'
import { travelSnapshot } from './helpers.ts'

function options(extra: Partial<CheckOptions> = {}): CheckOptions {
  return { criteria: [], llm: false, provider: undefined, runs: 1, cache: memoryCache(), offline: false, locale: 'en', minConfidence: 'medium', concurrency: 1, ...extra }
}

const node = (ref: string, message?: string) => ({ ref, target: JSON.stringify([ref]), html: `<${ref}>`, message })

function rule(ruleId: string, outcome: EngineRuleResult['outcome'], criteria: string[], nodes: EngineRuleResult['nodes'] = []): EngineRuleResult {
  return { ruleId, outcome, criteria, help: `${ruleId} help`, helpUrl: `https://dequeuniversity.com/rules/axe/4.14/${ruleId}`, nodes }
}

function axe(rules: EngineRuleResult[]): EngineResults {
  return { engine: { name: 'axe-core', version: 'test' }, rules }
}

const record = (report: Report, id: string): CriterionCoverage | undefined => report.coverage.criteria?.find((r) => r.id === id)

describe('honest coverage', () => {
  const engine = axe([
    // 1.4.3: one text decided, one undecided.
    rule('color-contrast', 'pass', ['1.4.3'], [node('p.lead')]),
    rule('color-contrast', 'incomplete', ['1.4.3'], [node('h1.hero', "Fix any of the following:\n  Element's background color could not be determined due to a background image")]),
    // 2.4.1 and 1.2.2: rules that can never report a failure.
    rule('bypass', 'incomplete', ['2.4.1'], [node('html', 'Fix any of the following:\n  No valid skip link found\n  Page does not have a heading\n  Page does not have a landmark region')]),
    rule('video-caption', 'incomplete', ['1.2.2'], [node('video', 'Fix all of the following:\n  The multimedia element does not have a captions track')]),
    // 1.4.2: a rule that can never fail, with nothing to apply to.
    rule('no-autoplay-audio', 'inapplicable', ['1.4.2']),
    // 1.1.1: a failure.
    rule('image-alt', 'violation', ['1.1.1'], [node('img.logo', 'Fix any of the following:\n  Element does not have an alt attribute')]),
    // 2.2.1: a rule that can fail, with nothing to apply to.
    rule('meta-refresh', 'inapplicable', ['2.2.1']),
    // 4.1.2: decided by one rule; a review-only rule that passed does not make it a review.
    rule('button-name', 'pass', ['4.1.2'], [node('button')]),
    rule('duplicate-id-aria', 'pass', ['4.1.2'], [node('label')]),
  ])

  it('counts as checked only the criteria a rule able to fail decided, and lists the rest for review', async () => {
    const report = await checkSnapshot(travelSnapshot(), engine, options())
    expect(report.coverage.engine).toEqual(['1.1.1', '1.4.3', '4.1.2'])
    for (const id of ['1.2.2', '2.4.1']) {
      expect(report.coverage.engine).not.toContain(id)
      expect(report.coverage.notChecked).not.toContain(id)
      expect(record(report, id)?.status).toBe('needs-review')
    }
    expect(report.coverage.notChecked).toContain('1.4.2')
    expect(report.coverage.notChecked).toContain('2.2.1')
    expect(record(report, '1.4.2')).toMatchObject({ status: 'no-applicable-content', methods: [{ id: 'no-autoplay-audio', reviewOnly: true, ran: true, applicable: 0 }] })
    expect(record(report, '2.2.1')?.status).toBe('no-applicable-content')
    expect(record(report, '1.4.3')).toMatchObject({ status: 'needs-review', methods: [{ kind: 'axe', id: 'color-contrast', applicable: 2, failures: 0, review: 1, maturity: 'stable' }] })
    expect(record(report, '1.1.1')?.status).toBe('failures')
    expect(record(report, '4.1.2')?.status).toBe('no-failure-found')
    expect(record(report, '2.4.7')).toMatchObject({ status: 'not-checked', methods: [], target: 'in' })
    expect(record(report, '2.4.7')?.manual).toContain('focused element')
    expect(report.coverage.criteria).toHaveLength(55)
    expect(report.coverage.criteria?.some((r) => r.id === '4.1.1')).toBe(false)
  })

  it('turns what axe-core could not decide into review items, never findings or a failing exit code', async () => {
    const report = await checkSnapshot(travelSnapshot(), axe(engine.rules.filter((r) => r.ruleId !== 'image-alt')), options())
    expect(report.findings).toEqual([])
    expect(report.needsReview?.map((item) => [item.criterion, item.ruleId, item.ref])).toEqual([
      ['1.2.2', 'video-caption', 'video'],
      ['1.4.3', 'color-contrast', 'h1.hero'],
      ['2.4.1', 'bypass', 'html'],
    ])
    expect(report.needsReview?.[1]?.message).toBe("Element's background color could not be determined due to a background image")
    expect(report.needsReview?.[2]?.message).toBe('No valid skip link found; Page does not have a heading; Page does not have a landmark region')
    expect(exitCode([report], 'any')).toBe(0)
  })

  it('gives 4.1.1 its own status under 2.1, and leaves it out under 2.2', async () => {
    const older = await checkSnapshot(travelSnapshot(), engine, options({ wcag: '2.1' }))
    expect(record(older, '4.1.1')).toMatchObject({ status: 'satisfied-by-definition', methods: [] })
    expect(older.coverage.criteria).toHaveLength(50)
    expect(older.coverage.notChecked).not.toContain('4.1.1')
  })

  it('says when judgment did not run, and never counts a skipped judgment as checked', async () => {
    const skipped = await checkSnapshot(travelSnapshot(), axe([]), options({ criteria: [languageOfParts], llm: false }))
    expect(record(skipped, '3.1.2')).toMatchObject({ status: 'not-checked', methods: [{ kind: 'judgment', id: 'judgment/3.1.2@1', ran: false, applicable: 2 }] })
    expect(skipped.coverage.notChecked).toContain('3.1.2')
  })

  it('renders the same statuses and review items in every format, and never says passed', async () => {
    const report = await checkSnapshot(travelSnapshot(), engine, options())
    const pretty = renderReport(report, { verbose: true, paint: paint(false) })
    expect(pretty).toContain('Needs review')
    expect(pretty).toContain('WCAG 2.4.1 (A) — Bypass Blocks: 1 element · bypass')
    expect(pretty).toContain('Needs review only:              1.2.2, 2.4.1')
    expect(pretty).toMatch(/2\.4\.1 {2}needs review +axe-core bypass \(1 applicable, 0 failed, 1 to review; review only\)/)
    expect(pretty).toContain('This report does not declare the page accessible.')

    const markdown = renderMarkdown([report])
    expect(markdown).toContain('#### Needs review')
    expect(markdown).toContain('- Needs review only: 1.2.2, 2.4.1')
    expect(markdown).toContain('| 2.4.1 Bypass Blocks | needs review |')
    expect(markdown).toContain('**This report does not declare the page accessible.**')

    const html = renderHtml([report])
    expect(html).toContain('<h3>Needs review</h3>')
    expect(html).toContain('<th scope="row">2.4.1 Bypass Blocks</th><td>needs review</td>')
    expect(html).toContain('This report does not declare the page accessible.')

    const sarif = toSarif([report])
    expect(sarif.runs[0]?.results.map((r) => r.ruleId)).toEqual(['WCAG-1.1.1'])
    const coverage = (sarif.runs[0]?.properties as { coverage: Array<Record<string, unknown>> }).coverage[0]
    expect(coverage?.needsReviewOnly).toEqual(['1.2.2', '2.4.1'])
    expect(coverage?.needsReview).toContainEqual({ criterion: '2.4.1', ruleId: 'bypass', count: 1, reason: 'No valid skip link found; Page does not have a heading; Page does not have a landmark region' })

    const result = checkResult(report, engine)
    expect(result.summary.needs_review).toBe(3)
    expect(result.coverage.needs_review_only).toEqual(['1.2.2', '2.4.1'])
    expect(result.coverage.criteria.find((c) => c.id === '1.4.3')).toEqual({ id: '1.4.3', status: 'needs-review', checked_by: ['color-contrast'] })
    expect(result.needs_review.find((g) => g.criterion === '1.4.3')).toMatchObject({ rule_id: 'color-contrast', count: 1, selectors: ['h1.hero'] })
    const text = checkText(report, result)
    expect(text).toContain('Needs review:')
    expect(text).toContain('This report does not declare the page accessible.')

    // The only "passed" is the sentence that says Rampa never marks a criterion so.
    const never = 'Rampa never marks a criterion as passed'
    expect(markdown).toContain(never)
    for (const output of [pretty, markdown, html, JSON.stringify(sarif), JSON.stringify(result)]) expect(output.replaceAll(never, '')).not.toMatch(/\bpassed\b/i)
  })

  it('joins the coverage of several pages with the most telling status', async () => {
    const clean = await checkSnapshot(travelSnapshot(), axe([rule('image-alt', 'pass', ['1.1.1'], [node('img')])]), options())
    const failing = await checkSnapshot(travelSnapshot(), engine, options())
    const merged = mergeCoverage([clean, failing], '2.2')
    expect(merged.criteria?.find((r) => r.id === '1.1.1')).toMatchObject({ status: 'failures', methods: [{ id: 'image-alt', applicable: 2, failures: 1 }] })
    expect(merged.engine).toContain('1.1.1')
    expect(merged.notChecked).not.toContain('2.4.1')
  })
})
