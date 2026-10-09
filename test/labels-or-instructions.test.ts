import { describe, expect, it } from 'vitest'
import type { EngineResults } from '../src/core/types.ts'
import { type LabelsOrInstructionsJudgment, exampleOf, labelsOrInstructions } from '../src/criteria/labels-or-instructions.ts'
import type { A11yNode, A11ySnapshot } from '../src/snapshot/schema.ts'
import { node } from './helpers.ts'

const box = { x: 0, y: 0, width: 200, height: 32 }

function input(ref: string, name: string | undefined, attributes: Record<string, string>, extra: Partial<A11yNode> = {}): A11yNode {
  const tag = typeof extra.native?.tag === 'string' ? extra.native.tag : 'input'
  const attrs = Object.entries(attributes)
    .map(([key, value]) => ` ${key}="${value}"`)
    .join('')
  return node({ ref, role: 'textbox', name, bounds: box, ...extra, native: { tag, attributes, html: `<${tag}${attrs}>` } })
}

const text = (ref: string, value: string, extra: Partial<A11yNode> = {}) => node({ ref, text: value, bounds: box, native: { tag: 'span' }, ...extra })

/** A store page: an icon search, a newsletter with a hidden name, a delivery form with patterns. */
function store(): A11ySnapshot {
  return {
    schemaVersion: 1,
    surface: 'web',
    target: 'test://store',
    locale: 'pt-BR',
    viewport: { width: 1280, height: 800, scale: 1 },
    collectedAt: '2026-10-08T00:00:00.000Z',
    collector: { name: 'test', version: '0' },
    root: node({
      ref: 'html',
      role: 'document',
      lang: 'pt-BR',
      children: [
        node({
          ref: 'header form',
          role: 'form',
          native: { tag: 'form' },
          bounds: box,
          children: [
            input('#q', 'Buscar na loja', { id: 'q', type: 'search', 'aria-label': 'Buscar na loja' }),
            node({ ref: 'header button', role: 'button', name: 'Buscar', bounds: box, native: { tag: 'button' } }),
          ],
        }),
        node({ ref: 'h2.news', role: 'heading', name: 'Receba ofertas', bounds: box, native: { tag: 'h2' } }),
        node({
          ref: 'div.news',
          native: { tag: 'div' },
          bounds: box,
          children: [input('#news', 'E-mail', { id: 'news', type: 'email', 'aria-label': 'E-mail' })],
        }),
        // A label on screen that is not tied to the field still labels it for whoever looks.
        node({
          ref: 'div.coupon',
          native: { tag: 'div' },
          bounds: box,
          children: [text('div.coupon > span', 'Cupom de desconto'), input('#coupon', 'Cupom de desconto', { id: 'coupon', 'aria-label': 'Cupom de desconto' })],
        }),
        node({
          ref: 'form.delivery',
          role: 'form',
          native: { tag: 'form' },
          bounds: box,
          children: [
            node({ ref: 'label.city', bounds: { x: 0, y: 0, width: 1, height: 1 }, native: { tag: 'label', attributes: { for: 'city' } }, children: [text('label.city > span', 'Cidade', { bounds: { x: 0, y: 0, width: 1, height: 1 } })] }),
            input('#city', 'Cidade', { id: 'city' }),
            input('#phone', 'Telefone', { id: 'phone', type: 'tel', title: 'Telefone' }),
            input('#name', undefined, { id: 'name', placeholder: 'Seu nome' }),
            node({ ref: 'label.cep', bounds: box, native: { tag: 'label', attributes: { for: 'cep' } }, children: [text('label.cep > span', 'CEP')] }),
            input('#cep', 'CEP', { id: 'cep', pattern: '[0-9]{5}-[0-9]{3}', placeholder: '00000-000' }),
            node({ ref: 'label.cpf', bounds: box, native: { tag: 'label', attributes: { for: 'cpf' } }, children: [text('label.cpf > span', 'CPF')] }),
            input('#cpf', 'CPF', { id: 'cpf', pattern: '\\d{11}' }),
            node({ ref: 'label.street', bounds: box, native: { tag: 'label', attributes: { for: 'street' } }, children: [text('label.street > span', 'Rua')] }),
            input('#street', 'Rua', { id: 'street' }),
            input('#old', 'Endereço antigo', { id: 'old', 'aria-label': 'Endereço antigo' }, { states: ['disabled'] }),
            input('#broken', 'Bairro', { id: 'broken', 'aria-label': 'Bairro' }),
            // Options filled in by script later: for now the select shows nothing.
            input('#state', 'Estado', { id: 'state', 'aria-label': 'Estado' }, { role: 'combobox', native: { tag: 'select' } }),
            input('#sort', 'Ordenar por', { id: 'sort', 'aria-label': 'Ordenar por' }, {
              role: 'combobox',
              native: { tag: 'select' },
              children: [
                node({ ref: '#sort > option:nth-of-type(1)', name: 'Relevância', native: { tag: 'option' } }),
                node({ ref: '#sort > option:nth-of-type(2)', name: 'Menor preço', states: ['selected'], native: { tag: 'option' } }),
              ],
            }),
          ],
        }),
      ],
    }),
  }
}

const engine: EngineResults = {
  engine: { name: 'axe-core', version: 'test' },
  rules: [{ ruleId: 'label', outcome: 'violation', criteria: ['4.1.2'], help: '', nodes: [{ ref: '#broken', target: '#broken', html: '' }] }],
}

function candidate(ref: string) {
  const found = labelsOrInstructions.candidates(store(), engine).find((c) => c.ref === ref)
  if (!found) throw new Error(`no candidate ${ref}`)
  return found
}

const hiddenFail: LabelsOrInstructionsJudgment = {
  shown: '',
  rule: '',
  verdict: 'fail',
  problem: 'no_visible_label',
  evidence: 'E-mail',
  confidence: 'high',
}

const ruleFail: LabelsOrInstructionsJudgment = {
  shown: 'CPF',
  rule: 'Somente os 11 números do CPF, sem pontos nem traço',
  verdict: 'fail',
  problem: 'rule_not_explained',
  evidence: 'CPF',
  confidence: 'high',
}

describe('3.3.2 candidates', () => {
  it('judges fields whose name nobody sees, and fields that enforce a pattern', () => {
    const refs = labelsOrInstructions.candidates(store(), engine).map((c) => c.ref)
    // A placeholder or a visible label is on screen; disabled fields and the engine's own findings stay out.
    // A select showing an option has visible text in it, as a field with a placeholder does.
    expect(refs).toEqual(['#q', '#news', '#coupon', '#city', '#phone', '#cep', '#cpf', '#state'])
  })

  it('records where a hidden name comes from', () => {
    expect(candidate('#q').context.hiddenSource).toBe('aria-label')
    expect(candidate('#city').context.hiddenSource).toBe('hidden-label')
    expect(candidate('#phone').context.hiddenSource).toBe('title')
    expect(candidate('#cep').context).toMatchObject({ hiddenSource: undefined, visibleLabel: 'CEP', pattern: '[0-9]{5}-[0-9]{3}' })
  })

  it('gives the model what is visible around the field', () => {
    const search = candidate('#q').context.facts
    expect(search).toContain('Its name comes from: aria-label, which only screen readers get')
    expect(search).toContain('Next to it: a button named "Buscar" that shows an icon and no text')
    expect(candidate('#news').context.facts).toContain('Under the visible heading: Receba ofertas')
    expect(candidate('#cpf').context.facts).toContain('Its visible label: "CPF"')
    expect(candidate('#cpf').context.facts).toContain('Pattern it enforces: pattern="\\d{11}"')
    const prompt = labelsOrInstructions.prompt(candidate('#news'), store())
    expect(prompt.user).toContain('Write rule in: Brazilian Portuguese (pt-BR)')
    expect(prompt.user).toContain('<name>E-mail</name>')
  })
})

describe('3.3.2 verification', () => {
  it('keeps a field with nothing on screen to name it', () => {
    expect(labelsOrInstructions.verify(hiddenFail, candidate('#news'), store())).toEqual({ ok: true })
  })

  it('drops a missing-label claim on a field the snapshot shows a label for', () => {
    expect(labelsOrInstructions.verify({ ...hiddenFail, evidence: 'CPF' }, candidate('#cpf'), store())).toEqual({ ok: false, reason: 'the field has a visible label: "CPF"' })
  })

  it('drops a missing-label claim when the name is on screen beside the field, or the model quotes it', () => {
    const coupon = { ...hiddenFail, evidence: 'Cupom de desconto' }
    expect(labelsOrInstructions.verify(coupon, candidate('#coupon'), store())).toEqual({ ok: false, reason: "the field's name is shown on screen right beside it" })
    expect(labelsOrInstructions.verify({ ...hiddenFail, shown: 'Seu e-mail' }, candidate('#news'), store())).toEqual({
      ok: false,
      reason: 'fail verdict while quoting visible text that names the field',
    })
    // A section heading names no field: quoting it does not undo the claim.
    expect(labelsOrInstructions.verify({ ...hiddenFail, shown: 'Receba ofertas' }, candidate('#news'), store())).toEqual({ ok: true })
  })

  it('tells the model when a select shows nothing yet', () => {
    expect(candidate('#state').context.facts).toContain('It shows the chosen option: none')
  })

  it('keeps an unexplained pattern and drops one the page shows an example of', () => {
    expect(labelsOrInstructions.verify(ruleFail, candidate('#cpf'), store())).toEqual({ ok: true })
    expect(labelsOrInstructions.verify({ ...ruleFail, rule: '' }, candidate('#cpf'), store()).ok).toBe(false)
    const cep = { ...ruleFail, evidence: 'CEP' }
    expect(labelsOrInstructions.verify(cep, candidate('#cep'), store())).toEqual({ ok: false, reason: 'the page shows an example in the required format: "00000-000"' })
    expect(labelsOrInstructions.verify({ ...ruleFail, evidence: 'E-mail' }, candidate('#news'), store())).toEqual({ ok: false, reason: 'the field enforces no pattern' })
  })

  it('needs the field name quoted, and a pass without a problem', () => {
    expect(labelsOrInstructions.verify({ ...hiddenFail, evidence: 'Newsletter' }, candidate('#news'), store()).ok).toBe(false)
    expect(labelsOrInstructions.verify({ ...hiddenFail, verdict: 'pass' }, candidate('#news'), store()).ok).toBe(false)
    expect(labelsOrInstructions.verify({ ...hiddenFail, verdict: 'pass', problem: 'none', shown: 'Receba ofertas' }, candidate('#news'), store()).ok).toBe(true)
  })
})

describe('3.3.2 messages and patches', () => {
  it('says why nothing on screen names the field, in both locales', () => {
    expect(labelsOrInstructions.message(hiddenFail, candidate('#news'), 'en')).toBe(
      'Nothing on screen tells what to enter in the field "E-mail": its name is in aria-label, which only screen readers get.',
    )
    expect(labelsOrInstructions.message({ ...hiddenFail, evidence: 'Telefone' }, candidate('#phone'), 'pt-BR')).toBe(
      'Nada na tela diz o que preencher no campo "Telefone": o nome está no atributo title, que só aparece como dica ao passar o mouse.',
    )
    expect(labelsOrInstructions.message(ruleFail, candidate('#cpf'), 'en')).toBe(
      'The field "CPF" only accepts a set format (pattern="\\d{11}"), and nothing on screen explains it.',
    )
  })

  it('adds a visible label, or a visible hint tied with aria-describedby', () => {
    expect(labelsOrInstructions.patch?.(hiddenFail, candidate('#news'), store())).toMatchObject({
      kind: 'replace-element',
      before: '<input id="news" type="email" aria-label="E-mail">',
      after: '<label for="news">E-mail</label> <input id="news" type="email" aria-label="E-mail">',
    })
    expect(labelsOrInstructions.patch?.(ruleFail, candidate('#cpf'), store())?.after).toBe(
      '<input id="cpf" pattern="\\d{11}" aria-describedby="cpf-hint"> <span id="cpf-hint">Somente os 11 números do CPF, sem pontos nem traço</span>',
    )
    // A select's start tag is not the whole element, so it gets no patch to apply blindly.
    expect(labelsOrInstructions.patch?.({ ...hiddenFail, evidence: 'Estado' }, candidate('#state'), store())).toBeUndefined()
  })
})

describe('pattern examples', () => {
  it('finds a word on screen that the pattern accepts, as the browser matches it', () => {
    expect(exampleOf('[0-9]{5}-[0-9]{3}', ['ex.: 01310-100'])).toBe('01310-100')
    expect(exampleOf('[0-9]{5}-[0-9]{3}', ['Formato: (01310-100).'])).toBe('01310-100')
    expect(exampleOf('\\d{11}', ['Somente números'])).toBeUndefined()
    // The whole value must match, as with the pattern attribute.
    expect(exampleOf('\\d{3}', ['12345'])).toBeUndefined()
    expect(exampleOf('[', ['['])).toBeUndefined()
  })
})
