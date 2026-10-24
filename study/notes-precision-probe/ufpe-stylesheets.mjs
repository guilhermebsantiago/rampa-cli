// One live load of www.ufpe.br in headless Edge: are its stylesheets applied, and which failed? (The round-3
// capture rendered the page without its theme CSS, which made a hidden type-ahead list visible: 50 false positives.)
import { chromium } from 'playwright-core'
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
const failed = []
page.on('requestfailed', (r) => { if (r.resourceType() === 'stylesheet') failed.push({ url: r.url(), error: r.failure()?.errorText }) })
page.on('response', (r) => { if (r.request().resourceType() === 'stylesheet' && r.status() >= 400) failed.push({ url: r.url(), status: r.status() }) })
const started = Date.now()
await page.goto('https://www.ufpe.br/', { waitUntil: 'load', timeout: 60000 }).catch((e) => console.log('goto:', e.message))
await page.waitForTimeout(3000)
const facts = await page.evaluate(() => {
  const links = [...document.querySelectorAll('link[rel~="stylesheet"]')]
  const sheets = links.map((l) => { let rules = null; try { rules = l.sheet ? l.sheet.cssRules.length : null } catch { rules = 'cross-origin' } return { href: l.href.slice(0, 120), loaded: !!l.sheet, rules } })
  const list = document.querySelector('#search-list')
  const style = list ? getComputedStyle(list) : null
  return { title: document.title, linked: links.length, sheets, bodyFont: getComputedStyle(document.body).fontFamily.slice(0, 60), searchList: list ? { display: style.display, height: list.getBoundingClientRect().height, items: list.querySelectorAll('a').length } : null, docHeight: document.documentElement.scrollHeight }
})
console.log(JSON.stringify({ ms: Date.now() - started, failed, ...facts }, null, 1))
await browser.close()
