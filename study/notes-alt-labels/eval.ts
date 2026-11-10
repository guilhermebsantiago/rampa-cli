/**
 * Compares `rampa eval --criteria 1.1.1 --offline` runs of the builds before and after this change on the W3C ACT cases
 * and the corrupted pairs, row by row (set, rule, test case, corruptor): the outcome, the findings' messages and the
 * model usage. The first label is the reference; every other run is compared with it.
 *
 * Run from the repository root after the evaluations (notes, section 6):
 *   node study/notes-alt-labels/eval.ts before after before-2 (prints the comparison)
 * Reads .rampa/alt-labels/eval-<label>/<run>/results.jsonl (ignored by git); writes study/notes-alt-labels/data/eval.json.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

type Row = {
  set: string
  ruleId: string
  testcaseId: string
  corruptor?: string
  title: string
  expected: string
  rampa: string
  baseline: string
  findings: Array<{ ref?: string; message?: string }>
  usage: { calls: number; cachedCalls: number; inputTokens: number; outputTokens: number }
}

const labels = process.argv.slice(2)
if (labels.length < 2) throw new Error('usage: eval.ts <reference label> <label> [label ...]')
const load = (label: string): Map<string, Row> => {
  const dir = join('.rampa', 'alt-labels', `eval-${label}`)
  const [run] = readdirSync(dir)
  if (!run) throw new Error(`no run in ${dir}`)
  const rows = readFileSync(join(dir, run, 'results.jsonl'), 'utf8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as Row)
  return new Map(rows.map((row) => [JSON.stringify([row.set, row.ruleId, row.testcaseId, row.corruptor ?? '']), row]))
}

const [reference, ...others] = labels as [string, ...string[]]
const base = load(reference)
const sum = (rows: Map<string, Row>, key: 'calls' | 'cachedCalls' | 'outputTokens') => [...rows.values()].reduce((total, row) => total + row.usage[key], 0)
const runs: Record<string, unknown> = {}
const lines: string[] = [`# 1.1.1 on the W3C ACT cases, offline: ${reference} against ${others.join(', ')}`, '']
lines.push('| Run | Rows | Same outcome as the reference | New model calls | Cached calls | Output tokens | Message changes | Usage changes |')
lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |')
lines.push(`| ${reference} | ${base.size} | – | ${sum(base, 'calls')} | ${sum(base, 'cachedCalls')} | ${sum(base, 'outputTokens')} | – | – |`)
const details: string[] = []
for (const label of others) {
  const rows = load(label)
  const outcome: string[] = []
  const messages: Array<{ rule: string; title: string; corruptor?: string; before: string[]; after: string[] }> = []
  const usage: Array<{ rule: string; title: string; before: Row['usage']; after: Row['usage'] }> = []
  for (const [key, row] of base) {
    const other = rows.get(key)
    if (!other || other.rampa !== row.rampa || other.baseline !== row.baseline || other.expected !== row.expected) {
      outcome.push(key)
      continue
    }
    const said = (r: Row) => r.findings.map((f) => `${f.ref ?? ''}: ${f.message ?? ''}`)
    if (JSON.stringify(said(row)) !== JSON.stringify(said(other))) messages.push({ rule: row.ruleId, title: row.title, corruptor: row.corruptor, before: said(row), after: said(other) })
    if (JSON.stringify(row.usage) !== JSON.stringify(other.usage)) usage.push({ rule: row.ruleId, title: row.title, before: row.usage, after: other.usage })
  }
  const same = base.size - outcome.length
  runs[label] = { rows: rows.size, sameOutcome: same, outcomeDifferences: outcome, calls: sum(rows, 'calls'), cachedCalls: sum(rows, 'cachedCalls'), messages, usage }
  lines.push(`| ${label} | ${rows.size} | ${same} / ${base.size} | ${sum(rows, 'calls')} | ${sum(rows, 'cachedCalls')} | ${sum(rows, 'outputTokens')} | ${messages.length} | ${usage.length} |`)
  for (const m of messages) details.push(`- ${label}, ${m.rule} ${m.title}${m.corruptor ? ` (${m.corruptor})` : ''}: ${m.before.join('; ')} → ${m.after.join('; ')}`)
  for (const u of usage) {
    details.push(`- ${label}, ${u.rule} ${u.title}: usage ${u.before.cachedCalls} cached, ${u.before.inputTokens} in / ${u.before.outputTokens} out → ${u.after.cachedCalls} cached, ${u.after.inputTokens} in / ${u.after.outputTokens} out`)
  }
  for (const key of outcome) details.push(`- ${label}: **outcome differs** on ${key}`)
}
lines.push('', 'Differences row by row:', '', ...(details.length ? details : ['- none']))
writeFileSync(join('study', 'notes-alt-labels', 'data', 'eval.json'), `${JSON.stringify({ reference, runs }, null, 1)}\n`)
console.log(lines.join('\n'))
