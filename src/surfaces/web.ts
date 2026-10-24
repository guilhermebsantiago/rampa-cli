import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { type Browser, type ElementHandle, type Page, type Response, chromium } from 'playwright-core'
import { type Stopwatch, timed } from '../core/timings.ts'
import type { EngineResults } from '../core/types.ts'
import { RampaError, errorMessage, sha256 } from '../core/util.ts'
import { AXE_REVIEW_RULES, axeLocale, axeSource, axeTags, emptyEngine, engineFromAxe } from '../engine/axe.ts'
import type { Locale } from '../i18n.ts'
import { type HandleFrame, elementForRef, isQualifiedRef, resolverSource } from '../snapshot/refs.ts'
import type { A11yNode, A11ySnapshot, Blocked, ProbeRecord } from '../snapshot/schema.ts'
import { VERSION } from '../version.ts'
import type { WcagVersion } from '../wcag.ts'
import { walkTree } from '../snapshot/tree.ts'
import { type FollowOptions, followLinks, readDestinations } from './destinations.ts'
import { type BrowserOptions, contextOptions, loadedLate, openPage, prepareContext } from './browser-options.ts'
import { type AxLimits, attachAxTree, axLimits } from './ax-tree.ts'
import { attachFormIssues } from './form-issues.ts'
import { type ContrastCaptureOptions, captureContrast } from './contrast-capture.ts'
import { blankContentInPage, captureImageNodes, hiddenImageTargets, imageTargets, isCapturableImage, restoreImageInPage } from './image-capture.ts'
import { libraryFrameDriver, runAxeInFrames } from './frames.ts'
import { attachMotionFacts } from './motion.ts'
import { SHORT, blockedFactsInPage, blockedPage } from './bot-check.ts'
import { MAX_NODES, collectInPage, documentKindInPage, type InPageResult } from './in-page.ts'
import { collectPresentation } from './presentation.ts'
import { labelTargets, measureLabels } from './label-visibility.ts'
import { buildReach, closedShadowRoots } from './reach.ts'
import { SETTLE, type SettleOptions, settlePage, watchNetwork } from './settle.ts'
import { type ProbeKind, runProbes } from '../probes/run.ts'
import { skippedRecord } from '../probes/page.ts'
import { scriptedAddresses } from '../probes/links.ts'

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
  /** How long the cognitive observation (probe `cognitive`, which --profile cognitive adds) watches the page, in milliseconds. */
  observeMs?: number | undefined
  /**
   * The form probe's submissions (`--allow-submit`, `--submit-dry-run`; docs/probes.md, "Submitting forms"): the exact
   * origins where it may submit forms, or a dry run that lists what it would submit. Nothing is submitted without it.
   */
  submit?: { allowed: readonly string[]; dryRun?: boolean | undefined } | undefined
  /** Which WCAG version's axe-core rules run; 2.2 by default. */
  wcag?: WcagVersion | undefined
  /**
   * Measure from pixels the contrast axe-core cannot decide, placeholders and icon-only controls; on whenever
   * axe-core runs. Limits per page and the time budget can be changed (surfaces/contrast-capture.ts).
   */
  pixelContrast?: boolean | Pick<ContrastCaptureOptions, 'limits' | 'budgetMs'> | undefined
  /**
   * Read the browser's own accessibility tree onto the nodes (`ax`): the roles, names and states Chromium computes,
   * which some rules read (surfaces/ax-tree.ts). On by default; false turns it off, or other limits can be given.
   */
  axTree?: boolean | Partial<AxLimits> | undefined
  /** Records where the page's time goes (`--timings`, core/timings.ts). */
  timings?: Stopwatch | undefined
  /** The wait after load (surfaces/settle.ts): --fast lowers its cap (core/fast.ts). */
  settle?: Partial<SettleOptions> | undefined
  /** Images and CSS backgrounds captured at most per page (IMAGE_LIMIT and BACKGROUND_LIMIT by default): --fast captures fewer. */
  imageCapture?: { limit?: number | undefined; backgrounds?: number | undefined; budgetMs?: number | undefined } | undefined
  /**
   * Measure how reading text and controls are presented (`snapshot.presentation`, surfaces/presentation.ts), which the
   * cognitive profile reads; on only with `--profile cognitive`, so the default run does not pay for it.
   */
  presentation?: boolean | undefined
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
  const watch = options.timings
  const settle: SettleOptions = { ...SETTLE, ...options.settle }
  const { context, page } = await timed(watch, 'navigation', async () => {
    const context = await browser.newContext(contextOptions(options.browserOptions))
    return { context, page: await context.newPage() }
  })
  // Watched from before navigation, so a request still in flight at load holds the wait after it.
  const network = watchNetwork(page)
  const documents = watchDocuments(page)
  const stylesheetRequests = watchStylesheets(page)
  try {
    const response = await timed(watch, 'navigation', async () => {
      await prepareContext(context, url, options.browserOptions)
      return openPage(page, url, options.browserOptions, options.timeoutMs)
    })
    const status = response?.status() ?? 0
    if (options.requireOk && status >= 400) throw new RampaError('http-error', `HTTP ${status} at ${url}`)
    // Content drawn after load (data a framework fetches, a widget that mounts) is collected too.
    let settled = await timed(watch, 'settle', () => settlePage(page, network, settle))
    // A page that replaced its document while it settled (a bot check's interstitial that reloads, a script that
    // redirects) is read once the new document has loaded and settled, not half parsed.
    const landing = Math.min(options.timeoutMs ?? 30_000, 15_000)
    // Loaded as the navigation waited for it: the load event, or the DOM parsed with --wait-for domcontentloaded.
    const ready = (state: string) => state === 'complete' || (state === 'interactive' && options.browserOptions?.waitUntil === 'domcontentloaded')
    for (let seen = documents.count(), round = 0; round < 3; round++) {
      if (ready(await readyState(page)) && documents.count() === seen) break
      seen = documents.count()
      await timed(watch, 'navigation', () => documentLoaded(page, landing, ready))
      settled = await timed(watch, 'settle', () => settlePage(page, network, settle))
    }
    // A page whose own stylesheets did not apply is not the page people see (www.ufpe.br's hidden type-ahead list became
    // 1,628 visible links in the third real-page study): it is loaded once more, and if it is still unstyled the snapshot
    // says so, judgments that rest on what is visible become suggestions, and nothing is measured from pixels.
    let stylesheets = await stylesheetFacts(page, stylesheetRequests.failed())
    if (stylesheets?.unstyled) {
      try {
        await timed(watch, 'navigation', async () => {
          await page.reload({ timeout: options.timeoutMs ?? 30_000, waitUntil: 'load' })
          settled = await settlePage(page, network, settle)
        })
        stylesheets = { ...((await stylesheetFacts(page, stylesheetRequests.failed())) ?? { linked: 0, applied: 0, failed: [] }), retried: true }
      } catch (error) {
        if (navigatedAway(error)) throw error
        stylesheets = { ...stylesheets, retried: true }
      }
    }
    const unstyled = stylesheets?.unstyled === true
    if (options.inspect) await options.inspect(page, response)
    if (options.mutate) await options.mutate(page)
    const collect = async () => {
      const kind = await page.evaluate(documentKindInPage)
      // An XML document the browser shows as its source tree: the page in the browser is its viewer, not the
      // document, so nothing of it is read. The report says the page was not checked (core/check.ts).
      if (kind.kind === 'xml') return { ...(await unreadDocument(page)), kind, blocked: undefined, axe: undefined, engineFrames: undefined, axTree: undefined, engineError: undefined }
      // A bot check or a refusal in place of the page is the vendor's page, not the site's: it is not read either,
      // and the report says what the site sent instead (surfaces/bot-check.ts). Only a server sends one: a local file
      // is read whatever its title says.
      const served = /^https?:/i.test(page.url())
      const blocked = kind.kind === 'html' && served ? blockedPage(await page.evaluate(blockedFactsInPage, SHORT.elements), responseFacts(documents.last() ?? response)) : undefined
      if (blocked) return { ...(await unreadDocument(page)), kind, blocked, axe: undefined, engineFrames: undefined, axTree: undefined, engineError: undefined }
      // Evaluated, not added as a <script>: an SVG document has no head to add one to, and a script element outside
      // the HTML namespace never runs. The other frames get axe-core the same way (frames.ts).
      if (options.runAxe) await timed(watch, 'axe', async () => page.evaluate(await axeSource()))
      const tree = await timed(watch, 'collection', async () => {
        const read = await page.evaluate(collectInPage, { maxNodes: options.maxNodes ?? MAX_NODES })
        await page.evaluate(resolverSource())
        return read
      })
      // The browser's own tree, read right after Rampa's, so both describe the same document.
      const axTree =
        options.axTree === false
          ? undefined
          : await timed(watch, 'ax-tree', () => attachAxTree(() => context.newCDPSession(page), tree.root as A11yNode, axLimits(options.axTree)))
      // After the tree: the engine's results are mapped to the refs the collector gave their elements. An engine that
      // stops with an error on the page (axe-core reading an element a script masked) leaves the rest of the check
      // standing: its rules did not run, and the report says so.
      let engineError: string | undefined
      const checked = options.runAxe
        ? await timed(watch, 'axe', async () =>
            runAxeInFrames(libraryFrameDriver(page), { tags: axeTags(options.wcag), rules: AXE_REVIEW_RULES, locale: await axeLocale(options.locale) }, axeSource),
          ).catch((error: unknown) => {
            if (navigatedAway(error)) throw error
            engineError = errorMessage(error).split('\n')[0]?.replace(/^page\.evaluate: /, '').slice(0, 300)
            return undefined
          })
        : undefined
      return { ...tree, kind, blocked: undefined as Blocked | undefined, axe: checked?.axe, engineFrames: checked?.frames, axTree, engineError }
    }
    // A page that redirects at once (a 0 s refresh, in a meta element or a Refresh header) navigates while it is
    // being read. The redirect is recorded and the page it lands on is collected, instead of failing the target. The
    // page it lands on may have the same address (a reload): what is awaited is that its document has loaded.
    const loaded = response?.url() ?? url
    let raw: Awaited<ReturnType<typeof collect>>
    try {
      raw = await collect()
    } catch (error) {
      if (!navigatedAway(error)) throw error
      await timed(watch, 'navigation', () => documentLoaded(page, Math.min(options.timeoutMs ?? 30_000, 10_000), ready))
      settled = await timed(watch, 'settle', () => settlePage(page, network, settle))
      raw = await collect()
    }

    const root = raw.root as A11yNode
    const cdp = () => context.newCDPSession(page)
    // A standalone SVG document is read and checked by axe-core and the rules; what is built for HTML (the reading
    // presentation, contrast from pixels, the probes) is not run on it. An XML document is not read at all.
    const blocked = raw.blocked
    const html = raw.kind.kind === 'html' && !blocked
    const readable = raw.kind.kind !== 'xml' && !blocked
    // A layer over the viewport (a consent backdrop in a closed shadow root, a welcome dialog) paints over every capture
    // of what lies under it: found by what sits on top at nine points of the viewport, and hidden with the fixed layers.
    const overlay = html ? await page.evaluate(detectOverlayInPage).catch(() => undefined) : undefined
    // Before any capture scrolls the page or hides its layers: the lines are measured as the page first shows them.
    const presentation =
      options.presentation && html
        ? await timed(
            watch,
            'collection',
            () =>
              collectPresentation({
                // biome-ignore lint/suspicious/noExplicitAny: Playwright's evaluate infers its argument type from a generic it cannot see here
                evaluate: <Arg, Result>(fn: (arg: Arg) => Result | Promise<Result>, arg: Arg) => page.evaluate(fn as (arg: any) => Result | Promise<Result>, arg),
                cdp,
              }),
            'presentation',
          )
        : undefined
    const closed = readable
      ? await timed(watch, 'collection', async () => {
          await attachFormIssues(cdp, root)
          return closedShadowRoots(cdp)
        })
      : undefined
    const built = buildReach({
      frames: raw.frames,
      engineFrames: raw.engineFrames,
      shadowRoots: raw.shadowRoots,
      closed,
      unsettledAfterMs: settled.settled ? undefined : settle.capMs,
      truncated: raw.beyondTruncated,
      masked: raw.masked,
      loadTimedOutMs: loadedLate(page),
    })
    const recordSheets = stylesheets && (stylesheets.failed.length > 0 || stylesheets.retried)
    const reach = built || recordSheets || overlay ? { ...built, ...(recordSheets ? { stylesheets } : {}), ...(overlay ? { overlay: { ...overlay, hidden: true } } : {}) } : undefined
    // Response headers are facts the rules read: a Refresh header works like <meta http-equiv="refresh">, out of axe-core's sight.
    const refresh = response?.headers().refresh
    if (refresh !== undefined) root.native.httpRefresh = refresh.slice(0, 500)
    // What was collected is the page the redirect led to; the snapshot keeps the address asked for, and says where it ended.
    if (response && page.url() !== loaded) root.native.redirectedTo = page.url()
    if (options.captureImages && readable) await timed(watch, 'image-capture', () => captureImages(page, root, options.imageCapture))
    // Whether each label 3.3.2 relies on shows its text, from two captures (label-visibility.ts); no model involved.
    // On a page read without its stylesheets, pixels show the browser's defaults, not the page: nothing is measured.
    if (readable && !unstyled) await timed(watch, 'label-visibility', () => measureLabelPixels(page, root))
    const engine: EngineResults = raw.axe ? engineFromAxe(raw.axe) : { ...emptyEngine(), ...(raw.engineError ? { error: `axe-core: ${raw.engineError}` } : {}) }
    // The capture reads colors through an HTML canvas element, which an SVG document does not create: there, text
    // contrast stays axe-core's.
    if (raw.axe && html && options.pixelContrast !== false && !unstyled) {
      const settings = options.pixelContrast === true ? {} : options.pixelContrast
      await timed(watch, 'pixel-contrast', () => measureContrast(page, root, engine, settings))
    }
    // Relative links resolve against the document's base: the address after redirects, or its <base href>.
    const follow = options.followLinks
    const destinations =
      follow && follow.policy !== 'none' && readable
        ? await timed(watch, 'link-following', async () => followLinks(root, await page.evaluate(() => document.baseURI), follow))
        : {}

    let screenshot: string | undefined
    if (options.screenshotDir) {
      await mkdir(options.screenshotDir, { recursive: true })
      const path = join(options.screenshotDir, `${sha256(url).slice(0, 16)}.png`)
      screenshot = path
      await timed(watch, 'screenshot', () => page.screenshot({ path, fullPage: true }))
    }
    // Whether the page listens to the device's motion, for 2.5.4 (surfaces/motion.ts): last, as it reads the page's scripts.
    if (readable) await timed(watch, 'collection', () => attachMotionFacts(cdp, root))

    // The status of the document read: an error page is checked as the page that came, and the report says with which status.
    const documentStatus = (documents.last() ?? response)?.status() ?? 0
    const snapshot: A11ySnapshot = {
      schemaVersion: 1,
      surface: 'web',
      target: url,
      ...(raw.kind.kind === 'html' ? {} : { document: { kind: raw.kind.kind === 'svg' ? 'svg' : 'xml', contentType: raw.kind.contentType } }),
      ...(blocked ? { blocked } : {}),
      ...(documentStatus >= 400 ? { httpStatus: documentStatus } : {}),
      title: raw.title || undefined,
      locale: raw.lang,
      viewport: raw.viewport,
      root,
      screenshot,
      truncated: raw.truncated || undefined,
      ...(raw.truncated ? { elementLimit: options.maxNodes ?? MAX_NODES } : {}),
      destinations: Object.keys(destinations).length > 0 ? destinations : undefined,
      ...(reach ? { reach } : {}),
      ...(raw.axTree ? { axTree: raw.axTree } : {}),
      ...(presentation ? { presentation } : {}),
      collectedAt: new Date().toISOString(),
      collector: { name: 'rampa-web', version: VERSION },
    }
    if (options.probes && options.probes.length > 0 && !html) {
      // The probes drive an HTML page (keys, focus, injected style sheets, media): on another document each is recorded as not run.
      snapshot.observations = { probes: options.probes.map((kind) => skippedRecord(kind, '0', undefined, blocked ? BLOCKED_REASON : notHtmlReason(raw.kind.kind), 0)) }
    } else if (options.probes && options.probes.length > 0) {
      const probeOptions = {
        browserOptions: options.browserOptions,
        timeoutMs: options.timeoutMs,
        ...(options.submit && options.submit.allowed.length > 0 ? { allowSubmit: options.submit.allowed } : {}),
        ...(options.submit?.dryRun ? { submitDryRun: true } : {}),
        ...(options.observeMs ? { observeMs: options.observeMs } : {}),
      }
      // One kind at a time, in order, as runProbes runs them, so each kind's time is its own.
      const probes: ProbeRecord[] = []
      for (const kind of options.probes) probes.push(...(await timed(watch, 'probes', () => runProbes(browser, url, { ...probeOptions, kinds: [kind] }), kind)))
      snapshot.observations = { probes }
      // Where scripted links went when the links probe clicked them: read like any link's address, for 2.4.4.
      if (follow && follow.policy !== 'none') {
        const addresses = scriptedAddresses(probes).filter((address) => snapshot.destinations?.[address] === undefined)
        const read = addresses.length > 0 ? await timed(watch, 'link-following', () => readDestinations(addresses, page.url(), follow)) : {}
        if (Object.keys(read).length > 0) snapshot.destinations = { ...snapshot.destinations, ...read }
      }
    }
    return { snapshot, engine }
  } finally {
    network.stop()
    documents.stop()
    stylesheetRequests.stop()
    await timed(watch, 'teardown', () => context.close())
  }
}

/** Stylesheet requests that failed or were refused, from before navigation, keyed by address: the reason a sheet did not apply. */
function watchStylesheets(page: Page): { failed(): Map<string, string>; stop(): void } {
  const failed = new Map<string, string>()
  const onFailed = (request: import('playwright-core').Request) => {
    // After an HTTP error the browser also reports the request as aborted: the status is the reason worth keeping.
    if (request.resourceType() === 'stylesheet' && !failed.has(request.url())) failed.set(request.url(), request.failure()?.errorText ?? 'request failed')
  }
  const onResponse = (response: Response) => {
    try {
      if (response.request().resourceType() === 'stylesheet' && response.status() >= 400) failed.set(response.url(), `HTTP ${response.status()}`)
    } catch {
      // A service worker's response has no request.
    }
  }
  page.on('requestfailed', onFailed)
  page.on('response', onResponse)
  return {
    failed: () => failed,
    stop: () => {
      page.off('requestfailed', onFailed)
      page.off('response', onResponse)
    },
  }
}

type StylesheetFacts = NonNullable<NonNullable<A11ySnapshot['reach']>['stylesheets']>

/** The page's linked stylesheets and which of them did not apply; undefined for a document with none, or one that cannot be asked. */
async function stylesheetFacts(page: Page, requests: Map<string, string>): Promise<StylesheetFacts | undefined> {
  const facts = await page.evaluate(stylesheetFactsInPage).catch(() => undefined)
  if (!facts || facts.linked === 0) return undefined
  const failed = facts.failed.map((sheet) => ({ href: sheet.href, reason: requests.get(sheet.href) ?? sheet.reason }))
  const unstyled = facts.applied === 0 || (facts.own.linked > 0 && facts.own.failed === facts.own.linked)
  return { linked: facts.linked, applied: facts.applied, failed, ...(unstyled ? { unstyled: true } : {}) }
}

/**
 * In the page: every linked stylesheet that applies to the screen, whether it loaded (`sheet` is null when the request
 * failed or was refused) and holds rules (a sheet of another origin cannot be read and counts as applied).
 */
export function stylesheetFactsInPage(): { linked: number; applied: number; failed: Array<{ href: string; reason: string }>; own: { linked: number; failed: number } } {
  const links = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"]')).filter((link) => {
    if (!link.href || link.disabled) return false
    const media = link.media.trim()
    return media === '' || media === 'all' || media === 'screen' || matchMedia(media).matches
  })
  const failed: Array<{ href: string; reason: string }> = []
  let applied = 0
  const own = { linked: 0, failed: 0 }
  for (const link of links) {
    let mine = false
    try {
      mine = new URL(link.href).origin === location.origin
    } catch {
      mine = false
    }
    if (mine) own.linked++
    const sheet = link.sheet
    if (!sheet) {
      failed.push({ href: link.href.slice(0, 300), reason: 'not loaded' })
      if (mine) own.failed++
      continue
    }
    let rules: number | undefined
    try {
      rules = sheet.cssRules.length
    } catch {
      rules = undefined
    }
    if (rules === 0) {
      failed.push({ href: link.href.slice(0, 300), reason: 'no rules' })
      if (mine) own.failed++
      continue
    }
    applied++
  }
  return { linked: links.length, applied, failed, own }
}

/**
 * In the page: the element on top at nine points of the viewport, when one element is on top at seven or more of them
 * and holds little of the page's text: a backdrop or a dialog over the page, not the page's own content. A closed
 * shadow root's content is reported as its host, which is in the page's document and can be hidden. The element is
 * marked, so `markLayers` hides it with the fixed layers while captures are taken.
 */
export function detectOverlayInPage(): { ref?: string | undefined; selector: string; coverage: number } | undefined {
  const width = window.innerWidth
  const height = window.innerHeight
  const points: Array<[number, number]> = []
  for (const fx of [0.1, 0.5, 0.9]) for (const fy of [0.1, 0.5, 0.9]) points.push([width * fx, height * fy])
  const counts = new Map<Element, number>()
  for (const [x, y] of points) {
    let element: Element | null = document.elementFromPoint(x, y)
    while (element && element.getRootNode() !== document) {
      const root = element.getRootNode() as Document | ShadowRoot
      element = 'host' in root ? root.host : null
    }
    if (!element || element === document.documentElement || element === document.body) continue
    counts.set(element, (counts.get(element) ?? 0) + 1)
  }
  let top: Element | undefined
  let hits = 0
  for (const [element, count] of counts) {
    if (count > hits) {
      top = element
      hits = count
    }
  }
  if (!top || hits < 7) return undefined
  // The page's own content wrapper covers the viewport too. A layer over the page is out of the flow (fixed or absolute),
  // or hosts a shadow root, or is a box far smaller than what it covers (an inline host whose shadow content is fixed);
  // and it holds little of the page's text.
  const { position } = getComputedStyle(top)
  const rect = top.getBoundingClientRect()
  const ownBox = (Math.min(rect.width, width) * Math.min(rect.height, height)) / (width * height)
  const outOfFlow = position === 'fixed' || position === 'absolute' || Boolean(top.shadowRoot) || ownBox < 0.5
  if (!outOfFlow) return undefined
  const text = (top.textContent ?? '').trim().length
  const bodyText = (document.body.textContent ?? '').trim().length
  if (bodyText > 0 && text / bodyText > 0.5) return undefined
  if (top.matches('main, [role="main"], article') || top.querySelector('main, [role="main"]')) return undefined
  top.setAttribute('data-rampa-overlay', '')
  const nodes = (window as unknown as { __rampaNodes?: Map<string, Element> }).__rampaNodes
  let ref: string | undefined
  if (nodes) {
    for (const [key, element] of nodes) {
      if (element === top) {
        ref = key
        break
      }
    }
  }
  const selector = `${top.tagName.toLowerCase()}${top.id ? `#${top.id}` : ''}`
  return { ...(ref ? { ref } : {}), selector, coverage: Math.round((hits / points.length) * 100) / 100 }
}

/** The document's readyState, or `navigating` while a new document replaces it. */
async function readyState(page: Page): Promise<string> {
  return page.evaluate(() => document.readyState).catch(() => 'navigating')
}

/** Waits until the page's document is `ready`, through any navigation that replaces it meanwhile; at most `ms`. */
async function documentLoaded(page: Page, ms: number, ready: (state: string) => boolean): Promise<void> {
  const deadline = Date.now() + ms
  while (!ready(await readyState(page)) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100))
}

/** The probes' record on a page the site replaced with a bot check or a refusal. */
const BLOCKED_REASON = 'not run: the site sent a bot check or a refusal in place of the page'

/**
 * The responses that brought the main frame a new document (redirects aside), counted from before navigation: the
 * last one is the document the page shows, and a count that grows after load means the page replaced itself.
 */
function watchDocuments(page: Page): { count(): number; last(): Response | undefined; stop(): void } {
  let count = 0
  let last: Response | undefined
  const seen = (response: Response) => {
    try {
      if (!response.request().isNavigationRequest() || response.frame() !== page.mainFrame()) return
    } catch {
      // A service worker's response has no frame.
      return
    }
    const status = response.status()
    if (status >= 300 && status < 400) return
    count++
    last = response
  }
  page.on('response', seen)
  return { count: () => count, last: () => last, stop: () => page.off('response', seen) }
}

/** The status and headers bot-check detection reads; undefined for a document that came with no response (about:blank, a data: address). */
function responseFacts(response: Response | null | undefined): { status: number; headers: Record<string, string> } | undefined {
  return response ? { status: response.status(), headers: response.headers() } : undefined
}

/**
 * What is collected of a document Rampa does not read (core/check.ts says so in the report): its root, with nothing
 * under it. The page in the browser is not the document, as with an XML document shown as its source tree.
 */
async function unreadDocument(page: Page): Promise<InPageResult> {
  const viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight, scale: window.devicePixelRatio }))
  return { title: '', lang: undefined, viewport, root: { ref: ':root', role: 'document', states: [], native: {}, children: [] }, truncated: false, frames: [], shadowRoots: 0, beyondTruncated: false }
}

/** Why the probes did not run on a page that is not an HTML document, for their records. */
function notHtmlReason(kind: 'svg' | 'xml' | 'html'): string {
  return kind === 'svg' ? 'not run: the page is a standalone SVG document, and the probes drive HTML pages' : 'not run: the page is an XML document Rampa does not read'
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
async function captureImages(page: Page, root: A11yNode, limits: WebCollectOptions['imageCapture'] = {}): Promise<void> {
  const backgroundLimit = limits.backgrounds ?? BACKGROUND_LIMIT
  const backgrounds: A11yNode[] = []
  for (const node of walkTree(root)) {
    if (node.states.includes('hidden') || !node.bounds || isCapturableImage(node)) continue
    if (typeof node.native.backgroundImage === 'string' && backgrounds.length < backgroundLimit && !node.states.includes('offscreen')) {
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
      { beforeEach: layers > 0 ? (node) => showLayersAround(page, node.ref) : undefined, limit: limits.limit, budgetMs: limits.budgetMs },
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
      // A layer found over the viewport (detectOverlayInPage) counts whatever its position: a closed shadow root's
      // backdrop is fixed inside the root, where this query cannot see it, and its host is what can be hidden.
      if (position !== 'fixed' && position !== 'sticky' && !el.hasAttribute('data-rampa-overlay')) continue
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
