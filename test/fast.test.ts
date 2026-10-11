import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Command } from 'commander'
import type { Browser } from 'playwright-core'
import { afterAll, describe, expect, it } from 'vitest'
import { resolveSettings } from '../src/api/options.ts'
import { withConfigOptions, withFastPreset } from '../src/cli/config-options.ts'
import { DEFAULT_MAX_CANDIDATES, loweredCap } from '../src/core/check.ts'
import { FAST, fastCollectOptions, fastCollection, fastCoverage, fastLine } from '../src/core/fast.ts'
import type { Report } from '../src/core/types.ts'
import { resolveCriteria } from '../src/criteria/index.ts'
import { walkTree } from '../src/snapshot/tree.ts'
import { collectWeb } from '../src/surfaces/web.ts'
import { launchTestBrowser } from './browser.ts'

const DEFAULTS = resolveCriteria(['1.1.1', '1.3.5', '2.4.2', '2.4.4', '2.4.6', '3.1.1', '3.1.2', '3.3.2'])

describe('the --fast preset on the command line', () => {
  const parse = (args: string[], config: Parameters<typeof withFastPreset>[2] = {}) => {
    const command = new Command()
      .exitOverride()
      .option('--max-candidates <n>', 'cap', String(DEFAULT_MAX_CANDIDATES))
      .option('--follow-links <policy>', 'links', 'same-origin')
      .option('--fast', 'fast')
      .option('--no-fast', 'not fast')
    command.parse(args, { from: 'user' })
    return withFastPreset(command, withConfigOptions(command, command.opts(), config), config) as { maxCandidates: string; followLinks: string; fast: boolean }
  }

  it('fills in what the run left at the defaults', () => {
    expect(parse(['--fast'])).toEqual({ maxCandidates: String(FAST.maxCandidates), followLinks: 'none', fast: true })
    expect(parse([])).toEqual({ maxCandidates: String(DEFAULT_MAX_CANDIDATES), followLinks: 'same-origin', fast: false })
  })

  it('keeps what the command line or the config set', () => {
    expect(parse(['--fast', '--max-candidates', '30', '--follow-links', 'all'])).toEqual({ maxCandidates: '30', followLinks: 'all', fast: true })
    expect(parse(['--fast'], { maxCandidates: 25 })).toEqual({ maxCandidates: '25', followLinks: 'none', fast: true })
  })

  it('takes fast: true from the config, and --no-fast turns it off', () => {
    expect(parse([], { fast: true })).toMatchObject({ maxCandidates: String(FAST.maxCandidates), fast: true })
    expect(parse(['--no-fast'], { fast: true })).toEqual({ maxCandidates: String(DEFAULT_MAX_CANDIDATES), followLinks: 'same-origin', fast: false })
  })

  it('leaves a command without --fast alone', () => {
    const command = new Command().exitOverride().option('--max-candidates <n>', 'cap', '50')
    command.parse([], { from: 'user' })
    expect(withFastPreset(command, command.opts(), { fast: true })).toEqual({ maxCandidates: '50' })
  })
})

describe("fast mode's coverage line", () => {
  const run = { criteria: DEFAULTS, llm: true, probes: 0, linksSkipped: true, maxCandidates: 10, web: true }

  it('lists what it left out and the limits it lowered', () => {
    expect(fastCoverage(run)).toEqual({
      skipped: ['probes', 'link-following', 'ocr', 'pixel-contrast', 'css-backgrounds'],
      maxCandidates: 10,
      imageLimit: FAST.imageLimit,
      settleCapMs: FAST.settleCapMs,
    })
    expect(fastLine(fastCoverage(run), 'en')).toEqual({
      label: 'Fast mode (--fast):',
      text: "left out probes, link following (2.4.4 judged from text and context), OCR (1.4.5), contrast from pixels (axe-core's undecided contrast stays to review), CSS background captures; lowered to at most 10 candidates per criterion, 10 image captures, 1 s of waiting after load",
    })
    expect(fastLine(fastCoverage(run), 'pt-BR').text).toContain('deixou de fora sondas, leitura dos destinos dos links')
  })

  it('never lists what ran, or what a run without --fast would not do either', () => {
    // Probes named on the command line ran; links were read; 1.4.5 was judged, with OCR.
    expect(fastCoverage({ ...run, probes: 2, linksSkipped: false, criteria: resolveCriteria(['1.4.5']) }).skipped).toEqual(['pixel-contrast'])
    // Without the judgment layer no image is captured and no link is read, fast or not.
    expect(fastCoverage({ ...run, llm: false })).toEqual({ skipped: ['probes', 'pixel-contrast'], settleCapMs: FAST.settleCapMs })
    // A recorded snapshot was not loaded: no wait, no capture, no pixels.
    expect(fastCoverage({ ...run, web: false })).toEqual({ skipped: ['probes', 'link-following', 'ocr'], maxCandidates: 10 })
    // A cap set at or above the default is not a lowered one.
    expect(loweredCap(DEFAULT_MAX_CANDIDATES)).toBeUndefined()
    expect(loweredCap(0)).toBeUndefined()
    expect(loweredCap(12)).toBe(12)
  })

  it('captures CSS backgrounds only when 1.4.5 reads them', () => {
    expect(fastCollectOptions(fastCollection(DEFAULTS))).toEqual({
      settle: { capMs: FAST.settleCapMs },
      imageCapture: { limit: FAST.imageLimit, backgrounds: 0 },
      pixelContrast: false,
    })
    expect(fastCollection(resolveCriteria(['1.4.5'])).backgroundLimit).toBe(FAST.imageLimit)
    expect(fastCollectOptions(undefined)).toEqual({})
  })
})

describe('fast from code', () => {
  it('lowers the cap where neither the call nor the config set one', async () => {
    expect((await resolveSettings({ fast: true, config: false, noLlm: true })).maxCandidates).toBe(FAST.maxCandidates)
    expect((await resolveSettings({ fast: true, maxCandidates: 30, config: false, noLlm: true })).maxCandidates).toBe(30)
    expect((await resolveSettings({ config: { fast: true, maxCandidates: 20 }, noLlm: true })).maxCandidates).toBe(20)
    expect((await resolveSettings({ config: false, noLlm: true })).fastCollection).toBeUndefined()
  })
})

// The CLI on a recorded page with its recorded judgments: no browser, model or network.
const recorded = ['demo/recorded/examples-store-before.snapshot.json', '--offline', '--cache-dir', 'demo/recorded/cache', '--model', 'ollama:gemma4:12b']

function rampa(...args: string[]) {
  const run = spawnSync(process.execPath, ['src/cli.ts', 'check', ...args], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', RAMPA_LOCALE: 'en', RAMPA_MODEL: '' } })
  return { code: run.status, stdout: run.stdout, stderr: run.stderr }
}

describe('rampa check --fast', { timeout: 60_000 }, () => {
  it('says it ran in fast mode and what it left out, in every format', () => {
    const report = JSON.parse(rampa(...recorded, '--fast', '--format', 'json').stdout) as Report
    // A recording was not loaded in a browser: nothing to wait for, capture or measure.
    expect(report.coverage.fast).toEqual({ skipped: ['probes', 'link-following', 'ocr'], maxCandidates: FAST.maxCandidates })
    expect((JSON.parse(rampa(...recorded, '--format', 'json').stdout) as Report).coverage.fast).toBeUndefined()
    const pretty = rampa(...recorded, '--fast').stdout
    expect(pretty).toContain('· fast mode (--fast)')
    expect(pretty).toMatch(/Fast mode \(--fast\): +left out probes, link following/)
    expect(rampa(...recorded, '--fast', '--format', 'markdown').stdout).toContain('- Fast mode (--fast): left out probes')
    expect(rampa(...recorded, '--fast', '--format', 'html').stdout).toContain('<th scope="row">Fast mode (--fast)</th>')
  })

  it('judges the same candidates when the page has fewer than the cap', () => {
    const fast = JSON.parse(rampa(...recorded, '--fast', '--format', 'json').stdout) as Report
    const full = JSON.parse(rampa(...recorded, '--format', 'json').stdout) as Report
    expect(fast.findings.map((f) => f.fingerprint)).toEqual(full.findings.map((f) => f.fingerprint))
  })
})

// Integration: Microsoft Edge here, Google Chrome on CI (RAMPA_BROWSER_CHANNEL=chrome). Skipped, with the reason, without a browser.
const launched = await launchTestBrowser('fast mode in a real browser')
const browser: Browser | undefined = 'browser' in launched ? launched.browser : undefined
if ('skip' in launched) console.warn(launched.skip)
afterAll(async () => {
  await browser?.close()
}, 60_000)

describe.skipIf(!browser)('fast collection in a real browser', { timeout: 60_000 }, () => {
  it('captures at most its image limit, measures no contrast from pixels and records its shorter wait', async () => {
    if (!browser) throw new Error('no browser')
    const dir = mkdtempSync(join(tmpdir(), 'rampa-fast-'))
    const colors = Array.from({ length: 14 }, (_, i) => `hsl(${i * 25} 70% 45%)`)
    const images = colors
      .map((color, i) => `<img alt="Swatch ${i}" width="40" height="40" src="data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40'><rect width='40' height='40' fill='${color}'/></svg>`)}">`)
      .join('\n')
    // A ticker keeps the page busy, so the wait runs to its cap.
    const ticker = '<p id="t">0</p><script>let n = 0; setInterval(() => { document.getElementById("t").textContent = String(++n) }, 100)</script>'
    writeFileSync(join(dir, 'page.html'), `<!doctype html><html lang="en"><title>Swatches</title><main><h1>Swatches</h1>${images}<button style="background:linear-gradient(#fff,#eee);color:#999">Go</button>${ticker}</main></html>`)
    const url = pathToFileURL(join(dir, 'page.html')).href
    const started = Date.now()
    const fast = await collectWeb(browser, url, { runAxe: true, locale: 'en', captureImages: true, ...fastCollectOptions(fastCollection(DEFAULTS)) })
    expect(Date.now() - started).toBeLessThan(15_000)
    const limited = [...walkTree(fast.snapshot.root)].filter((node) => node.native.imageSkipped === 'limit')
    expect(limited).toHaveLength(14 - FAST.imageLimit)
    expect(fast.snapshot.root.native.pixelContrastRun).toBeUndefined()
    expect(fast.snapshot.reach?.unsettledAfterMs).toBe(FAST.settleCapMs)
    const full = await collectWeb(browser, url, { runAxe: true, locale: 'en', captureImages: true })
    expect([...walkTree(full.snapshot.root)].filter((node) => node.native.imageSkipped === 'limit')).toHaveLength(0)
    expect(full.snapshot.reach?.unsettledAfterMs).toBe(3000)
  })
})
