/**
 * How often a 1.1.1 "describes something the image does not show" answer keeps the alternative only with a word in
 * another number, on the dev halves of the second to fifth real-page studies, from the judgment caches of the P3/P4
 * replay (recordings notes-precision-p3p4-2026-10-29/caches-after/<study>/<slug>/cache). No model, no snapshot: the
 * model's answers as cached.
 *
 * Among the distinct (page, alternative, suggestion) of the cached answers with verdict "fail" and problem
 * "wrong_content", each is put in the first class that holds, in the order `verify` reads them:
 *   a  the suggestion keeps every word of the alternative exactly (`verify` discards it, the suggestion check);
 *   c  the description and the suggestion together keep it exactly (`verify` discards it, the description check);
 *   b  the suggestion keeps it only with a word in another number (`keepsAlternative` with `forms`): `verify` keeps
 *      the claim, and the new wording applies when the suggestion also adds a word (`extendsAlternative`);
 *   d  the description and the suggestion together keep it only with `forms`: `verify` keeps it, and the message is
 *      unchanged (the message reads the suggestion alone);
 *   e  none of these.
 * An item in b or d is joined to the study's data/findings.json rows (same page, criterion 1.1.1, subject equal to the
 * alternative) for the two Claude judges' final label, where a finding exists.
 *
 * Only pages whose split is "dev" are read: no cache, finding or snapshot of a test page is opened.
 *
 * Run from the repository root: node study/notes-alt-extension/count.ts > study/notes-alt-extension/data/count.md
 * Writes study/notes-alt-extension/data/count.json and prints the tables.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { extendsAlternative, isGenericAlt, keepsAlternative, looksLikePlaceholder } from '../../src/criteria/non-text-content.ts'

const RECORDINGS = process.env.RECORDINGS ?? 'C:/Users/guilh/dev/rampa-study-recordings'
const CACHES = join(RECORDINGS, 'notes-precision-p3p4-2026-10-29', 'caches-after')
const STUDIES = [
  { study: 's2', input: 'fresh-2026-10-11' },
  { study: 's3', input: 'round-3-2026-10-23' },
  { study: 's4', input: 'round-4-2026-10-24' },
  { study: 's5', input: 'round-5-2026-10-28' },
] as const
type Class = 'a' | 'b' | 'c' | 'd' | 'e'
/** The order in which `verify` reaches the classes: the two exact checks first, as at its suggestion and description checks. */
const VERIFY_ORDER: Class[] = ['a', 'c', 'b', 'd', 'e']

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
  fingerprint?: string
}

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

function classify(alt: string, imageShows: string, suggested: string): Class {
  if (keepsAlternative(suggested, alt)) return 'a'
  if (keepsAlternative([imageShows, suggested], alt)) return 'c'
  if (keepsAlternative(suggested, alt, { forms: true })) return 'b'
  if (keepsAlternative([imageShows, suggested], alt, { forms: true })) return 'd'
  return 'e'
}

const rows: Array<Record<string, unknown>> = []
const perStudy: Record<string, Record<Class, number> & { pages: number; entries: number; items: number; bAlsoC: number }> = {}
for (const { study, input } of STUDIES) {
  const pages = readJson<Array<{ slug: string; split: string }>>(join('study', input, 'data', 'pages.json')).filter((page) => page.split === 'dev')
  const dev = new Set(pages.map((page) => page.slug))
  const findings = readJson<FindingRow[]>(join('study', input, 'data', 'findings.json')).filter((row) => row.split === 'dev' && dev.has(row.slug) && row.criterion === '1.1.1')
  const counts = { a: 0, b: 0, c: 0, d: 0, e: 0, pages: pages.length, entries: 0, items: 0, bAlsoC: 0 }
  for (const { slug } of pages) {
    // One item per distinct alternative and suggestion; the descriptions cached with it, in the order read.
    const items = new Map<string, { alt: string; suggested: string; descriptions: string[] }>()
    for (const answer of answers(study, slug)) {
      if (answer.verdict !== 'fail' || answer.problem !== 'wrong_content') continue
      counts.entries++
      const alt = answer.evidence ?? ''
      const suggested = answer.suggestedAlt ?? ''
      const key = JSON.stringify([alt, suggested])
      const item = items.get(key) ?? { alt, suggested, descriptions: [] }
      if (!item.descriptions.includes(answer.imageShows ?? '')) item.descriptions.push(answer.imageShows ?? '')
      items.set(key, item)
    }
    for (const { alt, suggested, descriptions } of [...items.values()].sort((x, y) => (x.alt + x.suggested).localeCompare(y.alt + y.suggested))) {
      counts.items++
      // An item cached with several descriptions takes the class verify reaches first on any of them.
      const classes = descriptions.map((imageShows) => classify(alt, imageShows, suggested))
      const first = VERIFY_ORDER.find((c) => classes.includes(c)) ?? 'e'
      counts[first]++
      const suggestionForms = keepsAlternative(suggested, alt, { forms: true })
      if (first === 'c' && suggestionForms) counts.bAlsoC++
      if (first !== 'b' && first !== 'd') continue
      const extendsIt = extendsAlternative(suggested, alt)
      const labelled = findings.filter((row) => row.slug === slug && (row.subject ?? '') === alt)
      rows.push({
        study,
        slug,
        class: first,
        alternative: alt,
        suggested,
        descriptions,
        classesByDescription: classes,
        extendsAlternative: extendsIt,
        newWording: first === 'b' && extendsIt,
        placeholderOrGeneric: looksLikePlaceholder(alt) || isGenericAlt(alt),
        findings: labelled.map((row) => ({ fingerprint: row.fingerprint, run: row.run, origin: row.origin, final: row.final ?? null })),
      })
    }
  }
  perStudy[study] = counts
}

const total = { a: 0, b: 0, c: 0, d: 0, e: 0, pages: 0, entries: 0, items: 0, bAlsoC: 0 }
for (const counts of Object.values(perStudy)) for (const key of Object.keys(total) as Array<keyof typeof total>) total[key] += counts[key]

writeFileSync(join('study', 'notes-alt-extension', 'data', 'count.json'), `${JSON.stringify({ caches: 'notes-precision-p3p4-2026-10-29/caches-after', split: 'dev', perStudy, total, items: rows }, null, 1)}\n`)

const cell = (value: string): string => value.replaceAll('|', '\\|').replaceAll('\n', ' ')
const lines: string[] = []
lines.push('# 1.1.1 "describes something the image does not show": suggestions that keep the alternative (dev halves, counted)', '')
lines.push('Distinct (page, alternative, suggestion) among the cached answers with verdict `fail` and problem `wrong_content`, classed in the order `verify` reads them (`count.ts`). In-sample: dev pages, read when the rule was written.', '')
lines.push('| Study | Dev pages | Cached answers | Items | (a) suggestion keeps it exactly | (b) suggestion keeps it only with forms | (c) description and suggestion keep it exactly | (d) (c) only with forms | (e) none | of (c), suggestion keeps it with forms |')
lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |')
for (const [study, c] of [...Object.entries(perStudy), ['all', total] as const]) {
  lines.push(`| ${study} | ${c.pages} | ${c.entries} | ${c.items} | ${c.a} | ${c.b} | ${c.c} | ${c.d} | ${c.e} | ${c.bAlsoC} |`)
}
lines.push('', '## Items in (b) and (d)', '')
lines.push('| Study | Page | Class | Alternative | Suggestion | New wording | Claude final label (findings.json) |')
lines.push('| --- | --- | --- | --- | --- | --- | --- |')
for (const row of rows) {
  const labels = (row.findings as Array<{ final: string | null; run?: string }>).map((f) => `${f.final ?? 'none'}${f.run && f.run !== 'default' ? ` (${f.run})` : ''}`)
  lines.push(`| ${row.study} | ${row.slug} | ${row.class} | ${cell(String(row.alternative))} | ${cell(String(row.suggested))} | ${row.newWording ? 'yes' : 'no'} | ${labels.length ? labels.join(', ') : 'no finding'} |`)
}
console.log(lines.join('\n'))
