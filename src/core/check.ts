import type { CogaSettings } from '../advisory/check.ts'
import { runProfiles } from '../advisory/profile.ts'
import type { Profile } from '../advisory/types.ts'
import { probeJudgments } from '../criteria/character-key-shortcuts.ts'
import { type Locale, t } from '../i18n.ts'
import type { ModelProvider } from '../providers/types.ts'
import { probeChecks } from '../rules/probes.ts'
import { PROBE_RULES } from '../rules/registry.ts'
import { RULE_CHECKS, type RuleCheck, type RuleStageResult, emptyRuleStage, runRuleChecks, withoutResolved } from '../rules/index.ts'
import { reviewLabelInName } from '../rules/label-in-name.ts'
import { uncapturedImagesNote } from '../snapshot/image-skips.ts'
import { axNotes, browserNamed } from '../snapshot/ax.ts'
import { reachNotes, unreached } from '../snapshot/reach.ts'
import type { A11ySnapshot } from '../snapshot/schema.ts'
import { AXE_REVIEW_RULES, EXPERIMENTAL_RULES } from '../engine/axe.ts'
import { criteriaCoverage, engineCoverage, reviewItems, reviewOnlyCriteria, ruleCoverage } from './coverage.ts'
import { VERSION } from '../version.ts'
import { DEFAULT_WCAG, type WcagVersion, beyondTarget, compareCriteria, criteriaFor, successCriterion, wcagTarget } from '../wcag.ts'
import type { JudgmentCache } from './cache.ts'
import { judgeCandidates } from './judge.ts'
import {
  type AnyCriterion,
  type Candidate,
  CONFIDENCE_RANK,
  type Confidence,
  type CriterionSummary,
  type Discarded,
  type EngineResults,
  type Finding,
  type Report,
  type ReviewItem,
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
  /** The WCAG version the report states coverage against; 2.2 by default. */
  wcag?: WcagVersion | undefined
  /**
   * Ablation switch for the evaluation: when false, claims that fail
   * verification are kept as findings instead of discarded. Never use it in CI.
   */
  verify?: boolean | undefined
  /** Advisory profiles to run on top of the WCAG check, such as ['cognitive']: their results go to report.advisory, never to findings. */
  profiles?: readonly Profile[] | undefined
  /** Settings of the cognitive profile (`coga` in rampa.config.*). */
  coga?: CogaSettings | undefined
  /** Rampa's own rules (src/rules) to run next to the engine: all of them by default, none with false. */
  rules?: readonly RuleCheck[] | false | undefined
  /**
   * The most candidates of one criterion the model judges on a page (`--max-candidates`), so a long page finishes:
   * those whose text is generic first, then in page order. The rest are counted as not judged, in the criterion's
   * summary, its coverage and a note. What a criterion decides without a model never counts. Default
   * DEFAULT_MAX_CANDIDATES; 0 for no cap.
   */
  maxCandidates?: number | undefined
  /**
   * When to stop asking the model, in milliseconds since the epoch (`--time-limit`). Candidates not judged by then
   * are counted as not judged, and the report is written with what was collected and judged, and a note on the rest.
   * Cached judgments are still read.
   */
  deadline?: number | undefined
}

/** Candidates per criterion and page the model judges at most unless `maxCandidates` says otherwise. */
export const DEFAULT_MAX_CANDIDATES = 50

export function fingerprint(criterion: string, ref: string | undefined, detail: string): string {
  return sha256(`${criterion}|${ref ?? ''}|${normalizeForMatch(detail)}`).slice(0, 12)
}

export function engineFindings(engine: EngineResults): Finding[] {
  const findings: Finding[] = []
  for (const rule of engine.rules) {
    if (rule.outcome !== 'violation') continue
    const criteria = [...rule.criteria].sort(compareCriteria)
    const criterion = criteria[0] ?? 'best-practice'
    // An experimental axe-core rule Rampa runs on purpose reports needs review only (core/coverage.ts, reviewItems).
    if (AXE_REVIEW_RULES.includes(rule.ruleId)) continue
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
        confidence: node.confidence ?? (EXPERIMENTAL_RULES.has(rule.ruleId) ? 'low' : 'high'),
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
  const stage: RuleStageResult = options.rules === false ? emptyRuleStage() : runRuleChecks(snapshot, engine, options.locale, options.rules ?? RULE_CHECKS)
  // Label-in-name failures that differ only by a hyphen or a shortened word go to review (src/rules/label-in-name.ts).
  const fromEngine = options.rules === false ? engineFindings(engine) : reviewLabelInName(engineFindings(engine), snapshot, options.locale)
  // Facts a probe recorded in the snapshot, turned into findings by rules: no browser, no model.
  const probe = probeChecks(snapshot, options.locale, PROBE_RULES, options.wcag ?? DEFAULT_WCAG)
  let findings: Finding[] = [...fromEngine, ...stage.findings, ...probe.findings]
  const discarded: Discarded[] = []
  const summaries: CriterionSummary[] = []
  const errors: string[] = []
  const usage: Usage = { calls: 0, cachedCalls: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0 }
  const llmActive = options.llm && (options.provider !== undefined || options.offline)
  const cap = options.maxCandidates ?? DEFAULT_MAX_CANDIDATES
  // A timer that does not keep the process alive; the report is written when it fires, with what was judged by then.
  const signal = options.deadline === undefined ? undefined : AbortSignal.timeout(Math.max(0, options.deadline - Date.now()))
  // A probe that left a question for a model (2.1.4: is the way to a shortcut setting clearly labeled?) adds its judgment.
  const criteria = [...options.criteria, ...probeJudgments(snapshot).filter((extra) => !options.criteria.some((given) => given.id === extra.id))]
  // Judgments that may only clear a probe rule's finding: what each decided, applied once every criterion has run.
  const clearing: Array<{ rule: string; criterion: string; ref: string; passed: boolean; evidence?: string | undefined; control?: string | undefined; votes: number; total: number; model?: string | undefined }> = []

  for (const criterion of criteria) {
    // A criterion that moved to the browser's names reads the snapshot with them; the others, as the collector named it.
    const view = criterion.names === 'browser' ? browserNamed(snapshot) : snapshot
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
    // An element a stable rule already failed for this criterion is decided: the model is not asked again.
    const failedByRule = stage.decided.get(criterion.id)
    const candidates = criterion.candidates(view, engine).filter((candidate) => !failedByRule?.has(candidate.ref))
    summary.candidates = candidates.length
    // With judgment on but no model to ask, what the criterion decides by itself is still judged; --no-llm judges nothing.
    const judgeable = llmActive ? candidates : options.llm ? candidates.filter((candidate) => criterion.decide?.(candidate, view) !== undefined) : []
    const judged = capCandidates(criterion, view, judgeable, cap)
    if (judged.length < judgeable.length) summary.capped = judgeable.length - judged.length
    if (judged.length === 0) continue

    const judgments = await judgeCandidates(criterion, view, judged, {
      provider: options.provider,
      runs: options.runs,
      cache: options.cache,
      offline: options.offline,
      concurrency: options.concurrency,
      signal,
      deadline: options.deadline,
    })

    for (const judgment of judgments) {
      // A candidate the criterion passed or failed without a model counts in the coverage as its own method (kind rule).
      if (judgment.samples.some((sample) => sample.decided) && (judgment.status === 'passed' || judgment.status === 'failed')) {
        summary.decided = (summary.decided ?? 0) + 1
        if (judgment.status === 'failed') summary.decidedFailed = (summary.decidedFailed ?? 0) + 1
      }
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
        case 'not-judged':
          summary.timedOut = (summary.timedOut ?? 0) + 1
          continue
        case 'cannot_tell':
          summary.judged++
          summary.cannotTell++
          continue
        case 'passed':
          summary.judged++
          summary.passed++
          if (criterion.clears) {
            const output = judgment.representative as { evidence?: string; control?: string } | undefined
            clearing.push({
              rule: criterion.clears,
              criterion: criterion.id,
              ref: judgment.candidate.ref,
              passed: true,
              evidence: output?.evidence ?? '',
              control: output?.control,
              votes: judgment.votes,
              total: judgment.total,
              model: options.provider?.id ?? judgment.samples.find((s) => s.modelId)?.modelId,
            })
          }
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
          // A judgment that may only clear never makes a finding: its fail keeps the probe's, with the answer as evidence.
          if (criterion.clears) {
            if (judgment.status === 'failed') {
              clearing.push({
                rule: criterion.clears,
                criterion: criterion.id,
                ref: judgment.candidate.ref,
                passed: false,
                votes: judgment.votes,
                total: judgment.total,
                model: options.provider?.id ?? judgment.samples.find((s) => s.modelId)?.modelId,
              })
            }
            continue
          }
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
            patch: criterion.patch?.(output, judgment.candidate, view),
            confidence,
            // A judgment the criterion made without a model names no model; its message says what decided it.
            agreement: decided ? undefined : { votes: judgment.votes, total: judgment.total },
            model: decided ? undefined : (options.provider?.id ?? judgment.samples.find((s) => s.modelId)?.modelId),
          })
        }
      }
    }
  }

  for (const decision of clearing) {
    const target = (f: Finding) => f.source === 'probe' && f.ruleId === decision.rule && f.criterion === decision.criterion && f.ref === decision.ref
    const row = probe.coverage.find((r) => r.rule === decision.rule && r.criterion === decision.criterion)
    if (decision.passed) {
      const cleared = findings.filter(target).length
      findings = findings.filter((f) => !target(f))
      if (row && cleared > 0) {
        row.failures = Math.max(0, row.failures - cleared)
        if (row.failures === 0 && row.status === 'failures') row.status = row.review > 0 ? 'needs-review' : 'no-failure-found'
        const said = decision.control ? `"${decision.control}"` : `"${decision.evidence}"`
        const note = options.locale === 'pt-BR' ? `achado retirado pelo modelo: ${said} leva claramente às configurações` : `finding cleared by the model: ${said} clearly leads to the settings`
        row.note = row.note ? `${row.note}; ${note}` : note
      }
    } else {
      for (const finding of findings.filter(target)) {
        // A fail's evidence is not verified, so it is not quoted: the finding keeps the probe's own.
        const said =
          options.locale === 'pt-BR'
            ? 'o modelo não achou um controle visível que leve claramente a uma forma de desligá-los ou remapeá-los'
            : 'the model found no showing control that clearly leads to a way to turn them off or remap them'
        finding.evidence = finding.evidence ? `${finding.evidence}; ${said}` : said
        finding.model = decision.model
        finding.agreement = { votes: decision.votes, total: decision.total }
      }
    }
  }
  const notes = notJudgedNotes(summaries, cap, options.locale)

  // A judgment and a rule that fail the same element for the same criterion are one finding: the judgment's,
  // which says more and carries the patch. The rule's stays only where the model did not fail the element.
  const judgedFailures = new Set(findings.filter((f) => f.source === 'judgment').map((f) => `${f.criterion}|${f.ref}`))
  findings = findings.filter((f) => f.source !== 'rule' || !judgedFailures.has(`${f.criterion}|${f.ref}`))

  const version = options.wcag ?? DEFAULT_WCAG
  const waived = findings.filter((f) => options.waivers?.has(f.fingerprint))
  const unwaived = findings.filter((f) => !options.waivers?.has(f.fingerprint))
  // A WCAG 2.2 criterion in a 2.1 run is reported apart, and never counted.
  const beyond = unwaived.filter((f) => beyondTarget(f.criterion, version))
  const active = unwaived.filter((f) => !beyondTarget(f.criterion, version))
  const threshold = CONFIDENCE_RANK[options.minConfidence]
  // An experimental check reports below the default threshold until it passes the evaluation gate.
  const shown = (f: Finding) => CONFIDENCE_RANK[f.confidence] >= threshold && (!f.experimental || options.minConfidence === 'low')
  const reported = active.filter(shown)
  const belowThreshold = active.filter((f) => !shown(f))
  reported.sort((a, b) => compareCriteria(a.criterion, b.criterion))

  // 4.1.1 is never counted: WCAG 2.2 removed it, and under 2.1 it is satisfied by definition for HTML and XML.
  const all = new Set(criteriaFor(version).flatMap((sc) => (sc.removedIn ? [] : [sc.id])))
  // What axe-core left undecided and a rule then settled (contrast measured from pixels, a video the media probe played)
  // is the rule's to report, once.
  const settled = new Map(stage.resolved)
  for (const { engineRule, ref } of probe.resolved ?? []) settled.set(engineRule, new Set([...(settled.get(engineRule) ?? []), ref]))
  const unsettled = withoutResolved(engine, settled)
  const engineCovered = engineCoverage(unsettled, version)
  // What a judged criterion decided without a model (the language identifier on 3.1.1 and 3.1.2) is checked by a rule, not judged.
  const selfDecided = summaries.filter((s) => (s.decided ?? 0) > 0 && all.has(s.criterion)).map((s) => s.criterion)
  const ruleCovered = [...new Set([...ruleCoverage(stage.ran, version), ...selfDecided])].sort(compareCriteria)
  const judged = summaries.filter((s) => s.judged - (s.decided ?? 0) > 0 && all.has(s.criterion)).map((s) => s.criterion)
  // Criteria a probe rule decided something for: it found failures or found none in what it measured.
  const probed = [...new Set(probe.coverage.filter((row) => (row.status === 'failures' || row.status === 'no-failure-found') && all.has(row.criterion)).map((row) => row.criterion))]
  // What axe-core could not decide, and what Rampa's rules and probe rules sent to review: never a failure.
  const probeReview = probe.review.filter((f) => !options.waivers?.has(f.fingerprint)).map(reviewItemOf)
  const review = [...reviewItems(unsettled), ...stage.review, ...probeReview].sort((a, b) => compareCriteria(a.criterion, b.criterion))
  // Findings beyond the target still give their criterion its status, by the same threshold.
  const beyondShown = beyond.filter(shown)
  const beyondBelow = beyond.filter((f) => !shown(f))
  const records = criteriaCoverage({
    engine: unsettled,
    summaries,
    criteria,
    llmActive,
    reported: [...reported, ...beyondShown],
    belowThreshold: [...belowThreshold, ...beyondBelow],
    review,
    rules: stage.ran,
    probes: probe.coverage,
    version,
    locale: options.locale,
  })
  const reviewOnly = reviewOnlyCriteria(records, [...engineCovered, ...ruleCovered, ...probed], judged)
  const notChecked = [...all].filter(
    (id) => !engineCovered.includes(id) && !ruleCovered.includes(id) && !judged.includes(id) && !probed.includes(id) && !reviewOnly.includes(id),
  )

  const advisory =
    options.profiles && options.profiles.length > 0
      ? await runProfiles(snapshot, engine, {
          profiles: options.profiles,
          locale: options.locale,
          findings: [...reported, ...belowThreshold],
          llm: options.llm,
          provider: options.provider,
          offline: options.offline,
          cache: options.cache,
          runs: options.runs,
          concurrency: options.concurrency,
          minConfidence: options.minConfidence,
          waivers: options.waivers,
          coga: options.coga,
        })
      : undefined
  if (advisory) for (const key of ['calls', 'cachedCalls', 'inputTokens', 'outputTokens', 'latencyMs'] as const) usage[key] += advisory.usage[key]
  // Images the collector left without a capture were never in front of a criterion that judges pixels: say so, and why.
  const vision = criteria.some((criterion) => criterion.needs.vision && criterion.surfaces.includes(snapshot.surface))
  const uncaptured = vision && llmActive ? uncapturedImagesNote(snapshot.root, options.locale) : undefined
  // Frames and closed shadow roots the collector could not read: said first, since they frame everything else.
  // Then images left without a capture, then candidates the model did not judge.
  // What the browser's own accessibility tree left out comes with them: the rules that read it saw less.
  notes.unshift(...reachNotes(snapshot.reach, options.locale), ...axNotes(snapshot.axTree, options.locale), ...(uncaptured ? [uncaptured] : []))
  const reach = unreached(snapshot.reach)

  return {
    schemaVersion: 1,
    rampaVersion: VERSION,
    createdAt: new Date().toISOString(),
    target: snapshot.target,
    surface: snapshot.surface,
    wcagTarget: wcagTarget(version),
    locale: options.locale,
    llm: !options.llm ? 'off' : llmActive ? 'on' : 'no-model',
    model: options.provider?.id,
    engine: engine.engine,
    findings: reported,
    belowThreshold,
    ...(beyond.length > 0 ? { beyondTarget: beyond } : {}),
    waived,
    discarded,
    criteria: summaries,
    coverage: {
      engine: engineCovered,
      judged: judged.sort(compareCriteria),
      notChecked: notChecked.sort(compareCriteria),
      ...(ruleCovered.length > 0 ? { rules: ruleCovered } : {}),
      ...(probe.coverage.length > 0 ? { probes: probe.coverage } : {}),
      ...(reach ? { reach } : {}),
      criteria: records,
    },
    ...(review.length > 0 ? { needsReview: review } : {}),
    usage,
    errors,
    ...(notes.length > 0 ? { notes } : {}),
    ...(advisory ? { advisory: advisory.section } : {}),
  }
}

/**
 * The candidates the model judges when a criterion has more than `cap` that need it: those whose text is generic
 * (the criterion keeps the model's confidence on them, see criteria/generic-text.ts) come first, then the rest in page
 * order, and the chosen ones keep their page order. Candidates the criterion decides without a model always stay.
 */
export function capCandidates<C extends Candidate<unknown>>(criterion: AnyCriterion, snapshot: A11ySnapshot, candidates: C[], cap: number): C[] {
  if (cap <= 0 || candidates.length <= cap) return candidates
  const decided = new Set(candidates.filter((candidate) => criterion.decide?.(candidate, snapshot) !== undefined))
  const asked = candidates.filter((candidate) => !decided.has(candidate))
  if (asked.length <= cap) return candidates
  const first = asked.filter((candidate) => criterion.confidenceCap?.(candidate) === undefined)
  const chosen = new Set([...first, ...asked.filter((candidate) => !first.includes(candidate))].slice(0, cap))
  return candidates.filter((candidate) => decided.has(candidate) || chosen.has(candidate))
}

/** What the report says about candidates the model never judged: past the cap, and after the time limit. */
function notJudgedNotes(summaries: readonly CriterionSummary[], cap: number, locale: Locale): string[] {
  const notes: string[] = []
  const list = (key: 'capped' | 'timedOut') =>
    summaries
      .filter((s) => (s[key] ?? 0) > 0)
      .map((s) => t(locale, 'notJudgedItem', { criterion: s.criterion, count: s[key] ?? 0, total: s.candidates }))
      .join(', ')
  const capped = list('capped')
  if (capped) notes.push(t(locale, 'notJudgedCap', { max: cap, list: capped }))
  const timedOut = list('timedOut')
  if (timedOut) notes.push(t(locale, 'notJudgedTime', { list: timedOut }))
  return notes
}

/** A probe rule's item to review, in the shape of the engine's and the rules' (core/coverage.ts): never a finding. */
function reviewItemOf(finding: Finding): ReviewItem {
  return {
    criterion: finding.criterion,
    level: finding.level,
    ruleId: finding.ruleId ?? 'probe',
    ref: finding.ref,
    target: finding.target,
    html: finding.html,
    message: finding.message,
    ...(finding.evidence ? { evidence: finding.evidence } : {}),
  }
}
