import { describe, expect, it } from 'vitest'
import { isGenericAlt, isLabelAlt, looksLikePlaceholder, namesPurpose, nonTextContent, onlyRewords } from '../src/criteria/non-text-content.ts'
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

describe('1.1.1 functional images', () => {
  // Modeled on the real-page study's dev split: the quick-access tiles of www.ufc.br, a pictogram that is all its
  // link holds, titled like the caption under it, and an app tile on www.gov.br.
  const icon = (ref: string, alt: string, src: string) =>
    node({ ref, role: 'img', name: alt, image: PNG, bounds: { x: 0, y: 0, width: 100, height: 66 }, native: { tag: 'img', attributes: { src, alt }, html: `<img src="${src}" alt="${alt}">` } })
  const link = (ref: string, attributes: Record<string, string>, children: ReturnType<typeof node>[], name?: string) =>
    node({ ref, role: 'link', name, native: { tag: 'a', attributes }, children })
  function tiles(): A11ySnapshot {
    return {
      ...gallery(),
      target: 'test://tiles',
      destinations: { '/sisu': { kind: 'page', title: 'Sisu na UFC', heading: 'Boas-vindas' } },
      root: node({
        ref: 'html',
        role: 'document',
        lang: 'pt-BR',
        children: [
          node({
            ref: '#tile-ti',
            children: [
              link('#ti-link', { href: '/ti', title: 'Solicitação de Serviços de TI' }, [icon('#ti', 'ÍCONE - Solicitação de Serviços de TI', 'ti.png')], 'Solicitação de Serviços de TI'),
              node({ ref: '#ti-caption', role: 'paragraph', children: [node({ ref: '#ti-text', role: 'link', text: 'Solicitação de Serviços de TI' })] }),
            ],
          }),
          node({
            ref: '#tile-contact',
            children: [
              link('#contact-link', { href: '/contatos', title: 'Atendimento ao Servidor' }, [icon('#contact', 'ícone representativo de telefone e e-mail', 'contatos.png')], 'Atendimento ao Servidor'),
              node({ ref: '#contact-caption', role: 'paragraph', text: 'Atendimento ao Servidor' }),
            ],
          }),
          link('#sisu-link', { href: '/sisu' }, [icon('#sisu', 'ÍCONE SISU', 'sisu.png')]),
          node({
            ref: '#app',
            children: [
              link('#app-link', { href: '#' }, [icon('#inss', 'Meu INSS - Central de Serviços', 'imagem.png')]),
              node({ ref: '#app-name', text: 'Meu INSS - Central de Serviços' }),
              node({ ref: '#app-about', text: 'O aplicativo é um canal de contato online com os cidadãos.', states: ['hidden'] }),
            ],
          }),
          link('#story-link', { href: '/story' }, [icon('#story', 'A dog on a beach', 'dog.jpg'), node({ ref: '#story-title', text: 'Dogs at the beach' })]),
          link('#labelled-link', { href: '/', 'aria-label': 'Home' }, [icon('#logo', 'Logo', 'logo.png')], 'Home'),
        ],
      }),
    }
  }
  const candidates = nonTextContent.candidates(tiles(), { engine: engine.engine, rules: [] })
  const byRef = (ref: string) => {
    const candidate = candidates.find((c) => c.ref === ref)
    if (!candidate) throw new Error(`no candidate ${ref}`)
    return candidate
  }
  const claim = (evidence: string) => ({
    verdict: 'fail' as const,
    evidence,
    problem: 'wrong_content' as const,
    imageShows: 'A pictogram',
    suggestedAlt: 'Pictograma de um computador com uma engrenagem',
    confidence: 'high' as const,
  })

  it('knows an image that is all its link holds, with what says where the link leads', () => {
    expect(byRef('#ti').context.functional).toEqual({ control: 'link', title: 'Solicitação de Serviços de TI', href: '/ti', nextTo: 'Solicitação de Serviços de TI' })
    expect(byRef('#sisu').context.functional).toMatchObject({ href: '/sisu', destination: 'Sisu na UFC · Boas-vindas' })
    // Text that is not rendered is not next to anything.
    expect(byRef('#inss').context.functional?.nextTo).toBe('Meu INSS - Central de Serviços')
    // A link with text of its own, or named by its own aria-label, does not take its name from the image.
    expect(byRef('#story').context.functional).toBeUndefined()
    expect(byRef('#logo').context.functional).toBeUndefined()
  })

  it('frames the judgment by the link purpose, with the page data inside <content>', () => {
    const prompt = nonTextContent.prompt(byRef('#ti'), tiles())
    expect(prompt.user).toContain('The image is the only content of a link')
    expect(prompt.user).toContain('a pictogram or a logo stands for the destination or the action')
    const content = prompt.user.slice(prompt.user.indexOf('<content>'))
    expect(content).toContain('Title of the link: "Solicitação de Serviços de TI"')
    expect(content).toContain('Text next to the link: Solicitação de Serviços de TI')
    expect(nonTextContent.prompt(byRef('#sisu'), tiles()).user).toContain('The link leads to: /sisu (a page titled "Sisu na UFC · Boas-vindas")')
    // An image that is not all its link holds keeps the prompt it had.
    expect(nonTextContent.prompt(byRef('#story'), tiles()).user).not.toContain('only content')
  })

  it('drops a "does not show" claim when the alternative names the link title, destination or caption', () => {
    const reason = 'the alternative names the purpose of the link it is the only content of'
    expect(nonTextContent.verify(claim('ÍCONE - Solicitação de Serviços de TI'), byRef('#ti'), tiles())).toEqual({ ok: false, reason })
    expect(nonTextContent.verify(claim('ÍCONE SISU'), byRef('#sisu'), tiles())).toEqual({ ok: false, reason })
    expect(nonTextContent.verify(claim('Meu INSS - Central de Serviços'), byRef('#inss'), tiles())).toEqual({ ok: false, reason })
  })

  it('keeps the claim when the alternative names something else, and keeps other problems', () => {
    expect(nonTextContent.verify(claim('ícone representativo de telefone e e-mail'), byRef('#contact'), tiles())).toEqual({ ok: true })
    expect(nonTextContent.verify({ ...claim('ÍCONE SISU'), problem: 'filename_or_placeholder' }, byRef('#sisu'), tiles())).toEqual({ ok: true })
    expect(nonTextContent.verify(claim('A dog on a beach'), byRef('#story'), tiles())).toEqual({ ok: true })
  })

  it('says a kept claim is about the link purpose', () => {
    expect(nonTextContent.message(claim('ícone representativo de telefone e e-mail'), byRef('#contact'), 'en')).toBe(
      'The text alternative "ícone representativo de telefone e e-mail" is all its link holds, and does not say where the link leads.',
    )
    expect(nonTextContent.message(claim('A dog on a beach'), byRef('#story'), 'en')).toBe('The text alternative "A dog on a beach" describes something the image does not show.')
  })

  it('matches an alternative with a purpose without the words that name the kind of picture', () => {
    expect(namesPurpose('ÍCONE - SOUGOV', ['SouGov.BR - Portal do Servidor'])).toBe(true)
    expect(namesPurpose('Logo UFC', ['Universidade Federal do Ceará - UFC'])).toBe(true)
    expect(namesPurpose('ícone representativo de telefone e e-mail', ['Atendimento ao Servidor'])).toBe(false)
    expect(namesPurpose('ÍCONE', ['Ícone'])).toBe(false)
    expect(namesPurpose('Bus', [undefined, ''])).toBe(false)
  })
})
