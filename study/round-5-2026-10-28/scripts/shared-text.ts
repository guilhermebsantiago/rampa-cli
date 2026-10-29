/**
 * The 2.4.4 shared-text fact with and without the H81 nesting context (fix F1 of docs/studies/notes-precision-fixes.md),
 * on every recorded snapshot of the fifth real-page study, with no model: study/notes-precision-fixes/shared-text.ts for
 * this study's pages. For each page, how many link candidates the fact grounds ("shared by N links that lead to
 * different places, and nothing around this one tells it apart": `sameText.places > 1 && !sameText.apart`) without the
 * nesting (the frozen copy of link-purpose.ts at 6a8de75 that shared-text.sh writes to .rampa/base-src) and with it (src,
 * b759128); and for every link, both facts, so that the 2.4.4 claims the nesting tells apart can be found in the main
 * run's suggestions (sample_suggestions.py) and counted (extras.py).
 *
 * Run from the repository root: bash study/round-5-2026-10-28/scripts/shared-text.sh
 * Writes study/round-5-2026-10-28/data/shared-text.json and prints a markdown summary.
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { browserNamed } from '../../../src/snapshot/ax.ts'
import { emptyEngine } from '../../../src/engine/axe.ts'
import { loadEngineFor, loadSnapshot } from '../../../src/surfaces/targets.ts'
import type { A11ySnapshot } from '../../../src/snapshot/schema.ts'
import type { EngineResults } from '../../../src/core/types.ts'
import { linkPurpose as after } from '../../../src/criteria/link-purpose.ts'

// STUDY_DIR points the script at another study's folder (used once to test it on the fourth study's recordings).
const STUDY = process.env.STUDY_DIR ?? 'study/round-5-2026-10-28'
const base = (await import(join(process.cwd(), '.rampa/base-src/criteria/link-purpose.ts').replaceAll('\\', '/').replace(/^([A-Za-z]):/, 'file:///$1:'))) as { linkPurpose: typeof after }
const before = base.linkPurpose

type Fact = { links: number; places: number; apart: boolean } | undefined
const grounds = (fact: Fact) => Boolean(fact && fact.places > 1 && !fact.apart)
const meta = JSON.parse(readFileSync(join(STUDY, 'data', 'pages-input.json'), 'utf8')) as { pages: Array<{ slug: string; split: string }> }

const pages: Array<{ slug: string; split: string; candidates: number; groundedBefore: number; groundedAfter: number }> = []
const links: Array<{ slug: string; split: string; ref: string; name: string; before: Fact; after: Fact }> = []
for (const { slug, split } of meta.pages) {
  const recording = join(STUDY, 'pages', slug, 'recording')
  if (!existsSync(recording)) continue
  const file = readdirSync(recording).find((name) => name.endsWith('.snapshot.json'))
  if (!file) continue
  const path = join(recording, file)
  const snapshot: A11ySnapshot = browserNamed(await loadSnapshot(path))
  const engine: EngineResults = (await loadEngineFor(path)) ?? emptyEngine()
  const old = new Map(before.candidates(snapshot, engine).map((c) => [c.ref, c] as const))
  const now = new Map(after.candidates(snapshot, engine).map((c) => [c.ref, c] as const))
  pages.push({
    slug,
    split,
    candidates: now.size,
    groundedBefore: [...old.values()].filter((c) => grounds(c.context.sameText)).length,
    groundedAfter: [...now.values()].filter((c) => grounds(c.context.sameText)).length,
  })
  for (const ref of new Set([...old.keys(), ...now.keys()])) {
    const b = old.get(ref)?.context.sameText
    const a = now.get(ref)?.context.sameText
    if (!b && !a) continue
    links.push({ slug, split, ref, name: (now.get(ref) ?? old.get(ref))?.context.name ?? '', before: b, after: a })
  }
}

writeFileSync(join(STUDY, 'data', 'shared-text.json'), `${JSON.stringify({ pages, links }, null, 1)}\n`)
const out: string[] = ["# The shared-text fact without and with the H81 nesting, on the fifth study's snapshots (no model)", '']
out.push('| split | page | link candidates | grounded without the nesting | grounded with it (b759128) | told apart by the nesting |', '| --- | --- | ---: | ---: | ---: | ---: |')
for (const page of pages) {
  const apart = links.filter((l) => l.slug === page.slug && grounds(l.before) && !grounds(l.after)).length
  out.push(`| ${page.split} | ${page.slug} | ${page.candidates} | ${page.groundedBefore} | ${page.groundedAfter} | ${apart} |`)
}
const sum = (key: 'groundedBefore' | 'groundedAfter') => pages.reduce((n, page) => n + page[key], 0)
out.push(
  '',
  `All ${pages.length} snapshots: ${sum('groundedBefore')} grounded shared-text candidates without the nesting, ${sum('groundedAfter')} with it; ${links.filter((l) => grounds(l.before) && !grounds(l.after)).length} told apart by the nesting, ${links.filter((l) => !grounds(l.before) && grounds(l.after)).length} grounded only with it.`,
)
out.push('', 'The candidates are every link 2.4.4 considers, before its cap: a grounded candidate becomes a finding only if the cap lets it be judged and the model fails it as ambiguous.')
console.log(out.join('\n'))
