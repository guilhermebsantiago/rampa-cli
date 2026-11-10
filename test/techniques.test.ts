import { describe, expect, it } from 'vitest'
import { CLAIM_TECHNIQUES, TECHNIQUES, techniquesFor } from '../src/core/techniques.ts'

/** The claim kinds of the eight judged criteria, as the studies name them. */
const KINDS = [
  '1.1.1 placeholder',
  '1.1.1 generic',
  '1.1.1 wrong_content',
  '1.1.1 missing_information',
  '1.1.1 short_alternative',
  '1.1.1 functional_link',
  '1.1.1 functional_button',
  '1.1.1 decorative',
  '1.1.1 hidden_image',
  '2.4.4 shared_text',
  '2.4.4 generic',
  '2.4.4 address',
  '2.4.4 mismatch',
  '2.4.6 heading',
  '2.4.6 label',
  '2.4.2 title',
  '3.1.1 page_language',
  '3.1.2 passage_language',
  '1.3.5 autocomplete',
  '3.3.2 label_not_visible',
]

const ADDRESS = /^https:\/\/www\.w3\.org\/WAI\/WCAG22\/Techniques\/(html|general|failures|aria|css)\/([A-Z]+\d+)$/

describe('the table of techniques and failures per claim kind', () => {
  it('cites only techniques it lists', () => {
    for (const ids of Object.values(CLAIM_TECHNIQUES)) {
      for (const id of ids) expect(Object.hasOwn(TECHNIQUES, id), id).toBe(true)
    }
  })

  it('has a key for each claim kind and no other', () => {
    for (const key of Object.keys(CLAIM_TECHNIQUES)) expect(KINDS, key).toContain(key)
    expect(Object.keys(CLAIM_TECHNIQUES).sort()).toEqual([...KINDS].sort())
  })

  it('cites at most two per kind, each once', () => {
    for (const [key, ids] of Object.entries(CLAIM_TECHNIQUES)) {
      expect(ids.length, key).toBeLessThanOrEqual(2)
      expect(new Set(ids).size, key).toBe(ids.length)
    }
  })

  it('lists no technique that no kind cites', () => {
    const cited = new Set(Object.values(CLAIM_TECHNIQUES).flat())
    for (const id of Object.keys(TECHNIQUES)) expect(cited.has(id), id).toBe(true)
  })

  it('gives each technique its W3C address, ending with its id, under its key', () => {
    for (const [key, technique] of Object.entries(TECHNIQUES)) {
      expect(technique.id).toBe(key)
      const match = ADDRESS.exec(technique.url)
      expect(match, technique.url).not.toBeNull()
      expect(match?.[2]).toBe(technique.id)
      expect(technique.url.endsWith(`/${technique.id}`)).toBe(true)
      expect(match?.[1] === 'failures').toBe(technique.type === 'failure')
    }
  })

  it('calls an F id a failure and every other id a technique', () => {
    for (const technique of Object.values(TECHNIQUES)) {
      expect(technique.type, technique.id).toBe(technique.id.startsWith('F') ? 'failure' : 'technique')
    }
  })

  it('has a title and a gloss for each', () => {
    for (const technique of Object.values(TECHNIQUES)) {
      expect(technique.title.trim(), technique.id).not.toBe('')
      expect(technique.gloss.trim(), technique.id).not.toBe('')
    }
  })

  it('returns the techniques of a kind, the most specific first', () => {
    expect(techniquesFor('1.1.1', 'decorative').map((technique) => technique.id)).toEqual(['F39', 'H67'])
    expect(techniquesFor('2.4.4', 'shared_text').map((technique) => technique.id)).toEqual(['H81', 'H80'])
    expect(techniquesFor('1.1.1', 'placeholder')[0]?.title).toBe(
      'Failure of Success Criterion 1.1.1 and 1.2.1 due to using text alternatives that are not alternatives (e.g., filenames or placeholder text)',
    )
  })

  it('returns none for a kind left empty or not in the table', () => {
    expect(techniquesFor('1.1.1', 'hidden_image')).toEqual([])
    expect(techniquesFor('1.1.1', 'other')).toEqual([])
    expect(techniquesFor('2.4.4', 'ambiguous')).toEqual([])
    expect(techniquesFor('9.9.9', 'title')).toEqual([])
    expect(techniquesFor('1.1.1', 'constructor')).toEqual([])
    expect(techniquesFor('', '')).toEqual([])
  })
})
