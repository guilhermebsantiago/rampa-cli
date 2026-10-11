// IBM Equal Access Accessibility Checker: its rule engine (accessibility-checker-engine), injected in the page and
// run with the policy the accessibility-checker package uses by default, IBM_Accessibility. The npm package
// accessibility-checker drives this same engine through its own Puppeteer and, by default, downloads it from the
// jsDelivr CDN at run time (rule archive "latest"); the pinned engine package keeps the run reproducible and in the
// shared browser. accessibility-checker fails a scan on violations and potential violations by default; here only
// violations are failures, and potential violations are counted as review.
import { createRequire } from 'node:module'
import { chromium } from 'playwright-core'
import { addHit, openAndAnalyze, packageVersion } from '../lib/env.mjs'

const require = createRequire(import.meta.url)
const ACE = require.resolve('accessibility-checker-engine/ace.js')
const POLICY = 'IBM_Accessibility'

export async function setup({ browserPath }) {
  const browser = await chromium.launch({ executablePath: browserPath, headless: true })
  // The rule → checkpoint map comes from the engine itself.
  const probe = await browser.newPage()
  await probe.setContent('<!doctype html><html lang="en"><title>x</title><body></body></html>')
  await probe.addScriptTag({ path: ACE })
  const guideline = await probe.evaluate((policy) => {
    const checker = new ace.Checker()
    const found = checker.getGuidelines().find((g) => g.id === policy)
    return { name: found.name, checkpoints: found.checkpoints.map((cp) => ({ num: cp.num, rules: cp.rules.map((r) => ({ id: r.id, level: r.level })) })) }
  }, POLICY)
  await probe.close()
  const criteriaOf = new Map()
  for (const checkpoint of guideline.checkpoints) {
    if (!/^\d+\.\d+\.\d+$/.test(checkpoint.num)) continue
    for (const rule of checkpoint.rules) {
      const list = criteriaOf.get(rule.id) ?? []
      if (!list.includes(checkpoint.num)) list.push(checkpoint.num)
      criteriaOf.set(rule.id, list)
    }
  }
  const claimed = new Set()
  for (const checkpoint of guideline.checkpoints) {
    if (/^\d+\.\d+\.\d+$/.test(checkpoint.num) && checkpoint.rules.some((r) => r.level === 'VIOLATION')) claimed.add(checkpoint.num)
  }

  return {
    versions: {
      'accessibility-checker-engine': packageVersion(require, 'accessibility-checker-engine'),
      policy: `${POLICY} (${guideline.name})`,
      'playwright-core': packageVersion(require, 'playwright-core'),
      browser: `Microsoft Edge ${browser.version()} (headless)`,
    },
    claimed: [...claimed],
    async worker() {
      return {
        async check(page) {
          // The engine goes in as a script tag, which a page's Content Security Policy could block.
          const context = await browser.newContext({ bypassCSP: true })
          try {
            const tab = await context.newPage()
            const results = await openAndAnalyze(tab, page.url, async () => {
              await tab.addScriptTag({ path: ACE })
              return tab.evaluate(async (policy) => {
                const report = await new ace.Checker().check(document, [policy])
                return report.results.filter((r) => r.value[1] !== 'PASS').map((r) => ({ ruleId: r.ruleId, value: r.value }))
              }, POLICY)
            })
            const record = { fail: {}, review: {}, notice: {}, failRules: [], other: 0 }
            for (const result of results) {
              const [policy, confidence] = result.value
              // violation = definite; potential violation and manual = for a person; recommendations are advice.
              const key = policy === 'VIOLATION' ? (confidence === 'FAIL' ? 'fail' : 'review') : 'notice'
              const criteria = criteriaOf.get(result.ruleId) ?? []
              if (key === 'fail') {
                if (!record.failRules.includes(result.ruleId)) record.failRules.push(result.ruleId)
                if (criteria.length === 0) record.other++
              }
              for (const criterion of criteria) addHit(record[key], criterion, result.ruleId)
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
