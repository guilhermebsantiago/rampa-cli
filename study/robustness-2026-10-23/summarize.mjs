// Summarizes a robustness run: the last run of each site and mode in raw/<tag>/results.jsonl, classified.
// Usage: node study/robustness-2026-10-23/summarize.mjs before after
// Writes results-<tag>.json (one row per site and mode, committed) and prints a Markdown table per tag.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const sites = JSON.parse(readFileSync(join(here, 'sites.json'), 'utf8'))
const annotations = existsSync(join(here, 'annotations.json')) ? JSON.parse(readFileSync(join(here, 'annotations.json'), 'utf8')) : {}

/**
 * The pages the before build checked as if they were the site, though the site had sent a bot check or a refusal: read
 * from that build's recordings (title, text, frames) and the responses' status and headers (docs/studies/robustness-2026-10-23.md).
 */
const BEFORE_WALLS = new Set(['sp-gov', 'rj-gov', 'ibge', 'mercadolivre', 'magalu', 'casasbahia', 'itau', 'bb', 'nytimes', 'reddit', 'stackoverflow', 'g2'])

/** Network failures of the machine the run used (its connection dropped every 20 to 30 s that day), not of Rampa or the site. */
const NETWORK = /ERR_(INTERNET_DISCONNECTED|NETWORK_CHANGED|NAME_NOT_RESOLVED|CONNECTION_RESET|SOCKET_NOT_CONNECTED|NETWORK_IO_SUSPENDED|ADDRESS_UNREACHABLE|CONNECTION_CLOSED|EMPTY_RESPONSE|TIMED_OUT)/

function classify(row, stderr) {
  if (row.killed) return 'time-out (killed)'
  if (row.exit === 2) {
    if (/bot check or a refusal/.test(stderr)) return 'bot wall, reported'
    if (/ERR_HTTP_RESPONSE_CODE_FAILURE|ERR_HTTP2_PROTOCOL_ERROR/.test(stderr)) return 'refused by the site'
    if (NETWORK.test(stderr)) return 'network (machine)'
    if (/did not reach (load|domcontentloaded|networkidle) within/.test(stderr)) return 'load time-out'
    if (/TypeError|ReferenceError|RangeError|Cannot read properties|\n\s+at /.test(stderr)) return 'crash'
    return 'error'
  }
  return 'checked'
}

function noteFlags(row) {
  const flags = []
  const notes = (row.notes ?? []).join(' ')
  if (row.truncated) flags.push(`cut at ${row.truncated.elements}`)
  if (/bot check|refused the page/.test(notes)) flags.push('bot-check note')
  if (/answered HTTP \d+/.test(notes)) flags.push(`HTTP ${/answered HTTP (\d+)/.exec(notes)[1]} note`)
  if (/masked by a page script/.test(notes)) flags.push('masked note')
  if (/engine stopped with an error/.test(notes)) flags.push('engine-error note')
  if (/load event had not fired/.test(notes)) flags.push('late-load note')
  if (/did not reach load|probe failed|did not run: the page did not load/.test(JSON.stringify(row.probes ?? []) + JSON.stringify(row.advisoryByCheck ?? {}))) flags.push('probe load failures')
  return flags
}

for (const tag of process.argv.slice(2)) {
  const file = join(here, 'raw', tag, 'results.jsonl')
  if (!existsSync(file)) continue
  const last = new Map()
  for (const line of readFileSync(file, 'utf8').trim().split('\n')) {
    const row = JSON.parse(line)
    last.set(`${row.id} ${row.mode}`, row)
  }
  const rows = []
  for (const mode of ['default', 'probe', 'cognitive']) {
    for (const site of sites) {
      const row = last.get(`${site.id} ${mode}`)
      if (!row) continue
      // The stderr file keeps the whole text; the results line keeps only its end, past a long stack.
      const stderrFile = join(here, 'raw', tag, `${site.id}.${mode}.stderr.txt`)
      const stderr = existsSync(stderrFile) ? readFileSync(stderrFile, 'utf8') : (row.stderr ?? '')
      const firstLine = stderr.split('\n').find((l) => l.startsWith('rampa:')) ?? ''
      // A run that wrote no report of its own has no counts: a report on disk would be an earlier run's, which the
      // first version of run.mjs did not remove.
      const found = classify(row, stderr)
      const reported = ['checked', 'bot wall, reported'].includes(found)
      const verdict = tag === 'before' && found === 'checked' && BEFORE_WALLS.has(site.id) ? 'bot wall, checked as the site' : found
      rows.push({
        id: site.id,
        group: site.group,
        url: site.url,
        mode,
        exit: row.exit,
        seconds: Math.round(row.ms / 1000),
        findings: reported ? (row.findings ?? null) : null,
        belowThreshold: reported ? (row.belowThreshold ?? null) : null,
        needsReview: reported ? (row.needsReview ?? null) : null,
        reportErrors: reported ? (row.errors?.length ?? null) : null,
        advisories: reported ? (row.advisories ?? null) : null,
        class: verdict,
        flags: reported ? noteFlags(row) : [],
        stderr: firstLine.slice(0, 240).replace(/https?:\/\/\S+/, (u) => u.slice(0, 80)),
        annotation: annotations[`${site.id} ${mode}`] ?? annotations[site.id] ?? '',
      })
    }
  }
  writeFileSync(join(here, `results-${tag}.json`), `${JSON.stringify(rows, null, 1)}\n`)
  const counts = {}
  for (const row of rows) counts[`${row.mode}: ${row.class}`] = (counts[`${row.mode}: ${row.class}`] ?? 0) + 1
  console.log(`\n### ${tag}\n`)
  console.log(Object.entries(counts).map(([k, v]) => `- ${k}: ${v}`).join('\n'))
  console.log('\n| Site | Mode | Exit | Time (s) | Findings | Below | Review | Class | Notes |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- |')
  for (const row of rows) {
    const notes = [...row.flags, row.annotation, row.class !== 'checked' ? row.stderr.replace(/^rampa: /, '').replace(/\|/g, '/') : ''].filter(Boolean).join('; ')
    console.log(`| ${row.id} | ${row.mode} | ${row.exit} | ${row.seconds} | ${row.findings ?? '–'} | ${row.belowThreshold ?? '–'} | ${row.needsReview ?? '–'} | ${row.class} | ${notes.slice(0, 260)} |`)
  }
}
