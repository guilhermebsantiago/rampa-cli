import { afterEach, describe, expect, it, vi } from 'vitest'
import type { checkSnapshot as CheckSnapshot } from '../src/core/check.ts'
import { memoryCache } from '../src/core/cache.ts'
import type { EngineResults } from '../src/core/types.ts'
import { resolveCriteria } from '../src/criteria/index.ts'
import { judgmentFailsAct } from '../src/cli/commands/eval.ts'
import { confusion, scores } from '../src/eval/metrics.ts'
import { readMorePage } from './group-fixtures.ts'
import { stubModel } from './stub-model.ts'

const engine: EngineResults = { engine: { name: 'axe-core', version: 'test' }, rules: [] }

/**
 * What `rampa eval` does with each test page (src/cli/commands/eval.ts, runJob), on pages whose answers are known: check
 * it with the criterion alone at the threshold `low`, fail the ACT case when a judgment finding remains
 * (`judgmentFailsAct`), keep the findings for the record, and score the cases.
 */
async function evaluate(checkSnapshot: typeof CheckSnapshot) {
  const [criterion] = resolveCriteria(['2.4.4'])
  if (!criterion) throw new Error('no 2.4.4')
  const pages = [
    { id: 'burst', snapshot: readMorePage(8), expected: true },
    { id: 'three', snapshot: readMorePage(3), expected: true },
    { id: 'clean', snapshot: readMorePage(8, (index) => `Spring garden guide, part ${index + 1}`), expected: false },
  ]
  const records = []
  for (const page of pages) {
    const report = await checkSnapshot(page.snapshot, engine, {
      criteria: [criterion],
      llm: true,
      provider: stubModel(),
      runs: 1,
      cache: memoryCache(),
      offline: false,
      locale: 'en',
      minConfidence: 'low',
      concurrency: 2,
    })
    records.push({
      id: page.id,
      expected: page.expected,
      predicted: judgmentFailsAct(criterion, 'c487ae', { snapshot: page.snapshot, engine }, report.findings),
      findings: report.findings.filter((f) => f.criterion === criterion.id).map((f) => ({ source: f.source, ref: f.ref, evidence: f.evidence, ruleId: f.ruleId, message: f.message })),
      groups: report.groups?.length ?? 0,
    })
  }
  return { records, scores: scores(confusion(records)) }
}

afterEach(() => {
  vi.doUnmock('../src/core/groups.ts')
  vi.resetModules()
})

describe('rampa eval with groups', () => {
  it('scores every page and element as it would with no groups at all', async () => {
    const grouped = await evaluate((await import('../src/core/check.ts')).checkSnapshot)
    // The same check with grouping taken out: no report gets a group.
    vi.resetModules()
    vi.doMock('../src/core/groups.ts', async (importOriginal) => ({ ...(await importOriginal<typeof import('../src/core/groups.ts')>()), findingGroups: () => [] }))
    const ungrouped = await evaluate((await import('../src/core/check.ts')).checkSnapshot)

    expect(grouped.records.map((record) => record.groups)).toEqual([1, 0, 0])
    expect(ungrouped.records.map((record) => record.groups)).toEqual([0, 0, 0])
    const strip = (records: typeof grouped.records) => records.map(({ groups: _groups, ...record }) => record)
    expect(strip(grouped.records)).toEqual(strip(ungrouped.records))
    expect(grouped.scores).toEqual(ungrouped.scores)
    expect(grouped.scores).toMatchObject({ tp: 2, fp: 0, tn: 1, fn: 0 })
    // The burst page keeps its eight findings, one per element, in what the eval records.
    expect(grouped.records[0]?.findings).toHaveLength(8)
  })
})
