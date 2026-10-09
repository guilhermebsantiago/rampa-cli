import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Hunspell } from '../src/advisory/abbreviations/hunspell.ts'
import { bestLongForm, definitionsIn, initialsMatch } from '../src/advisory/abbreviations/long-form.ts'
import { proposeExpansions } from '../src/advisory/abbreviations/propose.ts'
import { costIn } from '../src/advisory/checks/preselected-cost.ts'
import { compilePattern, examplesIn, purposeOf, regionOf } from '../src/advisory/formats.ts'
import { readPage } from '../src/advisory/page.ts'
import { measureText } from '../src/advisory/text-metrics.ts'
import { memoryCache } from '../src/core/cache.ts'
import type { ModelProvider } from '../src/providers/types.ts'
import type { A11ySnapshot } from '../src/snapshot/schema.ts'
import { fleschKincaidEn, fleschMartinsPt, martinsBand } from '../src/text/formulas.ts'
import { icuVersion, sentences, words } from '../src/text/segment.ts'
import { syllablesPt } from '../src/text/syllables.ts'
import { node } from './helpers.ts'

describe('coga/input-formats rules', () => {
  const table = JSON.parse(readFileSync('test/fixtures/coga/pattern-table.json', 'utf8')) as {
    rows: Array<{ pattern: string; mismatch: Record<string, boolean> }>
  }

  it('compiles patterns as Chromium does: anchored, with the v flag, and invalid ones ignored', () => {
    expect(table.rows.length).toBeGreaterThanOrEqual(30)
    for (const row of table.rows) {
      const compiled = compilePattern(row.pattern)
      for (const [value, mismatch] of Object.entries(row.mismatch)) {
        const refused = compiled.ok ? !compiled.regex.test(value) : false
        expect({ pattern: row.pattern, value, refused }).toEqual({ pattern: row.pattern, value, refused: mismatch })
      }
    }
  })

  it('reads the purpose from the token, then the words, then the type', () => {
    expect(purposeOf({ autocomplete: 'postal-code', type: 'text', words: ['Endereço'], language: 'pt-BR' })).toMatchObject({ purpose: 'postal', from: 'autocomplete' })
    expect(purposeOf({ type: 'tel', words: ['txtCpf', 'CPF'], language: 'pt-BR' })).toMatchObject({ purpose: 'cpf', from: 'keywords' })
    expect(purposeOf({ type: 'tel', words: ['contato'], language: 'pt-BR' })).toMatchObject({ purpose: 'phone', from: 'type' })
    expect(purposeOf({ type: 'text', words: ['CPF ou CNPJ'], language: 'pt-BR' })).toBeUndefined()
    expect(purposeOf({ type: 'text', words: ['Cartão SUS', 'numero do cartao'], language: 'pt-BR' })).toBeUndefined()
    expect(purposeOf({ type: 'text', words: ['Caixa postal'], language: 'pt-BR' })).toBeUndefined()
    expect(purposeOf({ type: 'text', words: ['Data de nascimento'], language: 'pt-BR' })).toMatchObject({ purpose: 'date' })
    expect(purposeOf({ type: 'text', words: ['Your data'], language: 'en' })).toBeUndefined()
  })

  it('takes examples that look like values, never format descriptions', () => {
    expect(examplesIn(['Ex.: 123.456.789-09 (somente números)'], undefined, 'cpf')).toEqual(['123.456.789-09'])
    expect(examplesIn([], '(11) 91234-5678', 'phone')).toEqual(['(11) 91234-5678'])
    expect(examplesIn(['Exemplo: (11) 91234-5678.'], undefined, 'phone')).toEqual(['(11) 91234-5678'])
    expect(examplesIn([], 'dd/mm/aaaa', 'date')).toEqual([])
    expect(examplesIn(['for example SW1A 1AA'], undefined, 'postal')).toEqual(['SW1A 1AA'])
  })

  it('knows the region from the language, else from the address', () => {
    expect(regionOf('pt-BR', 'file:///x.html')).toBe('BR')
    expect(regionOf('en', 'https://www.gov.uk/apply')).toBe('GB')
    expect(regionOf('en', 'https://example.com')).toBeUndefined()
    expect(regionOf('pt', 'https://www.gov.pt')).toBeUndefined()
    expect(regionOf('pt', 'https://www.gov.br/inss')).toBe('BR')
  })
})

describe('coga/preselected-cost rules', () => {
  it('finds a non-zero price or a commitment that costs later, and nothing in consent text', () => {
    expect(costIn('Seguro viagem + R$ 39,90')).toEqual({ kind: 'amount', match: 'R$ 39,90' })
    expect(costIn('Purchase protection, $4.99')).toEqual({ kind: 'amount', match: '$4.99' })
    expect(costIn('Embalagem para presente (R$ 0,00)')).toBeUndefined()
    expect(costIn('Start my 30-day free trial')).toMatchObject({ kind: 'recurring' })
    expect(costIn('Renovação automática do plano')).toMatchObject({ kind: 'recurring' })
    expect(costIn('Quero receber novidades por e-mail (2 por mês)')).toBeUndefined()
    expect(costIn('Subscribe to our newsletter')).toBeUndefined()
  })
})

describe('coga/abbreviations rules', () => {
  it('finds the full term next to an abbreviation (Schwartz and Hearst, 2003), accents ignored', () => {
    expect(bestLongForm('NIS', 'O Número de Identificação Social')).toBe('Número de Identificação Social')
    expect(bestLongForm('CadÚnico', 'Cadastro Único')).toBe('Cadastro Único')
    expect(bestLongForm('ARFID', 'Avoidant/Restrictive Food Intake Disorder')).toBe('Avoidant/Restrictive Food Intake Disorder')
    expect(bestLongForm('CNPJ', 'Cadastro de Pessoas Físicas')).toBeUndefined()
    expect(definitionsIn('NIS', 'Informe o Número de Identificação Social (NIS) agora.').map((d) => d.expansion)).toEqual(['Número de Identificação Social'])
    expect(definitionsIn('NIS', 'O NIS (Número de Identificação Social) tem 11 dígitos.').map((d) => d.expansion)).toEqual(['Número de Identificação Social'])
    expect(definitionsIn('NIS', 'NIS – Número de Identificação Social: informe.').map((d) => d.expansion)).toEqual(['Número de Identificação Social'])
    expect(definitionsIn('NIS', 'Informe o NIS (obrigatório).')).toEqual([])
  })

  it('keeps an expansion only when the initials of its words spell the token', () => {
    expect(initialsMatch('INSS', 'Instituto Nacional do Seguro Social')).toBe(true)
    expect(initialsMatch('CPF', 'Cadastro de Pessoas Físicas')).toBe(true)
    expect(initialsMatch('CNPJs', 'Cadastro Nacional da Pessoa Jurídica')).toBe(true)
    expect(initialsMatch('NIS', 'Número de Inscrição')).toBe(false)
    expect(initialsMatch('NIS', 'Nis')).toBe(false)
  })

  it('reads Hunspell dictionaries: affixes make words, entries in capitals stay acronyms', () => {
    const aff = 'SET UTF-8\nFLAG UTF-8\nFORBIDDENWORD !\nSFX S Y 2\nSFX S 0 s [aeiou]\nSFX S ão ões ão\nPFX R Y 1\nPFX R 0 re .\n'
    const dic = '6\nserviço/S\ninformação/S\nfazer/R\nNASA\nBrasil\nerrado/!\n'
    const dictionary = new Hunspell(aff, dic)
    expect(dictionary.isWord('SERVIÇOS')).toBe(true)
    expect(dictionary.isWord('INFORMAÇÕES')).toBe(true)
    expect(dictionary.isWord('REFAZER')).toBe(true)
    expect(dictionary.isWord('BRASIL')).toBe(true)
    expect(dictionary.isWord('NASA')).toBe(false)
    expect(dictionary.isWord('ERRADO')).toBe(false)
    expect(dictionary.isWord('CPF')).toBe(false)
    const long = new Hunspell('FLAG long\nSFX Aa Y 1\nSFX Aa 0 s .\n', '1\ncasa/Aa\n')
    expect(long.isWord('CASAS')).toBe(true)
    const numbered = new Hunspell('FLAG num\nSFX 101 Y 1\nSFX 101 0 s .\n', '1\nbolo/7,101\n')
    expect(numbered.isWord('BOLOS')).toBe(true)
  })

  it('asks a model only for a proposal, and keeps it only when its initials match', async () => {
    const answers: Record<string, string> = { FNDE: 'Fundo Nacional de Desenvolvimento da Educação', SEI: 'Sistema de Atendimento Rápido' }
    let calls = 0
    const provider: ModelProvider = {
      id: 'test:scripted',
      async judge<T>(request: { user: string; schema: { parse(value: unknown): T } }) {
        calls++
        const token = /<abbreviation>(.*)<\/abbreviation>/.exec(request.user)?.[1] ?? ''
        return { output: request.schema.parse({ expansion: answers[token] ?? '' }), inputTokens: 10, outputTokens: 5, latencyMs: 1, modelId: 'scripted' }
      },
    }
    const cache = memoryCache()
    const options = { provider, cache, offline: false, runs: 1, concurrency: 2, title: 'Cursos', version: 'test' }
    const requests = [
      { token: 'FNDE', sentence: 'O FNDE repassa os recursos.', language: 'pt-BR' },
      { token: 'SEI', sentence: 'Abra o processo no SEI.', language: 'pt-BR' },
    ]
    const first = await proposeExpansions(requests, options)
    expect(first.proposals.get('FNDE')?.expansion).toBe('Fundo Nacional de Desenvolvimento da Educação')
    expect(first.proposals.has('SEI')).toBe(false)
    expect(first).toMatchObject({ asked: 2, answered: 2 })
    const again = await proposeExpansions(requests, { ...options, offline: true })
    expect(again.usage.cachedCalls).toBe(2)
    expect(calls).toBe(2)
  })
})

describe('text measurements', () => {
  it('splits sentences without breaking after abbreviations, on this ICU', () => {
    expect(icuVersion()).toMatch(/^\d+/)
    expect(sentences('O Sr. Silva mora na Av. Paulista, nº 1.000. Ele trabalha no art. 5º da lei.', 'pt-BR')).toHaveLength(2)
    expect(sentences('See e.g. Fig. 3 for details. The U.S. Navy paid $1.50 at 3 p.m. today. Mr. Smith agreed.', 'en')).toHaveLength(3)
    expect(sentences('Leve RG, CPF etc. e volte amanhã. Pronto!', 'pt-BR')).toHaveLength(2)
    expect(words('O Sr. Silva mora na Av. Paulista, nº 1.000.', 'pt-BR')).toHaveLength(9)
  })

  it('counts Portuguese syllables as the hand-counted list does, in at least 95% of the words', () => {
    const list = JSON.parse(readFileSync('test/fixtures/coga/syllables-pt.json', 'utf8')) as { words: Record<string, number> }
    const entries = Object.entries(list.words)
    expect(entries.length).toBeGreaterThanOrEqual(190)
    const wrong = entries.filter(([word, count]) => syllablesPt(word) !== count)
    expect(wrong.length / entries.length).toBeLessThanOrEqual(0.05)
  })

  it('computes the formulas and the Martins bands', () => {
    expect(fleschKincaidEn(100, 5, 150)).toMatchObject({ value: 59.6, grade: 9.9, syllables: 'heuristic' })
    expect(fleschMartinsPt(100, 5, 150)).toMatchObject({ value: 101.6, band: 'very-easy', syllables: 'rules' })
    expect([martinsBand(80), martinsBand(60), martinsBand(30), martinsBand(-5)]).toEqual(['very-easy', 'easy', 'fairly-difficult', 'very-difficult'])
  })

  it('measures paragraph prose in main only, with exact counts and no verdict', () => {
    const text = (ref: string, value: string, lang?: string) => node({ ref, role: 'paragraph', text: value, lang, native: { tag: 'p' } })
    const snapshot: A11ySnapshot = {
      schemaVersion: 1,
      surface: 'web',
      target: 'test://measure',
      locale: 'pt-BR',
      viewport: { width: 1280, height: 800, scale: 1 },
      collectedAt: '2026-10-09T00:00:00.000Z',
      collector: { name: 'test', version: '0' },
      root: node({
        ref: 'html',
        lang: 'pt-BR',
        native: { tag: 'html' },
        children: [
          node({ ref: 'nav', native: { tag: 'nav' }, children: [text('nav p', 'Início Serviços Contato')] }),
          node({
            ref: 'main',
            role: 'main',
            native: { tag: 'main' },
            children: [
              text('main p:nth-of-type(1)', 'Leve o RG, o CPF, o comprovante de residência e a carteira de trabalho. Chegue cedo.'),
              text('main p:nth-of-type(2)', 'O atendimento é de segunda a sexta.'),
              text('main p:nth-of-type(3)', 'Bring your ID card.', 'en'),
            ],
          }),
        ],
      }),
    }
    const metrics = measureText(readPage(snapshot))
    const pt = metrics.measurements.find((measurement) => measurement.language === 'pt')
    expect(pt).toMatchObject({ scope: 'main', paragraphs: 2, words: 23, sentences: 3, formulaSkipped: 'under-100-words' })
    expect(pt?.sentenceWords).toEqual({ median: 7, p90: 14, max: 14 })
    expect(pt?.listsAsProse).toHaveLength(1)
    // English is 4 of 27 words, over 5%: it gets its own measurement.
    expect(metrics.measurements.find((measurement) => measurement.language === 'en')).toMatchObject({ words: 4, english: { paragraphsOver50Words: 0 } })
    expect(metrics.blocks.map((block) => block.ref)).not.toContain('nav p')
    expect(metrics.versions.icu).toBe(icuVersion())
  })
})
