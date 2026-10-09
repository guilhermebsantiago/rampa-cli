import { describe, expect, it } from 'vitest'
import { contrastRatio, formatRatio, measureTextContrast, relativeLuminance } from '../src/pixels/contrast.ts'
import { BLACK, WHITE, blank, drawText, fill } from './screens.ts'

const ratio = (a: readonly number[], b: readonly number[]) =>
  contrastRatio(relativeLuminance(a[0] ?? 0, a[1] ?? 0, a[2] ?? 0), relativeLuminance(b[0] ?? 0, b[1] ?? 0, b[2] ?? 0))

describe('WCAG contrast ratio', () => {
  it('matches the reference values', () => {
    expect(ratio(BLACK, WHITE)).toBeCloseTo(21, 5)
    expect(ratio([0x76, 0x76, 0x76], WHITE)).toBeCloseTo(4.54, 2)
    expect(ratio([0x77, 0x77, 0x77], WHITE)).toBeLessThan(4.5)
    expect(ratio(WHITE, WHITE)).toBe(1)
  })

  it('rounds for display, but never up onto a threshold the ratio misses', () => {
    expect(formatRatio(2.679)).toBe('2.68:1')
    expect(formatRatio(4.4999)).toBe('4.49:1')
    expect(formatRatio(2.9999)).toBe('2.99:1')
    expect(formatRatio(21)).toBe('21.00:1')
  })
})

describe('text contrast from pixels', () => {
  const box = { x: 10, y: 10, width: 200, height: 40 }

  it('measures light gray text on white below 3:1', () => {
    const image = blank(240, 80)
    drawText(image, box, [0x9e, 0x9e, 0x9e], WHITE)
    const result = measureTextContrast(image, box)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.measure).toMatchObject({ foreground: '#9e9e9e', background: '#ffffff' })
    expect(result.measure.ratio).toBeCloseTo(2.68, 2)
  })

  it('finds the text color, not its blended edges, and the background behind it', () => {
    const image = blank(240, 80, [0x10, 0x10, 0x10])
    drawText(image, box, WHITE, [0x1a, 0x73, 0xe8])
    const result = measureTextContrast(image, box)
    expect(result.ok && result.measure.foreground).toBe('#ffffff')
    expect(result.ok && result.measure.background).toBe('#1a73e8')
    expect(result.ok && result.measure.ratio).toBeCloseTo(4.52, 1)
  })

  it('does not guess over an image or a gradient', () => {
    const image = blank(240, 80)
    for (let x = 0; x < 240; x++) fill(image, { x, y: 0, width: 1, height: 80 }, [x, 255 - x, (x * 7) & 0xff])
    expect(measureTextContrast(image, box)).toEqual({ ok: false, reason: 'busy-background' })
  })

  it('measures a one-pixel stem that is fully covered, and refuses strokes with no covered pixel', () => {
    const image = blank(240, 80)
    drawText(image, box, [0x76, 0x76, 0x76], WHITE, 1)
    expect(measureTextContrast(image, box)).toMatchObject({ ok: true, measure: { foreground: '#767676' } })
    // Small text at a low resolution: each stem straddles two pixels, both only partly covered.
    const blurred = blank(240, 80)
    for (let x = 14; x < 200; x += 9) fill(blurred, { x, y: 18, width: 2, height: 24 }, [0xb0, 0xb0, 0xb0])
    expect(measureTextContrast(blurred, box)).toEqual({ ok: false, reason: 'thin-text' })
  })

  it('says when a box holds no text or lies off the image', () => {
    expect(measureTextContrast(blank(240, 80), box)).toEqual({ ok: false, reason: 'no-text-pixels' })
    expect(measureTextContrast(blank(240, 80), { x: 200, y: 60, width: 200, height: 80 })).toEqual({ ok: false, reason: 'outside' })
    expect(measureTextContrast(blank(240, 80), { x: 0, y: 0, width: 3, height: 3 })).toEqual({ ok: false, reason: 'too-small' })
  })

  it('leaves out a field underline and border darker than the placeholder inside them', () => {
    const image = blank(240, 80)
    const field = { x: 10, y: 10, width: 220, height: 60 }
    fill(image, field, [0xf1, 0xf3, 0xf4])
    drawText(image, { x: 20, y: 22, width: 120, height: 36 }, [0x8a, 0x8a, 0x8a], [0xf1, 0xf3, 0xf4])
    fill(image, { x: 10, y: 66, width: 220, height: 4 }, [0x5f, 0x63, 0x68])
    fill(image, { x: 10, y: 10, width: 2, height: 60 }, [0x5f, 0x63, 0x68])
    const result = measureTextContrast(image, field)
    expect(result).toMatchObject({ ok: true, measure: { foreground: '#8a8a8a', background: '#f1f3f4' } })
    expect(result.ok && result.measure.ratio).toBeCloseTo(3.09, 1)
  })

  it('cannot be fooled into a lower ratio by a darker element in the box', () => {
    // An icon next to the text only adds a more contrasting color: the ratio can go up, never down.
    const image = blank(240, 80)
    drawText(image, box, [0x9e, 0x9e, 0x9e], WHITE)
    fill(image, { x: 12, y: 18, width: 14, height: 14 }, BLACK)
    const result = measureTextContrast(image, box)
    expect(result.ok && result.measure.ratio).toBeGreaterThan(20)
  })
})
