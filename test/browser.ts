import { type Browser, chromium } from 'playwright-core'
import { errorMessage } from '../src/core/util.ts'

export type TestBrowser = { browser: Browser; channel: string | undefined; executablePath: string | undefined } | { skip: string }

/**
 * The browser the integration tests drive: RAMPA_BROWSER_PATH or RAMPA_BROWSER_CHANNEL when
 * set (CI sets chrome), else Microsoft Edge, then Chrome, then Playwright's own Chromium.
 * Without any, the tests are skipped and `skip` says why.
 */
export async function launchTestBrowser(what: string): Promise<TestBrowser> {
  const executablePath = process.env.RAMPA_BROWSER_PATH
  if (executablePath) {
    try {
      return { browser: await chromium.launch({ executablePath, headless: true }), channel: undefined, executablePath }
    } catch (error) {
      return { skip: `Skipping ${what}: could not start RAMPA_BROWSER_PATH=${executablePath} (${errorMessage(error)}).` }
    }
  }
  const preferred = process.env.RAMPA_BROWSER_CHANNEL
  const failures: string[] = []
  for (const channel of preferred ? [preferred] : ['msedge', 'chrome', 'chromium']) {
    try {
      const browser = await chromium.launch({ channel: channel === 'chromium' ? undefined : channel, headless: true })
      return { browser, channel, executablePath: undefined }
    } catch (error) {
      failures.push(`${channel}: ${errorMessage(error)}`)
    }
  }
  return { skip: `Skipping ${what}: no browser started (${failures.join('; ')}). Install Microsoft Edge or Chrome, or set RAMPA_BROWSER_CHANNEL or RAMPA_BROWSER_PATH.` }
}
