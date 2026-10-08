import { crc32, deflateSync } from 'node:zlib'
import { PNG } from 'pngjs'
import { describe, expect, it } from 'vitest'
import { clipRect, cropImage, decodePng, encodePng, isPng, pngDataUri, pngFromBase64, pngSize } from '../src/pixels/png.ts'

/** A deterministic RGBA pattern with every channel varying, so filters have something to predict. */
function pattern(width: number, height: number, opaque = true): Uint8Array {
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4
      data[at] = (x * 37 + y * 11) & 0xff
      data[at + 1] = (x * 5 + y * 53) & 0xff
      data[at + 2] = (x * y + 91) & 0xff
      data[at + 3] = opaque ? 255 : (x * 17 + y * 3) & 0xff
    }
  }
  return data
}

function chunk(type: string, body: Uint8Array): Buffer {
  const out = Buffer.alloc(body.length + 12)
  out.writeUInt32BE(body.length, 0)
  out.write(type, 4, 'ascii')
  Buffer.from(body).copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length)
  return out
}

function png(ihdr: { width: number; height: number; bitDepth: number; colorType: number; interlace?: number }, raw: Uint8Array, extra: Buffer[] = []): Buffer {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(ihdr.width, 0)
  header.writeUInt32BE(ihdr.height, 4)
  header.set([ihdr.bitDepth, ihdr.colorType, 0, 0, ihdr.interlace ?? 0], 8)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    ...extra,
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', new Uint8Array()),
  ])
}

describe('PNG codec', () => {
  it('reads back what it writes', () => {
    const image = { width: 13, height: 7, data: pattern(13, 7, false) }
    const bytes = encodePng(image)
    expect(isPng(bytes)).toBe(true)
    expect(pngSize(bytes)).toEqual({ width: 13, height: 7 })
    expect(decodePng(bytes)).toEqual(image)
  })

  // pngjs writes the reference files: every row filter, RGB and RGBA, 8 and 16 bits, gray with and without alpha.
  it.each([
    { colorType: 6, bitDepth: 8 },
    { colorType: 2, bitDepth: 8 },
    { colorType: 6, bitDepth: 16 },
    { colorType: 2, bitDepth: 16 },
    { colorType: 0, bitDepth: 8 },
    { colorType: 4, bitDepth: 8 },
  ] as const)('decodes color type $colorType at $bitDepth bits with every filter', ({ colorType, bitDepth }) => {
    const width = 21
    const height = 9
    const source = new PNG({ width, height })
    source.data = Buffer.from(pattern(width, height, colorType === 6 || colorType === 4))
    for (const filterType of [0, 1, 2, 3, 4, -1]) {
      const bytes = PNG.sync.write(source, { colorType, bitDepth, filterType, inputColorType: 6 })
      const reference = PNG.sync.read(bytes)
      const decoded = decodePng(bytes)
      expect(decoded.width).toBe(width)
      expect(Buffer.from(decoded.data).equals(reference.data), `filter ${filterType}`).toBe(true)
    }
  })

  it('decodes a 2-bit palette with transparency', () => {
    // Four colors, the last one transparent; rows of 5 pixels take 2 bytes each.
    const palette = Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 9, 9, 9])
    const trns = Buffer.from([255, 255, 255, 0])
    const indices = [
      [0, 1, 2, 3, 0],
      [3, 2, 1, 0, 1],
    ]
    const raw: number[] = []
    for (const row of indices) {
      raw.push(0)
      let bits = 0
      let count = 0
      const bytes: number[] = []
      for (const index of row) {
        bits = (bits << 2) | index
        count++
        if (count === 4) {
          bytes.push(bits)
          bits = 0
          count = 0
        }
      }
      if (count > 0) bytes.push(bits << (2 * (4 - count)))
      raw.push(...bytes)
    }
    const bytes = png({ width: 5, height: 2, bitDepth: 2, colorType: 3 }, Uint8Array.from(raw), [chunk('PLTE', palette), chunk('tRNS', trns)])
    const image = decodePng(bytes)
    const pixel = (x: number, y: number) => [...image.data.subarray((y * 5 + x) * 4, (y * 5 + x) * 4 + 4)]
    expect(pixel(0, 0)).toEqual([255, 0, 0, 255])
    expect(pixel(2, 0)).toEqual([0, 0, 255, 255])
    expect(pixel(3, 0)).toEqual([9, 9, 9, 0])
    expect(pixel(4, 1)).toEqual([0, 255, 0, 255])
  })

  it('places the seven passes of an interlaced image', () => {
    const width = 11
    const height = 10
    const data = pattern(width, height)
    const passes = [
      [0, 0, 8, 8],
      [4, 0, 8, 8],
      [0, 4, 4, 8],
      [2, 0, 4, 4],
      [0, 2, 2, 4],
      [1, 0, 2, 2],
      [0, 1, 1, 2],
    ] as const
    const raw: number[] = []
    for (const [x0, y0, dx, dy] of passes) {
      for (let y = y0; y < height; y += dy) {
        if (x0 >= width) break
        raw.push(0)
        for (let x = x0; x < width; x += dx) raw.push(...data.subarray((y * width + x) * 4, (y * width + x) * 4 + 4))
      }
    }
    const decoded = decodePng(png({ width, height, bitDepth: 8, colorType: 6, interlace: 1 }, Uint8Array.from(raw)))
    expect(Buffer.from(decoded.data).equals(Buffer.from(data))).toBe(true)
  })

  it('refuses a file that is not a PNG or fails its checksum', () => {
    expect(() => decodePng(Buffer.from('GIF89a'))).toThrow(/PNG signature/)
    const bytes = encodePng({ width: 2, height: 2, data: pattern(2, 2) })
    bytes[bytes.length - 20] = (bytes[bytes.length - 20] ?? 0) ^ 0xff
    expect(() => decodePng(bytes)).toThrow(/checksum/)
  })

  it('crops inside the image, rounding outwards and clipping at the edges', () => {
    const image = { width: 10, height: 10, data: pattern(10, 10) }
    expect(clipRect(image, { x: 2.5, y: 3.2, width: 3, height: 2 })).toEqual({ x: 2, y: 3, width: 4, height: 3 })
    expect(clipRect(image, { x: 8, y: 8, width: 5, height: 5 })).toEqual({ x: 8, y: 8, width: 2, height: 2 })
    expect(clipRect(image, { x: 12, y: 0, width: 5, height: 5 })).toBeUndefined()
    const crop = cropImage(image, { x: 1, y: 2, width: 3, height: 2 })
    expect(crop?.width).toBe(3)
    expect([...(crop?.data.subarray(0, 4) ?? [])]).toEqual([...image.data.subarray((2 * 10 + 1) * 4, (2 * 10 + 1) * 4 + 4)])
  })

  it('round-trips through a data URI and bare base64', () => {
    const image = { width: 3, height: 3, data: pattern(3, 3) }
    const uri = pngDataUri(image)
    expect(uri.startsWith('data:image/png;base64,')).toBe(true)
    const fromUri = pngFromBase64(uri)
    const fromBare = pngFromBase64(uri.slice('data:image/png;base64,'.length))
    expect(fromUri && decodePng(fromUri)).toEqual(image)
    expect(fromBare && decodePng(fromBare)).toEqual(image)
    expect(pngFromBase64('bm90IGEgcG5n')).toBeUndefined()
  })
})
