import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { WAIVERS_FILE, activeFingerprints, readWaivers, today } from './adoption/waivers.ts'
import type { CogaSettings } from './advisory/check.ts'
import type { Confidence } from './core/types.ts'
import type { Reasoning } from './providers/ai-sdk.ts'
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
  runs?: number
  locale?: 'en' | 'pt-BR'
  minConfidence?: Confidence
  /** Reasoning effort for the model; local models default to none. */
  reasoning?: Reasoning
  /** Intro animation. */
  motion?: boolean
  cacheDir?: string
  concurrency?: number
  /** Advisory profiles run on top of the WCAG check, like --profile: ['cognitive'] (docs/cognitive-profile.md). */
  profiles?: string[]
  /** Settings of the cognitive profile: abbreviations the project treats as known, its glossary, and whether it is a public body. */
  coga?: Omit<CogaSettings, 'dictionaries'>
}

export function defineConfig(config: RampaConfig): RampaConfig {
  return config
}

export const FILES = ['rampa.config.ts', 'rampa.config.mts', 'rampa.config.js', 'rampa.config.mjs', 'rampa.config.json']

export async function loadConfig(cwd = process.cwd()): Promise<{ config: RampaConfig; path?: string }> {
  for (const file of FILES) {
    const path = join(cwd, file)
    try {
      await access(path)
    } catch {
      continue
    }
    try {
      if (file.endsWith('.json')) return { config: JSON.parse(await readFile(path, 'utf8')) as RampaConfig, path }
      const module = (await import(pathToFileURL(path).href)) as { default?: RampaConfig }
      return { config: module.default ?? {}, path }
    } catch (error) {
      throw new RampaError('invalid-config', `Could not load ${file}: ${errorMessage(error)}`)
    }
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
