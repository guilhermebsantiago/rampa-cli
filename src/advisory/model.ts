import { type CandidateJudgment, DEFAULT_MAX_CANDIDATES, type Judgment, judgeCandidates } from '../core/judge.ts'
import type { Candidate, JudgmentBase, Usage } from '../core/types.ts'
import type { Locale } from '../i18n.ts'
import type { AdvisoryContext, CheckRun } from './check.ts'
import { am, amPlural } from './messages.ts'
import type { AdvisoryCheckSummary } from './types.ts'

/**
 * What the checks a model decides share (`AdvisoryCheck.review`: literal language, summaries of long text, the wording
 * of error messages). Each asks a model one short question per text, through the judge the WCAG criteria use: the same
 * cache, keyed by the check's version (which holds its prompt's version) and the prompt itself; the same votes over
 * --runs; batches of several texts in one call with --batch or --fast; --concurrency calls at a time; the cap of
 * --max-candidates (10 with --fast); and --time-limit. Every claim quotes the page and goes through the same quote
 * check the criteria use, and a claim whose quote is not on the page is discarded.
 *
 * What is left is a suggestion for a person to review: impact `suggestion`, confidence medium at most (the quote is
 * checked, the reading is the model's), never a WCAG failure, and never a reason for the run to exit with 1 or 2.
 */

/** Suggestions per check and page at most; a note counts the rest. */
export const MAX_SUGGESTIONS = 5

/** Why a check a model decides cannot run here, or undefined when it can: --no-llm, or no model set. */
export function modelGate(context: Pick<AdvisoryContext, 'llm' | 'provider' | 'offline' | 'locale'>): string | undefined {
  if (!context.llm) return am(context.locale, 'modelOff')
  // Offline, a run with no model still reads the cache, as the WCAG criteria do; it finds nothing there.
  if (!context.provider && !context.offline) return am(context.locale, 'modelNone')
  return undefined
}

export interface Asked<Ctx, Out extends JudgmentBase> {
  judgments: CandidateJudgment<Ctx, Out>[]
  /** The candidates left out by --max-candidates. */
  capped: number
  usage: Usage
  errors: string[]
  /** For the check's summary; `kept` is set once the check knows how many suggestions it kept. */
  model: NonNullable<AdvisoryCheckSummary['model']>
  /** What the judging left out, in the report's language: the cap, the cache of an offline run, the time limit, errors. */
  notes: string[]
}

/** Asks the model about the candidates, at most --max-candidates of them, in the order given (the most important first). */
export async function askModel<Ctx, Out extends JudgmentBase>(
  judgment: Judgment<Ctx, Out>,
  context: AdvisoryContext,
  candidates: readonly Candidate<Ctx>[],
): Promise<Asked<Ctx, Out>> {
  const cap = context.maxCandidates ?? DEFAULT_MAX_CANDIDATES
  const asked = cap > 0 ? candidates.slice(0, cap) : [...candidates]
  const signal = context.deadline === undefined ? undefined : AbortSignal.timeout(Math.max(0, context.deadline - Date.now()))
  const judgments = await judgeCandidates(judgment, context.page.snapshot, asked, {
    provider: context.provider,
    runs: context.runs,
    cache: context.cache,
    offline: context.offline,
    concurrency: context.concurrency,
    signal,
    deadline: context.deadline,
    batch: context.batch,
  })
  const usage: Usage = { calls: 0, cachedCalls: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0 }
  const errors: string[] = []
  for (const result of judgments) {
    for (const sample of result.samples) {
      // A batch's call is counted once, on the first candidate it answered; a decided one made no call.
      if (sample.decided || sample.batch?.shared) continue
      if (sample.cached) usage.cachedCalls++
      else if (sample.output) usage.calls++
      usage.inputTokens += sample.inputTokens
      usage.outputTokens += sample.outputTokens
      usage.latencyMs += sample.latencyMs
    }
    if (result.status === 'error') {
      const error = result.samples.find((sample) => sample.error)?.error
      if (error && !errors.includes(error)) errors.push(error)
    }
  }
  const count = (status: CandidateJudgment<Ctx, Out>['status']) => judgments.filter((result) => result.status === status).length
  const answered = judgments.filter((result) => ['passed', 'failed', 'cannot_tell', 'discarded'].includes(result.status)).length
  const capped = candidates.length - asked.length
  const offline = count('offline-miss')
  const timedOut = count('not-judged')
  const failedCalls = count('error')
  const notes: string[] = []
  const check = judgment.id
  if (capped > 0) notes.push(amPlural(context.locale, 'modelCapped', capped, { check, max: cap }))
  if (offline > 0) notes.push(amPlural(context.locale, 'modelOffline', offline, { check }))
  if (timedOut > 0) notes.push(amPlural(context.locale, 'modelTimeUp', timedOut, { check }))
  if (failedCalls > 0) notes.push(amPlural(context.locale, 'modelErrors', failedCalls, { check }))
  return {
    judgments,
    capped,
    usage,
    errors,
    notes,
    model: {
      asked: asked.length,
      answered,
      kept: 0,
      errors: failedCalls,
      discarded: count('discarded'),
      notJudged: capped + offline + timedOut,
    },
  }
}

/** The model's name for a message: the provider's, else the one a cached answer was made with. */
export function modelName<Ctx, Out extends JudgmentBase>(context: Pick<AdvisoryContext, 'provider'>, result: CandidateJudgment<Ctx, Out>): string {
  return context.provider?.id ?? result.samples.find((sample) => sample.modelId)?.modelId ?? 'model'
}

/** The full stop after a quote at the end of a sentence, unless the quote ends with its own: "Vamos nessa?" needs none. */
export function end(quote: string): string {
  return /[.!?…]["'”’»)]*$/u.test(quote.trim()) ? '' : '.'
}

/** What a check that did not run returns: the reason, and nothing else. */
export function notRun(reason: string, candidates = 0): CheckRun {
  return { ran: false, reason, candidates, hits: [] }
}

/** The finished run of a check a model decides: its suggestions, at most MAX_SUGGESTIONS, with notes on the rest. */
export function finished<Ctx, Out extends JudgmentBase>(
  check: string,
  locale: Locale,
  asked: Asked<Ctx, Out>,
  candidates: number,
  hits: CheckRun['hits'],
  notes: readonly string[] = [],
): CheckRun {
  const kept = hits.slice(0, MAX_SUGGESTIONS)
  const more = hits.length - kept.length
  return {
    ran: true,
    candidates,
    hits: kept,
    notes: [...notes, ...asked.notes, ...(more > 0 ? [amPlural(locale, 'modelLeftOut', more, { check, max: MAX_SUGGESTIONS })] : [])],
    model: { ...asked.model, kept: kept.length },
    usage: asked.usage,
    errors: asked.errors,
  }
}
