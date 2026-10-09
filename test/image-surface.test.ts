import { describe, expect, it } from 'vitest'
import { memoryCache } from '../src/core/cache.ts'
import { engineFindings } from '../src/core/check.ts'
import { measureTextContrast } from '../src/pixels/contrast.ts'
import { type RgbaImage, decodePng, encodePng } from '../src/pixels/png.ts'
import type { ModelProvider } from '../src/providers/types.ts'
import { A11ySnapshotSchema } from '../src/snapshot/schema.ts'
import { type ImageCollectOptions, checkImage, plausibleBlocks, sameText } from '../src/surfaces/image.ts'
import { WHITE, blank, drawText, fill } from './screens.ts'

const W = 600
const H = 800
const box = (x: number, y: number, width: number, height: number) => ({
  left: (x / W) * 1000,
  top: (y / H) * 1000,
  right: ((x + width) / W) * 1000,
  bottom: ((y + height) / H) * 1000,
})

/** A mock screen: a dark heading, a light gray link, a navy button label, a pale logo, and white text on a gradient. */
function mockScreen(): RgbaImage {
  const image = blank(W, H)
  drawText(image, { x: 60, y: 60, width: 480, height: 60 }, [0x20, 0x21, 0x24], WHITE)
  drawText(image, { x: 60, y: 200, width: 340, height: 40 }, [0x9e, 0x9e, 0x9e], WHITE)
  drawText(image, { x: 60, y: 400, width: 240, height: 40 }, [0x1a, 0x1a, 0x6e], WHITE)
  drawText(image, { x: 60, y: 500, width: 140, height: 40 }, [0xcc, 0xcc, 0xcc], WHITE)
  for (let x = 40; x < 560; x++) fill(image, { x, y: 590, width: 1, height: 80 }, [255, Math.round(138 + (x - 40) / 4), 101])
  for (let x = 70; x < 380; x += 12) fill(image, { x, y: 610, width: 5, height: 40 }, WHITE)
  return image
}

const LOCATED = {
  blocks: [
    { text: 'Welcome back', kind: 'heading', box: box(60, 60, 480, 60) },
    { text: 'Forgot password?', kind: 'link', box: box(60, 200, 340, 40) },
    // Nothing is drawn here: the model saw text that is not in the pixels.
    { text: 'Ghost', kind: 'body', box: box(60, 300, 240, 40) },
    // The box landed on the "Create account" button.
    { text: 'Sign up', kind: 'button', box: box(60, 400, 240, 40) },
    { text: 'ACME', kind: 'logo', box: box(60, 500, 140, 40) },
    { text: 'Summer sale', kind: 'body', box: box(60, 600, 340, 60) },
  ],
}

/** Reads a crop the way a model would: by what is drawn in it, here told apart by the ink color. */
const INK: Record<string, string> = { '#202124': 'Welcome back', '#9e9e9e': 'Forgot password?', '#1a1a6e': 'Create account', '#cccccc': 'ACME' }

function scriptedVision(): ModelProvider & { calls: number } {
  const provider = {
    id: 'test:vision',
    calls: 0,
    async judge<T>(request: { system: string; images?: Array<{ data: Uint8Array }>; schema: { parse(value: unknown): T } }) {
      provider.calls++
      if (request.system.startsWith('You find the text')) return { output: request.schema.parse(LOCATED), inputTokens: 700, outputTokens: 400, latencyMs: 5, modelId: 'vision' }
      const crop = decodePng(request.images?.[0]?.data ?? new Uint8Array())
      const measured = measureTextContrast(crop, { x: 0, y: 0, width: crop.width, height: crop.height })
      const text = measured.ok ? (INK[measured.measure.foreground] ?? '') : 'Summer sale'
      return { output: request.schema.parse({ text }), inputTokens: 200, outputTokens: 8, latencyMs: 1, modelId: 'vision' }
    },
  }
  return provider
}

function options(provider: ModelProvider | undefined, extra: Partial<ImageCollectOptions> = {}): ImageCollectOptions {
  return { provider, cache: memoryCache(), offline: false, locale: 'en', label: 'mock.png', concurrency: 1, ...extra }
}

describe('image surface', () => {
  const png = encodePng(mockScreen())

  it('keeps only text the pixels and a blind reading of the crop confirm, and marks it as located by the model', async () => {
    const provider = scriptedVision()
    const { snapshot, notes, usage } = await checkImage(png, options(provider))
    expect(A11ySnapshotSchema.safeParse(snapshot).success).toBe(true)
    expect(snapshot).toMatchObject({ surface: 'image', target: 'mock.png', viewport: { width: W, height: H, scale: 1 } })
    expect(snapshot.root.children.map((n) => [n.ref, n.text, n.native.kind])).toEqual([
      ['text[1]', 'Welcome back', 'heading'],
      ['text[2]', 'Forgot password?', 'link'],
      ['text[3]', 'ACME', 'logo'],
      ['text[4]', 'Summer sale', 'body'],
    ])
    expect(snapshot.root.children.every((n) => n.states.includes('model-derived') && n.native.locatedBy === 'test:vision')).toBe(true)
    // One call to locate, one per box worth reading; the empty box never reached the model.
    expect(provider.calls).toBe(6)
    expect(usage).toMatchObject({ calls: 6, cachedCalls: 0, inputTokens: 1700 })
    expect(notes).toEqual([
      'An image has no accessibility tree: names, roles, states, focus order, language and structure cannot be checked from pixels. Only text contrast is measured, where a model found text.',
      'test:vision located 4 text block(s) in the image; 2 more did not hold up against the pixels and were dropped.',
    ])
  })

  it('measures contrast only: low contrast fails with medium confidence, logos are exempt, a gradient cannot be measured', async () => {
    const { engine } = await checkImage(png, options(scriptedVision()))
    expect(engine.rules.map((r) => `${r.ruleId}:${r.outcome}:${r.nodes.map((n) => n.ref).join(',')}`)).toEqual([
      'text-contrast:violation:text[2]',
      'text-contrast:incomplete:text[4]',
      'text-contrast:pass:text[1]',
    ])
    const [finding] = engineFindings(engine)
    expect(finding).toMatchObject({ criterion: '1.4.3', ref: 'text[2]', confidence: 'medium', locatedBy: 'test:vision', evidence: '#9e9e9e on #ffffff = 2.68:1' })
    expect(finding?.html).toMatch(/^"Forgot password\?" at x \d+, y \d+ \(\d+×\d+ px\)$/)
  })

  it('costs nothing the second time, and works offline from the cache', async () => {
    const cache = memoryCache()
    await checkImage(png, options(scriptedVision(), { cache }))
    const again = scriptedVision()
    const second = await checkImage(png, options(again, { cache, offline: true }))
    expect(again.calls).toBe(0)
    expect(second.usage).toMatchObject({ calls: 0, cachedCalls: 6 })
    expect(second.snapshot.root.children).toHaveLength(4)
  })

  it('says why nothing was measured: no model, nothing cached offline, or a model error', async () => {
    const none = await checkImage(png, options(undefined))
    expect(none.snapshot.root.children).toEqual([])
    expect(none.notes[1]).toBe('No model to find text in the image, so nothing was measured. Pass --model with a vision model.')
    expect(none.engine.rules.map((r) => r.outcome)).toEqual(['inapplicable'])

    const offline = await checkImage(png, options(scriptedVision(), { offline: true }))
    expect(offline.notes[1]).toBe('No cached text locations for this image (--offline), so nothing was measured.')

    const failing: ModelProvider = {
      id: 'test:down',
      async judge() {
        throw new Error('connection refused')
      },
    }
    const error = await checkImage(png, options(failing, { locale: 'pt-BR' }))
    expect(error.notes[1]).toBe('O modelo não conseguiu localizar texto na imagem, então nada foi medido: connection refused')
  })
})

describe('checking what the model claims', () => {
  it('matches a reading that shows the claimed words, in any order, and nothing else', () => {
    expect(sameText('Forgot password?', 'Forgot password')).toBe(true)
    expect(sameText('30% off', 'Summer sale: 30% off')).toBe(true)
    expect(sameText('you@example.com', 'you@example.com')).toBe(true)
    expect(sameText('Summer sale: 30% off', 'Forgot password')).toBe(false)
    expect(sameText('you@example.com', 'mail')).toBe(false)
    expect(sameText('Email', '')).toBe(false)
    expect(sameText('…', 'anything')).toBe(false)
  })

  it('drops boxes outside the image, inverted, as large as the screen, empty, or repeating another', () => {
    const image = mockScreen()
    const blocks = [
      { text: 'Welcome back', kind: 'heading' as const, box: box(60, 60, 480, 60) },
      { text: 'Welcome back', kind: 'heading' as const, box: box(62, 62, 470, 55) },
      { text: 'Off the edge', kind: 'body' as const, box: { left: 900, top: 100, right: 1400, bottom: 120 } },
      { text: 'Inverted', kind: 'body' as const, box: { left: 500, top: 100, right: 100, bottom: 120 } },
      { text: 'Everything', kind: 'body' as const, box: { left: 0, top: 0, right: 1000, bottom: 1000 } },
      { text: 'Ghost', kind: 'body' as const, box: box(60, 300, 240, 40) },
      { text: '—', kind: 'body' as const, box: box(60, 200, 340, 40) },
    ]
    expect(plausibleBlocks(blocks, image).map((block) => block.text)).toEqual(['Welcome back'])
  })
})
