import { readFile } from 'node:fs/promises'
import { test as base, expect as baseExpect } from '@playwright/test'
import { memoryCache } from '../../src/core/cache.ts'
import { type RampaFixtures, rampaFixtures, rampaMatchers } from '../../src/playwright.ts'
import { stubModel } from '../stub-model.ts'

// The setup docs/playwright.md describes, in a real @playwright/test run.
const test = base.extend<RampaFixtures>(rampaFixtures)
const expect = baseExpect.extend(rampaMatchers)

// Project defaults for the rampa fixture: no rampa.config, no waivers file.
test.use({ rampaOptions: { config: false, waivers: [], noLlm: true } })

// The shop from test/fixtures, behind a route mock and a signed-in session: nothing reaches the network.
test.beforeEach(async ({ context, page }) => {
  const checkout = await readFile('test/fixtures/checkout.html', 'utf8')
  await context.route('https://shop.test/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('.svg')) return route.fulfill({ body: await readFile(`examples/store${path}`), contentType: 'image/svg+xml' })
    const signedIn = ((await route.request().allHeaders()).cookie ?? '').includes('session=1')
    return route.fulfill({ body: signedIn ? checkout : '<!doctype html><title>Sign in</title><h1>Sign in</h1>', contentType: 'text/html' })
  })
  await context.addCookies([{ name: 'session', value: '1', url: 'https://shop.test' }])
  await page.goto('https://shop.test/cart')
})

test('a clean component passes', async ({ page }) => {
  await expect(page).toPassRampa({ config: false, waivers: [], cache: memoryCache(), model: stubModel(), include: '#newsletter' })
})

test('the rampa fixture checks the page and attaches the report', async ({ rampa }) => {
  const report = await rampa.check({ include: '#newsletter' })
  expect(report).toHaveNoRampaFindings()
})

test('a failing component lists each finding', async ({ rampa }) => {
  // Expected to fail: the runner's own report shows the message a team would read.
  test.fail()
  const report = await rampa.check({ include: '#cart', noLlm: false, model: stubModel(), cache: memoryCache() })
  expect(report).toHaveNoRampaFindings()
})
