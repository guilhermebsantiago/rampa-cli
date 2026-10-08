import type { RampaConfig } from '../config.ts'
import type { Report } from '../core/types.ts'
import { RampaError } from '../core/util.ts'
import { compareWithBaseline, readBaseline } from './baseline.ts'
import { WAIVERS_FILE, activeFingerprints, readWaivers, statusOf, today, waiversWith } from './waivers.ts'

/** The targets given on the command line, or else the config's. */
export function targetsOrConfig(targets: readonly string[], config: RampaConfig): string[] {
  if (targets.length > 0) return [...targets]
  if (config.targets && config.targets.length > 0) return [...config.targets]
  throw new RampaError('no-targets', 'No targets: pass URLs, .html files, folders or snapshot .json files, or set targets in the config file (rampa init writes one).')
}

export interface Adoption {
  /** Fingerprints of the waivers that apply today, for checkSnapshot. */
  waivers: Set<string>
  waiversFile: string
  /** Entries of the waivers file that cannot apply, such as one with an unreadable expiry date. */
  invalidWaivers: number
  /** Adds to a report the waivers that expired on its findings and, with a baseline, what the baseline already knew. */
  apply(report: Report): Report
}

/**
 * Reads the waivers and the baseline once per run. `baseline` is the --baseline flag: a path, false
 * for --no-baseline, or undefined to use the config's.
 */
export async function prepareAdoption(baselineFlag: string | false | undefined, config: RampaConfig, on: string = today()): Promise<Adoption> {
  const waivers = await readWaivers(config.waivers ?? WAIVERS_FILE)
  const expired = waiversWith(waivers, 'expired', on)
  const baselinePath = baselineFlag === false ? undefined : (baselineFlag ?? config.baseline)
  const baseline = baselinePath ? await readBaseline(baselinePath) : undefined
  return {
    waivers: activeFingerprints(waivers, on),
    waiversFile: waivers.path,
    invalidWaivers: waivers.entries.filter((entry) => statusOf(entry, on) === 'invalid').length,
    apply(report) {
      const seen = new Set([...report.findings, ...report.belowThreshold].map((finding) => finding.fingerprint))
      const lapsed = expired.filter((waiver) => seen.has(waiver.fingerprint))
      const withExpired = lapsed.length > 0 ? { ...report, expiredWaivers: lapsed } : report
      if (!baseline || !baselinePath) return withExpired
      // An expired waiver asks someone to look at its finding again, even when the baseline knew it.
      return compareWithBaseline(withExpired, baseline, baselinePath, { keep: new Set(lapsed.map((waiver) => waiver.fingerprint)) })
    },
  }
}
