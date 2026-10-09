/**
 * Syllable counts for the readability formulas. Only the count matters, not where a word splits.
 *
 * Portuguese is counted by rule: one syllable per vowel nucleus, with the diphthong and hiatus rules
 * of school grammar. A falling diphthong (vowel + unaccented i or u) is one syllable (pai, céu, muito);
 * two strong vowels are two (po-e-ta); an accented í or ú is its own syllable (sa-ú-de, pa-ís); i or u
 * before nh, or closed by l, m, n, r or z, is its own syllable (ra-i-nha, ju-iz, a-in-da); u after q or
 * g before a vowel is a glide (quan-do, lin-gui-ça); ão, ãe and õe are one. An unaccented i or u before
 * another vowel is counted as a hiatus (his-tó-ri-a, pi-a-no), the convention schools teach;
 * dictionaries that write his-tó-ria count one fewer.
 *
 * English has no rule that good: without a pronouncing dictionary the count is a heuristic, and every
 * result that uses it says so.
 */

export const SYLLABLES_PT_VERSION = '1'
export const SYLLABLES_EN_VERSION = 'heuristic-1'

const VOWELS = new Set([...'aeiouáàâãéêíóôõúüy'])
const GLIDES = new Set(['i', 'u', 'y'])
const CLOSING = new Set([...'lmnrz'])

export function syllablesPt(word: string): number {
  let total = 0
  for (const part of word.toLowerCase().split(/[^\p{L}]+/u)) {
    if (part === '') continue
    // The contraction "ao" is one syllable, a diphthong with the value of "au"; caos stays ca-os.
    if (part === 'ao' || part === 'aos') {
      total += 1
      continue
    }
    total += nucleiPt(part)
  }
  return total
}

function nucleiPt(word: string): number {
  const letters = [...word]
  const isVowel = (index: number): boolean => {
    const letter = letters[index]
    if (letter === undefined || !VOWELS.has(letter)) return false
    const previous = letters[index - 1]
    const next = letters[index + 1]
    // qu, gu and gü before a vowel: the u is a glide of the onset (quan-do, guer-ra, lin-gui-ça).
    if ((letter === 'u' || letter === 'ü') && (previous === 'q' || previous === 'g') && next !== undefined && VOWELS.has(next)) return false
    if (letter === 'ü' && next !== undefined && VOWELS.has(next)) return false
    return true
  }
  let count = 0
  let index = 0
  while (index < letters.length) {
    if (!isVowel(index)) {
      index++
      continue
    }
    count++
    let next = index + 1
    let glided = false
    while (next < letters.length && isVowel(next) && !glided && joins(letters, next, isVowel)) {
      glided = true
      next++
    }
    index = next
  }
  return Math.max(count, word.length > 0 ? 1 : 0)
}

/** Whether the vowel at `index` joins the nucleus before it, as the glide of a diphthong. */
function joins(letters: string[], index: number, isVowel: (index: number) => boolean): boolean {
  const previous = letters[index - 1] ?? ''
  const letter = letters[index] ?? ''
  if (previous === letter) return false
  if ((previous === 'ã' || previous === 'õ') && (letter === 'o' || letter === 'e')) return true
  if (!GLIDES.has(letter)) return false
  const after = letters[index + 1]
  const afterNext = letters[index + 2]
  if (after === 'n' && afterNext === 'h') return false
  // rr is one sound that opens the next syllable: bair-ro keeps its diphthong.
  if (after === 'r' && afterNext === 'r') return true
  // S does not close the syllable this way, so mais and papéis keep their diphthong.
  if (after !== undefined && CLOSING.has(after) && (afterNext === undefined || !isVowel(index + 2))) return false
  return true
}

/** A common heuristic: vowel groups, less a silent final e and the -es and -ed that add no syllable. */
export function syllablesEn(word: string): number {
  let total = 0
  for (const part of word.toLowerCase().split(/[^a-z]+/)) {
    if (part === '') continue
    if (part.length <= 3) {
      total += 1
      continue
    }
    const trimmed = part.replace(/(?:[^laeiouy]es|[^laeiouy]ed|[^laeiouy]e)$/, (match) => match.charAt(0)).replace(/^y/, '')
    total += Math.max(1, trimmed.match(/[aeiouy]{1,2}/g)?.length ?? 0)
  }
  return total
}
