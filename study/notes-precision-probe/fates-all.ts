// Every judged candidate of one recorded page under the current code, with the model's recorded answer and the
// facts verification reads: what the study's run asked is read back from its judgment cache (no model is called),
// through today's candidates, verification and grounding. For the counterfactual simulations in
// docs/studies/notes-precision-probe.md: each row carries the candidate's context (facts), the answer, the
// verification result and the fate (finding, suggestion, discarded, passed...).
//
// --versions 1.1.1=4,2.4.4=2,2.4.6=3 keys the criteria with the versions the recorded run used, so a cache written
// by an older build with the same prompt is read. A criterion whose prompt changed since (1.1.1 version 5) gives
// offline-miss rows, which say that its recorded answer cannot be read by the new prompt.
//
// Run from the repository root:
//   node study/notes-precision-probe/fates-all.ts <recording>.snapshot.json <cache dir> <out.json> [--versions a=b,...] [--criteria 1.1.1,2.4.4]
import { writeFile } from 'node:fs/promises'
import { fileCache } from '../../src/core/cache.ts'
import { capCandidates, DEFAULT_MAX_CANDIDATES } from '../../src/core/check.ts'
import { judgeCandidates } from '../../src/core/judge.ts'
import { resolveCriteria } from '../../src/criteria/index.ts'
import { resolveProvider } from '../../src/cli/commands/check.ts'
import { loadRecorded } from '../../src/surfaces/targets.ts'
import { runRuleChecks } from '../../src/rules/index.ts'
import { browserNamed } from '../../src/snapshot/ax.ts'

const args = process.argv.slice(2)
const flag = (name: string): string | undefined => {
  const at = args.indexOf(name)
  return at >= 0 ? args[at + 1] : undefined
}
const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1]?.startsWith('--')))
const [snapshotPath, cacheDir, outPath] = positional
if (!snapshotPath || !cacheDir || !outPath) throw new Error('usage: fates-all.ts <snapshot.json> <cache dir> <out.json> [--versions 1.1.1=4,...] [--criteria ...]')
const versions = new Map((flag('--versions') ?? '').split(',').filter(Boolean).map((pair) => pair.split('=') as [string, string]))
const ids = (flag('--criteria') ?? '1.1.1,1.3.5,2.4.2,2.4.4,2.4.6,3.1.1,3.1.2,3.3.2').split(',')
// --v4-111: 1.1.1's prompt and schema as they were at d23cfb5 (version 4), so the recorded answers of the studies are
// read back (the prompt's text is part of the cache key); candidates, verification, messages and facts stay today's.
const v4 = args.includes('--v4-111') ? (await import('./non-text-content-v4.ts')).nonTextContent : undefined

const loaded = await loadRecorded(snapshotPath, 'en', true)
const { snapshot, engine } = loaded
const provider = await resolveProvider('ollama:gemma4:12b', true)
const cache = fileCache(cacheDir)
const stage = runRuleChecks(snapshot, engine, 'en')
const rows: unknown[] = []

/** The context without the image bytes, which are long and say nothing to the simulations. */
function facts(context: unknown): unknown {
  if (!context || typeof context !== 'object') return context
  const copy: Record<string, unknown> = { ...(context as Record<string, unknown>) }
  if (typeof copy.image === 'string') copy.image = `data:… (${copy.image.length} chars)`
  if (copy.hidden && typeof copy.hidden === 'object') {
    const hidden = { ...(copy.hidden as Record<string, unknown>) }
    if (typeof hidden.image === 'string') hidden.image = `data:… (${hidden.image.length} chars)`
    copy.hidden = hidden
  }
  return copy
}

for (const resolved of resolveCriteria(ids)) {
  let criterion = versions.has(resolved.id) ? { ...resolved, version: versions.get(resolved.id) ?? resolved.version } : resolved
  if (v4 && resolved.id === '1.1.1') criterion = { ...criterion, version: '4', prompt: v4.prompt as typeof criterion.prompt, schema: v4.schema as typeof criterion.schema, schemaFor: v4.schemaFor as typeof criterion.schemaFor }
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
    const output = j?.representative as (Record<string, unknown> & { confidence?: string; verdict?: string; problem?: string }) | undefined
    const failed = j?.status === 'failed' && output !== undefined
    const grounded = failed && criterion.grounded ? criterion.grounded(output as never, candidate as never, view) : undefined
    const claim = output && (j?.status === 'failed' || j?.status === 'discarded') && output.verdict === 'fail'
    rows.push({
      criterion: criterion.id,
      version: criterion.version,
      ref: candidate.ref,
      subject: criterion.subject?.(candidate),
      inCap: inCap.has(candidate),
      status: j ? j.status : 'capped',
      verdict: j?.verdict,
      problem: output?.problem,
      confidence: output?.confidence,
      verification: j?.verification && !j.verification.ok ? j.verification.reason : undefined,
      grounded,
      fate: failed ? (grounded === false ? 'suggestion' : 'finding') : j ? j.status : 'capped',
      message: claim ? criterion.message(output as never, candidate as never, 'en') : undefined,
      patchTo: claim ? criterion.patch?.(output as never, candidate as never, view)?.to : undefined,
      output,
      facts: facts(candidate.context),
    })
  }
}
await writeFile(outPath, `${JSON.stringify(rows, null, 1)}\n`, 'utf8')
const counts = new Map<string, number>()
for (const row of rows as Array<{ criterion: string; fate: string }>) counts.set(`${row.criterion} ${row.fate}`, (counts.get(`${row.criterion} ${row.fate}`) ?? 0) + 1)
console.log(`${rows.length} candidates written to ${outPath}: ${[...counts.entries()].map(([k, v]) => `${k}=${v}`).join(', ')}`)
