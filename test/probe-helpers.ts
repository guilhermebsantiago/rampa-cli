import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { memoryCache } from '../src/core/cache.ts'
import type { CheckOptions } from '../src/core/check.ts'
import type { Report } from '../src/core/types.ts'

export const fixture = (name: string) => pathToFileURL(resolve('test/fixtures/probes', name)).href

export const probeCheckOptions = (overrides: Partial<CheckOptions> = {}): CheckOptions => ({
  criteria: [],
  llm: false,
  provider: undefined,
  runs: 1,
  cache: memoryCache(),
  offline: false,
  locale: 'en',
  minConfidence: 'low',
  concurrency: 1,
  ...overrides,
})

export const byRule = (report: Report, rule: string) => report.findings.filter((f) => f.ruleId === rule)
export const reviewByRule = (report: Report, rule: string) => (report.needsReview ?? []).filter((f) => f.ruleId === rule)

