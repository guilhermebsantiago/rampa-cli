// A local server for the pair pages: a saved half at `<test page path>?bench=<variant>`, and every other path
// proxied to www.w3.org (images, styles, the pages links lead to), so a saved page loads as the original does.
// Proxied files are cached on disk: a rerun reads the same bytes and asks W3C less.
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join } from 'node:path'

const UPSTREAM = 'https://www.w3.org'
const PASS_HEADERS = ['content-type', 'content-range', 'accept-ranges', 'location', 'last-modified', 'etag']

export async function startServer({ port, served, cacheDir }) {
  await mkdir(cacheDir, { recursive: true })
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost')
      const variant = url.searchParams.get('bench')
      if (variant !== null) {
        const file = served.get(`${url.pathname}?bench=${variant}`)
        if (!file) {
          response.writeHead(404, { 'content-type': 'text/plain' }).end('no such pair page')
          return
        }
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(await readFile(file))
        return
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405).end()
        return
      }
      const target = `${UPSTREAM}${url.pathname}${url.search}`
      const range = request.headers.range
      const key = createHash('sha256').update(target).digest('hex')
      const body = join(cacheDir, `${key}.body`)
      const head = join(cacheDir, `${key}.json`)
      if (!range && existsSync(body) && existsSync(head)) {
        const meta = JSON.parse(await readFile(head, 'utf8'))
        response.writeHead(meta.status, meta.headers).end(request.method === 'HEAD' ? undefined : await readFile(body))
        return
      }
      const upstream = await fetch(target, { redirect: 'manual', headers: range ? { range } : {}, signal: AbortSignal.timeout(60_000) })
      const headers = {}
      for (const name of PASS_HEADERS) {
        const value = upstream.headers.get(name)
        if (value) headers[name] = value
      }
      const bytes = Buffer.from(await upstream.arrayBuffer())
      if (!range && upstream.status === 200) {
        await writeFile(body, bytes)
        await writeFile(head, JSON.stringify({ status: 200, headers }), 'utf8')
      }
      response.writeHead(upstream.status, headers).end(request.method === 'HEAD' ? undefined : bytes)
    } catch (error) {
      if (!response.headersSent) response.writeHead(502, { 'content-type': 'text/plain' })
      response.end(String(error?.message ?? error))
    }
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolve)
  })
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}
