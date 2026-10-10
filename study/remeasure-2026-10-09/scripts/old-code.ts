// The first run's code (commit 46029c1) on this run's snapshot, for the elements the first run reported: does
// the old code still fail them on today's page? It separates what the code changes did from what changed on
// the page or in the model's answers. The old source is not in this tree; extract it first, from the repository root:
//   mkdir .old-46029c1 && git archive 46029c1 src package.json | tar -x -C .old-46029c1
// Then:
//   node study/remeasure-2026-10-09/scripts/old-code.ts <snapshot.json> <items.json> <out.json>
// where items.json is [{ "fingerprint", "criterion", "ref" }, ...].
// Each element is judged once (temperature 0, no cache), with the old prompt and the old verification.
import { readFile, writeFile } from 'node:fs/promises'
import { memoryCache } from '../../../.old-46029c1/src/core/cache.ts'
import { judgeCandidates } from '../../../.old-46029c1/src/core/judge.ts'
import { resolveCriteria } from '../../../.old-46029c1/src/criteria/index.ts'
import { resolveProvider } from '../../../.old-46029c1/src/cli/commands/check.ts'
import { loadRecorded } from '../../../.old-46029c1/src/surfaces/targets.ts'

const [snapshotPath, itemsPath, outPath] = process.argv.slice(2)
if (!snapshotPath || !itemsPath || !outPath) throw new Error('usage: old-code.ts <snapshot.json> <items.json> <out.json>')
const wanted = JSON.parse(await readFile(itemsPath, 'utf8')) as Array<{ fingerprint: string; criterion: string; ref: string }>
const { snapshot, engine } = await loadRecorded(snapshotPath, 'en', true)
const provider = await resolveProvider('ollama:gemma4:12b', false)
const rows: unknown[] = []
for (const { fingerprint, criterion: id, ref } of wanted) {
  const [criterion] = resolveCriteria([id])
  if (!criterion) continue
  await criterion.prepare?.()
  const candidate = criterion.candidates(snapshot, engine).find((c) => c.ref === ref)
  if (!candidate) {
    rows.push({ fingerprint, criterion: id, ref, candidate: false })
    console.log(`${id} ${ref}: not a candidate for the old code`)
    continue
  }
  const [judgment] = await judgeCandidates(criterion, snapshot, [candidate], { provider, runs: 1, cache: memoryCache(), offline: false, concurrency: 1 })
  rows.push({
    fingerprint,
    criterion: id,
    ref,
    candidate: true,
    status: judgment?.status,
    verdict: judgment?.verdict,
    verification: judgment?.verification && !judgment.verification.ok ? judgment.verification.reason : undefined,
    output: judgment?.representative ?? judgment?.samples[0]?.output,
    error: judgment?.samples.find((s) => s.error)?.error,
  })
  console.log(`${id} ${ref}: ${judgment?.status}`)
}
await writeFile(outPath, `${JSON.stringify(rows, null, 1)}\n`, 'utf8')
