import { type ServerResponse, createServer } from 'node:http'
import type { AddressInfo, Socket } from 'node:net'

/**
 * A small site on 127.0.0.1 for 3.2.4 Consistent Identification, with what 2.4.2 and 2.4.5 read across pages: six
 * English pages that share a header (logo, search form, sign-in link, cart, language link, theme toggle, menu button
 * drawn with an svg), a main navigation, and a footer (newsletter form, privacy link, site map link, back to top).
 *
 * Negative controls, the same in both variants: the cart's count changes ("Cart (0)", "Cart (2)"), the sign-in link
 * carries the page's address (`/login?next=/about`), the share link carries it too, the Portuguese link leads to each
 * page's own version, and two blog posts share a title (2.4.2 needs review). The `inconsistent` variant renames
 * components on /about: the search button "Find", the sign-in link "Sign in", the newsletter button "Sign up", the svg
 * menu button "Navigation" (grouped only by its icon: needs review or a model), and its privacy link leads to
 * /legal/privacy; and on /products the theme toggle says "Toggle dark mode" (shares words: needs review).
 */
export type IdentificationVariant = 'consistent' | 'inconsistent'

export interface IdentificationSite {
  origin: string
  close(): Promise<void>
}

const MENU_ICON = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M1 3h14M1 8h14M1 13h14" stroke="black"/></svg>'

interface Names {
  search: string
  login: string
  subscribe: string
  menu: string
  theme: string
  privacy: string
}

const CONSISTENT: Names = { search: 'Search', login: 'Log in', subscribe: 'Subscribe', menu: 'Menu', theme: 'Dark mode', privacy: '/privacy' }

function page(path: string, title: string, main: string, names: Names = CONSISTENT, cart = 0): string {
  return [
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body id="top">`,
    '<header>',
    '<a href="/"><img src="/logo.png" alt="Acme" width="20" height="20"></a>',
    `<form role="search" action="/search"><label>Search the site <input type="search" name="q"></label><button>${names.search}</button></form>`,
    `<a href="/login?next=${encodeURIComponent(path)}">${names.login}</a>`,
    `<a href="/cart">Cart (${cart})</a>`,
    `<a href="/pt${path === '/' ? '/' : path}" hreflang="pt-BR" lang="pt-BR">Português</a>`,
    `<button type="button" id="theme-toggle">${names.theme}</button>`,
    `<button type="button" aria-label="${names.menu}">${MENU_ICON}</button>`,
    '<nav aria-label="Main"><ul><li><a href="/">Home</a></li><li><a href="/products">Products</a></li><li><a href="/about">About</a></li><li><a href="/blog">Blog</a></li></ul></nav>',
    '</header>',
    `<main><h1>${title.replace(/ · Acme$/, '')}</h1>${main}`,
    `<p><a href="https://twitter.com/intent/tweet?url=${encodeURIComponent(`http://acme.test${path}`)}&amp;text=${encodeURIComponent(title)}">Share on X</a></p></main>`,
    '<footer>',
    `<form action="/newsletter" method="post"><label>Your e-mail <input type="email" name="email"></label><button>${names.subscribe}</button></form>`,
    `<ul><li><a href="${names.privacy}">Privacy</a></li><li><a href="/sitemap">Site map</a></li><li><a href="#top">Back to top</a></li></ul>`,
    '</footer>',
    '</body></html>',
  ].join('')
}

function route(path: string, variant: IdentificationVariant): string | undefined {
  const odd = variant === 'inconsistent'
  switch (path) {
    case '/':
      return page(path, 'Home · Acme', '<p>Acme makes ramps for every step.</p>')
    case '/products':
      return page(path, 'Products · Acme', '<p>Ramps, rails and lifts.</p>', odd ? { ...CONSISTENT, theme: 'Toggle dark mode' } : CONSISTENT, 2)
    case '/about':
      return page(
        path,
        'About · Acme',
        '<p>We started in a garage.</p>',
        odd ? { search: 'Find', login: 'Sign in', subscribe: 'Sign up', menu: 'Navigation', theme: 'Dark mode', privacy: '/legal/privacy' } : CONSISTENT,
      )
    case '/blog':
      return page(path, 'Blog · Acme', '<ul><li><a href="/blog/first">First post</a></li><li><a href="/blog/second">Second post</a></li></ul>')
    case '/blog/first':
      return page(path, 'Blog post · Acme', '<p>The first ramp we built was for a bakery.</p>')
    case '/blog/second':
      return page(path, 'Blog post · Acme', '<p>Rails need a grip that is easy to hold.</p>')
    case '/sitemap':
      return page(path, 'Site map · Acme', '<ul><li><a href="/">Home</a></li><li><a href="/products">Products</a></li><li><a href="/about">About</a></li><li><a href="/blog">Blog</a></li></ul>')
    default:
      return undefined
  }
}

export async function startIdentificationSite(variant: IdentificationVariant): Promise<IdentificationSite> {
  const sockets = new Set<Socket>()
  const server = createServer((request, response: ServerResponse) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (url.pathname === '/robots.txt') {
      response.writeHead(200, { 'content-type': 'text/plain' })
      // Only the English pages: the Portuguese links, sign-in and cart lead nowhere the crawl needs.
      response.end('User-agent: *\nDisallow: /pt\nDisallow: /login\nDisallow: /cart\nDisallow: /search\nDisallow: /legal\nDisallow: /privacy\n')
      return
    }
    if (url.pathname === '/logo.png') {
      response.writeHead(204)
      response.end()
      return
    }
    const html = route(url.pathname, variant)
    response.writeHead(html ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' })
    response.end(html ?? '<!doctype html><html lang="en"><title>Not found</title><h1>Not found</h1></html>')
  })
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    async close() {
      for (const socket of sockets) socket.destroy()
      await new Promise((resolve) => server.close(resolve))
    },
  }
}
