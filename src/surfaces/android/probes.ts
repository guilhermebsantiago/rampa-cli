import { RampaError, errorMessage } from '../../core/util.ts'
import { tryDecodePng } from '../../pixels/png.ts'
import { type KeyDriver, NATIVE_KEYBOARD_VERSION, type NativeKey, nativeKeyboardWalk } from '../../probes/native/keyboard.ts'
import { NATIVE_LAYOUT_VERSION, TEXT_SIZE_VARIANT, textSizeRecord } from '../../probes/native/layout.ts'
import { NATIVE_ORIENTATION_VERSION, type OrientationStep, orientationRecord } from '../../probes/native/orientation.ts'
import { type NativeScreen, windowOf } from '../../probes/native/screen.ts'
import { type ProbeKind, skippedRecord } from '../../probes/page.ts'
import type { A11ySnapshot, Bounds, ProbeRecord } from '../../snapshot/schema.ts'
import { type AdbRunner, dumpWindow, screencap, shell } from './adb.ts'
import { parseBounds, readUiAutomatorDump, snapshotFromUiAutomator } from './uiautomator.ts'

/**
 * The probes on an Android screen (D7 of the coverage plan; docs/probes.md, "App screens"), over adb, with nothing
 * installed on the device:
 * - keyboard: Tab (`input keyevent 61`) and Shift+Tab (`input keycombination 59 61`, Android 13 and later) as hardware
 *   keyboard events, the screen dumped after each and captured with `screencap` on the forward walk; arrows only to
 *   try to leave a suspected trap. Esc, Enter and Space are never pressed.
 * - layout: the system font scale set to 1.0, then 2.0 (`settings put system font_scale`), the screen dumped at each,
 *   and once more after the setting is put back.
 * - orientation: auto-rotate off, the rotation set upright, sideways and upright again (`settings put system
 *   user_rotation`), the screen dumped and captured at each.
 * Every setting a probe changes is read first and put back when the probe ends, fails or is interrupted (Ctrl+C).
 *
 * This has been run only against a fake adb that serves hand-written dumps (test/android-device.ts): no Android device
 * or emulator was available while it was built.
 */

/** The probe kinds that run on an Android screen; the others drive a browser. */
export const ANDROID_PROBE_KINDS: readonly ProbeKind[] = ['keyboard', 'layout', 'orientation']

const KEYCODES: Record<Exclude<NativeKey, 'Shift+Tab'>, number> = { Tab: 61, ArrowUp: 19, ArrowDown: 20, ArrowLeft: 21, ArrowRight: 22 }
const KEYCODE_SHIFT_LEFT = 59
/** After a setting changes, the app recreates its screen; UI Automator's dump then waits for it to go idle. */
const SETTLE_MS = 1500

export interface AndroidProbeOptions {
  adb: AdbRunner
  serial: string
  kinds: readonly ProbeKind[]
  /** The screen as collected: probe records name its nodes. */
  snapshot: A11ySnapshot
  /** Test hooks: waits, and what happens on Ctrl+C while a setting is changed. */
  sleep?: ((ms: number) => Promise<void>) | undefined
  settleMs?: number | undefined
  onInterrupt?: ((restore: () => Promise<void>) => () => void) | undefined
  /** Budgets for the keyboard walk. */
  stopBudget?: number | undefined
  timeBudgetMs?: number | undefined
}

export interface AndroidProbeRun {
  records: ProbeRecord[]
  /** What the person must know: a setting Rampa could not put back. */
  warnings: string[]
  /** Kinds asked for that do not run on an Android screen. */
  leftOut: ProbeKind[]
}

/** A dump (and its screenshot) as a screen the native probes read. */
export function androidScreen(xml: string, png?: Buffer | undefined): NativeScreen {
  const screenshot = png ? tryDecodePng(png) : undefined
  const snapshot = snapshotFromUiAutomator(xml, { screenshot, captureImages: false })
  const parsed = readUiAutomatorDump(xml)
  let ime: Bounds | undefined
  for (const window of parsed.windows) {
    if (window.type !== 'TYPE_INPUT_METHOD') continue
    for (const root of window.roots) {
      const b = parseBounds(root.attributes.bounds)
      if (!b) continue
      ime = ime ? union(ime, b) : b
    }
  }
  return {
    platform: 'android',
    root: snapshot.root,
    window: windowOf(snapshot.root),
    screenshot,
    scale: 1,
    rotation: parsed.rotation,
    ...(ime ? { ime } : {}),
    app: snapshot.target,
  }
}

function union(a: Bounds, b: Bounds): Bounds {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y }
}

interface DeviceInfo {
  sdk: number
  conditions: ProbeRecord['conditions']
  /** The smallest width in dp: under 600, a phone. */
  smallestWidthDp: number | undefined
}

async function deviceInfo(adb: AdbRunner, serial: string): Promise<DeviceInfo> {
  const release = await shell(adb, serial, 'getprop', 'ro.build.version.release')
  const sdk = Number.parseInt(await shell(adb, serial, 'getprop', 'ro.build.version.sdk'), 10)
  const model = await shell(adb, serial, 'getprop', 'ro.product.model')
  const size = await shell(adb, serial, 'wm', 'size')
  const density = await shell(adb, serial, 'wm', 'density')
  // The override, when someone set one, is what apps lay out against.
  const pick = (text: string, pattern: RegExp) => [...text.matchAll(pattern)].at(-1)
  const sizeMatch = pick(size, /size:\s*(\d+)x(\d+)/gi)
  const densityMatch = pick(density, /density:\s*(\d+)/gi)
  const width = Number(sizeMatch?.[1]) || 0
  const height = Number(sizeMatch?.[2]) || 0
  const dpi = Number(densityMatch?.[1]) || 0
  const scale = dpi > 0 ? Math.round((dpi / 160) * 1000) / 1000 : 1
  const version = release ? `Android ${release}${Number.isFinite(sdk) ? ` (API ${sdk})` : ''}` : 'Android'
  return {
    sdk: Number.isFinite(sdk) ? sdk : 0,
    conditions: { viewport: { width, height }, deviceScaleFactor: scale, browser: `${version}${model ? `, ${model}` : ''}, over adb` },
    smallestWidthDp: width > 0 && height > 0 && dpi > 0 ? Math.round(Math.min(width, height) / (dpi / 160)) : undefined,
  }
}

/** A system setting as `settings get` prints it; undefined when it was never set ("null"). */
async function getSetting(adb: AdbRunner, serial: string, key: string): Promise<string | undefined> {
  const result = await adb(['-s', serial, 'shell', 'settings', 'get', 'system', key], 15_000)
  if (result.code !== 0) throw new RampaError('adb-failed', `adb shell settings get system ${key} failed: ${(result.stderr || result.stdout.toString('utf8')).trim()}`)
  const value = result.stdout.toString('utf8').trim()
  return value === '' || value === 'null' ? undefined : value
}

/** Sets a system setting, or deletes it to give it back its default. */
async function putSetting(adb: AdbRunner, serial: string, key: string, value: string | undefined): Promise<void> {
  const args = value === undefined ? ['settings', 'delete', 'system', key] : ['settings', 'put', 'system', key, value]
  const result = await adb(['-s', serial, 'shell', ...args], 15_000)
  if (result.code !== 0) throw new RampaError('adb-failed', `adb shell ${args.join(' ')} failed: ${(result.stderr || result.stdout.toString('utf8')).trim()}`)
}

/** On Ctrl+C or a kill while a setting is changed: put it back, then stop. */
export function restoreOnInterrupt(restore: () => Promise<void>): () => void {
  const handler = (signal: NodeJS.Signals) => {
    process.stderr.write(`\nrampa: ${signal}: putting the device settings back before stopping.\n`)
    void restore().finally(() => process.exit(signal === 'SIGINT' ? 130 : 143))
  }
  process.once('SIGINT', handler)
  process.once('SIGTERM', handler)
  return () => {
    process.off('SIGINT', handler)
    process.off('SIGTERM', handler)
  }
}

interface Context {
  adb: AdbRunner
  serial: string
  sleep: (ms: number) => Promise<void>
  settleMs: number
  warnings: string[]
  onInterrupt: (restore: () => Promise<void>) => () => void
  /** Which dump the device answers (dumpWindow). */
  dump: { plain?: boolean }
}

/**
 * Reads the settings `keys`, runs `body`, and puts them back as they were when it ends, fails or is interrupted. The
 * body may restore them itself earlier (to read the screen once they are back); restoring twice does nothing.
 */
async function withSettings<T>(ctx: Context, keys: readonly string[], body: (restore: () => Promise<void>) => Promise<T>): Promise<T> {
  const saved: Array<[string, string | undefined]> = []
  for (const key of keys) saved.push([key, await getSetting(ctx.adb, ctx.serial, key)])
  let restored = false
  const restore = async () => {
    if (restored) return
    restored = true
    for (const [key, value] of [...saved].reverse()) {
      try {
        await putSetting(ctx.adb, ctx.serial, key, value)
      } catch (error) {
        const command = value === undefined ? `settings delete system ${key}` : `settings put system ${key} ${value}`
        ctx.warnings.push(`Rampa could not put ${key} back to ${value ?? 'its default'} on ${ctx.serial} (${errorMessage(error).split('\n')[0]}). Put it back with: adb -s ${ctx.serial} shell ${command}`)
      }
    }
  }
  const release = ctx.onInterrupt(restore)
  try {
    return await body(restore)
  } finally {
    release()
    await restore()
  }
}

async function read(ctx: Context, screenshot: boolean): Promise<NativeScreen> {
  const xml = await dumpWindow(ctx.adb, ctx.serial, ctx.dump)
  return androidScreen(xml, screenshot ? await screencap(ctx.adb, ctx.serial) : undefined)
}

function keyDriver(ctx: Context, sdk: number): KeyDriver {
  return {
    read: ({ screenshot }) => read(ctx, screenshot),
    press: async (key) => {
      if (key === 'Shift+Tab') {
        // `input keycombination` came with Android 13; before it, adb has no way to hold Shift.
        if (sdk > 0 && sdk < 33) return false
        const result = await ctx.adb(['-s', ctx.serial, 'shell', 'input', 'keycombination', String(KEYCODE_SHIFT_LEFT), String(KEYCODES.Tab)], 15_000)
        const said = `${result.stdout.toString('utf8')}\n${result.stderr}`
        return result.code === 0 && !/error|unknown|usage/i.test(said)
      }
      const result = await ctx.adb(['-s', ctx.serial, 'shell', 'input', 'keyevent', String(KEYCODES[key])], 15_000)
      if (result.code !== 0) throw new RampaError('adb-failed', `adb shell input keyevent ${KEYCODES[key]} failed: ${(result.stderr || result.stdout.toString('utf8')).trim()}`)
      return true
    },
    now: () => Date.now(),
    wait: (ms) => ctx.sleep(ms),
  }
}

/** 1.4.4: the screen at font scale 1.0 and at 2.0, then once more after the setting is put back. */
async function textSizeProbe(ctx: Context, snapshot: A11ySnapshot, info: DeviceInfo): Promise<ProbeRecord> {
  const started = Date.now()
  return withSettings(ctx, ['font_scale'], async (restore) => {
    await putSetting(ctx.adb, ctx.serial, 'font_scale', '1.0')
    await ctx.sleep(ctx.settleMs)
    const base = await read(ctx, false)
    await putSetting(ctx.adb, ctx.serial, 'font_scale', '2.0')
    await ctx.sleep(ctx.settleMs)
    const scaled = await read(ctx, false)
    await restore()
    await ctx.sleep(ctx.settleMs)
    const back = await read(ctx, false)
    return textSizeRecord({ platform: 'android', snapshotRoot: snapshot.root, conditions: info.conditions, base, scaled, back, setting: 'font_scale 2.0', scale: 2, durationMs: Date.now() - started })
  })
}

/** 1.3.4: auto-rotate off, the device set upright, sideways and upright again; the settings are put back after. */
async function orientationProbe(ctx: Context, snapshot: A11ySnapshot, info: DeviceInfo): Promise<ProbeRecord> {
  const started = Date.now()
  return withSettings(ctx, ['accelerometer_rotation', 'user_rotation'], async (restore) => {
    await putSetting(ctx.adb, ctx.serial, 'accelerometer_rotation', '0')
    const steps: OrientationStep[] = []
    for (const [requested, quarter] of [
      ['portrait', 0],
      ['landscape', 1],
      ['portrait', 0],
    ] as const) {
      await putSetting(ctx.adb, ctx.serial, 'user_rotation', String(quarter))
      await ctx.sleep(ctx.settleMs)
      const set = (await getSetting(ctx.adb, ctx.serial, 'user_rotation')) === String(quarter)
      const screen = await read(ctx, true)
      steps.push({ requested, quarter, screen, display: screen.rotation, set })
    }
    await restore()
    return orientationRecord({
      platform: 'android',
      snapshotRoot: snapshot.root,
      conditions: info.conditions,
      steps,
      durationMs: Date.now() - started,
      mobile: info.smallestWidthDp === undefined || info.smallestWidthDp < 600,
      scale: info.conditions.deviceScaleFactor,
    })
  })
}

/**
 * Runs the asked kinds that apply to an Android screen, keyboard first (it changes no setting), then text size and
 * orientation (each recreates the app's screen). A probe that fails leaves a skipped record and never fails the check.
 */
export async function runAndroidProbes(options: AndroidProbeOptions): Promise<AndroidProbeRun> {
  const kinds = (['keyboard', 'layout', 'orientation'] as const).filter((kind) => options.kinds.includes(kind))
  const leftOut = options.kinds.filter((kind) => !ANDROID_PROBE_KINDS.includes(kind))
  const ctx: Context = {
    adb: options.adb,
    serial: options.serial,
    sleep: options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    settleMs: options.settleMs ?? SETTLE_MS,
    warnings: [],
    onInterrupt: options.onInterrupt ?? restoreOnInterrupt,
    dump: {},
  }
  const records: ProbeRecord[] = []
  if (kinds.length === 0) return { records, warnings: ctx.warnings, leftOut }
  const info = await deviceInfo(ctx.adb, ctx.serial)
  for (const kind of kinds) {
    const started = Date.now()
    const [version, variant] = kind === 'keyboard' ? [NATIVE_KEYBOARD_VERSION, 'keyboard-walk'] : kind === 'layout' ? [NATIVE_LAYOUT_VERSION, TEXT_SIZE_VARIANT] : [NATIVE_ORIENTATION_VERSION, 'orientation']
    try {
      if (kind === 'keyboard') {
        records.push(
          await nativeKeyboardWalk(keyDriver(ctx, info.sdk), {
            platform: 'android',
            snapshotRoot: options.snapshot.root,
            conditions: info.conditions,
            budget: options.stopBudget,
            timeBudgetMs: options.timeBudgetMs,
          }),
        )
      } else if (kind === 'layout') records.push(await textSizeProbe(ctx, options.snapshot, info))
      else records.push(await orientationProbe(ctx, options.snapshot, info))
    } catch (error) {
      const record = skippedRecord(kind, version, variant, `probe failed: ${errorMessage(error).split('\n')[0]}`, Date.now() - started)
      records.push({ ...record, conditions: { ...info.conditions, variant } })
    }
  }
  return { records, warnings: ctx.warnings, leftOut }
}
