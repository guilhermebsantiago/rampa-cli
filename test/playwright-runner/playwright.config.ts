import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineConfig } from '@playwright/test'

// Run by test/playwright-runner.test.ts. The browser is the one the other integration tests use:
// RAMPA_BROWSER_PATH, else RAMPA_BROWSER_CHANNEL, else Microsoft Edge.
const executablePath = process.env.RAMPA_BROWSER_PATH
const channel = process.env.RAMPA_BROWSER_CHANNEL ?? 'msedge'

export default defineConfig({
  testDir: '.',
  testMatch: '*.pw.ts',
  workers: 1,
  retries: 0,
  outputDir: join(tmpdir(), 'rampa-playwright-results'),
  use: {
    headless: true,
    viewport: { width: 1280, height: 800 },
    ...(executablePath ? { launchOptions: { executablePath } } : channel === 'chromium' ? {} : { channel }),
  },
})
