import { randomBytes } from 'node:crypto'
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const exists = (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false,
  )

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
      // Written to a file of its own in the same folder, then renamed over the entry: a run stopped mid-write, or a
      // reader in another run, never sees half a judgment.
      const path = pathOf(key)
      const temp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
      await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
      try {
        await rename(temp, path)
      } catch (error) {
        await rm(temp, { force: true })
        // On Windows the rename fails while another run writes or reads the same entry. Its judgment has the same key,
        // so it is the same question: theirs stands.
        if (!(await exists(path))) throw error
      }
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
