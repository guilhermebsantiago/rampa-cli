import { readFile } from 'node:fs/promises'
import { BASELINE_FILE, type BaselineFile, readBaseline, targetKey } from '../../adoption/baseline.ts'
import {
  WAIVERS_FILE,
  type Waiver,
  type WaiverFile,
  daysBetween,
  gitUserName,
  isDate,
  isFingerprint,
  pruneExpired,
  readWaivers,
  statusOf,
  today,
  upsertWaiver,
  writeWaivers,
} from '../../adoption/waivers.ts'
import type { Finding, Report } from '../../core/types.ts'
import { RampaError, errorMessage } from '../../core/util.ts'
import { type Painter, colorsEnabled, paint } from '../../report/color.ts'
import type { GlobalContext } from '../context.ts'

export interface WaiveOptions {
  reason: string
  expires?: string
  file?: string
  /** JSON reports (rampa check -o) to look the fingerprint up in, so the waiver says what it is about. */
  report?: string[]
}

export interface WaiversOptions {
  file?: string
  /** JSON reports to tell unused waivers from the ones still hiding a finding. */
  report?: string[]
  prune?: boolean
  format: 'pretty' | 'json'
}

/** Reports as rampa check -o writes them: one report, or a list of them. */
export async function readReports(paths: readonly string[]): Promise<Report[]> {
  const reports: Report[] = []
  for (const path of paths) {
    let data: unknown
    try {
      data = JSON.parse(await readFile(path, 'utf8'))
    } catch (error) {
      throw new RampaError('invalid-report', `Could not read the report ${path}: ${errorMessage(error)}`)
    }
    for (const report of Array.isArray(data) ? data : [data]) {
      if (typeof report !== 'object' || report === null || !Array.isArray((report as Report).findings)) {
        throw new RampaError('invalid-report', `${path} is not a JSON report from rampa check --format json or -o.`)
      }
      reports.push(report as Report)
    }
  }
  return reports
}

/** Every finding a report holds, including the waived ones and those a baseline hid, and the advisories of a --profile, which waive the same way. */
function findingsOf(report: Report): Array<Pick<Finding, 'fingerprint' | 'criterion' | 'ref' | 'target' | 'message'>> {
  const advisories = report.advisory ? [...report.advisory.results, ...report.advisory.belowThreshold, ...report.advisory.waived] : []
  return [
    ...report.findings,
    ...(report.belowThreshold ?? []),
    ...(report.waived ?? []),
    ...(report.baseline?.known ?? []),
    ...advisories.map((advisory) => ({ fingerprint: advisory.fingerprint, criterion: advisory.check, ref: advisory.ref, target: undefined, message: advisory.message })),
  ]
}

type Context = Pick<Waiver, 'criterion' | 'target' | 'ref' | 'message'>

function contextFromReports(fingerprint: string, reports: readonly Report[]): Context | undefined {
  for (const report of reports) {
    const finding = findingsOf(report).find((candidate) => candidate.fingerprint === fingerprint)
    if (finding) return { criterion: finding.criterion, target: targetKey(report.target), ref: finding.ref ?? finding.target, message: finding.message }
  }
  return undefined
}

function contextFromBaseline(fingerprint: string, baseline: BaselineFile): Context | undefined {
  for (const [target, record] of Object.entries(baseline.targets)) {
    const entry = record.findings.find((candidate) => candidate.fingerprint === fingerprint)
    if (entry) return { criterion: entry.criterion, target, ref: entry.ref, message: entry.message }
  }
  return undefined
}

async function baselineIfAny(path: string): Promise<BaselineFile | undefined> {
  try {
    return await readBaseline(path)
  } catch {
    return undefined
  }
}

export async function runWaive(fingerprintInput: string, options: WaiveOptions, context: GlobalContext, on: string = today()): Promise<number> {
  const fingerprint = fingerprintInput.trim().toLowerCase()
  if (!isFingerprint(fingerprint)) {
    throw new RampaError('invalid-fingerprint', `"${fingerprintInput}" is not a finding id: ids are 12 hexadecimal characters, shown as "id" in the report and as fingerprint in its JSON.`)
  }
  const reason = options.reason.trim()
  if (reason === '') throw new RampaError('missing-reason', 'A waiver needs a reason: --reason "why this finding is acceptable".')
  if (options.expires !== undefined) {
    if (!isDate(options.expires)) throw new RampaError('invalid-date', `--expires takes a date as YYYY-MM-DD, such as 2027-01-31. Got "${options.expires}".`)
    if (options.expires < on) throw new RampaError('invalid-date', `--expires ${options.expires} is already past; a waiver applies through its expiry date.`)
  }

  const reports = options.report ? await readReports(options.report) : []
  let found = contextFromReports(fingerprint, reports)
  if (!found && options.report) {
    throw new RampaError('fingerprint-not-found', `No finding in ${options.report.join(', ')} has the id ${fingerprint}.`)
  }
  if (!found) {
    const baseline = await baselineIfAny(context.config.baseline ?? BASELINE_FILE)
    if (baseline) found = contextFromBaseline(fingerprint, baseline)
  }

  const file = await readWaivers(options.file ?? context.config.waivers ?? WAIVERS_FILE)
  const previous = file.entries.find((entry) => entry.waiver?.fingerprint === fingerprint)?.waiver
  // A renewal keeps what the waiver already said it was about.
  if (!found && previous && (previous.criterion || previous.message)) {
    found = { criterion: previous.criterion, target: previous.target, ref: previous.ref, message: previous.message }
  }
  const waiver: Waiver = { fingerprint, reason, author: await gitUserName(), date: on, expires: options.expires, ...found }
  const action = upsertWaiver(file, waiver)
  await writeWaivers(file)

  const p = paint(colorsEnabled())
  console.log(`\n  ${p.green(action === 'added' ? 'Waived' : 'Updated the waiver of')} ${p.bold(fingerprint)} in ${file.path}`)
  if (found) {
    console.log(`  ${[found.criterion, found.target].filter(Boolean).join(' ')} ${p.dim(found.ref ?? '')}`)
    if (found.message) console.log(`  ${found.message}`)
  }
  console.log(`  Reason: ${reason}`)
  const until = options.expires ? `until ${options.expires}` : 'with no expiry date'
  console.log(p.dim(`  ${[waiver.author ? `by ${waiver.author}` : undefined, `on ${on}`, until].filter(Boolean).join(', ')}`))
  if (previous?.expires && previous.expires !== options.expires) {
    const before = previous.expires < on ? `It had expired on ${previous.expires}` : `It was due to expire on ${previous.expires}`
    console.log(p.dim(`  ${before}; it now applies ${until}.`))
  }
  if (!found) {
    console.log(p.yellow('  No report or baseline here has this id, so the waiver records the id alone.'))
    console.log(p.dim('  Pass --report report.json (from rampa check -o) to record what it is about.'))
  }
  if (!waiver.author) console.log(p.dim('  git config user.name is not set, so the waiver has no author.'))
  console.log('')
  return 0
}

interface Listed {
  index: number
  waiver?: Waiver | undefined
  status: 'active' | 'expired' | 'invalid' | 'unused'
  /** Days until it expires, for an active waiver with an expiry date. */
  daysLeft?: number | undefined
  /** Whether the reports have its finding; undefined without reports, or when they did not check its page. */
  inReports?: boolean | undefined
  problem?: string | undefined
  raw?: unknown
}

/** Each waiver with its state today and, given reports, whether any finding still needs it. */
export function listWaivers(file: WaiverFile, on: string, reports?: readonly Report[]): Listed[] {
  const seen = reports ? new Set(reports.flatMap((report) => findingsOf(report).map((finding) => finding.fingerprint))) : undefined
  const checked = reports ? new Set(reports.map((report) => targetKey(report.target))) : undefined
  return file.entries.map((entry, index) => {
    const status = statusOf(entry, on)
    const waiver = entry.waiver
    if (status === 'invalid' || !waiver) return { index, waiver, status: 'invalid' as const, problem: entry.problem ?? 'not a waiver', raw: entry.raw }
    // A waiver for a page the reports did not check may still be needed there, and one that does not
    // say its page (a bare fingerprint) may be for any page, so neither is called unused.
    const coveredByReports = seen !== undefined && waiver.target !== undefined && checked?.has(waiver.target) === true
    const inReports = coveredByReports ? seen.has(waiver.fingerprint) : undefined
    return {
      index,
      waiver,
      status: status === 'active' && inReports === false ? ('unused' as const) : status,
      daysLeft: status === 'active' && waiver.expires ? daysBetween(on, waiver.expires) : undefined,
      inReports,
    }
  })
}

export async function runWaivers(options: WaiversOptions, context: GlobalContext, on: string = today()): Promise<number> {
  const file = await readWaivers(options.file ?? context.config.waivers ?? WAIVERS_FILE)
  const reports = options.report ? await readReports(options.report) : undefined
  const pruned = options.prune ? pruneExpired(file, on) : []
  if (pruned.length > 0) await writeWaivers(file)
  const listed = listWaivers(file, on, reports)

  if (options.format === 'json') {
    console.log(JSON.stringify({ file: file.path, date: on, pruned, waivers: listed }, null, 2))
    return 0
  }
  const p = paint(colorsEnabled())
  if (!file.exists) {
    console.log(`\n  No waivers file at ${file.path}. rampa waive <id> --reason "..." adds one.\n`)
    return 0
  }
  const count = (status: Listed['status']) => listed.filter((item) => item.status === status).length
  const summary = [`${listed.length} waiver(s)`, `${count('active')} active`]
  if (count('expired') > 0) summary.push(p.yellow(`${count('expired')} expired`))
  if (count('unused') > 0) summary.push(p.yellow(`${count('unused')} unused`))
  if (count('invalid') > 0) summary.push(p.red(`${count('invalid')} invalid`))
  console.log(`\n  ${p.bold(file.path)}  ${summary.join(' · ')}`)
  if (pruned.length > 0) console.log(p.green(`  Removed ${pruned.length} expired waiver(s): ${pruned.map((waiver) => waiver.fingerprint).join(', ')}`))
  console.log('')
  for (const item of listed) console.log(renderListed(item, p, reports !== undefined))
  if (count('expired') > 0) console.log(p.dim('  Expired waivers no longer hide their findings; rampa waivers --prune removes them, rampa waive renews one.'))
  if (count('unused') > 0) console.log(p.dim('  Unused waivers match no finding in the reports given: the finding was fixed or changed. Remove them by hand.'))
  if (!reports && listed.length > 0) console.log(p.dim('  Pass --report report.json (from rampa check -o) to find waivers that no longer match any finding.'))
  console.log('')
  return 0
}

function renderListed(item: Listed, p: Painter, withReports: boolean): string {
  const waiver = item.waiver
  if (item.status === 'invalid' || !waiver) {
    return `  ${p.red('✗')} entry ${item.index + 1}  ${p.red('invalid')}: ${item.problem}\n    ${p.dim(JSON.stringify(item.raw))}\n`
  }
  const use = !withReports ? '' : item.inReports ? ', in use' : waiver.target ? ', its page is not in the reports' : ', no page recorded to check against'
  const state =
    item.status === 'expired'
      ? p.yellow(`expired on ${waiver.expires}: no longer applies`)
      : item.status === 'unused'
        ? p.yellow('unused: no finding in the reports has this id')
        : item.daysLeft !== undefined
          ? `active${use}, ${item.daysLeft === 0 ? 'last day today' : `expires in ${item.daysLeft} day(s)`} (${waiver.expires})`
          : `active${use}`
  const mark = item.status === 'active' ? p.green('✓') : p.yellow('!')
  const lines = [`  ${mark} ${p.bold(waiver.fingerprint)}  ${state}`]
  lines.push(`    ${waiver.reason ? `Reason: ${waiver.reason}` : p.yellow('no reason given')}`)
  if (waiver.criterion || waiver.target || waiver.ref) lines.push(p.dim(`    ${[waiver.criterion, waiver.target, waiver.ref].filter(Boolean).join(' ')}`))
  if (waiver.message) lines.push(p.dim(`    ${waiver.message}`))
  const who = [waiver.author, waiver.date].filter(Boolean).join(', ')
  if (who) lines.push(p.dim(`    ${who}`))
  return `${lines.join('\n')}\n`
}
