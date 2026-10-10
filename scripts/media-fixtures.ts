/**
 * Writes the small WebM files the media probe tests play (test/fixtures/probes/media/). They are committed;
 * run this only to make them again: `node scripts/media-fixtures.ts`.
 *
 * The browser encodes them with WebCodecs (VP8 video, Opus audio, both played by Chrome on Linux and by Edge),
 * and this script puts the frames in a WebM file with its duration written, so a player knows the length on load.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright-core'

const OUT = resolve('test/fixtures/probes/media')

interface Chunk {
  /** Microseconds. */
  ts: number
  key: boolean
  data: number[]
}

interface Encoded {
  video: Chunk[]
  audio: Chunk[]
  opusHead?: number[] | undefined
}

interface Spec {
  name: string
  seconds: number
  video: boolean
  /** 'voice': a tone that rises and falls, loud enough throughout; 'silence': an audio track of zeros. */
  audio?: 'voice' | 'silence' | undefined
}

const SPECS: Spec[] = [
  { name: 'talk', seconds: 6, video: true, audio: 'voice' },
  { name: 'silent', seconds: 6, video: true },
  { name: 'quiet', seconds: 6, video: true, audio: 'silence' },
  { name: 'voice', seconds: 6, video: false, audio: 'voice' },
  { name: 'beep', seconds: 2, video: false, audio: 'voice' },
]

/** Runs in the page: encodes the frames and the samples with WebCodecs. */
async function encode(spec: Spec): Promise<Encoded> {
  const out: Encoded = { video: [], audio: [] }
  const toArray = (chunk: EncodedVideoChunk | EncodedAudioChunk): number[] => {
    const bytes = new Uint8Array(chunk.byteLength)
    chunk.copyTo(bytes)
    return Array.from(bytes)
  }
  if (spec.video) {
    const encoder = new VideoEncoder({
      output: (chunk) => out.video.push({ ts: chunk.timestamp, key: chunk.type === 'key', data: toArray(chunk) }),
      error: (e) => {
        throw e
      },
    })
    encoder.configure({ codec: 'vp8', width: 64, height: 48, bitrate: 40_000, framerate: 10 })
    const canvas = new OffscreenCanvas(64, 48)
    const g = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D
    const frames = spec.seconds * 10
    for (let i = 0; i < frames; i++) {
      g.fillStyle = '#204060'
      g.fillRect(0, 0, 64, 48)
      g.fillStyle = '#f0c040'
      g.fillRect((i * 3) % 48, 16, 16, 16)
      const frame = new VideoFrame(canvas, { timestamp: i * 100_000, duration: 100_000 })
      encoder.encode(frame, { keyFrame: i % 10 === 0 })
      frame.close()
    }
    await encoder.flush()
    encoder.close()
  }
  if (spec.audio) {
    const rate = 48_000
    const encoder = new AudioEncoder({
      output: (chunk, meta) => {
        out.audio.push({ ts: chunk.timestamp, key: true, data: toArray(chunk) })
        const description = meta?.decoderConfig?.description
        if (description && !out.opusHead) {
          const view = ArrayBuffer.isView(description) ? new Uint8Array(description.buffer, description.byteOffset, description.byteLength) : new Uint8Array(description)
          out.opusHead = Array.from(view)
        }
      },
      error: (e) => {
        throw e
      },
    })
    encoder.configure({ codec: 'opus', sampleRate: rate, numberOfChannels: 1, bitrate: 16_000 })
    const total = spec.seconds * rate
    const block = 4800
    for (let start = 0; start < total; start += block) {
      const n = Math.min(block, total - start)
      const samples = new Float32Array(n)
      if (spec.audio === 'voice') {
        for (let i = 0; i < n; i++) {
          const t = (start + i) / rate
          // A voiced sound: 180 Hz and two harmonics, its loudness swinging four times a second but never silent.
          const envelope = 0.55 + 0.45 * Math.sin(2 * Math.PI * 4 * t)
          samples[i] = 0.3 * envelope * (Math.sin(2 * Math.PI * 180 * t) + 0.5 * Math.sin(2 * Math.PI * 360 * t) + 0.25 * Math.sin(2 * Math.PI * 540 * t))
        }
      }
      const data = new AudioData({ format: 'f32-planar', sampleRate: rate, numberOfFrames: n, numberOfChannels: 1, timestamp: Math.round((start / rate) * 1e6), data: samples })
      encoder.encode(data)
      data.close()
    }
    await encoder.flush()
    encoder.close()
  }
  return out
}

// EBML: element ids carry their own length bits; sizes are variable-length integers.
const bytesOf = (value: number, length: number): number[] => {
  const out: number[] = []
  for (let i = length - 1; i >= 0; i--) out.push(Math.floor(value / 2 ** (8 * i)) & 0xff)
  return out
}
const idBytes = (id: number): number[] => bytesOf(id, id > 0xffffff ? 4 : id > 0xffff ? 3 : id > 0xff ? 2 : 1)
const sizeBytes = (size: number): number[] => {
  for (let length = 1; length <= 8; length++) {
    if (size < 2 ** (7 * length) - 1) {
      const out = bytesOf(size, length)
      out[0] = (out[0] ?? 0) | (0x80 >> (length - 1))
      return out
    }
  }
  throw new Error('too large')
}
const el = (id: number, body: number[]): number[] => [...idBytes(id), ...sizeBytes(body.length), ...body]
const uint = (id: number, value: number): number[] => {
  let length = 1
  while (value >= 2 ** (8 * length)) length++
  return el(id, bytesOf(value, length))
}
const float = (id: number, value: number): number[] => {
  const buffer = Buffer.alloc(8)
  buffer.writeDoubleBE(value)
  return el(id, Array.from(buffer))
}
const text = (id: number, value: string): number[] => el(id, Array.from(Buffer.from(value, 'utf8')))

function opusHead(): number[] {
  const head = Buffer.alloc(19)
  head.write('OpusHead', 0, 'ascii')
  head.writeUInt8(1, 8)
  head.writeUInt8(1, 9)
  head.writeUInt16LE(312, 10)
  head.writeUInt32LE(48_000, 12)
  head.writeInt16LE(0, 16)
  head.writeUInt8(0, 18)
  return Array.from(head)
}

function mux(spec: Spec, encoded: Encoded): Buffer {
  const header = el(0x1a45dfa3, [...uint(0x4286, 1), ...uint(0x42f7, 1), ...uint(0x42f2, 4), ...uint(0x42f3, 8), ...text(0x4282, 'webm'), ...uint(0x4287, 4), ...uint(0x4285, 2)])
  const info = el(0x1549a966, [...uint(0x2ad7b1, 1_000_000), ...float(0x4489, spec.seconds * 1000), ...text(0x4d80, 'rampa'), ...text(0x5741, 'rampa media fixtures')])
  const entries: number[] = []
  const videoTrack = spec.video ? 1 : 0
  const audioTrack = spec.audio ? (spec.video ? 2 : 1) : 0
  if (videoTrack) {
    entries.push(...el(0xae, [...uint(0xd7, videoTrack), ...uint(0x73c5, videoTrack), ...uint(0x83, 1), ...text(0x86, 'V_VP8'), ...el(0xe0, [...uint(0xb0, 64), ...uint(0xba, 48)])]))
  }
  if (audioTrack) {
    const head = encoded.opusHead && encoded.opusHead.length >= 19 ? encoded.opusHead : opusHead()
    const preSkip = (head[10] ?? 0) | ((head[11] ?? 0) << 8)
    entries.push(
      ...el(0xae, [
        ...uint(0xd7, audioTrack),
        ...uint(0x73c5, audioTrack),
        ...uint(0x83, 2),
        ...text(0x86, 'A_OPUS'),
        ...el(0x63a2, head),
        ...uint(0x56aa, Math.round((preSkip / 48_000) * 1e9)),
        ...uint(0x56bb, 80_000_000),
        ...el(0xe1, [...float(0xb5, 48_000), ...uint(0x9f, 1)]),
      ]),
    )
  }
  const tracks = el(0x1654ae6b, entries)
  // One cluster per second, each starting at a video key frame.
  const blocks = [
    ...encoded.video.map((chunk) => ({ track: videoTrack, ...chunk })),
    ...encoded.audio.map((chunk) => ({ track: audioTrack, ...chunk })),
  ].sort((a, b) => a.ts - b.ts || a.track - b.track)
  const clusters: number[] = []
  for (let second = 0; second < spec.seconds; second++) {
    const start = second * 1000
    const inside = blocks.filter((block) => Math.floor(block.ts / 1e6) === second)
    const body: number[] = [...uint(0xe7, start)]
    for (const block of inside) {
      const relative = Math.round(block.ts / 1000) - start
      body.push(...el(0xa3, [0x80 | block.track, ...bytesOf(relative & 0xffff, 2), block.key ? 0x80 : 0x00, ...block.data]))
    }
    clusters.push(...el(0x1f43b675, body))
  }
  const segment = el(0x18538067, [...info, ...tracks, ...clusters])
  return Buffer.from([...header, ...segment])
}

mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch({ channel: process.env.RAMPA_BROWSER_CHANNEL ?? 'msedge', headless: true })
const page = await browser.newPage()
// WebCodecs needs a secure context: a page on localhost is one.
const server = createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/html' })
  response.end('<!doctype html><title>encode</title>')
})
await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
await page.goto(`http://localhost:${(server.address() as AddressInfo).port}/`)
for (const spec of SPECS) {
  const encoded = await page.evaluate(encode, spec)
  const file = join(OUT, `${spec.name}.webm`)
  const buffer = mux(spec, encoded)
  writeFileSync(file, buffer)
  console.log(`${file}: ${buffer.length} bytes, ${encoded.video.length} video and ${encoded.audio.length} audio chunks`)
}
await browser.close()
server.close()
