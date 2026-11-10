import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type CheckCommandOptions, runCheck } from '../src/cli/commands/check.ts'
import type { GlobalContext } from '../src/cli/context.ts'
import { countedCriteria } from '../src/core/check.ts'
import type { Report } from '../src/core/types.ts'

// Recorded pages with their engine results: no browser, model or network.
const BEFORE = 'demo/recorded/examples-store-before.snapshot.json'
const AFTER = 'demo/recorded/examples-store-after.snapshot.json'

const context: GlobalContext = { locale: 'en', motion: false, config: {} }

function options(extra: Partial<CheckCommandOptions> = {}): CheckCommandOptions {
  return {
    criteria: '1.1.1,2.4.2,2.4.4,2.4.6,3.1.1,3.1.2',
    llm: false,
    runs: '1',
    format: 'json',
    failOn: 'confirmed',
    minConfidence: 'medium',
    cacheDir: '.rampa/cache',
    concurrency: '1',
    ...extra,
  }
}

const withoutDate = (report: Report | undefined) => ({ ...report, createdAt: undefined })

describe('rampa check with a target that cannot be loaded', { timeout: 60_000 }, () => {
  let dir: string
  let stdout: string
  let stderr: string
  let broken: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'rampa-not-loaded-'))
    // A file that exists, so resolving the targets accepts it, and is not JSON, so loading it fails.
    broken = join(dir, 'broken.json')
    await writeFile(broken, 'not json', 'utf8')
    stdout = ''
    stderr = ''
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      stdout += String(chunk)
      return true
    })
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
      stderr += String(chunk)
      return true
    })
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(dir, { recursive: true, force: true })
  })

  async function alone(target: string): Promise<Report> {
    stdout = ''
    await runCheck([target], options(), context)
    return JSON.parse(stdout) as Report
  }

  it('reports the others, writes a report saying it was not checked, and exits 2, in every file asked for', async () => {
    const first = await alone(BEFORE)
    const third = await alone(AFTER)
    stdout = ''
    stderr = ''
    const json = join(dir, 'out', 'report.json')
    const markdown = join(dir, 'report.md')
    const code = await runCheck([BEFORE, broken, AFTER], options({ json, markdown }), context)
    expect(code).toBe(2)

    const reports = JSON.parse(stdout) as Report[]
    expect(reports).toHaveLength(3)
    expect(withoutDate(reports[0])).toEqual(withoutDate(first))
    expect(withoutDate(reports[2])).toEqual(withoutDate(third))
    expect(first.findings.length).toBeGreaterThan(0)

    const stub = reports[1]
    expect(stub).toMatchObject({
      schemaVersion: 1,
      target: broken,
      surface: 'web',
      wcagTarget: 'wcag22-aa',
      locale: 'en',
      llm: 'off',
      engine: { name: 'none', version: '0' },
      minConfidence: 'medium',
      failOn: 'confirmed',
      findings: [],
      belowThreshold: [],
      waived: [],
      discarded: [],
      criteria: [],
      coverage: { engine: [], judged: [], notChecked: countedCriteria('2.2') },
      usage: { calls: 0, cachedCalls: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0 },
    })
    expect(stub?.notLoaded?.error).toBe(`Unexpected token 'o', "not json" is not valid JSON`)
    expect(stub?.errors).toEqual([stub?.notLoaded?.error])
    expect(stub?.notes).toEqual([`This target could not be loaded, so nothing on it was checked and the run cannot vouch for it (rampa check exits 2): ${stub?.notLoaded?.error}`])
    expect(stub?.coverage.notChecked).toHaveLength(55)
    expect(stderr).toContain(`rampa: ${broken}: could not be loaded, so nothing on it was checked: ${stub?.notLoaded?.error}\n`)

    expect(JSON.parse(await readFile(json, 'utf8'))).toEqual(reports)
    const md = await readFile(markdown, 'utf8')
    expect(md).toContain(`**\`${broken}\`: Nothing on this target was checked: it could not be loaded.**`)
    expect(md).toContain('on 2 pages checked against WCAG 2.2 A/AA')
    // The target that was not loaded is not listed with the clean pages.
    expect(md).toContain('No confirmed failures in what was checked on 1 more page: `examples/store/after.html`\n')
  })

  it('shows the headline in place of "no failures" in the terminal and in HTML, and in Portuguese', async () => {
    const html = join(dir, 'report.html')
    expect(await runCheck([BEFORE, broken], options({ format: 'pretty', html }), context)).toBe(2)
    expect(stdout).toContain('Nothing on this target was checked: it could not be loaded.')
    expect(stdout).not.toContain('No confirmed failures in what was checked.')
    expect(await readFile(html, 'utf8')).toContain('<p class="page-lead">Nothing on this target was checked: it could not be loaded.</p>')

    stdout = ''
    stderr = ''
    const pt: GlobalContext = { ...context, locale: 'pt-BR' }
    expect(await runCheck([broken, AFTER], options({ format: 'markdown' }), pt)).toBe(2)
    expect(stdout).toContain(`**\`${broken}\`: Nada neste alvo foi verificado: ele não pôde ser carregado.**`)
    expect(stderr).toContain(`rampa: ${broken}: não pôde ser carregado, então nada nele foi verificado: `)
  })

  it('takes a .json that is not a snapshot as not loaded too', async () => {
    const other = join(dir, 'other.json')
    await writeFile(other, '{"hello": "world"}\n', 'utf8')
    expect(await runCheck([other, AFTER], options(), context)).toBe(2)
    const reports = JSON.parse(stdout) as Report[]
    expect(reports.map((report) => Boolean(report.notLoaded))).toEqual([true, false])
    expect(reports[0]?.notLoaded?.error).toContain('is not a valid Rampa snapshot')
  })

  it('ends a run of one target as before: the promise rejects and nothing is written', async () => {
    const json = join(dir, 'report.json')
    await expect(runCheck([broken], options({ json }), context)).rejects.toThrow(/Unexpected token/)
    expect(stdout).toBe('')
    expect(stderr).toBe('')
    expect(existsSync(json)).toBe(false)
  })

  it('ends a run for rampa baseline (onReports) as before, so a baseline never misses a page', async () => {
    const onReports = vi.fn(async () => 0)
    await expect(runCheck([BEFORE, broken], options({ onReports }), context)).rejects.toThrow(/Unexpected token/)
    expect(onReports).not.toHaveBeenCalled()
    expect(stdout).toBe('')
  })

  it('still ends the run on a target that is not found, before anything loads', async () => {
    await expect(runCheck([BEFORE, join(dir, 'missing.json'), AFTER], options(), context)).rejects.toThrow(/Target not found/)
    expect(stdout).toBe('')
  })
})
