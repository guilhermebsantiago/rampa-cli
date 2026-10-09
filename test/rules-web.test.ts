import { type Server, createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { summarizeRules } from '../src/cli/commands/eval-rules.ts'
import { memoryCache } from '../src/core/cache.ts'
import { type CheckOptions, checkSnapshot } from '../src/core/check.ts'
import type { Finding } from '../src/core/types.ts'
import { nonTextContent } from '../src/criteria/non-text-content.ts'
import {
  autonymOf,
  defaultTitle,
  placeholderAlt,
  placeholderAltRule,
  placeholderText,
  refreshSeconds,
  viewportBlocksZoom,
  zoomableContent,
} from '../src/rules/content.ts'
import { RULE_CHECKS, runRuleChecks } from '../src/rules/index.ts'
import { nearMatch } from '../src/rules/label-in-name.ts'
import type { A11ySnapshot } from '../src/snapshot/schema.ts'
import { collectWeb, launchBrowser } from '../src/surfaces/web.ts'
import { node } from './helpers.ts'
import { stubModel } from './stub-model.ts'

const options = (extra: Partial<CheckOptions> = {}): CheckOptions => ({
  criteria: [],
  llm: false,
  provider: undefined,
  runs: 1,
  cache: memoryCache(),
  offline: false,
  locale: 'en',
  minConfidence: 'medium',
  concurrency: 1,
  ...extra,
})

const ruleFindings = (findings: Finding[]) => findings.filter((f) => f.source === 'rule').map((f) => `${f.ruleId} ${f.subject}`)

describe('rule helpers', () => {
  it('reads viewport content the way ACT b4f0c3 does', () => {
    // Every example of the rule (https://www.w3.org/WAI/standards-guidelines/act/rules/b4f0c3/).
    expect(viewportBlocksZoom('user-scalable=yes')).toEqual({ applies: true, problems: [] })
    expect(viewportBlocksZoom('maximum-scale=2.0')).toEqual({ applies: true, problems: [] })
    expect(viewportBlocksZoom('maximum-scale=-1')).toEqual({ applies: true, problems: [] })
    expect(viewportBlocksZoom('user-scalable=no').problems).toEqual(['user-scalable=no'])
    expect(viewportBlocksZoom('user-scalable=yes, initial-scale=0.8, maximum-scale=1.5').problems).toEqual(['maximum-scale=1.5'])
    expect(viewportBlocksZoom('maximum-scale=1.0').problems).toEqual(['maximum-scale=1.0'])
    expect(viewportBlocksZoom('maximum-scale=yes').problems).toEqual(['maximum-scale=yes'])
    expect(viewportBlocksZoom('width=device-width')).toEqual({ applies: false, problems: [] })
    expect(viewportBlocksZoom('')).toEqual({ applies: false, problems: [] })
    // Browsers read 0 as no, and accept spaces around = and semicolons between properties.
    expect(viewportBlocksZoom('width=device-width; user-scalable = 0').problems).toEqual(['user-scalable=0'])
    // A value that is not a number reads as 0, as in Chromium; ACT b4f0c3 fails both (axe-core 4.14 passes them).
    expect(viewportBlocksZoom('user-scalable=invalid').problems).toEqual(['user-scalable=invalid'])
    expect(viewportBlocksZoom('maximum-scale=invalid').problems).toEqual(['maximum-scale=invalid'])
    expect(viewportBlocksZoom('maximum-scale=device-width')).toEqual({ applies: true, problems: [] })
  })

  it('patches the viewport by dropping only what blocks zoom', () => {
    expect(zoomableContent('width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no')).toBe('width=device-width, initial-scale=1')
    expect(zoomableContent('width=device-width, maximum-scale=5')).toBe('width=device-width, maximum-scale=5')
  })

  it('reads a Refresh value by the HTML declarative refresh steps', () => {
    expect(refreshSeconds('30')).toBe(30)
    expect(refreshSeconds('30; url=https://w3.org')).toBe(30)
    expect(refreshSeconds("0; URL='https://github.com'")).toBe(0)
    expect(refreshSeconds('5.9, https://w3.org')).toBe(5)
    expect(refreshSeconds('0: https://w3.org')).toBeUndefined()
    expect(refreshSeconds('+5; https://w3.org')).toBeUndefined()
    expect(refreshSeconds('-00.12 foo')).toBeUndefined()
    expect(refreshSeconds('; 30')).toBeUndefined()
    expect(refreshSeconds('foo; url=x')).toBeUndefined()
    expect(refreshSeconds('')).toBeUndefined()
  })

  it('names placeholder alternatives and leaves short real ones to judgment', () => {
    expect(placeholderAlt('IMG_2034.jpg')).toBe('file-name')
    expect(placeholderAlt('/assets/hero.webp')).toBe('file-name')
    expect(placeholderAlt('DSC01234')).toBe('camera-name')
    expect(placeholderAlt('PXL_20230812_142233')).toBe('camera-name')
    expect(placeholderAlt('Screenshot 2023-08-12 at 14.22.33')).toBe('camera-name')
    expect(placeholderAlt('image')).toBe('placeholder-word')
    expect(placeholderAlt('Foto 3')).toBe('placeholder-word')
    expect(placeholderAlt('hero-banner', 'img/hero-banner.png?v=2')).toBe('same-as-file')
    for (const alt of ['logo', 'Canon EOS R5', 'RX100', 'team', 'Photo of the team at the 2023 retreat', 'banner', 'icon']) {
      expect(placeholderAlt(alt, 'team.jpg'), alt).toBeUndefined()
    }
  })

  it('knows framework and editor default titles, and only those', () => {
    for (const title of ['React App', 'Vite + React + TS', '  vite +  vue ', 'Document', 'Untitled Document', 'Insert title here', 'Documento sem título']) {
      expect(defaultTitle(title), title).toBe(true)
    }
    for (const title of ['Document management · Acme', 'React App Store', 'Vite', 'Astro', 'Next.js', 'Home']) expect(defaultTitle(title), title).toBe(false)
  })

  it('knows template placeholder headings and labels, and leaves samples and real words alone', () => {
    expect(placeholderText('Add Your Heading Text Here', 'heading')).toBe(true)
    expect(placeholderText('Lorem ipsum dolor sit amet', 'heading')).toBe(true)
    expect(placeholderText('Field 1', 'label')).toBe(true)
    expect(placeholderText('Campo 2', 'label')).toBe(true)
    expect(placeholderText('Heading 1', 'heading')).toBe(false)
    expect(placeholderText('Label', 'label')).toBe(false)
    expect(placeholderText('Field', 'label')).toBe(false)
    expect(placeholderText('Address line 2', 'label')).toBe(false)
  })

  it('tells a hyphen or a shortened word apart from a different label (2.5.3)', () => {
    expect(nearMatch('E-mail', 'Email address')).toBe('hyphenation')
    expect(nearMatch('Reorder', 're-order items')).toBe('hyphenation')
    expect(nearMatch('Info', 'Information about shipping')).toBe('abbreviation')
    expect(nearMatch('Previous', 'Next page')).toBeUndefined()
    expect(nearMatch('Qty', 'Quantity')).toBeUndefined()
    expect(nearMatch('Go', 'Go to cart')).toBe('hyphenation')
    expect(nearMatch('A', 'Add')).toBeUndefined()
  })

  it("finds a language's own name in CLDR, region variants included", () => {
    expect(autonymOf('Português')).toBe('pt')
    expect(autonymOf('English')).toBe('en')
    expect(autonymOf('Deutsch')).toBe('de')
    expect(autonymOf('日本語')).toBe('ja')
    expect(autonymOf('English (United States)')).toBe('en-US')
    expect(autonymOf('Read in English')).toBeUndefined()
    expect(autonymOf('Brasil')).toBeUndefined()
  })

  it('every rule has an id in the rampa namespace, a version, criteria, help in both languages and a maturity', () => {
    const ids = RULE_CHECKS.map((rule) => rule.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const rule of RULE_CHECKS) {
      expect(rule.id).toMatch(/^rampa\/[a-z0-9-]+$/)
      expect(rule.criteria.length).toBeGreaterThan(0)
      expect(rule.help.en && rule.help['pt-BR']).toBeTruthy()
      expect(['stable', 'experimental']).toContain(rule.maturity)
    }
  })
})

/** A page with one image whose alternative is a camera file name, ready for the 1.1.1 judgment. */
function cameraAltSnapshot(): A11ySnapshot {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
  return {
    schemaVersion: 1,
    surface: 'web',
    target: 'test://shop',
    title: 'Mugs · Shop',
    locale: 'en',
    viewport: { width: 1280, height: 800, scale: 1 },
    collectedAt: '2026-10-09T00:00:00.000Z',
    collector: { name: 'test', version: '0' },
    root: node({
      ref: 'html',
      role: 'document',
      lang: 'en',
      native: { tag: 'html' },
      children: [
        node({
          ref: 'html > body',
          native: { tag: 'body' },
          children: [
            node({
              ref: 'img.mug',
              role: 'img',
              name: 'IMG_2034.jpg',
              image: png,
              bounds: { x: 0, y: 0, width: 40, height: 40 },
              native: { tag: 'img', attributes: { alt: 'IMG_2034.jpg', src: 'IMG_2034.jpg', class: 'mug' }, html: '<img class="mug" src="IMG_2034.jpg" alt="IMG_2034.jpg">' },
            }),
          ],
        }),
      ],
    }),
  }
}

const noEngine = { engine: { name: 'axe-core', version: 'test' }, rules: [] }

describe('rules next to judgment', () => {
  it('reports an experimental rule below the threshold when no model runs', async () => {
    const report = await checkSnapshot(cameraAltSnapshot(), noEngine, options({ criteria: [nonTextContent] }))
    expect(report.findings).toEqual([])
    expect(ruleFindings(report.belowThreshold)).toEqual(['rampa/placeholder-alt IMG_2034.jpg'])
    const finding = report.belowThreshold[0]
    expect(finding?.confidence).toBe('low')
    expect(finding?.evidence).toBe('alt="IMG_2034.jpg"')
    expect(finding?.message).toContain('is a file name')
    expect(report.coverage.rules).toEqual(['1.1.1', '2.4.2'])
    // In the per-criterion coverage, the rule is a method of 1.1.1: its failure is below the threshold, so the criterion needs review.
    const record = report.coverage.criteria?.find((r) => r.id === '1.1.1')
    expect(record?.status).toBe('needs-review')
    expect(record?.methods).toContainEqual({ kind: 'rule', id: 'rampa/placeholder-alt', ran: true, applicable: 1, failures: 1, review: 0, maturity: 'experimental' })
    expect(report.coverage.notChecked).not.toContain('2.4.2')
  })

  it('keeps one finding when the model fails the element an experimental rule failed: the judgment', async () => {
    const model = stubModel()
    const report = await checkSnapshot(cameraAltSnapshot(), noEngine, options({ criteria: [nonTextContent], llm: true, provider: model }))
    expect(model.asked.map((a) => a.subject)).toEqual(['IMG_2034.jpg'])
    expect([...report.findings, ...report.belowThreshold].map((f) => `${f.source} ${f.criterion} ${f.ref}`)).toEqual(['judgment 1.1.1 img.mug'])
  })

  it('does not ask the model about an element a stable rule decided', async () => {
    const model = stubModel()
    const stable = { ...placeholderAltRule, maturity: 'stable' as const }
    const report = await checkSnapshot(cameraAltSnapshot(), noEngine, options({ criteria: [nonTextContent], llm: true, provider: model, rules: [stable] }))
    expect(model.asked).toEqual([])
    expect(report.findings.map((f) => `${f.source} ${f.ruleId} ${f.confidence}`)).toEqual(['rule rampa/placeholder-alt high'])
    expect(report.criteria.find((c) => c.criterion === '1.1.1')?.candidates).toBe(0)
  })

  it('leaves to axe-core an element it already failed for the same criterion', () => {
    const snapshot = cameraAltSnapshot()
    const engine = {
      ...noEngine,
      rules: [{ ruleId: 'image-alt', outcome: 'violation' as const, criteria: ['1.1.1'], help: 'Images must have alternate text', nodes: [{ ref: 'img.mug', target: '["img.mug"]', html: '<img>' }] }],
    }
    expect(runRuleChecks(snapshot, engine, 'en').findings).toEqual([])
  })

  it('can be turned off', async () => {
    const report = await checkSnapshot(cameraAltSnapshot(), noEngine, options({ rules: false }))
    expect(report.belowThreshold).toEqual([])
    expect(report.coverage.rules).toBeUndefined()
  })
})

// Integration: needs Chrome or Edge (or Playwright's Chromium). Skipped when none is installed.
const browser = await launchBrowser().catch(() => undefined)
const fixture = (name: string) => pathToFileURL(resolve('test/fixtures/rules', name)).href

let server: Server | undefined
let origin = ''
beforeAll(async () => {
  server = createServer((request, response) => {
    if (request.url === '/timed') response.setHeader('Refresh', '30; url=/landed')
    if (request.url === '/immediate') response.setHeader('Refresh', '0; url=/landed')
    if (request.url === '/meta-immediate') {
      response.setHeader('Content-Type', 'text/html')
      response.end('<!doctype html><html lang="en"><head><meta http-equiv="refresh" content="0; url=/landed"><title>Moving</title></head><body><p>Moving</p></body></html>')
      return
    }
    response.setHeader('Content-Type', 'text/html')
    response.end(`<!doctype html><html lang="en"><head><title>Page ${request.url}</title></head><body><main><h1>Page ${request.url}</h1></main></body></html>`)
  })
  await new Promise<void>((done) => server?.listen(0, '127.0.0.1', done))
  origin = `http://127.0.0.1:${(server?.address() as AddressInfo).port}`
})
// A loaded machine can take a while to close a browser; the default 10 s hook timeout is not enough there.
afterAll(async () => {
  server?.closeAllConnections()
  await new Promise((done) => server?.close(done))
  await browser?.close()
}, 60_000)

describe.skipIf(!browser)('rules on real pages', { timeout: 30_000 }, () => {
  const check = async (url: string) => {
    if (!browser) throw new Error('no browser')
    const { snapshot, engine } = await collectWeb(browser, url, { runAxe: true, locale: 'en' })
    return { snapshot, engine, report: await checkSnapshot(snapshot, engine, options({ minConfidence: 'low' })) }
  }

  it('finds every planted failure, each once, with evidence', async () => {
    const { report } = await check(fixture('content-fail.html'))
    expect(ruleFindings(report.findings).sort()).toEqual([
      'rampa/default-title Vite + React + TS',
      'rampa/language-switcher-lang Deutsch',
      'rampa/language-switcher-lang Español',
      'rampa/language-switcher-lang Português',
      'rampa/meta-viewport width=device-width, initial-scale=1, maximum-scale=no',
      'rampa/no-visible-label Coupon code',
      'rampa/placeholder-alt IMG_2034.jpg',
      'rampa/placeholder-alt hero-banner',
      'rampa/placeholder-alt image',
      'rampa/placeholder-text Add Your Heading Text Here',
      'rampa/placeholder-text Field 1',
      'rampa/placeholder-text Lorem ipsum dolor sit amet',
    ])
    for (const finding of report.findings.filter((f) => f.source === 'rule')) expect(finding.evidence, finding.ruleId).toBeTruthy()
    // axe-core passes maximum-scale=no, which browsers read as 0; the rule is what reports it.
    expect(report.findings.some((f) => f.ruleId === 'meta-viewport')).toBe(false)
    const viewport = report.findings.find((f) => f.ruleId === 'rampa/meta-viewport')
    expect(viewport?.patch?.after).toBe('<meta name="viewport" content="width=device-width, initial-scale=1">')
    const switcher = report.findings.find((f) => f.ruleId === 'rampa/language-switcher-lang' && f.subject === 'Português')
    expect(switcher?.patch?.after).toBe('<a href="/pt/" hreflang="pt" lang="pt">')
    expect(report.coverage.rules).toEqual(['1.1.1', '1.4.4', '2.4.2', '2.4.6', '3.1.2', '3.3.2'])
    const coupon = report.findings.find((f) => f.ruleId === 'rampa/no-visible-label')
    expect(coupon?.patch?.after).toBe('<label for="coupon">Coupon code</label> <input id="coupon" type="text" aria-label="Coupon code">')
  })

  it('reports nothing on the fixed page', async () => {
    const { report } = await check(fixture('content-pass.html'))
    expect(ruleFindings(report.findings)).toEqual([])
  })

  it('reports nothing on the near misses', async () => {
    const { report } = await check(fixture('content-controls.html'))
    expect(ruleFindings(report.findings)).toEqual([])
  })

  it('leaves user-scalable=no to axe-core, which already fails it', async () => {
    const page = 'data:text/html,<html lang="en"><head><meta name="viewport" content="width=device-width, user-scalable=no"><title>Zoom</title></head><body><p>Hi</p></body></html>'
    const { report } = await check(page)
    expect(report.findings.filter((f) => f.criterion === '1.4.4').map((f) => f.ruleId)).toEqual(['meta-viewport'])
  })

  it('reads a timed Refresh header, which axe-core cannot see', async () => {
    const { report, snapshot } = await check(`${origin}/timed`)
    expect(snapshot.root.native.httpRefresh).toBe('30; url=/landed')
    const finding = report.findings.find((f) => f.ruleId === 'rampa/refresh-header')
    expect(finding?.criterion).toBe('2.2.1')
    expect(finding?.evidence).toBe('Refresh: 30; url=/landed')
    expect(finding?.message).toContain('redirects by itself after 30 s')
  })

  it('records an immediate redirect instead of failing the collection', async () => {
    for (const path of ['/meta-immediate', '/immediate']) {
      const { report, snapshot } = await check(`${origin}${path}`)
      expect(report.findings.some((f) => f.criterion === '2.2.1'), path).toBe(false)
      expect(snapshot.root.native.redirectedTo, path).toBe(`${origin}/landed`)
      expect(snapshot.title, path).toBe('Page /landed')
    }
  })

  it('moves label-in-name failures that differ only by a hyphen or a shortened word to review', async () => {
    const buttons = [
      '<button aria-label="Email address">E-mail</button>',
      '<button aria-label="Information about shipping">Info</button>',
      '<button aria-label="Next page">Previous</button>',
      '<button aria-label="Quantity">Qty</button>',
      // ACT 2ee8b8 Failed Example 16: text hidden from assistive technology is still on screen.
      '<a aria-label="Download specification" href="#">Download <span aria-hidden="true">gizmo</span> specification</a>',
    ].join('')
    const { report } = await check(`data:text/html,<html lang="en"><head><title>Cart</title></head><body><main>${encodeURIComponent(buttons)}</main></body></html>`)
    const byText = report.findings
      .filter((f) => f.ruleId === 'label-content-name-mismatch')
      .map((f) => `${/>([^<]*)</.exec(f.html ?? '')?.[1]?.trim()} ${f.confidence}`)
      .sort()
    expect(byText).toEqual(['Download high', 'E-mail low', 'Info low', 'Previous high', 'Qty high'])
  })
})

describe('rampa eval --rules', () => {
  it('scores axe-core, the rule alone and both, and names the pages each one gets wrong', () => {
    const record = (testcaseId: string, expected: 'failed' | 'passed' | 'inapplicable', axe: boolean, alone: boolean) => ({
      schemaVersion: 1 as const,
      rule: 'rampa/meta-viewport',
      criterion: '1.4.4',
      actRule: 'b4f0c3',
      testcaseId,
      title: testcaseId,
      url: `https://act.test/${testcaseId}.html`,
      expected,
      axe: axe ? ('failed' as const) : ('passed' as const),
      rule_alone: alone ? ('failed' as const) : ('passed' as const),
      rampa: axe || alone ? ('failed' as const) : ('passed' as const),
      findings: [],
    })
    const summary = summarizeRules(
      [record('f1', 'failed', true, true), record('f2', 'failed', false, true), record('f3', 'failed', false, false), record('p1', 'passed', false, false), record('i1', 'inapplicable', false, false)],
      'abc',
    )
    const set = summary.sets[0]
    expect(set?.n).toBe(5)
    expect(set?.axe.recall).toBeCloseTo(1 / 3)
    expect(set?.ruleAlone.recall).toBeCloseTo(2 / 3)
    expect(set?.rampa.precision).toBe(1)
    expect(set?.misses).toEqual(['f3'])
    expect(set?.falseAlarms).toEqual([])
  })
})
