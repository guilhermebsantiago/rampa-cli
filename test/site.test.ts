import { describe, expect, it } from 'vitest'
import { memoryCache } from '../src/core/cache.ts'
import { type CheckOptions, checkSnapshot } from '../src/core/check.ts'
import { type SitePage, type SiteReport, countReuse, findingSignatures, normalizeStartTag, siteExitCode, summarizeSite } from '../src/core/site.ts'
import type { Finding, Report } from '../src/core/types.ts'
import { languageOfParts } from '../src/criteria/language-of-parts.ts'
import { paint } from '../src/report/color.ts'
import { renderSiteReport } from '../src/report/site.ts'
import type { A11ySnapshot } from '../src/snapshot/schema.ts'
import { describeConditions } from '../src/surfaces/browser-options.ts'
import { node, passingEngine, scriptedProvider, travelSnapshot } from './helpers.ts'

const ORIGIN = 'https://example.com'
const u = (path: string) => `${ORIGIN}${path}`

function snapshotWith(target: string, children: A11ySnapshot['root']['children']): A11ySnapshot {
  return {
    schemaVersion: 1,
    surface: 'web',
    target,
    locale: 'en',
    viewport: { width: 1280, height: 800, scale: 1 },
    collectedAt: '2026-10-08T00:00:00.000Z',
    collector: { name: 'test', version: '0' },
    root: node({ ref: 'html', role: 'document', lang: 'en', native: { tag: 'html', html: '<html lang="en">' }, children }),
  }
}

function finding(partial: Partial<Finding> & { criterion: string; message: string }): Finding {
  return { fingerprint: `fp-${partial.ref ?? 'x'}-${partial.message.length}`, level: 'A', source: 'engine', confidence: 'high', ...partial }
}

function report(target: string, findings: Finding[], extra: Partial<Report> = {}): Report {
  return {
    schemaVersion: 1,
    rampaVersion: 'test',
    createdAt: '2026-10-08T00:00:00.000Z',
    target,
    surface: 'web',
    locale: 'en',
    llm: 'off',
    engine: { name: 'axe-core', version: '4.14.0' },
    findings,
    belowThreshold: [],
    waived: [],
    discarded: [],
    criteria: [],
    coverage: { engine: ['1.1.1'], judged: [], notChecked: [] },
    usage: { calls: 0, cachedCalls: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0 },
    errors: [],
    ...extra,
  }
}

describe('finding signatures', () => {
  it('ignore what changes from page to page on the same component', () => {
    expect(normalizeStartTag('<A Href="/about" class="nav active" aria-current="page" id=":r1:" data-x=1>')).toBe('<a href="/about">')
    expect(normalizeStartTag('<img alt="" src="/logo.svg" style="width: 40px">')).toBe('<img alt="" src="/logo.svg">')
    expect(normalizeStartTag('<label for="email-17">')).toBe('<label>')
  })

  it('match a header link on two pages whatever its CSS path, and tell different links apart', () => {
    const link = (ref: string, html: string, name: string) =>
      node({ ref, role: 'link', name, text: name, native: { tag: 'a', attributes: { href: '/about' }, html } })
    const home = snapshotWith(u('/'), [link('html > body > header > nav > a:nth-of-type(2)', '<a href="/about" class="nav active" aria-current="page">About</a>', 'About')])
    const blog = snapshotWith(u('/blog'), [
      link('#top > nav > a:nth-of-type(2)', '<a class="nav" href="/about">About</a>', 'About'),
      link('main > a', '<a href="/about">About us</a>', 'About us'),
    ])
    const message = (name: string) => `The link text "${name}" does not tell where the link goes.`
    const [onHome] = findingSignatures([finding({ criterion: '2.4.4', source: 'judgment', ref: 'html > body > header > nav > a:nth-of-type(2)', message: message('About') })], home)
    const onBlog = findingSignatures(
      [
        finding({ criterion: '2.4.4', source: 'judgment', ref: '#top > nav > a:nth-of-type(2)', message: message('About') }),
        finding({ criterion: '2.4.4', source: 'judgment', ref: 'main > a', message: message('About us') }),
      ],
      blog,
    )
    expect(onBlog[0]).toBe(onHome)
    expect(onBlog[1]).not.toBe(onHome)
  })

  it('tell page-level findings apart by their message, not by the text of the whole page', () => {
    const one = snapshotWith(u('/'), [node({ ref: 'p', role: 'paragraph', text: 'Olá, mundo' })])
    const two = snapshotWith(u('/b'), [node({ ref: 'p', role: 'paragraph', text: 'Outra página inteira' })])
    const wrongLang = finding({ criterion: '3.1.1', source: 'judgment', ref: 'html', message: 'The page is marked lang="en", but most of its text is in Portuguese (pt).' })
    expect(findingSignatures([wrongLang], one)).toEqual(findingSignatures([wrongLang], two))
  })

  it('resolve addresses against the page, so a component on a page in a subfolder matches its twin', () => {
    const image = (src: string) => node({ ref: 'nav img', role: 'img', native: { tag: 'img', attributes: { src }, html: `<img src="${src}">` } })
    const alt = finding({ criterion: '1.1.1', ruleId: 'image-alt', ref: 'nav img', message: 'Images must have alternative text' })
    const home = findingSignatures([alt], snapshotWith(u('/before/home.html'), [image('img/logo.gif')]))
    expect(findingSignatures([alt], snapshotWith(u('/before/annotated/home.html'), [image('../img/logo.gif')]))).toEqual(home)
    expect(findingSignatures([alt], snapshotWith(u('/before/annotated/home.html'), [image('img/logo.gif')]))).not.toEqual(home)
    expect(normalizeStartTag('<a href="#main">', u('/a'))).toBe('<a href="#main">')
    expect(normalizeStartTag('<a href="../b?x=1">', u('/a/c'))).toBe('<a href="/b?x=1">')
    expect(normalizeStartTag('<a href="https://cdn.example.net/x">', u('/a'))).toBe('<a href="https://cdn.example.net/x">')
  })

  it('fall back to the engine markup when the element is not in the snapshot', () => {
    const empty = snapshotWith(u('/'), [])
    const a = finding({ criterion: '1.4.3', ruleId: 'color-contrast', message: 'Contrast', html: '<span class="x">Sale</span>' })
    const b = finding({ criterion: '1.4.3', ruleId: 'color-contrast', message: 'Contrast', html: '<span class="y">Sale</span>' })
    const c = finding({ criterion: '1.4.3', ruleId: 'color-contrast', message: 'Contrast', html: '<span>New</span>' })
    const [sa, sb, sc] = findingSignatures([a, b, c], empty)
    expect(sa).toBe(sb)
    expect(sa).not.toBe(sc)
  })
})

describe('summarizeSite', () => {
  const logo = finding({ criterion: '1.1.1', ruleId: 'image-alt', ref: 'header img', message: 'Images must have alternative text', fingerprint: 'logo' })
  const team = finding({ criterion: '1.1.1', ruleId: 'image-alt', ref: 'main img', message: 'Images must have alternative text', fingerprint: 'team' })
  const pages: SitePage[] = [
    { url: u('/'), report: report(u('/'), [logo], { usage: { calls: 3, cachedCalls: 0, inputTokens: 300, outputTokens: 60, latencyMs: 10 } }), signatures: ['S-logo'] },
    {
      url: u('/about'),
      report: report(u('/about'), [team, logo], { coverage: { engine: ['1.1.1', '4.1.2'], judged: ['2.4.4'], notChecked: [] } }),
      signatures: ['S-team', 'S-logo'],
    },
    { url: u('/pricing'), report: report(u('/pricing'), [], { usage: { calls: 0, cachedCalls: 3, inputTokens: 300, outputTokens: 60, latencyMs: 0 } }), signatures: [] },
  ]

  it('reports a finding repeated on several pages once, and keeps the rest per page', () => {
    const summary = summarizeSite(pages, 3)
    expect(summary.repeated).toHaveLength(1)
    expect(summary.repeated[0]).toMatchObject({
      signature: 'S-logo',
      criterion: '1.1.1',
      pages: [u('/'), u('/about')],
      occurrences: [
        { page: 0, finding: 0 },
        { page: 1, finding: 1 },
      ],
      fingerprints: ['logo'],
    })
    expect(summary.pageSpecific).toEqual([
      { url: u('/'), findings: [] },
      { url: u('/about'), findings: [0] },
      { url: u('/pricing'), findings: [] },
    ])
    expect(summary.findings).toEqual({ total: 3, repeated: 2, pageSpecific: 1 })
  })

  it('adds up the usage and joins the coverage of every page', () => {
    const summary = summarizeSite(pages, 3)
    expect(summary.usage).toEqual({ calls: 3, cachedCalls: 3, inputTokens: 600, outputTokens: 120, latencyMs: 10, reusedAcrossPages: 3 })
    expect(summary.coverage.engine).toEqual(['1.1.1', '4.1.2'])
    expect(summary.coverage.judged).toEqual(['2.4.4'])
    expect(summary.coverage.notChecked).toHaveLength(47)
  })
})

describe('the judgment cache across pages', () => {
  const check = (cache: CheckOptions['cache'], provider: CheckOptions['provider']) => (target: string) =>
    checkSnapshot({ ...travelSnapshot(), target }, passingEngine(), {
      criteria: [languageOfParts],
      llm: true,
      provider,
      runs: 1,
      cache,
      offline: false,
      locale: 'en',
      minConfidence: 'medium',
      concurrency: 1,
    })
  const dutchFail = { verdict: 'fail', detectedLanguage: 'nl', evidence: 'Het weer is vandaag mooi', exception: 'none', confidence: 'high' }
  const portuguesePass = { verdict: 'pass', detectedLanguage: 'pt', evidence: 'Bem-vindo à feira', exception: 'none', confidence: 'high' }

  it('asks the model once for an input that repeats on later pages, and counts the calls it saved', async () => {
    const provider = scriptedProvider({ blockquote: [dutchFail], 'p.sign': [portuguesePass] })
    const cache = countReuse(memoryCache())
    const judge = check(cache, provider)
    cache.page = 0
    const first = await judge(u('/'))
    cache.page = 1
    const second = await judge(u('/about'))
    cache.page = 2
    const third = await judge(u('/blog'))
    expect(provider.calls).toBe(2)
    expect(first.usage).toMatchObject({ calls: 2, cachedCalls: 0 })
    expect(second.usage).toMatchObject({ calls: 0, cachedCalls: 2 })
    expect(third.findings).toHaveLength(1)
    expect(cache.reused).toBe(4)
  })

  it('counts a hit from an earlier run as cached, and as reused only when it repeats on a later page', async () => {
    const inner = memoryCache()
    await check(inner, scriptedProvider({ blockquote: [dutchFail], 'p.sign': [portuguesePass] }))(u('/'))
    const cache = countReuse(inner)
    const provider = scriptedProvider({})
    provider.id = 'test:scripted'
    cache.page = 0
    await check(cache, provider)(u('/'))
    expect(cache.reused).toBe(0)
    cache.page = 1
    await check(cache, provider)(u('/about'))
    expect(provider.calls).toBe(0)
    expect(cache.reused).toBe(2)
  })
})

function siteReport(pages: SitePage[], extra: Partial<SiteReport> = {}): SiteReport {
  return {
    schemaVersion: 1,
    kind: 'site',
    rampaVersion: 'test',
    createdAt: '2026-10-08T00:00:00.000Z',
    site: ORIGIN,
    start: [{ requested: u('/'), url: u('/') }],
    crawl: {
      mode: 'links',
      maxPages: 3,
      maxDepth: undefined,
      concurrency: 2,
      include: [],
      exclude: [],
      ignoreQuery: false,
      robots: { url: u('/robots.txt'), status: 'parsed', group: '*' },
      sitemaps: [],
      sitemapErrors: [],
    },
    browser: describeConditions({}),
    locale: 'en',
    llm: 'off',
    engine: { name: 'axe-core', version: '4.14.0' },
    notChecked: [],
    notLoaded: 0,
    beyondDepth: 0,
    summary: summarizeSite(pages, 0),
    pages: pages.map((page) => page.report),
    ...extra,
  }
}

describe('renderSiteReport', () => {
  const logo = finding({ criterion: '1.1.1', ruleId: 'image-alt', ref: 'header img', message: 'Images must have alternative text' })
  const team = finding({ criterion: '1.1.1', ruleId: 'image-alt', ref: 'main img', message: 'Images must have alternative text' })
  const pages: SitePage[] = [
    { url: u('/'), report: report(u('/'), [logo]), signatures: ['S-logo'] },
    { url: u('/about'), report: report(u('/about'), [logo, team]), signatures: ['S-logo', 'S-team'] },
    { url: u('/pricing'), report: report(u('/pricing'), [logo]), signatures: ['S-logo'] },
  ]
  const render = (site: SiteReport) => renderSiteReport(site, { verbose: false, paint: paint(false) })

  it('shows a repeated finding once with its pages, then what is particular to each page', () => {
    const text = render(
      siteReport(pages, {
        notChecked: [
          { url: u('/private/a'), reason: 'robots', from: u('/') },
          { url: u('/broken'), reason: 'http', detail: 'HTTP 404', from: u('/about') },
          { url: u('/app'), reason: 'off-site', detail: 'https://login.example.net/' },
          { url: u('/orphan.pdf'), reason: 'not-html', detail: 'application/pdf', from: 'sitemap' },
        ],
        notLoaded: 2,
      }),
    )
    expect(text).toContain('Site https://example.com · 3 page(s) checked')
    expect(text).toContain('Crawl: links from / · up to 3 pages · robots.txt: rules for every crawler')
    expect(text).toContain('On several pages, most likely a shared component: fix it once')
    expect(text).toContain('on 3 of 3 pages: /, /about, /pricing')
    expect(text).toMatch(/Page by page\n\/about\n {2}WCAG 1\.1\.1 \(A\) — Non-text Content\n {4}✗ main img/)
    expect(text).toContain('Nothing found only on: /, /pricing')
    expect(text).toMatch(/ {2}\/private\/a +robots\.txt disallows it · linked from \/\n/)
    expect(text).toContain('HTTP 404 · linked from /about')
    expect(text).toContain('led to another site: https://login.example.net/')
    expect(text).toContain('not an HTML page (application/pdf) · in the sitemap')
    expect(text).toContain('2 more page(s) found and not loaded (--max-pages 3)')
    expect(text).toMatch(/Pages: +3 checked of 9 found/)
    expect(text).toContain('This report does not declare the site accessible.')
    expect(text.indexOf('header img')).toBe(text.lastIndexOf('header img'))
  })

  it('says how the browser was set up, what the model calls cost and what was reused', () => {
    const summary = summarizeSite(pages, 2)
    summary.usage = { ...summary.usage, calls: 1, cachedCalls: 2, inputTokens: 300, outputTokens: 60 }
    const text = render(
      siteReport(pages, {
        model: 'ollama:gemma4:12b',
        summary,
        browser: describeConditions({ device: 'iPhone 13', colorScheme: 'dark', storageState: 'auth.json', headers: { authorization: 'x' } }),
      }),
    )
    expect(text).toContain('Browser: iPhone 13 (390×664) · dark color scheme · storage state · headers authorization')
    expect(text).toContain('Model calls: 1 new, 2 from cache · 0.3k in / 0.1k out tokens · 2 reused from an earlier page with the same input · local model, no API cost')
  })

  it('prints engine findings that share rule, message and pages as one block that lists the elements', () => {
    const image = (ref: string) => finding({ criterion: '1.1.1', ruleId: 'image-alt', ref, message: 'Images must have alternative text' })
    const nav = [image('nav a:nth-of-type(1) > img'), image('nav a:nth-of-type(2) > img')]
    const text = render(
      siteReport([
        { url: u('/'), report: report(u('/'), [...nav, image('footer img')]), signatures: ['A', 'B', 'C'] },
        { url: u('/about'), report: report(u('/about'), nav), signatures: ['A', 'B'] },
        { url: u('/blog'), report: report(u('/blog'), [...nav, image('footer img')]), signatures: ['A', 'B', 'C'] },
      ]),
    )
    const block = (refs: string[], pages: string) => [...refs.map((ref) => `  ✗ ${ref}`), '    Images must have alternative text', '    high · rule image-alt', `    ${pages}`].join('\n')
    expect(text).toContain(block(['nav a:nth-of-type(1) > img', 'nav a:nth-of-type(2) > img'], 'on 3 of 3 pages: /, /about, /blog'))
    expect(text).toContain(block(['footer img'], 'on 2 of 3 pages: /, /blog'))
  })

  it('shortens long page lists and speaks Portuguese', () => {
    const many: SitePage[] = Array.from({ length: 12 }, (_, i) => ({ url: u(`/p${i}`), report: report(u(`/p${i}`), [logo], { locale: 'pt-BR' }), signatures: ['S-logo'] }))
    const text = render(siteReport(many, { locale: 'pt-BR' }))
    expect(text).toContain('Em várias páginas, provavelmente um componente compartilhado: corrija uma vez')
    expect(text).toContain('em 12 de 12 páginas: /p0, /p1, /p2, /p3, /p4, /p5, /p6 e mais 5')
    expect(text).toContain('Este relatório não declara o site acessível.')
  })

  it('says so when no page could be checked, and why', () => {
    const text = render(
      siteReport([], {
        crawl: { ...siteReport([]).crawl, robots: { url: u('/robots.txt'), status: 'unreachable', group: 'none', detail: 'HTTP 503' } },
        notChecked: [{ url: u('/'), reason: 'robots', detail: 'HTTP 503' }],
      }),
    )
    expect(text).toContain('No page could be checked.')
    expect(text).toContain('robots.txt at https://example.com/robots.txt could not be read (HTTP 503), so nothing was crawled')
  })
})

describe('siteExitCode', () => {
  const clean = siteReport([{ url: u('/'), report: report(u('/'), []), signatures: [] }])
  const failing = siteReport([{ url: u('/'), report: report(u('/'), [finding({ criterion: '1.1.1', message: 'x' })]), signatures: ['s'] }])

  it('follows the check policy, and fails a site with no page checked', () => {
    expect(siteExitCode([clean], 'confirmed')).toBe(0)
    expect(siteExitCode([clean, failing], 'confirmed')).toBe(1)
    expect(siteExitCode([failing], 'never')).toBe(0)
    expect(siteExitCode([siteReport([])], 'never')).toBe(2)
    expect(siteExitCode([], 'confirmed')).toBe(2)
    const below = siteReport([{ url: u('/'), report: report(u('/'), [], { belowThreshold: [finding({ criterion: '2.4.4', message: 'y' })] }), signatures: [] }])
    expect(siteExitCode([below], 'confirmed')).toBe(0)
    expect(siteExitCode([below], 'any')).toBe(1)
  })
})
