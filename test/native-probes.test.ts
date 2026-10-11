import { readFileSync } from 'node:fs'
import { mkdtemp, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { type CheckCommandOptions, runCheck } from '../src/cli/commands/check.ts'
import type { GlobalContext } from '../src/cli/context.ts'
import type { Finding, Report } from '../src/core/types.ts'
import { nameOf, nativeSignature, snapshotSignature } from '../src/probes/identity.ts'
import { NativeMatcher } from '../src/probes/native/screen.ts'
import { PROBE_RULES } from '../src/rules/registry.ts'
import { probeChecks } from '../src/rules/probes.ts'
import type { A11ySnapshot, ProbeRecord } from '../src/snapshot/schema.ts'
import { collectAndroid } from '../src/surfaces/android/adb.ts'
import { androidScreen, restoreOnInterrupt, runAndroidProbes } from '../src/surfaces/android/probes.ts'
import { importXcuitest } from '../src/surfaces/ios.ts'
import { type FakeDeviceOptions, fakeDevice } from './android-device.ts'

/**
 * The native probes (D7): an Android device driven over adb, and probe steps exported by an XCUITest. No device,
 * emulator or Mac was available, so these run against a fake adb that serves hand-written dumps
 * (test/android-device.ts, test/fixtures/android/probes/) and a hand-written export (test/fixtures/ios/probes.json).
 */

const fixture = (name: string) => readFileSync(new URL(`./fixtures/android/probes/${name}`, import.meta.url), 'utf8')
const noWait = { sleep: async () => {}, onInterrupt: () => () => {} }

async function probed(options: FakeDeviceOptions, kinds: Array<'keyboard' | 'layout' | 'orientation'>, locale: 'en' | 'pt-BR' = 'en') {
  const device = fakeDevice(options)
  const collected = await collectAndroid({ locale: 'en', adb: device.adb, captureImages: false })
  const run = await runAndroidProbes({ adb: device.adb, serial: 'emulator-5554', kinds, snapshot: collected.snapshot, ...noWait })
  const snapshot: A11ySnapshot = { ...collected.snapshot, observations: { probes: run.records } }
  return { device, run, snapshot, result: probeChecks(snapshot, locale, PROBE_RULES) }
}

const rows = (findings: Finding[]) => findings.map((f) => [f.criterion, f.ruleId, f.ref, f.confidence])
const coverage = (result: ReturnType<typeof probeChecks>, criterion: string) => result.coverage.find((row) => row.criterion === criterion)
/** Keys the observe class never sends on an app screen: Enter, Space, Esc (Back on Android), Back, Home. */
const FORBIDDEN = ['keyevent 66', 'keyevent 62', 'keyevent 111', 'keyevent 4', 'keyevent 3', 'input tap', 'input swipe']

describe('node identity on app screens', () => {
  it('signs a native node by its type, id, role and name, and names it by its class', async () => {
    const screen = androidScreen(fixture('walk.xml'))
    const signIn = [...walk(screen.root)].find((node) => node.native.resourceId === 'com.example.shop:id/sign_in')
    expect(signIn && snapshotSignature(signIn)).toBe('native|android.widget.Button|com.example.shop:id/sign_in|button|Sign in')
    expect(signIn && nativeSignature(signIn)).toBe(signIn && snapshotSignature(signIn))
    expect(nameOf(signIn)).toBe('<Button> "Sign in"')
  })

  it('pairs the nodes of a screen read later with the snapshot, by identity and then in order, never by guess', () => {
    const before = androidScreen(fixture('text-1.xml'))
    const after = androidScreen(fixture('text-2.xml'))
    const pairs = new NativeMatcher(before.root).map(after.root)
    const byText = (text: string) => [...pairs.entries()].find(([node]) => node.text === text)
    // The same resource-id and text at 200%: the same node.
    expect(byText('Arrives Tuesday')?.[1].ref).toBe('com.example.shop:id/promo_sub')
    // A list's rows are named by their content, so each pairs with itself.
    expect(byText('Pot')?.[1].ref).toBe('//*[@resource-id="com.example.shop:id/list"]/android.widget.LinearLayout[3]/android.widget.TextView')
    // Text the app shortened is not the same identity: the text-size probe pairs it on its own (below).
    expect(byText('Continue to chec…')).toBeUndefined()

    // Nodes that share an identity pair in order when both screens have as many, else only where the ref is the same.
    const dump = (rows: number) =>
      `<hierarchy rotation="0"><node class="android.widget.FrameLayout" package="com.example.shop" bounds="[0,0][360,760]">${Array.from(
        { length: rows },
        (_, i) => `<node class="android.widget.LinearLayout" package="com.example.shop" resource-id="com.example.shop:id/row" bounds="[0,${i * 60}][360,${i * 60 + 60}]" />`,
      ).join('')}</node></hierarchy>`
    const three = androidScreen(dump(3))
    const matcher = new NativeMatcher(three.root)
    const same = matcher.map(androidScreen(dump(3)).root)
    const fewer = matcher.map(androidScreen(dump(2)).root)
    const rowsOf = (map: Map<A11ySnapshot['root'], A11ySnapshot['root']>) => [...map.entries()].filter(([node]) => node.native.resourceId === 'com.example.shop:id/row').map(([node, pair]) => [node.ref, pair.ref])
    expect(rowsOf(same)).toHaveLength(3)
    expect(rowsOf(fewer)).toEqual([
      ['/hierarchy/android.widget.FrameLayout/android.widget.LinearLayout[1]', '/hierarchy/android.widget.FrameLayout/android.widget.LinearLayout[1]'],
      ['/hierarchy/android.widget.FrameLayout/android.widget.LinearLayout[2]', '/hierarchy/android.widget.FrameLayout/android.widget.LinearLayout[2]'],
    ])
  })
})

function* walk(root: A11ySnapshot['root']): Generator<A11ySnapshot['root']> {
  yield root
  for (const child of root.children) yield* walk(child)
}

describe('the keyboard walk on an Android screen (fake device)', () => {
  it('goes round the screen with Tab and Shift+Tab, and finds an unreachable control, a missing indicator and a covered one', async () => {
    const { device, run, result } = await probed({ screen: 'walk.xml', noIndicator: ['sign_in'] }, ['keyboard'])
    const record = run.records[0] as ProbeRecord
    expect(record).toMatchObject({ kind: 'keyboard', version: '2', status: 'complete', conditions: { variant: 'keyboard-walk', browser: 'Android 14 (API 34), sdk_gphone64_x86_64, over adb', viewport: { width: 360, height: 760 } } })
    const data = record.data as { platform: string; forward: Array<{ el: { ref: string } | null }>; backward: unknown[]; end: unknown; startFocus: unknown }
    expect(data.platform).toBe('android')
    expect(data.end).toEqual({ forward: 'cycled', backward: 'cycled' })
    // Eight focusable controls, then Tab wraps back to the first: Android's focus order wraps round the window.
    expect(data.forward.map((stop) => stop.el?.ref.replace('com.example.shop:id/', ''))).toEqual(['help', 'email', 'password', 'show_password', 'remember', 'sign_in', 'forgot', 'create', 'help'])
    expect(data.backward).toHaveLength(9)
    expect(data.startFocus).toBeNull()

    expect(rows(result.findings)).toEqual([
      ['2.1.1', 'rampa/keyboard-reach', 'com.example.shop:id/terms', 'high'],
      ['2.4.7', 'rampa/focus-visible', 'com.example.shop:id/sign_in', 'high'],
      ['2.4.7', 'rampa/focus-visible', 'com.example.shop:id/create', 'medium'],
      ['2.4.11', 'rampa/focus-obscured', 'com.example.shop:id/create', 'high'],
    ])
    const [reach, , covered, obscured] = result.findings
    expect(reach?.evidence).toBe('Tab ×9 forward and Shift+Tab ×9 backward reached 8 element(s), never <TextView> "Terms of use"; the screen marks it clickable but not focusable, so the keyboard cannot reach it')
    expect(covered?.evidence).toContain('with focus, against the screen once focus moved on and before it arrived; 0 px changed')
    expect(covered?.evidence).toContain('entirely under com.example.shop:id/banner (see 2.4.11)')
    expect(obscured?.evidence).toBe(
      'Tab ×8 on a 360×760 screen: <Button> "Create account" at y 660; 25 of 25 grid points lie under <CardView> com.example.shop:id/banner (360×120 px at y 640), drawn over it; 0 px around it changed when it took focus',
    )
    // No CSS on an app screen: no scroll-padding hint.
    expect(obscured?.evidence).not.toContain('scroll-padding')
    expect(result.findings.every((finding) => finding.source === 'probe' && finding.experimental)).toBe(true)
    expect(coverage(result, '2.1.2')?.status).toBe('no-failure-found')
    expect(coverage(result, '3.2.1')?.status).toBe('no-failure-found')
    expect(coverage(result, '1.4.11')).toMatchObject({ status: 'not-checked', note: expect.stringContaining("the platform's own focus highlight") })
    expect(coverage(result, '2.4.7')?.conditions).toBe('captures with focus, after it moved on and before it arrived, at 360×760 · Android 14 (API 34), sdk_gphone64_x86_64, over adb')

    expect(device.calls).toContain('shell input keyevent 61')
    expect(device.calls).toContain('shell input keycombination 59 61')
    for (const key of FORBIDDEN) expect(device.calls.some((call) => call.includes(key))).toBe(false)
  })

  it('fails a trap that Tab, Shift+Tab and the arrows never leave, twice, and never takes the stuck stop for a missing indicator', async () => {
    const { device, run, result } = await probed({ screen: 'walk.xml', trap: ['password'] }, ['keyboard'])
    expect(run.records[0]).toMatchObject({ status: 'partial', reason: 'focus cycled without leaving a set of elements' })
    expect(rows(result.findings)).toEqual([['2.1.2', 'rampa/keyboard-trap', 'com.example.shop:id/password', 'high']])
    expect(result.findings[0]?.message).toBe(
      'Keyboard focus cannot leave this group of elements: Tab, Shift+Tab and the arrow keys all keep it inside. (Esc is not pressed on an app screen, where Android reads it as Back.)',
    )
    expect(result.findings[0]?.evidence).toContain('focus did not leave with Shift+Tab; ArrowDown, then Tab; ArrowRight, then Tab; ArrowUp, then Shift+Tab; ArrowLeft, then Shift+Tab, in 2 round(s)')
    // The walk did not go round, so what it missed is unknown.
    expect(coverage(result, '2.1.1')).toMatchObject({ status: 'not-checked' })
    for (const code of [19, 20, 21, 22]) expect(device.calls).toContain(`shell input keyevent ${code}`)
    for (const key of FORBIDDEN) expect(device.calls.some((call) => call.includes(key))).toBe(false)
  })

  it('stops when a Tab brings another app to the front, and sends it to review under 3.2.1, unconfirmed', async () => {
    const { run, result } = await probed({ screen: 'walk.xml', opens: { id: 'forgot', screen: 'browser.xml' } }, ['keyboard'])
    expect(run.records[0]).toMatchObject({ status: 'partial', reason: 'a Tab took the app to another screen or app; the walk stopped there' })
    expect(result.findings).toEqual([])
    expect(result.review.map((f) => [f.criterion, f.ref, f.confidence])).toEqual([['3.2.1', '/hierarchy', 'low']])
    expect(result.review[0]?.message).toBe(
      'While keyboard focus moved to this element, the app brought another app to the front. On an app screen Rampa cannot give focus back to see whether it happens again (that would need Back), so check whether focus caused it.',
    )
    expect(result.review[0]?.evidence).toContain('brought another app to the front (com.android.chrome)')
    expect(coverage(result, '2.1.1')?.status).toBe('not-checked')
  })

  it('walks forward only when the device cannot send Shift+Tab (before Android 13), and says so', async () => {
    const { device, run, result } = await probed({ screen: 'walk.xml', sdk: 30 }, ['keyboard'])
    expect(run.records[0]).toMatchObject({ status: 'partial', reason: 'the backward walk did not run: the device cannot send Shift+Tab (input keycombination needs Android 13)' })
    expect(device.calls).not.toContain('shell input keycombination 59 61')
    // Tab wraps round an app's window, so the forward walk alone covers the screen.
    expect(result.findings[0]?.evidence).toBe('Tab ×9 forward reached 8 element(s), never <TextView> "Terms of use"; the screen marks it clickable but not focusable, so the keyboard cannot reach it')
  })

  it('asks an older UI Automator for the plain dump from the second step on, once it does not know --windows', async () => {
    const { device, result } = await probed({ screen: 'walk.xml', noIndicator: ['sign_in'], noWindowsDump: true }, ['keyboard'])
    expect(result.findings).toHaveLength(4)
    const windows = device.calls.filter((call) => call === 'exec-out uiautomator dump --windows /dev/tty')
    // Once for the collector, once for the probe's first read; never again.
    expect(windows).toHaveLength(2)
    expect(device.calls.filter((call) => call === 'exec-out uiautomator dump /dev/tty').length).toBeGreaterThan(20)
  })

  it('writes in the report language', async () => {
    const { result } = await probed({ screen: 'walk.xml', noIndicator: ['sign_in'] }, ['keyboard'], 'pt-BR')
    expect(result.findings[0]?.evidence).toContain('a tela o marca como clicável, mas não focalizável')
    expect(result.findings[3]?.evidence).toContain('desenhado por cima')
  })
})

describe('text at 200% on an Android screen (font_scale 2.0, fake device)', () => {
  it('finds text a container cuts, text the app shortens, text pushed off the screen and new overlaps, and puts the font scale back', async () => {
    const { device, run, result } = await probed({ screen: 'text-1.xml', fontScale2: 'text-2.xml' }, ['layout'])
    expect(run.records[0]).toMatchObject({ kind: 'layout', version: '1', status: 'complete', conditions: { variant: 'text-size-200' } })
    expect(rows(result.findings)).toEqual([
      ['1.4.4', 'rampa/resize-text', 'com.example.shop:id/promo_sub', 'high'],
      ['1.4.4', 'rampa/resize-text', 'com.example.shop:id/checkout', 'medium'],
    ])
    expect(result.findings[0]?.evidence).toBe('with text at 200% (font_scale 2.0): 8 px cut down by <CardView> com.example.shop:id/card; at 100% whole')
    expect(result.findings[1]?.message).toBe('With the system text size at 200%, the app shortens this text to an ellipsis, and nothing on the screen gives the full text.')
    expect(result.findings[1]?.evidence).toBe('with text at 200% (font_scale 2.0): shown as "Continue to chec…", about 232 px of its text left out; at 100% whole')
    // The list's rows past its new edge scrolled away: reachable, never reported.
    expect(result.review.map((f) => [f.ref, f.confidence])).toEqual([
      ['com.example.shop:id/price', 'low'],
      ['com.example.shop:id/extras', 'low'],
    ])
    expect(result.review[1]?.evidence).toBe(
      'at 100% shown; with text at 200% pushed out of a container that does not scroll (<FrameLayout> com.example.shop:id/extras): 1 text box(es), such as "Gift wrap available"; shown again once the text size was back at 100%',
    )
    expect(coverage(result, '1.4.4')?.conditions).toBe('the system text size at 200% (font_scale 2.0) against 100%, on a 360×760 screen · Android 14 (API 34), sdk_gphone64_x86_64, over adb')
    // Set to 1.0 for the baseline, 2.0, then deleted again: it was never set on this device.
    const settings = device.calls.filter((call) => call.startsWith('shell settings'))
    expect(settings).toEqual(['shell settings get system font_scale', 'shell settings put system font_scale 1.0', 'shell settings put system font_scale 2.0', 'shell settings delete system font_scale'])
    expect(device.settings.has('font_scale')).toBe(false)
  })

  it('puts the font scale back as it was when a dump fails mid-probe, and records the probe as not run', async () => {
    const { device, run, result } = await probed(
      {
        screen: 'text-1.xml',
        fontScale2: 'text-2.xml',
        settings: { font_scale: '1.15', accelerometer_rotation: '1', user_rotation: '0' },
        fail: (command, current) => command.includes('uiautomator dump') && current.settings.get('font_scale') === '2.0',
      },
      ['layout'],
    )
    expect(device.settings.get('font_scale')).toBe('1.15')
    expect(run.records[0]).toMatchObject({ status: 'skipped', reason: expect.stringMatching(/^probe failed: Could not read the screen with UI Automator/) })
    expect(coverage(result, '1.4.4')?.status).toBe('not-checked')
  })

  it('puts the font scale back on Ctrl+C, and says how to do it by hand when it cannot', async () => {
    let interrupt: (() => Promise<void>) | undefined
    const device = fakeDevice({
      screen: 'text-1.xml',
      fontScale2: 'text-2.xml',
      settings: { font_scale: '1.3' },
      // The person presses Ctrl+C while the screen is read at 200%.
      fail: (command, current) => {
        if (command.includes('uiautomator dump') && current.settings.get('font_scale') === '2.0') void interrupt?.()
        return false
      },
    })
    const collected = await collectAndroid({ locale: 'en', adb: device.adb, captureImages: false })
    await runAndroidProbes({
      adb: device.adb,
      serial: 'emulator-5554',
      kinds: ['layout'],
      snapshot: collected.snapshot,
      sleep: async () => {},
      onInterrupt: (restore) => {
        interrupt = restore
        return () => {}
      },
    })
    expect(device.settings.get('font_scale')).toBe('1.3')

    // A device that refuses the setting back: the warning gives the command.
    const stubborn = fakeDevice({ screen: 'text-1.xml', fontScale2: 'text-2.xml', fail: (command) => command === 'shell settings delete system font_scale' })
    const stubbornSnapshot = (await collectAndroid({ locale: 'en', adb: stubborn.adb, captureImages: false })).snapshot
    const run = await runAndroidProbes({ adb: stubborn.adb, serial: 'emulator-5554', kinds: ['layout'], snapshot: stubbornSnapshot, ...noWait })
    expect(run.warnings).toEqual([
      'Rampa could not put font_scale back to its default on emulator-5554 (adb shell settings delete system font_scale failed: fake failure: shell settings delete system font_scale). Put it back with: adb -s emulator-5554 shell settings delete system font_scale',
    ])
  })

  it('registers its Ctrl+C handler only while a setting is changed', () => {
    const before = process.listenerCount('SIGINT')
    const release = restoreOnInterrupt(async () => {})
    expect(process.listenerCount('SIGINT')).toBe(before + 1)
    expect(process.listenerCount('SIGTERM')).toBeGreaterThan(0)
    release()
    expect(process.listenerCount('SIGINT')).toBe(before)
  })

  it('compares nothing when the app shows another screen once the text size changes', async () => {
    const { run, result } = await probed({ screen: 'text-1.xml', fontScale2: 'browser.xml' }, ['layout'])
    expect(run.records[0]).toMatchObject({ status: 'skipped', reason: expect.stringMatching(/^the app showed another screen when the text size changed/) })
    expect(coverage(result, '1.4.4')?.status).toBe('not-checked')
  })
})

describe('orientation on an Android screen (fake device)', () => {
  it('finds nothing when the app turns with the device, and puts auto-rotate and the rotation back', async () => {
    const { device, run, result } = await probed({ screen: 'rotate-portrait.xml', landscape: 'rotate-landscape.xml', settings: { accelerometer_rotation: '1', user_rotation: '3' } }, ['orientation'])
    expect(run.records[0]).toMatchObject({ kind: 'orientation', status: 'complete', conditions: { variant: 'orientation' } })
    const data = run.records[0]?.data as { steps: Array<{ requested: string; display: number | null }> }
    expect(data.steps.map((step) => [step.requested, step.display])).toEqual([
      ['portrait', 0],
      ['landscape', 1],
      ['portrait', 0],
    ])
    expect(result.findings).toEqual([])
    expect(result.review).toEqual([])
    expect(coverage(result, '1.3.4')).toMatchObject({ status: 'no-failure-found', conditions: 'portrait and landscape at 360×760 (phone) · Android 14 (API 34), sdk_gphone64_x86_64, over adb' })
    expect(Object.fromEntries(device.settings)).toEqual({ accelerometer_rotation: '1', user_rotation: '3' })
  })

  it('fails an app that keeps its screen upright while the device is sideways', async () => {
    const { result } = await probed({ screen: 'rotate-portrait.xml' }, ['orientation'])
    expect(rows(result.findings)).toEqual([['1.3.4', 'rampa/orientation', '/hierarchy', 'high']])
    expect(result.findings[0]?.message).toContain('When the device is turned to landscape, the app keeps this screen in portrait, so it reads sideways')
    expect(result.findings[0]?.evidence).toBe(
      '<application> "com.example.shop": the device portrait at 0°, the display at 0°, the app\'s window 360×760; turned: the device landscape at 90°, the display at 0°, the app\'s window 360×760; the screen is drawn 90° from how the device is held, with 134 character(s) of text',
    )
  })

  it('writes the text-size and orientation findings in the report language', async () => {
    const text = await probed({ screen: 'text-1.xml', fontScale2: 'text-2.xml' }, ['layout'], 'pt-BR')
    expect(text.result.findings[0]?.message).toBe('Com o tamanho do texto do sistema em 200%, este texto fica cortado: o contêiner em que está não cresce com ele. A 100% ele aparece inteiro.')
    expect(text.result.findings[0]?.evidence).toBe('com o texto a 200% (font_scale 2.0): 8 px cortados na vertical por <CardView> com.example.shop:id/card; a 100% inteiro')
    const turned = await probed({ screen: 'rotate-portrait.xml' }, ['orientation'], 'pt-BR')
    expect(turned.result.findings[0]?.message).toContain('Quando o aparelho é girado para paisagem, o app mantém esta tela em retrato')
  })

  it('fails a landscape layout that only asks to turn the device back', async () => {
    const { result } = await probed({ screen: 'rotate-portrait.xml', landscape: 'rotate-message.xml' }, ['orientation'])
    expect(rows(result.findings)).toEqual([['1.3.4', 'rampa/orientation', '/hierarchy', 'high']])
    expect(result.findings[0]?.message).toContain('In landscape orientation, the app hides this screen and asks to turn the device')
    expect(result.findings[0]?.evidence).toContain('it says "Please rotate your device to portrait"')
  })
})

describe('rampa check android: --probe (fake device)', () => {
  const context: GlobalContext = { locale: 'en', motion: false, config: {} }
  const options = (extra: Partial<CheckCommandOptions>): CheckCommandOptions => ({
    criteria: '1.1.1',
    llm: false,
    runs: '1',
    format: 'json',
    failOn: 'confirmed',
    minConfidence: 'low',
    cacheDir: '.rampa/cache',
    concurrency: '1',
    ...extra,
  })
  const check = async (target: string, extra: Partial<CheckCommandOptions>) => {
    const dir = await mkdtemp(join(tmpdir(), 'rampa-native-'))
    const output = join(dir, 'report.json')
    const code = await runCheck([target], options({ output, ...extra }), context)
    return { code, report: JSON.parse(await readFile(output, 'utf8')) as Report }
  }

  it('runs the probes after collecting the screen, records them with --save, and replays the recording offline to the same findings', { timeout: 60_000 }, async () => {
    const device = fakeDevice({ screen: 'walk.xml', noIndicator: ['sign_in'] })
    const save = await mkdtemp(join(tmpdir(), 'rampa-native-save-'))
    const live = await check('android:emulator-5554', { probe: 'keyboard,hover', adb: device.adb, save })
    const probeFindings = (report: Report) => report.findings.filter((f) => f.source === 'probe').map((f) => f.fingerprint)
    expect(live.report.findings.filter((f) => f.source === 'probe').map((f) => [f.criterion, f.ref])).toEqual([
      ['2.1.1', 'com.example.shop:id/terms'],
      ['2.4.7', 'com.example.shop:id/sign_in'],
      ['2.4.7', 'com.example.shop:id/create'],
      ['2.4.11', 'com.example.shop:id/create'],
    ])
    expect(live.report.notes).toContain('On an app screen, --probe runs keyboard, layout, orientation; not run here (web pages only): hover.')
    expect(live.report.notes?.some((note) => note.startsWith('The app-screen probes have run only against a fake device'))).toBe(true)
    const saved = (await readdir(save)).find((name) => name.endsWith('.snapshot.json')) as string
    const recorded = JSON.parse(await readFile(join(save, saved), 'utf8')) as A11ySnapshot
    expect(recorded.observations?.probes.map((record) => record.conditions.variant)).toEqual(['keyboard-walk'])
    const replay = await check(join(save, saved), {})
    expect(probeFindings(replay.report)).toEqual(probeFindings(live.report))
    expect(replay.report.notes?.some((note) => note.startsWith('The app-screen probes have run only against a fake device'))).toBe(true)
  })

  it('reads the probe steps of an XCUITest export, only the kinds asked for, and names those that drive web pages', async () => {
    const { report } = await check('test/fixtures/ios/probes.json', { probe: 'orientation,hover' })
    expect(report.findings.filter((f) => f.source === 'probe').map((f) => [f.criterion, f.ref])).toEqual([['1.3.4', '/XCUIElementTypeApplication']])
    expect(report.notes).toContain('On an app screen, --probe runs layout, orientation; not run here (web pages only): hover.')
    expect(report.notes?.some((note) => note.startsWith('The app-screen probes have run only against a fake device'))).toBe(true)
    // Without --probe, every step the export holds is read.
    const all = await check('test/fixtures/ios/probes.json', {})
    expect(all.report.findings.filter((f) => f.source === 'probe').map((f) => f.criterion)).toEqual(['1.3.4', '1.4.4'])
  })

  it('says a saved dump cannot be probed', async () => {
    const { report } = await check('test/fixtures/android/probes/walk.xml', { probe: 'keyboard' })
    expect(report.notes).toContain('--probe needs the device: a saved dump is a single state of the screen, so it was checked without probes. Run rampa check android: --probe … with the device connected.')
    expect(report.findings.some((f) => f.source === 'probe')).toBe(false)
  })
})

describe('probe steps in an XCUITest export (hand-written)', () => {
  const exported = () => JSON.parse(readFileSync(new URL('./fixtures/ios/probes.json', import.meta.url), 'utf8')) as Record<string, unknown> & { probes: { orientation: { steps: Array<{ root: unknown }> } } }

  it('turns orientation and text-size steps into the records the rules read', () => {
    const { snapshot } = importXcuitest(exported(), { locale: 'en' })
    expect(snapshot.observations?.probes.map((record) => [record.kind, record.conditions.variant, record.status, record.conditions.browser])).toEqual([
      ['layout', 'text-size-200', 'complete', 'iOS 18.2, iPhone, from an XCUITest export'],
      ['orientation', 'orientation', 'complete', 'iOS 18.2, iPhone, from an XCUITest export'],
    ])
    const result = probeChecks(snapshot, 'en', PROBE_RULES)
    expect(rows(result.findings)).toEqual([
      ['1.4.4', 'rampa/resize-text', 'boardingTime', 'high'],
      ['1.3.4', 'rampa/orientation', '/XCUIElementTypeApplication', 'high'],
    ])
    expect(result.findings[0]?.message).toBe('With the system text size at 194%, this text runs past the edge of the screen, outside anything that scrolls, so part of it cannot be seen. It fits at 100%.')
    expect(result.findings[0]?.evidence).toBe('with text at 194% (Dynamic Type AX2, 33 pt body text): 163 px cut across past the edge of the screen; at 100% whole')
    expect(coverage(result, '1.4.4')?.conditions).toBe('the system text size at 194% (Dynamic Type AX2, 33 pt body text) against 100%, on a 393×852 screen · iOS 18.2, iPhone, from an XCUITest export')
    expect(result.review.map((f) => [f.ref, f.message])).toEqual([
      ['zone', 'With the system text size at 194%, this text overlaps other text that it did not overlap at 100%.'],
      ['gate', "Apple's accessibility audit, run with text at the larger size, reports an issue here: Text clipped. Check that the text can be read."],
    ])
  })

  it('finds nothing for 1.3.4 when the app turns with the device', () => {
    const data = exported()
    const landscape = JSON.parse(readFileSync(new URL('./fixtures/ios/probes-landscape-root.json', import.meta.url), 'utf8')) as unknown
    const step = data.probes.orientation.steps[1] as { root: unknown }
    step.root = landscape
    const { snapshot } = importXcuitest(data, { locale: 'en', probes: ['orientation'] })
    expect(snapshot.observations?.probes.map((record) => record.kind)).toEqual(['orientation'])
    const result = probeChecks(snapshot, 'en', PROBE_RULES)
    expect(result.findings).toEqual([])
    expect(coverage(result, '1.3.4')?.status).toBe('no-failure-found')
  })

  it('says what an export lacks for the kinds asked, and that iOS has no keyboard walk', () => {
    const plain = JSON.parse(readFileSync(new URL('./fixtures/ios/login.json', import.meta.url), 'utf8')) as unknown
    expect(importXcuitest(plain, { locale: 'en' }).snapshot.observations).toBeUndefined()
    const { snapshot } = importXcuitest(plain, { locale: 'en', probes: ['keyboard', 'layout', 'orientation'] })
    expect(snapshot.observations?.probes.map((record) => [record.kind, record.status, record.reason])).toEqual([
      ['keyboard', 'skipped', 'no keyboard walk on iOS: Full Keyboard Access cannot be turned on from a UI test, so RampaExport.swift does not export one'],
      ['layout', 'skipped', 'the export holds no text size steps: call RampaExport.captureTextSize in the UI test (docs/ios.md)'],
      ['orientation', 'skipped', 'the export holds no orientation steps: call RampaExport.captureOrientation in the UI test (docs/ios.md)'],
    ])
    const result = probeChecks(snapshot, 'en', PROBE_RULES)
    expect(['2.1.1', '1.4.4', '1.3.4'].map((criterion) => coverage(result, criterion)?.status)).toEqual(['not-checked', 'not-checked', 'not-checked'])
  })
})
