// Rampa's corrupted pairs as static pages every tool can load. `rampa eval` breaks a passing test page in the live
// browser before checking it; other tools only take a URL, so here each half is built once in Edge and saved:
//   intact     the page as the browser built it, with nothing changed;
//   corrupted  the same page after Rampa's corruptor ran on it (src/eval/pairs.ts, unchanged).
// Both halves are serialized the same way and served by lib/server.mjs at the test page's own path, so relative
// links and images resolve as on www.w3.org. Scripts already ran when a half was saved, so they are kept inert in
// both halves: the saved DOM is what they built.
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { NAVIGATION_TIMEOUT_MS, browserPath } from './env.mjs'

/** The document as the browser holds it, open shadow roots included, with its scripts made inert. */
function serialize() {
  const roots = []
  const collect = (root) => {
    for (const element of root.querySelectorAll('*')) {
      if (element.shadowRoot) {
        roots.push(element.shadowRoot)
        collect(element.shadowRoot)
      }
    }
  }
  collect(document)
  const scripts = document.querySelectorAll('script').length
  const frames = document.querySelectorAll('iframe, frame, object, embed').length
  for (const script of document.querySelectorAll('script')) script.setAttribute('type', 'text/x-bench-inert')
  const root = document.documentElement
  const escape = (value) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
  const attributes = Array.from(root.attributes, (a) => ` ${a.name}="${escape(a.value)}"`).join('')
  const inner = typeof root.getHTML === 'function' ? root.getHTML({ serializableShadowRoots: true, shadowRoots: roots }) : root.innerHTML
  const doctype = document.doctype ? `<!DOCTYPE ${document.doctype.name}>` : ''
  return { html: `${doctype}\n<html${attributes}>${inner}</html>\n`, scripts, frames, shadowRoots: roots.length }
}

async function open(browser, url) {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(url, { waitUntil: 'load', timeout: NAVIGATION_TIMEOUT_MS })
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {})
  return { context, page }
}

const sha = (text) => createHash('sha256').update(text).digest('hex').slice(0, 16)

/**
 * Builds every pair's pages under `dir` and returns the pairs with their two page ids, the corrupted copies the
 * corruptor left unchanged (no pair, as in `rampa eval`), and what the saved pages hold that a copy cannot keep live.
 */
export async function buildPairs(specs, corruptors, { dir, origin, log = () => {} }) {
  const corruptorOf = new Map(Object.values(corruptors).flat().map((corruptor) => [corruptor.id, corruptor]))
  const browser = await chromium.launch({ executablePath: browserPath(), headless: true })
  const served = new Map()
  const pages = []
  const pairs = []
  const dropped = []
  const notes = { withScripts: new Set(), withFrames: new Set(), withShadowRoots: new Set() }
  const pathOf = (url) => new URL(url).pathname

  async function save(id, url, variant, result) {
    const file = join(dir, `${id.replace(/[^\w.-]+/g, '_')}.html`)
    await mkdir(dir, { recursive: true })
    await writeFile(file, result.html, 'utf8')
    const key = `${pathOf(url)}?bench=${variant}`
    served.set(key, file)
    if (result.scripts > 0) notes.withScripts.add(url)
    if (result.frames > 0) notes.withFrames.add(url)
    if (result.shadowRoots > 0) notes.withShadowRoots.add(url)
    pages.push({ id, url: `${origin}${key}`, kind: variant === 'intact' ? 'pair-intact' : 'pair-corrupted', sha: sha(result.html) })
  }

  try {
    const testcases = new Map(specs.map((spec) => [spec.url, spec]))
    for (const [url, spec] of testcases) {
      const { context, page } = await open(browser, url)
      try {
        await save(`intact:${spec.ruleId}:${spec.testcaseId}`, url, 'intact', await page.evaluate(serialize))
      } finally {
        await context.close()
      }
    }
    for (const spec of specs) {
      const corruptor = corruptorOf.get(spec.corruptor)
      const { context, page } = await open(browser, spec.url)
      try {
        const changed = await corruptor.apply(page)
        if (!changed) {
          dropped.push({ ...spec, reason: 'the corruptor changed nothing on this page' })
          continue
        }
        const id = `corrupt:${spec.corruptor}:${spec.ruleId}:${spec.testcaseId}`
        await save(id, spec.url, spec.corruptor, await page.evaluate(serialize))
        pairs.push({ ...spec, changed, intactId: `intact:${spec.ruleId}:${spec.testcaseId}`, corruptedId: id })
      } finally {
        await context.close()
      }
      log(`  pairs: ${pairs.length + dropped.length}/${specs.length}`)
    }
  } finally {
    await browser.close()
  }
  return {
    pairs,
    dropped,
    pages,
    served,
    notes: { withScripts: [...notes.withScripts], withFrames: [...notes.withFrames], withShadowRoots: [...notes.withShadowRoots] },
  }
}
