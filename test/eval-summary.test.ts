import { describe, expect, it } from 'vitest'
import { type EvalRecord, summarize } from '../src/cli/commands/eval.ts'
import { ACT_RULES, type ActDataset, selectTestcases } from '../src/eval/act.ts'

function record(partial: Partial<EvalRecord> & Pick<EvalRecord, 'criterion' | 'set' | 'testcaseId' | 'expected' | 'rampa'>): EvalRecord {
  return {
    schemaVersion: 1,
    ruleId: 'cc0f0a',
    ruleKind: 'semantic',
    title: partial.testcaseId,
    url: `https://example.test/${partial.testcaseId}.html`,
    baseline: 'passed',
    candidates: 1,
    discarded: 0,
    cannotTell: 0,
    findings: [],
    usage: { calls: 0, cachedCalls: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0 },
    ...partial,
  }
}

const meta = { model: 'test', runs: 1, llm: true, verify: true, actSha256: 'x', criteria: ['2.4.6', '3.3.2'] }

describe('eval summary', () => {
  it('scores a rule lent for pairs only in the pairs, never as an ACT set of the criterion', () => {
    const summary = summarize(
      [
        // 2.4.6 judges the same page, with its own verdict.
        record({ criterion: '2.4.6', set: 'act', testcaseId: 'p1', expected: 'passed', rampa: 'failed' }),
        record({ criterion: '3.3.2', set: 'pair-intact', testcaseId: 'p1', expected: 'passed', rampa: 'passed' }),
        record({ criterion: '3.3.2', set: 'pair-corrupted', corruptor: 'label-hidden', testcaseId: 'p1', expected: 'failed', rampa: 'failed' }),
        record({ criterion: '3.3.2', set: 'pair-intact', testcaseId: 'p2', expected: 'passed', rampa: 'passed' }),
        record({ criterion: '3.3.2', set: 'pair-corrupted', corruptor: 'label-hidden', testcaseId: 'p2', expected: 'failed', rampa: 'passed' }),
      ],
      meta,
    )
    expect(summary.sets.map((set) => `${set.criterion} ${set.label}`)).toEqual(['2.4.6 ACT cc0f0a (semantic)', '3.3.2 pairs (intact + corrupted)'])
    expect(summary.sets[1]?.rampa).toMatchObject({ tp: 1, fn: 1, fp: 0, tn: 2 })
    // The intact half is the 3.3.2 record, not 2.4.6's failing one on the same page.
    expect(summary.pairs).toEqual([{ criterion: '3.3.2', corruptor: 'label-hidden', total: 2, baseline: 0, rampa: 1 }])
  })

  it('selects the passing pages of rules lent for pairs', () => {
    const dataset: ActDataset = {
      sha256: 'x',
      path: 'testcases.json',
      testcases: [
        { ruleId: 'cc0f0a', ruleName: '', testcaseId: 'a', testcaseTitle: 'Passed Example 1', expected: 'passed', url: 'https://example.test/a.html' },
        { ruleId: 'cc0f0a', ruleName: '', testcaseId: 'b', testcaseTitle: 'Failed Example 1', expected: 'failed', url: 'https://example.test/b.html' },
      ],
    }
    expect(ACT_RULES['3.3.2']?.pairs).toEqual(['cc0f0a'])
    // Both come back; the eval keeps only the passing one, as the intact half.
    expect(selectTestcases(dataset, '3.3.2').map((tc) => tc.testcaseId)).toEqual(['a', 'b'])
  })
})
