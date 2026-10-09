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
    wcag: config.wcag === undefined ? undefined : String(config.wcag),
    runs: config.runs === undefined ? undefined : String(config.runs),
    cacheDir: config.cacheDir,
    concurrency: config.concurrency === undefined ? undefined : String(config.concurrency),
    maxCandidates: config.maxCandidates === undefined ? undefined : String(config.maxCandidates),
    timeLimit: config.timeLimit === undefined ? undefined : String(config.timeLimit),
  }
  const merged = { ...options } as Record<string, unknown>
  // Only the command's own options; one with no default (--time-limit) is unset until the command line or the file sets it.
  const defined = new Set(command.options.map((option) => option.attributeName()))
  for (const [key, value] of Object.entries(fromConfig)) {
    const source = command.getOptionValueSource(key)
    if (value !== undefined && defined.has(key) && (source === 'default' || source === undefined)) merged[key] = value
  }
  return merged as T
}
