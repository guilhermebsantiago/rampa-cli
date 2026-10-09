import { execFile } from 'node:child_process'
import { chromium } from 'playwright-core'
import { describe, expect, it } from 'vitest'
import { errorMessage } from '../src/core/util.ts'

/**
 * Integration: runs test/playwright-runner/shop.pw.ts with @playwright/test itself, so the
 * fixture and the matchers are exercised by the real runner (fixture parsing, test.use,
 * expect.extend, attachments). Skipped, with the reason printed, when no browser starts.
 */
async function browserMissing(): Promise<string | undefined> {
  const executablePath = process.env.RAMPA_BROWSER_PATH
  const channel = process.env.RAMPA_BROWSER_CHANNEL ?? 'msedge'
  try {
    const browser = await chromium.launch(executablePath ? { executablePath, headless: true } : { channel: channel === 'chromium' ? undefined : channel, headless: true })
    await browser.close()
    return undefined
  } catch (error) {
    return `Skipping the @playwright/test run: could not start ${executablePath ?? channel} (${errorMessage(error)}). Install Microsoft Edge, or set RAMPA_BROWSER_CHANNEL or RAMPA_BROWSER_PATH.`
  }
}

const skip = await browserMissing()
if (skip) console.warn(skip)

interface JsonResult {
  status: string
  error?: { message?: string }
  attachments: Array<{ name: string; contentType: string; body?: string }>
}
interface JsonSpec {
  title: string
  tests: Array<{ expectedStatus: string; annotations: Array<{ type: string; description?: string }>; results: JsonResult[] }>
}
interface JsonSuite {
  specs?: JsonSpec[]
  suites?: JsonSuite[]
}

/** The JSON reporter's output; the runner exits 1 when a test fails unexpectedly, and the report is complete either way. */
function runPlaywright(): Promise<{ stats: { expected: number; unexpected: number }; suites: JsonSuite[] }> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      ['node_modules/@playwright/test/cli.js', 'test', '-c', 'test/playwright-runner/playwright.config.ts', '--reporter=json'],
      { maxBuffer: 50_000_000 },
      (error, stdout) => {
        if (error && error.code !== 1) return reject(error)
        try {
          resolve(JSON.parse(stdout))
        } catch {
          reject(new Error(`The runner printed no JSON report:\n${stdout.slice(0, 2000)}`))
        }
      },
    )
  })
}

function specs(suites: JsonSuite[]): Map<string, JsonSpec['tests'][number]> {
  const found = new Map<string, JsonSpec['tests'][number]>()
  const walk = (suite: JsonSuite) => {
    for (const spec of suite.specs ?? []) if (spec.tests[0]) found.set(spec.title, spec.tests[0])
    for (const child of suite.suites ?? []) walk(child)
  }
  suites.forEach(walk)
  return found
}

describe.skipIf(skip !== undefined)('a real @playwright/test run', () => {
  it('extends test and expect with Rampa, gives tests the rampa fixture, and prints each finding', { timeout: 180_000 }, async () => {
    const report = await runPlaywright()
    expect(report.stats).toMatchObject({ expected: 3, unexpected: 0 })
    const tests = specs(report.suites)

    expect(tests.get('a clean component passes')?.results[0]?.status).toBe('passed')

    const fixture = tests.get('the rampa fixture checks the page and attaches the report')
    const attachment = fixture?.results[0]?.attachments.find((a) => a.name === 'rampa-report.json')
    expect(attachment?.contentType).toBe('application/json')
    const attached = JSON.parse(Buffer.from(attachment?.body ?? '', 'base64').toString('utf8'))
    expect(attached).toMatchObject({ target: 'https://shop.test/cart', scope: { include: ['#newsletter'], exclude: [] }, llm: 'off', findings: [] })
    expect(fixture?.annotations).toContainEqual({ type: 'rampa', description: expect.stringMatching(/^0 findings · judged: none · not checked automatically: \d+ of 50 WCAG 2\.1 A\/AA criteria · judgment off \(noLlm\)$/) })

    const failing = tests.get('a failing component lists each finding')
    expect(failing?.expectedStatus).toBe('failed')
    const message = failing?.results[0]?.error?.message ?? ''
    expect(message).toContain('expect(report).toHaveNoRampaFindings()\n\nRampa: 3 failures in https://shop.test/cart (scope: #cart)')
    expect(message).toContain('2. WCAG 2.4.4 (A) — Link Purpose (In Context)\n   Element:   #cart > p > a')
    expect(message).toContain('   Evidence:  "Click here"\n   Patch:     - <a href="/shipping">Click here</a>\n              + <a href="/shipping">Shipping and returns</a>')
    expect(message).toContain('This report does not declare the page accessible.')
  })
})
