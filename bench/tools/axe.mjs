// axe-core, the version Rampa ships, through Deque's own Playwright integration (@axe-core/playwright), which
// injects it into every frame. Default configuration: every rule axe-core enables by default.
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { AxeBuilder } from '@axe-core/playwright'
import { chromium } from 'playwright-core'
import { addHit, criterionFromAxeTag, openAndAnalyze, packageVersion } from '../lib/env.mjs'

const require = createRequire(import.meta.url)

/** violations and incomplete results of axe-core, by WCAG criterion through the rules' tags. */
export function readAxe(results) {
  const record = { fail: {}, review: {}, failRules: [], other: 0 }
  for (const [list, key] of [
    [results.violations, 'fail'],
    [results.incomplete, 'review'],
  ]) {
    for (const rule of list) {
      const criteria = rule.tags.map(criterionFromAxeTag).filter(Boolean)
      if (key === 'fail') record.failRules.push(rule.id)
      if (criteria.length === 0 && key === 'fail') record.other++
      for (const criterion of criteria) addHit(record[key], criterion, rule.id)
    }
  }
  return record
}

/** Criteria with at least one rule axe-core runs by default. */
export function axeClaimed(axe) {
  const excluded = new Set(axe._audit.tagExclude ?? ['experimental'])
  const claimed = new Set()
  for (const rule of axe._audit.rules) {
    if (rule.enabled === false || rule.tags.some((tag) => excluded.has(tag))) continue
    for (const tag of rule.tags) {
      const criterion = criterionFromAxeTag(tag)
      if (criterion) claimed.add(criterion)
    }
  }
  return [...claimed]
}

export async function setup({ browserPath }) {
  const axeSource = await readFile(require.resolve('axe-core/axe.min.js'), 'utf8')
  const axe = require('axe-core')
  const browser = await chromium.launch({ executablePath: browserPath, headless: true })
  return {
    versions: {
      'axe-core': axe.version,
      '@axe-core/playwright': packageVersion(require, '@axe-core/playwright'),
      'playwright-core': packageVersion(require, 'playwright-core'),
      browser: `Microsoft Edge ${browser.version()} (headless)`,
    },
    claimed: axeClaimed(axe),
    async worker() {
      return {
        async check(page) {
          const context = await browser.newContext()
          try {
            const tab = await context.newPage()
            const results = await openAndAnalyze(tab, page.url, () => new AxeBuilder({ page: tab, axeSource }).analyze())
            return readAxe(results)
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
