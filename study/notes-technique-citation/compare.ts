/**
 * Compares two offline replays of replay.sh, page by page, on the dev halves of the second to fifth studies, and counts
 * the citations of the second:
 * - the two reports of a page must be equal once `techniques` is removed from every finding, and `createdAt` from the
 *   report; every leaf where they differ is listed, and the before report must cite nothing;
 * - the cache misses (`offlineMisses` per criterion) are summed for each replay;
 * - over the after reports' findings (the list and below the threshold): how many carry each id, and how many judgment
 *   findings carry none, by criterion and reason.
 *
 * Run from the repository root after both replays:
 *   node study/notes-technique-citation/compare.ts before after
 * Reads .rampa/technique-citation/replay/<label>/ (ignored by git); writes
 * study/notes-technique-citation/data/citations.json and prints the table. Only pages whose split is "dev" in the
 * study's data/pages.json are read.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [BEFORE = 'before', AFTER = 'after'] = process.argv.slice(2)
const REPLAY = join('.rampa', 'technique-citation', 'replay')
const STUDIES = [
  { study: 's2', input: 'fresh-2026-10-11' },
  { study: 's3', input: 'round-3-2026-10-23' },
  { study: 's4', input: 'round-4-2026-10-24' },
  { study: 's5', input: 'round-5-2026-10-28' },
] as const
const JUDGED = ['1.1.1', '1.3.5', '2.4.2', '2.4.4', '2.4.6', '3.1.1', '3.1.2', '3.3.2']

type Finding = { fingerprint: string; criterion: string; source: string; message: string; techniques?: string[] }
type Report = { findings?: Finding[]; belowThreshold?: Finding[]; criteria?: Array<{ criterion: string; offlineMisses?: number }>; [key: string]: unknown }

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T

/** A copy without `techniques` on any object that is a finding (it has a fingerprint), and without `createdAt`. */
function strip(value: unknown, top = true): unknown {
  if (Array.isArray(value)) return value.map((item) => strip(item, false))
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(
      ([key]) => !(key === 'techniques' && 'fingerprint' in (value as object)) && !(top && key === 'createdAt'),
    )
    return Object.fromEntries(entries.map(([key, item]) => [key, strip(item, false)]))
  }
  return value
}

/** Every leaf where two values differ, as a path and the two values. */
function diff(a: unknown, b: unknown, path: string, out: Array<{ path: string; before: unknown; after: unknown }>): void {
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return void out.push({ path: `${path} (length)`, before: a.length, after: b.length })
    a.forEach((value, i) => diff(value, b[i], `${path}[${i}]`, out))
    return
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const key of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) diff((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], `${path}/${key}`, out)
    return
  }
  if (a !== b) out.push({ path, before: a, after: b })
}

/** Why a judgment finding cites nothing, read from its criterion and the template of its message. */
function uncitedReason(finding: Finding): string {
  if (!JUDGED.includes(finding.criterion)) return 'criterion has no claimKind'
  if (finding.criterion === '1.1.1' && /is hidden from screen readers|está escondida dos leitores de tela/.test(finding.message)) return 'hidden_image: the table cites nothing for it'
  if (finding.criterion === '1.1.1' && /does not serve the same purpose|não cumpre o mesmo propósito/.test(finding.message)) return 'problem none: no kind'
  if (finding.criterion === '3.3.2') return '3.3.2 claim other than a label not shown: no key'
  return 'unexplained'
}

const missing: Array<Record<string, unknown>> = []
const differences: Array<Record<string, unknown>> = []
const citedBefore: Array<Record<string, unknown>> = []
const misses = { before: 0, after: 0 }
const perId: Record<string, { findings: number; belowThreshold: number }> = {}
const perKey: Record<string, number> = {}
const uncited: Record<string, Record<string, number>> = {}
const judgments = { findings: 0, belowThreshold: 0, cited: 0 }
let pages = 0
for (const { study, input } of STUDIES) {
  const dev = readJson<Array<{ slug: string; split: string }>>(join('study', input, 'data', 'pages.json')).filter((page) => page.split === 'dev')
  for (const { slug } of dev) {
    const paths = [BEFORE, AFTER].map((label) => join(REPLAY, label, `${study}.${slug}.report.json`))
    if (!paths.every((path) => existsSync(path))) {
      missing.push({ study, slug, before: existsSync(paths[0] as string), after: existsSync(paths[1] as string) })
      continue
    }
    pages++
    const [before, after] = paths.map((path) => readJson<Report>(path)) as [Report, Report]
    const out: Array<{ path: string; before: unknown; after: unknown }> = []
    diff(strip(before), strip(after), '', out)
    for (const change of out) differences.push({ study, slug, ...change })
    for (const finding of [...(before.findings ?? []), ...(before.belowThreshold ?? [])]) if (finding.techniques) citedBefore.push({ study, slug, fingerprint: finding.fingerprint })
    for (const [label, report] of [['before', before], ['after', after]] as const) for (const row of report.criteria ?? []) misses[label] += row.offlineMisses ?? 0
    for (const list of ['findings', 'belowThreshold'] as const) {
      for (const finding of after[list] ?? []) {
        for (const id of finding.techniques ?? []) (perId[id] ??= { findings: 0, belowThreshold: 0 })[list]++
        if (finding.techniques) perKey[`${finding.criterion} ${finding.techniques.join('+')}`] = (perKey[`${finding.criterion} ${finding.techniques.join('+')}`] ?? 0) + 1
        if (finding.source !== 'judgment') continue
        judgments[list]++
        if (finding.techniques) judgments.cited++
        else {
          const byReason = (uncited[finding.criterion] ??= {})
          const reason = uncitedReason(finding)
          byReason[reason] = (byReason[reason] ?? 0) + 1
        }
      }
    }
  }
}

const byCriterion = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true })
const result = {
  before: BEFORE,
  after: AFTER,
  note: 'Counted, in-sample (dev): the 12 dev pages of each of the second to fifth real-page studies, replayed offline. Findings at any confidence (--min-confidence low), in the list and below the threshold.',
  pages,
  missing,
  differences,
  citedBefore,
  offlineMisses: misses,
  judgmentFindings: { ...judgments, uncited: judgments.findings + judgments.belowThreshold - judgments.cited },
  perId: Object.fromEntries(Object.entries(perId).sort(([a], [b]) => byCriterion(a, b))),
  perCitation: Object.fromEntries(Object.entries(perKey).sort(([a], [b]) => byCriterion(a, b))),
  uncited: Object.fromEntries(Object.entries(uncited).sort(([a], [b]) => byCriterion(a, b))),
}
writeFileSync(join('study', 'notes-technique-citation', 'data', 'citations.json'), `${JSON.stringify(result, null, 2)}\n`)

const lines = [
  `Pages compared: ${pages} of 48; missing: ${missing.length}. Differences once techniques and createdAt are removed: ${differences.length}. Before reports citing: ${citedBefore.length}.`,
  `Cache misses: before ${misses.before}, after ${misses.after}.`,
  `Judgment findings: ${judgments.findings} in the list, ${judgments.belowThreshold} below the threshold; ${judgments.cited} cite, ${result.judgmentFindings.uncited} do not.`,
  '',
  '| Id | Findings | Below threshold |',
  '| --- | ---: | ---: |',
  ...Object.entries(result.perId).map(([id, count]) => `| ${id} | ${count.findings} | ${count.belowThreshold} |`),
  '',
  '| Criterion | Judgment findings citing nothing | Reason |',
  '| --- | ---: | --- |',
  ...Object.entries(result.uncited).flatMap(([criterion, reasons]) => Object.entries(reasons).map(([reason, count]) => `| ${criterion} | ${count} | ${reason} |`)),
]
for (const change of differences.slice(0, 20)) lines.push(`- ${JSON.stringify(change)}`)
process.stdout.write(`${lines.join('\n')}\n`)
