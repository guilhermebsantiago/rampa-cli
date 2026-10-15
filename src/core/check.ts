import type { CogaSettings } from '../advisory/check.ts'
import { runProfiles } from '../advisory/profile.ts'
import type { Profile } from '../advisory/types.ts'
import { probeJudgments } from '../criteria/probe-judgments.ts'
import { type Locale, t } from '../i18n.ts'
import type { ModelProvider } from '../providers/types.ts'
import { prepareProbeRules, probeChecks } from '../rules/probes.ts'
import { PROBE_RULES } from '../rules/registry.ts'
import { submissionSummary } from '../rules/submit.ts'
import { RULE_CHECKS, type RuleCheck, type RuleStageResult, type Settlement, emptyRuleStage, runRuleChecks, withoutResolved } from '../rules/index.ts'
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
import { type Sample, judgeCandidates } from './judge.ts'
import type { FastCoverage } from './fast.ts'
import { assertConfidence, meetsThreshold, nothingJudgedNote } from './gate.ts'
import { judgmentMaturity } from './maturity.ts'
import { type CriterionTiming, type Stopwatch, timed } from './timings.ts'
import {
  type AnyCriterion,
  type Candidate,
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
  /** Records how long the rules, each criterion and the advisory profiles take (`--timings`, core/timings.ts). */
  timings?: Stopwatch | undefined
  /** The run used --fast: what it left out and lowered, stated in the report's coverage (core/fast.ts). */
  fast?: FastCoverage | undefined
  /**
   * Batched judgment (--batch, on in --fast): the criteria that allow it (`Criterion.batch`) judge their candidates
   * several to a call (core/batch.ts). Each criterion's summary counts them, and a note says so.
   */
  batch?: boolean | undefined
}

/** Candidates per criterion and page the model judges at most unless `maxCandidates` says otherwise. */
export const DEFAULT_MAX_CANDIDATES = 50

/** The cap when it is below the default one (fast mode's coverage line lists it); undefined for the default, a higher cap or none. */
export function loweredCap(cap: number | undefined): number | undefined {
  return cap !== undefined && cap > 0 && cap < DEFAULT_MAX_CANDIDATES ? cap : undefined
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
    // An experimental axe-core rule Rampa runs on purpose reports needs review only (core/coverage.ts, reviewItems).
    if (AXE_REVIEW_RULES.includes(rule.ruleId)) continue
    // An experimental rule (target-size) reports at low confidence, and says it is experimental.
    const experimental = EXPERIMENTAL_RULES.has(rule.ruleId)
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
        confidence: node.confidence ?? (experimental ? 'low' : 'high'),
        ruleId: rule.ruleId,
        helpUrl: rule.helpUrl,
        html: node.html,
        locatedBy: node.locatedBy,
        ...(experimental ? { experimental: true } : {}),
      })
    }
  }
  return findings
}

export async function checkSnapshot(snapshot: A11ySnapshot, engine: EngineResults, options: CheckOptions): Promise<Report> {
  // From JavaScript or a config file the type does not hold: an unknown level would put every finding below the threshold.
  const threshold = assertConfidence(options.minConfidence)
  const watch = options.timings
  const ruleStart = performance.now()
  // An XML document the collector did not read (surfaces/web.ts): no rule and no judgment runs, and a note says so.
  const unread = snapshot.document?.kind === 'xml'
  const stage: RuleStageResult = options.rules === false || unread ? emptyRuleStage() : runRuleChecks(snapshot, engine, options.locale, options.rules ?? RULE_CHECKS)
  // Label-in-name failures that differ only by a hyphen or a shortened word go to review (src/rules/label-in-name.ts).
  const fromEngine = options.rules === false ? engineFindings(engine) : reviewLabelInName(engineFindings(engine), snapshot, options.locale)
  // Facts a probe recorded in the snapshot, turned into findings by rules: no browser, no model.
  await prepareProbeRules(snapshot, PROBE_RULES)
  const probe = probeChecks(snapshot, options.locale, PROBE_RULES, options.wcag ?? DEFAULT_WCAG, engine)
  watch?.add('rules', performance.now() - ruleStart)
  let findings: Finding[] = [...fromEngine, ...stage.findings, ...probe.findings]
  const discarded: Discarded[] = []
  const summaries: CriterionSummary[] = []
  const errors: string[] = []
  const usage: Usage = { calls: 0, cachedCalls: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0 }
  const llmActive = options.llm && (options.provider !== undefined || options.offline)
  const cap = options.maxCandidates ?? DEFAULT_MAX_CANDIDATES
  // A timer that does not keep the process alive; the report is written when it fires, with what was judged by then.
  const signal = options.deadline === undefined ? undefined : AbortSignal.timeout(Math.max(0, options.deadline - Date.now()))
  // A probe that left a question for a model (2.1.4: is the way to a shortcut setting clearly labeled? 3.3.8: is this a
  // cognitive function test?) adds its judgment.
  const criteria = unread ? [] : [...options.criteria, ...probeJudgments(snapshot).filter((extra) => !options.criteria.some((given) => given.id === extra.id))]
  // Judgments that may only clear a probe rule's finding: what each decided, applied once every criterion has run.
  const clearing: Array<{ rule: string; criterion: string; ref: string; passed: boolean; evidence?: string | undefined; control?: string | undefined; votes: number; total: number; model?: string | undefined; note?: string | undefined }> = []
  // Judgments that decide a probe rule's items to review (4.1.3): which item each verified answer settled, and which
  // item a pass that verification dropped (`unverified`) leaves where it is.
  const settling: Array<{ rule: string; criterion: string; key: string; passed: boolean; unverified?: boolean | undefined; note?: string | undefined }> = []
  // Verified fails that no fact Rampa checks supports (Criterion.grounded): the model's suggestions, for a person to decide.
  const suggestions: ReviewItem[] = []

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

    const started = performance.now()
    await criterion.prepare?.(view)
    const prepareMs = performance.now() - started
    // An element a stable rule already failed for this criterion is decided: the model is not asked again.
    const failedByRule = stage.decided.get(criterion.id)
    const candidates = criterion.candidates(view, engine).filter((candidate) => !failedByRule?.has(candidate.ref))
    summary.candidates = candidates.length
    // With judgment on but no model to ask, what the criterion decides by itself is still judged; --no-llm judges nothing.
    const judgeable = llmActive ? candidates : options.llm ? candidates.filter((candidate) => criterion.decide?.(candidate, view) !== undefined) : []
    const judged = capCandidates(criterion, view, judgeable, cap)
    if (judged.length < judgeable.length) summary.capped = judgeable.length - judged.length
    if (judged.length === 0) {
      watch?.criterion(criterionTiming(criterion.id, started, prepareMs, candidates.length, []))
      continue
    }

    const judgments = await judgeCandidates(criterion, view, judged, {
      provider: options.provider,
      runs: options.runs,
      cache: options.cache,
      offline: options.offline,
      concurrency: options.concurrency,
      signal,
      deadline: options.deadline,
      batch: options.batch,
    })
    watch?.criterion(criterionTiming(criterion.id, started, prepareMs, candidates.length, judgments))
    const inBatches = judgments.filter((judgment) => judgment.samples.some((sample) => sample.batch))
    if (inBatches.length > 0) {
      const calls = inBatches.reduce((sum, judgment) => sum + judgment.samples.filter((sample) => sample.batch && !sample.batch.shared).length, 0)
      summary.batched = { candidates: inBatches.length, calls }
    }

    for (const judgment of judgments) {
      // A candidate the criterion passed or failed without a model counts in the coverage as its own method (kind rule).
      if (judgment.samples.some((sample) => sample.decided) && (judgment.status === 'passed' || judgment.status === 'failed')) {
        summary.decided = (summary.decided ?? 0) + 1
        if (judgment.status === 'failed') summary.decidedFailed = (summary.decidedFailed ?? 0) + 1
      }
      for (const sample of judgment.samples) {
        // A batch's call is counted once, on the first candidate it answered.
        if (sample.decided || sample.batch?.shared) continue
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
              note: judgment.representative && criterion.clearedNote ? criterion.clearedNote(judgment.representative, options.locale) : undefined,
              votes: judgment.votes,
              total: judgment.total,
              model: options.provider?.id ?? judgment.samples.find((s) => s.modelId)?.modelId,
            })
          }
          if (criterion.settles && criterion.settledKey) {
            settling.push({
              rule: criterion.settles,
              criterion: criterion.id,
              key: criterion.settledKey(judgment.candidate),
              passed: true,
              note: judgment.representative && criterion.settledNote ? criterion.settledNote(judgment.representative, judgment.candidate, options.locale) : undefined,
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
            // A pass verification dropped settles nothing: its item stays for a person, saying the model passed it unproven.
            if (criterion.settles && criterion.settledKey && judgment.verdict === 'pass' && judgment.representative) {
              const note = criterion.unsettledNote?.(judgment.representative, judgment.candidate, options.locale)
              settling.push({ rule: criterion.settles, criterion: criterion.id, key: criterion.settledKey(judgment.candidate), passed: true, unverified: true, note })
            }
            // Ablation (verify: false) keeps an unverified fail claim as a finding.
            if (options.verify !== false || judgment.verdict !== 'fail') continue
          }
          const output = judgment.representative
          if (!output) continue
          // A fail that rests on the model's reading alone is its suggestion, not a finding (the ablation keeps it as one).
          if (judgment.status === 'failed' && options.verify !== false && criterion.grounded && !criterion.grounded(output, judgment.candidate, view)) {
            summary.suggested = (summary.suggested ?? 0) + 1
            const suggested = criterion.patch?.(output, judgment.candidate, view)?.to
            suggestions.push({
              criterion: criterion.id,
              level: criterion.level,
              ruleId: `judgment/${criterion.id}`,
              ref: judgment.candidate.ref,
              message: criterion.message(output, judgment.candidate, options.locale),
              ...(suggested ? { evidence: t(options.locale, 'suggestedText', { text: suggested }) } : {}),
              model: options.provider?.id ?? judgment.samples.find((s) => s.modelId)?.modelId,
            })
            continue
          }
          if (judgment.status === 'failed') summary.failed++
          // A judgment that may only clear never makes a finding: its fail keeps the probe's, with the answer as evidence.
          if (criterion.clears) {
            if (judgment.status === 'failed') {
              clearing.push({
                rule: criterion.clears,
                criterion: criterion.id,
                ref: judgment.candidate.ref,
                passed: false,
                note: criterion.keptNote ? criterion.keptNote(output, options.locale) : undefined,
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
            // An experimental module, or a judgment over a probe's facts, which is as experimental as the probe.
            ...(judgmentMaturity(criterion) === 'experimental' ? { experimental: true } : {}),
          })
          if (criterion.settles && criterion.settledKey && judgment.status === 'failed') {
            settling.push({ rule: criterion.settles, criterion: criterion.id, key: criterion.settledKey(judgment.candidate), passed: false })
          }
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
        const note =
          decision.note ??
          (options.locale === 'pt-BR' ? `achado retirado pelo modelo: ${said} leva claramente às configurações` : `finding cleared by the model: ${said} clearly leads to the settings`)
        row.note = row.note ? `${row.note}; ${note}` : note
      }
    } else {
      for (const finding of findings.filter(target)) {
        // A fail's evidence is not verified, so it is not quoted: the finding keeps the probe's own.
        const said =
          decision.note ??
          (options.locale === 'pt-BR'
            ? 'o modelo não achou um controle visível que leve claramente a uma forma de desligá-los ou remapeá-los'
            : 'the model found no showing control that clearly leads to a way to turn them off or remap them')
        finding.evidence = finding.evidence ? `${finding.evidence}; ${said}` : said
        finding.model = decision.model
        finding.agreement = { votes: decision.votes, total: decision.total }
      }
    }
  }
  // A verified answer takes the probe rule's item to review off the list: its fail is the judgment's finding, its pass a note.
  for (const decision of settling) {
    const at = probe.review.findIndex((f) => f.ruleId === decision.rule && f.criterion === decision.criterion && f.fingerprint === decision.key)
    if (at < 0) continue
    if (decision.unverified) {
      const item = probe.review[at]
      const note =
        decision.note ??
        (options.locale === 'pt-BR' ? 'o modelo o aprovou sem evidência verificada, então fica para uma pessoa' : 'the model passed it without verified evidence, so it stays for a person')
      if (item) item.evidence = item.evidence ? `${item.evidence}; ${note}` : note
      continue
    }
    probe.review.splice(at, 1)
    const row = probe.coverage.find((r) => r.rule === decision.rule && r.criterion === decision.criterion)
    if (!row) continue
    row.review = Math.max(0, row.review - 1)
    if (!decision.passed) row.failures++
    else if (decision.note) row.note = row.note ? `${row.note}; ${decision.note}` : decision.note
    row.status = row.failures > 0 ? 'failures' : row.review > 0 ? 'needs-review' : 'no-failure-found'
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
  // An experimental check reports below the default threshold until it passes the evaluation gate.
  const shown = (f: Finding) => meetsThreshold(f, threshold)
  const reported = active.filter(shown)
  const belowThreshold = active.filter((f) => !shown(f))
  reported.sort((a, b) => compareCriteria(a.criterion, b.criterion))

  // 4.1.1 is never counted: WCAG 2.2 removed it, and under 2.1 it is satisfied by definition for HTML and XML.
  const all = new Set(criteriaFor(version).flatMap((sc) => (sc.removedIn ? [] : [sc.id])))
  // What axe-core left undecided and a rule then took over (contrast measured from pixels, a video the media probe
  // played) leaves axe-core's items to review only where the report shows the rule's result instead.
  const { settled, context } = settledResults([...stage.settlements, ...(probe.settlements ?? [])], {
    shown: [...reported, ...beyond.filter(shown), ...waived],
    below: [...belowThreshold, ...beyond.filter((f) => !shown(f))],
    threshold,
    locale: options.locale,
  })
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
  const kept = reviewItems(unsettled).map((item) => {
    const measured = context.get(`${item.ruleId}|${item.ref ?? item.target}`)
    return measured ? { ...item, evidence: measured } : item
  })
  const review = [...kept, ...stage.review, ...probeReview, ...suggestions].sort((a, b) => compareCriteria(a.criterion, b.criterion))
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

  const profiles = options.profiles
  const advisory =
    profiles && profiles.length > 0
      ? await timed(watch, 'advisory', () =>
          runProfiles(snapshot, engine, {
            profiles,
            locale: options.locale,
            findings: [...reported, ...belowThreshold],
            llm: options.llm,
            provider: options.provider,
            offline: options.offline,
            cache: options.cache,
            runs: options.runs,
            concurrency: options.concurrency,
            minConfidence: threshold,
            waivers: options.waivers,
            coga: options.coga,
          }),
        )
      : undefined
  if (advisory) for (const key of ['calls', 'cachedCalls', 'inputTokens', 'outputTokens', 'latencyMs'] as const) usage[key] += advisory.usage[key]
  // Images the collector left without a capture were never in front of a criterion that judges pixels: say so, and why.
  const vision = criteria.some((criterion) => criterion.needs.vision && criterion.surfaces.includes(snapshot.surface))
  const uncaptured = vision && llmActive ? uncapturedImagesNote(snapshot.root, options.locale) : undefined
  // Frames and closed shadow roots the collector could not read: said first, since they frame everything else.
  // Then images left without a capture, then candidates the model did not judge.
  // What the browser's own accessibility tree left out comes with them: the rules that read it saw less.
  notes.unshift(...reachNotes(snapshot.reach, options.locale), ...axNotes(snapshot.axTree, options.locale), ...(uncaptured ? [uncaptured] : []))
  // A page that is not an HTML document frames everything else: said first.
  if (snapshot.document) notes.unshift(t(options.locale, snapshot.document.kind === 'svg' ? 'documentSvg' : 'documentXml', { contentType: snapshot.document.contentType }))
  const reach = unreached(snapshot.reach)
  // The form probe submitted forms, or listed what it would: every report says so at the top.
  const submissions = submissionSummary(snapshot)
  const llm: Report['llm'] = !options.llm ? 'off' : llmActive ? 'on' : 'no-model'
  // Judgment was asked for and the model judged nothing: the report says so, and rampa check exits 2.
  const nothingJudged = nothingJudgedNote({ llm, criteria: summaries, locale: options.locale })
  if (nothingJudged) notes.push(nothingJudged)

  return {
    schemaVersion: 1,
    rampaVersion: VERSION,
    createdAt: new Date().toISOString(),
    target: snapshot.target,
    surface: snapshot.surface,
    wcagTarget: wcagTarget(version),
    locale: options.locale,
    llm,
    model: options.provider?.id,
    engine: engine.engine,
    minConfidence: threshold,
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
      ...(options.fast ? { fast: options.fast } : {}),
    },
    ...(review.length > 0 ? { needsReview: review } : {}),
    usage,
    errors,
    ...(notes.length > 0 ? { notes } : {}),
    ...(submissions ? { submissions } : {}),
    ...(advisory ? { advisory: advisory.section } : {}),
  }
}

/**
 * The candidates the model judges when a criterion has more than `cap` that need it: those a checked fact could make a
 * finding of (`judgeFirst`, such as a text on the generic lists, see criteria/generic-text.ts; else those the criterion
 * keeps the model's confidence on) come first, then the rest in page order, and the chosen ones keep their page order.
 * Candidates the criterion decides without a model always stay.
 */
export function capCandidates<C extends Candidate<unknown>>(criterion: AnyCriterion, snapshot: A11ySnapshot, candidates: C[], cap: number): C[] {
  if (cap <= 0 || candidates.length <= cap) return candidates
  const decided = new Set(candidates.filter((candidate) => criterion.decide?.(candidate, snapshot) !== undefined))
  const asked = candidates.filter((candidate) => !decided.has(candidate))
  if (asked.length <= cap) return candidates
  const first = asked.filter((candidate) => criterion.judgeFirst?.(candidate) ?? criterion.confidenceCap?.(candidate) === undefined)
  const chosen = new Set([...first, ...asked.filter((candidate) => !first.includes(candidate))].slice(0, cap))
  return candidates.filter((candidate) => decided.has(candidate) || chosen.has(candidate))
}

/** A criterion's time on the page, with the model calls its judgments made and read from the cache, counted as `usage` counts them. */
function criterionTiming(criterion: string, started: number, prepareMs: number, candidates: number, judgments: ReadonlyArray<{ samples: readonly Sample<unknown>[] }>): CriterionTiming {
  let calls = 0
  let cachedCalls = 0
  let batches = 0
  for (const sample of judgments.flatMap((judgment) => judgment.samples)) {
    if (sample.decided || sample.batch?.shared) continue
    if (sample.batch) batches++
    if (sample.cached) cachedCalls++
    else if (sample.output) calls++
  }
  return { criterion, ms: performance.now() - started, prepareMs, candidates, judged: judgments.length, calls, cachedCalls, ...(batches > 0 ? { batches } : {}) }
}

/** What the report says about candidates the model never judged (past the cap, after the time limit), and those it judged in batches. */
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
  const batched = summaries
    .flatMap((s) => (s.batched ? [t(locale, 'batchedItem', { criterion: s.criterion, count: s.batched.candidates, calls: s.batched.calls })] : []))
    .join(', ')
  if (batched) notes.push(t(locale, 'batchedNote', { list: batched }))
  return notes
}

/**
 * Which undecided engine results the rules that took them over (`RuleCheck.resolves`, `ProbeRuleResult.resolved`) replace
 * in the report, by engine rule: an element the rule sent to its own review, one axe-core failed itself, one whose
 * failure the report shows (or a waiver covers), and one the rule passed at a confidence that meets the threshold. An
 * experimental rule's verdict is below the default threshold, so there it never takes axe-core's item to review away:
 * the item stays, and `context` holds what the rule measured, for its evidence, keyed `engine rule|ref`.
 */
export function settledResults(
  settlements: readonly Settlement[],
  report: { shown: readonly Finding[]; below: readonly Finding[]; threshold: Confidence; locale: Locale },
): { settled: Map<string, Set<string>>; context: Map<string, string> } {
  const settled = new Map<string, Set<string>>()
  const context = new Map<string, string>()
  for (const s of settlements) {
    const about = (f: Finding) => f.ref === s.ref && (f.ruleId === s.rule || s.criteria.includes(f.criterion))
    const decided =
      s.outcome === 'review' ||
      s.outcome === 'engine' ||
      (s.outcome === 'fail' && report.shown.some(about)) ||
      (s.outcome === 'pass' && meetsThreshold({ confidence: 'high', experimental: s.experimental }, report.threshold))
    if (decided) {
      settled.set(s.engineRule, (settled.get(s.engineRule) ?? new Set()).add(s.ref))
      continue
    }
    const measured = s.outcome === 'fail' ? report.below.find((f) => f.ref === s.ref && f.ruleId === s.rule) : undefined
    if (measured) context.set(`${s.engineRule}|${s.ref}`, t(report.locale, 'settledBelow', { rule: s.rule, message: measured.message }))
    else if (s.outcome === 'pass') context.set(`${s.engineRule}|${s.ref}`, t(report.locale, 'settledPassBelow', { rule: s.rule }))
  }
  return { settled, context }
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
