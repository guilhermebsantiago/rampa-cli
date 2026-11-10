/**
 * Every candidate of 1.1.1 and 2.4.4 on the 48 dev pages of the second to fifth real-page studies, with its outcome, from
 * the recorded snapshot and a copy of the page's judgment cache, offline: no model is asked, no network is used. A report
 * lists failures, not passes (`Report.criteria` holds counts only), so this names each candidate Rampa passed, and the
 * draw of round 6's pass sample (draw.py) runs on these rows as a dry run.
 *
 * Per page and criterion, one row per candidate as `rampa check` builds them (the browser's names where the criterion
 * reads them, the elements a rule already failed left out, the cap of 50 with its judge-first order), with one outcome:
 * - finding / below_threshold: a verified fail that is a finding, at or below rampa check's default threshold (medium);
 * - held_back: a verified fail that is the model's suggestion (`held` says why: `unconfirmed`, the second pass did not
 *   confirm it; `ungrounded`, no fact Rampa checks supports it, for 1.1.1 the P3 social icon; `unstyled`, the page was
 *   read without its styles);
 * - discarded: a fail verification discarded; discarded_pass: a pass verification discarded (counted, never drawn);
 * - passed: the model's verdict is pass and verification kept it; cannot_tell: the model could not tell;
 * - capped: past the cap of 50, never judged; not_judged: past the time limit; offline_miss / error: no answer.
 * The fail outcomes are read from Rampa's own report of the page (`checkSnapshot`, in this process, the replay's flags),
 * by element; the others from `judgeCandidates`, the function the check calls, over the same candidates and cache.
 *
 * The check that the listing is right: each page is also judged by the built CLI, offline, as the replays do
 * (study/notes-precision-p3p4/replay.sh), and per criterion the listing must give the CLI report's findings (split by the
 * default threshold), belowThreshold, the model's suggestions in needsReview, discarded (by verdict), and in criteria[]
 * candidates, passed, cannotTell, capped, timedOut, offlineMisses and errors. The run stops at the first difference.
 *
 * Only pages whose split is "dev" in the study's data/pages.json are opened. The second study's 2.4.4 was not judged in
 * the P3/P4 replay whose caches are read here (its header), so s2 lists 1.1.1 only.
 *
 * Run from the repository root, after `pnpm build`: node study/notes-pass-sample/list.ts
 * Recordings: $RECORDINGS (default C:/Users/guilh/dev/rampa-study-recordings). Cache copies, CLI reports and consoles go to
 * .rampa/pass-sample/ (ignored by git); writes study/notes-pass-sample/data/outcomes.json.
 */
import { spawnSync } from 'node:child_process'
import { closeSync, cpSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { resolveProvider } from '../../src/cli/commands/check.ts'
import { fileCache } from '../../src/core/cache.ts'
import { DEFAULT_MAX_CANDIDATES, capCandidates, checkSnapshot } from '../../src/core/check.ts'
import { meetsThreshold } from '../../src/core/gate.ts'
import { judgeCandidates } from '../../src/core/judge.ts'
import type { AnyCriterion, Candidate, Confidence, Finding, Report } from '../../src/core/types.ts'
import { resolveCriteria } from '../../src/criteria/index.ts'
import { t } from '../../src/i18n.ts'
import { RULE_CHECKS, runRuleChecks } from '../../src/rules/index.ts'
import { browserNamed } from '../../src/snapshot/ax.ts'
import { captureStyle } from '../../src/snapshot/reach.ts'
import { loadRecorded } from '../../src/surfaces/targets.ts'

const RECORDINGS = process.env.RECORDINGS ?? 'C:/Users/guilh/dev/rampa-study-recordings'
const CACHES = `${RECORDINGS}/notes-precision-p3p4-2026-10-29/caches-after`
const WORK = '.rampa/pass-sample'
const OUT = 'study/notes-pass-sample/data/outcomes.json'
const CLI = resolve('dist/cli.mjs')
const MODEL = 'ollama:gemma4:12b'
/** rampa check's default --min-confidence (src/cli/main.ts). */
const DEFAULT_THRESHOLD: Confidence = 'medium'
const TIME_LIMIT_S = 900
const STUDIES = [
  { study: 's2', folder: 'fresh-2026-10-11', input: 'fresh-2026-10-11', criteria: ['1.1.1'] },
  { study: 's3', folder: 'round-3-2026-10-23', input: 'round-3-2026-10-23', criteria: ['1.1.1', '2.4.4'] },
  { study: 's4', folder: 'round-4-2026-10-24', input: 'round-4-2026-10-24', criteria: ['1.1.1', '2.4.4'] },
  { study: 's5', folder: 'round-5', input: 'round-5-2026-10-28', criteria: ['1.1.1', '2.4.4'] },
] as const
const CRITERIA = ['1.1.1', '2.4.4'] as const
const OUTCOMES = ['finding', 'below_threshold', 'held_back', 'discarded', 'passed', 'discarded_pass', 'cannot_tell', 'capped', 'not_judged', 'offline_miss', 'error'] as const
type Outcome = (typeof OUTCOMES)[number]
const HELD = ['unconfirmed', 'ungrounded', 'unstyled'] as const
type Held = (typeof HELD)[number]
const KEYS = ['RAMPA_MODEL', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'OPENROUTER_API_KEY', 'GROQ_API_KEY']

interface Row {
  study: string
  slug: string
  criterion: string
  ref: string
  subject: string
  outcome: Outcome
  held?: Held | undefined
}

const zero = <K extends string>(keys: readonly K[]) => Object.fromEntries(keys.map((key) => [key, 0])) as Record<K, number>
const isJudgment = (id: string) => (f: Finding) => f.source === 'judgment' && f.criterion === id

/** The criterion's rows for one page, read from `judgeCandidates` and from the page's own report. */
async function rowsOf(criterion: AnyCriterion, path: string, report: Report, cacheDir: string, at: { study: string; slug: string }): Promise<Row[]> {
  const { snapshot, engine } = await loadRecorded(path, 'en')
  // An XML document or a bot check the site sent instead of the page: rampa check runs no rule and no judgment on it.
  if (snapshot.document?.kind === 'xml' || snapshot.blocked !== undefined) return []
  const view = criterion.names === 'browser' ? browserNamed(snapshot) : snapshot
  await criterion.prepare?.(view)
  const decided = runRuleChecks(snapshot, engine, 'en', RULE_CHECKS).decided.get(criterion.id)
  const candidates = criterion.candidates(view, engine).filter((candidate) => !decided?.has(candidate.ref))
  const judged = capCandidates(criterion, view, candidates, DEFAULT_MAX_CANDIDATES)
  const provider = await resolveProvider(MODEL, true)
  const judgments = await judgeCandidates(criterion, view, judged, { provider, runs: 1, cache: fileCache(cacheDir), offline: true, concurrency: 2 })
  const byCandidate = new Map<Candidate<unknown>, (typeof judgments)[number]>(judgments.map((judgment) => [judgment.candidate, judgment]))
  const style = captureStyle(snapshot)
  const reported = [...report.findings, ...report.belowThreshold].filter(isJudgment(criterion.id))
  const suggested = (report.needsReview ?? []).filter((item) => item.ruleId === `judgment/${criterion.id}`)

  return candidates.map((candidate): Row => {
    const row = { study: at.study, slug: at.slug, criterion: criterion.id, ref: candidate.ref, subject: criterion.subject?.(candidate) ?? '' }
    const judgment = byCandidate.get(candidate)
    if (!judgment) return { ...row, outcome: 'capped' }
    if (judgment.samples.some((sample) => sample.decided)) throw new Error(`${at.study} ${at.slug} ${criterion.id} ${candidate.ref}: decided without a model, which this listing does not expect`)
    switch (judgment.status) {
      case 'not-judged':
        return { ...row, outcome: 'not_judged' }
      case 'offline-miss':
        return { ...row, outcome: 'offline_miss' }
      case 'error':
        return { ...row, outcome: 'error' }
      case 'cannot_tell':
        return { ...row, outcome: 'cannot_tell' }
      case 'passed':
        return { ...row, outcome: 'passed' }
      case 'discarded':
        return { ...row, outcome: judgment.verdict === 'pass' ? 'discarded_pass' : 'discarded' }
      case 'failed': {
        const finding = reported.find((f) => f.ref === candidate.ref)
        if (finding) return { ...row, outcome: meetsThreshold(finding, DEFAULT_THRESHOLD) ? 'finding' : 'below_threshold' }
        if (suggested.some((item) => item.ref === candidate.ref)) {
          // The order check.ts asks in (`heldBack`): the page's styles first, then the criterion's facts, then the second pass.
          const output = judgment.representative
          const held: Held = style.unstyled ? 'unstyled' : output && criterion.grounded && !criterion.grounded(output, candidate, view) ? 'ungrounded' : 'unconfirmed'
          return { ...row, outcome: 'held_back', held }
        }
        throw new Error(`${at.study} ${at.slug} ${criterion.id} ${candidate.ref}: a verified fail that is neither a finding nor a suggestion in the report`)
      }
    }
  })
}

/** The built CLI on the page, offline, with the replay's flags; returns its JSON report. */
function cliReport(path: string, dir: string, cacheDir: string, ids: readonly string[]): Report {
  const out = resolve(dir, 'cli.report.json')
  const env: NodeJS.ProcessEnv = { ...process.env, RAMPA_BROWSER_CHANNEL: 'msedge' }
  for (const key of KEYS) delete env[key]
  const log = openSync(join(dir, 'cli.console.txt'), 'w')
  const args = [CLI, 'check', path, '--model', MODEL, '--locale', 'en', '--min-confidence', 'low', '--time-limit', String(TIME_LIMIT_S), '--concurrency', '2', '--offline']
  args.push('--criteria', ids.join(','), '--cache-dir', resolve(cacheDir), '--json', out)
  const run = spawnSync(process.execPath, args, { cwd: dir, env, stdio: ['ignore', log, log], timeout: 1_200_000 })
  closeSync(log)
  if (run.error || !existsSync(out)) throw new Error(`the CLI wrote no report for ${path} (exit ${run.status}): see ${join(dir, 'cli.console.txt')}`)
  return JSON.parse(readFileSync(out, 'utf8')) as Report
}

/** Every difference between the listing's counts and the CLI report's, for one criterion of one page. */
function differences(rows: readonly Row[], cli: Report, id: string): string[] {
  const count = (outcome: Outcome) => rows.filter((row) => row.outcome === outcome).length
  const refs = (selected: ReadonlyArray<{ ref?: string | undefined }>) => selected.map((x) => x.ref ?? '').sort()
  const listed = (...outcomes: Outcome[]) => refs(rows.filter((row) => outcomes.includes(row.outcome)))
  const atLow = [...cli.findings, ...cli.belowThreshold].filter(isJudgment(id))
  const suggestions = (cli.needsReview ?? []).filter((item) => item.ruleId === `judgment/${id}`)
  const discarded = cli.discarded.filter((d) => d.criterion === id)
  const verdict = (d: (typeof discarded)[number]) => (d.output as { verdict?: string } | undefined)?.verdict
  // The second pass's own offline misses are counted in offlineMisses too, on the claim it held back.
  const passMisses = suggestions.filter((item) => item.evidence?.includes(t('en', 'confirmOffline'))).length
  const summary = cli.criteria.find((s) => s.criterion === id)
  const pairs: Array<[string, unknown, unknown]> = [
    ['findings at the default threshold', listed('finding'), refs(atLow.filter((f) => meetsThreshold(f, DEFAULT_THRESHOLD)))],
    ['findings below the default threshold', listed('below_threshold'), refs(atLow.filter((f) => !meetsThreshold(f, DEFAULT_THRESHOLD)))],
    ['belowThreshold at --min-confidence low', 0, cli.belowThreshold.filter(isJudgment(id)).length],
    ['suggestions in needsReview', listed('held_back'), refs(suggestions)],
    ['discarded fails', listed('discarded'), refs(discarded.filter((d) => verdict(d) !== 'pass'))],
    ['discarded passes', listed('discarded_pass'), refs(discarded.filter((d) => verdict(d) === 'pass'))],
    ['criteria[].candidates', rows.length, summary?.candidates ?? 0],
    ['criteria[].discarded', count('discarded') + count('discarded_pass'), summary?.discarded ?? 0],
    ['criteria[].passed', count('passed'), summary?.passed ?? 0],
    ['criteria[].cannotTell', count('cannot_tell'), summary?.cannotTell ?? 0],
    ['criteria[].capped', count('capped'), summary?.capped ?? 0],
    ['criteria[].timedOut', count('not_judged'), summary?.timedOut ?? 0],
    ['criteria[].offlineMisses', count('offline_miss') + passMisses, summary?.offlineMisses ?? 0],
    ['criteria[].errors', count('error'), summary?.errors ?? 0],
  ]
  return pairs.filter(([, mine, theirs]) => JSON.stringify(mine) !== JSON.stringify(theirs)).map(([what, mine, theirs]) => `${what}: listing ${JSON.stringify(mine)}, CLI ${JSON.stringify(theirs)}`)
}

if (!existsSync(CLI)) throw new Error('dist/cli.mjs is missing: run pnpm build first')
const rows: Row[] = []
const pages: Array<{ study: string; slug: string; criteria: string[] }> = []
for (const { study, folder, input, criteria: ids } of STUDIES) {
  const listed = JSON.parse(readFileSync(join('study', input, 'data', 'pages.json'), 'utf8')) as Array<{ slug: string; split: string }>
  for (const { slug } of listed.filter((page) => page.split === 'dev')) {
    const recording = join(RECORDINGS, folder, 'pages', slug, 'recording')
    const file = existsSync(recording) ? readdirSync(recording).find((name) => name.endsWith('.snapshot.json')) : undefined
    if (!file) throw new Error(`${study} ${slug}: no recording`)
    const path = join(recording, file).replaceAll('\\', '/')
    const dir = join(WORK, 'pages', study, slug)
    const cacheDir = join(dir, 'cache')
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
    cpSync(join(CACHES, study, slug, 'cache'), cacheDir, { recursive: true })
    process.stderr.write(`${study} ${slug}\n`)

    const criteria = resolveCriteria(ids)
    const provider = await resolveProvider(MODEL, true)
    const loaded = await loadRecorded(path, 'en')
    const report = await checkSnapshot(loaded.snapshot, loaded.engine, {
      criteria,
      llm: true,
      provider,
      runs: 1,
      cache: fileCache(cacheDir),
      offline: true,
      confirm: true,
      verify: true,
      locale: 'en',
      minConfidence: 'low',
      concurrency: 2,
      deadline: Date.now() + TIME_LIMIT_S * 1000,
    })
    const cli = cliReport(path, dir, cacheDir, ids)
    for (const criterion of criteria) {
      const own = await rowsOf(criterion, path, report, cacheDir, { study, slug })
      const wrong = differences(own, cli, criterion.id)
      if (wrong.length > 0) throw new Error(`${study} ${slug} ${criterion.id}: the listing differs from the CLI report\n  ${wrong.join('\n  ')}`)
      rows.push(...own)
    }
    pages.push({ study, slug, criteria: [...ids] })
  }
}

const tally = (selected: readonly Row[]) => {
  const counts = zero(OUTCOMES)
  for (const row of selected) counts[row.outcome]++
  return { candidates: selected.length, ...counts }
}
const heldTally = (selected: readonly Row[]) => {
  const counts = zero(HELD)
  for (const row of selected) if (row.held) counts[row.held]++
  return counts
}
const of = (id: string, study?: string) => rows.filter((row) => row.criterion === id && (study === undefined || row.study === study))
const result = {
  about:
    'Every 1.1.1 and 2.4.4 candidate of the dev pages of the second to fifth real-page studies, with its outcome, from the recorded snapshots and copies of the P3/P4 replay final caches, offline (study/notes-pass-sample/list.ts). Counted, in-sample (dev). The second study lists 1.1.1 only.',
  model: MODEL,
  flags: `--locale en --min-confidence low --time-limit ${TIME_LIMIT_S} --concurrency 2 --offline`,
  caches: 'notes-precision-p3p4-2026-10-29/caches-after/<study>/<slug>/cache',
  defaultThreshold: DEFAULT_THRESHOLD,
  cap: DEFAULT_MAX_CANDIDATES,
  outcomes: OUTCOMES,
  counts: Object.fromEntries(CRITERIA.map((id) => [id, tally(of(id))])),
  heldBack: Object.fromEntries(CRITERIA.map((id) => [id, heldTally(of(id))])),
  byStudy: Object.fromEntries(STUDIES.map(({ study, criteria: ids }) => [study, Object.fromEntries(ids.map((id) => [id, tally(of(id, study))]))])),
}
const byPage = pages.map(({ study, slug, criteria: ids }) => ({
  study,
  slug,
  ...Object.fromEntries(ids.map((id) => [id, tally(rows.filter((row) => row.study === study && row.slug === slug && row.criterion === id))])),
}))
// The totals indented, then one line per page and one line per row.
const head = JSON.stringify(result, null, 1)
const lines = (items: readonly unknown[]) => items.map((item) => `  ${JSON.stringify(item)}`).join(',\n')
mkdirSync('study/notes-pass-sample/data', { recursive: true })
writeFileSync(OUT, `${head.slice(0, head.lastIndexOf('\n}'))},\n "byPage": [\n${lines(byPage)}\n ],\n "rows": [\n${lines(rows)}\n ]\n}\n`)

console.log(`| criterion | candidates | ${OUTCOMES.join(' | ')} |`)
console.log(`| --- | ---: | ${OUTCOMES.map(() => '---:').join(' | ')} |`)
for (const id of CRITERIA) {
  const counts = tally(of(id))
  console.log(`| ${id} | ${counts.candidates} | ${OUTCOMES.map((outcome) => counts[outcome]).join(' | ')} |`)
}
console.log(`\nheld back, by why: ${JSON.stringify(result.heldBack)}`)
console.log(`${pages.length} pages; every page matched the CLI report`)
