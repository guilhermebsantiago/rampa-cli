import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { type Browser, type ElementHandle, type Page, type Response, chromium } from 'playwright-core'
import type { EngineResults } from '../core/types.ts'
import { RampaError, errorMessage, sha256 } from '../core/util.ts'
import { AXE_REVIEW_RULES, axeLocale, axeSource, axeTags, emptyEngine, engineFromAxe } from '../engine/axe.ts'
import type { Locale } from '../i18n.ts'
import { type HandleFrame, elementForRef, isQualifiedRef, resolverSource } from '../snapshot/refs.ts'
import type { A11yNode, A11ySnapshot } from '../snapshot/schema.ts'
import { VERSION } from '../version.ts'
import type { WcagVersion } from '../wcag.ts'
import { walkTree } from '../snapshot/tree.ts'
import { type FollowOptions, followLinks } from './destinations.ts'
import { type BrowserOptions, contextOptions, openPage, prepareContext } from './browser-options.ts'
import { attachFormIssues } from './form-issues.ts'
import { type ContrastCaptureOptions, captureContrast } from './contrast-capture.ts'
import { blankContentInPage, captureImageNodes, hiddenImageTargets, imageTargets, isCapturableImage, restoreImageInPage } from './image-capture.ts'
import { libraryFrameDriver, runAxeInFrames } from './frames.ts'
import { collectInPage } from './in-page.ts'
import { labelTargets, measureLabels } from './label-visibility.ts'
import { buildReach, closedShadowRoots } from './reach.ts'
import { SETTLE, settlePage, watchNetwork } from './settle.ts'
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
  /** Which WCAG version's axe-core rules run; 2.2 by default. */
  wcag?: WcagVersion | undefined
  /**
   * Measure from pixels the contrast axe-core cannot decide, placeholders and icon-only controls; on whenever
   * axe-core runs. Limits per page and the time budget can be changed (surfaces/contrast-capture.ts).
   */
  pixelContrast?: boolean | Pick<ContrastCaptureOptions, 'limits' | 'budgetMs'> | undefined
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
  // Watched from before navigation, so a request still in flight at load holds the wait after it.
  const network = watchNetwork(page)
  try {
    await prepareContext(context, url, options.browserOptions)
    const response = await openPage(page, url, options.browserOptions, options.timeoutMs)
    const status = response?.status() ?? 0
    if (options.requireOk && status >= 400) throw new RampaError('http-error', `HTTP ${status} at ${url}`)
    // Content drawn after load (data a framework fetches, a widget that mounts) is collected too.
    let settled = await settlePage(page, network)
    if (options.inspect) await options.inspect(page, response)
    if (options.mutate) await options.mutate(page)
    const collect = async () => {
      if (options.runAxe) await page.addScriptTag({ content: await axeSource() })
      const tree = await page.evaluate(collectInPage, { maxNodes: options.maxNodes ?? 5000 })
      await page.evaluate(resolverSource())
      // After the tree: the engine's results are mapped to the refs the collector gave their elements.
      const checked = options.runAxe
        ? await runAxeInFrames(libraryFrameDriver(page), { tags: axeTags(options.wcag), rules: AXE_REVIEW_RULES, locale: await axeLocale(options.locale) }, axeSource)
        : undefined
      return { ...tree, axe: checked?.axe, engineFrames: checked?.frames }
    }
    // A page that redirects at once (a 0 s refresh, in a meta element or a Refresh header) navigates while it is
    // being read. The redirect is recorded and the page it lands on is collected, instead of failing the target.
    const loaded = response?.url() ?? url
    let raw: Awaited<ReturnType<typeof collect>>
    try {
      raw = await collect()
    } catch (error) {
      if (!navigatedAway(error)) throw error
      const timeout = Math.min(options.timeoutMs ?? 30_000, 10_000)
      await page.waitForURL((address) => address.href !== loaded, { waitUntil: 'load', timeout }).catch(() => undefined)
      settled = await settlePage(page, network)
      raw = await collect()
    }

    const root = raw.root as A11yNode
    const cdp = () => context.newCDPSession(page)
    await attachFormIssues(cdp, root)
    const reach = buildReach({
      frames: raw.frames,
      engineFrames: raw.engineFrames,
      shadowRoots: raw.shadowRoots,
      closed: await closedShadowRoots(cdp),
      unsettledAfterMs: settled.settled ? undefined : SETTLE.capMs,
      truncated: raw.beyondTruncated,
    })
    // Response headers are facts the rules read: a Refresh header works like <meta http-equiv="refresh">, out of axe-core's sight.
    const refresh = response?.headers().refresh
    if (refresh !== undefined) root.native.httpRefresh = refresh.slice(0, 500)
    // What was collected is the page the redirect led to; the snapshot keeps the address asked for, and says where it ended.
    if (response && page.url() !== loaded) root.native.redirectedTo = page.url()
    if (options.captureImages) await captureImages(page, root)
    // Whether each label 3.3.2 relies on shows its text, from two captures (label-visibility.ts); no model involved.
    await measureLabelPixels(page, root)
    const engine = raw.axe ? engineFromAxe(raw.axe) : emptyEngine()
    if (raw.axe && options.pixelContrast !== false) await measureContrast(page, root, engine, options.pixelContrast === true ? {} : options.pixelContrast)
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
      ...(reach ? { reach } : {}),
      collectedAt: new Date().toISOString(),
      collector: { name: 'rampa-web', version: VERSION },
    }
    if (options.probes && options.probes.length > 0) {
      const probes = await runProbes(browser, url, { kinds: options.probes, browserOptions: options.browserOptions, timeoutMs: options.timeoutMs })
      snapshot.observations = { probes }
    }
    return { snapshot, engine }
  } finally {
    network.stop()
    await context.close()
  }
}

/** The errors Playwright raises when the page navigates while a script runs in it. */
function navigatedAway(error: unknown): boolean {
  return /Execution context was destroyed|because of a navigation|Cannot find context with specified id/i.test(errorMessage(error))
}

/** CSS backgrounds come after the images, with their own budget, so they never crowd images out. */
const BACKGROUND_LIMIT = 10

/**
 * Element screenshots show the image exactly as people see it: size, crop, CSS and all. Images go
 * through image-capture.ts, which scrolls each into view, waits for it to load, and leaves it without a
 * capture, saying why, when the screenshot would not be its own pixels. An image that did not load is
 * left without one too: its screenshot would show the broken-image icon, not the picture.
 */
async function captureImages(page: Page, root: A11yNode): Promise<void> {
  const backgrounds: A11yNode[] = []
  for (const node of walkTree(root)) {
    if (node.states.includes('hidden') || !node.bounds || isCapturableImage(node)) continue
    if (typeof node.native.backgroundImage === 'string' && backgrounds.length < BACKGROUND_LIMIT && !node.states.includes('offscreen')) {
      // Icons and sprites this small hold no line of text; anything taller than a banner is a section with a pattern.
      const { width, height } = node.bounds
      if (width >= 24 && height >= 12 && (width > 40 || height > 40) && height <= 1000) backgrounds.push(node)
    }
  }
  const named = imageTargets(root)
  const layers = named.length + hiddenImageTargets(root, named).length + backgrounds.length > 0 ? await markLayers(page) : 0
  // CSS scale: a phone's pixel ratio would send the model images up to nine times larger, for the same picture.
  const options = { type: 'png', timeout: 5000, animations: 'disabled', scale: 'css' } as const
  const shoot = (ref: string, style?: string): Promise<Buffer> => shootRef(page, ref, { ...options, style })
  try {
    await captureImageNodes(
      {
        // biome-ignore lint/suspicious/noExplicitAny: Playwright's evaluate infers its argument type from a generic it cannot see here
        evaluate: <Arg, Result>(fn: (arg: Arg) => Result | Promise<Result>, arg: Arg) => page.evaluate(fn as (arg: any) => Result | Promise<Result>, arg),
        screenshot: (ref) => shoot(ref).catch(() => undefined),
      },
      root,
      { beforeEach: layers > 0 ? (node) => showLayersAround(page, node.ref) : undefined },
    )
    for (const node of backgrounds) {
      try {
        if (layers > 0) await showLayersAround(page, node.ref)
        // A background is captured alone: the element's own text and children are hidden while the screenshot is taken,
        // by a style sheet for a CSS selector, inline for an element in a frame or a shadow root.
        const qualified = isQualifiedRef(node.ref)
        if (qualified && !(await page.evaluate(blankContentInPage, node.ref))) continue
        const png = qualified
          ? await shoot(node.ref).finally(() => page.evaluate(restoreImageInPage, null))
          : await shoot(node.ref, `${node.ref} { color: transparent !important; text-shadow: none !important; } ${node.ref} > * { visibility: hidden !important; }`)
        node.image = `data:image/png;base64,${png.toString('base64')}`
      } catch {
        // Not visible or detached: criteria that need the image skip this node.
      }
    }
  } finally {
    if (layers > 0) await restoreLayers(page)
  }
}

interface ShotOptions {
  type: 'png'
  timeout: number
  animations: 'disabled'
  scale?: 'css' | undefined
  style?: string | undefined
}

/** A screenshot of the element a ref names. A ref into a frame or a shadow root is found in its own frame, so the capture is placed right. */
async function shootRef(page: Page, ref: string, options: ShotOptions): Promise<Buffer> {
  if (!isQualifiedRef(ref)) return page.locator(`css=${ref}`).first().screenshot(options)
  const element = await elementForRef(page as unknown as HandleFrame<ElementHandle>, ref)
  if (!element) throw new Error(`No element for ${ref}`)
  try {
    return await element.screenshot(options)
  } finally {
    await element.dispose()
  }
}

/** Each label 3.3.2 relies on, captured as rendered and with its text transparent, with the fixed layers that do not hold it hidden. */
async function measureLabelPixels(page: Page, root: A11yNode): Promise<void> {
  if (labelTargets(root).length === 0) return
  const layers = await markLayers(page)
  try {
    await measureLabels(
      {
        // biome-ignore lint/suspicious/noExplicitAny: Playwright's evaluate infers its argument type from a generic it cannot see here
        evaluate: <Arg, Result>(fn: (arg: Arg) => Result | Promise<Result>, arg: Arg) => page.evaluate(fn as (arg: any) => Result | Promise<Result>, arg),
        screenshot: (ref) => shootRef(page, ref, { type: 'png', timeout: 5000, animations: 'disabled', scale: 'css' }).catch(() => undefined),
      },
      root,
      { beforeEach: layers > 0 ? (node) => showLayersAround(page, node.ref) : undefined },
    )
  } finally {
    if (layers > 0) await restoreLayers(page)
  }
}

/**
 * Contrast measured from pixels (contrast-capture.ts): each element captured as rendered and with its own
 * text, placeholder or icon made transparent. Fixed and sticky layers that do not hold it are hidden, as for images.
 */
async function measureContrast(page: Page, root: A11yNode, engine: EngineResults, settings: Pick<ContrastCaptureOptions, 'limits' | 'budgetMs'> = {}): Promise<void> {
  await captureContrast(
    {
      // biome-ignore lint/suspicious/noExplicitAny: Playwright's evaluate infers its argument type from a generic it cannot see here
      evaluate: <Arg, Result>(fn: (arg: Arg) => Result | Promise<Result>, arg: Arg) => page.evaluate(fn as (arg: any) => Result | Promise<Result>, arg),
      // Device pixels: the more pixels a stroke covers, the more of them show its own color.
      screenshot: (ref) => shootRef(page, ref, { type: 'png', timeout: 3000, animations: 'disabled' }).catch(() => undefined),
      // A box of the viewport costs a third of an element screenshot, which first waits for the element to be stable.
      screenshotBox: (clip) => page.screenshot({ type: 'png', clip, timeout: 3000, animations: 'disabled' }).catch(() => undefined),
    },
    root,
    engine,
    { ...settings, layers: { mark: () => markLayers(page), show: (ref) => showLayersAround(page, ref), restore: () => restoreLayers(page) } },
  )
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
    const nodes = (window as unknown as { __rampaNodes?: Map<string, Element> }).__rampaNodes
    let target: Element | null = nodes?.get(selector) ?? null
    try {
      target ??= document.querySelector(selector)
    } catch {
      target = null
    }
    // The layers are in the page's own document: a target in a frame or a shadow root counts as its frame element or host.
    while (target && target.getRootNode() !== document) {
      const root = target.getRootNode() as Document | ShadowRoot
      target = 'host' in root ? root.host : (root.defaultView?.frameElement ?? null)
    }
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
