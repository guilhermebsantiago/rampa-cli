// Scores every tool on the same units, from the per-page records the runners wrote.
//
// A unit is (ACT test case, criterion): each A/AA criterion the case's rule maps to for conformance. A unit is
// positive when the case is a failed example. A tool flags a unit when it reported a definite failure, in its own
// terms (lib/tools.mjs), mapped to that criterion by its own metadata, on that page. Review items are counted apart.
// A page a tool could not check counts as nothing reported, and the errors are counted.
import { compareIds } from './env.mjs'
import { rampaEval } from './cases.mjs'

const has = (map, criterion) => (map?.[criterion]?.length ?? 0) > 0

/** How a tool's record says yes for a criterion, in the three readings the tables use. */
export const READINGS = {
  definite: (record, criterion) => Boolean(record && !record.error && has(record.fail, criterion)),
  review: (record, criterion) => Boolean(record && !record.error && (has(record.review, criterion) || has(record.low, criterion))),
  withReview: (record, criterion) => Boolean(record && !record.error && (has(record.fail, criterion) || has(record.review, criterion) || has(record.low, criterion))),
  withLow: (record, criterion) => Boolean(record && !record.error && (has(record.fail, criterion) || has(record.low, criterion))),
}

/** Wall time of a tool's run: the sum of its segments (an interrupted or repaired run has several). */
function wallTime(meta) {
  const segments = meta?.segments ?? (meta?.startedAt && meta?.finishedAt ? [meta] : [])
  const done = segments.filter((s) => s.startedAt && s.finishedAt)
  return done.length ? done.reduce((ms, s) => ms + Date.parse(s.finishedAt) - Date.parse(s.startedAt), 0) : undefined
}

function quantile(sorted, q) {
  if (sorted.length === 0) return undefined
  const position = (sorted.length - 1) * q
  const low = Math.floor(position)
  const high = Math.ceil(position)
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low)
}

export async function scoreAll({ cases, home, pairs, tools, wcag22, levels }) {
  const { confusion, scores } = await rampaEval()
  const homeSet = new Set(home)
  const units = cases.cases.flatMap((testcase) => testcase.criteria.map((criterion) => ({ testcase, criterion })))
  const inScope = new Set(wcag22)

  function tally(list, recordOf, flag) {
    const t = { failed: 0, caught: 0, passed: 0, passedFlagged: 0, inapplicable: 0, inapplicableFlagged: 0, reviewOnlyOnFailed: 0, reviewOnOthers: 0, errors: 0 }
    const pairsForScores = []
    for (const { testcase, criterion } of list) {
      const record = recordOf(testcase.id)
      if (!record || record.error) t.errors++
      const yes = flag(record, criterion)
      const review = !yes && READINGS.review(record, criterion)
      pairsForScores.push({ expected: testcase.expected === 'failed', predicted: yes })
      if (testcase.expected === 'failed') {
        t.failed++
        if (yes) t.caught++
        else if (review) t.reviewOnlyOnFailed++
      } else {
        if (testcase.expected === 'passed') t.passed++
        else t.inapplicable++
        if (yes) {
          if (testcase.expected === 'passed') t.passedFlagged++
          else t.inapplicableFlagged++
        } else if (review) t.reviewOnOthers++
      }
    }
    const s = scores(confusion(pairsForScores))
    return { ...t, n: list.length, precision: s.precision, recall: s.recall, f1: s.f1, recallCi: s.recallCi, precisionCi: s.precisionCi }
  }

  const result = { units: units.length, tools: {} }
  const criteria = [...new Set(units.map((u) => u.criterion))].sort(compareIds)
  const ruleIds = [...new Set(cases.cases.map((c) => c.ruleId))].sort()

  for (const tool of tools) {
    const own = tool.records
    const inherited = tool.inherit ? tools.find((other) => other.id === tool.inherit)?.records : undefined
    const recordOf = (id) => own.get(id) ?? inherited?.get(id)
    const definite = READINGS.definite
    const entry = { id: tool.id, label: tool.label, scored: tool.scored !== false, meta: tool.meta }

    if (entry.scored) {
      entry.overall = tally(units, recordOf, definite)
      entry.overallWithReview = tally(units, recordOf, READINGS.withReview)
      if (tool.runner === 'rampa') {
        // Rampa's own `rampa eval` reading: findings below the default threshold count too.
        entry.overallWithLow = tally(units, recordOf, READINGS.withLow)
        entry.byCriterionWithLow = Object.fromEntries(criteria.map((criterion) => [criterion, tally(units.filter((u) => u.criterion === criterion), recordOf, READINGS.withLow)]))
        entry.trueFailureWithLow = criteria.filter((criterion) => entry.byCriterionWithLow[criterion].caught > 0)
      }
      entry.home = tally(
        units.filter((u) => homeSet.has(u.testcase.ruleId)),
        recordOf,
        definite,
      )
      entry.away = tally(
        units.filter((u) => !homeSet.has(u.testcase.ruleId)),
        recordOf,
        definite,
      )
      entry.byCriterion = Object.fromEntries(criteria.map((criterion) => [criterion, tally(units.filter((u) => u.criterion === criterion), recordOf, definite)]))
      entry.byRule = Object.fromEntries(ruleIds.map((ruleId) => [ruleId, tally(units.filter((u) => u.testcase.ruleId === ruleId), recordOf, definite)]))

      // Coverage: what it claims, what it failed at all on any page here, and where at least one failure was right.
      const allRecords = [...own.values(), ...(inherited ? [...inherited.entries()].filter(([id]) => !own.has(id)).map(([, r]) => r) : [])]
      const failedAny = new Set()
      for (const record of allRecords) for (const criterion of Object.keys(record.fail ?? {})) if (inScope.has(criterion) && has(record.fail, criterion)) failedAny.add(criterion)
      const trueFailure = criteria.filter((criterion) => entry.byCriterion[criterion].caught > 0)
      const claimed = tool.meta?.claimed ? [...new Set(tool.meta.claimed)].filter((c) => inScope.has(c)).sort(compareIds) : null
      entry.coverage = { claimed, failedAny: [...failedAny].sort(compareIds), trueFailure }
      entry.onFailable = tally(
        units.filter((u) => failedAny.has(u.criterion)),
        recordOf,
        definite,
      )

      entry.pairs = scorePairs(pairs.pairs, recordOf, definite)
      if (tool.runner === 'rampa') entry.pairsWithLow = scorePairs(pairs.pairs, recordOf, READINGS.withLow)
    }

    // Time per page: this tool's own pages, without errors, without a process's first (cold) page.
    const times = [...own.values()].filter((r) => !r.error && !r.cold && Number.isFinite(r.ms)).map((r) => r.ms).sort((a, b) => a - b)
    const cold = [...own.values()].filter((r) => !r.error && r.cold).map((r) => r.ms)
    entry.time = {
      pages: own.size,
      timed: times.length,
      medianMs: quantile(times, 0.5),
      p90Ms: quantile(times, 0.9),
      meanMs: times.length ? times.reduce((a, b) => a + b, 0) / times.length : undefined,
      coldMeanMs: cold.length ? cold.reduce((a, b) => a + b, 0) / cold.length : undefined,
      errors: [...own.values()].filter((r) => r.error).length,
      wallMs: wallTime(tool.meta),
      workers: tool.meta?.workers,
      modelCalls: [...own.values()].reduce((n, r) => n + (r.usage?.calls ?? 0), 0),
      cachedCalls: [...own.values()].reduce((n, r) => n + (r.usage?.cachedCalls ?? 0), 0),
    }
    entry.errorSamples = [...own.values()].filter((r) => r.error).slice(0, 5).map((r) => ({ id: r.id, error: r.error }))
    result.tools[tool.id] = entry
  }

  result.criteria = criteria.map((criterion) => {
    const list = units.filter((u) => u.criterion === criterion)
    const rules = [...new Set(list.map((u) => u.testcase.ruleId))].sort()
    return {
      criterion,
      level: levels[criterion],
      failed: list.filter((u) => u.testcase.expected === 'failed').length,
      others: list.filter((u) => u.testcase.expected !== 'failed').length,
      rules,
      home: rules.filter((r) => homeSet.has(r)),
    }
  })
  result.rules = cases.rules.map((rule) => ({ ...rule, home: homeSet.has(rule.ruleId), cases: cases.cases.filter((c) => c.ruleId === rule.ruleId).length }))
  result.comparisons = compareEngines(tools)
  result.sharedFalsePositives = sharedFalsePositives(units, tools)
  return result
}

/** Pairs: told apart when the intact half is not failed under the pair's criterion and the corrupted half is. */
function scorePairs(list, recordOf, flag) {
  const byCorruptor = new Map()
  for (const pair of list) {
    const intact = flag(recordOf(pair.intactId), pair.criterion)
    const corrupted = flag(recordOf(pair.corruptedId), pair.criterion)
    const key = `${pair.criterion}|${pair.corruptor}`
    const row = byCorruptor.get(key) ?? { criterion: pair.criterion, corruptor: pair.corruptor, rampaDefault: pair.rampaDefault, total: 0, toldApart: 0, intactFlagged: 0, corruptedFlagged: 0, errors: 0 }
    row.total++
    if (!intact && corrupted) row.toldApart++
    if (intact) row.intactFlagged++
    if (corrupted) row.corruptedFlagged++
    if (recordOf(pair.intactId)?.error || recordOf(pair.corruptedId)?.error || !recordOf(pair.intactId) || !recordOf(pair.corruptedId)) row.errors++
    byCorruptor.set(key, row)
  }
  const rows = [...byCorruptor.values()].sort((a, b) => compareIds(a.criterion, b.criterion) || a.corruptor.localeCompare(b.corruptor))
  const sum = (subset, key) => subset.reduce((n, row) => n + row[key], 0)
  return {
    rows,
    total: sum(rows, 'total'),
    toldApart: sum(rows, 'toldApart'),
    defaultTotal: sum(rows.filter((r) => r.rampaDefault), 'total'),
    defaultToldApart: sum(rows.filter((r) => r.rampaDefault), 'toldApart'),
    intactFlagged: sum(rows, 'intactFlagged'),
    errors: sum(rows, 'errors'),
  }
}

/** The rule engines that do not share code with each other, for the agreement count below. */
const ENGINES = ['axe', 'pa11y', 'ibm', 'alfa', 'qualweb']

/**
 * A passed or inapplicable example that several independent engines fail under the same criterion probably fails
 * that criterion for a reason its rule does not test. For each tool: of its false positives, how many at least three
 * of the other engines also flag; and the units most engines flag.
 */
function sharedFalsePositives(units, tools) {
  const byId = Object.fromEntries(tools.map((tool) => [tool.id, tool]))
  const engines = ENGINES.filter((id) => byId[id])
  const recordOf = (tool, id) => tool.records.get(id) ?? (tool.inherit ? byId[tool.inherit]?.records.get(id) : undefined)
  const flaggedBy = (unit) => engines.filter((id) => READINGS.definite(recordOf(byId[id], unit.testcase.id), unit.criterion))
  const negatives = units.filter((u) => u.testcase.expected !== 'failed').map((unit) => ({ unit, by: flaggedBy(unit) }))
  const perTool = {}
  for (const tool of tools.filter((t) => t.scored !== false)) {
    let total = 0
    let shared = 0
    for (const { unit, by } of negatives) {
      if (!READINGS.definite(recordOf(tool, unit.testcase.id), unit.criterion)) continue
      total++
      if (by.filter((id) => id !== tool.id).length >= 3) shared++
    }
    perTool[tool.id] = { falsePositives: total, sharedWithThreeOthers: shared }
  }
  const widespread = negatives
    .filter(({ by }) => by.length >= 4)
    .map(({ unit, by }) => ({ id: unit.testcase.id, ruleId: unit.testcase.ruleId, title: unit.testcase.title, expected: unit.testcase.expected, criterion: unit.criterion, engines: by }))
  return { engines, perTool, widespread }
}

/** What Lighthouse and Pa11y's axe runner change about axe-core, page by page. */
function compareEngines(tools) {
  const byId = Object.fromEntries(tools.map((tool) => [tool.id, tool]))
  const out = {}
  const axe = byId.axe?.records
  const flat = (map) => new Set(Object.values(map ?? {}).flat())
  if (axe && byId.lighthouse) {
    const lh = byId.lighthouse.records
    let pages = 0
    const notInAxe = []
    const missedWcag = new Map()
    for (const [id, record] of lh) {
      const reference = axe.get(id)
      if (record.error || !reference || reference.error) continue
      pages++
      const axeRules = new Set(reference.failRules ?? [])
      const extra = (record.failRules ?? []).filter((rule) => !axeRules.has(rule))
      if (extra.length) notInAxe.push({ id, rules: extra })
      const lhRules = new Set(record.failRules ?? [])
      for (const rule of flat(reference.fail)) if (!lhRules.has(rule)) missedWcag.set(rule, (missedWcag.get(rule) ?? 0) + 1)
    }
    out.lighthouse = {
      pages,
      errors: [...lh.values()].filter((r) => r.error).length,
      errorKinds: [...new Set([...lh.values()].filter((r) => r.error).map((r) => r.error))],
      failuresNotInAxe: notInAxe,
      axeWcagFailuresLighthouseMissed: Object.fromEntries([...missedWcag.entries()].sort((a, b) => b[1] - a[1])),
    }
  }
  if (axe && byId['pa11y-axe']) {
    const p = byId['pa11y-axe'].records
    let pages = 0
    const fromIncomplete = new Map()
    const demoted = new Map()
    const absent = new Map()
    const bump = (map, key) => map.set(key, (map.get(key) ?? 0) + 1)
    const sorted = (map) => Object.fromEntries([...map.entries()].sort((a, b) => b[1] - a[1]))
    for (const [id, record] of p) {
      const reference = axe.get(id)
      if (record.error || !reference || reference.error) continue
      pages++
      const axeFail = new Set(reference.failRules ?? [])
      const axeReview = flat(reference.review)
      // An error of Pa11y's that axe-core itself left incomplete (for review): Pa11y levels by impact, not by outcome.
      for (const rule of record.failRules ?? []) if (!axeFail.has(rule) && axeReview.has(rule)) bump(fromIncomplete, rule)
      const pa11yFail = new Set(record.failRules ?? [])
      const pa11yOther = new Set([...flat(record.review), ...flat(record.notice)])
      // A WCAG violation of axe-core's that Pa11y reports as a warning or notice (moderate or minor impact), or not at
      // all (a rule Pa11y's tags or its axe-core version do not run).
      for (const rule of flat(reference.fail)) if (!pa11yFail.has(rule)) bump(pa11yOther.has(rule) ? demoted : absent, rule)
    }
    out.pa11yAxe = {
      pages,
      errorsFromAxeIncomplete: sorted(fromIncomplete),
      axeViolationsDemoted: sorted(demoted),
      axeViolationsAbsent: sorted(absent),
    }
  }
  return out
}
