import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileCache } from '../../core/cache.ts'
import { checkSnapshot } from '../../core/check.ts'
import type { AnyCriterion } from '../../core/types.ts'
import { errorMessage, mapLimit } from '../../core/util.ts'
import { resolveCriteria } from '../../criteria/index.ts'
import { ACT_RULES, type ActOutcome, type ActTestcase, loadActTestcases, selectTestcases } from '../../eval/act.ts'
import { type Scores, confusion, scores } from '../../eval/metrics.ts'
import { CORRUPTORS, type Corruptor } from '../../eval/pairs.ts'
import { chooseModel } from '../../providers/detect.ts'
import { estimateCostUsd, subscriptionOf } from '../../providers/models.ts'
import { colorsEnabled, paint } from '../../report/color.ts'
import { type FollowLinks, type FollowOptions, destinationCache } from '../../surfaces/destinations.ts'
import { collectWeb, launchBrowser } from '../../surfaces/web.ts'
import { VERSION } from '../../version.ts'
import type { GlobalContext } from '../context.ts'
import { followOptions, resolveProvider } from './check.ts'

export interface EvalCommandOptions {
  criteria: string
  model?: string
  llm: boolean
  pairs: boolean
  verify: boolean
  runs: string
  limit?: string
  offline?: boolean
  refresh?: boolean
  cacheDir: string
  outDir: string
  concurrency: string
  reasoning?: import('../../providers/ai-sdk.ts').Reasoning
  /**
   * same-origin by default: the outcomes of ACT fd3a94 depend on where its links lead (an instant redirect, a copy
   * of a page), and those pages sit on the same W3C host as the test pages the eval already loads. Third-party
   * sites the test pages link to are never contacted.
   */
  followLinks?: FollowLinks
}

type PageVerdict = 'failed' | 'passed'

export interface EvalRecord {
  schemaVersion: 1
  /** pair-intact: a passing page of a rule used only for pairs; it scores the pairs, not an ACT set. */
  set: 'act' | 'pair-intact' | 'pair-corrupted'
  criterion: string
  ruleId: string
  ruleKind: 'syntax' | 'semantic'
  testcaseId: string
  title: string
  url: string
  expected: ActOutcome
  baseline: PageVerdict
  rampa: PageVerdict
  corruptor?: string | undefined
  changedElements?: number | undefined
  candidates: number
  discarded: number
  cannotTell: number
  findings: Array<{ source: string; ref?: string | undefined; evidence?: string | undefined; ruleId?: string | undefined; message: string }>
  usage: { calls: number; cachedCalls: number; inputTokens: number; outputTokens: number; latencyMs: number }
  /** The page could not be loaded or collected; the record is left out of the metrics. */
  error?: string | undefined
  /** The model failed on some candidate; the page still counts, with those candidates unjudged. */
  modelError?: string | undefined
}

interface Job {
  criterion: AnyCriterion
  testcase: ActTestcase
  ruleKind: 'syntax' | 'semantic'
  corruptor?: Corruptor | undefined
  /** The page only serves as the intact half of pairs. */
  intact?: boolean | undefined
}

export async function runEval(options: EvalCommandOptions, context: GlobalContext): Promise<number> {
  const p = paint(colorsEnabled())
  const criteria = resolveCriteria(options.criteria.split(','))
  const runs = Math.max(1, Number.parseInt(options.runs, 10) || 1)
  const limit = options.limit ? Number.parseInt(options.limit, 10) : undefined
  const spec = options.llm ? await chooseModel(options.model, context.config.model) : undefined
  const provider = await resolveProvider(spec, Boolean(options.offline), options.reasoning ?? context.config.reasoning)
  const llm = options.llm && provider !== undefined
  if (options.llm && !provider) {
    process.stderr.write(p.yellow('No model configured: measuring the deterministic baseline only. Pass --model to add the judgment layer.\n'))
  }

  const dataset = await loadActTestcases('.rampa/act', Boolean(options.refresh))
  const cache = fileCache(options.cacheDir)
  const jobs: Job[] = []
  for (const criterion of criteria) {
    const rules = ACT_RULES[criterion.id]
    if (!rules) continue
    let cases = selectTestcases(dataset, criterion.id)
    if (limit !== undefined) cases = cases.slice(0, limit)
    for (const testcase of cases) {
      const ruleKind = rules.semantic.includes(testcase.ruleId) ? 'semantic' : 'syntax'
      // A rule listed only for pairs is about another criterion: its passing pages lend the intact half, nothing else.
      const intact = !rules.syntax.includes(testcase.ruleId) && !rules.semantic.includes(testcase.ruleId)
      if (intact && testcase.expected !== 'passed') continue
      jobs.push({ criterion, testcase, ruleKind, intact })
      if (options.pairs && testcase.expected === 'passed') {
        for (const corruptor of CORRUPTORS[criterion.id] ?? []) {
          const applies = corruptor.rules ? corruptor.rules.includes(testcase.ruleId) : (rules.pairs ?? rules.semantic).includes(testcase.ruleId)
          if (applies) jobs.push({ criterion, testcase, ruleKind, corruptor })
        }
      }
    }
  }

  const destinations = destinationCache({ dir: '.rampa/destinations' })
  const browser = await launchBrowser()
  let done = 0
  const tick = () => {
    done++
    if (process.stderr.isTTY) process.stderr.write(`\x1b[2K  ${done}/${jobs.length} test pages\r`)
  }
  let records: Array<EvalRecord | undefined>
  try {
    records = await mapLimit(jobs, Math.max(1, Number.parseInt(options.concurrency, 10) || 4), async (job) => {
      const follow = followOptions(options.followLinks, llm, [job.criterion], destinations)
      const record = await runJob(job, { browser, provider, llm, runs, cache, offline: Boolean(options.offline), verify: options.verify, follow })
      tick()
      return record
    })
  } finally {
    if (process.stderr.isTTY) process.stderr.write('\x1b[2K')
    await browser.close()
  }

  const valid = records.filter((r): r is EvalRecord => r !== undefined)
  const followed = llm && criteria.some((criterion) => criterion.needs.fetch) ? (options.followLinks ?? 'none') : undefined
  const summary = summarize(valid, {
    model: provider?.id,
    runs,
    llm,
    verify: options.verify,
    actSha256: dataset.sha256,
    criteria: criteria.map((c) => c.id),
    followLinks: followed,
  })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const dir = join(options.outDir, `${stamp}-${(provider?.id ?? 'baseline').replace(/[^\w.-]+/g, '-')}`)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'results.jsonl'), `${valid.map((r) => JSON.stringify(r)).join('\n')}\n`, 'utf8')
  await writeFile(join(dir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8')

  process.stdout.write(`\n${renderSummary(summary, p)}\n${p.dim(`Results: ${dir}`)}\n\n`)
  return 0
}

async function runJob(
  job: Job,
  ctx: {
    browser: Awaited<ReturnType<typeof launchBrowser>>
    provider: Awaited<ReturnType<typeof resolveProvider>>
    llm: boolean
    runs: number
    cache: ReturnType<typeof fileCache>
    offline: boolean
    verify: boolean
    follow?: FollowOptions | undefined
  },
): Promise<EvalRecord | undefined> {
  const { criterion, testcase, corruptor } = job
  let changed: number | undefined
  const base: Omit<EvalRecord, 'baseline' | 'rampa' | 'candidates' | 'discarded' | 'cannotTell' | 'findings' | 'usage'> = {
    schemaVersion: 1,
    set: corruptor ? 'pair-corrupted' : job.intact ? 'pair-intact' : 'act',
    criterion: criterion.id,
    ruleId: testcase.ruleId,
    ruleKind: job.ruleKind,
    testcaseId: testcase.testcaseId,
    title: testcase.testcaseTitle,
    url: testcase.url,
    expected: corruptor ? 'failed' : testcase.expected,
    corruptor: corruptor?.id,
  }
  try {
    const collected = await collectWeb(ctx.browser, testcase.url, {
      runAxe: true,
      locale: 'en',
      captureImages: ctx.llm && Boolean(criterion.needs.vision),
      followLinks: ctx.follow,
      requireOk: true,
      mutate: corruptor
        ? async (page) => {
            changed = await corruptor.apply(page)
          }
        : undefined,
    })
    if (corruptor && !changed) return undefined
    const report = await checkSnapshot(collected.snapshot, collected.engine, {
      criteria: [criterion],
      llm: ctx.llm,
      provider: ctx.provider,
      runs: ctx.runs,
      cache: ctx.cache,
      offline: ctx.offline,
      locale: 'en',
      minConfidence: 'low',
      concurrency: 2,
      verify: ctx.verify,
    })
    const baselineFails = collected.engine.rules.some((r) => r.outcome === 'violation' && r.criteria.includes(criterion.id))
    const judgmentFails = report.findings.some((f) => f.source === 'judgment' && f.criterion === criterion.id)
    const summary = report.criteria.find((c) => c.criterion === criterion.id)
    return {
      ...base,
      changedElements: changed,
      baseline: baselineFails ? 'failed' : 'passed',
      rampa: baselineFails || judgmentFails ? 'failed' : 'passed',
      candidates: summary?.candidates ?? 0,
      discarded: summary?.discarded ?? 0,
      cannotTell: summary?.cannotTell ?? 0,
      findings: report.findings
        .filter((f) => f.criterion === criterion.id)
        .map((f) => ({ source: f.source, ref: f.ref, evidence: f.evidence, ruleId: f.ruleId, message: f.message })),
      usage: report.usage,
      modelError: report.errors[0],
    }
  } catch (error) {
    return {
      ...base,
      baseline: 'passed',
      rampa: 'passed',
      candidates: 0,
      discarded: 0,
      cannotTell: 0,
      findings: [],
      usage: { calls: 0, cachedCalls: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0 },
      error: errorMessage(error),
    }
  }
}

interface SetScores {
  label: string
  criterion: string
  baseline: Scores
  rampa: Scores
}

export interface EvalSummary {
  schemaVersion: 1
  rampaVersion: string
  createdAt: string
  model: string | undefined
  runs: number
  llm: boolean
  verify: boolean
  actSha256: string
  criteria: string[]
  /** Which links were read before judging, when a criterion compares links with where they lead. */
  followLinks?: FollowLinks | undefined
  sets: SetScores[]
  pairs: Array<{ criterion: string; corruptor: string; total: number; baseline: number; rampa: number }>
  judgment: { candidates: number; discarded: number; cannotTell: number }
  usage: { calls: number; cachedCalls: number; inputTokens: number; outputTokens: number; costUsd: number | undefined }
  errors: Array<{ testcaseId: string; error: string }>
}

export function summarize(
  records: EvalRecord[],
  meta: { model: string | undefined; runs: number; llm: boolean; verify: boolean; actSha256: string; criteria: string[]; followLinks?: FollowLinks | undefined },
): EvalSummary {
  const ok = records.filter((r) => !r.error)
  const sets: SetScores[] = []
  const score = (subset: EvalRecord[], who: 'baseline' | 'rampa') =>
    scores(confusion(subset.map((r) => ({ expected: r.expected === 'failed', predicted: r[who] === 'failed' }))))

  for (const criterion of meta.criteria) {
    const ofCriterion = ok.filter((r) => r.criterion === criterion)
    const rules = [...new Set(ofCriterion.filter((r) => r.set === 'act').map((r) => r.ruleId))]
    for (const rule of rules) {
      const subset = ofCriterion.filter((r) => r.set === 'act' && r.ruleId === rule)
      const kind = subset[0]?.ruleKind ?? 'syntax'
      sets.push({ label: `ACT ${rule} (${kind})`, criterion, baseline: score(subset, 'baseline'), rampa: score(subset, 'rampa') })
    }
    const corrupted = ofCriterion.filter((r) => r.set === 'pair-corrupted')
    if (corrupted.length > 0) {
      const intact = ofCriterion.filter((r) => r.set !== 'pair-corrupted' && corrupted.some((c) => c.testcaseId === r.testcaseId))
      const subset = [...intact, ...corrupted]
      sets.push({ label: 'pairs (intact + corrupted)', criterion, baseline: score(subset, 'baseline'), rampa: score(subset, 'rampa') })
    }
  }

  const pairs: EvalSummary['pairs'] = []
  for (const criterion of meta.criteria) {
    const corrupted = ok.filter((r) => r.criterion === criterion && r.set === 'pair-corrupted')
    for (const corruptor of [...new Set(corrupted.map((r) => r.corruptor ?? ''))]) {
      let baseline = 0
      let rampa = 0
      const ofCorruptor = corrupted.filter((r) => r.corruptor === corruptor)
      for (const bad of ofCorruptor) {
        // Two criteria can draw on the same test page; the intact half is this criterion's.
        const good = ok.find((r) => r.set !== 'pair-corrupted' && r.criterion === bad.criterion && r.testcaseId === bad.testcaseId)
        if (!good) continue
        if (good.baseline === 'passed' && bad.baseline === 'failed') baseline++
        if (good.rampa === 'passed' && bad.rampa === 'failed') rampa++
      }
      pairs.push({ criterion, corruptor, total: ofCorruptor.length, baseline, rampa })
    }
  }

  const usage = records.reduce(
    (total, r) => ({
      calls: total.calls + r.usage.calls,
      cachedCalls: total.cachedCalls + r.usage.cachedCalls,
      inputTokens: total.inputTokens + r.usage.inputTokens,
      outputTokens: total.outputTokens + r.usage.outputTokens,
    }),
    { calls: 0, cachedCalls: 0, inputTokens: 0, outputTokens: 0 },
  )
  return {
    schemaVersion: 1,
    rampaVersion: VERSION,
    createdAt: new Date().toISOString(),
    model: meta.model,
    runs: meta.runs,
    llm: meta.llm,
    verify: meta.verify,
    actSha256: meta.actSha256,
    criteria: meta.criteria,
    followLinks: meta.followLinks,
    sets,
    pairs,
    judgment: {
      candidates: records.reduce((n, r) => n + r.candidates, 0),
      discarded: records.reduce((n, r) => n + r.discarded, 0),
      cannotTell: records.reduce((n, r) => n + r.cannotTell, 0),
    },
    usage: { ...usage, costUsd: estimateCostUsd(meta.model, usage.inputTokens, usage.outputTokens) },
    errors: records.flatMap((r) => {
      const error = r.error ?? r.modelError
      return error ? [{ testcaseId: r.testcaseId, error }] : []
    }),
  }
}

function renderSummary(summary: EvalSummary, p: ReturnType<typeof paint>): string {
  const num = (value: number | undefined) => (value === undefined ? '  —  ' : value.toFixed(2).padStart(5))
  const lines: string[] = []
  const head = [
    `rampa eval · WCAG ${summary.criteria.join(', ')}`,
    summary.llm ? `model ${summary.model}` : 'baseline only',
    `${summary.runs} run(s)`,
    summary.verify ? 'verification on' : p.yellow('verification OFF (ablation)'),
    `ACT ${summary.actSha256.slice(0, 8)}`,
    summary.followLinks ? `links followed: ${summary.followLinks}` : undefined,
  ].filter((part) => part !== undefined)
  lines.push(p.bold(head.join(' · ')))
  lines.push('')
  lines.push(p.dim(`${''.padEnd(34)}${'baseline (axe-core)'.padEnd(26)}rampa (axe-core + judgment)`))
  lines.push(p.dim(`${'set'.padEnd(28)}${'n'.padStart(4)}  ${'P'.padStart(5)} ${'R'.padStart(5)} ${'F1'.padStart(5)}        ${'P'.padStart(5)} ${'R'.padStart(5)} ${'F1'.padStart(5)}`))
  for (const set of summary.sets) {
    const b = set.baseline
    const r = set.rampa
    lines.push(
      `${set.label.padEnd(28)}${String(b.n).padStart(4)}  ${num(b.precision)} ${num(b.recall)} ${num(b.f1)}        ${num(r.precision)} ${num(r.recall)} ${num(r.f1)}`,
    )
  }
  if (summary.pairs.length > 0) lines.push('')
  for (const pair of summary.pairs) {
    lines.push(`Pair discrimination (${pair.corruptor}): baseline ${pair.baseline}/${pair.total} · rampa ${p.bold(`${pair.rampa}/${pair.total}`)}`)
  }
  lines.push('')
  const tokens = `${(summary.usage.inputTokens / 1000).toFixed(1)}k in / ${(summary.usage.outputTokens / 1000).toFixed(1)}k out tokens`
  const subscription = subscriptionOf(summary.model)
  const cost = subscription
    ? ` · on your ${subscription.plan} plan, through ${subscription.cli}`
    : summary.usage.costUsd === undefined
      ? ''
      : summary.usage.costUsd === 0
        ? ' · local model, no API cost'
        : ` · ≈ US$ ${summary.usage.costUsd.toFixed(4)}`
  if (summary.llm) {
    lines.push(`Judgment: ${summary.judgment.candidates} candidates · ${summary.judgment.discarded} discarded by verification · ${summary.judgment.cannotTell} cannot tell`)
    lines.push(`Model calls: ${summary.usage.calls} new, ${summary.usage.cachedCalls} from cache · ${tokens}${cost}`)
  }
  if (summary.errors.length > 0) lines.push(p.yellow(`${summary.errors.length} page(s) with errors; first: ${summary.errors[0]?.error}`))
  return lines.join('\n')
}
