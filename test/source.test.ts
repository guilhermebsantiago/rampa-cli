import { readFileSync } from 'node:fs'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { Finding, SourceFix } from '../src/core/types.ts'
import type { A11ySnapshot } from '../src/snapshot/schema.ts'
import { decodeEntities, lineStarts, positionAt, scanTags } from '../src/source/html.ts'
import { KEPT_ATTRIBUTES, createLocator, displayPath, fixFor, localPagePath, readPageSource, repositoryRoot } from '../src/source/locate.ts'
import { node } from './helpers.ts'
import { recordedReport } from './report-fixtures.ts'

function applyFix(text: string, fix: SourceFix): string {
  const starts = lineStarts(text)
  const offset = (line: number, column: number) => (starts[line - 1] ?? 0) + column - 1
  return text.slice(0, offset(fix.region.startLine, fix.region.startColumn)) + fix.text + text.slice(offset(fix.region.endLine, fix.region.endColumn))
}

function page(children: ReturnType<typeof node>[]): A11ySnapshot {
  return {
    schemaVersion: 1,
    surface: 'web',
    target: 'page.html',
    viewport: { width: 1280, height: 800, scale: 1 },
    collectedAt: '2026-10-08T00:00:00.000Z',
    collector: { name: 'test', version: '0' },
    root: node({
      ref: 'html',
      role: 'document',
      native: { tag: 'html', attributes: {}, html: '<html>' },
      children: [node({ ref: 'html > body', native: { tag: 'body', attributes: {} }, children })],
    }),
  }
}

function finding(ref: string, extra: Partial<Finding> = {}): Finding {
  return { fingerprint: ref, criterion: '2.4.4', level: 'A', source: 'judgment', ref, message: 'm', confidence: 'high', ...extra }
}

describe('scanTags', () => {
  it('reads tag names, attributes and offsets as the parser does', () => {
    const html = '<P Class="a" data-x=\'1\' hidden id=x>text</P>'
    const [tag] = scanTags(html)
    expect(tag).toMatchObject({ name: 'p', start: 0, end: 36, nameEnd: 2, leftOut: false, foreign: false })
    expect(tag?.attributes.map((a) => [a.name, a.value])).toEqual([
      ['class', 'a'],
      ['data-x', '1'],
      ['hidden', ''],
      ['id', 'x'],
    ])
    expect(html.slice(tag?.attributes[0]?.start, tag?.attributes[0]?.end)).toBe('Class="a"')
  })

  it('skips comments, the doctype and raw text, where a < is not a tag', () => {
    const html = '<!doctype html><!-- <a href="no"> --><script>if (a < b) document.write("<img src=x>")</script><style>p>a{}</style><textarea><b>no</b></textarea><a href="yes">x</a>'
    const placed = scanTags(html).filter((tag) => !tag.leftOut)
    expect(placed.map((tag) => tag.name)).toEqual(['textarea', 'a'])
    expect(placed[1]?.attributes[0]?.value).toBe('yes')
  })

  it('marks what the snapshot leaves out: the head, templates and their content', () => {
    const html = '<html><head><title>T</title><meta charset="utf-8"><link rel="icon"></head><body><template><p>t</p></template><p>real</p></body></html>'
    const tags = scanTags(html)
    expect(tags.filter((tag) => !tag.leftOut).map((tag) => tag.name)).toEqual(['html', 'body', 'p'])
    expect(tags.filter((tag) => tag.leftOut).map((tag) => tag.name)).toEqual(['head', 'title', 'meta', 'link', 'template', 'p'])
  })

  it('ends a head whose end tag is missing at the first element that cannot be in it', () => {
    const tags = scanTags('<head><title>T</title><p>body text')
    expect(tags.find((tag) => tag.name === 'p')?.leftOut).toBe(false)
  })

  it('decodes character references and keeps the first of two equal attributes', () => {
    const [tag] = scanTags('<img alt="caf&eacute; &amp; p&atilde;o &#233;&#x41; &unknown;" alt="second">')
    expect(tag?.attributes).toHaveLength(1)
    expect(tag?.attributes[0]?.value).toBe('café & pão éA &unknown;')
    expect(decodeEntities('&nbsp;&copy;&yuml;&mdash;&#0;')).toBe(' ©ÿ—�')
    // As browsers read them: Windows-1252 for 0x80-0x9F, legacy names without a semicolon, `&name=` kept in attributes.
    expect(decodeEntities('&#150;&#x80; &copy 2026 &hellip')).toBe('–€ © 2026 &hellip')
    expect(scanTags('<a href="/s?a=1&copy=2">x</a>')[0]?.attributes[0]?.value).toBe('/s?a=1&copy=2')
  })

  it('ends a comment at --!> too', () => {
    expect(scanTags('<!-- a --!><p>x</p>').map((tag) => tag.name)).toEqual(['p'])
  })

  it('reads unquoted values, self-closing slashes and values across lines', () => {
    const [link, image] = scanTags("<a href=/x/y title='a\r\nb'/><img\n  src=\"a.png\"\n/>")
    expect(link?.attributes.map((a) => [a.name, a.value])).toEqual([
      ['href', '/x/y'],
      ['title', 'a\nb'],
    ])
    expect(image?.attributes[0]?.value).toBe('a.png')
  })

  it('treats svg content as ordinary elements', () => {
    const tags = scanTags('<svg><title>Logo</title><style>.a{}</style><path d="M0"/></svg><p>x</p>')
    expect(tags.map((tag) => [tag.name, tag.foreign])).toEqual([
      ['svg', false],
      ['title', true],
      ['style', true],
      ['path', true],
      ['p', false],
    ])
  })

  it('stops at a tag cut off by the end of the file', () => {
    expect(scanTags('<p>ok</p><a href="x').map((tag) => tag.name)).toEqual(['p'])
  })
})

describe('positions', () => {
  it('counts lines across \\n, \\r\\n and \\r, and columns from 1', () => {
    const starts = lineStarts('ab\ncd\r\nef\rgh')
    expect(starts).toEqual([0, 3, 7, 10])
    expect(positionAt(starts, 0)).toEqual({ line: 1, column: 1 })
    expect(positionAt(starts, 4)).toEqual({ line: 2, column: 2 })
    expect(positionAt(starts, 11)).toEqual({ line: 4, column: 2 })
  })
})

describe('locateReport', () => {
  it('places every finding of the store page on the line that holds it', async () => {
    const { report } = await recordedReport()
    expect(report.sourceFile).toBe('examples/store/before.html')
    expect(report.findings.map((f) => `${f.criterion} ${f.location?.file}:${f.location?.startLine}`)).toEqual([
      '1.1.1 examples/store/before.html:18',
      '1.1.1 examples/store/before.html:22',
      '1.1.1 examples/store/before.html:23',
      '1.1.1 examples/store/before.html:24',
      '2.4.2 examples/store/before.html:5',
      '2.4.4 examples/store/before.html:31',
      '2.4.6 examples/store/before.html:32',
      '2.4.6 examples/store/before.html:37',
      '3.1.2 examples/store/before.html:33',
    ])
    const link = report.findings.find((f) => f.criterion === '2.4.4')
    expect(link?.location).toMatchObject({ startColumn: 10, endLine: 31, endColumn: 48, snippet: '<a href="shipping.html">Click here</a>' })
  })

  it('turns each patch into an edit of one line that applies to the file', async () => {
    const { report } = await recordedReport()
    const text = readFileSync('examples/store/before.html', 'utf8')
    const edits = report.findings.filter((f) => f.patch)
    expect(edits).toHaveLength(8)
    for (const f of edits) {
      const fix = f.location?.fix
      if (!fix) throw new Error(`no fix for ${f.criterion} ${f.ref}`)
      const edited = applyFix(text, fix)
      const changed = edited.split('\n').filter((line, index) => line !== text.split('\n')[index])
      expect(changed).toHaveLength(1)
      expect(changed[0]?.trim()).toContain(fix.after.trim())
    }
    const title = edits.find((f) => f.criterion === '2.4.2')?.location?.fix
    expect(title).toMatchObject({ before: '<title>Untitled document</title>', after: '<title>Corner Store - New Arrivals</title>' })
    const label = edits.find((f) => f.ref === '#email')?.location?.fix
    expect(label?.after).toBe('<label for="email">Email address</label>')
    // The source keeps its self-closing slash; the snapshot's markup never had it.
    const mug = edits.find((f) => f.location?.startLine === 22)?.location?.fix
    expect(mug?.after).toBe('<img src="mug.svg" alt="Blue mug with steam" />')
  })

  it('dedents an element written over several lines and changes only its line', async () => {
    const { report } = await recordedReport('examples-language-of-parts-match')
    const fix = report.findings.find((f) => f.criterion === '1.1.1')?.location?.fix
    expect(fix?.before.split('\n')[0]).toBe('<img')
    expect(fix?.before.split('\n')[4]).toBe('  alt="Blue sky over the market"')
    expect(fix?.region.startLine).toBe(fix?.region.endLine)
  })

  it('does not guess between twins when a script changed how many there are', () => {
    const snapshot = page([
      node({ ref: 'a1', role: 'link', native: { tag: 'a', attributes: { href: '/more' }, html: '<a href="/more">More</a>' } }),
      node({ ref: 'a2', role: 'link', native: { tag: 'a', attributes: { href: '/more' }, html: '<a href="/more">More</a>' } }),
      node({ ref: 'b1', role: 'link', native: { tag: 'a', attributes: { href: '/x' }, html: '<a href="/x" data-track="1">X</a>' } }),
      node({ ref: 'b2', role: 'link', native: { tag: 'a', attributes: { href: '/x' }, html: '<a href="/x" data-track="2">X</a>' } }),
      node({ ref: 'img', role: 'img', native: { tag: 'img', attributes: { src: 'a.png' } } }),
    ])
    const text = '<!doctype html>\n<html>\n<body>\n<a href="/more">More</a>\n<a href="/x" data-track="1">X</a>\n<img src="a.png" width="10">\n</body>\n</html>\n'
    const locate = createLocator(snapshot, { file: 'page.html', text })
    expect(locate(finding('a1'))).toBeUndefined()
    expect(locate(finding('a2'))).toBeUndefined()
    // Its full start tag still singles b1 out; b2 is not in the file.
    expect(locate(finding('b1'))?.startLine).toBe(5)
    expect(locate(finding('b2'))).toBeUndefined()
    expect(locate(finding('img'))?.startLine).toBe(6)
    expect(locate(finding('html'))?.startLine).toBe(2)
  })

  it('places an engine finding by its markup only when the snapshot was cut before its element', () => {
    const text = '<html><body>\n<iframe src="/map"></iframe>\n</body></html>'
    const engine = { ...finding('none'), ref: undefined, source: 'engine' as const, html: '<iframe src="/map"></iframe>' }
    expect(createLocator({ ...page([]), truncated: true }, { file: 'page.html', text })(engine)?.startLine).toBe(2)
    // Not cut: an element the snapshot lacks is in a shadow root or a frame, not in this file.
    expect(createLocator(page([]), { file: 'page.html', text })(engine)).toBeUndefined()
  })

  it('leaves unplaced an engine finding on an element a script added next to a static twin', () => {
    // As axe-core reports it: an icon-only link a script added, and the static link with text.
    const snapshot = page([
      node({ ref: '#top > a', role: 'link', native: { tag: 'a', attributes: { href: '/cart' }, html: '<a href="/cart"><svg></svg></a>' } }),
      node({ ref: 'main a', role: 'link', text: 'Cart (2 items)', native: { tag: 'a', attributes: { href: '/cart' }, html: '<a href="/cart">Cart (2 items)</a>' } }),
    ])
    const text = '<html><body>\n<header id="top"></header>\n<main><a href="/cart">Cart (2 items)</a></main>\n</body></html>'
    const locate = createLocator(snapshot, { file: 'page.html', text })
    const engine = { ...finding('#top > a'), source: 'engine' as const, html: '<a href="/cart"><svg></svg></a>' }
    expect(locate(engine)).toBeUndefined()
    // In a shadow root axe-core gives no ref; the static twin in the snapshot still rules the file out.
    expect(locate({ ...engine, ref: undefined })).toBeUndefined()
  })

  it('drops pairs that the order of the file contradicts, as content the parser moved out of a table', () => {
    // The browser moves the stray link before the table; the file has it after the cell's link.
    const snapshot = page([
      node({ ref: 'body > a', role: 'link', text: 'More', native: { tag: 'a', attributes: { href: '/x' } } }),
      node({
        ref: 'table',
        role: 'table',
        native: { tag: 'table', attributes: {} },
        children: [node({ ref: 'td > a', role: 'link', text: 'Shipping details', native: { tag: 'a', attributes: { href: '/x' } } })],
      }),
    ])
    const text = '<html><body>\n<table><tr><td>\n<a href="/x">Shipping details</a>\n</td></tr>\n<a href="/x">More</a>\n</table>\n</body></html>'
    const locate = createLocator(snapshot, { file: 'page.html', text })
    expect(locate(finding('body > a'))).toBeUndefined()
    expect(locate(finding('td > a'))).toBeUndefined()
  })

  it('checks the text of twins, so a script that reordered them cannot swap their lines', () => {
    const snapshot = page([
      node({ ref: 'li:nth-of-type(1) > a', role: 'link', text: 'Beta', native: { tag: 'a', attributes: { href: '/p' } } }),
      node({ ref: 'li:nth-of-type(2) > a', role: 'link', text: 'Alpha', native: { tag: 'a', attributes: { href: '/p' } } }),
    ])
    const text = '<html><body>\n<a href="/p">Alpha</a>\n<a href="/p">Beta</a>\n</body></html>'
    expect(createLocator(snapshot, { file: 'page.html', text })(finding('li:nth-of-type(1) > a'))).toBeUndefined()
  })

  it('checks every pair of a truncated snapshot, where the counts prove nothing', () => {
    // A cookie banner's link sits before the cut; the footer link that shares its signature is past it.
    const snapshot = {
      ...page([node({ ref: '#cookie > a', role: 'link', text: 'Learn more', native: { tag: 'a', attributes: { href: '/privacy' } } })]),
      truncated: true,
    }
    const text = '<html><body>\n<main>...</main>\n<footer><a href="/privacy">Privacy policy</a></footer>\n</body></html>'
    expect(createLocator(snapshot, { file: 'page.html', text })(finding('#cookie > a'))).toBeUndefined()
  })

  it('leaves the fix out when the file no longer says what the patch replaces', () => {
    const snapshot = page([node({ ref: 'a', role: 'link', native: { tag: 'a', attributes: { href: '/s' } } })])
    const text = '<html><body><a href="/s">Shipping details</a></body></html>'
    const located = createLocator(snapshot, { file: 'page.html', text })(
      finding('a', { patch: { ref: 'a', kind: 'set-text', from: 'Click here', to: 'Shipping' } }),
    )
    expect(located?.startLine).toBe(1)
    expect(located?.fix).toBeUndefined()
  })

  it('adds an attribute the tag does not have yet', () => {
    const text = '<img src="a.png" data-x="1">'
    const [tag] = scanTags(text)
    if (!tag) throw new Error('no tag')
    const fix = fixFor({ ref: 'img', kind: 'set-attribute', attribute: 'alt', from: '', to: 'A "red" chair & table' }, tag, text)
    expect(fix?.after).toBe('<img src="a.png" data-x="1" alt="A &quot;red&quot; chair &amp; table">')
    // An insertion is an empty region, right after the last attribute.
    expect(fix?.region).toEqual({ startLine: 1, startColumn: 28, endLine: 1, endColumn: 28 })
  })

  it('keeps its list of attributes equal to what the web collector records', () => {
    const inPage = readFileSync('src/surfaces/in-page.ts', 'utf8')
    const list = /const KEEP_ATTRS = \[([^\]]*)\]/.exec(inPage)?.[1] ?? ''
    expect([...list.matchAll(/'([^']+)'/g)].map((match) => match[1])).toEqual([...KEPT_ATTRIBUTES])
  })
})

describe('source files', () => {
  it('finds the file behind a target', () => {
    const cwd = resolve('examples')
    expect(localPagePath(pathToFileURL(resolve('examples/store/before.html')).href)).toBe(resolve('examples/store/before.html'))
    expect(localPagePath('store/before.html', cwd)).toBe(resolve('examples/store/before.html'))
    expect(localPagePath('https://example.com/page.html')).toBeUndefined()
    expect(localPagePath('test://travel')).toBeUndefined()
    expect(localPagePath('com.example.app')).toBeUndefined()
  })

  it('writes paths relative to the repository root', async () => {
    const root = await repositoryRoot(resolve('src/report'))
    expect(root).toBe(resolve('.'))
    expect(displayPath(resolve('examples/store/before.html'), resolve('.'))).toBe('examples/store/before.html')
  })

  it('reads the source without its byte order mark, so columns match an editor', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rampa-source-'))
    await writeFile(join(dir, 'page.html'), '﻿<p>x</p>', 'utf8')
    const source = await readPageSource(pathToFileURL(join(dir, 'page.html')).href, dir, dir)
    expect(source).toEqual({ file: 'page.html', text: '<p>x</p>' })
    expect(await readPageSource(pathToFileURL(join(dir, 'missing.html')).href, dir, dir)).toBeUndefined()
  })
})
