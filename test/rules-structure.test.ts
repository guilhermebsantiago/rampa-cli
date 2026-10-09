import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { memoryCache } from '../src/core/cache.ts'
import { checkSnapshot } from '../src/core/check.ts'
import type { Finding } from '../src/core/types.ts'
import { type TableCell, assignedCells, headerKind, tableFactsOf, tablesOf } from '../src/rules/structure.ts'
import { walkTree } from '../src/snapshot/tree.ts'
import { collectWeb, launchBrowser } from '../src/surfaces/web.ts'

/** A cell on the grid: th or td, one slot unless spans say otherwise. */
const cell = (ref: string, header: boolean, x: number, y: number, extra: Partial<TableCell> = {}): TableCell => ({
  ref,
  header,
  x,
  y,
  w: 1,
  h: 1,
  scope: '',
  headers: [],
  id: '',
  role: '',
  empty: false,
  hidden: false,
  ...extra,
})

const unassigned = (cells: TableCell[]) =>
  [...assignedCells(cells).entries()]
    .filter(([, assigned]) => assigned.length === 0)
    .map(([header]) => header.ref)

describe('header cell assignment (HTML table model, ACT d0f69e)', () => {
  it('passes the ACT passed examples', () => {
    // Passed 1: <tr><th>Time</th></tr><tr><td>05:41</td></tr>
    expect(unassigned([cell('time', true, 0, 0), cell('t1', false, 0, 1)])).toEqual([])
    // Passed 3: a cell spanning two columns sits under both headers.
    expect(unassigned([cell('projects', true, 0, 0), cell('exams', true, 1, 0), cell('15', false, 0, 1, { w: 2 })])).toEqual([])
    // Passed 5: the headers attribute assigns the second header.
    expect(
      unassigned([cell('cities', true, 0, 0, { id: 'col1' }), cell('count', true, 1, 0, { id: 'col2' }), cell('paris', false, 0, 1), cell('one', false, 0, 2, { headers: ['col2'] })]),
    ).toEqual([])
    // Passed 6: header cells head other header cells.
    const hours = [
      cell('day', true, 0, 0),
      cell('morning', true, 1, 0),
      cell('afternoon', true, 2, 0),
      cell('monfri', true, 0, 1),
      cell('a', false, 1, 1),
      cell('b', false, 2, 1),
      cell('satsun', true, 0, 2),
      cell('c', false, 1, 2),
      cell('d', false, 2, 2),
    ]
    expect(unassigned(hours)).toEqual([])
  })

  it('fails the ACT failed examples', () => {
    // Failed 1: "Value" has nothing under it.
    expect(unassigned([cell('rate', true, 0, 0), cell('value', true, 1, 0), cell('15', false, 0, 1)])).toEqual(['value'])
    // Failed 2: the only cell under "Starting with a Z" points its headers at the first column.
    expect(
      unassigned([cell('country', true, 0, 0, { id: 'col1' }), cell('z', true, 1, 0, { id: 'col2' }), cell('zambia', false, 0, 1), cell('zimbabwe', false, 1, 1, { headers: ['col1'] })]),
    ).toEqual(['z'])
    // Failed 3, an ARIA grid: "Occupant" heads an empty column.
    expect(
      unassigned([cell('room', true, 0, 0, { scope: 'col' }), cell('occupant', true, 1, 0, { scope: 'col' }), cell('1a', false, 0, 1), cell('2a', false, 0, 2)]),
    ).toEqual(['occupant'])
  })

  it('knows a header with no scope that heads neither its row nor its column', () => {
    // As in a Wikipedia navbox: a picture cell spans the header row, so the row holds a data cell, and so does each column.
    const cells = [cell('picture', false, 0, 0, { h: 3 }), cell('rank', true, 1, 0), cell('city', true, 2, 0), cell('one', false, 1, 1), cell('sp', false, 2, 1)]
    const rank = cells[1] as TableCell
    expect(headerKind(cells, rank)).toBe('neither')
    expect(unassigned(cells)).toEqual(['rank', 'city'])
    expect(headerKind([...cells.slice(0, 1), { ...rank, scope: 'col' }], { ...rank, scope: 'col' })).toBe('column')
  })

  it('leaves headers a header block hides from the cells beyond it', () => {
    // Two header rows: the top header is hidden from the data by the block below it only when a data cell intervenes.
    const cells = [cell('top', true, 0, 0), cell('mid', true, 0, 1), cell('data', false, 0, 2)]
    expect(unassigned(cells)).toEqual([])
  })
})

// Integration: needs Chrome or Edge (or Playwright's Chromium). Skipped when none is installed.
const browser = await launchBrowser().catch(() => undefined)
// A loaded machine can take a while to close a browser; the default 10 s hook timeout is not enough there.
afterAll(async () => browser?.close(), 60_000)
const fixture = (name: string) => pathToFileURL(resolve('test/fixtures/rules', name)).href
const ruleFindings = (findings: Finding[]) => findings.filter((f) => f.source === 'rule').map((f) => `${f.ruleId} ${f.ref}`)

describe.skipIf(!browser)('structure rules on real pages', { timeout: 30_000 }, () => {
  const check = async (url: string) => {
    if (!browser) throw new Error('no browser')
    const { snapshot, engine } = await collectWeb(browser, url, { runAxe: true, locale: 'en' })
    const report = await checkSnapshot(snapshot, engine, {
      criteria: [],
      llm: false,
      provider: undefined,
      runs: 1,
      cache: memoryCache(),
      offline: false,
      locale: 'en',
      minConfidence: 'low',
      concurrency: 1,
    })
    return { snapshot, engine, report }
  }

  it('records the table grid, what a label labels, a role the browser drops, and a fieldset as a named group', async () => {
    if (!browser) return
    const page = `data:text/html,${encodeURIComponent('<html lang="en"><body><table role="presentation"><tr><td colspan="2" rowspan="2">a</td><td>b</td></tr><tr><th scope="row" headers="x">c</th></tr></table><label for="f">F</label><input id="f"><label>Lost</label><fieldset><legend>Pay with</legend><input type="radio" aria-label="Card"></fieldset></body></html>')}`
    const { snapshot } = await check(page)
    const [table] = tablesOf(snapshot)
    const facts = table ? tableFactsOf(table) : undefined
    expect(table?.native.presentational).toBe(true)
    expect(facts?.cells.map((c) => [c.header, c.x, c.y, c.w, c.h, c.scope, c.headers.join(' ')])).toEqual([
      [false, 0, 0, 2, 2, '', ''],
      [false, 2, 0, 1, 1, '', ''],
      [true, 2, 1, 1, 1, 'row', 'x'],
    ])
    const labels = [...walkTree(snapshot.root)].filter((node) => node.native.tag === 'label')
    expect(labels.map((label) => label.native.labelControl)).toEqual(['#f', null])
    const group = [...walkTree(snapshot.root)].find((node) => node.native.tag === 'fieldset')
    expect([group?.role, group?.name]).toEqual(['group', 'Pay with'])
  })

  it('finds every planted failure, each once', async () => {
    const { report } = await check(fixture('structure-fail.html'))
    expect(ruleFindings(report.findings).sort()).toEqual([
      'rampa/duplicate-id-reference html > body > main > section:nth-of-type(2) > button',
      'rampa/orphan-label #order',
      'rampa/presentational-table #layout',
      'rampa/table-header-cells #rates > thead > tr > th:nth-of-type(2)',
    ])
    const hijack = report.findings.find((f) => f.ruleId === 'rampa/duplicate-id-reference')
    expect(hijack?.message).toContain('comes from the first of them ("Blue mug"), not from the one beside it ("Red kettle")')
    const orphan = report.findings.find((f) => f.ruleId === 'rampa/orphan-label')
    expect(orphan?.patch?.after).toBe('<label for="order">')
    expect(report.findings.find((f) => f.ruleId === 'rampa/presentational-table')?.evidence).toBe('role="presentation" · 2 <th>, <caption>Shipping times</caption>')
    expect(report.coverage.rules).toEqual(expect.arrayContaining(['1.3.1', '4.1.2']))
  })

  it('reports nothing on the fixed page', async () => {
    const { report } = await check(fixture('structure-pass.html'))
    expect(ruleFindings(report.findings)).toEqual([])
  })

  it('reports nothing on the near misses', async () => {
    const { report } = await check(fixture('structure-controls.html'))
    expect(ruleFindings(report.findings)).toEqual([])
  })

  it("runs axe-core's experimental table rules in the same run, as needs review only", async () => {
    const tables =
      '<table><tr><td colspan="3"><b>Prices</b></td></tr><tr><td>A</td><td>B</td><td>C</td></tr><tr><td>1</td><td>2</td><td>3</td></tr><tr><td>4</td><td>5</td><td>6</td></tr></table>'
    const { report, engine } = await check(`data:text/html,${encodeURIComponent(`<html lang="en"><head><title>Prices</title></head><body><main>${tables}</main></body></html>`)}`)
    expect(engine.rules.filter((r) => r.outcome === 'violation').map((r) => r.ruleId)).toEqual(expect.arrayContaining(['table-fake-caption', 'td-has-header']))
    const review = report.findings.filter((f) => f.ruleId === 'table-fake-caption' || f.ruleId === 'td-has-header')
    expect(review.map((f) => f.confidence)).toEqual(['low', 'low'])
  })

  it('sends a table still loading, or holding only headers, to review instead of failing it', async () => {
    const busy = '<table aria-busy="true"><thead><tr><th>Name</th><th>Email</th></tr></thead><tbody></tbody></table>'
    const headersOnly = '<table><tr><th>Name</th><th>Email</th></tr></table>'
    for (const markup of [busy, headersOnly]) {
      const { report } = await check(`data:text/html,${encodeURIComponent(`<html lang="en"><body>${markup}</body></html>`)}`)
      const hits = [...report.findings, ...report.belowThreshold].filter((f) => f.ruleId === 'rampa/table-header-cells')
      expect(hits.length, markup).toBe(2)
      expect(hits.every((f) => f.confidence === 'low' && /check whether its data is still to come/.test(f.message)), markup).toBe(true)
    }
  })

  it('asks for a scope, as review, when a header with none heads neither its row nor its column', async () => {
    const navbox = '<table><tr><td rowspan="3">Map</td><th>Rank</th><th>City</th></tr><tr><td>1</td><td>São Paulo</td></tr><tr><td>2</td><td>Rio</td></tr></table>'
    const { report } = await check(`data:text/html,${encodeURIComponent(`<html lang="en"><body>${navbox}</body></html>`)}`)
    const hits = report.findings.filter((f) => f.ruleId === 'rampa/table-header-cells')
    expect(hits.map((f) => f.subject)).toEqual(['Rank', 'City'])
    expect(hits.every((f) => /Set scope="col" or scope="row"/.test(f.message))).toBe(true)
  })
})
