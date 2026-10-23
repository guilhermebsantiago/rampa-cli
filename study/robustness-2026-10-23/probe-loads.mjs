// How many probe kinds could not load their page, per build: the probe rows of each --probe all report whose note
// says the probe failed, by cause. Usage: node study/robustness-2026-10-23/probe-loads.mjs before after
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const sites = JSON.parse(readFileSync(join(here, 'sites.json'), 'utf8'))

for (const tag of process.argv.slice(2)) {
  let reports = 0
  let kinds = 0
  let failed = 0
  const causes = {}
  for (const site of sites) {
    const file = join(here, 'raw', tag, `${site.id}.probe.json`)
    if (!existsSync(file)) continue
    let report
    try {
      report = JSON.parse(readFileSync(file, 'utf8'))
    } catch {
      continue
    }
    if (report.blocked || !report.coverage?.probes) continue
    reports++
    // One verdict per probe kind and version (probe/keyboard@2): failed if any of its rows says so.
    const byKind = new Map()
    for (const row of report.coverage.probes) {
      const note = row.note ?? ''
      const failure = /probe failed: (.*)/.exec(note)?.[1]
      if (!byKind.has(row.method)) byKind.set(row.method, undefined)
      if (failure) byKind.set(row.method, failure)
    }
    for (const failure of byKind.values()) {
      kinds++
      if (!failure) continue
      failed++
      const cause = /net::(ERR_[A-Z_]+)/.exec(failure)?.[1] ?? (/did not reach/.test(failure) ? 'load time-out' : failure.slice(0, 60))
      causes[cause] = (causes[cause] ?? 0) + 1
    }
  }
  console.log(`${tag}: ${reports} reports with probes, ${kinds} probe kinds, ${failed} could not load their page`, causes)
}
