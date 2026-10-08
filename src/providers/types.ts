import type { z } from 'zod'

export interface JudgeRequest<T> {
  system: string
  user: string
  images?: Array<{ data: Uint8Array; mediaType: string }> | undefined
  schema: z.ZodType<T>
  schemaName: string
}

export interface JudgeResponse<T> {
  output: T
  inputTokens: number
  outputTokens: number
  latencyMs: number
  /** Model id reported by the provider, when it returns one. */
  modelId: string
}

/** The only thing the core knows about models: a structured judgment call. */
export interface ModelProvider {
  /** `provider:model`, e.g. `ollama:gemma4:12b`. */
  id: string
  /** Settings that change answers (such as reasoning effort); part of the cache key. */
  settings?: string | undefined
  judge<T>(request: JudgeRequest<T>): Promise<JudgeResponse<T>>
}
