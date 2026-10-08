import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createModelProvider, parseModelSpec, providerIdentity } from '../src/providers/ai-sdk.ts'
import { chooseModel, defaultModel } from '../src/providers/detect.ts'
import { PROVIDERS, findProvider } from '../src/providers/registry.ts'

const ANSWER = { verdict: 'fail', evidence: 'hello' }
const TEXT = JSON.stringify(ANSWER)
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const schema = z.object({ verdict: z.enum(['pass', 'fail', 'cannot_tell']), evidence: z.string() })

/** A minimal success reply in each wire format the providers speak. */
function reply(url: string, body: { model?: string }): unknown {
  if (url.includes('ai-gateway.vercel.sh')) {
    return {
      content: [{ type: 'text', text: TEXT }],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: { inputTokens: { total: 12, noCache: 12, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 5, text: 5, reasoning: 0 } },
      warnings: [],
    }
  }
  if (/\/responses(\?|$)/.test(url)) {
    return {
      id: 'resp_1',
      object: 'response',
      created_at: 1,
      status: 'completed',
      model: body.model,
      output: [{ type: 'message', id: 'msg_1', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: TEXT, annotations: [] }] }],
      usage: { input_tokens: 12, input_tokens_details: { cached_tokens: 0 }, output_tokens: 5, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 17 },
      incomplete_details: null,
    }
  }
  if (url.includes('/chat/completions')) {
    return {
      id: 'chat_1',
      object: 'chat.completion',
      created: 1,
      model: body.model,
      choices: [{ index: 0, message: { role: 'assistant', content: TEXT }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 },
    }
  }
  if (url.endsWith('/messages')) {
    return {
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: body.model,
      content: [{ type: 'text', text: TEXT }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 12, output_tokens: 5 },
    }
  }
  if (url.includes(':generateContent')) {
    return {
      candidates: [{ content: { role: 'model', parts: [{ text: TEXT }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 5, totalTokenCount: 17 },
    }
  }
  if (url.endsWith('/converse')) {
    // Bedrock gets the JSON through a forced `json` tool.
    const content = (body as { toolConfig?: { tools?: Array<{ toolSpec?: { name?: string } }> } }).toolConfig?.tools?.some((tool) => tool.toolSpec?.name === 'json')
      ? [{ toolUse: { toolUseId: 'tool_1', name: 'json', input: ANSWER } }]
      : [{ text: TEXT }]
    return { output: { message: { role: 'assistant', content } }, stopReason: 'end_turn', usage: { inputTokens: 12, outputTokens: 5, totalTokens: 17 } }
  }
  throw new Error(`No stub for ${url}`)
}

interface Captured {
  url: string
  headers: Headers
  body: string
}

function stubNetwork(): { fetch: typeof fetch; requests: Captured[] } {
  const requests: Captured[] = []
  const stub: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const body = typeof init?.body === 'string' ? init.body : ''
    requests.push({ url, headers: new Headers(init?.headers), body })
    return new Response(JSON.stringify(reply(url, JSON.parse(body || '{}') as { model?: string })), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  return { fetch: stub, requests }
}

/** Fake credentials for each provider; vertex-anthropic needs Google Cloud credentials and is left out. */
const CASES: Array<{ spec: string; env: Record<string, string>; host: string }> = [
  { spec: 'ollama:gemma4:12b', env: {}, host: 'localhost:11434' },
  { spec: 'lmstudio:qwen/qwen3.5-9b', env: {}, host: 'localhost:1234' },
  { spec: 'anthropic:claude-haiku-5-5', env: { ANTHROPIC_API_KEY: 'test' }, host: 'api.anthropic.com' },
  { spec: 'openai:gpt-6-luna', env: { OPENAI_API_KEY: 'test' }, host: 'api.openai.com' },
  { spec: 'google:gemini-3.5-flash-lite', env: { GEMINI_API_KEY: 'test' }, host: 'generativelanguage.googleapis.com' },
  { spec: 'azure:my-deployment', env: { AZURE_API_KEY: 'test', AZURE_RESOURCE_NAME: 'rampa' }, host: 'rampa.openai.azure.com' },
  { spec: 'bedrock:global.anthropic.claude-haiku-5-5', env: { AWS_DEFAULT_REGION: 'us-east-1', AWS_BEARER_TOKEN_BEDROCK: 'test' }, host: 'bedrock-runtime.us-east-1.amazonaws.com' },
  { spec: 'vertex:gemini-3.5-flash-lite', env: { GOOGLE_VERTEX_API_KEY: 'test' }, host: 'aiplatform.googleapis.com' },
  { spec: 'mistral:mistral-small-latest', env: { MISTRAL_API_KEY: 'test' }, host: 'api.mistral.ai' },
  { spec: 'xai:grok-4.20-0309-non-reasoning', env: { XAI_API_KEY: 'test' }, host: 'api.x.ai' },
  { spec: 'groq:qwen/qwen3.8-27b', env: { GROQ_API_KEY: 'test' }, host: 'api.groq.com' },
  { spec: 'deepseek:deepseek-flash', env: { DEEPSEEK_API_KEY: 'test' }, host: 'api.deepseek.com' },
  { spec: 'together:Qwen/Qwen3.5-9B', env: { TOGETHER_API_KEY: 'test' }, host: 'api.together.xyz' },
  { spec: 'fireworks:accounts/fireworks/models/glm-5p3-flash', env: { FIREWORKS_API_KEY: 'test' }, host: 'api.fireworks.ai' },
  { spec: 'cerebras:qwen-3.8-27b', env: { CEREBRAS_API_KEY: 'test' }, host: 'api.cerebras.ai' },
  { spec: 'gateway:openai/gpt-6-luna', env: { AI_GATEWAY_API_KEY: 'test' }, host: 'ai-gateway.vercel.sh' },
  { spec: 'openrouter:openai/gpt-6-luna', env: { OPENROUTER_API_KEY: 'test' }, host: 'openrouter.ai' },
  { spec: 'openai-compatible:local-model', env: { RAMPA_OPENAI_COMPATIBLE_URL: 'http://localhost:9999/v1' }, host: 'localhost:9999' },
]

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('providers', () => {
  it('has a test case for every provider that can run without cloud credentials', () => {
    const covered = new Set(CASES.map((c) => parseModelSpec(c.spec).provider))
    expect(PROVIDERS.map((p) => p.id).filter((id) => !covered.has(id))).toEqual(['vertex-anthropic'])
  })

  it.each(CASES)('$spec sends the prompt, the image and the schema, and reads the answer back', async ({ spec, env, host }) => {
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value)
    const network = stubNetwork()
    const provider = await createModelProvider(spec, { fetch: network.fetch })
    const result = await provider.judge({
      system: 'You judge.',
      user: 'Judge <text>hello</text>.',
      images: [{ data: Uint8Array.from(Buffer.from(PNG_BASE64, 'base64')), mediaType: 'image/png' }],
      schema,
      schemaName: 'probe',
    })
    expect(result.output).toEqual(ANSWER)
    expect(result.inputTokens).toBe(12)
    const request = network.requests[0]
    expect(request?.url).toContain(host)
    expect(request?.body).toContain(PNG_BASE64)
    // The schema reaches the model, as a native structured output or in the instructions.
    expect(request?.body).toContain('cannot_tell')
  })

  it('asks Bedrock for the JSON through a forced tool, which every Claude on Bedrock supports', async () => {
    vi.stubEnv('AWS_REGION', 'us-east-1')
    vi.stubEnv('AWS_BEARER_TOKEN_BEDROCK', 'test')
    const network = stubNetwork()
    const provider = await createModelProvider('bedrock:global.anthropic.claude-haiku-5-5', { fetch: network.fetch })
    await provider.judge({ system: 'You judge.', user: 'Judge.', schema, schemaName: 'probe' })
    const body = JSON.parse(network.requests[0]?.body ?? '{}') as { toolConfig?: unknown; additionalModelRequestFields?: { output_config?: unknown } }
    expect(JSON.stringify(body.toolConfig)).toContain('"name":"json"')
    expect(body.additionalModelRequestFields?.output_config).toBeUndefined()
  })

  it('resolves aliases to one provider, so the cache sees one identity', () => {
    expect(parseModelSpec('together:Qwen/Qwen3.5-9B').provider).toBe('togetherai')
    expect(parseModelSpec('Gemini:gemini-3.5-flash-lite').provider).toBe('google')
    expect(parseModelSpec('aws:us.anthropic.claude-haiku-5-5-v1:0')).toEqual({ provider: 'bedrock', modelId: 'us.anthropic.claude-haiku-5-5-v1:0' })
    expect(providerIdentity('vercel:openai/gpt-6-luna').id).toBe('gateway:openai/gpt-6-luna')
    expect(findProvider('nope')).toBeUndefined()
  })

  it('says which credentials are missing before calling anything', async () => {
    for (const name of ['MISTRAL_API_KEY', 'AWS_REGION', 'AWS_DEFAULT_REGION', 'AWS_BEARER_TOKEN_BEDROCK', 'AWS_SECRET_ACCESS_KEY']) vi.stubEnv(name, '')
    await expect(createModelProvider('mistral:mistral-small-latest')).rejects.toThrow(/MISTRAL_API_KEY/)
    vi.stubEnv('AWS_ACCESS_KEY_ID', 'test')
    await expect(createModelProvider('bedrock:global.anthropic.claude-haiku-5-5')).rejects.toThrow(
      'Amazon Bedrock needs AWS_REGION (or AWS_DEFAULT_REGION) and AWS_BEARER_TOKEN_BEDROCK (or AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY)',
    )
    await expect(createModelProvider('nope:model')).rejects.toThrow(/Unknown provider "nope"/)
  })

  it('picks the flag, then RAMPA_MODEL, then the config file', async () => {
    vi.stubEnv('RAMPA_MODEL', 'openai:gpt-6-luna')
    expect(await chooseModel('anthropic:claude-haiku-5-5', 'google:gemini-3.5-flash-lite')).toBe('anthropic:claude-haiku-5-5')
    expect(await chooseModel(undefined, 'google:gemini-3.5-flash-lite')).toBe('openai:gpt-6-luna')
    vi.stubEnv('RAMPA_MODEL', '')
    expect(await chooseModel(undefined, 'google:gemini-3.5-flash-lite')).toBe('google:gemini-3.5-flash-lite')
  })

  it('falls back to the first API provider with credentials when there is no local model', async () => {
    for (const provider of PROVIDERS) for (const name of provider.env) vi.stubEnv(name, '')
    vi.stubEnv('OLLAMA_BASE_URL', 'http://127.0.0.1:9')
    expect(await defaultModel()).toBeUndefined()
    vi.stubEnv('OPENAI_API_KEY', 'test')
    expect(await defaultModel()).toBe('openai:gpt-6-luna')
  })
})
