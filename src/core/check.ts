import type { Locale } from '../i18n.ts'
import type { ModelProvider } from '../providers/types.ts'
import type { A11ySnapshot } from '../snapshot/schema.ts'
import { VERSION } from '../version.ts'
import { WCAG21_A_AA, compareCriteria, successCriterion } from '../wcag.ts'
import type { JudgmentCache } from './cache.ts'
import { judgeCandidates } from './judge.ts'
import {
  type AnyCriterion,
  CONFIDENCE_RANK,
  type Confidence,
  type CriterionSummary,
  type Discarded,
  type EngineResults,
  type Finding,
  type Report,
  type Usage,
  minConfidence,
} from './types.ts'
import { normalizeForMatch, sha256 } from './util.ts'

export interface CheckOptions {
  criteria: AnyCriterion[]
  /** Run the judgment layer. False = deterministic baseline only. */
  llm: boolean
  provider: ModelProvider | undefined
  runs: number
  cache: JudgmentCache
  offline: boolean
  locale: Locale
  minConfidence: Confidence
  concurrency: number
  /** Fingerprints of findings someone dismissed on purpose. */
  waivers?: ReadonlySet<string> | undefined
  /**
   * Ablation switch for the evaluation: when false, claims that fail
   * verification are kept as findings instead of discarded. Never use it in CI.
   */
  verify?: boolean | undefined
}

export function fingerprint(criterion: string, ref: string | undefined, detail: string): string {
  return sha256(`${criterion}|${ref ?? ''}|${normalizeForMatch(detail)}`).slice(0, 12)
}

export function engineFindings(engine: EngineResults): Finding[] {
  const findings: Finding[] = []
  for (const rule of engine.rules) {
    if (rule.outcome !== 'violation') continue
    const criteria = [...rule.criteria].sort(compareCriteria)
    const criterion = criteria[0] ?? 'best-practice'
    for (const node of rule.nodes) {
      findings.push({
        fingerprint: fingerprint(criterion, node.ref ?? node.target, rule.ruleId),
        criterion,
        level: successCriterion(criterion)?.level,
        source: 'engine',
        ref: node.ref,
        target: node.target,
        message: node.detail ?? rule.help,
        evidence: node.evidence,
        confidence: node.confidence ?? 'high',
        ruleId: rule.ruleId,
        helpUrl: rule.helpUrl,
        html: node.html,
        locatedBy: node.locatedBy,
      })
    }
  }
  return findings
}

export async function checkSnapshot(snapshot: A11ySnapshot, engine: EngineResults, options: CheckOptions): Promise<Report> {
  const findings: Finding[] = engineFindings(engine)
  const discarded: Discarded[] = []
  const summaries: CriterionSummary[] = []
  const errors: string[] = []
  const usage: Usage = { calls: 0, cachedCalls: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0 }
  const llmActive = options.llm && (options.provider !== undefined || options.offline)

  for (const criterion of options.criteria) {
    const summary: CriterionSummary = {
      criterion: criterion.id,
      applicable: criterion.surfaces.includes(snapshot.surface),
      candidates: 0,
      judged: 0,
      failed: 0,
      passed: 0,
      cannotTell: 0,
      discarded: 0,
      errors: 0,
      offlineMisses: 0,
    }
    summaries.push(summary)
    if (!summary.applicable) continue

    await criterion.prepare?.()
    const candidates = criterion.candidates(snapshot, engine)
    summary.candidates = candidates.length
    // With judgment on but no model to ask, what the criterion decides by itself is still judged; --no-llm judges nothing.
    const judged = llmActive ? candidates : options.llm ? candidates.filter((candidate) => criterion.decide?.(candidate, snapshot) !== undefined) : []
    if (judged.length === 0) continue

    const judgments = await judgeCandidates(criterion, snapshot, judged, {
      provider: options.provider,
      runs: options.runs,
      cache: options.cache,
      offline: options.offline,
      concurrency: options.concurrency,
    })

    for (const judgment of judgments) {
      for (const sample of judgment.samples) {
        if (sample.decided) continue
        if (sample.cached) usage.cachedCalls++
        else if (sample.output) usage.calls++
        usage.inputTokens += sample.inputTokens
        usage.outputTokens += sample.outputTokens
        usage.latencyMs += sample.latencyMs
      }
      switch (judgment.status) {
        case 'error': {
          summary.errors++
          const error = judgment.samples.find((s) => s.error)?.error
          if (error && !errors.includes(error)) errors.push(error)
          continue
        }
        case 'offline-miss':
          summary.offlineMisses++
          continue
        case 'cannot_tell':
          summary.judged++
          summary.cannotTell++
          continue
        case 'passed':
          summary.judged++
          summary.passed++
          continue
        case 'discarded':
        case 'failed': {
          summary.judged++
          if (judgment.status === 'discarded') {
            summary.discarded++
            discarded.push({
              criterion: criterion.id,
              ref: judgment.candidate.ref,
              reason: judgment.verification && !judgment.verification.ok ? judgment.verification.reason : 'unverified',
              output: judgment.representative,
            })
            // Ablation (verify: false) keeps an unverified fail claim as a finding.
            if (options.verify !== false || judgment.verdict !== 'fail') continue
          } else {
            summary.failed++
          }
          const output = judgment.representative
          if (!output) continue
          const agreement = judgment.votes / Math.max(1, judgment.total)
          const voted: Confidence =
            agreement === 1 ? output.confidence : agreement >= 2 / 3 ? minConfidence(output.confidence, 'medium') : 'low'
          const confidence = minConfidence(voted, criterion.confidenceCap?.(judgment.candidate) ?? 'high')
          const decided = judgment.samples.some((sample) => sample.decided)
          // Keyed on what was judged, never on the model's quote: models pick different words to quote
          // from run to run, and a fingerprint that moves breaks every waiver and baseline holding it.
          const subject = criterion.subject?.(judgment.candidate)
          findings.push({
            fingerprint: fingerprint(criterion.id, judgment.candidate.ref, subject ?? ''),
            criterion: criterion.id,
            level: criterion.level,
            source: 'judgment',
            ref: judgment.candidate.ref,
            message: criterion.message(output, judgment.candidate, options.locale),
            evidence: output.evidence,
            subject,
            patch: criterion.patch?.(output, judgment.candidate, snapshot),
            confidence,
            // A judgment the criterion made without a model names no model; its message says what decided it.
            agreement: decided ? undefined : { votes: judgment.votes, total: judgment.total },
            model: decided ? undefined : (options.provider?.id ?? judgment.samples.find((s) => s.modelId)?.modelId),
          })
        }
      }
    }
  }

  const waived = findings.filter((f) => options.waivers?.has(f.fingerprint))
  const active = findings.filter((f) => !options.waivers?.has(f.fingerprint))
  const threshold = CONFIDENCE_RANK[options.minConfidence]
  const reported = active.filter((f) => CONFIDENCE_RANK[f.confidence] >= threshold)
  const belowThreshold = active.filter((f) => CONFIDENCE_RANK[f.confidence] < threshold)
  reported.sort((a, b) => compareCriteria(a.criterion, b.criterion))

  const all = new Set(WCAG21_A_AA.map((sc) => sc.id))
  const engineCovered = new Set(
    engine.rules.filter((r) => r.outcome !== 'inapplicable').flatMap((r) => r.criteria.filter((c) => all.has(c))),
  )
  const judged = summaries.filter((s) => s.judged > 0).map((s) => s.criterion)
  const notChecked = [...all].filter((id) => !engineCovered.has(id) && !judged.includes(id))

  return {
    schemaVersion: 1,
    rampaVersion: VERSION,
    createdAt: new Date().toISOString(),
    target: snapshot.target,
    surface: snapshot.surface,
    locale: options.locale,
    llm: !options.llm ? 'off' : llmActive ? 'on' : 'no-model',
    model: options.provider?.id,
    engine: engine.engine,
    findings: reported,
    belowThreshold,
    waived,
    discarded,
    criteria: summaries,
    coverage: {
      engine: [...engineCovered].sort(compareCriteria),
      judged: judged.sort(compareCriteria),
      notChecked: notChecked.sort(compareCriteria),
    },
    usage,
    errors,
  }
}
