// Rampa's ACT implementation report, from the benchmark's raw records: for each Rampa row, the EARL report in JSON-LD
// that the W3C ACT implementation pages read (https://www.w3.org/WAI/standards-guidelines/act/report/earl/), and, with
// the ACT Rules Community Group's own act-tools, the consistency of each ACT rule as those pages compute it. No page is
// checked here: the outcomes come from the rows' records. Method, choices and results: docs/act-implementation.md.
//
//   node act-report/build.mjs                          the EARL reports only
//   node act-report/build.mjs --act-tools <dir>        and the consistency of each ACT rule, with the summary
//   node act-report/build.mjs --act-tools <dir> --docs and the summary in ../docs/act-implementation.md
//   node act-report/build.mjs --missing <row> <file>   list, for tools/rampa.mjs, the test cases a row has no record of
//                                                      among the rules it reports on, then stop
//
//   --results <dir>             results folder (default results/2026-10-11, with the records and versions of DEFAULTS)
//   --rows <a,b>                Rampa rows to report (default rampa,rampa-gemma)
//   --raw <row>=<file>[+<file>] read a row's records from these files instead (a later file wins for the same page)
//   --revision <row>=<text>     the version the row's assertor gives
//   --act-tools <dir>           a built checkout of act-rules/act-tools (docs/act-implementation.md says how)
//   --testcases <file>          the ACT test cases (default: the current file, downloaded from W3C)
//   --axe-earl <url|file|none>  axe-core's own EARL report, for the comparison column (default: the address W3C reads)
//   --out <dir>                 where the files go (default act-report/)
//   --docs                      write the summary into ../docs/act-implementation.md, between its act:report markers
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rampaEval } from '../lib/cases.mjs'
import { BENCH, ROOT, arg, compareIds, readJson, readJsonl } from '../lib/env.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const EARL_CONTEXT = 'https://www.w3.org/WAI/content-assets/wcag-act-rules/earl-context.json'
/** Where W3C downloads axe-core's own report (w3c/wcag-act-rules, _data/wcag-act-rules/act-implementations.yml). */
const AXE_EARL = 'https://raw.githubusercontent.com/dequelabs/act-reports-axe/act-reports-axe/reports/axe-core.json'
const HOMEPAGE = 'https://rampa.guilhermebs.com.br'
const VENDOR = 'Guilherme Santiago'

/** The rows an implementation report can come from, and how each is named in it. */
const ROWS = {
  rampa: { name: 'Rampa', label: 'Rampa, no model (`rampa check --no-llm`)', short: 'No model' },
  'rampa-gemma': { name: 'Rampa with Gemma 4 12B', label: 'Rampa with Gemma 4 12B (`rampa check --model ollama:gemma4:12b`)', short: 'Gemma 4 12B' },
}

/**
 * The records and the version of each row's report, for the 2026-10-11 results. The no-model row adds a run at the
 * 0.1.0 release of the test cases the benchmark left out among the rules the row reports on (`--missing rampa`; the
 * ARIA rules and the SVG and XML examples). Its benchmark records, from commit 927cf63, were checked against a rerun
 * at the release: 855 of 856 pages gave the same record, and the other is a page that redirects to the live w3.org
 * home page, whose content had changed. Then a run at commit b09ef9d of the test cases two fixes after the release
 * change: the 13 SVG and XML documents 0.1.0 could not check, and afw4f7's, where an experimental rule hid axe-core's
 * items to review. A later file wins, so those records replace the earlier ones. The Gemma row was not run again: no
 * model is called here.
 */
const DEFAULT_RESULTS = join('results', '2026-10-11')
const DEFAULTS = {
  rampa: {
    raw: [join(DEFAULT_RESULTS, 'raw', 'rampa.jsonl'), join('act-report', 'records', 'rampa-0.1.0.jsonl'), join('act-report', 'records', 'rampa-b09ef9d.jsonl')],
    revision: '0.1.0, with the SVG, XML and afw4f7 test cases run again at commit b09ef9d',
  },
  'rampa-gemma': { raw: [join(DEFAULT_RESULTS, 'raw', 'rampa-gemma.jsonl')], revision: 'commit 927cf63, before the 0.1.0 release' },
}

const CONSISTENCY = { complete: 'consistent', partial: 'partial', inconsistent: 'inconsistent', untested: 'not implemented' }

function pairs(name) {
  const value = arg(name)
  if (typeof value !== 'string') return {}
  return Object.fromEntries(
    value.split(',').map((item) => {
      const at = item.indexOf('=')
      return [item.slice(0, at), item.slice(at + 1)]
    }),
  )
}

const resultsDir = resolve(BENCH, String(arg('results', DEFAULT_RESULTS)))
const usingDefaults = resultsDir === resolve(BENCH, DEFAULT_RESULTS)
const missingRow = typeof arg('missing') === 'string' ? String(arg('missing')) : undefined
const rowIds = missingRow ? [missingRow] : String(arg('rows', 'rampa,rampa-gemma')).split(',')
const rawFiles = pairs('raw')
const revisions = pairs('revision')
const outDir = resolve(BENCH, String(arg('out', 'act-report')))
const actToolsDir = typeof arg('act-tools') === 'string' ? resolve(String(arg('act-tools'))) : undefined
for (const id of rowIds) if (!ROWS[id]) throw new Error(`Not a Rampa row this report knows: ${id}`)

const sha256 = (text) => createHash('sha256').update(text).digest('hex')
const posix = (path) => path.replace(/\\/g, '/')
const ev = await rampaEval()
const run = await readJson(join(resultsDir, 'run.json'))
const cases = await readJson(join(resultsDir, 'cases.json'))
const scIds = (await readJson(join(HERE, 'wcag-sc-ids.json'))).scId

// 1. The ACT test cases: the current published file, as W3C scores reports against it.
let testcasesText
let testcasesFrom
if (typeof arg('testcases') === 'string') {
  testcasesFrom = resolve(String(arg('testcases')))
  testcasesText = await readFile(testcasesFrom, 'utf8')
} else {
  testcasesFrom = ev.ACT_TESTCASES_URL
  const response = await fetch(ev.ACT_TESTCASES_URL, { signal: AbortSignal.timeout(60_000) })
  if (!response.ok) throw new Error(`${ev.ACT_TESTCASES_URL}: HTTP ${response.status}`)
  testcasesText = await response.text()
}
const testcases = JSON.parse(testcasesText).testcases
const testcasesInfo = { from: testcasesFrom, sha256: sha256(testcasesText), testcases: testcases.length, rules: new Set(testcases.map((t) => t.ruleId)).size, read: new Date().toISOString().slice(0, 10) }
const inTarget = new Set(ev.WCAG22_A_AA.map((sc) => sc.id))

/** The WCAG 2 criteria a rule's failed examples fail for conformance, split into A/AA and the rest (AAA). */
function conformance(testcase) {
  const all = Object.entries(testcase.ruleAccessibilityRequirements ?? {})
    .filter(([key, value]) => /^wcag2\d?:\d+\.\d+\.\d+$/.test(key) && value?.forConformance)
    .map(([key]) => key.split(':')[1])
  return { aa: all.filter((id) => inTarget.has(id)).sort(compareIds), beyond: all.filter((id) => !inTarget.has(id)) }
}
const ruleInfo = new Map()
for (const testcase of testcases) {
  if (ruleInfo.has(testcase.ruleId)) continue
  const { aa, beyond } = conformance(testcase)
  // Rampa reports against WCAG 2.2 A and AA: a rule whose failed examples fail only Level AAA criteria is outside it.
  ruleInfo.set(testcase.ruleId, { ruleId: testcase.ruleId, ruleName: testcase.ruleName, criteria: aa, aaaOnly: aa.length === 0 && beyond.length > 0 })
}
const approved = new Set(testcases.filter((t) => t.approved).map((t) => t.ruleId))
const caseId = (testcase) => `act:${testcase.ruleId}:${testcase.testcaseId}`

// 2. The procedures: every part of Rampa that reports a result, and the ACT rules it implements, from Rampa's own
// metadata. axe-core rules map through axe-core's `actIds`; Rampa's rules and judged criteria through their `act` lists.
// This is the mapping `rampa eval` scores with; nothing in it is chosen from the results.
const require = createRequire(join(ROOT, 'package.json'))
const axe = require('axe-core')
const axeVersion = require(join(dirname(require.resolve('axe-core')), 'package.json')).version
const tags = ev.axeTags('2.2')
const excluded = (axe._audit?.tagExclude ?? ['experimental', 'deprecated']).filter((tag) => !tags.includes(tag))
const criteriaOfTags = (ruleTags) => [...new Set(ruleTags.flatMap((tag) => ev.criterionFromAxeTag(tag) ?? []))].sort(compareIds)

const procedures = new Map()
function addProcedure(key, value) {
  const isPartOf = value.criteria.map((criterion) => scIds[criterion]).filter(Boolean)
  procedures.set(key, { key, ...value, isPartOf })
}
for (const rule of axe.getRules()) {
  // Rampa runs axe-core on the WCAG 2.0, 2.1 and 2.2 A/AA tags, which leaves out the experimental and deprecated rules
  // a tag run does not name, plus two experimental rules whose results are only items to review (src/engine/axe.ts).
  const runs = ev.AXE_REVIEW_RULES.includes(rule.ruleId) || (rule.tags.some((tag) => tags.includes(tag)) && !rule.tags.some((tag) => excluded.includes(tag)))
  if (!runs) continue
  addProcedure(`axe:${rule.ruleId}`, { source: 'axe-core', title: `${rule.ruleId} (axe-core)`, criteria: criteriaOfTags(rule.tags), act: rule.actIds ?? [] })
}
const ruleIds = new Set(ev.RULE_CHECKS.map((rule) => rule.id))
for (const rule of ev.RULE_CHECKS) {
  // `actPassedOnly` (09o5cg's 7:1 for a 4.5:1 check) is a stricter rule a check borrows passed examples from, not one it implements.
  addProcedure(`rule:${rule.id}`, { source: 'Rampa', title: rule.id, criteria: [...rule.criteria], act: [...rule.act] })
}
for (const id of ev.DEFAULT_CRITERIA) {
  addProcedure(`judgment:${id}`, { source: 'Rampa', title: `rampa/judgment/${id}`, criteria: [id], act: [...(ev.CRITERIA.get(id)?.act ?? [])], judgment: true })
}

/** The procedure a label of a raw record names: `engine:<axe rule>`, `rule:<id>`, `judgment:<criterion>`, `review:<rule>`. */
function procedureOf(label) {
  const at = label.indexOf(':')
  if (at < 0) return undefined
  const kind = label.slice(0, at)
  const id = label.slice(at + 1)
  if (kind === 'engine') return `axe:${id}`
  if (kind === 'rule' || kind === 'judgment' || kind === 'probe') return `${kind}:${id}`
  if (kind === 'review') {
    if (id.startsWith('judgment/')) return `judgment:${id.slice('judgment/'.length)}`
    if (id.startsWith('rampa/')) return ruleIds.has(id) ? `rule:${id}` : `probe:${id}`
    return `axe:${id}`
  }
  // `coverage`: a criterion's status, with no rule behind it in the record.
  return undefined
}

/** What one page's record says, per procedure: failed (at or above the default threshold), to review, below threshold. */
function readRecord(record) {
  const failed = new Set()
  const review = new Set()
  const low = new Set()
  const byCriterion = { fail: {}, review: {}, low: {} }
  const unattributed = []
  for (const [part, set] of [
    ['fail', failed],
    ['review', review],
    ['low', low],
  ]) {
    for (const [criterion, labels] of Object.entries(record?.[part] ?? {})) {
      for (const label of labels) {
        const key = procedureOf(label)
        if (!key) {
          if (part === 'fail') unattributed.push(criterion)
          continue
        }
        set.add(key)
        ;(byCriterion[part][criterion] ??= new Set()).add(key)
      }
    }
  }
  for (const label of record?.failRules ?? []) {
    const key = procedureOf(label)
    if (key) failed.add(key)
  }
  return { failed, review, low, byCriterion, unattributed }
}

// 3. The rows' records, and what each row ran.
const rows = []
for (const id of rowIds) {
  const files = rawFiles[id]
    ? rawFiles[id].split('+').map((file) => resolve(file))
    : usingDefaults
      ? DEFAULTS[id].raw.map((file) => resolve(BENCH, file))
      : [join(resultsDir, 'raw', `${id}.jsonl`)]
  const records = new Map()
  const metas = []
  for (const file of files) {
    for (const record of await readJsonl(file)) records.set(record.id, record)
    const metaFile = file.replace(/\.jsonl$/, '.meta.json')
    if (existsSync(metaFile)) metas.push(await readJson(metaFile))
  }
  const args = metas.map((meta) => meta.versions?.args ?? '').join(' ')
  const withModel = /--model\b/.test(args)
  const unknown = new Set()
  for (const record of records.values()) {
    const { failed, review } = readRecord(record)
    for (const key of [...failed, ...review]) if (!procedures.has(key)) unknown.add(key)
  }
  // A label this mapping does not know means Rampa or axe-core changed since the run: the report would be wrong.
  if (unknown.size) throw new Error(`${id}: the records name procedures the mapping does not know: ${[...unknown].join(', ')}`)
  const revision = revisions[id] ?? (usingDefaults ? DEFAULTS[id].revision : `${run.rampaVersion} (commit ${run.rampaCommit})`)
  rows.push({ id, ...ROWS[id], files, records, withModel, revision })
}

/** The procedures of a row that implement an ACT rule; none for a rule outside WCAG 2.2 A/AA. */
function mapped(row, ruleId) {
  if (ruleInfo.get(ruleId)?.aaaOnly) return []
  return [...procedures.values()].filter((p) => p.act.includes(ruleId) && (!p.judgment || row.withModel)).map((p) => p.key)
}

if (missingRow) {
  const [row] = rows
  const file = process.argv[process.argv.indexOf('--missing') + 2]
  if (!file || file.startsWith('--')) throw new Error('--missing <row> <file>: name the file to write')
  const pages = testcases.filter((t) => mapped(row, t.ruleId).length > 0 && !row.records.has(caseId(t))).map((t) => ({ id: caseId(t), url: t.url, kind: 'act' }))
  await mkdir(dirname(resolve(file)), { recursive: true })
  await writeFile(resolve(file), `${JSON.stringify(pages, null, 1)}\n`, 'utf8')
  console.log(`${pages.length} test cases of ${new Set(pages.map((p) => p.id.split(':')[1])).size} rules have no record in ${row.id}: ${file}`)
  process.exit(0)
}

// 4. The EARL reports: one TestSubject per test case with a record, and an assertion per outcome of each procedure
// that implements the case's rule. Nothing found is `passed`: Rampa's records do not tell a rule that passed from one
// that did not apply, and ACT accepts either outcome on passed and inapplicable examples alike.
const notes = new Map()
function noteOf(row, ruleId) {
  const key = `${row.id}|${ruleId}`
  if (!notes.has(key)) notes.set(key, { belowThreshold: { failed: 0, other: 0 }, unmapped: { failed: 0, other: 0, procedures: new Set() }, unattributed: { failed: 0, other: 0 }, noRecord: 0, errors: 0 })
  return notes.get(key)
}

function earlFor(row) {
  const graph = [
    {
      '@type': 'Assertor',
      name: row.name,
      description: `${row.label}, at the default confidence threshold. Procedures named "(axe-core)" are axe-core ${axeVersion} rules that Rampa runs and reports; the others are Rampa's own rules${row.withModel ? ' and its model judgments (rampa/judgment/<criterion>)' : ''}.`,
      homepage: HOMEPAGE,
      license: 'https://opensource.org/license/mit',
      release: { '@type': 'Version', revision: row.revision },
    },
  ]
  let assertions = 0
  for (const testcase of testcases) {
    const info = ruleInfo.get(testcase.ruleId)
    const keys = mapped(row, testcase.ruleId)
    const record = row.records.get(caseId(testcase))
    const note = noteOf(row, testcase.ruleId)
    if (!record) {
      if (keys.length) note.noRecord++
      continue
    }
    const read = readRecord(record)
    const side = testcase.expected === 'failed' ? 'failed' : 'other'
    // What the EARL leaves out, for the summary: findings under the rule's criteria from procedures not mapped to it,
    // below-threshold findings of the mapped ones, and a criterion's failure status that names no rule.
    const unmappedHits = [...new Set(info.criteria.flatMap((criterion) => [...(read.byCriterion.fail[criterion] ?? [])]))].filter((key) => !keys.includes(key))
    if (unmappedHits.length) {
      note.unmapped[side]++
      for (const key of unmappedHits) note.unmapped.procedures.add(procedures.get(key)?.title ?? key)
    }
    if (keys.some((key) => read.low.has(key) && !read.failed.has(key))) note.belowThreshold[side]++
    if (read.unattributed.some((criterion) => info.criteria.includes(criterion))) note.unattributed[side]++
    if (keys.length === 0) continue
    if (record.error) note.errors++
    const subjectAssertions = []
    for (const key of keys) {
      const procedure = procedures.get(key)
      const outcomes = []
      if (record.error) outcomes.push('untested')
      else {
        if (read.failed.has(key)) outcomes.push('failed')
        if (read.review.has(key)) outcomes.push('cantTell')
        if (outcomes.length === 0) outcomes.push('passed')
      }
      for (const outcome of outcomes) {
        subjectAssertions.push({
          '@type': 'Assertion',
          mode: 'earl:automatic',
          result: { '@type': 'TestResult', outcome: `earl:${outcome}` },
          test: { '@type': 'TestCase', title: procedure.title, isPartOf: procedure.isPartOf },
        })
      }
    }
    assertions += subjectAssertions.length
    graph.push({ '@type': 'TestSubject', source: testcase.url, assertions: subjectAssertions })
  }
  return { earl: { '@context': EARL_CONTEXT, '@graph': graph }, assertions, subjects: graph.length - 1 }
}

await mkdir(outDir, { recursive: true })
const built = []
for (const row of rows) {
  const { earl, assertions, subjects } = earlFor(row)
  const path = join(outDir, `${row.id}.earl.json`)
  await writeFile(path, `${JSON.stringify(earl, null, 1)}\n`, 'utf8')
  built.push({ row, earl, assertions, subjects, path })
  console.log(`${posix(relative(BENCH, path))}: ${subjects} test cases, ${assertions} assertions`)
}

if (!actToolsDir) {
  console.log('No --act-tools: the consistency of each rule and the summary were not computed.')
  process.exit(0)
}

// 5. Consistency, as the W3C ACT pages compute it: act-tools' getActImplementationReport, the function W3C's update job
// runs (w3c/wcag-act-rules, .github/scripts/implementation-update.mjs).
const actRequire = createRequire(join(actToolsDir, 'package.json'))
const actTools = actRequire(join(actToolsDir, 'dist', 'index.js'))
const { earlToActAssertions } = actRequire(join(actToolsDir, 'dist', 'map-implementation', 'earl', 'earl-to-act-assertions.js'))
const actToolsCommit = await readFile(join(actToolsDir, '.git', 'HEAD'), 'utf8')
  .then((text) => text.trim())
  .catch(() => 'unknown')

async function consistency(earl, meta) {
  const report = await actTools.getActImplementationReport(earl, testcases, meta)
  const byRule = new Map(report.actRuleMapping.map((mapping) => [mapping.ruleId, { ...mapping, status: mapping.consistency ?? (mapping.procedureNames.length ? 'inconsistent' : 'untested') }]))
  return { report, byRule }
}

const results = []
for (const { row, earl, assertions } of built) {
  // Every assertion written must survive act-tools' JSON-LD framing; a dropped one would count as untested.
  const parsed = await earlToActAssertions(earl)
  if (parsed.length !== assertions) throw new Error(`${row.id}: act-tools read ${parsed.length} of ${assertions} assertions`)
  const { report, byRule } = await consistency(earl, { vendor: VENDOR, name: row.name })
  await writeFile(join(outDir, `${row.id}.act.json`), `${JSON.stringify(report, null, 1)}\n`, 'utf8')
  results.push({ row, report, byRule, assertions })
  console.log(`${row.id}: approved ${JSON.stringify(report.approvedRules)}, proposed ${JSON.stringify(report.proposedRules)}`)
}

let axeResult
const axeSource = arg('axe-earl', AXE_EARL)
if (axeSource !== 'none') {
  try {
    const text = /^https?:/.test(axeSource) ? await (await fetch(axeSource, { signal: AbortSignal.timeout(120_000) })).text() : await readFile(resolve(axeSource), 'utf8')
    const { report, byRule } = await consistency(JSON.parse(text), { vendor: 'Deque Systems', name: 'Axe-core' })
    axeResult = { from: axeSource, sha256: sha256(text), version: report.version, report, byRule }
    console.log(`axe-core ${report.version}, its own report: approved ${JSON.stringify(report.approvedRules)}, proposed ${JSON.stringify(report.proposedRules)}`)
  } catch (error) {
    console.log(`axe-core's own report could not be read (${error.message}); the comparison column is left out.`)
  }
}

// 6. The summary: counts as the W3C page shows them, and one line per ACT rule.
const tuned = new Set(cases.home)
const benchmarked = new Set(cases.rules.map((rule) => rule.ruleId))
const allRules = [...ruleInfo.values()]
const actLink = (id) => `[${id}](https://www.w3.org/WAI/standards-guidelines/act/rules/${id}/)`
const escape = (text) => String(text).replace(/\|/g, '\\|')
const sourceOf = new Map([...procedures.values()].map((p) => [p.title, p.source]))
const reported = (ruleId) => rows.some((row) => mapped(row, ruleId).length > 0)

function provenance(mapping) {
  return [...new Set(mapping.procedureNames.map((name) => sourceOf.get(name) ?? '?'))].sort().join(' + ')
}

/** The status in the summary's words; a rule a row maps procedures to but never ran is "not run", not "not implemented". */
function label(result, ruleId, mapping) {
  const status = mapping?.status ?? 'untested'
  if (status === 'untested' && mapped(result.row, ruleId).length > 0 && (notes.get(`${result.row.id}|${ruleId}`)?.noRecord ?? 0) > 0) return 'not run'
  return CONSISTENCY[status]
}

function ruleLine(result, ruleId) {
  const mapping = result.byRule.get(ruleId)
  const note = notes.get(`${result.row.id}|${ruleId}`)
  const extra = []
  if (mapping?.status === 'partial') {
    const caught = mapping.testCaseResults.some((r) => r.expected === 'failed' && r.procedureResults.some((p) => p.outcomes.includes('failed')))
    if (!caught) extra.push('partial through cannot-tell outcomes only: no failed example failed')
  }
  if (note?.noRecord) extra.push(`${note.noRecord} examples not run`)
  if (note?.errors) extra.push(`${note.errors} examples Rampa could not check (untested)`)
  if (note?.belowThreshold.failed) extra.push(`below-threshold findings on ${note.belowThreshold.failed} failed examples, not reported`)
  if (note?.unattributed.failed || note?.unattributed.other) extra.push(`a failure status naming no rule on ${note.unattributed.failed + note.unattributed.other} examples, left out`)
  const others = note ? [...note.unmapped.procedures].join(', ') : ''
  if (note?.unmapped.other) extra.push(`procedures not mapped to the rule failed ${note.unmapped.other} passed or inapplicable examples under its criteria (${others})`)
  else if (note?.unmapped.failed) extra.push(`procedures not mapped to the rule failed ${note.unmapped.failed} failed examples under its criteria (${others})`)
  return { mapping, extra }
}

function countsTable() {
  const lines = ['| Implementation | Approved rules: consistent / partial / inconsistent / not implemented | Proposed rules: consistent / partial / inconsistent / not implemented |', '| --- | :---: | :---: |']
  const cell = (stats) => `${stats.complete} / ${stats.partial} / ${stats.inconsistent} / ${stats.untested}`
  for (const result of results) {
    const notRun = [...notes.entries()].filter(([key]) => key.startsWith(`${result.row.id}|`)).reduce((sum, [, note]) => sum + note.noRecord, 0)
    const name = notRun ? `${result.row.label}; ${notRun} examples of the rules it reports on were not run` : result.row.label
    lines.push(`| ${name} | ${cell(result.report.approvedRules)} | ${cell(result.report.proposedRules)} |`)
  }
  if (axeResult) lines.push(`| axe-core ${axeResult.version}, its own report (all its rules, experimental ones included; every rule run) | ${cell(axeResult.report.approvedRules)} | ${cell(axeResult.report.proposedRules)} |`)
  return lines.join('\n')
}

function sourceTable() {
  const lines = ["| Implementation | Consistent rules: by axe-core rules / by Rampa's own procedures / by both | Partial rules: by axe-core rules / by Rampa's own / by both |", '| --- | :---: | :---: |']
  for (const result of results) {
    const count = (status) => {
      const tally = { 'axe-core': 0, Rampa: 0, 'Rampa + axe-core': 0 }
      for (const mapping of result.byRule.values()) if (mapping.status === status) tally[provenance(mapping)]++
      return `${tally['axe-core']} / ${tally.Rampa} / ${tally['Rampa + axe-core']}`
    }
    lines.push(`| ${result.row.label} | ${count('complete')} | ${count('partial')} |`)
  }
  return lines.join('\n')
}

const tableRules = allRules
  .filter((rule) => benchmarked.has(rule.ruleId) || reported(rule.ruleId))
  .sort((a, b) => compareIds(a.criteria[0] ?? '9.9.9', b.criteria[0] ?? '9.9.9') || a.ruleName.localeCompare(b.ruleName))

function rulesTable() {
  const head = ['ACT rule', 'Criteria', 'Status', ...results.map((r) => r.row.short), ...(axeResult ? [`axe-core ${axeResult.version}, own report`] : []), 'Procedures', 'Notes']
  const lines = [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`]
  for (const rule of tableRules) {
    const per = results.map((result) => ruleLine(result, rule.ruleId))
    const procedureNames = [...new Set(per.flatMap(({ mapping }) => mapping?.procedureNames ?? []))]
    const extra = results.flatMap((result, i) => per[i].extra.map((text) => (results.length > 1 ? `${result.row.short}: ${text}` : text)))
    const statuses = per.map(({ mapping }, i) => label(results[i], rule.ruleId, mapping))
    const axeCell = axeResult ? [CONSISTENCY[axeResult.byRule.get(rule.ruleId)?.status ?? 'untested']] : []
    const name = `${actLink(rule.ruleId)} ${escape(rule.ruleName)}${tuned.has(rule.ruleId) ? ' ★' : ''}`
    const cells = [name, rule.criteria.join(', ') || '—', approved.has(rule.ruleId) ? 'approved' : 'proposed', ...statuses, ...axeCell, procedureNames.map((n) => `\`${escape(n)}\``).join(', ') || '—', escape(extra.join('; '))]
    lines.push(`| ${cells.join(' | ')} |`)
  }
  return lines.join('\n')
}

function differences() {
  if (!axeResult || !results.length) return "No comparison: axe-core's own report was not read."
  const [first] = results
  const lines = [`| ACT rule | Status | ${first.row.short} | axe-core ${axeResult.version}, own report |`, '| --- | --- | --- | --- |']
  for (const rule of [...allRules].sort((a, b) => a.ruleId.localeCompare(b.ruleId))) {
    const mine = label(first, rule.ruleId, first.byRule.get(rule.ruleId))
    const theirs = CONSISTENCY[axeResult.byRule.get(rule.ruleId)?.status ?? 'untested']
    if (mine !== theirs) lines.push(`| ${actLink(rule.ruleId)} ${escape(rule.ruleName)}${rule.aaaOnly ? ' (Level AAA only)' : ''} | ${approved.has(rule.ruleId) ? 'approved' : 'proposed'} | ${mine} | ${theirs} |`)
  }
  return lines.length > 2 ? lines.join('\n') : 'None.'
}

function otherRules() {
  const rest = allRules.filter((rule) => !tableRules.includes(rule)).sort((a, b) => a.ruleName.localeCompare(b.ruleName))
  const groups = new Map()
  for (const rule of rest) {
    const reason = rule.aaaOnly ? 'Level AAA only: Rampa reports against A and AA' : 'No Rampa procedure maps to the rule, and the benchmark did not run it'
    if (!groups.has(reason)) groups.set(reason, [])
    groups.get(reason).push(rule)
  }
  const axeNote = (rule) => (axeResult ? ` (axe-core: ${CONSISTENCY[axeResult.byRule.get(rule.ruleId)?.status ?? 'untested']})` : '')
  return [...groups].map(([reason, list]) => `- **${reason}** (${list.length}): ${list.map((rule) => `${actLink(rule.ruleId)} ${escape(rule.ruleName)}${axeNote(rule)}`).join('; ')}.`).join('\n')
}

const sources = rows.map((row) => `${row.id}: ${row.files.map((file) => posix(relative(BENCH, file))).join(' + ')}`).join('; ')
const generatedFrom = `${sources} (results folder ${posix(relative(BENCH, resultsDir))})`
const summary = [
  `Test cases: the published ACT file, ${testcasesInfo.testcases} test cases of ${testcasesInfo.rules} rules (SHA-256 \`${testcasesInfo.sha256.slice(0, 12)}\`, read ${testcasesInfo.read}). Consistency computed by act-tools at \`${actToolsCommit.slice(0, 7)}\`, the commit W3C's update job pins. axe-core ${axeVersion} inside Rampa.${axeResult ? ` axe-core's own report read the same day from ${axeResult.from}.` : ''}`,
  '',
  '### Rules by consistency',
  '',
  countsTable(),
  '',
  '### Which procedures make a rule consistent',
  '',
  sourceTable(),
  '',
  '### Per ACT rule',
  '',
  `Every rule the benchmark ran or a Rampa procedure maps to (${tableRules.length}). "Not implemented" is W3C's "untested": no procedure of that configuration maps to the rule. "Not run": procedures map to it, but that configuration was not run on its examples (W3C counts it as untested too). ★ marks the rules Rampa may have been tuned on, the benchmark's conservative reading: their ids appear in Rampa's code or tests, so its prompts, rules or thresholds may have been adjusted while reading their test cases. The notes say what the consistency leaves out.`,
  '',
  rulesTable(),
  '',
  `### Where ${results[0]?.row.name ?? 'Rampa'} and axe-core's own report differ`,
  '',
  differences(),
  '',
  '### Rules not in the table',
  '',
  'Rampa has no outcome for these; the W3C pages count them as untested.',
  '',
  otherRules(),
].join('\n')

await writeFile(join(outDir, 'summary.md'), `<!-- Generated by bench/act-report/build.mjs from ${generatedFrom}; do not edit by hand. -->\n\n${summary}\n`, 'utf8')
const summaryJson = {
  generatedFrom,
  testcases: testcasesInfo,
  actTools: actToolsCommit,
  axeCore: axeVersion,
  rows: results.map(({ row, report, assertions }) => ({ id: row.id, name: row.name, revision: row.revision, earl: `${row.id}.earl.json`, assertions, approvedRules: report.approvedRules, proposedRules: report.proposedRules })),
  axe: axeResult && { from: axeResult.from, sha256: axeResult.sha256, version: axeResult.version, approvedRules: axeResult.report.approvedRules, proposedRules: axeResult.report.proposedRules },
  rules: allRules
    .map((rule) => ({
      ruleId: rule.ruleId,
      ruleName: rule.ruleName,
      approved: approved.has(rule.ruleId),
      criteria: rule.criteria,
      aaaOnly: rule.aaaOnly,
      tuned: tuned.has(rule.ruleId),
      ...Object.fromEntries(
        results.map((result) => {
          const { mapping, extra } = ruleLine(result, rule.ruleId)
          return [result.row.id, { status: mapping?.status ?? 'untested', procedures: mapping?.procedureNames ?? [], coverage: mapping?.coverage ?? null, notes: extra }]
        }),
      ),
      ...(axeResult ? { axe: axeResult.byRule.get(rule.ruleId)?.status ?? 'untested' } : {}),
    }))
    .sort((a, b) => a.ruleId.localeCompare(b.ruleId)),
}
await writeFile(join(outDir, 'summary.json'), `${JSON.stringify(summaryJson, null, 1)}\n`, 'utf8')
console.log(`${posix(relative(BENCH, join(outDir, 'summary.md')))}, ${posix(relative(BENCH, join(outDir, 'summary.json')))}`)

if (arg('docs')) {
  const docs = join(ROOT, 'docs', 'act-implementation.md')
  const text = await readFile(docs, 'utf8')
  const start = '<!-- act:report:start -->'
  const end = '<!-- act:report:end -->'
  const from = text.indexOf(start)
  const to = text.indexOf(end)
  if (from === -1 || to === -1) throw new Error(`${docs} has no ${start} … ${end} block`)
  const note = `<!-- Generated by bench/act-report/build.mjs --docs from ${generatedFrom}; do not edit by hand. -->`
  await writeFile(docs, `${text.slice(0, from)}${start}\n${note}\n\n${summary}\n${end}${text.slice(to + end.length)}`, 'utf8')
  console.log('docs/act-implementation.md updated')
}
