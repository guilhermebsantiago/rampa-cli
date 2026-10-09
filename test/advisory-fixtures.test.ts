import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import type { CogaSettings } from '../src/advisory/check.ts'
import type { Advisory } from '../src/advisory/types.ts'
import type { A11yNode, A11ySnapshot } from '../src/snapshot/schema.ts'
import { collectInPage } from '../src/surfaces/in-page.ts'
import { launchBrowser } from '../src/surfaces/web.ts'
import { profileOf } from './coga-helpers.ts'

/**
 * The fixtures of the cognitive profile, loaded in a real browser so the collector's attributes and texts
 * are what the checks read: test/fixtures/coga/<check>/{fail,pass}/<page>.html, each with a .json sidecar
 * listing the results the check must give. A pass page must give none: those are the negative controls,
 * fields and texts that must never be flagged. Skipped without Chrome or Edge.
 *
 * One page loads every fixture in turn and runs the collector without axe-core: the checks read only the
 * snapshot, and a context per fixture would slow the other browser suites that run alongside.
 */

const browser = await launchBrowser().catch(() => undefined)
const tab = browser ? await (await browser.newContext()).newPage() : undefined
afterAll(async () => browser?.close(), 60_000)

async function snapshotOf(url: string): Promise<A11ySnapshot> {
  if (!tab) throw new Error('no browser')
  await tab.goto(url)
  const raw = await tab.evaluate(collectInPage, { runAxe: false, axeTags: [], axeLocale: undefined, maxNodes: 5000 })
  return {
    schemaVersion: 1,
    surface: 'web',
    target: url,
    title: raw.title,
    locale: raw.lang,
    viewport: raw.viewport,
    root: raw.root as A11yNode,
    truncated: raw.truncated,
    collectedAt: new Date().toISOString(),
    collector: { name: 'test', version: '0' },
  }
}

interface Sidecar {
  results: Array<Record<string, string>>
  notes?: number
  coga?: CogaSettings
}

const ROOT = 'test/fixtures/coga'
const fixtures = readdirSync(ROOT, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .flatMap((check) =>
    ['fail', 'pass'].flatMap((kind) => {
      const folder = join(ROOT, check.name, kind)
      return readdirSync(folder)
        .filter((file) => file.endsWith('.html'))
        .map((file) => ({ check: `coga/${check.name}`, kind, name: file.replace(/\.html$/, ''), path: join(folder, file) }))
    }),
  )

/** The part of an advisory a sidecar names: the element or token, and what the check said about it. */
function summary(advisory: Advisory, keys: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const key of keys) {
    if (key === 'ref') out.ref = advisory.ref ?? ''
    else if (key === 'subject') out.subject = advisory.subject ?? ''
    else if (key === 'kind') out.kind = advisory.kind
    else if (key === 'impact') out.impact = advisory.impact
    else if (key === 'confidence') out.confidence = advisory.confidence
    else out[key] = String(advisory.facts?.[key] ?? '')
  }
  return out
}

const order = (a: Record<string, string>, b: Record<string, string>) => JSON.stringify(a).localeCompare(JSON.stringify(b))

describe.skipIf(!browser)('cognitive profile fixtures', { timeout: 30_000 }, () => {
  it('has fail and pass pages for each of the four checks', () => {
    for (const check of ['coga/input-formats', 'coga/visible-labels', 'coga/preselected-cost', 'coga/abbreviations']) {
      expect(fixtures.filter((fixture) => fixture.check === check && fixture.kind === 'fail').length).toBeGreaterThanOrEqual(3)
      expect(fixtures.filter((fixture) => fixture.check === check && fixture.kind === 'pass').length).toBeGreaterThanOrEqual(4)
    }
  })

  for (const fixture of fixtures) {
    it(`${fixture.check} ${fixture.kind}/${fixture.name}`, async () => {
      if (!browser) return
      const sidecar = JSON.parse(readFileSync(fixture.path.replace(/\.html$/, '.json'), 'utf8')) as Sidecar
      const section = await profileOf(await snapshotOf(pathToFileURL(resolve(fixture.path)).href), { coga: sidecar.coga })
      const own = [...section.results, ...section.belowThreshold].filter((advisory) => advisory.check === fixture.check)
      const keys = Object.keys(sidecar.results[0] ?? { ref: '' })
      expect(own.map((advisory) => summary(advisory, keys)).sort(order)).toEqual([...sidecar.results].sort(order))
      expect(section.checks.find((check) => check.check === fixture.check)?.ran).toBe(true)
      if (sidecar.notes !== undefined) expect(section.notes).toHaveLength(sidecar.notes)
      if (fixture.kind === 'fail') expect(own.length).toBeGreaterThan(0)
    })
  }
})
