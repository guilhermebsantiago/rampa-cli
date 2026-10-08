const OLLAMA_URL = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434'

export interface Environment {
  keys: Record<string, boolean>
  ollama: { reachable: boolean; models: string[] }
}

export const KEY_VARS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'GEMINI_API_KEY', 'OPENROUTER_API_KEY'] as const

export async function detectEnvironment(): Promise<Environment> {
  const keys = Object.fromEntries(KEY_VARS.map((name) => [name, Boolean(process.env[name])]))
  return { keys, ollama: await probeOllama() }
}

export async function probeOllama(): Promise<{ reachable: boolean; models: string[] }> {
  try {
    const response = await fetch(`${OLLAMA_URL.replace(/\/$/, '')}/api/tags`, { signal: AbortSignal.timeout(1500) })
    if (!response.ok) return { reachable: false, models: [] }
    const body = (await response.json()) as { models?: Array<{ name: string }> }
    return { reachable: true, models: (body.models ?? []).map((m) => m.name) }
  } catch {
    return { reachable: false, models: [] }
  }
}

/** Picks a model when none was configured: local first (private, no cost), then the cheapest API with a key. */
export async function defaultModel(): Promise<string | undefined> {
  const ollama = await probeOllama()
  if (ollama.reachable) {
    const preferred = ['gemma4:12b', 'qwen3.5:9b', 'gemma4:e4b', 'ministral-3:8b']
    const found = preferred.find((name) => ollama.models.includes(name))
    if (found) return `ollama:${found}`
  }
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic:claude-haiku-5-5'
  if (process.env.OPENAI_API_KEY) return 'openai:gpt-6-luna'
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY) return 'google:gemini-3.5-flash-lite'
  return undefined
}
