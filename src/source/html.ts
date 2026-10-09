/**
 * A small scanner for the start tags of an HTML file, enough to trace an element of
 * the snapshot back to the line it was written on. It follows only the tokenizer
 * rules that decide where a tag is: comments, raw text such as <script> and <style>,
 * quoted attribute values. The browser already built the DOM; this finds tags in the file.
 */

export interface SourceAttribute {
  /** Lowercase, as the DOM reports it. */
  name: string
  /** With character references decoded; empty for an attribute without a value. */
  value: string
  /** From the first character of the name to just past the value. */
  start: number
  end: number
}

export interface SourceTag {
  /** Lowercase. */
  name: string
  attributes: SourceAttribute[]
  /** Offset of `<`. */
  start: number
  /** Just past `>`. */
  end: number
  /** Just past the tag name, where a new attribute goes when the tag has none. */
  nameEnd: number
  /** Inside an element the web collector leaves out of the snapshot (head, template...), or one of those itself. */
  leftOut: boolean
  /** Inside <svg> or <math>, where <title> and <style> are ordinary elements. */
  foreign: boolean
}

/** The elements surfaces/in-page.ts skips, with their subtrees. */
const LEFT_OUT = new Set(['script', 'style', 'noscript', 'template', 'head', 'meta', 'link', 'title', 'base'])
const HEAD_CONTENT = new Set(['meta', 'link', 'title', 'style', 'script', 'noscript', 'base', 'template'])
/** Their content is text up to the matching end tag, never markup (noscript too, since pages run with scripts on). */
const RAW_TEXT = new Set(['script', 'style', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript', 'title', 'textarea'])

const isSpace = (char: string | undefined): boolean => char === ' ' || char === '\n' || char === '\t' || char === '\r' || char === '\f'
const isLetter = (char: string | undefined): boolean => char !== undefined && /[A-Za-z]/.test(char)

export function scanTags(html: string): SourceTag[] {
  const tags: SourceTag[] = []
  let inHead = false
  let templates = 0
  let foreign = 0
  let i = 0
  while (i < html.length) {
    const lt = html.indexOf('<', i)
    if (lt === -1) break
    const next = html[lt + 1]
    if (next === '!') {
      i = skipMarkupDeclaration(html, lt, foreign > 0)
      continue
    }
    if (next === '?') {
      i = endOfBogusComment(html, lt)
      continue
    }
    if (next === '/') {
      if (!isLetter(html[lt + 2])) {
        i = html[lt + 2] === '>' ? lt + 3 : endOfBogusComment(html, lt)
        continue
      }
      let end = lt + 2
      while (end < html.length && !isSpace(html[end]) && html[end] !== '/' && html[end] !== '>') end++
      const name = html.slice(lt + 2, end).toLowerCase()
      if (name === 'head') inHead = false
      if (name === 'template' && templates > 0) templates--
      if ((name === 'svg' || name === 'math') && foreign > 0) foreign--
      const close = html.indexOf('>', end)
      i = close === -1 ? html.length : close + 1
      continue
    }
    if (!isLetter(next)) {
      i = lt + 1
      continue
    }
    const read = readStartTag(html, lt)
    // A tag cut off by the end of the file is not a tag.
    if (!read) break
    const { name } = read
    // Anything but head content ends a head whose end tag was left out, as the parser does.
    if (inHead && templates === 0 && !HEAD_CONTENT.has(name)) inHead = false
    tags.push({ ...read, leftOut: inHead || templates > 0 || LEFT_OUT.has(name), foreign: foreign > 0 })
    i = read.end
    if (foreign > 0) {
      if ((name === 'svg' || name === 'math') && !read.selfClosing) foreign++
      continue
    }
    if (name === 'head') inHead = true
    else if (name === 'template') templates++
    else if ((name === 'svg' || name === 'math') && !read.selfClosing) foreign++
    else if (name === 'plaintext') break
    else if (RAW_TEXT.has(name)) {
      const close = findEndTag(html, name, read.end)
      i = close === -1 ? html.length : close
    }
  }
  return tags
}

/** Where the end tag of a raw text element starts, or -1. */
export function findEndTag(html: string, name: string, from: number): number {
  let at = html.indexOf('</', from)
  while (at !== -1) {
    const after = html[at + 2 + name.length]
    if (html.slice(at + 2, at + 2 + name.length).toLowerCase() === name && (after === undefined || isSpace(after) || after === '/' || after === '>')) {
      return at
    }
    at = html.indexOf('</', at + 2)
  }
  return -1
}

function skipMarkupDeclaration(html: string, lt: number, foreign: boolean): number {
  if (html.startsWith('<!--', lt)) {
    // `<!-->` and `<!--->` are complete, empty comments.
    if (html.startsWith('<!-->', lt)) return lt + 5
    if (html.startsWith('<!--->', lt)) return lt + 6
    // `--!>` also closes a comment, as a parse error.
    const ends = [html.indexOf('-->', lt + 4), html.indexOf('--!>', lt + 4)].filter((at) => at !== -1)
    if (ends.length === 0) return html.length
    const close = Math.min(...ends)
    return close + (html.startsWith('-->', close) ? 3 : 4)
  }
  if (foreign && html.startsWith('<![CDATA[', lt)) {
    const close = html.indexOf(']]>', lt + 9)
    return close === -1 ? html.length : close + 3
  }
  // A doctype, or a bogus comment.
  return endOfBogusComment(html, lt)
}

function endOfBogusComment(html: string, lt: number): number {
  const close = html.indexOf('>', lt + 2)
  return close === -1 ? html.length : close + 1
}

interface StartTag {
  name: string
  attributes: SourceAttribute[]
  start: number
  end: number
  nameEnd: number
  selfClosing: boolean
}

function readStartTag(html: string, lt: number): StartTag | undefined {
  let i = lt + 1
  while (i < html.length && !isSpace(html[i]) && html[i] !== '/' && html[i] !== '>') i++
  const name = html.slice(lt + 1, i).toLowerCase()
  const nameEnd = i
  const attributes: SourceAttribute[] = []
  const tag = (end: number, selfClosing: boolean): StartTag => ({ name, attributes, start: lt, end, nameEnd, selfClosing })
  while (i < html.length) {
    const char = html[i]
    if (isSpace(char)) {
      i++
      continue
    }
    if (char === '>') return tag(i + 1, false)
    if (char === '/') {
      if (html[i + 1] === '>') return tag(i + 2, true)
      i++
      continue
    }
    // The first character of a name may be `=`: a parse error that still starts a name.
    const start = i++
    while (i < html.length && !isSpace(html[i]) && html[i] !== '/' && html[i] !== '>' && html[i] !== '=') i++
    const attributeName = html.slice(start, i).toLowerCase()
    let end = i
    let raw = ''
    let j = i
    while (isSpace(html[j])) j++
    if (html[j] === '=') {
      j++
      while (isSpace(html[j])) j++
      const quote = html[j]
      if (quote === '"' || quote === "'") {
        const close = html.indexOf(quote, j + 1)
        if (close === -1) return undefined
        raw = html.slice(j + 1, close)
        end = close + 1
      } else {
        let k = j
        while (k < html.length && !isSpace(html[k]) && html[k] !== '>') k++
        raw = html.slice(j, k)
        end = k
      }
      i = end
    }
    // The parser keeps the first of two attributes with the same name, and reads every line break as \n.
    if (!attributes.some((attribute) => attribute.name === attributeName)) {
      attributes.push({ name: attributeName, value: decodeEntities(raw.replace(/\r\n?/g, '\n'), true), start, end })
    }
  }
  return undefined
}

// Character references. The full HTML table has over 2000 names; these cover markup in
// English and Portuguese. An unknown name stays as written, so the element simply does not match.
const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  OElig: 'Œ',
  oelig: 'œ',
  Scaron: 'Š',
  scaron: 'š',
  Yuml: 'Ÿ',
  fnof: 'ƒ',
  circ: 'ˆ',
  tilde: '˜',
  ensp: ' ',
  emsp: ' ',
  thinsp: ' ',
  zwnj: '‌',
  zwj: '‍',
  lrm: '‎',
  rlm: '‏',
  ndash: '–',
  mdash: '—',
  lsquo: '‘',
  rsquo: '’',
  sbquo: '‚',
  ldquo: '“',
  rdquo: '”',
  bdquo: '„',
  dagger: '†',
  Dagger: '‡',
  bull: '•',
  hellip: '…',
  permil: '‰',
  prime: '′',
  Prime: '″',
  lsaquo: '‹',
  rsaquo: '›',
  euro: '€',
  trade: '™',
  larr: '←',
  uarr: '↑',
  rarr: '→',
  darr: '↓',
}
// Latin-1, in code point order from U+00A0.
const LATIN1 =
  'nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest ' +
  'Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig ' +
  'agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml'
/** Names the parser also reads without a semicolon: the Latin-1 ones and four more. */
const LEGACY = new Set(['amp', 'lt', 'gt', 'quot', ...LATIN1.split(' ')])
LATIN1.split(' ').forEach((name, index) => {
  NAMED[name] = String.fromCodePoint(0xa0 + index)
})
/** Numeric references from 0x80 to 0x9F name Windows-1252 characters, as browsers read them. */
const WINDOWS_1252 = [
  0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152, 0x8d, 0x17d, 0x8f, 0x90, 0x2018, 0x2019, 0x201c, 0x201d,
  0x2022, 0x2013, 0x2014, 0x2dc, 0x2122, 0x161, 0x203a, 0x153, 0x9d, 0x17e, 0x178,
]

/** Character references decoded as the parser does; in an attribute, `&copy=` stays as written. */
export function decodeEntities(text: string, attribute = false): string {
  if (!text.includes('&')) return text
  return text.replace(/&(#[0-9]+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*)(;?)/g, (match, reference: string, semicolon: string, offset: number) => {
    if (reference.startsWith('#')) {
      const code = reference[1] === 'x' || reference[1] === 'X' ? Number.parseInt(reference.slice(2), 16) : Number.parseInt(reference.slice(1), 10)
      if (code >= 0x80 && code <= 0x9f) return String.fromCodePoint(WINDOWS_1252[code - 0x80] ?? code)
      const valid = code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff)
      return valid ? String.fromCodePoint(code) : '�'
    }
    if (!semicolon && (!LEGACY.has(reference) || (attribute && text[offset + match.length] === '='))) return match
    return NAMED[reference] ?? match
  })
}

/** Offsets where each line starts; \n, \r\n and a lone \r all end a line. */
export function lineStarts(text: string): number[] {
  const starts = [0]
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code === 10) starts.push(i + 1)
    else if (code === 13) {
      if (text.charCodeAt(i + 1) === 10) i++
      starts.push(i + 1)
    }
  }
  return starts
}

/** 1-based line and column of an offset; columns count UTF-16 code units. */
export function positionAt(starts: readonly number[], offset: number): { line: number; column: number } {
  let low = 0
  let high = starts.length - 1
  while (low < high) {
    const middle = (low + high + 1) >> 1
    if ((starts[middle] ?? 0) <= offset) low = middle
    else high = middle - 1
  }
  return { line: low + 1, column: offset - (starts[low] ?? 0) + 1 }
}
