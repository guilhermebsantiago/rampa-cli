#!/usr/bin/env node
/**
 * The hook for the pre-commit framework (.pre-commit-hooks.yaml). pre-commit clones this
 * repository and runs this script with the hook's args followed by the staged HTML files.
 * The first run installs and builds Rampa inside that clone, with pnpm and the lockfile,
 * so the dependencies are the reviewed ones; later runs start at once.
 * It needs what rampa needs: Node.js 22.12+ and Chrome or Edge.
 *
 * Plain JavaScript, so it runs on every Node.js that Rampa supports.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// RAMPA_HOOK_ROOT points the hook at another build; the tests use it.
const root = process.env.RAMPA_HOOK_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), '..')
const cli = join(root, 'dist', 'cli.mjs')
// On Windows, pnpm and corepack are .cmd files, which only a shell can start. The arguments are fixed.
const shell = process.platform === 'win32'
const env = { ...process.env, COREPACK_ENABLE_DOWNLOAD_PROMPT: '0' }

/** pnpm, or pnpm through corepack, whichever this machine has. */
function findPnpm() {
  for (const command of [['pnpm'], ['corepack', 'pnpm']]) {
    const probe = spawnSync(command[0], [...command.slice(1), '--version'], { cwd: root, env, shell, stdio: 'ignore' })
    if (probe.status === 0) return command
  }
  return undefined
}

if (!existsSync(cli)) {
  const pnpm = findPnpm()
  if (!pnpm) {
    console.error('rampa: the first run builds Rampa, which needs pnpm. Run "corepack enable" or "npm install --global pnpm" and commit again.')
    process.exit(2)
  }
  console.error('rampa: building Rampa for pre-commit; this happens once.')
  for (const step of [['install', '--frozen-lockfile'], ['build']]) {
    const run = spawnSync(pnpm[0], [...pnpm.slice(1), ...step], { cwd: root, env, shell, stdio: ['ignore', 'inherit', 'inherit'] })
    if (run.status !== 0) {
      console.error(`rampa: "pnpm ${step.join(' ')}" failed in ${root}.`)
      process.exit(2)
    }
  }
}

const run = spawnSync(process.execPath, [cli, 'check', ...process.argv.slice(2)], { stdio: 'inherit' })
process.exit(run.status ?? 2)
