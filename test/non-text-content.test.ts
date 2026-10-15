import { describe, expect, it } from 'vitest'
import {
  addressNames,
  isGenericAlt,
  isLabelAlt,
  keepsAlternative,
  looksLikePlaceholder,
  namesAddress,
  namesPurpose,
  namesService,
  nonTextContent,
  onlyRewords,
  repeatsText,
  siteNames,
  splitGlued,
} from '../src/criteria/non-text-content.ts'
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

  it('kills a fail about what the image shows without a usable suggestion', () => {
    expect(nonTextContent.verify({ ...claim, problem: 'missing_information', suggestedAlt: '' }, placeholder, gallery()).ok).toBe(false)
    expect(nonTextContent.verify({ ...claim, problem: 'wrong_content', suggestedAlt: 'IMG-1' }, placeholder, gallery()).ok).toBe(false)
  })

  it('keeps a placeholder fail without a usable suggestion, and writes no patch', () => {
    expect(nonTextContent.verify({ ...claim, suggestedAlt: '' }, placeholder, gallery()).ok).toBe(true)
    expect(nonTextContent.patch?.({ ...claim, suggestedAlt: 'IMG-1' }, placeholder, gallery())).toBeUndefined()
  })

  it('kills a pass that names a problem', () => {
    expect(nonTextContent.verify({ ...claim, verdict: 'pass' }, placeholder, gallery()).ok).toBe(false)
  })

  it('patches the alt with the suggestion', () => {
    expect(nonTextContent.patch?.(claim, placeholder, gallery())?.after).toBe('<img src="dog.svg" alt="Cachorro de desenho com coleira vermelha">')
  })
})

describe('placeholder pattern', () => {
  it.each(['img-1', 'IMG_2034.jpg', 'DSC0001', 'image', 'foto 3', 'banner'])('flags %s', (alt) => {
    expect(looksLikePlaceholder(alt, 'https://example.com/assets/dog.png')).toBe(true)
  })

  it('flags the file name only when it looks like one, not a file named in words', () => {
    expect(looksLikePlaceholder('dog_01', 'https://example.com/assets/dog_01.png')).toBe(true)
    expect(looksLikePlaceholder('dog', 'https://example.com/assets/dog.png')).toBe(false)
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
    expect(nonTextContent.verify({ ...claim, problem: 'missing_information', suggestedAlt: 'Horários e rotas do ônibus da UFC' }, icon, quickAccess())).toEqual({ ok: true })
    // Called "names what the image does not show", the same suggestion still names "Ônibus da UFC": the claim contradicts itself.
    expect(nonTextContent.verify({ ...claim, suggestedAlt: 'Horários e rotas do ônibus da UFC' }, icon, quickAccess())).toEqual({
      ok: false,
      reason: 'the suggested alternative keeps every word of the current one',
    })
  })

  it('keeps a decorative claim, which suggests no text', () => {
    expect(nonTextContent.verify({ ...claim, problem: 'decorative', suggestedAlt: '' }, icon, quickAccess())).toEqual({ ok: true })
  })

  // The held-out re-measurement (docs/studies/real-pages-2026-10-remeasure.md) lost a true "imagem banner" this way.
  it.each(['filename_or_placeholder', 'generic'] as const)('keeps a %s claim with a weak suggestion, without a patch', (problem) => {
    const placeholder = { ...claim, problem, suggestedAlt: 'decorative' }
    expect(nonTextContent.verify(placeholder, icon, quickAccess())).toEqual({ ok: true })
    expect(nonTextContent.patch?.(placeholder, icon, quickAccess())).toBeUndefined()
    expect(nonTextContent.patch?.({ ...placeholder, suggestedAlt: 'Ônibus da UFC: horários e rotas' }, icon, quickAccess())?.to).toBe('Ônibus da UFC: horários e rotas')
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
    // Framed by the link purpose, the model says the same claim as "it does not say where the link leads".
    expect(nonTextContent.verify({ ...claim('ÍCONE SISU'), problem: 'missing_information', suggestedAlt: 'Sisu na UFC' }, byRef('#sisu'), tiles())).toEqual({ ok: false, reason })
  })

  it('keeps the claim when the alternative names something else, and keeps other problems', () => {
    expect(nonTextContent.verify(claim('ícone representativo de telefone e e-mail'), byRef('#contact'), tiles())).toEqual({ ok: true })
    expect(nonTextContent.verify({ ...claim('ícone representativo de telefone e e-mail'), problem: 'missing_information', suggestedAlt: 'Atendimento ao Servidor' }, byRef('#contact'), tiles())).toEqual({ ok: true })
    expect(nonTextContent.verify({ ...claim('ÍCONE SISU'), problem: 'filename_or_placeholder' }, byRef('#sisu'), tiles())).toEqual({ ok: true })
    expect(nonTextContent.verify(claim('A dog on a beach'), byRef('#story'), tiles())).toEqual({ ok: true })
  })

  it('reads the text next to the link as its purpose only when it is a caption, not a paragraph', () => {
    const inss = byRef('#inss')
    const paragraph = `Meu INSS reúne os serviços da Previdência Social. ${'Consulte benefícios, extratos e agendamentos pela internet. '.repeat(2)}`
    const nextToParagraph = { ...inss, context: { ...inss.context, alt: 'Meu INSS', functional: { control: 'link' as const, nextTo: paragraph } } }
    expect(nonTextContent.verify(claim('Meu INSS'), nextToParagraph, tiles())).toEqual({ ok: true })
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

// Modeled on the fresh-page study's dev split (docs/studies/notes-111-dev-fixes.md): each fact or rule, with the
// claims it must keep.
describe('1.1.1 facts that refute a claim', () => {
  const page = (children: ReturnType<typeof node>[], extra: Partial<A11ySnapshot> = {}): A11ySnapshot => ({
    ...gallery(),
    target: 'https://www.example.org/',
    title: 'Portal Example',
    root: node({ ref: 'html', role: 'document', lang: 'pt-BR', children }),
    ...extra,
  })
  const picture = (ref: string, alt: string, src = 'picture.png') =>
    node({ ref, role: 'img', name: alt, image: PNG, bounds: { x: 0, y: 0, width: 120, height: 80 }, native: { tag: 'img', attributes: { src, alt }, html: `<img src="${src}" alt="${alt}">` } })
  const anchor = (ref: string, attributes: Record<string, string>, children: ReturnType<typeof node>[]) => node({ ref, role: 'link', native: { tag: 'a', attributes }, children })
  const candidateOf = (snapshot: A11ySnapshot, ref: string) => {
    const candidate = nonTextContent.candidates(snapshot, { engine: engine.engine, rules: [] }).find((c) => c.ref === ref)
    if (!candidate) throw new Error(`no candidate ${ref}`)
    return candidate
  }
  type Problem = 'wrong_content' | 'missing_information' | 'filename_or_placeholder' | 'generic' | 'decorative'
  const fail = (evidence: string, problem: Problem, suggestedAlt: string) => ({
    verdict: 'fail' as const,
    evidence,
    problem,
    imageShows: 'A picture',
    suggestedAlt,
    confidence: 'high' as const,
  })

  describe('a name glued to the kind of picture', () => {
    // rijksmuseum.nl's footer: each logo in a link the page names with aria-label.
    const footer = page([
      anchor('#ig', { href: 'https://www.instagram.com/rijksmuseum', 'aria-label': 'Instagramlink' }, [picture('#ig-logo', 'Instagramlogo', 'instagram.svg')]),
      anchor('#ocw', { href: 'https://www.government.nl/ocw', 'aria-label': 'Ministry link' }, [picture('#ocw-logo', 'Ministry of Education, Culture and Sciencelogo', 'm-ocw-en.svg')]),
      anchor('#ing', { href: 'https://www.ing.nl/', 'aria-label': 'ING - Engelslink' }, [picture('#ing-logo', 'ING - Engelslogo', 'ing.svg')]),
      anchor('#logo-only', { href: '/', 'aria-label': 'Home' }, [picture('#plain', 'logo', 'brand.svg')]),
    ])

    it('splits a kind word glued to a name, and nothing else', () => {
      expect(splitGlued('instagramlogo')).toEqual(['instagram', 'logo'])
      expect(splitGlued('sciencelogo')).toEqual(['science', 'logo'])
      expect(splitGlued('iconefacebook')).toEqual(['icone', 'facebook'])
      expect(splitGlued('blink')).toEqual(['blink'])
      expect(splitGlued('logotipo')).toEqual(['logotipo'])
      expect(splitGlued('img2034')).toEqual(['img2034'])
      expect(onlyRewords('Instagram', 'Instagramlogo')).toBe(true)
      expect(onlyRewords('Instagram logo', 'Instagramlogo')).toBe(true)
      expect(onlyRewords('Facebook', 'Instagramlogo')).toBe(false)
    })

    it('drops "names what the image does not show" when the suggestion is the name without "logo"', () => {
      const reason = 'suggested alternative only rewords the current one'
      expect(nonTextContent.verify(fail('Instagramlogo', 'wrong_content', 'Instagram'), candidateOf(footer, '#ig-logo'), footer)).toEqual({ ok: false, reason })
      const ministry = 'Ministry of Education, Culture and Sciencelogo'
      expect(nonTextContent.verify(fail(ministry, 'wrong_content', 'Ministry of Education, Culture and Science'), candidateOf(footer, '#ocw-logo'), footer)).toEqual({ ok: false, reason })
      expect(nonTextContent.verify(fail('ING - Engelslogo', 'wrong_content', 'ING logo'), candidateOf(footer, '#ing-logo'), footer)).toEqual({ ok: false, reason })
    })

    it('keeps the claim when the glued name is the wrong one, and keeps "logo" alone', () => {
      expect(nonTextContent.verify(fail('Instagramlogo', 'wrong_content', 'Facebook'), candidateOf(footer, '#ig-logo'), footer)).toEqual({ ok: true })
      expect(nonTextContent.verify(fail('logo', 'wrong_content', 'Rijksmuseum'), candidateOf(footer, '#plain'), footer)).toEqual({ ok: true })
      expect(nonTextContent.verify(fail('logo', 'filename_or_placeholder', 'logo'), candidateOf(footer, '#plain'), footer)).toEqual({ ok: true })
    })
  })

  describe('an image that repeats the text of its link', () => {
    // ce.gov.br's "Mais acessados": a 32 px pictogram and the service's name in one link.
    const crlv = 'Emitir o licenciamento anual do veículo (CRLV)'
    const services = page([
      anchor('#crlv', { href: '/servico/2671' }, [picture('#crlv-icon', crlv, 'servico-2671.png'), node({ ref: '#crlv-text', text: crlv }), node({ ref: '#chevron', text: 'chevron_right' })]),
      anchor('#ipva', { href: '/servico/2426' }, [picture('#ipva-icon', 'Carro vermelho', 'servico-2426.png'), node({ ref: '#ipva-text', text: 'DAE para pagamento de IPVA' })]),
      anchor('#file', { href: '/img-1.png' }, [picture('#file-icon', 'img-1', 'img-1.png'), node({ ref: '#file-text', text: 'img-1' })]),
    ])

    it('knows the visible text of the link the image sits in, without the image', () => {
      expect(candidateOf(services, '#crlv-icon').context.controlText).toBe(`${crlv} chevron_right`)
      expect(repeatsText('Transferir a propriedade', 'Transferir a propriedade do veículo')).toBe(true)
      expect(repeatsText('Transferir o veículo', 'Transferir a propriedade do veículo')).toBe(false)
      expect(repeatsText('de', 'Transferir a propriedade de veículo')).toBe(false)
    })

    it('drops a claim about what the image shows when its alternative is the link text', () => {
      const reason = 'the alternative repeats the visible text of the link or button it sits in'
      const icon = candidateOf(services, '#crlv-icon')
      expect(nonTextContent.verify(fail(crlv, 'wrong_content', 'Ícone de veículo'), icon, services)).toEqual({ ok: false, reason })
      expect(nonTextContent.verify(fail(crlv, 'missing_information', 'Ícone de um carro verde'), icon, services)).toEqual({ ok: false, reason })
    })

    it('keeps an alternative that names something else, a placeholder, and the decorative claim', () => {
      expect(nonTextContent.verify(fail('Carro vermelho', 'wrong_content', 'Documento com cifrão'), candidateOf(services, '#ipva-icon'), services)).toEqual({ ok: true })
      expect(nonTextContent.verify(fail('img-1', 'wrong_content', 'Ícone de arquivo'), candidateOf(services, '#file-icon'), services)).toEqual({ ok: true })
      expect(nonTextContent.verify(fail(crlv, 'decorative', ''), candidateOf(services, '#crlv-icon'), services)).toEqual({ ok: true })
    })
  })

  describe('a linked image whose alternative names where the link leads', () => {
    const reason = 'the alternative names the purpose of the link it is the only content of'
    const portal = page(
      [
        anchor('#saude', { href: 'https://www.example.org/novasaude/' }, [picture('#saude-img', 'Imagem aérea da área da saúde com o selo Nova Saúde Unicamp')]),
        anchor('#saude-read', { href: '/saude' }, [picture('#saude-read-img', 'Banner do programa Nova Saúde')]),
        anchor('#portal', { href: '/agenda' }, [picture('#portal-img', 'Portal Example em destaque')]),
        anchor('#museu', { href: 'https://www.museudavida.example.org/' }, [picture('#museu-img', 'Pirâmide científica do Museu da Vida')]),
        anchor('#anbi', { href: '/en/support/donate/anbi-information' }, [picture('#anbi-img', 'ANBIlogo', 'anbi.svg')]),
        anchor('#mapa', { href: '/unidades-e-escritorios' }, [picture('#mapa-img', 'Mapa do Brasil')]),
        anchor('#chuva', { href: '/noticias/brasil-tem-recorde-de-chuva-em-sao-paulo' }, [picture('#chuva-img', 'Brasil')]),
        anchor('#site', { href: '/noticias/vacina-example' }, [picture('#site-img', 'Example')]),
        anchor('#tarja', { href: '/especiais' }, [picture('#tarja-img', 'Tarja-Especiais-Site-Interna-1', 'Tarja-Especiais-Site-Interna-1.png')]),
      ],
      {
        destinations: {
          '/saude': { kind: 'page', title: 'Nova Saúde - Portal Example', heading: 'Nova Saúde' },
          '/agenda': { kind: 'page', title: 'Agenda | Portal Example' },
          '/unidades-e-escritorios': { kind: 'page', title: 'Unidades e escritórios | Portal Example' },
          '/especiais': { kind: 'page', title: 'Especiais - Portal Example' },
        },
      },
    )

    it("keeps the names of the destination apart from the site's own name", () => {
      expect(candidateOf(portal, '#saude-read-img').context.functional).toMatchObject({ names: ['nova saúde'], addressNames: ['saude'] })
      expect(siteNames(portal).parts).toEqual(new Set(['portal example']))
      expect(addressNames('https://www.museudavida.example.org/', portal)).toEqual(['museudavida'])
      expect(addressNames('https://www.example.org/novasaude/', portal)).toEqual(['novasaude'])
      expect(addressNames('#', portal)).toEqual([])
      expect(addressNames('mailto:a@example.org', portal)).toEqual([])
    })

    it('drops "does not say where the link leads" when the alternative names the destination or its address', () => {
      for (const [ref, alt] of [
        ['#saude-img', 'Imagem aérea da área da saúde com o selo Nova Saúde Unicamp'],
        ['#saude-read-img', 'Banner do programa Nova Saúde'],
        ['#museu-img', 'Pirâmide científica do Museu da Vida'],
        ['#anbi-img', 'ANBIlogo'],
      ] as const) {
        expect(nonTextContent.verify(fail(alt, 'missing_information', 'Página do programa'), candidateOf(portal, ref), portal)).toEqual({ ok: false, reason })
      }
    })

    it('keeps the claim when the alternative names only the picture, the site, or one word of a long slug', () => {
      for (const [ref, alt] of [
        ['#mapa-img', 'Mapa do Brasil'],
        ['#portal-img', 'Portal Example em destaque'],
        ['#chuva-img', 'Brasil'],
        ['#site-img', 'Example'],
        ['#tarja-img', 'Tarja-Especiais-Site-Interna-1'],
      ] as const) {
        expect(nonTextContent.verify(fail(alt, 'missing_information', 'Unidades e escritórios'), candidateOf(portal, ref), portal)).toEqual({ ok: true })
      }
      expect(namesAddress('Brasil', 'brasil-tem-recorde-de-chuva-em-sao-paulo')).toBe(false)
      expect(namesAddress('Mapa do Brasil', 'unidades-e-escritorios')).toBe(false)
    })
  })

  describe('a share or follow link named for its service', () => {
    const reason = 'the alternative names the purpose of the link it is the only content of'
    // medlineplus.gov's share row: an X logo with alt="X" and href="#", between Facebook and Pinterest.
    const row = page([
      node({
        ref: '#share',
        children: [
          anchor('#mail', { href: 'mailto:' }, [node({ ref: '#mail-text', text: 'Email this page to a friend' })]),
          anchor('#facebook', { href: '#' }, [picture('#facebook-img', 'Facebook')]),
          anchor('#x', { href: '#', title: 'X' }, [picture('#x-img', 'X', 'i_share_twitter.png')]),
          anchor('#pinterest', { href: '#' }, [picture('#pinterest-img', 'Pinterest')]),
        ],
      }),
      node({ ref: '#dialog', children: [anchor('#close', { href: '#' }, [picture('#close-img', 'X', 'close.png')]), node({ ref: '#close-text', text: 'Newsletter' })] }),
      node({ ref: '#follow', children: [anchor('#yt', { href: 'https://www.youtube.com/user/example' }, [picture('#yt-img', 'You Tube')])] }),
      node({ ref: '#wrong', children: [anchor('#fb', { href: 'https://www.instagram.com/example' }, [picture('#fb-img', 'Facebook')]), node({ ref: '#wrong-text', text: 'Siga-nos' })] }),
    ])

    it('drops the claim for a service named in a row of services, or at its own host', () => {
      expect(nonTextContent.verify(fail('X', 'missing_information', 'Share on X'), candidateOf(row, '#x-img'), row)).toEqual({ ok: false, reason })
      expect(nonTextContent.verify(fail('You Tube', 'missing_information', 'YouTube channel'), candidateOf(row, '#yt-img'), row)).toEqual({ ok: false, reason })
    })

    it('keeps it for an "X" that closes a dialog, and for a service the link does not lead to', () => {
      expect(nonTextContent.verify(fail('X', 'missing_information', 'Close'), candidateOf(row, '#close-img'), row)).toEqual({ ok: true })
      expect(nonTextContent.verify(fail('Facebook', 'wrong_content', 'Instagram'), candidateOf(row, '#fb-img'), row)).toEqual({ ok: true })
      expect(namesService('X', { control: 'button', href: undefined, nextTo: 'Facebook Pinterest' })).toBe(false)
    })
  })

  describe('a name that is also the file name, and a suggestion that keeps the alternative', () => {
    // poder360.com.br's election widget: alt="Lula" from Lula.png, suggested "Lula com um selo de 16%".
    const widget = page([node({ ref: '#candidates', children: [picture('#lula', 'Lula', 'Lula.png'), node({ ref: '#votes', text: 'Lula PT 53.879.538 votos' })] })])
    const lula = candidateOf(widget, '#lula')

    it('reads a file named in words as no file-name placeholder, and one named like a file as one', () => {
      expect(looksLikePlaceholder('Lula', 'https://example.org/Lula.png')).toBe(false)
      expect(looksLikePlaceholder('Tarja-Especiais-Site-Interna-1', 'https://example.org/Tarja-Especiais-Site-Interna-1.png')).toBe(true)
      expect(looksLikePlaceholder('foto_capa', 'https://example.org/foto_capa.jpg')).toBe(true)
      expect(looksLikePlaceholder('dog-2', 'https://example.org/dog-2.png')).toBe(true)
      expect(nonTextContent.message(fail('Lula', 'wrong_content', 'Lula com um selo de 16%'), lula, 'en')).toBe('The text alternative "Lula" describes something the image does not show.')
    })

    it('drops "names what the image does not show" when the suggestion keeps every word of the alternative', () => {
      expect(keepsAlternative('Lula com um selo de 16%', 'Lula')).toBe(true)
      expect(nonTextContent.verify(fail('Lula', 'wrong_content', 'Lula com um selo de 16%'), lula, widget)).toEqual({ ok: false, reason: 'the suggested alternative keeps every word of the current one' })
    })

    it('keeps a claim whose suggestion names someone else, and a "leaves out" claim that keeps the alternative', () => {
      expect(nonTextContent.verify(fail('Lula', 'wrong_content', 'Jair Bolsonaro'), lula, widget)).toEqual({ ok: true })
      expect(nonTextContent.verify(fail('Lula', 'missing_information', 'Lula sorrindo, com 45% dos votos'), lula, widget)).toEqual({ ok: true })
      expect(keepsAlternative('Imagem de um cachorro', 'Imagem')).toBe(false)
    })
  })

  // What none of these facts may hide: placeholders, a file name, "logo" alone, an alternative that names the wrong
  // thing, and an empty alternative on an informative image (asked as a hidden image, with its own verification).
  it.each([
    ['img-1', 'img-1.png'],
    ['image.png', 'image.png'],
    ['logo', 'logo.svg'],
  ])('still keeps the claim on "%s", whatever the suggestion repeats', (alt, src) => {
    const destinations = { '/logo-page': { kind: 'page' as const, title: `${alt} - Portal Example` } }
    const snapshot = page([anchor('#a', { href: '/logo-page' }, [picture('#p', alt, src)]), node({ ref: '#t', text: alt })], { destinations })
    const candidate = candidateOf(snapshot, '#p')
    for (const problem of ['filename_or_placeholder', 'wrong_content', 'missing_information'] as const) {
      expect(nonTextContent.verify(fail(alt, problem, `${alt} Cachorro marrom`), candidate, snapshot)).toEqual({ ok: true })
    }
  })

  it('still keeps a claim that the alternative names the wrong thing', () => {
    const snapshot = page([anchor('#a', { href: '/gatos' }, [picture('#p', 'Cachorro na praia', 'praia.jpg')]), node({ ref: '#t', text: 'Adote um gato' })])
    expect(nonTextContent.verify(fail('Cachorro na praia', 'wrong_content', 'Gato dormindo no sofá'), candidateOf(snapshot, '#p'), snapshot)).toEqual({ ok: true })
  })

  it('still keeps a claim on an informative image with an empty alternative', () => {
    const chart = node({
      ref: '#chart',
      role: 'presentation',
      image: PNG,
      bounds: { x: 0, y: 0, width: 400, height: 300 },
      native: { tag: 'img', attributes: { src: 'vendas.png', alt: '' }, html: '<img src="vendas.png" alt="">' },
    })
    const snapshot = page([node({ ref: '#before', role: 'paragraph', text: 'Relatório anual' }), chart])
    const candidate = candidateOf(snapshot, '#chart')
    expect(candidate.context.hidden).toBeDefined()
    const claim = {
      imageShows: 'A bar chart of sales rising from 10 to 40',
      textInImage: 'Q1 10 Q2 40',
      verdict: 'fail' as const,
      evidence: 'sales rise from 10 to 40 between Q1 and Q2',
      suggestedAlt: 'Gráfico: vendas sobem de 10 no 1º trimestre para 40 no 2º',
      confidence: 'high' as const,
    }
    expect(nonTextContent.verify(claim, candidate, snapshot)).toEqual({ ok: true })
  })
})
