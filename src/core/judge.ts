import { z } from 'zod'
import type { ModelProvider } from '../providers/types.ts'
import type { A11ySnapshot } from '../snapshot/schema.ts'
import type { JudgmentCache } from './cache.ts'
import type { Candidate, Criterion, JudgmentBase, Verdict, Verification } from './types.ts'
import { errorMessage, mapLimit, sha256 } from './util.ts'

export interface JudgeOptions {
  provider: ModelProvider | undefined
  /** Judgments per candidate; the verdict is the majority. */
  runs: number
  cache: JudgmentCache
  /** Read the cache only, never call the model. */
  offline: boolean
  concurrency: number
}

export interface Sample<Out> {
  output?: Out | undefined
  error?: string | undefined
  cached: boolean
  /** Decided by the criterion without a model (`Criterion.decide`): no call, no tokens. */
  decided?: boolean | undefined
  inputTokens: number
  outputTokens: number
  latencyMs: number
  modelId?: string | undefined
}

export type JudgmentStatus = 'failed' | 'passed' | 'cannot_tell' | 'discarded' | 'error' | 'offline-miss'

export interface CandidateJudgment<Ctx, Out extends JudgmentBase> {
  candidate: Candidate<Ctx>
  samples: Sample<Out>[]
  status: JudgmentStatus
  verdict?: Verdict | undefined
  votes: number
  total: number
  representative?: Out | undefined
  verification?: Verification | undefined
}

const OFFLINE_MISS = 'offline-miss'

export async function judgeCandidates<Ctx, Out extends JudgmentBase>(
  criterion: Criterion<Ctx, Out>,
  snapshot: A11ySnapshot,
  candidates: Candidate<Ctx>[],
  options: JudgeOptions,
): Promise<CandidateJudgment<Ctx, Out>[]> {
  const schemaJson = JSON.stringify(z.toJSONSchema(criterion.schema))
  const schemaName = `wcag_${criterion.id.replaceAll('.', '_')}_judgment`

  return mapLimit(candidates, options.concurrency, async (candidate) => {
    const samples: Sample<Out>[] = []
    // A candidate the criterion settles by itself is never sent to the model.
    const decided = criterion.decide?.(candidate, snapshot)
    if (decided) samples.push({ output: decided, cached: false, decided: true, inputTokens: 0, outputTokens: 0, latencyMs: 0 })
    const prompt = decided ? undefined : criterion.prompt(candidate, snapshot)
    const imageHashes = (prompt?.images ?? []).map((image) => sha256(Buffer.from(image.data).toString('base64')))
    const promptHash = prompt ? sha256([prompt.system, prompt.user, schemaJson, ...imageHashes].join('\u0000')) : ''

    for (let sample = 0; prompt && sample < options.runs; sample++) {
      const key = sha256(
        JSON.stringify({
          criterion: criterion.id,
          version: criterion.version,
          model: options.provider?.id ?? 'none',
          settings: options.provider?.settings ?? '',
          sample,
          promptHash,
        }),
      )
      const cached = await options.cache.get(key)
      if (cached) {
        const parsed = criterion.schema.safeParse(cached.output)
        if (parsed.success) {
          // Cached samples keep the tokens they cost, so totals show what the results took to produce.
          samples.push({
            output: parsed.data,
            cached: true,
            inputTokens: cached.inputTokens,
            outputTokens: cached.outputTokens,
            latencyMs: 0,
            modelId: cached.modelId,
          })
          continue
        }
      }
      if (options.offline || !options.provider) {
        samples.push({ error: OFFLINE_MISS, cached: false, inputTokens: 0, outputTokens: 0, latencyMs: 0 })
        continue
      }
      try {
        const response = await options.provider.judge({
          system: prompt.system,
          user: prompt.user,
          images: prompt.images,
          schema: criterion.schema,
          schemaName,
        })
        await options.cache.set(key, {
          output: response.output,
          inputTokens: response.inputTokens,
          outputTokens: response.outputTokens,
          latencyMs: response.latencyMs,
          modelId: response.modelId,
          createdAt: new Date().toISOString(),
        })
        samples.push({
          output: response.output,
          cached: false,
          inputTokens: response.inputTokens,
          outputTokens: response.outputTokens,
          latencyMs: response.latencyMs,
          modelId: response.modelId,
        })
      } catch (error) {
        samples.push({ error: errorMessage(error), cached: false, inputTokens: 0, outputTokens: 0, latencyMs: 0 })
      }
    }

    const outputs = samples.flatMap((s) => (s.output ? [criterion.settle?.(s.output, candidate) ?? s.output] : []))
    if (outputs.length === 0) {
      const status: JudgmentStatus = samples.every((s) => s.error === OFFLINE_MISS) ? 'offline-miss' : 'error'
      return { candidate, samples, status, votes: 0, total: 0 }
    }

    const { verdict, votes } = majority(outputs.map((o) => o.verdict))
    const representative = outputs.find((o) => o.verdict === verdict)
    if (verdict === 'cannot_tell' || !representative) {
      return { candidate, samples, status: 'cannot_tell', verdict: 'cannot_tell', votes, total: outputs.length, representative }
    }

    let claim = representative
    let verification = criterion.verify(claim, candidate, snapshot)
    // Some models copy a quote together with what the prompt shows it in: quotation marks, or a tag such as
    // <title>. Only a claim that failed as written is tried once without them, and the quote must still match.
    const unwrapped = verification.ok ? undefined : withoutDelimiters(claim)
    if (unwrapped) {
      const retried = criterion.verify(unwrapped, candidate, snapshot)
      if (retried.ok) {
        claim = unwrapped
        verification = retried
      }
    }
    const status: JudgmentStatus = !verification.ok ? 'discarded' : verdict === 'fail' ? 'failed' : 'passed'
    return { candidate, samples, status, verdict, votes, total: outputs.length, representative: claim, verification }
  })
}

const QUOTED = /^\s*["'“”‘’«»„]([\s\S]*?)["'“”‘’«»]\s*$/
const TAGGED = /^\s*<([a-z][\w-]*)(?:\s[^>]*)?>([\s\S]*?)<\/\1>\s*$/i

/**
 * The claim with the delimiters around its evidence removed: up to two layers, each a pair of quotation
 * marks or a matching tag, as in `"<title>Shop</title>"`. Undefined when the evidence has none.
 */
export function withoutDelimiters<Out extends JudgmentBase>(output: Out): Out | undefined {
  let evidence = output.evidence
  for (let layer = 0; layer < 2; layer++) {
    const inner = QUOTED.exec(evidence)?.[1] ?? TAGGED.exec(evidence)?.[2]
    if (inner === undefined || inner.trim() === '') break
    evidence = inner
  }
  return evidence === output.evidence ? undefined : { ...output, evidence }
}

/** Strict majority; a tie means the model did not decide, so it abstains. */
export function majority(verdicts: Verdict[]): { verdict: Verdict; votes: number } {
  const counts = new Map<Verdict, number>()
  for (const v of verdicts) counts.set(v, (counts.get(v) ?? 0) + 1)
  let best: Verdict = 'cannot_tell'
  let bestCount = 0
  let tie = false
  for (const [verdict, count] of counts) {
    if (count > bestCount) {
      best = verdict
      bestCount = count
      tie = false
    } else if (count === bestCount) {
      tie = true
    }
  }
  return tie ? { verdict: 'cannot_tell', votes: bestCount } : { verdict: best, votes: bestCount }
}
