import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Browser } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { EngineResults } from '../src/core/types.ts'
import type { A11yNode, A11ySnapshot } from '../src/snapshot/schema.ts'
import { walkTree } from '../src/snapshot/tree.ts'
import type { BrowserOptions } from '../src/surfaces/browser-options.ts'
import { collectWeb } from '../src/surfaces/web.ts'
import { browserForTests } from './browser.ts'
import { type FixtureSite, startFixtureSite } from './site-fixture.ts'

// Integration: needs Chrome or Edge (or Playwright's Chromium), and serves a small site on 127.0.0.1.
const browser = await browserForTests('the browser option tests')
let site: FixtureSite
beforeAll(async () => {
  site = await startFixtureSite()
})
afterAll(async () => {
  await browser?.close()
  await site?.close()
})

const collect = (path: string, browserOptions: BrowserOptions) =>
  collectWeb(browser as Browser, `${site.origin}${path}`, { runAxe: true, locale: 'en', browserOptions })
const byId = (snapshot: A11ySnapshot, id: string): A11yNode | undefined =>
  [...walkTree(snapshot.root)].find((node) => (node.native.attributes as Record<string, string> | undefined)?.id === id)
const allText = (snapshot: A11ySnapshot) => [...walkTree(snapshot.root)].map((node) => node.text ?? '').join(' ')
const contrast = (engine: EngineResults) => engine.rules.find((rule) => rule.ruleId === 'color-contrast')?.outcome

describe.skipIf(!browser)('browser options', { timeout: 30_000 }, () => {
  it('open the page as a phone would: viewport, pixel ratio and user agent', async () => {
    const phone = await collect('/echo', { device: 'iPhone 13' })
    expect(phone.snapshot.viewport).toEqual({ width: 390, height: 664, scale: 3 })
    expect(byId(phone.snapshot, 'ua')?.text).toContain('iPhone')
    const sized = await collect('/echo', { viewport: { width: 390, height: 844 }, userAgent: 'RampaTest/1.0' })
    expect(sized.snapshot.viewport).toEqual({ width: 390, height: 844, scale: 1 })
    expect(byId(sized.snapshot, 'ua')?.text).toBe('RampaTest/1.0')
  })

  it('emulate dark mode, where this page fails contrast', async () => {
    expect(contrast((await collect('/dark', {})).engine)).toBe('pass')
    expect(contrast((await collect('/dark', { colorScheme: 'dark' })).engine)).toBe('violation')
  })

  it('emulate reduced motion', async () => {
    expect(byId((await collect('/motion', {})).snapshot, 'animated')?.states).not.toContain('hidden')
    expect(byId((await collect('/motion', { reducedMotion: true })).snapshot, 'animated')?.states).toContain('hidden')
  })

  it("set the browser's language, which the site reads from Accept-Language", async () => {
    expect((await collect('/echo', { locale: 'pt-BR' })).snapshot.locale).toBe('pt-BR')
  })

  it('wait for an element or a pause before collecting', async () => {
    expect(byId((await collect('/late', {})).snapshot, 'late')).toBeUndefined()
    expect(byId((await collect('/late', { waitFor: [{ selector: '#late' }] })).snapshot, 'late')?.text).toBe('Arrived late')
    expect(byId((await collect('/late', { waitFor: [{ ms: 2200 }] })).snapshot, 'late')).toBeDefined()
    await expect(collect('/late', { waitFor: [{ selector: '#never' }], timeoutMs: 300 })).rejects.toThrow('--wait-for "#never"')
  })

  it('give up on a page that does not load within the timeout', async () => {
    await expect(collect('/slow', { timeoutMs: 400 })).rejects.toThrow('did not reach load within 400 ms')
  })

  it('send headers to the site, through redirects, and never to a third party', async () => {
    const echo = await collect('/echo', { headers: { 'x-test': 'ok' } })
    expect(byId(echo.snapshot, 'test')?.text).toBe('ok')
    const thirdParty = site.requests.filter((request) => request.server === 'third-party')
    expect(thirdParty.length).toBeGreaterThan(0)
    expect(thirdParty.every((request) => request.headers['x-test'] === undefined)).toBe(true)

    const gated = await collect('/to-gated', { headers: { 'x-test': 'ok' }, cookies: [{ name: 'session', value: 'ok' }] })
    expect(allText(gated.snapshot)).toContain('Header received')
    expect(allText(gated.snapshot)).toContain('cookie: session=ok')
  })

  it('carry a signed-in session from a cookie or a storage state file', async () => {
    expect((await collect('/members', {})).snapshot.title).toBe('Sign in')
    expect((await collect('/members', { cookies: [{ name: 'session', value: 'ok' }] })).snapshot.title).toBe('Members')
    const dir = await mkdtemp(join(tmpdir(), 'rampa-state-'))
    const state = join(dir, 'auth.json')
    const cookie = { name: 'session', value: 'ok', domain: '127.0.0.1', path: '/', expires: -1, httpOnly: true, secure: false, sameSite: 'Lax' }
    await writeFile(state, JSON.stringify({ cookies: [cookie], origins: [] }))
    expect((await collect('/members', { storageState: state })).snapshot.title).toBe('Members')
  })
})
