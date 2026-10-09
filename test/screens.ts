import type { PixelRect, RgbaImage } from '../src/pixels/png.ts'

export type Rgb = readonly [number, number, number]

export const WHITE: Rgb = [255, 255, 255]
export const BLACK: Rgb = [0, 0, 0]

export function blank(width: number, height: number, color: Rgb = WHITE): RgbaImage {
  const image = { width, height, data: new Uint8Array(width * height * 4) }
  fill(image, { x: 0, y: 0, width, height }, color)
  return image
}

export function fill(image: RgbaImage, rect: PixelRect, color: Rgb): void {
  for (let y = Math.max(0, rect.y); y < Math.min(image.height, rect.y + rect.height); y++) {
    for (let x = Math.max(0, rect.x); x < Math.min(image.width, rect.x + rect.width); x++) {
      const at = (y * image.width + x) * 4
      image.data.set([color[0], color[1], color[2], 255], at)
    }
  }
}

const blend = (a: Rgb, b: Rgb, t: number): Rgb => [
  Math.round(a[0] * t + b[0] * (1 - t)),
  Math.round(a[1] * t + b[1] * (1 - t)),
  Math.round(a[2] * t + b[2] * (1 - t)),
]

/**
 * Something that measures like rendered text: on its background, vertical stems of
 * `stroke` solid pixels with a half-covered pixel on each side, as anti-aliasing leaves them.
 */
export function drawText(image: RgbaImage, rect: PixelRect, color: Rgb, background: Rgb, stroke = 4): void {
  fill(image, rect, background)
  const top = rect.y + Math.round(rect.height * 0.2)
  const height = Math.round(rect.height * 0.6)
  const edge = blend(color, background, 0.5)
  for (let x = rect.x + 3; x + stroke + 1 < rect.x + rect.width; x += stroke + 7) {
    fill(image, { x: x - 1, y: top, width: 1, height }, edge)
    fill(image, { x, y: top, width: stroke, height }, color)
    fill(image, { x: x + stroke, y: top, width: 1, height }, edge)
  }
}
