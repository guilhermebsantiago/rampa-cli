import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('pre-commit hook', () => {
  it('passes its args and the staged files to rampa check, and its exit code back', () => {
    // A stand-in for the built CLI, so the test never builds Rampa.
    const root = mkdtempSync(join(tmpdir(), 'rampa-hook-'))
    mkdirSync(join(root, 'dist'))
    writeFileSync(join(root, 'dist', 'cli.mjs'), 'process.stdout.write(JSON.stringify(process.argv.slice(2)))\nprocess.exit(Number(process.env.FAKE_EXIT ?? 0))\n')
    const hook = (exit: string) =>
      spawnSync(process.execPath, ['scripts/pre-commit.mjs', '--no-llm', 'site/a.html', 'site/b c.html'], {
        encoding: 'utf8',
        env: { ...process.env, RAMPA_HOOK_ROOT: root, FAKE_EXIT: exit },
      })
    const pass = hook('0')
    expect(pass.status).toBe(0)
    expect(JSON.parse(pass.stdout)).toEqual(['check', '--no-llm', 'site/a.html', 'site/b c.html'])
    expect(hook('1').status).toBe(1)
    expect(hook('2').status).toBe(2)
  })

  it('is declared for HTML files, in one run for all of them', () => {
    const hooks = readFileSync('.pre-commit-hooks.yaml', 'utf8')
    for (const line of ['- id: rampa', 'entry: scripts/pre-commit.mjs', 'language: script', 'types: [html]', 'args: [--no-llm]', 'require_serial: true']) {
      expect(hooks).toContain(line)
    }
    expect(readFileSync('scripts/pre-commit.mjs', 'utf8').startsWith('#!/usr/bin/env node\n')).toBe(true)
  })
})
