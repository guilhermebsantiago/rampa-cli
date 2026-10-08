import { describe, expect, it } from 'vitest'
import { languageOfParts } from '../src/criteria/language-of-parts.ts'
import type { EngineResults } from '../src/core/types.ts'
import { passingEngine, travelSnapshot } from './helpers.ts'

describe('3.1.2 candidates', () => {
  it('takes every element with a valid lang and enough text, never the root', () => {
    const candidates = languageOfParts.candidates(travelSnapshot(), passingEngine())
    expect(candidates.map((c) => c.ref)).toEqual(['blockquote', 'p.sign'])
    expect(candidates[0]?.context).toMatchObject({ declared: 'es', inherited: 'en' })
    expect(candidates[0]?.context.text).toContain('Het weer is vandaag')
  })

  it('leaves elements the engine already failed to the engine', () => {
    const engine: EngineResults = {
      engine: { name: 'axe-core', version: 'test' },
      rules: [
        {
          ruleId: 'valid-lang',
          outcome: 'violation',
          criteria: ['3.1.2'],
          help: 'lang attribute must have a valid value',
          nodes: [{ ref: 'blockquote', target: '["blockquote"]', html: '' }],
        },
      ],
    }
    expect(languageOfParts.candidates(travelSnapshot(), engine).map((c) => c.ref)).toEqual(['p.sign'])
  })
})

describe('3.1.2 verification', () => {
  const [dutch] = languageOfParts.candidates(travelSnapshot(), passingEngine())
  if (!dutch) throw new Error('fixture has no candidate')
  const claim = {
    verdict: 'fail' as const,
    detectedLanguage: 'nl',
    evidence: 'Het weer is vandaag mooi',
    exception: 'none' as const,
    confidence: 'high' as const,
  }

  it('accepts a claim whose quote is in the text', () => {
    expect(languageOfParts.verify(claim, dutch, travelSnapshot())).toEqual({ ok: true })
  })

  it('tolerates case, spacing and curly quotes in the quote', () => {
    expect(languageOfParts.verify({ ...claim, evidence: '  het WEER is   vandaag ' }, dutch, travelSnapshot()).ok).toBe(true)
  })

  it('kills a claim whose quote is not in the text', () => {
    const result = languageOfParts.verify({ ...claim, evidence: 'Het weer is vandaag slecht' }, dutch, travelSnapshot())
    expect(result).toEqual({ ok: false, reason: 'evidence is not in the element text' })
  })

  it('kills a paraphrase or translation of the text', () => {
    expect(languageOfParts.verify({ ...claim, evidence: 'The weather is nice today' }, dutch, travelSnapshot()).ok).toBe(false)
  })

  it('kills an invalid language tag', () => {
    expect(languageOfParts.verify({ ...claim, detectedLanguage: 'dutch!!' }, dutch, travelSnapshot()).ok).toBe(false)
  })

  it('kills a fail that detects the declared language', () => {
    expect(languageOfParts.verify({ ...claim, detectedLanguage: 'es' }, dutch, travelSnapshot()).ok).toBe(false)
  })

  it('kills a fail that also claims an exception', () => {
    expect(languageOfParts.verify({ ...claim, exception: 'proper_name' }, dutch, travelSnapshot()).ok).toBe(false)
  })

  it('kills a pass that detects another language without an exception', () => {
    expect(languageOfParts.verify({ ...claim, verdict: 'pass' }, dutch, travelSnapshot()).ok).toBe(false)
  })
})

describe('3.1.2 report', () => {
  const [dutch] = languageOfParts.candidates(travelSnapshot(), passingEngine())
  if (!dutch) throw new Error('fixture has no candidate')
  const claim = { verdict: 'fail' as const, detectedLanguage: 'nl', evidence: 'Het weer', exception: 'none' as const, confidence: 'high' as const }

  it('writes the message from a template in the report language', () => {
    expect(languageOfParts.message(claim, dutch, 'en')).toBe('Marked as lang="es", but the text is in Dutch (nl).')
    expect(languageOfParts.message(claim, dutch, 'pt-BR')).toBe('Marcado como lang="es", mas o texto está em holandês (nl).')
  })

  it('proposes a patch on the start tag', () => {
    expect(languageOfParts.patch?.(claim, dutch, travelSnapshot())).toMatchObject({
      attribute: 'lang',
      from: 'es',
      to: 'nl',
      before: '<blockquote lang="es">',
      after: '<blockquote lang="nl">',
    })
  })
})
