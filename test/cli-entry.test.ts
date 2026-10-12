import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

describe('the rampa command', () => {
  it('exits 2 when a module fails to load, where Node exited 1, the code for findings', () => {
    // The preload makes src/version.ts throw as it is evaluated, as a broken install or a failing dependency would.
    const preload = pathToFileURL(resolve('test/fixtures/broken-module.mjs')).href
    const run = spawnSync(process.execPath, ['--import', preload, resolve('src/cli.ts'), '--version'], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } })
    expect(run.status).toBe(2)
    expect(run.stderr).toContain('rampa: a module failed to load')
  })

  it('still runs as before when everything loads', () => {
    const run = spawnSync(process.execPath, [resolve('src/cli.ts'), '--version'], { encoding: 'utf8' })
    expect(run.status).toBe(0)
    expect(run.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/)
  })
})
