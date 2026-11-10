/**
 * Compares two offline replays of replay.sh, page by page, on the dev halves of the second to fifth studies, and
 * tabulates the capture records of the second:
 * - the two reports of a page must be equal once `capture`, `createdAt` and `rampaVersion` are removed; every leaf
 *   where they differ is listed, and the before report must have no `capture` while the after report has one;
 * - per page, what the after report's record holds; per study and over the 48 pages, how many records are not styled,
 *   have an overlay, are cut, have images without a capture (and the total by reason), and have candidates not judged
 *   (per criterion).
 *
 * Run from the repository root after both replays:
 *   node study/notes-capture-record/compare.ts before after (prints the tables)
 * Reads .rampa/capture-record/replay/<label>/ (ignored by git); writes study/notes-capture-record/data/records.json.
 * Only pages whose split is "dev" in the study's data/pages.json are read.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [BEFORE = 'before', AFTER = 'after'] = process.argv.slice(2)
const REPLAY = join('.rampa', 'capture-record', 'replay')
const STUDIES = [
  { study: 's2', input: 'fresh-2026-10-11' },
  { study: 's3', input: 'round-3-2026-10-23' },
  { study: 's4', input: 'round-4-2026-10-24' },
  { study: 's5', input: 'round-5-2026-10-28' },
] as const
const IMAGE_SKIPS = ['outside-page', 'clipped', 'not-shown', 'not-loaded', 'placeholder', 'blank', 'stacked', 'capture-failed', 'limit']

type NotJudged = { criterion: string; candidates: number; capped?: number; timedOut?: number; offlineMisses?: number; errors?: number }
type Capture = {
  version: number
  styled: boolean
  styledBy?: string
  stylesheets?: { linked: number; applied: number; failed: number; retried?: boolean }
  overlay?: { selector: string; coverage: number; hidden: boolean }
  blocked?: true
  httpStatus?: number
  cut?: { elements: number }
  unsettledAfterMs?: number
  loadTimedOutMs?: number
  images?: { captured: number; notCaptured: number; reasons: Record<string, number> }
  notJudged?: NotJudged[]
}
type Report = { capture?: Capture; [key: string]: unknown }

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

/** Every leaf where two values differ, as a path and the two values. */
function diff(a: unknown, b: unknown, path: string, out: Array<{ path: string; before: unknown; after: unknown }>): void {
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

const without = (report: Report): Record<string, unknown> => {
  const { capture: _capture, createdAt: _createdAt, rampaVersion: _version, ...rest } = report
  return rest
}

type Row = { study: string; slug: string; capture: Capture | undefined; differences: number }
const rows: Row[] = []
const differences: Array<Record<string, unknown>> = []
const missing: Array<Record<string, unknown>> = []
const mismatches: Array<Record<string, unknown>> = []
let withImagesNote = 0
for (const { study, input } of STUDIES) {
  const dev = readJson<Array<{ slug: string; split: string }>>(join('study', input, 'data', 'pages.json')).filter((page) => page.split === 'dev')
  for (const { slug } of dev) {
    const paths = [BEFORE, AFTER].map((label) => join(REPLAY, label, `${study}.${slug}.report.json`))
    if (!paths.every((path) => existsSync(path))) {
      missing.push({ study, slug, before: existsSync(paths[0] as string), after: existsSync(paths[1] as string) })
      continue
    }
    const [before, after] = paths.map((path) => readJson<Report>(path)) as [Report, Report]
    const out: Array<{ path: string; before: unknown; after: unknown }> = []
    if (before.capture !== undefined) out.push({ path: '/capture (before)', before: 'present', after: '' })
    if (after.capture === undefined) out.push({ path: '/capture (after)', before: '', after: 'absent' })
    diff(without(before), without(after), '', out)
    for (const change of out) differences.push({ study, slug, ...change })
    rows.push({ study, slug, capture: after.capture, differences: out.length })
    // The record against what the report says elsewhere: the note on images left without a capture (English, as
    // replay.sh runs), and each criterion's summary.
    const note = ((after.notes as string[] | undefined) ?? []).map((text) => /^(\d+) image\(s\) were left without a capture/.exec(text)).find(Boolean)
    const notCaptured = after.capture?.images?.notCaptured ?? 0
    if ((note ? Number(note[1]) : 0) !== notCaptured) mismatches.push({ study, slug, what: 'images note', note: note ? Number(note[1]) : null, record: notCaptured })
    if (note) withImagesNote++
    const summaries = (after.criteria as Array<{ criterion: string; capped?: number; timedOut?: number; offlineMisses: number; errors: number }> | undefined) ?? []
    for (const summary of summaries) {
      const item = after.capture?.notJudged?.find((entry) => entry.criterion === summary.criterion)
      for (const key of ['capped', 'timedOut', 'offlineMisses', 'errors'] as const) {
        if ((item?.[key] ?? 0) !== (summary[key] ?? 0)) mismatches.push({ study, slug, what: `${summary.criterion} ${key}`, summary: summary[key] ?? 0, record: item?.[key] ?? 0 })
      }
    }
  }
}

type Tally = {
  pages: number
  notStyled: number
  stylesheets: number
  overlay: number
  blocked: number
  httpStatus: number
  cut: number
  unsettled: number
  loadTimedOut: number
  withImages: number
  imagesCaptured: number
  pagesNotCaptured: number
  imagesNotCaptured: number
  reasons: Record<string, number>
  pagesNotJudged: number
  notJudged: Record<string, { pages: number; candidates: number; capped: number; timedOut: number; offlineMisses: number; errors: number }>
}
const tally = (subset: Row[]): Tally => {
  const t: Tally = {
    pages: subset.length,
    notStyled: 0,
    stylesheets: 0,
    overlay: 0,
    blocked: 0,
    httpStatus: 0,
    cut: 0,
    unsettled: 0,
    loadTimedOut: 0,
    withImages: 0,
    imagesCaptured: 0,
    pagesNotCaptured: 0,
    imagesNotCaptured: 0,
    reasons: {},
    pagesNotJudged: 0,
    notJudged: {},
  }
  for (const { capture } of subset) {
    if (!capture) continue
    if (!capture.styled) t.notStyled++
    if (capture.stylesheets) t.stylesheets++
    if (capture.overlay) t.overlay++
    if (capture.blocked) t.blocked++
    if (capture.httpStatus) t.httpStatus++
    if (capture.cut) t.cut++
    if (capture.unsettledAfterMs !== undefined) t.unsettled++
    if (capture.loadTimedOutMs !== undefined) t.loadTimedOut++
    if (capture.images) {
      t.withImages++
      t.imagesCaptured += capture.images.captured
      if (capture.images.notCaptured > 0) t.pagesNotCaptured++
      t.imagesNotCaptured += capture.images.notCaptured
      for (const [reason, count] of Object.entries(capture.images.reasons)) t.reasons[reason] = (t.reasons[reason] ?? 0) + count
    }
    if (capture.notJudged?.length) t.pagesNotJudged++
    for (const item of capture.notJudged ?? []) {
      const sum = (t.notJudged[item.criterion] ??= { pages: 0, candidates: 0, capped: 0, timedOut: 0, offlineMisses: 0, errors: 0 })
      sum.pages++
      sum.candidates += item.candidates
      sum.capped += item.capped ?? 0
      sum.timedOut += item.timedOut ?? 0
      sum.offlineMisses += item.offlineMisses ?? 0
      sum.errors += item.errors ?? 0
    }
  }
  return t
}

const byStudy = STUDIES.map(({ study }) => ({ study, ...tally(rows.filter((row) => row.study === study)) }))
const all = { study: 'all', ...tally(rows) }
const reasonsText = (reasons: Record<string, number>): string =>
  IMAGE_SKIPS.filter((reason) => reasons[reason])
    .map((reason) => `${reason} ${reasons[reason]}`)
    .join(', ') || '—'
const notJudgedText = (items: NotJudged[] | undefined): string =>
  (items ?? [])
    .map((item) => {
      const parts = (['capped', 'timedOut', 'offlineMisses', 'errors'] as const).filter((key) => item[key]).map((key) => `${key} ${item[key]}`)
      return `${item.criterion} (${parts.join(', ')} of ${item.candidates})`
    })
    .join('; ') || '—'

writeFileSync(
  join('study', 'notes-capture-record', 'data', 'records.json'),
  `${JSON.stringify({ before: BEFORE, after: AFTER, pages: rows.length, missing, differences, mismatches, withImagesNote, tallies: [...byStudy, all], records: rows.map(({ study, slug, capture }) => ({ study, slug, capture })) }, null, 2)}\n`,
)

const lines: string[] = []
lines.push('# Capture records of the 48 dev pages, from an offline replay')
lines.push('')
lines.push(
  `Reports of the build before the record (\`${BEFORE}\`) and after it (\`${AFTER}\`), replayed offline by replay.sh. Counted, in-sample (dev): the 12 dev pages of each of the second to fifth real-page studies. A record says what the collector noticed, not that the capture equals what people see.`,
)
lines.push('')
lines.push('## The comparison')
lines.push('')
lines.push(`Pages compared: ${rows.length} of 48; missing reports: ${missing.length}. Differences once \`capture\`, \`createdAt\` and \`rampaVersion\` are removed: ${differences.length}.`)
for (const change of differences.slice(0, 50)) lines.push(`- ${change.study} ${change.slug} \`${change.path}\`: ${JSON.stringify(change.before)} → ${JSON.stringify(change.after)}`)
lines.push('')
lines.push(
  `The record against the rest of the same report: \`images.notCaptured\` against the count in the note on images left without a capture (${withImagesNote} pages have the note), and each \`notJudged\` count against the criterion's summary. Mismatches: ${mismatches.length}.`,
)
for (const mismatch of mismatches.slice(0, 50)) lines.push(`- ${JSON.stringify(mismatch)}`)
lines.push('')
lines.push('## Per study')
lines.push('')
lines.push('| Study | Pages | Not styled | Stylesheets recorded | Overlay | Blocked | HTTP error | Cut | Unsettled | Load timed out | With `images` | Images captured | Pages with images not captured | Images not captured | By reason | Pages with candidates not judged |')
lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: |')
for (const t of [...byStudy, all]) {
  const name = t.study === 'all' ? '**All four**' : t.study
  lines.push(
    `| ${name} | ${t.pages} | ${t.notStyled} | ${t.stylesheets} | ${t.overlay} | ${t.blocked} | ${t.httpStatus} | ${t.cut} | ${t.unsettled} | ${t.loadTimedOut} | ${t.withImages} | ${t.imagesCaptured} | ${t.pagesNotCaptured} | ${t.imagesNotCaptured} | ${reasonsText(t.reasons)} | ${t.pagesNotJudged} |`,
  )
}
lines.push('')
lines.push('## Candidates not judged, per criterion (all four studies)')
lines.push('')
lines.push('| Criterion | Pages | Candidates on those pages | Capped | Timed out | Offline misses | Errors |')
lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: |')
for (const [criterion, sum] of Object.entries(all.notJudged).sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true }))) {
  lines.push(`| ${criterion} | ${sum.pages} | ${sum.candidates} | ${sum.capped} | ${sum.timedOut} | ${sum.offlineMisses} | ${sum.errors} |`)
}
lines.push('')
lines.push('## Per page')
lines.push('')
lines.push('| Study | Page | Styled | Overlay | Cut | Images captured | Not captured (by reason) | Not judged | Other fields |')
lines.push('| --- | --- | --- | --- | --- | ---: | --- | --- | --- |')
for (const { study, slug, capture } of rows) {
  const c = capture
  if (!c) {
    lines.push(`| ${study} | ${slug} | (no record) | | | | | | |`)
    continue
  }
  const styled = c.styled ? 'yes' : `no (${c.styledBy ?? '?'})`
  const overlay = c.overlay ? `${c.overlay.selector} (${Math.round(c.overlay.coverage * 100)}%, ${c.overlay.hidden ? 'hidden' : 'shown'})` : '—'
  const images = c.images ? String(c.images.captured) : '—'
  const notCaptured = c.images && c.images.notCaptured > 0 ? `${c.images.notCaptured} (${reasonsText(c.images.reasons)})` : c.images ? '0' : '—'
  const other = [
    c.stylesheets ? `stylesheets: ${c.stylesheets.failed} of ${c.stylesheets.linked} failed${c.stylesheets.retried ? ', retried' : ''}` : '',
    c.blocked ? 'blocked' : '',
    c.httpStatus ? `HTTP ${c.httpStatus}` : '',
    c.unsettledAfterMs !== undefined ? `unsettled after ${c.unsettledAfterMs} ms` : '',
    c.loadTimedOutMs !== undefined ? `load timed out at ${c.loadTimedOutMs} ms` : '',
  ]
    .filter(Boolean)
    .join('; ')
  lines.push(`| ${study} | ${slug} | ${styled} | ${overlay.replace(/\|/g, '\\|')} | ${c.cut ? c.cut.elements : '—'} | ${images} | ${notCaptured} | ${notJudgedText(c.notJudged)} | ${other || '—'} |`)
}
process.stdout.write(`${lines.join('\n')}\n`)
