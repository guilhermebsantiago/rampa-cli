import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { memoryCache } from '../../core/cache.ts'
import { checkSnapshot } from '../../core/check.ts'
import { errorMessage, mapLimit } from '../../core/util.ts'
import { AXE_REVIEW_RULES, emptyEngine } from '../../engine/axe.ts'
import { type ActTestcase, loadActTestcases, selectRuleTestcases } from '../../eval/act.ts'
import { type Scores, confusion, scores } from '../../eval/metrics.ts'
import type { Painter } from '../../report/color.ts'
import { resolveRules, runRuleChecks } from '../../rules/index.ts'
import type { RuleCheck } from '../../rules/types.ts'
import { collectWeb, launchBrowser } from '../../surfaces/web.ts'
import { VERSION } from '../../version.ts'

/**
 * `rampa eval --rules`: Rampa's rules (src/rules) against the ACT test cases they list, with no model.
 * Each page is scored three ways: axe-core alone, the rule alone, and both together as `rampa check`
 * reports them (a rule never repeats an element axe-core failed).
 */

export interface RuleEvalOptions {
  rules: string
  limit?: string | undefined
  refresh?: boolean | undefined
  outDir: string
  concurrency: string
}

export interface RuleEvalRecord {
  schemaVersion: 1
  rule: string
  criterion: string
  actRule: string
  testcaseId: string
  title: string
  url: string
  expected: ActTestcase['expected']
  axe: 'failed' | 'passed'
  rule_alone: 'failed' | 'passed'
  rampa: 'failed' | 'passed'
  findings: Array<{ source: string; ruleId?: string | undefined; ref?: string | undefined; evidence?: string | undefined }>
  /** Where an immediate redirect led, when the page had one. */
  redirectedTo?: string | undefined
  error?: string | undefined
}

export interface RuleEvalSummary {
  schemaVersion: 1
  rampaVersion: string
  createdAt: string
  actSha256: string
  sets: Array<{ rule: string; actRule: string; n: number; axe: Scores; ruleAlone: Scores; rampa: Scores; misses: string[]; falseAlarms: string[] }>
  skipped: Array<{ rule: string; reason: string }>
  errors: Array<{ testcaseId: string; error: string }>
}

export async function runRuleEval(options: RuleEvalOptions, p: Painter): Promise<number> {
  const rules = resolveRules(options.rules.split(',').map((id) => id.trim()).filter(Boolean))
  const limit = options.limit ? Number.parseInt(options.limit, 10) : undefined
  const dataset = await loadActTestcases('.rampa/act', Boolean(options.refresh))
  const skipped: RuleEvalSummary['skipped'] = []
  const jobs: Array<{ rule: RuleCheck; testcase: ActTestcase }> = []
  for (const rule of rules) {
    if (rule.act.length === 0) {
      skipped.push({ rule: rule.id, reason: 'no ACT rule: measured by its fixtures in test/fixtures/rules' })
      continue
    }
    let cases = selectRuleTestcases(dataset, rule.act)
    if (limit !== undefined) cases = cases.slice(0, limit)
    for (const testcase of cases) jobs.push({ rule, testcase })
  }

  const browser = await launchBrowser()
  let records: RuleEvalRecord[]
  try {
    records = await mapLimit(jobs, Math.max(1, Number.parseInt(options.concurrency, 10) || 4), (job) => runRuleJob(job.rule, job.testcase, browser))
  } finally {
    await browser.close()
  }

  const summary = summarizeRules(records, dataset.sha256, skipped)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const dir = join(options.outDir, `${stamp}-rules`)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'results.jsonl'), `${records.map((r) => JSON.stringify(r)).join('\n')}\n`, 'utf8')
  await writeFile(join(dir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
  process.stdout.write(`\n${renderRuleSummary(summary, p)}\n${p.dim(`Results: ${dir}`)}\n\n`)
  return 0
}

async function runRuleJob(rule: RuleCheck, testcase: ActTestcase, browser: Awaited<ReturnType<typeof launchBrowser>>): Promise<RuleEvalRecord> {
  const criterion = rule.criteria[0] ?? ''
  const base = {
    schemaVersion: 1 as const,
    rule: rule.id,
    criterion,
    actRule: testcase.ruleId,
    testcaseId: testcase.testcaseId,
    title: testcase.testcaseTitle,
    url: testcase.url,
    expected: testcase.expected,
  }
  try {
    const { snapshot, engine } = await collectWeb(browser, testcase.url, { runAxe: true, locale: 'en', requireOk: true })
    const report = await checkSnapshot(snapshot, engine, {
      criteria: [],
      llm: false,
      provider: undefined,
      runs: 1,
      cache: memoryCache(),
      offline: false,
      locale: 'en',
      minConfidence: 'low',
      concurrency: 1,
      rules: [rule],
    })
    // axe-core as it reports failures: the experimental rules Rampa runs for review only are left out.
    const axe = engine.rules.some((r) => r.outcome === 'violation' && r.criteria.includes(criterion) && !AXE_REVIEW_RULES.includes(r.ruleId))
    // The rule alone, without leaving to axe-core what it already failed. A hit the rule sends to review
    // (report.needsReview) counts as flagging the page, as it did when review hits were low-confidence findings.
    const stage = runRuleChecks(snapshot, emptyEngine(), 'en', [rule])
    const alone = stage.findings.length > 0 || stage.review.length > 0
    const ruled = report.findings.some((f) => f.ruleId === rule.id) || (report.needsReview ?? []).some((item) => item.ruleId === rule.id)
    const redirectedTo = typeof snapshot.root.native.redirectedTo === 'string' ? snapshot.root.native.redirectedTo : undefined
    return {
      ...base,
      axe: axe ? 'failed' : 'passed',
      rule_alone: alone ? 'failed' : 'passed',
      rampa: axe || ruled ? 'failed' : 'passed',
      findings: report.findings
        .filter((f) => f.criterion === criterion)
        .map((f) => ({ source: f.source, ruleId: f.ruleId, ref: f.ref, evidence: f.evidence })),
      redirectedTo,
    }
  } catch (error) {
    return { ...base, axe: 'passed', rule_alone: 'passed', rampa: 'passed', findings: [], error: errorMessage(error) }
  }
}

export function summarizeRules(records: RuleEvalRecord[], actSha256: string, skipped: RuleEvalSummary['skipped'] = []): RuleEvalSummary {
  const ok = records.filter((r) => !r.error)
  const sets: RuleEvalSummary['sets'] = []
  for (const key of [...new Set(ok.map((r) => `${r.rule}|${r.actRule}`))]) {
    const subset = ok.filter((r) => `${r.rule}|${r.actRule}` === key)
    const score = (who: 'axe' | 'rule_alone' | 'rampa') => scores(confusion(subset.map((r) => ({ expected: r.expected === 'failed', predicted: r[who] === 'failed' }))))
    const [rule = '', actRule = ''] = key.split('|')
    sets.push({
      rule,
      actRule,
      n: subset.length,
      axe: score('axe'),
      ruleAlone: score('rule_alone'),
      rampa: score('rampa'),
      misses: subset.filter((r) => r.expected === 'failed' && r.rampa !== 'failed').map((r) => r.testcaseId),
      falseAlarms: subset.filter((r) => r.expected !== 'failed' && r.rampa === 'failed').map((r) => r.testcaseId),
    })
  }
  return {
    schemaVersion: 1,
    rampaVersion: VERSION,
    createdAt: new Date().toISOString(),
    actSha256,
    sets,
    skipped,
    errors: records.flatMap((r) => (r.error ? [{ testcaseId: r.testcaseId, error: r.error }] : [])),
  }
}

export function renderRuleSummary(summary: RuleEvalSummary, p: Painter): string {
  const num = (value: number | undefined) => (value === undefined ? '  —  ' : value.toFixed(2).padStart(5))
  const triple = (s: Scores) => `${num(s.precision)} ${num(s.recall)} ${num(s.f1)}`
  const lines = [p.bold(`rampa eval --rules · no model · ACT ${summary.actSha256.slice(0, 8)}`), '']
  lines.push(p.dim(`${''.padEnd(42)}${'axe-core'.padEnd(20)}${'rule alone'.padEnd(20)}axe-core + rule`))
  lines.push(p.dim(`${'rule · ACT'.padEnd(36)}${'n'.padStart(4)}  ${'  P     R    F1'.padEnd(20)}${'  P     R    F1'.padEnd(20)}  P     R    F1`))
  for (const set of summary.sets) {
    lines.push(`${`${set.rule} · ${set.actRule}`.padEnd(36)}${String(set.n).padStart(4)}  ${triple(set.axe).padEnd(20)}${triple(set.ruleAlone).padEnd(20)}${triple(set.rampa)}`)
    if (set.misses.length > 0) lines.push(p.yellow(`  missed: ${set.misses.join(', ')}`))
    if (set.falseAlarms.length > 0) lines.push(p.yellow(`  flagged a page ACT does not fail: ${set.falseAlarms.join(', ')}`))
  }
  for (const skip of summary.skipped) lines.push(p.dim(`${skip.rule}: ${skip.reason}`))
  if (summary.errors.length > 0) lines.push(p.yellow(`${summary.errors.length} page(s) with errors; first: ${summary.errors[0]?.error}`))
  return lines.join('\n')
}
