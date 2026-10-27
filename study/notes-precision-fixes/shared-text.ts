/**
 * The 2.4.4 shared-text fact before and after the H81 nesting context (fix F1), on every recorded snapshot of the
 * second, third and fourth real-page studies, with no model: for each labelled "shared by N links" finding, whether the
 * fact still grounds it (`sameText.places > 1 && !sameText.apart`), and for each page, how many link candidates the fact
 * grounds before and after. The "before" module is the frozen copy of src/criteria/link-purpose.ts at 6a8de75 that
 * `shared-text.sh` writes to .rampa/base-src (imports rewritten to this worktree's src); the "after" one is src.
 *
 * Run from the repository root: bash study/notes-precision-fixes/shared-text.sh
 * Writes study/notes-precision-fixes/data/shared-text.json and prints a markdown summary.
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { browserNamed } from '../../src/snapshot/ax.ts'
import { emptyEngine } from '../../src/engine/axe.ts'
import { loadEngineFor, loadSnapshot } from '../../src/surfaces/targets.ts'
import type { A11ySnapshot } from '../../src/snapshot/schema.ts'
import type { EngineResults } from '../../src/core/types.ts'
import { linkPurpose as after } from '../../src/criteria/link-purpose.ts'

const RECORDINGS = process.env.RECORDINGS ?? 'C:/Users/guilh/dev/rampa-study-recordings'
const base = (await import(join(process.cwd(), '.rampa/base-src/criteria/link-purpose.ts').replaceAll('\\', '/').replace(/^([A-Za-z]):/, 'file:///$1:'))) as { linkPurpose: typeof after }
const before = base.linkPurpose

const STUDIES = [
  { study: 's2', folder: 'fresh-2026-10-11' },
  { study: 's3', folder: 'round-3-2026-10-23' },
  { study: 's4', folder: 'round-4-2026-10-24' },
] as const

interface Label {
  study: string
  split: string
  slug: string
  ref: string
  subject: string
  final: string
}

const readJson = (path: string) => JSON.parse(readFileSync(path, 'utf8'))
const labels: Label[] = []
for (const row of readJson('study/notes-precision-probe/data/rows-latest.json') as Array<Record<string, string | boolean>>) {
  if (row.criterion !== '2.4.4' || !row.shown || !String(row.message).includes('shared by')) continue
  const study = row.study === 's3' ? 's3' : row.study === 's2-after' ? 's2' : undefined
  if (study) labels.push({ study, split: String(row.split), slug: String(row.slug), ref: String(row.ref), subject: String(row.subject), final: String(row.final) })
}
for (const row of readJson('study/round-4-2026-10-24/data/findings.json') as Array<Record<string, string | boolean>>) {
  if (row.origin !== 'main' || row.group !== 'judged' || !row.shown || row.criterion !== '2.4.4' || !String(row.message).includes('shared by')) continue
  labels.push({ study: 's4', split: String(row.split), slug: String(row.slug), ref: String(row.ref), subject: String(row.subject), final: String(row.final) })
}

type Fact = { links: number; places: number; apart: boolean } | undefined
const grounds = (fact: Fact) => Boolean(fact && fact.places > 1 && !fact.apart)

const pages: Array<{ study: string; slug: string; candidates: number; groundedBefore: number; groundedAfter: number }> = []
const rows: Array<Label & { before: Fact; after: Fact; nestingFound: boolean }> = []
for (const { study, folder } of STUDIES) {
  const dir = join(RECORDINGS, folder, 'pages')
  for (const slug of readdirSync(dir).sort()) {
    const recording = join(dir, slug, 'recording')
    if (!existsSync(recording)) continue
    const file = readdirSync(recording).find((name) => name.endsWith('.snapshot.json'))
    if (!file) continue
    const path = join(recording, file)
    const snapshot: A11ySnapshot = browserNamed(await loadSnapshot(path))
    const engine: EngineResults = (await loadEngineFor(path)) ?? emptyEngine()
    const old = new Map(before.candidates(snapshot, engine).map((c) => [c.ref, c.context.sameText] as const))
    const now = new Map(after.candidates(snapshot, engine).map((c) => [c.ref, c.context.sameText] as const))
    pages.push({
      study,
      slug,
      candidates: now.size,
      groundedBefore: [...old.values()].filter(grounds).length,
      groundedAfter: [...now.values()].filter(grounds).length,
    })
    for (const label of labels.filter((l) => l.study === study && l.slug === slug)) {
      rows.push({ ...label, before: old.get(label.ref), after: now.get(label.ref), nestingFound: now.has(label.ref) })
    }
  }
}

writeFileSync('study/notes-precision-fixes/data/shared-text.json', `${JSON.stringify({ rows, pages }, null, 1)}\n`)
const out: string[] = ['# The shared-text fact before and after F1, on the recorded snapshots (no model)', '']
out.push('| study | split | page | label | findings | still grounded after F1 |', '| --- | --- | --- | --- | ---: | ---: |')
const groups = new Map<string, typeof rows>()
for (const row of rows) groups.set(`${row.study}|${row.split}|${row.slug}|${row.final}`, [...(groups.get(`${row.study}|${row.split}|${row.slug}|${row.final}`) ?? []), row])
for (const [key, items] of [...groups].sort()) {
  const [study, split, slug, final] = key.split('|')
  out.push(`| ${study} | ${split} | ${slug} | ${final} | ${items.length} | ${items.filter((r) => grounds(r.after)).length} |`)
}
const total = (final: string, side: 'before' | 'after') => rows.filter((r) => r.final === final && grounds(r[side])).length
out.push('', `Labelled shared-text findings: ${rows.length} (missing from the snapshot's candidates: ${rows.filter((r) => !r.nestingFound).length}).`)
for (const final of ['true_positive', 'false_positive', 'uncertain']) out.push(`- ${final}: grounded before ${total(final, 'before')}, after ${total(final, 'after')}`)
out.push('', '| study | page | link candidates | grounded shared-text before | after |', '| --- | --- | ---: | ---: | ---: |')
for (const page of pages) if (page.groundedBefore !== page.groundedAfter || page.groundedBefore > 0) out.push(`| ${page.study} | ${page.slug} | ${page.candidates} | ${page.groundedBefore} | ${page.groundedAfter} |`)
const sum = (key: 'groundedBefore' | 'groundedAfter') => pages.reduce((n, page) => n + page[key], 0)
out.push('', `All ${pages.length} snapshots: ${sum('groundedBefore')} grounded shared-text candidates before, ${sum('groundedAfter')} after.`)
console.log(out.join('\n'))
