/**
 * Compares two offline replays of replay.sh, page by page, on the dev halves of the second to fifth studies:
 * - the sets of findings, below-threshold findings and suggestions (needsReview), each item keyed by criterion, ref,
 *   fingerprint and source (a suggestion by criterion, ref and rule), and the cache misses (offlineMisses in each
 *   criterion's summary) and model calls, which must be equal;
 * - part (a): every 1.1.1 judgment whose place changes (finding, below threshold, suggestion, discarded and why, or
 *   absent), or a finding that gains or loses its `confirmation`, with its alternative, whether the new placeholder
 *   rules match it, and the two Claude judges' final label where the study labelled that element (its
 *   data/findings.json, dev rows, same page and ref, any origin: the main run, the --no-confirm ablation or the
 *   suggestion sample); an element with no label is reported as unlabelled;
 * - part (b) and the rest: every message that changes, with the same label, and whether it is the new "names a label,
 *   not what the image conveys here" wording or the placeholder wording of part (a); every other difference between the
 *   two reports, field by field (createdAt aside), is listed;
 * - a table: of the 1.1.1 judgment findings worded "describes something the image does not show" before, how each is
 *   worded after, split by label.
 *
 * Only pages whose split is "dev" are read: no report, finding or label of a test page is opened.
 *
 * Run from the repository root after both replays:
 *   node study/notes-alt-labels/compare.ts before after > study/notes-alt-labels/data/compare.md
 * Reads .rampa/alt-labels/replay/<label>/ (ignored by git); writes study/notes-alt-labels/data/compare.json.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isAbsenceAlt, isIdentifierAlt } from '../../src/criteria/non-text-content.ts'

const [BEFORE = 'before', AFTER = 'after'] = process.argv.slice(2)
const REPLAY = join('.rampa', 'alt-labels', 'replay')
const STUDIES = [
  { study: 's2', input: 'fresh-2026-10-11' },
  { study: 's3', input: 'round-3-2026-10-23' },
  { study: 's4', input: 'round-4-2026-10-24' },
  { study: 's5', input: 'round-5-2026-10-28' },
] as const

const WORDINGS = [
  ['placeholder', 'is a file name or a placeholder'],
  ['names a label', 'names a label, not what the image conveys here'],
  ['leaves out', 'leaves out what the image conveys here'],
  ['does not show', 'describes something the image does not show'],
  ['functional', 'is all its'],
] as const
type Wording = (typeof WORDINGS)[number][0] | 'other' | 'absent'
const wordingOf = (message: string | undefined): Wording => (message === undefined ? 'absent' : (WORDINGS.find(([, text]) => message.includes(text))?.[0] ?? 'other'))

type Item = {
  criterion?: string
  ref?: string
  fingerprint?: string
  source?: string
  ruleId?: string
  message?: string
  subject?: string
  evidence?: string
  confirmation?: unknown
}
type Discarded = { criterion?: string; ref?: string; reason?: string; output?: { evidence?: string } }
type Report = {
  findings?: Item[]
  belowThreshold?: Item[]
  needsReview?: Item[]
  discarded?: Discarded[]
  criteria?: Array<{ criterion: string; offlineMisses?: number }>
  usage?: { calls?: number; cachedCalls?: number }
  [key: string]: unknown
}
type Label = { final: string | null; origin: string | null; run?: string }
interface FindingRow {
  slug: string
  split: string
  criterion: string
  ref?: string
  final?: string | null
  origin?: string
  run?: string
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

const keyOf = (item: Item): string => JSON.stringify([item.criterion ?? '', item.ref ?? '', item.fingerprint ?? '', item.source ?? '', item.ruleId ?? ''])
const keys = (items: Item[] | undefined): string[] => (items ?? []).map(keyOf).sort()
const same = (a: string[], b: string[]): boolean => a.length === b.length && a.every((value, i) => value === b[i])
const misses = (report: Report): number => (report.criteria ?? []).reduce((sum, c) => sum + (c.offlineMisses ?? 0), 0)
const quoted = (message: string | undefined): string => /"(.*)"/.exec(message ?? '')?.[1] ?? ''

/** Where each 1.1.1 judgment of a report is, by element: its list, and the item. */
type Place = { place: string; alternative: string; message?: string; confirmed: boolean; item?: Item }
function places(report: Report): Map<string, Place> {
  const out = new Map<string, Place>()
  const judged = (item: Item): boolean => item.criterion === '1.1.1' && (item.source === 'judgment' || item.ruleId === 'judgment/1.1.1')
  for (const list of ['findings', 'belowThreshold', 'needsReview'] as const) {
    for (const item of report[list] ?? []) {
      if (!judged(item) || !item.ref) continue
      out.set(item.ref, { place: list, alternative: item.subject ?? quoted(item.message), message: item.message, confirmed: item.confirmation !== undefined, item })
    }
  }
  for (const d of report.discarded ?? []) {
    if (d.criterion !== '1.1.1' || !d.ref || out.has(d.ref)) continue
    out.set(d.ref, { place: `discarded: ${d.reason ?? ''}`, alternative: d.output?.evidence ?? '', confirmed: false })
  }
  return out
}

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

const pages: Array<Record<string, unknown>> = []
const perStudy: Record<string, { pages: number; identicalSets: number; missesBefore: number; missesAfter: number; callsBefore: number; callsAfter: number; placeChanges: number; messageChanges: number; otherChanges: number }> = {}
const placeChanges: Array<Record<string, unknown>> = []
const messageChanges: Array<Record<string, unknown>> = []
const otherChanges: Array<Record<string, unknown>> = []
const wording: Array<{ study: string; slug: string; ref: string; alternative: string; after: Wording; label: string }> = []
for (const { study, input } of STUDIES) {
  const dev = readJson<Array<{ slug: string; split: string }>>(join('study', input, 'data', 'pages.json')).filter((page) => page.split === 'dev')
  const devSlugs = new Set(dev.map((page) => page.slug))
  const rows = readJson<FindingRow[]>(join('study', input, 'data', 'findings.json')).filter((row) => row.split === 'dev' && devSlugs.has(row.slug) && row.criterion === '1.1.1')
  const labelsOf = (slug: string, ref: string | undefined): Label[] => rows.filter((row) => row.slug === slug && row.ref === ref).map((row) => ({ final: row.final ?? null, origin: row.origin ?? null, run: row.run }))
  const totals = { pages: 0, identicalSets: 0, missesBefore: 0, missesAfter: 0, callsBefore: 0, callsAfter: 0, placeChanges: 0, messageChanges: 0, otherChanges: 0 }
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

    // Part (a): each element whose place, or whose second-pass confirmation, changed.
    const was = places(before)
    const now = places(after)
    for (const ref of [...new Set([...was.keys(), ...now.keys()])].sort()) {
      const a = was.get(ref)
      const b = now.get(ref)
      const placeBefore = a?.place ?? 'absent'
      const placeAfter = b?.place ?? 'absent'
      const confirmation = placeBefore === 'findings' && placeAfter === 'findings' && a?.confirmed !== b?.confirmed
      if (placeBefore === placeAfter && !confirmation) continue
      const alternative = a?.alternative || b?.alternative || ''
      totals.placeChanges++
      placeChanges.push({
        study,
        slug,
        ref,
        alternative,
        rule: isIdentifierAlt(alternative) ? 'identifier' : isAbsenceAlt(alternative) ? 'absence' : 'neither',
        before: placeBefore,
        after: placeAfter,
        confirmationBefore: a?.item?.confirmation ?? null,
        confirmationAfter: b?.item?.confirmation ?? null,
        messageBefore: a?.message ?? null,
        messageAfter: b?.message ?? null,
        labels: labelsOf(slug, ref),
      })
    }

    // Field by field: messages apart, everything else listed.
    const differences: Array<{ path: string; before: unknown; after: unknown }> = []
    diff(before, after, '', differences)
    for (const d of differences) {
      const message = /^\/(findings|belowThreshold|needsReview)\[(\d+)\]\/message$/.exec(d.path)
      if (message && identical) {
        const list = message[1] as 'findings' | 'belowThreshold' | 'needsReview'
        const item = (before[list] ?? [])[Number(message[2])]
        totals.messageChanges++
        messageChanges.push({
          study,
          slug,
          list,
          criterion: item?.criterion,
          ref: item?.ref,
          alternative: quoted(String(d.before)),
          before: d.before,
          after: d.after,
          wording: wordingOf(String(d.after)),
          labels: labelsOf(slug, item?.ref),
        })
      } else {
        totals.otherChanges++
        otherChanges.push({ study, slug, ...d })
      }
    }

    // The wording table: findings worded "does not show" before, and how the same element is worded after.
    for (const item of before.findings ?? []) {
      if (item.criterion !== '1.1.1' || item.source !== 'judgment' || wordingOf(item.message) !== 'does not show' || !item.ref) continue
      const later = (after.findings ?? []).find((other) => other.criterion === '1.1.1' && other.source === 'judgment' && other.ref === item.ref)
      const labels = labelsOf(slug, item.ref)
      wording.push({ study, slug, ref: item.ref, alternative: item.subject ?? quoted(item.message), after: wordingOf(later?.message), label: labels[0]?.final ?? 'unlabelled' })
    }
  }
  perStudy[study] = totals
}

const LABELS = ['true_positive', 'false_positive', 'uncertain', 'unlabelled'] as const
const AFTER_WORDINGS: Wording[] = ['placeholder', 'names a label', 'leaves out', 'does not show', 'functional', 'other', 'absent']
const table: Record<string, Record<string, number>> = {}
for (const w of AFTER_WORDINGS) table[w] = Object.fromEntries(LABELS.map((label) => [label, 0]))
for (const row of wording) table[row.after]![LABELS.includes(row.label as (typeof LABELS)[number]) ? row.label : 'unlabelled']!++

writeFileSync(
  join('study', 'notes-alt-labels', 'data', 'compare.json'),
  `${JSON.stringify({ before: BEFORE, after: AFTER, perStudy, placeChanges, messageChanges, otherChanges, wordingTable: table, wording, pages }, null, 1)}\n`,
)

const cell = (value: unknown): string => String(value).replaceAll('|', '\\|')
const labelText = (labels: Label[]): string =>
  labels.length ? labels.map((label) => `${label.final ?? 'none'}${label.origin && label.origin !== 'main' ? ` (${label.origin})` : ''}`).join(', ') : 'unlabelled'
const confirmationText = (value: unknown): string => {
  if (!value || typeof value !== 'object') return 'none'
  const c = value as { framings?: number; minProbability?: number; identical?: { claims: number; confirmed: number } }
  return `${c.framings ?? '?'} framings${c.minProbability !== undefined ? `, min ${c.minProbability.toFixed(3)}` : ''}${c.identical ? `, identical ${c.identical.confirmed}/${c.identical.claims}` : ''}`
}
const lines: string[] = []
lines.push(`# Offline replay of 1.1.1 on the dev halves: ${BEFORE} against ${AFTER}`, '')
lines.push("Sets keyed by criterion, ref, fingerprint and source (suggestions by criterion, ref and rule). Misses are the reports' `offlineMisses`; calls are new model calls (none can happen offline). Labels: the studies' two Claude judges (data/findings.json, dev rows, same page and ref). In-sample: dev pages.", '')
lines.push('| Study | Pages | Identical sets | Misses before | Misses after | Calls before | Calls after | Place or confirmation changes | Message changes | Other changes |')
lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |')
for (const [study, t] of Object.entries(perStudy)) {
  lines.push(`| ${study} | ${t.pages} | ${t.identicalSets} / ${t.pages} | ${t.missesBefore} | ${t.missesAfter} | ${t.callsBefore} | ${t.callsAfter} | ${t.placeChanges} | ${t.messageChanges} | ${t.otherChanges} |`)
}
lines.push('', '## Part (a): elements whose place or second-pass confirmation changes', '')
lines.push('| Study | Page | Alternative | Rule | Before | After | Confirmation before | Confirmation after | Claude final label |')
lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |')
for (const c of placeChanges) {
  lines.push(
    `| ${c.study} | ${c.slug} | ${cell(c.alternative)} | ${c.rule} | ${cell(c.before)} | ${cell(c.after)} | ${cell(confirmationText(c.confirmationBefore))} | ${cell(confirmationText(c.confirmationAfter))} | ${labelText(c.labels as Label[])} |`,
  )
}
lines.push('', '## Message changes on pages whose sets are identical', '')
lines.push('| Study | Page | List | Alternative | Before | After | New wording | Claude final label |')
lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |')
for (const c of messageChanges) {
  lines.push(`| ${c.study} | ${c.slug} | ${c.list} | ${cell(c.alternative)} | ${cell(c.before)} | ${cell(c.after)} | ${c.wording} | ${labelText(c.labels as Label[])} |`)
}
lines.push('', '## Findings worded "describes something the image does not show" before, by their wording after', '')
lines.push('| Wording after | True | False | Uncertain | Unlabelled | All |')
lines.push('| --- | --- | --- | --- | --- | --- |')
for (const w of AFTER_WORDINGS) {
  const r = table[w]!
  const all = LABELS.reduce((sum, label) => sum + r[label]!, 0)
  if (all === 0 && (w === 'functional' || w === 'other' || w === 'absent')) continue
  lines.push(`| ${w === 'does not show' ? 'unchanged ("does not show")' : w} | ${r.true_positive} | ${r.false_positive} | ${r.uncertain} | ${r.unlabelled} | ${all} |`)
}
lines.push('', `Other differences between the reports (createdAt aside): ${otherChanges.length}.`)
for (const change of otherChanges) lines.push(`- ${change.study} ${change.slug} \`${cell(change.path)}\`: ${cell(JSON.stringify(change.before))} → ${cell(JSON.stringify(change.after))}`)
console.log(lines.join('\n'))
