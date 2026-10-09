import type { JudgmentCache } from '../core/cache.ts'
import { fingerprint } from '../core/check.ts'
import { CONFIDENCE_RANK, type Confidence, type EngineResults, type Finding, type Usage } from '../core/types.ts'
import { RampaError, errorMessage } from '../core/util.ts'
import type { Locale } from '../i18n.ts'
import type { ModelProvider } from '../providers/types.ts'
import type { A11ySnapshot } from '../snapshot/schema.ts'
import type { AdvisoryCheck, AdvisoryContext, AdvisoryHit, CogaSettings } from './check.ts'
import { abbreviations } from './checks/abbreviations.ts'
import { inputFormats } from './checks/input-formats.ts'
import { preselectedCost } from './checks/preselected-cost.ts'
import { visibleLabels } from './checks/visible-labels.ts'
import { COGA_PATTERNS } from './coga.ts'
import { advisoryLabel } from './label.ts'
import { readPage } from './page.ts'
import { measureText } from './text-metrics.ts'
import { type Advisory, type AdvisoryCheckSummary, type AdvisorySection, IMPACT_RANK, PROFILES, type PatternStatus, type Profile, type Related } from './types.ts'

/**
 * The cognitive profile (`--profile cognitive`): checks based on the W3C COGA guidance, run on top of the
 * WCAG A/AA check. Their results are advisories in `report.advisory`, never findings: they never count
 * toward WCAG coverage and never change the exit code unless `--fail-on advisory` asks for it.
 */

/** The wave-1 checks, in the order reports list them within one impact. */
export const COGNITIVE_CHECKS: readonly AdvisoryCheck[] = [inputFormats, preselectedCost, visibleLabels, abbreviations]

/** The profiles to run: the --profile flag, else the config's. A name Rampa does not know stops the run, like an unknown criterion. */
export function resolveProfiles(flag: string | undefined, configured: readonly string[] | undefined): Profile[] {
  const wanted = flag ? [flag] : [...(configured ?? [])]
  for (const name of wanted) {
    if (!(PROFILES as readonly string[]).includes(name)) throw new RampaError('unknown-profile', `Unknown profile "${name}". Available: ${PROFILES.join(', ')}.`)
  }
  return [...new Set(wanted)] as Profile[]
}

export interface ProfileOptions {
  profiles: readonly Profile[]
  locale: Locale
  /** The run's WCAG findings: an advisory on the same element links them. */
  findings: readonly Finding[]
  llm: boolean
  provider: ModelProvider | undefined
  offline: boolean
  cache: JudgmentCache
  runs: number
  concurrency: number
  minConfidence: Confidence
  waivers?: ReadonlySet<string> | undefined
  coga?: CogaSettings | undefined
}

export async function runProfiles(snapshot: A11ySnapshot, engine: EngineResults, options: ProfileOptions): Promise<{ section: AdvisorySection; usage: Usage }> {
  const usage: Usage = { calls: 0, cachedCalls: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0 }
  const page = readPage(snapshot)
  const context: AdvisoryContext = {
    page,
    engine,
    locale: options.locale,
    findings: options.findings,
    llm: options.llm,
    provider: options.provider,
    offline: options.offline,
    cache: options.cache,
    runs: options.runs,
    concurrency: options.concurrency,
    coga: options.coga ?? {},
  }
  const checks: AdvisoryCheckSummary[] = []
  const advisories: Array<{ advisory: Advisory; order: number; position: number }> = []
  const notes: string[] = []
  const errors: string[] = []
  const positionOf = new Map(page.ordered.map((node, index) => [node.ref, index]))

  for (const [order, check] of COGNITIVE_CHECKS.entries()) {
    const summary: AdvisoryCheckSummary = { check: check.id, version: check.version, maturity: check.maturity, ran: false, candidates: 0, results: 0 }
    checks.push(summary)
    if (!check.surfaces.includes(snapshot.surface)) {
      summary.reason = `not on ${snapshot.surface}`
      continue
    }
    try {
      const run = await check.run(context)
      summary.ran = run.ran
      summary.reason = run.reason
      summary.candidates = run.candidates
      summary.results = run.hits.length
      if (run.model) summary.model = run.model
      notes.push(...(run.notes ?? []))
      for (const error of run.errors ?? []) if (!errors.includes(error)) errors.push(error)
      for (const key of ['calls', 'cachedCalls', 'inputTokens', 'outputTokens', 'latencyMs'] as const) usage[key] += run.usage?.[key] ?? 0
      for (const hit of run.hits) {
        advisories.push({ advisory: toAdvisory(hit, check, options), order, position: hit.ref ? (positionOf.get(hit.ref) ?? 0) : 0 })
      }
    } catch (error) {
      // A check that breaks must not take the WCAG report down with it: it says it did not run, and why.
      summary.reason = errorMessage(error)
    }
  }

  advisories.sort((a, b) => IMPACT_RANK[a.advisory.impact] - IMPACT_RANK[b.advisory.impact] || a.order - b.order || a.position - b.position)
  const all = advisories.map((entry) => entry.advisory)
  const waived = all.filter((advisory) => options.waivers?.has(advisory.fingerprint))
  const active = all.filter((advisory) => !options.waivers?.has(advisory.fingerprint))
  const threshold = CONFIDENCE_RANK[options.minConfidence]

  return {
    usage,
    section: {
      profiles: [...options.profiles],
      results: active.filter((advisory) => CONFIDENCE_RANK[advisory.confidence] >= threshold),
      belowThreshold: active.filter((advisory) => CONFIDENCE_RANK[advisory.confidence] < threshold),
      waived,
      checks,
      coverage: {
        patterns: patternCoverage(checks),
        beyondTarget: checks.some((summary) => summary.check === abbreviations.id && summary.ran) ? ['3.1.4'] : [],
        needsReview: ['3.1.5'],
      },
      notes,
      errors,
      textMetrics: snapshot.surface === 'web' ? measureText(page) : undefined,
    },
  }
}

function toAdvisory(hit: AdvisoryHit, check: AdvisoryCheck, options: ProfileOptions): Advisory {
  const related: Related[] = [...(hit.related ?? [])]
  // A WCAG finding on the same element describes another defect: link it, never repeat it.
  for (const finding of options.findings) {
    if (hit.ref && finding.ref === hit.ref && !related.some((item) => 'finding' in item && item.finding === finding.fingerprint)) {
      related.push({ finding: finding.fingerprint, criterion: finding.criterion })
    }
  }
  return {
    fingerprint: fingerprint(check.id, hit.pageLevel ? undefined : hit.ref, hit.subject),
    check: check.id,
    kind: hit.kind,
    label: advisoryLabel(hit.basis, options.locale),
    basis: hit.basis,
    related: related.length > 0 ? related : undefined,
    impact: hit.impact,
    source: hit.source,
    ref: hit.ref,
    html: hit.html,
    message: hit.message,
    evidence: hit.evidence,
    subject: hit.subject,
    facts: hit.facts,
    patch: hit.patch,
    confidence: hit.confidence,
    agreement: hit.agreement,
    model: hit.model,
  }
}

/** Every pattern: screened when one of its checks ran, not run when its checks could not, otherwise not checked. */
function patternCoverage(checks: readonly AdvisoryCheckSummary[]): Record<string, PatternStatus> {
  const coverage: Record<string, PatternStatus> = {}
  for (const pattern of COGA_PATTERNS) {
    const own = COGNITIVE_CHECKS.filter((check) => check.pattern === pattern.id).map((check) => checks.find((summary) => summary.check === check.id))
    coverage[pattern.slug] = own.length === 0 ? 'not-checked' : own.some((summary) => summary?.ran) ? 'screened' : 'not-run'
  }
  return coverage
}
