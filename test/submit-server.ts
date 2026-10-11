import { randomUUID } from 'node:crypto'
import { type IncomingMessage, type ServerResponse, createServer } from 'node:http'
import type { AddressInfo, Socket } from 'node:net'

/**
 * Fixtures for the form probe's submissions (--allow-submit, docs/probes.md): a server on 127.0.0.1 that validates
 * forms and keeps a session per cookie, so a flow can go from step to step, and a second one on localhost, another
 * origin, that must never hear from the probe. Both log every request as "METHOD /path", in order.
 *
 * - /errors/: one form the server checks, answering with errors tied or not to their fields (3.3.1, 3.3.3).
 * - /review/step1 → step2 → step3: details, delivery (the e-mail carried over), then a review step with the entries,
 *   "Change" links and "Place order" (3.3.4 with a review step; 3.3.7 filled in).
 * - /bare/step1 → step2: no checks; the second step asks for the e-mail again, empty, next to "Place order", with no
 *   review, no confirmation box and no way back (3.3.4 and 3.3.7 failures).
 * - /leak/: a form that posts to the other origin, and one whose submission also tries a POST and an image there and a
 *   beacon home.
 * - /never/: a sign-in form, a "Delete my account" form and a newsletter's "Subscribe".
 */

export interface SubmitServers {
  origin: string
  other: string
  /** Requests to 127.0.0.1, as "METHOD /path". */
  requests: string[]
  /** Requests to the other origin. */
  otherRequests: string[]
  /** What each POST carried, by path. */
  posts: Array<{ path: string; body: Record<string, string> }>
  close(): Promise<void>
}

const page = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><style>.error{color:#b00}</style></head><body><main>${body}</main></body></html>`

const esc = (value: string | undefined) => (value ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

async function bodyOf(request: IncomingMessage): Promise<Record<string, string>> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  const text = Buffer.concat(chunks).toString('utf8')
  return Object.fromEntries(new URLSearchParams(text))
}

type Session = Record<string, string>

function errorsPage(values: Session, errors: Record<string, boolean>): string {
  const any = Object.values(errors).some(Boolean)
  return page(
    'Contact us',
    `<h1>Contact us</h1>
${any ? '<div role="alert"><p>Please correct the errors below.</p></div>' : ''}
<form method="post" action="/errors/">
  <p><label for="name">Full name</label> <input id="name" name="name" autocomplete="name" value=""></p>
  <p><label for="email">E-mail</label> <input id="email" name="email" type="email" autocomplete="email" required value="${esc(values.email)}"${errors.email ? ' aria-invalid="true" style="border:2px solid #b00"' : ''}></p>
  <p><label for="age">Age</label> <input id="age" name="age" type="number" min="18" value="${esc(values.age)}"${errors.age ? ' aria-invalid="true" aria-describedby="age-error"' : ''}>${errors.age ? ' <span id="age-error" class="error">Invalid age.</span>' : ''}</p>
  <p><label for="username">Username</label> <input id="username" name="username" autocomplete="username" minlength="4" value="${esc(values.username)}">${errors.username ? ' <span class="error">Use at least 4 characters.</span>' : ''}</p>
  <p><label for="cep">CEP</label> <input id="cep" name="cep" autocomplete="postal-code" pattern="\\d{5}-?\\d{3}" value="${esc(values.cep)}"${errors.cep ? ' aria-invalid="true" aria-describedby="cep-error"' : ''}>${errors.cep ? ' <span id="cep-error" class="error">Enter the CEP like 12345-678.</span>' : ''}</p>
  <button type="submit">Send</button>
</form>`,
  )
}

function reviewStep1(values: Session, errors: Record<string, boolean>): string {
  const any = errors.name || errors.email
  return page(
    'Your details',
    `<h1>Your details</h1>
${any ? '<div role="alert"><h2>There is a problem</h2><ul><li><a href="#name">Enter your full name</a></li><li><a href="#email">Enter an email address like name@example.com</a></li></ul></div>' : ''}
<form method="post" action="/review/step1">
  <p><label for="name">Full name</label> <input id="name" name="name" autocomplete="name" required value="${esc(values.name)}"${errors.name ? ' aria-invalid="true" aria-describedby="name-error"' : ''}>${errors.name ? ' <span id="name-error" class="error">Enter your full name</span>' : ''}</p>
  <p><label for="email">E-mail</label> <input id="email" name="email" type="email" autocomplete="email" required value="${esc(values.email)}"${errors.email ? ' aria-invalid="true" aria-describedby="email-error"' : ''}>${errors.email ? ' <span id="email-error" class="error">Enter an email address like name@example.com</span>' : ''}</p>
  <button type="submit">Continue</button>
</form>`,
  )
}

function reviewStep2(session: Session, values: Session, errors: Record<string, boolean>): string {
  return page(
    'Delivery',
    `<h1>Delivery</h1>
<form method="post" action="/review/step2">
  <p><label for="receipt">E-mail for receipts</label> <input id="receipt" name="receipt" type="email" autocomplete="email" value="${esc(values.receipt ?? session.email)}"${errors.receipt ? ' aria-invalid="true" aria-describedby="receipt-error"' : ''}>${errors.receipt ? ' <span id="receipt-error" class="error">Enter an email address like name@example.com</span>' : ''}</p>
  <p><label for="street">Street</label> <input id="street" name="street" autocomplete="shipping street-address" value="${esc(values.street)}"></p>
  <p><label for="city">City</label> <input id="city" name="city" autocomplete="shipping address-level2" value="${esc(values.city)}"></p>
  <button type="submit">Continue</button>
</form>`,
  )
}

function reviewStep3(session: Session): string {
  return page(
    'Review your order',
    `<h1>Review your order</h1>
<dl>
  <dt>Name</dt><dd>${esc(session.name)} <a href="/review/step1">Change</a></dd>
  <dt>E-mail</dt><dd>${esc(session.email)}</dd>
  <dt>Street</dt><dd>${esc(session.street)} <a href="/review/step2">Change</a></dd>
  <dt>City</dt><dd>${esc(session.city)}</dd>
</dl>
<form method="post" action="/review/place"><button type="submit">Place order</button></form>`,
  )
}

const bareStep1 = page(
  'Your details',
  `<h1>Your details</h1>
<form method="post" action="/bare/step1">
  <p><label for="name">Full name</label> <input id="name" name="name" autocomplete="name"></p>
  <p><label for="email">E-mail</label> <input id="email" name="email" type="email" autocomplete="email"></p>
  <button type="submit">Continue</button>
</form>`,
)

const bareStep2 = page(
  'Almost done',
  `<h1>Almost done</h1>
<form method="post" action="/bare/place">
  <p><label for="email2">E-mail</label> <input id="email2" name="email2" type="email" autocomplete="email"></p>
  <p><label for="notes">Delivery notes</label> <textarea id="notes" name="notes"></textarea></p>
  <button type="submit">Place order</button>
</form>`,
)

function leakPage(other: string): string {
  return page(
    'Feedback',
    `<h1>Feedback</h1>
<form method="post" action="${other}/collect" aria-label="Elsewhere">
  <p><label for="topic">Topic</label> <input id="topic" name="topic"></p>
  <button type="submit">Send</button>
</form>
<form method="post" action="/leak/ok" aria-label="Here" id="here">
  <p><label for="comment">Comment</label> <input id="comment" name="comment" minlength="3"></p>
  <button type="submit">Send</button>
</form>
<script>
document.getElementById('here').addEventListener('submit', () => {
  fetch('${other}/beacon', { method: 'POST', body: 'x' }).catch(() => {})
  new Image().src = '${other}/pixel.gif'
  navigator.sendBeacon('/beacon-home', 'x')
})
</script>`,
  )
}

const neverPage = page(
  'Account',
  `<h1>Account</h1>
<form method="post" action="/never/sign-in" aria-label="Sign in">
  <p><label for="user">E-mail</label> <input id="user" name="user" type="email" autocomplete="username"></p>
  <p><label for="pw">Password</label> <input id="pw" name="pw" type="password" autocomplete="current-password"></p>
  <button type="submit">Sign in</button>
</form>
<form method="post" action="/never/delete" aria-label="Danger zone">
  <p><label for="reason">Why are you leaving?</label> <input id="reason" name="reason" minlength="3"></p>
  <button type="submit">Delete my account</button>
</form>
<form method="post" action="/never/newsletter" aria-label="Newsletter">
  <p><label for="news">E-mail</label> <input id="news" name="news" type="email" autocomplete="email" required></p>
  <button type="submit">Subscribe</button>
</form>`,
)

export async function startSubmitServers(): Promise<SubmitServers> {
  const sockets = new Set<Socket>()
  const requests: string[] = []
  const otherRequests: string[] = []
  const posts: SubmitServers['posts'] = []
  const sessions = new Map<string, Session>()
  let other = ''

  const send = (response: ServerResponse, html: string, headers: Record<string, string> = {}) => response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...headers }).end(html)
  const redirect = (response: ServerResponse, to: string, headers: Record<string, string> = {}) => response.writeHead(303, { location: to, ...headers }).end()

  async function main(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const path = (request.url ?? '/').split('?')[0] ?? '/'
    const sid = /(?:^|;\s*)sid=([^;]+)/.exec(request.headers.cookie ?? '')?.[1]
    const id = sid && sessions.has(sid) ? sid : randomUUID()
    if (!sessions.has(id)) sessions.set(id, {})
    const session = sessions.get(id) as Session
    const cookie = { 'set-cookie': `sid=${id}; Path=/; HttpOnly; SameSite=Lax` }
    const form = request.method === 'POST' ? await bodyOf(request) : {}
    if (request.method === 'POST') posts.push({ path, body: form })

    if (path === '/errors/') {
      if (request.method !== 'POST') return void send(response, errorsPage({}, {}), cookie)
      const errors = {
        email: !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email ?? ''),
        age: form.age !== undefined && form.age !== '' && !(Number(form.age) >= 18),
        username: (form.username ?? '').length < 4,
        cep: !/^\d{5}-?\d{3}$/.test(form.cep ?? ''),
      }
      if (Object.values(errors).some(Boolean)) return void send(response, errorsPage(form, errors), cookie)
      return void send(response, page('Thank you', '<h1>Thank you</h1><p>Your message was sent.</p>'), cookie)
    }
    if (path === '/review/step1') {
      if (request.method !== 'POST') return void send(response, reviewStep1(session, {}), cookie)
      const errors = { name: (form.name ?? '').trim() === '', email: !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email ?? '') }
      if (errors.name || errors.email) return void send(response, reviewStep1(form, errors), cookie)
      Object.assign(session, { name: form.name ?? '', email: form.email ?? '' })
      return void redirect(response, '/review/step2', cookie)
    }
    if (path === '/review/step2') {
      if (request.method !== 'POST') return void send(response, reviewStep2(session, {}, {}), cookie)
      const errors = { receipt: !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.receipt ?? '') }
      if (errors.receipt) return void send(response, reviewStep2(session, form, errors), cookie)
      Object.assign(session, { street: form.street ?? '', city: form.city ?? '' })
      return void redirect(response, '/review/step3', cookie)
    }
    if (path === '/review/step3') return void send(response, reviewStep3(session), cookie)
    if (path === '/bare/step1') {
      if (request.method !== 'POST') return void send(response, bareStep1, cookie)
      Object.assign(session, { name: form.name ?? '', email: form.email ?? '' })
      return void redirect(response, '/bare/step2', cookie)
    }
    if (path === '/bare/step2') return void send(response, bareStep2, cookie)
    if (path === '/leak/') return void send(response, leakPage(other), cookie)
    if (path === '/leak/ok') return void send(response, page('Thanks', '<h1>Thanks</h1><p>We read every comment.</p>'), cookie)
    if (path === '/never/') return void send(response, neverPage, cookie)
    if (['/review/place', '/bare/place', '/never/sign-in', '/never/delete', '/never/newsletter'].includes(path)) {
      // Never reached by the probe: the tests check that these stay out of the log.
      return void send(response, page('Done', '<h1>Done</h1><p>Committed.</p>'), cookie)
    }
    response.writeHead(404, { 'content-type': 'text/plain' }).end('not found')
  }

  async function listen(handler: (request: IncomingMessage, response: ServerResponse) => Promise<void>, log: string[], host: string) {
    const server = createServer((request, response) => {
      log.push(`${request.method ?? 'GET'} ${request.url ?? '/'}`)
      handler(request, response).catch(() => response.writeHead(500).end())
    })
    server.on('connection', (socket) => {
      sockets.add(socket)
      socket.on('close', () => sockets.delete(socket))
    })
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
    return { server, origin: `http://${host}:${(server.address() as AddressInfo).port}` }
  }

  const first = await listen(main, requests, '127.0.0.1')
  // Another origin: localhost and 127.0.0.1 are different hosts. It answers everything, and must hear nothing.
  const second = await listen(
    async (_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' }).end('ok')
    },
    otherRequests,
    'localhost',
  )
  other = second.origin
  return {
    origin: first.origin,
    other,
    requests,
    otherRequests,
    posts,
    async close() {
      for (const socket of sockets) socket.destroy()
      await Promise.all([new Promise((done) => first.server.close(done)), new Promise((done) => second.server.close(done))])
    },
  }
}
