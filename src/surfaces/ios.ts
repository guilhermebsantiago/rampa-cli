import { z } from 'zod'
import type { EngineResults } from '../core/types.ts'
import { RampaError } from '../core/util.ts'
import { runRules } from '../engine/rules.ts'
import { type Locale, t } from '../i18n.ts'
import { type RgbaImage, pngFromBase64, tryDecodePng } from '../pixels/png.ts'
import { nodeAt, NATIVE_LAYOUT_VERSION, TEXT_SIZE_VARIANT, textSizeRecord } from '../probes/native/layout.ts'
import { NATIVE_ORIENTATION_VERSION, type OrientationStep, orientationRecord } from '../probes/native/orientation.ts'
import type { NativeScreen } from '../probes/native/screen.ts'
import { type ProbeKind, skippedRecord } from '../probes/page.ts'
import type { A11yNode, A11ySnapshot, ProbeRecord } from '../snapshot/schema.ts'
import { walkTree } from '../snapshot/tree.ts'
import { VERSION } from '../version.ts'
import { type NativeDraft, captureImages, finishTree, screenshotScale, sourceTag } from './native.ts'

/**
 * An iOS screen exported by an XCUITest (integrations/ios/RampaExport.swift) to the
 * normalized snapshot. The export stays close to what XCUIElementSnapshot reports;
 * the meaning is decided here, where it can be tested: element types map to ARIA-like
 * roles, accessibilityLabel is the name and the text alternative, and frames stay in
 * points, so the screenshot crops at its own scale.
 */

export const XCUITEST_FORMAT = 'rampa-xcuitest'

/** XCUIElement.ElementType raw values, in order: 0 is any, 9 is button, 48 is staticText. */
export const ELEMENT_TYPES = [
  'any', 'other', 'application', 'group', 'window', 'sheet', 'drawer', 'alert', 'dialog', 'button',
  'radioButton', 'radioGroup', 'checkBox', 'disclosureTriangle', 'popUpButton', 'comboBox', 'menuButton', 'toolbarButton', 'popover', 'keyboard',
  'key', 'navigationBar', 'tabBar', 'tabGroup', 'toolbar', 'statusBar', 'table', 'tableRow', 'tableColumn', 'outline',
  'outlineRow', 'browser', 'collectionView', 'slider', 'pageIndicator', 'progressIndicator', 'activityIndicator', 'segmentedControl', 'picker', 'pickerWheel',
  'switch', 'toggle', 'link', 'image', 'icon', 'searchField', 'scrollView', 'scrollBar', 'staticText', 'textField',
  'secureTextField', 'datePicker', 'textView', 'menu', 'menuItem', 'menuBar', 'menuBarItem', 'map', 'webView', 'incrementArrow',
  'decrementArrow', 'timeline', 'ratingIndicator', 'valueIndicator', 'splitGroup', 'splitter', 'relevanceIndicator', 'colorWell', 'helpTag', 'matte',
  'dockItem', 'ruler', 'rulerMarker', 'grid', 'levelIndicator', 'cell', 'layoutArea', 'layoutItem', 'handle', 'stepper',
  'tab', 'touchBar', 'statusItem',
] as const

const ROLES: Record<string, string> = {
  application: 'application',
  group: 'group',
  sheet: 'dialog',
  alert: 'alertdialog',
  dialog: 'dialog',
  popover: 'dialog',
  button: 'button',
  toolbarButton: 'button',
  menuButton: 'button',
  popUpButton: 'button',
  disclosureTriangle: 'button',
  incrementArrow: 'button',
  decrementArrow: 'button',
  radioButton: 'radio',
  radioGroup: 'radiogroup',
  checkBox: 'checkbox',
  switch: 'switch',
  toggle: 'switch',
  comboBox: 'combobox',
  link: 'link',
  image: 'img',
  icon: 'img',
  staticText: 'text',
  textField: 'textbox',
  secureTextField: 'textbox',
  textView: 'textbox',
  searchField: 'searchbox',
  slider: 'slider',
  pageIndicator: 'slider',
  ratingIndicator: 'slider',
  stepper: 'spinbutton',
  pickerWheel: 'spinbutton',
  progressIndicator: 'progressbar',
  activityIndicator: 'progressbar',
  navigationBar: 'navigation',
  tabBar: 'tablist',
  tabGroup: 'tablist',
  tab: 'tab',
  toolbar: 'toolbar',
  table: 'list',
  collectionView: 'list',
  cell: 'listitem',
  outline: 'tree',
  outlineRow: 'treeitem',
  grid: 'grid',
  scrollBar: 'scrollbar',
  menu: 'menu',
  menuBar: 'menubar',
  menuItem: 'menuitem',
  menuBarItem: 'menuitem',
  webView: 'document',
}

/** The system's, not the app's: the keyboard appears whenever a field has focus. */
const SYSTEM_TYPES = new Set(['keyboard', 'statusBar'])
const FIELD_TYPES = new Set(['textField', 'secureTextField', 'searchField', 'textView'])
const LABELLED_TEXT_TYPES = new Set(['staticText', 'button', 'link', 'menuItem', 'tab', 'radioButton', 'checkBox', 'switch', 'toggle'])

const FrameSchema = z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })

export interface XcuiElement {
  type?: string | undefined
  typeRaw?: number | undefined
  identifier?: string | undefined
  label?: string | undefined
  title?: string | undefined
  value?: string | null | undefined
  placeholderValue?: string | null | undefined
  frame: z.infer<typeof FrameSchema>
  enabled?: boolean | undefined
  selected?: boolean | undefined
  hasFocus?: boolean | undefined
  traits?: string[] | undefined
  children?: XcuiElement[] | undefined
}

const ElementSchema: z.ZodType<XcuiElement> = z.lazy(() =>
  z.object({
    type: z.string().optional(),
    typeRaw: z.number().optional(),
    identifier: z.string().optional(),
    label: z.string().optional(),
    title: z.string().optional(),
    value: z.string().nullable().optional(),
    placeholderValue: z.string().nullable().optional(),
    frame: FrameSchema,
    enabled: z.boolean().optional(),
    selected: z.boolean().optional(),
    hasFocus: z.boolean().optional(),
    traits: z.array(z.string()).optional(),
    children: z.array(ElementSchema).optional(),
  }),
)

/** One state of the screen a probe helper of RampaExport.swift exported: the tree and the screenshot. */
const ProbeStepSchema = z.object({
  root: ElementSchema,
  /** PNG, base64 or a data URI. */
  screenshot: z.string().nullable().optional(),
  exportedAt: z.string().optional(),
})

const AuditIssueSchema = z.object({
  /** XCUIAccessibilityAuditType, by name: textClipped, dynamicType... */
  type: z.string(),
  description: z.string(),
  /** The element the issue is about, as the audit named it. */
  element: z
    .object({ type: z.string().optional(), identifier: z.string().optional(), label: z.string().optional(), frame: FrameSchema.optional() })
    .nullable()
    .optional(),
})

/**
 * What RampaExport.captureOrientation and RampaExport.captureTextSize add to an export (docs/ios.md, "Probes"): the
 * screen in each state a probe put it in. Rampa turns them into the probe records the rules read.
 */
const ProbesSchema = z.object({
  /** The device turned with XCUIDevice: upright, sideways, upright again; the helper puts back the orientation it found. */
  orientation: z
    .object({
      steps: z.array(ProbeStepSchema.extend({ deviceOrientation: z.string() })),
      original: z.string().optional(),
    })
    .optional(),
  /** The app launched at the default Dynamic Type size, then at a larger one (-UIPreferredContentSizeCategoryName). */
  textSize: z
    .object({
      steps: z.array(ProbeStepSchema.extend({ contentSize: z.string(), audit: z.array(AuditIssueSchema).optional(), auditError: z.string().optional() })),
    })
    .optional(),
})

export const XcuitestExportSchema = z.object({
  format: z.literal(XCUITEST_FORMAT),
  version: z.literal(1),
  exportedAt: z.string().optional(),
  bundleIdentifier: z.string().optional(),
  /** The language the app ran in, when the test knows it: given to the helper, or set with -AppleLanguages. */
  language: z.string().nullable().optional(),
  languageSource: z.string().nullable().optional(),
  /** The device's first preferred language: not necessarily the app's, which iOS picks among the app's localizations. */
  deviceLanguage: z.string().nullable().optional(),
  device: z.record(z.string(), z.unknown()).optional(),
  /** PNG, base64 or a data URI. */
  screenshot: z.string().nullable().optional(),
  root: ElementSchema,
  /** The screen in the states a probe helper put it in; absent from a plain capture. */
  probes: ProbesSchema.optional(),
})
export type XcuitestExport = z.infer<typeof XcuitestExportSchema>

export function isXcuitestExport(data: unknown): boolean {
  return typeof data === 'object' && data !== null && (data as { format?: unknown }).format === XCUITEST_FORMAT
}

export interface IosImported {
  snapshot: A11ySnapshot
  engine: EngineResults
  notes: string[]
  /** The screenshot from the export, to save next to a recording. */
  png: Buffer | undefined
}

export interface IosImportOptions {
  /** Language of the report: the rules write their messages in it. */
  locale: Locale
  captureImages?: boolean | undefined
  collectedAt?: string | undefined
  /**
   * Probe kinds asked for with --probe: only those of the export's probe steps become observations, and a kind the
   * export has no steps for is recorded as not run. Undefined reads every probe step the export holds.
   */
  probes?: readonly ProbeKind[] | undefined
}

interface Converted {
  draft: NativeDraft | undefined
  hasTraits: boolean
  /** Elements left out: the keyboard and the status bar. */
  dropped: number
}

/** An exported element tree as drafts of normalized nodes: roles, names, states and frames, as docs/ios.md says. */
function convertTree(root: XcuiElement): Converted {
  const screen = root.frame
  let hasTraits = false
  let dropped = 0
  const convert = (element: XcuiElement): NativeDraft | undefined => {
    const type = typeName(element)
    if (SYSTEM_TYPES.has(type)) {
      dropped++
      return undefined
    }
    if (element.traits) hasTraits = true
    const traits = new Set(element.traits ?? [])
    const label = element.label?.trim() ?? ''
    const placeholder = element.placeholderValue?.trim() || undefined
    const value = typeof element.value === 'string' ? element.value : undefined
    // An empty field reports its placeholder as its value.
    const showingPlaceholder = FIELD_TYPES.has(type) && placeholder !== undefined && (value === undefined || value === '' || value === element.placeholderValue)

    let role = ROLES[type] ?? 'generic'
    if (traits.has('header')) role = 'heading'
    else if (traits.has('link') && role === 'text') role = 'link'

    let name: string | undefined
    let nameFrom: string | undefined
    // A label's and a link's accessibilityLabel is their visible text: a fix changes the text, so both stay the same.
    if (label) [name, nameFrom] = [label, type === 'staticText' || type === 'link' ? 'text' : 'label']
    else if (FIELD_TYPES.has(type) && placeholder) [name, nameFrom] = [placeholder, 'placeholder']

    const states: string[] = []
    if (element.enabled === false || traits.has('notEnabled')) states.push('disabled')
    if (element.selected || traits.has('selected')) states.push('selected')
    if (element.hasFocus) states.push('focused')
    if ((type === 'switch' || type === 'toggle' || type === 'checkBox') && (value === '1' || value === 'true')) states.push('checked')
    if (type === 'secureTextField') states.push('password')
    const frame = element.frame
    if (frame.width <= 0 || frame.height <= 0) states.push('hidden')
    else if (frame.x + frame.width <= screen.x || frame.y + frame.height <= screen.y || frame.x >= screen.x + screen.width || frame.y >= screen.y + screen.height) {
      states.push('offscreen')
    }

    const fieldText = FIELD_TYPES.has(type) && !showingPlaceholder ? value?.trim() || undefined : undefined
    const text = fieldText ?? (LABELLED_TEXT_TYPES.has(type) && label ? label : undefined)
    // What the element draws: a label's text, a field's value or placeholder. A button's label may name an icon instead.
    const renderedText = type === 'staticText' || type === 'link' ? label || undefined : FIELD_TYPES.has(type) ? (fieldText ?? placeholder) : undefined
    const native: Record<string, unknown> = {
      elementType: type,
      identifier: element.identifier || undefined,
      source: sourceTag(xcuiType(type), [
        ['name', element.identifier],
        ['label', element.label],
        ['value', value],
        ['placeholderValue', element.placeholderValue ?? undefined],
        ['enabled', element.enabled === false ? 'false' : undefined],
        ['traits', element.traits?.join(' ')],
        ['x', String(frame.x)],
        ['y', String(frame.y)],
        ['width', String(frame.width)],
        ['height', String(frame.height)],
      ]),
      xcuitest: { identifier: element.identifier, label: element.label, title: element.title, value: element.value, placeholderValue: element.placeholderValue, traits: element.traits },
    }
    if (nameFrom) native.nameFrom = nameFrom
    if (renderedText) native.renderedText = renderedText
    if (showingPlaceholder) native.showingPlaceholder = true
    if (role === 'button' && traits.has('image')) native.imageControl = true

    return {
      id: element.identifier || undefined,
      type: xcuiType(type),
      node: { role, name, text, states, bounds: frame.width > 0 && frame.height > 0 ? { ...frame } : undefined, native },
      children: (element.children ?? []).flatMap((child) => convert(child) ?? []),
    }
  }
  const draft = convert(root)
  return { draft, hasTraits, dropped }
}

export function importXcuitest(data: unknown, options: IosImportOptions): IosImported {
  const parsed = XcuitestExportSchema.safeParse(data)
  if (!parsed.success) throw new RampaError('invalid-export', `Not a valid Rampa XCUITest export:\n${parsed.error.message}`)
  const exported = parsed.data
  const screen = exported.root.frame
  const { draft, hasTraits, dropped } = convertTree(exported.root)
  if (!draft) throw new RampaError('invalid-export', 'The export holds only the system keyboard or status bar.')
  // iOS picks an app's language among its localizations; the device language alone does not say which one ran.
  const language = exported.language?.trim() || undefined
  draft.node = {
    ...draft.node,
    lang: language,
    native: { ...draft.node.native, bundleIdentifier: exported.bundleIdentifier, languageSource: language ? exported.languageSource : undefined, device: exported.device, dropped },
  }
  const root = finishTree(draft, `/${draft.type}`, 'name')

  const png = exported.screenshot ? pngFromBase64(exported.screenshot) : undefined
  const screenshot = png ? tryDecodePng(png) : undefined
  const scale = screenshot ? screenshotScale(screenshot.width, screen.width) : 1
  if (screenshot && options.captureImages !== false) captureImages(root, screenshot, scale)

  const snapshot: A11ySnapshot = {
    schemaVersion: 1,
    surface: 'ios',
    target: exported.bundleIdentifier ?? 'ios',
    title: titleOf(root),
    locale: language ?? exported.deviceLanguage ?? undefined,
    viewport: { width: screen.width, height: screen.height, scale },
    root,
    collectedAt: options.collectedAt ?? exported.exportedAt ?? new Date().toISOString(),
    collector: { name: 'rampa-ios', version: VERSION },
  }
  const notes = [t(options.locale, 'noteXcuitest')]
  if (!hasTraits) notes.push(t(options.locale, 'noteXcuitestNoTraits'))
  if (!language) notes.push(t(options.locale, 'noteIosLanguage'))
  if (!screenshot) notes.push(t(options.locale, 'noteNoScreenshot'))
  const records = iosProbeRecords(exported, snapshot, options.probes)
  if (records.length > 0) snapshot.observations = { probes: records }
  return { snapshot, engine: runRules(snapshot, { locale: options.locale, screenshot }), notes, png }
}

/** The kinds of probe steps RampaExport.swift can export; iOS has no keyboard walk (docs/ios.md). */
export const IOS_PROBE_KINDS: readonly ProbeKind[] = ['layout', 'orientation']

/** Dynamic Type's body text size, in points, per content size category: the default (L) is 17. */
const BODY_POINTS: Record<string, number> = {
  UICTContentSizeCategoryXS: 14,
  UICTContentSizeCategoryS: 15,
  UICTContentSizeCategoryM: 16,
  UICTContentSizeCategoryL: 17,
  UICTContentSizeCategoryXL: 19,
  UICTContentSizeCategoryXXL: 21,
  UICTContentSizeCategoryXXXL: 23,
  UICTContentSizeCategoryAccessibilityM: 28,
  UICTContentSizeCategoryAccessibilityL: 33,
  UICTContentSizeCategoryAccessibilityXL: 40,
  UICTContentSizeCategoryAccessibilityXXL: 47,
  UICTContentSizeCategoryAccessibilityXXXL: 53,
}

/** A content size category as Settings names it: AX2 for UICTContentSizeCategoryAccessibilityL, with its body text size. */
function dynamicTypeName(category: string, points: number | undefined): string {
  const short = category.replace(/^UICTContentSizeCategory/, '')
  const accessibility = /^Accessibility(M|L|XL|XXL|XXXL)$/.exec(short)?.[1]
  const name = accessibility ? `AX${['M', 'L', 'XL', 'XXL', 'XXXL'].indexOf(accessibility) + 1}` : short
  return `Dynamic Type ${name}${points ? `, ${points} pt body text` : ''}`
}

/** XCUIDevice orientations as quarter turns of the device from upright. */
const DEVICE_QUARTERS: Record<string, number> = { portrait: 0, landscapeLeft: 1, portraitUpsideDown: 2, landscapeRight: 3 }

/** One exported state as a screen the native probe builders read. */
function iosScreen(root: XcuiElement, screenshotData: string | null | undefined, bundle: string | undefined): NativeScreen | undefined {
  const { draft } = convertTree(root)
  if (!draft) return undefined
  const tree = finishTree(draft, `/${draft.type}`, 'name')
  const png = screenshotData ? pngFromBase64(screenshotData) : undefined
  const screenshot: RgbaImage | undefined = png ? tryDecodePng(png) : undefined
  return {
    platform: 'ios',
    root: tree,
    window: { ...root.frame },
    screenshot,
    scale: screenshot ? screenshotScale(screenshot.width, root.frame.width) : 1,
    app: bundle,
  }
}

/**
 * The probe records an export's probe steps give (probes/native/): orientation from the device turned with
 * XCUIDevice, text size from the app launched at two Dynamic Type sizes. A kind asked for with --probe that the export
 * has no steps for, or that iOS has no probe for (keyboard), is recorded as not run, with what to do.
 */
export function iosProbeRecords(exported: XcuitestExport, snapshot: A11ySnapshot, kinds: readonly ProbeKind[] | undefined): ProbeRecord[] {
  const probes = exported.probes
  const wanted = (kind: ProbeKind) => (kinds ? kinds.includes(kind) : kind === 'layout' ? Boolean(probes?.textSize) : kind === 'orientation' ? Boolean(probes?.orientation) : false)
  const device = (exported.device ?? {}) as Record<string, unknown>
  const version = typeof device.systemVersion === 'string' ? ` ${device.systemVersion}` : ''
  const model = typeof device.model === 'string' ? `, ${device.model}` : ''
  const conditions: ProbeRecord['conditions'] = {
    viewport: { width: snapshot.viewport.width, height: snapshot.viewport.height },
    deviceScaleFactor: snapshot.viewport.scale,
    browser: `iOS${version}${model}, from an XCUITest export`,
  }
  const records: ProbeRecord[] = []
  const missing = (kind: ProbeKind, version: string, variant: string, reason: string) =>
    records.push({ ...skippedRecord(kind, version, variant, reason, 0), conditions: { ...conditions, variant } })

  if (kinds?.includes('keyboard')) missing('keyboard', '2', 'keyboard-walk', 'no keyboard walk on iOS: Full Keyboard Access cannot be turned on from a UI test, so RampaExport.swift does not export one')

  if (wanted('layout')) {
    const steps = probes?.textSize?.steps ?? []
    const base = steps[0]
    const larger = steps.at(-1)
    const baseScreen = base ? iosScreen(base.root, base.screenshot, exported.bundleIdentifier) : undefined
    const largerScreen = larger && larger !== base ? iosScreen(larger.root, larger.screenshot, exported.bundleIdentifier) : undefined
    if (!baseScreen || !largerScreen || !larger) {
      missing('layout', NATIVE_LAYOUT_VERSION, TEXT_SIZE_VARIANT, 'the export holds no text size steps: call RampaExport.captureTextSize in the UI test (docs/ios.md)')
    } else {
      const points = BODY_POINTS[larger.contentSize]
      const from = BODY_POINTS[base?.contentSize ?? 'UICTContentSizeCategoryL'] ?? 17
      const audit = (larger.audit ?? []).map((issue) => ({
        type: issue.type,
        description: issue.description,
        node: nodeAt(largerScreen, issue.element?.frame, issue.element?.label),
      }))
      records.push(
        textSizeRecord({
          platform: 'ios',
          snapshotRoot: snapshot.root,
          conditions,
          base: baseScreen,
          scaled: largerScreen,
          setting: dynamicTypeName(larger.contentSize, points),
          scale: points ? Math.round((points / from) * 100) / 100 : 2,
          durationMs: 0,
          ...(larger.audit ? { audit } : {}),
        }),
      )
    }
  }

  if (wanted('orientation')) {
    const steps = probes?.orientation?.steps ?? []
    const turned: OrientationStep[] = []
    for (const step of steps) {
      const screen = iosScreen(step.root, step.screenshot, exported.bundleIdentifier)
      const quarter = DEVICE_QUARTERS[step.deviceOrientation]
      if (!screen) continue
      turned.push({ requested: quarter !== undefined && quarter % 2 === 1 ? 'landscape' : 'portrait', quarter: quarter ?? 0, screen, display: undefined, set: quarter !== undefined })
    }
    if (turned.length < 2) {
      missing('orientation', NATIVE_ORIENTATION_VERSION, 'orientation', 'the export holds no orientation steps: call RampaExport.captureOrientation in the UI test (docs/ios.md)')
    } else {
      const portrait = turned[0]?.screen.window
      records.push(
        orientationRecord({
          platform: 'ios',
          snapshotRoot: snapshot.root,
          conditions,
          steps: turned,
          durationMs: 0,
          // An iPad's shorter side is 744 points and up; a phone's is under 600.
          mobile: portrait ? Math.min(portrait.width, portrait.height) < 600 : true,
          scale: snapshot.viewport.scale,
        }),
      )
    }
  }
  return records
}

function typeName(element: XcuiElement): string {
  const named = element.type?.replace(/^XCUIElementType/, '')
  const lower = named ? named.charAt(0).toLowerCase() + named.slice(1) : undefined
  if (lower && (ELEMENT_TYPES as readonly string[]).includes(lower)) return lower
  return (element.typeRaw !== undefined ? ELEMENT_TYPES[element.typeRaw] : undefined) ?? lower ?? 'other'
}

/** Appium's name for a type, which iOS testers know from page sources: XCUIElementTypeStaticText. */
function xcuiType(type: string): string {
  return `XCUIElementType${type.charAt(0).toUpperCase()}${type.slice(1)}`
}

/** The navigation bar's title: its identifier, which UIKit and SwiftUI set to the title, else its text. */
function titleOf(root: A11yNode): string | undefined {
  for (const node of walkTree(root)) {
    if (node.native.elementType !== 'navigationBar' || node.states.includes('offscreen')) continue
    const identifier = typeof node.native.identifier === 'string' ? node.native.identifier : undefined
    if (identifier) return identifier
    for (const inner of walkTree(node)) if (inner.native.elementType === 'staticText' && inner.name) return inner.name
  }
  return undefined
}
