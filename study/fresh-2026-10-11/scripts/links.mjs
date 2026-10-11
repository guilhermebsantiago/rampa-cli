// Lists a page's links as headless Edge sees them, to pick an inner page on a site that passed the
// pre-screen. Run from the repository root: node study/fresh-2026-10-11/scripts/links.mjs <url> [filter]
import { chromium } from 'playwright-core'

const [, , url, filter] = process.argv
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
await page.goto(url, { waitUntil: 'load', timeout: 30000 })
await page.waitForTimeout(3000)
const links = await page.evaluate(() => [...document.querySelectorAll('a[href]')].map((a) => `${a.href}\t${(a.innerText || a.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 60)}`))
const seen = new Set()
for (const line of links) {
  const href = line.split('\t')[0]
  if (seen.has(href) || (filter && !new RegExp(filter).test(href))) continue
  seen.add(href)
  console.log(line)
}
await browser.close()
