import type { Patch } from '../../core/types.ts'
import { errorMessage } from '../../core/util.ts'
import { attributesOf, endTagOf, escapeHtml, startTagOf } from '../../criteria/shared.ts'
import { sentences } from '../../text/segment.ts'
import { type DictionaryLanguage, downloadedDictionaries } from '../abbreviations/dictionaries.ts'
import type { WordList } from '../abbreviations/hunspell.ts'
import {
  BR_STATES,
  COMMON_CURRENCIES,
  CURRENCIES,
  FILE_FORMATS,
  LISTS,
  LISTS_VERSION,
  UNITS,
  US_STATES,
  isRomanNumeral,
} from '../abbreviations/lists.ts'
import { definitionsIn, plain } from '../abbreviations/long-form.ts'
import { proposeExpansions } from '../abbreviations/propose.ts'
import type { AdvisoryCheck, AdvisoryHit, CheckRun } from '../check.ts'
import { cogaBasis } from '../coga.ts'
import { am, ordinal, times } from '../messages.ts'
import { type Page, type TextRun, runFinder, tagOf, textRuns } from '../page.ts'
import type { Basis, Reference } from '../types.ts'

/**
 * COGA o3p01 Use Clear Words (https://www.w3.org/WAI/WCAG2/supplemental/patterns/o3p01-clear-words/).
 * What to Do: "Remove or explain uncommon acronyms, abbreviations, and jargon". Use: abbreviations
 * "explained the first time they are used, unless the abbreviation is more common than the full term".
 *
 * Rules decide, in four steps:
 * 1. Candidates: tokens of 2–8 characters with at least two capitals and no run of three lowercase
 *    letters (CPF, NIS, CNPJs), and the curated names that break that shape (CadÚnico). Left out: words
 *    written in capitals (ENTRAR, which the dictionary knows), Roman numerals, state codes, currencies and
 *    units next to a number, file formats, text in code or addresses, and the project's own list.
 * 2. Explained when an occurrence has <abbr title>, a <dfn>, a glossary link, or its full term next to it
 *    (Schwartz and Hearst, 2003), in brackets or after a dash, in either order. Explained only later on
 *    the page is reported as "not at first use".
 * 3. Abbreviations more common than their full term (the curated list) are left to WCAG 3.1.4
 *    Abbreviations (AAA), beyond the run's target; the rest are COGA advisories.
 * 4. Optionally, a model proposes an expansion when neither the page nor the list has one; it is kept
 *    only if its initials spell the token, and shown as a suggestion to confirm.
 *
 * Only Portuguese and English are read: the languages with a dictionary and a curated list.
 */

const VERSION = `1+lists-${LISTS_VERSION}`
const TOKEN = /[\p{L}\p{N}]+/gu
/** Addresses, e-mail addresses and domain names, blanked before tokens are read. */
const ADDRESSES = /\b(?:https?:\/\/|www\.)\S+|\S+@\S+\.\S+|\b[\w-]+(?:\.[\w-]+)*\.(?:gov|com|org|net|edu|br|uk|io|mil|int)(?:\.[a-z]{2})?\b\S*/giu
const LEI_15263: Reference = {
  kind: 'law',
  label: 'Lei 15.263/2025, art. 5º, VIII',
  url: 'https://www.planalto.gov.br/ccivil_03/_Ato2023-2026/2025/Lei/L15263.htm',
}
const PUBLIC_SECTOR = /\.(?:gov|leg|jus|mp)\.br$/
const MAX_PATCHED_TEXT = 160
const O3P01: Basis = cogaBasis('o3p01', 'avoid', 'Abbreviations, acronyms, and jargon that the user may not know and are not explained.')
const WCAG_314: Basis = {
  framework: 'wcag',
  id: '3.1.4',
  level: 'AAA',
  version: '2.2',
  outside: 'aaa',
  url: 'https://www.w3.org/WAI/WCAG22/Understanding/abbreviations.html',
}

type Family = 'pt' | 'en'
const DICTIONARY: Record<Family, DictionaryLanguage> = { pt: 'pt-BR', en: 'en' }

interface Occurrence {
  /** As written: CNPJs. */
  token: string
  /** As looked up: CNPJ. */
  key: string
  family: Family
  runIndex: number
  offset: number
}

interface Explanation {
  runIndex: number
  offset: number
  expansion?: string | undefined
  /** What the page writes: "Número de Identificação Social (NIS)", <abbr title="…">. */
  context: string
}

/** A result being built: its message is finished once the model step, if any, has answered. */
interface Pending {
  hit: AdvisoryHit
  key: string
  sentence: string
  language: string
  /** Sentences before and after the place a proposed expansion goes. */
  head: string[]
  tail: string[]
  asksModel: boolean
}

export const abbreviations: AdvisoryCheck = {
  id: 'coga/abbreviations',
  version: VERSION,
  maturity: 'experimental',
  pattern: 'o3p01',
  surfaces: ['web'],

  async run(context): Promise<CheckRun> {
    const { page, locale } = context
    // An absence claim needs the whole page: past the collector's cap there could be an explanation.
    if (page.snapshot.truncated) return { ran: false, reason: 'snapshot truncated', candidates: 0, hits: [] }
    const runs = textRuns(page).filter((run) => !run.code)

    const dictionaries = new Map<Family, WordList>()
    const reasons: string[] = []
    const source = context.coga.dictionaries ?? downloadedDictionaries()
    const present = new Set(runs.map((run) => primaryOf(run.language)))
    for (const family of ['pt', 'en'] as const) {
      if (!present.has(family)) continue
      try {
        dictionaries.set(family, await source(DICTIONARY[family]))
      } catch (error) {
        reasons.push(`no dictionary for ${DICTIONARY[family]} (${errorMessage(error)})`)
      }
    }
    const others = [...present].filter((primary) => primary !== 'pt' && primary !== 'en' && primary !== 'und')
    if (others.length > 0) reasons.push(`text in ${others.join(', ')} not read: no dictionary`)
    if (dictionaries.size === 0) return { ran: false, reason: reasons.join('; ') || 'no text in Portuguese or English', candidates: 0, hits: [] }

    const occurrences = findOccurrences(runs, dictionaries, new Set(context.coga.abbreviations?.known ?? []))
    const explanations = explanationsOf(page, runs, occurrences, context.coga.abbreviations?.glossaryUrl)
    const publicSector = context.coga.publicSector ?? isPublicSector(page.snapshot.target)
    // A block the collector cut may hold an explanation nobody read.
    const cut = runs.some((run) => run.cut)
    const pending: Pending[] = []

    for (const [key, list] of occurrences) {
      const first = list[0] as Occurrence
      const firstRun = runs[first.runIndex] as TextRun
      const found = (explanations.get(key) ?? []).sort((a, b) => a.runIndex - b.runIndex || a.offset - b.offset)
      const earliest = found[0]
      if (earliest && (earliest.runIndex < first.runIndex || (earliest.runIndex === first.runIndex && earliest.offset <= first.offset))) continue
      const lists = LISTS[first.family]
      const pageExpansion = found.find((explanation) => explanation.expansion)?.expansion
      const listExpansion = lists.expansions.get(key)
      const sentence = sentenceAt(firstRun.text, first.offset, firstRun.language)
      const interfaceText = list.some((occurrence) => runs[occurrence.runIndex]?.interface)
      const facts: Record<string, string | number | boolean> = {
        token: key,
        occurrences: list.length,
        firstUse: sentence,
        searched: 'abbr title, dfn, glossary link, full term in brackets or after a dash',
        where: interfaceText ? 'interface text' : 'content',
      }
      if (cut) facts.textCut = true
      const confidence = cut ? 'medium' : 'high'

      if (lists.common.has(key)) {
        // More common than its full term: COGA does not ask to explain it, WCAG 3.1.4 asks for a way to find its expansion.
        if (earliest) continue
        const message = am(locale, 'abbrBeyond', {
          token: key,
          times: times(locale, list.length),
          example: listExpansion ? am(locale, 'abbrBeyondExample', { expansion: listExpansion }) : '',
        })
        pending.push({
          key,
          sentence,
          language: firstRun.language,
          head: [message],
          tail: [],
          asksModel: false,
          hit: {
            kind: 'beyond-target',
            basis: WCAG_314,
            impact: 'suggestion',
            source: 'rule',
            ref: firstRun.node.ref,
            message,
            evidence: sentence,
            subject: key,
            pageLevel: true,
            facts: { ...facts, ...(listExpansion ? { expansion: listExpansion, expansionFrom: 'list' } : {}) },
            confidence,
          },
        })
        continue
      }

      const expansion = pageExpansion ?? listExpansion
      const head: string[] = []
      if (earliest) {
        const explained = list.findIndex((o) => o.runIndex > earliest.runIndex || (o.runIndex === earliest.runIndex && o.offset >= earliest.offset))
        head.push(am(locale, 'abbrLaterOnly', { token: key, nth: ordinal(locale, explained < 0 ? list.length : explained + 1), explained: earliest.context }))
      } else {
        head.push(am(locale, 'abbrNotExplained', { token: key, times: times(locale, list.length) }))
        if (expansion) head.push(am(locale, pageExpansion ? 'abbrExpansionPage' : 'abbrExpansionList', { expansion, source: am(locale, 'listCurated') }))
      }
      const tail = [am(locale, 'abbrRecommend')]
      // The plan adds the law to Portuguese messages; the reference itself goes with every language.
      if (publicSector && locale === 'pt-BR') tail.push(am(locale, 'abbrLaw'))
      if (expansion) {
        facts.expansion = expansion
        facts.expansionFrom = pageExpansion ? 'page' : 'list'
      }
      pending.push({
        key,
        sentence,
        language: firstRun.language,
        head,
        tail,
        asksModel: !expansion && !earliest,
        hit: {
          kind: 'advisory',
          basis: O3P01,
          related: publicSector ? [WCAG_314, LEI_15263] : [WCAG_314],
          impact: interfaceText ? 'hurdle' : 'suggestion',
          source: 'rule',
          ref: firstRun.node.ref,
          message: '',
          evidence: sentence,
          subject: key,
          pageLevel: true,
          facts,
          patch: expansion ? expansionPatch(firstRun, first, expansion) : undefined,
          confidence,
        },
      })
    }

    // The optional model step: an expansion to confirm, for what neither the page nor the list spells out.
    const asking = context.llm && (context.provider !== undefined || context.offline) ? pending.filter((entry) => entry.asksModel) : []
    const outcome: Pick<CheckRun, 'model' | 'usage' | 'errors'> = {}
    if (asking.length > 0) {
      const proposed = await proposeExpansions(
        asking.map((entry) => ({ token: entry.key, sentence: entry.sentence, language: entry.language })),
        {
          provider: context.provider,
          cache: context.cache,
          offline: context.offline,
          runs: context.runs,
          concurrency: context.concurrency,
          title: page.snapshot.title,
          version: VERSION,
        },
      )
      const modelId = context.provider?.id ?? 'model'
      for (const entry of asking) {
        const proposal = proposed.proposals.get(entry.key)
        if (!proposal) continue
        entry.head.push(am(locale, 'abbrExpansionModel', { expansion: proposal.expansion, model: modelId }))
        entry.hit.source = 'judgment'
        entry.hit.model = modelId
        entry.hit.agreement = { votes: proposal.votes, total: proposal.total }
        entry.hit.facts = { ...entry.hit.facts, expansion: proposal.expansion, expansionFrom: 'model', expansionConfidence: 'low' }
      }
      outcome.model = {
        asked: proposed.asked,
        answered: proposed.answered,
        kept: proposed.proposals.size,
        errors: proposed.errors.length > 0 ? proposed.asked - proposed.answered : 0,
      }
      outcome.usage = proposed.usage
      outcome.errors = proposed.errors
    }
    for (const entry of pending) entry.hit.message = [...entry.head, ...entry.tail].join(' ')

    return {
      ran: true,
      reason: reasons.length > 0 ? reasons.join('; ') : undefined,
      candidates: occurrences.size,
      hits: pending.map((entry) => entry.hit),
      ...outcome,
    }
  },
}

function primaryOf(language: string): string {
  return language.split('-')[0]?.toLowerCase() || 'und'
}

function isPublicSector(target: string): boolean {
  try {
    return PUBLIC_SECTOR.test(new URL(target).hostname)
  } catch {
    return false
  }
}

/** Every occurrence of each candidate, in reading order, keyed as looked up (CNPJs under CNPJ). */
function findOccurrences(runs: readonly TextRun[], dictionaries: Map<Family, WordList>, known: ReadonlySet<string>): Map<string, Occurrence[]> {
  const occurrences = new Map<string, Occurrence[]>()
  for (const [runIndex, run] of runs.entries()) {
    const family = primaryOf(run.language)
    if (family !== 'pt' && family !== 'en') continue
    const dictionary = dictionaries.get(family)
    if (!dictionary) continue
    const text = run.text.replace(ADDRESSES, (match) => ' '.repeat(match.length))
    for (const match of text.matchAll(TOKEN)) {
      const token = match[0]
      const key = candidateKey(token, family)
      if (!key || known.has(key) || known.has(token)) continue
      if (inFileName(text, match.index, token.length)) continue
      const before = text.slice(Math.max(0, match.index - 24), match.index)
      const after = text.slice(match.index + token.length, match.index + token.length + 8)
      if (excluded(key, family, before, after, dictionary)) continue
      const list = occurrences.get(key) ?? []
      list.push({ token, key, family, runIndex, offset: match.index })
      occurrences.set(key, list)
    }
  }
  return occurrences
}

/**
 * Part of a file name or an identifier written as one chunk: IMG_2034.jpg, RELATORIO_FINAL.pdf. A slash
 * does not count, so "CPF/CNPJ" still holds two abbreviations.
 */
function inFileName(text: string, offset: number, length: number): boolean {
  const start = text.lastIndexOf(' ', offset) + 1
  const end = text.indexOf(' ', offset + length)
  const chunk = text.slice(start, end < 0 ? undefined : end).replace(/[.,;:!?)\]]+$/, '')
  return /[_\\]/.test(chunk) || /\.[A-Za-z0-9]{2,4}$/.test(chunk)
}

/** The token as an abbreviation to look up (CNPJs → CNPJ), or undefined when it does not look like one. */
function candidateKey(token: string, family: Family): string | undefined {
  const list = LISTS[family]
  if (list.expansions.has(token) || list.common.has(token)) return token
  const length = [...token].length
  if (length < 2 || length > 8 || !/^\p{Lu}/u.test(token)) return undefined
  if ((token.match(/\p{Lu}/gu)?.length ?? 0) < 2 || /\p{Ll}{3}/u.test(token)) return undefined
  return /^(\p{Lu}[\p{Lu}\p{N}]+)s$/u.exec(token)?.[1] ?? token
}

function excluded(key: string, family: Family, before: string, after: string, dictionary: WordList): boolean {
  // A file format, or the extension of a file name written out; a ZIP code is a postal code, not an archive.
  if ((FILE_FORMATS.has(key) && !(key === 'ZIP' && /^\s*cod/i.test(after))) || /\.$/.test(before)) return true
  if (isRomanNumeral(key, before)) return true
  if (family === 'pt' && BR_STATES.has(key)) return true
  if (family === 'en' && US_STATES.has(key) && /,\s*$/.test(before)) return true
  const afterNumber = /\d\s*$/.test(before)
  if (UNITS.has(key) && afterNumber) return true
  if (CURRENCIES.has(key) && (COMMON_CURRENCIES.has(key) || afterNumber || /^\s*\d/.test(after))) return true
  const list = LISTS[family]
  // The curated list wins over the dictionary: SUS, NIS and DETRAN collide with words or names in it.
  if (list.expansions.has(key) || list.common.has(key)) return false
  return dictionary.isWord(key)
}

/** Where each abbreviation is explained: abbr with a title, dfn, a glossary link, or its full term written next to it. */
function explanationsOf(page: Page, runs: readonly TextRun[], occurrences: Map<string, Occurrence[]>, glossaryUrl: string | undefined): Map<string, Explanation[]> {
  const out = new Map<string, Explanation[]>()
  const add = (key: string, explanation: Explanation) => out.set(key, [...(out.get(key) ?? []), explanation])
  const keys = [...occurrences.keys()]
  const asWord = new Map(keys.map((key) => [key, new RegExp(`(?<![\\p{L}\\p{N}])${key}(?![\\p{L}\\p{N}])`, 'u')]))
  const runOf = runFinder(page, runs)
  for (const node of page.ordered) {
    const tag = tagOf(node)
    const attributes = attributesOf(node)
    const title = attributes.title?.trim()
    // An abbr explains with its title, a dfn by being one, a link when it leads to a glossary.
    if (!(tag === 'abbr' && title) && tag !== 'dfn' && !(tag === 'a' && isGlossary(attributes.href, glossaryUrl))) continue
    const text = (node.text ?? node.name ?? '').trim()
    const runIndex = runOf(node)
    const run = runIndex === undefined ? undefined : runs[runIndex]
    if (runIndex === undefined || !run) continue
    for (const key of keys) {
      const names = text === key || text === `${key}s`
      if (!names && (tag === 'abbr' || !asWord.get(key)?.test(text))) continue
      const place = { runIndex, offset: Math.max(0, run.text.indexOf(key)) }
      if (tag === 'abbr') add(key, { ...place, expansion: title, context: `<abbr title="${title}">${text}</abbr>` })
      else if (tag === 'dfn') add(key, { ...place, context: `<dfn>${text}</dfn>` })
      else add(key, { ...place, context: `<a href="${attributes.href ?? ''}">${text}</a>` })
    }
  }
  for (const [index, run] of runs.entries()) {
    for (const key of keys) {
      if (!run.text.includes(key)) continue
      // An expansion the lists attest counts next to the token in either language: "Perguntas Frequentes (FAQ)".
      const attested = [LISTS.pt.expansions.get(key), LISTS.en.expansions.get(key)].filter((expansion): expansion is string => expansion !== undefined)
      for (const definition of definitionsIn(key, run.text, attested)) {
        add(key, { runIndex: index, offset: definition.offset, expansion: definition.expansion, context: definition.context })
      }
    }
  }
  return out
}

function isGlossary(href: string | undefined, glossaryUrl: string | undefined): boolean {
  if (!href) return false
  if (glossaryUrl && href.includes(glossaryUrl)) return true
  return /glossario|glossary/.test(plain(href))
}

/** The sentence of a text that holds the character at `offset`, cut to a readable length. */
function sentenceAt(text: string, offset: number, language: string): string {
  let position = 0
  for (const sentence of sentences(text, language)) {
    const start = text.indexOf(sentence, position)
    if (start < 0) continue
    position = start + sentence.length
    if (offset >= start && offset < position) return sentence.length > 240 ? `${sentence.slice(0, 239)}…` : sentence
  }
  return text.slice(Math.max(0, offset - 100), offset + 140).trim()
}

/**
 * The first use written out: "Número de Identificação Social (NIS)". Only a short element holding nothing
 * but its text (a label, a button, a heading, a line) is rewritten in place, and only with an expansion
 * the page or the curated list attests; in a long paragraph the message says what to write instead.
 */
function expansionPatch(run: TextRun, first: Occurrence, expansion: string): Patch | undefined {
  const node = run.node
  if (node.children.length > 0 || run.text !== node.text || typeof node.native.tag !== 'string' || run.text.length > MAX_PATCHED_TEXT) return undefined
  const to = `${run.text.slice(0, first.offset)}${expansion} (${first.token})${run.text.slice(first.offset + first.token.length)}`
  return {
    ref: node.ref,
    kind: 'set-text',
    from: run.text,
    to,
    before: `${startTagOf(node)}${escapeHtml(run.text)}${endTagOf(node)}`,
    after: `${startTagOf(node)}${escapeHtml(to)}${endTagOf(node)}`,
  }
}
