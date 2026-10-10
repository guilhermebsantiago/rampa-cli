import { WORDS_EN } from './en.ts'
import { WORDS_ES } from './es.ts'
import { WORDS_PT } from './pt.ts'

/**
 * Word lists for the letter-spaced words rule (1.3.2, F32): which letters, joined, make a word in a
 * language. Each list holds the 20,000 most frequent forms of 4 to 15 letters in Tatoeba's sentences
 * (CC BY 2.0 FR), mostly written in lower case, so names and acronyms (NASA, ASAP) are left out, plus a
 * few words pages often letter-space. scripts/word-lists.py builds them; docs/rules.md gives the details.
 */

export const WORD_LANGUAGES = ['en', 'pt', 'es'] as const
export type WordLanguage = (typeof WORD_LANGUAGES)[number]

const SOURCES: Record<WordLanguage, string> = { en: WORDS_EN, pt: WORDS_PT, es: WORDS_ES }

/**
 * Words of one to three letters that may sit between the longer words of a phrase written letter by letter
 * ("W E L C O M E T O O U R S I T E", "B E M V I N D O S"): the collector keeps one space between letters and
 * between words alike, so a phrase arrives as one run. Written for Rampa.
 */
const SHORT: Record<WordLanguage, string> = {
  en: 'a i an as at be by do go he if in is it me my no of on or so to up us we all and are but buy can day for get has her his hot how its new not now off one our out see she the too top two use was way who why win you',
  pt: 'a e o à é ao as às da de do em eu há já me na no os ou se só te tu um aí até bem com das dia dos ela ele era foi lá mas meu mil nas nos não nós por que são sem seu sim sua uma vai vem ver',
  es: 'a e o u y al de el en es la le lo mi no se si su te tu un ya con del día hoy las los mar más muy por que sin sus una ver voy',
}

const cache = new Map<WordLanguage, { long: Set<string>; short: Set<string> }>()

function lists(language: WordLanguage): { long: Set<string>; short: Set<string> } {
  let found = cache.get(language)
  if (!found) {
    found = { long: new Set(SOURCES[language].split('\n')), short: new Set(SHORT[language].split(' ')) }
    cache.set(language, found)
  }
  return found
}

/** The word list for a language tag (pt-BR reads the Portuguese list), or undefined for a language Rampa has none for. */
export function wordLanguageOf(tag: string | undefined): WordLanguage | undefined {
  const primary = (tag ?? '').trim().toLowerCase().split(/[-_]/)[0] ?? ''
  return (WORD_LANGUAGES as readonly string[]).includes(primary) ? (primary as WordLanguage) : undefined
}

/** Whether a lower-case form of four letters or more is in the language's list. */
export function isListedWord(word: string, language: WordLanguage): boolean {
  return lists(language).long.has(word.normalize('NFC').toLowerCase())
}

/**
 * Splits letters into words of the language: one listed word of four letters or more ("welcome"), or a phrase of
 * them with short words between ("welcome", "to", "our", "site"). Undefined when the letters do not split that way,
 * as an index (A B C D) or an acronym (N A S A) does not. At least one word must be a listed word of four letters
 * or more, and short words may not stand next to each other more than twice, so a run of single-letter words
 * ("a e o a") is never read as a phrase.
 */
export function splitIntoWords(letters: string, language: WordLanguage): string[] | undefined {
  const text = letters.normalize('NFC').toLowerCase()
  if (text.length < 4 || text.length > 80) return undefined
  const { long, short } = lists(language)
  type Split = { words: string[]; longCount: number }
  // best[i][k]: the split of text[0, i) with the fewest words that ends with k short words in a row (k = 0, 1, 2).
  const best: Array<Array<Split | undefined>> = Array.from({ length: text.length + 1 }, () => [undefined, undefined, undefined])
  ;(best[0] as Array<Split | undefined>)[0] = { words: [], longCount: 0 }
  const better = (a: Split, b: Split | undefined) => !b || a.words.length < b.words.length || (a.words.length === b.words.length && a.longCount > b.longCount)
  for (let end = 1; end <= text.length; end++) {
    for (let start = Math.max(0, end - 15); start < end; start++) {
      const piece = text.slice(start, end)
      const isLong = piece.length >= 4 && long.has(piece)
      const isShort = piece.length <= 3 && short.has(piece)
      if (!isLong && !isShort) continue
      for (let run = 0; run < 3; run++) {
        const before = best[start]?.[run]
        if (!before) continue
        const next = isShort ? run + 1 : 0
        if (next > 2) continue
        const candidate = { words: [...before.words, piece], longCount: before.longCount + (isLong ? 1 : 0) }
        // Fewer words first (welcome, not wel·come), then more of them long.
        const slot = best[end] as Array<Split | undefined>
        if (better(candidate, slot[next])) slot[next] = candidate
      }
    }
  }
  const ends = (best[text.length] ?? []).filter((split): split is Split => split !== undefined && split.longCount > 0)
  ends.sort((a, b) => a.words.length - b.words.length || b.longCount - a.longCount)
  return ends[0]?.words
}
