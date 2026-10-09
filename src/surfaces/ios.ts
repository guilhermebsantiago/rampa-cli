import { z } from 'zod'
import type { EngineResults } from '../core/types.ts'
import { RampaError } from '../core/util.ts'
import { runRules } from '../engine/rules.ts'
import { type Locale, t } from '../i18n.ts'
import { pngFromBase64, tryDecodePng } from '../pixels/png.ts'
import type { A11yNode, A11ySnapshot } from '../snapshot/schema.ts'
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
}

export function importXcuitest(data: unknown, options: IosImportOptions): IosImported {
  const parsed = XcuitestExportSchema.safeParse(data)
  if (!parsed.success) throw new RampaError('invalid-export', `Not a valid Rampa XCUITest export:\n${parsed.error.message}`)
  const exported = parsed.data
  const screen = exported.root.frame
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

  const draft = convert(exported.root)
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
  return { snapshot, engine: runRules(snapshot, { locale: options.locale, screenshot }), notes, png }
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
