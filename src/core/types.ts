import type { z } from 'zod'
import type { AdvisorySection } from '../advisory/types.ts'
import type { BaselineComparison } from '../adoption/baseline.ts'
import type { Waiver } from '../adoption/waivers.ts'
import type { Locale } from '../i18n.ts'
import type { A11ySnapshot, Reach, Surface } from '../snapshot/schema.ts'
import type { Level, WcagTarget } from '../wcag.ts'
import type { FastCoverage } from './fast.ts'
import type { Timings } from './timings.ts'

export type Confidence = 'low' | 'medium' | 'high'

export const CONFIDENCE_RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 }

export function minConfidence(a: Confidence, b: Confidence): Confidence {
  return CONFIDENCE_RANK[a] <= CONFIDENCE_RANK[b] ? a : b
}

// Deterministic engine (axe-core on the web, tree rules elsewhere)

export type EngineOutcome = 'violation' | 'incomplete' | 'pass' | 'inapplicable'

export interface EngineNode {
  /** Snapshot ref of the node, when the engine target maps to one. */
  ref?: string | undefined
  target: string
  html: string
  message?: string | undefined
  impact?: string | null | undefined
  /** A message about this node, reported instead of the rule's help (tree and pixel rules). */
  detail?: string | undefined
  /** What the rule measured or read on this node, reported as evidence. */
  evidence?: string | undefined
  /** Defaults to high. Lower when the rule's input may be off, such as text a model located. */
  confidence?: Confidence | undefined
  /** The model that located the node in an image, when there was no accessibility tree to read it from. */
  locatedBy?: string | undefined
  /** WCAG 2.5.8: an exception the page shows for this target; an exempt target is never a failure. */
  exempt?: 'user-agent-control' | 'equivalent-target' | undefined
  /** axe-core's reason key for a color-contrast result, such as bgImage when it could not decide (surfaces/contrast-capture.ts). */
  reasonKey?: string | undefined
}

export interface EngineRuleResult {
  ruleId: string
  outcome: EngineOutcome
  /** WCAG success criteria the rule maps to, e.g. ['3.1.2']. */
  criteria: string[]
  help: string
  helpUrl?: string | undefined
  impact?: string | null | undefined
  nodes: EngineNode[]
}

export interface EngineResults {
  engine: { name: string; version: string }
  rules: EngineRuleResult[]
}

// Judgment layer

export type Verdict = 'pass' | 'fail' | 'cannot_tell'

export interface JudgmentBase {
  verdict: Verdict
  evidence: string
  confidence: Confidence
}

export interface PromptImage {
  data: Uint8Array
  mediaType: string
}

export interface Prompt {
  system: string
  user: string
  images?: PromptImage[] | undefined
}

export interface Candidate<Ctx> {
  ref: string
  context: Ctx
}

export type Verification = { ok: true } | { ok: false; reason: string }

export interface Patch {
  ref: string
  /**
   * Change one attribute, or the text an element shows (a link, a heading, a label, the page title),
   * or replace the element's markup, such as an image of text with the text itself.
   */
  kind: 'set-attribute' | 'set-text' | 'replace-element'
  attribute?: string | undefined
  from?: string | undefined
  to: string
  before?: string | undefined
  after?: string | undefined
}

/**
 * One module per WCAG success criterion. A criterion never sees the DOM: it
 * reads the normalized snapshot plus the engine results, and owns its prompt,
 * its answer schema and the verification of every claim the model makes.
 */
export interface Criterion<Ctx = unknown, Out extends JudgmentBase = JudgmentBase> {
  id: string
  level: Level
  /** Bump when the prompt or the logic changes; it invalidates cached judgments. */
  version: string
  /** ACT rules used as reference and gold data. */
  act: readonly string[]
  /** Surfaces where the criterion applies. */
  surfaces: readonly Surface[]
  needs: { vision?: boolean; fetch?: boolean }
  /** Engine rules that cover the deterministic side of the criterion. */
  engineRules: readonly string[]
  /**
   * browser: the criterion reads names as the browser exposes them, from its accessibility tree (`node.ax`), where the
   * collector read it (snapshot/ax.ts, `browserNamed`); the collector's own names otherwise. Criteria move to the
   * browser's names one at a time, each measured on its evaluation sets (docs/rules.md).
   */
  names?: 'browser' | undefined
  /**
   * Loads what the synchronous methods below need, such as an n-gram database, or measures what they read from the
   * snapshot's own data, such as the words OCR reads in its captured pictures (1.4.5); awaited before `candidates`.
   */
  prepare?(snapshot: A11ySnapshot): Promise<void>
  /** Only the residue the engine could not decide. */
  candidates(snapshot: A11ySnapshot, engine: EngineResults): Candidate<Ctx>[]
  /**
   * A judgment made without a model, for a candidate a deterministic reading settles: a long text a language
   * identifier reads clearly. No model is asked about that candidate; the judgment still goes through `verify`.
   */
  decide?(candidate: Candidate<Ctx>, snapshot: A11ySnapshot): Out | undefined
  /** The deterministic method behind `decide`, as the coverage names it: a method of kind `rule`, such as `rampa/language-id`. */
  decidedBy?: string
  /**
   * The verdict that follows from the rest of the model's answer, where the criterion defines it that way: for a
   * passage the identifier nominated, a detected language and no exception make a fail, whatever verdict was written.
   * Applied to every answer before the vote; the answer still goes through `verify`.
   */
  settle?(output: Out, candidate: Candidate<Ctx>): Out
  /** The highest confidence a finding about this candidate can have, whatever the model says: a short quote stays low. */
  confidenceCap?(candidate: Candidate<Ctx>): Confidence | undefined
  prompt(candidate: Candidate<Ctx>, snapshot: A11ySnapshot): Prompt
  /**
   * What the model's answer depends on, where that is less than the whole prompt: judgments are cached by it, and
   * candidates with the same key in one run share one call. 1.4.5 keys its judgments by the picture's hash, so a
   * picture repeated on a page or across the pages of a site is judged once. The prompt's hash when absent.
   */
  judgmentKey?(candidate: Candidate<Ctx>): string | undefined
  /**
   * Batched judgment (core/batch.ts): the most candidates of this criterion one model call may hold when batching is on
   * (--batch, and --fast). Opt-in per criterion, measured on its evaluation sets (docs/performance.md); each candidate
   * keeps its own prompt and verification. Absent: one call per candidate, always.
   */
  batch?: number | undefined
  schema: z.ZodType<Out>
  /**
   * The answer schema for one candidate, where a criterion asks two kinds of question: 1.1.1 asks whether an
   * image's alternative serves its purpose, and whether an image hidden from assistive technology carries
   * information. `schema` when absent.
   */
  schemaFor?(candidate: Candidate<Ctx>): z.ZodType<Out>
  /**
   * The ACT rules a candidate's question answers, where a criterion asks more than one: `rampa eval` scores an
   * ACT rule's test cases by the judgments of the question that implements it. All of `act` when absent.
   */
  actFor?(candidate: Candidate<Ctx>): readonly string[]
  verify(output: Out, candidate: Candidate<Ctx>, snapshot: A11ySnapshot): Verification
  message(output: Out, candidate: Candidate<Ctx>, locale: Locale): string
  /**
   * What a claim about the candidate is about, read from the snapshot: the alt text, the link text,
   * the declared language. It keys the finding's fingerprint, which must never depend on the model's
   * wording; without it, the criterion and the ref alone do.
   */
  subject?(candidate: Candidate<Ctx>): string
  patch?(output: Out, candidate: Candidate<Ctx>, snapshot: A11ySnapshot): Patch | undefined
  /**
   * The probe rule whose finding on the same element this judgment may only clear (2.1.4: "clearly labeled"): a pass
   * removes that finding, a fail keeps it with the model's answer in its evidence, and no finding of its own is made.
   */
  clears?: string | undefined
  /** With `clears`: the coverage note when a verified pass clears the finding. The 2.1.4 wording when absent. */
  clearedNote?(output: Out, locale: Locale): string
  /** With `clears`: what a verified fail adds to the evidence of the finding it keeps. The 2.1.4 wording when absent. */
  keptNote?(output: Out, locale: Locale): string
  /**
   * The probe rule whose items to review this judgment decides (4.1.3: is the text that appeared a status message?).
   * A verified answer takes the item a candidate stands for (`settledKey`, the item's fingerprint) off the review list:
   * a fail becomes this judgment's finding, experimental like the probe's, and a pass a note on the rule's coverage line
   * (`settledNote`). With no model, or no verified answer, the item stays for a person.
   */
  settles?: string | undefined
  settledKey?(candidate: Candidate<Ctx>): string
  settledNote?(output: Out, candidate: Candidate<Ctx>, locale: Locale): string
}

// biome-ignore lint/suspicious/noExplicitAny: registry of heterogeneous criteria
export type AnyCriterion = Criterion<any, any>

// Report

/** Lines and columns are 1-based; columns count UTF-16 code units and the end column is exclusive, as in SARIF. */
export interface SourceRegion {
  startLine: number
  startColumn: number
  endLine: number
  endColumn: number
}

/** The patch as an edit to the source file: replace the region with `text`. */
export interface SourceFix {
  region: SourceRegion
  text: string
  /** The element as written in the file, before and after the edit, for a readable diff. */
  before: string
  after: string
}

/** Where a finding sits in the source of a local page, when the element could be traced back to it. */
export interface SourceLocation extends SourceRegion {
  /** Relative to the repository root (or the working directory outside a repository), with forward slashes. */
  file: string
  /** The source text of the region, when it is short. */
  snippet?: string | undefined
  fix?: SourceFix | undefined
}

export interface Finding {
  /** Stable id used to waive a finding across runs. */
  fingerprint: string
  criterion: string
  level: Level | undefined
  /**
   * engine: axe-core or the tree rules; rule: a Rampa rule over the snapshot (src/rules); judgment: a model, verified;
   * probe: a rule over facts a probe recorded (src/rules/probes.ts, docs/probes.md).
   */
  source: 'engine' | 'judgment' | 'rule' | 'probe'
  ref?: string | undefined
  target?: string | undefined
  message: string
  evidence?: string | undefined
  /** What a judgment is about, as the snapshot has it (the alt text, the link text); never the model's words. */
  subject?: string | undefined
  patch?: Patch | undefined
  confidence: Confidence
  agreement?: { votes: number; total: number } | undefined
  ruleId?: string | undefined
  helpUrl?: string | undefined
  html?: string | undefined
  model?: string | undefined
  /** The model that located the cited element in an image: it was not read from an accessibility tree. */
  locatedBy?: string | undefined
  /** Set for local pages, by `locateReport`. */
  location?: SourceLocation | undefined
  /** A check that has not passed the evaluation gate yet: reported below the threshold unless --min-confidence low. */
  experimental?: boolean | undefined
  /** A WCAG 2.2-only criterion in a WCAG 2.1 report: shown, never counted toward the exit code. */
  beyondTarget?: boolean | undefined
}

/** What one probe rule did for one criterion: the method, its conditions and counts (docs/probes.md). */
export interface ProbeCoverage {
  criterion: string
  /** The probe and its version, such as 'probe/layout@1'. */
  method: string
  /** The rule that read the probe's facts, such as 'rampa/reflow'. */
  rule: string
  /** What the probe emulated, such as '320×256 CSS px · chromium 141 (headless)'. */
  conditions: string
  status: 'failures' | 'no-failure-found' | 'needs-review' | 'not-checked'
  /** Elements the rule could apply to. */
  applicable: number
  failures: number
  review: number
  /** Facts about elements that did not match the snapshot on the fresh load: never a finding. */
  unmatched: number
  /** Why the criterion was not checked, or what limits the result. */
  note?: string | undefined
  maturity: 'experimental' | 'stable'
  beyondTarget?: boolean | undefined
  /**
   * The probe rule lists facts for another method and decides nothing: the links probe gives 2.4.4's judgment where
   * scripted links lead. It never makes its criterion "no failure found" or "probed".
   */
  inventory?: boolean | undefined
}

/**
 * Something the engine could not decide (an axe-core "incomplete", or a violation of an axe-core rule Rampa
 * runs for review only), or a hit a Rampa rule (src/rules) sends to review, for a person to look at.
 * It is never a failure, never in the findings and never changes the exit code.
 */
export interface ReviewItem {
  criterion: string
  level: Level | undefined
  ruleId: string
  ref?: string | undefined
  target?: string | undefined
  html?: string | undefined
  /** Why the engine could not decide, in its own words. */
  message: string
  /** What a Rampa rule read on the element, when the review is one of its hits. */
  evidence?: string | undefined
  helpUrl?: string | undefined
}

/** A criterion's result in one run. Never "passed": a clean result is "no failure found" in what was checked. */
export type CoverageStatus = 'failures' | 'needs-review' | 'no-failure-found' | 'no-applicable-content' | 'not-checked' | 'satisfied-by-definition'

/** One way a criterion was checked: an engine rule, or the judgment of a model. */
export interface CoverageMethod {
  /**
   * axe: an axe-core rule; rule: a Rampa rule over the tree or the pixels, or what a judged criterion decided without a
   * model (`Criterion.decidedBy`, such as the language identifier's `rampa/language-id` on 3.1.1 and 3.1.2);
   * judgment: a model, with verified evidence; site: a criterion that compares the pages of a crawl (3.2.3, 3.2.6),
   * in a site summary only; probe: a rule over what a probe measured on the page (`--probe`, docs/probes.md).
   */
  kind: 'axe' | 'rule' | 'judgment' | 'site' | 'probe'
  /** The rule id, `judgment/<criterion>@<version>`, `site/<criterion>@<version>`, or a probe rule's id (`rampa/reflow`). */
  id: string
  /** False when the method applied but did not run, such as judgment with --no-llm. */
  ran: boolean
  /** Elements the method applied to (candidates, for judgment); passing elements are capped at 200 per rule. */
  applicable: number
  failures: number
  /** Elements left to a person: undecided by the engine, or where the model abstained. */
  review: number
  /**
   * For judgment: candidates it applied to but never judged, past the per-criterion cap (`--max-candidates`) or after
   * the time limit (`--time-limit`). They are left to a person too. Absent when none.
   */
  notJudged?: number | undefined
  /** The rule can only pass or ask for review: it never reports a failure. */
  reviewOnly?: boolean | undefined
  /** Experimental methods report below the default confidence threshold until they pass the evaluation gate. */
  maturity: 'stable' | 'experimental'
  /** For a probe: the probe and its version (`probe/layout@1`), what it emulated, and why it did not check, if it did not. */
  probe?: { method: string; conditions: string; note?: string | undefined } | undefined
  /** For a Rampa rule: what limits its result, such as elements left out past a budget, in the report's language. */
  note?: string | undefined
  /**
   * The method records facts for a person and decides nothing (an inventory, such as 4.1.3's live regions): it never
   * changes the criterion's status, and `applicable` counts what it found.
   */
  inventory?: boolean | undefined
}

export interface CriterionCoverage {
  id: string
  level: Level
  /** beyond: a WCAG 2.2 criterion in a run that targets 2.1; reported, never counted. */
  target: 'in' | 'beyond'
  status: CoverageStatus
  methods: CoverageMethod[]
  /** What a person still has to review or test, in the report's language. */
  manual: string
}

export interface Discarded {
  criterion: string
  ref: string
  reason: string
  output: unknown
}

export interface CriterionSummary {
  criterion: string
  applicable: boolean
  candidates: number
  judged: number
  failed: number
  passed: number
  cannotTell: number
  discarded: number
  errors: number
  offlineMisses: number
  /**
   * Of the judged candidates, those the criterion passed or failed by itself, without a model (`Criterion.decide`):
   * in the coverage they are a method of kind `rule` (`Criterion.decidedBy`), not a judgment. Absent when none.
   */
  decided?: number | undefined
  /** Of those, the ones it failed. */
  decidedFailed?: number | undefined
  /**
   * Candidates the model never judged because the criterion reached its cap on this page (`--max-candidates`):
   * the ones further down the page, after those with a generic text. Absent when none.
   */
  capped?: number | undefined
  /** Candidates the model never judged because the time limit ran out first (`--time-limit`). Absent when none. */
  timedOut?: number | undefined
  /** Candidates the model judged several to a call (batched judgment, --batch or --fast), and the calls. Absent when none. */
  batched?: { candidates: number; calls: number } | undefined
}

export interface Usage {
  calls: number
  cachedCalls: number
  inputTokens: number
  outputTokens: number
  latencyMs: number
}

export interface Report {
  schemaVersion: 1
  rampaVersion: string
  createdAt: string
  target: string
  /** The local file behind the target, relative like `SourceLocation.file`; set by `locateReport`. */
  sourceFile?: string | undefined
  /** Set when only part of the page was checked: the selectors it was scoped to (checkPage with include or exclude). */
  scope?: { include: string[]; exclude: string[] } | undefined
  surface: Surface
  /** What the run checked against: WCAG 2.2 A/AA by default, or 2.1 with --wcag 2.1. Reports written before it existed targeted 2.1. */
  wcagTarget?: WcagTarget | undefined
  locale: Locale
  llm: 'on' | 'off' | 'no-model'
  model?: string | undefined
  engine: { name: string; version: string }
  findings: Finding[]
  belowThreshold: Finding[]
  /**
   * Findings on WCAG 2.2 criteria in a run that targets WCAG 2.1 (a recording made under 2.2, say):
   * reported, never counted toward the target or the exit code.
   */
  beyondTarget?: Finding[] | undefined
  waived: Finding[]
  /** Waivers past their expiry date that matched findings of this run: those findings are reported again. */
  expiredWaivers?: Waiver[] | undefined
  /** Set with --baseline: findings the baseline already had are left out of findings and belowThreshold. */
  baseline?: BaselineComparison | undefined
  discarded: Discarded[]
  criteria: CriterionSummary[]
  /**
   * engine: criteria where an engine rule able to report a failure decided at least one element;
   * rules: criteria where one of Rampa's own rules (src/rules) decided at least one element, absent when none did;
   * judged: criteria a model judged; probes: what each probe rule did per criterion, absent when no probe ran;
   * notChecked: criteria of the target with none of these, and no result to review (4.1.1 is never listed).
   * criteria: one record per criterion, with its status and methods.
   */
  coverage: {
    engine: string[]
    judged: string[]
    notChecked: string[]
    rules?: string[] | undefined
    /** In a site summary only: criteria the comparison of a crawl's pages compared something for (3.2.3, 3.2.6). */
    site?: string[] | undefined
    /** Criteria a probe rule checked, with its method and conditions; absent when no probe ran. */
    probes?: ProbeCoverage[] | undefined
    /**
     * What the collector could not read (snapshot/reach.ts): frames whose content is not in the snapshot or that axe-core
     * could not check, and closed shadow roots. Absent when it read everything; the notes say the same in words.
     */
    reach?: Reach | undefined
    criteria?: CriterionCoverage[] | undefined
    /**
     * Set when the run used --fast (`fast: true`): what fast mode left out (probes, link following, OCR, contrast from
     * pixels, CSS background captures) and the limits it lowered (core/fast.ts). Every report format lists it with the coverage.
     */
    fast?: FastCoverage | undefined
  }
  /** What the engine, Rampa's rules or a probe rule could not decide, for a person to look at; never a failure. */
  needsReview?: ReviewItem[] | undefined
  usage: Usage
  errors: string[]
  /** What the collector or the rules could not see or decide, in the report's language. */
  notes?: string[] | undefined
  /**
   * Set when the form probe was allowed to submit forms (`--allow-submit`) or listed what it would submit
   * (`--submit-dry-run`), from its record, so a saved run replays it too: the origins named, the requests the guard
   * let through to them, those it blocked, and why nothing was submitted when nothing was. Every report format
   * prints it at the top (docs/probes.md, "Submitting forms").
   */
  submissions?: { allowed: string[]; dryRun: boolean; sent: number; blocked: number; skipped?: string | undefined } | undefined
  /**
   * Set with --profile: advisories beyond WCAG conformance, such as the cognitive profile's (src/advisory/types.ts).
   * They live outside findings, so nothing that reads findings (exit code, baseline, toPassRampa, MCP) sees them.
   */
  advisory?: AdvisorySection | undefined
  /**
   * Set with --timings (`timings: true` from code): where the page's time went, stage by stage and criterion by criterion
   * (core/timings.ts, docs/performance.md). Absent otherwise, so reports of the same page stay the same from run to run.
   */
  timings?: Timings | undefined
}
