// Rampa, run as a user runs it: this repository's dist/cli.mjs (`pnpm build` at the root), `rampa check` on a chunk
// of URLs at a time with --format json, one process per chunk.
//   node tools/rampa.mjs <tool> --pages <pages.json> --out <tool.jsonl> --meta <tool.meta.json> --work <dir> [--workers 2]
// The time of a page is the gap between the createdAt of its report and the one before it (collection, axe-core,
// rules, judgments and probes); the first page of each chunk also pays for starting Node and the browser, so it is
// marked cold and left out of the per-page times.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { appendFile, mkdir, readFile, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { ROOT, TRANSIENT_ERROR, addHit, arg, browserPath, readJson, resumeRecords, sleep, startSegment, writeJson } from '../lib/env.mjs'
import { TOOLS } from '../lib/tools.mjs'

const CHUNK = 20
const CLI = join(ROOT, 'dist', 'cli.mjs')

const id = process.argv[2]
const spec = TOOLS[id]
if (spec?.runner !== 'rampa') throw new Error(`Not a Rampa row: ${id}`)
if (!existsSync(CLI)) throw new Error(`${CLI} is missing: run pnpm build at the repository root first`)
const pages = await readJson(arg('pages'))
const out = arg('out')
const work = resolve(arg('work'))
const workers = Math.max(1, Number(arg('workers', 2)))
const cacheDir = resolve(arg('cache', join(work, 'judgments')))
await mkdir(dirname(out), { recursive: true })
await mkdir(join(work, 'chunks'), { recursive: true })
const { done, retried } = await resumeRecords(out, Boolean(arg('retry-errors')))
if (retried) process.stderr.write(`  ${id}: checking ${retried} page(s) again after a network error
`)
const todo = pages.filter((page) => !done.has(page.id))

/** The environment of every run: the shared Edge, English, no model unless the row names one, and no provider key. */
function childEnv() {
  const env = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (/(_API_KEY|_TOKEN|_SECRET|_ACCESS_KEY_ID|_BEARER_TOKEN\w*)$/i.test(key) || key.startsWith('RAMPA_')) continue
    env[key] = value
  }
  return { ...env, RAMPA_BROWSER_PATH: browserPath(), RAMPA_LOCALE: 'en', RAMPA_MODEL: '', NO_COLOR: '1' }
}

function runCli(urls, file, log) {
  // cwd is the row's own folder: no rampa.config or .env of the repository applies, and .rampa/destinations
  // (the pages links lead to, for 2.4.4) is the row's own.
  const args = [CLI, 'check', ...urls, ...spec.args, '--format', 'json', '-o', file, '--fail-on', 'none', '--cache-dir', cacheDir]
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: work, env: childEnv(), stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (data) => {
      stderr += data
    })
    child.on('close', async (code) => {
      if (stderr.trim()) await appendFile(log, `--- ${new Date().toISOString()} exit ${code} (${urls.length} pages)\n${stderr}\n`, 'utf8')
      resolve({ code, stderr })
    })
  })
}

/** Criteria where a method that can report a failure ran: what this configuration of Rampa claims to check. */
const claimed = new Set()

function readReport(report) {
  for (const criterion of report.coverage?.criteria ?? []) {
    if (criterion.methods.some((method) => method.ran && !method.reviewOnly && !method.inventory)) claimed.add(criterion.id)
  }
  const record = { fail: {}, review: {}, low: {}, failRules: [], other: 0 }
  const label = (finding) => `${finding.source}:${finding.ruleId ?? finding.criterion}`
  for (const finding of report.findings ?? []) {
    if (finding.beyondTarget) continue
    const name = label(finding)
    if (!record.failRules.includes(name)) record.failRules.push(name)
    if (!/^\d+\.\d+\.\d+$/.test(finding.criterion)) record.other++
    else addHit(record.fail, finding.criterion, name)
  }
  // Below the default threshold: what `rampa check` shows only with --verbose and never fails a build on.
  for (const finding of report.belowThreshold ?? []) if (/^\d+\.\d+\.\d+$/.test(finding.criterion)) addHit(record.low, finding.criterion, label(finding))
  for (const item of report.needsReview ?? []) if (/^\d+\.\d+\.\d+$/.test(item.criterion)) addHit(record.review, item.criterion, `review:${item.ruleId}`)
  // A finding names one criterion, but the report's coverage gives every criterion its status: an axe-core rule mapped
  // to two criteria (link-name: 2.4.4 and 4.1.2) is reported under the first and makes both "failures". The coverage
  // status is Rampa's own verdict per criterion, as axe-core's tags are axe-core's.
  const methodLabel = (method) => `${method.kind === 'axe' ? 'engine' : method.kind}:${method.id}`
  for (const criterion of report.coverage?.criteria ?? []) {
    const failing = criterion.methods.filter((method) => method.failures > 0).map(methodLabel)
    if (criterion.status === 'failures' && !record.fail[criterion.id]) for (const name of failing.length ? failing : ['coverage']) addHit(record.fail, criterion.id, name)
    if (criterion.status === 'needs-review' && !record.low[criterion.id] && !record.review[criterion.id]) addHit(record.review, criterion.id, 'coverage:needs-review')
  }
  record.usage = { calls: report.usage?.calls ?? 0, cachedCalls: report.usage?.cachedCalls ?? 0, latencyMs: report.usage?.latencyMs ?? 0 }
  if (report.errors?.length) record.modelErrors = report.errors.slice(0, 3)
  return record
}

let chunkNo = 0
async function runChunk(chunk, retried = false) {
  const n = chunkNo++
  const file = join(work, 'chunks', `${n}.json`)
  const log = join(work, 'stderr.log')
  await rm(file, { force: true })
  const started = Date.now()
  const { code, stderr } = await runCli(chunk.map((page) => page.url), file, log)
  let reports
  if (existsSync(file)) {
    const parsed = JSON.parse(await readFile(file, 'utf8'))
    reports = Array.isArray(parsed) ? parsed : [parsed]
  }
  if (!reports || reports.length !== chunk.length) {
    // One page that cannot be checked stops the whole command: check each page alone to find it.
    if (chunk.length > 1) {
      for (const page of chunk) await runChunk([page])
      return
    }
    const error = (stderr.trim().split('\n').find((line) => line.trim() !== '') ?? `exit ${code}`).slice(0, 300)
    // The network dropped: once more, after a pause.
    if (!retried && TRANSIENT_ERROR.test(stderr)) {
      await sleep(15_000)
      return runChunk(chunk, true)
    }
    await appendFile(out, `${JSON.stringify({ id: chunk[0].id, ms: Date.now() - started, cold: true, error, fail: {}, review: {} })}\n`, 'utf8')
    return
  }
  let previous = started
  const lines = []
  for (const [index, page] of chunk.entries()) {
    const report = reports[index]
    const at = Date.parse(report.createdAt)
    lines.push(JSON.stringify({ id: page.id, ms: at - previous, ...(index === 0 ? { cold: true } : {}), ...readReport(report) }))
    previous = at
  }
  await appendFile(out, `${lines.join('\n')}\n`, 'utf8')
}

const version = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8')).version
// Claims are read from the reports; a resumed run keeps what the earlier part recorded.
const segment = await startSegment(arg('meta'))
if (todo.length === 0) process.exit(0)
const before = segment.previous.claimed ?? []
const meta = { tool: id, label: spec.label, versions: { rampa: `${version} (dist/cli.mjs)`, args: spec.args.join(' '), browser: `the same Microsoft Edge, through RAMPA_BROWSER_PATH` }, workers, chunk: CHUNK }
await writeJson(arg('meta'), { ...meta, claimed: before, segments: segment.segments })

const chunks = []
for (let i = 0; i < todo.length; i += CHUNK) chunks.push(todo.slice(i, i + CHUNK))
let next = 0
let finished = 0
await Promise.all(
  Array.from({ length: Math.min(workers, Math.max(1, chunks.length)) }, async () => {
    while (next < chunks.length) {
      const chunk = chunks[next++]
      await runChunk(chunk)
      finished += chunk.length
      process.stderr.write(`  ${id}: ${finished}/${todo.length}\n`)
    }
  }),
)
await writeJson(arg('meta'), {
  ...meta,
  claimed: [...new Set([...before, ...claimed])],
  segments: [...segment.segments, { startedAt: segment.startedAt, finishedAt: new Date().toISOString(), pages: todo.length }],
})
