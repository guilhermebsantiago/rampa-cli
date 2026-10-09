import type { JudgmentCache } from '../core/cache.ts'
import type { Confidence, EngineResults, Finding, Patch, Usage } from '../core/types.ts'
import type { Locale } from '../i18n.ts'
import type { ModelProvider } from '../providers/types.ts'
import type { Surface } from '../snapshot/schema.ts'
import type { DictionarySource } from './abbreviations/dictionaries.ts'
import type { Page } from './page.ts'
import type { AdvisoryCheckSummary, Basis, Impact, Related } from './types.ts'

/** What a check found about one subject (a field, a checkbox, a token): the runner adds the label and the fingerprint. */
export interface AdvisoryHit {
  kind: 'advisory' | 'beyond-target'
  basis: Basis
  related?: Related[] | undefined
  impact: Impact
  source: 'rule' | 'judgment'
  ref?: string | undefined
  html?: string | undefined
  message: string
  evidence?: string | undefined
  /** Keys the fingerprint with the check and the ref: the token, the placeholder, the field's purpose. */
  subject: string
  /** The subject belongs to the page, not to one element (a token): the fingerprint leaves the ref out, so it holds when the first use moves. */
  pageLevel?: boolean | undefined
  facts?: Record<string, string | number | boolean> | undefined
  patch?: Patch | undefined
  confidence: Confidence
  agreement?: { votes: number; total: number } | undefined
  model?: string | undefined
}

export interface CheckRun {
  ran: boolean
  reason?: string | undefined
  candidates: number
  hits: AdvisoryHit[]
  notes?: string[] | undefined
  model?: AdvisoryCheckSummary['model']
  usage?: Usage | undefined
  errors?: string[] | undefined
}

/** Settings of the cognitive profile, from rampa.config.* (`coga`). */
export interface CogaSettings {
  abbreviations?:
    | {
        /** Abbreviations the project treats as known: never reported. */
        known?: readonly string[] | undefined
        /** A link to this address explains an abbreviation, as a glossary does. */
        glossaryUrl?: string | undefined
      }
    | undefined
  /**
   * Adds the Brazilian plain-language law (Lei 15.263/2025) to the abbreviation advisories. Default: guessed
   * from the address (.gov.br, .leg.br, .jus.br, .mp.br).
   */
  publicSector?: boolean | undefined
  /** Where dictionaries come from; tests pass their own. Default: downloaded once into .rampa/dictionaries. */
  dictionaries?: DictionarySource | undefined
}

export interface AdvisoryContext {
  page: Page
  engine: EngineResults
  locale: Locale
  /** The run's WCAG findings, to link from an advisory on the same element instead of repeating them. */
  findings: readonly Finding[]
  llm: boolean
  provider: ModelProvider | undefined
  offline: boolean
  cache: JudgmentCache
  runs: number
  concurrency: number
  coga: CogaSettings
}

export interface AdvisoryCheck {
  id: string
  /** Bump when the logic or a list changes. */
  version: string
  maturity: 'stable' | 'experimental'
  /** The COGA pattern it screens in part, such as o4p06. */
  pattern: string
  surfaces: readonly Surface[]
  run(context: AdvisoryContext): CheckRun | Promise<CheckRun>
}
