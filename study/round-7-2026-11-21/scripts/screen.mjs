// Pre-screen of candidate pages, before the selection is fixed: does each load in headless Edge (the
// browser the study runs) with no bot challenge, error page or sign-in wall? This decides only whether a
// candidate is usable; it runs no part of Rampa.
//
// The sixth study's screen.mjs (study/round-6-2026-10-29/scripts/screen.mjs), unchanged but for this comment: the same
// load, wait, challenge pattern, page shape and the recorded facts `wall`, `geo` and `errorTitle`. The rules that decide
// a candidate are in scripts/candidates.tsv.
//
// Run from the repository root:
//   node study/round-7-2026-11-21/scripts/screen.mjs <candidates.tsv> <screen.json>
import { readFileSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright-core'

const [, , input, output] = process.argv
const rows = readFileSync(input, 'utf8')
  .split(/\r?\n/)
  .filter((line) => line.trim() && !line.startsWith('#'))
  .map((line) => line.split('\t'))
const CHALLENGE = /just a moment|verify you are human|access denied|attention required|are you a robot|captcha|pardon our interruption|request unsuccessful|forbidden|unusual traffic|incapsula|perimeterx|datadome/i
const WALL = /subscribers?[- ]only|exclusive subscriber|subscribe (now )?to (continue|keep) reading|subscribe to read|to continue reading,? (please )?(subscribe|sign in|log in|register)|sign in to (continue|read)|log in to (continue|read)|register to (continue|read)|create a free account to (continue|read)|already a subscriber|conte[uú]do exclusivo para assinantes|exclusivo para assinantes|mat[eé]ria exclusiva|assine para (ler|continuar)|para continuar lendo|continue lendo com|j[aá] [eé] assinante|fa[cç]a (o )?login para (ler|continuar)/i
const GEO = /geographic(al)? restriction|not available in your (country|region|location)|unavailable in your (country|region|location)|n[aã]o est[aá] dispon[ií]vel (no seu pa[ií]s|na sua regi[aã]o)/i
const ERROR_TITLE = /\b(404|403|500|502|503)\b|not found|page not found|p[aá]gina n[aã]o encontrada|\berro\b|\berror\b|unavailable|indispon[ií]vel|maintenance|manuten[cç][aã]o/i

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
      all: document.body?.innerText ?? '',
    }))
    const all = info.all
    delete info.all
    Object.assign(result, info)
    result.challenge = CHALLENGE.test(result.title) || (info.textLength < 2000 && CHALLENGE.test(info.text))
    const wall = WALL.exec(all)
    if (wall) result.wall = all.slice(Math.max(0, wall.index - 60), wall.index + wall[0].length + 60).replace(/\s+/g, ' ')
    const geo = GEO.exec(all.slice(0, 2000))
    if (geo) result.geo = geo[0]
    if (ERROR_TITLE.test(result.title)) result.errorTitle = true
  } catch (error) {
    result.error = String(error?.message ?? error).split('\n')[0]
  }
  result.seconds = Math.round((Date.now() - started) / 100) / 10
  await context.close()
  results.push(result)
  const shape = `L${result.links ?? '-'} I${result.images ?? '-'} H${result.headings ?? '-'} F${result.fields ?? '-'} P${result.password ?? '-'} T${result.textLength ?? '-'}`
  const flags = `${result.challenge ? 'CHALLENGE ' : ''}${result.wall ? 'WALL ' : ''}${result.geo ? 'GEO ' : ''}${result.errorTitle ? 'ERRTITLE ' : ''}`
  console.log(`${slot}\t${result.status ?? result.error}\t${flags}${result.lang ?? ''}\t${shape}\t${(result.title ?? '').slice(0, 70)}\t${result.finalUrl ?? url}`)
}
const queue = [...rows]
await Promise.all(Array.from({ length: 3 }, async () => {
  while (queue.length) await one(queue.shift())
}))
await browser.close()
results.sort((a, b) => rows.findIndex((r) => r[0] === a.slot) - rows.findIndex((r) => r[0] === b.slot))
writeFileSync(output, `${JSON.stringify(results, null, 2)}\n`)
