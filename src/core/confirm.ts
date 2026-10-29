import type { ModelProvider } from '../providers/types.ts'
import type { JudgmentCache } from './cache.ts'
import type { ConfirmFraming } from './types.ts'
import { errorMessage, sha256 } from './util.ts'

/**
 * A second pass over a claim that rests on the model's reading: the same element asked again as one-word questions,
 * framed three ways (`Criterion.confirm`), with the probability of the answer where the provider reports it.
 *
 * On the labelled findings of the second and third real-page studies (docs/studies/notes-precision-probe.md, section
 * 4), the first token's probability of "fail" separated true from false 1.1.1 findings with an AUROC of 0.89–0.91 under
 * each framing, and the three framings agreed on 34 of the 40 true positives and 12 of the 61 false positives. The rule
 * below was fixed from those data before any new measurement: a claim is confirmed when every framing answers with a
 * confirming word and, where probabilities exist, the lowest probability of a confirming word is at least
 * CONFIRM_MIN_PROBABILITY (on those data the two conditions chose the same findings). A claim the pass does not
 * confirm, or cannot ask (a provider with no one-word answers, an offline run with no cached answer), is the model's
 * suggestion, in the report's needsReview, never a finding.
 *
 * The threshold was 0.9 until 2026-10-27. The fourth real-page study pre-registered a 0.99 cut as a secondary measure,
 * and the replay of the merged code on the second, third and fourth studies' recordings, with every second-pass
 * probability read back (docs/studies/notes-precision-fixes.md), found under 0.99 five false findings (0.905, 0.959,
 * 0.986, 0.987, 0.987), two uncertain ones and no true one; the lowest true finding confirmed at 0.997. In-sample: those
 * pages were read.
 *
 * Since 2026-10-29, identical claims on one page (the same alternative, the same verdict) are confirmed together: one
 * the pass confirms confirms the others it denied (`confirmTogether`).
 */

export const CONFIRM_MIN_PROBABILITY = 0.99

export interface ConfirmAnswer {
  framing: string
  word: string
  /** The word confirms the claim. */
  fail: boolean
  /** The probability of a confirming word, where the provider reports probabilities. */
  probability?: number | undefined
  cached: boolean
}

export interface Confirmation {
  /**
   * confirmed: every framing confirms, with enough probability. denied: a framing denied it, or the probability was too
   * low. unavailable: the provider cannot answer one-word questions. offline-miss: an offline run with no cached answer.
   * error: a call failed, or the time limit cut it.
   */
  outcome: 'confirmed' | 'denied' | 'unavailable' | 'offline-miss' | 'error'
  answers: ConfirmAnswer[]
  minProbability?: number | undefined
  /**
   * Set when an identical claim on the page confirmed this one (`confirmTogether`): its own answers denied it. How many
   * identical claims the pass was asked about on the page, this one included, and how many it confirmed on their own.
   */
  identical?: { claims: number; confirmed: number } | undefined
  error?: string | undefined
  usage: { calls: number; cachedCalls: number; inputTokens: number; outputTokens: number; latencyMs: number }
}

export interface ConfirmOptions {
  provider: ModelProvider | undefined
  cache: JudgmentCache
  offline: boolean
  signal?: AbortSignal | undefined
  deadline?: number | undefined
}

interface CachedWord {
  word: string
  probabilities?: Record<string, number> | undefined
}

/** The cache key of one framing's answer: the criterion, the pass's version, the model and its settings, the framing and its prompt. */
export function confirmKey(criterion: { id: string; confirmVersion?: string | undefined }, provider: Pick<ModelProvider, 'id' | 'settings'> | undefined, framing: ConfirmFraming): string {
  const imageHashes = (framing.images ?? []).map((image) => sha256(Buffer.from(image.data).toString('base64')))
  const promptHash = sha256([framing.system, framing.user, ...imageHashes].join('\u0000'))
  return sha256(JSON.stringify({ confirm: criterion.id, version: criterion.confirmVersion ?? '1', model: provider?.id ?? 'none', settings: provider?.settings ?? '', framing: framing.id, promptHash }))
}

/** Whether the answers confirm the claim under the fixed rule. */
export function decide(answers: readonly ConfirmAnswer[]): { confirmed: boolean; minProbability: number | undefined } {
  const probabilities = answers.flatMap((answer) => (answer.probability === undefined ? [] : [answer.probability]))
  const minProbability = probabilities.length > 0 ? Math.min(...probabilities) : undefined
  const confirmed = answers.length > 0 && answers.every((answer) => answer.fail) && (minProbability === undefined || minProbability >= CONFIRM_MIN_PROBABILITY)
  return { confirmed, minProbability }
}

export async function confirmClaim(criterion: { id: string; confirmVersion?: string | undefined }, framings: readonly ConfirmFraming[], options: ConfirmOptions): Promise<Confirmation> {
  const usage = { calls: 0, cachedCalls: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0 }
  const answers: ConfirmAnswer[] = []
  for (const framing of framings) {
    const words = [...framing.fail, ...framing.pass]
    const key = confirmKey(criterion, options.provider, framing)
    const cached = await options.cache.get(key)
    let answer: CachedWord | undefined = cached && isCachedWord(cached.output) ? cached.output : undefined
    if (answer) {
      usage.cachedCalls++
      usage.inputTokens += cached?.inputTokens ?? 0
      usage.outputTokens += cached?.outputTokens ?? 0
    } else {
      if (options.offline || !options.provider) return { outcome: 'offline-miss', answers, usage }
      if (!options.provider.word) return { outcome: 'unavailable', answers, usage }
      if (options.signal?.aborted || (options.deadline !== undefined && Date.now() >= options.deadline)) return { outcome: 'error', answers, error: 'time limit reached', usage }
      try {
        const response = await options.provider.word({ system: framing.system, user: framing.user, images: framing.images, words, signal: options.signal })
        answer = { word: response.word, ...(response.probabilities ? { probabilities: response.probabilities } : {}) }
        usage.calls++
        usage.inputTokens += response.inputTokens
        usage.outputTokens += response.outputTokens
        usage.latencyMs += response.latencyMs
        await options.cache.set(key, { output: answer, inputTokens: response.inputTokens, outputTokens: response.outputTokens, latencyMs: response.latencyMs, modelId: response.modelId, createdAt: new Date().toISOString() })
      } catch (error) {
        return { outcome: 'error', answers, error: options.signal?.aborted ? 'time limit reached' : errorMessage(error), usage }
      }
    }
    const fail = framing.fail.includes(answer.word)
    const probability = answer.probabilities ? framing.fail.reduce((sum, word) => sum + (answer?.probabilities?.[word] ?? 0), 0) : undefined
    answers.push({ framing: framing.id, word: answer.word, fail, ...(probability === undefined ? {} : { probability }), cached: Boolean(cached) })
  }
  const { confirmed, minProbability } = decide(answers)
  return { outcome: confirmed ? 'confirmed' : 'denied', answers, ...(minProbability === undefined ? {} : { minProbability }), usage }
}

/**
 * What makes two claims on a page identical: the criterion, the subject the claim is about (for 1.1.1, the alternative
 * text) in lower case, without accents and with its spaces collapsed, and the verdict. Undefined for a claim with no
 * subject, which is grouped with none.
 */
export function identicalClaimKey(criterion: string, subject: string | undefined, verdict: string | undefined): string | undefined {
  const text = (subject ?? '').normalize('NFKD').replace(/\p{M}/gu, '').replace(/\s+/g, ' ').trim().toLowerCase()
  return text === '' ? undefined : JSON.stringify([criterion, text, verdict ?? ''])
}

/**
 * Identical claims on one page are confirmed together. The claims the second pass was asked about on a page that share
 * a key (`identicalClaimKey`) form a group, and when the pass confirmed at least one of them, every one of them it
 * denied is confirmed too, marked as such (`identical`). One alternative on several copies of a picture is one claim:
 * asked of each copy, it is split by the luck of one framing's word on one copy. On hering.com.br in the fifth
 * real-page study, seven payment logos with `alt="payment"` became one finding and six suggestions, all seven true
 * (docs/studies/notes-precision-round5.md, P2, the rule "C-any"; on the 165 labelled reading claims of the second to
 * fifth studies it adds 7 true and 2 false findings and loses none, in-sample). A claim the pass could not finish (no
 * cached answer offline, an error, a provider that cannot answer one word) keeps its outcome, and so does every claim
 * of a group the pass confirmed none of. Returns each claim's outcome, in order.
 */
export function confirmTogether(claims: ReadonlyArray<{ key: string | undefined; confirmation: Confirmation }>): Confirmation[] {
  const groups = new Map<string, Confirmation[]>()
  for (const { key, confirmation } of claims) {
    if (key === undefined) continue
    groups.set(key, [...(groups.get(key) ?? []), confirmation])
  }
  return claims.map(({ key, confirmation }) => {
    const group = key === undefined ? undefined : groups.get(key)
    if (!group || group.length < 2 || confirmation.outcome !== 'denied') return confirmation
    const confirmed = group.filter((member) => member.outcome === 'confirmed').length
    return confirmed > 0 ? { ...confirmation, outcome: 'confirmed', identical: { claims: group.length, confirmed } } : confirmation
  })
}

function isCachedWord(value: unknown): value is CachedWord {
  return typeof value === 'object' && value !== null && typeof (value as { word?: unknown }).word === 'string'
}

/** The answers in one line, for a report: "rules: pass, claim: yes (0.62), reversed: no". */
export function describeAnswers(answers: readonly ConfirmAnswer[]): string {
  return answers.map((answer) => `${answer.framing}: ${answer.word}${answer.probability === undefined ? '' : ` (${answer.probability.toFixed(2)})`}`).join(', ')
}
