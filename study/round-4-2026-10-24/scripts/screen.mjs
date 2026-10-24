// Pre-screen of candidate pages, before the selection is fixed: does each load in headless Edge (the
// browser the study runs) with no bot challenge, error page or sign-in wall? This decides only whether a
// candidate is usable; it runs no part of Rampa.
//
// Run from the repository root:
//   node study/round-4-2026-10-24/scripts/screen.mjs study/round-4-2026-10-24/scripts/candidates.tsv study/round-4-2026-10-24/data/screen.json
import { readFileSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright-core'

const [, , input, output] = process.argv
const rows = readFileSync(input, 'utf8')
  .split(/\r?\n/)
  .filter((line) => line.trim() && !line.startsWith('#'))
  .map((line) => line.split('\t'))
const CHALLENGE = /just a moment|verify you are human|access denied|attention required|are you a robot|captcha|pardon our interruption|request unsuccessful|forbidden|unusual traffic|incapsula|perimeterx|datadome/i

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const results = []
async function one([slot, url]) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await context.newPage()
  const started = Date.now()
  const result = { slot, url }
  try {
    const response = await page.goto(url, { waitUntil: 'load', timeout: 30000 })
    await page.waitForTimeout(2500)
    result.status = response?.status()
    result.finalUrl = page.url()
    result.title = await page.title()
    const info = await page.evaluate(() => ({
      lang: document.documentElement.lang,
      text: document.body?.innerText?.slice(0, 300) ?? '',
      textLength: document.body?.innerText?.length ?? 0,
      links: document.querySelectorAll('a[href]').length,
      images: document.querySelectorAll('img').length,
      headings: document.querySelectorAll('h1,h2,h3,h4,h5,h6').length,
      fields: document.querySelectorAll('input:not([type=hidden]),select,textarea').length,
      password: document.querySelectorAll('input[type=password]').length,
    }))
    Object.assign(result, info)
    result.challenge = CHALLENGE.test(result.title) || (info.textLength < 2000 && CHALLENGE.test(info.text))
  } catch (error) {
    result.error = String(error?.message ?? error).split('\n')[0]
  }
  result.seconds = Math.round((Date.now() - started) / 100) / 10
  await context.close()
  results.push(result)
  const shape = `L${result.links ?? '-'} I${result.images ?? '-'} H${result.headings ?? '-'} F${result.fields ?? '-'} P${result.password ?? '-'}`
  console.log(`${slot}\t${result.status ?? result.error}\t${result.challenge ? 'CHALLENGE ' : ''}${result.lang ?? ''}\t${shape}\t${(result.title ?? '').slice(0, 70)}\t${result.finalUrl ?? url}`)
}
const queue = [...rows]
await Promise.all(Array.from({ length: 3 }, async () => {
  while (queue.length) await one(queue.shift())
}))
await browser.close()
results.sort((a, b) => rows.findIndex((r) => r[0] === a.slot) - rows.findIndex((r) => r[0] === b.slot))
writeFileSync(output, `${JSON.stringify(results, null, 2)}\n`)
