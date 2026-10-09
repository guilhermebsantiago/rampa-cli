import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { encodePng } from '../src/pixels/png.ts'
import { type AdbRunner, adbPath, adbVersion, captureAndroid, chooseDevice, collectAndroid, parseAppLocales, parseDevices, systemAdb } from '../src/surfaces/android/adb.ts'
import { WHITE, blank, drawText } from './screens.ts'

const fixture = (name: string) => readFileSync(new URL(`./fixtures/android/${name}`, import.meta.url), 'utf8')

type Script = Record<string, string | Buffer | { code: number; stdout?: string; stderr?: string }>

/** A fake adb: answers by the command line without the -s serial, and records every call. */
function fakeAdb(script: Script): AdbRunner & { calls: string[] } {
  const calls: string[] = []
  const runner = async (args: string[]) => {
    const key = (args[0] === '-s' ? args.slice(2) : args).join(' ')
    calls.push(args.join(' '))
    const answer = script[key]
    if (answer === undefined) return { stdout: Buffer.alloc(0), stderr: `unknown command ${key}`, code: 1 }
    if (typeof answer === 'string') return { stdout: Buffer.from(answer), stderr: '', code: 0 }
    if (Buffer.isBuffer(answer)) return { stdout: answer, stderr: '', code: 0 }
    return { stdout: Buffer.from(answer.stdout ?? ''), stderr: answer.stderr ?? '', code: answer.code }
  }
  return Object.assign(runner, { calls })
}

const ONE_DEVICE = 'List of devices attached\nemulator-5554\tdevice\n\n'

describe('adb devices', () => {
  it('reads devices and skips daemon messages', () => {
    expect(parseDevices('* daemon not running; starting now at tcp:5037\n* daemon started successfully\nList of devices attached\nemulator-5554\tdevice\nR58M12ABC\tunauthorized\n')).toEqual([
      { serial: 'emulator-5554', state: 'device' },
      { serial: 'R58M12ABC', state: 'unauthorized' },
    ])
    expect(parseDevices('List of devices attached\n\n')).toEqual([])
  })

  it('says what to do when there is no device, several, or one that is not ready', async () => {
    await expect(chooseDevice(fakeAdb({ devices: 'List of devices attached\n\n' }))).rejects.toThrow(/No Android device or emulator is connected/)
    const two = fakeAdb({ devices: `${ONE_DEVICE.trim()}\nR58M12ABC\tdevice\n` })
    await expect(chooseDevice(two)).rejects.toThrow('2 devices are connected (emulator-5554, R58M12ABC). Choose one: rampa check android:<serial>')
    expect(await chooseDevice(two, 'R58M12ABC')).toBe('R58M12ABC')
    await expect(chooseDevice(two, 'pixel-9')).rejects.toThrow(/No device pixel-9 in adb devices \(connected: emulator-5554, R58M12ABC\)/)
    await expect(chooseDevice(fakeAdb({ devices: 'List of devices attached\nR58M12ABC\tunauthorized\n' }))).rejects.toThrow(/accept the USB debugging prompt/)
    await expect(chooseDevice(fakeAdb({ devices: 'List of devices attached\nemulator-5554\toffline\n' }))).rejects.toThrow(/is offline/)
  })

  it('fails with a clear message when adb is not installed', async () => {
    const missing = systemAdb(join('no', 'such', 'dir', 'adb-rampa-test'))
    await expect(missing(['devices'])).rejects.toThrow(/adb not found .* Install Android platform-tools/)
  })

  it('reports the platform-tools version for rampa doctor, without starting the adb server', async () => {
    const adb = fakeAdb({ version: 'Android Debug Bridge version 1.0.41\nVersion 35.0.2-12147458\nInstalled as /opt/platform-tools/adb\n' })
    expect(await adbVersion(adb)).toBe('35.0.2-12147458')
    expect(adb.calls).toEqual(['version'])
    expect(await adbVersion(systemAdb(join('no', 'such', 'dir', 'adb-rampa-test')))).toBeUndefined()
  })

  it('looks for adb in RAMPA_ADB_PATH, then the SDK, then the PATH', () => {
    expect(adbPath({ RAMPA_ADB_PATH: '/opt/adb' })).toBe('/opt/adb')
    expect(adbPath({ ANDROID_HOME: join('no', 'such', 'sdk') })).toBe('adb')
  })
})

describe('capturing a screen', () => {
  const screen = blank(1080, 2400)
  drawText(screen, { x: 42, y: 105, width: 996, height: 85 }, [0x20, 0x20, 0x20], WHITE)
  const png = encodePng(screen)

  it('dumps with window titles, takes the screenshot, and prefers the app language to the device one', async () => {
    const adb = fakeAdb({
      devices: ONE_DEVICE,
      'exec-out uiautomator dump --windows /dev/tty': `${fixture('gallery-windows.xml')}UI hierchary dumped to: /dev/tty\n`,
      'exec-out screencap -p': png,
      'shell getprop persist.sys.locale': '\n',
      'shell getprop ro.product.locale': 'en-US\n',
      'shell cmd locale get-app-locales com.example.gallery': 'Locales for com.example.gallery for user 0 are [pt-BR]\n',
    })
    const collected = await collectAndroid({ locale: 'en', adb })
    expect(collected.screen).toMatchObject({ serial: 'emulator-5554', locale: 'pt-BR', localeSource: 'app' })
    expect(collected.snapshot).toMatchObject({ surface: 'android', target: 'com.example.gallery', title: 'Galeria', locale: 'pt-BR' })
    expect(collected.snapshot.root.native.localeSource).toBe('app')
    expect(collected.engine.rules.some((rule) => rule.ruleId === 'text-contrast')).toBe(true)
    expect(collected.notes).toEqual(['Read from UI Automator, which does not expose headings, labelFor or the language of text: checks that need them did not run.'])
    // Every command names the device, so a second one plugged in later changes nothing.
    expect(adb.calls.slice(1).every((call) => call.startsWith('-s emulator-5554 '))).toBe(true)
  })

  it('falls back to a plain dump, then to a file, and keeps the device language without an app setting', async () => {
    const adb = fakeAdb({
      devices: ONE_DEVICE,
      'exec-out uiautomator dump --windows /dev/tty': { code: 1, stderr: 'ERROR: null root node returned by UiTestAutomationBridge.' },
      'exec-out uiautomator dump /dev/tty': { code: 1, stderr: 'ERROR: null root node returned by UiTestAutomationBridge.' },
      'shell uiautomator dump /data/local/tmp/rampa-window.xml': 'UI hierchary dumped to: /data/local/tmp/rampa-window.xml\n',
      'exec-out cat /data/local/tmp/rampa-window.xml': fixture('login.xml'),
      'shell rm -f /data/local/tmp/rampa-window.xml': '',
      'exec-out screencap -p': 'not a png',
      'shell getprop persist.sys.locale': 'pt-BR\n',
      'shell cmd locale get-app-locales com.example.shop': 'Locales for com.example.shop for user 0 are []\n',
    })
    const capture = await captureAndroid(adb)
    expect(capture).toMatchObject({ locale: 'pt-BR', localeSource: 'device', png: undefined })
    expect(capture.xml).toContain('com.example.shop:id/login_root')
    const collected = await collectAndroid({ locale: 'pt-BR', adb })
    expect(collected.notes[0]).toBe('Sem captura de tela: as imagens não foram julgadas (1.1.1) e o contraste do texto não foi medido.')
  })

  it('explains why UI Automator could not read the screen', async () => {
    const idle = { code: 1, stdout: 'ERROR: could not get idle state.' }
    const adb = fakeAdb({
      devices: ONE_DEVICE,
      'exec-out uiautomator dump --windows /dev/tty': idle,
      'exec-out uiautomator dump /dev/tty': idle,
      'shell uiautomator dump /data/local/tmp/rampa-window.xml': idle,
    })
    await expect(captureAndroid(adb)).rejects.toThrow(/screen never went idle\. Turn off animations/)
  })

  it('reads the per-app language only when one is set', () => {
    expect(parseAppLocales('Locales for com.example for user 0 are [pt-BR,en-US]')).toBe('pt-BR')
    expect(parseAppLocales('Locales for com.example for user 0 are []')).toBeUndefined()
    expect(parseAppLocales("cmd: Can't find service: locale")).toBeUndefined()
  })
})
