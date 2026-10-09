/**
 * robots.txt as RFC 9309 defines it. A crawl follows the group for Rampa's own
 * product token when the file has one, and the group for every crawler ("*")
 * otherwise, so a site owner can let Rampa into a staging site that turns
 * search engines away:
 *
 *   User-agent: *
 *   Disallow: /
 *
 *   User-agent: Rampa
 *   Allow: /
 */

export const ROBOTS_AGENT = 'Rampa'

/** RFC 9309 asks crawlers to read at least 500 KiB; the rest of a longer file is ignored. */
const MAX_ROBOTS_BYTES = 512 * 1024

export interface RobotsRule {
  allow: boolean
  /** The path pattern, percent-encoding normalized: `*` matches anything, a final `$` ends the path. */
  pattern: string
  regex: RegExp
}

export interface Robots {
  /** The file was read; there is none (everything allowed); or it could not be read (nothing allowed). */
  status: 'parsed' | 'missing' | 'unreachable'
  /** The group that applies: Rampa's own, the one for every crawler, or none. */
  group: 'rampa' | '*' | 'none'
  rules: RobotsRule[]
  crawlDelaySeconds?: number | undefined
  /** Sitemap lines, which apply whatever the group. */
  sitemaps: string[]
  /** Why the file could not be read: the HTTP status or the network error. */
  detail?: string | undefined
}

/**
 * What a response means for the crawl (RFC 9309, section 2.3.1): a 4xx means
 * there are no rules; a 5xx, a 429 or a network error means the crawler must
 * assume it may fetch nothing.
 */
export function robotsFromResponse(status: number, text: string, error?: string, agent = ROBOTS_AGENT): Robots {
  if (status >= 200 && status < 300) return parseRobots(text, agent)
  if (status >= 300 && status < 500 && status !== 429) return { status: 'missing', group: 'none', rules: [], sitemaps: [] }
  return { status: 'unreachable', group: 'none', rules: [], sitemaps: [], detail: status > 0 ? `HTTP ${status}` : (error ?? 'network error') }
}

interface Group {
  agents: string[]
  rules: RobotsRule[]
  crawlDelay?: number | undefined
}

export function parseRobots(text: string, agent = ROBOTS_AGENT): Robots {
  const groups: Group[] = []
  const sitemaps: string[] = []
  let current: Group | undefined
  // A user-agent line after a rule starts a new group; consecutive user-agent lines share one.
  let inRules = false
  for (const raw of text.slice(0, MAX_ROBOTS_BYTES).replace(/^﻿/, '').split(/\r\n|\r|\n/)) {
    const line = raw.replace(/#.*$/, '').trim()
    const colon = line.indexOf(':')
    if (colon <= 0) continue
    const key = line.slice(0, colon).trim().toLowerCase()
    const value = line.slice(colon + 1).trim()
    if (key === 'user-agent') {
      if (!current || inRules) {
        current = { agents: [], rules: [] }
        groups.push(current)
        inRules = false
      }
      current.agents.push(productToken(value))
    } else if (key === 'allow' || key === 'disallow') {
      if (!current) continue
      inRules = true
      // An empty Disallow allows everything: it adds no rule.
      if (value !== '') current.rules.push(robotsRule(key === 'allow', value))
    } else if (key === 'crawl-delay') {
      if (!current) continue
      inRules = true
      const seconds = Number(value)
      if (Number.isFinite(seconds) && seconds >= 0) current.crawlDelay = seconds
    } else if (key === 'sitemap' && value !== '') {
      sitemaps.push(value)
    }
  }

  const token = productToken(agent)
  const own = groups.filter((group) => group.agents.includes(token))
  const everyone = groups.filter((group) => group.agents.includes('*'))
  const chosen = own.length > 0 ? own : everyone
  const delays = chosen.flatMap((group) => (group.crawlDelay === undefined ? [] : [group.crawlDelay]))
  return {
    status: 'parsed',
    group: own.length > 0 ? 'rampa' : everyone.length > 0 ? '*' : 'none',
    // Several groups for the same agent are combined into one (RFC 9309, section 2.2.1).
    rules: chosen.flatMap((group) => group.rules),
    crawlDelaySeconds: delays.length > 0 ? Math.max(...delays) : undefined,
    sitemaps,
  }
}

/** "Rampa/1.0" and "rampa" name the same crawler. */
function productToken(value: string): string {
  return (value.split('/')[0] ?? '').trim().toLowerCase()
}

export function robotsRule(allow: boolean, pattern: string): RobotsRule {
  const normalized = normalizePattern(pattern)
  return { allow, pattern: normalized, regex: compilePattern(normalized) }
}

/** Escapes as a URL would: uppercase hex, and non-ASCII and spaces percent-encoded. */
export function normalizePattern(pattern: string): string {
  return pattern.replace(/%[0-9a-f]{2}/gi, (escape) => escape.toUpperCase()).replace(/[^\x21-\x7e]/gu, (char) => encodeURIComponent(char))
}

/** A robots.txt path pattern as a regular expression that matches from the start of the path. */
export function compilePattern(pattern: string): RegExp {
  const anchored = pattern.endsWith('$')
  const body = anchored ? pattern.slice(0, -1) : pattern
  const source = body
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
  return new RegExp(`^${source}${anchored ? '$' : ''}`)
}

/** The path and query a rule is matched against, with escapes in uppercase like the patterns. */
export function robotsPath(url: URL): string {
  return `${url.pathname}${url.search}`.replace(/%[0-9a-f]{2}/gi, (escape) => escape.toUpperCase())
}

/** The longest matching pattern decides; on a tie, allow wins. robots.txt itself is always allowed. */
export function robotsAllows(robots: Robots, url: URL): boolean {
  if (robots.status === 'missing') return true
  if (robots.status === 'unreachable') return false
  if (url.pathname === '/robots.txt') return true
  const path = robotsPath(url)
  let best: RobotsRule | undefined
  for (const rule of robots.rules) {
    if (!rule.regex.test(path)) continue
    if (!best || rule.pattern.length > best.pattern.length || (rule.pattern.length === best.pattern.length && rule.allow)) best = rule
  }
  return best?.allow ?? true
}
