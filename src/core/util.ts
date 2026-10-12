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

const closingTags = new Map<string, RegExp>()

/**
 * Page data for a prompt block that `tag` delimits (`<content>…</content>`, `<text>…</text>`), with every closing tag of
 * that name in it escaped as `<\/content>`. A page that writes `</text>` then cannot end its block and go on outside it,
 * where the model is no longer told that what it reads is page data. Data with no such tag, as on nearly every page, is
 * returned exactly as it is, so its prompt and its cache key stay the same. Other tags are left alone: an element's
 * markup inside <content> may hold an SVG `</text>` or a `</label>`, and those prompts stay the same too.
 */
export function pageData(tag: string, data: string): string {
  let closing = closingTags.get(tag)
  if (!closing) {
    // `</text>`, `</TEXT >`, `< / text>`: whatever a model may read as the end of the block. Not `</textarea>`.
    closing = new RegExp(`(<\\s*)/(\\s*${tag.replace(/[^\w-]/g, '')}(?![\\w-]))`, 'gi')
    closingTags.set(tag, closing)
  }
  return data.replace(closing, '$1\\/$2')
}

/** Page data inline in its tag: `<tag>data</tag>`, the data through pageData. */
export function tagged(tag: string, data: string): string {
  return `<${tag}>${pageData(tag, data)}</${tag}>`
}

/** A block of page data as prompt lines: `<tag>`, each line through pageData, `</tag>`. Undefined lines stay as they are. */
export function dataBlock<Line extends string | undefined>(tag: string, lines: readonly Line[]): Array<string | Line> {
  return [`<${tag}>`, ...lines.map((line) => (line === undefined ? line : pageData(tag, line))), `</${tag}>`]
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
