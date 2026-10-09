import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { RampaError, sha256 } from '../core/util.ts'
import { AXE_TAGS, axeLocale, axeSource, emptyEngine, engineFromAxe } from '../engine/axe.ts'
import type { Locale } from '../i18n.ts'
import type { A11yNode, A11ySnapshot } from '../snapshot/schema.ts'
import { walkTree } from '../snapshot/tree.ts'
import { VERSION } from '../version.ts'
import { collectInPage } from './in-page.ts'
import { type Scope, resolveScopeInPage, scopeTree } from './scope.ts'
import type { Collected } from './web.ts'

/**
 * What collecting from a page that is already open needs from the browser library.
 * Playwright and Puppeteer pages both provide it, so each adapter is a few lines and
 * the code that runs in the page is the same for both.
 */
export interface PageDriver {
  url(): string
  /** Runs a self-contained function in the page with one JSON argument, and returns its JSON result. */
  evaluate<Arg, Result>(fn: (arg: Arg) => Result | Promise<Result>, arg: Arg): Promise<Result>
  /** Runs script source in the page as a <script> would, without adding one, so the page's CSP cannot block it. */
  run(source: string): Promise<void>
  /** A PNG of the element a ref resolves to, as rendered; undefined when it cannot be captured. */
  screenshotElement(ref: string): Promise<Uint8Array | undefined>
  /** A full-page PNG written to `path`. */
  screenshotPage(path: string): Promise<void>
}

export interface PageCollectOptions {
  locale: Locale
  maxNodes?: number | undefined
  screenshotDir?: string | undefined
  /** Attach a PNG of each image as rendered, for criteria that need vision. */
  captureImages?: boolean | undefined
  /** Check only part of the page. */
  scope?: Scope | undefined
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
  // Selectors are checked before any work, so a typo fails loudly instead of checking nothing.
  if (scope) assertSelectors(await driver.evaluate(resolveScopeInPage, { ...scope, refs: [] }), url)

  await driver.run(await axeSource())
  const raw = await driver.evaluate(collectInPage, {
    runAxe: true,
    axeTags: AXE_TAGS,
    axeLocale: await axeLocale(options.locale),
    maxNodes,
    axeContext: scope ? { ...(scope.include.length > 0 ? { include: scope.include } : {}), exclude: scope.exclude } : undefined,
  })

  let root = raw.root as A11yNode
  if (scope) root = await scopeRoot(driver, root, scope, { url, truncated: raw.truncated, maxNodes })
  if (options.captureImages) await captureImages(driver, root)

  let screenshot: string | undefined
  if (options.screenshotDir) {
    await mkdir(options.screenshotDir, { recursive: true })
    screenshot = join(options.screenshotDir, `${sha256(url).slice(0, 16)}.png`)
    await driver.screenshotPage(screenshot)
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
    collectedAt: new Date().toISOString(),
    collector: { name: 'rampa-web', version: VERSION },
  }
  const engine = raw.axe ? engineFromAxe(raw.axe) : emptyEngine()
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
  const scoped = scopeTree(root, new Set(answer.included), new Set(answer.excluded))
  if (!scoped) throw new RampaError('scope-empty', `Nothing on ${page.url} is left to check: ${quoted(scope.exclude)} covers all of it.`)
  return scoped
}

const IMAGE_LIMIT = 25

/** The images `collectWeb` captures, taken through the driver: as people see them, size, crop, CSS and all. */
async function captureImages(driver: PageDriver, root: A11yNode): Promise<void> {
  const targets: A11yNode[] = []
  for (const node of walkTree(root)) {
    const attributes = (node.native.attributes ?? {}) as Record<string, string>
    const isImage =
      node.native.tag === 'img' ||
      node.role === 'img' ||
      (node.native.tag === 'input' && attributes.type === 'image') ||
      (node.native.tag === 'canvas' && Boolean(node.name))
    if (!isImage || node.states.includes('hidden') || !node.bounds) continue
    if (node.bounds.width < 8 || node.bounds.height < 8) continue
    targets.push(node)
    if (targets.length >= IMAGE_LIMIT) break
  }
  for (const node of targets) {
    // Not visible or detached: criteria that need the image skip this node.
    const png = await driver.screenshotElement(node.ref)
    if (png) node.image = `data:image/png;base64,${Buffer.from(png).toString('base64')}`
  }
}
