import { describe, expect, it } from 'vitest'
import { decodeEntities, parseXml } from '../src/surfaces/xml.ts'

describe('XML reader', () => {
  it('reads elements and attributes in either quote style, with entities', () => {
    const root = parseXml(`<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0"><node text='Tom &amp; Jerry' content-desc="a &gt; b &quot;c&quot;" /><node text="Line&#10;two &#x263A;"></node></hierarchy>`)
    expect(root.name).toBe('hierarchy')
    expect(root.attributes.rotation).toBe('0')
    expect(root.children.map((child) => child.attributes.text)).toEqual(['Tom & Jerry', 'Line\ntwo ☺'])
    expect(root.children[0]?.attributes['content-desc']).toBe('a > b "c"')
  })

  it('ignores what uiautomator prints after the XML, and comments and doctypes before it', () => {
    const root = parseXml('<!DOCTYPE x><!-- dump --><hierarchy><node class="a"/></hierarchy>UI hierchary dumped to: /dev/tty\n')
    expect(root.children).toHaveLength(1)
  })

  it('keeps raw > inside attribute values and nests deeply without recursion', () => {
    const depth = 5000
    const xml = `<a v="x > y">${'<b>'.repeat(depth)}${'</b>'.repeat(depth)}</a>`
    const root = parseXml(xml)
    expect(root.attributes.v).toBe('x > y')
    let level = 0
    let current = root
    while (current.children[0]) {
      current = current.children[0]
      level++
    }
    expect(level).toBe(depth)
  })

  it('drops control characters a dump escapes, but keeps tabs and line breaks', () => {
    expect(decodeEntities('a&#0;b&#9;c&#13;')).toBe('ab\tc\r')
    expect(decodeEntities('&unknown; &#xZZ;')).toBe('&unknown; &#xZZ;')
  })

  it('rejects broken XML with a clear message', () => {
    expect(() => parseXml('<a><b></a>')).toThrow(/unexpected <\/a>/)
    expect(() => parseXml('<a x=1/>')).toThrow(/unquoted value/)
    expect(() => parseXml('<a>')).toThrow(/never closed/)
    expect(() => parseXml('no xml here')).toThrow(/no element/)
  })
})
