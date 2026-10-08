import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface CachedJudgment {
  output: unknown
  inputTokens: number
  outputTokens: number
  latencyMs: number
  modelId: string
  createdAt: string
}

export interface JudgmentCache {
  get(key: string): Promise<CachedJudgment | undefined>
  set(key: string, value: CachedJudgment): Promise<void>
}

/** One JSON file per judgment, so the cache can be inspected, diffed and committed as fixtures. */
export function fileCache(dir: string): JudgmentCache {
  let ready: Promise<unknown> | undefined
  const pathOf = (key: string) => join(dir, key.slice(0, 2), `${key}.json`)
  return {
    async get(key) {
      try {
        return JSON.parse(await readFile(pathOf(key), 'utf8')) as CachedJudgment
      } catch {
        return undefined
      }
    },
    async set(key, value) {
      ready ??= mkdir(dir, { recursive: true })
      await ready
      await mkdir(join(dir, key.slice(0, 2)), { recursive: true })
      await writeFile(pathOf(key), `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    },
  }
}

export function memoryCache(): JudgmentCache {
  const entries = new Map<string, CachedJudgment>()
  return {
    async get(key) {
      return entries.get(key)
    },
    async set(key, value) {
      entries.set(key, value)
    },
  }
}
