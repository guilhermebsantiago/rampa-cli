/**
 * Every 1.1.1 and 2.4.4 candidate of the eighth study's pages (all test), with its outcome in the main run, so that the pass sample
 * can be drawn (pass_draw.py; pre-registration, section 3) and the shared-text claims the proof rule moved to suggestions
 * counted and drawn (x6_draw.py; pre-registration, section 5, measure h). The seventh study's pass_list.ts for this
 * study's pages: the recorded snapshot and a copy of the page's main-run cache, offline, no model, no network.
 *
 * Per page and criterion, one row per candidate as `rampa check` builds them (the browser's names where the criterion
 * reads them, the elements a rule already failed left out, the cap of 50 with its judge-first order), with one outcome:
 * finding / below_threshold (a verified fail reported at or below the default threshold, medium); held_back (a verified
 * fail that is the model's suggestion; `held`: unconfirmed, ungrounded or unstyled); discarded (a fail verification
 * discarded); discarded_pass; passed; cannot_tell; capped; not_judged; offline_miss; error. The fail outcomes are read
 * from Rampa's own report of the page (`checkSnapshot`, in this process, with the main run's flags), by element; the
 * others from `judgeCandidates`, the function the check calls, over the same candidates and cache.
 *
 * The check that the listing is right: per criterion, the listing must give the main run's own report (DATA/pages/<slug>/
 * report.json, written by the build under study, 2f5f88f): its judgment findings split by the default threshold, its suggestions in
 * needsReview, its discarded claims by verdict, and in criteria[] candidates, discarded, passed, cannotTell, capped,
 * timedOut, offlineMisses and errors. The run stops at the first difference. A candidate the main run did not reach
 * before its time limit is `not_judged` there and has no cached answer here: such a page is listed with both counts.
 *
 * The shared-text proof rule (X6, ae2d5be: a shared-text claim is a finding only when its pair was read at both ends):
 * a 2.4.4 row held back as ungrounded, whose claim is `ambiguous` and whose candidate carries `sameTextUnread`, and
 * which `grounded` would accept with that field taken away, is marked `x6: true`: without the rule it would have been a
 * finding. `x6Confidence` is the confidence it would have had (check.ts's rule: the answer's confidence, lowered by the
 * runs' agreement and the criterion's cap), so that the draw can keep those at the default threshold.
 *
 * Only pages whose split is "test" are listed. Prints counts only.
 *
 * Run from the repository root (Node 24): node study/round-8-2026-11-21/scripts/pass_list.ts
 * DATA: $RECORDINGS (default C:/Users/guilh/dev/rampa-study-recordings/round-8); cache copies go to DATA/pages/<slug>/
 * cache-passlist/. Writes study/round-8-2026-11-21/data/pass-outcomes.json. The seventh study's pass_list.ts with this study's folders
 * and the X6 marking.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveProvider } from '../../../src/cli/commands/check.ts'
import { fileCache } from '../../../src/core/cache.ts'
import { DEFAULT_MAX_CANDIDATES, capCandidates, checkSnapshot } from '../../../src/core/check.ts'
import { meetsThreshold } from '../../../src/core/gate.ts'
import { judgeCandidates } from '../../../src/core/judge.ts'
import { type AnyCriterion, type Candidate, type Confidence, type Finding, type Report, minConfidence } from '../../../src/core/types.ts'
import { resolveCriteria } from '../../../src/criteria/index.ts'
import { t } from '../../../src/i18n.ts'
import { RULE_CHECKS, runRuleChecks } from '../../../src/rules/index.ts'
import { browserNamed } from '../../../src/snapshot/ax.ts'
import { captureStyle } from '../../../src/snapshot/reach.ts'
import { loadRecorded } from '../../../src/surfaces/targets.ts'

const STUDY = process.env.PASS_STUDY ?? 'study/round-8-2026-11-21'
const DATA = process.env.RECORDINGS ?? 'C:/Users/guilh/dev/rampa-study-recordings/round-8'
const OUT = `${STUDY}/data/pass-outcomes.json`
const MODEL = 'ollama:gemma4:12b'
/** rampa check's default --min-confidence (src/cli/main.ts). */
const DEFAULT_THRESHOLD: Confidence = 'medium'
const TIME_LIMIT_S = 900
const CRITERIA = ['1.1.1', '2.4.4'] as const
const OUTCOMES = ['finding', 'below_threshold', 'held_back', 'discarded', 'passed', 'discarded_pass', 'cannot_tell', 'capped', 'not_judged', 'offline_miss', 'error'] as const
type Outcome = (typeof OUTCOMES)[number]
const HELD = ['unconfirmed', 'ungrounded', 'unstyled'] as const
type Held = (typeof HELD)[number]
for (const key of Object.keys(process.env)) if (key.includes('API_KEY') || key === 'RAMPA_MODEL') delete process.env[key]

interface Row {
  slug: string
  criterion: string
  ref: string
  subject: string
  outcome: Outcome
  held?: Held | undefined
  x6?: true | undefined
  x6Confidence?: Confidence | undefined
}

const zero = <K extends string>(keys: readonly K[]) => Object.fromEntries(keys.map((key) => [key, 0])) as Record<K, number>
const isJudgment = (id: string) => (f: Finding) => f.source === 'judgment' && f.criterion === id

/** The criterion's rows for one page, read from `judgeCandidates` and from the page's own report. */
async function rowsOf(criterion: AnyCriterion, path: string, report: Report, cacheDir: string, slug: string): Promise<Row[]> {
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
    const row = { slug, criterion: criterion.id, ref: candidate.ref, subject: criterion.subject?.(candidate) ?? '' }
    const judgment = byCandidate.get(candidate)
    if (!judgment) return { ...row, outcome: 'capped' }
    if (judgment.samples.some((sample) => sample.decided)) throw new Error(`${slug} ${criterion.id} ${candidate.ref}: decided without a model, which this listing does not expect`)
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
          // X6: a shared-text claim held back only because its pair was not read at both ends (the proof rule, ae2d5be).
          const context = candidate.context as { sameTextUnread?: true } | undefined
          if (criterion.id === '2.4.4' && held === 'ungrounded' && output && criterion.grounded && context?.sameTextUnread && (output as { problem?: string }).problem === 'ambiguous') {
            const { sameTextUnread: _unread, ...rest } = context
            if (criterion.grounded(output, { ...candidate, context: rest }, view)) {
              const agreement = judgment.votes / Math.max(1, judgment.total)
              const own = (output as { confidence: Confidence }).confidence
              const voted: Confidence = agreement === 1 ? own : agreement >= 2 / 3 ? minConfidence(own, 'medium') : 'low'
              const x6Confidence = minConfidence(voted, criterion.confidenceCap?.(candidate) ?? 'high')
              return { ...row, outcome: 'held_back', held, x6: true, x6Confidence }
            }
          }
          return { ...row, outcome: 'held_back', held }
        }
        throw new Error(`${slug} ${criterion.id} ${candidate.ref}: a verified fail that is neither a finding nor a suggestion in the report`)
      }
    }
  })
}

/** Every difference between the listing and the main run's report, for one criterion of one page. */
function differences(rows: readonly Row[], main: Report, id: string): string[] {
  const count = (outcome: Outcome) => rows.filter((row) => row.outcome === outcome).length
  const refs = (selected: ReadonlyArray<{ ref?: string | undefined }>) => selected.map((x) => x.ref ?? '').sort()
  const listed = (...outcomes: Outcome[]) => refs(rows.filter((row) => outcomes.includes(row.outcome)))
  const atLow = [...main.findings, ...main.belowThreshold].filter(isJudgment(id))
  const suggestions = (main.needsReview ?? []).filter((item) => item.ruleId === `judgment/${id}`)
  const discarded = main.discarded.filter((d) => d.criterion === id)
  const verdict = (d: (typeof discarded)[number]) => (d.output as { verdict?: string } | undefined)?.verdict
  // The second pass's own offline misses are counted in offlineMisses too, on the claim it held back.
  const passMisses = suggestions.filter((item) => item.evidence?.includes(t('en', 'confirmOffline'))).length
  const summary = main.criteria.find((s) => s.criterion === id)
  // A candidate the main run did not reach in its time limit has no cached answer: not_judged there, an offline miss here.
  const unreached = count('offline_miss') + count('not_judged')
  const pairs: Array<[string, unknown, unknown]> = [
    ['findings at the default threshold', listed('finding'), refs(atLow.filter((f) => meetsThreshold(f, DEFAULT_THRESHOLD)))],
    ['findings below the default threshold', listed('below_threshold'), refs(atLow.filter((f) => !meetsThreshold(f, DEFAULT_THRESHOLD)))],
    ['belowThreshold at --min-confidence low', 0, main.belowThreshold.filter(isJudgment(id)).length],
    ['suggestions in needsReview', listed('held_back'), refs(suggestions)],
    ['discarded fails', listed('discarded'), refs(discarded.filter((d) => verdict(d) !== 'pass'))],
    ['discarded passes', listed('discarded_pass'), refs(discarded.filter((d) => verdict(d) === 'pass'))],
    ['criteria[].candidates', rows.length, summary?.candidates ?? 0],
    ['criteria[].discarded', count('discarded') + count('discarded_pass'), summary?.discarded ?? 0],
    ['criteria[].passed', count('passed'), summary?.passed ?? 0],
    ['criteria[].cannotTell', count('cannot_tell'), summary?.cannotTell ?? 0],
    ['criteria[].capped', count('capped'), summary?.capped ?? 0],
    ['criteria[].timedOut + offlineMisses', unreached + passMisses, (summary?.timedOut ?? 0) + (summary?.offlineMisses ?? 0)],
    ['criteria[].errors', count('error'), summary?.errors ?? 0],
  ]
  return pairs.filter(([, mine, theirs]) => JSON.stringify(mine) !== JSON.stringify(theirs)).map(([what, mine, theirs]) => `${what}: listing ${JSON.stringify(mine)}, main run ${JSON.stringify(theirs)}`)
}

const meta = JSON.parse(readFileSync(`${STUDY}/data/pages-input.json`, 'utf8')) as { pages: Array<{ slug: string; split: string }> }
const rows: Row[] = []
const pages: string[] = []
for (const { slug } of meta.pages.filter((page) => page.split === 'test')) {
  const dir = join(DATA, 'pages', slug)
  const recording = join(dir, 'recording')
  const file = existsSync(recording) ? readdirSync(recording).find((name) => name.endsWith('.snapshot.json')) : undefined
  const mainPath = join(dir, 'report.json')
  if (!file || !existsSync(mainPath)) throw new Error(`${slug}: no recording or main report`)
  const path = join(recording, file).replaceAll('\\', '/')
  const cacheDir = join(dir, 'cache-passlist')
  rmSync(cacheDir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  // A page whose main run judged nothing has no cache folder: its copy is an empty one (fixed 2026-11-21, run-log-notes).
  if (existsSync(join(dir, 'cache'))) cpSync(join(dir, 'cache'), cacheDir, { recursive: true })
  else mkdirSync(cacheDir, { recursive: true })
  const main = JSON.parse(readFileSync(mainPath, 'utf8')) as Report
  const criteria = resolveCriteria([...CRITERIA])
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
    wcag: '2.1',
    deadline: Date.now() + TIME_LIMIT_S * 1000,
  })
  for (const criterion of criteria) {
    const own = await rowsOf(criterion, path, report, cacheDir, slug)
    const wrong = differences(own, main, criterion.id)
    if (wrong.length > 0) throw new Error(`${slug} ${criterion.id}: the listing differs from the main run's report\n  ${wrong.join('\n  ')}`)
    rows.push(...own)
  }
  pages.push(slug)
  process.stderr.write('.')
}
process.stderr.write('\n')

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
const x6Rows = rows.filter((row) => row.x6)
const x6 = {
  moved: x6Rows.length,
  atDefaultThreshold: x6Rows.filter((row) => row.x6Confidence === 'medium' || row.x6Confidence === 'high').length,
  byConfidence: { high: x6Rows.filter((row) => row.x6Confidence === 'high').length, medium: x6Rows.filter((row) => row.x6Confidence === 'medium').length, low: x6Rows.filter((row) => row.x6Confidence === 'low').length },
  pages: new Set(x6Rows.map((row) => row.slug)).size,
}
const of = (id: string) => rows.filter((row) => row.criterion === id)
const result = {
  about: "Every 1.1.1 and 2.4.4 candidate of the eighth study's pages with its outcome in the main run, from the recorded snapshots and copies of the main-run caches, offline (scripts/pass_list.ts); each page checked against the main run's own report. Rows marked x6 are shared-text claims the proof rule (ae2d5be) moved to suggestions.",
  model: MODEL,
  flags: `--wcag 2.1 --locale en --min-confidence low --time-limit ${TIME_LIMIT_S} --concurrency 2 --offline`,
  defaultThreshold: DEFAULT_THRESHOLD,
  cap: DEFAULT_MAX_CANDIDATES,
  outcomes: OUTCOMES,
  counts: Object.fromEntries(CRITERIA.map((id) => [id, tally(of(id))])),
  heldBack: Object.fromEntries(CRITERIA.map((id) => [id, heldTally(of(id))])),
  x6,
}
const byPage = pages.map((slug) => ({ slug, ...Object.fromEntries(CRITERIA.map((id) => [id, tally(rows.filter((row) => row.slug === slug && row.criterion === id))])) }))
const head = JSON.stringify(result, null, 1)
const lines = (items: readonly unknown[]) => items.map((item) => `  ${JSON.stringify(item)}`).join(',\n')
writeFileSync(OUT, `${head.slice(0, head.lastIndexOf('\n}'))},\n "byPage": [\n${lines(byPage)}\n ],\n "rows": [\n${lines(rows)}\n ]\n}\n`)

console.log(`| criterion | candidates | ${OUTCOMES.join(' | ')} |`)
console.log(`| --- | ---: | ${OUTCOMES.map(() => '---:').join(' | ')} |`)
for (const id of CRITERIA) {
  const counts = tally(of(id))
  console.log(`| ${id} | ${counts.candidates} | ${OUTCOMES.map((outcome) => counts[outcome]).join(' | ')} |`)
}
console.log(`\nheld back, by why: ${JSON.stringify(result.heldBack)}`)
console.log(`shared-text claims the proof rule moved to suggestions (X6): ${JSON.stringify(x6)}`)
console.log(`${pages.length} test pages; every page matched the main run's report`)
