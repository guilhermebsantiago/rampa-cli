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
import { DEFAULT_WCAG, type WcagVersion } from '../wcag.ts'

/** What `rampa mcp` was started with. Every tool call can override the model, the judgment switch and the locale. */
export interface AgentDefaults {
  model?: string | undefined
  llm: boolean
  /** The WCAG version to state coverage against; 2.2 when absent. */
  wcag?: WcagVersion | undefined
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
  wcag?: WcagVersion | undefined
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
  const home = value === '~' || /^~[\\/]/.test(value) ? join(homedir(), value.slice(2)) : value
  // resolveTargets knows the file scheme only in lower case.
  const expanded = home.replace(/^file:\/\//i, 'file://')
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
  const wcag = args.wcag ?? defaults.wcag ?? DEFAULT_WCAG
  const llm = args.no_llm === undefined ? defaults.llm : !args.no_llm
  const criteria = resolveCriteria(args.criteria ?? DEFAULT_CRITERIA)
  const runs = args.runs ?? 1
  const provider = llm ? await providerFor(args.model ?? defaults.model, defaults) : undefined

  // Android devices, UI Automator dumps and screenshots need the CLI's collectors and their notes; a call checks a page.
  if (target.kind !== 'web' && target.kind !== 'snapshot') {
    throw new RampaError(
      'unsupported-target',
      `${target.label} is an ${target.kind === 'image' ? 'image' : 'Android'} target, which check_page does not take. Run \`rampa check ${target.label}\` in a terminal, or pass a URL, an .html file or a snapshot .json.`,
    )
  }
  control.progress?.(0, undefined, target.kind === 'web' ? `Loading ${target.label} and running axe-core` : `Reading ${target.label}`)
  const { snapshot, engine } =
    target.kind === 'web'
      ? await collectPage(target.url, target.label, { locale, wcag, captureImages: llm && criteria.some((criterion) => criterion.needs.vision) })
      : await collectRecording(target.path, target.label)
  if (control.signal.aborted) throw new RampaError('cancelled', 'The check was cancelled.')

  // Progress counts judgments as they start: one step to collect, one per sample, one for the report.
  // Every sample begins with exactly one cache lookup, so counting lookups never counts a sample twice.
  const progress = control.progress
  let total = 2
  let observed = defaults.cache
  if (progress && provider) {
    const counts = criteria
      .filter((criterion) => criterion.surfaces.includes(snapshot.surface))
      .map((criterion) => ({ id: criterion.id, candidates: criterion.candidates(snapshot, engine).length }))
    const candidates = counts.reduce((sum, count) => sum + count.candidates, 0)
    const samples = candidates * runs
    total = samples + 2
    const judging = counts.filter((count) => count.candidates > 0).map((count) => count.id)
    progress(1, total, samples > 0 ? `Judging ${candidates} candidate(s) for ${judging.join(', ')}` : 'Building the report')
    let started = 0
    observed = observedCache(defaults.cache, () => {
      started = Math.min(started + 1, samples)
      progress(1 + started, total, `Judging ${started} of ${samples}`)
    })
  }

  const report = await checkSnapshot(snapshot, engine, {
    criteria,
    llm,
    provider: provider && cancellable(provider, control.signal),
    runs,
    cache: observed,
    offline: defaults.offline,
    locale,
    minConfidence: args.min_confidence ?? 'medium',
    concurrency: defaults.concurrency,
    waivers: await loadWaivers(),
    wcag,
  })
  if (control.signal.aborted) throw new RampaError('cancelled', 'The check was cancelled.')
  progress?.(total, total, `Done: ${report.findings.length} finding(s)`)
  return { report, engine }
}

/**
 * When the model failed on every candidate it was asked about, the call is an error: the agent should
 * fix the model or run without one. The deterministic findings still hold and go along with the message.
 */
export function judgmentFailure(report: Report): string | undefined {
  // Judgments a criterion made without a model (a language identifier's) say nothing about the model: only answers do.
  const answered = report.usage.calls + report.usage.cachedCalls
  const failed = report.criteria.reduce((sum, c) => sum + c.errors, 0)
  if (failed === 0 || answered > 0) return undefined
  return `The model ${report.model ?? ''} failed on all ${failed} candidate(s): ${report.errors[0] ?? 'unknown error'}. Check that it runs and is reachable from the server (rampa doctor), pass another model, ${NO_LLM_HINT} What axe-core found is below.`
}

/** A browser per call, closed when the call ends, so a server left running holds no browser between checks. */
async function collectPage(url: string, label: string, options: { locale: Locale; captureImages: boolean; wcag: WcagVersion }): Promise<Collected> {
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

/** Stops calling the model once the client cancels; calls already in flight finish. */
export function cancellable(provider: ModelProvider, signal: AbortSignal): ModelProvider {
  return {
    ...provider,
    async judge<T>(request: JudgeRequest<T>) {
      if (signal.aborted) throw new RampaError('cancelled', 'cancelled by the client')
      return provider.judge(request)
    },
  }
}

/** Calls `onLookup` as each sample starts: judge.ts looks every sample up in the cache once, hit or miss. */
export function observedCache(cache: JudgmentCache, onLookup: () => void): JudgmentCache {
  return {
    async get(key) {
      onLookup()
      return cache.get(key)
    },
    set: (key, value) => cache.set(key, value),
  }
}

/**
 * A client may start the server in a folder it cannot write to (Claude Desktop may start it in
 * `/` on macOS), and judge.ts treats a failed cache write as a failed judgment. Losing the cache
 * must not lose the judgment, so a failed write is reported once and skipped.
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
