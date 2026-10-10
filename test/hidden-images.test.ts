import { describe, expect, it } from 'vitest'
import { judgmentFailsAct } from '../src/cli/commands/eval.ts'
import type { Candidate, EngineResults, Finding } from '../src/core/types.ts'
import { type HiddenImageJudgment, verifyHidden } from '../src/criteria/hidden-images.ts'
import { type NonTextContentContext, nonTextContent } from '../src/criteria/non-text-content.ts'
import { emptyEngine } from '../src/engine/axe.ts'
import { hiddenBy, hiddenImageSignals, meaningWords, pageWords, textAround } from '../src/snapshot/hidden-images.ts'
import type { A11yNode, A11ySnapshot } from '../src/snapshot/schema.ts'
import { node } from './helpers.ts'

const PNG = 'data:image/png;base64,iVBORw0KGgo='
const BIG = { x: 0, y: 0, width: 240, height: 120 }

const img = (ref: string, attributes: Record<string, string>, extra: Partial<A11yNode> = {}) =>
  node({
    ref,
    role: attributes.role ?? (attributes.alt === '' ? 'presentation' : 'img'),
    name: attributes.alt || undefined,
    bounds: BIG,
    image: PNG,
    native: { tag: 'img', attributes, html: `<img${Object.entries(attributes).map(([k, v]) => ` ${k}="${v}"`).join('')}>` },
    ...extra,
  })
const svg = (ref: string, native: Record<string, unknown> = {}, extra: Partial<A11yNode> = {}) =>
  node({ ref, role: 'graphics-document', bounds: BIG, image: PNG, native: { tag: 'svg', attributes: {}, svgHash: 'abcd1234', ...native }, ...extra })
const canvas = (ref: string, extra: Partial<A11yNode> = {}) => node({ ref, role: 'generic', bounds: BIG, image: PNG, native: { tag: 'canvas', attributes: { width: '240', height: '120' } }, ...extra })
const text = (ref: string, words: string) => node({ ref, role: 'paragraph', text: words, native: { tag: 'p' } })

function page(children: A11yNode[]): A11ySnapshot {
  return {
    schemaVersion: 1,
    surface: 'web',
    target: 'test://hidden',
    locale: 'en',
    viewport: { width: 1280, height: 800, scale: 1 },
    collectedAt: '2026-10-09T00:00:00.000Z',
    collector: { name: 'test', version: '0' },
    root: node({ ref: 'html', role: 'document', lang: 'en', children: [node({ ref: 'body', native: { tag: 'body' }, children })] }),
  }
}

describe('images hidden from assistive technology', () => {
  it('names how each one is hidden, and leaves alone the images screen readers read', () => {
    expect(hiddenBy(img('#a', { src: 'a.png', alt: '' }))).toBe('empty-alt')
    expect(hiddenBy(img('#b', { src: 'b.png', alt: 'Logo', role: 'none' }, { native: { tag: 'img', attributes: { alt: 'Logo', role: 'none' }, presentational: true } }))).toBe('role-none')
    expect(hiddenBy(img('#c', { src: 'c.png', alt: 'Logo' }, { states: ['aria-hidden'] }))).toBe('aria-hidden')
    expect(hiddenBy(svg('#d'))).toBe('unnamed-svg')
    expect(hiddenBy(canvas('#e'))).toBe('unnamed-canvas')
    // Named, or given a role: in the accessibility tree.
    expect(hiddenBy(img('#f', { src: 'f.png', alt: 'A red barn' }))).toBeUndefined()
    expect(hiddenBy(svg('#g', { svgTitle: 'Sales by month' }))).toBeUndefined()
    expect(hiddenBy(svg('#h', { attributes: { role: 'img', 'aria-label': 'Star' } }, { role: 'img', name: 'Star' }))).toBeUndefined()
    expect(hiddenBy(canvas('#i', { name: 'Chart', native: { tag: 'canvas', attributes: { 'aria-label': 'Chart' } } }))).toBeUndefined()
    // alt="" with role="img" has a role and no name: the engine's to report, not a hidden image.
    expect(hiddenBy(img('#j', { src: 'j.png', alt: '', role: 'img' }))).toBeUndefined()
  })

  it('leaves to the page the hidden images the cheap signals call decorative, and says why', () => {
    const snapshot = page([
      img('#logo', { src: '/assets/w3c-logo.png', alt: '' }),
      img('#tiny', { src: 'dot.png', alt: '' }, { bounds: { x: 0, y: 0, width: 24, height: 24 } }),
      img('#rule', { src: 'rule.png', alt: '' }, { bounds: { x: 0, y: 0, width: 600, height: 4 } }),
      ...['#s1', '#s2', '#s3'].map((ref) => svg(ref, { svgHash: 'star' })),
      img('#clone', { src: 'slide.jpg', alt: '' }),
      img('#slide', { src: 'slide.jpg', alt: 'Students on the lawn' }),
      node({ ref: '#more', role: 'link', name: 'Read more', native: { tag: 'a', attributes: { href: '/more' } }, children: [img('#in-link', { src: 'more.png', alt: '' })] }),
      node({ ref: '#named', role: 'generic', native: { tag: 'div', attributes: { 'aria-label': 'Gallery' } }, children: [svg('#in-named', { svgHash: 'gallery' })] }),
      text('#pdf-text', 'PDF document'),
      img('#pdf', { src: 'pdf.png', alt: '' }),
      img('#gone', { src: 'gone.png', alt: '' }, { states: ['hidden'] }),
      img('#away', { src: 'away.png', alt: '' }, { states: ['offscreen'] }),
      canvas('#drawing'),
    ])
    const signals = hiddenImageSignals(snapshot.root)
    expect(signals.judged.map((hidden) => hidden.node.ref)).toEqual(['#logo', '#drawing'])
    expect(Object.fromEntries(signals.quiet)).toEqual({
      '#tiny': 'icon-size',
      '#rule': 'icon-size',
      '#s1': 'repeated',
      '#s2': 'repeated',
      '#s3': 'repeated',
      '#clone': 'copy-of-named',
      '#in-link': 'in-control',
      '#pdf': 'said-next-to-it',
    })
    // Inside an element named by its author, hidden, or off the page: not a target at all (ACT e88epe).
    expect(signals.all.map((hidden) => hidden.node.ref)).not.toContain('#in-named')
    expect(signals.all.map((hidden) => hidden.node.ref)).not.toContain('#gone')
    expect(signals.all.map((hidden) => hidden.node.ref)).not.toContain('#away')
  })

  it('judges ten hidden images a page at most, in document order', () => {
    const many = Array.from({ length: 14 }, (_, i) => img(`#p${i}`, { src: `photo-${i}.jpg`, alt: '' }))
    expect(hiddenImageSignals(page(many).root).judged.map((hidden) => hidden.node.ref)).toEqual(many.slice(0, 10).map((n) => n.ref))
  })

  it('reads the text screen readers get around the image, with visually hidden text and without aria-hidden text', () => {
    const image = svg('#chart')
    const snapshot = page([
      text('#intro', 'Quarterly results.'),
      node({ ref: '#decor', role: 'paragraph', text: 'Ornament', states: ['aria-hidden'], native: { tag: 'p' } }),
      image,
      node({ ref: '#sr', role: 'generic', text: 'Revenue doubled', bounds: { x: 0, y: 0, width: 1, height: 1 }, native: { tag: 'span' } }),
      img('#named', { src: 'team.jpg', alt: 'The finance team' }),
    ])
    expect(textAround(snapshot.root, image)).toEqual({ before: 'Quarterly results.', after: 'Revenue doubled The finance team' })
  })

  it('finds the place of an image inside a branch hidden from assistive technology', () => {
    const image = img('#inner', { src: 'x.png', alt: 'Logo' })
    const snapshot = page([text('#a', 'Before'), node({ ref: '#hidden', role: 'generic', states: ['aria-hidden'], native: { tag: 'div' }, children: [image] }), text('#b', 'After')])
    expect(textAround(snapshot.root, image)).toEqual({ before: 'Before', after: 'After' })
  })

  it('reads what the page calls an image from its file name, title and unread alt, without kind words or sizes', () => {
    expect(pageWords(img('#x', { src: '/img/w3c-logo@2x.png?v=3', alt: '' }))).toEqual(['w3c'])
    expect(pageWords(img('#y', { src: 'IMG_2034.jpg', alt: 'W3C logo', role: 'none' }))).toEqual(['w3c'])
    expect(meaningWords('Sales rose 20% in 2024')).toEqual(['sales', 'rose', '20', '2024'])
  })
})

describe('1.1.1 judges hidden images', () => {
  const snapshot = page([text('#title', 'Best W3C logo:'), svg('#html5'), img('#photo', { src: 'fireworks.jpg', alt: '' }), text('#after', 'Happy new year!')])
  const candidates = nonTextContent.candidates(snapshot, emptyEngine())
  const html5 = candidates.find((c) => c.ref === '#html5') as Candidate<NonTextContentContext>

  it('makes each a candidate with how it is hidden and the text around it', () => {
    expect(candidates.map((c) => c.ref)).toEqual(['#html5', '#photo'])
    expect(html5.context.hidden).toMatchObject({ by: 'unnamed-svg', drawnAs: 'svg', before: 'Best W3C logo:', after: 'Happy new year!' })
    expect(nonTextContent.actFor?.(html5)).toEqual(['e88epe'])
  })

  it('asks another question, with its own schema, and sends the picture', () => {
    const prompt = nonTextContent.prompt(html5, snapshot)
    expect(prompt.user).toContain('How the page hides it from assistive technology: an inline svg with no name and no role')
    expect(prompt.user).toContain('Text right before it: Best W3C logo:')
    expect(prompt.system).toContain('pure decoration')
    expect(prompt.images).toHaveLength(1)
    expect(nonTextContent.schemaFor?.(html5)?.safeParse({ imageShows: 'x', textInImage: '', verdict: 'pass', evidence: '', suggestedAlt: '', confidence: 'low' }).success).toBe(true)
  })

  const claim: HiddenImageJudgment = {
    imageShows: 'The HTML5 shield logo in orange',
    textInImage: 'HTML',
    verdict: 'fail',
    evidence: 'the HTML5 logo',
    suggestedAlt: 'HTML5 logo',
    confidence: 'high',
  }

  it('keeps a claim the text around the image does not make', () => {
    expect(nonTextContent.verify(claim, html5, snapshot)).toEqual({ ok: true })
  })

  it('drops a claim the text around the image already makes', () => {
    expect(nonTextContent.verify({ ...claim, evidence: 'the W3C logo', suggestedAlt: 'W3C logo' }, html5, snapshot)).toEqual({ ok: false, reason: 'the text around the image already says what it conveys' })
    expect(nonTextContent.verify({ ...claim, evidence: 'a celebration of the new year, happy', textInImage: '' }, html5, snapshot).ok).toBe(false)
    expect(nonTextContent.verify({ ...claim, evidence: 'Shield with the words Best logo', textInImage: 'Best logo' }, html5, snapshot)).toEqual({ ok: false, reason: 'the words drawn in the image are in the text around it' })
  })

  it('drops a fail that says nothing the image conveys, or suggests a label', () => {
    expect(nonTextContent.verify({ ...claim, evidence: 'decorative image' }, html5, snapshot).ok).toBe(false)
    expect(nonTextContent.verify({ ...claim, suggestedAlt: 'decorative' }, html5, snapshot).ok).toBe(false)
    expect(nonTextContent.verify({ ...claim, suggestedAlt: '' }, html5, snapshot).ok).toBe(false)
    expect(nonTextContent.verify({ ...claim, imageShows: '' }, html5, snapshot).ok).toBe(false)
    expect(nonTextContent.verify({ ...claim, verdict: 'pass', evidence: '', suggestedAlt: '' }, html5, snapshot)).toEqual({ ok: true })
  })

  it('says how the image is hidden and what it conveys, below the default threshold', () => {
    expect(nonTextContent.message(claim, html5, 'en')).toBe('This image is hidden from screen readers (an svg with no name), but it conveys what the text around it does not say: "the HTML5 logo".')
    expect(nonTextContent.message(claim, html5, 'pt-BR')).toContain('escondida dos leitores de tela (um svg sem nome)')
    expect(nonTextContent.confidenceCap?.(html5)).toBe('low')
    expect(nonTextContent.subject?.(html5)).toBe('hidden svg')
  })

  it('patches with one attribute where one makes the fix, and only shows a rewritten img tag otherwise', () => {
    const photo = candidates.find((c) => c.ref === '#photo') as Candidate<NonTextContentContext>
    const fix = { ...claim, suggestedAlt: 'Fireworks over the bay' }
    expect(nonTextContent.patch?.(fix, photo, snapshot)).toMatchObject({ kind: 'set-attribute', attribute: 'alt', from: '', to: 'Fireworks over the bay', after: '<img src="fireworks.jpg" alt="Fireworks over the bay">' })
    expect(nonTextContent.patch?.(fix, html5, snapshot)).toMatchObject({ kind: 'set-attribute', attribute: 'aria-label' })
    const own = page([img('#own', { src: 'w3c.png', alt: 'W3C', 'aria-hidden': 'true' }, { states: ['aria-hidden'] })])
    const [hidden] = nonTextContent.candidates(own, emptyEngine())
    if (!hidden) throw new Error('no candidate')
    expect(nonTextContent.patch?.(fix, hidden, own)).toMatchObject({ kind: 'replace-element', after: '<img src="w3c.png" alt="Fireworks over the bay">' })
  })

  it('leaves out hidden images the collector did not capture, and an img with role="none" from the alternative question', () => {
    const snapshot2 = page([img('#none', { src: 'w3c.png', alt: 'W3C logo', role: 'none' }, { native: { tag: 'img', attributes: { src: 'w3c.png', alt: 'W3C logo', role: 'none' }, presentational: true } }), svg('#bare', {}, { image: undefined })])
    const refs = nonTextContent.candidates(snapshot2, emptyEngine()).map((c) => [c.ref, Boolean(c.context.hidden)])
    expect(refs).toEqual([['#none', true]])
  })

  // Modeled on www.mozilla.org: a pattern of a magazine's initials under its name, a product mark next to the
  // product's name, and a photo whose shirt slogan is quoted, all with alt="".
  it('reads initials, other forms of a word and quotes of the text around it as what that text says', () => {
    const facts = { ...(html5.context.hidden as NonNullable<NonTextContentContext['hidden']>), before: 'Read the report Nothing Personal', after: 'Owners, Not Renters. Data for good.' }
    const initials = { ...claim, imageShows: 'The letters NP repeated in a grid', textInImage: 'NP. NP. NP.', evidence: 'The letters NP repeated in a grid', suggestedAlt: 'NP pattern' }
    expect(verifyHidden(initials, facts)).toEqual({ ok: false, reason: 'the words drawn in the image are in the text around it' })
    const mark = { ...claim, textInImage: 'Own Rent', evidence: 'The words Own and Rent', suggestedAlt: 'Own Rent logo' }
    expect(verifyHidden(mark, facts).ok).toBe(false)
    const quoted = { ...claim, textInImage: 'DATA FOR GOOD', evidence: "The image contains the text 'DATA FOR GOOD'", suggestedAlt: 'People at a meetup' }
    expect(verifyHidden(quoted, facts)).toEqual({ ok: false, reason: 'the text around the image already says what it conveys' })
  })

  it('checks a claim with the words the verification reads, numbers included', () => {
    const facts = { ...(html5.context.hidden as NonNullable<NonTextContentContext['hidden']>), before: 'Sales by region', after: '' }
    expect(verifyHidden({ ...claim, evidence: 'Sales rose 20% in 2024', suggestedAlt: 'Sales rose 20% in 2024' }, facts)).toEqual({ ok: true })
  })
})

describe('rampa eval scores each ACT rule by the question that implements it', () => {
  const snapshot = page([img('#hidden', { src: 'w3c.png', alt: '', 'aria-hidden': 'true' }, { states: ['aria-hidden'] }), img('#named', { src: 'dog.png', alt: 'img-1' })])
  const engine: EngineResults = emptyEngine()
  const finding = (ref: string): Finding => ({ fingerprint: ref, criterion: '1.1.1', level: 'A', source: 'judgment', ref, message: '', confidence: 'low' })

  it('counts a hidden image only for e88epe, and an alternative only for 23a2a8 and qt1vmo', () => {
    expect(judgmentFailsAct(nonTextContent, 'e88epe', { snapshot, engine }, [finding('#hidden')])).toBe(true)
    expect(judgmentFailsAct(nonTextContent, '23a2a8', { snapshot, engine }, [finding('#hidden')])).toBe(false)
    expect(judgmentFailsAct(nonTextContent, 'qt1vmo', { snapshot, engine }, [finding('#named')])).toBe(true)
    expect(judgmentFailsAct(nonTextContent, 'e88epe', { snapshot, engine }, [finding('#named')])).toBe(false)
  })

  it('counts every judgment on a page lent by a rule the criterion does not implement', () => {
    expect(judgmentFailsAct(nonTextContent, 'cc0f0a', { snapshot, engine }, [finding('#hidden')])).toBe(true)
  })
})
