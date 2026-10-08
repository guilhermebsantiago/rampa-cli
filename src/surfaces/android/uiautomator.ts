import { RampaError } from '../../core/util.ts'
import type { RgbaImage } from '../../pixels/png.ts'
import type { A11yNode, A11ySnapshot, Bounds } from '../../snapshot/schema.ts'
import { walkTree } from '../../snapshot/tree.ts'
import { VERSION } from '../../version.ts'
import { type NativeDraft, captureImages, finishTree, nameFromContent, sourceTag } from '../native.ts'
import { type XmlElement, parseXml } from '../xml.ts'

/**
 * Android UI Automator hierarchy to the normalized snapshot.
 *
 * Reads the three shapes the same data comes in: `uiautomator dump` (`<hierarchy><node
 * class=…>`), `uiautomator dump --windows` (`<displays><display><window title=…>`, which
 * adds window titles), and Appium's UiAutomator2 page source (tags named after classes,
 * plus attributes such as heading and a11y-important). Classes map to ARIA-like roles,
 * names come from content-desc, then text or hint as TalkBack reads them, and bounds stay
 * in screen pixels, so a screenshot crops with a scale of 1.
 *
 * What the dump does not carry is left out rather than guessed: plain dumps have no
 * headings, no labelFor and no language per text, and keep views that are not important
 * for accessibility.
 */

export type DumpFormat = 'uiautomator' | 'uiautomator-windows' | 'appium'

export interface DumpWindow {
  title: string | undefined
  type: string | undefined
  active: boolean
  focused: boolean
  layer: number
  roots: XmlElement[]
}

export interface ParsedDump {
  format: DumpFormat
  rotation: number | undefined
  windows: DumpWindow[]
}

export interface UiAutomatorOptions {
  /** What was checked: the app package; defaults to the package most nodes belong to. */
  target?: string | undefined
  /** Default language of the screen: the app's language setting, else the device locale. */
  locale?: string | undefined
  localeSource?: 'app' | 'device' | undefined
  /** The screen as captured right after the dump, for image crops. */
  screenshot?: RgbaImage | undefined
  screenshotPath?: string | undefined
  sourcePath?: string | undefined
  captureImages?: boolean | undefined
  collectedAt?: string | undefined
}

export function readUiAutomatorDump(xml: string): ParsedDump {
  const start = xml.search(/<(\?xml|hierarchy|displays)\b/)
  if (start === -1) throw new RampaError('invalid-dump', 'Not a UI Automator dump: no <hierarchy> or <displays> element.')
  const root = parseXml(xml.slice(start))
  if (root.name === 'hierarchy') {
    const appium = root.children.some((child) => child.name !== 'node')
    return {
      format: appium ? 'appium' : 'uiautomator',
      rotation: numberOf(root.attributes.rotation),
      windows: [{ title: undefined, type: undefined, active: true, focused: true, layer: 0, roots: root.children }],
    }
  }
  if (root.name === 'displays') {
    const windows: DumpWindow[] = []
    let rotation: number | undefined
    const visit = (element: XmlElement): void => {
      for (const child of element.children) {
        if (child.name === 'display') visit(child)
        else if (child.name === 'window') {
          const hierarchy = child.children.find((grandchild) => grandchild.name === 'hierarchy')
          rotation ??= numberOf(hierarchy?.attributes.rotation)
          windows.push({
            title: child.attributes.title || undefined,
            type: child.attributes.type || undefined,
            active: child.attributes.active === 'true',
            focused: child.attributes.focused === 'true',
            layer: numberOf(child.attributes.layer) ?? 0,
            roots: hierarchy?.children ?? [],
          })
          // Child windows (popups, menus) are nested in their parent window.
          visit(child)
        }
      }
    }
    visit(root)
    return { format: 'uiautomator-windows', rotation, windows }
  }
  throw new RampaError('invalid-dump', `Not a UI Automator dump: the root element is <${root.name}>.`)
}

/** Windows that belong to the app: the status bar, the navigation bar and the keyboard are the system's. */
export function appWindows(dump: ParsedDump): DumpWindow[] {
  const app = dump.windows.filter((window) => window.type === undefined || window.type === 'TYPE_APPLICATION')
  const chosen = app.length > 0 ? app : dump.windows.filter((window) => !SYSTEM_WINDOWS.has(window.type ?? ''))
  return chosen.filter((window) => window.roots.length > 0).sort((a, b) => a.layer - b.layer)
}

const SYSTEM_WINDOWS = new Set(['TYPE_SYSTEM', 'TYPE_INPUT_METHOD', 'TYPE_ACCESSIBILITY_OVERLAY', 'TYPE_SPLIT_SCREEN_DIVIDER', 'TYPE_MAGNIFICATION_OVERLAY'])

export function snapshotFromUiAutomator(xml: string, options: UiAutomatorOptions = {}): A11ySnapshot {
  const dump = readUiAutomatorDump(xml)
  const windows = appWindows(dump)
  if (windows.length === 0) throw new RampaError('invalid-dump', 'The UI Automator dump has no application window to check.')
  // The window people are on: the active one, else the focused one, else the top one.
  const current = windows.find((window) => window.active) ?? windows.find((window) => window.focused) ?? windows.at(-1)

  const packages = new Map<string, number>()
  const children: NativeDraft[] = []
  const several = windows.length > 1
  for (const window of windows) {
    const roots = window.roots.map((element) => convert(element, undefined, packages))
    if (!several) {
      children.push(...roots)
      continue
    }
    children.push({
      id: undefined,
      type: 'window',
      node: { role: 'window', name: window.title, states: window === current ? [] : ['inactive'], native: { windowType: window.type, title: window.title } },
      children: roots,
    })
  }
  const target = options.target ?? [...packages.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'android'
  const lang = options.locale
  const root = finishTree(
    {
      id: undefined,
      type: 'hierarchy',
      node: {
        role: 'application',
        name: current?.title,
        lang,
        states: [],
        native: { format: dump.format, rotation: dump.rotation, package: target, localeSource: lang ? options.localeSource : undefined },
      },
      children,
    },
    '/hierarchy',
    'resource-id',
  )
  for (const node of walkTree(root)) if (!node.name && actionable(node)) node.name = nameFromContent(node)
  if (options.screenshot && options.captureImages !== false) captureImages(root, options.screenshot, 1)

  const extent = extentOf(root)
  return {
    schemaVersion: 1,
    surface: 'android',
    target,
    title: current?.title,
    locale: lang,
    viewport: options.screenshot
      ? { width: options.screenshot.width, height: options.screenshot.height, scale: 1 }
      : { width: extent.width, height: extent.height, scale: 1 },
    root,
    screenshot: options.screenshotPath,
    source: options.sourcePath ? { kind: 'android-xml', path: options.sourcePath } : undefined,
    collectedAt: options.collectedAt ?? new Date().toISOString(),
    collector: { name: 'rampa-android', version: VERSION },
  }
}

/** The class of a node: the class attribute, or in Appium's page source the tag name. */
function classOf(element: XmlElement): string {
  return element.attributes.class || (element.name === 'node' ? '' : element.name)
}

const EDITABLE = /(EditText|SearchAutoComplete)$/
const CLASS_ROLES: Array<[RegExp, string]> = [
  [/ImageButton$/, 'button'],
  [/(AutoCompleteTextView|Spinner)$/, 'combobox'],
  [EDITABLE, 'textbox'],
  [/CheckBox$/, 'checkbox'],
  [/(Switch|SwitchCompat|SwitchMaterial|MaterialSwitch|ToggleButton)$/, 'switch'],
  [/RadioButton$/, 'radio'],
  [/RadioGroup$/, 'radiogroup'],
  [/Button$/, 'button'],
  [/(SeekBar|RatingBar|Slider)$/, 'slider'],
  [/ProgressBar$/, 'progressbar'],
  [/(ImageView|\.Image)$/, 'img'],
  [/WebView$/, 'document'],
  [/(ListView|RecyclerView|GridView|ExpandableListView)$/, 'list'],
  [/TabWidget$/, 'tablist'],
  [/(\$Tab|TabView)$/, 'tab'],
  [/CheckedTextView$/, 'checkbox'],
  [/TextView$/, 'text'],
]

function roleOf(cls: string, attributes: Record<string, string>, parentRole: string | undefined): string {
  if (attributes.heading === 'true') return 'heading'
  const mapped = CLASS_ROLES.find(([pattern]) => pattern.test(cls))?.[1]
  if (mapped === 'checkbox' && /CheckedTextView$/.test(cls) && attributes.checkable !== 'true') return 'text'
  if (mapped) return mapped
  if (attributes.checkable === 'true') return 'checkbox'
  if (parentRole === 'list') return 'listitem'
  if (attributes.text) return 'text'
  return 'generic'
}

function convert(element: XmlElement, parentRole: string | undefined, packages: Map<string, number>): NativeDraft {
  const a = element.attributes
  const cls = classOf(element)
  const role = roleOf(cls, a, parentRole)
  if (a.package) packages.set(a.package, (packages.get(a.package) ?? 0) + 1)

  const rawText = a.text ?? ''
  const description = (a['content-desc'] ?? '').trim()
  const hint = a.hint?.trim() || undefined
  // An empty field reports its hint as its text; newer dumps say so, older ones only repeat it.
  const showingHint = a['showing-hint'] === 'true' || (EDITABLE.test(cls) && hint !== undefined && rawText === a.hint)
  const text = showingHint ? undefined : rawText.trim() || undefined

  let name: string | undefined
  let nameFrom: string | undefined
  if (description) [name, nameFrom] = [description, 'content-desc']
  else if (role === 'textbox' || role === 'combobox') {
    if (hint) [name, nameFrom] = [hint, 'hint']
  } else if (text && role !== 'generic' && role !== 'img') [name, nameFrom] = [text, 'text']

  const states: string[] = []
  const flag = (attribute: string, state: string) => {
    if (a[attribute] === 'true') states.push(state)
  }
  if (a.enabled === 'false') states.push('disabled')
  flag('checked', 'checked')
  flag('checkable', 'checkable')
  flag('selected', 'selected')
  flag('focusable', 'focusable')
  flag('focused', 'focused')
  flag('clickable', 'clickable')
  flag('long-clickable', 'long-clickable')
  flag('scrollable', 'scrollable')
  flag('password', 'password')
  if (a.displayed === 'false' || a['visible-to-user'] === 'false') states.push('hidden')
  // Appium's page source says when a view is left out of what TalkBack reads.
  if (a['a11y-important'] === 'false') states.push('not-important')

  const imageControl = /ImageButton$/.test(cls) || (role === 'img' && a.clickable === 'true')
  const bounds = parseBounds(a.bounds)
  const native: Record<string, unknown> = {
    class: cls,
    resourceId: a['resource-id'] || undefined,
    package: a.package || undefined,
    source: sourceTag(cls || 'node', [
      ['resource-id', a['resource-id']],
      ['text', rawText],
      ['content-desc', a['content-desc']],
      ['hint', a.hint],
      ['checkable', a.checkable === 'true' ? 'true' : undefined],
      ['checked', a.checked === 'true' ? 'true' : undefined],
      ['clickable', a.clickable === 'true' ? 'true' : undefined],
      ['enabled', a.enabled === 'false' ? 'false' : undefined],
      ['password', a.password === 'true' ? 'true' : undefined],
      ['heading', a.heading === 'true' ? 'true' : undefined],
      ['bounds', a.bounds],
    ]),
    uiautomator: a,
  }
  if (nameFrom) native.nameFrom = nameFrom
  // What the view draws, hint included: the text whose contrast a screenshot can measure.
  if (rawText.trim()) native.renderedText = rawText.trim()
  if (showingHint) native.showingHint = true
  if (imageControl) native.imageControl = true
  if (a.NAF === 'true') native.naf = true
  if (a['pane-title']) native.paneTitle = a['pane-title']

  return {
    id: a['resource-id'] || undefined,
    type: cls || 'node',
    node: { role: role === 'img' && states.includes('not-important') && !name ? 'presentation' : role, name, text, states, bounds, native },
    children: element.children.filter((child) => child.name !== 'hierarchy').map((child) => convert(child, role, packages)),
  }
}

/** UI Automator bounds: "[left,top][right,bottom]" in screen pixels. */
export function parseBounds(value: string | undefined): Bounds | undefined {
  const match = /^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/.exec(value?.trim() ?? '')
  if (!match) return undefined
  const [left, top, right, bottom] = match.slice(1).map(Number) as [number, number, number, number]
  if (right <= left || bottom <= top) return undefined
  return { x: left, y: top, width: right - left, height: bottom - top }
}

function numberOf(value: string | undefined): number | undefined {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) ? parsed : undefined
}

function actionable(node: A11yNode): boolean {
  return node.states.includes('clickable') || node.states.includes('long-clickable') || node.states.includes('checkable')
}

function extentOf(root: A11yNode): { width: number; height: number } {
  let width = 0
  let height = 0
  for (const node of walkTree(root)) {
    if (!node.bounds) continue
    width = Math.max(width, node.bounds.x + node.bounds.width)
    height = Math.max(height, node.bounds.y + node.bounds.height)
  }
  return { width, height }
}
