/**
 * P3 on the round-5 notes' pool: the 55 confirmed 1.1.1 reading claims of study/notes-precision-round5/data/
 * image-facts.json (second to fifth studies' dev pages and s2-s4, all in-sample), with the frozen rule
 * (`namesNetworkOfLink` on an image that is all its link holds, no file name, placeholder or generic word) beside the
 * notes' wider `altNamesHost` (any host, and a network's name anywhere in the alternative), and which of them main's
 * code still reports at all (the notes' pool mixes the precision probe's verifier run with the shipped pass).
 *
 * Run from the repository root: node study/notes-precision-p3p4/pool.ts > study/notes-precision-p3p4/data/pool.md
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { emptyEngine } from '../../src/engine/axe.ts'
import { isGenericAlt, looksLikePlaceholder, namesNetworkOfLink, nonTextContent } from '../../src/criteria/non-text-content.ts'
import { loadEngineFor, loadSnapshot } from '../../src/surfaces/targets.ts'

const RECORDINGS = process.env.RECORDINGS ?? 'C:/Users/guilh/dev/rampa-study-recordings'
const FOLDERS: Record<string, string> = { s2: 'fresh-2026-10-11', s3: 'round-3-2026-10-23', s4: 'round-4-2026-10-24', s5: 'round-5' }
const pool = JSON.parse(readFileSync('study/notes-precision-round5/data/image-facts.json', 'utf8')) as Array<{ study: string; slug: string; ref: string; alt: string; final: string; altNamesHost: boolean }>

/** Whether main's replay (data/main) still reports the claim, as a finding at any threshold or as a suggestion. */
function inMain(study: string, slug: string, ref: string): string {
  const path = join('study/notes-precision-p3p4/data/main', `${study}.${slug}.judged.json`)
  if (!existsSync(path)) return 'no report'
  const report = JSON.parse(readFileSync(path, 'utf8')) as Record<string, Array<{ criterion: string; ref: string; confidence?: string }> | undefined>
  if ((report.findings ?? []).some((f) => f.criterion === '1.1.1' && f.ref === ref && f.confidence !== 'low')) return 'finding'
  if ([...(report.findings ?? []), ...(report.belowThreshold ?? [])].some((f) => f.criterion === '1.1.1' && f.ref === ref)) return 'below threshold'
  if ((report.needsReview ?? []).some((f) => f.criterion === '1.1.1' && f.ref === ref)) return 'suggestion'
  return 'not reported'
}

const rows: Array<{ study: string; slug: string; alt: string; final: string; notes: boolean; frozen: boolean; main: string }> = []
for (const claim of pool) {
  const recording = join(RECORDINGS, FOLDERS[claim.study]!, 'pages', claim.slug, 'recording')
  const file = existsSync(recording) ? readdirSync(recording).find((name) => name.endsWith('.snapshot.json')) : undefined
  let frozen = false
  if (file) {
    const path = join(recording, file)
    const snapshot = await loadSnapshot(path)
    const candidate = nonTextContent.candidates(snapshot, (await loadEngineFor(path)) ?? emptyEngine()).find((c) => c.ref === claim.ref)
    const c = candidate?.context
    frozen = Boolean(c?.functional && !looksLikePlaceholder(c.alt, c.src) && !isGenericAlt(c.alt) && namesNetworkOfLink(c.alt, c.functional, snapshot))
  }
  rows.push({ study: claim.study, slug: claim.slug, alt: claim.alt, final: claim.final, notes: claim.altNamesHost, frozen, main: inMain(claim.study, claim.slug, claim.ref) })
}
const tally = (pred: (r: (typeof rows)[number]) => boolean) => {
  const selected = rows.filter(pred)
  const n = (final: string) => selected.filter((r) => r.final === final).length
  return `${n('false_positive')} false, ${n('true_positive')} true, ${n('uncertain')} uncertain`
}
console.log(`Confirmed reading claims in the round-5 notes' pool: ${rows.length} (${tally(() => true)}).\n`)
console.log(`- the notes' altNamesHost: ${tally((r) => r.notes)}`)
console.log(`- the frozen rule: ${tally((r) => r.frozen)}`)
console.log(`- the frozen rule, among the claims main's code (a82558e) still reports as a default-threshold finding: ${tally((r) => r.frozen && r.main === 'finding')}\n`)
console.log('| study | page | alternative | label | notes | frozen | in main\'s replay |')
console.log('| --- | --- | --- | --- | --- | --- | --- |')
for (const r of rows.filter((r) => r.notes || r.frozen)) console.log(`| ${r.study} | ${r.slug} | ${JSON.stringify(r.alt.slice(0, 50))} | ${r.final} | ${r.notes ? 'yes' : 'no'} | ${r.frozen ? 'yes' : 'no'} | ${r.main} |`)
