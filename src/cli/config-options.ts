import type { Command } from 'commander'
import type { RampaConfig } from '../config.ts'

/**
 * Options the config file can set. Commander fills every option that has a default, so without
 * this the file's values never applied; with it the order is the command line, the file, then
 * Rampa's defaults.
 */
export function withConfigOptions<T extends object>(command: Command, options: T, config: RampaConfig): T {
  const fromConfig: Record<string, string | undefined> = {
    criteria: config.criteria?.join(','),
    minConfidence: config.minConfidence,
    runs: config.runs === undefined ? undefined : String(config.runs),
    cacheDir: config.cacheDir,
    concurrency: config.concurrency === undefined ? undefined : String(config.concurrency),
  }
  const merged = { ...options } as Record<string, unknown>
  for (const [key, value] of Object.entries(fromConfig)) {
    if (value !== undefined && key in merged && command.getOptionValueSource(key) === 'default') merged[key] = value
  }
  return merged as T
}
