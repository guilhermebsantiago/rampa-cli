// Runs one in-process tool over a list of pages with a few workers, one JSON line per page.
//   node lib/drive.mjs <tool> --pages <pages.json> --out <tool.jsonl> --meta <tool.meta.json> [--workers 2]
// Lines already in --out are kept, so an interrupted run resumes where it stopped.
import { appendFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { arg, browserPath, readJson, readJsonl, writeJson } from './env.mjs'
import { TOOLS } from './tools.mjs'

const PAGE_TIMEOUT_MS = 180_000

const id = process.argv[2]
const spec = TOOLS[id]
if (!spec?.module) throw new Error(`Unknown in-process tool: ${id}`)
const pages = await readJson(arg('pages'))
const out = arg('out')
const workers = Math.max(1, Number(arg('workers', 2)))
await mkdir(dirname(out), { recursive: true })
const done = new Set((await readJsonl(out)).map((record) => record.id))
const todo = pages.filter((page) => !done.has(page.id))

const tool = await import(new URL(spec.module, import.meta.url).href)
const startedAt = new Date().toISOString()
const ctx = await tool.setup({ browserPath: browserPath(), ...(spec.options ?? {}) })
await writeJson(arg('meta'), { tool: id, label: spec.label, versions: ctx.versions, claimed: ctx.claimed ?? null, notes: ctx.notes ?? [], workers, startedAt })

function withTimeout(promise, ms) {
  let timer
  return Promise.race([promise, new Promise((_, reject) => (timer = setTimeout(() => reject(new Error(`timed out after ${ms / 1000} s`)), ms)))]).finally(() =>
    clearTimeout(timer),
  )
}

let next = 0
let finished = 0
async function loop() {
  let worker = await ctx.worker()
  while (next < todo.length) {
    const page = todo[next++]
    let record
    for (let attempt = 0; attempt < 2 && !record?.ok; attempt++) {
      const started = performance.now()
      try {
        const result = await withTimeout(worker.check(page), PAGE_TIMEOUT_MS)
        record = { id: page.id, ms: Math.round(performance.now() - started), ok: true, ...result }
      } catch (error) {
        record = { id: page.id, ms: Math.round(performance.now() - started), ok: false, error: String(error?.message ?? error).split('\n')[0].slice(0, 300), fail: {}, review: {} }
        // A worker that failed may be broken (a crashed page or browser): the next attempt gets a fresh one.
        await worker.close().catch(() => {})
        worker = await ctx.worker()
      }
    }
    delete record.ok
    await appendFile(out, `${JSON.stringify(record)}\n`, 'utf8')
    finished++
    if (finished % 25 === 0 || finished === todo.length) process.stderr.write(`  ${id}: ${finished}/${todo.length}\n`)
  }
  await worker.close()
}

try {
  await Promise.all(Array.from({ length: Math.min(workers, Math.max(1, todo.length)) }, loop))
} finally {
  await ctx.close?.()
}
await writeJson(arg('meta'), { tool: id, label: spec.label, versions: ctx.versions, claimed: ctx.claimed ?? null, notes: ctx.notes ?? [], workers, startedAt, finishedAt: new Date().toISOString() })
