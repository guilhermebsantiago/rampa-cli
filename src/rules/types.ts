import type { Confidence, EngineResults, Patch } from '../core/types.ts'
import type { Locale } from '../i18n.ts'
import type { A11ySnapshot, Surface } from '../snapshot/schema.ts'
import type { TreeIndex } from '../snapshot/tree.ts'

/**
 * Rampa's own deterministic rules over the snapshot: no model, no browser. They sit next to
 * axe-core on the web (and next to the tree rules on native surfaces) and report with
 * finding source `rule`.
 *
 * `RuleCheck` is the deterministic half of the `Check` interface the cognitive profile plan
 * describes (WI-1): the same `id`, `version`, `maturity`, `surfaces`, `run`, `message` and
 * `patch`, with WCAG criteria where that interface has a basis. A rule never has a `judge`.
 */

export type Text = Record<Locale, string>

/** One element a rule decided on. */
export interface Hit {
  /** The element, as a snapshot ref (or a selector, for an element the snapshot leaves out, such as a meta tag). */
  ref: string
  /** fail: a WCAG failure. review: a person must decide; it goes to the report's needsReview, never a failure. */
  outcome: 'fail' | 'review'
  /** What the hit is about, read from the page: the alt text, the title. It keys the fingerprint, with the rule and the ref. */
  subject: string
  /** What the rule read, quoted in the report as evidence. */
  evidence?: string | undefined
  /** Values the message and the patch are built from. */
  facts: Record<string, string | number | boolean>
  /** The element's markup, for the report. */
  html?: string | undefined
  /** How sure the rule is of this hit, before maturity caps it. Defaults to high. */
  confidence?: Confidence | undefined
}

export interface RuleContext {
  locale: Locale
  index: TreeIndex
}

export interface RuleRun {
  hits: Hit[]
  /** Elements the rule looked at; zero means the rule did not apply to this page. */
  applicable: number
}

export interface RuleCheck {
  /** 'rampa/placeholder-alt'. The prefix keeps rule ids apart from axe-core's. */
  id: string
  /** Bump when the logic changes. */
  version: string
  /** WCAG success criteria; the first one is the finding's criterion. */
  criteria: readonly string[]
  /**
   * experimental: every hit is reported at low confidence, below the default threshold, and never
   * keeps a judged criterion from asking the model. stable: hits keep their confidence, and an element
   * a stable rule failed is not sent to the model for the same criterion.
   */
  maturity: 'stable' | 'experimental'
  surfaces: readonly Surface[]
  /** Reads the page as a whole (its title, its head, its HTTP response): left out when only a component is checked. */
  page?: boolean | undefined
  /** ACT rules the rule implements or is measured against. */
  act: readonly string[]
  /** axe-core rules that report the same failure: an element axe already failed on them is left to axe. */
  engineRules: readonly string[]
  help: Text
  helpUrl: string
  run(snapshot: A11ySnapshot, engine: EngineResults, ctx: RuleContext): RuleRun
  message(hit: Hit, locale: Locale): string
  patch?(hit: Hit, snapshot: A11ySnapshot): Patch | undefined
}
