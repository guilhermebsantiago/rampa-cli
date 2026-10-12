// What happened to every 2.4.4 and 2.4.6 candidate of one recorded page under the current code: past the cap,
// judged and passed, cannot tell, discarded by verification (and why), or failed, and then whether a fact Rampa
// checks grounds the fail (a finding) or not (the model's suggestion, in needsReview). It replays offline from a
// judgment cache, so no model is called and the answers are the ones that cache holds.
//
// With --old-versions the two criteria are keyed with the versions they had in the study's run (2.4.4 version 2,
// 2.4.6 version 3). Their prompts did not change, so the study's own cache then gives the study's answers, read
// by today's code: the effect of the change with the model's answers held fixed.
//
// Run from the repository root:
//   node study/fresh-2026-10-11/scripts/fates.ts <recording>.snapshot.json <cache dir> <out.json> [--old-versions]
import { writeFile } from 'node:fs/promises'
import { fileCache } from '../../../src/core/cache.ts'
import { capCandidates, DEFAULT_MAX_CANDIDATES } from '../../../src/core/check.ts'
import { judgeCandidates } from '../../../src/core/judge.ts'
import { resolveCriteria } from '../../../src/criteria/index.ts'
import { resolveProvider } from '../../../src/cli/commands/check.ts'
import { loadRecorded } from '../../../src/surfaces/targets.ts'
import { runRuleChecks } from '../../../src/rules/index.ts'
import { browserNamed } from '../../../src/snapshot/ax.ts'

const args = process.argv.slice(2)
const oldVersions = args.includes('--old-versions')
const [snapshotPath, cacheDir, outPath] = args.filter((a) => !a.startsWith('--'))
if (!snapshotPath || !cacheDir || !outPath) throw new Error('usage: fates.ts <snapshot.json> <cache dir> <out.json> [--old-versions]')

const OLD: Record<string, string> = { '2.4.4': '2', '2.4.6': '3' }
const loaded = await loadRecorded(snapshotPath, 'en', true)
const { snapshot, engine } = loaded
const provider = await resolveProvider('ollama:gemma4:12b', true)
const cache = fileCache(cacheDir)
const stage = runRuleChecks(snapshot, engine, 'en')
const rows: unknown[] = []
for (const resolved of resolveCriteria(['2.4.4', '2.4.6'])) {
  const criterion = oldVersions ? { ...resolved, version: OLD[resolved.id] ?? resolved.version } : resolved
  if (!criterion.surfaces.includes(snapshot.surface)) continue
  const view = criterion.names === 'browser' ? browserNamed(snapshot) : snapshot
  await criterion.prepare?.(view)
  const failedByRule = stage.decided.get(criterion.id)
  const candidates = criterion.candidates(view, engine).filter((c) => !failedByRule?.has(c.ref))
  const judged = capCandidates(criterion, view, candidates, DEFAULT_MAX_CANDIDATES)
  const inCap = new Set(judged)
  const judgments = await judgeCandidates(criterion, view, judged, { provider, runs: 1, cache, offline: true, concurrency: 4 })
  const byCandidate = new Map(judgments.map((j) => [j.candidate, j]))
  for (const candidate of candidates) {
    const j = byCandidate.get(candidate)
    const output = j?.representative as (Record<string, unknown> & { confidence?: string }) | undefined
    const failed = j?.status === 'failed' && output !== undefined
    const grounded = failed && criterion.grounded ? criterion.grounded(output as never, candidate as never, view) : undefined
    rows.push({
      criterion: criterion.id,
      version: criterion.version,
      ref: candidate.ref,
      subject: criterion.subject?.(candidate),
      inCap: inCap.has(candidate),
      // offline-miss: the cache has no answer for it (a candidate the run never asked).
      status: j ? j.status : 'capped',
      verdict: j?.verdict,
      problem: output?.problem,
      confidence: output?.confidence,
      verification: j?.verification && !j.verification.ok ? j.verification.reason : undefined,
      grounded,
      // finding, suggestion, discarded, passed, cannot_tell, offline-miss, capped, error
      fate: failed ? (grounded === false ? 'suggestion' : 'finding') : j ? j.status : 'capped',
      message: output && (j?.status === 'failed' || j?.status === 'discarded') ? criterion.message(output as never, candidate as never, 'en') : undefined,
      output,
    })
  }
}
await writeFile(outPath, `${JSON.stringify(rows, null, 1)}\n`, 'utf8')
console.log(`${rows.length} candidates written to ${outPath}`)
