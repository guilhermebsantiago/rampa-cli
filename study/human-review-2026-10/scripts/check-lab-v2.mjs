// Loads a v2 review package (one whose snapshots carry `reviewEvidence`, docs/studies/human-review-evidence-format.md)
// with a Rampa Lab's own review-mode code, as its folder picker would, and checks that the Lab reads every item blind
// and with its evidence. The Lab is not changed or built; its TypeScript modules are imported as they are (Node 24
// strips the types), as check-lab.mjs does.
//
//   node study/human-review-2026-10/scripts/check-lab-v2.mjs --lab <Lab dir> --package <package dir>
//
// Blindness, as check-lab.mjs checks it (the logic is copied from there): no problem message, one study source, no
// label or other file picked up, every snapshot read, no warning, one entry per finding with its own key, and per
// entry no confidence, fix, maturity, agreement, model, level, judge, final label or half, a snapshot for its page and
// its element in it with something to show. Evidence, per item: an evidence entry for its ref; each image of the block
// a data URL the Lab kept; a 2.4.4 item has `enclosing` or `headingBefore`; an item whose element is an image (role
// img or tag img, the rule evidence.py applies) has `imageFile`. Per block: its `rubric` is read; no key is in
// sample.py's FORBIDDEN_KEYS; no text equals a label value.
//
// Prints a JSON summary (per item, which fields it has; no item's message, evidence or HTML) and exits non-zero on a
// failure.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const args = process.argv.slice(2)
const opt = (name) => {
  const at = args.indexOf(name)
  return at === -1 ? undefined : args[at + 1]
}
if (!opt('--lab') || !opt('--package')) {
  console.error('usage: node check-lab-v2.mjs --lab <Lab dir> --package <package dir>')
  process.exit(2)
}
const labDir = resolve(opt('--lab'))
const packageDir = resolve(opt('--package'))

const lib = (name) => import(pathToFileURL(join(labDir, 'src', 'lib', name)).href)
const { readReviewFiles, mergeEntries, sameTarget, elementContext, evidenceFor } = await lib('review-input.ts')
const labels = await lib('review-labels.ts')
if (typeof evidenceFor !== 'function') {
  console.error(`FAIL ${labDir}: this Lab has no evidenceFor; it does not read review evidence`)
  process.exit(1)
}

// Copied from study/human-review-2026-10/scripts/sample.py, FORBIDDEN_KEYS (keep the two in step).
const FORBIDDEN_KEYS = new Set([
  'label', 'final', 'finalCause', 'auditor', 'skeptic', 'agreed', 'rationale', 'cause', 'confidence', 'patch',
  'confirmation', 'suggestionEvidence', 'cut090', 'sampleReason', 'origin', 'claim', 'shown', 'split', 'experimental',
  'group', 'kind', 'packet', 'run', 'key', 'level', 'subject',
])
// The label values, from study/human-review-2026-10/scripts/common.py, LABELS; the Lab's own LABELS must be the same.
const LABEL_VALUES = ['true_positive', 'false_positive', 'uncertain']

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

/** Every key of a JSON value, with its path. */
function keysIn(value, path = '', out = []) {
  if (Array.isArray(value)) value.forEach((v, i) => keysIn(v, `${path}[${i}]`, out))
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.push({ path: `${path}.${k}`, key: k })
      keysIn(v, `${path}.${k}`, out)
    }
  }
  return out
}

/** Every string of a JSON value (not the keys), with its path. */
function stringsIn(value, path = '', out = []) {
  if (typeof value === 'string') out.push({ path, text: value })
  else if (Array.isArray(value)) value.forEach((v, i) => stringsIn(v, `${path}[${i}]`, out))
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) stringsIn(v, `${path}.${k}`, out)
  return out
}

/** A label value however it is written: NFKC, lower case, spaces, hyphens and underscores folded into one underscore. */
const fold = (s) => s.normalize('NFKC').trim().toLowerCase().replace(/[\s_-]+/g, '_')
const isDataImage = (s) => typeof s === 'string' && /^data:image\/[a-z]+;base64,/.test(s)
const shown = (v) => v !== undefined && !(Array.isArray(v) && v.length === 0)
const fieldsOf = (obj) => (obj ? Object.entries(obj).filter(([, v]) => shown(v)).map(([k]) => k) : [])

if (JSON.stringify([...(labels.LABELS ?? [])]) !== JSON.stringify(LABEL_VALUES)) fail(`the Lab's LABELS are ${JSON.stringify(labels.LABELS)}, not ${JSON.stringify(LABEL_VALUES)}`)

const name = packageDir.split(sep).at(-1)
const where = (m) => `${name}: ${m}`
const findings = JSON.parse(readFileSync(join(packageDir, 'data', 'findings.json'), 'utf8'))
const snapshotFiles = readdirSync(join(packageDir, 'snapshots')).filter((f) => f.endsWith('.snapshot.json'))
const rawBlocks = new Map(
  snapshotFiles.map((f) => {
    const value = JSON.parse(readFileSync(join(packageDir, 'snapshots', f), 'utf8'))
    return [value.target, { file: f, block: value.reviewEvidence }]
  }),
)

const out = readReviewFiles(asPicked(packageDir))

// Blindness, copied from check-lab.mjs.
if (out.problems.length > 0) fail(where(`the Lab could not load ${out.problems.map((p) => `${p.source}: ${p.messages.join(' ')}`).join('; ')}`))
if (out.sources.length !== 1 || out.sources[0].kind !== 'study') fail(where(`expected one study source, got ${out.sources.map((s) => s.kind).join(', ')}`))
if (out.labelFiles !== 0 || out.other !== 0) fail(where(`${out.labelFiles} label files and ${out.other} other files were picked up`))
if (out.snapshots.length !== snapshotFiles.length) fail(where(`${out.snapshots.length} snapshots read of ${snapshotFiles.length}`))
for (const source of out.sources) if (source.warnings.length > 0) fail(where(`warnings: ${source.warnings.join(' ')}`))

const entries = mergeEntries(out.sources)
if (entries.length !== findings.length) fail(where(`${entries.length} entries for ${findings.length} findings`))
if (new Set(entries.map((e) => e.key)).size !== entries.length) fail(where('two entries share a key'))

// Per block: read, its rubric read, no forbidden key, no label value, every image a data URL the Lab kept.
const blocks = {}
for (const snapshot of out.snapshots) {
  const raw = [...rawBlocks.entries()].find(([target]) => sameTarget(target, snapshot.target))?.[1]
  const file = raw?.file ?? snapshot.id
  const block = raw?.block
  const at = (m) => where(`${file}: ${m}`)
  if (!block || typeof block !== 'object') {
    fail(at('no reviewEvidence block'))
    continue
  }
  const read = snapshot.evidence
  if (!read) {
    fail(at('the Lab did not read the reviewEvidence block'))
    continue
  }
  if (typeof block.rubric === 'string' && read.rubric !== block.rubric) fail(at(`rubric ${JSON.stringify(block.rubric)} read as ${JSON.stringify(read.rubric)}`))
  if (typeof block.rubric !== 'string') fail(at('the block names no rubric'))
  const asks = typeof labels.asksForAnswers === 'function' ? labels.asksForAnswers(snapshot) : undefined
  for (const { path, key } of keysIn(block)) if (FORBIDDEN_KEYS.has(key)) fail(at(`forbidden key reviewEvidence${path}`))
  for (const { path, text } of stringsIn(block)) if (LABEL_VALUES.includes(fold(text))) fail(at(`reviewEvidence${path} is a label value`))

  // The images: every data: string of the block, and every capture or context field, must be a data URL the Lab kept as it is.
  const images = []
  const page = block.page ?? {}
  if (page.capture !== undefined) images.push({ path: '.page.capture', raw: page.capture, kept: read.page?.capture })
  for (const [ref, item] of Object.entries(block.items ?? {})) {
    if (item && typeof item === 'object' && item.context !== undefined) images.push({ path: `.items.${ref}.context`, raw: item.context, kept: read.items.get(ref)?.context })
  }
  const known = new Set(images.map((i) => i.path))
  for (const { path, text } of stringsIn(block)) {
    if (/^\s*data:/i.test(text) && !known.has(path)) fail(at(`reviewEvidence${path} holds a data: address in a field the Lab does not show as an image`))
  }
  for (const image of images) {
    if (!isDataImage(image.raw)) fail(at(`reviewEvidence${image.path} is not a data: image URL`))
    else if (image.kept !== image.raw) fail(at(`reviewEvidence${image.path}: the Lab did not keep the image`))
  }
  blocks[file] = {
    version: block.version,
    rubric: read.rubric,
    asksForThreeAnswers: asks,
    pageFields: fieldsOf(read.page),
    captureSize: read.page?.captureSize,
    captureAligned: read.page?.captureAligned,
    items: read.items.size,
    imagesKept: images.filter((i) => isDataImage(i.raw) && i.kept === i.raw).length,
  }
}

// Per item.
const items = []
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
  else if (!(e.html ?? element.html) && !element.text && !element.image && !element.name && !element.browserName) fail(where(`${e.fingerprint}: no HTML, text, name or crop to show`))

  const more = evidenceFor(snapshot, e.ref)
  const item = more?.item
  if (!item) fail(where(`${e.fingerprint}: no evidence entry for its ref`))
  const isImage = element !== undefined && (element.role === 'img' || element.tag === 'img')
  if (e.criterion === '2.4.4' && !item?.enclosing && !item?.headingBefore) fail(where(`${e.fingerprint}: a 2.4.4 item with neither enclosing nor headingBefore`))
  if (isImage && !item?.imageFile) fail(where(`${e.fingerprint}: its element is an image and it has no imageFile`))
  items.push({
    fingerprint: e.fingerprint,
    slug: study.slug,
    criterion: e.criterion,
    list: e.list,
    element: element ? { role: element.role, tag: element.tag, crop: element.image !== undefined } : undefined,
    elementIsImage: isImage,
    itemFields: fieldsOf(item),
    sameTextTotal: item?.sameText?.total,
    sameTextListed: item?.sameText?.links.length,
    listItems: item?.listItems.length || undefined,
    before: item?.before.length || undefined,
    pageFields: fieldsOf(more?.page),
  })
}
const refsWithItems = new Set(entries.map((e) => `${out.snapshots.find((s) => sameTarget(s.target, e.page))?.id}\u0000${e.ref}`))
const evidenceWithoutItem = out.snapshots.flatMap((s) => [...(s.evidence?.items.keys() ?? [])].filter((ref) => !refsWithItems.has(`${s.id}\u0000${ref}`)).map(() => s.id)).length

const summary = {
  package: name,
  lab: labDir,
  items: entries.length,
  pages: out.sources[0]?.pages.length,
  snapshots: out.snapshots.length,
  lists,
  blocks,
  evidenceWithoutItem,
  perItem: items,
}
console.log(JSON.stringify(summary, null, 2))
if (failures.length > 0) {
  for (const f of failures) console.error(`FAIL ${f}`)
  process.exit(1)
}
console.error(`ok: the Lab reads ${name}, every item blind and with its element and its evidence`)
