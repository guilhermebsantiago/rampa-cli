import { execFile } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { type RampaConfig, type Report, assertRampa, check, formatFindings } from '../src/index.ts'

// Recorded with `rampa check --save`, with the judgments of ollama:gemma4:12b in the demo cache:
// the whole pipeline runs offline, with no browser, no model and no network.
const recorded = 'demo/recorded/examples-store-before.snapshot.json'
const fixed = 'demo/recorded/examples-store-after.snapshot.json'
const replay = { model: 'ollama:gemma4:12b', offline: true, cacheDir: 'demo/recorded/cache', config: false, waivers: [] } as const

/** The CLI's JSON report; it exits 1 when it finds failures, and the report is on stdout either way. */
function cli(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, ['src/cli.ts', ...args], { maxBuffer: 20_000_000, env: { ...process.env, RAMPA_LOCALE: 'en', RAMPA_MODEL: '' } }, (error, stdout) => {
      if (error && error.code !== 1) reject(error)
      else resolve(stdout)
    })
  })
}

describe('check', () => {
  it('runs only the deterministic layer with noLlm', async () => {
    const [report] = await check(recorded, { noLlm: true, config: false, waivers: [] })
    expect(report?.llm).toBe('off')
    expect(report?.findings).toEqual([expect.objectContaining({ criterion: '1.1.1', source: 'engine', ruleId: 'image-alt', ref: 'html > body > header > img' })])
    expect(report?.coverage.notChecked.length).toBeGreaterThan(30)
  })

  it('judges with the recorded model answers, offline', async () => {
    const [report] = await check(recorded, replay)
    expect(report).toMatchObject({ llm: 'on', model: 'ollama:gemma4:12b', usage: { calls: 0, cachedCalls: 14 } })
    expect(report?.findings.map((f) => `${f.criterion} ${f.source}`)).toEqual([
      '1.1.1 engine',
      '1.1.1 judgment',
      '1.1.1 judgment',
      '1.1.1 judgment',
      '2.4.2 judgment',
      '2.4.4 judgment',
      '2.4.6 judgment',
      '2.4.6 judgment',
      '3.1.2 judgment',
    ])
  })

  it('builds the same report as rampa check', { timeout: 30_000 }, async () => {
    const [api] = await check(recorded, replay)
    const fromCli = JSON.parse(await cli(['check', recorded, '--offline', '--cache-dir', 'demo/recorded/cache', '-m', 'ollama:gemma4:12b', '--format', 'json']))
    expect({ ...api, createdAt: '' }).toEqual({ ...fromCli, createdAt: '' })
  })

  it('returns one report per target, in order, with criteria given as a list or a string', async () => {
    const reports = await check([recorded, fixed], { ...replay, criteria: '2.4.2,2.4.4' })
    expect(reports.map((r) => r.target)).toEqual(['examples/store/before.html', 'examples/store/after.html'])
    expect(reports.map((r) => r.criteria.map((c) => c.criterion))).toEqual([
      ['2.4.2', '2.4.4'],
      ['2.4.2', '2.4.4'],
    ])
    expect(reports[1]?.findings).toEqual([])
  })

  it('falls back on the config under the options it is given', async () => {
    const config: RampaConfig = { criteria: ['3.1.2'], locale: 'pt-BR', minConfidence: 'high', model: 'ollama:gemma4:12b', cacheDir: 'demo/recorded/cache' }
    const [report] = await check(recorded, { offline: true, waivers: [], config })
    expect(report?.criteria.map((c) => c.criterion)).toEqual(['3.1.2'])
    expect(report?.locale).toBe('pt-BR')
    // The language's name comes from the runtime's ICU data, which differs between Node builds.
    expect(report?.findings.find((f) => f.criterion === '3.1.2')?.message).toMatch(/^Marcado como lang="es", mas o texto está em \S+ \(nl\)\.$/)
    const [english] = await check(recorded, { offline: true, waivers: [], config, locale: 'en' })
    expect(english?.locale).toBe('en')
    // A rampa.config.json may write the criteria as one string, as the flag does.
    const [fromJson] = await check(recorded, { noLlm: true, waivers: [], config: { criteria: '2.4.2,2.4.4' } as unknown as RampaConfig })
    expect(fromJson?.criteria.map((c) => c.criterion)).toEqual(['2.4.2', '2.4.4'])
  })

  it('moves waived findings out of the report, from fingerprints or a waivers file', async () => {
    const [first] = await check(recorded, replay)
    const fingerprint = first?.findings.find((f) => f.criterion === '2.4.2')?.fingerprint ?? ''
    const [waived] = await check(recorded, { ...replay, waivers: [fingerprint] })
    expect(waived?.findings.map((f) => f.fingerprint)).not.toContain(fingerprint)
    expect(waived?.waived.map((f) => f.fingerprint)).toEqual([fingerprint])

    const dir = await mkdtemp(join(tmpdir(), 'rampa-'))
    await writeFile(join(dir, 'waivers.json'), JSON.stringify([{ fingerprint, reason: 'title fixed upstream' }]))
    const [fromFile] = await check(recorded, { ...replay, waivers: join(dir, 'waivers.json') })
    expect(fromFile?.waived.map((f) => f.fingerprint)).toEqual([fingerprint])
  })

  it('prints and asserts on its reports as the test matchers do', async () => {
    const reports = await check([recorded, fixed], replay)
    expect(formatFindings(reports).split('\n')[0]).toBe('Rampa: 9 failures in examples/store/before.html')
    expect(() => assertRampa(reports)).toThrow(/^Rampa: 9 failures in examples\/store\/before\.html\n/)
    expect(() => assertRampa(reports[1] as Report)).not.toThrow()
  })

  it('refuses options that would hide findings or check nothing', async () => {
    const base = { noLlm: true, config: false, waivers: [] } as const
    await expect(check(recorded, { ...base, minConfidence: 'Medium' as never })).rejects.toThrow('minConfidence must be low, medium or high. Got "Medium".')
    await expect(check(recorded, { ...base, reasoning: 'max' as never })).rejects.toThrow('reasoning must be one of provider-default, none, minimal, low, medium, high. Got "max".')
    await expect(check(recorded, { ...base, waivers: 'no/such/waivers.json' })).rejects.toThrow('Waivers file not found: no/such/waivers.json')
    await expect(check(recorded, { ...base, criteria: ['9.9.9'] })).rejects.toThrow('No judgment module for WCAG 9.9.9')
    await expect(check('no/such/page.html', base)).rejects.toThrow('Target not found: no/such/page.html')
  })
})
