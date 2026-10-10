import { readFile, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Finding, Patch, Report, SourceFix, SourceLocation, SourceRegion } from '../core/types.ts'
import { normalizeForMatch } from '../core/util.ts'
import { isQualifiedRef } from '../snapshot/refs.ts'
import type { A11yNode, A11ySnapshot } from '../snapshot/schema.ts'
import { walkTree } from '../snapshot/tree.ts'
import { type SourceTag, decodeEntities, findEndTag, lineStarts, positionAt, scanTags } from './html.ts'

/**
 * Maps the findings on a local page back to its source file: the line of each element,
 * and the patch as an edit to the file. The snapshot holds the DOM as the browser built
 * it, so an element is found by what it shares with its tag in the file: the tag name and
 * the attributes the collector keeps. The k-th element with that signature in the
 * snapshot is the k-th tag with it in the file, when both have the same number; when
 * they differ (a script added or removed elements), the element is not placed rather
 * than placed on the wrong line.
 */

/** KEEP_ATTRS in surfaces/in-page.ts, which cannot be imported into the page; a test keeps them equal. */
export const KEPT_ATTRIBUTES = [
  'id',
  'class',
  'lang',
  'href',
  'src',
  'alt',
  'title',
  'type',
  'role',
  'name',
  'for',
  'aria-label',
  'aria-labelledby',
  'aria-hidden',
  'aria-level',
  'aria-describedby',
  'placeholder',
  'autocomplete',
  'pattern',
  'maxlength',
  'minlength',
  'min',
  'max',
  'step',
  'inputmode',
  'required',
  'aria-required',
  'novalidate',
  'formnovalidate',
] as const

/** The collector cuts attribute values at this length. */
const KEPT_VALUE_LENGTH = 200
/** Elements a document has one of, matched by name alone. */
const SINGLETONS = new Set(['html', 'body'])
/** Elements longer than this are located by their start tag only. */
const MAX_ELEMENT_LENGTH = 400
const MAX_SNIPPET_LENGTH = 500

export interface PageSource {
  /** As in `SourceLocation.file`. */
  file: string
  text: string
}

export function locateReport(report: Report, snapshot: A11ySnapshot, source: PageSource): Report {
  const locator = createLocator(snapshot, source)
  const locate = (finding: Finding): Finding => {
    const location = locator(finding)
    return location ? { ...finding, location } : finding
  }
  return {
    ...report,
    sourceFile: source.file,
    findings: report.findings.map(locate),
    belowThreshold: report.belowThreshold.map(locate),
    waived: report.waived.map(locate),
  }
}

export function createLocator(snapshot: A11ySnapshot, source: PageSource): (finding: Finding) => SourceLocation | undefined {
  const text = source.text
  const starts = lineStarts(text)
  const tags = scanTags(text)
  const placed = tags.filter((tag) => !tag.leftOut)
  // Elements of a frame's document or of a shadow root are not tags of this file (snapshot/refs.ts): a frame's
  // document is another file or a srcdoc, and a shadow root is built by script.
  const nodes = [...walkTree(snapshot.root)].filter((node) => !isQualifiedRef(node.ref))
  const byRef = new Map(nodes.map((node) => [node.ref, node]))
  const nodeGroups = groupBy(nodes, (node) => signatureOfNode(node))
  const tagGroups = groupBy(placed, signatureOfTag)

  /** The one tag in the file with exactly this start tag's name and attributes. */
  const tagOfMarkup = (markup: string): SourceTag | undefined => {
    const wanted = scanTags(markup)[0]
    if (!wanted) return undefined
    return only(placed.filter((tag) => canonicalStartTag(tag) === canonicalStartTag(wanted)))
  }

  // Pair every element with its tag: the k-th of a signature with the k-th in the file.
  const paired = new Map<A11yNode, SourceTag>()
  for (const [signature, twins] of nodeGroups) {
    const name = twins[0] ? tagNameOf(twins[0]) : undefined
    if (!name) continue
    if (SINGLETONS.has(name)) {
      const tag = only(placed.filter((candidate) => candidate.name === name))
      if (tag && twins.length === 1 && twins[0]) paired.set(twins[0], tag)
      continue
    }
    const candidates = tagGroups.get(signature) ?? []
    // A truncated snapshot lacks the elements after its cut, so the file may hold more.
    if (candidates.length === twins.length || (snapshot.truncated && candidates.length > twins.length)) {
      twins.forEach((twin, index) => {
        const tag = candidates[index]
        if (tag) paired.set(twin, tag)
      })
      continue
    }
    // The counts differ: a script added or removed some. The recorded start tag, with every
    // attribute, still singles an element out when no other element may share it.
    for (const twin of twins) {
      const mine = recordedStartTag(twin)
      if (!mine || twins.some((other) => other !== twin && (recordedStartTag(other) ?? mine) === mine)) continue
      const tag = tagOfMarkup(mine)
      if (tag) paired.set(twin, tag)
    }
  }

  // A signature whose pairs disagree with the file is dropped whole: one wrong pair shifts the rest.
  const distrusted = new Set<string>()
  // Elements in document order must sit at growing offsets; one that does not was moved by the
  // parser (as content misplaced in a table) or by a script.
  const ordered = nodes.flatMap((node) => {
    const tag = paired.get(node)
    return tag ? [{ node, offset: tag.start }] : []
  })
  const suffixMin: number[] = []
  for (let i = ordered.length - 1, min = Number.POSITIVE_INFINITY; i >= 0; i--) {
    suffixMin[i] = min
    min = Math.min(min, ordered[i]?.offset ?? min)
  }
  let prefixMax = Number.NEGATIVE_INFINITY
  ordered.forEach(({ node, offset }, i) => {
    if (prefixMax >= offset || (suffixMin[i] ?? Number.POSITIVE_INFINITY) <= offset) distrusted.add(signatureOfNode(node))
    prefixMax = Math.max(prefixMax, offset)
  })
  // Where an element has twins, or the snapshot was cut, the pair must also agree on what both record.
  for (const [signature, twins] of nodeGroups) {
    if (twins.length < 2 && !snapshot.truncated) continue
    for (const twin of twins) {
      const tag = paired.get(twin)
      if (tag && !agrees(twin, tag, text)) distrusted.add(signature)
    }
  }
  const tagOfNode = (node: A11yNode): SourceTag | undefined => (distrusted.has(signatureOfNode(node)) ? undefined : paired.get(node))

  /** The tag a patch edits: usually its own element, but 2.4.2 anchors to the page and edits <title>. */
  const tagOfPatch = (patch: Patch): SourceTag | undefined => {
    const node = byRef.get(patch.ref)
    const edited = patch.before ? /^<([A-Za-z][^\t\n\f\r />]*)/.exec(patch.before)?.[1]?.toLowerCase() : undefined
    if (edited === 'title' && (!node || tagNameOf(node) !== 'title')) return tags.find((tag) => tag.name === 'title' && !tag.foreign)
    return node ? tagOfNode(node) : undefined
  }

  /**
   * An engine result without an element of the snapshot: in a frame of another origin, or past
   * the cut of a truncated snapshot. Only the last can be a tag of the file, and only when no
   * element of the snapshot shares its signature.
   */
  const tagOfEngineMarkup = (markup: string): SourceTag | undefined => {
    const wanted = scanTags(markup)[0]
    if (!snapshot.truncated || !wanted || nodeGroups.has(signatureOfTag(wanted))) return undefined
    return tagOfMarkup(markup)
  }

  return (finding) => {
    let tag: SourceTag | undefined
    let fix: SourceFix | undefined
    if (finding.patch) {
      tag = tagOfPatch(finding.patch)
      if (tag) fix = fixFor(finding.patch, tag, text, starts)
    }
    const node = finding.ref ? byRef.get(finding.ref) : undefined
    if (!tag && node) tag = tagOfNode(node)
    if (!tag && !node && finding.html && !(finding.ref && isQualifiedRef(finding.ref))) tag = tagOfEngineMarkup(finding.html)
    if (!tag) return undefined
    const element = elementRange(tag, text)
    const region = regionOf(starts, element.start, element.end)
    const snippet = text.slice(element.start, element.end)
    // A snippet must be the exact text of its region, so a long one is left out rather than cut.
    return { file: source.file, ...region, snippet: snippet.length <= MAX_SNIPPET_LENGTH ? snippet : undefined, fix }
  }
}

/** Whether an element and a tag record the same thing: every attribute, and the text when both have it. */
function agrees(node: A11yNode, tag: SourceTag, text: string): boolean {
  const recorded = recordedStartTag(node)
  if (recorded && recorded !== canonicalStartTag(tag)) return false
  const content = textContent(tag, text)
  if (node.text && content) {
    const written = text.slice(content.start, content.end)
    if (normalizeForMatch(decodeEntities(written)) !== normalizeForMatch(node.text)) return false
  }
  return true
}

/** The patch as an edit to the file, only when the file still says what the patch replaces. */
export function fixFor(patch: Patch, tag: SourceTag, text: string, starts: readonly number[] = lineStarts(text)): SourceFix | undefined {
  if (patch.before !== undefined && patch.before === patch.after) return undefined
  let start: number
  let end: number
  let insert: string
  let elementEnd = tag.end
  if (patch.kind === 'set-attribute') {
    const name = patch.attribute?.toLowerCase()
    if (!name) return undefined
    const attribute = tag.attributes.find((candidate) => candidate.name === name)
    const current = attribute?.value ?? ''
    if (patch.from !== undefined && normalizeForMatch(current) !== normalizeForMatch(patch.from)) return undefined
    const replacement = `${name}="${escapeAttribute(patch.to)}"`
    if (attribute) {
      start = attribute.start
      end = attribute.end
      insert = replacement
    } else {
      start = end = tag.attributes.at(-1)?.end ?? tag.nameEnd
      insert = ` ${replacement}`
    }
  } else {
    const content = textContent(tag, text)
    if (!content) return undefined
    const raw = text.slice(content.start, content.end)
    if (raw.trim() === '') return undefined
    if (patch.from !== undefined && normalizeForMatch(decodeEntities(raw)) !== normalizeForMatch(patch.from)) return undefined
    start = content.start + (raw.length - raw.trimStart().length)
    end = content.end - (raw.length - raw.trimEnd().length)
    insert = escapeText(patch.to)
    elementEnd = content.closeEnd
  }
  // The element as it reads in the file: from its indentation when it starts a line, then dedented.
  const lineStart = starts[positionAt(starts, tag.start).line - 1] ?? tag.start
  const from = /^[ \t]*$/.test(text.slice(lineStart, tag.start)) ? lineStart : tag.start
  const before = text.slice(from, elementEnd)
  const after = before.slice(0, start - from) + insert + before.slice(end - from)
  const indent = commonIndent(before)
  return { region: regionOf(starts, start, end), text: insert, before: dedent(before, indent), after: dedent(after, indent) }
}

function commonIndent(text: string): number {
  const indents = text
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map((line) => /^[ \t]*/.exec(line)?.[0].length ?? 0)
  return indents.length > 0 ? Math.min(...indents) : 0
}

function dedent(text: string, indent: number): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.slice(Math.min(indent, /^[ \t]*/.exec(line)?.[0].length ?? 0)))
    .join('\n')
}

/** The text between a start tag and its end tag, when that is all the element holds. */
function textContent(tag: SourceTag, text: string): { start: number; end: number; closeEnd: number } | undefined {
  const close = tag.name === 'title' || tag.name === 'textarea' ? findEndTag(text, tag.name, tag.end) : text.indexOf('<', tag.end)
  if (close === -1 || findEndTag(text, tag.name, close) !== close) return undefined
  const gt = text.indexOf('>', close)
  return gt === -1 ? undefined : { start: tag.end, end: close, closeEnd: gt + 1 }
}

/** The whole element when it is short text, otherwise its start tag. */
function elementRange(tag: SourceTag, text: string): { start: number; end: number } {
  const content = textContent(tag, text)
  if (content && content.closeEnd - tag.start <= MAX_ELEMENT_LENGTH) return { start: tag.start, end: content.closeEnd }
  return { start: tag.start, end: tag.end }
}

function regionOf(starts: readonly number[], start: number, end: number): SourceRegion {
  const from = positionAt(starts, start)
  const to = positionAt(starts, end)
  return { startLine: from.line, startColumn: from.column, endLine: to.line, endColumn: to.column }
}

function tagNameOf(node: A11yNode): string | undefined {
  return typeof node.native.tag === 'string' ? node.native.tag.toLowerCase() : undefined
}

/** A start tag with every attribute, in a form two equal tags share whatever their quoting and order. */
function canonicalStartTag(tag: Pick<SourceTag, 'name' | 'attributes'>): string {
  const attributes = tag.attributes.map((attribute) => `${attribute.name}="${escapeAttribute(attribute.value)}"`).sort()
  return `<${[tag.name, ...attributes].join(' ')}>`
}

/** The start tag the collector recorded, in canonical form. */
function recordedStartTag(node: A11yNode): string | undefined {
  if (typeof node.native.html !== 'string') return undefined
  const tag = scanTags(node.native.html)[0]
  return tag ? canonicalStartTag(tag) : undefined
}

function signatureOf(name: string, attributes: Record<string, string>): string {
  const kept = KEPT_ATTRIBUTES.filter((attribute) => attribute in attributes).map((attribute) => `${attribute}=${attributes[attribute]}`)
  return [name, ...kept].join('\u0000')
}

function signatureOfNode(node: A11yNode): string {
  const attributes = (node.native.attributes ?? {}) as Record<string, string>
  return signatureOf(tagNameOf(node) ?? '', attributes)
}

function signatureOfTag(tag: SourceTag): string {
  const attributes: Record<string, string> = {}
  for (const attribute of tag.attributes) attributes[attribute.name] = attribute.value.slice(0, KEPT_VALUE_LENGTH)
  return signatureOf(tag.name, attributes)
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const name = key(item)
    const group = groups.get(name)
    if (group) group.push(item)
    else groups.set(name, [item])
  }
  return groups
}

function only<T>(items: readonly T[]): T | undefined {
  return items.length === 1 ? items[0] : undefined
}

function escapeAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;')
}

function escapeText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

// Files

/** The local file behind a target: a file:// URL or a path to an .html file, as recorded snapshots keep it. */
export function localPagePath(target: string, cwd = process.cwd()): string | undefined {
  if (target.startsWith('file:')) {
    try {
      return fileURLToPath(target)
    } catch {
      return undefined
    }
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(target) || !/\.html?$/i.test(target)) return undefined
  return resolve(cwd, target)
}

/** The closest directory with a .git entry: what GitHub resolves SARIF paths against. */
export async function repositoryRoot(cwd = process.cwd()): Promise<string | undefined> {
  let dir = resolve(cwd)
  for (;;) {
    if (await stat(join(dir, '.git')).catch(() => undefined)) return dir
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

/** A path relative to the root, or to the working directory, so reports never carry a home directory when they can avoid it. */
export function displayPath(path: string, root: string, cwd = process.cwd()): string {
  for (const base of [root, cwd]) {
    const rel = relative(base, path)
    if (rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)) return rel.split(sep).join('/')
  }
  return path.split(sep).join('/')
}

export async function readPageSource(target: string, root: string, cwd = process.cwd()): Promise<PageSource | undefined> {
  const path = localPagePath(target, cwd)
  if (!path) return undefined
  try {
    const text = await readFile(path, 'utf8')
    // Editors do not count a byte order mark as a column.
    return { file: displayPath(path, root, cwd), text: text.startsWith('﻿') ? text.slice(1) : text }
  } catch {
    return undefined
  }
}
