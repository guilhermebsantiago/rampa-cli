/**
 * The capture guard's trigger and the body-look signal, for every page of the fifth study (pre-registered: logged for
 * every page). From each recorded snapshot, with the frozen code's own functions (src/snapshot/reach.ts `captureStyle`,
 * src/snapshot/look.ts `bodyLookOf`, `isDefaultLook`): `reach.stylesheets` as recorded (linked, applied, failed,
 * retried, unstyled), the author style sheets the collector counted (`root.native.authorStyles`), the body look and
 * whether it is the browser's default, the number of elements outside shadow roots and frames, and the verdict the
 * checks read (unstyled or not, and by which signal: `stylesheets`, or `look` for a page with no sheet linked).
 * Also `reach.overlay`, a load that timed out and a page cut at the element limit. No model.
 *
 * Run from the repository root: node study/round-5-2026-10-28/scripts/capture.ts
 * Writes study/round-5-2026-10-28/data/capture.json and prints a markdown table.
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { loadSnapshot } from '../../../src/surfaces/targets.ts'
import { captureStyle } from '../../../src/snapshot/reach.ts'
import { bodyLookOf, isDefaultLook } from '../../../src/snapshot/look.ts'
import { walkTree } from '../../../src/snapshot/tree.ts'
import { FRAME_SEPARATOR, SHADOW_SEPARATOR } from '../../../src/snapshot/refs.ts'

// STUDY_DIR points the script at another study's folder (used once to test it on the fourth study's recordings).
const STUDY = process.env.STUDY_DIR ?? 'study/round-5-2026-10-28'
const meta = JSON.parse(readFileSync(join(STUDY, 'data', 'pages-input.json'), 'utf8')) as { pages: Array<{ slug: string; split: string }> }
const rows: Array<Record<string, unknown>> = []
for (const { slug, split } of meta.pages) {
  const recording = join(STUDY, 'pages', slug, 'recording')
  const file = existsSync(recording) ? readdirSync(recording).find((name) => name.endsWith('.snapshot.json')) : undefined
  if (!file) {
    rows.push({ slug, split, snapshot: null })
    continue
  }
  const snapshot = await loadSnapshot(join(recording, file))
  let elements = 0
  for (const node of walkTree(snapshot.root)) if (!node.ref.includes(SHADOW_SEPARATOR) && !node.ref.includes(FRAME_SEPARATOR)) elements++
  const look = bodyLookOf(snapshot.root)
  const reach = snapshot.reach
  rows.push({
    slug,
    split,
    stylesheets: reach?.stylesheets ?? null,
    authorStyles: snapshot.root.native.authorStyles ?? null,
    bodyLook: look ?? null,
    defaultLook: isDefaultLook(look),
    elements,
    verdict: captureStyle(snapshot),
    overlay: reach?.overlay ?? null,
    loadTimedOutMs: reach?.loadTimedOutMs ?? null,
    truncated: Boolean((snapshot as { truncated?: boolean }).truncated),
  })
}
writeFileSync(join(STUDY, 'data', 'capture.json'), `${JSON.stringify(rows, null, 1)}\n`)
const out = [
  '| split | page | sheets linked / applied / failed | retried | recorded unstyled | author styles | body look | default look | elements | read as unstyled (by) | layer over the viewport | other |',
  '| --- | --- | --- | --- | --- | ---: | --- | --- | ---: | --- | --- | --- |',
]
for (const r of rows) {
  if (r.snapshot === null) {
    out.push(`| ${r.split} | ${r.slug} | no snapshot | | | | | | | | | |`)
    continue
  }
  const s = r.stylesheets as { linked: number; applied: number; failed: unknown[]; retried?: boolean; unstyled?: boolean } | null
  const l = r.bodyLook as { size: number; weight: number; family: string; color: string } | null
  const v = r.verdict as { unstyled: boolean; by?: string; selfLinks?: number }
  const o = r.overlay as { selector: string; coverage: number } | null
  const other = [r.loadTimedOutMs ? `load timed out at ${r.loadTimedOutMs} ms` : '', r.truncated ? 'cut at the element limit' : ''].filter(Boolean).join('; ')
  out.push(
    `| ${r.split} | ${r.slug} | ${s ? `${s.linked} / ${s.applied} / ${s.failed.length}` : '–'} | ${s?.retried ? 'yes' : ''} | ${s?.unstyled ? 'yes' : ''} | ${r.authorStyles ?? '–'} | ${l ? `${l.size}px ${l.weight} ${l.family} ${l.color}` : '–'} | ${r.defaultLook ? 'yes' : ''} | ${r.elements} | ${v.unstyled ? `yes (${v.by})` : v.selfLinks ? `no (self-links ${v.selfLinks})` : ''} | ${o ? `${o.selector.slice(0, 40)} ${Math.round(o.coverage * 100)}%` : ''} | ${other} |`,
  )
}
console.log(out.join('\n'))
