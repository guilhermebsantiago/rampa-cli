/**
 * Just enough of Hunspell to answer one question: is this word in the dictionary, as a word and not as
 * an acronym? "ENTRAR" written in capitals is the word entrar; "NASA" is an entry written in capitals,
 * so it stays an acronym. A form is accepted when it is an entry, or an entry with one suffix, one
 * prefix, or both when the rules allow it (the affix rules of the .aff file). Compounding, morphology
 * and suggestions are left out.
 */

export interface WordList {
  /** Whether the lowercase form of `word` is a word of the language (not an entry written in capitals). */
  isWord(word: string): boolean
}

type FlagMode = 'char' | 'long' | 'num'

interface AffixRule {
  flag: string
  cross: boolean
  strip: string
  add: string
  condition: RegExp | undefined
}

export class Hunspell implements WordList {
  private readonly mode: FlagMode
  private readonly aliases: string[] = []
  private readonly suffixes = new Map<string, AffixRule[]>()
  private readonly prefixes = new Map<string, AffixRule[]>()
  /** Lowercase form → flags of the entries that are words; entries written in capitals are acronyms and left out. */
  private readonly words = new Map<string, string>()
  private readonly forbidden: string | undefined
  private readonly standaloneOnly: string[] = []

  constructor(aff: string, dic: string) {
    const lines = aff.split(/\r?\n/)
    const directive = (name: string) => lines.find((line) => line.startsWith(`${name} `))?.split(/\s+/)[1]
    const flag = directive('FLAG')
    this.mode = flag === 'long' ? 'long' : flag === 'num' ? 'num' : 'char'
    this.forbidden = directive('FORBIDDENWORD')
    // Entries with these flags are not words on their own.
    for (const name of ['ONLYINCOMPOUND', 'NEEDAFFIX']) {
      const value = directive(name)
      if (value) this.standaloneOnly.push(value)
    }
    const headers = new Map<string, boolean>()
    let aliasHeader = false
    for (const line of lines) {
      const [kind, ruleFlag, a, b, c] = line.trim().split(/\s+/)
      if (kind === 'AF' && ruleFlag !== undefined) {
        // The first AF line counts the aliases; each one after it is a set of flags, numbered from 1.
        if (aliasHeader) this.aliases.push(ruleFlag)
        aliasHeader = true
        continue
      }
      if ((kind !== 'SFX' && kind !== 'PFX') || ruleFlag === undefined || a === undefined) continue
      if (!headers.has(`${kind}|${ruleFlag}`)) {
        // The header: SFX flag Y|N count.
        headers.set(`${kind}|${ruleFlag}`, a === 'Y')
        continue
      }
      if (b === undefined) continue
      const strip = a === '0' ? '' : a
      const add = (b.split('/')[0] ?? '') === '0' ? '' : (b.split('/')[0] ?? '')
      const rule: AffixRule = {
        flag: ruleFlag,
        cross: headers.get(`${kind}|${ruleFlag}`) ?? false,
        strip: strip.toLowerCase(),
        add: add.toLowerCase(),
        condition: c === undefined || c === '.' ? undefined : conditionRegex(c.toLowerCase(), kind === 'SFX'),
      }
      const table = kind === 'SFX' ? this.suffixes : this.prefixes
      const list = table.get(rule.add) ?? []
      list.push(rule)
      table.set(rule.add, list)
    }

    const entries = dic.replace(/^﻿/, '').split(/\r?\n/)
    for (let i = 1; i < entries.length; i++) {
      const entry = entries[i]?.split(/[\t ]/)[0]
      if (!entry) continue
      const slash = entry.search(/(?<!\\)\//)
      const word = (slash < 0 ? entry : entry.slice(0, slash)).replaceAll('\\/', '/')
      let flags = slash < 0 ? '' : entry.slice(slash + 1)
      if (this.aliases.length > 0 && /^\d+$/.test(flags)) flags = this.aliases[Number(flags) - 1] ?? ''
      // An entry written in capitals (NASA, CPF) is an acronym: it never makes the capitals a word.
      if (word.length > 1 && word === word.toUpperCase() && word !== word.toLowerCase()) continue
      const key = word.toLowerCase()
      const known = this.words.get(key)
      this.words.set(key, known === undefined ? flags : `${known}${this.mode === 'num' ? ',' : ''}${flags}`)
    }
  }

  isWord(word: string): boolean {
    const lower = word.toLowerCase()
    const own = this.words.get(lower)
    if (own !== undefined && this.standalone(own)) return true
    if (this.withSuffix(lower)) return true
    for (let length = 0; length <= lower.length; length++) {
      for (const rule of this.prefixes.get(lower.slice(0, length)) ?? []) {
        const stem = rule.strip + lower.slice(length)
        if (stem === '' || (rule.condition && !rule.condition.test(stem))) continue
        const flags = this.words.get(stem)
        if (flags !== undefined && this.has(flags, rule.flag) && !this.forbiddenIn(flags)) return true
        // Prefix and suffix together, when both rules allow it.
        if (rule.cross && this.withSuffix(stem, rule.flag)) return true
      }
    }
    return false
  }

  private withSuffix(word: string, alsoFlag?: string): boolean {
    for (let length = 0; length <= word.length; length++) {
      const add = word.slice(word.length - length)
      for (const rule of this.suffixes.get(add) ?? []) {
        if (alsoFlag !== undefined && !rule.cross) continue
        const stem = word.slice(0, word.length - length) + rule.strip
        if (stem === '' || (rule.condition && !rule.condition.test(stem))) continue
        const flags = this.words.get(stem)
        if (flags === undefined || !this.has(flags, rule.flag) || this.forbiddenIn(flags)) continue
        if (alsoFlag === undefined || this.has(flags, alsoFlag)) return true
      }
    }
    return false
  }

  private standalone(flags: string): boolean {
    return !this.forbiddenIn(flags) && !this.standaloneOnly.some((flag) => this.has(flags, flag))
  }

  private forbiddenIn(flags: string): boolean {
    return this.forbidden !== undefined && this.has(flags, this.forbidden)
  }

  private has(flags: string, flag: string): boolean {
    if (flags === '') return false
    switch (this.mode) {
      case 'char':
        return [...flags].includes(flag)
      case 'long':
        for (let i = 0; i + 1 < flags.length; i += 2) if (flags.slice(i, i + 2) === flag) return true
        return false
      case 'num':
        return flags.split(',').includes(flag)
    }
  }
}

/** A Hunspell condition (letters, [abc], [^abc] and .) as a regular expression on the end (suffix) or start (prefix) of the stem. */
function conditionRegex(condition: string, suffix: boolean): RegExp | undefined {
  let source = ''
  let inClass = false
  for (const char of condition) {
    if (char === '[' && !inClass) {
      inClass = true
      source += '['
    } else if (char === ']' && inClass) {
      inClass = false
      source += ']'
    } else if (char === '^' && inClass && source.endsWith('[')) source += '^'
    else if (char === '.' && !inClass) source += '.'
    else source += char.replace(/[\\^$.*+?()[\]{}|/-]/g, '\\$&')
  }
  try {
    return new RegExp(suffix ? `${source}$` : `^${source}`, 'u')
  } catch {
    return undefined
  }
}
