import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { RampaError, errorMessage } from '../core/util.ts'

export const WAIVERS_FILE = '.rampa/waivers.json'

/**
 * A finding someone dismissed on purpose, and why. The file stays a JSON array whose entries are
 * objects or bare fingerprints, the format earlier versions read, so old and new readers agree.
 */
export interface Waiver {
  fingerprint: string
  /** Why the finding is acceptable, for whoever reviews the waiver. */
  reason?: string | undefined
  /** `git config user.name` of whoever added it. */
  author?: string | undefined
  /** YYYY-MM-DD, the day it was added. */
  date?: string | undefined
  /** YYYY-MM-DD, the last day it applies. */
  expires?: string | undefined
  /** Where the finding was when it was waived, for people reading the file; never used to match. */
  criterion?: string | undefined
  target?: string | undefined
  ref?: string | undefined
  message?: string | undefined
}

export type WaiverStatus = 'active' | 'expired' | 'invalid'

export interface WaiverEntry {
  /** The entry as the file has it: a rewrite keeps fields this version does not know. */
  raw: unknown
  /** Undefined when the entry is not a waiver Rampa can apply, such as an object without a fingerprint. */
  waiver: Waiver | undefined
  /** Why the entry does not apply, when it is invalid. */
  problem?: string | undefined
}

export interface WaiverFile {
  path: string
  /** False when the file does not exist yet. */
  exists: boolean
  entries: WaiverEntry[]
}

/** Fingerprints are the first 12 hex digits of a SHA-256 (see fingerprint() in core/check.ts). */
export function isFingerprint(value: string): boolean {
  return /^[0-9a-f]{12}$/.test(value)
}

/** A real calendar day written as YYYY-MM-DD. */
export function isDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

/** Today on this machine's calendar, as people read an expiry date. CI runners use UTC. */
export function today(now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** Whole days from `from` to `to`, both YYYY-MM-DD. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

function parseEntry(raw: unknown): WaiverEntry {
  if (typeof raw === 'string') {
    const fingerprint = raw.trim().toLowerCase()
    return fingerprint ? { raw, waiver: { fingerprint } } : { raw, waiver: undefined, problem: 'empty fingerprint' }
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { raw, waiver: undefined, problem: 'not a fingerprint or an object' }
  const record = raw as Record<string, unknown>
  const text = (key: string) => (typeof record[key] === 'string' ? (record[key] as string) : undefined)
  const fingerprint = text('fingerprint')?.trim().toLowerCase()
  if (!fingerprint) return { raw, waiver: undefined, problem: 'no fingerprint' }
  const waiver: Waiver = {
    fingerprint,
    reason: text('reason'),
    author: text('author'),
    date: text('date'),
    expires: text('expires'),
    criterion: text('criterion'),
    target: text('target'),
    ref: text('ref'),
    message: text('message'),
  }
  // An expiry nobody can read must not keep a finding hidden forever.
  if (record.expires !== undefined && (waiver.expires === undefined || !isDate(waiver.expires))) {
    return { raw, waiver, problem: `expires is not a YYYY-MM-DD date: ${JSON.stringify(record.expires)}` }
  }
  return { raw, waiver }
}

/** Reads the waivers file; a missing file is an empty list, a broken one an error rather than silently no waivers. */
export async function readWaivers(path: string = WAIVERS_FILE): Promise<WaiverFile> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { path, exists: false, entries: [] }
    throw new RampaError('invalid-waivers', `Could not read ${path}: ${errorMessage(error)}`)
  }
  let data: unknown
  try {
    data = text.trim() === '' ? [] : JSON.parse(text)
  } catch (error) {
    throw new RampaError('invalid-waivers', `${path} is not valid JSON: ${errorMessage(error)}`)
  }
  if (!Array.isArray(data)) throw new RampaError('invalid-waivers', `${path} must be a JSON array of waivers.`)
  return { path, exists: true, entries: data.map(parseEntry) }
}

export async function writeWaivers(file: WaiverFile): Promise<void> {
  await mkdir(dirname(file.path), { recursive: true })
  await writeFile(file.path, `${JSON.stringify(file.entries.map((entry) => entry.raw), null, 2)}\n`, 'utf8')
  file.exists = true
}

export function statusOf(entry: WaiverEntry, on: string): WaiverStatus {
  if (!entry.waiver || entry.problem) return 'invalid'
  return entry.waiver.expires !== undefined && entry.waiver.expires < on ? 'expired' : 'active'
}

/** The fingerprints that are waived on the given day. */
export function activeFingerprints(file: WaiverFile, on: string): Set<string> {
  return new Set(file.entries.filter((entry) => statusOf(entry, on) === 'active').flatMap((entry) => (entry.waiver ? [entry.waiver.fingerprint] : [])))
}

export function waiversWith(file: WaiverFile, status: WaiverStatus, on: string): Waiver[] {
  return file.entries.filter((entry) => statusOf(entry, on) === status).flatMap((entry) => (entry.waiver ? [entry.waiver] : []))
}

/**
 * Adds a waiver, or renews the one with the same fingerprint: its reason, author, dates and
 * context are replaced and any other field it had is kept.
 */
export function upsertWaiver(file: WaiverFile, waiver: Waiver): 'added' | 'updated' {
  const fields = Object.fromEntries(Object.entries(waiver).filter(([, value]) => value !== undefined))
  const index = file.entries.findIndex((entry) => entry.waiver?.fingerprint === waiver.fingerprint)
  if (index === -1) {
    file.entries.push({ raw: fields, waiver })
    return 'added'
  }
  const previous = file.entries[index]?.raw
  const kept = typeof previous === 'object' && previous !== null && !Array.isArray(previous) ? previous : {}
  // A renewal without --expires must not keep the old, possibly past, date.
  const { expires: _expires, ...rest } = kept as Record<string, unknown>
  const raw = { ...rest, ...fields }
  file.entries[index] = parseEntry(raw)
  return 'updated'
}

/** Removes the waivers that expired before the given day and returns them. */
export function pruneExpired(file: WaiverFile, on: string): Waiver[] {
  const removed: Waiver[] = []
  file.entries = file.entries.filter((entry) => {
    if (statusOf(entry, on) !== 'expired' || !entry.waiver) return true
    removed.push(entry.waiver)
    return false
  })
  return removed
}

/** `git config user.name` in the working directory, or undefined when git or the setting is missing. */
export function gitUserName(cwd: string = process.cwd()): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile('git', ['config', 'user.name'], { cwd, timeout: 5000, windowsHide: true }, (error, stdout) => {
      resolve(error ? undefined : stdout.trim() || undefined)
    })
  })
}
