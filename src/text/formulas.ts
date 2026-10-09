import type { FormulaResult } from '../advisory/types.ts'

/**
 * Readability formulas, reported as context and never as a verdict.
 *
 * English: Flesch Reading Ease (Flesch, 1948) and the Flesch–Kincaid Grade Level (Kincaid et al., 1975,
 * fitted to the comprehension scores of US Navy enlisted personnel: https://apps.dtic.mil/sti/pdfs/ADA006655.pdf).
 *
 * Portuguese: Martins, Ghiraldelo, Nunes and Oliveira Jr. (1996), Readability Formulas Applied to
 * Textbooks in Brazilian Portuguese, Notas do ICMSC-USP nº 28 (https://repositorio.usp.br/item/000906089):
 * Flesch shifted by +42, with four bands. It was validated only as the ordering of textbook passages by
 * school grade, and its authors stress it measures "readability and not the comprehensibility". No
 * Portuguese grade level is computed: none has been validated.
 */

/** Formulas run only on this much paragraph prose: on a few words they swing wildly. */
export const MIN_FORMULA_WORDS = 100

const round1 = (value: number) => Math.round(value * 10) / 10

export function fleschKincaidEn(words: number, sentences: number, syllables: number): FormulaResult {
  const perSentence = words / Math.max(1, sentences)
  const perWord = syllables / Math.max(1, words)
  return {
    id: 'flesch-kincaid-en',
    value: round1(206.835 - 1.015 * perSentence - 84.6 * perWord),
    grade: round1(0.39 * perSentence + 11.8 * perWord - 15.59),
    inputs: { words, sentences, syllables },
    syllables: 'heuristic',
  }
}

export function fleschMartinsPt(words: number, sentences: number, syllables: number): FormulaResult {
  const perSentence = words / Math.max(1, sentences)
  const perWord = syllables / Math.max(1, words)
  const value = round1(248.835 - 1.015 * perSentence - 84.6 * perWord)
  return { id: 'flesch-pt-martins-1996', value, band: martinsBand(value), inputs: { words, sentences, syllables }, syllables: 'rules' }
}

/** Martins et al. (1996): 100–75 very easy, 75–50 easy, 50–25 fairly difficult, 25–0 very difficult. */
export function martinsBand(value: number): NonNullable<FormulaResult['band']> {
  if (value >= 75) return 'very-easy'
  if (value >= 50) return 'easy'
  if (value >= 25) return 'fairly-difficult'
  return 'very-difficult'
}

export const MARTINS_RANGES: Record<NonNullable<FormulaResult['band']>, string> = {
  'very-easy': '100–75',
  easy: '75–50',
  'fairly-difficult': '50–25',
  'very-difficult': '25–0',
}
