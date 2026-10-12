#!/usr/bin/env node
// The benchmark in one command. From bench/, after `pnpm install` here and `pnpm install && pnpm build` at the root:
//
//   node run.mjs                 every row, results in results/<today>/, resumes an interrupted run
//   node run.mjs --docs          and write the tables into ../docs/benchmark.md
//
// Options:
//   --tools a,b      only these rows (lib/tools.mjs: axe, lighthouse, pa11y, pa11y-axe, ibm, alfa, qualweb,
//                    rampa, rampa-gemma, rampa-probes)
//   --out <dir>      results folder (default results/<YYYY-MM-DD>)
//   --workers <n>    pages at a time per tool (default 2)
//   --limit <n>      a smoke test: the first n cases of each ACT rule and the first n pairs of each corruptor
//   --port <n>       the local server for pair pages (default 8765)
//   --fresh          start the folder over instead of resuming it
//   --retry-errors   also check again the pages a tool could not load for a reason of the network or the machine
//   --score-only     run nothing, score what the folder has
//   --docs           write the tables into ../docs/benchmark.md (between its bench:tables markers)
import { execFileSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cpus, release, totalmem, type } from 'node:os'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, join, relative, resolve } from 'node:path'
import { homeRules, loadCases, pairSpecs, rampaEval } from './lib/cases.mjs'
import { BENCH, CACHE, ROOT, arg, browserPath, readJson, readJsonl, writeJson } from './lib/env.mjs'
import { buildPairs } from './lib/pairs.mjs'
import { renderReport, renderSummary, updateDocs } from './lib/report.mjs'
import { scoreAll } from './lib/score.mjs'
import { startServer } from './lib/server.mjs'
import { DEFAULT_ORDER, TOOLS } from './lib/tools.mjs'

const today = new Date().toISOString().slice(0, 10)
const out = resolve(BENCH, arg('out', join('results', today)))
const runName = basename(out)
const work = join(CACHE, 'work', runName)
const workers = Number(arg('workers', 2))
const limit = arg('limit') ? Number(arg('limit')) : undefined
const port = Number(arg('port', 8765))
const selected = arg('tools') ? String(arg('tools')).split(',') : DEFAULT_ORDER
for (const id of selected) if (!TOOLS[id]) throw new Error(`Unknown tool ${id}; known: ${DEFAULT_ORDER.join(', ')}`)
const log = (message) => process.stderr.write(`${message}\n`)

if (arg('fresh')) {
  await rm(out, { recursive: true, force: true })
  await rm(work, { recursive: true, force: true })
}
await mkdir(join(out, 'raw'), { recursive: true })

// 1. The test cases, from Rampa's own eval build.
const cases = await loadCases()
if (limit !== undefined) {
  const seen = new Map()
  cases.cases = cases.cases.filter((testcase) => {
    const n = seen.get(testcase.ruleId) ?? 0
    seen.set(testcase.ruleId, n + 1)
    return n < limit
  })
}
const home = await homeRules(cases.rules.map((rule) => rule.ruleId))
// Where the file sits on this machine stays out of the results.
const { path: _path, ...actFile } = cases.dataset
await writeJson(join(out, 'cases.json'), {
  dataset: actFile,
  limit: limit ?? null,
  excluded: cases.excluded,
  rules: cases.rules,
  home,
  cases: cases.cases.map(({ id, ruleId, title, expected, criteria, url }) => ({ id, ruleId, title, expected, criteria, url })),
}, { compact: true })
cases.home = home
log(`ACT ${cases.dataset.sha256.slice(0, 8)}: ${cases.rules.length} rules, ${cases.cases.length} test cases; Rampa was tuned on ${home.length} of the rules`)

// 2. The pairs, built once per results folder and served locally.
const served = new Map()
const server = arg('score-only') ? undefined : await startServer({ port, served, cacheDir: join(CACHE, 'w3c') })
const origin = server?.origin ?? `http://127.0.0.1:${port}`
let pairs
const pairsFile = join(out, 'pairs.json')
const pairDir = join(CACHE, 'pairs', runName)
if (existsSync(pairsFile) && existsSync(pairDir)) {
  pairs = await readJson(pairsFile)
  for (const [key, file] of pairs.served) served.set(key, join(pairDir, file))
} else if (!arg('score-only')) {
  const { specs, corruptors } = await pairSpecs()
  let chosen = specs
  if (limit !== undefined) {
    const seen = new Map()
    chosen = specs.filter((spec) => {
      const n = seen.get(spec.corruptor) ?? 0
      seen.set(spec.corruptor, n + 1)
      return n < limit
    })
  }
  log(`Building ${chosen.length} corrupted pairs…`)
  const built = await buildPairs(chosen, corruptors, { dir: pairDir, origin, log: () => {} })
  // An intact half no pair uses (every corruptor left its page unchanged) is not run.
  const used = new Set(built.pairs.map((pair) => pair.intactId))
  const pages = built.pages.filter((page) => page.kind !== 'pair-intact' || used.has(page.id))
  pairs = {
    pairs: built.pairs,
    dropped: built.dropped,
    pages,
    notes: built.notes,
    served: [...built.served.entries()].map(([key, file]) => [key, relative(pairDir, file)]),
  }
  for (const [key, file] of built.served) served.set(key, file)
  await writeJson(pairsFile, pairs, { compact: true })
  log(`${pairs.pairs.length} pairs (${pairs.dropped.length} copies the corruptor left unchanged)`)
}

// 3. Every page every tool runs on.
const actPages = cases.cases.map((testcase) => ({ id: testcase.id, url: testcase.url, kind: 'act' }))
const allPages = [...actPages, ...(pairs?.pages ?? []).map(({ id, url, kind }) => ({ id, url, kind }))]
await writeJson(join(work, 'pages.json'), allPages)

async function pagesFor(id) {
  const spec = TOOLS[id]
  if (spec.sample) {
    const seen = new Map()
    return actPages.filter((page) => {
      const ruleId = cases.cases.find((c) => c.id === page.id).ruleId
      const n = seen.get(ruleId) ?? 0
      seen.set(ruleId, n + 1)
      return n < spec.sample
    })
  }
  if (spec.probesOnly) {
    const probed = await probeScope(id)
    return allPages.filter((page) => probed(page.id))
  }
  return allPages
}

/**
 * The pages a probes-only row runs, and is scored on: those of the criteria a probe of the kinds its --probe runs
 * checks. Not every probe rule's criteria: `--probe all` leaves the opt-in kinds out, and a page of a criterion only
 * they check (1.1.1, 2.4.4, 3.1.1) would be loaded once per probe for nothing. It could only lose what the row it
 * inherits from found, when the server refuses a reload: W3C's answered a test image many pages share with a
 * challenge (HTTP 429) to headless Edge, and the row lost an object-alt violation and two 1.1.1 judgments.
 */
async function probeScope(id) {
  const spec = TOOLS[id]
  const { probedCriteria } = await rampaEval()
  const probed = new Set(probedCriteria(spec.args[spec.args.indexOf('--probe') + 1]))
  const byId = new Map(cases.cases.map((c) => [c.id, c]))
  const pairById = new Map((pairs?.pairs ?? []).flatMap((pair) => [[pair.intactId, pair], [pair.corruptedId, pair]]))
  return (pageId) => (byId.get(pageId)?.criteria ?? [pairById.get(pageId)?.criterion]).some((criterion) => probed.has(criterion))
}

function run(command, args) {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [command, ...args], { cwd: BENCH, stdio: ['ignore', 'inherit', 'inherit'] })
    child.on('close', (code) => resolveRun(code))
  })
}

async function ollamaReady(model) {
  try {
    const response = await fetch(`${process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434'}/api/tags`, { signal: AbortSignal.timeout(5_000) })
    const { models } = await response.json()
    return models.some((m) => m.name === model || m.model === model)
  } catch {
    return false
  }
}

// 4. Each row, one after another, so their times do not compete.
const runLog = []
if (!arg('score-only')) {
  for (const id of selected) {
    const spec = TOOLS[id]
    const pages = await pagesFor(id)
    const pagesFile = join(work, id, 'pages.json')
    await writeJson(pagesFile, pages)
    const common = ['--pages', pagesFile, '--out', join(out, 'raw', `${id}.jsonl`), '--meta', join(out, 'raw', `${id}.meta.json`), '--workers', String(workers), ...(arg('retry-errors') ? ['--retry-errors'] : [])]
    if (spec.args?.includes('--model')) {
      const model = spec.args[spec.args.indexOf('--model') + 1].replace(/^ollama:/, '')
      if (!(await ollamaReady(model))) {
        log(`Skipping ${id}: Ollama does not have ${model} (ollama pull ${model})`)
        runLog.push({ id, skipped: `Ollama does not have ${model}` })
        continue
      }
    }
    log(`\n== ${spec.label}: ${pages.length} pages`)
    const started = Date.now()
    const code =
      spec.runner === 'rampa'
        ? await run('tools/rampa.mjs', [id, ...common, '--work', join(work, id), ...(spec.shareCache ? ['--cache', join(work, spec.shareCache, 'judgments')] : [])])
        : await run('lib/drive.mjs', [id, ...common])
    runLog.push({ id, exit: code, seconds: Math.round((Date.now() - started) / 1000) })
    if (code !== 0) log(`${id} exited with ${code}; its partial results are kept and the next run resumes it`)
  }
}
await server?.close()

// 5. Scores and tables.
const tools = []
for (const id of DEFAULT_ORDER) {
  const file = join(out, 'raw', `${id}.jsonl`)
  if (!existsSync(file)) continue
  // A probes-only row is scored on the pages it runs, as probeScope picks them now; a record from a run that picked
  // more pages is left out, and its page keeps the result of the row it inherits from.
  const probed = TOOLS[id].probesOnly ? await probeScope(id) : undefined
  const records = new Map((await readJsonl(file)).filter((record) => !probed || probed(record.id)).map((record) => [record.id, record]))
  const metaFile = join(out, 'raw', `${id}.meta.json`)
  const meta = existsSync(metaFile) ? await readJson(metaFile) : {}
  tools.push({ id, label: TOOLS[id].label, runner: TOOLS[id].runner, inherit: TOOLS[id].inherit, scored: TOOLS[id].scored, records, meta })
}
const ev = await rampaEval()
const levels = Object.fromEntries(ev.WCAG22_A_AA.map((sc) => [sc.id, sc.level]))
const names = Object.fromEntries(ev.WCAG22_A_AA.map((sc) => [sc.id, sc.name.en]))
const scores = await scoreAll({ cases, home, pairs: pairs ?? { pairs: [] }, tools, wcag22: ev.WCAG22_A_AA.map((sc) => sc.id), levels })

const git = (...args) => {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim()
  } catch {
    return undefined
  }
}
const previous = existsSync(join(out, 'run.json')) ? await readJson(join(out, 'run.json')) : {}
/** The Ollama and the Gemma weights the judged rows ran on, when Ollama answers. */
async function ollamaInfo() {
  const base = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434'
  try {
    const version = (await (await fetch(`${base}/api/version`, { signal: AbortSignal.timeout(5_000) })).json()).version
    const { models } = await (await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(5_000) })).json()
    const gemma = models.find((m) => m.name === 'gemma4:12b')
    return { version, model: gemma ? { name: gemma.name, digest: gemma.digest, quantization: gemma.details?.quantization_level, parameters: gemma.details?.parameter_size } : undefined }
  } catch {
    return previous.ollama
  }
}
/** Scoring alone runs no tool, so the run keeps the date and commit its rows ran at, and records what scored them. */
const rescored = Boolean(arg('score-only') && previous.rampaCommit)
const runInfo = {
  date: rescored ? previous.date : today,
  rampaCommit: rescored ? previous.rampaCommit : git('rev-parse', '--short', 'HEAD'),
  rampaDirty: rescored ? previous.rampaDirty : Boolean(git('status', '--porcelain', '--', 'src')),
  ...(rescored ? { scoredAt: git('rev-parse', '--short', 'HEAD') } : {}),
  rampaVersion: ev.VERSION,
  node: process.version,
  os: `${type()} ${release()}`,
  cpu: `${cpus()[0]?.model.trim()} (${cpus().length} threads)`,
  memoryGb: Math.round(totalmem() / 2 ** 30),
  browser: browserPath(),
  ollama: await ollamaInfo(),
  act: actFile,
  workers,
  limit: limit ?? null,
  runs: [...(previous.runs ?? []), ...(runLog.length ? [{ at: new Date().toISOString(), rows: runLog }] : [])],
}
await writeJson(join(out, 'run.json'), runInfo)
await writeJson(join(out, 'scores.json'), scores, { compact: true })
const reportInput = { scores, cases, pairs: pairs ?? { pairs: [], dropped: [], notes: {} }, run: runInfo, names, levels, tools: TOOLS }
const summary = renderSummary(reportInput)
const markdown = renderReport(reportInput)
await writeFile(join(out, 'tables.md'), `${summary}\n${markdown}`, 'utf8')
log(`\nResults: ${relative(process.cwd(), out)} (tables.md, scores.json, raw/)`)
if (arg('docs')) {
  await updateDocs(join(ROOT, 'docs', 'benchmark.md'), { tables: markdown, summary }, relative(ROOT, out).replaceAll('\\', '/'))
  log('docs/benchmark.md updated')
}
