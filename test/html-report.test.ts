import { afterAll, describe, expect, it } from 'vitest'
import type { Finding } from '../src/core/types.ts'
import { AXE_TAGS, axeSource } from '../src/engine/axe.ts'
import { renderHtml } from '../src/report/html.ts'
import { launchBrowser } from '../src/surfaces/web.ts'
import { findingOf, recordedReport } from './report-fixtures.ts'

function tokens(css: string): Record<string, string> {
  return Object.fromEntries([...css.matchAll(/--([a-z-]+):(#[0-9a-f]{6})/g)].map((match) => [match[1] as string, match[2] as string]))
}

/** WCAG 2.x relative luminance and contrast ratio. */
function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (bl ?? 0)
  }
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05)
}

describe('HTML report', () => {
  it('is a single file: no script, no stylesheet or font to fetch', async () => {
    const html = renderHtml([(await recordedReport()).report])
    expect(html.startsWith('<!doctype html>\n<html lang="en">')).toBe(true)
    expect(html).not.toMatch(/<script|<link |<img |<iframe|@import|url\(/i)
    expect(html).toContain('<meta name="color-scheme" content="light dark">')
    expect(html).toContain('<title>Accessibility report: examples/store/before.html — Rampa</title>')
  })

  it('has landmarks, one h1, captions and header cells', async () => {
    const html = renderHtml([(await recordedReport()).report, (await recordedReport('examples-store-after')).report])
    expect(html.match(/<h1>/g)).toHaveLength(1)
    for (const landmark of ['<header', '<main id="main"', '<footer']) expect(html).toContain(landmark)
    expect(html).toContain('<a class="skip" href="#main">Skip to the findings</a>')
    expect(html).toContain('<caption>Findings per page</caption>')
    expect(html).toContain('<th scope="col">Page</th>')
    expect(html).toContain('<th scope="row"><a href="#page-1">examples/store/before.html</a></th><td>9</td><td>6</td><td>3</td></tr>')
    expect(html).toContain('<caption>What was checked on examples/store/after.html</caption>')
  })

  it('shows each finding with its place, message, evidence, diff and id', async () => {
    const html = renderHtml([(await recordedReport()).report])
    expect(html).toContain('<h3>WCAG 2.4.4 (A) — Link Purpose (In Context)</h3>')
    expect(html).toContain('<a href="https://www.w3.org/WAI/WCAG21/Understanding/link-purpose-in-context.html">Understanding WCAG 2.4.4 Link Purpose (In Context)</a>')
    expect(html).toContain('<p class="where"><code>examples/store/before.html:31</code> <code class="selector">html &gt; body &gt; main &gt; p:nth-of-type(2) &gt; a</code></p>')
    expect(html).toContain('<p>Evidence: <q>Click here</q></p>')
    expect(html).toContain(
      '<pre class="diff"><code><del>- &lt;a href=&quot;shipping.html&quot;&gt;Click here&lt;/a&gt;</del><ins>+ &lt;a href=&quot;shipping.html&quot;&gt;Shipping information&lt;/a&gt;</ins></code></pre>',
    )
    expect(html).toContain('id <code>1af8a73e209d</code>')
    expect(html).toContain('This report does not declare the page accessible.')
  })

  it('escapes text from the page', async () => {
    const { report } = await recordedReport()
    const hostile: Finding = { ...findingOf(report, '2.4.4'), message: '<img src=x onerror=alert(1)>', evidence: '"</q><script>' }
    const html = renderHtml([{ ...report, findings: [hostile] }])
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(html).toContain('<q>&quot;&lt;/q&gt;&lt;script&gt;</q>')
    // Engine results come from inside the page; only http(s) addresses become links.
    const engine = report.findings[0] as Finding
    const planted = renderHtml([{ ...report, findings: [{ ...engine, helpUrl: 'javascript:alert(1)' }] }])
    expect(planted).not.toContain('javascript:')
    expect(planted).toContain('confidence high · rule image-alt (axe-core) · id <code>')
  })

  it('speaks Portuguese with --locale pt-BR', async () => {
    const html = renderHtml([(await recordedReport('examples-store-before', { locale: 'pt-BR' })).report])
    expect(html).toContain('<html lang="pt-BR">')
    expect(html).toContain('<h1>Relatório de acessibilidade</h1>')
    expect(html).toContain('9 achados confirmados em 1 página verificada contra a WCAG 2.1 A/AA: 6 de nível A, 3 de nível AA.')
    expect(html).toContain('Este relatório não declara a página acessível.')
  })

  it('keeps every text color at 4.5:1 or more on its background, in both themes', async () => {
    const html = renderHtml([(await recordedReport()).report])
    const css = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? ''
    const light = tokens(/:root\{[^}]*\}/.exec(css)?.[0] ?? '')
    const dark = tokens(/prefers-color-scheme:dark\)\{:root\{[^}]*\}/.exec(css)?.[0] ?? '')
    for (const theme of [light, dark]) {
      expect(Object.keys(theme)).toHaveLength(10)
      const pairs: Array<[string, string]> = [
        ['fg', 'bg'],
        ['fg', 'surface'],
        ['muted', 'bg'],
        ['muted', 'surface'],
        ['accent', 'bg'],
        ['accent', 'surface'],
        ['del-fg', 'del-bg'],
        ['ins-fg', 'ins-bg'],
      ]
      for (const [text, background] of pairs) {
        expect(contrast(theme[text] ?? '', theme[background] ?? ''), `${text} on ${background}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })
})

// Integration: Rampa's own engine on its own report. Needs Chrome or Edge, like test/web.test.ts.
const browser = await launchBrowser().catch(() => undefined)
afterAll(async () => browser?.close())

describe.skipIf(!browser)('HTML report in a browser', { timeout: 30_000 }, () => {
  it('passes axe-core in light and dark mode, on a desktop and a phone', async () => {
    if (!browser) return
    const html = renderHtml([(await recordedReport()).report, (await recordedReport('examples-store-after')).report], { verbose: true })
    for (const colorScheme of ['light', 'dark'] as const) {
      // 320 CSS pixels is the width WCAG 1.4.10 Reflow asks content to fit.
      for (const width of [1280, 320]) {
        const context = await browser.newContext({ viewport: { width, height: 800 }, colorScheme })
        const page = await context.newPage()
        await page.setContent(html)
        // Open every <details>, so their content is measured too.
        await page.evaluate(() => {
          for (const details of document.querySelectorAll('details')) details.open = true
        })
        await page.addScriptTag({ content: await axeSource() })
        const result = await page.evaluate(async (tags) => {
          const axe = (window as unknown as { axe: { run(context: Document, options: unknown): Promise<{ violations: Array<{ id: string }> }> } }).axe
          const { violations } = await axe.run(document, { runOnly: { type: 'tag', values: tags } })
          return { violations: violations.map((violation) => violation.id), scrolls: document.documentElement.scrollWidth > window.innerWidth }
        }, [...AXE_TAGS, 'best-practice'])
        await context.close()
        expect(result, `${colorScheme} at ${width}px`).toEqual({ violations: [], scrolls: false })
      }
    }
  })
})
