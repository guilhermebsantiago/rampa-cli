import { describe, expect, it } from 'vitest'
import { isGenericAlt, isLabelAlt, looksLikePlaceholder, nonTextContent, onlyRewords } from '../src/criteria/non-text-content.ts'
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

describe('1.1.1 suggestions that are labels or rewordings', () => {
  // Modeled on the real-page study's dev split: a quick-access icon inside a link on a university home page.
  function quickAccess(): A11ySnapshot {
    return {
      ...gallery(),
      target: 'test://quick-access',
      root: node({
        ref: 'html',
        role: 'document',
        lang: 'pt-BR',
        children: [
          node({
            ref: '#bus-link',
            role: 'link',
            name: 'ÍCONE - Ônibus da UFC',
            children: [
              node({
                ref: '#bus-icon',
                role: 'img',
                name: 'ÍCONE - Ônibus da UFC',
                image: PNG,
                bounds: { x: 0, y: 0, width: 48, height: 48 },
                native: { tag: 'img', attributes: { src: 'onibus.png', alt: 'ÍCONE - Ônibus da UFC' }, html: '<img src="onibus.png" alt="ÍCONE - Ônibus da UFC">' },
              }),
            ],
          }),
        ],
      }),
    }
  }
  const [icon] = nonTextContent.candidates(quickAccess(), { engine: engine.engine, rules: [] })
  if (!icon) throw new Error('no candidate')
  const claim = {
    verdict: 'fail' as const,
    evidence: 'ÍCONE - Ônibus da UFC',
    problem: 'wrong_content' as const,
    imageShows: 'A white bus pictogram on a blue square',
    suggestedAlt: 'Ônibus da UFC',
    confidence: 'high' as const,
  }

  it('drops a fail whose suggestion only removes words from the current alternative', () => {
    expect(nonTextContent.verify(claim, icon, quickAccess())).toEqual({ ok: false, reason: 'suggested alternative only rewords the current one' })
    expect(nonTextContent.verify({ ...claim, suggestedAlt: 'UFC: ônibus' }, icon, quickAccess()).ok).toBe(false)
  })

  it.each(['decorative', 'Decorativo', 'ícone', 'Icono', 'imagem', 'Imagen', 'photo', 'foto', 'icon', '[decorative image]'])('drops a fail whose suggestion is the label "%s"', (suggestedAlt) => {
    expect(nonTextContent.verify({ ...claim, problem: 'missing_information', suggestedAlt }, icon, quickAccess())).toEqual({
      ok: false,
      reason: 'suggested alternative is a label, not a description',
    })
  })

  it('keeps a fail whose suggestion describes the destination', () => {
    expect(nonTextContent.verify({ ...claim, suggestedAlt: 'Horários e rotas do ônibus da UFC' }, icon, quickAccess())).toEqual({ ok: true })
  })

  it('keeps a decorative claim, which suggests no text', () => {
    expect(nonTextContent.verify({ ...claim, problem: 'decorative', suggestedAlt: '' }, icon, quickAccess())).toEqual({ ok: true })
  })

  it('recognizes labels and rewordings', () => {
    expect(isLabelAlt('Imagem decorativa')).toBe(true)
    expect(isLabelAlt('Ícone de ônibus')).toBe(false)
    expect(onlyRewords('Transparência e Prestação de Contas', 'ÍCONE - Transparência e Prestação de Contas')).toBe(true)
    expect(onlyRewords('Ônibus da UFC: horários', 'ÍCONE - Ônibus da UFC')).toBe(false)
  })
})
