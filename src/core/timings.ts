/**
 * Where a page's time goes (`--timings`): each stage of the collection and the check, and each judged criterion with
 * its model calls. Recorded only when asked, so reports stay the same from run to run; docs/performance.md reads them.
 */

/** The stages of one page, in the order they run. */
export const TIMING_STAGES = [
  /** Starting the browser: the first web page of a run pays for it. */
  'browser-launch',
  /** A new browser context, the page's request and its load event, and any --wait-for. */
  'navigation',
  /** The wait after load until the network and the DOM are quiet (surfaces/settle.ts), up to its cap. */
  'settle',
  /** Reading the page into the snapshot: the in-page walk, refs, form issues, shadow roots, motion facts. */
  'collection',
  /** axe-core, injected and run in the page and its frames. */
  'axe',
  /** The browser's own accessibility tree, over CDP (surfaces/ax-tree.ts). */
  'ax-tree',
  /** Screenshots of images and CSS backgrounds, for the criteria that judge pixels. */
  'image-capture',
  /** Whether each label 3.3.2 relies on shows its text, from two captures (surfaces/label-visibility.ts). */
  'label-visibility',
  /** Contrast measured from pixels where axe-core could not decide (surfaces/contrast-capture.ts). */
  'pixel-contrast',
  /** Reading where links lead, for 2.4.4 (surfaces/destinations.ts). */
  'link-following',
  /** The full-page screenshot of --screenshots. */
  'screenshot',
  /** Probes (--probe), each on a fresh page; `parts` has one entry per kind. */
  'probes',
  /** Closing the page's browser context. */
  'teardown',
  /** Rampa's rules over the snapshot and the probe facts: no browser, no model. */
  'rules',
  /** Advisory profiles (--profile). */
  'advisory',
  /** Tracing findings back to a local file's source lines. */
  'source',
] as const

export type TimingStage = (typeof TIMING_STAGES)[number]

export interface StageTiming {
  stage: TimingStage
  ms: number
  /** What the stage is made of, where it has parts worth telling apart: one entry per probe kind. */
  parts?: Array<{ name: string; ms: number }> | undefined
}

export interface CriterionTiming {
  criterion: string
  /** From the criterion's start to its last judgment: preparing, finding candidates, the model's answers and verification. */
  ms: number
  /** Of which loading what the criterion reads (1.4.5: OCR over every captured picture; 3.1.x: the language data). */
  prepareMs: number
  candidates: number
  /** Candidates that went to the model or that the criterion decided itself, after the cap. */
  judged: number
  /** Model calls made and read from the cache. */
  calls: number
  cachedCalls: number
  /** Calls that held several candidates (batched judgment). Absent when none did. */
  batches?: number | undefined
}

export interface Timings {
  /** Wall time of the page, in milliseconds: from when Rampa starts on it (the browser's launch included, for the first page) to its report. */
  totalMs: number
  /** The stages that ran, in order; a stage that did not run is absent. */
  stages: StageTiming[]
  /** The judged criteria, in the order they ran. */
  criteria: CriterionTiming[]
  /** What no stage holds: building the report, coverage, waits between stages. */
  otherMs: number
}

/** Records a page's stages; one per page. */
export class Stopwatch {
  readonly #started: number
  readonly #stages = new Map<TimingStage, { ms: number; parts: Map<string, number> }>()
  readonly #criteria: CriterionTiming[] = []

  constructor(started: number = performance.now()) {
    this.#started = started
  }

  /** Runs `work` and adds its time to `stage` (and to the part `part` of it, when given). */
  async time<T>(stage: TimingStage, work: () => Promise<T>, part?: string): Promise<T> {
    const start = performance.now()
    try {
      return await work()
    } finally {
      this.add(stage, performance.now() - start, part)
    }
  }

  add(stage: TimingStage, ms: number, part?: string): void {
    const entry = this.#stages.get(stage) ?? { ms: 0, parts: new Map<string, number>() }
    entry.ms += ms
    if (part !== undefined) entry.parts.set(part, (entry.parts.get(part) ?? 0) + ms)
    this.#stages.set(stage, entry)
  }

  criterion(timing: CriterionTiming): void {
    this.#criteria.push(timing)
  }

  /** The page's timings so far, in whole milliseconds. */
  result(now: number = performance.now()): Timings {
    const stages: StageTiming[] = TIMING_STAGES.flatMap((stage) => {
      const entry = this.#stages.get(stage)
      if (!entry) return []
      const parts = [...entry.parts].map(([name, ms]) => ({ name, ms: Math.round(ms) }))
      return [{ stage, ms: Math.round(entry.ms), ...(parts.length > 0 ? { parts } : {}) }]
    })
    const criteria = this.#criteria.map((c) => ({ ...c, ms: Math.round(c.ms), prepareMs: Math.round(c.prepareMs) }))
    const totalMs = Math.round(now - this.#started)
    const counted = stages.reduce((sum, s) => sum + s.ms, 0) + criteria.reduce((sum, c) => sum + c.ms, 0)
    return { totalMs, stages, criteria, otherMs: Math.max(0, totalMs - counted) }
  }
}

/** Runs `work`, timed under `stage` when there is a stopwatch. */
export function timed<T>(watch: Stopwatch | undefined, stage: TimingStage, work: () => Promise<T>, part?: string): Promise<T> {
  return watch ? watch.time(stage, work, part) : work()
}
