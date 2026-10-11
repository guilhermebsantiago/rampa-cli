// Measures where Rampa's time goes on real pages (docs/performance.md): `rampa check --timings` on each page, every run
// in a fresh working directory, so no judgment, destination or OCR cache carries over; then the median per stage.
//
//   node scripts/timings.ts <label> [--repeats 3] [--pages url,url] -- <rampa check options>
//
// The runs and a summary go to .rampa/timings/<label>.json. Each page runs in its own process, so every total
// includes the browser's launch. Pages default to the three of docs/performance.md.

import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Report } from '../src/core/types.ts'

const PAGES = ['https://www.gov.br/pt-br', 'https://webaim.org/techniques/alttext/', 'https://www.debian.org/']
const CLI = resolve('src/cli.ts')
const OUT = resolve('.rampa/timings')

const argv = process.argv.slice(2)
const split = argv.indexOf('--')
const own = split < 0 ? argv : argv.slice(0, split)
const extra = split < 0 ? [] : argv.slice(split + 1)
const label = own[0]
if (!label || label.startsWith('--')) throw new Error('usage: node scripts/timings.ts <label> [--repeats n] [--pages a,b] -- <rampa check options>')
const option = (name: string) => {
  const at = own.indexOf(name)
  return at < 0 ? undefined : own[at + 1]
}
const repeats = Math.max(1, Number(option('--repeats') ?? 3))
const pages = option('--pages')?.split(',') ?? PAGES

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
}

interface PageResult {
  page: string
  runs: number
  /** Medians, in milliseconds: the report's total, the whole process (Node's start and the report's writing included), each stage. */
  totalMs: number
  processMs: number
  stages: Record<string, number>
  /** From the last run: what each criterion had and judged, the findings, the notes and the model's usage. */
  criteria: Array<{ criterion: string; candidates: number; judged: number; calls: number; cachedCalls: number }>
  findings: number
  belowThreshold: number
  notes: string[]
  usage: Report['usage']
  totals: number[]
}

mkdirSync(OUT, { recursive: true })
const results: PageResult[] = []
for (const page of pages) {
  const runs: Array<{ processMs: number; report: Report }> = []
  for (let run = 0; run < repeats; run++) {
    const cwd = mkdtempSync(join(OUT, 'cwd-'))
    const out = join(cwd, 'report.json')
    const started = Date.now()
    const child = spawnSync(process.execPath, [CLI, 'check', page, '--timings', '--format', 'json', '-o', out, '--fail-on', 'none', ...extra], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, NO_COLOR: '1', RAMPA_LOCALE: process.env.RAMPA_LOCALE ?? 'en', RAMPA_MODEL: '' },
      timeout: 900_000,
    })
    const processMs = Date.now() - started
    if (child.status !== 0) {
      process.stderr.write(`${page} run ${run + 1}: exit ${child.status}\n${child.stderr}\n`)
      continue
    }
    const report = JSON.parse(readFileSync(out, 'utf8')) as Report
    runs.push({ processMs, report })
    process.stderr.write(`${label} · ${page} · run ${run + 1}: ${((report.timings?.totalMs ?? 0) / 1000).toFixed(2)} s\n`)
  }
  const last = runs.at(-1)?.report
  if (!last?.timings) continue
  const stages: Record<string, number[]> = {}
  for (const { report } of runs) {
    const timings = report.timings
    if (!timings) continue
    for (const stage of timings.stages) (stages[stage.stage] ??= []).push(stage.ms)
    for (const criterion of timings.criteria) (stages[`judgment ${criterion.criterion}`] ??= []).push(criterion.ms)
    ;(stages.other ??= []).push(timings.otherMs)
  }
  results.push({
    page,
    runs: runs.length,
    totalMs: median(runs.map((r) => r.report.timings?.totalMs ?? 0)),
    processMs: median(runs.map((r) => r.processMs)),
    stages: Object.fromEntries(Object.entries(stages).map(([stage, values]) => [stage, median(values)])),
    criteria: last.timings.criteria.map(({ criterion, candidates, judged, calls, cachedCalls }) => ({ criterion, candidates, judged, calls, cachedCalls })),
    findings: last.findings.length,
    belowThreshold: last.belowThreshold.length,
    notes: last.notes ?? [],
    usage: last.usage,
    totals: runs.map((r) => r.report.timings?.totalMs ?? 0),
  })
}
writeFileSync(join(OUT, `${label}.json`), `${JSON.stringify({ label, options: extra, repeats, results }, null, 2)}\n`)

const s = (ms: number) => `${(ms / 1000).toFixed(2)} s`
for (const result of results) {
  process.stdout.write(`\n${result.page} · ${label}: ${s(result.totalMs)} (median of ${result.runs}; process ${s(result.processMs)})\n`)
  for (const [stage, ms] of Object.entries(result.stages).sort((a, b) => b[1] - a[1])) {
    if (ms >= 5) process.stdout.write(`  ${stage.padEnd(28)}${s(ms).padStart(9)} ${`${Math.round((ms / result.totalMs) * 100)}%`.padStart(4)}\n`)
  }
}
