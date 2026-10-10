import { describe, expect, it } from 'vitest'
import { memoryCache } from '../src/core/cache.ts'
import { type CheckOptions, checkSnapshot } from '../src/core/check.ts'
import type { EngineResults } from '../src/core/types.ts'
import { measurePair } from '../src/pixels/pair-contrast.ts'
import type { RgbaImage } from '../src/pixels/png.ts'
import { contrastCall, isLargeText, pixelContrastRule, placeholderContrastRule } from '../src/rules/contrast.ts'
import { runRuleChecks, withoutResolved } from '../src/rules/index.ts'
import type { PixelContrastFact } from '../src/snapshot/pixel-contrast.ts'
import type { A11ySnapshot } from '../src/snapshot/schema.ts'
import { node } from './helpers.ts'
import { type Rgb, WHITE, blank, fill } from './screens.ts'

/** Glyph-like stems of `stroke` pixels in `color`, with a half-covered pixel on each side, over whatever `image` holds. */
function stems(image: RgbaImage, color: Rgb, stroke = 4, edge = true): void {
  for (let x = 6; x + stroke + 1 < image.width - 4; x += stroke + 7) {
    for (let y = 8; y < image.height - 8; y++) {
      for (let dx = -1; dx <= stroke; dx++) {
        const at = (y * image.width + x + dx) * 4
        const covered = dx === -1 || dx === stroke ? (edge ? 0.5 : 0) : 1
        for (let c = 0; c < 3; c++) image.data[at + c] = Math.round((color[c] ?? 0) * covered + (image.data[at + c] ?? 0) * (1 - covered))
      }
    }
  }
}

/** A horizontal gradient between two grays. */
function gradient(width: number, height: number, from: number, to: number): RgbaImage {
  const image = blank(width, height)
  for (let x = 0; x < width; x++) {
    const v = Math.round(from + ((to - from) * x) / (width - 1))
    fill(image, { x, y: 0, width: 1, height }, [v, v, v])
  }
  return image
}

const copy = (image: RgbaImage): RgbaImage => ({ ...image, data: new Uint8Array(image.data) })

describe('contrast from a pair of captures', () => {
  it('compares the style sheet color with the gradient behind each glyph, highest and lowest', () => {
    const bare = gradient(200, 40, 0xff, 0xcc)
    const rendered = copy(bare)
    stems(rendered, [0xaa, 0xaa, 0xaa])
    const result = measurePair({ rendered, bare, foreground: [0xaa, 0xaa, 0xaa, 1] })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.measure.foregroundFrom).toBe('css')
    expect(result.measure.foreground).toBe('#aaaaaa')
    // #aaa on white is 2.32:1, on #ccc 1.45:1: below 4.5 everywhere.
    expect(result.measure.highest).toBeLessThan(2.33)
    expect(result.measure.highest).toBeGreaterThan(2.2)
    expect(result.measure.lowest).toBeLessThan(1.6)
  })

  it('composites a translucent text color over what is behind each pixel', () => {
    // rgba(90, 90, 90, 0.8) is 4.23:1 on white and 2.30:1 on black: ACT afw4f7 Failed Example 7.
    const bare = blank(200, 40)
    fill(bare, { x: 100, y: 0, width: 100, height: 40 }, [0, 0, 0])
    const rendered = copy(bare)
    for (const [x0, behind] of [
      [0, WHITE],
      [100, [0, 0, 0] as Rgb],
    ] as const) {
      const shown: Rgb = [Math.round(90 * 0.8 + behind[0] * 0.2), Math.round(90 * 0.8 + behind[1] * 0.2), Math.round(90 * 0.8 + behind[2] * 0.2)]
      for (let x = x0 + 10; x < x0 + 90; x += 10) fill(rendered, { x, y: 8, width: 4, height: 24 }, shown)
    }
    const result = measurePair({ rendered, bare, foreground: [90, 90, 90, 0.8] })
    expect(result.ok && result.measure.foreground).toBe('#5a5a5acc')
    expect(result.ok && result.measure.highest).toBeCloseTo(4.23, 1)
    expect(result.ok && result.measure.lowest).toBeCloseTo(2.3, 1)
  })

  it('reads the color from the pixels when the style sheet color is not in them', () => {
    const bare = blank(200, 40)
    const rendered = copy(bare)
    stems(rendered, [0x76, 0x76, 0x76])
    // The style sheet says black, but a filter or blend made it gray: the pixels win.
    const result = measurePair({ rendered, bare, foreground: [0, 0, 0, 1] })
    expect(result.ok && result.measure.foregroundFrom).toBe('pixels')
    expect(result.ok && result.measure.foreground).toBe('#767676')
    expect(result.ok && result.measure.highest).toBeCloseTo(4.54, 2)
    expect(result.ok && result.measure.uniform).toBe(true)
    expect(result.ok && result.measure.stroke).toBeGreaterThanOrEqual(4)
  })

  it('looks only at the regions it is given, and refuses what it cannot read', () => {
    const bare = blank(200, 40)
    const rendered = copy(bare)
    stems(rendered, [0x33, 0x33, 0x33])
    expect(measurePair({ rendered, bare, regions: [{ x: 0, y: 0, width: 4, height: 40 }] })).toEqual({ ok: false, reason: 'no-text-pixels' })
    expect(measurePair({ rendered: bare, bare })).toEqual({ ok: false, reason: 'no-text-pixels' })
    expect(measurePair({ rendered, bare: blank(150, 40) })).toEqual({ ok: false, reason: 'size-mismatch' })
    // A background that changed everywhere between the two captures (a video, a carousel) is not text.
    expect(measurePair({ rendered: blank(200, 40, [0x20, 0x20, 0x20]), bare })).toEqual({ ok: false, reason: 'unstable' })
  })
})

describe('the thresholds', () => {
  it('reads large text as WCAG and axe-core do: 18 pt, or 14 pt bold', () => {
    expect(isLargeText(24, 400)).toBe(true)
    expect(isLargeText(23.9, 400)).toBe(false)
    expect(isLargeText(18.66, 700)).toBe(true)
    expect(isLargeText(18.66, 600)).toBe(false)
    expect(isLargeText(undefined, 700)).toBe(false)
  })

  const measured = (highest: number, lowest: number, extra: Partial<PixelContrastFact> = {}): PixelContrastFact => ({
    kind: 'text',
    status: 'measured',
    foreground: '#777777',
    foregroundFrom: 'css',
    background: { common: '#ffffff', worst: '#ffffff', best: '#ffffff' },
    highest,
    lowest,
    pixels: 500,
    stroke: 3,
    ...extra,
  })

  it('fails when even the highest contrast is short, passes when even the lowest is enough, and asks a person in between', () => {
    expect(contrastCall(measured(4.29, 4.08), 4.5)).toEqual({ outcome: 'fail', why: 'below' })
    expect(contrastCall(measured(4.95, 4.79), 4.5)).toEqual({ outcome: 'pass', why: 'enough' })
    expect(contrastCall(measured(7.46, 2.82), 4.5)).toEqual({ outcome: 'review', why: 'mixed' })
    expect(contrastCall(measured(3.45, 3.34), 3)).toEqual({ outcome: 'pass', why: 'enough' })
    expect(contrastCall({ kind: 'text', status: 'unmeasured', reason: 'moving' }, 4.5)).toEqual({ outcome: 'review', why: 'unmeasured' })
  })

  it('does not fail on a color read from thin strokes, nor pass one of many colors', () => {
    expect(contrastCall(measured(2.1, 1.8, { foregroundFrom: 'pixels', stroke: 2 }), 4.5)).toEqual({ outcome: 'review', why: 'thin' })
    expect(contrastCall(measured(2.1, 1.8, { foregroundFrom: 'pixels', stroke: 3 }), 4.5)).toEqual({ outcome: 'fail', why: 'below' })
    expect(contrastCall(measured(9, 6, { foregroundFrom: 'pixels', uniform: false }), 4.5)).toEqual({ outcome: 'review', why: 'varied' })
    // Translucent when captured: a fade a script was running, as likely as a design.
    expect(contrastCall(measured(2.1, 1.8, { opacity: 0.5 }), 4.5)).toEqual({ outcome: 'review', why: 'translucent' })
  })
})

/** A page whose two paragraphs axe-core could not decide, measured by the collector. */
function measuredPage(facts: Record<string, PixelContrastFact>, run?: Record<string, unknown>): { snapshot: A11ySnapshot; engine: EngineResults } {
  const refs = Object.keys(facts)
  const snapshot: A11ySnapshot = {
    schemaVersion: 1,
    surface: 'web',
    target: 'test://contrast',
    viewport: { width: 1280, height: 800, scale: 1 },
    collectedAt: '2026-10-09T00:00:00.000Z',
    collector: { name: 'test', version: '0' },
    root: node({
      ref: 'html',
      role: 'document',
      native: run ? { pixelContrastRun: run } : {},
      children: refs.map((ref) => {
        const fact = facts[ref] as PixelContrastFact
        return node({ ref, role: fact.kind === 'placeholder' ? 'textbox' : 'paragraph', text: `Text of ${ref}`, native: { tag: 'p', html: `<p id="${ref.slice(1)}">`, pixelContrast: { [fact.kind]: fact } } })
      }),
    }),
  }
  const textRefs = refs.filter((ref) => facts[ref]?.kind === 'text')
  const engine: EngineResults = {
    engine: { name: 'axe-core', version: 'test' },
    rules: [
      {
        ruleId: 'color-contrast',
        outcome: 'incomplete',
        criteria: ['1.4.3'],
        help: 'Elements must meet minimum color contrast ratio thresholds',
        nodes: [...textRefs, '#left-out'].map((ref) => ({ ref, target: `["${ref}"]`, html: '<p>', message: "Element's background color could not be determined due to a background gradient", reasonKey: 'bgGradient' })),
      },
    ],
  }
  return { snapshot, engine }
}

const options = (extra: Partial<CheckOptions> = {}): CheckOptions => ({
  criteria: [],
  llm: false,
  provider: undefined,
  runs: 1,
  cache: memoryCache(),
  offline: false,
  locale: 'en',
  minConfidence: 'low',
  concurrency: 1,
  ...extra,
})

const text = (highest: number, lowest: number, extra: Partial<PixelContrastFact> = {}): PixelContrastFact => ({
  kind: 'text',
  status: 'measured',
  axeReason: 'bgGradient',
  fontSize: 16,
  fontWeight: 400,
  foreground: '#aaaaaa',
  foregroundFrom: 'css',
  background: { common: '#f0f0f0', worst: '#cccccc', best: '#ffffff' },
  highest,
  lowest,
  pixels: 800,
  stroke: 3,
  ...extra,
})

describe('the pixel rules in a check', () => {
  it('fails, passes and sends to review what axe-core could not decide, and leaves the rest to axe-core', async () => {
    const { snapshot, engine } = measuredPage(
      {
        '#fail': text(2.32, 1.45),
        '#pass': text(15.9, 11.7, { foreground: '#222222' }),
        '#mixed': text(7.46, 2.82, { foreground: '#555555' }),
        '#moving': { kind: 'text', status: 'unmeasured', axeReason: 'bgImage', reason: 'moving' },
      },
      { version: '1', limits: { text: 4, placeholder: 10 }, found: { text: 5, placeholder: 0 }, measured: { text: 4, placeholder: 0 }, leftOut: { text: 1, placeholder: 0 }, stopped: 'limit' },
    )
    const report = await checkSnapshot(snapshot, engine, options())
    const fail = report.findings.find((f) => f.ruleId === 'rampa/pixel-contrast')
    expect(fail).toMatchObject({ ref: '#fail', criterion: '1.4.3', source: 'rule', confidence: 'low' })
    expect(fail?.message).toContain('at most 2.32:1')
    expect(fail?.message).toContain('a gradient')
    expect(fail?.evidence).toBe('#aaaaaa on #f0f0f0; #cccccc…#ffffff · 2.32:1 at best, 1.45:1 at worst · 16px, 400')
    // Each undecided element is reported once: by the rule when it measured it, by axe-core when it was left out.
    const review = (report.needsReview ?? []).map((item) => `${item.ruleId} ${item.ref}`)
    expect(review).toEqual(['color-contrast #left-out', 'rampa/pixel-contrast #mixed', 'rampa/pixel-contrast #moving'])
    expect(report.needsReview?.find((item) => item.ref === '#moving')?.message).toBe(
      'axe-core could not decide the contrast of "Text of #moving" (a background image), and the pixels could not either: a video plays behind it.',
    )
    const record = report.coverage.criteria?.find((c) => c.id === '1.4.3')
    expect(record?.status).toBe('failures')
    expect(record?.methods.find((m) => m.id === 'color-contrast')).toMatchObject({ applicable: 1, review: 1 })
    expect(record?.methods.find((m) => m.id === 'rampa/pixel-contrast')).toMatchObject({
      kind: 'rule',
      applicable: 4,
      failures: 1,
      review: 2,
      maturity: 'experimental',
      note: '1 not measured, past the limit of 4 per page',
    })
    expect(report.coverage.rules).toContain('1.4.3')
  })

  it('says it in Portuguese', async () => {
    const { snapshot, engine } = measuredPage({ '#fail': text(2.32, 1.45), '#mixed': text(7.46, 2.82) })
    const report = await checkSnapshot(snapshot, engine, options({ locale: 'pt-BR' }))
    expect(report.findings.find((f) => f.ref === '#fail')?.message).toBe(
      'O texto "Text of #fail" tem no máximo 2,32:1 de contraste com o que está atrás (#aaaaaa sobre #cccccc…#ffffff), medido nos pixels porque o axe-core não conseguiu decidir (um degradê). O WCAG 1.4.3 pede 4,5:1.',
    )
    expect(report.needsReview?.find((item) => item.ref === '#mixed')?.message).toContain('Parte do texto')
  })

  it('applies the large-text threshold, and judges a placeholder as text', () => {
    const { snapshot, engine } = measuredPage({
      '#large': text(3.45, 3.34, { fontSize: 24 }),
      '#small': text(3.45, 3.34),
      '#placeholder': {
        ...text(1.92, 1.92, { foreground: '#bbbbbb', background: { common: '#ffffff', worst: '#ffffff', best: '#ffffff' } }),
        kind: 'placeholder',
        text: 'Search products',
        axeReason: undefined,
      },
    })
    const stage = runRuleChecks(snapshot, engine, 'en', [pixelContrastRule, placeholderContrastRule])
    expect(stage.findings.map((f) => `${f.ruleId} ${f.ref}`)).toEqual(['rampa/pixel-contrast #small', 'rampa/placeholder-contrast #placeholder'])
    expect(stage.findings[1]?.message).toBe(
      'The placeholder "Search products" has a contrast of 1.92:1 with the field (#bbbbbb on #ffffff). Placeholder text is text, and WCAG 1.4.3 asks for 4.5:1.',
    )
    // The placeholder is not one of axe-core's results: only the measured texts leave axe-core's review.
    expect([...(stage.resolved.get('color-contrast') ?? [])]).toEqual(['#large', '#small'])
    const left = withoutResolved(engine, stage.resolved)
    expect(left.rules[0]?.nodes.map((n) => n.ref)).toEqual(['#left-out'])
  })

  it('reports nothing, not even coverage, on a page with nothing measured', async () => {
    const { snapshot, engine } = measuredPage({})
    const report = await checkSnapshot(snapshot, engine, options())
    expect(report.coverage.criteria?.find((c) => c.id === '1.4.3')?.methods.map((m) => m.id)).toEqual(['color-contrast'])
    expect(report.needsReview?.map((item) => item.ruleId)).toEqual(['color-contrast'])
  })

})
