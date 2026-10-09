import { type CliStatus, probeCli } from './cli/provider.ts'
import { RECOMMENDED } from './models.ts'
import { PROVIDERS, type ProviderDef, findProvider, lmStudioUrl, ollamaUrl } from './registry.ts'

export interface ProviderStatus {
  id: string
  name: string
  where: ProviderDef['where']
  /** Credentials are complete (API), the server answers (local) or the CLI is installed and signed in (subscription). */
  ready: boolean
  /** Credentials still missing, in words. */
  missing: string[]
  /** Variables of this provider that are set. */
  set: string[]
  /** Subscription CLIs: where it is, its version and how it is signed in. */
  cli?: CliStatus | undefined
}

export interface Environment {
  providers: ProviderStatus[]
  ollama: { reachable: boolean; models: string[] }
  lmStudio: { reachable: boolean; models: string[] }
}

export async function detectEnvironment(): Promise<Environment> {
  const [ollama, lmStudio, clis] = await Promise.all([probeOllama(), probeLmStudio(), probeClis()])
  const providers = PROVIDERS.map((provider) => {
    const cli = clis.get(provider.id)
    const missing = [...provider.missing(), ...cliNeeds(provider, cli)]
    const reachable = provider.id === 'ollama' ? ollama.reachable : provider.id === 'lmstudio' ? lmStudio.reachable : true
    return {
      id: provider.id,
      name: provider.name,
      where: provider.where,
      ready: missing.length === 0 && reachable,
      missing,
      set: provider.env.filter((name) => Boolean(process.env[name])),
      cli,
    }
  })
  return { providers, ollama, lmStudio }
}

/** Installed and signed in, asked of each CLI without calling a model. */
async function probeClis(): Promise<Map<string, CliStatus>> {
  const entries = await Promise.all(
    PROVIDERS.flatMap((provider) => (provider.cli ? [probeCli(provider.cli).then((status) => [provider.id, status] as const)] : [])),
  )
  return new Map(entries)
}

/** What a subscription CLI still needs, in words; a sign-in the CLI cannot report counts as present. */
function cliNeeds(provider: ProviderDef, status: CliStatus | undefined): string[] {
  if (!provider.cli || !status) return []
  if (!status.installed) return [`${provider.cli.name} (${provider.cli.command} on PATH)`]
  if (status.signIn?.signedIn === false) return [`a sign-in (${provider.cli.signInHint})`]
  if (status.signIn?.subscription === false) return [`a ${provider.cli.plan} subscription sign-in`]
  return []
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
