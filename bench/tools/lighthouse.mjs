// Lighthouse, accessibility category only, desktop preset, on a Puppeteer page in the same Edge. Its accessibility
// audits are axe-core rules (Lighthouse runs the axe-core it depends on, with its own list of rules); each audit has
// the id of its axe-core rule, so the rule's tags give the criteria.
import { createRequire } from 'node:module'
import lighthouse from 'lighthouse'
import desktopConfig from 'lighthouse/core/config/desktop-config.js'
import { addHit, criterionFromAxeTag, packageVersion } from '../lib/env.mjs'

const require = createRequire(import.meta.url)
const lhRequire = createRequire(require.resolve('lighthouse'))

export async function setup({ browserPath }) {
  const puppeteer = lhRequire('puppeteer-core')
  const axe = lhRequire('axe-core')
  const tags = new Map(axe.getRules().map((rule) => [rule.ruleId, rule.tags]))
  const criteriaOf = (id) => (tags.get(id) ?? []).map(criterionFromAxeTag).filter(Boolean)
  let audits = []
  let browserVersion = ''
  const versions = () => ({
    lighthouse: packageVersion(require, 'lighthouse'),
    'axe-core': `${axe.version} (Lighthouse's own)`,
    config: 'desktop preset, onlyCategories: accessibility',
    'puppeteer-core': packageVersion(lhRequire, 'puppeteer-core'),
    browser: `Microsoft Edge ${browserVersion} (headless)`,
  })
  return {
    get versions() {
      return versions()
    },
    get claimed() {
      return [...new Set(audits.flatMap(criteriaOf))]
    },
    /** The audits of the accessibility category that can fail (binary), which are axe-core rules. */
    get notes() {
      return [`Lighthouse binary audits: ${audits.join(', ')}`]
    },
    async worker() {
      const browser = await puppeteer.launch({ executablePath: browserPath, headless: true })
      browserVersion = (await browser.version()).replace(/^[^/]*\//, '')
      const tab = await browser.newPage()
      return {
        async check(page) {
          const result = await lighthouse(page.url, { output: 'json', logLevel: 'error', onlyCategories: ['accessibility'] }, desktopConfig, tab)
          const lhr = result?.lhr
          if (!lhr) throw new Error('Lighthouse returned no result')
          // A run Lighthouse itself ends (NO_FCP on a page that paints nothing) gives no audits; it is recorded as an
          // error and not retried, since it happens again.
          if (lhr.runtimeError) return { error: `Lighthouse ${lhr.runtimeError.code}`, fail: {}, review: {} }
          const record = { fail: {}, review: {}, failRules: [], other: 0 }
          const binary = []
          for (const ref of lhr.categories.accessibility.auditRefs) {
            const audit = lhr.audits[ref.id]
            if (audit.scoreDisplayMode !== 'manual') binary.push(ref.id)
            if (audit.score !== 0) continue
            record.failRules.push(ref.id)
            const criteria = criteriaOf(ref.id)
            if (criteria.length === 0) record.other++
            for (const criterion of criteria) addHit(record.fail, criterion, ref.id)
          }
          if (audits.length === 0) audits = binary.sort()
          return record
        },
        async close() {
          await browser.close()
        },
      }
    },
  }
}
