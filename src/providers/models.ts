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
  /** The model picked for this provider when none is configured. */
  default?: boolean | undefined
}

/**
 * Each provider's cheap default comes first, in the order Rampa picks one when several have credentials.
 * Every id, price and image flag was checked on the provider's own documentation on 2026-10-07.
 */
export const RECOMMENDED: readonly ModelInfo[] = [
  { spec: 'ollama:gemma4:12b', where: 'local', vision: true, input: 0, output: 0, role: 'default local model; vision for 1.1.1' },
  { spec: 'ollama:qwen3.5:9b', where: 'local', vision: false, input: 0, output: 0, role: 'text-only local alternative' },
  { spec: 'anthropic:claude-haiku-5-5', where: 'api', vision: true, input: 0.1, output: 0.5, role: 'cheap API default, native structured output', default: true },
  { spec: 'openai:gpt-6-luna', where: 'api', vision: true, input: 0.1, output: 0.5, role: 'cheap OpenAI default; reasoning medium unless --reasoning', default: true },
  { spec: 'google:gemini-3.5-flash-lite', where: 'api', vision: true, input: 0.3, output: 2.5, role: 'has a free tier', default: true },
  { spec: 'gateway:openai/gpt-6-luna', where: 'api', vision: true, input: 0.1, output: 0.5, role: 'one key for many providers, no markup', default: true },
  { spec: 'openrouter:openai/gpt-6-luna', where: 'api', vision: true, input: 0.1, output: 0.5, role: 'one key for many providers', default: true },
  { spec: 'bedrock:global.anthropic.claude-haiku-5-5', where: 'api', vision: true, input: 0.1, output: 0.5, role: 'Claude on AWS; regional profiles cost 10% more', default: true },
  { spec: 'vertex:gemini-3.5-flash-lite', where: 'api', vision: true, input: 0.3, output: 2.5, role: 'Gemini on Google Cloud: global, us or eu', default: true },
  { spec: 'mistral:mistral-small-latest', where: 'api', vision: true, input: 0.15, output: 0.6, role: 'European provider, strict JSON schema', default: true },
  { spec: 'togetherai:Qwen/Qwen3.5-9B', where: 'api', vision: true, input: 0.17, output: 0.25, role: 'open-weight, serverless', default: true },
  { spec: 'fireworks:accounts/fireworks/models/glm-5p3-flash', where: 'api', vision: true, input: 0.15, output: 0.5, role: 'open-weight, serverless', default: true },
  { spec: 'deepseek:deepseek-flash', where: 'api', vision: true, input: 0.3, output: 1.2, role: 'JSON mode; half price off-peak', default: true },
  { spec: 'xai:grok-4.20-0309-non-reasoning', where: 'api', vision: true, input: 1.25, output: 2.5, role: 'general-purpose Grok', default: true },
  { spec: 'cerebras:qwen-3.8-27b', where: 'api', vision: true, input: 0.99, output: 1.49, role: 'fast inference', default: true },
  { spec: 'groq:qwen/qwen3.8-27b', where: 'api', vision: true, input: 0.8, output: 4, role: 'vision is in preview on Groq', default: true },
  { spec: 'groq:openai/gpt-oss-20b', where: 'api', vision: false, input: 0.075, output: 0.3, role: 'production, text only: 3.1.2' },
  { spec: 'openai:gpt-6.1-sol', where: 'api', vision: true, input: 2, output: 10, role: 'mid-tier, for comparisons' },
  { spec: 'anthropic:claude-sonnet-5-5', where: 'api', vision: true, input: 2, output: 10, role: 'quality ceiling for comparisons' },
  { spec: 'google:gemini-3.8-flash', where: 'api', vision: true, input: 0.75, output: 3.75, role: '1.50 / 7.50 from 2027' },
]

export const PRICES_AS_OF = '2026-10-07'

export function estimateCostUsd(spec: string | undefined, inputTokens: number, outputTokens: number): number | undefined {
  if (!spec) return undefined
  if (spec.startsWith('ollama:') || spec.startsWith('lmstudio:')) return 0
  const info = RECOMMENDED.find((m) => m.spec === spec)
  if (!info) return undefined
  return (inputTokens * info.input + outputTokens * info.output) / 1_000_000
}
