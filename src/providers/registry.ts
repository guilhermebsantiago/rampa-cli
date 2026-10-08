import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { LanguageModel } from 'ai'

type Fetch = typeof globalThis.fetch

export interface ProviderModel {
  model: LanguageModel
  /** Set only where every model of the provider accepts it: Claude 4.7+ and OpenAI's reasoning models reject sampling parameters. */
  temperature?: number | undefined
  providerOptions?: Record<string, Record<string, string | number | boolean>> | undefined
}

export interface ProviderDef {
  /** The prefix in `provider:model`. */
  id: string
  aliases?: readonly string[] | undefined
  name: string
  where: 'local' | 'api'
  /** Environment variables the provider reads; doctor shows the ones that are set. */
  env: readonly string[]
  /** Credentials still missing, in words; empty when the provider can be called. */
  missing(): string[]
  /** What goes after the colon. */
  example: string
  /** Local thinking models spend most of their time reasoning; these judgments are short. */
  reasoning: 'none' | 'provider-default'
  /** The provider falls back to plain JSON mode without passing the schema on, so the instructions carry it. */
  schemaInPrompt?: boolean | undefined
  /** `fetch` replaces the network in tests. */
  create(modelId: string, fetch?: Fetch): Promise<ProviderModel>
}

const value = (name: string): string | undefined => process.env[name] || undefined

/** Each requirement lists alternatives, and `A+B` needs both. Returns the requirements no alternative meets, as "A (or B)". */
function requires(...requirements: string[][]): () => string[] {
  return () =>
    requirements
      .filter((alternatives) => !alternatives.some((alternative) => alternative.split('+').every((name) => value(name))))
      .map((alternatives) => {
        const [first = '', ...others] = alternatives.map((alternative) => alternative.replaceAll('+', ' + '))
        return others.length > 0 ? `${first} (or ${others.join(' or ')})` : first
      })
}

export const ollamaUrl = (): string => (value('OLLAMA_BASE_URL') ?? 'http://localhost:11434').replace(/\/$/, '')
export const lmStudioUrl = (): string => (value('LMSTUDIO_BASE_URL') ?? 'http://localhost:1234/v1').replace(/\/$/, '')

const googleCloudProject = (): string | undefined => value('GOOGLE_VERTEX_PROJECT') ?? value('GOOGLE_CLOUD_PROJECT')
const googleCloudLocation = (): string => value('GOOGLE_VERTEX_LOCATION') ?? value('GOOGLE_CLOUD_LOCATION') ?? 'global'

/** Application Default Credentials, as `gcloud auth application-default login` leaves them. On Google Cloud itself, the metadata server provides them instead. */
export function hasGoogleAdc(): boolean {
  if (value('GOOGLE_APPLICATION_CREDENTIALS')) return true
  const base = process.platform === 'win32' ? (value('APPDATA') ?? join(homedir(), 'AppData', 'Roaming')) : join(homedir(), '.config')
  return existsSync(join(base, 'gcloud', 'application_default_credentials.json'))
}

async function openAICompatible(name: string, baseURL: string, apiKey: string, fetch?: Fetch) {
  const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible')
  return createOpenAICompatible({ name, baseURL, apiKey, supportsStructuredOutputs: true, fetch })
}

export const PROVIDERS: readonly ProviderDef[] = [
  {
    id: 'ollama',
    name: 'Ollama',
    where: 'local',
    env: ['OLLAMA_BASE_URL'],
    missing: () => [],
    example: 'gemma4:12b',
    reasoning: 'none',
    async create(modelId, fetch) {
      return { model: (await openAICompatible('ollama', `${ollamaUrl()}/v1`, 'ollama', fetch))(modelId), temperature: 0 }
    },
  },
  {
    id: 'lmstudio',
    aliases: ['lm-studio'],
    name: 'LM Studio',
    where: 'local',
    env: ['LMSTUDIO_BASE_URL'],
    missing: () => [],
    example: '<loaded model>',
    reasoning: 'provider-default',
    async create(modelId, fetch) {
      return { model: (await openAICompatible('lmstudio', lmStudioUrl(), 'lm-studio', fetch))(modelId), temperature: 0 }
    },
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    where: 'api',
    env: ['ANTHROPIC_API_KEY'],
    missing: requires(['ANTHROPIC_API_KEY']),
    example: 'claude-haiku-5-5',
    reasoning: 'provider-default',
    async create(modelId, fetch) {
      const { createAnthropic } = await import('@ai-sdk/anthropic')
      return { model: createAnthropic({ fetch })(modelId) }
    },
  },
  {
    id: 'openai',
    name: 'OpenAI',
    where: 'api',
    env: ['OPENAI_API_KEY'],
    missing: requires(['OPENAI_API_KEY']),
    example: 'gpt-6-luna',
    reasoning: 'provider-default',
    async create(modelId, fetch) {
      const { createOpenAI } = await import('@ai-sdk/openai')
      return { model: createOpenAI({ fetch })(modelId) }
    },
  },
  {
    id: 'google',
    aliases: ['gemini'],
    name: 'Google Gemini API',
    where: 'api',
    env: ['GEMINI_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY'],
    missing: requires(['GEMINI_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY']),
    example: 'gemini-3.5-flash-lite',
    reasoning: 'provider-default',
    async create(modelId, fetch) {
      const { createGoogleGenerativeAI } = await import('@ai-sdk/google')
      const apiKey = value('GOOGLE_GENERATIVE_AI_API_KEY') ?? value('GEMINI_API_KEY')
      return { model: createGoogleGenerativeAI({ apiKey, fetch })(modelId), temperature: 0 }
    },
  },
  {
    id: 'azure',
    aliases: ['azure-openai'],
    name: 'Azure OpenAI',
    where: 'api',
    env: ['AZURE_API_KEY', 'AZURE_RESOURCE_NAME', 'AZURE_BASE_URL'],
    missing: requires(['AZURE_API_KEY'], ['AZURE_RESOURCE_NAME', 'AZURE_BASE_URL']),
    example: '<deployment>',
    reasoning: 'provider-default',
    async create(modelId, fetch) {
      const { createAzure } = await import('@ai-sdk/azure')
      return { model: createAzure({ baseURL: value('AZURE_BASE_URL'), fetch })(modelId) }
    },
  },
  {
    id: 'bedrock',
    aliases: ['amazon-bedrock', 'aws'],
    name: 'Amazon Bedrock',
    where: 'api',
    env: ['AWS_REGION', 'AWS_DEFAULT_REGION', 'AWS_BEARER_TOKEN_BEDROCK', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN'],
    missing: requires(['AWS_REGION', 'AWS_DEFAULT_REGION'], ['AWS_BEARER_TOKEN_BEDROCK', 'AWS_ACCESS_KEY_ID+AWS_SECRET_ACCESS_KEY']),
    example: 'global.anthropic.claude-haiku-5-5',
    reasoning: 'provider-default',
    async create(modelId, fetch) {
      const { createAmazonBedrock } = await import('@ai-sdk/amazon-bedrock')
      const bedrock = createAmazonBedrock({ region: value('AWS_REGION') ?? value('AWS_DEFAULT_REGION'), fetch })
      // Bedrock does not offer Claude's native structured output for every model, so the JSON comes through a forced tool.
      return { model: bedrock(modelId), providerOptions: { bedrock: { structuredOutputMode: 'jsonTool' } } }
    },
  },
  {
    id: 'vertex',
    aliases: ['google-vertex'],
    name: 'Google Vertex AI',
    where: 'api',
    env: ['GOOGLE_VERTEX_API_KEY', 'GOOGLE_VERTEX_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'GOOGLE_VERTEX_LOCATION', 'GOOGLE_APPLICATION_CREDENTIALS'],
    missing: requires(['GOOGLE_VERTEX_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'GOOGLE_VERTEX_API_KEY']),
    example: 'gemini-3.5-flash-lite',
    reasoning: 'provider-default',
    async create(modelId, fetch) {
      const { createVertex } = await import('@ai-sdk/google-vertex')
      return { model: createVertex({ project: googleCloudProject(), location: googleCloudLocation(), fetch })(modelId), temperature: 0 }
    },
  },
  {
    id: 'vertex-anthropic',
    name: 'Claude on Vertex AI',
    where: 'api',
    env: ['GOOGLE_VERTEX_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'GOOGLE_VERTEX_LOCATION', 'GOOGLE_APPLICATION_CREDENTIALS'],
    missing: requires(['GOOGLE_VERTEX_PROJECT', 'GOOGLE_CLOUD_PROJECT']),
    example: '<model id as Vertex lists it>',
    reasoning: 'provider-default',
    async create(modelId, fetch) {
      const { createVertexAnthropic } = await import('@ai-sdk/google-vertex/anthropic')
      return { model: createVertexAnthropic({ project: googleCloudProject(), location: googleCloudLocation(), fetch })(modelId) }
    },
  },
  {
    id: 'mistral',
    name: 'Mistral AI',
    where: 'api',
    env: ['MISTRAL_API_KEY'],
    missing: requires(['MISTRAL_API_KEY']),
    example: 'mistral-small-latest',
    reasoning: 'provider-default',
    async create(modelId, fetch) {
      const { createMistral } = await import('@ai-sdk/mistral')
      return { model: createMistral({ fetch })(modelId), temperature: 0 }
    },
  },
  {
    id: 'xai',
    name: 'xAI',
    where: 'api',
    env: ['XAI_API_KEY'],
    missing: requires(['XAI_API_KEY']),
    example: 'grok-4.20-0309-non-reasoning',
    reasoning: 'provider-default',
    async create(modelId, fetch) {
      const { createXai } = await import('@ai-sdk/xai')
      return { model: createXai({ fetch })(modelId) }
    },
  },
  {
    id: 'groq',
    name: 'Groq',
    where: 'api',
    env: ['GROQ_API_KEY'],
    missing: requires(['GROQ_API_KEY']),
    example: 'qwen/qwen3.8-27b',
    reasoning: 'provider-default',
    async create(modelId, fetch) {
      const { createGroq } = await import('@ai-sdk/groq')
      return { model: createGroq({ fetch })(modelId), temperature: 0 }
    },
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    where: 'api',
    env: ['DEEPSEEK_API_KEY'],
    missing: requires(['DEEPSEEK_API_KEY']),
    example: 'deepseek-flash',
    reasoning: 'provider-default',
    async create(modelId, fetch) {
      const { createDeepSeek } = await import('@ai-sdk/deepseek')
      return { model: createDeepSeek({ fetch })(modelId), temperature: 0 }
    },
  },
  {
    id: 'togetherai',
    aliases: ['together'],
    name: 'Together AI',
    where: 'api',
    env: ['TOGETHER_API_KEY'],
    missing: requires(['TOGETHER_API_KEY']),
    example: 'Qwen/Qwen3.5-9B',
    reasoning: 'provider-default',
    schemaInPrompt: true,
    async create(modelId, fetch) {
      const { createTogetherAI } = await import('@ai-sdk/togetherai')
      return { model: createTogetherAI({ fetch })(modelId), temperature: 0 }
    },
  },
  {
    id: 'fireworks',
    name: 'Fireworks AI',
    where: 'api',
    env: ['FIREWORKS_API_KEY'],
    missing: requires(['FIREWORKS_API_KEY']),
    example: 'accounts/fireworks/models/glm-5p3-flash',
    reasoning: 'provider-default',
    async create(modelId, fetch) {
      const { createFireworks } = await import('@ai-sdk/fireworks')
      return { model: createFireworks({ fetch })(modelId), temperature: 0 }
    },
  },
  {
    id: 'cerebras',
    name: 'Cerebras',
    where: 'api',
    env: ['CEREBRAS_API_KEY'],
    missing: requires(['CEREBRAS_API_KEY']),
    example: 'qwen-3.8-27b',
    reasoning: 'provider-default',
    async create(modelId, fetch) {
      const { createCerebras } = await import('@ai-sdk/cerebras')
      return { model: createCerebras({ fetch })(modelId), temperature: 0 }
    },
  },
  {
    id: 'gateway',
    aliases: ['vercel'],
    name: 'Vercel AI Gateway',
    where: 'api',
    env: ['AI_GATEWAY_API_KEY', 'VERCEL_OIDC_TOKEN'],
    missing: requires(['AI_GATEWAY_API_KEY', 'VERCEL_OIDC_TOKEN']),
    example: 'openai/gpt-6-luna',
    reasoning: 'provider-default',
    async create(modelId, fetch) {
      const { createGateway } = await import('ai')
      return { model: createGateway({ fetch })(modelId) }
    },
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    where: 'api',
    env: ['OPENROUTER_API_KEY'],
    missing: requires(['OPENROUTER_API_KEY']),
    example: 'openai/gpt-6-luna',
    reasoning: 'provider-default',
    async create(modelId, fetch) {
      const openrouter = await openAICompatible('openrouter', 'https://openrouter.ai/api/v1', value('OPENROUTER_API_KEY') ?? '', fetch)
      // No temperature: OpenRouter fronts models, such as Claude Haiku 5.5, that reject anything but the default.
      return { model: openrouter(modelId) }
    },
  },
  {
    id: 'openai-compatible',
    name: 'OpenAI-compatible',
    where: 'api',
    env: ['RAMPA_OPENAI_COMPATIBLE_URL', 'RAMPA_OPENAI_COMPATIBLE_KEY'],
    missing: requires(['RAMPA_OPENAI_COMPATIBLE_URL']),
    example: '<model>',
    reasoning: 'provider-default',
    async create(modelId, fetch) {
      const baseURL = value('RAMPA_OPENAI_COMPATIBLE_URL') ?? ''
      const compatible = await openAICompatible('openai-compatible', baseURL, value('RAMPA_OPENAI_COMPATIBLE_KEY') ?? 'none', fetch)
      return { model: compatible(modelId), temperature: 0 }
    },
  },
]

/** The provider for a prefix or one of its aliases, in any case. */
export function findProvider(prefix: string): ProviderDef | undefined {
  const id = prefix.toLowerCase()
  return PROVIDERS.find((provider) => provider.id === id || provider.aliases?.includes(id))
}
