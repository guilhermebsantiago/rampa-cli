import type { z } from 'zod'
import type { Locale } from '../i18n.ts'
import type { A11ySnapshot, Surface } from '../snapshot/schema.ts'
import type { Level } from '../wcag.ts'

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
  patch?(output: Out, candidate: Candidate<Ctx>, snapshot: A11ySnapshot): Patch | undefined
}

// biome-ignore lint/suspicious/noExplicitAny: registry of heterogeneous criteria
export type AnyCriterion = Criterion<any, any>

// Report

export interface Finding {
  /** Stable id used to waive a finding across runs. */
  fingerprint: string
  criterion: string
  level: Level | undefined
  source: 'engine' | 'judgment'
  ref?: string | undefined
  target?: string | undefined
  message: string
  evidence?: string | undefined
  patch?: Patch | undefined
  confidence: Confidence
  agreement?: { votes: number; total: number } | undefined
  ruleId?: string | undefined
  helpUrl?: string | undefined
  html?: string | undefined
  model?: string | undefined
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
  surface: Surface
  locale: Locale
  llm: 'on' | 'off' | 'no-model'
  model?: string | undefined
  engine: { name: string; version: string }
  findings: Finding[]
  belowThreshold: Finding[]
  waived: Finding[]
  discarded: Discarded[]
  criteria: CriterionSummary[]
  coverage: { engine: string[]; judged: string[]; notChecked: string[] }
  usage: Usage
  errors: string[]
}
