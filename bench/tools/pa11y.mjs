// Pa11y with one runner: HTML_CodeSniffer (its default) or axe. Pa11y's own defaults otherwise (WCAG2AA, its
// viewport, waiting for the network to go idle), with warnings and notices included so they can be counted (warnings as
// review); Pa11y's own report leaves both out by default. Pa11y drives its own Puppeteer, pointed at the same Edge.
import { createRequire } from 'node:module'
import pa11y from 'pa11y'
import { addHit, criterionFromAxeTag, packageVersion } from '../lib/env.mjs'

const require = createRequire(import.meta.url)
const pa11yRequire = createRequire(require.resolve('pa11y'))

/** WCAG2AA.Principle1.Guideline1_1.1_1_1.H37 → 1.1.1; Section 508 and other codes → none. */
function htmlcsCriterion(code) {
  const match = /^WCAG2A{1,3}\.Principle\d\.Guideline\d_\d+\.(\d)_(\d+)_(\d+)/.exec(code)
  return match ? `${match[1]}.${match[2]}.${match[3]}` : undefined
}

export async function setup({ browserPath, runner }) {
  const puppeteer = pa11yRequire('puppeteer')
  const browser = await puppeteer.launch({ executablePath: browserPath, headless: true })
  // The axe runner uses Pa11y's own axe-core; its rules' tags map them to criteria.
  const axe = runner === 'axe' ? pa11yRequire('axe-core') : undefined
  const axeTags = new Map(axe ? axe.getRules().map((rule) => [rule.ruleId, rule.tags]) : [])
  const criteriaOf = (code) => (runner === 'axe' ? (axeTags.get(code) ?? []).map(criterionFromAxeTag).filter(Boolean) : [htmlcsCriterion(code)].filter(Boolean))
  const versions = {
    pa11y: packageVersion(require, 'pa11y'),
    runner: runner === 'axe' ? `axe-core ${axe.version} (Pa11y's own)` : `HTML_CodeSniffer ${packageVersion(pa11yRequire, '@pa11y/html_codesniffer')} (@pa11y/html_codesniffer)`,
    standard: 'WCAG2AA',
    puppeteer: packageVersion(pa11yRequire, 'puppeteer'),
    browser: `Microsoft Edge ${(await browser.version()).replace(/^[^/]*\//, '')} (headless)`,
  }
  const claimed = new Set()
  // Pa11y runs axe-core with these tags only (runners/axe.js), so WCAG 2.2's own rules never run.
  const runOnly = ['wcag2a', 'wcag21a', 'wcag2aa', 'wcag21aa']
  if (axe) {
    for (const rule of axe.getRules()) {
      if (!rule.tags.some((tag) => runOnly.includes(tag))) continue
      for (const tag of rule.tags) if (criterionFromAxeTag(tag)) claimed.add(criterionFromAxeTag(tag))
    }
  }
  return {
    versions,
    get claimed() {
      return [...claimed]
    },
    async worker() {
      return {
        async check(page) {
          const result = await pa11y(page.url, { browser, runners: [runner], standard: 'WCAG2AA', includeWarnings: true, includeNotices: true, log: { debug() {}, info() {}, error() {} } })
          const record = { fail: {}, review: {}, notice: {}, failRules: [], other: 0 }
          for (const issue of result.issues) {
            // Pa11y's own levels. HTML_CodeSniffer raises its notices ("Check that...") on nearly every page whatever
            // it holds, so notices are kept apart from review and not scored.
            const key = issue.type === 'error' ? 'fail' : issue.type === 'warning' ? 'review' : 'notice'
            const criteria = criteriaOf(issue.code)
            if (runner === 'htmlcs') for (const criterion of criteria) claimed.add(criterion)
            if (key === 'fail' && !record.failRules.includes(issue.code)) {
              record.failRules.push(issue.code)
              if (criteria.length === 0) record.other++
            }
            // HTML_CodeSniffer's notices are only counted: there are dozens on every page.
            if (key === 'notice' && runner === 'htmlcs') {
              record.notices = (record.notices ?? 0) + 1
              continue
            }
            for (const criterion of criteria) addHit(record[key], criterion, runner === 'htmlcs' ? issue.code.split('.').slice(4).join('.') || issue.code : issue.code)
          }
          if (runner === 'htmlcs') delete record.notice
          return record
        },
        async close() {},
      }
    },
    async close() {
      await browser.close()
    },
  }
}
