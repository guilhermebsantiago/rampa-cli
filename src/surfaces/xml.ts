import { RampaError } from '../core/util.ts'

/**
 * A small XML reader for accessibility dumps (UI Automator, Appium page source). It keeps
 * elements and attributes and drops text, comments and processing instructions. It never
 * reads a DTD or resolves an entity beyond the five predefined ones and character
 * references, so a dump cannot make it fetch or expand anything.
 */

export interface XmlElement {
  name: string
  attributes: Record<string, string>
  children: XmlElement[]
}

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

export function decodeEntities(value: string): string {
  if (!value.includes('&')) return value
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === '#') {
      const code = entity[1] === 'x' || entity[1] === 'X' ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10)
      if (!Number.isFinite(code) || code > 0x10ffff) return match
      // Control characters other than tab and line breaks carry nothing a person reads.
      if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) return ''
      return String.fromCodePoint(code)
    }
    return NAMED[entity.toLowerCase()] ?? match
  })
}

function syntaxError(reason: string, at: number): RampaError {
  return new RampaError('invalid-xml', `Not readable XML (${reason} at character ${at})`)
}

const isSpace = (code: number) => code === 32 || code === 9 || code === 10 || code === 13
/** Characters that end a tag or attribute name: whitespace, =, / and >. */
const endsName = (code: number) => isSpace(code) || code === 61 || code === 47 || code === 62

/**
 * The first root element in `text`. What comes after it is ignored, because
 * `uiautomator dump /dev/tty` prints a status line right after the XML.
 */
export function parseXml(text: string): XmlElement {
  const length = text.length
  const stack: XmlElement[] = []
  const skipSpace = (from: number): number => {
    let at = from
    while (at < length && isSpace(text.charCodeAt(at))) at++
    return at
  }
  const skipPast = (from: number, marker: string, what: string): number => {
    const end = text.indexOf(marker, from)
    if (end === -1) throw syntaxError(`unclosed ${what}`, from)
    return end + marker.length
  }

  let i = 0
  while (i < length) {
    const open = text.indexOf('<', i)
    if (open === -1) break
    i = open
    if (text.startsWith('<!--', i)) {
      i = skipPast(i + 4, '-->', 'comment')
      continue
    }
    if (text.startsWith('<?', i)) {
      i = skipPast(i + 2, '?>', 'declaration')
      continue
    }
    if (text.startsWith('<![CDATA[', i)) {
      i = skipPast(i + 9, ']]>', 'CDATA section')
      continue
    }
    if (text.startsWith('<!', i)) {
      // A DOCTYPE or another declaration: skipped, never interpreted.
      i = skipPast(i + 2, '>', 'declaration')
      continue
    }
    if (text.charCodeAt(i + 1) === 47) {
      const end = skipPast(i + 2, '>', 'end tag')
      const name = text.slice(i + 2, end - 1).trim()
      const current = stack.pop()
      if (!current || current.name !== name) throw syntaxError(`unexpected </${name}>`, i)
      if (stack.length === 0) return current
      i = end
      continue
    }

    // A start tag: its name, then attributes until > or />.
    let j = i + 1
    while (j < length && !endsName(text.charCodeAt(j))) j++
    const element: XmlElement = { name: text.slice(i + 1, j), attributes: {}, children: [] }
    if (element.name === '') throw syntaxError('empty tag name', i)
    let selfClosing = false
    for (;;) {
      j = skipSpace(j)
      if (j >= length) throw syntaxError(`unclosed <${element.name}>`, i)
      const code = text.charCodeAt(j)
      if (code === 62) {
        j++
        break
      }
      if (code === 47 && text.charCodeAt(j + 1) === 62) {
        selfClosing = true
        j += 2
        break
      }
      const nameStart = j
      while (j < length && !endsName(text.charCodeAt(j))) j++
      const attribute = text.slice(nameStart, j)
      j = skipSpace(j)
      if (text.charCodeAt(j) !== 61) throw syntaxError(`attribute ${attribute} without a value`, j)
      j = skipSpace(j + 1)
      const quote = text[j]
      if (quote !== '"' && quote !== "'") throw syntaxError(`unquoted value for ${attribute}`, j)
      const end = text.indexOf(quote, j + 1)
      if (end === -1) throw syntaxError(`unclosed value for ${attribute}`, j)
      element.attributes[attribute] = decodeEntities(text.slice(j + 1, end))
      j = end + 1
    }
    i = j
    stack.at(-1)?.children.push(element)
    if (selfClosing) {
      if (stack.length === 0) return element
    } else stack.push(element)
  }
  if (stack.length > 0) throw syntaxError(`<${stack[0]?.name}> is never closed`, length)
  throw syntaxError('no element', 0)
}
