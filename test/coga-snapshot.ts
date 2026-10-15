import type { A11yNode, A11ySnapshot, TextBlockFacts } from '../src/snapshot/schema.ts'
import { node } from './helpers.ts'

const box = { x: 0, y: 0, width: 240, height: 24 }

/** An element as the web collector records it: tag, kept attributes, and its start tag as markup. */
function element(ref: string, tag: string, attributes: Record<string, string>, extra: Partial<A11yNode> = {}): A11yNode {
  const markup = Object.entries(attributes)
    .map(([name, value]) => ` ${name}="${value}"`)
    .join('')
  return node({ ref, bounds: box, ...extra, native: { tag, attributes, html: `<${tag}${markup}>` } })
}

/**
 * A Brazilian sign-up page with one case for each wave-1 check: a CEP field of type number, a field
 * labelled only by its placeholder, a pre-checked paid option, and an abbreviation with no expansion.
 * The newsletter box (checked, no price) and the labelled name field must stay silent.
 */
export function cadastroSnapshot(target = 'https://servicos.exemplo.gov.br/cadastro'): A11ySnapshot {
  return {
    schemaVersion: 1,
    surface: 'web',
    target,
    title: 'Cadastro',
    locale: 'pt-BR',
    viewport: { width: 1280, height: 800, scale: 1 },
    collectedAt: '2026-10-09T00:00:00.000Z',
    collector: { name: 'test', version: '0' },
    root: node({
      ref: 'html',
      role: 'document',
      lang: 'pt-BR',
      native: { tag: 'html' },
      children: [
        node({
          ref: 'html > body',
          native: { tag: 'body' },
          children: [
            node({
              ref: 'main',
              role: 'main',
              bounds: box,
              native: { tag: 'main' },
              children: [
                node({ ref: 'main > p', role: 'paragraph', text: 'Informe o NIS para receber o benefício.', bounds: box, native: { tag: 'p' } }),
                node({
                  ref: 'form',
                  role: 'form',
                  bounds: box,
                  native: { tag: 'form', attributes: {} },
                  children: [
                    element('label.nome', 'label', { for: 'nome' }, { text: 'Nome completo' }),
                    element('#nome', 'input', { id: 'nome', name: 'nome', placeholder: 'Maria da Silva' }, { role: 'textbox', name: 'Nome completo' }),
                    element('label.cep', 'label', { for: 'cep' }, { text: 'CEP' }),
                    element('#cep', 'input', { id: 'cep', name: 'cep', type: 'number', autocomplete: 'postal-code' }, { role: 'spinbutton', name: 'CEP' }),
                    node({
                      ref: 'div.email',
                      bounds: box,
                      native: { tag: 'div' },
                      children: [element('#email', 'input', { id: 'email', type: 'email', name: 'email', placeholder: 'Seu e-mail' }, { role: 'textbox' })],
                    }),
                    node({
                      ref: 'div.seguro',
                      bounds: box,
                      native: { tag: 'div' },
                      children: [
                        element('#seguro', 'input', { id: 'seguro', type: 'checkbox', name: 'seguro', checked: '' }, { role: 'checkbox', name: 'Seguro residencial + R$ 9,90', states: ['checked', 'focusable'] }),
                        element('label.seguro', 'label', { for: 'seguro' }, { text: 'Seguro residencial + R$ 9,90' }),
                      ],
                    }),
                    node({
                      ref: 'div.news',
                      bounds: box,
                      native: { tag: 'div' },
                      children: [
                        element('#news', 'input', { id: 'news', type: 'checkbox', name: 'news', checked: '' }, { role: 'checkbox', name: 'Quero receber novidades', states: ['checked', 'focusable'] }),
                        element('label.news', 'label', { for: 'news' }, { text: 'Quero receber novidades' }),
                      ],
                    }),
                    element('form > button', 'button', { type: 'submit' }, { role: 'button', name: 'ENVIAR', text: 'ENVIAR' }),
                  ],
                }),
              ],
            }),
          ],
        }),
      ],
    }),
  }
}

const SAMPLE = 'O Cadastro Único reúne informações sobre as famílias de baixa renda que vivem no Brasil. Com ele, o governo conhece quem são essas…'

/** The facts the collector records for a block of reading text, set here as a well-set paragraph unless overridden. */
function block(ref: string, extra: Partial<TextBlockFacts> = {}): TextBlockFacts {
  return {
    ref,
    tag: 'p',
    chars: 380,
    words: 60,
    sample: SAMPLE,
    lines: 6,
    charsPerLine: { median: 66, max: 70 },
    lineGap: 25.6,
    fontSize: 16,
    lineHeight: '25.6px',
    family: 'Arial, sans-serif',
    font: 'Arial',
    align: 'start',
    direction: 'ltr',
    letters: 310,
    cased: 310,
    upper: 6,
    italic: 0,
    capsBy: 'text',
    ...extra,
  }
}

/**
 * A page with one case of each check of how text and controls are presented, as the collector records it with
 * --profile cognitive (snapshot.presentation): lines of 150 characters, a justified block, lines 1.05 apart, a passage in
 * capitals, one in italics, one in Comic Sans, a row of social icons with names nobody sees, and footer links that open
 * a new window. The well-set paragraph, the search button and the warned link must stay silent.
 */
export function presentationSnapshot(target = 'https://servicos.exemplo.gov.br/cadastro'): A11ySnapshot {
  const p = (ref: string, text: string) => node({ ref, role: 'paragraph', text, bounds: { x: 0, y: 0, width: 480, height: 150 }, native: { tag: 'p' } })
  const icon = (ref: string, name: string, extra: Record<string, string> = {}) =>
    element(ref, 'a', { href: `https://${name.toLowerCase()}.com/prefeitura`, 'aria-label': name, ...extra }, { role: 'link', name })
  const blocks = [
    block('#bem-feito'),
    block('#longo', { charsPerLine: { median: 150, max: 156 }, lines: 4 }),
    block('#justificado', { align: 'justify' }),
    block('#apertado', { lineGap: 16.8, lineHeight: '16.8px' }),
    block('#maiusculas', { words: 22, lines: 3, upper: 300, capsBy: 'text-transform' }),
    block('#italico', { italic: 310 }),
    block('#comic', { family: '"Comic Sans MS", cursive', font: 'Comic Sans MS', platformFont: 'Comic Sans MS' }),
  ]
  return {
    schemaVersion: 1,
    surface: 'web',
    target,
    title: 'Cadastro',
    locale: 'pt-BR',
    viewport: { width: 1280, height: 720, scale: 1 },
    collectedAt: '2026-10-15T00:00:00.000Z',
    collector: { name: 'test', version: '0' },
    root: node({
      ref: 'html',
      role: 'document',
      lang: 'pt-BR',
      native: { tag: 'html' },
      children: [
        node({
          ref: 'html > body',
          native: { tag: 'body' },
          children: [
            node({
              ref: 'main',
              role: 'main',
              bounds: box,
              native: { tag: 'main' },
              children: [
                node({ ref: 'article', role: 'article', bounds: box, native: { tag: 'article' }, children: blocks.map((fact) => p(fact.ref, SAMPLE)) }),
                element('#buscar', 'button', { type: 'submit', 'aria-label': 'Buscar' }, { role: 'button', name: 'Buscar' }),
              ],
            }),
            node({
              ref: 'footer',
              role: 'contentinfo',
              bounds: box,
              native: { tag: 'footer' },
              children: [
                node({
                  ref: 'footer > ul',
                  role: 'list',
                  bounds: box,
                  native: { tag: 'ul' },
                  children: [icon('#facebook', 'Facebook'), icon('#instagram', 'Instagram'), icon('#youtube', 'YouTube')],
                }),
                element('#transparencia', 'a', { href: 'https://transparencia.exemplo.gov.br', target: '_blank' }, { role: 'link', name: 'Portal da Transparência', text: 'Portal da Transparência' }),
                element('#ouvidoria', 'a', { href: 'https://ouvidoria.exemplo.gov.br', target: '_blank' }, { role: 'link', name: 'Ouvidoria (abre em nova aba)', text: 'Ouvidoria (abre em nova aba)' }),
              ],
            }),
          ],
        }),
      ],
    }),
    presentation: {
      version: '1',
      viewport: { width: 1280, height: 720 },
      scope: 'main',
      blocks,
      controls: [
        { ref: '#facebook', icon: 'svg', name: 'Facebook' },
        { ref: '#instagram', icon: 'svg', name: 'Instagram' },
        { ref: '#youtube', icon: 'svg', name: 'YouTube' },
        { ref: '#buscar', icon: 'svg', name: 'Buscar' },
      ],
      links: [
        { ref: '#transparencia', by: 'target', target: '_blank', text: 'Portal da Transparência' },
        { ref: '#ouvidoria', by: 'target', target: '_blank', text: 'Ouvidoria (abre em nova aba)' },
      ],
      leftOut: { blocks: 0, controls: 0, links: 0 },
      ms: 12,
    },
  }
}
