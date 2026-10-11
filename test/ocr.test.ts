import { readFile } from 'node:fs/promises'
import { afterAll, describe, expect, it } from 'vitest'
import { memoryCache } from '../src/core/cache.ts'
import { checkSnapshot } from '../src/core/check.ts'
import { imagesOfText } from '../src/criteria/images-of-text.ts'
import { emptyEngine } from '../src/engine/axe.ts'
import { measured, openOcr, scaleFor, textShare } from '../src/pixels/ocr.ts'
import { type RgbaImage, decodePng } from '../src/pixels/png.ts'
import type { ModelProvider } from '../src/providers/types.ts'
import type { A11ySnapshot } from '../src/snapshot/schema.ts'
import { node } from './helpers.ts'

/** A white picture with a black block, the way a word's strokes sit on a plain background. */
function block(width: number, height: number, area: { x: number; y: number; width: number; height: number }): RgbaImage {
  const data = new Uint8Array(width * height * 4).fill(255)
  for (let y = area.y; y < area.y + area.height; y++) {
    for (let x = area.x; x < area.x + area.width; x++) data.set([0, 0, 0, 255], (y * width + x) * 4)
  }
  return { width, height, data }
}

describe('text share', () => {
  const image = block(100, 40, { x: 20, y: 10, width: 60, height: 20 })

  it("is the part of the picture's detail inside the words read", () => {
    const all = measured(image, [{ text: 'Word', confidence: 90, box: { x: 20, y: 10, width: 60, height: 20 } }])
    expect(all.detail).toBeGreaterThan(0)
    expect(textShare(all)).toBe(1)
    const half = measured(image, [{ text: 'Word', confidence: 90, box: { x: 50, y: 0, width: 50, height: 40 } }])
    expect(textShare(half)).toBeGreaterThan(0.3)
    expect(textShare(half)).toBeLessThan(0.7)
    expect(textShare(measured(image, []))).toBe(0)
  })

  it('enlarges small pictures before reading them, up to four times', () => {
    expect(scaleFor({ height: 200 })).toBe(1)
    expect(scaleFor({ height: 45 })).toBe(2.5)
    expect(scaleFor({ height: 20 })).toBe(4)
  })
})

const ocr = await openOcr()
afterAll(async () => ocr?.close())
const fixture = async (name: string) => decodePng(new Uint8Array(await readFile(`test/fixtures/ocr/${name}`)))

describe.skipIf(!ocr)('OCR with tesseract.js, offline', { timeout: 60_000 }, () => {
  it('reads a banner of text, and finds it is all text', async () => {
    const reading = await ocr?.read(await fixture('banner.png'))
    expect(reading?.words.map((word) => word.text.toLowerCase())).toEqual(expect.arrayContaining(['summer', 'sale']))
    expect(textShare(reading ?? { words: [], detail: 0 })).toBeGreaterThan(0.5)
  })

  it('reads the label of a small button', async () => {
    const reading = await ocr?.read(await fixture('button.png'))
    expect(reading?.words.map((word) => word.text.toLowerCase()).join(' ')).toContain('press')
  })

  it('finds a sign in a busy picture is a small part of it', async () => {
    const reading = await ocr?.read(await fixture('photo.png'))
    expect(textShare(reading ?? { words: [], detail: 0 })).toBeLessThan(0.5)
  })

  it('sends 1.4.5 only the pictures OCR reads as mostly text, and keeps a fail only where OCR read its words', async () => {
    const uri = async (name: string) => `data:image/png;base64,${(await readFile(`test/fixtures/ocr/${name}`)).toString('base64')}`
    const picture = async (ref: string, name: string, width: number, height: number) =>
      node({ ref, role: 'img', name: '', image: await uri(name), bounds: { x: 0, y: 0, width, height }, native: { tag: 'img', attributes: { src: name, alt: '' } } })
    const snapshot: A11ySnapshot = {
      schemaVersion: 1,
      surface: 'web',
      target: 'https://shop.example/sale',
      locale: 'en',
      viewport: { width: 1280, height: 800, scale: 1 },
      collectedAt: '2026-10-11T00:00:00.000Z',
      collector: { name: 'test', version: '0' },
      root: node({ ref: 'html', role: 'document', children: [await picture('#banner', 'banner.png', 480, 100), await picture('#photo', 'photo.png', 320, 200)] }),
    }
    const asked: string[] = []
    const provider: ModelProvider = {
      id: 'test:always-text',
      async judge(request) {
        asked.push(request.user)
        return { output: request.schema.parse({ imageShows: 'Text', evidence: 'Summer sale today', exception: 'none', verdict: 'fail', confidence: 'high' }), inputTokens: 1, outputTokens: 1, latencyMs: 1, modelId: 'x' }
      },
    }
    const report = await checkSnapshot(snapshot, emptyEngine(), {
      criteria: [imagesOfText],
      llm: true,
      provider,
      runs: 1,
      cache: memoryCache(),
      offline: false,
      locale: 'en',
      minConfidence: 'low',
      concurrency: 2,
      rules: false,
    })
    expect(asked).toHaveLength(1)
    expect(asked[0]).toContain('banner.png')
    expect(report.findings.map((f) => f.ref)).toEqual(['#banner'])
    expect(report.criteria.find((c) => c.criterion === '1.4.5')).toMatchObject({ candidates: 2, decided: 1, failed: 1 })
  })
})
