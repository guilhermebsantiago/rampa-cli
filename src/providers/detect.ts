import { RECOMMENDED } from './models.ts'
import { PROVIDERS, findProvider, lmStudioUrl, ollamaUrl } from './registry.ts'

export interface ProviderStatus {
  id: string
  name: string
  where: 'local' | 'api'
  /** Credentials are complete (API) or the server answers (local). */
  ready: boolean
  /** Credentials still missing, in words. */
  missing: string[]
  /** Variables of this provider that are set. */
  set: string[]
}

export interface Environment {
  providers: ProviderStatus[]
  ollama: { reachable: boolean; models: string[] }
  lmStudio: { reachable: boolean; models: string[] }
}

export async function detectEnvironment(): Promise<Environment> {
  const [ollama, lmStudio] = await Promise.all([probeOllama(), probeLmStudio()])
  const providers = PROVIDERS.map((provider) => {
    const missing = provider.missing()
    const reachable = provider.id === 'ollama' ? ollama.reachable : provider.id === 'lmstudio' ? lmStudio.reachable : true
    return {
      id: provider.id,
      name: provider.name,
      where: provider.where,
      ready: missing.length === 0 && reachable,
      missing,
      set: provider.env.filter((name) => Boolean(process.env[name])),
    }
  })
  return { providers, ollama, lmStudio }
}

export async function probeOllama(): Promise<{ reachable: boolean; models: string[] }> {
  try {
    const response = await fetch(`${ollamaUrl()}/api/tags`, { signal: AbortSignal.timeout(1500) })
    if (!response.ok) return { reachable: false, models: [] }
    const body = (await response.json()) as { models?: Array<{ name: string }> }
    return { reachable: true, models: (body.models ?? []).map((m) => m.name) }
  } catch {
    return { reachable: false, models: [] }
  }
}

export async function probeLmStudio(): Promise<{ reachable: boolean; models: string[] }> {
  try {
    const response = await fetch(`${lmStudioUrl()}/models`, { signal: AbortSignal.timeout(1500) })
    if (!response.ok) return { reachable: false, models: [] }
    const body = (await response.json()) as { data?: Array<{ id: string }> }
    return { reachable: true, models: (body.data ?? []).map((m) => m.id) }
  } catch {
    return { reachable: false, models: [] }
  }
}

/** The model to use: the flag, then RAMPA_MODEL, then the config file, then whatever this machine can run. */
export async function chooseModel(flag: string | undefined, configured: string | undefined): Promise<string | undefined> {
  return flag ?? (process.env.RAMPA_MODEL || undefined) ?? configured ?? (await defaultModel())
}

/**
 * Picks a model when none was configured: local first (private, no cost), then the first API provider with
 * credentials, in the order of the recommendations. `ollama` is a probe the caller made already.
 */
export async function defaultModel(ollama?: { reachable: boolean; models: string[] }): Promise<string | undefined> {
  const server = ollama ?? (await probeOllama())
  if (server.reachable) {
    const preferred = ['gemma4:12b', 'qwen3.5:9b', 'gemma4:e4b', 'ministral-3:8b']
    const found = preferred.find((name) => server.models.includes(name))
    if (found) return `ollama:${found}`
  }
  const candidate = RECOMMENDED.find((model) => {
    if (!model.default || model.where !== 'api') return false
    const provider = findProvider(model.spec.slice(0, model.spec.indexOf(':')))
    return provider !== undefined && provider.missing().length === 0
  })
  return candidate?.spec
}
