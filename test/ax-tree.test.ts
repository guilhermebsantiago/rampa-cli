import { readFileSync } from 'node:fs'
import { type Server, createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Browser } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { memoryCache } from '../src/core/cache.ts'
import { type CheckOptions, checkSnapshot } from '../src/core/check.ts'
import { coverageRows, methodsText } from '../src/report/common.ts'
import { emptyEngine } from '../src/engine/axe.ts'
import { BROWSER_TREE_RULES, customControlRule, liveRegionsRule, tabStateRule, widgetNameRule } from '../src/rules/browser-tree.ts'
import { runRuleChecks } from '../src/rules/index.ts'
import { fieldLabelInNameRule } from '../src/rules/label-in-name.ts'
import { axNotes, browserName, browserNamed, exposedName, exposedRole, liveRegions } from '../src/snapshot/ax.ts'
import { A11ySnapshotSchema, type A11yNode, type A11ySnapshot } from '../src/snapshot/schema.ts'
import { walkTree } from '../src/snapshot/tree.ts'
import { type CdpAxNode, type CdpDomNode, axFactsOf, cssEscape, domElements, nameSourceOf } from '../src/surfaces/ax-tree.ts'
import { collectWeb } from '../src/surfaces/web.ts'
import { launchTestBrowser } from './browser.ts'
import { node } from './helpers.ts'

const options = (extra: Partial<CheckOptions> = {}): CheckOptions => ({
  criteria: [],
  llm: false,
  provider: undefined,
  runs: 1,
  cache: memoryCache(),
  offline: false,
  locale: 'en',
  minConfidence: 'low',
  concurrency: 1,
  ...extra,
})

function snapshotOf(root: A11yNode, extra: Partial<A11ySnapshot> = {}): A11ySnapshot {
  return {
    schemaVersion: 1,
    surface: 'web',
    target: 'test://ax',
    viewport: { width: 1280, height: 800, scale: 1 },
    root,
    axTree: { source: 'cdp', nodes: 1, withoutNode: 0, namesDiffer: 1 },
    collectedAt: '2026-10-09T00:00:00.000Z',
    collector: { name: 'test', version: '0' },
    ...extra,
  }
}

let backend = 1
const el = (localName: string, attributes: Record<string, string> = {}, children: CdpDomNode[] = [], extra: Partial<CdpDomNode> = {}): CdpDomNode => ({
  nodeType: 1,
  backendNodeId: backend++,
  localName,
  attributes: Object.entries(attributes).flat(),
  children,
  ...extra,
})

describe('refs from the DOM tree, as the collector builds them', () => {
  it('escapes ids as CSS.escape does', () => {
    expect(cssEscape('main')).toBe('main')
    expect(cssEscape('1st')).toBe('\\31 st')
    expect(cssEscape('-')).toBe('\\-')
    expect(cssEscape('-2x')).toBe('-\\32 x')
    expect(cssEscape('a b>c|d')).toBe('a\\ b\\>c\\|d')
    expect(cssEscape('café')).toBe('café')
  })

  it('anchors at unique ids, counts same tags, and crosses open shadow roots and frames only', () => {
    const shadowButton = el('button')
    const uaInner = el('div')
    const closedInner = el('button')
    const frameButton = el('button', { id: 'go' })
    const frame = el('iframe', { id: 'pay' }, [], { frameId: 'F1', contentDocument: { nodeType: 9, backendNodeId: backend++, children: [el('html', {}, [el('body', {}, [frameButton])])] } })
    const twinA = el('p', { id: 'twin' })
    const twinB = el('p', { id: 'twin' })
    const host = el('my-card', {}, [], { shadowRoots: [{ nodeType: 11, backendNodeId: backend++, shadowRootType: 'open', children: [el('div', {}, [shadowButton])] }] })
    const input = el('input', {}, [], { shadowRoots: [{ nodeType: 11, backendNodeId: backend++, shadowRootType: 'user-agent', children: [uaInner] }] })
    const closed = el('x-closed', {}, [], { shadowRoots: [{ nodeType: 11, backendNodeId: backend++, shadowRootType: 'closed', children: [closedInner] }] })
    const template = el('template', {}, [], { templateContent: { nodeType: 11, backendNodeId: backend++, children: [el('p', { id: 'twin' })] } })
    const body = el('body', {}, [el('main', { id: 'main' }, [twinA, twinB, host, input, closed, frame, template])])
    const doc: CdpDomNode = { nodeType: 9, backendNodeId: backend++, children: [{ nodeType: 10, backendNodeId: backend++ }, el('html', {}, [el('head'), body])] }
    const { elements, frames } = domElements(doc)
    const refOf = (n: CdpDomNode) => elements.get(n.backendNodeId)?.ref
    expect(refOf(body)).toBe('html > body')
    // An id used twice anchors nothing; the template's copy does not count, since the document cannot select it.
    expect(refOf(twinA)).toBe('#main > p:nth-of-type(1)')
    expect(refOf(twinB)).toBe('#main > p:nth-of-type(2)')
    expect(refOf(shadowButton)).toBe('#main > my-card >>> div > button')
    expect(refOf(frameButton)).toBe('#pay |> #go')
    expect(frames).toEqual([{ ref: '#pay', frameId: 'F1' }])
    // User-agent and closed shadow roots are not in the collector's tree.
    expect(refOf(uaInner)).toBeUndefined()
    expect(refOf(closedInner)).toBeUndefined()
  })
})

describe('the facts kept from a node of the browser tree', () => {
  const refOf = (id: number) => (id === 7 ? '#label' : id === 9 ? '#panel' : undefined)
  it('keeps the name only when it differs, with its source, and the states and relations that say something', () => {
    const ax: CdpAxNode = {
      nodeId: '1',
      role: { type: 'role', value: 'textbox' },
      name: {
        type: 'computedString',
        value: 'document',
        sources: [
          { type: 'attribute', attribute: 'aria-labelledby' },
          { type: 'attribute', attribute: 'aria-label', value: { type: 'computedString', value: 'document' } },
          { type: 'relatedElement', nativeSource: 'labelfor', value: { type: 'computedString', value: 'CPF*' }, superseded: true },
        ],
      },
      properties: [
        { name: 'invalid', value: { type: 'token', value: 'false' } },
        { name: 'focusable', value: { type: 'booleanOrUndefined', value: true } },
        { name: 'required', value: { type: 'boolean', value: false } },
        { name: 'atomic', value: { type: 'boolean', value: true } },
        { name: 'labelledby', value: { type: 'nodeList', relatedNodes: [{ backendDOMNodeId: 7 }, { backendDOMNodeId: 99 }] } },
      ],
    }
    expect(axFactsOf(ax, 'CPF*', refOf)).toEqual({ role: 'textbox', name: 'document', nameFrom: 'aria-label', props: { focusable: true }, relations: { labelledby: ['#label'] } })
    expect(axFactsOf(ax, ' document ', refOf)).toEqual({ role: 'textbox', nameFrom: 'aria-label', props: { focusable: true }, relations: { labelledby: ['#label'] } })
  })

  it('reads where a name came from', () => {
    const source = (s: object) => nameSourceOf({ sources: [{ ...s, value: { value: 'x' } }] as never })
    expect(source({ type: 'relatedElement', attribute: 'aria-labelledby' })).toBe('aria-labelledby')
    expect(source({ type: 'relatedElement', nativeSource: 'labelwrapped' })).toBe('label')
    expect(source({ type: 'relatedElement', nativeSource: 'tablecaption' })).toBe('caption')
    expect(source({ type: 'relatedElement', nativeSource: 'title' })).toBe('title-element')
    expect(source({ type: 'attribute', attribute: 'title' })).toBe('title')
    expect(source({ type: 'contents' })).toBe('contents')
    expect(nameSourceOf({ sources: [{ type: 'contents', value: { value: '  ' } }] })).toBeUndefined()
  })

  it('records an ignored node with why, and live properties only on a live region', () => {
    expect(axFactsOf({ nodeId: '2', ignored: true, ignoredReasons: [{ name: 'ariaHiddenElement' }], role: { value: 'none' } }, 'Close', refOf)).toEqual({
      role: 'none',
      ignored: true,
      ignoredReasons: ['ariaHiddenElement'],
    })
    const status = axFactsOf(
      { nodeId: '3', role: { value: 'status' }, properties: [{ name: 'live', value: { value: 'polite' } }, { name: 'atomic', value: { value: true } }, { name: 'relevant', value: { value: 'additions text' } }] },
      undefined,
      refOf,
    )
    expect(status).toEqual({ role: 'status', props: { live: 'polite', atomic: true, relevant: 'additions text' } })
  })
})

describe('names as the browser exposes them', () => {
  it("prefers the browser's name, keeps the collector's where the browser names nothing of its kind, and drops one it computed as empty", () => {
    const link = node({ ref: 'a', role: 'link', name: '1 Etymology', native: { tag: 'a' }, ax: { role: 'link', name: 'Etymology', nameFrom: 'contents' } })
    const icon = node({ ref: 'b', role: 'link', name: '→', native: { tag: 'a' }, ax: { role: 'link', name: '' } })
    const item = node({ ref: 'li', role: 'listitem', name: 'One', native: { tag: 'li' }, ax: { role: 'listitem', name: '' } })
    const hidden = node({ ref: 'img', role: 'img', name: 'Chart', native: { tag: 'img' }, ax: { role: 'none', ignored: true } })
    const same = node({ ref: 'h1', role: 'heading', name: 'Hello', native: { tag: 'h1' }, ax: { role: 'heading' } })
    expect([link, icon, item, hidden, same].map(exposedName)).toEqual(['Etymology', '', '', 'Chart', 'Hello'])
    expect([link, icon, item, hidden, same].map(browserName)).toEqual(['Etymology', undefined, 'One', 'Chart', 'Hello'])
    expect([link, hidden].map(exposedRole)).toEqual(['link', 'none'])
    const snapshot = snapshotOf(node({ ref: 'html', role: 'document', children: [link, icon] }))
    const view = browserNamed(snapshot)
    expect(view.root.children.map((child) => child.name)).toEqual(['Etymology', undefined])
    expect(browserNamed(snapshot)).toBe(view)
    // The snapshot itself is left as it was.
    expect(snapshot.root.children.map((child) => child.name)).toEqual(['1 Etymology', '→'])
    expect(browserNamed({ ...snapshot, axTree: undefined })).not.toBe(view)
  })

  it('finds live regions once, outermost first', () => {
    const inner = node({ ref: 'b', ax: { role: 'generic', props: { live: 'polite' } } })
    const outer = node({ ref: 'a', ax: { role: 'status', props: { live: 'polite' } }, children: [inner] })
    const timer = node({ ref: 't', ax: { role: 'timer' } })
    const off = node({ ref: 'o', ax: { role: 'generic' } })
    expect(liveRegions(node({ ref: 'html', children: [outer, timer, off] })).map((n) => n.ref)).toEqual(['a', 't'])
  })

  it('says what the read left out', () => {
    expect(axNotes(undefined, 'en')).toEqual([])
    expect(axNotes({ source: 'cdp', nodes: 0, withoutNode: 0, namesDiffer: 0, skipped: 'the page has 50000 elements, over the limit of 40000' }, 'en')[0]).toContain(
      "The browser's accessibility tree was not read (the page has 50000 elements",
    )
    const partial = axNotes({ source: 'cdp', nodes: 10, withoutNode: 2, namesDiffer: 0, framesLeftOut: [{ ref: '#ad', reason: 'over the limit of 10 frames' }], listeners: { read: 50, leftOut: 3 } }, 'pt-BR')
    expect(partial).toHaveLength(2)
    expect(partial[0]).toContain('#ad (over the limit of 10 frames)')
    expect(partial[1]).toContain('3 elemento(s)')
  })
})

describe('the browser tree rules on a snapshot', () => {
  const tab = (ref: string, name: string, selected?: boolean) =>
    node({ ref, role: 'tab', native: { tag: 'div' }, ax: { role: 'tab', ...(name === '' ? { name: '' } : {}), props: selected === undefined ? {} : { selected } }, ...(name ? { name } : {}) })

  it('fails a control with no name, and leaves an element without the browser tree alone', () => {
    const root = node({ ref: 'html', children: [tab('#a', 'One', true), tab('#b', '', false), node({ ref: '#c', role: 'tab', native: { tag: 'div' } })] })
    const run = widgetNameRule.run(snapshotOf(root), emptyEngine(), { locale: 'en', index: new Map() })
    expect(run.hits.map((hit) => hit.ref)).toEqual(['#b'])
    expect(run.applicable).toBe(2)
  })

  it('sees through a name made only of icon-font glyphs: a failure, or review when a description may be read', () => {
    const button = (ref: string, description?: string) =>
      node({ ref, role: 'button', name: 'Search', native: { tag: 'button' }, ax: { role: 'button', name: '', nameFrom: 'contents', ...(description ? { description } : {}) } })
    const named = node({ ref: '#ok', role: 'button', native: { tag: 'button' }, ax: { role: 'button', name: ' Search' } })
    const run = widgetNameRule.run(snapshotOf(node({ ref: 'html', children: [button('#bare'), button('#titled', 'Submit'), named] })), emptyEngine(), { locale: 'en', index: new Map() })
    expect(run.hits.map((hit) => [hit.ref, hit.outcome, hit.evidence])).toEqual([
      ['#bare', 'fail', 'role button · name U+F002'],
      ['#titled', 'review', 'role button · name U+F002 · description "Submit"'],
    ])
    expect(widgetNameRule.message(run.hits[1] as never, 'en')).toContain('only an icon-font glyph (U+F002')
  })

  it('fails a tab list where no tab is selected', () => {
    const list = (ref: string, tabs: A11yNode[]) => node({ ref, role: 'tablist', native: { tag: 'div' }, ax: { role: 'tablist' }, children: tabs })
    const root = node({ ref: 'html', children: [list('#one', [tab('#a', 'A', false), tab('#b', 'B', false)]), list('#two', [tab('#c', 'C', true), tab('#d', 'D', false)]), list('#three', [tab('#e', 'E', false)])] })
    const run = tabStateRule.run(snapshotOf(root), emptyEngine(), { locale: 'en', index: new Map() })
    expect(run.hits.map((hit) => hit.ref)).toEqual(['#one'])
    expect(run.applicable).toBe(2)
  })

  it('lists live regions as an inventory: never a finding, and 4.1.3 stays not checked', async () => {
    const root = node({ ref: 'html', children: [node({ ref: '#saved', role: 'generic', native: { tag: 'div' }, ax: { role: 'status', props: { live: 'polite', atomic: true } } })] })
    const snapshot = snapshotOf(root)
    const stage = runRuleChecks(snapshot, emptyEngine(), 'en', [liveRegionsRule])
    expect(stage.findings).toEqual([])
    expect(stage.review).toEqual([])
    expect(stage.ran).toEqual([expect.objectContaining({ id: 'rampa/live-regions', applicable: 1, inventory: true })])
    const report = await checkSnapshot(snapshot, emptyEngine(), options({ rules: [liveRegionsRule] }))
    const record = report.coverage.criteria?.find((r) => r.id === '4.1.3')
    expect(record?.status).toBe('not-checked')
    expect(report.coverage.notChecked).toContain('4.1.3')
    expect(report.coverage.rules ?? []).not.toContain('4.1.3')
    expect(record ? methodsText(record, report) : '').toBe(
      'rampa/live-regions (inventory, decides nothing: 1 found; experimental; 1 live region(s): #saved (status, polite, atomic, empty). Whether status messages reach them only shows with the page in use)',
    )
    expect(coverageRows(report).find((row) => row.key === 'notChecked')?.criteria).toContain('4.1.3')
  })

  it("reads the field's name and its source from the browser", () => {
    const label = node({ ref: 'label', role: 'generic', native: { tag: 'label', attributes: { for: 'cpf' } }, text: 'CPF*' })
    // aria-labelledby points at nothing, so the browser names the field from its label: no mismatch.
    const fallback = node({ ref: '#cpf', role: 'textbox', name: 'CPF*', native: { tag: 'input', attributes: { id: 'cpf', 'aria-labelledby': 'missing' } }, ax: { role: 'textbox', nameFrom: 'label' } })
    let run = fieldLabelInNameRule.run(snapshotOf(node({ ref: 'html', children: [label, fallback] })), emptyEngine(), { locale: 'en', index: new Map() })
    expect(run.hits).toEqual([])
    const overridden = node({ ref: '#cpf', role: 'textbox', name: 'CPF*', native: { tag: 'input', attributes: { id: 'cpf', 'aria-label': 'document' } }, ax: { role: 'textbox', name: 'document', nameFrom: 'aria-label' } })
    run = fieldLabelInNameRule.run(snapshotOf(node({ ref: 'html', children: [label, overridden] })), emptyEngine(), { locale: 'en', index: new Map() })
    expect(run.hits.map((hit) => [hit.ref, hit.outcome, hit.facts.name, hit.facts.source])).toEqual([['#cpf', 'fail', 'document', 'aria-label']])
  })

  it('is silent on a snapshot recorded without the browser tree', () => {
    const root = node({ ref: 'html', children: [node({ ref: '#t', role: 'tab', native: { tag: 'div' } }), node({ ref: '#s', role: 'status', native: { tag: 'div' } })] })
    const stage = runRuleChecks(snapshotOf(root, { axTree: undefined }), emptyEngine(), 'en', BROWSER_TREE_RULES)
    expect(stage.ran).toEqual([])
    expect(stage.findings).toEqual([])
  })
})

// Integration: Microsoft Edge here, Google Chrome on CI (RAMPA_BROWSER_CHANNEL=chrome). Skipped, with the reason, without a browser.
const launched = await launchTestBrowser('the browser accessibility tree tests')
const browser: Browser | undefined = 'browser' in launched ? launched.browser : undefined
if ('skip' in launched) console.warn(launched.skip)

let server: Server | undefined
let origin = ''
beforeAll(async () => {
  server = createServer((request, response) => {
    const port = (server?.address() as AddressInfo).port
    response.setHeader('Content-Type', 'text/html')
    if ((request.url ?? '/').startsWith('/widget')) return void response.end(readFileSync('test/fixtures/reach/widget.html', 'utf8'))
    response.end(readFileSync('test/fixtures/reach/page.html', 'utf8').replace('{{REMOTE}}', `http://localhost:${port}/widget.html`))
  })
  await new Promise<void>((done) => server?.listen(0, '127.0.0.1', done))
  origin = `http://127.0.0.1:${(server?.address() as AddressInfo).port}`
})
afterAll(async () => {
  server?.closeAllConnections()
  await new Promise((done) => server?.close(done))
  await browser?.close()
}, 60_000)

const fixture = (name: string) => pathToFileURL(resolve('test/fixtures/rules', name)).href
const RULES = [...BROWSER_TREE_RULES, fieldLabelInNameRule]

describe.skipIf(!browser)("the browser's tree in a real browser", { timeout: 60_000 }, () => {
  const collect = async (url: string) => {
    if (!browser) throw new Error('no browser')
    return collectWeb(browser, url, { runAxe: true, locale: 'en', pixelContrast: false })
  }

  it('maps the tree onto the snapshot through open shadow roots and same-origin frames, and records what differs', async () => {
    const { snapshot } = await collect(`${origin}/page.html`)
    expect(A11ySnapshotSchema.safeParse(snapshot).success).toBe(true)
    expect(snapshot.axTree).toMatchObject({ source: 'cdp' })
    expect(snapshot.axTree?.skipped).toBeUndefined()
    const byRef = new Map([...walkTree(snapshot.root)].map((n) => [n.ref, n]))
    expect(byRef.get('html > body > main > h1')?.ax).toEqual({ role: 'heading', nameFrom: 'contents', props: { level: 1 } })
    // The empty button in the open shadow root, and the one in a frame inside a frame.
    expect(byRef.get('html > body > main > shadow-card >>> div:nth-of-type(2) > button')?.ax?.role).toBe('button')
    expect(byRef.get('#outer |> html > body > iframe |> html > body > button')?.ax?.role).toBe('button')
    // Chromium named the image role img before it named it image.
    expect(['image', 'img']).toContain(byRef.get('#local |> html > body > img')?.ax?.role)
    expect((snapshot.axTree?.nodes ?? 0) + (snapshot.axTree?.withoutNode ?? 0)).toBe(byRef.size)
  })

  it('finds every planted failure once, and sends the disclosure to review', async () => {
    const { snapshot, engine } = await collect(fixture('browser-tree-fail.html'))
    const stage = runRuleChecks(snapshot, engine, 'en', RULES)
    expect(stage.findings.map((f) => `${f.ruleId} ${f.ref}`).sort()).toEqual([
      'rampa/button-label-in-name #send',
      'rampa/custom-control #save',
      'rampa/tab-state #plans',
      'rampa/widget-name #icon-item',
    ])
    expect(stage.review.map((item) => `${item.ruleId} ${item.ref}`)).toEqual(['rampa/disclosure-state #question'])
    expect(stage.findings.find((f) => f.ruleId === 'rampa/custom-control')?.message).toContain('takes keyboard focus and listens to click')
    expect(stage.ran.find((r) => r.id === 'rampa/live-regions')).toMatchObject({ applicable: 1, inventory: true })
    expect(stage.ran.find((r) => r.id === 'rampa/live-regions')?.note).toContain('#saved (status, polite, atomic, empty)')
  })

  it('reports nothing on the fixed page', async () => {
    const { snapshot, engine } = await collect(fixture('browser-tree-pass.html'))
    const stage = runRuleChecks(snapshot, engine, 'en', RULES)
    expect(stage.findings.map((f) => `${f.ruleId} ${f.ref}`)).toEqual([])
    expect(stage.review).toEqual([])
  })

  it('reports nothing on the near misses', async () => {
    const { snapshot, engine } = await collect(fixture('browser-tree-controls.html'))
    const stage = runRuleChecks(snapshot, engine, 'en', RULES)
    expect(stage.findings.map((f) => `${f.ruleId} ${f.ref}`)).toEqual([])
    expect(stage.review).toEqual([])
    // The scrollable log and the plain focusable note were asked about, and let be.
    expect(stage.ran.find((r) => r.id === 'rampa/custom-control')?.applicable).toBeGreaterThanOrEqual(2)
    expect(stage.ran.find((r) => r.id === 'rampa/live-regions')).toBeUndefined()
  })

  it('leaves the tree alone when asked to, and says why it skipped a page over the limit', async () => {
    if (!browser) return
    const off = await collectWeb(browser, fixture('browser-tree-fail.html'), { runAxe: false, locale: 'en', axTree: false })
    expect(off.snapshot.axTree).toBeUndefined()
    expect([...walkTree(off.snapshot.root)].some((n) => n.ax !== undefined)).toBe(false)
    const big = await collectWeb(browser, fixture('browser-tree-fail.html'), { runAxe: false, locale: 'en', axTree: { elements: 5 } })
    expect(big.snapshot.axTree?.skipped).toMatch(/over the limit of 5$/)
    const report = await checkSnapshot(big.snapshot, emptyEngine(), options({ rules: RULES }))
    expect(report.notes?.some((note) => note.startsWith("The browser's accessibility tree was not read"))).toBe(true)
  })
})
