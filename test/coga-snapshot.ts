import type { A11yNode, A11ySnapshot } from '../src/snapshot/schema.ts'
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
