import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { FAILURE_WORDING } from '../src/advisory/messages.ts'
import { COGNITIVE_CHECKS } from '../src/advisory/profile.ts'
import type { Advisory, AdvisorySection } from '../src/advisory/types.ts'
import type { Report } from '../src/core/types.ts'
import { COGNITIVE_VERSION, type CogaData, OBSERVE_VARIANT, REDUCE_VARIANT } from '../src/probes/cognitive-kit.ts'
import { cognitiveProbe } from '../src/probes/cognitive.ts'
import { A11ySnapshotSchema, type A11yNode, type A11ySnapshot } from '../src/snapshot/schema.ts'
import { collectInPage } from '../src/surfaces/in-page.ts'
import { launchBrowser } from '../src/surfaces/web.ts'
import { profileOf } from './coga-helpers.ts'

/**
 * The checks that observe the live page (coga/reduced-motion, coga/interruptions, coga/layout-shift,
 * coga/paste-blocked), on their fixtures in a real browser: test/fixtures/coga/<check>/{fail,pass}/<page>.html, each
 * with a .json sidecar listing the results its own check must give. A pass page must give none from its check. The
 * page is collected, then observed as `--profile cognitive` does (both loads, 3 s after the load event, which the
 * fixtures' timings fit), and the checks read the records. Skipped without Chrome or Edge.
 */

const WINDOW_MS = 3000
const browser = await launchBrowser().catch(() => undefined)
const context = browser ? await browser.newContext() : undefined
afterAll(async () => browser?.close(), 60_000)

async function observed(url: string): Promise<A11ySnapshot> {
  if (!browser || !context) throw new Error('no browser')
  const tab = await context.newPage()
  try {
    await tab.goto(url)
    const raw = await tab.evaluate(collectInPage, { runAxe: false, axeTags: [], axeLocale: undefined, maxNodes: 5000 })
    const snapshot: A11ySnapshot = {
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
    snapshot.observations = { probes: await cognitiveProbe(browser, url, { kinds: ['cognitive'], observeMs: WINDOW_MS }) }
    return snapshot
  } finally {
    await tab.close()
  }
}

const ROOT = 'test/fixtures/coga'
const OBSERVED = COGNITIVE_CHECKS.filter((check) => check.observes).map((check) => check.id)
const fixtures = OBSERVED.flatMap((check) =>
  ['fail', 'pass'].flatMap((kind) => {
    const folder = join(ROOT, check.replace('coga/', ''), kind)
    return readdirSync(folder)
      .filter((file) => file.endsWith('.html'))
      .map((file) => ({ check, kind, name: file.replace(/\.html$/, ''), path: join(folder, file) }))
  }),
)

/** The part of an advisory a sidecar names: the element, and what the check measured about it (a fact it does not have is left out). */
function summary(advisory: Advisory, keys: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const key of keys) {
    if (key === 'ref') out.ref = advisory.ref ?? ''
    else if (key === 'impact') out.impact = advisory.impact
    else if (key === 'confidence') out.confidence = advisory.confidence
    else if (advisory.facts?.[key] !== undefined) out[key] = String(advisory.facts[key])
  }
  return out
}
const order = (a: Record<string, string>, b: Record<string, string>) => JSON.stringify(a).localeCompare(JSON.stringify(b))

describe.skipIf(!browser)('observed checks of the cognitive profile', { timeout: 60_000 }, () => {
  it('has fail and pass pages for each check that observes the page', () => {
    for (const check of OBSERVED) {
      expect(fixtures.filter((fixture) => fixture.check === check && fixture.kind === 'fail').length).toBeGreaterThanOrEqual(4)
      expect(fixtures.filter((fixture) => fixture.check === check && fixture.kind === 'pass').length).toBeGreaterThanOrEqual(4)
    }
  })

  describe.concurrent('fixtures', () => {
    for (const fixture of fixtures) {
      it(`${fixture.check} ${fixture.kind}/${fixture.name}`, async () => {
        const sidecar = JSON.parse(readFileSync(fixture.path.replace(/\.html$/, '.json'), 'utf8')) as { results: Array<Record<string, string>> }
        const snapshot = await observed(pathToFileURL(resolve(fixture.path)).href)
        for (const record of snapshot.observations?.probes ?? []) expect({ variant: record.conditions.variant, status: record.status, reason: record.reason }).toMatchObject({ status: 'complete' })
        const section = await profileOf(snapshot)
        const own = [...section.results, ...section.belowThreshold].filter((advisory) => advisory.check === fixture.check)
        const keys = [...new Set(sidecar.results.flatMap((result) => Object.keys(result)))]
        expect(own.map((advisory) => summary(advisory, keys.length > 0 ? keys : ['ref'])).sort(order)).toEqual([...sidecar.results].sort(order))
        expect(section.checks.find((check) => check.check === fixture.check)).toMatchObject({ ran: true, maturity: 'experimental' })
        for (const advisory of own) {
          // Every observed advisory is experimental, rests on a COGA pattern and says how the page was watched.
          expect(advisory.maturity).toBe('experimental')
          expect(advisory.basis.framework).toBe('coga')
          expect(advisory.message).toContain('with no input')
        }
      })
    }
  })

  it('never activates the page, and never grants a permission', async () => {
    const snapshot = await observed(pathToFileURL(resolve(ROOT, 'interruptions/fail/permission.html')).href)
    for (const record of snapshot.observations?.probes ?? []) {
      const data = record.data as CogaData
      expect(data.activatedMs).toBe(-1)
      expect(data.permissions.map((permission) => [permission.api, permission.activated])).toEqual([
        ['notifications', false],
        ['geolocation', false],
      ])
    }
  })

  it('writes the observed advisories without failure wording, in English and Portuguese', async () => {
    const pages = ['reduced-motion/fail/spinner', 'interruptions/fail/newsletter', 'interruptions/fail/sound', 'layout-shift/fail/banner', 'paste-blocked/fail/password', 'paste-blocked/fail/no-copy']
    await Promise.all(
      pages.map(async (name) => {
        const snapshot = await observed(pathToFileURL(resolve(ROOT, `${name}.html`)).href)
        for (const locale of ['en', 'pt-BR'] as const) {
          const section: AdvisorySection = await profileOf(snapshot, { locale })
          const own = [...section.results, ...section.belowThreshold].filter((advisory) => OBSERVED.includes(advisory.check))
          expect(own.length).toBeGreaterThan(0)
          for (const advisory of own) {
            const words = advisory.message.replace(/"[^"]*"/g, '""')
            expect({ name, locale, match: FAILURE_WORDING.exec(words)?.[0] }).toEqual({ name, locale, match: undefined })
          }
          for (const note of section.notes) expect(FAILURE_WORDING.test(note)).toBe(false)
        }
      }),
    )
  })
})

// End to end through the real CLI: a page observed and saved, then the recording checked offline, with no browser.
const CLI = resolve('src/cli.ts')
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('RAMPA_')))
function rampa(cwd: string, ...args: string[]) {
  const run = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', env: { ...env, NO_COLOR: '1', RAMPA_LOCALE: 'en', RAMPA_MODEL: '' } })
  return { code: run.status, out: run.stdout, err: run.stderr }
}

describe.skipIf(!browser)('rampa check --profile cognitive on a live page', { timeout: 120_000 }, () => {
  it('saves the observation in the snapshot, and the recording gives the same advisories offline', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rampa-coga-observe-'))
    await writeFile(join(dir, 'rampa.config.json'), JSON.stringify({ coga: { observe: 3 } }))
    const page = resolve(ROOT, 'interruptions/fail/newsletter.html')
    const live = rampa(dir, 'check', page, '--no-llm', '--profile', 'cognitive', '-f', 'json', '-o', 'live.json', '--save', 'rec')
    expect(live.err).toBe('')
    const report = JSON.parse(await readFile(join(dir, 'live.json'), 'utf8')) as Report
    const recording = (await readdir(join(dir, 'rec'))).find((file) => file.endsWith('.snapshot.json')) as string
    const snapshot = A11ySnapshotSchema.parse(JSON.parse(await readFile(join(dir, 'rec', recording), 'utf8')))
    const records = snapshot.observations?.probes.filter((record) => record.kind === 'cognitive') ?? []
    expect(records.map((record) => [record.conditions.variant, record.version, record.status, record.conditions.reducedMotion ?? false])).toEqual([
      [OBSERVE_VARIANT, COGNITIVE_VERSION, 'complete', false],
      [REDUCE_VARIANT, COGNITIVE_VERSION, 'complete', true],
    ])
    expect((records[0]?.data as CogaData).windowMs).toBe(3000)
    const observedChecks = (r: Report) => (r.advisory?.results ?? []).filter((advisory) => OBSERVED.includes(advisory.check)).map((advisory) => [advisory.check, advisory.fingerprint, advisory.message])
    expect(observedChecks(report).map(([check]) => check)).toContain('coga/interruptions')

    const replay = rampa(dir, 'check', join('rec', recording), '--no-llm', '--profile', 'cognitive', '-f', 'json', '-o', 'replay.json')
    expect(replay.code).toBe(0)
    const again = JSON.parse(await readFile(join(dir, 'replay.json'), 'utf8')) as Report
    expect(observedChecks(again)).toEqual(observedChecks(report))
  })

  it('says the live page was not observed for a snapshot without the observation, and with coga.observe: 0', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rampa-coga-observe-'))
    await writeFile(join(dir, 'rampa.config.json'), JSON.stringify({ coga: { observe: 0 } }))
    const page = resolve(ROOT, 'paste-blocked/fail/password.html')
    expect(rampa(dir, 'check', page, '--no-llm', '--profile', 'cognitive', '-f', 'json', '-o', 'off.json', '--save', 'rec').code).toBe(0)
    const off = JSON.parse(await readFile(join(dir, 'off.json'), 'utf8')) as Report
    for (const check of OBSERVED) expect(off.advisory?.checks.find((summary) => summary.check === check)).toMatchObject({ ran: false, reason: 'the observation is turned off (coga.observe: 0)' })
    await writeFile(join(dir, 'rampa.config.json'), '{}')
    const recording = (await readdir(join(dir, 'rec'))).find((file) => file.endsWith('.snapshot.json')) as string
    expect(rampa(dir, 'check', join('rec', recording), '--no-llm', '--profile', 'cognitive', '-f', 'json', '-o', 'replay.json').code).toBe(0)
    const replay = JSON.parse(await readFile(join(dir, 'replay.json'), 'utf8')) as Report
    for (const check of OBSERVED) expect(replay.advisory?.checks.find((summary) => summary.check === check)?.reason).toMatch(/^the live page was not observed/)
  })
})
