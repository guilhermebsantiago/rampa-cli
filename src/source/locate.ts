import { readFile, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Finding, Patch, Report, SourceFix, SourceLocation, SourceRegion } from '../core/types.ts'
import { normalizeForMatch } from '../core/util.ts'
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
  const nodes = [...walkTree(snapshot.root)]
  const byRef = new Map(nodes.map((node) => [node.ref, node]))
  const nodeGroups = groupBy(nodes, (node) => signatureOfNode(node))
  const tagGroups = groupBy(placed, signatureOfTag)

  const tagOfNode = (node: A11yNode): SourceTag | undefined => {
    const name = tagNameOf(node)
    if (!name) return undefined
    if (SINGLETONS.has(name)) return only(placed.filter((tag) => tag.name === name))
    const signature = signatureOfNode(node)
    const twins = nodeGroups.get(signature) ?? []
    const candidates = tagGroups.get(signature) ?? []
    const index = twins.indexOf(node)
    // A truncated snapshot lacks the elements after its cut, which keeps the count of those before it.
    if (index !== -1 && (candidates.length === twins.length || (snapshot.truncated && index < candidates.length))) return candidates[index]
    // The recorded start tag, with every attribute, can still single the element out, unless
    // another element may share it: then nothing tells which of the two the file holds.
    const mine = recordedStartTag(node)
    if (!mine || twins.some((twin) => twin !== node && (recordedStartTag(twin) ?? mine) === mine)) return undefined
    return tagOfMarkup(mine)
  }

  /** The one tag in the file with exactly this start tag's name and attributes. */
  const tagOfMarkup = (markup: string): SourceTag | undefined => {
    const wanted = scanTags(markup)[0]
    if (!wanted) return undefined
    const same = (tag: SourceTag) =>
      tag.name === wanted.name &&
      tag.attributes.length === wanted.attributes.length &&
      wanted.attributes.every((attribute) => tag.attributes.some((other) => other.name === attribute.name && other.value === attribute.value))
    return only(placed.filter(same))
  }

  /** The tag a patch edits: usually its own element, but 2.4.2 anchors to the page and edits <title>. */
  const tagOfPatch = (patch: Patch): SourceTag | undefined => {
    const node = byRef.get(patch.ref)
    const edited = patch.before ? /^<([A-Za-z][^\t\n\f\r />]*)/.exec(patch.before)?.[1]?.toLowerCase() : undefined
    if (edited === 'title' && (!node || tagNameOf(node) !== 'title')) return tags.find((tag) => tag.name === 'title' && !tag.foreign)
    return node ? tagOfNode(node) : undefined
  }

  return (finding) => {
    let tag: SourceTag | undefined
    let fix: SourceFix | undefined
    if (finding.patch) {
      tag = tagOfPatch(finding.patch)
      if (tag) fix = fixFor(finding.patch, tag, text, starts)
    }
    if (!tag && finding.ref) {
      const node = byRef.get(finding.ref)
      if (node) tag = tagOfNode(node)
    }
    if (!tag && finding.html) tag = tagOfMarkup(finding.html)
    if (!tag) return undefined
    const element = elementRange(tag, text)
    const region = regionOf(starts, element.start, element.end)
    const snippet = text.slice(element.start, element.end)
    return {
      file: source.file,
      ...region,
      snippet: snippet.length > MAX_SNIPPET_LENGTH ? `${snippet.slice(0, MAX_SNIPPET_LENGTH - 1)}…` : snippet,
      fix,
    }
  }
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

/** The start tag the collector recorded, with every attribute, in a form two equal tags share. */
function recordedStartTag(node: A11yNode): string | undefined {
  if (typeof node.native.html !== 'string') return undefined
  const tag = scanTags(node.native.html)[0]
  if (!tag) return undefined
  const attributes = tag.attributes.map((attribute) => `${attribute.name}="${escapeAttribute(attribute.value)}"`).sort()
  return `<${[tag.name, ...attributes].join(' ')}>`
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
