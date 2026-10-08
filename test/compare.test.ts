import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runCompare } from '../src/cli/commands/compare.ts'
import type { EvalRecord } from '../src/cli/commands/eval.ts'
import { type LoadedRun, type RunRecord, RunRecordSchema, compareRuns, loadRun, mcnemarExact } from '../src/eval/compare.ts'
import { comparisonMarkdown, pValue, renderComparison } from '../src/eval/compare-render.ts'
import { paint } from '../src/report/color.ts'

/**
 * Two real eval runs from 2026-10-08 on the same ACT test cases, Gemma 4 12B on a local GPU and
 * gpt-6-luna, trimmed to WCAG 3.1.2 and without the findings' text. Their summary.json keeps the
 * scores eval wrote for 3.1.2; its totals were summed again over the kept records.
 */
const GEMMA = 'test/fixtures/runs/2026-10-08T02-13-36-ollama-gemma4-12b'
const LUNA = 'test/fixtures/runs/2026-10-08T03-06-22-openai-gpt-6-luna'

interface SummaryFile {
  sets: Array<{ label: string; criterion: string; rampa: unknown }>
  pairs: Array<{ criterion: string; corruptor: string; total: number; rampa: number }>
  judgment: { candidates: number; discarded: number; cannotTell: number }
  usage: { calls: number; cachedCalls: number; inputTokens: number; outputTokens: number; costUsd?: number }
}

const summaryOf = async (dir: string) => JSON.parse(await readFile(join(dir, 'summary.json'), 'utf8')) as SummaryFile
/** Same shape as summary.json, where JSON leaves undefined fields out. */
const asJson = (value: unknown) => JSON.parse(JSON.stringify(value)) as unknown

let counter = 0
function record(partial: Partial<RunRecord> = {}): RunRecord {
  counter++
  return {
    schemaVersion: 1,
    set: 'act',
    criterion: '3.1.2',
    ruleId: 'off6ek',
    ruleKind: 'semantic',
    testcaseId: `case-${counter}`,
    title: `Example ${counter}`,
    url: `https://example.test/${counter}.html`,
    expected: 'passed',
    baseline: 'passed',
    rampa: 'passed',
    candidates: 1,
    discarded: 0,
    cannotTell: 0,
    usage: { calls: 1, cachedCalls: 0, inputTokens: 100, outputTokens: 10, latencyMs: 1000 },
    ...partial,
  }
}

function run(name: string, records: RunRecord[], summary: LoadedRun['summary'] = { model: 'ollama:a', llm: true, verify: true, runs: 1 }): LoadedRun {
  return { dir: `runs/${name}`, name, summary, hasSummary: true, records }
}

describe('mcnemarExact', () => {
  it('matches the exact binomial test (values from Python math.comb)', () => {
    expect(mcnemarExact(0, 0)).toBe(1)
    expect(mcnemarExact(1, 0)).toBe(1)
    expect(mcnemarExact(5, 0)).toBe(0.0625)
    expect(mcnemarExact(6, 0)).toBe(0.03125)
    expect(mcnemarExact(10, 2)).toBe(0.03857421875)
    expect(mcnemarExact(3, 7)).toBeCloseTo(0.34375, 12)
    expect(mcnemarExact(25, 40)).toBeCloseTo(0.08168153394154005, 12)
  })

  it('is two-sided and symmetric', () => {
    expect(mcnemarExact(7, 3)).toBe(mcnemarExact(3, 7))
  })

  it('stays finite where 2^-n underflows', () => {
    expect(mcnemarExact(1000, 1000)).toBe(1)
    const p = mcnemarExact(600, 400)
    expect(Number.isFinite(p)).toBe(true)
    expect(p).toBeGreaterThan(0)
    expect(p).toBeLessThan(1e-9)
  })

  it('prints small p values without false precision', () => {
    expect(pValue(0.0004)).toBe('< 0.001')
    expect(pValue(0.03125)).toBe('0.031')
    expect(pValue(1)).toBe('1.000')
  })
})

describe('loadRun', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'rampa-compare-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('reads the records and the summary of a run', async () => {
    const loaded = await loadRun(LUNA)
    expect(loaded.records).toHaveLength(37)
    expect(loaded.name).toBe('2026-10-08T03-06-22-openai-gpt-6-luna')
    expect(loaded.summary).toMatchObject({ model: 'openai:gpt-6-luna', runs: 1, llm: true, verify: true })
  })

  it('says what is wrong with a directory that is not a run', async () => {
    await expect(loadRun(dir)).rejects.toThrow(/has no results\.jsonl/)
    await writeFile(join(dir, 'results.jsonl'), `${JSON.stringify(record())}\n\n{oops\n`)
    await expect(loadRun(dir)).rejects.toThrow(/results\.jsonl:3 is not JSON/)
    await writeFile(join(dir, 'results.jsonl'), `${JSON.stringify({ ...record(), rampa: 'maybe' })}\n`)
    await expect(loadRun(dir)).rejects.toThrow(/results\.jsonl:1 is not an eval record: rampa:/)
    await writeFile(join(dir, 'results.jsonl'), '\n')
    await expect(loadRun(dir)).rejects.toThrow(/has no records/)
  })

  it('still compares a run without summary.json, and says its model is unknown', async () => {
    await writeFile(join(dir, 'results.jsonl'), `﻿${JSON.stringify(record())}\r\n`)
    const loaded = await loadRun(dir)
    expect(loaded.hasSummary).toBe(false)
    expect(compareRuns([loaded]).warnings.join('\n')).toMatch(/no readable summary\.json/)
  })

  it('reads every field an eval record is written with', () => {
    const written: EvalRecord = {
      schemaVersion: 1,
      set: 'pair-corrupted',
      criterion: '1.1.1',
      ruleId: 'qt1vmo',
      ruleKind: 'semantic',
      testcaseId: 'abc',
      title: 'Passed Example 1',
      url: 'https://example.test/abc.html',
      expected: 'failed',
      baseline: 'passed',
      rampa: 'failed',
      corruptor: 'alt-swap',
      changedElements: 1,
      candidates: 1,
      discarded: 0,
      cannotTell: 0,
      findings: [{ source: 'judgment', ref: 'img', evidence: 'A bowl', message: 'm' }],
      usage: { calls: 1, cachedCalls: 0, inputTokens: 1, outputTokens: 1, latencyMs: 1 },
    }
    // The assignment fails to compile if eval's records stop carrying what a comparison reads.
    const typed: RunRecord = written
    expect(typed).toMatchObject(RunRecordSchema.parse(JSON.parse(JSON.stringify(written))))
  })
})

describe('compareRuns on real runs', () => {
  it('scores every set as rampa eval did', async () => {
    const runs = await Promise.all([GEMMA, LUNA].map(loadRun))
    const comparison = compareRuns(runs)
    for (const [index, dir] of [GEMMA, LUNA].entries()) {
      const summary = await summaryOf(dir)
      const sets = comparison.criteria.flatMap((criterion) => criterion.sets.map((set) => ({ label: set.label, criterion: criterion.criterion, rampa: asJson(set.scores[index]) })))
      expect(sets).toEqual(expect.arrayContaining(summary.sets.map((set) => ({ label: set.label, criterion: set.criterion, rampa: set.rampa }))))
      expect(sets).toHaveLength(summary.sets.length)
      const pairs = comparison.criteria.flatMap((criterion) =>
        criterion.pairs.map((pair) => ({ criterion: criterion.criterion, corruptor: pair.corruptor, total: pair.results[index]?.total, rampa: pair.results[index]?.toldApart })),
      )
      expect(pairs).toEqual(summary.pairs.map(({ criterion, corruptor, total, rampa }) => ({ criterion, corruptor, total, rampa })))
      expect(comparison.runs[index]).toMatchObject({ ...summary.judgment, calls: summary.usage.calls, cachedCalls: summary.usage.cachedCalls })
      expect(comparison.runs[index]).toMatchObject({ inputTokens: summary.usage.inputTokens, outputTokens: summary.usage.outputTokens, costUsd: summary.usage.costUsd })
    }
    expect(comparison.runs.map((r) => [r.id, r.label, r.cases])).toEqual([
      ['A', 'ollama:gemma4:12b', 37],
      ['B', 'openai:gpt-6-luna', 37],
    ])
    expect(comparison.runs[0]?.msPerCall).toBeCloseTo(98427 / 26)
    expect(comparison.warnings).toEqual([])
  })

  it('pairs the two runs case by case (numbers checked independently in Python)', async () => {
    const comparison = compareRuns(await Promise.all([GEMMA, LUNA].map(loadRun)))
    expect(comparison.paired?.all).toEqual({ shared: 37, bothRight: 34, onlyFirstRight: 1, onlySecondRight: 1, bothWrong: 1, pValue: 1 })
    expect(comparison.paired?.criteria.map((c) => c.criterion)).toEqual(['3.1.2'])
    expect(comparison.paired?.differing.map((d) => [d.title, d.expected, ...d.verdicts])).toEqual([
      ['Passed Example 4', 'passed', 'failed', 'passed'],
      ['Passed Example 5', 'passed', 'passed', 'failed'],
    ])
    expect(comparison.paired).toMatchObject({ onlyInFirst: 0, onlyInSecond: 0 })
  })
})

describe('compareRuns on edge cases', () => {
  it('pairs only shared cases and gives a significant p when one run is right far more often', () => {
    const expected = Array.from({ length: 8 }, () => record({ expected: 'failed', rampa: 'failed' }))
    const first = run('first', expected)
    const second = run(
      'second',
      expected.map((r, index) => (index < 6 ? { ...r, rampa: 'passed' as const } : r)),
      { model: 'ollama:b', llm: true, verify: true, runs: 1 },
    )
    second.records.push(record({ criterion: '3.1.2' }))
    const comparison = compareRuns([first, second])
    expect(comparison.paired?.all).toMatchObject({ shared: 8, bothRight: 2, onlyFirstRight: 6, onlySecondRight: 0, pValue: 0.03125 })
    expect(comparison.paired).toMatchObject({ onlyInFirst: 0, onlyInSecond: 1 })
    expect(comparison.warnings.join('\n')).toMatch(/did not evaluate the same cases for 3\.1\.2: compare n before the scores; the paired comparison uses shared cases only/)
    const text = renderComparison(comparison, paint(false))
    expect(text).toMatch(/3\.1\.2\s+8\s+2\s+6\s+0\s+0\s+0\.031/)
    expect(text).toContain('Left out: 0 case(s) only A evaluated, 1 only B evaluated.')
  })

  it('leaves pages that failed to load out, and warns about model errors', () => {
    const comparison = compareRuns([
      run('a', [record(), record({ error: 'net::ERR_TIMED_OUT' }), record({ modelError: 'No object generated' })]),
    ])
    expect(comparison.runs[0]).toMatchObject({ cases: 2, pageErrors: 1, modelErrors: 1 })
    expect(comparison.criteria[0]?.sets[0]?.scores[0]?.n).toBe(2)
    expect(comparison.warnings).toEqual([
      'A: the model failed on 1 page(s); those candidates count as unjudged, which lowers recall.',
      'A: 1 page(s) could not be loaded and are left out.',
    ])
    expect(comparison.paired).toBeUndefined()
  })

  it('shows a criterion only for the runs that evaluated it', () => {
    const withImages = run('a', [record({ criterion: '1.1.1', ruleId: 'qt1vmo' }), record()])
    const textOnly = run('b', [record()], { model: 'groq:openai/gpt-oss-20b', llm: true, verify: true, runs: 1 })
    const comparison = compareRuns([withImages, textOnly])
    expect(comparison.criteria.map((c) => c.criterion)).toEqual(['1.1.1', '3.1.2'])
    expect(comparison.criteria[0]?.usage[1]).toBeUndefined()
    const text = renderComparison(comparison, paint(false))
    expect(text).toContain('Not evaluated by B.')
    expect(comparisonMarkdown(comparison)).toContain('Not evaluated by B `groq:openai/gpt-oss-20b`.')
  })

  it('counts a corrupted copy as told apart only when its intact page passed', () => {
    const intactPass = record({ testcaseId: 'p' })
    const intactFail = record({ testcaseId: 'q', rampa: 'failed' })
    const corrupted = (testcaseId: string, corruptor: string, rampa: 'passed' | 'failed') =>
      record({ testcaseId, set: 'pair-corrupted', corruptor, expected: 'failed', rampa })
    const comparison = compareRuns([
      run('a', [intactPass, intactFail, corrupted('p', 'lang-swap', 'failed'), corrupted('q', 'lang-swap', 'failed'), corrupted('p', 'other', 'passed')]),
    ])
    const pairs = comparison.criteria[0]?.pairs
    expect(pairs?.map((pair) => [pair.corruptor, pair.results[0]?.toldApart, pair.results[0]?.total])).toEqual([
      ['lang-swap', 1, 2],
      ['other', 0, 1],
    ])
    expect(comparison.criteria[0]?.sets.map((set) => set.label)).toEqual(['ACT off6ek (semantic)', 'pairs (intact + corrupted)'])
  })

  it('puts syntax rules before meaning and names runs that share a model by what differs', () => {
    const records = [record({ ruleId: 'off6ek', ruleKind: 'semantic' }), record({ ruleId: 'de46e4', ruleKind: 'syntax' })]
    const on = run('on', records, { model: 'ollama:a', llm: true, verify: true, runs: 1, createdAt: '2026-10-08T02:03:41.000Z' })
    const off = run('off', records, { model: 'ollama:a', llm: true, verify: false, runs: 1, createdAt: '2026-10-08T02:03:46.000Z' })
    const again = run('again', records, { model: 'ollama:a', llm: true, verify: true, runs: 1, createdAt: '2026-10-09T10:00:00.000Z' })
    expect(compareRuns([on, off]).runs.map((r) => r.label)).toEqual(['ollama:a (verification on)', 'ollama:a (verification off)'])
    expect(compareRuns([on, again]).runs.map((r) => r.label)).toEqual(['ollama:a (2026-10-08 02:03 UTC)', 'ollama:a (2026-10-09 10:00 UTC)'])
    expect(compareRuns([on, off]).criteria[0]?.sets.map((set) => set.label)).toEqual(['ACT de46e4 (syntax)', 'ACT off6ek (semantic)'])
    const baseline = compareRuns([run('base', records, { llm: false, verify: true, runs: 1 })]).runs[0]
    expect(baseline).toMatchObject({ label: 'baseline (axe-core)', model: undefined, llm: false, costUsd: undefined })
  })

  it('warns when the runs used different ACT test case files, and pairs only two runs', () => {
    const records = [record()]
    const comparison = compareRuns([
      run('a', records, { model: 'ollama:a', actSha256: 'a'.repeat(64) }),
      run('b', records, { model: 'ollama:b', actSha256: 'b'.repeat(64) }),
      run('c', records, { model: 'ollama:c', actSha256: 'b'.repeat(64) }),
    ])
    expect(comparison.warnings[0]).toBe('The runs used different ACT test case files (A aaaaaaaa, B bbbbbbbb, C bbbbbbbb), so a set may hold different pages.')
    expect(comparison.paired).toBeUndefined()
    expect(renderComparison(comparison, paint(false))).not.toContain('Paired comparison')
  })
})

describe('rendering', () => {
  it('prints scores with intervals, pairs, judgment, cost and the paired test in the terminal', async () => {
    const text = renderComparison(compareRuns(await Promise.all([GEMMA, LUNA].map(loadRun))), paint(false))
    expect(text).toContain('rampa compare · 2 runs · WCAG 3.1.2')
    expect(text).toMatch(/A {2}ollama:gemma4:12b\n {5}2026-10-08 02:13 UTC · 37 cases · 1 judgment per candidate · verification on · ACT a9a1483e/)
    expect(text).toMatch(/ACT off6ek \(semantic\) +A +13 {2}0\.75 \(0\.30–0\.95\) {4}0\.75 \(0\.30–0\.95\) {2}0\.75/)
    expect(text).toMatch(/lang-swap +A +4\/5 \(0\.38–0\.96\)/)
    expect(text).toMatch(/A +26 +0 +0 {2}26 \+ 0 +3\.8/)
    expect(text).toMatch(/B {4}26 \+ 0 +14\.8k \/ 3\.3k +2\.6 {2}≈ US\$ 0\.0032/)
    expect(text).toContain('local model, no API cost')
    expect(text).toMatch(/3\.1\.2 +37 +34 +1 +1 +1 +1\.000/)
    expect(text).toContain('Passed Example 4 · expected passed · A failed ✗ · B passed ✓')
    expect(text).toContain('a large p means these cases cannot tell the runs apart, not that the runs are equally good')
  })

  it('writes the same numbers as Markdown tables', async () => {
    const markdown = comparisonMarkdown(compareRuns(await Promise.all([GEMMA, LUNA].map(loadRun))))
    expect(markdown).toContain('| Run | Model | Date | Cases | Judgments per candidate | Verification | ACT test cases |')
    expect(markdown).toContain('### WCAG 3.1.2 (AA) — Language of Parts')
    expect(markdown).toContain('| Set | Run | n | Precision (95% CI) | Recall (95% CI) | F1 |\n| --- | --- | ---: | --- | --- | ---: |')
    expect(markdown).toContain('| ACT off6ek (semantic) | A `ollama:gemma4:12b` | 13 | 0.75 (0.30–0.95) | 0.75 (0.30–0.95) | 0.75 |')
    expect(markdown).toContain('| `lang-swap` | A `ollama:gemma4:12b` | 4/5 (0.38–0.96) |')
    expect(markdown).toContain('| 3.1.2 | 37 | 34 | 1 | 1 | 1 | 1.000 |')
    expect(markdown).toMatch(/\| 3\.1\.2 \| ACT off6ek \(semantic\) \| \[Passed Example 4\]\(https:\/\/www\.w3\.org\/[^)]+\) \| passed \| failed \| passed \|/)
  })

  it('keeps a table intact when a title has a pipe or a URL has parentheses', () => {
    const odd = record({ title: 'Cats | dogs', url: 'https://example.test/a (1).html' })
    const comparison = compareRuns([run('a', [odd]), run('b', [{ ...odd, rampa: 'failed' }], { model: 'ollama:b' })])
    expect(comparisonMarkdown(comparison)).toContain('[Cats \\| dogs](https://example.test/a%20%281%29.html)')
  })
})

describe('rampa compare', () => {
  let dir: string
  let stdout: string
  let stderr: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'rampa-compare-cli-'))
    stdout = ''
    stderr = ''
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      stdout += String(chunk)
      return true
    })
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
      stderr += String(chunk)
      return true
    })
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(dir, { recursive: true, force: true })
  })

  it('prints the terminal view and writes Markdown and JSON files', async () => {
    const markdown = join(dir, 'tables', 'compare.md')
    const json = join(dir, 'compare.json')
    expect(await runCompare([GEMMA, join(LUNA, 'summary.json')], { markdown, json })).toBe(0)
    expect(stdout).toContain('Paired comparison of A and B on 37 shared cases')
    expect(await readFile(markdown, 'utf8')).toContain('### Paired comparison of A `ollama:gemma4:12b` and B `openai:gpt-6-luna`')
    const written = JSON.parse(await readFile(json, 'utf8')) as { schemaVersion: number; runs: Array<{ label: string }> }
    expect(written.schemaVersion).toBe(1)
    expect(written.runs.map((r) => r.label)).toEqual(['ollama:gemma4:12b', 'openai:gpt-6-luna'])
    expect(stderr).toContain(`markdown: ${markdown}`)
  })

  it('prints only Markdown or only JSON when asked, so the output can be piped', async () => {
    await runCompare([GEMMA, LUNA], { markdown: true })
    expect(stdout.startsWith('Rampa eval runs compared')).toBe(true)
    stdout = ''
    await runCompare([GEMMA, LUNA], { json: true })
    expect((JSON.parse(stdout) as { paired: { all: { shared: number } } }).paired.all.shared).toBe(37)
  })

  it('refuses ambiguous or missing input', async () => {
    await expect(runCompare([GEMMA, LUNA], { markdown: true, json: true })).rejects.toThrow(/Only one of --markdown and --json/)
    await mkdir(join(dir, 'a-run'))
    await expect(runCompare([LUNA], { markdown: join(dir, 'a-run') })).rejects.toThrow(/--markdown takes a file name, and .* is a directory/)
    await expect(runCompare([join(dir, 'nope')], {})).rejects.toThrow(/Run not found/)
  })
})
