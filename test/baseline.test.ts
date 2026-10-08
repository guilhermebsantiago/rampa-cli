import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { type BaselineFile, compareWithBaseline, readBaseline, recordBaseline, targetKey, writeBaseline } from '../src/adoption/baseline.ts'
import type { Finding, Report } from '../src/core/types.ts'
import { CWD, engineFinding, fileUrl, judgmentFinding, report, summary } from './adoption-helpers.ts'

const logo = engineFinding('5f085d8a3b9c', 'html > body > header > img', '<img src="logo.svg" width="48">')
const alt = judgmentFinding('2c1d064d9cc7', '1.1.1', 'figure:nth-of-type(1) > img', 'IMG_2034.jpg')
const link = judgmentFinding('1af8a73e209d', '2.4.4', 'p:nth-of-type(2) > a', 'Click here')

describe('baseline files', () => {
  it('key a local file by its path from the working directory, and anything else as it is', () => {
    expect(targetKey(fileUrl('dist/index.html'), CWD)).toBe('dist/index.html')
    expect(targetKey(pathToFileURL(join(CWD, '..', 'elsewhere.html')).href, CWD)).toMatch(/^file:/)
    expect(targetKey('https://example.com/pricing', CWD)).toBe('https://example.com/pricing')
    expect(targetKey('examples/store/before.html', CWD)).toBe('examples/store/before.html')
  })

  it('record confirmed and low-confidence findings, not waived ones, sorted for small diffs', () => {
    const low = { ...link, confidence: 'low' as const }
    const waived = judgmentFinding('aaaaaaaaaaaa', '1.1.1', 'img.hero', 'hero')
    const baseline = recordBaseline([report({ findings: [alt, logo], belowThreshold: [low], waived: [waived] })], undefined, CWD)
    const target = baseline.targets['dist/index.html']
    expect(target?.findings.map((entry) => entry.fingerprint)).toEqual([logo.fingerprint, alt.fingerprint, link.fingerprint])
    expect(target).toMatchObject({ llm: 'on', model: 'test:model', engine: 'axe-core 4.14.0', criteria: ['1.1.1', '2.4.4'] })
    expect(target?.findings[0]).toEqual({
      fingerprint: logo.fingerprint,
      criterion: '1.1.1',
      source: 'engine',
      ref: logo.ref,
      ruleId: 'image-alt',
      subject: undefined,
      element: '<img src="logo.svg" width="48">',
      message: logo.message,
    })
  })

  it('replace the targets a run checked and keep the others', () => {
    const first = recordBaseline([report({ findings: [alt] }), report({ target: fileUrl('dist/about.html'), findings: [link] })], undefined, CWD)
    const second = recordBaseline([report({ findings: [] })], first, CWD)
    expect(second.targets['dist/index.html']?.findings).toEqual([])
    expect(second.targets['dist/about.html']?.findings.map((entry) => entry.fingerprint)).toEqual([link.fingerprint])
    expect(Object.keys(second.targets)).toEqual(['dist/about.html', 'dist/index.html'])
  })

  it('round-trip through the file and refuse files that are not baselines', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rampa-baseline-'))
    const path = join(dir, 'nested', 'baseline.json')
    const baseline = recordBaseline([report({ findings: [alt] })], undefined, CWD)
    await writeBaseline(path, baseline)
    expect(await readBaseline(path)).toEqual(JSON.parse(JSON.stringify(baseline)))
    await expect(readBaseline(join(dir, 'missing.json'))).rejects.toThrow(/Baseline not found.*rampa baseline/)
    await writeFile(join(dir, 'waivers.json'), '[]')
    await expect(readBaseline(join(dir, 'waivers.json'))).rejects.toThrow(/not a Rampa baseline/)
    await writeFile(join(dir, 'broken.json'), '{"schemaVersion": 1, "targets": {"a": {"findings": [{}]}}}')
    await expect(readBaseline(join(dir, 'broken.json'))).rejects.toThrow(/not a list of fingerprinted findings/)
  })
})

function baselineOf(...findings: Finding[]): BaselineFile {
  return recordBaseline([report({ findings })], undefined, CWD)
}

describe('comparing with a baseline', () => {
  it('leaves known findings out and keeps new ones', () => {
    const fresh = judgmentFinding('0f0f0f0f0f0f', '2.4.4', 'footer > a', 'More')
    const compared = compareWithBaseline(report({ findings: [alt, fresh, logo] }), baselineOf(alt, logo), 'b.json', { cwd: CWD })
    expect(compared.findings).toEqual([fresh])
    expect(compared.baseline).toMatchObject({ file: 'b.json', recordedAs: 'dist/index.html', moved: 0, fixed: [], unchecked: [] })
    expect(compared.baseline?.known).toEqual([alt, logo])
  })

  it('recognizes a finding whose element moved, by its rule and start tag or by what was judged', () => {
    const movedLogo = { ...logo, fingerprint: '111111111111', ref: 'html > body > header > img:nth-of-type(2)' }
    const movedAlt = { ...alt, fingerprint: '222222222222', ref: 'figure:nth-of-type(2) > img' }
    const compared = compareWithBaseline(report({ findings: [movedLogo, movedAlt] }), baselineOf(alt, logo), 'b.json', { cwd: CWD })
    expect(compared.findings).toEqual([])
    expect(compared.baseline).toMatchObject({ moved: 2, fixed: [] })
  })

  it('matches one baseline entry per finding, so a second copy of a known problem is new', () => {
    const copy = { ...logo, fingerprint: '333333333333', ref: 'footer > img' }
    const compared = compareWithBaseline(report({ findings: [logo, copy] }), baselineOf(logo), 'b.json', { cwd: CWD })
    expect(compared.findings).toEqual([copy])
  })

  it('does not match a judgment by content when the judged text changed', () => {
    const renamed = { ...alt, fingerprint: '444444444444', ref: 'figure:nth-of-type(2) > img', subject: 'IMG_2035.jpg' }
    const compared = compareWithBaseline(report({ findings: [renamed] }), baselineOf(alt), 'b.json', { cwd: CWD })
    expect(compared.findings).toEqual([renamed])
    expect(compared.baseline?.fixed.map((entry) => entry.fingerprint)).toEqual([alt.fingerprint])
  })

  it('calls a missing finding fixed only where this run could have found it again', () => {
    const baseline = baselineOf(alt, link, logo)
    const fixed = (partial: Partial<Report>) =>
      compareWithBaseline(report(partial), baseline, 'b.json', { cwd: CWD }).baseline?.fixed.map((entry) => entry.fingerprint)
    const unchecked = (partial: Partial<Report>) =>
      compareWithBaseline(report(partial), baseline, 'b.json', { cwd: CWD }).baseline?.unchecked.map((entry) => entry.fingerprint)

    expect(fixed({})).toEqual([logo.fingerprint, alt.fingerprint, link.fingerprint])
    // No judgment: the judgment entries cannot have been found, so they are not fixed.
    expect(fixed({ llm: 'off' })).toEqual([logo.fingerprint])
    expect(unchecked({ llm: 'no-model' })).toEqual([alt.fingerprint, link.fingerprint])
    // The model abstained or failed on a 2.4.4 candidate, which may be the link.
    expect(unchecked({ criteria: [summary('1.1.1'), summary('2.4.4', { cannotTell: 1 })] })).toEqual([link.fingerprint])
    expect(unchecked({ criteria: [summary('1.1.1'), summary('2.4.4', { errors: 1 })] })).toEqual([link.fingerprint])
    expect(unchecked({ criteria: [summary('1.1.1')] })).toEqual([link.fingerprint])
    expect(unchecked({ discarded: [{ criterion: '1.1.1', ref: alt.ref ?? '', reason: 'evidence is not the current text alternative', output: {} }] })).toEqual([
      alt.fingerprint,
    ])
    // A snapshot checked without engine results cannot find engine findings again.
    expect(unchecked({ engine: { name: 'none', version: '0' } })).toEqual([logo.fingerprint])
  })

  it('counts a waived finding as still there, neither new nor fixed', () => {
    const compared = compareWithBaseline(report({ waived: [alt] }), baselineOf(alt), 'b.json', { cwd: CWD })
    expect(compared.baseline).toMatchObject({ known: [], fixed: [], unchecked: [] })
    expect(compared.waived).toEqual([alt])
  })

  it('keeps reporting a finding whose waiver expired, even though the baseline knew it', () => {
    const compared = compareWithBaseline(report({ findings: [alt] }), baselineOf(alt), 'b.json', { cwd: CWD, keep: new Set([alt.fingerprint]) })
    expect(compared.findings).toEqual([alt])
    expect(compared.baseline).toMatchObject({ known: [], fixed: [] })
  })

  it('says when a target is not in the baseline: every finding is new', () => {
    const compared = compareWithBaseline(report({ target: fileUrl('dist/new.html'), findings: [alt] }), baselineOf(alt), 'b.json', { cwd: CWD })
    expect(compared.findings).toEqual([alt])
    expect(compared.baseline?.recordedAs).toBeUndefined()
  })

  it('matches a URL on another host by its path, when only one baseline target has that path', () => {
    const production = recordBaseline([report({ target: 'https://example.com/pricing?plan=pro', findings: [link] })], undefined, CWD)
    const preview = report({ target: 'https://pr-12--example.netlify.app/pricing?plan=pro', findings: [link] })
    const compared = compareWithBaseline(preview, production, 'b.json', { cwd: CWD })
    expect(compared.findings).toEqual([])
    expect(compared.baseline?.recordedAs).toBe('https://example.com/pricing?plan=pro')

    const twoHosts = recordBaseline([report({ target: 'https://staging.example.com/pricing?plan=pro', findings: [] })], production, CWD)
    expect(compareWithBaseline(preview, twoHosts, 'b.json', { cwd: CWD }).baseline?.recordedAs).toBeUndefined()
  })
})
