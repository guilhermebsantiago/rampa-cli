import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// The CLI on a recorded page with its recorded judgments: no browser, model or network.
const recorded = ['demo/recorded/examples-store-before.snapshot.json', '--offline', '--cache-dir', 'demo/recorded/cache', '--model', 'ollama:gemma4:12b']

function rampa(...args: string[]) {
  const run = spawnSync(process.execPath, ['src/cli.ts', 'check', ...args], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', RAMPA_LOCALE: 'en', RAMPA_MODEL: '' } })
  return { code: run.status, stdout: run.stdout, stderr: run.stderr }
}

describe('rampa check output', { timeout: 60_000 }, () => {
  it('prints the chosen format and writes any other format to its own file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rampa-cli-'))
    const file = (name: string) => join(dir, name)
    const run = rampa(...recorded, '--format', 'json', '--sarif', file('a.sarif'), '--markdown', file('a.md'), '--html', file('out/a.html'), '--json', file('a.json'))
    expect(run.code).toBe(1)
    const report = JSON.parse(run.stdout) as { sourceFile: string; findings: Array<{ location?: { file: string; startLine: number } }> }
    expect(report.sourceFile).toBe('examples/store/before.html')
    expect(report.findings[5]?.location).toMatchObject({ file: 'examples/store/before.html', startLine: 31 })
    expect(JSON.parse(readFileSync(file('a.json'), 'utf8'))).toEqual(report)
    expect((JSON.parse(readFileSync(file('a.sarif'), 'utf8')) as { version: string }).version).toBe('2.1.0')
    expect(readFileSync(file('a.md'), 'utf8')).toContain('**9 confirmed findings**')
    expect(readFileSync(file('out/a.html'), 'utf8').startsWith('<!doctype html>')).toBe(true)
  })

  it('writes the chosen format to -o instead of the terminal', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rampa-cli-'))
    const run = rampa(...recorded, '--format', 'sarif', '-o', join(dir, 'report.sarif'))
    expect(run.stdout).toBe('')
    expect((JSON.parse(readFileSync(join(dir, 'report.sarif'), 'utf8')) as { runs: Array<{ results: unknown[] }> }).runs[0]?.results).toHaveLength(9)
  })

  it('keeps -o with the terminal report as it was: the file gets the JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rampa-cli-'))
    const run = rampa(...recorded, '-o', join(dir, 'report.json'))
    expect(run.stdout).toContain('Coverage of this run')
    // Engine findings print their id too, so they can be waived from the terminal.
    expect(run.stdout).toContain('high · rule image-alt · id 5f085d8a3b9c')
    expect((JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8')) as { findings: unknown[] }).findings).toHaveLength(9)
    expect(existsSync(join(dir, 'report.sarif'))).toBe(false)
  })

  it('speaks Portuguese in Markdown with --locale pt-BR', () => {
    const run = rampa(...recorded, '--format', 'markdown', '--locale', 'pt-BR')
    expect(run.stdout).toContain('## Relatório de acessibilidade do Rampa')
  })

  it('gates the exit code on --fail-on, and a usage error is 2, never 1', () => {
    expect(rampa(...recorded, '--format', 'json', '--fail-on', 'none').code).toBe(0)
    expect(rampa(...recorded, '--format', 'json', '--fail-on', 'aa').code).toBe(1)
    const wrong = rampa(...recorded, '--fail-on', 'AAA')
    expect(wrong.code).toBe(2)
    expect(wrong.stderr).toContain("argument 'AAA' is invalid. Allowed choices are confirmed, any, A, AA, advisory, none, never.")
    expect(rampa(...recorded, '--format', 'xml').code).toBe(2)
  })
})
