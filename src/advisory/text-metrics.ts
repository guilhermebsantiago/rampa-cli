import { shown } from '../criteria/labels-or-instructions.ts'
import { MIN_FORMULA_WORDS, fleschKincaidEn, fleschMartinsPt } from '../text/formulas.ts'
import { ABBREVIATIONS_VERSION, icuVersion, sentences, words } from '../text/segment.ts'
import { SYLLABLES_EN_VERSION, SYLLABLES_PT_VERSION, syllablesEn, syllablesPt } from '../text/syllables.ts'
import { type Page, ancestorsOf, blockText, languageOf, tagOf } from './page.ts'
import type { SentenceQuote, TextMeasurement, TextMetrics } from './types.ts'

/**
 * Text measurements: facts shown as context, never a verdict (docs/plans/cognitive-profile.md §3).
 * Only paragraph prose is measured, inside main or article when the page has them: microcopy, lists,
 * tables and forms would make every number meaningless. Each language with at least 5% of the words
 * gets its own measurement, as Understanding 3.1.5 asks. Words are the segmenter's words that hold a
 * letter; numbers are left out of the counts and the formulas alike.
 */

const OUTSIDE_PROSE = new Set(['nav', 'header', 'footer', 'aside', 'form'])
const CONJUNCTIONS = new Set(['and', 'but', 'or', 'nor', 'so', 'yet', 'because', 'although', 'though', 'unless', 'whereas'])
/** Three or more items joined by commas, the last by and/or/e/ou: COGA o3p05 asks for a list. */
const LIST_AS_PROSE = /(?:[^,;:.!?]{1,60},\s+){2,}[^,;:.!?]{1,60}?\s(?:and|or|e|ou)\s[^,;:.!?]{1,60}/iu
const QUOTE_LENGTH = 160

interface Block {
  ref: string
  language: string
  text: string
  words: string[]
}

export function measureText(page: Page): TextMetrics {
  const containers = page.ordered.filter((node) => (tagOf(node) === 'main' || tagOf(node) === 'article' || node.role === 'main') && shown(node))
  const scope: TextMeasurement['scope'] = containers.length > 0 ? 'main' : 'page'
  const inScope = new Set(containers)
  const blocks: Block[] = []
  for (const node of page.ordered) {
    if (tagOf(node) !== 'p' || !shown(node)) continue
    const ancestors = ancestorsOf(page, node)
    if (scope === 'main' ? !ancestors.some((ancestor) => inScope.has(ancestor)) : ancestors.some((ancestor) => OUTSIDE_PROSE.has(tagOf(ancestor)))) continue
    const text = (blockText(node)?.text ?? node.text ?? '').trim()
    const language = languageOf(page, node)
    const counted = wordsOf(text, language)
    if (counted.length === 0) continue
    blocks.push({ ref: node.ref, language, text, words: counted })
  }

  const byLanguage = new Map<string, Block[]>()
  for (const block of blocks) {
    const primary = block.language.split('-')[0]?.toLowerCase() || 'und'
    byLanguage.set(primary, [...(byLanguage.get(primary) ?? []), block])
  }
  const total = blocks.reduce((sum, block) => sum + block.words.length, 0)
  const measurements: TextMeasurement[] = []
  for (const [language, group] of byLanguage) {
    const count = group.reduce((sum, block) => sum + block.words.length, 0)
    if (count < total * 0.05) continue
    measurements.push(measure(language, scope, group))
  }
  measurements.sort((a, b) => b.words - a.words)

  return {
    measurements,
    blocks: blocks.map((block) => ({ ref: block.ref, language: block.language, words: block.words.length, sentences: sentences(block.text, block.language).length })),
    versions: { icu: icuVersion(), abbreviations: ABBREVIATIONS_VERSION, syllablesPt: SYLLABLES_PT_VERSION, syllablesEn: SYLLABLES_EN_VERSION },
  }
}

function measure(language: string, scope: TextMeasurement['scope'], blocks: Block[]): TextMeasurement {
  const all: SentenceQuote[] = []
  const listsAsProse: SentenceQuote[] = []
  let manyConjunctions = 0
  for (const block of blocks) {
    for (const sentence of sentences(block.text, block.language)) {
      const counted = wordsOf(sentence, block.language)
      if (counted.length === 0) continue
      const quote = { ref: block.ref, words: counted.length, text: cut(sentence) }
      all.push(quote)
      if (LIST_AS_PROSE.test(sentence)) listsAsProse.push(quote)
      if (counted.filter((word) => CONJUNCTIONS.has(word.toLowerCase())).length > 2) manyConjunctions++
    }
  }
  const lengths = all.map((sentence) => sentence.words).sort((a, b) => a - b)
  const wordCount = blocks.reduce((sum, block) => sum + block.words.length, 0)
  const measurement: TextMeasurement = {
    language,
    scope,
    paragraphs: blocks.length,
    words: wordCount,
    sentences: all.length,
    sentenceWords: { median: percentile(lengths, 0.5), p90: percentile(lengths, 0.9), max: lengths.at(-1) ?? 0 },
    longestSentences: [...all].sort((a, b) => b.words - a.words).slice(0, 3),
    listsAsProse,
  }
  if (language === 'en') {
    measurement.english = {
      paragraphsOver50Words: blocks.filter((block) => block.words.length > 50).length,
      sentencesOver25Words: all.filter((sentence) => sentence.words > 25).length,
      sentencesWithManyConjunctions: manyConjunctions,
    }
  }
  if (language !== 'pt' && language !== 'en') measurement.formulaSkipped = 'no-formula-for-language'
  else if (wordCount < MIN_FORMULA_WORDS) measurement.formulaSkipped = 'under-100-words'
  else {
    const syllables = blocks.flatMap((block) => block.words).reduce((sum, word) => sum + (language === 'pt' ? syllablesPt(word) : syllablesEn(word)), 0)
    measurement.formula = language === 'pt' ? fleschMartinsPt(wordCount, all.length, syllables) : fleschKincaidEn(wordCount, all.length, syllables)
  }
  return measurement
}

/** The words that hold a letter: "1.000" and "25/12" are not words to a readability formula. */
function wordsOf(text: string, language: string): string[] {
  return words(text, language).filter((word) => /\p{L}/u.test(word))
}

/** Nearest-rank percentile of sorted values. */
function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))] ?? 0
}

function cut(text: string): string {
  return text.length > QUOTE_LENGTH ? `${text.slice(0, QUOTE_LENGTH - 1)}…` : text
}
