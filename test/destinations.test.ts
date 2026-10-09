import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { followOptions } from '../src/cli/commands/check.ts'
import { headingsAndLabels } from '../src/criteria/headings-and-labels.ts'
import { linkPurpose } from '../src/criteria/link-purpose.ts'
import type { A11yNode } from '../src/snapshot/schema.ts'
import { USER_AGENT, destinationCache, followLinks, htmlFacts, instantRefresh, isPrivateHost } from '../src/surfaces/destinations.ts'
import { node } from './helpers.ts'

function link(ref: string, name: string, href: string, extra: Partial<A11yNode> = {}): A11yNode {
  return node({ ref, role: 'link', name, native: { tag: 'a', attributes: { href } }, ...extra })
}

function page(...children: A11yNode[]): A11yNode {
  return node({ ref: 'html', role: 'document', children: [node({ ref: 'body', native: { tag: 'body' }, children })] })
}

function html(title: string, body = ''): string {
  return `<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`
}

/** A fetch that answers from a table of routes and records every request. */
function stubFetch(routes: Record<string, () => Response>) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = []
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    const route = routes[url]
    return route ? route() : new Response('not here', { status: 404 })
  }) as typeof globalThis.fetch
  return { fetch, calls }
}

const htmlResponse = (body: string) => () => new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8' } })

describe('htmlFacts', () => {
  it('reads the title, the first h1 and the description, never from scripts or comments', () => {
    const facts = htmlFacts(
      `<html><head><title> Plans &amp; pricing | Acme </title><meta name="description" content="Compare the plans &ndash; monthly or yearly">
      <script>document.write("<h1>Not this</h1>")</script></head>
      <body><!-- <h1>Nor this</h1> --><h1>Pricing <img src="x.png" alt="for teams"></h1><h1>Second</h1></body></html>`,
    )
    expect(facts).toEqual({ title: 'Plans & pricing | Acme', heading: 'Pricing for teams', description: 'Compare the plans – monthly or yearly' })
  })

  it('falls back to Open Graph and decodes numeric and accented entities', () => {
    const facts = htmlFacts('<meta property="og:title" content="Pre&ccedil;os"><meta property="og:description" content="Planos &#233; &#x2013; tudo">')
    expect(facts).toMatchObject({ title: 'Preços', description: 'Planos é – tudo' })
  })

  it('reads the part a fragment points to: a heading by id, an anchor by name, or the words after an element', () => {
    const body = '<h2 id="refunds">Refunds <small>and returns</small></h2><p>Text</p><a name="old"></a><h3>Old prices</h3><section id="faq"><p>Questions people ask</p></section>'
    expect(htmlFacts(body, '#refunds').section).toBe('Refunds and returns')
    expect(htmlFacts(body, '#old').section).toBe('Old prices')
    expect(htmlFacts(body, '#faq').section).toBe('Questions people ask')
    expect(htmlFacts('<h2 id="café">Café menu</h2>', '#caf%C3%A9').section).toBe('Café menu')
    expect(htmlFacts(body, '#missing').section).toBeUndefined()
  })

  it('finds an instant refresh, the only kind that counts as a redirect', () => {
    expect(instantRefresh(`<meta http-equiv="refresh" content="0; URL='index.html'">`)).toBe('index.html')
    expect(instantRefresh('<meta http-equiv="Refresh" content="0;url=/next">')).toBe('/next')
    expect(instantRefresh(`<meta http-equiv="refresh" content="30; URL='index.html'">`)).toBeUndefined()
    expect(instantRefresh('<meta http-equiv="refresh" content="0">')).toBeUndefined()
  })
})

describe('isPrivateHost', () => {
  it('knows loopback, private and link-local addresses and local names', () => {
    for (const host of ['localhost', 'app.localhost', 'printer.local', 'metadata.google.internal', '127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.0.2', '169.254.169.254', '[::1]', 'fd00::1', '::ffff:10.0.0.1']) {
      expect(isPrivateHost(host), host).toBe(true)
    }
    for (const host of ['example.com', '8.8.8.8', '172.32.0.1', '2606:4700::6812:1613']) expect(isPrivateHost(host), host).toBe(false)
  })
})

describe('followLinks', () => {
  const base = 'https://shop.test/news/index.html'

  it('reads same-origin links by default policy and other sites only with all', async () => {
    const { fetch, calls } = stubFetch({
      'https://shop.test/pricing': htmlResponse(html('Pricing | Shop', '<h1>Plans</h1>')),
      'https://other.test/blog': htmlResponse(html('Other blog')),
    })
    const root = page(link('a1', 'Pricing', '/pricing'), link('a2', 'Partner blog', 'https://other.test/blog'))
    expect(await followLinks(root, base, { policy: 'none', fetch })).toEqual({})
    const same = await followLinks(root, base, { policy: 'same-origin', fetch })
    expect(same).toEqual({ '/pricing': expect.objectContaining({ kind: 'page', status: 200, title: 'Pricing | Shop', heading: 'Plans' }) })
    const all = await followLinks(root, base, { policy: 'all', fetch })
    expect(Object.keys(all)).toEqual(['/pricing', 'https://other.test/blog'])
    expect(calls.map((call) => call.url)).toContain('https://other.test/blog')
  })

  it('asks as a stranger: a named user agent, no cookies, redirects handled by hand', async () => {
    const { fetch, calls } = stubFetch({ 'https://shop.test/pricing': htmlResponse(html('Pricing')) })
    await followLinks(page(link('a1', 'Pricing', '/pricing')), base, { policy: 'same-origin', fetch })
    const headers = calls[0]?.init?.headers as Record<string, string>
    expect(headers['user-agent']).toBe(USER_AGENT)
    expect(USER_AGENT).toMatch(/^Rampa\/.*github\.com\/guilhermebsantiago\/rampa-cli/)
    expect(Object.keys(headers).map((h) => h.toLowerCase())).not.toContain('cookie')
    expect(calls[0]?.init?.redirect).toBe('manual')
  })

  it('leaves "#part" links to the snapshot, marks a spelled-out address of the page itself, and skips hidden or unnamed links', async () => {
    const { fetch, calls } = stubFetch({})
    const root = page(
      link('a1', 'Top', '#top'),
      link('a2', 'This page', 'https://shop.test/news/index.html#latest'),
      link('a3', 'Hidden', '/hidden', { states: ['hidden'] }),
      link('a4', '', '/no-name'),
      link('a5', 'Email us', 'mailto:hi@shop.test'),
    )
    expect(await followLinks(root, base, { policy: 'all', fetch })).toEqual({ 'https://shop.test/news/index.html#latest': { kind: 'same-page' } })
    expect(calls).toHaveLength(0)
  })

  it('follows redirects and instant refreshes, and records where the address ended', async () => {
    const { fetch } = stubFetch({
      'https://shop.test/old-pricing': () => new Response(null, { status: 301, headers: { location: '/plans' } }),
      'https://shop.test/plans': htmlResponse(html('Plans')),
      'https://shop.test/moved': htmlResponse(`<meta http-equiv="refresh" content="0; URL='/plans'"><title>Redirecting</title>`),
    })
    const found = await followLinks(page(link('a1', 'Pricing', '/old-pricing'), link('a2', 'Plans', '/moved')), base, { policy: 'same-origin', fetch })
    expect(found['/old-pricing']).toMatchObject({ kind: 'page', title: 'Plans', finalUrl: 'https://shop.test/plans' })
    expect(found['/moved']).toMatchObject({ kind: 'page', title: 'Plans', finalUrl: 'https://shop.test/plans' })
  })

  it('reads nothing from a sign-in wall, a redirect to the home page or a missing page', async () => {
    const { fetch } = stubFetch({
      'https://shop.test/account': () => new Response(null, { status: 302, headers: { location: '/users/sign_in?next=/account' } }),
      'https://shop.test/users/sign_in?next=/account': htmlResponse(html('Sign in')),
      'https://shop.test/campaign': () => new Response(null, { status: 302, headers: { location: '/' } }),
      'https://shop.test/': htmlResponse(html('Shop')),
      'https://shop.test/private': () => new Response('no', { status: 401 }),
    })
    const root = page(link('a1', 'My orders', '/account'), link('a2', 'Summer sale', '/campaign'), link('a3', 'Gone', '/gone'), link('a4', 'Staff', '/private'))
    const found = await followLinks(root, base, { policy: 'same-origin', fetch })
    expect(found['/account']).toMatchObject({ kind: 'unreadable', reason: 'sign-in' })
    expect(found['/campaign']).toMatchObject({ kind: 'unreadable', reason: 'redirects to the home page' })
    expect(found['/gone']).toMatchObject({ kind: 'unreadable', reason: 'not found', status: 404 })
    expect(found['/private']).toMatchObject({ kind: 'unreadable', reason: 'sign-in', status: 401 })
  })

  it('records a file by its type and size without reading it', async () => {
    const { fetch } = stubFetch({
      'https://shop.test/report.pdf': () => new Response('%PDF-1.7', { headers: { 'content-type': 'application/pdf', 'content-length': '1677722' } }),
    })
    const found = await followLinks(page(link('a1', 'Annual report', '/report.pdf')), base, { policy: 'same-origin', fetch })
    expect(found['/report.pdf']).toEqual(expect.objectContaining({ kind: 'file', contentType: 'application/pdf', bytes: 1677722 }))
  })

  it('gives up on a slow address and never follows a public page into a private network', async () => {
    const timeout = (() => Promise.reject(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }))) as unknown as typeof fetch
    const slow = await followLinks(page(link('a1', 'Docs', '/docs')), base, { policy: 'same-origin', fetch: timeout })
    expect(slow['/docs']).toEqual(expect.objectContaining({ kind: 'unreadable', reason: 'timeout' }))

    const { fetch, calls } = stubFetch({
      'https://shop.test/out': () => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } }),
    })
    const root = page(link('a1', 'Admin', 'http://192.168.0.1/'), link('a2', 'Out', '/out'))
    const found = await followLinks(root, base, { policy: 'all', fetch })
    expect(found['http://192.168.0.1/']).toBeUndefined()
    expect(found['/out']).toMatchObject({ kind: 'unreadable', reason: 'redirects to a private address' })
    expect(calls.map((call) => call.url)).toEqual(['https://shop.test/out'])
  })

  it('stops asking a site that answers 429 for the rest of the run', async () => {
    const { fetch, calls } = stubFetch({ 'https://shop.test/a': () => new Response('slow down', { status: 429 }) })
    const cache = destinationCache()
    const found = await followLinks(page(link('a1', 'A', '/a'), link('a2', 'B', '/b')), base, { policy: 'same-origin', fetch, cache, limits: { concurrency: 1 } })
    expect(found['/a']).toMatchObject({ kind: 'unreadable', status: 429 })
    expect(found['/b']).toMatchObject({ kind: 'unreadable', reason: 'the site asked to slow down' })
    expect(calls).toHaveLength(1)
  })

  it('reads at most maxLinks addresses, the content before the menus', async () => {
    const { fetch, calls } = stubFetch({})
    const nav = node({ ref: 'nav', role: 'navigation', children: [link('n1', 'Home', '/'), link('n2', 'Blog', '/blog')] })
    const root = page(nav, link('a1', 'Story', '/story'), link('a2', 'Other story', '/other'))
    const found = await followLinks(root, base, { policy: 'same-origin', fetch, limits: { maxLinks: 3, concurrency: 1 } })
    expect(Object.keys(found)).toEqual(['/story', '/other', '/'])
    expect(calls).toHaveLength(3)
  })

  it('reads an address once per run, however many pages link to it', async () => {
    const { fetch, calls } = stubFetch({ 'https://shop.test/pricing': htmlResponse(html('Pricing')) })
    const cache = destinationCache()
    await followLinks(page(link('a1', 'Pricing', '/pricing')), base, { policy: 'same-origin', fetch, cache })
    await followLinks(page(link('a1', 'Plans', 'https://shop.test/pricing')), 'https://shop.test/other.html', { policy: 'same-origin', fetch, cache })
    expect(calls).toHaveLength(1)
  })
})

describe('when rampa check follows links', () => {
  it('only when a criterion compares links with their destinations and the judgment layer runs', () => {
    const cache = destinationCache()
    expect(followOptions('same-origin', true, [linkPurpose], cache)).toEqual({ policy: 'same-origin', cache })
    expect(followOptions('same-origin', false, [linkPurpose], cache)).toBeUndefined()
    expect(followOptions('none', true, [linkPurpose], cache)).toBeUndefined()
    expect(followOptions('all', true, [headingsAndLabels], cache)).toBeUndefined()
  })
})

describe('destinationCache on disk', () => {
  it('keeps what a public page returned for an hour, and nothing that may change by the next run', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rampa-destinations-'))
    const page = { kind: 'page' as const, status: 200, title: 'Pricing' }
    let loads = 0
    const load = (value: typeof page | { kind: 'unreadable'; status?: number; reason: string }) => async () => {
      loads++
      return value
    }
    await destinationCache({ dir }).read('https://shop.test/pricing', load(page))
    await destinationCache({ dir }).read('https://shop.test/busy', load({ kind: 'unreadable', status: 429, reason: 'HTTP 429' }))
    await destinationCache({ dir }).read('https://shop.test/slow', load({ kind: 'unreadable', reason: 'timeout' }))
    await destinationCache({ dir }).read('http://localhost:4321/pricing', load(page))
    expect(await readdir(dir)).toHaveLength(1)

    expect(await destinationCache({ dir }).read('https://shop.test/pricing', load({ kind: 'unreadable', reason: 'should not load' }))).toEqual(page)
    expect(loads).toBe(4)
    await destinationCache({ dir, ttlMs: -1 }).read('https://shop.test/pricing', load(page))
    expect(loads).toBe(5)
  })
})

describe('followLinks on local files', () => {
  it('reads local pages and files next to a local page, never outside the allowed folders', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rampa-site-'))
    const site = join(root, 'site')
    await mkdir(join(site, 'docs'), { recursive: true })
    await mkdir(join(root, 'outside'), { recursive: true })
    await writeFile(join(site, 'index.html'), html('Home'))
    await writeFile(join(site, 'shipping.html'), html('Shipping and returns | Shop', '<h1>Shipping</h1><h2 id="refunds">Refunds</h2>'))
    await writeFile(join(site, 'prices.csv'), 'item,price\nmug,14\n')
    await writeFile(join(site, 'docs', 'index.html'), html('Docs'))
    await writeFile(join(root, 'outside', 'secret.html'), html('Secret'))
    const base = pathToFileURL(join(site, 'index.html')).href
    const tree = page(
      link('a1', 'Shipping', 'shipping.html#refunds'),
      link('a2', 'Prices', 'prices.csv'),
      link('a3', 'Docs', 'docs/'),
      link('a4', 'Missing', 'missing.html'),
      link('a5', 'Secret', '../outside/secret.html'),
      link('a6', 'Web', 'https://shop.test/'),
    )
    const found = await followLinks(tree, base, { policy: 'same-origin', roots: [site] })
    expect(found['shipping.html#refunds']).toEqual(
      expect.objectContaining({ kind: 'page', title: 'Shipping and returns | Shop', heading: 'Shipping', section: 'Refunds' }),
    )
    expect(found['prices.csv']).toEqual(expect.objectContaining({ kind: 'file', contentType: 'text/csv', bytes: 18 }))
    expect(found['docs/']).toEqual(expect.objectContaining({ kind: 'page', title: 'Docs' }))
    expect(found['missing.html']).toEqual(expect.objectContaining({ kind: 'unreadable', reason: 'not found' }))
    expect(found['../outside/secret.html']).toBeUndefined()
    expect(found['https://shop.test/']).toBeUndefined()
    // A recording of a local page must not carry the machine's paths.
    expect(JSON.stringify(found)).not.toContain(root.replaceAll('\\', '/'))
    expect(JSON.stringify(found)).not.toContain(root.replaceAll('\\', '\\\\'))
  })
})
