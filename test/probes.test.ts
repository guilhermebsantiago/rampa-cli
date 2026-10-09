import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { matchNode, snapshotSignature } from '../src/probes/identity.ts'
import { openProbePage } from '../src/probes/page.ts'
import { parseProbeKinds } from '../src/probes/run.ts'
import { A11ySnapshotSchema, type A11ySnapshot } from '../src/snapshot/schema.ts'
import { indexTree } from '../src/snapshot/tree.ts'
import { launchTestBrowser } from './browser.ts'

const fixture = (name: string) => pathToFileURL(resolve('test/fixtures/probes', name)).href

describe('probe stage', () => {
  it('parses --probe', () => {
    expect(parseProbeKinds(undefined)).toEqual([])
    expect(parseProbeKinds('none')).toEqual([])
    expect(parseProbeKinds('keyboard,layout')).toEqual(['layout', 'keyboard'])
    expect(parseProbeKinds('all')).toEqual(['layout', 'keyboard'])
    expect(() => parseProbeKinds('hover')).toThrow(/--probe takes/)
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
afterAll(async () => browser?.close())

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
