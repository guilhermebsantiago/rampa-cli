import { spawnSync } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadConfig, validateConfig } from '../src/config.ts'
import { memoryCache } from '../src/core/cache.ts'
import { type CheckOptions, checkSnapshot, engineFindings } from '../src/core/check.ts'
import { EXPERIMENTAL_JUDGMENTS, judgmentMaturity } from '../src/core/maturity.ts'
import type { A11yNode } from '../src/snapshot/schema.ts'
import type { Report } from '../src/core/types.ts'
import { CRITERIA, DEFAULT_CRITERIA } from '../src/criteria/index.ts'
import { focusOrder } from '../src/criteria/focus-order.ts'
import { languageOfParts } from '../src/criteria/language-of-parts.ts'
import { coverageRows } from '../src/report/common.ts'
import { renderHtml } from '../src/report/html.ts'
import { renderMarkdown } from '../src/report/markdown.ts'
import { renderReport } from '../src/report/pretty.ts'
import { probeFinding } from '../src/rules/probes.ts'
import { loadEngineFor, loadSnapshot } from '../src/surfaces/targets.ts'
import { passingEngine, scriptedProvider, travelSnapshot } from './helpers.ts'
import { recordedReport } from './report-fixtures.ts'

const CLI = resolve('src/cli.ts')
const RECORDED = resolve('demo/recorded/examples-store-before.snapshot.json')
const plain = { bold: String, dim: String, red: String, redBold: String, green: String, yellow: String, gray: String } as unknown as Parameters<typeof renderReport>[1]['paint']
const env = { ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('RAMPA_'))), NO_COLOR: '1' }

function rampa(args: string[], cwd = process.cwd()) {
  const run = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', env })
  return { code: run.status, out: run.stdout, err: run.stderr }
}

async function project(config: unknown): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'rampa-gate-'))
  await writeFile(join(dir, 'rampa.config.json'), JSON.stringify(config))
  return dir
}

/** The recorded store page without a model: its Rampa rules' findings stay, since no judgment repeats them. */
async function rulesOnly(minConfidence: CheckOptions['minConfidence']): Promise<Report> {
  const snapshot = await loadSnapshot(RECORDED)
  const engine = await loadEngineFor(RECORDED)
  if (!engine) throw new Error('no engine results')
  return checkSnapshot(snapshot, engine, {
    criteria: [],
    llm: false,
    provider: undefined,
    runs: 1,
    cache: memoryCache(),
    offline: false,
    locale: 'en',
    minConfidence,
    concurrency: 1,
  })
}

describe('the config file', () => {
  it('names a wrong minConfidence and the values it takes, instead of hiding every finding', async () => {
    expect(() => validateConfig({ minConfidence: 'hgih' }, 'rampa.config.json')).toThrow('rampa.config.json: minConfidence is "hgih"; allowed values are low, medium, high.')
    const dir = await project({ minConfidence: 'hgih' })
    await expect(loadConfig(dir)).rejects.toMatchObject({ code: 'invalid-config' })
  })

  it('rejects unknown keys, and says where a gate setting goes instead', () => {
    expect(() => validateConfig({ failOn: 'AA' })).toThrow('unknown key "failOn" (the gate is set with --fail-on on the command line, or the action input fail-on)')
    expect(() => validateConfig({ minConfidense: 'high' })).toThrow(/unknown key "minConfidense"; the keys a config may hold are targets, .*minConfidence/)
    expect(() => validateConfig({ coga: { abbreviations: { knwon: ['CPF'] } } })).toThrow('unknown key "coga.abbreviations.knwon"; the keys "coga.abbreviations" may hold are known, glossaryUrl.')
  })

  it('checks types and ranges, and reads the forms the CLI always accepted', () => {
    expect(() => validateConfig({ runs: 0 })).toThrow('runs is 0; it must be at least 1.')
    expect(() => validateConfig({ concurrency: 1.5 })).toThrow('concurrency is 1.5; it must be a whole number.')
    expect(() => validateConfig({ targets: 'site/' })).toThrow('targets is "site/"; it must be an array.')
    expect(() => validateConfig({ reasoning: 'max' })).toThrow('reasoning is "max"; allowed values are provider-default, none, minimal, low, medium, high.')
    expect(validateConfig({ wcag: 2.2, locale: 'pt', criteria: '1.1.1, 2.4.4', minConfidence: 'low' })).toEqual({
      wcag: '2.2',
      locale: 'pt-BR',
      criteria: ['1.1.1', '2.4.4'],
      minConfidence: 'low',
    })
  })

  it('stops rampa check with exit 2 on a failing page, where the typo used to pass the gate', async () => {
    const typo = rampa(['check', RECORDED, '--no-llm'], await project({ minConfidence: 'hgih' }))
    expect(typo.code).toBe(2)
    expect(typo.err).toContain('minConfidence is "hgih"; allowed values are low, medium, high.')
    const unknown = rampa(['check', RECORDED, '--no-llm'], await project({ failOn: 'none' }))
    expect(unknown.code).toBe(2)
    expect(unknown.err).toContain('unknown key "failOn"')
    // The same page with a valid config fails on its findings, as it should.
    expect(rampa(['check', RECORDED, '--no-llm'], await project({ minConfidence: 'high' })).code).toBe(1)
  })

  it('is guarded in checkSnapshot too, for a minConfidence from JavaScript', async () => {
    await expect(rulesOnly('hgih' as never)).rejects.toThrow('minConfidence must be one of low, medium, high. Got "hgih".')
  })
})

describe('the threshold in the report', () => {
  it('is recorded in the report and in the JSON with the gate in effect', async () => {
    expect((await recordedReport()).report.minConfidence).toBe('medium')
    expect((await rulesOnly('low')).minConfidence).toBe('low')
    const run = rampa(['check', RECORDED, '--no-llm', '--format', 'json', '--fail-on', 'aa', '--min-confidence', 'high'])
    const json = JSON.parse(run.out) as Report
    expect(json).toMatchObject({ minConfidence: 'high', failOn: 'AA' })
  })

  it('is named in the note about findings below it, in English and Portuguese', async () => {
    const report = await rulesOnly('medium')
    expect(report.belowThreshold.length).toBeGreaterThan(0)
    const count = report.belowThreshold.length
    expect(renderReport(report, { verbose: false, paint: plain })).toContain(`${count} finding(s) below the confidence threshold (medium) are not listed; --verbose shows them.`)
    const portuguese = renderReport({ ...report, locale: 'pt-BR' }, { verbose: false, paint: plain })
    expect(portuguese).toContain(`${count} achado(s) abaixo do limiar de confiança (média) ficaram fora da lista; --verbose os mostra.`)
  })

  it('marks findings below it with --verbose, apart from the confirmed ones and each one tagged', async () => {
    const report = await rulesOnly('medium')
    const text = renderReport(report, { verbose: true, paint: plain })
    expect(text).toContain('Below the confidence threshold (medium): not confirmed failures; only --fail-on any counts them')
    // The confirmed findings come first, marked ✗; those below the threshold after the heading, marked ~.
    const [confirmed = '', below = ''] = text.split('Below the confidence threshold (medium)')
    expect(confirmed).toContain('✗ html > body > header > img')
    expect(below).not.toContain('✗')
    expect(below).toMatch(/~ .+\n/)
    expect(below).toContain('· experimental · Rampa rule rampa/placeholder-alt · below the confidence threshold (medium) · id')
    expect(text).toContain(`${report.belowThreshold.length} finding(s) below the confidence threshold (medium) are listed and marked as such: they are not confirmed failures.`)
    expect(renderMarkdown([report], { verbose: true })).toContain('below the confidence threshold (medium) · id')
    expect(renderHtml([report], { verbose: true })).toContain('below the confidence threshold (medium)')
  })
})

describe('experimental, from the maturity of the method behind each finding', () => {
  it('marks axe-core experimental rules (target-size), and not the others', () => {
    const findings = engineFindings({
      engine: { name: 'axe-core', version: 'test' },
      rules: [
        { ruleId: 'target-size', outcome: 'violation', criteria: ['2.5.8'], help: 'Targets are big enough', nodes: [{ target: 'a', html: '<a>' }] },
        { ruleId: 'image-alt', outcome: 'violation', criteria: ['1.1.1'], help: 'Images have alt', nodes: [{ target: 'img', html: '<img>' }] },
      ],
    })
    expect(findings.map((f) => [f.ruleId, f.confidence, f.experimental])).toEqual([
      ['target-size', 'low', true],
      ['image-alt', 'high', undefined],
    ])
  })

  it('marks every finding of an experimental Rampa rule, and of a probe rule', async () => {
    const report = await rulesOnly('low')
    const rules = report.findings.filter((f) => f.source === 'rule')
    expect(rules.length).toBeGreaterThan(0)
    for (const finding of rules) expect(finding.experimental).toBe(true)
    const node = { ref: 'html > body > main', native: {} } as unknown as A11yNode
    expect(probeFinding({ criterion: '1.4.10', rule: 'rampa/reflow', node, message: 'm', evidence: 'e', confidence: 'high', subject: 's' }).experimental).toBe(true)
  })

  it('marks the findings and the coverage of an experimental judgment module, which then wait below the threshold', async () => {
    // The 3.1.2 module under an experimental module's id: the same model answer, a different maturity.
    const experimental = { ...languageOfParts, id: '1.3.1' }
    const provider = () => scriptedProvider({ blockquote: [{ verdict: 'fail', detectedLanguage: 'nl', evidence: 'Het weer is vandaag mooi', exception: 'none', confidence: 'high' }] })
    const options = (criteria: CheckOptions['criteria'], minConfidence: CheckOptions['minConfidence']): CheckOptions => ({
      criteria,
      llm: true,
      provider: provider(),
      runs: 1,
      cache: memoryCache(),
      offline: false,
      locale: 'en',
      minConfidence,
      concurrency: 1,
    })
    const hidden = await checkSnapshot(travelSnapshot(), passingEngine(), options([experimental], 'medium'))
    expect(hidden.findings).toHaveLength(0)
    expect(hidden.belowThreshold).toEqual([expect.objectContaining({ criterion: '1.3.1', source: 'judgment', experimental: true })])
    const record = hidden.coverage.criteria?.find((r) => r.id === '1.3.1')
    expect(record?.methods.find((m) => m.kind === 'judgment')?.maturity).toBe('experimental')
    expect((await checkSnapshot(travelSnapshot(), passingEngine(), options([experimental], 'low'))).findings).toEqual([expect.objectContaining({ experimental: true })])
    // The module under its own id is stable: the same answer is a confirmed finding.
    const stable = await checkSnapshot(travelSnapshot(), passingEngine(), options([languageOfParts], 'medium'))
    expect(stable.findings).toEqual([expect.objectContaining({ criterion: '3.1.2' })])
    expect(stable.findings[0]?.experimental).toBeUndefined()
    expect(stable.coverage.criteria?.find((r) => r.id === '3.1.2')?.methods.find((m) => m.kind === 'judgment')?.maturity).toBe('stable')
  })

  it('lists the modules whose every finding is capped at low, none of them a default', () => {
    const modules = [...[...EXPERIMENTAL_JUDGMENTS].flatMap((id) => (CRITERIA.has(id) ? [CRITERIA.get(id)] : [])), focusOrder]
    expect(modules.map((module) => module?.id).sort()).toEqual([...EXPERIMENTAL_JUDGMENTS].sort())
    for (const module of modules) {
      expect(module?.confidenceCap?.({ ref: 'x', context: {} } as never)).toBe('low')
      expect(judgmentMaturity(module as never)).toBe('experimental')
      expect(DEFAULT_CRITERIA).not.toContain(module?.id)
    }
    for (const id of DEFAULT_CRITERIA) expect(judgmentMaturity(CRITERIA.get(id) as never)).toBe('stable')
  })

  it('tags the coverage lines of Rampa rules and judgment by the maturity of what decided them', async () => {
    const rulesLine = (report: Report) => coverageRows(report).find((row) => row.key === 'rules')
    // No model: only the experimental rules decided anything, so the whole line is experimental.
    expect(rulesLine(await rulesOnly('medium'))).toMatchObject({ label: 'Checked by Rampa rules (partial, experimental):', text: '1.1.1, 2.4.2, 2.4.6' })
    // With the judgments, the language identifier (stable) decided 3.1.1; the rest stays marked.
    const { report } = await recordedReport()
    expect(rulesLine(report)).toMatchObject({ label: 'Checked by Rampa rules (partial):', text: '3.1.1; experimental: 1.1.1, 2.4.2, 2.4.6' })
    expect(coverageRows(report).find((row) => row.key === 'judged')?.label).toBe('Judged with verified evidence:')
    expect(coverageRows({ ...report, locale: 'pt-BR' }).find((row) => row.key === 'rules')?.text).toContain('experimental: 1.1.1')
  })
})

describe('source labels', () => {
  it('credits a probe finding to its probe rule, never to axe-core', async () => {
    const { report } = await recordedReport()
    const node = { ref: 'html > body > main', native: {} } as unknown as A11yNode
    const probe = probeFinding({ criterion: '1.4.10', rule: 'rampa/reflow', node, message: 'Content scrolls sideways at 320 px.', evidence: 'e', confidence: 'high', subject: 's' })
    const withProbe = { ...report, findings: [probe] }
    const markdown = renderMarkdown([withProbe])
    expect(markdown).toContain('experimental · probe rule `rampa/reflow`')
    expect(markdown).not.toContain('rampa/reflow` (axe-core)')
    const html = renderHtml([withProbe])
    expect(html).toContain('probe rule rampa/reflow')
    expect(html).not.toContain('rampa/reflow (axe-core)')
    // The others keep theirs: axe-core's rules name the engine, a judgment says its evidence was verified.
    const full = renderMarkdown([report])
    expect(full).toContain('rule [image-alt](<https://dequeuniversity.com/rules/axe/4.14/image-alt?application=axeAPI>) (axe-core)')
    expect(full).toContain('1/1 runs · evidence verified · id')
  })
})

describe('exit 2 when nothing that needed a model was judged', () => {
  it('when --offline finds nothing in the cache: a note in the report, a line on stderr', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'rampa-empty-cache-'))
    const run = rampa(['check', RECORDED, '--offline', '--model', 'ollama:gemma4:12b', '--cache-dir', empty, '--format', 'json', '--fail-on', 'none'])
    expect(run.code).toBe(2)
    expect(run.err).toContain('the model judged none of the 13 candidate(s) that needed it (13 with no cached judgment, --offline)')
    const report = JSON.parse(run.out) as Report
    expect(report.notes).toContainEqual(expect.stringContaining('rampa check exits 2. Pass --no-llm to check with the deterministic layer only.'))
  })

  it('never for --no-llm, nor for a run the recorded judgments cover', () => {
    expect(rampa(['check', RECORDED, '--no-llm', '--fail-on', 'none']).code).toBe(0)
    const judged = rampa(['check', RECORDED, '--offline', '--model', 'ollama:gemma4:12b', '--cache-dir', resolve('demo/recorded/cache'), '--fail-on', 'none'])
    expect(judged.code).toBe(0)
    expect(judged.err).not.toContain('judged none')
  })
})
