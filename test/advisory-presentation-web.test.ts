import { spawnSync } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import type { Advisory } from '../src/advisory/types.ts'
import type { Report } from '../src/core/types.ts'
import { collectWeb } from '../src/surfaces/web.ts'
import { launchTestBrowser } from './browser.ts'
import { profileOf } from './coga-helpers.ts'

/**
 * The presentation facts end to end: collected in a real browser only when the cognitive profile asks for them, saved
 * with the snapshot, and read again offline by the CLI with no browser, giving the same advisories. Skipped without
 * Chrome or Edge.
 */

const started = await launchTestBrowser('the presentation facts test')
const browser = 'browser' in started ? started.browser : undefined
afterAll(async () => browser?.close(), 60_000)

const PAGE = pathToFileURL(resolve('test/fixtures/coga/presentation.html')).href
const CLI = resolve('src/cli.ts')
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('RAMPA_')))
const key = (advisory: Advisory) => `${advisory.check} ${advisory.kind} ${advisory.ref} ${advisory.fingerprint}`

describe.skipIf(!browser)('presentation facts in a real browser', { timeout: 60_000 }, () => {
  it('are measured only when the profile asks, so the default run does not pay for them', async () => {
    if (!browser) return
    const plain = await collectWeb(browser, PAGE, { runAxe: false, locale: 'en', axTree: false, pixelContrast: false })
    expect(plain.snapshot.presentation).toBeUndefined()
    const measured = await collectWeb(browser, PAGE, { runAxe: false, locale: 'en', axTree: false, pixelContrast: false, presentation: true })
    const facts = measured.snapshot.presentation
    expect(facts).toMatchObject({ version: '1', scope: 'main', viewport: measured.snapshot.viewport && { width: measured.snapshot.viewport.width, height: measured.snapshot.viewport.height } })
    expect(facts?.blocks.find((block) => block.ref === '#longo')?.charsPerLine.median).toBeGreaterThan(120)
    expect(facts?.blocks.find((block) => block.ref === '#bem-feito')?.charsPerLine.median).toBeLessThan(80)
    // The drawn font is read over CDP, once per family.
    expect(facts?.blocks.some((block) => block.platformFont !== undefined)).toBe(true)
    expect(facts?.controls.map((control) => control.ref)).toEqual(expect.arrayContaining(['#menu', '#facebook']))
    expect(facts?.links.find((link) => link.ref === '#transparencia')).toMatchObject({ by: 'target', target: '_blank', text: 'Portal da Transparência' })
  })

  it('replay offline through the CLI with the same advisories', async () => {
    if (!browser) return
    const live = await collectWeb(browser, PAGE, { runAxe: false, locale: 'en', pixelContrast: false, presentation: true })
    // Without a language, the abbreviation check needs no dictionary (and says it did not run): nothing is downloaded.
    live.snapshot.locale = undefined
    live.snapshot.root.lang = undefined
    const section = await profileOf(live.snapshot)
    const presentationChecks = section.checks.filter((check) => /^coga\/(line-length|text-alignment|line-height|text-emphasis|decorative-font|icon-only-control|new-window)$/.test(check.check))
    expect(presentationChecks.every((check) => check.ran)).toBe(true)
    const expected = [...section.results, ...section.belowThreshold].map(key).sort()
    expect(expected.filter((entry) => entry.startsWith('coga/new-window')).length).toBe(1)
    expect(expected.some((entry) => entry.startsWith('coga/icon-only-control advisory #menu'))).toBe(true)

    const dir = await mkdtemp(join(tmpdir(), 'rampa-presentation-'))
    await writeFile(join(dir, 'page.snapshot.json'), JSON.stringify(live.snapshot))
    await writeFile(join(dir, 'page.engine.json'), JSON.stringify(live.engine))
    await writeFile(join(dir, 'package.json'), '{"type":"module"}\n')
    const run = spawnSync(process.execPath, [CLI, 'check', 'page.snapshot.json', '--no-llm', '--profile', 'cognitive', '--min-confidence', 'low', '-f', 'json'], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...env, NO_COLOR: '1', RAMPA_LOCALE: 'en', RAMPA_MODEL: '' },
    })
    expect(run.status).toBe(0)
    const report = JSON.parse(run.stdout) as Report
    const replayed = [...(report.advisory?.results ?? []), ...(report.advisory?.belowThreshold ?? [])].map(key).sort()
    expect(replayed).toEqual(expected)
    expect(report.advisory?.coverage.beyondTarget).toContain('1.4.8')
  })
})
