import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Confidence } from './core/types.ts'
import type { Reasoning } from './providers/ai-sdk.ts'
import { RampaError, errorMessage } from './core/util.ts'

export interface RampaConfig {
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
}

export function defineConfig(config: RampaConfig): RampaConfig {
  return config
}

const FILES = ['rampa.config.ts', 'rampa.config.mts', 'rampa.config.js', 'rampa.config.mjs', 'rampa.config.json']

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

export async function loadWaivers(path = '.rampa/waivers.json'): Promise<Set<string>> {
  try {
    const entries = JSON.parse(await readFile(path, 'utf8')) as Array<{ fingerprint: string }>
    return new Set(entries.map((entry) => entry.fingerprint))
  } catch {
    return new Set()
  }
}
