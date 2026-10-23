// Robustness run: each site in sites.json, checked by the built CLI in three modes, with a wall-clock budget per page.
// Usage (from the repository root, after pnpm build):
//   node study/robustness-2026-10-23/run.mjs --modes default,cognitive,probe --concurrency 3 [--only id,id] [--tag after] [--cli dist/cli.mjs]
// Writes raw/<tag>/<id>.<mode>.json (the report), .stderr.txt, and appends one line per run to raw/<tag>/results.jsonl.
// No model: every run passes --no-llm, and RAMPA_MODEL is empty.
import { spawn, spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..', '..')
const args = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : fallback
}
const modes = arg('modes', 'default,cognitive,probe').split(',')
const concurrency = Number(arg('concurrency', '3'))
const only = arg('only', '')
const tag = arg('tag', 'before')
const cliPath = resolve(repo, arg('cli', 'dist/cli.mjs'))
const sites = JSON.parse(readFileSync(join(here, 'sites.json'), 'utf8')).filter((site) => !only || only.split(',').includes(site.id))
const out = join(here, 'raw', tag)
mkdirSync(out, { recursive: true })

const BUDGET = { default: 240_000, cognitive: 240_000, probe: 360_000 }
const EXTRA = { default: [], cognitive: ['--profile', 'cognitive'], probe: ['--probe', 'all'] }

function killTree(pid) {
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' })
  else process.kill(-pid, 'SIGKILL')
}

function summarize(file) {
  if (!existsSync(file)) return { report: false }
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    const report = Array.isArray(raw) ? raw[0] : raw
    const probes = report.coverage?.probes
    return {
      report: true,
      findings: report.findings?.length ?? 0,
      belowThreshold: report.belowThreshold?.length ?? 0,
      needsReview: report.needsReview?.length ?? 0,
      errors: report.errors ?? [],
      notes: report.notes ?? [],
      truncated: report.coverage?.truncated ?? undefined,
      notChecked: report.coverage?.notChecked?.length,
      engineCriteria: report.coverage?.engine?.length,
      advisories: report.advisory?.results?.length,
      advisoryByCheck: report.advisory ? Object.fromEntries((report.advisory.checks ?? []).map((check) => [check.check, check.ran ? check.results : `not run: ${check.reason ?? ''}`])) : undefined,
      probes,
      document: report.document,
      page: report.page,
    }
  } catch (error) {
    return { report: false, parseError: String(error) }
  }
}

async function runOne(site, mode) {
  const base = join(out, `${site.id}.${mode}`)
  const json = `${base}.json`
  // A report left by an earlier run of the same page would be read as this run's when this one writes none.
  rmSync(json, { force: true })
  const cli = [cliPath, 'check', site.url, '--no-llm', '--format', 'json', '-o', json, ...EXTRA[mode]]
  if (mode === 'default') cli.push('--save', join(out, 'recordings'))
  const started = Date.now()
  const child = spawn(process.execPath, cli, {
    cwd: repo,
    env: { ...process.env, RAMPA_LOCALE: 'en', RAMPA_MODEL: '', RAMPA_DEBUG: '1', NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  })
  let stderr = ''
  let stdout = ''
  child.stderr.on('data', (chunk) => (stderr += chunk))
  child.stdout.on('data', (chunk) => (stdout += chunk))
  let killed = false
  const timer = setTimeout(() => {
    killed = true
    killTree(child.pid)
  }, BUDGET[mode])
  const code = await new Promise((done) => child.on('close', (exit) => done(exit)))
  clearTimeout(timer)
  const ms = Date.now() - started
  writeFileSync(`${base}.stderr.txt`, stderr)
  if (stdout.trim()) writeFileSync(`${base}.stdout.txt`, stdout)
  const line = { id: site.id, group: site.group, url: site.url, mode, exit: killed ? 'killed' : code, ms, killed, stderr: stderr.slice(-2000), ...summarize(json) }
  appendFileSync(join(out, 'results.jsonl'), `${JSON.stringify(line)}\n`)
  process.stdout.write(`${new Date().toISOString().slice(11, 19)} ${site.id} ${mode} exit=${line.exit} ${(ms / 1000).toFixed(0)}s findings=${line.findings ?? '-'} errors=${line.errors?.length ?? '-'}\n`)
}

const queue = []
for (const mode of modes) for (const site of sites) queue.push([site, mode])
let next = 0
await Promise.all(
  Array.from({ length: concurrency }, async () => {
    while (next < queue.length) {
      const [site, mode] = queue[next++]
      await runOne(site, mode)
    }
  }),
)
