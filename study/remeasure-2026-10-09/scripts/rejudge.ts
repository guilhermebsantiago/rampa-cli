// Asks the model again, k times with no cache, about candidates of a recorded page, to tell model variance
// from a systematic change: a first-run true positive the re-measure passed is variance when some of the k
// fresh answers fail it, and the current prompt's doing when none do.
//
// Run from the repository root:
//   node study/remeasure-2026-10-09/scripts/rejudge.ts <snapshot.json> <k> <out.json> <criterion>=<ref> [...]
import { writeFile } from 'node:fs/promises'
import { memoryCache } from '../../../src/core/cache.ts'
import { judgeCandidates } from '../../../src/core/judge.ts'
import { resolveCriteria } from '../../../src/criteria/index.ts'
import { resolveProvider } from '../../../src/cli/commands/check.ts'
import { loadRecorded } from '../../../src/surfaces/targets.ts'

const [snapshotPath, kText, outPath, ...wanted] = process.argv.slice(2)
if (!snapshotPath || !kText || !outPath || wanted.length === 0) throw new Error('usage: rejudge.ts <snapshot.json> <k> <out.json> <criterion>=<ref> ...')
const k = Number.parseInt(kText, 10)
const { snapshot, engine } = await loadRecorded(snapshotPath, 'en', true)
const provider = await resolveProvider('ollama:gemma4:12b', false)
const rows: unknown[] = []
for (const item of wanted) {
  const at = item.indexOf('=')
  const id = item.slice(0, at)
  const ref = item.slice(at + 1)
  const [criterion] = resolveCriteria([id])
  if (!criterion) continue
  await criterion.prepare?.()
  const candidate = criterion.candidates(snapshot, engine).find((c) => c.ref === ref)
  if (!candidate) {
    rows.push({ criterion: id, ref, candidate: false })
    continue
  }
  const [judgment] = await judgeCandidates(criterion, snapshot, [candidate], { provider, runs: k, cache: memoryCache(), offline: false, concurrency: 1 })
  rows.push({
    criterion: id,
    ref,
    candidate: true,
    status: judgment?.status,
    verdict: judgment?.verdict,
    votes: judgment?.votes,
    total: judgment?.total,
    verification: judgment?.verification && !judgment.verification.ok ? judgment.verification.reason : undefined,
    // Each answer on its own: its verdict after the criterion settles it, and whether a fail would survive verification.
    samples: judgment?.samples.map((s) => {
      if (!s.output) return { error: s.error }
      const settled = criterion.settle?.(s.output as never, candidate as never) ?? s.output
      const verdict = (settled as { verdict?: string }).verdict
      const check = verdict === 'fail' ? criterion.verify(settled as never, candidate as never, snapshot) : undefined
      return { verdict, kept: check ? check.ok : undefined, reason: check && !check.ok ? check.reason : undefined, output: s.output }
    }),
  })
  const last = rows.at(-1) as { samples?: Array<{ verdict?: string; kept?: boolean; error?: string }> }
  console.log(`${id} ${ref}: ${(last.samples ?? []).map((s) => (s.verdict ? `${s.verdict}${s.kept === false ? ' (dropped)' : ''}` : s.error)).join(', ')}`)
}
await writeFile(outPath, `${JSON.stringify(rows, null, 1)}\n`, 'utf8')
