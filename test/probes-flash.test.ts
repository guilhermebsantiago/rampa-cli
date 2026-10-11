import { readFile } from 'node:fs/promises'
import { type IncomingMessage, type ServerResponse, createServer } from 'node:http'
import type { AddressInfo, Socket } from 'node:net'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import gifenc from 'gifenc'
import { afterAll, describe, expect, it } from 'vitest'
import { checkSnapshot } from '../src/core/check.ts'
import type { Report } from '../src/core/types.ts'
import { emptyEngine } from '../src/engine/axe.ts'
import { FLASH_AREA_LIMIT, type FlashFrame, type FlashGrid, type FlashMeasure, analyzeFlashes } from '../src/pixels/flash.ts'
import { encodePng } from '../src/pixels/png.ts'
import { type FlashData, type FlashSource, animatedFormat } from '../src/probes/flash.ts'
import { snapshotSignature } from '../src/probes/identity.ts'
import type { InPageElement } from '../src/probes/kit.ts'
import { DETERMINISM_ARGS, parseProbeKinds } from '../src/probes/run.ts'
import { renderReport } from '../src/report/pretty.ts'
import { paint } from '../src/report/color.ts'
import { A11ySnapshotSchema, type A11yNode, type A11ySnapshot, type ProbeRecord } from '../src/snapshot/schema.ts'
import { loadRecorded } from '../src/surfaces/targets.ts'
import { type Collected, collectWeb, launchBrowser } from '../src/surfaces/web.ts'
import { byRule, probeCheckOptions } from './probe-helpers.ts'

const RULE = 'rampa/three-flashes'
// gifenc's ES build exports the encoder as its default; its CommonJS build, an object that holds it.
type Encoder = ReturnType<typeof gifenc.GIFEncoder>
const GIFEncoder: () => Encoder = typeof (gifenc as unknown) === 'function' ? (gifenc as unknown as () => Encoder) : () => gifenc.GIFEncoder()
type Rgb = [number, number, number]
const BLACK: Rgb = [0, 0, 0]
const WHITE: Rgb = [255, 255, 255]
const RED: Rgb = [255, 0, 0]
/** The gray with the luminance of pure red (0.212): a red flash with no general flash. */
const RED_GRAY: Rgb = [127, 127, 127]

/**
 * A sequence of grids of 4 × 4 px cells, `cols` × `rows`, every `step` ms for `ms`; `color(x, y, t)` paints each cell.
 */
function sequence(cols: number, rows: number, ms: number, color: (x: number, y: number, t: number) => Rgb, step = 16): { grid: FlashGrid; frames: FlashFrame[] } {
  const frames: FlashFrame[] = []
  for (let t = 0; t <= ms; t += step) {
    const rgb = new Uint8Array(cols * rows * 3)
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) rgb.set(color(x, y, t), (y * cols + x) * 3)
    frames.push({ t, rgb })
  }
  return { grid: { cols, rows, cellWidth: 4, cellHeight: 4 }, frames }
}
/** A square wave of `hz` full cycles a second: `a` for half a cycle, then `b`. */
const wave = (hz: number, a: Rgb, b: Rgb) => (t: number) => (Math.floor((t * hz * 2) / 1000) % 2 === 0 ? a : b)

describe('the flash analyzer', () => {
  it('passes a large area at 2 Hz, and fails it at 5 Hz over more than a quarter of a 341 × 256 field', () => {
    const slow = sequence(150, 100, 3000, (_x, _y, t) => wave(2, BLACK, WHITE)(t))
    const slowly = analyzeFlashes(slow.grid, slow.frames)
    expect(slowly.general.maxTransitions).toBe(4)
    expect(slowly.general.area).toBe(0)
    const fast = sequence(150, 100, 3000, (_x, _y, t) => wave(5, BLACK, WHITE)(t))
    const flashing = analyzeFlashes(fast.grid, fast.frames)
    expect(flashing.general.maxTransitions).toBe(10)
    // The whole field: 85 × 64 cells of 16 px².
    expect(flashing.general.area).toBe(85 * 64 * 16)
    expect(flashing.general.area).toBeGreaterThan(FLASH_AREA_LIMIT)
    expect(flashing.general.window).toMatchObject({ start: 0, end: 984, first: 0 })
    expect(flashing.general.window?.transitions).toBeGreaterThanOrEqual(9)
    expect(flashing.general.box).toEqual({ x: 0, y: 0, width: 340, height: 256 })
    expect(flashing.red.maxTransitions).toBe(0)
    expect(flashing).toMatchObject({ frames: 188, durationMs: 2992, stepMs: 16 })
  })

  it('counts a small area at 5 Hz, but it stays under the area threshold', () => {
    const tiny = sequence(40, 40, 2000, (x, y, t) => (x < 10 && y < 10 ? wave(5, BLACK, WHITE)(t) : WHITE))
    const result = analyzeFlashes(tiny.grid, tiny.frames)
    expect(result.general.maxTransitions).toBe(10)
    expect(result.general.area).toBe(1600)
    expect(result.general.area).toBeLessThan(FLASH_AREA_LIMIT)
  })

  it('finds a saturated red flash with no change of luminance, and no general flash in it', () => {
    const red = sequence(120, 80, 2000, (_x, _y, t) => wave(5, RED, RED_GRAY)(t))
    const result = analyzeFlashes(red.grid, red.frames)
    expect(result.general.maxTransitions).toBe(0)
    expect(result.red.maxTransitions).toBe(10)
    expect(result.red.area).toBeGreaterThan(FLASH_AREA_LIMIT)
    // Red and orange are close in chromaticity: no red flash.
    const orange = sequence(120, 80, 2000, (_x, _y, t) => wave(5, RED, [255, 60, 0])(t))
    expect(analyzeFlashes(orange.grid, orange.frames).red.maxTransitions).toBe(0)
  })

  it('reads three flashes a second as three, four as more than three', () => {
    const three = sequence(100, 80, 3000, (_x, _y, t) => wave(3, BLACK, WHITE)(t))
    expect(analyzeFlashes(three.grid, three.frames).general).toMatchObject({ maxTransitions: 6, area: 0 })
    const four = sequence(100, 80, 3000, (_x, _y, t) => wave(4, BLACK, WHITE)(t))
    expect(analyzeFlashes(four.grid, four.frames).general.maxTransitions).toBe(8)
  })

  it('counts a slow fade as one transition, ignores changes among bright colors, and leaves masked cells out', () => {
    // From black to white over a second, and back: two transitions in two seconds.
    const fade = sequence(60, 60, 2000, (_x, _y, t) => {
      const v = Math.round(255 * (t <= 1000 ? t / 1000 : (2000 - t) / 1000))
      return [v, v, v]
    })
    expect(analyzeFlashes(fade.grid, fade.frames).general.maxTransitions).toBe(2)
    // Both states above 0.80 in luminance: not a general flash.
    const bright = sequence(60, 60, 2000, (_x, _y, t) => wave(5, [235, 235, 235], WHITE)(t))
    expect(analyzeFlashes(bright.grid, bright.frames).general.maxTransitions).toBe(0)
    const fast = sequence(100, 80, 2000, (_x, _y, t) => wave(5, BLACK, WHITE)(t))
    const masked = analyzeFlashes({ ...fast.grid, mask: new Uint8Array(100 * 80).fill(1) }, fast.frames)
    expect(masked.general.maxTransitions).toBe(0)
  })

  it('counts only contiguous areas: two small regions apart are not added up', () => {
    const apart = sequence(200, 64, 2000, (x, _y, t) => (x < 20 || x >= 180 ? wave(5, BLACK, WHITE)(t) : WHITE))
    const result = analyzeFlashes(apart.grid, apart.frames)
    expect(result.general.maxTransitions).toBe(10)
    // Each region is 20 × 64 cells; neither is over the threshold alone, though together they would be.
    expect(result.general.area).toBe(20 * 64 * 16)
    expect(result.general.area).toBeLessThan(FLASH_AREA_LIMIT)
  })

  it('tells animated images from still ones by their bytes', () => {
    const gif = (frames: number) => {
      const encoder = GIFEncoder()
      for (let i = 0; i < frames; i++) encoder.writeFrame(new Uint8Array(16).fill(i % 2), 4, 4, { palette: [BLACK, WHITE], delay: 100, repeat: 0 })
      encoder.finish()
      return encoder.bytes()
    }
    expect(animatedFormat(gif(4))).toBe('image/gif')
    expect(animatedFormat(gif(1))).toBeUndefined()
    const png = new Uint8Array(encodePng({ width: 2, height: 2, data: new Uint8Array(16).fill(255) }))
    expect(animatedFormat(png)).toBeUndefined()
    // An acTL chunk before the image data makes an animated PNG.
    const actl = new Uint8Array([0, 0, 0, 8, ...Buffer.from('acTL'), 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0])
    expect(animatedFormat(new Uint8Array([...png.subarray(0, 33), ...actl, ...png.subarray(33)]))).toBe('image/png')
  })

  it('is a probe kind of its own, run only when named', () => {
    expect(parseProbeKinds('flash')).toEqual(['flash'])
    expect(parseProbeKinds('all')).not.toContain('flash')
    expect(parseProbeKinds('all,flash')).toContain('flash')
  })
})

// ---- the rule, over recorded facts -------------------------------------------------------------------------------

const node = (ref: string, tag: string, attributes: Record<string, string> = {}): A11yNode => ({ ref, role: tag === 'video' ? 'generic' : 'img', states: [], native: { tag, attributes }, children: [] })
const el = (n: A11yNode, label = ''): InPageElement => ({ ref: n.ref, id: { tag: String(n.native.tag), sig: snapshotSignature(n) }, tag: String(n.native.tag), role: n.role, label })
const GIF = node('#banner', 'img', { id: 'banner', alt: 'Sale' })
const VIDEO = node('#clip', 'video', { id: 'clip' })
const CANVAS = node('#stage', 'canvas', { id: 'stage' })

const failing = (extra: Partial<FlashMeasure> = {}): FlashMeasure => ({ maxTransitions: 10, area: 87_040, window: { start: 0, end: 1000, first: 0, last: 62, transitions: 10 }, box: { x: 0, y: 80, width: 340, height: 256 }, ...extra })
const quiet: FlashMeasure = { maxTransitions: 0, area: 0 }
const source = (extra: Partial<FlashSource>): FlashSource => ({ kind: 'screen', box: { x: 0, y: 0, width: 1024, height: 768 }, status: 'analyzed', frames: 188, durationMs: 2992, stepMs: 16, cell: { width: 4, height: 4 }, general: quiet, red: quiet, ...extra })

function snapshotWith(sources: FlashSource[]): A11ySnapshot {
  const data: FlashData = {
    viewport: { width: 1024, height: 768 },
    definitions: { luminanceDelta: 0.1, darkerBelow: 0.8, redRatio: 0.8, chromaDelta: 0.2, windowMs: 1000, transitions: 7, field: { width: 341, height: 256 } },
    found: { animations: 0, canvases: 1, svgs: 0, videos: 1, images: 1, animated: 1, below: 0 },
    sources,
    end: 'complete',
  }
  const record: ProbeRecord = {
    kind: 'flash',
    version: '1',
    conditions: { viewport: { width: 1024, height: 768 }, deviceScaleFactor: 1, browser: 'chromium 1 (headless)', variant: 'flash' },
    status: 'complete',
    guard: { blocked: [], navigations: [], dialogs: [] },
    durationMs: 1,
    data,
  }
  const body: A11yNode = { ref: 'html > body', role: 'generic', states: [], native: { tag: 'body', attributes: {} }, children: [GIF, VIDEO, CANVAS] }
  return {
    schemaVersion: 1,
    surface: 'web',
    target: 'https://example.com/',
    viewport: { width: 1024, height: 768, scale: 1 },
    root: { ref: 'html', role: 'document', states: [], native: { tag: 'html', attributes: {} }, children: [body] },
    observations: { probes: [record] },
    collectedAt: new Date(0).toISOString(),
    collector: { name: 'rampa-web', version: '0' },
  }
}
const check = (snapshot: A11ySnapshot, locale: 'en' | 'pt-BR' = 'en') => checkSnapshot(snapshot, emptyEngine(), probeCheckOptions({ locale }))

describe('2.3.1 over recorded facts', () => {
  it('fails more than three flashes over more than a quarter of the field, on the element at its middle', async () => {
    const report = await check(snapshotWith([source({ general: failing(), at: { general: el(CANVAS) } })]))
    const [finding, ...rest] = byRule(report, RULE)
    expect(rest).toEqual([])
    expect(finding).toMatchObject({ criterion: '2.3.1', ref: '#stage', source: 'probe', experimental: true, confidence: 'high' })
    expect(finding?.message).toMatch(/^Content on this part of the page makes 5 flashes in one second \(10 transitions\), over 87,040 px² of a 341×256 field/)
    expect(finding?.evidence).toBe("the window at y 0, captured 188 times every 16 ms of the page's time; general flashes: 10 transitions between 0.0 s and 1.0 s (frames 0 to 62), over 87,040 px² of one 341×256 field (100%, the threshold is 25%) at x 0, y 80, 340×256 px; at its middle: <canvas>")
  })

  it('passes a small area that flashes fast, and three flashes a second over a large one', async () => {
    const report = await check(snapshotWith([source({ general: failing({ area: 1600 }) }), source({ general: { maxTransitions: 6, area: 0 } })]))
    expect(byRule(report, RULE)).toEqual([])
    expect(report.coverage.probes?.find((c) => c.rule === RULE)).toMatchObject({ status: 'no-failure-found', applicable: 2 })
  })

  it('fails a red flash, an animated image and a video, the video at full screen with medium confidence', async () => {
    const report = await check(
      snapshotWith([
        source({ kind: 'image', el: el(GIF), box: { x: 0, y: 0, width: 400, height: 300 }, url: 'https://example.com/sale.gif', format: 'image/gif', frames: 2, durationMs: 200, loop: true, red: failing() }),
        source({ kind: 'video', el: el(VIDEO), box: { x: 0, y: 400, width: 160, height: 120 }, url: 'https://example.com/clip.webm', frames: 90, durationMs: 2967, fullScreen: { width: 1024, height: 768, general: failing(), red: quiet } }),
      ]),
    )
    const findings = byRule(report, RULE)
    expect(findings.map((f) => `${f.ref} ${f.confidence}`)).toEqual(['#banner high', '#clip medium'])
    expect(findings[0]?.message).toMatch(/^This animated image makes 5 red flashes \(a saturated red that comes and goes\) in one second/)
    expect(findings[1]?.message).toContain('when shown full screen')
    expect(findings[1]?.evidence).toContain('general flashes at full screen (1024×768 px)')
  })

  it('names what it could not read, and says "not checked" when it read nothing', async () => {
    const report = await check(snapshotWith([source({}), source({ kind: 'video', el: el(VIDEO), status: 'unreadable', reason: 'cross-origin', url: 'https://cdn.example/v.mp4' })]))
    expect(report.coverage.probes?.find((c) => c.rule === RULE)?.note).toContain('not read: video https://cdn.example/v.mp4 (from another origin without CORS)')
    const none = await check(snapshotWith([source({ kind: 'video', el: el(VIDEO), status: 'unreadable', reason: 'did-not-play' })]))
    expect(none.coverage.probes?.find((c) => c.rule === RULE)?.status).toBe('not-checked')
  })

  it('writes in Brazilian Portuguese', async () => {
    const report = await check(snapshotWith([source({ general: failing(), at: { general: el(CANVAS) } })]), 'pt-BR')
    expect(byRule(report, RULE)[0]?.message).toMatch(/^Conteúdo nesta parte da página faz 5 flashes em um segundo \(10 transições\), sobre 87\.040 px² de um campo de 341×256/)
  })
})

// ---- the probe, on pages made here -------------------------------------------------------------------------------

/** A canvas of `width` × `height` that alternates two colors `hz` times a second, by requestAnimationFrame. */
const canvasPage = (title: string, canvases: Array<{ id: string; width: number; height: number; hz: number; a: string; b: string }>) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${title}</title></head>
<body style="margin:0;background:#fff;font:16px Arial">
<h1>${title}</h1>
${canvases.map((c) => `<canvas id="${c.id}" width="${c.width}" height="${c.height}" style="display:block;margin:8px"></canvas>`).join('\n')}
<script>
  const all = ${JSON.stringify(canvases)}.map((c) => ({ ...c, g: document.getElementById(c.id).getContext('2d') }))
  function draw(now) {
    for (const c of all) {
      c.g.fillStyle = Math.floor((now * c.hz * 2) / 1000) % 2 === 0 ? c.a : c.b
      c.g.fillRect(0, 0, c.width, c.height)
    }
    requestAnimationFrame(draw)
  }
  requestAnimationFrame(draw)
</script>
</body></html>`

function gif(width: number, height: number, frames: number, delay: number, colors: Rgb[]): Uint8Array {
  const encoder = GIFEncoder()
  for (let i = 0; i < frames; i++) encoder.writeFrame(new Uint8Array(width * height).fill(i % colors.length), width, height, { palette: colors, delay, repeat: 0 })
  encoder.finish()
  return encoder.bytes()
}

const PAGES: Record<string, { type: string; body: string | Uint8Array | (() => Promise<Uint8Array>) }> = {
  '/pass.html': { type: 'text/html', body: canvasPage('Two hertz and a tiny five', [
    { id: 'slow', width: 600, height: 400, hz: 2, a: '#000000', b: '#ffffff' },
    { id: 'tiny', width: 40, height: 40, hz: 5, a: '#000000', b: '#ffffff' },
  ]) },
  '/fail.html': { type: 'text/html', body: canvasPage('Five hertz', [{ id: 'fast', width: 600, height: 400, hz: 5, a: '#000000', b: '#ffffff' }]) },
  '/red.html': { type: 'text/html', body: canvasPage('Red at five hertz', [{ id: 'red', width: 600, height: 400, hz: 5, a: '#ff0000', b: '#7f7f7f' }]) },
  '/css.html': {
    type: 'text/html',
    body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>CSS</title>
<style>#strobe { width: 500px; height: 360px; animation: strobe 200ms steps(1) infinite; } @keyframes strobe { 0% { background: #000 } 50% { background: #fff } }</style>
</head><body style="margin:0"><h1>CSS animation</h1><div id="strobe" role="img" aria-label="Strobe"></div></body></html>`,
  },
  '/gif.html': {
    type: 'text/html',
    body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>GIF</title></head><body style="margin:0">
<h1>Animated images</h1><img id="big" src="/big.gif" width="400" height="300" alt="Flashing banner"> <img id="small" src="/small.gif" width="32" height="32" alt="Blinking dot">
</body></html>`,
  },
  // 5 flashes a second: black and white frames of 100 ms, looping.
  '/big.gif': { type: 'image/gif', body: gif(40, 30, 2, 100, [BLACK, WHITE]) },
  '/small.gif': { type: 'image/gif', body: gif(8, 8, 2, 100, [BLACK, WHITE]) },
  '/video.html': {
    type: 'text/html',
    body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Video</title></head><body style="margin:0">
<h1>Video</h1><video id="clip" src="/flash.webm" width="480" height="360" muted loop playsinline></video>
</body></html>`,
  },
  '/flash.webm': { type: 'video/webm', body: () => readFile(resolve('test/fixtures/probes/media/flash.webm')) },
}

async function serve(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const page = PAGES[(request.url ?? '/').split('?')[0] ?? '/']
  if (!page) {
    response.writeHead(404).end()
    return
  }
  const body = typeof page.body === 'function' ? await page.body() : typeof page.body === 'string' ? Buffer.from(page.body) : page.body
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range ?? '')
  if (range) {
    const start = range[1] ? Number(range[1]) : 0
    const end = range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1
    response.writeHead(206, { 'content-type': page.type, 'content-range': `bytes ${start}-${end}/${body.length}`, 'accept-ranges': 'bytes', 'content-length': end - start + 1 })
    response.end(body.subarray(start, end + 1))
    return
  }
  response.writeHead(200, { 'content-type': page.type, 'accept-ranges': 'bytes', 'content-length': body.length })
  response.end(body)
}

// Integration: needs Chrome or Edge. Skipped, with the reason on stderr, when none starts.
const browser = await launchBrowser({ args: DETERMINISM_ARGS }).catch((error: unknown) => {
  process.stderr.write(`\nSkipping the flash probe tests: no browser started (${error instanceof Error ? error.message.split('\n')[0] : String(error)}).\n`)
  return undefined
})
const sockets = new Set<Socket>()
const server = createServer((request, response) => {
  serve(request, response).catch(() => response.writeHead(500).end())
})
server.on('connection', (socket) => {
  sockets.add(socket)
  socket.on('close', () => sockets.delete(socket))
})
await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
afterAll(async () => {
  for (const socket of sockets) socket.destroy()
  await new Promise<void>((done) => server.close(() => done()))
  await browser?.close()
}, 60_000)

const collected = new Map<string, Promise<Collected>>()
function probed(path: string): Promise<Collected> {
  if (!browser) throw new Error('no browser')
  let result = collected.get(path)
  if (!result) {
    result = collectWeb(browser, `${origin}${path}`, { runAxe: false, locale: 'en', probes: ['flash'] })
    collected.set(path, result)
  }
  return result
}
const dataOf = (snapshot: A11ySnapshot) => snapshot.observations?.probes.find((p) => p.kind === 'flash')?.data as FlashData | undefined
const flashes = async (path: string) => {
  const { snapshot, engine } = await probed(path)
  const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
  return { report, data: dataOf(snapshot) as FlashData, snapshot, findings: byRule(report, RULE).map((f) => `${f.ref} ${f.evidence?.match(/(general|red) flashes/)?.[1]}`) }
}

describe.skipIf(!browser)('flash probe (2.3.1)', { timeout: 180_000 }, () => {
  it('passes a canvas flashing twice a second and a tiny one flashing five times', async () => {
    const { snapshot, data, findings, report } = await flashes('/pass.html')
    expect(A11ySnapshotSchema.safeParse(snapshot).success).toBe(true)
    expect(snapshot.observations?.probes.find((p) => p.kind === 'flash')).toMatchObject({ kind: 'flash', version: '1', status: 'complete', conditions: { variant: 'flash', viewport: { width: 1024, height: 768 } } })
    expect(findings).toEqual([])
    const screen = data.sources.find((s) => s.kind === 'screen')
    // The tiny canvas flashes five times a second, over 1,600 px²: counted, under the area threshold.
    expect(screen?.general?.maxTransitions).toBeGreaterThanOrEqual(9)
    expect(screen?.general?.area).toBeLessThanOrEqual(1600)
    expect(screen?.frames).toBeGreaterThan(150)
    expect(report.coverage.probes?.find((c) => c.rule === RULE)?.status).toBe('no-failure-found')
  })

  it('fails a large canvas flashing five times a second', async () => {
    const { findings, data } = await flashes('/fail.html')
    expect(findings).toEqual(['#fast general'])
    expect(data.sources.find((s) => s.kind === 'screen')?.general?.area).toBeGreaterThan(FLASH_AREA_LIMIT)
  })

  it('fails a saturated red flash with no change of luminance as a red flash only', async () => {
    const { findings } = await flashes('/red.html')
    expect(findings).toEqual(['#red red'])
  })

  it('fails a CSS animation, set to each instant rather than played', async () => {
    const { findings, data } = await flashes('/css.html')
    expect(findings).toEqual(['#strobe general'])
    expect(data.found.animations).toBe(1)
  })

  it('decodes animated GIFs: the large one fails, the dot passes', async () => {
    const { findings, data } = await flashes('/gif.html')
    expect(findings).toEqual(['#big general'])
    const images = data.sources.filter((s) => s.kind === 'image')
    expect(images.map((s) => `${s.el?.ref} ${s.format} ${s.status} ${s.loop}`)).toEqual(['#big image/gif analyzed true', '#small image/gif analyzed true'])
    expect(images[1]?.general?.maxTransitions).toBeGreaterThanOrEqual(7)
    // The window captures leave the images out: they are read from their frames.
    expect(data.sources.find((s) => s.kind === 'screen')?.general?.maxTransitions).toBe(0)
  })

  it('plays a video muted and samples its frames', async () => {
    const { findings, data } = await flashes('/video.html')
    const video = data.sources.find((s) => s.kind === 'video')
    expect(video).toMatchObject({ status: 'analyzed' })
    expect(video?.frames).toBeGreaterThan(20)
    expect(findings).toEqual(['#clip general'])
  })

  it('stays below the default threshold and prints its coverage line', async () => {
    const { snapshot, engine } = await probed('/fail.html')
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions({ minConfidence: 'medium' }))
    expect(byRule(report, RULE)).toEqual([])
    expect(report.belowThreshold.filter((f) => f.ruleId === RULE)).toHaveLength(1)
    expect(renderReport(report, { verbose: true, paint: paint(false) })).toMatch(/2\.3\.1 +probe\/flash@1 \(rampa\/three-flashes\) · general and red flashes on frames of the window, animated images and video at 1024×768/)
  })

  it('replays a saved snapshot offline to the same findings', async () => {
    const { snapshot, engine } = await probed('/gif.html')
    const live = await checkSnapshot(snapshot, engine, probeCheckOptions())
    const dir = await mkdtemp(join(tmpdir(), 'rampa-flash-'))
    const path = join(dir, 'flash.snapshot.json')
    await writeFile(path, JSON.stringify(snapshot), 'utf8')
    await writeFile(join(dir, 'flash.engine.json'), JSON.stringify(engine), 'utf8')
    const loaded = await loadRecorded(path, 'en')
    const replayed = await checkSnapshot(loaded.snapshot, loaded.engine, probeCheckOptions())
    const key = (report: Report) => report.findings.map((f) => `${f.fingerprint} ${f.evidence}`)
    expect(key(replayed)).toEqual(key(live))
    expect(replayed.coverage.probes).toEqual(live.coverage.probes)
  })
})
