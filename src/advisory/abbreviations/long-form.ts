/**
 * Finding the full term an abbreviation stands for, next to it on the page.
 *
 * Schwartz, A. S. and Hearst, M. A. (2003). A simple algorithm for identifying abbreviation definitions
 * in biomedical text. Pacific Symposium on Biocomputing 8:451–462
 * (https://psb.stanford.edu/psb-online/proceedings/psb03/schwartz.pdf). The letters of the short form are
 * matched right to left inside the candidate long form, the first one at the start of a word; the
 * shortest long form that matches wins. Accents are ignored, so "Número de Identificação Social" matches
 * NIS and "Cadastro Único" matches CadÚnico.
 */

/** Without accents and in lowercase, so É matches e. */
export function plain(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

const isAlnum = (char: string | undefined) => char !== undefined && /[\p{L}\p{N}]/u.test(char)

/** The long form inside `candidate` that `short` abbreviates, or undefined. */
export function bestLongForm(short: string, candidate: string): string | undefined {
  const s = plain(short)
  const l = plain(candidate)
  // plain() keeps one character per character for these scripts, so indexes map back to `candidate`.
  if (l.length !== candidate.length) return undefined
  let sIndex = s.length - 1
  let lIndex = l.length - 1
  while (sIndex >= 0) {
    const current = s[sIndex]
    if (!isAlnum(current)) {
      sIndex--
      continue
    }
    while ((lIndex >= 0 && l[lIndex] !== current) || (sIndex === 0 && lIndex > 0 && isAlnum(l[lIndex - 1]))) lIndex--
    if (lIndex < 0) return undefined
    lIndex--
    sIndex--
  }
  const start = l.lastIndexOf(' ', lIndex) + 1
  const found = candidate.slice(start).trim()
  const words = found.split(/\s+/).length
  // Schwartz and Hearst's limits: longer than the short form, and at most min(|short| + 5, 2 × |short|) words.
  if (found.length <= short.length || words > Math.min(short.length + 5, short.length * 2)) return undefined
  if (plain(found) === s) return undefined
  return found
}

/** The last `count` words of a text, as one string. */
export function lastWords(text: string, count: number): string {
  return text.trim().split(/\s+/).slice(-count).join(' ')
}

export interface Definition {
  /** The full term, as the page writes it. */
  expansion: string
  /** The text it was found in, around the abbreviation: "Número de Identificação Social (NIS)". */
  context: string
  /** Where the abbreviation occurs in the text. */
  offset: number
}

/**
 * Definitions of `token` written next to it in `text`: "Full Term (TOKEN)", "TOKEN (Full Term)",
 * "Full Term – TOKEN" and "TOKEN – Full Term". An attested expansion written next to it counts even when
 * its letters do not match, as a translation does: "Perguntas Frequentes (FAQ)".
 */
export function definitionsIn(token: string, text: string, attested: readonly string[] = []): Definition[] {
  const out: Definition[] = []
  const limit = Math.min(token.length + 5, token.length * 2)
  const known = attested.map((expansion) => plain(expansion).replace(/\s+/g, ' ').trim()).filter(Boolean)
  for (const match of text.matchAll(new RegExp(`(?<![\\p{L}\\p{N}])${escape(token)}s?(?![\\p{L}\\p{N}])`, 'gu'))) {
    const offset = match.index
    const before = text.slice(0, offset)
    const after = text.slice(offset + match[0].length)
    // Full Term (TOKEN)
    const openBefore = /\(\s*$/.exec(before)
    if (openBefore && /^\s*\)/.test(after)) {
      const preceding = before.slice(0, openBefore.index).trimEnd()
      const words = plain(preceding).replace(/\s+/g, ' ')
      const attestedHere = known.find((expansion) => words.endsWith(expansion))
      const long = bestLongForm(token, lastWords(preceding, limit)) ?? (attestedHere ? lastWords(preceding, attestedHere.split(' ').length) : undefined)
      if (long) out.push({ expansion: long, context: `${long} (${match[0]})`, offset })
      continue
    }
    // TOKEN (Full Term)
    const parenthetical = /^\s*\(([^()]{2,200})\)/.exec(after)
    if (parenthetical?.[1] && known.includes(plain(parenthetical[1]).replace(/\s+/g, ' ').trim())) {
      out.push({ expansion: parenthetical[1].trim(), context: `${match[0]} (${parenthetical[1].trim()})`, offset })
      continue
    }
    if (parenthetical?.[1]) {
      const long = bestLongForm(token, parenthetical[1].trim())
      if (long && plain(long.split(/\s+/)[0] ?? '').startsWith(plain(token.charAt(0)))) {
        out.push({ expansion: long, context: `${match[0]} (${parenthetical[1].trim()})`, offset })
        continue
      }
    }
    // Full Term – TOKEN
    const dashBefore = /\s[-–—:]\s*$/.exec(before)
    if (dashBefore) {
      const long = bestLongForm(token, lastWords(before.slice(0, dashBefore.index), limit))
      if (long && initialsMatch(token, long)) {
        out.push({ expansion: long, context: `${long} – ${match[0]}`, offset })
        continue
      }
    }
    // TOKEN – Full Term: the words right after the dash, up to punctuation, whose initials spell the token.
    const dashAfter = /^\s*[-–—:]\s+([^.,;:()]{2,200})/.exec(after)
    if (dashAfter?.[1]) {
      const words = dashAfter[1].trim().split(/\s+/)
      for (let count = 1; count <= Math.min(words.length, limit); count++) {
        const long = words.slice(0, count).join(' ')
        if (initialsMatch(token, long)) {
          out.push({ expansion: long, context: `${match[0]} – ${long}`, offset })
          break
        }
      }
    }
  }
  return out
}

const STOPWORDS = new Set([
  'de', 'da', 'do', 'das', 'dos', 'e', 'a', 'o', 'as', 'os', 'em', 'na', 'no', 'nas', 'nos', 'para', 'por', 'sobre', 'com', 'ao', 'aos', 'à', 'às',
  'of', 'the', 'and', 'for', 'to', 'in', 'on', 'at', 'by', 'with', 'or',
])

/**
 * Whether the initials of the words in `expansion` spell `token`: with the short words of a name left
 * out (Instituto Nacional do Seguro Social → INSS) or kept (Departamento de Trânsito → DT is not
 * accepted for DETRAN). The model's proposals are kept only when this holds.
 */
export function initialsMatch(token: string, expansion: string): boolean {
  const letters = plain(token).replace(/[^\p{L}\p{N}]/gu, '')
  const words = plain(expansion)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== '')
  if (words.length < 2 || letters.length < 2) return false
  const all = words.map((word) => word.charAt(0)).join('')
  const content = words.filter((word) => !STOPWORDS.has(word)).map((word) => word.charAt(0)).join('')
  // A plural acronym (CNPJs) spells the same initials as its singular.
  const singular = letters.endsWith('s') && token.at(-1) === 's' ? letters.slice(0, -1) : letters
  return [letters, singular].some((wanted) => wanted === all || wanted === content)
}

function escape(text: string): string {
  return text.replace(/[\\^$.*+?()[\]{}|/-]/g, '\\$&')
}
