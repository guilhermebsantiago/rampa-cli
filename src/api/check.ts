import type { Browser } from 'playwright-core'
import type { Report } from '../core/types.ts'
import { RampaError } from '../core/util.ts'
import { locateReport, readPageSource, repositoryRoot } from '../source/locate.ts'
import { loadRecorded, resolveTargets } from '../surfaces/targets.ts'
import { type Collected, collectWeb, launchBrowser } from '../surfaces/web.ts'
import { type RampaOptions, judge, resolveSettings } from './options.ts'

export interface CheckTargetsOptions extends RampaOptions {
  /** A Playwright browser to reuse for web targets. By default Rampa starts Chrome or Edge, like the CLI, and closes it at the end. */
  browser?: Browser | undefined
  /** Save a full-page screenshot of each web target in this directory, like --screenshots. */
  screenshotDir?: string | undefined
}

/**
 * Checks URLs, .html files, folders of .html files and snapshot .json files, as
 * `rampa check` does, and returns one report per page, in order. A report never says a
 * page is accessible: `coverage` lists what was checked, what was judged and what was not.
 */
export async function check(targets: string | readonly string[], options: CheckTargetsOptions = {}): Promise<Report[]> {
  const settings = await resolveSettings(options)
  const resolved = await resolveTargets(typeof targets === 'string' ? [targets] : targets)
  const reports: Report[] = []
  // Source paths are relative to the repository root, as in rampa check.
  const root = (await repositoryRoot()) ?? process.cwd()
  let browser = options.browser
  let launched: Browser | undefined
  try {
    for (const target of resolved) {
      let collected: Collected
      if (target.kind === 'web') {
        if (!browser) browser = launched = await launchBrowser()
        collected = await collectWeb(browser, target.url, {
          runAxe: true,
          locale: settings.locale,
          screenshotDir: options.screenshotDir,
          captureImages: settings.captureImages,
        })
      } else if (target.kind === 'snapshot') {
        // A recorded snapshot or an XCUITest export, read the way the CLI reads it.
        const { snapshot, engine } = await loadRecorded(target.path, settings.locale, settings.captureImages)
        collected = { snapshot, engine }
      } else {
        throw new RampaError(
          'unsupported-target',
          `${target.label}: check() takes URLs, .html files, folders and snapshot .json files. Android devices, UI Automator dumps and screenshots need the CLI: rampa check ${target.label}`,
        )
      }
      const report = await judge(collected, settings)
      // A local page gets file:line for each finding, and its patches as edits to the file, like rampa check.
      const source = await readPageSource(collected.snapshot.target, root)
      reports.push(source ? locateReport(report, collected.snapshot, source) : report)
    }
  } finally {
    await launched?.close()
  }
  return reports
}
