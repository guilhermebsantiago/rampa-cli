// Proves that review packages load and render the same in two Rampa Labs: the deployed one (Lab A) and the branch
// that will replace it (Lab B).
//
//   node study/human-review-2026-10/scripts/compare-lab.mjs --lab-a <dir> --lab-b <dir> --package <dir> [--package <dir> …]
//        [--url-a http://localhost:4173/ --url-b http://localhost:4174/]
//
// Data level, always: loads each package with each Lab's own readReviewFiles and mergeEntries (imported from its
// src/lib, as check-lab.mjs does, from the .json files its folder picker would hand over) and requires the load
// outcome, the list of entries, and elementContext for every entry to be deep-equal as JSON.
//
// Rendered level, when both URLs are given (each Lab built and served, e.g. `npx vite preview --port 4173 --strictPort`):
// with playwright-core from Lab B's node_modules and the msedge channel, a fresh browser context for each Lab and
// package, it opens <url>pt/?view=review, picks the package's folder in the folder input (#review-folder-input), and
// steps through every item with the Lab's own "next" button. For each item it takes the outerHTML of the item
// section (section.item), with two normalisations applied to both sides alike:
//   - per-render ids: Svelte's $props.id() gives each render an id `c<n>` from a page-wide counter; where it starts
//     the value (or a token of the value) of an id, for, name, headers, list, form or ARIA id-reference attribute, or
//     follows the # of an in-page href, it is replaced by `uid<k>`, k counting the distinct ids in order of appearance
//     within the item;
//   - empty HTML comments (`<!---->`), the anchors Svelte leaves for a conditional block, are removed.
// The two Labs must give the same item count and the same string for every item. On a difference it prints the
// item's fingerprint and a short diff of the markup and exits non-zero. Otherwise it prints counts and digests only:
// never an item's message, evidence or HTML.

import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const args = process.argv.slice(2)
const opt = (name) => {
  const at = args.indexOf(name)
  return at === -1 ? undefined : args[at + 1]
}
const all = (name) => args.flatMap((a, i) => (a === name && args[i + 1] !== undefined ? [args[i + 1]] : []))
const labA = opt('--lab-a') && resolve(opt('--lab-a'))
const labB = opt('--lab-b') && resolve(opt('--lab-b'))
const packages = all('--package').map((p) => resolve(p))
const urlA = opt('--url-a')
const urlB = opt('--url-b')
if (!labA || !labB || packages.length === 0 || (urlA === undefined) !== (urlB === undefined)) {
  console.error('usage: node compare-lab.mjs --lab-a <dir> --lab-b <dir> --package <dir> [--package <dir> …] [--url-a <url> --url-b <url>]')
  process.exit(2)
}

const failures = []
const fail = (message) => failures.push(message)

function filesUnder(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...filesUnder(path))
    else out.push(path)
  }
  return out
}

/** What the Lab's folder picker hands review mode: the .json files (not *.engine.json), by their path from the folder's parent. As in check-lab.mjs. */
function asPicked(dir) {
  return filesUnder(dir)
    .filter((p) => p.toLowerCase().endsWith('.json') && !p.toLowerCase().endsWith('.engine.json'))
    .map((p) => ({ path: relative(dirname(dir), p).split(sep).join('/'), text: readFileSync(p, 'utf8') }))
}

/** JSON with every object's keys sorted, so two values that are deep-equal as JSON give the same string. */
function canonical(value) {
  return JSON.stringify(value, (_, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]])) : v))
}

const digest = (text) => createHash('sha256').update(text).digest('hex').slice(0, 16)

/** The paths at which two JSON values differ (at most `max`), each with both sides cut short. */
function jsonDiff(a, b, path = '', out = [], max = 6) {
  if (out.length >= max) return out
  if (canonical(a) === canonical(b)) return out
  const isObj = (v) => v && typeof v === 'object'
  if (isObj(a) && isObj(b) && Array.isArray(a) === Array.isArray(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) jsonDiff(a[k], b[k], `${path}${Array.isArray(a) ? `[${k}]` : `.${k}`}`, out, max)
    return out
  }
  const cut = (v) => {
    const s = v === undefined ? 'undefined' : JSON.stringify(v)
    return s.length > 160 ? `${s.slice(0, 160)}…` : s
  }
  out.push(`${path || '(value)'}: A ${cut(a)} | B ${cut(b)}`)
  return out
}

/** A short diff of two strings: where they start to differ, and the differing middle of each, cut short. */
function textDiff(a, b) {
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }
  const cut = (s) => (s.length > 600 ? `${s.slice(0, 600)}… (${s.length} characters)` : s)
  const lead = a.slice(Math.max(0, start - 120), start)
  return [`  lengths: A ${a.length}, B ${b.length}; first difference at character ${start}`, `  before: …${lead}`, `  A: ${cut(a.slice(start, endA))}`, `  B: ${cut(b.slice(start, endB))}`].join('\n')
}

// Data level.

async function labCode(dir) {
  const lib = (name) => import(pathToFileURL(join(dir, 'src', 'lib', name)).href)
  const input = await lib('review-input.ts')
  const format = await lib('review-format.ts')
  return { ...input, orderEntries: format.orderEntries }
}

function loadWith(code, dir) {
  const out = code.readReviewFiles(asPicked(dir))
  const entries = code.mergeEntries(out.sources)
  const contexts = entries.map((e) => {
    const snapshot = out.snapshots.find((s) => code.sameTarget(s.target, e.page))
    return snapshot ? (code.elementContext(snapshot, e.ref) ?? null) : null
  })
  const outcome = {
    problems: out.problems,
    sources: out.sources.map((s) => ({ id: s.id, kind: s.kind, pages: s.pages, counts: s.counts, warnings: s.warnings })),
    snapshots: out.snapshots.map((s) => s.id),
    labelFiles: out.labelFiles,
    other: out.other,
  }
  return { outcome, entries, contexts, ordered: code.orderEntries(entries) }
}

const codeA = await labCode(labA)
const codeB = await labCode(labB)
const summary = []
const loaded = new Map()

for (const dir of packages) {
  const name = dir.split(sep).at(-1)
  const a = loadWith(codeA, dir)
  const b = loadWith(codeB, dir)
  loaded.set(dir, { a, b })
  const result = { package: name, data: { entries: a.entries.length, entriesB: b.entries.length, outcomeSame: false, entriesSame: false, elementContextsSame: false } }
  summary.push(result)
  const where = (m) => `${name}, data level: ${m}`
  result.data.outcomeSame = canonical(a.outcome) === canonical(b.outcome)
  if (!result.data.outcomeSame) fail(where(`the load outcome differs\n  ${jsonDiff(a.outcome, b.outcome).join('\n  ')}`))
  result.data.entriesSame = canonical(a.entries) === canonical(b.entries)
  if (!result.data.entriesSame) {
    const count = Math.max(a.entries.length, b.entries.length)
    for (let i = 0; i < count; i++) {
      const ea = a.entries[i]
      const eb = b.entries[i]
      if (canonical(ea) !== canonical(eb)) fail(where(`entry ${i + 1} (${ea?.fingerprint ?? '-'} / ${eb?.fingerprint ?? '-'}) differs\n  ${jsonDiff(ea, eb).join('\n  ')}`))
    }
  }
  result.data.elementContextsSame = canonical(a.contexts) === canonical(b.contexts)
  if (!result.data.elementContextsSame) {
    a.contexts.forEach((ca, i) => {
      if (canonical(ca) !== canonical(b.contexts[i])) fail(where(`elementContext of entry ${i + 1} (${a.entries[i]?.fingerprint}) differs\n  ${jsonDiff(ca, b.contexts[i]).join('\n  ')}`))
    })
  }
  result.data.withElement = a.contexts.filter((c) => c !== null).length
  result.data.digest = digest(canonical([a.outcome, a.entries, a.contexts]))
}

// Rendered level.

/** Svelte's $props.id() on the client: `c` and a page-wide counter (svelte/src/internal/client/dom/template.js, props_id). */
const GENERATED_ID = /^c\d+(?=-|$)/
/** The attributes whose value is, or lists, an element's id, or names a radio group after the per-render id. */
const ID_ATTRIBUTES = new Set(['id', 'for', 'name', 'headers', 'list', 'form', 'aria-labelledby', 'aria-describedby', 'aria-controls', 'aria-owns', 'aria-activedescendant', 'aria-details', 'aria-errormessage', 'aria-flowto'])

function normaliseIds(html, stats) {
  const ids = new Map()
  const idOf = (generated) => {
    if (!ids.has(generated)) ids.set(generated, `uid${ids.size + 1}`)
    return ids.get(generated)
  }
  const out = html.replace(/(\s)([a-zA-Z-]+)="([^"]*)"/g, (whole, space, attr, value) => {
    const lower = attr.toLowerCase()
    const hash = lower === 'href' && value.startsWith('#')
    if (!ID_ATTRIBUTES.has(lower) && !hash) return whole
    const body = hash ? value.slice(1) : value
    const replaced = body
      .split(/(\s+)/)
      .map((token) =>
        token.replace(GENERATED_ID, (generated) => {
          const key = hash ? 'href (#)' : lower
          stats.ids[key] = (stats.ids[key] ?? 0) + 1
          return idOf(generated)
        }),
      )
      .join('')
    return `${space}${attr}="${hash ? '#' : ''}${replaced}"`
  })
  stats.maxIdsInItem = Math.max(stats.maxIdsInItem, ids.size)
  return out
}

function dropEmptyComments(html, stats) {
  stats.emptyComments += html.split('<!---->').length - 1
  return html.replaceAll('<!---->', '')
}

const normalise = (html, stats) => dropEmptyComments(normaliseIds(html, stats), stats)

const STATUS = '[role="status"][aria-live]'

async function settledHtml(page) {
  let last = await page.$eval('section.item', (el) => el.outerHTML)
  for (let i = 0; i < 40; i++) {
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
    const now = await page.$eval('section.item', (el) => el.outerHTML)
    if (now === last) return now
    last = now
  }
  throw new Error('the item kept changing')
}

async function positionOf(page) {
  const text = await page.$eval('section.item .position', (el) => el.textContent ?? '')
  const numbers = text.replace(/[.,  ](?=\d{3}\b)/g, '').match(/\d+/g)?.map(Number) ?? []
  if (numbers.length < 2) throw new Error('the item shows no position')
  return { at: numbers[0], of: numbers[1] }
}

/** Opens review mode, picks the package's folder, and walks the items with the "next" button. Item HTML stays in memory. */
async function renderedItems(browser, url, dir) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'pt-BR', reducedMotion: 'reduce' })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    await page.goto(new URL('pt/?view=review', url).href, { waitUntil: 'load', timeout: 120_000 })
    await page.waitForSelector('#review-load-title', { timeout: 120_000 })
    // What the folder pick handed the page, read before the Lab's own handler clears the input.
    await page.evaluate(() => {
      window.__picked = undefined
      window.addEventListener('change', (event) => {
        const input = event.target
        if (input instanceof HTMLInputElement && input.id === 'review-folder-input') window.__picked = Array.from(input.files ?? []).map((f) => f.webkitRelativePath || f.name)
      }, true)
    })
    await page.setInputFiles('#review-folder-input', dir, { timeout: 120_000 })
    await page.waitForFunction(() => document.activeElement?.id === 'item-title' && document.querySelector('section.item'), null, { timeout: 120_000 })
    const picked = await page.evaluate(() => window.__picked ?? [])
    const items = []
    const first = await positionOf(page)
    for (;;) {
      const key = await page.evaluate(() => new URL(location.href).searchParams.get('item'))
      const { at, of } = await positionOf(page)
      items.push({ key, at, of, html: await settledHtml(page) })
      if (items.length > first.of + 1) throw new Error('more items than the first one said')
      const status = await page.evaluate((sel) => {
        document.querySelector('section.item').__seen = true
        return document.querySelector(sel)?.textContent ?? ''
      }, STATUS)
      await page.click('section.item .button-row.nav button.primary', { timeout: 120_000 })
      // Either a new item is drawn (a new section, the address names another item, its heading has focus), or, on the
      // last one, the Lab says so in its status region and the item stays.
      const handle = await page.waitForFunction(
        ({ key, status, sel }) => {
          const section = document.querySelector('section.item')
          const now = new URL(location.href).searchParams.get('item')
          if (section && !section.__seen && now !== key && document.activeElement?.id === 'item-title') return 'moved'
          const said = document.querySelector(sel)?.textContent ?? ''
          if (section && section.__seen && now === key && said !== '' && said !== status) return 'end'
          return false
        },
        { key, status, sel: STATUS },
        { timeout: 120_000, polling: 'raf' },
      )
      if ((await handle.jsonValue()) === 'end') {
        if (at !== of) throw new Error(`the Lab stopped at item ${at} of ${of}`)
        break
      }
    }
    return { items, count: first.of, picked, errors }
  } finally {
    await context.close()
  }
}

if (urlA !== undefined) {
  const require = createRequire(join(labB, 'package.json'))
  const { chromium } = require('playwright-core')
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  try {
    for (const dir of packages) {
      const name = dir.split(sep).at(-1)
      const result = summary.find((s) => s.package === name)
      const where = (m) => `${name}, rendered level: ${m}`
      const { a: dataA } = loaded.get(dir)
      const byKey = new Map(dataA.entries.map((e) => [e.key, e.fingerprint]))
      const expectedPick = asPicked(dir).map((f) => f.path).sort()
      const ra = await renderedItems(browser, urlA, dir)
      const rb = await renderedItems(browser, urlB, dir)
      const statsA = { ids: {}, emptyComments: 0, maxIdsInItem: 0 }
      const statsB = { ids: {}, emptyComments: 0, maxIdsInItem: 0 }
      const htmlA = ra.items.map((i) => normalise(i.html, statsA))
      const htmlB = rb.items.map((i) => normalise(i.html, statsB))
      for (const [lab, r] of [['A', ra], ['B', rb]]) {
        for (const e of r.errors) fail(where(`Lab ${lab}: page error: ${e}`))
        const json = r.picked.filter((p) => p.toLowerCase().endsWith('.json') && !p.toLowerCase().endsWith('.engine.json')).sort()
        if (canonical(json) !== canonical(expectedPick)) fail(where(`Lab ${lab}: the folder pick handed over ${json.length} .json files, asPicked gives ${expectedPick.length}`))
        if (r.items.length !== r.count) fail(where(`Lab ${lab}: ${r.items.length} items stepped through, the item says ${r.count}`))
      }
      if (ra.items.length !== rb.items.length) fail(where(`Lab A shows ${ra.items.length} items, Lab B ${rb.items.length}`))
      let same = 0
      const differing = []
      for (let i = 0; i < Math.max(htmlA.length, htmlB.length); i++) {
        const keyA = ra.items[i]?.key
        const keyB = rb.items[i]?.key
        const fingerprint = byKey.get(keyA) ?? byKey.get(keyB) ?? '(unknown)'
        if (keyA !== keyB) {
          fail(where(`item ${i + 1}: Lab A shows ${byKey.get(keyA) ?? '-'}, Lab B ${byKey.get(keyB) ?? '-'}`))
          differing.push(fingerprint)
          continue
        }
        if (htmlA[i] === htmlB[i]) same++
        else {
          differing.push(fingerprint)
          fail(where(`item ${i + 1} (${fingerprint}) renders differently\n${textDiff(htmlA[i] ?? '', htmlB[i] ?? '')}`))
        }
      }
      // What each normalisation had to cover: the items that would differ with none, with only one of the two.
      const scratch = () => ({ ids: {}, emptyComments: 0, maxIdsInItem: 0 })
      const differ = (fa, fb) => ra.items.filter((item, i) => rb.items[i] !== undefined && fa(item.html, scratch()) !== fb(rb.items[i].html, scratch())).length
      const none = (html) => html
      result.rendered = {
        itemsA: ra.items.length,
        itemsB: rb.items.length,
        identical: same,
        differing: differing.length,
        differingWithoutNormalisation: differ(none, none),
        differingWithIdsOnly: differ(normaliseIds, normaliseIds),
        differingWithCommentsOnly: differ(dropEmptyComments, dropEmptyComments),
        pickedFiles: { a: ra.picked.length, b: rb.picked.length, json: expectedPick.length },
        emptyCommentsRemoved: { a: statsA.emptyComments, b: statsB.emptyComments },
        idsNormalised: { a: statsA.ids, b: statsB.ids, mostIdsInOneItem: Math.max(statsA.maxIdsInItem, statsB.maxIdsInItem) },
        digestA: digest(htmlA.join('\u0000')),
        digestB: digest(htmlB.join('\u0000')),
      }
    }
  } finally {
    await browser.close()
  }
}

console.log(JSON.stringify(summary, null, 2))
if (failures.length > 0) {
  for (const f of failures) console.error(`DIFFERENCE ${f}`)
  console.error(`${failures.length} difference(s)`)
  process.exit(1)
}
console.error(`ok: ${packages.length} package(s) the same in both Labs${urlA !== undefined ? ', data and rendered' : ', data level'}`)
