/**
 * In the page: whether its body text has the browser's default look (`isDefaultLook` in snapshot/look.ts: 16 px, weight
 * 400, black, the default serif), how many author style sheets apply (linked or in a style element, with at least one
 * rule or unreadable from another origin, and adopted ones), and how many elements it has. The look is the one most of
 * the body's text has, as the collector's `bodyLook` reads it.
 */
export function pageLookInPage(families: readonly string[]): { defaultLook: boolean; authorStyles: number; elements: number } {
  const page = location.href.replace(/#.*$/, '')
  let authorStyles = 0
  for (const sheet of Array.from(document.styleSheets)) {
    const owner = sheet.ownerNode
    if (owner instanceof HTMLLinkElement && owner.href.replace(/#.*$/, '') === page) continue
    let rules = 1
    try {
      rules = sheet.cssRules.length
    } catch {
      rules = 1
    }
    if (rules > 0) authorStyles++
  }
  for (const sheet of document.adoptedStyleSheets ?? []) if (sheet.cssRules.length > 0) authorStyles++
  const elements = document.getElementsByTagName('*').length
  const tally = new Map<string, number>()
  if (document.body) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    let read = 0
    for (let node = walker.nextNode(); node && read < 500; node = walker.nextNode()) {
      const parent = node.parentElement
      const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim()
      if (!parent || text.length < 20 || parent.closest('script, style, noscript, template, h1, h2, h3, h4, h5, h6, a, button, nav, header, footer, label, legend, option')) continue
      read++
      const style = getComputedStyle(parent)
      const family = (style.fontFamily.split(',')[0] ?? '').trim().replace(/^["']|["']$/g, '').toLowerCase()
      const key = `${Math.round(Number.parseFloat(style.fontSize) * 2) / 2}|${style.fontWeight}|${family}|${style.color}|${style.fontStyle === 'italic'}`
      tally.set(key, (tally.get(key) ?? 0) + text.length)
    }
  }
  const top = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
  const [size, weight, family, color, italic] = (top ?? '').split('|')
  const defaultLook = top !== undefined && size === '16' && weight === '400' && families.includes(family ?? '') && color === 'rgb(0, 0, 0)' && italic === 'false'
  return { defaultLook, authorStyles, elements }
}
