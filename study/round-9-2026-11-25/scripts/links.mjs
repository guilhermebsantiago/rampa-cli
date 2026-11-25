// Lists a page's links as headless Edge sees them, to pick an inner page on a site that passed the
// pre-screen. Run from the repository root: node study/round-9-2026-11-25/scripts/links.mjs <url> [filter]
//
// The sixth to eighth studies' links.mjs, unchanged (it is the fifth study's with a third column: where the link sits, "header", "nav" or "footer" when it has a
// header, nav or footer element (or the banner, navigation or contentinfo role) around it, else "main". The inner-page
// rules read it: a store's category comes from its menus, an article from the page's content (scripts/pick.py)).
import { chromium } from 'playwright-core'

const [, , url, filter] = process.argv
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
await page.goto(url, { waitUntil: 'load', timeout: 30000 })
await page.waitForTimeout(3000)
const links = await page.evaluate(() =>
  [...document.querySelectorAll('a[href]')].map((a) => {
    const region = a.closest('nav, [role=navigation]') ? 'nav' : a.closest('header, [role=banner]') ? 'header' : a.closest('footer, [role=contentinfo]') ? 'footer' : 'main'
    return `${a.href}\t${(a.innerText || a.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 60)}\t${region}`
  }),
)
const seen = new Set()
for (const line of links) {
  const href = line.split('\t')[0]
  if (seen.has(href) || (filter && !new RegExp(filter).test(href))) continue
  seen.add(href)
  console.log(line)
}
await browser.close()
