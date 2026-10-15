import { type Server, createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Browser } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { checkSnapshot } from '../src/core/check.ts'
import type { EngineResults } from '../src/core/types.ts'
import { A11ySnapshotSchema } from '../src/snapshot/schema.ts'
import { collectWeb } from '../src/surfaces/web.ts'
import { launchTestBrowser } from './browser.ts'
import { probeCheckOptions } from './probe-helpers.ts'

// Integration: Microsoft Edge here, Google Chrome on CI. Skipped, with the reason, without a browser.
const launched = await launchTestBrowser('the SVG and XML document tests')
const browser: Browser | undefined = 'browser' in launched ? launched.browser : undefined
if ('skip' in launched) console.warn(launched.skip)

/** ACT test cases that are SVG and XML documents (78fd32, 2779a5, b5c3f8, 6a7281), as published, and an XHTML page. */
const DOCUMENTS: Record<string, { type: string; body: string }> = {
  '/78fd32.svg': { type: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg">\n    <text y="20" style="line-height: 1.2em">ACT rules</text>\n</svg>' },
  '/2779a5.svg': { type: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg">\n  <title>This is an SVG</title>\n</svg>' },
  '/b5c3f8.xml': { type: 'application/xml', body: '<math lang="en">\n    The quick brown fox jumps over the lazy dog.\n</math>' },
  '/6a7281.xml': { type: 'application/xml', body: '<math aria-hidden="false"></math>' },
  '/page.xhtml': { type: 'application/xhtml+xml', body: '<html xmlns="http://www.w3.org/1999/xhtml"><head></head><body><p>Hello</p><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" width="40" height="40"/></body></html>' },
}
let server: Server | undefined
let origin = ''
beforeAll(async () => {
  server = createServer((request, response) => {
    const document = DOCUMENTS[request.url ?? '/']
    if (!document) return void response.writeHead(404).end()
    response.setHeader('Content-Type', document.type)
    response.end(document.body)
  })
  await new Promise<void>((done) => server?.listen(0, '127.0.0.1', done))
  origin = `http://127.0.0.1:${(server?.address() as AddressInfo).port}`
})
afterAll(async () => {
  server?.closeAllConnections()
  await new Promise((done) => server?.close(done))
  await browser?.close()
}, 60_000)

const ruleIds = (engine: EngineResults, outcome: string) => engine.rules.filter((rule) => rule.outcome === outcome).map((rule) => rule.ruleId)

describe.skipIf(!browser)('pages that are not HTML documents', { timeout: 120_000 }, () => {
  const collect = (path: string, probes = true) =>
    collectWeb(browser as Browser, `${origin}${path}`, { runAxe: true, locale: 'en', captureImages: true, presentation: true, ...(probes ? { probes: ['keyboard', 'media', 'color'] as const } : {}) })

  it('checks a standalone SVG document with axe-core and the rules, and says what it left out', async () => {
    const { snapshot, engine } = await collect('/78fd32.svg')
    expect(snapshot.document).toEqual({ kind: 'svg', contentType: 'image/svg+xml' })
    expect(() => A11ySnapshotSchema.parse(snapshot)).not.toThrow()
    // axe-core ran in the SVG document: its rules for HTML pages did not apply, and the style attribute passed.
    expect(engine.engine.name).toBe('axe-core')
    expect(ruleIds(engine, 'pass')).toContain('avoid-inline-spacing')
    expect(ruleIds(engine, 'inapplicable')).toEqual(expect.arrayContaining(['document-title', 'html-has-lang', 'bypass']))
    // The probes drive HTML pages: each is recorded as not run, and its rules say they did not check their criteria.
    expect(snapshot.observations?.probes.map((record) => `${record.kind} ${record.status}`)).toEqual(['keyboard skipped', 'media skipped', 'color skipped'])
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions({ minConfidence: 'medium' }))
    expect(report.findings).toEqual([])
    expect(report.notes?.[0]).toContain('The page is a standalone SVG document (image/svg+xml), not an HTML page')
    const probes = report.coverage.probes ?? []
    expect(probes.length).toBeGreaterThan(0)
    expect(new Set(probes.map((row) => `${row.status}: ${row.note}`))).toEqual(new Set(['not-checked: not run: the page is a standalone SVG document, and the probes drive HTML pages']))
    expect(report.coverage.criteria?.find((c) => c.id === '1.4.12')?.status).toBe('no-failure-found')
  })

  it("reads an SVG document's title as the page's title", async () => {
    const { snapshot, engine } = await collect('/2779a5.svg')
    expect(snapshot.title).toBe('This is an SVG')
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions({ minConfidence: 'medium' }))
    expect(report.findings.map((f) => f.ruleId)).not.toContain('document-title')
  })

  it('does not check an XML document the browser shows as its source tree, and says so', async () => {
    for (const path of ['/b5c3f8.xml', '/6a7281.xml']) {
      const { snapshot, engine } = await collect(path)
      expect(snapshot.document).toEqual({ kind: 'xml', contentType: 'application/xml' })
      expect(() => A11ySnapshotSchema.parse(snapshot)).not.toThrow()
      // Chromium's viewer of the source is an XHTML page with no title and no lang: none of it is read or checked.
      expect(engine).toEqual({ engine: { name: 'none', version: '0' }, rules: [] })
      expect(snapshot.root.children).toEqual([])
      const report = await checkSnapshot(snapshot, engine, probeCheckOptions({ minConfidence: 'medium' }))
      expect(report.findings).toEqual([])
      expect(report.belowThreshold).toEqual([])
      expect(report.needsReview ?? []).toEqual([])
      expect(report.notes?.[0]).toBe(
        'The page is an XML document (application/xml) that the browser shows as its source tree, or in another vocabulary than HTML and SVG: Rampa checks HTML and SVG documents, so nothing on it was checked.',
      )
      expect(report.coverage.notChecked).toHaveLength(55)
      expect(report.coverage.engine).toEqual([])
      expect(report.coverage.rules ?? []).toEqual([])
    }
  })

  it('checks an XHTML document as an HTML page', async () => {
    const { snapshot, engine } = await collect('/page.xhtml', false)
    expect(snapshot.document).toBeUndefined()
    expect(ruleIds(engine, 'violation')).toEqual(expect.arrayContaining(['document-title', 'html-has-lang', 'image-alt']))
  })
})
