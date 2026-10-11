// QualWeb (@qualweb/core) with the modules its command line runs by default: ACT rules, WCAG techniques and best
// practices (the counter module only counts elements). QualWeb launches its own Puppeteer, pointed at the same Edge.
import { createRequire } from 'node:module'
import { QualWeb } from '@qualweb/core'
import actRules from '@qualweb/act-rules'
import bestPractices from '@qualweb/best-practices'
import wcagTechniques from '@qualweb/wcag-techniques'
import { addHit, packageVersion } from '../lib/env.mjs'

const require = createRequire(import.meta.url)

function modules() {
  return [new actRules.ACTRules(), new wcagTechniques.WCAGTechniques(), new bestPractices.BestPractices()]
}

export async function setup({ browserPath }) {
  const claimed = new Set()
  let browserVersion
  return {
    get versions() {
      return {
        '@qualweb/core': packageVersion(require, '@qualweb/core'),
        '@qualweb/act-rules': packageVersion(require, '@qualweb/act-rules'),
        '@qualweb/wcag-techniques': packageVersion(require, '@qualweb/wcag-techniques'),
        '@qualweb/best-practices': packageVersion(require, '@qualweb/best-practices'),
        puppeteer: packageVersion(createRequire(require.resolve('@qualweb/core')), 'puppeteer'),
        browser: browserVersion ? `Microsoft Edge ${browserVersion} (headless)` : 'Microsoft Edge (headless)',
      }
    },
    get claimed() {
      return [...claimed]
    },
    async worker() {
      const qualweb = new QualWeb({ adBlock: false, stealth: false })
      await qualweb.start({ maxConcurrency: 1, timeout: 60_000 }, { headless: true, executablePath: browserPath })
      return {
        async check(page) {
          const reports = await qualweb.evaluate({ url: page.url, modules: modules() })
          const report = reports[page.url] ?? Object.values(reports)[0]
          if (!report?.modules) throw new Error(`QualWeb returned no report: ${JSON.stringify(reports).slice(0, 200)}`)
          browserVersion ??= /\/([\d.]+)/.exec(report.system?.browser?.version ?? '')?.[1] ?? report.system?.browser?.version
          const record = { fail: {}, review: {}, notice: {}, failRules: [], other: 0 }
          for (const data of Object.values(report.modules)) {
            for (const [code, assertion] of Object.entries(data.assertions ?? {})) {
              const criteria = (assertion.metadata?.['success-criteria'] ?? []).map((sc) => sc.name).filter((name) => /^\d+\.\d+\.\d+$/.test(name))
              if (!code.startsWith('QW-BP')) for (const criterion of criteria) claimed.add(criterion)
              const outcome = assertion.metadata?.outcome
              if (outcome !== 'failed' && outcome !== 'warning') continue
              // Best practices are advice related to a criterion, not conformance failures (as axe-core's
              // best-practice rules and IBM's recommendations): they are kept apart and not scored.
              const key = code.startsWith('QW-BP') ? 'notice' : outcome === 'failed' ? 'fail' : 'review'
              if (key === 'fail') {
                record.failRules.push(code)
                if (criteria.length === 0) record.other++
              }
              for (const criterion of criteria) addHit(record[key], criterion, code)
            }
          }
          return record
        },
        async close() {
          await qualweb.stop()
        },
      }
    },
  }
}
