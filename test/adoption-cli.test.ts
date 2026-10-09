import { spawnSync } from 'node:child_process'
import { copyFile, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { EngineResults, Report } from '../src/core/types.ts'

// End to end through the real CLI, on a page recorded with its engine results, with the judgments
// replayed from the recorded cache: no browser, no network, no model.
const CLI = resolve('src/cli.ts')
const RECORDED = resolve('demo/recorded')
const JUDGED = ['--offline', '--model', 'ollama:gemma4:12b', '--cache-dir', join(RECORDED, 'cache')]

const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('RAMPA_')))

function rampa(cwd: string, ...args: string[]) {
  const run = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', env: { ...env, NO_COLOR: '1' } })
  return { code: run.status, out: run.stdout, err: run.stderr }
}

async function storeProject(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'rampa-cli-'))
  await copyFile(join(RECORDED, 'examples-store-before.snapshot.json'), join(dir, 'store.snapshot.json'))
  await copyFile(join(RECORDED, 'examples-store-before.engine.json'), join(dir, 'store.engine.json'))
  await writeFile(join(dir, 'package.json'), '{"type":"module"}\n')
  return dir
}

const json = async <T>(path: string) => JSON.parse(await readFile(path, 'utf8')) as T

describe('adopting Rampa on a page with known problems', { timeout: 120_000 }, () => {
  it('records a baseline, then fails only on new findings, waives one and brings it back when it expires', async () => {
    const dir = await storeProject()

    const init = rampa(dir, 'init', '--yes', '--no-detect', '--targets', 'store.snapshot.json')
    expect(init.code).toBe(0)
    expect(init.out).toContain('created     rampa.config.ts')

    // The config's targets stand in for the arguments.
    const first = rampa(dir, 'check', '--no-llm')
    expect(first.code).toBe(1)
    expect(first.out).toContain('id 5f085d8a3b9c')

    const baseline = rampa(dir, 'baseline', ...JUDGED)
    expect(baseline.code).toBe(0)
    expect(baseline.out).toContain('Baseline written: .rampa/baseline.json')
    const recorded = await json<{ targets: Record<string, { findings: unknown[]; llm: string }> }>(join(dir, '.rampa/baseline.json'))
    expect(Object.keys(recorded.targets)).toEqual(['examples/store/before.html'])
    expect(recorded.targets['examples/store/before.html']).toMatchObject({ llm: 'on' })
    expect(recorded.targets['examples/store/before.html']?.findings).toHaveLength(9)

    const known = rampa(dir, 'check', '--baseline', '.rampa/baseline.json', ...JUDGED)
    expect(known.code).toBe(0)
    expect(known.out).toContain('No new confirmed failures in what was checked; the baseline holds back 9 known finding(s).')

    // A new image without an alternative, as the engine would report it.
    const engine = await json<EngineResults>(join(dir, 'store.engine.json'))
    const imageAlt = engine.rules.find((rule) => rule.ruleId === 'image-alt' && rule.outcome === 'violation')
    imageAlt?.nodes.push({ ref: 'html > body > footer > img', target: '["footer > img"]', html: '<img src="badge.svg">' })
    await writeFile(join(dir, 'store.engine.json'), JSON.stringify(engine))
    const fresh = rampa(dir, 'check', '--baseline', '.rampa/baseline.json', ...JUDGED, '-f', 'json', '-o', 'report.json')
    expect(fresh.code).toBe(1)
    const report = await json<Report>(join(dir, 'report.json'))
    expect(report.findings.map((finding) => finding.ref)).toEqual(['html > body > footer > img'])
    expect(report.baseline?.known).toHaveLength(9)
    const id = report.findings[0]?.fingerprint ?? ''

    const waive = rampa(dir, 'waive', id, '--reason', 'Badge leaves with the redesign', '--expires', '2099-12-31', '--report', 'report.json')
    expect(waive.code).toBe(0)
    const [waiver] = await json<Array<Record<string, string>>>(join(dir, '.rampa/waivers.json'))
    expect(waiver).toMatchObject({ fingerprint: id, reason: 'Badge leaves with the redesign', expires: '2099-12-31', criterion: '1.1.1', target: 'examples/store/before.html' })

    const waived = rampa(dir, 'check', '--baseline', '.rampa/baseline.json', ...JUDGED)
    expect(waived.code).toBe(0)
    expect(waived.out).toContain('1 finding(s) waived (rampa waivers lists why).')

    await writeFile(join(dir, '.rampa/waivers.json'), JSON.stringify([{ ...waiver, expires: '2000-01-01' }]))
    const expired = rampa(dir, 'check', '--baseline', '.rampa/baseline.json', ...JUDGED)
    expect(expired.code).toBe(1)
    expect(expired.out).toContain(`${id} expired on 2000-01-01: Badge leaves with the redesign`)

    const listed = rampa(dir, 'waivers', '--prune', '-f', 'json', '--report', 'report.json')
    expect(listed.code).toBe(0)
    expect(JSON.parse(listed.out)).toMatchObject({ pruned: [{ fingerprint: id }], waivers: [] })
    expect(await json(join(dir, '.rampa/waivers.json'))).toEqual([])
  })

  it('renews a waiver without losing what it was about', async () => {
    const dir = await storeProject()
    expect(rampa(dir, 'check', 'store.snapshot.json', '--no-llm', '-f', 'json', '-o', 'report.json').code).toBe(1)
    expect(rampa(dir, 'waive', '5f085d8a3b9c', '--reason', 'Logo is decorative', '--expires', '2099-01-31', '--report', 'report.json').code).toBe(0)
    const renewed = rampa(dir, 'waive', '5F085D8A3B9C', '--reason', 'Still decorative after the redesign')
    expect(renewed.code).toBe(0)
    expect(renewed.out).toContain('Updated the waiver of 5f085d8a3b9c')
    expect(renewed.out).toContain('It was due to expire on 2099-01-31; it now applies with no expiry date.')
    expect(await json(join(dir, '.rampa/waivers.json'))).toEqual([
      expect.objectContaining({
        fingerprint: '5f085d8a3b9c',
        reason: 'Still decorative after the redesign',
        criterion: '1.1.1',
        target: 'examples/store/before.html',
        ref: 'html > body > header > img',
      }),
    ])
    const [entry] = await json<Array<Record<string, unknown>>>(join(dir, '.rampa/waivers.json'))
    expect(entry?.expires).toBeUndefined()
  })

  it('refuses to record a baseline that would miss findings the model did not judge', async () => {
    const dir = await storeProject()
    const run = rampa(dir, 'baseline', 'store.snapshot.json', '--offline', '--model', 'ollama:gemma4:12b', '--cache-dir', join(dir, 'empty-cache'))
    expect(run.code).toBe(2)
    expect(run.err).toMatch(/not writing \.rampa\/baseline\.json: \d+ candidate\(s\) were not judged/)
  })

  it('stops with a clear error on a missing baseline, a broken waivers file or no targets', async () => {
    const dir = await storeProject()
    expect(rampa(dir, 'check', 'store.snapshot.json', '--no-llm', '--baseline', 'nope.json')).toMatchObject({ code: 2, err: expect.stringContaining('Baseline not found: nope.json') })
    expect(rampa(dir, 'check', '--no-llm')).toMatchObject({ code: 2, err: expect.stringContaining('No targets') })
    await writeFile(join(dir, 'broken.json'), '{')
    expect(rampa(dir, 'waivers', '--file', 'broken.json')).toMatchObject({ code: 2, err: expect.stringContaining('broken.json is not valid JSON') })
    expect(rampa(dir, 'waive', 'not-an-id', '--reason', 'x')).toMatchObject({ code: 2, err: expect.stringContaining('is not a finding id') })
    expect(rampa(dir, 'waive', '5f085d8a3b9c', '--reason', 'x', '--expires', '2001-01-01')).toMatchObject({ code: 2, err: expect.stringContaining('already past') })
  })
})
