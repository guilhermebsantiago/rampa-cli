import { describe, expect, it } from 'vitest'
import { isGenericAlt, looksLikePlaceholder, nonTextContent } from '../src/criteria/non-text-content.ts'
import type { EngineResults } from '../src/core/types.ts'
import type { A11ySnapshot } from '../src/snapshot/schema.ts'
import { node } from './helpers.ts'

const PNG = 'data:image/png;base64,iVBORw0KGgo='

function gallery(): A11ySnapshot {
  const img = (ref: string, alt: string | undefined, image: string | null = PNG) =>
    node({
      ref,
      role: alt === '' ? 'presentation' : 'img',
      name: alt,
      image: image ?? undefined,
      bounds: { x: 0, y: 0, width: 160, height: 160 },
      native: { tag: 'img', attributes: { src: 'dog.svg', ...(alt === undefined ? {} : { alt }) }, html: `<img src="dog.svg" alt="${alt ?? ''}">` },
    })
  return {
    schemaVersion: 1,
    surface: 'web',
    target: 'test://gallery',
    locale: 'pt-BR',
    viewport: { width: 1280, height: 800, scale: 1 },
    collectedAt: '2026-10-07T00:00:00.000Z',
    collector: { name: 'test', version: '0' },
    root: node({
      ref: 'html',
      role: 'document',
      lang: 'pt-BR',
      children: [
        img('#placeholder', 'img-1'),
        img('#good', 'Totó, cachorro de desenho com coleira vermelha'),
        img('#decorative', ''),
        img('#missing', undefined),
        img('#not-captured', 'Foto do Totó', null),
      ],
    }),
  }
}

const engine: EngineResults = {
  engine: { name: 'axe-core', version: 'test' },
  rules: [{ ruleId: 'image-alt', outcome: 'violation', criteria: ['1.1.1'], help: 'Images must have alternative text', nodes: [{ ref: '#missing', target: '["#missing"]', html: '' }] }],
}

describe('1.1.1 candidates', () => {
  it('judges only images with a non-empty alternative that were captured', () => {
    const candidates = nonTextContent.candidates(gallery(), engine)
    expect(candidates.map((c) => c.ref)).toEqual(['#placeholder', '#good'])
    expect(candidates[0]?.context).toMatchObject({ alt: 'img-1', language: 'pt-BR', src: 'dog.svg' })
  })

  it('sends the rendered image with the prompt', () => {
    const [candidate] = nonTextContent.candidates(gallery(), engine)
    if (!candidate) throw new Error('no candidate')
    const prompt = nonTextContent.prompt(candidate, gallery())
    expect(prompt.images).toHaveLength(1)
    expect(prompt.images?.[0]?.mediaType).toBe('image/png')
    expect(prompt.user).toContain('Current text alternative: "img-1"')
  })
})

describe('1.1.1 verification', () => {
  const [placeholder] = nonTextContent.candidates(gallery(), engine)
  if (!placeholder) throw new Error('no candidate')
  const claim = {
    verdict: 'fail' as const,
    evidence: 'img-1',
    problem: 'filename_or_placeholder' as const,
    imageShows: 'A cartoon dog with a red collar',
    suggestedAlt: 'Cachorro de desenho com coleira vermelha',
    confidence: 'high' as const,
  }

  it('accepts a claim that quotes the current alternative', () => {
    expect(nonTextContent.verify(claim, placeholder, gallery())).toEqual({ ok: true })
  })

  it('kills a claim about another alternative', () => {
    expect(nonTextContent.verify({ ...claim, evidence: 'img-2' }, placeholder, gallery()).ok).toBe(false)
  })

  it('kills a fail without a usable suggestion', () => {
    expect(nonTextContent.verify({ ...claim, suggestedAlt: '' }, placeholder, gallery()).ok).toBe(false)
    expect(nonTextContent.verify({ ...claim, suggestedAlt: 'IMG-1' }, placeholder, gallery()).ok).toBe(false)
  })

  it('kills a pass that names a problem', () => {
    expect(nonTextContent.verify({ ...claim, verdict: 'pass' }, placeholder, gallery()).ok).toBe(false)
  })

  it('patches the alt with the suggestion', () => {
    expect(nonTextContent.patch?.(claim, placeholder, gallery())?.after).toBe('<img src="dog.svg" alt="Cachorro de desenho com coleira vermelha">')
  })
})

describe('placeholder pattern', () => {
  it.each(['img-1', 'IMG_2034.jpg', 'DSC0001', 'image', 'foto 3', 'banner', 'dog'])('flags %s', (alt) => {
    expect(looksLikePlaceholder(alt, 'https://example.com/assets/dog.png')).toBe(true)
  })

  it.each(['Totó sorrindo na porta da loja', 'Gráfico de vendas de 2025', 'Logo da Árvore'])('leaves %s alone', (alt) => {
    expect(looksLikePlaceholder(alt, 'https://example.com/logo.png')).toBe(false)
  })
})

describe('generic alternatives', () => {
  it('names a single category word as generic, whatever the model labeled it', () => {
    expect(isGenericAlt('Product')).toBe(true)
    expect(isGenericAlt('produto')).toBe(true)
    expect(isGenericAlt('Potted plant')).toBe(false)
  })
})
