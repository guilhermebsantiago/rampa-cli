import { afterAll, describe, expect, it } from 'vitest'
import type { EngineResults } from '../src/core/types.ts'
import { CRITERIA } from '../src/criteria/index.ts'
import { type ProbeKind, parseProbeKinds, probeLaunchArgs } from '../src/probes/run.ts'
import type { A11ySnapshot } from '../src/snapshot/schema.ts'
import { collectWeb, launchBrowser } from '../src/surfaces/web.ts'
import { fixture } from './probe-helpers.ts'

// A check with probes must report what the same check without them reports, but for what the probes add: collection,
// image capture and axe-core run on the page before any probe, and each probe loads a page of its own. A benchmark row
// with probes once lost an object-alt violation and 1.1.1 judgments; the cause was the server refusing an image on
// reloads, not the probes, and this pins down that the probes change neither the page collection read nor the next one.
// Integration: needs Chrome or Edge, started with the switches the CLI uses for these probes. Skipped, with the reason
// on stderr, when none starts.
const kinds = parseProbeKinds('all')
const browser = await launchBrowser({ args: probeLaunchArgs(kinds) }).catch((error: unknown) => {
  process.stderr.write(`\nSkipping the probe isolation test: no browser started (${error instanceof Error ? error.message.split('\n')[0] : String(error)}).\n`)
  return undefined
})
afterAll(async () => browser?.close(), 60_000)

/** What the stages after collection read: axe-core's violations by rule and element, and the 1.1.1 candidates. */
function stages(snapshot: A11ySnapshot, engine: EngineResults) {
  const violations = engine.rules.filter((rule) => rule.outcome === 'violation').flatMap((rule) => rule.nodes.map((node) => `${rule.ruleId} ${node.ref ?? node.target}`))
  const candidates = CRITERIA.get('1.1.1')?.candidates(snapshot, engine).map((candidate) => candidate.ref) ?? []
  return { violations: violations.sort(), candidates: candidates.sort() }
}

describe.skipIf(!browser)('probes and the other stages', { timeout: 240_000 }, () => {
  it('leave axe-core and the judgment candidates as collection saw them, on the page they probe and on the next one', async () => {
    const collect = async (probes: readonly ProbeKind[] = []) => {
      if (!browser) throw new Error('no browser')
      const { snapshot, engine } = await collectWeb(browser, fixture('isolation-images.html'), { runAxe: true, locale: 'en', captureImages: true, probes })
      return { seen: stages(snapshot, engine), probed: (snapshot.observations?.probes ?? []).filter((record) => record.status !== 'skipped').map((record) => record.kind) }
    }
    const before = await collect()
    expect(before.seen.violations.some((violation) => violation.startsWith('object-alt '))).toBe(true)
    // The image with an alt and the canvas drawn once its image loaded.
    expect(before.seen.candidates).toHaveLength(2)

    const probed = await collect(kinds)
    // Every kind of `--probe all` loaded, resized or drove the page.
    expect(new Set(probed.probed)).toEqual(new Set(kinds))
    expect(probed.seen).toEqual(before.seen)
    // The same browser, once the probes are done: what they did stays in their own pages.
    expect((await collect()).seen).toEqual(before.seen)
  })
})
