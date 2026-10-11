import { afterAll, describe, expect, it } from 'vitest'
import { checkSnapshot } from '../src/core/check.ts'
import type { Report } from '../src/core/types.ts'
import { emptyEngine } from '../src/engine/axe.ts'
import { encodePng } from '../src/pixels/png.ts'
import { snapshotSignature } from '../src/probes/identity.ts'
import type { InPageElement } from '../src/probes/kit.ts'
import { type CarouselRecord, type LanguageVersion, type VariantsData, languageVersions, thumbDistance, thumbOf } from '../src/probes/variants.ts'
import { probeLaunchArgs } from '../src/probes/run.ts'
import { CAROUSEL_RULE, LANGUAGE_VERSIONS_RULE, distinctPictures, lastPerElement } from '../src/rules/variants.ts'
import { A11ySnapshotSchema, type A11yNode, type A11ySnapshot, type ProbeRecord } from '../src/snapshot/schema.ts'
import { type Collected, collectWeb, launchBrowser } from '../src/surfaces/web.ts'
import { node } from './helpers.ts'
import { startFixtureServers } from './media-server.ts'
import { byRule, fixture, probeCheckOptions, reviewByRule } from './probe-helpers.ts'

/** A flat picture with a square of another grey in it, as PNG bytes. */
function picture(background: number, square: number): Uint8Array {
  const width = 64
  const height = 36
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const value = x > 16 && x < 40 && y > 8 && y < 28 ? square : background
      data.set([value, value, value, 255], (y * width + x) * 4)
    }
  }
  return encodePng({ width, height, data })
}

const element = (n: A11yNode): InPageElement => ({ ref: n.ref, id: { tag: String(n.native.tag), sig: snapshotSignature(n) }, tag: String(n.native.tag), role: n.role, label: n.name ?? '' })

describe('state variants: helpers', () => {
  it('tells two pictures apart by their thumbnails, and a picture from itself', () => {
    const a = thumbOf(picture(20, 240)) as string
    const b = thumbOf(picture(230, 30)) as string
    expect(a).toHaveLength(512)
    expect(thumbDistance(a, thumbOf(picture(20, 240)) as string)).toBe(0)
    expect(thumbDistance(a, b)).toBeGreaterThan(100)
    // A slight difference, such as a picture scaled a pixel differently, stays one picture.
    expect(thumbDistance(a, thumbOf(picture(24, 236)) as string)).toBeLessThan(16)
  })

  it('reads one version per other language: alternates first, the switcher link kept for each', () => {
    const link = (href: string, text: string, hreflang = '') => ({ el: { ref: `a[href="${href}"]`, id: { tag: 'a', sig: 'a' }, tag: 'a', role: 'link', label: text }, href, hreflang, text })
    const found = {
      lang: 'en',
      alternates: [
        { href: 'https://acme.example/pt/', hreflang: 'pt-BR' },
        { href: 'https://acme.example/', hreflang: 'x-default' },
        { href: 'https://acme.example/en/', hreflang: 'en' },
      ],
      links: [
        link('https://acme.example/en/', 'English'),
        link('https://acme.example/pt/', 'Português'),
        link('https://acme.example/fr/', 'Français'),
        link('https://acme.example/de/', 'Read in German', 'de'),
        link('https://acme.example/about', 'About us'),
        link('mailto:hello@acme.example', 'Español'),
      ],
    }
    const { versions, leftOut } = languageVersions('https://acme.example/en/', found)
    expect(versions.map((v) => [v.href, v.via, v.claimed, v.link?.label])).toEqual([
      ['https://acme.example/pt/', 'hreflang', 'pt-BR', 'Português'],
      ['https://acme.example/fr/', 'switcher', 'fr', 'Français'],
      ['https://acme.example/de/', 'switcher', 'de', 'Read in German'],
    ])
    expect(leftOut).toBe(0)
    expect(languageVersions('https://acme.example/en/', found, 1).leftOut).toBe(2)
  })
})

describe('state variants: rules', () => {
  const carouselNode = node({ ref: 'section.carousel', role: 'region', native: { tag: 'section', attributes: {} } })
  const bannerNode = node({ ref: '#campus', role: 'img', name: 'The campus', native: { tag: 'img', attributes: { id: 'campus' } } })
  const linkNode = node({ ref: 'nav > a:nth-of-type(2)', role: 'link', text: 'Português', native: { tag: 'a', attributes: { href: 'pt.html' } } })
  const red = thumbOf(picture(20, 240)) as string
  const blue = thumbOf(picture(230, 30)) as string
  const shot = (ref: string, src: string, name: string, thumb?: string) => ({ ...element(node({ ref, native: { tag: 'img' } })), ref, src, name, shown: 'clock' as const, ...(thumb ? { thumb } : { skipped: 'clipped' }) })

  function snapshotWith(data: Partial<VariantsData>): A11ySnapshot {
    const record: ProbeRecord = {
      kind: 'variants',
      version: '1',
      conditions: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, browser: 'test', variant: 'state-variants' },
      status: 'complete',
      guard: { blocked: [], navigations: [], dialogs: [] },
      durationMs: 1,
      data: { viewport: { width: 1280, height: 800 }, clock: true, steps: 8, stepMs: 2000, carousels: [], lang: 'en', languages: [], languagesLeftOut: 0, ...data },
    }
    return {
      schemaVersion: 1,
      surface: 'web',
      target: 'test://variants',
      title: 'Variants',
      locale: 'en',
      viewport: { width: 1280, height: 800, scale: 1 },
      collectedAt: '2026-10-11T00:00:00.000Z',
      collector: { name: 'test', version: '0' },
      root: node({ ref: 'html', role: 'document', lang: 'en', native: { tag: 'html' }, children: [node({ ref: 'html > body', native: { tag: 'body' }, children: [carouselNode, bannerNode, linkNode] })] }),
      observations: { probes: [record] },
    }
  }

  it('fails one name on pictures its pixels tell apart, sends uncaptured ones to review, and leaves renamed and decorative slides alone', async () => {
    const carousels: CarouselRecord[] = [
      { el: element(carouselNode), why: 'roledescription', images: [], states: [], pictures: [shot('s1', 'https://acme.example/a.jpg', 'Summer sale', red), shot('s2', 'https://acme.example/b.jpg', 'Summer sale', blue)] },
      { el: element(bannerNode), why: 'swap', images: [], states: [], pictures: [shot('#campus', 'https://acme.example/sunrise.jpg', 'The campus', red), shot('#campus', 'https://acme.example/moon.jpg', 'The campus')] },
    ]
    const report = await checkSnapshot(snapshotWith({ carousels }), emptyEngine(), probeCheckOptions())
    expect(byRule(report, CAROUSEL_RULE).map((f) => [f.ref, f.criterion, f.confidence])).toEqual([['section.carousel', '1.1.1', 'medium']])
    expect(byRule(report, CAROUSEL_RULE)[0]?.message).toContain('This carousel shows 2 different pictures, and every one of them is named “Summer sale”')
    expect(byRule(report, CAROUSEL_RULE)[0]?.evidence).toContain('2 pictures told apart by their pixels: a.jpg, b.jpg')
    expect(reviewByRule(report, CAROUSEL_RULE).map((r) => r.ref)).toEqual(['#campus'])
    const row = report.coverage.probes?.find((r) => r.rule === CAROUSEL_RULE)
    expect(row).toMatchObject({ criterion: '1.1.1', method: 'probe/variants@1', applicable: 2, failures: 1, review: 1 })

    const fine: CarouselRecord[] = [
      { el: element(carouselNode), why: 'class', images: [], states: [], pictures: [shot('s1', 'a.jpg', 'Summer sale', red), shot('s2', 'b.jpg', 'New arrivals', blue)] },
      { el: element(bannerNode), why: 'swap', images: [], states: [], pictures: [shot('#campus', 'a.jpg', '', red), shot('#campus', 'b.jpg', '', blue)] },
    ]
    const clean = await checkSnapshot(snapshotWith({ carousels: fine }), emptyEngine(), probeCheckOptions())
    expect(byRule(clean, CAROUSEL_RULE)).toEqual([])
    expect(clean.coverage.probes?.find((r) => r.rule === CAROUSEL_RULE)?.note).toContain('1 carousel(s) whose names change with the picture; 1 with empty names (decorative)')
    // No carousel at all: the probe says nothing about 1.1.1.
    const none = await checkSnapshot(snapshotWith({}), emptyEngine(), probeCheckOptions())
    expect(none.coverage.probes?.find((r) => r.rule === CAROUSEL_RULE)?.status).toBe('not-checked')
    expect(distinctPictures([shot('x', 'a', 'n', red), shot('y', 'b', 'n', red)])).toHaveLength(1)
    // One address is one picture, even when two captures of it differ (a slide captured off its place).
    expect(distinctPictures([shot('x', 'same.jpg', 'n', red), shot('y', 'same.jpg', 'n', blue)])).toHaveLength(1)
    // A slide whose image loaded late (a stand-in, then its picture) counts once, as it last showed.
    const lazy: CarouselRecord[] = [
      { el: element(carouselNode), why: 'class', images: [], states: [], pictures: [shot('s1', 'spinner.gif', 'A room', red), shot('s1', 'room-1.jpg', 'A room', blue), shot('s2', 'room-2.jpg', 'A room', blue)] },
    ]
    const late = await checkSnapshot(snapshotWith({ carousels: lazy }), emptyEngine(), probeCheckOptions())
    expect(byRule(late, CAROUSEL_RULE)).toEqual([])
    expect(lastPerElement(lazy[0]?.pictures ?? []).map((p) => p.src)).toEqual(['room-1.jpg', 'room-2.jpg'])
  })

  it('fails a language version whose lang its long text is not in, and never judges short text', async () => {
    const english =
      'Our walking tours start every morning at nine from the main square. A local guide takes you through narrow streets, small churches and the market, and tells the story of the town from its first houses to the harbour that made it rich.'
    const portuguese =
      'Nossos passeios a pé começam todas as manhãs às nove horas na praça principal. Um guia local leva você pelas ruas estreitas, pelas pequenas igrejas e pelo mercado, e conta a história da cidade desde as primeiras casas até o porto que a tornou rica.'
    const languages: LanguageVersion[] = [
      { href: 'https://acme.example/pt/', via: 'hreflang', claimed: 'pt-BR', link: element(linkNode), url: 'https://acme.example/pt/', declared: 'en', title: 'Visite a cidade velha', text: portuguese },
      { href: 'https://acme.example/es/', via: 'hreflang', claimed: 'es', url: 'https://acme.example/es/', declared: 'en', title: 'Hola', text: 'Bienvenidos' },
      { href: 'https://acme.example/uk/', via: 'switcher', claimed: 'en-GB', url: 'https://acme.example/uk/', declared: 'en-GB', title: 'Visit', text: english },
      { href: 'https://acme.example/de/', via: 'switcher', claimed: 'de', declared: null, text: 'Willkommen' },
      { href: 'https://acme.example/it/', via: 'switcher', claimed: 'it', reason: 'not read: timeout' },
    ]
    const report = await checkSnapshot(snapshotWith({ languages }), emptyEngine(), probeCheckOptions())
    const found = byRule(report, LANGUAGE_VERSIONS_RULE)
    expect(found.map((f) => [f.ref, f.criterion])).toEqual([['nav > a:nth-of-type(2)', '3.1.1']])
    expect(found[0]?.message).toContain('version of this page (https://acme.example/pt/) is marked lang="en", but its text is in Portuguese')
    expect(found[0]?.message).toContain('Set lang="pt"')
    const row = report.coverage.probes?.find((r) => r.rule === LANGUAGE_VERSIONS_RULE)
    expect(row).toMatchObject({ criterion: '3.1.1', applicable: 3, failures: 1 })
    expect(row?.note).toBe('1 version(s) not read; 1 declare(s) no valid lang (that page\'s own html-has-lang); 1 with too little or mixed text to judge')
  })
})

// Integration: needs Chrome or Edge. The language versions come over HTTP; the carousels load from files.
const servers = await startFixtureServers()
const browser = await launchBrowser({ args: probeLaunchArgs(['variants']) }).catch((error: unknown) => {
  process.stderr.write(`\nSkipping the state-variants probe tests: no browser started (${error instanceof Error ? error.message.split('\n')[0] : String(error)}).\n`)
  return undefined
})
afterAll(async () => {
  await browser?.close()
  await servers.close()
}, 60_000)

const collected = new Map<string, Promise<Collected>>()
function probed(url: string): Promise<Collected> {
  if (!browser) throw new Error('no browser')
  let result = collected.get(url)
  if (!result) {
    result = collectWeb(browser, url, { runAxe: false, locale: 'en', probes: ['variants'] })
    collected.set(url, result)
  }
  return result
}
const check = async (url: string): Promise<{ snapshot: A11ySnapshot; report: Report }> => {
  const { snapshot, engine } = await probed(url)
  return { snapshot, report: await checkSnapshot(snapshot, engine, probeCheckOptions()) }
}
const dataOf = (snapshot: A11ySnapshot) => snapshot.observations?.probes.find((p) => p.kind === 'variants')?.data as VariantsData | undefined

describe.skipIf(!browser)('state-variants probe (1.1.1, 3.1.1)', { timeout: 120_000 }, () => {
  it('follows carousels and swapped images on the clock, and makes still slides visible to capture them', async () => {
    const { snapshot, report } = await check(fixture('variants-carousel-fail.html'))
    expect(A11ySnapshotSchema.safeParse(snapshot).success).toBe(true)
    const record = snapshot.observations?.probes.find((p) => p.kind === 'variants')
    expect(record).toMatchObject({ kind: 'variants', version: '1', status: 'complete', conditions: { variant: 'state-variants' } })
    const data = dataOf(snapshot)
    expect(data?.clock).toBe(true)
    expect(data?.carousels.map((c) => [c.why, c.pictures.filter((p) => p.thumb).length])).toEqual([
      ['roledescription', 3],
      ['roledescription', 2],
      ['class', 2],
      ['swap', 2],
    ])
    // The slides that carry the class themselves are read as one carousel, their container.
    expect(data?.carousels[2]?.el.ref).toBe('html > body > div')
    const found = byRule(report, CAROUSEL_RULE)
    expect(found.map((f) => f.message.slice(0, 40))).toHaveLength(4)
    expect(found.find((f) => f.ref === '#campus')?.message).toContain('A script changes the picture this image shows (2 different pictures), and its name stays “The campus at sunrise”')
    expect(found.some((f) => f.message.includes('This carousel shows 3 different pictures, and every one of them is named “Summer sale: 30% off every coat”'))).toBe(true)
    expect(found.some((f) => f.evidence?.includes('slides made visible one at a time'))).toBe(true)
  })

  it('reports nothing when each picture has its own name, the name follows the swap, or the slides are copies, decorative or thumbnails', async () => {
    const pass = await check(fixture('variants-carousel-pass.html'))
    expect(byRule(pass.report, CAROUSEL_RULE)).toEqual([])
    expect(pass.report.coverage.probes?.find((r) => r.rule === CAROUSEL_RULE)).toMatchObject({ applicable: 2, failures: 0, review: 0 })
    const near = await check(fixture('variants-carousel-near.html'))
    expect(byRule(near.report, CAROUSEL_RULE)).toEqual([])
    expect(reviewByRule(near.report, CAROUSEL_RULE)).toEqual([])
  })

  it('loads each language version, and fails the one whose lang its text is not in', async () => {
    const { snapshot, report } = await check(`${servers.origin}/variants-lang-home.html`)
    const data = dataOf(snapshot)
    expect(data?.languages.map((v) => [v.claimed, v.declared, v.link?.label])).toEqual([
      ['pt-BR', 'en', 'Português'],
      ['es', 'es', 'Español'],
      ['fr', 'de', 'Français'],
    ])
    const found = byRule(report, LANGUAGE_VERSIONS_RULE)
    expect(found.map((f) => f.criterion)).toEqual(['3.1.1'])
    expect(found[0]?.ref).toBe(snapshot.root.children.find((c) => c.native.tag === 'body')?.children[0]?.children[0]?.children[1]?.ref)
    expect(found[0]?.message).toContain('is marked lang="en", but its text is in Portuguese')
    expect(report.coverage.probes?.find((r) => r.rule === LANGUAGE_VERSIONS_RULE)?.note).toContain('1 with too little or mixed text to judge')
  })
})
