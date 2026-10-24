import type { z } from 'zod'

export interface JudgeRequest<T> {
  system: string
  user: string
  images?: Array<{ data: Uint8Array; mediaType: string }> | undefined
  schema: z.ZodType<T>
  schemaName: string
  /** Aborts the call when the time limit runs out (`--time-limit`); a provider that cannot cancel may ignore it. */
  signal?: AbortSignal | undefined
}

export interface JudgeResponse<T> {
  output: T
  inputTokens: number
  outputTokens: number
  latencyMs: number
  /** Model id reported by the provider, when it returns one. */
  modelId: string
}

/** A question the model answers with one word: a second pass over a claim (core/confirm.ts). */
export interface WordRequest {
  system: string
  user: string
  images?: Array<{ data: Uint8Array; mediaType: string }> | undefined
  /** The words an answer may be, in lower case. */
  words: readonly string[]
  signal?: AbortSignal | undefined
}

export interface WordResponse {
  /** The first word the model wrote, in lower case, punctuation aside. */
  word: string
  /**
   * Where the provider reports token probabilities: the probability of each allowed word at the answer's first token,
   * normalized over the allowed words. Absent when the provider reports none.
   */
  probabilities?: Record<string, number> | undefined
  inputTokens: number
  outputTokens: number
  latencyMs: number
  modelId: string
}

/** What the core knows about models: a structured judgment call, and, where the provider can, a one-word answer. */
export interface ModelProvider {
  /** `provider:model`, e.g. `ollama:gemma4:12b`. */
  id: string
  /** Settings that change answers (such as reasoning effort); part of the cache key. */
  settings?: string | undefined
  judge<T>(request: JudgeRequest<T>): Promise<JudgeResponse<T>>
  /**
   * A one-word answer, with the probabilities of the allowed words where the provider gives token probabilities
   * (Ollama's native API does). Absent for a provider that cannot answer so, such as an agent CLI: a claim that needs
   * the second pass is then the model's suggestion (core/confirm.ts).
   */
  word?(request: WordRequest): Promise<WordResponse>
}
