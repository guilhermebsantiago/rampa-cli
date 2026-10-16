// Runs the fixtures of the cognitive profile's checks that a model decides (coga/literal-language,
// coga/long-text-summary, coga/error-wording) against a real model, and counts how many each check gets right: a
// fail page is right when the check reports exactly the sidecar's results, a pass page when it reports nothing.
//
//   node scripts/coga-model-fixtures.ts [--model ollama:gemma4:12b] [--concurrency 2] [--runs 1] [--batch] [--json out.json]
//   node scripts/coga-model-fixtures.ts --no-llm     what each check would ask about, with no model
//
// Answers are cached in .rampa/coga-model-cache, so a second run replays them; --fresh asks again. Fixture pages are
// tiny, purpose-built and labelled by the author: these numbers say whether the checks work as designed, not how
// precise they are on real pages, which nobody has measured.
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { wordingCandidates } from '../src/advisory/checks/error-wording.ts'
import { literalCandidates } from '../src/advisory/checks/literal-language.ts'
import { summaryCandidate } from '../src/advisory/checks/long-text-summary.ts'
import { readPage } from '../src/advisory/page.ts'
import { runProfiles } from '../src/advisory/profile.ts'
import type { Advisory } from '../src/advisory/types.ts'
import { fileCache } from '../src/core/cache.ts'
import { createModelProvider } from '../src/providers/ai-sdk.ts'
import type { A11yNode, A11ySnapshot } from '../src/snapshot/schema.ts'
import { collectInPage } from '../src/surfaces/in-page.ts'
import { launchBrowser } from '../src/surfaces/web.ts'

const { values } = parseArgs({
  options: {
    model: { type: 'string', default: 'ollama:gemma4:12b' },
    concurrency: { type: 'string', default: '2' },
    runs: { type: 'string', default: '1' },
    batch: { type: 'boolean', default: false },
    'no-llm': { type: 'boolean', default: false },
    fresh: { type: 'boolean', default: false },
    json: { type: 'string' },
  },
})

const ROOT = 'test/fixtures/coga'
const CHECKS = ['literal-language', 'long-text-summary', 'error-wording']
const CACHE = '.rampa/coga-model-cache'
if (values.fresh) rmSync(CACHE, { recursive: true, force: true })

interface Sidecar {
  results: Array<Record<string, string>>
}

const browser = await launchBrowser()
const tab = await (await browser.newContext()).newPage()

async function snapshotOf(url: string): Promise<A11ySnapshot> {
  await tab.goto(url)
  const raw = await tab.evaluate(collectInPage, { runAxe: false, axeTags: [], axeLocale: undefined, maxNodes: 5000 })
  return {
    schemaVersion: 1,
    surface: 'web',
    target: url,
    title: raw.title,
    locale: raw.lang,
    viewport: raw.viewport,
    root: raw.root as A11yNode,
    truncated: raw.truncated,
    collectedAt: new Date().toISOString(),
    collector: { name: 'coga-model-fixtures', version: '0' },
  }
}

function summary(advisory: Advisory, keys: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const key of keys) out[key] = key === 'ref' ? (advisory.ref ?? '') : key === 'subject' ? (advisory.subject ?? '') : String(advisory.facts?.[key] ?? '')
  return out
}

const llm = !values['no-llm']
const provider = llm ? await createModelProvider(values.model) : undefined
const cache = fileCache(CACHE)
const rows: Array<Record<string, unknown>> = []
const score = new Map<string, { right: number; total: number; fail: [number, number]; pass: [number, number] }>()

for (const name of CHECKS) {
  const check = `coga/${name}`
  for (const kind of ['fail', 'pass'] as const) {
    const folder = join(ROOT, name, kind)
    for (const file of readdirSync(folder).filter((entry) => entry.endsWith('.html'))) {
      const path = join(folder, file)
      const sidecar = JSON.parse(readFileSync(path.replace(/\.html$/, '.json'), 'utf8')) as Sidecar
      const snapshot = await snapshotOf(pathToFileURL(resolve(path)).href)
      const page = readPage(snapshot)
      const asks =
        name === 'literal-language'
          ? literalCandidates(page).candidates.map((c) => `${c.context.where}: ${c.context.text}`)
          : name === 'long-text-summary'
            ? (() => {
                const found = summaryCandidate(page)
                return found.candidate ? [`${found.words} words${found.candidate.context.marked ? `, marked "${found.candidate.context.marked}"` : ''}`] : [`${found.words} words: not asked`]
              })()
            : wordingCandidates(page).map((c) => c.context.text)
      if (!llm) {
        console.log(`${check} ${kind}/${file}\n  ${asks.join('\n  ') || '(nothing to ask)'}`)
        continue
      }
      const started = performance.now()
      const { section } = await runProfiles(snapshot, { engine: { name: 'none', version: '0' }, rules: [] }, {
        profiles: ['cognitive'],
        locale: 'en',
        findings: [],
        llm: true,
        provider,
        offline: false,
        cache,
        runs: Number(values.runs),
        concurrency: Number(values.concurrency),
        batch: values.batch,
        minConfidence: 'low',
        // The other checks of the profile run too; the abbreviations need no dictionary here.
        coga: {
          observe: 0,
          dictionaries: async () => {
            throw new Error('not read by this script')
          },
        },
      })
      const own = [...section.results, ...section.belowThreshold].filter((advisory) => advisory.check === check)
      const keys = Object.keys(sidecar.results[0] ?? { subject: '' })
      const got = own.map((advisory) => summary(advisory, keys))
      const expected = sidecar.results
      const right = JSON.stringify([...got].map((g) => JSON.stringify(g)).sort()) === JSON.stringify([...expected].map((e) => JSON.stringify(e)).sort())
      const entry = score.get(check) ?? { right: 0, total: 0, fail: [0, 0], pass: [0, 0] }
      entry.total++
      if (right) entry.right++
      const tally = kind === 'fail' ? entry.fail : entry.pass
      tally[1]++
      if (right) tally[0]++
      score.set(check, entry)
      const summaryOf = section.checks.find((summaryRow) => summaryRow.check === check)
      rows.push({ check, kind, file, right, expected, got: own.map((advisory) => ({ subject: advisory.subject, ref: advisory.ref, facts: advisory.facts, message: advisory.message })), asks, model: summaryOf?.model, seconds: Math.round(performance.now() - started) / 1000 })
      console.log(`${right ? 'right' : 'WRONG'}  ${check} ${kind}/${file}  (${((performance.now() - started) / 1000).toFixed(1)} s)`)
      for (const advisory of own) console.log(`       reported: ${advisory.subject} ${JSON.stringify({ expression: advisory.facts?.expression, meaning: advisory.facts?.meaning, suggestion: advisory.facts?.suggestion, first: advisory.facts?.firstSentence })}`)
      if (summaryOf?.model && (summaryOf.model.discarded ?? 0) > 0) console.log(`       discarded by verification: ${summaryOf.model.discarded}`)
    }
  }
}

if (llm) {
  console.log(`\nModel ${values.model}, runs ${values.runs}, concurrency ${values.concurrency}${values.batch ? ', batched' : ''}`)
  for (const [check, entry] of score) {
    console.log(`${check}: ${entry.right} of ${entry.total} fixtures right (fail pages ${entry.fail[0]} of ${entry.fail[1]}, pass pages ${entry.pass[0]} of ${entry.pass[1]})`)
  }
  if (values.json) writeFileSync(values.json, `${JSON.stringify({ model: values.model, runs: Number(values.runs), batch: values.batch, score: Object.fromEntries(score), rows }, null, 2)}\n`)
}
await browser.close()
