import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { type CheckCommandOptions, runCheck } from '../src/cli/commands/check.ts'
import type { GlobalContext } from '../src/cli/context.ts'
import type { Report } from '../src/core/types.ts'
import { paint } from '../src/report/color.ts'
import { renderReport } from '../src/report/pretty.ts'
import { loadRecorded, loadSnapshot, recordingName, resolveTargets } from '../src/surfaces/targets.ts'

const context: GlobalContext = { locale: 'en', motion: false, config: {} }

function options(extra: Partial<CheckCommandOptions>): CheckCommandOptions {
  return {
    criteria: '1.1.1,2.4.2,2.4.4,2.4.6,3.1.1,3.1.2',
    llm: false,
    runs: '1',
    format: 'json',
    failOn: 'confirmed',
    minConfidence: 'medium',
    cacheDir: '.rampa/cache',
    concurrency: '1',
    ...extra,
  }
}

async function check(target: string, extra: Partial<CheckCommandOptions> = {}): Promise<{ code: number; report: Report }> {
  const dir = await mkdtemp(join(tmpdir(), 'rampa-cli-'))
  const output = join(dir, 'report.json')
  const code = await runCheck([target], options({ output, ...extra }), context)
  return { code, report: JSON.parse(await readFile(output, 'utf8')) as Report }
}

describe('targets beyond the web', () => {
  it('reads android:, saved dumps, screenshots and exports, and says what it cannot read', async () => {
    expect(await resolveTargets(['android:', 'android:emulator-5554', 'ANDROID:192.168.1.20:5555'])).toEqual([
      { kind: 'android', serial: undefined, label: 'android:' },
      { kind: 'android', serial: 'emulator-5554', label: 'android:emulator-5554' },
      { kind: 'android', serial: '192.168.1.20:5555', label: 'ANDROID:192.168.1.20:5555' },
    ])
    const [dump, image, exported] = await resolveTargets(['examples/android/login.xml', 'examples/image/sign-in.png', 'examples/ios/login.json'])
    expect([dump?.kind, image?.kind, exported?.kind]).toEqual(['android-dump', 'image', 'snapshot'])
    await expect(resolveTargets(['android:bad serial'])).rejects.toThrow(/Not a device serial/)
    await expect(resolveTargets(['ios:'])).rejects.toThrow(/XCUITest export.*docs\/ios\.md/)
    await expect(resolveTargets(['examples/store/mug.svg'])).rejects.toThrow(/Unsupported target.*android:/)
  })

  it('names recordings without the extension', () => {
    expect(recordingName('examples/android/login.xml')).toBe('examples-android-login')
    expect(recordingName('android com.example.gallery Galeria')).toBe('android-com-example-gallery-galeria')
  })

  it('loads an XCUITest export as a snapshot', async () => {
    expect((await loadSnapshot('examples/ios/login.json')).surface).toBe('ios')
    const loaded = await loadRecorded('examples/ios/login.json', 'en')
    expect(loaded.from).toBe('xcuitest')
    expect(loaded.engine.engine.name).toBe('rampa-rules')
  })
})

describe('rampa check on app screens', () => {
  it('checks a saved Android dump with its screenshot, records it, and replays the recording the same', async () => {
    const save = await mkdtemp(join(tmpdir(), 'rampa-save-'))
    const first = await check('examples/android/login.xml', { save })
    expect(first.code).toBe(1)
    expect(first.report).toMatchObject({ surface: 'android', target: 'com.example.shop', engine: { name: 'rampa-rules' } })
    expect(first.report.findings.map((f) => [f.criterion, f.ref, f.ruleId])).toEqual([
      ['1.1.1', 'com.example.shop:id/toggle_password', 'image-control-name'],
      ['1.4.3', 'com.example.shop:id/forgot', 'text-contrast'],
    ])
    expect(first.report.notes).toEqual([
      'The language the screen is in is not known, so the language of the screen (3.1.1) was not checked.',
      'Read from UI Automator, which does not expose headings, labelFor or the language of text: checks that need them did not run.',
      '2 text(s) have a contrast between 3:1 and 4.5:1: enough only for large text, and their size is not known; check them by hand.',
    ])
    expect((await readdir(save)).sort()).toEqual(['examples-android-login.engine.json', 'examples-android-login.snapshot.json'])
    const saved = JSON.parse(await readFile(join(save, 'examples-android-login.snapshot.json'), 'utf8')) as { source?: unknown }
    expect(saved.source).toEqual({ kind: 'android-xml', path: 'examples/android/login.xml' })

    const replay = await check(join(save, 'examples-android-login.snapshot.json'))
    expect(replay.report.findings.map((f) => f.fingerprint)).toEqual(first.report.findings.map((f) => f.fingerprint))
    expect(replay.report.notes?.[0]).toBe('Read from UI Automator, which does not expose headings, labelFor or the language of text: checks that need them did not run.')
  })

  it('runs the rules on an app snapshot recorded without engine results, with the screenshot it names', async () => {
    const save = await mkdtemp(join(tmpdir(), 'rampa-save-'))
    await check('examples/ios/login.json', { save })
    await rm(join(save, 'examples-ios-login.engine.json'))
    const loaded = await loadRecorded(join(save, 'examples-ios-login.snapshot.json'), 'en')
    expect(loaded.from).toBe('snapshot')
    expect(loaded.notes).toEqual(['Read from an XCUITest export, which does not expose labels tied to fields or the language of text.'])
    const contrast = loaded.engine.rules.filter((rule) => rule.ruleId === 'text-contrast' && rule.outcome === 'violation')
    expect(contrast.flatMap((rule) => rule.nodes.map((n) => n.ref))).toEqual(['email'])
  })

  it('checks an XCUITest export and records it with its screenshot', async () => {
    const save = await mkdtemp(join(tmpdir(), 'rampa-save-'))
    const { code, report } = await check('examples/ios/login.json', { save })
    expect(code).toBe(1)
    expect(report.findings.map((f) => [f.criterion, f.ref])).toEqual([
      ['1.4.3', 'email'],
      ['4.1.2', 'togglePassword'],
    ])
    // 2.5.8 from the bounds, in points: every control of the login screen has room.
    expect(report.coverage.engine).toEqual(['1.1.1', '1.4.3', '2.5.8', '4.1.2'])
    expect((await readdir(save)).sort()).toEqual(['examples-ios-login.engine.json', 'examples-ios-login.png', 'examples-ios-login.snapshot.json'])
  })

  it('checks an image without a model, measuring nothing and saying why', async () => {
    const { code, report } = await check('examples/image/sign-in.png')
    expect(code).toBe(0)
    expect(report).toMatchObject({ surface: 'image', target: 'examples/image/sign-in.png', findings: [] })
    expect(report.coverage.engine).toEqual([])
    expect(report.notes?.[1]).toBe('No model to find text in the image, so nothing was measured. Pass --model with a vision model.')
  })
})

describe('report wording per surface', () => {
  async function rendered(target: string): Promise<string> {
    const { report } = await check(target)
    return renderReport(report, { verbose: false, paint: paint(false) })
  }

  it('speaks of a screen on apps and of an image for a screenshot', async () => {
    const android = await rendered('examples/android/login.xml')
    expect(android).toContain('Surface: android · WCAG 2.2 A/AA · rampa-rules')
    expect(android).toContain('This report does not declare the screen accessible.')
    const image = await rendered('examples/image/sign-in.png')
    expect(image).toContain('This report does not declare the image accessible.')
    expect(image).toContain('An image has no accessibility tree')
  })

  it('says when a model, not an accessibility tree, located what a finding cites', async () => {
    const { report } = await check('examples/android/login.xml')
    const finding = report.findings[1]
    if (!finding) throw new Error('no finding')
    const located = {
      ...report,
      surface: 'image' as const,
      findings: [{ ...finding, confidence: 'medium' as const, locatedBy: 'ollama:gemma4:12b', html: '"Forgot password?" at x 300, y 1320 (480×80 px)' }],
    }
    expect(renderReport(located, { verbose: false, paint: paint(false) })).toContain(
      'Located by ollama:gemma4:12b in the image: not read from an accessibility tree · "Forgot password?" at x 300, y 1320 (480×80 px)',
    )
    expect(renderReport({ ...located, locale: 'pt-BR' }, { verbose: false, paint: paint(false) })).toContain('média · regra text-contrast')
  })
})
