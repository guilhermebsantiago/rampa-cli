import { type LanguageModel, Output, generateText } from 'ai'
import { RampaError } from '../core/util.ts'
import type { ModelProvider } from './types.ts'

const OLLAMA_URL = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434'

export const REASONING_LEVELS = ['provider-default', 'none', 'minimal', 'low', 'medium', 'high'] as const
export type Reasoning = (typeof REASONING_LEVELS)[number]

interface Resolved {
  model: LanguageModel
  /** Claude 4.7+ and some OpenAI models reject non-default sampling parameters, so it is only set where accepted. */
  temperature?: number | undefined
  /** Reasoning level used when the user does not choose one. */
  defaultReasoning: Reasoning
}

async function resolveModel(provider: string, modelId: string): Promise<Resolved> {
  switch (provider) {
    case 'anthropic': {
      const { createAnthropic } = await import('@ai-sdk/anthropic')
      return { model: createAnthropic()(modelId), defaultReasoning: 'provider-default' }
    }
    case 'openai': {
      const { createOpenAI } = await import('@ai-sdk/openai')
      return { model: createOpenAI()(modelId), defaultReasoning: 'provider-default' }
    }
    case 'google': {
      const { createGoogleGenerativeAI } = await import('@ai-sdk/google')
      const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? process.env.GEMINI_API_KEY
      return { model: createGoogleGenerativeAI(apiKey ? { apiKey } : {})(modelId), temperature: 0, defaultReasoning: 'provider-default' }
    }
    case 'ollama': {
      const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible')
      const ollama = createOpenAICompatible({
        name: 'ollama',
        baseURL: `${OLLAMA_URL.replace(/\/$/, '')}/v1`,
        apiKey: 'ollama',
        supportsStructuredOutputs: true,
      })
      // Local thinking models spend most of their time reasoning; these judgments are short.
      return { model: ollama(modelId), temperature: 0, defaultReasoning: 'none' }
    }
    case 'openrouter': {
      const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible')
      const apiKey = process.env.OPENROUTER_API_KEY
      if (!apiKey) throw new RampaError('missing-api-key', 'Set OPENROUTER_API_KEY to use openrouter:<model>.')
      const openrouter = createOpenAICompatible({
        name: 'openrouter',
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey,
        supportsStructuredOutputs: true,
      })
      return { model: openrouter(modelId), temperature: 0, defaultReasoning: 'provider-default' }
    }
    case 'openai-compatible': {
      const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible')
      const baseURL = process.env.RAMPA_OPENAI_COMPATIBLE_URL
      if (!baseURL) {
        throw new RampaError('missing-base-url', 'Set RAMPA_OPENAI_COMPATIBLE_URL (for example http://localhost:1234/v1 for LM Studio).')
      }
      const compatible = createOpenAICompatible({
        name: 'openai-compatible',
        baseURL,
        apiKey: process.env.RAMPA_OPENAI_COMPATIBLE_KEY ?? 'none',
        supportsStructuredOutputs: true,
      })
      return { model: compatible(modelId), temperature: 0, defaultReasoning: 'provider-default' }
    }
    default:
      throw new RampaError(
        'unknown-provider',
        `Unknown provider "${provider}". Use anthropic, openai, google, ollama, openrouter or openai-compatible, as provider:model.`,
      )
  }
}

/** `provider:model`, e.g. `ollama:gemma4:12b` or `anthropic:claude-haiku-5-5`. */
export function parseModelSpec(spec: string): { provider: string; modelId: string } {
  const index = spec.indexOf(':')
  if (index <= 0 || index === spec.length - 1) {
    throw new RampaError('invalid-model', `Model must be provider:model, for example ollama:gemma4:12b. Got "${spec}".`)
  }
  return { provider: spec.slice(0, index).toLowerCase(), modelId: spec.slice(index + 1) }
}

export interface ProviderOptions {
  reasoning?: Reasoning | undefined
}

/** Local models default to no reasoning; hosted ones keep the provider's default. */
export function defaultReasoning(provider: string): Reasoning {
  return provider === 'ollama' ? 'none' : 'provider-default'
}

/** Identity of a provider as the cache sees it, shared by live and offline runs. */
export function providerIdentity(spec: string, reasoning?: Reasoning): { id: string; settings: string } {
  const { provider, modelId } = parseModelSpec(spec)
  return { id: `${provider}:${modelId}`, settings: `reasoning=${reasoning ?? defaultReasoning(provider)}` }
}

export async function createModelProvider(spec: string, options: ProviderOptions = {}): Promise<ModelProvider> {
  const { provider, modelId } = parseModelSpec(spec)
  const resolved = await resolveModel(provider, modelId)
  const reasoning = options.reasoning ?? resolved.defaultReasoning
  return {
    ...providerIdentity(spec, reasoning),
    async judge(request) {
      const started = performance.now()
      const images = request.images ?? []
      const input =
        images.length === 0
          ? { prompt: request.user }
          : {
              messages: [
                {
                  role: 'user' as const,
                  content: [
                    { type: 'text' as const, text: request.user },
                    ...images.map((image) => ({ type: 'file' as const, data: image.data, mediaType: image.mediaType })),
                  ],
                },
              ],
            }
      const result = await generateText({
        model: resolved.model,
        instructions: request.system,
        ...input,
        output: Output.object({ schema: request.schema, name: request.schemaName }),
        maxRetries: 2,
        ...(reasoning === 'provider-default' ? {} : { reasoning }),
        ...(resolved.temperature === undefined ? {} : { temperature: resolved.temperature }),
      })
      return {
        output: result.output,
        inputTokens: result.usage.inputTokens ?? 0,
        outputTokens: result.usage.outputTokens ?? 0,
        latencyMs: Math.round(performance.now() - started),
        modelId: result.response.modelId ?? modelId,
      }
    },
  }
}
