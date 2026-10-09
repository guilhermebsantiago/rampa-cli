import { describe, expect, it } from 'vitest'
import { FAIL_ON, exitCode, failingFindings, parseFailOn } from '../src/cli/exit-code.ts'
import type { CriterionSummary, Finding, Report } from '../src/core/types.ts'
import type { Level } from '../src/wcag.ts'

function finding(level: Level | undefined, fingerprint = `f-${level}`): Finding {
  return { fingerprint, criterion: level === 'AA' ? '2.4.6' : '1.1.1', level, source: 'engine', message: 'm', confidence: 'high' }
}

function report(findings: Finding[], extra: Partial<Report> = {}): Report {
  return {
    schemaVersion: 1,
    rampaVersion: '0',
    createdAt: '2026-10-08T00:00:00.000Z',
    target: 'page.html',
    surface: 'web',
    locale: 'en',
    llm: 'off',
    engine: { name: 'axe-core', version: 'test' },
    findings,
    belowThreshold: [],
    waived: [],
    discarded: [],
    criteria: [],
    coverage: { engine: [], judged: [], notChecked: [] },
    usage: { calls: 0, cachedCalls: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0 },
    errors: [],
    ...extra,
  }
}

const summary = (extra: Partial<CriterionSummary>): CriterionSummary => ({
  criterion: '1.1.1',
  applicable: true,
  candidates: 2,
  judged: 0,
  failed: 0,
  passed: 0,
  cannotTell: 0,
  discarded: 0,
  errors: 0,
  offlineMisses: 0,
  ...extra,
})

describe('--fail-on', () => {
  it('fails on confirmed findings by default, as before', () => {
    expect(exitCode([report([finding('AA')])], 'confirmed')).toBe(1)
    expect(exitCode([report([])], 'confirmed')).toBe(0)
    // Findings below the threshold count only for "any".
    const low = report([], { belowThreshold: [finding('A')] })
    expect(exitCode([low], 'confirmed')).toBe(0)
    expect(exitCode([low], 'any')).toBe(1)
  })

  it('gates on WCAG levels: A for Level A findings, AA for what AA conformance needs', () => {
    const onlyAA = [report([finding('AA')])]
    expect(exitCode(onlyAA, 'A')).toBe(0)
    expect(exitCode(onlyAA, 'AA')).toBe(1)
    expect(exitCode([report([finding('A')])], 'A')).toBe(1)
    // A finding outside WCAG 2.1 A/AA fails "confirmed" but not a level gate.
    const outside = [report([finding(undefined)])]
    expect(exitCode(outside, 'confirmed')).toBe(1)
    expect(exitCode(outside, 'AA')).toBe(0)
    expect(failingFindings([report([finding('A'), finding('AA')])], 'AA')).toHaveLength(2)
  })

  it('never fails on findings with none, but still on a model that failed every candidate', () => {
    expect(exitCode([report([finding('A')])], 'none')).toBe(0)
    expect(exitCode([report([finding('A')])], 'never')).toBe(0)
    const broken = report([], { criteria: [summary({ errors: 2, judged: 0 })] })
    expect(exitCode([broken], 'none')).toBe(2)
    const partial = report([], { criteria: [summary({ errors: 1, judged: 1 })] })
    expect(exitCode([partial], 'confirmed')).toBe(0)
  })

  it('reads the policy in any case and rejects the rest', () => {
    expect(parseFailOn('aa')).toBe('AA')
    expect(parseFailOn(' A ')).toBe('A')
    expect(parseFailOn('NONE')).toBe('none')
    expect(() => parseFailOn('AAA')).toThrow(`Allowed choices are ${FAIL_ON.join(', ')}.`)
  })
})
