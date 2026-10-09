import type { Browser } from 'playwright-core'
import { RampaError, errorMessage } from '../core/util.ts'
import type { ProbeRecord } from '../snapshot/schema.ts'
import { layoutProbes } from './layout.ts'
import { PROBE_KINDS, type ProbeKind, type ProbeOptions, skippedRecord } from './page.ts'

export { PROBE_KINDS, type ProbeKind, type ProbeOptions } from './page.ts'

/**
 * The probe stage (docs/probes.md). After collection, each probe opens its own freshly loaded
 * page, drives it read-only (keys, focus, viewport, injected CSS) behind the network guard,
 * and records facts in `snapshot.observations`. Rules read only those facts, so a saved
 * snapshot is judged again offline.
 */

/** Chromium switches that keep pixels the same from run to run; the browser is launched with them when probes run. */
export const DETERMINISM_ARGS = ['--force-color-profile=srgb', '--disable-lcd-text', '--font-render-hinting=none']

/** `--probe layout,keyboard`, `all` or `none`. */
export function parseProbeKinds(raw: string | undefined): ProbeKind[] {
  if (!raw) return []
  const kinds = new Set<ProbeKind>()
  for (const part of raw.split(',').map((value) => value.trim().toLowerCase()).filter(Boolean)) {
    if (part === 'none') return []
    if (part === 'all') for (const kind of PROBE_KINDS) kinds.add(kind)
    else if ((PROBE_KINDS as readonly string[]).includes(part)) kinds.add(part as ProbeKind)
    else throw new RampaError('invalid-probe', `--probe takes ${PROBE_KINDS.join(', ')}, all or none. Got "${part}".`)
  }
  return PROBE_KINDS.filter((kind) => kinds.has(kind))
}

export type ProbeStep = (browser: Browser, url: string, options: ProbeOptions) => Promise<ProbeRecord[]>

/** Runs each requested kind in turn; a probe that fails is recorded as skipped and never fails the check. */
export async function runProbes(browser: Browser, url: string, options: ProbeOptions): Promise<ProbeRecord[]> {
  const steps: Partial<Record<ProbeKind, ProbeStep>> = { layout: layoutProbes }
  const records: ProbeRecord[] = []
  for (const kind of options.kinds) {
    const started = Date.now()
    try {
      const step = steps[kind]
      if (!step) records.push(skippedRecord(kind, '0', undefined, 'this probe is not built yet', 0))
      else records.push(...(await step(browser, url, options)))
    } catch (error) {
      records.push(skippedRecord(kind, '0', undefined, `probe failed: ${errorMessage(error).split('\n')[0]}`, Date.now() - started))
    }
  }
  return records
}

