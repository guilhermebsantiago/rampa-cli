import { access } from 'node:fs/promises'
import { resolveProvider } from '../cli/commands/check.ts'
import { type RampaConfig, loadConfig, loadWaivers } from '../config.ts'
import { type JudgmentCache, fileCache } from '../core/cache.ts'
import { type CheckOptions, checkSnapshot } from '../core/check.ts'
import { type AnyCriterion, CONFIDENCE_RANK, type Confidence, type Report } from '../core/types.ts'
import { RampaError } from '../core/util.ts'
import { DEFAULT_CRITERIA, resolveCriteria } from '../criteria/index.ts'
import { type Locale, resolveLocale } from '../i18n.ts'
import { REASONING_LEVELS, type Reasoning } from '../providers/ai-sdk.ts'
import { defaultModel } from '../providers/detect.ts'
import type { ModelProvider } from '../providers/types.ts'
import type { RuleCheck } from '../rules/types.ts'
import type { Collected } from '../surfaces/web.ts'

/**
 * Options shared by `check` and `checkPage`. Each one mirrors a `rampa check` flag;
 * what is not set falls back to rampa.config.*, then to the CLI's default.
 */
export interface RampaOptions {
  /** WCAG criteria to judge, such as ['1.1.1', '2.4.4'] or '1.1.1,2.4.4'. Default: all six. axe-core runs every WCAG 2.1 A/AA rule either way. */
  criteria?: readonly string[] | string | undefined
  /** `provider:model`, such as 'ollama:gemma4:12b', or a ModelProvider of your own. Default: RAMPA_MODEL, the config, then what this machine can run. */
  model?: string | ModelProvider | undefined
  /** The deterministic layer only, like --no-llm. */
  noLlm?: boolean | undefined
  /** Judgments per candidate, majority vote, like --runs. Default 1. */
  runs?: number | undefined
  /** Findings below this confidence go to `belowThreshold` instead of `findings`, like --min-confidence. Default 'medium'. */
  minConfidence?: Confidence | undefined
  /** Model reasoning effort, like --reasoning. Local models default to none. */
  reasoning?: Reasoning | undefined
  /** Cached judgments only, never a model call, like --offline. */
  offline?: boolean | undefined
  /** Fingerprints of findings dismissed on purpose, or the path of a waivers file. Default: .rampa/waivers.json, as the CLI reads it. */
  waivers?: Iterable<string> | string | undefined
  /** Report language, 'en' or 'pt-BR'. Default: RAMPA_LOCALE, the config, then 'en'. */
  locale?: Locale | string | undefined
  /** Judgment cache directory, like --cache-dir. Default .rampa/cache. */
  cacheDir?: string | undefined
  /** A cache of your own, such as memoryCache(); it wins over cacheDir. */
  cache?: JudgmentCache | undefined
  /** Parallel model calls, like --concurrency. Default 4. */
  concurrency?: number | undefined
  /** Settings to fall back on: rampa.config.* in the working directory by default, an object of your own, or false for none. */
  config?: RampaConfig | false | undefined
}

export interface Settings extends CheckOptions {
  /** Images are captured only when a criterion that needs vision will be judged. */
  captureImages: boolean
}

export async function resolveSettings(options: RampaOptions = {}): Promise<Settings> {
  const config = options.config === false ? {} : (options.config ?? (await loadConfig()).config)
  const ids: readonly string[] | string = options.criteria ?? config.criteria ?? DEFAULT_CRITERIA
  const criteria: AnyCriterion[] = resolveCriteria(typeof ids === 'string' ? ids.split(',') : ids)
  const minConfidence = options.minConfidence ?? config.minConfidence ?? 'medium'
  // An unknown level would rank as undefined, and every finding would quietly fall below it.
  if (!Object.hasOwn(CONFIDENCE_RANK, minConfidence)) {
    throw new RampaError('invalid-option', `minConfidence must be low, medium or high. Got "${String(minConfidence)}".`)
  }
  const reasoning = options.reasoning ?? config.reasoning
  if (reasoning !== undefined && !REASONING_LEVELS.includes(reasoning)) {
    throw new RampaError('invalid-option', `reasoning must be one of ${REASONING_LEVELS.join(', ')}. Got "${String(reasoning)}".`)
  }
  const llm = !options.noLlm
  const offline = Boolean(options.offline)
  return {
    criteria,
    llm,
    provider: llm ? await providerFor(options.model, config, offline, reasoning) : undefined,
    runs: whole(options.runs ?? config.runs, 1),
    cache: options.cache ?? fileCache(options.cacheDir ?? config.cacheDir ?? '.rampa/cache'),
    offline,
    locale: resolveLocale(options.locale ?? process.env.RAMPA_LOCALE ?? config.locale),
    minConfidence,
    concurrency: whole(options.concurrency ?? config.concurrency, 4),
    waivers: await waiversFrom(options.waivers),
    // As `rampa check` decides, so a report counts the same candidates as the CLI's.
    captureImages: llm && criteria.some((criterion) => criterion.needs.vision),
  }
}

/** Judges what a surface collected, as `rampa check` does. `criteria` narrows the configured ones. */
export function judge(collected: Collected, settings: Settings, criteria: AnyCriterion[] = settings.criteria, rules?: readonly RuleCheck[]): Promise<Report> {
  return checkSnapshot(collected.snapshot, collected.engine, { ...settings, criteria, rules })
}

let detected: Promise<string | undefined> | undefined

/** The model `rampa check` would use: the option, RAMPA_MODEL, the config, then what this machine can run. */
async function providerFor(model: RampaOptions['model'], config: RampaConfig, offline: boolean, reasoning: Reasoning | undefined): Promise<ModelProvider | undefined> {
  if (model !== undefined && typeof model !== 'string') return model
  // Detection probes local model servers; a test suite checks many pages, so it probes once per process.
  const spec = model ?? (process.env.RAMPA_MODEL || undefined) ?? config.model ?? (await (detected ??= defaultModel()))
  return resolveProvider(spec, offline, reasoning)
}

async function waiversFrom(waivers: RampaOptions['waivers']): Promise<ReadonlySet<string>> {
  if (waivers === undefined) return loadWaivers()
  if (typeof waivers !== 'string') return new Set(waivers)
  try {
    await access(waivers)
  } catch {
    throw new RampaError('waivers-not-found', `Waivers file not found: ${waivers}`)
  }
  return loadWaivers(waivers)
}

function whole(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value >= 1 ? Math.floor(value) : fallback
}
