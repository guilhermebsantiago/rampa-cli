import { type ServerResponse, createServer } from 'node:http'
import type { AddressInfo, Socket } from 'node:net'

/**
 * A small site on 127.0.0.1 for 3.2.3 and 3.2.6: English pages that share a
 * header, a main navigation and a footer, a Portuguese version with its own
 * navigation order, and a page with no landmarks.
 *
 * Negative controls, the same in both variants: /docs/ adds a sub-navigation,
 * /blog adds an item to the main navigation, /contact also mentions the e-mail
 * address in its text, and the Portuguese pages order their links differently
 * from the English ones. The `inconsistent` variant changes one page, /pricing:
 * Pricing comes before Docs in its navigation (F66), and the help e-mail moves
 * from the footer to the header.
 */
export type ConsistencyVariant = 'consistent' | 'inconsistent'

export interface ConsistencySite {
  origin: string
  close(): Promise<void>
}

type Links = Array<[string, string]>

const MAIN: Links = [
  ['Home', '/'],
  ['Docs', '/docs/'],
  ['Pricing', '/pricing'],
  ['Blog', '/blog'],
  ['Contact', '/contact'],
]
const PT: Links = [
  ['Início', '/pt/'],
  ['Preços', '/pt/precos'],
  ['Documentação', '/docs/'],
  ['Contato', '/pt/contato'],
]

const anchors = (links: Links) => links.map(([name, href]) => `<li><a href="${href}">${name}</a></li>`).join('')

interface PageOptions {
  lang?: string
  nav?: Links
  /** Links in the header next to the logo, outside the navigation. */
  headerExtra?: string
  /** The help e-mail in the footer; false leaves it out. */
  footerMail?: boolean
}

function page(title: string, main: string, options: PageOptions = {}): string {
  const lang = options.lang ?? 'en'
  const pt = lang.startsWith('pt')
  const nav = options.nav ?? (pt ? PT : MAIN)
  const switcher = pt ? '<a href="/" lang="en">English</a>' : '<a href="/pt/" lang="pt-BR">Português</a>'
  const footer = pt
    ? '<footer><a href="/pt/privacidade">Privacidade</a> <a href="mailto:ajuda@acme.test">ajuda@acme.test</a></footer>'
    : `<footer><ul><li><a href="/privacy">Privacy</a></li>${options.footerMail === false ? '' : '<li><a href="mailto:help@acme.test">help@acme.test</a></li>'}<li><a href="/help">Help center</a></li></ul></footer>`
  return [
    `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>${title} · Acme</title></head><body>`,
    `<header><a href="${pt ? '/pt/' : '/'}"><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="Acme" width="1" height="1"></a> ${switcher}${options.headerExtra ?? ''}`,
    `<nav aria-label="${pt ? 'Principal' : 'Main'}"><ul>${anchors(nav)}</ul></nav></header>`,
    `<main><h1>${title}</h1>${main}</main>`,
    footer,
    '</body></html>',
  ].join('')
}

function route(path: string, variant: ConsistencyVariant): string | undefined {
  switch (path) {
    case '/':
      return page('Home', '<p>Acme makes ramps. See <a href="/plain">the plain page</a>.</p>')
    case '/docs/':
      return page(
        'Docs',
        '<nav aria-label="Docs"><a href="/docs/#start">Start</a> <a href="/docs/#api">API</a></nav><h2 id="start">Start</h2><h2 id="api">API</h2>',
      )
    case '/pricing':
      if (variant === 'consistent') return page('Pricing', '<p>Free for everyone.</p>')
      return page('Pricing', '<p>Free for everyone.</p>', {
        nav: [MAIN[0], MAIN[2], MAIN[1], MAIN[3], MAIN[4]] as Links,
        headerExtra: ' <a href="mailto:help@acme.test">help@acme.test</a>',
        footerMail: false,
      })
    case '/blog':
      return page('Blog', '<p>News.</p>', { nav: [...MAIN.slice(0, 4), ['Changelog', '/changelog'], ...MAIN.slice(4)] as Links })
    case '/changelog':
      return page('Changelog', '<p>Version 1.</p>')
    case '/contact':
      return page('Contact', '<p>Write to <a href="mailto:help@acme.test">help@acme.test</a> or call us.</p>')
    case '/privacy':
      return page('Privacy', '<p>We keep nothing.</p>')
    case '/help':
      return page('Help center', '<p>Answers.</p>')
    case '/pt/':
      return page('Início', '<p>A Acme faz rampas.</p>', { lang: 'pt-BR' })
    case '/pt/precos':
      return page('Preços', '<p>Grátis para todos.</p>', { lang: 'pt-BR' })
    case '/pt/contato':
      return page('Contato', '<p>Escreva para nós.</p>', { lang: 'pt-BR' })
    case '/pt/privacidade':
      return page('Privacidade', '<p>Nada guardamos.</p>', { lang: 'pt-BR' })
    case '/plain':
      return '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Plain · Acme</title></head><body><div><a href="/">Home</a> <a href="/docs/">Docs</a></div><h1>Plain</h1><p>No landmarks here.</p></body></html>'
    default:
      return undefined
  }
}

export async function startConsistencySite(variant: ConsistencyVariant): Promise<ConsistencySite> {
  const sockets = new Set<Socket>()
  const server = createServer((request, response: ServerResponse) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (url.pathname === '/robots.txt') {
      response.writeHead(200, { 'content-type': 'text/plain' })
      response.end('User-agent: *\nAllow: /\n')
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
