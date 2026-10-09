import { readFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { z } from 'zod'
import { RampaError, errorMessage } from '../core/util.ts'
import { estimateCostUsd } from '../providers/models.ts'
import { VERSION } from '../version.ts'
import { compareCriteria } from '../wcag.ts'
import { type Scores, confusion, scores, wilson } from './metrics.ts'

/**
 * Compares runs written by `rampa eval`. Everything is computed again from
 * results.jsonl, the same way the eval scores a run, so every run is measured
 * with one definition and two runs can be paired case by case. summary.json
 * only supplies what the records do not carry: model, settings and cost.
 */

const PageVerdictSchema = z.enum(['failed', 'passed'])

/** The fields of an eval record that a comparison reads. */
export const RunRecordSchema = z.object({
  schemaVersion: z.literal(1),
  set: z.enum(['act', 'pair-intact', 'pair-corrupted']),
  criterion: z.string(),
  ruleId: z.string(),
  ruleKind: z.enum(['syntax', 'semantic']),
  testcaseId: z.string(),
  title: z.string(),
  url: z.string(),
  expected: z.enum(['passed', 'failed', 'inapplicable']),
  baseline: PageVerdictSchema,
  rampa: PageVerdictSchema,
  corruptor: z.string().optional(),
  candidates: z.number(),
  discarded: z.number(),
  cannotTell: z.number(),
  usage: z.object({ calls: z.number(), cachedCalls: z.number(), inputTokens: z.number(), outputTokens: z.number(), latencyMs: z.number() }),
  error: z.string().optional(),
  modelError: z.string().optional(),
})
export type RunRecord = z.infer<typeof RunRecordSchema>

/** summary.json is optional and read leniently: a run is still comparable without it. */
const RunSummarySchema = z.object({
  rampaVersion: z.string().optional(),
  createdAt: z.string().optional(),
  model: z.string().optional(),
  runs: z.number().optional(),
  llm: z.boolean().optional(),
  verify: z.boolean().optional(),
  actSha256: z.string().optional(),
  usage: z.object({ costUsd: z.number().optional() }).optional(),
})
export type RunSummary = z.infer<typeof RunSummarySchema>

export interface LoadedRun {
  dir: string
  name: string
  summary: RunSummary
  /** False when the directory had no summary.json. */
  hasSummary: boolean
  records: RunRecord[]
}

export async function loadRun(dir: string): Promise<LoadedRun> {
  const resultsPath = join(dir, 'results.jsonl')
  let text: string
  try {
    text = await readFile(resultsPath, 'utf8')
  } catch {
    throw new RampaError('run-not-found', `${dir} is not a rampa eval run: it has no results.jsonl.`)
  }
  const records: RunRecord[] = []
  for (const [index, line] of text.replace(/^\uFEFF/, '').split('\n').entries()) {
    if (line.trim() === '') continue
    let data: unknown
    try {
      data = JSON.parse(line)
    } catch (error) {
      throw new RampaError('invalid-run', `${resultsPath}:${index + 1} is not JSON: ${errorMessage(error)}`)
    }
    const parsed = RunRecordSchema.safeParse(data)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      throw new RampaError('invalid-run', `${resultsPath}:${index + 1} is not an eval record: ${issue?.path.join('.') || 'record'}: ${issue?.message}`)
    }
    records.push(parsed.data)
  }
  if (records.length === 0) throw new RampaError('invalid-run', `${resultsPath} has no records.`)

  let summary: RunSummary = {}
  let hasSummary = false
  const summaryText = await readFile(join(dir, 'summary.json'), 'utf8').catch(() => undefined)
  if (summaryText !== undefined) {
    let data: unknown
    try {
      data = JSON.parse(summaryText.replace(/^\uFEFF/, ''))
    } catch (error) {
      throw new RampaError('invalid-run', `${join(dir, 'summary.json')} is not JSON: ${errorMessage(error)}`)
    }
    const parsed = RunSummarySchema.safeParse(data)
    if (parsed.success) {
      summary = parsed.data
      hasSummary = true
    }
  }
  return { dir, name: basename(resolve(dir)), summary, hasSummary, records }
}

export type PageVerdict = z.infer<typeof PageVerdictSchema>

export interface RunUsage {
  /** Pages that were judged; pages that failed to load are left out, as in the eval. */
  cases: number
  candidates: number
  discarded: number
  cannotTell: number
  calls: number
  cachedCalls: number
  inputTokens: number
  outputTokens: number
  /** Time the model took on new calls; cached answers take none. */
  latencyMs: number
  /** Mean over new calls, undefined when every answer came from the cache. */
  msPerCall: number | undefined
}

export interface ComparedRun extends RunUsage {
  /** A, B, C… in the order the runs were given. */
  id: string
  dir: string
  name: string
  /** The model, or a description of the run when two runs share a model. */
  label: string
  model: string | undefined
  llm: boolean
  verify: boolean
  /** Judgments per candidate (`--runs`). */
  runs: number | undefined
  createdAt: string | undefined
  actSha256: string | undefined
  rampaVersion: string | undefined
  /** Pages that could not be loaded or collected. */
  pageErrors: number
  /** Pages where the model failed on some candidate; they still count, with those candidates unjudged. */
  modelErrors: number
  costUsd: number | undefined
}

export interface ComparedSet {
  /** The label `rampa eval` prints, e.g. `ACT qt1vmo (semantic)` or `pairs (intact + corrupted)`. */
  label: string
  kind: 'syntax' | 'semantic' | 'pairs'
  /** One entry per run, in run order; undefined when the run has no case in the set. */
  scores: Array<Scores | undefined>
}

export interface PairDiscrimination {
  total: number
  /** Corrupted copies whose intact page passed while the copy failed. */
  toldApart: number
  /** 95% Wilson interval of toldApart / total. */
  ci: [number, number] | undefined
}

export interface ComparedCorruptor {
  corruptor: string
  results: Array<PairDiscrimination | undefined>
}

export interface ComparedCriterion {
  criterion: string
  sets: ComparedSet[]
  pairs: ComparedCorruptor[]
  /** One entry per run; undefined when the run did not evaluate the criterion. */
  usage: Array<RunUsage | undefined>
}

export interface PairedCounts {
  shared: number
  bothRight: number
  onlyFirstRight: number
  onlySecondRight: number
  bothWrong: number
  /** Exact McNemar test on the discordant cases, two-sided. */
  pValue: number
}

export interface DifferingCase {
  criterion: string
  set: 'act' | 'pair-intact' | 'pair-corrupted'
  ruleId: string
  ruleKind: 'syntax' | 'semantic'
  testcaseId: string
  title: string
  url: string
  corruptor: string | undefined
  expected: RunRecord['expected']
  verdicts: [PageVerdict, PageVerdict]
}

export interface PairedComparison {
  criteria: Array<PairedCounts & { criterion: string }>
  all: PairedCounts
  differing: DifferingCase[]
  /** Cases only one of the two runs evaluated; they are left out of the pairing. */
  onlyInFirst: number
  onlyInSecond: number
}

export interface Comparison {
  schemaVersion: 1
  rampaVersion: string
  createdAt: string
  runs: ComparedRun[]
  criteria: ComparedCriterion[]
  /** Only for exactly two runs. */
  paired?: PairedComparison | undefined
  warnings: string[]
}

/**
 * Exact McNemar test: under the null hypothesis that both runs are equally
 * accurate, a case one gets right and the other wrong is a coin flip, so the
 * smaller discordant count follows Binomial(b + c, 1/2). Two-sided.
 */
export function mcnemarExact(onlyFirst: number, onlySecond: number): number {
  const n = onlyFirst + onlySecond
  if (n === 0) return 1
  const k = Math.min(onlyFirst, onlySecond)
  let tail = 0
  if (n <= 1000) {
    // 2^-n is still a normal double here, so small counts give exact p values such as 0.03125.
    let term = 2 ** -n
    for (let i = 0; i <= k; i++) {
      tail += term
      term *= (n - i) / (i + 1)
    }
  } else {
    // Beyond that, 2^-n underflows; the terms are summed from log space.
    let logTerm = -n * Math.LN2
    for (let i = 0; i <= k; i++) {
      tail += Math.exp(logTerm)
      logTerm += Math.log(n - i) - Math.log(i + 1)
    }
  }
  return Math.min(1, 2 * tail)
}

/** A case is the same test page under the same criterion, intact or corrupted the same way. */
export function caseKey(record: RunRecord): string {
  return [record.criterion, record.set, record.ruleId, record.testcaseId, record.corruptor ?? ''].join('\u0000')
}

/** Right when the page verdict matches the expected outcome; ACT's inapplicable counts as not failed, as in the eval. */
export function isRight(record: RunRecord): boolean {
  return (record.rampa === 'failed') === (record.expected === 'failed')
}

function runId(index: number): string {
  return index < 26 ? String.fromCharCode(65 + index) : `R${index + 1}`
}

function scoreOf(records: readonly RunRecord[]): Scores {
  return scores(confusion(records.map((r) => ({ expected: r.expected === 'failed', predicted: r.rampa === 'failed' }))))
}

function usageOf(records: readonly RunRecord[]): RunUsage {
  const valid = records.filter((r) => !r.error)
  const sum = (pick: (r: RunRecord) => number) => records.reduce((total, r) => total + pick(r), 0)
  const calls = sum((r) => r.usage.calls)
  const latencyMs = sum((r) => r.usage.latencyMs)
  return {
    cases: valid.length,
    candidates: sum((r) => r.candidates),
    discarded: sum((r) => r.discarded),
    cannotTell: sum((r) => r.cannotTell),
    calls,
    cachedCalls: sum((r) => r.usage.cachedCalls),
    inputTokens: sum((r) => r.usage.inputTokens),
    outputTokens: sum((r) => r.usage.outputTokens),
    latencyMs,
    msPerCall: calls > 0 ? latencyMs / calls : undefined,
  }
}

/** `2026-10-08T03:06:22.481Z` becomes `2026-10-08 03:06 UTC`, the clock the run directories are named with. */
export function runTime(createdAt: string | undefined): string | undefined {
  return createdAt && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(createdAt) ? `${createdAt.slice(0, 10)} ${createdAt.slice(11, 16)} UTC` : undefined
}

/** Labels tell runs apart: the model, then whatever else differs when two runs share it. */
function labelRuns(runs: readonly LoadedRun[]): string[] {
  const base = runs.map((run) => (run.summary.llm === false ? 'baseline (axe-core)' : (run.summary.model ?? run.name)))
  return base.map((label, index) => {
    const twins = base.flatMap((other, j) => (other === label ? [runs[j]?.summary ?? {}] : []))
    if (twins.length === 1) return label
    const own = runs[index]?.summary ?? {}
    const differs = (pick: (summary: RunSummary) => unknown) => new Set(twins.map(pick)).size > 1
    const extra: string[] = []
    if (differs((s) => s.verify)) extra.push(own.verify === false ? 'verification off' : 'verification on')
    if (differs((s) => s.runs) && own.runs !== undefined) extra.push(own.runs === 1 ? '1 run' : `${own.runs} runs`)
    if (extra.length === 0) {
      // The time to the minute, unless another twin started in the same minute; then the directory name.
      const time = runTime(own.createdAt)
      const unique = time !== undefined && twins.filter((summary) => runTime(summary.createdAt) === time).length === 1
      extra.push(unique ? time : (runs[index]?.name ?? runId(index)))
    }
    return `${label} (${extra.join(', ')})`
  })
}

function pairDiscrimination(records: readonly RunRecord[], corruptor: string): PairDiscrimination | undefined {
  const corrupted = records.filter((r) => r.set === 'pair-corrupted' && r.corruptor === corruptor)
  if (corrupted.length === 0) return undefined
  let toldApart = 0
  for (const bad of corrupted) {
    // The intact half is an ACT page, or a passing page a rule lends only to the pairs; ACT reuses test case ids across rules.
    const good = records.find((r) => r.set !== 'pair-corrupted' && r.ruleId === bad.ruleId && r.testcaseId === bad.testcaseId)
    if (good?.rampa === 'passed' && bad.rampa === 'failed') toldApart++
  }
  return { total: corrupted.length, toldApart, ci: wilson(toldApart, corrupted.length) }
}

function compareCriterion(criterion: string, valid: ReadonlyArray<readonly RunRecord[]>, all: ReadonlyArray<readonly RunRecord[]>): ComparedCriterion {
  const ofCriterion = valid.map((records) => records.filter((r) => r.criterion === criterion))
  // Syntax rules first, then meaning, then the pairs: the order a reader goes from what rules decide to what needs judgment.
  const rules: Array<{ ruleId: string; kind: 'syntax' | 'semantic' }> = []
  for (const records of ofCriterion) {
    for (const r of records) {
      if (r.set === 'act' && !rules.some((rule) => rule.ruleId === r.ruleId)) rules.push({ ruleId: r.ruleId, kind: r.ruleKind })
    }
  }
  rules.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'syntax' ? -1 : 1))

  const sets: ComparedSet[] = rules.map(({ ruleId, kind }) => ({
    label: `ACT ${ruleId} (${kind})`,
    kind,
    scores: ofCriterion.map((records) => {
      const subset = records.filter((r) => r.set === 'act' && r.ruleId === ruleId)
      return subset.length > 0 ? scoreOf(subset) : undefined
    }),
  }))
  if (ofCriterion.some((records) => records.some((r) => r.set === 'pair-corrupted'))) {
    sets.push({
      label: 'pairs (intact + corrupted)',
      kind: 'pairs',
      scores: ofCriterion.map((records) => {
        const corrupted = records.filter((r) => r.set === 'pair-corrupted')
        if (corrupted.length === 0) return undefined
        const intact = records.filter((r) => r.set !== 'pair-corrupted' && corrupted.some((c) => c.ruleId === r.ruleId && c.testcaseId === r.testcaseId))
        return scoreOf([...intact, ...corrupted])
      }),
    })
  }

  const corruptors = [...new Set(ofCriterion.flatMap((records) => records.flatMap((r) => (r.set === 'pair-corrupted' && r.corruptor ? [r.corruptor] : []))))]
  return {
    criterion,
    sets,
    pairs: corruptors.map((corruptor) => ({ corruptor, results: ofCriterion.map((records) => pairDiscrimination(records, corruptor)) })),
    usage: all.map((records) => {
      const subset = records.filter((r) => r.criterion === criterion)
      return subset.length > 0 ? usageOf(subset) : undefined
    }),
  }
}

function pairedCounts(cases: ReadonlyArray<[RunRecord, RunRecord]>): PairedCounts {
  const counts = { shared: cases.length, bothRight: 0, onlyFirstRight: 0, onlySecondRight: 0, bothWrong: 0 }
  for (const [first, second] of cases) {
    const a = isRight(first)
    const b = isRight(second)
    if (a && b) counts.bothRight++
    else if (a) counts.onlyFirstRight++
    else if (b) counts.onlySecondRight++
    else counts.bothWrong++
  }
  return { ...counts, pValue: mcnemarExact(counts.onlyFirstRight, counts.onlySecondRight) }
}

function pairRuns(first: readonly RunRecord[], second: readonly RunRecord[]): PairedComparison {
  const index = (records: readonly RunRecord[]) => {
    const map = new Map<string, RunRecord>()
    // A case evaluated twice in one run keeps its first verdict.
    for (const record of records) if (!map.has(caseKey(record))) map.set(caseKey(record), record)
    return map
  }
  const a = index(first)
  const b = index(second)
  const shared: Array<[RunRecord, RunRecord]> = []
  for (const [key, record] of a) {
    const other = b.get(key)
    if (other) shared.push([record, other])
  }
  const criteria = [...new Set(shared.map(([record]) => record.criterion))].sort(compareCriteria)
  return {
    criteria: criteria.map((criterion) => ({ criterion, ...pairedCounts(shared.filter(([record]) => record.criterion === criterion)) })),
    all: pairedCounts(shared),
    differing: shared
      .filter(([x, y]) => x.rampa !== y.rampa)
      .sort(([x], [y]) => compareCriteria(x.criterion, y.criterion))
      .map(([x, y]) => ({
        criterion: x.criterion,
        set: x.set,
        ruleId: x.ruleId,
        ruleKind: x.ruleKind,
        testcaseId: x.testcaseId,
        title: x.title,
        url: x.url,
        corruptor: x.corruptor,
        expected: x.expected,
        verdicts: [x.rampa, y.rampa],
      })),
    onlyInFirst: a.size - shared.length,
    onlyInSecond: [...b.keys()].filter((key) => !a.has(key)).length,
  }
}

function warningsFor(runs: readonly ComparedRun[], valid: ReadonlyArray<readonly RunRecord[]>, loaded: readonly LoadedRun[], criteria: readonly string[]): string[] {
  const warnings: string[] = []
  const shas = new Set(runs.map((run) => run.actSha256).filter((sha) => sha !== undefined))
  if (shas.size > 1) {
    const list = runs.map((run) => `${run.id} ${run.actSha256?.slice(0, 8) ?? '?'}`).join(', ')
    warnings.push(`The runs used different ACT test case files (${list}), so a set may hold different pages.`)
  }
  const differ: string[] = []
  for (const criterion of criteria) {
    const keys = valid
      .map((records) => records.filter((r) => r.criterion === criterion).map(caseKey).sort().join('\n'))
      .filter((joined) => joined !== '')
    if (new Set(keys).size > 1) differ.push(criterion)
  }
  if (differ.length > 0) {
    warnings.push(`The runs did not evaluate the same cases for ${differ.join(', ')}: compare n before the scores${runs.length === 2 ? '; the paired comparison uses shared cases only' : ''}.`)
  }
  for (const run of runs) {
    if (run.modelErrors > 0) warnings.push(`${run.id}: the model failed on ${run.modelErrors} page(s); those candidates count as unjudged, which lowers recall.`)
    if (run.pageErrors > 0) warnings.push(`${run.id}: ${run.pageErrors} page(s) could not be loaded and are left out.`)
  }
  for (const [index, run] of loaded.entries()) {
    if (!run.hasSummary) warnings.push(`${runs[index]?.id}: ${run.name} has no readable summary.json, so its model and settings are unknown.`)
  }
  return warnings
}

export function compareRuns(loaded: readonly LoadedRun[]): Comparison {
  if (loaded.length === 0) throw new RampaError('no-runs', 'Nothing to compare: give one or more run directories.')
  const labels = labelRuns(loaded)
  const valid = loaded.map((run) => run.records.filter((r) => !r.error))
  const runs: ComparedRun[] = loaded.map((run, index) => {
    const usage = usageOf(run.records)
    const model = run.summary.llm === false ? undefined : run.summary.model
    return {
      id: runId(index),
      dir: run.dir,
      name: run.name,
      label: labels[index] ?? run.name,
      model,
      llm: run.summary.llm ?? model !== undefined,
      verify: run.summary.verify ?? true,
      runs: run.summary.runs,
      createdAt: run.summary.createdAt,
      actSha256: run.summary.actSha256,
      rampaVersion: run.summary.rampaVersion,
      ...usage,
      pageErrors: run.records.filter((r) => r.error).length,
      modelErrors: run.records.filter((r) => !r.error && r.modelError).length,
      // The cost the eval recorded, priced when it ran; otherwise today's price for the tokens.
      costUsd: run.summary.usage?.costUsd ?? estimateCostUsd(model, usage.inputTokens, usage.outputTokens),
    }
  })
  const criteria = [...new Set(loaded.flatMap((run) => run.records.map((r) => r.criterion)))].sort(compareCriteria)
  const all = loaded.map((run) => run.records)
  const first = valid[0]
  const second = valid[1]
  return {
    schemaVersion: 1,
    rampaVersion: VERSION,
    createdAt: new Date().toISOString(),
    runs,
    criteria: criteria.map((criterion) => compareCriterion(criterion, valid, all)),
    paired: loaded.length === 2 && first && second ? pairRuns(first, second) : undefined,
    warnings: warningsFor(runs, valid, loaded, criteria),
  }
}
