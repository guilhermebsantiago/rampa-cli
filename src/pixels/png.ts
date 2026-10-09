import { crc32, deflateSync, inflateSync } from 'node:zlib'
import { RampaError } from '../core/util.ts'

/**
 * A small PNG codec on node:zlib, so screenshots can be cropped and measured without a
 * dependency. It reads every PNG the format allows (bit depths 1 to 16, gray, RGB,
 * palette, alpha, Adam7 interlacing) and writes 8-bit RGBA.
 */

/** Pixels as 8-bit RGBA, row by row. */
export interface RgbaImage {
  width: number
  height: number
  data: Uint8Array
}

export interface PixelRect {
  x: number
  y: number
  width: number
  height: number
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** Screens are a few megapixels; this keeps a hostile file from asking for gigabytes. */
const MAX_PIXELS = 50_000_000

export function isPng(bytes: Uint8Array): boolean {
  return bytes.length >= 8 && SIGNATURE.every((byte, i) => bytes[i] === byte)
}

/** Width and height from the header, without decoding the pixels. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | undefined {
  if (!isPng(bytes) || bytes.length < 24) return undefined
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

interface Header {
  width: number
  height: number
  bitDepth: number
  colorType: number
  interlace: number
}

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }

function corrupt(reason: string): RampaError {
  return new RampaError('invalid-png', `Not a readable PNG: ${reason}`)
}

export function decodePng(bytes: Uint8Array): RgbaImage {
  if (!isPng(bytes)) throw corrupt('the file does not start with the PNG signature')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let header: Header | undefined
  let palette: Uint8Array | undefined
  let transparency: Uint8Array | undefined
  const data: Uint8Array[] = []
  let offset = 8
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset)
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8))
    const start = offset + 8
    const end = start + length
    if (end + 4 > bytes.length) throw corrupt(`chunk ${type} runs past the end of the file`)
    if (crc32(bytes.subarray(offset + 4, end)) !== view.getUint32(end)) throw corrupt(`chunk ${type} fails its checksum`)
    const body = bytes.subarray(start, end)
    if (type === 'IHDR') {
      const chunk = new DataView(body.buffer, body.byteOffset, body.byteLength)
      header = { width: chunk.getUint32(0), height: chunk.getUint32(4), bitDepth: body[8] ?? 0, colorType: body[9] ?? 0, interlace: body[12] ?? 0 }
    } else if (type === 'PLTE') palette = body
    else if (type === 'tRNS') transparency = body
    else if (type === 'IDAT') data.push(body)
    else if (type === 'IEND') break
    offset = end + 4
  }
  if (!header) throw corrupt('no IHDR chunk')
  const { width, height, bitDepth, colorType, interlace } = header
  const channels = CHANNELS[colorType]
  if (channels === undefined || ![1, 2, 4, 8, 16].includes(bitDepth)) throw corrupt(`unsupported color type ${colorType} with bit depth ${bitDepth}`)
  if (width === 0 || height === 0 || width * height > MAX_PIXELS) throw corrupt(`unsupported size ${width}×${height}`)
  if (colorType === 3 && !palette) throw corrupt('a palette image without a palette')

  let raw: Uint8Array
  try {
    raw = inflateSync(Buffer.concat(data))
  } catch (error) {
    throw corrupt(`the image data does not decompress (${error instanceof Error ? error.message : String(error)})`)
  }
  const out = new Uint8Array(width * height * 4)
  const bitsPerPixel = channels * bitDepth
  const sample = sampler(header, channels, palette, transparency)

  if (interlace === 0) {
    const rows = unfilter(raw, 0, width, height, bitsPerPixel)
    // Phone and browser screenshots are 8-bit RGBA or RGB: copy them without a call per pixel.
    if (bitDepth === 8 && colorType === 6) return { width, height, data: rows }
    if (bitDepth === 8 && colorType === 2 && !transparency) {
      for (let i = 0, j = 0; i < rows.length; i += 3, j += 4) {
        out[j] = rows[i] ?? 0
        out[j + 1] = rows[i + 1] ?? 0
        out[j + 2] = rows[i + 2] ?? 0
        out[j + 3] = 255
      }
      return { width, height, data: out }
    }
    paint(rows, width, height, bitsPerPixel, sample, out, width, (x, y) => [x, y])
  } else {
    // Adam7: seven passes, each a smaller image whose pixels land on a grid of the full one.
    const passes: Array<[number, number, number, number]> = [
      [0, 0, 8, 8],
      [4, 0, 8, 8],
      [0, 4, 4, 8],
      [2, 0, 4, 4],
      [0, 2, 2, 4],
      [1, 0, 2, 2],
      [0, 1, 1, 2],
    ]
    let position = 0
    for (const [x0, y0, dx, dy] of passes) {
      const passWidth = Math.ceil((width - x0) / dx)
      const passHeight = Math.ceil((height - y0) / dy)
      if (passWidth <= 0 || passHeight <= 0) continue
      const rows = unfilter(raw, position, passWidth, passHeight, bitsPerPixel)
      position += passHeight * (1 + Math.ceil((passWidth * bitsPerPixel) / 8))
      paint(rows, passWidth, passHeight, bitsPerPixel, sample, out, width, (x, y) => [x0 + x * dx, y0 + y * dy])
    }
  }
  return { width, height, data: out }
}

/** Reverses the per-row filters; returns the rows without their filter byte. */
function unfilter(raw: Uint8Array, start: number, width: number, height: number, bitsPerPixel: number): Uint8Array {
  const stride = Math.ceil((width * bitsPerPixel) / 8)
  const bpp = Math.max(1, Math.ceil(bitsPerPixel / 8))
  const rows = new Uint8Array(stride * height)
  if (start + height * (stride + 1) > raw.length) throw corrupt('the image data is shorter than its size')
  for (let y = 0; y < height; y++) {
    const filter = raw[start + y * (stride + 1)]
    const line = raw.subarray(start + y * (stride + 1) + 1, start + (y + 1) * (stride + 1))
    const row = y * stride
    const above = row - stride
    for (let i = 0; i < stride; i++) {
      const value = line[i] ?? 0
      const left = i >= bpp ? (rows[row + i - bpp] ?? 0) : 0
      const up = y > 0 ? (rows[above + i] ?? 0) : 0
      const upLeft = y > 0 && i >= bpp ? (rows[above + i - bpp] ?? 0) : 0
      let predicted: number
      switch (filter) {
        case 0:
          predicted = 0
          break
        case 1:
          predicted = left
          break
        case 2:
          predicted = up
          break
        case 3:
          predicted = (left + up) >> 1
          break
        case 4: {
          const p = left + up - upLeft
          const pa = Math.abs(p - left)
          const pb = Math.abs(p - up)
          const pc = Math.abs(p - upLeft)
          predicted = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft
          break
        }
        default:
          throw corrupt(`unknown row filter ${filter}`)
      }
      rows[row + i] = (value + predicted) & 0xff
    }
  }
  return rows
}

type Sampler = (rows: Uint8Array, rowStart: number, x: number) => [number, number, number, number]

/** Reads pixel x of a row as RGBA8, whatever the color type and bit depth. */
function sampler(header: Header, channels: number, palette: Uint8Array | undefined, transparency: Uint8Array | undefined): Sampler {
  const { bitDepth, colorType } = header
  const max = (1 << bitDepth) - 1
  // Samples at their original depth, so a tRNS color key compares exactly.
  const raw = (rows: Uint8Array, rowStart: number, index: number): number => {
    if (bitDepth === 8) return rows[rowStart + index] ?? 0
    if (bitDepth === 16) return ((rows[rowStart + index * 2] ?? 0) << 8) | (rows[rowStart + index * 2 + 1] ?? 0)
    const bit = index * bitDepth
    const byte = rows[rowStart + (bit >> 3)] ?? 0
    return (byte >> (8 - bitDepth - (bit & 7))) & max
  }
  const to8 = (value: number): number => (bitDepth === 8 ? value : Math.round((value * 255) / max))
  const key = (offset: number): number | undefined =>
    transparency && transparency.length >= offset + 2 ? ((transparency[offset] ?? 0) << 8) | (transparency[offset + 1] ?? 0) : undefined
  switch (colorType) {
    case 0: {
      const gray = key(0)
      return (rows, rowStart, x) => {
        const value = raw(rows, rowStart, x)
        const v = to8(value)
        return [v, v, v, value === gray ? 0 : 255]
      }
    }
    case 2: {
      const [kr, kg, kb] = [key(0), key(2), key(4)]
      return (rows, rowStart, x) => {
        const r = raw(rows, rowStart, x * 3)
        const g = raw(rows, rowStart, x * 3 + 1)
        const b = raw(rows, rowStart, x * 3 + 2)
        return [to8(r), to8(g), to8(b), r === kr && g === kg && b === kb ? 0 : 255]
      }
    }
    case 3:
      return (rows, rowStart, x) => {
        const index = raw(rows, rowStart, x)
        const at = index * 3
        return [palette?.[at] ?? 0, palette?.[at + 1] ?? 0, palette?.[at + 2] ?? 0, transparency?.[index] ?? 255]
      }
    case 4:
      return (rows, rowStart, x) => {
        const v = to8(raw(rows, rowStart, x * 2))
        return [v, v, v, to8(raw(rows, rowStart, x * 2 + 1))]
      }
    default:
      return (rows, rowStart, x) => [
        to8(raw(rows, rowStart, x * channels)),
        to8(raw(rows, rowStart, x * channels + 1)),
        to8(raw(rows, rowStart, x * channels + 2)),
        to8(raw(rows, rowStart, x * channels + 3)),
      ]
  }
}

function paint(
  rows: Uint8Array,
  width: number,
  height: number,
  bitsPerPixel: number,
  sample: Sampler,
  out: Uint8Array,
  outWidth: number,
  place: (x: number, y: number) => [number, number],
): void {
  const stride = Math.ceil((width * bitsPerPixel) / 8)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = sample(rows, y * stride, x)
      const [tx, ty] = place(x, y)
      const at = (ty * outWidth + tx) * 4
      out[at] = r
      out[at + 1] = g
      out[at + 2] = b
      out[at + 3] = a
    }
  }
}

export function encodePng(image: RgbaImage): Buffer {
  const { width, height, data } = image
  const stride = width * 4
  const raw = Buffer.alloc(height * (stride + 1))
  for (let y = 0; y < height; y++) {
    // Filter 0 (none): crops are small, and plain rows keep the encoder simple.
    raw[y * (stride + 1)] = 0
    raw.set(data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1)
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, 6, 0, 0, 0], 8)
  return Buffer.concat([Buffer.from(SIGNATURE), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

function chunk(type: string, body: Buffer): Buffer {
  const out = Buffer.alloc(body.length + 12)
  out.writeUInt32BE(body.length, 0)
  out.write(type, 4, 'ascii')
  body.copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length)
  return out
}

/** The part of the image inside rect, rounded outwards to whole pixels and clipped to the image. */
export function clipRect(image: Pick<RgbaImage, 'width' | 'height'>, rect: PixelRect): PixelRect | undefined {
  const x0 = Math.max(0, Math.floor(rect.x))
  const y0 = Math.max(0, Math.floor(rect.y))
  const x1 = Math.min(image.width, Math.ceil(rect.x + rect.width))
  const y1 = Math.min(image.height, Math.ceil(rect.y + rect.height))
  if (x1 <= x0 || y1 <= y0) return undefined
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

export function cropImage(image: RgbaImage, rect: PixelRect): RgbaImage | undefined {
  const clipped = clipRect(image, rect)
  if (!clipped) return undefined
  const data = new Uint8Array(clipped.width * clipped.height * 4)
  for (let y = 0; y < clipped.height; y++) {
    const from = ((clipped.y + y) * image.width + clipped.x) * 4
    data.set(image.data.subarray(from, from + clipped.width * 4), y * clipped.width * 4)
  }
  return { width: clipped.width, height: clipped.height, data }
}

export function pngDataUri(image: RgbaImage): string {
  return `data:image/png;base64,${encodePng(image).toString('base64')}`
}

/** A screenshot that may be cut short or damaged: undefined instead of an error, since checks can run without one. */
export function tryDecodePng(bytes: Uint8Array): RgbaImage | undefined {
  try {
    return decodePng(bytes)
  } catch {
    return undefined
  }
}

/** PNG bytes from a data URI or bare base64, as exporters write them. */
export function pngFromBase64(value: string): Buffer | undefined {
  const match = /^data:image\/png;base64,(.*)$/s.exec(value)
  const bytes = Buffer.from(match?.[1] ?? value, 'base64')
  return isPng(bytes) ? bytes : undefined
}
