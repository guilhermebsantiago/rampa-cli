import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { prepareAdoption, targetsOrConfig } from '../src/adoption/apply.ts'
import { compareWithBaseline, recordBaseline, writeBaseline } from '../src/adoption/baseline.ts'
import type { Report } from '../src/core/types.ts'
import { paint } from '../src/report/color.ts'
import { renderReport } from '../src/report/pretty.ts'
import { CWD, engineFinding, judgmentFinding, report, summary } from './adoption-helpers.ts'

const text = (value: Report, verbose = false) => renderReport(value, { verbose, paint: paint(false) })

const logo = engineFinding('5f085d8a3b9c', 'html > body > header > img', '<img src="logo.svg">')
const alt = judgmentFinding('2c1d064d9cc7', '1.1.1', 'figure > img', 'IMG_2034.jpg')
const link = judgmentFinding('1af8a73e209d', '2.4.4', 'p > a', 'Click here')

describe('the report with a baseline', () => {
  it('never says "no confirmed failures" while the baseline holds known ones back', () => {
    const compared = compareWithBaseline(report({ findings: [alt, logo] }), recordBaseline([report({ findings: [alt, logo] })], undefined, CWD), '.rampa/baseline.json', { cwd: CWD })
    const output = text(compared)
    expect(output).not.toContain('No confirmed failures in what was checked.')
    expect(output).toContain('No new confirmed failures in what was checked; the baseline holds back 2 known finding(s).')
    expect(output).toContain('Baseline .rampa/baseline.json: 2 known finding(s) not shown.')
    expect(output).toContain('This report does not declare the page accessible.')
    expect(text(compared, true)).toContain(`  · 1.1.1 figure > img  ${alt.message}`)
  })

  it('lists what no longer appears, and what this run could not check again', () => {
    const baseline = recordBaseline([report({ findings: [alt, link, logo] })], undefined, CWD)
    const output = text(compareWithBaseline(report({ criteria: [summary('1.1.1'), summary('2.4.4', { cannotTell: 1 })] }), baseline, 'b.json', { cwd: CWD }))
    expect(output).toContain('2 baseline finding(s) no longer found; once you confirm they are fixed, record the baseline again with rampa baseline:')
    expect(output).toContain(`  ✓ 1.1.1 html > body > header > img  ${logo.message}`)
    expect(output).toContain('1 baseline finding(s) could not be checked again in this run: their criterion was not judged, or the model abstained or failed on part of it.')

    const engineOnly = text(compareWithBaseline(report({ llm: 'off' }), baseline, 'b.json', { cwd: CWD }))
    expect(engineOnly).toContain('2 baseline finding(s) could not be checked again in this run: they need the judgment layer, which did not run.')
  })

  it('says when this run is not comparable with how the baseline was recorded', () => {
    const recorded = recordBaseline([report({ model: 'ollama:gemma4:12b', criteria: [summary('1.1.1')] })], undefined, CWD)
    const output = text(compareWithBaseline(report({ model: 'anthropic:claude-haiku-5-5' }), recorded, 'b.json', { cwd: CWD }))
    expect(output).toContain('The baseline was recorded with ollama:gemma4:12b; this run used anthropic:claude-haiku-5-5, which can judge differently.')
    expect(output).toContain('The baseline did not judge 2.4.4 on this target, so their findings count as new.')

    const engineOnly = recordBaseline([report({ llm: 'off' })], undefined, CWD)
    expect(text(compareWithBaseline(report(), engineOnly, 'b.json', { cwd: CWD }))).toContain('recorded without the judgment layer')
    const elsewhere = text(compareWithBaseline(report({ target: 'https://example.com/' }), engineOnly, 'b.json', { cwd: CWD }))
    expect(elsewhere).toContain('This target is not in the baseline b.json, so every finding counts as new.')
  })

  it('speaks Portuguese with --locale pt-BR', () => {
    const baseline = recordBaseline([report({ findings: [alt, logo] })], undefined, CWD)
    const output = text(compareWithBaseline(report({ locale: 'pt-BR', findings: [alt] }), baseline, 'b.json', { cwd: CWD }))
    expect(output).toContain('Nenhuma falha confirmada nova no que foi verificado; a baseline segura 1 achado(s) já conhecido(s).')
    expect(output).toContain('1 achado(s) da baseline não aparece(m) mais')
  })
})

describe('the report with waivers', () => {
  it('counts waived findings and names expired waivers', () => {
    const output = text(
      report({
        findings: [alt],
        waived: [logo],
        expiredWaivers: [{ fingerprint: alt.fingerprint, reason: 'Catalog migration', expires: '2026-09-30' }],
      }),
    )
    expect(output).toContain('1 finding(s) waived (rampa waivers lists why).')
    expect(output).toContain('1 waiver(s) expired, so their findings are reported again:')
    expect(output).toContain('  2c1d064d9cc7 expired on 2026-09-30: Catalog migration')
  })

  it('shows the id of engine findings, which is what rampa waive takes', () => {
    expect(text(report({ findings: [logo] }))).toContain('high · rule image-alt · id 5f085d8a3b9c')
  })
})

describe('prepareAdoption', () => {
  async function project(files: Record<string, unknown>): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'rampa-adoption-'))
    for (const [name, content] of Object.entries(files)) await writeFile(join(dir, name), JSON.stringify(content))
    return dir
  }

  it('applies only waivers in date, and reports the expired ones that matched a finding', async () => {
    const dir = await project({
      'waivers.json': [
        { fingerprint: alt.fingerprint, reason: 'expired', expires: '2026-09-30' },
        { fingerprint: logo.fingerprint, reason: 'current', expires: '2026-12-31' },
        { fingerprint: 'ffffffffffff', expires: '2020-01-01' },
        { fingerprint: 'eeeeeeeeeeee', expires: 'whenever' },
      ],
    })
    const adoption = await prepareAdoption(undefined, { waivers: join(dir, 'waivers.json') }, '2026-10-08')
    expect(adoption.waivers).toEqual(new Set([logo.fingerprint]))
    expect(adoption.invalidWaivers).toBe(1)
    const applied = adoption.apply(report({ findings: [alt] }))
    expect(applied.expiredWaivers?.map((waiver) => waiver.fingerprint)).toEqual([alt.fingerprint])
    expect(applied.baseline).toBeUndefined()
  })

  it('takes the baseline from the flag, else the config, and --no-baseline turns it off', async () => {
    const dir = await project({})
    const path = join(dir, 'baseline.json')
    await writeBaseline(path, recordBaseline([report({ target: 'page', findings: [alt] })], undefined, CWD))
    const config = { waivers: join(dir, 'none.json'), baseline: path }
    const page = report({ target: 'page', findings: [alt] })
    expect((await prepareAdoption(undefined, config)).apply(page).findings).toEqual([])
    expect((await prepareAdoption(path, { waivers: config.waivers })).apply(page).findings).toEqual([])
    expect((await prepareAdoption(false, config)).apply(page).findings).toEqual([alt])
    await expect(prepareAdoption(join(dir, 'missing.json'), config)).rejects.toThrow(/Baseline not found/)
  })

  it('checks the targets given, else those of the config', () => {
    expect(targetsOrConfig(['a.html'], { targets: ['dist'] })).toEqual(['a.html'])
    expect(targetsOrConfig([], { targets: ['dist'] })).toEqual(['dist'])
    expect(() => targetsOrConfig([], {})).toThrow(/No targets/)
  })
})
