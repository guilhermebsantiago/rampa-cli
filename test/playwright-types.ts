/**
 * Type-checked by `pnpm typecheck`, never run: the fixture and the matchers must fit
 * @playwright/test's own types, whose Page comes from a different playwright-core version
 * than the one Rampa depends on, as it will in most projects.
 */
import type { expect as baseExpect, test as baseTest } from '@playwright/test'
import { type RampaFixtures, rampaFixtures, rampaMatchers } from '../src/playwright.ts'

declare const base: typeof baseTest
declare const expectBase: typeof baseExpect

const test = base.extend<RampaFixtures>(rampaFixtures)
const expect = expectBase.extend(rampaMatchers)

test.use({ rampaOptions: { model: 'ollama:gemma4:12b', include: '#storybook-root' } })

test('a component', async ({ page, rampa }) => {
  const report = await rampa.check({ include: '#cart', minConfidence: 'high' })
  expect(report).toHaveNoRampaFindings({ failOn: 'any' })
  await expect(page).toPassRampa({ criteria: ['1.1.1', '2.4.4'], noLlm: true, requireJudgment: false })
  const popup = await page.context().newPage()
  await rampa.check({ page: popup })
  // @ts-expect-error toHaveNoRampaFindings takes assertion options, not check options
  expect(report).toHaveNoRampaFindings({ include: '#cart' })
})
