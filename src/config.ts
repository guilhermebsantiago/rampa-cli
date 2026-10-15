import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { z } from 'zod'
import { WAIVERS_FILE, activeFingerprints, readWaivers, today } from './adoption/waivers.ts'
import type { CogaSettings } from './advisory/check.ts'
import { PROFILES } from './advisory/types.ts'
import { CONFIDENCE_LEVELS } from './core/gate.ts'
import type { Confidence } from './core/types.ts'
import { REASONING_LEVELS, type Reasoning } from './providers/ai-sdk.ts'
import { RampaError, errorMessage } from './core/util.ts'

export interface RampaConfig {
  /** What rampa check and rampa baseline check when no target is given: URLs, .html files, folders or snapshot .json files. */
  targets?: string[]
  /** A baseline file from rampa baseline: rampa check then reports only the findings it does not have. */
  baseline?: string
  /** The waivers file, `.rampa/waivers.json` by default. */
  waivers?: string
  /** `provider:model`, e.g. `ollama:gemma4:12b`. */
  model?: string
  criteria?: string[]
  /** The WCAG version reports state coverage against: '2.2' (default) or '2.1'. */
  wcag?: '2.1' | '2.2'
  runs?: number
  locale?: 'en' | 'pt-BR'
  minConfidence?: Confidence
  /** Reasoning effort for the model; local models default to none. */
  reasoning?: Reasoning
  /** Intro animation. */
  motion?: boolean
  cacheDir?: string
  concurrency?: number
  /** Candidates per criterion and page the model judges at most, like --max-candidates; 0 for no cap. */
  maxCandidates?: number
  /** Seconds after a page starts loading when Rampa stops asking the model and reports what was judged, like --time-limit. */
  timeLimit?: number
  /**
   * The fast preset for CI and pre-commit hooks, like --fast (docs/performance.md): fewer candidates per criterion, no link
   * following, no contrast from pixels, fewer image captures, a shorter wait after load. What this file or the command
   * line sets keeps its value; --no-fast turns it off for one run.
   */
  fast?: boolean
  /** Batched judgment, like --batch: several candidates per model call where the criterion allows it. Default: on with fast only. */
  batch?: boolean
  /**
   * Sets of pages for the criteria that compare pages (3.2.3, 3.2.6), by name: path patterns
   * in robots.txt syntax, as --include. Pages in no named set are grouped by template.
   */
  pageSets?: Record<string, string[]>
  /** Advisory profiles run on top of the WCAG check, like --profile: ['cognitive'] (docs/cognitive-profile.md). */
  profiles?: string[]
  /** Settings of the cognitive profile: abbreviations the project treats as known, its glossary, and whether it is a public body. */
  coga?: Omit<CogaSettings, 'dictionaries'>
}

export function defineConfig(config: RampaConfig): RampaConfig {
  return config
}

export const FILES = ['rampa.config.ts', 'rampa.config.mts', 'rampa.config.js', 'rampa.config.mjs', 'rampa.config.json']

const strings = z.array(z.string())
const whole = (min: number) => z.number().int().min(min)

/**
 * What a config file may hold, checked when it loads: a value Rampa cannot use, or a key it does not know, stops the run
 * with exit 2 instead of being ignored. An unknown `minConfidence` used to put every finding below the threshold, and a
 * misspelled key did nothing, both silently, so a CI gate passed whatever the page had.
 */
const CONFIG_SCHEMA = z.strictObject({
  targets: strings.optional(),
  baseline: z.string().optional(),
  waivers: z.string().optional(),
  model: z.string().optional(),
  // A comma-separated string, as --criteria takes it, is read as the list.
  criteria: z.union([strings, z.string().transform((value) => value.split(',').map((id) => id.trim()))]).optional(),
  // 2.2 written as a number is read as '2.2'.
  wcag: z.preprocess((value) => (typeof value === 'number' ? String(value) : value), z.enum(['2.1', '2.2'])).optional(),
  runs: whole(1).optional(),
  locale: z
    .enum(['en', 'pt-BR', 'pt-br', 'pt'])
    .transform((value): 'en' | 'pt-BR' => (value === 'en' ? 'en' : 'pt-BR'))
    .optional(),
  minConfidence: z.enum(CONFIDENCE_LEVELS).optional(),
  reasoning: z.enum(REASONING_LEVELS).optional(),
  motion: z.boolean().optional(),
  cacheDir: z.string().optional(),
  concurrency: whole(1).optional(),
  maxCandidates: whole(0).optional(),
  timeLimit: z.number().positive().optional(),
  fast: z.boolean().optional(),
  batch: z.boolean().optional(),
  // Checked again, with an example, when a crawl reads it (site/index.ts, pageSetsOf).
  pageSets: z.record(z.string(), z.union([z.string(), strings])).optional(),
  profiles: z.array(z.enum(PROFILES)).optional(),
  coga: z
    .strictObject({
      abbreviations: z.strictObject({ known: strings.optional(), glossaryUrl: z.string().optional() }).optional(),
      publicSector: z.boolean().optional(),
      // Seconds the live page is watched with no input; 0 or false turns the observation off.
      observe: z.union([z.number().min(0).max(120), z.literal(false)]).optional(),
    })
    .optional(),
})

/** Settings a config file cannot hold, with where they go instead. */
const ELSEWHERE: Record<string, string> = {
  failOn: 'the gate is set with --fail-on on the command line, or the action input fail-on',
  verbose: 'pass --verbose on the command line',
  format: 'pass --format on the command line',
}

/**
 * Checks a loaded config against what Rampa reads: a wrong value or an unknown key throws an `invalid-config` error that
 * names the key and what it takes.
 */
export function validateConfig(value: unknown, file = 'the config'): RampaConfig {
  const result = CONFIG_SCHEMA.safeParse(value)
  if (result.success) return result.data as RampaConfig
  throw new RampaError('invalid-config', `${file}: ${result.error.issues.map((issue) => describeIssue(issue, value)).join(' ')}`)
}

function describeIssue(issue: z.core.$ZodIssue, config: unknown): string {
  const path = issue.path.map(String)
  const key = path.join('.') || 'the config'
  let at: unknown = config
  for (const part of issue.path) at = at && typeof at === 'object' ? (at as Record<PropertyKey, unknown>)[part] : undefined
  const got = JSON.stringify(at) ?? String(at)
  switch (issue.code) {
    case 'unrecognized_keys': {
      const where = path.length === 0 ? 'a config' : `"${key}"`
      return issue.keys
        .map((name) => {
          const hint = path.length === 0 ? ELSEWHERE[name] : undefined
          return `unknown key "${[...path, name].join('.')}"${hint ? ` (${hint})` : ''}; the keys ${where} may hold are ${keysAt(path).join(', ')}.`
        })
        .join(' ')
    }
    case 'invalid_value':
      return `${key} is ${got}; allowed values are ${issue.values.map(String).join(', ')}.`
    case 'invalid_type': {
      const expected = issue.expected === 'int' ? 'a whole number' : /^[aeiou]/.test(issue.expected) ? `an ${issue.expected}` : `a ${issue.expected}`
      return `${key} is ${got}; it must be ${expected}.`
    }
    case 'too_small':
      return `${key} is ${got}; it must be ${issue.inclusive ? 'at least' : 'above'} ${String(issue.minimum)}.`
    default:
      return `${key}: ${issue.message}.`
  }
}

/** The keys of the object at a path of the schema: the top level's, or coga's. */
function keysAt(path: readonly string[]): string[] {
  const unwrap = (schema: z.ZodType): z.ZodType => (schema instanceof z.ZodOptional ? (schema.unwrap() as z.ZodType) : schema)
  let schema: z.ZodType = CONFIG_SCHEMA
  for (const part of path) {
    const object = unwrap(schema)
    schema = object instanceof z.ZodObject ? ((object.shape as Record<string, z.ZodType>)[part] ?? z.never()) : z.never()
  }
  const object = unwrap(schema)
  return object instanceof z.ZodObject ? Object.keys(object.shape) : []
}

export async function loadConfig(cwd = process.cwd()): Promise<{ config: RampaConfig; path?: string }> {
  for (const file of FILES) {
    const path = join(cwd, file)
    try {
      await access(path)
    } catch {
      continue
    }
    let loaded: unknown
    try {
      if (file.endsWith('.json')) loaded = JSON.parse(await readFile(path, 'utf8'))
      else loaded = ((await import(pathToFileURL(path).href)) as { default?: unknown }).default ?? {}
    } catch (error) {
      throw new RampaError('invalid-config', `Could not load ${file}: ${errorMessage(error)}`)
    }
    return { config: validateConfig(loaded, file), path }
  }
  return { config: {} }
}

/**
 * Fingerprints of the waivers that apply today. Entries may be bare fingerprints or objects with a
 * reason and an expiry date (see adoption/waivers.ts); expired and invalid ones do not apply.
 */
export async function loadWaivers(path = WAIVERS_FILE): Promise<Set<string>> {
  return activeFingerprints(await readWaivers(path), today())
}
