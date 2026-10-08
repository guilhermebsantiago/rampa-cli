import { createHash } from 'node:crypto'

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

/** Normalization used when checking that quoted evidence exists in the source text. */
export function normalizeForMatch(input: string): string {
  return input
    .normalize('NFKC')
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

export function letterCount(input: string): number {
  return input.match(/\p{L}/gu)?.length ?? 0
}

export function truncate(input: string, max: number): string {
  return input.length <= max ? input : `${input.slice(0, max - 1)}…`
}

export function primarySubtag(tag: string): string {
  return tag.split('-')[0]?.toLowerCase() ?? ''
}

export function canonicalLanguageTag(tag: string): string | undefined {
  try {
    return Intl.getCanonicalLocales(tag.trim())[0]
  } catch {
    return undefined
  }
}

/** Runs `worker` over `items` with at most `limit` in flight, keeping result order. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await worker(items[index] as T, index)
    }
  })
  await Promise.all(runners)
  return results
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.split('\n')[0] ?? error.message
  return String(error)
}

export class RampaError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'RampaError'
    this.code = code
  }
}
