import type { CheckPageOptions } from '../api/page.ts'
import type { Report } from '../core/types.ts'
import { summarize } from './format.ts'

/** What a test gets as `rampa`. */
export interface RampaHelper<Page> {
  /**
   * Checks the test's page as it is now, or `options.page`, with the `rampaOptions`
   * fixture under these options. The JSON report is attached to the test, and a one-line
   * summary of its coverage is added to the test's annotations.
   */
  check(options?: CheckPageOptions & { page?: Page | undefined }): Promise<Report>
}

/** The fixtures `test.extend<RampaFixtures>(rampaFixtures)` adds. */
export interface RampaFixtures<Page> {
  rampa: RampaHelper<Page>
  /** Defaults for every check, set with `test.use({ rampaOptions })` or `use` in playwright.config. */
  rampaOptions: CheckPageOptions
}

/** The part of Playwright's TestInfo the fixture uses. */
export interface TestInfoLike {
  attach(name: string, options: { body: string; contentType: string }): Promise<void>
  annotations: Array<{ type: string; description?: string | undefined }>
}

type RampaFixture<Page> = (
  fixtures: { page: Page; rampaOptions: CheckPageOptions },
  use: (helper: RampaHelper<Page>) => Promise<void>,
  testInfo: TestInfoLike,
) => Promise<void>

/** Fixture definitions for @playwright/test's `test.extend`, written without importing it: it is an optional peer dependency. */
export function createFixtures<Page>(checkPage: (page: Page, options?: CheckPageOptions) => Promise<Report>): {
  rampaOptions: [CheckPageOptions, { option: true }]
  rampa: RampaFixture<Page>
} {
  return {
    rampaOptions: [{}, { option: true }],
    // Playwright reads which fixtures this one needs from the destructured first parameter, so it must stay destructured.
    rampa: async ({ page, rampaOptions }, use, testInfo) => {
      let checks = 0
      await use({
        async check(options = {}) {
          const { page: target = page, ...rest } = options
          const report = await checkPage(target, { ...rampaOptions, ...rest })
          checks++
          await testInfo.attach(checks === 1 ? 'rampa-report.json' : `rampa-report-${checks}.json`, {
            body: `${JSON.stringify(report, null, 2)}\n`,
            contentType: 'application/json',
          })
          testInfo.annotations.push({ type: 'rampa', description: summarize(report) })
          return report
        },
      })
    },
  }
}
