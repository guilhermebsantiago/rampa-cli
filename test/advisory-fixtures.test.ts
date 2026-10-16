import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import type { CogaSettings } from '../src/advisory/check.ts'
import { wordingCandidates } from '../src/advisory/checks/error-wording.ts'
import { literalCandidates } from '../src/advisory/checks/literal-language.ts'
import { summaryCandidate } from '../src/advisory/checks/long-text-summary.ts'
import { readPage } from '../src/advisory/page.ts'
import { COGNITIVE_CHECKS } from '../src/advisory/profile.ts'
import type { Advisory } from '../src/advisory/types.ts'
import type { A11yNode, A11ySnapshot } from '../src/snapshot/schema.ts'
import { collectInPage } from '../src/surfaces/in-page.ts'
import { collectPresentation } from '../src/surfaces/presentation.ts'
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
const context = browser ? await browser.newContext() : undefined
const tab = context ? await context.newPage() : undefined
afterAll(async () => browser?.close(), 60_000)

async function snapshotOf(url: string): Promise<A11ySnapshot> {
  if (!tab) throw new Error('no browser')
  await tab.goto(url)
  const raw = await tab.evaluate(collectInPage, { runAxe: false, axeTags: [], axeLocale: undefined, maxNodes: 5000 })
  // What --profile cognitive measures besides the tree: how text and controls are presented, with the drawn font over CDP.
  const presentation = await collectPresentation({
    // biome-ignore lint/suspicious/noExplicitAny: Playwright's evaluate infers its argument type from a generic it cannot see here
    evaluate: <Arg, Result>(fn: (arg: Arg) => Result | Promise<Result>, arg: Arg) => tab.evaluate(fn as (arg: any) => Result | Promise<Result>, arg),
    cdp: () => tab.context().newCDPSession(tab),
  })
  return {
    schemaVersion: 1,
    surface: 'web',
    target: url,
    title: raw.title,
    locale: raw.lang,
    viewport: raw.viewport,
    root: raw.root as A11yNode,
    truncated: raw.truncated,
    presentation,
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
const PRESENTATION_CHECKS = ['line-length', 'text-alignment', 'line-height', 'text-emphasis', 'decorative-font', 'icon-only-control', 'new-window'].map((name) => `coga/${name}`)
/** Checks that read the observation of the live page: their fixtures run in coga-observe.test.ts, which observes them. */
const OBSERVED = new Set(COGNITIVE_CHECKS.filter((check) => check.observes).map((check) => check.id))
/**
 * Checks a model decides: without one they do not run, so their fixtures are read below for what the check would ask,
 * and against a real model by scripts/coga-model-fixtures.ts.
 */
const MODEL = new Set(COGNITIVE_CHECKS.filter((check) => check.review).map((check) => check.id))
const fixtures = readdirSync(ROOT, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !OBSERVED.has(`coga/${entry.name}`) && !MODEL.has(`coga/${entry.name}`))
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

  it('has fail and pass pages for each check of how text and controls are presented', () => {
    const checks = ['line-length', 'text-alignment', 'line-height', 'text-emphasis', 'decorative-font', 'icon-only-control', 'new-window']
    for (const check of checks.map((name) => `coga/${name}`)) {
      expect(fixtures.filter((fixture) => fixture.check === check && fixture.kind === 'fail').length).toBeGreaterThanOrEqual(2)
      expect(fixtures.filter((fixture) => fixture.check === check && fixture.kind === 'pass').length).toBeGreaterThanOrEqual(2)
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
      // A pass page of the presentation checks (a well-set article, short labels in capitals, a centered heading,
      // buttons with words) must stay silent for all seven of them, not only for its own.
      if (fixture.kind === 'pass' && PRESENTATION_CHECKS.includes(fixture.check)) {
        const others = [...section.results, ...section.belowThreshold].filter((advisory) => PRESENTATION_CHECKS.includes(advisory.check))
        expect(others.map((advisory) => `${advisory.check} ${advisory.ref}`)).toEqual([])
      }
    })
  }
})

interface ModelSidecar {
  results: Array<Record<string, string>>
  /** Texts of the page the check must never ask about: body prose, for coga/literal-language. */
  notAsked?: string[]
  /** coga/long-text-summary: the page is under the threshold, or a list of short texts, so nothing is asked. */
  noCandidate?: boolean
  /** coga/long-text-summary: a heading at the start says it is a summary, so no model is asked. */
  decided?: boolean
}

const modelFixtures = [...MODEL].flatMap((check) =>
  ['fail', 'pass'].flatMap((kind) => {
    const folder = join(ROOT, check.replace(/^coga\//, ''), kind)
    return readdirSync(folder)
      .filter((file) => file.endsWith('.html'))
      .map((file) => ({ check, kind, name: file.replace(/\.html$/, ''), path: join(folder, file) }))
  }),
)

describe.skipIf(!browser)('fixtures of the checks a model decides, without a model', { timeout: 30_000 }, () => {
  it('has fail and pass pages for each of them, in Portuguese and English', () => {
    for (const check of MODEL) {
      expect(modelFixtures.filter((fixture) => fixture.check === check && fixture.kind === 'fail').length).toBeGreaterThanOrEqual(3)
      expect(modelFixtures.filter((fixture) => fixture.check === check && fixture.kind === 'pass').length).toBeGreaterThanOrEqual(4)
    }
  })

  for (const fixture of modelFixtures) {
    it(`${fixture.check} ${fixture.kind}/${fixture.name}: asks about what the sidecar names, and does not run without a model`, async () => {
      if (!browser) return
      const sidecar = JSON.parse(readFileSync(fixture.path.replace(/\.html$/, '.json'), 'utf8')) as ModelSidecar
      const snapshot = await snapshotOf(pathToFileURL(resolve(fixture.path)).href)
      const section = await profileOf(snapshot)
      expect(section.checks.find((check) => check.check === fixture.check)).toMatchObject({ ran: false, review: true, reason: 'this check needs a model, and --no-llm turned the model off' })
      expect([...section.results, ...section.belowThreshold].filter((advisory) => advisory.check === fixture.check)).toEqual([])
      const page = readPage(snapshot)
      if (fixture.check === 'coga/literal-language') {
        const asked = literalCandidates(page).candidates.map((candidate) => candidate.context.text)
        for (const result of sidecar.results) expect(asked).toContain(result.subject)
        for (const text of sidecar.notAsked ?? []) expect(asked).not.toContain(text)
      } else if (fixture.check === 'coga/long-text-summary') {
        const { candidate, words } = summaryCandidate(page)
        if (sidecar.noCandidate) {
          expect(candidate).toBeUndefined()
          expect(words).toBeLessThanOrEqual(300)
        } else {
          expect(words).toBeGreaterThan(300)
          expect(Boolean(candidate?.context.marked)).toBe(Boolean(sidecar.decided))
          for (const result of sidecar.results) expect(candidate?.ref).toBe(result.ref)
        }
      } else {
        const asked = wordingCandidates(page).map((candidate) => candidate.context.text)
        for (const result of sidecar.results) expect(asked).toContain(result.subject)
        expect(asked.length).toBeGreaterThan(0)
      }
    })
  }
})
