/**
 * Compares two offline replays of replay.sh, page by page, on the dev halves of the second to fifth studies:
 * - the sets of findings, below-threshold findings and suggestions (needsReview), each item keyed by criterion, ref,
 *   fingerprint and source (a suggestion by criterion, ref and rule), which must be identical;
 * - the second pass's and the judges' cache misses (offlineMisses in each criterion's summary) and model calls;
 * - every other difference between the two reports, field by field (createdAt aside): a message text is expected only
 *   on the items of class (b) in data/count.json whose suggestion extends the alternative; anything else is listed.
 *
 * Run from the repository root after both replays:
 *   node study/notes-alt-extension/compare.ts before after (prints the tables)
 * Reads .rampa/alt-extension/replay/<label>/ (ignored by git); writes study/notes-alt-extension/data/compare.json.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [BEFORE = 'before', AFTER = 'after'] = process.argv.slice(2)
const REPLAY = join('.rampa', 'alt-extension', 'replay')
const STUDIES = [
  { study: 's2', input: 'fresh-2026-10-11' },
  { study: 's3', input: 'round-3-2026-10-23' },
  { study: 's4', input: 'round-4-2026-10-24' },
  { study: 's5', input: 'round-5-2026-10-28' },
] as const

type Item = { criterion?: string; ref?: string; fingerprint?: string; source?: string; ruleId?: string; message?: string }
type Report = {
  findings?: Item[]
  belowThreshold?: Item[]
  needsReview?: Item[]
  criteria?: Array<{ criterion: string; offlineMisses?: number }>
  usage?: { calls?: number; cachedCalls?: number }
  [key: string]: unknown
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

const keyOf = (item: Item): string => JSON.stringify([item.criterion ?? '', item.ref ?? '', item.fingerprint ?? '', item.source ?? '', item.ruleId ?? ''])
const keys = (items: Item[] | undefined): string[] => (items ?? []).map(keyOf).sort()
const same = (a: string[], b: string[]): boolean => a.length === b.length && a.every((value, i) => value === b[i])
const misses = (report: Report): number => (report.criteria ?? []).reduce((sum, c) => sum + (c.offlineMisses ?? 0), 0)

/** Every leaf where two reports differ, as a path and the two values. */
function diff(a: unknown, b: unknown, path: string, out: Array<{ path: string; before: unknown; after: unknown }>): void {
  if (path === '/createdAt') return
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      out.push({ path: `${path} (length)`, before: a.length, after: b.length })
      return
    }
    a.forEach((value, i) => diff(value, b[i], `${path}[${i}]`, out))
    return
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const all = new Set([...Object.keys(a), ...Object.keys(b)])
    for (const key of [...all].sort()) diff((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], `${path}/${key}`, out)
    return
  }
  if (a !== b) out.push({ path, before: a, after: b })
}

const count = readJson<{ items: Array<{ study: string; slug: string; class: string; alternative: string; suggested: string; newWording: boolean }> }>(join('study', 'notes-alt-extension', 'data', 'count.json'))
const expected = new Set(count.items.filter((item) => item.class === 'b' && item.newWording).map((item) => JSON.stringify([item.study, item.slug, item.alternative])))

const pages: Array<Record<string, unknown>> = []
const perStudy: Record<string, { pages: number; identicalSets: number; missesBefore: number; missesAfter: number; callsBefore: number; callsAfter: number; messageChanges: number; otherChanges: number }> = {}
const messageChanges: Array<Record<string, unknown>> = []
const otherChanges: Array<Record<string, unknown>> = []
for (const { study, input } of STUDIES) {
  const dev = readJson<Array<{ slug: string; split: string }>>(join('study', input, 'data', 'pages.json')).filter((page) => page.split === 'dev')
  const totals = { pages: 0, identicalSets: 0, missesBefore: 0, missesAfter: 0, callsBefore: 0, callsAfter: 0, messageChanges: 0, otherChanges: 0 }
  for (const { slug } of dev) {
    const paths = [BEFORE, AFTER].map((label) => join(REPLAY, label, `${study}.${slug}.report.json`))
    if (!paths.every((path) => existsSync(path))) {
      otherChanges.push({ study, slug, path: '(report)', before: existsSync(paths[0]!), after: existsSync(paths[1]!) })
      continue
    }
    const [before, after] = paths.map((path) => readJson<Report>(path)) as [Report, Report]
    totals.pages++
    const sets = {
      findings: same(keys(before.findings), keys(after.findings)),
      belowThreshold: same(keys(before.belowThreshold), keys(after.belowThreshold)),
      needsReview: same(keys(before.needsReview), keys(after.needsReview)),
    }
    const identical = sets.findings && sets.belowThreshold && sets.needsReview
    if (identical) totals.identicalSets++
    const page = {
      study,
      slug,
      sets,
      counts: { findings: (before.findings ?? []).length, belowThreshold: (before.belowThreshold ?? []).length, needsReview: (before.needsReview ?? []).length },
      missesBefore: misses(before),
      missesAfter: misses(after),
      callsBefore: before.usage?.calls ?? 0,
      callsAfter: after.usage?.calls ?? 0,
    }
    totals.missesBefore += page.missesBefore
    totals.missesAfter += page.missesAfter
    totals.callsBefore += page.callsBefore
    totals.callsAfter += page.callsAfter
    pages.push(page)
    const differences: Array<{ path: string; before: unknown; after: unknown }> = []
    diff(before, after, '', differences)
    for (const d of differences) {
      const message = /^\/(findings|belowThreshold|needsReview)\[(\d+)\]\/message$/.exec(d.path)
      if (message) {
        const list = message[1] as 'findings' | 'belowThreshold' | 'needsReview'
        const item = (before[list] ?? [])[Number(message[2])]
        const alternative = /"(.*)"/.exec(String(d.before))?.[1] ?? ''
        totals.messageChanges++
        messageChanges.push({ study, slug, list, criterion: item?.criterion, ref: item?.ref, alternative, before: d.before, after: d.after, expected: expected.has(JSON.stringify([study, slug, alternative])) })
      } else {
        totals.otherChanges++
        otherChanges.push({ study, slug, ...d })
      }
    }
  }
  perStudy[study] = totals
}

const unexpected = messageChanges.filter((change) => !change.expected)
const reached = new Set(messageChanges.map((change) => JSON.stringify([change.study, change.slug, change.alternative])))
// A (b) item no report shows: what the before replay did with its answer (a discarded claim, and why), or nothing.
const notReached = [...expected]
  .filter((key) => !reached.has(key))
  .map((key) => {
    const [study, slug, alternative] = JSON.parse(key) as [string, string, string]
    const suggested = count.items.find((item) => item.study === study && item.slug === slug && item.alternative === alternative)?.suggested
    const report = readJson<{ discarded?: Array<{ criterion: string; ref: string; reason: string; output?: { evidence?: string; suggestedAlt?: string } }> }>(join(REPLAY, BEFORE, `${study}.${slug}.report.json`))
    const discarded = (report.discarded ?? []).filter((d) => d.criterion === '1.1.1' && d.output?.evidence === alternative && d.output?.suggestedAlt === suggested)
    return { study, slug, alternative, discarded: discarded.map((d) => ({ ref: d.ref, reason: d.reason })) }
  })
writeFileSync(
  join('study', 'notes-alt-extension', 'data', 'compare.json'),
  `${JSON.stringify({ before: BEFORE, after: AFTER, perStudy, messageChanges, otherChanges, unexpectedMessageChanges: unexpected.length, expectedNotReached: notReached, pages }, null, 1)}\n`,
)

const cell = (value: unknown): string => String(value).replaceAll('|', '\\|')
const lines: string[] = []
lines.push(`# Offline replay of 1.1.1 on the dev halves: ${BEFORE} against ${AFTER}`, '')
lines.push('Sets keyed by criterion, ref, fingerprint and source (suggestions by criterion, ref and rule). Misses are the reports\' `offlineMisses`; calls are new model calls (none can happen offline). In-sample: dev pages.', '')
lines.push('| Study | Pages | Identical sets | Misses before | Misses after | Calls before | Calls after | Message changes | Other changes |')
lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |')
for (const [study, t] of Object.entries(perStudy)) {
  lines.push(`| ${study} | ${t.pages} | ${t.identicalSets} / ${t.pages} | ${t.missesBefore} | ${t.missesAfter} | ${t.callsBefore} | ${t.callsAfter} | ${t.messageChanges} | ${t.otherChanges} |`)
}
lines.push('', '## Message changes', '')
lines.push('| Study | Page | List | Ref | Before | After | A (b) item of count.json |')
lines.push('| --- | --- | --- | --- | --- | --- | --- |')
for (const change of messageChanges) {
  lines.push(`| ${change.study} | ${change.slug} | ${change.list} | \`${cell(change.ref)}\` | ${cell(change.before)} | ${cell(change.after)} | ${change.expected ? 'yes' : '**no**'} |`)
}
lines.push('', `Other differences between the reports (createdAt aside): ${otherChanges.length}.`)
for (const change of otherChanges) lines.push(`- ${change.study} ${change.slug} \`${cell(change.path)}\`: ${cell(JSON.stringify(change.before))} → ${cell(JSON.stringify(change.after))}`)
lines.push('', `(b) items with new wording that no report shows: ${notReached.length}.`)
for (const item of notReached) {
  const why = item.discarded.length ? item.discarded.map((d) => `discarded by verify on \`${cell(d.ref)}\`: ${d.reason}`).join('; ') : 'not in the before report (an answer the build no longer asks for)'
  lines.push(`- ${item.study} ${item.slug} "${cell(item.alternative)}": ${why}.`)
}
console.log(lines.join('\n'))
