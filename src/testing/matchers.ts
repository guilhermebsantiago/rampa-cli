import type { CheckPageOptions } from '../api/page.ts'
import type { Report } from '../core/types.ts'
import { type AssertOptions, asReports, assess, formatFindings, formatPassed } from './format.ts'

/** The part of a test runner's matcher context the matchers read: Playwright's, Vitest's and Jest's all have it. */
export interface MatcherState {
  isNot?: boolean | undefined
}

export interface MatcherResult {
  pass: boolean
  message: () => string
  name: string
}

export interface ToPassRampaOptions extends CheckPageOptions, AssertOptions {}

/**
 * Throws an Error with formatFindings' text when the reports do not pass: a finding at or
 * above minConfidence (any finding with failOn 'any'), or a judgment that broke. For runners
 * without expect.extend, such as a Storybook test-runner hook or node:test.
 */
export function assertRampa(reports: Report | readonly Report[], options: AssertOptions = {}): void {
  const list = asReports(reports)
  if (!list) throw new TypeError('assertRampa expects a Rampa report or an array of reports.')
  if (assess(list, options).pass) return
  const error = new Error(formatFindings(list, options))
  error.name = 'RampaAssertionError'
  throw error
}

/**
 * Matchers for `expect.extend`, the same object for @playwright/test, Vitest and Jest.
 * `checkPage` is the adapter's, so `toPassRampa` can check a page itself.
 */
export function createMatchers<Page>(checkPage: (page: Page, options?: CheckPageOptions) => Promise<Report>) {
  return {
    /** `await expect(page).toPassRampa(options)` checks the page; a report or an array of reports is assessed as it is. */
    async toPassRampa(this: MatcherState, received: Page | Report | readonly Report[], options: ToPassRampaOptions = {}): Promise<MatcherResult> {
      const reports = asReports(received)
      if (reports) return result('toPassRampa', reports.length === 1 ? 'report' : 'reports', reports, options, this?.isNot)
      if (typeof (received as { evaluate?: unknown } | null)?.evaluate !== 'function') {
        throw new TypeError('toPassRampa expects a page or a Rampa report.')
      }
      return result('toPassRampa', 'page', [await checkPage(received as Page, options)], options, this?.isNot)
    },

    /** `expect(report).toHaveNoRampaFindings()`: no finding fails and the judgment did not break. */
    toHaveNoRampaFindings(this: MatcherState, received: Report | readonly Report[], options: AssertOptions = {}): MatcherResult {
      const reports = asReports(received)
      if (!reports) throw new TypeError('toHaveNoRampaFindings expects a Rampa report or an array of reports; to check a page, use toPassRampa.')
      return result('toHaveNoRampaFindings', reports.length === 1 ? 'report' : 'reports', reports, options, this?.isNot)
    },
  }
}

function result(name: string, received: string, reports: Report[], options: AssertOptions, isNot: boolean | undefined): MatcherResult {
  const { pass } = assess(reports, options)
  const header = `expect(${received})${isNot ? '.not' : ''}.${name}()`
  return {
    pass,
    name,
    // A failed .not assertion means the reports passed, so the message says that nothing was found.
    message: () => `${header}\n\n${pass ? formatPassed(reports, options) : formatFindings(reports, options)}`,
  }
}
