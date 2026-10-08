import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { CriterionSummary, Finding, Report } from '../src/core/types.ts'

/** A working directory that exists on no machine, so baseline keys never depend on where tests run. */
export const CWD = process.platform === 'win32' ? 'C:\\site' : '/site'
export const fileUrl = (path: string) => pathToFileURL(join(CWD, path)).href

export function summary(criterion: string, partial: Partial<CriterionSummary> = {}): CriterionSummary {
  return { criterion, applicable: true, candidates: 3, judged: 3, failed: 1, passed: 2, cannotTell: 0, discarded: 0, errors: 0, offlineMisses: 0, ...partial }
}

/** A report of a judged run on dist/index.html, with no findings unless given. */
export function report(partial: Partial<Report> = {}): Report {
  return {
    schemaVersion: 1,
    rampaVersion: '0.0.0',
    createdAt: '2026-10-08T12:00:00.000Z',
    target: fileUrl('dist/index.html'),
    surface: 'web',
    locale: 'en',
    llm: 'on',
    model: 'test:model',
    engine: { name: 'axe-core', version: '4.14.0' },
    findings: [],
    belowThreshold: [],
    waived: [],
    discarded: [],
    criteria: [summary('1.1.1'), summary('2.4.4')],
    coverage: { engine: ['1.1.1'], judged: ['1.1.1', '2.4.4'], notChecked: [] },
    usage: { calls: 0, cachedCalls: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0 },
    errors: [],
    ...partial,
  }
}

export function engineFinding(fingerprint: string, ref: string, html: string, ruleId = 'image-alt'): Finding {
  return {
    fingerprint,
    criterion: '1.1.1',
    level: 'A',
    source: 'engine',
    ref,
    target: `["${ref}"]`,
    message: 'Images must have alternative text',
    confidence: 'high',
    ruleId,
    html,
  }
}

export function judgmentFinding(fingerprint: string, criterion: string, ref: string, subject: string): Finding {
  return { fingerprint, criterion, level: 'A', source: 'judgment', ref, subject, message: `"${subject}" fails ${criterion}`, evidence: subject, confidence: 'high' }
}
