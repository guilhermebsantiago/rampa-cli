// undici issue #5360's minimal reproduction, run against Node's own global fetch (the one
// src/surfaces/destinations.ts uses): a 64 KiB body with Connection: close and a FIN, never read.
// Then the same response read the way destinations.ts reads a non-2xx answer (await fetch, then
// body.cancel()), and a 2xx answer (read up to a limit, then cancel), each after a short delay
// such as the event loop adds between the headers and the first read.
import { createServer } from 'node:net'

const BODY = Buffer.alloc(64 * 1024, 0x61)
const mode = process.argv[2] ?? 'issue'
const status = process.argv[3] ?? '200 OK'
process.on('uncaughtException', (error) => {
  console.log(`${mode} ${status}: UNCAUGHT ${error.name}: ${error.message.split('\n').join(' ')}`)
  console.log(error.stack?.split('\n').slice(1, 6).join('\n'))
  process.exit(3)
})
const server = createServer((sock) => {
  sock.once('data', () => {
    sock.write(`HTTP/1.1 ${status}\r\nContent-Type: text/html\r\nContent-Length: ${BODY.length}\r\nConnection: close\r\n\r\n`)
    sock.write(BODY)
    sock.end()
  })
  sock.on('error', () => {})
})
server.listen(0, '127.0.0.1', async () => {
  const { port } = server.address()
  const res = await fetch(`http://127.0.0.1:${port}/`, { redirect: 'manual', signal: AbortSignal.timeout(8000) })
  if (mode === 'cancel') {
    await new Promise((r) => setTimeout(r, 50))
    await res.body?.cancel().catch(() => undefined)
  } else if (mode === 'read') {
    await new Promise((r) => setTimeout(r, 50))
    const reader = res.body.getReader()
    const { value } = await reader.read()
    await reader.cancel().catch(() => undefined)
    console.log(`read ${value?.byteLength ?? 0} bytes`)
  }
  await new Promise((r) => setTimeout(r, 1000))
  console.log(`${mode} ${status}: no crash`)
  server.close()
})
