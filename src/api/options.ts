import { access } from 'node:fs/promises'
import { resolveProfiles } from '../advisory/profile.ts'
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
import { DEFAULT_WCAG, type WcagVersion, parseWcagVersion } from '../wcag.ts'

/**
 * Options shared by `check` and `checkPage`. Each one mirrors a `rampa check` flag;
 * what is not set falls back to rampa.config.*, then to the CLI's default.
 */
export interface RampaOptions {
  /** WCAG criteria to judge, such as ['1.1.1', '2.4.4'] or '1.1.1,2.4.4'. Default: all six. axe-core runs every WCAG A/AA rule of the target version either way. */
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
  /** Candidates per criterion and page the model judges at most, like --max-candidates; the rest are counted as not judged. Default 50; 0 for no cap. */
  maxCandidates?: number | undefined
  /** Seconds after a page starts being read when Rampa stops asking the model and reports what was judged, like --time-limit. Default: no limit. */
  timeLimit?: number | undefined
  /** The WCAG version reports state coverage against, like --wcag: '2.2' (default) or '2.1'. */
  wcag?: WcagVersion | undefined
  /** Settings to fall back on: rampa.config.* in the working directory by default, an object of your own, or false for none. */
  config?: RampaConfig | false | undefined
  /** Advisory profiles, like --profile: ['cognitive'] adds report.advisory, which never changes findings. Default: the config's. */
  profiles?: readonly string[] | undefined
}

export interface Settings extends CheckOptions {
  /** Images are captured only when a criterion that needs vision will be judged. */
  captureImages: boolean
  /** The time limit per page in milliseconds; each check turns it into a `deadline` when it starts reading the page. */
  timeLimitMs?: number | undefined
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
    maxCandidates: count(options.maxCandidates ?? config.maxCandidates, 'maxCandidates'),
    timeLimitMs: seconds(options.timeLimit ?? config.timeLimit),
    wcag: wcagSetting(options.wcag ?? config.wcag),
    waivers: await waiversFrom(options.waivers),
    profiles: resolveProfiles(undefined, options.profiles ?? config.profiles),
    coga: config.coga,
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

function wcagSetting(value: string | undefined): WcagVersion {
  if (value === undefined) return DEFAULT_WCAG
  const version = parseWcagVersion(String(value))
  if (!version) throw new RampaError('invalid-option', `wcag must be '2.1' or '2.2'. Got "${String(value)}".`)
  return version
}

/** A cap of zero or more, or undefined for Rampa's default. */
function count(value: number | undefined, name: string): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isSafeInteger(value) || value < 0) throw new RampaError('invalid-option', `${name} must be a whole number of at least 0. Got "${String(value)}".`)
  return value
}

/** A time limit in seconds, as milliseconds; undefined when none is set. */
function seconds(value: number | undefined): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isFinite(value) || value <= 0) throw new RampaError('invalid-option', `timeLimit must be a number of seconds above 0. Got "${String(value)}".`)
  return Math.round(value * 1000)
}

/** The moment a page's time limit runs out, counted from now. */
export function deadlineOf(settings: Settings): number | undefined {
  return settings.timeLimitMs === undefined ? undefined : Date.now() + settings.timeLimitMs
}

function whole(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value >= 1 ? Math.floor(value) : fallback
}
