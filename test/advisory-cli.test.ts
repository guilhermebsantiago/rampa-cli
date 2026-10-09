import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Report } from '../src/core/types.ts'
import { cadastroSnapshot } from './coga-snapshot.ts'

// End to end through the real CLI on a recorded snapshot: no browser, no network, no model. The page
// declares no language, so the abbreviation check needs no dictionary and says it did not run.
const CLI = resolve('src/cli.ts')
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('RAMPA_')))

function rampa(cwd: string, ...args: string[]) {
  // The locale and the model are pinned, so the run reads the same on any machine.
  const run = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', env: { ...env, NO_COLOR: '1', RAMPA_LOCALE: 'en', RAMPA_MODEL: '' } })
  return { code: run.status, out: run.stdout, err: run.stderr }
}

async function project(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'rampa-coga-'))
  const snapshot = cadastroSnapshot('test://cadastro')
  snapshot.locale = undefined
  snapshot.root.lang = undefined
  await writeFile(join(dir, 'cadastro.snapshot.json'), JSON.stringify(snapshot))
  await writeFile(join(dir, 'cadastro.engine.json'), JSON.stringify({ engine: { name: 'axe-core', version: 'test' }, rules: [] }))
  await writeFile(join(dir, 'package.json'), '{"type":"module"}\n')
  return dir
}

const json = async <T>(path: string) => JSON.parse(await readFile(path, 'utf8')) as T

describe('rampa check --profile cognitive', { timeout: 120_000 }, () => {
  it('adds advisories that change the exit code only under --fail-on advisory, and waive like findings', async () => {
    const dir = await project()
    const plain = rampa(dir, 'check', 'cadastro.snapshot.json', '--no-llm', '--profile', 'cognitive', '-f', 'json', '-o', 'report.json')
    expect(plain.code).toBe(0)
    const report = await json<Report>(join(dir, 'report.json'))
    expect(report.findings).toEqual([])
    expect(report.advisory?.results.map((advisory) => `${advisory.check} ${advisory.ref}`)).toEqual([
      'coga/input-formats #cep',
      'coga/preselected-cost #seguro',
      'coga/visible-labels #email',
    ])
    expect(report.advisory?.checks.find((check) => check.check === 'coga/abbreviations')).toMatchObject({ ran: false, reason: 'no text in Portuguese or English' })

    expect(rampa(dir, 'check', 'cadastro.snapshot.json', '--no-llm', '--profile', 'cognitive', '--fail-on', 'advisory', '-f', 'json').code).toBe(1)
    expect(rampa(dir, 'check', 'cadastro.snapshot.json', '--no-llm', '--profile', 'cognitive', '--fail-on', 'AA', '-f', 'json').code).toBe(0)

    const ids = report.advisory?.results.map((advisory) => advisory.fingerprint) ?? []
    for (const id of ids) expect(rampa(dir, 'waive', id, '--reason', 'Reviewed with the content team', '--report', 'report.json').code).toBe(0)
    const [waiver] = await json<Array<Record<string, string>>>(join(dir, '.rampa/waivers.json'))
    expect(waiver).toMatchObject({ fingerprint: ids[0], criterion: 'coga/input-formats', ref: '#cep' })
    const waived = rampa(dir, 'check', 'cadastro.snapshot.json', '--no-llm', '--profile', 'cognitive', '--fail-on', 'advisory', '-f', 'json')
    expect(waived.code).toBe(0)
    expect((JSON.parse(waived.out) as Report).advisory?.waived).toHaveLength(3)
  })

  it('reads the profile from the config, and refuses one it does not know', async () => {
    const dir = await project()
    await writeFile(join(dir, 'rampa.config.json'), JSON.stringify({ profiles: ['cognitive'] }))
    const configured = rampa(dir, 'check', 'cadastro.snapshot.json', '--no-llm')
    expect(configured.code).toBe(0)
    expect(configured.out).toContain('Advisories: cognitive accessibility (W3C COGA guidance, not WCAG requirements)')
    expect(configured.out).toContain('◇ Advisory · COGA o4p08 Accept different input formats (not a WCAG requirement) · barrier')
    expect(rampa(dir, 'check', 'cadastro.snapshot.json', '--no-llm', '--profile', 'dyslexia').code).toBe(2)
    await writeFile(join(dir, 'rampa.config.json'), JSON.stringify({ profiles: ['dyslexia'] }))
    expect(rampa(dir, 'check', 'cadastro.snapshot.json', '--no-llm')).toMatchObject({ code: 2, err: expect.stringContaining('Unknown profile "dyslexia"') })
  })
})
