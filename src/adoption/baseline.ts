import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Finding, Report } from '../core/types.ts'
import { RampaError, errorMessage, normalizeForMatch } from '../core/util.ts'
import { VERSION } from '../version.ts'
import { compareCriteria } from '../wcag.ts'

export const BASELINE_FILE = '.rampa/baseline.json'

/** A finding as the baseline keeps it: enough to recognize it in a later run, and to read it in a diff. */
export interface BaselineEntry {
  fingerprint: string
  criterion: string
  source: 'engine' | 'judgment' | 'rule' | 'probe'
  /** The element: its snapshot ref, or the engine's selector when it has none. */
  ref?: string | undefined
  ruleId?: string | undefined
  /** What a judgment was about (the alt text, the link text). */
  subject?: string | undefined
  /** The start tag of an engine finding's element. */
  element?: string | undefined
  /** For people reading the file; never used to match. */
  message: string
}

/** How one target was recorded: a later run with another model or other criteria can find other things. */
export interface BaselineTarget {
  recordedAt: string
  llm: Report['llm']
  model?: string | undefined
  /** Engine name and version, such as `axe-core 4.14.0`. */
  engine: string
  /** The criteria the run judged. */
  criteria: string[]
  findings: BaselineEntry[]
}

export interface BaselineFile {
  schemaVersion: 1
  rampaVersion: string
  /** Per target: a file path relative to the working directory, or the URL as it was checked. */
  targets: Record<string, BaselineTarget>
}

/** How one report compares with the baseline (rampa check --baseline). */
export interface BaselineComparison {
  /** The baseline file, as given. */
  file: string
  /** The target as the baseline recorded it; undefined when the baseline has nothing for it, so every finding is new. */
  recordedAs?: string | undefined
  recorded?: Omit<BaselineTarget, 'findings'> | undefined
  /** Findings the baseline already had. They are left out of findings and belowThreshold. */
  known: Finding[]
  /** How many of the known findings were recognized by their content after their element moved. */
  moved: number
  /** Baseline findings this run checked for and did not find again: fixed, or changed beyond recognition. */
  fixed: BaselineEntry[]
  /** Baseline findings this run could not check for: no judgment, other criteria, or the model abstained or failed. */
  unchecked: BaselineEntry[]
}

/**
 * A file path relative to the working directory, with forward slashes; any other target as it is.
 * displayTarget in report/pretty.ts shows targets the same way; this one takes the directory, so a
 * key does not depend on where the code that computes it runs.
 */
export function targetKey(target: string, cwd: string = process.cwd()): string {
  if (!target.startsWith('file:')) return target
  try {
    const path = relative(cwd, fileURLToPath(target))
    return path.startsWith('..') ? target : path.split(sep).join('/')
  } catch {
    return target
  }
}

function startTag(html: string | undefined): string | undefined {
  if (!html) return undefined
  const tag = /^<[^>]*>/.exec(html.trim())?.[0] ?? html.trim()
  return tag.length > 300 ? `${tag.slice(0, 299)}…` : tag
}

export function entryOf(finding: Finding): BaselineEntry {
  return {
    fingerprint: finding.fingerprint,
    criterion: finding.criterion,
    source: finding.source,
    ref: finding.ref ?? finding.target,
    ruleId: finding.ruleId,
    subject: finding.subject,
    element: finding.source !== 'judgment' ? startTag(finding.html) : undefined,
    message: finding.message,
  }
}

/** Code-point order, so the file sorts the same on every machine and diffs stay small. */
const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

const byPlace = (a: BaselineEntry, b: BaselineEntry) =>
  compareCriteria(a.criterion, b.criterion) ||
  compareText(a.source, b.source) ||
  compareText(a.ref ?? '', b.ref ?? '') ||
  compareText(a.fingerprint, b.fingerprint)

function withoutFindings({ findings: _findings, ...recorded }: BaselineTarget): Omit<BaselineTarget, 'findings'> {
  return recorded
}

/**
 * Records every finding of these reports, confirmed or below the confidence threshold, so a later
 * --min-confidence does not turn known findings into new ones. Waived findings stay out: when a
 * waiver expires, its finding should come back. Targets of an earlier baseline that this run did
 * not check are kept.
 */
export function recordBaseline(reports: readonly Report[], previous?: BaselineFile, cwd: string = process.cwd()): BaselineFile {
  // A Map, so no target name can reach an object's prototype.
  const targets = new Map<string, BaselineTarget>(Object.entries(previous?.targets ?? {}))
  for (const report of reports) {
    targets.set(targetKey(report.target, cwd), {
      recordedAt: report.createdAt,
      llm: report.llm,
      model: report.model,
      engine: `${report.engine.name} ${report.engine.version}`,
      criteria: report.criteria.map((summary) => summary.criterion),
      findings: [...report.findings, ...report.belowThreshold].map(entryOf).sort(byPlace),
    })
  }
  const sorted = Object.fromEntries([...targets].sort(([a], [b]) => compareText(a, b)))
  return { schemaVersion: 1, rampaVersion: VERSION, targets: sorted }
}

export async function readBaseline(path: string): Promise<BaselineFile> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new RampaError('baseline-not-found', `Baseline not found: ${path}. Record one with rampa baseline <targets...>.`)
    }
    throw new RampaError('invalid-baseline', `Could not read ${path}: ${errorMessage(error)}`)
  }
  let data: Partial<BaselineFile>
  try {
    data = JSON.parse(text) as Partial<BaselineFile>
  } catch (error) {
    throw new RampaError('invalid-baseline', `${path} is not valid JSON: ${errorMessage(error)}`)
  }
  if (data.schemaVersion !== 1 || typeof data.targets !== 'object' || data.targets === null) {
    throw new RampaError('invalid-baseline', `${path} is not a Rampa baseline (schemaVersion 1 with targets).`)
  }
  for (const [target, record] of Object.entries(data.targets)) {
    if (!Array.isArray(record?.findings) || record.findings.some((entry) => typeof entry?.fingerprint !== 'string')) {
      throw new RampaError('invalid-baseline', `${path}: the findings of ${target} are not a list of fingerprinted findings.`)
    }
  }
  return data as BaselineFile
}

export async function writeBaseline(path: string, baseline: BaselineFile): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8')
}

/**
 * The address without its origin, so a baseline recorded on one host matches a preview deployment
 * of the same site on another.
 */
function pathOfUrl(target: string): string | undefined {
  if (!/^https?:\/\//i.test(target)) return undefined
  try {
    const url = new URL(target)
    return `${url.pathname}${url.search}`
  } catch {
    return undefined
  }
}

/** The baseline record of a target: the same key, or else the only URL with the same path on another host. */
export function findTarget(baseline: BaselineFile, key: string): [string, BaselineTarget] | undefined {
  const exact = Object.hasOwn(baseline.targets, key) ? baseline.targets[key] : undefined
  if (exact) return [key, exact]
  const path = pathOfUrl(key)
  if (path === undefined) return undefined
  const samePath = Object.entries(baseline.targets).filter(([other]) => pathOfUrl(other) === path)
  return samePath.length === 1 ? samePath[0] : undefined
}

/**
 * What identifies a finding when its element moved and its ref changed: the rule and the element's
 * start tag for the engine, what was judged for a judgment. Undefined when there is nothing to go on.
 */
function contentKey(entry: Pick<BaselineEntry, 'criterion' | 'source' | 'ruleId' | 'subject' | 'element'>): string | undefined {
  if (entry.source === 'engine') return entry.element ? `${entry.criterion}|engine|${entry.ruleId ?? ''}|${normalizeForMatch(entry.element)}` : undefined
  // A rule's hit is about what it read (the alt text, the title), like a judgment, and names its rule like the engine.
  if (entry.source === 'rule') return entry.subject?.trim() ? `${entry.criterion}|rule|${entry.ruleId ?? ''}|${normalizeForMatch(entry.subject)}` : undefined
  // A probe's hit is about the element it measured, like the engine's.
  if (entry.source === 'probe') return entry.element ? `${entry.criterion}|probe|${entry.ruleId ?? ''}|${normalizeForMatch(entry.element)}` : undefined
  return entry.subject?.trim() ? `${entry.criterion}|judgment|${normalizeForMatch(entry.subject)}` : undefined
}

/**
 * Whether this run would have found the entry again. Engine findings need the engine to have run;
 * judgments need the model to have judged their criterion with no abstention, error or cache miss,
 * since any of those could be the very candidate the entry was about.
 */
function rechecked(entry: BaselineEntry, report: Report): boolean {
  if (entry.source === 'engine') return report.engine.name !== 'none'
  // Rules run on every check, with or without a model, and decide the same way on the same page.
  if (entry.source === 'rule') return true
  // A probe finding is rechecked when its rule ran on a probe record this time and listed every failure it
  // counted: past the cap of findings per rule, a failure that is still there is simply not listed.
  if (entry.source === 'probe') {
    const rows = report.coverage.probes?.filter((row) => row.criterion === entry.criterion && row.status !== 'not-checked') ?? []
    if (rows.length === 0) return false
    const counted = rows.reduce((total, row) => total + row.failures, 0)
    // Under --wcag 2.1, a 2.4.11 failure is listed beyond the target.
    const listed = [...report.findings, ...report.belowThreshold, ...report.waived, ...(report.beyondTarget ?? [])].filter(
      (f) => f.source === 'probe' && f.criterion === entry.criterion,
    ).length
    return listed >= counted
  }
  if (report.llm !== 'on') return false
  const summary = report.criteria.find((c) => c.criterion === entry.criterion)
  if (!summary?.applicable || summary.cannotTell > 0 || summary.errors > 0 || summary.offlineMisses > 0) return false
  return !report.discarded.some((claim) => claim.criterion === entry.criterion && claim.ref === entry.ref)
}

export interface CompareOptions {
  cwd?: string | undefined
  /** Fingerprints reported even when the baseline has them, such as those of an expired waiver. */
  keep?: ReadonlySet<string> | undefined
}

/**
 * Leaves out of a report the findings its baseline already had. A finding matches an entry by
 * fingerprint, or else by content (see contentKey), one entry per finding, so a page that gains a
 * second copy of a known problem still reports the second one.
 */
export function compareWithBaseline(report: Report, baseline: BaselineFile, file: string, options: CompareOptions = {}): Report {
  const found = findTarget(baseline, targetKey(report.target, options.cwd))
  const entries = found?.[1].findings ?? []
  const used = new Set<number>()
  const matched = new Set<Finding>()
  let moved = 0

  const byFingerprint = new Map<string, number[]>()
  entries.forEach((entry, index) => byFingerprint.set(entry.fingerprint, [...(byFingerprint.get(entry.fingerprint) ?? []), index]))
  const current = [...report.findings, ...report.belowThreshold, ...report.waived]
  for (const finding of current) {
    const index = byFingerprint.get(finding.fingerprint)?.find((candidate) => !used.has(candidate))
    if (index === undefined) continue
    used.add(index)
    matched.add(finding)
  }
  // By content only when the pairing is certain: one leftover entry and one unmatched finding with
  // that key. Two "Read more" links could be either one, and a wrong guess hides a new problem.
  const entryKeys = entries.map(contentKey)
  const leftover = current.filter((finding) => !matched.has(finding))
  const findingKeys = new Map(leftover.map((finding) => [finding, contentKey(entryOf(finding))]))
  const count = <T>(items: Iterable<T>, key: T) => [...items].filter((item) => item === key).length
  const openKeys = entryKeys.filter((_, index) => !used.has(index))
  for (const finding of leftover) {
    const key = findingKeys.get(finding)
    if (key === undefined || count(openKeys, key) !== 1 || count(findingKeys.values(), key) !== 1) continue
    const index = entryKeys.findIndex((candidateKey, candidate) => !used.has(candidate) && candidateKey === key)
    if (index === -1) continue
    used.add(index)
    matched.add(finding)
    if (!report.waived.includes(finding) && !options.keep?.has(finding.fingerprint)) moved++
  }

  // A kept finding still uses up its entry, which is not fixed, but it stays reported.
  const hidden = (finding: Finding) => matched.has(finding) && !options.keep?.has(finding.fingerprint)
  const unmatched = entries.filter((_, index) => !used.has(index))
  const comparison: BaselineComparison = {
    file,
    recordedAs: found?.[0],
    recorded: found ? withoutFindings(found[1]) : undefined,
    known: [...report.findings, ...report.belowThreshold].filter(hidden),
    moved,
    fixed: unmatched.filter((entry) => rechecked(entry, report)),
    unchecked: unmatched.filter((entry) => !rechecked(entry, report)),
  }
  return {
    ...report,
    findings: report.findings.filter((finding) => !hidden(finding)),
    belowThreshold: report.belowThreshold.filter((finding) => !hidden(finding)),
    baseline: comparison,
  }
}
