/**
 * How often the two rules of this change meet the cached 1.1.1 answers on the dev halves of the second to fifth
 * real-page studies, from the judgment caches of the P3/P4 replay (recordings
 * notes-precision-p3p4-2026-10-29/caches-after/<study>/<slug>/cache). No model, no snapshot: the model's answers as
 * cached, so an alternative is read without its image's file name.
 *
 * Part (a), among the distinct (page, alternative) of the cached answers about an image with an alternative (the
 * alternative is the answer's `evidence`): how many the identifier rule matches (`isIdentifierAlt`) and how many the
 * absence set matches (`isAbsenceAlt`), split by the verdicts cached for them, and whether the patterns before this
 * change (the build in .rampa/alt-labels/dist-before, the branch's tip before it) already called each a placeholder.
 *
 * Part (b), among the distinct (page, alternative) with a cached answer of verdict "fail" and problem "wrong_content":
 * how many are short (`isShortAlternative`), and how many of those keep the placeholder or generic wording, which wins.
 * Whether the image is a functional one, which also wins, is not in the cache: the replay says what one build does.
 *
 * Each matched or short alternative is joined to the study's data/findings.json rows (same page, criterion 1.1.1,
 * subject equal to the alternative, dev rows only) for the two Claude judges' final label, where a finding exists.
 *
 * Only pages whose split is "dev" are read: no cache, finding or snapshot of a test page is opened.
 *
 * Run from the repository root, after copying the branch tip's build to .rampa/alt-labels/dist-before:
 *   node study/notes-alt-labels/count.ts > study/notes-alt-labels/data/count.md
 * Writes study/notes-alt-labels/data/count.json and prints the tables.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isAbsenceAlt, isGenericAlt, isIdentifierAlt, isShortAlternative, looksLikePlaceholder } from '../../src/criteria/non-text-content.ts'

const RECORDINGS = process.env.RECORDINGS ?? 'C:/Users/guilh/dev/rampa-study-recordings'
const CACHES = join(RECORDINGS, 'notes-precision-p3p4-2026-10-29', 'caches-after')
const BEFORE = resolve(process.env.DIST_BEFORE ?? join('.rampa', 'alt-labels', 'dist-before'), 'index.mjs')
const STUDIES = [
  { study: 's2', input: 'fresh-2026-10-11' },
  { study: 's3', input: 'round-3-2026-10-23' },
  { study: 's4', input: 'round-4-2026-10-24' },
  { study: 's5', input: 'round-5-2026-10-28' },
] as const

interface Answer {
  verdict?: string
  evidence?: string
  problem?: string
  imageShows?: string
  suggestedAlt?: string
}
interface FindingRow {
  slug: string
  split: string
  criterion: string
  subject?: string | null
  final?: string | null
  run?: string
  origin?: string
  ref?: string
  message?: string
}

if (!existsSync(BEFORE)) throw new Error(`no build before the change at ${BEFORE}`)
const before = (await import(pathToFileURL(BEFORE).href)) as { looksLikePlaceholder: (alt: string, src?: string) => boolean }

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

/** The cached 1.1.1 answers about an image with an alternative on one page. */
function answers(study: string, slug: string): Answer[] {
  const dir = join(CACHES, study, slug, 'cache')
  if (!existsSync(dir)) return []
  const out: Answer[] = []
  for (const file of readdirSync(dir, { recursive: true }) as string[]) {
    if (!file.endsWith('.json')) continue
    const output = readJson<{ output?: Answer }>(join(dir, file)).output
    if (output && typeof output.suggestedAlt === 'string' && typeof output.problem === 'string' && typeof output.imageShows === 'string') out.push(output)
  }
  return out
}

type Counts = {
  pages: number
  entries: number
  alternatives: number
  identifier: number
  identifierPass: number
  identifierFail: number
  identifierBefore: number
  absence: number
  absencePass: number
  absenceFail: number
  absenceBefore: number
  wrongContent: number
  short: number
  shortPlaceholderOrGeneric: number
  shortWording: number
}
const zero = (): Counts => ({
  pages: 0,
  entries: 0,
  alternatives: 0,
  identifier: 0,
  identifierPass: 0,
  identifierFail: 0,
  identifierBefore: 0,
  absence: 0,
  absencePass: 0,
  absenceFail: 0,
  absenceBefore: 0,
  wrongContent: 0,
  short: 0,
  shortPlaceholderOrGeneric: 0,
  shortWording: 0,
})

const matched: Array<Record<string, unknown>> = []
const shortItems: Array<Record<string, unknown>> = []
const perStudy: Record<string, Counts> = {}
for (const { study, input } of STUDIES) {
  const pages = readJson<Array<{ slug: string; split: string }>>(join('study', input, 'data', 'pages.json')).filter((page) => page.split === 'dev')
  const dev = new Set(pages.map((page) => page.slug))
  const findings = readJson<FindingRow[]>(join('study', input, 'data', 'findings.json')).filter((row) => row.split === 'dev' && dev.has(row.slug) && row.criterion === '1.1.1')
  const labelsOf = (slug: string, alt: string) =>
    findings.filter((row) => row.slug === slug && (row.subject ?? '') === alt).map((row) => ({ ref: row.ref, run: row.run, origin: row.origin ?? null, final: row.final ?? null, message: row.message }))
  const counts = zero()
  counts.pages = pages.length
  for (const { slug } of pages) {
    // One item per distinct alternative: the verdicts and the fail problems cached for it.
    const items = new Map<string, { verdicts: Record<string, number>; problems: Record<string, number> }>()
    for (const answer of answers(study, slug)) {
      counts.entries++
      const alt = answer.evidence ?? ''
      const item = items.get(alt) ?? { verdicts: {}, problems: {} }
      const verdict = answer.verdict ?? ''
      item.verdicts[verdict] = (item.verdicts[verdict] ?? 0) + 1
      if (verdict === 'fail') item.problems[answer.problem ?? ''] = (item.problems[answer.problem ?? ''] ?? 0) + 1
      items.set(alt, item)
    }
    for (const [alt, { verdicts, problems }] of [...items.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      counts.alternatives++
      const pass = (verdicts.pass ?? 0) > 0
      const fail = (verdicts.fail ?? 0) > 0
      const identifier = isIdentifierAlt(alt)
      const absence = isAbsenceAlt(alt)
      const placeholderBefore = before.looksLikePlaceholder(alt)
      if (identifier) {
        counts.identifier++
        if (pass) counts.identifierPass++
        if (fail) counts.identifierFail++
        if (placeholderBefore) counts.identifierBefore++
      }
      if (absence) {
        counts.absence++
        if (pass) counts.absencePass++
        if (fail) counts.absenceFail++
        if (placeholderBefore) counts.absenceBefore++
      }
      if (identifier || absence) {
        matched.push({ study, slug, alternative: alt, rule: identifier ? 'identifier' : 'absence', verdicts, problems, placeholderBefore, findings: labelsOf(slug, alt) })
      }
      if ((problems.wrong_content ?? 0) > 0) {
        counts.wrongContent++
        if (isShortAlternative(alt)) {
          counts.short++
          const patterned = looksLikePlaceholder(alt) || isGenericAlt(alt)
          if (patterned) counts.shortPlaceholderOrGeneric++
          else counts.shortWording++
          shortItems.push({ study, slug, alternative: alt, placeholderOrGeneric: patterned, findings: labelsOf(slug, alt) })
        }
      }
    }
  }
  perStudy[study] = counts
}

const total = zero()
for (const counts of Object.values(perStudy)) for (const key of Object.keys(total) as Array<keyof Counts>) total[key] += counts[key]

writeFileSync(
  join('study', 'notes-alt-labels', 'data', 'count.json'),
  `${JSON.stringify({ caches: 'notes-precision-p3p4-2026-10-29/caches-after', split: 'dev', perStudy, total, matched, short: shortItems }, null, 1)}\n`,
)

const cell = (value: unknown): string => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ')
const labelText = (rows: Array<{ final: string | null; origin: string | null }>): string =>
  rows.length ? rows.map((row) => `${row.final ?? 'none'}${row.origin && row.origin !== 'main' ? ` (${row.origin})` : ''}`).join(', ') : 'no finding'
const verdictText = (verdicts: Record<string, number>, problems: Record<string, number>): string =>
  Object.entries(verdicts)
    .sort()
    .map(([verdict, n]) => (verdict === 'fail' ? `fail ×${n} (${Object.entries(problems).sort().map(([p, k]) => `${p} ×${k}`).join(', ')})` : `${verdict} ×${n}`))
    .join('; ')
const rows = [...Object.entries(perStudy), ['all', total] as const]
const lines: string[] = []
lines.push('# 1.1.1 identifiers, absence texts and short alternatives in the cached answers (dev halves, counted)', '')
lines.push('Distinct (page, alternative) among the cached 1.1.1 answers about an image with an alternative (`count.ts`). In-sample: dev pages, read when the rules were written. An alternative cached with both verdicts counts under each.', '')
lines.push('## Part (a): alternatives the new placeholder rules match', '')
lines.push('| Study | Dev pages | Cached answers | Alternatives | Identifier | with a pass | with a fail | already a placeholder before | Absence text | with a pass | with a fail | already a placeholder before |')
lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |')
for (const [study, c] of rows) {
  lines.push(`| ${study} | ${c.pages} | ${c.entries} | ${c.alternatives} | ${c.identifier} | ${c.identifierPass} | ${c.identifierFail} | ${c.identifierBefore} | ${c.absence} | ${c.absencePass} | ${c.absenceFail} | ${c.absenceBefore} |`)
}
lines.push('', '| Study | Page | Rule | Alternative | Cached verdicts | Placeholder before | Claude final label (findings.json) |')
lines.push('| --- | --- | --- | --- | --- | --- | --- |')
for (const row of matched) {
  lines.push(
    `| ${row.study} | ${row.slug} | ${row.rule} | ${cell(row.alternative)} | ${cell(verdictText(row.verdicts as Record<string, number>, row.problems as Record<string, number>))} | ${row.placeholderBefore ? 'yes' : 'no'} | ${labelText(row.findings as Array<{ final: string | null; origin: string | null }>)} |`,
  )
}
lines.push('', '## Part (b): short alternatives among the "describes something the image does not show" answers', '')
lines.push('| Study | Alternatives with a fail / wrong_content answer | Short (one or two words) | of which a placeholder or a generic word (that wording wins) | of which the new wording can apply |')
lines.push('| --- | --- | --- | --- | --- |')
for (const [study, c] of rows) lines.push(`| ${study} | ${c.wrongContent} | ${c.short} | ${c.shortPlaceholderOrGeneric} | ${c.shortWording} |`)
lines.push('', 'Whether an image is all its link or button holds (its wording wins) or the answer is worded "leaves out" is not in the cache: the replay says which of these one build reports and how.', '')
lines.push('| Study | Page | Alternative | Placeholder or generic | Claude final label (findings.json) |')
lines.push('| --- | --- | --- | --- | --- |')
for (const row of shortItems) {
  lines.push(`| ${row.study} | ${row.slug} | ${cell(row.alternative)} | ${row.placeholderOrGeneric ? 'yes' : 'no'} | ${labelText(row.findings as Array<{ final: string | null; origin: string | null }>)} |`)
}
console.log(lines.join('\n'))
