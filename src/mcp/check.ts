import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { resolveProvider } from '../cli/commands/check.ts'
import { loadWaivers } from '../config.ts'
import type { JudgmentCache } from '../core/cache.ts'
import { checkSnapshot } from '../core/check.ts'
import type { Confidence, EngineResults, Report } from '../core/types.ts'
import { RampaError, errorMessage } from '../core/util.ts'
import { DEFAULT_CRITERIA, resolveCriteria } from '../criteria/index.ts'
import { emptyEngine } from '../engine/axe.ts'
import type { Locale } from '../i18n.ts'
import { type Reasoning, parseModelSpec } from '../providers/ai-sdk.ts'
import { probeLmStudio, probeOllama } from '../providers/detect.ts'
import { lmStudioUrl, ollamaUrl } from '../providers/registry.ts'
import type { JudgeRequest, ModelProvider } from '../providers/types.ts'
import { type Collected, collectWeb, launchBrowser } from '../surfaces/web.ts'
import { type Target, loadEngineFor, loadSnapshot, resolveTargets } from '../surfaces/targets.ts'

/** What `rampa mcp` was started with. Every tool call can override the model, the judgment switch and the locale. */
export interface AgentDefaults {
  model?: string | undefined
  llm: boolean
  locale: Locale
  /** Cached judgments only; the model is never called. */
  offline: boolean
  reasoning?: Reasoning | undefined
  cache: JudgmentCache
  concurrency: number
  /** Picks the model when the call names none: the server's --model, RAMPA_MODEL, the config file, then what this machine can run. */
  chooseModel(requested: string | undefined): Promise<string | undefined>
  /** stderr: stdout belongs to the protocol. */
  log(line: string): void
}

/** The options a tool call can pass, with the names agents see. */
export interface AgentCheckArgs {
  criteria?: string[] | undefined
  model?: string | undefined
  no_llm?: boolean | undefined
  locale?: Locale | undefined
  runs?: number | undefined
  min_confidence?: Confidence | undefined
}

export interface CallControl {
  /** Aborted when the client cancels the call or disconnects. */
  signal: AbortSignal
  /** Present only when the client asked for progress notifications. */
  progress?: ((progress: number, total: number | undefined, message: string) => void) | undefined
}

export interface AgentCheck {
  report: Report
  engine: EngineResults
}

const NO_LLM_HINT = 'or pass no_llm: true to run only axe-core.'

/** One page per call: a URL, an .html file or a snapshot .json, with errors an agent can act on. */
export async function resolveAgentTarget(input: string): Promise<Target> {
  const value = input.trim()
  const expanded = value === '~' || /^~[\\/]/.test(value) ? join(homedir(), value.slice(2)) : value
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(expanded) && !/^(https?|file):\/\//i.test(expanded)) {
    throw new RampaError('unsupported-target', `Unsupported target: ${input}. Pass an http(s) or file URL, an .html file or a snapshot .json.`)
  }
  let targets: Target[]
  try {
    targets = await resolveTargets([expanded])
  } catch (error) {
    if (error instanceof RampaError && error.code === 'target-not-found') {
      throw new RampaError(
        'target-not-found',
        `Target not found: ${input} (looked for ${resolve(expanded)}; the server's working directory is ${process.cwd()}). Pass an absolute path or an http(s) URL, or the markup itself to check_html.`,
      )
    }
    throw error
  }
  const [first] = targets
  if (!first) throw new RampaError('target-not-found', `${input} is a folder without .html files. Pass one .html file, a snapshot .json or a URL.`)
  if (targets.length > 1) {
    const examples = targets.slice(0, 5).map((target) => target.label)
    throw new RampaError(
      'one-page',
      `${input} is a folder with ${targets.length} .html files, and a call checks one page. Pass one of them, such as ${examples.join(', ')}.`,
    )
  }
  return first
}

export async function runAgentCheck(target: Target, args: AgentCheckArgs, defaults: AgentDefaults, control: CallControl): Promise<AgentCheck> {
  const locale = args.locale ?? defaults.locale
  const llm = args.no_llm === undefined ? defaults.llm : !args.no_llm
  const criteria = resolveCriteria(args.criteria ?? DEFAULT_CRITERIA)
  const runs = args.runs ?? 1
  const provider = llm ? await providerFor(args.model ?? defaults.model, defaults) : undefined

  control.progress?.(0, undefined, target.kind === 'web' ? `Loading ${target.label} and running axe-core` : `Reading ${target.label}`)
  const { snapshot, engine } =
    target.kind === 'web'
      ? await collectPage(target.url, target.label, { locale, captureImages: llm && criteria.some((criterion) => criterion.needs.vision) })
      : await collectRecording(target.path, target.label)
  if (control.signal.aborted) throw new RampaError('cancelled', 'The check was cancelled.')

  // Progress counts judgments: one step to collect, one per sample, one for the report.
  const counts = provider
    ? criteria.filter((criterion) => criterion.surfaces.includes(snapshot.surface)).map((criterion) => ({ id: criterion.id, candidates: criterion.candidates(snapshot, engine).length }))
    : []
  const candidates = counts.reduce((sum, count) => sum + count.candidates, 0)
  const samples = candidates * runs
  const total = samples + 2
  let done = 0
  const step = () => {
    done = Math.min(done + 1, samples)
    control.progress?.(1 + done, total, `Judged ${done} of ${samples}`)
  }
  const judging = counts.filter((count) => count.candidates > 0).map((count) => count.id)
  control.progress?.(1, total, samples > 0 ? `Judging ${candidates} candidate(s) for ${judging.join(', ')}` : 'Building the report')

  const report = await checkSnapshot(snapshot, engine, {
    criteria,
    llm,
    provider: provider && observedProvider(provider, control.signal, step),
    runs,
    cache: observedCache(defaults.cache, defaults.offline, step),
    offline: defaults.offline,
    locale,
    minConfidence: args.min_confidence ?? 'medium',
    concurrency: defaults.concurrency,
    waivers: await loadWaivers(),
  })
  if (control.signal.aborted) throw new RampaError('cancelled', 'The check was cancelled.')

  const judged = report.criteria.reduce((sum, c) => sum + c.judged, 0)
  const failed = report.criteria.reduce((sum, c) => sum + c.errors, 0)
  if (failed > 0 && judged === 0) {
    throw new RampaError(
      'model-failed',
      `The model ${report.model ?? ''} failed on all ${failed} candidate(s): ${report.errors[0] ?? 'unknown error'}. Check that it runs and is reachable from the server (rampa doctor), pass another model, ${NO_LLM_HINT}`,
    )
  }
  control.progress?.(total, total, `Done: ${report.findings.length} finding(s)`)
  return { report, engine }
}

/** A browser per call, closed when the call ends, so a server left running holds no browser between checks. */
async function collectPage(url: string, label: string, options: { locale: Locale; captureImages: boolean }): Promise<Collected> {
  let browser
  try {
    browser = await launchBrowser()
  } catch (error) {
    throw new RampaError('browser-not-found', `${errorMessage(error)} To check without a browser, pass a snapshot .json recorded with rampa check --save.`)
  }
  try {
    return await collectWeb(browser, url, { runAxe: true, ...options })
  } catch (error) {
    throw new RampaError('page-load', `Could not check ${label}: ${errorMessage(error)}. Check that it loads in a browser on this machine, or pass its HTML to check_html.`)
  } finally {
    await browser.close().catch(() => undefined)
  }
}

async function collectRecording(path: string, label: string): Promise<Collected> {
  try {
    return { snapshot: await loadSnapshot(path), engine: (await loadEngineFor(path)) ?? emptyEngine() }
  } catch (error) {
    if (error instanceof RampaError) throw error
    throw new RampaError(
      'invalid-snapshot',
      `${label} is not a snapshot Rampa can read: ${errorMessage(error)}. Pass a .json recorded with rampa check --save, or one that follows schema/snapshot.schema.json.`,
    )
  }
}

/** The CLI's model resolution, with errors that say how to recover from inside an agent. */
async function providerFor(requested: string | undefined, defaults: AgentDefaults): Promise<ModelProvider> {
  const spec = await defaults.chooseModel(requested)
  if (!spec) {
    throw new RampaError(
      'no-model',
      'No model is available for the judgment layer: neither this call nor the server names one, and Rampa found no RAMPA_MODEL, no model in rampa.config, no local Ollama model it knows and no provider API key. ' +
        'Pass model, for example "ollama:gemma4:12b" after ollama pull gemma4:12b, or "anthropic:claude-haiku-5-5" with ANTHROPIC_API_KEY in the server\'s environment; ' +
        `${NO_LLM_HINT} rampa models lists what is ready on this machine.`,
    )
  }
  let provider: ModelProvider | undefined
  try {
    provider = await resolveProvider(spec, defaults.offline, defaults.reasoning)
  } catch (error) {
    const where = error instanceof RampaError && error.code === 'missing-api-key' ? " Set it in the server's environment (the env of its MCP configuration, or a .env file in its working directory)," : ''
    throw new RampaError(error instanceof RampaError ? error.code : 'invalid-model', `${errorMessage(error)}${where} ${NO_LLM_HINT}`)
  }
  if (!provider) throw new RampaError('no-model', `No model for ${spec}; ${NO_LLM_HINT}`)
  if (!defaults.offline) await preflight(spec)
  return provider
}

/** A local server that is down fails every call after retries; saying so up front is faster and clearer. */
async function preflight(spec: string): Promise<void> {
  const { provider, modelId } = parseModelSpec(spec)
  if (provider === 'ollama') {
    const ollama = await probeOllama()
    if (!ollama.reachable) {
      throw new RampaError('model-unreachable', `Ollama is not reachable at ${ollamaUrl()}, so ${spec} cannot judge. Start it (ollama serve) or set OLLAMA_BASE_URL in the server's environment, ${NO_LLM_HINT}`)
    }
    if (!ollama.models.includes(modelId) && !ollama.models.includes(`${modelId}:latest`)) {
      const available = ollama.models.length > 0 ? `, pass one it has (${ollama.models.slice(0, 6).map((name) => `ollama:${name}`).join(', ')})` : ''
      throw new RampaError('model-missing', `Ollama has no model ${modelId}. Run ollama pull ${modelId}${available}, ${NO_LLM_HINT}`)
    }
  }
  if (provider === 'lmstudio' && !(await probeLmStudio()).reachable) {
    throw new RampaError('model-unreachable', `LM Studio is not reachable at ${lmStudioUrl()}, so ${spec} cannot judge. Start its server or set LMSTUDIO_BASE_URL, ${NO_LLM_HINT}`)
  }
}

/** Counts each finished call for progress and stops calling the model once the client cancels. */
export function observedProvider(provider: ModelProvider, signal: AbortSignal, onSettled: () => void): ModelProvider {
  return {
    ...provider,
    async judge<T>(request: JudgeRequest<T>) {
      if (signal.aborted) throw new RampaError('cancelled', 'cancelled by the client')
      try {
        return await provider.judge(request)
      } finally {
        onSettled()
      }
    },
  }
}

/** A cached sample, or an offline miss, finishes at the lookup; any other miss finishes when the model answers. */
export function observedCache(cache: JudgmentCache, offline: boolean, onSettled: () => void): JudgmentCache {
  return {
    async get(key) {
      const value = await cache.get(key)
      if (value || offline) onSettled()
      return value
    },
    set: (key, value) => cache.set(key, value),
  }
}

/**
 * A client may start the server in a folder it cannot write to, and judge.ts treats a failed
 * cache write as a failed judgment. Losing the cache must not lose the judgment, so a failed
 * write is reported once and skipped.
 */
export function tolerantCache(cache: JudgmentCache, log: (line: string) => void): JudgmentCache {
  let warned = false
  return {
    get: (key) => cache.get(key),
    async set(key, value) {
      try {
        await cache.set(key, value)
      } catch (error) {
        if (!warned) log(`rampa mcp: judgments are not being cached (${errorMessage(error)}); pass --cache-dir with a writable folder.`)
        warned = true
      }
    },
  }
}
