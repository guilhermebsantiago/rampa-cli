import type { Confidence, Patch, SourceLocation } from '../core/types.ts'
import type { Level } from '../wcag.ts'

/**
 * Advisories: results of the opt-in profiles (`--profile cognitive`) that are never WCAG failures.
 * They live in `report.advisory`, outside `report.findings`, so every reader of findings (the exit
 * code, baselines, toPassRampa, MCP, the SARIF error level) is unaffected by construction. A reader
 * that does not know `advisory` ignores it, which is the safe way to fail: advisories never gate.
 */

export const PROFILES = ['cognitive'] as const
export type Profile = (typeof PROFILES)[number]

/**
 * What the barrier does to the person: fixed per check and scope, documented with the user story it
 * rests on, and never chosen by the model. It is not a WCAG severity; confidence stays a separate axis.
 */
export type Impact = 'barrier' | 'hurdle' | 'suggestion'

export const IMPACT_RANK: Record<Impact, number> = { barrier: 0, hurdle: 1, suggestion: 2 }

/** The sentence of a COGA pattern a check screens: a Use or Avoid example, What to Do or How it Helps. */
export type CogaStatement = 'use' | 'avoid' | 'what-to-do' | 'how-it-helps'

export type Basis =
  | {
      framework: 'coga'
      /** o4p06 */
      pattern: string
      /** o4p06-clear-labels, the WAI slug */
      slug: string
      url: string
      /** The pattern's section of the W3C Note */
      tr: string
      statement: CogaStatement
      /** The sentence screened, quoted from the Note */
      quote: string
      /** The version of the guidance the check was written against; the task force is rewriting the patterns. */
      source: string
    }
  | {
      framework: 'wcag'
      id: string
      level: Level
      version: '2.1' | '2.2'
      /** Why it is outside the run's A/AA target: a AAA criterion, or one only WCAG 2.2 has. */
      outside: 'aaa' | 'wcag22'
      url: string
    }

export interface Reference {
  kind: 'law' | 'standard'
  /** 'Lei 15.263/2025, art. 5º, VIII' */
  label: string
  url: string
}

/** A WCAG finding of the same run on the same element: the advisory links it instead of repeating it. */
export interface RelatedFinding {
  finding: string
  criterion: string
}

export type Related = Basis | Reference | RelatedFinding

export interface Advisory {
  /** fingerprint(check, ref, subject); the `coga/` prefix keeps the namespace apart from WCAG findings. */
  fingerprint: string
  /** 'coga/visible-labels' */
  check: string
  /** advisory: COGA guidance. beyond-target: a WCAG criterion outside the run's A/AA target, such as 3.1.4 (AAA). */
  kind: 'advisory' | 'beyond-target'
  /**
   * The fixed label every advisory is shown with, from code and never from a check's text: what it rests on,
   * and that it is not a WCAG requirement (or that it is beyond the target).
   */
  label: string
  basis: Basis
  related?: Related[] | undefined
  impact: Impact
  /** rule: deterministic code decided it. judgment: a model took part, as in a proposed expansion. */
  source: 'rule' | 'judgment'
  ref?: string | undefined
  html?: string | undefined
  message: string
  evidence?: string | undefined
  /** What the advisory is about, as the snapshot has it (the token, the placeholder); it keys the fingerprint. */
  subject?: string | undefined
  /** What was measured, so the claim can be recomputed: the compiled pattern, each variant and its result… */
  facts?: Record<string, string | number | boolean> | undefined
  /** A suggestion: content wording belongs to the content owner. */
  patch?: Patch | undefined
  confidence: Confidence
  agreement?: { votes: number; total: number } | undefined
  /** The model that proposed text in this advisory, such as an expansion to confirm. */
  model?: string | undefined
  location?: SourceLocation | undefined
}

export interface AdvisoryCheckSummary {
  check: string
  /** Bump when the logic or the lists change. */
  version: string
  /**
   * experimental until the check passes the evaluation gate in docs/plans/cognitive-profile.md §4.2
   * (fixtures, corrupted pairs, about 60 annotated real-page results with a Wilson lower bound ≥ 0.85).
   */
  maturity: 'stable' | 'experimental'
  ran: boolean
  /** Why it did not run, or what it could not cover: 'snapshot truncated', 'no dictionary for fr'. */
  reason?: string | undefined
  candidates: number
  results: number
  /** The optional model step (abbreviations only): how many proposals were asked for, answered and errored. */
  model?: { asked: number; answered: number; kept: number; errors: number } | undefined
}

export type PatternStatus = 'screened' | 'not-run' | 'not-checked'

export interface AdvisorySection {
  profiles: Profile[]
  results: Advisory[]
  belowThreshold: Advisory[]
  waived: Advisory[]
  checks: AdvisoryCheckSummary[]
  coverage: {
    /** Every COGA pattern by slug. Never "passed": screened means some sub-checks ran. */
    patterns: Record<string, PatternStatus>
    /** WCAG criteria checked beyond the A/AA target, such as 3.1.4 (AAA). */
    beyondTarget: string[]
    /** Criteria tied to cognition that only a qualified reviewer can judge, such as 3.1.5 Reading Level. */
    needsReview: string[]
  }
  /** What the profile could not decide, in the report's language: a pattern browsers ignore, say. */
  notes: string[]
  /** Model errors of the optional model step; they never touch report.errors. */
  errors: string[]
  textMetrics?: TextMetrics | undefined
}

// Text measurements: context, never a verdict.

export interface SentenceQuote {
  ref: string
  words: number
  text: string
}

export interface FormulaResult {
  /** flesch-kincaid-en: Flesch Reading Ease and Flesch–Kincaid Grade; flesch-pt-martins-1996: the Portuguese adaptation. */
  id: 'flesch-kincaid-en' | 'flesch-pt-martins-1996'
  value: number
  /** Flesch–Kincaid Grade Level, English only. Never a grade for Portuguese. */
  grade?: number | undefined
  /** Martins et al. (1996) band, Portuguese only. */
  band?: 'very-easy' | 'easy' | 'fairly-difficult' | 'very-difficult' | undefined
  inputs: { words: number; sentences: number; syllables: number }
  /** How syllables were counted: rules for Portuguese, a heuristic for English (no pronouncing dictionary). */
  syllables: 'rules' | 'heuristic'
}

export interface TextMeasurement {
  /** Primary language subtag of the text measured: pt, en, or another one (counts only). */
  language: string
  /** main: paragraphs inside main or article; page: the page has neither, so paragraphs outside nav, header, footer, aside and forms. */
  scope: 'main' | 'page'
  paragraphs: number
  words: number
  sentences: number
  sentenceWords: { median: number; p90: number; max: number }
  longestSentences: SentenceQuote[]
  /** Three or more items joined by commas and a final and/or/e/ou: COGA o3p05 asks for a list. */
  listsAsProse: SentenceQuote[]
  /** English only, each with its source: COGA §4.4.5 (paragraphs over 50 words) and WCAG technique G153 (sentences). */
  english?: { paragraphsOver50Words: number; sentencesOver25Words: number; sentencesWithManyConjunctions: number } | undefined
  formula?: FormulaResult | undefined
  /** Why no formula: under 100 words of prose, or a language with no validated formula here. */
  formulaSkipped?: 'under-100-words' | 'no-formula-for-language' | undefined
}

export interface TextMetrics {
  measurements: TextMeasurement[]
  blocks: Array<{ ref: string; language: string; words: number; sentences: number }>
  /** Segmentation depends on the ICU in this Node, so every result records it. */
  versions: { icu: string; abbreviations: string; syllablesPt: string; syllablesEn: string }
}
