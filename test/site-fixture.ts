import { type IncomingHttpHeaders, type IncomingMessage, type ServerResponse, createServer } from 'node:http'
import type { AddressInfo, Socket } from 'node:net'
import { gzipSync } from 'node:zlib'

/**
 * A small site on 127.0.0.1 for the crawl and browser tests: a home page and
 * linked pages that share a header (a logo link without a name, on every
 * page), a robots.txt that disallows /private/, a sitemap index, a page that
 * needs a cookie, and pages that show what the browser sent or emulated.
 * A second server on another port plays a third party the pages load from.
 */
export interface FixtureSite {
  origin: string
  thirdParty: string
  /** Every request, in order, on either server. */
  requests: Array<{ server: 'site' | 'third-party'; path: string; headers: IncomingHttpHeaders; at: number }>
  paths(): string[]
  close(): Promise<void>
}

export interface FixtureOptions {
  /** Replaces the default robots.txt; a number answers with that status instead. */
  robots?: string | number | undefined
}

const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')
const LOGO = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#0b7285"/></svg>'

const header = [
  '<header>',
  '<a href="/"><img src="/logo.svg" width="40" height="40"></a>',
  '<nav aria-label="Main"><a href="/">Home</a> <a href="/about">About</a> <a href="/pricing/">Pricing</a> ',
  '<a href="/blog">Blog</a> <a href="/members">Members</a> <a href="/private/secret">Secret</a></nav>',
  '</header>',
].join('')

function page(title: string, main: string, extra = { lang: 'en', head: '', withHeader: true }): string {
  // Without the viewport meta tag a phone lays the page out 980 px wide, as real phones do.
  const viewport = '<meta name="viewport" content="width=device-width, initial-scale=1">'
  return `<!doctype html><html lang="${extra.lang}"><head><meta charset="utf-8">${viewport}<title>${title}</title>${extra.head}</head><body>${extra.withHeader ? header : ''}<main>${main}</main></body></html>`
}

const plain = (title: string, main: string, head = '') => page(title, main, { lang: 'en', head, withHeader: false })

export async function startFixtureSite(options: FixtureOptions = {}): Promise<FixtureSite> {
  const requests: FixtureSite['requests'] = []
  const sockets = new Set<Socket>()

  const third = createServer((request, response) => {
    requests.push({ server: 'third-party', path: request.url ?? '', headers: request.headers, at: Date.now() })
    response.writeHead(200, { 'content-type': 'image/png', 'access-control-allow-origin': '*' })
    response.end(PNG_1X1)
  })
  const thirdOrigin = await listen(third, sockets)

  const site = createServer((request, response) => {
    requests.push({ server: 'site', path: request.url ?? '', headers: request.headers, at: Date.now() })
    route(request, response, origin, thirdOrigin, options)
  })
  const origin = await listen(site, sockets)

  return {
    origin,
    thirdParty: thirdOrigin,
    requests,
    paths: () => requests.filter((r) => r.server === 'site').map((r) => r.path),
    async close() {
      for (const socket of sockets) socket.destroy()
      await Promise.all([new Promise((resolve) => site.close(resolve)), new Promise((resolve) => third.close(resolve))])
    },
  }
}

async function listen(server: ReturnType<typeof createServer>, sockets: Set<Socket>): Promise<string> {
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

function route(request: IncomingMessage, response: ServerResponse, origin: string, thirdParty: string, options: FixtureOptions): void {
  const url = new URL(request.url ?? '/', origin)
  const html = (body: string, status = 200) => {
    response.writeHead(status, { 'content-type': 'text/html; charset=utf-8' })
    response.end(body)
  }
  const cookies = request.headers.cookie ?? ''

  switch (url.pathname) {
    case '/robots.txt': {
      if (typeof options.robots === 'number') {
        response.writeHead(options.robots, { 'content-type': 'text/plain' })
        response.end('unavailable')
        return
      }
      response.writeHead(200, { 'content-type': 'text/plain' })
      response.end(options.robots ?? `User-agent: *\nDisallow: /private/\n\nSitemap: ${origin}/sitemap.xml\n`)
      return
    }
    case '/sitemap.xml':
      response.writeHead(200, { 'content-type': 'application/xml' })
      response.end(
        `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>${origin}/sitemap-pages.xml.gz</loc></sitemap></sitemapindex>`,
      )
      return
    case '/sitemap-pages.xml.gz': {
      const entries = ['/', '/about', '/orphan', '/private/secret', '/pricing/']
        .map((path) => `<url><loc>${origin}${path}</loc><image:image><image:loc>${origin}/team.png</image:loc></image:image></url>`)
        .join('')
      const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">${entries}</urlset>`
      response.writeHead(200, { 'content-type': 'application/gzip' })
      response.end(gzipSync(xml))
      return
    }
    case '/logo.svg':
      response.writeHead(200, { 'content-type': 'image/svg+xml' })
      response.end(LOGO)
      return
    case '/team.png':
      response.writeHead(200, { 'content-type': 'image/png' })
      response.end(PNG_1X1)
      return
    case '/report.pdf':
      response.writeHead(200, { 'content-type': 'application/pdf' })
      response.end('%PDF-1.4')
      return
    case '/':
      html(
        page(
          'Home',
          '<h1>Home</h1><p>Welcome. Read <a href="/about#team">about the team</a>, the <a href="/report.pdf">annual report</a>, ' +
            '<a href="mailto:hi@example.com">mail us</a>, visit <a href="https://example.org/">another site</a> or <a href="/old">the old page</a>.</p>',
        ),
      )
      return
    case '/about':
      html(page('About', '<h1>About</h1><h2 id="team">Team</h2><p>We make ramps.</p><img src="/team.png" width="20" height="20">'))
      return
    case '/pricing/':
      html(page('Pricing', '<h1>Pricing</h1><p>Free for everyone.</p>'))
      return
    case '/blog':
      html(page('Blog', '<h1>Blog</h1><ul><li><a href="/blog/post-1">First post</a></li><li><a href="/broken">A broken link</a></li></ul><p><a href="/blog?page=2">Older posts</a></p>'))
      return
    case '/blog/post-1':
      html(page('First post', '<h1>First post</h1><p>Hello.</p>'))
      return
    case '/orphan':
      html(page('Orphan', '<h1>Only in the sitemap</h1><p>No page links here.</p>'))
      return
    case '/members':
      if (/(?:^|;\s*)session=ok(?:;|$)/.test(cookies)) html(page('Members', '<h1>Members</h1><p>Signed in.</p>'))
      else html(plain('Sign in', '<h1>Sign in required</h1>'), 401)
      return
    case '/private/secret':
      html(page('Secret', '<h1>Secret</h1>'))
      return
    case '/old':
      response.writeHead(301, { location: '/about' })
      response.end()
      return
    case '/to-gated':
      response.writeHead(302, { location: '/gated' })
      response.end()
      return
    case '/gated':
      if (request.headers['x-test'] === 'ok') html(plain('Gated', `<h1>Header received</h1><p>cookie: ${cookies || 'none'}</p>`))
      else html(plain('Gated', '<h1>No header</h1>'), 401)
      return
    case '/echo': {
      const language = (request.headers['accept-language'] ?? 'en').split(',')[0] ?? 'en'
      html(
        page(
          'Echo',
          `<h1>Echo</h1><p id="ua">${escape(request.headers['user-agent'] ?? '')}</p><p id="test">${escape(String(request.headers['x-test'] ?? 'none'))}</p>` +
            `<img src="${thirdParty}/pixel.png" alt="A pixel from a third party" width="1" height="1">`,
          { lang: escape(language), head: '', withHeader: false },
        ),
      )
      return
    }
    case '/dark':
      // Readable in light mode; dark gray on black in dark mode.
      html(
        plain(
          'Dark',
          '<h1>Night</h1><p>Read me in the dark.</p>',
          '<style>body{background:#fff;color:#111}@media (prefers-color-scheme: dark){body{background:#000;color:#222}}</style>',
        ),
      )
      return
    case '/motion':
      html(
        plain(
          'Motion',
          '<h1>Motion</h1><p id="animated">Spinning banner</p>',
          '<style>@media (prefers-reduced-motion: reduce){#animated{display:none}}</style>',
        ),
      )
      return
    case '/late':
      html(plain('Late', '<h1>Late</h1>', `<script>setTimeout(() => { const p = document.createElement('p'); p.id = 'late'; p.textContent = 'Arrived late'; document.querySelector('main').append(p) }, 1500)</script>`))
      return
    case '/slow':
      // Never answers: for --timeout.
      return
    default:
      html(plain('Not found', '<h1>Not found</h1>'), 404)
  }
}

function escape(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

export interface FakeJudge {
  /** Base URL for RAMPA_OPENAI_COMPATIBLE_URL. */
  url: string
  /** The user prompt of every judgment asked for. */
  prompts: string[]
  close(): Promise<void>
}

/**
 * A stand-in for a model behind the OpenAI-compatible chat completions API, on
 * 127.0.0.1: it answers each judgment from the prompt, so a crawl can run the
 * judgment layer without a model or a network.
 */
export async function startFakeJudge(answer: (system: string, user: string) => unknown): Promise<FakeJudge> {
  const prompts: string[] = []
  const sockets = new Set<Socket>()
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8')
    })
    request.on('end', () => {
      const parsed = JSON.parse(body || '{}') as { model?: string; messages?: Array<{ role: string; content: unknown }> }
      const text = (role: string) => {
        const content = parsed.messages?.find((message) => message.role === role)?.content
        if (typeof content === 'string') return content
        return Array.isArray(content) ? content.map((part: { text?: string }) => part.text ?? '').join('') : ''
      }
      prompts.push(text('user'))
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify({
          id: `chat_${prompts.length}`,
          object: 'chat.completion',
          created: 1,
          model: parsed.model ?? 'fake',
          choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(answer(text('system'), text('user'))) }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
        }),
      )
    })
  })
  const origin = await listen(server, sockets)
  return {
    url: `${origin}/v1`,
    prompts,
    async close() {
      for (const socket of sockets) socket.destroy()
      await new Promise((resolve) => server.close(resolve))
    },
  }
}
