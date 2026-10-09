import type { Browser } from 'playwright-core'
import type { Report } from '../core/types.ts'
import { emptyEngine } from '../engine/axe.ts'
import { loadEngineFor, loadSnapshot, resolveTargets } from '../surfaces/targets.ts'
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
      } else {
        collected = { snapshot: await loadSnapshot(target.path), engine: (await loadEngineFor(target.path)) ?? emptyEngine() }
      }
      reports.push(await judge(collected, settings))
    }
  } finally {
    await launched?.close()
  }
  return reports
}
