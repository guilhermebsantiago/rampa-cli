import { describe, expect, it } from 'vitest'
import type { EngineResults } from '../src/core/types.ts'
import { type ImagesOfTextJudgment, imagesOfText } from '../src/criteria/images-of-text.ts'
import { phraseIn } from '../src/criteria/shared.ts'
import type { A11yNode, A11ySnapshot } from '../src/snapshot/schema.ts'
import { node } from './helpers.ts'

const PNG = 'data:image/png;base64,iVBORw0KGgo='
const noFindings: EngineResults = { engine: { name: 'axe-core', version: 'test' }, rules: [] }

function picture(ref: string, alt: string | undefined, extra: Partial<A11yNode> & { attributes?: Record<string, string> } = {}): A11yNode {
  const { attributes = {}, ...rest } = extra
  const all = { src: `${ref.slice(1)}.png`, ...(alt === undefined ? {} : { alt }), ...attributes }
  const tag = typeof rest.native?.tag === 'string' ? rest.native.tag : 'img'
  return node({
    ref,
    role: alt === '' ? 'presentation' : 'img',
    name: alt,
    image: PNG,
    bounds: { x: 0, y: 0, width: 600, height: 120 },
    ...rest,
    native: {
      tag,
      attributes: all,
      html: `<${tag}${Object.entries(all)
        .map(([key, value]) => ` ${key}="${value}"`)
        .join('')}>`,
      ...(rest.native ?? {}),
    },
  })
}

/** A shop's home page: a sale banner, a logo, icons, an image button, a hero set in CSS and a chart. */
function home(): A11ySnapshot {
  return {
    schemaVersion: 1,
    surface: 'web',
    target: 'test://home',
    locale: 'en',
    viewport: { width: 1280, height: 800, scale: 1 },
    collectedAt: '2026-10-08T00:00:00.000Z',
    collector: { name: 'test', version: '0' },
    root: node({
      ref: 'html',
      role: 'document',
      lang: 'en',
      children: [
        node({
          ref: 'header',
          role: 'banner',
          native: { tag: 'header' },
          children: [
            picture('#logo', 'Corner Store', { attributes: { src: 'brand/logo.svg' } }),
            picture('#cart', 'Cart', { bounds: { x: 0, y: 0, width: 16, height: 16 } }),
            picture('#account', 'Account', { bounds: { x: 0, y: 0, width: 32, height: 32 } }),
            node({
              ref: 'form',
              role: 'form',
              native: { tag: 'form' },
              children: [picture('#go', 'Search', { role: 'button', native: { tag: 'input' }, attributes: { type: 'image', name: 'q' }, bounds: { x: 0, y: 0, width: 80, height: 24 } })],
            }),
          ],
        }),
        node({
          ref: 'section.sale',
          native: { tag: 'section' },
          children: [
            picture('#banner', 'Summer sale'),
            node({ ref: 'section.sale > p', role: 'paragraph', text: 'Shop the season.', native: { tag: 'p' } }),
            node({ ref: 'section.sale > span', text: 'Summer sale: half price on all umbrellas', bounds: { x: 0, y: 0, width: 1, height: 1 }, native: { tag: 'span' } }),
          ],
        }),
        node({
          ref: 'section.welcome',
          native: { tag: 'section' },
          children: [
            picture('#welcome', ''),
            node({ ref: 'section.welcome > p', role: 'paragraph', text: 'Welcome to our store', native: { tag: 'p' } }),
          ],
        }),
        node({
          ref: '#hero',
          native: { tag: 'div', attributes: { id: 'hero', class: 'hero' }, backgroundImage: 'images/hero-autumn.jpg' },
          image: PNG,
          bounds: { x: 0, y: 0, width: 1200, height: 400 },
          children: [node({ ref: '#hero > h2', role: 'heading', name: 'Autumn arrivals', text: 'Autumn arrivals', native: { tag: 'h2' } })],
        }),
        picture('#chart', 'Bar chart of umbrella sales by month', { role: 'img', native: { tag: 'div' }, attributes: { role: 'img' } }),
        node({ ref: '#emoji', role: 'img', name: 'smile', image: PNG, bounds: { x: 0, y: 0, width: 40, height: 40 }, native: { tag: 'span' }, children: [node({ ref: '#emoji-text', text: '😀' })] }),
        picture('#gone', 'Old banner', { states: ['hidden'] }),
        picture('#uncaptured', 'Not captured', { image: undefined }),
        node({ ref: 'svg', role: 'img', name: 'Diagram', image: PNG, bounds: { x: 0, y: 0, width: 300, height: 200 }, native: { tag: 'svg' } }),
      ],
    }),
  }
}

function candidate(ref: string) {
  const found = imagesOfText.candidates(home(), noFindings).find((c) => c.ref === ref)
  if (!found) throw new Error(`no candidate ${ref}`)
  return found
}

const bannerFail: ImagesOfTextJudgment = {
  imageShows: 'A yellow banner with large lettering',
  evidence: 'SUMMER SALE 50% OFF',
  exception: 'none',
  verdict: 'fail',
  confidence: 'high',
}

describe('1.4.5 candidates', () => {
  it('judges captured pictures big enough to hold words, and leaves logos, icons and real text out', () => {
    const refs = imagesOfText.candidates(home(), noFindings).map((c) => c.ref)
    expect(refs).toEqual(['#go', '#banner', '#welcome', '#hero', '#chart'])
  })

  it('records how each picture is drawn and what text is visible next to it', () => {
    expect(candidate('#go').context).toMatchObject({ kind: 'input', alt: 'Search', actionText: 'Search', width: 80, height: 24 })
    expect(candidate('#banner').context).toMatchObject({ kind: 'img', alt: 'Summer sale', src: 'banner.png', nearbyText: 'Shop the season.' })
    expect(candidate('#welcome').context).toMatchObject({ kind: 'img', alt: '', nearbyText: 'Welcome to our store' })
    expect(candidate('#hero').context).toMatchObject({ kind: 'background', src: 'hero-autumn.jpg' })
    expect(candidate('#chart').context).toMatchObject({ kind: 'role-img', alt: 'Bar chart of umbrella sales by month' })
  })

  it('sends the rendered picture with what it is and the text around it', () => {
    const prompt = imagesOfText.prompt(candidate('#welcome'), home())
    expect(prompt.images).toHaveLength(1)
    expect(prompt.user).toContain('Drawn as: an img element')
    expect(prompt.user).toContain('Text alternative: none')
    expect(prompt.user).toContain('Visible text next to the image: Welcome to our store')
    expect(imagesOfText.prompt(candidate('#hero'), home()).user).toContain("Drawn as: the CSS background of an element, shown without the element's own content")
  })
})

describe('1.4.5 verification', () => {
  it('keeps an image of text whose transcription agrees with its alternative', () => {
    expect(imagesOfText.verify(bannerFail, candidate('#banner'), home())).toEqual({ ok: true })
  })

  it('drops a fail with nothing transcribed, a lone character or a pair of initials', () => {
    expect(imagesOfText.verify({ ...bannerFail, evidence: '' }, candidate('#banner'), home())).toEqual({
      ok: false,
      reason: 'image of text claimed, but no words were transcribed',
    })
    expect(imagesOfText.verify({ ...bannerFail, evidence: 'A' }, candidate('#go'), home()).ok).toBe(false)
    expect(imagesOfText.verify({ ...bannerFail, evidence: 'NP.' }, candidate('#welcome'), home()).ok).toBe(false)
    expect(imagesOfText.verify({ ...bannerFail, evidence: 'Go!' }, candidate('#go'), home()).ok).toBe(false)
  })

  it('drops a fail that names an exception', () => {
    expect(imagesOfText.verify({ ...bannerFail, exception: 'logotype' }, candidate('#banner'), home()).ok).toBe(false)
  })

  it('drops a transcription that shares no word with a descriptive alternative', () => {
    const chart = { ...bannerFail, evidence: 'Free delivery today' }
    expect(imagesOfText.verify(chart, candidate('#chart'), home())).toEqual({ ok: false, reason: 'the transcription shares no word with the text alternative' })
  })

  it('drops a claim on a picture the page itself calls a screenshot, a chart or a diagram', () => {
    const banner = candidate('#banner')
    const screenshot = { ...banner, context: { ...banner.context, alt: 'Screenshot of the menu: New repository is outlined' } }
    expect(imagesOfText.verify({ ...bannerFail, evidence: 'New repository Import repository' }, screenshot, home())).toEqual({
      ok: false,
      reason: 'the page calls it a screenshot, which is not an image of text',
    })
    const byFileName = { ...banner, context: { ...banner.context, alt: '', src: 'sales-chart-2026.png' } }
    expect(imagesOfText.verify(bannerFail, byFileName, home()).ok).toBe(false)
  })

  it('does not hold a generic alternative against the transcription', () => {
    const page = home()
    const banner = candidate('#banner')
    const generic = { ...banner, context: { ...banner.context, alt: 'Banner principal' } }
    expect(imagesOfText.verify({ ...bannerFail, evidence: 'Free delivery today' }, generic, page)).toEqual({ ok: true })
  })

  it('drops a fail when the same words are shown as real text next to the image', () => {
    const welcome = { ...bannerFail, evidence: 'Welcome' }
    expect(imagesOfText.verify(welcome, candidate('#welcome'), home())).toEqual({ ok: false, reason: 'the same words are shown as real text next to the image' })
  })

  it('does not count text hidden for screen readers only as shown next to the image', () => {
    const hiddenCopy = { ...bannerFail, evidence: 'Summer sale: half price on all umbrellas' }
    expect(imagesOfText.verify(hiddenCopy, candidate('#banner'), home())).toEqual({ ok: true })
  })

  it('checks a pass against what was transcribed', () => {
    const logo = { ...bannerFail, verdict: 'pass', exception: 'logotype' } as const
    expect(imagesOfText.verify(logo, candidate('#banner'), home())).toEqual({ ok: true })
    expect(imagesOfText.verify({ ...logo, exception: 'none' }, candidate('#banner'), home()).ok).toBe(false)
    expect(imagesOfText.verify({ ...logo, exception: 'no_text' }, candidate('#banner'), home())).toEqual({
      ok: false,
      reason: 'pass for an image without text, but text was transcribed',
    })
  })

  it('matches short texts as a phrase and long ones by nearly all their words', () => {
    expect(phraseIn('Welcome', 'Welcome to our store')).toBe(true)
    expect(phraseIn('Our store', 'Welcome to our store')).toBe(true)
    expect(phraseIn('Store welcome', 'Welcome to our store')).toBe(false)
    expect(phraseIn('Ten ways to cut your energy bill this winter', 'Read: ten ways to cut your energy bill this winter!')).toBe(true)
    expect(phraseIn('Ten ways to cut your water bill this summer', 'Read: ten ways to cut your energy bill this winter!')).toBe(false)
    expect(phraseIn('Welcome', undefined)).toBe(false)
  })
})

describe('1.4.5 messages and patches', () => {
  it('quotes what the image says, in both locales', () => {
    expect(imagesOfText.message(bannerFail, candidate('#banner'), 'en')).toBe('The image shows the text "SUMMER SALE 50% OFF" as a picture; use real text styled with CSS.')
    expect(imagesOfText.message(bannerFail, candidate('#banner'), 'pt-BR')).toBe('A imagem mostra o texto "SUMMER SALE 50% OFF" como figura; use texto real, estilizado com CSS.')
  })

  it('replaces an img with its text and an image button with a button', () => {
    expect(imagesOfText.patch?.(bannerFail, candidate('#banner'), home())).toEqual({
      ref: '#banner',
      kind: 'replace-element',
      from: 'Summer sale',
      to: 'SUMMER SALE 50% OFF',
      before: '<img src="banner.png" alt="Summer sale">',
      after: '<span>SUMMER SALE 50% OFF</span>',
    })
    expect(imagesOfText.patch?.({ ...bannerFail, evidence: 'Search' }, candidate('#go'), home())?.after).toBe('<button type="submit" name="q">Search</button>')
    expect(imagesOfText.patch?.(bannerFail, candidate('#hero'), home())).toBeUndefined()
  })
})
