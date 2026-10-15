import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { type Stopwatch, timed } from '../core/timings.ts'
import { RampaError, sha256 } from '../core/util.ts'
import { AXE_REVIEW_RULES, axeLocale, axeSource, axeTags, engineFromAxe } from '../engine/axe.ts'
import type { Locale } from '../i18n.ts'
import { resolverSource } from '../snapshot/refs.ts'
import type { A11yNode, A11ySnapshot } from '../snapshot/schema.ts'
import { walkTree } from '../snapshot/tree.ts'
import { VERSION } from '../version.ts'
import type { WcagVersion } from '../wcag.ts'
import { type AxLimits, attachAxTree, axLimits } from './ax-tree.ts'
import { type CdpSessionLike, attachFormIssues } from './form-issues.ts'
import { captureContrast } from './contrast-capture.ts'
import { type FrameDriver, runAxeInFrames } from './frames.ts'
import { buildReach, closedShadowRoots } from './reach.ts'
import { captureImageNodes } from './image-capture.ts'
import { collectInPage } from './in-page.ts'
import { attachMotionFacts } from './motion.ts'
import { collectPresentation } from './presentation.ts'
import { labelTargets, measureLabels } from './label-visibility.ts'
import { type Scope, resolveScopeInPage, scopeTree } from './scope.ts'
import type { Collected } from './web.ts'

/**
 * What collecting from a page that is already open needs from the browser library.
 * Playwright and Puppeteer pages both provide it, so each adapter is a few lines and
 * the code that runs in the page is the same for both.
 */
export interface PageDriver extends FrameDriver {
  url(): string
  /** A PNG of the element a ref resolves to, as rendered, in a frame or a shadow root too (snapshot/refs.ts); undefined when it cannot be captured. */
  screenshotElement(ref: string): Promise<Uint8Array | undefined>
  /** A full-page PNG written to `path`. */
  screenshotPage(path: string): Promise<void>
  /** A CDP session on the page, in Chromium; Rampa reads the browser's own form issues through it. */
  cdp?(): Promise<CdpSessionLike | undefined>
}

export interface PageCollectOptions {
  locale: Locale
  maxNodes?: number | undefined
  screenshotDir?: string | undefined
  /** Attach a PNG of each image as rendered, for criteria that need vision. */
  captureImages?: boolean | undefined
  /** Check only part of the page. */
  scope?: Scope | undefined
  /** Which WCAG version's axe-core rules run; 2.2 by default. */
  wcag?: WcagVersion | undefined
  /** Measure from pixels the contrast axe-core cannot decide, placeholders and icon-only controls; on by default. */
  pixelContrast?: boolean | undefined
  /** Read the browser's own accessibility tree onto the nodes (`ax`), in Chromium; on by default (surfaces/ax-tree.ts). */
  axTree?: boolean | Partial<AxLimits> | undefined
  /** Records where the page's time goes (`timings: true`, core/timings.ts). */
  timings?: Stopwatch | undefined
  /** Images captured at most (image-capture.ts's IMAGE_LIMIT by default); fast mode captures fewer. */
  imageLimit?: number | undefined
  /** Measure how reading text and controls are presented, for the cognitive profile (surfaces/presentation.ts). */
  presentation?: boolean | undefined
}

const MAX_NODES = 5000

/**
 * Collects the page as it is now: no navigation and no new browser context, so the caller's
 * login, storage, route mocks and app state all apply. Without a scope it builds the same
 * snapshot and engine results as `collectWeb` on the same page; a test holds the two to that.
 */
export async function collectPage(driver: PageDriver, options: PageCollectOptions): Promise<Collected> {
  const url = driver.url()
  const scope = options.scope
  const maxNodes = options.maxNodes ?? MAX_NODES
  const watch = options.timings
  // Selectors are checked before any work, so a typo fails loudly instead of checking nothing.
  if (scope) assertSelectors(await driver.evaluate(resolveScopeInPage, { ...scope, refs: [] }), url)

  await timed(watch, 'axe', async () => driver.run(await axeSource()))
  const raw = await timed(watch, 'collection', async () => {
    const read = await driver.evaluate(collectInPage, { maxNodes })
    await driver.run(resolverSource())
    return read
  })
  const cdp = driver.cdp?.bind(driver)
  // The browser's own tree, read right after Rampa's, as collectWeb reads it.
  const axTree = cdp && options.axTree !== false ? await timed(watch, 'ax-tree', () => attachAxTree(cdp, raw.root as A11yNode, axLimits(options.axTree))) : undefined
  const checked = await timed(watch, 'axe', async () =>
    runAxeInFrames(
      driver,
      {
        tags: axeTags(options.wcag),
        rules: AXE_REVIEW_RULES,
        locale: await axeLocale(options.locale),
        context: scope ? { ...(scope.include.length > 0 ? { include: scope.include } : {}), exclude: scope.exclude } : undefined,
      },
      axeSource,
    ),
  )

  let root = raw.root as A11yNode
  const closed = await timed(watch, 'collection', async () => {
    if (!cdp) return undefined
    await attachFormIssues(cdp, root)
    return closedShadowRoots(cdp)
  })
  const reach = buildReach({
    frames: raw.frames,
    engineFrames: checked.frames,
    shadowRoots: raw.shadowRoots,
    closed,
    truncated: raw.beyondTruncated,
  })
  // Before captures scroll the page, as collectWeb measures it.
  const presentation = options.presentation
    ? await timed(watch, 'collection', () => collectPresentation({ evaluate: (fn, arg) => driver.evaluate(fn, arg), cdp }), 'presentation')
    : undefined
  if (scope) root = await timed(watch, 'collection', () => scopeRoot(driver, root, scope, { url, truncated: raw.truncated, maxNodes }))
  const engine = engineFromAxe(checked.axe)
  const contrast = options.pixelContrast !== false
  const labels = labelTargets(root).length > 0
  if (options.captureImages || labels || contrast) {
    // Element screenshots scroll the page; the caller's test carries on from where it was.
    const scroll = await driver.evaluate(() => [window.scrollX, window.scrollY], null)
    if (options.captureImages) await timed(watch, 'image-capture', () => captureImages(driver, root, options.imageLimit))
    // Whether each label 3.3.2 relies on shows its text, as collectWeb measures it (label-visibility.ts).
    if (labels) {
      await timed(watch, 'label-visibility', () => measureLabels({ evaluate: (fn, arg) => driver.evaluate(fn, arg), screenshot: (ref) => driver.screenshotElement(ref) }, root))
    }
    if (contrast) {
      await timed(watch, 'pixel-contrast', () => captureContrast({ evaluate: (fn, arg) => driver.evaluate(fn, arg), screenshot: (ref) => driver.screenshotElement(ref) }, root, engine))
    }
    await driver.evaluate(([x = 0, y = 0]) => window.scrollTo(x, y), scroll)
  }

  let screenshot: string | undefined
  if (options.screenshotDir) {
    await mkdir(options.screenshotDir, { recursive: true })
    const path = join(options.screenshotDir, `${sha256(url).slice(0, 16)}.png`)
    screenshot = path
    await timed(watch, 'screenshot', () => driver.screenshotPage(path))
  }
  // What the page does with the device's motion (2.5.4), as collectWeb reads it; a page-level fact, so not for a scope.
  if (cdp && !scope) await timed(watch, 'collection', () => attachMotionFacts(cdp, root))

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
    ...(reach ? { reach } : {}),
    ...(axTree ? { axTree } : {}),
    ...(presentation ? { presentation } : {}),
    collectedAt: new Date().toISOString(),
    collector: { name: 'rampa-web', version: VERSION },
  }
  return { snapshot, engine }
}

function assertSelectors(answer: { invalid: Array<{ selector: string; error: string }>; unmatched: string[] }, url: string): void {
  const invalid = answer.invalid[0]
  if (invalid) throw new RampaError('invalid-selector', `"${invalid.selector}" is not a valid CSS selector: ${invalid.error}`)
  const unmatched = answer.unmatched[0]
  if (unmatched !== undefined) throw new RampaError('scope-not-found', `No element on ${url} matches the include selector "${unmatched}".`)
}

async function scopeRoot(driver: PageDriver, root: A11yNode, scope: Scope, page: { url: string; truncated: boolean; maxNodes: number }): Promise<A11yNode> {
  const refs = [...walkTree(root)].map((node) => node.ref)
  const answer = await driver.evaluate(resolveScopeInPage, { ...scope, refs })
  const quoted = (selectors: string[]) => selectors.map((selector) => `"${selector}"`).join(', ')
  if (scope.include.length > 0 && answer.included.length === 0) {
    const why = page.truncated ? `: the collector stopped after ${page.maxNodes} elements, before reaching them (raise maxNodes)` : ''
    throw new RampaError('scope-not-collected', `The elements matched by ${quoted(scope.include)} on ${page.url} are not in the snapshot${why}.`)
  }
  const included = new Set(answer.included)
  const scoped = scopeTree(root, included, new Set(answer.excluded))
  if (!scoped) throw new RampaError('scope-empty', `Nothing on ${page.url} is left to check: ${quoted(scope.exclude)} covers all of it.`)
  // A component that is not rendered yet, such as a closed dialog, would pass a check of nothing.
  const roots = [...walkTree(scoped)].filter((node) => included.has(node.ref))
  if (roots.length > 0 && !roots.some((node) => [...walkTree(node)].some((inner) => !inner.states.includes('hidden')))) {
    throw new RampaError('scope-hidden', `${quoted(scope.include)} on ${page.url} matches only elements that are not rendered (display: none or visibility: hidden), so there is nothing to check. Show them first.`)
  }
  return scoped
}

/**
 * The images `collectWeb` captures, taken through the driver: as people see them, size, crop, CSS and all,
 * each scrolled into view and loaded first, and left without a capture, saying why, when the screenshot
 * would not be its own pixels (image-capture.ts).
 */
async function captureImages(driver: PageDriver, root: A11yNode, limit: number | undefined): Promise<void> {
  await captureImageNodes({ evaluate: (fn, arg) => driver.evaluate(fn, arg), screenshot: (ref) => driver.screenshotElement(ref) }, root, { limit })
}
