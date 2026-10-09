import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { type Browser, type Page, type Response, chromium } from 'playwright-core'
import type { EngineResults } from '../core/types.ts'
import { RampaError, errorMessage, sha256 } from '../core/util.ts'
import { AXE_TAGS, axeLocale, axeSource, emptyEngine, engineFromAxe } from '../engine/axe.ts'
import type { Locale } from '../i18n.ts'
import type { A11yNode, A11ySnapshot } from '../snapshot/schema.ts'
import { VERSION } from '../version.ts'
import { walkTree } from '../snapshot/tree.ts'
import { type FollowOptions, followLinks } from './destinations.ts'
import { type BrowserOptions, contextOptions, openPage, prepareContext } from './browser-options.ts'
import { collectInPage } from './in-page.ts'
import { type ProbeKind, runProbes } from '../probes/run.ts'

export interface WebCollectOptions {
  runAxe: boolean
  locale: Locale
  timeoutMs?: number
  maxNodes?: number
  screenshotDir?: string | undefined
  /** Attach a PNG of each image as rendered, for criteria that need vision. */
  captureImages?: boolean | undefined
  /** Changes the page before collection; used by the eval to build corrupted pairs. */
  mutate?: ((page: Page) => Promise<void>) | undefined
  /** Read where the page's links lead, for criteria that compare a link with its destination. */
  followLinks?: FollowOptions | undefined
  /** Fail on an HTTP error answer (404, 429...) instead of checking the error page; the eval needs the real test page. */
  requireOk?: boolean | undefined
  /** Viewport, device, color scheme, session, headers and what to wait for; see docs/browser-options.md. */
  browserOptions?: BrowserOptions | undefined
  /** Reads the loaded page before collection; the crawler takes its links here, and may stop the collection by throwing. */
  inspect?: ((page: Page, response: Response | null) => Promise<void>) | undefined
  /** Probes to run after collection, each on its own fresh page behind the network guard (docs/probes.md). */
  probes?: readonly ProbeKind[] | undefined
}

export interface Collected {
  snapshot: A11ySnapshot
  engine: EngineResults
}

const CHANNELS = ['chrome', 'msedge', 'chromium'] as const

/** Distribution packages that are not Playwright channels, such as Fedora's `dnf install chromium`. */
const SYSTEM_BROWSERS = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/snap/bin/chromium']

/**
 * Uses the browser already on the machine: RAMPA_BROWSER_PATH if set, then Chrome or Edge,
 * Playwright's Chromium if it was downloaded, and on Linux the distribution's Chromium.
 */
export async function launchBrowser(options: { args?: string[] | undefined } = {}): Promise<Browser> {
  const args = options.args ?? []
  const explicit = process.env.RAMPA_BROWSER_PATH
  if (explicit) {
    try {
      return await chromium.launch({ executablePath: explicit, headless: true, args })
    } catch (error) {
      throw new RampaError('browser-not-found', `Could not start RAMPA_BROWSER_PATH=${explicit}: ${errorMessage(error)}`)
    }
  }
  const preferred = process.env.RAMPA_BROWSER_CHANNEL
  const channels = preferred ? [preferred] : CHANNELS
  const failures: string[] = []
  for (const channel of channels) {
    try {
      return await chromium.launch({ channel: channel === 'chromium' ? undefined : channel, headless: true, args })
    } catch (error) {
      failures.push(`${channel}: ${errorMessage(error)}`)
    }
  }
  if (!preferred && process.platform === 'linux') {
    for (const executablePath of SYSTEM_BROWSERS.filter((path) => existsSync(path))) {
      try {
        return await chromium.launch({ executablePath, headless: true, args })
      } catch (error) {
        failures.push(`${executablePath}: ${errorMessage(error)}`)
      }
    }
  }
  throw new RampaError(
    'browser-not-found',
    `No browser found. Install Chrome, Edge or Chromium (Fedora: sudo dnf install chromium), or set RAMPA_BROWSER_PATH.\n${failures.join('\n')}`,
  )
}

export async function collectWeb(browser: Browser, url: string, options: WebCollectOptions): Promise<Collected> {
  const context = await browser.newContext(contextOptions(options.browserOptions))
  const page = await context.newPage()
  try {
    await prepareContext(context, url, options.browserOptions)
    const response = await openPage(page, url, options.browserOptions, options.timeoutMs)
    const status = response?.status() ?? 0
    if (options.requireOk && status >= 400) throw new RampaError('http-error', `HTTP ${status} at ${url}`)
    if (options.inspect) await options.inspect(page, response)
    if (options.mutate) await options.mutate(page)
    if (options.runAxe) await page.addScriptTag({ content: await axeSource() })
    const raw = await page.evaluate(collectInPage, {
      runAxe: options.runAxe,
      axeTags: AXE_TAGS,
      axeLocale: options.runAxe ? await axeLocale(options.locale) : undefined,
      maxNodes: options.maxNodes ?? 5000,
    })

    const root = raw.root as A11yNode
    if (options.captureImages) await captureImages(page, root)
    // Relative links resolve against the document's base: the address after redirects, or its <base href>.
    const destinations =
      options.followLinks && options.followLinks.policy !== 'none'
        ? await followLinks(root, await page.evaluate(() => document.baseURI), options.followLinks)
        : {}

    let screenshot: string | undefined
    if (options.screenshotDir) {
      await mkdir(options.screenshotDir, { recursive: true })
      screenshot = join(options.screenshotDir, `${sha256(url).slice(0, 16)}.png`)
      await page.screenshot({ path: screenshot, fullPage: true })
    }

    const snapshot: A11ySnapshot = {
      schemaVersion: 1,
      surface: 'web',
      target: url,
      title: raw.title || undefined,
      locale: raw.lang,
      viewport: raw.viewport,
      root,
      screenshot,
      truncated: raw.truncated || undefined,
      destinations: Object.keys(destinations).length > 0 ? destinations : undefined,
      collectedAt: new Date().toISOString(),
      collector: { name: 'rampa-web', version: VERSION },
    }
    if (options.probes && options.probes.length > 0) {
      const probes = await runProbes(browser, url, { kinds: options.probes, browserOptions: options.browserOptions, timeoutMs: options.timeoutMs })
      snapshot.observations = { probes }
    }
    const engine = raw.axe ? engineFromAxe(raw.axe) : emptyEngine()
    return { snapshot, engine }
  } finally {
    await context.close()
  }
}

const IMAGE_LIMIT = 25
/** CSS backgrounds come after the images, with their own budget, so they never crowd images out. */
const BACKGROUND_LIMIT = 10

/**
 * Element screenshots show the image exactly as people see it: size, crop, CSS and all.
 * An image that did not load is left without one: its screenshot would show the broken-image icon,
 * and a judgment of the alternative against that icon would be wrong.
 */
async function captureImages(page: Page, root: A11yNode): Promise<void> {
  const targets: A11yNode[] = []
  const backgrounds: A11yNode[] = []
  for (const node of walkTree(root)) {
    const attributes = (node.native.attributes ?? {}) as Record<string, string>
    const isImage =
      node.native.tag === 'img' ||
      node.role === 'img' ||
      (node.native.tag === 'input' && attributes.type === 'image') ||
      (node.native.tag === 'canvas' && Boolean(node.name))
    if (node.states.includes('hidden') || node.states.includes('broken') || !node.bounds) continue
    if (isImage) {
      if (node.bounds.width < 8 || node.bounds.height < 8 || targets.length >= IMAGE_LIMIT) continue
      targets.push(node)
    } else if (typeof node.native.backgroundImage === 'string' && backgrounds.length < BACKGROUND_LIMIT && !node.states.includes('offscreen')) {
      // Icons and sprites this small hold no line of text; anything taller than a banner is a section with a pattern.
      const { width, height } = node.bounds
      if (width >= 24 && height >= 12 && (width > 40 || height > 40) && height <= 1000) backgrounds.push(node)
    }
  }
  const layers = targets.length + backgrounds.length > 0 ? await markLayers(page) : 0
  try {
    for (const [node, background] of [...targets.map((n) => [n, false] as const), ...backgrounds.map((n) => [n, true] as const)]) {
      try {
        if (layers > 0) await showLayersAround(page, node.ref)
        // A background is captured alone: the element's own text and children are hidden while the screenshot is taken.
        const style = background
          ? `${node.ref} { color: transparent !important; text-shadow: none !important; } ${node.ref} > * { visibility: hidden !important; }`
          : undefined
        // CSS scale: a phone's pixel ratio would send the model images up to nine times larger, for the same picture.
        const png = await page.locator(`css=${node.ref}`).first().screenshot({ type: 'png', timeout: 5000, animations: 'disabled', style, scale: 'css' })
        node.image = `data:image/png;base64,${png.toString('base64')}`
      } catch {
        // Not visible or detached: criteria that need the image skip this node.
      }
    }
  } finally {
    if (layers > 0) await restoreLayers(page)
  }
}

/**
 * Fixed and sticky layers (cookie banners, chat buttons, sticky headers) paint over whatever
 * sits under them in an element screenshot. They are marked once, keeping their own visibility.
 */
async function markLayers(page: Page): Promise<number> {
  return page.evaluate(() => {
    let count = 0
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      const { position } = getComputedStyle(el)
      if (position !== 'fixed' && position !== 'sticky') continue
      el.setAttribute('data-rampa-layer', el.style.getPropertyValue('visibility'))
      count++
    }
    return count
  })
}

/** Hides every marked layer except those that hold the target or sit inside it. */
async function showLayersAround(page: Page, ref: string): Promise<void> {
  await page.evaluate((selector) => {
    const target = document.querySelector(selector)
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-rampa-layer]'))) {
      if (target && (el.contains(target) || target.contains(el))) {
        const saved = el.getAttribute('data-rampa-layer')
        if (saved) el.style.setProperty('visibility', saved)
        else el.style.removeProperty('visibility')
      } else {
        el.style.setProperty('visibility', 'hidden', 'important')
      }
    }
  }, ref)
}

async function restoreLayers(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-rampa-layer]'))) {
      const saved = el.getAttribute('data-rampa-layer')
      if (saved) el.style.setProperty('visibility', saved)
      else el.style.removeProperty('visibility')
      el.removeAttribute('data-rampa-layer')
    }
  })
}
