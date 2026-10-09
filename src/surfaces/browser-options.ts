import { readFileSync } from 'node:fs'
import { type BrowserContext, type BrowserContextOptions, type Page, type Response, devices, errors } from 'playwright-core'
import { RampaError, canonicalLanguageTag, errorMessage } from '../core/util.ts'

/** The browser flags of `rampa check`, as the command line gives them. */
export interface BrowserFlags {
  storageState?: string | undefined
  header?: string[] | undefined
  cookie?: string[] | undefined
  viewport?: string | undefined
  device?: string | undefined
  colorScheme?: string | undefined
  reducedMotion?: boolean | undefined
  browserLocale?: string | undefined
  waitFor?: string[] | undefined
  timeout?: string | undefined
  userAgent?: string | undefined
}

export const LOAD_STATES = ['load', 'domcontentloaded', 'networkidle'] as const
export type LoadState = (typeof LOAD_STATES)[number]

/** After navigation: wait for an element to be visible, or pause. */
export type WaitStep = { selector: string } | { ms: number }

/**
 * How a page is opened: what the browser emulates, which session it carries and
 * when the page counts as ready. None of it changes what the criteria read; it
 * changes which page they read, so a site behind a login, on a phone or in dark
 * mode can be checked as people see it.
 */
export interface BrowserOptions {
  /** A Playwright storage state file: the cookies and localStorage of a signed-in session. */
  storageState?: string | undefined
  /** Sent to the site being checked only, never to third parties the page loads from. */
  headers?: Record<string, string> | undefined
  /** Set on the host of the page being checked. */
  cookies?: Array<{ name: string; value: string }> | undefined
  viewport?: { width: number; height: number } | undefined
  /** A Playwright device name, such as "iPhone 13" or "Pixel 7": viewport, scale, user agent and touch. */
  device?: string | undefined
  colorScheme?: 'light' | 'dark' | undefined
  reducedMotion?: boolean | undefined
  /** The browser's locale (navigator.language, Accept-Language), not the report's. */
  locale?: string | undefined
  /** What navigation waits for; load by default. */
  waitUntil?: LoadState | undefined
  /** Then, in order. */
  waitFor?: WaitStep[] | undefined
  timeoutMs?: number | undefined
  userAgent?: string | undefined
}

export const DEFAULT_VIEWPORT = { width: 1280, height: 800 }
const DEFAULT_TIMEOUT_MS = 30_000

/** Validates every flag up front, so a typo stops the run before a browser starts. */
export function parseBrowserFlags(flags: BrowserFlags): BrowserOptions {
  const options: BrowserOptions = {}
  if (flags.storageState) options.storageState = checkStorageState(flags.storageState)
  if (flags.header?.length) options.headers = Object.fromEntries(flags.header.map(parseHeader))
  if (flags.cookie?.length) options.cookies = flags.cookie.map(parseCookie)
  if (flags.viewport) options.viewport = parseViewport(flags.viewport)
  if (flags.device) options.device = deviceName(flags.device)
  if (flags.colorScheme) options.colorScheme = parseColorScheme(flags.colorScheme)
  if (flags.reducedMotion) options.reducedMotion = true
  if (flags.browserLocale) options.locale = parseLocale(flags.browserLocale)
  if (flags.waitFor?.length) {
    const { waitUntil, steps } = parseWaitFor(flags.waitFor)
    if (waitUntil) options.waitUntil = waitUntil
    if (steps.length > 0) options.waitFor = steps
  }
  if (flags.timeout !== undefined) options.timeoutMs = wholeNumber(flags.timeout, '--timeout', 1)
  if (flags.userAgent?.trim()) options.userAgent = flags.userAgent.trim()
  return options
}

export function wholeNumber(raw: string, flag: string, min: number): number {
  const value = Number(raw.trim())
  if (!/^\d+$/.test(raw.trim()) || !Number.isSafeInteger(value) || value < min) {
    throw new RampaError('invalid-option', `${flag} must be a whole number of at least ${min}. Got "${raw}".`)
  }
  return value
}

function checkStorageState(path: string): string {
  let state: unknown
  try {
    state = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === 'ENOENT'
    throw new RampaError(
      'invalid-storage-state',
      missing
        ? `Storage state file not found: ${path}. Save one with: npx playwright codegen --save-storage=${path} <login page URL>`
        : `Could not read the storage state ${path}: ${errorMessage(error)}`,
    )
  }
  const record = (state ?? {}) as { cookies?: unknown; origins?: unknown }
  if (!Array.isArray(record.cookies) || (record.origins !== undefined && !Array.isArray(record.origins))) {
    throw new RampaError('invalid-storage-state', `${path} is not a Playwright storage state: it needs a "cookies" list (and "origins" for localStorage).`)
  }
  return path
}

const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/

/** Values never appear in errors: a header is often a credential. */
function parseHeader(raw: string): [string, string] {
  const colon = raw.indexOf(':')
  const name = colon > 0 ? raw.slice(0, colon).trim() : ''
  if (!TOKEN.test(name)) throw new RampaError('invalid-header', '--header must be "Name: value", such as --header "Authorization: Bearer <token>".')
  return [name.toLowerCase(), raw.slice(colon + 1).trim()]
}

function parseCookie(raw: string): { name: string; value: string } {
  const equals = raw.indexOf('=')
  const name = equals > 0 ? raw.slice(0, equals).trim() : ''
  const value = equals > 0 ? raw.slice(equals + 1).trim() : ''
  if (!TOKEN.test(name) || /[;\r\n]/.test(value)) {
    throw new RampaError('invalid-cookie', '--cookie must be name=value, one cookie per flag. For domains, paths or expiry, use --storage-state.')
  }
  return { name, value }
}

function parseViewport(raw: string): { width: number; height: number } {
  const match = /^\s*(\d{1,5})\s*[x×]\s*(\d{1,5})\s*$/i.exec(raw)
  const width = Number(match?.[1])
  const height = Number(match?.[2])
  if (!match || width < 1 || height < 1 || width > 10_000 || height > 10_000) {
    throw new RampaError('invalid-viewport', `--viewport must be WIDTHxHEIGHT in CSS pixels, such as 390x844. Got "${raw}".`)
  }
  return { width, height }
}

type Device = (typeof devices)[keyof typeof devices]

function deviceName(raw: string): string {
  const names = Object.keys(devices)
  const squash = (value: string) => value.toLowerCase().replace(/\s+/g, '')
  const wanted = raw.trim().toLowerCase()
  const exact = names.find((name) => name === raw) ?? names.find((name) => squash(name) === squash(raw))
  if (exact) return exact
  const words = wanted.split(/\s+/).filter(Boolean)
  // Newest first: the list runs from old phones to new ones.
  const portrait = names.filter((name) => !name.endsWith(' landscape')).reverse()
  const close = portrait.filter((name) => words.every((word) => name.toLowerCase().includes(word)))
  const suggestions = (close.length > 0 ? close : portrait.filter((name) => words.some((word) => name.toLowerCase().includes(word)))).slice(0, 6)
  const hint = suggestions.length > 0 ? ` Did you mean ${suggestions.map((name) => `"${name}"`).join(', ')}?` : ''
  throw new RampaError('unknown-device', `Unknown device "${raw}".${hint} Names come from Playwright's device list, such as "iPhone 13" or "Pixel 7".`)
}

function parseColorScheme(raw: string): 'light' | 'dark' {
  const value = raw.trim().toLowerCase()
  if (value === 'light' || value === 'dark') return value
  throw new RampaError('invalid-color-scheme', `--color-scheme must be light or dark. Got "${raw}".`)
}

function parseLocale(raw: string): string {
  const tag = canonicalLanguageTag(raw)
  if (!tag) throw new RampaError('invalid-locale', `--browser-locale must be a BCP 47 language tag, such as pt-BR. Got "${raw}".`)
  return tag
}

/** A load state sets what navigation waits for; a number is a pause in milliseconds; anything else is a selector. */
function parseWaitFor(values: readonly string[]): { waitUntil: LoadState | undefined; steps: WaitStep[] } {
  let waitUntil: LoadState | undefined
  const steps: WaitStep[] = []
  for (const raw of values) {
    const value = raw.trim()
    const state = LOAD_STATES.find((candidate) => candidate === value.toLowerCase())
    if (state) {
      if (waitUntil && waitUntil !== state) {
        throw new RampaError('invalid-wait-for', `--wait-for takes one load state (${LOAD_STATES.join(', ')}); got ${waitUntil} and ${state}.`)
      }
      waitUntil = state
    } else if (/^\d+(?:ms)?$/i.test(value)) steps.push({ ms: Number.parseInt(value, 10) })
    else if (value !== '') steps.push({ selector: value })
    else throw new RampaError('invalid-wait-for', '--wait-for needs a selector, a load state or a number of milliseconds.')
  }
  return { waitUntil, steps }
}

function deviceDescriptor(name: string): Omit<Device, 'defaultBrowserType'> {
  const found = (devices as Record<string, Device | undefined>)[deviceName(name)] as Device
  // Rampa renders with Chromium: a device lends its screen, user agent and touch, not its browser engine.
  const { defaultBrowserType: _engine, ...descriptor } = found
  return descriptor
}

/** Playwright context options; with no options, the 1280×800 desktop page Rampa always used. */
export function contextOptions(options: BrowserOptions = {}): BrowserContextOptions {
  const device = options.device ? deviceDescriptor(options.device) : undefined
  return {
    ...device,
    viewport: options.viewport ?? device?.viewport ?? DEFAULT_VIEWPORT,
    bypassCSP: true,
    ...(options.userAgent ? { userAgent: options.userAgent } : {}),
    ...(options.colorScheme ? { colorScheme: options.colorScheme } : {}),
    ...(options.reducedMotion ? { reducedMotion: 'reduce' as const } : {}),
    ...(options.locale ? { locale: options.locale } : {}),
    ...(options.storageState ? { storageState: options.storageState } : {}),
  }
}

export function webUrl(url: string): URL | undefined {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed : undefined
  } catch {
    return undefined
  }
}

/**
 * example.com and www.example.com, over http or https, are one site. Another
 * host, or another port on the same host (another service), is a third party.
 */
export function sameSite(a: URL, b: URL): boolean {
  const host = (url: URL) => url.hostname.replace(/^www\./, '')
  // URL.port is empty for the default port of the scheme, so an http to https redirect stays on the site.
  return host(a) === host(b) && a.port === b.port
}

/**
 * Cookies from --cookie, on the host of the page (and its www. twin). On
 * localhost or an IP address they stay on that host.
 */
export async function addSiteCookies(context: BrowserContext, url: string, options: BrowserOptions = {}): Promise<void> {
  const site = webUrl(url)
  if (!site || !options.cookies?.length) return
  const domain = site.hostname.replace(/^www\./, '')
  await context.addCookies(
    options.cookies.map(({ name, value }) => ({ name, value, domain, path: '/', secure: site.protocol === 'https:', sameSite: 'Lax' as const })),
  )
}

/**
 * Headers from --header go only to requests for the site being checked. A
 * header is often a credential, and a page loads fonts, scripts and analytics
 * from third parties that must never receive it.
 */
export async function prepareContext(context: BrowserContext, url: string, options: BrowserOptions = {}): Promise<void> {
  const site = webUrl(url)
  if (!site) return
  await addSiteCookies(context, url, options)
  const headers = options.headers
  if (!headers || Object.keys(headers).length === 0) return
  await context.route(
    (candidate) => sameSite(candidate, site),
    (route) => route.continue({ headers: { ...route.request().headers(), ...headers } }),
  )
}

/** Headers for a request Rampa makes itself (robots.txt, sitemaps): the same rule as for the page. */
export function headersFor(url: string, sites: readonly URL[], options: BrowserOptions = {}): Record<string, string> | undefined {
  const target = webUrl(url)
  if (!target || !options.headers || !sites.some((site) => sameSite(site, target))) return undefined
  return options.headers
}

/** Navigates, then waits for each element or pause from --wait-for, in order. */
export async function openPage(page: Page, url: string, options: BrowserOptions = {}, timeoutMs?: number): Promise<Response | null> {
  const timeout = options.timeoutMs ?? timeoutMs ?? DEFAULT_TIMEOUT_MS
  const waitUntil = options.waitUntil ?? 'load'
  let response: Response | null
  try {
    response = await page.goto(url, { waitUntil, timeout })
  } catch (error) {
    if (!(error instanceof errors.TimeoutError)) throw error
    const hint = waitUntil === 'networkidle' ? 'Raise --timeout, or wait for load instead of networkidle.' : 'Raise --timeout.'
    throw new RampaError('page-timeout', `${url} did not reach ${waitUntil} within ${timeout} ms. ${hint}`)
  }
  for (const step of options.waitFor ?? []) {
    if ('ms' in step) {
      await page.waitForTimeout(step.ms)
      continue
    }
    try {
      await page.locator(step.selector).first().waitFor({ state: 'visible', timeout })
    } catch (error) {
      const reason = error instanceof errors.TimeoutError ? `did not become visible within ${timeout} ms` : errorMessage(error)
      throw new RampaError('wait-for', `--wait-for "${step.selector}" on ${url}: ${reason}.`)
    }
  }
  return response
}

/** What the browser emulated and carried, for the report. Header and cookie values never leave this process. */
export interface BrowserConditions {
  device?: string | undefined
  viewport: { width: number; height: number }
  colorScheme?: 'light' | 'dark' | undefined
  reducedMotion?: boolean | undefined
  locale?: string | undefined
  userAgent?: string | undefined
  waitUntil: LoadState
  waitFor?: string[] | undefined
  storageState?: boolean | undefined
  headers?: string[] | undefined
  cookies?: string[] | undefined
}

export function describeConditions(options: BrowserOptions = {}): BrowserConditions {
  const device = options.device ? deviceDescriptor(options.device) : undefined
  return {
    device: options.device,
    viewport: options.viewport ?? device?.viewport ?? DEFAULT_VIEWPORT,
    colorScheme: options.colorScheme,
    reducedMotion: options.reducedMotion,
    locale: options.locale,
    userAgent: options.userAgent,
    waitUntil: options.waitUntil ?? 'load',
    waitFor: options.waitFor?.map((step) => ('ms' in step ? `${step.ms}ms` : step.selector)),
    storageState: options.storageState ? true : undefined,
    headers: options.headers ? Object.keys(options.headers) : undefined,
    cookies: options.cookies?.map((cookie) => cookie.name),
  }
}
