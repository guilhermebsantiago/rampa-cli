// A local reproduction of the crash Rampa met on kcl.ac.uk (round 3, 2026-10-23): Node's internal
// `assert(!this.paused)` from undici's HTTP/1 parser, reached through the global fetch that
// src/surfaces/destinations.ts uses to read where links lead. No request leaves this machine.
//
// A raw TCP server plays a rate limiter: it answers each request with the status, headers and body of one
// scenario and then ends or resets the connection. The client reads the responses as destinations.ts does
// (redirect: 'manual', a non-2xx body cancelled, an HTML body read up to a limit then cancelled), four at a time.
//
//   node study/notes-precision-probe/kcl-repro.mjs [scenario ...]
import { createServer } from 'node:net'

const scenarios = {
  // 429 with Connection: close, the body in the same write, then FIN at once.
  '429-close-fin': { status: '429 Too Many Requests', close: true, body: 'Rate limit exceeded. Please wait 10 minutes before retrying.', end: 'fin' },
  // 429 with Connection: close, then an RST instead of a FIN.
  '429-close-rst': { status: '429 Too Many Requests', close: true, body: 'Rate limit exceeded. Please wait 10 minutes before retrying.', end: 'rst' },
  // 429 whose body is larger than fetch's stream buffer, closed at once.
  '429-close-big': { status: '429 Too Many Requests', close: true, body: 'Rate limit exceeded. '.repeat(20000), end: 'fin' },
  // 429 with Content-Length larger than what is sent, then FIN (a truncated body).
  '429-close-short': { status: '429 Too Many Requests', close: true, body: 'Rate limit exceeded.', lie: 4000, end: 'fin' },
  // 200 HTML with Connection: close and a body larger than the stream buffer, closed at once.
  '200-close-big': { status: '200 OK', close: true, type: 'text/html', body: `<html><head><title>T</title></head><body>${'<p>text</p>'.repeat(40000)}</body></html>`, end: 'fin' },
  // 200 HTML, keep-alive, big body, then RST while the client is still reading.
  '200-keep-big-rst': { status: '200 OK', close: false, type: 'text/html', body: `<html><head><title>T</title></head><body>${'<p>text</p>'.repeat(40000)}</body></html>`, end: 'rst' },
  // 429 with no Content-Length and Connection: close: the body ends with the connection.
  '429-close-nolength': { status: '429 Too Many Requests', close: true, body: 'Rate limit exceeded. '.repeat(3000), noLength: true, end: 'fin' },
}

const wanted = process.argv.slice(2).filter((a) => scenarios[a])
const names = wanted.length ? wanted : Object.keys(scenarios)

process.on('uncaughtException', (error) => {
  console.log(`UNCAUGHT: ${error.name}: ${error.message.split('\n').join(' ')}`)
  console.log(error.stack?.split('\n').slice(0, 12).join('\n'))
  process.exit(3)
})

for (const name of names) {
  const s = scenarios[name]
  const server = createServer((socket) => {
    socket.once('data', () => {
      const body = Buffer.from(s.body)
      const headers = [`HTTP/1.1 ${s.status}`, `Content-Type: ${s.type ?? 'text/plain'}; charset=utf-8`]
      if (!s.noLength) headers.push(`Content-Length: ${s.lie ?? body.length}`)
      if (s.close) headers.push('Connection: close')
      socket.write(`${headers.join('\r\n')}\r\n\r\n`)
      socket.write(body, () => {
        if (s.end === 'rst') socket.resetAndDestroy()
        else socket.end()
      })
    })
    socket.on('error', () => {})
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  let ok = 0
  let failed = 0
  const read = async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/page`, { redirect: 'manual', signal: AbortSignal.timeout(8000), headers: { 'user-agent': 'repro' } })
      if (response.status < 200 || response.status >= 300) {
        await response.body?.cancel().catch(() => undefined)
      } else {
        const reader = response.body.getReader()
        let size = 0
        try {
          while (size < 64 * 1024) {
            const { done, value } = await reader.read()
            if (done) break
            size += value.byteLength
          }
        } finally {
          await reader.cancel().catch(() => undefined)
        }
      }
      ok++
    } catch (error) {
      failed++
    }
  }
  for (let round = 0; round < 10; round++) await Promise.all([read(), read(), read(), read()])
  // Let the sockets close; the assertion fires from a socket event, after fetch has returned.
  await new Promise((resolve) => setTimeout(resolve, 300))
  console.log(`${name}: ${ok} read, ${failed} failed, no crash`)
  server.close()
}
