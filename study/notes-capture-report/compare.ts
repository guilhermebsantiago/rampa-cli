/**
 * Renders the JSON reports of an offline replay (replay.sh) of the 48 dev pages of the second to fifth studies with two
 * builds of Rampa, through the `formatReports` each exports (the function `rampa check` writes every format with), and
 * compares the outputs byte for byte, in the terminal (no colour), Markdown, HTML and SARIF formats, with and without
 * --verbose, page by page and with each study's 12 pages in one run:
 * - a report with its `capture` removed must render with the second build exactly as the first build renders it;
 * - a report whose record has no line to show (`captureLines` is empty) must render exactly as with the first build;
 * - any other report must show the section "How the page was read" with exactly its record's lines, and render exactly
 *   as with the first build once that section is removed (in SARIF, `capture` in its page's coverage, as the record is).
 * It also checks that the files and the terminal output replay.sh wrote with the second build are what its
 * `formatReports` gives from the JSON report, so the comparison stands for the command's own output.
 *
 * Run from the repository root, after replay.sh with the second build:
 *   node study/notes-capture-report/compare.ts <dist before> <dist after> [label] > study/notes-capture-report/data/comparison.md
 * Reads .rampa/capture-report/replay/<label>/ (ignored by git). Only pages whose split is "dev" in the study's
 * data/pages.json are read.
 */
import { existsSync, readFileSync } from 'node:fs'
import { isDeepStrictEqual } from 'node:util'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Report } from '../../src/core/types.ts'
import { captureLines, escapeHtml } from '../../src/report/common.ts'
import { prose } from '../../src/report/markdown.ts'

const [BEFORE_DIST, AFTER_DIST, LABEL = 'after'] = process.argv.slice(2)
if (!BEFORE_DIST || !AFTER_DIST) throw new Error('usage: compare.ts <dist before> <dist after> [label]')
const REPLAY = `.rampa/capture-report/replay/${LABEL}`
const STUDIES = [
  { study: 's2', input: 'fresh-2026-10-11' },
  { study: 's3', input: 'round-3-2026-10-23' },
  { study: 's4', input: 'round-4-2026-10-24' },
  { study: 's5', input: 'round-5-2026-10-28' },
] as const
const FORMATS = ['pretty', 'markdown', 'html', 'sarif'] as const
type Format = (typeof FORMATS)[number]
type Render = (format: Format, reports: Report[], options: { verbose: boolean; paint: unknown }) => string

const same = (text: string) => text
const plain = { bold: same, dim: same, red: same, green: same, yellow: same, cyan: same, gray: same, redBold: same, cyanBold: same }
const load = async (dist: string): Promise<Render> => ((await import(pathToFileURL(resolve(dist, 'index.mjs')).href)) as { formatReports: Render }).formatReports
const before = await load(BEFORE_DIST)
const after = await load(AFTER_DIST)

const TITLE = 'How the page was read'
const withoutCapture = (report: Report): Report => {
  const { capture: _capture, ...rest } = report
  return rest
}

/** A page's section in a format, as the second build should write it for one report: its lines, exactly. */
function section(format: Exclude<Format, 'sarif'>, report: Report, several: boolean): string {
  const lines = captureLines(report, report.locale)
  if (format === 'pretty') return `${TITLE}\n${lines.map((line) => `  ${line}`).join('\n')}\n\n`
  if (format === 'html') return `<section class="capture">\n<h3>${TITLE}</h3>\n<ul class="notes">${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>\n</section>\n`
  if (several) throw new Error('the Markdown section of several pages is one list; see strip()')
  return `#### ${TITLE}\n\n${lines.map((line) => `- ${prose(line)}`).join('\n')}\n\n`
}

/** The second build's output with every capture section taken out; undefined when a section expected is missing. */
function strip(format: Format, output: string, reports: Report[]): string | undefined {
  const shown = reports.filter((report) => captureLines(report, report.locale).length > 0)
  if (format === 'sarif') {
    const log = JSON.parse(output) as { runs: Array<{ properties: { coverage: Array<Record<string, unknown>> } }> }
    const coverage = log.runs[0]?.properties.coverage ?? []
    for (const [index, report] of reports.entries()) {
      const entry = coverage[index] ?? {}
      const expected = shown.includes(report) ? report.capture : undefined
      if (!isDeepStrictEqual(entry.capture, expected)) return undefined
      delete entry.capture
    }
    return `${JSON.stringify(log, null, 2)}\n`
  }
  if (format === 'markdown' && reports.length > 1) {
    const head = `#### ${TITLE}\n\n`
    const start = output.indexOf(head)
    if (shown.length === 0) return start === -1 ? output : undefined
    if (start === -1) return undefined
    const end = output.indexOf('\n\n', start + head.length)
    return output.slice(0, start) + output.slice(end + 2)
  }
  let rest = output
  for (const report of shown) {
    const text = section(format, report, reports.length > 1)
    if (!rest.includes(text)) return undefined
    rest = rest.replace(text, '')
  }
  return rest.includes(TITLE) ? undefined : rest
}

type Tally = { runs: number; noCapture: number; clean: number; cleanSame: number; shown: number; shownSame: number }
const tally = new Map<string, Tally>()
const failures: string[] = []
const count = (key: string, update: (row: Tally) => void) => {
  const row = tally.get(key) ?? { runs: 0, noCapture: 0, clean: 0, cleanSame: 0, shown: 0, shownSame: 0 }
  update(row)
  tally.set(key, row)
}

/** One run of the reports in a format: the three comparisons above. */
function compare(name: string, scope: string, format: Format, verbose: boolean, reports: Report[]): void {
  const options = { verbose, paint: plain }
  const today = before(format, reports, options)
  const key = `${scope}|${format}|${verbose ? 'verbose' : 'default'}`
  const none = after(format, reports.map(withoutCapture), options)
  const output = after(format, reports, options)
  const anyLine = reports.some((report) => captureLines(report, report.locale).length > 0)
  count(key, (row) => {
    row.runs++
    if (none === today) row.noCapture++
    else failures.push(`${name} ${format} ${verbose ? 'verbose' : ''}: without capture, the output differs from the first build's`)
    if (!anyLine) {
      row.clean++
      if (output === today) row.cleanSame++
      else failures.push(`${name} ${format}: a record with no line changed the output`)
    } else {
      row.shown++
      if (strip(format, output, reports) === today) row.shownSame++
      else failures.push(`${name} ${format}: the section is not as expected, or something else moved`)
    }
  })
}

const pages: Array<{ study: string; slug: string; report: Report }> = []
for (const { study, input } of STUDIES) {
  const listed = JSON.parse(readFileSync(join('study', input, 'data', 'pages.json'), 'utf8')) as Array<{ slug: string; split: string }>
  const reports: Report[] = []
  for (const { slug } of listed.filter((page) => page.split === 'dev')) {
    const base = join(REPLAY, `${study}.${slug}`)
    if (!existsSync(`${base}.report.json`)) {
      failures.push(`${study} ${slug}: no report`)
      continue
    }
    const report = JSON.parse(readFileSync(`${base}.report.json`, 'utf8')) as Report
    pages.push({ study, slug, report })
    reports.push(report)
    for (const format of FORMATS) for (const verbose of [false, true]) compare(`${study} ${slug}`, 'page', format, verbose, [report])
    // The command's own output, written by the second build: the files and the terminal (stdout) of replay.sh.
    const options = { verbose: false, paint: plain }
    const written: Record<Format, string> = { pretty: `${base}.pretty.txt`, markdown: `${base}.report.md`, html: `${base}.report.html`, sarif: `${base}.report.sarif` }
    for (const format of FORMATS) {
      const rendered = after(format, [report], options)
      count(`command|${format}`, (row) => {
        row.runs++
        if (readFileSync(written[format], 'utf8') === rendered) row.shownSame++
        else failures.push(`${study} ${slug} ${format}: the file replay.sh wrote is not what formatReports gives from the JSON report`)
      })
    }
  }
  for (const format of FORMATS) for (const verbose of [false, true]) compare(`${study} (12 pages)`, 'study', format, verbose, reports)
}

const out: string[] = []
out.push(`# The capture section in four formats: byte comparison on the 48 dev pages`, '')
out.push(`First build: ${BEFORE_DIST}. Second build: ${AFTER_DIST}. Reports: ${REPLAY}. Counted, in-sample (dev).`, '')
const shownPages = pages.filter(({ report }) => captureLines(report, report.locale).length > 0)
out.push(`Pages read: ${pages.length}. Pages whose record has a line to show: ${shownPages.length}. Pages whose record has none: ${pages.length - shownPages.length} (${pages.filter(({ report }) => captureLines(report, report.locale).length === 0).map(({ study, slug }) => `${study} ${slug}`).join(', ')}).`, '')
out.push('| Runs | Format | Verbose | Runs compared | No `capture`: same bytes | No line: runs | No line: same bytes | With lines: runs | With lines: section exact, rest same bytes |')
out.push('| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |')
for (const [key, row] of tally) {
  const [scope, format, verbose] = key.split('|')
  if (scope === 'command') continue
  out.push(`| ${scope === 'page' ? 'one page' : "a study's 12 pages"} | ${format} | ${verbose} | ${row.runs} | ${row.noCapture} | ${row.clean} | ${row.cleanSame} | ${row.shown} | ${row.shownSame} |`)
}
out.push('', '| Command output (second build) | Pages | Same as formatReports from the JSON report |', '| --- | ---: | ---: |')
for (const format of FORMATS) {
  const row = tally.get(`command|${format}`)
  out.push(`| ${format === 'pretty' ? 'terminal (stdout)' : format} | ${row?.runs ?? 0} | ${row?.shownSame ?? 0} |`)
}
out.push('', `Failures: ${failures.length}.`, ...failures.map((failure) => `- ${failure}`), '')
const lines = new Map<string, number>()
for (const { report } of pages) for (const line of captureLines(report, report.locale)) {
  const kind = line.replace(/\d+/g, 'n').replace(/\(.*?\)/g, '(…)').slice(0, 60)
  lines.set(kind, (lines.get(kind) ?? 0) + 1)
}
out.push('Lines shown, by kind (numbers and brackets elided):', '', '| Line | Lines on the 48 pages |', '| --- | ---: |')
for (const [kind, total] of [...lines].sort((a, b) => b[1] - a[1])) out.push(`| ${kind.replaceAll('|', '\\|')}… | ${total} |`)
process.stdout.write(`${out.join('\n')}\n`)
if (failures.length > 0) process.exitCode = 1
