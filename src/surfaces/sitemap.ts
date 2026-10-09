import { gunzipSync } from 'node:zlib'

/** A GET that never throws: status 0 means the request itself failed. */
export interface Fetched {
  status: number
  /** The address that answered, after redirects. */
  url: string
  body: Uint8Array
  error?: string | undefined
}

export type FetchBytes = (url: string) => Promise<Fetched>

export interface ParsedSitemap {
  /** A list of pages, a list of other sitemaps, or the plain-text form: one address per line. */
  kind: 'urlset' | 'index' | 'text'
  urls: string[]
}

/** The sitemap protocol caps a file at 50 MB uncompressed. */
const MAX_SITEMAP_BYTES = 50 * 1024 * 1024
/** Sitemap files read per crawl, index files included. */
export const MAX_SITEMAP_FILES = 20

/** The text of a sitemap, gunzipped when the bytes are gzip (a `.xml.gz` served as a file, not as Content-Encoding). */
export function sitemapText(body: Uint8Array): string {
  const bytes = body[0] === 0x1f && body[1] === 0x8b ? gunzipSync(body, { maxOutputLength: MAX_SITEMAP_BYTES }) : body
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('utf8')
}

/**
 * Reads the `<loc>` of each entry. Only the unprefixed element counts: the
 * image and video extensions add `<image:loc>` and friends, which are files,
 * not pages.
 */
export function parseSitemap(text: string): ParsedSitemap {
  const body = text.replace(/^﻿/, '').trim()
  if (!body.startsWith('<')) {
    return {
      kind: 'text',
      urls: body
        .split(/\r\n|\r|\n/)
        .map((line) => line.trim())
        .filter((line) => /^https?:\/\//i.test(line)),
    }
  }
  const kind = /<(?:[\w.-]+:)?sitemapindex[\s>]/.test(body) ? 'index' : 'urlset'
  const urls: string[] = []
  for (const match of body.matchAll(/<loc>\s*(?:<!\[CDATA\[([\s\S]*?)\]\]>|([^<]*))\s*<\/loc>/g)) {
    // CDATA is literal; only plain text has entities to decode.
    const value = match[1] !== undefined ? match[1].trim() : decodeXml((match[2] ?? '').trim())
    if (value !== '') urls.push(value)
  }
  return { kind, urls }
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

function decodeXml(value: string): string {
  return value.replace(/&(?:#(\d+)|#x([0-9a-f]+)|(amp|lt|gt|quot|apos));/gi, (whole, decimal?: string, hex?: string, name?: string) => {
    if (name) return ENTITIES[name.toLowerCase()] ?? whole
    const code = decimal ? Number.parseInt(decimal, 10) : Number.parseInt(hex ?? '', 16)
    return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
  })
}

export interface SitemapRead {
  /** Page addresses, in the order the sitemaps list them. */
  urls: string[]
  /** Sitemap files read. */
  read: string[]
  failed: Array<{ url: string; detail: string }>
}

/** Follows sitemap indexes breadth first, reading at most `maxFiles` files. */
export async function readSitemaps(starts: readonly string[], fetch: FetchBytes, maxFiles = MAX_SITEMAP_FILES): Promise<SitemapRead> {
  const queue = [...starts]
  const seen = new Set<string>()
  const result: SitemapRead = { urls: [], read: [], failed: [] }
  while (queue.length > 0 && seen.size < maxFiles) {
    const url = queue.shift() as string
    if (seen.has(url)) continue
    seen.add(url)
    const response = await fetch(url)
    if (response.status < 200 || response.status >= 300) {
      result.failed.push({ url, detail: response.status > 0 ? `HTTP ${response.status}` : (response.error ?? 'network error') })
      continue
    }
    let parsed: ParsedSitemap
    try {
      parsed = parseSitemap(sitemapText(response.body))
    } catch (error) {
      result.failed.push({ url, detail: error instanceof Error ? error.message : String(error) })
      continue
    }
    result.read.push(url)
    const resolved = parsed.urls.flatMap((loc) => {
      try {
        return [new URL(loc, response.url).href]
      } catch {
        return []
      }
    })
    if (parsed.kind === 'index') queue.push(...resolved)
    else result.urls.push(...resolved)
  }
  return result
}
