import type { Finding } from '../core/types.ts'
import { subtreeText } from '../criteria/shared.ts'
import type { Locale } from '../i18n.ts'
import type { A11ySnapshot } from '../snapshot/schema.ts'
import { indexTree } from '../snapshot/tree.ts'

/**
 * 2.5.3 Label in Name. axe-core's label-content-name-mismatch fails a control when its visible text is
 * not in its accessible name, comparing letters exactly: "E-mail" against "Email address", or "Info"
 * against "Information about shipping". Speech recognition matches those, or may: whether it does is
 * for a person to try. Such failures move below the threshold, as needs review, with the reason; every
 * other mismatch stays as axe reported it.
 */

export const LABEL_IN_NAME_RULE = 'label-content-name-mismatch'

const HYPHENS = /[-­‐‑‒–]/g

const wordsOf = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFKC')
    .replace(HYPHENS, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== '')

/** How the visible text and the name differ when only hyphenation or a shortened word does, or undefined. */
export function nearMatch(visible: string, name: string): 'hyphenation' | 'abbreviation' | undefined {
  const label = wordsOf(visible)
  const named = wordsOf(name)
  if (label.length === 0 || named.length < label.length) return undefined
  const joined = ` ${named.join(' ')} `
  if (joined.includes(` ${label.join(' ')} `)) return 'hyphenation'
  // "Info" for "Information": every visible word starts a word of the name, in order, and none is a single letter.
  for (let start = 0; start + label.length <= named.length; start++) {
    const window = named.slice(start, start + label.length)
    const prefixes = label.every((word, i) => word.length >= 3 && window[i]?.startsWith(word) === true)
    if (prefixes && label.some((word, i) => word !== window[i])) return 'abbreviation'
  }
  return undefined
}

const NOTES: Record<'hyphenation' | 'abbreviation', Record<Locale, string>> = {
  hyphenation: {
    en: 'Only hyphenation differs between the visible label and the accessible name: needs review, try it with speech input.',
    'pt-BR': 'Só o hífen difere entre o rótulo visível e o nome acessível: precisa de revisão, teste com comando de voz.',
  },
  abbreviation: {
    en: 'The visible label is a shortened form of words in the accessible name: needs review, try it with speech input.',
    'pt-BR': 'O rótulo visível é uma forma abreviada de palavras do nome acessível: precisa de revisão, teste com comando de voz.',
  },
}

export function reviewLabelInName(findings: Finding[], snapshot: A11ySnapshot, locale: Locale): Finding[] {
  if (!findings.some((finding) => finding.ruleId === LABEL_IN_NAME_RULE)) return findings
  const index = indexTree(snapshot.root)
  return findings.map((finding) => {
    if (finding.source !== 'engine' || finding.ruleId !== LABEL_IN_NAME_RULE || !finding.ref) return finding
    const node = index.get(finding.ref)?.node
    const name = node?.name?.trim()
    if (!node || !name) return finding
    const visible = subtreeText(node)
    const kind = nearMatch(visible, name)
    if (!kind) return finding
    return { ...finding, confidence: 'low', message: `${finding.message} ${NOTES[kind][locale]}`, evidence: `"${visible}" / "${name}"` }
  })
}
