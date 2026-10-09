import type { Browser } from 'playwright-core'
import { errorMessage } from '../src/core/util.ts'
import { launchBrowser } from '../src/surfaces/web.ts'

/**
 * The browser the CLI would use (RAMPA_BROWSER_PATH, RAMPA_BROWSER_CHANNEL,
 * Chrome, Edge or Chromium). Without one, the suite says why and is skipped,
 * so `pnpm test` still passes on a machine with no browser.
 */
export async function browserForTests(suite: string): Promise<Browser | undefined> {
  try {
    return await launchBrowser()
  } catch (error) {
    // Straight to stderr: the default reporter does not print console output of a skipped file.
    process.stderr.write(`\nSkipping ${suite}: no browser to run them (${errorMessage(error)}). Install Chrome or Edge, or set RAMPA_BROWSER_PATH.\n`)
    return undefined
  }
}
