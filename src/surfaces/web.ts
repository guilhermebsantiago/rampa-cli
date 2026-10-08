import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { type Browser, type Page, chromium } from 'playwright-core'
import type { EngineResults } from '../core/types.ts'
import { RampaError, errorMessage, sha256 } from '../core/util.ts'
import { AXE_TAGS, axeLocale, axeSource, emptyEngine, engineFromAxe } from '../engine/axe.ts'
import type { Locale } from '../i18n.ts'
import type { A11yNode, A11ySnapshot } from '../snapshot/schema.ts'
import { VERSION } from '../version.ts'
import { walkTree } from '../snapshot/tree.ts'
import { collectInPage } from './in-page.ts'

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
}

export interface Collected {
  snapshot: A11ySnapshot
  engine: EngineResults
}

const CHANNELS = ['chrome', 'msedge', 'chromium'] as const

/** Uses the Chrome or Edge already installed; falls back to Playwright's Chromium if it was downloaded. */
export async function launchBrowser(): Promise<Browser> {
  const preferred = process.env.RAMPA_BROWSER_CHANNEL
  const channels = preferred ? [preferred] : CHANNELS
  const failures: string[] = []
  for (const channel of channels) {
    try {
      return await chromium.launch({ channel: channel === 'chromium' ? undefined : channel, headless: true })
    } catch (error) {
      failures.push(`${channel}: ${errorMessage(error)}`)
    }
  }
  throw new RampaError(
    'browser-not-found',
    `No browser found. Install Chrome or Edge, or run "npx playwright-core install chromium".\n${failures.join('\n')}`,
  )
}

export async function collectWeb(browser: Browser, url: string, options: WebCollectOptions): Promise<Collected> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, bypassCSP: true })
  const page = await context.newPage()
  try {
    await page.goto(url, { waitUntil: 'load', timeout: options.timeoutMs ?? 30_000 })
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
      collectedAt: new Date().toISOString(),
      collector: { name: 'rampa-web', version: VERSION },
    }
    const engine = raw.axe ? engineFromAxe(raw.axe) : emptyEngine()
    return { snapshot, engine }
  } finally {
    await context.close()
  }
}

const IMAGE_LIMIT = 25

/** Element screenshots show the image exactly as people see it: size, crop, CSS and all. */
async function captureImages(page: Page, root: A11yNode): Promise<void> {
  const targets: A11yNode[] = []
  for (const node of walkTree(root)) {
    const attributes = (node.native.attributes ?? {}) as Record<string, string>
    const isImage = node.native.tag === 'img' || node.role === 'img' || (node.native.tag === 'input' && attributes.type === 'image')
    if (!isImage || node.states.includes('hidden') || !node.bounds) continue
    if (node.bounds.width < 8 || node.bounds.height < 8) continue
    targets.push(node)
    if (targets.length >= IMAGE_LIMIT) break
  }
  for (const node of targets) {
    try {
      const png = await page.locator(`css=${node.ref}`).first().screenshot({ type: 'png', timeout: 5000, animations: 'disabled' })
      node.image = `data:image/png;base64,${png.toString('base64')}`
    } catch {
      // Not visible or detached: criteria that need the image skip this node.
    }
  }
}
