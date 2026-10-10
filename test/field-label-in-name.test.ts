import { describe, expect, it } from 'vitest'
import { emptyEngine } from '../src/engine/axe.ts'
import { fieldLabelInNameRule } from '../src/rules/label-in-name.ts'
import { indexTree } from '../src/snapshot/tree.ts'
import type { A11yNode, A11ySnapshot } from '../src/snapshot/schema.ts'
import { node } from './helpers.ts'

const box = { x: 0, y: 0, width: 200, height: 32 }

function field(id: string, name: string, attributes: Record<string, string>, tag = 'input'): A11yNode {
  const attrs = Object.entries({ id, ...attributes })
    .map(([key, value]) => ` ${key}="${value}"`)
    .join('')
  return node({ ref: `#${id}`, role: 'textbox', name, bounds: box, native: { tag, attributes: { id, ...attributes }, html: `<${tag}${attrs}>` } })
}

const label = (target: string, text: string, extra: Partial<A11yNode> = {}) =>
  node({ ref: `label[for=${target}]`, bounds: box, native: { tag: 'label', attributes: { for: target } }, children: [node({ ref: `label[for=${target}] > span`, text, bounds: box })], ...extra })

/** A sign-up form: one field named over its label, one whose name repeats it, and near misses. */
function form(): A11ySnapshot {
  return {
    schemaVersion: 1,
    surface: 'web',
    target: 'test://signup',
    locale: 'pt-BR',
    viewport: { width: 1280, height: 800, scale: 1 },
    collectedAt: '2026-10-09T00:00:00.000Z',
    collector: { name: 'test', version: '0' },
    root: node({
      ref: 'html',
      role: 'document',
      lang: 'pt-BR',
      children: [
        label('cpf', 'CPF*'),
        field('cpf', 'document', { type: 'text', 'aria-label': 'document' }),
        label('phone', 'Telefone (obrigatório)'),
        field('phone', 'Telefone celular com DDD', { type: 'tel', 'aria-label': 'Telefone celular com DDD' }),
        label('mail', 'E-mail'),
        field('mail', 'Email address', { type: 'email', 'aria-label': 'Email address' }),
        label('ship', 'Info'),
        field('ship', 'Information about shipping', { type: 'text', 'aria-label': 'Information about shipping' }),
        label('city', 'Cidade'),
        field('city', 'Cidade', { type: 'text' }),
        label('hidden', 'Apelido', { states: ['hidden'] }),
        field('hidden', 'nickname', { type: 'text', 'aria-label': 'nickname' }),
        field('go', 'Enviar', { type: 'submit', 'aria-label': 'Enviar' }),
        field('nome', 'name', { type: 'text', 'aria-label': 'name', placeholder: 'Nome*' }),
        field('busca', 'Buscar notícias', { type: 'text', 'aria-label': 'Buscar notícias', placeholder: 'Buscar' }),
      ],
    }),
  }
}

describe('rampa/field-label-in-name (2.5.3 for form fields)', () => {
  const run = () => {
    const snapshot = form()
    return fieldLabelInNameRule.run(snapshot, emptyEngine(), { locale: 'en', index: indexTree(snapshot.root) })
  }

  it('fails a field whose aria-label leaves out the label on screen', () => {
    const { hits } = run()
    const cpf = hits.find((hit) => hit.ref === '#cpf')
    expect(cpf?.outcome).toBe('fail')
    expect(cpf?.evidence).toBe('"CPF*" / "document"')
    expect(fieldLabelInNameRule.message(cpf!, 'en')).toContain('The visible label "CPF*" is not in the field\'s accessible name, "document"')
    expect(fieldLabelInNameRule.patch?.(cpf!, form())).toEqual({
      ref: '#cpf',
      kind: 'replace-element',
      to: 'CPF*',
      before: '<input id="cpf" type="text" aria-label="document">',
      after: '<input id="cpf" type="text">',
    })
  })

  it('passes a name that contains the label, without its required mark', () => {
    const refs = run().hits.map((hit) => hit.ref)
    expect(refs).not.toContain('#phone')
    // Only the hyphen differs: speech input takes "email" for "E-mail".
    expect(refs).not.toContain('#mail')
    expect(refs).not.toContain('#city')
  })

  it('sends a near match to review, and leaves hidden labels and buttons out', () => {
    const { hits, applicable } = run()
    expect(hits.find((hit) => hit.ref === '#ship')?.outcome).toBe('review')
    expect(hits.map((hit) => hit.ref).sort()).toEqual(['#cpf', '#nome', '#ship'])
    // cpf, phone, mail, ship and the two placeholders: city has no name over its label, the hidden label shows nothing,
    // a submit is named by its value.
    expect(applicable).toBe(6)
  })

  it('sends a placeholder the name leaves out to review, never a failure, with no patch', () => {
    const nome = run().hits.find((hit) => hit.ref === '#nome')
    expect(nome?.outcome).toBe('review')
    expect(fieldLabelInNameRule.message(nome!, 'en')).toBe(
      'The field shows only its placeholder, "Nome*", and is named "name" (aria-label): needs review. If the placeholder is the label people see, people using speech input say it, and the field does not answer to it.',
    )
    expect(fieldLabelInNameRule.patch?.(nome!, form())).toBeUndefined()
  })
})
