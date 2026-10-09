/**
 * Sentences and words, with Intl.Segmenter. ICU splits after abbreviations that end in a period
 * ("O Sr. Silva mora na Av. Paulista", "See e.g. Fig. 3", "The U.S. Navy": measured on Node 24.21,
 * ICU 78.3), so a sentence that ends in one of the abbreviations below is joined to the next.
 * Counts are exact once this list and the ICU version are fixed; both are recorded with every result.
 */

/** Bump when the list changes: counts recorded with an older list are not comparable. */
export const ABBREVIATIONS_VERSION = '1'

const ABBREVIATIONS: Record<'pt' | 'en', readonly string[]> = {
  pt: ['Sr.', 'Sra.', 'Srs.', 'Dr.', 'Dra.', 'Drs.', 'Prof.', 'Profa.', 'Av.', 'R.', 'art.', 'arts.', 'inc.', 'nº.', 'n.º', 'p.', 'ex.', 'p. ex.', 'pág.', 'págs.', 'tel.', 'cf.', 'aprox.', 'obs.', 'Ltda.', 'S.A.', 'etc.', 'vol.', 'cap.', 'fl.', 'fls.'],
  en: ['Mr.', 'Mrs.', 'Ms.', 'Dr.', 'Prof.', 'St.', 'Ave.', 'e.g.', 'i.e.', 'U.S.', 'U.K.', 'a.m.', 'p.m.', 'Fig.', 'fig.', 'vs.', 'approx.', 'Inc.', 'Ltd.', 'Co.', 'Jr.', 'Sr.', 'Jan.', 'Feb.', 'Mar.', 'Apr.', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.'],
}

/** "etc." often ends a sentence: it joins the next one only when that one starts in lowercase. */
const ONLY_BEFORE_LOWERCASE = new Set(['etc.', 'Ltda.', 'S.A.', 'Inc.', 'Ltd.', 'Co.', 'Jr.'])

function family(language: string): 'pt' | 'en' | undefined {
  const primary = language.split('-')[0]?.toLowerCase()
  return primary === 'pt' || primary === 'en' ? primary : undefined
}

const segmenters = new Map<string, Intl.Segmenter>()
function segmenter(language: string, granularity: 'sentence' | 'word'): Intl.Segmenter {
  const key = `${language}|${granularity}`
  let found = segmenters.get(key)
  if (!found) {
    let locale = language
    try {
      Intl.getCanonicalLocales(language)
    } catch {
      locale = 'und'
    }
    found = new Intl.Segmenter(locale, { granularity })
    segmenters.set(key, found)
  }
  return found
}

/** The sentences of a text, trimmed, with the splits after known abbreviations undone. */
export function sentences(text: string, language: string): string[] {
  const raw = [...segmenter(language, 'sentence').segment(text)].map((s) => s.segment)
  const list = ABBREVIATIONS[family(language) ?? 'en']
  const out: string[] = []
  let pending = ''
  for (const [index, segment] of raw.entries()) {
    pending += segment
    const next = raw[index + 1]
    if (next !== undefined && endsWithAbbreviation(pending, list, next)) continue
    if (pending.trim()) out.push(pending.trim())
    pending = ''
  }
  if (pending.trim()) out.push(pending.trim())
  return out
}

function endsWithAbbreviation(text: string, list: readonly string[], next: string): boolean {
  const trimmed = text.trimEnd()
  for (const abbreviation of list) {
    if (!trimmed.endsWith(abbreviation)) continue
    // The abbreviation must be a word of its own: "Sr." in "O Sr.", never the end of "Ensr.".
    const before = trimmed.charAt(trimmed.length - abbreviation.length - 1)
    if (before && /[\p{L}\p{N}]/u.test(before)) continue
    if (ONLY_BEFORE_LOWERCASE.has(abbreviation) && !/^\s*\p{Ll}/u.test(next)) continue
    return true
  }
  return false
}

/** The words of a text as the segmenter finds them: numbers count, punctuation does not. */
export function words(text: string, language: string): string[] {
  return [...segmenter(language, 'word').segment(text)].filter((s) => s.isWordLike).map((s) => s.segment)
}

export function icuVersion(): string {
  return process.versions.icu ?? 'unknown'
}
