// Variants of undici #5360 against Node's global fetch: bigger bodies, bodies sent in pieces, a FIN after a pause.
import { createServer } from 'node:net'
const [sizeKiB = '64', pieces = '1', delayMs = '0', mode = 'issue'] = process.argv.slice(2)
const BODY = Buffer.alloc(Number(sizeKiB) * 1024, 0x61)
process.on('uncaughtException', (error) => {
  console.log(`${sizeKiB}KiB x${pieces} delay ${delayMs} ${mode}: UNCAUGHT ${error.name}: ${error.message.split('\n').join(' ')}`)
  console.log(error.stack?.split('\n').slice(1, 5).join('\n'))
  process.exit(3)
})
const server = createServer((sock) => {
  sock.once('data', async () => {
    sock.write(`HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: ${BODY.length}\r\nConnection: close\r\n\r\n`)
    const n = Number(pieces)
    const step = Math.ceil(BODY.length / n)
    for (let i = 0; i < n; i++) {
      sock.write(BODY.subarray(i * step, Math.min(BODY.length, (i + 1) * step)))
      if (Number(delayMs) > 0) await new Promise((r) => setTimeout(r, Number(delayMs)))
    }
    sock.end()
  })
  sock.on('error', () => {})
})
server.listen(0, '127.0.0.1', async () => {
  const { port } = server.address()
  const res = await fetch(`http://127.0.0.1:${port}/`, { redirect: 'manual', signal: AbortSignal.timeout(8000) })
  if (mode === 'cancel') {
    await new Promise((r) => setTimeout(r, 20))
    await res.body?.cancel().catch(() => undefined)
  }
  await new Promise((r) => setTimeout(r, 1500))
  console.log(`${sizeKiB}KiB x${pieces} delay ${delayMs} ${mode}: no crash`)
  server.close()
})
