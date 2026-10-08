/**
 * Starting-point recommendations, as of 2026-10-07. The final recommendation
 * comes from `rampa eval`, not from generic benchmarks.
 * Prices: USD per 1M tokens, standard tier, short prompts.
 */
export interface ModelInfo {
  spec: string
  where: 'local' | 'api'
  /** Image input; undefined when not verified yet. */
  vision?: boolean | undefined
  input: number
  output: number
  role: string
}

export const RECOMMENDED: readonly ModelInfo[] = [
  { spec: 'ollama:gemma4:12b', where: 'local', vision: true, input: 0, output: 0, role: 'default local model for 3.1.2; has vision for 1.1.1' },
  { spec: 'ollama:qwen3.5:9b', where: 'local', vision: false, input: 0, output: 0, role: 'text-only local alternative' },
  { spec: 'anthropic:claude-haiku-5-5', where: 'api', vision: true, input: 0.1, output: 0.5, role: 'cheap API default, native structured output' },
  { spec: 'openai:gpt-6-luna', where: 'api', input: 0.1, output: 0.5, role: 'cheap OpenAI equivalent' },
  { spec: 'google:gemini-3.5-flash-lite', where: 'api', vision: true, input: 0.3, output: 2.5, role: 'has a free tier' },
  { spec: 'anthropic:claude-sonnet-5-5', where: 'api', vision: true, input: 2, output: 10, role: 'quality ceiling for comparisons' },
]

export const PRICES_AS_OF = '2026-10-07'

export function estimateCostUsd(spec: string | undefined, inputTokens: number, outputTokens: number): number | undefined {
  if (!spec) return undefined
  if (spec.startsWith('ollama:')) return 0
  const info = RECOMMENDED.find((m) => m.spec === spec)
  if (!info) return undefined
  return (inputTokens * info.input + outputTokens * info.output) / 1_000_000
}
