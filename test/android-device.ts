import { readFileSync } from 'node:fs'
import { encodePng, type RgbaImage } from '../src/pixels/png.ts'
import type { AdbRunner } from '../src/surfaces/android/adb.ts'
import { parseBounds } from '../src/surfaces/android/uiautomator.ts'
import { type XmlElement, parseXml } from '../src/surfaces/xml.ts'
import { type Rgb, WHITE, blank, drawText, fill } from './screens.ts'

/**
 * A fake Android device behind a fake adb, for the native probe tests. No Android device or emulator was available
 * when the probes were built, so this is all they have run against. It answers the adb commands the collector and the
 * probes send, from hand-written UI Automator dumps in test/fixtures/android/probes/ (one per state of the screen),
 * and keeps the state a device would: which node has focus, the font scale, the rotation settings.
 *
 * - Tab moves focus to the next focusable, enabled node in document order and wraps round, as Android's FocusFinder
 *   does; Shift+Tab (input keycombination 59 61) moves back. A trap keeps focus on its nodes whatever the key.
 * - font_scale 2.0 serves the screen's dump at 200%; user_rotation 1 with auto-rotate off serves the landscape dump,
 *   or keeps the portrait one at rotation 0 when the app is locked.
 * - screencap renders the dump: fills for bars, cards and buttons, text as stems, and a 3 px outline on the focused
 *   node, drawn before later siblings so a layer over it hides it, unless the node is listed with no indicator.
 */

export interface FakeDeviceOptions {
  /** The screen upright at font scale 1.0, a file name in test/fixtures/android/probes/. */
  screen: string
  fontScale2?: string | undefined
  /** The screen sideways; without it, the app keeps its portrait screen when the device turns (a lock). */
  landscape?: string | undefined
  /** Resource ids (without the package) drawn with no focus indicator. */
  noIndicator?: string[] | undefined
  /** Resource ids focus never leaves once it lands on one of them. */
  trap?: string[] | undefined
  /** When focus lands on this id, the device shows another dump from then on (another app or screen). */
  opens?: { id: string; screen: string } | undefined
  sdk?: number | undefined
  /** Settings as the device has them before the probes run; absent means never set. */
  settings?: Record<string, string> | undefined
  /** Makes a command fail: its answer is code 1. */
  fail?: ((command: string, device: FakeDevice) => boolean) | undefined
  size?: { width: number; height: number } | undefined
  /** An older UI Automator that does not know `dump --windows`: only the plain dump answers. */
  noWindowsDump?: boolean | undefined
}

export interface FakeDevice {
  adb: AdbRunner
  calls: string[]
  settings: Map<string, string>
  focused: string | undefined
}

const fixture = (name: string) => readFileSync(new URL(`./fixtures/android/probes/${name}`, import.meta.url), 'utf8')
const PACKAGE = 'com.example.shop'
const idOf = (element: XmlElement) => (element.attributes['resource-id'] ?? '').replace(/^.*:id\//, '')

function* elements(root: XmlElement): Generator<XmlElement> {
  yield root
  for (const child of root.children) yield* elements(child)
}

export function fakeDevice(options: FakeDeviceOptions): FakeDevice {
  const calls: string[] = []
  const settings = new Map(Object.entries(options.settings ?? { accelerometer_rotation: '1', user_rotation: '0' }))
  const device: FakeDevice = { adb: undefined as unknown as AdbRunner, calls, settings, focused: undefined }
  let opened: string | undefined
  const sdk = options.sdk ?? 34
  const noIndicator = new Set(options.noIndicator ?? [])

  /** The dump the device shows now, before focus is marked. */
  const current = (): { xml: string; rotation: number } => {
    if (opened) return { xml: fixture(opened), rotation: 0 }
    const sideways = settings.get('accelerometer_rotation') === '0' && settings.get('user_rotation') === '1'
    const scaled = settings.get('font_scale') === '2.0' && options.fontScale2 ? options.fontScale2 : options.screen
    if (sideways && options.landscape) return { xml: fixture(options.landscape), rotation: 1 }
    return { xml: fixture(scaled), rotation: 0 }
  }

  const focusables = (): string[] => {
    const root = parseXml(current().xml)
    return [...elements(root)].filter((element) => element.attributes.focusable === 'true' && element.attributes.enabled !== 'false' && idOf(element) !== '').map(idOf)
  }

  const move = (step: 1 | -1) => {
    const order = focusables()
    if (device.focused && options.trap?.includes(device.focused)) return
    if (order.length === 0) return
    const at = device.focused ? order.indexOf(device.focused) : -1
    device.focused = at === -1 ? (step === 1 ? order[0] : order.at(-1)) : order[(at + step + order.length) % order.length]
    if (options.opens && device.focused === options.opens.id) {
      opened = options.opens.screen
      device.focused = undefined
    }
  }

  const dump = (): string => {
    const { xml, rotation } = current()
    const marked = xml.replace(/<node\b[^>]*>/g, (tag) => {
      const id = /resource-id="[^"]*:id\/([^"]+)"/.exec(tag)?.[1]
      return tag.replace(/focused="(true|false)"/, `focused="${id !== undefined && id === device.focused ? 'true' : 'false'}"`)
    })
    return marked.replace(/<hierarchy rotation="\d"/, `<hierarchy rotation="${rotation}"`)
  }

  const adb: AdbRunner = async (args) => {
    const command = (args[0] === '-s' ? args.slice(2) : args).join(' ')
    calls.push(command)
    const ok = (stdout: string | Buffer) => ({ stdout: Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout), stderr: '', code: 0 })
    if (options.fail?.(command, device)) return { stdout: Buffer.alloc(0), stderr: `fake failure: ${command}`, code: 1 }
    if (command === 'devices') return ok('List of devices attached\nemulator-5554\tdevice\n\n')
    if (command === 'exec-out uiautomator dump --windows /dev/tty') {
      if (options.noWindowsDump) return { stdout: Buffer.from('Error: Unknown option: --windows\n'), stderr: '', code: 1 }
      return ok(`${dump()}UI hierchary dumped to: /dev/tty\n`)
    }
    if (command === 'exec-out uiautomator dump /dev/tty') return ok(`${dump()}UI hierchary dumped to: /dev/tty\n`)
    if (command === 'exec-out screencap -p') return ok(encodePng(render(parseXml(dump()), device.focused, noIndicator)))
    if (command === 'shell getprop ro.build.version.release') return ok(`${sdk >= 34 ? 14 : 12}\n`)
    if (command === 'shell getprop ro.build.version.sdk') return ok(`${sdk}\n`)
    if (command === 'shell getprop ro.product.model') return ok('sdk_gphone64_x86_64\n')
    if (command === 'shell getprop persist.sys.locale') return ok('en-US\n')
    if (command.startsWith('shell getprop')) return ok('\n')
    if (command.startsWith('shell cmd locale get-app-locales')) return ok(`Locales for ${PACKAGE} for user 0 are []\n`)
    if (command === 'shell wm size') return ok(`Physical size: ${options.size?.width ?? 360}x${options.size?.height ?? 760}\n`)
    if (command === 'shell wm density') return ok('Physical density: 160\n')
    const get = /^shell settings get system (\S+)$/.exec(command)
    if (get) return ok(`${settings.get(get[1] as string) ?? 'null'}\n`)
    const put = /^shell settings put system (\S+) (\S+)$/.exec(command)
    if (put) {
      settings.set(put[1] as string, put[2] as string)
      return ok('')
    }
    const remove = /^shell settings delete system (\S+)$/.exec(command)
    if (remove) {
      settings.delete(remove[1] as string)
      return ok('Deleted 1 rows\n')
    }
    if (command === 'shell input keyevent 61') {
      move(1)
      return ok('')
    }
    if (/^shell input keyevent (19|20|21|22)$/.test(command)) {
      // The arrows move focus as Tab does on this flat screen; a trap keeps it.
      move(command.endsWith('19') || command.endsWith('21') ? -1 : 1)
      return ok('')
    }
    if (command === 'shell input keycombination 59 61') {
      if (sdk < 33) return { stdout: Buffer.from('Error: Unknown command: keycombination\n'), stderr: '', code: 1 }
      move(-1)
      return ok('')
    }
    return { stdout: Buffer.alloc(0), stderr: `unknown command ${command}`, code: 1 }
  }
  device.adb = adb
  return device
}

const DARK: Rgb = [0x20, 0x20, 0x20]
const FILLS: Array<[RegExp, Rgb]> = [
  [/CardView$/, [0x30, 0x30, 0x30]],
  [/Toolbar$/, [0xf0, 0xf0, 0xf0]],
  [/(?<!Image)Button$/, [0xe0, 0xe0, 0xe0]],
  [/(ImageButton|ImageView)$/, [0x9e, 0x9e, 0x9e]],
]
const RING: Rgb = [0x1a, 0x73, 0xe8]

/** The dump drawn as a screen, in document order, the focused node ringed before later siblings cover it. */
function render(root: XmlElement, focused: string | undefined, noIndicator: Set<string>): RgbaImage {
  const bounds = (element: XmlElement) => parseBounds(element.attributes.bounds)
  const top = [...elements(root)].map(bounds).find(Boolean)
  const image = blank(top ? top.x + top.width : 360, top ? top.y + top.height : 760, WHITE)
  const draw = (element: XmlElement, background: Rgb) => {
    const b = bounds(element)
    let under = background
    if (b) {
      const cls = element.attributes.class ?? ''
      const color = FILLS.find(([pattern]) => pattern.test(cls))?.[1]
      if (color) {
        fill(image, b, color)
        under = color
      }
      const text = element.attributes.text ?? ''
      if (text && b.width > 8 && b.height > 8) {
        const ink: Rgb = under[0] < 0x80 ? WHITE : DARK
        drawText(image, { x: b.x + 2, y: b.y + 2, width: b.width - 4, height: b.height - 4 }, ink, under)
      }
    }
    for (const child of element.children) draw(child, under)
    const id = idOf(element)
    if (b && id !== '' && id === focused && !noIndicator.has(id)) {
      fill(image, { x: b.x, y: b.y, width: b.width, height: 3 }, RING)
      fill(image, { x: b.x, y: b.y + b.height - 3, width: b.width, height: 3 }, RING)
      fill(image, { x: b.x, y: b.y, width: 3, height: b.height }, RING)
      fill(image, { x: b.x + b.width - 3, y: b.y, width: 3, height: b.height }, RING)
    }
  }
  draw(root, WHITE)
  return image
}
