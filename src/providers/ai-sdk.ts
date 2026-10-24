import { Output, generateText } from 'ai'
import { z } from 'zod'
import { RampaError } from '../core/util.ts'
import { createCliProvider } from './cli/provider.ts'
import { firstWordOf, ollamaWord } from './ollama-word.ts'
import { PROVIDERS, type ProviderDef, type ProviderModel, findProvider } from './registry.ts'
import type { ModelProvider, WordRequest, WordResponse } from './types.ts'

export const REASONING_LEVELS = ['provider-default', 'none', 'minimal', 'low', 'medium', 'high'] as const
export type Reasoning = (typeof REASONING_LEVELS)[number]

// The AI SDK prints provider warnings (an unsupported setting, a fallback) to the console, in the middle of the report.
// RAMPA_DEBUG=1 brings them back.
const sdkGlobals = globalThis as { AI_SDK_LOG_WARNINGS?: unknown }
if (!process.env.RAMPA_DEBUG && sdkGlobals.AI_SDK_LOG_WARNINGS === undefined) sdkGlobals.AI_SDK_LOG_WARNINGS = false

/** `provider:model`, e.g. `ollama:gemma4:12b` or `anthropic:claude-haiku-5-5`. Aliases resolve to the provider's id. */
export function parseModelSpec(spec: string): { provider: string; modelId: string } {
  const index = spec.indexOf(':')
  if (index <= 0 || index === spec.length - 1) {
    throw new RampaError('invalid-model', `Model must be provider:model, for example ollama:gemma4:12b. Got "${spec}".`)
  }
  const prefix = spec.slice(0, index).toLowerCase()
  return { provider: findProvider(prefix)?.id ?? prefix, modelId: spec.slice(index + 1) }
}

function providerFor(provider: string): ProviderDef {
  const found = findProvider(provider)
  if (!found) {
    throw new RampaError('unknown-provider', `Unknown provider "${provider}". Use one of: ${PROVIDERS.map((p) => p.id).join(', ')}, as provider:model.`)
  }
  return found
}

export interface ProviderOptions {
  reasoning?: Reasoning | undefined
  /** Replaces the network; for tests. */
  fetch?: typeof globalThis.fetch | undefined
}

/** Ollama defaults to no reasoning; hosted models keep the provider's default. */
export function defaultReasoning(provider: string): Reasoning {
  return findProvider(provider)?.reasoning ?? 'provider-default'
}

/**
 * Identity of a provider as the cache sees it, shared by live and offline runs: the model's name, the reasoning level,
 * and any sampling setting that is not one the registry ships (samplingKey).
 *
 * Known gap: the model's weights are not in it. A local model is named by its tag (`ollama:gemma4:12b`), and `ollama
 * pull` can put other weights behind the same tag (a new digest) without changing the name; judgments cached with the
 * old weights are still read. Clear the cache, or give the run another --cache-dir, after pulling a model again.
 */
export function providerIdentity(spec: string, reasoning?: Reasoning, sampling?: Pick<ProviderModel, 'temperature' | 'providerOptions'>): { id: string; settings: string } {
  const { provider, modelId } = parseModelSpec(spec)
  return { id: `${provider}:${modelId}`, settings: `reasoning=${reasoning ?? defaultReasoning(provider)}${sampling ? samplingKey(sampling) : ''}` }
}

/** Provider options the registry ships, as JSON: Bedrock's JSON tool mode. */
const SHIPPED_PROVIDER_OPTIONS = new Set([JSON.stringify({ bedrock: { structuredOutputMode: 'jsonTool' } })])

/**
 * The part of the cache key that sampling settings add: nothing for what the registry ships (temperature 0, or the
 * provider's own default where its models reject one; no provider options, or Bedrock's JSON tool mode), so every
 * judgment cached before these were keyed keeps its key; `;temperature=…` and `;providerOptions=…` for anything else,
 * so a judgment made at another temperature or with other options is never read for these. An offline run, which
 * never creates the model, keys with the shipped settings: it misses such judgments rather than read the wrong ones.
 */
export function samplingKey(sampling: Pick<ProviderModel, 'temperature' | 'providerOptions'>): string {
  const parts: string[] = []
  if (sampling.temperature !== undefined && sampling.temperature !== 0) parts.push(`temperature=${sampling.temperature}`)
  const options = sampling.providerOptions === undefined ? undefined : JSON.stringify(sampling.providerOptions)
  if (options !== undefined && !SHIPPED_PROVIDER_OPTIONS.has(options)) parts.push(`providerOptions=${options}`)
  return parts.map((part) => `;${part}`).join('')
}

export async function createModelProvider(spec: string, options: ProviderOptions = {}): Promise<ModelProvider> {
  const { provider, modelId } = parseModelSpec(spec)
  const definition = providerFor(provider)
  if (definition.cli) {
    const reasoning = options.reasoning ?? definition.reasoning
    return createCliProvider(definition.cli, modelId, providerIdentity(spec, reasoning), reasoning)
  }
  const missing = definition.missing()
  if (missing.length > 0) {
    throw new RampaError('missing-api-key', `${definition.name} needs ${missing.join(' and ')} to use ${definition.id}:${modelId}. See rampa doctor.`)
  }
  if (!definition.create) throw new RampaError('unknown-provider', `${definition.name} has no model to create.`)
  const resolved = await definition.create(modelId, options.fetch)
  const reasoning = options.reasoning ?? definition.reasoning
  return {
    ...providerIdentity(spec, reasoning, resolved),
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
      const instructions = definition.schemaInPrompt
        ? `${request.system}

Answer with only a JSON object that follows this JSON schema:
${JSON.stringify(z.toJSONSchema(request.schema))}`
        : request.system
      const result = await generateText({
        model: resolved.model,
        instructions,
        ...input,
        output: Output.object({ schema: request.schema, name: request.schemaName }),
        maxRetries: 2,
        ...(request.signal ? { abortSignal: request.signal } : {}),
        ...(reasoning === 'provider-default' ? {} : { reasoning }),
        ...(resolved.temperature === undefined ? {} : { temperature: resolved.temperature }),
        ...(resolved.providerOptions === undefined ? {} : { providerOptions: resolved.providerOptions }),
      })
      return {
        output: result.output,
        inputTokens: result.usage.inputTokens ?? 0,
        outputTokens: result.usage.outputTokens ?? 0,
        latencyMs: Math.round(performance.now() - started),
        modelId: result.response.modelId ?? modelId,
      }
    },
    // Ollama answers through its native API, which gives the first token's probabilities; every other provider
    // answers in text, and the word alone counts (core/confirm.ts says what that means for the decision).
    async word(request: WordRequest): Promise<WordResponse> {
      if (definition.id === 'ollama') return ollamaWord(modelId, request, options.fetch)
      const started = performance.now()
      const images = request.images ?? []
      const result = await generateText({
        model: resolved.model,
        instructions: request.system,
        messages: [{ role: 'user', content: [{ type: 'text', text: request.user }, ...images.map((image) => ({ type: 'file' as const, data: image.data, mediaType: image.mediaType }))] }],
        maxOutputTokens: 8,
        maxRetries: 2,
        ...(request.signal ? { abortSignal: request.signal } : {}),
        ...(reasoning === 'provider-default' ? {} : { reasoning }),
        ...(resolved.temperature === undefined ? {} : { temperature: resolved.temperature }),
        ...(resolved.providerOptions === undefined ? {} : { providerOptions: resolved.providerOptions }),
      })
      return {
        word: firstWordOf(result.text),
        inputTokens: result.usage.inputTokens ?? 0,
        outputTokens: result.usage.outputTokens ?? 0,
        latencyMs: Math.round(performance.now() - started),
        modelId: result.response.modelId ?? modelId,
      }
    },
  }
}
