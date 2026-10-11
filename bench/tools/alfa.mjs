// Siteimprove Alfa, its open-source rules (@siteimprove/alfa-rules, the default set: no experimental or deprecated
// rules), through its Playwright integration: the page as the browser built it becomes an Alfa page, and an audit
// with no oracle runs every rule. A question no one answers leaves the outcome "cantTell".
import { createRequire } from 'node:module'
import { Audit } from '@siteimprove/alfa-act'
import { Playwright } from '@siteimprove/alfa-playwright'
import rules from '@siteimprove/alfa-rules'
import { chromium } from 'playwright-core'
import { addHit, openAndAnalyze, packageVersion } from '../lib/env.mjs'

const require = createRequire(import.meta.url)

function criteriaOf(rule) {
  return rule.requirements.map((requirement) => requirement.toJSON()).filter((json) => json.type === 'criterion' && /^\d+\.\d+\.\d+$/.test(json.chapter ?? '')).map((json) => json.chapter)
}

function ruleName(rule) {
  return rule.uri.replace(/^.*\/rules\//, '')
}

export async function setup({ browserPath }) {
  const browser = await chromium.launch({ executablePath: browserPath, headless: true })
  const list = [...rules]
  const claimed = new Set(list.flatMap(criteriaOf))
  return {
    versions: {
      '@siteimprove/alfa-rules': packageVersion(require, '@siteimprove/alfa-rules'),
      '@siteimprove/alfa-act': packageVersion(require, '@siteimprove/alfa-act'),
      '@siteimprove/alfa-playwright': packageVersion(require, '@siteimprove/alfa-playwright'),
      rules: String(list.length),
      'playwright-core': packageVersion(require, 'playwright-core'),
      browser: `Microsoft Edge ${browser.version()} (headless)`,
    },
    claimed: [...claimed],
    async worker() {
      return {
        async check(page) {
          const context = await browser.newContext()
          try {
            const tab = await context.newPage()
            const alfaPage = await openAndAnalyze(tab, page.url, async () => Playwright.toPage(await tab.evaluateHandle(() => document)))
            const outcomes = await Audit.of(alfaPage, list).evaluate()
            const record = { fail: {}, review: {}, failRules: [], other: 0 }
            for (const outcome of outcomes) {
              const kind = outcome.toJSON().outcome
              const key = kind === 'failed' ? 'fail' : kind === 'cantTell' ? 'review' : undefined
              if (!key) continue
              const name = ruleName(outcome.rule)
              const criteria = criteriaOf(outcome.rule)
              if (key === 'fail' && !record.failRules.includes(name)) {
                record.failRules.push(name)
                if (criteria.length === 0) record.other++
              }
              for (const criterion of criteria) addHit(record[key], criterion, name)
            }
            return record
          } finally {
            await context.close()
          }
        },
        async close() {},
      }
    },
    async close() {
      await browser.close()
    },
  }
}
