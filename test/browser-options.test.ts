import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { devices } from 'playwright-core'
import { describe, expect, it } from 'vitest'
import {
  type BrowserFlags,
  DEFAULT_VIEWPORT,
  contextOptions,
  describeConditions,
  headersFor,
  parseBrowserFlags,
  sameSite,
} from '../src/surfaces/browser-options.ts'

const failure = (flags: BrowserFlags): string => {
  try {
    parseBrowserFlags(flags)
    return ''
  } catch (error) {
    return (error as Error).message
  }
}

describe('browser flags', () => {
  it('parse into browser options', () => {
    expect(
      parseBrowserFlags({
        header: ['Authorization: Bearer abc:def', 'X-Test:  ok '],
        cookie: ['session=a=b', 'theme='],
        viewport: '390x844',
        device: 'pixel7',
        colorScheme: 'Dark',
        reducedMotion: true,
        browserLocale: 'pt-br',
        waitFor: ['networkidle', '#app', '500', '250ms'],
        timeout: '10000',
        userAgent: ' RampaTest/1.0 ',
      }),
    ).toEqual({
      headers: { authorization: 'Bearer abc:def', 'x-test': 'ok' },
      cookies: [
        { name: 'session', value: 'a=b' },
        { name: 'theme', value: '' },
      ],
      viewport: { width: 390, height: 844 },
      device: 'Pixel 7',
      colorScheme: 'dark',
      reducedMotion: true,
      locale: 'pt-BR',
      waitUntil: 'networkidle',
      waitFor: [{ selector: '#app' }, { ms: 500 }, { ms: 250 }],
      timeoutMs: 10000,
      userAgent: 'RampaTest/1.0',
    })
    expect(parseBrowserFlags({})).toEqual({})
  })

  it('reject malformed values without repeating a header or cookie value', () => {
    expect(failure({ header: ['Authorization Bearer s3cret'] })).toContain('--header must be "Name: value"')
    expect(failure({ header: ['Authorization Bearer s3cret'] })).not.toContain('s3cret')
    expect(failure({ cookie: ['session'] })).toContain('--cookie must be name=value')
    expect(failure({ cookie: ['session=t0ken; Path=/'] })).not.toContain('t0ken')
    expect(failure({ viewport: '390' })).toContain('--viewport must be WIDTHxHEIGHT')
    expect(failure({ viewport: '0x844' })).toContain('--viewport')
    expect(failure({ viewport: '20000x10' })).toContain('--viewport')
    expect(failure({ device: 'Nokia 3310' })).toContain('Unknown device "Nokia 3310"')
    expect(failure({ device: 'iphone' })).toContain('Did you mean "iPhone')
    expect(failure({ colorScheme: 'sepia' })).toContain('--color-scheme must be light or dark')
    expect(failure({ browserLocale: 'not a tag' })).toContain('--browser-locale must be a BCP 47 language tag')
    expect(failure({ waitFor: ['load', 'networkidle'] })).toContain('--wait-for takes one load state')
    expect(failure({ waitFor: ['  '] })).toContain('--wait-for needs')
    expect(failure({ timeout: '0' })).toContain('--timeout must be a whole number of at least 1')
    expect(failure({ timeout: '1.5' })).toContain('--timeout')
  })

  it('check that a storage state file exists and looks like one', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rampa-state-'))
    const good = join(dir, 'auth.json')
    await writeFile(good, JSON.stringify({ cookies: [], origins: [] }))
    expect(parseBrowserFlags({ storageState: good })).toEqual({ storageState: good })

    expect(failure({ storageState: join(dir, 'missing.json') })).toContain('npx playwright codegen --save-storage=')
    const broken = join(dir, 'broken.json')
    await writeFile(broken, '{ not json')
    expect(failure({ storageState: broken })).toContain('Could not read the storage state')
    const other = join(dir, 'other.json')
    await writeFile(other, JSON.stringify({ token: 'x' }))
    expect(failure({ storageState: other })).toContain('is not a Playwright storage state')
  })
})

describe('contextOptions', () => {
  it('open the same 1280×800 desktop page as before when nothing is set', () => {
    expect(contextOptions()).toEqual({ viewport: { width: 1280, height: 800 }, bypassCSP: true })
    expect(contextOptions({})).toEqual({ viewport: DEFAULT_VIEWPORT, bypassCSP: true })
  })

  it('emulate a device on Chromium, with --viewport and --user-agent taking precedence', () => {
    const iphone = devices['iPhone 13']
    const options = contextOptions({ device: 'iPhone 13' })
    expect(options).toMatchObject({ viewport: iphone.viewport, userAgent: iphone.userAgent, deviceScaleFactor: 3, isMobile: true, hasTouch: true })
    expect(options).not.toHaveProperty('defaultBrowserType')
    expect(contextOptions({ device: 'iPhone 13', viewport: { width: 400, height: 900 }, userAgent: 'X' })).toMatchObject({
      viewport: { width: 400, height: 900 },
      userAgent: 'X',
      isMobile: true,
    })
  })

  it('pass color scheme, reduced motion, locale and the storage state on', () => {
    expect(contextOptions({ colorScheme: 'dark', reducedMotion: true, locale: 'pt-BR', storageState: 'auth.json' })).toEqual({
      viewport: DEFAULT_VIEWPORT,
      bypassCSP: true,
      colorScheme: 'dark',
      reducedMotion: 'reduce',
      locale: 'pt-BR',
      storageState: 'auth.json',
    })
  })
})

describe('header scope', () => {
  it('treats example.com and www.example.com, over http or https, as one site, and another port as another service', () => {
    expect(sameSite(new URL('https://www.example.com/a'), new URL('http://example.com/b'))).toBe(true)
    expect(sameSite(new URL('http://127.0.0.1:4000/'), new URL('http://127.0.0.1:4000/x'))).toBe(true)
    expect(sameSite(new URL('http://127.0.0.1:4000/'), new URL('http://127.0.0.1:5000/'))).toBe(false)
    expect(sameSite(new URL('https://example.com/'), new URL('https://example.com:8443/'))).toBe(false)
    expect(sameSite(new URL('https://example.com/'), new URL('https://cdn.example.com/'))).toBe(false)
    expect(sameSite(new URL('https://example.com/'), new URL('https://example.com.evil.net/'))).toBe(false)
  })

  it('gives headers to the site and to nobody else', () => {
    const options = { headers: { authorization: 'Bearer x' } }
    const sites = [new URL('https://example.com/')]
    expect(headersFor('https://www.example.com/robots.txt', sites, options)).toEqual({ authorization: 'Bearer x' })
    expect(headersFor('https://cdn.example.net/sitemap.xml', sites, options)).toBeUndefined()
    expect(headersFor('https://example.com/', sites, {})).toBeUndefined()
  })
})

describe('describeConditions', () => {
  it('records what was emulated, and the names of headers and cookies but never their values', () => {
    const conditions = describeConditions(
      parseBrowserFlags({ header: ['Authorization: Bearer s3cret'], cookie: ['session=t0ken'], device: 'iPhone 13', waitFor: ['#app', '200'] }),
    )
    expect(conditions).toMatchObject({
      device: 'iPhone 13',
      viewport: devices['iPhone 13'].viewport,
      headers: ['authorization'],
      cookies: ['session'],
      waitUntil: 'load',
      waitFor: ['#app', '200ms'],
    })
    expect(JSON.stringify(conditions)).not.toMatch(/s3cret|t0ken/)
  })
})
