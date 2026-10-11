import type { Browser } from 'playwright-core'
import { RampaError, errorMessage } from '../core/util.ts'
import type { ProbeRecord } from '../snapshot/schema.ts'
import { authProbe } from './auth.ts'
import { colorProbe } from './color.ts'
import { flashProbe } from './flash.ts'
import { formProbe } from './form.ts'
import { hoverProbe } from './hover.ts'
import { inputProbe } from './input.ts'
import { keyboardProbe } from './keyboard.ts'
import { layoutProbes } from './layout.ts'
import { linksProbe } from './links.ts'
import { mediaProbe } from './media.ts'
import { motionProbe } from './motion.ts'
import { orientationProbe } from './orientation.ts'
import { pointerProbe } from './pointer.ts'
import { shortcutsProbe } from './shortcuts.ts'
import { statesProbe } from './states.ts'
import { statusProbe } from './status.ts'
import { togglesProbe } from './toggles.ts'
import { variantsProbe } from './variants.ts'
import { INTERACT_KINDS, OPT_IN_KINDS, PROBE_KINDS, type ProbeKind, type ProbeOptions, skippedRecord } from './page.ts'

export { INTERACT_KINDS, OPT_IN_KINDS, PROBE_KINDS, type ProbeKind, type ProbeOptions } from './page.ts'

/**
 * The probe stage (docs/probes.md). After collection, each probe opens its own freshly loaded
 * page, drives it (keys, focus, viewport, injected CSS, muted media; the probes of the activate class press printable
 * keys, click scripted links and toggles, change form controls, set off status messages, type invalid values into
 * fields, or press and drag with the pointer through the harness in activate.ts) behind the network guard,
 * and records facts in `snapshot.observations`. Rules read only those facts, so a saved
 * snapshot is judged again offline.
 */

/** Chromium switches that keep pixels the same from run to run; the browser is launched with them when probes run. */
export const DETERMINISM_ARGS = ['--force-color-profile=srgb', '--disable-lcd-text', '--font-render-hinting=none']

/**
 * The media probe lets media start with sound on load, as a browser that allows autoplay would, so it can see audio
 * that plays on its own (1.4.2). Nothing reaches the speakers: Playwright starts headless browsers with --mute-audio.
 */
export const AUTOPLAY_ARGS = ['--autoplay-policy=no-user-gesture-required']

/** The switches a browser for these probes starts with: none without probes. */
export function probeLaunchArgs(kinds: readonly ProbeKind[] | undefined): string[] {
  if (!kinds || kinds.length === 0) return []
  return kinds.includes('media') ? [...DETERMINISM_ARGS, ...AUTOPLAY_ARGS] : [...DETERMINISM_ARGS]
}

/**
 * `--probe layout,keyboard,hover,orientation,shortcuts,media,color,states,variants,auth,flash,links,input,toggles,status,motion,form,pointer`,
 * `all` (every kind but the opt-in ones: variants, auth, flash, links, input, toggles, status, motion, form, pointer),
 * `interact` (the activate class: shortcuts, links, input, toggles, status, form, pointer) or `none`.
 */
export function parseProbeKinds(raw: string | undefined): ProbeKind[] {
  if (!raw) return []
  const kinds = new Set<ProbeKind>()
  for (const part of raw.split(',').map((value) => value.trim().toLowerCase()).filter(Boolean)) {
    if (part === 'none') return []
    if (part === 'all') for (const kind of PROBE_KINDS.filter((k) => !OPT_IN_KINDS.includes(k))) kinds.add(kind)
    else if (part === 'interact') for (const kind of INTERACT_KINDS) kinds.add(kind)
    else if ((PROBE_KINDS as readonly string[]).includes(part)) kinds.add(part as ProbeKind)
    else
      throw new RampaError(
        'invalid-probe',
        `--probe takes ${PROBE_KINDS.join(', ')}, all (every kind but ${OPT_IN_KINDS.join(', ')}), interact (${INTERACT_KINDS.join(', ')}) or none. Got "${part}".`,
      )
  }
  return PROBE_KINDS.filter((kind) => kinds.has(kind))
}

export type ProbeStep = (browser: Browser, url: string, options: ProbeOptions) => Promise<ProbeRecord[]>

/** Runs each requested kind in turn; a probe that fails is recorded as skipped and never fails the check. */
export async function runProbes(browser: Browser, url: string, options: ProbeOptions): Promise<ProbeRecord[]> {
  const steps: Partial<Record<ProbeKind, ProbeStep>> = { layout: layoutProbes, keyboard: keyboardProbe, hover: hoverProbe, orientation: orientationProbe, shortcuts: shortcutsProbe, media: mediaProbe, color: colorProbe, states: statesProbe, variants: variantsProbe, auth: authProbe, flash: flashProbe, links: linksProbe, input: inputProbe, toggles: togglesProbe, status: statusProbe, motion: motionProbe, form: formProbe, pointer: pointerProbe }
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

