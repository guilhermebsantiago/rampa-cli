import { letterCount, primarySubtag } from './util.ts'

/**
 * A deterministic language identifier for 3.1.1 and 3.1.2: ELD (Efficient Language Detector, Apache-2.0),
 * an n-gram model of 60 languages, with its small database. Chosen over franc by measuring both on 1,246 texts
 * in pt, en, es, nl, fr and de (interface strings and sentences written for the test, axe-core's translated rule
 * help, and both joined into paragraphs): ELD small read 87% of texts under 16 characters and 97% of those up to
 * 40 correctly, franc-min 23% and 69%, franc 15% and 62%; past 40 characters ELD read all of them, franc-min 94%.
 * The large database gained under 1% for three times the load time and memory.
 *
 * It never judges alone what a model is for. It reads long text, where n-grams are reliable, and says
 * how sure it is. A criterion decides without a model only when the reading is `clear`, drops a model's
 * verdict that contradicts a `confident` reading, and leaves short or mixed text to the model.
 */

interface Detector {
  detect(text: string): { language: string; getScores(): Record<string, number>; isReliable(): boolean }
  info(): { Languages: Record<number, string> }
}

let detector: Detector | undefined
let supported: Set<string> | undefined
let loading: Promise<void> | undefined

/** Loads the n-gram database once (about 150 ms); until then `readLanguage` returns undefined. */
export function loadLanguageIdentifier(): Promise<void> {
  loading ??= import('eld/small').then(({ eld }) => {
    detector = eld as Detector
    supported = new Set(Object.values(detector.info().Languages))
  })
  return loading
}

/** Tags the identifier reports under another code: Norwegian Bokmål and Nynorsk as "no", Filipino as "tl". */
const SAME_AS: Readonly<Record<string, string>> = { nb: 'no', nn: 'no', fil: 'tl' }

/** Languages close enough that n-grams confuse them on real pages; between them, only a model decides. */
const CONFUSABLE: readonly (readonly string[])[] = [
  ['da', 'no', 'sv'],
  ['hr', 'sr', 'bs'],
  ['ms', 'id'],
  ['cs', 'sk'],
]

/** The identifier's code for a language tag: its primary subtag, with the aliases above. */
export function identifierCode(tag: string): string {
  const primary = primarySubtag(tag)
  return SAME_AS[primary] ?? primary
}

/** Below this many letters a chunk is not read on its own. */
const CHUNK_LETTERS = 40
/** Enough to nominate a passage that declares no language: a phrase of a few words, one language ahead. */
const PASSAGE = { letters: 20, words: 3, margin: 0.05, share: 0.8 }
/** Confident: at least this many letters, the top language this far ahead, and this share of the chunks. */
const CONFIDENT = { letters: 60, words: 8, margin: 0.05, share: 0.8 }
/** Clear: long enough to decide without a model. */
const CLEAR = { letters: 150, words: 20, margin: 0.08, share: 0.85 }
/**
 * A language scored this close to the top fits the text as well: "Paul put dire comment on tape" is English and
 * French. Measured on the same texts, it would drop 0.26% of real mismatches.
 */
const AMBIGUOUS = 0.02

export interface LanguageReading {
  /** The identifier's code (ISO 639-1) for the language most of the text reads as; empty when nothing was read. */
  language: string
  letters: number
  words: number
  /** Top score minus the runner-up's. */
  margin: number
  /** Share of the letters, read in chunks of about a sentence, whose chunk reads as `language`. */
  share: number
  scores: Record<string, number>
  /** A phrase of a few words, one language ahead: enough to ask a model about it, not to drop what a model says. */
  passage: boolean
  /** Enough text, one language well ahead of the rest, and no large part in another language. */
  confident: boolean
  /** Confident and long: enough to decide without a model. */
  clear: boolean
  /** The first chunk that reads as `language`, as it appears in the text: a quote for the evidence. */
  sample: string | undefined
}

/** How the text reads, or undefined when the identifier is not loaded or the text has no letters. */
export function readLanguage(text: string): LanguageReading | undefined {
  if (!detector) return undefined
  const letters = letterCount(text)
  if (letters === 0) return undefined
  const words = text.split(/\s+/).filter((word) => /\p{L}/u.test(word)).length
  const result = detector.detect(text)
  const scores = result.getScores()
  const ranked = Object.values(scores).sort((a, b) => b - a)
  const margin = (ranked[0] ?? 0) - (ranked[1] ?? 0)
  const language = result.language

  let read = 0
  let same = 0
  let sample: string | undefined
  for (const chunk of chunksOf(text)) {
    const chunkLetters = letterCount(chunk)
    const chunkLanguage = detector.detect(chunk).language
    read += chunkLetters
    if (chunkLanguage === language) {
      same += chunkLetters
      sample ??= chunk
    }
  }
  const share = read === 0 ? 0 : same / read
  const meets = (bar: typeof CONFIDENT) => letters >= bar.letters && words >= bar.words && margin >= bar.margin && share >= bar.share
  const passage = language !== '' && meets(PASSAGE)
  const confident = passage && result.isReliable() && meets(CONFIDENT)
  return { language, letters, words, margin, share, scores, passage, confident, clear: confident && meets(CLEAR), sample: sample?.slice(0, 160) }
}

/** Splits text into chunks of about a sentence, each with at least CHUNK_LETTERS letters where the text allows. */
function chunksOf(text: string): string[] {
  const chunks: string[] = []
  let current: string[] = []
  let letters = 0
  for (const word of text.split(/\s+/).filter(Boolean)) {
    current.push(word)
    letters += letterCount(word)
    const sentenceEnd = /[.!?;:]["')\]]*$/.test(word)
    if (letters >= CHUNK_LETTERS * 2 || (letters >= CHUNK_LETTERS && sentenceEnd)) {
      chunks.push(current.join(' '))
      current = []
      letters = 0
    }
  }
  if (current.length > 0) {
    // A short tail joins the chunk before it, so no chunk is too short to read.
    const tail = current.join(' ')
    if (letters < CHUNK_LETTERS / 2 && chunks.length > 0) chunks[chunks.length - 1] += ` ${tail}`
    else chunks.push(tail)
  }
  return chunks
}

/** Words in each window the phrase finder reads; ELD reads five words of a language it knows well. */
const WINDOW = 5
/** A window counts as another language when the inherited language scores this far behind the top one. */
const WINDOW_MARGIN = 0.08
/** Windows read per text at most, so a long page stays fast. */
const MAX_WINDOWS = 400

/**
 * Runs of words that read as another language than `inherited`, such as a quote inside a paragraph. Every window of
 * five words is read; a word belongs to a run when most of the windows that could cover it read as another language,
 * so the words around a quote stay out of it. A run that reaches to within two words of either end of the text takes
 * them in when they read the same. Each run is read again as a whole and kept only when it reads as another language;
 * the model then decides whether an exception (a name, a term, a loanword) covers it.
 */
export function foreignRuns(text: string, inherited: string): string[] {
  const identifier = detector
  if (!identifier || !identifies(inherited)) return []
  const code = identifierCode(inherited)
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length < 3) return []
  const foreignWindows = words.map(() => 0)
  const last = Math.min(Math.max(0, words.length - WINDOW), MAX_WINDOWS)
  for (let start = 0; start <= last; start++) {
    const window = words.slice(start, start + WINDOW)
    const scores = identifier.detect(window.join(' ')).getScores()
    const [top] = Object.entries(scores).sort((a, b) => b[1] - a[1])
    const foreign = top !== undefined && top[0] !== code && (scores[code] ?? 0) <= top[1] - WINDOW_MARGIN && distinguishable(top[0], code)
    if (!foreign) continue
    for (let i = start; i < start + window.length; i++) foreignWindows[i] = (foreignWindows[i] ?? 0) + 1
  }
  const possible = Math.min(WINDOW, words.length - WINDOW + 1, words.length)
  const flagged = foreignWindows.map((count) => count * 2 > Math.max(1, possible))
  // A name or a number inside a run does not split it: gaps of up to two words close.
  for (let i = 1; i < flagged.length - 1; i++) {
    if (!flagged[i] && flagged[i - 1] && (flagged[i + 1] || flagged[i + 2])) flagged[i] = true
  }
  const readAs = (from: number, to: number) => identifier.detect(words.slice(from, to + 1).join(' ')).language
  const runs: string[] = []
  let i = 0
  while (i < words.length) {
    if (!flagged[i]) {
      i++
      continue
    }
    let from = i
    let to = i
    while (to + 1 < words.length && flagged[to + 1]) to++
    i = to + 1
    const language = readAs(from, to)
    if (language === '' || language === code) continue
    // Windows blur the edges by a word or two: an edge word that reads as the inherited language on its own leaves the
    // run, and a neighbour that reads as the run's language joins it.
    const alone = (index: number) => identifier.detect(words[index] ?? '').language
    for (let step = 0; step < 2 && to - from >= 2 && alone(from) === code; step++) from++
    for (let step = 0; step < 2 && to - from >= 2 && alone(to) === code; step++) to--
    for (let step = 0; step < 2 && from > 0 && alone(from - 1) === language; step++) from--
    for (let step = 0; step < 2 && to + 1 < words.length && alone(to + 1) === language; step++) to++
    // The first and last words of a text are under fewer windows: a run that comes within two words of an end takes
    // them in, unless one of them reads as the inherited language.
    const none = (a: number, b: number) => words.slice(a, b).every((_, k) => alone(a + k) !== code)
    if (from <= 2 && none(0, from) && readAs(0, to) === language) from = 0
    if (to >= words.length - 3 && none(to + 1, words.length) && readAs(from, words.length - 1) === language) to = words.length - 1
    const run = words.slice(from, to + 1).join(' ')
    const reading = readLanguage(run)
    if (reading?.passage && reading.language === language && !fitsAsWell(reading, inherited)) runs.push(run)
  }
  return runs
}

/** Whether the identifier knows the language at all: a tag it has no n-grams for is never decided by it. */
export function identifies(tag: string): boolean {
  return supported?.has(identifierCode(tag)) ?? false
}

/** Whether two tags name languages the identifier tells apart reliably. */
function distinguishable(a: string, b: string): boolean {
  const x = identifierCode(a)
  const y = identifierCode(b)
  return !CONFUSABLE.some((group) => group.includes(x) && group.includes(y))
}

export type Agreement = 'same' | 'other' | 'unsure'

/**
 * What a reading says about a declared language: `same` when it reads as that language, `other` when it reads as
 * another language the identifier tells apart from it, `unsure` when the reading is not confident, the identifier
 * does not know the declared language, or the two are easily confused.
 */
export function agreement(reading: LanguageReading | undefined, declared: string, level: 'passage' | 'confident' | 'clear'): Agreement {
  if (!reading || !reading[level] || !identifies(declared)) return 'unsure'
  if (reading.language === identifierCode(declared)) return 'same'
  return distinguishable(reading.language, declared) ? 'other' : 'unsure'
}

/**
 * Whether the text reads as well in `tag` as in the language it reads as most: the n-grams cannot separate the two.
 * Words that belong to several languages count for each (ACT's most common language), so neither is the text's own.
 */
export function fitsAsWell(reading: LanguageReading | undefined, tag: string): boolean {
  if (!reading || reading.language === '' || reading.words < 2) return false
  const code = identifierCode(tag)
  if (code === reading.language) return true
  const top = reading.scores[reading.language] ?? 0
  const score = reading.scores[code]
  return score !== undefined && score >= top - AMBIGUOUS
}
