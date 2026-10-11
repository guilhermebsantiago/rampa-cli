import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { memoryCache } from '../src/core/cache.ts'
import { type CheckOptions, checkSnapshot } from '../src/core/check.ts'
import { meaningfulSequence, meaningfulSequenceCandidates } from '../src/criteria/meaningful-sequence.ts'
import type { ModelProvider } from '../src/providers/types.ts'
import { runRuleChecks } from '../src/rules/index.ts'
import { cssReadingOrderRule, readingOrders, splitCells, whitespaceLayout, whitespaceTableRule } from '../src/rules/reading-order.ts'
import type { A11yNode, A11ySnapshot } from '../src/snapshot/schema.ts'
import { collectWeb, launchBrowser } from '../src/surfaces/web.ts'
import { node } from './helpers.ts'

const noEngine = { engine: { name: 'axe-core', version: 'test' }, rules: [] }

// F34, Example 1 and F33, Example 1, as W3C gives them.
const F34 = `Menu
         Breakfast        Lunch           Dinner

Monday   2 fried eggs    tomato soup     garden salad
         bacon           hamburger       Fried Chicken
         toast           onion rings     green beans
                         Oatmeal cookie  mashed potatoes

Tuesday   Pancakes       vegetable soup  Caesar salad
          sausage        hot dogs        Spaghetti with meatballs
          orange juice   potato salad    Italian bread
                         brownie         ice cream
`
const F33 = `Web Content Accessibility Guidelines      including blindness and low vision,
2.0 (WCAG 2.0) covers a wide range of     deafness and hearing loss, learning
issues and recommendations for making     difficulties, cognitive limitations, limited
Web content more accessible. This         movement, speech difficulties, and
document contains principles,             others. Following these guidelines will
guidelines, success criteria, benefits,   also make your web content more
and examples that define and explain      accessible to the vast majority of users,
the requirements for making Web-based     including older users. It will also enable
information and applications accessible.  people to access web content using
"Accessible" means usable to a wide       many different devices - including a
range of people with disabilities,        wide variety of assistive technologies.
`

describe('text laid out with white space (1.3.2, F33 and F34)', () => {
  it('splits a line at two spaces or a tab, keeping single spaces in a cell', () => {
    expect(splitCells('Monday   2 fried eggs    tomato soup').cells.map((c) => [c.start, c.text])).toEqual([
      [0, 'Monday'],
      [9, '2 fried eggs'],
      [25, 'tomato soup'],
    ])
    // A tab separates even where it expands to a single column.
    const tabbed = splitCells('Plan\tStorage\tPrice', 8)
    expect(tabbed.cells.map((c) => c.text)).toEqual(['Plan', 'Storage', 'Price'])
    expect(tabbed.tabs).toBe(true)
    expect(splitCells('abcdefg\tx', 8).cells.map((c) => c.text)).toEqual(['abcdefg', 'x'])
  })

  it('reads F34 as a table and F33 as two columns of running text', () => {
    const table = whitespaceLayout(F34)
    expect(table).toMatchObject({ kind: 'table' })
    expect(table?.columns).toBeGreaterThanOrEqual(3)
    expect(table?.rows).toBe(9)
    expect(table?.read).toBe('Monday 2 fried eggs tomato soup garden salad')
    const columns = whitespaceLayout(F33)
    expect(columns).toMatchObject({ kind: 'columns', columns: 2, rows: 11 })
    expect(columns?.read).toContain('Web Content Accessibility Guidelines including blindness')
  })

  it('finds a table between paragraphs of a plain-text document, block by block', () => {
    const memo = [
      '   This memo describes the status codes a server returns, and how a',
      '   client should read them when the request could not be served.',
      '',
      '   Code   Reason                Meaning',
      '   200    OK                    The request succeeded',
      '   404    Not Found             Nothing matches the address',
      '   503    Service Unavailable   The server is overloaded',
      '',
      '   A client that gets a code it does not know reads it as the first',
      '   code of its class, so 299 is read as 200 and 599 as 500.',
    ].join('\n')
    expect(whitespaceLayout(memo)).toMatchObject({ kind: 'table', columns: 3, rows: 4, read: '404 Not Found Nothing matches the address' })
  })

  it('leaves code, terminal output, drawn tables, one column and labels with values alone', () => {
    expect(whitespaceLayout('const width    = 320\nconst height   = 256\nconst scale    = 4\n')).toBeUndefined()
    expect(whitespaceLayout('$ ls -l\n-rw-r--r--  1 ana  staff   1204  index.html\n-rw-r--r--  1 ana  staff    880  style.css\n-rw-r--r--  1 ana  staff   4410  app.js\n')).toBeUndefined()
    expect(whitespaceLayout('| Plan  | Storage |\n|-------|---------|\n| Basic | 10 GB   |\n| Pro   | 100 GB  |\n| Max   | 1 TB    |\n')).toBeUndefined()
    expect(whitespaceLayout('The rain falls soft\n    on the tin roof\n        and the night listens\n    to every drop\n')).toBeUndefined()
    expect(whitespaceLayout('Name:       Ana Souza\nEmail:      ana@example.com\nPhone:      +55 85 5555 0101\n')).toMatchObject({ kind: 'pairs', columns: 2 })
    // Gaps that do not line up are no columns.
    expect(whitespaceLayout('one two  three\nfour  five six seven\neight nine ten  eleven\n')).toBeUndefined()
  })

  it('fails a pre that holds a table or two columns, and leaves code and named art alone', () => {
    const snapshot = page([
      pre('pre:nth-of-type(1)', F34),
      pre('pre:nth-of-type(2)', F33),
      node({ ref: 'pre:nth-of-type(3)', native: { tag: 'pre', preformatted: { text: F34, mono: true, tabSize: 8 } }, children: [node({ ref: 'pre:nth-of-type(3) > code', native: { tag: 'code' } })] }),
      node({ ref: 'pre:nth-of-type(4)', role: 'img', name: 'A menu', native: { tag: 'pre', attributes: { role: 'img', 'aria-label': 'A menu' }, preformatted: { text: F34, mono: true, tabSize: 8 } } }),
      pre('pre:nth-of-type(5)', 'Name:       Ana Souza\nEmail:      ana@example.com\nPhone:      +55 85 5555 0101\n'),
    ])
    const stage = runRuleChecks(snapshot, noEngine, 'en', [whitespaceTableRule])
    expect(stage.findings.map((f) => [f.ref, f.criterion])).toEqual([
      ['pre:nth-of-type(1)', '1.3.2'],
      ['pre:nth-of-type(2)', '1.3.2'],
    ])
    expect(stage.findings[0]?.message).toContain('F34')
    expect(stage.findings[0]?.evidence).toContain('read line by line: “Monday 2 fried eggs tomato soup garden salad”')
    expect(stage.findings[1]?.message).toContain('F33')
    // The labels with their values count as applicable, and are left to the judgment.
    expect(stage.ran[0]).toMatchObject({ applicable: 3, failures: 2 })
  })
})

describe('boxes CSS reorders (1.3.2, F1)', () => {
  it('fails numbered steps the markup holds out of order', () => {
    const snapshot = page([
      container('.steps', ['order'], [
        box('.steps > div:nth-of-type(1)', 'Step 3: Pay for your room', { x: 400, y: 0, width: 180, height: 40 }, { order: 3 }),
        box('.steps > div:nth-of-type(2)', 'Step 1: Choose your dates', { x: 0, y: 0, width: 180, height: 40 }, { order: 1 }),
        box('.steps > div:nth-of-type(3)', 'Step 2: Pick a room', { x: 200, y: 0, width: 180, height: 40 }, { order: 2 }),
      ]),
    ])
    const [order] = readingOrders(snapshot)
    expect(order?.broken).toMatchObject({ kind: 'sequence', facts: { seen: '1 · 2 · 3', read: '3 · 1 · 2' } })
    const stage = runRuleChecks(snapshot, noEngine, 'en', [cssReadingOrderRule])
    expect(stage.findings).toHaveLength(1)
    expect(stage.findings[0]?.message).toContain('(1 · 2 · 3)')
    expect(stage.findings[0]?.message).toContain('3 · 1 · 2')
    expect(stage.findings[0]?.message).toContain('CSS order')
    expect(stage.findings[0]?.confidence).toBe('low')
  })

  it('fails F1: items shown under one heading and read after another', () => {
    const font = (size: number) => ({ font: [size, 400], position: 'absolute' })
    const snapshot = page([
      container('div.box', ['absolute'], [
        box('span.menu1', 'Products', { x: 0, y: 48, width: 80, height: 22 }, font(19.2)),
        box('span.menu2', 'Locations', { x: 160, y: 48, width: 86, height: 22 }, font(19.2)),
        box('span.item1', 'Telephones', { x: 0, y: 112, width: 80, height: 18 }, font(16)),
        box('span.item2', 'Computers', { x: 0, y: 128, width: 76, height: 18 }, font(16)),
        box('span.item3', 'Portable MP3 Players', { x: 0, y: 144, width: 150, height: 18 }, font(16)),
        box('span.item5', 'Wisconsin', { x: 224, y: 128, width: 70, height: 18 }, font(16)),
        box('span.item4', 'Idaho', { x: 224, y: 112, width: 40, height: 18 }, font(16)),
      ]),
    ])
    const [order] = readingOrders(snapshot)
    expect(order?.broken).toMatchObject({ kind: 'heading', facts: { item: 'Telephones', owner: 'Products', readUnder: 'Locations' } })
    const stage = runRuleChecks(snapshot, noEngine, 'pt-BR', [cssReadingOrderRule])
    expect(stage.findings[0]?.message).toContain('“Telephones” aparece sob “Products”, mas a marcação o põe depois de “Locations”')
  })

  it('fails a heading shown above its text and read after it, and a sentence read the wrong way round', () => {
    const snapshot = page([
      container('article', ['column-reverse'], [
        box('article > p', 'Every room has a desk, fast wifi and a kettle.', { x: 0, y: 30, width: 400, height: 20 }),
        node({ ref: 'article > h3', role: 'heading', text: 'Rooms', bounds: { x: 0, y: 0, width: 400, height: 24 }, native: { tag: 'h3' } }),
      ]),
      container('p.sentence', ['row-reverse'], [
        box('p.sentence > span:nth-of-type(1)', 'the breakfast is on us.', { x: 170, y: 100, width: 160, height: 20 }),
        box('p.sentence > span:nth-of-type(2)', 'Book three nights and', { x: 0, y: 100, width: 165, height: 20 }),
      ]),
    ])
    const kinds = readingOrders(snapshot).map((order) => order.broken?.kind)
    expect(kinds).toEqual(['heading', 'sentence'])
    const stage = runRuleChecks(snapshot, noEngine, 'en', [cssReadingOrderRule])
    expect(stage.findings[0]?.message).toContain('the markup puts it before “Rooms”')
    expect(stage.findings[1]?.message).toContain('On screen “Book three nights and” goes on with “the breakfast is on us.”')
    expect(stage.findings[1]?.confidence).toBe('low')
  })

  it('nominates without failing what verifies nothing, and skips stacked boxes, the same order and right-to-left text', () => {
    const snapshot = page([
      // A sidebar moved before the article.
      container('section.layout', ['order'], [
        box('section.layout > main', 'Our rooms Every room has a desk, fast wifi and a kettle.', { x: 220, y: 0, width: 500, height: 80 }),
        box('section.layout > aside', 'Related: parking, breakfast and late check-out.', { x: 0, y: 0, width: 200, height: 80 }, { order: -1 }),
      ]),
      // Links of a reversed menu are read for their own sake, never as halves of a sentence.
      container('nav', ['row-reverse'], [
        node({ ref: 'nav > a:nth-of-type(1)', role: 'link', text: 'contact the team', bounds: { x: 300, y: 0, width: 120, height: 20 }, native: { tag: 'a' } }),
        node({ ref: 'nav > a:nth-of-type(2)', role: 'link', text: 'about our hotel', bounds: { x: 150, y: 0, width: 120, height: 20 }, native: { tag: 'a' } }),
        node({ ref: 'nav > a:nth-of-type(3)', role: 'link', text: 'home page here', bounds: { x: 0, y: 0, width: 120, height: 20 }, native: { tag: 'a' } }),
      ]),
      // Steps in order in the markup, shown right to left: read right, so not even a candidate.
      container('div.reversed', ['row-reverse'], [
        box('div.reversed > div:nth-of-type(1)', 'Step 1: Choose your dates', { x: 400, y: 0, width: 180, height: 40 }),
        box('div.reversed > div:nth-of-type(2)', 'Step 2: Pick a room', { x: 200, y: 0, width: 180, height: 40 }),
        box('div.reversed > div:nth-of-type(3)', 'Step 3: Pay for your room', { x: 0, y: 0, width: 180, height: 40 }),
      ]),
      // Slides in one place.
      container('div.slides', ['absolute'], [
        box('div.slides > p:nth-of-type(1)', 'Summer offers for families', { x: 0, y: 0, width: 300, height: 20 }, { position: 'absolute' }),
        box('div.slides > p:nth-of-type(2)', 'winter offers for couples', { x: 0, y: 0, width: 290, height: 20 }, { position: 'absolute' }),
      ]),
      // Placed where the markup has them anyway.
      container('div.grid', ['grid-placement'], [
        box('div.grid > div:nth-of-type(1)', 'First card', { x: 0, y: 0, width: 300, height: 40 }),
        box('div.grid > div:nth-of-type(2)', 'Second card', { x: 320, y: 0, width: 300, height: 40 }),
        box('div.grid > div:nth-of-type(3)', 'Third card', { x: 0, y: 60, width: 300, height: 40 }),
      ]),
      node({
        ref: 'div[dir]',
        native: { tag: 'div', attributes: { dir: 'rtl' } },
        children: [
          container('div[dir] > div', ['order'], [
            box('div[dir] > div > p:nth-of-type(1)', 'Step 2: two', { x: 0, y: 0, width: 100, height: 20 }),
            box('div[dir] > div > p:nth-of-type(2)', 'Step 1: one', { x: 200, y: 0, width: 100, height: 20 }),
          ]),
        ],
      }),
    ])
    const orders = readingOrders(snapshot)
    expect(orders.map((order) => [order.container.ref, order.broken?.kind, order.intact])).toEqual([
      ['section.layout', undefined, undefined],
      ['nav', undefined, undefined],
      ['div.reversed', undefined, 'sequence'],
    ])
    const stage = runRuleChecks(snapshot, noEngine, 'en', [cssReadingOrderRule])
    expect(stage.findings).toEqual([])
    expect(stage.ran[0]).toMatchObject({ applicable: 3, failures: 0 })
    expect(stage.ran[0]?.note).toContain('2 group(s) CSS reordered with no relationship verified to break')
    expect(meaningfulSequenceCandidates(snapshot).map((c) => c.ref)).toEqual(['section.layout', 'nav'])
  })
})

describe('the 1.3.2 judgment', () => {
  const sidebar = () =>
    page([
      container('section.layout', ['order'], [
        box('section.layout > main', 'Our rooms Every room has a desk, fast wifi and a kettle.', { x: 220, y: 0, width: 500, height: 80 }),
        box('section.layout > aside', 'Related: parking, breakfast and late check-out.', { x: 0, y: 0, width: 200, height: 80 }, { order: -1 }),
      ]),
      container('.steps', ['order'], [
        box('.steps > div:nth-of-type(1)', 'Step 3: Pay', { x: 400, y: 0, width: 180, height: 40 }, { order: 3 }),
        box('.steps > div:nth-of-type(2)', 'Step 1: Choose', { x: 0, y: 0, width: 180, height: 40 }, { order: 1 }),
        box('.steps > div:nth-of-type(3)', 'Step 2: Pick', { x: 200, y: 0, width: 180, height: 40 }, { order: 2 }),
      ]),
      pre('pre', 'Name:       Ana Souza\nEmail:      ana@example.com\nPhone:      +55 85 5555 0101\n'),
    ])

  it('is asked only about what the rules nominated and could not verify', () => {
    const candidates = meaningfulSequenceCandidates(sidebar())
    expect(candidates.map((c) => [c.ref, c.context.kind])).toEqual([
      ['section.layout', 'reorder'],
      ['pre', 'whitespace'],
    ])
    const prompt = meaningfulSequence.prompt(candidates[0] as (typeof candidates)[number], sidebar())
    expect(prompt.user).toContain('What reorders them: CSS order')
    expect(prompt.user).toContain('Line 1: "Related: parking, breakfast and late check-out." | "Our rooms Every room has a desk, fast wifi and a kettle."')
  })

  it('keeps a candidate only with a quote of a box whose place changed', () => {
    const [candidate] = meaningfulSequenceCandidates(sidebar())
    if (!candidate) throw new Error('no candidate')
    const verify = (answer: Record<string, string>) => meaningfulSequence.verify({ verdict: 'fail', relation: 'grouping', confidence: 'high', evidence: '', ...answer } as never, candidate, sidebar())
    expect(verify({ evidence: 'Related: parking, breakfast' })).toEqual({ ok: true })
    expect(verify({ evidence: 'a quote from nowhere' })).toMatchObject({ ok: false })
    expect(verify({ evidence: 'Related: parking', relation: 'none' })).toMatchObject({ ok: false })
    expect(meaningfulSequence.verify({ verdict: 'pass', relation: 'none', confidence: 'high', evidence: 'Our rooms' }, candidate, sidebar())).toEqual({ ok: true })
    expect(meaningfulSequence.verify({ verdict: 'pass', relation: 'sequence', confidence: 'high', evidence: 'Our rooms' }, candidate, sidebar())).toMatchObject({ ok: false })
  })

  it('reports a kept candidate below the threshold, next to the rule failure', async () => {
    const provider: ModelProvider & { calls: number } = {
      id: 'test:sequence',
      calls: 0,
      async judge<T>(request: { user: string; schema: { parse(value: unknown): T } }) {
        provider.calls++
        const answer = request.user.includes('What reorders them')
          ? { verdict: 'fail', relation: 'grouping', evidence: 'Related: parking, breakfast and late check-out.', confidence: 'high' }
          : { verdict: 'pass', relation: 'none', evidence: 'Name: Ana Souza', confidence: 'high' }
        return { output: request.schema.parse(answer), inputTokens: 10, outputTokens: 5, latencyMs: 1, modelId: 'test' }
      },
    }
    const report = await checkSnapshot(sidebar(), noEngine, { ...options(), llm: true, provider, criteria: [meaningfulSequence], minConfidence: 'medium' })
    expect(provider.calls).toBe(2)
    expect(report.findings).toEqual([])
    const below = report.belowThreshold.filter((f) => f.criterion === '1.3.2').map((f) => [f.source, f.ref, f.confidence])
    expect(below).toEqual([
      ['rule', '.steps', 'low'],
      ['judgment', 'section.layout', 'low'],
    ])
  })
})

function box(ref: string, text: string, bounds: { x: number; y: number; width: number; height: number }, native: Record<string, unknown> = {}): A11yNode {
  return node({ ref, text, bounds, native: { tag: 'div', ...native } })
}

function container(ref: string, reorder: string[], children: A11yNode[]): A11yNode {
  return node({ ref, native: { tag: 'div', reorder }, children })
}

function pre(ref: string, text: string): A11yNode {
  return node({ ref, native: { tag: 'pre', preformatted: { text, mono: true, tabSize: 8 } } })
}

function page(children: A11yNode[]): A11ySnapshot {
  return {
    schemaVersion: 1,
    surface: 'web',
    target: 'test://order',
    title: 'Order',
    locale: 'en',
    viewport: { width: 1280, height: 800, scale: 1 },
    collectedAt: '2026-10-11T00:00:00.000Z',
    collector: { name: 'test', version: '0' },
    root: node({ ref: 'html', role: 'document', lang: 'en', native: { tag: 'html' }, children: [node({ ref: 'html > body', native: { tag: 'body' }, children })] }),
  }
}

function options(): CheckOptions {
  return { criteria: [], llm: false, provider: undefined, runs: 1, cache: memoryCache(), offline: false, locale: 'en', minConfidence: 'low', concurrency: 1 }
}

// Integration: needs Chrome or Edge (or Playwright's Chromium). Skipped when none is installed.
const browser = await launchBrowser().catch(() => undefined)
const fixture = (name: string) => pathToFileURL(resolve('test/fixtures/rules', name)).href

afterAll(async () => {
  await browser?.close()
}, 60_000)

describe.skipIf(!browser)('reading order on pages', { timeout: 60_000 }, () => {
  const check = async (name: string) => {
    if (!browser) throw new Error('no browser')
    const { snapshot, engine } = await collectWeb(browser, fixture(name), { runAxe: true, locale: 'en' })
    return { snapshot, report: await checkSnapshot(snapshot, engine, options()) }
  }
  const found = (report: Awaited<ReturnType<typeof check>>['report'], rule: string) => report.findings.filter((f) => f.ruleId === rule).map((f) => f.ref)

  it('records the facts: preformatted text with its spaces, and reordered groups with their boxes', async () => {
    const { snapshot } = await check('reading-order-fail.html')
    const pres = [...walk(snapshot.root)].filter((n) => n.native.preformatted)
    expect(pres).toHaveLength(2)
    expect((pres[0]?.native.preformatted as { text: string; mono: boolean }).text).toContain('Monday   2 fried eggs    tomato soup')
    expect((pres[0]?.native.preformatted as { mono: boolean }).mono).toBe(true)
    const groups = [...walk(snapshot.root)].filter((n) => Array.isArray(n.native.reorder)).map((n) => n.native.reorder)
    expect(groups).toEqual(expect.arrayContaining([['absolute'], ['order'], ['row-reverse'], ['column-reverse']]))
    const products = [...walk(snapshot.root)].find((n) => n.text === 'Products')
    expect(products?.native).toMatchObject({ position: 'absolute', font: [19.2, 400] })
  })

  it('finds each planted failure once', async () => {
    const { report } = await check('reading-order-fail.html')
    expect(found(report, 'rampa/whitespace-table')).toHaveLength(2)
    const order = report.findings.filter((f) => f.ruleId === 'rampa/css-reading-order')
    expect(order.map((f) => f.message.slice(0, 40))).toHaveLength(4)
    expect(order.map((f) => f.subject?.split('|')[0]).sort()).toEqual(['heading', 'heading', 'sentence', 'sequence'])
    expect(order.some((f) => f.message.includes('“Telephones” shows under “Products”'))).toBe(true)
    expect(report.coverage.criteria?.find((c) => c.id === '1.3.2')?.status).toBe('failures')
  })

  it('reports nothing on the fixed page, and leaves 1.3.2 not checked there', async () => {
    const { report } = await check('reading-order-pass.html')
    expect(found(report, 'rampa/whitespace-table')).toEqual([])
    expect(found(report, 'rampa/css-reading-order')).toEqual([])
    expect(report.coverage.criteria?.find((c) => c.id === '1.3.2')?.status).toBe('not-checked')
  })

  it('reports nothing on the near misses, and nominates the reordered groups for the judgment', async () => {
    const { snapshot, report } = await check('reading-order-controls.html')
    expect(found(report, 'rampa/whitespace-table')).toEqual([])
    expect(found(report, 'rampa/css-reading-order')).toEqual([])
    expect(report.coverage.criteria?.find((c) => c.id === '1.3.2')?.status).toBe('no-failure-found')
    const kinds = meaningfulSequenceCandidates(snapshot).map((c) => c.context.kind)
    expect(kinds.filter((kind) => kind === 'whitespace')).toHaveLength(1)
    expect(kinds.filter((kind) => kind === 'reorder').length).toBeGreaterThanOrEqual(4)
  })
})

function* walk(root: A11yNode): Generator<A11yNode> {
  yield root
  for (const child of root.children) yield* walk(child)
}
