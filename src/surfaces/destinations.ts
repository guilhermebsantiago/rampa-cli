import { mkdir, open, readFile, stat, writeFile } from 'node:fs/promises'
import { isIP } from 'node:net'
import { dirname, extname, isAbsolute, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { errorMessage, mapLimit, sha256, truncate } from '../core/util.ts'
import { type A11yNode, type Destination, DestinationSchema } from '../snapshot/schema.ts'
import { VERSION } from '../version.ts'

/**
 * Follows a page's links one level deep and records what each address leads to, for WCAG 2.4.4:
 * an HTML page's title, first heading and description, or a file's type and size. The facts go
 * into the snapshot, so criteria never fetch anything and a saved snapshot replays offline.
 */

export const FOLLOW_LINKS = ['none', 'same-origin', 'all'] as const
export type FollowLinks = (typeof FOLLOW_LINKS)[number]

export interface FollowLimits {
  /** Distinct addresses read per page; the rest stay unread. */
  maxLinks: number
  /** Per address, redirects included. */
  timeoutMs: number
  /** Bytes read from an HTML page: the title, heading and description come early. */
  maxBytes: number
  maxRedirects: number
  /** Addresses read at the same time. */
  concurrency: number
}

export const FOLLOW_LIMITS: FollowLimits = { maxLinks: 40, timeoutMs: 8000, maxBytes: 512 * 1024, maxRedirects: 5, concurrency: 4 }

/** Says who is asking and why, so a site owner who sees it in a log can find out. */
export const USER_AGENT = `Rampa/${VERSION} (+https://github.com/guilhermebsantiago/rampa-cli; reads where a link leads for a WCAG 2.4.4 check)`

export interface FollowOptions {
  policy: FollowLinks
  /** Shared by the pages of one run, so a link in every page's menu is read once. */
  cache?: DestinationCache | undefined
  /** Folders a local page's links may be read from; by default the working directory and the page's own folder. */
  roots?: readonly string[] | undefined
  limits?: Partial<FollowLimits> | undefined
  /** Injected by tests; the global fetch otherwise. */
  fetch?: typeof fetch | undefined
}

/**
 * Reads the links of a collected page and returns what each address leads to, keyed by the href as written.
 * `base` is the address the page's relative links resolve against (its document.baseURI).
 * Only visible links with a name are followed, the ones outside the page's menus, header and footer first.
 */
export async function followLinks(root: A11yNode, base: string, options: FollowOptions): Promise<Record<string, Destination>> {
  const page = parseUrl(base)
  if (options.policy === 'none' || !page) return {}
  const limits = { ...FOLLOW_LIMITS, ...options.limits }
  const cache = options.cache ?? destinationCache()
  const roots = options.roots ?? defaultRoots(page)
  const read = options.fetch ?? fetch

  const found: Record<string, Destination> = {}
  const queue: Array<{ href: string; url: URL }> = []
  const addresses = new Set<string>()
  for (const href of linkHrefs(root)) {
    const url = parseUrl(href, page.href)
    if (!url) continue
    if (withoutHash(url) === withoutHash(page)) {
      // "#part" links are resolved from the snapshot itself; only a spelled-out address to this page needs the mark.
      if (!href.trim().startsWith('#')) found[href] = { kind: 'same-page' }
      continue
    }
    if (!allowed(url, page, options.policy, roots)) continue
    if (!addresses.has(url.href)) {
      if (addresses.size >= limits.maxLinks) continue
      addresses.add(url.href)
    }
    queue.push({ href, url })
  }

  const paused = cache.paused ?? new Set<string>()
  const destinations = await mapLimit(queue, limits.concurrency, ({ url }) =>
    cache.read(url.href, () => (url.protocol === 'file:' ? readFileDestination(url, limits) : readWebDestination(url, page, limits, read, paused))),
  )
  queue.forEach(({ href }, i) => {
    const destination = destinations[i]
    if (destination) found[href] = destination
  })
  return found
}

export interface DestinationCache {
  /** What an absolute address leads to, read at most once per run. */
  read(url: string, load: () => Promise<Destination>): Promise<Destination>
  /** Origins that answered 429 or 503 during the run: they are not asked again until the next run. */
  paused?: Set<string> | undefined
}

/** Answers worth keeping for an hour; a timeout, a 429 or a server error may be gone on the next run. */
const LASTING_STATUSES = new Set([401, 404, 410])

/**
 * Remembers every address for the run. Given a folder, it also keeps what web pages returned for `ttlMs`
 * (an hour by default), so a second run neither asks the sites again nor changes the prompts, and with them
 * the cached judgments. Local files and local servers are read again every run: they change while you work.
 */
export function destinationCache(options: { dir?: string | undefined; ttlMs?: number | undefined } = {}): DestinationCache {
  const memory = new Map<string, Promise<Destination>>()
  const ttlMs = options.ttlMs ?? 60 * 60 * 1000
  const dir = options.dir
  return {
    paused: new Set<string>(),
    read(url, load) {
      let pending = memory.get(url)
      if (!pending) {
        pending = (async () => {
          const path = dir !== undefined && keepsOnDisk(url) ? join(dir, `${sha256(url).slice(0, 32)}.json`) : undefined
          if (path) {
            const stored = await readStored(path, url, ttlMs)
            if (stored) return stored
          }
          const destination = await load()
          const lasting = destination.kind !== 'unreadable' || LASTING_STATUSES.has(destination.status ?? 0)
          if (path && lasting) {
            await mkdir(dirname(path), { recursive: true })
              .then(() => writeFile(path, `${JSON.stringify({ url, readAt: new Date().toISOString(), destination }, null, 2)}\n`, 'utf8'))
              .catch(() => undefined)
          }
          return destination
        })()
        memory.set(url, pending)
      }
      return pending
    },
  }
}

async function readStored(path: string, url: string, ttlMs: number): Promise<Destination | undefined> {
  try {
    const stored = JSON.parse(await readFile(path, 'utf8')) as { url?: unknown; readAt?: unknown; destination?: unknown }
    if (stored.url !== url || typeof stored.readAt !== 'string' || Date.now() - Date.parse(stored.readAt) > ttlMs) return undefined
    const parsed = DestinationSchema.safeParse(stored.destination)
    return parsed.success ? parsed.data : undefined
  } catch {
    return undefined
  }
}

function keepsOnDisk(url: string): boolean {
  const parsed = parseUrl(url)
  return parsed !== undefined && (parsed.protocol === 'http:' || parsed.protocol === 'https:') && !isPrivateHost(parsed.hostname)
}

const CHROME_ROLES = new Set(['navigation', 'banner', 'contentinfo'])

/** Hrefs of the visible, named links: those in the content first, then those in menus, header and footer, each in page order. */
function linkHrefs(root: A11yNode): string[] {
  const content: string[] = []
  const chrome: string[] = []
  const visit = (node: A11yNode, inChrome: boolean): void => {
    if (node.states.includes('hidden') || node.states.includes('aria-hidden')) return
    const here = inChrome || CHROME_ROLES.has(node.role)
    const href = (node.native.attributes as Record<string, string> | undefined)?.href
    if (node.role === 'link' && node.name?.trim() && href?.trim()) (here ? chrome : content).push(href)
    for (const child of node.children) visit(child, here)
  }
  visit(root, false)
  return [...new Set([...content, ...chrome])]
}

/**
 * none: nothing. same-origin: pages of the checked page's own site, or, for a local page, local files.
 * all: also other sites, never an address on this machine or the local network unless the page is on one.
 */
function allowed(url: URL, page: URL, policy: FollowLinks, roots: readonly string[]): boolean {
  if (policy === 'none') return false
  if (url.protocol === 'file:') return page.protocol === 'file:' && insideRoots(url, roots)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  if (page.protocol !== 'file:' && url.origin === page.origin) return true
  if (policy !== 'all') return false
  return !isPrivateHost(url.hostname) || (page.protocol !== 'file:' && isPrivateHost(page.hostname))
}

function defaultRoots(page: URL): string[] {
  const roots = [process.cwd()]
  if (page.protocol === 'file:') {
    try {
      roots.push(dirname(fileURLToPath(page)))
    } catch {
      // not a local path after all
    }
  }
  return roots
}

function insideRoots(url: URL, roots: readonly string[]): boolean {
  let path: string
  try {
    path = fileURLToPath(url)
  } catch {
    return false
  }
  return roots.some((root) => {
    const rel = relative(root, path)
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
  })
}

/** Loopback, private, link-local and shared ranges, and names that only resolve inside a network. */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (host === 'localhost' || /\.(localhost|local|internal|home\.arpa|lan)$/.test(host)) return true
  const version = isIP(host)
  if (version === 4) {
    const [a = 0, b = 0] = host.split('.').map(Number)
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
  }
  if (version === 6) {
    if (host === '::1' || host === '::') return true
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(host)?.[1]
    if (mapped) return isPrivateHost(mapped)
    return /^(fc|fd|fe[89ab])/.test(host)
  }
  return false
}

async function readWebDestination(url: URL, page: URL, limits: FollowLimits, read: typeof fetch, paused: Set<string>): Promise<Destination> {
  const signal = AbortSignal.timeout(limits.timeoutMs)
  // No cookies and no credentials: a link is read as a stranger would see it.
  const headers = { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5' }
  let current = url
  try {
    for (let hop = 0; ; hop++) {
      // A site that asked to slow down is left alone for the rest of the run.
      if (paused.has(current.origin)) return unreadable('the site asked to slow down')
      const response = await read(withoutHash(current), { redirect: 'manual', signal, headers })
      if (response.status === 429 || response.status === 503) paused.add(current.origin)
      const location = response.status >= 300 && response.status < 400 ? response.headers.get('location') : null
      let target = location
      if (location) await discard(response)
      else {
        // A page that refreshes to another address at once is a redirect too, as browsers and ACT treat it.
        const { destination, refresh } = await describeResponse(response, url, current, limits)
        if (!refresh) return destination
        target = refresh
      }
      if (hop >= limits.maxRedirects) return unreadable('too many redirects', response.status)
      const next = parseUrl(target ?? '', current.href)
      if (!next || (next.protocol !== 'http:' && next.protocol !== 'https:')) return unreadable('redirects outside the web', response.status)
      if (isPrivateHost(next.hostname) && !isPrivateHost(page.hostname)) return unreadable('redirects to a private address', response.status)
      if (!next.hash && current.hash) next.hash = current.hash
      current = next
    }
  } catch (error) {
    return unreadable(failureReason(error))
  }
}

async function describeResponse(
  response: Response,
  requested: URL,
  final: URL,
  limits: FollowLimits,
): Promise<{ destination: Destination; refresh?: string | undefined }> {
  const status = response.status
  const finalUrl = withoutHash(final) !== withoutHash(requested) ? final.href : undefined
  if (status < 200 || status >= 300) {
    await discard(response)
    const reason = status === 401 || status === 407 ? 'sign-in' : status === 404 || status === 410 ? 'not found' : status === 403 ? 'forbidden' : `HTTP ${status}`
    return { destination: unreadable(reason, status, finalUrl) }
  }
  // A page that sends people to a sign-in, or back to the home page, shows nothing of what the link promised.
  if (finalUrl && signInAddress(final) && !signInAddress(requested)) {
    await discard(response)
    return { destination: unreadable('sign-in', status, finalUrl) }
  }
  if (finalUrl && final.host === requested.host && final.pathname === '/' && requested.pathname !== '/') {
    await discard(response)
    return { destination: unreadable('redirects to the home page', status, finalUrl) }
  }
  const header = response.headers.get('content-type')
  const contentType = header?.split(';')[0]?.trim().toLowerCase() || undefined
  const length = Number.parseInt(response.headers.get('content-length') ?? '', 10)
  const bytes = Number.isFinite(length) && length >= 0 ? length : undefined
  if (contentType && !HTML_TYPES.has(contentType)) {
    await discard(response)
    return { destination: { kind: 'file', status, finalUrl, contentType, bytes } }
  }
  const body = await readLimited(response.body, limits.maxBytes)
  const html = decode(body, charsetOf(header, body))
  if (!contentType && !/<(!doctype html|html|head|title|body)\b/i.test(html.slice(0, 2048))) return { destination: { kind: 'file', status, finalUrl, bytes } }
  const destination: Destination = { kind: 'page', status, finalUrl, contentType: contentType ?? 'text/html', ...htmlFacts(html, final.hash || requested.hash) }
  return { destination, refresh: instantRefresh(html) }
}

/** The address of a <meta http-equiv="refresh"> that fires at once ("0; url=..."), the only kind that counts as a redirect. */
export function instantRefresh(html: string): string | undefined {
  for (const [tag] of html.replace(/<!--[\s\S]*?-->/g, ' ').matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = attributesOf(tag)
    if (attributes['http-equiv']?.toLowerCase() !== 'refresh') continue
    const match = /^\s*(\d+(?:\.\d+)?)\s*[;,]\s*(?:url\s*=\s*)?(.+?)\s*$/i.exec(decodeEntities(attributes.content ?? ''))
    if (!match?.[1] || !match[2] || Number(match[1]) !== 0) return undefined
    return match[2].replace(/^(['"])(.*)\1$/, '$2').trim() || undefined
  }
  return undefined
}

const HTML_TYPES = new Set(['text/html', 'application/xhtml+xml'])

/** Paths such as /login, /users/sign_in, /auth or /sso, where sites send people who are not signed in. */
function signInAddress(url: URL): boolean {
  return /(^|[/_.-])(log[-_]?in|sign[-_]?in|auth|sso|cas|saml|oauth2?)([/_.-]|$)/i.test(url.pathname)
}

async function readFileDestination(url: URL, limits: FollowLimits): Promise<Destination> {
  try {
    let path = fileURLToPath(url)
    let info = await stat(path)
    // A link to a folder opens its index page, as a local web server would.
    if (info.isDirectory()) {
      path = join(path, 'index.html')
      info = await stat(path)
    }
    const extension = extname(path).toLowerCase()
    if (!['.html', '.htm', '.xhtml'].includes(extension)) return { kind: 'file', contentType: FILE_TYPES[extension], bytes: info.size }
    const handle = await open(path, 'r')
    try {
      const buffer = Buffer.alloc(Math.min(limits.maxBytes, info.size))
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
      const body = buffer.subarray(0, bytesRead)
      return { kind: 'page', contentType: 'text/html', ...htmlFacts(decode(body, charsetOf(null, body)), url.hash) }
    } finally {
      await handle.close()
    }
  } catch (error) {
    return unreadable((error as { code?: string }).code === 'ENOENT' ? 'not found' : errorMessage(error))
  }
}

/** Types of the files pages link to most, for local files, which have no Content-Type. */
const FILE_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.epub': 'application/epub+zip',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.zip': 'application/zip',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.odt': 'application/vnd.oasis.opendocument.text',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
}

/**
 * The parts of an HTML page that say what it is: the title, the first h1, the meta description and,
 * for an address with a #fragment, the text where the fragment points. Scripts, styles and comments never count.
 */
export function htmlFacts(html: string, fragment?: string): Pick<Destination, 'title' | 'heading' | 'description' | 'section'> {
  const clean = html.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style|template|noscript|svg)\b[\s\S]*?<\/\1\s*>/gi, ' ')
  const meta = metaContents(clean)
  const title = textOf(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(clean)?.[1]) || meta['og:title']
  const heading = textOf(/<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/i.exec(clean)?.[1])
  const description = meta.description || meta['og:description']
  const section = fragment && fragment !== '#' ? sectionText(clean, fragment.replace(/^#/, '')) : undefined
  return {
    title: clip(title, 200),
    heading: clip(heading, 200),
    description: clip(description, 300),
    section: clip(section, 200),
  }
}

function metaContents(html: string): Record<string, string> {
  const contents: Record<string, string> = {}
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = attributesOf(tag)
    const key = (attributes.name ?? attributes.property ?? '').toLowerCase()
    const content = textOf(attributes.content)
    if (key && content && contents[key] === undefined) contents[key] = content
  }
  return contents
}

function attributesOf(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {}
  for (const match of tag.matchAll(/([^\s=/<>"']+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+))/g)) {
    const name = match[1]?.toLowerCase()
    if (name && attributes[name] === undefined) attributes[name] = match[2] ?? match[3] ?? match[4] ?? ''
  }
  return attributes
}

/** The text where a fragment points: a heading's own text, or the first words from the element on. */
function sectionText(html: string, fragment: string): string | undefined {
  let id = fragment
  try {
    id = decodeURIComponent(fragment)
  } catch {
    // keep it as written
  }
  if (id === '') return undefined
  const value = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const start = new RegExp(`<([a-zA-Z][\\w:-]*)\\b[^>]*?\\s(?:[iI][dD]|[nN][aA][mM][eE])\\s*=\\s*(?:"${value}"|'${value}'|${value}(?=[\\s/>]))[^>]*>`).exec(html)
  if (!start) return undefined
  const after = html.slice(start.index + start[0].length)
  const tag = start[1]?.toLowerCase() ?? ''
  if (/^h[1-6]$/.test(tag)) return textOf(new RegExp(`^([\\s\\S]*?)</${tag}\\s*>`, 'i').exec(after)?.[1]) || undefined
  // A section, or an empty anchor, that opens with a heading is named by that heading.
  const heading = /^\s*(?:<\/[a-zA-Z][\w:-]*\s*>\s*)*<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1\s*>/i.exec(after)?.[2]
  if (heading && textOf(heading)) return textOf(heading)
  return textOf(after.slice(0, 4000)) || undefined
}

/** Visible words of an HTML fragment: images by their alt, tags removed, entities decoded, spaces collapsed. */
function textOf(fragment: string | undefined): string {
  if (!fragment) return ''
  return decodeEntities(
    fragment
      .replace(/<img\b[^>]*>/gi, (tag) => ` ${attributesOf(tag).alt ?? ''} `)
      .replace(/<[^>]*>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim()
}

function clip(value: string | undefined, max: number): string | undefined {
  return value ? truncate(value, max) : undefined
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  laquo: '«',
  raquo: '»',
  middot: '·',
  bull: '•',
  copy: '©',
  reg: '®',
  trade: '™',
  euro: '€',
  pound: '£',
  szlig: 'ß',
}
const ACCENTS: Record<string, string> = { acute: '́', grave: '̀', circ: '̂', tilde: '̃', uml: '̈', cedil: '̧', ring: '̊' }

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code.startsWith('#')) {
      const point = code[1] === 'x' || code[1] === 'X' ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10)
      return Number.isFinite(point) && point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : whole
    }
    const named = ENTITIES[code] ?? ENTITIES[code.toLowerCase()]
    if (named) return named
    const accented = /^([a-zA-Z])(acute|grave|circ|tilde|uml|cedil|ring)$/.exec(code)
    const mark = accented?.[2] ? ACCENTS[accented[2]] : undefined
    return accented?.[1] && mark ? `${accented[1]}${mark}`.normalize('NFC') : whole
  })
}

function charsetOf(contentType: string | null, body: Uint8Array): string {
  const declared = /charset\s*=\s*["']?([\w.:-]+)/i.exec(contentType ?? '')?.[1]
  if (declared) return declared
  const head = new TextDecoder('latin1').decode(body.subarray(0, 2048))
  return /<meta\b[^>]*charset\s*=\s*["']?([\w.:-]+)/i.exec(head)?.[1] ?? 'utf-8'
}

function decode(body: Uint8Array, charset: string): string {
  try {
    return new TextDecoder(charset).decode(body)
  } catch {
    return new TextDecoder().decode(body)
  }
}

async function readLimited(body: ReadableStream<Uint8Array> | null, max: number): Promise<Uint8Array> {
  if (!body) return new Uint8Array()
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (size < max) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      size += value.byteLength
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
  const all = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    all.set(chunk, offset)
    offset += chunk.byteLength
  }
  return all.subarray(0, max)
}

async function discard(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined)
}

function unreadable(reason: string, status?: number, finalUrl?: string): Destination {
  return { kind: 'unreadable', reason, status, finalUrl }
}

function failureReason(error: unknown): string {
  const name = (error as { name?: string } | undefined)?.name
  if (name === 'TimeoutError' || name === 'AbortError') return 'timeout'
  const code = (error as { cause?: { code?: string } } | undefined)?.cause?.code
  return code ?? errorMessage(error)
}

function parseUrl(value: string, base?: string): URL | undefined {
  try {
    return new URL(value.trim(), base)
  } catch {
    return undefined
  }
}

function withoutHash(url: URL): string {
  return url.href.replace(/#.*$/, '')
}
