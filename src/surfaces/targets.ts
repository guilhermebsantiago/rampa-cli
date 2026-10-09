import { readFile, readdir, stat } from 'node:fs/promises'
import type { EngineResults } from '../core/types.ts'
import { dirname, extname, isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { RampaError } from '../core/util.ts'
import { emptyEngine } from '../engine/axe.ts'
import { runRules } from '../engine/rules.ts'
import { type Locale, t } from '../i18n.ts'
import { type RgbaImage, isPng, pngFromBase64, tryDecodePng } from '../pixels/png.ts'
import { type A11ySnapshot, A11ySnapshotSchema } from '../snapshot/schema.ts'
import { importXcuitest, isXcuitestExport } from './ios.ts'

export type Target =
  | { kind: 'web'; url: string; label: string }
  | { kind: 'snapshot'; path: string; label: string }
  | { kind: 'android'; serial: string | undefined; label: string }
  | { kind: 'android-dump'; path: string; label: string }
  | { kind: 'image'; path: string; label: string }

const LOSSY = new Set(['.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.heic', '.avif'])

/**
 * URLs, HTML files, folders of HTML files, snapshot .json files exported by any platform
 * (XCUITest exports included), UI Automator .xml dumps, .png screenshots, and android:
 * for the device adb sees (android:<serial> when there are several).
 */
export async function resolveTargets(inputs: readonly string[]): Promise<Target[]> {
  const targets: Target[] = []
  for (const input of inputs) {
    if (/^https?:\/\//i.test(input) || input.startsWith('file://')) {
      targets.push({ kind: 'web', url: input, label: input })
      continue
    }
    const device = /^android:(.*)$/i.exec(input)
    if (device) {
      const serial = device[1]?.trim() || undefined
      if (serial && !/^[\w.:[\]-]+$/.test(serial)) throw new RampaError('unsupported-target', `Not a device serial: ${serial}. Use android: or android:<serial> from adb devices.`)
      targets.push({ kind: 'android', serial, label: input })
      continue
    }
    if (/^ios:/i.test(input)) {
      throw new RampaError(
        'unsupported-target',
        'Rampa reads iOS screens from an XCUITest export, because capturing one needs a Mac: add integrations/ios/RampaExport.swift to your UI tests (docs/ios.md) and check the .json it writes.',
      )
    }
    const path = resolve(input)
    const info = await stat(path).catch(() => undefined)
    if (!info) throw new RampaError('target-not-found', `Target not found: ${input}`)
    if (info.isDirectory()) {
      for (const file of await htmlFilesIn(path)) {
        targets.push({ kind: 'web', url: pathToFileURL(file).href, label: file })
      }
      continue
    }
    const ext = extname(path).toLowerCase()
    if (ext === '.json') targets.push({ kind: 'snapshot', path, label: input })
    else if (ext === '.html' || ext === '.htm') targets.push({ kind: 'web', url: pathToFileURL(path).href, label: input })
    else if (ext === '.xml') targets.push({ kind: 'android-dump', path, label: input })
    else if (ext === '.png') targets.push({ kind: 'image', path, label: input })
    else if (LOSSY.has(ext)) {
      throw new RampaError('unsupported-image', `${input}: only PNG screenshots. Lossy formats change the colors contrast is measured from; export or convert the screen to PNG.`)
    } else {
      throw new RampaError(
        'unsupported-target',
        `Unsupported target: ${input}. Use a URL, an .html file, a folder, a snapshot or XCUITest .json, a UI Automator .xml, a .png screenshot, or android:.`,
      )
    }
  }
  return targets
}

async function htmlFilesIn(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true })
  return entries
    .filter((entry) => entry.isFile() && /\.html?$/i.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name))
    .sort()
}

/** A Rampa snapshot, or an XCUITest export turned into one. */
export async function loadSnapshot(path: string): Promise<A11ySnapshot> {
  const data: unknown = JSON.parse(await readFile(path, 'utf8'))
  if (isXcuitestExport(data)) return importXcuitest(data, { locale: 'en' }).snapshot
  return parseSnapshot(data, path)
}

function parseSnapshot(data: unknown, path: string): A11ySnapshot {
  const parsed = A11ySnapshotSchema.safeParse(data)
  if (!parsed.success) {
    // The first few problems, one line: a .json that is not a snapshot at all fails on every field.
    const issues = parsed.error.issues.map((issue) => `${issue.path.map(String).join('.') || 'the file'}: ${issue.message}`)
    const more = issues.length > 3 ? `, and ${issues.length - 3} more` : ''
    throw new RampaError('invalid-snapshot', `${path} is not a valid Rampa snapshot (${issues.slice(0, 3).join('; ')}${more})`)
  }
  return parsed.data
}

export interface Loaded {
  snapshot: A11ySnapshot
  engine: EngineResults
  notes: string[]
  /** The screenshot that came with an XCUITest export, to keep next to a recording. */
  png?: Buffer | undefined
  from: 'xcuitest' | 'snapshot'
}

/**
 * A .json target ready to check: an XCUITest export goes through the importer and the
 * rules; a recorded snapshot comes with its recorded engine results, and an app snapshot
 * recorded without them gets the rules, with its screenshot when it can be found.
 */
export async function loadRecorded(path: string, locale: Locale, captureImages = true): Promise<Loaded> {
  const data: unknown = JSON.parse(await readFile(path, 'utf8'))
  if (isXcuitestExport(data)) return { ...importXcuitest(data, { locale, captureImages }), from: 'xcuitest' }
  const snapshot = parseSnapshot(data, path)
  const notes = scopeNotes(snapshot, locale)
  const recorded = await loadEngineFor(path)
  if (recorded) return { snapshot, engine: recorded, notes, from: 'snapshot' }
  if (snapshot.surface === 'web') return { snapshot, engine: emptyEngine(), notes, from: 'snapshot' }
  return { snapshot, engine: runRules(snapshot, { locale, screenshot: await screenshotOf(snapshot, path) }), notes, from: 'snapshot' }
}

/** What a recording's source could never show, said again when it is replayed. */
function scopeNotes(snapshot: A11ySnapshot, locale: Locale): string[] {
  if (snapshot.surface === 'image') return [t(locale, 'noteImageScope')]
  if (snapshot.surface === 'ios' && snapshot.collector.name === 'rampa-ios') return [t(locale, 'noteXcuitest')]
  if (snapshot.surface === 'android' && snapshot.collector.name === 'rampa-android') {
    return [t(locale, snapshot.root.native.format === 'appium' ? 'noteAppiumSource' : 'noteUiAutomator')]
  }
  return []
}

/** The snapshot's screenshot: a data URI, or a PNG path relative to the snapshot or the working directory. */
async function screenshotOf(snapshot: A11ySnapshot, snapshotPath: string): Promise<RgbaImage | undefined> {
  const value = snapshot.screenshot
  if (!value) return undefined
  if (value.startsWith('data:')) {
    const png = pngFromBase64(value)
    return png ? tryDecodePng(png) : undefined
  }
  for (const candidate of isAbsolute(value) ? [value] : [join(dirname(snapshotPath), value), resolve(value)]) {
    const bytes = await readFile(candidate).catch(() => undefined)
    if (bytes && isPng(bytes)) return tryDecodePng(bytes)
  }
  return undefined
}

/** Engine results recorded next to a snapshot by `rampa check --save`: `x.snapshot.json` becomes `x.engine.json`. */
export async function loadEngineFor(snapshotPath: string): Promise<EngineResults | undefined> {
  const enginePath = snapshotPath.endsWith('.snapshot.json')
    ? snapshotPath.replace(/\.snapshot\.json$/, '.engine.json')
    : snapshotPath.replace(/\.json$/, '.engine.json')
  try {
    const engine = JSON.parse(await readFile(enginePath, 'utf8')) as EngineResults
    return engine?.engine?.name && Array.isArray(engine.rules) ? engine : undefined
  } catch {
    return undefined
  }
}

/** The screenshot saved next to a UI Automator dump: `login.xml` goes with `login.png`. */
export async function siblingPng(dumpPath: string): Promise<Buffer | undefined> {
  const bytes = await readFile(dumpPath.replace(/\.xml$/i, '.png')).catch(() => undefined)
  return bytes && isPng(bytes) ? bytes : undefined
}

/** A file-system friendly name for a target: `examples/store/before.html` becomes `examples-store-before`. */
export function recordingName(label: string): string {
  const name = label
    .replace(/^[a-z]+:\/\//i, '')
    .replace(/\.(html?|xml|png|json)$/i, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
  return name || 'page'
}
