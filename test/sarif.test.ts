import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { FINGERPRINT_KEY, SOURCE_ROOT, type SarifLog, toSarif } from '../src/report/sarif.ts'
import { asRemote, findingOf, recordedReport } from './report-fixtures.ts'

// The official OASIS schema, vendored so the test needs no network: SARIF 2.1.0 errata 01 from
// https://docs.oasis-open.org/sarif/sarif/v2.1.0/errata01/os/schemas/sarif-schema-2.1.0.json
// (SHA-256 c3b4bb2d6093897483348925aaa73af03b3e3f4bd4ca38cef26dcb4212a2682e as downloaded).
const schema = JSON.parse(readFileSync('test/fixtures/sarif-schema-2.1.0.json', 'utf8')) as Record<string, unknown>

/**
 * zod reads "uri-reference" as an absolute URL, which would reject the relative paths
 * SARIF allows for artifacts; those are checked by hand in uriReferences below.
 */
function withoutUriReferenceFormat(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutUriReferenceFormat)
  if (value && typeof value === 'object') {
    const copy: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      if (key === 'format' && item === 'uri-reference') continue
      copy[key] = withoutUriReferenceFormat(item)
    }
    return copy
  }
  return value
}

const validator = z.fromJSONSchema(withoutUriReferenceFormat(schema) as Parameters<typeof z.fromJSONSchema>[0])

function expectValid(log: unknown): void {
  const result = validator.safeParse(log)
  if (!result.success) throw new Error(JSON.stringify(result.error.issues.slice(0, 5), null, 2))
  for (const uri of uriReferences(log)) {
    expect(uri).not.toMatch(/[\s\\]/)
    expect(() => new URL(uri, 'file:///repository/')).not.toThrow()
  }
}

function uriReferences(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) for (const item of value) uriReferences(item, found)
  else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (key === 'artifactLocation' || key === 'location') {
        const uri = (item as { uri?: unknown } | null)?.uri
        if (typeof uri === 'string') found.push(uri)
      }
      uriReferences(item, found)
    }
  }
  return found
}

describe('SARIF', () => {
  it('validates against the official SARIF 2.1.0 schema', async () => {
    const local = (await recordedReport()).report
    const remote = asRemote((await recordedReport('examples-language-of-parts-mismatch')).report)
    expectValid(toSarif([local]))
    expectValid(toSarif([local, remote], { verbose: true }))
    expectValid(toSarif([]))
    // The same page twice: one artifact, which the schema requires to be unique.
    const twice = toSarif([local, local])
    expectValid(twice)
    expect(twice.runs[0]?.artifacts).toHaveLength(1)
    expect(new Set(twice.runs[0]?.results.map((result) => result.locations[0]?.physicalLocation.artifactLocation.index))).toEqual(new Set([0]))
  })

  it('fails the schema when the log is broken, so the check above means something', async () => {
    const log = toSarif([(await recordedReport()).report])
    const broken = structuredClone(log) as unknown as { runs: Array<{ results: Array<Record<string, unknown>> }> }
    const result = broken.runs[0]?.results[0]
    if (!result) throw new Error('no result')
    result.level = 'fatal'
    expect(validator.safeParse(broken).success).toBe(false)
    delete result.level
    result.unknownProperty = true
    expect(validator.safeParse(broken).success).toBe(false)
  })

  it('has one rule per success criterion, with its level and Understanding page', async () => {
    const log = toSarif([(await recordedReport()).report])
    const rules = log.runs[0]?.tool.driver.rules ?? []
    expect(rules.map((rule) => rule.id)).toEqual(['WCAG-1.1.1', 'WCAG-2.4.2', 'WCAG-2.4.4', 'WCAG-2.4.6', 'WCAG-3.1.2'])
    expect(rules[2]).toMatchObject({
      name: 'LinkPurposeInContext',
      shortDescription: { text: 'WCAG 2.4.4 Link Purpose (In Context) (Level A)' },
      helpUri: 'https://www.w3.org/WAI/WCAG22/Understanding/link-purpose-in-context.html',
      properties: { wcagLevel: 'A' },
    })
    expect(rules[3]?.properties.tags).toContain('wcag-aa')
    for (const result of log.runs[0]?.results ?? []) expect(rules[result.ruleIndex]?.id).toBe(result.ruleId)
  })

  it('locates a local page in its source file, with the patch as a fix', async () => {
    const log = toSarif([(await recordedReport()).report])
    const run = log.runs[0]
    const link = run?.results.find((result) => result.ruleId === 'WCAG-2.4.4')
    expect(link?.level).toBe('error')
    expect(link?.message.text).toBe(
      'The link text "Click here" does not tell where the link goes, and nothing around it does. Evidence: "Click here". (id 1af8a73e209d)',
    )
    expect(link?.locations[0]?.physicalLocation).toEqual({
      artifactLocation: { uri: 'examples/store/before.html', uriBaseId: SOURCE_ROOT, index: 0 },
      region: { startLine: 31, startColumn: 10, endLine: 31, endColumn: 48, snippet: { text: '<a href="shipping.html">Click here</a>' } },
    })
    expect(link?.locations[0]?.logicalLocations).toEqual([{ fullyQualifiedName: 'html > body > main > p:nth-of-type(2) > a', kind: 'element' }])
    expect(link?.fixes).toEqual([
      {
        description: { text: 'Change the text to "Shipping information"' },
        artifactChanges: [
          {
            artifactLocation: { uri: 'examples/store/before.html', uriBaseId: SOURCE_ROOT, index: 0 },
            replacements: [{ deletedRegion: { startLine: 31, startColumn: 34, endLine: 31, endColumn: 44 }, insertedContent: { text: 'Shipping information' } }],
          },
        ],
      },
    ])
    expect(run?.originalUriBaseIds?.[SOURCE_ROOT]).toBeDefined()
    // An engine finding has no patch, so no fix.
    expect(run?.results[0]?.fixes).toBeUndefined()
    expect(run?.results[0]?.properties).toMatchObject({ source: 'engine', engineRule: 'image-alt' })
  })

  it('keeps only http(s) help addresses from the engine, which runs inside the page', async () => {
    const { report } = await recordedReport()
    const engine = report.findings[0]
    if (!engine) throw new Error('no engine finding')
    const planted = toSarif([{ ...report, findings: [{ ...engine, criterion: 'best-practice', level: undefined, helpUrl: 'javascript:alert(1)' }] }])
    expect(JSON.stringify(planted)).not.toContain('javascript:')
    expectValid(planted)
  })

  it('keeps fingerprints across runs and apart between findings', async () => {
    const fingerprints = (log: SarifLog) => log.runs[0]?.results.map((result) => result.partialFingerprints[FINGERPRINT_KEY]) ?? []
    const first = fingerprints(toSarif([(await recordedReport()).report]))
    const second = fingerprints(toSarif([(await recordedReport()).report]))
    expect(second).toEqual(first)
    expect(new Set(first).size).toBe(first.length)
    // The same element on another page is another alert.
    const elsewhere = fingerprints(toSarif([asRemote((await recordedReport()).report)]))
    expect(elsewhere.some((value) => first.includes(value))).toBe(false)
  })

  it('points a remote page at its address and the selector of the element', async () => {
    const log = toSarif([asRemote((await recordedReport()).report, 'https://shop.example/new?x=1')])
    const result = log.runs[0]?.results[1]
    expect(result?.locations[0]?.physicalLocation).toEqual({ artifactLocation: { uri: 'https://shop.example/new?x=1', index: 0 } })
    expect(result?.locations[0]?.logicalLocations?.[0]?.fullyQualifiedName).toBe('html > body > main > div > figure:nth-of-type(1) > img')
    expect(result?.fixes).toBeUndefined()
    expect(result?.properties.patch).toEqual({ before: '<img src="mug.svg" alt="IMG_2034.jpg">', after: '<img src="mug.svg" alt="A blue mug with steam rising from it">' })
    expect(log.runs[0]?.originalUriBaseIds).toBeUndefined()
  })

  it('states the coverage of every page, also when there is no result', async () => {
    const report = (await recordedReport('examples-store-after')).report
    const log = toSarif([report])
    const run = log.runs[0]
    expect(run?.results).toHaveLength(0)
    const note = run?.invocations[0]?.toolExecutionNotifications.find((n) => n.descriptor.id === 'coverage')
    expect(note?.level).toBe('note')
    expect(note?.message.text).toContain('Not checked automatically: 43 of 55 WCAG 2.2 A/AA criteria')
    expect(note?.message.text).toContain('This report does not declare the page accessible.')
    expect(run?.properties.coverage).toEqual([
      // 3.1.1 is decided by the language identifier on this page's long English text: checked by a rule, not judged.
      expect.objectContaining({
        target: 'examples/store/after.html',
        judged: ['1.1.1', '1.3.5', '2.4.2', '2.4.4', '2.4.6', '3.1.2'],
        checkedByRules: expect.arrayContaining(['3.1.1']),
      }),
    ])
    expect(run?.tool.extensions).toEqual([{ name: 'axe-core', version: '4.14.0', informationUri: 'https://github.com/dequelabs/axe-core' }])
  })

  it('adds waived findings as suppressed and low-confidence ones as notes only with --verbose', async () => {
    const plain = (await recordedReport()).report
    const waived = plain.findings.find((finding) => finding.criterion === '2.4.4')
    if (!waived) throw new Error('no link finding')
    const { report } = await recordedReport('examples-store-before', { waivers: new Set([waived.fingerprint]) })
    const below = { ...report, belowThreshold: [{ ...waived, fingerprint: 'low-one', confidence: 'low' as const }] }
    expect(toSarif([below]).runs[0]?.results).toHaveLength(8)
    const verbose = toSarif([below], { verbose: true }).runs[0]?.results ?? []
    expect(verbose).toHaveLength(10)
    expect(verbose.find((result) => result.properties.findingId === 'low-one')).toMatchObject({ level: 'note', properties: { belowThreshold: true } })
    expect(verbose.find((result) => result.properties.findingId === waived.fingerprint)?.suppressions).toEqual([
      { kind: 'external', status: 'accepted', justification: 'Waived in .rampa/waivers.json' },
    ])
  })

  it('gives each engine rule outside WCAG 2.1 A/AA its own rule, and escapes brackets in messages', async () => {
    const { report } = await recordedReport()
    const engine = report.findings[0]
    if (!engine) throw new Error('no engine finding')
    const outside = (ruleId: string) => ({ ...engine, fingerprint: ruleId, criterion: 'best-practice', level: undefined, ruleId, helpUrl: `https://dequeuniversity.com/rules/axe/4.14/${ruleId}` })
    const judged = { ...findingOf(report, '2.4.4'), message: 'The link text "[Download](https://evil.example/x)" says nothing.' }
    const log = toSarif([{ ...report, findings: [outside('region'), outside('heading-order'), judged] }])
    const rules = log.runs[0]?.tool.driver.rules ?? []
    expect(rules.map((rule) => [rule.id, rule.helpUri])).toEqual([
      ['region', 'https://dequeuniversity.com/rules/axe/4.14/region'],
      ['heading-order', 'https://dequeuniversity.com/rules/axe/4.14/heading-order'],
      ['WCAG-2.4.4', 'https://www.w3.org/WAI/WCAG22/Understanding/link-purpose-in-context.html'],
    ])
    expect(log.runs[0]?.results[2]?.message.text).toContain('"\\[Download\\](https://evil.example/x)"')
    expectValid(log)
  })

  it('sets each level by the gate: error when the finding fails --fail-on, note below the threshold, warning otherwise', async () => {
    const { report } = await recordedReport()
    const levels = (log: SarifLog) => Object.fromEntries((log.runs[0]?.results ?? []).map((result) => [result.properties.findingId, result.level]))
    const link = findingOf(report, '2.4.4')
    const heading = findingOf(report, '2.4.6')
    // A medium-confidence finding fails the default gate, so it is an error, not the warning it used to be.
    const medium = { ...report, findings: report.findings.map((finding) => (finding === link ? { ...finding, confidence: 'medium' as const } : finding)) }
    const confirmed = toSarif([medium])
    expect(levels(confirmed)[link.fingerprint]).toBe('error')
    expect(new Set(Object.values(levels(confirmed)))).toEqual(new Set(['error']))
    expectValid(confirmed)
    // --fail-on AA, A and none, from the report as rampa check records it, or from the options.
    expect(levels(toSarif([{ ...report, failOn: 'A' }]))[heading.fingerprint]).toBe('warning')
    expect(levels(toSarif([{ ...report, failOn: 'A' }]))[link.fingerprint]).toBe('error')
    expect(new Set(Object.values(levels(toSarif([report], { failOn: 'none' }))))).toEqual(new Set(['warning']))
    // Below the threshold: a note with --verbose, and a result even without it when --fail-on any counts it, as an error.
    const below = { ...report, belowThreshold: [{ ...link, fingerprint: 'low-one', confidence: 'low' as const, experimental: true }] }
    expect(levels(toSarif([below], { verbose: true }))['low-one']).toBe('note')
    expect(levels(toSarif([below]))['low-one']).toBeUndefined()
    const any = toSarif([{ ...below, failOn: 'any' }])
    expect(levels(any)['low-one']).toBe('error')
    expect(any.runs[0]?.results.find((result) => result.properties.findingId === 'low-one')?.properties).toMatchObject({ belowThreshold: true, failsGate: true })
    expectValid(any)
  })

  it('carries maturity, the threshold and the gate in result, rule and run properties', async () => {
    const { report } = await recordedReport()
    const experimental = { ...findingOf(report, '2.4.6'), fingerprint: 'exp-one', experimental: true, confidence: 'low' as const }
    const log = toSarif([{ ...report, failOn: 'AA', findings: [...report.findings, experimental], belowThreshold: [{ ...experimental, fingerprint: 'exp-two', criterion: '2.5.8', level: 'AA' as const, ruleId: 'target-size', source: 'engine' as const }] }], { verbose: true })
    expectValid(log)
    const run = log.runs[0]
    const result = (id: string) => run?.results.find((r) => r.properties.findingId === id)
    expect(result(findingOf(report, '2.4.4').fingerprint)?.properties).toMatchObject({ maturity: 'stable', experimental: false, failsGate: true })
    expect(result('exp-one')?.properties).toMatchObject({ maturity: 'experimental', experimental: true })
    // A rule with stable and experimental results is mixed; one with experimental results only is tagged.
    const rule = (id: string) => run?.tool.driver.rules.find((r) => r.id === id)
    expect(rule('WCAG-2.4.6')?.properties).toMatchObject({ maturity: 'mixed', experimental: false })
    expect(rule('WCAG-2.4.6')?.properties.tags).not.toContain('experimental')
    expect(rule('WCAG-2.5.8')?.properties).toMatchObject({ maturity: 'experimental', experimental: true })
    expect(rule('WCAG-2.5.8')?.properties.tags).toContain('experimental')
    expect(rule('WCAG-1.1.1')?.properties).toMatchObject({ maturity: 'stable', experimental: false })
    expect(run?.properties).toMatchObject({ minConfidence: 'medium', failOn: 'AA' })
    expect(run?.properties.coverage).toEqual([expect.objectContaining({ minConfidence: 'medium', belowThreshold: 1 })])
    const methods = (run?.properties.coverage as Array<{ criteria: Array<{ id: string; methods: Array<{ id: string; maturity: string }> }> }>)[0]?.criteria.find((c) => c.id === '2.4.2')?.methods
    expect(methods).toContainEqual(expect.objectContaining({ id: 'rampa/default-title', maturity: 'experimental' }))
  })

  it('counts the findings it leaves out below the threshold, with the threshold, and says when nothing was judged', async () => {
    const { report } = await recordedReport()
    const below = { ...report, belowThreshold: [{ ...findingOf(report, '2.4.4'), fingerprint: 'low-one', confidence: 'low' as const }] }
    const notes = toSarif([below]).runs[0]?.invocations[0]?.toolExecutionNotifications ?? []
    expect(notes.find((n) => n.descriptor.id === 'below-threshold')?.message.text).toBe(
      'examples/store/before.html: 1 finding(s) below the confidence threshold (medium) are not listed; --verbose shows them.',
    )
    // With --verbose they are results, so no notification counts them.
    expect(toSarif([below], { verbose: true }).runs[0]?.invocations[0]?.toolExecutionNotifications.some((n) => n.descriptor.id === 'below-threshold')).toBe(false)
    const unjudged = { ...report, criteria: report.criteria.map((c) => ({ ...c, judged: 0, passed: 0, failed: 0, offlineMisses: c.candidates })) }
    const log = toSarif([unjudged])
    expect(log.runs[0]?.invocations[0]?.executionSuccessful).toBe(false)
    expect(log.runs[0]?.invocations[0]?.toolExecutionNotifications.find((n) => n.descriptor.id === 'nothing-judged')).toMatchObject({ level: 'error' })
    expectValid(log)
  })

  it('speaks the report language', async () => {
    const log = toSarif([(await recordedReport('examples-store-before', { locale: 'pt-BR' })).report])
    expect(log.runs[0]?.language).toBe('pt-BR')
    expect(log.runs[0]?.tool.driver.rules[0]?.shortDescription.text).toBe('WCAG 1.1.1 Conteúdo não textual (Nível A)')
    expect(log.runs[0]?.results[1]?.message.text).toContain('Evidência: "IMG_2034.jpg".')
  })
})
