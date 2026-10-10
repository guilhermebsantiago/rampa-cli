import type { Patch } from '../core/types.ts'
import { truncate } from '../core/util.ts'
import { attributesOf, escapeHtml, isHidden } from '../criteria/shared.ts'
import type { Locale } from '../i18n.ts'
import type { A11yNode } from '../snapshot/schema.ts'
import { type TreeIndex, inheritedLang, walkTree } from '../snapshot/tree.ts'
import type { Hit, RuleCheck } from './types.ts'
import { WORD_LANGUAGES, type WordLanguage, splitIntoWords, wordLanguageOf } from './words/index.ts'

/**
 * 1.3.2 Meaningful Sequence, failure F32: white space used to space out the letters of a word
 * ("W E L C O M E"). A screen reader reads each letter on its own, and the word is lost. The rule finds
 * four or more single letters separated by spaces in one element's own text and reports them only when,
 * joined, they make a word in the element's language: an index (A B C D), an acronym spelled out
 * (N A S A) or a grade scale is left alone.
 */

const UNDERSTANDING = 'https://www.w3.org/WAI/WCAG22/Understanding/meaningful-sequence.html'

/** Four or more letters, each on its own, with white space between them. */
const RUN = /(?<![\p{L}\p{M}\p{N}])\p{L}\p{M}*(?:\s+\p{L}\p{M}*){3,}(?![\p{L}\p{M}\p{N}])/gu

/** Text where spacing carries meaning of its own: code, keys, math. */
const VERBATIM = new Set(['pre', 'code', 'kbd', 'samp', 'var', 'math', 'textarea', 'script', 'style'])
/** Roles whose own accessible name, when the author sets it, is read instead of the text inside. */
const NAMED_BY_AUTHOR = new Set(['heading', 'link', 'button', 'img', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'treeitem', 'switch', 'checkbox', 'radio'])

export interface LetterRun {
  /** The run as the text has it: "W E L C O M E". */
  run: string
  /** The letters joined: "WELCOME". */
  joined: string
  /** The words the letters make: ["welcome"], or ["welcome", "to", "our", "site"]. */
  words: string[]
  language: WordLanguage
}

/**
 * The runs of four or more spaced letters in a text that make words in one of the languages given. When several
 * languages are given (the element's language is unknown), the first that reads the run as words wins.
 */
export function letterSpacedRuns(text: string, languages: readonly WordLanguage[]): { runs: LetterRun[]; candidates: number } {
  const runs: LetterRun[] = []
  let candidates = 0
  for (const match of text.matchAll(RUN)) {
    candidates++
    const letters = match[0].split(/\s+/)
    for (const language of languages) {
      const words = splitIntoWords(letters.join(''), language)
      if (!words) continue
      // A one-letter word at either end may be a real word next to the run ("B I E N V E N I D O S a la tienda"):
      // it stays out of what is reported, as long as the rest still makes words.
      const kept = [...letters]
      while (words.length > 1 && words[0]?.length === 1) {
        words.shift()
        kept.shift()
      }
      while (words.length > 1 && words.at(-1)?.length === 1) {
        words.pop()
        kept.pop()
      }
      runs.push({ run: kept.join(' '), joined: kept.join(''), words, language })
      break
    }
  }
  return { runs, candidates }
}

/** An ancestor (or the node) whose text is verbatim, or whose author-set name is read instead of its text. */
function leftAlone(index: TreeIndex, node: A11yNode): 'verbatim' | 'named' | undefined {
  for (let entry = index.get(node.ref); entry; entry = entry.parentRef === undefined ? undefined : index.get(entry.parentRef)) {
    const current = entry.node
    if (VERBATIM.has(String(current.native.tag ?? ''))) return 'verbatim'
    const attributes = attributesOf(current)
    const named = (attributes['aria-label'] ?? '').trim() !== '' || (attributes['aria-labelledby'] ?? '').trim() !== ''
    if (named && NAMED_BY_AUTHOR.has(current.role)) return 'named'
  }
  return undefined
}

const TEXT: Record<Locale, { message: string; phrase: string; unknown: string }> = {
  en: {
    message:
      'The letters of “{word}” are written with spaces between them ({run}), so a screen reader reads them one by one instead of the word (WCAG 1.3.2, F32). Write the word without spaces and space the letters with CSS letter-spacing.',
    phrase:
      'The words “{word}” are written letter by letter with spaces between them ({run}), so a screen reader reads single letters instead of words (WCAG 1.3.2, F32). Write the words without spaces between their letters and space them with CSS letter-spacing.',
    unknown: 'the page declares no language; read as {language}',
  },
  'pt-BR': {
    message:
      'As letras de “{word}” estão separadas por espaços ({run}), então o leitor de tela lê uma letra de cada vez em vez da palavra (WCAG 1.3.2, F32). Escreva a palavra sem espaços e espace as letras com letter-spacing no CSS.',
    phrase:
      'As palavras “{word}” estão escritas letra por letra, separadas por espaços ({run}), então o leitor de tela lê letras soltas em vez de palavras (WCAG 1.3.2, F32). Escreva as palavras sem espaços entre as letras e espace-as com letter-spacing no CSS.',
    unknown: 'a página não declara idioma; lido como {language}',
  },
}

const LANGUAGE_NAMES: Record<Locale, Record<WordLanguage, string>> = {
  en: { en: 'English', pt: 'Portuguese', es: 'Spanish' },
  'pt-BR': { en: 'inglês', pt: 'português', es: 'espanhol' },
}

export const letterSpacedWordsRule: RuleCheck = {
  id: 'rampa/letter-spaced-words',
  version: '1',
  criteria: ['1.3.2'],
  maturity: 'experimental',
  surfaces: ['web', 'android', 'ios'],
  act: [],
  engineRules: [],
  // One failure technique among the many ways a reading order can break: a page with no spaced letters says nothing about 1.3.2.
  narrow: true,
  help: {
    en: 'Letters of a word must not be spaced out with white space (F32); use CSS letter-spacing',
    'pt-BR': 'As letras de uma palavra não devem ser separadas com espaços (F32); use letter-spacing no CSS',
  },
  helpUrl: UNDERSTANDING,
  run(snapshot, _engine, ctx) {
    const hits: Hit[] = []
    let applicable = 0
    let otherLanguage = 0
    for (const node of walkTree(snapshot.root)) {
      const text = node.text
      if (!text || text.length < 7 || isHidden(node)) continue
      const declared = node.lang ?? inheritedLang(ctx.index, node.ref, snapshot.locale)
      const language = wordLanguageOf(declared)
      // A language Rampa has no list for is not read; an undeclared one is read against every list.
      if (declared && declared.trim() !== '' && !language) {
        if (RUN.test(text)) otherLanguage++
        RUN.lastIndex = 0
        continue
      }
      const { runs, candidates } = letterSpacedRuns(text, language ? [language] : WORD_LANGUAGES)
      if (candidates === 0) continue
      if (leftAlone(ctx.index, node)) continue
      applicable += candidates
      for (const found of runs) {
        const word = inOwnCase(found)
        const evidence = [
          `“${found.run}” → ${found.words.join(' · ')} (${LANGUAGE_NAMES[ctx.locale][found.language]})`,
          ...(language ? [] : [TEXT[ctx.locale].unknown.replace('{language}', LANGUAGE_NAMES[ctx.locale][found.language])]),
        ].join('; ')
        hits.push({
          ref: node.ref,
          outcome: 'fail',
          subject: found.run,
          evidence,
          confidence: language ? 'high' : 'medium',
          html: typeof node.native.html === 'string' ? node.native.html : undefined,
          facts: { run: found.run, joined: found.joined, word, phrase: found.words.length > 1, text, language: found.language },
        })
      }
    }
    const note =
      otherLanguage > 0
        ? ctx.locale === 'pt-BR'
          ? `${otherLanguage} sequência(s) de letras espaçadas em idioma sem lista de palavras (só en, pt e es)`
          : `${otherLanguage} run(s) of spaced letters in a language with no word list (en, pt and es only)`
        : undefined
    return { hits, applicable, ...(note ? { note } : {}) }
  },
  message(hit, locale) {
    const text = TEXT[locale]
    return (hit.facts.phrase ? text.phrase : text.message).replace('{word}', String(hit.facts.word)).replace('{run}', `“${truncate(String(hit.facts.run), 60)}”`)
  },
  patch(hit): Patch | undefined {
    const text = String(hit.facts.text)
    const to = text.replace(String(hit.facts.run), String(hit.facts.word))
    if (to === text) return undefined
    return { ref: hit.ref, kind: 'set-text', from: text, to, before: escapeHtml(text), after: escapeHtml(to) }
  },
}

/** The words the letters make, in the letters' own case: "W E L C O M E" → "WELCOME", "T a b l e o f C o n t e n t s" → "Table of Contents". */
export function inOwnCase(found: LetterRun): string {
  let letters = found.joined
  return found.words
    .map((word) => {
      const piece = letters.slice(0, word.length)
      letters = letters.slice(word.length)
      return piece
    })
    .join(' ')
}

export const SEQUENCE_RULES: readonly RuleCheck[] = [letterSpacedWordsRule]
