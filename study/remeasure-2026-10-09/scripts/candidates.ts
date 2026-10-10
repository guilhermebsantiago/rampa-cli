// What happened to every candidate of every judged criterion on one recorded page: judged and failed,
// passed, cannot tell, discarded by verification (and why), past the cap, or not judged (the time limit).
// It replays the run offline from the page's own judgment cache, so no model is called and the verdicts
// are the ones the run got. Used to say why a true positive of the first run is missing from this one.
//
// Run from the repository root:
//   node study/remeasure-2026-10-09/scripts/candidates.ts <recording>.snapshot.json <cache dir> <out.json>
import { writeFile } from 'node:fs/promises'
import { fileCache } from '../../../src/core/cache.ts'
import { capCandidates, DEFAULT_MAX_CANDIDATES } from '../../../src/core/check.ts'
import { judgeCandidates } from '../../../src/core/judge.ts'
import { resolveCriteria } from '../../../src/criteria/index.ts'
import { resolveProvider } from '../../../src/cli/commands/check.ts'
import { loadRecorded } from '../../../src/surfaces/targets.ts'
import { runRuleChecks } from '../../../src/rules/index.ts'

const [snapshotPath, cacheDir, outPath] = process.argv.slice(2)
if (!snapshotPath || !cacheDir || !outPath) throw new Error('usage: candidates.ts <snapshot.json> <cache dir> <out.json>')

const CRITERIA = '1.1.1,1.3.5,2.4.2,2.4.4,2.4.6,3.1.1,3.1.2,3.3.2'
const loaded = await loadRecorded(snapshotPath, 'en', true)
const { snapshot, engine } = loaded
const provider = await resolveProvider('ollama:gemma4:12b', true)
const cache = fileCache(cacheDir)
const stage = runRuleChecks(snapshot, engine, 'en')
const rows: unknown[] = []
for (const criterion of resolveCriteria(CRITERIA.split(','))) {
  if (!criterion.surfaces.includes(snapshot.surface)) continue
  await criterion.prepare?.()
  const failedByRule = stage.decided.get(criterion.id)
  const candidates = criterion.candidates(snapshot, engine).filter((c) => !failedByRule?.has(c.ref))
  const judged = capCandidates(criterion, snapshot, candidates, DEFAULT_MAX_CANDIDATES)
  const inCap = new Set(judged)
  const judgments = await judgeCandidates(criterion, snapshot, judged, { provider, runs: 1, cache, offline: true, concurrency: 4 })
  const byCandidate = new Map(judgments.map((j) => [j.candidate, j]))
  for (const candidate of candidates) {
    const j = byCandidate.get(candidate)
    const output = j?.representative as Record<string, unknown> | undefined
    rows.push({
      criterion: criterion.id,
      ref: candidate.ref,
      subject: criterion.subject?.(candidate),
      genericFirst: criterion.confidenceCap?.(candidate) === undefined,
      capped: !inCap.has(candidate),
      // offline-miss here means the run never got a model answer for it: the time limit, or an error.
      status: j ? j.status : 'capped',
      decided: j ? j.samples.some((s) => s.decided) : false,
      verdict: j?.verdict,
      verification: j?.verification && !j.verification.ok ? j.verification.reason : undefined,
      inCandidates: true,
      output,
    })
  }
}
await writeFile(outPath, `${JSON.stringify(rows, null, 1)}\n`, 'utf8')
console.log(`${rows.length} candidates written to ${outPath}`)
