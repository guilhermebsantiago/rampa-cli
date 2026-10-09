import type { z } from 'zod'
import type { BaselineComparison } from '../adoption/baseline.ts'
import type { Waiver } from '../adoption/waivers.ts'
import type { Locale } from '../i18n.ts'
import type { A11ySnapshot, Surface } from '../snapshot/schema.ts'
import type { Level, WcagTarget } from '../wcag.ts'

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
  /** Only the residue the engine could not decide. */
  candidates(snapshot: A11ySnapshot, engine: EngineResults): Candidate<Ctx>[]
  prompt(candidate: Candidate<Ctx>, snapshot: A11ySnapshot): Prompt
  schema: z.ZodType<Out>
  verify(output: Out, candidate: Candidate<Ctx>, snapshot: A11ySnapshot): Verification
  message(output: Out, candidate: Candidate<Ctx>, locale: Locale): string
  /**
   * What a claim about the candidate is about, read from the snapshot: the alt text, the link text,
   * the declared language. It keys the finding's fingerprint, which must never depend on the model's
   * wording; without it, the criterion and the ref alone do.
   */
  subject?(candidate: Candidate<Ctx>): string
  patch?(output: Out, candidate: Candidate<Ctx>, snapshot: A11ySnapshot): Patch | undefined
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
  /** engine: axe-core or the tree rules; rule: a Rampa rule over the snapshot (src/rules); judgment: a model, verified. */
  source: 'engine' | 'judgment' | 'rule'
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
  /** axe: an axe-core rule; rule: a Rampa rule over the tree or the pixels; judgment: a model, with verified evidence. */
  kind: 'axe' | 'rule' | 'judgment'
  /** The rule id, or `judgment/<criterion>@<version>`. */
  id: string
  /** False when the method applied but did not run, such as judgment with --no-llm. */
  ran: boolean
  /** Elements the method applied to (candidates, for judgment); passing elements are capped at 200 per rule. */
  applicable: number
  failures: number
  /** Elements left to a person: undecided by the engine, or where the model abstained. */
  review: number
  /** The rule can only pass or ask for review: it never reports a failure. */
  reviewOnly?: boolean | undefined
  /** Experimental methods report below the default confidence threshold until they pass the evaluation gate. */
  maturity: 'stable' | 'experimental'
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
   * judged: criteria a model judged; notChecked: criteria of the target with none of these, and no result to
   * review (4.1.1 is never listed). criteria: one record per criterion, with its status and methods.
   */
  coverage: { engine: string[]; judged: string[]; notChecked: string[]; rules?: string[] | undefined; criteria?: CriterionCoverage[] | undefined }
  /** What the engine or Rampa's rules could not decide, for a person to look at; never a failure. */
  needsReview?: ReviewItem[] | undefined
  usage: Usage
  errors: string[]
  /** What the collector or the rules could not see or decide, in the report's language. */
  notes?: string[] | undefined
}
