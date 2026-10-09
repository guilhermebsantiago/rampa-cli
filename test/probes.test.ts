import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { checkSnapshot } from '../src/core/check.ts'
import { emptyEngine } from '../src/engine/axe.ts'
import { matchNode, snapshotSignature } from '../src/probes/identity.ts'
import { openProbePage } from '../src/probes/page.ts'
import { parseProbeKinds } from '../src/probes/run.ts'
import { nowrapEllipsis, oneLineBox } from '../src/rules/layout.ts'
import { probeChecks } from '../src/rules/probes.ts'
import { PROBE_RULES } from '../src/rules/registry.ts'
import { A11ySnapshotSchema, type A11ySnapshot, type ProbeRecord } from '../src/snapshot/schema.ts'
import { indexTree } from '../src/snapshot/tree.ts'
import { launchTestBrowser } from './browser.ts'
import { probeCheckOptions } from './probe-helpers.ts'

const fixture = (name: string) => pathToFileURL(resolve('test/fixtures/probes', name)).href

const record = (variant: string, overrides: Partial<ProbeRecord> = {}): ProbeRecord => ({
  kind: variant === 'keyboard-walk' ? 'keyboard' : 'layout',
  version: variant === 'keyboard-walk' ? '2' : '1',
  conditions: { viewport: { width: 320, height: 256 }, deviceScaleFactor: 1, browser: 'chromium 1 (headless)', variant },
  status: 'complete',
  guard: { blocked: [], navigations: [], dialogs: [] },
  durationMs: 1,
  data: null,
  ...overrides,
})

const snapshotWith = (probes: ProbeRecord[]): A11ySnapshot => ({
  schemaVersion: 1,
  surface: 'web',
  target: 'https://example.com/',
  viewport: { width: 1280, height: 800, scale: 1 },
  root: { ref: 'html', role: 'document', states: [], native: { tag: 'html', attributes: {} }, children: [] },
  observations: { probes },
  collectedAt: new Date(0).toISOString(),
  collector: { name: 'rampa-web', version: '0' },
})

describe('probe rules over recorded observations', () => {
  it('reports nothing, not even coverage, when no probe ran', () => {
    const result = probeChecks({ ...snapshotWith([]), observations: undefined }, 'en', PROBE_RULES)
    expect(result).toEqual({ findings: [], review: [], coverage: [] })
  })

  it('says "not checked" with the reason for a skipped probe, an unknown version or an unreadable record', () => {
    const result = probeChecks(
      snapshotWith([
        record('reflow-320x256', { status: 'skipped', reason: 'probe failed: net::ERR_NAME_NOT_RESOLVED' }),
        record('text-spacing', { version: '9' }),
        record('keyboard-walk', { data: 'not an object' }),
      ]),
      'en',
      PROBE_RULES,
    )
    expect(result.findings).toEqual([])
    const byCriterion = Object.fromEntries(result.coverage.map((row) => [row.criterion, row]))
    expect(byCriterion['1.4.10']).toMatchObject({ status: 'not-checked', note: 'probe failed: net::ERR_NAME_NOT_RESOLVED' })
    expect(byCriterion['1.4.12']).toMatchObject({ status: 'not-checked', note: 'probe version 9 is not one this rule reads' })
    // An empty walk: 2.1.1 cannot say what was missed.
    expect(byCriterion['2.1.1']).toMatchObject({ status: 'not-checked' })
    // 2.4.11 is in Rampa's default WCAG 2.2 target; under --wcag 2.1 it is beyond it.
    expect(byCriterion['2.4.11']?.beyondTarget).toBeUndefined()
    const older = probeChecks(snapshotWith([record('keyboard-walk', { data: 'not an object' })]), 'en', PROBE_RULES, '2.1')
    expect(older.coverage.find((row) => row.criterion === '2.4.11')).toMatchObject({ beyondTarget: true })
  })

  it('keeps unchecked criteria in the "not checked" list and probed ones out of it', async () => {
    const report = await checkSnapshot(snapshotWith([record('reflow-320x256', { status: 'skipped', reason: 'x' })]), emptyEngine(), probeCheckOptions())
    expect(report.coverage.notChecked).toContain('1.4.10')
    const probed = await checkSnapshot(snapshotWith([record('reflow-320x256', { data: { baseline: {}, variant: {} } })]), emptyEngine(), probeCheckOptions())
    expect(probed.coverage.notChecked).not.toContain('1.4.10')
    expect(probed.coverage.probes?.[0]).toMatchObject({ criterion: '1.4.10', status: 'no-failure-found', maturity: 'experimental' })
  })

  it('gives each probe rule a method of kind probe in the per-criterion coverage', async () => {
    const skipped = await checkSnapshot(snapshotWith([record('reflow-320x256', { status: 'skipped', reason: 'x' })]), emptyEngine(), probeCheckOptions())
    const unchecked = skipped.coverage.criteria?.find((c) => c.id === '1.4.10')
    expect(unchecked?.status).toBe('not-checked')
    expect(unchecked?.methods).toEqual([
      { kind: 'probe', id: 'rampa/reflow', ran: false, applicable: 0, failures: 0, review: 0, maturity: 'experimental', probe: { method: 'probe/layout@1', conditions: expect.any(String), note: 'x' } },
    ])
    const probed = await checkSnapshot(snapshotWith([record('reflow-320x256', { data: { baseline: {}, variant: {} } })]), emptyEngine(), probeCheckOptions())
    const checked = probed.coverage.criteria?.find((c) => c.id === '1.4.10')
    expect(checked?.status).not.toBe('not-checked')
    expect(checked?.methods).toEqual([expect.objectContaining({ kind: 'probe', id: 'rampa/reflow', ran: true, maturity: 'experimental' })])
  })
})

describe('3.2.1 over recorded walks', () => {
  const button = { ref: '#b', role: 'button', name: 'Buy', states: [], native: { tag: 'button', attributes: { id: 'b', type: 'button' } }, children: [] }
  const el = { ref: '#b', id: { tag: 'button', sig: 'button|b||button||' }, tag: 'button', role: 'button', label: 'Buy' }
  const walkWith = (stop: Record<string, unknown>) => {
    const snapshot = snapshotWith([
      record('keyboard-walk', {
        data: {
          viewport: { width: 1280, height: 800 },
          idleMs: 1500,
          idle: [],
          inventory: [],
          forward: [{ n: 1, key: 'Tab', at: 0, el, ...stop }, { n: 2, key: 'Tab', at: 200, el: null }],
          backward: [],
          end: { forward: 'cycled', backward: 'cycled' },
          traps: [],
          budget: 150,
        },
      }),
    ])
    snapshot.root.children = [button]
    return probeChecks(snapshot, 'en', PROBE_RULES)
  }

  it('fails a change that happened again when focus came back', () => {
    const result = walkWith({ events: [{ type: 'open', at: 5, detail: 'https://example.invalid/' }], confirmed: ['open'] })
    expect(result.findings.filter((f) => f.ruleId === 'rampa/on-focus').map((f) => f.confidence)).toEqual(['high'])
  })

  it('sends a change that did not happen again to review: a timer may have fired during the key press', () => {
    const result = walkWith({ events: [{ type: 'open', at: 5, detail: 'https://example.invalid/' }], confirmed: [] })
    expect(result.findings.filter((f) => f.ruleId === 'rampa/on-focus')).toEqual([])
    expect(result.review.filter((f) => f.ruleId === 'rampa/on-focus').map((f) => f.evidence)).toEqual([expect.stringContaining('it did not happen again when focus came back')])
  })

  it('ignores a focus guard that moves focus on by design', () => {
    const after = { ref: '#first', id: { tag: 'a', sig: 'a|first||||#x' }, tag: 'a', role: 'link', label: 'First' }
    const result = walkWith({ rect: { x: 0, y: 0, width: 0, height: 0 }, after, afterWithin: false, confirmed: ['focus'] })
    expect([...result.findings, ...result.review].filter((f) => f.ruleId === 'rampa/on-focus')).toEqual([])
  })
})

describe('1.4.4 over recorded zoom measurements', () => {
  it('applies ACT 59br37 exceptions: a no-wrap ellipsis, and a box one line high but no shorter than its letters', () => {
    expect(nowrapEllipsis({ by: '#a', ws: 'nowrap', wrap: 'nowrap', to: 'ellipsis' })).toBe(true)
    expect(nowrapEllipsis({ by: '#a', ws: 'nowrap', wrap: 'nowrap', to: 'clip' })).toBe(false)
    expect(nowrapEllipsis({ by: '#a', ws: 'normal', wrap: 'wrap', to: 'ellipsis' })).toBe(false)
    expect(nowrapEllipsis(undefined)).toBe(false)
    // Passed Example 3: 16 px high, 16 px line height, 16 px text.
    expect(oneLineBox({ by: '#a', lh: 16, h: 16, fs: 16 })).toBe(true)
    // Failed Example 1: 1.5em high with a normal line height holds a line and a half.
    expect(oneLineBox({ by: '#a', lh: 19.2, h: 24, fs: 16, normal: true })).toBe(false)
    // Failed Example 4: ACT's wording alone would excuse a 10 px box, but it cuts the letters themselves.
    expect(oneLineBox({ by: '#a', lh: 19.2, h: 10, fs: 16, normal: true })).toBe(false)
  })

  const box = (ref: string, extra: Record<string, unknown> = {}) => ({
    ref,
    key: Number(ref.replace(/\D/g, '')) || 1,
    id: { tag: 'p', sig: `p|${ref.slice(1)}||||` },
    tag: 'p',
    kind: 'text',
    text: 'Some words',
    rect: { x: 0, y: 0, width: 300, height: 40 },
    line: 18,
    vis: { x: 0, y: 0, width: 300, height: 20 },
    cut: { left: 0, right: 0, top: 0, bottom: 20 },
    own: true,
    yClip: { by: ref, lh: 18, h: 20, fs: 16 },
    ...extra,
  })
  const zoomed = (data: Record<string, unknown>) => {
    const snapshot = snapshotWith([record('zoom-200', { data })])
    snapshot.root.children = ['#p1', '#p2', '#p3'].map((ref) => ({ ref, role: 'paragraph', states: [], native: { tag: 'p', attributes: { id: ref.slice(1) } }, children: [] }))
    return probeChecks(snapshot, 'en', PROBE_RULES)
  }
  const measure = (boxes: unknown[]) => ({ viewport: { width: 640, height: 512 }, clientWidth: 640, scrollWidth: 640, scrollsX: false, measured: boxes.length, boxes, overlaps: [], truncated: false })

  it('leaves out text under aria-hidden, foreign text and a visually hidden 1 px window', () => {
    const result = zoomed({
      baseline: measure([]),
      variant: measure([
        box('#p1', { ah: true }),
        box('#p2', { foreign: true }),
        box('#p3', { vis: { x: 0, y: 0, width: 1, height: 1 } }),
      ]),
      missing: [],
    })
    expect(result.findings).toEqual([])
    expect(result.coverage.find((row) => row.criterion === '1.4.4')).toMatchObject({ status: 'no-failure-found', failures: 0 })
  })

  it('reports hidden text only when the width hid it and no control may show it', () => {
    const group = (ref: string, extra: Record<string, unknown>) => ({
      root: { ref, id: { tag: 'p', sig: `p|${ref.slice(1)}||||` }, tag: 'p', label: '' },
      reason: 'display-none',
      boxes: 1,
      sample: ['Some words'],
      members: [],
      ...extra,
    })
    const result = zoomed({
      baseline: measure([]),
      variant: measure([]),
      missing: [group('#p1', { back: 1 }), group('#p2', { back: 0 }), group('#p3', { back: 1, toggle: '#menu-button' })],
    })
    expect(result.review.map((f) => f.ref)).toEqual(['#p1'])
    expect(result.coverage[0]?.note).toContain('1 hidden text box(es) sit behind a menu button, not opened')
    expect(result.coverage[0]?.note).toContain('1 text box(es) gone at 640 px and not back at 1280 px')
  })
})

describe('1.4.13 over recorded hover attempts', () => {
  const trigger = { ref: '#t', id: { tag: 'button', sig: 'button|t||button||' }, tag: 'button', role: 'button', label: 'Help', t: 0, rect: { x: 0, y: 0, width: 80, height: 30 }, sources: ['describedby'], focusable: true }
  const content = { ref: '#tip', id: { tag: 'div', sig: 'div|tip|tooltip|||' }, tag: 'div', role: 'tooltip', label: 'Some help', rect: { x: 0, y: 30, width: 200, height: 40 }, relation: 'describedby', position: 'absolute' }
  const attempt = (extra: Record<string, unknown>) => ({ trigger: 0, mode: 'hover', shown: true, content: [content], covers: { count: 1, sample: [{ ref: 'p', id: { tag: 'p', sig: 'p|||||' }, tag: 'p', label: 'Text' }] }, ms: 1, ...extra })
  const hovered = (attempts: unknown[], data: Record<string, unknown> = {}) => {
    const snapshot = snapshotWith([
      {
        ...record('hover-focus', { data: { viewport: { width: 1280, height: 800 }, found: 1, alike: 0, budget: 30, triggers: [trigger], attempts, unreadableSheets: 0, listeners: 1, clock: true, end: 'complete', ...data } }),
        kind: 'hover',
        version: '1',
      },
    ])
    snapshot.root.children = [{ ref: '#t', role: 'button', name: 'Help', states: [], native: { tag: 'button', attributes: { id: 't', type: 'button' } }, children: [] }]
    return probeChecks(snapshot, 'en', PROBE_RULES)
  }

  it('fails dismissible only when the content covers something, Esc left it, and it went when the pointer left', () => {
    expect(hovered([attempt({ dismissible: { ok: false, afterMs: 600, staysAfterLeave: false } })]).findings.map((f) => f.message)).toEqual([expect.stringContaining('does not close with Esc')])
    const nothingCovered = hovered([attempt({ covers: { count: 0, sample: [] }, dismissible: { ok: false, afterMs: 600 } })])
    expect(nothingCovered.findings).toEqual([])
    expect(nothingCovered.coverage[0]?.note).toContain('1 did not close with Esc but cover no other content')
    expect(hovered([attempt({ dismissible: { ok: false, afterMs: 600, staysAfterLeave: true } })]).review.map((f) => f.message)).toEqual([expect.stringContaining('stays when the pointer and focus leave')])
    expect(hovered([attempt({ inputError: true, dismissible: { ok: false, afterMs: 600 } })]).review.map((f) => f.message)).toEqual([expect.stringContaining('input error')])
  })

  it('fails hoverable and persistent only when both tries lost the content, and reports one finding for hover and focus together', () => {
    const twice = hovered([attempt({ persistent: { ok: false, rounds: 2, failed: 2, afterMs: 10000 } }), attempt({ mode: 'focus', persistent: { ok: false, rounds: 2, failed: 2, afterMs: 10000 } })])
    expect(twice.findings.map((f) => f.message)).toEqual([expect.stringMatching(/^Content that appears on hover and on focus disappears on its own/)])
    const once = hovered([attempt({ hoverable: { ok: true, rounds: 2, failed: 1, gap: 12 } })])
    expect(once.findings).toEqual([])
    expect(once.review.map((f) => f.evidence)).toEqual([expect.stringMatching(/12 px from the trigger; .*in 1 of 2 tries$/)])
    // A pointer that could not reach the content says nothing about it.
    expect(hovered([attempt({ hoverable: { ok: null, rounds: 1, failed: 0, gap: 900, why: 'outside the window' } })]).coverage[0]?.note).toContain('1 could not be reached by the pointer')
  })

  it('says what limited the probe in the coverage note', () => {
    const result = hovered([], { found: 40, alike: 4, listeners: null, clock: false, unreadableSheets: 2 })
    expect(result.coverage[0]).toMatchObject({ criterion: '1.4.13', status: 'no-failure-found', applicable: 0 })
    const note = result.coverage[0]?.note ?? ''
    for (const part of ['0 trigger(s) tried of 40 found', '4 more of a kind already tried five times', '2 style sheet(s) from other origins not read', 'event listeners not read', 'persistence not measured']) expect(note).toContain(part)
  })
})

describe('probe stage', () => {
  it('parses --probe', () => {
    expect(parseProbeKinds(undefined)).toEqual([])
    expect(parseProbeKinds('none')).toEqual([])
    expect(parseProbeKinds('keyboard,layout')).toEqual(['layout', 'keyboard'])
    expect(parseProbeKinds('hover,layout')).toEqual(['layout', 'hover'])
    expect(parseProbeKinds('all')).toEqual(['layout', 'keyboard', 'hover'])
    expect(() => parseProbeKinds('orientation')).toThrow(/--probe takes layout, keyboard, hover, all or none/)
  })

  it('ties a fact to a snapshot node only when the ref and the identity match', () => {
    const button = { ref: '#buy', role: 'button', states: [], native: { tag: 'button', attributes: { id: 'buy', type: 'button' } }, children: [] }
    const root = { ref: 'html', role: 'document', states: [], native: { tag: 'html', attributes: {} }, children: [button] }
    const index = indexTree(root)
    const sig = snapshotSignature(button)
    expect(sig).toBe('button|buy||button||')
    expect(matchNode(index, '#buy', { tag: 'button', sig })?.ref).toBe('#buy')
    // The same ref on the fresh load is another element: the fact is unmatched, never a finding.
    expect(matchNode(index, '#buy', { tag: 'a', sig: 'a|buy||||/cart' })).toBeUndefined()
    expect(matchNode(index, '#gone', { tag: 'button', sig })).toBeUndefined()
    expect(matchNode(index, '#buy', undefined)).toBeUndefined()
  })

  it('accepts observations in a snapshot without changing schemaVersion', () => {
    const snapshot: A11ySnapshot = {
      schemaVersion: 1,
      surface: 'web',
      target: 'https://example.com/',
      viewport: { width: 1280, height: 800, scale: 1 },
      root: { ref: 'html', role: 'document', states: [], native: {}, children: [] },
      observations: {
        probes: [
          {
            kind: 'layout',
            version: '1',
            conditions: { viewport: { width: 320, height: 256 }, deviceScaleFactor: 1, browser: 'chromium 1 (headless)', variant: 'reflow-320x256' },
            status: 'complete',
            guard: { blocked: [], navigations: [], dialogs: [] },
            durationMs: 10,
            data: { anything: true },
          },
        ],
      },
      collectedAt: new Date(0).toISOString(),
      collector: { name: 'rampa-web', version: '0' },
    }
    expect(A11ySnapshotSchema.safeParse(snapshot).success).toBe(true)
  })
})

const launched = await launchTestBrowser('the probe guard tests')
if ('skip' in launched) process.stderr.write(`\n${launched.skip}\n`)
const browser = 'browser' in launched ? launched.browser : undefined
// Closing Edge can take long on a loaded machine.
afterAll(async () => browser?.close(), 60_000)

describe.skipIf(!browser)('network guard', { timeout: 30_000 }, () => {
  it('aborts writes, answers navigations locally, blocks sockets, closes popups and dismisses dialogs', async () => {
    if (!browser) return
    const probe = await openProbePage(browser, fixture('guard.html'), { kinds: [] })
    try {
      await probe.page.waitForTimeout(600)
      const { blocked, navigations, dialogs } = probe.guard.log
      const methods = blocked.map((entry) => `${entry.method} ${entry.url}`)
      expect(methods).toContain('POST https://example.invalid/collect')
      expect(methods).toContain('POST https://example.invalid/beacon')
      expect(methods.some((line) => line.startsWith('WEBSOCKET wss://example.invalid/socket'))).toBe(true)
      expect(methods).toContain('EVENTSOURCE https://example.invalid/stream')
      expect(navigations.map((entry) => entry.url)).toContain('https://example.invalid/next')
      expect(dialogs).toEqual([expect.objectContaining({ type: 'alert', message: 'Subscribe now' })])
      // The page stayed where it was: the navigation was answered with 204.
      expect(probe.page.url()).toBe(fixture('guard.html'))
      const hooks = await probe.page.evaluate(() => (window as unknown as { __rampaKit: { drain(): Array<{ type: string; detail?: string }> } }).__rampaKit.drain())
      expect(hooks.map((event) => event.type)).toEqual(expect.arrayContaining(['open', 'submit']))
      expect(hooks.find((event) => event.type === 'open')?.detail).toBe('https://example.invalid/popup')
      expect(probe.context.pages()).toHaveLength(1)
    } finally {
      await probe.context.close()
    }
  })
})
