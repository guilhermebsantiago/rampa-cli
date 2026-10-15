import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { recordBaseline } from '../src/adoption/baseline.ts'
import { COGNITIVE_CHECKS, resolveProfiles } from '../src/advisory/profile.ts'
import { exitCode, failingAdvisories } from '../src/cli/exit-code.ts'
import { memoryCache } from '../src/core/cache.ts'
import { type CheckOptions, checkSnapshot, fingerprint } from '../src/core/check.ts'
import type { EngineResults, Report } from '../src/core/types.ts'
import type { Locale } from '../src/i18n.ts'
import { checkResult, checkText } from '../src/mcp/format.ts'
import { paint } from '../src/report/color.ts'
import { coverageStatement } from '../src/report/common.ts'
import { formatReports } from '../src/report/formats.ts'
import { renderHtml } from '../src/report/html.ts'
import { renderMarkdown } from '../src/report/markdown.ts'
import { renderReport } from '../src/report/pretty.ts'
import { toSarif } from '../src/report/sarif.ts'
import { assess } from '../src/testing/format.ts'
import { testDictionaries } from './coga-helpers.ts'
import { cadastroSnapshot } from './coga-snapshot.ts'

const engine: EngineResults = { engine: { name: 'axe-core', version: 'test' }, rules: [] }

function options(extra: Partial<CheckOptions> = {}, locale: Locale = 'en'): CheckOptions {
  return {
    criteria: [],
    llm: false,
    provider: undefined,
    runs: 1,
    cache: memoryCache(),
    offline: false,
    locale,
    minConfidence: 'medium',
    concurrency: 2,
    profiles: ['cognitive'],
    coga: { dictionaries: testDictionaries },
    ...extra,
  }
}

const plain = { verbose: false, paint: paint(false) }

describe('the advisory channel', () => {
  it('leaves findings and WCAG coverage exactly as a run without the profile has them', async () => {
    const withProfile = await checkSnapshot(cadastroSnapshot(), engine, options())
    const without = await checkSnapshot(cadastroSnapshot(), engine, options({ profiles: undefined }))
    expect(withProfile.findings).toEqual(without.findings)
    expect(withProfile.belowThreshold).toEqual(without.belowThreshold)
    expect(withProfile.coverage).toEqual(without.coverage)
    expect(withProfile.criteria).toEqual(without.criteria)
    expect(without.advisory).toBeUndefined()
    expect(withProfile.schemaVersion).toBe(1)
    expect(withProfile.advisory?.results.map((advisory) => `${advisory.check} ${advisory.kind} ${advisory.subject}`)).toEqual([
      'coga/input-formats advisory postal',
      'coga/preselected-cost advisory Seguro residencial + R$ 9,90',
      'coga/visible-labels advisory Seu e-mail',
      'coga/abbreviations advisory NIS',
      // CEP is more common than its full term: not a COGA advisory, but WCAG 3.1.4 (AAA), beyond the target.
      'coga/abbreviations beyond-target CEP',
    ])
  })

  it('gives each advisory its fixed label, an impact fixed per check, evidence and a patch when there is one', async () => {
    const report = await checkSnapshot(cadastroSnapshot(), engine, options())
    const [formats, cost, labels, abbreviation] = report.advisory?.results ?? []
    expect(formats).toMatchObject({ ref: '#cep', impact: 'barrier', confidence: 'high', source: 'rule', label: 'Advisory · COGA o4p08 Accept different input formats (not a WCAG requirement)' })
    expect(formats?.patch?.after).toBe('<input id="cep" name="cep" type="text" autocomplete="postal-code" inputmode="numeric">')
    expect(cost).toMatchObject({ ref: '#seguro', impact: 'barrier', evidence: 'Seguro residencial + «R$ 9,90»' })
    expect(cost?.patch?.after).toBe('<input id="seguro" type="checkbox" name="seguro">')
    expect(labels).toMatchObject({ ref: '#email', impact: 'hurdle', basis: { framework: 'coga', pattern: 'o4p06', source: 'coga-usable 2021-04-29' } })
    expect(abbreviation).toMatchObject({ subject: 'NIS', impact: 'suggestion', kind: 'advisory' })
    // A .gov.br address is a public body: the plain-language law goes with the advisory.
    expect(abbreviation?.related).toContainEqual(expect.objectContaining({ kind: 'law', label: 'Lei 15.263/2025, art. 5º, VIII' }))
    const portuguese = await checkSnapshot(cadastroSnapshot(), engine, options({}, 'pt-BR'))
    expect(portuguese.advisory?.results[2]?.label).toBe('Recomendação · COGA o4p06 Use rótulos claros e visíveis (não é requisito da WCAG)')
    expect(portuguese.advisory?.results[3]?.message).toContain('Lei 15.263/2025')
  })

  it('never changes the exit code unless --fail-on advisory asks for it', async () => {
    const report = await checkSnapshot(cadastroSnapshot(), engine, options())
    expect(report.findings).toEqual([])
    expect(report.advisory?.results.length).toBeGreaterThan(0)
    for (const policy of ['confirmed', 'any', 'A', 'AA', 'none', 'never'] as const) expect(exitCode([report], policy)).toBe(0)
    expect(exitCode([report], 'advisory')).toBe(1)
    expect(failingAdvisories([report], 'confirmed')).toEqual([])
    const quiet: Report = { ...report, advisory: report.advisory && { ...report.advisory, results: [] } }
    expect(exitCode([quiet], 'advisory')).toBe(0)
    // A model step that failed on everything it was asked makes the run unable to vouch for itself, under advisory only.
    const broken: Report = {
      ...quiet,
      advisory: quiet.advisory && {
        ...quiet.advisory,
        checks: quiet.advisory.checks.map((check) => (check.check === 'coga/abbreviations' ? { ...check, model: { asked: 2, answered: 0, kept: 0, errors: 2 } } : check)),
      },
    }
    expect(exitCode([broken], 'advisory')).toBe(2)
    expect(exitCode([broken], 'confirmed')).toBe(0)
  })

  it('is invisible to toPassRampa, the baseline and the MCP summary', async () => {
    const report = await checkSnapshot(cadastroSnapshot(), engine, options())
    expect(assess([report]).pass).toBe(true)
    expect(recordBaseline([report]).targets).toEqual(recordBaseline([{ ...report, advisory: undefined }]).targets)
    const result = checkResult(report, engine)
    expect(result.summary.findings).toBe(0)
    expect(JSON.stringify(result)).not.toContain('coga/')
    expect(checkText(report, result)).not.toContain('COGA')
  })

  it('waives advisories by fingerprint, in a namespace of their own', async () => {
    const first = await checkSnapshot(cadastroSnapshot(), engine, options())
    const target = first.advisory?.results[2]
    expect(target?.fingerprint).toBe(fingerprint('coga/visible-labels', '#email', 'Seu e-mail'))
    expect(target?.fingerprint).not.toBe(fingerprint('3.3.2', '#email', 'Seu e-mail'))
    const waived = await checkSnapshot(cadastroSnapshot(), engine, options({ waivers: new Set([target?.fingerprint ?? '']) }))
    expect(waived.advisory?.waived.map((advisory) => advisory.ref)).toEqual(['#email'])
    expect(waived.advisory?.results.map((advisory) => advisory.ref)).not.toContain('#email')
    // An abbreviation is keyed by the page's token, not by the element of its first use.
    const again = await checkSnapshot(cadastroSnapshot(), engine, options())
    expect(again.advisory?.results.map((advisory) => advisory.fingerprint)).toEqual(first.advisory?.results.map((advisory) => advisory.fingerprint))
    expect(first.advisory?.results[3]?.fingerprint).toBe(fingerprint('coga/abbreviations', undefined, 'NIS'))
  })

  it('links a WCAG finding on the same element instead of repeating it', async () => {
    const failing: EngineResults = {
      ...engine,
      rules: [{ ruleId: 'autocomplete-valid', outcome: 'violation', criteria: ['1.3.5'], help: 'autocomplete', nodes: [{ ref: '#cep', target: '#cep', html: '<input>' }] }],
    }
    const report = await checkSnapshot(cadastroSnapshot(), failing, options())
    const finding = report.findings[0]
    expect(report.advisory?.results[0]?.related).toContainEqual({ finding: finding?.fingerprint, criterion: '1.3.5' })
  })

  it('says how many COGA patterns were screened, and that the rest were not checked', async () => {
    const report = await checkSnapshot(cadastroSnapshot(), engine, options())
    const coverage = report.advisory?.coverage
    expect(Object.keys(coverage?.patterns ?? {})).toHaveLength(58)
    expect(Object.entries(coverage?.patterns ?? {}).filter(([, status]) => status === 'screened').map(([slug]) => slug)).toEqual([
      'o3p01-clear-words',
      'o4p03-declared-charges',
      'o4p06-clear-labels',
      'o4p08-input-formats',
    ])
    expect(Object.values(coverage?.patterns ?? {})).not.toContain('passed')
    expect(coverage?.beyondTarget).toEqual(['3.1.4'])
    expect(coverage?.needsReview).toEqual(['3.1.5'])
    const pretty = renderReport(report, plain)
    expect(pretty).toContain('Screened in part: 4 of 58 design patterns: o3p01 Use Clear Words (abbreviations), o4p03')
    expect(pretty).toContain('Not checked: 54 patterns, and the rest of the ones screened in part (--verbose lists them).')
    expect(pretty).toContain('Testing with people should include people with cognitive and learning disabilities (COGA §5).')
    expect(coverageStatement(report)).toContain('4 of 58 design patterns screened in part (o3p01, o4p03, o4p06, o4p08), the rest not checked')
  })

  it('says in one coverage line that COGA was not screened when the profile is off, on web pages only', async () => {
    const report = await checkSnapshot(cadastroSnapshot(), engine, options({ profiles: undefined }))
    const line = 'Cognitive accessibility guidance (W3C COGA): not screened; --profile cognitive adds advisory checks.'
    expect(renderReport(report, plain)).toContain(line)
    expect(renderMarkdown([report])).toContain(line)
    expect(renderHtml([report])).toContain('not screened; --profile cognitive adds advisory checks.')
    expect(coverageStatement(report)).toContain('Cognitive accessibility guidance (W3C COGA): not screened')
    const portuguese = await checkSnapshot(cadastroSnapshot(), engine, options({ profiles: undefined }, 'pt-BR'))
    expect(renderReport(portuguese, plain)).toContain('Orientação de acessibilidade cognitiva (COGA do W3C): não verificada; --profile cognitive adiciona recomendações.')
    const android = await checkSnapshot({ ...cadastroSnapshot(), surface: 'android' }, engine, options({ profiles: undefined }))
    expect(renderReport(android, plain)).not.toContain('COGA')
  })

  it('reads profiles from the flag or the config, and refuses one it does not know', () => {
    expect(resolveProfiles('cognitive', undefined)).toEqual(['cognitive'])
    expect(resolveProfiles(undefined, ['cognitive', 'cognitive'])).toEqual(['cognitive'])
    expect(resolveProfiles(undefined, undefined)).toEqual([])
    expect(() => resolveProfiles(undefined, ['dyslexia'])).toThrow(/Unknown profile "dyslexia"/)
  })
})

describe('advisories in each report', () => {
  it('shows them in the terminal in their own section, with ◇ and never ✗', async () => {
    const report = await checkSnapshot(cadastroSnapshot(), engine, options())
    const pretty = renderReport(report, plain)
    const section = pretty.slice(pretty.indexOf('Advisories: cognitive accessibility'), pretty.indexOf('Coverage of this run'))
    expect(section).toContain('◇ Advisory · COGA o4p08 Accept different input formats (not a WCAG requirement) · barrier')
    expect(section).toContain('◇ Advisory · COGA o4p06 Use Clear Visible Labels (not a WCAG requirement) · hurdle')
    expect(section).toContain('Beyond the target (WCAG 2.2 AAA; not part of the A/AA check)')
    expect(section).not.toContain('✗')
    expect(pretty.indexOf('No confirmed failures')).toBeLessThan(pretty.indexOf('Advisories: cognitive accessibility'))
  })

  it('folds them into a collapsed Markdown section, counted apart from the findings', async () => {
    const report = await checkSnapshot(cadastroSnapshot(), engine, options())
    const markdown = renderMarkdown([report])
    expect(markdown).toContain('**No confirmed failures in what was checked on 1 page.**')
    expect(markdown).toContain('<summary>Advisories (not WCAG requirements): 5</summary>')
    expect(markdown).toContain('◇ 3.1.4 Abbreviations: 1 abbreviation has no expanded form on this page: CEP')
    expect(markdown).toContain('[Advisory · COGA o4p03 Notify Users of Fees and Charges at the Start of a Task (not a WCAG requirement)](<https://www.w3.org/WAI/WCAG2/supplemental/patterns/o4p03-declared-charges/>)')
    // Advisories are dropped first when a comment must fit a size limit.
    const tight = renderMarkdown([report], { maxLength: 3_500 })
    expect(tight).toMatch(/advisor(y was|ies were) left out to fit the size limit/)
  })

  it('gives them a section of their own in the HTML report, linked to the COGA pattern and the Note', async () => {
    const report = await checkSnapshot(cadastroSnapshot(), engine, options())
    const html = renderHtml([report])
    expect(html).toContain('<h3 id="advisories-1">Advisories: cognitive accessibility (W3C COGA guidance, not WCAG requirements)</h3>')
    expect(html).toContain('<a href="https://www.w3.org/WAI/WCAG2/supplemental/patterns/o4p06-clear-labels/">COGA pattern o4p06: Use Clear Visible Labels</a>')
    expect(html).toContain('<a href="https://www.w3.org/TR/coga-usable/#use-clear-visible-labels-pattern">its section in the W3C Note</a>')
    expect(html.indexOf('advisories-1')).toBeLessThan(html.indexOf('Coverage of this run'))
    expect(html).not.toMatch(/<script/i)
  })

  it('reports them in SARIF as notes under rules of their own, valid against the schema', async () => {
    const report = await checkSnapshot(cadastroSnapshot(), engine, options())
    const log = toSarif([report])
    const run = log.runs[0]
    expect(run?.results.length).toBe(report.advisory?.results.length)
    expect(run?.results.every((result) => result.level === 'note')).toBe(true)
    const rule = run?.tool.driver.rules.find((candidate) => candidate.id === 'coga/visible-labels')
    expect(rule?.defaultConfiguration.level).toBe('note')
    // The four checks are experimental: their rules say so with a tag, as the rules of experimental findings do.
    expect(rule?.properties.tags).toEqual(['accessibility', 'coga', 'advisory', 'not-wcag', 'experimental'])
    expect(run?.tool.driver.rules.find((candidate) => candidate.id === 'wcag-aaa/3.1.4')?.properties.tags).toContain('beyond-target')
    expect(run?.results[0]?.message.text.startsWith('Advisory · COGA o4p08')).toBe(true)
    expect(run?.invocations[0]?.executionSuccessful).toBe(true)
    const result = sarifValidator.safeParse(log)
    if (!result.success) throw new Error(JSON.stringify(result.error.issues.slice(0, 5), null, 2))
  })
})

describe('experimental advisories', () => {
  const notice = 'These advisories come from W3C COGA guidance (and GAIA where cited) and are not WCAG requirements.'

  /** The advisory section of the terminal report, up to the coverage block. */
  const terminalSection = (report: Report) => {
    const pretty = renderReport(report, plain)
    return pretty.slice(pretty.indexOf('Advisories: cognitive accessibility'), pretty.indexOf('Coverage of this run'))
  }

  it('run with the profile, and every output marks them: one notice at the top, a tag on each advisory', async () => {
    const report = await checkSnapshot(cadastroSnapshot(), engine, options())
    const section = report.advisory
    // Each advisory carries the maturity of the check that wrote it; the wave-1 checks are all experimental.
    for (const advisory of section?.results ?? []) {
      expect(advisory.maturity).toBe(section?.checks.find((check) => check.check === advisory.check)?.maturity)
    }
    const experimental = section?.results.filter((advisory) => advisory.kind === 'advisory' && advisory.maturity === 'experimental') ?? []
    expect(experimental.map((advisory) => advisory.check)).toEqual(['coga/input-formats', 'coga/preselected-cost', 'coga/visible-labels', 'coga/abbreviations'])

    const terminal = terminalSection(report)
    expect(terminal.split(notice)).toHaveLength(2)
    expect(terminal.indexOf(notice)).toBeLessThan(terminal.indexOf('◇'))
    expect(terminal.match(/confidence \w+ · experimental · rule/g)).toHaveLength(experimental.length)
    expect(terminal).toContain('◇ 3.1.4 Abbreviations: 1 abbreviation has no expanded form on this page: CEP · experimental')

    const markdown = renderMarkdown([report])
    expect(markdown.split(notice)).toHaveLength(2)
    expect(markdown.indexOf(notice)).toBeLessThan(markdown.indexOf('**[Advisory · COGA'))
    expect(markdown.match(/· experimental ·/g)).toHaveLength(experimental.length)

    const html = renderHtml([report])
    expect(html).toContain(`<p class="notes experimental-notice">${notice}`)
    expect(html.match(/ · experimental · /g)).toHaveLength(experimental.length)

    // JSON has the maturity on each result and on each check.
    const json = JSON.parse(formatReports('json', [report], plain)) as Report
    expect(json.advisory?.results.map((advisory) => advisory.maturity)).toEqual(section?.results.map((advisory) => advisory.maturity))
    expect(json.advisory?.checks.map((check) => check.maturity)).toEqual(section?.checks.map((check) => check.maturity))
    expect(json.advisory?.results.some((advisory) => advisory.maturity === 'experimental')).toBe(true)

    const run = toSarif([report]).runs[0]
    expect(run?.results.length).toBe(section?.results.length)
    for (const result of run?.results ?? []) {
      const advisory = section?.results.find((candidate) => candidate.fingerprint === result.properties.findingId)
      expect(result.properties).toMatchObject({ maturity: advisory?.maturity, experimental: advisory?.maturity === 'experimental' })
    }
    const rule = run?.tool.driver.rules.find((candidate) => candidate.id === 'coga/visible-labels')
    expect(rule?.properties).toMatchObject({ maturity: 'experimental', experimental: true })
  })

  it("take the tag from the check's maturity, so a stable check is never marked", async () => {
    const formats = COGNITIVE_CHECKS.find((check) => check.id === 'coga/input-formats') as { maturity: 'stable' | 'experimental' }
    const before = formats.maturity
    formats.maturity = 'stable'
    try {
      const report = await checkSnapshot(cadastroSnapshot(), engine, options())
      const stable = report.advisory?.results.find((advisory) => advisory.check === 'coga/input-formats')
      expect(stable?.maturity).toBe('stable')
      expect(report.advisory?.checks.find((check) => check.check === 'coga/input-formats')?.maturity).toBe('stable')
      // The other checks are still experimental, so the notice stays; the stable advisory's facts line has no tag.
      const terminal = terminalSection(report)
      expect(terminal).toContain(notice)
      expect(terminal.split('\n').find((line) => line.includes(`id ${stable?.fingerprint}`))).not.toContain('experimental')
      const run = toSarif([report]).runs[0]
      const rule = run?.tool.driver.rules.find((candidate) => candidate.id === 'coga/input-formats')
      expect(rule?.properties).toMatchObject({ maturity: 'stable', experimental: false })
      expect(rule?.properties.tags).not.toContain('experimental')
      expect(run?.results.find((result) => result.ruleId === 'coga/input-formats')?.properties).toMatchObject({ maturity: 'stable', experimental: false })
    } finally {
      formats.maturity = before
    }

    // With every check stable, no output carries the notice or the tag.
    const report = await checkSnapshot(cadastroSnapshot(), engine, options())
    const section = report.advisory as NonNullable<Report['advisory']>
    const promoted: Report = {
      ...report,
      advisory: { ...section, results: section.results.map((advisory) => ({ ...advisory, maturity: 'stable' })), checks: section.checks.map((check) => ({ ...check, maturity: 'stable' })) },
    }
    for (const text of [renderReport(promoted, plain), renderMarkdown([promoted]), renderHtml([promoted])]) {
      expect(text).not.toContain(notice)
      expect(text).not.toMatch(/· experimental/)
    }
    const sarif = toSarif([promoted]).runs[0]
    expect(sarif?.tool.driver.rules.every((rule) => rule.properties.experimental === false)).toBe(true)
  })

  it('leave --fail-on advisory as it was: experimental advisories count, and nothing else changes', async () => {
    const report = await checkSnapshot(cadastroSnapshot(), engine, options())
    expect(report.advisory?.results.every((advisory) => advisory.maturity === 'experimental')).toBe(true)
    expect(exitCode([report], 'advisory')).toBe(1)
    expect(exitCode([report], 'confirmed')).toBe(0)
  })
})

/** The OASIS SARIF 2.1.0 schema, as test/sarif.test.ts reads it; "uri-reference" is left to that test. */
const sarifValidator = (() => {
  const strip = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(strip)
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).filter(([key, item]) => !(key === 'format' && item === 'uri-reference')).map(([key, item]) => [key, strip(item)]))
    }
    return value
  }
  const schema = JSON.parse(readFileSync('test/fixtures/sarif-schema-2.1.0.json', 'utf8')) as unknown
  return z.fromJSONSchema(strip(schema) as Parameters<typeof z.fromJSONSchema>[0])
})()
