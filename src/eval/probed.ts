import { parseProbeKinds } from '../probes/run.ts'
import type { ProbeRule } from '../rules/probes.ts'
import { PROBE_RULES } from '../rules/registry.ts'
import { compareCriteria } from '../wcag.ts'

/**
 * The criteria a check with `--probe <probe>` can report differently because of its probes: those of the probe rules
 * that read the records of the kinds it runs. `all` leaves the opt-in kinds out, so their rules (variants on 1.1.1 and
 * 3.1.1, links on 2.4.4, …) are not among them. On every other criterion the check reports what it reports without
 * probes, which is why the benchmark's probes row runs only the pages of these criteria (bench/run.mjs).
 */
export function probedCriteria(probe: string, rules: readonly ProbeRule[] = PROBE_RULES): string[] {
  const kinds = new Set<string>(parseProbeKinds(probe))
  return [...new Set(rules.filter((rule) => kinds.has(rule.kind)).flatMap((rule) => rule.criteria))].sort(compareCriteria)
}
