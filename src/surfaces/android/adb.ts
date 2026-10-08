import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { RampaError } from '../../core/util.ts'
import type { EngineResults } from '../../core/types.ts'
import { runRules } from '../../engine/rules.ts'
import { type Locale, t } from '../../i18n.ts'
import { decodePng, isPng } from '../../pixels/png.ts'
import type { A11ySnapshot } from '../../snapshot/schema.ts'
import { appWindows, readUiAutomatorDump, snapshotFromUiAutomator } from './uiautomator.ts'

/**
 * Collects one Android screen over adb: the UI Automator hierarchy, a screenshot taken
 * right after it, and the language the screen is in. Runs on whatever device or emulator
 * `adb devices` lists; nothing is installed on it.
 */

export interface AdbResult {
  stdout: Buffer
  stderr: string
  code: number
}

/** Runs adb with arguments, never through a shell; tests replace it. */
export type AdbRunner = (args: string[], timeoutMs?: number) => Promise<AdbResult>

const DUMP_FILE = '/data/local/tmp/rampa-window.xml'

/** RAMPA_ADB_PATH, then the SDK's platform-tools, then adb on the PATH. */
export function adbPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.RAMPA_ADB_PATH) return env.RAMPA_ADB_PATH
  const binary = process.platform === 'win32' ? 'adb.exe' : 'adb'
  for (const home of [env.ANDROID_HOME, env.ANDROID_SDK_ROOT]) {
    if (!home) continue
    const candidate = join(home, 'platform-tools', binary)
    if (existsSync(candidate)) return candidate
  }
  return 'adb'
}

export function systemAdb(path = adbPath()): AdbRunner {
  return (args, timeoutMs = 30_000) =>
    new Promise((resolve, reject) => {
      execFile(path, args, { encoding: 'buffer', maxBuffer: 128 * 1024 * 1024, timeout: timeoutMs, windowsHide: true }, (error, stdout, stderr) => {
        const failure = error as (NodeJS.ErrnoException & { killed?: boolean }) | null
        if (failure?.code === 'ENOENT') {
          reject(
            new RampaError(
              'adb-not-found',
              `adb not found (${path}). Install Android platform-tools (https://developer.android.com/tools/releases/platform-tools), put adb on your PATH, or set ANDROID_HOME or RAMPA_ADB_PATH.`,
            ),
          )
          return
        }
        if (failure?.killed) {
          reject(new RampaError('adb-timeout', `adb ${args.join(' ')} did not finish in ${Math.round(timeoutMs / 1000)} s.`))
          return
        }
        const code = typeof failure?.code === 'number' ? failure.code : failure ? 1 : 0
        resolve({ stdout, stderr: stderr.toString('utf8'), code })
      })
    })
}

export interface Device {
  serial: string
  state: string
}

/** `adb devices`: a header, then one "serial<TAB>state" line per device. Daemon messages start with "*". */
export function parseDevices(output: string): Device[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('*') && !line.startsWith('List of devices'))
    .map((line) => {
      const [serial = '', state = ''] = line.split(/\s+/)
      return { serial, state }
    })
    .filter((device) => device.serial !== '')
}

export async function chooseDevice(adb: AdbRunner, serial?: string): Promise<string> {
  const result = await adb(['devices'], 15_000)
  if (result.code !== 0) throw new RampaError('adb-failed', `adb devices failed: ${(result.stderr || result.stdout.toString('utf8')).trim()}`)
  const devices = parseDevices(result.stdout.toString('utf8'))
  const usable = (device: Device): Device => {
    if (device.state === 'device') return device
    if (device.state === 'unauthorized') {
      throw new RampaError('android-unauthorized', `Device ${device.serial} has not authorized this computer: accept the USB debugging prompt on the device, then try again.`)
    }
    throw new RampaError('android-device-state', `Device ${device.serial} is ${device.state || 'not ready'}. Reconnect it or restart the emulator, then check adb devices.`)
  }
  if (serial) {
    const found = devices.find((device) => device.serial === serial)
    if (!found) {
      const listed = devices.map((device) => device.serial).join(', ') || 'none'
      throw new RampaError('android-device-not-found', `No device ${serial} in adb devices (connected: ${listed}).`)
    }
    return usable(found).serial
  }
  if (devices.length === 0) {
    throw new RampaError(
      'android-no-device',
      'No Android device or emulator is connected. Start an emulator, or connect a device with USB debugging on, and check adb devices.',
    )
  }
  if (devices.length > 1) {
    throw new RampaError(
      'android-many-devices',
      `${devices.length} devices are connected (${devices.map((device) => device.serial).join(', ')}). Choose one: rampa check android:<serial>`,
    )
  }
  return usable(devices[0] as Device).serial
}

/** UI Automator's own errors, with what to do about them. */
function dumpProblem(output: string): string {
  if (/could not get idle state/i.test(output)) {
    return 'the screen never went idle. Turn off animations (Developer options, the three animation scales) or wait for the screen to settle, then try again.'
  }
  if (/already registered|UiAutomationService .* registered/i.test(output)) {
    return 'another UI Automator session holds the device, such as an Appium server or a running test. Stop it, then try again.'
  }
  if (/null root node/i.test(output)) return 'the screen was changing while it was read. Try again.'
  const line = output.split(/\r?\n/).find((text) => text.trim() !== '')?.trim()
  return line ? `UI Automator said: ${line.slice(0, 300)}` : 'UI Automator returned nothing.'
}

const isDump = (text: string) => /<(hierarchy|displays)\b/.test(text)

/** The dump with window titles when the device supports it, else the plain one, else through a file. */
async function dump(adb: AdbRunner, serial: string): Promise<string> {
  const problems: string[] = []
  for (const args of [
    ['exec-out', 'uiautomator', 'dump', '--windows', '/dev/tty'],
    ['exec-out', 'uiautomator', 'dump', '/dev/tty'],
  ]) {
    const result = await adb(['-s', serial, ...args], 60_000)
    const text = result.stdout.toString('utf8')
    if (isDump(text)) {
      // A --windows dump can list only system windows while the app's is being replaced: then read the plain one.
      try {
        if (appWindows(readUiAutomatorDump(text)).length > 0) return text
        problems.push('no application window in the dump')
      } catch (error) {
        problems.push(error instanceof Error ? error.message : String(error))
      }
      continue
    }
    problems.push(`${text}\n${result.stderr}`)
  }
  const written = await adb(['-s', serial, 'shell', 'uiautomator', 'dump', DUMP_FILE], 60_000)
  const read = await adb(['-s', serial, 'exec-out', 'cat', DUMP_FILE], 30_000)
  await adb(['-s', serial, 'shell', 'rm', '-f', DUMP_FILE], 10_000).catch(() => undefined)
  const text = read.stdout.toString('utf8')
  if (isDump(text)) return text
  problems.push(`${written.stdout.toString('utf8')}\n${written.stderr}\n${read.stderr}`)
  throw new RampaError('android-dump-failed', `Could not read the screen with UI Automator: ${dumpProblem(problems.join('\n'))}`)
}

async function shell(adb: AdbRunner, serial: string, ...command: string[]): Promise<string> {
  const result = await adb(['-s', serial, 'shell', ...command], 15_000).catch(() => undefined)
  return result && result.code === 0 ? result.stdout.toString('utf8').trim() : ''
}

/** The system language: persist.sys.locale since Android 7, ro.product.locale before it was ever changed, then the old pair. */
export async function deviceLocale(adb: AdbRunner, serial: string): Promise<string | undefined> {
  for (const property of ['persist.sys.locale', 'ro.product.locale']) {
    const value = await shell(adb, serial, 'getprop', property)
    if (value) return value
  }
  const language = await shell(adb, serial, 'getprop', 'persist.sys.language')
  const country = await shell(adb, serial, 'getprop', 'persist.sys.country')
  return language ? (country ? `${language}-${country}` : language) : undefined
}

/** The app's own language setting (Android 13+): "Locales for <package> for user 0 are [pt-BR,en-US]". */
export function parseAppLocales(output: string): string | undefined {
  const match = /are \[([^\]]*)\]\s*$/m.exec(output)
  return match?.[1]?.split(',')[0]?.trim() || undefined
}

/** What one screen gives: the hierarchy, the screenshot, and the language the screen is in. */
export interface AndroidScreen {
  xml: string
  png: Buffer | undefined
  locale: string | undefined
  localeSource: 'app' | 'device' | undefined
}

export async function captureAndroid(adb: AdbRunner, serial?: string): Promise<AndroidScreen & { serial: string }> {
  const device = await chooseDevice(adb, serial)
  const xml = await dump(adb, device)
  // Right after the dump, so both show the same state of the screen.
  const shot = await adb(['-s', device, 'exec-out', 'screencap', '-p'], 30_000).catch(() => undefined)
  const png = shot && isPng(shot.stdout) ? shot.stdout : undefined
  const system = await deviceLocale(adb, device)
  const packageName = snapshotFromUiAutomator(xml).target
  const app = parseAppLocales(await shell(adb, device, 'cmd', 'locale', 'get-app-locales', packageName))
  return { serial: device, xml, png, locale: app ?? system, localeSource: app ? 'app' : system ? 'device' : undefined }
}

export interface AndroidCollected {
  snapshot: A11ySnapshot
  engine: EngineResults
  notes: string[]
}

export interface AndroidCollectOptions {
  serial?: string | undefined
  /** Language of the report: the rules write their messages in it. */
  locale: Locale
  captureImages?: boolean | undefined
  adb?: AdbRunner | undefined
}

export async function collectAndroid(options: AndroidCollectOptions): Promise<AndroidCollected & { screen: AndroidScreen & { serial: string } }> {
  const screen = await captureAndroid(options.adb ?? systemAdb(), options.serial)
  return { ...fromScreen(screen, options.locale, options.captureImages), screen }
}

/** A screen, captured live or saved as a dump and a screenshot, as a snapshot and the rules' results. */
export function fromScreen(screen: AndroidScreen, locale: Locale, captureImages = true): AndroidCollected {
  const screenshot = screen.png ? decodePng(screen.png) : undefined
  const snapshot = snapshotFromUiAutomator(screen.xml, { locale: screen.locale, localeSource: screen.localeSource, screenshot, captureImages })
  const engine = runRules(snapshot, { locale, screenshot })
  const notes: string[] = []
  if (!screenshot) notes.push(t(locale, 'noteNoScreenshot'))
  if (!screen.locale) notes.push(t(locale, 'noteNoLocale'))
  notes.push(t(locale, snapshot.root.native.format === 'appium' ? 'noteAppiumSource' : 'noteUiAutomator'))
  return { snapshot, engine, notes }
}
