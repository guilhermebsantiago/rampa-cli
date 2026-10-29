// Loads the human-review packages with Rampa Lab's own review-mode code, as its folder picker would, and checks that
// the Lab reads every item blind: no judge, no final label, no confidence, no suggested fix, one list, a snapshot
// with the element for each item. The Lab is not changed or built; its TypeScript modules are imported as they are
// (Node 24 strips the types).
//
//   node study/human-review-2026-10/scripts/check-lab.mjs [--lab C:/Users/guilh/dev/rampa-lab] [--synthetic-out DIR] [--folder DIR]
//
// With --synthetic-out, it also writes two SYNTHETIC label exports with the Lab's own exportLabels, to test
// analyze.py: random labels from a fixed seed, labeler "synthetic-not-human" (the 100) and "synthetic-second-not-human"
// (the 30, agreeing with the first about 80% of the time). They are not human labels; the script refuses to write
// them inside this study folder.

import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const opt = (name, fallback) => {
  const at = args.indexOf(name)
  return at === -1 ? fallback : args[at + 1]
}
// The folder with pacote-100 and pacote-30: this study's, unless --folder names a trial build elsewhere.
const folder = resolve(opt('--folder', dirname(here)))
const studyFolder = resolve(dirname(here))
const labDir = resolve(opt('--lab', process.env.RAMPA_LAB ?? 'C:/Users/guilh/dev/rampa-lab'))
const syntheticOut = opt('--synthetic-out', undefined)

const lib = (name) => import(pathToFileURL(join(labDir, 'src', 'lib', name)).href)
const { readReviewFiles, mergeEntries, sameTarget, elementContext } = await lib('review-input.ts')
const { contextOf, exportLabels, parseLabelFile, CAUSES } = await lib('review-labels.ts')
const { orderEntries, groupEntries } = await lib('review-format.ts')

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

/** What the Lab's folder picker hands review mode: the .json files (not *.engine.json), by their path from the folder's parent. */
function asPicked(packageDir) {
  return filesUnder(packageDir)
    .filter((p) => p.toLowerCase().endsWith('.json') && !p.toLowerCase().endsWith('.engine.json'))
    .map((p) => ({ path: relative(dirname(packageDir), p).split(sep).join('/'), text: readFileSync(p, 'utf8') }))
}

// A small seeded generator (mulberry32), for the synthetic labels only.
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const LABELS = ['true_positive', 'false_positive', 'uncertain']
const summary = {}
const firstLabels = new Map()

for (const [name, labeler, seed] of [
  ['pacote-100', 'synthetic-not-human', 11],
  ['pacote-30', 'synthetic-second-not-human', 23],
]) {
  const dir = join(folder, name)
  const findings = JSON.parse(readFileSync(join(dir, 'data', 'findings.json'), 'utf8'))
  const snapshotFiles = readdirSync(join(dir, 'snapshots')).filter((f) => f.endsWith('.snapshot.json'))
  const out = readReviewFiles(asPicked(dir))
  const where = (m) => `${name}: ${m}`
  if (out.problems.length > 0) fail(where(`the Lab could not load ${out.problems.map((p) => `${p.source}: ${p.messages.join(' ')}`).join('; ')}`))
  if (out.sources.length !== 1 || out.sources[0].kind !== 'study') fail(where(`expected one study source, got ${out.sources.map((s) => s.kind).join(', ')}`))
  if (out.labelFiles !== 0 || out.other !== 0) fail(where(`${out.labelFiles} label files and ${out.other} other files were picked up`))
  if (out.snapshots.length !== snapshotFiles.length) fail(where(`${out.snapshots.length} snapshots read of ${snapshotFiles.length}`))
  for (const source of out.sources) if (source.warnings.length > 0) fail(where(`warnings: ${source.warnings.join(' ')}`))

  const entries = mergeEntries(out.sources)
  if (entries.length !== findings.length) fail(where(`${entries.length} entries for ${findings.length} findings`))
  if (new Set(entries.map((e) => e.key)).size !== entries.length) fail(where('two entries share a key'))

  let withCrop = 0
  const imagesWithoutCrop = []
  let withoutHtml = 0
  let withContextImage = 0
  let withDestination = 0
  const lists = {}
  for (const e of entries) {
    lists[e.list] = (lists[e.list] ?? 0) + 1
    const blindFields = { confidence: e.confidence, patch: e.patch, maturity: e.maturity, agreement: e.agreement, model: e.model, level: e.level }
    for (const [k, v] of Object.entries(blindFields)) if (v !== undefined) fail(where(`${e.fingerprint} shows ${k}`))
    const study = e.study ?? {}
    for (const k of ['final', 'finalCause', 'auditor', 'skeptic', 'split']) if (study[k] !== undefined) fail(where(`${e.fingerprint} shows the study's ${k}`))
    const snapshot = out.snapshots.find((s) => sameTarget(s.target, e.page))
    if (!snapshot) {
      fail(where(`${e.fingerprint}: no snapshot for ${e.page}`))
      continue
    }
    const element = elementContext(snapshot, e.ref)
    if (!element) fail(where(`${e.fingerprint}: the snapshot has no element ${e.ref}`))
    else {
      // Paragraphs keep their text in the snapshot, not their HTML, and an svg or a span with role=img its name and crop; the Lab shows those.
      if (!(e.html ?? element.html)) {
        withoutHtml++
        if (!element.text && !element.image && !element.name) fail(where(`${e.fingerprint}: no HTML, text, name or crop to show`))
      }
      if (element.image) withCrop++
      else if (e.criterion === '1.1.1') imagesWithoutCrop.push(`${e.fingerprint} (${element.role})`)
      if (element.destination) withDestination++
    }
    try {
      statSync(join(dir, 'contexto', `${e.fingerprint}.jpg`))
      withContextImage++
    } catch {
      // Not on screen in the capture; the manifest lists these.
    }
  }

  const ordered = orderEntries(entries)
  const groups = groupEntries(ordered).map((g) => `${g.id} (${g.entries.length})`)
  summary[name] = {
    items: entries.length,
    pages: out.sources[0]?.pages.length,
    snapshots: out.snapshots.length,
    lists,
    elementsWithCrop: withCrop,
    imageItemsWithoutCrop: imagesWithoutCrop,
    textWithoutHtml: withoutHtml,
    linksWithDestination: withDestination,
    contextImages: withContextImage,
    groupsInLabOrder: groups,
  }

  if (syntheticOut) {
    const target = resolve(syntheticOut)
    if (target === studyFolder || target.startsWith(studyFolder + sep)) throw new Error('synthetic labels are never written inside the study folder')
    const random = rng(seed)
    const start = Date.parse('2026-10-30T10:00:00.000Z')
    const stored = ordered.map((e, i) => {
      let label = LABELS[Math.floor(random() * 3)]
      if (name === 'pacote-30' && firstLabels.has(e.key) && random() < 0.8) label = firstLabels.get(e.key)
      if (name === 'pacote-100') firstLabels.set(e.key, label)
      const cause = label === 'false_positive' && random() < 0.7 ? CAUSES[Math.floor(random() * CAUSES.length)] : undefined
      return { page: e.page, fingerprint: e.fingerprint, label, cause, note: 'SYNTHETIC test label, not a human judgment.', updatedAt: new Date(start + i * 95_000).toISOString(), context: contextOf(e) }
    })
    // One label from outside the package, as a browser that labelled something else would also export.
    stored.push({ page: 'https://example.org/', fingerprint: '000000000000', label: 'true_positive', cause: undefined, note: 'outside the package', updatedAt: new Date(start).toISOString(), context: undefined })
    const { data } = exportLabels(stored, labeler, new Date('2026-10-30T13:00:00.000Z'))
    const text = `${JSON.stringify(data, null, 2)}\n`
    const back = parseLabelFile(text, 'synthetic.json')
    if (back.problems.length > 0 || back.labels.length !== stored.length) fail(where(`the export does not read back: ${back.problems.join(' ')}`))
    mkdirSync(target, { recursive: true })
    const file = join(target, `rampa-lab-labels-${labeler}-2026-10-30.json`)
    writeFileSync(file, text)
    summary[name].syntheticExport = file
  }
}

console.log(JSON.stringify(summary, null, 2))
if (failures.length > 0) {
  for (const f of failures) console.error(`FAIL ${f}`)
  process.exit(1)
}
console.error('ok: Rampa Lab reads both packages, every item blind and with its element')
