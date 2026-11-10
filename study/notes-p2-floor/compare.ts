/**
 * Compares two offline replays of replay.sh, page by page, on the dev halves of the second to fifth studies:
 * - the findings, below-threshold findings and suggestions (needsReview) of each page, each item keyed by criterion,
 *   ref, fingerprint, source and rule (a suggestion has no fingerprint: criterion, ref and rule);
 * - the cache misses (offlineMisses in each criterion's summary) and new model calls;
 * - the moves: a finding of "before" that is a suggestion in "after". Each is expected only when the finding was
 *   confirmed with an identical claim (`confirmation.identical`) and its own minProbability is under the floor
 *   (CONFIRM_TOGETHER_MIN_PROBABILITY, read from src/core/confirm.ts); any other move, and any item that appears or
 *   leaves otherwise, is listed as unexpected;
 * - every finding with `confirmation.identical` in "before": its minProbability, whether it stays a finding, and the two
 *   Claude judges' final label from the study's data/findings.json (dev rows only; the same slug, criterion and ref; the
 *   origins in the order study/notes-precision-p1p2/labels.py reads them);
 * - every other difference between the two reports, field by field (createdAt aside), once the moved items are taken
 *   out of both: the criterion's counts are expected to change by the moves (failed and confirmed down by one each,
 *   unconfirmed and suggested up by one), and so are its judgment method's in the coverage (failures down by one,
 *   review and suggestions up by one); anything else is listed.
 *
 * Only pages whose split is "dev" in the study's data/pages.json are read, and only dev rows of data/findings.json.
 *
 * Run from the repository root after both replays:
 *   node study/notes-p2-floor/compare.ts before after (prints the tables)
 * Reads .rampa/p2-floor/replay/<label>/ (ignored by git); writes study/notes-p2-floor/data/compare.json.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CONFIRM_TOGETHER_MIN_PROBABILITY } from '../../src/core/confirm.ts'

const [BEFORE = 'before', AFTER = 'after'] = process.argv.slice(2)
const REPLAY = join('.rampa', 'p2-floor', 'replay')
const DATA = join('study', 'notes-p2-floor', 'data')
const STUDIES = [
  { study: 's2', input: 'fresh-2026-10-11' },
  { study: 's3', input: 'round-3-2026-10-23' },
  { study: 's4', input: 'round-4-2026-10-24' },
  { study: 's5', input: 'round-5-2026-10-28' },
] as const
const ORIGIN_ORDER: Record<string, number> = { main: 0, 'noconfirm-only': 1, 'suggestion-sample': 2 }

type Confirmation = { framings?: number; minProbability?: number; identical?: { claims: number; confirmed: number } }
type Item = { criterion?: string; ref?: string; fingerprint?: string; source?: string; ruleId?: string; subject?: string; message?: string; evidence?: string; confirmation?: Confirmation }
type Summary = { criterion: string; offlineMisses?: number; failed?: number; confirmed?: number; unconfirmed?: number; suggested?: number }
type Report = {
  findings?: Item[]
  belowThreshold?: Item[]
  needsReview?: Item[]
  criteria?: Summary[]
  usage?: { calls?: number; cachedCalls?: number }
  [key: string]: unknown
}
type Row = { slug: string; split: string; source: string; criterion: string; ref: string; final: string; origin?: string }

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

const keyOf = (item: Item): string => JSON.stringify([item.criterion ?? '', item.ref ?? '', item.fingerprint ?? '', item.source ?? '', item.ruleId ?? ''])
const misses = (report: Report): number => (report.criteria ?? []).reduce((sum, c) => sum + (c.offlineMisses ?? 0), 0)
/** The items of `a` whose key `b` lacks, each key counted as often as it occurs. */
function minus(a: Item[], b: Item[]): Item[] {
  const left = new Map<string, number>()
  for (const item of b) left.set(keyOf(item), (left.get(keyOf(item)) ?? 0) + 1)
  return a.filter((item) => {
    const n = left.get(keyOf(item)) ?? 0
    if (n === 0) return true
    left.set(keyOf(item), n - 1)
    return false
  })
}

/** Every leaf where two values differ, as a path and the two values. */
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

const pages: Array<Record<string, unknown>> = []
const perStudy: Record<string, { pages: number; sameSets: number; missesBefore: number; missesAfter: number; callsBefore: number; callsAfter: number; moved: number; unexpected: number; otherChanges: number }> = {}
const twins: Array<Record<string, unknown>> = []
const moves: Array<Record<string, unknown>> = []
const unexpected: Array<Record<string, unknown>> = []
const otherChanges: Array<Record<string, unknown>> = []
for (const { study, input } of STUDIES) {
  const dev = readJson<Array<{ slug: string; split: string }>>(join('study', input, 'data', 'pages.json')).filter((page) => page.split === 'dev')
  const devSlugs = new Set(dev.map((page) => page.slug))
  const labels = new Map<string, Row>()
  const rows = readJson<Row[]>(join('study', input, 'data', 'findings.json'))
    .filter((row) => row.split === 'dev' && devSlugs.has(row.slug) && row.source === 'judgment')
    .sort((a, b) => (ORIGIN_ORDER[a.origin ?? 'main'] ?? 9) - (ORIGIN_ORDER[b.origin ?? 'main'] ?? 9))
  for (const row of rows) {
    const key = JSON.stringify([row.slug, row.criterion, row.ref])
    if (!labels.has(key)) labels.set(key, row)
  }
  const totals = { pages: 0, sameSets: 0, missesBefore: 0, missesAfter: 0, callsBefore: 0, callsAfter: 0, moved: 0, unexpected: 0, otherChanges: 0 }
  for (const { slug } of dev) {
    const paths = [BEFORE, AFTER].map((label) => join(REPLAY, label, `${study}.${slug}.report.json`))
    if (!paths.every((path) => existsSync(path))) {
      unexpected.push({ study, slug, what: 'report missing', before: existsSync(paths[0]!), after: existsSync(paths[1]!) })
      totals.unexpected++
      continue
    }
    const [before, after] = paths.map((path) => readJson<Report>(path)) as [Report, Report]
    totals.pages++
    const lists = ['findings', 'belowThreshold', 'needsReview'] as const
    const gone = Object.fromEntries(lists.map((list) => [list, minus(before[list] ?? [], after[list] ?? [])])) as Record<(typeof lists)[number], Item[]>
    const came = Object.fromEntries(lists.map((list) => [list, minus(after[list] ?? [], before[list] ?? [])])) as Record<(typeof lists)[number], Item[]>
    const same = lists.every((list) => gone[list].length === 0 && came[list].length === 0)
    if (same) totals.sameSets++

    // A finding that left: expected when it was twin-confirmed under the floor and is now a suggestion on the same element.
    const movedFindings: Item[] = []
    const movedSuggestions: Item[] = []
    for (const finding of gone.findings) {
      const confirmation = finding.confirmation
      const underFloor = Boolean(confirmation?.identical) && confirmation?.minProbability !== undefined && confirmation.minProbability < CONFIRM_TOGETHER_MIN_PROBABILITY
      const suggestion = came.needsReview.find((item) => item.criterion === finding.criterion && item.ref === finding.ref && !movedSuggestions.includes(item))
      if (underFloor && suggestion) {
        movedFindings.push(finding)
        movedSuggestions.push(suggestion)
        moves.push({ study, slug, criterion: finding.criterion, ref: finding.ref, subject: finding.subject, minProbability: confirmation?.minProbability, identical: confirmation?.identical, evidence: suggestion.evidence })
      } else {
        unexpected.push({ study, slug, what: 'finding left', criterion: finding.criterion, ref: finding.ref, confirmation, nowSuggestion: Boolean(suggestion) })
      }
    }
    for (const item of came.needsReview.filter((item) => !movedSuggestions.includes(item))) unexpected.push({ study, slug, what: 'suggestion came', criterion: item.criterion, ref: item.ref })
    for (const item of gone.needsReview) unexpected.push({ study, slug, what: 'suggestion left', criterion: item.criterion, ref: item.ref })
    for (const item of came.findings) unexpected.push({ study, slug, what: 'finding came', criterion: item.criterion, ref: item.ref })
    for (const list of ['belowThreshold'] as const) {
      for (const item of gone[list]) unexpected.push({ study, slug, what: `${list} left`, criterion: item.criterion, ref: item.ref })
      for (const item of came[list]) unexpected.push({ study, slug, what: `${list} came`, criterion: item.criterion, ref: item.ref })
    }
    totals.moved += movedFindings.length
    totals.unexpected = unexpected.filter((u) => u.study === study).length

    // Every twin-confirmed finding of "before": its own probability, whether it stays, its label.
    for (const finding of before.findings ?? []) {
      if (!finding.confirmation?.identical) continue
      const stays = (after.findings ?? []).some((item) => keyOf(item) === keyOf(finding))
      const label = labels.get(JSON.stringify([slug, finding.criterion, finding.ref]))
      twins.push({ study, slug, criterion: finding.criterion, ref: finding.ref, subject: finding.subject, minProbability: finding.confirmation.minProbability, identical: finding.confirmation.identical, stays, label: label?.final ?? 'unlabelled', labelOrigin: label?.origin ?? (label ? 'main' : undefined) })
    }

    // Every other difference, once the moved items are out of both reports (a list the report lacks stays absent). The
    // criterion's counts and its judgment method's coverage counts follow the moves.
    const strip = (report: Report, list: 'findings' | 'needsReview', out: Item[]): Report => (report[list] === undefined ? report : { ...report, [list]: report[list].filter((item) => !out.includes(item)) })
    const differences: Array<{ path: string; before: unknown; after: unknown }> = []
    diff(strip(before, 'findings', movedFindings), strip(after, 'needsReview', movedSuggestions), '', differences)
    const n = movedFindings.length
    const criterionIndex = (before.criteria ?? []).findIndex((c) => c.criterion === '1.1.1')
    const coverage = (report: Report) => (report.coverage as { criteria?: Array<{ methods?: Array<Record<string, unknown>> }> } | undefined)?.criteria?.[0]?.methods ?? []
    const methodIndex = coverage(before).findIndex((method) => method.kind === 'judgment' && String(method.id).startsWith('judgment/1.1.1'))
    const expected: Array<{ path: string; delta: number; read: (report: Report) => unknown }> = [
      ...(['failed', 'confirmed', 'unconfirmed', 'suggested'] as const).map((field) => ({
        path: `/criteria[${criterionIndex}]/${field}`,
        delta: field === 'failed' || field === 'confirmed' ? -n : n,
        read: (report: Report) => (report.criteria ?? [])[criterionIndex]?.[field],
      })),
      ...(['failures', 'review', 'suggestions'] as const).map((field) => ({
        path: `/coverage/criteria[0]/methods[${methodIndex}]/${field}`,
        delta: field === 'failures' ? -n : n,
        read: (report: Report) => coverage(report)[methodIndex]?.[field],
      })),
    ]
    for (const d of differences) {
      const count = expected.find((e) => e.path === d.path)
      if (!count || Number(d.after ?? 0) - Number(d.before ?? 0) !== count.delta) {
        totals.otherChanges++
        otherChanges.push({ study, slug, ...d })
      }
    }
    // A count the moves should change and did not.
    if (n > 0) {
      for (const count of expected) {
        const b = count.read(before)
        const a = count.read(after)
        if (Number(a ?? 0) - Number(b ?? 0) !== count.delta) {
          totals.otherChanges++
          otherChanges.push({ study, slug, path: `${count.path} (expected ${count.delta > 0 ? '+' : ''}${count.delta})`, before: b, after: a })
        }
      }
    }

    const page = {
      study,
      slug,
      same,
      before: { findings: (before.findings ?? []).length, belowThreshold: (before.belowThreshold ?? []).length, needsReview: (before.needsReview ?? []).length },
      after: { findings: (after.findings ?? []).length, belowThreshold: (after.belowThreshold ?? []).length, needsReview: (after.needsReview ?? []).length },
      moved: n,
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
  }
  perStudy[study] = totals
}

mkdirSync(DATA, { recursive: true })
writeFileSync(join(DATA, 'compare.json'), `${JSON.stringify({ before: BEFORE, after: AFTER, floor: CONFIRM_TOGETHER_MIN_PROBABILITY, perStudy, twins, moves, unexpected, otherChanges, pages }, null, 1)}\n`)

const cell = (value: unknown): string => String(value).replaceAll('|', '\\|')
const probability = (value: unknown): string => (typeof value === 'number' ? (value < 0.01 ? value.toPrecision(2) : value.toFixed(3)) : 'none')
const lines: string[] = []
lines.push(`# Offline replay of 1.1.1 on the dev halves: ${BEFORE} against ${AFTER}`, '')
lines.push(`Floor: ${CONFIRM_TOGETHER_MIN_PROBABILITY}. Sets keyed by criterion, ref, fingerprint, source and rule (suggestions have no fingerprint). Misses are the reports' \`offlineMisses\`; calls are new model calls (none can happen offline). Counted, in-sample: dev pages only.`, '')
lines.push('| Study | Pages | Same sets | Misses before | Misses after | Calls before | Calls after | Findings to suggestions | Unexpected | Other changes |')
lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |')
for (const [study, t] of Object.entries(perStudy)) {
  lines.push(`| ${study} | ${t.pages} | ${t.sameSets} / ${t.pages} | ${t.missesBefore} | ${t.missesAfter} | ${t.callsBefore} | ${t.callsAfter} | ${t.moved} | ${t.unexpected} | ${t.otherChanges} |`)
}
lines.push('', `## Findings of "${BEFORE}" confirmed with an identical claim`, '')
lines.push('Label: the two Claude judges\' final label in the study\'s data/findings.json (dev rows, the same slug, criterion and ref), not a person\'s.', '')
lines.push('| Study | Page | Alternative | Ref | Own min. probability | Group (claims, confirmed on their own) | After | Label |')
lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |')
for (const twin of twins) {
  const identical = twin.identical as { claims: number; confirmed: number }
  lines.push(`| ${twin.study} | ${twin.slug} | ${cell(twin.subject)} | \`${cell(twin.ref)}\` | ${probability(twin.minProbability)} | ${identical.claims}, ${identical.confirmed} | ${twin.stays ? 'stays a finding' : '**suggestion**'} | ${twin.label}${twin.labelOrigin && twin.labelOrigin !== 'main' ? ` (${twin.labelOrigin})` : ''} |`)
}
lines.push('', '## Findings that became suggestions', '')
for (const move of moves) lines.push(`- ${move.study} ${move.slug} "${cell(move.subject)}" \`${cell(move.ref)}\`, own min. probability ${probability(move.minProbability)}: ${cell(move.evidence)}`)
lines.push('', `Unexpected moves, items that appeared or left otherwise, and missing reports: ${unexpected.length}.`)
for (const u of unexpected) lines.push(`- ${cell(JSON.stringify(u))}`)
lines.push('', `Other differences between the reports (createdAt aside, the moved items out of both, the counts that follow the moves aside): ${otherChanges.length}.`)
for (const change of otherChanges) lines.push(`- ${change.study} ${change.slug} \`${cell(change.path)}\`: ${cell(JSON.stringify(change.before))} → ${cell(JSON.stringify(change.after))}`)
console.log(lines.join('\n'))
