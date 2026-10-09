import type { CriterionSummary, Report } from '../core/types.ts'
import { type PageDriver, collectPage } from '../surfaces/page.ts'
import { normalizeScope } from '../surfaces/scope.ts'
import { type RampaOptions, judge, resolveSettings } from './options.ts'

export interface CheckPageOptions extends RampaOptions {
  /**
   * CSS selectors of the part of the page to check, such as '#storybook-root'. Only what
   * they match is checked and judged, and the criteria about the page as a whole
   * (2.4.2 Page Titled, 3.1.1 Language of Page) are reported as not applicable.
   */
  include?: string | readonly string[] | undefined
  /** CSS selectors to leave out, such as a third-party widget. */
  exclude?: string | readonly string[] | undefined
  /** Save a full-page screenshot in this directory, like --screenshots. */
  screenshotDir?: string | undefined
  /** Elements the collector reads before it stops; the snapshot records when it stopped. Default 5000. */
  maxNodes?: number | undefined
}

/** Criteria that judge the page as a whole, its title and its default language. A component has neither. */
export const PAGE_CRITERIA: ReadonlySet<string> = new Set(['2.4.2', '3.1.1'])

/** Checks an open page through a driver; the Playwright and Puppeteer adapters are thin wrappers around it. */
export async function checkDriver(driver: PageDriver, options: CheckPageOptions = {}): Promise<Report> {
  const settings = await resolveSettings(options)
  const scope = normalizeScope(options.include, options.exclude)
  const collected = await collectPage(driver, {
    locale: settings.locale,
    maxNodes: options.maxNodes,
    screenshotDir: options.screenshotDir,
    captureImages: settings.captureImages,
    scope,
  })
  if (!scope) return judge(collected, settings)

  const component = scope.include.length > 0
  const report = await judge(collected, settings, component ? settings.criteria.filter((criterion) => !PAGE_CRITERIA.has(criterion.id)) : settings.criteria)
  // A criterion left out stays in the report as not applicable, so the coverage shows it was not judged rather than hiding it.
  const criteria = settings.criteria.map((criterion) => report.criteria.find((summary) => summary.criterion === criterion.id) ?? notApplicable(criterion.id))
  const { schemaVersion, rampaVersion, createdAt, target, ...rest } = report
  return { schemaVersion, rampaVersion, createdAt, target, scope, ...rest, criteria }
}

function notApplicable(criterion: string): CriterionSummary {
  return { criterion, applicable: false, candidates: 0, judged: 0, failed: 0, passed: 0, cannotTell: 0, discarded: 0, errors: 0, offlineMisses: 0 }
}
