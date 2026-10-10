import { readFile } from 'node:fs/promises'
import { type IncomingMessage, type ServerResponse, createServer } from 'node:http'
import type { AddressInfo, Socket } from 'node:net'
import { extname, join, normalize, resolve } from 'node:path'

/**
 * The probe fixtures over HTTP, for the media probe: over file:// a page may not load its own text tracks or read
 * its media's stream (file pages have opaque origins). Two servers on 127.0.0.1, so a page can embed a frame of
 * another origin. Media answers byte ranges, as players ask for them.
 */
export interface FixtureServers {
  origin: string
  other: string
  close(): Promise<void>
}

const ROOT = resolve('test/fixtures/probes')
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.webm': 'video/webm', '.vtt': 'text/vtt; charset=utf-8', '.wav': 'audio/wav' }

async function serve(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const path = normalize(join(ROOT, decodeURIComponent((request.url ?? '/').split('?')[0] ?? '/')))
  if (!path.startsWith(ROOT)) {
    response.writeHead(403).end()
    return
  }
  let body: Buffer
  try {
    body = await readFile(path)
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain' }).end('not found')
    return
  }
  const type = TYPES[extname(path)] ?? 'application/octet-stream'
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range ?? '')
  if (range) {
    const start = range[1] ? Number(range[1]) : 0
    const end = range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1
    response.writeHead(206, { 'content-type': type, 'content-range': `bytes ${start}-${end}/${body.length}`, 'accept-ranges': 'bytes', 'content-length': end - start + 1 })
    response.end(body.subarray(start, end + 1))
    return
  }
  response.writeHead(200, { 'content-type': type, 'accept-ranges': 'bytes', 'content-length': body.length })
  response.end(body)
}

async function listen(sockets: Set<Socket>): Promise<{ server: ReturnType<typeof createServer>; origin: string }> {
  const server = createServer((request, response) => {
    serve(request, response).catch(() => response.writeHead(500).end())
  })
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  return { server, origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}` }
}

export async function startFixtureServers(): Promise<FixtureServers> {
  const sockets = new Set<Socket>()
  const main = await listen(sockets)
  const second = await listen(sockets)
  return {
    origin: main.origin,
    // The same files, but another origin: localhost and 127.0.0.1 are different hosts.
    other: second.origin.replace('127.0.0.1', 'localhost'),
    async close() {
      for (const socket of sockets) socket.destroy()
      await Promise.all([new Promise((done) => main.server.close(done)), new Promise((done) => second.server.close(done))])
    },
  }
}
