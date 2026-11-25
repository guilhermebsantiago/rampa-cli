import { isListedWord, listedWords } from '../../rules/words/index.ts'
import type { WordList } from './hunspell.ts'

/**
 * Whether a token written in capitals reads as a word or a name rather than as an abbreviation, from the Hunspell
 * dictionary and the word lists the letter-spaced words rule ships (Tatoeba, src/rules/words/), which need no download.
 *
 * - The shape of a word: every run of consonants at its start, in its middle and at its end occurs in at least
 *   MIN_WORDS listed words of the language. TAVORENO, ARAUJO and BEZERRA have that shape; INSS (nss at the end), CNIS (cn at
 *   the start), IBGE (bg in the middle) and CPF, CTPS, FGTS (no vowel) do not. Syllable acronyms (ENEM, ANVISA) have it
 *   too, so the shape alone never makes a word: it only lets the context of a token count.
 * - Words in capitals written without their accents, as many registries print them (JOAO, ARAUJO, CONTEUDO): a form with
 *   one or two accents or a cedilla that is a listed word, or an entry of the dictionary as it stands. Affixed forms of the
 *   dictionary are left out here, since accents make too many of them (IDEA would read as ideá).
 * - Names and rare words: words the dictionary knows that are not among the common words of the list, which leaves names
 *   out (MARIA, ARAUJO, JOHN are in the dictionary and not in the list; PORTAL and CONGRESS are in both).
 */

export type Family = 'pt' | 'en'

/** A run of consonants counts when at least this many listed words have it in the same place. */
const MIN_WORDS = 3
const VOWELS = /[aeiouyáàâãéêíóôõúü]+/u
const NOT_LETTERS = /[^\p{Ll}]/u

interface Clusters {
  start: Map<string, number>
  middle: Map<string, number>
  end: Map<string, number>
}

const tables = new Map<Family, Clusters>()

/** The consonant runs of a lower-case word: before its first vowel, between vowels, after its last; undefined with no vowel. */
function consonantRuns(word: string): { start: string; middle: string[]; end: string } | undefined {
  const parts = word.split(VOWELS)
  if (parts.length < 2) return undefined
  return { start: parts[0] ?? '', middle: parts.slice(1, -1), end: parts.at(-1) ?? '' }
}

function clustersOf(family: Family): Clusters {
  let table = tables.get(family)
  if (table) return table
  table = { start: new Map(), middle: new Map(), end: new Map() }
  const count = (map: Map<string, number>, run: string) => map.set(run, (map.get(run) ?? 0) + 1)
  for (const word of listedWords(family)) {
    if (NOT_LETTERS.test(word)) continue
    const runs = consonantRuns(word)
    if (!runs) continue
    count(table.start, runs.start)
    for (const run of runs.middle) count(table.middle, run)
    count(table.end, runs.end)
  }
  tables.set(family, table)
  return table
}

/** Whether a token has the shape of a word of the language: letters only, a vowel, and consonant runs common words have. */
export function wordShaped(token: string, family: Family): boolean {
  const word = token.normalize('NFC').toLowerCase()
  if (NOT_LETTERS.test(word)) return false
  const runs = consonantRuns(word)
  if (!runs) return false
  const table = clustersOf(family)
  const common = (map: Map<string, number>, run: string) => (map.get(run) ?? 0) >= MIN_WORDS
  return common(table.start, runs.start) && runs.middle.every((run) => common(table.middle, run)) && common(table.end, runs.end)
}

const ACCENTS: Readonly<Record<string, readonly string[]>> = {
  a: ['á', 'â', 'ã', 'à'],
  e: ['é', 'ê'],
  i: ['í'],
  o: ['ó', 'ô', 'õ'],
  u: ['ú'],
  c: ['ç'],
}

/**
 * The forms of a Portuguese token written without accents, with one or two letters accented: JOAO gives joão, CONTEUDO
 * gives conteúdo. None for a token of fewer than four letters (PAS would read as pás) or one that has an accent already.
 */
export function* accentedForms(token: string): Generator<string> {
  const word = token.normalize('NFC').toLowerCase()
  if (word.length < 4 || !/^[a-z]+$/.test(word)) return
  const places = [...word].flatMap((letter, index) => (ACCENTS[letter] ? [index] : []))
  const swap = (text: string, index: number, letter: string) => `${text.slice(0, index)}${letter}${text.slice(index + 1)}`
  for (const [n, first] of places.entries()) {
    for (const a of ACCENTS[word[first] as string] ?? []) {
      const once = swap(word, first, a)
      yield once
      for (const second of places.slice(n + 1)) {
        for (const b of ACCENTS[word[second] as string] ?? []) yield swap(once, second, b)
      }
    }
  }
}

function accented(token: string, family: Family, test: (word: string) => boolean): boolean {
  if (family !== 'pt') return false
  for (const form of accentedForms(token)) if (test(form)) return true
  return false
}

/** Whether the language's list of common words holds the token, as written or with its accents restored. */
function common(token: string, family: Family): boolean {
  return isListedWord(token, family) || accented(token, family, (form) => isListedWord(form, family))
}

/** Whether a token in capitals is a word: of the dictionary or the list, or, without its accents, an entry or a listed word. */
export function knownWord(token: string, family: Family, dictionary: WordList): boolean {
  return dictionary.isWord(token) || common(token, family) || accented(token, family, (form) => dictionary.isEntry?.(form) ?? false)
}

/** Whether a token is a name or a rare word: the dictionary knows it, and it is not among the common words (MARIA, JOAO). */
export function nameLike(token: string, family: Family, dictionary: WordList): boolean {
  if (common(token, family)) return false
  return dictionary.isWord(token) || accented(token, family, (form) => dictionary.isEntry?.(form) ?? false)
}
